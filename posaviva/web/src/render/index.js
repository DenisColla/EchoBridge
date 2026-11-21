// "render" module: render styles, post-processing (ink outlines, ambient
// occlusion, backgrounds), performance policy and image capture.
// See posaviva/ARCHITECTURE.md for the module contract.
//
// Public API (also on app.modules.render):
//   app.capture({scale=2, transparent, width, height}) -> Promise<HTMLCanvasElement>
//   mod.getSettings() / mod.set(patch, {commit})  scene-level style settings (serialized)
//   mod.setStyle(id)                              'realistic' | 'clay' | 'toon' | 'lines'
//   mod.setQuality('alta'|'media'|'bassa')        device preference (localStorage)
//   mod.quality                                   current preset {id, prCap, shadow, aoScale, aoSamples}
// Events on app: 'renderstyle' {settings} after any style setting changes,
//   'capture' {phase:'before'|'after', transparent} around captures (hide your 2D overlays if needed).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { materials, STYLES } from './materials.js';
import { RenderPipeline } from './pipeline.js';
import { PerfController } from './perf.js';
import { buildStylePanel } from './panel.js';

/** Renderer configuration per style. env = environment (IBL) intensity. */
const STYLE_RENDER = {
  realistic: { toneMapping: THREE.NeutralToneMapping, env: 0.22, exposure: true, ao: true },
  clay: { toneMapping: THREE.NeutralToneMapping, env: 0.42, exposure: true, ao: true },
  toon: { toneMapping: THREE.NoToneMapping, env: 0, exposure: false, ao: false },
  lines: { toneMapping: THREE.NoToneMapping, env: 0, exposure: false, ao: false },
};

export const QUALITY = {
  alta: { id: 'alta', label: 'Alta', prCap: 2, shadow: 2048, aoScale: 0.5, aoSamples: 12 },
  media: { id: 'media', label: 'Media', prCap: 1.5, shadow: 1024, aoScale: 0.5, aoSamples: 8 },
  bassa: { id: 'bassa', label: 'Bassa', prCap: 1, shadow: 512, aoScale: 0.5, aoSamples: 6 },
};

export const DEFAULT_BG = '#2a2c33';
export const PAPER = '#f4f1ea';
const DEFAULTS = {
  style: 'realistic',
  /** outlines on/off remembered per style */
  outline: { realistic: false, clay: false, toon: true, lines: true },
  inkWidth: 1.5, // CSS px
  inkColor: '#141414',
  crease: 0.45, // inner lines sensitivity 0..1 (0 = off)
  bg: { type: 'solid', color: DEFAULT_BG, top: '#5d6577', bottom: '#1b1d23' },
  ground: true, grid: true, shadows: true,
  ao: true, aoIntensity: 0.8,
  exposure: 1,
};
const PREFS_KEY = 'posaviva.render.prefs';

const clone = (o) => JSON.parse(JSON.stringify(o));
/** JSON with sorted keys: settings comparison independent of key order. */
const stableKey = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));

