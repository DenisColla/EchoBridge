// "Deformazione morbida": dual-quaternion skinning (DQS) on the GPU.
//
// three.js skins with linear blend skinning (LBS): the bone matrices of a
// vertex are averaged, and the average of two rotations is not a rotation.
// Where two bones twist or bend a lot against each other the skin collapses
// (the "candy wrapper" at forearm pronation and wrist twists, thin elbows,
// pinched shoulders and hips). DQS blends the bones as unit dual quaternions
// instead: the blend of rigid motions stays a rigid motion, so the volume of
// the limb is kept and joints bend round, with a slight bulge on the outside
// of strong bends (a fleshy look, not rubber).
//
// How it is wired (no per-frame CPU work, no texture layout change, works with
// ANY THREE.Skeleton, including the garments' own skeletons with frozen bind
// inverses):
//  - the vertex shader converts the 4 bone matrices it already fetches from the
//    skeleton's bone texture into dual quaternions (uniform scale of the
//    character placement removed and blended separately), blends them with
//    antipodality correction and skins position, normal and tangent with the
//    result;
//  - the code is injected with onBeforeCompile into every material of the
//    material library, the G-buffer prepass materials of the pipeline (ink
//    lines / AO follow the same surface) and the shadow depth / distance
//    materials three.js uses for skinned meshes (via SkinnedMesh.onBeforeShadow),
//    guarded by `#ifdef USE_SKINNING` + `#ifdef PV_DQS`;
//  - the toggle flips the PV_DQS define (part of the program cache key) on every
//    registered material: one recompile, no other cost.
// Fallback: devices without highp vertex floats or vertex texture fetch keep
// linear blending (the define is never set).
//
// Cost: CPU 0 per frame (no JS work; toggling recompiles the skinned programs
// once, asynchronously where KHR_parallel_shader_compile exists). GPU: per skinned
// vertex per pass 4 matrix->dual-quaternion conversions + blend (~200 ALU ops
// more than linear blending, NO extra texture fetches: the 16 bone-texture reads
// are the same). With 3 dressed characters (353k skinned vertices) the difference
// was below the measurement noise even on a CPU rasteriser (SwiftShader, vertex
// bound 64x64 pass: best frame 272 ms DQS vs 310 ms LBS); estimated < 0.2 ms per
// frame on an Adreno 830 with 5 passes (colour, G-buffer, 3 shadow maps).
import * as THREE from 'three';

const PARS = /* glsl */`
#include <skinning_pars_vertex>
#if defined( USE_SKINNING ) && defined( PV_DQS )
	// rigid part of a bone matrix as a unit dual quaternion (real r, dual d);
	// s = its uniform scale (character placement scale), blended separately
	void pvBoneDQ( const in mat4 m, out vec4 r, out vec4 d, out float s ) {
		s = length( m[ 0 ].xyz );
		if ( s < 1e-6 ) { r = vec4( 0.0, 0.0, 0.0, 1.0 ); d = vec4( 0.0 ); return; } // collapsed bone
		float is = 1.0 / s;
		vec3 c0 = m[ 0 ].xyz * is, c1 = m[ 1 ].xyz * is, c2 = m[ 2 ].xyz * is;
		float tr = c0.x + c1.y + c2.z;
		if ( tr > 0.0 ) {
			float k = 0.5 / sqrt( tr + 1.0 );
			r = vec4( ( c1.z - c2.y ) * k, ( c2.x - c0.z ) * k, ( c0.y - c1.x ) * k, 0.25 / k );
		} else if ( c0.x > c1.y && c0.x > c2.z ) {
			float k = 2.0 * sqrt( 1.0 + c0.x - c1.y - c2.z );
			r = vec4( 0.25 * k, ( c1.x + c0.y ) / k, ( c2.x + c0.z ) / k, ( c1.z - c2.y ) / k );
		} else if ( c1.y > c2.z ) {
			float k = 2.0 * sqrt( 1.0 + c1.y - c0.x - c2.z );
			r = vec4( ( c1.x + c0.y ) / k, 0.25 * k, ( c2.y + c1.z ) / k, ( c2.x - c0.z ) / k );
		} else {
			float k = 2.0 * sqrt( 1.0 + c2.z - c0.x - c1.y );
			r = vec4( ( c2.x + c0.z ) / k, ( c2.y + c1.z ) / k, 0.25 * k, ( c0.y - c1.x ) / k );
		}
		r = normalize( r );
		vec3 t = m[ 3 ].xyz * is;
		d = 0.5 * vec4( t * r.w + cross( t, r.xyz ), - dot( t, r.xyz ) );
	}
	void pvAddDQ( const in mat4 m, const in float w, const in vec4 ref, inout vec4 br, inout vec4 bd, inout float bs ) {
		vec4 r, d; float s;
		pvBoneDQ( m, r, d, s );
		float k = dot( r, ref ) < 0.0 ? - w : w; // shortest path (q and -q are the same rotation)
		br += k * r; bd += k * d; bs += w * s;
	}
	vec3 pvDQRotate( const in vec4 r, const in vec3 v ) {
		return v + 2.0 * cross( r.xyz, cross( r.xyz, v ) + r.w * v );
	}
#endif
`;

