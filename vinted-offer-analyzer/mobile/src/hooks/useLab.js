import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LLM_METHOD, LLM_MODELS, LLM_PROVIDERS, engineFactsFor, labWorkbook, psychPrompt, scorePsychology, scoreVerification, verifyPrompt,
} from '../../core/index.js'
import { emptyLab, loadLab, saveLab } from '../services/labStore.js'
import { getApiKey, maskKey, setApiKey } from '../services/secrets.js'
import { callModel, testKey } from '../services/llmClient.js'
import { prepareImage } from '../services/images.js'
import { shareReport, writeReport } from '../services/reports.js'

/** Parallel calls across the whole run: enough to keep a few providers busy without hitting new-account limits. */
const CONCURRENCY = 4
const PSYCH_CASES = 10
const runKey = (modelKey, id) => `${modelKey}|${id}`

/** Latest run per (model, pair) of a task: re-running a model replaces its old answers in the scores. */
function latestRuns(runs, task) {
  const map = new Map()
  for (const r of runs) if (r.task === task) map.set(runKey(r.modelKey, r.pairId || r.caseId), r)
  return [...map.values()]
}

const hash = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Up to 10 distinct candidates labelled same/variant, in a stable shuffled order: the psychology cases. */
function pickCases(pairs, seed) {
  const seen = new Set()
  const usable = []
  for (const p of pairs) {
    if ((p.label !== 'same' && p.label !== 'variant') || !p.candidate || seen.has(p.candidate.id)) continue
    seen.add(p.candidate.id)
    usable.push(p)
  }
  return usable
    .map((p) => ({ p, k: hash(`${p.id}|${seed}`) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, PSYCH_CASES)
    .map(({ p }) => ({ caseId: p.id, pairId: p.id, candidate: p.candidate, source: p.source, label: p.label }))
}

/**
 * State and actions of the AI lab: keys, labelled pairs, the verification test, the psychology test with blind
 * ratings, spend tracking and the Excel report.
 */
export function useLab({ folderUri = null } = {}) {
  const [lab, setLab] = useState(null)
  const labRef = useRef(null)
  const [keys, setKeys] = useState({})
  const [job, setJob] = useState(null)
  const abortRef = useRef(null)

  const persist = useCallback(async (updater) => {
    const next = typeof updater === 'function' ? updater(labRef.current || emptyLab()) : updater
    labRef.current = next
    setLab(next)
    await saveLab(next)
    return next
  }, [])

  const readKeys = () => Promise.all(Object.keys(LLM_PROVIDERS).map(async (p) => [p, maskKey(await getApiKey(p))])).then(Object.fromEntries)
  const refreshKeys = useCallback(async () => setKeys(await readKeys()), [])

  useEffect(() => {
    let alive = true
    Promise.all([loadLab(), readKeys()]).then(([l, k]) => {
      if (!alive) return
      labRef.current = l
      setLab(l)
      setKeys(k)
    })
    return () => { alive = false }
  }, [])

  const saveKey = useCallback(async (provider, value) => {
    const ok = await setApiKey(provider, value)
    await refreshKeys()
    return ok
  }, [refreshKeys])

  const checkKey = useCallback(async (modelKey) => {
    const res = await testKey(modelKey)
    if (res.costUsd) {
      const provider = modelKey.split(':')[0]
      await persist((l) => ({ ...l, spend: { ...l.spend, [provider]: (l.spend[provider] || 0) + res.costUsd } }))
    }
    return res
  }, [persist])

  const addPairs = useCallback((pairs) => persist((l) => {
    const byId = new Map(l.pairs.map((p) => [p.id, p]))
    for (const p of pairs) byId.set(p.id, p)
    return { ...l, pairs: [...byId.values()] }
  }), [persist])

  const relabel = useCallback((id, label) => persist((l) => ({ ...l, pairs: l.pairs.map((p) => (p.id === id ? { ...p, label } : p)) })), [persist])
  const removePair = useCallback((id) => persist((l) => ({ ...l, pairs: l.pairs.filter((p) => p.id !== id), runs: l.runs.filter((r) => r.pairId !== id) })), [persist])

  /** Runs a list of tasks with a small worker pool, recording each result as it lands. */
  const runPool = useCallback(async (kind, tasks, work) => {
    const controller = new AbortController()
    abortRef.current = controller
    let done = 0
    let cost = 0
    let failed = 0
    setJob({ kind, done, total: tasks.length, cost, failed })
    let next = 0
    // Results update the screen at once; storage is written every few results and at the end (the lab can be large).
    const record = (task, rec) => {
      const provider = task.modelKey.split(':')[0]
      const l = labRef.current || emptyLab()
      const nextLab = { ...l, runs: [...l.runs, rec], spend: { ...l.spend, [provider]: (l.spend[provider] || 0) + (rec.costUsd || 0) } }
      labRef.current = nextLab
      setLab(nextLab)
      if (done % 8 === 0) saveLab(nextLab)
    }
    const worker = async () => {
      while (next < tasks.length && !controller.signal.aborted) {
        const task = tasks[next++]
        if (task.skip) continue
        const rec = await work(task, controller.signal)
        if (rec.kind === 'cancelled') continue
        done++
        cost += rec.costUsd || 0
        if (!rec.ok) failed++
        record(task, rec)
        setJob({ kind, done, total: tasks.length, cost, failed })
        // A missing key, a rejected key or an empty balance will not fix itself: stop that provider's remaining work.
        if (rec.kind === 'auth' || rec.kind === 'balance') {
          for (let i = next; i < tasks.length; i++) if (tasks[i].modelKey.split(':')[0] === task.modelKey.split(':')[0]) tasks[i].skip = true
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker))
    if (labRef.current) await saveLab(labRef.current)
    abortRef.current = null
    setJob(null)
    return { done, cost, failed, cancelled: controller.signal.aborted }
  }, [])

  const cancel = useCallback(() => { if (abortRef.current) abortRef.current.abort() }, [])

  /** Verification test: every selected model on every labelled pair it has not answered yet (or all, on rerun). */
  const runVerification = useCallback(async (modelKeys, { rerun = false } = {}) => {
    const l = labRef.current
    if (!l || job) return null
    const answered = new Set(latestRuns(l.runs, 'verify').filter((r) => r.ok).map((r) => runKey(r.modelKey, r.pairId)))
    const pairs = l.pairs.filter((p) => p.label && p.source && p.candidate)
    // Interleave models so all of them progress together and a cancelled run still compares like with like.
    const tasks = []
    for (const p of pairs) for (const modelKey of modelKeys) if (rerun || !answered.has(runKey(modelKey, p.id))) tasks.push({ modelKey, pair: p })
    return runPool('verify', tasks, async ({ modelKey, pair }, signal) => {
      const base = { task: 'verify', modelKey, pairId: pair.id, at: new Date().toISOString() }
      let images
      try {
        images = await Promise.all([prepareImage(pair.source.photo), prepareImage(pair.candidate.photo)])
      } catch (e) {
        return { ...base, ok: false, error: `Foto: ${String(e.message || e)}`, costUsd: 0, latencyMs: 0 }
      }
      const res = await callModel(modelKey, verifyPrompt(pair), images, { effort: 'low', maxTokens: 1500, timeoutMs: 90_000, signal })
      return {
        ...base, ok: res.ok, verdict: res.ok ? res.value.verdict : null, confidence: res.ok ? res.value.confidence : null,
        reason: res.ok ? res.value.reason : null, redFlags: res.ok ? res.value.redFlags : null,
        error: res.error || null, kind: res.kind || null, costUsd: res.costUsd || 0, latencyMs: res.latencyMs || 0,
        tokens: res.usage ? { input: res.usage.input, output: res.usage.output } : null,
      }
    })
  }, [job, runPool])

  const cases = useMemo(() => (lab ? pickCases(lab.pairs, lab.seed) : []), [lab])

  /** Psychology test: each selected model writes the explanation for each case (grounded on the engine numbers). */
  const runPsychology = useCallback(async (modelKeys, { rerun = false } = {}) => {
    const l = labRef.current
    if (!l || job) return null
    const answered = new Set(latestRuns(l.runs, 'psych').filter((r) => r.ok).map((r) => runKey(r.modelKey, r.caseId)))
    const now = new Date()
    const tasks = []
    for (const c of cases) for (const modelKey of modelKeys) if (rerun || !answered.has(runKey(modelKey, c.caseId))) tasks.push({ modelKey, c })
    return runPool('psych', tasks, async ({ modelKey, c }, signal) => {
      const facts = engineFactsFor(c.candidate, c.source || {}, now)
      const res = await callModel(modelKey, psychPrompt({ ...c, facts }), [], { effort: 'medium', maxTokens: 3000, timeoutMs: 120_000, signal })
      return {
        task: 'psych', modelKey, caseId: c.caseId, at: new Date().toISOString(), ok: res.ok, value: res.ok ? res.value : null,
        error: res.error || null, kind: res.kind || null, costUsd: res.costUsd || 0, latencyMs: res.latencyMs || 0,
      }
    })
  }, [job, runPool, cases])

  const rate = useCallback((caseId, modelKey, patch) => persist((l) => {
    const others = l.ratings.filter((r) => !(r.caseId === caseId && r.modelKey === modelKey))
    const current = l.ratings.find((r) => r.caseId === caseId && r.modelKey === modelKey) || { caseId, modelKey, score: 0, invented: false }
    return { ...l, ratings: [...others, { ...current, ...patch, at: new Date().toISOString() }] }
  }), [persist])

  const verifyRuns = useMemo(() => (lab ? latestRuns(lab.runs, 'verify') : []), [lab])
  const psychRuns = useMemo(() => (lab ? latestRuns(lab.runs, 'psych') : []), [lab])
  const verification = useMemo(() => (lab ? scoreVerification(verifyRuns, lab.pairs) : []), [lab, verifyRuns])
  const psychology = useMemo(() => (lab ? scorePsychology(lab.ratings.filter((r) => r.score > 0)) : []), [lab])

  const exportReport = useCallback(async () => {
    const l = labRef.current
    if (!l) return null
    const models = Object.fromEntries(LLM_MODELS.map((m) => [m.key, m.label]))
    const caseTitle = new Map(cases.map((c) => [c.caseId, c.candidate.title]))
    const textOf = new Map(psychRuns.filter((r) => r.ok).map((r) => [runKey(r.modelKey, r.caseId), r.value]))
    const ratings = l.ratings.filter((r) => r.score > 0).map((r) => {
      const v = textOf.get(runKey(r.modelKey, r.caseId))
      return { ...r, caseTitle: caseTitle.get(r.caseId) || '', text: v ? [v.why, ...(v.leverage || []).map((x) => `• ${x}`), v.sellerProfile, ...(v.risks || []).map((x) => `Rischio: ${x}`)].join('\n') : '' }
    })
    const bytes = labWorkbook({
      generatedAt: new Date(), models, verification, psychology, runs: verifyRuns, pairs: l.pairs, ratings,
      prices: LLM_MODELS.map((m) => ({ provider: LLM_PROVIDERS[m.provider].label, model: m.model, input: m.pricing.input, output: m.pricing.output, note: m.priceNote })),
      method: LLM_MODELS.map((m) => ({ provider: `${LLM_PROVIDERS[m.provider].label} · ${m.label}`, ...LLM_METHOD[m.provider] })),
    })
    const day = new Date().toISOString().slice(0, 10)
    const file = await writeReport({ bytes, fileName: `Laboratorio-AI-${day}.xlsx`, folderUri })
    if (file.localUri) await shareReport(file.localUri, `Laboratorio AI ${day}`)
    return file
  }, [cases, folderUri, psychRuns, psychology, verification, verifyRuns])

  const reset = useCallback(() => persist({ ...emptyLab(), spend: (labRef.current && labRef.current.spend) || {} }), [persist])

  return {
    ready: Boolean(lab), lab, keys, job, cases, verifyRuns, psychRuns, verification, psychology,
    saveKey, checkKey, addPairs, relabel, removePair, runVerification, runPsychology, cancel, rate, exportReport, reset,
  }
}
