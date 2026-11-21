// Entry point of the "buildings" module (Edifici). See posaviva/ARCHITECTURE.md.
//
// Procedural buildings registered as prop types (category 'edifici', with
// sub-categories): every building is a regular prop (movable, undoable, saved
// with the scene) built from merged geometry per material, with procedural
// facade textures and normal maps. 21 styles + "Isolato" (a whole street
// front of buildings with sidewalk as one prop).
//
// Public API: app.buildings = {types, add(typeId) -> Prop, placeBehind(prop, ch?), regenerate(prop), runtime}
import './buildings.css';
import { registerPropTypes } from '../props/catalog.js';
import { BUILDING_TYPES, CATEGORY, SUBS } from './types.js';
import { BuildingRuntime, isBuilding } from './lod.js';
import { BuildingThumbs } from './thumbs.js';
import { registerBuildingsTool } from './panel.js';
import { haptic } from '../ui/kit.js';

export { BUILDING_TYPES, SUBS, isBuilding };

export function create(app, shell) {
  registerPropTypes(BUILDING_TYPES, [CATEGORY]);
  if (!app.props) return {}; // the props module failed: nothing to attach buildings to
  const runtime = new BuildingRuntime(app);
  const thumbs = new BuildingThumbs(app);
  const ui = registerBuildingsTool(app, shell, thumbs);

  // Taps: a building selects itself in the Edifici tool (or in Oggetti when
  // that tool is open, for its handles). While another tool is open (posing,
  // look, camera…) buildings are just background: the tap is swallowed so it
  // does not switch tools.
  app.addTapHandler(({ ndc }) => {
    const tool = shell.activeToolId;
    if (tool === 'props') return false;
    const hit = app.props.pick(ndc);
    if (!hit || !isBuilding(hit.prop)) {
      if (tool === 'buildings' && isBuilding(app.props.selected)) app.props.select(null);
      return false;
    }
    if (tool && tool !== 'buildings') return true;
    app.props.select(hit.prop);
    if (tool !== 'buildings') shell.openTool('buildings');
    haptic(10);
    return true;
  }, 55);

  app.buildings = { types: BUILDING_TYPES, add: ui.addBuilding, placeBehind: ui.placeBehind, regenerate: ui.regenerate, runtime };
  return {};
}
