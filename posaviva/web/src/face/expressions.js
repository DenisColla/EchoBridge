// Facial expressions: presets as unit-weight dictionaries over the 34 MakeHuman
// expression morph units (app.model.expressionUnits), "fine" controls (macro
// sliders mapped to units) and the composition rule.
//
// Unit notes (measured with close-up renders, f_normal / m_normal):
//   eye-*-closure        lid closes completely at 1 (left = character's left, +X)
//   eye-*-opened-up      upper lid raised (wide eyes)
//   eye-*-slit           both lids narrow (squint / smiling eyes)
//   eyebrows-*-up        whole brow raised        eyebrows-*-down    brow lowered + knitted
//   eyebrows-*-inner-up  inner brow raised (worry / sadness)
//   eyebrows-*-extern-up outer brow raised
//   mouth-corner-puller  closed smile             mouth-upward-retraction  open smile, upper teeth
//   mouth-depression     corners down (frown)     mouth-depression-retraction  lower lip down, lower teeth
//   mouth-elevation      upper lip raised (snarl) mouth-eversion   pout (lips everted)
//   mouth-open           jaw open                 mouth-parling    lips slightly parted
//   mouth-part-later     wide lateral opening (grimace, shout)
//   mouth-protusion      lips pushed forward, open ("oo")   mouth-pursing  kiss pucker
//   mouth-compression    lips pressed together    mouth-retraction lips stretched wide, closed
//   neck-platysma        neck cords + corners pulled down (strain, fear)
//   nose-*-elevation     nostril / upper lip raise on one side (sneer)
//   nose-*-dilatation    nostril flare            nose-compression / nose-depression  subtle
// Mouth units are symmetric; asymmetry comes from eyes, brows and nose.
// Negative weights mostly break the mesh: presets stay in [0, 1].

