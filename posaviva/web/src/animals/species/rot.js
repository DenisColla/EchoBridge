// Small rotation helpers for the species builders (build time, no three.js).
import { quatToEuler } from '../poses.js';
import { V } from './builder.js';

export const D2R = Math.PI / 180;

/** In-plane direction (horizontal plane) of angle deg: Ry(deg)·x = (cos, 0, -sin). */
export const dirY = (deg) => [Math.cos(deg * D2R), 0, -Math.sin(deg * D2R)];

/** Wraps an angle to (-180, 180]. */
export const wrap = (a) => { while (a > 180) a -= 360; while (a <= -180) a += 360; return a; };

/** Rodrigues rotation of v about the unit axis k by deg. */
export function rotAxis(v, k, deg) {
  const a = deg * D2R, c = Math.cos(a), s = Math.sin(a);
  const kv = V.cross(k, v), kd = V.dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
}

/** Quaternion [x,y,z,w] of a rotation matrix given by its columns (images of x, y, z). */
export function quatFromCols(cx, cy, cz) {
  const m00 = cx[0], m10 = cx[1], m20 = cx[2], m01 = cy[0], m11 = cy[1], m21 = cy[2], m02 = cz[0], m12 = cz[1], m22 = cz[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  return [x, y, z, w];
}

/**
 * Rotation (Euler XYZ degrees) taking the orthonormal frame (a, b, a×b) onto
 * (a2, b2', a2×b2') where b2' is b2 made orthogonal to a2.
 */
export function eulerMapping(a, b, a2, b2) {
  a = V.norm(a); b = V.norm(V.sub(b, V.mul(a, V.dot(a, b))));
  a2 = V.norm(a2); b2 = V.norm(V.sub(b2, V.mul(a2, V.dot(a2, b2))));
  const c = V.cross(a, b), c2 = V.cross(a2, b2);
  // R = [a2 b2 c2] * [a b c]^T  -> columns: R·x = a2*a.x + b2*b.x + c2*c.x ...
  const col = (k) => [0, 1, 2].map((i) => a2[i] * a[k] + b2[i] * b[k] + c2[i] * c[k]);
  return quatToEuler(quatFromCols(col(0), col(1), col(2)));
}

/** Euler XYZ (degrees) of a rotation about an axis. */
export function eulerAxis(k, deg) {
  const h = (deg * D2R) / 2, s = Math.sin(h);
  k = V.norm(k);
  return quatToEuler([k[0] * s, k[1] * s, k[2] * s, Math.cos(h)]);
}

/** Mirror (left -> right) of Euler XYZ angles. */
export const mirrorEuler = (e) => [e[0], -e[1], -e[2]];
