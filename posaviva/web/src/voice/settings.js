// Per-device preferences of the voice commands (never in the scene, never exported):
//   posaviva.voice          {lang: 'it-IT', mode: 'offline'|'hybrid', apiKey}
//   posaviva.voice.history  recent commands (strings, newest first)
const KEY = 'posaviva.voice', HKEY = 'posaviva.voice.history', MAX_HISTORY = 12;
const DEF = { lang: 'it-IT', mode: 'offline', apiKey: '' };

export function loadSettings() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return { ...DEF, ...(v && typeof v === 'object' ? v : {}) }; } catch { return { ...DEF }; }
}
export function saveSettings(s) {
  const v = { lang: 'it-IT', mode: s.mode === 'hybrid' ? 'hybrid' : 'offline', apiKey: String(s.apiKey || '').trim() };
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: kept for this session */ }
  return v;
}
export function loadHistory() {
  try { const v = JSON.parse(localStorage.getItem(HKEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_HISTORY) : []; } catch { return []; }
}
export function pushHistory(text) {
  const t = String(text || '').trim();
  const list = [t, ...loadHistory().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX_HISTORY);
  try { localStorage.setItem(HKEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}
export function clearHistory() { try { localStorage.removeItem(HKEY); } catch { /* ignore */ } }
