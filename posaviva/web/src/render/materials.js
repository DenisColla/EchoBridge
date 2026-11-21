// Central material library with switchable render styles.
//
//   materials.apply(mesh, spec | spec[])   assign (and track) materials for a mesh
//   materials.release(mesh)                stop tracking
//   materials.setStyle('realistic'|'clay'|'toon'|'lines')
//   materials.setTexture(name, texture)    shared textures: 'eye', 'skinDetail'
//
// spec = { kind, color, ...opts }. kinds: skin, eye, lashes, teeth, tongue,
// cloth, hair, prop, ground. Optional opts (honored by every style where they
// make sense): map, normalMap, normalScale, roughness, metalness, sheen, side,
// transparent, opacity, alphaTest, vertexColors.
// Materials are cached per (style, spec): identical specs share one material.
//
// The render module (render/index.js) owns everything that is not a material
// (tone mapping, environment, outlines, AO, background); materials only know
// how a surface should shade in each style.
import * as THREE from 'three';

export const STYLES = [
  { id: 'realistic', label: 'Realistico' },
  { id: 'clay', label: 'Manichino' },
  { id: 'toon', label: 'Fumetto' },
  { id: 'lines', label: 'Linee' },
];

const texId = (t) => (t ? t.uuid : null);

/** 1-row gradient texture for MeshToonMaterial (NearestFilter = hard bands). */
function makeGradient(texels) {
  const data = new Uint8Array(texels.length * 4);
  texels.forEach((c, i) => {
    const [r, g, b] = Array.isArray(c) ? c : [c, c, c];
    data.set([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255], i * 4);
  });
  const tex = new THREE.DataTexture(data, texels.length, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Neutral artist-mannequin palette (sRGB).
const CLAY = { skin: '#aca59c', eye: '#cfcac3', lashes: '#5f5a55', teeth: '#d6d1ca', tongue: '#9a8f88', cloth: '#8f9499', hair: '#77726d', prop: '#a19b93', ground: '#96938e' };

const SIDES = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide };
const sideOf = (s, fallback = THREE.FrontSide) => (s === undefined || s === null ? fallback : typeof s === 'string' ? SIDES[s] ?? fallback : s);
const colorOf = (c, fallback = '#cccccc') => (c && c.isColor ? c.clone() : new THREE.Color(c ?? fallback));

function vec2Of(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return new THREE.Vector2(v, v);
  if (Array.isArray(v)) return new THREE.Vector2(v[0], v[1] ?? v[0]);
  if (v.isVector2) return v.clone();
  if (typeof v === 'object' && 'x' in v) return new THREE.Vector2(v.x, v.y ?? v.x);
  return undefined;
}

/** Options every material accepts (side / transparency / alpha test / vertex colors). */
function common(s, { side, colors = true } = {}) {
  const o = { side: sideOf(s.side, side) };
  if (s.transparent) o.transparent = true;
  if (s.opacity !== undefined) o.opacity = s.opacity;
  if (s.alphaTest) o.alphaTest = s.alphaTest;
  // the shared eye texture has a fully transparent cornea shell (alpha 0) over the iris
  else if (s.kind === 'eye') o.alphaTest = 0.5;
  if (colors && s.vertexColors) o.vertexColors = true;
  return o;
}

/** normalMap + normalScale if present. */
function normals(s) {
  if (!s.normalMap) return {};
  const o = { normalMap: s.normalMap };
  const ns = vec2Of(s.normalScale);
  if (ns) o.normalScale = ns;
  return o;
}

// ---------------------------------------------------------------- shader hooks
// Small, cached shader patches applied with onBeforeCompile. Each hook has a
// stable program cache key so all materials using it share one GPU program;
// per-material values live in uniforms created inside the hook.
const _warned = new Set();
function patch(src, find, repl, tag) {
  if (!src.includes(find)) {
    if (!_warned.has(tag)) { _warned.add(tag); console.warn(`[render] shader patch "${tag}" not applied (three.js chunk changed?)`); }
    return src;
  }
  return src.replace(find, repl);
}

/**
 * Wrapped diffuse for direct lights (cheap subsurface approximation): light
 * "bleeds" past the terminator per channel (red the most), producing the soft,
 * warm terminator typical of skin. wrap = per-channel wrap amount (0 = Lambert).
 */
function wrapDiffuseHook(material, wrap, key) {
  const uWrap = { value: new THREE.Vector3(...wrap) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pvWrap = uWrap;
    const chunk = patch(THREE.ShaderChunk.lights_physical_pars_fragment,
      'reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );',
      `{
        float pvNdl = dot( geometryNormal, directLight.direction );
        vec3 pvW = clamp( ( vec3( pvNdl ) + pvWrap ) / ( 1.0 + pvWrap ), 0.0, 1.0 );
        reflectedLight.directDiffuse += pvW * directLight.color * diffuseBRDF * ( 1.0 - F );
      }`, 'wrap-diffuse');
    shader.fragmentShader = 'uniform vec3 pvWrap;\n' + shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', chunk);
  };
  material.customProgramCacheKey = () => key;
  material.userData.wrap = uWrap;
  return material;
}

/**
 * Eye texture remap. The shared eye texture has a red-brown iris; the iris is
 * isolated by its saturation and re-tinted with the spec color.
 * mode 0: realistic tint, 1: neutral clay (grey iris, dark pupil), 2: ink (white
 * sclera, thin iris ring, black pupil) so the gaze stays readable in every style.
 */
function eyeHook(material, irisColor, mode) {
  const uIris = { value: colorOf(irisColor, '#5b3a21') };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pvIris = uIris;
    shader.fragmentShader = 'uniform vec3 pvIris;\n' + patch(shader.fragmentShader, '#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 pvTex = texture2D( map, vMapUv );
        vec3 pvS = pow( max( pvTex.rgb, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) ); // ~sRGB for thresholds
        float pvLum = dot( pvS, vec3( 0.299, 0.587, 0.114 ) );
        // measured on the shared texture: sclera lum ~0.6, iris lum 0.06-0.21 (red 0.2-0.35), pupil red ~0
        float pvIrisM = 1.0 - smoothstep( 0.30, 0.48, pvLum );   // iris + limbal ring + pupil
        float pvPupil = 1.0 - smoothstep( 0.025, 0.07, pvS.r ); // pure black disc only (round pupil)
        #if PV_EYE_MODE == 0
          // keep the fibrous detail (relative to the mean iris red) but take the hue from the spec
          vec3 pvTint = pvIris * clamp( pvTex.r / 0.066, 0.25, 2.4 );
          pvTex.rgb = mix( pvTex.rgb, pvTint, pvIrisM * ( 1.0 - pvPupil ) );
        #elif PV_EYE_MODE == 1
          float pvG = mix( 0.78, mix( 0.40, 0.08, pvPupil ), pvIrisM );
          pvTex.rgb = vec3( pvG * pvG );
        #else
          float pvFw = max( fwidth( pvIrisM ), 1e-3 );
          float pvRing = 1.0 - smoothstep( 0.0, 1.6 * pvFw, abs( pvIrisM - 0.5 ) - 0.22 );
          float pvV = 1.0 - max( pvPupil, pvRing );
          pvTex.rgb = vec3( pvV );
        #endif
        diffuseColor *= pvTex;
      #endif`, 'eye-map');
  };
  material.defines = { ...(material.defines || {}), PV_EYE_MODE: mode };
  material.customProgramCacheKey = () => 'pv-eye-' + mode;
  return material;
}

/** Use the map only for its alpha (cut-out hair cards etc. in clay / lines styles). */
function mapAlphaOnlyHook(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = patch(shader.fragmentShader, '#include <map_fragment>',
      '#ifdef USE_MAP\n diffuseColor.a *= texture2D( map, vMapUv ).a;\n#endif', 'map-alpha');
  };
  material.customProgramCacheKey = () => 'pv-map-alpha';
  return material;
}

