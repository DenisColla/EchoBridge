// Persistent per-character hair state (ch.data.hair) and colour presets.
import { STYLE_BY_ID } from './styles.js';

export const NATURAL_COLORS = [
  { id: 'nero', label: 'Nero', hex: '#15110f' },
  { id: 'castano_scuro', label: 'Castano scuro', hex: '#2e1d14' },
  { id: 'castano', label: 'Castano', hex: '#4a2f1d' },
  { id: 'castano_chiaro', label: 'Castano chiaro', hex: '#7a5434' },
  { id: 'biondo_scuro', label: 'Biondo scuro', hex: '#9b7442' },
  { id: 'biondo', label: 'Biondo', hex: '#d0aa68' },
  { id: 'ramato', label: 'Rosso ramato', hex: '#8c3a1c' },
  { id: 'grigio', label: 'Grigio', hex: '#8d8a86' },
  { id: 'bianco', label: 'Bianco', hex: '#dedad3' },
];
export const COMIC_COLORS = [
  { id: 'blu', label: 'Blu', hex: '#2b4fb8' },
  { id: 'rosa', label: 'Rosa', hex: '#e07aa8' },
  { id: 'viola', label: 'Viola', hex: '#6a3a9e' },
  { id: 'verde', label: 'Verde', hex: '#2f8a52' },
  { id: 'argento', label: 'Argento', hex: '#b9c0c8' },
];

export const BEARDS = [
  { id: 'nessuna', label: 'Nessuna' },
  { id: 'corta', label: 'Barba corta' },
  { id: 'piena', label: 'Barba piena' },
  { id: 'pizzetto', label: 'Pizzetto' },
  { id: 'baffi', label: 'Baffi' },
];
export const BEARD_IDS = new Set(BEARDS.map((b) => b.id));

/** Default hair of a new character. */
export function defaultState(ch) {
  const female = ch.sex === 'F';
  const style = female ? (ch.presetId === 'f_slim' ? 'caschetto' : 'lunghi_mossi') : 'corti_classici';
  const st = {
    style: STYLE_BY_ID.has(style) ? style : 'lunghi_lisci',
    color: female ? '#4a2f1d' : '#2e1d14',
    length: 0.5, volume: 0.5, parting: null, bangs: false, beard: 'nessuna',
  };
  st.parting = STYLE_BY_ID.get(st.style)?.part || 'center';
  return st;
}

/** Fills / clamps fields in place (old saves, hand-edited files). Returns st. */
export function normalizeState(st) {
  if (!STYLE_BY_ID.has(st.style)) st.style = 'corti_classici';
  if (typeof st.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(st.color)) st.color = '#4a2f1d';
  st.color = st.color.toLowerCase();
  for (const k of ['length', 'volume']) st[k] = Number.isFinite(st[k]) ? Math.min(1, Math.max(0, st[k])) : 0.5;
  if (!['left', 'center', 'right'].includes(st.parting)) st.parting = STYLE_BY_ID.get(st.style).part || 'center';
  st.bangs = !!st.bangs;
  if (!BEARD_IDS.has(st.beard)) st.beard = 'nessuna';
  return st;
}
