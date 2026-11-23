// Central material library with switchable render styles.
//
//   materials.apply(mesh, spec | spec[])   assign (and track) materials for a mesh
//   materials.release(mesh)                stop tracking
//   materials.setStyle('realistic'|'clay'|'toon'|'lines')
//   materials.setTexture(name, texture)    shared textures: 'eye', 'skinDetail'
//
// spec = { kind, color, ...opts }. kinds: skin, eye, lashes, brows, teeth,
// tongue, cloth, hair, prop, ground ('lashes' and 'brows' are fine hair strokes:
// shaded, but never outlined by the ink pass). Optional opts (honored by every style where they
// make sense): map, normalMap, normalScale, roughness, metalness, sheen, side,
// transparent, opacity, alphaTest, vertexColors.
// Materials are cached per (style, spec): identical specs share one material.
//
// The render module (render/index.js) owns everything that is not a material
// (tone mapping, environment, outlines, AO, background); materials only know
// how a surface should shade in each style.
import * as THREE from 'three';
import { softSkin, injectSoftSkin } from './softskin.js';
import { anatomyTexture } from './anatomy.js';

export { softSkin };

export const STYLES = [
  { id: 'realistic', label: 'Realistico' },
  { id: 'clay', label: 'Manichino' },
  { id: 'toon', label: 'Fumetto' },
  { id: 'lines', label: 'Linee' },
];

const texId = (t) => (t ? t.uuid : null);

/**
 * Keeps a texture within the quality preset's size cap (render/device.js texMax).
 * three.js already scales HTMLImageElement / canvas images down at upload when they
 * exceed renderer.capabilities.maxTextureSize (set to the cap by the render module),
 * but for an ImageBitmap (glTF textures) it skips the UNPACK_FLIP_Y / premultiply
 * state of the scaled copy, so those are converted here to a canvas of the capped
 * size once (same orientation: glTF textures have flipY = false). cap 0 = no cap.
 */
export function fitTextureToCap(tex, cap) {
  // a higher cap later: give back the full-size original
  const full = tex?.userData?.pvFullImage;
  if (full && (!cap || (full.width <= cap && full.height <= cap))) {
    tex.image = full;
    delete tex.userData.pvFullImage;
    tex.dispose();
    tex.needsUpdate = true;
    return true;
  }
  const im = full || tex?.image;
  if (!cap || !im || typeof ImageBitmap === 'undefined' || !(im instanceof ImageBitmap)) return false;
  if (im.width <= cap && im.height <= cap) return false;
  if (tex.image !== im && tex.image?.width === Math.floor(im.width * (cap / Math.max(im.width, im.height)))) return false;
  const k = cap / Math.max(im.width, im.height);
  const w = Math.max(1, Math.floor(im.width * k)), h = Math.max(1, Math.floor(im.height * k));
  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(im, 0, 0, w, h);
    tex.userData.pvFullImage = im;
    tex.image = c;
    tex.dispose(); // a smaller image needs new GPU storage (immutable texStorage2D)
    tex.needsUpdate = true;
    return true;
  } catch { return false; }
}

// Neutral artist-mannequin palette (sRGB).
const CLAY = { skin: '#aca59c', eye: '#cfcac3', lashes: '#5f5a55', brows: '#77726d', teeth: '#d6d1ca', tongue: '#9a8f88', cloth: '#8f9499', hair: '#77726d', prop: '#a19b93', ground: '#96938e' };

/** Brightness factor of the tongue (inside the mouth cavity, which AO alone does not darken enough). */
const MOUTH_CAVITY = 0.42;

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
// Small, cached shader patches applied with onBeforeCompile. Hooks compose
// (a toon eye gets both the eye remap and the cel shading); the program cache
// key is the list of hook keys, so all materials using the same hooks share
// one GPU program; per-material values live in uniforms created by each hook.
const _warned = new Set();
function patch(src, find, repl, tag) {
  if (!src.includes(find)) {
    if (!_warned.has(tag)) { _warned.add(tag); console.warn(`[render] shader patch "${tag}" not applied (three.js chunk changed?)`); }
    return src;
  }
  return src.replace(find, repl);
}

const _hooks = new WeakMap();
/** Adds an onBeforeCompile patch to a material (several hooks run in order). */
function addHook(material, key, fn) {
  let list = _hooks.get(material);
  if (!list) {
    list = [];
    _hooks.set(material, list);
    material.onBeforeCompile = (shader, renderer) => { for (const hk of list) hk.fn(shader, renderer); };
  }
  list.push({ key, fn });
  const k = list.map((hk) => hk.key).join('+');
  material.customProgramCacheKey = () => k;
  return material;
}

/**
 * Line width (device px) of the lines drawn by materials themselves (iris ring
 * of the 'lines' eyes). Owned by the render pipeline: it sets it to the inner
 * ink line width before each screen frame / capture so both match.
 */
export const inkLinePx = { value: 2 };
/** Ink colour (linear RGB) of the lines drawn by materials (anatomical creases); set by the pipeline. */
export const inkColorLinear = { value: new THREE.Color(0x141414) };
/**
 * Anatomical crease lines drawn by the skin in the toon / lines styles:
 * x = strength threshold of a groove (> 1: off), y = opacity. Set by the render module.
 */
export const anatomyLines = { value: new THREE.Vector2(2, 1) };

/**
 * Wrapped diffuse for direct lights (cheap subsurface approximation): light
 * "bleeds" past the terminator per channel (red the most), producing the soft,
 * warm terminator typical of skin. wrap = per-channel wrap amount (0 = Lambert).
 */
function wrapDiffuseHook(material, wrap, key) {
  const uWrap = { value: new THREE.Vector3(...wrap) };
  addHook(material, key, (shader) => {
    shader.uniforms.pvWrap = uWrap;
    const chunk = patch(THREE.ShaderChunk.lights_physical_pars_fragment,
      'reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );',
      `{
        float pvNdl = dot( geometryNormal, directLight.direction );
        vec3 pvW = clamp( ( vec3( pvNdl ) + pvWrap ) / ( 1.0 + pvWrap ), 0.0, 1.0 );
        reflectedLight.directDiffuse += pvW * directLight.color * diffuseBRDF * ( 1.0 - F );
      }`, 'wrap-diffuse');
    shader.fragmentShader = 'uniform vec3 pvWrap;\n' + shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', chunk);
  });
  material.userData.wrap = uWrap;
  return material;
}

