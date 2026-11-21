// Birds: crow, pigeon, eagle, owl, macaw, hen. One parametric description
// (mkBird) in "crow units" (a crow-sized bird, meters), then scaled to the
// species' real size; species add their head features in extras.
import { bird } from './bird.js';
import { sstep, fbm, clamp01, stripes } from './coat.js';
import { V, mx } from './builder.js';
import { D2R } from './rot.js';

const tableLen = (t) => (f) => { const x = f * (t.length - 1), i = Math.min(t.length - 2, Math.floor(x)); return t[i] + (t[i + 1] - t[i]) * (x - i); };
const scaleFn = (fn, k) => (typeof fn === 'function' ? (f) => fn(f) * k : Array.isArray(fn) ? fn.map((x) => x * k) : fn * k);
const S3 = (a, k) => a.map((x) => x * k);

/**
 * Bird description from high-level proportions (crow = 1):
 * S size, tilt, bl/bw/bh body length/width/height, belly, breast, leg (length), legR, toe, hallux, claw,
 * nk (neck length), nr (neck thickness), hs (head size), es (eye size), beak {...}, wk (arm), ar (arm thickness),
 * pk/sk (primary / secondary length), pw (feather width), notch, tail {len, w, fan, taper}, tailAng, fold overrides
 */
