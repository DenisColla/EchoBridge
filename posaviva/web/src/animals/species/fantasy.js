// Fantasy creatures (build time): dragon (quadruped with a long neck and
// tail, horns, spikes and bat-like membrane wings), unicorn (horse + spiral
// horn + flowing mane), griffin (lion body, eagle head, chest and taloned
// front legs, feathered wings) and pegasus (horse + feathered wings).
// Family 'winged' (families/winged.js) for the winged ones.
import { quadruped, horn, crestMane } from './quadruped.js';
import { HORSE, horseExtras } from './ungulates.js';
import { featherWing } from './bird.js';
import { mkCoat, R as REG, sstep, fbm, clamp01, stripes } from './coat.js';
import { mx, V } from './builder.js';
import { dirY, wrap, eulerMapping, mirrorEuler } from './rot.js';

const lerp = (a, b, t) => a + (b - a) * t;
const tableLen = (t) => (f) => { const x = f * (t.length - 1), i = Math.min(t.length - 2, Math.floor(x)); return t[i] + (t[i + 1] - t[i]) * (x - i); };

/** Feathered wing of a crow scaled by k, with overrides (pegasus, griffin). */
function bigWing(k, o = {}) {
  const prim = tableLen([0.15, 0.158, 0.166, 0.176, 0.188, 0.2, 0.206, 0.204, 0.188, 0.12].map((x) => x * k * (o.pk ?? 1)));
  return {
    parent: 'chest', shoulder: o.shoulder, hum: [0.062 * k, 22], fore: [0.078 * k, -8], hand: [0.064 * k, 6],
    arm: { r: [0.011, 0.0088, 0.0065, 0.003].map((x) => x * k * (o.ar ?? 1)), lead: 0.022 * k },
    prim: { n: 10, len: prim, w: 0.034 * k * (o.pw ?? 1), ang: o.primAng || [96, 10], angPow: 0.9, notch: o.notch === undefined ? { from: 5, at: 0.55, k: 0.6 } : o.notch },
    sec: { n: 10, len: 0.14 * k * (o.sk ?? 1), w: 0.036 * k * (o.pw ?? 1), ang: [104, 86] },
    ter: { n: 3, len: [0.12, 0.11, 0.1].map((x) => x * k * (o.sk ?? 1)), w: 0.034 * k * (o.pw ?? 1), ang: [112, 104] },
    cov: { k: 0.42 }, pcov: { k: 0.32 }, th: o.th ?? 0.0014,
    fold: { back: [0, -0.08, -1], out: [1, 0.85, 0], fore: 12, hand: 6, sec: [-2, -8], prim: [-1, -3], ter: [2, 0], twist: 6, ...(o.fold || {}) },
  };
}

// ------------------------------------------------------------------ membrane wing (dragon)
/**
 * Bat-like wing on both sides: arm (signed distance lofts), hand bone and
 * fingers (explicit bars), membrane panels between the fingers and from the
 * last finger to the flank (explicit sheets, weights blended across the panel
 * so the wing closes like a fan). Blends 'wingFold.L/.R'.
 * o: {parent, shoulder, hum:[len, ang], fore:[len, ang], hand:[len, ang], fingers:[[len, ang]...],
 *     r:[shoulder, elbow, wrist, finger], th (membrane), body:[[x,y,z] attach points shoulder -> hip], bodyBones, fold}
 */
