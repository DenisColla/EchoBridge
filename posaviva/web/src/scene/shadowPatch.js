// Smoother PCF kernel for three.js shadows.
//
// three r18x's PCF samples 5 Vogel-disk taps rotated per pixel by
// interleaved-gradient noise: cheap, but soft edges show a visible dither
// pattern (there is no TAA here to resolve it). We replace it with a regular
// 4×4 grid (16 hardware-bilinear PCF taps, 3×3 for point lights). The light
// rig keeps the kernel radius around ≤2 texels by lowering the shadow-map
// resolution for soft shadows, so the grid stays noise- and banding-free.
//
// The patch edits THREE.ShaderChunk once at startup; materials compiled before
// that (only the ground at that point) are disposed so they recompile.
import * as THREE from 'three';

const GRID_2D = `vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				// PosaViva: regular 4x4 PCF grid, outer taps at +-radius
				vec2 pvStep = shadowRadius * texelSize / 1.5;
				shadow = 0.0;
				for ( int i = 0; i < 4; i ++ ) {
					for ( int j = 0; j < 4; j ++ ) {
						vec2 o = vec2( float( i ) - 1.5, float( j ) - 1.5 ) * pvStep;
						shadow += texture( shadowMap, vec3( shadowCoord.xy + o, shadowCoord.z ) );
					}
				}
				shadow *= 0.0625;`;

const GRID_POINT = `shadow = 0.0;
			// PosaViva: regular 3x3 PCF grid in the tangent plane
			for ( int i = 0; i < 3; i ++ ) {
				for ( int j = 0; j < 3; j ++ ) {
					vec2 offset = vec2( float( i ) - 1.0, float( j ) - 1.0 );
					vec3 direction = bd3D + ( tangent * offset.x + bitangent * offset.y ) * texelSize;
					vec3 absDirection = abs( direction );
					float dp = depthA + depthB / max( max( absDirection.x, absDirection.y ), absDirection.z );
					shadow += texture( shadowMap, vec4( direction, dp ) );
				}
			}
			shadow *= ( 1.0 / 9.0 );`;

let patched = null;

/** Applies the patch (idempotent). Returns true when the kernel is in use. */
export function patchShadowKernel(app) {
  if (patched !== null) return patched;
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  const re2d = /vec2 texelSize = vec2\( 1\.0 \) \/ shadowMapSize;[\s\S]*?\) \* 0\.2;/;
  const rePoint = /float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;\s*shadow = 0\.0;\s*for \( int i = 0; i < 5; i \+\+ \) \{[\s\S]*?shadow \*= 0\.2;/;
  const m2 = src.match(re2d), mp = src.match(rePoint);
  // only patch the exact code we know (a different three.js keeps its own kernel)
  if (!m2 || !m2[0].includes('vogelDiskSample( 4, 5, phi )') || !mp) { patched = false; return false; }
  THREE.ShaderChunk.shadowmap_pars_fragment = src.replace(re2d, GRID_2D).replace(rePoint, GRID_POINT);
  // force recompilation of programs built with the original chunk
  app.scene.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
  });
  patched = true;
  return true;
}

/** Max PCF radius (texels) that the grid kernel renders without banding. */
export const MAX_RADIUS_2D = 2.2;
export const MAX_RADIUS_POINT = 1.4;
