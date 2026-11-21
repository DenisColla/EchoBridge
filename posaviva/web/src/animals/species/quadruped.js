// Quadruped archetype: one body plan for carnivores, ungulates, bears,
// pachyderms, rabbits. A species is a side-view description in units of its
// withers height H (z forward from the body centre, y up, x = half width):
//   torso   [[z, top, bottom, halfWidth, widest?]]  silhouette stations
//   joints  hip knee hock hpaw / scap shoulder elbow wrist fpaw  ([x, y, z])
//   spine   [[z, y] lumbar, thoracic, withers], tailBase [z, y]
//   neck    {base:[z, y], ang, len, w0, h0, w1, h1, crest}
//   head    {len, pitch, w, cranium:[h, l], muzzle:[[a, top, bottom, w]], jaw:[[a, depth, w]], slit, nose, eye, ear}
//   legs    radius profiles (fore / hind) and foot type
//   tail    {len, r, carry, curl, bushy, tuft, hair, bones}
//   extras(B, ctx)  horns, antlers, trunk, mane … (species code)
// The archetype builds the skeleton (shared bone names, see README.md) and the
// body primitives; it returns landmarks for the coat functions.
import { Builder, mx, V } from './builder.js';

const D = (deg) => (deg * Math.PI) / 180;

export const DOG = {
  H: 0.57,
  torso: [
    [-0.62, 0.8, 0.66, 0.07], [-0.54, 0.93, 0.6, 0.14], [-0.4, 0.965, 0.6, 0.165], [-0.22, 0.965, 0.63, 0.165],
    [-0.04, 0.975, 0.52, 0.19], [0.14, 0.99, 0.46, 0.205], [0.3, 1.0, 0.46, 0.2], [0.44, 0.93, 0.5, 0.17], [0.57, 0.75, 0.55, 0.1],
  ],
  hip: [0.11, 0.74, -0.42], knee: [0.13, 0.44, -0.22], hock: [0.105, 0.22, -0.56], hpaw: [0.1, 0.045, -0.52],
  scap: [0.1, 0.9, 0.24], shoulder: [0.15, 0.6, 0.5], elbow: [0.16, 0.45, 0.31], wrist: [0.135, 0.13, 0.35], fpaw: [0.135, 0.045, 0.4],
  spine: [[-0.28, 0.86], [-0.02, 0.87], [0.24, 0.89]], tailBase: [-0.6, 0.86],
  neck: { base: [0.44, 0.8], ang: 46, len: 0.46, w0: 0.15, h0: 0.2, w1: 0.1, h1: 0.12 },
  head: {
    len: 0.44, pitch: 12, w: 0.6, cranium: [0.27, 0.34],
    // a (0 = poll .. 1 = nose tip), top (above the mouth line), bottom (flews below it), w (x HL)
    muzzle: [[0.4, 0.34, 0.02, 0.21], [0.55, 0.28, 0.045, 0.18], [0.78, 0.24, 0.055, 0.16], [0.97, 0.21, 0.03, 0.14]],
    jaw: [[0.2, 0.17, 0.17], [0.5, 0.13, 0.14], [0.9, 0.1, 0.1]],
    slitY: -0.16, slitA: [0.5, 1.02], nose: { a: 0.985, b: 0.03, w: 0.09, h: 0.075, d: 0.06, nostril: 0.02 },
    eye: { a: 0.4, b: 0.17, x: 0.2, r: 0.052, dir: [0.55, 0.12, 0.83] },
    canine: 0.09,
  },
  ear: { type: 'drop', size: 1, a: 0.2, b: 0.24, x: 0.26, len: 0.5, w: 0.15, out: 0.06, fwd: 0.07 },
  fore: [[0, 0.03, 0.06, 0.05], [0.5, 0.06, 0.075, 0.07], [1, 0.065, 0.07, 0.09], [1.5, 0.06, 0.06, 0.095], [2, 0.05, 0.05, 0.06], [2.3, 0.05, 0.055, 0.042], [3, 0.036, 0.035, 0.034], [3.6, 0.034, 0.032, 0.03], [4, 0.036, 0.03, 0.03]],
  hind: [[0, 0.09, 0.13, 0.15], [0.45, 0.085, 0.1, 0.13], [1, 0.055, 0.06, 0.07], [1.35, 0.052, 0.045, 0.085], [1.75, 0.04, 0.033, 0.05], [2, 0.035, 0.034, 0.05], [2.6, 0.034, 0.03, 0.03], [3, 0.035, 0.03, 0.03]],
  foot: { type: 'paw', size: 1 },
  tail: { len: 0.7, r: 0.062, taper: 0.72, carry: -18, curl: 12, bushy: 0, bones: 5 },
  blend: 1,
};

