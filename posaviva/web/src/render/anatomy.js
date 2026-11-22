// Anatomy maps derived on the GPU (once per skin normal map) from the
// anatomical tangent-space normal map (body UV space):
//   R = cavity     concave areas (grooves between muscles, under the pecs,
//                  linea alba, collarbones, knee / elbow pits) — contact
//                  shadow and subsurface warmth of the creases;
//   G = convexity  muscle bellies and bony landmarks (soft highlights);
//   B = distance (texels / 8) to the centre line of the nearest groove;
//   A = strength of that groove at its centre line.
// B and A let the materials draw ANATOMICAL CREASE LINES of constant screen
// width with tapered ends (toon / lines styles), above a threshold.
//
// The cavity is the negative divergence of the normal field (= Laplacian of
// the relief), band-passed over several scales so narrow creases are found and
// broad bowls are not. UV island borders (seams, where the map meets its flat
// background) would look like deep grooves: a mask of the body's UV islands
// (rasterised once from the mesh) gives no-flux taps there and fades the maps
// out along the seams. Two fullscreen passes, a few milliseconds once.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const vert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

// pass 1: multi-scale divergence of the normal map.
// Output: R = cavity for shading (fine + mid scales), G = convexity, B = smooth
// groove field for the crease lines (mid + broad scales only: what an inker draws).
const cavityFrag = /* glsl */`
  uniform sampler2D tN, tMask;
  uniform float srcSize, useMask;
  varying vec2 vUv;
  vec2 n0;
  // taps outside the UV islands take the centre value (no-flux boundary: seams are not grooves)
  vec2 nxy( vec2 uv, float lod ) {
    vec2 n = textureLod( tN, uv, lod ).xy * 2.0 - 1.0;
    return useMask > 0.5 && texture2D( tMask, uv ).r < 0.5 ? n0 : n;
  }
  // divergence (per UV unit) at radius r source texels, from the mip level that blurs ~r
  float div( float r ) {
    float lod = max( 0.0, log2( r ) - 0.5 );
    n0 = textureLod( tN, vUv, lod ).xy * 2.0 - 1.0;
    float h = r / srcSize;
    float dx = nxy( vUv + vec2( h, 0.0 ), lod ).x - nxy( vUv - vec2( h, 0.0 ), lod ).x;
    float dy = nxy( vUv + vec2( 0.0, h ), lod ).y - nxy( vUv - vec2( 0.0, h ), lod ).y;
    // diagonals make it isotropic
    vec2 a = nxy( vUv + vec2( h, h ) * 0.7071, lod ), b = nxy( vUv - vec2( h, h ) * 0.7071, lod );
    vec2 c = nxy( vUv + vec2( h, - h ) * 0.7071, lod ), d = nxy( vUv - vec2( h, - h ) * 0.7071, lod );
    float dd = ( ( a.x + a.y ) - ( b.x + b.y ) + ( c.x - c.y ) - ( d.x - d.y ) ) * 0.7071;
    return 0.5 * ( dx + dy + dd ) / ( 2.0 * h );
  }
  void main() {
    // divergence in units of its 98th percentile over the grooves of the baked maps
    // (measured on the sculpt-baked maps of the realistic bodies, mean of F / M: 19.5, 12.3,
    // 3.7, 1.0 per UV unit at radii 3, 5, 12, 24 texels of a 1024 map — the broad muscle
    // forms are in the geometry, so the broad scales of the maps are weak; radius 3 at the
    // finest: below it the 8-bit steps of the map show as ladders)
    float sc = srcSize / 1024.0;
    float d1 = div( 3.0 * sc ) / 19.5, d2 = div( 5.0 * sc ) / 12.3, d3 = div( 12.0 * sc ) / 3.7, d4 = div( 24.0 * sc ) / 1.0;
    // band-pass: narrow grooves only. A broad bowl (scapular fossa, lower back) curves the
    // same at every radius and is cancelled by the broad term; it would read as a stain.
    float cav = ( 0.6 * max( 0.0, - d1 ) + max( 0.0, - d2 ) - 0.9 * max( 0.0, - d3 ) ) / 1.1;
    float cvx = ( max( 0.0, d2 ) + max( 0.0, d3 ) ) / 2.0;
    float groove = ( max( 0.0, - d2 ) + max( 0.0, - d3 ) + 0.5 * max( 0.0, - d4 ) ) / 2.5;
    // fade out near the seams (the mip levels there mix in the map's flat background)
    float fs = 1.0, fl = 1.0;
    if ( useMask > 0.5 ) {
      fs = smoothstep( 0.9, 1.0, textureLod( tMask, vUv, 2.5 ).r );
      fl = smoothstep( 0.9, 1.0, textureLod( tMask, vUv, 4.0 ).r );
    }
    gl_FragColor = vec4( clamp( cav, 0.0, 1.0 ) * fs, clamp( cvx, 0.0, 1.0 ) * fs, clamp( groove, 0.0, 1.0 ) * fl, 1.0 );
  }`;