// ---------------------------------------------------------------- cloth (garments)
// Garment specs (clothing/manager.js) may carry, besides map / normalMap:
//   fabricMap  mid-scale fabric character (uv0): R tone, G roughness, BA relief normal xy
//   fabricK    [uv scale of fabricMap relative to the weave uv, tone, roughness, relief]
//   weaveTone  diffuse strength of the weave map's alpha (yarn tops / gaps)
//   map        garment detail atlas (uv1, no colour space): R tone (x255/128),
//              G thread paint, B relief height (128 = flat), see clothing/fabrics.js
//   relief     relief height (m) of a full B step (bump mapped)
//   thread     thread / paint colour
//   hem, hemTop [d1, d2, width, stitch] stitch lines at d1 and d2 (m, 0 = none) from
//              the garment edges (attribute pvEdge: distance, 1 at a top edge)
//   cavity     [diffuse, specular] darkening of the fold valleys (attribute pvCav)
// The style decides what is used: realistic everything, clay the relief only (no
// colour), toon colour + thread + cavity as cel shadow (no relief), lines nothing.
const CLOTH_VERT_PARS = /* glsl */`
  attribute vec2 pvEdge;
  attribute float pvCav;
  varying vec2 vPvEdge;
  varying vec2 vPvUv0;
  varying float vPvCav;
`;
const CLOTH_FRAG_PARS = /* glsl */`
  varying vec2 vPvEdge;
  varying vec2 vPvUv0;
  varying float vPvCav;
  uniform vec4 pvClothK;   // x weave tone, y relief (m), z cavity diffuse, w cavity specular
  uniform vec2 pvClothUse; // x colour (tone + thread), y relief
  uniform vec3 pvThread;
  uniform vec4 pvHem, pvHemTop;
  #ifdef PV_FAB
    uniform sampler2D pvFab;
    uniform vec4 pvFabK;
  #endif
  // box-filtered coverage of the band [-w/2, w/2] by a pixel of footprint fw centred at x
  float pvBox( float x, float w, float fw ) {
    return clamp( ( min( x + 0.5 * fw, 0.5 * w ) - max( x - 0.5 * fw, -0.5 * w ) ) / fw, 0.0, 1.0 );
  }
  // stitch lines at d.x and d.y (m) from the garment edge e: dashed thread, averaged when
  // sub-pixel. fw, fu: screen derivatives of e and of the arc length (taken in uniform flow)
  float pvStitch( vec4 d, float e, float fw, float fu ) {
    float c = 0.0;
    if ( d.x > 0.0 ) c = max( c, pvBox( e - d.x, d.z, fw ) );
    if ( d.y > 0.0 ) c = max( c, pvBox( e - d.y, d.z, fw ) );
    float t = vPvUv0.x / d.w, ft = fu / d.w;
    float dash = smoothstep( 0.0, 0.12 + ft, fract( t ) ) * ( 1.0 - smoothstep( 0.66 - ft, 0.78 + ft, fract( t ) ) );
    return c * mix( dash, 0.62, smoothstep( 0.25, 0.8, ft ) );
  }
  // bump mapping from a height in metres, screen-space derivatives (no tangents needed)
  vec3 pvPerturb( vec3 p, vec3 n, vec2 dH, float fd ) {
    vec3 sx = dFdx( p ), sy = dFdy( p );
    vec3 r1 = cross( sy, n ), r2 = cross( n, sx );
    float det = dot( sx, r1 ) * fd;
    vec3 g = sign( det ) * ( dH.x * r1 + dH.y * r2 );
    return normalize( abs( det ) * n - g );
  }
`;
const CLOTH_MAP = /* glsl */`
  float pvPaintA = 0.0;
  #ifdef USE_MAP
    vec4 pvD = texture2D( map, vMapUv );
    diffuseColor.rgb *= mix( 1.0, pvD.r * ( 255.0 / 128.0 ), pvClothUse.x );
    pvPaintA = pvD.g;
  #endif
  #ifdef PV_FAB
    vec4 pvF = texture2D( pvFab, vNormalMapUv * pvFabK.x );
    // the weave texel, fetched once: its alpha (weave tone) here, xyz in normal_fragment_maps
    vec4 pvNm = texture2D( normalMap, vNormalMapUv );
    diffuseColor.rgb *= 1.0 + ( pvF.r - 0.5 ) * 2.0 * pvFabK.y * pvClothUse.x;
    diffuseColor.rgb *= 1.0 + ( pvNm.a - 0.5 ) * 2.0 * pvClothK.x * pvClothUse.x;
  #endif
  {
    float pvFw = max( fwidth( vPvEdge.x ), 1e-5 ), pvFu = fwidth( vPvUv0.x );
    float pvS = pvStitch( vPvEdge.y > 0.5 ? pvHemTop : pvHem, vPvEdge.x, pvFw, pvFu );
    diffuseColor.rgb *= 1.0 - 0.12 * pvS * pvClothUse.x;
    pvPaintA = max( pvPaintA, pvS );
  }
  diffuseColor.rgb = mix( diffuseColor.rgb, pvThread, pvPaintA * pvClothUse.x );
`;
const CLOTH_NORMAL = /* glsl */`
  #ifdef PV_FAB
    mapN.xy += ( pvF.ba * 2.0 - 1.0 ) * pvFabK.w;
  #endif
  normal = normalize( tbn * mapN );
`;
const CLOTH_RELIEF = /* glsl */`
  #ifdef USE_MAP
  if ( pvClothUse.y > 0.0 ) {
    vec2 pvDx = dFdx( vMapUv ), pvDy = dFdy( vMapUv );
    float pvH0 = pvD.b; // the detail texel of map_fragment (CLOTH_MAP)
    vec2 pvDH = vec2( texture2D( map, vMapUv + pvDx ).b - pvH0, texture2D( map, vMapUv + pvDy ).b - pvH0 ) * pvClothK.y * pvClothUse.y;
    normal = pvPerturb( - vViewPosition, normal, pvDH, faceDirection );
  }
  #endif
`;
const CLOTH_CAVITY = /* glsl */`
  {
    float pvC = vPvCav * pvClothK.z, pvCs = vPvCav * pvClothK.w;
    reflectedLight.directDiffuse *= 1.0 - pvC;
    reflectedLight.indirectDiffuse *= 1.0 - pvC;
    reflectedLight.directSpecular *= 1.0 - pvCs;
    reflectedLight.indirectSpecular *= 1.0 - pvCs;
    #ifdef USE_SHEEN
      sheenSpecularDirect *= 1.0 - pvCs;
      sheenSpecularIndirect *= 1.0 - pvCs;
    #endif
  }
`;
/** Style use of the cloth features: [colour (tone, thread, stitches), relief, cavity]. */
const CLOTH_USE = { realistic: [1, 1, 1], clay: [0, 1, 1], toon: [1, 0, 1], lines: [0, 0, 0] };
/** Cavity strength in the toon style: fold valleys fall into the darker cel band. */
const TOON_CAV = 0.55;

