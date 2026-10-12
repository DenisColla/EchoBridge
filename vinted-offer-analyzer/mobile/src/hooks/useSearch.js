import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CHANNELS, CHANNEL_IDS, ITALIAN_CITIES, NOT_MODEL_KINDS, channelSearchUrl, cleanProduct, fallbackProduct, prefilter, priceWindow, productPrompt,
  psychPrompt, rankResults, referenceOutlook, searchVerifyPrompt,
} from '../../core/index.js'
import { callModel } from '../services/llmClient.js'
import { getApiKey } from '../services/secrets.js'
import { prepareImage } from '../services/images.js'
import { emptySearchState, loadSearchState, saveSearchState } from '../services/searchStore.js'

/** Models chosen in the AI lab (October 2026): Qwen recognises listings, Haiku steps in, GPT-6 Luna writes. */
export const VERIFY_CHAIN = ['qwen:qwen3.8-flash', 'anthropic:claude-haiku-5-5']
export const TEXT_CHAIN = ['openai:gpt-6-luna', 'anthropic:claude-haiku-5-5']
const CONCURRENCY = 4
const PER_CHANNEL = 20

const providerOf = (modelKey) => modelKey.split(':')[0]
let runCounter = 0

/** First answer that validates, trying the chain in order; models without a key are skipped. */
async function callChain(chain, prompt, images, opts) {
  let cost = 0
  let last = { ok: false, error: 'Nessuna chiave per i modelli scelti', kind: 'auth' }
  for (const modelKey of chain) {
    if (opts.signal && opts.signal.aborted) return { ...last, ok: false, kind: 'cancelled', costUsd: cost }
    if (!(await getApiKey(providerOf(modelKey)))) continue
    const res = await callModel(modelKey, prompt, images, opts)
    cost += res.costUsd || 0
    if (res.ok) return { ...res, modelKey, costUsd: cost }
    last = { ...res, modelKey }
    if (res.kind === 'cancelled') break
  }
  return { ...last, ok: false, costUsd: cost }
}

/**
 * «Cerca altrove»: product card → the user browses each channel's search in a visible browser (the app reads the page
 * they see) → pre-filter → verification with photos → ranking. One search at a time; the state lives in App so a
 * running analysis survives closing the screen.
 */
