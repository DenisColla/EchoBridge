// Procedural eyebrows: hundreds of short tapered hair ribbons lying on the brow
// ridge, laid out from a 2D style template (centre line, thickness profile,
// hair-direction field) placed relative to the eye, projected onto the skin
// and bound barycentrically to skin triangles. Positions are re-evaluated from
// ch.restPositions / ch.restNormals, so the brows follow the eyebrow
// expression morphs, the body shape and (through the skin weights) the head.
import * as THREE from 'three';
import { rng } from './eyeTexture.js';
import { boneRestPos } from './landmarks.js';

/**
 * Styles. Keypoints [x, y, thickness] in mm for an eye of reference width
 * (x: lateral from the eyeball centre, y: up), at s = 0 (head), 1/3, 2/3 (arch), 1 (tail).
 * n: hairs per brow, len: hair length range (mm), w: hair ribbon width at the root (mm).
 */
export const BROW_STYLES = [
  { id: 'thin', label: 'Sottili', k: [[-15.5, 16.8, 3.4], [-3, 19.2, 2.8], [9.5, 20.8, 2.3], [23.5, 17.2, 0.9]], n: 360, len: [3, 4.8], w: 0.15 },
  { id: 'natural', label: 'Naturali', k: [[-17, 15.6, 7.2], [-3.5, 18.2, 6.2], [9.5, 19.8, 5.0], [25, 15.8, 1.6]], n: 520, len: [3.6, 6], w: 0.17 },
  { id: 'thick', label: 'Folte', k: [[-18, 15.0, 9.6], [-3.5, 17.6, 8.6], [9.5, 19.0, 7.2], [26, 15.4, 2.6]], n: 820, len: [4.2, 7], w: 0.19 },
  { id: 'arched', label: 'Arcuate', k: [[-16, 15.0, 6.0], [-3.5, 19.4, 5.2], [8.5, 22.6, 4.2], [24, 15.0, 1.3]], n: 450, len: [3.6, 5.8], w: 0.16 },
  { id: 'straight', label: 'Dritte', k: [[-17, 16.2, 6.8], [-3.5, 17.6, 6.4], [9.5, 18.2, 5.8], [25, 16.6, 2.0]], n: 520, len: [3.6, 6], w: 0.17 },
  { id: 'none', label: 'Nessuna', k: null },
];
export const BROW_BY_ID = new Map(BROW_STYLES.map((s) => [s.id, s]));

