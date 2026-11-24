// Procedural textures of the exterior props (asphalt, pavers, cobbles, grass,
// bark, rock, gravel, sand, water, road signs, decals). Generated lazily on a
// 2D canvas the first time a material needs them (no files shipped), cached as
// singletons so every prop shares the same textures (and materials).
// Color maps are sRGB; normal maps (from height fields) are linear.
import * as THREE from 'three';
import { makeNoise } from './util.js';

const cache = new Map();

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Normal map canvas from a tileable height field (Float32Array w*h, 0..1). */
function normalFrom(hf, w, h, strength = 2) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const H = (x, y) => hf[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    let nx = -dx, ny = dy, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Tileable fbm noise sampler on a torus-mapped domain: f(x, y) in 0..w, 0..h -> ~[-1, 1]. */
function tileNoise(seed, w, h, scale) {
  const n = makeNoise(seed);
  const R = scale / (2 * Math.PI);
  return (x, y, oct = 4) => {
    const a = (x / w) * Math.PI * 2, b = (y / h) * Math.PI * 2;
    // 4D torus via two 3D samples blended (cheap approximation, seamless)
    return n.fbm(Math.cos(a) * R, Math.sin(a) * R + Math.cos(b) * R * 0.7, Math.sin(b) * R, oct);
  };
}

/** Generic "material" texture: per-pixel color + height from a function; returns {map, normalMap}. */
function surface(key, size, fn, { strength = 2, normal = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const hf = new Float32Array(size * size);
  const out = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    fn(x, y, out);
    const i = (y * size + x) * 4;
    d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = 255;
    hf[y * size + x] = out[3];
  }
  ctx.putImageData(img, 0, 0);
  const res = { map: toTex(c), normalMap: normal ? toTex(normalFrom(hf, size, size, strength), { srgb: false }) : null };
  cache.set(key, res);
  return res;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
function hash2(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// ------------------------------------------------------------------ ground surfaces
/** Asphalt (tile 4 m): dark binder, light aggregate grains, soft blotches. */
export function asphalt() {
  const S = 512;
  const nBig = tileNoise(11, S, S, 3), nMid = tileNoise(12, S, S, 14);
  return surface('asphalt', S, (x, y, o) => {
    const big = nBig(x, y, 3), mid = nMid(x, y, 2);
    const g = hash2(x, y, 1), g2 = hash2(x >> 1, y >> 1, 2);
    let v = 62 + big * 10 + mid * 6 + (g - 0.5) * 22;
    let hgt = 0.5 + (g2 - 0.5) * 0.6;
    if (g2 > 0.86) { v += 38 * (g2 - 0.86) / 0.14; hgt += 0.2; } // aggregate grains
    if (g < 0.04) { v -= 18; hgt -= 0.3; } // pits
    v *= 1.5; // the material color (#8c8f94) darkens it back: clay keeps a darker road
    o[0] = clamp255(v); o[1] = clamp255(v + 1); o[2] = clamp255(v + 5); o[3] = hgt;
  }, { strength: 1.2 });
}

/** Concrete sidewalk slabs 40 cm (tile 1.6 m = 4 x 4 slabs). */
export function pavers() {
  const S = 512, cell = S / 4;
  const n = tileNoise(21, S, S, 8);
  return surface('pavers', S, (x, y, o) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const fx = x - cx * cell, fy = y - cy * cell;
    const edge = Math.min(fx, fy, cell - fx, cell - fy);
    const tone = (hash2(cx, cy, 3) - 0.5) * 14;
    let v = 168 + tone + n(x, y, 3) * 10 + (hash2(x, y, 4) - 0.5) * 16;
    let hgt = 0.7;
    if (edge < 2.2) { v -= 55; hgt = 0.1; } else if (edge < 4) { v -= 12; hgt = 0.5; }
    o[0] = clamp255(v + 2); o[1] = clamp255(v); o[2] = clamp255(v - 4); o[3] = hgt + (hash2(x, y, 5) - 0.5) * 0.05;
  }, { strength: 2.5 });
}

/** Porphyry setts (cubetti di porfido) in rows, ~10 cm (tile 1 m). */
export function cobbles() {
  const S = 512, rows = 10, cw = S / 10;
  return surface('cobbles', S, (x, y, o) => {
    const r = Math.floor(y / (S / rows));
    const off = (r % 2) * cw * 0.5 + hash2(r, 0, 7) * cw * 0.3;
    const cx = Math.floor((x + off) / cw), fx = ((x + off) % cw + cw) % cw, fy = y - r * (S / rows);
    const ex = Math.min(fx, cw - fx), ey = Math.min(fy, S / rows - fy);
    const e = Math.min(ex, ey);
    const h0 = hash2(cx, r, 8), h1 = hash2(cx, r, 9);
    // reddish / grey / brown porphyry
    let R = 120 + h0 * 50, G = 95 + h0 * 30 + h1 * 20, B = 88 + h1 * 30;
    const grain = (hash2(x, y, 10) - 0.5) * 22;
    let hgt = 0.55 + 0.45 * Math.min(1, e / 9);
    if (e < 2.5) { R = G = B = 58; hgt = 0.05; }
    o[0] = clamp255(R + grain); o[1] = clamp255(G + grain); o[2] = clamp255(B + grain); o[3] = hgt;
  }, { strength: 3 });
}

/** Light concrete / granite (curbs, walls, planters; tile 1 m). */
export function concrete() {
  const S = 256;
  const n = tileNoise(31, S, S, 6);
  return surface('concrete', S, (x, y, o) => {
    const v = 176 + n(x, y, 4) * 14 + (hash2(x, y, 11) - 0.5) * 18;
    o[0] = clamp255(v); o[1] = clamp255(v - 1); o[2] = clamp255(v - 3); o[3] = 0.5 + (hash2(x, y, 12) - 0.5) * 0.3;
  }, { strength: 1.2 });
}

/** Grass lawn (tile 2 m): green with blade streaks, dry patches. */
export function grass() {
  const S = 256;
  const n = tileNoise(41, S, S, 5), m = tileNoise(42, S, S, 20);
  return surface('grass', S, (x, y, o) => {
    const big = n(x, y, 3), fine = m(x, y, 2);
    const b = hash2(x, y >> 2, 13), b2 = hash2(x >> 1, y, 14);
    let R = 70 + big * 18 + (b - 0.5) * 30, G = 118 + big * 22 + fine * 12 + (b2 - 0.5) * 34, B = 48 + big * 10;
    if (big > 0.35) { R += 30; G += 10; } // dry patch
    o[0] = clamp255(R); o[1] = clamp255(G); o[2] = clamp255(B); o[3] = 0.5 + (b - 0.5) * 0.5;
  }, { strength: 1.5 });
}

/** Forest floor / dirt (tile 2 m). */
export function dirt() {
  const S = 256;
  const n = tileNoise(51, S, S, 6);
  return surface('dirt', S, (x, y, o) => {
    const v = n(x, y, 4), g = hash2(x, y, 15), p = hash2(x >> 2, y >> 2, 16);
    let R = 110 + v * 26 + (g - 0.5) * 24, G = 86 + v * 20 + (g - 0.5) * 20, B = 62 + v * 14;
    let hgt = 0.5 + v * 0.3;
    if (p > 0.93) { R += 40; G += 36; B += 30; hgt += 0.3; } // pebbles
    o[0] = clamp255(R); o[1] = clamp255(G); o[2] = clamp255(B); o[3] = hgt;
  }, { strength: 2 });
}

/** Sand with wind ripples (tile 2 m). */
export function sand() {
  const S = 256;
  const n = tileNoise(61, S, S, 4);
  return surface('sand', S, (x, y, o) => {
    const v = n(x, y, 3), rip = Math.sin((y + v * 40) * (Math.PI * 2 / 21));
    const g = (hash2(x, y, 17) - 0.5) * 18;
    o[0] = clamp255(222 + v * 14 + rip * 6 + g); o[1] = clamp255(196 + v * 12 + rip * 6 + g); o[2] = clamp255(150 + v * 10 + rip * 4 + g);
    o[3] = 0.5 + rip * 0.25 + v * 0.1;
  }, { strength: 1.4 });
}

/** Snow (tile 2 m). */
export function snow() {
  const S = 256;
  const n = tileNoise(71, S, S, 4);
  return surface('snow', S, (x, y, o) => {
    const v = n(x, y, 3), g = (hash2(x, y, 18) - 0.5) * 8;
    o[0] = clamp255(236 + v * 10 + g); o[1] = clamp255(240 + v * 9 + g); o[2] = clamp255(248 + v * 6 + g); o[3] = 0.5 + v * 0.4;
  }, { strength: 1.2 });
}

/** Gravel / railway ballast (tile 1 m). */
export function gravel() {
  const S = 256;
  return surface('gravel', S, (x, y, o) => {
    // Voronoi-ish stones: nearest jittered cell center
    const cs = 12, cx = Math.floor(x / cs), cy = Math.floor(y / cs);
    let best = 1e9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const wx = ((gx % (S / cs)) + S / cs) % (S / cs), wy = ((gy % (S / cs)) + S / cs) % (S / cs);
      const px = (gx + hash2(wx, wy, 19)) * cs, py = (gy + hash2(wx, wy, 20)) * cs;
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < best) { best = d; id = hash2(wx, wy, 21); }
    }
    const e = Math.sqrt(best) / cs;
    const v = 120 + id * 70 - e * 40 + (hash2(x, y, 22) - 0.5) * 14;
    o[0] = clamp255(v + 4); o[1] = clamp255(v); o[2] = clamp255(v - 6); o[3] = 1 - e;
  }, { strength: 2.4 });
}