// pass 2: centre lines of the grooves (Newton step to the maximum of the smooth groove
// field across the groove; only elongated grooves, not round dimples)
const lineFrag = /* glsl */`
  uniform sampler2D tC;
  uniform float size;
  varying vec2 vUv;
  float c( vec2 o ) { return texture2D( tC, vUv + o / size ).b; }
  void main() {
    vec4 c0 = texture2D( tC, vUv );
    const float h = 3.0;
    float cc = c0.b;
    float cxp = c( vec2( h, 0.0 ) ), cxm = c( vec2( - h, 0.0 ) ), cyp = c( vec2( 0.0, h ) ), cym = c( vec2( 0.0, - h ) );
    float cpp = c( vec2( h, h ) ), cpm = c( vec2( h, - h ) ), cmp = c( vec2( - h, h ) ), cmm = c( vec2( - h, - h ) );
    vec2 g = vec2( cxp - cxm, cyp - cym ) / ( 2.0 * h );
    float hxx = ( cxp - 2.0 * cc + cxm ) / ( h * h );
    float hyy = ( cyp - 2.0 * cc + cym ) / ( h * h );
    float hxy = ( cpp - cpm - cmp + cmm ) / ( 4.0 * h * h );
    // eigenvalues of the Hessian; e = direction across the groove (most negative curvature)
    float tr = 0.5 * ( hxx + hyy );
    float disc = sqrt( max( 0.0, 0.25 * ( hxx - hyy ) * ( hxx - hyy ) + hxy * hxy ) );
    float lam = tr - disc, lam2 = tr + disc;
    vec2 e = abs( hxy ) > 1e-8 ? normalize( vec2( lam - hyy, hxy ) ) : ( hxx < hyy ? vec2( 1.0, 0.0 ) : vec2( 0.0, 1.0 ) );
    float dist = 8.0, peak = 0.0;
    if ( lam < - 1e-5 ) {
      float ge = dot( g, e );
      float t = - ge / lam;              // texels to the centre line
      dist = min( abs( t ), 8.0 );
      peak = cc + 0.5 * ge * t;          // groove value at the centre line
      peak *= smoothstep( 0.0004, 0.0022, - lam );                              // a real valley
      peak *= smoothstep( 0.2, 0.55, ( - lam - max( lam2, 0.0 ) ) / - lam );   // elongated
    }
    gl_FragColor = vec4( c0.r, c0.g, dist / 8.0, clamp( peak, 0.0, 1.0 ) );
  }`;

/** shader sources, exported for calibration tests */
export const ANATOMY_GLSL = { vert, cavityFrag, lineFrag };

const _cache = new WeakMap();

const maskVert = /* glsl */`
  void main() { gl_Position = vec4( position.xy * 2.0 - 1.0, 0.0, 1.0 ); }`;
const maskFrag = /* glsl */`void main() { gl_FragColor = vec4( 1.0 ); }`;

/**
 * Coverage of the body skin's UV islands (1 inside), rasterised from the human
 * model (body group faces, render-vertex UVs), mipmapped. Built once per model.
 */