function membraneWing(B, o) {
  const up = [0, 1, 0];
  const [hl, ha] = o.hum, [fl, fa] = o.fore, [ml, ma] = o.hand;
  const sh = o.shoulder, el = V.add(sh, V.mul(dirY(ha), hl)), wr = V.add(el, V.mul(dirY(fa), fl)), hd = V.add(wr, V.mul(dirY(ma), ml));
  const F = o.fingers.map(([len, ang], i) => ({ name: 'finger' + (i + 1), len, ang, tip: V.add(hd, V.mul(dirY(ang), len)) }));
  const fold = o.fold || {};
  const R1 = eulerMapping(dirY(ha), up, fold.back || [0, 0.3, -1], fold.out || [1, 0.6, 0]);
  const phi2 = wrap(ha + 180 - (fold.fore ?? 16) - fa);
  const phi3 = wrap(ha + 180 - (fold.hand ?? 30) - ma - phi2); // hand stays pointing forward-up (the "elbow" of the folded wing)
  const blendL = { wing1: R1, wing2: [0, phi2, 0], wing3: [0, phi3, 0] };
  F.forEach((f, i) => { blendL[f.name] = [0, wrap(ha + (fold.spread ?? 3) * i - 2 - f.ang - phi2 - phi3), 0]; });
  const r = o.r;
  B.sym((sx, S) => {
    const P = (p) => mx(p, sx);
    B.bone('wing1' + S, o.parent, P(sh), P(el));
    B.bone('wing2' + S, 'wing1' + S, P(el), P(wr));
    B.bone('wing3' + S, 'wing2' + S, P(wr), P(hd));
    for (const f of F) B.bone(f.name + S, 'wing3' + S, P(hd), P(f.tip));
    // arm
    B.loft([
      { p: P(V.add(sh, [-r[0] * 0.5, 0, 0])), w: r[0], ht: r[0], hb: r[0] },
      { p: P(V.lerp(sh, el, 0.5)), w: r[0] * 0.8, ht: r[0] * 0.75, hb: r[0] * 0.75 },
      { p: P(el), w: r[1], ht: r[1], hb: r[1] },
      { p: P(V.lerp(el, wr, 0.5)), w: r[1] * 0.7, ht: r[1] * 0.65, hb: r[1] * 0.65 },
      { p: P(wr), w: r[2], ht: r[2], hb: r[2] },
      { p: P(hd), w: r[2] * 0.85, ht: r[2] * 0.8, hb: r[2] * 0.8 },
    ], { bones: [o.parent, 'wing1' + S, 'wing2' + S, 'wing3' + S], part: 'wingarm', k: r[1] * 0.6, up, caps: [0.6, 0.8] });
    // leading-edge membrane (propatagium) from the shoulder to the wrist
    const mid = V.add(V.lerp(sh, wr, 0.5), V.mul(dirY(-90), r[1] * 1.2));
    B.loft([{ p: P(V.lerp(sh, mid, 0.2)), w: r[0], ht: r[0] * 0.3, hb: r[0] * 0.3 }, { p: P(mid), w: r[1] * 1.6, ht: Math.max(o.th * 1.4, r[1] * 0.18), hb: Math.max(o.th * 1.4, r[1] * 0.18) }, { p: P(V.lerp(mid, wr, 0.85)), w: r[2], ht: r[2] * 0.4, hb: r[2] * 0.4 }],
      { bones: ['wing1' + S, 'wing2' + S], part: 'wingarm', k: r[1] * 0.6, up, caps: [0.6, 0.6] });
    // thumb claw at the wrist
    horn(B, [P(wr), P(V.add(wr, [0.0, r[2] * 1.2, r[2] * 1.4])), P(V.add(wr, [0, r[2] * 1.1, r[2] * 2.6]))], [r[2] * 0.45, r[2] * 0.3, r[2] * 0.05], ['wing2' + S], { part: 'claw' });
    // fingers: bars (explicit) tapering to a point
    for (const f of F) {
      const d = dirY(f.ang), side = V.norm(V.cross(d, up));
      const grid = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6, rr = r[3] * (1 - 0.75 * t);
        const c = V.add(hd, V.mul(d, f.len * t));
        const w = { [f.name + S]: Math.min(1, 0.3 + t * 3) }; if (t < 0.24) w['wing3' + S] = 1 - Math.min(1, 0.3 + t * 3);
        grid.push([-1, 0, 1].map((s) => ({ p: P(V.add(c, V.mul(side, s * rr))), th: rr * 1.5 * (1 - 0.4 * Math.abs(s)), w, uv: [0.5 + 0.5 * s, t] })));
      }
      B.sheet({ grid, up, part: 'finger', mat: 'fur', side: sx });
    }
    // membrane panels between consecutive fingers (scalloped trailing edge)
    const panel = (A, Bp, wA, wB, part, scallop, nu = 8, nv = 6) => {
      const grid = [];
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, row = [];
        for (let j = 0; j <= nv; j++) {
          const v = j / nv;
          let p = V.lerp(A(u), Bp(u), v);
          const sc = scallop * Math.sin(Math.PI * v) * Math.pow(u, 3);
          p = V.lerp(p, V.lerp(A(u * 0.6), Bp(u * 0.6), v), sc);
          const w = {};
          for (const [b, k] of Object.entries(wA(u))) w[b] = (w[b] || 0) + k * (1 - v);
          for (const [b, k] of Object.entries(wB(u))) w[b] = (w[b] || 0) + k * v;
          row.push({ p: P(p), th: o.th, w, uv: [v, u] });
        }
        grid.push(row);
      }
      B.sheet({ grid, up, part, mat: 'skin', side: sx });
    };
    const fpt = (f) => (u) => V.add(V.add(hd, V.mul(dirY(f.ang), f.len * lerp(0.03, 0.97, u))), [0, -o.th, 0]);
    const fw = (f) => (u) => (u < 0.15 ? { ['wing3' + S]: 1 - u / 0.15, [f.name + S]: u / 0.15 } : { [f.name + S]: 1 });
    for (let i = 0; i < F.length - 1; i++) panel(fpt(F[i]), fpt(F[i + 1]), fw(F[i]), fw(F[i + 1]), 'membrane', 0.32);
    // last finger to the flank (shoulder -> hip line)
    const bodyPt = (u) => { const n = o.body.length - 1, x = u * n, k = Math.min(n - 1, Math.floor(x)); return V.lerp(o.body[k], o.body[k + 1], x - k); };
    const bodyW = (u) => (u < 0.5 ? { [o.bodyBones[0]]: 1 - u, [o.bodyBones[1]]: u } : { [o.bodyBones[1]]: 1 - (u - 0.5), [o.bodyBones[2]]: u - 0.5 });
    const last = F[F.length - 1];
    panel(fpt(last), bodyPt, fw(last), bodyW, 'membrane', 0.22, 10, 7);
  });
  const bl = {}, br = {};
  for (const [kk, e] of Object.entries(blendL)) { bl[kk + '.L'] = e; br[kk + '.R'] = mirrorEuler(e); }
  B.blend('wingFold.L', bl); B.blend('wingFold.R', br);
}

