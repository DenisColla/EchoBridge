// Render pipeline used through app.renderOverride when the frame needs more
// than a plain renderer.render(): ink outlines, ambient occlusion, gradient /
// checker backgrounds, and high-resolution captures.
//
// Screen frame (canvas keeps its native MSAA):
//   [prepass G-buffer] -> [GTAO] -> [edges -> horizontal distance]
//   -> background + scene to canvas (UI helpers hidden)
//   -> AO multiply quad -> ink quad -> UI helpers on top (gizmos stay above ink).
// Capture: same passes at export size into an MSAA HDR target, then one output
// pass (tone mapping, sRGB, AO, background, ink) into RGBA8 which is read back.
//
// Object classes (decided every frame, no allocations):
//   content  = meshes managed by the material library (bodies, garments, hair, props)
//   grounds  = library meshes of kind 'ground' / userData.isGround (id 0: never inked)
//   grid     = app.grid (backdrop, not in the G-buffer)
//   helpers  = every other renderable (gizmos, handles, light icons, guides):
//              drawn after the ink on screen, hidden in captures unless userData.export === true.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import {
  MAX_INK_RADIUS, makePrepassMaterial, makeEdgeMaterial, makeHDistMaterial, makeInkMaterial,
  makeAOMultiplyMaterial, makeBackgroundMaterial, makeOutputMaterial, setOutputToneMapping, SKIN_ID0,
} from './shaders.js';
import { inkLinePx, inkColorLinear } from './materials.js';

const _size = new THREE.Vector2();
const _color = new THREE.Color();

const _rgb = { r: 0, g: 0, b: 0 };
/** sRGB components of a CSS color into a Vector3 (shaders composite in sRGB like the canvas). */
function srgbVec(css, out) {
  _color.set(css).getRGB(_rgb, THREE.SRGBColorSpace);
  return out.set(_rgb.r, _rgb.g, _rgb.b);
}

/** Screen-sized intermediate targets (G-buffer, edge seeds, horizontal distances). */
class TargetSet {
  /** @param {boolean} hdrNormals half-float G-buffer (smooth curvature for fold lines) when renderable */
  constructor(hdrNormals = false) {
    const depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false };
    this.gbuf = new THREE.WebGLRenderTarget(1, 1, { ...nearest, depthBuffer: true, depthTexture, type: hdrNormals ? THREE.HalfFloatType : THREE.UnsignedByteType });
    // 2 channels are enough: (contour, crease) seeds and their horizontal distances
    this.edge = new THREE.WebGLRenderTarget(1, 1, { ...nearest, format: THREE.RGFormat });
    this.hdist = new THREE.WebGLRenderTarget(1, 1, { ...nearest, format: THREE.RGFormat });
    this.w = 1; this.h = 1;
  }
  ensure(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.gbuf.setSize(w, h); this.edge.setSize(w, h); this.hdist.setSize(w, h);
  }
  dispose() { this.gbuf.depthTexture.dispose(); this.gbuf.dispose(); this.edge.dispose(); this.hdist.dispose(); }
}

