// Tap picking of characters and body parts: CPU raycast against the skinned
// body triangles (group 'body', faces hidden under garments included, so
// clothes and hair never block the selection). The dominant bone under the hit
// (barycentric-weighted skin weights) is mapped to its anatomical control.
import * as THREE from 'three';

const _inv = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _ray = new THREE.Ray();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class Picker {
  /** @param {import('../app.js').App} app @param {import('./controls.js').ControlSet} controls */
  constructor(app, controls) {
    this.app = app;
    this.controls = controls;
    const m = app.model;
    // triangulated body faces (mesh vertex indices), built once
    const tris = [];
    for (const f of m.groupFaces[0]) {
      const a = m.faceV[f * 4], b = m.faceV[f * 4 + 1], c = m.faceV[f * 4 + 2], d = m.faceV[f * 4 + 3];
      tris.push(a, b, c);
      if (d !== 0xffff) tris.push(a, c, d);
    }
    this.tris = Uint32Array.from(tris);
    this._boneAcc = new Float32Array(m.bones.length);
    this.raycaster = new THREE.Raycaster();
  }

  /**
   * Raycast from NDC. Returns {character, point (world), distance, tri, bary:[u,v,w], bone, control} or null.
   * opts.only: restrict to one character.
   */
  pick(ndc, opts = {}) {
    const app = this.app;
    app.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, app.camera);
    const wr = this.raycaster.ray;
    let best = null;
    for (const ch of app.characters) {
      if (opts.only && ch !== opts.only) continue;
      if (!ch.root.visible || !ch.body.visible) continue;
      ch.root.updateMatrixWorld(true);
      // ray in rig space
      _inv.copy(ch.rig.matrixWorld).invert();
      _ray.copy(wr).applyMatrix4(_inv);
      // cheap reject: bounding sphere around the hips (characters are < 2.6 m tall)
      const rootPos = ch.bones[0].getWorldPosition(_p).applyMatrix4(_inv);
      if (_ray.distanceSqToPoint(rootPos) > 1.6 * 1.6) continue;
      const hit = this._intersect(ch, _ray);
      if (!hit) continue;
      // back to world for distance comparison between characters
      const pw = new THREE.Vector3().copy(_ray.direction).multiplyScalar(hit.t).add(_ray.origin).applyMatrix4(ch.rig.matrixWorld);
      const dist = pw.distanceTo(wr.origin);
      if (!best || dist < best.distance) best = { character: ch, point: pw, distance: dist, tri: hit.tri, bary: hit.bary };
    }
    if (!best) return null;
    const bone = this._dominantBone(best.tri, best.bary);
    best.bone = bone;
    best.control = this.controls.forBone(bone);
    return best;
  }

  /**
   * Nearest body triangle of one character along a world ray, within `far` (world units):
   * {character, point (world), distance, tri, bary, bone} or null. Used by contacts
   * (surface under a finger tap, owner of a contact point).
   */
  rayHit(ch, worldRay, far = Infinity) {
    if (!ch.root.visible || !ch.body.visible) return null;
    ch.root.updateMatrixWorld(true);
    _inv.copy(ch.rig.matrixWorld).invert();
    _ray.copy(worldRay).applyMatrix4(_inv);
    const hit = this._intersect(ch, _ray);
    if (!hit) return null;
    const point = new THREE.Vector3().copy(_ray.direction).multiplyScalar(hit.t).add(_ray.origin).applyMatrix4(ch.rig.matrixWorld);
    const distance = point.distanceTo(worldRay.origin);
    if (distance > far) return null;
    return { character: ch, point, distance, tri: hit.tri, bary: hit.bary, bone: this._dominantBone(hit.tri, hit.bary) };
  }

  /** World normal of a body triangle (as returned in hit.tri) of the posed character. */
  normalAt(ch, triK, out = new THREE.Vector3()) {
    const P = ch.getSkinnedPositions(), T = this.tris;
    const a = T[triK] * 3, b = T[triK + 1] * 3, c = T[triK + 2] * 3;
    _e1.set(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]);
    _e2.set(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]);
    out.crossVectors(_e1, _e2);
    _nm.getNormalMatrix(ch.rig.matrixWorld);
    return out.applyMatrix3(_nm).normalize();
  }

  /** Möller–Trumbore over all body triangles (double sided). Returns {t, tri, bary} of the nearest hit. */
  _intersect(ch, ray) {
    const P = ch.getSkinnedPositions(), T = this.tris;
    const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z;
    const dx = ray.direction.x, dy = ray.direction.y, dz = ray.direction.z;
    let bestT = Infinity, bestTri = -1, bu = 0, bv = 0;
    for (let k = 0, n = T.length; k < n; k += 3) {
      const a = T[k] * 3, b = T[k + 1] * 3, c = T[k + 2] * 3;
      const ax = P[a], ay = P[a + 1], az = P[a + 2];
      const e1x = P[b] - ax, e1y = P[b + 1] - ay, e1z = P[b + 2] - az;
      const e2x = P[c] - ax, e2y = P[c + 1] - ay, e2z = P[c + 2] - az;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      const inv = 1 / det;
      const tx = ox - ax, ty = oy - ay, tz = oz - az;
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 1e-6 && t < bestT) { bestT = t; bestTri = k; bu = u; bv = v; }
    }
    if (bestTri < 0) return null;
    return { t: bestT, tri: bestTri, bary: [1 - bu - bv, bu, bv] };
  }

  _dominantBone(triK, bary) {
    const m = this.app.model, acc = this._boneAcc, T = this.tris;
    acc.fill(0);
    for (let j = 0; j < 3; j++) {
      const v = T[triK + j];
      for (let k = 0; k < 4; k++) {
        const w = m.skinWeight[v * 4 + k];
        if (w) acc[m.skinIndex[v * 4 + k]] += w * bary[j];
      }
    }
    let bi = 0;
    for (let i = 1; i < acc.length; i++) if (acc[i] > acc[bi]) bi = i;
    return bi;
  }
}
