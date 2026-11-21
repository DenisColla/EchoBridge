// Kitchens: modular kitchen (straight or L) with sink, hob, oven, hood, wall
// cabinets, fridge column; fridge; kitchen island with stools; microwave.
import { add, box, boxOn, cylinder, rod, torus, tube, planeXY, range, int, seg, flag, seed, rng, handle, merge, centerParts } from './util.js';
import { tiles } from '../textures.js';

const TOPS = [['pietra', 'Pietra'], ['legno', 'Legno'], ['bianco', 'Bianco'], ['nero', 'Nero']];
const topRole = (t) => ({ pietra: 'counter', legno: 'woodLight', bianco: 'lacquer', nero: 'black' }[t] || 'counter');

/** One straight run of base (and wall) cabinets along +X from x0, fronts facing +Z, back at z = -0.3. */
function run(len, o, r, special) {
  const parts = {};
  const D = 0.6, TOE = 0.1, H = 0.86, zf = D / 2 - 0.04;
  const n = Math.max(1, Math.floor(len / 0.6 + 1e-6));
  const w = len / n;
  add(parts, 'dark', boxOn(len - 0.01, TOE, D - 0.1, { x: len / 2, z: -0.05 }));
  add(parts, 'mainShade', boxOn(len - 0.004, H - TOE, D - 0.04, { x: len / 2, y: TOE, z: -0.02, r: 0.002 }));
  add(parts, topRole(o.top), boxOn(len, 0.04, D + 0.02, { x: len / 2, y: H, z: 0.01, r: 0.004 }));
  const g = 0.003, ft = 0.018;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * w, what = special[i] || (r() < 0.35 ? 'drawers' : 'door');
    if (what === 'fridge') continue;
    if (what === 'oven') {
      add(parts, 'steel', boxOn(w - 2 * g, 0.6, ft, { x, y: TOE + 0.08, z: zf, r: 0.003 }));
      add(parts, 'screen', boxOn(w - 0.12, 0.3, 0.004, { x, y: TOE + 0.18, z: zf + ft }));
      add(parts, 'steel', rod([x - w / 2 + 0.08, TOE + 0.6, zf + 0.05], [x + w / 2 - 0.08, TOE + 0.6, zf + 0.05], 0.008, { seg: 8 }));
      add(parts, 'black', boxOn(w - 2 * g, 0.08, ft, { x, y: TOE + 0.68 + g, z: zf, r: 0.002 }));
      add(parts, 'mainShade', boxOn(w - 2 * g, 0.075, ft, { x, y: TOE + g, z: zf, r: 0.002 }));
    } else if (what === 'drawers') {
      const hs = [0.18, 0.25, 0.3];
      let y = TOE + g;
      for (const hh of hs) {
        const h = hh * ((H - TOE - 0.01) / 0.73);
        add(parts, 'main', boxOn(w - 2 * g, h - 2 * g, ft, { x, y, z: zf, r: 0.003 }));
        if (o.handles === 'barra') handle(parts, x, y + h - 0.05, zf + ft, Math.min(0.3, w * 0.5));
        y += h;
      }
    } else {
      const two = w > 0.75;
      for (const k of two ? [-1, 1] : [0]) {
        const dw = two ? w / 2 : w, dx = x + k * (w / 4);
        add(parts, 'main', boxOn(dw - 2 * g, H - TOE - 2 * g - 0.01, ft, { x: dx, y: TOE + g, z: zf, r: 0.003 }));
        if (o.handles === 'barra') handle(parts, dx + (two ? -k : (i % 2 ? -1 : 1)) * (dw / 2 - 0.05), H - 0.12, zf + ft, 0.14, true);
      }
    }
    if (o.handles === 'gola') add(parts, 'steel', box(w, 0.02, 0.02, { x, y: H - 0.03, z: zf + 0.008 }));
    if (what === 'sink') {
      add(parts, 'steel', boxOn(Math.min(0.5, w - 0.08), 0.006, 0.42, { x, y: H + 0.04, z: 0.02, r: 0.004 }));
      add(parts, 'steelDark', boxOn(Math.min(0.42, w - 0.16), 0.002, 0.34, { x, y: H + 0.046, z: 0.02, r: 0.002 }));
      add(parts, 'chrome', cylinder(0.022, 0.018, 0.05, { x, y: H + 0.04, z: -0.22, seg: 14 }),
        tube([[x, H + 0.08, -0.22], [x, H + 0.3, -0.22], [x, H + 0.34, -0.12], [x, H + 0.26, -0.06]], 0.011, { segs: 18, rs: 8 }),
        rod([x + 0.04, H + 0.1, -0.22], [x + 0.08, H + 0.14, -0.22], 0.007, { seg: 6 }));
    }
    if (what === 'oven' || what === 'hob') {
      const hw = Math.min(0.58, w - 0.03);
      add(parts, 'screen', boxOn(hw, 0.006, 0.5, { x, y: H + 0.04, z: 0.01, r: 0.003 }));
      for (const [bx, bz, rr] of [[-0.14, -0.12, 0.07], [0.14, -0.12, 0.055], [-0.14, 0.12, 0.055], [0.14, 0.12, 0.08]]) add(parts, 'darkMetal', torus(rr * (hw / 0.58), 0.004, { rx: 90, x: x + bx * (hw / 0.58), y: H + 0.047, z: 0.01 + bz, rs: 6, ts: 32 }));
    }
  }
  // wall cabinets
  if (o.wall) {
    const y0 = 1.45, hh = 0.7, dd = 0.34, z0 = -D / 2 + dd / 2;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * w, what = special[i];
      if (what === 'fridge') continue;
      if (what === 'oven' || what === 'hob') {
        // chimney hood
        add(parts, 'steel', boxOn(Math.min(0.6, w), 0.08, 0.48, { x, y: y0 + 0.05, z: -D / 2 + 0.24, r: 0.004 }), boxOn(0.26, 2.3 - y0 - 0.13, 0.24, { x, y: y0 + 0.13, z: -D / 2 + 0.12, r: 0.003 }));
        continue;
      }
      add(parts, 'mainShade', boxOn(w - 0.004, hh, dd - 0.02, { x, y: y0, z: z0 - 0.01, r: 0.002 }));
      add(parts, 'main', boxOn(w - 2 * g, hh - 2 * g, ft, { x, y: y0 + g, z: z0 + dd / 2 - 0.02, r: 0.003 }));
      if (o.handles === 'barra') handle(parts, x + (i % 2 ? -1 : 1) * (w / 2 - 0.05), y0 + 0.1, z0 + dd / 2 - 0.002, 0.12, true);
    }
  }
  // backsplash
  const bh = (o.wall ? 1.45 : 1.4) - (H + 0.04);
  add(parts, 'tiles', planeXY(len, bh, { x: len / 2, y: H + 0.04, z: -D / 2 + 0.002, tile: 0.4 }));
  return parts;
}

