// Storage furniture: bookshelves (filled with books and objects), wardrobes,
// chests of drawers, wall shelves, TV units, coat stands, shoe cabinets.
import { add, box, boxOn, cylinder, rod, sphere, lathe, range, int, seg, flag, seed, rng, fillShelf, handle, knob, centerParts } from './util.js';

const STYLE_WOOD = [['legno', 'Legno'], ['bianco', 'Bianco'], ['scuro', 'Scuro']];
const carcassRole = (style) => (style === 'bianco' ? 'lacquer' : style === 'scuro' ? 'woodDark' : 'main');

function libreria(p) {
  const W = p.width, H = p.height, D = p.depth, T = 0.022, r = rng(p.seed);
  const parts = {};
  const role = carcassRole(p.style);
  // carcass: sides, top, bottom plinth, back
  add(parts, role,
    boxOn(T, H, D, { x: -W / 2 + T / 2, r: 0.003 }), boxOn(T, H, D, { x: W / 2 - T / 2, r: 0.003 }),
    boxOn(W, T, D, { y: H - T, r: 0.003 }), boxOn(W - 2 * T, 0.07, D - 0.02, { y: 0, z: 0.01 - 0.0, r: 0.002 }),
  );
  add(parts, role === 'main' ? 'mainShade' : role, boxOn(W - 2 * T, H - T, 0.008, { z: -D / 2 + 0.004 }));
  // columns
  const cols = Math.max(1, Math.round((W - 2 * T) / 0.85));
  const cw = (W - 2 * T - (cols - 1) * T) / cols;
  for (let c = 1; c < cols; c++) add(parts, role, boxOn(T, H - T - 0.07, D - 0.01, { x: -W / 2 + T + c * (cw + T) - T / 2, y: 0.07, z: 0.005 }));
  // shelves
  const n = p.shelves, y0 = 0.07, gap = (H - T - y0) / n;
  for (let i = 0; i < n; i++) {
    const y = y0 + i * gap;
    if (i > 0) add(parts, role, boxOn(W - 2 * T, T, D - 0.012, { y: y - T, z: 0.006, r: 0.002 }));
    for (let c = 0; c < cols; c++) {
      const x0 = -W / 2 + T + c * (cw + T);
      if (p.fill > 0.02) fillShelf(parts, r, x0, x0 + cw, y + (i > 0 ? 0 : T), -D / 2 + 0.01, D - 0.04, gap - T - 0.015, p.fill, p.objects);
    }
  }
  return parts;
}

