// Long-press actions on scene objects. Press and hold a prop, an exterior item, a
// building or an animal: a menu at the finger offers what a character can do with
// it (Siediti, Sdraiati, Prendi / Posa, Apri / Chiudi, Guarda, Avvicinati, Appoggiati,
// Inginocchiati, Accarezza, Guarda fuori…) and the object tools (Sposta, Ruota 90°,
// Duplica, Elimina, Dettagli). A tap keeps selecting the object as before.
//
// Public runtime API: app.objectActions (see createObjectActions at the bottom):
//   affordances(target) -> string[]       what the object offers (catalog AFFORD + type data)
//   actorFor(target) -> Character | null   the selected character, else the nearest one
//   openMenu(target, {x, y, point, normal, actor}) -> modal api (kit.stageMenu)
//   sit(ch, prop, {point}) · lie(ch, prop | null, 'back' | 'side' | 'front') · sitFloor(ch, prop?) · sitAtTable(ch, table)
//   take(ch, prop, {side}) · putDown(ch, prop, {on, point}) · setOpen(prop, open, {ch})
//   look(ch, target, point?) · approach(ch, target) · lean(ch, target, {point, normal})
//   kneel(ch, target) · pet(ch, animal) · lookOut(ch, prop, point?)
//   move(target) · rotate90(target) · duplicate(target) · remove(target) · details(target)
//   voiceMatch(text) -> match | null · voiceRun(match) -> {done, failed, undoIndex}
// target = a Prop, an Animal or {kind: 'prop' | 'animal', obj}. Every action is ONE undo
// step (app.history.batch) and resolves to true when done; an impossible action shows an
// Italian toast ("Nessun posto libero sul divano") and resolves to false.
//
// Contracts with the other workstreams (feature-detected): app.posing.pinTo / reach /
// approach / handShape (direct touch), app.practicals.isSource / menuSection (lights).
// Without them the actions use their own placement and the pose module's IK solver.
import * as THREE from 'three';
import { h, icon, toast, haptic, stageMenu } from '../ui/kit.js';
import { footprintOf, extentAlong, obstacles, findFree, isFreeAt, seatOf, topOf, roomAt, toRoom, roomOpening } from '../voice/spatial.js';
import { AFFORD } from './catalog.js';
import { fistFrame } from './grip.js';
import { applyPosePreset, applyHandPreset, getPosePreset, mirrorPose, seatMark, presetMark } from '../pose/library.js';
import './actions.css';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _box = new THREE.Box3();
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const HALF_PI = Math.PI / 2;
const ROOM_PARTS = new Set(['stanza', 'pavimento', 'muro']);
/** seats higher than this (m) are perched on (feet dangling); the pose is fitted to a PERCH_SEAT stool */
const PERCH_H = 0.72, PERCH_SEAT = 0.6;
/** where palms go on a table top: [m in from the edge, m to the side of the middle], first free one */
const PALM_SPOTS = [[0.1, 0.2], [0.1, 0.28], [0.06, 0.2], [0.1, 0.13], [0.06, 0.3], [0.05, 0.36]];
/** feet (root) to the table edge when leaning on it with both hands, m (scaled) */
const LEAN_GAP = 0.27;

class ActionError extends Error {}
const fail = (msg) => { throw new ActionError(msg); };

// ------------------------------------------------------------------ Italian
const INV_F = new Set(['tv', 'radio', 'moto', 'bici', 'foto', 'auto', 'mano']);
const INV_M = new Set(['wc', 'bidet', 'pc', 'monitor', 'computer', 'laptop', 'futon', 'pouf', 'cactus', 'ficus', 'skateboard', 'bar', 'set', 'tapis']);
function wordInfo(label) {
  const w = String(label).toLowerCase().split(/[\s/,]+/)[0] || '';
  const pl = /^(tende|mensole|banchi|scarpe|stivali|panini|banane|pere|cuscini|candelabri|occhiali|cacciaviti|pinze|tronchesi|scatolette|calici|cartoline|penne|blocchi|bottiglie|guanti)$/.test(w);
  let f;
  if (INV_F.has(w)) f = true; else if (INV_M.has(w)) f = false;
  else if (pl) f = /e$/.test(w);
  else f = /a$/.test(w) || (/(ione|zione|trice)$/.test(w) && !/^(camion|leone|lampione|carrellone)$/.test(w));
  return { w, f, pl };
}
/** "il divano", "sul divano", "alla sedia", "dell'armadio" (prep: '', su, a, di, da, in). */
export function withArticle(label, prep = '') {
  const { w, f, pl } = wordInfo(label);
  const l = String(label).toLowerCase();
  const vowel = /^[aeiouàèéìòù]/.test(w), simp = /^(s[bcdfgklmnpqrstvz]|z|gn|ps|x|y)/.test(w);
  let art = pl ? (f ? 'le' : vowel || simp ? 'gli' : 'i') : vowel ? 'l\'' : f ? 'la' : simp ? 'lo' : 'il';
  if (prep) {
    const pre = { su: 'su', a: 'a', di: 'de', da: 'da', in: 'ne' }[prep] || prep;
    art = { il: pre + 'l', lo: pre + 'llo', la: pre + 'lla', 'l\'': pre + 'll\'', i: pre + 'i', gli: pre + 'gli', le: pre + 'lle' }[art];
  }
  return art.endsWith('\'') ? art + l : art + ' ' + l;
}
const agreeF = (ch, m, f) => (ch?.sex === 'F' ? f : m);

// ------------------------------------------------------------------ targets
function asTarget(x) {
  if (!x) return null;
  if (x.kind && x.obj) return x;
  if (x.type && x.root && x.meshes) return { kind: 'prop', obj: x };
  if (x.species && x.root) return { kind: 'animal', obj: x };
  return null;
}
const isProp = (t) => t?.kind === 'prop';
function nameOf(t) {
  if (!t) return '';
  if (t.kind === 'animal') return t.obj.name || t.obj.entry?.label || 'Animale';
  return t.obj.type.label;
}
/** World AABB of a target ({kind: 'char'}: a standing body around its placement). */
function boxOf(t, box = new THREE.Box3()) {
  if (t.kind === 'char') { const s = t.obj.root.scale.y || 1; return box.setFromCenterAndSize(_v4.copy(t.obj.root.position).setY(t.obj.root.position.y + 0.9 * s), _v3.set(0.4 * s, 1.8 * s, 0.4 * s)); }
  return t.obj.worldBox(box);
}
function centerOf(t, out = new THREE.Vector3()) { return boxOf(t, _box).getCenter(out); }
function footOf(t) {
  if (t.kind === 'prop') return footprintOf({ kind: 'prop', obj: t.obj });
  boxOf(t, _box);
  return { cx: (_box.min.x + _box.max.x) / 2, cz: (_box.min.z + _box.max.z) / 2, hx: (_box.max.x - _box.min.x) / 2, hz: (_box.max.z - _box.min.z) / 2, yaw: 0 };
}

/**
 * Affordances of a target: catalog AFFORD / type.afford, plus what the type tells
 * (category, 'open' parameter, hand grip). Strings: seat sofa bed table surface wall
 * window floor vehicle building carry held openable animal look approach kneel.
 */
export function affordancesOf(target) {
  const t = asTarget(target);
  const a = new Set();
  if (!t) return [];
  if (t.kind === 'animal') return ['animal', 'look', 'approach', 'kneel'];
  const p = t.obj, ty = p.type, id = ty.id, cat = ty.cat, sub = ty.sub || '';
  for (const x of ty.afford || AFFORD[id] || []) a.add(x);
  if (ty.hand) a.add('carry');
  if (p.hold) a.add('held');
  if (ty.params?.some((q) => q.id === 'open')) a.add('openable');
  if (cat === 'sedute') { a.add('seat'); if (sub === 'divani') a.add('sofa'); }
  else if (cat === 'letti') { if (id !== 'culla') { a.add('bed'); a.add('seat'); } }
  else if (cat === 'tavoli') { a.add('surface'); if (sub === 'pranzo' || sub === 'scrivanie') a.add('table'); }
  else if (cat === 'armadi') { if (sub === 'armadi' || sub === 'librerie') a.add('wall'); else a.add('surface'); }
  else if (cat === 'edifici') { a.add('building'); a.add('wall'); a.add('nokneel'); }
  else if (cat === 'esterni') {
    if (sub === 'veicoli') { a.add('vehicle'); a.add('wall'); a.add('nokneel'); }
    else if (sub === 'alberi') a.add('wall');
  } else if (cat === 'strutture') {
    if (id === 'muro') { a.add('wall'); if (p.params.opening === 'window') a.add('window'); }
    else if (id === 'stanza') { a.add('wall'); if (p.params.window && p.params.window !== 'nessuna') a.add('window'); }
    else if (id === 'finestra') { a.add('window'); a.add('wall'); }
    else if (id === 'porta') a.add('wall');
  } else if (/^tappeto/.test(id)) a.add('floor');
  if (/^frigo/.test(id)) a.add('wall');
  a.add('look');
  if (!p.hold) a.add('approach');
  // kneel: by a bed, a sofa, a rug, or something low standing on the floor (a chest, a crate, a
  // plant); not for small things on furniture (a cup on a table, a TV)
  let low = false;
  if (!p.localBox.isEmpty() && !p.hold) {
    const b = p.worldBox(_box);
    low = b.max.y - b.min.y < 0.6 && b.min.y < 0.1; // (the set's floor is y = 0 around the characters)
  }
  if (!a.has('nokneel') && !p.hold && !a.has('building') && (a.has('bed') || a.has('sofa') || a.has('floor') || (low && !a.has('wall')))) a.add('kneel');
  return [...a];
}