function mkBird(p) {
  const S = p.S ?? 1;
  const bl = p.bl ?? 1, bw = p.bw ?? 1, bh = p.bh ?? 1, lk = p.leg ?? 1, lr = p.legR ?? 1, tk = p.toe ?? 1;
  const nk = p.nk ?? 1, nr = p.nr ?? 1, hs = p.hs ?? 1, wk = p.wk ?? 1;
  const tilt = p.tilt ?? 28;
  const ax = [0, Math.sin(tilt * D2R), Math.cos(tilt * D2R)], nu = [0, Math.cos(tilt * D2R), -Math.sin(tilt * D2R)];
  // legs
  const ball = [0.021 * bw, 0.009, 0.014];
  const hock = [0.022 * bw, ball[1] + 0.047 * lk, ball[2] - 0.032 * lk];
  const knee = [0.03 * bw, hock[1] + 0.039 * lk, hock[2] + 0.053 * lk];
  const hip = [0.026 * bw, knee[1] + 0.03 * bh, p.hipZ ?? 0];
  const c0 = [0, hip[1] + 0.018 * bh, 0.012 + (p.hipZ ?? 0)];
  const bp = (u, v, x = 0) => [x, c0[1] + ax[1] * u + nu[1] * v, c0[2] + ax[2] * u + nu[2] * v];
  const belly = p.belly ?? 1;
  const T = [[-0.095, 0.014, 0.016, 0.02], [-0.07, 0.03, 0.035, 0.036], [-0.03, 0.042, 0.05, 0.048], [0.015, 0.046, 0.056, 0.053], [0.055, 0.045, 0.054, 0.05], [0.088, 0.036, 0.042, 0.041], [0.11, 0.02, 0.024, 0.024]]
    .map(([u, ht, hb, w]) => [u * bl, ht * bh, hb * bh * belly, w * bw]);
  const N0 = bp(0.088 * bl, 0.036 * bh);
  const at = (dy, dz) => [0, N0[1] + dy, N0[2] + dz];
  const hc = at(0.0319 * nk + (p.headY ?? 0), 0.0202 + (p.headZ ?? 0));
  const neckTop = V.add(hc, p.neckTop ? S3(p.neckTop, hs) : [0, -0.009 * hs, -0.004 * hs]);
  const spec = {
    scale: S, height: 0, tilt,
    hip, torsoOff: [0.018 * bh, 0.012], torso: T, torsoCaps: p.torsoCaps,
    breast: [0.06 * bl, -0.012 * bh, [0.044 * bw * (p.breast ?? 1), 0.04 * bh * (p.breast ?? 1), 0.05 * bl], 0.02],
    neck: [
      [...at(-0.0261, -0.0108).slice(1), 0.03 * nr * bw],
      [...at(-0.0041 * nk, 0.0012).slice(1), 0.028 * nr],
      [...V.lerp(at(0.0159 * nk, 0.0072), neckTop, 0.3).slice(1), 0.025 * nr],
      [...neckTop.slice(1), Math.min(0.021 * nr * Math.max(1, hs * 0.85), (p.headR || [0.021])[0] * hs * (p.neckTopK ?? 0.82))],
    ],
    neckBones: [at(-0.0211, -0.0068), at(-0.0021 * nk, 0.0022), V.lerp(at(0.0149 * nk, 0.0072), hc, 0.25), V.add(hc, [0, -0.014 * hs, -0.006 * hs])],
    head: { c: hc, r: S3(p.headR || [0.021, 0.0225, 0.029], hs), pitch: p.headPitch ?? 6, throat: [0.004 * hs, -0.017 * hs, S3([0.016, 0.012, 0.02], hs)], crown: p.crown ? [p.crown[0] * hs, p.crown[1] * hs, S3(p.crown[2], hs)] : null, cheek: null },
    headK: (p.headK ?? 0.007) * hs,
    beak: { gapeA: 0.012 * hs, gapeB: -0.0075 * hs, ...p.beak },
    eye: { a: (p.eyeA ?? 0.006) * hs, b: (p.eyeB ?? 0.006) * hs, x: (p.eyeX ?? 0.019) * hs, r: 0.0062 * (p.es ?? hs), dir: p.eyeDir || [0.85, 0.14, 0.5], protrude: p.eyeProtrude, open: p.eyeOpen },
    leg: { knee, hock, ball, toe: [0.022 * bw, 0.005, ball[2] + 0.044 * tk], hallux: [0.018 * bw, 0.005, ball[2] - 0.036 * tk * (p.hallux ?? 1)], r: [0.0075 * lr * (p.shinR ?? 1), 0.0032 * lr, 0.0023 * lr * Math.sqrt(tk)], claw: 0.008 * (p.claw ?? 1), feathered: p.feathered, featheredToes: p.featheredToes, trousers: p.trousers, zygo: p.zygo, spread: p.toeSpread },
    wing: {
      shoulder: bp(0.055 * bl, 0.017 * bh, (p.shX ?? 0.034) * bw), hum: [0.062 * wk, 22], fore: [0.078 * wk, -8], hand: [0.064 * wk, 6],
      arm: { r: S3([0.011, 0.0088, 0.0065, 0.003], p.ar ?? 1), lead: 0.022 * wk },
      prim: { n: 10, len: scaleFn(p.primLen || tableLen([0.15, 0.158, 0.166, 0.176, 0.188, 0.2, 0.206, 0.204, 0.188, 0.12]), p.pk ?? 1), w: 0.034 * (p.pw ?? 1), ang: p.primAng || [96, 14], angPow: 0.9, notch: p.notch === undefined ? { from: 5, at: 0.55, k: 0.6 } : p.notch },
      sec: { n: 10, len: 0.14 * (p.sk ?? 1), w: 0.036 * (p.pw ?? 1), ang: [104, 86] },
      ter: { n: 3, len: [0.12, 0.11, 0.1].map((x) => x * (p.sk ?? 1)), w: 0.034 * (p.pw ?? 1), ang: [112, 104] },
      cov: { k: 0.42 }, pcov: { k: 0.32 },
      fold: { back: [0, -Math.sin((tilt - 5) * D2R), -Math.cos((tilt - 5) * D2R)], out: [1, 0.22, 0], fore: 14, hand: 6, sec: [-4, -18], prim: [-2, -6], ter: [4, -2], ...(p.fold || {}) },
      th: 0.0026,
    },
    tail: null,
    extras: p.extras || null,
  };
  const ta = (p.tailAng ?? tilt - 6) * D2R;
  const tl = p.tail || {};
  spec.tail = { axis: [0, -Math.sin(ta), -Math.cos(ta)], normal: [0, Math.cos(ta), -Math.sin(ta)], n: tl.n ?? 6, len: tl.len ?? ((f) => 0.19 - 0.025 * f * f), w: tl.w ?? 0.032, fan: tl.fan || [3, 28], close: tl.close ?? 1.2, taper: tl.taper || 0, tipRound: tl.tipRound, spread: 0.004 };
  return scaleSpec(spec, S);
}

/** Uniform scale of a bird description (lengths and positions; angles untouched). */
function scaleSpec(s, k) {
  const v3 = (a) => (a ? S3(a, k) : a);
  s.hip = v3(s.hip); s.torsoOff = v3(s.torsoOff);
  s.torso = s.torso.map((r) => S3(r, k));
  s.breast = [s.breast[0] * k, s.breast[1] * k, v3(s.breast[2]), s.breast[3] * k];
  s.neck = s.neck.map((r) => S3(r, k));
  s.neckBones = s.neckBones.map(v3);
  const H = s.head;
  H.c = v3(H.c); H.r = v3(H.r);
  H.throat = [H.throat[0] * k, H.throat[1] * k, v3(H.throat[2])];
  if (H.crown) H.crown = [H.crown[0] * k, H.crown[1] * k, v3(H.crown[2])];
  s.headK *= k;
  for (const key of ['gapeA', 'gapeB', 'len', 'h', 'w', 'lowH', 'k']) if (typeof s.beak[key] === 'number') s.beak[key] *= k;
  for (const key of ['a', 'b', 'x', 'r']) s.eye[key] *= k;
  const L = s.leg;
  for (const key of ['knee', 'hock', 'ball', 'toe', 'hallux', 'r']) L[key] = v3(L[key]);
  L.claw *= k;
  const W = s.wing;
  W.shoulder = v3(W.shoulder);
  W.hum = [W.hum[0] * k, W.hum[1]]; W.fore = [W.fore[0] * k, W.fore[1]]; W.hand = [W.hand[0] * k, W.hand[1]];
  W.arm = { r: v3(W.arm.r), lead: W.arm.lead * k };
  for (const g of ['prim', 'sec', 'ter']) W[g] = { ...W[g], len: scaleFn(W[g].len, k), w: W[g].w * k };
  s.tail = { ...s.tail, len: scaleFn(s.tail.len, k), w: s.tail.w * k, spread: s.tail.spread * k };
  s.height = s.head.c[1] + s.head.r[1]; // standing height: top of the head
  return s;
}

