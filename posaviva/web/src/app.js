// Application core: renderer, scene, camera, characters, selection, modules,
// on-demand rendering, undo/redo history and (de)serialization.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Character } from './core/Character.js';
import { materials } from './render/materials.js';

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

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
    this.camera.filmGauge = 35;
    this.camera.setFocalLength(50);
    this.camera.position.set(0.0, 1.35, 4.2);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 40;
    this.controls.addEventListener('change', () => this.invalidate());
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
    const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), undefined);
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
    this._timer = new THREE.Timer();
    this._timer.connect?.(document);
    this.history = new History(this);
    this.raycaster = new THREE.Raycaster();
    this._tapHandlers = [];
    this._backHandlers = [];
    this._setupTapRouter();

    materials.addEventListener('style', () => this.invalidate());
    this._resize = this._resize.bind(this);
    new ResizeObserver(this._resize).observe(container);
    this._resize();
    renderer.setAnimationLoop(() => this._frame());
  }

  // ------------------------------------------------------------ modules
  /** module: {init?(app), onCharacterAdded?(ch), onCharacterRemoved?(ch), serializeScene?(), deserializeScene?(obj), deserializeCharacter?(ch)} */
  registerModule(name, module) {
    this.modules[name] = module;
    module.init?.(this);
    for (const ch of this.characters) module.onCharacterAdded?.(ch);
    return module;
  }

  /** Called every frame while rendering; return true to keep rendering continuously. */
  addRenderHook(fn) { this._renderHooks.add(fn); return () => this._renderHooks.delete(fn); }
  addAfterRenderHook(fn) { this._afterRender.add(fn); return () => this._afterRender.delete(fn); }

  invalidate() { this._needsRender = true; }

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

  /** Android back handler stack: fn() -> true if handled (e.g. exit a mode). */
  pushBackHandler(fn) { this._backHandlers.push(fn); return () => { const i = this._backHandlers.indexOf(fn); if (i >= 0) this._backHandlers.splice(i, 1); }; }

  _setupTapRouter() {
    const c = this.canvas;
    let down = null;
    c.addEventListener('pointerdown', (e) => {
      if (down) { down.multi = true; return; }
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, multi: false };
    });
    const up = (e) => {
      if (!down || e.pointerId !== down.id) return;
      const d = down; down = null;
      if (d.multi || e.type === 'pointercancel') return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || performance.now() - d.t > 450) return;
      const ndc = this.pointerToNDC(e);
      for (const h of this._tapHandlers) if (h.fn({ ndc, event: e, x: e.clientX, y: e.clientY })) break;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
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
    for (const m of Object.values(this.modules)) m.onCharacterAdded?.(ch, opts);
    if (opts.json) for (const m of Object.values(this.modules)) m.deserializeCharacter?.(ch);
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
    for (const m of Object.values(this.modules)) m.onCharacterRemoved?.(ch);
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
    for (const [name, m] of Object.entries(this.modules)) if (m.serializeScene) scene[name] = m.serializeScene();
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
    for (const [name, m] of Object.entries(this.modules)) if (json.scene?.[name] !== undefined) m.deserializeScene?.(json.scene[name], sceneOpts);
    const order = [];
    for (const cj of incoming) {
      let ch = this.characters.find((c) => c.id === cj.id);
      if (ch) {
        ch.fromJSON(cj);
        for (const m of Object.values(this.modules)) m.deserializeCharacter?.(ch);
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

  _frame() {
    this._timer.update();
    const dt = Math.min(this._timer.getDelta(), 0.1);
    let keep = this.controls.update(dt) || false;
    for (const fn of this._renderHooks) keep = fn(dt) || keep;
    if (!this._needsRender && !keep) return;
    this._needsRender = false;
    this.renderNow();
    for (const fn of this._afterRender) fn(dt);
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

class History {
  constructor(app) { this.app = app; this.stack = []; this.index = -1; this.limit = 60; this._restoring = false; }
  reset() { this.stack = [JSON.stringify(this.app.serialize())]; this.index = 0; this._emit(); }
  push(label) {
    if (this._restoring) return;
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
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.stack.length - 1; }
  undo() { if (this.canUndo) this._restore(--this.index); }
  redo() { if (this.canRedo) this._restore(++this.index); }
  _restore(i) {
    this._restoring = true;
    try { this.app.deserialize(JSON.parse(this.stack[i])); } finally { this._restoring = false; }
    this._emit();
  }
  _emit() { this.app.dispatchEvent({ type: 'history', canUndo: this.canUndo, canRedo: this.canRedo }); }
}
