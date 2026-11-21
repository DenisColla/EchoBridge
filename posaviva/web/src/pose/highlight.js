// Selection feedback: a semi-transparent glow over the skin weighted to the
// selected control's bones. Two SkinnedMeshes share the character's body
// attributes (position/normal/skin) and the skeleton, plus a per-vertex
// highlight weight; only faces touching highlighted vertices are drawn.
//   - "front" pass: depth tested, slightly inflated along the normal (sits on
//     the skin and above tight garments)
//   - "x-ray" pass: no depth test, faint (shows the part through clothes or
//     other limbs)
// Both meshes are UI helpers (not tracked by the material library): the render
// pipeline draws them above the ink and leaves them out of exported images.
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
    if ( vHi < 0.02 ) discard;
    float a = uOpacity * smoothstep( 0.02, 0.6, vHi ) * ( 0.45 + 0.9 * vRim * vRim );
    gl_FragColor = vec4( mix( uColor, vec3( 1.0 ), 0.25 * vRim ), clamp( a, 0.0, 1.0 ) );
  }`;

const FRONT_OPACITY = 0.4, XRAY_OPACITY = 0.13;

function makeMaterial(opts) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(opts.color) },
      uOpacity: { value: opts.opacity },
      uInflate: { value: opts.inflate },
    },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: opts.depthTest,
    side: THREE.FrontSide,
  });
  m.toneMapped = false;
  m.name = 'pv:pose-highlight';
  return m;
}

export class Highlight {
  constructor(app) {
    this.app = app;
    this.ch = null;
    this.control = null;
    this.front = makeMaterial({ color: '#8f80ff', opacity: 0.5, inflate: 0.0025, depthTest: true });
    this.xray = makeMaterial({ color: '#8f80ff', opacity: 0.16, inflate: 0.0025, depthTest: false });
    this.geo = null;
    this.meshes = [];
    this._hi = null; // Float32Array per render vertex
    this._fade = 0;
    app.addRenderHook((dt) => {
      if (this._fade >= 1 || !this.meshes.length) return false;
      this._fade = Math.min(1, this._fade + dt * 6);
      this._applyOpacity();
      return this._fade < 1;
    });
  }

  _applyOpacity() {
    const k = this._fade * this._fade * (3 - 2 * this._fade);
    this.front.uniforms.uOpacity.value = FRONT_OPACITY * k;
    this.xray.uniforms.uOpacity.value = XRAY_OPACITY * k;
  }

  /** Shows the highlight of a control (bone index list) on a character; null hides. */
  set(ch, control, boneIdx) {
    if (!ch || !control) { this._detach(); this.ch = null; this.control = null; return; }
    if (ch === this.ch && control === this.control && this.meshes.length && this.meshes[0].parent === ch.rig) return;
    if (ch !== this.ch || !this.geo) this._build(ch);
    this.ch = ch; this.control = control;
    this._weights(boneIdx);
    this._fade = 0;
    this._applyOpacity();
    this.app.invalidate();
  }

  _build(ch) {
    this._detach();
    this._disposeGeo();
    const src = ch.body.geometry;
    const g = new THREE.BufferGeometry();
    // shared attributes: no copies, kept in sync by the character
    for (const n of ['position', 'normal', 'skinIndex', 'skinWeight']) g.setAttribute(n, src.attributes[n]);
    const NR = this.app.model.renderVertexCount;
    this._hi = new Float32Array(NR);
    g.setAttribute('pvHi', new THREE.BufferAttribute(this._hi, 1).setUsage(THREE.DynamicDrawUsage));
    // one index buffer sized for every skin triangle, filled per selection (draw range)
    let tri = 0;
    for (const f of this.app.model.groupFaces[0]) tri += this.app.model.faceRV[f * 4 + 3] !== 0xffff ? 2 : 1;
    this._index = new Uint32Array(tri * 3);
    g.setIndex(new THREE.BufferAttribute(this._index, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.meshes = [this.xray, this.front].map((mat, k) => {
      const m = new THREE.SkinnedMesh(g, mat);
      m.name = k ? 'pose-highlight' : 'pose-highlight-xray';
      m.frustumCulled = false;
      m.castShadow = false; m.receiveShadow = false;
      m.renderOrder = 990 + k;
      m.userData.isHelper = true;
      m.raycast = () => {}; // never pickable
      m.bind(ch.skeleton, new THREE.Matrix4());
      ch.rig.add(m);
      return m;
    });
  }

  /** Per-vertex weight = sum of skin weights on the control's bones; index = faces touching it. */
  _weights(boneIdx) {
    const m = this.app.model, hi = this._hi;
    const set = new Uint8Array(m.bones.length);
    for (const i of boneIdx) set[i] = 1;
    const vHi = new Float32Array(m.vertexCount);
    for (const v of m.groupVertices[0]) {
      let s = 0;
      for (let k = 0; k < 4; k++) { const w = m.skinWeight[v * 4 + k]; if (w && set[m.skinIndex[v * 4 + k]]) s += w; }
      vHi[v] = s;
    }
    for (let r = 0; r < hi.length; r++) hi[r] = vHi[m.rv2v[r]];
    const idx = this._index;
    let n = 0;
    for (const f of m.groupFaces[0]) {
      const a = m.faceRV[f * 4], b = m.faceRV[f * 4 + 1], c = m.faceRV[f * 4 + 2], d = m.faceRV[f * 4 + 3];
      const q = d !== 0xffff;
      if (hi[a] < 0.02 && hi[b] < 0.02 && hi[c] < 0.02 && (!q || hi[d] < 0.02)) continue;
      idx[n++] = a; idx[n++] = b; idx[n++] = c;
      if (q) { idx[n++] = a; idx[n++] = c; idx[n++] = d; }
    }
    const g = this.geo;
    g.setDrawRange(0, n);
    g.index.needsUpdate = true;
    g.attributes.pvHi.needsUpdate = true;
  }

  _detach() { for (const m of this.meshes) m.removeFromParent(); }

  _disposeGeo() {
    if (!this.geo) return;
    // remove the shared attributes first: disposing must not free the body's GPU buffers
    for (const n of ['position', 'normal', 'skinIndex', 'skinWeight']) this.geo.deleteAttribute(n);
    this.geo.dispose();
    this.geo = null;
    this.meshes = [];
  }

  /** Called when a character is removed. */
  forget(ch) {
    if (this.ch !== ch) return;
    this._detach();
    this._disposeGeo();
    this.ch = null; this.control = null;
  }

  setVisible(on) { for (const m of this.meshes) m.visible = on; }
}
