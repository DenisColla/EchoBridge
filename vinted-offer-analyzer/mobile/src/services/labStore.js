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

export async function saveLab(lab) {
  if (!lab || lab.loadFailed) return false
  try {
    const stored = { ...lab, loadFailed: undefined, pairs: lab.pairs.slice(-MAX_PAIRS), runs: compactRuns(lab.runs) }
    let json = JSON.stringify(stored)
    // Still too large (many pairs and long answers): drop the oldest runs until it fits.
    while (json.length > MAX_CHARS && stored.runs.length) {
      stored.runs = stored.runs.slice(Math.ceil(stored.runs.length / 10))
      json = JSON.stringify(stored)
    }
    await AsyncStorage.setItem(KEY, json)
    return true
  } catch {
    return false
  }
}
