// Bird archetype (build time): tilted egg-shaped body, S-neck, head with a
// two-part keratin beak on the head / jaw bones, scaly legs with three
// forward toes and a hallux (or 2 + 2 zygodactyl toes), and explicit feather
// sheets for the wings and the tail (engine/cards.js).
//
// Wings and tails are built SPREAD (rest pose) and every flight / tail
// feather has its own bone, so a stored blend can fold them properly: the
// arm folds in the plane of the wing (Z fold: humerus back, forearm
// forward, hand back) while each feather turns about the wing's normal to
// lie backward along the body, stacked in its layer. The same wing builder
// gives the griffin and the pegasus their wings (fantasy.js).
//
// Bones: hips > chest > neck1 > neck2 > neck3 > head > jaw; hips > tail1 >
// rect1..n.S; chest > wing1.S > wing2.S > wing3.S, feathers pri*.S (hand),
// sec*.S (forearm), ter*.S (humerus); hips > thigh.S > shin.S > foot.S >
// toes.S / hallux.S. Units: meters, the bird faces +Z, its left is +X.
import { Builder, mx, V } from './builder.js';
import { dirY, wrap, rotAxis, eulerMapping, eulerAxis, mirrorEuler, D2R } from './rot.js';
import { eulerToQuat, quatToEuler } from '../poses.js';

/** Quaternion product a*b ([x,y,z,w]). */
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

// ------------------------------------------------------------------ one feather
/**
 * Feather sheet: root, dir (unit), up (sheet normal), side (unit, toward the
 * narrow leading vane), len, wl / wt (max half widths of the leading /
 * trailing vanes), th, bone, part, fi, bend (tip drop / len), camber (edge
 * drop / width), notch {at, k} (emarginated outer primaries), tipRound.
 */
export function featherSheet(B, f) {
  const nr = f.rows || 7, nc = f.cols || 5;
  const grid = [];
  const base = f.base ?? 0.14, tipR = f.tipRound ?? 0.3;
  const S = [-1, -0.5, 0, 0.5, 1].slice(0, nc === 5 ? 5 : 3);
  const cols = nc === 5 ? S : [-1, 0, 1];
  for (let i = 0; i < nr; i++) {
    const t = i / (nr - 1);
    let k = t < base ? 0.32 + 0.68 * smooth(t / base) : 1;
    if (t > 1 - tipR) k *= Math.sqrt(Math.max(0, 1 - ((t - (1 - tipR)) / tipR) ** 2));
    if (f.notch && t > f.notch.at - 0.08) k *= lerp(1, f.notch.k, smooth(Math.min(1, (t - f.notch.at + 0.08) / 0.12)));
    if (f.taper) k *= 1 - f.taper * t;
    k = Math.max(k, 0.14);
    const row = [];
    const sp = V.add(f.root, V.mul(f.dir, f.len * t));
    const drop = (f.bend || 0) * f.len * t * t;
    for (const s of cols) {
      const half = s > 0 ? f.wl * k : f.wt * k;
      const acr = s * half;
      const cam = (f.camber || 0) * Math.abs(acr) * Math.abs(s);
      const p = V.add(V.add(sp, V.mul(f.side, acr)), V.mul(f.up, -drop - cam));
      row.push({ p, th: f.th * (1 - 0.45 * Math.abs(s)), w: { [f.bone]: 1 }, uv: [0.5 + 0.5 * s, t] });
    }
    grid.push(row);
  }
  return B.sheet({ grid, up: f.up, part: f.part, fi: f.fi ?? 0, tag: f.tag || null, side: f.sideSign || 0, mat: 'feather' });
}

// ------------------------------------------------------------------ wing
/**
 * Feathered wing on both sides. o: {
 *   parent, shoulder [x,y,z] (left), hum/fore/hand: [len, angle] (in-plane
 *   angles, degrees: 0 = straight out, + = swept back), arm: {r: [shoulder,
 *   elbow, wrist, tip] half thickness, lead: patagium depth},
 *   prim: {n, len(f) | [..], w, ang: [inner, outer], notch: {from, at, k}},
 *   sec: {n, len, w, ang: [inner, outer]}, ter: {n, len, w, ang},
 *   cov: {k, w} (greater coverts as a fraction of the secondaries), pcov: {k},
 *   fold: {back: [x,y,z] world direction of the folded humerus, out: [x,y,z]
 *   the folded wing's outer normal, fore: deg, hand: deg, sec: [inner, outer]
 *   deg, prim: [inner, outer] deg, ter: deg}, th (feather thickness / len),
 *   part prefix 'w' }
 * Adds bones, the arm (signed distance loft), the feather sheets and the
 * blends 'wingFold.L' / 'wingFold.R'.
 */