function fridgeColumn(parts, x, H = 2.05) {
  const W = 0.6, D = 0.64;
  add(parts, 'appliance', boxOn(W - 0.004, H, D - 0.02, { x, z: -0.01, r: 0.01 }));
  add(parts, 'appliance', boxOn(W - 0.01, H * 0.62 - 0.006, 0.03, { x, y: H * 0.38 + 0.003, z: D / 2 - 0.02, r: 0.01 }), boxOn(W - 0.01, H * 0.38 - 0.01, 0.03, { x, y: 0.003, z: D / 2 - 0.02, r: 0.01 }));
  add(parts, 'steel', rod([x - W / 2 + 0.06, H * 0.42, D / 2 + 0.04], [x - W / 2 + 0.06, H * 0.7, D / 2 + 0.04], 0.01), rod([x - W / 2 + 0.06, H * 0.2, D / 2 + 0.04], [x - W / 2 + 0.06, H * 0.34, D / 2 + 0.04], 0.01));
  for (const y of [H * 0.42, H * 0.7, H * 0.2, H * 0.34]) add(parts, 'steel', rod([x - W / 2 + 0.06, y, D / 2 + 0.01], [x - W / 2 + 0.06, y, D / 2 + 0.04], 0.008));
}

function cucina(p) {
  const r = rng(p.seed);
  const o = { top: p.top, wall: p.wall, handles: p.handles };
  const parts = { $specs: { tiles: { kind: 'prop', color: '#ffffff', map: tiles(p.tile === 'scuro' ? '#5d6670' : p.tile === 'verde' ? '#8fb3a0' : '#f2f0ea', '#b5b0a6'), roughness: 0.25 } } };
  const L = p.length, cols = p.fridge ? 0.6 : 0;
  const len = L - cols;
  const n = Math.max(2, Math.floor(len / 0.6 + 1e-6));
  // layout: sink and hob/oven at random distinct modules (not at the corner of an L)
  const special = {};
  const first = p.shape === 'L' ? 1 : 0;
  const slots = []; for (let i = first; i < n; i++) slots.push(i);
  const hob = slots.splice(r.int(0, slots.length - 1), 1)[0];
  special[hob] = r() < 0.75 ? 'oven' : 'hob';
  if (slots.length) {
    // sink at least one module away from the hob when possible
    const far = slots.filter((i) => Math.abs(i - hob) > 1);
    const pool = far.length ? far : slots;
    special[pool[r.int(0, pool.length - 1)]] = 'sink';
  }
  const main = run(len, o, r, special);
  merge(parts, main, { x: -L / 2 + (p.fridgeLeft ? cols : 0) });
  if (p.fridge) fridgeColumn(parts, p.fridgeLeft ? -L / 2 + 0.3 : L / 2 - 0.3);
  if (p.shape === 'L') {
    const L2 = Math.max(0.6, p.side - 0.6);
    const side = run(L2, { ...o, wall: o.wall }, r, {});
    // built along +X from -L2..0, turned to run toward +Z along the left end, fronts facing +X
    merge(parts, side, { ry: 90, x: -L / 2 + (p.fridgeLeft && p.fridge ? 0.6 : 0) + 0.3, z: 0.32 + L2 });
  }
  return centerParts(parts);
}