export function quadruped(spec) {
  const s = { ...DOG, ...spec, head: { ...DOG.head, ...(spec.head || {}) }, neck: { ...DOG.neck, ...(spec.neck || {}) }, tail: { ...DOG.tail, ...(spec.tail || {}) }, foot: { ...DOG.foot, ...(spec.foot || {}) }, ear: { ...DOG.ear, ...(spec.ear || {}) } };
  const H = s.H;
  const B = new Builder();
  const P = (v) => [v[0] * H, v[1] * H, v[2] * H];
  const k = H * 0.055 * (s.blend || 1);
  const hip = P(s.hip), knee = P(s.knee), hock = P(s.hock), hpaw = P(s.hpaw);
  const scap = P(s.scap), shoulder = P(s.shoulder), elbow = P(s.elbow), wrist = P(s.wrist), fpaw = P(s.fpaw);
  const ftoe = [fpaw[0], 0, fpaw[2] + 0.09 * H * s.foot.size * (s.foot.toeK || 1)];
  const htoe = [hpaw[0], 0, hpaw[2] + 0.09 * H * s.foot.size * (s.foot.toeK || 1)];
  const sp = s.spine.map(([z, y]) => [0, y * H, z * H]);
  const tailBase = [0, s.tailBase[1] * H, s.tailBase[0] * H];

  // ------------------------------------------------------------ neck & head frame
  const N = s.neck;
  const neckBase = [0, N.base[1] * H, N.base[0] * H];
  const nd = [0, Math.sin(D(N.ang)), Math.cos(D(N.ang))];
  const NL = N.len * H;
  const neckMid = V.add(neckBase, V.mul(nd, NL * 0.5));
  const poll = V.add(neckBase, V.mul(nd, NL));
  const Hd = s.head;
  const HL = Hd.len * H, HW = Hd.w * HL;
  const f = [0, -Math.sin(D(Hd.pitch)), Math.cos(D(Hd.pitch))], u = [0, Math.cos(D(Hd.pitch)), Math.sin(D(Hd.pitch))];
  const hp = (a, b, x = 0) => [x, poll[1] + (f[1] * a + u[1] * b) * HL, poll[2] + (f[2] * a + u[2] * b) * HL];
  const HX = [[1, 0, 0], u, f];
  const nose = hp(1, Hd.slitY + 0.1);
  const jawP = hp(0.16, Hd.slitY + 0.02);
  const chin = hp(0.92, Hd.slitY - 0.1);

  // ------------------------------------------------------------ skeleton
  B.bone('hips', null, [0, hip[1], hip[2]], sp[0]);
  B.bone('spine1', 'hips', sp[0], sp[1]);
  B.bone('spine2', 'spine1', sp[1], sp[2]);
  B.bone('chest', 'spine2', sp[2], neckBase);
  B.bone('neck1', 'chest', neckBase, neckMid);
  B.bone('neck2', 'neck1', neckMid, poll);
  B.bone('head', 'neck2', poll, nose);
  B.bone('jaw', 'head', jawP, chin);
  const T = s.tail, nT = T.bones;
  const TL = T.len * H;
  const tailPts = [tailBase];
  {
    let dir = D(T.carry), p = tailBase;
    for (let i = 1; i <= nT; i++) {
      dir += D(T.curl || 0) / nT;
      const seg = TL / nT;
      p = [0, p[1] + Math.sin(dir) * seg, p[2] - Math.cos(dir) * seg];
      tailPts.push(p);
    }
  }
  for (let i = 0; i < nT; i++) B.bone('tail' + (i + 1), i ? 'tail' + i : 'hips', tailPts[i], tailPts[i + 1]);
  const E = s.ear;
  const earBase = hp(E.a, E.b, E.x * HL);
  B.sym((sx, S) => {
    if (E.type !== 'none') B.bone('ear' + S, 'head', mx(earBase, sx), mx(V.add(earBase, [0, 0.1 * HL, 0]), sx));
    B.bone('scapula' + S, 'chest', mx(scap, sx), mx(shoulder, sx));
    B.bone('upperarm' + S, 'scapula' + S, mx(shoulder, sx), mx(elbow, sx));
    B.bone('forearm' + S, 'upperarm' + S, mx(elbow, sx), mx(wrist, sx));
    B.bone('hand' + S, 'forearm' + S, mx(wrist, sx), mx(fpaw, sx));
    B.bone('fingers' + S, 'hand' + S, mx(fpaw, sx), mx(ftoe, sx));
    B.bone('thigh' + S, 'hips', mx(hip, sx), mx(knee, sx));
    B.bone('shin' + S, 'thigh' + S, mx(knee, sx), mx(hock, sx));
    B.bone('foot' + S, 'shin' + S, mx(hock, sx), mx(hpaw, sx));
    B.bone('toes' + S, 'foot' + S, mx(hpaw, sx), mx(htoe, sx));
  });

  const hEst = (s.torsoLoft ? 2 : s.torso[s.torso.length - 1][0] - s.torso[0][0] + 1.5) * H / 300;
  const ctx = { B, s, H, HL, HW, k, hp, HX, hEst, f, u, poll, neckBase, neckMid, nd, NL, hip, knee, hock, hpaw, scap, shoulder, elbow, wrist, fpaw, ftoe, htoe, sp, tailBase, tailPts, earBase };

  // ------------------------------------------------------------ torso
  B.loft(s.torsoLoft ? s.torsoLoft.map(([z, y, w, ht, hb]) => ({ p: [0, y * H, z * H], w: w * H, ht: ht * H, hb: hb * H })) : s.torso.map(([z, t, b, w, wide = 0.52]) => {
    const cy = b + (t - b) * wide;
    return { p: [0, cy * H, z * H], w: w * H, ht: (t - cy) * H, hb: (cy - b) * H };
  }), { up: s.torsoUp || [0, 1, 0], bones: ['hips', 'spine1', 'spine2', 'chest'], part: 'torso', k: 0, caps: s.torsoCaps || [0.75, 0.6], res: 5, noise: s.wool ? { amp: s.wool * H, freq: 0.9 / (s.wool * H), seed: 2, oct: 3 } : null });
  // brisket between the front legs, shoulder blades
  B.ell([0, (shoulder[1] - 0.05 * H), shoulder[2] - 0.06 * H], [0.11 * H, 0.13 * H, 0.1 * H], { bones: ['chest'], part: 'chest', k: k * 0.7 });
  B.sym((sx, S) => {
    const c = mx(V.lerp(scap, shoulder, 0.45), sx);
    const ax = V.norm(V.sub(shoulder, scap));
    B.ell(c, [0.035 * H, V.dist(scap, shoulder) * 0.55, 0.11 * H * (s.scapW || 1)], { bones: ['scapula' + S, 'chest'], part: 'leg', k: k * 0.8, axes: [[1, 0, 0], ax, V.norm(V.cross([1, 0, 0], ax))] });
  });

  // ------------------------------------------------------------ neck
  B.loft([
    { p: V.add(neckBase, V.mul(nd, -0.1 * H)), w: N.w0 * H * 1.05, ht: N.h0 * H * 0.9, hb: N.h0 * H * 1.1 },
    { p: V.add(neckBase, V.mul(nd, NL * 0.3)), w: (N.w0 * 0.7 + N.w1 * 0.3) * H, ht: (N.h0 * 0.65 + N.h1 * 0.35) * H * (N.crest || 1), hb: (N.h0 * 0.7 + N.h1 * 0.3) * H },
    { p: V.add(neckBase, V.mul(nd, NL * 0.7)), w: (N.w0 * 0.35 + N.w1 * 0.65) * H, ht: (N.h0 * 0.3 + N.h1 * 0.7) * H * (N.crest || 1), hb: (N.h0 * 0.3 + N.h1 * 0.7) * H },
    { p: V.add(poll, V.mul(f, 0.06 * HL)), w: N.w1 * H, ht: N.h1 * H * 0.8, hb: N.h1 * H * 1.15 },
  ], { bones: ['chest', 'neck1', 'neck2', 'head'], part: 'neck', k: k * 0.9, up: [0, 1, -0.6], caps: [0.5, 0.4], noise: s.wool ? { amp: s.wool * H * 0.8, freq: 0.9 / (s.wool * H), seed: 3, oct: 3 } : null });

  // ------------------------------------------------------------ head
  const slitB = Hd.slitY;
  const cr = Hd.cranium;
  B.ell(hp(0.26, 0.06), [HW * 0.5, cr[0] * HL, cr[1] * HL], { bones: ['head'], part: 'head', k: k * 0.5, axes: HX });
  B.sym((sx) => B.ell(mx(hp(Hd.cheekA ?? 0.4, slitB + 0.09, HW * 0.32), sx), [HW * 0.19, 0.13 * HL, 0.19 * HL], { bones: ['head'], part: 'head', k: k * 0.45, axes: HX }));
  B.loft(Hd.muzzle.map(([a, top, bot, w]) => {
    const yb = slitB - bot + 0.004, yt = slitB + top;
    const c = (yt + yb) / 2;
    return { p: hp(a, c), w: w * HL, ht: (yt - c) * HL, hb: (c - yb) * HL };
  }), { bones: ['head'], part: 'muzzle', k: k * 0.5, up: u, caps: [0.6, Hd.muzzleCap ?? 0.55] });
  B.loft(Hd.jaw.map(([a, depth, w]) => {
    const yt = slitB - 0.004, yb = slitB - depth;
    const c = (yt + yb) / 2;
    return { p: hp(a, c), w: w * HL, ht: (yt - c) * HL, hb: (c - yb) * HL };
  }), { bones: ['jaw'], part: 'jaw', k: k * 0.4, up: u, caps: [0.6, 0.85] });
  if (Hd.nose) {
    const n = Hd.nose;
    B.ell(hp(n.a, slitB + 0.1 + n.b), [n.w * HL, n.h * HL, (n.d || 0.05) * HL], { bones: ['head'], part: 'nose', mat: 'nose', k: 0.015 * HL, axes: HX });
    if (n.nostril) B.sym((sx) => B.ball(mx(hp(n.a + (n.d || 0.05) * 0.8, slitB + 0.1 + n.b - n.h * 0.2, n.w * HL * 0.45), sx), n.nostril * HL, { op: 'sub', k: n.nostril * HL * 0.6, mat: 'nose' }));
  }
  // mouth slit
  const slitT = Math.max(0.004 * HL, hEst * 0.5);
  const mA = hp(Hd.slitA[0], slitB), mB = hp(Hd.slitA[1] + 0.04, slitB + (Hd.slitTilt || 0));
  const mf = V.norm(V.sub(mB, mA));
  const mup = V.norm(V.cross([1, 0, 0], mf));
  B.ell(V.lerp(mA, mB, 0.55), [HW * 0.75, slitT, V.dist(mA, mB) * 0.56], { op: 'sub', k: slitT, axes: [[1, 0, 0], mup, mf], mat: 'mouth' });
  // eyes
  const ey = Hd.eye;
  const eyeR = ey.r * HL;
  B.eye(hp(ey.a, slitB + ey.b, ey.x * HL), eyeR, ey.dir, { open: ey.open, protrude: ey.protrude, wide: ey.wide, lidMat: ey.lid });
  // canines (carnivores)
  if (Hd.canine) {
    const cl = Hd.canine * HL, ma = Hd.muzzle[Hd.muzzle.length - 1];
    const cw = ma[3] * HL * 0.75;
    B.tooth('head', hp(0.86, slitB + 0.03, cw), hp(0.87, slitB + 0.03 - cl / HL, cw * 0.97), cl * 0.22, { sym: true });
    B.tooth('jaw', hp(0.9, slitB - 0.025, cw * 0.82), hp(0.9, slitB - 0.025 + (cl * 0.8) / HL, cw * 0.84), cl * 0.2, { sym: true });
  }
  if (E.type !== 'none') ears(ctx);

  // ------------------------------------------------------------ legs
  B.sym((sx, S) => {
    const Pm = (p) => mx(p, sx);
    const chainF = [scap, shoulder, elbow, wrist, fpaw], chainH = [hip, knee, hock, hpaw];
    const at = (chain, t) => { const i = Math.min(chain.length - 2, Math.floor(t)); return V.lerp(chain[i], chain[i + 1], t - i); };
    const legR = s.legR || 1;
    B.loft(s.fore.map(([t, w, fr, bk]) => ({ p: Pm(at(chainF, t)), w: w * H * legR, ht: fr * H * legR, hb: bk * H * legR })),
      { bones: ['scapula' + S, 'upperarm' + S, 'forearm' + S, 'hand' + S], part: 'leg', k: k * 1.1, up: [0, 0, 1], caps: [0.5, 0.8] });
    B.loft(s.hind.map(([t, w, fr, bk]) => ({ p: Pm(at(chainH, t)), w: w * H * legR, ht: fr * H * legR, hb: bk * H * legR })),
      { bones: ['thigh' + S, 'shin' + S, 'foot' + S], part: 'leg', k: k * 1.0, up: [0, 0, 1], caps: [0.5, 0.8] });
    // muscle masses: triceps (behind the upper arm), haunch, forearm and gaskin bellies
    const thighAx = V.norm(V.sub(hip, knee));
    B.ell(Pm(V.add(V.lerp(hip, knee, 0.42), [0.012 * H, 0.02 * H, -0.03 * H])), [0.085 * H * (s.thighW || 1), V.dist(hip, knee) * 0.62, 0.15 * H * (s.thighD || 1)],
      { bones: ['thigh' + S, 'hips'], part: 'thigh', k: k * 0.8, axes: [[1, 0, 0], thighAx, V.norm(V.cross([1, 0, 0], thighAx))] });
    const armAx = V.norm(V.sub(shoulder, elbow));
    B.ell(Pm(V.add(V.lerp(shoulder, elbow, 0.55), [-0.008 * H, 0, -0.035 * H])), [0.055 * H, V.dist(shoulder, elbow) * 0.5, 0.075 * H * (s.tricepsD || 1)],
      { bones: ['upperarm' + S], part: 'leg', k: k * 0.7, axes: [[1, 0, 0], armAx, V.norm(V.cross([1, 0, 0], armAx))] });
    feet(ctx, sx, S);
  });

  // ------------------------------------------------------------ tail
  if (nT && !T.hairOnly) {
    B.loft(tailPts.map((p, i) => {
      const t = i / nT;
      let r = T.r * H * (1 - (T.taper ?? 0.6) * t);
      if (T.bushy) r = T.r * H * (1 + T.bushy * Math.sin(Math.PI * Math.min(1, t * 1.05)) * 1.1) * (1 - 0.3 * t);
      if (i === nT) r *= T.bushy ? 0.45 : 0.6;
      return { p, w: r, ht: r, hb: r };
    }), { bones: tailPts.slice(0, nT).map((_, i) => 'tail' + (i + 1)), part: 'tail', k: k * 0.5, caps: [0.5, 1], noise: T.bushy ? { amp: 0.006 * H, freq: 30 / H, seed: 4 } : null });
  }
  if (T.tuft) {
    const tp = tailPts[nT];
    B.ell(V.add(tp, [0, 0, 0.01 * H]), [T.tuft * H * 0.6, T.tuft * H * 0.6, T.tuft * H], { bones: ['tail' + nT], part: 'tuft', k: T.r * H, noise: { amp: T.tuft * H * 0.25, freq: 1.5 / (T.tuft * H), seed: 3 } });
  }
  if (T.hair) { // long hair tail (horse, zebra switch) hanging from the dock
    const hl = T.hair;
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const base = i <= 2 ? tailPts[Math.min(nT, i)] : tailPts[nT];
      const p = i <= 2 ? base : V.add(tailPts[nT], [0, -hl.len * H * ((t - 0.4) / 0.6), -hl.back * H * (t - 0.4)]);
      pts.push({ p, w: hl.w * H * (0.6 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.2))), ht: hl.w * H * 0.8, hb: hl.w * H * 0.8 });
    }
    B.loft(pts, { bones: tailPts.slice(0, nT).map((_, i) => 'tail' + (i + 1)), part: 'tailhair', k: k * 0.4, caps: [0.5, 0.5], noise: { amp: hl.w * H * 0.25, freq: 3 / (hl.w * H), seed: 6 } });
  }
  s.extras?.(B, ctx);
  return { B, lm: { ...ctx, nose, chin, tailTip: tailPts[nT] } };
}

