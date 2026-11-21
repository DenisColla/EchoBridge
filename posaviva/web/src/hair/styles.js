// Hairstyle catalog and recipes. Each recipe receives a HairBuilder (build.js)
// and grows clumps / caps / special parts with style-specific flow fields.
// Directions are unit vectors from the head centre: +X = character's left,
// +Y up, +Z front. Lengths are meters on the f_normal head (scaled per head).
import { smoothstep, lerp, rotate3, DEG, len2, len3 } from './util.js';
import { DETAIL_WAVE, DETAIL_CURL } from './strands.js';
import { elevation } from './scalp.js';

/**
 * Style catalog (order = panel order).
 * part: default parting (null = not applicable); length / volume: sliders meaningful; bangs: "Frangia" available;
 * material: optional overrides of the hair material spec.
 */
export const STYLES = [
  { id: 'nessuno', label: 'Nessuno', part: null, length: false, volume: false },
  { id: 'rasato', label: 'Rasato', part: null, length: false, volume: true },
  { id: 'corti_classici', label: 'Corti classici', part: 'left', length: true, volume: true },
  { id: 'corti_spettinati', label: 'Corti spettinati', part: null, length: true, volume: true },
  { id: 'undercut', label: 'Undercut', part: 'left', length: true, volume: true },
  { id: 'pompadour', label: 'Pompadour', part: null, length: true, volume: true },
  { id: 'caschetto', label: 'Caschetto', part: 'left', length: true, volume: true, bangs: true },
  { id: 'lunghi_lisci', label: 'Lunghi lisci', part: 'center', length: true, volume: true, bangs: true },
  { id: 'lunghi_mossi', label: 'Lunghi mossi', part: 'left', length: true, volume: true, bangs: true },
  { id: 'ricci', label: 'Ricci', part: 'center', length: true, volume: true, bangs: true },
  { id: 'afro', label: 'Afro', part: null, length: false, volume: true, material: { sheen: 0.3, roughness: 0.62 } },
  { id: 'coda', label: 'Coda di cavallo', part: null, length: true, volume: true, bangs: true },
  { id: 'chignon', label: 'Chignon', part: null, length: true, volume: true, bangs: true },
  { id: 'treccia', label: 'Treccia', part: null, length: true, volume: true, bangs: true },
  { id: 'codini', label: 'Due codini', part: null, length: true, volume: true, bangs: true },
  { id: 'cresta', label: 'Cresta', part: null, length: true, volume: true },
  { id: 'raccolti', label: 'Raccolti corti', part: null, length: true, volume: true, bangs: true },
];
export const STYLE_BY_ID = new Map(STYLES.map((s) => [s.id, s]));

const W_CROWN = [0.06, 0.74, -0.67]; // natural whorl (crown, back-top)

/** Comb direction radiating from the crown whorl, "away from the part" on the top front. */
function partFlow(b, u, xp, out, opts = {}) {
  const wp = smoothstep(-0.5, -0.05, u[2]) * smoothstep(0.3, 0.58, u[1]);
  // at the front hairline the hair right beside the part falls forward instead of
  // parting sideways: a sideways V there opened a square notch of bare forehead
  // between the swept clumps (seen from the front and in 3/4 views)
  const fc = smoothstep(0.5, 0.78, u[2]) * (1 - smoothstep(0.01, 0.085, Math.abs(u[0] - xp)));
  const side = (u[0] - xp >= 0 ? 1 : -1) * (1 - 0.82 * fc);
  const w = opts.whorl || W_CROWN;
  let rx = u[0] - w[0], ry = u[1] - w[1], rz = u[2] - w[2];
  const rl = len3(rx, ry, rz) || 1;
  // the whorl only rules close to the crown; elsewhere hair is combed down (and back on the back half)
  const near = Math.exp(-(rl * rl) / 0.1) * 0.9 * (1 - wp);
  rx /= rl; ry /= rl; rz /= rl;
  const down = opts.down ?? 0.5, back = smoothstep(0.15, -0.35, u[2]) * (1 - wp) * 0.5;
  return b.tan(out, u, side * wp + rx * near, ry * near - down, (opts.zTop ?? -0.05) * wp + rz * near - back);
}

/**
 * Hanging direction: down; face-framing roots (front of the ears) slightly forward,
 * the rest backward (more for side roots, so hair falls behind the shoulders).
 */
