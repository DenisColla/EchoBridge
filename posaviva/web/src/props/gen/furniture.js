// Seating, beds and tables: sofas (2-4 seats, L / chaise longue, styles),
// armchairs, office chair, design chair, beds (single / double / upholstered /
// iron / bunk, made or unmade), desks with clutter, round tables, coffee
// tables, nightstands, classroom desk sets, teacher's desk.
import * as THREE from 'three';
import { add, box, boxOn, cylinder, lathe, rod, sphere, torus, tube, range, int, seg, flag, seed, rng, handle, knob, colorize, centerParts, merge } from './util.js';
import { BOOK_COLORS, screen } from '../textures.js';

// ------------------------------------------------------------------------------------------ sofas
export function divano(p) {
  const W = p.width, D = 0.92, style = p.style || 'moderno', r = rng(p.seed || 1);
  const parts = {};
  const LEG = style === 'retro' ? 0.18 : 0.1, AW = style === 'squadrato' ? 0.2 : style === 'retro' ? 0.1 : 0.17;
  const AH = style === 'squadrato' ? 0.78 : style === 'retro' ? 0.62 : 0.64;
  const BH = style === 'retro' ? 0.84 : 0.86, BASE = style === 'retro' ? 0.16 : 0.22, rad = style === 'squadrato' ? 0.025 : 0.065;
  const chaise = p.shape === 'Ldx' ? 1 : p.shape === 'Lsx' ? -1 : 0, CD = 0.72;
  add(parts, 'soft', boxOn(W - 0.04, BASE, D - 0.04, { y: LEG, r: 0.03 }));
  for (const s of [-1, 1]) add(parts, 'soft', boxOn(AW, AH - LEG, D + (chaise === s ? CD : 0), { x: s * (W / 2 - AW / 2), y: LEG, z: chaise === s ? CD / 2 : 0, r: rad }));
  add(parts, 'soft', boxOn(W - 2 * AW + 0.04, BH - LEG, 0.2, { y: LEG, z: -D / 2 + 0.1, r: Math.min(rad, 0.06) }));
  if (chaise) add(parts, 'soft', boxOn((W - 2 * AW) / Math.max(2, Math.round((W - 2 * AW) / 0.62)) + AW, BASE, CD, { x: chaise * (W / 2 - ((W - 2 * AW) / Math.max(2, Math.round((W - 2 * AW) / 0.62)) + AW) / 2), y: LEG, z: D / 2 + CD / 2 - 0.02, r: 0.03 }));
  const n = Math.max(1, Math.round((W - 2 * AW) / 0.62)), cw = (W - 2 * AW) / n, top = LEG + BASE;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + AW + cw * (i + 0.5);
    const isChaise = chaise && (chaise > 0 ? i === n - 1 : i === 0);
    const sd = D - 0.22 + (isChaise ? CD : 0);
    add(parts, 'soft', boxOn(cw - 0.012, 0.13, sd, { x, y: top, z: 0.1 + (isChaise ? CD / 2 : 0), r: 0.055 }));
    if (style === 'squadrato') add(parts, 'soft', box(cw - 0.014, 0.4, 0.17, { x, y: top + 0.13 + 0.2, z: -D / 2 + 0.29, rx: -6, r: 0.03 }));
    else add(parts, 'soft', box(cw - 0.014, 0.42, 0.16, { x, y: top + 0.13 + 0.2, z: -D / 2 + 0.29, rx: -11, r: 0.065 }));
    if (style === 'retro') for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) add(parts, 'mainShade', sphere(0.012, { x: x + (j - 0.5) * cw * 0.45, y: top + 0.25 + k * 0.17, z: -D / 2 + 0.38 - k * 0.035, ws: 8, hs: 6 }));
  }
  // legs
  const legRole = style === 'retro' ? 'wood' : 'dark';
  const fz = D / 2 - 0.09 + (0), lx = W / 2 - 0.09;
  const legPts = [[-lx, fz], [lx, fz], [-lx, -D / 2 + 0.09], [lx, -D / 2 + 0.09]];
  if (chaise) legPts.push([chaise * lx, D / 2 + CD - 0.11]);
  for (const [x, z] of legPts) {
    if (style === 'retro') add(parts, legRole, rod([x * 0.98, 0, z * 0.95], [x, LEG, z], 0.016, { r2: 0.011, seg: 10 }));
    else add(parts, legRole, cylinder(0.022, 0.017, LEG, { x, z, bevel: 0.004, seg: 14 }));
  }
  // throw pillows
  if (p.pillows) {
    const cols = ['#c9a227', '#7a1f24', '#e8e4dc', '#2f4a6b', '#4f6b3a', '#c0504d', '#d9cbb3'];
    for (const s of [-1, 1]) {
      const c = r.pick(cols);
      add(parts, 'cushions', colorize(box(0.42, 0.4, 0.13, { x: s * (W / 2 - AW - 0.24), y: top + 0.35, z: -D / 2 + 0.36, rx: -14, rz: s * r.range(4, 12), ry: s * -8, r: 0.06 }), c));
    }
  }
  return parts;
}

