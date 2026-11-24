// Cheap world-space bounds of characters and props.
//
// Characters are measured from their posed skeleton (bone heads + tails,
// padded) instead of skinned vertices: ~90 points instead of ~19k, which is
// plenty for shadow-camera fitting, framing and light aiming.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _box = new THREE.Box3();
const _lengths = new WeakMap(); // character -> {ref, lengths: Float32Array} bone lengths (rig space)

function boneLengths(ch) {
  // Character.rebuildShape() recreates the joint vectors: their identity tells
  // whether the cached lengths still belong to the current shape
  const ref = ch.jointPositions.get(ch.model.bones[0].head);
  const L = _lengths.get(ch);
  if (L && L.ref === ref) return L.lengths;
  const bones = ch.model.bones;
  const lengths = new Float32Array(bones.length);
  for (let i = 0; i < bones.length; i++) {
    const a = ch.jointPositions.get(bones[i].head), b = ch.jointPositions.get(bones[i].tail);
    lengths[i] = a && b ? a.distanceTo(b) : 0;
  }
  _lengths.set(ch, { ref, lengths });
  return lengths;
}

/**
 * World AABB of a posed character. `pad` (meters) accounts for flesh around
 * the bones. Updates the character's world matrices.
 */
export function characterBounds(ch, box = new THREE.Box3(), pad = 0.12) {
  ch.root.updateWorldMatrix(true, true);
  const L = boneLengths(ch);
  box.makeEmpty();
  const bones = ch.bones;
  for (let i = 0; i < bones.length; i++) {
    const m = bones[i].matrixWorld;
    _v.setFromMatrixPosition(m);
    box.expandByPoint(_v);
    if (L[i] > 0) {
      // tail = head + local Y axis * length (bone frames have Y along the bone)
      _v.set(0, L[i], 0).applyMatrix4(m);
      box.expandByPoint(_v);
    }
  }
  if (!box.isEmpty()) box.expandByScalar(pad * ch.root.scale.x);
  return box;
}

/** Center of the character's chest (nice default aim point for lights). */
export function characterCenter(ch, target = new THREE.Vector3()) {
  characterBounds(ch, _box);
  if (_box.isEmpty()) return target.copy(ch.root.position).setY(0.9);
  _box.getCenter(target);
  target.y = _box.min.y + (_box.max.y - _box.min.y) * 0.62;
  return target;
}

/** World position of the character's eyes (midpoint of the eye bones). */
export function characterEyes(ch, target = new THREE.Vector3()) {
  ch.root.updateWorldMatrix(true, true);
  const l = ch.boneByName.get('eye.L'), r = ch.boneByName.get('eye.R');
  if (!l || !r) return characterCenter(ch, target).setY(1.55 * ch.root.scale.x);
  target.setFromMatrixPosition(l.matrixWorld);
  _v.setFromMatrixPosition(r.matrixWorld);
  return target.add(_v).multiplyScalar(0.5);
}

/** Facing angle (radians, around world Y) of a character: 0 = facing +Z. */
export function characterYaw(ch) {
  ch.root.updateWorldMatrix(true, false);
  // forward = character local +Z transformed to world
  const e = ch.root.matrixWorld.elements;
  return Math.atan2(e[8], e[10]);
}

/**
 * Bounds of everything in app.world (characters + props).
 * Returns false when the world is empty.
 */
export function worldBounds(app, box) {
  box.makeEmpty();
  const chars = new Set(app.characters.map((c) => c.root));
  for (const ch of app.characters) {
    if (!ch.root.visible) continue;
    characterBounds(ch, _box, 0.15);
    box.union(_box);
  }
  // props held in a hand live under wrist bones: include them explicitly
  for (const p of app.props?.props || []) if (p.hold && p.root?.visible && p.worldBox) box.union(p.worldBox(_box));
  for (const child of app.world.children) {
    if (chars.has(child) || !child.visible || child.userData.noBounds) continue;
    _box.setFromObject(child, false);
    if (!_box.isEmpty()) box.union(_box);
  }
  return !box.isEmpty();
}
