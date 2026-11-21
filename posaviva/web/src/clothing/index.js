// "clothing" module: procedural garments generated from the body (follow every
// body type and slider), with pose-dependent wrinkles, layering, skin hiding,
// procedural fabrics and the "Vestiti" panel. See ARCHITECTURE.md.
//
// Public API (also on app.clothing):
//   wear(ch, id, patch?) / takeOff(ch, id) / update(ch, id, {color, fit, wrinkles})
//   setItems(ch, items|ids) / items(ch) / setIntensity(k) / whenIdle()
//   catalog: {GARMENTS, CATEGORIES, STYLES, OUTFITS}
// Events (manager.addEventListener): 'change' {character}, 'built' {character}.
// Per-character state: ch.data.clothing = {items:[{id, color, fit, wrinkles}]}.
// Scene state: {wrinkles} (global "Pieghe" intensity).
import { ClothingManager } from './manager.js';
import { GARMENTS, CATEGORIES, STYLES, OUTFITS, defaultOutfit, GARMENT_BY_ID } from './catalog.js';
import { buildPanel } from './panel.js';

export function create(app, shell) {
  const mgr = new ClothingManager(app);
  const api = {
    manager: mgr,
    catalog: { GARMENTS, CATEGORIES, STYLES, OUTFITS },
    wear: (ch, id, patch) => mgr.wear(ch, id, patch),
    takeOff: (ch, id) => mgr.takeOff(ch, id),
    update: (ch, id, patch) => mgr.update(ch, id, patch),
    setItems: (ch, items) => mgr.setItems(ch, items),
    items: (ch) => mgr.items(ch),
    setIntensity: (k) => mgr.setIntensity(k),
    get intensity() { return mgr.intensity; },
    whenIdle: () => mgr.whenIdle(),
    /** Float32Array(body vertices): outer garment surface height over the rest body (m), or null. */
    outerOffsets: (ch) => mgr.outerOffsets(ch),
  };
  app.clothing = api;

  // shoes lift the body by their outsole thickness so soles rest on the floor
  mgr.addEventListener('change', ({ character: ch }) => {
    let lift = 0;
    for (const it of mgr.items(ch) || []) { const d = GARMENT_BY_ID.get(it.id); if (d?.sole) lift = Math.max(lift, d.sole.below || 0); }
    ch.setGroundClearance?.(lift);
  });

  shell.registerTool({
    id: 'clothes', group: 'look', label: 'Vestiti', icon: 'shirt', order: 30, title: 'Vestiti',
    build: (el) => buildPanel(el, app, shell, mgr),
  });

  return {
    ...api,
    onCharacterAdded(ch) { mgr.add(ch); },
    onCharacterRemoved(ch) { mgr.remove(ch); },
    deserializeCharacter(ch) {
      if (!mgr.states.has(ch)) mgr.add(ch);
      // characters saved without clothing data get the default outfit (never nude by accident)
      if (!ch.data.clothing) ch.data.clothing = { items: defaultOutfit(ch.sex) };
      mgr.sync(ch);
    },
    serializeScene() { return { wrinkles: mgr.intensity }; },
    deserializeScene(obj) {
      const k = obj && typeof obj.wrinkles === 'number' ? obj.wrinkles : 1;
      if (k !== mgr.intensity) { mgr.setIntensity(k); mgr.dispatchEvent({ type: 'intensity' }); }
    },
  };
}