// ------------------------------------------------------------------ dragon
const DRAGON = {
  H: 1.8,
  torso: [[-0.95, 0.84, 0.55, 0.14], [-0.8, 0.95, 0.45, 0.24], [-0.55, 0.99, 0.4, 0.28], [-0.2, 0.98, 0.37, 0.3], [0.15, 1.0, 0.38, 0.31], [0.4, 1.02, 0.42, 0.29], [0.6, 0.96, 0.46, 0.24], [0.75, 0.84, 0.52, 0.15]],
  hip: [0.17, 0.72, -0.7], knee: [0.2, 0.45, -0.45], hock: [0.17, 0.2, -0.86], hpaw: [0.16, 0.05, -0.8],
  scap: [0.15, 0.9, 0.42], shoulder: [0.2, 0.6, 0.66], elbow: [0.21, 0.42, 0.46], wrist: [0.19, 0.12, 0.52], fpaw: [0.19, 0.05, 0.58],
  spine: [[-0.45, 0.85], [0.0, 0.88], [0.35, 0.9]], tailBase: [-0.92, 0.82],
  neck: { base: [0.66, 0.84], ang: 46, len: 0.95, w0: 0.19, h0: 0.24, w1: 0.1, h1: 0.12 },
  head: {
    len: 0.6, pitch: 12, w: 0.56, cranium: [0.26, 0.32],
    muzzle: [[0.4, 0.28, 0.03, 0.22], [0.6, 0.22, 0.04, 0.17], [0.82, 0.18, 0.05, 0.14], [0.97, 0.16, 0.04, 0.13]], muzzleCap: 0.55,
    jaw: [[0.18, 0.17, 0.2], [0.55, 0.12, 0.15], [0.92, 0.09, 0.11]], slitA: [0.3, 1.02],
    nose: { a: 0.97, b: 0.0, w: 0.07, h: 0.05, d: 0.04, nostril: 0.022 },
    eye: { a: 0.33, b: 0.24, x: 0.2, r: 0.042, dir: [0.62, 0.2, 0.76], open: 0.55 }, canine: 0.09, cheekA: 0.3,
  },
  ear: { type: 'none' },
  fore: [[0, 0.06, 0.1, 0.09], [0.5, 0.1, 0.13, 0.13], [1, 0.11, 0.13, 0.14], [1.5, 0.1, 0.11, 0.12], [2, 0.08, 0.08, 0.08], [2.4, 0.075, 0.08, 0.065], [3, 0.06, 0.055, 0.05], [3.6, 0.058, 0.05, 0.05]],
  hind: [[0, 0.14, 0.17, 0.2], [0.45, 0.13, 0.13, 0.16], [1, 0.08, 0.08, 0.1], [1.4, 0.075, 0.07, 0.1], [2, 0.055, 0.05, 0.065], [2.5, 0.055, 0.05, 0.055]],
  foot: { type: 'paw', size: 1.3, clawK: 2.4 },
  tail: { len: 2.6, r: 0.13, taper: 0.9, carry: -22, curl: -8, bones: 10 },
  blend: 1.1, thighW: 1.25, thighD: 1.1, legR: 1.05,
  extras: (B, c) => {
    const { H, hp, HL, HW, tailPts } = c;
    // horns sweeping back, brow ridges, cheek spikes
    B.sym((sx) => {
      horn(B, [mx(hp(0.12, 0.3, HW * 0.28), sx), mx(hp(-0.08, 0.44, HW * 0.36), sx), mx(hp(-0.32, 0.5, HW * 0.4), sx), mx(hp(-0.55, 0.42, HW * 0.38), sx)], [0.07 * HL, 0.055 * HL, 0.035 * HL, 0.008 * HL], ['head'], { part: 'horn' });
      B.ell(mx(hp(0.32, 0.29, HW * 0.36), sx), [0.06 * HL, 0.035 * HL, 0.12 * HL], { bones: ['head'], part: 'head', k: 0.03 * HL, axes: c.HX });
      horn(B, [mx(hp(0.12, -0.1, HW * 0.45), sx), mx(hp(-0.04, -0.12, HW * 0.62), sx), mx(hp(-0.16, -0.12, HW * 0.7), sx)], [0.035 * HL, 0.02 * HL, 0.005 * HL], ['head'], { part: 'horn' });
    });
    // spikes along the neck, back and tail
    const spine = [];
    for (let i = 0; i <= 6; i++) spine.push([V.add(V.lerp(c.neckBase, V.add(c.neckBase, V.mul(c.nd, c.NL)), i / 6), [0, (c.s.neck.h0 * (1 - i / 6) + c.s.neck.h1 * (i / 6)) * H * 0.95, 0]), i < 3 ? 'neck1' : 'neck2', 0.09 - i * 0.006]);
    for (let i = 0; i < 7; i++) { const z = (0.55 - i * 0.22) * H; spine.push([[0, (z > 0 ? 1.0 : 0.97) * H, z], i < 3 ? 'chest' : i < 5 ? 'spine2' : 'spine1', 0.11]); }
    for (let i = 1; i < tailPts.length - 1; i++) { const rr = 0.13 * H * (1 - 0.9 * (i / (tailPts.length - 1))); spine.push([V.add(tailPts[i], [0, rr * 0.9, 0]), 'tail' + (i + 1), 0.11 * (1 - i / tailPts.length) + 0.02]); }
    for (const [p, bone, s] of spine) B.cone(p, V.add(p, [0, s * H, -s * H * 0.55]), s * H * 0.32, s * H * 0.03, { bones: [bone], part: 'spike', mat: 'keratin', k: s * H * 0.12 });
    // spade at the tail tip
    const tp = tailPts[tailPts.length - 1], tq = tailPts[tailPts.length - 2];
    const td = V.norm(V.sub(tp, tq));
    B.ell(V.add(tp, V.mul(td, 0.12 * H)), [0.16 * H, 0.03 * H, 0.16 * H], { bones: ['tail10'], part: 'spade', k: 0.04 * H, axes: [[Math.SQRT1_2, 0, Math.SQRT1_2], [0, 1, 0], [-Math.SQRT1_2, 0, Math.SQRT1_2]] });
    // teeth
    for (let i = 0; i < 9; i++) {
      const a = 0.4 + i * 0.065;
      for (const sx of [1, -1]) {
        const w = (0.21 - (a - 0.4) * 0.17) * HL;
        B.tooth('head', mx(hp(a, c.s.head.slitY + 0.01, w), sx), mx(hp(a + 0.01, c.s.head.slitY - 0.05, w), sx), 0.012 * HL);
        B.tooth('jaw', mx(hp(a + 0.03, c.s.head.slitY - 0.025, w * 0.85), sx), mx(hp(a + 0.03, c.s.head.slitY + 0.02, w * 0.86), sx), 0.011 * HL);
      }
    }
    // wings
    membraneWing(B, {
      parent: 'chest', shoulder: [0.17 * H, 0.98 * H, 0.38 * H], hum: [0.72 * H, 24], fore: [0.95 * H, -22], hand: [0.22 * H, -6],
      fingers: [[1.85 * H, -8], [1.7 * H, 22], [1.45 * H, 50], [1.15 * H, 82]],
      r: [0.075 * H, 0.06 * H, 0.05 * H, 0.025 * H], th: 0.01 * H,
      body: [[0.2 * H, 0.95 * H, 0.32 * H], [0.27 * H, 0.86 * H, -0.1 * H], [0.24 * H, 0.82 * H, -0.62 * H]], bodyBones: ['chest', 'spine2', 'hips'],
      fold: { back: [0.1, 0.45, -1], out: [1, 0.55, 0.1], fore: 18, hand: 34, spread: 3 },
    });
  },
};

