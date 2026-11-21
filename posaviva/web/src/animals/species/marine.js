// Marine animals (build time): streamlined body on a spine chain, fins,
// mouth on a jaw bone with rows of teeth. The shark swims by bending its
// body sideways, the dolphin up and down (family 'marine', see
// families/marine.js). The animal faces +Z, its left is +X.
//
// Bones: hips (root, centre of mass) > chest > head > jaw;
// hips > tail1..tail5 (caudal fin on the last ones); chest > fin.L/R
// (pectoral fins); hips > pelvic.L/R.
import { Builder, mx, V } from './builder.js';
import { mkCoat, sstep, fbm, clamp01 } from './coat.js';

/**
 * spec (fractions of the length L, z from the tail fork (-0.5) to the snout (+0.5)):
 * L, body: [[z, top, bottom, halfWidth]], hipsZ, chestZ, headZ, mouth {z0, z1, y, depth, w, teeth, up},
 * eye {z, y, x, r}, gills, pectoral {z, y, x, len, w, ang, droop, sweep}, dorsal {z0, z1, h, sweep},
 * caudal {upper, lower, sweep, lunate} | flukes {span, chord}, extras(B, ctx)
 */
export function marine(s) {
  const L = s.L, B = new Builder();
  const P = (z, y = 0, x = 0) => [x * L, y * L, z * L];
  const T = s.body;
  // spine points: hips at hipsZ, tail chain to the fork, chest / head forward
  const zh = s.hipsZ, zt = T[0][0];
  const yAt = (z) => { // body centre line (y) from the stations
    for (let i = 0; i < T.length - 1; i++) if (z >= T[i][0] && z <= T[i + 1][0]) { const t = (z - T[i][0]) / (T[i + 1][0] - T[i][0]); const a = (T[i][1] - T[i][2]) / 2, b = (T[i + 1][1] - T[i + 1][2]) / 2; return a + (b - a) * t; }
    return 0;
  };
  const sp = (z) => P(z, yAt(z));
  const nT = 5;
  const tailPts = [];
  for (let i = 0; i <= nT; i++) tailPts.push(sp(zh + (zt + 0.02 - zh) * Math.pow(i / nT, 0.9)));
  B.bone('hips', null, sp(zh), sp(s.chestZ));
  B.bone('chest', 'hips', sp(s.chestZ), sp(s.headZ));
  B.bone('head', 'chest', sp(s.headZ), sp(T[T.length - 1][0]));
  const M = s.mouth;
  B.bone('jaw', 'head', P(M.z0, M.y), P(M.z1, M.y - M.depth * 0.5));
  for (let i = 0; i < nT; i++) B.bone('tail' + (i + 1), i ? 'tail' + i : 'hips', tailPts[i], tailPts[i + 1]);
  const pc = s.pectoral;
  B.sym((sx, S) => {
    const root = P(pc.z, pc.y, pc.x * sx);
    B.bone('fin' + S, 'chest', root, V.add(root, [sx * pc.len * L * 0.8, -pc.len * L * pc.droop, -pc.len * L * pc.sweep]));
    if (s.pelvic) { const pr = P(s.pelvic.z, s.pelvic.y, s.pelvic.x * sx); B.bone('pelvic' + S, 'hips', pr, V.add(pr, [sx * 0.03 * L, -0.02 * L, -0.06 * L])); }
  });
  const ctx = { B, s, L, P, sp, yAt, tailPts };

  // ---- body
  B.loft(T.map(([z, top, bot, w]) => ({ p: P(z, (top - bot) / 2), w: w * L, ht: ((top + bot) / 2) * L, hb: ((top + bot) / 2) * L })),
    { bones: ['hips', 'chest', 'head', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5'], part: 'torso', k: 0, caps: s.caps || [0.7, 0.9], res: 6 });
  // ---- mouth: lower jaw volume, slit, teeth
  M.build?.(B, ctx);
  // ---- eyes
  const E = s.eye;
  B.eye(P(E.z, E.y, E.x), E.r * L, E.dir || [0.9, 0.15, 0.4], { open: E.open ?? 0.95, protrude: E.protrude ?? 0.45, wide: 1.0, lidMat: 'skin', k: E.r * L * 0.3 });
  // ---- pectoral fins (thin, swept back), on their own bones
  B.sym((sx, S) => {
    const root = P(pc.z, pc.y, pc.x * sx);
    const tip = V.add(root, [sx * pc.len * L * 0.8, -pc.len * L * pc.droop, -pc.len * L * pc.sweep]);
    const mid = V.lerp(root, tip, 0.45);
    const th = pc.th * L;
    const up = V.norm(V.cross(V.sub(tip, root), [0, 0, 1])).map((v) => v * sx);
    B.loft([
      { p: V.add(root, [-sx * pc.w * L * 0.2, 0, 0]), w: pc.w * L * 0.5, ht: th, hb: th },
      { p: V.add(mid, [0, 0, -pc.w * L * 0.1]), w: pc.w * L * 0.42, ht: th * 0.7, hb: th * 0.7 },
      { p: tip, w: pc.w * L * 0.08, ht: th * 0.35, hb: th * 0.35 },
    ], { bones: ['fin' + S], part: 'fin', k: th * 1.5, up: [0, 1, 0], caps: [0.6, 0.8] });
    void up;
  });
  // ---- dorsal fin
  const D = s.dorsal;
  if (D) {
    const b0 = sp(D.z0), b1 = sp(D.z1);
    const yTop = (z) => (T.reduce((a, r) => (Math.abs(r[0] - z) < Math.abs(a[0] - z) ? r : a))[1]) * L * 0.92;
    const base0 = [0, b0[1] + yTop(D.z0), b0[2]], base1 = [0, b1[1] + yTop(D.z1), b1[2]];
    const tip = [0, base0[1] + D.h * L, base0[2] - D.sweep * L];
    const th = D.th * L;
    // a fin = loft from the base centre to the tip with a chord that narrows (falcate trailing edge)
    const bc = V.lerp(base0, base1, 0.45);
    B.loft([
      { p: V.add(bc, [0, -0.02 * L, 0]), w: th, ht: V.dist(base0, base1) * 0.55, hb: V.dist(base0, base1) * 0.55 },
      { p: V.lerp(bc, tip, 0.5), w: th * 0.65, ht: V.dist(base0, base1) * 0.3, hb: V.dist(base0, base1) * 0.32 },
      { p: tip, w: th * 0.3, ht: 0.012 * L, hb: 0.012 * L },
    ], { bones: ['hips', 'chest'], part: 'dorsal', k: th * 1.2, up: [0, 0, 1], caps: [0.5, 0.7] });
  }
  s.extras?.(B, ctx);
  return { B, lm: { ...ctx, H: s.L, HL: 0.2 * L, headCenter: P(0.38, 0), headFit: 0.16 * L } };
}

/** Thin fin lofted from a base point along a direction (used for caudal lobes, small fins). */
export function fin(B, base, tip, chord, th, bones, part, o = {}) {
  const mid = V.lerp(base, tip, 0.5);
  return B.loft([
    { p: base, w: th, ht: chord * 0.5, hb: chord * 0.5 },
    { p: V.add(mid, o.midOff || [0, 0, 0]), w: th * 0.6, ht: chord * 0.32, hb: chord * 0.32 },
    { p: tip, w: th * 0.3, ht: chord * 0.04, hb: chord * 0.04 },
  ], { bones, part, k: th * 1.5, up: o.up || [0, 0, 1], caps: [0.5, 0.6] });
}

// ------------------------------------------------------------------ shark
const SHARK = {
  L: 4.0, hipsZ: 0.02, chestZ: 0.2, headZ: 0.3,
  body: [[-0.45, 0.022, 0.02, 0.02], [-0.4, 0.024, 0.02, 0.028], [-0.34, 0.04, 0.034, 0.04], [-0.24, 0.065, 0.055, 0.062], [-0.12, 0.085, 0.075, 0.084], [0.0, 0.098, 0.088, 0.098], [0.12, 0.103, 0.095, 0.104], [0.24, 0.094, 0.085, 0.095], [0.33, 0.076, 0.064, 0.078], [0.4, 0.056, 0.045, 0.058], [0.45, 0.036, 0.028, 0.038], [0.485, 0.018, 0.016, 0.02]],
  caps: [0.6, 0.7],
  mouth: {
    z0: 0.33, z1: 0.43, y: -0.04, depth: 0.05, w: 0.05,
    build: (B, c) => {
      const { P, L } = c;
      // lower jaw (on the jaw bone): a crescent under the snout
      B.loft([{ p: P(0.31, -0.045), w: 0.07 * L, ht: 0.03 * L, hb: 0.035 * L }, { p: P(0.37, -0.05), w: 0.058 * L, ht: 0.025 * L, hb: 0.028 * L }, { p: P(0.415, -0.044), w: 0.035 * L, ht: 0.016 * L, hb: 0.018 * L }],
        { bones: ['jaw'], part: 'jaw', k: 0.02 * L, caps: [0.6, 0.8] });
      // mouth slit: a curved gap between the snout and the lower jaw
      B.ell(P(0.37, -0.027), [0.062 * L, 0.006 * L, 0.06 * L], { op: 'sub', k: 0.006 * L, mat: 'mouth', carve: 0.012 * L });
      B.ell(P(0.36, -0.032), [0.05 * L, 0.012 * L, 0.04 * L], { op: 'sub', k: 0.006 * L, mat: 'mouth', carve: 0.01 * L });
      // teeth: triangular rows along the upper and lower jaw arcs
      for (let i = 0; i < 9; i++) {
        const a = (i / 8) * 0.95, x = Math.sin(a * 1.45) * 0.05, z = 0.405 - (1 - Math.cos(a * 1.45)) * 0.065;
        for (const sx of i ? [1, -1] : [1]) {
          B.tooth('head', P(z, -0.02, x * sx), P(z - 0.002, -0.035, x * sx * 0.98), 0.0055 * L * (1 - a * 0.35));
          B.tooth('jaw', P(z - 0.004, -0.04, x * sx * 0.93), P(z - 0.004, -0.027, x * sx * 0.92), 0.0045 * L * (1 - a * 0.35));
        }
      }
    },
  },
  eye: { z: 0.4, y: 0.012, x: 0.034, r: 0.0065, dir: [0.95, 0.12, 0.3] },
  pectoral: { z: 0.17, y: -0.055, x: 0.07, len: 0.2, w: 0.075, th: 0.008, droop: 0.32, sweep: 0.42 },
  pelvic: { z: -0.14, y: -0.06, x: 0.035 },
  dorsal: { z0: 0.1, z1: -0.04, h: 0.13, sweep: 0.08, th: 0.01 },
  extras: (B, c) => {
    const { P, L, tailPts } = c;
    // gill slits
    B.sym((sx) => { for (let i = 0; i < 5; i++) B.ell(P(0.28 - i * 0.018, -0.005, 0.088 * sx), [0.006 * L, 0.04 * L, 0.0025 * L], { op: 'sub', k: 0.003 * L, mat: 'skin', carve: 0.004 * L }); });
    // caudal fin: long upper lobe, shorter lower lobe, on the last tail bones
    const t5 = tailPts[5], t4 = tailPts[4];
    fin(B, V.add(t4, [0, 0.01 * L, -0.01 * L]), V.add(t5, [0, 0.2 * L, -0.12 * L]), 0.07 * L, 0.009 * L, ['tail4', 'tail5'], 'caudal', { midOff: [0, 0.0, 0.01 * L] });
    fin(B, V.add(t4, [0, -0.01 * L, -0.01 * L]), V.add(t5, [0, -0.15 * L, -0.08 * L]), 0.06 * L, 0.009 * L, ['tail4', 'tail5'], 'caudal');
    // lateral keels on the caudal peduncle, pelvic fins, second dorsal and anal fins
    B.sym((sx, S) => {
      B.ell(V.add(V.lerp(t4, t5, 0.3), [sx * 0.022 * L, 0, 0]), [0.008 * L, 0.006 * L, 0.05 * L], { bones: ['tail4'], part: 'torso', k: 0.01 * L });
      const pr = P(-0.14, -0.06, 0.035 * sx);
      fin(B, pr, V.add(pr, [sx * 0.035 * L, -0.03 * L, -0.06 * L]), 0.04 * L, 0.006 * L, ['pelvic' + S], 'fin', { up: [0, 1, 0] });
    });
    const d2 = c.sp(-0.3);
    fin(B, [0, d2[1] + 0.035 * L, d2[2]], [0, d2[1] + 0.07 * L, d2[2] - 0.035 * L], 0.03 * L, 0.006 * L, ['tail2', 'tail3'], 'dorsal');
    const a2 = c.sp(-0.31);
    fin(B, [0, a2[1] - 0.03 * L, a2[2]], [0, a2[1] - 0.06 * L, a2[2] - 0.035 * L], 0.028 * L, 0.006 * L, ['tail2', 'tail3'], 'fin');
  },
};

// countershading: dark back, sharp lateral line, white belly
const sharkCoat = (v, lm) => {
  const L = lm.L, p = v.p;
  const cy = lm.yAt(p[2] / L) * L;
  const below = sstep(cy - 0.01 * L + fbm(p[0] * 3, p[2] * 2, 0, 3, 4) * 0.02 * L, cy - 0.03 * L, p[1]);
  const m = { under: below, pattern: 0, points: 0, extra: 0, shade: 0.5 + 0.12 * fbm(p[0] * 9, p[1] * 9, p[2] * 9, 3, 2) };
  if (v.part === 'fin') { m.under = sstep(0.0, -0.5, v.n[1]) * 0.9; m.points = sstep(0.8, 1.0, v.t) * 0.6; }
  if (v.part === 'dorsal' || v.part === 'caudal') { m.under = 0; m.points = sstep(0.75, 1.0, v.t) * 0.5; }
  if (v.part === 'jaw') m.under = 1;
  m.under = clamp01(m.under);
  return m;
};

// ------------------------------------------------------------------ dolphin
const DOLPHIN = {
  L: 2.6, hipsZ: 0.04, chestZ: 0.2, headZ: 0.3,
  body: [[-0.47, 0.012, 0.012, 0.012], [-0.42, 0.03, 0.028, 0.016], [-0.34, 0.056, 0.05, 0.03], [-0.22, 0.085, 0.078, 0.06], [-0.08, 0.1, 0.092, 0.08], [0.06, 0.104, 0.098, 0.088], [0.18, 0.096, 0.09, 0.082], [0.28, 0.08, 0.075, 0.07], [0.35, 0.072, 0.056, 0.058], [0.4, 0.066, 0.04, 0.048], [0.43, 0.04, 0.024, 0.028], [0.47, 0.02, 0.019, 0.02], [0.495, 0.012, 0.012, 0.013]],
  caps: [0.6, 0.6],
  mouth: {
    z0: 0.37, z1: 0.495, y: -0.012, depth: 0.03, w: 0.02,
    build: (B, c) => {
      const { P, L } = c;
      // melon (rounded forehead) and the lower jaw of the beak
      B.ell(P(0.385, 0.03), [0.05 * L, 0.04 * L, 0.05 * L], { bones: ['head'], part: 'melon', k: 0.02 * L });
      B.loft([{ p: P(0.37, -0.03), w: 0.04 * L, ht: 0.02 * L, hb: 0.024 * L }, { p: P(0.44, -0.024), w: 0.022 * L, ht: 0.011 * L, hb: 0.012 * L }, { p: P(0.5, -0.02), w: 0.012 * L, ht: 0.007 * L, hb: 0.008 * L }],
        { bones: ['jaw'], part: 'jaw', k: 0.012 * L, caps: [0.6, 0.9] });
      B.ell(P(0.445, -0.012), [0.03 * L, 0.0025 * L, 0.07 * L], { op: 'sub', k: 0.003 * L, mat: 'mouth', carve: 0.004 * L });
      // blowhole
      B.ell(P(0.335, 0.075), [0.008 * L, 0.006 * L, 0.004 * L], { op: 'sub', k: 0.004 * L, mat: 'mouth', carve: 0.004 * L });
      for (let i = 0; i < 10; i++) {
        const z = 0.49 - i * 0.012, x = 0.006 + i * 0.0018;
        for (const sx of [1, -1]) {
          B.tooth('head', P(z, -0.009, x * sx), P(z, -0.014, x * sx), 0.0016 * L);
          B.tooth('jaw', P(z - 0.004, -0.017, x * sx * 0.95), P(z - 0.004, -0.012, x * sx * 0.95), 0.0015 * L);
        }
      }
    },
  },
  eye: { z: 0.365, y: 0.0, x: 0.05, r: 0.0055, dir: [0.95, 0.1, 0.3] },
  pectoral: { z: 0.2, y: -0.06, x: 0.06, len: 0.14, w: 0.06, th: 0.009, droop: 0.42, sweep: 0.5 },
  pelvic: null,
  dorsal: { z0: 0.04, z1: -0.1, h: 0.12, sweep: 0.12, th: 0.01 },
  extras: (B, c) => {
    const { L, tailPts } = c;
    // flukes: horizontal, swept back, on the last tail bones
    const t5 = tailPts[5], t4 = tailPts[4];
    B.sym((sx) => {
      const base = V.add(V.lerp(t4, t5, 0.6), [sx * 0.01 * L, 0, 0]);
      const tip = V.add(t5, [sx * 0.13 * L, 0, -0.06 * L]);
      B.loft([
        { p: base, w: 0.045 * L, ht: 0.009 * L, hb: 0.009 * L },
        { p: V.lerp(base, tip, 0.5), w: 0.035 * L, ht: 0.006 * L, hb: 0.006 * L },
        { p: tip, w: 0.008 * L, ht: 0.003 * L, hb: 0.003 * L },
      ], { bones: ['tail4', 'tail5'], part: 'fluke', k: 0.012 * L, up: [0, 1, 0], caps: [0.5, 0.7] });
    });
  },
};
const dolphinCoat = (v, lm) => {
  const L = lm.L, p = v.p;
  const cy = lm.yAt(p[2] / L) * L;
  // grey cape on the back, paler flanks, white belly
  const flank = sstep(cy + 0.03 * L, cy - 0.01 * L, p[1] + fbm(p[2] * 2, 0, 0, 2, 4) * 0.01 * L);
  const belly = sstep(cy - 0.02 * L, cy - 0.05 * L, p[1]);
  const m = { under: belly, pattern: flank * 0.6, points: 0, extra: 0, shade: 0.5 + 0.08 * fbm(p[0] * 9, p[1] * 9, p[2] * 9, 3, 2) };
  if (v.part === 'fin' || v.part === 'fluke') { m.under = sstep(0, -0.6, v.n[1]) * 0.4; m.pattern = 0; m.points = 0.3; }
  if (v.part === 'dorsal') { m.under = 0; m.pattern = 0; m.points = 0.3; }
  if (v.part === 'jaw') { m.under = 0.9; }
  return m;
};

const skinSmooth = { type: 'smooth', scale: 3, normalScale: 0.12, roughness: 0.42, sheen: 0.05 };
const skinShark = { type: 'scales', scale: 10, normalScale: 0.1, roughness: 0.55, sheen: 0.05 };

export const MARINE = [
  {
    id: 'squalo', label: 'Squalo', sub: 'Squalo bianco', group: 'marini', family: 'marine', gait: 'lateral', tris: 18000, res: 520,
    heightLabel: 'Lunghezza circa', defaultPose: 'swim',
    build: () => marine(SHARK), coat: sharkCoat, fur: skinShark, iris: '#0c0c0e', pupil: 'round', teethColor: '#f0ece2',
    palettes: [
      { id: 'bianco', label: 'Bianco', colors: { base: '#5e676e', under: '#ecebe6', points: '#2a2e32', mouth: '#5a3036', skin: '#3a4046', keratin: '#2a2e32' } },
      { id: 'tigre', label: 'Grigio scuro', colors: { base: '#4a4f52', under: '#d8d6cf', points: '#1e2124', mouth: '#7a3a40', skin: '#1e2124', keratin: '#1e2124' } },
      { id: 'azzurro', label: 'Verdesca', colors: { base: '#36608a', under: '#eceae4', points: '#24405e', mouth: '#7a3a40', skin: '#24405e', keratin: '#24405e' } },
    ],
  },
  {
    id: 'delfino', label: 'Delfino', sub: 'Tursiope', group: 'marini', family: 'marine', gait: 'vertical', tris: 16000, res: 480,
    heightLabel: 'Lunghezza circa', defaultPose: 'swim',
    build: () => marine(DOLPHIN), coat: dolphinCoat, fur: skinSmooth, iris: '#2a1c14', pupil: 'round', teethColor: '#ece6d8',
    palettes: [
      { id: 'grigio', label: 'Grigio', colors: { base: '#6a737b', under: '#e6e4e0', pattern: '#98a0a6', points: '#4e565c', mouth: '#8a5a5e', skin: '#3a4046' } },
      { id: 'scuro', label: 'Scuro', colors: { base: '#3e454c', under: '#d8d8d4', pattern: '#6a7278', points: '#2a3036', mouth: '#8a5a5e', skin: '#2a3036' } },
    ],
  },
];
void mx; void mkCoat;
