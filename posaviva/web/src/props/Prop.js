// One prop instance: state (type, params, color, scale, placement, hand hold)
// and its scene graph:
//
//   root   (Group, userData.prop) placement: free -> parent app.world, position +
//          Euler YXZ + uniform scale; held -> parent = wrist bone, fist frame
//   pivot  (Group, manual matrix)  free hand props: lying/rest orientation, grounded;
//          held: grip adjustments (palm offset, flip, twist, slide, scale)
//   meshes one per material role (merged geometry), userData.prop = this
import * as THREE from 'three';
import { TYPE_BY_ID, ROLES, cleanParams } from './catalog.js';
import { mergeParts } from './geo.js';
import { loadModel, partSpec } from './models.js';

const DEG = Math.PI / 180;
let _uid = 0;
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4(), _mFreeInv = new THREE.Matrix4();
const _qd = new THREE.Quaternion();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());

const r4 = (x) => Math.round(x * 1e4) / 1e4;

export function newPropId() { return `p${Date.now().toString(36)}${(_uid++).toString(36)}`; }

/** Writes the 8 corners of box transformed by matrix into `_corners`. */
function boxCorners(box, matrix) {
  const { min, max } = box;
  let k = 0;
  for (let i = 0; i < 8; i++) _corners[k++].set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(matrix);
  return _corners;
}

export class Prop {
  /**
   * @param {*} materials material library
   * @param {{id?, type, params?, color?, scale?}} state
   */
  constructor(materials, state) {
    this.materials = materials;
    this.type = TYPE_BY_ID.get(state.type);
    if (!this.type) throw new Error(`Tipo di oggetto sconosciuto: ${state.type}`);
    this.id = state.id || newPropId();
    this.params = cleanParams(this.type, state.params);
    this.color = typeof state.color === 'string' ? state.color : this.type.color;
    this.scale = THREE.MathUtils.clamp(+state.scale || 1, 0.1, 5);
    /** hand hold: {ch, characterId, side, slide, twist, flip, scaleRef} or null */
    this.hold = null;
    /** grip adjustments remembered across detach / attach */
    this.grip = { slide: 0, twist: 0, flip: false };
    /** automatic twist around the handle (hanging props such as bags), radians */
    this.hangTwist = 0;
    /** room preset / group id (props added together, e.g. a furnished room) */
    this.group = typeof state.group === 'string' ? state.group : null;
    /** called when an asynchronously loaded model replaced the placeholder */
    this.onAsync = null;
    /** model types: true while the placeholder box is shown */
    this.loading = false;

    this.root = new THREE.Group();
    this.root.name = `prop:${this.type.id}`;
    this.root.rotation.order = 'YXZ';
    this.root.userData.prop = this;
    this.pivot = new THREE.Group();
    this.pivot.matrixAutoUpdate = false;
    this.root.add(this.pivot);
    /** @type {THREE.Mesh[]} */
    this.meshes = [];
    /** geometry bounds in pivot space */
    this.geoBox = new THREE.Box3();
    /** bounds in root space (geometry through the pivot), used by gizmos and grounding */
    this.localBox = new THREE.Box3();
    this._geoKey = null;
    this._colorKey = null;
    this.rebuild();
  }

  get isHand() { return !!this.type.hand; }

  /**
   * Mirror symmetry plane of the geometry (pivot space): {axis 0 = x, 1 = y,
   * 2 = z, c2 = twice the plane coordinate} or null. Cached per geometry. Used to turn a mirrored placement (right hand) into a proper one
   * that looks exactly the same.
   */
  mirrorPlane() {
    if (this.type.model) return null;
    if (this._symKey !== this._geoKey) { this._symKey = this._geoKey; this._sym = detectMirrorPlane(this.meshes, this.geoBox); }
    return this._sym;
  }
  get label() { return this.type.label; }