const BASE = /* glsl */`
#include <skinbase_vertex>
#if defined( USE_SKINNING ) && defined( PV_DQS )
	vec4 pvDqR = vec4( 0.0 ), pvDqD = vec4( 0.0 );
	float pvDqS = 0.0;
	{
		vec4 r0, d0; float s0;
		pvBoneDQ( boneMatX, r0, d0, s0 );
		pvDqR = skinWeight.x * r0; pvDqD = skinWeight.x * d0; pvDqS = skinWeight.x * s0;
		if ( skinWeight.y > 0.0 ) pvAddDQ( boneMatY, skinWeight.y, r0, pvDqR, pvDqD, pvDqS );
		if ( skinWeight.z > 0.0 ) pvAddDQ( boneMatZ, skinWeight.z, r0, pvDqR, pvDqD, pvDqS );
		if ( skinWeight.w > 0.0 ) pvAddDQ( boneMatW, skinWeight.w, r0, pvDqR, pvDqD, pvDqS );
		float pvL = length( pvDqR );
		float pvWs = skinWeight.x + skinWeight.y + skinWeight.z + skinWeight.w;
		if ( pvL > 1e-6 ) { pvDqR /= pvL; pvDqD /= pvL; pvDqS /= max( pvWs, 1e-6 ); }
		else { pvDqR = r0; pvDqD = d0; pvDqS = s0; }
	}
#endif
`;

const SKIN_POS = /* glsl */`
#if defined( USE_SKINNING ) && defined( PV_DQS )
	{
		vec3 pvP = ( bindMatrix * vec4( transformed, 1.0 ) ).xyz;
		pvP = pvDQRotate( pvDqR, pvP ) + 2.0 * ( pvDqR.w * pvDqD.xyz - pvDqD.w * pvDqR.xyz + cross( pvDqR.xyz, pvDqD.xyz ) );
		transformed = ( bindMatrixInverse * vec4( pvP * pvDqS, 1.0 ) ).xyz;
	}
#else
#include <skinning_vertex>
#endif
`;

const SKIN_NOR = /* glsl */`
#if defined( USE_SKINNING ) && defined( PV_DQS )
	objectNormal = ( bindMatrixInverse * vec4( pvDQRotate( pvDqR, ( bindMatrix * vec4( objectNormal, 0.0 ) ).xyz ) * pvDqS, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = ( bindMatrixInverse * vec4( pvDQRotate( pvDqR, ( bindMatrix * vec4( objectTangent, 0.0 ) ).xyz ) * pvDqS, 0.0 ) ).xyz;
	#endif
#else
#include <skinnormal_vertex>
#endif
`;

const _warned = new Set();
function rep(src, find, repl) {
  if (!src.includes(find)) {
    if (!_warned.has(find)) { _warned.add(find); console.warn(`[render] soft skinning: "${find}" not found (three.js chunk changed?)`); }
    return src;
  }
  return src.replace(find, repl);
}

/** Injects the DQS code into a vertex shader source (idempotent; active only with PV_DQS). */
export function injectSoftSkin(vs) {
  if (vs.includes('pvBoneDQ') || !vs.includes('#include <skinbase_vertex>')) return vs;
  vs = rep(vs, '#include <skinning_pars_vertex>', PARS);
  vs = rep(vs, '#include <skinbase_vertex>', BASE);
  vs = rep(vs, '#include <skinning_vertex>', SKIN_POS);
  // depth / distance shaders only skin normals with a displacement map
  if (vs.includes('#include <skinnormal_vertex>')) vs = vs.replace('#include <skinnormal_vertex>', SKIN_NOR);
  return vs;
}