/** Rock (tile 2 m): grey with strata and cracks. */
export function rock() {
  const S = 256;
  const n = tileNoise(81, S, S, 5), m = tileNoise(82, S, S, 18);
  return surface('rock', S, (x, y, o) => {
    const v = n(x, y, 5), f = m(x, y, 2);
    const crack = Math.abs(n(x * 1.7 + 40, y * 1.7, 3)) < 0.02 ? 1 : 0;
    let c = 128 + v * 40 + f * 12 + (hash2(x, y, 23) - 0.5) * 14 - crack * 50;
    o[0] = clamp255(c + 6); o[1] = clamp255(c + 2); o[2] = clamp255(c - 4); o[3] = 0.5 + v * 0.5 - crack * 0.3;
  }, { strength: 3 });
}

/** Tree bark (u around the trunk, v along it; tile ~1 m). */
export function bark() {
  const S = 256;
  const n = tileNoise(91, S, S, 6);
  return surface('bark', S, (x, y, o) => {
    const ridge = Math.abs(Math.sin((x + n(x, y * 0.3, 3) * 30) * (Math.PI * 2 / 18)));
    const v = n(x, y, 3);
    let c = 70 + ridge * 40 + v * 16 + (hash2(x, y, 24) - 0.5) * 12;
    o[0] = clamp255(c * 1.0 + 6); o[1] = clamp255(c * 0.82); o[2] = clamp255(c * 0.66); o[3] = ridge * 0.8 + v * 0.2;
  }, { strength: 3.5 });
}