/** Toon: read the RGB of the gradient map (default reads .r) to allow tinted shadow bands. */
function toonColorBandsHook(material) {
  material.onBeforeCompile = (shader) => {
    const chunk = patch(THREE.ShaderChunk.gradientmap_pars_fragment, 'texture2D( gradientMap, coord ).r', 'texture2D( gradientMap, coord ).rgb', 'toon-bands');
    shader.fragmentShader = shader.fragmentShader.replace('#include <gradientmap_pars_fragment>', chunk);
  };
  material.customProgramCacheKey = () => 'pv-toon-rgb';
  return material;
}

// ---------------------------------------------------------------- library
class MaterialLibrary extends THREE.EventDispatcher {
  constructor() {
    super();
    this.style = 'realistic';
    /** mesh -> spec | spec[] */
    this.tracked = new Map();
    this.cache = new Map();
    // toon bands: dotNL in [-1,-.5) [-.5,0) [0,.5) [.5,1]  -> shadow, shadow, mid, lit
    this.gradient = makeGradient([0.36, 0.36, 0.68, 1.0]);
    // skin bands with warm, slightly saturated shadows (classic comic shading)
    this.skinGradient = makeGradient([[0.50, 0.34, 0.32], [0.50, 0.34, 0.32], [0.84, 0.70, 0.66], [1, 1, 1]]);
    this.textures = {};
    /** extra per-style factories (fn(spec) -> Material, `this` = library) may be registered by modules */
    this.factories = {};
  }

