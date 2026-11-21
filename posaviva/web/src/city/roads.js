// Road modules: straight, curve, crossroads, T-junction, roundabout, parking lot,
// railway, sidewalk, paved square, park path, zebra crossing, manhole, drain.
// Every module is a prop built from 2D layout paths in the XZ plane:
//   carriageway polygon   -> asphalt (y = Y_ASPH)
//   curb paths            -> {p: [x, z], n: [nx, nz]} points, n = unit normal toward the sidewalk
//   sidewalks             -> band between the curb and the curb path offset by the sidewalk width
//   markings              -> thin painted strips just above the asphalt
// Modules expose `connectors(params)` (ends that snap to each other: local x, z
// and the outward heading `yaw`) and `lanes(params)` / `slots(params)` (where
// vehicles go). Driving on the right: heading +Z uses the lanes at x < 0.
import * as THREE from 'three';
import { loft, polyXZ, stripXZ, annulus, sweep, box, boxOn, cylinder, torus, rng, makeNoise } from './util.js';
import { seed as seedParam, seg, range, int, flag } from '../props/params.js';

export const Y_ASPH = 0.012, Y_PAINT = 0.0155, Y_WALK = 0.14, CURB_W = 0.15, Y_CURB = 0.145;
const TILE = { asphalt: 4, pavers: 1.6, cobbles: 1.0, gravel: 1.0, grass: 2.0 };
const PAVE_ROLE = { lastre: 'c:pavers', porfido: 'c:cobbles', asfalto: 'c:asphaltOld' };

// ------------------------------------------------------------------ path helpers
const len2 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Straight path from a to b with constant normal n. */
function linePath(a, b, n, step = 2) {
  const L = len2(a, b), k = Math.max(1, Math.ceil(L / step));
  const out = [];
  for (let i = 0; i <= k; i++) { const t = i / k; out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], n: [...n] }); }
  return out;
}
/** Arc path around center c, radius r, angle a0 -> a1 (angle from +Z toward +X). inward: normal toward the center. */
function arcPath(c, r, a0, a1, inward, step = 0.5) {
  const k = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / step));
  const out = [];
  for (let i = 0; i <= k; i++) {
    const a = a0 + (a1 - a0) * (i / k), s = Math.sin(a), co = Math.cos(a);
    out.push({ p: [c[0] + s * r, c[1] + co * r], n: inward ? [-s, -co] : [s, co] });
  }
  return out;
}
/** Concatenates paths (drops duplicated joints). */
function joinPaths(...ps) {
  const out = [];
  for (const p of ps) for (const q of p) { const l = out[out.length - 1]; if (l && len2(l.p, q.p) < 1e-4) { l.n = [(l.n[0] + q.n[0]) / 2, (l.n[1] + q.n[1]) / 2]; const k = Math.hypot(...l.n) || 1; l.n = [l.n[0] / k, l.n[1] / k]; continue; } out.push({ p: [...q.p], n: [...q.n] }); }
  return out;
}

/** Points of a path offset along its normals. */
const offsetPts = (path, d) => path.map(({ p, n }) => [p[0] + n[0] * d, p[1] + n[1] * d]);

/** Loft along a path with a cross profile [[d (along n), y], ...]; oriented so the face at profile index `up` faces +Y. */
function profileAlong(path, profile, upIndex = 1, caps = true) {
  const rings = path.map(({ p, n }) => profile.map(([d, y]) => [p[0] + n[0] * d, y, p[1] + n[1] * d]));
  let g = loft(rings, { closed: false, capStart: caps, capEnd: caps, uScale: 1, vs: cumLen(path) });
  const nn = g.attributes.normal;
  if (nn.getY(upIndex) < 0) { g.dispose(); g = loft(rings, { closed: false, capStart: caps, capEnd: caps, uScale: 1, vs: cumLen(path), flip: true }); }
  return g;
}
function cumLen(path) { const v = [0]; for (let i = 1; i < path.length; i++) v.push(v[i - 1] + len2(path[i - 1].p, path[i].p)); return v; }

/** Curb stone along a path (road face, chamfer, top). */
function curb(path) {
  return profileAlong(path, [[0, 0], [0, Y_CURB - 0.025], [0.025, Y_CURB], [CURB_W, Y_CURB], [CURB_W, Y_WALK - 0.02]], 2);
}

/** Sidewalk band between the curb and the offset width ww: paved top + outer edge face. */
function sidewalk(path, ww, out, pave = 'lastre') {
  const inner = offsetPts(path, CURB_W - 0.005), outer = offsetPts(path, ww);
  const poly = [...inner, ...outer.reverse()];
  const role = PAVE_ROLE[pave] || 'c:pavers';
  (out[role] ||= []).push(polyXZ(poly, Y_WALK, pave === 'porfido' ? TILE.cobbles : pave === 'asfalto' ? TILE.asphalt : TILE.pavers));
  // outer face + end caps (concrete)
  const edge = profileAlong(path.map(({ p, n }) => ({ p: [p[0] + n[0] * ww, p[1] + n[1] * ww], n })), [[0, Y_WALK], [0, 0]], 0, false);
  const ends = [];
  for (const q of [path[0], path[path.length - 1]]) {
    const a = [q.p[0] + q.n[0] * CURB_W, q.p[1] + q.n[1] * CURB_W], b = [q.p[0] + q.n[0] * ww, q.p[1] + q.n[1] * ww];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([a[0], 0, a[1], b[0], 0, b[1], b[0], Y_WALK, b[1], a[0], 0, a[1], b[0], Y_WALK, b[1], a[0], Y_WALK, a[1]], 3));
    g.computeVertexNormals();
    ends.push(g, flipCopy(g));
  }
  (out['c:curb'] ||= []).push(edge, ...ends);
}
function flipCopy(g) {
  const c = g.clone(), p = c.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
  c.computeVertexNormals();
  return c;
}