/** Birch bark: white with dark horizontal lenticels. */
export function birch() {
  const S = 256;
  const n = tileNoise(92, S, S, 5);
  return surface('birch', S, (x, y, o) => {
    const v = n(x, y, 3);
    const band = hash2(Math.floor(x / 22), Math.floor(y / 7), 25);
    const mark = band > 0.82 && Math.abs(((y % 7) + 7) % 7 - 3) < 1.6 ? 1 : 0;
    const blot = n(x * 2, y * 0.6, 2) > 0.38 ? 1 : 0;
    let c = 226 + v * 14 - mark * 170 - blot * 120;
    o[0] = clamp255(c); o[1] = clamp255(c - 2); o[2] = clamp255(c - 8); o[3] = 0.6 - mark * 0.5 - blot * 0.3;
  }, { strength: 2 });
}

/** Palm trunk rings (v along the trunk). */
export function palmBark() {
  const S = 256;
  const n = tileNoise(93, S, S, 6);
  return surface('palmbark', S, (x, y, o) => {
    const ring = (y % 32) / 32;
    const r = ring < 0.18 ? ring / 0.18 : 1;
    const v = n(x, y, 3);
    const c = 95 + r * 40 + v * 18 + (hash2(x, y, 26) - 0.5) * 10;
    o[0] = clamp255(c * 1.05); o[1] = clamp255(c * 0.9); o[2] = clamp255(c * 0.7); o[3] = r * 0.9;
  }, { strength: 3 });
}

