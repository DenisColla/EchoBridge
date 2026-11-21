// GLSL for the render pipeline: G-buffer (normal + object id) prepass,
// screen-space ink edges, separable distance-field line thickening, ink / AO
// composites, background and the capture output pass.
//
// Ink lines are built in three steps so they stay clean and round at any
// thickness and on high-DPI screens:
//   1. edgeMaterial  : 1px seed pixels (R = contour/occlusion, G = inner crease)
//                      from depth, view normals and per-object ids.
//   2. hdistMaterial : horizontal distance (px) to the nearest seed (per channel).
//   3. inkAlpha()    : vertical pass -> exact euclidean distance -> anti-aliased
//                      coverage for a line of radius r (separable distance transform).
import * as THREE from 'three';

/** Upper bound of the line radius (device px) the shaders support. */
export const MAX_INK_RADIUS = 16;
/** horizontal distances are stored as d / DIST_SCALE in an 8-bit RG target (DIST_SCALE = "no seed") */
const DIST_SCALE = 32.0;

const quadVertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const fsMaterial = (opts) => new THREE.ShaderMaterial({ vertexShader: quadVertex, depthTest: false, depthWrite: false, toneMapped: false, ...opts });

// ---------------------------------------------------------------- G-buffer prepass
/**
 * Prepass material for one source material of one mesh: view-space normal in
 * RGB (GTAO compatible, packed *0.5+0.5) and the object id in A.
 * Built on MeshNormalMaterial so skinning, morphs, instancing, double-sided
 * normals and normal maps work exactly like in the color pass.
 */
export function makePrepassMaterial(src, id) {
  const m = new THREE.MeshNormalMaterial({ side: src?.side ?? THREE.FrontSide, blending: THREE.NoBlending });
  if (src) {
    // styles without lighting (lines) keep the spec normal map in userData for the outlines
    const nm = src.normalMap || src.userData?.pvNormalMap;
    if (nm) {
      m.normalMap = nm;
      const ns = src.normalMap ? src.normalScale : src.userData.pvNormalScale;
      if (ns) m.normalScale.copy(ns);
      if (src.normalMap) m.normalMapType = src.normalMapType;
    }
    // cut-out surfaces (hair cards, lace…) must leave holes in the G-buffer too
    const cut = src.map && (src.alphaTest > 0 || src.transparent);
    if (cut) { m.map = src.map; m.alphaTest = src.alphaTest > 0 ? src.alphaTest : 0.5; }
    m.flatShading = !!src.flatShading;
    // lashes and brow hairs are fine dark strokes already: outlining each hair only
    // produces hatching scribbles (and they never occlude anything worth a line)
    const k = src.userData?.kind;
    // semi-transparent hair shells (stubble) are a tone over the skin, not a shape: in the
    // G-buffer they only produce a beard outline and speckles where the shell meets the skin
    const shell = k === 'hair' && src.transparent && src.opacity < 0.95;
    m.visible = src.visible !== false && k !== 'lashes' && k !== 'brows' && !shell && !src.userData?.pvNoInk;
  }
  const uId = { value: id / 255 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.pvObjectId = uId;
    shader.fragmentShader = 'uniform float pvObjectId;\n#include <map_pars_fragment>\n#include <alphatest_pars_fragment>\n' + shader.fragmentShader
      .replace('vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );', 'vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );\n#include <map_fragment>\n#include <alphatest_fragment>')
      .replace('gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );',
        // interpolated normals at silhouettes can face away from the camera: bend them back
        // (prevents dotted dark rims in GTAO and spurious crease lines)
        'vec3 pvN = normalize( normal ); if ( pvN.z < 0.08 ) pvN = normalize( vec3( pvN.xy, 0.08 ) );\ngl_FragColor = vec4( pvN * 0.5 + 0.5, pvObjectId );');
  };
  m.customProgramCacheKey = () => 'pv-gbuf';
  m.userData.pvId = uId;
  return m;
}