/** Curb + sidewalk on one side of the road. */
function walkSide(path, p, out) {
  (out['c:curb'] ||= []).push(curb(path));
  sidewalk(path, p.walkW, out, p.pave);
}

// ------------------------------------------------------------------ markings
function polyline2(pts) { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + len2(pts[i - 1], pts[i])); return c; }
function subLine(pts, cum, a, b) {
  const out = [];
  const at = (s) => { let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; };
  out.push(at(a));
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > a && cum[i] < b) out.push(pts[i]);
  out.push(at(b));
  return out;
}
/** Dashed / solid line along a polyline of [x, z]. */
function paintLine(pts, out, { w = 0.12, dash = 0, gap = 0, role = 'c:paint', y = Y_PAINT, offset = 0 } = {}) {
  const list = (out[role] ||= []);
  const cum = polyline2(pts), L = cum[cum.length - 1];
  if (L < 0.05) return;
  if (!dash) { list.push(stripXZ(pts, w, y)); return; }
  for (let s = offset; s < L; s += dash + gap) {
    const a = Math.max(0, s), b = Math.min(L, s + dash);
    if (b - a > 0.05) list.push(stripXZ(subLine(pts, cum, a, b), w, y));
  }
}
const lineXZ = (a, b) => [a, b];
function arcXZ(c, r, a0, a1, step = 0.4) {
  const k = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / step)), out = [];
  for (let i = 0; i <= k; i++) { const a = a0 + (a1 - a0) * (i / k); out.push([c[0] + Math.sin(a) * r, c[1] + Math.cos(a) * r]); }
  return out;
}

/** Zebra crossing across a carriageway: center (x, z), direction of the road `dir` ('z' or 'x'), half width cw, depth along the road. */
function zebra(out, cx, cz, dir, cw, depth = 3, y = Y_PAINT) {
  const w = 0.5, gap = 0.5;
  const n = Math.floor((2 * cw - 0.3) / (w + gap));
  const start = -((n - 1) * (w + gap)) / 2;
  for (let i = 0; i < n; i++) {
    const t = start + i * (w + gap);
    const g = dir === 'z' ? polyXZ(rect(cx + t, cz, w, depth), y, 1) : polyXZ(rect(cx, cz + t, depth, w), y, 1);
    (out['c:paint'] ||= []).push(g);
  }
}
function rect(cx, cz, w, d) { return [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]]; }

/** Center / lane lines of a straight carriageway segment along a polyline of centers with lateral unit vector lat. */
function laneLines(out, p, pts, lat, { from = 0, to = null } = {}) {
  const cw = (p.lanes * p.laneW) / 2;
  const off = (d) => pts.map(([x, z], i) => [x + lat[i][0] * d, z + lat[i][1] * d]);
  const center = p.center;
  if (p.lanes % 2 === 0) {
    const c = off(0);
    if (center === 'tratteggiata') paintLine(c, out, { dash: 3, gap: 4.5 });
    else if (center === 'continua') paintLine(c, out, {});
    else if (center === 'doppia') { paintLine(off(0.1), out, {}); paintLine(off(-0.1), out, {}); }
    for (let k = 1; k < p.lanes / 2; k++) for (const s of [-1, 1]) paintLine(off(s * k * p.laneW), out, { dash: 4.5, gap: 7.5, w: 0.12 });
  } else if (p.lanes > 1) {
    for (let k = 1; k < p.lanes; k++) paintLine(off(-cw + k * p.laneW), out, { dash: 4.5, gap: 7.5, w: 0.12 });
  }
  if (p.walk === 'nessuno' || p.edge) for (const s of [-1, 1]) paintLine(off(s * (cw - 0.2)), out, { w: 0.12 });
}

// ------------------------------------------------------------------ street details
function manhole(out, x, z, r = 0.32) {
  const g = cylinder(r, r, 0.006, { x, y: Y_ASPH - 0.002, z, bevel: 0.002, seg: 24 });
  const ring = torus(r - 0.03, 0.008, { rx: 90, x, y: Y_ASPH + 0.004, z, rs: 4, ts: 24 });
  const bars = [];
  for (let k = 0; k < 4; k++) bars.push(box(r * 1.5, 0.006, 0.025, { x, y: Y_ASPH + 0.004, z, ry: k * 45, r: 0 }));
  (out['c:iron'] ||= []).push(g, ring, ...bars);
}
function drain(out, x, z, yaw = 0) {
  const parts = [box(0.62, 0.008, 0.36, { x, y: Y_ASPH + 0.001, z, ry: yaw, r: 0 })];
  (out['c:iron'] ||= []).push(...parts);
  for (let k = -3; k <= 3; k++) {
    const ox = Math.cos((yaw * Math.PI) / 180) * k * 0.075, oz = -Math.sin((yaw * Math.PI) / 180) * k * 0.075;
    (out['c:trim'] ||= []).push(box(0.035, 0.004, 0.3, { x: x + ox, y: Y_ASPH + 0.0055, z: z + oz, ry: yaw, r: 0 }));
  }
}

