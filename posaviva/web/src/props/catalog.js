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

export const CATEGORIES = [
  { id: 'arredo', label: 'Arredo' },
  { id: 'strutture', label: 'Strutture' },
  { id: 'mano', label: 'In mano' },
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
};

const range = (id, label, min, max, step, def, unit = 'm') => ({ id, type: 'range', label, min, max, step, default: def, unit });
const int = (id, label, min, max, def) => ({ id, type: 'int', label, min, max, step: 1, default: def, unit: '' });
const seg = (id, label, options, def) => ({ id, type: 'seg', label, options, default: def });
const flag = (id, label, def) => ({ id, type: 'toggle', label, default: def });

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

function divano(p) {
  const W = p.width, D = 0.9, LEG = 0.1, AW = 0.17, AH = 0.64, BH = 0.86, BASE = 0.22;
  const soft = [
    boxOn(W - 0.04, BASE, D - 0.04, { y: LEG, r: 0.03 }),
    boxOn(AW, AH - LEG, D, { x: W / 2 - AW / 2, y: LEG, r: 0.065 }),
    boxOn(AW, AH - LEG, D, { x: -W / 2 + AW / 2, y: LEG, r: 0.065 }),
    boxOn(W - 2 * AW + 0.04, BH - LEG, 0.2, { y: LEG, z: -D / 2 + 0.1, r: 0.06 }),
  ];
  const n = W >= 1.9 ? 3 : 2, cw = (W - 2 * AW) / n, top = LEG + BASE;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + AW + cw * (i + 0.5);
    soft.push(boxOn(cw - 0.012, 0.13, D - 0.22, { x, y: top, z: 0.1, r: 0.055 }));
    soft.push(box(cw - 0.014, 0.42, 0.16, { x, y: top + 0.13 + 0.2, z: -D / 2 + 0.29, rx: -11, r: 0.065 }));
  }
  const dark = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) dark.push(cylinder(0.022, 0.017, LEG, { x: sx * (W / 2 - 0.09), z: sz * (D / 2 - 0.09), bevel: 0.004, seg: 14 }));
  return { soft, dark };
}

