// Extra prop types used by the landscapes (registered in the props catalog,
// category "Paesaggio" of the Oggetti library): fountain, boats, pier,
// containers, harbour crane, rooftop, neon sign, market stall, well, cart,
// ruins, hay, beach umbrella and sunbed, cactus, tropical plants, ferns,
// lantern, campfire. Regular props: movable, editable, saved, every style.
import * as THREE from 'three';
import { box, boxOn, cylinder, lathe, rod, sphere, torus, planeXZ, place } from '../props/geo.js';
import { range, int, seg, flag, seed as seedParam } from '../props/params.js';
import { makeRng, makeNoise2 } from './rand.js';
import { waterNormal, groundDetail } from './env/textures.js';
import { facadeTextures } from './env/vegetation.js';

const DEG = Math.PI / 180;
const _c = new THREE.Color();

/** Paints a geometry with a vertex colour (sRGB hex). */
function vc(geo, hex) {
  _c.set(hex);
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/** Sets planar UVs in meters (x / su, y / sv) on a geometry facing ±Z, or XZ with mode 'xz'. */
function uvMeters(geo, su, sv, mode = 'xy') {
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (mode === 'zy' ? p.getZ(i) : p.getX(i)) / su;
    uv[i * 2 + 1] = (mode === 'xz' ? p.getZ(i) : p.getY(i)) / sv;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ------------------------------------------------------------------ roles
export const LANDSCAPE_ROLES = {
  'l:water': () => ({ kind: 'prop', color: '#6aa0b3', normalMap: waterNormal(), normalScale: 0.3, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.82 }),
  'l:sail': () => ({ kind: 'prop', color: '#f1ede2', roughness: 0.9, side: 'double', sheen: 0.3 }),
  'l:hay': () => ({ kind: 'prop', color: '#d2ad58', map: groundDetail().map, normalMap: groundDetail().normalMap, normalScale: 1.2, roughness: 0.97 }),
  'l:flame': () => ({ kind: 'prop', color: '#ffb347', emissive: '#ff8a2a', emissiveIntensity: 2.4, roughness: 1 }),
  'l:lamp': () => ({ kind: 'prop', color: '#fff1cf', emissive: '#ffcf86', emissiveIntensity: 1.6, roughness: 0.4 }),
  'l:lampOff': () => ({ kind: 'prop', color: '#e9e2cf', roughness: 0.3 }),
  'l:vc': () => ({ kind: 'prop', color: '#ffffff', roughness: 0.8, vertexColors: true }),
  'l:whiteD': () => ({ kind: 'prop', color: '#f2eee4', roughness: 0.8, side: 'double', sheen: 0.3 }),
  'l:leafD': (c) => ({ kind: 'prop', color: c, roughness: 0.75, side: 'double', vertexColors: true }),
  'l:facade': () => ({ kind: 'prop', color: '#ffffff', map: facadeTextures().map, roughness: 0.75 }),
  'l:facadeLit': () => ({ kind: 'prop', color: '#ffffff', map: facadeTextures().map, emissive: '#ffd28a', emissiveMap: facadeTextures().emap, emissiveIntensity: 1.1, roughness: 0.75 }),
  'l:roof': () => ({ kind: 'prop', color: '#b5b1a8', map: groundDetail().map, normalMap: groundDetail().normalMap, normalScale: 0.6, roughness: 0.95 }),
  'l:rust': () => ({ kind: 'prop', color: '#7a4a32', roughness: 0.8, metalness: 0.3 }),
  'l:rubber': () => ({ kind: 'prop', color: '#1d1d1f', roughness: 0.85 }),
  'l:stone': () => ({ kind: 'prop', color: '#c9c1b2', map: groundDetail().map, normalMap: groundDetail().normalMap, normalScale: 1, roughness: 0.92 }),
  'l:marble': () => ({ kind: 'prop', color: '#e8e3d8', map: groundDetail().map, normalMap: groundDetail().normalMap, normalScale: 0.5, roughness: 0.55 }),
  'l:cactus': () => ({ kind: 'prop', color: '#5f7f3e', roughness: 0.7 }),
  'l:bark': () => ({ kind: 'prop', color: '#5d4a3a', map: groundDetail().map, normalMap: groundDetail().normalMap, normalScale: 1.5, roughness: 0.95 }),
};

// ------------------------------------------------------------------ neon texture
const _neon = new Map();
const NEON_COLORS = { rosa: '#ff4fb8', blu: '#43b6ff', verde: '#55ff8a', rosso: '#ff3b3b', giallo: '#ffd23f', viola: '#b467ff' };
function neonTex(text, color) {
  const key = text + color;
  if (_neon.has(key)) return _neon.get(key);
  const W = 512, H = 160, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.font = 'bold 104px "Arial Rounded MT Bold", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 26;
  g.strokeStyle = color; g.lineWidth = 10; g.strokeText(text, W / 2, H / 2 + 4);
  g.shadowBlur = 8; g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.strokeText(text, W / 2, H / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _neon.set(key, t);
  return t;
}

// ------------------------------------------------------------------ generators
function fontana(p) {
  const R = p.size / 2, out = { 'l:stone': [], 'l:water': [] };
  const st = out['l:stone'];
  if (p.style === 'moderna') {
    st.push(boxOn(p.size, 0.42, p.size * 0.7, { r: 0.03 }));
    out['l:water'].push(planeXZ(p.size - 0.3, p.size * 0.7 - 0.3, { y: 0.36 }));
    out['c:steel'] = [];
    for (let i = 0; i < 5; i++) out['c:steel'].push(cylinder(0.04, 0.04, 0.08, { x: (i - 2) * p.size * 0.16, y: 0.36, seg: 10 }));
    if (p.water) { out['l:jet'] = []; for (let i = 0; i < 5; i++) out['l:jet'].push(cylinder(0.035, 0.01, 0.9 + (i % 2) * 0.5, { x: (i - 2) * p.size * 0.16, y: 0.4, seg: 8 })); }
    return out;
  }
  // basin rim: ring lathe (outer wall, top, inner wall)
  const h = 0.55, t = 0.32;
  st.push(lathe([[R - t, 0.12], [R - t, h], [R - t + 0.04, h + 0.05], [R + 0.02, h + 0.05], [R + 0.06, h], [R, h - 0.06], [R, 0.06], [R + 0.08, 0], [R - t, 0]], { seg: p.style === 'vasca' ? 8 : 48 }));
  st.push(cylinder(R - t + 0.01, R - t + 0.01, 0.12, { bevel: 0, seg: p.style === 'vasca' ? 8 : 40 }));
  out['l:water'].push(cylinder(R - t, R - t, 0.4, { bevel: 0, seg: p.style === 'vasca' ? 8 : 40 }));
  // central pedestal + bowls
  const pedR = Math.max(0.18, R * 0.12);
  st.push(lathe([[0, 0], [pedR * 1.6, 0], [pedR * 1.3, 0.25], [pedR, 0.45], [pedR * 0.8, 1.2], [pedR * 1.1, 1.3], [0, 1.3]], { seg: 24 }));
  const b1 = Math.max(0.6, R * 0.5);
  st.push(lathe([[0, 1.25], [b1 * 0.25, 1.28], [b1, 1.5], [b1 * 1.03, 1.58], [b1 * 0.92, 1.58], [b1 * 0.2, 1.42], [0, 1.42]], { seg: 32 }));
  out['l:water'].push(cylinder(b1 * 0.9, b1 * 0.9, 0.06, { y: 1.48, bevel: 0, seg: 28 }));
  st.push(lathe([[0, 1.4], [pedR * 0.6, 1.42], [pedR * 0.45, 2.1], [b1 * 0.45, 2.3], [b1 * 0.48, 2.38], [0, 2.32]], { seg: 24 }));
  st.push(sphere(pedR * 0.7, { y: 2.55, ws: 16, hs: 10 }));
  if (p.water) {
    out['l:jet'] = [cylinder(0.05, 0.02, 0.5, { y: 2.6, seg: 8 })];
    for (let k = 0; k < 8; k++) out['l:jet'].push(rod([Math.cos(k * 45 * DEG) * b1 * 0.95, 1.55, Math.sin(k * 45 * DEG) * b1 * 0.95], [Math.cos(k * 45 * DEG) * b1 * 1.15, 0.45, Math.sin(k * 45 * DEG) * b1 * 1.15], 0.02, { seg: 5 }));
  }
  if (p.style === 'vasca') st.push(cylinder(0.5, 0.42, 0.25, { y: 2.35, seg: 8 }));
  return out;
}

/** Hull lofted from U-shaped sections. */
function hull(L, W, D, sharpBow, color) {
  const NX = 18, NU = 10, pos = [], idx = [];
  for (let i = 0; i <= NX; i++) {
    const t = i / NX, x = (t - 0.5) * L;
    const bow = t > 0.6 ? Math.pow((t - 0.6) / 0.4, sharpBow ? 1.6 : 2.4) : 0;
    const stern = t < 0.08 ? (0.08 - t) / 0.08 * 0.25 : 0;
    const w = (W / 2) * Math.max(0.02, 1 - bow * 0.98 - stern), d = D * (1 - bow * 0.35) , sheer = bow * D * 0.35;
    for (let j = 0; j <= NU; j++) {
      const a = (j / NU) * Math.PI; // 0 = port rim, pi = starboard rim
      const y = -Math.sin(a) * d + sheer, z = Math.cos(a) * w;
      pos.push(x, y + D, z);
    }
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NU; j++) {
    const a = i * (NU + 1) + j, b = a + NU + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function barca(p) {
  const L = p.length, W = L * (p.kind === 'remi' ? 0.34 : 0.32), D = p.kind === 'remi' ? 0.55 : 0.9;
  const out = { main: [hull(L, W, D, p.kind !== 'remi')], 'c:wood': [], 'c:white': [] };
  // waterline sits at y = D * 0.45: the prop origin is the water surface
  const sink = -D * 0.45;
  out.main[0].translate(0, sink, 0);
  out['c:wood'].push(box(L * 0.92, 0.04, W * 0.9, { y: sink + D * 0.35, r: 0 }));
  if (p.kind === 'remi') {
    for (const x of [-0.25, 0.15]) out['c:wood'].push(box(0.22, 0.04, W * 0.92, { x: x * L, y: sink + D * 0.75, r: 0.01 }));
    out['c:wood'].push(rod([-0.05 * L, sink + D, -W * 0.48], [-0.05 * L - 0.4, sink + D * 0.3, -W * 1.4], 0.025, { seg: 6 }));
    out['c:wood'].push(rod([-0.05 * L, sink + D, W * 0.48], [-0.05 * L - 0.4, sink + D * 0.3, W * 1.4], 0.025, { seg: 6 }));
  } else if (p.kind === 'pesca') {
    out['c:white'].push(boxOn(L * 0.28, 1.5, W * 0.7, { x: -L * 0.12, y: sink + D * 0.38, r: 0.05 }));
    out['c:glass'] = [box(0.04, 0.5, W * 0.55, { x: -L * 0.12 + L * 0.14 + 0.01, y: sink + D * 0.38 + 1.1, r: 0 })];
    out['c:steel'] = [rod([-L * 0.12, sink + D * 0.38 + 1.5, 0], [-L * 0.12, sink + D * 0.38 + 3.2, 0], 0.04, { seg: 8 }), rod([-L * 0.12, sink + D + 2.6, 0], [L * 0.35, sink + D + 0.5, 0], 0.025, { seg: 6 })];
  } else {
    const mh = L * 1.25;
    out['c:wood'].push(cylinder(0.06, 0.045, mh, { x: L * 0.08, y: sink + D * 0.4, seg: 10 }));
    out['c:wood'].push(rod([L * 0.08, sink + D + 0.5, 0], [-L * 0.42, sink + D + 0.55, 0], 0.035, { seg: 6 }));
    const sail = new THREE.BufferGeometry();
    sail.setAttribute('position', new THREE.Float32BufferAttribute([L * 0.06, sink + D + 0.58, 0, -L * 0.4, sink + D + 0.62, 0, L * 0.06, sink + D * 0.4 + mh - 0.2, 0], 3));
    sail.computeVertexNormals();
    const jib = new THREE.BufferGeometry();
    jib.setAttribute('position', new THREE.Float32BufferAttribute([L * 0.11, sink + D + 0.4, 0, L * 0.46, sink + D + 0.2, 0, L * 0.1, sink + D * 0.4 + mh * 0.85, 0], 3));
    jib.computeVertexNormals();
    out['l:sail'] = [sail, jib];
  }
  return out;
}

function molo(p) {
  const L = p.length, W = p.width, out = { 'c:wood': [], 'c:woodDark': [] };
  const n = Math.round(L / 0.22);
  for (let i = 0; i < n; i++) out['c:wood'].push(box(0.2, 0.05, W, { x: -L / 2 + 0.11 + i * (L / n), y: 0.45, r: 0.004 }));
  for (const z of [-W / 2 + 0.12, W / 2 - 0.12]) out['c:woodDark'].push(box(L, 0.18, 0.12, { y: 0.33, z, r: 0 }));
  for (let x = -L / 2 + 0.3; x <= L / 2; x += 2.4) for (const z of [-W / 2 + 0.12, W / 2 - 0.12]) out['c:woodDark'].push(cylinder(0.12, 0.12, 3.6, { x, y: -3, z, seg: 10, bevel: 0.01 }));
  if (p.bollards) for (let x = -L / 2 + 1.5; x < L / 2; x += 6) for (const z of [-W / 2 + 0.25, W / 2 - 0.25]) out['c:woodDark'].push(cylinder(0.1, 0.1, 0.45, { x, y: 0.47, z, seg: 10 }));
  return out;
}

function container(p) {
  const L = p.size === '40' ? 12.19 : 6.06, H = 2.59, W = 2.44;
  const out = { main: [boxOn(L, H, W, { r: 0.02 })], mainShade: [], 'c:steel': [] };
  for (let x = -L / 2 + 0.3; x < L / 2 - 0.2; x += 0.28) for (const z of [-W / 2 - 0.012, W / 2 + 0.012]) out.mainShade.push(box(0.12, H - 0.25, 0.03, { x, y: H / 2, z, r: 0 }));
  out.mainShade.push(box(0.03, H - 0.2, W - 0.25, { x: L / 2 + 0.015, y: H / 2, r: 0 }));
  for (const z of [-0.55, -0.2, 0.2, 0.55]) out['c:steel'].push(cylinder(0.018, 0.018, H - 0.3, { x: L / 2 + 0.05, y: 0.15, z, seg: 6, bevel: 0 }));
  return out;
}

function gru(p) {
  const H = p.height, S = 10, out = { main: [], darkMetal: [] };
  for (const x of [-S / 2, S / 2]) for (const z of [-S / 2, S / 2]) out.main.push(box(0.6, H, 0.6, { x, y: H / 2, z, r: 0 }));
  for (const x of [-S / 2, S / 2]) out.main.push(box(0.5, 0.6, S + 0.6, { x, y: H * 0.35, r: 0 }), box(0.5, 0.6, S + 0.6, { x, y: H, r: 0 }));
  out.main.push(box(S + 0.6, 1.2, S + 0.6, { y: H + 0.6, r: 0 }));
  out.main.push(box(3.5, 3, 4, { y: H + 2.7, x: 1, r: 0 }));
  const boom = H * 1.1;
  out.main.push(box(boom, 1.3, 1.3, { x: boom / 2 - 6, y: H + 2, z: 0, r: 0 }));
  out.darkMetal.push(rod([boom - 6, H + 2, 0], [boom - 6, H * 0.45, 0], 0.05, { seg: 5 }), box(1.6, 0.8, 1.2, { x: boom - 6, y: H * 0.43, r: 0 }));
  for (const x of [-S / 2, S / 2]) for (const z of [-S / 2, S / 2]) out.darkMetal.push(box(1.4, 0.7, 1.4, { x, y: 0.35, z, r: 0 }));
  return out;
}

function tetto(p) {
  const W = p.width, D = p.depth, drop = p.drop, ph = p.parapet, out = { 'l:roof': [], 'c:concrete': [], [p.night ? 'l:facadeLit' : 'l:facade']: [], 'c:metalDark': [], 'c:galv': [] };
  // roof slab (top at y = 0) and the building below
  out['l:roof'].push(uvMeters(planeXZ(W, D, { y: 0 }), 2.5, 2.5, 'xz'));
  const fac = out[p.night ? 'l:facadeLit' : 'l:facade'];
  for (const [w, ry, x, z] of [[W, 0, 0, D / 2], [W, 180, 0, -D / 2], [D, 90, W / 2, 0], [D, -90, -W / 2, 0]]) {
    const g = new THREE.PlaneGeometry(w, drop);
    g.translate(0, -drop / 2 - 0.3, 0);
    uvMeters(g, 15, 51.2);
    place(g, { ry, x, z });
    fac.push(g);
  }
  // parapet (top cap + walls)
  const t = 0.25;
  for (const [w, d, x, z] of [[W + t * 2, t, 0, D / 2 + t / 2], [W + t * 2, t, 0, -D / 2 - t / 2], [t, D, W / 2 + t / 2, 0], [t, D, -W / 2 - t / 2, 0]]) out['c:concrete'].push(box(w, ph + 0.3, d, { x, y: (ph - 0.3) / 2, z, r: 0 }));
  const rnd = makeRng(p.seed || 1);
  if (p.tank) { // water tank on legs (New York style)
    const x = rnd.range(-W * 0.3, W * 0.3), z = -D / 2 + 3;
    out['c:woodDark'] = [cylinder(1.3, 1.3, 2.6, { x, z, y: 2.2, seg: 18, bevel: 0.02 }), lathe([[0, 4.8], [1.42, 4.8], [0, 5.8]], { seg: 18, x, z })];
    for (const a of [45, 135, 225, 315]) out['c:metalDark'].push(rod([x + Math.cos(a * DEG) * 1.1, 0, z + Math.sin(a * DEG) * 1.1], [x + Math.cos(a * DEG) * 1.0, 2.25, z + Math.sin(a * DEG) * 1.0], 0.07, { seg: 6 }));
  }
  if (p.hvac) for (let i = 0; i < 3; i++) {
    const x = -W / 2 + 2 + i * 2.2 + rnd.range(0, 0.6), z = D / 2 - 2.2 - rnd.range(0, D * 0.3);
    out['c:galv'].push(boxOn(1.6, 1.1, 1.2, { x, z, r: 0.03 }));
    out['c:metalDark'].push(cylinder(0.42, 0.42, 0.06, { x, z, y: 1.1, seg: 16, bevel: 0 }));
  }
  if (p.exit) out['c:concrete'].push(boxOn(3, 2.8, 3.4, { x: W / 2 - 2.5, z: -D / 2 + 2.5, r: 0.02 })), out['c:metalDark'].push(box(1, 2.1, 0.06, { x: W / 2 - 2.5, y: 1.05, z: -D / 2 + 4.22, r: 0 }));
  if (p.antenna) out['c:galv'].push(rod([-W / 2 + 2, 0, -D / 2 + 2], [-W / 2 + 2, 8, -D / 2 + 2], 0.06, { seg: 6 }), rod([-W / 2 + 1.2, 6, -D / 2 + 2], [-W / 2 + 2.8, 6, -D / 2 + 2], 0.03, { seg: 4 }));
  out['c:metalDark'].push(...[0, 1, 2].map((i) => cylinder(0.12, 0.12, 0.7, { x: rnd.range(-W / 3, W / 3), z: rnd.range(-D / 3, D / 3) + i, seg: 10 })));
  return out;
}

function insegna(p) {
  const W = p.width, H = W * 0.31;
  const col = NEON_COLORS[p.color] || NEON_COLORS.rosa;
  const tex = neonTex(p.text, col);
  const out = { 'c:metalDark': [], neon: [] };
  if (p.mount === 'bandiera') {
    out['c:metalDark'].push(box(0.12, H + 0.1, W + 0.1, { x: 0, y: H / 2, z: W / 2 + 0.25, r: 0.01 }), rod([0, H * 0.8, 0], [0, H * 0.8, 0.3], 0.03, { seg: 6 }), rod([0, H * 0.2, 0], [0, H * 0.2, 0.3], 0.03, { seg: 6 }));
    for (const s of [1, -1]) { const g = new THREE.PlaneGeometry(W, H); g.rotateY(s * 90 * DEG); g.translate(s * 0.065, H / 2, W / 2 + 0.25); out.neon.push(g); }
  } else {
    out['c:metalDark'].push(box(W + 0.1, H + 0.1, 0.1, { y: H / 2, z: 0.05, r: 0.01 }));
    const g = new THREE.PlaneGeometry(W, H); g.translate(0, H / 2, 0.106); out.neon.push(g);
  }
  out.$specs = { neon: () => ({ kind: 'prop', color: '#ffffff', map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 1.6, roughness: 0.4 }) };
  return out;
}

function bancarella(p) {
  const W = p.width, D = 1.4, rnd = makeRng(p.seed || 1), out = { 'c:wood': [], canopy: [], 'l:whiteD': [], 'l:vc': [] };
  out['c:wood'].push(boxOn(W, 0.06, D, { y: 0.85, r: 0.01 }), boxOn(W - 0.1, 0.8, 0.05, { z: D / 2 - 0.05, r: 0 }));
  for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) out['c:wood'].push(boxOn(0.07, z < 0 ? 2.4 : 2.1, 0.07, { x, z, r: 0 }));
  // striped canopy (two slopes)
  const n = Math.max(4, Math.round(W / 0.35));
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(W / n, D + 0.5);
    g.rotateX(-Math.PI / 2 + 0.28);
    g.translate(-W / 2 + (i + 0.5) * (W / n), 2.28, 0.05);
    out[i % 2 ? 'l:whiteD' : 'canopy'].push(g);
  }
  const goods = ['#d84a2b', '#f0c02e', '#6aa043', '#8b5a2b', '#e07b2e', '#7a2f6b'];
  for (let i = 0; i < Math.round(W * 3); i++) {
    const x = -W / 2 + 0.2 + rnd() * (W - 0.4), z = -D / 2 + 0.2 + rnd() * (D - 0.5);
    out['l:vc'].push(vc(rnd() < 0.5 ? sphere(0.09 + rnd() * 0.05, { x, y: 0.97, z, ws: 10, hs: 8 }) : boxOn(0.3, 0.14, 0.22, { x, y: 0.91, z, r: 0.01 }), rnd.pick(goods)));
  }
  return out;
}

function pozzo(p) {
  const R = p.radius, out = { 'l:stone': [lathe([[R - 0.22, 0], [R, 0], [R + 0.03, 0.82], [R - 0.25, 0.85], [R - 0.22, 0.1]], { seg: 28 })], 'c:wood': [], 'c:woodDark': [], 'l:water': [cylinder(R - 0.22, R - 0.22, 0.3, { seg: 24, bevel: 0 })] };
  for (const s of [-1, 1]) out['c:wood'].push(boxOn(0.12, 2.2, 0.12, { x: s * (R + 0.02), y: 0.6, r: 0.01 }));
  out['c:wood'].push(rod([-R - 0.1, 2.3, 0], [R + 0.1, 2.3, 0], 0.06, { seg: 10 }));
  if (p.roof) for (const s of [-1, 1]) out['c:woodDark'].push(box(R * 2 + 0.6, 0.05, 1.2, { y: 2.75, z: s * 0.42, rx: s * 32, r: 0 }));
  out['c:woodDark'].push(cylinder(0.16, 0.13, 0.26, { x: R * 0.3, y: 1.35, seg: 12 }));
  return out;
}

function carretto(p) {
  const out = { 'c:wood': [], 'c:woodDark': [], darkMetal: [] };
  out['c:wood'].push(boxOn(2.2, 0.06, 1.3, { y: 0.75, r: 0.01 }));
  for (const z of [-0.62, 0.62]) out['c:wood'].push(boxOn(2.2, 0.4, 0.05, { y: 0.8, z, r: 0.005 }));
  out['c:wood'].push(boxOn(0.05, 0.4, 1.3, { x: -1.08, y: 0.8, r: 0.005 }));
  for (const z of [-0.45, 0.45]) out['c:woodDark'].push(rod([1.1, 0.78, z], [2.8, 0.55, z * 0.6], 0.04, { seg: 6 }));
  for (const z of [-0.78, 0.78]) {
    out['c:woodDark'].push(torus(0.55, 0.045, { x: -0.2, y: 0.58, z, rs: 6, ts: 24 }));
    for (let k = 0; k < 6; k++) out['c:woodDark'].push(rod([-0.2, 0.58, z], [-0.2 + Math.cos(k * 60 * DEG) * 0.53, 0.58 + Math.sin(k * 60 * DEG) * 0.53, z], 0.022, { seg: 4 }));
  }
  out.darkMetal.push(rod([-0.2, 0.58, -0.85], [-0.2, 0.58, 0.85], 0.03, { seg: 6 }));
  if (p.load) { out['l:hay'] = [boxOn(1.9, 0.45, 1.1, { y: 0.8, r: 0.12 })]; }
  return out;
}

function rovina(p) {
  const rnd = makeRng(p.seed || 1), out = { 'l:marble': [], 'l:stone': [] };
  if (p.kind === 'colonne') {
    const n = p.count;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 2.6, standing = rnd() < 0.65, hgt = standing ? rnd.range(1.2, 5.5) : 0;
      out['l:stone'].push(boxOn(1.2, 0.3, 1.2, { x, r: 0.02 }));
      if (standing) out['l:marble'].push(cylinder(0.42, 0.36, hgt, { x, y: 0.3, seg: 16, bevel: 0.02 }));
      else for (let k = 0; k < 3; k++) out['l:marble'].push(place(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 16), { rz: 90, ry: rnd.range(-40, 40), x: x + rnd.range(-1.5, 1.5), y: 0.4, z: rnd.range(0.5, 2.5) }));
      if (standing && hgt > 4.5 && i < n - 1 && rnd() < 0.6) out['l:marble'].push(boxOn(3.2, 0.6, 1, { x: x + 1.3, y: 0.3 + hgt, r: 0.02 }));
    }
  } else if (p.kind === 'arco') {
    for (const s of [-1, 1]) out['l:stone'].push(boxOn(1, 3.2, 1, { x: s * 1.8, r: 0.02 }));
    for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI; out['l:stone'].push(box(0.55, 0.42, 1, { x: Math.cos(a) * 1.8, y: 3.2 + Math.sin(a) * 1.8, rz: (a / DEG) - 90, r: 0.01 })); }
  } else {
    const L = p.length;
    for (let x = -L / 2; x < L / 2 - 0.1; x += 0.6) {
      const top = Math.max(0.3, 2.8 * (0.5 + 0.5 * Math.sin(x * 0.7 + rnd() * 2)) * rnd.range(0.5, 1.1));
      for (let y = 0; y < top; y += 0.32) out['l:stone'].push(box(0.58, 0.3, 0.7, { x: x + 0.3 + ((y / 0.32) % 2) * 0.05, y: y + 0.15, r: 0.03 }));
    }
    for (let i = 0; i < Math.round(L); i++) out['l:stone'].push(box(0.5, 0.28, 0.6, { x: rnd.range(-L / 2, L / 2), y: 0.14, z: rnd.range(0.6, 2.2), ry: rnd.range(0, 90), r: 0.04 }));
  }
  return out;
}

