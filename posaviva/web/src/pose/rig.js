// Posing math on top of Character.poseQuat:
//  - per-bone Euler angles with a cache (stable slider values, no gimbal flips:
//    of the two equivalent Euler solutions the one inside the anatomical ranges wins)
//  - read / write of anatomical control axes (least-squares read, weighted delta write)
//  - world-space rotations applied to a bone, then projected back on the control
//    (limits, twist distribution)
//  - cheap partial matrix updates (no 'pose' event until ch.applyPose())
import * as THREE from 'three';

const PI = Math.PI, TAU = Math.PI * 2;
const _e = new THREE.Euler();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _s = new THREE.Vector3();
const UNIT = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

const wrap = (a) => a - TAU * Math.floor((a + PI) / TAU);
const _ca = new Float64Array(3), _alt = new Float64Array(3), _n3 = new Float64Array(3);

export class PoseRig {
  /** @param {import('./controls.js').ControlSet} controls */
  constructor(controls) {
    this.controls = controls;
    this.model = controls.model;
    this.NB = this.model.bones.length;
    /** character -> {q: Float64Array(NB*4) snapshot, e: Float64Array(NB*3) euler by letter} */
    this._cache = new WeakMap();
    /** character -> {key, elbowL, elbowR, kneeL, kneeR} rest bends (radians) */
    this._hinge = new WeakMap();
    this.limits = true;
    /** per bone: letter indices of its Euler order, outermost first */
    this._orderIdx = controls.order.map((o) => [0, 1, 2].map((k) => 'xyz'.indexOf(o[k].toLowerCase())));
    this._lim = new Float64Array(2);
    this._res = { value: 0, clamped: false }; // write() result (shared)
    this._J = new Float64Array(9); this._v0 = new Float64Array(3); this._w3 = new Float64Array(3); this._d3 = new Float64Array(3);
  }

  _c(ch) {
    let c = this._cache.get(ch);
    if (!c) {
      c = { q: new Float64Array(this.NB * 4).fill(NaN), e: new Float64Array(this.NB * 3) };
      this._cache.set(ch, c);
    }
    return c;
  }

  // ------------------------------------------------------------ euler per bone
  /** Euler angles (by letter x,y,z) of bone i in its family order. Returned array is a live view: do not keep. */
  euler(ch, i) {
    const c = this._c(ch), q = ch.poseQuat[i], o = i * 4;
    const e = c.e.subarray(i * 3, i * 3 + 3);
    if (c.q[o] === q.x && c.q[o + 1] === q.y && c.q[o + 2] === q.z && c.q[o + 3] === q.w) return e;
    _e.setFromQuaternion(q, this.controls.order[i]);
    // the two Tait-Bryan solutions: (a, b, c) and (a + pi, pi - b, c + pi) in order positions;
    // the one inside the anatomical ranges wins, then the one closest to the previous value
    _ca[0] = _e.x; _ca[1] = _e.y; _ca[2] = _e.z;
    const p = this._orderIdx[i];
    _alt[p[0]] = wrap(_ca[p[0]] + PI); _alt[p[1]] = wrap(PI - _ca[p[1]]); _alt[p[2]] = wrap(_ca[p[2]] + PI);
    const hasPrev = !Number.isNaN(c.q[o]);
    const best = this._score(i, _alt, e, hasPrev) + 1e-6 < this._score(i, _ca, e, hasPrev) ? _alt : _ca;
    e[0] = best[0]; e[1] = best[1]; e[2] = best[2];
    c.q[o] = q.x; c.q[o + 1] = q.y; c.q[o + 2] = q.z; c.q[o + 3] = q.w;
    return e;
  }

  _score(i, s, prev, hasPrev) {
    const R = this.controls.range[i];
    let v = 0;
    for (let k = 0; k < 3; k++) {
      const a = s[k];
      if (a < R[k][0]) v += R[k][0] - a; else if (a > R[k][1]) v += a - R[k][1];
      if (hasPrev) v += 0.05 * Math.abs(wrap(a - prev[k]));
    }
    return v;
  }

  /** Sets bone i from Euler angles (by letter). Does not update matrices. */
  setEuler(ch, i, x, y, z) {
    _e.set(x, y, z, this.controls.order[i]);
    const q = ch.poseQuat[i].setFromEuler(_e);
    const c = this._c(ch), o = i * 4;
    c.e[i * 3] = x; c.e[i * 3 + 1] = y; c.e[i * 3 + 2] = z;
    c.q[o] = q.x; c.q[o + 1] = q.y; c.q[o + 2] = q.z; c.q[o + 3] = q.w;
  }