function dragonCoat(v, lm) {
  const p = v.p, H = lm.H;
  const m = { under: REG.under(v, { torso: 0.1, neck: 0.15, legs: 0.5, soft: 0.4 }), pattern: 0, points: 0, extra: 0, shade: 0.5 + 0.2 * fbm(p[0] * 20 / H, p[1] * 20 / H, p[2] * 20 / H, 3, 5) };
  // belly plates: transverse bands on the underside
  if (m.under > 0.1) m.extra = stripes(p[2] / H * 9 + (v.part === 'tail' ? v.t * 30 : 0), 0.2) * m.under * 0.6;
  // darker back
  m.pattern = (v.part === 'torso' || v.part === 'neck' || v.part === 'tail') ? sstep(0.3, 0.8, v.n[1]) * 0.7 : 0;
  if (v.part === 'wingarm' || v.part === 'finger') m.pattern = 0.6;
  if (v.part === 'spade') m.points = 1;
  for (const k of ['under', 'pattern', 'points', 'extra']) m[k] = clamp01(m[k]);
  return m;
}

// ------------------------------------------------------------------ unicorn
function unicornExtras(B, c) {
  horseExtras({ h: 0.07, w: 0.034, start: -0.02, end: 1.02, noise: 0.12 })(B, c);
  const { H, hp, HL } = c;
  // spiral horn from the forehead, with a helical ridge
  const b0 = hp(0.08, 0.3), tipP = hp(-0.28, 1.22);
  const ax = V.norm(V.sub(tipP, b0)), len = V.dist(b0, tipP);
  horn(B, [b0, V.lerp(b0, tipP, 0.33), V.lerp(b0, tipP, 0.66), tipP], [0.06 * HL, 0.045 * HL, 0.028 * HL, 0.004 * HL], ['head'], { part: 'horn' });
  const s1 = V.norm(V.cross(ax, [1, 0, 0])), s2 = V.cross(ax, s1);
  const hel = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, a = t * Math.PI * 2 * 4.5, rr = (0.058 - 0.05 * t) * HL;
    hel.push({ p: V.add(V.add(V.add(b0, V.mul(ax, len * t * 0.92)), V.mul(s1, Math.cos(a) * rr)), V.mul(s2, Math.sin(a) * rr)), w: 0.012 * HL * (1 - 0.7 * t), ht: 0.012 * HL * (1 - 0.7 * t), hb: 0.012 * HL * (1 - 0.7 * t) });
  }
  B.loft(hel, { bones: ['head'], part: 'horn', mat: 'keratin', k: 0.006 * HL, res: 3, caps: [0.6, 0.6] });
  // flowing mane: locks falling along the left side of the neck
  for (let i = 0; i < 7; i++) {
    const t = 0.05 + i * 0.14;
    const top = V.add(V.add(c.neckBase, V.mul(c.nd, c.NL * t)), [0.02 * H, (c.s.neck.h0 * (1 - t) + c.s.neck.h1 * t) * H * 0.9, 0]);
    const lenL = (0.32 + 0.1 * Math.sin(i * 1.7)) * H;
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const u = k / 4;
      pts.push({ p: V.add(top, [0.06 * H * Math.sin(u * 2.2) + 0.03 * H * u, -lenL * u, -0.06 * H * u + 0.03 * H * Math.sin(u * 5 + i)]), w: 0.05 * H * (1 - 0.6 * u), ht: 0.018 * H, hb: 0.018 * H });
    }
    B.loft(pts, { bones: i < 4 ? ['neck1', 'neck2'] : ['neck2', 'head'], part: 'mane', k: 0.02 * H, up: [1, 0, 0], caps: [0.6, 0.5], noise: { amp: 0.008 * H, freq: 40 / H, seed: 7 + i, oct: 2 } });
  }
  // long forelock, goatee, feathered fetlocks
  B.loft([{ p: hp(0.02, 0.33), w: 0.08 * HL, ht: 0.04 * HL, hb: 0.04 * HL }, { p: hp(0.25, 0.32), w: 0.07 * HL, ht: 0.03 * HL, hb: 0.03 * HL }, { p: hp(0.42, 0.22), w: 0.04 * HL, ht: 0.02 * HL, hb: 0.02 * HL }], { bones: ['head'], part: 'mane', k: 0.03 * HL, noise: { amp: 0.01 * HL, freq: 30 / HL, seed: 2 } });
  B.loft([{ p: hp(0.75, -0.26), w: 0.03 * HL, ht: 0.03 * HL, hb: 0.03 * HL }, { p: hp(0.72, -0.42), w: 0.02 * HL, ht: 0.02 * HL, hb: 0.02 * HL }, { p: hp(0.68, -0.52), w: 0.008 * HL, ht: 0.008 * HL, hb: 0.008 * HL }], { bones: ['jaw'], part: 'mane', k: 0.02 * HL });
  B.sym((sx, S) => {
    for (const [pt, bones] of [[c.fpaw, ['hand' + S, 'fingers' + S]], [c.hpaw, ['foot' + S, 'toes' + S]]]) {
      B.ell(mx([pt[0], pt[1] + 0.06 * H, pt[2] - 0.01 * H], sx), [0.06 * H, 0.08 * H, 0.07 * H], { bones, part: 'mane', k: 0.03 * H, noise: { amp: 0.012 * H, freq: 30 / H, seed: 9 } });
    }
  });
}

