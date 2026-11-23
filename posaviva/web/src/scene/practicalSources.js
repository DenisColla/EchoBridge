// Light-emitting prop types ("practicals") and windows: which props cast light,
// from where, with which colour temperature, which parts glow when they are on.
//
// A prop type may also describe itself with a `light` field (same shape as the
// entries below), e.g. {kind: 'point', kelvin: 2700, cd: 2.4, range: 8, glow: ['bulb'], at: 'bulb'}.
//
// Entry fields
//   kind     'point' | 'spot' | 'screen' (wide spot along the screen normal) or fn(params) -> kind
//   kelvin   colour temperature (number or fn(params)); color: hex (neon) or fn(params) -> hex | null
//   cd       base intensity in the rig's units (illuminance at 1 m), multiplied by the 0..2 slider
//   range    distance (m) where the light fades out (smooth cutoff, keeps light inside rooms)
//   glow     material roles that glow (emissive) only while the light is on
//   hideOff  roles hidden while off (candle flames)
//   at       where the bulb is: a role name (centre of that part) or [fx, fy, fz] fraction of
//            the prop bounds (realistic models); may be fn(params) returning either
//   pos      fn(params) -> [x, y, z] bulb position in pivot space (instead of `at`)
//   offset   [x, y, z] added to the bulb position (pivot space, meters)
//   dir      spot direction in pivot space ([0, -1, 0] = down); screens use the part normal
//   angle    full cone (deg) and penumbra (0..1) of spots
//   onParam  boolean parameter that already means on / off (lanterns and bonfires: 'lit')
//   offWhen  fn(params) -> true when the object is off by itself (TV with a blank screen)
//   night    true: on by default only at evening / night when a landscape sets the time
//   label    short Italian name used in lists ("Lampada", "Candela"...)
import * as THREE from 'three';
import { box, boxOn, cylinder, lathe, rod, sphere, tube, colorize } from '../props/geo.js';
import { range, int, seg, flag } from '../props/params.js';

export const NEON_HEX = { rosa: '#ff4fb8', blu: '#43b6ff', verde: '#55ff8a', rosso: '#ff3b3b', giallo: '#ffd23f', viola: '#b467ff' };

const LAMP = { kind: 'point', kelvin: 2700, cd: 2.6, range: 9, glow: ['bulb', 'shade', 'glassLamp'], at: 'bulb', label: 'Lampada' };
const CANDLE = { kind: 'point', kelvin: 1900, cd: 0.22, range: 3.5, label: 'Candela' };
const SCREEN = { kind: 'screen', kelvin: 7800, angle: 150, penumbra: 1, range: 6, offWhen: (p) => p.content === 'spento', label: 'Schermo' };
const MODEL = (at, extra = {}) => ({ kind: 'point', kelvin: 2700, cd: 2.4, range: 9, at, ...extra });

