// Prop catalog: every type is described by data (label, category, parameters,
// default color) plus a `build(params)` function returning geometries grouped
// by material role. Dimensions are real-world meters.
//
// Conventions
//  - Scene props: origin at the floor (y = 0) in the middle of the footprint,
//    front (the side a person sits / looks from) faces +Z, like characters.
//  - Hand props are authored in GRIP space: origin = center of the closed fist,
//    +Y = handle axis toward the "business end" (exits on the thumb side),
//    +Z = direction of the knuckles (fingers' metacarpals), +X = out of the palm.
//    `hand.rest` gives the orientation used when the prop lies free in the world.
import * as THREE from 'three';
import { box, boxOn, cylinder, lathe, rod, sphere, torus, tube, roundedSlab, blade, place } from './geo.js';
import { range, int, seg, flag } from './params.js';
import { STORAGE_TYPES } from './gen/storage.js';
import { KITCHEN_TYPES } from './gen/kitchen.js';
import { FURNITURE_TYPES, divano as divanoGen, letto as lettoGen, DIVANO_PARAMS, LETTO_PARAMS } from './gen/furniture.js';
import { BATH_TYPES } from './gen/bath.js';
import { OFFICE_TYPES } from './gen/office.js';
import { OBJECT_TYPES } from './gen/objects.js';
import { LEISURE_TYPES } from './gen/leisure.js';
import { STRUCTURE_TYPES } from './gen/structures.js';
import { PH_MODELS } from './phModels.js';

export { range, int, seg, flag };

/**
 * Library categories (chips of the "Oggetti" panel) with optional sub-categories.
 * Other modules add theirs with registerPropTypes(types, categories); a category
 * with `ownTool: true` is listed by its own tool and hidden from "Oggetti".
 */
const sub = (id, label) => ({ id, label });
export const CATEGORIES = [
  { id: 'sedute', label: 'Sedute', subs: [sub('sedie', 'Sedie'), sub('poltrone', 'Poltrone'), sub('divani', 'Divani'), sub('sgabelli', 'Sgabelli'), sub('panche', 'Panche')] },
  { id: 'tavoli', label: 'Tavoli', subs: [sub('pranzo', 'Da pranzo'), sub('salotto', 'Da salotto'), sub('scrivanie', 'Scrivanie'), sub('comodini', 'Comodini'), sub('consolle', 'Consolle')] },
  { id: 'letti', label: 'Letti' },
  { id: 'armadi', label: 'Armadi e mensole', subs: [sub('armadi', 'Armadi'), sub('credenze', 'Credenze'), sub('cassettiere', 'Cassettiere'), sub('librerie', 'Librerie e scaffali')] },
  { id: 'cucina', label: 'Cucina', subs: [sub('mobili', 'Mobili'), sub('elettrodomestici', 'Elettrodomestici'), sub('pentole', 'Pentole'), sub('utensili', 'Utensili')] },
  { id: 'bagno', label: 'Bagno', subs: [sub('sanitari', 'Sanitari'), sub('mobili', 'Mobili'), sub('accessori', 'Accessori')] },
  { id: 'ufficio', label: 'Ufficio e scuola', subs: [sub('mobili', 'Mobili'), sub('scuola', 'Scuola'), sub('cancelleria', 'Cancelleria'), sub('libri', 'Libri')] },
  { id: 'elettronica', label: 'Elettronica', subs: [sub('tv-audio', 'TV e audio'), sub('computer', 'Computer'), sub('foto-video', 'Foto e video'), sub('negozio', 'Varie')] },
  { id: 'luci', label: 'Luci', subs: [sub('soffitto', 'Soffitto'), sub('terra-tavolo', 'Terra e tavolo'), sub('parete', 'Parete'), sub('portatili', 'Portatili')] },
  { id: 'decorazioni', label: 'Decorazioni', subs: [sub('quadri', 'Quadri e specchi'), sub('vasi', 'Vasi'), sub('statue', 'Statue'), sub('orologi', 'Orologi'), sub('tessili', 'Tessili'), sub('varie', 'Varie')] },
  { id: 'piante', label: 'Piante' },
  { id: 'cibo', label: 'Cibo e stoviglie', subs: [sub('frutta-verdura', 'Frutta e verdura'), sub('dolci-pane', 'Pane e dolci'), sub('stoviglie', 'Stoviglie'), sub('bevande', 'Bevande'), sub('dispensa', 'Dispensa')] },
  { id: 'contenitori', label: 'Contenitori', subs: [sub('scatole', 'Scatole'), sub('casse', 'Casse'), sub('barili', 'Barili'), sub('cesti-secchi', 'Cesti e secchi'), sub('taniche', 'Taniche')] },
  { id: 'attrezzi', label: 'Attrezzi', subs: [sub('utensili', 'Utensili'), sub('officina', 'Officina'), sub('giardino', 'Giardino'), sub('pulizia', 'Pulizia'), sub('scale', 'Scale'), sub('scienza', 'Scienza'), sub('armi', 'Armi')] },
  { id: 'sport', label: 'Sport e svago', subs: [sub('palloni', 'Palloni'), sub('palestra', 'Palestra'), sub('giochi', 'Giochi'), sub('musica', 'Musica')] },
  { id: 'accessori', label: 'Scarpe e accessori', subs: [sub('scarpe', 'Scarpe'), sub('borse-valigie', 'Borse e valigie'), sub('occhiali-orologi', 'Occhiali e orologi'), sub('varie', 'Varie')] },
  { id: 'strutture', label: 'Strutture', subs: [sub('stanze', 'Stanze e pavimenti'), sub('porte-finestre', 'Porte e finestre'), sub('scale', 'Scale'), sub('forme', 'Forme')] },
  { id: 'mano', label: 'In mano' },
  { id: 'stanze', label: 'Stanze pronte', presets: true },
];

/** Swatches offered by the color picker. */
export const PROP_COLORS = ['#8a5a3b', '#c49a6c', '#e8e4dc', '#9b9a97', '#3b3b40', '#7a1f24', '#c0504d', '#2f4a6b', '#4f6b3a', '#c9a227'];