export class RenderPipeline {
  /**
   * @param {import('../app.js').App} app
   * @param {*} materials material library
   */
  constructor(app, materials) {
    this.app = app;
    this.materials = materials;
    /** current frame options (owned by render/index.js) */
    this.opts = {
      ink: false, inkWidth: 1.5, inkColor: '#111111', inkOpacity: 1, crease: 0.5,
      ao: false, aoIntensity: 0.85, aoScale: 0.5, aoSamples: 12, aoRadius: 0.32,
      // quality preset: 'on' | 'rest' (the perf controller suspends AO while frames flow) |
      // 'off' (screen only: captures always get AO when the style setting is on)
      aoMode: 'on',
      skinWarm: 0, // warm (subsurface) tint of the AO on skin, 0..1 (set per style)
      bg: { type: 'solid', color: '#2a2c33', top: '#4b5262', bottom: '#1d1f25' },
      shadowMapSize: 2048,
    };
    const ext = app.renderer.extensions;
    this.floatTargets = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    this.screen = new TargetSet(this.floatTargets);
    this._quad = new FullScreenQuad(null);
    this.edgeMat = makeEdgeMaterial();
    this.hdistMat = makeHDistMaterial();
    this.inkMat = makeInkMaterial();
    this.aoMulMat = makeAOMultiplyMaterial();
    this.bgMat = makeBackgroundMaterial();
    this.outMat = makeOutputMaterial();
    this.groundPrepass = makePrepassMaterial(null, 0);
    this.groundPrepass.side = THREE.DoubleSide;
    this.shadowCatcher = new THREE.ShadowMaterial({ opacity: 0.32, color: 0x000000 });
    this._gtao = null; // created on first use (allocates noise textures + targets)

    // per-mesh G-buffer materials & ids
    this._pp = new WeakMap();
    this._ids = { regular: 0, folds: 0, contour: 0, skin: 0 };

    // reusable per-frame lists
    this.content = []; this.grounds = []; this.helpers = [];
    this._saved = []; this._hidden = [];
    this._visit = this._visit.bind(this);

    /** what the last screen frame used (FPS meter) */
    this.stats = { ao: false, ink: false };
    // targets that lived through a context restore still carry three.js' dispose listener
    // of the old context: dropping them is enough (disposing would delete stale handles)
    this._preRestore = false;
    app.addEventListener?.('contextrestored', () => { this._preRestore = true; });
  }

  dispose() {
    this.screen.dispose(); this._gtao?.dispose(); this._quad.dispose();
    for (const m of [this.edgeMat, this.hdistMat, this.inkMat, this.aoMulMat, this.bgMat, this.outMat, this.groundPrepass, this.shadowCatcher]) m.dispose();
  }

  /** true if the frame cannot be produced by a plain renderer.render() */
  get needed() { const o = this.opts; return o.ink || o.ao || o.bg.type !== 'solid'; }

  // -------------------------------------------------------------- classification
  _classify(scene) {
    this.content.length = 0; this.grounds.length = 0; this.helpers.length = 0;
    scene.traverseVisible(this._visit);
  }

  _visit(o) {
    if (o.isLight) { if (o.castShadow && o.shadow) this._enforceShadowSize(o); return; }
    if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return;
    if (o === this.app.grid) return;
    const mats = this.materials;
    if (mats.isTracked(o)) (o.userData.isGround || mats.kindOf(o) === 'ground' ? this.grounds : this.content).push(o);
    else if (o.isMesh && o.userData.isGround) this.grounds.push(o);
    else this.helpers.push(o);
  }

  /**
   * The quality preset caps the shadow map resolution of shadow-casting lights.
   * Lights of the scene module's rig (userData.pvManagedShadow) are capped through
   * app.lightRig.setShadowQuality() instead (it picks per-light sizes for softness).
   */
  _enforceShadowSize(light) {
    if (light.userData.pvManagedShadow) return false;
    const cap = light.isPointLight ? this.opts.shadowMapSize >> 1 : this.opts.shadowMapSize;
    const ms = light.shadow.mapSize;
    if (ms.x <= cap && ms.y <= cap) return false;
    ms.set(Math.min(ms.x, cap), Math.min(ms.y, cap));
    if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
    // shadow maps are cached between frames (app._shadowPolicy): the new map must be drawn
    // in this frame's shadow pass, never sampled empty
    this.app.renderer.shadowMap.needsUpdate = true;
    return true;
  }

  /** Scans the scene once (outside the frame loop) so shadow sizes apply immediately. Returns true if a map changed. */
  applyShadowSizes(scene) {
    let changed = false;
    scene.traverse((o) => { if (o.isLight && o.castShadow && o.shadow && this._enforceShadowSize(o)) changed = true; });
    return changed;
  }

