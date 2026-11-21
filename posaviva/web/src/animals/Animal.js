// One poseable animal in the scene: a skinned mesh (GPU skinning, material
// library specs per surface region), eyes and teeth riding the head / jaw
// bones, a coat palette, size and age, and a pose (bone rotations in world
// aligned rest frames). Not a Character: it lives in app.world, persists
// through the animals module's serializeScene().
//
//   animal.root      placement group (position on the ground, rotation.y, scale)
//   animal.rig       identity group holding the root bone ('hips') and the mesh
//   animal.bones / boneByName, animal.mesh (SkinnedMesh), animal.entry (manifest)
//   events: 'pose', 'appearance', 'placement'
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials } from '../render/materials.js';
import { coatColors } from './coatColor.js';
import { furNormalMap, eyeTexture, quillNormalMap } from './textures.js';
import { controlsFor } from './controls.js';

let _seq = 0;
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _inv = new THREE.Matrix4(), _ray = new THREE.Ray();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _hit = new THREE.Vector3();
const D2R = Math.PI / 180;

/** Age 0 (cucciolo) .. 1 (adulto): overall scale and head scale. */
export function ageScales(age) {
  const t = Math.max(0, Math.min(1, age));
  const e = t * t * (3 - 2 * t);
  return { body: 0.38 + 0.62 * e, head: 1.42 - 0.42 * e };
}

const REGION_SPECS = {
  fur: (f) => ({ kind: 'prop', color: '#ffffff', vertexColors: true, roughness: f.roughness ?? 0.8, sheen: f.sheen ?? 0.3, normalMap: furNormalMap(f.type), normalScale: f.normalScale ?? 0.4 }),
  keratin: () => ({ kind: 'prop', color: '#ffffff', vertexColors: true, roughness: 0.42 }),
  nose: () => ({ kind: 'prop', color: '#ffffff', vertexColors: true, roughness: 0.3, normalMap: furNormalMap('wrinkle'), normalScale: 0.3 }),
  mouth: () => ({ kind: 'prop', color: '#ffffff', vertexColors: true, roughness: 0.62 }),
  pad: () => ({ kind: 'prop', color: '#ffffff', vertexColors: true, roughness: 0.7, normalMap: furNormalMap('wrinkle'), normalScale: 0.5 }),
  skin: (f) => ({ kind: 'prop', color: '#ffffff', vertexColors: true, roughness: 0.62, normalMap: furNormalMap('wrinkle'), normalScale: 0.35 }),
  eyelid: () => ({ kind: 'prop', color: '#ffffff', vertexColors: true, roughness: 0.4 }),
  // explicit feather sheets (wings, tails): per-feather UVs with a quill / barbs normal map
  feather: (f) => ({ kind: 'prop', color: '#ffffff', vertexColors: true, roughness: f.featherRoughness ?? 0.72, sheen: f.featherSheen ?? 0.3, normalMap: quillNormalMap(), normalScale: 0.55 }),
  // scaly skin (bird legs and feet, reptiles' bellies)
  scale: () => ({ kind: 'prop', color: '#ffffff', vertexColors: true, roughness: 0.55, normalMap: furNormalMap('scales'), normalScale: 0.45 }),
};

