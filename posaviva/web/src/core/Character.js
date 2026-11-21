// A poseable human character: shape (preset + sliders), facial expression
// morphs, skeleton with pose, skinned body + eyes, and attachment support
// (garments / hair register skinned meshes bound to the same skeleton).
import * as THREE from 'three';
import { HumanModel } from './HumanModel.js';
import { materials } from '../render/materials.js';

let _uid = 0;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _q1 = new THREE.Quaternion();

export const DEFAULT_APPEARANCE = {
  skin: '#e0b49a',
  eyes: '#5b3a21',
  lips: null,
};

/** Per mesh vertex: 1 when its dominant bone is a foot or toe bone (cached per model). */
function footSkinMask(model) {
  if (model._footSkin) return model._footSkin;
  const m = new Uint8Array(model.vertexCount);
  const isFoot = model.bones.map((b) => /^(foot|toe)/.test(b.name));
  for (let v = 0; v < model.vertexCount; v++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = model.skinWeight[v * 4 + k]; if (w > bw) { bw = w; best = model.skinIndex[v * 4 + k]; } }
    m[v] = isFoot[best] ? 1 : 0;
  }
  return (model._footSkin = m);
}

export class Character extends THREE.EventDispatcher {
  /**
   * @param {HumanModel} model
   * @param {{preset?:string,name?:string,id?:string}} opts
   */
  constructor(model, opts = {}) {
    super();
    this.model = model;
    this.id = opts.id || `ch${Date.now().toString(36)}${(_uid++).toString(36)}`;
    this.presetId = opts.preset || 'f_normal';
    this.name = opts.name || this.preset.label;
    /** slider id -> value in [-1, 1] */
    this.sliders = {};
    /** expression unit name -> weight in [0, 1] */
    this.expression = {};
    this.appearance = { ...DEFAULT_APPEARANCE };
    /** free-form per-module state (outfit, hair, face …) serialized with the character */
    this.data = {};
    /** per draw-group material spec overrides for the body (index -> spec), e.g. face module hides group 1 */
    this.bodySpecOverrides = {};
    /** extra height (m) added under the feet, e.g. shoe soles (set by the clothing module) */
    this.groundClearance = 0;

    const NV = model.vertexCount;
    this.shapePositions = new Float32Array(NV * 3); // preset+sliders (no expression), rig space, grounded
    this.restPositions = new Float32Array(NV * 3); // shape + expression morphs
    this.restNormals = new Float32Array(NV * 3);
    this.skinnedPositions = new Float32Array(NV * 3); // CPU skinned (rig space), lazily updated
    this._skinnedDirty = true;

    // --- scene graph: root (placement) > rig (identity) > bones + meshes
    this.root = new THREE.Group();
    this.root.name = `character:${this.id}`;
    this.root.userData.character = this;
    this.rig = new THREE.Group();
    this.root.add(this.rig);

    // --- skeleton
    this.bones = model.bones.map((b) => { const bone = new THREE.Bone(); bone.name = b.name; return bone; });
    model.bones.forEach((b, i) => { if (b.parent >= 0) this.bones[b.parent].add(this.bones[i]); });
    this.rig.add(this.bones[0]);
    this.boneByName = new Map(this.bones.map((b) => [b.name, b]));
    const NB = this.bones.length;
    this.restGlobal = Array.from({ length: NB }, () => new THREE.Matrix4()); // rest bone frames (rig space)
    this.restLocalPos = Array.from({ length: NB }, () => new THREE.Vector3());
    this.restLocalQuat = Array.from({ length: NB }, () => new THREE.Quaternion());
    /** pose rotation per bone, expressed in the bone's rest-local frame */
    this.poseQuat = Array.from({ length: NB }, () => new THREE.Quaternion());
    /** extra translation of the root bone (rig space) */
    this.rootOffset = new THREE.Vector3();
    this.jointPositions = new Map();
    this.skeleton = new THREE.Skeleton(this.bones, this.restGlobal.map(() => new THREE.Matrix4()));
    this.skinMatrices = new Float32Array(NB * 16); // rig-space skinning matrices (bone * inverse)

    this._buildBodyMesh();
    this._buildEyes();
    this._applyMaterials();
    /** attachment meshes (garments, hair …) */
    this.attachments = new Set();
    this.rebuildShape();
  }

  get preset() { return this.model.presetById.get(this.presetId) || this.model.presets[0]; }
  get sex() { return this.preset.sex; }

