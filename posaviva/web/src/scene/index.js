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

  // ---------------------------------------------------------------- camera & guides
  const camera = new CameraRig(app, shell);
  const guides = new PerspectiveGuides(app, shell);
  app.sceneTools = { lights, camera, guides };

  // after OrbitControls.update(): tweens, floor clamp, roll, shadow fitting, handles
  app.addRenderHook((dt) => {
    const now = performance.now();
    const animating = camera.onFrame(now, dt);
    lights.onFrame(now);
    return animating;
  });
  app.addAfterRenderHook(() => guides.afterRender());

  registerLightsTool(app, shell, lights);
  registerCameraTool(app, shell, camera);
  registerGuidesTool(app, shell, guides);

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
      return { v: 1, lights: lights.getState(), camera: camera.getState(), guides: guides.getState() };
    },
    deserializeScene(obj) {
      if (!obj || typeof obj !== 'object') return;
      // undo/redo replays snapshots: guides are view aids (not part of the
      // undo history) and the camera only follows committed camera actions
      const fromHistory = !!app.history?._restoring;
      if (obj.lights) lights.setState(obj.lights);
      if (obj.camera) camera.setState(obj.camera, { fromHistory });
      if (obj.guides && !fromHistory) guides.setState(obj.guides);
      dirty();
    },
  };
}