// ---------------------------------------------------------------- edges
export function makeEdgeMaterial() {
  return fsMaterial({
    defines: { PV_ORTHO: 0 },
    uniforms: {
      tG: { value: null }, tDepth: { value: null }, texel: { value: new THREE.Vector2() },
      cameraNear: { value: 0.1 }, cameraFar: { value: 100 },
      depthThr: { value: 0.012 }, creaseCos: { value: -2 }, nStep: { value: 1 },
      valleyK: { value: -1 }, pxWorld: { value: 0.001 },
    },
    fragmentShader: /* glsl */`
      #include <packing>
      uniform sampler2D tG;
      uniform highp sampler2D tDepth;
      uniform vec2 texel;
      uniform float cameraNear, cameraFar, depthThr, creaseCos, nStep;
      uniform float valleyK; // curvature (1/m) above which a concave fold is inked (< 0: off)
      uniform float pxWorld; // world size of one pixel at distance 1 (perspective) or absolute (ortho)
      varying vec2 vUv;

      float dist( vec2 uv ) {
        float d = texture2D( tDepth, uv ).x;
        #if PV_ORTHO == 1
          return - orthographicDepthToViewZ( d, cameraNear, cameraFar );
        #else
          return - perspectiveDepthToViewZ( d, cameraNear, cameraFar );
        #endif
      }
      float idOf( vec4 g ) { return floor( g.a * 255.0 + 0.5 ); }

      void main() {
        vec4 g = texture2D( tG, vUv );
        float id = idOf( g );
        // id 0 = background / ground: never inked (lines belong to the near object)
        if ( id < 0.5 ) { gl_FragColor = vec4( 0.0 ); return; }
        float z = dist( vUv );
        float sil = 0.0;
        for ( int i = 0; i < 4; i ++ ) {
          vec2 d = i == 0 ? vec2( 1.0, 0.0 ) : i == 1 ? vec2( - 1.0, 0.0 ) : i == 2 ? vec2( 0.0, 1.0 ) : vec2( 0.0, - 1.0 );
          vec2 uq = vUv + d * texel;
          float idq = idOf( texture2D( tG, uq ) );
          float zq = dist( uq );
          if ( idq != id ) {
            // object / character boundary: mark the nearer side only
            if ( idq < 0.5 || z <= zq ) sil = 1.0;
            continue;
          }
          // occlusion inside one object: compare with the planar prediction
          // (1/z is affine in screen space, so slanted planes do not trigger)
          float zo = dist( vUv - d * texel );
          float inv = 2.0 / z - 1.0 / zo;
          float zp = inv > 1e-6 ? 1.0 / inv : 1e6;
          if ( zq > z && abs( zq - zp ) > depthThr * z ) sil = 1.0;
        }
        float crease = 0.0;
        bool inner = id < 127.5;               // 128..254: contour-only objects
        bool folds = id > 95.5 && inner;       // 96..127: garments, also get fold (valley) lines
        if ( inner && sil < 0.5 && creaseCos > - 1.5 ) {
          vec3 n = g.rgb * 2.0 - 1.0;
          for ( int i = 0; i < 2; i ++ ) {
            vec2 uq = vUv + ( i == 0 ? vec2( nStep, 0.0 ) : vec2( 0.0, nStep ) ) * texel;
            vec4 gq = texture2D( tG, uq );
            if ( idOf( gq ) != id ) continue;
            if ( dot( n, gq.rgb * 2.0 - 1.0 ) < creaseCos && abs( dist( uq ) - z ) < depthThr * z * nStep ) crease = 1.0;
          }
        }
        // concave folds (cloth wrinkles from geometry or normal maps, skin folds): negative
        // divergence of the view-normal field, converted to world curvature so the amount of
        // detail does not depend on zoom or resolution
        if ( folds && sil < 0.5 && crease < 0.5 && valleyK > 0.0 ) {
          // wider stencil than the crease test: tiny, dense geometry (tear ducts, nostrils)
          // must not trigger fold lines, only folds with a real extent do
          float vs = 2.0 * nStep;
          vec2 sx = vec2( vs * texel.x, 0.0 ), sy = vec2( 0.0, vs * texel.y );
          vec4 gl = texture2D( tG, vUv - sx ), gr = texture2D( tG, vUv + sx );
          vec4 gd = texture2D( tG, vUv - sy ), gu = texture2D( tG, vUv + sy );
          if ( idOf( gl ) == id && idOf( gr ) == id && idOf( gd ) == id && idOf( gu ) == id ) {
            // directional second derivatives (normal change across x and across y)
            float kx = gr.r - gl.r, ky = gu.g - gd.g;
            #if PV_ORTHO == 1
              float wpp = pxWorld;
            #else
              float wpp = pxWorld * z;
            #endif
            float k = ( kx + ky ) * 2.0 / ( 2.0 * vs * wpp );
            // non-maximum suppression across the fold keeps valley lines thin
            bool thin;
            if ( abs( kx ) >= abs( ky ) ) {
              float kxr = texture2D( tG, vUv + 2.0 * sx ).r - g.r, kxl = g.r - texture2D( tG, vUv - 2.0 * sx ).r;
              thin = kx <= kxr + 0.004 && kx <= kxl + 0.004;
            } else {
              float kyu = texture2D( tG, vUv + 2.0 * sy ).g - g.g, kyd = g.g - texture2D( tG, vUv - 2.0 * sy ).g;
              thin = ky <= kyu + 0.004 && ky <= kyd + 0.004;
            }
            if ( thin && k < - valleyK ) {
              float tol = depthThr * z * vs * 2.0;
              if ( abs( dist( vUv - sx ) - z ) < tol && abs( dist( vUv + sx ) - z ) < tol && abs( dist( vUv - sy ) - z ) < tol && abs( dist( vUv + sy ) - z ) < tol ) crease = 1.0;
            }
          }
        }
        gl_FragColor = vec4( sil, crease, 0.0, 1.0 );
      }`,
  });
}