// ------------------------------------------------------------------ module
export function createObjectActions(app, shell) {
  const props = () => app.props;
  const posing = () => (app.posing?.ik && app.posing?.rig ? app.posing : null);
  const visibleChars = () => app.characters.filter((c) => c.root.visible);
  const holding = (ch) => (props()?.props || []).filter((p) => p.hold && p.hold.ch === ch);
  const scaleOf = (ch) => ch.root.scale.y || 1;
  const forwardOf = (ch, out = new THREE.Vector3()) => out.set(Math.sin(ch.root.rotation.y), 0, Math.cos(ch.root.rotation.y));
  /** stable per character: which way the natural standing pose is mirrored */
  const mirrorOf = (ch) => { let x = 0; for (const c of String(ch.id)) x = (x * 31 + c.charCodeAt(0)) | 0; return (x & 1) === 1; };
  /** sitting, lying, kneeling, leaning (a pose that rests on something): moving away stands up first */
  const seatedLike = (ch) => seatMark(ch) > 0 || /^(sit_|lie_|kneel|crouch|all_fours|lean_)/.test(presetMark(ch) || '');

  /** Ground under (x, z): exterior pieces and landscapes included. */
  function floorY(x, z) {
    let y = app.city?.groundY ? app.city.groundY(x, z) : props()?.floorAt?.(x, z);
    if (!Number.isFinite(y)) y = 0;
    return y;
  }

  function boneW(ch, name, out) {
    const b = ch.boneByName?.get(name);
    return b ? out.setFromMatrixPosition(b.matrixWorld) : null;
  }
  function hipsW(ch, out = new THREE.Vector3()) {
    ch.root.updateMatrixWorld(true);
    const a = boneW(ch, 'upperleg01.L', _v3), b = boneW(ch, 'upperleg01.R', _v4);
    return a && b ? out.copy(a).add(b).multiplyScalar(0.5) : out.copy(ch.root.position);
  }
  function headW(ch, out = new THREE.Vector3()) { ch.root.updateMatrixWorld(true); return boneW(ch, 'head', out) || out.copy(ch.root.position).setY(ch.root.position.y + 1.6); }
  function feetW(ch, out = new THREE.Vector3()) {
    ch.root.updateMatrixWorld(true);
    const a = boneW(ch, 'foot.L', _v3), b = boneW(ch, 'foot.R', _v4);
    return a && b ? out.copy(a).add(b).multiplyScalar(0.5) : out.copy(ch.root.position);
  }
  function moveBy(ch, dx, dz, y = ch.root.position.y) {
    const p = ch.root.position;
    ch.setPlacement({ position: [p.x + dx, y, p.z + dz], rotationY: ch.root.rotation.y });
  }
  function place(ch, x, z, yaw, y = floorY(x, z)) {
    releasePins(ch);
    ch.setPlacement({ position: [x, y, z], rotationY: yaw });
  }
  /** Contacts pinned by the direct-touch posing (app.posing.pins) do not follow a character sent elsewhere. */
  function releasePins(ch) {
    const P = app.posing;
    if (!P?.pins || !P.unpin) return;
    try { for (const pin of P.pins(ch) || []) P.unpin(ch, pin.effector); } catch (e) { console.warn('[actions] posing.unpin', e); }
  }
  /** First candidate spot {x, z} where a standing character fits (others, props and animals). */
  function freeSpot(ch, cands, ignore = []) {
    const obs = obstacles(app, new Set([ch, ...holding(ch), ...ignore]));
    const fp = charFootprint(ch);
    for (const c of cands) if (isFreeAt(obs, fp, c.x, c.z)) return c;
    return null;
  }
  /**
   * A free floor spot for a body footprint (half sizes hx across, hz along the yaw) near (x, z),
   * trying each yaw in turn: other characters, props and animals avoided; on a rug / floor piece
   * (`on`) the spot stays on it. null when there is no room.
   */
  function floorSpot(ch, x, z, hx, hz, yaws, on = null) {
    const obs = obstacles(app, new Set([ch, ...holding(ch), ...(on ? [on] : [])]));
    const rug = on ? footOf({ kind: 'prop', obj: on }) : null;
    const room = roomOf(x, z);
    for (const yaw of yaws) {
      const f = findFree(app, x, z, { cx: 0, cz: 0, hx, hz, yaw }, { obstacles: obs, step: 0.12, room });
      if (!f.free) continue;
      if (rug) {
        const c = Math.cos(rug.yaw), sn = Math.sin(rug.yaw), dx = f.x - rug.cx, dz = f.z - rug.cz;
        if (Math.abs(dx * c - dz * sn) > rug.hx + 0.1 || Math.abs(dx * sn + dz * c) > rug.hz + 0.1) continue; // off the rug
      }
      return { x: f.x, z: f.z, yaw };
    }
    return null;
  }

  /**
   * Leaning at a table whose edges are all taken by chairs: the chair at the first edge spot
   * whose only obstacles are free chairs is slid out along the edge's outward direction
   * (same undo step). Returns that spot, or null (nothing moved).
   */
  function pullChair(ch, cands, table) {
    const ignore = new Set([ch, table, ...holding(ch)]);
    const fp = charFootprint(ch);
    const hips = visibleChars().filter((c) => c !== ch).map((c) => hipsW(c, new THREE.Vector3()));
    const M = props();
    for (const cand of cands) {
      const obs = obstacles(app, ignore);
      const hit = obs.filter((o) => !isFreeAt([o], fp, cand.x, cand.z));
      const chairs = hit.map((o) => o.obj).filter((q, i, a) => a.indexOf(q) === i);
      if (!chairs.length || !chairs.every((q) => q.type && q.type.cat === 'sedute' && q.type.sub !== 'divani' && !q.hold)) continue;
      // nobody sitting on them
      if (chairs.some((q) => { const f = footOf({ kind: 'prop', obj: q }); return hips.some((hp) => Math.hypot(hp.x - f.cx, hp.z - f.cz) < 0.4); })) continue;
      const saved = chairs.map((q) => [q, q.root.position.x, q.root.position.z]);
      for (const d of [0.4, 0.55, 0.7]) {
        for (const [q, x, z] of saved) M.moveTo(q, x + cand.out.x * d, z + cand.out.z * d);
        const obs2 = obstacles(app, ignore);
        const ok = isFreeAt(obs2, fp, cand.x, cand.z) && chairs.every((q) => { const f = footOf({ kind: 'prop', obj: q }); return isFreeAt(obstacles(app, new Set([q])), f, f.cx, f.cz); });
        if (ok) return cand;
      }
      for (const [q, x, z] of saved) M.moveTo(q, x, z);
    }
    return null;
  }

  /** Seated / lying / kneeling characters get up first (natural standing pose, held props kept). */
  function standUp(ch, force = false) {
    if (!force && !seatedLike(ch)) return false;
    applyPosePreset(ch, 'relaxed', { mirror: mirrorOf(ch), keepHands: holding(ch).length > 0 });
    for (const p of holding(ch)) carryPose(ch, p);
    return true;
  }

  // ---------------------------------------------------------------- arms and hands (pose module IK)
  function refreshRig(ch) {
    ch.root.updateMatrixWorld(true);
    posing()?.rig.refreshAll?.(ch);
  }
  /**
   * World rotation of the wrist that turns the hand so that its fist-frame axis A
   * ('x' = out of the palm, 'y' = handle axis on the thumb side) points along wantA and
   * the knuckles (+Z) along wantB (projected).
   */
  function handQuat(ch, side, axis, wantA, wantB, out) {
    const P = posing();
    const chain = P.ik.chains['hand.' + side];
    const wrist = ch.bones[chain.end];
    wrist.updateWorldMatrix(true, false);
    if (!fistFrame(ch, side, _m)) return null;
    _m2.multiplyMatrices(wrist.matrixWorld, _m);
    const A = new THREE.Vector3().setFromMatrixColumn(_m2, axis === 'x' ? 0 : 1).normalize();
    const B = new THREE.Vector3().setFromMatrixColumn(_m2, 2).normalize();
    const a = wantA.clone().normalize();
    const q1 = new THREE.Quaternion().setFromUnitVectors(A, a);
    const B1 = B.applyQuaternion(q1).projectOnPlane(a);
    const W = wantB.clone().projectOnPlane(a);
    const q = q1;
    if (B1.lengthSq() > 1e-8 && W.lengthSq() > 1e-8) {
      B1.normalize(); W.normalize();
      const ang = Math.atan2(_v.crossVectors(B1, W).dot(a), B1.dot(W));
      q.premultiply(_q2.setFromAxisAngle(a, ang));
    }
    return out.copy(q).multiply(P.rig.worldQuat(ch, chain.end, _q));
  }
  /**
   * Moves a hand so that its palm centre reaches `palm` (world). opts: palmDir (the palm
   * faces it), handleUp (fist handle axis), knuckles (knuckle direction), body (the back
   * and clavicle help when the point is far). Pose applied (one 'pose' event).
   */
  function reachHand(ch, side, palm, { palmDir = null, handleUp = null, knuckles = null, body = true } = {}) {
    const P = posing();
    if (!P) return false;
    const { ik, rig } = P;
    const chain = ik.chains['hand.' + side];
    if (!chain) return false;
    refreshRig(ch);
    const k = knuckles || forwardOf(ch);
    const endQuat = palmDir ? handQuat(ch, side, 'x', palmDir, k, new THREE.Quaternion()) : handleUp ? handQuat(ch, side, 'y', handleUp, k, new THREE.Quaternion()) : null;
    const snap = body ? ik.reachSnapshot(ch, chain) : null;
    const target = new THREE.Vector3();
    for (let it = 0; it < 3; it++) {
      const pc = ik.effectorPoint(ch, 'hand.' + side, _v);
      const w = rig.worldPos(ch, chain.end, _v2);
      target.copy(palm).sub(pc).add(w); // wanted wrist (palm offset kept)
      if (snap && it === 0) ik.reach(ch, chain, target, snap);
      ik.solveLimb(ch, chain, target, endQuat, 3);
    }
    ch.applyPose();
    return true;
  }
  /** Holds a carried object in front of the body (forearm forward, thumb up). */
  function carryPose(ch, p) {
    const hand = p?.type?.hand, side = p?.hold?.side;
    if (!hand || !side || hand.hang) return;
    const mode = hand.carry || (/^(tazza|telefono|libro|ombrello|bicchiere|bottiglia)$/.test(p.type.id) ? 'up' : null);
    if (!mode || mode === 'long') return;
    const s = scaleOf(ch);
    refreshRig(ch);
    const sh = boneW(ch, 'upperarm01.' + side, new THREE.Vector3());
    if (!sh) return;
    const f = forwardOf(ch);
    const left = new THREE.Vector3(Math.cos(ch.root.rotation.y), 0, -Math.sin(ch.root.rotation.y));
    const out = side === 'L' ? left : left.negate();
    const palm = sh.clone().addScaledVector(f, 0.3 * s).addScaledVector(UP, -0.34 * s).addScaledVector(out, 0.03 * s);
    reachHand(ch, side, palm, { handleUp: UP, knuckles: f, body: false });
    props()?.refreshHold?.(p);
  }
  /** Puts one arm (and hand) back as in the character's ready pose (relaxed when none). */
  function restoreArm(ch, side) {
    const id = presetMark(ch) || 'relaxed';
    const pre = getPosePreset(id) || getPosePreset('relaxed');
    if (!pre) return;
    const pose = ch.data?.pose?.presetMirror || (!presetMark(ch) && mirrorOf(ch)) ? mirrorPose(pre.pose) : pre.pose;
    const names = ['clavicle', 'shoulder01', 'upperarm01', 'upperarm02', 'lowerarm01', 'lowerarm02', 'wrist'].map((n) => `${n}.${side}`);
    for (const n of names) {
      const i = ch.model.boneIndex.get(n);
      if (i === undefined) continue;
      const a = pose.bones?.[n];
      if (a) ch.poseQuat[i].set(a[0], a[1], a[2], a[3]).normalize(); else ch.poseQuat[i].identity();
    }
    applyHandPreset(ch, 'relaxed', side); // also applies the pose
  }
  /**
   * Head and eyes toward a world point (neck + head IK, face gaze). A point far to the
   * side or behind is pulled toward the front (the head turns at most ~70°, the eyes
   * do the rest) so the neck never twists unnaturally.
   */
  function aimHead(ch, point) {
    const P = posing();
    if (P) {
      refreshRig(ch);
      const { ik, rig } = P;
      const eye = ik.eyeCenter(ch, new THREE.Vector3());
      const d = point.clone().sub(eye);
      const f = forwardOf(ch);
      const yawD = Math.atan2(d.x, d.z), yawF = Math.atan2(f.x, f.z);
      const dy = wrap(yawD - yawF), lim = 70 * Math.PI / 180;
      const hl = Math.hypot(d.x, d.z) || 1e-3;
      let pitch = Math.atan2(d.y, hl);
      pitch = Math.max(-0.75, Math.min(0.6, pitch));
      const yaw = yawF + Math.max(-lim, Math.min(lim, dy));
      const head = eye.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)));
      const sn = rig.snapshot(ch, ik.neck), sh = rig.snapshot(ch, ik.head);
      ik.aimHead(ch, head, sn, sh);
      ch.applyPose();
    }
    app.face?.setLookAtPoint?.(ch, point.clone());
  }
  const facePoint = (ch, p) => {
    const d = Math.atan2(p.x - ch.root.position.x, p.z - ch.root.position.z);
    return Math.abs(wrap(d - ch.root.rotation.y));
  };

  // ---------------------------------------------------------------- placement in front of things
  function charFootprint(ch) { const s = scaleOf(ch); return { cx: 0, cz: 0, hx: 0.2 * s, hz: 0.2 * s, yaw: 0 }; }
  /** The room (stanza prop) containing (x, z), or null. */
  function roomOf(x, z) {
    const r = roomAt(app, x, z);
    if (!r) return null;
    const l = toRoom(r, x, z);
    return Math.abs(l.x) <= r.W / 2 && Math.abs(l.z) <= r.D / 2 ? r : null;
  }
  /**
   * A free standing spot next to a target, `gap` m from its footprint along `dir`
   * (default: from the target toward the character), facing `face` (default its centre).
   */
  function spotNear(ch, t, { dir = null, gap = 0.3, face = null } = {}) {
    const fp = footOf(t);
    let dx, dz;
    if (dir) { dx = dir.x; dz = dir.z; }
    else { dx = ch.root.position.x - fp.cx; dz = ch.root.position.z - fp.cz; }
    let n = Math.hypot(dx, dz);
    if (n < 1e-4) { const c = app.camera.position; dx = c.x - fp.cx; dz = c.z - fp.cz; n = Math.hypot(dx, dz) || 1; }
    dx /= n; dz /= n;
    const s = scaleOf(ch);
    const d = extentAlong(fp, dx, dz) + gap * s + 0.15 * s;
    const ignore = new Set([ch, t.obj, ...holding(ch)]);
    const obs = obstacles(app, ignore);
    const room = roomOf(fp.cx, fp.cz);
    const f = findFree(app, fp.cx + dx * d, fp.cz + dz * d, charFootprint(ch), { obstacles: obs, dx, dz, step: 0.12, room });
    const fc = face || centerOf(t, new THREE.Vector3());
    return { x: f.x, z: f.z, yaw: Math.atan2(fc.x - f.x, fc.z - f.z), free: f.free };
  }
  /**
   * Walk-free placement: the character stands at a spot (no walk animation), facing a point.
   * The spot already is where to stand (spotNear): approach uses it as is when it is free
   * (exact), and searches around it only when it is taken.
   */
  function standAt(ch, spot, face) {
    const P = app.posing;
    if (P?.approach && face) {
      // app.posing.approach: {position, rotationY} | null (floor contacts travel, unreachable ones are let go)
      try { if (P.approach(ch, new THREE.Vector3(spot.x, floorY(spot.x, spot.z), spot.z), face.clone ? face.clone() : face, { exact: true })) return; } catch (e) { console.warn('[actions] posing.approach', e); }
    }
    place(ch, spot.x, spot.z, spot.yaw);
  }
  /** Front direction (world, horizontal) of a prop: its +Z. */
  const frontOf = (p) => new THREE.Vector3(Math.sin(p.root.rotation.y), 0, Math.cos(p.root.rotation.y));

  // ---------------------------------------------------------------- actions
  /** Sits on a seat (chair, stool, sofa, bench, bed edge, low rock…) at a free spot. */
  function sit(ch, prop, { point = null } = {}) {
    const p = prop, aff = new Set(affordancesOf(p));
    const bed = aff.has('bed') && !aff.has('sofa');
    const seat = seatOf(p, { bed });
    if (!seat) fail(`Non riesco a sedermi ${withArticle(p.type.label, 'su')}`);
    if (seat.h > 0.92) fail(`${p.type.label}: troppo alto per sedersi`);
    const others = visibleChars().filter((c) => c !== ch);
    const hips = others.map((c) => hipsW(c, new THREE.Vector3()));
    // the free place nearest to the pressed point (else to the character)
    const ref = point || ch.root.position;
    const slot = seat.slots.filter((sl) => !hips.some((q) => Math.hypot(q.x - sl.x, q.z - sl.z) < 0.34))
      .sort((a, b) => Math.hypot(a.x - ref.x, a.z - ref.z) - Math.hypot(b.x - ref.x, b.z - ref.z))[0];
    if (!slot) fail(`Nessun posto libero ${withArticle(p.type.label, 'su')}`);
    const sofa = aff.has('sofa');
    // a high top (a low wall, a counter): perched with the feet dangling in front of it (not
    // tucked under it like on a stool). The pose is fitted to a seat on a floor raised under
    // the feet (the legs could not reach the real floor)
    const perch = seat.h > PERCH_H;
    const hv = perch ? PERCH_SEAT : seat.h;
    const id = perch ? 'sit_chair' : seat.h > 0.58 ? 'sit_stool' : sofa ? 'sit_relaxed' : 'sit_chair';
    const floor = p.root.position.y + (seat.h - hv);
    const yaw = slot.yaw ?? seat.yaw;
    place(ch, slot.x, slot.z, yaw, floor);
    applyPosePreset(ch, id, { seat: hv, keepHands: holding(ch).length > 0 });
    // hips over the seat: knees just past the front edge, the buttocks not behind the back
    const s = scaleOf(ch), sc = p.scale;
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const H = hipsW(ch, new THREE.Vector3());
    const K = boneW(ch, 'lowerleg01.L', new THREE.Vector3()).add(boneW(ch, 'lowerleg01.R', _v)).multiplyScalar(0.5);
    const thigh = Math.max(0.2 * s, _v.subVectors(K, H).dot(f));
    let tx, tz;
    if (slot.side) {
      // the long side of a bed: the hips behind its edge, the knees just past it
      const back = Math.max(0.12 * s, thigh - 0.03 * s);
      tx = slot.edge.x - f.x * back; tz = slot.edge.z - f.z * back;
    } else {
      const front = p.localBox.max.z * sc, back = front - seat.depth;
      let lz = Math.max(back + 0.11 * s, front + 0.03 * s - thigh);
      lz = Math.min(lz, front - 0.12 * s);
      if (perch && seat.depth < 0.35) lz = front - 0.07 * s; // a thin high top (a low wall): the hips over its front edge
      const c = Math.cos(seat.yaw), sn = Math.sin(seat.yaw), o = p.root.position;
      tx = o.x + slot.lx * c + lz * sn; tz = o.z - slot.lx * sn + lz * c;
    }
    moveBy(ch, tx - H.x, tz - H.z, floor);
    for (const q of holding(ch)) carryPose(ch, q);
    return `${ch.name} ${agreeF(ch, 'seduto', 'seduta')} ${withArticle(p.type.label, 'su')}`;
  }

  /** Lies down on a bed (head on the pillow), along a sofa, or on the floor / a rug. */
  function lie(ch, prop, variant = 'back') {
    const id = variant === 'side' ? 'lie_side' : variant === 'front' ? 'lie_front' : 'lie_back';
    const p = prop || null, aff = new Set(p ? affordancesOf(p) : ['floor']);
    let y, headT, axis, faceT = null; // world head target, body axis feet -> head (unit), side faces faceT
    const s = scaleOf(ch);
    if (p && aff.has('bed') && !aff.has('sofa')) {
      const top = topOf(p, { bed: true });
      if (!top) fail(`Non riesco a sdraiarmi ${withArticle(p.type.label, 'su')}`);
      const W = (p.localBox.max.x - p.localBox.min.x) * p.scale;
      const lanes = W >= 1.25 ? [-W / 4, W / 4] : [0];
      const yaw = p.root.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw), o = p.root.position;
      const others = visibleChars().filter((q) => q !== ch).map((q) => hipsW(q, new THREE.Vector3()));
      const toW = (lx, lz) => new THREE.Vector3(o.x + lx * c + lz * sn, 0, o.z - lx * sn + lz * c);
      const lane = lanes.find((lx) => !others.some((q) => { const w = toW(lx, (p.localBox.min.z + p.localBox.max.z) / 2 * p.scale); return Math.hypot(q.x - w.x, q.z - w.z) < 0.35 && q.y > top.y - 0.1; }));
      if (lane === undefined) fail(`${p.type.label}: è già occupato`);
      y = top.y;
      headT = toW(lane, p.localBox.min.z * p.scale + 0.3 * s);
      axis = new THREE.Vector3(-sn, 0, -c); // toward the headboard (local -Z)
      faceT = toW(0, (p.localBox.min.z + p.localBox.max.z) / 2 * p.scale); // lying on a side: toward the middle
      if (lanes.length === 1) faceT = app.camera.position.clone();
    } else if (p && aff.has('sofa')) {
      const seat = seatOf(p);
      if (!seat) fail(`Non riesco a sdraiarmi ${withArticle(p.type.label, 'su')}`);
      const taken = visibleChars().some((q) => q !== ch && Math.hypot(q.root.position.x - p.root.position.x, q.root.position.z - p.root.position.z) < 0.9 && seatedLike(q));
      if (taken) fail(`${p.type.label}: c'è già qualcuno`);
      y = seat.y;
      const yaw = p.root.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw), o = p.root.position;
      const front = p.localBox.max.z * p.scale, lz = front - seat.depth * 0.5;
      const xs = seat.slots.map((q) => q.lx);
      const x0 = Math.min(...xs) - 0.25, x1 = Math.max(...xs) + 0.25;
      headT = new THREE.Vector3(o.x + (x0 + 0.12 * s) * c + lz * sn, 0, o.z - (x0 + 0.12 * s) * sn + lz * c);
      axis = new THREE.Vector3(-c, 0, sn); // toward local -X
      faceT = new THREE.Vector3(o.x + (x0 + x1) / 2 * c + (front + 1) * sn, 0, o.z - (x0 + x1) / 2 * sn + (front + 1) * c);
    } else {
      // the floor: a rug / floor piece, or where the character is
      let cx, cz;
      if (p) {
        const fp = footOf({ kind: 'prop', obj: p });
        cx = fp.cx; cz = fp.cz;
        const long = fp.hz >= fp.hx;
        axis = long ? new THREE.Vector3(-Math.sin(fp.yaw), 0, -Math.cos(fp.yaw)) : new THREE.Vector3(-Math.cos(fp.yaw), 0, Math.sin(fp.yaw));
        p.root.updateWorldMatrix(true, true);
        y = p.worldBox(_box).max.y;
        if (y - p.root.position.y > 0.25) y = topOf(p)?.y ?? y;
      } else {
        cx = ch.root.position.x; cz = ch.root.position.z;
        axis = forwardOf(ch).negate();
        y = floorY(cx, cz);
      }
      // the camera sees the body from the side: the axis across the view when possible
      const toCam = new THREE.Vector3(app.camera.position.x - cx, 0, app.camera.position.z - cz).normalize();
      if (!p && Math.abs(axis.dot(toCam)) > 0.7) axis.set(-toCam.z, 0, toCam.x);
      // room for a lying body (about 1.9 x 0.55 m along the axis), never on somebody
      const ya = Math.atan2(axis.x, axis.z);
      const spot = floorSpot(ch, cx, cz, 0.28 * s, 0.95 * s, [ya, ya + HALF_PI], p);
      if (!spot) fail(p ? `Non c'è spazio libero ${withArticle(p.type.label, 'su')}` : 'Non c\'è spazio per sdraiarsi qui');
      if (spot.yaw !== ya) axis.set(Math.sin(spot.yaw), 0, Math.cos(spot.yaw));
      cx = spot.x; cz = spot.z;
      headT = new THREE.Vector3(cx, 0, cz).addScaledVector(axis, 0.8 * s);
      faceT = app.camera.position.clone();
    }
    // pose, then turn the body so that feet -> head follows the axis and the head is on its mark
    place(ch, headT.x, headT.z, ch.root.rotation.y, y);
    const keep = holding(ch).length > 0;
    let mirror = false;
    applyPosePreset(ch, id, { keepHands: keep });
    const orient = () => {
      const Hd = headW(ch, new THREE.Vector3()), F = feetW(ch, new THREE.Vector3());
      const ya = Math.atan2(Hd.x - F.x, Hd.z - F.z), want = Math.atan2(axis.x, axis.z);
      place(ch, ch.root.position.x, ch.root.position.z, ch.root.rotation.y + wrap(want - ya), y);
    };
    orient();
    if (id === 'lie_side' && faceT) {
      // the face toward faceT (the middle of the bed, the room, the camera)
      const fwd = faceDir(ch);
      const to = new THREE.Vector3(faceT.x - ch.root.position.x, 0, faceT.z - ch.root.position.z);
      if (fwd.dot(to) < 0) { mirror = true; applyPosePreset(ch, id, { mirror, keepHands: keep }); orient(); }
    }
    const Hd = headW(ch, new THREE.Vector3());
    moveBy(ch, headT.x - Hd.x, headT.z - Hd.z, y);
    const what = variant === 'side' ? 'su un fianco' : variant === 'front' ? 'a pancia in giù' : '';
    return `${ch.name} ${agreeF(ch, 'sdraiato', 'sdraiata')}${what ? ' ' + what : ''}${p ? ' ' + withArticle(p.type.label, 'su') : ' a terra'}`;
  }
  /** Horizontal direction the face looks to (eyes ahead of the head joint). */
  function faceDir(ch) {
    const P = posing();
    if (P) { refreshRig(ch); return P.ik.faceForward(ch, new THREE.Vector3()).setY(0).normalize(); }
    return forwardOf(ch);
  }

  /** Sits on the floor (cross-legged) on a rug / floor piece or where the character is. */
  function sitFloor(ch, prop) {
    let x = ch.root.position.x, z = ch.root.position.z, y = floorY(x, z);
    if (prop) {
      const fp = footOf({ kind: 'prop', obj: prop });
      x = fp.cx; z = fp.cz;
      y = prop.worldBox(_box).max.y;
    }
    // room for a cross-legged body (about 0.75 m around), never on somebody
    const s = scaleOf(ch);
    const spot = floorSpot(ch, x, z, 0.36 * s, 0.36 * s, [0], prop);
    if (!spot) fail(prop ? `Non c'è spazio libero ${withArticle(prop.type.label, 'su')}` : 'Non c\'è spazio per sedersi qui');
    x = spot.x; z = spot.z;
    if (!prop) y = floorY(x, z);
    const yaw = Math.atan2(app.camera.position.x - x, app.camera.position.z - z);
    place(ch, x, z, yaw, y);
    applyPosePreset(ch, 'sit_floor_cross', { keepHands: holding(ch).length > 0 });
    // the floor pose lets tucked shoes dip a little into the floor: on a rug they would go
    // through it, so the body rests on the rug top instead
    restOn(ch, y);
    return `${ch.name} ${agreeF(ch, 'seduto', 'seduta')} a terra`;
  }

  /** lifts a floor pose so that no part of the body (shoes included) is below y (world) */
  function restOn(ch, y) {
    ch.root.updateMatrixWorld(true);
    const pos = ch.getSkinnedPositions?.();
    if (!pos) return;
    const M = ch.rig.matrixWorld, body = ch.model.groupVertices[0];
    let min = Infinity;
    for (let k = 0; k < body.length; k += 3) { const i = body[k] * 3; const wy = _v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(M).y; if (wy < min) min = wy; }
    const d = y + 0.002 - min;
    if (Number.isFinite(d) && d > 0.004 && d < 0.1) moveBy(ch, 0, 0, ch.root.position.y + d);
  }

  /** At a table: a free chair around it facing it, else a new chair (a stool at a counter). */
  function sitAtTable(ch, table) {
    const T = { kind: 'prop', obj: table };
    const tfp = footOf(T);
    const top = topOf(table);
    const high = (top?.y ?? 0.75) - table.root.position.y > 0.85;
    const reach = Math.max(tfp.hx, tfp.hz) + 0.9;
    const others = visibleChars().filter((c) => c !== ch).map((c) => hipsW(c, new THREE.Vector3()));
    const chairs = (props()?.props || [])
      .filter((q) => q !== table && !q.hold && q.root.visible && q.type.cat === 'sedute' && q.type.sub !== 'divani')
      .map((q) => ({ q, f: footOf({ kind: 'prop', obj: q }) }))
      .filter(({ f }) => Math.hypot(f.cx - tfp.cx, f.cz - tfp.cz) < reach)
      .filter(({ q, f }) => Math.abs(wrap(Math.atan2(tfp.cx - f.cx, tfp.cz - f.cz) - q.root.rotation.y)) < 1.0)
      .filter(({ f }) => !others.some((h2) => Math.hypot(h2.x - f.cx, h2.z - f.cz) < 0.4))
      .sort((a, b) => Math.hypot(a.f.cx - ch.root.position.x, a.f.cz - ch.root.position.z) - Math.hypot(b.f.cx - ch.root.position.x, b.f.cz - ch.root.position.z));
    let chair = chairs[0]?.q || null;
    if (!chair) {
      chair = props().add(high ? 'sgabello' : 'sedia', { near: null, select: false });
      if (!chair) fail('Non riesco ad aggiungere una sedia');
      const cfp = footOf({ kind: 'prop', obj: chair });
      // sides of the table: the one toward the character first, then the others
      const yawT = tfp.yaw, ax = [[Math.sin(yawT), Math.cos(yawT)], [-Math.sin(yawT), -Math.cos(yawT)], [Math.cos(yawT), -Math.sin(yawT)], [-Math.cos(yawT), Math.sin(yawT)]];
      const toCh = [ch.root.position.x - tfp.cx, ch.root.position.z - tfp.cz];
      ax.sort((a, b) => (b[0] * toCh[0] + b[1] * toCh[1]) - (a[0] * toCh[0] + a[1] * toCh[1]));
      const obs = obstacles(app, new Set([chair, ch, table]));
      let best = null;
      for (const [dx, dz] of ax) {
        const d = extentAlong(tfp, dx, dz) + extentAlong(cfp, dx, dz) * 0.55;
        const f = findFree(app, tfp.cx + dx * d, tfp.cz + dz * d, { ...cfp, yaw: Math.atan2(-dx, -dz) }, { obstacles: obs, dx: -dz, dz: dx, step: 0.1 });
        if (f.free && Math.hypot(f.x - (tfp.cx + dx * d), f.z - (tfp.cz + dz * d)) < Math.max(tfp.hx, tfp.hz)) { best = { x: f.x, z: f.z }; break; }
        if (!best) best = { x: tfp.cx + dx * d, z: tfp.cz + dz * d };
      }
      props().setYaw(chair, Math.atan2(tfp.cx - best.x, tfp.cz - best.z));
      props().moveTo(chair, best.x, best.z);
      chair.root.position.y = props().floorUnder?.(chair) ?? 0;
      props().ground(chair);
    }
    sit(ch, chair);
    return `${ch.name} ${agreeF(ch, 'seduto', 'seduta')} ${withArticle(table.type.label, 'a')}`;
  }

  /** Picks up a hand-holdable object: the character goes to it and holds it in the nearer hand. */
  function take(ch, prop, { side = null } = {}) {
    const p = prop, M = props();
    if (!p.isHand) fail(`${p.type.label}: troppo grande da prendere in mano`);
    if (p.hold && p.hold.ch === ch) fail(`${ch.name} ce l'ha già in mano`);
    const s = scaleOf(ch);
    refreshRig(ch);
    const c = centerOf({ kind: 'prop', obj: p }, new THREE.Vector3());
    const sh = boneW(ch, 'upperarm01.L', new THREE.Vector3()).add(boneW(ch, 'upperarm01.R', _v)).multiplyScalar(0.5);
    const far = p.hold ? Math.hypot(c.x - sh.x, c.z - sh.z) > 0.9 * s : Math.hypot(c.x - sh.x, c.z - sh.z) > 0.55 * s || c.y < ch.root.position.y + 0.35 * s;
    if (far) {
      if (seatedLike(ch)) standUp(ch, true);
      const spot = spotNear(ch, p.hold ? { kind: 'char', obj: p.hold.ch } : { kind: 'prop', obj: p }, { gap: p.hold ? 0.25 : 0.12, face: c });
      standAt(ch, spot, c);
    }
    // the nearer hand (a free one first)
    refreshRig(ch);
    if (!side) {
      const dL = boneW(ch, 'wrist.L', new THREE.Vector3()).distanceTo(c), dR = boneW(ch, 'wrist.R', new THREE.Vector3()).distanceTo(c);
      const order = dL < dR ? ['L', 'R'] : ['R', 'L'];
      side = order.find((sd) => !M.heldBy(ch, sd)) || order[0];
    }
    if (p.hold) M.detach(p, { emit: false });
    if (!M.attach(p, ch, side, { pose: true })) fail(`Non riesco a dare ${withArticle(p.type.label)} a ${ch.name}`);
    app.posing?.handShape?.(ch, side, 'afferra');
    if (p.type.hand.carry || p.type.hand.radius > 0) M.closeHand(p);
    carryPose(ch, p);
    return `${ch.name} prende ${withArticle(p.type.label)}`;
  }

  /** Puts a held object down: on the floor in front of the holder, or on a surface (a point of it). */
  function putDown(ch, prop, { on = null, point = null } = {}) {
    const p = prop, M = props();
    if (!p.hold) fail(`${p.type.label}: non è in mano a nessuno`);
    const holder = p.hold.ch, side = p.hold.side;
    const s = scaleOf(holder);
    let tx, tz, label;
    if (on) {
      const top = topOf(on);
      if (!top) fail(`Non c'è posto ${withArticle(on.type.label, 'su')}`);
      // the pressed point, else the point of the top nearest to the holder
      const r = { cx: top.x, cz: top.z, yaw: on.root.rotation.y };
      let lx, lz;
      const ref = point || holder.root.position;
      { const dx = ref.x - r.cx, dz = ref.z - r.cz, c = Math.cos(r.yaw), sn = Math.sin(r.yaw); lx = dx * c - dz * sn; lz = dx * sn + dz * c; }
      const mx = Math.max(0, top.hx - 0.08), mz = Math.max(0, top.hz - 0.08);
      lx = Math.max(-mx, Math.min(mx, lx)); lz = Math.max(-mz, Math.min(mz, lz));
      if (!point) { lx *= 0.6; lz *= 0.6; }
      const c = Math.cos(r.yaw), sn = Math.sin(r.yaw);
      tx = r.cx + lx * c + lz * sn; tz = r.cz - lx * sn + lz * c;
      if (Math.hypot(tx - holder.root.position.x, tz - holder.root.position.z) > 0.75 * s) {
        if (seatedLike(holder)) standUp(holder, true);
        const spot = spotNear(holder, { kind: 'prop', obj: on }, { gap: 0.15, face: new THREE.Vector3(tx, top.y, tz) });
        standAt(holder, spot, new THREE.Vector3(tx, top.y, tz));
      }
      label = withArticle(on.type.label, 'su');
    } else {
      const f = forwardOf(holder);
      const left = new THREE.Vector3(Math.cos(holder.root.rotation.y), 0, -Math.sin(holder.root.rotation.y));
      const lat = side === 'L' ? 0.14 : -0.14;
      tx = holder.root.position.x + f.x * 0.42 * s + left.x * lat * s;
      tz = holder.root.position.z + f.z * 0.42 * s + left.z * lat * s;
      label = 'a terra';
    }
    M.detach(p, { emit: false });
    p.root.position.set(tx, (on ? on.worldBox(_box).max.y : floorY(tx, tz)) + 0.02, tz);
    const lr = p.type.lieRot;
    p.root.rotation.set(lr ? lr[0] * Math.PI / 180 : 0, holder.root.rotation.y, lr ? lr[2] * Math.PI / 180 : 0, 'YXZ');
    M.ground(p);
    restoreArm(holder, side);
    return `${holder.name} posa ${withArticle(p.type.label)} ${label}`;
  }

  /** Gives a held object to another character (its nearer free hand). */
  function giveTo(from, to, prop) {
    const side = prop.hold?.side;
    take(to, prop);
    if (from && from !== to && side) restoreArm(from, side);
    return `${to.name} prende ${withArticle(prop.type.label)} da ${from.name}`;
  }

  /** Opens / closes (doors, wardrobes, drawers, fridge, laptop, box, curtains); the actor goes there. */
  function setOpen(prop, open, { ch = null } = {}) {
    const p = prop, def = p.type.params.find((q) => q.id === 'open');
    if (!def) fail(`${p.type.label}: non si apre`);
    let value;
    if (def.type === 'toggle') value = !!open;
    else value = open ? (def.max > 2 ? Math.min(def.max, p.type.id === 'laptop' ? 105 : 95) : def.max) : def.min;
    if (ch) {
      const c = centerOf({ kind: 'prop', obj: p }, new THREE.Vector3());
      const s = scaleOf(ch);
      refreshRig(ch);
      const sh = boneW(ch, 'upperarm01.R', new THREE.Vector3());
      const far = Math.hypot(c.x - sh.x, c.z - sh.z) > (p.localBox.max.x - p.localBox.min.x) * p.scale / 2 + 0.6 * s;
      if (far || facePoint(ch, c) > 1.2) {
        if (seatedLike(ch)) standUp(ch, true);
        const doorGap = /^(armadio|frigo|porta)/.test(p.type.id) ? 0.42 : 0.22;
        standAt(ch, spotNear(ch, { kind: 'prop', obj: p }, { dir: frontOf(p), gap: doorGap, face: c }), c);
      }
    }
    props().setParams(p, { open: value });
    if (ch) {
      const c = centerOf({ kind: 'prop', obj: p }, new THREE.Vector3());
      c.y = Math.min(c.y, headW(ch, _v).y - 0.15);
      aimHead(ch, c);
    }
    const lbl = withArticle(p.type.label);
    return open ? `${ch ? ch.name + ' apre' : 'Aperto:'} ${lbl}` : `${ch ? ch.name + ' chiude' : 'Chiuso:'} ${lbl}`;
  }

  /** Head and eyes toward the object (the body turns when it is behind). */
  function look(ch, target, point = null) {
    const t = asTarget(target);
    const P = point ? point.clone() : centerOf(t, new THREE.Vector3());
    if (!point && t.kind === 'prop') { const b = boxOf(t, _box); P.y = Math.min(b.max.y, Math.max(b.min.y, P.y)); }
    if (facePoint(ch, P) > 1.75 && !seatedLike(ch)) {
      const yaw = Math.atan2(P.x - ch.root.position.x, P.z - ch.root.position.z);
      place(ch, ch.root.position.x, ch.root.position.z, yaw, ch.root.position.y);
    }
    aimHead(ch, P);
    return `${ch.name} guarda ${withArticle(nameOf(t))}`;
  }

  /** Stands in front of the target (its front for furniture), facing it. */
  function approach(ch, target, { gap = 0.3 } = {}) {
    const t = asTarget(target);
    if (seatedLike(ch)) standUp(ch, true);
    const c = centerOf(t, new THREE.Vector3());
    const aff = new Set(affordancesOf(t));
    const dir = isProp(t) && (aff.has('openable') || aff.has('table') || aff.has('seat') || /^(armadio|libreria|frigo|cucina|tv|mobile_tv|lavabo|camino)/.test(t.obj.type.id)) && !aff.has('building') ? frontOf(t.obj) : null;
    standAt(ch, spotNear(ch, t, { dir, gap, face: c }), c);
    aimHead(ch, c.setY(Math.min(c.y, headW(ch, _v).y)));
    return `${ch.name} si avvicina ${withArticle(nameOf(t), 'a')}`;
  }

  /** Kneels in front of / beside the target, facing it. */
  function kneel(ch, target) {
    const t = asTarget(target);
    const c = centerOf(t, new THREE.Vector3());
    if (seatedLike(ch)) standUp(ch, true);
    const aff = new Set(affordancesOf(t));
    // a bed: at its long side nearest to the character
    let dir = null;
    if (isProp(t) && aff.has('bed')) {
      const yaw = t.obj.root.rotation.y, side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      if (side.dot(_v.set(ch.root.position.x - c.x, 0, ch.root.position.z - c.z)) < 0) side.negate();
      dir = side;
    }
    standAt(ch, spotNear(ch, t, { dir, gap: 0.12, face: c }), c);
    applyPosePreset(ch, t.kind === 'animal' ? 'kneel_one' : 'kneel', { keepHands: holding(ch).length > 0 });
    aimHead(ch, c);
    return `${ch.name} si inginocchia davanti ${withArticle(nameOf(t), 'a')}`;
  }

  /**
   * Leans: against a wall-like thing (back to it, at the pressed point), or with both
   * hands on a table / desk / counter (pinned when app.posing.pinTo is available).
   */
  function lean(ch, target, { point = null, normal = null } = {}) {
    const t = asTarget(target);
    const aff = new Set(affordancesOf(t));
    const s = scaleOf(ch);
    if (isProp(t) && (aff.has('table') || (aff.has('surface') && !aff.has('wall')))) {
      const T = t.obj;
      // the pressed point on the top (a counter under wall cabinets: the ray from above sees them)
      const pressed = point && normal && normal.y > 0.8;
      const top = topOf(T) || (pressed ? { x: point.x, z: point.z, y: point.y, yaw: T.root.rotation.y } : null);
      if (!top) fail(`Non riesco ad appoggiarmi ${withArticle(T.type.label, 'a')}`);
      if (pressed) top.y = point.y;
      const ref = point || ch.root.position;
      const c = Math.cos(top.yaw), sn = Math.sin(top.yaw);
      // the real edges of the top (round tables, L-shaped counters): walked with short rays
      // from the pressed point (else the middle of the top) along the top's four directions
      const rc = new THREE.Raycaster();
      const onTopAt = (x, z) => { rc.set(_v.set(x, top.y + 0.25, z), DOWN); rc.far = 0.4; const hit = rc.intersectObjects(T.meshes, false)[0]; return !!hit && Math.abs(hit.point.y - top.y) < 0.05; };
      const edgeFrom = (x, z, o) => {
        if (!onTopAt(x, z)) return null;
        let lo = 0, hi = null;
        for (let d = 0.08; d <= 4; d += 0.08) { if (!onTopAt(x + o.x * d, z + o.z * d)) { hi = d; break; } lo = d; }
        if (hi === null) return null;
        for (let i = 0; i < 4; i++) { const m = (lo + hi) / 2; if (onTopAt(x + o.x * m, z + o.z * m)) lo = m; else hi = m; }
        return new THREE.Vector3(x + o.x * lo, top.y, z + o.z * lo);
      };
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([nx, nz]) => new THREE.Vector3(nx * c + nz * sn, 0, -nx * sn + nz * c));
      // start on the top: the pressed point (or a step inside it when it is right on an edge), else the middle
      let sx = top.x, sz = top.z;
      const starts = [[ref.x, ref.z], ...dirs.flatMap((o) => [0.06, 0.15].map((k) => [ref.x + o.x * k, ref.z + o.z * k]))];
      for (const [x, z] of starts) if (onTopAt(x, z)) { sx = x; sz = z; break; }
      const edges = [];
      for (const out of dirs) {
        const lat = new THREE.Vector3(-out.z, 0, out.x);
        const e0 = edgeFrom(sx, sz, out);
        if (!e0) continue;
        const list = [];
        for (const k of [0, 0.3, -0.3, 0.6, -0.6]) {
          const e = k ? edgeFrom(sx + lat.x * k, sz + lat.z * k, out) : e0;
          if (e) list.push(e);
        }
        edges.push({ out, d: Math.hypot(e0.x - ref.x, e0.z - ref.z), list });
      }
      if (!edges.length) fail(`Non riesco ad appoggiarmi ${withArticle(T.type.label, 'a')}`);
      edges.sort((p1, p2) => p1.d - p2.d); // the edge nearest to the pressed point (or the character) first
      const cands = [];
      // standing close to the edge (the hips a hand's width from it), the arms nearly straight;
      // inside the room the table stands in (a counter against a wall: never behind it)
      const R = roomOf(sx, sz);
      const inRoom = (x, z) => { if (!R) return true; const l = toRoom(R, x, z); return Math.abs(l.x) <= R.W / 2 - 0.22 * s && Math.abs(l.z) <= R.D / 2 - 0.22 * s; };
      for (const { out, list } of edges) for (const edge of list) {
        const x = edge.x + out.x * LEAN_GAP * s, z = edge.z + out.z * LEAN_GAP * s;
        if (inRoom(x, z)) cands.push({ x, z, edge, out });
      }
      if (!cands.length) fail(`Non c'è spazio libero ${withArticle(T.type.label, 'a')}`);
      // a free spot at an edge; at a dining table the chair there is pulled out (as a person
      // does); never inside a chair or another character
      const pick = freeSpot(ch, cands, [T]) || pullChair(ch, cands, T);
      if (!pick) fail(`Non c'è spazio libero ${withArticle(T.type.label, 'a')}`);
      const { edge, out } = pick;
      if (seatedLike(ch)) standUp(ch, true);
      place(ch, pick.x, pick.z, Math.atan2(-out.x, -out.z));
      const inward = out.clone().negate(), lat = new THREE.Vector3(-inward.z, 0, inward.x);
      // the palms go on a free part of the top near its edge (not on the plates, the bowl…)
      const onTop = (props()?.props || []).filter((q) => q !== T && !q.hold && q.root.visible && Math.abs(q.worldBox(_box).min.y - top.y) < 0.06)
        .map((q) => footOf({ kind: 'prop', obj: q }));
      const busy = (pt) => onTop.some((f) => {
        const c2 = Math.cos(f.yaw), s2 = Math.sin(f.yaw), dx = pt.x - f.cx, dz = pt.z - f.cz;
        return Math.abs(dx * c2 - dz * s2) < f.hx + 0.06 && Math.abs(dx * s2 + dz * c2) < f.hz + 0.06;
      });
      const pin = (side, k) => {
        let pt = null;
        for (const [inw, lt] of PALM_SPOTS) {
          const q = edge.clone().addScaledVector(inward, inw * s).addScaledVector(lat, k * lt * s);
          if (!busy(q)) { pt = q; break; }
        }
        if (!pt) pt = edge.clone().addScaledVector(inward, 0.03 * s).addScaledVector(lat, k * 0.2 * s); // right on the edge
        pt.y = top.y + 0.012;
        if (app.posing?.pinTo) {
          // a contact on the top (it follows the table; kept while the body moves), palm flat and open
          try {
            app.posing.pinTo(ch, 'hand.' + side, pt, UP.clone(), { keep: true, target: { prop: T } });
            app.posing.handShape?.(ch, side, 'aperta');
            return;
          } catch (e) { console.warn('[actions] posing.pinTo', e); }
        }
        reachHand(ch, side, pt, { palmDir: DOWN, knuckles: inward, body: true });
        applyHandPreset(ch, 'open', side, 0.85);
      };
      pin('L', 1); pin('R', -1);
      return `${ch.name} si appoggia ${withArticle(T.type.label, 'a')}`;
    }
    // back against a vertical surface
    let P = point ? point.clone() : null, n = normal ? normal.clone().setY(0) : null;
    if (!P || !n || n.lengthSq() < 0.05) {
      const c = centerOf(t, new THREE.Vector3());
      const fp = footOf(t);
      let dx = ch.root.position.x - fp.cx, dz = ch.root.position.z - fp.cz;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      n = new THREE.Vector3(dx, 0, dz);
      const e = extentAlong(fp, dx, dz);
      P = new THREE.Vector3(fp.cx + dx * e, c.y, fp.cz + dz * e);
    }
    n.normalize();
    if (seatedLike(ch)) standUp(ch, true);
    // the pressed point, else slide along the surface, else another side of the object
    const cands = [];
    const tg = new THREE.Vector3(-n.z, 0, n.x);
    for (const k of [0, 1, -1, 2, -2, 3, -3]) cands.push({ x: P.x + n.x * 0.3 * s + tg.x * k * 0.22, z: P.z + n.z * 0.3 * s + tg.z * k * 0.22, P: P.clone().addScaledVector(tg, k * 0.22), n });
    if (!point && t.kind === 'prop') {
      const fp = footOf(t), cy = Math.cos(fp.yaw), sy = Math.sin(fp.yaw);
      for (const [ax, az] of [[sy, cy], [-sy, -cy], [cy, -sy], [-cy, sy]]) {
        const e = extentAlong(fp, ax, az), nn = new THREE.Vector3(ax, 0, az);
        const PP = new THREE.Vector3(fp.cx + ax * e, P.y, fp.cz + az * e);
        cands.push({ x: PP.x + ax * 0.3 * s, z: PP.z + az * 0.3 * s, P: PP, n: nn });
      }
      const cp = ch.root.position;
      const tail = cands.splice(7).sort((a, b) => Math.hypot(a.x - cp.x, a.z - cp.z) - Math.hypot(b.x - cp.x, b.z - cp.z));
      cands.push(...tail);
    }
    const pick = freeSpot(ch, cands, [t.obj]) || cands[0];
    P = pick.P; n = pick.n;
    place(ch, pick.x, pick.z, Math.atan2(n.x, n.z));
    applyPosePreset(ch, 'lean_wall', { keepHands: holding(ch).length > 0 });
    // slide back until the back touches the surface plane
    ch.root.updateMatrixWorld(true);
    const pos = ch.getSkinnedPositions?.();
    if (pos) {
      const M = ch.rig.matrixWorld, body = ch.model.groupVertices[0], floor = ch.root.position.y;
      let min = Infinity;
      for (let k = 0; k < body.length; k += 4) {
        const i = body[k] * 3;
        _v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(M);
        if (_v.y - floor < 0.75 * s) continue; // buttocks, back and shoulders (not the heels)
        const d = (_v.x - P.x) * n.x + (_v.z - P.z) * n.z;
        if (d < min) min = d;
      }
      if (Number.isFinite(min)) moveBy(ch, -n.x * (min - 0.03 * s), -n.z * (min - 0.03 * s));
    }
    for (const q of holding(ch)) carryPose(ch, q);
    return `${ch.name} si appoggia ${withArticle(nameOf(t), 'a')}`;
  }

  /** Strokes an animal's back: beside it, kneeling for small ones, the nearer hand on its back. */
  function pet(ch, animal) {
    const t = asTarget(animal), a = t.obj;
    const b = a.worldBox(new THREE.Box3()), c = b.getCenter(new THREE.Vector3());
    const yaw = a.root.rotation.y;
    // beside it (the side toward the character)
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    if (side.dot(_v.set(ch.root.position.x - c.x, 0, ch.root.position.z - c.z)) < 0) side.negate();
    if (seatedLike(ch)) standUp(ch, true);
    standAt(ch, spotNear(ch, t, { dir: side, gap: 0.05, face: c }), c);
    const ray = new THREE.Ray(new THREE.Vector3(c.x, b.max.y + 0.5, c.z), DOWN.clone());
    const hit = a.raycast?.(ray);
    const back = hit ? hit.point.clone() : new THREE.Vector3(c.x, b.max.y - 0.03, c.z);
    const s = scaleOf(ch);
    const low = back.y - ch.root.position.y < 0.6 * s;
    if (low) applyPosePreset(ch, 'kneel_one', { keepHands: holding(ch).length > 0 });
    refreshRig(ch);
    const dL = boneW(ch, 'upperarm01.L', new THREE.Vector3()).distanceTo(back), dR = boneW(ch, 'upperarm01.R', new THREE.Vector3()).distanceTo(back);
    const hs = holding(ch).some((p) => p.hold.side === (dL < dR ? 'L' : 'R')) ? (dL < dR ? 'R' : 'L') : (dL < dR ? 'L' : 'R');
    const pt = back.clone().addScaledVector(UP, 0.02);
    let done = false;
    if (app.posing?.reach) { try { done = app.posing.reach(ch, 'hand.' + hs, pt) !== false; } catch (e) { console.warn('[actions] posing.reach', e); } }
    if (!done) reachHand(ch, hs, pt, { palmDir: DOWN, knuckles: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), body: true });
    applyHandPreset(ch, 'relaxed', hs, 0.6);
    aimHead(ch, c);
    return `${ch.name} accarezza ${withArticle(nameOf(t))}`;
  }

  /** Looks out of a window (a window prop, a wall with a window, the room's window). */
  function lookOut(ch, prop, point = null) {
    const p = prop;
    let W = null, inward = null;
    if (p.type.id === 'stanza') {
      const r = roomAt(app, p.root.position.x, p.root.position.z);
      W = r && roomOpening(r, 'window');
      if (W) inward = new THREE.Vector3(r.cx - W.x, 0, r.cz - W.z).normalize();
    }
    if (!W) {
      const b = p.worldBox(new THREE.Box3());
      W = point ? point.clone() : b.getCenter(new THREE.Vector3());
      if (!point) W.y = Math.min(b.max.y - 0.3, 1.45);
      const f = frontOf(p);
      // inside = the side the character is on
      if (f.dot(_v.set(ch.root.position.x - W.x, 0, ch.root.position.z - W.z)) < 0) f.negate();
      inward = f;
    }
    if (seatedLike(ch)) standUp(ch, true);
    const s = scaleOf(ch);
    const x = W.x + inward.x * 0.42 * s, z = W.z + inward.z * 0.42 * s;
    place(ch, x, z, Math.atan2(-inward.x, -inward.z));
    const far = W.clone().addScaledVector(inward, -4).setY(Math.max(ch.root.position.y + 1.3 * s, W.y - 0.2));
    aimHead(ch, far);
    return `${ch.name} guarda fuori dalla finestra`;
  }

  // ---------------------------------------------------------------- object tools
  /** structure of a room: Stanza, Pavimento, Muro (and their variants) */
  const roomPart = (p) => ROOM_PARTS.has(p.type.variantOf || p.type.id);
  const isBuilding = (p) => p.type.cat === 'edifici';
  const isCity = (p) => p.type.cat === 'esterni';
  function toolFor(t) {
    if (t.kind === 'animal') return 'animals';
    return isBuilding(t.obj) ? 'buildings' : isCity(t.obj) ? 'exteriors' : 'props';
  }
  function selectTarget(t) {
    if (t.kind === 'animal') app.animals?.select(t.obj);
    else props().select(t.obj);
  }
  function openToolFor(t, snap) {
    selectTarget(t);
    const id = toolFor(t);
    if (shell.activeToolId !== id) shell.openTool(id);
    selectTarget(t); // opening a tool may reset its selection
    if (shell.mode === 'sheet' && snap) shell.setSheetSnap?.(snap, { persist: false });
  }

  // ---------------------------------------------------------------- one undo step per action
  let busy = false;
  async function run(label, fn) {
    if (busy) return false;
    busy = true;
    try {
      const msg = await app.history.batch(label, fn);
      app.invalidate();
      haptic('success');
      return msg || true;
    } catch (e) {
      if (e instanceof ActionError) { toast(e.message, { kind: 'warning' }); haptic('warning'); }
      else { console.error('[actions]', label, e); toast('Azione non riuscita', { kind: 'error' }); }
      app.invalidate();
      return false;
    } finally { busy = false; }
  }
  const withActor = (ch, fn) => () => { if (!ch || !app.characters.includes(ch)) fail('Aggiungi o seleziona un personaggio'); const r = fn(); app.select(ch, null); return r; };

  // ---------------------------------------------------------------- menu
  function actorFor(target) {
    const t = asTarget(target);
    const chars = visibleChars();
    if (t?.kind === 'prop' && t.obj.hold && chars.includes(t.obj.hold.ch)) return t.obj.hold.ch;
    const sel = app.selection.character;
    if (sel && chars.includes(sel)) return sel;
    if (!chars.length || !t) return null;
    const c = centerOf(t, new THREE.Vector3());
    return chars.reduce((a, b) => (Math.hypot(b.root.position.x - c.x, b.root.position.z - c.z) < Math.hypot(a.root.position.x - c.x, a.root.position.z - c.z) ? b : a));
  }

  /** Surfaces (tables, desks, counters, nightstands) within reach of a character. */
  function nearSurface(ch, except = null) {
    let best = null, bd = 2.6;
    for (const q of props()?.props || []) {
      if (q === except || q.hold || !q.root.visible) continue;
      const a = affordancesOf(q);
      if (!a.includes('surface')) continue;
      const f = footOf({ kind: 'prop', obj: q });
      const d = Math.hypot(f.cx - ch.root.position.x, f.cz - ch.root.position.z) - Math.max(f.hx, f.hz);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  /** Menu items for a target and an actor (null: object tools only). */
  function itemsFor(t, ch, hit) {
    const items = [];
    const A = new Set(affordancesOf(t));
    const act = (id, text, ic, fn, hint) => items.push({ id, label: text, icon: ic, hint, onClick: () => run(text.toLowerCase(), withActor(ch, fn)) });
    if (isProp(t)) {
      const p = t.obj;
      if (A.has('held')) {
        const holder = p.hold.ch;
        if (ch && ch !== holder) act('take', `Prendi da ${holder.name}`, 'hand', () => giveTo(holder, ch, p));
        items.push({ id: 'put-floor', label: 'Posa a terra', icon: 'download', onClick: () => run('posa a terra', () => putDown(holder, p)) });
        const T = nearSurface(holder);
        if (T) items.push({ id: 'put-table', label: `Posa ${withArticle(T.type.label, 'su')}`, icon: 'download', onClick: () => run('posa', () => putDown(holder, p, { on: T })) });
        items.push({ id: 'swap-hand', label: 'Cambia mano', icon: 'swap', onClick: () => run('cambia mano', () => { const sd = p.hold.side === 'L' ? 'R' : 'L'; props().attach(p, holder, sd, { pose: true }); restoreArm(holder, sd === 'L' ? 'R' : 'L'); carryPose(holder, p); return 'Cambia mano'; }) });
        return items;
      }
      if (ch) {
        const held = holding(ch);
        if (A.has('surface') && held.length) {
          for (const q of held.slice(0, 2)) items.push({ id: 'put-here', label: `Posa qui: ${q.type.label.toLowerCase()}`, icon: 'download', onClick: () => run('posa', withActor(ch, () => putDown(ch, q, { on: p, point: hit.point }))) });
        }
        if (A.has('carry')) act('take', 'Prendi', 'hand', () => take(ch, p));
        if (A.has('table')) act('sit-table', `Siediti ${withArticle(p.type.label, 'a')}`, 'chair', () => sitAtTable(ch, p));
        if (A.has('seat') || A.has('sofa') || A.has('bed')) act('sit', 'Siediti', 'chair', () => sit(ch, p, { point: hit.point }));
        if (A.has('floor')) act('sit-floor', 'Siediti a terra', 'chair', () => sitFloor(ch, p));
        if (A.has('bed') || A.has('sofa') || A.has('floor')) items.push({ id: 'lie', label: 'Sdraiati…', icon: 'sofa', keepOpen: true, onClick: () => lieMenu(t, ch, hit) });
        if (A.has('openable')) {
          const open = isOpen(p);
          act(open ? 'close' : 'open', open ? 'Chiudi' : 'Apri', open ? 'lock' : 'unlock', () => setOpen(p, !open, { ch }));
        }
        if (A.has('window')) act('look-out', 'Guarda fuori', 'eye', () => lookOut(ch, p, hit.point));
        if (A.has('table') || A.has('wall') || leanTop(p, A, hit)) act('lean', A.has('table') || !A.has('wall') ? 'Appoggiati al piano' : 'Appoggiati', 'body', () => lean(ch, t, hit));
        if (A.has('kneel')) act('kneel', 'Inginocchiati', 'pose', () => kneel(ch, t));
        act('look', 'Guarda', 'eye', () => look(ch, t, hit.point));
        if (A.has('approach')) act('approach', 'Avvicinati', 'footprint', () => approach(ch, t));
      } else if (A.has('openable')) {
        const open = isOpen(p);
        items.push({ id: open ? 'close' : 'open', label: open ? 'Chiudi' : 'Apri', icon: open ? 'lock' : 'unlock', onClick: () => run(open ? 'chiudi' : 'apri', () => setOpen(p, !open)) });
      }
    } else if (ch) {
      act('pet', 'Accarezza', 'heart', () => pet(ch, t));
      act('look', 'Guarda', 'eye', () => look(ch, t, hit.point));
      act('approach', 'Avvicinati', 'footprint', () => approach(ch, t, { gap: 0.2 }));
      act('kneel', 'Inginocchiati accanto', 'pose', () => kneel(ch, t));
    }
    if (!items.length && !ch) items.push({ id: 'none', label: 'Aggiungi un personaggio per farlo agire', icon: 'userPlus', onClick: () => app.modules.ui?.openPeople?.({ add: true }) });
    // the walls of a room are part of the set: its ambient light is one step away
    if (isProp(t) && roomPart(t.obj) && app.practicals?.ambientMenu) items.push({ id: 'ambient', label: 'Luce ambientale…', icon: 'sun', hint: 'Giorno, tramonto, notte', onClick: () => app.practicals.ambientMenu(hit.x, hit.y) });
    return items;
  }
  /** a counter, a chest of drawers, a dresser: a top between 0.7 and 1.15 m one can lean on with both hands */
  function leanTop(p, A, hit) {
    if (!A.has('surface') || A.has('wall')) return false;
    // the pressed top itself when it faces up (a counter under wall cabinets), else the top seen from above
    const y = hit?.point && hit.normal?.y > 0.8 ? hit.point.y : topOf(p)?.y;
    const h = y == null ? -1 : y - p.root.position.y;
    return h >= 0.7 && h <= 1.15;
  }
  const isOpen = (p) => { const v = p.params.open; return typeof v === 'boolean' ? v : v > (p.type.params.find((q) => q.id === 'open')?.min ?? 0) + 1e-3; };

  function lieMenu(t, ch, hit) {
    closeMenu();
    const p = t.obj;
    const go = (variant, text) => run(text.toLowerCase(), withActor(ch, () => lie(ch, p, variant)));
    const list = h('div', { class: 'pv-menu pv-stage-menu-list pv-oa-list', role: 'menu' }, renderItems([
      { id: 'lie-back', label: 'Sulla schiena', icon: 'sofa', onClick: () => go('back', 'Sdraiati sulla schiena') },
      { id: 'lie-side', label: 'Su un fianco', icon: 'sofa', onClick: () => go('side', 'Sdraiati su un fianco') },
      { id: 'lie-front', label: 'A pancia in giù', icon: 'sofa', onClick: () => go('front', 'Sdraiati a pancia in giù') },
    ]));
    const m = stageMenu([], { x: hit.x, y: hit.y, title: 'Sdraiati', subtitle: `${ch.name} · ${nameOf(t)}`, width: 250, body: list, onClose: () => { if (current === m) current = null; } });
    m.el.classList.add('pv-oa');
    current = m;
  }

  function toolsRow(t) {
    const btn = (id, ic, text, fn, danger = false) => {
      const b = h('button', { type: 'button', class: 'pv-oa-tool' + (danger ? ' danger' : ''), 'data-tool': id, title: text }, icon(ic, 20), h('span', {}, text));
      b.addEventListener('click', () => { haptic('tick'); closeMenu(); setTimeout(fn, 0); });
      return b;
    };
    const held = isProp(t) && t.obj.hold;
    return h('div', { class: 'pv-oa-tools' },
      held ? null : btn('move', 'move', 'Sposta', () => api.move(t)),
      held ? null : btn('rotate', 'rotate', 'Ruota 90°', () => api.rotate90(t)),
      btn('duplicate', 'copy', 'Duplica', () => api.duplicate(t)),
      btn('remove', 'trash', 'Elimina', () => api.remove(t), true),
      btn('details', 'sliders', 'Dettagli', () => api.details(t)));
  }

  function renderItems(items) {
    const out = [];
    for (const it of items) {
      if (!it) continue;
      if (it.separator) { out.push(h('div', { class: 'pv-menu-sep' })); continue; }
      if (it.header) { out.push(h('div', { class: 'pv-menu-header' }, it.header)); continue; }
      const check = it.checked || it.checkable ? icon('check', 18) : null;
      if (check) check.classList.add('pv-menu-check');
      const b = h('button', { type: 'button', role: 'menuitem', class: `pv-menu-item ${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}`.trim(), disabled: it.disabled },
        it.icon ? icon(it.icon, 20) : h('span', { class: 'pv-menu-noicon' }),
        h('span', { class: 'pv-menu-label' }, it.label, it.hint ? h('small', {}, it.hint) : null),
        check);
      if (it.id) { b.dataset.action = it.id; b.dataset.id = it.id; }
      b.addEventListener('click', () => { haptic('tick'); if (!it.keepOpen) closeMenu(); setTimeout(() => it.onClick?.(), 0); });
      out.push(b);
    }
    return out;
  }

  let current = null;
  function closeMenu() { const m = current; current = null; m?.close?.(null); }
  // (the click of the finger that opened a menu is ignored by kit.stageMenu itself)

  /**
   * Opens the long-press menu of a target at screen point (x, y). opts.point / normal:
   * the pressed surface point (world) and its normal; opts.actor: who acts.
   */
  function openMenu(target, { x, y, point = null, normal = null, actor } = {}) {
    const t = asTarget(target);
    if (!t) return null;
    closeMenu();
    let ch = actor !== undefined ? actor : actorFor(t);
    const hit = { point, normal, x, y };
    const chars = visibleChars();
    const list = h('div', { class: 'pv-menu pv-stage-menu-list pv-oa-list', role: 'menu' });
    let section = null;
    // a light source (lamp, screen, flame, window; a room or a wall only near its window): its
    // controls first (app.practicals, scene module)
    const PR = app.practicals;
    if (isProp(t) && PR?.menuSection && (PR.hitsSource ? PR.hitsSource(t.obj, point) : PR.isSource?.(t.obj))) {
      try { section = PR.menuSection(t.obj); } catch (e) { console.warn('[actions] practicals.menuSection', e); }
    }
    const subtitle = () => (ch ? `${ch.name}` : 'Nessun personaggio');
    let who = null;
    if (chars.length > 1 && !(isProp(t) && t.obj.hold && !chars.some((c) => c !== t.obj.hold.ch))) {
      who = h('div', { class: 'pv-oa-who' }, h('span', { class: 'pv-oa-who-label' }, 'Chi?'));
      const row = h('div', { class: 'pv-oa-who-chips' });
      for (const c of chars) {
        const b = h('button', { type: 'button', class: 'pv-chip' + (c === ch ? ' active' : ''), 'data-character': c.id }, c.name);
        b.addEventListener('click', () => {
          haptic('tick');
          ch = c;
          for (const x2 of row.children) x2.classList.toggle('active', x2 === b);
          render();
        });
        row.appendChild(b);
      }
      who.appendChild(row);
    }
    // a light's menu stays short (the light being adjusted stays in view): the object's own
    // actions and tools wait behind "Azioni…"
    let expanded = !section?.body;
    const tools = toolsRow(t);
    const render = () => {
      const own = itemsFor(t, ch, hit);
      const more = { id: 'more', label: 'Azioni…', icon: 'more', hint: own.slice(0, 3).map((o) => o.label).join(', '), keepOpen: true, onClick: () => { expanded = true; render(); } };
      const rest = expanded ? own : own.length ? [more] : [];
      const its = section?.items?.length ? [...section.items, rest.length ? { separator: true } : null, ...rest] : rest;
      list.replaceChildren(...renderItems(its));
      tools.hidden = !expanded;
      if (who) who.hidden = !expanded && !!section?.body;
      const sub = current?.card?.querySelector('.pv-modal-subtitle');
      if (sub) sub.textContent = subtitle();
    };
    render();
    // a window of a room or a wall: the menu is the window's (not "Stanza")
    const title = section && PR.isWindow?.(t.obj) ? PR.state(t.obj)?.label || 'Finestra' : nameOf(t);
    const tablet = document.documentElement.classList.contains('pv-tablet');
    const m = stageMenu([], {
      x, y, title, subtitle: subtitle(), width: section?.body && tablet ? 380 : 288, side: !!section?.body,
      body: [section?.body || null, who, list, tools].filter(Boolean),
      onClose: () => { if (current === m) current = null; },
    });
    m.el.classList.add('pv-oa');
    current = m;
    return m;
  }

  // ---------------------------------------------------------------- long press
  const _rc = new THREE.Raycaster();
  /** What is under a screen point: {target, point, normal, distance} | null (characters in front win). */
  function pickAt(ndc) {
    let best = null;
    const hp = props()?.pick?.(ndc);
    if (hp) best = { target: { kind: 'prop', obj: hp.prop }, point: hp.point, distance: hp.distance };
    const ha = app.animals?.pick?.(ndc);
    if (ha && (!best || ha.distance < best.distance)) best = { target: { kind: 'animal', obj: ha.animal }, point: ha.point, distance: ha.distance };
    if (!best) return null;
    if (best.target.kind === 'animal') {
      const c = app.posing?.pick?.(ndc);
      if (c?.point && c.point.distanceTo(app.camera.position) < best.distance - 0.02) return null;
    }
    // the surface normal (world) of the pressed prop point
    if (best.target.kind === 'prop') {
      _rc.setFromCamera(ndc, app.camera);
      const p = best.target.obj;
      p.root.updateWorldMatrix(true, true);
      const h2 = _rc.intersectObjects(p.meshes, false)[0];
      if (h2?.face) best.normal = h2.face.normal.clone().transformDirection(h2.object.matrixWorld);
    }
    return best;
  }

  app.addHoldHandler(({ ndc, x, y }) => {
    const hit = pickAt(ndc);
    if (!hit) return false;
    // the floor and the ceiling of a room are the empty space of the set: the long press
    // there is "Luce ambientale" (scene module, priority 0); its walls keep their actions
    const t = hit.target;
    if (isProp(t) && roomPart(t.obj) && !app.practicals?.hitsSource?.(t.obj, hit.point)) {
      if ((t.obj.type.variantOf || t.obj.type.id) === 'pavimento' || !hit.normal || Math.abs(hit.normal.y) > 0.6) return false;
    }
    openMenu(t, { x, y, point: hit.point, normal: hit.normal || null });
    // the finger stays down until released: no orbit meanwhile, the release is not a tap
    return { move() {}, end() {} };
  }, 50);

  // ---------------------------------------------------------------- voice (same actions by words)
  const VERBS = [
    ['lookOut', /\b(guard[aio]|affacci[ao]t?i?|si affaccia)\b.*\b(fuori|finestra)\b/],
    ['sitTable', /\b(siediti|si siede|sieda|siedi|sedersi|accomodati|si accomoda|fai sedere|fallo sedere|falla sedere)\b.*\b(al|alla|allo)\b/],
    ['sit', /\b(siediti|si siede|sieda|siedi|sedersi|accomodati|si accomoda|fai sedere|fallo sedere|falla sedere)\b/],
    ['lie', /\b(sdraiati|si sdraia|sdraiarsi|stenditi|si stende|distenditi|si distende|coricati|si corica|fai sdraiare)\b/],
    ['put', /\b(posa|posi|appoggia giu|appoggia giù|metti giu|metti giù|lascia|molla)\b/],
    ['take', /\b(prendi|prende|prenda|afferra|afferri|raccogli|raccoglie|impugna|solleva)\b/],
    ['open', /\b(apri|apre|aprire|spalanca)\b/],
    ['close', /\b(chiudi|chiude|chiudere)\b/],
    ['lean', /\b(appoggiati|si appoggia|appoggiarsi|addossati)\b/],
    ['kneel', /\b(inginocchiati|si inginocchia|inginocchiarsi)\b/],
    ['pet', /\b(accarezza|accarezzi|coccola)\b/],
    ['approach', /\b(avvicinati|si avvicina|vai|va')\b/],
    ['look', /\b(guarda|guardi|osserva|fissa)\b/],
  ];
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, '\'').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const stemOf = (w) => w.replace(/(i|e|a|o)$/, '');
  /** Names an object can be called by: its label, the label's first noun, the type id words. */
  function namesOf(t) {
    const out = [];
    const lab = norm(nameOf(t));
    if (lab) out.push(lab);
    const first = lab.split(' ')[0];
    if (first && first.length > 2) out.push(first);
    if (t.kind === 'animal') { const sp = norm(t.obj.entry?.label || t.obj.species || ''); if (sp) out.push(sp, sp.split(' ')[0]); }
    else for (const w of norm(t.obj.type.id.replace(/^(ph|phc|es|ls|ed)_/, '').replace(/_/g, ' ')).split(' ')) if (w.length > 3) out.push(w);
    return [...new Set(out)];
  }
  function findTarget(s, ch, { held = false, exclude = null } = {}) {
    const cands = [];
    for (const p of props()?.props || []) if (p.root.visible && p !== exclude && (held ? !!p.hold : true)) cands.push({ kind: 'prop', obj: p });
    if (!held) for (const a of app.animals?.animals || []) if (a.root.visible) cands.push({ kind: 'animal', obj: a });
    let best = null;
    for (const t of cands) {
      for (const n of namesOf(t)) {
        const re = new RegExp(`(^|\\s|')${stemOf(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-z]{0,2}(\\s|$)`);
        if (!re.test(s)) continue;
        const score = n.length + (n === norm(nameOf(t)) ? 5 : 0);
        const c = centerOf(t, _v);
        const d = ch ? Math.hypot(c.x - ch.root.position.x, c.z - ch.root.position.z) : 0;
        if (!best || score > best.score || (score === best.score && d < best.d)) best = { t, score, d };
      }
    }
    return best?.t || null;
  }
  function findActor(s) {
    const chars = visibleChars();
    for (const c of chars) if (c.name && new RegExp(`(^|\\s)${norm(c.name)}(\\s|$)`).test(s)) return c;
    if (/\b(la donna|una donna|lei|la ragazza)\b/.test(s)) return chars.find((c) => c.sex === 'F') || null;
    if (/\b(l'uomo|l uomo|un uomo|lui|il ragazzo)\b/.test(s)) return chars.find((c) => c.sex === 'M') || null;
    return null;
  }
  /**
   * Understands "siediti sul divano", "Anna si sdraia sul letto a pancia in giù",
   * "prendi il vaso", "posa il vaso sul tavolo", "apri l'armadio", "chiudi il frigo",
   * "appoggiati al muro", "inginocchiati davanti al letto", "accarezza il cane",
   * "guarda fuori dalla finestra". Returns null when the text is not about an object.
   */
  function voiceMatch(text) {
    const s = norm(text);
    if (!s || /\b(scena|scene|progett|paesagg|salva|applica|inserisci|tavola \d|camera|inquadr)\b/.test(s)) return null;
    if (/(,|\be poi\b|\bpoi\b|\bmetti\b|\baggiungi\b|\bcrea\b)/.test(s)) return null;
    const hitVerb = VERBS.find(([, re]) => re.test(s));
    if (!hitVerb) return null;
    let verb = hitVerb[0];
    const named = findActor(s);
    const ch = named || actorFor(null) || app.selection.character || visibleChars()[0] || null;
    let target = null, on = null, variant = null;
    if (verb === 'put') {
      target = findTarget(s, ch, { held: true });
      if (!target && ch) { const hs = holding(ch); if (hs.length === 1) target = { kind: 'prop', obj: hs[0] }; }
      if (!/\b(a terra|per terra|sul pavimento)\b/.test(s)) on = findTarget(s.replace(/^.*?\b(sul|sulla|sullo|sull'|sopra)\b/, ''), ch, { exclude: target?.obj });
      if (on && on.kind !== 'prop') on = null;
    } else target = findTarget(s, ch);
    if (verb === 'lie') variant = /\b(pancia in giu|prono|prona|a faccia in giu)\b/.test(s) ? 'front' : /\b(fianco|di lato)\b/.test(s) ? 'side' : 'back';
    if (verb === 'lie' && !target && /\b(a terra|per terra|sul pavimento)\b/.test(s)) return { verb, ch, target: null, variant };
    if (!target) return null;
    if (verb === 'sitTable' && !(isProp(target) && affordancesOf(target).includes('table'))) verb = 'sit';
    if (verb === 'lookOut' && !(isProp(target) && affordancesOf(target).includes('window'))) verb = 'look';
    return { verb, ch, target, on, variant };
  }
  async function voiceRun(m) {
    const { verb, ch, target: t, on, variant } = m;
    const H = app.history;
    const before = H.index;
    const body = () => {
      switch (verb) {
        case 'sit': return isProp(t) && affordancesOf(t).includes('floor') && !affordancesOf(t).includes('seat') ? sitFloor(ch, t.obj) : sit(ch, t.obj);
        case 'sitTable': return sitAtTable(ch, t.obj);
        case 'lie': return lie(ch, t ? t.obj : null, variant);
        case 'take': return take(ch, t.obj);
        case 'put': return putDown(t.obj.hold?.ch || ch, t.obj, { on: on?.obj || null });
        case 'open': return setOpen(t.obj, true, { ch });
        case 'close': return setOpen(t.obj, false, { ch });
        case 'lean': return lean(ch, t, {});
        case 'kneel': return kneel(ch, t);
        case 'pet': return t.kind === 'animal' ? pet(ch, t) : look(ch, t);
        case 'approach': return approach(ch, t);
        case 'lookOut': return lookOut(ch, t.obj);
        default: return look(ch, t);
      }
    };
    const out = await run('comando vocale', verb === 'open' || verb === 'close' || verb === 'put' ? body : withActor(ch, body));
    const done = typeof out === 'string' ? [out] : [];
    return { done, failed: out ? [] : ['non sono riuscito a farlo'], unknown: [], undoIndex: H.index !== before ? H.index : null, created: 0 };
  }

  // ---------------------------------------------------------------- public API
  const api = {
    affordances: (t) => affordancesOf(t),
    actorFor,
    openMenu,
    closeMenu,
    pick: pickAt,
    sit: (ch, p, opts) => run('siediti', withActor(ch, () => sit(ch, p, opts))),
    lie: (ch, p, variant = 'back') => run('sdraiati', withActor(ch, () => lie(ch, p, variant))),
    sitFloor: (ch, p = null) => run('siediti a terra', withActor(ch, () => sitFloor(ch, p))),
    sitAtTable: (ch, table) => run('siediti al tavolo', withActor(ch, () => sitAtTable(ch, table))),
    take: (ch, p, opts) => run('prendi', withActor(ch, () => take(ch, p, opts))),
    putDown: (ch, p, opts) => run('posa', () => putDown(ch || p.hold?.ch, p, opts)),
    setOpen: (p, open, opts = {}) => run(open ? 'apri' : 'chiudi', () => setOpen(p, open, opts)),
    look: (ch, t, point) => run('guarda', withActor(ch, () => look(ch, t, point))),
    approach: (ch, t, opts) => run('avvicinati', withActor(ch, () => approach(ch, t, opts))),
    lean: (ch, t, opts) => run('appoggiati', withActor(ch, () => lean(ch, t, opts || {}))),
    kneel: (ch, t) => run('inginocchiati', withActor(ch, () => kneel(ch, t))),
    pet: (ch, a) => run('accarezza', withActor(ch, () => pet(ch, a))),
    lookOut: (ch, p, point) => run('guarda fuori', withActor(ch, () => lookOut(ch, p, point))),
    move(target) {
      const t = asTarget(target);
      openToolFor(t, 'peek');
      shell.hint?.(t.kind === 'animal' ? 'Trascina l’animale o le sue maniglie' : 'Trascina le maniglie per spostarlo', 1800);
      return true;
    },
    rotate90(target) {
      const t = asTarget(target);
      return run('ruota 90°', () => {
        if (t.kind === 'animal') {
          const a = t.obj;
          a.root.rotation.y = wrap(a.root.rotation.y + HALF_PI);
          a.root.updateMatrixWorld(true);
          app.animals?.dispatchEvent({ type: 'change', animal: a, what: 'placement' });
        } else props().setYaw(t.obj, t.obj.root.rotation.y + HALF_PI);
        return 'Ruotato di 90°';
      });
    },
    duplicate(target) {
      const t = asTarget(target);
      return run('duplica', async () => {
        if (t.kind === 'animal') await app.animals?.duplicate(t.obj);
        else props().duplicate(t.obj);
        return 'Duplicato';
      });
    },
    async remove(target) {
      const t = asTarget(target);
      const name = nameOf(t);
      const ok = await run('elimina', () => {
        if (t.kind === 'animal') app.animals?.remove(t.obj);
        else {
          const holder = t.obj.hold?.ch, side = t.obj.hold?.side;
          props().remove(t.obj);
          if (holder) restoreArm(holder, side);
        }
        return 'Eliminato';
      });
      if (ok) toast(`${name}: eliminato`, { kind: 'info', action: { label: 'Annulla', onClick: () => app.history.undo() } });
      return ok;
    },
    details(target) { openToolFor(asTarget(target), 'half'); return true; },
    voiceMatch,
    voiceRun,
  };
  app.objectActions = api;
  return api;
}

function wrap(a) { return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; }