// ------------------------------------------------------------------ ears
function ears(c) {
  const { B, s, HL, H } = c;
  const E = s.ear, es = E.size || 1;
  const T = (t) => Math.max(t * HL, c.hEst * 1.25); // never thinner than the mesh can resolve
  B.sym((sx, S) => {
    const b0 = mx(c.earBase, sx);
    const bone = B.get('ear' + S);
    if (E.type === 'flap') { // elephant: a huge, thin, slightly cupped flap against the side of the head
      const L = (E.len ?? 0.9) * HL, W = (E.w ?? 0.75) * HL, th = T(E.th ?? 0.03);
      const ay = [0, 1, 0], az = V.norm([-0.3 * sx, 0, 1]), ax = V.norm(V.cross(ay, az));
      const c0 = V.add(b0, V.add(V.mul(az, -W * 0.42), [sx * th * 2.5, -L * 0.3, 0]));
      B.ell(c0, [th * 1.6, L * 0.5, W * 0.5], { bones: ['ear' + S], part: 'ear', k: th * 2, axes: [ax, ay, az] });
      bone.tail = V.add(c0, [0, -L * 0.45, 0]);
    } else if (E.type === 'drop') { // hanging flap (labrador, pig, goat breeds)
      const out = E.out ?? 0.12, fw = (E.fwd ?? 0.03);
      const p1 = V.add(b0, [sx * out * HL * 0.6, -0.1 * HL * es, fw * HL]);
      const p2 = V.add(b0, [sx * out * HL, -(E.len ?? 0.32) * HL * es, (fw + 0.02) * HL]);
      B.loft([
        { p: V.add(b0, [0, 0.01 * HL, 0]), w: (E.w ?? 0.12) * HL * es, ht: T(0.04), hb: T(0.04) },
        { p: p1, w: (E.w ?? 0.12) * 1.35 * HL * es, ht: T(E.th ?? 0.03), hb: T(E.th ?? 0.03) },
        { p: p2, w: (E.w ?? 0.12) * HL * es, ht: T((E.th ?? 0.03) * 0.9), hb: T((E.th ?? 0.03) * 0.9) },
      ], { bones: ['ear' + S], part: 'ear', k: 0.02 * HL, up: E.flat ? [0, 1, 0.3] : [sx, 0.15, 0], caps: [0.5, 1] });
      bone.tail = p2;
    } else if (E.type === 'side') { // horizontal ears (cow, giraffe, sheep)
      const dir = V.norm([sx * Math.cos(D(E.ang ?? 15)), Math.sin(D(E.ang ?? 15)) * (E.up ?? 1), -0.25]);
      const len = (E.len ?? 0.3) * HL * es, tip = V.add(b0, V.mul(dir, len));
      const wide = (E.w ?? 0.11) * HL * es;
      const facing = V.norm([0, 0.2, 1]);
      B.loft([
        { p: b0, w: wide * 0.6, ht: T(0.04), hb: T(0.04) },
        { p: V.lerp(b0, tip, 0.5), w: wide, ht: T(0.025), hb: T(0.025) },
        { p: tip, w: wide * 0.35, ht: T(0.015), hb: T(0.015) },
      ], { bones: ['ear' + S], part: 'ear', k: 0.02 * HL, up: facing, caps: [0.5, 0.9] });
      B.ell(V.add(V.lerp(b0, tip, 0.5), V.mul(facing, 0.03 * HL)), [wide * 0.6, len * 0.35, 0.025 * HL], { op: 'sub', k: 0.01 * HL, axes: [V.norm(V.cross(dir, facing)), dir, facing], mat: 'skin' });
      bone.tail = tip;
    } else { // erect / round / long (dog, cat, horse, rabbit)
      const round = E.type === 'round';
      const len = (E.len ?? (round ? 0.2 : 0.4)) * HL * es;
      const ang = D(E.ang ?? (round ? 25 : 18));
      const dir = V.norm([Math.sin(ang) * sx, Math.cos(ang), E.tiltZ ?? (round ? 0.05 : -0.12)]);
      const tip = V.add(b0, V.mul(dir, len));
      const wide = (E.w ?? (round ? 0.2 : 0.17)) * HL * es;
      const facing = V.norm([sx * (E.face ?? 0.35), 0, 1]);
      B.loft([
        { p: b0, w: wide, ht: 0.05 * HL, hb: 0.05 * HL },
        { p: V.lerp(b0, tip, 0.45), w: wide * (round ? 0.95 : E.mid ?? 0.82), ht: T(0.026), hb: T(0.026) },
        { p: tip, w: round ? wide * 0.55 : 0.016 * HL, ht: T(0.015), hb: T(0.015) },
      ], { bones: ['ear' + S], part: 'ear', k: 0.025 * HL, up: facing, caps: [0.5, round ? 0.9 : 0.5] });
      B.ell(V.add(V.lerp(b0, tip, 0.45), V.mul(facing, 0.035 * HL)), [wide * 0.6, len * 0.42, 0.03 * HL], { op: 'sub', k: 0.012 * HL, axes: [V.norm(V.cross(dir, facing)), dir, facing], mat: 'skin' });
      bone.tail = tip;
    }
  });
  void H;
}