/** Presets: id, Italian label, unit weights at 100% intensity. */
export const PRESETS = [
  // lips meet only with some compression: below ~0.4 the upper teeth show through the lip line
  { id: 'neutral', label: 'Neutro', w: { 'mouth-compression': 0.45 } },
  { id: 'smile', label: 'Sorriso', w: { 'mouth-corner-puller': 0.85, 'mouth-compression': 0.3, 'eye-left-slit': 0.18, 'eye-right-slit': 0.18, 'eyebrows-left-up': 0.12, 'eyebrows-right-up': 0.12 } },
  {
    id: 'laugh', label: 'Risata', w: {
      'mouth-upward-retraction': 0.85, 'mouth-open': 0.38, 'mouth-corner-puller': 0.55, 'eye-left-slit': 0.6, 'eye-right-slit': 0.6,
      'eyebrows-left-up': 0.3, 'eyebrows-right-up': 0.3, 'nose-left-elevation': 0.25, 'nose-right-elevation': 0.25,
    },
  },
  {
    id: 'happy', label: 'Felice', w: {
      'mouth-upward-retraction': 0.55, 'mouth-corner-puller': 0.5, 'eye-left-slit': 0.3, 'eye-right-slit': 0.3,
      'eyebrows-left-up': 0.35, 'eyebrows-right-up': 0.35,
    },
  },
  {
    id: 'sad', label: 'Triste', w: {
      'mouth-depression': 0.75, 'mouth-compression': 0.4, 'eyebrows-left-inner-up': 0.85, 'eyebrows-right-inner-up': 0.85,
      'eye-left-slit': 0.2, 'eye-right-slit': 0.2,
    },
  },
  {
    id: 'cry', label: 'Disperato', w: {
      'eyebrows-left-inner-up': 1, 'eyebrows-right-inner-up': 1, 'eye-left-slit': 0.6, 'eye-right-slit': 0.6,
      'mouth-depression-retraction': 0.55, 'mouth-depression': 0.6, 'mouth-open': 0.22, 'neck-platysma': 0.35,
      'nose-left-elevation': 0.3, 'nose-right-elevation': 0.3,
    },
  },
  {
    id: 'angry', label: 'Arrabbiato', w: {
      'eyebrows-left-down': 1, 'eyebrows-right-down': 1, 'eye-left-slit': 0.25, 'eye-right-slit': 0.25,
      'mouth-compression': 0.55, 'mouth-depression': 0.3, 'nose-left-dilatation': 0.6, 'nose-right-dilatation': 0.6,
      'nose-left-elevation': 0.2, 'nose-right-elevation': 0.2,
    },
  },
  {
    id: 'rage', label: 'Furioso', w: {
      'eyebrows-left-down': 1, 'eyebrows-right-down': 1, 'eye-left-opened-up': 0.25, 'eye-right-opened-up': 0.25,
      'mouth-open': 0.6, 'mouth-part-later': 0.55, 'mouth-elevation': 0.45, 'neck-platysma': 0.6,
      'nose-left-elevation': 0.3, 'nose-right-elevation': 0.3, 'nose-left-dilatation': 0.5, 'nose-right-dilatation': 0.5,
    },
  },
  {
    id: 'surprised', label: 'Sorpreso', w: {
      'eyebrows-left-up': 1, 'eyebrows-right-up': 1, 'eye-left-opened-up': 0.85, 'eye-right-opened-up': 0.85,
      'mouth-open': 0.35, 'mouth-parling': 0.3,
    },
  },
  {
    id: 'scared', label: 'Spaventato', w: {
      'eyebrows-left-inner-up': 0.85, 'eyebrows-right-inner-up': 0.85, 'eyebrows-left-up': 0.55, 'eyebrows-right-up': 0.55,
      'eye-left-opened-up': 1, 'eye-right-opened-up': 1, 'mouth-depression-retraction': 0.6, 'mouth-open': 0.18,
      'mouth-retraction': 0.3, 'neck-platysma': 0.55,
    },
  },
  {
    id: 'disgust', label: 'Disgustato', w: {
      'nose-left-elevation': 0.55, 'nose-right-elevation': 0.55, 'mouth-elevation': 0.55, 'mouth-depression': 0.35,
      'eyebrows-left-down': 0.55, 'eyebrows-right-down': 0.55, 'eye-left-slit': 0.35, 'eye-right-slit': 0.35,
    },
  },
  {
    id: 'contempt', label: 'Sprezzante', w: {
      'nose-left-elevation': 0.7, 'mouth-corner-puller': 0.35, 'mouth-compression': 0.45,
      'eyebrows-left-up': 0.6, 'eyebrows-right-down': 0.4, 'eye-right-slit': 0.4, 'eye-left-slit': 0.1,
    },
  },
  {
    id: 'thinking', label: 'Pensieroso', w: {
      'eyebrows-left-up': 0.35, 'eyebrows-right-down': 0.4, 'eyebrows-right-inner-up': 0.25,
      'eye-left-slit': 0.15, 'eye-right-slit': 0.3, 'mouth-compression': 0.45, 'mouth-pursing': 0.2,
    },
  },
  {
    id: 'sleepy', label: 'Assonnato', w: {
      'eye-left-closure': 0.62, 'eye-right-closure': 0.62, 'eyebrows-left-up': 0.2, 'eyebrows-right-up': 0.2, 'mouth-parling': 0.35,
    },
  },
  {
    id: 'wink', label: 'Occhiolino', w: {
      'eye-left-closure': 1, 'mouth-corner-puller': 0.7, 'mouth-compression': 0.3, 'eyebrows-left-down': 0.35, 'eyebrows-right-up': 0.3,
      'nose-left-elevation': 0.3, 'eye-right-slit': 0.12,
    },
  },
  {
    id: 'determined', label: 'Determinato', w: {
      'eyebrows-left-down': 0.65, 'eyebrows-right-down': 0.65, 'eye-left-slit': 0.3, 'eye-right-slit': 0.3,
      'mouth-compression': 0.65, 'mouth-retraction': 0.25,
    },
  },
  {
    id: 'shy', label: 'Imbarazzato', w: {
      'eyebrows-left-inner-up': 0.6, 'eyebrows-right-inner-up': 0.6, 'mouth-corner-puller': 0.38, 'mouth-compression': 0.35,
      'eye-left-slit': 0.25, 'eye-right-slit': 0.25,
    },
  },
  {
    id: 'kiss', label: 'Bacio', w: {
      // full pursing alone pushes out a blocky lower lip and shows the teeth: pressed lips read as a kiss
      'mouth-pursing': 0.8, 'mouth-compression': 0.35, 'eye-left-closure': 0.55, 'eye-right-closure': 0.55, 'eyebrows-left-inner-up': 0.25, 'eyebrows-right-inner-up': 0.25,
    },
  },
  {
    id: 'bored', label: 'Annoiato', w: {
      'eye-left-closure': 0.38, 'eye-right-closure': 0.38, 'mouth-depression': 0.3, 'mouth-compression': 0.4,
      'eyebrows-left-up': 0.1, 'eyebrows-right-up': 0.1,
    },
  },
  {
    id: 'pain', label: 'Dolore', w: {
      'eyebrows-left-inner-up': 0.7, 'eyebrows-right-inner-up': 0.7, 'eyebrows-left-down': 0.5, 'eyebrows-right-down': 0.5,
      'eye-left-slit': 0.75, 'eye-right-slit': 0.75, 'mouth-part-later': 0.5, 'mouth-elevation': 0.35,
      'nose-left-elevation': 0.3, 'nose-right-elevation': 0.3, 'neck-platysma': 0.45,
    },
  },
];

