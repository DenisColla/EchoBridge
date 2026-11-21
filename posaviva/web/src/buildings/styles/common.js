// Shared helpers for style generators: parameter factories, the standard
// material palette of a building, and small composition helpers.
import { mat as M, ACCENTS } from '../mats.js';
import { Builder, Rand, rect, edgesOf } from '../kit.js';
import { buildFacade } from '../facade.js';

// ---------------------------------------------------------------- params
export const range = (id, label, min, max, step, def, unit = 'm') => ({ id, type: 'range', label, min, max, step, default: def, unit });
export const int = (id, label, min, max, def) => ({ id, type: 'int', label, min, max, step: 1, default: def, unit: '' });
export const seg = (id, label, options, def) => ({ id, type: 'seg', label, options: options.map(([value, l]) => ({ value, label: l })), default: def });
export const flag = (id, label, def) => ({ id, type: 'toggle', label, default: def });

/** Parameters every building shares (appearance + random variant). */
export const COMMON = () => [
  seg('wear', 'Usura', [['0', 'Nuovo'], ['1', 'Vissuto'], ['2', 'Degradato']], '0'),
  flag('night', 'Finestre illuminate', false),
  { id: 'seed', type: 'seed', label: 'Variante', default: 1 }, // hidden: "Rigenera" picks a new one
];

/** Build context from cleaned params. */
export function contextOf(p, salt = 0) {
  const rand = new Rand((p.seed | 0) * 7919 + salt * 104729 + 17);
  // main = the prop color (user facade color), or a fixed color when composed in a block
  return { rand, wear: +p.wear || 0, lights: p.night ? 0.42 : 0, p, main: p.__color || 'main' };
}

// ---------------------------------------------------------------- palette
/**
 * Standard palette. spec: {wallTex, groundTex, groundColor, groundK, trim, trimTex, sill, frame, shutter,
 * rolling, metal, door, slab, roof, roofTex, glassTint}
 */