/** Bricks in running bond (tile 1 m: 4 bricks wide, 15 courses). */
export function bricks() {
  const S = 256, cw = S / 4, ch = S / 15;
  const n = tileNoise(111, S, S, 6);
  return surface('bricks', S, (x, y, o) => {
    const row = Math.floor(y / ch), off = (row % 2) * cw * 0.5;
    const bx = Math.floor((x + off) / cw), fx = ((x + off) % cw + cw) % cw, fy = y - row * ch;
    const e = Math.min(fx, cw - fx, fy, ch - fy);
    const tone = hash2(bx, row, 30);
    let R = 150 + tone * 40 + n(x, y, 3) * 14, G = 72 + tone * 22, B = 52 + tone * 14;
    let hgt = 0.7;
    if (e < 1.6) { R = 182; G = 174; B = 160; hgt = 0.15; }
    const g = (hash2(x, y, 31) - 0.5) * 16;
    o[0] = clamp255(R + g); o[1] = clamp255(G + g); o[2] = clamp255(B + g); o[3] = hgt;
  }, { strength: 2.2 });
}

/** End grain of a cut log (rings), not tiled. */
export function endGrain() {
  if (cache.has('endgrain')) return cache.get('endgrain');
  const S = 128, c = canvas(S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
    const ring = 0.5 + 0.5 * Math.sin(r * 38 + Math.sin(Math.atan2(y - S / 2, x - S / 2) * 3) * 0.6);
    let R = 196 + ring * 22, G = 160 + ring * 18, B = 112 + ring * 10;
    if (r > 0.9) { R = 92; G = 70; B = 52; }
    const i = (y * S + x) * 4;
    d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const res = { map: toTex(c, { repeat: false }) };
  cache.set('endgrain', res);
  return res;
}

/** Water: subtle ripple normal map (tile 3 m). */
export function water() {
  if (cache.has('water')) return cache.get('water');
  const S = 256;
  const n = tileNoise(101, S, S, 6);
  const hf = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hf[y * S + x] = n(x, y, 3) * 0.5 + 0.5;
  const res = { normalMap: toTex(normalFrom(hf, S, S, 3), { srgb: false }) };
  cache.set('water', res);
  return res;
}

/** Chain-link fence mesh (alpha cut-out; tile 1 m). */
export function chainLink() {
  if (cache.has('chain')) return cache.get('chain');
  const S = 128, c = canvas(S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = '#c9cdd2';
  ctx.lineWidth = 2.2;
  const k = S / 8;
  for (let i = -8; i <= 16; i++) {
    ctx.beginPath(); ctx.moveTo(i * k, 0); ctx.lineTo(i * k + S, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i * k, 0); ctx.lineTo(i * k - S, S); ctx.stroke();
  }
  const res = { map: toTex(c) };
  cache.set('chain', res);
  return res;
}

// ------------------------------------------------------------------ signs & decals
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Italian road sign faces (256 px). The sign geometry carries the outline shape. */
export const SIGN_TYPES = [
  ['stop', 'Stop'], ['precedenza', 'Dare precedenza'], ['divieto_sosta', 'Divieto di sosta'], ['divieto_accesso', 'Senso vietato'],
  ['limite', 'Limite 50'], ['pedonale', 'Attraversamento'], ['senso_unico', 'Senso unico'], ['parcheggio', 'Parcheggio'],
  ['pericolo', 'Pericolo'], ['rotatoria', 'Rotatoria'], ['direzione', 'Indicazioni'], ['scuola', 'Scuola'],
];
export const SIGN_SHAPE = { stop: 'oct', precedenza: 'tri_down', divieto_sosta: 'circle', divieto_accesso: 'circle', limite: 'circle', pedonale: 'square', senso_unico: 'rect', parcheggio: 'square', pericolo: 'tri', rotatoria: 'circle', direzione: 'wide', scuola: 'tri' };

export function signTex(kind) {
  const key = 'sign:' + kind;
  if (cache.has(key)) return cache.get(key);
  const wide = kind === 'direzione' || kind === 'senso_unico';
  const W = 256, H = wide ? 128 : 256, c = canvas(W, H), ctx = c.getContext('2d');
  const RED = '#c8102e', BLUE = '#1d4f9c', WHITE = '#f4f4f0', BLACK = '#161616', GREEN = '#0f6b3a';
  ctx.fillStyle = '#9a9a9a'; ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const circle = (r, fill) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
  const tri = (down, border, inner) => {
    const s = down ? -1 : 1;
    const pts = (k) => [[cx, cy - s * 110 * k], [cx + 118 * k, cy + s * 92 * k], [cx - 118 * k, cy + s * 92 * k]];
    ctx.fillStyle = border; ctx.beginPath(); pts(1).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.fill();
    ctx.fillStyle = inner; ctx.beginPath(); pts(0.72).forEach(([x, y], i) => (i ? ctx.lineTo(x, y + s * 8) : ctx.moveTo(x, y + s * 8))); ctx.fill();
  };
  switch (kind) {
    case 'stop': {
      ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = RED; ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; ctx.lineTo(cx + Math.cos(a) * 118, cy + Math.sin(a) * 118); }
      ctx.fill();
      ctx.fillStyle = WHITE; ctx.font = 'bold 74px Arial, sans-serif'; ctx.fillText('STOP', cx, cy + 4);
      break;
    }
    case 'precedenza': ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H); tri(true, RED, WHITE); break;
    case 'pericolo': ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H); tri(false, RED, WHITE); ctx.fillStyle = BLACK; ctx.fillRect(cx - 9, cy - 34, 18, 56); ctx.beginPath(); ctx.arc(cx, cy + 42, 10, 0, 7); ctx.fill(); break;
    case 'scuola': {
      ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H); tri(false, RED, WHITE);
      ctx.fillStyle = BLACK;
      for (const [x, s] of [[cx - 22, 1], [cx + 18, 0.85]]) {
        ctx.beginPath(); ctx.arc(x, cy - 22 * s, 11 * s, 0, 7); ctx.fill();
        ctx.fillRect(x - 9 * s, cy - 10 * s, 18 * s, 38 * s);
        ctx.fillRect(x - 9 * s, cy + 26 * s, 7 * s, 26 * s); ctx.fillRect(x + 2 * s, cy + 26 * s, 7 * s, 26 * s);
      }
      break;
    }
    case 'divieto_sosta': circle(120, RED); circle(94, BLUE); ctx.strokeStyle = RED; ctx.lineWidth = 24; ctx.beginPath(); ctx.moveTo(cx - 68, cy - 68); ctx.lineTo(cx + 68, cy + 68); ctx.stroke(); break;
    case 'divieto_accesso': circle(120, RED); ctx.fillStyle = WHITE; ctx.fillRect(cx - 86, cy - 22, 172, 44); break;
    case 'limite': circle(120, RED); circle(94, WHITE); ctx.fillStyle = BLACK; ctx.font = 'bold 96px Arial, sans-serif'; ctx.fillText('50', cx, cy + 6); break;
    case 'rotatoria': {
      circle(120, BLUE); ctx.strokeStyle = WHITE; ctx.fillStyle = WHITE; ctx.lineWidth = 18;
      for (let i = 0; i < 3; i++) {
        const a0 = (i * 2 * Math.PI) / 3 - 0.2, a1 = a0 + 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, 60, a0, a1); ctx.stroke();
        const ex = cx + Math.cos(a1) * 60, ey = cy + Math.sin(a1) * 60, tx = -Math.sin(a1), ty = Math.cos(a1);
        ctx.beginPath(); ctx.moveTo(ex + tx * 22, ey + ty * 22); ctx.lineTo(ex + Math.cos(a1) * 22, ey + Math.sin(a1) * 22); ctx.lineTo(ex - Math.cos(a1) * 22, ey - Math.sin(a1) * 22); ctx.fill();
      }
      break;
    }
    case 'pedonale': {
      ctx.fillStyle = BLUE; roundRect(ctx, 6, 6, W - 12, H - 12, 16); ctx.fill();
      ctx.fillStyle = WHITE; ctx.beginPath(); ctx.moveTo(cx, 30); ctx.lineTo(W - 30, H - 40); ctx.lineTo(30, H - 40); ctx.closePath(); ctx.fill();
      ctx.fillStyle = BLACK;
      for (let i = 0; i < 4; i++) ctx.fillRect(68 + i * 32, H - 70, 18, 16);
      ctx.beginPath(); ctx.arc(cx + 6, 98, 12, 0, 7); ctx.fill();
      ctx.lineWidth = 10; ctx.strokeStyle = BLACK; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx + 4, 112); ctx.lineTo(cx - 2, 150); ctx.lineTo(cx - 18, 176); ctx.moveTo(cx - 2, 150); ctx.lineTo(cx + 16, 176); ctx.moveTo(cx - 16, 128); ctx.lineTo(cx + 22, 134); ctx.stroke();
      break;
    }
    case 'parcheggio': ctx.fillStyle = BLUE; roundRect(ctx, 6, 6, W - 12, H - 12, 16); ctx.fill(); ctx.fillStyle = WHITE; ctx.font = 'bold 190px Arial, sans-serif'; ctx.fillText('P', cx, cy + 12); break;
    case 'senso_unico': {
      ctx.fillStyle = BLUE; roundRect(ctx, 4, 4, W - 8, H - 8, 10); ctx.fill();
      ctx.fillStyle = WHITE; ctx.fillRect(40, cy - 14, 130, 28);
      ctx.beginPath(); ctx.moveTo(160, cy - 40); ctx.lineTo(220, cy); ctx.lineTo(160, cy + 40); ctx.fill();
      break;
    }
    case 'direzione': {
      ctx.fillStyle = GREEN; roundRect(ctx, 4, 4, W - 8, H - 8, 10); ctx.fill();
      ctx.strokeStyle = WHITE; ctx.lineWidth = 4; roundRect(ctx, 12, 12, W - 24, H - 24, 8); ctx.stroke();
      ctx.fillStyle = WHITE; ctx.font = 'bold 34px Arial, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('CENTRO', 26, cy);
      ctx.beginPath(); ctx.moveTo(196, cy - 26); ctx.lineTo(236, cy); ctx.lineTo(196, cy + 26); ctx.fill();
      break;
    }
    default: break;
  }
  const res = { map: toTex(c, { repeat: false }) };
  cache.set(key, res);
  return res;
}