export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

/**
 * Fine controls ("Ritocchi"), grouped. Each maps a slider value v to unit
 * weights: positive side `p`, optional negative side `n` (bipolar slider).
 */
export const FINE_GROUPS = [
  {
    label: 'Bocca', items: [
      { id: 'mouthOpen', label: 'Apertura', p: { 'mouth-open': 1 } },
      { id: 'smile', label: 'Sorriso', p: { 'mouth-corner-puller': 1 } },
      { id: 'grin', label: 'Mostra i denti', p: { 'mouth-upward-retraction': 0.8, 'mouth-corner-puller': 0.2 } },
      { id: 'cornersDown', label: 'Angoli giù', p: { 'mouth-depression': 1 } },
      { id: 'lipsOut', label: 'Labbra in fuori', p: { 'mouth-eversion': 0.75, 'mouth-pursing': 0.35 } },
      { id: 'lipsTight', label: 'Labbra strette', p: { 'mouth-compression': 1 } },
      { id: 'snarl', label: 'Ringhio', p: { 'mouth-elevation': 1 } },
    ],
  },
  {
    label: 'Occhi', note: 'sinistro / destro del personaggio', items: [
      { id: 'closeL', label: 'Chiudi sinistro', p: { 'eye-left-closure': 1 } },
      { id: 'closeR', label: 'Chiudi destro', p: { 'eye-right-closure': 1 } },
      { id: 'squint', label: 'Socchiudi', p: { 'eye-left-slit': 1, 'eye-right-slit': 1 } },
      { id: 'wide', label: 'Spalanca', p: { 'eye-left-opened-up': 1, 'eye-right-opened-up': 1 } },
    ],
  },
  {
    label: 'Sopracciglia', items: [
      { id: 'browsUp', label: 'Su / giù', min: -1, p: { 'eyebrows-left-up': 1, 'eyebrows-right-up': 1 }, n: { 'eyebrows-left-down': 0.7, 'eyebrows-right-down': 0.7 } },
      { id: 'browsInner', label: 'Interno su', p: { 'eyebrows-left-inner-up': 1, 'eyebrows-right-inner-up': 1 } },
      { id: 'browsOuter', label: 'Esterno su', p: { 'eyebrows-left-extern-up': 1, 'eyebrows-right-extern-up': 1 } },
      { id: 'browsFrown', label: 'Aggrottate', p: { 'eyebrows-left-down': 1, 'eyebrows-right-down': 1, 'nose-compression': 0.3 } },
    ],
  },
  {
    label: 'Naso e collo', items: [
      { id: 'noseWrinkle', label: 'Naso arricciato', p: { 'nose-left-elevation': 1, 'nose-right-elevation': 1, 'nose-compression': 0.3 } },
      { id: 'nostrils', label: 'Narici dilatate', p: { 'nose-left-dilatation': 1, 'nose-right-dilatation': 1 } },
      { id: 'neck', label: 'Collo teso', p: { 'neck-platysma': 1 } },
    ],
  },
];