export function palette(ctx, spec = {}) {
  const R = ctx.rand, w = ctx.wear;
  // in a block, accents come from a short shared list (fewer distinct materials = fewer draw calls)
  const acc = ctx.p.__accents;
  const pick = (v, list, key) => v || R.pick(acc?.[key] || list);
  const P = {
    rand: R, wear: w, lights: ctx.lights,
    wall: M(spec.wallTex || 'plaster', spec.wallColor && spec.wallColor !== 'main' ? spec.wallColor : ctx.main, { wear: w, r: 0.92, k: spec.wallK ?? 1 }),
    trim: M(spec.trimTex || 'plaster', spec.trim || '#ece6d8', { wear: w, r: 0.82 }),
    sill: M(spec.sillTex || 'stone', spec.sill || '#ddd5c4', { wear: w, r: 0.8, d: true, cs: false }),
    frame: M(null, spec.frame || '#f2f0ea', { r: 0.5, d: true, cs: false }),
    darkFrame: M(null, '#2a2d31', { r: 0.4, m: 0.55, d: true, cs: false }),
    glass: M('glass', spec.glassTint || '#dfe6ea', { r: 0.06, m: 0.3 }),
    glassLit: M('glass', spec.glassTint || '#dfe6ea', { r: 0.06, m: 0.3, lit: true }),
    railGlass: M(null, '#b9ccd6', { r: 0.05, m: 0.4, op: 0.38, d: true }),
    shutter: M('louver', pick(spec.shutter, ACCENTS.shutter, 'shutter'), { r: 0.62, d: true }),
    rolling: M('rolling', spec.rolling || '#d6d2c8', { r: 0.6, d: true }),
    metal: M(null, spec.metal || '#2b2d31', { r: 0.45, m: 0.6, d: true }),
    darkMetal: M(null, '#3a3d42', { r: 0.5, m: 0.5, d: true }),
    unit: M(null, '#d9dad6', { r: 0.5, m: 0.2, d: true, cs: false }),
    antenna: M(null, '#9aa0a6', { r: 0.4, m: 0.8, d: true, cs: false }),
    brass: M(null, '#b8934e', { r: 0.35, m: 0.85, d: true, cs: false }),
    door: M('woodV', pick(spec.door, ACCENTS.door, 'door'), { r: 0.6 }),
    boards: M('woodV', '#8a6a4a', { r: 0.8, d: true, wear: w }),
    slab: M(spec.slabTex || 'concrete', spec.slab || '#dad6cd', { wear: w, r: 0.85 }),
    signs: M('signs', '#ffffff', { r: 0.55 }),
    awning: M('awning', pick(spec.awning, ACCENTS.awning, 'awning'), { r: 0.85, side: 'double', d: true }),
    roofTile: M(spec.roofTex || 'tiles', pick(spec.roof, ACCENTS.roof, 'roof'), { wear: w, r: 0.82 }),
    coping: M('stone', spec.coping || '#cfc8ba', { wear: w, r: 0.8 }),
    roofMembrane: M('membrane', spec.membrane || '#8c8a86', { wear: w, r: 0.95 }),
    soffit: M('plaster', spec.soffit || '#ece8df', { wear: w, r: 0.9 }),
    fascia: M(null, spec.fascia || '#e8e4da', { r: 0.7 }),
    gutter: M(null, '#8a8f94', { r: 0.4, m: 0.7, d: true, cs: false }),
    solar: M(null, '#1d2a3c', { r: 0.15, m: 0.5, d: true }),
    pot: M(null, '#a8553a', { r: 0.8, d: true, cs: false }),
    wood: M('woodV', spec.wood || '#7a5634', { r: 0.7, wear: w }),
    tankWood: M('woodV', '#7d6a55', { r: 0.8, wear: Math.max(1, w), d: true }),
    plant: M('stucco', '#4f6b3a', { r: 0.95, d: true, cs: false }),
    plantDark: M('stucco', '#36502c', { r: 0.95, d: true, cs: false }),
    paving: M('paving', '#bdb8ae', { wear: w, r: 0.9 }),
    curb: M('stone', '#a9a59c', { wear: w, r: 0.85 }),
  };
  if (spec.groundTex) P.groundWall = M(spec.groundTex, spec.groundColor || ctx.main, { wear: w, r: 0.9, k: spec.groundK ?? 1 });
  P.parapet = P.wall;
  P.chimney = P.wall;
  P.party = !!ctx.p.__party; // composed in a block: side walls are party walls
  P.plants = spec.plants ?? 0.35; // chance of flower pots on a balcony
  P.acChance = spec.ac ?? 0;      // chance of a split AC unit beside a window
  return P;
}

// ---------------------------------------------------------------- composition helpers
/** Runs fn(b, edge, index) inside each footprint edge's facade frame. */
export function eachFacade(b, path, fn) {
  edgesOf(path).forEach((e, i) => {
    b.push().frame(e.x, e.z, e.ux, e.uz);
    fn(e, i);
    b.pop();
  });
}

/**
 * Rectangular block building: facades on the 4 sides (front = +z), with the
 * front spec F and optional overrides for sides/back. Returns the path.
 */
export function boxFacades(b, P, W, D, F, { side = {}, back = {}, cx = 0, cz = 0, blankSides = false } = {}) {
  const path = rect(W, D, cx, cz);
  eachFacade(b, path, (e, i) => {
    const isFront = i === 0, isBack = i === 2;
    const spec = isFront ? F : isBack ? { ...F, ground: F.backGround || 'residential', door: F.backDoor || null, ...back } : { ...F, ground: F.sideGround || 'residential', door: null, pitch: F.sidePitch || F.pitch, ...side, blank: blankSides || P.party || side.blank };
    buildFacade(b, P, { ...spec, L: e.len });
  });
  return path;
}

export { Builder, Rand, M, rect };

/** Small evergreen shrub / bush (detail) for gardens and planters. */
export function bush(b, P, x, z, y = 0, r = 0.45) {
  b.dome(P.plant, x, y, z, r, 8, 3, 1.1);
  b.dome(P.plantDark, x + r * 0.35, y, z - r * 0.25, r * 0.7, 7, 3, 1.2);
}