export function featherWing(B, o) {
  const thk = o.th ?? 0.0026;
  const up = [0, 1, 0];
  const L = { prim: o.prim, sec: o.sec, ter: o.ter };
  const featherLen = (g, f) => (typeof g.len === 'function' ? g.len(f) : Array.isArray(g.len) ? g.len[Math.min(g.len.length - 1, Math.round(f * (g.len.length - 1)))] : g.len);
  // layers (bottom -> top at rest = innermost -> outermost when folded)
  const nP = L.prim.n, nS = L.sec.n, nT = L.ter?.n || 0;
  let maxTh = 0;
  for (let i = 0; i < nP; i++) maxTh = Math.max(maxTh, featherLen(L.prim, i / Math.max(1, nP - 1)) * thk);
  for (let i = 0; i < nS; i++) maxTh = Math.max(maxTh, featherLen(L.sec, i / Math.max(1, nS - 1)) * thk);
  const dl = maxTh * 1.2;
  const nLayers = nP + nS + nT + nP + nS;
  let layer = 0;
  const yOf = (l) => (l - nLayers * 0.42) * dl;
  const fold = o.fold || {};
  const blendL = {};
  // ---- left side geometry (mirrored for the right)
  const [hl, ha] = o.hum, [fl, fa] = o.fore, [ml, ma] = o.hand;
  const sh = o.shoulder;
  const el = V.add(sh, V.mul(dirY(ha), hl));
  const wr = V.add(el, V.mul(dirY(fa), fl));
  const tip = V.add(wr, V.mul(dirY(ma), ml));
  // folded humerus: the arm plane turns to lie along the body
  const R1 = eulerMapping(dirY(ha), up, fold.back || [0, -0.35, -1], fold.out || [1, 0.4, 0]);
  const phi2 = wrap(ha + 180 - (fold.fore ?? 14) - fa);
  const phi3 = wrap(ha - (fold.hand ?? 6) - ma - phi2);
  blendL.wing1 = R1; blendL.wing2 = [0, phi2, 0]; blendL.wing3 = [0, phi3, 0];
  const feathers = []; // {name, parent, root, ang, len, w, kind, fi, layer}
  const addF = (kind, name, parent, root, ang, len, w, fi, extra = {}) => feathers.push({ kind, name, parent, root, ang, len, w, fi, ...extra });
  // primaries along the hand (inner p1 at the wrist .. outer at the tip)
  for (let i = 0; i < nP; i++) {
    const f = nP > 1 ? i / (nP - 1) : 0;
    const root = V.add(V.lerp(wr, tip, 0.08 + 0.9 * f), V.mul(dirY(ma + 90), (o.arm.r[2] * 0.5) * (1 - f)));
    const ang = lerp(L.prim.ang[0], L.prim.ang[1], Math.pow(f, L.prim.angPow ?? 1));
    const nt = L.prim.notch && i >= L.prim.notch.from ? { at: L.prim.notch.at, k: L.prim.notch.k } : null;
    addF('primary', 'pri' + (i + 1), 'wing3', root, ang, featherLen(L.prim, f), L.prim.w, f, { notch: nt, layer: layer++ });
  }
  // secondaries along the forearm (inner at the elbow .. outer at the wrist)
  for (let i = 0; i < nS; i++) {
    const f = nS > 1 ? i / (nS - 1) : 0;
    const root = V.add(V.lerp(el, wr, 0.06 + 0.9 * f), V.mul(dirY(fa + 90), o.arm.r[1] * 0.45));
    const ang = lerp(L.sec.ang[0], L.sec.ang[1], f);
    addF('secondary', 'sec' + (i + 1), 'wing2', root, ang, featherLen(L.sec, f), L.sec.w, f, { layer: nP + (nS - 1 - i) });
  }
  layer = nP + nS;
  for (let i = 0; i < nT; i++) {
    const f = nT > 1 ? i / (nT - 1) : 0;
    const root = V.add(V.lerp(sh, el, 0.62 + 0.32 * f), V.mul(dirY(ha + 90), o.arm.r[1] * 0.5));
    const ang = lerp(L.ter.ang[0], L.ter.ang[1], f);
    addF('tertial', 'ter' + (i + 1), 'wing1', root, ang, featherLen(L.ter, f), L.ter.w, f, { layer: layer + i });
  }
  layer += nT;
  // folded directions (in the humerus frame, rest coordinates): back = ha, minus = down
  const pAcc = { wing1: 0, wing2: phi2, wing3: phi2 + phi3 };
  for (const F of feathers) {
    let g = 0;
    if (F.kind === 'primary') g = lerp(fold.prim?.[0] ?? -2, fold.prim?.[1] ?? -6, F.fi);
    else if (F.kind === 'secondary') g = lerp(fold.sec?.[0] ?? -4, fold.sec?.[1] ?? -20, F.fi);
    else g = lerp(fold.ter?.[0] ?? 4, fold.ter?.[1] ?? -2, F.fi);
    F.psi = wrap(ha + g - F.ang - pAcc[F.parent]);
    // twist about the feather's own axis first (leading vane down): the folded wing curls around the body
    const tw = (fold.twist ?? 14) * (F.kind === 'tertial' ? 0.5 : 0.6 + 0.4 * F.fi);
    blendL[F.name] = tw ? quatToEuler(qmul(eulerToQuat([0, F.psi, 0]), eulerToQuat(eulerAxis(dirY(F.ang), tw)))) : [0, F.psi, 0];
  }
  // ---- both sides: bones, arm, feathers
  B.sym((sx, S) => {
    const P = (p) => mx(p, sx);
    B.bone('wing1' + S, o.parent, P(sh), P(el));
    B.bone('wing2' + S, 'wing1' + S, P(el), P(wr));
    B.bone('wing3' + S, 'wing2' + S, P(wr), P(tip));
    const r = o.arm.r;
    // arm: shoulder -> elbow -> wrist -> hand tip (thick leading edge of the wing)
    B.loft([
      { p: P(V.add(sh, [-0.4 * r[0], 0, 0])), w: r[0] * 1.2, ht: r[0], hb: r[0] },
      { p: P(V.lerp(sh, el, 0.5)), w: r[0] * 1.15, ht: r[0] * 0.95, hb: r[0] * 0.9 },
      { p: P(el), w: r[1] * 1.3, ht: r[1], hb: r[1] },
      { p: P(V.lerp(el, wr, 0.5)), w: r[1] * 1.15, ht: r[1] * 0.9, hb: r[1] * 0.85 },
      { p: P(wr), w: r[2] * 1.3, ht: r[2], hb: r[2] },
      { p: P(V.lerp(wr, tip, 0.55)), w: r[2] * 1.0, ht: r[2] * 0.8, hb: r[2] * 0.7 },
      { p: P(tip), w: r[3], ht: r[3] * 0.7, hb: r[3] * 0.6 },
    ], { bones: [o.parent, 'wing1' + S, 'wing2' + S, 'wing3' + S], part: (o.part || '') + 'wingarm', k: r[1] * 0.8, up, caps: [0.6, 0.8] });
    // patagium: the leading-edge membrane from the shoulder to the wrist, in front of the elbow
    const lead = o.arm.lead ?? r[1] * 2;
    const mid = V.add(V.lerp(sh, wr, 0.5), V.mul(dirY(-90), lead * 0.35));
    B.loft([
      { p: P(V.lerp(sh, mid, 0.15)), w: r[0] * 1.2, ht: r[0] * 0.55, hb: r[0] * 0.5 },
      { p: P(mid), w: lead * 0.75, ht: r[1] * 0.45, hb: r[1] * 0.4 },
      { p: P(V.lerp(mid, wr, 0.85)), w: r[2] * 1.2, ht: r[2] * 0.6, hb: r[2] * 0.5 },
    ], { bones: ['wing1' + S, 'wing2' + S], part: (o.part || '') + 'wingarm', k: r[1] * 0.9, up, caps: [0.6, 0.6] });
    // feathers (and their coverts on the same bones)
    for (const F of feathers) {
      const name = F.name + S;
      const d = dirY(F.ang);
      const root = V.add(F.root, [0, yOf(F.layer), 0]);
      B.bone(name, F.parent + S, P(root), P(V.add(root, V.mul(d, F.len))));
      const side = V.norm(V.cross(d, up)); // toward the leading / distal vane
      const ws = F.kind === 'primary' ? [F.w * 0.36, F.w * 0.64] : F.kind === 'secondary' ? [F.w * 0.42, F.w * 0.58] : [F.w * 0.48, F.w * 0.52];
      const pre = o.part || '';
      featherSheet(B, {
        root: P(root), dir: P(d), up, side: P(side), len: F.len, wl: ws[0], wt: ws[1], th: Math.max(0.0004, F.len * thk), bone: name,
        part: pre + F.kind, fi: F.fi, bend: F.kind === 'primary' ? 0.05 : 0.03, camber: 0.04, notch: F.notch, sideSign: sx,
      });
      // coverts: shorter feathers on top of the flight feathers' bases
      const cv = F.kind === 'primary' ? o.pcov : F.kind === 'secondary' ? o.cov : null;
      if (cv) {
        const lay = nP + nS + nT + (F.kind === 'primary' ? F.layer : nP + (F.layer - nP));
        const cr = V.add(V.add(F.root, V.mul(side, F.w * 0.1)), [0, yOf(lay), 0]);
        featherSheet(B, {
          root: P(cr), dir: P(d), up, side: P(side), len: F.len * cv.k, wl: F.w * (cv.w ?? 0.55), wt: F.w * (cv.w ?? 0.55) * 1.1, th: Math.max(0.0004, F.len * thk),
          bone: name, part: pre + (F.kind === 'primary' ? 'pcovert' : 'covert'), fi: F.fi, bend: 0.02, camber: 0.05, tipRound: 0.45, rows: 5, cols: 3, sideSign: sx,
        });
      }
    }
  });
  // blends
  const bl = {}, br = {};
  for (const [k, e] of Object.entries(blendL)) { bl[k + '.L'] = e; br[k + '.R'] = mirrorEuler(e); }
  B.blend('wingFold.L', bl);
  B.blend('wingFold.R', br);
  return { sh, el, wr, tip, feathers };
}