function hangDir(b, front = 0.22, back = 0.6) {
  const sy = b.c[1] - 0.2 * b.s; // shoulder line: the bias only steers the hair past the shoulders
  const nx = 0.07 * b.s; // beyond the neck, hair falls slightly inwards (around the neck, not onto the arms)
  return (p, out, root) => {
    const u = root.u, k = smoothstep(sy - 0.06 * b.s, sy + 0.03 * b.s, p[1]);
    const inward = Math.abs(p[0]) > nx ? -Math.sign(p[0]) * 0.14 * k : 0;
    if (u[2] > front) { out[0] = inward; out[1] = -1; out[2] = 0.3 * k; return; }
    // back hair beside the neck must pass behind the shoulders
    const sideK = smoothstep(0.02 * b.s, 0.07 * b.s, Math.abs(p[0]));
    out[0] = inward; out[1] = -1; out[2] = -(0.1 + back * sideK) * k;
  };
}
/** Which way a hanging strand falls off shoulders / arms: +1 front (face-framing roots), -1 back. */
const drapeSide = (front = 0.22) => (root) => (root.u[2] > front ? 1 : -1);

/** Tips of a bob curving under, towards the neck. */
function tipsUnder(b, amount) {
  const c = b.c, s = b.s;
  return (pts) => {
    const K = pts.length / 3;
    for (let k = 1; k < K; k++) {
      const t = k / (K - 1), w = Math.pow(smoothstep(0.72, 1, t), 1.6) * amount * s;
      if (!w) continue;
      let dx = c[0] - pts[k * 3], dz = c[2] - 0.012 * s - pts[k * 3 + 2];
      const l = len2(dx, dz) || 1;
      pts[k * 3] += (dx / l) * w; pts[k * 3 + 2] += (dz / l) * w; pts[k * 3 + 1] += w * 0.35;
    }
  };
}

/** Bangs zone on the forehead (unit direction test). */
const inBangs = (u) => u[2] > 0.42 && u[1] > 0.28 && Math.abs(u[0]) < 0.5;

/** Straight bangs combed forward over the forehead, blunt cut at brow height. */
function bangs(b) {
  const fr = b.frame, s = b.s;
  const m = b.mask();
  b.layer({
    mask: (u) => (inBangs(u) ? m(u) : -1), count: 70, K: 10, margin: 0.8, seed: 41,
    len: () => 0.16 * s,
    flow: (p, u, t, out) => b.tan(out, u, u[0] * 0.25, -0.6, 1),
    lift: 0.25, stiff: 0.45, hug: true, h0: 0.004, hk: 0.05, hMax: 0.01, rigid: true,
    clip: { y: (r) => fr.eyeY + (0.021 + 0.01 * Math.abs(r.u[0])) * s },
    width: 1.25, flat: 0.32, taper0: 0.9, tipW: 0.55, bias: 0.7,
  });
}
/** Root filter for the main layer when bangs are on. */
const noBangs = (b) => (b.state.bangs ? (u) => !inBangs(u) : null);

