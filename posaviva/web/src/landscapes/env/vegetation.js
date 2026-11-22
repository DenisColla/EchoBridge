// Backdrop scatter (instanced): low-poly trees, bushes, rocks, cacti, flowers
// and far city blocks that fill the land beyond the editable props. One
// InstancedMesh per species and sector (frustum culling works per sector);
// near band materials are kind 'prop' (inked like props), the far band is kind
// 'ground' (no ink: a painted background, like comic backgrounds). Species
// colours live in vertex colours; per-instance colours add variety (seasons).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng, makeNoise2 } from '../rand.js';

const _c = new THREE.Color();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

function paint(geo, hex, fn = null) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3), p = geo.attributes.position;
  _c.set(hex);
  for (let i = 0; i < n; i++) {
    let k = 1;
    if (fn) k = fn(p.getX(i), p.getY(i), p.getZ(i));
    a[i * 3] = _c.r * k; a[i * 3 + 1] = _c.g * k; a[i * 3 + 2] = _c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const KEEP = ['position', 'normal', 'color'];
const clean = (g, uv) => { const x = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(x.attributes)) if (!KEEP.includes(k) && !(uv && k === 'uv')) x.deleteAttribute(k); return x; };
/** Merges parts (each keeps its own normals: smooth blobs, sharp boxes). */
function merge(list, uv = false) {
  const g = list.length === 1 ? clean(list[0], uv) : mergeGeometries(list.map((x) => clean(x, uv)), false);
  g.computeBoundingSphere();
  return g;
}
function lumpy(geo, amp, seed) {
  const n = makeNoise2(seed), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + amp * n(x * 3.1 + y * 1.7, z * 3.1 - y * 2.3);
    p.setXYZ(i, x * k, y * (1 + amp * 0.5 * n(x * 2 + 5, z * 2)), z * k);
  }
  return geo;
}
const shadeY = (y0, y1, lo = 0.62) => (x, y) => lo + (1 - lo) * Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));