export const SOURCES = {
  // ------------------------------------------------------------ procedural lamps (props/gen/office.js)
  lampada_terra: {
    ...LAMP, cd: 2.8,
    kind: (p) => (p.style === 'arco' ? 'spot' : 'point'),
    dir: [0, -1, 0], angle: 125, penumbra: 0.75,
    glow: ['bulb', 'shade'], label: 'Lampada da terra',
  },
  abatjour: { ...LAMP, cd: 1.3, range: 6, glow: ['bulb', 'shade'], label: 'Abat-jour' },
  sospensione: {
    ...LAMP, cd: 3.2, range: 10,
    kind: (p) => (p.style === 'globo' ? 'point' : 'spot'),
    dir: [0, -1, 0], angle: 120, penumbra: 0.7, offset: [0, -0.02, 0], label: 'Sospensione',
  },
  plafoniera: {
    ...LAMP, cd: 3.4, range: 10, kelvin: (p) => (p.style === 'neon' ? 4200 : 3000),
    at: (p) => (p.style === 'neon' ? 'bulb' : 'glassLamp'), offset: [0, -0.05, 0], glow: ['bulb', 'glassLamp'], label: 'Plafoniera',
  },
  faretto: {
    kind: 'spot', kelvin: (p) => (p.style === 'softbox' ? 5600 : 5000), cd: (p) => (p.style === 'softbox' ? 6 : 8), range: 14,
    at: (p) => (p.style === 'softbox' ? 'diffuser' : 'bulb'), offset: [0, 0, 0.06], dir: [0, 0, 1],
    angle: (p) => (p.style === 'softbox' ? 110 : 46), penumbra: (p) => (p.style === 'softbox' ? 0.95 : 0.35),
    glow: ['diffuser', 'bulb'], label: 'Luce da studio',
  },
  // ------------------------------------------------------------ screens
  tv: { ...SCREEN, cd: (p) => 0.6 + p.size / 60, glow: ['tvScreen'], at: 'tvScreen', label: 'TV' },
  monitor: { ...SCREEN, cd: 0.45, range: 4, glow: ['monScreen'], at: 'monScreen', label: 'Monitor' },
  laptop: { ...SCREEN, cd: 0.25, range: 3, glow: ['lapScreen'], at: 'lapScreen', offWhen: (p) => p.open < 20, label: 'Portatile' },
  // ------------------------------------------------------------ realistic models (Poly Haven)
  ph_Chandelier_01: MODEL([0.5, 0.42, 0.5], { cd: 3.4, range: 11, label: 'Lampadario' }),
  ph_Chandelier_02: MODEL([0.5, 0.42, 0.5], { cd: 3.4, range: 11, label: 'Lampadario' }),
  ph_Chandelier_03: MODEL([0.5, 0.5, 0.5], { kelvin: 1900, cd: 2.6, range: 10, label: 'Lampadario a candele' }),
  ph_lantern_chandelier_01: MODEL([0.5, 0.35, 0.5], { cd: 3, label: 'Lampadario a lanterna' }),
  ph_chinese_chandelier: MODEL([0.5, 0.45, 0.5], { kelvin: 2300, cd: 2.4, label: 'Lanterna cinese' }),
  ph_modern_ceiling_lamp_01: MODEL([0.5, 0.12, 0.5], { cd: 3, label: 'Sospensione' }),
  ph_hanging_industrial_lamp: MODEL([0.5, 0.06, 0.5], { kind: 'spot', dir: [0, -1, 0], angle: 110, penumbra: 0.6, cd: 3.4, range: 11, label: 'Lampada industriale' }),
  ph_caged_hanging_light: MODEL([0.5, 0.15, 0.5], { kelvin: 4000, cd: 3.2, range: 10, label: 'Plafoniera a gabbia' }),
  ph_mounted_fluorescent_lights: MODEL([0.5, 0, 0.5], { kelvin: 4300, cd: 3.4, range: 10, offset: [0, -0.06, 0], label: 'Neon' }),
  ph_desk_lamp_arm_01: MODEL([0.5, 0.86, 0.86], { kind: 'spot', dir: [0, -1, 0.25], angle: 95, penumbra: 0.55, cd: 1.6, range: 5, label: 'Lampada snodata' }),
  ph_industrial_pipe_lamp: MODEL([0.5, 0.82, 0.78], { kind: 'spot', dir: [0, -1, 0.2], angle: 100, penumbra: 0.6, cd: 1.2, range: 4, label: 'Lampada a tubi' }),
  ph_vintage_oil_lamp: MODEL([0.5, 0.42, 0.5], { kelvin: 1900, cd: 0.6, range: 5, label: 'Lume a petrolio' }),
  ph_brass_candleholders: MODEL([0.5, 0.97, 0.5], { ...CANDLE, cd: 0.6, range: 5, at: [0.5, 0.97, 0.5], label: 'Candelabri' }),
  ph_wooden_candlestick: MODEL([0.5, 1.02, 0.5], { ...CANDLE, at: [0.5, 1.02, 0.5], label: 'Candela' }),
  ph_industrial_wall_lamp: MODEL([0.5, 0.35, 0.75], { cd: 1.6, range: 7, label: 'Applique' }),
  ph_industrial_wall_sconce: MODEL([0.5, 0.75, 0.6], { cd: 1.4, range: 7, label: 'Applique' }),
  ph_Lantern_01: MODEL([0.5, 0.45, 0.5], { kelvin: 2100, cd: 0.55, range: 5, label: 'Lanterna' }),
  ph_wooden_lantern_01: MODEL([0.5, 0.45, 0.5], { kelvin: 2000, cd: 0.6, range: 5, label: 'Lanterna' }),
  ph_brass_diya_lantern: MODEL([0.5, 0.38, 0.5], { kelvin: 1900, cd: 0.45, range: 4, label: 'Lanterna' }),
  ph_vintage_flashlight: MODEL([0.5, 0.55, 1.0], { kind: 'spot', dir: [0, 0, 1], angle: 34, penumbra: 0.4, kelvin: 4200, cd: 1.2, range: 8, label: 'Torcia' }),
  ph_lightbulb_01: MODEL([0.5, 0.62, 0.5], { cd: 0.9, range: 6, label: 'Lampadina' }),
  // ------------------------------------------------------------ city (city/street.js, city/phCity.js)
  es_lampione: {
    kind: (p) => (p.style === 'classico' || p.style === 'sfera' ? 'point' : 'spot'),
    kelvin: (p) => (p.style === 'classico' || p.style === 'sfera' ? 2300 : 4000),
    cd: (p) => 3 + p.height * p.height * 0.55, range: (p) => 10 + p.height * 3,
    at: 'c:lampGlass', offset: [0, -0.08, 0], dir: [0, -1, 0], angle: 130, penumbra: 0.6,
    glow: ['c:lampGlass'], night: true, label: 'Lampione',
  },
  phc_street_lamp_01: MODEL([0.5, 0.84, 0.5], { kelvin: 2300, cd: 9, range: 18, night: true, label: 'Lampione' }),
  // ------------------------------------------------------------ landscapes (landscapes/types.js)
  ls_lanterna: {
    kind: 'point', kelvin: 1900, cd: 1.1, range: 7, onParam: 'lit',
    at: (p) => (p.style === 'torcia' ? 'l:flame' : 'l:lamp'), glow: [], night: true, label: 'Lanterna',
  },
  ls_falo: { kind: 'point', kelvin: 1800, cd: 3.2, range: 12, onParam: 'lit', at: (p) => (p.lit ? 'l:flame' : [0.5, 0.35, 0.5]), offset: [0, 0.1, 0], glow: [], night: true, label: 'Falò' },
  ls_insegna: {
    kind: 'point', color: (p) => NEON_HEX[p.color] || NEON_HEX.rosa, cd: (p) => 0.6 + p.width * 0.4, range: 8,
    at: 'neon', offset: (p) => (p.mount === 'bandiera' ? [0, 0, 0] : [0, 0, 0.35]), glow: ['neon'], keepEmissive: true, label: 'Insegna',
  },
  // ------------------------------------------------------------ PosaViva practicals (registered below)
  candela: { ...CANDLE, cd: (p) => 0.16 + 0.07 * p.count, at: 'pl:flame', offset: [0, 0.02, 0], glow: ['pl:flame'], hideOff: ['pl:flame'], label: 'Candela' },
  lucine: { kind: 'point', kelvin: 2400, color: (p) => (p.colors === 'multicolore' ? '#ffd9a8' : null), cd: (p) => 0.35 + p.length * 0.12, range: 6, pos: (p) => [0, p.height - p.sag * 0.9 - 0.05, 0.05], glow: ['pl:bulbs'], label: 'Lucine' },
  camino: { kind: 'point', kelvin: 1800, cd: 2.4, range: 9, at: 'pl:flame', offset: [0, 0.05, 0.12], glow: ['pl:flame', 'pl:embers'], hideOff: ['pl:flame'], label: 'Camino' },
};

