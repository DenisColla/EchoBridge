// "render" module: render styles, post-processing (ink outlines, ambient
// occlusion, backgrounds), performance policy and image capture.
// See posaviva/ARCHITECTURE.md for the module contract.
//
// Public API (also on app.modules.render):
//   app.capture({scale=2, transparent, width, height}) -> Promise<HTMLCanvasElement>
//   mod.getSettings() / mod.set(patch, {commit})  scene-level style settings (serialized)
//   mod.setStyle(id)                              'realistic' | 'clay' | 'toon' | 'lines'
//   mod.setQuality('auto'|'alta'|'media'|'bassa') device preference (localStorage); 'auto' = tier default
//   mod.quality                                   effective preset (device.js QUALITY) + {auto}
//   mod.device                                    detected device {tier, quality, gpu, memoryGB, tablet, …}
//   settings.softSkin (bool, default true)        'Deformazione morbida': dual-quaternion skinning
//   settings.anatomy (0..1, 0 = off)              'Linee anatomiche': skin crease lines (toon / lines + ink)
// Events on app: 'renderstyle' {settings} after any style setting changes,
//   'capture' {phase:'before'|'after', transparent} around captures (hide your 2D overlays if needed).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { materials, STYLES, softSkin, anatomyLines } from './materials.js';
import { invalidateAnatomy, uvIslandMask, invalidateUvMask } from './anatomy.js';
import { RenderPipeline } from './pipeline.js';
import { PerfController } from './perf.js';
import { buildStylePanel } from './panel.js';
import { QUALITY, TIER_LABEL, detectDevice } from './device.js';
import { fitTextureToCap } from './materials.js';

export { QUALITY };

/** Renderer configuration per style. env = environment (IBL) intensity. */
// skinWarm = subsurface warmth of the ambient occlusion on skin (0..1)
const STYLE_RENDER = {
  realistic: { toneMapping: THREE.NeutralToneMapping, env: 0.22, exposure: true, ao: true, skinWarm: 1 },
  clay: { toneMapping: THREE.NeutralToneMapping, env: 0.42, exposure: true, ao: true, skinWarm: 0.25 },
  toon: { toneMapping: THREE.NoToneMapping, env: 0, exposure: false, ao: false, skinWarm: 0 },
  lines: { toneMapping: THREE.NoToneMapping, env: 0, exposure: false, ao: false, skinWarm: 0 },
};
/** styles whose skin can draw anatomical crease lines (with the ink outlines on) */
const ANATOMY_LINE_STYLES = new Set(['toon', 'lines']);


export const DEFAULT_BG = '#2a2c33';
/** app.capture() rejects with this message while the WebGL context is lost. */
export const CONTEXT_LOST_MSG = 'La grafica si sta ripristinando: riprova tra qualche secondo.';
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
  softSkin: true, // 'Deformazione morbida' (dual-quaternion skinning)
  anatomy: 0.3, // 'Linee anatomiche' 0..1 (0 = off)
};
const PREFS_KEY = 'posaviva.render.prefs';

const clone = (o) => JSON.parse(JSON.stringify(o));
/** JSON with sorted keys: settings comparison independent of key order. */
const stableKey = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));

/**
 * Device preferences. quality 'auto' follows the device tier (render/device.js). Version 1
 * stored 'alta' at every start whatever the user did, so its quality is only kept when the
 * user had picked one in Menu › Impostazioni (io settings key 'quality').
 */
function loadPrefs() {
  const p = { v: 2, quality: 'auto', dynamic: true, fps: false };
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); } catch { /* private mode */ }
  if (stored && typeof stored === 'object') {
    p.dynamic = stored.dynamic !== false;
    p.fps = !!stored.fps;
    if (stored.v === 2) p.quality = stored.quality;
    else {
      try { const io = JSON.parse(localStorage.getItem('posaviva.settings') || '{}'); if (QUALITY[io?.quality]) p.quality = io.quality; } catch { /* ignore */ }
    }
  }
  if (p.quality !== 'auto' && !QUALITY[p.quality]) p.quality = 'auto';
  return p;
}

/** three.js warns once per upload of every texture it scales down to the preset's size cap: expected, not news. */
let consoleFiltered = false;
function filterResizeWarnings() {
  if (consoleFiltered || typeof THREE.setConsoleFunction !== 'function') return;
  consoleFiltered = true;
  const prev = THREE.getConsoleFunction?.() || null;
  THREE.setConsoleFunction((type, message, ...params) => {
    if (type === 'warn' && /Texture has been resized|DataTexture is too big/.test(String(message))) return;
    if (prev) prev(type, message, ...params);
    else (console[type] || console.log)(message, ...params);
  });
}