  // ------------------------------------------------------------ hinge offsets
  /**
   * Rest bend of elbows / knees (anatomical flexion of the rest pose, radians),
   * measured per body shape: sliders show anatomical angles (0 = straight).
   */
  hingeRest(ch, which, side) {
    // rebuildShape() recreates the joint vectors: their identity tells if the cache is stale
    let h = this._hinge.get(ch);
    const ref = ch.jointPositions.get('root____head');
    if (!h || h.ref !== ref) {
      h = { ref };
      for (const sd of ['L', 'R']) {
        h['elbow' + sd] = this._bendAt(ch, `upperarm02.${sd}`, `lowerarm01.${sd}`, -1);
        h['knee' + sd] = this._bendAt(ch, `upperleg02.${sd}`, `lowerleg01.${sd}`, -1);
      }
      this._hinge.set(ch, h);
    }
    return h[which + side] || 0;
  }

  /** signed rest angle between parent and child bone directions about the child's flexion axis (sign * local X) */
  _bendAt(ch, parentName, childName, sign) {
    const ip = this.model.boneIndex.get(parentName), ic = this.model.boneIndex.get(childName);
    const Gp = ch.restGlobal[ip].elements, Gc = ch.restGlobal[ic].elements;
    const yp = _v1.set(Gp[4], Gp[5], Gp[6]).normalize(), yc = _v2.set(Gc[4], Gc[5], Gc[6]).normalize();
    const ax = _v3.set(Gc[0], Gc[1], Gc[2]).normalize().multiplyScalar(sign);
    const cr = new THREE.Vector3().crossVectors(yp, yc);
    return Math.atan2(cr.dot(ax), yp.dot(yc));
  }

  /** Display offset of an axis (anatomical angle = value + offset). */
  offset(ch, ctrl, axis) {
    return axis.hinge ? this.hingeRest(ch, axis.hinge, ctrl.side) : 0;
  }

  // ------------------------------------------------------------ axes
  /** Control axis value (radians, relative to the rest pose). */
  read(ch, ctrl, k) {
    const a = ctrl.axes[k];
    let num = 0;
    if (a.coupled) {
      // shared chain bones: pseudo-inverse read (see ControlSet.setSoft)
      for (const d of a.drives) if (d.rw) num += d.rw * d.sign * this.euler(ch, d.i)[d.li];
      return num;
    }
    if (a.sum) { for (const d of a.drives) num += d.sign * this.euler(ch, d.i)[d.li]; return num; }
    for (const d of a.drives) num += d.w * d.sign * this.euler(ch, d.i)[d.li];
    return num / a.wsum2;
  }

  /** Anatomical (display) value = read + hinge offset. */
  readDisplay(ch, ctrl, k) { return this.read(ch, ctrl, k) + this.offset(ch, ctrl, ctrl.axes[k]); }

  /**
   * [min, max] of an axis relative to rest (radians), or null when unlimited.
   * Returns a shared scratch array: read it before the next limitsOf()/write() call.
   */
  limitsOf(ch, ctrl, k) {
    if (ctrl.free || !this.limits) return null;
    const a = ctrl.axes[k], off = this.offset(ch, ctrl, a);
    this._lim[0] = a.min - off; this._lim[1] = a.max - off;
    return this._lim;
  }

  /**
   * Writes an axis value (relative to rest). Returns a shared {value, clamped} (clamped = a limit was hit).
   * Matrices are NOT updated: call refreshBone()/refreshControl() or ch.applyPose().
   */
  write(ch, ctrl, k, value, clamp = true) {
    const a = ctrl.axes[k];
    let clamped = false;
    const lim = clamp ? this.limitsOf(ch, ctrl, k) : null;
    if (lim) {
      if (value < lim[0]) { value = lim[0]; clamped = true; } else if (value > lim[1]) { value = lim[1]; clamped = true; }
    } else if (ctrl.free) value = wrap(value);
    const d = value - this.read(ch, ctrl, k);
    if (Math.abs(d) > 1e-9) {
      for (const dr of a.drives) {
        if (!dr.w) continue;
        _n3.set(this.euler(ch, dr.i));
        _n3[dr.li] += dr.sign * dr.w * d;
        if (ctrl.free) _n3[dr.li] = wrap(_n3[dr.li]);
        this.setEuler(ch, dr.i, _n3[0], _n3[1], _n3[2]);
      }
    }
    this._res.value = value; this._res.clamped = clamped;
    return this._res;
  }

