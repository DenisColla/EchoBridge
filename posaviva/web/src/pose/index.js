// Entry point of the "pose" module (see posaviva/ARCHITECTURE.md):
// interactive posing — anatomical parts with natural limits, tap picking on the
// skinned body, FK rotation gizmo, IK effectors (hands, feet, head, pelvis with
// pinned feet), character placement, pose presets and hand tools.
//
// Tools: 'pose' (Posa), 'poselib' (Pose pronte, with "Le mie pose" from app.projects), 'hands'
// (Mani) in the 'pose' group. Posa › Posa intera › "Salva posa…" opens app.projects' sheet.
// Public API: app.posing (see the bottom of create()).
// Per-character state: ch.data.pose = {seat, nat, preset, presetMirror}: `preset` is the id of the
// last ready pose applied (library.applyPosePreset), kept through Dinamismo / Naturalezza /
// "Appoggia a terra" / Specchia (presetMirror toggles) and Copia su…, cleared by any other edit.
// Placement follows a ready landscape's ground (app.landscapes.heightAt): Sposta drags, "Altezza
// da terra" (relative to it), "Appoggia a terra" (app.city.groundY: sidewalks too).
import './pose.css';
import * as THREE from 'three';
import { haptic } from '../ui/kit.js';
import { ControlSet } from './controls.js';
import { PoseRig } from './rig.js';
import { IKSolver } from './ik.js';
import { Picker } from './picking.js';
import { Highlight } from './highlight.js';
import { PoseGizmo } from './gizmo.js';
import { registerPoseTool } from './panel.js';
import { registerPresetsTool } from './presetsPanel.js';
import { registerHandsTool } from './handsPanel.js';
import { PRESERVED_BONES, HIP_REF, mirrorPose, applyPoseObject, applyPosePreset, applyHandPreset, lowestGroundY, measureSeat, seatMark, setSeatMark, presetMark, setPresetMark, feetOnFloor, fitArms, NATURAL_POSE } from './library.js';
import { SpineFollow, applyNaturalness, exaggerate, poseSnapshot, bendLine, lineSnapshot } from './soft.js';
import { ActionLine } from './actionLine.js';
import { ContactPins, EFFECTORS } from './contacts.js';
import { DirectTouch, HAND_SHAPES } from './direct.js';
import { CharacterCarry } from './carry.js';
import { approachSpot } from './approach.js';

const PREFS_KEY = 'posaviva.pose.prefs';
const POSE_TOOLS = new Set(['pose', 'hands']);
export const POSE_MODES = ['rotate', 'ik', 'move', 'line'];
/** "Naturalezza" of a new character (0..1): small deterministic asymmetries */
export const DEFAULT_NATURALNESS = 0.6;

function loadPrefs() {
  const def = { mode: 'rotate', limits: true, pinFeet: true, showJoints: false, softSpine: true, counterTilt: true, direct: true, keepContacts: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return def; }
}

