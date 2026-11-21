// Small procedural geometry toolkit for props. Every helper returns a
// BufferGeometry already placed in prop space (meters, Y up). Parts that share a
// material role are merged into one geometry by `mergeParts` (one draw call per
// role). Bevels are cheap: rounded boxes / lathe profiles with tiny radii catch
// a highlight on every edge, which reads much better than razor-sharp boxes.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const DEG = Math.PI / 180;

/**
 * Applies a placement to a geometry. t: {x,y,z, rx,ry,rz (degrees, XYZ order)}.
 * Rotation happens around the geometry's own origin, then translation.
 */
export function place(geo, t = {}) {
  const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = t;
  if (rx || ry || rz) {
    _q.setFromEuler(_e.set(rx * DEG, ry * DEG, rz * DEG));
    geo.applyMatrix4(_m.compose(_p.set(0, 0, 0), _q, _s));
  }
  if (x || y || z) geo.translate(x, y, z);
  return geo;
}

/** Box w × h × d centered at (x, y, z) with rounded edges of radius r. */
export function box(w, h, d, t = {}) {
  const r = Math.max(0, Math.min(t.r ?? 0.006, Math.min(w, h, d) * 0.5 - 1e-4));
  const geo = r > 1e-4 ? new RoundedBoxGeometry(w, h, d, t.seg ?? 2, r) : new THREE.BoxGeometry(w, h, d);
  return place(geo, t);
}

/** Box resting on y = y0 (bottom face), centered in x/z. */
export function boxOn(w, h, d, t = {}) {
  return box(w, h, d, { ...t, y: (t.y ?? 0) + h / 2 });
}

/**
 * Cylinder (or frustum) standing on y = 0 .. h with bevelled rims, as a lathe.
 * rBottom/rTop radii, bevel radius, radial segments. Placed with t.
 */
export function cylinder(rBottom, rTop, h, t = {}) {
  const b = Math.max(0, Math.min(t.bevel ?? 0.004, rBottom * 0.45, rTop * 0.45, h * 0.45));
  const pts = [];
  const arc = (cx, cy, r, a0, a1, n = 4) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); } };
  pts.push(new THREE.Vector2(0, 0));
  if (b > 0) {
    arc(rBottom - b, b, b, -Math.PI / 2, 0);
    arc(rTop - b, h - b, b, 0, Math.PI / 2);
  } else {
    pts.push(new THREE.Vector2(rBottom, 0), new THREE.Vector2(rTop, h));
  }
  pts.push(new THREE.Vector2(0, h));
  const geo = new THREE.LatheGeometry(pts, t.seg ?? 28);
  return place(geo, t);
}

/** Lathe of an arbitrary (x = radius, y = height) profile. */
export function lathe(profile, t = {}) {
  const geo = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(Math.max(0, x), y)), t.seg ?? 32);
  return place(geo, t);
}

/** Rod of radius r between two points (simple cylinder, capped). */
export function rod(a, b, r, t = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const geo = new THREE.CylinderGeometry(t.r2 ?? r, r, len, t.seg ?? 14, 1, false);
  // CylinderGeometry is along Y, centered: orient Y -> (B - A)
  const dir = B.clone().sub(A).normalize();
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  geo.applyMatrix4(_m.compose(A.clone().add(B).multiplyScalar(0.5), _q, _s));
  return geo;
}

export function sphere(r, t = {}) {
  return place(new THREE.SphereGeometry(r, t.ws ?? 32, t.hs ?? 20), t);
}

/** Torus (ring) lying in the XY plane by default; arc in radians. */
export function torus(R, r, t = {}) {
  return place(new THREE.TorusGeometry(R, r, t.rs ?? 10, t.ts ?? 40, t.arc ?? Math.PI * 2), t);
}

/** Tube along a smooth curve through points [[x,y,z], ...]. */
export function tube(points, r, t = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  return place(new THREE.TubeGeometry(curve, t.segs ?? 32, r, t.rs ?? 10, false), t);
}

/**
 * Rounded rectangle extruded along Z (thickness d), centered. Used for flat
 * objects with soft corners (phone, book covers, shield straps).
 */
export function roundedSlab(w, h, d, radius, t = {}) {
  const r = Math.min(radius, w / 2 - 1e-4, h / 2 - 1e-4);
  const s = new THREE.Shape();
  const x0 = -w / 2, y0 = -h / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r); s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h); s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  const bev = Math.min(t.bevel ?? 0.002, d * 0.3);
  const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-4, d - 2 * bev), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 6 });
  geo.translate(0, 0, -(d - 2 * bev) / 2);
  return place(geo, t);
}

/**
 * Tapered blade with a diamond cross-section along +Y (from y0 to y0 + len).
 * width/thick at the base, `tipStart` = fraction of the length where the point begins.
 */
export function blade(len, width, thick, t = {}) {
  const y0 = t.y0 ?? 0, tipStart = t.tipStart ?? 0.82, taper = t.taper ?? 0.72;
  const stations = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const f = (i / N) * tipStart;
    stations.push([f, 1 - (1 - taper) * (f / tipStart)]);
  }
  stations.push([1, 0]);
  const pos = [];
  const ring = (f, s) => {
    const y = y0 + f * len, hw = (width / 2) * s, ht = (thick / 2) * Math.max(s, f >= 1 ? 0 : 0.35);
    return [[hw, y, 0], [0, y, ht], [-hw, y, 0], [0, y, -ht]].map(([x, yy, z]) => [z, yy, x]); // edges along Z, flats facing ±X
  };
  for (let i = 0; i < stations.length - 1; i++) {
    const A = ring(...stations[i]), B = ring(...stations[i + 1]);
    for (let k = 0; k < 4; k++) {
      const a0 = A[k], a1 = A[(k + 1) % 4], b0 = B[k], b1 = B[(k + 1) % 4];
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
    }
  }
  // base cap
  const A = ring(...stations[0]);
  pos.push(...A[0], ...A[1], ...A[2], ...A[0], ...A[2], ...A[3]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fixWinding(geo);
  geo.computeVertexNormals(); // non-indexed -> crisp facets
  const uv = new Float32Array((pos.length / 3) * 2);
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return place(geo, t);
}

/** Flip triangles of a closed, roughly convex non-indexed mesh so they face away from its center. */
function fixWinding(geo) {
  const p = geo.attributes.position.array;
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    a.fromArray(p, i); b.fromArray(p, i + 3); d.fromArray(p, i + 6);
    n.subVectors(b, a).cross(m.subVectors(d, a));
    m.copy(a).add(b).add(d).multiplyScalar(1 / 3).sub(c);
    // compare with the direction from the center (x/z only for elongated blades)
    m.y = 0;
    if (n.dot(m) < 0) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
  }
}

/** Keeps only position/normal/uv so heterogeneous helpers can be merged. */
function normalizeAttributes(geo) {
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  geo.morphAttributes = {};
  geo.clearGroups();
  return geo;
}

/** Merges geometries into one (disposes the inputs). */
export function mergeParts(list) {
  const geos = list.filter(Boolean).map(normalizeAttributes);
  if (!geos.length) return null;
  const anyNonIndexed = geos.some((g) => !g.index);
  const ready = anyNonIndexed ? geos.map((g) => (g.index ? g.toNonIndexed() : g)) : geos;
  const merged = ready.length === 1 ? ready[0] : mergeGeometries(ready, false);
  for (const g of new Set([...geos, ...ready])) if (g !== merged) g.dispose();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

export { DEG };
