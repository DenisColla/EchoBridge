import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * The AI lab's data on the phone: labelled pairs (reference listing + candidate from a search), model runs, blind
 * ratings and estimated spend per provider. API keys are NOT here (see secrets.js).
 */
const KEY = 'offerta-vinted.lab.v1'
const MAX_PAIRS = 400
// Android reads one AsyncStorage value through a 2 MB CursorWindow: a larger value saves but can no longer be read.
const MAX_CHARS = 1_200_000

export const emptyLab = () => ({ version: 1, pairs: [], runs: [], ratings: [], caseIds: [], spend: {}, seed: Math.floor(Math.random() * 1e6) })

/**
 * The stored lab, or an empty one when there is none. A read that fails (as opposed to missing or corrupt data) returns
 * an empty lab flagged `loadFailed`, which saveLab refuses to write, so a transient error never wipes the real data.
 */
export async function loadLab() {
  let raw = null
  try {
    raw = await AsyncStorage.getItem(KEY)
  } catch {
    return { ...emptyLab(), loadFailed: true }
  }
  try {
    const lab = raw ? JSON.parse(raw) : null
    if (!lab || typeof lab !== 'object' || lab.version !== 1) return emptyLab()
    return { ...emptyLab(), ...lab }
  } catch {
    if (raw) await AsyncStorage.setItem(`${KEY}.corrupt.${Date.now()}`, raw).catch(() => {})
    return emptyLab()
  }
}

/** Only the latest run per (task, model, pair or case) is used by the scores and the report: older ones are dropped. */
export function compactRuns(runs) {
  const map = new Map()
  for (const r of runs) {
    const k = `${r.task}|${r.modelKey}|${r.pairId || r.caseId}`
    map.delete(k)
    map.set(k, r)
  }
  return [...map.values()]
}

/**
 * Keeps the stored value under MAX_CHARS. Order of sacrifice: the reasons of the oldest photo-test answers (the
 * verdicts stay), then the oldest photo-test answers, and only as a last resort the oldest psychology texts together
 * with their ratings (a regenerated text must never inherit a vote given to another text).
 */
function fitInStorage(stored) {
  let json = JSON.stringify(stored)
  const isVerify = (r) => r.task === 'verify'
  let slim = 0
  while (json.length > MAX_CHARS) {
    const verify = stored.runs.filter(isVerify)
    if (slim < verify.length) {
      // runs are oldest first (compactRuns keeps recency order)
      slim = Math.min(verify.length, slim + Math.ceil(verify.length / 10))
      const strip = new Set(verify.slice(0, slim))
      stored.runs = stored.runs.map((r) => (strip.has(r) && (r.reason || r.redFlags || r.tokens) ? { ...r, reason: null, redFlags: null, tokens: null } : r))
    } else if (verify.length) {
      const drop = new Set(verify.slice(0, Math.ceil(verify.length / 10)))
      stored.runs = stored.runs.filter((r) => !drop.has(r))
      slim = Math.max(0, slim - drop.size)
    } else if (stored.runs.length) {
      const drop = stored.runs.slice(0, Math.ceil(stored.runs.length / 10))
      const gone = new Set(drop.map((r) => `${r.modelKey}|${r.caseId}`))
      stored.runs = stored.runs.slice(drop.length)
      stored.ratings = stored.ratings.filter((r) => !gone.has(`${r.modelKey}|${r.caseId}`))
    } else break
    json = JSON.stringify(stored)
  }
  return json
}

export async function saveLab(lab) {
  if (!lab || lab.loadFailed) return false
  try {
    const stored = { ...lab, loadFailed: undefined, pairs: lab.pairs.slice(-MAX_PAIRS), runs: compactRuns(lab.runs), ratings: lab.ratings || [] }
    await AsyncStorage.setItem(KEY, fitInStorage(stored))
    return true
  } catch {
    return false
  }
}