  setTexture(name, tex) {
    if (this.textures[name] === tex) return;
    this.textures[name] = tex;
    // drop materials that may embed the old texture; rebuild lazily
    const old = this.cache;
    this.cache = new Map();
    this.refreshAll();
    this._disposeUnused(old);
  }

  apply(mesh, spec) {
    this.tracked.set(mesh, spec);
    mesh.material = this._resolve(spec);
    if (this.cache.size > 320) this._sweep();
    return mesh.material;
  }

  release(mesh) { this.tracked.delete(mesh); }

  /** true if the object is a library-managed (character / garment / hair / prop / ground) mesh */
  isTracked(obj) { return this.tracked.has(obj); }

  /** kind of a tracked mesh (first spec for multi-material meshes) */
  kindOf(obj) {
    const s = this.tracked.get(obj);
    return s ? (Array.isArray(s) ? s[0]?.kind : s.kind) : null;
  }

  setStyle(style) {
    if (style === this.style || !STYLES.some((s) => s.id === style)) return;
    this.style = style;
    this.refreshAll();
    this.dispatchEvent({ type: 'style', style });
  }

  refreshAll() {
    for (const [mesh, spec] of this.tracked) mesh.material = this._resolve(spec);
    this.dispatchEvent({ type: 'refresh' });
  }

  _resolve(spec) { return Array.isArray(spec) ? spec.map((s) => this._get(s)) : this._get(spec); }

  _key(s) {
    const o = {};
    for (const [k, v] of Object.entries(s)) o[k] = v && v.isTexture ? texId(v) : v;
    return this.style + '|' + JSON.stringify(o);
  }

  _get(spec) {
    const key = this._key(spec);
    let m = this.cache.get(key);
    if (!m) {
      const f = this.factories[this.style] || defaultFactories[this.style];
      m = f.call(this, spec);
      m.userData.kind = spec.kind;
      // wrinkle normal maps also drive the ink outlines, even in styles that do not shade with them
      if (spec.normalMap) { m.userData.pvNormalMap = spec.normalMap; m.userData.pvNormalScale = vec2Of(spec.normalScale) || new THREE.Vector2(1, 1); }
      m.name = `pv:${this.style}:${spec.kind}`;
      this.cache.set(key, m);
    }
    return m;
  }

  /** Dispose cached materials no tracked mesh uses any more (bounded cache under color pickers). */
  _sweep() {
    const used = this._usedSet();
    for (const [k, m] of this.cache) if (!used.has(m)) { m.dispose(); this.cache.delete(k); }
  }

  _disposeUnused(oldCache) {
    const used = this._usedSet();
    for (const m of oldCache.values()) if (!used.has(m)) m.dispose();
  }

  _usedSet() {
    const used = new Set();
    for (const mesh of this.tracked.keys()) {
      const mm = mesh.material;
      if (Array.isArray(mm)) mm.forEach((x) => used.add(x)); else if (mm) used.add(mm);
    }
    return used;
  }
}

