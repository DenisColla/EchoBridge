// Spatial solver of the voice commands: turns relations ("a sinistra del
// tavolo", "sul letto", "nell'angolo", "seduto sul divano") into positions and
// orientations using the real bounds of props, characters and animals, keeps
// things on the floor (or on the surface they stand on), avoids overlaps and
// keeps new things inside the room when there is one.
//
// Conventions (ARCHITECTURE.md): meters, Y up, everything faces +Z in its own
// frame. LEFT / RIGHT are the viewer's (screen) left / right: what a comic
// artist means looking at the panel. FRONT / BEHIND follow the target's own
// front (a sofa's front is where one sits; a character's front is its face).
import * as THREE from 'three';
import { characterBounds } from '../scene/bounds.js';

const _box = new THREE.Box3(), _box2 = new THREE.Box3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);

/** Flat / ground-like props never block a spot (rugs, floors, roads, lawns). */
export function isFlat(p) {
  const b = p.localBox;
  if (b.isEmpty()) return false;
  const t = p.type || {};
  if (t.id === 'stanza' || t.id === 'pavimento' || /^tappeto/.test(t.id)) return true;
  if (t.cat === 'esterni' && (t.road || /prato|collina|laghetto|duna|vialetto|piazza|strisce|tombino|marciapiede/.test(t.id))) return true;
  return (b.max.y - b.min.y) * p.scale < 0.06;
}

// ------------------------------------------------------------------ entity views
/** Uniform view of a scene thing: {kind: 'character'|'animal'|'prop', obj}. */
export const E = (kind, obj) => ({ kind, obj });
export const rootOf = (e) => e.obj.root;
export function yawOf(e) { return e.obj.root.rotation.y; }

/** World AABB (characters: skeleton bounds, animals: posed body, props: oriented local box). */
export function boxOf(e, box = new THREE.Box3()) {
  if (e.kind === 'character') return characterBounds(e.obj, box, 0.1);
  if (e.kind === 'animal') return e.obj.worldBox(box);
  return e.obj.worldBox(box);
}

/**
 * Footprint as an oriented rectangle {cx, cz, hx, hz, yaw} (x/z half extents in
 * the thing's own frame). Characters and animals use their AABB (yaw 0).
 */
export function footprintOf(e) {
  if (e.kind === 'prop') {
    const p = e.obj, b = p.localBox, s = p.scale, yaw = p.root.rotation.y;
    if (b.isEmpty()) return { cx: p.root.position.x, cz: p.root.position.z, hx: 0.15, hz: 0.15, yaw };
    const lcx = ((b.min.x + b.max.x) / 2) * s, lcz = ((b.min.z + b.max.z) / 2) * s;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    return { cx: p.root.position.x + lcx * c + lcz * sn, cz: p.root.position.z - lcx * sn + lcz * c, hx: ((b.max.x - b.min.x) / 2) * s, hz: ((b.max.z - b.min.z) / 2) * s, yaw };
  }
  boxOf(e, _box);
  if (e.kind === 'character') {
    // the floor footprint of a standing body is narrower than its arms' span
    const p = e.obj.root.position;
    const hx = Math.min(0.32, (_box.max.x - _box.min.x) / 2), hz = Math.min(0.32, (_box.max.z - _box.min.z) / 2);
    return { cx: (_box.min.x + _box.max.x) / 2 * 0.5 + p.x * 0.5, cz: (_box.min.z + _box.max.z) / 2 * 0.5 + p.z * 0.5, hx: Math.max(0.18, hx), hz: Math.max(0.18, hz), yaw: 0 };
  }
  return { cx: (_box.min.x + _box.max.x) / 2, cz: (_box.min.z + _box.max.z) / 2, hx: (_box.max.x - _box.min.x) / 2, hz: (_box.max.z - _box.min.z) / 2, yaw: 0 };
}

/** Half extent of an oriented footprint along a world horizontal unit direction. */
export function extentAlong(fp, dx, dz) {
  const c = Math.cos(fp.yaw), s = Math.sin(fp.yaw);
  // local axes in world: X = (c, -s), Z = (s, c)
  return Math.abs(dx * c - dz * s) * fp.hx + Math.abs(dx * s + dz * c) * fp.hz;
}