/** Unit-height species geometries (base at y = 0). leaf: crown colour, bark, snow on top. */
export function speciesGeometry(kind, look = {}, lod = 0) {
  const leaf = look.leaf || '#4d6e32', bark = look.bark || '#5b4636', snow = look.snow || 0;
  const snowy = (geo, base) => { // whitens upward-facing crown vertices
    if (!snow) return geo;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const c = geo.attributes.color, n = geo.attributes.normal;
    for (let i = 0; i < c.count; i++) {
      const k = Math.max(0, n.getY(i) - 0.25) * snow * 1.3;
      if (k > 0) { c.setXYZ(i, c.getX(i) + (0.92 - c.getX(i)) * Math.min(1, k), c.getY(i) + (0.94 - c.getY(i)) * Math.min(1, k), c.getZ(i) + (0.97 - c.getZ(i)) * Math.min(1, k)); }
    }
    return geo;
  };
  switch (kind) {
    case 'conifer': {
      const parts = [paint(new THREE.CylinderGeometry(0.025, 0.04, 0.22, 6).translate(0, 0.11, 0), bark)];
      const tiers = [[0.3, 0.12, 0.5], [0.24, 0.34, 0.74], [0.17, 0.56, 1.0]];
      for (const [r, y0, y1] of tiers) parts.push(snowy(paint(new THREE.ConeGeometry(r, y1 - y0, 8, 1, true).translate(0, (y0 + y1) / 2, 0), leaf, shadeY(y0, y1, 0.55))));
      return merge(parts);
    }
    case 'cypress': {
      const g = lumpy(new THREE.SphereGeometry(0.11, 8, 10).scale(1, 4.2, 1).translate(0, 0.52, 0), 0.08, 3);
      return merge([paint(new THREE.CylinderGeometry(0.02, 0.03, 0.12, 5).translate(0, 0.06, 0), bark), snowy(paint(g, leaf, shadeY(0.1, 0.95, 0.6)))]);
    }
    case 'broadleaf': {
      const parts = [paint(new THREE.CylinderGeometry(0.03, 0.05, 0.5, 6).translate(0, 0.25, 0), bark)];
      const blobs = lod ? [[0, 0.64, 0, 0.36]] : [[0, 0.62, 0, 0.3], [0.17, 0.55, 0.06, 0.2], [-0.15, 0.58, -0.08, 0.21], [0.03, 0.8, 0.02, 0.21]];
      blobs.forEach(([x, y, z, r], i) => parts.push(snowy(paint(lumpy(new THREE.IcosahedronGeometry(r, lod ? 0 : 1), 0.12, i + 1).translate(x, y, z), leaf, shadeY(0.35, 1, 0.55)))));
      return merge(parts);
    }
    case 'bare': {
      const parts = [paint(new THREE.CylinderGeometry(0.025, 0.045, 0.55, 6).translate(0, 0.275, 0), bark)];
      const br = [[0.5, 0.0, 0.3], [0.55, 2.1, 0.32], [0.6, 4.2, 0.28], [0.42, 1.2, 0.25], [0.48, 3.3, 0.26]];
      for (const [y, a, l] of br) {
        const g = new THREE.CylinderGeometry(0.008, 0.018, l, 4).translate(0, l / 2, 0).rotateZ(0.75).rotateY(a).translate(0, y, 0);
        parts.push(snowy(paint(g, bark)));
      }
      return merge(parts);
    }
    case 'palm': {
      const parts = [];
      for (let i = 0; i < 5; i++) {
        const y0 = i * 0.17, bend = 0.04 * i * i * 0.3;
        parts.push(paint(new THREE.CylinderGeometry(0.028, 0.034, 0.18, 6).translate(bend, y0 + 0.09, 0), '#7a6650'));
      }
      for (let k = 0; k < 8; k++) {
        const g = new THREE.ConeGeometry(0.07, 0.48, 3, 1).rotateX(Math.PI / 2).scale(1, 0.25, 1).translate(0, 0, 0.24).rotateX(0.35).rotateY((k / 8) * Math.PI * 2).translate(0.07, 0.86, 0);
        parts.push(paint(g, leaf));
      }
      return merge(parts);
    }
    case 'bush': return merge([snowy(paint(lumpy(new THREE.IcosahedronGeometry(0.5, lod ? 0 : 1), 0.18, 7).scale(1, 0.75, 1).translate(0, 0.32, 0), leaf, shadeY(0, 0.7, 0.5)))]);
    case 'rock': return merge([snowy(paint(lumpy(new THREE.IcosahedronGeometry(0.5, lod ? 0 : 1), 0.28, 11).scale(1, 0.6, 0.85).translate(0, 0.2, 0), look.rock || '#8b877f', shadeY(-0.1, 0.5, 0.75)))]);
    case 'cactus': {
      const c = look.leaf || '#5f7f3a';
      const parts = [paint(new THREE.CylinderGeometry(0.08, 0.09, 1, 8).translate(0, 0.5, 0), c)];
      parts.push(paint(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6).rotateZ(Math.PI / 2).translate(0.15, 0.45, 0), c));
      parts.push(paint(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 6).translate(0.28, 0.62, 0), c));
      parts.push(paint(new THREE.CylinderGeometry(0.045, 0.045, 0.25, 6).rotateZ(Math.PI / 2).translate(-0.12, 0.58, 0), c));
      parts.push(paint(new THREE.CylinderGeometry(0.045, 0.045, 0.28, 6).translate(-0.23, 0.72, 0), c));
      return merge(parts);
    }
    case 'flowers': {
      const parts = [];
      const cols = look.flowers || ['#e84a5f', '#f6d743', '#ffffff', '#9b59d0'];
      for (let i = 0; i < 6; i++) {
        const a = i * 2.4, r = 0.12 + (i % 3) * 0.12;
        parts.push(paint(new THREE.IcosahedronGeometry(0.06, 0).translate(Math.cos(a) * r, 0.18 + (i % 2) * 0.05, Math.sin(a) * r), cols[i % cols.length]));
      }
      parts.push(paint(new THREE.IcosahedronGeometry(0.3, 0).scale(1, 0.4, 1).translate(0, 0.08, 0), look.leaf || '#5a8a3a'));
      return merge(parts);
    }
    case 'jungle': { // broad umbrella crown, buttress trunk
      const parts = [paint(new THREE.CylinderGeometry(0.03, 0.07, 0.7, 6).translate(0, 0.35, 0), '#6b5a48')];
      for (let i = 0; i < (lod ? 3 : 5); i++) {
        const a = i * (lod ? 2.1 : 1.26);
        parts.push(paint(lumpy(new THREE.IcosahedronGeometry(lod ? 0.28 : 0.24, lod ? 0 : 1), 0.15, i + 20).scale(1, 0.55, 1).translate(Math.cos(a) * 0.2, 0.78 + (i % 2) * 0.08, Math.sin(a) * 0.2), leaf, shadeY(0.6, 1, 0.5)));
      }
      return merge(parts);
    }
    case 'tower': { // far city block (unit box with a darker base and roof band)
      const g = new THREE.BoxGeometry(1, 1, 1, 1, 4, 1).translate(0, 0.5, 0);
      return merge([paint(g, look.facade || '#b9b6ae', (x, y) => (y > 0.97 ? 0.8 : y < 0.06 ? 0.7 : 1))], true);
    }
    default: return speciesGeometry('bush', look);
  }
}