  /**
   * Snapshot of everything a free rotation may disturb on a control (for project()).
   * Pass `out` (a previous snapshot of the same control) to reuse its buffers.
   */
  snapshot(ch, ctrl, out = null) {
    if (!out || out.ctrl !== ctrl) out = { ctrl, axes: new Float64Array(ctrl.axes.length), bones: ctrl.boneIdx.map(() => new Float64Array(3)) };
    for (let k = 0; k < ctrl.axes.length; k++) out.axes[k] = this.read(ch, ctrl, k);
    for (let j = 0; j < ctrl.boneIdx.length; j++) out.bones[j].set(this.euler(ch, ctrl.boneIdx[j]));
    return out;
  }

  /**
   * Projects the bones of a control back onto its anatomical axes after a free
   * (world) rotation: distributes every axis over its drives by weight, clamps to
   * the limits, and (with limits on) restores non-anatomical components to the
   * snapshot. Returns true if a limit was hit.
   */
  project(ch, ctrl, snap) {
    if (ctrl.coupled) {
      // shared bones: only this part's share is re-written (other parts keep theirs)
      let hit = false;
      for (let k = 0; k < ctrl.axes.length; k++) hit = this.write(ch, ctrl, k, this.read(ch, ctrl, k)).clamped || hit;
      return hit;
    }
    const lim = this.limits && !ctrl.free;
    const scr = ctrl._scr || (ctrl._scr = { totals: new Float64Array(ctrl.axes.length), next: ctrl.boneIdx.map(() => new Float64Array(3)) });
    const { totals, next } = scr;
    // totals from the current (free) bone state
    for (let k = 0; k < ctrl.axes.length; k++) totals[k] = this.read(ch, ctrl, k);
    // start from the free state, or the snapshot for components we must keep
    for (let j = 0; j < ctrl.boneIdx.length; j++) next[j].set(lim ? snap.bones[j] : this.euler(ch, ctrl.boneIdx[j]));
    let hit = false;
    for (let k = 0; k < ctrl.axes.length; k++) {
      const a = ctrl.axes[k];
      let v = totals[k];
      if (lim) {
        if (a.extra) v = snap.axes[k];
        else {
          const L = this.limitsOf(ch, ctrl, k);
          if (v < L[0]) { v = L[0]; hit = true; } else if (v > L[1]) { v = L[1]; hit = true; }
        }
      }
      for (const d of a.drives) next[d.j][d.li] = d.sign * d.w * v;
    }
    for (let j = 0; j < ctrl.boneIdx.length; j++) this.setEuler(ch, ctrl.boneIdx[j], next[j][0], next[j][1], next[j][2]);
    return hit;
  }

  // ------------------------------------------------------------ world space
  /** World quaternion of bone i's rest frame under its current parent (parentWorld * restLocal). */
  frameQuat(ch, i, out = new THREE.Quaternion()) {
    const p = this.model.bones[i].parent;
    const pm = p >= 0 ? ch.bones[p].matrixWorld : ch.rig.matrixWorld;
    pm.decompose(_v1, out, _s);
    return out.multiply(ch.restLocalQuat[i]);
  }

  /** World quaternion of bone i (current pose). */
  worldQuat(ch, i, out = new THREE.Quaternion()) {
    ch.bones[i].matrixWorld.decompose(_v1, out, _s);
    return out;
  }

  /** World position of bone i's head. */
  worldPos(ch, i, out = new THREE.Vector3()) { return out.setFromMatrixPosition(ch.bones[i].matrixWorld); }

  /** World position of a point at fraction t along bone i (0 head, 1 tail). */
  pointOnBone(ch, i, t, out = new THREE.Vector3()) {
    const b = this.model.bones[i];
    const len = ch.jointPositions.get(b.head).distanceTo(ch.jointPositions.get(b.tail));
    return out.set(0, len * t, 0).applyMatrix4(ch.bones[i].matrixWorld);
  }

  /** Applies a world-space rotation W to bone i (about its head): pose' = F^-1 W F pose. */
  rotateWorld(ch, i, W) {
    const F = this.frameQuat(ch, i, _q1);
    _q2.copy(F).invert().multiply(W).multiply(F).multiply(ch.poseQuat[i]).normalize();
    ch.poseQuat[i].copy(_q2);
  }