  /** Drops the screen-sized buffers (memory pressure / app in background); rebuilt on the next post-processed frame. */
  releaseTargets() {
    if (!this._preRestore) {
      this.screen.dispose();
      this._gtao?.dispose();
    }
    this._preRestore = false;
    this.screen = new TargetSet(this.floatTargets);
    this._gtao = null;
  }

  _hide(list) { for (const o of list) { if (o.visible) { o.visible = false; this._hidden.push(o); } } }

  /**
   * "Transparent" background: the floor only keeps the shadows it receives (shadow catcher),
   * or disappears when there are no shadows (lines style / shadows off). Grid hidden.
   * Restored by _unhideAll() + _restoreGrounds().
   */
  _transparentGrounds(renderer) {
    const grid = this.app.grid;
    if (grid.visible) { grid.visible = false; this._hidden.push(grid); }
    const saved = this._groundMats || (this._groundMats = []);
    saved.length = 0;
    if (renderer.shadowMap.enabled && this.materials.style !== 'lines') for (const g of this.grounds) { saved.push(g.material); g.material = this.shadowCatcher; }
    else this._hide(this.grounds);
  }

  _restoreGrounds() {
    const saved = this._groundMats;
    if (!saved || !saved.length) return;
    for (let i = 0; i < saved.length && i < this.grounds.length; i++) this.grounds[i].material = saved[i];
    saved.length = 0;
  }
  _unhideAll() { for (const o of this._hidden) o.visible = true; this._hidden.length = 0; }

  // -------------------------------------------------------------- G-buffer
  _prepassMaterialFor(mesh) {
    const src = mesh.material;
    let e = this._pp.get(mesh);
    if (!e || e.src !== src) {
      if (e) (Array.isArray(e.out) ? e.out : [e.out]).forEach((m) => m.dispose());
      // keep the id of a mesh whose materials were swapped (style change), unless the
      // per-group id layout of a shoe no longer matches its material array
      const perGroup = Array.isArray(src) && !!mesh.userData.groundContact;
      const keep = e && (Array.isArray(e.id) ? perGroup && e.id.length === src.length : !perGroup);
      const id = keep ? e.id : this._allocId(this.materials.kindOf(mesh), mesh);
      const mk = (m, i = 0) => makePrepassMaterial(m, Array.isArray(id) ? id[i % id.length] : id);
      e = { src, id, out: Array.isArray(src) ? src.map(mk) : mk(src) };
      this._pp.set(mesh, e);
    }
    return e.out;
  }

  /**
   * Object ids encode which inner lines an object gets (see the edge shader):
   *   1..95    regular  — contours + sharp creases (props 1..63, skin bodies 64..95: the AO
   *                       passes give skin a warm occlusion)
   *   96..127  folds    — also curvature "valley" lines (garment wrinkles, geometric or normal-mapped)
   *   128..254 contour  — outlines and overlaps only: eyeballs (the concave iris must not draw
   *                       lines) and hair (creases between strand cards only make short,
   *                       flickering dashes; clump overlaps are still inked), and shoes
   *                       (userData.groundContact): their faceted toe boxes only drew specks;
   *                       each material group (upper, trim, sole) gets its own id, so the
   *                       sole / upper seams are still inked as boundaries.
   * Returns an array of ids (one per material group) for multi-material shoes.
   */
  _allocId(kind, mesh = null) {
    const c = this._ids;
    if (mesh?.userData.groundContact) {
      const n = Array.isArray(mesh.material) ? mesh.material.length : 0;
      return n ? Array.from({ length: n }, () => 128 + (c.contour++ % 127)) : 128 + (c.contour++ % 127);
    }
    if (kind === 'eye' || kind === 'hair') return 128 + (c.contour++ % 127);
    if (kind === 'cloth') return 96 + (c.folds++ % 32);
    if (kind === 'skin') return SKIN_ID0 + (c.skin++ % (96 - SKIN_ID0));
    return 1 + (c.regular++ % (SKIN_ID0 - 1));
  }