/** Separating axis test of two oriented rectangles (with a margin). */
export function overlap(A, B, margin = 0) {
  const axes = [[Math.cos(A.yaw), -Math.sin(A.yaw)], [Math.sin(A.yaw), Math.cos(A.yaw)], [Math.cos(B.yaw), -Math.sin(B.yaw)], [Math.sin(B.yaw), Math.cos(B.yaw)]];
  const dx = B.cx - A.cx, dz = B.cz - A.cz;
  for (const [ax, az] of axes) {
    const d = Math.abs(dx * ax + dz * az);
    if (d >= extentAlong(A, ax, az) + extentAlong(B, ax, az) + margin) return false;
  }
  return true;
}

// ------------------------------------------------------------------ view directions
/** Viewer's right on the ground (unit), toward the camera (unit). */
export function viewAxes(app) {
  const right = _v.set(1, 0, 0).applyQuaternion(app.camera.quaternion).setY(0);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
  const toCam = _v2.set(-right.z, 0, right.x); // perpendicular, pointing to the viewer
  const c = app.camera.position, t = app.controls.target;
  if ((c.x - t.x) * toCam.x + (c.z - t.z) * toCam.z < 0) toCam.multiplyScalar(-1);
  return { rx: right.x, rz: right.z, fx: toCam.x, fz: toCam.z };
}

/** Yaw that makes a thing at (x, z) face the point (tx, tz). */
export const yawToward = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
/** Yaw facing the camera from (x, z), snapped to 15 degrees. */
export function yawToCamera(app, x, z, snap = true) {
  const y = Math.atan2(app.camera.position.x - x, app.camera.position.z - z);
  return snap ? Math.round(y / (Math.PI / 12)) * (Math.PI / 12) : y;
}

// ------------------------------------------------------------------ obstacles
/**
 * Collects the footprints that block new things: free props (not flat, not held),
 * characters and animals, except `ignore` (Set of objects).
 */
export function obstacles(app, ignore = new Set()) {
  const out = [];
  for (const p of app.props?.props || []) {
    if (ignore.has(p) || p.hold || !p.root.visible || isFlat(p)) continue;
    const fp = footprintOf(E('prop', p));
    // big or hollow shapes (L kitchens, desk rows, sofas with a chaise): real occupied cells
    if (fp.hx * fp.hz * 4 > 1.6) { for (const c of occupancy(p, fp)) out.push({ fp: c, obj: p }); continue; }
    out.push({ fp, obj: p, h: p.worldBox(_box).max.y });
  }
  for (const ch of app.characters) if (!ignore.has(ch) && ch.root.visible) out.push({ fp: footprintOf(E('character', ch)), obj: ch });
  for (const a of app.animals?.animals || []) if (!ignore.has(a) && a.root.visible) out.push({ fp: footprintOf(E('animal', a)), obj: a });
  return out;
}

/**
 * Occupied floor cells of a large prop (rays from above on a 0.2 m grid in its own
 * frame), merged into runs: oriented rectangles. Cached until the prop moves / changes.
 */
const _occ = new WeakMap();
export function occupancy(p, fp) {
  const key = [p.root.position.x, p.root.position.z, p.root.rotation.y, p.scale, JSON.stringify(p.params), p.meshes.length].map((v) => (typeof v === 'number' ? v.toFixed(3) : v)).join('|');
  const c0 = _occ.get(p);
  if (c0 && c0.key === key) return c0.cells;
  p.root.updateWorldMatrix(true, true);
  const cell = 0.2, nx = Math.max(1, Math.ceil((fp.hx * 2) / cell)), nz = Math.max(1, Math.ceil((fp.hz * 2) / cell));
  const c = Math.cos(fp.yaw), sn = Math.sin(fp.yaw), y0 = p.root.position.y;
  const top = p.worldBox(_box).max.y + 0.2;
  const occ = [];
  for (let k = 0; k < nz; k++) {
    let run = -1;
    for (let i = 0; i <= nx; i++) {
      let hit = false;
      if (i < nx) {
        const lx = -fp.hx + (i + 0.5) * (fp.hx * 2 / nx), lz = -fp.hz + (k + 0.5) * (fp.hz * 2 / nz);
        const x = fp.cx + lx * c + lz * sn, z = fp.cz - lx * sn + lz * c;
        const y = hitY(p, x, z, top);
        hit = y !== null && y - y0 > 0.05;
      }
      if (hit && run < 0) run = i;
      if (!hit && run >= 0) {
        // run [run, i) on row k -> rectangle in the prop frame
        const lx0 = -fp.hx + run * (fp.hx * 2 / nx), lx1 = -fp.hx + i * (fp.hx * 2 / nx);
        const lzc = -fp.hz + (k + 0.5) * (fp.hz * 2 / nz), lxc = (lx0 + lx1) / 2;
        occ.push({ cx: fp.cx + lxc * c + lzc * sn, cz: fp.cz - lxc * sn + lzc * c, hx: (lx1 - lx0) / 2, hz: fp.hz / nz, yaw: fp.yaw });
        run = -1;
      }
    }
  }
  const cells = occ.length ? occ : [fp];
  _occ.set(p, { key, cells });
  return cells;
}