function fieno(p) {
  const rnd = makeRng(p.seed || 1), out = { 'l:hay': [] };
  for (let i = 0; i < p.count; i++) {
    if (p.kind === 'rotoli') out['l:hay'].push(place(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 20), { rz: 90, ry: rnd.range(-30, 30), x: (i % 3) * 1.6 - 1.6, y: 0.75, z: Math.floor(i / 3) * 1.8 + rnd.range(-0.3, 0.3) }));
    else { const lvl = Math.floor(i / 4), k = i % 4; out['l:hay'].push(boxOn(1.1, 0.45, 0.5, { x: (k % 2) * 1.12 - 0.56 + lvl * 0.2, y: lvl * 0.45, z: Math.floor(k / 2) * 0.52 - 0.26, ry: rnd.range(-4, 4), r: 0.06 })); }
  }
  return out;
}

function ombrellone(p) {
  const R = p.radius, out = { 'c:steel': [cylinder(0.025, 0.025, 2.35, { seg: 8, bevel: 0 })], canopy: [], 'l:whiteD': [] };
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 2.45, 0, Math.cos(a1) * R, 2.05, Math.sin(a1) * R, Math.cos(a0) * R, 2.05, Math.sin(a0) * R], 3));
    g.computeVertexNormals();
    out[i % 2 ? 'l:whiteD' : 'canopy'].push(g);
  }
  return out;
}
function lettino(p) {
  const out = { 'c:white': [], main: [] };
  out['c:white'].push(boxOn(1.9, 0.05, 0.65, { y: 0.3, r: 0.01 }));
  for (const x of [-0.85, 0.85]) for (const z of [-0.28, 0.28]) out['c:white'].push(boxOn(0.05, 0.3, 0.05, { x, z, r: 0 }));
  out.main.push(boxOn(1.25, 0.07, 0.6, { x: -0.3, y: 0.35, r: 0.03 }), box(0.65, 0.07, 0.6, { x: 0.62, y: 0.55, rz: 32, r: 0.03 }));
  return out;
}

