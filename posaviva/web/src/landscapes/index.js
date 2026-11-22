// Entry point of the "landscapes" module (Paesaggi). See posaviva/ARCHITECTURE.md.
//
// Ready landscapes generated around the characters: every time different (new
// seed + randomized choices, checked against the last generations), editable
// afterwards (every object is a normal prop / building / exterior / animal),
// with an environment layer (sky by time of day, sun through the light rig,
// fog, weather, seasons, terrain, water, far vegetation and skyline).
//
// Public API: app.landscapes (LandscapeManager, see manager.js) =
//   { presets, generate(spec), regenerate(), clear(), current, serialize(), deserialize(obj),
//     heightAt(x, z), exportData(), applySaved(data), events 'generated' 'cleared' 'change' 'progress' }
import './landscapes.css';
import { registerPropTypes, registerPropRoles } from '../props/catalog.js';
import { LANDSCAPE_TYPES, LANDSCAPE_ROLES, CATEGORY } from './types.js';
import { LandscapeManager } from './manager.js';
import { registerLandscapesTool } from './panel.js';

export { PRESETS, GROUPS, resolve, matchPreset } from './presets/index.js';
export { TIMES, WEATHERS, SEASONS } from './atmos.js';

export function create(app, shell) {
  registerPropRoles(LANDSCAPE_ROLES);
  registerPropTypes(LANDSCAPE_TYPES, [CATEGORY]);
  const manager = new LandscapeManager(app);
  app.landscapes = manager;
  registerLandscapesTool(app, shell, manager);

  // a loaded scene without landscape data (older file, new scene) has no landscape
  app.addEventListener('loaded', () => {
    if (!manager._sawScene && (manager.current || manager.env.active)) manager.deserialize(null);
    manager._sawScene = false;
  });

  return {
    serializeScene() { return manager.serialize(); },
    deserializeScene(obj) { manager.deserialize(obj); },
  };
}