/** Source description of a prop type (own `light` field, table entry, or the base type of a variant). */
export function sourceOf(type) {
  if (!type) return null;
  if (type.light) return type.light;
  return SOURCES[type.id] || (type.variantOf ? SOURCES[type.variantOf] : null) || null;
}

/** Resolves a field that may be a function of the params. */
export const val = (v, params, prop) => (typeof v === 'function' ? v(params, prop) : v);

// ============================================================================= windows
/**
 * Window openings of a prop in PIVOT space: [{c: Vector3 centre, n: Vector3 normal
 * (unit, local +Z side), w, h, inside: +1 (normal points inside) | -1 | 0 (unknown:
 * the side of the characters decides), glassRoles}].
 */
export function windowsOf(prop) {
  const t = prop.type, p = prop.params;
  const id = t.variantOf || t.id;
  if (id === 'finestra') {
    return [{ c: new THREE.Vector3(0, p.height / 2, 0), n: new THREE.Vector3(0, 0, 1), w: p.width - 0.12, h: p.height - 0.12, inside: 0 }];
  }
  if (id === 'muro' && p.opening === 'window') {
    const L = p.length, H = p.height;
    const ow = Math.min(1.0, L - 0.3), oh = Math.max(0.3, Math.min(1.2, H - 1.05)), oy = Math.max(0.1, Math.min(0.9, H - oh - 0.15));
    const cx = p.offset * Math.max(0, (L - ow) / 2 - 0.12);
    return [{ c: new THREE.Vector3(cx, oy + oh / 2, 0), n: new THREE.Vector3(0, 0, 1), w: ow, h: oh, inside: 0 }];
  }
  if (id === 'stanza' && p.window && p.window !== 'nessuna') {
    const W = p.width, D = p.depth, H = p.height, T = 0.12;
    const walls = p.walls === '4' ? ['fondo', 'sinistra', 'destra', 'davanti'] : p.walls === '2' ? ['fondo', 'sinistra'] : ['fondo', 'sinistra', 'destra'];
    if (!walls.includes(p.window)) return [];
    const sides = { fondo: [W, 0, -D / 2 - T / 2, 0], sinistra: [D, -W / 2 - T / 2, 0, 90], destra: [D, W / 2 + T / 2, 0, -90], davanti: [W, 0, D / 2 + T / 2, 180] };
    const [L, x, z, ry] = sides[p.window];
    const w = Math.min(1.4, L - 0.6), h = Math.min(1.35, H - 1.2), cx = p.door === p.window ? -L * 0.2 : 0;
    const len = p.window === 'fondo' || p.window === 'davanti' ? L + 2 * T : L;
    if (!(cx - w / 2 > -len / 2 + 0.05 && cx + w / 2 < len / 2 - 0.05)) return [];
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (ry * Math.PI) / 180);
    const c = new THREE.Vector3(cx, 0.95 + h / 2, 0).applyQuaternion(q).add(new THREE.Vector3(x, 0, z));
    return [{ c, n: new THREE.Vector3(0, 0, 1).applyQuaternion(q), w: w - 0.1, h: h - 0.1, inside: 1 }];
  }
  return [];
}