/**
 * Material roles. 'main' / 'soft' follow the user color, the others are fixed
 * (metal blade, linen, screen…). Values are material-library specs (kind 'prop').
 */
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
export const ROLES = {
  main: (c) => ({ kind: 'prop', color: c, roughness: 0.62 }),
  mainShade: (c) => ({ kind: 'prop', color: shade(c, 0.72), roughness: 0.66 }),
  soft: (c) => ({ kind: 'prop', color: c, roughness: 0.92, sheen: 0.6 }),
  canopy: (c) => ({ kind: 'prop', color: c, roughness: 0.75, sheen: 0.4, side: 'double' }),
  metal: () => ({ kind: 'prop', color: '#c3c7ce', metalness: 0.85, roughness: 0.28 }),
  darkMetal: () => ({ kind: 'prop', color: '#34363b', metalness: 0.7, roughness: 0.42 }),
  gold: () => ({ kind: 'prop', color: '#b8934e', metalness: 0.85, roughness: 0.34 }),
  wood: () => ({ kind: 'prop', color: '#6b4a2f', roughness: 0.6 }),
  dark: () => ({ kind: 'prop', color: '#2a2724', roughness: 0.55 }),
  leather: () => ({ kind: 'prop', color: '#4a2f20', roughness: 0.5 }),
  linen: () => ({ kind: 'prop', color: '#ebe8e1', roughness: 0.94, sheen: 0.5 }),
  blanket: () => ({ kind: 'prop', color: '#8ea2b7', roughness: 0.94, sheen: 0.6 }),
  trim: () => ({ kind: 'prop', color: '#f0ede6', roughness: 0.5 }),
  paper: () => ({ kind: 'prop', color: '#eee6d2', roughness: 0.95 }),
  screen: () => ({ kind: 'prop', color: '#0d0f13', roughness: 0.12, metalness: 0.2 }),
  coffee: () => ({ kind: 'prop', color: '#3a2214', roughness: 0.2 }),
  // interiors
  lacquer: () => ({ kind: 'prop', color: '#eeece7', roughness: 0.35 }),
  woodLight: () => ({ kind: 'prop', color: '#c49a6c', roughness: 0.55 }),
  woodDark: () => ({ kind: 'prop', color: '#3f2a1c', roughness: 0.5 }),
  counter: () => ({ kind: 'prop', color: '#cfc9bf', roughness: 0.3 }),
  appliance: () => ({ kind: 'prop', color: '#ecedee', roughness: 0.3, metalness: 0.05 }),
  steel: () => ({ kind: 'prop', color: '#b9bdc2', metalness: 0.8, roughness: 0.32 }),
  steelDark: () => ({ kind: 'prop', color: '#5b5f64', metalness: 0.7, roughness: 0.38 }),
  chrome: () => ({ kind: 'prop', color: '#d9dde2', metalness: 1, roughness: 0.12 }),
  black: () => ({ kind: 'prop', color: '#1c1d20', roughness: 0.42 }),
  blackD: () => ({ kind: 'prop', color: '#1c1d20', roughness: 0.6, side: 'double' }),
  plastic: () => ({ kind: 'prop', color: '#d8d8d4', roughness: 0.5 }),
  plasticW: () => ({ kind: 'prop', color: '#f1f1ee', roughness: 0.38 }),
  ceramic: () => ({ kind: 'prop', color: '#f3f2ee', roughness: 0.16 }),
  glass: () => ({ kind: 'prop', color: '#cfe3ea', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.3 }),
  glassLamp: () => ({ kind: 'prop', color: '#fff8e6', roughness: 0.3, transparent: true, opacity: 0.75 }),
  mirror: () => ({ kind: 'prop', color: '#c9d4da', metalness: 0.55, roughness: 0.12 }),
  frame: () => ({ kind: 'prop', color: '#3d2b1f', roughness: 0.5 }),
  books: () => ({ kind: 'prop', color: '#ffffff', roughness: 0.75, vertexColors: true }),
  cushions: () => ({ kind: 'prop', color: '#ffffff', roughness: 0.92, sheen: 0.5, vertexColors: true }),
  vcGloss: () => ({ kind: 'prop', color: '#ffffff', roughness: 0.15, vertexColors: true }),
  petals: () => ({ kind: 'prop', color: '#ffffff', roughness: 0.7, vertexColors: true, side: 'double' }),
  decor: () => ({ kind: 'prop', color: '#a8443a', roughness: 0.45 }),
  pot: () => ({ kind: 'prop', color: '#b5653d', roughness: 0.8 }),
  soil: () => ({ kind: 'prop', color: '#3b2a1e', roughness: 1 }),
  leaf: () => ({ kind: 'prop', color: '#3f6b35', roughness: 0.55, side: 'double' }),
  leaf2: () => ({ kind: 'prop', color: '#5a7f3a', roughness: 0.6, side: 'double' }),
  stem: () => ({ kind: 'prop', color: '#4c6a33', roughness: 0.7 }),
  wicker: () => ({ kind: 'prop', color: '#b08a55', roughness: 0.85 }),
  shade: (c) => ({ kind: 'prop', color: '#f2ead8', roughness: 0.9, side: 'double', sheen: 0.3 }),
  bulb: () => ({ kind: 'prop', color: '#fffbe8', roughness: 0.2 }),
  diffuser: () => ({ kind: 'prop', color: '#f7f7f5', roughness: 0.95 }),
  fabric: () => ({ kind: 'prop', color: '#8c949c', roughness: 0.95, sheen: 0.4 }),
  curtain: (c) => ({ kind: 'prop', color: c, roughness: 0.95, sheen: 0.5, side: 'double' }),
  blanketD: () => ({ kind: 'prop', color: '#8ea2b7', roughness: 0.94, sheen: 0.6, side: 'double' }),
  curtainBed: () => ({ kind: 'prop', color: '#d8cbb2', roughness: 0.95, sheen: 0.5, side: 'double' }),
  ceiling: () => ({ kind: 'prop', color: '#f2f0ea', roughness: 0.95 }),
  door: () => ({ kind: 'prop', color: '#efece6', roughness: 0.45 }),
  doorShade: () => ({ kind: 'prop', color: '#e2ded6', roughness: 0.45 }),
  marble: () => ({ kind: 'prop', color: '#e9e6e1', roughness: 0.2 }),
  mug: () => ({ kind: 'prop', color: '#c0504d', roughness: 0.25 }),
  screenOn: () => ({ kind: 'prop', color: '#2c4f86', roughness: 0.15, metalness: 0.1 }),
  water: () => ({ kind: 'prop', color: '#9cc6d6', roughness: 0.05, transparent: true, opacity: 0.45 }),
  wine: () => ({ kind: 'prop', color: '#5a0f1c', roughness: 0.1, transparent: true, opacity: 0.85 }),
  beer: () => ({ kind: 'prop', color: '#d89a2b', roughness: 0.1, transparent: true, opacity: 0.85 }),
  bottleGreen: () => ({ kind: 'prop', color: '#1f4d2e', roughness: 0.08, transparent: true, opacity: 0.85 }),
  bottleBrown: () => ({ kind: 'prop', color: '#6b3a17', roughness: 0.08, transparent: true, opacity: 0.85 }),
  bottleClear: () => ({ kind: 'prop', color: '#d9d4c3', roughness: 0.06, transparent: true, opacity: 0.55 }),
  cork: () => ({ kind: 'prop', color: '#a0784e', roughness: 0.9 }),
  cap: () => ({ kind: 'prop', color: '#c9a227', metalness: 0.7, roughness: 0.35 }),
  label: (c) => ({ kind: 'prop', color: '#efe6d0', roughness: 0.8 }),
  food: () => ({ kind: 'prop', color: '#e8c46a', roughness: 0.5 }),
  meat: () => ({ kind: 'prop', color: '#6e3420', roughness: 0.6 }),
  pizza: () => ({ kind: 'prop', color: '#d8743a', roughness: 0.7 }),
  cardboard: () => ({ kind: 'prop', color: '#b58a5a', roughness: 0.9 }),
  tape: () => ({ kind: 'prop', color: '#c8a46e', roughness: 0.4 }),
  felt: (c) => ({ kind: 'prop', color: c, roughness: 0.98 }),
  tableBlue: () => ({ kind: 'prop', color: '#1f3f7a', roughness: 0.4 }),
  piano: () => ({ kind: 'prop', color: '#111114', roughness: 0.12 }),
  keysWhite: () => ({ kind: 'prop', color: '#f4f2ea', roughness: 0.25 }),
  basketball: () => ({ kind: 'prop', color: '#d9822b', roughness: 0.7 }),
  globe: () => ({ kind: 'prop', color: '#3f7fb2', roughness: 0.4 }),
  shoe: (c) => ({ kind: 'prop', color: c, roughness: 0.4 }),
  tilesWall: () => ({ kind: 'prop', color: '#e9e6df', roughness: 0.3 }),
};


// ---------------------------------------------------------------------------- furniture
function sedia() {
  const W = 0.44, D = 0.42, SH = 0.45, ST = 0.035, L = 0.034, BH = 0.9;
  const lx = W / 2 - L / 2 - 0.008, lz = D / 2 - L / 2 - 0.008;
  const inner = 2 * lx - L;
  return {
    main: [
      boxOn(W, ST, D, { y: SH - ST, r: 0.009 }),
      boxOn(L, SH - ST, L, { x: lx, z: lz, r: 0.005 }), boxOn(L, SH - ST, L, { x: -lx, z: lz, r: 0.005 }),
      boxOn(L, BH, L, { x: lx, z: -lz, r: 0.005 }), boxOn(L, BH, L, { x: -lx, z: -lz, r: 0.005 }),
      box(inner + 0.006, 0.08, 0.022, { y: BH - 0.065, z: -lz, r: 0.007 }),
      box(inner + 0.006, 0.045, 0.02, { y: BH - 0.24, z: -lz, r: 0.006 }),
      box(0.02, 0.024, 2 * lz - L, { x: lx, y: 0.16 }), box(0.02, 0.024, 2 * lz - L, { x: -lx, y: 0.16 }),
      box(inner, 0.024, 0.02, { y: 0.22, z: lz }),
      // seat apron
      box(inner, 0.05, 0.018, { y: SH - ST - 0.025, z: lz - 0.004 }), box(inner, 0.05, 0.018, { y: SH - ST - 0.025, z: -lz + 0.004 }),
    ],
  };
}