/**
 * Props that go with p when it moves: things standing on it (cups, a centerpiece),
 * lamps hanging right above it and chairs around it facing it.
 */
export function dependentsOf(app, p) {
  const out = [];
  const fp = footprintOf(E('prop', p));
  const top = p.worldBox(_box).max.y;
  const inside = (x, z, m) => { const dx = x - fp.cx, dz = z - fp.cz, c = Math.cos(fp.yaw), s = Math.sin(fp.yaw); const lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) <= fp.hx + m && Math.abs(lz) <= fp.hz + m; };
  for (const q of app.props?.props || []) {
    if (q === p || q.hold || !q.root.visible || isFlat(q)) continue;
    const qp = q.root.position;
    const qb = q.worldBox(_box2);
    // on top / hanging above
    if (inside(qp.x, qp.z, 0) && (Math.abs(qb.min.y - top) < 0.12 || (qb.min.y > top + 0.3 && /sospensione|lampadario|chandelier|plafon/.test(q.type.id)))) { out.push(q); continue; }
    // chairs around, facing it
    if (/sedi|sgabell|chair|stool|poltron/.test(q.type.id) && inside(qp.x, qp.z, 0.75)) {
      const want = Math.atan2(fp.cx - qp.x, fp.cz - qp.z);
      let d = Math.abs(((want - q.root.rotation.y) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (d < 0.7) out.push(q);
    }
  }
  return out;
}

// ------------------------------------------------------------------ rooms
/** The room ('stanza' prop) containing (x, z), else the most recent one. {prop, W, D, yaw, cx, cz} | null */
export function roomAt(app, x = null, z = null) {
  const rooms = (app.props?.props || []).filter((p) => p.type?.id === 'stanza' && p.root.visible);
  if (!rooms.length) return null;
  const info = (p) => ({ prop: p, W: p.params.width * p.scale, D: p.params.depth * p.scale, yaw: p.root.rotation.y, cx: p.root.position.x, cz: p.root.position.z, params: p.params });
  if (x !== null) for (const p of rooms.slice().reverse()) { const r = info(p); const l = toRoom(r, x, z); if (Math.abs(l.x) <= r.W / 2 && Math.abs(l.z) <= r.D / 2) return r; }
  return info(rooms[rooms.length - 1]);
}
/** World -> room-local (x right, z toward the open front). */
export function toRoom(r, x, z) {
  const dx = x - r.cx, dz = z - r.cz, c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
export function fromRoom(r, lx, lz) {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return { x: r.cx + lx * c + lz * s, z: r.cz - lx * s + lz * c };
}
/** Keeps a footprint (centered at x, z) inside the room interior (with a margin). */
export function clampToRoom(r, x, z, fp, margin = 0.06) {
  const l = toRoom(r, x, z);
  const ex = extentAlong({ ...fp, yaw: fp.yaw - r.yaw }, 1, 0), ez = extentAlong({ ...fp, yaw: fp.yaw - r.yaw }, 0, 1);
  const T = 0.0; // the walls are outside width / depth
  l.x = Math.max(-r.W / 2 + ex + margin + T, Math.min(r.W / 2 - ex - margin - T, l.x));
  l.z = Math.max(-r.D / 2 + ez + margin + T, Math.min(r.D / 2 - ez - margin - T, l.z));
  return fromRoom(r, l.x, l.z);
}
/** World position of the room's window / door (null if none). */
export function roomOpening(r, which = 'window') {
  const side = r.params?.[which];
  if (!side || side === 'nessuna') return null;
  const y = which === 'window' ? 1.45 : 1.0;
  const sameWall = r.params.door === r.params.window;
  let lx = 0, lz = 0;
  if (side === 'fondo') { lz = -r.D / 2; lx = which === 'door' ? r.W * 0.25 : sameWall ? -r.W * 0.2 : 0; }
  else if (side === 'sinistra') { lx = -r.W / 2; lz = which === 'door' ? r.D * 0.25 : sameWall ? r.D * 0.2 : 0; }
  else if (side === 'destra') { lx = r.W / 2; lz = which === 'door' ? -r.D * 0.25 : sameWall ? r.D * 0.2 : 0; }
  else if (side === 'davanti') { lz = r.D / 2; }
  const w = fromRoom(r, lx, lz);
  return new THREE.Vector3(w.x, y, w.z);
}

// ------------------------------------------------------------------ surfaces
/** Downward ray hits on a prop's meshes at world (x, z): highest hit y or null. */
function hitY(p, x, z, fromY) {
  _ray.set(_v.set(x, fromY, z), _down);
  _ray.far = fromY + 5;
  const hits = _ray.intersectObjects(p.meshes, false);
  return hits.length ? hits[0].point.y : null;
}

/**
 * Seat of a sofa / chair / bench / stool / bed: {y (world seat height), yaw (facing),
 * slots: [{x, z}] world points where hips go, width}. null if the prop has no seat-like
 * surface (0.2 .. 0.95 m).
 */
export function seatOf(p, { bed = false } = {}) {
  p.root.updateWorldMatrix(true, true);
  const b = p.localBox, s = p.scale;
  if (b.isEmpty()) return null;
  const yaw = p.root.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw);
  const ox = p.root.position.x, oz = p.root.position.z, oy = p.root.position.y;
  const top = p.worldBox(_box).max.y + 0.3;
  const W = (b.max.x - b.min.x) * s, D = (b.max.z - b.min.z) * s;
  const x0 = b.min.x * s, z0 = b.min.z * s;
  const nx = Math.max(1, Math.min(9, Math.round(W / 0.18))), nz = Math.max(4, Math.min(14, Math.round(D / 0.05)));
  const world = (lx, lz) => ({ x: ox + lx * c + lz * sn, z: oz - lx * sn + lz * c });
  // height samples on a grid (local x across, z from back to front)
  const H = [];
  for (let i = 0; i < nx; i++) {
    const lx = x0 + ((i + 0.5) / nx) * W;
    const col = [];
    for (let k = 0; k < nz; k++) { const lz = z0 + ((k + 0.5) / nz) * D; const w = world(lx, lz); const y = hitY(p, w.x, w.z, top); col.push(y === null ? null : y - oy); }
    H.push({ lx, col });
  }
  // seat height: median of the plausible heights in the front 60% of the depth
  const vals = [];
  for (const { col } of H) for (let k = Math.floor(nz * 0.4); k < nz; k++) { const y = col[k]; if (y !== null && y > 0.18 && y < 0.98) vals.push(y); }
  if (!vals.length) return null;
  vals.sort((a, q) => a - q);
  const seatH = vals[Math.floor(vals.length * 0.5)];
  // per column: the seat strip from the front back to the backrest
  const slotsLocal = [];
  let backZ = null;
  for (const { lx, col } of H) {
    let kb = null;
    for (let k = nz - 1; k >= 0; k--) {
      const y = col[k];
      if (y === null) continue;
      if (y > seatH + 0.12) break; // backrest / armrest
      if (Math.abs(y - seatH) < 0.09) kb = k;
    }
    if (kb === null) continue;
    const lzBack = z0 + (kb / nz) * D;
    backZ = backZ === null ? lzBack : Math.min(backZ, lzBack);
    slotsLocal.push({ lx, lzBack });
  }
  if (!slotsLocal.length) return null;
  // seats along the width every ~0.6 m (1 for chairs and stools)
  const xs = slotsLocal.map((q) => q.lx);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), span = xmax - xmin;
  const n = Math.max(1, Math.floor((span + 0.2) / 0.58));
  const slots = [];
  for (let i = 0; i < n; i++) {
    const lx = n === 1 ? (xmin + xmax) / 2 : xmin + 0.12 + (i * (span - 0.24)) / (n - 1);
    const near = slotsLocal.reduce((a, q) => (Math.abs(q.lx - lx) < Math.abs(a.lx - lx) ? q : a));
    // hips ~13 cm in front of the backrest (or the seat middle when there is none);
    // on a bed: on the edge at its foot, feet on the floor
    const front = z0 + D;
    const depth = front - near.lzBack;
    const lz = bed ? front - 0.2 : depth > 0.32 ? near.lzBack + 0.15 : near.lzBack + depth * 0.45;
    slots.push({ ...world(lx, lz), lx, lz });
  }
  return { y: oy + seatH, h: seatH, yaw, slots, width: span, depth: (z0 + D) - (backZ ?? z0) };
}