/** Text decal (transparent background) for vehicles / shelters: TAXI, POLIZIA, AMBULANZA, BUS… */
export function textTex(text, { color = '#ffffff', bg = null, w = 512, h = 128, font = 'bold 84px Arial, sans-serif', mirror = false } = {}) {
  const key = `text:${text}:${color}:${bg}:${w}x${h}:${mirror}`;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(w, h), ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.fillStyle = color; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.fillText(text, w / 2, h / 2 + 4);
  const res = { map: toTex(c, { repeat: false }) };
  cache.set(key, res);
  return res;
}

/** Newsstand magazines / posters: a grid of colorful covers. */
export function magazines() {
  if (cache.has('mags')) return cache.get('mags');
  const W = 256, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
  const cols = ['#c0392b', '#2980b9', '#f1c40f', '#27ae60', '#8e44ad', '#e67e22', '#ecf0f1', '#16a085', '#d35400', '#2c3e50'];
  let k = 0;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) {
    const px = x * 32 + 2, py = y * 64 + 3;
    ctx.fillStyle = cols[(k++ * 7) % cols.length]; ctx.fillRect(px, py, 28, 58);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(px + 3, py + 4, 22, 7);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(px + 4, py + 18, 20, 28);
  }
  const res = { map: toTex(c, { repeat: false }) };
  cache.set('mags', res);
  return res;
}

/** Timetable / poster panel (bus stop). */
export function posterTex() {
  if (cache.has('poster')) return cache.get('poster');
  const W = 128, H = 256, c = canvas(W, H), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#f2c14e'); g.addColorStop(1, '#e8743b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(64, 96, 38, 0, 7); ctx.fill();
  ctx.fillStyle = '#1f2a44'; ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center'; ctx.fillText('ESTATE', 64, 190); ctx.font = '14px Arial'; ctx.fillText('in città', 64, 214);
  const res = { map: toTex(c, { repeat: false }) };
  cache.set('poster', res);
  return res;
}