function armadio(p) {
  const W = p.width, H = p.height, D = 0.6, T = 0.02, plinth = 0.08;
  const parts = {};
  const role = carcassRole(p.style === 'specchio' || p.style === 'scorrevole' ? 'legno' : p.finish);
  const front = p.finish === 'bianco' ? 'lacquer' : p.finish === 'scuro' ? 'woodDark' : 'main';
  add(parts, front === 'main' ? 'mainShade' : front, boxOn(W, H - plinth, D - 0.025, { y: plinth, z: -0.0125, r: 0.004 }));
  add(parts, 'dark', boxOn(W - 0.06, plinth, D - 0.08, { z: -0.03 }));
  add(parts, front === 'main' ? 'mainShade' : front, boxOn(W + 0.01, 0.025, D, { y: H, r: 0.006 }));
  const zf = D / 2 - 0.025;
  const drawerH = p.drawers ? 0.42 : 0;
  const doors = Math.max(1, Math.min(6, p.doors || Math.round(W / 0.5)));
  const dw = W / doors, g = 0.004;
  if (p.style === 'scorrevole') {
    const n = Math.max(2, Math.round(W / 0.9)), sw = W / n + 0.02;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (i + 0.5) * (W / n), z = zf + (i % 2 ? 0.012 : 0.034);
      add(parts, front, boxOn(sw - 0.004, H - plinth - 0.02, 0.02, { x, y: plinth + 0.01, z: z - 0.01, r: 0.004 }));
      add(parts, 'mirror', boxOn(sw * 0.62, (H - plinth) * 0.78, 0.004, { x, y: plinth + (H - plinth) * 0.11, z: z + 0.001 }));
      add(parts, 'metal', boxOn(0.012, 0.5, 0.012, { x: x + (i % 2 ? -1 : 1) * (sw / 2 - 0.03), y: plinth + (H - plinth) * 0.42, z: z + 0.006 }));
    }
    add(parts, 'metal', box(W, 0.02, 0.06, { y: H - 0.015, z: zf + 0.025 }));
    return parts;
  }
  for (let i = 0; i < doors; i++) {
    const x = -W / 2 + (i + 0.5) * dw;
    const y0 = plinth + drawerH + g, h = H - plinth - drawerH - 2 * g;
    add(parts, front, boxOn(dw - g * 2, h, 0.02, { x, y: y0, z: zf, r: 0.003 }));
    if (p.style === 'riquadri') {
      for (const [yy, hh] of [[y0 + 0.08, h * 0.52], [y0 + h * 0.62, h * 0.32]]) {
        const fw = dw - 0.14;
        add(parts, front, boxOn(fw, 0.025, 0.012, { x, y: yy, z: zf + 0.016 }), boxOn(fw, 0.025, 0.012, { x, y: yy + hh - 0.025, z: zf + 0.016 }),
          boxOn(0.025, hh, 0.012, { x: x - fw / 2 + 0.0125, y: yy, z: zf + 0.016 }), boxOn(0.025, hh, 0.012, { x: x + fw / 2 - 0.0125, y: yy, z: zf + 0.016 }));
      }
    } else if (p.style === 'specchio' && i % 2 === 0) {
      add(parts, 'mirror', boxOn(dw - 0.1, h - 0.16, 0.004, { x, y: y0 + 0.08, z: zf + 0.021 }));
    }
    const hx = x + (i % 2 ? -1 : 1) * (dw / 2 - 0.05);
    handle(parts, hx, y0 + h * 0.48, zf + 0.02, 0.22, true);
  }
  if (drawerH) {
    const nd = Math.max(1, Math.round(W / 0.8)), ddw = W / nd;
    for (let i = 0; i < nd; i++) {
      const x = -W / 2 + (i + 0.5) * ddw;
      for (let k = 0; k < 2; k++) {
        const y = plinth + g + k * (drawerH / 2);
        add(parts, front, boxOn(ddw - 2 * g, drawerH / 2 - 2 * g, 0.02, { x, y, z: zf, r: 0.003 }));
        handle(parts, x, y + drawerH / 4 - g, zf + 0.02, 0.16);
      }
    }
  }
  return parts;
}

function cassettiera(p) {
  const W = p.width, H = p.height, D = 0.48, n = p.drawers, legs = p.style !== 'moderno';
  const parts = {};
  const front = carcassRole(p.finish);
  const LEG = legs ? 0.12 : 0.02;
  add(parts, front === 'main' ? 'mainShade' : front, boxOn(W - 0.02, H - LEG - 0.03, D - 0.03, { y: LEG, z: -0.015, r: 0.004 }));
  add(parts, front, boxOn(W, 0.03, D, { y: H - 0.03, r: 0.008 }));
  if (legs) for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(parts, front === 'lacquer' ? 'woodLight' : front, cylinder(0.018, 0.012, LEG, { x: sx * (W / 2 - 0.05), z: sz * (D / 2 - 0.06), seg: 12 }));
  const fh = H - LEG - 0.03, dh = fh / n, zf = D / 2 - 0.03;
  for (let i = 0; i < n; i++) {
    const y = LEG + i * dh + 0.004;
    const split = W > 1.0 && i === n - 1;
    for (const [x, w] of split ? [[-W / 4, W / 2], [W / 4, W / 2]] : [[0, W]]) {
      add(parts, front, boxOn(w - 0.018, dh - 0.008, 0.02, { x, y, z: zf, r: 0.003 }));
      if (p.style === 'moderno') add(parts, 'metal', box(Math.min(0.3, w * 0.4), 0.012, 0.012, { x, y: y + dh - 0.03, z: zf + 0.026 }));
      else if (p.style === 'classico') { knob(parts, x - w * 0.22, y + dh / 2, zf + 0.02, 'gold'); knob(parts, x + w * 0.22, y + dh / 2, zf + 0.02, 'gold'); }
      else handle(parts, x, y + dh / 2, zf + 0.02, 0.14);
    }
  }
  return parts;
}