/** small deterministic hash of a string (0 .. 2^32-1) */
function hashId(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function create(app, shell) {
  const controls = new ControlSet(app.model);
  const rig = new PoseRig(controls);
  const ik = new IKSolver(rig);
  const picker = new Picker(app, controls);
  const highlight = new Highlight(app);
  const state = loadPrefs();
  if (!POSE_MODES.includes(state.mode)) state.mode = 'rotate';
  rig.limits = state.limits;
  controls.setSoft(state.softSpine);
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
    /**
     * after a pose edit: final = interaction ended (undo step). A final edit clears the
     * ready-pose mark (ch.data.pose.preset) unless opts.keepPreset (preset applied,
     * Dinamismo / Naturalezza on top of it, drop to the floor).
     */
    edited(ch, final = false, label = 'posa', { keepPreset = false } = {}) {
      ch.applyPose(); // fires 'pose': live UI refresh goes through the selected character's listener
      if (final) {
        if (!keepPreset && ch.data?.pose?.preset) setPresetMark(ch, null);
        notify('pose-final');
        app.commit(label);
      }
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
      if (key === 'softSpine') controls.setSoft(value);
      if (key === 'keepContacts' && value) for (const c of app.characters) ctx.contacts?.changed(c);
      if (key === 'direct' && !value) { ctx.direct?.closeMenu(); ctx.direct?.disarm(); }
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(state)); } catch { /* private mode */ }
      syncHighlight();
      notify('prefs');
      app.invalidate();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    select(ch, partId) { app.select(ch, partId || null); },
  };

  ctx.feetOnFloor = (ch) => { ch.root.updateMatrixWorld(true); return feetOnFloor(ch); };
  /** a ready landscape's ground height at world (x, z) (terrain, roof, pier), else 0 — cheap */
  ctx.floorAt = (x, z) => {
    const L = app.landscapes;
    const y = L?.heightAt ? L.heightAt(x, z) : 0;
    return Number.isFinite(y) ? y : 0;
  };
  /** the ground under world (x, z) including exterior pieces (sidewalks, roads, lawns) — raycasts */
  ctx.groundAt = (x, z) => {
    const y = app.city?.groundY ? app.city.groundY(x, z) : ctx.floorAt(x, z);
    return Number.isFinite(y) ? y : ctx.floorAt(x, z);
  };
  ctx.follow = new SpineFollow(ctx);
  ctx.line = new ActionLine(ctx);
  /** "Naturalezza" amount of a character (0..1, kept in ch.data.pose.nat) */
  ctx.naturalness = (ch) => +(ch?.data?.pose?.nat) || 0;
  /** after a preset replaced the pose: puts the character's "Naturalezza" back on top of it */
  ctx.reapplyNaturalness = (ch) => {
    const v = ctx.naturalness(ch);
    if (v > 0) ctx.keepFeet(ch, () => applyNaturalness(ch, 0, v, rig, controls));
  };
  ctx.setNaturalness = (ch, v) => {
    v = Math.max(0, Math.min(1, v));
    applyNaturalness(ch, ctx.naturalness(ch), v, rig, controls);
    const d = ch.data.pose || (ch.data.pose = {});
    if (v > 0) d.nat = Math.round(v * 1000) / 1000; else delete d.nat;
    if (!Object.keys(d).length) delete ch.data.pose;
  };
  const gizmo = new PoseGizmo(ctx);
  ctx.gizmo = gizmo;
  // direct touch on the body, contacts (hand / foot pinned on a surface), long press = carry
  const contacts = new ContactPins(ctx);
  ctx.contacts = contacts;
  const direct = new DirectTouch(ctx);
  ctx.direct = direct;
  ctx.carry = new CharacterCarry(ctx);

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
      contacts.clear(ch); // the contacts were on the other side
      const keep = PRESERVED_BONES.map((n) => [n, ch.getBoneRotation(n)?.clone()]);
      const mode = groundMode(ch);
      const p = mirrorPose(ch.getPose());
      ch.setPose(p, false);
      for (const [n, q] of keep) if (q) ch.setBoneRotation(n, q, false);
      ch.applyPose();
      // the mesh is not perfectly symmetric: a grounded pose stays on the floor
      if (mode) settle(ch, mode);
      // the same ready pose, mirrored
      const pid = presetMark(ch);
      if (pid) setPresetMark(ch, pid, !ch.data.pose.presetMirror);
      ctx.edited(ch, true, 'specchia posa', { keepPreset: !!pid });
    },
    resetPose(ch) {
      contacts.clear(ch); // the rest pose touches nothing
      const keep = PRESERVED_BONES.map((n) => [n, ch.getBoneRotation(n)?.clone()]);
      for (const q of ch.poseQuat) q.identity();
      ch.rootOffset.set(0, 0, 0);
      for (const [n, q] of keep) if (q) ch.setBoneRotation(n, q, false);
      setSeatMark(ch, 0);
      ctx.edited(ch, true, 'azzera posa');
    },
    /**
     * Copies the pose of src onto dst (eyes kept, root offset scaled by hip height).
     * A grounded pose is re-grounded; a seated one (chair / stool preset, see
     * library.seatMark) puts dst's buttocks at the height src sits at, feet planted, so
     * a taller or shorter body still sits on the same chair; arms are pushed out of a
     * bulkier torso like the presets do.
     */
    copyPose(src, dst) {
      const pose = src.getPose();
      for (const n of PRESERVED_BONES) delete pose.bones[n];
      const hs = src.restLocalPos[0].y;
      const mode = groundMode(src);
      const seat = mode ? measureSeat(src) : 0;
      // applyPoseObject scales the root offset by hip / HIP_REF: pass it in f_normal units
      const k = hs > 0 ? HIP_REF / hs : 1;
      applyPoseObject(dst, { bones: pose.bones, root: pose.root.map((v) => v * k) }, { ground: !!mode, seat, collide: true, shoes: mode !== 'skin' });
      setSeatMark(dst, seat > 0 ? seatMark(src) || seat : 0);
      setPresetMark(dst, presetMark(src), !!src.data?.pose?.presetMirror); // same ready pose
      notify('pose-final');
      app.commit('copia posa');
    },
    dropToGround(ch) {
      ch.dropToGround();
      ctx.edited(ch, true, 'appoggia a terra', { keepPreset: true });
    },
  };
  ctx.ops = ops;

  /**
   * lowest point resting on the floor (world y): shoes touch it, the skin keeps the shoe
   * clearance (same rule as Character.dropToGround)
   */
  function lowestY(ch, shoes = true) {
    ch.root.updateMatrixWorld(true);
    return lowestGroundY(ch, shoes);
  }
  /** the character's own floor: its placement height (on the ground or on a raised spot) */
  const floorOf = (ch) => ch.root.getWorldPosition(new THREE.Vector3()).y;
  /**
   * How the character rests on its floor: 'shoes' (standing: shoes touch it), 'skin'
   * (floor presets: the body rests on it, tucked shoes may dip in) or null (in the air).
   */
  function groundMode(ch) {
    const f = floorOf(ch), tol = 0.02 * ch.root.scale.y;
    const a = Math.abs(lowestY(ch, true) - f), b = Math.abs(lowestY(ch, false) - f);
    if (Math.min(a, b) >= tol) return null;
    return a <= b ? 'shoes' : 'skin';
  }
  /** moves the root offset so the lowest point rests on the character's floor (same rule as before) */
  function settle(ch, mode = groundMode(ch) || 'shoes') {
    const d = floorOf(ch) - lowestY(ch, mode !== 'skin');
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ch.root.getWorldQuaternion(new THREE.Quaternion()).invert());
    ch.rootOffset.addScaledVector(up, d / (ch.root.scale.y || 1));
    ch.applyPose();
  }

  /** runs fn (pose edits, no matrix update needed) keeping the feet that stand on the floor planted (leg IK) */
  ctx.keepFeet = (ch, fn) => {
    const feet = ctx.feetOnFloor(ch);
    const pins = ['L', 'R'].filter((sd) => feet[sd]).map((sd) => ik.pin(ch, sd));
    fn();
    rig.refreshAll(ch);
    for (const p of pins) ik.solvePinned(ch, p);
  };
  /** Linea: fits the character to a stroke (client px) and records the undo step */
  ctx.applyStroke = (ch, pts) => {
    if (!app.characters.includes(ch)) return;
    let r;
    try { r = ctx.line.fit(ch, pts); } catch (e) { console.warn('[pose] line of action failed', e); r = { ok: false }; }
    if (!r.ok) { shell.hint(r.reason === 'short' ? 'Linea troppo corta: disegna una curva più lunga' : 'Disegna la linea sopra il personaggio', 1800); app.invalidate(); return; }
    haptic('light');
    shell.hint('Linea d\'azione: ' + r.label, 1800);
    ctx.edited(ch, true, 'linea d\'azione');
  };
  ctx.groundMode = groundMode;
  ctx.settle = settle;
  ctx.fitArms = (ch) => fitArms(ch);

  /**
   * Natural standing pose for a NEW character (never on load / undo / duplicate):
   * relaxed contrapposto, soft arms, gentle S-curve, head slightly turned, plus the
   * character's own small asymmetries; one character in two stands mirrored.
   */
  function naturalPose(ch) {
    const h = hashId(ch.id);
    applyPosePreset(ch, NATURAL_POSE, { mirror: (h & 1) === 1 });
    ctx.keepFeet(ch, () => ctx.setNaturalness(ch, DEFAULT_NATURALNESS));
    ch.applyPose();
  }

  // ---------------------------------------------------------------- picking (tap)
  function onTap({ ndc, x, y, event }) {
    if (direct.eatsTap(event)) return true; // the release of a direct drag that came back to its start
    const tool = shell.activeToolId;
    const posing = ctx.isActive();
    const mode = ctx.mode();
    if (posing && state.showJoints && mode === 'rotate') {
      const id = gizmo.hitDot(x, y, event?.pointerType);
      if (id) { app.select(app.selection.character, id); haptic(10); return true; }
    }
    const hit = picker.pick(ndc);
    if (hit) {
      let part = null;
      if (posing && mode === 'rotate') {
        // (a tap on the palm selects the hand outside the Mani tool: direct.palmAsHand)
        part = direct.palmAsHand(hit.control)?.id || null;
        // the hands tool only poses hands: other parts just select the character
        if (tool === 'hands' && hit.control && !['hand', 'finger'].includes(hit.control.region)) part = null;
      }
      if (hit.character !== app.selection.character || part !== app.selection.part) app.select(hit.character, part);
      haptic(10);
      // "Tocco diretto": a hand or a foot opens its small menu at the finger
      if (posing) direct.maybeMenu(hit, x, y);
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
    if (app.routeTap) { app.routeTap(e); return; }
    onTap({ ndc: app.pointerToNDC(e), event: e, x: e.clientX, y: e.clientY });
  };

  // ---------------------------------------------------------------- highlight & UI sync
  function syncHighlight() {
    const { character: ch, control } = ctx.sel();
    const show = !!(ch && control && ctx.isActive() && ctx.mode() === 'rotate' && !shell.cleanView);
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

  // Undo / redo restore the scene through app.deserialize(), which re-selects the
  // character without a part: keep posing the same part (same character object,
  // restored in place) instead of making the user tap it again after every undo.
  let lastSel = { character: null, part: null };
  app.addEventListener('selection', (e) => {
    const restoring = !!app.history?.restoring;
    if (!restoring) { lastSel = { character: e.character, part: e.part }; return; }
    const { character: ch, part } = lastSel;
    if (!ch || !part || e.character !== ch || e.part) return;
    queueMicrotask(() => {
      if (app.selection.character === ch && !app.selection.part && app.characters.includes(ch) && controls.get(part)) app.select(ch, part);
    });
  });
  app.addEventListener('tool', () => { syncHighlight(); app.invalidate(); });
  // Vista pulita: the selected part keeps its selection but shows no colour and no handles
  app.addEventListener('cleanview', () => { syncHighlight(); app.invalidate(); });
  // the faint line-of-action stroke belongs to the pose it produced
  app.addEventListener('loaded', () => ctx.line.clear());
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

  // ---------------------------------------------------------------- contacts & direct touch API
  const effOk = (ch, eff) => !!ch && app.characters.includes(ch) && EFFECTORS.includes(eff);
  const v3 = (p) => (p?.isVector3 ? p.clone() : Array.isArray(p) ? new THREE.Vector3().fromArray(p) : p ? new THREE.Vector3(p.x, p.y, p.z) : null);
  const touchApi = {
    /**
     * Contact: IK reach of a hand / foot ('hand.L'|'hand.R'|'foot.L'|'foot.R') to worldPoint
     * with the palm / sole on the surface of normal worldNormal (resting on it) and, with
     * keep, pinned there: kept while the body, the pelvis or the character move (contacts
     * on a prop / another character follow it). opts: {keep=true, target (owner hint:
     * {character, bone} | {prop} | Object3D; found from the point when omitted), commit=true,
     * label}. One undo step. Returns true when the contact point was reached (within 3 cm).
     */
    pinTo(ch, effector, worldPoint, worldNormal, { keep = true, target, commit = true, label = 'contatto' } = {}) {
      if (!effOk(ch, effector) || !worldPoint) return false;
      const r = contacts.pinTo(ch, effector, v3(worldPoint), v3(worldNormal) || new THREE.Vector3(0, 1, 0), { keep, target });
      ctx.edited(ch, commit, label);
      return r.ok;
    },
    /** releases a contact (one undo step); false when there was none */
    unpin(ch, effector, { commit = true } = {}) {
      if (!ch || !contacts.remove(ch, effector)) return false;
      ctx.edited(ch, commit, 'libera contatto', { keepPreset: true });
      return true;
    },
    /** contacts of a character: [{effector, point, normal, target?: {character, bone} | {prop}}] (world) */
    pins: (ch) => (ch ? contacts.describe(ch) : []),
    /**
     * IK reach without contact: the palm center / sole of `effector` goes to worldPoint, its
     * orientation kept, the body helping for far points (a contact on it is released).
     * One undo step (opts.commit). Returns true when reached within 3 cm.
     */
    reach(ch, effector, worldPoint, { commit = true } = {}) {
      if (!effOk(ch, effector) || !worldPoint) return false;
      const P = v3(worldPoint);
      contacts.remove(ch, effector);
      rig.refreshAll(ch);
      const chain = ik.chains[effector];
      const E = rig.worldPos(ch, chain.end, new THREE.Vector3());
      const C0 = ik.effectorPoint(ch, effector, new THREE.Vector3());
      const off = E.sub(C0);
      const endQuat = rig.worldQuat(ch, chain.end, new THREE.Quaternion());
      const other = chain.side === 'L' ? 'R' : 'L';
      const pins = chain.kind === 'leg' && state.pinFeet && ctx.feetOnFloor(ch)[other] ? [ik.pin(ch, other)] : [];
      const snap = ik.reachSnapshot(ch, chain);
      // in small steps, like a drag (one big jump can get stuck on the limits)
      const n = Math.min(10, Math.max(1, Math.ceil(C0.distanceTo(P) / (0.07 * (ch.root.scale.y || 1)))));
      const target = new THREE.Vector3();
      for (let k = 1; k <= n; k++) {
        target.lerpVectors(C0, P, k / n).add(off);
        ik.reach(ch, chain, target, snap);
        ik.solveLimb(ch, chain, target, endQuat, 3);
        for (const p of pins) ik.solvePinned(ch, p);
      }
      const cur = new THREE.Vector3();
      for (let it = 0; it < 4; it++) {
        // the hand keeps its turn while it can; out of the wrist's range it follows the forearm
        ik.solveLimb(ch, chain, target, it < 2 ? endQuat : null, 3);
        for (const p of pins) ik.solvePinned(ch, p);
        // the wrist / ankle limits may turn the end a little: aim again with the residual
        const e = P.clone().sub(ik.effectorPoint(ch, effector, cur));
        if (e.length() < 0.004) break;
        target.add(e);
      }
      const err = ik.effectorPoint(ch, effector, cur).distanceTo(P);
      ctx.edited(ch, commit, 'raggiungi');
      return err < 0.03 * (ch.root.scale.y || 1);
    },
    /** hand shape: 'pugno'|'aperta'|'afferra'|'indica'|'rilassata' (or a hand preset id); side 'L'|'R'|'both' */
    handShape(ch, side, shape, { commit = true } = {}) {
      if (!ch || !app.characters.includes(ch)) return false;
      const s = HAND_SHAPES.find((x) => x.id === shape || x.preset === shape);
      const id = s ? s.preset : shape;
      const sides = side === 'both' ? ['L', 'R'] : [side];
      let ok = false;
      for (const sd of sides) if (sd === 'L' || sd === 'R') ok = applyHandPreset(ch, id, sd) || ok;
      if (ok) ctx.edited(ch, commit, 'mano: ' + (s ? s.label.toLowerCase() : id));
      return ok;
    },
    /**
     * Walk-free placement near worldPoint: the character stands at a free spot (props,
     * rooms' walls and other characters avoided; landscape / exterior ground followed),
     * facing faceToward (a point; default worldPoint). Contacts on the floor come along.
     * opts: {distance (m from the point, default: as close as free), commit=true}.
     * Returns {position, rotationY} or null.
     */
    approach(ch, worldPoint, faceToward = null, { distance = null, commit = true } = {}) {
      if (!ch || !app.characters.includes(ch) || !worldPoint) return null;
      const spot = approachSpot(ctx, ch, v3(worldPoint), { distance });
      if (!spot) return null;
      const look = v3(faceToward) || v3(worldPoint);
      const yaw = Math.atan2(look.x - spot.x, look.z - spot.z);
      contacts.carry(ch, () => {
        ch.root.position.copy(spot);
        ch.root.rotation.y = yaw;
        ch.root.updateMatrixWorld(true);
      });
      ctx.placed(ch);
      contacts.releaseLost(ch);
      ctx.placed(ch, commit, 'avvicina personaggio');
      return { position: spot.clone(), rotationY: yaw };
    },
    /** arms "Tocca un punto da raggiungere": the next tap on a surface makes a contact */
    armReach: (ch, effector) => { if (effOk(ch, effector)) direct.arm(ch, effector); },
    /** opens the hand / foot touch menu at client (x, y) */
    touchMenu: (ch, effector, x, y) => (effOk(ch, effector) ? direct.openMenu(ch, effector, x, y) : null),
    /** first surface under a client point: {point, normal, distance, owner} | null */
    surfaceAt(x, y, opts = {}) {
      const ndc = app.pointerToNDC({ clientX: x, clientY: y });
      app.camera.updateMatrixWorld();
      picker.raycaster.setFromCamera(ndc, app.camera);
      return contacts.hitSurface(picker.raycaster.ray.clone(), opts);
    },
    contacts,
    direct,
    carry: ctx.carry,
  };

  // ---------------------------------------------------------------- public API
  app.posing = {
    modes: POSE_MODES,
    controls,
    rig,
    ik,
    /** {mode: rotate/ik/move/line, limits, pinFeet, showJoints, softSpine, counterTilt} */
    get state() { return { ...state }; },
    setMode(m) { if (POSE_MODES.includes(m)) { ctx.setPref('mode', m); } },
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
    /** Linea d'azione: bends the character to a stroke (client px points) and records an undo step */
    drawLine: (ch, pts) => ctx.applyStroke(ch, pts),
    /** the ActionLine solver ({fit, chain, bodyLine, last, clear}) */
    actionLine: ctx.line,
    /** "Naturalezza" 0..1 of a character (deterministic asymmetries, ch.data.pose.nat) */
    naturalness: (ch) => ctx.naturalness(ch),
    setNaturalness(ch, v, commit = false) { ctx.keepFeet(ch, () => ctx.setNaturalness(ch, v)); ctx.edited(ch, commit, 'naturalezza', { keepPreset: true }); },
    /** "Dinamismo": exaggerates the current pose (amount 1 = unchanged, 1.5 = +50%), limits respected */
    dynamism(ch, amount, commit = false) {
      const g = groundMode(ch);
      exaggerate(ch, poseSnapshot(ch), amount, rig, controls);
      ch.applyPose(); fitArms(ch);
      if (g) settle(ch, g);
      ctx.edited(ch, commit, 'dinamismo', { keepPreset: true });
    },
    /** "Curva": scales the bend of the back's line of action (0 straight, 1 unchanged, 2 double) */
    curve(ch, t, commit = false) { bendLine(ch, lineSnapshot(ch, rig, controls), t, rig); ctx.edited(ch, commit, 'curva linea d\'azione'); },
    /** overlay handles (read-only; screen positions of the last drawn frame, used by tests) */
    gizmo,
    ...ops,
    ...touchApi,
  };
  ctx.api = app.posing;

  // direct touch listens after every other module's handles; contacts on props follow them
  app.addEventListener('ready', () => {
    direct.install();
    app.props?.addEventListener?.('change', (e) => { if (e.prop) contacts.propChanged(e.prop); });
  });

  return {
    onCharacterAdded(ch, opts) {
      contacts.attach(ch);
      // a copy (duplicate, character inserted from Progetti: json without its id) touches
      // nothing: its contacts belonged to the original's place
      if (opts?.json && !opts.id && ch.data?.pose?.pins) { delete ch.data.pose.pins; if (!Object.keys(ch.data.pose).length) delete ch.data.pose; }
      // only a brand new character (not a load, undo or duplicate: those carry json)
      if (!opts || opts.json || opts.pose === false) return;
      try { naturalPose(ch); } catch (e) { console.warn('[pose] natural pose failed', e); }
    },
    onCharacterRemoved(ch) {
      contacts.detach(ch);
      if (ctx.carry.d?.ch === ch) ctx.carry.d = null;
      highlight.forget(ch);
      if (watched === ch) { watched.removeEventListener('pose', onPose); watched.removeEventListener('shape', onPose); watched = null; }
    },
    deserializeCharacter(ch) {
      // pose itself is restored by the core; just refresh what depends on it (cheap)
      if (ch === app.selection.character) onPose();
    },
  };
}