  /** Renders view normals + ids + depth of the content into set.gbuf. */
  _prepass(renderer, scene, camera, set, withGround) {
    const saved = this._saved;
    saved.length = 0;
    for (const m of this.content) { saved.push(m.material); m.material = this._prepassMaterialFor(m); }
    for (const m of this.grounds) { saved.push(m.material); m.material = this.groundPrepass; }
    if (!withGround) this._hide(this.grounds);
    this._hide(this.helpers);
    const grid = this.app.grid;
    const gridVis = grid.visible; grid.visible = false;
    const bg = scene.background; scene.background = null;

    try {
      renderer.setRenderTarget(set.gbuf);
      renderer.setClearColor(0x000000, 0); // id 0 = background (normals there are never read)
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
    } finally {
      // always give the meshes their real materials back, even if a shader failed
      scene.background = bg;
      grid.visible = gridVis;
      this._unhideAll();
      let i = 0;
      for (const m of this.content) m.material = saved[i++];
      for (const m of this.grounds) m.material = saved[i++];
      saved.length = 0;
    }
  }

  // -------------------------------------------------------------- AO
  _ensureGTAO(camera) {
    if (!this._gtao) {
      this._gtao = new GTAOPass(this.app.scene, camera, 16, 16, { depthTexture: this.screen.gbuf.depthTexture, normalTexture: this.screen.gbuf.texture });
      this._gtao.output = GTAOPass.OUTPUT.Off;
      this._gtaoSamples = -1;
    }
    const g = this._gtao;
    g.camera = camera;
    const persp = camera.isPerspectiveCamera ? 1 : 0;
    if (g.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== persp) { g.gtaoMaterial.defines.PERSPECTIVE_CAMERA = persp; g.gtaoMaterial.needsUpdate = true; }
    if (this._gtaoSamples !== this.opts.aoSamples) {
      this._gtaoSamples = this.opts.aoSamples;
      g.updateGtaoMaterial({ samples: this.opts.aoSamples, radius: this.opts.aoRadius, distanceExponent: 1.6, thickness: 0.22, scale: 1.0, distanceFallOff: 1.0 });
      g.updatePdMaterial({ samples: this.opts.aoSamples > 8 ? 16 : 8, rings: 2, radius: 6, lumaPhi: 10, depthPhi: 2, normalPhi: 3 });
    } else g.gtaoMaterial.uniforms.radius.value = this.opts.aoRadius;
    return g;
  }

  /** Runs GTAO + denoise on a G-buffer (at `scale` of its resolution); returns the AO texture. */
  _ao(renderer, camera, set, scale = this.opts.aoScale) {
    const g = this._ensureGTAO(camera);
    if (g.depthTexture !== set.gbuf.depthTexture) g.setGBuffer(set.gbuf.depthTexture, set.gbuf.texture);
    const w = Math.max(1, Math.round(set.w * scale)), h = Math.max(1, Math.round(set.h * scale));
    if (g.width !== w || g.height !== h) g.setSize(w, h);
    g.render(renderer, null, null);
    return g.gtaoMap;
  }

  /** AO upsampling uniforms (shared by the screen multiply pass and the capture output pass). */
  _aoUniforms(material, camera, set) {
    const u = material.uniforms, g = this._gtao;
    const ortho = camera.isOrthographicCamera ? 1 : 0;
    if (material.defines.PV_ORTHO !== ortho) { material.defines.PV_ORTHO = ortho; material.needsUpdate = true; }
    u.tAO.value = g.gtaoMap; u.tAODepth.value = set.gbuf.depthTexture;
    u.aoSize.value.set(g.width, g.height);
    u.aoNear.value = camera.near; u.aoFar.value = camera.far;
    u.tAOId.value = set.gbuf.texture; u.skinWarm.value = this.opts.skinWarm;
  }

  /** Multiplies the canvas by the AO of `set`. */
  _aoMultiply(renderer, camera, set) {
    this._aoUniforms(this.aoMulMat, camera, set);
    this.aoMulMat.uniforms.intensity.value = this.opts.aoIntensity;
    this._pass(renderer, this.aoMulMat, null);
  }