function frigo(p) {
  const parts = {};
  if (p.style === 'americano') {
    const W = 0.91, H = 1.78, D = 0.72;
    add(parts, 'steel', boxOn(W, H, D - 0.04, { z: -0.02, r: 0.012 }));
    add(parts, 'steel', boxOn(W / 2 - 0.006, H - 0.02, 0.04, { x: -W / 4, y: 0.01, z: D / 2 - 0.02, r: 0.01 }), boxOn(W / 2 - 0.006, H - 0.02, 0.04, { x: W / 4, y: 0.01, z: D / 2 - 0.02, r: 0.01 }));
    add(parts, 'black', boxOn(0.2, 0.3, 0.01, { x: -W / 4, y: 1.0, z: D / 2 + 0.002, r: 0.01 }));
    for (const s of [-1, 1]) add(parts, 'chrome', rod([s * 0.03, 0.75, D / 2 + 0.05], [s * 0.03, 1.45, D / 2 + 0.05], 0.011), rod([s * 0.03, 0.8, D / 2], [s * 0.03, 0.8, D / 2 + 0.05], 0.008), rod([s * 0.03, 1.4, D / 2], [s * 0.03, 1.4, D / 2 + 0.05], 0.008));
    return parts;
  }
  const W = 0.6, H = p.style === 'retro' ? 1.55 : 1.85, D = 0.65;
  const role = p.style === 'retro' ? 'main' : 'appliance';
  add(parts, role, boxOn(W, H, D - 0.04, { z: -0.02, r: p.style === 'retro' ? 0.07 : 0.012 }));
  add(parts, role, boxOn(W - 0.008, H * 0.66, 0.045, { y: H * 0.33, z: D / 2 - 0.02, r: p.style === 'retro' ? 0.05 : 0.01 }), boxOn(W - 0.008, H * 0.33 - 0.01, 0.045, { y: 0.005, z: D / 2 - 0.02, r: p.style === 'retro' ? 0.05 : 0.01 }));
  const hx = W / 2 - 0.05;
  add(parts, 'chrome', rod([hx, H * 0.4, D / 2 + 0.06], [hx, H * 0.62, D / 2 + 0.06], 0.01), rod([hx, H * 0.4, D / 2], [hx, H * 0.4, D / 2 + 0.06], 0.008), rod([hx, H * 0.62, D / 2], [hx, H * 0.62, D / 2 + 0.06], 0.008),
    rod([hx, H * 0.2, D / 2 + 0.06], [hx, H * 0.3, D / 2 + 0.06], 0.01), rod([hx, H * 0.2, D / 2], [hx, H * 0.2, D / 2 + 0.06], 0.008), rod([hx, H * 0.3, D / 2], [hx, H * 0.3, D / 2 + 0.06], 0.008));
  return parts;
}

