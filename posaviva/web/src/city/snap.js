// Road modules snap to each other by their connectors (ends with an outward
// heading), new pieces attach to a free end, vehicles drop onto the nearest lane
// or parking stall. Works in world X/Z on the props' root placement (yaw + scale).
import * as THREE from 'three';
import { TYPE_BY_ID, defaultParams, cleanParams } from '../props/catalog.js';
import { xsecOf } from './roads.js';

const TAU = Math.PI * 2;
const wrap = (a) => { a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a; };
const _box = new THREE.Box3();

export const isCity = (p) => !!p && p.type?.cat === 'esterni';
export const isRoad = (p) => isCity(p) && !!p.type.connectors;
export const isVehicle = (p) => isCity(p) && !!p.type.vehicle;

/** Local point (x, z) of a prop -> world [x, z]. */
function toWorld(p, x, z) {
  const r = p.root, s = r.scale.x, c = Math.cos(r.rotation.y), sn = Math.sin(r.rotation.y);
  return [r.position.x + (x * c + z * sn) * s, r.position.z + (-x * sn + z * c) * s];
}
/** World connectors of a road prop: [{x, z, yaw, kind, i}]. */
export function worldConnectors(p) {
  if (!isRoad(p)) return [];
  return p.type.connectors(p.params).map((c, i) => { const [x, z] = toWorld(p, c.x, c.z); return { x, z, yaw: wrap(c.yaw + p.root.rotation.y), kind: c.kind || 'road', i }; });
}

/** Connectors of p that are not joined to another road piece. */
export function freeConnectors(p, props) {
  const others = props.filter((q) => q !== p && isRoad(q)).flatMap(worldConnectors);
  return worldConnectors(p).filter((c) => !others.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 0.35));
}

/**
 * Snaps road prop p to the nearest compatible free connector of another road
 * piece (within maxDist meters and maxAngle radians of facing it). Moves and
 * turns p in place. Returns the matched {mine, other} or null.
 */
export function snapRoad(p, props, { maxDist = 1.8, maxAngle = 0.9 } = {}) {
  if (!isRoad(p)) return null;
  const mine = worldConnectors(p);
  let best = null, bestD = maxDist;
  for (const q of props) {
    if (q === p || !isRoad(q) || q.hold) continue;
    for (const o of worldConnectors(q)) for (const m of mine) {
      if (o.kind !== m.kind) continue;
      const d = Math.hypot(o.x - m.x, o.z - m.z);
      const ang = Math.abs(wrap(o.yaw + Math.PI - m.yaw));
      if (d < bestD && ang < maxAngle) { bestD = d; best = { m, o }; }
    }
  }
  if (!best) return null;
  matePlace(p, best.m.i, best.o);
  return best;
}

/** Places p so that its connector index ci sits on world connector o, facing it. */
export function matePlace(p, ci, o) {
  const c = p.type.connectors(p.params)[ci];
  const yaw = wrap(o.yaw + Math.PI - c.yaw);
  p.root.rotation.set(0, yaw, 0, 'YXZ');
  const s = p.root.scale.x, co = Math.cos(yaw), sn = Math.sin(yaw);
  p.root.position.x = o.x - (c.x * co + c.z * sn) * s;
  p.root.position.z = o.z - (-c.x * sn + c.z * co) * s;
  p.root.position.y = 0;
}

/**
 * Adds a new road piece of typeId attached to a free end of `from`.
 * which: index of the new piece's connector that joins (curves: 0 = left turn, 1 = right turn).
 * Returns the new prop or null.
 */
export function attachPiece(manager, from, typeId, { end = null, which = 0, extra = {} } = {}) {
  const type = TYPE_BY_ID.get(typeId);
  if (!type || !isRoad(from)) return null;
  const free = freeConnectors(from, manager.props);
  const pickEnd = end != null ? worldConnectors(from)[end] : free[0];
  if (!pickEnd) return null;
  // same cross-section; crossings off on straight extensions
  const params = cleanParams(type, { ...defaultParams(type), ...(type.params.some((d) => d.id === 'lanes') ? xsecOf(from.params) : {}), ...extra });
  const p = manager.create({ type: typeId, params, color: type.color });
  p.root.scale.setScalar(from.scale);
  p.scale = from.scale;
  const n = type.connectors(p.params).length;
  matePlace(p, Math.min(which, n - 1), pickEnd);
  return p;
}

// ------------------------------------------------------------------ vehicles on roads
/** All lanes of the road props in world coordinates: [{pts: [[x, z]...], loop}]. */
function worldLanes(props) {
  const out = [];
  for (const q of props) {
    if (!isCity(q) || q.hold) continue;
    if (q.type.lanes) for (const l of q.type.lanes(q.params)) out.push({ pts: l.pts.map(([x, z]) => toWorld(q, x, z)), loop: l.loop, prop: q });
  }
  return out;
}
function worldSlots(props) {
  const out = [];
  for (const q of props) if (isCity(q) && q.type.slots) for (const s of q.type.slots(q.params)) { const [x, z] = toWorld(q, s.x, s.z); out.push({ x, z, yaw: wrap(s.yaw + q.root.rotation.y), prop: q }); }
  return out;
}

/** Footprint overlap test against the other vehicles (circle approximation). */
function blocked(p, x, z, props) {
  const r = p.footprintRadius() * 0.8;
  for (const q of props) {
    if (q === p || !isVehicle(q)) continue;
    const d = Math.hypot(q.root.position.x - x, q.root.position.z - z);
    if (d < r + q.footprintRadius() * 0.8) return true;
  }
  return false;
}

/**
 * Puts a vehicle on the nearest lane (or free parking stall) to the world point
 * (tx, tz), aligned with the traffic direction, avoiding other vehicles.
 * Returns true if a road was found.
 */
export function placeOnRoad(manager, p, tx, tz, { preferSlots = false } = {}) {
  const props = manager.props;
  const lanes = worldLanes(props), slots = worldSlots(props);
  let best = null, bestD = Infinity;
  const cand = (x, z, yaw, kind) => { const d = Math.hypot(x - tx, z - tz) + (kind === 'slot' && !preferSlots ? 2 : 0); if (d < bestD && !blocked(p, x, z, props)) { bestD = d; best = { x, z, yaw }; } };
  for (const s of slots) cand(s.x, s.z, s.yaw, 'slot');
  const step = 0.75;
  for (const l of lanes) {
    const pts = l.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-3) continue;
      const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s <= L; s += step) { const t = s / L; cand(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, yaw, 'lane'); }
    }
  }
  if (!best) return false;
  // keep the vehicle fully on its lane: back off from the lane ends is good enough with the step
  p.root.position.set(best.x, 0, best.z);
  p.root.rotation.set(0, best.yaw, 0, 'YXZ');
  return true;
}

/** True if there is at least one road (lanes or stalls) in the scene. */
export function hasRoads(props) { return props.some((q) => isCity(q) && (q.type.lanes || q.type.slots)); }

export { wrap, _box };