  // -------------------------------------------------------------- ink
  /** Radii (device px) of contour and crease lines for a density of pxScale device px per CSS px. */
  _inkRadii(pxScale) {
    const w = Math.max(1, this.opts.inkWidth * pxScale);
    const rS = Math.min(MAX_INK_RADIUS, w / 2);
    const rC = Math.min(MAX_INK_RADIUS, Math.max(0.5, w * 0.62 / 2));
    return { rS, rC };
  }

  /** Edge seeds + horizontal distances into set.edge / set.hdist. */
  _edges(renderer, camera, set, pxScale) {
    const o = this.opts, u = this.edgeMat.uniforms;
    const ortho = camera.isOrthographicCamera ? 1 : 0;
    if (this.edgeMat.defines.PV_ORTHO !== ortho) { this.edgeMat.defines.PV_ORTHO = ortho; this.edgeMat.needsUpdate = true; }
    u.tG.value = set.gbuf.texture; u.tDepth.value = set.gbuf.depthTexture;
    u.texel.value.set(1 / set.w, 1 / set.h);
    u.cameraNear.value = camera.near; u.cameraFar.value = camera.far;
    // crease slider 0..1 -> angle 75°..18° between neighbouring normals; 0 disables inner lines
    const angle = THREE.MathUtils.lerp(75, 18, o.crease) * THREE.MathUtils.DEG2RAD;
    u.creaseCos.value = o.crease > 0.001 ? Math.cos(angle) : -2;
    u.nStep.value = Math.max(1, Math.min(3, Math.round(pxScale)));
    // valley (fold) curvature threshold in 1/m, garments only (ids 96..127): 0..1 slider ->
    // fold radius ~1.4 cm .. 8 cm. Garment folds (wavelength 5.5-8 cm, depth 0.8-2.5 cm on a
    // ~1 cm mesh) peak around 40-60 1/m: the default 0.45 (~44 1/m) inks the clear ones.
    u.valleyK.value = o.crease > 0.001 ? THREE.MathUtils.lerp(70, 12, o.crease) : -1;
    // world size of one pixel (at distance 1 in perspective): from the projection matrix,
    // so zoom, view offsets (UI panel framing) and capture aspects are all accounted for
    u.pxWorld.value = 2 / camera.projectionMatrix.elements[5] / set.h;
    this._pass(renderer, this.edgeMat, set.edge);

    const { rS, rC } = this._inkRadii(pxScale);
    const hu = this.hdistMat.uniforms;
    hu.tEdge.value = set.edge.texture; hu.texel.value.set(1 / set.w, 1 / set.h); hu.radius.value = Math.max(rS, rC);
    this._pass(renderer, this.hdistMat, set.hdist);
  }

  _inkUniforms(u, set, pxScale) {
    const { rS, rC } = this._inkRadii(pxScale);
    u.tH.value = set.hdist.texture; u.texelH.value.set(1 / set.w, 1 / set.h);
    u.rS.value = rS; u.rC.value = rC; u.creaseAlpha.value = 1;
    srgbVec(this.opts.inkColor, u.inkColor.value);
    u.inkOpacity.value = this.opts.inkOpacity;
  }

  _pass(renderer, material, target) {
    renderer.setRenderTarget(target);
    this._quad.material = material;
    this._quad.render(renderer);
  }

  _bgUniforms() {
    const bg = this.opts.bg, u = this.bgMat.uniforms;
    if (bg.type === 'gradient') { srgbVec(bg.top, u.cTop.value); srgbVec(bg.bottom, u.cBottom.value); u.mode.value = 0; }
    else if (bg.type === 'transparent') u.mode.value = 1;
    else { srgbVec(bg.color, u.cTop.value); u.cBottom.value.copy(u.cTop.value); u.mode.value = 0; }
  }