  /** Sets bone i so that its world rotation equals Q (pose = F^-1 Q restLocal^-1 ... in frame terms). */
  setWorldQuat(ch, i, Q) {
    const F = this.frameQuat(ch, i, _q1);
    ch.poseQuat[i].copy(F).invert().multiply(Q).normalize();
  }

  /**
   * World axis of control axis k (gimbal axis of its first drive, anatomical sign).
   * The rotation of a ring about this axis by +a increases the axis value by a.
   */
  axisWorld(ch, ctrl, k, out = new THREE.Vector3()) {
    const d = ctrl.axes[k].pd, i = d.i;
    const order = this.controls.order[i].toLowerCase();
    const e = this.euler(ch, i);
    const F = this.frameQuat(ch, i, _q3);
    const pos = order.indexOf(d.letter);
    for (let p = 0; p < pos; p++) {
      const L = order[p];
      F.multiply(_q2.setFromAxisAngle(UNIT[L], e['xyz'.indexOf(L)]));
    }
    return out.copy(UNIT[d.letter]).applyQuaternion(F).multiplyScalar(d.sign).normalize();
  }

  /**
   * Applies a world rotation W to a whole part (trackball, head aim) and projects it on
   * its anatomical axes (limits). A chain part (abdomen / chest / neck) turns its pivot
   * bone, measures the change and spreads it over the chain by its profile, so the
   * curve stays continuous. Returns true when a limit was hit.
   */
  rotateControl(ch, ctrl, W, snap) {
    if (!ctrl.coupled) {
      for (const i of ctrl.freeRoots) this.rotateWorld(ch, i, W);
      return this.project(ch, ctrl, snap);
    }
    // chain part: find the axis changes that turn the END of the chain (base of the
    // head) by W — a small 3x3 linear solve on finite differences, since the bones of
    // the curved back do not share one frame (an Euler change on the tilted lumbar
    // bones is not the same world rotation as on the upright chest)
    const iEnd = ctrl.boneIdx[ctrl.boneIdx.length - 1];
    const n = ctrl.axes.length, J = this._J, v0 = this._v0, w = this._w3;
    this.worldQuat(ch, iEnd, _q2);
    _q1.copy(_q2).invert();
    for (let k = 0; k < n; k++) v0[k] = this.read(ch, ctrl, k);
    const hd = 0.02;
    for (let k = 0; k < n; k++) {
      this.write(ch, ctrl, k, v0[k] + hd, false);
      this.refreshControl(ch, ctrl);
      rotVec(this.worldQuat(ch, iEnd, _q3).multiply(_q1), _v1);
      J[k * 3] = _v1.x / hd; J[k * 3 + 1] = _v1.y / hd; J[k * 3 + 2] = _v1.z / hd; // column k
      this.write(ch, ctrl, k, v0[k], false);
    }
    rotVec(W, _v1);
    w[0] = _v1.x; w[1] = _v1.y; w[2] = _v1.z;
    const d = solve3(J, w, this._d3);
    let hit = false;
    for (let k = 0; k < n; k++) {
      const dv = d ? d[k] : 0;
      hit = this.write(ch, ctrl, k, v0[k] + (Number.isFinite(dv) ? dv : 0)).clamped || hit;
    }
    return hit;
  }

  // ------------------------------------------------------------ matrices
  /** Updates matrices of bone i and its subtree from poseQuat (no events). */
  refreshBone(ch, i) {
    const bone = ch.bones[i];
    bone.quaternion.copy(ch.restLocalQuat[i]).multiply(ch.poseQuat[i]);
    // (as Character.applyPose: the root also carries the shoe ground clearance)
    if (i === 0) { bone.position.copy(ch.restLocalPos[0]).add(ch.rootOffset); bone.position.y += ch.groundClearance || 0; }
    bone.updateMatrixWorld(true);
  }

  /** Updates every bone from poseQuat / rootOffset (no events). */
  refreshAll(ch) {
    const bones = ch.bones;
    for (let i = 1; i < bones.length; i++) bones[i].quaternion.copy(ch.restLocalQuat[i]).multiply(ch.poseQuat[i]);
    this.refreshBone(ch, 0);
  }

  /** Updates matrices of every bone of a control (topmost first). */
  refreshControl(ch, ctrl) {
    for (const i of ctrl.boneIdx) {
      const bone = ch.bones[i];
      bone.quaternion.copy(ch.restLocalQuat[i]).multiply(ch.poseQuat[i]);
    }
    ch.bones[ctrl.topIndex].updateMatrixWorld(true);
  }