/** True when the prop type can have a window opening (it may have none with its current params). */
export function isWindowType(type) {
  const id = type?.variantOf || type?.id;
  return id === 'finestra' || id === 'muro' || id === 'stanza';
}

// ============================================================================= new prop types
// Candles / candelabra, string lights and a fireplace: registered by the scene
// module in the props catalog (category 'luci'), every one a practical light.
const WAX = '#efe6d2';
export const PRACTICAL_ROLES = {
  'pl:flame': () => ({ kind: 'prop', color: '#ffcf7a', roughness: 1 }),
  'pl:wax': () => ({ kind: 'prop', color: WAX, roughness: 0.55, sheen: 0.2 }),
  'pl:wick': () => ({ kind: 'prop', color: '#2a2420', roughness: 0.9 }),
  'pl:bulbs': () => ({ kind: 'prop', color: '#ffffff', roughness: 0.25, vertexColors: true }),
  'pl:cable': () => ({ kind: 'prop', color: '#1d1e20', roughness: 0.6 }),
  'pl:stone': () => ({ kind: 'prop', color: '#cfc6b8', roughness: 0.85 }),
  'pl:soot': () => ({ kind: 'prop', color: '#1b1918', roughness: 0.95 }),
  'pl:embers': () => ({ kind: 'prop', color: '#4a2416', roughness: 0.9 }),
};

