// What each item type saves from the current scene, and how it comes back:
//   scene      app.serialize()                              -> replaces the scene (io SceneManager)
//   landscape  app.landscapes.exportData() (generated)       -> app.landscapes.applySaved(data)
//              or {kind:'environment'} (objects, animals,    -> replaces the environment, characters kept
//              lights of a scene built by hand)
//   character  ch.toJSON() without id / placement            -> new character at a free spot, framed
//   pose       {bones, root (f_normal units), ground, seat}  -> applied to the selected character
import * as THREE from 'three';
import { sceneMeta } from './store.js';

const SEX = { F: 'Donna', M: 'Uomo' };

// ---------------------------------------------------------------- default data
/** Props held by a character belong to it, not to the environment. */
const isHeld = (j) => !!j?.hold;

/** Environment of the current scene: free objects, animals, lights (no characters). */
export function environmentSnapshot(app) {
  const full = app.serialize();
  const sc = full.scene || {};
  const env = {};
  if (sc.props) env.props = { ...sc.props, items: (sc.props.items || []).filter((j) => !isHeld(j)) };
  if (sc.animals) env.animals = sc.animals;
  if (sc.scene?.lights) env.lights = sc.scene.lights;
  if (sc.landscapes) env.landscapes = sc.landscapes;
  const count = (env.props?.items?.length || 0) + (env.animals?.animals?.length || 0);
  return { v: 1, kind: 'environment', scene: env, count };
}

/** Data of the current landscape. Throws (Italian message) when there is nothing to save. */
export function landscapeData(app) {
  const L = app.landscapes;
  if (L?.current) {
    const d = L.exportData?.() || (L.serialize ? { v: 1, landscape: L.serialize().cur, items: [], animals: [] } : null);
    if (d?.landscape) return d;
  }
  const env = environmentSnapshot(app);
  if (!env.count) throw new Error('Nella scena non c\'è un paesaggio: generane uno in Scena › Paesaggi, o aggiungi oggetti, edifici o esterni.');
  return env;
}

export function landscapeMeta(app, data) {
  if (data?.landscape) {
    const r = data.landscape.resolved || {};
    const p = app.landscapes?.presets?.find?.((x) => x.id === r.preset);
    return { label: p?.label || '', objects: (data.items?.length || 0) + (data.animals?.length || 0), generated: true };
  }
  return { label: '', objects: data?.count || 0, generated: false };
}

/** The selected character (or `ch`). Throws when none. */
export function targetCharacter(app, ch) {
  const c = ch || app.selection?.character;
  if (!c || !app.characters.includes(c)) throw new Error('Seleziona prima un personaggio.');
  return c;
}

export function characterData(ch) {
  const j = ch.toJSON();
  delete j.id;
  j.placement = { position: [0, 0, 0], rotationY: 0, scale: j.placement?.scale || 1 };
  return { v: 1, json: j };
}

export function characterMeta(ch) {
  return { sex: ch.sex, preset: ch.presetId, label: `${SEX[ch.sex] || ''} · ${ch.preset?.label || ''}`.trim() };
}

/** The pose of a character in the copyPose format (root offset in f_normal units). */
export async function poseData(ch) {
  const L = await import('../pose/library.js');
  const pose = ch.getPose();
  for (const n of L.PRESERVED_BONES || []) delete pose.bones[n];
  const hs = ch.restLocalPos?.[0]?.y || 0;
  const k = hs > 0 ? L.HIP_REF / hs : 1;
  const floor = ch.root.getWorldPosition(new THREE.Vector3()).y, tol = 0.02 * (ch.root.scale.y || 1);
  let ground = null;
  try {
    const a = Math.abs(L.lowestGroundY(ch, true) - floor), b = Math.abs(L.lowestGroundY(ch, false) - floor);
    if (Math.min(a, b) < tol) ground = a <= b ? 'shoes' : 'skin';
  } catch { ground = 'shoes'; }
  let seat = 0;
  try { seat = ground ? L.measureSeat(ch) : 0; } catch { seat = 0; }
  return { v: 1, bones: pose.bones, root: (pose.root || [0, 0, 0]).map((v) => v * k), ground, seat, seatMark: L.seatMark?.(ch) || 0 };
}