export function create(app, shell) {
  const renderer = app.renderer, scene = app.scene;
  const pipeline = new RenderPipeline(app, materials);
  const perf = new PerfController(app, shell, pipeline);
  const state = clone(DEFAULTS);
  state.style = materials.style;
  const prefs = loadPrefs();
  // device tier -> default quality; the real texture limit is kept for captures
  const device = detectDevice(renderer.getContext());
  const realMaxTexture = device.maxTextureSize || renderer.capabilities.maxTextureSize || 4096;
  filterResizeWarnings();
  console.info(`[PosaViva] dispositivo: ${device.tier} (${TIER_LABEL[device.tier]}) · qualità predefinita ${device.quality} · ${device.reasons.join(' · ')}`);
  let envTex = null;
  let holdFrames = false; // true while new shader programs compile after a style switch
  let compileToken = 0;
  let autoBg = null; // background replaced automatically by the 'lines' style (restored on leave)
  const solidBg = new THREE.Color();
  const override = (r, s, c) => { if (!holdFrames) pipeline.render(r, s, c); };
  // the library derives the anatomy maps (cavity, crease lines) on the GPU and checks DQS support
  materials.setRenderer(renderer, uvIslandMask(renderer, app.model));

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

  const quality = () => QUALITY[prefs.quality === 'auto' ? device.quality : prefs.quality] || QUALITY.alta;
  const styleCfg = () => STYLE_RENDER[state.style] || STYLE_RENDER.realistic;

  // -------------------------------------------------------------- apply settings
  /**
   * Environment (IBL) fill: the style's base intensity, scaled by the light rig's
   * ambient level when the rig exposes `envScale` (contract: the rig never writes
   * scene.environmentIntensity itself then, it calls applyRendererState() or fires a
   * 'change' event when its ambient changes). Returns true when the value changed.
   */
  function applyEnv() {
    const sr = styleCfg();
    const k = app.lightRig && typeof app.lightRig.envScale === 'number' ? Math.max(0, app.lightRig.envScale) : 1;
    const before = scene.environmentIntensity;
    if (sr.env > 0) {
      const env = ensureEnv();
      // the scene module may install its own environment: only manage ours
      if (scene.environment === null || scene.environment === env) { scene.environment = env; scene.environmentIntensity = sr.env * k; }
    } else if (envTex && scene.environment === envTex) scene.environmentIntensity = 0;
    return scene.environmentIntensity !== before;
  }

  function applyRendererState() {
    const sr = styleCfg();
    renderer.toneMapping = sr.toneMapping;
    renderer.toneMappingExposure = sr.exposure ? state.exposure : 1;
    if (applyEnv()) app.invalidate();

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
    o.aoMode = q.ao || 'on';
    o.bg = state.bg;
    o.shadowMapSize = q.shadow;
    o.skinWarm = sr.skinWarm || 0;
    // anatomical crease lines: groove strength threshold from the slider (> 1 = off)
    const a = +state.anatomy || 0;
    anatomyLines.value.set(o.ink && ANATOMY_LINE_STYLES.has(state.style) && a > 0.005 ? THREE.MathUtils.lerp(0.8, 0.1, a) : 2, 1);
    // plain path when nothing special is needed
    if (state.bg.type === 'solid') scene.background = solidBg.set(state.bg.color);
    else if (state.bg.type === 'gradient') scene.background = solidBg.set(state.bg.bottom).lerp(new THREE.Color(state.bg.top), 0.5);
    else scene.background = null;
    app.renderOverride = pipeline.needed || holdFrames ? override : null;
    app.invalidate();
  }

  /**
   * Programs changed outside a style switch (soft skinning toggled): compile them
   * asynchronously when the driver can, keeping the previous frame on screen.
   */
  async function compileHeld() {
    const token = ++compileToken;
    holdFrames = !!renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile');
    applyPipeline();
    if (!holdFrames) return;
    try {
      await Promise.race([renderer.compileAsync(scene, app.camera), new Promise((r) => setTimeout(r, 1800))]);
    } catch { /* compile errors surface on the next render anyway */ }
    if (token !== compileToken) return;
    holdFrames = false;
    applyPipeline();
  }

  function applyAll() {
    if (materials.style !== state.style) materials.setStyle(state.style);
    // 'Deformazione morbida': flips the DQS define on every skinned program (one recompile)
    if (softSkin.enabled !== !!state.softSkin && softSkin.setEnabled(!!state.softSkin) > 0 && !holdFrames) compileHeld();
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

  // -------------------------------------------------------------- quality preset
  /** Thermal / battery saving state pushed by the Android shell (window.__onDeviceState). */
  const devState = { thermal: 0, powerSave: false };

  /** Frame-rate cap of the preset (lowered further by heat / battery saving). */
  function frameCap() {
    let fps = quality().fps || 0;
    if (devState.powerSave || devState.thermal >= 2) fps = fps ? Math.min(fps, 60) : 60;
    if (devState.thermal >= 4) fps = 30;
    return fps;
  }

  /** Display rate on Android (60 Hz on mid tier / Media saves battery and heat), page-side cap elsewhere. */
  let lastFps = -1;
  function applyFrameRate() {
    const fps = frameCap();
    app.setFrameRateCap?.(fps);
    if (fps === lastFps) return;
    lastFps = fps;
    try { window.AndroidBridge?.setPreferredFrameRate?.(fps); } catch { /* older shell */ }
  }

  /** Largest texture side uploaded (preset texMax): three.js scales images down at upload. */
  let texCap = realMaxTexture;
  function applyTextureCap() {
    const q = quality();
    const cap = q.texMax > 0 ? Math.min(realMaxTexture, q.texMax) : realMaxTexture;
    if (cap === texCap) return;
    const lower = Math.min(cap, texCap);
    texCap = cap;
    renderer.capabilities.maxTextureSize = cap;
    materials.textureCap = q.texMax > 0 ? cap : 0;
    // textures uploaded under the previous limit are uploaded again
    const seen = new Set();
    const visit = (t) => {
      if (!t || !t.isTexture || seen.has(t) || t.isRenderTargetTexture) return;
      seen.add(t);
      const im = t.userData?.pvFullImage || t.image;
      if (!im || !(im.width > lower || im.height > lower) || ('data' in im)) return;
      fitTextureToCap(t, materials.textureCap);
      // the GPU copy changes size: three.js allocates immutable storage (texStorage2D),
      // so the texture must be released and uploaded again, not just updated
      t.dispose();
      t.needsUpdate = true;
    };
    const visitMat = (m) => { if (!m) return; for (const v of Object.values(m)) if (v && v.isTexture) visit(v); if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u?.value?.isTexture) visit(u.value); };
    scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material.forEach(visitMat) : visitMat(o.material)); });
    for (const m of materials.cache.values()) visitMat(m);
    for (const t of Object.values(materials.textures)) visit(t);
    app.invalidate();
  }

  /** Garment build time per frame (ms): smaller on slower presets keeps gestures fluid while outfits rebuild. */
  function applyBudgets() {
    const mgr = app.clothing?.manager;
    if (mgr && typeof mgr.budget === 'number') mgr.budget = quality().buildBudget || mgr.budget;
  }

  function applyQualityPreset() {
    const q = quality();
    perf.setQuality(q);
    pipeline.opts.aoMode = q.ao || 'on';
    app.shadowEvery = q.shadowEvery || 1;
    applyTextureCap();
    applyFrameRate();
    applyBudgets();
  }

  function applyPrefs() {
    applyQualityPreset();
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

  /** 'alta' | 'media' | 'bassa' (manual, remembered) or 'auto' (follows the device tier). */
  function setQuality(id) {
    if (!QUALITY[id] && id !== 'auto') return;
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
    // a lost WebGL context renders nothing: never hand out a blank image
    if (app.contextLost || renderer.getContext().isContextLost?.()) throw new Error(CONTEXT_LOST_MSG);
    if (transparent === undefined) transparent = state.bg.type === 'transparent';
    const cam = app.camera, canvas = app.canvas;
    const cssW = canvas.clientWidth || canvas.width || 1, cssH = canvas.clientHeight || canvas.height || 1;
    let W, H;
    if (width && height) { W = width; H = height; }
    else if (width) { W = width; H = Math.round((width * cssH) / cssW); }
    else if (height) { H = height; W = Math.round((height * cssW) / cssH); }
    else { W = Math.round(cssW * scale); H = Math.round(cssH * scale); }
    // the real GPU limit (renderer.capabilities.maxTextureSize may hold the preset's texture cap)
    const maxSide = Math.min(realMaxTexture || 4096, 8192);
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
    // the context may have been lost while the pixels were read back
    if (app.contextLost) throw new Error(CONTEXT_LOST_MSG);
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
    pipeline, perf, materials, device,
    /** effective preset (+ auto: true when it follows the device tier) */
    get quality() { return { ...quality(), auto: prefs.quality === 'auto' }; },
    /** device preferences; quality is the EFFECTIVE level (auto resolved), auto tells which */
    get prefs() { return { ...prefs, quality: quality().id, auto: prefs.quality === 'auto' }; },
    getSettings, set, setStyle, setQuality, setPref, capture,
    /** dual-quaternion skinning controller ({enabled, supported, active}); toggle with set({softSkin}) */
    softSkin,
    /** re-applies tone mapping, environment fill (style base × app.lightRig.envScale), floor, grid, shadows */
    applyRendererState,
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
        app, STYLES, QUALITY, STYLE_RENDER, softSkin, ANATOMY_LINE_STYLES, device, TIER_LABEL, perf,
        getState: () => state, getPrefs: () => prefs, getQuality: () => quality(),
        set, setStyle: (id) => setStyle(id).then(() => app.commit('stile')), setQuality, setPref,
      });
      return { onShow: () => panel.sync() };
    },
  });

  // keep shadow sizes enforced for lights added later on the plain path (cheap, throttled)
  let lastLightScan = 0;
  app.addAfterRenderHook(() => {
    const now = performance.now();
    if (!app.renderOverride && now - lastLightScan > 1000) { lastLightScan = now; if (pipeline.applyShadowSizes(scene)) app.invalidate(); }
  });

  // the scene module (light rig) and clothing register after this one
  app.addEventListener('ready', applyShadowQuality);
  app.addEventListener('ready', applyBudgets);

  // memory pressure (Android onTrimMemory -> app.trimMemory): screen buffers and the
  // materials of styles no longer shown are dropped; both come back on demand
  app.addEventListener('memorypressure', (e) => {
    try {
      materials._sweep?.();
      if (e.background || e.level >= 15) pipeline.releaseTargets();
    } catch (err) { console.warn('[render] memory trim failed', err); }
  });

  // heat / battery saving (Android shell): lower frame rate first, then resolution
  window.__onDeviceState = (st = {}) => {
    if (typeof st.thermal === 'number') devState.thermal = st.thermal;
    if (typeof st.powerSave === 'boolean') devState.powerSave = st.powerSave;
    perf.setThrottle(devState.thermal >= 3 ? 0.8 : 1);
    applyFrameRate();
    panel?.sync();
  };
  if (device.android && (device.android.thermalStatus || device.android.powerSave)) window.__onDeviceState({ thermal: device.android.thermalStatus || 0, powerSave: !!device.android.powerSave });
  // light rig ambient -> environment fill (when the rig exposes envScale, see applyEnv)
  let rigHooked = null;
  const hookRig = () => {
    const rig = app.lightRig;
    if (!rig?.addEventListener || rig === rigHooked) return;
    rigHooked = rig;
    rig.addEventListener('change', () => { if (typeof rig.envScale === 'number' && applyEnv()) app.invalidate(); });
    if (typeof rig.envScale === 'number' && applyEnv()) app.invalidate();
  };
  app.addEventListener('ready', hookRig);

  // WebGL context restored: three.js re-uploads geometry, textures and targets lazily,
  // but GPU-generated content is gone. The PMREM environment map was rendered on the
  // GPU (it would come back black): build a new one. The pipeline's targets and
  // GTAO buffers are re-rendered every frame; shadow maps are flagged by the app.
  app.addEventListener('contextrestored', () => {
    // three.js rebuilds renderer.capabilities on restore: keep the preset's texture cap
    renderer.capabilities.maxTextureSize = texCap;
    // the anatomy maps were rendered on the GPU as well: rebuild them (and the materials using them)
    for (const k of ['skinNormal', 'skinNormalM']) invalidateAnatomy(materials.textures[k]);
    invalidateUvMask(app.model);
    materials.uvMask = uvIslandMask(renderer, app.model);
    materials.rebuildAll();
    // the old PMREM map died with the context: drop it (disposing would delete stale handles)
    const old = envTex;
    envTex = null;
    if (old && scene.environment === old) scene.environment = null;
    applyRendererState();
    app.dispatchEvent({ type: 'renderstyle', settings: getSettings() }); // the rig rescales the new environment
    app.invalidate();
  });

  applyPrefs();
  applyShadowQuality();
  applyAll();
  return mod;
}