// ------------------------------------------------------------------ tail
/**
 * Fanned tail on bone `bone` (tail1): o: {base [x,y,z], axis (unit, backward),
 * normal (unit, tail plane), n (per side), len(f) | number, w, fan: [inner,
 * outer] degrees from the axis, close: degrees of the closed stagger, th, bend, part}
 * Adds bones rect1..n.S and blend 'tailFan' (closed fan).
 */
export function featherTail(B, o) {
  const n = o.n, thk = o.th ?? 0.0026;
  const len = (f) => (typeof o.len === 'function' ? o.len(f) : o.len);
  let maxL = 0;
  for (let i = 0; i < n; i++) maxL = Math.max(maxL, len(n > 1 ? i / (n - 1) : 0));
  const dl = maxL * thk * 1.25;
  const blend = {};
  const lat = V.norm(V.cross(o.axis, o.normal)); // toward +X (left) for a backward axis
  B.sym((sx, S) => {
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) : 0;
      const name = 'rect' + (i + 1) + S;
      const a = lerp(o.fan[0], o.fan[1], f); // degrees from the axis toward the side
      const d = rotAxis(o.axis, o.normal, -a * sx);
      const layerIx = i * 2 + (sx > 0 ? 0 : 1); // central on top, L above R
      const root = V.add(V.add(o.base, V.mul(lat, sx * (o.spread ?? 0.004) * (i + 0.5))), V.mul(o.normal, -layerIx * dl));
      const L0 = len(f);
      B.bone(name, o.bone || 'tail1', root, V.add(root, V.mul(d, L0)));
      const side = V.norm(V.cross(d, o.normal)); // outer vane toward the outside of the fan
      const out = V.dot(side, lat) * sx > 0 ? side : V.mul(side, -1);
      featherSheet(B, { root, dir: d, up: o.normal, side: out, len: L0, wl: o.w * 0.42, wt: o.w * 0.58, th: Math.max(0.0004, L0 * thk), bone: name, part: o.part || 'rectrix', fi: f, bend: o.bend ?? 0.02, camber: 0.03, tipRound: o.tipRound ?? 0.35, taper: o.taper || 0, sideSign: sx });
      // closed: every feather turns back toward the axis (small stagger)
      const target = (o.close ?? 1.2) * (i + 0.5) * 0.5;
      blend[name] = eulerAxis(o.normal, (a - target) * sx);
    }
  });
  B.blend('tailFan', blend);
}

