// Snake (build time): a long tapered body on a spine chain rooted in the
// middle (hips), a broad head with a jaw that opens wide, fangs and a forked
// tongue, ventral scutes and four coat patterns in separate masks (saddles,
// dorsal zigzag, rings, belly) so a palette picks python, viper, green snake
// or banded krait. Rest pose: straight, the head toward +Z.
//
// Bones: hips (root, 42% from the snout) > spine1..spine6 (toward the head) >
// head > jaw; hips > tail1..tail14 (toward the tail tip).
import { Builder, mx, V } from './builder.js';
import { sstep, fbm, clamp01, cells } from './coat.js';

const NF = 6, NB = 14;

export function serpent(s) {
  const L = s.L, B = new Builder();
  const zOf = (t) => (0.5 - t) * L; // t = 0 snout .. 1 tail tip
  const tHips = 0.42, tNeck = 0.045;
  const R = (t) => { // body radius profile
    const head = 0.62, mid = 1, vent = 0.5;
    if (t < 0.09) return s.r * (head + (0.66 - head) * sstep(0.0, 0.09, t));
    if (t < 0.4) return s.r * (0.66 + (mid - 0.66) * sstep(0.09, 0.4, t));
    if (t < 0.82) return s.r * (mid - (mid - vent - 0.12) * sstep(0.5, 0.82, t));
    return s.r * (vent + 0.12) * (1 - sstep(0.82, 1.0, t) * 0.92);
  };
  const yC = (t) => R(t) * 0.86; // body lies on the ground
  const pt = (t) => [0, yC(t), zOf(t)];
  // ---- bones
  B.bone('hips', null, pt(tHips), pt(tHips - (tHips - tNeck) / NF));
  let prev = 'hips';
  for (let i = 1; i <= NF; i++) {
    const t0 = tHips - (tHips - tNeck) * ((i - 1) / NF), t1 = tHips - (tHips - tNeck) * (i / NF);
    B.bone('spine' + i, prev, pt(t0), pt(t1));
    prev = 'spine' + i;
  }
  const H = s.head;
  B.bone('head', 'spine' + NF, pt(tNeck), [0, yC(0.02), 0.5 * L]);
  const jawP = [0, yC(tNeck) - H.h * 0.35, zOf(tNeck) + H.len * 0.12];
  B.bone('jaw', 'head', jawP, [0, H.h * 0.25, 0.5 * L - 0.004]);
  prev = 'hips';
  for (let i = 1; i <= NB; i++) {
    const t0 = tHips + (1 - tHips) * Math.pow((i - 1) / NB, 1.08), t1 = tHips + (1 - tHips) * Math.pow(i / NB, 1.08);
    B.bone('tail' + i, prev, pt(t0), pt(t1));
    prev = 'tail' + i;
  }
  const ctx = { B, s, L, zOf, R, yC, pt, H: s.r * 2, tHips };
  // ---- body: tapered loft, slightly flattened with a flat belly
  const st = [];
  for (let i = 0; i <= 40; i++) {
    const t = 0.03 + (0.995 - 0.03) * Math.pow(i / 40, 1.0);
    const r = R(t);
    st.push({ p: pt(t), w: r * 1.12, ht: r, hb: r * 0.82 });
  }
  const bodyBones = ['hips', ...Array.from({ length: NF }, (_, i) => 'spine' + (i + 1)), ...Array.from({ length: NB }, (_, i) => 'tail' + (i + 1))];
  B.loft(st, { bones: bodyBones, part: 'torso', k: 0, caps: [0.7, 0.9], res: 4 });
  // ---- head: broad skull behind the eyes, rounded snout, lower jaw, mouth line
  const hz = zOf(0) - H.len * 0.5; // head centre
  const hc = [0, yC(0.03) + H.h * 0.1, hz];
  B.ell(hc, [H.w * 0.5, H.h * 0.42, H.len * 0.52], { bones: ['head'], part: 'head', k: s.r * 0.25 });
  B.sym((sx) => B.ell([sx * H.w * 0.28, hc[1] - H.h * 0.08, hz - H.len * 0.18], [H.w * 0.24, H.h * 0.3, H.len * 0.3], { bones: ['head'], part: 'head', k: s.r * 0.3 }));
  B.ell([0, hc[1] - H.h * 0.02, hz + H.len * 0.3], [H.w * 0.33, H.h * 0.26, H.len * 0.24], { bones: ['head'], part: 'snout', k: s.r * 0.2 });
  // lower jaw
  B.loft([{ p: [0, jawP[1] - H.h * 0.04, hz - H.len * 0.3], w: H.w * 0.44, ht: H.h * 0.13, hb: H.h * 0.13 }, { p: [0, jawP[1] - H.h * 0.02, hz + H.len * 0.2], w: H.w * 0.33, ht: H.h * 0.11, hb: H.h * 0.1 }, { p: [0, jawP[1], hz + H.len * 0.45], w: H.w * 0.18, ht: H.h * 0.08, hb: H.h * 0.08 }],
    { bones: ['jaw'], part: 'jaw', k: s.r * 0.15, caps: [0.6, 0.8] });
  // mouth line
  const my = jawP[1] + H.h * 0.09;
  B.ell([0, my, hz + H.len * 0.05], [H.w * 0.6, Math.max(0.0012, H.h * 0.035), H.len * 0.5], { op: 'sub', k: H.h * 0.04, mat: 'mouth', carve: H.h * 0.06 });
  // nostrils, eyes, fangs, tongue
  B.sym((sx) => B.ball([sx * H.w * 0.13, hc[1] + H.h * 0.06, zOf(0) - H.len * 0.06], H.w * 0.035, { op: 'sub', k: H.w * 0.02, mat: 'nose', carve: H.w * 0.03 }));
  B.eye([H.w * 0.3, hc[1] + H.h * 0.12, hz + H.len * 0.12], H.eye * H.w, [0.82, 0.32, 0.48], { open: 0.95, protrude: 0.45, wide: 1.0, lidMat: 'fur', k: H.w * 0.03 });
  if (s.fangs) B.tooth('head', [H.w * 0.16, my - H.h * 0.01, hz + H.len * 0.33], [H.w * 0.15, my - H.h * 0.2, hz + H.len * 0.3], H.w * 0.03, { sym: true });
  // forked tongue on the floor of the mouth (shows when it opens)
  const tg0 = [0, jawP[1] + H.h * 0.05, hz - H.len * 0.2], tg1 = [0, jawP[1] + H.h * 0.06, hz + H.len * 0.36];
  B.cone(tg0, tg1, H.w * 0.06, H.w * 0.035, { bones: ['jaw'], part: 'tongue', mat: 'mouth', k: H.w * 0.02 });
  B.sym((sx) => B.cone(tg1, [sx * H.w * 0.06, tg1[1], tg1[2] + H.len * 0.12], H.w * 0.03, H.w * 0.012, { bones: ['jaw'], part: 'tongue', mat: 'mouth', k: H.w * 0.01 }));
  // flat belly (ventral scutes lie on the ground)
  B.box([0, -0.05, 0], [0.3, 0.05 + s.r * 0.12, L], 0.001, { op: 'sub', k: s.r * 0.3 });
  return { B, lm: { ...ctx, headCenter: hc, headFit: H.len * 1.1, HL: H.len } };
}