class SoftSkin extends THREE.EventDispatcher {
  constructor() {
    super();
    this._on = true;
    /** false when the device cannot run it (set by checkSupport) */
    this.supported = true;
    /** materials carrying the injection (PV_DQS toggles on them) */
    this._mats = new Set();
    this._patched = new WeakSet();
    this._onDispose = (e) => { this._mats.delete(e.target); e.target.removeEventListener('dispose', this._onDispose); };
  }

  /** true when DQS is requested and supported */
  get active() { return this._on && this.supported; }
  get enabled() { return this._on; }

  /**
   * Device check: highp floats and texture fetch in the vertex shader (the bone
   * texture is a float texture; WebGL 2 always samples float textures).
   */
  checkSupport(renderer) {
    try {
      const gl = renderer.getContext();
      const caps = renderer.capabilities;
      const hp = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT);
      const floatTex = caps.isWebGL2 !== false || !!renderer.extensions.has('OES_texture_float');
      this.supported = !!(hp && hp.precision >= 23 && caps.maxVertexTextures > 0 && floatTex);
    } catch { this.supported = false; }
    if (!this.supported) this._sync();
    return this.supported;
  }

  /**
   * Registers a material: `hookInstalled` = the caller already injects the code
   * in its own onBeforeCompile (library hooks, prepass); otherwise the existing
   * onBeforeCompile is chained.
   */
  register(material, hookInstalled = false) {
    if (!material || this._patched.has(material)) return material;
    this._patched.add(material);
    if (!hookInstalled) {
      const prev = material.onBeforeCompile;
      material.onBeforeCompile = function (shader, renderer) {
        if (prev) prev.call(this, shader, renderer);
        shader.vertexShader = injectSoftSkin(shader.vertexShader);
      };
      // the default cache key is onBeforeCompile.toString(): make it explicit and stable
      const prevKey = material.customProgramCacheKey;
      const own = Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey');
      material.customProgramCacheKey = own ? () => prevKey.call(material) + '+pv-dq' : () => 'pv-dq';
    }
    this._mats.add(material);
    material.addEventListener('dispose', this._onDispose);
    this._apply(material);
    return material;
  }

  _apply(m) {
    const want = this.active;
    const has = !!(m.defines && 'PV_DQS' in m.defines);
    if (want === has) return false;
    if (want) m.defines = { ...(m.defines || {}), PV_DQS: '' };
    else { const d = { ...m.defines }; delete d.PV_DQS; m.defines = d; }
    m.needsUpdate = true;
    return true;
  }

  _sync() {
    let n = 0;
    for (const m of this._mats) if (this._apply(m)) n++;
    return n;
  }

  /** Turns DQS on/off for every registered material. Returns the number of materials recompiled. */
  setEnabled(on) {
    on = !!on;
    if (on === this._on) return 0;
    this._on = on;
    const n = this._sync();
    this.dispatchEvent({ type: 'change', enabled: on, active: this.active });
    return n;
  }
}

export const softSkin = new SoftSkin();

// Shadows: three.js renders skinned shadow casters with its own internal depth /
// distance materials (and per-material clones for alpha-tested maps). They reach
// us right before each shadow draw: register them the first time we see them.
if (!Object.prototype.hasOwnProperty.call(THREE.SkinnedMesh.prototype, 'onBeforeShadow')) {
  THREE.SkinnedMesh.prototype.onBeforeShadow = function (renderer, object, camera, shadowCamera, geometry, depthMaterial) {
    if (depthMaterial && !softSkin._patched.has(depthMaterial)) softSkin.register(depthMaterial);
  };
}