/** reference distance (mm) between the inner and outer end of the upper lash line */
const REF_EYE_W = 24;
/** lift of the hair control points above the skin (m) */
const LIFT = [0.0001, 0.0003, 0.00036];
const WIDTH_T = [1, 0.7, 0.15];
/** vertex colour (brightness) along a hair: darker root, lighter tip */
const SHADE_T = [0.78, 1, 1.18];
const DEG = Math.PI / 180;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Brows {
  /**
   * @param {import('../core/Character.js').Character} ch
   * @param {{browTris: Uint32Array, lashGrids: any[]}} landmarks
   */
  constructor(ch, landmarks) {
    this.ch = ch;
    this.L = landmarks;
    this.style = null;
    this.count = 0; // bound hairs
    this.mesh = null;
    this.geometry = null;
  }

  /**
   * (Re)creates the hairs for a style and binds them to the current shape.
   * Returns false if nothing is drawn (style 'none').
   */
  bind(styleId) {
    const st = BROW_BY_ID.get(styleId) || BROW_BY_ID.get('natural');
    this.style = st.id;
    if (!st.k) { this.count = 0; if (this.mesh) this.mesh.visible = false; return false; }
    const ch = this.ch, P = ch.shapePositions;
    const male = ch.sex === 'M';
    const hits = this._projector(P);
    const hairs = [];
    for (const side of [1, -1]) {
      const eye = boneRestPos(ch, side > 0 ? 'eye.L' : 'eye.R');
      const scale = this._eyeWidth(side, P) / REF_EYE_W;
      const rnd = rng(1234); // same sequence for both sides -> symmetric brows
      const K = st.k.map(([x, y, t]) => (male ? [x, y - 1.4 - (x > 5 ? 0.6 : 0), t * 1.22] : [x, y, t]));
      for (let i = 0; i < st.n; i++) {
        // sample a point in the brow area: density follows the thickness and peaks on
        // the centre line (triangular distribution across) -> soft, feathered edges
        let s, w, c, tries = 0;
        do { s = rnd(); w = rnd() + rnd() - 1; c = brow(K, s); tries++; } while (rnd() > c.t / 9 && tries < 6);
        const u = rnd(), v = rnd(), l = rnd(), tone = rnd();
        // hair direction: up at the head, lateral along the body, down at the tail;
        // upper hairs angle down and lower hairs up (they converge on the centre line)
        let ang = (s < 0.16 ? 74 - (s / 0.16) * 46 : s < 0.68 ? 28 - ((s - 0.16) / 0.52) * 22 : 6 - ((s - 0.68) / 0.32) * 28) * DEG;
        ang += Math.atan2(c.ty, c.tx) * 0.5 - w * 13 * DEG * smooth(0.08, 0.3, s) + (u - 0.5) * 12 * DEG;
        const len = (st.len[0] + (st.len[1] - st.len[0]) * l) * (0.55 + 0.45 * smooth(0, 0.3, s)) * (1 - 0.35 * smooth(0.75, 1, s)) * (1 - 0.3 * Math.abs(w));
        const dx = Math.cos(ang), dy = Math.sin(ang);
        // place the hair so that it is centred on the sample point
        const px = c.x + c.nx * w * c.t * 0.5 - dx * len * 0.45, py = c.y + c.ny * w * c.t * 0.5 - dy * len * 0.45;
        const bend = (v - 0.5) * 0.4 - 0.12; // slight curvature (mm per mm of length)
        const pts = [[px, py], [px + dx * len * 0.5 - dy * bend * len * 0.25, py + dy * len * 0.5 + dx * bend * len * 0.25], [px + dx * len, py + dy * len]];
        const bound = [];
        for (const [x2, y2] of pts) {
          const b = hits(eye.x + side * x2 * 0.001 * scale, eye.y + y2 * 0.001 * scale, eye.z + 0.08);
          if (!b) break;
          bound.push(b);
        }
        // brightness: hairs at the edges a bit lighter (finer), random per hair
        if (bound.length === 3) hairs.push({ bound, w: st.w * 0.001 * (0.75 + 0.5 * rnd()) * Math.sqrt(scale), tone: (0.82 + 0.3 * tone) * (1 + 0.12 * Math.abs(w)) });
      }
    }
    this._buildGeometry(hairs);
    this.update();
    return true;
  }

  /** Distance between the ends of the upper lash line of one eye, mm. */
  _eyeWidth(side, P) {
    const g = this.L.lashGrids.find((x) => x.upper && x.side === side);
    if (!g) return REF_EYE_W;
    const a = g.v[0] * 3, b = g.v[g.cols - 1] * 3;
    return Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1]) * 1000;
  }

  /**
   * Returns hit(x, y, z0) -> {a, b, c, wa, wb, wc} | null: frontmost skin
   * triangle under the point (x, y) (ray towards -Z from z0), rig space.
   */
  _projector(P) {
    const T = this.L.browTris, nt = T.length / 3;
    const CELL = 0.003;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let t = 0; t < T.length; t++) { const v = T[t] * 3; minX = Math.min(minX, P[v]); maxX = Math.max(maxX, P[v]); minY = Math.min(minY, P[v + 1]); maxY = Math.max(maxY, P[v + 1]); }
    const nx = Math.max(1, Math.ceil((maxX - minX) / CELL)), ny = Math.max(1, Math.ceil((maxY - minY) / CELL));
    const cells = Array.from({ length: nx * ny }, () => []);
    for (let t = 0; t < nt; t++) {
      const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
      const x0 = Math.floor((Math.min(P[a], P[b], P[c]) - minX) / CELL), x1 = Math.floor((Math.max(P[a], P[b], P[c]) - minX) / CELL);
      const y0 = Math.floor((Math.min(P[a + 1], P[b + 1], P[c + 1]) - minY) / CELL), y1 = Math.floor((Math.max(P[a + 1], P[b + 1], P[c + 1]) - minY) / CELL);
      for (let j = Math.max(0, y0); j <= Math.min(ny - 1, y1); j++) for (let i = Math.max(0, x0); i <= Math.min(nx - 1, x1); i++) cells[j * nx + i].push(t);
    }
    return (x, y) => {
      const i = Math.floor((x - minX) / CELL), j = Math.floor((y - minY) / CELL);
      if (i < 0 || j < 0 || i >= nx || j >= ny) return null;
      let best = null, bestZ = -Infinity;
      for (const t of cells[j * nx + i]) {
        const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
        const ax = P[a * 3], ay = P[a * 3 + 1], bx = P[b * 3], by = P[b * 3 + 1], cx = P[c * 3], cy = P[c * 3 + 1];
        // 2D barycentric (orthographic projection along Z)
        const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(det) < 1e-14) continue;
        const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
        const wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
        const wc = 1 - wa - wb;
        if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
        const z = wa * P[a * 3 + 2] + wb * P[b * 3 + 2] + wc * P[c * 3 + 2];
        // skip back-facing triangles (inside of the head)
        const ux = bx - ax, uy = by - ay, vx = cx - ax, vy = cy - ay;
        const faceZ = ux * vy - uy * vx; // z of the face normal (winding: outward = +)
        if (faceZ <= 0) continue;
        if (z > bestZ) { bestZ = z; best = { a, b, c, wa, wb, wc }; }
      }
      return best;
    };
  }

  _buildGeometry(hairs) {
    const m = this.ch.model;
    const n = hairs.length, nv = n * 6;
    const reuse = this.geometry && this.count === n;
    this.count = n;
    // bindings: 3 control points x (3 vertices + 3 weights)
    this.bv = new Uint32Array(n * 9);
    this.bw = new Float32Array(n * 9);
    this.hw = new Float32Array(n);
    const tones = new Float32Array(n);
    hairs.forEach((hh, i) => {
      tones[i] = hh.tone;
      hh.bound.forEach((b, k) => {
        const o = (i * 3 + k) * 3;
        this.bv[o] = b.a; this.bv[o + 1] = b.b; this.bv[o + 2] = b.c;
        this.bw[o] = b.wa; this.bw[o + 1] = b.wb; this.bw[o + 2] = b.wc;
      });
      this.hw[i] = hh.w;
    });
    if (!reuse) {
      const geo = new THREE.BufferGeometry();
      this.pos = new Float32Array(nv * 3);
      this.nor = new Float32Array(nv * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(nv * 4), 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(nv * 4), 4));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
      const idx = new Uint32Array(n * 12);
      for (let i = 0; i < n; i++) {
        const o = i * 6; // vertices: A0 B0 A1 B1 A2 B2
        idx.set([o, o + 2, o + 1, o + 1, o + 2, o + 3, o + 2, o + 4, o + 3, o + 3, o + 4, o + 5], i * 12);
      }
      geo.setIndex(new THREE.BufferAttribute(nv < 65535 ? Uint16Array.from(idx) : idx, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
      this.geometry?.dispose();
      this.geometry = geo;
      if (this.mesh) this.mesh.geometry = geo;
    }
    // skin weights of the dominant vertex of each hair root
    const si = this.geometry.attributes.skinIndex.array, sw = this.geometry.attributes.skinWeight.array;
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      const v = this.bw[o] >= this.bw[o + 1] && this.bw[o] >= this.bw[o + 2] ? this.bv[o] : this.bw[o + 1] >= this.bw[o + 2] ? this.bv[o + 1] : this.bv[o + 2];
      for (let j = 0; j < 6; j++) for (let k = 0; k < 4; k++) { si[(i * 6 + j) * 4 + k] = m.skinIndex[v * 4 + k]; sw[(i * 6 + j) * 4 + k] = m.skinWeight[v * 4 + k]; }
    }
    const col = this.geometry.attributes.color.array;
    for (let i = 0; i < n; i++) for (let j = 0; j < 6; j++) col.fill(Math.min(1.4, tones[i] * SHADE_T[j >> 1]), (i * 6 + j) * 3, (i * 6 + j) * 3 + 3);
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.skinIndex.needsUpdate = true;
    this.geometry.attributes.skinWeight.needsUpdate = true;
    this.geometry.setDrawRange(0, n * 12);
    if (!this.mesh) {
      const mesh = new THREE.SkinnedMesh(this.geometry, []);
      mesh.name = 'face:brows';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.userData.faceModule = 'brows';
      mesh.userData.pickable = false;
      this.mesh = mesh;
    }
    this.mesh.visible = n > 0;
  }

  /** Re-evaluates the hairs from the current rest positions / normals. */
  update() {
    const n = this.count;
    if (!n) return;
    const R = this.ch.restPositions, N = this.ch.restNormals, pos = this.pos, nor = this.nor;
    const bv = this.bv, bw = this.bw;
    const p = _p, q = _q, nn = _n, d = _d, s = _s;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const o = (i * 3 + k) * 3;
        p[k].set(0, 0, 0); q[k].set(0, 0, 0);
        for (let j = 0; j < 3; j++) {
          const v = bv[o + j] * 3, w = bw[o + j];
          p[k].x += w * R[v]; p[k].y += w * R[v + 1]; p[k].z += w * R[v + 2];
          q[k].x += w * N[v]; q[k].y += w * N[v + 1]; q[k].z += w * N[v + 2];
        }
        q[k].normalize();
        p[k].addScaledVector(q[k], LIFT[k]);
      }
      for (let k = 0; k < 3; k++) {
        d.subVectors(p[Math.min(2, k + 1)], p[Math.max(0, k - 1)]);
        nn.copy(q[k]);
        s.crossVectors(nn, d);
        const l = s.length();
        if (l > 1e-12) s.multiplyScalar((this.hw[i] * WIDTH_T[k] * 0.5) / l);
        const va = (i * 6 + k * 2) * 3, vb = va + 3;
        pos[va] = p[k].x - s.x; pos[va + 1] = p[k].y - s.y; pos[va + 2] = p[k].z - s.z;
        pos[vb] = p[k].x + s.x; pos[vb + 1] = p[k].y + s.y; pos[vb + 2] = p[k].z + s.z;
        nor[va] = nor[vb] = nn.x; nor[va + 1] = nor[vb + 1] = nn.y; nor[va + 2] = nor[vb + 2] = nn.z;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }

  dispose() { this.geometry?.dispose(); }
}

