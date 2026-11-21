// Entry point of the "pose" module (see posaviva/ARCHITECTURE.md):
// interactive posing — anatomical parts with natural limits, tap picking on the
// skinned body, FK rotation gizmo, IK effectors (hands, feet, head, pelvis with
// pinned feet), character placement, pose presets and hand tools.
//
// Tools: 'pose' (Posa), 'poselib' (Pose pronte), 'hands' (Mani) in the 'pose' group.
// Public API: app.posing (see the bottom of create()).
import './pose.css';
import * as THREE from 'three';
import { haptic, toast } from '../ui/kit.js';
import { ControlSet } from './controls.js';
import { PoseRig } from './rig.js';
import { IKSolver } from './ik.js';
import { Picker } from './picking.js';
import { Highlight } from './highlight.js';
import { PoseGizmo } from './gizmo.js';
import { registerPoseTool } from './panel.js';
import { registerPresetsTool } from './presetsPanel.js';
import { registerHandsTool } from './handsPanel.js';
import { PRESERVED_BONES, mirrorPose } from './library.js';

const PREFS_KEY = 'posaviva.pose.prefs';
const POSE_TOOLS = new Set(['pose', 'hands']);

function loadPrefs() {
  const def = { mode: 'rotate', limits: true, pinFeet: true, showJoints: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return def; }
}