function sgabello(p) {
  const H = p.height, SR = 0.19, ST = 0.042;
  const legs = [];
  const top = H - ST - 0.02;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
    legs.push(rod([c * 0.205, 0.012, s * 0.205], [c * 0.12, top, s * 0.12], 0.0135, { seg: 12 }));
    legs.push(cylinder(0.018, 0.016, 0.014, { x: c * 0.206, z: s * 0.206, bevel: 0.004, seg: 12 })); // feet
  }
  const ry = Math.min(0.3, H * 0.42), rr = 0.205 + (0.12 - 0.205) * (ry / top);
  return {
    main: [cylinder(SR, SR, ST, { y: H - ST, bevel: 0.014, seg: 44 })],
    darkMetal: [...legs, torus(rr, 0.0095, { rx: 90, y: ry, rs: 8, ts: 48 }), cylinder(0.135, 0.135, 0.022, { y: top, bevel: 0.004, seg: 32 })],
  };
}

function panca(p) {
  const L = p.length, H = 0.45, D = 0.36, T = 0.05;
  const lx = L / 2 - Math.min(0.16, L * 0.12);
  const main = [
    boxOn(L, T, D, { y: H - T, r: 0.012 }),
    boxOn(0.055, H - T, D - 0.06, { x: lx, r: 0.008 }), boxOn(0.055, H - T, D - 0.06, { x: -lx, r: 0.008 }),
    box(2 * lx, 0.06, 0.04, { y: 0.15, r: 0.006 }),
  ];
  if (L > 2.2) main.push(boxOn(0.055, H - T, D - 0.06, { r: 0.008 }));
  return { main };
}

function tavolo(p) {
  const { width: W, depth: D, height: H } = p, T = 0.035, L = 0.055;
  const lx = W / 2 - 0.06, lz = D / 2 - 0.06;
  const main = [boxOn(W, T, D, { y: H - T, r: 0.01 })];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) main.push(boxOn(L, H - T, L, { x: sx * lx, z: sz * lz, r: 0.006 }));
  const ay = H - T - 0.045;
  for (const s of [-1, 1]) {
    main.push(box(2 * lx - L, 0.08, 0.022, { y: ay, z: s * lz, r: 0.005 }));
    main.push(box(0.022, 0.08, 2 * lz - L, { x: s * lx, y: ay, r: 0.005 }));
  }
  return { main };
}

// ---------------------------------------------------------------------------- structures
function cubo(p) {
  const { width: w, depth: d, height: h } = p;
  if (p.style !== 'cassa') return { main: [boxOn(w, h, d, { r: Math.min(0.012, Math.min(w, h, d) * 0.08) })] };
  const b = Math.max(0.012, Math.min(0.055, Math.min(w, h, d) * 0.12));
  const main = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) main.push(boxOn(b, h, b, { x: sx * (w / 2 - b / 2), z: sz * (d / 2 - b / 2), r: 0.004 }));
  for (const y of [b / 2, h - b / 2]) for (const s of [-1, 1]) {
    main.push(box(w - 2 * b, b, b, { y, z: s * (d / 2 - b / 2), r: 0.004 }));
    main.push(box(b, b, d - 2 * b, { x: s * (w / 2 - b / 2), y, r: 0.004 }));
  }
  const mainShade = [boxOn(w - 0.012, h - 0.012, d - 0.012, { y: 0.006, r: 0.002 })];
  // diagonal braces on front and back
  const diag = Math.hypot(w - 2 * b, h - 2 * b), ang = Math.atan2(h - 2 * b, w - 2 * b) * (180 / Math.PI);
  for (const s of [-1, 1]) main.push(box(diag, b * 0.8, b * 0.5, { y: h / 2, z: s * (d / 2 - b * 0.25), rz: ang * s, r: 0.003 }));
  return { main, mainShade };
}

function scala(p) {
  const n = p.steps, W = p.width, R = 0.17, T = 0.28, D = n * T;
  const main = [];
  for (let i = 1; i <= n; i++) main.push(boxOn(W, R * i, T, { z: D / 2 - (i - 0.5) * T, r: 0.006 }));
  const out = { main };
  if (p.railing) {
    const x = W / 2 - 0.05, rails = [];
    for (let i = 1; i <= n; i++) {
      const z = D / 2 - (i - 0.5) * T;
      rails.push(rod([x, R * i, z], [x, R * i + 0.9, z], 0.011, { seg: 10 }));
    }
    const z0 = D / 2 - 0.5 * T, z1 = D / 2 - (n - 0.5) * T;
    rails.push(rod([x, R + 0.9, z0 + 0.05], [x, R * n + 0.9, z1 - 0.05], 0.021, { seg: 14 }));
    out.darkMetal = rails;
  }
  return out;
}

function muro(p) {
  const L = p.length, H = p.height, T = p.thickness, kind = p.opening;
  if (kind === 'none') return { main: [boxOn(L, H, T, { r: 0.004 })] };
  let ow, oh, oy;
  if (kind === 'door') { ow = Math.min(0.9, L - 0.3); oh = Math.min(2.1, H - 0.15); oy = 0; }
  else { ow = Math.min(1.0, L - 0.3); oh = Math.max(0.3, Math.min(1.2, H - 1.05)); oy = Math.max(0.1, Math.min(0.9, H - oh - 0.15)); }
  const cx = p.offset * Math.max(0, (L - ow) / 2 - 0.12);
  const main = [], trim = [];
  const lw = cx - ow / 2 + L / 2, rw = L / 2 - (cx + ow / 2);
  if (lw > 0.002) main.push(boxOn(lw, H, T, { x: -L / 2 + lw / 2, r: 0.004 }));
  if (rw > 0.002) main.push(boxOn(rw, H, T, { x: L / 2 - rw / 2, r: 0.004 }));
  if (H - (oy + oh) > 0.002) main.push(boxOn(ow, H - (oy + oh), T, { x: cx, y: oy + oh, r: 0.003 }));
  if (oy > 0.002) main.push(boxOn(ow, oy, T, { x: cx, r: 0.003 }));
  // casing on both faces + reveal liners
  const c = 0.07, ct = 0.016;
  for (const s of [-1, 1]) {
    const z = s * (T / 2 + ct / 2 - 0.002);
    const y0 = kind === 'door' ? 0 : oy - c;
    const jh = oy + oh + c - y0;
    trim.push(boxOn(c, jh, ct, { x: cx - ow / 2 - c / 2, y: y0, z, r: 0.004 }));
    trim.push(boxOn(c, jh, ct, { x: cx + ow / 2 + c / 2, y: y0, z, r: 0.004 }));
    trim.push(box(ow, c, ct, { x: cx, y: oy + oh + c / 2, z, r: 0.004 }));
    if (kind === 'window') trim.push(box(ow, c, ct, { x: cx, y: oy - c / 2, z, r: 0.004 }));
  }
  trim.push(boxOn(0.02, oh, T, { x: cx - ow / 2 + 0.01, y: oy }), boxOn(0.02, oh, T, { x: cx + ow / 2 - 0.01, y: oy }));
  trim.push(box(ow, 0.02, T, { x: cx, y: oy + oh - 0.01 }));
  if (kind === 'window') {
    trim.push(box(ow + 2 * c + 0.05, 0.035, T + 0.07, { x: cx, y: oy - 0.0175, r: 0.008 })); // sill
    const f = 0.045, fd = 0.05;
    trim.push(box(ow, f, fd, { x: cx, y: oy + f / 2 }), box(ow, f, fd, { x: cx, y: oy + oh - f / 2 }));
    trim.push(box(f, oh, fd, { x: cx - ow / 2 + f / 2, y: oy + oh / 2 }), box(f, oh, fd, { x: cx + ow / 2 - f / 2, y: oy + oh / 2 }));
    trim.push(box(0.035, oh - 2 * f, fd * 0.8, { x: cx, y: oy + oh / 2 }), box(ow - 2 * f, 0.035, fd * 0.8, { x: cx, y: oy + oh * 0.62 }));
  }
  return { main, trim };
}