// ------------------------------------------------------------------ body
/**
 * The bird. spec (meters): {
 *   tilt (deg, body axis up at the front), hip [x, y, z] (left hip joint),
 *   torso: [[u, ht, hb, w]] stations along the body axis from the hip centre,
 *   torsoOff [y, z] offset of the axis origin from the hip centre,
 *   neck: [[x?, y, z, r]...] visible neck (world points, radius), neckBones: [p1, p2, p3] pivots,
 *   head: {c, r: [w, h, l], pitch}, beak: {...}, eye: {...},
 *   leg: {knee, hock, ball, toe, hallux, r: [shin, tarsus, toe], feathered (tarsus), zygo},
 *   wing: featherWing options, tail: featherTail options, extras(B, ctx)
 * }
 */
export function bird(s) {
  const B = new Builder();
  const tau = (s.tilt ?? 30) * D2R;
  const ax = [0, Math.sin(tau), Math.cos(tau)], nu = [0, Math.cos(tau), -Math.sin(tau)];
  const hip = s.hip;
  const hc = [0, hip[1], hip[2]];
  const c0 = V.add(hc, [0, s.torsoOff?.[0] ?? 0.02, s.torsoOff?.[1] ?? 0]);
  const bp = (u, v = 0, x = 0) => V.add(V.add(V.add(c0, V.mul(ax, u)), V.mul(nu, v)), [x, 0, 0]);
  const T = s.torso;
  const uMin = T[0][0], uMax = T[T.length - 1][0];
  const tailBase = bp(uMin + 0.02 * (uMax - uMin), (s.tailBaseV ?? 0.2) * T[0][1]);
  const chestP = bp(uMax * 0.5, 0);
  // ---- skeleton
  B.bone('hips', null, hc, bp(uMax * 0.2));
  B.bone('chest', 'hips', bp(uMax * 0.2), bp(uMax * 0.85, T[T.length - 2][1] * 0.6));
  const nb = s.neckBones;
  B.bone('neck1', 'chest', nb[0], nb[1]);
  B.bone('neck2', 'neck1', nb[1], nb[2]);
  B.bone('neck3', 'neck2', nb[2], nb[3]);
  const H = s.head;
  const hd = [0, -Math.sin((H.pitch ?? 8) * D2R), Math.cos((H.pitch ?? 8) * D2R)];
  const hu = V.norm(V.cross(hd, [1, 0, 0])); // up of the head frame
  const hp = (a, b = 0, x = 0) => V.add(V.add(V.add(H.c, V.mul(hd, a)), V.mul(hu, b)), [x, 0, 0]);
  const BK = s.beak;
  const gape = hp(BK.gapeA ?? H.r[2] * 0.55, BK.gapeB ?? -H.r[1] * 0.35);
  const bpt = (BK.pitch || 0) * D2R, bdir = V.norm(V.add(V.mul(hd, Math.cos(bpt)), V.mul(hu, -Math.sin(bpt))));
  const btip = V.add(gape, V.mul(bdir, BK.len));
  B.bone('head', 'neck3', nb[3], V.add(btip, V.mul(hu, BK.h * 0.3)));
  B.bone('jaw', 'head', V.add(gape, V.mul(hd, -BK.len * 0.12)), V.add(btip, V.mul(hu, -BK.h * 0.2)));
  B.bone('tail1', 'hips', tailBase, V.add(tailBase, V.mul(s.tail.axis, s.tail.lenBone ?? 0.05 * (s.scale || 1))));
  const Lg = s.leg;
  B.sym((sx, Sd) => {
    const P = (p) => mx(p, sx);
    B.bone('thigh' + Sd, 'hips', P(hip), P(Lg.knee));
    B.bone('shin' + Sd, 'thigh' + Sd, P(Lg.knee), P(Lg.hock));
    B.bone('foot' + Sd, 'shin' + Sd, P(Lg.hock), P(Lg.ball));
    B.bone('toes' + Sd, 'foot' + Sd, P(Lg.ball), P(Lg.toe));
    B.bone('hallux' + Sd, 'foot' + Sd, P(Lg.ball), P(Lg.hallux));
  });
  const ctx = { B, s, S: s.scale || 1, ax, nu, bp, c0, hc, hp, hd, hu, gape, btip, tailBase, chestP, H: s.height, hEst: s.hEst || 0.0008 * (s.scale || 1) };

  // ---- body
  const fn = s.featherNoise ?? 0.0;
  B.loft(T.map(([u, ht, hb, w]) => ({ p: bp(u), w, ht, hb })), { up: nu, bones: ['hips', 'chest'], part: 'torso', k: 0, caps: s.torsoCaps || [0.7, 0.8], res: 6, noise: fn ? { amp: fn, freq: 0.6 / fn, seed: 3, oct: 2 } : null });
  // breast / belly fullness and the back between the wings
  if (s.breast) B.ell(bp(s.breast[0], s.breast[1]), s.breast[2], { bones: ['chest'], part: 'breast', k: s.breast[3] ?? 0.02, axes: [[1, 0, 0], nu, ax] });
  // visible neck: loft from the torso front to the back of the head
  const NK = s.neck;
  B.loft(NK.map(([y, z, r, rz]) => ({ p: [0, y, z], w: r, ht: rz ?? r, hb: rz ?? r })), { bones: ['chest', 'neck1', 'neck2', 'neck3', 'head'], part: 'neck', k: s.neckK ?? 0.012 * (s.scale || 1), up: [0, 0, -1], caps: [0.6, 0.6] });
  // ---- head
  const hk = s.headK ?? H.r[0] * 0.5;
  B.ell(H.c, H.r, { bones: ['head'], part: 'head', k: hk, axes: [[1, 0, 0], hu, hd] });
  if (H.cheek) B.sym((sx) => B.ell(mx(hp(H.cheek[0], H.cheek[1], H.cheek[2]), sx), H.cheek[3], { bones: ['head'], part: 'cheek', k: hk * 0.8, axes: [[1, 0, 0], hu, hd] }));
  if (H.crown) B.ell(hp(H.crown[0], H.crown[1]), H.crown[2], { bones: ['head'], part: 'crown', k: hk * 0.8, axes: [[1, 0, 0], hu, hd] });
  if (H.throat) B.ell(hp(H.throat[0], H.throat[1]), H.throat[2], { bones: ['head', 'jaw'], part: 'throat', k: hk * 0.8, axes: [[1, 0, 0], hu, hd] });
  beak(B, ctx, BK);
  const E = s.eye;
  B.eye(hp(E.a, E.b, E.x), E.r, E.dir, { open: E.open ?? 0.85, protrude: E.protrude ?? 0.38, wide: E.wide ?? 1.05, lidMat: 'eyelid', k: E.r * 0.3 });
  // ---- legs
  B.sym((sx, Sd) => leg(B, ctx, sx, Sd));
  // ---- wings and tail
  ctx.wing = featherWing(B, { parent: 'chest', ...s.wing });
  // tail base (uropygium) and the tail feathers
  B.ell(V.add(tailBase, V.mul(s.tail.axis, 0.01 * (s.scale || 1))), [T[0][3] * 1.3, T[0][1] * 1.1, (uMax - uMin) * 0.12], { bones: ['tail1', 'hips'], part: 'torso', k: 0.012 * (s.scale || 1), axes: [[1, 0, 0], nu, ax] });
  featherTail(B, { bone: 'tail1', base: V.add(tailBase, V.mul(s.tail.axis, -0.01 * (s.scale || 1))), ...s.tail });
  s.extras?.(B, ctx);
  return { B, lm: { ...ctx, H: s.height, HL: H.r[2] * 2, headCenter: hp(BK.len * 0.25, 0), headFit: Math.max(H.r[0], H.r[1], H.r[2]) * 1.25 + BK.len * 0.6 } };
}

