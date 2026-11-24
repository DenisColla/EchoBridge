// Preset registry + resolution of a free spec ({preset?, place?, time?, weather?,
// season?, density?, features?}) into a complete, seeded description.
import { CITY } from './city.js';
import { NATURE } from './nature.js';
import { FANTASY } from './fantasy.js';
import { ROOMS } from './rooms.js';
import { makeRng, clamp } from '../rand.js';
import { TIMES, WEATHERS, SEASONS } from '../atmos.js';

export const GROUPS = [
  { id: 'citta', label: 'Città' },
  { id: 'natura', label: 'Natura' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'stanze', label: 'Stanze' },
];
export const PRESETS = [...CITY, ...NATURE, ...FANTASY, ...ROOMS];
export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

const DEF_TIMES = { alba: 1, mattino: 3, mezzogiorno: 2, tramonto: 2.2, sera: 1.2, notte: 1.2 };
const DEF_WEATHERS = { sereno: 5, nuvoloso: 2.2, pioggia: 1, neve: 0.5, nebbia: 0.8 };
const DEF_SEASONS = { primavera: 1, estate: 1.3, autunno: 1.1, inverno: 0.7 };

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Italian synonyms -> canonical ids. */
const SYN = {
  time: { alba: 'alba', aurora: 'alba', 'primo mattino': 'alba', mattina: 'mattino', mattino: 'mattino', giorno: 'mezzogiorno', mezzogiorno: 'mezzogiorno', mezzodi: 'mezzogiorno', pomeriggio: 'mattino', tramonto: 'tramonto', crepuscolo: 'sera', sera: 'sera', serata: 'sera', imbrunire: 'sera', notte: 'notte', notturno: 'notte', mezzanotte: 'notte', buio: 'notte' },
  weather: { sereno: 'sereno', sole: 'sereno', soleggiato: 'sereno', limpido: 'sereno', nuvoloso: 'nuvoloso', nuvole: 'nuvoloso', coperto: 'nuvoloso', pioggia: 'pioggia', piove: 'pioggia', piovoso: 'pioggia', temporale: 'pioggia', tempesta: 'pioggia', neve: 'neve', nevica: 'neve', innevato: 'neve', nebbia: 'nebbia', foschia: 'nebbia', nebbioso: 'nebbia' },
  season: { primavera: 'primavera', primaverile: 'primavera', estate: 'estate', estivo: 'estate', autunno: 'autunno', autunnale: 'autunno', inverno: 'inverno', invernale: 'inverno' },
};
export function canon(kind, v) {
  if (v === null || v === undefined || v === '') return null;
  const s = norm(v);
  const list = kind === 'time' ? TIMES : kind === 'weather' ? WEATHERS : SEASONS;
  if (list.some((x) => x.id === s)) return s;
  if (SYN[kind][s]) return SYN[kind][s];
  for (const [k, id] of Object.entries(SYN[kind])) if (s.includes(k)) return id;
  return null;
}

/** Best preset for a free Italian keyword (place / features), or null. */
export function matchPreset(text, { rooms = true } = {}) {
  const q = norm(text);
  if (!q) return null;
  const words = q.split(/[\s,;.]+/).filter((w) => w.length > 2);
  let best = null, bestScore = 0;
  for (const p of PRESETS) {
    if (!rooms && p.group === 'stanze') continue;
    const label = norm(p.label), tags = p.tags.map(norm);
    let score = 0;
    if (q === label || q === p.id) score += 10;
    if (label.includes(q) || q.includes(label)) score += 5;
    for (const w of words) {
      for (const t of tags) {
        if (t === w) score += 3;
        else if (t.startsWith(w.slice(0, Math.max(4, w.length - 2))) || w.startsWith(t.slice(0, Math.max(4, t.length - 1)))) score += 1.5;
        else if (t.includes(' ') && t.includes(w)) score += 1;
      }
      if (label.includes(w)) score += 2;
    }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return bestScore >= 1.5 ? best : null;
}

/** Plain-data sanitized copy of a user / voice spec. */
export function cleanSpec(spec = {}) {
  const o = {};
  if (spec.preset && PRESET_BY_ID.has(spec.preset)) o.preset = spec.preset;
  else if (spec.preset) o.place = String(spec.preset);
  if (spec.place) o.place = String(spec.place).slice(0, 120);
  for (const k of ['time', 'weather', 'season']) { const c = canon(k, spec[k]); if (c) o[k] = c; }
  if (spec.density !== undefined && spec.density !== null && Number.isFinite(+spec.density)) o.density = clamp(+spec.density, 0, 1);
  if (Array.isArray(spec.features) && spec.features.length) o.features = spec.features.map((f) => String(f).slice(0, 40)).slice(0, 12);
  if (Number.isFinite(+spec.seed) && spec.seed !== null && spec.seed !== undefined) o.seed = Math.max(1, Math.floor(+spec.seed)) % 1e9;
  return o;
}

/**
 * Deterministic resolution: the same (spec, seed) always gives the same result.
 * Returns {preset, time, weather, season, density, variant, features, place}.
 */
export function resolve(spec, seed) {
  const rng = makeRng(seed);
  const pr = rng.fork('preset'), ar = rng.fork('atmo');
  // place keywords may also carry time / weather / season words ("spiaggia al tramonto")
  const placeText = [spec.place, ...(spec.features || [])].filter(Boolean).join(' ');
  let preset = spec.preset ? PRESET_BY_ID.get(spec.preset) : null;
  if (!preset && placeText) preset = matchPreset(placeText);
  const randomPick = pr.pick(PRESETS.filter((p) => p.group !== 'stanze'));
  if (!preset) preset = randomPick;
  const words = norm(placeText).split(/\s+/);
  const fromText = (kind) => { for (const w of words) { const c = canon(kind, w); if (c && SYN[kind][w]) return c; } return null; };
  const tW = { ...DEF_TIMES, ...(preset.times || {}) }, wW = { ...DEF_WEATHERS, ...(preset.weathers || {}) }, sW = { ...DEF_SEASONS, ...(preset.seasons || {}) };
  const time = spec.time || fromText('time') || ar.weighted(tW);
  let season = spec.season || fromText('season');
  let weather = spec.weather || fromText('weather');
  // coherence between the free choices
  if (!weather && season === 'inverno') wW.neve = (wW.neve || 0) * 4 + 0.5;
  if (!weather && season === 'estate') wW.neve = 0;
  if (!weather) weather = ar.weighted(wW);
  else ar();
  if (!season) {
    if (weather === 'neve') season = 'inverno';
    else { const sw = { ...sW }; if (weather === 'neve') sw.estate = 0; season = ar.weighted(sw); }
  } else ar();
  const density = spec.density ?? +ar.range(0.4, 0.85).toFixed(2);
  const variant = Math.floor(ar() * (preset.variants || 1));
  return { preset: preset.id, time, weather, season, density, variant, features: spec.features || [], place: spec.place || null };
}

/** Public list for the API / UI. */
export function publicPresets() {
  return PRESETS.map((p) => ({ id: p.id, label: p.label, group: p.group, tags: [...p.tags] }));
}
