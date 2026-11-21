// Entry point of the "animals" module. See posaviva/ARCHITECTURE.md and
// web/src/animals/README.md.
//
// Poseable animals (scene objects with a skeleton, not Characters): species
// meshes are generated at build time by tools/build-animals.mjs (signed
// distance bodies -> surface nets -> decimation -> diffused skin weights,
// coat masks, AO) and loaded on demand from assets/animals.
//
// Public runtime API: app.animals = AnimalManager (manager.js)
//   app.animals.add(speciesId, {near, position, rotationY, palette, size, age, pose}) -> Promise<Animal>
//   app.animals.select(animal, partId) / .selected / .part / .remove / .duplicate / .pick(ndc)
//   app.modules.animals.focus(animal, part)   frame the camera on an animal / part
//   app.modules.animals.applyPreset(animal, poseId)
// Events on app.animals: 'list', 'select' {animal, part}, 'change' {animal, what}.
import './animals.css';
import * as THREE from 'three';
import { AnimalManager } from './manager.js';
import { AnimalGizmo } from './gizmo.js';
import { AnimalHighlight } from './highlight.js';
import { AnimalThumbs } from './thumbs.js';
import { registerAnimalsTool } from './panel.js';
import { posesFor, resolvePose } from './poses.js';
import { haptic } from '../ui/kit.js';

export { registerFamily } from './controls.js';
export { FAMILY_POSES } from './poses.js';

const D2R = Math.PI / 180;
const _v = new THREE.Vector3(), _box = new THREE.Box3();