// ------------------------------------------------------------------ beak
function beak(B, c, K) {
  const { hp, gape } = c;
  // beak axes: the head's, tilted down by K.pitch (owls, parrots)
  const pt = (K.pitch || 0) * D2R;
  const hd = V.norm(V.add(V.mul(c.hd, Math.cos(pt)), V.mul(c.hu, -Math.sin(pt)))), hu = V.norm(V.cross(hd, [1, 0, 0]));
  const L = K.len, Hb = K.h, W = K.w;
  const hook = K.hook || 0; // tip drop below the gape line (fraction of the length)
  const at = (t, v) => V.add(V.add(gape, V.mul(hd, L * t)), V.mul(hu, v));
  // upper mandible: culmen curve from the base to the (hooked) tip
  const up = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // culmen height above the gape line, tomium edge (drops below it at a hooked tip)
    const top = Hb * Math.pow(1 - t, K.taper ?? 0.9) * (1 + (K.bulge || 0) * Math.sin(Math.PI * t)) + Hb * 0.07;
    const drop = hook * L * Math.pow(t, 2.6);
    const topE = top - drop * 0.85, botE = -drop + Hb * 0.01;
    const width = W * Math.pow(1 - t, K.wTaper ?? 0.75) + W * 0.07;
    const hh = Math.max(Hb * 0.05, (topE - botE) / 2);
    up.push({ p: at(t * (1 - hook * 0.22), (topE + botE) / 2), w: width * 0.5, ht: hh, hb: hh });
  }
  B.loft(up, { bones: ['head'], part: 'beak', mat: 'keratin', k: K.k ?? Hb * 0.25, up: hu, caps: [0.6, 0.4] });
  // lower mandible (shorter under a hooked tip)
  const lo = [];
  const lLen = K.lowLen ?? (1 - hook * 0.45);
  for (let i = 0; i <= 5; i++) {
    const t = (i / 5) * lLen;
    const d = (K.lowH ?? Hb * 0.55) * (1 - (t / lLen) * 0.72);
    lo.push({ p: at(t, -d * 0.5 - Hb * 0.015), w: W * 0.48 * Math.pow(1 - t, 0.7) + W * 0.05, ht: d * 0.5, hb: d * 0.5 });
  }
  B.loft(lo, { bones: ['jaw'], part: 'beak', mat: 'keratin', k: K.k ?? Hb * 0.2, up: hu, caps: [0.6, 0.55] });
  // gape line (mouth slit, separates the mandibles), nostrils, cere
  const slit = Math.max(c.hEst || 0.0008, Hb * 0.03);
  // the slit walls are painted as mouth only in a thin band (they show when the beak opens)
  B.ell(at(0.4, Hb * 0.0), [W * 0.6, slit, L * 0.66], { op: 'sub', k: slit * 0.8, axes: [[1, 0, 0], hu, hd], mat: 'mouth', carve: slit * 1.2 });
  B.sym((sx) => B.ell(mx(at(K.nostrilA ?? 0.18, Hb * 0.62, 0), sx).map((v, i) => (i === 0 ? sx * W * 0.24 : v)), [Hb * 0.05, Hb * 0.04, Hb * 0.11], { op: 'sub', k: Hb * 0.04, axes: [[1, 0, 0], hu, hd], mat: 'keratin' }));
  if (K.cere) B.ell(at(K.cere[0], Hb * 0.62), [W * 0.52, Hb * 0.5, L * K.cere[1]], { bones: ['head'], part: 'cere', mat: 'skin', k: Hb * 0.15, axes: [[1, 0, 0], hu, hd] });
  void hp;
}