function pedana(p) {
  const { width: w, depth: d, height: h } = p;
  return { main: [boxOn(w, h, d, { r: Math.min(0.02, h * 0.2) })] };
}

function colonna(p) {
  const r = p.diameter / 2, H = p.height;
  if (p.style !== 'classica' || H < r * 3.2) return { main: [cylinder(r, r, H, { bevel: Math.min(0.012, r * 0.15), seg: 48 })] };
  const ph = 0.32 * r, ah = 0.26 * r;
  const s0 = ph + 0.32 * r, s1 = H - ah - 0.5 * r;
  const prof = [[0, ph], [1.18 * r, ph], [1.22 * r, ph + 0.05 * r], [1.2 * r, ph + 0.12 * r], [1.1 * r, ph + 0.18 * r], [1.02 * r, ph + 0.22 * r], [r, s0]];
  for (let i = 1; i <= 8; i++) { const t = i / 8; prof.push([r * (1 - 0.13 * Math.pow(t, 1.6)), s0 + (s1 - s0) * t]); }
  const rt = r * 0.87;
  prof.push([rt * 1.07, s1 + 0.05 * r], [rt * 1.07, s1 + 0.1 * r], [rt, s1 + 0.14 * r], [rt * 1.05, s1 + 0.26 * r], [rt * 1.22, s1 + 0.4 * r], [rt * 1.38, H - ah], [0, H - ah]);
  return {
    main: [
      lathe(prof, { seg: 48 }),
      boxOn(2.5 * r, ph, 2.5 * r, { r: Math.min(0.012, ph * 0.2) }),
      boxOn(2.6 * r, ah, 2.6 * r, { y: H - ah, r: Math.min(0.012, ah * 0.2) }),
    ],
  };
}

function palla(p) {
  const r = p.diameter / 2;
  return { main: [sphere(r, { y: r, ws: 48, hs: 32 })] };
}

// ---------------------------------------------------------------------------- hand props (grip space)
function spada(p) {
  const BL = p.blade, g0 = 0.085;
  return {
    main: [cylinder(0.0165, 0.0155, 2 * g0, { y: -g0, bevel: 0.003, seg: 16 })],
    gold: [
      sphere(0.025, { y: -g0 - 0.02, ws: 20, hs: 14 }),
      box(0.032, 0.026, 0.2, { y: g0 + 0.013, r: 0.008 }),
      sphere(0.017, { y: g0 + 0.013, z: 0.1, ws: 14, hs: 10 }), sphere(0.017, { y: g0 + 0.013, z: -0.1, ws: 14, hs: 10 }),
    ],
    metal: [blade(BL, 0.052, 0.0095, { y0: g0 + 0.026, tipStart: 0.86, taper: 0.68 })],
  };
}

function bastone(p) {
  const L = p.length, y0 = -0.35 * L;
  return {
    main: [cylinder(0.0165, 0.0165, L, { y: y0, bevel: 0.007, seg: 18 })],
    dark: [cylinder(0.0185, 0.0185, 0.035, { y: y0 - 0.004, bevel: 0.005, seg: 18 }), cylinder(0.0185, 0.0185, 0.035, { y: y0 + L - 0.031, bevel: 0.005, seg: 18 })],
  };
}

function lancia(p) {
  const L = p.length, y0 = -0.4 * L, y1 = y0 + L;
  return {
    wood: [cylinder(0.0155, 0.0145, L, { y: y0, bevel: 0.004, seg: 18 })],
    metal: [
      cylinder(0.018, 0.013, 0.09, { y: y1 - 0.02, bevel: 0.003, seg: 16 }),
      blade(0.27, 0.06, 0.011, { y0: y1 + 0.065, tipStart: 0.5, taper: 0.95 }),
      cylinder(0.004, 0.0165, 0.07, { y: y0 - 0.065, bevel: 0.002, seg: 16 }),
    ],
  };
}

function scudo(p) {
  const R = p.diameter / 2, dz = 0.055 * (R / 0.3), z0 = 0.055, th = 0.014;
  // lathe around +Y, then rotated so the axis points to +Z (shield face toward the knuckles)
  const prof = [[0, dz - th], [R * 0.5, dz * 0.78 - th], [R * 0.86, dz * 0.3 - th], [R - 0.004, -0.01], [R, 0], [R * 0.86, dz * 0.3], [R * 0.5, dz * 0.78], [0, dz]];
  const face = lathe(prof, { seg: 56 });
  place(face, { rx: 90, z: z0 });
  const boss = new THREE.SphereGeometry(0.075 * (R / 0.3), 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  place(boss, { rx: 90, z: z0 + dz - 0.03 * (R / 0.3) });
  return {
    main: [face],
    metal: [torus(R, 0.011, { z: z0, rs: 8, ts: 72 }), boss],
    leather: [rod([0, -0.07, 0], [0, 0.07, 0], 0.014, { seg: 12 }), rod([0, -0.07, 0], [0, -0.07, z0 + 0.01], 0.012), rod([0, 0.07, 0], [0, 0.07, z0 + 0.01], 0.012)],
  };
}

function libro() {
  const H = 0.23, W = 0.155, T = 0.032, ct = 0.0035, z0 = -0.03;
  const zc = z0 + W / 2;
  return {
    main: [
      box(ct, H, W, { x: ct / 2, z: zc, r: 0.0015 }),
      box(ct, H, W, { x: T - ct / 2, z: zc, r: 0.0015 }),
      box(T, H, 0.007, { x: T / 2, z: z0 - 0.0015, r: 0.003 }),
    ],
    paper: [box(T - 2 * ct, H - 0.012, W - 0.008, { x: T / 2, z: zc + 0.002, r: 0.001 })],
  };
}

function tazza() {
  const R = 0.041, y0 = -0.045, y1 = 0.05;
  const body = lathe([[0, y0], [R - 0.004, y0], [R, y0 + 0.004], [R, y1 - 0.002], [R - 0.002, y1], [R - 0.004, y1 - 0.002], [R - 0.004, y0 + 0.008], [0, y0 + 0.008]], { seg: 40 });
  const handle = torus(0.027, 0.0068, { arc: Math.PI, rz: -90, x: R - 0.003, y: 0.002, rs: 10, ts: 20 });
  return { main: [body, handle], coffee: [cylinder(R - 0.0045, R - 0.0045, 0.002, { y: y1 - 0.022, bevel: 0, seg: 32 })] };
}

function telefono() {
  const L = 0.147, W = 0.0716, T = 0.0078, z = 0.04;
  return {
    main: [roundedSlab(L, W, T, 0.01, { ry: -90, x: T / 2, z, bevel: 0.0018 })],
    screen: [roundedSlab(L - 0.006, W - 0.006, 0.0006, 0.008, { ry: -90, x: T + 0.0002, z, bevel: 0 })],
  };
}

function borsa() {
  const BW = 0.3, BH = 0.22, BD = 0.12, top = 0.1;
  const handles = [];
  for (const s of [-1, 1]) handles.push(tube([[s * 0.035, -0.085, top + 0.01], [s * 0.025, -0.06, 0.045], [s * 0.006, -0.02, 0.004], [0, 0, 0], [s * 0.006, 0.02, 0.004], [s * 0.025, 0.06, 0.045], [s * 0.035, 0.085, top + 0.01]], 0.006, { segs: 40, rs: 8 }));
  return {
    main: [box(BD, BW, BH, { z: top + BH / 2, r: 0.03 }), box(BD * 0.56, BW * 0.96, 0.06, { x: BD * 0.23, z: top + 0.035, r: 0.012 })],
    leather: handles,
    gold: [box(0.006, 0.035, 0.026, { x: BD / 2 + 0.002, z: top + 0.07, r: 0.002 })],
  };
}

function ombrello(p) {
  const open = p.open;
  const out = {
    dark: [
      cylinder(0.0145, 0.0145, 0.11, { y: -0.055, bevel: 0.004, seg: 16 }),
      tube([[0, -0.05, 0], [0, -0.1, 0], [0, -0.14, -0.025], [0, -0.135, -0.065], [0, -0.105, -0.078]], 0.012, { segs: 24, rs: 10 }),
    ],
    darkMetal: [rod([0, 0.05, 0], [0, 0.82, 0], 0.0062, { seg: 10 }), cylinder(0.006, 0.002, 0.05, { y: open ? 0.8 : 0.79, bevel: 0, seg: 10 })],
  };
  if (open) {
    const R = 0.52;
    // rim -> apex so the lathe normals face outward / up
    out.canopy = [lathe([[R, 0.6], [R * 0.82, 0.7], [R * 0.55, 0.765], [R * 0.26, 0.797], [0, 0.807]], { seg: 8 })];
    // stretchers under the canopy (at lathe vertices: x = r sin(phi), z = r cos(phi))
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, rr = R * 0.55;
      out.darkMetal.push(rod([0, 0.56, 0], [Math.sin(a) * rr, 0.758, Math.cos(a) * rr], 0.0025, { seg: 6 }));
    }
  } else {
    out.canopy = [lathe([[0, 0.2], [0.03, 0.25], [0.04, 0.34], [0.032, 0.62], [0.012, 0.78], [0, 0.8]], { seg: 8 })];
  }
  return out;
}

