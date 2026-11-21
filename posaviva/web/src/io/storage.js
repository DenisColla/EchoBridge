// localStorage helpers that never throw (private mode, quota, corrupted JSON)
// plus the persisted UI settings.
import { setHapticsEnabled } from '../ui/kit.js';

/** True for every browser flavour of "storage full". */
export function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

export const store = {
  getRaw(key) { try { return localStorage.getItem(key); } catch { return null; } },
  get(key, fallback = null) {
    const s = this.getRaw(key);
    if (s === null || s === undefined) return fallback;
    try { return JSON.parse(s); } catch { return fallback; }
  },
  /** -> {ok:true} | {ok:false, quota:boolean, error} */
  setRaw(key, str) {
    try { localStorage.setItem(key, str); return { ok: true }; }
    catch (error) { return { ok: false, quota: isQuotaError(error), error }; }
  },
  set(key, value) { return this.setRaw(key, JSON.stringify(value)); },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  /** Approximate bytes used by PosaViva keys (UTF-16: 2 bytes per char). */
  usage(prefix = 'posaviva.') {
    let n = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) n += (k.length + (localStorage.getItem(k) || '').length) * 2;
      }
    } catch { /* ignore */ }
    return n;
  },
};

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const SETTINGS_KEY = 'posaviva.settings';
const DEFAULTS = { haptics: true, tips: true, quality: null, tipsSeen: {} };

/** Persisted UI preferences. Fires 'change' {key, value}. */
export class Settings extends EventTarget {
  constructor() {
    super();
    this.values = { ...DEFAULTS, ...(store.get(SETTINGS_KEY, {}) || {}) };
    if (typeof this.values.tipsSeen !== 'object' || !this.values.tipsSeen) this.values.tipsSeen = {};
    setHapticsEnabled(this.values.haptics !== false);
  }
  get(k) { return this.values[k]; }
  set(k, v) {
    this.values[k] = v;
    store.set(SETTINGS_KEY, this.values);
    if (k === 'haptics') setHapticsEnabled(v !== false);
    const e = new Event('change'); e.key = k; e.value = v;
    this.dispatchEvent(e);
  }
}
