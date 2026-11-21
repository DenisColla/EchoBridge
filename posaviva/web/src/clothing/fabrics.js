// Procedural fabric textures, generated once and shared by every garment:
//  - weave normal maps (tileable DataTextures, uv channel 0, metric UVs):
//    jersey knit, rib, fleece, denim twill, poplin, wool twill, canvas,
//    lycra, microfiber, crepe, tricot, leather grain, sneaker mesh
//  - detail maps (CanvasTexture, uv channel 1 = garment atlas): seams,
//    stitching, pockets, plackets, laces… drawn in garment coordinates.
// Detail maps multiply the garment color (white = no change).
import * as THREE from 'three';
import { ATLAS, T_RANGE, A_RANGE } from './assemble.js';
import { len3 } from './mesh.js';

const TAU = Math.PI * 2;

// ------------------------------------------------------------------ fabric properties
/**
 * tile: world size (m) of one weave tile; ns: normal strength in realistic/clay;
 * roughness / sheen for the cloth material.
 */
export const FABRICS = {
  jersey: { tile: 0.02, ns: 0.3, roughness: 0.86, sheen: 0.5 },
  rib: { tile: 0.02, ns: 0.8, roughness: 0.88, sheen: 0.45 },
  fleece: { tile: 0.025, ns: 0.4, roughness: 0.94, sheen: 0.7 },
  tricot: { tile: 0.018, ns: 0.3, roughness: 0.6, sheen: 0.35 },
  denim: { tile: 0.02, ns: 0.6, roughness: 0.9, sheen: 0.25 },
  poplin: { tile: 0.012, ns: 0.25, roughness: 0.72, sheen: 0.3 },
  wool: { tile: 0.016, ns: 0.3, roughness: 0.82, sheen: 0.45 },
  canvas: { tile: 0.016, ns: 0.5, roughness: 0.9, sheen: 0.25 },
  lycra: { tile: 0.012, ns: 0.18, roughness: 0.48, sheen: 0.35 },
  micro: { tile: 0.012, ns: 0.15, roughness: 0.62, sheen: 0.4 },
  crepe: { tile: 0.03, ns: 0.35, roughness: 0.8, sheen: 0.55 },
  leather: { tile: 0.03, ns: 0.35, roughness: 0.42, sheen: 0 },
  sneaker: { tile: 0.02, ns: 0.4, roughness: 0.7, sheen: 0.2 },
};

const _weave = new Map();