// ---------------------------------------------------------------- apply
/** Replaces the environment of the current scene (characters and camera kept). One undo step. */
export async function applyLandscape(app, data) {
  if (!data) throw new Error('Paesaggio vuoto');
  if (data.landscape || data.cur) {
    const L = app.landscapes;
    if (!L?.applySaved) throw new Error('I paesaggi non sono disponibili in questa versione.');
    const d = data.landscape ? data : { v: 1, landscape: data.cur, items: [], animals: [] };
    const ok = await L.applySaved(d);
    if (ok === false) throw new Error('Paesaggio non valido');
    return true;
  }
  if (data.kind !== 'environment' || !data.scene) throw new Error('Paesaggio non valido');
  const cur = app.serialize();
  const sc = { ...(cur.scene || {}) };
  const env = data.scene;
  // objects: the saved ones replace the free ones; props held by characters stay
  if (sc.props || env.props) {
    const held = (sc.props?.items || []).filter(isHeld);
    sc.props = { ...(sc.props || { v: 1 }), ...(env.props || {}), items: [...(env.props?.items || []), ...held] };
  }
  sc.animals = env.animals || { v: 1, animals: [] };
  if (env.lights && sc.scene) sc.scene = { ...sc.scene, lights: env.lights };
  sc.landscapes = env.landscapes || { v: 1, cur: null };
  app.deserialize({ ...cur, scene: sc });
  app.commit('applica paesaggio');
  return true;
}

/** Adds a new character with a saved configuration (free spot, facing the camera, selected, framed). */
export function insertCharacter(app, data, name) {
  const json = JSON.parse(JSON.stringify(data?.json || data || {}));
  if (!json.preset || !app.model.presetById?.get(json.preset)) throw new Error('Personaggio non valido');
  const people = app.modules?.ui?.people;
  const max = 8;
  if (app.characters.length >= max) throw new Error(`Al massimo ${max} personaggi per scena: elimina o nascondi qualcuno per fare spazio.`);
  delete json.id;
  const sel = app.selection.character;
  const anchor = (sel ? sel.root.position.clone() : app.controls.target.clone()).setY(0);
  const face = (p) => { const st = Math.PI / 12; return Math.round(Math.atan2(app.camera.position.x - p.x, app.camera.position.z - p.z) / st) * st || 0; };
  json.placement = { ...(json.placement || {}), position: anchor.toArray(), rotationY: face(anchor) };
  // an automatic name ("Donna 1") becomes the next free one of its sex, a chosen one stays unique ("Nina 2")
  const base = name || json.name || 'Personaggio';
  const sex = app.model.presetById.get(json.preset)?.sex;
  json.name = /^(Donna|Uomo) \d+$/.test(base) && people?.defaultName ? people.defaultName(sex) : people?.uniqueName ? people.uniqueName(base) : base;
  const ch = app.addCharacter({ preset: json.preset, json });
  const place = (p) => { if (typeof ch.setPlacement === 'function') ch.setPlacement({ position: p, rotationY: face(p) }); else { ch.root.position.copy(p); ch.root.rotation.y = face(p); } };
  let spot = people?.freeSpot?.(anchor, ch);
  if (spot) { place(spot); spot = people.freeSpot(spot, ch); if (spot) place(spot); }
  people?.ctx?.viewOffset?.holdSelection?.(700);
  app.select(ch);
  if (people?.frame) people.frame(ch); else app.sceneTools?.camera?.frameSubject?.({ animate: true, commit: false });
  app.commit('inserisci personaggio');
  return ch;
}

/** Applies a saved pose to a character (re-grounded / seated like Posa › Copia su…). One undo step. */
export async function applyPose(app, data, ch) {
  const target = targetCharacter(app, ch);
  if (!data?.bones) throw new Error('Posa non valida');
  const L = await import('../pose/library.js');
  const seat = data.ground ? +data.seat || 0 : 0;
  L.applyPoseObject(target, { bones: data.bones, root: data.root || [0, 0, 0] }, { ground: !!data.ground, seat, collide: true, shoes: data.ground !== 'skin' });
  L.setSeatMark?.(target, seat > 0 ? data.seatMark || seat : 0);
  app.commit('applica posa');
  return target;
}

export { sceneMeta };
