// Entry point of the "city" module (Esterni). See posaviva/ARCHITECTURE.md.
//
// Exterior props registered into the props catalog (category 'esterni', listed by
// the module's own tool): roads (snappable modules), vehicles, trees and nature,
// rocks and logs (procedural + realistic CC0 scans from Poly Haven), street
// furniture, and ready kits (groups of editable props). Every item is a regular
// prop: movable, undoable, saved with the scene, rendered in every style.
//
// Public API: app.city = {types, kits, addItem(id, {near, commit, select, toast, lift}), addKit(kit), regenerate(prop),
//   snapRoad(prop), attachPiece(prop, typeId, {which}), placeOnRoad(vehicle, x, z),
//   dropOnGround(prop), liftCharacter(ch) (skips characters on a support), groundY(x, z) (landscape ground included)}
import './city.css';
import { registerPropTypes, registerPropRoles } from '../props/catalog.js';
import { haptic } from '../ui/kit.js';
import { registerCityRoles, NO_SHADOW_ROLES, NO_INK_ROLES } from './roles.js';
import { VEHICLE_TYPES, VEHICLE_ROLES } from './vehicles.js';
import { ROAD_TYPES } from './roads.js';
import { NATURE_TYPES, NATURE_ROLES } from './nature.js';
import { STREET_TYPES, STREET_ROLES } from './street.js';
import { PH_CITY } from './phCity.js';
import { KITS } from './kits.js';
import { CityThumbs } from './thumbs.js';
import { registerCityTool, isGroundType, SUBS } from './panel.js';
import { isCity, snapRoad, attachPiece, placeOnRoad } from './snap.js';
import * as T from './tex.js';

export const CATEGORY = { id: 'esterni', label: 'Esterni', ownTool: true, subs: SUBS.filter((s) => s.id !== 'kit') };

/** Realistic CC0 models (Poly Haven), loaded on first use by the props module. */
const MODEL_TYPES = PH_CITY.map((m) => ({
  id: m.id, label: m.label, cat: 'esterni', sub: m.sub, tags: m.tags, color: '#ffffff', params: [], realistic: true,
  model: `./assets/city/models/${m.ph}.glb`, thumb: `./assets/city/thumbs/${m.ph}.webp`, size: m.size, tint: true,
}));

export const TYPES = [...ROAD_TYPES, ...VEHICLE_TYPES, ...NATURE_TYPES, ...STREET_TYPES, ...MODEL_TYPES];

/** Extra roles with textures defined here (decals of the street furniture). */
const EXTRA_ROLES = {
  'c:decalFermata': () => ({ kind: 'prop', color: '#ffffff', map: T.textTex('FERMATA', { color: '#1c2a5c', bg: '#f2c230', w: 256, h: 180, font: 'bold 54px Arial, sans-serif' }).map, roughness: 0.4 }),
  'c:decalTel': () => ({ kind: 'prop', color: '#ffffff', map: T.textTex('TELEPHONE', { color: '#ffffff', bg: '#141414', w: 512, h: 72, font: 'bold 50px Arial, sans-serif' }).map, roughness: 0.4 }),
  'c:decalEdicola': () => ({ kind: 'prop', color: '#ffffff', map: T.textTex('GIORNALI', { color: '#ffffff', bg: '#7a1f24', w: 512, h: 84, font: 'bold 60px Arial, sans-serif' }).map, roughness: 0.4 }),
  'c:brickTex': () => ({ kind: 'prop', color: '#ffffff', map: T.bricks().map, normalMap: T.bricks().normalMap, normalScale: 0.8, roughness: 0.9 }),
};

export function create(app, shell) {
  registerCityRoles();
  registerPropRoles({ ...VEHICLE_ROLES, ...NATURE_ROLES, ...STREET_ROLES, ...EXTRA_ROLES });
  registerPropTypes(TYPES, [CATEGORY]);
  if (!app.props) return {}; // the props module failed: nothing to attach to
  const M = app.props;
  const thumbs = new CityThumbs(app);
  const ui = registerCityTool(app, shell, thumbs);

  // ---- runtime touches (only when props change or the tool changes; no per-frame work)
  //  * flat road / decal layers cast no shadow
  //  * ground-like items (roads, lawns, terrain) are pickable only in Esterni / Oggetti:
  //    elsewhere a tap on them behaves like a tap on the floor (posing, camera…)
  let raf = 0;
  const pickable = () => shell.activeToolId === 'exteriors' || shell.activeToolId === 'props';
  function refresh() {
    raf = 0;
    const pk = pickable();
    let dirty = false;
    for (const p of M.props) {
      if (!isCity(p)) continue;
      const ground = isGroundType(p.type);
      for (const mesh of p.meshes) {
        const role = mesh.userData.role;
        if (NO_SHADOW_ROLES.has(role) && mesh.castShadow) mesh.castShadow = false;
        if (NO_INK_ROLES.has(role) && mesh.material && !Array.isArray(mesh.material) && !mesh.material.userData.pvNoInk) { mesh.material.userData.pvNoInk = true; app.invalidate(); }
        if (ground) { const np = !pk; if (!!mesh.userData.noPick !== np) { mesh.userData.noPick = np; dirty = true; } }
      }
    }
    if (dirty && '_meshesDirty' in M) M._meshesDirty = true;
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(refresh); };
  M.addEventListener('list', schedule);
  M.addEventListener('change', schedule);
  app.addEventListener('tool', schedule);
  app.addEventListener('loaded', schedule);
  app.materials?.addEventListener?.('refresh', schedule); // render style changed: new materials

  // ---- taps: an exterior item selects itself in Esterni (Oggetti keeps its own handles).
  // While another tool is open (posing, look, camera…) exterior objects are background.
  app.addTapHandler(({ ndc }) => {
    const tool = shell.activeToolId;
    if (tool === 'props') return false;
    const hit = M.pick(ndc);
    if (!hit || !isCity(hit.prop)) {
      if (tool === 'exteriors' && isCity(M.selected)) M.select(null);
      return false;
    }
    if (tool && tool !== 'exteriors') return true;
    M.select(hit.prop);
    if (tool !== 'exteriors') shell.openTool('exteriors');
    haptic(10);
    return true;
  }, 54);

  app.city = {
    types: TYPES, kits: KITS,
    addItem: ui.addItem, addKit: ui.addKit, regenerate: ui.regenerate,
    snapRoad: (p) => snapRoad(p, M.props), attachPiece: (p, typeId, opts) => attachPiece(M, p, typeId, opts),
    placeOnRoad: (p, x, z) => placeOnRoad(M, p, x, z),
    dropOnGround: ui.dropOnGround, liftCharacter: ui.liftCharacter, groundY: ui.groundY,
  };
  return {};
}