/** Tileable normal map for a fabric (256 x 256). */
export function weaveNormal(type) {
  if (_weave.has(type)) return _weave.get(type);
  const S = 256;
  const H = new Float32Array(S * S);
  const fr = (x) => x - Math.floor(x);
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  // tileable value noise
  const vnoise = (x, y, period) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const h = (a, b) => hash(((a % period) + period) % period, ((b % period) + period) % period);
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
  };
  const knit = (u, v, cols, rows) => {
    // V-shaped knit stitches: two slanted lobes per stitch
    const x = fr(u * cols), y = fr(v * rows);
    const l = Math.exp(-(((x - 0.27 + (y - 0.5) * 0.35) / 0.17) ** 2) - (((y - 0.5) / 0.42) ** 2));
    const r = Math.exp(-(((x - 0.73 - (y - 0.5) * 0.35) / 0.17) ** 2) - (((y - 0.5) / 0.42) ** 2));
    return Math.max(l, r);
  };
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = i / S, v = j / S;
    let h = 0;
    switch (type) {
      case 'jersey': h = knit(u, v, 16, 16) + 0.25 * vnoise(u * 8, v * 8, 8); break;
      case 'micro': h = knit(u, v, 32, 32) * 0.6 + 0.1 * vnoise(u * 16, v * 16, 16); break;
      case 'lycra': h = knit(u, v, 32, 32) * 0.5; break;
      case 'tricot': h = 0.6 * Math.abs(Math.sin(u * 32 * Math.PI)) + 0.3 * knit(u, v, 32, 64); break;
      case 'rib': h = Math.pow(Math.abs(Math.sin(u * 8 * Math.PI)), 0.6) + 0.25 * knit(u, v, 16, 16); break;
      case 'fleece': h = 0.6 * knit(u, v, 16, 16) + 0.5 * vnoise(u * 16, v * 16, 16) + 0.2 * vnoise(u * 64, v * 64, 64); break;
      case 'denim': {
        // 3/1 twill: diagonal wales + warp slubs
        const t = fr((u * 32 + v * 32));
        h = Math.pow(Math.sin(t * Math.PI), 0.8) * 0.8 + 0.25 * vnoise(u * 4, v * 64, 4) + 0.15 * vnoise(u * 64, v * 64, 64);
        break;
      }
      case 'wool': { const t = fr(u * 32 + v * 32); h = 0.5 * Math.sin(t * Math.PI) + 0.35 * vnoise(u * 32, v * 32, 32); break; }
      case 'poplin': h = 0.5 * (Math.sin(u * 64 * Math.PI) ** 2) * (0.6 + 0.4 * Math.sin(v * 64 * Math.PI) ** 2) + 0.5 * (Math.sin(v * 64 * Math.PI) ** 2) * 0.3; break;
      case 'canvas': h = 0.55 * Math.abs(Math.sin(u * 32 * Math.PI)) * Math.abs(Math.sin(v * 32 * Math.PI + (Math.floor(u * 32) % 2) * 1.57)) + 0.25 * vnoise(u * 32, v * 32, 32); break;
      case 'crepe': h = 0.6 * vnoise(u * 32, v * 32, 32) + 0.4 * vnoise(u * 64, v * 64, 64); break;
      case 'leather': {
        // cellular grain
        const gx = u * 32, gy = v * 32, cx = Math.floor(gx), cy = Math.floor(gy);
        let d1 = 9;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const px = cx + a + hash(((cx + a) % 32 + 32) % 32, ((cy + b) % 32 + 32) % 32), py = cy + b + hash(((cy + b) % 32 + 32) % 32 + 7, ((cx + a) % 32 + 32) % 32 + 3);
          d1 = Math.min(d1, Math.sqrt((gx - px) ** 2 + (gy - py) ** 2));
        }
        h = Math.min(1, d1 * 1.4) + 0.2 * vnoise(u * 8, v * 8, 8);
        break;
      }
      case 'sneaker': h = 0.6 * (Math.abs(Math.sin(u * 16 * Math.PI)) * Math.abs(Math.sin(v * 16 * Math.PI))) ** 0.5 + 0.2 * vnoise(u * 32, v * 32, 32); break;
      default: h = 0;
    }
    H[j * S + i] = h;
  }
  const data = new Uint8Array(S * S * 4);
  const k = 3.0;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const hx = H[j * S + ((i + 1) % S)] - H[j * S + ((i + S - 1) % S)];
    const hy = H[((j + 1) % S) * S + i] - H[((j + S - 1) % S) * S + i];
    let nx = -hx * k, ny = -hy * k, nz = 1;
    const l = len3(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    const o = (j * S + i) * 4;
    data[o] = Math.round((nx * 0.5 + 0.5) * 255); data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255); data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255); data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  const tile = FABRICS[type]?.tile ?? 0.02;
  tex.repeat.set(1 / tile, 1 / tile);
  tex.channel = 0;
  tex.name = 'pv-weave-' + type;
  tex.needsUpdate = true;
  _weave.set(type, tex);
  return tex;
}

// ------------------------------------------------------------------ detail maps
const DETAIL_SIZE = 1024;
const _detail = new Map();

/** Garment coordinate -> canvas px. region 0 torso (coord = T), 1..4 limbs (coord = limb param). */
function mapper(S) {
  return (r, theta, coord) => {
    const R = ATLAS[r];
    const norm = r === 0 ? (coord - T_RANGE[0]) / (T_RANGE[1] - T_RANGE[0]) : (coord - A_RANGE[0]) / (A_RANGE[1] - A_RANGE[0]);
    return [(R[0] + R[2] * (theta / TAU + 0.5)) * S, (R[1] + R[3] * norm) * S];
  };
}

/** Detail map for a garment `details` id (null when nothing to draw or no DOM). */
export function detailMap(id) {
  if (!id || typeof document === 'undefined') return null;
  if (_detail.has(id)) return _detail.get(id);
  const draw = DRAW[id];
  if (!draw) { _detail.set(id, null); return null; }
  const S = DETAIL_SIZE;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  const M = mapper(S);
  const api = makeApi(g, M, S);
  draw(api);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.channel = 1;
  tex.anisotropy = 4;
  tex.name = 'pv-detail-' + id;
  _detail.set(id, tex);
  return tex;
}