const flame = (x, y, z, s = 1) => lathe([[0, 0], [0.009 * s, 0.006 * s], [0.011 * s, 0.016 * s], [0.007 * s, 0.03 * s], [0, 0.046 * s]], { x, y, z, seg: 10 });

function candela(p) {
  const out = { 'pl:wax': [], 'pl:wick': [], 'pl:flame': [] };
  const n = p.count, H = p.height, r = p.style === 'grossa' ? 0.035 : 0.011;
  const spots = [];
  if (n === 1) spots.push([0, 0]);
  else for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; spots.push([Math.cos(a) * 0.11, Math.sin(a) * 0.11]); }
  let base = 0;
  if (p.style === 'candelabro' || n > 1) {
    base = 0.22;
    out.gold = [lathe([[0, 0], [0.07, 0], [0.065, 0.015], [0.02, 0.03], [0.016, 0.16], [0.03, 0.2], [0, 0.21]], { seg: 24 })];
    for (const [x, z] of spots) {
      if (x || z) out.gold.push(tube([[0, 0.17, 0], [x * 0.5, 0.15, z * 0.5], [x, 0.19, z], [x, base - 0.01, z]], 0.006, { segs: 16, rs: 6 }));
      out.gold.push(cylinder(0.022, 0.026, 0.02, { x, y: base - 0.02, z, seg: 16 }));
    }
  } else if (p.style !== 'grossa') {
    base = 0.012;
    out.gold = [cylinder(0.045, 0.05, 0.012, { seg: 24 }), cylinder(0.016, 0.018, 0.02, { y: 0.01, seg: 16 })];
  }
  for (const [x, z] of spots) {
    out['pl:wax'].push(cylinder(r, r, H, { x, y: base, z, seg: 16, bevel: 0.002 }));
    out['pl:wick'].push(rod([x, base + H - 0.002, z], [x, base + H + 0.012, z], 0.0012, { seg: 5 }));
    out['pl:flame'].push(flame(x, base + H + 0.006, z, p.style === 'grossa' ? 1.4 : 1));
  }
  return out;
}

function lucine(p) {
  const L = p.length, Hh = p.height, sag = p.sag, n = p.bulbs;
  const out = { 'pl:cable': [], 'pl:bulbs': [] };
  const at = (t) => [(t - 0.5) * L, Hh - sag * 4 * t * (1 - t), 0];
  const pts = [];
  for (let i = 0; i <= 24; i++) pts.push(at(i / 24));
  out['pl:cable'].push(tube(pts, 0.003, { segs: 64, rs: 5 }));
  const MULTI = ['#ff5a5a', '#ffd45a', '#62d56b', '#5aa8ff', '#ff8ad8'];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, [x, y, z] = at(t);
    const g = sphere(0.012, { x, y: y - 0.016, z, ws: 8, hs: 6 });
    colorize(g, p.colors === 'multicolore' ? MULTI[i % MULTI.length] : '#fff1c9');
    out['pl:bulbs'].push(g);
  }
  if (p.poles) {
    out.darkMetal = [];
    for (const s of [-1, 1]) out.darkMetal.push(cylinder(0.012, 0.012, Hh + 0.04, { x: s * L / 2, seg: 10 }), cylinder(0.07, 0.08, 0.025, { x: s * L / 2, seg: 18 }));
  }
  return out;
}