// ------------------------------------------------------------------ griffin
const GRIFFIN = {
  H: 1.15,
  torso: [[-0.88, 0.82, 0.64, 0.09], [-0.78, 0.93, 0.56, 0.17], [-0.6, 0.94, 0.58, 0.19], [-0.35, 0.93, 0.6, 0.19], [-0.1, 0.96, 0.5, 0.21], [0.15, 0.99, 0.45, 0.225], [0.35, 1.0, 0.44, 0.22], [0.52, 0.92, 0.47, 0.18], [0.66, 0.74, 0.54, 0.1]],
  hip: [0.12, 0.72, -0.64], knee: [0.14, 0.43, -0.38], hock: [0.115, 0.22, -0.78], hpaw: [0.11, 0.055, -0.72],
  scap: [0.11, 0.9, 0.3], shoulder: [0.16, 0.6, 0.58], elbow: [0.17, 0.44, 0.4], wrist: [0.15, 0.14, 0.44], fpaw: [0.15, 0.06, 0.5],
  spine: [[-0.45, 0.85], [-0.05, 0.87], [0.3, 0.89]], tailBase: [-0.86, 0.84],
  neck: { base: [0.52, 0.8], ang: 52, len: 0.5, w0: 0.17, h0: 0.22, w1: 0.11, h1: 0.13 },
  head: {
    len: 0.36, w: 0.62, pitch: 14, cranium: [0.32, 0.4],
    // the "muzzle" is the eagle beak (keratin through the coat), short lower mandible
    muzzle: [[0.42, 0.3, 0.02, 0.2], [0.6, 0.27, 0.02, 0.15], [0.8, 0.22, 0.03, 0.1], [0.95, 0.14, 0.05, 0.05]], muzzleCap: 0.5,
    jaw: [[0.25, 0.12, 0.17], [0.55, 0.09, 0.13], [0.8, 0.06, 0.07]], slitY: -0.12, slitA: [0.3, 0.92],
    nose: null,
    eye: { a: 0.36, b: 0.17, x: 0.24, r: 0.06, dir: [0.7, 0.12, 0.7], open: 0.75 }, canine: 0, cheekA: 0.3,
  },
  ear: { type: 'erect', len: 0.28, w: 0.16, ang: 26, a: 0.12, b: 0.36, x: 0.18 },
  fore: [[0, 0.03, 0.06, 0.05], [0.5, 0.07, 0.085, 0.08], [1, 0.08, 0.085, 0.1], [1.5, 0.07, 0.07, 0.1], [2, 0.06, 0.06, 0.07], [2.3, 0.045, 0.04, 0.04], [3, 0.03, 0.03, 0.03], [3.6, 0.03, 0.03, 0.03]],
  foot: { size: 1.2 }, hindFoot: { type: 'paw', size: 1.25 }, legR: 1.15, thighW: 1.1, blend: 1.1,
  tail: { len: 0.85, r: 0.032, carry: -72, curl: 30, taper: 0.25, tuft: 0.06, bones: 6 },
  extras: (B, c) => {
    const { H, hp, HL } = c;
    // hooked tip of the beak, brow ridge, feathered chest
    horn(B, [hp(0.82, 0.08), hp(0.97, 0.05), hp(1.06, -0.06), hp(1.07, -0.18)], [0.07 * HL, 0.05 * HL, 0.03 * HL, 0.006 * HL], ['head'], { part: 'muzzle' });
    B.sym((sx) => B.ell(mx(hp(0.32, 0.25, 0.22 * HL), sx), [0.06 * HL, 0.04 * HL, 0.13 * HL], { bones: ['head'], part: 'head', k: 0.03 * HL, axes: c.HX }));
    B.ell([0, 0.62 * H, 0.52 * H], [0.16 * H, 0.2 * H, 0.14 * H], { bones: ['chest', 'neck1'], part: 'chestf', k: 0.06 * H, noise: { amp: 0.012 * H, freq: 18 / H, seed: 4 } });
    featherWing(B, bigWing(5.4, { shoulder: [0.13 * H, 0.95 * H, 0.32 * H], fold: { back: [0.42, -0.22, -1], out: [1, 0.3, 0.1], twist: 10 }, part: 'w' }));
  },
};
GRIFFIN.foot = { type: 'talon', size: 1.25 };