// ---------------------------------------------------------------------------- registry
const handDefaults = { radius: 0.016, presets: ['grip'] };

/**
 * Prop types. `params` drive the editor (range/int/seg/toggle); `resizable`
 * = width/depth/height style params exist; `hand` = can be held.
 * hand.radius: handle radius (palm offset of the handle axis); hand.wrap: radius the
 * fingers close around (defaults to radius; larger = gentler bend for flat objects);
 * hand.thumb: thumb tip target [x, y, z] in grip space (flat objects; default: around the handle);
 * hand.hang: the prop swings around its handle to hang downward (bags);
 * hand.presets: pose-library hand presets used as a starting pose when available;
 * hand.rest(params) -> [rx, ry, rz] degrees (free orientation, grounded automatically);
 * hand.slide(params) -> [min, max] meters along the handle.
 */
export const PROP_TYPES = [
  { id: 'sedia', label: 'Sedia', cat: 'sedute', sub: 'sedie', tags: 'sedia legno cucina', color: '#8a5a3b', params: [], build: sedia },
  { id: 'sgabello', label: 'Sgabello alto', cat: 'sedute', sub: 'sgabelli', tags: 'bar', color: '#c49a6c', params: [range('height', 'Altezza seduta', 0.5, 0.85, 0.01, 0.65)], build: sgabello },
  { id: 'panca', label: 'Panca', cat: 'sedute', sub: 'panche', tags: 'panchina', color: '#8a5a3b', params: [range('length', 'Lunghezza', 0.6, 3, 0.05, 1.5)], build: panca },
  { id: 'tavolo', label: 'Tavolo', cat: 'tavoli', sub: 'pranzo', tags: 'tavolo cucina pranzo', color: '#c49a6c', resizable: true,
    params: [range('width', 'Larghezza', 0.5, 3, 0.05, 1.2), range('depth', 'Profondità', 0.4, 1.5, 0.05, 0.75), range('height', 'Altezza', 0.4, 1.1, 0.01, 0.75)], build: tavolo },
  { id: 'divano', label: 'Divano', cat: 'sedute', sub: 'divani', tags: 'divano sofà salotto penisola angolo', color: '#5d6b7a', params: [range('width', 'Larghezza', 1.4, 3.4, 0.05, 2.0), ...DIVANO_PARAMS], build: divanoGen },
  { id: 'letto', label: 'Letto', cat: 'letti', sub: 'letti', tags: 'letto camera matrimoniale singolo castello', color: '#8a5a3b', params: [range('width', 'Larghezza', 0.9, 2, 0.05, 1.6), ...LETTO_PARAMS], build: lettoGen },

  { id: 'cubo', label: 'Cubo / cassa', cat: 'strutture', sub: 'forme', color: '#c49a6c', resizable: true,
    params: [seg('style', 'Stile', [{ value: 'liscio', label: 'Liscio' }, { value: 'cassa', label: 'Cassa' }], 'liscio'),
      range('width', 'Larghezza', 0.1, 3, 0.01, 0.5), range('depth', 'Profondità', 0.1, 3, 0.01, 0.5), range('height', 'Altezza', 0.1, 3, 0.01, 0.5)], build: cubo },
  { id: 'scala', label: 'Scalini', cat: 'strutture', sub: 'scale', color: '#a9a49b',
    params: [int('steps', 'Gradini', 2, 10, 5), range('width', 'Larghezza', 0.5, 3, 0.05, 1.0), flag('railing', 'Corrimano', false)], build: scala },
  { id: 'muro', label: 'Muro', cat: 'strutture', sub: 'stanze', color: '#d8d2c6', resizable: true,
    params: [seg('opening', 'Apertura', [{ value: 'none', label: 'Nessuna' }, { value: 'window', label: 'Finestra' }, { value: 'door', label: 'Porta' }], 'none'),
      range('offset', 'Posizione apertura', -1, 1, 0.01, 0, ''),
      range('length', 'Lunghezza', 0.5, 8, 0.05, 3), range('height', 'Altezza', 1, 4, 0.05, 2.6), range('thickness', 'Spessore', 0.06, 0.4, 0.01, 0.15)], build: muro },
  { id: 'pedana', label: 'Pedana', cat: 'strutture', sub: 'forme', color: '#6f6b78', resizable: true,
    params: [range('width', 'Larghezza', 0.3, 5, 0.05, 2.0), range('depth', 'Profondità', 0.3, 5, 0.05, 1.2), range('height', 'Altezza', 0.05, 1.5, 0.01, 0.2)], build: pedana },
  { id: 'colonna', label: 'Colonna', cat: 'strutture', sub: 'forme', color: '#cfc8bb', resizable: true,
    params: [seg('style', 'Stile', [{ value: 'cilindro', label: 'Cilindro' }, { value: 'classica', label: 'Classica' }], 'cilindro'),
      range('diameter', 'Diametro', 0.1, 1.5, 0.01, 0.4), range('height', 'Altezza', 0.2, 5, 0.05, 2.5)], build: colonna },
  { id: 'palla', label: 'Palla', cat: 'strutture', sub: 'forme', color: '#c0504d', params: [range('diameter', 'Diametro', 0.05, 1.2, 0.01, 0.22)], build: palla },

  { id: 'spada', label: 'Spada', cat: 'mano', color: '#4a2f20', params: [range('blade', 'Lama', 0.3, 1.2, 0.01, 0.75)], build: spada,
    hand: { ...handDefaults, radius: 0.016, rest: () => [0, 0, -90], slide: () => [-0.05, 0.05] } },
  { id: 'bastone', label: 'Bastone', cat: 'mano', color: '#7a5634', params: [range('length', 'Lunghezza', 0.6, 2.2, 0.05, 1.5)], build: bastone,
    hand: { ...handDefaults, radius: 0.0165, rest: () => [0, 0, -90], slide: (p) => [-0.35 * p.length + 0.06, 0.65 * p.length - 0.06] } },
  { id: 'lancia', label: 'Lancia', cat: 'mano', color: '#6b4a2f', params: [range('length', 'Lunghezza asta', 1.2, 3.2, 0.05, 2.0)], build: lancia,
    hand: { ...handDefaults, radius: 0.015, rest: () => [0, 0, -90], slide: (p) => [-0.4 * p.length + 0.06, 0.6 * p.length - 0.04] } },
  { id: 'scudo', label: 'Scudo', cat: 'mano', color: '#7a1f24', params: [range('diameter', 'Diametro', 0.35, 1.0, 0.01, 0.6)], build: scudo,
    hand: { ...handDefaults, radius: 0.014, rest: () => [-90, 0, 0], slide: () => [-0.04, 0.04] } },
  { id: 'libro', label: 'Libro', cat: 'mano', color: '#2f4a6b', params: [], build: libro,
    hand: { ...handDefaults, radius: 0, wrap: 0.1, thumb: [0.041, 0.03, 0.03], presets: ['hold'], rest: () => [0, 0, 90], slide: () => [-0.08, 0.08] } },
  { id: 'tazza', label: 'Tazza', cat: 'mano', color: '#c0504d', params: [], build: tazza,
    hand: { ...handDefaults, radius: 0.041, presets: ['cup', 'grip'], rest: () => [0, 0, 0], slide: () => [-0.03, 0.03] } },
  { id: 'telefono', label: 'Telefono', cat: 'mano', color: '#3a3d44', params: [], build: telefono,
    hand: { ...handDefaults, radius: 0, wrap: 0.12, thumb: [0.017, 0.022, 0.045], presets: ['phone', 'hold'], rest: () => [0, 0, 90], slide: () => [-0.03, 0.03] } },
  { id: 'borsa', label: 'Borsa', cat: 'mano', color: '#7b4a2b', params: [], build: borsa,
    hand: { ...handDefaults, radius: 0.006, wrap: 0.008, hang: true, rest: () => [90, 0, 0], slide: () => [-0.06, 0.06] } },
  { id: 'ombrello', label: 'Ombrello', cat: 'mano', color: '#3d5a80', params: [flag('open', 'Aperto', true)], build: ombrello,
    hand: { ...handDefaults, radius: 0.0145, rest: (p) => (p.open ? [0, 0, 0] : [0, 0, -90]), slide: () => [-0.03, 0.6] } },
];