function camino(p) {
  const W = p.width, H = 1.1, D = 0.45, ow = W * 0.58, oh = 0.62, out = { 'pl:stone': [], 'pl:soot': [], 'pl:embers': [], wood: [] };
  out['pl:stone'].push(
    boxOn((W - ow) / 2, H, D, { x: -(W + ow) / 4, z: 0 }), boxOn((W - ow) / 2, H, D, { x: (W + ow) / 4, z: 0 }),
    boxOn(ow, H - oh, D, { x: 0, y: oh }), boxOn(W + 0.14, 0.06, D + 0.12, { y: H, z: 0.03, r: 0.01 }),
    boxOn(W + 0.2, 0.05, D + 0.3, { z: 0.1, r: 0.006 }),
  );
  out['pl:soot'].push(boxOn(ow, oh, 0.04, { z: -D / 2 + 0.03 }), boxOn(0.03, oh, D - 0.05, { x: -ow / 2 + 0.015 }), boxOn(0.03, oh, D - 0.05, { x: ow / 2 - 0.015 }), boxOn(ow, 0.02, D - 0.05, { y: oh - 0.02 }));
  for (let i = 0; i < 3; i++) out.wood.push(rod([-ow * 0.3 + i * 0.04, 0.09 + i * 0.03, 0.06 - i * 0.07], [ow * 0.3 - i * 0.05, 0.09 + (2 - i) * 0.03, -0.04 + i * 0.05], 0.035, { seg: 8 }));
  out['pl:embers'].push(box(ow * 0.6, 0.03, D * 0.5, { y: 0.065, z: 0.0 }));
  if (p.lit) {
    out['pl:flame'] = [];
    for (let i = 0; i < 5; i++) out['pl:flame'].push(lathe([[0, 0], [0.06, 0.05], [0.045, 0.16], [0.02, 0.26], [0, 0.32 + 0.06 * (i % 2)]], { x: (i - 2) * ow * 0.11, y: 0.1, z: 0.01 * (i % 3), seg: 9 }));
  }
  return out;
}

export const PRACTICAL_TYPES = [
  { id: 'candela', label: 'Candela', cat: 'luci', sub: 'terra-tavolo', color: WAX, tags: 'candela candele candelabro lume fiamma cena romantica', noColor: true, params: [
    seg('style', 'Modello', [['semplice', 'Con piattino'], ['grossa', 'Grossa'], ['candelabro', 'Candelabro']], 'semplice'), int('count', 'Candele', 1, 5, 1), range('height', 'Altezza', 0.05, 0.3, 0.01, 0.16),
  ], build: candela },
  { id: 'lucine', label: 'Lucine', cat: 'luci', sub: 'parete', color: '#1d1e20', tags: 'lucine catena luminosa festa natale ghirlanda lampadine fili', noColor: true, params: [
    range('length', 'Lunghezza', 0.8, 6, 0.1, 2.4), range('height', 'Altezza', 0.5, 3, 0.05, 2.0), range('sag', 'Curva', 0, 0.6, 0.01, 0.25), int('bulbs', 'Lampadine', 6, 40, 18),
    seg('colors', 'Colore', [['calde', 'Calde'], ['multicolore', 'Multicolore']], 'calde'), flag('poles', 'Paletti', true),
  ], build: lucine },
  { id: 'camino', label: 'Camino', cat: 'luci', sub: 'parete', color: '#cfc6b8', tags: 'camino caminetto fuoco fiamma legna salotto', noColor: true, params: [
    range('width', 'Larghezza', 1.0, 2.2, 0.05, 1.4), flag('lit', 'Acceso', true),
  ], build: camino },
];
// the fireplace keeps its flame geometry in sync with the light (onParam)
SOURCES.camino.onParam = 'lit';
SOURCES.camino.hideOff = [];
