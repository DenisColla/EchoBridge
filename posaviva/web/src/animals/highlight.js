// Selection glow over the selected body part of an animal: a SkinnedMesh
// sharing the animal's attributes and skeleton plus a per-vertex weight of
// the part's bones; faces without highlighted vertices are discarded. Not a
// library material: the render pipeline treats it as a UI helper (drawn above
// the ink, never exported).
import * as THREE from 'three';

const VERT = /* glsl */`
  #include <common>
  #include <skinning_pars_vertex>
  attribute float pvHi;
  uniform float uInflate;
  varying float vHi;
  varying float vRim;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec3 n = normalize( objectNormal );
    transformed += n * uInflate * pvHi;
    vec4 mv = modelViewMatrix * vec4( transformed, 1.0 );
    vec3 vn = normalize( normalMatrix * n );
    vRim = 1.0 - abs( dot( vn, normalize( -mv.xyz ) ) );
    vHi = pvHi;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vHi;
  varying float vRim;
  void main() {
    if ( vHi < 0.03 ) discard;
    float a = uOpacity * smoothstep( 0.03, 0.6, vHi ) * ( 0.45 + 0.9 * vRim * vRim );
    gl_FragColor = vec4( mix( uColor, vec3( 1.0 ), 0.25 * vRim ), clamp( a, 0.0, 1.0 ) );
  }`;

function mat(opacity, depthTest) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#8f80ff') }, uOpacity: { value: opacity }, uInflate: { value: 0.002 } },
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest,
  });
  m.toneMapped = false;
  m.name = 'pv:animal-highlight';
  return m;
}

export class AnimalHighlight {
  constructor(app) {
    this.app = app;
    this.front = mat(0.5, true);
    this.xray = mat(0.15, false);
    this.meshes = [];
    this.animal = null;
    this.key = '';
  }

  /** Shows the bones of a control on an animal (null clears). */
  show(animal, ctrl) {
    const key = animal && ctrl ? animal.id + ':' + ctrl.id : '';
    if (key === this.key && (!animal || this.animal === animal)) return;
    this.clear();
    this.key = key;
    if (!animal || !ctrl) return;
    this.animal = animal;
    const d = animal.data;
    const want = new Set((ctrl.all || ctrl.bones).map((n) => animal.boneIndex.get(n)));
    const hi = new Float32Array(d.count);
    for (let v = 0; v < d.count; v++) {
      let s = 0;
      for (let k = 0; k < 4; k++) if (want.has(d.skin[v * 4 + k])) s += d.weight[v * 4 + k] / 255;
      hi[v] = s;
    }
    // only faces touching the part
    const I = d.index.array, idx = [];
    for (let t = 0; t < I.length; t += 3) if (hi[I[t]] > 0.03 || hi[I[t + 1]] > 0.03 || hi[I[t + 2]] > 0.03) idx.push(I[t], I[t + 1], I[t + 2]);
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'skinIndex', 'skinWeight']) g.setAttribute(k, d.attrs[k]);
    g.setAttribute('pvHi', new THREE.BufferAttribute(hi, 1));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e3);
    for (const m of [this.xray, this.front]) {
      const mesh = new THREE.SkinnedMesh(g, m);
      mesh.bind(animal.skeleton, new THREE.Matrix4());
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      mesh.userData.isHelper = true; mesh.userData.pickable = false;
      animal.rig.add(mesh);
      this.meshes.push(mesh);
    }
    this.app.invalidate();
  }

  clear() {
    if (this.meshes.length) {
      this.meshes[0].geometry.dispose();
      for (const m of this.meshes) m.removeFromParent();
      this.meshes = [];
      this.app.invalidate();
    }
    this.animal = null;
    this.key = '';
  }
}