function cactus(p) {
  const rnd = makeRng(p.seed || 1), H = p.height, out = { 'l:cactus': [] };
  const c = out['l:cactus'];
  if (p.kind === 'barile') {
    c.push(lathe([[0, 0], [H * 0.42, 0.05], [H * 0.5, H * 0.45], [H * 0.35, H * 0.9], [0, H]], { seg: 14 }));
  } else if (p.kind === 'opunzia') {
    const pad = (x, y, z, ry, rz, s) => c.push(place(new THREE.SphereGeometry(0.22 * s, 10, 8).scale(1, 1.3, 0.25), { x, y, z, ry, rz }));
    pad(0, 0.3, 0, 0, 0, 1.2);
    for (let i = 0; i < 5 + Math.round(H * 3); i++) pad(rnd.range(-0.4, 0.4) * H, 0.45 + rnd() * H * 0.8, rnd.range(-0.2, 0.2), rnd.range(0, 180), rnd.range(-35, 35), rnd.range(0.7, 1.1));
  } else {
    const r = H * 0.055;
    c.push(cylinder(r, r * 0.85, H, { seg: 12, bevel: r * 0.8 }));
    const arms = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < arms; i++) {
      const a = rnd() * Math.PI * 2, y0 = H * rnd.range(0.3, 0.55), out_ = r * 2.6, up = H * rnd.range(0.2, 0.35);
      const dx = Math.cos(a), dz = Math.sin(a);
      c.push(rod([dx * r * 0.5, y0, dz * r * 0.5], [dx * out_, y0 + r, dz * out_], r * 0.7, { seg: 10 }));
      c.push(cylinder(r * 0.72, r * 0.62, up, { x: dx * out_, y: y0 + r * 0.5, z: dz * out_, seg: 10, bevel: r * 0.5 }));
    }
  }
  return out;
}