function makeApi(g, M, S) {
  const api = {
    g, M, S,
    /** polyline in garment coords: pts [[theta, coord], ...] */
    line(r, pts, { color = 'rgba(40,40,40,0.55)', width = 1.6, dash = null } = {}) {
      g.save();
      g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
      if (dash) g.setLineDash(dash);
      g.beginPath();
      pts.forEach(([th, c], i) => { const [x, y] = M(r, th, c); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
      g.restore();
    },
    /** stitching: dashed lighter/darker thread line */
    stitch(r, pts, color = 'rgba(30,30,30,0.5)', width = 1.3) { api.line(r, pts, { color, width, dash: [4, 3] }); },
    seam(r, pts, k = 0.42) { api.line(r, pts, { color: `rgba(0,0,0,${k})`, width: 2.2 }); },
    /** horizontal line around a region at coordinate c (theta from a to b) */
    around(r, c, a = -Math.PI, b = Math.PI, n = 48) { const p = []; for (let i = 0; i <= n; i++) p.push([a + (b - a) * (i / n), c]); return p; },
    /** vertical line along a region at angle th between coords c0..c1 */
    along(r, th, c0, c1, n = 24) { const p = []; for (let i = 0; i <= n; i++) p.push([th, c0 + (c1 - c0) * (i / n)]); return p; },
    fillShape(r, pts, color) {
      g.save(); g.fillStyle = color; g.beginPath();
      pts.forEach(([th, c], i) => { const [x, y] = M(r, th, c); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath(); g.fill(); g.restore();
    },
    dot(r, th, c, rad = 3, color = 'rgba(60,50,40,0.7)') { const [x, y] = M(r, th, c); g.save(); g.fillStyle = color; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill(); g.restore(); },
  };
  return api;
}

const LIMBS_ARM = [1, 2], LIMBS_LEG = [3, 4];
// outer side of each leg in the leg frame: theta 0 = lateral (outer) for both legs
const PI = Math.PI;

/** Per-garment detail drawings (garment coordinates, see assemble.js atlasUV). */
const DRAW = {
  tshirt(a) {
    for (const r of LIMBS_ARM) a.stitch(r, a.around(r, 0.36));
    a.stitch(0, a.around(0, 0.48));
    a.stitch(0, a.around(0, 4.62, -1.2, 1.2));
    // side seams
    a.seam(0, a.along(0, PI / 2, 0.4, 3.9), 0.18); a.seam(0, a.along(0, -PI / 2, 0.4, 3.9), 0.18);
  },
  tank(a) { a.stitch(0, a.around(0, 0.52)); a.seam(0, a.along(0, PI / 2, 0.45, 3.6), 0.16); a.seam(0, a.along(0, -PI / 2, 0.45, 3.6), 0.16); },
  plainKnit(a) { a.seam(0, a.along(0, PI / 2, 0.4, 3.9), 0.16); a.seam(0, a.along(0, -PI / 2, 0.4, 3.9), 0.16); for (const r of LIMBS_ARM) a.seam(r, a.along(r, PI, 0.1, 1.95), 0.16); },
  sweatshirt(a) {
    // raglan-like seams + side seams
    a.seam(0, a.along(0, PI / 2, 0.3, 3.8), 0.22); a.seam(0, a.along(0, -PI / 2, 0.3, 3.8), 0.22);
    for (const r of LIMBS_ARM) { a.seam(r, a.along(r, PI, 0.1, 1.9), 0.2); a.stitch(r, a.around(r, 1.86)); }
    a.stitch(0, a.around(0, 0.52));
  },
  trackjacket(a) {
    // zipper tape + teeth at the front centre
    a.line(0, a.along(0, 0, 0.25, 4.95), { color: 'rgba(20,20,22,0.85)', width: 7 });
    a.line(0, a.along(0, 0, 0.25, 4.95), { color: 'rgba(160,160,165,0.9)', width: 2, dash: [2, 2] });
    a.stitch(0, a.along(0, 0.05, 0.25, 4.9), 'rgba(255,255,255,0.35)'); a.stitch(0, a.along(0, -0.05, 0.25, 4.9), 'rgba(255,255,255,0.35)');
    for (const s of [0.9, -0.9]) a.seam(0, [[s, 0.35], [s * 1.05, 1.4], [s * 1.15, 2.3]], 0.25); // pocket welts
    for (const r of LIMBS_ARM) a.seam(r, a.along(r, 0, -0.1, 1.9), 0.3);
  },
  shirt(a) {
    // placket: two stitch lines + buttonhole marks, chest pocket, yoke
    for (const s of [0.07, -0.07]) a.stitch(0, a.along(0, s, 0.05, 4.95), 'rgba(40,40,40,0.4)');
    a.seam(0, a.along(0, 0.075, 0.05, 4.95), 0.15);
    const pk = [[0.32, 3.55], [0.62, 3.55], [0.62, 3.05], [0.47, 2.95], [0.32, 3.05], [0.32, 3.55]];
    a.stitch(0, pk); a.seam(0, pk, 0.12);
    a.seam(0, a.around(0, 4.45, PI * 0.55, PI * 1.45), 0.22); a.seam(0, a.around(0, 4.45, -PI * 1.45, -PI * 0.55), 0.22);
    for (const r of LIMBS_ARM) { a.seam(r, a.along(r, PI, 0.1, 1.95), 0.2); a.stitch(r, a.around(r, 1.88)); }
    a.seam(0, a.along(0, PI / 2, 0.1, 3.8), 0.16); a.seam(0, a.along(0, -PI / 2, 0.1, 3.8), 0.16);
  },
  blazer(a) {
    for (const s of [1, -1]) {
      // hip pocket flaps
      const f = [[s * 0.55, 1.2], [s * 1.25, 1.2], [s * 1.25, 1.0], [s * 0.55, 1.0], [s * 0.55, 1.2]];
      a.seam(0, f, 0.45); a.stitch(0, f.map(([t, c]) => [t, c - 0.02]), 'rgba(0,0,0,0.25)');
      // princess seams
      a.seam(0, [[s * 0.45, 0.2], [s * 0.42, 1.3], [s * 0.5, 2.6], [s * 0.7, 3.6]], 0.28);
      a.seam(0, a.along(0, s * PI * 0.8, 0.0, 4.0), 0.25);
    }
    a.seam(0, [[0.75, 3.4], [1.1, 3.45]], 0.45); // breast welt
    a.line(0, a.along(0, 0, 0.0, 2.2), { color: 'rgba(0,0,0,0.55)', width: 2 }); // front edge
    for (const r of LIMBS_ARM) { a.seam(r, a.along(r, PI, 0.1, 1.9), 0.25); a.seam(r, a.along(r, 0.3, 0.1, 1.9), 0.2); }
  },
  sporttop(a) { a.seam(0, a.along(0, PI / 2, 2.4, 4), 0.25); a.seam(0, a.along(0, -PI / 2, 2.4, 4), 0.25); },
  jeans(a) {
    const thread = 'rgba(210,150,60,0.9)';
    // front pockets (curved openings), coin pocket, fly J-stitch
    for (const s of [1, -1]) {
      const pk = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pk.push([s * (0.32 + 0.9 * t), 1.53 - 0.42 * Math.sin(t * PI / 2) ** 1.3]); }
      a.seam(0, pk, 0.5); a.stitch(0, pk.map(([th, c]) => [th, c - 0.03]), thread, 1.6);
      // back pockets (pentagons, double stitched)
      const b0 = s * (PI - 0.42), bw = 0.42 * s;
      const bp = [[b0 - bw * 0.55, 1.42], [b0 + bw * 0.55, 1.42], [b0 + bw * 0.5, 0.88], [b0, 0.78], [b0 - bw * 0.5, 0.88], [b0 - bw * 0.55, 1.42]];
      a.seam(0, bp, 0.35); a.stitch(0, bp.map(([th, c]) => [th, c + 0.025]), thread, 1.6); a.stitch(0, bp.map(([th, c]) => [th, c - 0.015]), thread, 1.6);
      // yoke
      a.seam(0, [[s * PI * 0.62, 1.32], [s * PI * 0.99, 1.18]], 0.4); a.stitch(0, [[s * PI * 0.62, 1.29], [s * PI * 0.99, 1.15]], thread);
    }
    a.stitch(0, [[0.09, 1.52], [0.09, 0.85], [0.0, 0.72]], thread, 1.8);
    a.seam(0, [[0.0, 1.52], [0.0, 0.7]], 0.35);
    a.stitch(0, [[0.5, 1.5], [0.72, 1.5], [0.72, 1.36], [0.5, 1.36]], thread, 1.4);
    // legs: outer side seam (double stitched), inseam, hem stitching
    for (const r of LIMBS_LEG) {
      a.seam(r, a.along(r, 0, -0.1, 1.98), 0.4); a.stitch(r, a.along(r, 0.06, -0.1, 1.98), thread, 1.6);
      a.seam(r, a.along(r, PI, 0.05, 1.98), 0.3); a.stitch(r, a.along(r, PI - 0.06, 0.05, 1.98), thread, 1.6);
      a.stitch(r, a.around(r, 1.93), thread, 1.8);
    }
    for (const s of [0.9, -0.9]) a.dot(0, s * 0.35 + 0.0, 1.5, 3.2, 'rgba(120,90,40,0.9)');
  },
  trousers(a) {
    for (const s of [1, -1]) {
      a.seam(0, [[s * 0.55, 1.72], [s * 1.0, 1.25]], 0.5); // slant pockets
      a.seam(0, [[s * (PI - 0.25), 1.45], [s * (PI - 0.7), 1.45]], 0.55); // back welt
      a.seam(0, [[s * (PI - 0.47), 1.75], [s * (PI - 0.47), 1.5]], 0.3); // dart
    }
    a.seam(0, [[0.0, 1.73], [0.0, 0.75]], 0.4); a.stitch(0, [[0.08, 1.7], [0.08, 0.85], [0, 0.78]], 'rgba(0,0,0,0.3)');
    for (const r of LIMBS_LEG) { a.seam(r, a.along(r, 0, -0.1, 2.0), 0.35); a.seam(r, a.along(r, PI, 0.05, 2.0), 0.25); }
  },
  sweatpants(a) {
    for (const s of [1, -1]) a.seam(0, [[s * 0.75, 1.62], [s * 1.25, 1.1]], 0.45);
    for (const r of LIMBS_LEG) a.seam(r, a.along(r, 0, -0.1, 1.95), 0.3);
    a.line(0, [[0.06, 1.69], [0.0, 1.45], [-0.06, 1.69]], { color: 'rgba(240,240,240,0.9)', width: 2.5 }); // drawstring
  },
  cargo(a) {
    for (const s of [1, -1]) a.seam(0, [[s * 0.5, 1.48], [s * 1.05, 1.0]], 0.45);
    for (const r of LIMBS_LEG) {
      a.seam(r, a.along(r, 0, -0.1, 1.98), 0.35);
      // side pocket with flap, matches the relief bump (s 0.21..0.37 m ~ leg param 0.55..0.95)
      const p = [[-0.5, 0.52], [0.5, 0.52], [0.5, 0.98], [-0.5, 0.98], [-0.5, 0.52]];
      a.seam(r, p, 0.55); a.stitch(r, p.map(([t, c]) => [t * 0.92, c + (c < 0.7 ? 0.02 : -0.02)]));
      const fl = [[-0.54, 0.5], [0.54, 0.5], [0.54, 0.62], [-0.54, 0.62], [-0.54, 0.5]];
      a.seam(r, fl, 0.6); a.dot(r, 0, 0.6, 3.5, 'rgba(30,30,30,0.6)');
      a.seam(r, a.around(r, 1.1, -0.9, 0.9), 0.3); // knee panel
      a.stitch(r, a.around(r, 1.93));
    }
  },
  shorts(a) {
    for (const s of [1, -1]) a.seam(0, [[s * 0.4, 1.53], [s * 1.0, 1.15]], 0.45);
    a.seam(0, [[0.0, 1.52], [0.0, 0.75]], 0.35);
    for (const r of LIMBS_LEG) { a.seam(r, a.along(r, 0, -0.1, 0.4), 0.35); a.stitch(r, a.around(r, 0.36)); }
  },
  leggings(a) { for (const r of LIMBS_LEG) a.seam(r, a.along(r, PI, 0.0, 1.9), 0.18); },
  skirt(a) { a.seam(0, a.along(0, PI / 2, -1.5, 2.2), 0.3); a.seam(0, a.along(0, -PI / 2, -1.5, 2.2), 0.3); a.stitch(0, a.around(0, 1.6)); },
  pencil(a) { a.seam(0, a.along(0, PI, -1.2, 2.0), 0.4); a.seam(0, a.along(0, PI / 2, -1.2, 2.0), 0.3); a.seam(0, a.along(0, -PI / 2, -1.2, 2.0), 0.3); for (const s of [0.45, -0.45]) a.seam(0, [[s, 1.95], [s * 1.05, 1.55]], 0.3); },
  dress(a) { for (const s of [1, -1]) a.seam(0, [[s * 0.42, 1.5], [s * 0.4, 2.3], [s * 0.55, 3.1], [s * 0.75, 3.6]], 0.25); a.seam(0, a.around(0, 2.0), 0.35); },
  sneakers(a) {
    for (const r of LIMBS_LEG) {
      // lacing area on the instep (foot frame: theta 0 = top)
      const c0 = 2.02, c1 = 2.42;
      a.fillShape(r, [[-0.32, c0], [0.32, c0], [0.22, c1], [-0.22, c1]], 'rgba(0,0,0,0.12)');
      for (let i = 0; i < 6; i++) {
        const c = c0 + (c1 - c0) * (i + 0.5) / 6;
        a.line(r, [[-0.25, c], [0.25, c + 0.05]], { color: 'rgba(40,40,40,0.7)', width: 3 });
        a.dot(r, -0.3, c, 2.2, 'rgba(30,30,30,0.8)'); a.dot(r, 0.3, c, 2.2, 'rgba(30,30,30,0.8)');
      }
      // toe cap, side panel, heel counter
      a.seam(r, a.around(r, 2.62, -1.4, 1.4), 0.4);
      a.seam(r, [[-1.2, 1.98], [-1.6, 2.3], [-2.0, 2.6]], 0.35); a.seam(r, [[1.2, 1.98], [1.6, 2.3], [2.0, 2.6]], 0.35);
      a.stitch(r, a.around(r, 2.0, -2.6, 2.6));
    }
  },
  dressshoes(a) {
    for (const r of LIMBS_LEG) {
      a.seam(r, a.around(r, 2.6, -1.5, 1.5), 0.55); // cap toe
      a.stitch(r, a.around(r, 2.62, -1.4, 1.4), 'rgba(0,0,0,0.35)');
      for (let i = 0; i < 4; i++) a.line(r, [[-0.18, 2.1 + i * 0.05], [0.18, 2.12 + i * 0.05]], { color: 'rgba(0,0,0,0.6)', width: 2 });
      a.seam(r, [[-1.4, 2.05], [-1.9, 2.3]], 0.35); a.seam(r, [[1.4, 2.05], [1.9, 2.3]], 0.35);
    }
  },
  boots(a) {
    for (const r of LIMBS_LEG) {
      for (let i = 0; i < 9; i++) {
        const c = 1.55 + i * 0.075;
        a.line(r, [[-0.25, c], [0.25, c + 0.05]], { color: 'rgba(30,30,30,0.75)', width: 3 });
        a.dot(r, -0.32, c, 2.4, 'rgba(150,140,120,0.9)'); a.dot(r, 0.32, c, 2.4, 'rgba(150,140,120,0.9)');
      }
      a.seam(r, a.along(r, -0.36, 1.5, 2.25), 0.45); a.seam(r, a.along(r, 0.36, 1.5, 2.25), 0.45);
      a.seam(r, a.around(r, 2.55, -1.6, 1.6), 0.45);
      a.stitch(r, a.around(r, 2.0, -2.8, -0.5)); a.stitch(r, a.around(r, 2.0, 0.5, 2.8));
    }
  },
  socks(a) { for (const r of LIMBS_LEG) { a.line(r, a.around(r, 2.7), { color: 'rgba(0,0,0,0.12)', width: 10 }); } },
  underwear(a) { a.stitch(0, a.around(0, 1.3)); },
};

/** Hardware material colors. */
export const HARDWARE = {
  shirt: { color: '#f2efe8', roughness: 0.35, metalness: 0 },
  blazer: { color: '#1d1b1a', roughness: 0.4, metalness: 0 },
  metal: { color: '#b8a27a', roughness: 0.35, metalness: 0.8 },
  zipper: { color: '#c8c8cc', roughness: 0.3, metalness: 0.8 },
};