// ------------------------------------------------------------------ cross-section params
const LANES = int('lanes', 'Corsie', 1, 4, 2);
const LANEW = range('laneW', 'Larghezza corsia', 2.5, 4, 0.05, 3.25);
const WALK = seg('walk', 'Marciapiedi', [['entrambi', 'Due'], ['uno', 'Uno'], ['nessuno', 'Nessuno']], 'entrambi');
const WALKW = range('walkW', 'Larghezza marciapiede', 1, 5, 0.1, 2.4);
const PAVE = seg('pave', 'Pavimentazione', [['lastre', 'Lastre'], ['porfido', 'Porfido'], ['asfalto', 'Asfalto']], 'lastre');
const CENTER = seg('center', 'Linea di mezzeria', [['tratteggiata', 'Tratteggiata'], ['continua', 'Continua'], ['doppia', 'Doppia'], ['nessuna', 'Nessuna']], 'tratteggiata');
const CROSS = flag('crossing', 'Strisce pedonali', true);
const CROSS_OFF = flag('crossing', 'Strisce pedonali', false);
const DETAILS = flag('details', 'Tombini e caditoie', true);
export const XSEC = [LANES, LANEW, WALK, WALKW, PAVE, CENTER];
const XSEC_IDS = XSEC.map((d) => d.id);
/** Cross-section params of a road prop (for connected pieces). */
export function xsecOf(params) { const o = {}; for (const k of XSEC_IDS) if (k in params) o[k] = params[k]; return o; }

const halfW = (p) => (p.lanes * p.laneW) / 2;
const sides = (p) => (p.walk === 'entrambi' ? [-1, 1] : p.walk === 'uno' ? [-1] : []);
/** Extra width of the asphalt where there is no sidewalk (shoulder). */
const shoulder = 0.5;

// ------------------------------------------------------------------ straight
function straight(p) {
  const out = {}, L = p.length, cw = halfW(p), rnd = rng(p.seed || 1);
  const S = sides(p);
  const xl = S.includes(-1) ? -cw - 0.08 : -cw - shoulder, xr = S.includes(1) ? cw + 0.08 : cw + shoulder;
  (out['c:asphalt'] ||= []).push(polyXZ([[xl, -L / 2], [xr, -L / 2], [xr, L / 2], [xl, L / 2]], Y_ASPH, TILE.asphalt));
  for (const s of S) walkSide(linePath([s * cw, s > 0 ? -L / 2 : L / 2], [s * cw, s > 0 ? L / 2 : -L / 2], [s, 0]), p, out);
  // markings (stop before the crossing)
  const zEnd = p.crossing ? L / 2 - 4.2 : L / 2;
  if (zEnd > -L / 2 + 0.5) {
    const pts = [[0, -L / 2], [0, zEnd]];
    laneLines(out, p, pts, [[1, 0], [1, 0]]);
  }
  if (p.crossing && L >= 5) {
    zebra(out, 0, L / 2 - 2.1, 'z', cw, 3);
    paintLine([[-cw + 0.1, L / 2 - 4.0], [0, L / 2 - 4.0]], out, { w: 0.4 }); // stop line (lanes heading +Z, x < 0)
  }
  if (p.details) {
    const n = Math.max(1, Math.round(L / 12));
    for (let i = 0; i < n; i++) {
      const z = -L / 2 + (i + 0.5) * (L / n) + rnd.range(-1, 1);
      const lane = rnd.int(0, p.lanes - 1);
      if (Math.abs(z) < L / 2 - 1) manhole(out, -cw + p.laneW * (lane + 0.5) + rnd.range(-0.3, 0.3), z);
      for (const s of S) if (rnd() < 0.7) drain(out, s * (cw - 0.24), z + rnd.range(-3, 3) * 0.5, 0);
    }
  }
  return out;
}
const straightConn = (p) => [{ x: 0, z: p.length / 2, yaw: 0 }, { x: 0, z: -p.length / 2, yaw: Math.PI }];
function laneOffsets(p) {
  const cw = halfW(p), o = [];
  for (let k = 0; k < p.lanes; k++) { const x = -cw + p.laneW * (k + 0.5); o.push({ x, dir: x < -1e-3 || (p.lanes % 2 === 1 && Math.abs(x) < 1e-3) ? 1 : -1 }); }
  return o;
}
const straightLanes = (p) => laneOffsets(p).map(({ x, dir }) => ({ pts: dir > 0 ? [[x, -p.length / 2], [x, p.length / 2]] : [[x, p.length / 2], [x, -p.length / 2]] }));

// ------------------------------------------------------------------ curve
function curveLayout(p) {
  const cw = halfW(p), A = (p.angle * Math.PI) / 180;
  const Rc = Math.max(p.radius, cw + (p.walk === 'nessuno' ? 0 : p.walkW) + 1.5);
  // center of the arc at (Rc, 0): start (0, 0) heading +Z, end turning toward +X
  const c = [Rc, 0];
  const P = (phi, d = 0) => [c[0] - (Rc - d) * Math.cos(phi), c[1] + (Rc - d) * Math.sin(phi)];
  // footprint bounds -> recenter
  const ext = cw + (p.walk === 'nessuno' ? shoulder : p.walkW);
  const xs = [], zs = [];
  for (let i = 0; i <= 16; i++) { const phi = (A * i) / 16; for (const d of [-ext, ext]) { const q = P(phi, d); xs.push(q[0]); zs.push(q[1]); } }
  const ox = (Math.min(...xs) + Math.max(...xs)) / 2, oz = (Math.min(...zs) + Math.max(...zs)) / 2;
  return { cw, A, Rc, c: [c[0] - ox, c[1] - oz], P: (phi, d) => { const q = P(phi, d); return [q[0] - ox, q[1] - oz]; } };
}
function curve(p) {
  const out = {}, { cw, A, Rc, c } = curveLayout(p);
  // annulus angles: point = c + r (sin a, cos a); our points: c + r(-cos phi, sin phi) -> a = phi - pi/2
  const a0 = -Math.PI / 2, a1 = A - Math.PI / 2;
  const S = sides(p);
  const rIn = Rc - cw - (S.includes(1) ? 0.08 : shoulder), rOut = Rc + cw + (S.includes(-1) ? 0.08 : shoulder);
  const asph = annulus(rIn, rOut, a0, a1, Y_ASPH, { seg: 96, tile: TILE.asphalt });
  asph.translate(c[0], 0, c[1]);
  (out['c:asphalt'] ||= []).push(asph);
  // inner side (+X at the start, toward the center) = side +1, outer = side -1
  if (S.includes(1)) walkSide(arcPath(c, Rc - cw, a0, a1, true), p, out);
  if (S.includes(-1)) walkSide(arcPath(c, Rc + cw, a1, a0, false), p, out);
  // lane lines along the arc
  const pts = arcXZ(c, Rc, a0, a1, 0.3);
  const lat = pts.map(([x, z]) => { const dx = c[0] - x, dz = c[1] - z, l = Math.hypot(dx, dz); return [dx / l, dz / l]; });
  laneLines(out, p, pts, lat);
  return out;
}
function curveConn(p) {
  const { A, P } = curveLayout(p);
  const s = P(0, 0), e = P(A, 0);
  return [{ x: s[0], z: s[1], yaw: Math.PI }, { x: e[0], z: e[1], yaw: A }];
}
function curveLanes(p) {
  const { A, P } = curveLayout(p);
  return laneOffsets(p).map(({ x, dir }) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) pts.push(P((A * i) / 24, x));
    return { pts: dir > 0 ? pts : pts.reverse() };
  });
}