/** Big leaf (bent quad strip) from the origin along direction a with tilt. */
function leaf(len, wid, a, tilt, droop, hex, base = 0) {
  const pos = [], idx = [], N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N, w = wid * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) * 0.5;
    const d = len * t, y = base + Math.sin(tilt) * d - droop * t * t * len;
    const h = Math.cos(tilt) * d;
    for (const s of [-1, 1]) pos.push(Math.cos(a) * h - Math.sin(a) * w * s, y + Math.abs(s) * 0.02 * Math.sin(t * Math.PI), Math.sin(a) * h + Math.cos(a) * w * s);
  }
  for (let i = 0; i < N; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return vc(g, hex);
}
function tropicale(p) {
  const rnd = makeRng(p.seed || 1), H = p.height, out = { 'l:leafD': [], 'c:stem': [] };
  const greens = ['#2f6b2a', '#3d7f30', '#4a8a35', '#2a5e27'];
  const stems = 3 + Math.round(rnd() * 3);
  for (let s = 0; s < stems; s++) {
    const sx = rnd.range(-0.3, 0.3) * H * 0.3, sz = rnd.range(-0.3, 0.3) * H * 0.3, sh = H * rnd.range(0.35, 0.6);
    out['c:stem'].push(cylinder(0.035, 0.025, sh, { x: sx, z: sz, seg: 6, bevel: 0 }));
    const nl = 2 + Math.round(rnd() * 2);
    for (let i = 0; i < nl; i++) {
      const g = leaf(H * rnd.range(0.45, 0.7), H * rnd.range(0.18, 0.3), rnd() * Math.PI * 2, rnd.range(0.2, 0.9), rnd.range(0.2, 0.5), rnd.pick(greens), 0);
      g.translate(sx, sh, sz);
      out['l:leafD'].push(g);
    }
  }
  return out;
}
function felce(p) {
  const rnd = makeRng(p.seed || 1), H = p.height, out = { 'l:leafD': [] };
  const n = 9 + Math.round(rnd() * 6);
  for (let i = 0; i < n; i++) out['l:leafD'].push(leaf(H * rnd.range(0.8, 1.2), H * 0.22, (i / n) * Math.PI * 2 + rnd() * 0.3, rnd.range(0.5, 1.1), rnd.range(0.5, 0.9), rnd.pick(['#3f7a2e', '#4f8a38', '#5d9640']), 0.02));
  return out;
}