/**
 * Top surface of a prop where something can stand / lie: {y, x, z, hx, hz}
 * (center and half sizes of the flat central region, world). Beds: the mattress
 * (pillows at the head are skipped).
 */
export function topOf(p, { bed = false } = {}) {
  p.root.updateWorldMatrix(true, true);
  const b = p.localBox, s = p.scale;
  if (b.isEmpty()) return null;
  const yaw = p.root.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw);
  const ox = p.root.position.x, oz = p.root.position.z;
  const top = p.worldBox(_box).max.y + 0.3;
  const W = (b.max.x - b.min.x) * s, D = (b.max.z - b.min.z) * s, x0 = b.min.x * s, z0 = b.min.z * s;
  const ys = [];
  const zA = bed ? 0.35 : 0.2, zB = bed ? 0.92 : 0.8;
  for (let i = 1; i < 6; i++) for (let k = 1; k < 6; k++) {
    const lx = x0 + W * (0.2 + 0.6 * (i / 6)), lz = z0 + D * (zA + (zB - zA) * (k / 6));
    const y = hitY(p, ox + lx * c + lz * sn, oz - lx * sn + lz * c, top);
    if (y !== null) ys.push({ y, lx, lz });
  }
  if (!ys.length) return null;
  ys.sort((a, q) => a.y - q.y);
  const med = ys[Math.floor(ys.length / 2)].y;
  const flat = ys.filter((q) => Math.abs(q.y - med) < 0.06);
  const lxs = flat.map((q) => q.lx), lzs = flat.map((q) => q.lz);
  const lcx = (Math.min(...lxs) + Math.max(...lxs)) / 2, lcz = (Math.min(...lzs) + Math.max(...lzs)) / 2;
  return { y: med, x: ox + lcx * c + lcz * sn, z: oz - lcx * sn + lcz * c, hx: Math.max(0.1, (Math.max(...lxs) - Math.min(...lxs)) / 2 + W * 0.06), hz: Math.max(0.1, (Math.max(...lzs) - Math.min(...lzs)) / 2 + D * 0.06), yaw, lcx, lcz };
}

