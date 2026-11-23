// Entry point of the "scene" module (see posaviva/ARCHITECTURE.md):
//   - Luci   (group 'scene'):  managed light rig with presets, globe, handles, auto-fitted shadows
//   - Camera (group 'camera'): focal length + dolly zoom, focal point, framing, quick angles, roll, saved views
//   - Guide  (group 'camera'): perspective guides (1/2/3 VPs, horizon), rule of thirds, comic panel frames
//
// Public runtime API (for other modules): app.sceneTools = { lights, camera, guides }
// and app.lightRig (the LightRig). app.defaultLights now points at the rig's group.
import * as THREE from 'three';
import './scene.css';
import { LightRig } from './lights.js';
import { CameraRig } from './cameraRig.js';
import { PerspectiveGuides } from './guides.js';
import { registerLightsTool } from './lightsPanel.js';
import { registerCameraTool } from './cameraPanel.js';
import { registerGuidesTool } from './guidesPanel.js';
import { patchShadowKernel } from './shadowPatch.js';
import { Practicals } from './practicals.js';
import { PRACTICAL_TYPES, PRACTICAL_ROLES } from './practicalSources.js';
import { registerPropTypes, registerPropRoles } from '../props/catalog.js';

export function create(app, shell) {
  // ---------------------------------------------------------------- lights
  // PCFSoftShadowMap was removed in three r18x (it falls back with a warning);
  // plain PCF + shadow.radius gives soft, stable shadows.
  app.renderer.shadowMap.type = THREE.PCFShadowMap;
  patchShadowKernel(app);
  const lights = new LightRig(app);
  if (app.defaultLights && app.defaultLights !== lights.group) {
    app.defaultLights.traverse((o) => { if (o.isLight) o.dispose?.(); });
    app.defaultLights.removeFromParent();
  }
  app.defaultLights = lights.group;
  app.lightRig = lights;
  lights.applyPreset('studio');

  // ---------------------------------------------------------------- practical lights & windows
  // candles, string lights and a fireplace join the props catalog (category Luci)
  registerPropRoles(PRACTICAL_ROLES);
  registerPropTypes(PRACTICAL_TYPES, []);
  const practicals = new Practicals(app, lights);
  app.practicals = practicals;
  // long press on an empty spot (floor, sky, walls nobody else handles): "Luce ambientale";
  // on a light source no other module took (objects workstream absent): its own menu
  app.addHoldHandler?.(({ ndc, x, y }) => {
    if (app.posing?.pick?.(ndc)?.character) return false;
    const hit = app.props?.pick?.(ndc);
    if (hit?.prop && practicals.isSource(hit.prop)) { practicals.openMenu(hit.prop, x, y); return true; }
    practicals.ambientMenu(x, y);
    return true;
  }, 0);

  // ---------------------------------------------------------------- camera & guides
  const camera = new CameraRig(app, shell);
  const guides = new PerspectiveGuides(app, shell);
  app.sceneTools = { lights, camera, guides };

  // after OrbitControls.update(): tweens, floor clamp, roll, shadow fitting, handles
  app.addRenderHook((dt) => {
    const now = performance.now();
    const animating = camera.onFrame(now, dt);
    lights.onFrame(now);
    practicals.onFrame(now);
    return animating;
  });
  app.addAfterRenderHook(() => guides.afterRender());

  registerLightsTool(app, shell, lights, practicals);
  registerCameraTool(app, shell, camera);
  registerGuidesTool(app, shell, guides);

  // ---------------------------------------------------------------- start-up framing
  // The default camera is a fixed portrait-friendly pose: in landscape (or with
  // a taller / shorter default character) it crops the figure. When no camera
  // was restored (no autosave), frame the subject once every module is ready.
  // 'ready' comes before main.js's history.reset(), so this is not an undo step.
  let cameraRestored = false;
  app.addEventListener('ready', () => {
    if (!cameraRestored && app.characters.length && !camera.subjectInView(1.15)) camera.frameSubject({ animate: false, commit: false });
  });

  // ---------------------------------------------------------------- module hooks
  const listeners = new WeakMap();
  const dirty = () => lights.markWorldDirty();
  return {
    onCharacterAdded(ch) {
      const fn = () => dirty();
      listeners.set(ch, fn);
      for (const ev of ['pose', 'shape', 'visibility']) ch.addEventListener(ev, fn);
      dirty();
    },
    onCharacterRemoved(ch) {
      const fn = listeners.get(ch);
      if (fn) for (const ev of ['pose', 'shape', 'visibility']) ch.removeEventListener(ev, fn);
      dirty();
    },
    serializeScene() {
      return { v: 1, lights: lights.getState(), camera: camera.getState(), guides: guides.getState(), practicals: practicals.getState() };
    },
    deserializeScene(obj) {
      if (!obj || typeof obj !== 'object') return;
      // undo/redo replays snapshots: guides are view aids (not part of the
      // undo history) and the camera only follows committed camera actions
      const fromHistory = !!app.history?._restoring;
      if (obj.lights) lights.setState(obj.lights);
      practicals.setState(obj.practicals || null);
      if (obj.camera) { camera.setState(obj.camera, { fromHistory }); cameraRestored = true; }
      if (obj.guides && !fromHistory) guides.setState(obj.guides);
      dirty();
    },
  };
}