// procedural interiors
PROP_TYPES.push(...STORAGE_TYPES, ...KITCHEN_TYPES, ...FURNITURE_TYPES, ...BATH_TYPES, ...OFFICE_TYPES, ...OBJECT_TYPES, ...LEISURE_TYPES, ...STRUCTURE_TYPES);

// ready-made variants of parametric types (same generator, other defaults): easier to find
const VARIANTS = [
  ['divano', 'divano_angolare', 'Divano con penisola', { shape: 'Ldx', width: 2.6 }],
  ['divano', 'divanetto', 'Divanetto a 2 posti', { width: 1.5, style: 'squadrato', pillows: false }],
  ['divano', 'divano_retro', 'Divano rétro', { style: 'retro', width: 2.0 }, { color: '#4f6b3a' }],
  ['poltrona', 'poltrona_classica', 'Poltrona classica', { style: 'classica' }, { color: '#9b6b4a' }],
  ['poltrona', 'poltrona_moderna', 'Poltrona moderna', { style: 'moderna' }, { color: '#c49a6c' }],
  ['letto', 'letto_singolo', 'Letto singolo', { width: 0.9 }],
  ['letto', 'letto_imbottito', 'Letto imbottito', { model: 'imbottito', width: 1.8 }, { color: '#8c8f99' }],
  ['letto', 'letto_ferro', 'Letto in ferro sfatto', { model: 'ferro', width: 1.2, made: false }],
  ['letto', 'letto_castello', 'Letto a castello', { model: 'castello', width: 0.9 }],
  ['letto', 'letto_baldacchino', 'Letto a baldacchino', { model: 'baldacchino', width: 1.6 }],
  ['letto', 'futon', 'Futon', { model: 'futon', width: 1.4, made: false }],
  ['scrivania', 'scrivania_legno', 'Scrivania con cassetti', { style: 'legno', pc: 'laptop' }, { color: '#8a5a3b' }],
  ['tavolino', 'tavolino_vetro', 'Tavolino in vetro', { style: 'vetro' }],
  ['tavolino', 'tavolino_tondo', 'Tavolino tondo', { style: 'tondo', width: 0.8 }],
  ['armadio', 'armadio_specchio', 'Armadio con specchi', { style: 'specchio' }],
  ['armadio', 'armadio_scorrevole', 'Armadio scorrevole', { style: 'scorrevole', width: 2.4 }],
  ['armadio', 'armadio_classico', 'Armadio classico', { style: 'riquadri', finish: 'legno', doors: 2, width: 1.2 }, { color: '#8a5a3b' }],
  ['libreria', 'libreria_bianca', 'Libreria bianca', { style: 'bianco', width: 1.6 }],
  ['libreria', 'libreria_bassa', 'Libreria bassa', { height: 0.9, width: 1.6, shelves: 2 }],
  ['cucina', 'cucina_angolo', 'Cucina ad angolo', { shape: 'L' }],
  ['frigo', 'frigo_americano', 'Frigorifero americano', { style: 'americano' }],
  ['frigo', 'frigo_retro', 'Frigorifero rétro', { style: 'retro' }],
  ['vasca', 'vasca_piedini', 'Vasca con piedini', { style: 'piedini' }],
  ['lavabo', 'lavabo_colonna', 'Lavabo a colonna', { style: 'colonna' }],
  ['lampada_terra', 'lampada_arco', 'Lampada ad arco', { style: 'arco' }],
  ['lampada_terra', 'lampada_treppiede', 'Lampada a treppiede', { style: 'treppiede' }],
  ['sospensione', 'sospensione_globo', 'Lampada a globo', { style: 'globo' }],
  ['tappeto', 'tappeto_tondo', 'Tappeto tondo', { shape: 'tondo', pattern: 'geometrico', width: 1.6 }, { color: '#2f4a6b' }],
  ['tappeto', 'tappeto_moderno', 'Tappeto moderno', { pattern: 'moderno' }, { color: '#c9a227' }],
  ['quadro', 'quadro_astratto', 'Quadro astratto', { subject: 'astratto', format: 'verticale', frame: 'sottile' }],
  ['quadro', 'cavalletto', 'Tela su cavalletto', { easel: true, frame: 'nessuna', subject: 'mare' }, { mount: undefined, spawnY: undefined }],
  ['specchio', 'specchio_ovale', 'Specchio ovale', { style: 'dorato' }, { mount: 'wall', spawnY: 1.0 }],
  ['pianta', 'ficus', 'Ficus', { species: 'ficus', height: 1.4 }],
  ['pianta', 'sansevieria', 'Sansevieria', { species: 'sansevieria', height: 0.7, pot: 'bianco' }],
  ['pianta', 'palma', 'Palma da interno', { species: 'palma', height: 1.6, pot: 'cesto' }],
  ['pianta', 'felce', 'Felce', { species: 'felce', height: 0.6 }],
  ['pianta', 'cactus', 'Cactus', { species: 'cactus', height: 0.5 }],
  ['vaso_fiori', 'fiori_vaso', 'Fiori in vaso', { kind: 'margherite', vase: 'vetro' }, { cat: 'piante', sub: 'piante' }],
  ['scarpe', 'scarpe_eleganti', 'Scarpe eleganti', { style: 'elegante' }, { color: '#3a2418' }],
  ['scarpe', 'decollete', 'Décolleté', { style: 'decollete' }, { color: '#7a1f24' }],
  ['scarpe', 'stivali', 'Stivali', { style: 'stivale' }, { color: '#4a2f20' }],
  ['pianoforte', 'pianoforte_coda', 'Pianoforte a coda', { style: 'coda' }],
  ['chitarra', 'chitarra_elettrica', 'Chitarra elettrica', { style: 'elettrica' }, { color: '#2f4a6b' }],
  ['scala_interna', 'scala_l', 'Scala a L', { shape: 'L', railing: 'due' }],
  ['lavagna', 'lavagna_nera', 'Lavagna nera', { kind: 'nera', stand: false, width: 2.0 }, { mount: 'wall', spawnY: 0.9, color: '#6b4a2f' }],
  ['tv', 'tv_muro', 'TV a parete', { mount: 'muro', size: 65 }, { mount: 'wall', spawnY: 1.0 }],
];
for (const [baseId, id, label, defaults, extra = {}] of VARIANTS) {
  const i = PROP_TYPES.findIndex((t) => t.id === baseId);
  if (i < 0) continue;
  const b = PROP_TYPES[i];
  const v = { ...b, id, label, ...extra, params: b.params.map((p) => (p.id in defaults ? { ...p, default: defaults[p.id] } : p)), variantOf: baseId };
  let j = i + 1;
  while (j < PROP_TYPES.length && PROP_TYPES[j].variantOf === baseId) j++;
  PROP_TYPES.splice(j, 0, v);
}