export function makeHDistMaterial() {
  return fsMaterial({
    defines: { MAXR: MAX_INK_RADIUS, DIST_SCALE: DIST_SCALE.toFixed(1) },
    uniforms: { tEdge: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1 } },
    fragmentShader: /* glsl */`
      uniform sampler2D tEdge;
      uniform vec2 texel;
      uniform float radius;
      varying vec2 vUv;
      void main() {
        int R = min( int( ceil( radius ) ), MAXR );
        float ds = DIST_SCALE, dc = DIST_SCALE;
        for ( int k = - R; k <= R; k ++ ) {
          vec2 e = texture2D( tEdge, vUv + vec2( float( k ) * texel.x, 0.0 ) ).rg;
          float a = abs( float( k ) );
          if ( e.r > 0.5 ) ds = min( ds, a );
          if ( e.g > 0.5 ) dc = min( dc, a );
        }
        gl_FragColor = vec4( ds / DIST_SCALE, dc / DIST_SCALE, 0.0, 1.0 );
      }`,
  });
}

/** GLSL: ink coverage at uv from the horizontal-distance texture (vertical pass of the EDT). */
const inkFunction = /* glsl */`
  uniform sampler2D tH;
  uniform vec2 texelH;
  uniform float rS, rC, creaseAlpha;
  float inkAlpha( vec2 uv ) {
    int R = min( int( ceil( max( rS, rC ) ) ), MAXR );
    float bs = 1e4, bc = 1e4;
    for ( int k = - R; k <= R; k ++ ) {
      vec2 h = texture2D( tH, uv + vec2( 0.0, float( k ) * texelH.y ) ).rg * DIST_SCALE;
      float kk = float( k * k );
      bs = min( bs, h.r * h.r + kk );
      bc = min( bc, h.g * h.g + kk );
    }
    float aS = clamp( rS + 0.5 - sqrt( bs ), 0.0, 1.0 );
    float aC = clamp( rC + 0.5 - sqrt( bc ), 0.0, 1.0 ) * creaseAlpha;
    return max( aS, aC );
  }`;

const inkUniforms = () => ({ tH: { value: null }, texelH: { value: new THREE.Vector2() }, rS: { value: 1 }, rC: { value: 0.6 }, creaseAlpha: { value: 1 } });