// ------------------------------------------------------------------ feet
function feet(c, sx, S) {
  const { B, s, H } = c;
  const pairs = [[c.fpaw, c.ftoe, ['fingers' + S, 'hand' + S], c.wrist, s.foot], [c.hpaw, c.htoe, ['toes' + S, 'foot' + S], c.hock, { ...s.foot, ...(s.hindFoot || {}) }]];
  for (const [base0, toe0, bones, up0, F] of pairs) {
    const fs = F.size || 1;
    const base = mx(base0, sx), toe = mx(toe0, sx), up = mx(up0, sx);
    if (F.type === 'paw') {
      const r = 0.05 * H * fs;
      const oy = Math.max(0, base[1] - 0.045 * H * fs); // paws held above the ground (kangaroo hands)
      const c0 = [base[0], oy + r * 0.6, base[2] + r * 0.35];
      B.ell(c0, [r * 0.9, r * 0.6, r * 1.0], { bones, part: 'paw', k: r * 0.5 });
      for (let i = 0; i < 4; i++) {
        const a = (i - 1.5) * 0.42;
        const tp = [c0[0] + Math.sin(a) * r * 0.58 * sx, oy + r * 0.4, c0[2] + Math.cos(a) * r * 0.78];
        B.ell(tp, [r * 0.29, r * 0.38, r * 0.36], { bones: [bones[0]], part: 'paw', k: r * 0.2 });
        if (F.claws !== false) B.cone([tp[0], oy + r * 0.32, tp[2] + r * 0.22], [tp[0], oy + r * 0.06, tp[2] + r * 0.46], r * 0.085 * (F.clawK || 1), r * 0.02, { bones: [bones[0]], part: 'claw', mat: 'keratin', k: r * 0.05 });
      }
      B.ell([c0[0], oy + r * 0.1, c0[2] - r * 0.15], [r * 0.48, r * 0.16, r * 0.42], { bones, part: 'paw', mat: 'pad', k: r * 0.12 });
    } else if (F.type === 'talon') { // raptor foot (griffin): scaly toes spread on the ground, hooked talons
      const r = 0.035 * H * fs;
      const c0 = [base[0], r * 0.9, base[2]];
      B.ell(c0, [r * 1.1, r * 0.9, r * 1.2], { bones, part: 'toe', mat: 'scale', k: r * 0.5 });
      const toes = [[-0.5, 1.0], [0, 1.15], [0.5, 1.0], [Math.PI, 0.75]];
      for (const [a, k] of toes) {
        const d = [Math.sin(a) * sx, 0, Math.cos(a)];
        const tp = [c0[0] + d[0] * r * 2.6 * k, r * 0.5, c0[2] + d[2] * r * 2.6 * k];
        B.cone([c0[0], r * 0.7, c0[2]], tp, r * 0.42, r * 0.3, { bones: [bones[0]], part: 'toe', mat: 'scale', k: r * 0.25 });
        const c2 = [tp[0] + d[0] * r * 0.9, r * 0.45, tp[2] + d[2] * r * 0.9], c3 = [tp[0] + d[0] * r * 1.3, r * 0.05, tp[2] + d[2] * r * 1.3];
        B.loft([{ p: [tp[0], r * 0.6, tp[2]], w: r * 0.22, ht: r * 0.3, hb: r * 0.25 }, { p: c2, w: r * 0.15, ht: r * 0.2, hb: r * 0.16 }, { p: c3, w: r * 0.04, ht: r * 0.05, hb: r * 0.04 }], { bones: [bones[0]], part: 'claw', mat: 'keratin', k: r * 0.1, caps: [0.6, 0.6] });
      }
      B.box([c0[0], -0.05 * H, c0[2]], [r * 6, 0.05 * H, r * 6], 0.002, { op: 'sub', k: r * 0.1 });
    } else if (F.type === 'plantigrade') { // bear: long sole on the ground, strong claws
      const r = 0.06 * H * fs;
      const len = V.dist([up[0], 0, up[2]], [toe[0], 0, toe[2]]) * 0.5 + r;
      const c0 = [base[0], r * 0.55, (up[2] + toe[2]) / 2];
      B.ell(c0, [r * 1.05, r * 0.6, len * 0.62], { bones, part: 'paw', k: r * 0.6 });
      for (let i = 0; i < 5; i++) {
        const a = (i - 2) * 0.3;
        const tp = [c0[0] + Math.sin(a) * r * 0.8 * sx, r * 0.4, c0[2] + len * 0.5 + Math.cos(a) * r * 0.2];
        B.ell(tp, [r * 0.24, r * 0.32, r * 0.3], { bones: [bones[0]], part: 'paw', k: r * 0.15 });
        B.cone([tp[0], r * 0.42, tp[2] + r * 0.15], [tp[0], r * 0.05, tp[2] + r * 0.75 * (F.clawK || 1)], r * 0.08, r * 0.02, { bones: [bones[0]], part: 'claw', mat: 'keratin', k: r * 0.04 });
      }
      B.ell([c0[0], r * 0.08, c0[2]], [r * 0.8, r * 0.14, len * 0.5], { bones, part: 'paw', mat: 'pad', k: r * 0.1 });
    } else if (F.type === 'hoof' || F.type === 'cloven') {
      const r = 0.042 * H * fs * (F.hoofK || 1);
      const hh = r * (F.hoofH || 1.25);
      // pastern from the fetlock down to the coronet
      const cor = [base[0], hh, base[2] + r * 0.55];
      B.cone(base, cor, r * 0.8, r * 0.85, { bones, part: 'leg', k: r * 0.5 });
      if (F.type === 'hoof') {
        B.cone([cor[0], hh * 0.98, cor[2] - r * 0.1], [cor[0], hh * 0.12, cor[2] + r * 0.32], r * 0.92, r * 1.12, { bones: [bones[0]], part: 'hoof', mat: 'keratin', k: r * 0.08 });
      } else {
        for (const d of [-1, 1]) {
          const ox = d * r * 0.42 * sx;
          B.cone([cor[0] + ox, hh * 0.98, cor[2] - r * 0.05], [cor[0] + ox * 1.05, hh * 0.1, cor[2] + r * 0.55], r * 0.5, r * 0.5, { bones: [bones[0]], part: 'hoof', mat: 'keratin', k: r * 0.06 });
        }
        B.box([cor[0], hh * 0.45, cor[2] + r * 0.5], [r * 0.06, hh * 0.5, r * 0.6], r * 0.02, { op: 'sub', k: r * 0.06 });
        if (F.dew !== false) for (const d of [-1, 1]) B.ell([cor[0] + d * r * 0.55 * sx, hh * 1.9, cor[2] - r * 0.75], [r * 0.2, r * 0.25, r * 0.2], { bones: [bones[1]], part: 'hoof', mat: 'keratin', k: r * 0.1 });
      }
      B.box([cor[0], -0.05 * H, cor[2] + r * 0.2], [r * 2, 0.05 * H, r * 2.4], 0.002, { op: 'sub', k: r * 0.08 });
    } else if (F.type === 'knuckle') { // primate hand on its knuckles: palm, curled fingers, thumb
      const r = 0.05 * H * fs;
      const palmTop = V.lerp(up, base, 0.35);
      B.loft([{ p: palmTop, w: r * 0.75, ht: r * 0.55, hb: r * 0.5 }, { p: [base[0], base[1] + r * 0.6, base[2] + r * 0.2], w: r * 1.0, ht: r * 0.55, hb: r * 0.5 }], { bones: [bones[1]], part: 'hand', k: r * 0.4, up: [0, 0, 1] });
      for (let i = 0; i < 4; i++) {
        const xx = base[0] + sx * (i - 1.5) * r * 0.5;
        B.cone([xx, r * 0.75, base[2] + r * 0.35], [xx, r * 0.42, base[2] + r * 0.75], r * 0.26, r * 0.24, { bones: [bones[0]], part: 'finger', k: r * 0.12 });
        B.cone([xx, r * 0.42, base[2] + r * 0.75], [xx, r * 0.6, base[2] + r * 0.35], r * 0.22, r * 0.2, { bones: [bones[0]], part: 'finger', k: r * 0.12 });
      }
      B.cone([base[0] - sx * r * 0.7, base[1] + r * 1.1, base[2] + r * 0.1], [base[0] - sx * r * 0.9, base[1] + r * 0.4, base[2] + r * 0.6], r * 0.25, r * 0.2, { bones: [bones[1]], part: 'finger', k: r * 0.15 });
    } else if (F.type === 'ape') { // primate foot: long sole, opposable big toe
      const r = 0.055 * H * fs;
      const heel = [up[0], r * 0.5, up[2] - r * 0.2];
      B.loft([{ p: heel, w: r * 0.65, ht: r * 0.5, hb: r * 0.5 }, { p: [base[0], r * 0.55, base[2]], w: r * 0.95, ht: r * 0.5, hb: r * 0.45 }, { p: [toe[0], r * 0.35, toe[2] - r * 0.3], w: r * 0.85, ht: r * 0.3, hb: r * 0.3 }], { bones, part: 'foot', k: r * 0.5, up: [0, 1, 0] });
      for (let i = 0; i < 4; i++) {
        const xx = toe[0] + sx * (i - 1.0) * r * 0.42;
        B.cone([xx, r * 0.3, toe[2] - r * 0.3], [xx, r * 0.22, toe[2] + r * 0.4], r * 0.2, r * 0.17, { bones: [bones[0]], part: 'toe', k: r * 0.1 });
      }
      B.cone([base[0] - sx * r * 0.7, r * 0.4, base[2] + r * 0.1], [base[0] - sx * r * 1.3, r * 0.3, base[2] + r * 0.8], r * 0.3, r * 0.24, { bones: [bones[0]], part: 'toe', k: r * 0.15 });
      B.box([base[0], -0.05 * H, base[2]], [r * 3, 0.05 * H, r * 5], 0.002, { op: 'sub', k: r * 0.1 });
    } else if (F.type === 'pillar') { // elephant / rhino: round pad + toenails
      const r = 0.085 * H * fs;
      const c0 = [base[0], r * 0.55, base[2] + r * 0.1];
      B.cone([base[0], base[1] + r * 0.2, base[2]], c0, r * 0.82, r * 1.02, { bones, part: 'leg', k: r * 0.4 });
      B.ell([c0[0], r * 0.32, c0[2]], [r * 1.08, r * 0.34, r * 1.05], { bones, part: 'paw', k: r * 0.4 });
      const nails = F.nails || 4;
      for (let i = 0; i < nails; i++) {
        const a = (i - (nails - 1) / 2) * (F.nailSpread || 0.42);
        B.ell([c0[0] + Math.sin(a) * r * 0.95 * sx, r * 0.24, c0[2] + Math.cos(a) * r * 0.92], [r * 0.2, r * 0.2, r * 0.12], { bones: [bones[0]], part: 'hoof', mat: 'keratin', k: r * 0.06 });
      }
      B.box([c0[0], -0.05 * H, c0[2]], [r * 2, 0.05 * H, r * 2], 0.002, { op: 'sub', k: r * 0.06 });
    }
  }
}

