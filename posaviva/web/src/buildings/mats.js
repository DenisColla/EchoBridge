// Building materials -> prop material roles.
//
// A building is a prop whose build() returns geometry grouped by role name.
// Role names encode the full material (texture, color, roughness, wear, flags)
// so identical materials across every building share one material (and one
// mesh per building). Roles are registered lazily in the props ROLES table
// (registerPropRoles never overwrites), so the props panel, the thumbnails and
// the scene all resolve them like any other prop role.
//
// Color 'main' follows the prop color (the user's facade color); `k` shades it.
// Flags: d = detail (hidden by the LOD when the building is small on screen),
//        lit = lit window (night emissive, patched in by lod.js).
import * as THREE from 'three';
import { registerPropRoles } from '../props/catalog.js';
import { TEX, getTex, glassAtlas, signAtlas, awningTex, curtainWall, curtainWallNormal } from './textures.js';

const DESC = new Map(); // role name -> descriptor

const shade = (hex, k) => (k === 1 ? hex : '#' + new THREE.Color(hex).multiplyScalar(k).getHexString());
const hx = (c) => (c === 'main' ? 'main' : c.replace('#', '').toLowerCase());
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Material descriptor. tex: texture id from TEX (or 'glass', 'signs', 'awning', 'cw', null);
 * opts: {k (shade of main), r (roughness), m (metalness), d (detail), wear, lit, side, size:[u,v] (tile meters override), ns (normal scale)}
 */
export function mat(tex, color = '#cccccc', opts = {}) {
  const k = opts.k ?? 1, r = opts.r ?? 0.85, m = opts.m ?? 0, wear = TEX[tex] && TEX[tex].family !== 'none' ? (opts.wear | 0) : 0;
  const size = opts.size || (TEX[tex] ? TEX[tex].size : [1, 1]);
  const flags = (opts.d ? 'd' : '') + (opts.lit ? 'L' : '') + (opts.side === 'double' ? '2' : '') + (opts.op ? 'o' + r2(opts.op) : '') + (opts.cs === false ? 'n' : '');
  const name = `b:${tex || '-'}:${hx(color)}:${r2(k)}:${r2(r)}:${r2(m)}:${wear}:${flags}:${r2(size[0])}x${r2(size[1])}:${opts.ns ?? ''}`;
  let d = DESC.get(name);
  if (d) return d;
  d = { name, tex, color, k, r, m, wear, detail: !!opts.d, lit: !!opts.lit, side: opts.side, size, ns: opts.ns, op: opts.op, cast: opts.cs !== false, unitUV: tex === 'glass' || tex === 'signs' };
  DESC.set(name, d);
  registerPropRoles({ [name]: (userColor) => specOf(d, userColor) });
  return d;
}

/** Material spec (materials.apply) for a descriptor and the prop color. */
function specOf(d, userColor) {
  const color = d.color === 'main' ? shade(userColor || '#cccccc', d.k) : shade(d.color, d.k);
  const s = { kind: 'prop', color, roughness: d.r, metalness: d.m };
  if (d.side) s.side = d.side;
  if (d.op) { s.transparent = true; s.opacity = d.op; }
  if (d.tex === 'glass') {
    s.map = glassAtlas(false);
    if (d.lit) { s.emissive = '#ffd9a0'; s.emissiveIntensity = 1.25; s.emissiveMap = glassAtlas(true); }
  } else if (d.tex === 'signs') {
    s.map = signAtlas().tex;
  } else if (d.tex === 'awning') {
    s.map = awningTex(d.color === 'main' ? userColor : d.color);
    s.color = '#ffffff';
  } else if (d.tex === 'cw') {
    s.map = curtainWall(false);
    s.normalMap = curtainWallNormal();
    s.normalScale = 0.8;
    if (d.lit) { s.emissive = '#ffe2b0'; s.emissiveIntensity = 1.1; s.emissiveMap = curtainWall(true); }
  } else if (!d.tex && d.lit) {
    s.emissive = color; s.emissiveIntensity = 1.4;
  } else if (TEX[d.tex]) {
    const t = getTex(d.tex, d.wear);
    s.map = t.map;
    if (t.normalMap) { s.normalMap = t.normalMap; s.normalScale = d.ns ?? 1; }
  }
  return s;
}

export function descOf(role) { return DESC.get(role) || null; }

/** True for roles hidden by the LOD at a distance. */
export function isDetailRole(role) { return DESC.get(role)?.detail || false; }

/** Tile size in meters of a descriptor (UV scale). */
export function tileOf(d) { return d.size; }

// ---------------------------------------------------------------- palettes
// Facade colors offered per material family (also used by "Rigenera").
export const PALETTES = {
  plaster: ['#e8dcc4', '#e9c98f', '#d9a46a', '#c97b54', '#e7d3b8', '#f1ece2', '#cfd6cc', '#b9c6cf', '#e3b8a6', '#d8c08a', '#b5654a', '#9fae8e'],
  modern: ['#f1efea', '#e2e0dc', '#cfcfcc', '#a9aaa8', '#6f7174', '#3b3d40', '#d9cfc0', '#c6b59a'],
  brick: ['#9c4a33', '#8a3d2b', '#b35d3c', '#7b4a35', '#c08a5a', '#d8c7a6', '#6d3b2c'],
  stone: ['#d8cfbd', '#cfc2a6', '#bfb39b', '#e6dfd0', '#a59c8a', '#c9b48e'],
  wood: ['#8a5a3b', '#6b4a2f', '#a0703f', '#5a3b26', '#b78a5a', '#7a2f24', '#4f5b4a'],
  glass: ['#6f8aa0', '#5e7f86', '#7d8f9c', '#8a7a62', '#4f6573', '#9aa8b0', '#3f5a6e'],
  metal: ['#c9ccd0', '#9aa1a8', '#5d6b7a', '#7a1f24', '#2f4a6b', '#4f6b3a', '#d6d2c8'],
  white: ['#f2efe8', '#e8e4dc', '#f6f1e4', '#ece6d6', '#dcd6ca'],
};

/** Accent colors (shutters, doors, awnings…). */
export const ACCENTS = {
  shutter: ['#3f5f3a', '#4f6b3a', '#6b4a2f', '#5a3b26', '#2f4a6b', '#7c8a7a', '#8a2f2a', '#c9c4b8'],
  door: ['#5a3b26', '#3a2a1e', '#2f3b47', '#1f3d2a', '#7a1f24', '#3b3b40'],
  awning: ['#7a1f24', '#2f4a6b', '#1f5c3a', '#c0504d', '#3b3b40', '#c9a227', '#5b3a6b', '#e07a2f'],
  roof: ['#a8553a', '#b5643f', '#94503a', '#8a4632', '#6d4a3a'],
  slate: ['#4a4c52', '#55575c', '#3d4046', '#5f5a55'],
  metalRoof: ['#5d6b7a', '#7a2f24', '#4f5b4a', '#8e9499', '#3b3d40'],
};