/** Is this a garment spec with fabric features? */
const isCloth = (s) => s.kind === 'cloth' && !!(s.map || s.fabricMap || s.hem || s.cavity);

/**
 * Fabric shading of a garment material (see the spec fields above): detail atlas
 * tone + thread, weave tone, fabric character (tone, roughness, relief), relief
 * bump of seams and pockets, stitched hems along the real edges, fold cavity.
 */
function clothHook(material, s, style) {
  const use = CLOTH_USE[style] || CLOTH_USE.realistic;
  const fab = s.fabricMap && material.normalMap ? s.fabricMap : null;
  const cav = s.cavity || [0, 0];
  const u = {
    pvClothK: { value: new THREE.Vector4(s.weaveTone || 0, (s.relief || 0) * 2, cav[0] * use[2], cav[1] * use[2]) },
    pvClothUse: { value: new THREE.Vector2(use[0], material.map ? use[1] : 0) },
    pvThread: { value: colorOf(s.thread, '#808080') },
    pvHem: { value: new THREE.Vector4(...(s.hem || [0, 0, 0.001, 0.004])) },
    pvHemTop: { value: new THREE.Vector4(...(s.hemTop || s.hem || [0, 0, 0.001, 0.004])) },
  };
  if (fab) { u.pvFab = { value: fab }; u.pvFabK = { value: new THREE.Vector4(...(s.fabricK || [0.2, 0, 0, 0])) }; }
  if (fab) material.defines = { ...(material.defines || {}), PV_FAB: '' };
  if (style === 'toon') { material.defines = { ...(material.defines || {}), PV_TOON_CAV: '' }; u.pvToonCavK = { value: TOON_CAV * cav[0] > 0 ? TOON_CAV : 0 }; }
  return addHook(material, 'pv-cloth', (shader) => {
    Object.assign(shader.uniforms, u);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = CLOTH_VERT_PARS + patch(vs, '#include <begin_vertex>', '#include <begin_vertex>\n vPvEdge = pvEdge; vPvCav = pvCav; vPvUv0 = uv;', 'cloth-vert');
    fs = CLOTH_FRAG_PARS + (style === 'toon' ? 'uniform float pvToonCavK;\n' : '') + fs;
    fs = patch(fs, '#include <map_fragment>', CLOTH_MAP, 'cloth-map');
    if (fab) fs = patch(fs, '#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = clamp( roughnessFactor + ( pvF.g - 0.5 ) * 2.0 * pvFabK.z, 0.04, 1.0 );', 'cloth-rough');
    if (use[1]) fs = patch(fs, '#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + CLOTH_RELIEF, 'cloth-relief');
    if (fab) {
      let nm = patch(THREE.ShaderChunk.normal_fragment_maps, 'normal = normalize( tbn * mapN );', CLOTH_NORMAL, 'cloth-normal-chunk');
      nm = patch(nm, 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = pvNm.xyz * 2.0 - 1.0;', 'cloth-normal-fetch');
      fs = patch(fs, '#include <normal_fragment_maps>', nm, 'cloth-normal');
    }
    if (use[2] && style !== 'toon') fs = patch(fs, '#include <aomap_fragment>', CLOTH_CAVITY + '#include <aomap_fragment>', 'cloth-cavity');
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  });
}

/** Physical cloth BRDF of a garment spec: low, broad specular; sheen at grazing angles for knits and wool. */
function clothPhysical(s, c, color) {
  const o = {
    ...c, color, map: s.map || null, ...normals(s),
    roughness: s.roughness ?? 0.82, metalness: s.metalness ?? 0,
    sheen: s.sheen ?? 0.55, sheenRoughness: s.sheenRough ?? 0.7,
    sheenColor: color.clone().lerp(new THREE.Color('#ffffff'), s.sheenTint ?? 0.3),
    specularIntensity: s.specular ?? 0.5,
  };
  if (s.clearcoat) { o.clearcoat = s.clearcoat; o.clearcoatRoughness = 0.3; }
  return new THREE.MeshPhysicalMaterial(o);
}

// ---------------------------------------------------------------- anatomy (skin)
/**
 * normalScale of the anatomical skin normal map per style, per unit of
 * spec.definition (0..1). Clay reads the relief the most (mannequin look), toon
 * a softened, blurred version (cel bands bend along the muscles, no speckles).
 */
const DEFINITION_K = { realistic: 4.4, clay: 5.6, toon: 2.6, lines: 4.0 };
/** Toon skin samples the normal map this many mip levels blurrier (big muscle shapes only). */
const TOON_NORMAL_BIAS = 1.6;

/**
 * Anatomy shading of the skin (realistic / clay), from the anatomy map (cavity,
 * convexity) built from the normal map — see render/anatomy.js:
 *  - creases get contact shadow and, in the realistic style, the warm, saturated
 *    tint of light scattered under the skin (subsurface warmth);
 *  - muscle bellies get a slight lift; specular is occluded in the creases (no
 *    plastic shine inside the grooves).
 *  - form shading: diffuse falls off as the (normal-mapped) surface turns away
 *    from the eye, like a sculptor's clay material. Muscles stay readable even
 *    under flat frontal light, which otherwise erases them.
 * cfg: {cavity (darkening strength), tint (RGB at full cavity), lift, specOcc, form}
 */
function anatomyHook(material, anat, cfg, definition) {
  const k = 0.45 + 0.55 * definition; // more muscle definition = deeper creases
  const u = {
    pvAnat: { value: anat },
    pvAnatK: { value: new THREE.Vector4(cfg.cavity * k, cfg.lift * k, cfg.specOcc, cfg.form || 0) },
    pvCavTint: { value: new THREE.Vector3(...cfg.tint) },
  };
  return addHook(material, 'pv-anat', (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = 'uniform sampler2D pvAnat;\nuniform vec4 pvAnatK;\nuniform vec3 pvCavTint;\n' + patch(shader.fragmentShader, '#include <aomap_fragment>', `
      #ifdef USE_NORMALMAP
      {
        vec4 pvA = texture2D( pvAnat, vNormalMapUv );
        // only the marked grooves: the soft floor of the muscle separations stays clean
        // a light accent of the deepest grooves only (the relief itself carries the anatomy;
        // the baked map's fine detail is blob-shaped and would read as dirt if pushed). The
        // sculpt-baked maps of the realistic bodies carry weaker grooves (scapula border,
        // back muscles) that read as smudges: only the clear creases (pecs, abs, groin,
        // gluteal fold, joints) pass the threshold
        float pvCv = smoothstep( 0.32, 0.95, pvA.r ) * pvAnatK.x;
        float pvNv = clamp( dot( normal, geometryViewDir ), 0.0, 1.0 );
        vec3 pvOcc = mix( vec3( 1.0 ), pvCavTint, pvCv ) * ( 1.0 + pvAnatK.y * pvA.g ) * ( 1.0 - pvAnatK.w * ( 1.0 - pvNv * pvNv ) );
        reflectedLight.directDiffuse *= pvOcc;
        reflectedLight.indirectDiffuse *= pvOcc;
        float pvSo = 1.0 - pvAnatK.z * pvCv;
        reflectedLight.directSpecular *= pvSo;
        reflectedLight.indirectSpecular *= pvSo;
      }
      #endif
      #include <aomap_fragment>`, 'anat-shade');
  });
}

/** GLSL: anatomical crease line coverage at uv (anatomy map B = distance, A = groove strength). */
const ANAT_LINE_FN = /* glsl */`
  uniform sampler2D pvAnat;
  uniform vec2 pvAnatLine;
  uniform float pvAnatSize, pvInkPx;
  uniform vec3 pvInkCol;
  float pvAnatInk( vec2 uv ) {
    if ( pvAnatLine.x > 1.0 ) return 0.0;
    vec4 l = textureLod( pvAnat, uv, 0.0 );
    vec2 fw = fwidth( uv ) * pvAnatSize;
    float tpp = max( max( fw.x, fw.y ), 1e-4 );     // texels per pixel
    float dpx = l.b * 8.0 / tpp;                    // pixels to the groove centre line
    float s = smoothstep( pvAnatLine.x, pvAnatLine.x + 0.22, l.a );
    float hw = 0.5 * pvInkPx * mix( 0.3, 1.0, s );  // tapered brush stroke
    float cov = clamp( hw + 0.5 - dpx, 0.0, 1.0 ) * smoothstep( 0.0, 0.12, s );
    // far away the grooves are sub-pixel: fade out instead of smudging
    return cov * ( 1.0 - smoothstep( 1.6, 4.0, tpp ) ) * pvAnatLine.y;
  }
`;

/**
 * Anatomical crease lines drawn by the skin itself (toon / lines): constant
 * screen width (inner ink width), tapered ends, only grooves stronger than the
 * threshold ('Linee anatomiche'). uvVar: varying holding the body UV.
 */
function anatomyLineHook(material, anat, uvVar) {
  const u = {
    pvAnat: { value: anat }, pvAnatLine: anatomyLines, pvInkPx: inkLinePx, pvInkCol: inkColorLinear,
    pvAnatSize: { value: anat.image?.width || 1024 },
  };
  return addHook(material, 'pv-anat-line-' + uvVar, (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = ANAT_LINE_FN + patch(shader.fragmentShader, '#include <opaque_fragment>', `
      outgoingLight = mix( outgoingLight, pvInkCol, pvAnatInk( ${uvVar} ) );
      #include <opaque_fragment>`, 'anat-line');
  });
}

/** Toon skin: blurrier normal map lookup (mip bias) so the cel bands follow the big muscle shapes only. */
function normalBiasHook(material, bias) {
  return addHook(material, 'pv-nbias', (shader) => {
    shader.fragmentShader = patch(shader.fragmentShader, '#include <normal_fragment_maps>',
      THREE.ShaderChunk.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv )', `texture( normalMap, vNormalMapUv, ${bias.toFixed(2)} )`), 'normal-bias');
  });
}

/**
 * Skin normal map options from spec.definition: the anatomical map (spec.normalMap,
 * else materials.textures.skinNormal) at normalScale = definition × k(style).
 * Without definition the spec's own normalScale is used.
 */
function skinNormals(s, style, lib) {
  const def = typeof s.definition === 'number' ? Math.max(0, Math.min(1, s.definition)) : null;
  const map = s.normalMap || (def ? lib.textures.skinNormal : null);
  if (!map || def === 0) return { o: {}, map: null, def: def ?? 0 };
  const o = { normalMap: map };
  if (def !== null) o.normalScale = new THREE.Vector2(def * DEFINITION_K[style], def * DEFINITION_K[style]);
  else { const ns = vec2Of(s.normalScale); if (ns) o.normalScale = ns; }
  return { o, map, def: def ?? 0.5 };
}

/**
 * Eye texture remap. The shared eye texture has a red-brown iris; the iris is
 * isolated by its saturation and re-tinted with the spec color.
 * mode 0: realistic tint, 1: neutral clay (grey iris, dark pupil), 2: ink (white
 * sclera, thin iris ring, black pupil) so the gaze stays readable in every style.
 * spec.iris = [u0, v0, u1, v1, irisRadius, pupilRadius] (UV units, given by the
 * face module for its procedural texture) makes the ink eye exact: the iris
 * ring and the pupil are drawn as anti-aliased circles of constant screen width
 * (the inner ink line width) instead of being guessed from the texture.
 */
function eyeHook(material, irisColor, mode, iris) {
  const uIris = { value: colorOf(irisColor, '#5b3a21') };
  const geo = mode === 2 && Array.isArray(iris) && iris.length === 6;
  const uGeoC = { value: geo ? new THREE.Vector4(iris[0], iris[1], iris[2], iris[3]) : new THREE.Vector4() };
  const uGeoR = { value: geo ? new THREE.Vector2(iris[4], iris[5]) : new THREE.Vector2() };
  addHook(material, 'pv-eye-' + mode + (geo ? 'g' : ''), (shader) => {
    shader.uniforms.pvIris = uIris;
    let pre = 'uniform vec3 pvIris;\n';
    if (geo) {
      shader.uniforms.pvIrisC = uGeoC; shader.uniforms.pvIrisR = uGeoR; shader.uniforms.pvInkPx = inkLinePx;
      pre += 'uniform vec4 pvIrisC;\nuniform vec2 pvIrisR;\nuniform float pvInkPx;\n';
    }
    shader.fragmentShader = pre + patch(shader.fragmentShader, '#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 pvTex = texture2D( map, vMapUv );
        #if PV_EYE_MODE == 2 && defined( PV_IRIS_GEO )
          // exact circles around the gaze axis of the nearest eyeball (UV space)
          float pvR = min( distance( vMapUv, pvIrisC.xy ), distance( vMapUv, pvIrisC.zw ) );
          float pvFw = max( fwidth( pvR ), 1e-6 ); // UV units per pixel
          float pvRing = 1.0 - smoothstep( -0.5, 0.5, abs( pvR - pvIrisR.x ) / pvFw - 0.5 * pvInkPx );
          float pvPupil = 1.0 - smoothstep( -0.5, 0.5, ( pvR - pvIrisR.y ) / pvFw );
          pvTex.rgb = vec3( 1.0 - max( pvRing, pvPupil ) );
        #else
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
        #endif
        diffuseColor *= pvTex;
      #endif`, 'eye-map');
  });
  material.defines = { ...(material.defines || {}), PV_EYE_MODE: mode };
  if (geo) material.defines.PV_IRIS_GEO = '';
  return material;
}

/** Use the map only for its alpha (cut-out hair cards etc. in clay / lines styles). */
function mapAlphaOnlyHook(material) {
  return addHook(material, 'pv-map-alpha', (shader) => {
    shader.fragmentShader = patch(shader.fragmentShader, '#include <map_fragment>',
      '#ifdef USE_MAP\n diffuseColor.a *= texture2D( map, vMapUv ).a;\n#endif', 'map-alpha');
  });
}

/**
 * Cel shading for the toon style.
 * MeshToonMaterial quantizes every light on its own: with a key, a rim and a
 * fill light the three band sets overlap into a patchwork of blotches, and
 * nearest-sampled bands alias. Here the direct light is first summed as smooth
 * Lambert terms (shadows included) and quantized ONCE, relative to the
 * strongest light reaching the point. Band borders are then single smooth
 * iso-lines of the total light — the clean shapes a colorist would paint —
 * anti-aliased with fwidth() plus a little terminator softness. The hue of the
 * incoming light is kept, so coloured lights still tint the bands.
 * cfg: {tones: [shadow, mid, lit] RGB factors, t: [shadow|mid, mid|lit] thresholds
 * (fraction of the strongest light), soft: terminator softness, wrap: Lambert wrap}.
 */
const TOON_LUM = 'const vec3 PV_LUM = vec3( 0.2126, 0.7152, 0.0722 );\n';
const toonParsChunk = () => /* glsl */`
  varying vec3 vViewPosition;
  struct ToonMaterial { vec3 diffuseColor; };
  ${TOON_LUM}
  vec3 pvDirSum = vec3( 0.0 ); // sum of smooth direct light (shadows included)
  vec3 pvC0 = vec3( 0.0 );     // colour of the current light before its shadow
  vec3 pvKeyCol = vec3( 0.0 ); // strongest light reaching the point (unshadowed)
  float pvKey = 0.0;
  float pvBudget = 0.0;        // summed strength of every light reaching the point (unshadowed)
  void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
    float pvW = saturate( ( dot( geometryNormal, directLight.direction ) + pvToonWrap ) / ( 1.0 + pvToonWrap ) );
    pvDirSum += directLight.color * pvW;
    float pvK = dot( pvC0, PV_LUM );
    pvBudget += pvK;
    if ( pvK > pvKey ) { pvKey = pvK; pvKeyCol = pvC0; }
  }
  void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
    reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
  }
  #define RE_Direct RE_Direct_Toon
  #define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;
const toonResolve = /* glsl */`
  {
    float pvE = dot( pvDirSum, PV_LUM );
    float pvF = pvKey > 1e-6 ? pvE / pvKey : 0.0;
    #ifdef PV_TOON_CAV
      // garment fold valleys fall into the darker band first (painted fold shadows)
      pvF *= 1.0 - pvToonCavK * vPvCav;
    #endif
    #ifdef PV_TOON_ANAT
      // muscle separations (blurred cavity) fall into the darker band first: painted anatomy shapes
      pvF *= 1.0 - pvToonCav * smoothstep( 0.1, 0.6, textureLod( pvAnat, vNormalMapUv, 1.5 ).r );
    #endif
    // hue of the incoming light; in the shadow of every light it falls back to the key colour
    vec3 pvHue = ( pvDirSum + pvKeyCol * 0.05 ) / max( pvE + pvKey * 0.05, 1e-6 );
    float pvAA = min( fwidth( pvF ) * 0.7, 0.1 ) + pvToonSoft;
    vec3 pvT = mix( pvTone0, pvTone1, smoothstep( pvToonT.x - pvAA, pvToonT.x + pvAA, pvF ) );
    pvT = mix( pvT, pvTone2, smoothstep( pvToonT.y - pvAA, pvToonT.y + pvAA, pvF ) );
    // brightness of the lit band: the key light, or a share of every light together when
    // several lights work at once (with the default 3-point studio the lit band shows
    // about the picked colour itself, so garment / skin colours read as chosen)
    float pvRef = max( pvKey, 0.62 * pvBudget );
    reflectedLight.directDiffuse += pvRef * pvT * pvHue * BRDF_Lambert( material.diffuseColor );
  }
`;
function toonHook(material, cfg) {
  const u = {
    pvTone0: { value: new THREE.Vector3(...cfg.tones[0]) }, pvTone1: { value: new THREE.Vector3(...cfg.tones[1]) },
    pvTone2: { value: new THREE.Vector3(...cfg.tones[2]) }, pvToonT: { value: new THREE.Vector2(...cfg.t) },
    pvToonSoft: { value: cfg.soft }, pvToonWrap: { value: cfg.wrap || 0 }, pvToonCav: { value: cfg.cav || 0 },
  };
  return addHook(material, 'pv-toon', (shader) => {
    Object.assign(shader.uniforms, u);
    // remember each light's colour before its shadow (to know how strong it is)
    const begin = THREE.ShaderChunk.lights_fragment_begin.replace(/(get(?:Point|Spot|Sun|Directional)LightInfo\([^;]*directLight \);)/g, '$1\n\t\tpvC0 = directLight.color;');
    if (begin === THREE.ShaderChunk.lights_fragment_begin && !_warned.has('toon-c0')) { _warned.add('toon-c0'); console.warn('[render] toon light patch not applied (three.js chunk changed?)'); }
    let fs = shader.fragmentShader;
    fs = patch(fs, '#include <lights_toon_pars_fragment>', 'uniform vec3 pvTone0, pvTone1, pvTone2;\nuniform vec2 pvToonT;\nuniform float pvToonSoft, pvToonWrap, pvToonCav;\n' + toonParsChunk(), 'toon-pars');
    fs = patch(fs, '#include <lights_fragment_begin>', begin, 'toon-begin');
    fs = patch(fs, '#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + toonResolve, 'toon-resolve');
    shader.fragmentShader = fs;
  });
}

/**
 * Cornea shell of the eyes (kind 'eye' + spec.cornea, a separate mesh made by
 * the face module from the MakeHuman cornea triangles). The eyeball's iris is
 * concave, so a glossy eyeball mirrors the lights upside down (a catchlight
 * "dripping" under the pupil). The bulging cornea is drawn instead as a black,
 * additive glossy shell: it only adds reflections, in the right place.
 *  realistic: physically based reflection (lights + environment);
 *  toon / lines: one crisp comic highlight dot per strong light;
 *  clay: none (matte mannequin).
 * Never drawn into the ink G-buffer (userData.pvNoInk).
 */
function corneaMaterial(style) {
  let m;
  if (style === 'realistic') {
    m = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.05, metalness: 0, ior: 1.376, specularIntensity: 1, envMapIntensity: 1.2 });
  } else if (style === 'toon' || style === 'lines') {
    m = new THREE.MeshPhongMaterial({ color: 0x000000, specular: 0x000000, shininess: 1 });
    m.toneMapped = false;
    addHook(m, 'pv-cornea-dot', (shader) => {
      let fs = shader.fragmentShader;
      fs = patch(fs, '#include <lights_phong_pars_fragment>', THREE.ShaderChunk.lights_phong_pars_fragment.replace(
        'void RE_Direct_BlinnPhong(', `float pvHl = 0.0;
        void RE_Direct_BlinnPhong_Off(`) + `
        void RE_Direct_PvDot( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
          vec3 pvH = normalize( directLight.direction + geometryViewDir );
          float pvS = pow( saturate( dot( geometryNormal, pvH ) ), 140.0 );
          // weak fill lights give no dot, strong ones a full one (shadowed lights none)
          pvHl = max( pvHl, pvS * clamp( dot( directLight.color, vec3( 0.2126, 0.7152, 0.0722 ) ) / 1.4, 0.0, 1.0 ) );
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_PvDot
      `, 'cornea-pars');
      fs = patch(fs, '#include <opaque_fragment>', `
        float pvAA = max( fwidth( pvHl ), 1e-3 );
        outgoingLight = vec3( 0.92 * smoothstep( 0.45 - pvAA, 0.45 + pvAA, pvHl ) );
        #include <opaque_fragment>`, 'cornea-out');
      shader.fragmentShader = fs;
    });
  } else {
    m = new THREE.MeshBasicMaterial({ color: 0x000000 });
    m.visible = false;
  }
  m.transparent = true;
  m.blending = THREE.AdditiveBlending;
  m.depthWrite = false;
  m.userData.pvNoInk = true;
  return m;
}

/** Toon tone sets: skin gets warm, slightly saturated shadows (classic comic colouring). */
// Skin keeps few, large shapes (clean faces); fabric and hair get a higher
// mid/lit threshold so folds and wrinkles turned slightly away from the key
// light read as painted shadow shapes.
const TOON_SKIN = { tones: [[0.56, 0.40, 0.38], [0.86, 0.74, 0.70], [1, 1, 1]], t: [0.12, 0.55], soft: 0.035, wrap: 0.05 };
const TOON_BASE = { tones: [[0.46, 0.46, 0.48], [0.75, 0.75, 0.76], [1, 1, 1]], t: [0.2, 0.74], soft: 0.02, wrap: 0 };
const TOON_EYE = { tones: [[0.62, 0.62, 0.64], [0.85, 0.85, 0.86], [1, 1, 1]], t: [0.08, 0.4], soft: 0.04, wrap: 0.3 };

/** Anatomy shading of the skin per style (see anatomyHook). */
const ANAT_REAL = { cavity: 0.35, tint: [0.74, 0.5, 0.43], lift: 0.04, specOcc: 0.7, form: 0.14 };
const ANAT_CLAY = { cavity: 0.3, tint: [0.50, 0.47, 0.45], lift: 0.06, specOcc: 0.7, form: 0.4 };

const dqHook = (shader) => { shader.vertexShader = injectSoftSkin(shader.vertexShader); };

// ---------------------------------------------------------------- library
class MaterialLibrary extends THREE.EventDispatcher {
  constructor() {
    super();
    this.style = 'realistic';
    /** mesh -> spec | spec[] */
    this.tracked = new Map();
    this.cache = new Map();
    this.textures = {};
    /** extra per-style factories (fn(spec) -> Material, `this` = library) may be registered by modules */
    this.factories = {};
    /** renderer used to derive the anatomy maps (set by the render module) */
    this.renderer = null;
    /** UV island coverage of the body skin (seams handling of the anatomy maps), set with setRenderer */
    this.uvMask = null;
    /** dual-quaternion skinning switch ('Deformazione morbida'), see softskin.js */
    this.softSkin = softSkin;
    /** largest texture side of the quality preset (0 = none), set by the render module */
    this.textureCap = 0;
  }

  /** Gives the library a renderer: GPU-derived maps (anatomy) become available. */
  setRenderer(renderer, uvMask = this.uvMask) {
    if (this.renderer === renderer && this.uvMask === uvMask) return;
    this.renderer = renderer;
    this.uvMask = uvMask;
    softSkin.checkSupport(renderer);
    const old = this.cache;
    this.cache = new Map();
    this.refreshAll();
    this._disposeUnused(old);
  }

  /** Anatomy map (cavity, convexity, crease lines) of a skin normal map, or null. */
  anatomyFor(normalMap) {
    if (!normalMap || !this.renderer) return null;
    try { return anatomyTexture(this.renderer, normalMap, this.uvMask); } catch (e) { console.warn('[render] anatomy map failed', e); return null; }
  }

  /** Drops every cached material (rebuilt lazily, e.g. after a context loss). */
  rebuildAll() {
    const old = this.cache;
    this.cache = new Map();
    this.refreshAll();
    this._disposeUnused(old);
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
      if (this.textureCap) for (const v of Object.values(spec)) if (v && v.isTexture) fitTextureToCap(v, this.textureCap);
      const f = this.factories[this.style] || defaultFactories[this.style];
      m = f.call(this, spec);
      m.userData.kind = spec.kind;
      // volume-preserving skinning (active when the PV_DQS define is on, see softskin.js)
      addHook(m, 'pv-dq', dqHook);
      softSkin.register(m, true);
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
/** Optional glow (lit windows, lamps, vehicle lights): spec.emissive / emissiveIntensity / emissiveMap. */
function emissiveOf(s) {
  if (!s.emissive && !s.emissiveMap) return {};
  return { emissive: new THREE.Color(s.emissive || '#ffffff'), emissiveIntensity: s.emissiveIntensity ?? 1, emissiveMap: s.emissiveMap || null };
}

const defaultFactories = {
  /** Flattering PBR: wrapped-diffuse skin with warm sheen, fabric sheen, glossy eyes. */
  realistic(s) {
    const color = colorOf(s.color);
    const c = common(s);
    switch (s.kind) {
      case 'skin': {
        // soft, satin skin: broad low specular (no wet plastic shine), warm velvet sheen at grazing
        // angles, light bleeding past the terminator, anatomy creases with subsurface warmth
        const sn = skinNormals(s, 'realistic', this);
        const m = new THREE.MeshPhysicalMaterial({
          ...c, color, map: s.map || this.textures.skinDetail || null, ...sn.o,
          roughness: s.roughness ?? 0.6, metalness: 0, specularIntensity: 0.42,
          sheen: s.sheen ?? 0.2, sheenRoughness: 0.62, sheenColor: new THREE.Color('#ff9c80'),
        });
        wrapDiffuseHook(m, [0.42, 0.22, 0.15], 'pv-wrap-skin');
        const anat = this.anatomyFor(sn.map);
        return anat ? anatomyHook(m, anat, ANAT_REAL, sn.def) : m;
      }
      case 'eye': {
        if (s.cornea) return corneaMaterial('realistic');
        // soft, moist eyeball; the crisp reflections come from the cornea shell (corneaMaterial)
        const m = new THREE.MeshPhysicalMaterial({
          ...c, map: s.map || this.textures.eye || null, roughness: 0.38, specularIntensity: 0.5,
        });
        return eyeHook(m, s.color, 0);
      }
      case 'lashes':
        return new THREE.MeshStandardMaterial({ ...c, side: sideOf(s.side, THREE.DoubleSide), color, map: s.map || null, roughness: 0.9 });
      case 'teeth':
        return new THREE.MeshStandardMaterial({ ...c, color, map: s.map || null, roughness: 0.32 });
      case 'tongue': // always deep inside the mouth: built-in cavity darkening, no plastic gloss
        return new THREE.MeshStandardMaterial({ ...c, color: color.multiplyScalar(MOUTH_CAVITY), map: s.map || null, roughness: 0.55 });
      case 'cloth': {
        const m = wrapDiffuseHook(clothPhysical(s, c, color), [0.14, 0.14, 0.14], 'pv-wrap-soft');
        return isCloth(s) ? clothHook(m, s, 'realistic') : m;
      }
      case 'brows': // eyebrow hairs: shaded like hair, but never inked (see the prepass)
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
        const o = { ...c, color, map: s.map || null, ...normals(s), ...emissiveOf(s), roughness: s.roughness ?? 0.7, metalness: s.metalness ?? 0 };
        return s.sheen ? new THREE.MeshPhysicalMaterial({ ...o, sheen: s.sheen, sheenRoughness: 0.7, sheenColor: color.clone().lerp(new THREE.Color('#ffffff'), 0.3) }) : new THREE.MeshStandardMaterial(o);
      }
    }
  },

  /** Neutral matte mannequin. Normal maps kept (wrinkles!), color maps used only for cut-out alpha. */
  clay(s) {
    const color = colorOf(CLAY[s.kind] || '#b5b0a8');
    if (s.kind === 'cloth' || s.kind === 'hair' || s.kind === 'brows' || s.kind === 'prop') color.lerp(colorOf(s.color, '#999999'), s.kind === 'hair' || s.kind === 'brows' ? 0.3 : 0.26);
    const c = common(s, { colors: false });
    if (s.kind === 'eye') return s.cornea ? corneaMaterial('clay') : eyeHook(new THREE.MeshStandardMaterial({ ...c, map: s.map || this.textures.eye || null, roughness: 0.35 }), s.color, 1);
    if (s.kind === 'skin') {
      // sculpted mannequin: matte satin surface, soft terminator, a faint rim sheen that
      // separates the silhouette, anatomy creases as contact shadow, muscle bellies lifted
      const sn = skinNormals(s, 'clay', this);
      const m = new THREE.MeshPhysicalMaterial({
        ...c, color, ...sn.o, roughness: 0.72, metalness: 0, specularIntensity: 0.24,
        sheen: 0.18, sheenRoughness: 0.75, sheenColor: new THREE.Color('#e9e3da'),
      });
      wrapDiffuseHook(m, [0.17, 0.15, 0.14], 'pv-wrap-clay');
      const anat = this.anatomyFor(sn.map);
      return anat ? anatomyHook(m, anat, ANAT_CLAY, sn.def) : m;
    }
    if (isCloth(s)) {
      // garments: the fabric relief (weave, seams, pockets, fold cavity), no colour
      const m = new THREE.MeshStandardMaterial({ ...c, color, ...normals(s), map: s.map || null, roughness: 0.88, metalness: 0, side: sideOf(s.side, THREE.FrontSide) });
      return clothHook(m, s, 'clay');
    }
    const cut = !!(s.map && (s.alphaTest || s.transparent));
    const m = new THREE.MeshStandardMaterial({
      ...c, color, ...normals(s), map: cut ? s.map : null,
      roughness: 0.88, metalness: 0, side: sideOf(s.side, s.kind === 'lashes' ? THREE.DoubleSide : THREE.FrontSide),
    });
    return cut ? mapAlphaOnlyHook(m) : m;
  },

  /** Cel shading (smooth-edged bands of the total light, warm skin shadows). Ink lines come from the outline pass. */
  toon(s) {
    const color = colorOf(s.color);
    const c = common(s);
    if (s.kind === 'eye') return s.cornea ? corneaMaterial('toon') : eyeHook(toonHook(new THREE.MeshToonMaterial({ ...c, map: s.map || this.textures.eye || null }), TOON_EYE), s.color, 0);
    if (s.kind === 'skin') {
      // muscles as a softened (mip-biased) relief: bands bend along them without speckles;
      // the muscle separations reach the shadow band first; optional anatomical ink lines
      const sn = skinNormals(s, 'toon', this);
      const anat = this.anatomyFor(sn.map);
      const m = toonHook(new THREE.MeshToonMaterial({ ...c, color, ...sn.o }), { ...TOON_SKIN, cav: anat ? 0.24 : 0 });
      if (sn.map) normalBiasHook(m, TOON_NORMAL_BIAS);
      if (anat) { m.defines = { ...(m.defines || {}), PV_TOON_ANAT: '' }; anatomyLineHook(m, anat, 'vNormalMapUv'); }
      return m;
    }
    if (s.kind === 'tongue') color.multiplyScalar(MOUTH_CAVITY);
    const m = toonHook(new THREE.MeshToonMaterial({
      ...c, color, ...(isCloth(s) ? {} : normals(s)), ...emissiveOf(s),
      map: s.map || null, // garment details, hair cards, prop textures
      side: sideOf(s.side, s.kind === 'lashes' ? THREE.DoubleSide : THREE.FrontSide),
    }), TOON_BASE);
    // garments: flat colour with seams, pockets and stitching; fold valleys in the cel shadow
    return isCloth(s) ? clothHook(m, s, 'toon') : m;
  },

  /**
   * Pure line art: white surfaces, ink from the outline pass. Lashes, brows and
   * pupils are drawn dark (as an inker would), the iris as an ink circle.
   */
  lines(s) {
    if (s.kind === 'eye') {
      if (s.cornea) return corneaMaterial('lines');
      const m = new THREE.MeshBasicMaterial({ ...common(s, { colors: false }), map: s.map || this.textures.eye || null });
      m.toneMapped = false;
      return eyeHook(m, s.color, 2, s.iris);
    }
    if (s.kind === 'skin') {
      // white paper skin; anatomical crease lines above the 'Linee anatomiche' threshold. The
      // anatomy map rides on aoMap (intensity 0 = no shading effect) only to get the body UVs.
      const sn = skinNormals(s, 'lines', this);
      const anat = this.anatomyFor(sn.map);
      const m = new THREE.MeshBasicMaterial({ ...common(s, { colors: false }), color: 0xffffff, aoMap: anat || null, aoMapIntensity: 0 });
      m.toneMapped = false;
      return anat ? anatomyLineHook(m, anat, 'vAoMapUv') : m;
    }
    // brow hairs keep their per-hair tone (vertex colours) so they read as pencil strokes
    const c = common(s, { colors: s.kind === 'brows' });
    // semi-transparent hair shells (stubble) become a light grey tone, like a screentone
    const tone = s.kind === 'hair' && s.transparent && (s.opacity ?? 1) < 0.95;
    const col = s.kind === 'lashes' ? '#1d1d1d' : s.kind === 'brows' ? '#3a3734' : tone ? '#8c8c8c' : '#ffffff';
    const cut = !!(s.map && (s.alphaTest || s.transparent));
    const m = new THREE.MeshBasicMaterial({ ...c, color: new THREE.Color(col), map: cut ? s.map : null, side: sideOf(s.side, s.kind === 'lashes' ? THREE.DoubleSide : THREE.FrontSide) });
    m.toneMapped = false;
    return cut ? mapAlphaOnlyHook(m) : m;
  },
};

export const materials = new MaterialLibrary();