// ------------------------------------------------------------------ crossroads / T-junction
function cornerR(p) { return Math.max(p.walkW + 0.6, 2.5); }
/** Curb path of the corner in quadrant (sx, sz): from the z arm (outer end) around the fillet to the x arm. */
function cornerPath(p, E, sx, sz) {
  const cw = halfW(p), rc = cornerR(p);
  const a = linePath([sx * cw, sz * E], [sx * cw, sz * (cw + rc)], [sx, 0]);
  // fillet center (sx (cw + rc), sz (cw + rc)); from the -sx direction to the -sz direction, normal toward the center
  const cxz = [sx * (cw + rc), sz * (cw + rc)];
  const angA = Math.atan2(-sx, 0), angB = Math.atan2(0, -sz);
  let d = angB - angA; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const arc = arcPath(cxz, rc, angA, angA + d, true, 0.25);
  const b = linePath([sx * (cw + rc), sz * cw], [sx * E, sz * cw], [0, sz]);
  return joinPaths(a, arc, b);
}
/** Orders a path so the sidewalk is consistently built (direction does not matter for our builders). */
function junction(p, arms) {
  // arms: subset of ['+z', '-z', '+x', '-x']
  const out = {}, cw = halfW(p), E = p.size / 2, rc = cornerR(p), rnd = rng(p.seed || 1);
  const has = (a) => arms.includes(a);
  const hasWalk = p.walk !== 'nessuno';
  // asphalt: arms + center square + fillets (one outline polygon)
  const outline = [];
  const quads = [[1, 1], [1, -1], [-1, -1], [-1, 1]]; // walk clockwise from +x+z
  const pushPath = (path) => { for (const q of path) outline.push([q.p[0] - q.n[0] * 0.08 * (hasWalk ? -1 : 0), q.p[1] - q.n[1] * 0.08 * (hasWalk ? -1 : 0)]); };
  const corners = [];
  for (const [sx, sz] of quads) {
    const zArm = sz > 0 ? '+z' : '-z', xArm = sx > 0 ? '+x' : '-x';
    if (has(zArm) && has(xArm)) corners.push([sx, sz, cornerPath(p, E, sx, sz)]);
    else if (has(zArm) && !has(xArm)) corners.push([sx, sz, linePath([sx * cw, sz * E], [sx * cw, 0], [sx, 0])]);
    else if (!has(zArm) && has(xArm)) corners.push([sx, sz, linePath([0, sz * cw], [sx * E, sz * cw], [0, sz])]);
    else corners.push([sx, sz, null]);
  }
  // polygon: go around the quadrants in order, orienting each corner path consistently (clockwise)
  for (const [sx, sz, path] of corners) {
    if (!path) { outline.push([sx * cw, sz * cw]); continue; }
    // clockwise order seen from above: +x+z: from z arm end to x arm end; +x-z: from x arm to z arm …
    const fwd = (sx > 0 && sz > 0) || (sx < 0 && sz < 0);
    pushPath(fwd ? path : [...path].reverse());
  }
  const asph = polyXZ(hasWalk ? outline : outline.map(([x, z]) => [x + Math.sign(x) * (Math.abs(x) <= cw + 1e-3 ? shoulder : 0), z + Math.sign(z) * (Math.abs(z) <= cw + 1e-3 ? shoulder : 0)]), Y_ASPH, TILE.asphalt);
  (out['c:asphalt'] ||= []).push(asph);
  if (hasWalk) for (const [, , path] of corners) if (path) walkSide(path, p, out);
  // through-road sides without an arm get a straight sidewalk (T-junction): handled by the line paths above
  // markings per arm
  const zd = 3, z0 = cw + rc + 0.3;
  for (const a of arms) {
    const ax = a[1] === 'x', s = a[0] === '+' ? 1 : -1;
    const from = p.crossing ? z0 + zd + 0.6 : cw + 0.6;
    const P2 = (along, lat) => (ax ? [s * along, -s * lat] : [lat * s, s * along]);
    // center line from the stop line to the arm end
    if (E - from > 0.5) {
      const pts = [P2(from, 0), P2(E, 0)];
      const lat = ax ? [[0, 1], [0, 1]] : [[1, 0], [1, 0]];
      if (p.lanes % 2 === 0 && p.center !== 'nessuna') paintLine(pts, out, {});
      laneLines(out, { ...p, center: 'nessuna' }, pts, lat);
    }
    if (p.crossing) zebra(out, ...P2(z0 + zd / 2, 0), ax ? 'x' : 'z', cw, zd);
    // stop line on the incoming half (traffic toward the center keeps right)
    const stopAt = p.crossing ? z0 + zd + 0.4 : cw + 0.5;
    paintLine([P2(stopAt, 0), P2(stopAt, cw - 0.1)], out, { w: 0.4 });
  }
  if (p.details) {
    manhole(out, rnd.range(-1, 1), rnd.range(-1, 1));
    for (const a of arms) {
      const ax = a[1] === 'x', s = a[0] === '+' ? 1 : -1, along = E - 2 - rnd() * 2;
      for (const side of hasWalk ? [-1, 1] : []) if (rnd() < 0.6) drain(out, ax ? s * along : side * (cw - 0.24), ax ? side * (cw - 0.24) : s * along, ax ? 90 : 0);
    }
  }
  return out;
}
const armConn = (E, arms) => arms.map((a) => {
  const s = a[0] === '+' ? 1 : -1;
  return a[1] === 'z' ? { x: 0, z: s * E, yaw: s > 0 ? 0 : Math.PI } : { x: s * E, z: 0, yaw: s * Math.PI / 2 };
});
function armLanes(p, E, arms) {
  const res = [];
  for (const a of arms) {
    const s = a[0] === '+' ? 1 : -1, ax = a[1] === 'x';
    for (const { x, dir } of laneOffsets(p)) {
      // straight piece along the arm from the center outward (+along) with lateral x
      const A = (along) => (ax ? [s * along, -s * x] : [s * x, s * along]);
      const pts = [A(halfW(p) + 1), A(p.size / 2)];
      res.push({ pts: dir > 0 ? pts.reverse() : pts });
    }
  }
  return res;
}

