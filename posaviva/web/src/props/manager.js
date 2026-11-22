// PropManager: owns every prop of the scene (creation, selection, placement,
// hand holds, persistence, picking). UI-free: the panel and the gizmo talk to
// it and listen to its events:
//   'list'   props added / removed
//   'select' {prop}  selection changed
//   'change' {prop}  a prop's state changed (placement, params, color, hold)
import * as THREE from 'three';
import { Prop, freeFromContentMatrix } from './Prop.js';
import { TYPE_BY_ID, defaultParams, cleanParams } from './catalog.js';
import { newSeed } from './params.js';
import { fistFrame, wrapHand } from './grip.js';

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _p = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _box = new THREE.Box3(), _box2 = new THREE.Box3();
const _ray2 = new THREE.Ray();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _hit = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _down = new THREE.Vector3(0, -1, 0);

export const SIDE_LABEL = { L: 'sinistra', R: 'destra' };

export class PropManager extends THREE.EventDispatcher {
  constructor(app) {
    super();
    this.app = app;
    /** @type {Prop[]} */
    this.props = [];
    /** @type {Prop|null} */
    this.selected = null;
    this.raycaster = new THREE.Raycaster();
    /** room presets: dragging / turning one piece moves the whole group */
    this.moveTogether = false;
    this._meshes = [];
    this._meshesDirty = true;
    // the pose library (hand presets) is written in parallel: feature-detect it
    this.handLib = null;
    import('../pose/library.js').then((m) => { this.handLib = m; }).catch(() => { this.handLib = null; });
  }

  byId(id) { return this.props.find((p) => p.id === id) || null; }
  get heldProps() { return this.props.filter((p) => p.hold); }

  // ------------------------------------------------------------ ground
  /**
   * Floor height at world (x, z): the ready landscape's ground (terrain, roof or
   * pier decks, app.landscapes.heightAt) or 0 (studio floor).
   */
  floorAt(x, z) {
    const L = this.app.landscapes;
    if (!L?.heightAt) return 0;
    const y = L.heightAt(x, z);
    return Number.isFinite(y) ? y : 0;
  }

  /**
   * Floor height under a free prop: at the centre of its footprint, or with
   * {lowest: true} the lowest of the centre and the 4 footprint corners (big
   * items such as buildings sit on the downhill side, the uphill side is buried).
   */
  floorUnder(p, { lowest = false } = {}) {
    const f = this._footprint(p, p.root.position, p.yaw, this._fu || (this._fu = {}));
    let y = this.floorAt(f.cx, f.cz);
    if (lowest && this.app.landscapes?.current) {
      for (const [a, b] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const lx = a * f.hx, lz = b * f.hz;
        y = Math.min(y, this.floorAt(f.cx + lx * f.c + lz * f.s, f.cz - lx * f.s + lz * f.c));
      }
    }
    return y;
  }

  // ------------------------------------------------------------ lifecycle
  /**
   * Creates a prop from a state object and puts it in the world (no undo step).
   * opts: {emit = false: announce it ('list' + 'change' events, as add() does),
   * select = false, ground = false: land it on the floor / the prop under it}.
   */
  create(state, { emit = false, select = false, ground = false } = {}) {
    const p = new Prop(this.app.materials, state);
    if (state.grip) Object.assign(p.grip, { slide: +state.grip.slide || 0, twist: +state.grip.twist || 0, flip: !!state.grip.flip });
    p.setFree(state.pos, state.rot);
    p.onAsync = (q) => this._onModelLoaded(q);
    this.app.world.add(p.root);
    this.props.push(p);
    this._meshesDirty = true;
    if (ground) this.ground(p);
    if (emit) this._changed(p, 'list');
    if (select) this.select(p);
    return p;
  }

  /** A realistic model finished loading (placeholder replaced): refresh picking, shadows, UI. */
  _onModelLoaded(p) {
    if (!this.props.includes(p)) return;
    this._meshesDirty = true;
    if (p.hold) this.refreshHold(p);
    this._changed(p);
  }