const FLIGHT = new Set(['primary', 'secondary', 'tertial', 'covert', 'pcovert', 'rectrix']);
const HEAD = new Set(['head', 'cheek', 'crown', 'throat', 'bristle', 'disc', 'ruff', 'tuft', 'face']);
const shadeOf = (v, f, a = 0.35) => 0.5 + a * 0.5 * fbm(v.p[0] * f, v.p[1] * f, v.p[2] * f, 3, 7);

/** Coat wrapper: feathers / body masks from fn(v, lm, m, S); bare parts keep their regions. */
const featherCoat = (fn, { shade = 0.35 } = {}) => (v, lm) => {
  const S = lm.S || 1;
  const m = { under: 0, pattern: 0, points: 0, extra: 0, shade: v.sheet ? 0.5 + 0.1 * (v.t - 0.5) + 0.06 * Math.sin(v.fi * 37) : shadeOf(v, 70 / S, shade) };
  fn(v, lm, m, S);
  for (const k of ['under', 'pattern', 'points', 'extra']) m[k] = clamp01(m[k]);
  return m;
};

// ------------------------------------------------------------------ crow
const CROW = mkBird({
  S: 1,
  beak: { len: 0.057, h: 0.0185, w: 0.0145, hook: 0.035, taper: 0.62, bulge: 0.08, lowH: 0.0088, k: 0.003 },
  extras: (B, c) => B.ell(c.hp(0.027 * c.S, 0.0095 * c.S), [0.0085 * c.S, 0.006 * c.S, 0.014 * c.S], { bones: ['head'], part: 'bristle', k: 0.004 * c.S, axes: [[1, 0, 0], c.hu, c.hd] }),
});
const crowCoat = featherCoat((v, lm, m) => {
  // hooded crow: grey mantle and underparts; black hood, bib, wings and tail
  const neckY = lm.s.neck[1][0];
  if (v.part === 'torso' || v.part === 'breast') m.pattern = 1;
  if (v.part === 'neck') m.pattern = sstep(neckY + 0.012, neckY - 0.004, v.p[1]) * (1 - sstep(0.2, 0.6, v.n[2] - v.n[1] * 0.3) * sstep(neckY - 0.01, neckY + 0.005, v.p[1]));
  if (v.part === 'leg') m.pattern = 0.7;
  if (FLIGHT.has(v.part)) m.extra = 0.1 * v.t;
});

// ------------------------------------------------------------------ pigeon
const PIGEON = mkBird({
  S: 0.74, tilt: 22, bl: 0.96, bw: 1.12, bh: 1.06, breast: 1.25, belly: 1.05, leg: 0.62, legR: 1.05, toe: 0.9, nk: 1.1, nr: 0.92, hs: 0.86, shX: 0.04,
  beak: { len: 0.031, h: 0.0105, w: 0.0088, hook: 0.08, taper: 0.62, lowH: 0.0062, cere: [0.08, 0.24], k: 0.002, nostrilA: 0.12 },
  wk: 1.02, pk: 1.06, sk: 0.86, pw: 0.92, notch: null,
  primLen: tableLen([0.13, 0.138, 0.146, 0.156, 0.168, 0.18, 0.192, 0.202, 0.206, 0.196]), primAng: [92, 18],
  tail: { len: (f) => 0.15 - 0.006 * f, w: 0.033, fan: [3, 24] },
});
const pigeonCoat = featherCoat((v, lm, m, S) => {
  const H = HEAD.has(v.part), neck = v.part === 'neck';
  // darker slate head and neck, iridescent neck patch (extra), wing bars and tail band (pattern), dark primaries (points)
  if (H) m.points = 0.55;
  if (neck) { m.points = 0.45; m.extra = sstep(0.0, 0.25, v.n[0] * v.n[0] + v.n[2] * 0.2) * sstep(lm.s.neck[0][0] - 0.004 * S, lm.s.neck[1][0], v.p[1]) * (1 - sstep(lm.s.neck[2][0], lm.s.neck[3][0] + 0.004 * S, v.p[1])); }
  if (v.part === 'breast' || v.part === 'torso') { m.extra = sstep(0.4, 0.8, v.n[2]) * sstep(lm.c0[1] + 0.02 * S, lm.c0[1] + 0.05 * S, v.p[1]) * 0.7; m.under = sstep(0.1, 0.6, -v.n[1]) * 0.25; }
  if (v.part === 'secondary') m.pattern = sstep(0.58, 0.64, v.t) * (1 - sstep(0.84, 0.9, v.t));
  if (v.part === 'covert') m.pattern = sstep(0.62, 0.7, v.t);
  if (v.part === 'tertial') m.pattern = sstep(0.55, 0.65, v.t) * 0.8;
  if (v.part === 'primary') m.points = 0.35 + 0.65 * sstep(0.35, 0.6, v.t);
  if (v.part === 'rectrix') m.pattern = sstep(0.78, 0.84, v.t);
  if (v.part === 'leg') m.under = 0.2;
});

