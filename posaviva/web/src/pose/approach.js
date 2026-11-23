// "Walk-free" placement (app.posing.approach): a free spot on the ground near a point,
// where a standing character fits without entering props, room walls or other people.
import * as THREE from 'three';

const FOOT_R = 0.2; // footprint radius of a standing character (m, scaled)
const _box = new THREE.Box3();
const _rc = new THREE.Raycaster();
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
const DIRS = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(Math.cos((i * Math.PI) / 4), 0, Math.sin((i * Math.PI) / 4)));

/**
 * Spot (Vector3 on the ground: landscape terrain, exterior pieces) for `ch` near `P`:
 * rings of growing distance around P, starting from the direction of the character (the
 * shortest "walk"), 15° steps. opts.distance forces the ring. Returns null only when P
 * is not finite.
 */
export function approachSpot(ctx, ch, P, { distance = null } = {}) {
  if (!P || !Number.isFinite(P.x) || !Number.isFinite(P.z)) return null;
  const app = ctx.app;
  const s = ch.root.scale.y || 1;
  const r = FOOT_R * s;
  const cur = ch.root.position;
  const a0 = Math.hypot(cur.x - P.x, cur.z - P.z) > 1e-3 ? Math.atan2(cur.x - P.x, cur.z - P.z) : 0;
  // obstacles: prop boxes (rooms / enclosures around P: their walls, by rays), people
  const boxes = [], walls = [], people = [];
  for (const p of app.props?.props || []) {
    if (p.hold || !p.root.visible) continue;
    p.worldBox(_box);
    if (_box.isEmpty() || _box.max.y - _box.min.y < 0.06) continue;
    const area = (_box.max.x - _box.min.x) * (_box.max.z - _box.min.z);
    const around = P.x > _box.min.x && P.x < _box.max.x && P.z > _box.min.z && P.z < _box.max.z;
    if (p.type?.id === 'stanza' || (around && area > 6)) { walls.push(...(p.meshes || [])); continue; }
    boxes.push(_box.clone());
  }
  for (const c of app.characters) {
    if (c === ch || !c.root.visible) continue;
    const q = ctx.rig.worldPos(c, 0, new THREE.Vector3());
    people.push({ x: q.x, z: q.z, r: r + FOOT_R * (c.root.scale.y || 1) });
  }
  const free = (x, z, y) => {
    for (const b of boxes) {
      if (b.max.y < y + 0.12 || b.min.y > y + 1.7 * s) continue; // under the feet / above the head
      if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return false;
    }
    for (const q of people) if (Math.hypot(q.x - x, q.z - z) < q.r) return false;
    if (walls.length) {
      const yy = y + 0.9 * s;
      _rc.far = r;
      for (const dir of DIRS) { _rc.set(_o.set(x, yy, z), dir); if (_rc.intersectObjects(walls, false).length) { _rc.far = Infinity; return false; } }
      // no wall between the spot and the point
      _d.set(P.x - x, 0, P.z - z);
      const L = _d.length();
      if (L > 1e-3) {
        _rc.far = L;
        _rc.set(_o.set(x, yy, z), _d.normalize());
        if (_rc.intersectObjects(walls, false).length) { _rc.far = Infinity; return false; }
      }
      _rc.far = Infinity;
    }
    return true;
  };
  const rings = distance ? [distance] : [0.42, 0.52, 0.65, 0.8, 1.0, 1.25, 1.6, 2.0, 2.6, 3.4].map((v) => v * s);
  for (const d of rings) {
    for (let k = 0; k < 24; k++) {
      const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
      const x = P.x + Math.sin(a) * d, z = P.z + Math.cos(a) * d;
      const y = ctx.groundAt(x, z);
      if (free(x, z, y)) return new THREE.Vector3(x, y, z);
    }
  }
  const d = rings[0];
  const x = P.x + Math.sin(a0) * d, z = P.z + Math.cos(a0) * d;
  return new THREE.Vector3(x, ctx.groundAt(x, z), z);
}
