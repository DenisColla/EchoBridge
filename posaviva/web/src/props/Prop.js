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

const DEG = Math.PI / 180;
let _uid = 0;
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
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
  get label() { return this.type.label; }

  // ------------------------------------------------------------ geometry & look
  /** Rebuilds meshes when params changed. Returns true if geometry was rebuilt. */
  rebuild(force = false) {
    const key = JSON.stringify(this.params);
    if (!force && key === this._geoKey) return false;
    this._geoKey = key;
    this._disposeMeshes();
    const parts = this.type.build(this.params);
    this.geoBox.makeEmpty();
    for (const [role, list] of Object.entries(parts)) {
      const geo = mergeParts(list);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo);
      mesh.name = `prop:${this.type.id}:${role}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.prop = this;
      mesh.userData.role = role;
      this.pivot.add(mesh);
      this.meshes.push(mesh);
      this.geoBox.union(geo.boundingBox);
    }
    this._colorKey = null;
    this.applyColor();
    this.updatePivot();
    return true;
  }

  applyColor() {
    if (this._colorKey === this.color) return;
    this._colorKey = this.color;
    for (const mesh of this.meshes) this.materials.apply(mesh, (ROLES[mesh.userData.role] || ROLES.main)(this.color));
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
    return j;
  }

  dispose() {
    this._disposeMeshes();
    this.root.removeFromParent();
  }

  _disposeMeshes() {
    for (const mesh of this.meshes) {
      this.materials.release(mesh);
      mesh.geometry.dispose();
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
  const held = prop.hold;
  prop.hold = null;
  prop.updatePivot();
  _m.copy(prop.pivot.matrix).invert();
  prop.hold = held;
  prop.updatePivot();
  _m2.multiplyMatrices(content, _m);
  _m2.decompose(outPos, _q, _s);
  // a mirrored frame (right hand) decomposes with sx < 0: drop the mirror on X
  outEuler.setFromQuaternion(_q, 'YXZ');
  return outPos;
}