export function uvIslandMask(renderer, model, size = 1024) {
  if (!renderer || !model?.rvUV || !model.faceRV) return null;
  if (model._pvUvMask && !model._pvUvMask.lost) return model._pvUvMask.texture;
  const NR = model.renderVertexCount, uv = model.rvUV;
  const pos = new Float32Array(NR * 3);
  for (let r = 0; r < NR; r++) { pos[r * 3] = uv[r * 2]; pos[r * 3 + 1] = uv[r * 2 + 1]; }
  const idx = [];
  for (const f of model.groupFaces[0]) {
    const a = model.faceRV[f * 4], b = model.faceRV[f * 4 + 1], c = model.faceRV[f * 4 + 2], d = model.faceRV[f * 4 + 3];
    idx.push(a, b, c); if (d !== 0xffff) idx.push(a, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({ vertexShader: maskVert, fragmentShader: maskFrag, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false });
  rt.texture.name = 'pv:uvmask';
  const prev = renderer.getRenderTarget(), prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  try {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
    renderer.render(scene, cam);
  } finally {
    renderer.setRenderTarget(prev); renderer.setClearColor(prevColor, prevAlpha);
    geo.dispose(); mat.dispose();
  }
  model._pvUvMask = { texture: rt.texture, target: rt, lost: false };
  return rt.texture;
}

/** Forgets the UV mask of a model (GPU content lost). */
export function invalidateUvMask(model) {
  const e = model?._pvUvMask;
  if (e) { try { e.target.dispose(); } catch { /* lost context */ } model._pvUvMask = null; }
}

/**
 * Anatomy texture (see header) for a skin normal map, built on first request
 * with `renderer`. Returns null while the normal map image is not loaded.
 */
export function anatomyTexture(renderer, normalTex, uvMask = null) {
  if (!renderer || !normalTex) return null;
  const hit = _cache.get(normalTex);
  if (hit && !hit.lost) return hit.texture;
  const img = normalTex.image;
  if (!img || !img.width) return null;
  const N = Math.min(1024, img.width);
  const opts = { type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
  // the groove field is differentiated twice: keep it in a float target when renderable
  const ext = renderer.extensions;
  const fl = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
  const rt1 = new THREE.WebGLRenderTarget(N, N, { ...opts, type: fl ? THREE.HalfFloatType : THREE.UnsignedByteType });
  const rt2 = new THREE.WebGLRenderTarget(N, N, { ...opts, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  rt2.texture.name = 'pv:anatomy';
  rt2.texture.colorSpace = THREE.NoColorSpace;
  const m1 = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: cavityFrag, uniforms: { tN: { value: normalTex }, srcSize: { value: img.width }, tMask: { value: uvMask }, useMask: { value: uvMask ? 1 : 0 } }, depthTest: false, depthWrite: false });
  const m2 = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: lineFrag, uniforms: { tC: { value: rt1.texture }, size: { value: N } }, depthTest: false, depthWrite: false });
  const quad = new FullScreenQuad(m1);
  const prevTarget = renderer.getRenderTarget();
  const prevXr = renderer.xr?.enabled;
  if (renderer.xr) renderer.xr.enabled = false;
  const t0 = performance.now();
  try {
    renderer.setRenderTarget(rt1); quad.render(renderer);
    quad.material = m2;
    renderer.setRenderTarget(rt2); quad.render(renderer);
  } finally {
    renderer.setRenderTarget(prevTarget);
    if (renderer.xr) renderer.xr.enabled = prevXr;
    quad.dispose(); m1.dispose(); m2.dispose(); rt1.dispose();
  }
  const entry = { texture: rt2.texture, target: rt2, ms: performance.now() - t0, lost: false };
  _cache.set(normalTex, entry);
  anatomyTexture.stats.push({ size: N, ms: +entry.ms.toFixed(2) });
  anatomyTexture.last = rt2; // debugging / tests (read back with renderer.readRenderTargetPixels)
  return rt2.texture;
}
anatomyTexture.stats = [];

/** After a WebGL context loss the GPU-made maps are gone: forget them (rebuilt on demand). */
export function invalidateAnatomy(normalTex) {
  const e = normalTex && _cache.get(normalTex);
  if (e) { e.lost = true; try { e.target.dispose(); } catch { /* lost context */ } _cache.delete(normalTex); }
}