function lanterna(p) {
  const H = p.height, out = { 'c:woodDark': [], darkMetal: [], [p.lit ? 'l:lamp' : 'l:lampOff']: [] };
  if (p.style === 'torcia') {
    out['c:woodDark'].push(cylinder(0.05, 0.035, H, { seg: 8 }));
    out.darkMetal.push(cylinder(0.08, 0.1, 0.18, { y: H, seg: 10 }));
    if (p.lit) { out['l:flame'] = [lathe([[0, H + 0.15], [0.09, H + 0.2], [0.06, H + 0.38], [0, H + 0.55]], { seg: 10 })]; }
    return out;
  }
  out['c:woodDark'].push(boxOn(0.14, H, 0.14, { r: 0.01 }), box(0.7, 0.08, 0.08, { x: 0.3, y: H - 0.1, r: 0 }));
  out.darkMetal.push(boxOn(0.3, 0.05, 0.3, { x: 0.55, y: H - 0.55, r: 0 }), lathe([[0, H - 0.08], [0.2, H - 0.16], [0, H - 0.04]], { seg: 4, x: 0.55 }));
  out[p.lit ? 'l:lamp' : 'l:lampOff'].push(boxOn(0.24, 0.36, 0.24, { x: 0.55, y: H - 0.52, r: 0.01 }));
  return out;
}