const _p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _q = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _n = new THREE.Vector3(), _d = new THREE.Vector3(), _s = new THREE.Vector3();

/**
 * Brow template at s in [0, 1]: centre (x, y), unit tangent (tx, ty), unit
 * normal (nx, ny) pointing up, thickness t (mm). Catmull-Rom through the 4 keypoints.
 */
function brow(K, s) {
  const seg = Math.min(2, Math.floor(s * 3)), u = s * 3 - seg;
  const p0 = K[Math.max(0, seg - 1)], p1 = K[seg], p2 = K[seg + 1], p3 = K[Math.min(3, seg + 2)];
  const cr = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const dcr = (a, b, c, d, t) => 0.5 * ((-a + c) + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t * t);
  const x = cr(p0[0], p1[0], p2[0], p3[0], u), y = cr(p0[1], p1[1], p2[1], p3[1], u);
  const t = Math.max(0.4, cr(p0[2], p1[2], p2[2], p3[2], u));
  let tx = dcr(p0[0], p1[0], p2[0], p3[0], u), ty = dcr(p0[1], p1[1], p2[1], p3[1], u);
  const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
  // the head of the brow is rounded: thickness tapers in the first few percent
  return { x, y, t: t * (0.55 + 0.45 * smooth(0, 0.06, s)), tx, ty, nx: -ty, ny: tx };
}