// ------------------------------------------------------------------ roundabout
function roundLayout(p) {
  const cw = halfW(p), ringW = p.ringLanes * p.laneW + 0.6, Ri = p.island, Ro = Ri + ringW;
  const rf = Math.max(p.walkW + 1.2, 3);
  const E = Math.max(p.size / 2, Ro + rf + 3);
  return { cw, ringW, Ri, Ro, rf, E };
}
function roundCornerPath(p, L, sx, sz) {
  // quadrant between the z arm (x = sx cw) and the x arm (z = sz cw)
  const { cw, Ro, rf, E } = L;
  const Cz = Math.sqrt((Ro + rf) ** 2 - (cw + rf) ** 2);
  const C1 = [sx * (cw + rf), sz * Cz], C2 = [sx * Cz, sz * (cw + rf)];
  const a = linePath([sx * cw, sz * E], [sx * cw, sz * Cz], [sx, 0]);
  const ang = (v) => Math.atan2(v[0], v[1]);
  const fil = (C, from, to) => { let d = to - from; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return arcPath(C, rf, from, from + d, true, 0.25); };
  const f1 = fil(C1, ang([-sx, 0]), ang([-C1[0], -C1[1]]));
  const t1 = ang(C1), t2 = ang(C2);
  let d = t2 - t1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const ring = arcPath([0, 0], Ro, t1, t1 + d, false, 0.4);
  const f2 = fil(C2, ang([-C2[0], -C2[1]]), ang([0, -sz]));
  const b = linePath([sx * Cz, sz * cw], [sx * E, sz * cw], [0, sz]);
  return joinPaths(a, f1, ring, f2, b);
}
function rotonda(p) {
  const out = {}, L = roundLayout(p), { cw, Ri, Ro, E } = L;
  const hasWalk = p.walk !== 'nessuno';
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sx, sz]) => [sx, sz, roundCornerPath(p, L, sx, sz)]);
  const outline = [];
  for (const [sx, sz, path] of corners) {
    const fwd = (sx > 0 && sz > 0) || (sx < 0 && sz < 0);
    for (const q of fwd ? path : [...path].reverse()) outline.push([q.p[0] + q.n[0] * (hasWalk ? 0.08 : shoulder), q.p[1] + q.n[1] * (hasWalk ? 0.08 : shoulder)]);
  }
  (out['c:asphalt'] ||= []).push(polyXZ(outline, Y_ASPH, TILE.asphalt));
  if (hasWalk) for (const [, , path] of corners) walkSide(path, p, out);
  // central island: curb ring + grass top
  const isl = arcPath([0, 0], Ri, 0, Math.PI * 2, true, 0.3);
  (out['c:curb'] ||= []).push(curb(isl));
  const top = polyXZ(offsetPts(isl, CURB_W - 0.01), Y_WALK + 0.01, TILE.grass);
  (out['c:grass'] ||= []).push(top);
  // markings: ring lane divider, give-way dashes at the entries, arm center lines
  if (p.ringLanes > 1) paintLine(arcXZ([0, 0], Ri + 0.3 + p.laneW, 0, Math.PI * 2), out, { dash: 3, gap: 3 });
  const giveR = Ro + 0.6;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, s = Math.sin(a), c = Math.cos(a);
    const P2 = (along, lat) => [s * along + c * lat, c * along - s * lat];
    const zEntry = Math.sqrt(Math.max(0, giveR * giveR - cw * cw)) + 0.4;
    // incoming lanes (keep right): lat in [0, cw] -> lat < 0 for heading toward the center? use the right side (-lat)
    paintLine([P2(zEntry, 0.15), P2(zEntry, cw - 0.15)], out, { w: 0.3, dash: 0.5, gap: 0.3 });
    if (p.lanes % 2 === 0) paintLine([P2(zEntry + 0.6, 0), P2(E, 0)], out, {});
    if (p.crossing) zebra(out, ...P2(zEntry + 3.2, 0), Math.abs(s) > 0.5 ? 'x' : 'z', cw, 2.5);
  }
  return out;
}
const roundConn = (p) => armConn(roundLayout(p).E, ['+z', '-z', '+x', '-x']);
function roundLanes(p) {
  const { Ri, E } = roundLayout(p), res = [];
  const r = Ri + 0.3 + p.laneW / 2, pts = [];
  for (let i = 0; i <= 48; i++) { const a = -(i / 48) * Math.PI * 2; pts.push([Math.sin(a) * r, Math.cos(a) * r]); } // counter-clockwise seen from above
  res.push({ pts, loop: true });
  return res.concat(armLanes({ ...p, size: 2 * E }, E, ['+z', '-z', '+x', '-x']));
}