function falo(p) {
  const rnd = makeRng(p.seed || 1), out = { 'l:stone': [], 'l:bark': [] };
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; out['l:stone'].push(place(new THREE.IcosahedronGeometry(0.13, 0).scale(1, 0.7, 1), { x: Math.cos(a) * 0.55, y: 0.06, z: Math.sin(a) * 0.55, ry: rnd() * 90 })); }
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; out['l:bark'].push(rod([Math.cos(a) * 0.4, 0.04, Math.sin(a) * 0.4], [Math.cos(a) * 0.05, 0.42, Math.sin(a) * 0.05], 0.045, { seg: 6 })); }
  if (p.lit) out['l:flame'] = [lathe([[0, 0.05], [0.24, 0.15], [0.16, 0.45], [0.06, 0.7], [0, 0.85]], { seg: 9 })];
  return out;
}

// ------------------------------------------------------------------ registry
const T = (id, label, sub, color, params, build, extra = {}) => ({ id, label, cat: 'paesaggio', sub, color, params, build, ...extra });
export const CATEGORY = {
  id: 'paesaggio', label: 'Paesaggio',
  subs: [{ id: 'arredo', label: 'Arredo urbano' }, { id: 'acqua', label: 'Acqua e porto' }, { id: 'campagna', label: 'Campagna' }, { id: 'piante', label: 'Piante' }, { id: 'fantasy', label: 'Storico e fantasy' }],
};
export const LANDSCAPE_TYPES = [
  T('ls_fontana', 'Fontana', 'arredo', '#c9c1b2', [seg('style', 'Stile', [['classica', 'Classica'], ['vasca', 'Ottagonale'], ['moderna', 'Moderna']], 'classica'), range('size', 'Diametro', 2.5, 9, 0.1, 5), flag('water', 'Zampilli', true)], (p) => ({ ...fontana(p), $specs: { 'l:jet': () => ({ kind: 'prop', color: '#e8f4f8', roughness: 0.1, transparent: true, opacity: 0.55 }) } }), { tags: 'fontana piazza acqua zampilli', noColor: true }),
  T('ls_insegna', 'Insegna al neon', 'arredo', '#ffffff', [seg('text', 'Scritta', [['BAR', 'BAR'], ['HOTEL', 'HOTEL'], ['24H', '24H'], ['PIZZA', 'PIZZA'], ['CLUB', 'CLUB'], ['RAMEN', 'RAMEN'], ['MOTEL', 'MOTEL'], ['OPEN', 'OPEN'], ['NEON', 'NEON']], 'BAR'),
    seg('color', 'Colore', [['rosa', 'Rosa'], ['blu', 'Blu'], ['verde', 'Verde'], ['rosso', 'Rosso'], ['giallo', 'Giallo'], ['viola', 'Viola']], 'rosa'), seg('mount', 'Montaggio', [['parete', 'A parete'], ['bandiera', 'A bandiera']], 'parete'), range('width', 'Larghezza', 0.8, 4, 0.05, 1.6)], insegna, { tags: 'neon insegna luce notte vicolo', noColor: true }),
  T('ls_tetto', 'Tetto di grattacielo', 'arredo', '#b5b1a8', [range('width', 'Larghezza', 10, 40, 0.5, 18), range('depth', 'Profondità', 10, 40, 0.5, 16), range('drop', 'Altezza edificio', 10, 200, 1, 80), range('parapet', 'Parapetto', 0.3, 1.4, 0.05, 1.05),
    flag('tank', 'Serbatoio', true), flag('hvac', 'Impianti', true), flag('exit', 'Uscita scale', true), flag('antenna', 'Antenna', false), flag('night', 'Finestre illuminate', false), seedParam(1)], tetto, { tags: 'tetto terrazza grattacielo rooftop', noColor: true, heavy: true }),
  T('ls_barca', 'Barca', 'acqua', '#2f5a8a', [seg('kind', 'Tipo', [['remi', 'A remi'], ['pesca', 'Da pesca'], ['vela', 'A vela']], 'remi'), range('length', 'Lunghezza', 3, 12, 0.1, 4)], barca, { tags: 'barca nave porto mare lago peschereccio vela' }),
  T('ls_molo', 'Pontile', 'acqua', '#8a6142', [range('length', 'Lunghezza', 4, 40, 0.5, 12), range('width', 'Larghezza', 1.2, 5, 0.1, 2.4), flag('bollards', 'Bitte', true)], molo, { tags: 'pontile molo legno lago porto', noColor: true }),
  T('ls_container', 'Container', 'acqua', '#b3261e', [seg('size', 'Lunghezza', [['20', '20 piedi'], ['40', '40 piedi']], '20')], container, { tags: 'container porto nave merci cassone' }),
  T('ls_gru', 'Gru portuale', 'acqua', '#e0a21c', [range('height', 'Altezza', 18, 45, 0.5, 30)], gru, { tags: 'gru porto cantiere', heavy: true }),
  T('ls_bancarella', 'Bancarella', 'campagna', '#b3261e', [range('width', 'Larghezza', 1.6, 4, 0.1, 2.6), seedParam(1)], (p) => bancarella(p), { tags: 'bancarella mercato banco frutta medievale' }),
  T('ls_pozzo', 'Pozzo', 'fantasy', '#c9c1b2', [range('radius', 'Raggio', 0.6, 1.4, 0.05, 0.85), flag('roof', 'Tettoia', true)], pozzo, { tags: 'pozzo acqua villaggio medievale', noColor: true }),
  T('ls_carretto', 'Carretto', 'campagna', '#8a6142', [flag('load', 'Carico di fieno', true)], carretto, { tags: 'carretto carro legno fattoria medievale', noColor: true }),
  T('ls_rovina', 'Rovine', 'fantasy', '#e8e3d8', [seg('kind', 'Tipo', [['muro', 'Muro'], ['colonne', 'Colonnato'], ['arco', 'Arco']], 'muro'), range('length', 'Lunghezza', 3, 14, 0.5, 7), int('count', 'Colonne', 2, 8, 4), seedParam(1)], rovina, { tags: 'rovine antiche colonne tempio muro diroccato', noColor: true }),
  T('ls_fieno', 'Fieno', 'campagna', '#d2ad58', [seg('kind', 'Forma', [['rotoli', 'Rotoballe'], ['balle', 'Balle']], 'rotoli'), int('count', 'Quante', 1, 9, 3), seedParam(1)], fieno, { tags: 'fieno paglia balle fattoria campagna', noColor: true }),
  T('ls_ombrellone', 'Ombrellone', 'arredo', '#d8343a', [range('radius', 'Raggio', 0.8, 1.6, 0.05, 1.1)], (p) => ombrellone(p), { tags: 'ombrellone spiaggia mare' }),
  T('ls_lettino', 'Lettino', 'arredo', '#2f63b8', [], lettino, { tags: 'lettino sdraio spiaggia piscina' }),
  T('ls_cactus', 'Cactus', 'piante', '#5f7f3e', [seg('kind', 'Tipo', [['saguaro', 'Saguaro'], ['barile', 'A barile'], ['opunzia', 'Fico d’India']], 'saguaro'), range('height', 'Altezza', 0.4, 9, 0.1, 4), seedParam(1)], cactus, { tags: 'cactus deserto pianta grassa', noColor: true }),
  T('ls_tropicale', 'Pianta tropicale', 'piante', '#3d7f30', [range('height', 'Altezza', 0.8, 4, 0.05, 2), seedParam(1)], tropicale, { tags: 'giungla banano foglie tropicale', noColor: true }),
  T('ls_felce', 'Felce', 'piante', '#4f8a38', [range('height', 'Altezza', 0.3, 1.5, 0.05, 0.7), seedParam(1)], felce, { tags: 'felce bosco sottobosco giungla', noColor: true }),
  T('ls_lanterna', 'Lanterna', 'fantasy', '#3a2a1c', [seg('style', 'Tipo', [['palo', 'Su palo'], ['torcia', 'Torcia']], 'palo'), range('height', 'Altezza', 1.2, 3.5, 0.05, 2.4), flag('lit', 'Accesa', true)], lanterna, { tags: 'lanterna torcia luce medievale notte', noColor: true }),
  T('ls_falo', 'Falò', 'fantasy', '#5d4a3a', [flag('lit', 'Acceso', true), seedParam(1)], falo, { tags: 'falò fuoco campeggio bivacco notte', noColor: true }),
];