function poltrona(p) {
  const parts = {};
  if (p.style === 'classica') {
    const W = 0.78, D = 0.78, SH = 0.44;
    add(parts, 'soft', boxOn(W - 0.14, 0.12, D - 0.16, { y: SH - 0.12, z: 0.03, r: 0.045 }), box(W - 0.16, 0.6, 0.12, { y: SH + 0.33, z: -D / 2 + 0.1, rx: -10, r: 0.05 }));
    for (const s of [-1, 1]) {
      add(parts, 'soft', boxOn(0.09, 0.2, D - 0.22, { x: s * (W / 2 - 0.08), y: SH - 0.02, z: 0.0, r: 0.04 }));
      add(parts, 'wood', rod([s * (W / 2 - 0.06), 0, D / 2 - 0.08], [s * (W / 2 - 0.07), SH + 0.2, D / 2 - 0.1], 0.022, { seg: 10 }),
        rod([s * (W / 2 - 0.06), 0, -D / 2 + 0.1], [s * (W / 2 - 0.09), SH + 0.65, -D / 2 + 0.02], 0.022, { seg: 10 }),
        rod([s * (W / 2 - 0.07), SH + 0.2, D / 2 - 0.1], [s * (W / 2 - 0.08), SH + 0.22, -D / 2 + 0.06], 0.02, { seg: 10 }));
    }
    add(parts, 'wood', boxOn(W - 0.1, 0.06, D - 0.12, { y: SH - 0.18, r: 0.015 }), rod([-(W / 2 - 0.09), SH + 0.65, -D / 2 + 0.02], [W / 2 - 0.09, SH + 0.65, -D / 2 + 0.02], 0.02, { seg: 10 }));
    return parts;
  }
  if (p.style === 'club') {
    const W = 0.9, D = 0.88;
    add(parts, 'soft', boxOn(W, 0.36, D, { y: 0.06, r: 0.06 }));
    for (const s of [-1, 1]) add(parts, 'soft', boxOn(0.18, 0.5, D - 0.05, { x: s * (W / 2 - 0.1), y: 0.06, r: 0.08 }));
    add(parts, 'soft', boxOn(W - 0.08, 0.76, 0.2, { y: 0.06, z: -D / 2 + 0.11, r: 0.09 }), boxOn(W - 0.36, 0.12, D - 0.3, { y: 0.42, z: 0.08, r: 0.05 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(parts, 'dark', cylinder(0.025, 0.02, 0.06, { x: sx * (W / 2 - 0.08), z: sz * (D / 2 - 0.08), seg: 12 }));
    return parts;
  }
  // moderna: slim arms on a metal frame
  const W = 0.76, D = 0.8;
  add(parts, 'soft', boxOn(W - 0.12, 0.14, D - 0.12, { y: 0.3, z: 0.04, r: 0.05 }), box(W - 0.12, 0.5, 0.14, { y: 0.66, z: -D / 2 + 0.12, rx: -12, r: 0.06 }));
  for (const s of [-1, 1]) add(parts, 'soft', boxOn(0.08, 0.3, D - 0.06, { x: s * (W / 2 - 0.04), y: 0.3, r: 0.035 }));
  for (const s of [-1, 1]) add(parts, 'darkMetal', rod([s * (W / 2 - 0.04), 0, D / 2 - 0.06], [s * (W / 2 - 0.04), 0.3, D / 2 - 0.08], 0.01), rod([s * (W / 2 - 0.04), 0, -D / 2 + 0.06], [s * (W / 2 - 0.04), 0.3, -D / 2 + 0.08], 0.01), rod([s * (W / 2 - 0.04), 0.005, D / 2 - 0.06], [s * (W / 2 - 0.04), 0.005, -D / 2 + 0.06], 0.01));
  add(parts, 'darkMetal', boxOn(W - 0.1, 0.03, D - 0.14, { y: 0.27 }));
  return parts;
}

function sediaUfficio(p) {
  const SH = p.height, parts = {};
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    add(parts, 'black', rod([0, 0.075, 0], [c * 0.31, 0.06, s * 0.31], 0.018, { r2: 0.024, seg: 8 }));
    add(parts, 'black', sphere(0.026, { x: c * 0.31, y: 0.027, z: s * 0.31, ws: 10, hs: 8 }), torus(0.022, 0.009, { x: c * 0.31, y: 0.027, z: s * 0.31, ry: -a * 57.3, rs: 6, ts: 12 }));
  }
  add(parts, 'chrome', cylinder(0.025, 0.025, SH - 0.17, { y: 0.07, seg: 14 }));
  add(parts, 'black', cylinder(0.04, 0.035, 0.08, { y: 0.06, seg: 14 }), boxOn(0.24, 0.04, 0.24, { y: SH - 0.12, r: 0.01 }));
  add(parts, 'soft', boxOn(0.48, 0.08, 0.46, { y: SH - 0.08, r: 0.035 }));
  // back on a curved spine
  add(parts, 'black', tube([[0, SH - 0.08, -0.16], [0, SH - 0.06, -0.26], [0, SH + 0.1, -0.29]], 0.022, { segs: 12, rs: 8 }));
  add(parts, 'soft', box(0.44, 0.52, 0.07, { y: SH + 0.36, z: -0.28, rx: -8, r: 0.03 }));
  if (p.headrest) add(parts, 'soft', box(0.26, 0.14, 0.06, { y: SH + 0.72, z: -0.33, rx: -10, r: 0.025 }), rod([0, SH + 0.6, -0.32], [0, SH + 0.66, -0.335], 0.012));
  if (p.arms) for (const s of [-1, 1]) add(parts, 'black', tube([[s * 0.2, SH - 0.07, -0.08], [s * 0.27, SH + 0.06, -0.06], [s * 0.26, SH + 0.2, -0.02]], 0.015, { segs: 10, rs: 6 }), box(0.07, 0.03, 0.24, { x: s * 0.26, y: SH + 0.215, z: 0.0, r: 0.012 }));
  return parts;
}

function sediaDesign(p) {
  const parts = {}, SH = 0.45;
  // moulded shell: lathe profile squashed into an oval bucket
  const shellGeo = lathe([[0.0, 0], [0.2, 0.0], [0.235, 0.03], [0.245, 0.16], [0.25, 0.4], [0.24, 0.42], [0.225, 0.4], [0.215, 0.18], [0.195, 0.035], [0, 0.025]], { seg: 32 });
  // open the front: keep it as a bucket, scaled
  shellGeo.scale(1, 1, 0.95);
  const pos = shellGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), z = pos.getZ(i);
    if (z > 0 && y > 0.05) pos.setY(i, 0.05 + (y - 0.05) * Math.max(0.1, 1 - z / 0.25)); // low front, high back
  }
  shellGeo.computeVertexNormals();
  shellGeo.translate(0, SH - 0.03, 0);
  add(parts, 'main', shellGeo);
  const legRole = p.legs === 'metallo' ? 'darkMetal' : 'woodLight';
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(parts, legRole, rod([sx * 0.07, SH - 0.02, sz * 0.07], [sx * 0.22, 0, sz * 0.21], 0.014, { r2: 0.011, seg: 10 }));
  if (p.legs !== 'metallo') add(parts, 'darkMetal', rod([-0.15, 0.17, -0.14], [0.15, 0.17, 0.14], 0.004, { seg: 6 }), rod([0.15, 0.17, -0.14], [-0.15, 0.17, 0.14], 0.004, { seg: 6 }));
  return parts;
}