  // ------------------------------------------------------------ whole-control helpers
  /**
   * Bones of a control split in "owned" (whole rotation belongs to the part) and
   * "shared" (only the driven Euler components belong to it, e.g. the forearm
   * twist bones driven by the hand's pronation axis).
   */
  _parts(ctrl) {
    if (ctrl._parts) return ctrl._parts;
    const own = new Set(ctrl.own.map((n) => this.model.boneIndex.get(n)));
    const shared = new Map(); // bone index -> Set(letter index)
    for (const a of ctrl.axes) for (const d of a.drives) {
      if (own.has(d.i)) continue;
      if (!shared.has(d.i)) shared.set(d.i, new Set());
      shared.get(d.i).add(d.li);
    }
    // owned = driven bones only (e.g. the eyes belong to the head part for picking, but gaze is the face module's)
    return (ctrl._parts = { own: [...own].filter((i) => ctrl.boneIdx.includes(i)), shared });
  }

  /** Resets a control to the rest pose (shared bones: only its own components). */
  resetControl(ch, ctrl) {
    if (ctrl.coupled) { for (let k = 0; k < ctrl.axes.length; k++) this.write(ch, ctrl, k, 0, false); return; }
    const { own, shared } = this._parts(ctrl);
    for (const i of own) ch.poseQuat[i].identity();
    for (const [i, letters] of shared) {
      const e = Array.from(this.euler(ch, i));
      for (const li of letters) e[li] = 0;
      this.setEuler(ch, i, e[0], e[1], e[2]);
    }
  }

  /**
   * Copies (mirrored) a sided control to the opposite side; a central control is
   * mirrored in place. includeHandFingers: the hand also carries its fingers.
   */
  mirrorControl(ch, ctrl, includeHandFingers = false) {
    const other = (i) => {
      const n = this.model.bones[i].name;
      const m = n.endsWith('.L') ? n.slice(0, -2) + '.R' : n.endsWith('.R') ? n.slice(0, -2) + '.L' : n;
      return this.model.boneIndex.get(m);
    };
    if (ctrl.coupled) {
      // central chain part: mirror in place = side bend and twist change sign
      for (let k = 0; k < ctrl.axes.length; k++) if (ctrl.axes[k].key !== 'flex') this.write(ch, ctrl, k, -this.read(ch, ctrl, k), false);
      return;
    }
    const { own, shared } = this._parts(ctrl);
    const ownList = [...own];
    if (includeHandFingers && ctrl.baseId === 'hand') {
      for (const c of this.controls.list) if (c.region === 'finger' && c.side === ctrl.side) ownList.push(...c.boneIdx);
    }
    // mirror convention: q(x, y, z, w) -> q(x, -y, -z, w); Euler: x keeps its sign, y / z flip
    for (const a of ownList) {
      const q = ch.poseQuat[a];
      ch.poseQuat[other(a)].set(q.x, -q.y, -q.z, q.w);
    }
    for (const [a, letters] of shared) {
      const src = this.euler(ch, a), b = other(a);
      const dst = Array.from(this.euler(ch, b));
      for (const li of letters) dst[li] = li === 0 ? src[li] : -src[li];
      this.setEuler(ch, b, dst[0], dst[1], dst[2]);
    }
  }
}

/** rotation vector (axis * angle) of a unit quaternion (shortest arc) */
function rotVec(q, out) {
  let w = q.w, x = q.x, y = q.y, z = q.z;
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-9) return out.set(2 * x, 2 * y, 2 * z);
  const a = 2 * Math.atan2(s, w);
  return out.set((x / s) * a, (y / s) * a, (z / s) * a);
}

/** solves J d = w for a 3x3 matrix stored by columns (J[k*3 + r] = row r of column k); null when singular */
function solve3(J, w, out) {
  const a = J[0], b = J[3], c = J[6], d = J[1], e = J[4], f = J[7], g = J[2], h = J[5], i = J[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  out[0] = (A * w[0] + (c * h - b * i) * w[1] + (b * f - c * e) * w[2]) * inv;
  out[1] = (B * w[0] + (a * i - c * g) * w[1] + (c * d - a * f) * w[2]) * inv;
  out[2] = (C * w[0] + (b * g - a * h) * w[1] + (a * e - b * d) * w[2]) * inv;
  return out;
}