// ------------------------------------------------------------------ eagle (aquila reale)
const EAGLE = mkBird({
  S: 2.55, tilt: 36, bl: 1.02, bw: 1.06, bh: 1.08, breast: 1.05, leg: 0.92, legR: 1.55, shinR: 1.15, toe: 1.05, hallux: 1.15, claw: 2.3, nk: 0.9, nr: 1.12, hs: 0.98,
  headR: [0.02, 0.0205, 0.03], headPitch: 4, crown: [-0.002, 0.012, [0.016, 0.009, 0.024]],
  feathered: true, trousers: true,
  beak: { len: 0.03, h: 0.0175, w: 0.0115, hook: 0.3, taper: 0.48, bulge: 0.12, lowH: 0.0085, lowLen: 0.62, cere: [0.06, 0.2], k: 0.0025, nostrilA: 0.12 },
  es: 0.88, eyeA: 0.004, eyeB: 0.0045, eyeX: 0.0175, eyeDir: [0.78, 0.08, 0.62],
  wk: 1.08, ar: 1.12, pk: 1.12, sk: 1.12, pw: 1.18, notch: { from: 4, at: 0.48, k: 0.42 },
  primLen: tableLen([0.14, 0.146, 0.152, 0.16, 0.168, 0.178, 0.186, 0.19, 0.186, 0.17]), primAng: [96, 6],
  tail: { len: (f) => 0.15 - 0.012 * f * f, w: 0.036, fan: [3, 28] },
  fold: { sec: [-4, -16] },
  extras: (B, c) => {
    // brow ridge over the eyes (fierce look)
    B.sym((sx) => B.ell(mx(c.hp(0.006 * c.S, 0.0095 * c.S, 0.0125 * c.S), sx), [0.006 * c.S, 0.0032 * c.S, 0.011 * c.S], { bones: ['head'], part: 'head', k: 0.003 * c.S, axes: [[1, 0, 0], c.hu, c.hd] }));
  },
});
const eagleCoat = featherCoat((v, lm, m, S) => {
  // golden nape and crown (points), paler coverts (under), barred tail; bald eagle: white head and tail (extra)
  const H = HEAD.has(v.part);
  if (H) { m.points = 0.55 + 0.45 * sstep(-0.1, 0.5, -v.n[2] + v.n[1] * 0.5); m.extra = 1; }
  if (v.part === 'neck') { m.points = sstep(0.0, 0.6, -v.n[2] + v.n[1] * 0.3) * sstep(lm.s.neck[1][0], lm.s.neck[3][0], v.p[1]); m.extra = sstep(lm.s.neck[1][0] - 0.01 * S, lm.s.neck[2][0], v.p[1]); }
  if (v.part === 'covert' || v.part === 'tertial') m.under = 0.35;
  if (v.part === 'rectrix') { m.pattern = stripes(v.t * 5, 0.45) * (1 - sstep(0.55, 0.7, v.t)) * 0.6; m.extra = 1; }
  if (v.part === 'leg') m.under = 0.45;
  if (v.part === 'primary') m.pattern = sstep(0.4, 0.7, v.t) * 0.7;
});