function mensola(p) {
  const W = p.width, r = rng(p.seed), parts = {};
  const role = carcassRole(p.finish);
  const n = p.levels, gap = 0.32, D = 0.24;
  for (let i = 0; i < n; i++) {
    const y = i * gap;
    add(parts, role, boxOn(W, 0.025, D, { y, r: 0.004 }));
    if (p.brackets) for (const s of [-1, 1]) add(parts, 'darkMetal', boxOn(0.02, 0.12, 0.004, { x: s * (W / 2 - 0.12), y: y - 0.12, z: -D / 2 + 0.002 }), boxOn(0.02, 0.004, D * 0.8, { x: s * (W / 2 - 0.12), y: y - 0.004, z: -D * 0.1 }));
    if (p.fill > 0.02) fillShelf(parts, r, -W / 2 + 0.02, W / 2 - 0.02, y + 0.025, -D / 2 + 0.01, D - 0.03, gap - 0.04, p.fill, true);
  }
  return parts;
}

function mobileTv(p) {
  const W = p.width, H = 0.48, D = 0.42, parts = {};
  const front = carcassRole(p.finish);
  add(parts, front === 'main' ? 'mainShade' : front, boxOn(W, H - 0.06, D, { y: 0.06, r: 0.006 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(parts, 'darkMetal', cylinder(0.012, 0.012, 0.06, { x: sx * (W / 2 - 0.06), z: sz * (D / 2 - 0.06), seg: 10 }));
  const n = Math.max(2, Math.round(W / 0.6)), dw = W / n;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + (i + 0.5) * dw;
    if (i === 1 && n >= 3) { add(parts, 'dark', boxOn(dw - 0.03, H - 0.12, 0.01, { x, y: 0.09, z: D / 2 - 0.004 })); continue; } // open niche
    add(parts, front, boxOn(dw - 0.008, H - 0.075, 0.018, { x, y: 0.068, z: D / 2 - 0.002, r: 0.003 }));
    add(parts, 'metal', box(0.1, 0.01, 0.01, { x, y: H - 0.05, z: D / 2 + 0.018 }));
  }
  if (p.tv) {
    const sw = Math.min(W * 0.85, 1.45), sh = sw * 0.5625;
    add(parts, 'black', boxOn(sw, sh, 0.035, { y: H + 0.07, z: -0.05, r: 0.006 }), boxOn(0.25, 0.012, 0.18, { y: H, z: -0.03, r: 0.004 }), boxOn(0.04, 0.08, 0.02, { y: H, z: -0.05 }));
    add(parts, 'screen', box(sw - 0.02, sh - 0.02, 0.002, { y: H + 0.07 + sh / 2, z: -0.05 + 0.0176 }));
  }
  return parts;
}

function appendiabiti(p) {
  const H = 1.8, parts = {};
  add(parts, 'main', cylinder(0.022, 0.018, H, { seg: 16, bevel: 0.006 }), sphere(0.03, { y: H + 0.01, ws: 16, hs: 10 }));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    add(parts, 'main', rod([0, 0.18, 0], [Math.cos(a) * 0.3, 0.015, Math.sin(a) * 0.3], 0.014, { seg: 10 }));
  }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3, y = H - 0.08 - (k % 2) * 0.12;
    add(parts, 'main', rod([0, y - 0.08, 0], [Math.cos(a) * 0.17, y + 0.02, Math.sin(a) * 0.17], 0.01, { seg: 8 }), sphere(0.016, { x: Math.cos(a) * 0.17, y: y + 0.02, z: Math.sin(a) * 0.17, ws: 10, hs: 8 }));
  }
  if (p.coats) {
    // a coat and a scarf hanging (simple draped volumes)
    add(parts, 'soft', lathe([[0.0, 1.62], [0.07, 1.6], [0.17, 1.4], [0.2, 1.05], [0.21, 0.75], [0, 0.75]], { x: 0.19, z: 0.06, seg: 14, ry: 0 }));
    add(parts, 'blanket', lathe([[0.0, 1.58], [0.05, 1.55], [0.07, 1.2], [0.06, 1.05], [0, 1.05]], { x: -0.12, z: -0.13, seg: 10 }));
  }
  return parts;
}

