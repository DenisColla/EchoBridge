// Pose & hand preset library (data + helpers). Contract used by the posing UI:
//   POSE_CATEGORIES, POSE_PRESETS, HAND_PRESETS, applyPosePreset, applyHandPreset, mirrorPose
// Pose format = Character.getPose(): {bones:{boneName:[x,y,z,w]}, root:[x,y,z]} with
// rotations in each bone's rest-local frame (see ARCHITECTURE.md).
import * as THREE from 'three';

export const POSE_CATEGORIES = [
  { id: 'stand', label: 'In piedi' },
  { id: 'action', label: 'Azione' },
  { id: 'fight', label: 'Combattimento' },
  { id: 'sit', label: 'Seduti' },
  { id: 'floor', label: 'A terra' },
  { id: 'gesture', label: 'Gesti' },
];

/** [{id, label, category, pose:{bones,root}, ground:true}] — `ground` = drop to floor after applying */
export const POSE_PRESETS = [];

/** [{id, label, bones:{'finger1-1':[x,y,z,w], ...}}] rotations for the LEFT hand, bone names WITHOUT side suffix */
export const HAND_PRESETS = [];

/** Bones owned by other modules that presets must never overwrite. */
export const PRESERVED_BONES = ['eye.L', 'eye.R'];

const _q = new THREE.Quaternion();

/** Mirror a pose object left<->right ((x,y,z,w) -> (x,-y,-z,w), .L<->.R). */
export function mirrorPose(pose) {
  const out = { bones: {}, root: pose.root ? [-pose.root[0], pose.root[1], pose.root[2]] : [0, 0, 0] };
  for (const [name, q] of Object.entries(pose.bones || {})) {
    const m = name.endsWith('.L') ? name.slice(0, -2) + '.R' : name.endsWith('.R') ? name.slice(0, -2) + '.L' : name;
    out.bones[m] = [q[0], -q[1], -q[2], q[3]];
  }
  return out;
}

/** Applies a full-body preset. opts: {mirror=false} */
export function applyPosePreset(ch, presetId, opts = {}) {
  const p = POSE_PRESETS.find((x) => x.id === presetId);
  if (!p) return false;
  let pose = opts.mirror ? mirrorPose(p.pose) : p.pose;
  const keep = PRESERVED_BONES.map((n) => [n, ch.getBoneRotation(n)?.clone()]);
  const hipRef = 0.93; // reference hip (root) height of the authoring body
  const root = ch.restLocalPos[0];
  const s = root.y > 0 ? root.y / hipRef : 1;
  pose = { bones: pose.bones, root: (pose.root || [0, 0, 0]).map((v) => v * s) };
  ch.setPose(pose, false);
  for (const [n, q] of keep) if (q) ch.setBoneRotation(n, q, false);
  ch.applyPose();
  if (p.ground !== false) ch.dropToGround();
  return true;
}

/** Applies a hand preset to 'L' | 'R' | 'both', blended by amount (0..1). */
export function applyHandPreset(ch, presetId, side = 'both', amount = 1) {
  const p = HAND_PRESETS.find((x) => x.id === presetId);
  if (!p) return false;
  const sides = side === 'both' ? ['L', 'R'] : [side];
  for (const sd of sides) {
    for (const [b, q] of Object.entries(p.bones)) {
      const name = `${b}.${sd}`;
      if (!ch.boneByName.has(name)) continue;
      _q.set(q[0], sd === 'R' ? -q[1] : q[1], sd === 'R' ? -q[2] : q[2], q[3]).normalize();
      const target = amount >= 1 ? _q : new THREE.Quaternion().slerp(_q, amount);
      ch.setBoneRotation(name, target, false);
    }
  }
  ch.applyPose();
  return true;
}