// ------------------------------------------------------------------ owl (gufo reale)
const OWL = mkBird({
  S: 1.95, tilt: 64, bl: 0.86, bw: 1.16, bh: 1.18, breast: 1.12, belly: 1.1, leg: 0.6, legR: 1.7, shinR: 1.25, toe: 0.95, claw: 2.0, nk: 0.5, nr: 1.5, hs: 1.42,
  headR: [0.0245, 0.0225, 0.0162], headPitch: 2, headY: 0.008, headZ: -0.002, headK: 0.009, neckTop: [0, -0.014, -0.012], neckTopK: 0.62,
  feathered: true, featheredToes: true, trousers: true, zygo: true,
  beak: { len: 0.022, h: 0.0105, w: 0.0078, hook: 0.48, taper: 0.5, lowH: 0.0048, lowLen: 0.5, k: 0.002, gapeA: 0.016, gapeB: -0.009, pitch: 38 },
  es: 1.75, eyeA: 0.004, eyeB: 0.005, eyeX: 0.0102, eyeDir: [0.18, 0.05, 0.98], eyeProtrude: 0.36, eyeOpen: 0.9, shX: 0.052,
  wk: 0.96, ar: 1.2, pk: 0.92, sk: 1.0, pw: 1.25, notch: { from: 6, at: 0.6, k: 0.7 },
  primLen: tableLen([0.14, 0.146, 0.152, 0.16, 0.168, 0.176, 0.182, 0.184, 0.178, 0.15]), primAng: [96, 16],
  tail: { len: (f) => 0.125 - 0.01 * f * f, w: 0.036, fan: [3, 26] }, tailAng: 64,
  fold: { back: [0.06, -0.93, -0.36], out: [1, -0.06, 0.12], sec: [-4, -18], prim: [-2, -6], twist: 8 },
  extras: (B, c) => {
    const S = c.S * 1.42, hp = c.hp, A = [[1, 0, 0], c.hu, c.hd];
    // facial disc: the flat face is painted by the coat; a soft ruff rims it at the sides
    B.sym((sx) => B.ell(mx(hp(0.006 * S, -0.002 * S, 0.02 * S), sx), [0.0055 * S, 0.02 * S, 0.008 * S], { bones: ['head'], part: 'disc', k: 0.005 * S, axes: A }));
    // ear tufts
    B.sym((sx) => {
      const b0 = mx(hp(0.0, 0.019 * S, 0.012 * S), sx), t0 = V.add(b0, [sx * 0.006 * S, 0.02 * S, -0.004 * S]);
      B.loft([{ p: b0, w: 0.0055 * S, ht: 0.0028 * S, hb: 0.0028 * S }, { p: V.lerp(b0, t0, 0.5), w: 0.0048 * S, ht: 0.002 * S, hb: 0.002 * S }, { p: t0, w: 0.0016 * S, ht: 0.0011 * S, hb: 0.0011 * S }],
        { bones: ['head'], part: 'tuft', k: 0.003 * S, up: [0, 0, 1], caps: [0.6, 0.5], noise: { amp: 0.0007 * S, freq: 700 / S, seed: 5, oct: 2 } });
    });
  },
});
const owlCoat = featherCoat((v, lm, m, S) => {
  // tawny with dark streaks on the breast (pattern), barred wings and tail, pale disc (under) with a dark rim (points)
  const p = v.p;
  if (v.part === 'torso' || v.part === 'breast' || v.part === 'neck') {
    const streak = sstep(0.55, 0.75, Math.abs(Math.sin(p[0] * 260 / S + fbm(p[0] * 90 / S, p[1] * 90 / S, p[2] * 90 / S, 2, 3) * 2.5)));
    m.pattern = streak * sstep(-0.2, 0.4, v.n[2] + 0.2) * (0.55 + 0.45 * sstep(lm.c0[1], lm.c0[1] + 0.08 * S, p[1]));
    m.under = sstep(0.1, 0.6, -v.n[1]) * 0.4;
  }
  // facial disc: pale face (under) with a dark rim (points), everything facing forward on the head
  if (v.part === 'head' || v.part === 'disc' || v.part === 'throat') {
    const face = sstep(0.35, 0.7, V.dot(v.n, lm.hd));
    const r = Math.hypot(p[0], (p[1] - lm.s.head.c[1]) * 1.1) / (lm.s.head.r[0]);
    m.under = face * (1 - sstep(0.75, 0.95, r)) * 0.9;
    m.points = face * sstep(0.72, 0.85, r) * (1 - sstep(1.05, 1.25, r)) * 0.9;
  }
  if (v.part === 'head' || v.part === 'crown') m.pattern = sstep(0.6, 0.8, Math.abs(Math.sin(p[1] * 400 / S + p[0] * 120 / S))) * 0.6 * (1 - m.under);
  if (v.part === 'tuft') m.points = 0.8;
  if (FLIGHT.has(v.part)) m.pattern = stripes(v.t * (v.part === 'rectrix' ? 6 : 5) + v.s * 0.3, 0.35) * (v.part === 'covert' ? 0.5 : 0.75);
  if (v.part === 'leg' || v.part === 'toe') m.under = 0.65;
});