// ------------------------------------------------------------------ free spot search
/** True if footprint fp centered at (x, z) overlaps none of the obstacles. */
export function isFreeAt(obs, fp, x, z, extra = []) {
  const A = { ...fp, cx: x, cz: z };
  for (const o of obs) if (overlap(A, o.fp, 0.04)) return false;
  for (const f of extra) if (overlap(A, f, 0.04)) return false;
  return true;
}

/**
 * Nearest free spot to (x, z) for a footprint `fp` (centered there): tries the
 * spot, then steps along (dx, dz) (the relation's direction), then a spiral.
 * opts: {ignore: Set, room, avoid: extra footprints, step}
 */
export function findFree(app, x, z, fp, opts = {}) {
  const obs = opts.obstacles || obstacles(app, opts.ignore || new Set());
  const extra = opts.avoid || [];
  const room = opts.room || null;
  const test = (px, pz) => {
    const A = { ...fp, cx: px, cz: pz };
    for (const o of obs) if (overlap(A, o.fp, 0.04)) return false;
    for (const f of extra) if (overlap(A, f, 0.04)) return false;
    return true;
  };
  const clamp = (px, pz) => (room ? clampToRoom(room, px, pz, fp) : { x: px, z: pz });
  let p = clamp(x, z);
  if (test(p.x, p.z)) return { ...p, free: true };
  const step = opts.step || 0.25;
  if (opts.dx !== undefined) {
    for (let k = 1; k <= 10; k++) { p = clamp(x + opts.dx * step * k, z + opts.dz * step * k); if (test(p.x, p.z)) return { ...p, free: true }; }
  }
  for (let ring = 1; ring <= 10; ring++) {
    const r = ring * step, n = 8 + ring * 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      p = clamp(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (test(p.x, p.z)) return { ...p, free: true };
    }
  }
  return { ...clamp(x, z), free: false };
}