// ------------------------------------------------------------------ parking lot
function parkLayout(p) {
  const sw = 2.5, sd = 5.0, aisle = 6.0, n = p.stalls, rows = p.rows;
  const W = n * sw + 1.0, D = rows * sd + aisle + 0.6;
  return { sw, sd, aisle, n, rows, W, D };
}
function parcheggio(p) {
  const out = {}, L = parkLayout(p), { sw, sd, n, rows, W, D } = L;
  (out['c:asphalt'] ||= []).push(polyXZ(rect(0, 0, W, D), Y_ASPH, TILE.asphalt));
  const role = p.lines === 'blu' ? 'c:paintB' : 'c:paint';
  const rowZ = rows === 2 ? [-D / 2 + 0.3, D / 2 - 0.3 - sd] : [-D / 2 + 0.3];
  for (const z0 of rowZ) {
    for (let i = 0; i <= n; i++) { const x = -W / 2 + 0.5 + i * sw; paintLine([[x, z0], [x, z0 + sd]], out, { w: 0.12, role }); }
    const zl = z0 === rowZ[0] ? z0 + sd : z0;
    paintLine([[-W / 2 + 0.5, zl], [W / 2 - 0.5, zl]], out, { w: 0.12, role });
  }
  // disabled stall (yellow)
  if (p.disabled) {
    const z0 = rowZ[0], x0 = -W / 2 + 0.5;
    for (const x of [x0, x0 + sw]) paintLine([[x, z0], [x, z0 + sd]], out, { w: 0.12, role: 'c:paintY', y: Y_PAINT + 0.0005 });
    for (let k = 0; k < 5; k++) paintLine([[x0 + 0.3, z0 + 0.4 + k * 0.9], [x0 + sw - 0.3, z0 + 0.9 + k * 0.9]], out, { w: 0.1, role: 'c:paintY' });
  }
  // aisle arrows
  for (const x of [-W / 4, W / 4]) {
    const z = rows === 2 ? 0 : D / 2 - 3.3;
    (out[role] ||= []).push(polyXZ([[x - 0.06, z - 1.2], [x + 0.06, z - 1.2], [x + 0.06, z - 0.3], [x - 0.06, z - 0.3]], Y_PAINT, 1), polyXZ([[x - 0.3, z - 0.3], [x + 0.3, z - 0.3], [x, z + 0.3]], Y_PAINT, 1));
  }
  if (p.border) {
    const e = 0.08;
    (out['c:curb'] ||= []).push(curb(linePath([-W / 2 - e, -D / 2 - e], [W / 2 + e, -D / 2 - e], [0, -1])), curb(linePath([W / 2 + e, -D / 2 - e], [W / 2 + e, D / 2 + e], [1, 0])),
      curb(linePath([-W / 2 - e, D / 2 + e], [-W / 2 - e, -D / 2 - e], [-1, 0])));
  }
  return out;
}
function parkSlots(p) {
  const { sw, sd, n, rows, W, D } = parkLayout(p), res = [];
  const rowZ = rows === 2 ? [-D / 2 + 0.3, D / 2 - 0.3 - sd] : [-D / 2 + 0.3];
  rowZ.forEach((z0, r) => { for (let i = 0; i < n; i++) res.push({ x: -W / 2 + 0.5 + (i + 0.5) * sw, z: z0 + sd / 2, yaw: r === 0 ? 0 : Math.PI }); });
  return res;
}

// ------------------------------------------------------------------ railway
function ferrovia(p) {
  const out = {}, L = p.length, tracks = p.tracks, gap = 4.0;
  const xs = tracks === 2 ? [-gap / 2, gap / 2] : [0];
  for (const x of xs) {
    // ballast bed (trapezoid) along Z
    const path = linePath([x, -L / 2], [x, L / 2], [1, 0], 2);
    (out['c:gravel'] ||= []).push(profileAlong(path, [[-1.9, 0.0], [-1.45, 0.32], [1.45, 0.32], [1.9, 0.0]], 1));
    // sleepers
    const n = Math.floor(L / 0.6);
    for (let i = 0; i < n; i++) {
      const z = -L / 2 + 0.3 + i * 0.6;
      if (p.sleepers === 'legno') (out['c:sleeper'] ||= []).push(box(2.5, 0.15, 0.24, { x, y: 0.36, z, r: 0.01 }));
      else (out['c:concrete'] ||= []).push(box(2.6, 0.17, 0.26, { x, y: 0.37, z, r: 0.02 }));
    }
    // rails (I profile swept along Z)
    for (const s of [-1, 1]) {
      const rx = x + s * 0.7535;
      const prof = [[-0.075, 0.455], [0.075, 0.455], [0.075, 0.465], [0.009, 0.48], [0.009, 0.57], [0.036, 0.585], [0.036, 0.625], [-0.036, 0.625], [-0.036, 0.585], [-0.009, 0.57], [-0.009, 0.48], [-0.075, 0.465]];
      const rpath = linePath([rx, -L / 2], [rx, L / 2], [1, 0], L);
      const rings = rpath.map(({ p: q }) => prof.map(([u, y]) => [q[0] + u, y, q[1]]));
      let g = loft(rings, { closed: true, capStart: true, capEnd: true });
      if (g.attributes.normal.getY(6) < 0) { g.dispose(); g = loft(rings, { closed: true, capStart: true, capEnd: true, flip: true }); }
      (out['c:rail'] ||= []).push(g);
    }
  }
  return out;
}
const railConn = (p) => [{ x: 0, z: p.length / 2, yaw: 0, kind: 'rail' }, { x: 0, z: -p.length / 2, yaw: Math.PI, kind: 'rail' }];