// ------------------------------------------------------------------ macaw (ara)
const MACAW = mkBird({
  S: 1.55, tilt: 52, bl: 0.92, bw: 1.0, bh: 1.0, breast: 1.05, leg: 0.48, legR: 1.55, shinR: 1.15, toe: 0.9, claw: 1.4, nk: 0.86, nr: 1.0, hs: 1.22,
  headR: [0.021, 0.0235, 0.026], headPitch: 4, zygo: true,
  beak: { len: 0.034, h: 0.026, w: 0.0165, hook: 0.6, taper: 0.42, bulge: 0.32, lowH: 0.0165, lowLen: 0.55, k: 0.003, gapeA: 0.009, gapeB: -0.009 },
  es: 1.0, eyeA: -0.001, eyeB: 0.004, eyeX: 0.0175, eyeDir: [0.88, 0.16, 0.44],
  wk: 1.05, ar: 1.05, pk: 1.12, sk: 0.92, pw: 0.95, notch: null,
  primLen: tableLen([0.13, 0.14, 0.15, 0.162, 0.176, 0.19, 0.2, 0.206, 0.204, 0.19]), primAng: [94, 16],
  tail: { len: (f) => 0.34 * (1 - 0.62 * f), w: 0.026, fan: [1.5, 12], taper: 0.55, tipRound: 0.5 }, tailAng: 6,
  fold: { back: [0, -0.62, -1], out: [1, 0.15, 0], sec: [-4, -14], prim: [-2, -4] },
  extras: (B, c) => {
    // bare cheek patch from the eye to the beak (region skin through the coat)
    B.sym((sx) => B.ell(mx(c.hp(0.008 * c.S, -0.003 * c.S, 0.0145 * c.S), sx), [0.0065 * c.S, 0.012 * c.S, 0.014 * c.S], { bones: ['head'], part: 'face', k: 0.004 * c.S, axes: [[1, 0, 0], c.hu, c.hd] }));
  },
});
const macawCoat = featherCoat((v, lm, m) => {
  // scarlet: red body (base), yellow greater coverts (extra) with green tips (pattern), blue flight feathers / rump / tail tips (points)
  if (v.part === 'covert' || v.part === 'tertial') { m.extra = 1; m.pattern = sstep(0.55, 0.85, v.t); }
  if (v.part === 'pcovert') m.points = 1;
  if (v.part === 'primary' || v.part === 'secondary') m.points = 1;
  if (v.part === 'rectrix') m.points = sstep(0.45, 0.75, v.t);
  if (v.part === 'wingarm') m.extra = sstep(-0.2, 0.6, v.n[1]) * 0.9;
  if (v.part === 'torso') m.points = sstep(-0.3, 0.4, v.n[1]) * sstep(lm.c0[1], lm.c0[1] - 0.05 * lm.S, v.p[1]) * 0.9;
  if (v.part === 'face') { m.region = 'skin'; m.regionW = 1; }
  if (v.part === 'leg') m.under = 0.3;
});