function scarpiera(p) {
  const W = p.width, H = 1.0, D = 0.3, parts = {};
  const front = carcassRole(p.finish);
  add(parts, front === 'main' ? 'mainShade' : front, boxOn(W, H, D, { r: 0.006 }));
  const n = Math.max(1, Math.round(W / 0.45)), dw = W / n;
  for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) {
    const x = -W / 2 + (i + 0.5) * dw, y = 0.02 + k * (H / 2);
    add(parts, front, box(dw - 0.008, H / 2 - 0.03, 0.018, { x, y: y + (H / 2 - 0.03) / 2, z: D / 2 + 0.002, rx: k ? 0 : 0, r: 0.003 }));
    add(parts, 'metal', box(0.1, 0.01, 0.012, { x, y: y + H / 2 - 0.07, z: D / 2 + 0.018 }));
  }
  return centerParts(parts);
}

export const STORAGE_TYPES = [
  { id: 'libreria', label: 'Libreria piena', cat: 'armadi', sub: 'librerie', color: '#b98c5f', tags: 'libri scaffale biblioteca studio', params: [
    seg('style', 'Finitura', STYLE_WOOD, 'legno'), range('width', 'Larghezza', 0.4, 3.6, 0.05, 1.2), range('height', 'Altezza', 0.6, 2.6, 0.05, 2.0),
    range('depth', 'Profondità', 0.22, 0.45, 0.01, 0.32), int('shelves', 'Ripiani', 2, 8, 5), range('fill', 'Riempimento', 0, 1, 0.05, 0.8, ''), flag('objects', 'Soprammobili', true), seed(3),
  ], build: libreria },
  { id: 'armadio', label: 'Armadio', cat: 'armadi', sub: 'armadi', color: '#b98c5f', tags: 'guardaroba camera vestiti ante', params: [
    seg('style', 'Ante', [['liscio', 'Lisce'], ['riquadri', 'Riquadri'], ['specchio', 'Specchio'], ['scorrevole', 'Scorrevoli']], 'liscio'),
    seg('finish', 'Finitura', STYLE_WOOD, 'bianco'), range('width', 'Larghezza', 0.5, 3.5, 0.05, 1.6), range('height', 'Altezza', 1.6, 2.7, 0.05, 2.2), int('doors', 'Numero ante', 1, 6, 3), flag('drawers', 'Cassetti in basso', false),
  ], build: armadio },
  { id: 'cassettiera', label: 'Cassettiera / comò', cat: 'armadi', sub: 'cassettiere', color: '#8a5a3b', tags: 'comò cassetti camera', params: [
    seg('style', 'Stile', [['moderno', 'Moderno'], ['classico', 'Classico'], ['semplice', 'Semplice']], 'semplice'), seg('finish', 'Finitura', STYLE_WOOD, 'legno'),
    range('width', 'Larghezza', 0.4, 1.8, 0.05, 1.0), range('height', 'Altezza', 0.5, 1.4, 0.05, 0.85), int('drawers', 'Cassetti', 2, 7, 4),
  ], build: cassettiera },
  { id: 'mensola', label: 'Mensole con libri', cat: 'armadi', sub: 'librerie', color: '#b98c5f', mount: 'wall', spawnY: 1.1, tags: 'mensola parete libri', params: [
    seg('finish', 'Finitura', STYLE_WOOD, 'legno'), range('width', 'Larghezza', 0.4, 2.4, 0.05, 1.0), int('levels', 'Ripiani', 1, 4, 2), range('fill', 'Riempimento', 0, 1, 0.05, 0.6, ''), flag('brackets', 'Staffe', true), seed(5),
  ], build: mensola },
  { id: 'mobile_tv', label: 'Mobile TV', cat: 'armadi', sub: 'credenze', color: '#8a5a3b', tags: 'soggiorno televisore madia', params: [
    seg('finish', 'Finitura', STYLE_WOOD, 'scuro'), range('width', 'Larghezza', 1.0, 2.6, 0.05, 1.8), flag('tv', 'Con TV', true),
  ], build: mobileTv },
  { id: 'appendiabiti', label: 'Appendiabiti', cat: 'armadi', sub: 'armadi', color: '#6b4a2f', tags: 'attaccapanni ingresso cappotto', params: [flag('coats', 'Con cappotti', true)], build: appendiabiti },
  { id: 'scarpiera', label: 'Scarpiera', cat: 'armadi', sub: 'cassettiere', color: '#e8e4dc', tags: 'scarpe ingresso', params: [seg('finish', 'Finitura', STYLE_WOOD, 'bianco'), range('width', 'Larghezza', 0.5, 1.6, 0.05, 0.9)], build: scarpiera },
];