  // ------------------------------------------------------------ geometry & look
  /** Rebuilds meshes when params changed. Returns true if geometry was rebuilt. */
  rebuild(force = false) {
    const key = JSON.stringify(this.params);
    if (!force && key === this._geoKey) return false;
    this._geoKey = key;
    this._disposeMeshes();
    this.geoBox.makeEmpty();
    if (this.type.model) this._buildModel();
    else {
      const parts = this.type.build(this.params);
      // optional per-build material specs: {$specs: {role: spec | (color) => spec}}
      const specs = parts.$specs || null;
      for (const [role, list] of Object.entries(parts)) {
        if (role === '$specs') continue;
        const geo = mergeParts(list);
        if (!geo) continue;
        const mesh = this._addMesh(geo, role);
        if (specs && specs[role]) mesh.userData.spec = specs[role];
        this.geoBox.union(geo.boundingBox);
      }
    }
    this._colorKey = null;
    this.applyColor();
    this.updatePivot();
    return true;
  }

  _addMesh(geo, role) {
    const mesh = new THREE.Mesh(geo);
    mesh.name = `prop:${this.type.id}:${role}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.prop = this;
    mesh.userData.role = role;
    // e.g. the floor of a room: taps go through it (to characters / deselect)
    if (this.type.noPickRoles?.includes(role)) mesh.userData.noPick = true;
    this.pivot.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  /**
   * Realistic model types: shared GLB parts once loaded (cache), a translucent
   * placeholder box of the catalog size meanwhile. The rebuild runs again when
   * the file arrives and `onAsync` tells the manager.
   */
  _buildModel() {
    const entry = loadModel(this.type.model);
    if (entry.state === 'ready') {
      this.loading = false;
      entry.parts.forEach((part, i) => {
        const mesh = this._addMesh(part.geometry, `part${i}`);
        mesh.userData.sharedGeo = true;
        mesh.userData.part = part;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(part.matrix);
        mesh.matrixWorldNeedsUpdate = true;
        this.geoBox.union(part.box);
      });
      return;
    }
    const [w, h, d] = this.type.size || [0.4, 0.4, 0.4];
    const geo = new THREE.BoxGeometry(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d));
    geo.translate(0, h / 2, 0);
    geo.computeBoundingBox();
    const mesh = this._addMesh(geo, 'placeholder');
    mesh.castShadow = false;
    mesh.userData.spec = { kind: 'prop', color: '#9aa3ad', roughness: 0.9, transparent: true, opacity: 0.35 };
    this.geoBox.union(geo.boundingBox);
    if (entry.state === 'loading' && !this.loading) {
      this.loading = true;
      entry.promise.then(() => {
        this.loading = false;
        if (!this.meshes.length || this.meshes[0].userData.role !== 'placeholder') return; // disposed or rebuilt
        if (entry.state !== 'ready') return;
        this.rebuild(true);
        this.onAsync?.(this);
      });
    }
  }

  applyColor() {
    if (this._colorKey === this.color) return;
    this._colorKey = this.color;
    for (const mesh of this.meshes) {
      const u = mesh.userData;
      let spec;
      if (u.part) spec = partSpec(u.part, this.color);
      else if (u.spec) spec = typeof u.spec === 'function' ? u.spec(this.color) : u.spec;
      else spec = (ROLES[u.role] || ROLES.main)(this.color);
      this.materials.apply(mesh, spec);
    }
  }

  setParams(patch) {
    this.params = cleanParams(this.type, { ...this.params, ...patch });
    return this.rebuild();
  }

  setColor(c) { this.color = c; this.applyColor(); }

  // ------------------------------------------------------------ placement
  /** Pivot matrix for the current mode (free / held) + root-space bounds. */
  updatePivot() {
    const m = this.pivot.matrix;
    const hand = this.type.hand;
    if (this.hold) {
      // palm offset (handle radius) * flip * twist * scale * slide along the handle
      const g = this.grip, s = this.scale;
      m.makeTranslation(hand.radius * s, 0, 0);
      if (g.flip) m.multiply(_m.makeRotationZ(Math.PI));
      if (g.twist || this.hangTwist) m.multiply(_m.makeRotationY(g.twist + this.hangTwist));
      m.multiply(_m.makeScale(s, s, s));
      if (g.slide) m.multiply(_m.makeTranslation(0, -g.slide, 0));
    } else if (hand) {
      // rest orientation, then center the footprint on the origin and sit on y = 0
      const [rx, ry, rz] = hand.rest(this.params);
      _q.setFromEuler(_e.set(rx * DEG, ry * DEG, rz * DEG, 'XYZ'));
      _m.makeRotationFromQuaternion(_q);
      let minY = Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const c of boxCorners(this.geoBox, _m)) {
        minY = Math.min(minY, c.y); minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
      }
      m.makeTranslation(-(minX + maxX) / 2, -minY, -(minZ + maxZ) / 2).multiply(_m);
    } else {
      m.identity();
    }
    this.pivot.matrixWorldNeedsUpdate = true;
    this.localBox.makeEmpty();
    if (!this.geoBox.isEmpty()) for (const c of boxCorners(this.geoBox, m)) this.localBox.expandByPoint(c);
  }

  /** Free placement from plain arrays. */
  setFree(pos, rot) {
    if (pos) this.root.position.set(+pos[0] || 0, +pos[1] || 0, +pos[2] || 0);
    if (rot) this.root.rotation.set(+rot[0] || 0, +rot[1] || 0, +rot[2] || 0, 'YXZ');
    this.root.scale.setScalar(this.scale);
  }

  get yaw() { return this.root.rotation.y; }
  get tilted() { return Math.abs(this.root.rotation.x) > 1e-3 || Math.abs(this.root.rotation.z) > 1e-3; }

  /** World matrix of the visible content (root * pivot) — used to keep the look on detach. */
  contentWorldMatrix(target) {
    this.root.updateWorldMatrix(true, false);
    return target.multiplyMatrices(this.root.matrixWorld, this.pivot.matrix);
  }

  /** Lowest world Y of the actual geometry (exact, vertex loop). */
  worldMinY() {
    this.root.updateWorldMatrix(true, true);
    let minY = Infinity;
    for (const mesh of this.meshes) {
      const a = mesh.geometry.attributes.position, e = mesh.matrixWorld.elements;
      for (let i = 0; i < a.count; i++) {
        const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
        const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
        if (wy < minY) minY = wy;
      }
    }
    return minY;
  }

  /** World AABB from the root-space bounds (cheap; used for overlap tests). */
  worldBox(target) {
    this.root.updateWorldMatrix(true, false);
    target.makeEmpty();
    if (!this.localBox.isEmpty()) for (const c of boxCorners(this.localBox, this.root.matrixWorld)) target.expandByPoint(c);
    return target;
  }

  /** Corners of the root-space bounds in world space (shared array, valid until the next call). */
  worldCorners() {
    this.root.updateWorldMatrix(true, false);
    return boxCorners(this.localBox, this.root.matrixWorld);
  }

  /** Half diagonal of the footprint (x/z), in meters, scale included (free props). */
  footprintRadius() {
    const b = this.localBox;
    if (b.isEmpty()) return 0.2;
    return 0.5 * Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) * this.scale;
  }

  // ------------------------------------------------------------ persistence
  toJSON() {
    const j = { id: this.id, type: this.type.id, params: { ...this.params }, color: this.color, scale: r4(this.scale) };
    if (this.hold) {
      // world placement is stored too, as a fallback when the character is gone
      this.contentWorldMatrix(_m2);
      freeFromContentMatrix(this, _m2, _p, _e);
      j.pos = [r4(_p.x), r4(_p.y), r4(_p.z)];
      j.rot = [r4(_e.x), r4(_e.y), r4(_e.z)];
      j.hold = { characterId: this.hold.characterId, side: this.hold.side };
    } else {
      const p = this.root.position, r = this.root.rotation;
      j.pos = [r4(p.x), r4(p.y), r4(p.z)];
      j.rot = [r4(r.x), r4(r.y), r4(r.z)];
    }
    const g = this.grip;
    if (g.slide || g.twist || g.flip) j.grip = { slide: r4(g.slide), twist: r4(g.twist), flip: !!g.flip };
    if (this.group) j.group = this.group;
    return j;
  }

  dispose() {
    this._disposeMeshes();
    this.root.removeFromParent();
  }

  _disposeMeshes() {
    for (const mesh of this.meshes) {
      this.materials.release(mesh);
      if (!mesh.userData.sharedGeo) mesh.geometry.dispose(); // model geometry is shared by every instance
      mesh.removeFromParent();
    }
    this.meshes.length = 0;
  }
}

/**
 * Converts a world matrix of the visible content into a free placement
 * (root position + Euler YXZ) given the prop's free pivot (rest transform):
 * root = content * inverse(pivotFree). Mirroring and the character scale are
 * dropped (free props use a positive uniform scale).
 */
export function freeFromContentMatrix(prop, content, outPos, outEuler) {
  // pivot of the free mode
  // (updatePivot() uses the module temporaries _m/_q: keep the inverse in its own matrix)
  const held = prop.hold;
  prop.hold = null;
  prop.updatePivot();
  _mFreeInv.copy(prop.pivot.matrix).invert();
  prop.hold = held;
  prop.updatePivot();
  if (content !== _m2) _m2.copy(content);
  // A mirrored frame (right hand) cannot be a free placement. Reflecting the
  // geometry across its own symmetry plane gives a proper transform with the
  // very same look (a cup keeps its handle side, a phone its screen side).
  // Without a symmetry plane the mirror on X is dropped by decompose().
  if (_m2.determinant() < 0) {
    const sym = prop.mirrorPlane();
    if (sym) {
      _m3.identity();
      _m3.elements[sym.axis * 5] = -1; // diagonal entry of the axis
      _m3.elements[12 + sym.axis] = sym.c2; // x' = 2·plane - x along the axis
      _m2.multiply(_m3);
    }
  }
  _m2.multiply(_mFreeInv);
  _m2.decompose(outPos, _qd, _s);
  outEuler.setFromQuaternion(_qd, 'YXZ');
  return outPos;
}

/**
 * Finds a mirror symmetry of the merged prop geometry: for x, z then y, and a
 * plane through the middle of the bounds or through the origin, the vertices
 * reflected across the plane must land on other vertices (within ~2 mm) for at
 * least 98% of a sample. Returns {axis, c2} (c2 = twice the plane coordinate)
 * of the best match, or null.
 */
function detectMirrorPlane(meshes, box) {
  if (box.isEmpty()) return null;
  const Q = 0.0015, cells = new Set();
  const key = (x, y, z) => `${x},${y},${z}`;
  const pts = [];
  for (const mesh of meshes) {
    const a = mesh.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      cells.add(key(Math.round(a[i] / Q), Math.round(a[i + 1] / Q), Math.round(a[i + 2] / Q)));
      pts.push(a[i], a[i + 1], a[i + 2]);
    }
  }
  const n = pts.length / 3, stride = Math.max(1, Math.floor(n / 1500));
  const found = (x, y, z) => {
    const ix = Math.round(x / Q), iy = Math.round(y / Q), iz = Math.round(z / Q);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (cells.has(key(ix + dx, iy + dy, iz + dz))) return true;
    return false;
  };
  const p = [0, 0, 0];
  let best = null, bestRatio = 0.98;
  for (const axis of [0, 2, 1]) {
    const mid = box.min.getComponent(axis) + box.max.getComponent(axis);
    for (const c2 of Math.abs(mid) > 1e-4 ? [mid, 0] : [0]) {
      let ok = 0, tot = 0;
      for (let i = 0; i < n; i += stride) {
        p[0] = pts[i * 3]; p[1] = pts[i * 3 + 1]; p[2] = pts[i * 3 + 2];
        p[axis] = c2 - p[axis];
        tot++;
        if (found(p[0], p[1], p[2])) ok++;
      }
      if (tot && ok / tot > bestRatio + 1e-9) { bestRatio = ok / tot; best = { axis, c2 }; }
    }
  }
  return best;
}

