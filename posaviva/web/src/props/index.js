// Entry point of the "props" module (see posaviva/ARCHITECTURE.md).
//
// "Oggetti" tool (group 'scene'): procedural scene props (furniture,
// structures) and hand-held props that can be put into a character's hand.
//
// Public runtime API: app.props = PropManager (see manager.js), e.g.
//   app.props.add('sedia', {near: ch})          -> Prop
//   app.props.attach(prop, ch, 'R')             put a hand prop in a hand
//   app.props.detach(prop)                      release it, keeping the world placement
//   app.props.select(prop) / app.props.selected
//   app.props.meshes                            all prop meshes (each has userData.prop)
// Events on app.props: 'list', 'select' {prop}, 'change' {prop}.
import './props.css';
import { PropManager } from './manager.js';
import { PropGizmo } from './gizmo.js';
import { ThumbRenderer } from './thumbs.js';
import { registerPropsTool } from './panel.js';
import { haptic } from '../ui/kit.js';

export { PROP_TYPES, CATEGORIES, registerPropTypes, registerPropRoles, onPropTypesChanged } from './catalog.js';

export function create(app, shell) {
  const manager = new PropManager(app);
  app.props = manager;
  const isActive = () => shell.activeToolId === 'props';
  const gizmo = new PropGizmo(app, shell, manager, { isActive });
  manager.gizmo = gizmo; // handles (snap setting, last drawn handle positions)
  const thumbs = new ThumbRenderer(app);
  registerPropsTool(app, shell, manager, gizmo, thumbs);

  // ---- tap: select a prop (props win over pose picking, characters in front win over props)
  app.addTapHandler(({ ndc }) => {
    const hit = manager.pick(ndc);
    if (hit) {
      manager.select(hit.prop);
      if (!isActive()) shell.openTool('props');
      haptic(10);
      return true;
    }
    if (isActive() && manager.selected) manager.select(null);
    return false;
  }, 50);

  // ---- Android back: while editing a prop, back leaves the editor (back to the catalog)
  let popBack = null;
  const syncBack = () => {
    const editing = isActive() && !!manager.selected;
    if (editing && !popBack) popBack = app.pushBackHandler(() => { manager.select(null); return true; });
    else if (!editing && popBack) { popBack(); popBack = null; }
  };
  manager.addEventListener('select', syncBack);
  app.addEventListener('tool', syncBack);

  // held props keep real size when a character is rescaled
  app.addRenderHook(() => { if (manager.checkHeldScale()) app.invalidate(); return false; });

  // the handles live on the overlay: hide/show them with the tool
  app.addEventListener('tool', () => app.invalidate());
  // pending hand holds (characters restored after the scene state)
  app.addEventListener('loaded', () => manager.resolvePending(true));

  const listeners = new WeakMap();
  return {
    onCharacterAdded(ch) {
      const fns = { shape: () => manager.onCharacterShape(ch), pose: () => manager.onCharacterPose(ch) };
      listeners.set(ch, fns);
      ch.addEventListener('shape', fns.shape);
      ch.addEventListener('pose', fns.pose);
      manager.resolvePending(false);
    },
    onCharacterRemoved(ch) {
      const fns = listeners.get(ch);
      if (fns) { ch.removeEventListener('shape', fns.shape); ch.removeEventListener('pose', fns.pose); }
      manager.onCharacterRemoved(ch);
    },
    serializeScene() { return manager.serialize(); },
    deserializeScene(obj) { manager.deserialize(obj); },
  };
}