function loadPrefs() {
  const p = { quality: 'alta', dynamic: true, fps: false };
  try { Object.assign(p, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* private mode */ }
  if (!QUALITY[p.quality]) p.quality = 'alta';
  return p;
}

export function create(app, shell) {
  const renderer = app.renderer, scene = app.scene;
  const pipeline = new RenderPipeline(app, materials);
  const perf = new PerfController(app, shell, pipeline);
  const state = clone(DEFAULTS);
  state.style = materials.style;
  const prefs = loadPrefs();
  let envTex = null;
  let holdFrames = false; // true while new shader programs compile after a style switch
  let compileToken = 0;
  let autoBg = null; // background replaced automatically by the 'lines' style (restored on leave)
  const solidBg = new THREE.Color();
  const override = (r, s, c) => { if (!holdFrames) pipeline.render(r, s, c); };

  // PCFSoftShadowMap was removed in three r18x (it only logs a warning); PCF is the same thing now.
  if (renderer.shadowMap.type === THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFShadowMap;

  function ensureEnv() {
    if (envTex) return envTex;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    envTex = pmrem.fromScene(room, 0.04).texture;
    room.dispose?.();
    pmrem.dispose();
    return envTex;
  }

  const quality = () => QUALITY[prefs.quality];
  const styleCfg = () => STYLE_RENDER[state.style] || STYLE_RENDER.realistic;

  // -------------------------------------------------------------- apply settings
  function applyRendererState() {
    const sr = styleCfg();
    renderer.toneMapping = sr.toneMapping;
    renderer.toneMappingExposure = sr.exposure ? state.exposure : 1;
    if (sr.env > 0) {
      const env = ensureEnv();
      // the scene module may install its own environment: only manage ours
      if (scene.environment === null || scene.environment === env) { scene.environment = env; scene.environmentIntensity = sr.env; }
    } else if (envTex && scene.environment === envTex) scene.environmentIntensity = 0;

    app.ground.visible = !!state.ground;
    app.grid.visible = !!state.grid;
    if (renderer.shadowMap.enabled !== !!state.shadows) {
      renderer.shadowMap.enabled = !!state.shadows;
      refreshAllPrograms();
    }
  }

  /** Shadow on/off changes shader programs: flag every material (scene + library cache). */
  function refreshAllPrograms() {
    const flag = (m) => { if (m) m.needsUpdate = true; };
    scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material.forEach(flag) : flag(o.material)); });
    for (const m of materials.cache.values()) flag(m);
  }

  function applyPipeline() {
    const q = quality(), sr = styleCfg(), o = pipeline.opts;
    o.ink = !!state.outline[state.style];
    o.inkWidth = state.inkWidth;
    o.inkColor = state.inkColor;
    o.crease = state.crease;
    o.ao = !!(state.ao && sr.ao);
    o.aoIntensity = state.aoIntensity;
    o.aoScale = q.aoScale;
    o.aoSamples = q.aoSamples;
    o.bg = state.bg;
    o.shadowMapSize = q.shadow;
    // plain path when nothing special is needed
    if (state.bg.type === 'solid') scene.background = solidBg.set(state.bg.color);
    else if (state.bg.type === 'gradient') scene.background = solidBg.set(state.bg.bottom).lerp(new THREE.Color(state.bg.top), 0.5);
    else scene.background = null;
    app.renderOverride = pipeline.needed || holdFrames ? override : null;
    app.invalidate();
  }

  function applyAll() {
    if (materials.style !== state.style) materials.setStyle(state.style);
    applyRendererState();
    applyPipeline();
    panel?.sync();
    app.dispatchEvent({ type: 'renderstyle', settings: getSettings() });
  }

  /** Shadow resolution cap of the quality preset (scene light rig API when available). */
  function applyShadowQuality() {
    pipeline.opts.shadowMapSize = quality().shadow;
    app.lightRig?.setShadowQuality?.(quality().shadow);
    pipeline.applyShadowSizes(scene);
  }

  function applyPrefs() {
    perf.setCap(quality().prCap);
    perf.setDynamic(prefs.dynamic);
    perf.setMeter(prefs.fps);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }

  // -------------------------------------------------------------- style switching
  /** Switches style; new shader programs are compiled asynchronously when supported (no UI jank). */
  async function setStyle(id, auto = true) {
    if (!STYLE_RENDER[id] || id === state.style) return;
    // tracing style: a dark default background makes no sense, switch to paper (restored on leave)
    if (auto && id === 'lines' && state.bg.type === 'solid' && state.bg.color.toLowerCase() === DEFAULT_BG) { autoBg = clone(state.bg); state.bg = { ...state.bg, color: PAPER }; }
    else if (auto && state.style === 'lines' && autoBg && state.bg.type === 'solid' && state.bg.color === PAPER) { state.bg = autoBg; autoBg = null; }
    state.style = id;
    const token = ++compileToken;
    // parallel compile keeps the UI responsive; without the extension compileAsync would just block
    holdFrames = !!renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile');
    applyAll();
    if (!holdFrames) return;
    try {
      await Promise.race([renderer.compileAsync(scene, app.camera), new Promise((r) => setTimeout(r, 1800))]);
    } catch { /* compile errors surface on the next render anyway */ }
    if (token !== compileToken) return;
    holdFrames = false;
    applyPipeline();
  }

  function getSettings() { return clone(state); }

  /** Updates scene-level settings. opts.commit = undo label (omit while dragging sliders). */
  function set(patch, opts = {}) {
    const { style, ...rest } = patch;
    for (const [k, v] of Object.entries(rest)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && state[k] && typeof state[k] === 'object') state[k] = { ...state[k], ...v };
      else state[k] = v;
    }
    if (patch.bg) autoBg = null;
    if (style && style !== state.style) setStyle(style).then(() => opts.commit && app.commit(opts.commit));
    else { applyAll(); if (opts.commit) app.commit(opts.commit); }
  }

  function setQuality(id) {
    if (!QUALITY[id]) return;
    prefs.quality = id;
    applyPrefs();
    applyShadowQuality();
    applyPipeline();
    panel?.sync();
  }

  function setPref(k, v) {
    prefs[k] = v;
    applyPrefs();
    panel?.sync();
  }

  // -------------------------------------------------------------- capture
  /**
   * Renders the current camera view at high resolution with the current style
   * (outlines and AO included), without UI helpers. Returns a 2D canvas.
   * transparent defaults to true when the background is set to "Trasparente".
   */
  async function capture({ scale = 2, transparent, width, height } = {}) {
    if (transparent === undefined) transparent = state.bg.type === 'transparent';
    const cam = app.camera, canvas = app.canvas;
    const cssW = canvas.clientWidth || canvas.width || 1, cssH = canvas.clientHeight || canvas.height || 1;
    let W, H;
    if (width && height) { W = width; H = height; }
    else if (width) { W = width; H = Math.round((width * cssH) / cssW); }
    else if (height) { H = height; W = Math.round((height * cssW) / cssH); }
    else { W = Math.round(cssW * scale); H = Math.round(cssH * scale); }
    const maxSide = Math.min(renderer.capabilities.maxTextureSize || 4096, 8192);
    const k = Math.min(1, maxSide / W, maxSide / H, Math.sqrt(36e6 / (W * H)));
    W = Math.max(1, Math.floor(W * k)); H = Math.max(1, Math.floor(H * k));
    const pxScale = H / cssH; // the vertical field of view is preserved -> scale lines by height

    const aspect0 = cam.aspect;
    const changeAspect = cam.isPerspectiveCamera && Math.abs(W / H - aspect0) > 1e-4;
    if (changeAspect) { cam.aspect = W / H; cam.updateProjectionMatrix(); }
    app.dispatchEvent({ type: 'capture', phase: 'before', transparent });
    let res;
    try {
      cam.updateMatrixWorld();
      res = pipeline.renderCapture(renderer, scene, cam, {
        w: W, h: H, pxScale, transparent, toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure,
      });
    } finally {
      if (changeAspect) { cam.aspect = aspect0; cam.updateProjectionMatrix(); }
      app.dispatchEvent({ type: 'capture', phase: 'after', transparent });
      app.invalidate();
    }
    const buf = new Uint8Array(W * H * 4);
    try {
      if (renderer.readRenderTargetPixelsAsync) await renderer.readRenderTargetPixelsAsync(res.target, 0, 0, W, H, buf);
      else renderer.readRenderTargetPixels(res.target, 0, 0, W, H, buf);
    } finally { res.dispose(); }
    // GL rows are bottom-up
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    const img = ctx.createImageData(W, H);
    const row = W * 4;
    for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    return out;
  }
  app.capture = capture;

  // -------------------------------------------------------------- module object
  let panel = null;
  const mod = {
    pipeline, perf, materials,
    get quality() { return quality(); },
    get prefs() { return { ...prefs }; },
    getSettings, set, setStyle, setQuality, setPref, capture,
    STYLES,

    serializeScene() { return getSettings(); },
    deserializeScene(obj) {
      if (!obj || typeof obj !== 'object') return;
      const next = { ...clone(DEFAULTS), ...clone(obj) };
      next.outline = { ...DEFAULTS.outline, ...(obj.outline || {}) };
      next.bg = { ...DEFAULTS.bg, ...(obj.bg || {}) };
      if (!STYLE_RENDER[next.style]) next.style = state.style;
      if (stableKey(next) === stableKey(state)) return; // undo/redo of other modules: nothing to do
      const styleChanged = next.style !== state.style;
      const target = next.style;
      Object.assign(state, next);
      autoBg = null;
      if (styleChanged) { state.style = materials.style; setStyle(target, false); } else applyAll();
    },
  };

  shell.registerTool({
    id: 'style', group: 'style', label: 'Stile', icon: 'palette', order: 100, title: 'Stile e resa',
    build(container) {
      panel = buildStylePanel(container, {
        app, STYLES, QUALITY, STYLE_RENDER,
        getState: () => state, getPrefs: () => prefs,
        set, setStyle: (id) => setStyle(id).then(() => app.commit('stile')), setQuality, setPref,
      });
      return { onShow: () => panel.sync() };
    },
  });

  // keep shadow sizes enforced for lights added later on the plain path (cheap, throttled)
  let lastLightScan = 0;
  app.addAfterRenderHook(() => {
    const now = performance.now();
    if (!app.renderOverride && now - lastLightScan > 1000) { lastLightScan = now; pipeline.applyShadowSizes(scene); }
  });

  // the scene module (light rig) registers after this one
  app.addEventListener('ready', applyShadowQuality);

  applyPrefs();
  applyShadowQuality();
  applyAll();
  return mod;
}