export function useSearch() {
  const [store, setStore] = useState(null)
  const storeRef = useRef(null)
  const [run, setRun] = useState(null)
  const runRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    let alive = true
    loadSearchState().then((s) => {
      if (!alive) return
      storeRef.current = s
      setStore(s)
    })
    return () => { alive = false }
  }, [])

  const updateStore = useCallback((fn) => {
    const next = fn(storeRef.current || emptySearchState())
    storeRef.current = next
    setStore(next)
    saveSearchState(next)
    return next
  }, [])
  const updateRun = useCallback((fn) => {
    const next = typeof fn === 'function' ? fn(runRef.current) : fn
    runRef.current = next
    setRun(next)
    return next
  }, [])
  const addSpend = useCallback((modelKey, usd) => {
    if (!usd) return
    const p = providerOf(modelKey || 'altro:x')
    updateStore((s) => ({ ...s, spend: { ...s.spend, [p]: (s.spend[p] || 0) + usd } }))
    updateRun((r) => (r ? { ...r, cost: (r.cost || 0) + usd } : r))
  }, [updateRun, updateStore])

  /** Which chains have at least one key: verification (Qwen/Haiku) and texts (GPT/Haiku). */
  const [keys, setKeys] = useState(null)
  const checkKeys = useCallback(async () => {
    const has = async (chain) => {
      for (const k of chain) if (await getApiKey(providerOf(k))) return true
      return false
    }
    const next = { verify: await has(VERIFY_CHAIN), text: await has(TEXT_CHAIN) }
    setKeys(next)
    return next
  }, [])

  const city = (store && ITALIAN_CITIES.find((c) => c.label === store.cityLabel)) || ITALIAN_CITIES[0]
  const setCity = useCallback((label) => updateStore((s) => ({ ...s, cityLabel: label })), [updateStore])

  /** Starts a search from a listing: the product card is asked to the AI (falls back to the title words). */
  const start = useCallback(async (reference) => {
    // A new search stops whatever the previous one was still verifying; late answers are ignored by run id.
    if (abortRef.current) abortRef.current.abort()
    const id = ++runCounter
    const fb = fallbackProduct(reference)
    updateRun({
      id, phase: 'card', reference, product: fb, window: priceWindow(reference.price), outlook: referenceOutlook(reference, new Date()), cardLoading: true, queries: Object.fromEntries(CHANNEL_IDS.map((id) => [id, fb.query])),
      channels: Object.fromEntries(CHANNEL_IDS.map((id) => [id, { items: [], read: false, raw: null }])), job: null, ranking: null, cost: 0, explanations: {}, error: null,
    })
    const res = await callChain(TEXT_CHAIN, productPrompt(reference), [], { effort: 'low', maxTokens: 1500, timeoutMs: 60_000 })
    if (res.costUsd) addSpend(res.modelKey, res.costUsd)
    if (!runRef.current || runRef.current.id !== id) return
    const product = res.ok ? cleanProduct(res.value, reference) : fb
    updateRun((r) => (r && r.id === id ? { ...r, product, cardLoading: false, cardError: res.ok ? null : res.error, queries: Object.fromEntries(CHANNEL_IDS.map((ch) => [ch, r.queries[ch] && r.queries[ch] !== fb.query ? r.queries[ch] : product.query])) } : r))
  }, [addSpend, updateRun])

  const setQuery = useCallback((channel, q) => updateRun((r) => (r ? { ...r, queries: { ...r.queries, [channel]: q } } : r)), [updateRun])
  const searchUrlFor = useCallback((channel) => {
    const r = runRef.current
    if (!r) return null
    return channelSearchUrl(channel, r.queries[channel] || r.product.query, { ...r.window, city })
  }, [city])

  /** Results read from a channel's page (replaces that channel's previous read). */
  const setChannelResults = useCallback((channel, items, raw) => updateRun((r) => (r ? {
    ...r, channels: { ...r.channels, [channel]: { items, read: true, raw: items.length ? null : raw || null } },
  } : r)), [updateRun])
  /** Wallapop loads more results while the user scrolls: they are added, not replaced. */
  const addChannelResults = useCallback((channel, items) => updateRun((r) => {
    if (!r) return r
    const prev = r.channels[channel].items
    const ids = new Set(prev.map((c) => c.id))
    return { ...r, channels: { ...r.channels, [channel]: { items: [...prev, ...items.filter((c) => !ids.has(c.id))], read: true, raw: null } } }
  }), [updateRun])

  const setPhase = useCallback((phase) => updateRun((r) => (r ? { ...r, phase } : r)), [updateRun])

  /** Pre-filter + verification of what was read, then the ranking. */
  const analyze = useCallback(async () => {
    const r = runRef.current
    if (!r || (r.job && r.job.running)) return null
    const all = CHANNEL_IDS.flatMap((id) => r.channels[id].items)
    const reference = r.reference
    const id = r.id
    const mine = (x) => Boolean(x && x.id === id)
    const withReferencePhoto = Boolean(reference.photo)
    const { kept, dropped } = prefilter(all, r.product, reference, { perChannel: PER_CHANNEL })
    const controller = new AbortController()
    abortRef.current = controller
    updateRun((x) => ({ ...x, phase: 'analyze', dropped, job: { running: true, done: 0, total: kept.length, failed: 0 }, ranking: null }))
    const results = []
    const failures = []
    let next = 0
    let done = 0
    const verifyOne = async (c) => {
      let images
      try {
        images = await Promise.all(withReferencePhoto ? [prepareImage(reference.photo), prepareImage(c.photo)] : [prepareImage(c.photo)])
      } catch (e) {
        return { ok: false, error: `Foto: ${String(e && e.message ? e.message : e)}`, kind: 'photo' }
      }
      return callChain(VERIFY_CHAIN, searchVerifyPrompt(reference, r.product, c, { withReferencePhoto }), images, { effort: 'low', maxTokens: 1500, timeoutMs: 90_000, signal: controller.signal })
    }
    const worker = async () => {
      while (next < kept.length && !controller.signal.aborted) {
        const c = kept[next++]
        let res
        try {
          res = await verifyOne(c)
        } catch (e) {
          res = { ok: false, error: String(e && e.message ? e.message : e), kind: 'request' }
        }
        if (res.costUsd) addSpend(res.modelKey, res.costUsd)
        if (res.kind === 'cancelled') continue
        done++
        if (res.ok) results.push({ candidate: c, ...res.value, model: res.modelKey })
        else failures.push({ candidate: c, error: res.error, kind: res.kind, infra: NOT_MODEL_KINDS.includes(res.kind) })
        updateRun((x) => (mine(x) ? { ...x, job: { running: true, done, total: kept.length, failed: failures.length } } : x))
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, kept.length) }, worker))
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
    if (!mine(runRef.current)) return null
    const now = new Date()
    const ranking = rankResults(results, now)
    const outlook = referenceOutlook(reference, now)
    const summary = {
      read: all.length, kept: kept.length, verified: results.length, failed: failures.length, cancelled: controller.signal.aborted,
      different: results.filter((x) => x.verdict === 'different' && !x.family).length,
    }
    const finished = updateRun((x) => (mine(x) ? { ...x, phase: 'done', job: null, ranking, failures, summary, outlook, finishedAt: now.toISOString() } : x))
    if (finished) {
      // Keep the last search to reopen it later (no photos, no prompts).
      updateStore((s) => ({ ...s, last: { reference, product: finished.product, ranking, summary, outlook, at: now.toISOString() } }))
    }
    return summary
  }, [addSpend, updateRun, updateStore])

  const cancel = useCallback(() => { if (abortRef.current) abortRef.current.abort() }, [])

  /** «Perché conviene»: the negotiation text for one row, with the channel's rules and the ranking's numbers. */
  const explain = useCallback(async (row) => {
    const key = `${row.candidate.source}:${row.candidate.id}`
    const r = runRef.current
    if (!r || r.reopened || (r.explanations[key] && (r.explanations[key].loading || r.explanations[key].value))) return
    const id = r.id
    updateRun((x) => ({ ...x, explanations: { ...x.explanations, [key]: { loading: true } } }))
    const c = row.candidate
    const ch = CHANNELS[c.source]
    const facts = {
      listPrice: c.price, buyerTotal: Number.isFinite(c.buyerFee) ? c.price + c.buyerFee : null, target: row.offer,
      discountPct: Number.isFinite(row.offer) && c.price ? Math.round((1 - row.offer / c.price) * 100) : null,
      probability: Number.isFinite(row.probability) ? Math.round(row.probability * 100) : null, sendLabel: row.sendLabel,
      note: c.source !== 'vinted' ? 'numeri stimati con il modello di Vinted' : null,
    }
    const prompt = psychPrompt({ candidate: c, facts, label: row.group === 'alternative' ? 'family' : row.verdict, channelLabel: ch ? ch.label : c.source, channelRules: ch ? ch.offerRules : null })
    const res = await callChain(TEXT_CHAIN, prompt, [], { effort: 'medium', maxTokens: 3000, timeoutMs: 120_000 })
    if (res.costUsd) addSpend(res.modelKey, res.costUsd)
    updateRun((x) => (x && x.id === id ? { ...x, explanations: { ...x.explanations, [key]: res.ok ? { value: res.value } : { error: res.error || 'Testo non disponibile' } } } : x))
  }, [addSpend, updateRun])

  /** Reopens the last saved search (read-only: no channels to browse). */
  const reopenLast = useCallback(() => {
    const last = storeRef.current && storeRef.current.last
    if (!last) return false
    if (abortRef.current) abortRef.current.abort()
    updateRun({ id: ++runCounter, phase: 'done', reference: last.reference, product: last.product, ranking: last.ranking, summary: last.summary, outlook: last.outlook || null, finishedAt: last.at, channels: Object.fromEntries(CHANNEL_IDS.map((id) => [id, { items: [], read: false }])), queries: {}, explanations: {}, cost: 0, reopened: true })
    return true
  }, [updateRun])

  const close = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    updateRun(null)
  }, [updateRun])

  return {
    ready: Boolean(store), store, run, keys, checkKeys, city, setCity, start, setQuery, searchUrlFor, setChannelResults, addChannelResults, setPhase,
    analyze, cancel, explain, reopenLast, close,
  }
}