// ------------------------------------------------------------------------------------------ beds
/** Blanket draped over a mattress (top at y, width w, length l, head end at -l/2), messy 0..1. */
function drapedBlanket(w, l, y, hang, r, messy, fold) {
  const nx = 36, nz = 40;
  const geo = new THREE.PlaneGeometry(1, 1, nx, nz);
  const pos = geo.attributes.position;
  const total = w + 2 * hang, len = l * (1 - fold) + hang;
  const z0 = -l / 2 + l * fold;
  const rc = 0.035;
  const ph = [r() * 6, r() * 6, r() * 6, r() * 6];
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5, v = 0.5 - pos.getY(i); // v: 0 head .. 1 foot
    let x = (u - 0.5) * total, along = v * len, yy = y;
    let z = z0 + along;
    // fall over the sides
    const over = Math.abs(x) - w / 2;
    if (over > 0) {
      const s = Math.sign(x);
      if (over < (Math.PI / 2) * rc) { const a = over / rc; x = s * (w / 2 + Math.sin(a) * rc); yy = y - rc + Math.cos(a) * rc; }
      else { x = s * (w / 2 + rc); yy = y - rc - (over - (Math.PI / 2) * rc); }
    }
    // fall over the foot
    const overZ = z - l / 2;
    if (overZ > 0) {
      if (overZ < (Math.PI / 2) * rc) { const a = overZ / rc; z = l / 2 + Math.sin(a) * rc; yy = Math.min(yy, y - rc + Math.cos(a) * rc); }
      else { z = l / 2 + rc; yy = Math.min(yy, y - rc - (overZ - (Math.PI / 2) * rc)); }
    }
    // wrinkles
    const top = over <= 0 && overZ <= 0;
    if (messy > 0) {
      const amp = messy * (top ? 0.045 : 0.02);
      const wv = Math.sin(x * 9 + ph[0] + z * 3) * 0.5 + Math.sin(z * 6.5 + ph[1]) * 0.35 + Math.sin((x + z) * 15 + ph[2]) * 0.15;
      // on the mattress the folds only rise (never sink into it)
      yy += top ? amp * 1.3 * (wv + 1) * 0.5 : amp * wv;
      if (top) yy += messy * 0.05 * Math.max(0, Math.sin(((z - z0) / len) * Math.PI * 2.2 + ph[3])) * (1 - Math.abs(x) / (w / 2)) ;
    } else if (top) yy += 0.004 * Math.sin(x * 20) * Math.sin(z * 4);
    pos.setXYZ(i, x, yy + 0.012, z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function letto(p) {
  const kind = p.model || 'moderno', r = rng(p.seed || 1);
  if (kind === 'castello') return bunk(p, r);
  if (kind === 'futon') return futon(p, r);
  const W = p.width, L = 2.0, LEG = kind === 'ferro' ? 0.3 : 0.1, parts = {};
  if (kind === 'baldacchino') {
    // four-poster: turned posts, top frame, fabric valance and tied curtains
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(parts, 'wood', lathe([[0, 0], [0.045, 0], [0.04, 0.05], [0.03, 0.3], [0.04, 0.5], [0.028, 0.7], [0.025, 2.0], [0.035, 2.05], [0, 2.1]], { x: sx * (W / 2 + 0.06), z: sz * (L / 2 + 0.06), seg: 14 }));
    for (const s of [-1, 1]) add(parts, 'wood', box(0.05, 0.06, L + 0.12, { x: s * (W / 2 + 0.06), y: 2.03 }), box(W + 0.12, 0.06, 0.05, { y: 2.03, z: s * (L / 2 + 0.06) }));
    for (const s of [-1, 1]) add(parts, 'curtainBed', box(0.012, 0.25, L + 0.16, { x: s * (W / 2 + 0.08), y: 1.92, r: 0.004 }), box(W + 0.16, 0.25, 0.012, { y: 1.92, z: s * (L / 2 + 0.08), r: 0.004 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(parts, 'curtainBed', lathe([[0, 1.8], [0.09, 1.78], [0.06, 1.3], [0.035, 1.1], [0.07, 0.8], [0.1, 0.1], [0, 0.08]], { x: sx * (W / 2 + 0.1), z: sz * (L / 2 + 0.1), seg: 10 }));
  }
  const frameRole = kind === 'imbottito' ? 'soft' : kind === 'ferro' ? 'darkMetal' : kind === 'baldacchino' ? 'wood' : 'main';
  const MT = kind === 'ferro' ? LEG + 0.12 : LEG + 0.2; // mattress bottom
  if (kind === 'ferro') {
    for (const [z, h] of [[-L / 2 - 0.03, 1.05], [L / 2 + 0.03, 0.75]]) {
      for (const s of [-1, 1]) add(parts, frameRole, rod([s * (W / 2 + 0.02), 0, z], [s * (W / 2 + 0.02), h, z], 0.018, { seg: 10 }), sphere(0.026, { x: s * (W / 2 + 0.02), y: h + 0.01, z, ws: 12, hs: 8 }));
      add(parts, frameRole, rod([-(W / 2 + 0.02), h - 0.04, z], [W / 2 + 0.02, h - 0.04, z], 0.014), rod([-(W / 2 + 0.02), MT + 0.05, z], [W / 2 + 0.02, MT + 0.05, z], 0.014));
      const n = Math.max(4, Math.round(W / 0.12));
      for (let i = 1; i < n; i++) add(parts, frameRole, rod([-(W / 2) + (i * W) / n, MT + 0.05, z], [-(W / 2) + (i * W) / n, h - 0.04, z], 0.007, { seg: 6 }));
    }
    for (const s of [-1, 1]) add(parts, frameRole, box(0.03, 0.06, L + 0.06, { x: s * (W / 2 + 0.02), y: MT - 0.02 }));
  } else {
    add(parts, frameRole, boxOn(W + 0.08, 0.22, L + 0.08, { y: LEG, r: kind === 'imbottito' ? 0.04 : 0.016 }));
    if (kind === 'imbottito') {
      add(parts, frameRole, boxOn(W + 0.14, 1.15, 0.12, { y: LEG * 0.5, z: -L / 2 - 0.09, r: 0.05 }));
      const nx = Math.max(3, Math.round(W / 0.22));
      for (let i = 0; i < nx; i++) for (let k = 0; k < 3; k++) add(parts, 'mainShade', sphere(0.011, { x: -W / 2 + ((i + 0.5 + (k % 2) * 0.5) * (W)) / (nx + 0.5), y: 0.72 + k * 0.16, z: -L / 2 - 0.03, ws: 8, hs: 6 }));
    } else add(parts, frameRole, boxOn(W + 0.08, 0.95, 0.07, { y: LEG * 0.5, z: -L / 2 - 0.075, r: 0.022 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(parts, 'dark', boxOn(0.06, LEG, 0.06, { x: sx * (W / 2 - 0.02), z: sz * (L / 2 - 0.02), r: 0.006 }));
  }
  const top = MT + 0.22;
  add(parts, 'linen', boxOn(W, 0.22, L, { y: MT, r: 0.06 }));
  const two = W >= 1.3, pw = two ? (W - 0.16) / 2 : Math.min(0.7, W - 0.2);
  for (const x of two ? [-(pw / 2 + 0.03), pw / 2 + 0.03] : [0]) add(parts, 'linen', box(pw, 0.13, 0.4, { x: x + r.range(-0.02, 0.02), y: top + 0.05, z: -L / 2 + 0.27, rx: -8, ry: r.range(-4, 4), r: 0.06 }));
  const made = p.made !== false;
  add(parts, 'blanketD', drapedBlanket(W, L, top, made ? 0.26 : 0.18, r, made ? 0 : 0.8 + r() * 0.2, made ? 0.3 : r.range(0.3, 0.45)));
  return parts;
}

function futon(p, r) {
  const W = p.width, L = 2.0, parts = {};
  add(parts, 'woodLight', boxOn(W + 0.3, 0.03, L + 0.3, { r: 0.006 }));
  add(parts, 'linen', boxOn(W, 0.14, L, { y: 0.03, r: 0.05 }));
  const two = W >= 1.3, pw = two ? (W - 0.16) / 2 : Math.min(0.7, W - 0.2);
  for (const x of two ? [-(pw / 2 + 0.03), pw / 2 + 0.03] : [0]) add(parts, 'linen', box(pw, 0.11, 0.38, { x, y: 0.22, z: -L / 2 + 0.25, rx: -6, r: 0.05 }));
  add(parts, 'blanketD', drapedBlanket(W, L, 0.17, 0.12, r, p.made === false ? 0.8 : 0, 0.3));
  return parts;
}

function culla(p) {
  const parts = {}, W = 0.66, L = 1.26, H = 0.95, base = 0.35;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(parts, 'main', boxOn(0.045, H, 0.045, { x: sx * (W / 2), z: sz * (L / 2), r: 0.008 }));
  for (const s of [-1, 1]) {
    add(parts, 'main', box(0.03, 0.05, L, { x: s * W / 2, y: H - 0.06, r: 0.006 }), box(0.03, 0.05, L, { x: s * W / 2, y: base, r: 0.006 }));
    add(parts, 'main', boxOn(W, 0.5, 0.025, { y: base, z: s * L / 2, r: 0.006 }));
    for (let i = 1; i < 14; i++) add(parts, 'main', rod([s * W / 2, base, -L / 2 + (i * L) / 14], [s * W / 2, H - 0.06, -L / 2 + (i * L) / 14], 0.009, { seg: 8 }));
  }
  add(parts, 'linen', boxOn(W - 0.04, 0.1, L - 0.04, { y: base, r: 0.03 }));
  add(parts, 'blanketD', drapedBlanket(W - 0.06, L - 0.06, base + 0.1, 0.05, rng(3), 0.4, 0.45));
  if (p.toy) { add(parts, 'cushions', colorize(sphere(0.07, { x: 0.12, y: base + 0.17, z: -0.35, ws: 12, hs: 10 }), '#c9a227'), colorize(sphere(0.045, { x: 0.12, y: base + 0.27, z: -0.35, ws: 12, hs: 10 }), '#c9a227')); }
  return parts;
}

function bunk(p, r) {
  const W = Math.min(1.0, p.width), L = 2.0, parts = {};
  const levels = [0.2, 1.4];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(parts, 'main', boxOn(0.06, 1.95, 0.06, { x: sx * (W / 2 + 0.03), z: sz * (L / 2 + 0.03), r: 0.008 }));
  for (const y of levels) {
    for (const s of [-1, 1]) add(parts, 'main', box(0.04, 0.12, L + 0.06, { x: s * (W / 2 + 0.03), y: y + 0.06, r: 0.006 }), box(W + 0.06, 0.12, 0.04, { y: y + 0.06, z: s * (L / 2 + 0.03), r: 0.006 }));
    add(parts, 'linen', boxOn(W, 0.16, L, { y: y + 0.04, r: 0.05 }));
    add(parts, 'linen', box(Math.min(0.62, W - 0.2), 0.11, 0.36, { y: y + 0.27, z: -L / 2 + 0.25, rx: -8, r: 0.05 }));
    add(parts, 'blanketD', drapedBlanket(W, L, y + 0.2, 0.12, r, p.made === false ? 0.7 : 0, 0.3));
  }
  // guard rail + ladder
  add(parts, 'main', box(0.04, 0.05, L * 0.7, { x: -(W / 2 + 0.03), y: levels[1] + 0.4, z: -L * 0.15, r: 0.006 }), boxOn(0.04, 0.3, 0.04, { x: -(W / 2 + 0.03), y: levels[1] + 0.12, z: L * 0.2 }));
  for (const s of [-1, 1]) add(parts, 'main', boxOn(0.04, 1.6, 0.05, { x: W / 2 + 0.07, z: L / 2 - 0.25 + s * 0.2 }));
  for (let k = 1; k <= 4; k++) add(parts, 'metal', rod([W / 2 + 0.07, k * 0.33, L / 2 - 0.45], [W / 2 + 0.07, k * 0.33, L / 2 - 0.05], 0.012, { seg: 8 }));
  return parts;
}

// ------------------------------------------------------------------------------------------ tables
function clutter(parts, r, x0, x1, z0, z1, y, amount, pc) {
  const W = x1 - x0, cx = (x0 + x1) / 2;
  let used = [];
  const free = (x, w) => used.every(([a, b]) => x + w / 2 < a || x - w / 2 > b);
  const take = (x, w) => used.push([x - w / 2, x + w / 2]);
  if (pc === 'monitor') {
    const mw = 0.56, mh = 0.33;
    add(parts, 'black', boxOn(0.2, 0.012, 0.16, { x: cx, y, z: z0 + 0.12, r: 0.004 }), boxOn(0.04, 0.2, 0.025, { x: cx, y, z: z0 + 0.1 }), box(mw, mh, 0.025, { x: cx, y: y + 0.12 + mh / 2, z: z0 + 0.12, rx: -4, r: 0.006 }));
    add(parts, 'screenOn', box(mw - 0.02, mh - 0.02, 0.002, { x: cx, y: y + 0.12 + mh / 2, z: z0 + 0.134, rx: -4 }));
    add(parts, 'black', boxOn(0.44, 0.02, 0.14, { x: cx, y, z: z1 - 0.18, r: 0.005 }));
    add(parts, 'plastic', boxOn(0.42, 0.006, 0.12, { x: cx, y: y + 0.018, z: z1 - 0.18, r: 0.002 }));
    add(parts, 'black', sphere(0.03, { ws: 12, hs: 8 }).scale(1, 0.45, 1.5).translate(cx + 0.33, y + 0.012, z1 - 0.18));
    take(cx, 0.8);
  } else if (pc === 'laptop') {
    const lw = 0.34, ld = 0.24;
    add(parts, 'metal', boxOn(lw, 0.016, ld, { x: cx, y, z: (z0 + z1) / 2 + 0.05, r: 0.006 }), box(lw, ld, 0.008, { x: cx, y: y + 0.016 + (ld / 2) * Math.cos(0.3), z: (z0 + z1) / 2 + 0.05 - ld / 2 - (ld / 2) * Math.sin(0.3), rx: -17, r: 0.004 }));
    add(parts, 'screenOn', box(lw - 0.03, ld - 0.03, 0.002, { x: cx, y: y + 0.016 + (ld / 2) * Math.cos(0.3), z: (z0 + z1) / 2 + 0.05 - ld / 2 - (ld / 2) * Math.sin(0.3) + 0.005, rx: -17 }));
    add(parts, 'black', boxOn(lw - 0.04, 0.002, ld * 0.45, { x: cx, y: y + 0.016, z: (z0 + z1) / 2 + 0.03 }));
    take(cx, 0.4);
  }
  const items = Math.round(amount * 9);
  for (let k = 0; k < items; k++) {
    const kind = r.int(0, 7), w = 0.2;
    let x = 0, tries = 0;
    do { x = r.range(x0 + 0.12, x1 - 0.12); tries++; } while (!free(x, w) && tries < 12);
    if (tries >= 12) continue;
    take(x, w);
    const z = r.range(z0 + 0.12, z1 - 0.1);
    if (kind === 0) add(parts, 'mug', lathe([[0, 0], [0.038, 0], [0.04, 0.005], [0.04, 0.095], [0.036, 0.095], [0.036, 0.01], [0, 0.01]], { x, y, z, seg: 18 }), torus(0.025, 0.006, { arc: Math.PI, rz: -90, x: x + 0.037, y: y + 0.05, z, rs: 6, ts: 12 }));
    else if (kind === 1) for (let i = 0; i < r.int(2, 5); i++) add(parts, 'paper', boxOn(0.21, 0.002, 0.297, { x: x + r.range(-0.03, 0.03), y: y + i * 0.002, z, ry: r.range(-25, 25) }));
    else if (kind === 2) { let yy = y; for (let i = 0; i < r.int(2, 4); i++) { const t = r.range(0.025, 0.045); add(parts, 'books', colorize(box(r.range(0.15, 0.22), t, r.range(0.2, 0.26), { x, y: yy + t / 2, z, ry: r.range(-15, 15), r: 0.003, seg: 1 }), r.pick(BOOK_COLORS))); yy += t; } }
    else if (kind === 3) { add(parts, 'black', cylinder(0.035, 0.035, 0.1, { x, y, z, seg: 14 })); for (let i = 0; i < 4; i++) add(parts, 'books', colorize(rod([x + r.range(-0.015, 0.015), y + 0.02, z + r.range(-0.015, 0.015)], [x + r.range(-0.04, 0.04), y + 0.16, z + r.range(-0.04, 0.04)], 0.004, { seg: 6 }), r.pick(BOOK_COLORS))); }
    else if (kind === 4) { add(parts, 'pot', cylinder(0.05, 0.06, 0.09, { x, y, z, seg: 16 })); add(parts, 'leaf', sphere(0.08, { x, y: y + 0.14, z, ws: 10, hs: 8 })); }
    else if (kind === 5) add(parts, 'black', boxOn(0.075, 0.009, 0.155, { x, y, z, ry: r.range(-30, 30), r: 0.004 }));
    else if (kind === 6) { add(parts, 'darkMetal', cylinder(0.07, 0.075, 0.02, { x, y, z, seg: 18 }), rod([x, y + 0.02, z], [x + 0.05, y + 0.3, z - 0.08], 0.008), rod([x + 0.05, y + 0.3, z - 0.08], [x + 0.02, y + 0.42, z + 0.08], 0.008)); add(parts, 'darkMetal', lathe([[0.0, 0], [0.025, 0], [0.07, -0.09], [0.068, -0.095], [0, -0.04]], { x: x + 0.02, y: y + 0.45, z: z + 0.1, rx: 30, seg: 18 })); }
    else add(parts, 'paper', boxOn(0.3, 0.012, 0.22, { x, y, z, ry: r.range(-20, 20), r: 0.003 }));
  }
}

function scrivania(p) {
  const W = p.width, D = p.depth, H = 0.75, r = rng(p.seed), parts = {};
  if (p.style === 'legno') {
    add(parts, 'main', boxOn(W, 0.035, D, { y: H - 0.035, r: 0.008 }));
    add(parts, 'main', boxOn(0.03, H - 0.035, D - 0.06, { x: -W / 2 + 0.05 }));
    // drawer pedestal on the right
    add(parts, 'main', boxOn(0.42, H - 0.035, D - 0.06, { x: W / 2 - 0.23, r: 0.004 }));
    for (let i = 0; i < 3; i++) { add(parts, 'mainShade', boxOn(0.4, 0.21, 0.015, { x: W / 2 - 0.23, y: 0.03 + i * 0.23, z: (D - 0.06) / 2, r: 0.003 })); handle(parts, W / 2 - 0.23, 0.2 + i * 0.23, (D - 0.06) / 2 + 0.012, 0.12); }
    add(parts, 'mainShade', boxOn(W - 0.52, 0.3, 0.015, { x: -0.21, y: H - 0.33, z: -D / 2 + 0.05 }));
  } else {
    add(parts, 'main', boxOn(W, 0.03, D, { y: H - 0.03, r: 0.006 }));
    for (const s of [-1, 1]) {
      add(parts, 'darkMetal', boxOn(0.05, H - 0.03, 0.05, { x: s * (W / 2 - 0.06), z: D / 2 - 0.07 }), boxOn(0.05, H - 0.03, 0.05, { x: s * (W / 2 - 0.06), z: -D / 2 + 0.07 }));
      add(parts, 'darkMetal', box(0.04, 0.04, D - 0.14, { x: s * (W / 2 - 0.06), y: H - 0.06 }));
    }
    add(parts, 'darkMetal', box(W - 0.16, 0.06, 0.02, { y: H - 0.07, z: -D / 2 + 0.07 }));
  }
  clutter(parts, r, -W / 2, W / 2, -D / 2, D / 2, H, p.clutter, p.pc);
  return parts;
}

function tavoloRotondo(p) {
  const R = p.diameter / 2, H = p.height, parts = {};
  add(parts, 'main', cylinder(R, R, 0.035, { y: H - 0.035, bevel: 0.01, seg: 56 }));
  if (p.base === 'centrale') {
    add(parts, 'main', cylinder(0.05, 0.05, H - 0.035, { seg: 20 }), lathe([[0, 0], [R * 0.55, 0], [R * 0.5, 0.03], [0.07, 0.08], [0.05, 0.1], [0, 0.1]], { seg: 40 }));
  } else {
    const lx = R * 0.62;
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + (k * Math.PI) / 2; add(parts, 'main', boxOn(0.05, H - 0.035, 0.05, { x: Math.cos(a) * lx, z: Math.sin(a) * lx, r: 0.006 })); }
    add(parts, 'main', torus(lx * 0.97, 0.02, { rx: 90, y: H - 0.08, rs: 6, ts: 40 }));
  }
  if (p.cloth) add(parts, 'linen', lathe([[0, H + 0.002], [R + 0.01, H + 0.002], [R + 0.03, H - 0.03], [R + 0.05, H - 0.28], [R + 0.04, H - 0.285], [R + 0.02, H - 0.03], [0, H - 0.01]], { seg: 48 }));
  return parts;
}

function tavolino(p) {
  const parts = {}, W = p.width, D = p.style === 'tondo' ? W : W * 0.55, H = 0.42;
  if (p.style === 'vetro') {
    add(parts, 'glass', boxOn(W, 0.012, D, { y: H - 0.012, r: 0.004 }));
    for (const s of [-1, 1]) add(parts, 'chrome', rod([s * (W / 2 - 0.05), 0, D / 2 - 0.05], [s * (W / 2 - 0.05), H - 0.012, D / 2 - 0.05], 0.012), rod([s * (W / 2 - 0.05), 0, -D / 2 + 0.05], [s * (W / 2 - 0.05), H - 0.012, -D / 2 + 0.05], 0.012));
    add(parts, 'main', boxOn(W - 0.14, 0.02, D - 0.14, { y: 0.12, r: 0.004 }));
  } else if (p.style === 'tondo') {
    add(parts, 'main', cylinder(W / 2, W / 2, 0.04, { y: H - 0.04, bevel: 0.012, seg: 48 }));
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; add(parts, 'woodDark', rod([Math.cos(a) * W * 0.22, H - 0.04, Math.sin(a) * W * 0.22], [Math.cos(a) * W * 0.32, 0, Math.sin(a) * W * 0.32], 0.016, { r2: 0.011 })); }
  } else {
    add(parts, 'main', boxOn(W, 0.05, D, { y: H - 0.05, r: 0.01 }), boxOn(W - 0.06, 0.03, D - 0.06, { y: 0.1, r: 0.005 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(parts, 'main', boxOn(0.05, H - 0.05, 0.05, { x: sx * (W / 2 - 0.04), z: sz * (D / 2 - 0.04), r: 0.006 }));
  }
  if (p.decor) {
    const r = rng(p.seed || 2);
    const n = r.int(2, 3);
    for (let i = 0; i < n; i++) {
      let yy = H; const x = (i - (n - 1) / 2) * W * 0.28;
      if (i === 0) for (let k = 0; k < 3; k++) { const t = 0.03; add(parts, 'books', colorize(box(0.24, t, 0.3, { x, y: yy + t / 2, ry: r.range(-15, 15), r: 0.003, seg: 1 }), r.pick(BOOK_COLORS))); yy += t; }
      else if (i === 1) add(parts, 'ceramic', lathe([[0, 0], [0.09, 0], [0.12, 0.05], [0.13, 0.07], [0, 0.04]], { x, y: H, seg: 28 }));
      else { add(parts, 'pot', cylinder(0.05, 0.06, 0.1, { x, y: H, seg: 16 })); add(parts, 'leaf', sphere(0.09, { x, y: H + 0.16, ws: 10, hs: 8 })); }
    }
  }
  return parts;
}

function comodino(p) {
  const parts = {}, W = 0.48, D = 0.4, H = 0.55;
  add(parts, 'main', boxOn(W, H - 0.12, D, { y: 0.12, r: 0.006 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(parts, 'main', rod([sx * (W / 2 - 0.05), 0, sz * (D / 2 - 0.05)], [sx * (W / 2 - 0.06), 0.12, sz * (D / 2 - 0.06)], 0.014, { r2: 0.018, seg: 10 }));
  for (let i = 0; i < p.drawers; i++) {
    const h = (H - 0.14) / p.drawers;
    add(parts, 'mainShade', boxOn(W - 0.03, h - 0.012, 0.015, { y: 0.13 + i * h, z: D / 2, r: 0.003 }));
    knob(parts, 0, 0.13 + i * h + h / 2, D / 2 + 0.012, 'gold');
  }
  if (p.lamp) {
    add(parts, 'ceramic', lathe([[0, 0], [0.06, 0], [0.075, 0.06], [0.06, 0.16], [0.02, 0.2], [0.015, 0.25], [0, 0.25]], { x: -0.08, y: H, z: -0.03, seg: 20 }));
    add(parts, 'shade', lathe([[0.15, 0.25], [0.1, 0.43]], { x: -0.08, y: H, z: -0.03, seg: 28 }));
  }
  return parts;
}

function banchiAula(p) {
  const parts = {}, dx = 1.3, dz = 1.2;
  for (let i = 0; i < p.rows; i++) for (let j = 0; j < p.cols; j++) {
    const x = (j - (p.cols - 1) / 2) * dx, z = (i - (p.rows - 1) / 2) * dz;
    // desk (two pupils) + two chairs
    add(parts, 'woodLight', boxOn(1.2, 0.025, 0.5, { x, y: 0.72, z, r: 0.005 }));
    for (const s of [-1, 1]) add(parts, 'darkMetal', boxOn(0.03, 0.72, 0.42, { x: x + s * 0.56, z }), box(0.03, 0.03, 0.42, { x: x + s * 0.56, y: 0.1, z }));
    add(parts, 'darkMetal', box(1.1, 0.25, 0.01, { x, y: 0.55, z: z - 0.22 }));
    for (const s of [-1, 1]) {
      const cx = x + s * 0.3, cz = z + 0.45;
      add(parts, 'main', boxOn(0.4, 0.02, 0.38, { x: cx, y: 0.43, z: cz, r: 0.006 }), box(0.38, 0.2, 0.02, { x: cx, y: 0.7, z: cz + 0.19, rx: 8, r: 0.006 }));
      for (const sx of [-1, 1]) add(parts, 'darkMetal', rod([cx + sx * 0.18, 0, cz - 0.17], [cx + sx * 0.18, 0.43, cz - 0.15], 0.01), rod([cx + sx * 0.18, 0, cz + 0.17], [cx + sx * 0.18, 0.82, cz + 0.2], 0.01));
    }
  }
  return parts;
}

function cattedra(p) {
  const parts = {}, W = 1.6, D = 0.75, H = 0.78, r = rng(p.seed || 3);
  add(parts, 'main', boxOn(W, 0.03, D, { y: H - 0.03, r: 0.006 }), boxOn(W - 0.06, H - 0.05, 0.02, { y: 0.02, z: D / 2 - 0.04 }));
  for (const s of [-1, 1]) add(parts, 'main', boxOn(0.03, H - 0.03, D - 0.04, { x: s * (W / 2 - 0.03) }));
  if (p.platform) { add(parts, 'woodDark', boxOn(W + 1.2, 0.15, D + 1.0, { y: -0.15, z: -0.15, r: 0.01 })); for (const k of Object.keys(parts)) if (k !== '$specs') for (const g of parts[k]) g.translate(0, 0.15, 0); }
  clutter(parts, r, -W / 2, W / 2, -D / 2, D / 2, H + (p.platform ? 0.15 : 0), 0.4, 'nessuno');
  return parts;
}

const SOFA_STYLES = [['moderno', 'Moderno'], ['squadrato', 'Squadrato'], ['retro', 'Rétro']];
export const FURNITURE_TYPES = [
  { id: 'poltrona', label: 'Poltrona', cat: 'sedute', sub: 'poltrone', color: '#7a4b3a', tags: 'poltrona salotto relax', params: [seg('style', 'Stile', [['moderna', 'Moderna'], ['club', 'Club'], ['classica', 'Classica']], 'club')], build: poltrona },
  { id: 'sedia_ufficio', label: 'Sedia da ufficio', cat: 'sedute', sub: 'sedie', color: '#3b3b40', tags: 'ufficio girevole rotelle scrivania', params: [range('height', 'Altezza seduta', 0.4, 0.58, 0.01, 0.48), flag('arms', 'Braccioli', true), flag('headrest', 'Poggiatesta', false)], build: sediaUfficio },
  { id: 'sedia_design', label: 'Sedia di design', cat: 'sedute', sub: 'sedie', color: '#e8e4dc', tags: 'moderna scocca plastica cucina', params: [seg('legs', 'Gambe', [['legno', 'Legno'], ['metallo', 'Metallo']], 'legno')], build: sediaDesign },
  { id: 'scrivania', label: 'Scrivania', cat: 'tavoli', sub: 'scrivanie', color: '#c49a6c', tags: 'ufficio studio computer disordine', params: [
    seg('style', 'Stile', [['moderna', 'Moderna'], ['legno', 'Con cassetti']], 'moderna'), seg('pc', 'Computer', [['monitor', 'Monitor'], ['laptop', 'Portatile'], ['nessuno', 'Nessuno']], 'monitor'),
    range('width', 'Larghezza', 0.9, 2.2, 0.05, 1.4), range('depth', 'Profondità', 0.55, 0.9, 0.05, 0.7), range('clutter', 'Disordine', 0, 1, 0.05, 0.5, ''), seed(6),
  ], build: scrivania },
  { id: 'tavolo_rotondo', label: 'Tavolo rotondo', cat: 'tavoli', sub: 'pranzo', color: '#8a5a3b', tags: 'tondo cucina bistrot', resizable: true, params: [
    seg('base', 'Base', [['centrale', 'Centrale'], ['gambe', '4 gambe']], 'centrale'), range('diameter', 'Diametro', 0.6, 1.8, 0.05, 1.1), range('height', 'Altezza', 0.6, 1.1, 0.01, 0.75), flag('cloth', 'Tovaglia', false),
  ], build: tavoloRotondo },
  { id: 'tavolino', label: 'Tavolino da salotto', cat: 'tavoli', sub: 'salotto', color: '#8a5a3b', tags: 'caffè soggiorno', params: [
    seg('style', 'Stile', [['legno', 'Legno'], ['vetro', 'Vetro'], ['tondo', 'Tondo']], 'legno'), range('width', 'Larghezza', 0.5, 1.6, 0.05, 1.1), flag('decor', 'Oggetti sopra', true), seed(2),
  ], build: tavolino },
  { id: 'comodino', label: 'Comodino', cat: 'tavoli', sub: 'comodini', color: '#8a5a3b', tags: 'camera letto notte', params: [int('drawers', 'Cassetti', 1, 3, 2), flag('lamp', 'Abat-jour', true)], build: comodino },
  { id: 'culla', label: 'Culla', cat: 'letti', sub: 'letti', color: '#e8e4dc', tags: 'neonato bambino lettino', params: [flag('toy', 'Peluche', true)], build: culla },
  { id: 'banchi_aula', label: 'Banchi di scuola', cat: 'ufficio', sub: 'scuola', color: '#4f6b3a', tags: 'aula classe scuola studenti', params: [int('rows', 'File', 1, 5, 3), int('cols', 'Colonne', 1, 4, 2)], build: banchiAula },
  { id: 'cattedra', label: 'Cattedra', cat: 'ufficio', sub: 'scuola', color: '#8a5a3b', tags: 'insegnante professore aula', params: [flag('platform', 'Pedana', true), seed(3)], build: cattedra },
];

/** Extra parameters / builders for the original catalog entries 'divano' and 'letto'. */
export const DIVANO_PARAMS = [
  seg('shape', 'Forma', [['lineare', 'Lineare'], ['Lsx', 'Penisola sx'], ['Ldx', 'Penisola dx']], 'lineare'), seg('style', 'Stile', SOFA_STYLES, 'moderno'), flag('pillows', 'Cuscini decorativi', true), seed(1),
];
export const LETTO_PARAMS = [
  seg('model', 'Modello', [['moderno', 'Moderno'], ['imbottito', 'Imbottito'], ['ferro', 'In ferro'], ['castello', 'A castello'], ['baldacchino', 'Baldacchino'], ['futon', 'Futon']], 'moderno'), flag('made', 'Rifatto', true), seed(1),
];
export { merge };