const SNAKE = { L: 1.8, r: 0.032, fangs: true, head: { len: 0.065, w: 0.048, h: 0.03, eye: 0.11 } };

/** Coat: belly scutes (under), python saddles (pattern), viper zigzag (extra), rings (points). */
function snakeCoat(v, lm) {
  const p = v.p, L = lm.L;
  const t = 0.5 - p[2] / L; // 0 snout .. 1 tail
  const r = lm.R(Math.max(0.03, Math.min(0.99, t)));
  const yc = lm.yC(Math.max(0.03, Math.min(0.99, t)));
  const up = (p[1] - yc) / r; // -1 belly .. +1 back
  const ang = Math.atan2(p[0], p[1] - yc); // 0 = top
  const m = { under: 0, pattern: 0, points: 0, extra: 0, shade: 0.5 + 0.15 * fbm(p[0] * 60, p[1] * 60, p[2] * 60, 2, 3) };
  // belly: lighter, with scute lines
  const belly = sstep(-0.35, -0.65, up);
  m.under = belly * (0.85 + 0.15 * Math.sin(t * L * 520));
  const head = v.part === 'head' || v.part === 'snout' || v.part === 'jaw';
  // python saddles: irregular blotches along the back and flanks (cellular)
  const c = cells([p[0] * 1.5, p[1] * 1.5, p[2] * 0.6], 26, 7);
  const saddle = sstep(0.46, 0.34, c.d1) * (1 - belly);
  m.pattern = head ? sstep(0.3, 0.6, up) * sstep(0.2, -0.1, Math.abs(p[0]) - lm.s.head.w * 0.12) * 0.8 : saddle;
  // viper zigzag on the dorsal line
  const zz = Math.abs(ang - 0.45 * Math.sin(t * L * 42)) < 0.32 ? 1 : 0;
  m.extra = head ? sstep(0.4, 0.8, up) * 0.7 : zz * sstep(-0.2, 0.2, up) * (1 - sstep(0.9, 1.0, t));
  // rings (banded)
  m.points = head ? 0.0 : sstep(0.45, 0.55, Math.abs(Math.sin(t * L * 7.5))) * (1 - belly * 0.7);
  if (v.part === 'tongue') { m.region = 'mouth'; m.regionW = 1; }
  for (const k of ['under', 'pattern', 'points', 'extra']) m[k] = clamp01(m[k]);
  return m;
}