// ------------------------------------------------------------------ sidewalk / square / path / decals
function marciapiede(p) {
  const out = {}, L = p.length;
  if (p.curb) walkSide(linePath([-p.walkW / 2, L / 2], [-p.walkW / 2, -L / 2], [1, 0]).map((q) => ({ p: [q.p[0] - 0.0, q.p[1]], n: q.n })), { ...p }, out);
  else sidewalk(linePath([-p.walkW / 2 - CURB_W, L / 2], [-p.walkW / 2 - CURB_W, -L / 2], [1, 0]), p.walkW + CURB_W, out, p.pave);
  return out;
}
const walkConn = (p) => [{ x: 0, z: p.length / 2, yaw: 0, kind: 'walk' }, { x: 0, z: -p.length / 2, yaw: Math.PI, kind: 'walk' }];

function piazza(p) {
  const out = {}, W = p.width, D = p.depth, h = 0.03;
  const role = PAVE_ROLE[p.pave] || 'c:cobbles';
  (out[role] ||= []).push(polyXZ(rect(0, 0, W, D), h, p.pave === 'porfido' ? TILE.cobbles : TILE.pavers));
  const border = [
    linePath([-W / 2, D / 2], [W / 2, D / 2], [0, -1]), linePath([W / 2, D / 2], [W / 2, -D / 2], [-1, 0]),
    linePath([W / 2, -D / 2], [-W / 2, -D / 2], [0, 1]), linePath([-W / 2, -D / 2], [-W / 2, D / 2], [1, 0]),
  ];
  for (const b of border) (out['c:curb'] ||= []).push(profileAlong(b, [[0, 0], [0, h + 0.004], [0.3, h + 0.004], [0.3, h - 0.01]], 2));
  return out;
}

function vialetto(p) {
  const out = {}, L = p.length, w = p.width, bend = (p.bend * Math.PI) / 180;
  const pts = [];
  const N = 24;
  if (Math.abs(bend) < 1e-3) for (let i = 0; i <= N; i++) pts.push([0, -L / 2 + (L * i) / N]);
  else {
    const R = L / Math.abs(bend), sgn = Math.sign(bend);
    for (let i = 0; i <= N; i++) { const a = (bend * i) / N; pts.push([sgn * R * (1 - Math.cos(a)), R * Math.sin(Math.abs(a))]); }
    const cx = (Math.min(...pts.map((q) => q[0])) + Math.max(...pts.map((q) => q[0]))) / 2, cz = (Math.min(...pts.map((q) => q[1])) + Math.max(...pts.map((q) => q[1]))) / 2;
    for (const q of pts) { q[0] -= cx; q[1] -= cz; }
  }
  const role = p.surface === 'terra' ? 'c:dirt' : p.surface === 'lastre' ? 'c:pavers' : 'c:gravel';
  const g = stripXZ(pts, w, 0.01, { tile: 1 });
  // planar uvs for the tiled texture
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (role === 'c:pavers' ? 1.6 : 1), pos.getZ(i) / (role === 'c:pavers' ? 1.6 : 1));
  (out[role] ||= []).push(g);
  if (p.edging) for (const s of [-1, 1]) {
    const e = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      e.push({ p: [pts[i][0] + tz * s * (w / 2), pts[i][1] - tx * s * (w / 2)], n: [tz * s, -tx * s] });
    }
    (out['c:curb'] ||= []).push(profileAlong(e, [[0, 0], [0, 0.05], [0.06, 0.05], [0.06, 0]], 2));
  }
  return out;
}
function vialConn(p) {
  const L = p.length, bend = (p.bend * Math.PI) / 180;
  if (Math.abs(bend) < 1e-3) return [{ x: 0, z: L / 2, yaw: 0, kind: 'path' }, { x: 0, z: -L / 2, yaw: Math.PI, kind: 'path' }];
  const R = L / Math.abs(bend), sgn = Math.sign(bend);
  const pts = [[0, 0], [sgn * R * (1 - Math.cos(bend)), R * Math.sin(Math.abs(bend))]];
  const all = []; for (let i = 0; i <= 24; i++) { const a = (bend * i) / 24; all.push([sgn * R * (1 - Math.cos(a)), R * Math.sin(Math.abs(a))]); }
  const cx = (Math.min(...all.map((q) => q[0])) + Math.max(...all.map((q) => q[0]))) / 2, cz = (Math.min(...all.map((q) => q[1])) + Math.max(...all.map((q) => q[1]))) / 2;
  return [{ x: pts[0][0] - cx, z: pts[0][1] - cz, yaw: Math.PI, kind: 'path' }, { x: pts[1][0] - cx, z: pts[1][1] - cz, yaw: Math.abs(bend) * sgn, kind: 'path' }];
}