export class Animal extends THREE.EventDispatcher {
  /**
   * @param data decoded species (loader.loadSpecies)
   * @param opts {id, name, palette, color, size, age, position, rotationY, pose}
   */
  constructor(data, opts = {}) {
    super();
    this.data = data;
    this.entry = data.entry;
    this.species = this.entry.id;
    this.id = opts.id || `a${Date.now().toString(36)}${(_seq++).toString(36)}`;
    this.name = opts.name || this.entry.label;
    this.palette = opts.palette || this.entry.palettes[0].id;
    this.customColor = opts.color || null;
    this.size = opts.size ?? 1;
    this.age = opts.age ?? 1;
    this.lift = 0;
    this.controls = controlsFor(this.entry);

    const root = new THREE.Group();
    root.name = 'animal:' + this.species;
    root.userData.animal = this;
    const rig = new THREE.Group();
    rig.name = 'animal-rig';
    root.add(rig);
    this.root = root; this.rig = rig;
    if (opts.position) root.position.fromArray(opts.position);
    if (opts.rotationY) root.rotation.y = opts.rotationY;

    // ---- skeleton (world aligned rest frames: bone = pivot point)
    const E = this.entry;
    this.bones = E.bones.map((b) => { const bone = new THREE.Bone(); bone.name = b.name; return bone; });
    this.boneByName = new Map(this.bones.map((b) => [b.name, b]));
    this.boneIndex = new Map(E.bones.map((b, i) => [b.name, i]));
    E.bones.forEach((b, i) => {
      const bone = this.bones[i];
      if (b.parent < 0) { bone.position.fromArray(b.head); rig.add(bone); }
      else { const p = E.bones[b.parent]; bone.position.set(b.head[0] - p.head[0], b.head[1] - p.head[1], b.head[2] - p.head[2]); this.bones[b.parent].add(bone); }
    });
    this.restPos = this.bones.map((b) => b.position.clone());
    this.inverses = E.bones.map((b) => new THREE.Matrix4().makeTranslation(-b.head[0], -b.head[1], -b.head[2]));
    this.skeleton = new THREE.Skeleton(this.bones, this.inverses.map((m) => m.clone()));

    // ---- skinned mesh (shared attributes, own colour buffer)
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(data.attrs)) g.setAttribute(k, a);
    this.colors = new Float32Array(data.count * 3);
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    g.setIndex(data.index);
    const specs = [];
    E.groups.forEach((gr) => {
      const mk = REGION_SPECS[gr.region] || REGION_SPECS.fur;
      g.addGroup(gr.start, gr.count, specs.length);
      specs.push(mk(E.fur || {}));
    });
    this.specs = specs;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e3);
    const mesh = new THREE.SkinnedMesh(g);
    mesh.name = 'animal-body';
    mesh.bind(this.skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.animal = this;
    rig.add(mesh);
    this.mesh = mesh;
    this.applyMaterials();
    this.meshes = [mesh];

    // ---- eyes (eyeball + cornea shell) and teeth on their bones; one merged
    // mesh per bone and material (few draw calls)
    this.extras = [];
    const eyeTex = eyeTexture(E.pupil || 'round');
    const perBone = new Map(); // bone -> {eyes: [], cornea: [], teeth: []}
    const slot = (bone) => { let o = perBone.get(bone); if (!o) perBone.set(bone, (o = { eyes: [], cornea: [], teeth: [] })); return o; };
    const _q0 = new THREE.Quaternion(), _p0 = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1), _mm = new THREE.Matrix4();
    for (const eye of E.eyes || []) {
      const bone = this.boneByName.get(eye.bone) || this.boneByName.get('head');
      const bh = E.bones[this.boneIndex.get(bone.name)].head;
      _p0.set(eye.pos[0] - bh[0], eye.pos[1] - bh[1], eye.pos[2] - bh[2]);
      _q0.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3().fromArray(eye.dir));
      _mm.compose(_p0, _q0, _s1);
      slot(bone).eyes.push(eyeGeometry(eye.r).clone().applyMatrix4(_mm));
      slot(bone).cornea.push(corneaGeometry(eye.r * 1.025).applyMatrix4(_mm));
    }
    for (const t of E.teeth || []) {
      const bone = this.boneByName.get(t.bone) || this.boneByName.get('head');
      const bh = E.bones[this.boneIndex.get(bone.name)].head;
      const a = new THREE.Vector3().fromArray(t.base), b = new THREE.Vector3().fromArray(t.tip);
      const len = a.distanceTo(b);
      const geo = new THREE.ConeGeometry(t.r, len, 10, 1);
      geo.translate(0, len / 2, 0);
      _q0.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      _mm.compose(_p0.set(t.base[0] - bh[0], t.base[1] - bh[1], t.base[2] - bh[2]), _q0, _s1);
      slot(bone).teeth.push(geo.applyMatrix4(_mm));
    }
    for (const [bone, o] of perBone) {
      const add = (list, name, spec) => {
        if (!list.length) return;
        const geo = list.length > 1 ? mergeGeometries(list) : list[0];
        if (list.length > 1) for (const g0 of list) g0.dispose();
        const m = new THREE.Mesh(geo);
        m.name = name;
        m.userData.animal = this;
        if (name !== 'animal-eyes') m.userData.pickable = false;
        bone.add(m);
        materials.apply(m, spec);
        this.extras.push(m);
      };
      add(o.eyes, 'animal-eyes', { kind: 'eye', map: eyeTex, color: E.iris || '#4a3020' });
      add(o.cornea, 'animal-cornea', { kind: 'eye', cornea: true });
      add(o.teeth, 'animal-teeth', { kind: 'teeth', color: E.teethColor || '#e9e2d0' });
    }
    for (const x of this.extras) x.castShadow = false;

    this._skinned = null; // cached CPU skinned positions (rig space)
    this.applyAppearance();
    if (opts.pose) this.setPose(opts.pose, false);
    this._applyScale();
  }

  /**
   * (Re)assigns the library materials. In the ink styles (toon, lines) the fur
   * detail normal map is left out: the outline pass would turn it into specks.
   */
  applyMaterials() {
    const ink = materials.style === 'toon' || materials.style === 'lines';
    materials.apply(this.mesh, ink ? this.specs.map(({ normalMap, normalScale, ...rest }) => rest) : this.specs);
  }

  // ------------------------------------------------------------------ appearance
  get paletteColors() {
    const p = this.entry.palettes.find((x) => x.id === this.palette) || this.entry.palettes[0];
    const c = { ...p.colors };
    if (this.customColor) c.base = this.customColor;
    return c;
  }

  applyAppearance() {
    coatColors(this.paletteColors, this.data.masks, this.data.extra, this.data.count, this.colors);
    const attr = this.mesh.geometry.getAttribute('color');
    attr.needsUpdate = true;
    this.dispatchEvent({ type: 'appearance' });
  }

  setPalette(id) { this.palette = id; this.customColor = null; this.applyAppearance(); }
  setCustomColor(hex) { this.customColor = hex; this.applyAppearance(); }

  setSize(v) { this.size = Math.max(0.3, Math.min(2, v)); this._applyScale(); }
  setAge(v) { this.age = Math.max(0, Math.min(1, v)); this._applyScale(); }

  _applyScale() {
    const a = ageScales(this.age);
    this.root.scale.setScalar(this.size * a.body);
    const head = this.boneByName.get('head');
    if (head) head.scale.setScalar(a.head);
    this._poseChanged();
  }

  // ------------------------------------------------------------------ pose
  /** {bones: {name: [x,y,z,w]}, lift} (only non-identity bones). */
  getPose() {
    const bones = {};
    for (const b of this.bones) {
      const q = b.quaternion;
      if (Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z) < 1e-5) continue;
      bones[b.name] = [r5(q.x), r5(q.y), r5(q.z), r5(q.w)];
    }
    return { bones, lift: r5(this.lift) };
  }

  setPose(pose, notify = true) {
    for (const b of this.bones) b.quaternion.identity();
    for (const [n, q] of Object.entries(pose?.bones || {})) this.boneByName.get(n)?.quaternion.fromArray(q).normalize();
    this.lift = pose?.lift || 0;
    this._poseChanged(notify);
  }

  resetPose() { this.setPose(null); }

  /** Raw bone Euler XYZ (degrees). */
  boneEuler(name) { const b = this.boneByName.get(name); return b ? _e.setFromQuaternion(b.quaternion, 'XYZ').toArray().slice(0, 3).map((r) => r / D2R) : [0, 0, 0]; }
  setBoneEuler(name, deg) { const b = this.boneByName.get(name); if (b) b.quaternion.setFromEuler(_e.set(deg[0] * D2R, deg[1] * D2R, deg[2] * D2R, 'XYZ')); }

  /**
   * Display value of a control axis. Besides the plain axes (one Euler
   * component spread over the control's bones, or over axis.bones) a family
   * may use:
   *   axis.drive = [[bone, 'x'|'y'|'z', factor], ...]  coupled bones (display v -> v * factor)
   *   axis.k = 'blend', axis.blend = [blendId...]      0..max = identity .. the species'
   *     stored target rotations (entry.blends[id], e.g. a folded wing); axis.invert flips it
   */
  getAxis(ctrl, axis) {
    if (axis.k === 'blend') return this._getBlend(axis);
    if (axis.drive) {
      const [b, c, f] = axis.drive[0];
      return this.boneEuler(b)['xyz'.indexOf(c)] / (f || 1);
    }
    const i = 'xyz'.indexOf(axis.k);
    let sum = 0;
    for (const n of axis.bones || ctrl.bones) sum += this.boneEuler(n)[i];
    return sum * axis.sign * (axis.sided && ctrl.side === '.R' ? -1 : 1);
  }

  /** Sets a control axis (display degrees, clamped to its range); spreads chains evenly. */
  setAxis(ctrl, axis, deg, notify = true) {
    const v = Math.max(axis.min, Math.min(axis.max, deg));
    if (axis.k === 'blend') { this._setBlend(axis, v); this._poseChanged(notify); return v; }
    if (axis.drive) {
      for (const [b, c, f] of axis.drive) {
        const e = this.boneEuler(b);
        e['xyz'.indexOf(c)] = v * (f || 1);
        this.setBoneEuler(b, e);
      }
      this._poseChanged(notify);
      return v;
    }
    const raw = v * axis.sign * (axis.sided && ctrl.side === '.R' ? -1 : 1);
    const i = 'xyz'.indexOf(axis.k);
    const bones = axis.bones || ctrl.bones;
    for (const n of bones) {
      const e = this.boneEuler(n);
      e[i] = raw / bones.length;
      this.setBoneEuler(n, e);
    }
    this._poseChanged(notify);
    return v;
  }

  /** Target rotations of a stored blend (entry.blends[id]) as quaternions (cached on the entry). */
  blendTargets(id) {
    const cache = this.entry._blendQ || (this.entry._blendQ = {});
    if (cache[id]) return cache[id];
    const m = new Map();
    for (const [bn, e] of Object.entries(this.entry.blends?.[id] || {})) {
      if (this.boneByName.has(bn)) m.set(bn, new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0] * D2R, e[1] * D2R, e[2] * D2R, 'XYZ')));
    }
    cache[id] = m;
    return m;
  }

  _getBlend(axis) {
    const m = this.blendTargets(axis.blend[0]);
    let best = null, ang = 0;
    for (const [bn, q] of m) { const a = 2 * Math.acos(Math.min(1, Math.abs(q.w))); if (a > ang) { ang = a; best = bn; } }
    if (!best || ang < 1e-4) return axis.invert ? axis.max : axis.min;
    const qt = m.get(best), q = this.boneByName.get(best).quaternion;
    const sw = q.w < 0 ? -1 : 1, st = qt.w < 0 ? -1 : 1;
    const a = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    const align = (q.x * sw) * (qt.x * st) + (q.y * sw) * (qt.y * st) + (q.z * sw) * (qt.z * st);
    const t = Math.max(0, Math.min(1, (align >= 0 ? a : -a) / ang));
    return (axis.invert ? 1 - t : t) * axis.max;
  }

  _setBlend(axis, v) {
    const t = axis.invert ? 1 - v / axis.max : v / axis.max;
    for (const id of axis.blend) for (const [bn, qt] of this.blendTargets(id)) this.boneByName.get(bn).quaternion.identity().slerp(qt, t);
  }

  resetControl(ctrl) { for (const n of ctrl.all || ctrl.bones) this.boneByName.get(n)?.quaternion.identity(); this._poseChanged(); }

  /** Copies a control's rotation to its mirror control (q -> (x,-y,-z,w)). */
  mirrorControl(ctrl) {
    const other = ctrl.mirror && this.controls.byId.get(ctrl.mirror);
    if (!other) return;
    const mine = ctrl.all || ctrl.bones, theirs = other.all || other.bones;
    mine.forEach((n, i) => {
      const a = this.boneByName.get(n), b = this.boneByName.get(theirs[i]);
      if (a && b) b.quaternion.set(a.quaternion.x, -a.quaternion.y, -a.quaternion.z, a.quaternion.w);
    });
    this._poseChanged();
  }

  /** Mirrors the whole pose left <-> right. */
  mirrorPose() {
    const qs = new Map(this.bones.map((b) => [b.name, b.quaternion.clone()]));
    for (const b of this.bones) {
      const other = b.name.endsWith('.L') ? b.name.slice(0, -2) + '.R' : b.name.endsWith('.R') ? b.name.slice(0, -2) + '.L' : b.name;
      const q = qs.get(other) || qs.get(b.name);
      b.quaternion.set(q.x, -q.y, -q.z, q.w);
    }
    this._poseChanged();
  }

  _poseChanged(notify = true) {
    const hips = this.bones[0];
    hips.position.copy(this.restPos[0]);
    hips.position.y += this.lift;
    this.root.updateMatrixWorld(true);
    this._skinned = null;
    if (notify) this.dispatchEvent({ type: 'pose' });
  }

  /** Drops the lowest point of the body to the floor (+ air meters above it). */
  dropToGround(air = 0) {
    this.lift = 0;
    this._poseChanged(false);
    const P = this.skinnedPositions();
    let mn = Infinity;
    for (let i = 1; i < P.length; i += 3) if (P[i] < mn) mn = P[i];
    const sc = this.root.scale.y || 1;
    this.lift = -mn + air / sc;
    this._poseChanged();
  }

  // ------------------------------------------------------------------ CPU skinning / picking
  /** Rig-space skinned positions of the body (cached until the pose changes). */
  skinnedPositions() {
    if (this._skinned) return this._skinned;
    const n = this.data.count, rest = this.data.rest, si = this.data.skin, sw = this.data.weight;
    const nb = this.bones.length;
    // bone matrices relative to the rig
    const M = this._mats || (this._mats = new Float32Array(nb * 12));
    this.rig.updateMatrixWorld(true);
    _inv.copy(this.rig.matrixWorld).invert();
    for (let i = 0; i < nb; i++) {
      _m.multiplyMatrices(_inv, this.bones[i].matrixWorld).multiply(this.inverses[i]);
      const e = _m.elements;
      M.set([e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]], i * 12);
    }
    const out = this._skinBuf || (this._skinBuf = new Float32Array(n * 3));
    for (let v = 0; v < n; v++) {
      const x = rest[v * 3], y = rest[v * 3 + 1], z = rest[v * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let k = 0; k < 4; k++) {
        const w = sw[v * 4 + k];
        if (!w) continue;
        const o = si[v * 4 + k] * 12, f = w / 255;
        ox += f * (M[o] * x + M[o + 3] * y + M[o + 6] * z + M[o + 9]);
        oy += f * (M[o + 1] * x + M[o + 4] * y + M[o + 7] * z + M[o + 10]);
        oz += f * (M[o + 2] * x + M[o + 5] * y + M[o + 8] * z + M[o + 11]);
      }
      out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz;
    }
    this._skinned = out;
    this._skinVer = (this._skinVer || 0) + 1;
    return out;
  }

  /** World-space bounding box of the posed body. */
  worldBox(box = new THREE.Box3()) {
    const P = this.skinnedPositions();
    if (this._lboxVer !== this._skinVer) { // rig-space box, cached with the skinned positions
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
      this._lbox = new THREE.Box3(new THREE.Vector3().fromArray(mn), new THREE.Vector3().fromArray(mx));
      this._lboxVer = this._skinVer;
    }
    this.root.updateMatrixWorld(true);
    return box.copy(this._lbox).applyMatrix4(this.rig.matrixWorld);
  }

  /**
   * Ray (world) against the posed body: {distance, point (world), face, bone, control} | null.
   */
  raycast(rayWorld) {
    this.rig.updateMatrixWorld(true);
    _inv.copy(this.rig.matrixWorld).invert();
    _ray.copy(rayWorld).applyMatrix4(_inv);
    const P = this.skinnedPositions();
    if (!this._box) this._box = new THREE.Box3();
    if (this._boxVer !== this._skinVer) {
      this._box.makeEmpty();
      for (let i = 0; i < P.length; i += 3) this._box.expandByPoint(_a.set(P[i], P[i + 1], P[i + 2]));
      this._boxVer = this._skinVer;
    }
    if (!_ray.intersectsBox(this._box)) return null;
    const I = this.data.index.array;
    let best = Infinity, face = -1;
    for (let t = 0; t < I.length; t += 3) {
      const ia = I[t] * 3, ib = I[t + 1] * 3, ic = I[t + 2] * 3;
      _a.set(P[ia], P[ia + 1], P[ia + 2]); _b.set(P[ib], P[ib + 1], P[ib + 2]); _c.set(P[ic], P[ic + 1], P[ic + 2]);
      const h = _ray.intersectTriangle(_a, _b, _c, true, _hit);
      if (!h) continue;
      const d = _hit.distanceToSquared(_ray.origin);
      if (d < best) { best = d; face = t / 3; }
    }
    if (face < 0) return null;
    // hit point back in world space
    const ia = I[face * 3];
    _ray.at(Math.sqrt(best), _hit);
    const point = _hit.clone().applyMatrix4(this.rig.matrixWorld);
    // dominant bone of the face
    const acc = new Map();
    for (let j = 0; j < 3; j++) {
      const v = I[face * 3 + j];
      for (let k = 0; k < 4; k++) { const w = this.data.weight[v * 4 + k]; if (w) { const b = this.data.skin[v * 4 + k]; acc.set(b, (acc.get(b) || 0) + w); } }
    }
    let bb = 0, bw = -1;
    for (const [b, w] of acc) if (w > bw) { bw = w; bb = b; }
    const bone = this.entry.bones[bb].name;
    void ia;
    return { animal: this, distance: point.distanceTo(rayWorld.origin), point, face, bone, control: this.controls.byBone.get(bone) || null };
  }

  /** World position of a bone pivot (or of a point between head and tail at t). */
  bonePoint(name, t = 0, out = new THREE.Vector3()) {
    const i = this.boneIndex.get(name);
    if (i === undefined) return out.setFromMatrixPosition(this.root.matrixWorld);
    const b = this.entry.bones[i];
    this.root.updateMatrixWorld(true);
    _m2.multiplyMatrices(this.bones[i].matrixWorld, this.inverses[i]);
    return out.set(b.head[0] + (b.tail[0] - b.head[0]) * t, b.head[1] + (b.tail[1] - b.head[1]) * t, b.head[2] + (b.tail[2] - b.head[2]) * t).applyMatrix4(_m2);
  }

  // ------------------------------------------------------------------ persistence
  toJSON() {
    const r = this.root;
    return {
      id: this.id, species: this.species, name: this.name,
      position: [r5(r.position.x), r5(r.position.y), r5(r.position.z)], rotationY: r5(r.rotation.y),
      palette: this.palette, color: this.customColor, size: r5(this.size), age: r5(this.age),
      pose: this.getPose(),
    };
  }

  /** In-place update from JSON (undo / redo). */
  fromJSON(j) {
    this.name = j.name || this.name;
    this.root.position.fromArray(j.position || [0, 0, 0]);
    this.root.rotation.y = j.rotationY || 0;
    const appearance = j.palette !== this.palette || (j.color || null) !== this.customColor;
    this.palette = j.palette || this.palette;
    this.customColor = j.color || null;
    if (appearance) this.applyAppearance();
    this.size = j.size ?? 1; this.age = j.age ?? 1;
    this.setPose(j.pose, false);
    this._applyScale();
  }

  dispose() {
    this.root.removeFromParent();
    materials.release(this.mesh);
    this.mesh.geometry.dispose(); // own colour attribute; shared buffers stay with the species cache
    for (const x of this.extras) { materials.release(x); x.geometry.dispose(); }
    this.skeleton.dispose();
  }
}

const r5 = (v) => Math.round(v * 1e5) / 1e5;

const eyeGeoCache = new Map();
function eyeGeometry(r) {
  const key = r.toFixed(5);
  let g = eyeGeoCache.get(key);
  if (g) return g;
  g = new THREE.SphereGeometry(r, 28, 20);
  // front planar projection: gaze axis = +Z = texture centre
  const p = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) / (2 * r), 0.5 + p.getY(i) / (2 * r));
  eyeGeoCache.set(key, g);
  return g;
}
function corneaGeometry(r) {
  return new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.45).rotateX(Math.PI / 2);
}