// ---------------------------------------------------------------- CPU twin
const _r = new Float64Array(4), _d = new Float64Array(4);
/** Same conversion as pvBoneDQ (column-major 4x4 at M[o..o+15]); writes _r, _d, returns the scale. */
function boneDQ(M, o) {
  const s = Math.hypot(M[o], M[o + 1], M[o + 2]);
  if (s < 1e-6) { _r[0] = _r[1] = _r[2] = 0; _r[3] = 1; _d.fill(0); return 0; } // collapsed bone
  const is = 1 / s;
  const m00 = M[o] * is, m10 = M[o + 1] * is, m20 = M[o + 2] * is;
  const m01 = M[o + 4] * is, m11 = M[o + 5] * is, m21 = M[o + 6] * is;
  const m02 = M[o + 8] * is, m12 = M[o + 9] * is, m22 = M[o + 10] * is;
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const k = 0.5 / Math.sqrt(tr + 1); x = (m21 - m12) * k; y = (m02 - m20) * k; z = (m10 - m01) * k; w = 0.25 / k; }
  else if (m00 > m11 && m00 > m22) { const k = 2 * Math.sqrt(1 + m00 - m11 - m22); x = 0.25 * k; y = (m01 + m10) / k; z = (m02 + m20) / k; w = (m21 - m12) / k; }
  else if (m11 > m22) { const k = 2 * Math.sqrt(1 + m11 - m00 - m22); x = (m01 + m10) / k; y = 0.25 * k; z = (m12 + m21) / k; w = (m02 - m20) / k; }
  else { const k = 2 * Math.sqrt(1 + m22 - m00 - m11); x = (m02 + m20) / k; y = (m12 + m21) / k; z = 0.25 * k; w = (m10 - m01) / k; }
  const l = Math.hypot(x, y, z, w); x /= l; y /= l; z /= l; w /= l;
  const tx = M[o + 12] * is, ty = M[o + 13] * is, tz = M[o + 14] * is;
  _r[0] = x; _r[1] = y; _r[2] = z; _r[3] = w;
  // d = 0.5 * (t, 0) * r
  _d[0] = 0.5 * (tx * w + ty * z - tz * y);
  _d[1] = 0.5 * (ty * w + tz * x - tx * z);
  _d[2] = 0.5 * (tz * w + tx * y - ty * x);
  _d[3] = -0.5 * (tx * x + ty * y + tz * z);
  return s;
}

/**
 * CPU dual-quaternion skinning, identical to the shader (for picking, grounding
 * and bounds when soft skinning is on). Same arguments as Character.skinPositions
 * plus the skinning matrices M (Float32Array 16 per bone, e.g. ch.updateSkinMatrices()).
 */
export function skinPositionsDQ(M, rest, skinIndex, skinWeight, out, count = rest.length / 3) {
  for (let i = 0; i < count; i++) {
    let rx = 0, ry = 0, rz = 0, rw = 0, dx = 0, dy = 0, dz = 0, dw = 0, bs = 0, ws = 0;
    let ax = 0, ay = 0, az = 0, aw = 1, first = true;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight[i * 4 + k];
      if (!w && !(k === 0)) continue;
      const s = boneDQ(M, skinIndex[i * 4 + k] * 16);
      if (first) { ax = _r[0]; ay = _r[1]; az = _r[2]; aw = _r[3]; first = false; }
      const kk = _r[0] * ax + _r[1] * ay + _r[2] * az + _r[3] * aw < 0 ? -w : w;
      rx += kk * _r[0]; ry += kk * _r[1]; rz += kk * _r[2]; rw += kk * _r[3];
      dx += kk * _d[0]; dy += kk * _d[1]; dz += kk * _d[2]; dw += kk * _d[3];
      bs += w * s; ws += w;
    }
    const l = Math.hypot(rx, ry, rz, rw);
    if (l < 1e-6) { out[i * 3] = rest[i * 3]; out[i * 3 + 1] = rest[i * 3 + 1]; out[i * 3 + 2] = rest[i * 3 + 2]; continue; }
    rx /= l; ry /= l; rz /= l; rw /= l; dx /= l; dy /= l; dz /= l; dw /= l; bs /= ws || 1;
    const px = rest[i * 3], py = rest[i * 3 + 1], pz = rest[i * 3 + 2];
    // v + 2 r.xyz x (r.xyz x v + w v)
    const cx = ry * pz - rz * py + rw * px, cy = rz * px - rx * pz + rw * py, cz = rx * py - ry * px + rw * pz;
    let ox = px + 2 * (ry * cz - rz * cy), oy = py + 2 * (rz * cx - rx * cz), oz = pz + 2 * (rx * cy - ry * cx);
    ox += 2 * (rw * dx - dw * rx + (ry * dz - rz * dy));
    oy += 2 * (rw * dy - dw * ry + (rz * dx - rx * dz));
    oz += 2 * (rw * dz - dw * rz + (rx * dy - ry * dx));
    out[i * 3] = ox * bs; out[i * 3 + 1] = oy * bs; out[i * 3 + 2] = oz * bs;
  }
  return out;
}
