// Precipitation: rain streaks (vertical quads turned towards the camera in the
// vertex shader) and snow flakes (points), frozen in time like a photo — the
// renderer draws on demand, a still reference does not need animation. They are
// UI-layer meshes for the render pipeline (drawn above the ink) but exported in
// captures (userData.export = true).
import * as THREE from 'three';
import { makeRng } from '../rand.js';

const RAIN_VS = /* glsl */`
  attribute vec3 base;   // streak centre (world)
  attribute vec2 corner; // (-1|1, -1|1)
  attribute float len;
  uniform float uWidth;
  varying float vA;
  void main() {
    vec3 toCam = cameraPosition - base;
    vec3 side = normalize( cross( vec3( 0.0, 1.0, 0.0 ), toCam ) );
    float d = length( toCam );
    // keep streaks at least ~1 px wide far away, thinner up close
    float w = uWidth * max( 1.0, d * 0.06 ) * step( 1.2, d ); // streaks right at the camera: degenerate (no overdraw)
    vec3 p = base + side * corner.x * w + vec3( 0.12, 1.0, 0.04 ) * corner.y * len * 0.5;
    vA = smoothstep( 1.0, 4.0, d ) * ( 1.0 - smoothstep( 45.0, 70.0, d ) ) * ( 0.55 + 0.45 * corner.y );
    gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
  }
`;
const SNOW_VS = /* glsl */`
  uniform float uSize, uScale;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    float d = -mv.z;
    // world-size flakes, clamped on screen (no huge sprites in front of the lens)
    gl_PointSize = clamp( uSize * uScale / max( d, 0.01 ), 1.5, 7.0 ) * step( 0.8, d );
    vA = smoothstep( 0.8, 3.0, d ) * ( 1.0 - smoothstep( 40.0, 60.0, d ) );
    gl_Position = projectionMatrix * mv;
  }
`;
const SNOW_FS = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep( 0.5, 0.15, length( c ) ) * vA * uOpacity;
    if ( a < 0.02 ) discard;
    gl_FragColor = vec4( uColor, a );
    #include <colorspace_fragment>
  }
`;

const RAIN_FS = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main() {
    gl_FragColor = vec4( uColor, uOpacity * vA );
    #include <colorspace_fragment>
  }
`;

export class Precipitation {
  constructor() { this.obj = null; }

  /** kind: 'rain' | 'snow'; center: world {x, z}; seed. */
  build(kind, center, seed, { density = 1 } = {}) {
    this.dispose();
    const rnd = makeRng(seed ^ 0x5151);
    if (kind === 'rain') {
      const N = Math.round(9000 * density);
      const base = new Float32Array(N * 4 * 3), corner = new Float32Array(N * 4 * 2), len = new Float32Array(N * 4);
      const idx = new Uint32Array(N * 6);
      for (let i = 0; i < N; i++) {
        // denser near the stage, sparser far
        const r = Math.pow(rnd(), 0.75) * 60, a = rnd() * Math.PI * 2;
        const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r, y = rnd() * 22;
        const L = 0.35 + rnd() * 0.45;
        for (let k = 0; k < 4; k++) {
          const v = i * 4 + k;
          base[v * 3] = x; base[v * 3 + 1] = y; base[v * 3 + 2] = z;
          corner[v * 2] = k & 1 ? 1 : -1; corner[v * 2 + 1] = k & 2 ? 1 : -1;
          len[v] = L;
        }
        idx.set([i * 4, i * 4 + 1, i * 4 + 3, i * 4, i * 4 + 3, i * 4 + 2], i * 6);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3)); // for bounds only
      geo.setAttribute('base', new THREE.BufferAttribute(base, 3));
      geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
      geo.setAttribute('len', new THREE.BufferAttribute(len, 1));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color('#c9d3de') }, uOpacity: { value: 0.42 }, uWidth: { value: 0.0045 } },
        vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.obj = mesh;
    } else {
      const N = Math.round(12000 * density);
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const r = Math.pow(rnd(), 0.8) * 45, a = rnd() * Math.PI * 2;
        pos[i * 3] = center.x + Math.cos(a) * r; pos[i * 3 + 1] = rnd() * 18; pos[i * 3 + 2] = center.z + Math.sin(a) * r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color('#ffffff') }, uOpacity: { value: 0.95 }, uSize: { value: 0.07 }, uScale: { value: 600 } },
        vertexShader: SNOW_VS, fragmentShader: SNOW_FS, transparent: true, depthWrite: false, fog: false,
      });
      const pts = new THREE.Points(geo, mat);
      // pixel scale follows the drawing buffer height (screen and captures)
      pts.onBeforeRender = (renderer) => { const t = renderer.getRenderTarget(); mat.uniforms.uScale.value = 0.5 * (t ? t.height : renderer.domElement.height); };
      pts.frustumCulled = false;
      this.obj = pts;
    }
    this.obj.name = `landscape:${kind}`;
    this.obj.userData.export = true;       // visible in exported images
    this.obj.userData.landscape = kind;
    this.obj.raycast = () => {};
    this.kind = kind;
    return this.obj;
  }

  /** Night / dusk: dimmer streaks; 'lines' style: grey ink-like strokes. */
  setLook({ night = false, style = 'realistic' } = {}) {
    if (!this.obj) return;
    const m = this.obj.material;
    if (this.kind === 'rain') {
      m.uniforms.uColor.value.set(style === 'lines' ? '#6d737a' : night ? '#7d8aa3' : '#c9d3de');
      m.uniforms.uOpacity.value = style === 'lines' ? 0.5 : night ? 0.35 : 0.42;
    } else {
      m.uniforms.uColor.value.set(style === 'lines' ? '#9aa1a9' : night ? '#c3cbe0' : '#ffffff');
    }
  }

  dispose() {
    if (!this.obj) return;
    this.obj.geometry.dispose(); this.obj.material.dispose(); this.obj.removeFromParent();
    this.obj = null;
  }
}