export function create(app, shell) {
  const manager = new AnimalManager(app);
  app.animals = manager;
  const isActive = () => shell.activeToolId === 'animals';
  const highlight = new AnimalHighlight(app);
  const gizmo = new AnimalGizmo(app, shell, manager, isActive);
  const thumbs = new AnimalThumbs(app);

  /** Applies a ready pose: resets, sets the family pose, drops to the floor (+ air). */
  function applyPreset(a, id) {
    const p = posesFor(a.entry).find((x) => x.id === id);
    if (!p) return false;
    for (const b of a.bones) b.quaternion.identity();
    for (const [n, e] of Object.entries(resolvePose(a.entry, p))) a.setBoneEuler(n, e);
    a.dropToGround((p.air || 0) * a.entry.height * a.root.scale.y);
    a.lastPreset = id;
    return true;
  }

  /**
   * Frames the camera on an animal ('body') or one of its parts (control id),
   * in the part of the view not covered by the tool sheet. Not committed.
   * withCharacter: frame the animal together with the selected character.
   */
  let lastFocusT = 0;
  function focus(a, part = 'body', { withCharacter = false, animate = true } = {}) {
    if (!a) return;
    lastFocusT = performance.now();
    const ctrl = part && part !== 'body' ? a.controls.byId.get(part) : null;
    _box.makeEmpty();
    if (ctrl) {
      for (const n of ctrl.bones) { _box.expandByPoint(a.bonePoint(n, 0)); _box.expandByPoint(a.bonePoint(n, 1)); }
      _box.expandByScalar(Math.max(0.05 * a.root.scale.y, _box.getSize(_v).length() * 0.25));
    } else a.worldBox(_box);
    if (withCharacter) {
      const ch = app.selection.character || app.characters[0];
      if (ch?.root.visible) { ch.root.updateMatrixWorld(true); _box.union(new THREE.Box3().setFromObject(ch.body || ch.root)); }
    }
    const cam = app.camera;
    const dir = cam.position.clone().sub(app.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.3, 1);
    dir.normalize();
    // camera basis for this direction
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const center = _box.getCenter(new THREE.Vector3());
    let wx = 0, wy = 0, wd = 0;
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z).sub(center);
      wx = Math.max(wx, Math.abs(_v.dot(right))); wy = Math.max(wy, Math.abs(_v.dot(up))); wd = Math.max(wd, Math.abs(_v.dot(dir)));
    }
    const vfov = (cam.getEffectiveFOV ? cam.getEffectiveFOV() : cam.fov) * D2R;
    const tv = Math.tan(vfov / 2), th = tv * cam.aspect;
    const ins = shell.getViewInsets?.() || { top: 0, bottom: 0 };
    const H = app.canvas.clientHeight || 1;
    const freeK = Math.max(0.3, 1 - (ins.top + ins.bottom) / H);
    const dist = Math.max(0.3, Math.max(wx / th, wy / (tv * freeK)) * 1.12 + wd);
    const ndcY = 1 - (2 * (ins.top + (H - ins.top - ins.bottom) / 2)) / H; // centre of the free area
    const target = center.clone().addScaledVector(up, -ndcY * dist * tv);
    const p = target.clone().addScaledVector(dir, dist);
    if (p.y < 0.05) p.y = 0.05;
    const rig = app.sceneTools?.camera;
    if (rig?.applyView) rig.applyView({ p: p.toArray(), t: target.toArray(), f: rig.focal, r: rig.roll || 0 }, { animate, commit: null });
    else { app.controls.target.copy(target); cam.position.copy(p); app.controls.update(); app.invalidate(); }
  }

  // The io view offset frames the selected CHARACTER above the sheet; while the
  // Animali tool is open the subject is the animal, framed by focus() instead.
  let offsetSuspended = false;
  app.addEventListener('tool', () => {
    const vo = app.modules.ui?.viewOffset;
    if (!vo) return;
    if (isActive() && !offsetSuspended) { vo.suspend?.(); offsetSuspended = true; }
    else if (!isActive() && offsetSuspended) { vo.resume?.(); offsetSuspended = false; }
  });
  /** Brings the selected animal into the free area if the sheet hides most of it. */
  function ensureVisible(a) {
    if (!a || !isActive() || performance.now() - lastFocusT < 1500 || app.sceneTools?.camera?.animating) return;
    a.worldBox(_box);
    const ins = shell.getViewInsets?.() || { top: 0, bottom: 0, left: 0, right: 0 };
    const r = app.canvas.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z).project(app.camera);
      const x = (_v.x + 1) / 2 * r.width, y = (1 - _v.y) / 2 * r.height;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const fx0 = ins.left || 0, fx1 = r.width - (ins.right || 0), fy0 = ins.top || 0, fy1 = r.height - (ins.bottom || 0);
    const ix = Math.max(0, Math.min(x1, fx1) - Math.max(x0, fx0)), iy = Math.max(0, Math.min(y1, fy1) - Math.max(y0, fy0));
    const vis = (ix * iy) / Math.max(1, (x1 - x0) * (y1 - y0));
    if (vis < 0.6) focus(a, 'body');
  }

  registerAnimalsTool(app, shell, { manager, thumbs, applyPreset, focus });

  // ---- tap: select an animal and the touched body part (characters in front win)
  app.addTapHandler(({ ndc }) => {
    const hit = manager.pick(ndc);
    if (hit) {
      const ch = app.posing?.pick?.(ndc);
      if (ch && ch.point && ch.point.distanceTo(app.camera.position) < hit.distance - 0.02) return false;
      const part = hit.control?.id || null;
      if (manager.selected === hit.animal && isActive()) manager.select(hit.animal, manager.part === part ? null : part);
      else manager.select(hit.animal, part);
      if (!isActive()) shell.openTool('animals');
      haptic(10);
      return true;
    }
    if (isActive() && manager.selected) {
      if (manager.part) manager.selectPart(null);
      else manager.select(null);
    }
    return false;
  }, 45);

  // ---- highlight of the selected part (only while the tool is open)
  const syncHighlight = () => {
    const a = manager.selected;
    const ctrl = a && manager.part ? a.controls.byId.get(manager.part) : null;
    highlight.show(isActive() ? a : null, isActive() ? ctrl : null);
  };
  manager.addEventListener('select', syncHighlight);
  let lastSel = null;
  manager.addEventListener('select', (e) => {
    const changed = e.animal !== lastSel;
    lastSel = e.animal;
    if (e.animal && changed) setTimeout(() => ensureVisible(e.animal), 380);
  });
  app.addEventListener('tool', () => { if (isActive() && manager.selected) setTimeout(() => ensureVisible(manager.selected), 380); });
  manager.addEventListener('list', syncHighlight);
  app.addEventListener('tool', () => { syncHighlight(); app.invalidate(); });

  // ---- Android back: part -> animal -> catalog
  let popBack = null;
  const syncBack = () => {
    const editing = isActive() && !!manager.selected;
    if (editing && !popBack) popBack = app.pushBackHandler(() => { if (manager.part) manager.selectPart(null); else manager.select(null); return true; });
    else if (!editing && popBack) { popBack(); popBack = null; }
  };
  manager.addEventListener('select', syncBack);
  app.addEventListener('tool', syncBack);

  return {
    manager, applyPreset, focus, gizmo,
    serializeScene() { return manager.serialize(); },
    deserializeScene(obj) { manager.deserialize(obj); syncHighlight(); },
  };
}