// ------------------------------------------------------------------ helpers for species extras
/** Curved horn / tusk / antler beam: points [[x,y,z]...], radii [r...], on a bone. */
export function horn(B, pts, radii, bones, o = {}) {
  return B.loft(pts.map((p, i) => ({ p, w: radii[i], ht: radii[i], hb: radii[i] })), { bones, part: o.part || 'horn', mat: o.mat || 'keratin', k: o.k ?? radii[0] * 0.5, caps: [0.5, 1], res: o.res || 5 });
}

/** Mane / crest along the top of the neck (horse, zebra, boar): height, width, noise. */
export function crestMane(c, { h = 0.06, w = 0.025, fwd = 0.05, start = -0.05, end = 1.0, noise = 0.25, mat = 'fur', part = 'mane', upright = false } = {}) {
  const { B, H, neckBase, nd, NL, f, hp } = c;
  const up = V.norm([0, nd[2], -nd[1]]); // dorsal side of the neck
  const pts = [];
  for (let i = 0; i <= 5; i++) {
    const t = start + (end - start) * (i / 5);
    const base = t <= 1 ? V.add(neckBase, V.mul(nd, NL * t)) : hp((t - 1) * 0.3, 0.2);
    const thick = c.s.neck.h0 * (1 - Math.min(1, t)) + c.s.neck.h1 * Math.min(1, t);
    const p = V.add(base, V.mul(up, thick * H * 0.82 + h * H * 0.3));
    pts.push({ p, w: w * H, ht: h * H * (upright ? 1 : 0.6), hb: h * H * 0.4 });
  }
  void f; void fwd;
  return B.loft(pts, { bones: ['chest', 'neck1', 'neck2', 'head'], part, mat, k: h * H * 0.5, up: [0, 1, -0.4], caps: [0.6, 0.8], noise: noise ? { amp: h * H * noise, freq: 4 / (h * H), seed: 8, oct: 3 } : null });
}