// ---------------------------------------------------------------------------- carry
// Small realistic objects a character can pick up ("Prendi" in the long-press menu of
// the 3D view, "Attacca alla mano" in Oggetti). Their grip comes from the model size
// (model space: origin on the floor at the footprint centre, +Y up). hand.carry tells
// how the object is held:
//   'up'   the fist closes around the body at a height (vases, bottles, fruit, statuettes)
//   'long' a handle along +Y gripped low (tools, weapons, bats, brooms)
//   'top'  hanging from a top handle (baskets, buckets, lanterns, jerry cans, toolboxes)
//   'x'/'z' an object lying along x / z, held around its middle
// hand.grip(params, out) -> Matrix4 from model space to grip space (the fist at the
// grip point; see Prop.updatePivot). A carried object is never put straight into a
// hand when added from the library (add() leaves it on the floor).
const CARRY = {
  ph_ceramic_vase_01: ['up', 0.45], ph_ceramic_vase_02: ['up', 0.45], ph_ceramic_vase_03: ['up', 0.4], ph_ceramic_vase_04: ['up', 0.45],
  ph_antique_ceramic_vase_01: ['up', 0.45], ph_brass_vase_01: ['up', 0.4], ph_brass_vase_02: ['up', 0.45], ph_planter_pot_clay: ['up', 0.5],
  ph_potted_plant_04: ['up', 0.3], ph_marble_bust_01: ['up', 0.35], ph_horse_statue_01: ['up', 0.4], ph_carved_wooden_elephant: ['up', 0.5],
  ph_concrete_cat_statue: ['up', 0.4], ph_garden_gnome: ['up', 0.45], ph_mantel_clock_01: ['up', 0.5], ph_seadogs_compass: ['up', 0.5],
  ph_standing_picture_frame_01: ['up', 0.5], ph_standing_picture_frame_02: ['up', 0.5], ph_alarm_clock_01: ['up', 0.4],
  ph_wooden_candlestick: ['up', 0.3], ph_vintage_oil_lamp: ['up', 0.25], ph_lightbulb_01: ['up', 0.5], ph_vintage_electric_kettle: ['up', 0.5],
  ph_rubber_duck_toy: ['up', 0.4], ph_bleach_bottle: ['up', 0.5], ph_multi_cleaner_bottle: ['up', 0.45], ph_portable_cassette_player: ['up', 0.5],
  ph_cassette_player: ['up', 0.5], ph_vintage_video_camera: ['up', 0.4], ph_vintage_microscope: ['up', 0.3], ph_bunsen_burner: ['up', 0.3],
  ph_food_apple_01: ['up', 0.5], ph_lemon: ['up', 0.5], ph_food_lime_01: ['up', 0.5], ph_food_avocado_01: ['up', 0.5], ph_food_kiwi_01: ['up', 0.5],
  ph_food_pomegranate_01: ['up', 0.5], ph_food_pears_asian_01: ['up', 0.4], ph_yellow_onion: ['up', 0.5], ph_sweet_potato: ['up', 0.5],
  ph_jug_01: ['up', 0.5], ph_metal_jug: ['up', 0.5], ph_wooden_bowl_02: ['up', 0.5], ph_plastic_thermos: ['up', 0.5], ph_russian_food_cans_01: ['up', 0.5],
  ph_baseball_01: ['up', 0.5], ph_pocket_watch: ['up', 0.5], ph_vintage_lighter: ['up', 0.5], ph_cigarette_pack: ['up', 0.5], ph_kite_shield: ['up', 0.5],
  ph_croissant: ['x', 0.5], ph_lambis_shell: ['x', 0.5], ph_CheeseBox_01: ['x', 0.5], ph_american_football: ['x', 0.5],
  ph_vintage_flashlight: ['z', 0.5], ph_binoculars: ['z', 0.5],
  ph_Lantern_01: ['top'], ph_wooden_lantern_01: ['top'], ph_brass_diya_lantern: ['top'], ph_wicker_basket_01: ['top'], ph_wicker_basket_02: ['top'],
  ph_wooden_bucket_01: ['top'], ph_metal_jerrycan: ['top'], ph_plastic_jerrycan: ['top'], ph_metal_toolbox: ['top'], ph_boombox: ['top'],
  ph_korean_fire_extinguisher_01: ['top'], ph_watering_can_metal_01: ['top'], ph_trashbag: ['top'], ph_propane_tank: ['top'], ph_ammo_box: ['top'],
  ph_cross_pein_hammer: ['long', 0.2], ph_sledgehammer_01: ['long', 0.2], ph_hatchet: ['long', 0.2], ph_wooden_axe: ['long', 0.2],
  ph_adjustable_wrench: ['long', 0.25], ph_pipe_wrench: ['long', 0.25], ph_pliers: ['long', 0.3], ph_crowbar_01: ['long', 0.25],
  ph_bolt_cutters_01: ['long', 0.2], ph_magnifying_glass_01: ['long', 0.2], ph_rusted_spade_01: ['long', 0.85], ph_wooden_broom: ['long', 0.65],
  ph_plastic_broom: ['long', 0.65], ph_plunger: ['long', 0.8], ph_antique_katana_01: ['long', 0.12], ph_wooden_handle_saber: ['long', 0.12],
  ph_antique_estoc: ['long', 0.1], ph_ornate_medieval_dagger: ['long', 0.15], ph_machete: ['long', 0.15], ph_ornate_medieval_mace: ['long', 0.12],
  ph_ornate_war_hammer: ['long', 0.12], ph_baseball_bat: ['long', 0.12], ph_Ukulele_01: ['long', 0.7], ph_service_pistol: ['long', 0.3], ph_Drill_01: ['long', 0.3],
};
const clampR = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Hand descriptor (see the PROP_TYPES header) of a carried model of size [w, h, d]. */
export function carryHand(mode, k, [w, h, d]) {
  const g = new THREE.Matrix4();
  const R = new THREE.Matrix4();
  let radius, slide, hang = false;
  if (mode === 'top') {
    // handle across the longer horizontal side; the body hangs below it (grip +Z)
    if (w >= d) R.makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0));
    else R.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
    g.multiplyMatrices(R, new THREE.Matrix4().makeTranslation(0, -(h - 0.015), 0));
    radius = 0.008; slide = [-0.05, 0.05]; hang = true;
  } else if (mode === 'x' || mode === 'z') {
    if (mode === 'x') R.makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1));
    else R.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
    g.multiplyMatrices(R, new THREE.Matrix4().makeTranslation(0, -h / 2, 0));
    const L = mode === 'x' ? w : d;
    radius = clampR(Math.min(h, mode === 'x' ? d : w) * 0.45, 0.012, 0.06); slide = [-L / 2, L / 2];
  } else {
    g.makeTranslation(0, -k * h, 0);
    radius = mode === 'long' ? 0.016 : clampR(Math.min(w, d) * 0.45, 0.015, 0.09);
    slide = [-k * h, (1 - k) * h];
  }
  return {
    carry: mode, radius, wrap: mode === 'top' ? 0.008 : radius, hang,
    presets: mode === 'top' || mode === 'long' || radius < 0.035 ? ['grip'] : ['cup', 'grip'],
    rest: () => [0, 0, 0], slide: () => slide, grip: (params, out = new THREE.Matrix4()) => out.copy(g),
  };
}

// realistic CC0 models (Poly Haven), loaded on first use (see models.js)
const MODEL_BASE = './assets/props/';
const CEIL_Y = 2.7, WALL_Y = 1.5;
for (const m of PH_MODELS) {
  const t = { id: m.id, label: m.label, cat: m.cat, sub: m.sub, tags: m.tags, color: '#ffffff', params: [], realistic: true,
    model: `${MODEL_BASE}models/${m.ph}.glb`, thumb: `${MODEL_BASE}thumbs/${m.ph}.webp`, size: m.size, tint: true };
  if (m.mount === 'ceil') { t.mount = 'ceil'; t.spawnY = Math.max(0, CEIL_Y - m.size[1]); }
  else if (m.mount === 'wall') { t.mount = 'wall'; t.spawnY = Math.max(0.3, WALL_Y - m.size[1] / 2); }
  // long tools / weapons start lying on the floor (flat side down)
  if (m.lie) t.lieRot = m.size[0] < m.size[2] ? [0, 0, 90] : [-90, 0, 0];
  const c = CARRY[m.id];
  if (c) t.hand = carryHand(c[0], c[1], m.size);
  PROP_TYPES.push(t);
}