export function create(app, shell) {
  const controls = new ControlSet(app.model);
  const rig = new PoseRig(controls);
  const ik = new IKSolver(rig);
  const picker = new Picker(app, controls);
  const highlight = new Highlight(app);
  const state = loadPrefs();
  if (!['rotate', 'ik', 'move'].includes(state.mode)) state.mode = 'rotate';
  rig.limits = state.limits;
  const listeners = new Set(); // panel refresh callbacks: fn(reason)
  const notify = (reason) => { for (const fn of listeners) fn(reason); };

  const _sel = { character: null, control: null }; // reused: destructure immediately
  const _vis = new Map(); // control -> visible axis indices (per limits state)
  const ctx = {
    app, shell, controls, rig, ik, picker, highlight, state,
    sel() { _sel.character = app.selection.character; _sel.control = controls.get(app.selection.part); return _sel; },
    /** posing handles are shown while a posing tool is open or the panel is closed (full-screen posing) */
    isActive() { const t = shell.activeToolId; return t === null || POSE_TOOLS.has(t); },
    mode() { return shell.activeToolId === 'hands' ? 'rotate' : state.mode; },
    visibleAxes(ctrl) {
      const key = state.limits ? ctrl.id : ctrl.id + '*';
      let v = _vis.get(key);
      if (!v) { v = []; ctrl.axes.forEach((a, k) => { if (!a.extra || !state.limits) v.push(k); }); _vis.set(key, v); }
      return v;
    },
    /** after a pose edit: final = interaction ended (undo step) */
    edited(ch, final = false, label = 'posa') {
      ch.applyPose(); // fires 'pose': live UI refresh goes through the selected character's listener
      if (final) { notify('pose-final'); app.commit(label); }
    },
    /** after a placement change (ch.root) */
    placed(ch, final = false, label = 'sposta') {
      ch.dispatchEvent({ type: 'placement' });
      app.dispatchEvent({ type: 'placement', character: ch });
      app.invalidate();
      notify('placement');
      if (final) { ch.dispatchEvent({ type: 'pose' }); app.commit(label); }
    },
    /** wrist twist (non anatomical) moves to the forearm pronation bone */
    transferWristTwist(ch, ctrl) {
      // the wrist's own twist (Y, not anatomical) becomes forearm pronation (axis 'rot' of the hand)
      const wi = ctrl.pivotIndex, k = ctrl.axes.findIndex((a) => a.key === 'rot');
      const e = rig.euler(ch, wi);
      const tw = e[1];
      if (Math.abs(tw) < 1e-9) return;
      rig.setEuler(ch, wi, e[0], 0, e[2]);
      rig.write(ch, ctrl, k, rig.read(ch, ctrl, k) + tw * ctrl.axes[k].drives[0].sign, false);
      rig.refreshControl(ch, ctrl);
    },
    setPref(key, value) {
      state[key] = value;
      if (key === 'limits') rig.limits = value;
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(state)); } catch { /* private mode */ }
      syncHighlight();
      notify('prefs');
      app.invalidate();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    select(ch, partId) { app.select(ch, partId || null); },
  };

  const gizmo = new PoseGizmo(ctx);
  ctx.gizmo = gizmo;

  // ---------------------------------------------------------------- operations
  const ops = {
    resetPart(ch, ctrl) {
      rig.resetControl(ch, ctrl);
      ctx.edited(ch, true, 'azzera parte');
    },
    /** sided: copy (mirrored) to the opposite side (hand includes fingers); central: mirror in place */
    mirrorPart(ch, ctrl) {
      rig.mirrorControl(ch, ctrl, true);
      ctx.edited(ch, true, ctrl.side ? 'copia sull\'altro lato' : 'specchia parte');
    },
    mirrorPose(ch) {
      const keep = PRESERVED_BONES.map((n) => [n, ch.getBoneRotation(n)?.clone()]);
      const p = mirrorPose(ch.getPose());
      ch.setPose(p, false);
      for (const [n, q] of keep) if (q) ch.setBoneRotation(n, q, false);
      ctx.edited(ch, true, 'specchia posa');
    },
    resetPose(ch) {
      const keep = PRESERVED_BONES.map((n) => [n, ch.getBoneRotation(n)?.clone()]);
      for (const q of ch.poseQuat) q.identity();
      ch.rootOffset.set(0, 0, 0);
      for (const [n, q] of keep) if (q) ch.setBoneRotation(n, q, false);
      ctx.edited(ch, true, 'azzera posa');
    },
    /** copies the pose of src onto dst (eyes kept, root offset scaled by hip height) */
    copyPose(src, dst) {
      const pose = src.getPose();
      for (const n of PRESERVED_BONES) delete pose.bones[n];
      const keep = PRESERVED_BONES.map((n) => [n, dst.getBoneRotation(n)?.clone()]);
      const hs = src.restLocalPos[0].y, hd = dst.restLocalPos[0].y;
      const s = hs > 0 ? hd / hs : 1;
      const grounded = isGrounded(src);
      dst.setPose({ bones: pose.bones, root: pose.root.map((v) => v * s) }, false);
      for (const [n, q] of keep) if (q) dst.setBoneRotation(n, q, false);
      dst.applyPose();
      if (grounded) settle(dst);
      notify('pose-final');
      app.commit('copia posa');
    },
    dropToGround(ch) {
      ch.dropToGround();
      ctx.edited(ch, true, 'appoggia a terra');
    },
  };
  ctx.ops = ops;

  /** lowest skinned body point (world y) */
  function lowestY(ch) {
    ch.root.updateMatrixWorld(true);
    const P = ch.getSkinnedPositions(), M = ch.rig.matrixWorld, v = new THREE.Vector3();
    let minY = Infinity;
    for (const i of app.model.groupVertices[0]) { v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(M); if (v.y < minY) minY = v.y; }
    return minY;
  }
  /** the character's own floor: its placement height (on the ground or on a raised spot) */
  const floorOf = (ch) => ch.root.getWorldPosition(new THREE.Vector3()).y + (ch.groundClearance || 0) * ch.root.scale.y;
  function isGrounded(ch) { return Math.abs(lowestY(ch) - floorOf(ch)) < 0.02 * ch.root.scale.y; }
  /** moves the root offset so the lowest body point rests on the character's floor */
  function settle(ch) {
    const d = floorOf(ch) - lowestY(ch);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ch.root.getWorldQuaternion(new THREE.Quaternion()).invert());
    ch.rootOffset.addScaledVector(up, d / (ch.root.scale.y || 1));
    ch.applyPose();
  }

  // ---------------------------------------------------------------- picking (tap)
  function onTap({ ndc, x, y }) {
    const tool = shell.activeToolId;
    const posing = ctx.isActive();
    const mode = ctx.mode();
    if (posing && state.showJoints && mode === 'rotate') {
      const id = gizmo.hitDot(x, y);
      if (id) { app.select(app.selection.character, id); haptic(10); return true; }
    }
    const hit = picker.pick(ndc);
    if (hit) {
      let part = null;
      if (posing && mode === 'rotate') {
        part = hit.control?.id || null;
        // the hands tool only poses hands: other parts just select the character
        if (tool === 'hands' && hit.control && !['hand', 'finger'].includes(hit.control.region)) part = null;
      }
      if (hit.character !== app.selection.character || part !== app.selection.part) app.select(hit.character, part);
      haptic(10);
      return true;
    }
    if (posing && app.selection.part) { app.select(app.selection.character, null); return true; }
    return false;
  }
  app.addTapHandler(onTap, 10);
  /**
   * A tap that landed on a gizmo handle without dragging it (e.g. on a ring that
   * crosses another body part): route it like a normal tap so the part under the
   * finger gets selected (props and other handlers keep their priority).
   */
  ctx.routeTap = (e) => {
    const ev = { ndc: app.pointerToNDC(e), event: e, x: e.clientX, y: e.clientY };
    const hs = app._tapHandlers; // App internals: same order as its own tap router
    if (Array.isArray(hs) && hs.length) { for (const h of hs) if (h.fn(ev)) return; }
    else onTap(ev);
  };

  // ---------------------------------------------------------------- highlight & UI sync
  function syncHighlight() {
    const { character: ch, control } = ctx.sel();
    const show = !!(ch && control && ctx.isActive() && ctx.mode() === 'rotate');
    if (show) highlight.set(ch, control, control.own.map((n) => app.model.boneIndex.get(n)));
    else highlight.set(null, null);
    app.invalidate();
  }

  let watched = null;
  let rafPose = 0;
  const onPose = () => {
    if (rafPose) return;
    rafPose = requestAnimationFrame(() => { rafPose = 0; notify('pose'); });
  };
  function watch() {
    const ch = app.selection.character;
    if (ch === watched) return;
    if (watched) { watched.removeEventListener('pose', onPose); watched.removeEventListener('shape', onPose); }
    watched = ch;
    if (ch) { ch.addEventListener('pose', onPose); ch.addEventListener('shape', onPose); }
  }
  app.addEventListener('selection', () => { watch(); syncHighlight(); notify('selection'); });
  app.addEventListener('tool', () => { syncHighlight(); app.invalidate(); });
  app.addEventListener('characters', () => notify('characters'));

  // Android back: leave part selection first
  let popBack = null;
  const syncBack = () => {
    const need = ctx.isActive() && !!app.selection.part;
    if (need && !popBack) popBack = app.pushBackHandler(() => { if (!app.selection.part) return false; app.select(app.selection.character, null); return true; });
    else if (!need && popBack) { popBack(); popBack = null; }
  };
  app.addEventListener('selection', syncBack);
  app.addEventListener('tool', syncBack);

  // ---------------------------------------------------------------- tools
  registerPoseTool(ctx);
  registerPresetsTool(ctx);
  registerHandsTool(ctx);

  // ---------------------------------------------------------------- public API
  app.posing = {
    controls,
    rig,
    ik,
    /** {mode, limits, pinFeet, showJoints} */
    get state() { return { ...state }; },
    setMode(m) { if (['rotate', 'ik', 'move'].includes(m)) { ctx.setPref('mode', m); } },
    setPref: (k, v) => ctx.setPref(k, v),
    /** select a part by control id (e.g. 'forearm.L', 'f22.R') */
    selectPart: (ch, id) => app.select(ch, id),
    /** anatomical value of an axis in degrees (display space: hinges = 0 when straight) */
    getAngle(ch, id, key) {
      const c = controls.get(id); const k = c?.axes.findIndex((a) => a.key === key);
      return c && k >= 0 ? THREE.MathUtils.radToDeg(rig.readDisplay(ch, c, k)) : null;
    },
    setAngle(ch, id, key, deg, commit = false) {
      const c = controls.get(id); const k = c?.axes.findIndex((a) => a.key === key);
      if (!c || k < 0) return false;
      rig.write(ch, c, k, THREE.MathUtils.degToRad(deg) - rig.offset(ch, c, c.axes[k]));
      ctx.edited(ch, commit, 'posa');
      return true;
    },
    pick: (ndc) => picker.pick(ndc),
    /** overlay handles (read-only; screen positions of the last drawn frame, used by tests) */
    gizmo,
    ...ops,
  };

  return {
    onCharacterAdded() {},
    onCharacterRemoved(ch) {
      highlight.forget(ch);
      if (watched === ch) { watched.removeEventListener('pose', onPose); watched.removeEventListener('shape', onPose); watched = null; }
    },
    deserializeCharacter(ch) {
      // pose itself is restored by the core; just refresh what depends on it (cheap)
      if (ch === app.selection.character) onPose();
    },
  };
}