/**
 * Builds instanced meshes for scatter entries.
 * entries: [{kind, look, items: [{x, y, z, s, sy?, rot, c: hex|null, far}]}] (world coordinates)
 * Returns a Group (call dispose()).
 */
export function buildScatter(materials, entries, { sectors = 4, center = { x: 0, z: 0 }, emissive = null } = {}) {
  const group = new THREE.Group();
  group.name = 'landscape:scatter';
  const meshes = [];
  for (const e of entries) {
    if (!e.items.length) continue;
    const geos = [speciesGeometry(e.kind, e.look, 0), null];
    const geoFor = (far) => (far ? (geos[1] ||= speciesGeometry(e.kind, e.look, 1)) : geos[0]);
    // bucket by sector (angle around the centre) and band (near / far)
    const buckets = new Map();
    for (const it of e.items) {
      const a = Math.atan2(it.z - center.z, it.x - center.x);
      const sec = Math.floor(((a + Math.PI) / (Math.PI * 2)) * sectors) % sectors;
      const key = (it.far ? 'f' : 'n') + sec;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(it);
    }
    for (const [key, list] of buckets) {
      const far = key[0] === 'f' && e.kind !== 'tower'; // far city blocks stay inked (skyline silhouettes, lit windows)
      const mesh = new THREE.InstancedMesh(geoFor(key[0] === 'f'), undefined, list.length);
      const colors = new Float32Array(list.length * 3), neutral = new Float32Array(list.length * 3);
      list.forEach((it, i) => {
        _q.setFromEuler(_e.set(it.tx || 0, it.rot || 0, it.tz || 0));
        _s.set(it.sx ?? it.s, it.sy ?? it.s, it.sz ?? it.sx ?? it.s);
        _m.compose(_p.set(it.x, it.y, it.z), _q, _s);
        mesh.setMatrixAt(i, _m);
        _c.set(it.c || '#ffffff');
        colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
        const l = 0.92 + ((i * 7919) % 13) / 100; // clay: brightness variation only
        neutral[i * 3] = neutral[i * 3 + 1] = neutral[i * 3 + 2] = l;
      });
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      mesh.userData.colorsStyle = { full: mesh.instanceColor, neutral: new THREE.InstancedBufferAttribute(neutral, 3) };
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = false; // backdrop: no shadow pass cost (the shadow box covers ~25 m around the characters)
      mesh.receiveShadow = true;
      mesh.name = `landscape:${e.kind}:${key}`;
      mesh.userData.landscape = 'scatter';
      mesh.userData.noBounds = true;
      const spec = { kind: far ? 'ground' : 'prop', color: '#ffffff', roughness: e.kind === 'tower' ? 0.8 : 0.88, vertexColors: true };
      if (e.kind === 'tower' && e.map) { spec.map = e.map; if (emissive) { spec.emissive = '#ffd28a'; spec.emissiveMap = e.emap; spec.emissiveIntensity = emissive; } }
      if (far) mesh.userData.isGround = true;
      materials.apply(mesh, spec);
      mesh.raycast = () => {};
      group.add(mesh);
      meshes.push(mesh);
    }
  }
  group.userData.meshes = meshes;
  group.userData.geos = new Set(meshes.map((m) => m.geometry));
  group.dispose = () => {
    for (const m of meshes) { materials.release(m); m.dispose?.(); }
    for (const g of group.userData.geos) g.dispose();
    group.removeFromParent();
  };
  /** clay: neutral instance colours (the style ignores vertex colours too) */
  group.setStyle = (style) => {
    for (const m of meshes) {
      const want = style === 'clay' ? m.userData.colorsStyle.neutral : m.userData.colorsStyle.full;
      if (m.instanceColor !== want) m.instanceColor = want;
    }
  };
  return group;
}

/** Facade texture for far towers: window grid (map) + lit windows (emissive map). */
let _facade = null;
export function facadeTextures() {
  if (_facade) return _facade;
  const W = 128, H = 256, c = document.createElement('canvas'), e = document.createElement('canvas');
  c.width = e.width = W; c.height = e.height = H;
  const g = c.getContext('2d'), ge = e.getContext('2d');
  g.fillStyle = '#d9d6cf'; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const rnd = makeRng(77);
  const cols = 6, rows = 16;
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const x = 4 + k * (W - 8) / cols, y = 4 + r * (H - 8) / rows, w = (W - 8) / cols - 6, hh = (H - 8) / rows - 6;
    g.fillStyle = rnd() < 0.2 ? '#59626e' : '#3b4552'; g.fillRect(x, y, w, hh);
    if (rnd() < 0.42) { ge.fillStyle = rnd() < 0.7 ? '#ffd9a0' : '#cfe4ff'; ge.fillRect(x, y, w, hh); }
  }
  const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  _facade = { map: mk(c), emap: mk(e) };
  return _facade;
}
