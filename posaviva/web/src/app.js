// Application core: renderer, scene, camera, characters, selection, modules,
// on-demand rendering, undo/redo history and (de)serialization.
import * as THREE from 'three';
import { haptic } from './ui/kit.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Character } from './core/Character.js';
import { materials } from './render/materials.js';

const IDLE_STOP_FRAMES = 45; // ~0.4-0.75 s without any work before the loop sleeps
const HEARTBEAT_MS = 500;
const LIGHT_SCAN_MS = 1000; // shadow-casting lights are re-listed at most this often

export class App extends THREE.EventDispatcher {
  /**
   * @param {HTMLElement} container element that will host the canvas
   * @param {import('./core/HumanModel.js').HumanModel} model
   */
  constructor(container, model) {
    super();
    this.container = container;
    this.model = model;
    this.materials = materials;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';
    this.renderer = renderer;
    this.canvas = renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2a2c33');

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 3000);
    this.camera.filmGauge = 35;
    this.camera.setFocalLength(50);
    this.camera.position.set(0.0, 1.35, 4.2);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 600; // whole streets and skyscrapers can be framed
    // camera-only change: the shadow maps (fitted to the scene, not to the view) stay valid
    this.controls.addEventListener('change', () => this.invalidateView());
    this.controls.update();