/** Ink over the already rendered frame (normal alpha blending, sRGB values). */
export function makeInkMaterial() {
  return fsMaterial({
    transparent: true, blending: THREE.NormalBlending,
    defines: { MAXR: MAX_INK_RADIUS, DIST_SCALE: DIST_SCALE.toFixed(1) },
    uniforms: { ...inkUniforms(), inkColor: { value: new THREE.Vector3() }, inkOpacity: { value: 1 } },
    fragmentShader: inkFunction + /* glsl */`
      uniform vec3 inkColor;
      uniform float inkOpacity;
      varying vec2 vUv;
      void main() {
        float a = inkAlpha( vUv ) * inkOpacity;
        if ( a <= 0.0 ) discard;
        gl_FragColor = vec4( inkColor, a );
      }`,
  });
}

/**
 * GLSL: ambient occlusion at full resolution from the (denoised, usually
 * half-resolution) GTAO texture. Joint bilateral upsampling over a 3x3
 * low-res footprint: texels from other surfaces (depth) are rejected, so
 * occlusion never bleeds across silhouettes and isolated noisy texels average out.
 */
const aoFunction = /* glsl */`
  #include <packing>
  uniform sampler2D tAO;
  uniform highp sampler2D tAODepth;
  uniform vec2 aoSize;
  uniform float aoNear, aoFar;
  float aoDist( vec2 uv ) {
    float d = texture2D( tAODepth, uv ).x;
    #if PV_ORTHO == 1
      return - orthographicDepthToViewZ( d, aoNear, aoFar );
    #else
      return - perspectiveDepthToViewZ( d, aoNear, aoFar );
    #endif
  }
  float aoAt( vec2 vUv ) {
    float z = aoDist( vUv );
    vec2 p = vUv * aoSize - 0.5;
    vec2 c = floor( p + 0.5 );
    float sum = 0.0, wsum = 0.0;
    for ( int j = - 1; j <= 1; j ++ ) for ( int i = - 1; i <= 1; i ++ ) {
      vec2 t = c + vec2( float( i ), float( j ) );
      vec2 uv = ( t + 0.5 ) / aoSize;
      vec2 d = abs( t - p );
      float ws = max( 0.0, 1.5 - d.x ) * max( 0.0, 1.5 - d.y );
      float dz = abs( aoDist( uv ) - z ) / max( z, 1e-3 );
      float w = ws * exp( - dz * 80.0 );
      sum += texture2D( tAO, uv ).r * w;
      wsum += w;
    }
    return wsum > 1e-4 ? sum / wsum : 1.0;
  }`;

const aoUniforms = () => ({ tAO: { value: null }, tAODepth: { value: null }, aoSize: { value: new THREE.Vector2(1, 1) }, aoNear: { value: 0.1 }, aoFar: { value: 100 } });

/** Multiplies the frame by the ambient occlusion term (dst * ao). */
export function makeAOMultiplyMaterial() {
  return fsMaterial({
    transparent: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    defines: { PV_ORTHO: 0 },
    uniforms: { ...aoUniforms(), intensity: { value: 1 } },
    fragmentShader: aoFunction + /* glsl */`
      uniform float intensity;
      varying vec2 vUv;
      void main() { gl_FragColor = vec4( vec3( mix( 1.0, aoAt( vUv ), intensity ) ), 1.0 ); }`,
  });
}

/** Background quad: vertical gradient (mode 0) or transparency checker preview (mode 1). sRGB colors. */
export function makeBackgroundMaterial() {
  return fsMaterial({
    uniforms: { cTop: { value: new THREE.Vector3() }, cBottom: { value: new THREE.Vector3() }, mode: { value: 0 }, cell: { value: 12 } },
    fragmentShader: /* glsl */`
      uniform vec3 cTop, cBottom;
      uniform float mode, cell;
      varying vec2 vUv;
      void main() {
        if ( mode < 0.5 ) {
          vec3 c = mix( cBottom, cTop, smoothstep( 0.0, 1.0, vUv.y ) );
          float n = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
          gl_FragColor = vec4( c + ( n - 0.5 ) / 255.0, 1.0 ); // dither: no banding on 8-bit panels
        } else {
          vec2 q = floor( gl_FragCoord.xy / cell );
          float k = mod( q.x + q.y, 2.0 );
          gl_FragColor = vec4( vec3( mix( 0.80, 0.93, k ) ), 1.0 );
        }
      }`,
  });
}