function strisce(p) {
  const out = {};
  zebra(out, 0, 0, 'z', p.width / 2, p.depth, Y_PAINT + 0.002);
  if (p.stop) paintLine([[-p.width / 2 + 0.1, p.depth / 2 + 0.6], [p.width / 2 - 0.1, p.depth / 2 + 0.6]], out, { w: 0.4, y: Y_PAINT + 0.002 });
  return out;
}
function tombino(p) {
  const out = {};
  if (p.kind === 'caditoia') drain(out, 0, 0, 0);
  else { manhole(out, 0, 0, p.kind === 'grande' ? 0.42 : 0.32); }
  return out;
}

// ------------------------------------------------------------------ registry
const SEED = seedParam;
const R = (id, label, params, build, extra = {}) => ({ id, label, cat: 'esterni', sub: 'strade', color: '#9aa0a6', params, build, road: true, noColor: true, ...extra });
export const ROAD_TYPES = [
  R('es_strada', 'Strada dritta', [range('length', 'Lunghezza', 2, 40, 0.5, 12), ...XSEC, CROSS_OFF, DETAILS, SEED(1)], straight,
    { connectors: straightConn, lanes: straightLanes, tags: 'strada rettilineo via asfalto marciapiede' }),
  R('es_curva', 'Curva', [range('radius', 'Raggio', 6, 60, 0.5, 14), range('angle', 'Angolo', 15, 90, 5, 90, '°'), ...XSEC], curve,
    { connectors: curveConn, lanes: curveLanes, tags: 'strada curva tornante' }),
  R('es_incrocio', 'Incrocio', [range('size', 'Dimensione', 14, 40, 0.5, 22), ...XSEC, CROSS, DETAILS, SEED(1)], (p) => junction(p, ['+z', '-z', '+x', '-x']),
    { connectors: (p) => armConn(p.size / 2, ['+z', '-z', '+x', '-x']), lanes: (p) => armLanes(p, p.size / 2, ['+z', '-z', '+x', '-x']), tags: 'incrocio quadrivio semaforo' }),
  R('es_incrocio_t', 'Incrocio a T', [range('size', 'Dimensione', 14, 40, 0.5, 22), ...XSEC, CROSS, DETAILS, SEED(1)], (p) => junction(p, ['+z', '-z', '+x']),
    { connectors: (p) => armConn(p.size / 2, ['+z', '-z', '+x']), lanes: (p) => armLanes(p, p.size / 2, ['+z', '-z', '+x']), tags: 'incrocio a t innesto' }),
  R('es_rotonda', 'Rotonda', [range('island', 'Raggio isola', 2, 15, 0.5, 6), int('ringLanes', 'Corsie anello', 1, 2, 1), range('size', 'Dimensione', 24, 60, 1, 36), ...XSEC, CROSS], rotonda,
    { connectors: roundConn, lanes: roundLanes, tags: 'rotatoria rotonda' }),
  R('es_parcheggio', 'Parcheggio', [int('stalls', 'Posti per fila', 2, 20, 8), int('rows', 'File', 1, 2, 2), seg('lines', 'Strisce', [['bianche', 'Bianche'], ['blu', 'Blu']], 'bianche'), flag('disabled', 'Posto disabili', true), flag('border', 'Cordolo', true)], parcheggio,
    { slots: parkSlots, tags: 'parcheggio posteggio auto' }),
  R('es_ferrovia', 'Ferrovia', [range('length', 'Lunghezza', 2, 60, 0.6, 18), int('tracks', 'Binari', 1, 2, 1), seg('sleepers', 'Traversine', [['cemento', 'Cemento'], ['legno', 'Legno']], 'cemento')], ferrovia,
    { connectors: railConn, tags: 'binari treno rotaie stazione' }),
  R('es_marciapiede', 'Marciapiede', [range('length', 'Lunghezza', 1, 40, 0.5, 10), WALKW, PAVE, flag('curb', 'Cordolo', true)], marciapiede,
    { connectors: walkConn, tags: 'marciapiede cordolo' }),
  R('es_piazza', 'Piazza lastricata', [range('width', 'Larghezza', 3, 40, 0.5, 12), range('depth', 'Profondità', 3, 40, 0.5, 12), seg('pave', 'Pavimentazione', [['porfido', 'Porfido'], ['lastre', 'Lastre']], 'porfido')], piazza,
    { tags: 'piazza pavimento sampietrini lastricato' }),
  R('es_vialetto', 'Vialetto', [range('length', 'Lunghezza', 2, 30, 0.5, 8), range('width', 'Larghezza', 0.8, 5, 0.1, 1.8), range('bend', 'Curvatura', -90, 90, 5, 0, '°'),
    seg('surface', 'Fondo', [['ghiaia', 'Ghiaia'], ['terra', 'Terra'], ['lastre', 'Lastre']], 'ghiaia'), flag('edging', 'Bordo', true)], vialetto,
    { connectors: vialConn, tags: 'sentiero viale parco ghiaia' }),
  R('es_strisce', 'Strisce pedonali', [range('width', 'Larghezza', 3, 16, 0.25, 6.5), range('depth', 'Profondità', 2, 6, 0.25, 3), flag('stop', 'Linea di arresto', false)], strisce,
    { onRoad: true, tags: 'zebre attraversamento pedonale' }),
  R('es_tombino', 'Tombino', [seg('kind', 'Tipo', [['tondo', 'Tondo'], ['grande', 'Grande'], ['caditoia', 'Caditoia']], 'tondo')], tombino,
    { onRoad: true, tags: 'tombino caditoia fogna griglia' }),
];

export { halfW, laneOffsets, cornerR, roundLayout, parkLayout, curveLayout };