function isola(p) {
  const L = p.length, D = 0.9, H = 0.9, parts = {};
  add(parts, 'dark', boxOn(L - 0.1, 0.1, D - 0.3, { z: -0.08 }));
  add(parts, 'mainShade', boxOn(L - 0.02, H - 0.1, D - 0.3, { y: 0.1, z: -0.08, r: 0.003 }));
  add(parts, topRole(p.top), boxOn(L + 0.04, 0.045, D, { y: H, r: 0.006 }));
  const n = Math.max(1, Math.round(L / 0.6)), w = (L - 0.02) / n;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + 0.01 + (i + 0.5) * w;
    add(parts, 'main', boxOn(w - 0.006, H - 0.12, 0.018, { x, y: 0.105, z: -0.08 - (D - 0.3) / 2 - 0.009, r: 0.003 }));
  }
  if (p.stools) {
    const ns = Math.max(1, Math.round(L / 0.55));
    for (let i = 0; i < ns; i++) {
      const x = -L / 2 + (i + 0.5) * (L / ns), z = D / 2 + 0.28;
      add(parts, 'soft', cylinder(0.18, 0.18, 0.06, { x, y: 0.62, z, seg: 24, bevel: 0.02 }));
      add(parts, 'darkMetal', rod([x, 0.03, z], [x, 0.62, z], 0.02), cylinder(0.2, 0.2, 0.02, { x, z, seg: 24 }), torus(0.15, 0.008, { rx: 90, x, y: 0.25, z, rs: 6, ts: 28 }));
    }
  }
  return centerParts(parts);
}

function microonde() {
  const parts = {};
  add(parts, 'appliance', boxOn(0.48, 0.28, 0.36, { r: 0.01 }));
  add(parts, 'screen', box(0.3, 0.2, 0.004, { x: -0.06, y: 0.14, z: 0.18 }));
  add(parts, 'black', box(0.1, 0.24, 0.004, { x: 0.18, y: 0.14, z: 0.18 }));
  add(parts, 'chrome', cylinder(0.012, 0.012, 0.012, { x: 0.18, y: 0.08, z: 0.18, rx: 90, seg: 12 }), cylinder(0.012, 0.012, 0.012, { x: 0.18, y: 0.14, z: 0.18, rx: 90, seg: 12 }));
  return parts;
}

export const KITCHEN_TYPES = [
  { id: 'cucina', label: 'Cucina componibile', cat: 'cucina', sub: 'mobili', color: '#e8e4dc', tags: 'cucina lavello fornelli forno pensili frigo componibile', params: [
    seg('shape', 'Forma', [['lineare', 'Lineare'], ['L', 'Ad angolo (L)']], 'lineare'), range('length', 'Lunghezza', 1.8, 5.4, 0.6, 3.0), range('side', 'Lato corto (L)', 1.2, 3.6, 0.6, 2.4),
    flag('wall', 'Pensili', true), flag('fridge', 'Colonna frigo', true), flag('fridgeLeft', 'Frigo a sinistra', false),
    seg('handles', 'Maniglie', [['barra', 'Barra'], ['gola', 'Gola']], 'barra'), seg('top', 'Piano', TOPS, 'pietra'),
    seg('tile', 'Piastrelle', [['chiaro', 'Chiare'], ['verde', 'Verdi'], ['scuro', 'Scure']], 'chiaro'), seed(4),
  ], build: cucina },
  { id: 'frigo', label: 'Frigorifero', cat: 'cucina', sub: 'elettrodomestici', color: '#a5d4c8', tags: 'frigo freezer', params: [seg('style', 'Modello', [['moderno', 'Moderno'], ['americano', 'Americano'], ['retro', 'Rétro']], 'moderno')], build: frigo },
  { id: 'isola_cucina', label: 'Isola da cucina', cat: 'cucina', sub: 'mobili', color: '#3b3b40', tags: 'penisola bancone colazione sgabelli', params: [range('length', 'Lunghezza', 1.2, 3.6, 0.1, 2.0), seg('top', 'Piano', TOPS, 'pietra'), flag('stools', 'Sgabelli', true)], build: isola },
  { id: 'microonde', label: 'Forno a microonde', cat: 'cucina', sub: 'elettrodomestici', color: '#e8e4dc', tags: 'microonde forno', params: [], build: microonde },
];