// ------------------------------------------------------------------ hen (gallina)
const HEN = mkBird({
  S: 1.5, tilt: 16, bl: 1.12, bw: 1.22, bh: 1.22, breast: 1.25, belly: 1.15, leg: 0.88, legR: 1.75, shinR: 1.35, toe: 1.12, claw: 0.75, nk: 1.12, nr: 1.12, hs: 0.95,
  headR: [0.019, 0.021, 0.026], headPitch: 4,
  beak: { len: 0.025, h: 0.0115, w: 0.0105, hook: 0.1, taper: 0.62, lowH: 0.0062, k: 0.0025 },
  es: 0.9, eyeA: 0.003, eyeB: 0.006, eyeX: 0.0168,
  wk: 0.86, ar: 1.15, pk: 0.72, sk: 0.8, pw: 1.08, notch: null,
  primLen: tableLen([0.13, 0.136, 0.142, 0.148, 0.154, 0.158, 0.158, 0.152, 0.14, 0.12]), primAng: [94, 26],
  tail: { len: (f) => 0.12 - 0.018 * f, w: 0.038, fan: [4, 26] }, tailAng: -38,
  fold: { out: [1, 0.12, 0], back: [0, -0.18, -1], sec: [-3, -14], prim: [0, -3] },
  extras: (B, c) => {
    const S = c.S, hp = c.hp, A = [[1, 0, 0], c.hu, c.hd];
    // single comb: a thin blade with rounded points along the top of the head
    B.ell(hp(0.008 * S, 0.02 * S), [0.0028 * S, 0.008 * S, 0.026 * S], { bones: ['head'], part: 'comb', mat: 'skin', k: 0.003 * S, axes: A });
    for (let i = 0; i < 5; i++) {
      const a = -0.016 + i * 0.008;
      B.ell(hp(a * S + 0.008 * S, (0.026 + 0.006 * Math.sin((i / 4) * Math.PI)) * S), [0.0026 * S, 0.0065 * S, 0.0042 * S], { bones: ['head'], part: 'comb', mat: 'skin', k: 0.002 * S, axes: A });
    }
    // wattles under the beak, ear lobes
    B.sym((sx) => {
      const w = V.add(c.gape, V.add(V.mul(c.hd, 0.006 * S), V.mul(c.hu, -0.016 * S)));
      B.ell([sx * 0.0045 * S, w[1], w[2]], [0.004 * S, 0.0095 * S, 0.006 * S], { bones: ['jaw'], part: 'wattle', mat: 'skin', k: 0.003 * S });
      B.ell(mx(hp(-0.009 * S, -0.006 * S, 0.0165 * S), sx), [0.002 * S, 0.004 * S, 0.0035 * S], { bones: ['head'], part: 'lobe', mat: 'skin', k: 0.0015 * S, axes: A });
    });
  },
});
const henCoat = featherCoat((v, lm, m, S) => {
  // red-brown hen: golden hackles on the neck (pattern), darker tail and flight feathers (points), lacing on the body (extra)
  if (v.part === 'neck') m.pattern = 0.85;
  if (v.part === 'head' || v.part === 'crown') m.pattern = 0.6;
  if (v.part === 'rectrix' || v.part === 'primary') m.points = 1;
  if (v.part === 'secondary') m.points = 0.6;
  if (v.part === 'torso' || v.part === 'breast') { m.extra = sstep(0.6, 0.85, Math.abs(Math.sin(v.p[1] * 300 / S + fbm(v.p[0] * 80 / S, v.p[1] * 80 / S, v.p[2] * 80 / S, 2, 4) * 3))) * 0.35; m.under = sstep(0.1, 0.6, -v.n[1]) * 0.5; }
});

// ------------------------------------------------------------------ species
const feather = (o) => ({ type: 'feather', scale: 40, normalScale: 0.22, roughness: 0.72, sheen: 0.35, ...o });
const B_ = (id, label, sub, spec, coat, o) => ({
  id, label, sub, group: 'uccelli', family: 'bird', gait: 'bird', tris: o.tris || 15000, res: o.res || 520,
  heightLabel: 'Altezza circa', defaultPose: 'stand', build: () => bird(spec), coat, ...o,
});