  // -------------------------------------------------------------- screen frame
  /** app.renderOverride implementation. */
  render(renderer, scene, camera) {
    const state = this._saveState(renderer, scene);
    try { this._renderScreen(renderer, scene, camera, state); } finally {
      this._restoreGrounds();
      this._unhideAll();
      this._restoreState(renderer, scene, state);
    }
  }

  _renderScreen(renderer, scene, camera, state) {
    const o = this.opts;
    renderer.getDrawingBufferSize(_size);
    const set = this.screen;
    set.ensure(_size.x, _size.y);
    const pxScale = renderer.getPixelRatio();
    this._classify(scene);
    inkLinePx.value = 2 * this._inkRadii(pxScale).rC; // lines drawn by materials (ink eyes, anatomy)
    inkColorLinear.value.set(o.inkColor);

    // GTAO needs half-float targets: without color-buffer-float support AO is skipped
    const useAO = o.ao && o.aoMode !== 'off' && !this.suspendAO && this.floatTargets;
    const usePre = o.ink || useAO;
    const transparent = o.bg.type === 'transparent';
    renderer.autoClear = false;
    if (usePre) {
      // the G-buffer pass never draws shadow maps: a pending update runs in the colour pass
      const sm = renderer.shadowMap, pending = sm.needsUpdate;
      sm.autoUpdate = false; sm.needsUpdate = false;
      try {
        this._prepass(renderer, scene, camera, set, !transparent);
        if (useAO) this._ao(renderer, camera, set);
        if (o.ink) this._edges(renderer, camera, set, pxScale);
      } finally { sm.autoUpdate = state.shadowAuto; sm.needsUpdate = pending; }
    }

    // color: background + scene (helpers deferred above the ink)
    renderer.setRenderTarget(null);
    if (usePre) this._hide(this.helpers);
    if (o.bg.type === 'solid') {
      renderer.setClearColor(_color.set(o.bg.color), 1);
      scene.background = null;
      renderer.clear(true, true, true);
    } else {
      scene.background = null;
      renderer.clear(true, true, true);
      this._bgUniforms();
      this._pass(renderer, this.bgMat, null);
    }
    if (transparent) this._transparentGrounds(renderer); // preview exactly what a transparent PNG gets
    renderer.render(scene, camera);
    this._restoreGrounds();
    this._unhideAll();

    if (useAO) this._aoMultiply(renderer, camera, set);
    if (o.ink) {
      this._inkUniforms(this.inkMat.uniforms, set, pxScale);
      this._pass(renderer, this.inkMat, null);
    }
    if (usePre && this.helpers.length) this._renderHelpersOnly(renderer, scene, camera);
    this.stats.ao = useAO; this.stats.ink = o.ink;
  }

  /** Draws only the helper objects (gizmos…) over the finished frame, keeping the depth buffer. */
  _renderHelpersOnly(renderer, scene, camera) {
    this._hide(this.content); this._hide(this.grounds);
    const grid = this.app.grid;
    if (grid.visible) { grid.visible = false; this._hidden.push(grid); }
    const sm = renderer.shadowMap, auto = sm.autoUpdate, pending = sm.needsUpdate;
    sm.autoUpdate = false; sm.needsUpdate = false;
    try { renderer.render(scene, camera); } finally {
      sm.autoUpdate = auto; sm.needsUpdate = pending;
      this._unhideAll();
    }
  }

  _saveState(renderer, scene) {
    const s = this._state || (this._state = { clear: new THREE.Color() });
    renderer.getClearColor(s.clear);
    s.clearAlpha = renderer.getClearAlpha();
    s.autoClear = renderer.autoClear;
    s.shadowAuto = renderer.shadowMap.autoUpdate;
    s.background = scene.background;
    s.target = renderer.getRenderTarget();
    return s;
  }

  _restoreState(renderer, scene, s) {
    renderer.setClearColor(s.clear, s.clearAlpha);
    renderer.autoClear = s.autoClear;
    renderer.shadowMap.autoUpdate = s.shadowAuto;
    scene.background = s.background;
    renderer.setRenderTarget(s.target);
  }