  /**
   * Adds a new prop of `typeId` next to `near` (a character) or the view
   * center. Hand props go straight into a free hand of `near`.
   */
  add(typeId, { near = null, select = true } = {}) {
    const type = TYPE_BY_ID.get(typeId);
    if (!type) return null;
    const p = this.create({ type: typeId, params: defaultParams(type), color: type.color });
    let held = false;
    if (type.hand && near) {
      const side = this.freeHand(near);
      if (side) held = this.attach(p, near, side, { pose: true, emit: false });
    }
    if (!held) {
      this._spawn(p, near);
      // wall / ceiling items start at their usual height
      if (Number.isFinite(type.spawnY)) p.root.position.y = this.floorUnder(p) + type.spawnY;
      if (type.lieRot) {
        const D = Math.PI / 180;
        p.root.rotation.set(type.lieRot[0] * D, p.root.rotation.y, type.lieRot[2] * D, 'YXZ');
        this.ground(p);
      }
    }
    this._changed(p, 'list');
    if (select) this.select(p);
    return p;
  }

  /**
   * Adds a furnished room preset (gen/rooms.js) as a group of props. The room
   * is centered so that `near` (a character) stands in its open front part, or
   * at the view center. The pieces are built over several frames (~12 ms each)
   * so the UI never freezes; resolves with the created props.
   */
  async addPreset(preset, { near = null, select = true } = {}) {
    const group = `g${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const base = new THREE.Vector3();
    if (near) { near.root.updateWorldMatrix(true, false); base.setFromMatrixPosition(near.root.matrixWorld); base.z -= Math.max(0, (preset.size?.[1] || 4) / 2 - 1.1); }
    else base.set(this.app.controls.target.x, 0, this.app.controls.target.z);
    base.y = this.floorAt(base.x, base.z); // on a landscape: its ground under the room
    const created = [];
    let t0 = performance.now();
    for (const it of preset.items()) {
      const type = TYPE_BY_ID.get(it.type);
      if (!type) continue;
      if (performance.now() - t0 > 12) {
        this._meshesDirty = true;
        this._changed(null, 'list');
        await new Promise((r) => requestAnimationFrame(() => r()));
        t0 = performance.now();
      }
      const params = cleanParams(type, { ...defaultParams(type), ...(it.params || {}) });
      const p = this.create({ type: it.type, params, color: it.color || type.color, group });
      const yaw = ((it.yaw || 0) * Math.PI) / 180;
      p.root.rotation.set(0, yaw, 0, 'YXZ');
      p.root.position.set(0, 0, 0);
      p.root.updateWorldMatrix(true, false);
      // anchor the rotated footprint: ax/az = -1 min side, 0 center, 1 max side
      p.worldBox(_box);
      const ax = it.ax || 0, az = it.az || 0;
      const fx = ax < 0 ? _box.min.x : ax > 0 ? _box.max.x : (_box.min.x + _box.max.x) / 2;
      const fz = az < 0 ? _box.min.z : az > 0 ? _box.max.z : (_box.min.z + _box.max.z) / 2;
      const [x, y, z] = it.pos || [0, 0, 0];
      p.root.position.set(base.x + x - fx, base.y + y, base.z + z - fz);
      created.push(p);
    }
    // pieces removed meanwhile (undo during the build) are dropped from the result
    const alive = created.filter((p) => this.props.includes(p));
    this._meshesDirty = true;
    this._changed(null, 'list');
    if (select && alive.length) this.select(alive.find((q) => q.type.id !== 'stanza' && q.type.id !== 'pavimento') || alive[0]);
    return alive;
  }

  /** Props of the same group (room preset) as p, p included. */
  groupOf(p) { return p?.group ? this.props.filter((q) => q.group === p.group) : p ? [p] : []; }

  /** Removes every prop of p's group. */
  removeGroup(p) {
    const list = this.groupOf(p);
    for (const q of list) { const i = this.props.indexOf(q); if (i >= 0) this.props.splice(i, 1); q.dispose(); }
    this._meshesDirty = true;
    if (list.includes(this.selected)) this.select(null);
    this._changed(null, 'list');
  }

  /** Detaches p from its group (it becomes an independent prop). */
  ungroup(p) { if (p?.group) { p.group = null; this._changed(p); } }

  /** New random variant of a type with a 'seed' parameter. */
  regenerate(p) {
    if (!p.type.params.some((d) => d.type === 'seed')) return false;
    this.setParams(p, { seed: newSeed() });
    return true;
  }

  remove(p) {
    const i = this.props.indexOf(p);
    if (i < 0) return;
    this.props.splice(i, 1);
    p.dispose();
    this._meshesDirty = true;
    if (this.selected === p) this.select(null);
    this._changed(null, 'list');
  }

  duplicate(p) {
    const j = p.toJSON();
    delete j.id; delete j.hold;
    const q = this.create(j);
    if (p.hold) q.root.rotation.set(0, q.root.rotation.y, 0, 'YXZ');
    // next to the original (its right, then left, behind, front …), on the same level
    // (above its own floor: on a landscape the ground may be higher or lower there)
    const rel = p.hold ? 0 : q.root.position.y - this.floorUnder(p);
    this._spawn(q, p.hold ? p.hold.ch : null, p.hold ? null : p);
    q.root.position.y = this.floorUnder(q) + rel;
    if (p.hold) this.ground(q, { straighten: true });
    this._changed(q, 'list');
    this.select(q);
    return q;
  }

  /**
   * Copies the props held by character `src` into the same hands of `dst`
   * (a duplicated character with the same pose: the fingers already grip).
   * No undo step. Returns the number of props copied.
   */
  copyHeld(src, dst) {
    let n = 0;
    for (const p of [...this.props]) {
      if (!p.hold || p.hold.ch !== src) continue;
      const j = p.toJSON();
      delete j.id; delete j.hold;
      const q = this.create(j);
      if (!this.attach(q, dst, p.hold.side, { pose: false, emit: false })) q.root.position.y = Math.max(this.floorUnder(q), q.root.position.y);
      n++;
    }
    if (n) this._changed(null, 'list');
    return n;
  }

  clear() {
    for (const p of [...this.props]) p.dispose();
    this.props.length = 0;
    this._meshesDirty = true;
    this.select(null);
    this._changed(null, 'list');
  }

  select(p) {
    if (p && !this.props.includes(p)) p = null;
    if (this.selected === p) return;
    this.selected = p;
    this.dispatchEvent({ type: 'select', prop: p });
    this.app.invalidate();
  }

  // ------------------------------------------------------------ placement
  /**
   * Free placement on the floor next to a character (its right, left, back,
   * front, then wider rings) or next to another prop / the view center, facing
   * the same way. Spots are tested with oriented footprint rectangles against
   * free props and with circles against characters. A wall goes behind the
   * character as a backdrop.
   */
  _spawn(p, ch, nearProp = null) {
    let yaw = 0, baseR = 0;
    if (ch) {
      ch.root.updateWorldMatrix(true, false);
      _v2.setFromMatrixPosition(ch.root.matrixWorld);
      yaw = ch.root.rotation.y;
      baseR = 0.3 * (ch.root.scale.x || 1);
    } else if (nearProp) {
      const f = this._footprint(nearProp, nearProp.root.position, nearProp.yaw);
      _v2.set(f.cx, 0, f.cz);
      yaw = nearProp.yaw;
      baseR = Math.max(f.hx, f.hz);
    } else _v2.set(this.app.controls.target.x, 0, this.app.controls.target.z);
    _v2.y = 0;
    const own = this._footprint(p, _p.set(0, 0, 0), 0); // local extents (centered on the origin, unrotated)
    const hx = own.hx, hz = own.hz, gap = p.type.id === 'muro' ? 0.4 : 0.1; // room for the arms in front of a wall
    // directions in the base frame (+X = character's left, +Z = front): right, left, back, front, diagonals
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    const cands = [];
    if (p.type.id === 'muro') for (let ring = 0; ring < 6; ring++) cands.push([0, -1, ring]); // backdrop: behind first
    for (let ring = 0; ring < 7; ring++) for (const [dx, dz] of dirs) cands.push([dx, dz, ring]);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    let found = false;
    const tryAt = (lx, lz) => {
      // local offset -> world (rotation about Y by yaw), minus the prop's own local center
      const x = _v2.x + lx * cy + lz * sy - (own.cx * cy + own.cz * sy);
      const z = _v2.z - lx * sy + lz * cy - (-own.cx * sy + own.cz * cy);
      _p.set(x, 0, z);
      return this._fits(p, _p, yaw, ch);
    };
    if (!ch && !nearProp && tryAt(0, 0)) found = true;
    for (let k = 0; k < cands.length && !found; k++) {
      const [dx, dz, ring] = cands[k];
      const n = Math.hypot(dx, dz);
      const ex = Math.abs(dx / n) * hx + Math.abs(dz / n) * hz; // own extent along the direction
      const d = baseR + gap + ex + ring * 0.4;
      found = tryAt((dx / n) * d, (dz / n) * d);
    }
    if (!found) tryAt(-(baseR + gap + hx), 0); // crowded scene: right side anyway
    p.root.position.copy(_p);
    p.root.rotation.set(0, yaw, 0, 'YXZ');
    p.root.scale.setScalar(p.scale);
    // on the floor (a landscape's terrain, roof or pier under the footprint centre)
    p.root.position.y = this.floorUnder(p);
  }

  /** Footprint rectangle (x/z) of a free prop placed at pos with yaw: center, half extents, cos/sin. */
  _footprint(p, pos, yaw, out = {}) {
    const b = p.localBox, s = p.scale;
    const lcx = b.isEmpty() ? 0 : ((b.min.x + b.max.x) / 2) * s, lcz = b.isEmpty() ? 0 : ((b.min.z + b.max.z) / 2) * s;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    out.cx = pos.x + lcx * c + lcz * sn;
    out.cz = pos.z - lcx * sn + lcz * c;
    out.hx = b.isEmpty() ? 0.15 : ((b.max.x - b.min.x) / 2) * s;
    out.hz = b.isEmpty() ? 0.15 : ((b.max.z - b.min.z) / 2) * s;
    out.c = c; out.s = sn;
    return out;
  }

  /** True if prop p at (pos, yaw) overlaps no free prop and no character (except ignoreCh). */
  _fits(p, pos, yaw, ignoreCh) {
    const A = this._footprint(p, pos, yaw, this._fa || (this._fa = {}));
    A.hx += 0.04; A.hz += 0.04; // small clearance
    for (const q of this.props) {
      if (q === p || q.hold || !q.root.visible) continue;
      const B = this._footprint(q, q.root.position, q.yaw, this._fb || (this._fb = {}));
      if (obbOverlap(A, B)) return false;
    }
    for (const ch of this.app.characters) {
      if (ch === ignoreCh || !ch.root.visible) continue;
      const cp = ch.root.position, r = 0.28 * (ch.root.scale.x || 1);
      // circle vs rectangle: closest point of the rectangle in its local frame
      const dx = cp.x - A.cx, dz = cp.z - A.cz;
      const lx = dx * A.c - dz * A.s, lz = dx * A.s + dz * A.c;
      const qx = Math.max(-A.hx, Math.min(A.hx, lx)), qz = Math.max(-A.hz, Math.min(A.hz, lz));
      if ((lx - qx) ** 2 + (lz - qz) ** 2 < r * r) return false;
    }
    return true;
  }

  /** Other members of p's group when "move together" is on (room presets). */
  _mates(p) { return this.moveTogether && p.group && !p.hold ? this.props.filter((q) => q !== p && q.group === p.group && !q.hold) : null; }

  setYaw(p, yaw) {
    const mates = this._mates(p);
    const nyaw = wrapAngle(yaw), d = nyaw - p.root.rotation.y;
    if (mates && Math.abs(d) > 1e-9) {
      // the whole group turns around this prop's position
      const c = Math.cos(d), sn = Math.sin(d), o = p.root.position;
      for (const q of mates) {
        const dx = q.root.position.x - o.x, dz = q.root.position.z - o.z;
        q.root.position.x = o.x + dx * c + dz * sn;
        q.root.position.z = o.z - dx * sn + dz * c;
        q.root.rotation.y = wrapAngle(q.root.rotation.y + d);
      }
    }
    p.root.rotation.y = nyaw;
    this._changed(p);
  }
  setTilt(p, x, z) { p.root.rotation.x = x; p.root.rotation.z = z; this._changed(p); }
  setHeight(p, y) {
    const mates = this._mates(p);
    if (mates) for (const q of mates) q.root.position.y += y - p.root.position.y;
    p.root.position.y = y;
    this._changed(p);
  }
  moveTo(p, x, z) {
    const mates = this._mates(p);
    if (mates) for (const q of mates) { q.root.position.x += x - p.root.position.x; q.root.position.z += z - p.root.position.z; }
    p.root.position.x = x; p.root.position.z = z;
    this._changed(p);
  }

  setScale(p, s) {
    p.scale = THREE.MathUtils.clamp(s, 0.1, 5);
    if (p.hold) p.updatePivot(); else p.root.scale.setScalar(p.scale);
    this._changed(p);
  }

  setParams(p, patch) {
    const floor = p.hold ? 0 : this.floorUnder(p);
    const before = p.hold ? null : p.worldMinY();
    if (p.setParams(patch)) this._meshesDirty = true;
    // keep standing on whatever it stood on (e.g. after changing a stool height)
    if (!p.hold && Math.abs(before - floor) < 0.005) p.root.position.y += floor - p.worldMinY();
    this._changed(p);
  }

  setColor(p, c) { p.setColor(c); this._changed(p); }

  setGrip(p, patch) {
    Object.assign(p.grip, patch);
    if (p.hold) p.updatePivot();
    this._changed(p);
  }

  /** Removes the tilt keeping the yaw; hand props return to their resting orientation. */
  straighten(p) {
    if (p.hold) return;
    p.root.rotation.set(0, p.root.rotation.y, 0, 'YXZ');
    this._changed(p);
  }

  /**
   * Lands the prop on the highest surface below it (another prop's top) or on
   * the floor (a landscape's ground under its centre, else y = 0). Returns the
   * support prop or null (floor).
   */
  ground(p, { straighten = false } = {}) {
    if (p.hold) return null;
    if (straighten) p.root.rotation.set(0, p.root.rotation.y, 0, 'YXZ');
    const minY = p.worldMinY();
    if (!Number.isFinite(minY)) return null;
    // probe straight down from a few footprint points, starting a little above
    // the bottom (tolerates a prop slightly sunk into its support)
    const others = [];
    for (const q of this.props) {
      if (q === p || q.hold || !q.root.visible) continue;
      q.root.updateWorldMatrix(true, true); // props placed since the last frame: current matrices for the rays
      others.push(...q.meshes);
    }
    p.worldBox(_box);
    let support = null, top = this.floorAt((_box.min.x + _box.max.x) / 2, (_box.min.z + _box.max.z) / 2);
    if (others.length) {
      const y0 = minY + Math.max(0.02, (_box.max.y - minY) * 0.25);
      const cx = (_box.min.x + _box.max.x) / 2, cz = (_box.min.z + _box.max.z) / 2;
      const hx = (_box.max.x - _box.min.x) * 0.3, hz = (_box.max.z - _box.min.z) * 0.3;
      const rc = this.raycaster;
      for (const [ox, oz] of [[0, 0], [hx, hz], [-hx, hz], [hx, -hz], [-hx, -hz]]) {
        rc.set(_v.set(cx + ox, y0, cz + oz), _down);
        rc.far = 50;
        const hit = rc.intersectObjects(others, false)[0];
        if (hit && hit.point.y > top) { top = hit.point.y; support = hit.object.userData.prop; }
      }
      rc.far = Infinity;
    }
    p.root.position.y += top - minY;
    this._changed(p);
    return support;
  }

  // ------------------------------------------------------------ hands
  /** 'R' or 'L' if that hand of ch holds nothing (right first), else null. */
  freeHand(ch) {
    for (const side of ['R', 'L']) if (!this.props.some((q) => q.hold && q.hold.ch === ch && q.hold.side === side)) return side;
    return null;
  }

  heldBy(ch, side) { return this.props.find((q) => q.hold && q.hold.ch === ch && q.hold.side === side) || null; }

  /**
   * Puts a prop into a character's hand (parented to the wrist bone, fist frame
   * computed from the hand joints). opts.pose: close the fingers around it.
   * Another prop already in that hand is laid down on the floor.
   */
  attach(p, ch, side, { pose = true, emit = true } = {}) {
    if (!p.isHand || !ch) return false;
    const bone = ch.boneByName.get(`wrist.${side}`);
    if (!bone || !fistFrame(ch, side, _m)) return false;
    const other = this.heldBy(ch, side);
    if (other && other !== p) this.detach(other, { ground: true, emit });
    p.hold = { ch, characterId: ch.id, side, scaleRef: 0 };
    delete p.pendingHold;
    bone.add(p.root);
    this.refreshHold(p);
    if (pose) this.closeHand(p);
    if (emit) this._changed(p);
    return true;
  }

  /** Recomputes the root transform of a held prop from the current hand shape. */
  refreshHold(p) {
    const h = p.hold;
    if (!h || !fistFrame(h.ch, h.side, _m)) return;
    const s = h.ch.root.scale.x || 1;
    h.scaleRef = s;
    _m.multiply(_m2.makeScale(1 / s, 1 / s, 1 / s)); // props keep their real size on scaled characters
    _m.decompose(p.root.position, p.root.quaternion, p.root.scale);
    p.updatePivot();
    if (p.type.hand.hang) this._hang(p);
    p.root.updateMatrixWorld(true);
  }

  /**
   * Closes the holding hand around the prop: the fingers wrap the actual
   * handle radius (adaptive solver). A matching pose-library hand preset, when
   * available, is used as the starting pose (finger spread, thumb opposition).
   * Returns true on success.
   */
  closeHand(p) {
    const h = p.hold, hand = p.type.hand;
    if (!h) return false;
    const lib = this.handLib, presets = lib?.HAND_PRESETS;
    const id = Array.isArray(presets) && typeof lib.applyHandPreset === 'function' ? hand.presets.find((x) => presets.some((q) => q.id === x)) : null;
    const base = id ? () => { try { lib.applyHandPreset(h.ch, id, h.side); } catch (e) { console.warn('[props] hand preset failed', e); } } : null;
    const thumb = hand.thumb ? hand.thumb.map((v) => v * p.scale) : null;
    return wrapHand(h.ch, h.side, (hand.wrap ?? hand.radius) * p.scale, { base, thumb });
  }

  /**
   * Releases a held prop into the world. Default keeps its world placement;
   * ground: lay it down on the floor in its resting orientation.
   */
  detach(p, { ground = false, emit = true } = {}) {
    if (!p.hold) return;
    p.contentWorldMatrix(_m);
    freeFromContentMatrix(p, _m, _p, _e);
    p.hold = null;
    p.hangTwist = 0;
    p.updatePivot();
    this.app.world.add(p.root);
    // into app.world's space (identity in practice)
    this.app.world.updateWorldMatrix(true, false);
    _m2.copy(this.app.world.matrixWorld).invert();
    _p.applyMatrix4(_m2);
    p.root.position.copy(_p);
    p.root.rotation.copy(_e);
    p.root.scale.setScalar(p.scale);
    p.root.updateMatrixWorld(true);
    if (ground) this.ground(p, { straighten: true });
    if (emit) this._changed(p);
  }

  /** Characters: a shape change moves the hand joints; a removed character drops its props. */
  onCharacterShape(ch) {
    for (const p of this.props) if (p.hold && p.hold.ch === ch) this.refreshHold(p);
  }

  /** Pose changed: hanging props (bags) swing around their handle to keep pointing down. */
  onCharacterPose(ch) {
    for (const p of this.props) if (p.hold && p.hold.ch === ch && p.type.hand.hang) this._hang(p);
  }

  /**
   * Twist around the handle axis so that the prop's +Z (the side hanging from
   * the handle) points as much downward as the handle allows (gravity).
   */
  _hang(p) {
    const h = p.hold;
    const wrist = h.ch.boneByName.get(`wrist.${h.side}`);
    if (!wrist) return;
    wrist.updateWorldMatrix(true, false);
    _m.multiplyMatrices(wrist.matrixWorld, _m2.compose(p.root.position, p.root.quaternion, p.root.scale)); // fist frame, world
    if (p.grip.flip) _m.multiply(_m2.makeRotationZ(Math.PI));
    _v.set(0, -1, 0).transformDirection(_m2.copy(_m).invert()); // world down in fist coordinates (normalized)
    const horiz = Math.hypot(_v.x, _v.z);
    if (horiz < 0.08) return; // handle (almost) vertical: any twist hangs the same
    const t = Math.atan2(_v.x, _v.z) - p.grip.twist;
    if (Math.abs(wrapAngle(t - p.hangTwist)) < 1e-4) return;
    p.hangTwist = wrapAngle(t);
    p.updatePivot();
    this.app.invalidate();
  }

  onCharacterRemoved(ch) {
    for (const p of this.props) if (p.hold && p.hold.ch === ch) this.detach(p, { ground: true });
  }

  /** Re-attaches props whose character appeared after the scene state was restored. */
  resolvePending(final = false) {
    let any = false;
    for (const p of this.props) {
      const want = p.pendingHold;
      if (!want) continue;
      const ch = this.app.characters.find((c) => c.id === want.characterId);
      if (ch) { this.attach(p, ch, want.side, { pose: false, emit: false }); any = true; }
      else if (final) delete p.pendingHold; // the character is gone: stay where it was saved
    }
    if (any) this._changed(null);
  }

  /** Per-frame check (cheap): characters rescaled through placement keep real-size props. */
  checkHeldScale() {
    let changed = false;
    for (const p of this.props) {
      const h = p.hold;
      if (h && h.scaleRef !== (h.ch.root.scale.x || 1)) { this.refreshHold(p); changed = true; }
    }
    return changed;
  }

  // ------------------------------------------------------------ persistence
  serialize() {
    return { v: 1, items: this.props.map((p) => p.toJSON()) };
  }

  /** Idempotent restore (undo/redo/load): updates in place, rebuilds only what changed. */
  deserialize(obj) {
    const items = Array.isArray(obj?.items) ? obj.items : [];
    const keep = new Set();
    let listChanged = false;
    for (const it of items) {
      if (!it || !TYPE_BY_ID.has(it.type)) continue;
      let p = it.id ? this.byId(it.id) : null;
      if (p && p.type.id !== it.type) { this._destroy(p); p = null; }
      if (!p) { p = this.create(it); listChanged = true; }
      else {
        if (p.setParams(it.params || {})) this._meshesDirty = true;
        if (typeof it.color === 'string' && it.color !== p.color) p.setColor(it.color);
        p.scale = THREE.MathUtils.clamp(+it.scale || 1, 0.1, 5);
        const g = it.grip || {};
        Object.assign(p.grip, { slide: +g.slide || 0, twist: +g.twist || 0, flip: !!g.flip });
        p.group = typeof it.group === 'string' ? it.group : null;
      }
      keep.add(p);
      const want = it.hold && it.hold.characterId ? { characterId: it.hold.characterId, side: it.hold.side === 'L' ? 'L' : 'R' } : null;
      const ch = want ? this.app.characters.find((c) => c.id === want.characterId) : null;
      let held = false;
      if (want && ch && p.isHand) {
        if (p.hold && p.hold.ch === ch && p.hold.side === want.side) { this.refreshHold(p); held = true; }
        else held = this.attach(p, ch, want.side, { pose: false, emit: false });
      }
      if (!held) {
        if (p.hold) { p.hold = null; p.hangTwist = 0; }
        if (p.root.parent !== this.app.world) this.app.world.add(p.root);
        p.setFree(it.pos, it.rot);
        p.updatePivot();
        if (want && !ch) p.pendingHold = want;
        else delete p.pendingHold;
      }
    }
    for (const p of [...this.props]) if (!keep.has(p)) { this._destroy(p); listChanged = true; }
    if (this.selected && !keep.has(this.selected)) this.select(null);
    this._meshesDirty = true;
    this._changed(null, listChanged ? 'list' : 'change');
  }

  _destroy(p) {
    const i = this.props.indexOf(p);
    if (i >= 0) this.props.splice(i, 1);
    p.dispose();
    this._meshesDirty = true;
  }

  // ------------------------------------------------------------ picking
  /** All prop meshes (cached array, rebuilt when props change). */
  get meshes() {
    if (this._meshesDirty) {
      this._meshes.length = 0;
      for (const p of this.props) if (p.root.visible) for (const m of p.meshes) if (!m.userData.noPick) this._meshes.push(m);
      this._meshesDirty = false;
    }
    return this._meshes;
  }

  /**
   * Nearest prop under a screen point (NDC), ignoring props hidden behind a
   * character's body. Returns {prop, point, distance} or null.
   */
  pick(ndc, { occlusion = true, only = null } = {}) {
    const rc = this.raycaster;
    rc.setFromCamera(ndc, this.app.camera);
    const list = only ? only.meshes : this.meshes;
    if (!list.length) return null;
    // current matrices (a prop moved since the last frame; the pivot does not auto-update)
    if (only) only.root.updateWorldMatrix(true, true);
    else for (const p of this.props) if (p.root.visible) p.root.updateWorldMatrix(true, true);
    const hit = rc.intersectObjects(list, false)[0];
    if (!hit) return null;
    if (occlusion && this._bodyBefore(rc.ray, hit.distance - 0.005)) return null;
    return { prop: hit.object.userData.prop, point: hit.point.clone(), distance: hit.distance };
  }

  /** True if the ray hits a character body closer than maxDist (CPU-skinned triangles). */
  _bodyBefore(ray, maxDist) {
    const m = this.app.model, F = m.faceV, faces = m.groupFaces[0];
    for (const ch of this.app.characters) {
      if (!ch.root.visible) continue;
      ch.root.updateWorldMatrix(true, true);
      const P = ch.getSkinnedPositions();
      const M = ch.rig.matrixWorld;
      _m.copy(M).invert();
      _ray2.copy(ray).applyMatrix4(_m);
      // cheap bounding sphere of the posed body
      _box2.makeEmpty();
      for (let i = 0; i < P.length; i += 3 * 7) _box2.expandByPoint(_a.set(P[i], P[i + 1], P[i + 2]));
      _box2.getBoundingSphere(_sphere);
      _sphere.radius += 0.05;
      if (!_ray2.intersectsSphere(_sphere)) continue;
      for (let k = 0; k < faces.length; k++) {
        const f = faces[k] * 4;
        const ia = F[f] * 3, ib = F[f + 1] * 3, ic = F[f + 2] * 3, id = F[f + 3];
        _a.set(P[ia], P[ia + 1], P[ia + 2]); _b.set(P[ib], P[ib + 1], P[ib + 2]); _c.set(P[ic], P[ic + 1], P[ic + 2]);
        let hit = _ray2.intersectTriangle(_a, _b, _c, false, _hit);
        if (!hit && id !== 0xffff) { _d.set(P[id * 3], P[id * 3 + 1], P[id * 3 + 2]); hit = _ray2.intersectTriangle(_a, _c, _d, false, _hit); }
        if (hit) {
          _hit.applyMatrix4(M);
          if (_hit.distanceTo(ray.origin) < maxDist) return true;
        }
      }
    }
    return false;
  }

  // ------------------------------------------------------------ events
  _changed(prop, type = 'change') {
    this.app.invalidate();
    this.app.lightRig?.markWorldDirty?.();
    if (type === 'list') this.dispatchEvent({ type: 'list' });
    this.dispatchEvent({ type: 'change', prop });
  }
}

/** Separating-axis test of two footprint rectangles from _footprint(). */
function obbOverlap(A, B) {
  // local axes in world x/z: X = (c, -s), Z = (s, c)
  const axes = [A.c, -A.s, A.s, A.c, B.c, -B.s, B.s, B.c];
  const dx = B.cx - A.cx, dz = B.cz - A.cz;
  for (let k = 0; k < 8; k += 2) {
    const ax = axes[k], az = axes[k + 1];
    const ra = A.hx * Math.abs(A.c * ax - A.s * az) + A.hz * Math.abs(A.s * ax + A.c * az);
    const rb = B.hx * Math.abs(B.c * ax - B.s * az) + B.hz * Math.abs(B.s * ax + B.c * az);
    if (Math.abs(dx * ax + dz * az) > ra + rb) return false;
  }
  return true;
}

export function wrapAngle(a) {
  a = ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a;
}