  // ------------------------------------------------------------ geometry
  _buildBodyMesh() {
    const m = this.model;
    const NR = m.renderVertexCount;
    const geo = new THREE.BufferGeometry();
    this._rPos = new Float32Array(NR * 3);
    this._rNor = new Float32Array(NR * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this._rPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this._rNor, 3).setUsage(THREE.DynamicDrawUsage));
    // uv / skin index / skin weights are the same for every character: one set of
    // attributes (and GPU buffers) shared by all bodies (~0.6 MB each saved)
    const shared = m._bodyStaticAttrs || (m._bodyStaticAttrs = (() => {
      const si = new Uint16Array(NR * 4), sw = new Float32Array(NR * 4);
      for (let r = 0; r < NR; r++) {
        const v = m.rv2v[r];
        for (let k = 0; k < 4; k++) { si[r * 4 + k] = m.skinIndex[v * 4 + k]; sw[r * 4 + k] = m.skinWeight[v * 4 + k]; }
      }
      return { uv: new THREE.BufferAttribute(m.rvUV, 2), skinIndex: new THREE.BufferAttribute(si, 4), skinWeight: new THREE.BufferAttribute(sw, 4) };
    })());
    geo.setAttribute('uv', shared.uv);
    geo.setAttribute('skinIndex', shared.skinIndex);
    geo.setAttribute('skinWeight', shared.skinWeight);
    // draw groups: 0 skin(body) 1 eyelashes 2 teeth 3 tongue
    const order = [[0], [6], [7, 8], [9]];
    const idx = [];
    this.bodyHiddenFaces = new Uint8Array(m.faceCount); // garments may hide covered body faces
    order.forEach((gs, mi) => {
      const start = idx.length;
      for (const g of gs) for (const f of m.groupFaces[g]) {
        const a = m.faceRV[f * 4], b = m.faceRV[f * 4 + 1], c = m.faceRV[f * 4 + 2], d = m.faceRV[f * 4 + 3];
        idx.push(a, b, c); if (d !== 0xffff) idx.push(a, c, d);
      }
      geo.addGroup(start, idx.length - start, mi);
    });
    // 16-bit indices while the render vertices fit (half the memory / bandwidth;
    // 0xffff is the WebGL 2 primitive-restart index, so it must stay unused)
    this._IndexArray = NR < 0xffff ? Uint16Array : Uint32Array;
    this._bodyIndexFull = this._IndexArray.from(idx);
    this._bodySkinIndexCount = geo.groups[0].count;
    geo.setIndex(new THREE.BufferAttribute(this._IndexArray.from(idx), 1));
    const mesh = new THREE.SkinnedMesh(geo, []);
    mesh.name = 'body';
    mesh.frustumCulled = false;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.character = this;
    mesh.userData.pickable = true;
    mesh.bind(this.skeleton, new THREE.Matrix4());
    this.rig.add(mesh);
    this.body = mesh;
    this._applyMaterials();
  }

  _applyMaterials() {
    const specs = [
      { kind: 'skin', color: this.appearance.skin, lips: this.appearance.lips },
      { kind: 'lashes', color: '#1a1410' },
      { kind: 'teeth', color: '#efe9dc' },
      { kind: 'tongue', color: '#b4545a' },
    ];
    for (const [i, sp] of Object.entries(this.bodySpecOverrides || {})) if (sp) specs[i] = sp;
    materials.apply(this.body, specs);
    if (this.eyeMesh) materials.apply(this.eyeMesh, { kind: 'eye', color: this.appearance.eyes });
  }

  setAppearance(patch) {
    Object.assign(this.appearance, patch);
    this._applyMaterials();
    this.dispatchEvent({ type: 'appearance' });
  }

  _buildEyes() {
    const e = this.model.eyes;
    const geo = new THREE.BufferGeometry();
    const n = e.rv2v.length;
    this._eyeProxyPos = new Float32Array(e.vertexCount * 3);
    this._ePos = new Float32Array(n * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this._ePos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(e.uv, 2));
    geo.setIndex(new THREE.BufferAttribute(e.index, 1));
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const eyeL = this.model.boneIndex.get('eye.L'), eyeR = this.model.boneIndex.get('eye.R');
    for (let r = 0; r < n; r++) { si[r * 4] = e.side[e.rv2v[r]] === 0 ? eyeL : eyeR; sw[r * 4] = 1; }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    const mesh = new THREE.SkinnedMesh(geo, []);
    mesh.name = 'eyes';
    mesh.frustumCulled = false;
    mesh.userData.character = this;
    mesh.bind(this.skeleton, new THREE.Matrix4());
    this.rig.add(mesh);
    this.eyeMesh = mesh;
  }

  _fitEyes() {
    const e = this.model.eyes, P = this.shapePositions, out = this._eyeProxyPos;
    const sc = (s, axis) => Math.abs(P[s[0] * 3 + axis] - P[s[1] * 3 + axis]) / s[2];
    const sx = sc(e.scales.x, 0), sy = sc(e.scales.y, 1), sz = sc(e.scales.z, 2);
    for (let i = 0; i < e.vertexCount; i++) {
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 3; k++) {
        const v = e.refs[i * 3 + k] * 3, w = e.weights[i * 3 + k];
        x += w * P[v]; y += w * P[v + 1]; z += w * P[v + 2];
      }
      out[i * 3] = x + e.offsets[i * 3] * sx;
      out[i * 3 + 1] = y + e.offsets[i * 3 + 1] * sy;
      out[i * 3 + 2] = z + e.offsets[i * 3 + 2] * sz;
    }
    for (let r = 0; r < e.rv2v.length; r++) {
      const v = e.rv2v[r] * 3;
      this._ePos[r * 3] = out[v]; this._ePos[r * 3 + 1] = out[v + 1]; this._ePos[r * 3 + 2] = out[v + 2];
    }
    const g = this.eyeMesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
  }

  // ------------------------------------------------------------ shape
  setPreset(presetId) {
    if (!this.model.presetById.has(presetId)) return;
    const wasDefaultName = this.name === this.preset.label;
    this.presetId = presetId;
    if (wasDefaultName) this.name = this.preset.label;
    // drop sliders that do not apply to the new sex
    for (const s of this.model.sliders) if (s.sex && s.sex !== this.sex) delete this.sliders[s.id];
    this.rebuildShape();
  }

  setSlider(id, value) {
    this.sliders[id] = Math.max(-1, Math.min(1, value));
    this.rebuildShape();
  }

  setSliders(obj) {
    Object.assign(this.sliders, obj);
    this.rebuildShape();
  }

  /** Recomputes rest shape, skeleton rest frames and bind matrices. Fires 'shape'. */
  rebuildShape() {
    const m = this.model, P = this.shapePositions;
    m.evaluateShape(this.presetId, this.sliders, P);
    // ground: lowest body vertex at y = 0
    let minY = Infinity;
    for (const v of m.groupVertices[0]) minY = Math.min(minY, P[v * 3 + 1]);
    for (let i = 1; i < P.length; i += 3) P[i] -= minY;
    this._computeSkeletonRest();
    this._fitEyes();
    this._applyExpressionMorphs();
    this.applyPose();
    this.dispatchEvent({ type: 'shape' });
  }

  _computeSkeletonRest() {
    const m = this.model, P = this.shapePositions;
    this.jointPositions.clear();
    for (const [name, list] of m.joints) {
      const p = new THREE.Vector3();
      for (const v of list) p.x += P[v * 3], p.y += P[v * 3 + 1], p.z += P[v * 3 + 2];
      p.multiplyScalar(1 / list.length);
      this.jointPositions.set(name, p);
    }
    const J = (n) => this.jointPositions.get(n);
    m.bones.forEach((b, i) => {
      const head = J(b.head), tail = J(b.tail);
      const y = _v1.subVectors(tail, head).normalize();
      let x = _v2.set(1, 0, 0);
      if (b.plane) {
        const [p0, p1, p2] = b.plane.map(J);
        x = _v2.crossVectors(_v3.subVectors(p1, p0), new THREE.Vector3().subVectors(p2, p1));
      }
      x.addScaledVector(y, -x.dot(y));
      if (x.lengthSq() < 1e-12) { x.set(1, 0, 0).addScaledVector(y, -y.x); }
      x.normalize();
      const z = _v3.crossVectors(x, y).normalize();
      this.restGlobal[i].makeBasis(x, y, z).setPosition(head);
    });
    // local rest transforms + bind inverses
    m.bones.forEach((b, i) => {
      const G = this.restGlobal[i];
      const L = b.parent >= 0 ? _m1.copy(this.restGlobal[b.parent]).invert().multiply(G) : _m1.copy(G);
      L.decompose(this.restLocalPos[i], this.restLocalQuat[i], _v1);
      this.skeleton.boneInverses[i].copy(G).invert();
    });
  }

  // ------------------------------------------------------------ expression
  /** weights: {unitName: 0..1}; replaces the whole expression when replace=true */
  setExpression(weights, replace = false) {
    if (replace) this.expression = {};
    for (const [k, w] of Object.entries(weights)) {
      if (!this.model.expressions[k]) continue;
      if (w) this.expression[k] = Math.max(-1, Math.min(1.5, w)); else delete this.expression[k];
    }
    this._applyExpressionMorphs(false);
    this.dispatchEvent({ type: 'expression' });
  }

  /**
   * rest = shape + expression morphs, then normals and GPU upload. When only the
   * expression changed since the last full pass (shape unchanged), only the
   * face region the expression units can move is recomputed and uploaded
   * (~1/6 of the mesh): expression sliders and gaze-driven lids stay cheap.
   */
  _applyExpressionMorphs(full = true) {
    const m = this.model, R = this.restPositions, S = this.shapePositions;
    const region = full || !this._faceN || this._exprRegionV !== (m.expressionVersion || 0) ? null : m.expressionRegion;
    if (region) {
      const V = region.verts;
      for (let k = 0; k < V.length; k++) { const i = V[k] * 3; R[i] = S[i]; R[i + 1] = S[i + 1]; R[i + 2] = S[i + 2]; }
    } else R.set(S);
    for (const k in this.expression) {
      const d = m.expressions[k];
      if (d) HumanModel.addSparse(R, d, this.expression[k]);
    }
    this._computeNormals(region);
    this._uploadBody(region);
    this._exprRegionV = m.expressionVersion || 0;
    this._skinnedDirty = true;
  }

  /** Area-weighted vertex normals of restPositions (all of them, or only an expression region). */
  _computeNormals(region = null) {
    const m = this.model, P = this.restPositions, N = this.restNormals, F = m.faceV;
    const topo = m.normalTopology;
    const FN = this._faceN || (this._faceN = new Float32Array(m.faceCount * 3));
    const faces = region ? region.faces : topo.faces;
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i], o = f * 4;
      const a = F[o] * 3, b = F[o + 1] * 3, c = F[o + 2] * 3, dv = F[o + 3];
      let ux, uy, uz, vx, vy, vz;
      if (dv !== 0xffff) {
        // quad normal via diagonals (robust for non-planar quads)
        const d = dv * 3;
        ux = P[c] - P[a]; uy = P[c + 1] - P[a + 1]; uz = P[c + 2] - P[a + 2];
        vx = P[d] - P[b]; vy = P[d + 1] - P[b + 1]; vz = P[d + 2] - P[b + 2];
      } else {
        ux = P[b] - P[a]; uy = P[b + 1] - P[a + 1]; uz = P[b + 2] - P[a + 2];
        vx = P[c] - P[a]; vy = P[c + 1] - P[a + 1]; vz = P[c + 2] - P[a + 2];
      }
      FN[f * 3] = uy * vz - uz * vy; FN[f * 3 + 1] = uz * vx - ux * vz; FN[f * 3 + 2] = ux * vy - uy * vx;
    }
    const off = topo.vfOff, list = topo.vfList;
    const verts = region ? region.nverts : null;
    const n = verts ? verts.length : m.vertexCount;
    for (let k = 0; k < n; k++) {
      const v = verts ? verts[k] : k;
      let x = 0, y = 0, z = 0;
      for (let j = off[v], e = off[v + 1]; j < e; j++) { const q = list[j] * 3; x += FN[q]; y += FN[q + 1]; z += FN[q + 2]; }
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      const i = v * 3;
      N[i] = x / l; N[i + 1] = y / l; N[i + 2] = z / l;
    }
  }

  /** Copies rest positions/normals into the render buffers (all, or an expression region's runs). */
  _uploadBody(region = null) {
    const m = this.model, P = this.restPositions, N = this.restNormals, rv2v = m.rv2v, RP = this._rPos, RN = this._rNor;
    const g = this.body.geometry, pa = g.attributes.position, na = g.attributes.normal;
    const runs = region ? region.rranges : null;
    const nr = runs ? runs.length : 2;
    for (let s = 0; s < nr; s += 2) {
      const r0 = runs ? runs[s] : 0, r1 = runs ? r0 + runs[s + 1] : m.renderVertexCount;
      for (let r = r0; r < r1; r++) {
        const v = rv2v[r] * 3, o = r * 3;
        RP[o] = P[v]; RP[o + 1] = P[v + 1]; RP[o + 2] = P[v + 2];
        RN[o] = N[v]; RN[o + 1] = N[v + 1]; RN[o + 2] = N[v + 2];
      }
    }
    // partial GPU upload unless a full one is still pending (onUpload clears the flag)
    if (!this._bodyUploadHooked) {
      this._bodyUploadHooked = true;
      pa.onUpload(() => { this._fullUploadPending = false; });
    }
    // (a hidden body is never uploaded: do not let ranges pile up)
    if (runs && !this._fullUploadPending && pa.updateRanges.length < 512) {
      for (let s = 0; s < runs.length; s += 2) { pa.addUpdateRange(runs[s] * 3, runs[s + 1] * 3); na.addUpdateRange(runs[s] * 3, runs[s + 1] * 3); }
    } else {
      pa.clearUpdateRanges(); na.clearUpdateRanges();
      this._fullUploadPending = true;
    }
    pa.needsUpdate = true;
    na.needsUpdate = true;
  }

  /**
   * Hide body skin faces (e.g. fully covered by tight garments) to avoid
   * poke-through. hiddenSet: Uint8Array(faceCount) 1 = hidden. Pass null to show all.
   */
  setHiddenBodyFaces(hidden) {
    const m = this.model, g = this.body.geometry;
    const idx = [];
    for (const f of m.groupFaces[0]) {
      if (hidden && hidden[f]) continue;
      const a = m.faceRV[f * 4], b = m.faceRV[f * 4 + 1], c = m.faceRV[f * 4 + 2], d = m.faceRV[f * 4 + 3];
      idx.push(a, b, c); if (d !== 0xffff) idx.push(a, c, d);
    }
    const rest = this._bodyIndexFull.subarray(this._bodySkinIndexCount);
    const all = new this._IndexArray(idx.length + rest.length);
    all.set(idx); all.set(rest, idx.length);
    const oldGroups = this._groupCounts || (this._groupCounts = g.groups.map((gr) => gr.count));
    g.setIndex(new THREE.BufferAttribute(all, 1));
    g.clearGroups();
    g.addGroup(0, idx.length, 0);
    let off = idx.length;
    for (let i = 1; i < oldGroups.length; i++) { g.addGroup(off, oldGroups[i], i); off += oldGroups[i]; }
    this.bodyHiddenFaces = hidden || new Uint8Array(m.faceCount);
    this.dispatchEvent({ type: 'visibility' });
  }

  // ------------------------------------------------------------ pose
  /** Applies poseQuat/rootOffset to the bones. Call after editing poseQuat directly. */
  applyPose() {
    const NB = this.bones.length;
    for (let i = 0; i < NB; i++) {
      const bone = this.bones[i];
      bone.position.copy(this.restLocalPos[i]);
      if (i === 0) { bone.position.add(this.rootOffset); bone.position.y += this.groundClearance; }
      bone.quaternion.copy(this.restLocalQuat[i]).multiply(this.poseQuat[i]);
    }
    this.rig.updateMatrixWorld(true);
    this._skinnedDirty = true;
    this.dispatchEvent({ type: 'pose' });
  }

  /** Raise the whole body (e.g. shoe sole thickness) without rebuilding the shape. */
  setGroundClearance(m) {
    if (Math.abs(m - this.groundClearance) < 1e-6) return;
    this.groundClearance = m;
    this.applyPose();
  }

  /** Move/rotate the character on the ground. Fires 'placement'. */
  setPlacement({ position, rotationY } = {}) {
    if (position) Array.isArray(position) ? this.root.position.fromArray(position) : this.root.position.copy(position);
    if (rotationY !== undefined) this.root.rotation.y = rotationY;
    this.root.updateMatrixWorld(true);
    this._skinnedDirty = true;
    this.dispatchEvent({ type: 'placement' });
  }

  /** Set pose rotation of a bone (rest-local frame). */
  setBoneRotation(name, quat, apply = true) {
    const i = this.model.boneIndex.get(name);
    if (i === undefined) return;
    this.poseQuat[i].copy(quat);
    if (apply) this.applyPose();
  }

  /**
   * Updates one bone without firing 'pose' (for high-frequency, cosmetic
   * updates such as eye gaze that do not deform skin, garments or hair).
   */
  setBoneRotationSilent(name, quat) {
    const i = this.model.boneIndex.get(name);
    if (i === undefined) return;
    this.poseQuat[i].copy(quat);
    const bone = this.bones[i];
    bone.quaternion.copy(this.restLocalQuat[i]).multiply(quat);
    bone.updateMatrixWorld(true);
  }

  getBoneRotation(name) {
    const i = this.model.boneIndex.get(name);
    return i === undefined ? null : this.poseQuat[i];
  }

  resetPose() {
    for (const q of this.poseQuat) q.identity();
    this.rootOffset.set(0, 0, 0);
    this.applyPose();
  }

  /** Pose as plain object {boneName:[x,y,z,w]} (non-identity only) + root offset. */
  getPose() {
    const bones = {};
    this.poseQuat.forEach((q, i) => {
      if (Math.abs(q.w) < 0.999999) bones[this.bones[i].name] = [+q.x.toFixed(5), +q.y.toFixed(5), +q.z.toFixed(5), +q.w.toFixed(5)];
    });
    return { bones, root: this.rootOffset.toArray().map((x) => +x.toFixed(4)) };
  }

  /** Accepts the getPose() format. Bones not listed reset to identity unless partial=true. */
  setPose(pose, partial = false) {
    if (!partial) for (const q of this.poseQuat) q.identity();
    for (const [name, a] of Object.entries(pose.bones || {})) {
      const i = this.model.boneIndex.get(name);
      if (i !== undefined) this.poseQuat[i].set(a[0], a[1], a[2], a[3]).normalize();
    }
    if (pose.root) this.rootOffset.fromArray(pose.root); else if (!partial) this.rootOffset.set(0, 0, 0);
    this.applyPose();
  }

  // ------------------------------------------------------------ skinning on CPU
  /** Rig-space skinning matrices (bone current * inverse rest). */
  updateSkinMatrices() {
    const rigInv = _m2.copy(this.rig.matrixWorld).invert();
    for (let i = 0; i < this.bones.length; i++) {
      _m1.multiplyMatrices(rigInv, this.bones[i].matrixWorld).multiply(this.skeleton.boneInverses[i]);
      _m1.toArray(this.skinMatrices, i * 16);
    }
    return this.skinMatrices;
  }

  /**
   * Generic CPU linear-blend skinning of arbitrary rest positions (rig space).
   * skinIndex/skinWeight: 4 per vertex. Returns out.
   */
  skinPositions(rest, skinIndex, skinWeight, out, count = rest.length / 3) {
    const M = this.updateSkinMatrices();
    for (let i = 0; i < count; i++) {
      const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight[i * 4 + k];
        if (!w) continue;
        const o = skinIndex[i * 4 + k] * 16;
        ox += w * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
        oy += w * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
        oz += w * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
      }
      out[i * 3] = ox; out[i * 3 + 1] = oy; out[i * 3 + 2] = oz;
    }
    return out;
  }

  /** CPU-skinned body mesh vertices (rig space), cached until pose/shape changes. */
  getSkinnedPositions() {
    if (this._skinnedDirty) {
      this.skinPositions(this.restPositions, this.model.skinIndex, this.model.skinWeight, this.skinnedPositions);
      this._skinnedDirty = false;
    }
    return this.skinnedPositions;
  }

  /** World position of a bone's head (joint). */
  getBoneWorldPosition(name, target = new THREE.Vector3()) {
    const b = this.boneByName.get(name);
    return b ? b.getWorldPosition(target) : target.set(0, 0, 0);
  }

  /** Lowest skinned body point (world) – used to put the character on the floor. */
  dropToGround() {
    this.root.updateMatrixWorld(true);
    const P = this.getSkinnedPositions();
    const M = this.rig.matrixWorld;
    const s = this.root.scale.y || 1;
    // shoes (attachments tagged userData.groundContact) carry the floor contact of the
    // feet: then foot/toe skin is left out and the shoe soles must touch the floor
    const shoes = [...this.attachments].filter((m) => m.userData.groundContact && m.visible && m.isSkinnedMesh);
    const foot = shoes.length ? footSkinMask(this.model) : null;
    let lowest = Infinity;
    for (const v of this.model.groupVertices[0]) {
      if (foot && foot[v]) continue;
      _v1.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]).applyMatrix4(M);
      if (_v1.y < lowest) lowest = _v1.y;
    }
    lowest -= this.groundClearance * s; // skin keeps the sole thickness above the floor
    for (const mesh of shoes) {
      const g = mesh.geometry, pos = g.attributes.position;
      const tmp = this._contactTmp && this._contactTmp.length >= pos.array.length ? this._contactTmp : (this._contactTmp = new Float32Array(pos.array.length));
      this.skinPositions(pos.array, g.attributes.skinIndex.array, g.attributes.skinWeight.array, tmp, pos.count);
      for (let i = 0; i < pos.count; i++) {
        _v1.set(tmp[i * 3], tmp[i * 3 + 1], tmp[i * 3 + 2]).applyMatrix4(M);
        if (_v1.y < lowest) lowest = _v1.y;
      }
    }
    if (!Number.isFinite(lowest)) return;
    // floor = the character's own placement height (it may stand on a raised spot)
    const floorY = this.root.getWorldPosition(_v2).y;
    const upLocal = _v3.set(0, 1, 0).applyQuaternion(this.root.getWorldQuaternion(_q1).invert());
    this.rootOffset.addScaledVector(upLocal, -(lowest - floorY) / s);
    this.applyPose();
  }

  // ------------------------------------------------------------ attachments
  /** Adds a SkinnedMesh (geometry in rig rest space, skinIndex/skinWeight using this.bones). */
  addAttachment(mesh) {
    mesh.frustumCulled = false;
    mesh.userData.character = this;
    if (mesh.isSkinnedMesh) mesh.bind(this.skeleton, new THREE.Matrix4());
    this.rig.add(mesh);
    this.attachments.add(mesh);
    return mesh;
  }

  removeAttachment(mesh) {
    if (!this.attachments.has(mesh)) return;
    this.attachments.delete(mesh);
    mesh.removeFromParent();
    materials.release?.(mesh);
    mesh.geometry?.dispose();
  }

  // ------------------------------------------------------------ placement & serialization
  get position() { return this.root.position; }

  toJSON() {
    return {
      id: this.id, name: this.name, preset: this.presetId,
      sliders: { ...this.sliders }, expression: { ...this.expression }, appearance: { ...this.appearance },
      pose: this.getPose(),
      placement: { position: this.root.position.toArray(), rotationY: this.root.rotation.y, scale: this.root.scale.x },
      data: JSON.parse(JSON.stringify(this.data)),
    };
  }

  /** Restores core state (modules restore their own `data` via app hooks). Only rebuilds what changed. */
  fromJSON(j) {
    if (j.name) this.name = j.name;
    const shapeKey = JSON.stringify([this.presetId, this.sliders]);
    const exprKey = JSON.stringify(this.expression);
    const appKey = JSON.stringify(this.appearance);
    if (j.preset) this.presetId = j.preset;
    this.sliders = { ...(j.sliders || {}) };
    this.expression = { ...(j.expression || {}) };
    this.appearance = { ...DEFAULT_APPEARANCE, ...(j.appearance || {}) };
    this.data = j.data ? JSON.parse(JSON.stringify(j.data)) : {};
    if (j.placement) {
      this.root.position.fromArray(j.placement.position || [0, 0, 0]);
      this.root.rotation.y = j.placement.rotationY || 0;
      this.root.scale.setScalar(j.placement.scale || 1);
    }
    if (JSON.stringify(this.appearance) !== appKey) { this._applyMaterials(); this.dispatchEvent({ type: 'appearance' }); }
    if (JSON.stringify([this.presetId, this.sliders]) !== shapeKey) this.rebuildShape();
    else if (JSON.stringify(this.expression) !== exprKey) { this._applyExpressionMorphs(false); this.dispatchEvent({ type: 'expression' }); }
    if (j.pose) this.setPose(j.pose);
  }

  dispose() {
    for (const a of [...this.attachments]) this.removeAttachment(a);
    this.root.removeFromParent();
    this.body.geometry.dispose();
    this.eyeMesh.geometry.dispose();
    materials.release?.(this.body);
    materials.release?.(this.eyeMesh);
    // the bone matrices live in a GPU data texture owned by the skeleton
    this.skeleton.dispose();
    this._disposed = true;
  }
}