    // default lighting (replaced/managed by the lights module)
    this.defaultLights = new THREE.Group();
    this.defaultLights.name = 'defaultLights';
    const hemi = new THREE.HemisphereLight('#dfe8ff', '#4a4038', 0.9);
    const key = new THREE.DirectionalLight('#fff3e6', 2.4);
    key.position.set(2.5, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    this.defaultLights.add(hemi, key, key.target);
    this.scene.add(this.defaultLights);

    // ground
    this.world = new THREE.Group(); // characters & props live here
    this.world.name = 'world';
    this.scene.add(this.world);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1500, 96).rotateX(-Math.PI / 2), undefined);
    ground.name = 'ground';
    ground.receiveShadow = true;
    ground.userData.isGround = true;
    materials.apply(ground, { kind: 'ground', color: '#8a8f99' });
    this.ground = ground;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(20, 40, 0x666b75, 0x4d515a);
    grid.material.transparent = true; grid.material.opacity = 0.45;
    grid.position.y = 0.001;
    this.grid = grid;
    this.scene.add(grid);

    this.characters = [];
    this.selection = { character: null, part: null };
    this.modules = {};
    this._renderHooks = new Set(); // (dt) => void, called before rendering
    this._afterRender = new Set();
    /** a module may replace the final render call (e.g. post-processing) */
    this.renderOverride = null;
    this._needsRender = true;
    // Shadow maps are re-rendered only when the scene content changed (app.invalidate(),
    // a render hook that keeps animating), never for camera-only frames (orbit, zoom,
    // dynamic resolution: app.invalidateView()). While the content changes every frame
    // they are refreshed every `shadowEvery` frames (quality preset), and always on the
    // frame after the changes stop.
    this.shadowCache = true;
    this.shadowEvery = 1;
    this._contentDirty = true;
    this._shadowStale = true;
    this._staleRun = 0;
    this._renderAgain = false;
    /** true: the loop runs the render hooks but draws nothing (see main.js boot) */
    this.drawSuspended = false;
    this._shadowLights = [];
    this._lightScanAt = -Infinity;
    // optional frame-rate cap (setFrameRateCap): ticks of a faster display are skipped
    this._minFrameMs = 0;
    this._lastDrawT = -Infinity;
    this._tickMs = 0; // measured animation-frame interval (EMA)
    this._lastTickT = 0;
    this._timer = new THREE.Timer();
    this._timer.connect?.(document);
    this.history = new History(this);
    this.raycaster = new THREE.Raycaster();
    this._tapHandlers = [];
    this._holdHandlers = [];
    this._backHandlers = [];
    this._setupTapRouter();

    materials.addEventListener('style', () => this.invalidate());
    this._setupContextLoss();
    this._resize = this._resize.bind(this);
    new ResizeObserver(this._resize).observe(container);
    this._resize();
    // The frame loop stops itself when nothing has happened for a moment (an idle
    // reference left on screen while drawing must not wake the phone 120 times a
    // second) and restarts on invalidate(), on input, and on a slow heartbeat that
    // lets polling render hooks ask for frames.
    this._frameCb = (t) => this._frame(t);
    this._looping = false;
    this._idleFrames = 0;
    this._beat = () => this._heartbeat();
    this._heartbeatT = 0;
    const wake = () => this._startLoop();
    for (const ev of ['pointerdown', 'pointermove', 'wheel']) this.canvas.addEventListener(ev, wake, { passive: true });
    this.controls.addEventListener('start', wake);
    // back from the background / another app: the compositor may have dropped the canvas
    // content, and rendering is on demand -> draw one fresh frame
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { this._contentDirty = true; this.invalidate(); } });
    window.addEventListener('pageshow', () => this.invalidate());
    this._startLoop();
  }

  _startLoop() {
    if (this._looping) return;
    this._looping = true;
    this._idleFrames = 0;
    clearTimeout(this._heartbeatT);
    this._heartbeatT = 0;
    this._timer.reset(); // no giant first delta after a pause
    this.renderer.setAnimationLoop(this._frameCb);
  }

  _stopLoop() {
    this._looping = false;
    this.renderer.setAnimationLoop(null);
    this._heartbeatT = setTimeout(this._beat, HEARTBEAT_MS);
  }

  /** While stopped: run the render hooks once; resume the loop if any of them wants frames. */
  _heartbeat() {
    this._heartbeatT = 0;
    if (this._looping) return;
    if (!this.contextLost && (this._held || this._runHooks(0) || this._needsRender)) this._startLoop();
    else this._heartbeatT = setTimeout(this._beat, HEARTBEAT_MS);
  }

  _runHooks(dt) {
    let keep = false;
    // hooks are isolated: a module that throws every frame must not freeze the viewport
    for (const fn of this._renderHooks) {
      try { keep = fn(dt) || keep; } catch (e) { this._hookFailed(fn, e); }
    }
    return keep;
  }

  // ------------------------------------------------------------ modules
  /** module: {init?(app), onCharacterAdded?(ch), onCharacterRemoved?(ch), serializeScene?(), deserializeScene?(obj), deserializeCharacter?(ch)} */
  registerModule(name, module) {
    this.modules[name] = module;
    module.init?.(this);
    for (const ch of this.characters) {
      try { module.onCharacterAdded?.(ch); } catch (e) { console.error(`[PosaViva] module ${name}.onCharacterAdded failed`, e); }
    }
    return module;
  }

  /**
   * Calls hook `name` on every module that has it. Failures are isolated and
   * logged: one broken module must not leave a character half added/removed or
   * abort an undo for the others.
   */
  _moduleHook(name, ...args) {
    for (const [id, m] of Object.entries(this.modules)) {
      if (typeof m[name] !== 'function') continue;
      try { m[name](...args); } catch (e) { console.error(`[PosaViva] module ${id}.${name} failed`, e); }
    }
  }

  /** Called every frame while rendering; return true to keep rendering continuously. */
  addRenderHook(fn) { this._renderHooks.add(fn); return () => this._renderHooks.delete(fn); }
  addAfterRenderHook(fn) { this._afterRender.add(fn); return () => this._afterRender.delete(fn); }

  /** Something visible changed: draw a new frame (shadow maps included). */
  invalidate() { this._contentDirty = true; this._needsRender = true; if (!this._looping && this._frameCb && !this.contextLost) this._startLoop(); }

  /**
   * Only the view changed (camera, zoom, canvas resolution): draw a new frame but keep
   * the shadow maps. Use invalidate() whenever anything in the scene moved or changed.
   */
  invalidateView() { this._needsRender = true; if (!this._looping && this._frameCb && !this.contextLost) this._startLoop(); }

  /**
   * Frame-rate cap (fps, 0 = none). Applied only on displays clearly faster than the cap
   * (120 / 144 Hz -> every other frame); a 60 or 90 Hz panel is never decimated (the
   * Android shell lowers the panel rate itself, see AndroidBridge.setPreferredFrameRate).
   */
  setFrameRateCap(fps) { this.frameRateCap = fps > 0 ? fps : 0; this._minFrameMs = this.frameRateCap ? 1000 / this.frameRateCap : 0; }

  /**
   * Memory pressure (Android onTrimMemory levels: 10 running low, 15 critical, 20 UI
   * hidden, 40+ background). Dispatches 'memorypressure' {level, background} so modules
   * can drop caches (render targets, unused materials, thumbnails); GPU buffers that
   * are needed again are rebuilt on the next frame.
   */
  trimMemory(level = 15) {
    const background = level >= 20 && level !== 15 && level !== 10;
    this.dispatchEvent({ type: 'memorypressure', level, background });
    if (!background) this.invalidate();
  }

  /**
   * While held, the frame loop does nothing (no render hooks, no drawing). Boot
   * holds it until the modules and the first scene are set up, so no frame is
   * drawn (and no shader compiled) for a half-initialised scene behind the splash.
   */
  holdRendering(on) { this._held = !!on; if (!on) this.invalidate(); }

  // ------------------------------------------------------------ input
  /**
   * Register a tap handler: fn({ndc, event, x, y}) -> true if consumed.
   * Higher priority runs first. Returns an unregister function.
   * Priorities: 100 temporary modes (e.g. camera aim), 50 props, 10 pose picking, 0 fallback.
   */
  addTapHandler(fn, priority = 0) {
    const h = { fn, priority };
    this._tapHandlers.push(h);
    this._tapHandlers.sort((a, b) => b.priority - a.priority);
    return () => { const i = this._tapHandlers.indexOf(h); if (i >= 0) this._tapHandlers.splice(i, 1); };
  }

  /**
   * Register a long-press handler: fn({ndc, event, x, y}) -> false (not mine) | true (consumed) |
   * a press-and-drag session {move(e), end(e, cancelled)}: while the finger stays down the
   * camera does not orbit and every move goes to the session. A press held HOLD_MS without
   * moving more than 10 px (one finger, nothing else down) fires the handlers, highest
   * priority first; its release is never a tap. Priorities as for addTapHandler (100 modes,
   * 60 characters, 50 objects, 0 empty space). Returns an unregister function.
   */
  addHoldHandler(fn, priority = 0) {
    const h = { fn, priority };
    this._holdHandlers.push(h);
    this._holdHandlers.sort((a, b) => b.priority - a.priority);
    return () => { const i = this._holdHandlers.indexOf(h); if (i >= 0) this._holdHandlers.splice(i, 1); };
  }

  /** True while a long-press drag session (addHoldHandler) owns the pointer. */
  get holdActive() { return !!this._holdSession; }

  /** Android back handler stack: fn() -> true if handled (e.g. exit a mode). */
  pushBackHandler(fn) { this._backHandlers.push(fn); return () => { const i = this._backHandlers.indexOf(fn); if (i >= 0) this._backHandlers.splice(i, 1); }; }

  /** Runs the tap handlers for a pointer event (used by the router and by gizmos passing a press through). */
  routeTap(e) {
    const ndc = this.pointerToNDC(e);
    for (const h of this._tapHandlers) if (h.fn({ ndc, event: e, x: e.clientX, y: e.clientY })) return true;
    return false;
  }

  _setupTapRouter() {
    const c = this.canvas;
    let down = null;
    const pointers = new Set(); // pointers currently down anywhere (multi-touch never taps)
    const HOLD_MS = 480;
    const ring = new HoldRing();
    const cancelHold = () => { if (down?.timer) { clearTimeout(down.timer); down.timer = 0; } if (down?.ringT) { clearTimeout(down.ringT); down.ringT = 0; } ring.hide(); };
    /**
     * Runs the hold handlers for a press (event e, still down). Returns true when one took
     * it (a returned session then owns the pointer until it lifts).
     */
    const runHold = (e, drift = 0) => {
      ring.hide();
      if (!this._holdHandlers.length) return false;
      const ndc = this.pointerToNDC(e);
      for (const h of this._holdHandlers) {
        let r = false;
        try { r = h.fn({ ndc, event: e, x: e.clientX, y: e.clientY, drift, pointerType: e.pointerType }); } catch (err) { console.error(err); }
        if (!r) continue;
        haptic('medium');
        if (typeof r === 'object') {
          this._holdSession = { s: r, id: e.pointerId, controls: this.controls.enabled };
          this.controls.enabled = false;
        }
        this.invalidate();
        return true;
      }
      return false;
    };
    /**
     * A capture-phase handle (pose rings) that took a press which then stayed still for the
     * long-press time hands it over: the hold handlers run as if the router had timed it.
     */
    this.holdFrom = (e, drift = 0) => (!this._holdSession && pointers.size <= 1 ? runHold(e, drift) : false);
    const fireHold = () => {
      const d = down;
      if (!d || d.multi) return;
      d.timer = 0;
      d.held = true;
      runHold(d.last, d.drift);
    };
    const endSession = (e, cancelled) => {
      const hs = this._holdSession;
      if (!hs || e.pointerId !== hs.id) return false;
      this._holdSession = null;
      this.controls.enabled = hs.controls;
      try { hs.s.end?.(e, cancelled); } catch (err) { console.error(err); }
      this.invalidate();
      return true;
    };
    c.addEventListener('pointerdown', (e) => {
      pointers.add(e.pointerId);
      if (down && pointers.size > 1) { down.multi = true; cancelHold(); return; }
      down = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, multi: false, held: false, timer: 0, ringT: 0, last: e, drift: 0, type: e.pointerType };
      // a press already taken by a gizmo / mode (capture listeners) never becomes a long press,
      // nor does a camera gesture: mouse middle / right button, S Pen with its barrel button held
      const camera = e.button > 0 || (e.pointerType === 'pen' && ((e.buttons & 2) || this.penBarrel));
      if (!e.defaultPrevented && !camera) {
        down.timer = setTimeout(fireHold, HOLD_MS);
        // a finger / pen resting still: a small ring fills up to the long press (it tells a
        // careful start of a drag from a long press before it happens)
        if (e.pointerType !== 'mouse' && this._holdHandlers.length) {
          const d = down;
          d.ringT = setTimeout(() => { d.ringT = 0; if (down === d && d.timer && !d.multi) ring.show(d.x, d.y, HOLD_MS - 200); }, 200);
        }
      }
    });
    c.addEventListener('pointermove', (e) => {
      const hs = this._holdSession;
      if (hs && e.pointerId === hs.id) { try { hs.s.move?.(e); } catch (err) { console.error(err); } this.invalidate(); return; }
      if (!down || e.pointerId !== down.id) return;
      down.last = e;
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (dist > down.drift) down.drift = dist;
      // the S Pen tip does not tremble like a finger: any real movement is a stroke
      if (down.timer && dist > (down.type === 'pen' ? 3 : 10)) cancelHold();
    });
    const up = (e) => {
      if (endSession(e, e.type === 'pointercancel')) { if (down?.id === e.pointerId) down = null; return; }
      if (!down || e.pointerId !== down.id) return;
      const d = down; down = null;
      if (d.timer) clearTimeout(d.timer);
      if (d.ringT) clearTimeout(d.ringT);
      ring.hide();
      if (d.multi || d.held || e.type === 'pointercancel') return;
      // event timestamps: a long frame between down and up must not swallow the tap
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || e.timeStamp - d.t > 450) return;
      this.routeTap(e);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    // a pointer released outside the canvas (no capture, e.g. a mouse dragged onto
    // the toolbar) must not leave the router believing it is still down
    const forget = (e) => {
      pointers.delete(e.pointerId);
      // (this window listener runs before the canvas' own: a release ON the canvas ends the session there, not cancelled)
      if (e.target !== c && endSession(e, true)) { if (down?.id === e.pointerId) down = null; return; }
      if (down && e.pointerId === down.id && e.target !== c) { cancelHold(); down = null; }
    };
    window.addEventListener('pointerup', forget, true);
    window.addEventListener('pointercancel', forget, true);
    // a gizmo / mode that captured the press (pointerdown in the capture phase calling
    // stopPropagation) never reaches the router; one that only marks it with
    // preventDefault() is honored above
  }

  /**
   * WebGL context loss (GPU reset, memory pressure on Android, app restored from
   * the background). three.js rebuilds its GL state on restore and re-uploads every
   * resource lazily, but rendering is on demand: without a new frame the canvas
   * would stay black. App events 'contextlost' / 'contextrestored' let modules
   * rebuild GPU-only state (e.g. cached render targets) if they keep any.
   */
  _setupContextLoss() {
    this.contextLost = false;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // allows the browser to restore the context
      this.contextLost = true;
      this.dispatchEvent({ type: 'contextlost' });
    }, false);
    // registered after three's own handler, so the renderer is already re-initialised here
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.renderer.shadowMap.needsUpdate = true;
      this._resize();
      this.dispatchEvent({ type: 'contextrestored' });
      this.invalidate();
      // shaders recompile and textures re-upload over the next frames: draw once more after that
      setTimeout(() => this.invalidate(), 300);
    }, false);
  }

  // ------------------------------------------------------------ characters
  /** opts: {preset, name, position:[x,y,z], rotationY, json} */
  addCharacter(opts = {}) {
    const ch = new Character(this.model, opts);
    if (opts.json) ch.fromJSON(opts.json);
    else {
      if (opts.position) ch.root.position.fromArray(opts.position);
      else ch.root.position.set(this._freeSpotX(), 0, 0);
      if (opts.rotationY) ch.root.rotation.y = opts.rotationY;
    }
    this.world.add(ch.root);
    this.characters.push(ch);
    for (const ev of ['shape', 'pose', 'expression', 'appearance', 'visibility']) ch.addEventListener(ev, () => this.invalidate());
    this._moduleHook('onCharacterAdded', ch, opts);
    if (opts.json) this._moduleHook('deserializeCharacter', ch);
    this.dispatchEvent({ type: 'characters' });
    this.invalidate();
    return ch;
  }

  _freeSpotX() {
    if (!this.characters.length) return 0;
    const xs = this.characters.map((c) => c.root.position.x);
    return Math.max(...xs) + 0.75;
  }

  removeCharacter(ch) {
    const i = this.characters.indexOf(ch);
    if (i < 0) return;
    this._moduleHook('onCharacterRemoved', ch);
    this.characters.splice(i, 1);
    ch.dispose();
    if (this.selection.character === ch) this.select(this.characters[0] || null);
    this.dispatchEvent({ type: 'characters' });
    this.invalidate();
  }

  duplicateCharacter(ch) {
    const j = ch.toJSON();
    delete j.id;
    j.placement.position[0] += 0.75;
    const c2 = this.addCharacter({ preset: j.preset, json: j });
    this.select(c2);
    return c2;
  }

  /** part: optional control id (e.g. 'forearm.L') chosen by the posing module */
  select(character, part = null) {
    this.selection = { character, part };
    this.dispatchEvent({ type: 'selection', character, part });
    this.invalidate();
  }

  // ------------------------------------------------------------ serialization
  serialize() {
    const scene = {};
    for (const [name, m] of Object.entries(this.modules)) {
      if (!m.serializeScene) continue;
      try { scene[name] = m.serializeScene(); } catch (e) { console.error(`[PosaViva] module ${name}.serializeScene failed`, e); }
    }
    return {
      app: 'PosaViva', version: 1,
      characters: this.characters.map((c) => c.toJSON()),
      selected: this.selection.character ? this.characters.indexOf(this.selection.character) : -1,
      scene,
    };
  }

  /** Restores a scene. Characters with matching ids are updated in place (fast undo/redo). */
  deserialize(json) {
    const incoming = json.characters || [];
    const ids = new Set(incoming.map((c) => c.id));
    for (const ch of [...this.characters]) if (!ids.has(ch.id)) this.removeCharacter(ch);
    const sceneOpts = { fromHistory: this.history.restoring };
    for (const [name, m] of Object.entries(this.modules)) {
      if (json.scene?.[name] === undefined || !m.deserializeScene) continue;
      try { m.deserializeScene(json.scene[name], sceneOpts); } catch (e) { console.error(`[PosaViva] module ${name}.deserializeScene failed`, e); }
    }
    const order = [];
    for (const cj of incoming) {
      let ch = this.characters.find((c) => c.id === cj.id);
      if (ch) {
        ch.fromJSON(cj);
        this._moduleHook('deserializeCharacter', ch);
      } else ch = this.addCharacter({ preset: cj.preset, json: cj, id: cj.id });
      order.push(ch);
    }
    this.characters = order;
    const sel = json.selected >= 0 ? this.characters[json.selected] : this.characters[0];
    this.select(sel || null);
    this.dispatchEvent({ type: 'characters' });
    this.dispatchEvent({ type: 'loaded' });
    this.invalidate();
  }

  /** Records an undo step (call when an interaction ends). */
  commit(label = '') { this.history.push(label); }

  /** Runs fn as ONE undo step (see History.batch): module commits inside are held. */
  batch(label, fn) { return this.history.batch(label, fn); }

  // ------------------------------------------------------------ frame loop
  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dispatchEvent({ type: 'resize', width: w, height: h });
    this.invalidate();
  }

  /** Near plane follows the orbit distance: close-ups of a hand and whole streets both keep depth precision. */
  _fitClipPlanes() {
    const cam = this.camera;
    const d = cam.position.distanceTo(this.controls.target);
    const near = Math.min(1.5, Math.max(0.02, d * 0.006));
    if (Math.abs(near - cam.near) / cam.near > 0.15) { cam.near = near; cam.updateProjectionMatrix(); this._needsRender = true; }
  }

  _frame(t) {
    if (this._held) return;
    if (this._minFrameMs && typeof t === 'number') {
      // display rate: skip ticks only when the panel runs well above the cap
      if (this._lastTickT) { const d = t - this._lastTickT; if (d > 0 && d < 100) this._tickMs = this._tickMs ? this._tickMs * 0.9 + d * 0.1 : d; }
      this._lastTickT = t;
      if (this._tickMs && this._tickMs < this._minFrameMs * 0.6 && t - this._lastDrawT < this._minFrameMs - this._tickMs * 0.5) return;
      this._lastDrawT = t;
    }
    this._timer.update();
    const dt = Math.min(this._timer.getDelta(), 0.1);
    let keep = this.controls.update(dt) || false;
    const hooksKeep = this._runHooks(dt);
    // a hook that keeps animating changes the scene (hair settling, builds, tweens)
    if (hooksKeep) this._contentDirty = true;
    keep = hooksKeep || keep;
    this._fitClipPlanes();
    if (!this._needsRender && !keep) {
      if (++this._idleFrames >= IDLE_STOP_FRAMES) this._stopLoop();
      return;
    }
    this._idleFrames = 0;
    // nothing can be drawn without a context: keep the request and sleep until
    // 'webglcontextrestored' (which invalidates)
    if (this.contextLost) { this._needsRender = true; this._stopLoop(); return; }
    // drawing suspended (boot: the splash hides a scene still being dressed): hooks only
    if (this.drawSuspended) { this._needsRender = true; return; }
    this._needsRender = false;
    this._shadowPolicy();
    this.renderNow();
    if (this._renderAgain) { this._renderAgain = false; this._needsRender = true; }
    for (const fn of this._afterRender) {
      try { fn(dt); } catch (e) { this._hookFailed(fn, e); }
    }
  }

  /** Decides whether this frame re-renders the shadow maps (see shadowCache). */
  _shadowPolicy() {
    const sm = this.renderer.shadowMap;
    if (!this.shadowCache || !sm.enabled) { sm.autoUpdate = true; this._contentDirty = false; return; }
    sm.autoUpdate = false;
    if (this._contentDirty) { this._contentDirty = false; this._shadowStale = true; this._staleRun++; } else this._staleRun = 0;
    // a light whose map is missing (new light, resolution change) must be drawn now
    const now = performance.now();
    if (now - this._lightScanAt > LIGHT_SCAN_MS) {
      this._lightScanAt = now;
      const list = this._shadowLights;
      list.length = 0;
      this.scene.traverseVisible((o) => { if (o.isLight && o.castShadow && o.shadow) list.push(o); });
    }
    let missing = false;
    for (const l of this._shadowLights) if (l.castShadow && !l.shadow.map) { missing = true; break; }
    if (!this._shadowStale && !missing) return;
    // content changing every frame: refresh every N-th frame (the frame after the run
    // always refreshes, since the maps are still stale then)
    if (!missing && this.shadowEvery > 1 && this._staleRun > 1 && this._staleRun % this.shadowEvery !== 0) { this._renderAgain = true; return; }
    sm.needsUpdate = true;
    this._shadowStale = false;
  }

  /** Forces the shadow maps to be re-rendered on the next frame. */
  refreshShadows() { this._shadowStale = true; this._lightScanAt = -Infinity; this.invalidateView(); }

  _hookFailed(fn, e) {
    const seen = this._failedHooks || (this._failedHooks = new WeakSet());
    if (seen.has(fn)) return; // logged once per hook
    seen.add(fn);
    console.error('[PosaViva] frame hook failed', e);
  }

  renderNow() {
    if (this.renderOverride) {
      try { this.renderOverride(this.renderer, this.scene, this.camera); return; }
      catch (e) {
        // a broken post-processing override must never blank the viewport
        if (!this._overrideErrorLogged) { console.error('[PosaViva] renderOverride failed, falling back', e); this._overrideErrorLogged = true; }
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Raycast helper: NDC from a pointer event relative to the canvas. */
  pointerToNDC(ev, target = new THREE.Vector2()) {
    const r = this.canvas.getBoundingClientRect();
    return target.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }
}

/**
 * Undo / redo: a stack of scene snapshots (JSON strings of app.serialize()).
 *
 * Batches: an operation that runs several module actions (a voice command, a
 * generated landscape with its characters lifted, a multi-step import…) is ONE
 * undo step with `await app.history.batch(label, async () => {...})`. While a
 * batch runs, the modules' own `app.commit()` calls are held (only the latest
 * label is remembered), undo / redo are ignored and `canUndo` / `canRedo` read
 * false; when the outermost batch ends, one step is recorded with `label` (only
 * if the scene changed), also when the function throws. Batches nest: inner ones
 * merge into the outermost. Low level: `const release = app.history.hold();
 * … release(label)` (idempotent; `release(null)` records with the last held
 * label, `release(false)` records nothing — the changes then join the next step).
 */
class History {
  constructor(app) { this.app = app; this.stack = []; this.index = -1; this.limit = 60; this._restoring = false; this._holds = 0; this._heldLabel = null; }
  reset() { this.stack = [JSON.stringify(this.app.serialize())]; this.index = 0; this._emit(); }

  /** true while a batch (or a hold) is open: module commits are deferred */
  get held() { return this._holds > 0; }

  /**
   * Starts holding commits. Returns release(label): ends this hold; when it is the
   * last one, records one step labelled `label` (string), the last held module
   * label (null / undefined), or nothing (false). Calling release twice is harmless.
   */
  hold() {
    let open = true;
    if (this._holds++ === 0) { this._heldLabel = null; this._emit(); }
    return (label) => {
      if (!open) return false;
      open = false;
      return this._release(label);
    };
  }

  _release(label) {
    if (this._holds <= 0) return false;
    if (--this._holds > 0) return false;
    const held = this._heldLabel;
    this._heldLabel = null;
    const before = this.index, top = this.stack[this.index];
    if (label !== false) this.push(typeof label === 'string' ? label : held || '');
    const recorded = this.index !== before || this.stack[this.index] !== top;
    if (!recorded) this._emit(); // the buttons come back even when nothing changed
    return recorded;
  }

  /**
   * Runs fn (sync or async) as ONE undo step labelled `label` and resolves to its
   * result. Commits made inside are held; the step is recorded when the outermost
   * batch ends, even if fn throws (the error is then re-thrown).
   */
  async batch(label, fn) {
    const release = this.hold();
    try { return await fn(); } finally { release(label); }
  }

  push(label) {
    if (this._restoring) return;
    if (this._holds > 0) { if (label) this._heldLabel = label; return; }
    const snap = JSON.stringify(this.app.serialize());
    if (this.stack[this.index] === snap) return;
    this.stack.splice(this.index + 1);
    this.stack.push(snap);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    this.lastLabel = label;
    this._emit();
  }
  /** true while undo/redo is restoring a snapshot */
  get restoring() { return this._restoring; }
  // a batch in progress cannot be undone half-way: undo / redo wait for its end
  get canUndo() { return this.index > 0 && !this._holds; }
  get canRedo() { return this.index < this.stack.length - 1 && !this._holds; }
  undo() { if (this.canUndo) this._restore(--this.index); }
  redo() { if (this.canRedo) this._restore(++this.index); }
  _restore(i) {
    this._restoring = true;
    try { this.app.deserialize(JSON.parse(this.stack[i])); } finally { this._restoring = false; }
    this._emit();
  }
  _emit() { this.app.dispatchEvent({ type: 'history', canUndo: this.canUndo, canRedo: this.canRedo, held: this._holds > 0 }); }
}

/**
 * Long-press feedback: a small ring at the finger that fills while a press stays still
 * (pure DOM + CSS animation: no frame needed, never in captures).
 */
class HoldRing {
  constructor() { this.el = null; }
  show(x, y, ms) {
    if (typeof document === 'undefined') return;
    let el = this.el;
    if (!el) {
      el = this.el = document.createElement('div');
      el.className = 'pv-hold-ring';
      el.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="bg" cx="24" cy="24" r="19"/><circle class="fg" cx="24" cy="24" r="19"/></svg>';
    }
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.setProperty('--pv-hold-ms', Math.max(60, ms) + 'ms');
    el.classList.remove('on');
    if (!el.isConnected) document.body.appendChild(el);
    void el.offsetWidth; // restart the fill animation
    el.classList.add('on');
  }
  hide() { if (this.el?.isConnected) { this.el.classList.remove('on'); this.el.remove(); } }
}