function griffinCoat(v, lm) {
  const p = v.p, H = lm.H;
  const front = v.part === 'head' || v.part === 'neck' || v.part === 'ear' || v.part === 'eyelid' || v.part === 'chestf' || v.part === 'muzzle' || v.part === 'jaw'
    || ((v.part === 'leg' || v.part === 'torso' || v.part === 'chest') && p[2] > 0.3 * H + fbm(p[0] * 8 / H, p[1] * 8 / H, 0, 2, 3) * 0.06 * H);
  const m = { under: REG.under(v, { torso: 0.15, legs: 0.4 }) * 0.6, pattern: 0, points: front ? 1 : 0, extra: 0, shade: 0.5 + 0.15 * fbm(p[0] * 40 / H, p[1] * 40 / H, p[2] * 40 / H, 3, 7) };
  if (front && (v.part === 'head' || v.part === 'neck' || v.part === 'ear' || v.part === 'eyelid')) m.extra = 1; // white eagle head
  if (v.part === 'muzzle' || v.part === 'jaw') { m.region = 'keratin'; m.regionW = 1; }
  if (/^w(primary|secondary|tertial|covert|pcovert)$/.test(v.part)) { m.points = 1; m.pattern = v.part === 'wprimary' ? sstep(0.4, 0.8, v.t) * 0.8 : 0; m.under = v.part === 'wcovert' ? 0.4 : 0; }
  if (v.part === 'wwingarm') m.points = 1;
  if (v.part === 'tuft') m.pattern = 1;
  for (const k of ['under', 'pattern', 'points', 'extra']) m[k] = clamp01(m[k]);
  return m;
}