const scales = { type: 'scales', scale: 26, normalScale: 0.4, roughness: 0.45, sheen: 0.1 };

export const SERPENTS = [
  {
    id: 'serpente', label: 'Serpente', sub: '', group: 'rettili', family: 'serpent', gait: 'serpent', tris: 16000, res: 900,
    heightLabel: 'Lunghezza circa', defaultPose: 'slither', origin: [0, 0, 0], blend: 0.04,
    build: () => serpent(SNAKE), coat: snakeCoat, fur: scales, iris: '#c09028', pupil: 'slit', teethColor: '#f2ede2',
    palettes: [
      { id: 'pitone', label: 'Pitone', colors: { base: '#a0814a', under: '#e0d4b0', pattern: '#3e2c18', extra: '#a0814a', points: '#a0814a', mouth: '#2a1a1e', nose: '#2a2018', eyelid: '#6a5430' } },
      { id: 'vipera', label: 'Vipera', colors: { base: '#8a7e6c', under: '#5a5650', pattern: '#8a7e6c', extra: '#2a221c', points: '#8a7e6c', mouth: '#2a1a1e', nose: '#2a2018', eyelid: '#5a5040' } },
      { id: 'verde', label: 'Verde', colors: { base: '#3e8a2c', under: '#c8d860', pattern: '#3e8a2c', extra: '#3e8a2c', points: '#3e8a2c', mouth: '#2a1a1e', nose: '#2a3a20', eyelid: '#3e8a2c' } },
      { id: 'anelli', label: 'Ad anelli', colors: { base: '#ece6d8', under: '#e8e2d4', pattern: '#ece6d8', extra: '#ece6d8', points: '#16161a', mouth: '#2a1a1e', nose: '#16161a', eyelid: '#2a2a2a' } },
      { id: 'nero', label: 'Nero', colors: { base: '#1a1a1e', under: '#4a4a50', pattern: '#1a1a1e', extra: '#1a1a1e', points: '#1a1a1e', mouth: '#2a1a1e', nose: '#101012', eyelid: '#1a1a1e' } },
    ],
  },
];
void mx; void V;