/**
 * Explicit affordances (what a character can do with a type from the long-press menu,
 * see props/actions.js), for types whose id / category does not tell. Any type may
 * also carry its own `afford: [...]` (other modules' registered types).
 *   seat     one can sit on it          sofa     several seats, one can lie along it
 *   bed      one can lie on it          table    sit at it (a chair is brought) / lean on it
 *   surface  things can be put on it    wall     one can lean against it
 *   window   look out of it             floor    sit / lie down on it
 *   vehicle  lean on it                 nokneel  no "Inginocchiati" (tall or awkward)
 * 'openable' comes from an 'open' parameter, 'carry' from `hand`.
 */
export const AFFORD = {
  cubo: ['seat', 'surface'], pedana: ['floor', 'surface'], pavimento: ['floor'], colonna: ['wall'], scala: [],
  wc: ['seat'], panca_pesi: ['seat', 'bed'], biliardo: ['surface', 'table'], pingpong: ['surface', 'table'], lavabo: ['surface'], lavabo_colonna: ['surface'],
  isola_cucina: ['surface', 'table'], bancone: ['surface', 'table'], cucina: ['surface'], cucina_angolo: ['surface'], cattedra: ['surface', 'table'],
  postazione: ['surface', 'table'], banchi_aula: ['surface', 'table'], mobile_tv: ['surface'], cassettiera: ['surface'], comodino: ['surface'],
  scrivania: ['surface', 'table'], scrivania_legno: ['surface', 'table'], schedario: ['surface'], lavatrice: ['surface'],
  ph_vintage_day_bed: ['sofa', 'bed'], ph_Ottoman_01: ['seat'], ph_wooden_stool_02: [], ph_wooden_crate_01: ['seat', 'surface'], ph_wooden_crate_02: ['seat', 'surface'],
  ph_wooden_military_crate: ['seat', 'surface'], ph_old_military_crate: ['seat', 'surface'], ph_treasure_chest: ['seat'], ph_wine_barrel_01: ['seat', 'surface'],
  ph_Barrel_01: ['surface'], ph_barrel_03: ['surface'], ph_Barrel_02: ['surface'], ph_CoffeeCart_01: ['surface'], ph_metal_tool_chest: ['surface'],
  ph_GothicCommode_01: ['surface'], ph_drawer_cabinet: ['wall'], ph_vintage_wooden_drawer_01: ['surface'], ph_painted_wooden_cabinet: ['surface'],
  ph_GothicCabinet_01: ['surface'], ph_modern_wooden_cabinet: ['surface'], ph_WoodenTable_03: ['surface'], ph_vintage_grandfather_clock_01: ['wall'],
  ph_projector_screen: ['wall'], ph_chinese_screen_panels: ['wall'], ph_standing_chalkboard_01: ['wall'],
  // exteriors and landscapes (registered by their modules)
  es_panchina: ['seat'], es_muretto: ['seat', 'wall'], es_fermata: ['seat', 'wall'], es_recinzione: ['wall'], es_lampione: ['wall', 'nokneel'],
  es_palo: ['wall', 'nokneel'], es_semaforo: ['wall', 'nokneel'], es_cartello: ['wall', 'nokneel'], es_cabina: ['wall'], es_edicola: ['wall'],
  es_cassetta: ['wall'], es_tronco: ['seat'], es_roccia: ['seat'], es_prato: ['floor'], es_piazza: ['floor'], es_vialetto: ['floor'],
  es_cassonetto: ['wall'], es_transenna: ['wall'], es_fontanella: [], phc_tree_stump_01: ['seat'], phc_tree_stump_02: ['seat'],
  phc_dead_tree_trunk: ['seat'], phc_dead_tree_trunk_02: ['seat'], phc_boulder_01: ['seat', 'wall'], phc_namaqualand_boulder_03: ['seat', 'wall'],
  phc_namaqualand_boulder_04: ['seat', 'wall'], phc_namaqualand_boulder_05: ['seat'], phc_rock_07: ['seat'], phc_rock_face_01: ['wall'],
  phc_rock_face_02: ['wall'], phc_namaqualand_cliff_01: ['wall'], phc_concrete_road_barrier: ['seat', 'wall'], phc_concrete_road_barrier_02: ['seat', 'wall'],
  phc_utility_box_01: ['wall'], phc_utility_box_02: ['wall'], phc_wooden_picnic_table: ['surface', 'table'], phc_old_tyre: ['seat'],
  phc_street_lamp_01: ['wall', 'nokneel'], phc_covered_car: ['vehicle', 'wall'],
  ls_lettino: ['bed', 'seat'], ls_fieno: ['seat', 'wall'], ls_molo: ['floor'], ls_rovina: ['wall', 'seat'], ls_pozzo: ['wall'], ls_fontana: ['seat'],
  ls_carretto: ['wall'], ls_container: ['wall'], ls_bancarella: ['surface', 'table'], ls_barca: ['seat'], ls_tetto: ['floor'],
};

/** Swatches of the tint picker of realistic models (white = original colors). */
export const TINT_COLORS = ['#ffffff', '#f0d9b5', '#d9a07a', '#c0504d', '#7a1f24', '#e3c76a', '#8fb37a', '#6d8fb0', '#5d4e7a', '#8c8c8c'];

export const TYPE_BY_ID = new Map(PROP_TYPES.map((t) => [t.id, t]));

// ---------------------------------------------------------------------------- extension point
// Other modules (buildings, city, animals…) add their own prop types and
// categories at runtime. A type follows the PROP_TYPES contract: {id, label, cat,
// color, params, build(params) -> {role: BufferGeometry[], $specs?: {role: spec | (color) => spec}},
// resizable?, hand?}; or a realistic model: {model: url of a GLB, size: [w, h, d], thumb?: image url}.
// Optional: `sub` groups items inside a category (category.subs = [{id, label}]),
// `tags` (Italian words) help the search, `thumb` an image instead of a rendered
// thumbnail, `spawnY` the height of a new instance (wall / ceiling items),
// a 'seed' param ({id: 'seed', type: 'seed'}) shows a "Rigenera" button.
// Category: {id, label, subs?, ownTool?: true (listed by the module's own tool, not by "Oggetti")}.
// Roles not in ROLES fall back to 'main'; modules may add roles (registerPropRoles).
const _typeListeners = new Set();
export function registerPropTypes(types = [], categories = []) {
  for (const c of categories) if (!CATEGORIES.some((x) => x.id === c.id)) CATEGORIES.push(c);
  for (const t of types) {
    if (!t?.id || TYPE_BY_ID.has(t.id)) continue;
    t.params ||= [];
    PROP_TYPES.push(t);
    TYPE_BY_ID.set(t.id, t);
  }
  for (const fn of _typeListeners) { try { fn(); } catch (e) { console.error(e); } }
}
/** Material roles: {name: (color) => materialSpec}. Existing roles are not overwritten. */
export function registerPropRoles(roles = {}) {
  for (const [k, fn] of Object.entries(roles)) if (!ROLES[k]) ROLES[k] = fn;
}
export function onPropTypesChanged(fn) { _typeListeners.add(fn); return () => _typeListeners.delete(fn); }

/** Default parameter object of a type. */
export function defaultParams(type) {
  const o = {};
  for (const p of type.params) o[p.id] = p.default;
  return o;
}

/** Sanitized parameters (unknown keys dropped, ranges clamped). */
export function cleanParams(type, params = {}) {
  const o = defaultParams(type);
  for (const p of type.params) {
    const v = params[p.id];
    if (v === undefined || v === null) continue;
    if (p.type === 'range' || p.type === 'int') { const n = +v; if (Number.isFinite(n)) o[p.id] = Math.min(p.max, Math.max(p.min, p.type === 'int' ? Math.round(n) : n)); }
    else if (p.type === 'seed') { const n = Math.round(+v); if (Number.isFinite(n)) o[p.id] = Math.max(0, Math.min(1e9, n)); }
    else if (p.type === 'toggle') o[p.id] = !!v;
    else if (p.type === 'seg' && p.options.some((x) => x.value === v)) o[p.id] = v;
  }
  return o;
}