export const RECIPES = {
  nessuno() {},

  rasato(b) {
    b.cap(lerp(0.0012, 0.0045, b.state.volume));
  },

  corti_classici(b) {
    b.cap(0.0016);
    const xp = b.partX, m = b.mask();
    b.layer({
      mask: m, count: 460, K: 8,
      len: (u) => {
        const top = smoothstep(0, 52, elevation(u)), front = smoothstep(-0.2, 0.6, u[2]);
        return b.len(0.04, 0.085) * lerp(0.3, 1, top) * lerp(1, 1.12, front * top);
      },
      flow: (p, u, t, out) => {
        const wp = smoothstep(-0.45, 0.05, u[2]) * smoothstep(0.38, 0.62, u[1]);
        const side = u[0] - xp >= 0 ? 1 : -1;
        return b.tan(out, u, side * 0.85 * wp, -0.25 - 0.6 * (1 - wp), -0.4 * wp - 0.8 * (1 - wp));
      },
      lift: (u) => 0.1 + 0.3 * smoothstep(0.4, 0.8, u[1]) * smoothstep(0, 0.6, u[2]),
      stiff: 0.35, h0: 0.0025, hk: 0.12, hMax: 0.011, hug: true, tipLift: (t) => 0.0012 * smoothstep(0.6, 1, t),
      width: 1.0, flat: 0.42, taper0: 0.45, tipW: 0.2, rigid: true, clip: { mask: m, margin: 2.5 },
    });
  },

  corti_spettinati(b) {
    b.cap(0.0018);
    const m = b.mask();
    b.layer({
      mask: m, count: 430, K: 9, seed: 3,
      len: (u, r) => b.len(0.045, 0.1) * lerp(0.4, 1, smoothstep(0, 50, elevation(u))) * (0.75 + 0.4 * r.r),
      flow: (p, u, t, out, r) => {
        const w = W_CROWN;
        b.tan(out, u, u[0] - w[0], u[1] - w[1] - 0.15, u[2] - w[2] + 0.45 * smoothstep(0.2, 0.7, u[2]));
        const l = len3(out[0], out[1], out[2]) || 1;
        out[0] /= l; out[1] /= l; out[2] /= l;
        return rotate3(out, u, (r.r2 - 0.5) * 1.5);
      },
      lift: (u, r) => 0.22 + 0.25 * r.r, stiff: 0.6, hug: true, h0: 0.003, hk: 0.13, hMax: 0.015,
      tipLift: (t, r) => 0.008 * smoothstep(0.35, 1, t) * (0.3 + r.r),
      width: 0.95, flat: 0.42, taper0: 0.3, tipW: 0.05, rigid: true, clip: { mask: m, margin: 4 },
    });
  },

  undercut(b) {
    b.cap(0.0011); // clipped sides and back
    const xp = b.partX, sweep = xp >= 0 ? -1 : 1;
    b.layer({
      mask: b.mask('top'), count: 260, K: 11, margin: 1,
      len: (u) => b.len(0.07, 0.15) * lerp(0.7, 1.05, smoothstep(-0.4, 0.6, u[2])),
      flow: (p, u, t, out) => b.tan(out, u, (u[0] - xp >= 0 ? 0.2 : -0.2) + sweep * 0.4, -0.05, -0.9),
      lift: (u) => 0.25 + 0.45 * smoothstep(0.3, 0.8, u[2]),
      height: (t, r) => {
        const f = smoothstep(0.25, 0.85, r.u[2]);
        return 0.004 + (0.006 + 0.03 * f) * smoothstep(0, 0.25, t) * (1 - 0.5 * smoothstep(0.4, 1, t));
      },
      hug: true, stiff: 0.5, width: 1.05, flat: 0.38, taper0: 0.5, tipW: 0.12, rigid: true,
    });
  },

  pompadour(b) {
    b.cap(0.0015);
    const m = b.mask();
    const top = (u) => Math.min(m(u), (0.42 - Math.abs(u[0])) / DEG, elevation(u) - 18);
    // short sides and back, combed back
    b.layer({
      mask: (u) => (top(u) > 0 ? -1 : m(u)), count: 300, K: 7, seed: 5,
      len: () => b.len(0.022, 0.04),
      flow: (p, u, t, out) => b.tan(out, u, 0, -0.3, -1),
      hug: true, h0: 0.002, hk: 0.08, hMax: 0.006, stiff: 0.3, lift: 0.1, rigid: true,
      width: 1.0, flat: 0.45, taper0: 0.5, tipW: 0.25, clip: { mask: m, margin: 3 },
    });
    // big front roll swept back
    b.layer({
      mask: top, count: 220, K: 13, margin: 0.5, seed: 9,
      len: (u) => b.len(0.1, 0.17) * lerp(0.75, 1.05, smoothstep(-0.3, 0.7, u[2])),
      flow: (p, u, t, out) => b.tan(out, u, -u[0] * 0.35, 0.05, -1),
      lift: (u) => 0.3 + 0.4 * smoothstep(0.3, 0.8, u[2]),
      height: (t, r) => {
        const f = smoothstep(0.15, 0.85, r.u[2]);
        return 0.005 + (0.008 + 0.045 * f) * smoothstep(0, 0.22, t) * (1 - 0.65 * smoothstep(0.35, 1, t));
      },
      hug: true, stiff: 0.55, width: 1.05, flat: 0.38, taper0: 0.55, tipW: 0.15, rigid: true,
    });
  },

  caschetto(b) {
    b.cap(0.0015);
    const xp = b.partX, fr = b.frame, s = b.s;
    if (b.state.bangs) bangs(b);
    const cut = lerp(fr.mouth.y + 0.004 * s, fr.chin.y - 0.035 * s, b.state.length);
    b.layer({
      mask: b.mask(), count: 370, K: 16, filter: noBangs(b),
      len: () => 0.34 * s,
      flow: (p, u, t, out) => partFlow(b, u, xp, out, { down: 0.6 }),
      lift: 0.15, stiff: 0.55, hug: true, h0: 0.003, hk: 0.075, hMax: 0.02,
      hang: { y: 0.0, stiff: 0.85, dir: hangDir(b, 0.15, 0.15), drape: drapeSide(0.15) },
      clip: { y: (r) => cut - 0.016 * s * Math.max(0, r.u[2]) },
      post: tipsUnder(b, 0.012),
      width: 1.0, flat: 0.3, taper0: 0.88, tipW: 0.5, spread: 0.35, bias: 0.75, samples: 18,
      dyn: { guides: 56, shapeNear: 0.3, shapeFar: 0.05, shapeSpan: 0.6, bend: 0.75 },
    });
  },

  lunghi_lisci(b) {
    b.cap(0.0015);
    const xp = b.partX;
    if (b.state.bangs) bangs(b);
    b.layer({
      mask: b.mask(), count: 360, K: 20, filter: noBangs(b),
      len: (u, r) => b.len(0.3, 0.62) * (0.95 + 0.07 * r.r),
      flow: (p, u, t, out) => partFlow(b, u, xp, out),
      lift: 0.14, stiff: 0.6, h0: 0.003, hk: 0.075, hMax: 0.018, hug: true,
      hang: { y: 0.02, stiff: 0.62, dir: hangDir(b), drape: drapeSide() },
      widthAt: (u) => 1 + 0.3 * smoothstep(0.1, 0.4, u[2]),
      width: 1.0, flat: 0.26, taper0: 0.8, tipW: 0.35, spread: 0.45, bias: 0.75,
      dyn: { guides: 80, shapeNear: 0.25, shapeFar: 0.01, bend: 0.2 },
    });
  },

  lunghi_mossi(b) {
    b.cap(0.0015);
    const xp = b.partX, s = b.s;
    if (b.state.bangs) bangs(b);
    b.layer({
      mask: b.mask(), count: 340, K: 22, filter: noBangs(b),
      len: (u, r) => b.len(0.28, 0.6) * (0.93 + 0.1 * r.r),
      flow: (p, u, t, out) => partFlow(b, u, xp, out),
      lift: 0.18, stiff: 0.6, h0: 0.0045, hk: 0.1, hMax: 0.026, hug: true,
      hang: { y: 0.02, stiff: 0.62, dir: hangDir(b), drape: drapeSide() },
      // waves start in phase at each clump's hang point (neighbouring clumps wave together)
      detail: (u, r, L) => {
        const start = L * (r.pin / 21) * 0.8, wl = 0.085 * s;
        return { type: DETAIL_WAVE, amp: 0.011 * s * b.V ** 0.5, wl, phase: -2 * Math.PI * (start / wl) + (r.r - 0.5) * 0.7, start, depth: 0.45 };
      },
      widthAt: (u) => 1 + 0.3 * smoothstep(0.1, 0.4, u[2]),
      width: 1.0, flat: 0.28, taper0: 0.78, tipW: 0.3, spread: 0.5, bias: 0.7, samples: 30,
      dyn: { guides: 80, shapeNear: 0.3, shapeFar: 0.02, bend: 0.25 },
    });
  },

  ricci(b) {
    b.cap(0.0018);
    const xp = b.partX, s = b.s;
    if (b.state.bangs) bangs(b);
    b.layer({
      mask: b.mask(), count: 250, K: 16, filter: noBangs(b),
      len: (u, r) => b.len(0.16, 0.42) * (0.85 + 0.25 * r.r),
      flow: (p, u, t, out) => partFlow(b, u, xp, out, { down: 0.4 }),
      lift: 0.3, stiff: 0.6, h0: 0.006, hk: 0.16, hMax: 0.04, hug: true,
      hang: { y: 0.0, stiff: 0.75, dir: (p, out, root) => { out[0] = Math.sign(root.u[0]) * 0.25; out[1] = -1; out[2] = root.u[2] > 0.2 ? 0.1 : -0.3; }, drape: drapeSide(0.2) },
      detail: (u, r, L) => ({ type: DETAIL_CURL, amp: 0.0095 * s, wl: 0.042 * s * (0.85 + 0.3 * r.r2), phase: r.r * 6.28, start: 0.02 * s, fade: true }),
      width: 0.82, flat: 0.6, taper0: 0.75, tipW: 0.25, spread: 0.3, bias: 0.4, samples: 44, sides: 5, rootW: 0.8,
      dyn: { guides: 64, shapeNear: 0.2, shapeFar: 0.015, shapeSpan: 0.35, bend: 0.6 },
    });
  },

  afro(b) {
    b.cap(0.0025);
    b.puffs({ mask: b.mask(), size: 0.075 * b.s * b.V, R: 0.019 * b.s, count: 420 });
  },

  coda(b) {
    b.cap(0.0014);
    const s = b.s;
    if (b.state.bangs) bangs(b);
    const G = b.point(b.dir(0, 0.6, -0.8), 0.012 * s);
    b.gathered({ mask: b.mask(), count: 320, targetOf: () => G, filter: noBangs(b) });
    const d0 = b.dir(0, 0.15, -1);
    b.tie(G, d0, 0.011 * s);
    b.tail({ G: [G[0] + d0[0] * 0.004 * s, G[1] + d0[1] * 0.004 * s, G[2] + d0[2] * 0.004 * s], dir0: d0, L: b.len(0.22, 0.55), R: 0.0115 * s * b.V ** 0.5, count: 36, K: 18, flare: 1.1, stiff: 0.85 });
  },

  chignon(b) {
    b.cap(0.0014);
    const s = b.s, k = lerp(0.8, 1.25, b.state.length);
    if (b.state.bangs) bangs(b);
    const G = b.point(b.dir(0, 0.12, -1), 0.004 * s);
    b.gathered({ mask: b.mask(), count: 320, targetOf: () => G, filter: noBangs(b) });
    b.bun({ G, R1: 0.024 * s * k, R2: 0.019 * s * k * b.V ** 0.4, count: 8 });
  },

  treccia(b) {
    b.cap(0.0014);
    const s = b.s;
    if (b.state.bangs) bangs(b);
    const G = b.point(b.dir(0, -0.32, -0.95), 0.008 * s);
    b.gathered({ mask: b.mask(), count: 320, targetOf: () => G, filter: noBangs(b) });
    const d0 = b.dir(0, -0.55, -0.6);
    b.tie(G, d0, 0.012 * s);
    b.braid({ G, dir0: d0, L: b.len(0.22, 0.55), W: 0.0165 * s * b.V ** 0.5, K: 56 });
  },

  codini(b) {
    b.cap(0.0014);
    const s = b.s;
    if (b.state.bangs) bangs(b);
    const GL = b.point(b.dir(0.74, 0.32, -0.58), 0.01 * s), GR = b.point(b.dir(-0.74, 0.32, -0.58), 0.01 * s);
    b.gathered({ mask: b.mask(), count: 330, targetOf: (u) => (u[0] >= 0 ? GL : GR), filter: noBangs(b) });
    for (const [G, sg] of [[GL, 1], [GR, -1]]) {
      const d0 = b.dir(sg * 0.75, 0.1, -0.65);
      b.tie(G, d0, 0.0095 * s);
      b.tail({ G: [G[0] + d0[0] * 0.004 * s, G[1] + d0[1] * 0.004 * s, G[2] + d0[2] * 0.004 * s], dir0: d0, L: b.len(0.15, 0.42), R: 0.0098 * s * b.V ** 0.5, count: 26, K: 16, flare: 1.0, stiff: 0.85, seed: sg > 0 ? 11 : 12 });
    }
  },

  cresta(b) {
    b.cap(0.0011);
    const strip = b.mask('strip', { width: 0.17 });
    b.layer({
      mask: strip, count: 110, K: 8, margin: 0.5, volume: false,
      len: (u) => {
        const ph = Math.atan2(-u[2], u[1]); // front -> top -> back
        return b.len(0.05, 0.15) * (0.6 + 0.4 * Math.exp(-((ph - 0.25) ** 2) / 0.9)) * lerp(0.85, 1.2, b.state.volume);
      },
      flow: (p, u, t, out) => { out[0] = 0; out[1] = u[1] + 0.25; out[2] = u[2] - 0.45; return out; },
      lift: 0.85, stiff: 0.85, h0: 0.001, hk: 0, hMax: 0.001,
      axis: () => [1, 0, 0],
      width: 1.55, flat: 0.32, rootW: 1, taper0: 0.0, tipW: 0.03, bias: 0.25, rigid: true,
    });
  },

  raccolti(b) {
    b.cap(0.0014);
    const s = b.s;
    if (b.state.bangs) bangs(b);
    const G = b.point(b.dir(0, -0.42, -0.91), 0.008 * s);
    b.gathered({ mask: b.mask(), count: 320, targetOf: () => G, filter: noBangs(b) });
    const d0 = b.dir(0, -0.35, -0.94);
    b.tie(G, d0, 0.0105 * s);
    b.tail({ G: [G[0] + d0[0] * 0.004 * s, G[1] + d0[1] * 0.004 * s, G[2] + d0[2] * 0.004 * s], dir0: d0, L: b.len(0.05, 0.15), R: 0.0105 * s * b.V ** 0.5, count: 20, K: 9, flare: 0.8, stiff: 0.92, dyn: false, taper0: 0.3, tipW: 0.08 });
  },
};