// ---------------------------------------------------------------- style factories
const defaultFactories = {
  /** Flattering PBR: wrapped-diffuse skin with warm sheen, fabric sheen, glossy eyes. */
  realistic(s) {
    const color = colorOf(s.color);
    const c = common(s);
    switch (s.kind) {
      case 'skin': {
        const m = new THREE.MeshPhysicalMaterial({
          ...c, color, map: s.map || this.textures.skinDetail || null, ...normals(s),
          roughness: s.roughness ?? 0.48, metalness: 0, specularIntensity: 0.6,
          sheen: s.sheen ?? 0.22, sheenRoughness: 0.42, sheenColor: new THREE.Color('#ffb39a'),
        });
        return wrapDiffuseHook(m, [0.40, 0.21, 0.15], 'pv-wrap-skin');
      }
      case 'eye': {
        const m = new THREE.MeshPhysicalMaterial({
          ...c, map: s.map || this.textures.eye || null, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04,
        });
        return eyeHook(m, s.color, 0);
      }
      case 'lashes':
        return new THREE.MeshStandardMaterial({ ...c, side: sideOf(s.side, THREE.DoubleSide), color, map: s.map || null, roughness: 0.9 });
      case 'teeth':
        return new THREE.MeshStandardMaterial({ ...c, color, map: s.map || null, roughness: 0.32 });
      case 'tongue':
        return new THREE.MeshPhysicalMaterial({ ...c, color, map: s.map || null, roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.3 });
      case 'cloth': {
        const m = new THREE.MeshPhysicalMaterial({
          ...c, color, map: s.map || null, ...normals(s),
          roughness: s.roughness ?? 0.82, metalness: s.metalness ?? 0,
          sheen: s.sheen ?? 0.55, sheenRoughness: 0.7, sheenColor: color.clone().lerp(new THREE.Color('#ffffff'), 0.3),
          specularIntensity: 0.5,
        });
        return wrapDiffuseHook(m, [0.14, 0.14, 0.14], 'pv-wrap-soft');
      }
      case 'hair': {
        const m = new THREE.MeshPhysicalMaterial({
          ...c, color, map: s.map || null, ...normals(s),
          roughness: s.roughness ?? 0.42, metalness: s.metalness ?? 0, specularIntensity: 0.8,
          sheen: s.sheen ?? 0.9, sheenRoughness: 0.32, sheenColor: color.clone().lerp(new THREE.Color('#fff6e8'), 0.55),
        });
        return wrapDiffuseHook(m, [0.22, 0.22, 0.22], 'pv-wrap-hair');
      }
      case 'ground':
        return new THREE.MeshStandardMaterial({ ...c, color, map: s.map || null, ...normals(s), roughness: s.roughness ?? 0.95, metalness: s.metalness ?? 0 });
      default: { // prop & unknown kinds (upholstery etc. may ask for sheen)
        const o = { ...c, color, map: s.map || null, ...normals(s), roughness: s.roughness ?? 0.7, metalness: s.metalness ?? 0 };
        return s.sheen ? new THREE.MeshPhysicalMaterial({ ...o, sheen: s.sheen, sheenRoughness: 0.7, sheenColor: color.clone().lerp(new THREE.Color('#ffffff'), 0.3) }) : new THREE.MeshStandardMaterial(o);
      }
    }
  },

  /** Neutral matte mannequin. Normal maps kept (wrinkles!), color maps used only for cut-out alpha. */
  clay(s) {
    const color = colorOf(CLAY[s.kind] || '#b5b0a8');
    if (s.kind === 'cloth' || s.kind === 'hair' || s.kind === 'prop') color.lerp(colorOf(s.color, '#999999'), s.kind === 'hair' ? 0.3 : 0.26);
    const c = common(s, { colors: false });
    if (s.kind === 'eye') return eyeHook(new THREE.MeshStandardMaterial({ ...c, map: s.map || this.textures.eye || null, roughness: 0.35 }), s.color, 1);
    const cut = !!(s.map && (s.alphaTest || s.transparent));
    const m = new THREE.MeshStandardMaterial({
      ...c, color, ...normals(s), map: cut ? s.map : null,
      roughness: 0.88, metalness: 0, side: sideOf(s.side, s.kind === 'lashes' ? THREE.DoubleSide : THREE.FrontSide),
    });
    return cut ? mapAlphaOnlyHook(m) : m;
  },

  /** Cel shading (hard bands, warm skin shadows). Ink lines come from the outline pass. */
  toon(s) {
    const color = colorOf(s.color);
    const c = common(s);
    if (s.kind === 'eye') return eyeHook(new THREE.MeshToonMaterial({ ...c, map: s.map || this.textures.eye || null, gradientMap: this.gradient }), s.color, 0);
    if (s.kind === 'skin') return toonColorBandsHook(new THREE.MeshToonMaterial({ ...c, color, gradientMap: this.skinGradient, ...normals(s) }));
    return new THREE.MeshToonMaterial({
      ...c, color, gradientMap: this.gradient, ...normals(s),
      map: s.map || null, // garment prints, hair cards, prop textures
      side: sideOf(s.side, s.kind === 'lashes' ? THREE.DoubleSide : THREE.FrontSide),
    });
  },

  /** Pure line art: white surfaces, ink from the outline pass; dark lashes / pupils stay readable. */
  lines(s) {
    const c = common(s, { colors: false });
    if (s.kind === 'eye') {
      const m = new THREE.MeshBasicMaterial({ ...c, map: s.map || this.textures.eye || null });
      m.toneMapped = false;
      return eyeHook(m, s.color, 2);
    }
    const col = s.kind === 'lashes' ? '#1d1d1d' : '#ffffff';
    const cut = !!(s.map && (s.alphaTest || s.transparent));
    const m = new THREE.MeshBasicMaterial({ ...c, color: new THREE.Color(col), map: cut ? s.map : null, side: sideOf(s.side, s.kind === 'lashes' ? THREE.DoubleSide : THREE.FrontSide) });
    m.toneMapped = false;
    return cut ? mapAlphaOnlyHook(m) : m;
  },
};

export const materials = new MaterialLibrary();