// ------------------------------------------------------------------ leg
function leg(B, c, sx, S) {
  const { s } = c;
  const Lg = s.leg, r = Lg.r;
  const P = (p) => mx(p, sx);
  const knee = P(Lg.knee), hock = P(Lg.hock), ball = P(Lg.ball);
  // drumstick (feathered) from the belly to the hock
  B.loft([
    { p: V.lerp(P(s.hip), knee, 0.5), w: r[0] * 1.5, ht: r[0] * 1.6, hb: r[0] * 1.6 },
    { p: knee, w: r[0] * 1.3, ht: r[0] * 1.4, hb: r[0] * 1.4 },
    { p: V.lerp(knee, hock, 0.55), w: r[0] * 1.0, ht: r[0] * 1.05, hb: r[0] * 1.05 },
    { p: V.lerp(knee, hock, Lg.feathered ? 1.05 : 0.92), w: r[1] * (Lg.feathered ? 1.9 : 1.25), ht: r[1] * (Lg.feathered ? 1.9 : 1.25), hb: r[1] * (Lg.feathered ? 1.9 : 1.25) },
  ], { bones: ['thigh' + S, 'shin' + S], part: 'leg', k: r[0] * 0.6, caps: [0.7, 0.7], noise: Lg.trousers ? { amp: r[0] * 0.25, freq: 2.5 / r[0], seed: 11, oct: 2 } : null });
  // tarsus (scaly, or feathered for owls / golden eagles)
  B.loft([
    { p: hock, w: r[1] * 1.15, ht: r[1] * 1.2, hb: r[1] * 1.2 },
    { p: V.lerp(hock, ball, 0.5), w: r[1], ht: r[1], hb: r[1] },
    { p: ball, w: r[1] * 1.1, ht: r[1] * 1.0, hb: r[1] * 1.0 },
  ], { bones: ['shin' + S, 'foot' + S], part: Lg.feathered ? 'leg' : 'tarsus', mat: Lg.feathered ? 'fur' : 'scale', k: r[1] * 0.5, caps: [0.7, 0.7], noise: Lg.feathered ? { amp: r[1] * 0.3, freq: 2 / r[1], seed: 12, oct: 2 } : null });
  // toes: front ones spread around the middle toe, hallux behind (zygodactyl: 2 + 2)
  const mid = P(Lg.toe), hal = P(Lg.hallux);
  const toeLen = V.dist(ball, mid);
  const spread = Lg.spread ?? 26;
  const fronts = Lg.zygo ? [[-14, 1], [16, 0.95]] : [[-spread, 0.82], [0, 1], [spread, 0.88]];
  const toes = fronts.map(([a, k]) => {
    const d = rotAxis(V.norm(V.sub(mid, ball)), [0, 1, 0], a * sx);
    return [V.add(ball, V.mul(d, toeLen * k)), 'toes' + S];
  });
  toes.push([hal, 'hallux' + S]);
  if (Lg.zygo) { const d = rotAxis(V.norm(V.sub(hal, ball)), [0, 1, 0], -28 * sx); toes.push([V.add(ball, V.mul(d, V.dist(ball, hal) * 1.05)), 'hallux' + S]); }
  const footMat = Lg.feathered && Lg.featheredToes ? 'fur' : 'scale';
  for (const [tp, bone] of toes) {
    const d = V.norm(V.sub(tp, ball));
    const len = V.dist(tp, ball);
    const knuckle = V.add(V.add(ball, V.mul(d, len * 0.45)), [0, r[2] * 0.5, 0]);
    B.loft([
      { p: V.add(ball, [0, r[2] * 0.6, 0]), w: r[2] * 1.15, ht: r[2] * 1.0, hb: r[2] * 0.9 },
      { p: knuckle, w: r[2] * 0.95, ht: r[2] * 0.9, hb: r[2] * 0.85 },
      { p: V.add(tp, [0, r[2] * 0.75, 0]), w: r[2] * 0.75, ht: r[2] * 0.72, hb: r[2] * 0.7 },
    ], { bones: [bone], part: 'toe', mat: footMat, k: r[2] * 0.45, caps: [0.6, 0.9] });
    // claw: curved down from the toe tip
    const cl = Lg.claw ?? r[2] * 2.4;
    const c1 = V.add(tp, [0, r[2] * 0.8, 0]), c2 = V.add(V.add(tp, V.mul(d, cl * 0.6)), [0, r[2] * 0.55, 0]), c3 = V.add(V.add(tp, V.mul(d, cl * 0.95)), [0, Math.max(0.0005, r[2] * 0.05), 0]);
    B.loft([{ p: c1, w: r[2] * 0.42, ht: r[2] * 0.5, hb: r[2] * 0.42 }, { p: c2, w: r[2] * 0.3, ht: r[2] * 0.34, hb: r[2] * 0.3 }, { p: c3, w: r[2] * 0.08, ht: r[2] * 0.1, hb: r[2] * 0.08 }], { bones: [bone], part: 'claw', mat: 'keratin', k: r[2] * 0.2, caps: [0.6, 0.6] });
  }
  // flat sole under the toes
  B.box([ball[0], -0.05, ball[2]], [0.2, 0.05, 0.2], 0.001, { op: 'sub', k: r[2] * 0.3 });
}
