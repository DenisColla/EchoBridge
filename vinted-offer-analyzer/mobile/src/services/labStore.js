import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * The AI lab's data on the phone: labelled pairs (reference listing + candidate from a search), model runs, blind
 * ratings and estimated spend per provider. API keys are NOT here (see secrets.js).
 */
const KEY = 'offerta-vinted.lab.v1'
const MAX_PAIRS = 400
const MAX_RUNS = 4000

export const emptyLab = () => ({ version: 1, pairs: [], runs: [], ratings: [], psychRuns: [], spend: {}, seed: Math.floor(Math.random() * 1e6) })

export async function loadLab() {
  let raw = null
  try {
    raw = await AsyncStorage.getItem(KEY)
    const lab = raw ? JSON.parse(raw) : null
    if (!lab || typeof lab !== 'object' || lab.version !== 1) return emptyLab()
    return { ...emptyLab(), ...lab }
  } catch {
    if (raw) await AsyncStorage.setItem(`${KEY}.corrupt.${Date.now()}`, raw).catch(() => {})
    return emptyLab()
  }
}

export async function saveLab(lab) {
  try {
    const trimmed = { ...lab, pairs: lab.pairs.slice(-MAX_PAIRS), runs: lab.runs.slice(-MAX_RUNS) }
    await AsyncStorage.setItem(KEY, JSON.stringify(trimmed))
    return true
  } catch {
    return false
  }
}