  // -------------------------------------------------------------- capture
  /**
   * Renders the current view into an RGBA8 target of w x h px (synchronously).
   * Returns {target, dispose()} — read it back, then call dispose().
   * pxScale: output px per CSS px (keeps line widths proportional to the viewport).
   */
  renderCapture(renderer, scene, camera, opts) {
    const state = this._saveState(renderer, scene);
    const caps = renderer.capabilities;
    const set = new TargetSet(this.floatTargets);
    set.ensure(opts.w, opts.h);
    const hdrType = this.floatTargets ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const color = new THREE.WebGLRenderTarget(opts.w, opts.h, { type: hdrType, samples: Math.min(4, caps.maxSamples || 4), generateMipmaps: false });
    const out = new THREE.WebGLRenderTarget(opts.w, opts.h, { type: THREE.UnsignedByteType, generateMipmaps: false, depthBuffer: false });
    const dispose = () => { set.dispose(); color.dispose(); out.dispose(); };
    try {
      this._renderCapture(renderer, scene, camera, opts, state, set, color, out);
    } catch (e) {
      dispose();
      throw e;
    } finally {
      // AO / G-buffer passes were sized for the capture: point GTAO back at the screen set
      if (this._gtao && this._gtao.depthTexture !== this.screen.gbuf.depthTexture) this._gtao.setGBuffer(this.screen.gbuf.depthTexture, this.screen.gbuf.texture);
      this._restoreGrounds();
      this._unhideAll();
      this._restoreState(renderer, scene, state);
    }
    return { target: out, dispose };
  }

  _renderCapture(renderer, scene, camera, { w, h, pxScale, transparent, toneMapping, exposure }, state, set, color, out) {
    const o = this.opts;
    this._classify(scene);
    inkLinePx.value = 2 * this._inkRadii(pxScale).rC;
    inkColorLinear.value.set(o.inkColor);

    const useAO = o.ao && this.floatTargets;
    const usePre = o.ink || useAO;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false; // G-buffer passes never need shadow maps
    renderer.shadowMap.needsUpdate = false;
    if (usePre) {
      this._prepass(renderer, scene, camera, set, !transparent);
      // exports are not time critical: full-resolution AO (finer, cleaner contact shadows)
      if (useAO) this._ao(renderer, camera, set, Math.min(1, 4096 / Math.max(w, h)));
      if (o.ink) this._edges(renderer, camera, set, pxScale);
    }

    // color pass: transparent clear; background is composited by the output pass
    this._hide(this.helpers);
    for (const hlp of this.helpers) if (hlp.userData.export === true) hlp.visible = true;
    if (transparent) this._transparentGrounds(renderer);
    scene.background = null;
    // exports always get freshly drawn shadow maps (maps are cached between screen frames,
    // and capture-only changes such as full building detail must cast)
    renderer.shadowMap.autoUpdate = state.shadowAuto;
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(color);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    this._restoreGrounds();
    this._unhideAll();

    // output pass
    const u = this.outMat.uniforms;
    setOutputToneMapping(this.outMat, toneMapping);
    u.toneMappingExposure.value = exposure;
    u.tColor.value = color.texture;
    u.useAO.value = useAO ? 1 : 0;
    if (useAO) { this._aoUniforms(this.outMat, camera, set); u.aoIntensity.value = o.aoIntensity; }
    u.useInk.value = o.ink ? 1 : 0;
    if (o.ink) this._inkUniforms(u, set, pxScale);
    const bg = o.bg;
    if (transparent) u.bgMode.value = 0;
    else {
      u.bgMode.value = 1;
      if (bg.type === 'gradient') { srgbVec(bg.top, u.bgTop.value); srgbVec(bg.bottom, u.bgBottom.value); }
      else { srgbVec(bg.type === 'solid' ? bg.color : '#ffffff', u.bgTop.value); u.bgBottom.value.copy(u.bgTop.value); }
    }
    this._pass(renderer, this.outMat, out);
  }
}
