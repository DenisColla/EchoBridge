// Parameter descriptors of prop types (they drive the editor) and small helpers
// shared by the procedural generators.
//   range / int: slider, seg: segmented choice, toggle, seed: hidden random seed
//   shown as a "Rigenera" button (new random variant).

export const range = (id, label, min, max, step, def, unit = 'm') => ({ id, type: 'range', label, min, max, step, default: def, unit });
export const int = (id, label, min, max, def) => ({ id, type: 'int', label, min, max, step: 1, default: def, unit: '' });
export const seg = (id, label, options, def) => ({ id, type: 'seg', label, options: options.map((o) => (Array.isArray(o) ? { value: o[0], label: o[1] } : o)), default: def });
export const flag = (id, label, def) => ({ id, type: 'toggle', label, default: def });
export const seed = (def = 1) => ({ id: 'seed', type: 'seed', label: 'Variante', default: def });

/** Deterministic random generator (mulberry32) from an integer seed: rng() in [0, 1). */
export function rng(seedValue) {
  let a = (seedValue | 0) + 0x6d2b79f5;
  const r = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  r.chance = (p) => r() < p;
  return r;
}

/** A new random seed (for "Rigenera"). */
export const newSeed = () => 1 + Math.floor(Math.random() * 999999);