export const FINE_BY_ID = new Map(FINE_GROUPS.flatMap((g) => g.items).map((it) => [it.id, it]));

/** left <-> right unit name. */
export function mirrorUnit(u) {
  if (u.includes('-left')) return u.replace('-left', '-right');
  if (u.includes('-right')) return u.replace('-right', '-left');
  return u;
}

/** Lid units added at full down / up free gaze (lids follow the eyeballs). */
const LID_DOWN = { 'eye-left-closure': 0.36, 'eye-right-closure': 0.36 };
// the MakeHuman upper lid retracts little: a strong coupling keeps the iris visible when looking up
const LID_UP = { 'eye-left-opened-up': 0.55, 'eye-right-opened-up': 0.55 };

/** Core limits of a unit weight (Character.setExpression clamps to [-1, 1.5]). */
const W_MIN = -1, W_MAX = 1.5;

/**
 * Final unit weights for a face state {preset, intensity, fine, mirror}:
 * preset * intensity (left/right swapped when `mirror`) + fine controls (never
 * mirrored: "Chiudi sinistro" always means the character's left eye).
 * Deterministic (also used to detect whether ch.expression still matches).
 * autoGy: vertical gaze (-1..1) of the automatic modes ('Guarda la camera' /
 * 'Guarda un punto'), which is runtime state: the lids follow it like the free gaze.
 */
export function composeExpression(st, autoGy = null) {
  const out = {};
  const add = (dict, k, mirror) => { for (const [u, w] of Object.entries(dict)) { const key = mirror ? mirrorUnit(u) : u; out[key] = (out[key] || 0) + w * k; } };
  const p = PRESET_BY_ID.get(st.preset);
  if (p) add(p.w, st.intensity ?? 1, !!st.mirror);
  for (const [id, v] of Object.entries(st.fine || {})) {
    const f = FINE_BY_ID.get(id);
    if (!f || !v) continue;
    if (v > 0) add(f.p, v, false); else if (f.n) add(f.n, -v, false);
  }
  // lid-gaze coupling: the upper lids follow the eyes down / up
  const auto = st.lookAtCamera || st.lookAt;
  const gy = auto ? (typeof autoGy === 'number' ? autoGy : 0) : Array.isArray(st.gaze) ? st.gaze[1] || 0 : 0;
  if (gy < 0) add(LID_DOWN, -gy, false); else if (gy > 0) add(LID_UP, gy, false);
  const res = {};
  for (const [u, w] of Object.entries(out)) {
    const max = u.includes('closure') ? 1 : W_MAX; // a lid closes completely at 1
    const c = Math.round(Math.max(W_MIN, Math.min(max, w)) * 1000) / 1000;
    if (Math.abs(c) >= 0.004) res[u] = c;
  }
  return res;
}

/** true if a preset has left/right asymmetric units ("Inverti lati" makes sense). */
export function isAsymmetric(presetId) {
  const p = PRESET_BY_ID.get(presetId);
  if (!p) return false;
  for (const [u, w] of Object.entries(p.w)) if (Math.abs((p.w[mirrorUnit(u)] || 0) - w) > 1e-6) return true;
  return false;
}

/** true if two unit-weight dictionaries are equal (within rounding). */
export function sameWeights(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) if (Math.abs((a?.[k] || 0) - (b?.[k] || 0)) > 0.002) return false;
  return true;
}