const TONE_DEFINES = {
  [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING',
  [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
  [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING',
  [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
  [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING',
  [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
};

/**
 * Capture output pass (renders into an RGBA8 target that is read back):
 * linear HDR color -> tone mapping -> sRGB -> AO -> background -> ink.
 * Mirrors what the on-screen path does with per-material tone mapping and
 * blend passes, so exports look like the viewport. Output is straight alpha.
 */
export function makeOutputMaterial() {
  return fsMaterial({
    defines: { MAXR: MAX_INK_RADIUS, DIST_SCALE: DIST_SCALE.toFixed(1), PV_ORTHO: 0 },
    uniforms: {
      ...inkUniforms(), ...aoUniforms(),
      tColor: { value: null }, useAO: { value: 0 }, aoIntensity: { value: 1 },
      useInk: { value: 0 }, inkColor: { value: new THREE.Vector3() }, inkOpacity: { value: 1 },
      bgMode: { value: 0 }, bgTop: { value: new THREE.Vector3() }, bgBottom: { value: new THREE.Vector3() },
      toneMappingExposure: { value: 1 },
    },
    fragmentShader: '#include <tonemapping_pars_fragment>\n' + inkFunction + aoFunction + /* glsl */`
      uniform sampler2D tColor;
      uniform float useAO, aoIntensity, useInk, inkOpacity, bgMode;
      uniform vec3 inkColor, bgTop, bgBottom;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D( tColor, vUv );
        float a = clamp( c.a, 0.0, 1.0 );
        vec3 rgb = a > 1e-5 ? c.rgb / a : vec3( 0.0 );
        #if defined( LINEAR_TONE_MAPPING )
          rgb = LinearToneMapping( rgb );
        #elif defined( REINHARD_TONE_MAPPING )
          rgb = ReinhardToneMapping( rgb );
        #elif defined( CINEON_TONE_MAPPING )
          rgb = CineonToneMapping( rgb );
        #elif defined( ACES_FILMIC_TONE_MAPPING )
          rgb = ACESFilmicToneMapping( rgb );
        #elif defined( AGX_TONE_MAPPING )
          rgb = AgXToneMapping( rgb );
        #elif defined( NEUTRAL_TONE_MAPPING )
          rgb = NeutralToneMapping( rgb );
        #endif
        rgb = sRGBTransferOETF( vec4( clamp( rgb, 0.0, 1.0 ), 1.0 ) ).rgb;
        if ( useAO > 0.5 ) rgb *= mix( 1.0, aoAt( vUv ), aoIntensity );
        if ( bgMode > 0.5 ) {
          vec3 bg = mix( bgBottom, bgTop, smoothstep( 0.0, 1.0, vUv.y ) );
          rgb = rgb * a + bg * ( 1.0 - a );
          a = 1.0;
        }
        if ( useInk > 0.5 ) {
          float ia = inkAlpha( vUv ) * inkOpacity;
          float na = ia + a * ( 1.0 - ia );
          rgb = na > 1e-5 ? ( inkColor * ia + rgb * a * ( 1.0 - ia ) ) / na : vec3( 0.0 );
          a = na;
        }
        gl_FragColor = vec4( rgb, a );
      }`,
  });
}

/** Sets the tone-mapping define of an output material; returns true if the program must change. */
export function setOutputToneMapping(mat, toneMapping) {
  const name = TONE_DEFINES[toneMapping] || null;
  for (const n of Object.values(TONE_DEFINES)) delete mat.defines[n];
  if (name) mat.defines[name] = '';
  const key = name || 'none';
  if (mat.userData.tone !== key) { mat.userData.tone = key; mat.needsUpdate = true; }
}