// ------------------------------------------------------------------ pegasus
const pegasusSpec = () => ({
  ...HORSE,
  extras: (B, c) => {
    horseExtras({ h: 0.065, w: 0.034, start: -0.02, end: 1.02, noise: 0.1 })(B, c);
    const H = c.H;
    featherWing(B, bigWing(6.4, { shoulder: [0.11 * H, 0.96 * H, 0.27 * H], fold: { back: [0.4, -0.2, -1], out: [1, 0.3, 0.1], twist: 10 }, part: 'w', pk: 1.05 }));
  },
});
const pegasusCoat = (v, lm) => {
  const m = mkCoat({ legs: [0.2, 0.32], mane: 1, muzzle: 0.35, shade: 0.25 })(v, lm);
  if (/^w(primary|secondary)$/.test(v.part)) m.pattern = sstep(0.55, 0.9, v.t) * 0.5;
  if (/^w/.test(v.part)) m.shade = 0.5 + 0.08 * (v.t - 0.5);
  return m;
};

const furSleek = { type: 'smooth', scale: 9, normalScale: 0.2, roughness: 0.62, sheen: 0.25, featherRoughness: 0.7 };
const W = (o) => ({ group: 'fantasy', ...o });

export const FANTASY = [
  W({
    id: 'drago', label: 'Drago', family: 'winged', gait: 'digitigrade', tris: 30000, res: 560, defaultPose: 'stand', heightLabel: 'Altezza al garrese circa',
    build: () => quadruped(DRAGON), coat: dragonCoat, fur: { type: 'scales', scale: 3.2, normalScale: 0.55, roughness: 0.5, sheen: 0.1 }, iris: '#e0a020', pupil: 'slit', teethColor: '#ece4cc',
    palettes: [
      { id: 'rosso', label: 'Rosso', colors: { base: '#8a2a1e', under: '#d8a860', pattern: '#4a1410', points: '#2a0e0a', extra: '#b07a40', keratin: '#2a2420', skin: '#6a2a20', nose: '#2a1410', mouth: '#4a1a1a', pad: '#2a1a14', eyelid: '#4a1410' } },
      { id: 'verde', label: 'Verde', colors: { base: '#2e5a30', under: '#c8c070', pattern: '#18321a', points: '#10200e', extra: '#909048', keratin: '#2a2a20', skin: '#3a5a3a', nose: '#14241a', mouth: '#4a1a1a', pad: '#1a2a1a', eyelid: '#18321a' } },
      { id: 'nero', label: 'Nero', colors: { base: '#24242a', under: '#5a5560', pattern: '#121216', points: '#0a0a0c', extra: '#4a4650', keratin: '#d8d0c0', skin: '#3a3040', nose: '#101012', mouth: '#5a1a2a', pad: '#18181c', eyelid: '#121216' } },
      { id: 'oro', label: 'Oro', colors: { base: '#b08a30', under: '#e8d498', pattern: '#7a5a1a', points: '#4a3410', extra: '#c8a860', keratin: '#4a3a22', skin: '#a07a3a', nose: '#3a2a10', mouth: '#4a1a1a', pad: '#3a2a14', eyelid: '#7a5a1a' } },
    ],
  }),
  W({
    id: 'unicorno', label: 'Unicorno', family: 'quadruped', gait: 'unguligrade', tris: 28000, res: 420,
    build: () => quadruped({ ...HORSE, H: 1.55, tail: { ...HORSE.tail, hair: { len: 0.7, w: 0.085, back: 0.22 } }, extras: unicornExtras }),
    coat: mkCoat({ legs: [0.2, 0.3], mane: 1, muzzle: 0.3, extra: { fn: (v) => (v.part === 'horn' ? 1 : v.part === 'feathering' ? 0.7 : 0) }, shade: 0.2 }),
    fur: furSleek, iris: '#3a5a9a', pupil: 'bar',
    palettes: [
      { id: 'bianco', label: 'Bianco', colors: { base: '#f2efe8', points: '#e8e2f0', nose: '#c8b0b0', keratin: '#d8c890', extra: '#e8d890', pad: '#8a8070' } },
      { id: 'argento', label: 'Argento', colors: { base: '#d8dce2', points: '#f4f4f8', nose: '#8a8890', keratin: '#c8ccd4', extra: '#e8eaf0', pad: '#6a6870' } },
      { id: 'nero', label: 'Nero', colors: { base: '#1c1a1e', points: '#2a2232', nose: '#141214', keratin: '#c8b070', extra: '#d0b060', pad: '#2a2622' } },
      { id: 'rosa', label: 'Pastello', colors: { base: '#f4ecee', points: '#c8a0d8', nose: '#d0a8b0', keratin: '#e8d0a0', extra: '#f0c8e0', pad: '#8a7a80' } },
    ],
  }),
  W({
    id: 'grifone', label: 'Grifone', family: 'winged', gait: 'digitigrade', tris: 28000, res: 520, defaultPose: 'stand',
    build: () => quadruped(GRIFFIN), coat: griffinCoat, fur: { type: 'short', scale: 14, normalScale: 0.22, roughness: 0.8, sheen: 0.35, featherRoughness: 0.72 }, iris: '#c08a1e', pupil: 'round', teethColor: '#e8e0cc',
    palettes: [
      { id: 'reale', label: 'Reale', colors: { base: '#b88a50', under: '#d8b888', pattern: '#2a1c12', points: '#5a3c22', extra: '#f0ece2', keratin: '#e0b030', scale: '#e0b030', pad: '#2a2018', eyelid: '#e0b030', mouth: '#7a4a40', skin: '#5a3c22' } },
      { id: 'scuro', label: 'Scuro', colors: { base: '#8a6a44', under: '#b89a70', pattern: '#1a1410', points: '#3a2a1c', extra: '#d8c8a8', keratin: '#3a3634', scale: '#c8a030', pad: '#2a2018', eyelid: '#3a2a1c', mouth: '#7a4a40', skin: '#3a2a1c' } },
      { id: 'bianco', label: 'Bianco', colors: { base: '#e6dccb', under: '#f0e8dc', pattern: '#5a5048', points: '#ece6dc', extra: '#f6f4f0', keratin: '#e0b030', scale: '#e0b030', pad: '#5a5048', eyelid: '#e0b030', mouth: '#7a4a40', skin: '#ece6dc' } },
    ],
  }),
  W({
    id: 'pegaso', label: 'Pegaso', family: 'winged', gait: 'unguligrade', tris: 28000, res: 480, defaultPose: 'stand',
    build: () => quadruped(pegasusSpec()), coat: pegasusCoat, fur: furSleek, iris: '#3a2414', pupil: 'bar',
    palettes: [
      { id: 'bianco', label: 'Bianco', colors: { base: '#f0ede6', points: '#e6e2da', pattern: '#c8c4bc', nose: '#8a7e78', keratin: '#6a625a' } },
      { id: 'grigio', label: 'Grigio', colors: { base: '#b8b6b2', points: '#6a6866', pattern: '#8a8884', nose: '#4a4542', keratin: '#4a4542' } },
      { id: 'morello', label: 'Morello', colors: { base: '#1e1c1c', points: '#121111', pattern: '#2a2626', nose: '#151313', keratin: '#2a2725' } },
      { id: 'palomino', label: 'Palomino', colors: { base: '#d8b46e', points: '#efe3c8', pattern: '#e8d8b0', nose: '#4a3a32', keratin: '#6a5a4c' } },
    ],
  }),
];
void crestMane;