export const BIRDS = [
  B_('corvo', 'Corvo', 'Cornacchia', CROW, crowCoat, {
    fur: feather({ scale: 42, roughness: 0.5, featherRoughness: 0.46, featherSheen: 0.45 }), iris: '#2a1a12', pupil: 'round', teethColor: '#222222',
    palettes: [
      { id: 'nero', label: 'Nero', colors: { base: '#141418', pattern: '#16161b', extra: '#2a2420', keratin: '#121212', scale: '#1b1b1d', eyelid: '#1a1a1c', mouth: '#3a2228' } },
      { id: 'grigia', label: 'Grigia', colors: { base: '#141418', pattern: '#8e8a86', extra: '#2a2420', keratin: '#121212', scale: '#1b1b1d', eyelid: '#1a1a1c', mouth: '#3a2228' } },
    ],
  }),
  B_('piccione', 'Piccione', 'Colombo', PIGEON, pigeonCoat, {
    fur: feather({ scale: 52, roughness: 0.62 }), iris: '#d05a1c', pupil: 'round',
    palettes: [
      { id: 'torraiolo', label: 'Grigio', colors: { base: '#8f95a0', under: '#7d838e', pattern: '#1e1e22', points: '#565b66', extra: '#4f7a5e', keratin: '#3a3638', skin: '#e6e1d8', scale: '#b4525c', eyelid: '#8a6a68', mouth: '#a05a60' } },
      { id: 'bianco', label: 'Bianco', colors: { base: '#eeece6', under: '#e8e6e0', pattern: '#dcd8d0', points: '#e4e1da', extra: '#e8e4dc', keratin: '#d8b8a8', skin: '#f2eee8', scale: '#c46470', eyelid: '#c89a90', mouth: '#c07078' } },
      { id: 'bruno', label: 'Bruno', colors: { base: '#9a7a62', under: '#8e705a', pattern: '#3a2a20', points: '#6a5444', extra: '#7a6a4a', keratin: '#3a3638', skin: '#e6e1d8', scale: '#b4525c', eyelid: '#8a6a68', mouth: '#a05a60' } },
    ],
  }),
  B_('aquila', 'Aquila', 'Aquila reale', EAGLE, eagleCoat, {
    tris: 16000, fur: feather({ scale: 22, roughness: 0.74 }), iris: '#8a5a1a', pupil: 'round',
    palettes: [
      { id: 'reale', label: 'Reale', colors: { base: '#4a3222', under: '#6e5238', pattern: '#2a1c14', points: '#b38a48', extra: '#4a3222', keratin: '#3a3a3c', skin: '#e0b030', scale: '#e0b030', eyelid: '#5a4430', mouth: '#7a4a40' } },
      { id: 'testabianca', label: 'Testa bianca', colors: { base: '#3c2a1e', under: '#4a3424', pattern: '#2a1c14', points: '#f0ede6', extra: '#f2efe8', keratin: '#e8b830', skin: '#e8b830', scale: '#e8b830', eyelid: '#e8b830', mouth: '#7a4a40' } },
    ],
  }),
  B_('gufo', 'Gufo', 'Gufo reale', OWL, owlCoat, {
    tris: 16000, fur: feather({ type: 'long', scale: 26, normalScale: 0.3, roughness: 0.86, sheen: 0.4 }), iris: '#e07a12', pupil: 'round',
    palettes: [
      { id: 'reale', label: 'Fulvo', colors: { base: '#9a7448', under: '#c8a878', pattern: '#3a2a1a', points: '#2a2018', extra: '#8a6a44', keratin: '#2a2420', scale: '#8a7458', eyelid: '#2a2018', mouth: '#6a4040' } },
      { id: 'grigio', label: 'Grigio', colors: { base: '#8a8478', under: '#c6c0b4', pattern: '#3a3630', points: '#2a2622', extra: '#7a746a', keratin: '#2a2420', scale: '#8a8478', eyelid: '#2a2622', mouth: '#6a4040' } },
      { id: 'bianco', label: 'Delle nevi', colors: { base: '#f0eee8', under: '#f4f2ee', pattern: '#3a3632', points: '#e8e4dc', extra: '#ece8e0', keratin: '#2a2420', scale: '#f0eee8', eyelid: '#2a2622', mouth: '#6a4040' } },
    ],
  }),
  B_('pappagallo', 'Pappagallo', 'Ara', MACAW, macawCoat, {
    fur: feather({ scale: 34, roughness: 0.6, featherRoughness: 0.56, featherSheen: 0.3 }), iris: '#d8c890', pupil: 'round',
    palettes: [
      { id: 'rossa', label: 'Ara rossa', colors: { base: '#c8241e', under: '#c8241e', pattern: '#3a8a3a', points: '#1e4ea8', extra: '#f0c020', keratin: '#e8e2d6', skin: '#f4f0ea', scale: '#4a4448', eyelid: '#e8e0d8', mouth: '#2a2224' } },
      { id: 'gialloblu', label: 'Gialloblù', colors: { base: '#1e6ac0', under: '#f0b820', pattern: '#2a8ac8', points: '#1a4a9a', extra: '#2a7ad0', keratin: '#1a1a1c', skin: '#f2f0ec', scale: '#3a3438', eyelid: '#f0ece8', mouth: '#2a2224' } },
      { id: 'verde', label: 'Ara verde', colors: { base: '#4a8a2e', under: '#4a8a2e', pattern: '#3a7a2a', points: '#2a5ab0', extra: '#5a9a34', keratin: '#2a2628', skin: '#e8d8d0', scale: '#3a3438', eyelid: '#e0d0c8', mouth: '#2a2224' } },
    ],
  }),
  B_('gallina', 'Gallina', '', HEN, henCoat, {
    tris: 15000, fur: feather({ scale: 30, roughness: 0.76 }), iris: '#d07a20', pupil: 'round',
    palettes: [
      { id: 'rossa', label: 'Rossa', colors: { base: '#8c4a22', under: '#a8643a', pattern: '#c88a3a', points: '#2a1c14', extra: '#5a2e16', keratin: '#d8b050', skin: '#c42a26', scale: '#d8b050', eyelid: '#c42a26', mouth: '#a04040' } },
      { id: 'bianca', label: 'Bianca', colors: { base: '#f0ece2', under: '#f2eee6', pattern: '#f4f0e6', points: '#e6e0d4', extra: '#e8e2d6', keratin: '#e0c060', skin: '#cc2a28', scale: '#e0c060', eyelid: '#cc2a28', mouth: '#a04040' } },
      { id: 'nera', label: 'Nera', colors: { base: '#1c1c1e', under: '#222224', pattern: '#24262a', points: '#141416', extra: '#1a2a22', keratin: '#3a3634', skin: '#b82424', scale: '#3a3634', eyelid: '#b82424', mouth: '#a04040' } },
    ],
  }),
];