function letto(p) {
  const W = p.width, L = 2.0, LEG = 0.1;
  const main = [
    boxOn(W + 0.08, 0.22, L + 0.08, { y: LEG, r: 0.016 }),
    boxOn(W + 0.08, 0.95, 0.07, { y: LEG * 0.5, z: -L / 2 - 0.075, r: 0.022 }),
  ];
  const dark = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) dark.push(boxOn(0.06, LEG, 0.06, { x: sx * (W / 2 - 0.02), z: sz * (L / 2 - 0.02), r: 0.006 }));
  const top = LEG + 0.2 + 0.22;
  const linen = [boxOn(W, 0.22, L, { y: LEG + 0.2, r: 0.06 })];
  const two = W >= 1.3, pw = two ? (W - 0.16) / 2 : Math.min(0.7, W - 0.2);
  for (const x of two ? [-(pw / 2 + 0.03), pw / 2 + 0.03] : [0]) linen.push(box(pw, 0.13, 0.4, { x, y: top + 0.05, z: -L / 2 + 0.27, rx: -8, r: 0.06 }));
  const blanket = [boxOn(W + 0.05, 0.07, L * 0.64, { y: top - 0.04, z: L / 2 - L * 0.32 + 0.025, r: 0.035 })];
  return { main, dark, linen, blanket };
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
  { id: 'sedia', label: 'Sedia', cat: 'arredo', color: '#8a5a3b', params: [], build: sedia },
  { id: 'sgabello', label: 'Sgabello alto', cat: 'arredo', color: '#c49a6c', params: [range('height', 'Altezza seduta', 0.5, 0.85, 0.01, 0.65)], build: sgabello },
  { id: 'panca', label: 'Panca', cat: 'arredo', color: '#8a5a3b', params: [range('length', 'Lunghezza', 0.6, 3, 0.05, 1.5)], build: panca },
  { id: 'tavolo', label: 'Tavolo', cat: 'arredo', color: '#c49a6c', resizable: true,
    params: [range('width', 'Larghezza', 0.5, 3, 0.05, 1.2), range('depth', 'Profondità', 0.4, 1.5, 0.05, 0.75), range('height', 'Altezza', 0.4, 1.1, 0.01, 0.75)], build: tavolo },
  { id: 'divano', label: 'Divano', cat: 'arredo', color: '#5d6b7a', params: [range('width', 'Larghezza', 1.4, 3, 0.05, 2.0)], build: divano },
  { id: 'letto', label: 'Letto', cat: 'arredo', color: '#8a5a3b', params: [range('width', 'Larghezza', 0.9, 2, 0.05, 1.6)], build: letto },

  { id: 'cubo', label: 'Cubo / cassa', cat: 'strutture', color: '#c49a6c', resizable: true,
    params: [seg('style', 'Stile', [{ value: 'liscio', label: 'Liscio' }, { value: 'cassa', label: 'Cassa' }], 'liscio'),
      range('width', 'Larghezza', 0.1, 3, 0.01, 0.5), range('depth', 'Profondità', 0.1, 3, 0.01, 0.5), range('height', 'Altezza', 0.1, 3, 0.01, 0.5)], build: cubo },
  { id: 'scala', label: 'Scala', cat: 'strutture', color: '#a9a49b',
    params: [int('steps', 'Gradini', 2, 10, 5), range('width', 'Larghezza', 0.5, 3, 0.05, 1.0), flag('railing', 'Corrimano', false)], build: scala },
  { id: 'muro', label: 'Muro', cat: 'strutture', color: '#d8d2c6', resizable: true,
    params: [seg('opening', 'Apertura', [{ value: 'none', label: 'Nessuna' }, { value: 'window', label: 'Finestra' }, { value: 'door', label: 'Porta' }], 'none'),
      range('offset', 'Posizione apertura', -1, 1, 0.01, 0, ''),
      range('length', 'Lunghezza', 0.5, 8, 0.05, 3), range('height', 'Altezza', 1, 4, 0.05, 2.6), range('thickness', 'Spessore', 0.06, 0.4, 0.01, 0.15)], build: muro },
  { id: 'pedana', label: 'Pedana', cat: 'strutture', color: '#6f6b78', resizable: true,
    params: [range('width', 'Larghezza', 0.3, 5, 0.05, 2.0), range('depth', 'Profondità', 0.3, 5, 0.05, 1.2), range('height', 'Altezza', 0.05, 1.5, 0.01, 0.2)], build: pedana },
  { id: 'colonna', label: 'Colonna', cat: 'strutture', color: '#cfc8bb', resizable: true,
    params: [seg('style', 'Stile', [{ value: 'cilindro', label: 'Cilindro' }, { value: 'classica', label: 'Classica' }], 'cilindro'),
      range('diameter', 'Diametro', 0.1, 1.5, 0.01, 0.4), range('height', 'Altezza', 0.2, 5, 0.05, 2.5)], build: colonna },
  { id: 'palla', label: 'Palla', cat: 'strutture', color: '#c0504d', params: [range('diameter', 'Diametro', 0.05, 1.2, 0.01, 0.22)], build: palla },

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

export const TYPE_BY_ID = new Map(PROP_TYPES.map((t) => [t.id, t]));

// ---------------------------------------------------------------------------- extension point
// Other modules (buildings, city, interiors…) add their own prop types and
// categories at runtime. A type follows the PROP_TYPES contract: {id, label, cat,
// color, params, build(params) -> {role: BufferGeometry[]}, resizable?, hand?};
// `sub` (optional) groups items inside a category, `tags` help the search.
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
    else if (p.type === 'toggle') o[p.id] = !!v;
    else if (p.type === 'seg' && p.options.some((x) => x.value === v)) o[p.id] = v;
  }
  return o;
}
