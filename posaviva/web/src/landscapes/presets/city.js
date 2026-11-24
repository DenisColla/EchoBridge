// City presets: street, crossroads with skyscrapers, night alley, skyscraper
// rooftop, European square, residential street, car park, harbour.
import { cityTerrain, road, parkedCars, seasonTree, farCity, lamp, forest, CAR_COLORS, CARS, PI, H, relief, biome } from '../gen/common.js';
import { TYPE_BY_ID, defaultParams, cleanParams } from '../../props/catalog.js';

const night = (g) => g.atm.night || g.atm.dusk;
const NEON = ['rosa', 'blu', 'verde', 'rosso', 'giallo', 'viola'];
const NEON_TXT = ['BAR', 'HOTEL', '24H', 'PIZZA', 'CLUB', 'RAMEN', 'MOTEL', 'OPEN', 'NEON'];
const NEON_HEX = { rosa: '#ff4fb8', blu: '#43b6ff', verde: '#55ff8a', rosso: '#ff3b3b', giallo: '#ffd23f', viola: '#b467ff' };

/** Street furniture spread along a sidewalk line (axis x: z = line). */
function furnish(g, { axis = 'x', line, from, to, yaw = 0, kinds = ['es_cestino', 'es_panchina', 'es_idrante', 'es_cassetta', 'es_vaso_albero', 'es_rastrelliera', 'es_cabina', 'es_edicola', 'es_parchimetro', 'es_fermata'], n = 6 }) {
  for (let i = 0; i < n; i++) {
    const type = g.rng.pick(kinds), t = g.rng.range(from, to);
    const params = type === 'es_cestino' ? { style: g.rng.pick(['palo', 'colonna', 'differenziata']) } : type === 'es_panchina' ? { style: g.rng.pick(['classica', 'moderna']) } : type === 'es_vaso_albero' ? { plant: g.rng.pick(['albero', 'sfera', 'conifera']), seed: g.rng.seedInt() } : null;
    g.add(type, { pos: axis === 'x' ? [t, line] : [line, t], yaw, params, r: type === 'es_edicola' || type === 'es_fermata' ? 2 : 0.6, free: { corridor: false } });
  }
}

/** Cars driving on the lanes (local axis). */
function traffic(g, { axis = 'x', center, cw, from, to, n = 3, laneW = 3.25, lanes = 2 }) {
  for (let i = 0; i < n; i++) {
    const lane = g.rng.int(0, lanes - 1), off = -cw + laneW * (lane + 0.5), dir = off > 0 ? 1 : -1;
    const t = g.rng.range(from, to), type = g.rng.pick([...CARS, 'es_autobus', 'es_scooter', 'es_moto']);
    const x = axis === 'x' ? t : center + off, z = axis === 'x' ? center + off : t;
    const yaw = axis === 'x' ? (dir > 0 ? -H : H) : (dir > 0 ? PI : 0);
    g.add(type, { pos: [x, z], yaw, color: type === 'es_taxi' || type === 'es_autobus' ? null : g.rng.pick(CAR_COLORS), r: type === 'es_autobus' ? 5 : 2.4, free: { corridor: true, stage: true } });
  }
}

/** Row of buildings (isolati) along a front line. side: 'back' (fronts face +Z), 'left' / 'right' (face the road). */
function blockRow(g, { axis = 'x', line, from, to, face = 0, mix = 'centro', height = 'media', depth = 16, shops = true }) {
  let t = from;
  while (t < to - 20) {
    const L = Math.min(to - t, g.rng.range(44, 90));
    const c = t + L / 2;
    g.add('ed_isolato', {
      pos: axis === 'x' ? [c, line] : [line, c], yaw: face, fit: { front: true }, terrain: false, y: 0,
      params: { mix, length: L, depth, height, shops, sidewalk: false, night: night(g), seed: g.rng.seedInt(), wear: g.rng.pick(['0', '0', '1']) },
    });
    t += L + g.rng.range(0, 2);
  }
}

function neonSigns(g, { axis = 'z', line, from, to, side, n = 3, y = 3.6 }) {
  for (let i = 0; i < n; i++) {
    const t = g.rng.range(from, to), color = g.rng.pick(NEON);
    const pos = axis === 'z' ? [line, t] : [t, line];
    const yaw = axis === 'z' ? (side > 0 ? -H : H) : 0;
    if (g.add('ls_insegna', { pos, y: y + g.rng.range(-0.4, 1.4), yaw, terrain: false, params: { text: g.rng.pick(NEON_TXT), color, mount: g.rng.chance(0.6) ? 'bandiera' : 'parete', width: g.rng.range(1.2, 2.2) } })) {
      g.items[g.items.length - 1].lamp = { y: 0.3, color: NEON_HEX[color], intensity: 0.9 };
    }
  }
}

function streetTrees(g, { axis = 'x', line, from, to, step = [9, 14] }) {
  for (let t = from; t < to; t += g.rng.range(step[0], step[1])) {
    const tr = seasonTree(g, 'street');
    g.add(tr.type, { pos: axis === 'x' ? [t, line] : [line, t], params: { ...tr.params, height: g.rng.range(7, 10), width: 0.8 }, color: tr.color, r: 1.2, sink: 0.04 });
  }
}

// ------------------------------------------------------------------ presets
export const CITY = [
  {
    id: 'strada', label: 'Strada di città', group: 'citta', variants: 3,
    tags: ['strada', 'città', 'via', 'marciapiede', 'negozi', 'urbano', 'centro', 'traffico'],
    thumb: { sky: ['#7fb0e0', '#dce9f4'], ground: '#6f6d68', sil: 'street' },
    build(g) {
      cityTerrain(g, {});
      const v = g.spec.variant;
      if (v === 1) {
        // street running into the distance (one-point perspective), characters on the right sidewalk
        const lanes = 2, laneW = 3.25, walkW = 2.6, cw = lanes * laneW / 2;
        const cx = -(cw + walkW / 2);
        road(g, { axis: 'z', cx, cz: -60, length: 160, lanes, laneW, walkW, pave: g.rng.pick(['lastre', 'porfido']) });
        blockRow(g, { axis: 'z', line: walkW / 2 + 0.1, from: -120, to: 12, face: -H, mix: g.rng.pick(['centro', 'misto']), height: g.rng.pick(['media', 'alta']) });
        blockRow(g, { axis: 'z', line: cx - cw - walkW - 0.1, from: -120, to: 12, face: H, mix: g.rng.pick(['centro', 'moderno', 'misto']), height: g.rng.pick(['media', 'alta', 'bassa']) });
        parkedCars(g, { axis: 'z', line: cx + cw - 1.1, from: -70, to: -8, side: -1, chance: 0.6 });
        parkedCars(g, { axis: 'z', line: cx - cw + 1.1, from: -70, to: 10, side: 1, chance: 0.5 });
        traffic(g, { axis: 'z', center: cx, cw, from: -110, to: -20, n: g.n(3) });
        for (let z = -6 - g.rng.range(0, 8); z > -130; z -= g.rng.range(16, 22)) { lamp(g, cx + cw + 0.45, z, { style: 'moderno', height: 6.5, yaw: -H }); lamp(g, cx - cw - 0.45, z - 8, { style: 'moderno', height: 6.5, yaw: H }); }
        furnish(g, { axis: 'z', line: cx + cw + 0.8, from: -60, to: -4, yaw: -H, n: g.n(5) });
        if (night(g) || g.want('neon')) neonSigns(g, { axis: 'z', line: walkW / 2, from: -70, to: -6, side: 1, n: g.n(3, 1) });
        if (g.want('alberi') || g.rng.chance(0.4)) streetTrees(g, { axis: 'z', line: cx - cw - walkW / 2 - 0.4, from: -110, to: -4 });
      } else {
        // street across the view behind the characters (they stand on the near sidewalk)
        const lanes = v === 2 ? 4 : 2, laneW = 3.25, walkW = v === 2 ? 3.4 : 2.6, cw = lanes * laneW / 2;
        const zc = -(cw + walkW / 2);
        road(g, { axis: 'x', cz: zc, length: 160, lanes, laneW, walkW, center: v === 2 ? 'doppia' : 'tratteggiata', crossingAt: g.rng.chance(0.5) ? 2 : null });
        const far = zc - cw - walkW;
        blockRow(g, { axis: 'x', line: far - 0.1, from: -64, to: 64, face: 0, mix: v === 2 ? 'centro' : g.rng.pick(['centro', 'misto', 'moderno']), height: g.rng.pick(['media', 'alta']) });
        parkedCars(g, { axis: 'x', line: zc - cw + 1.1, from: -70, to: 70, side: 1, chance: 0.7 });
        parkedCars(g, { axis: 'x', line: zc + cw - 1.1, from: -70, to: -6, side: -1, chance: 0.6 });
        parkedCars(g, { axis: 'x', line: zc + cw - 1.1, from: 6, to: 70, side: -1, chance: 0.6 });
        traffic(g, { axis: 'x', center: zc, cw, from: -40, to: 40, n: g.n(lanes > 2 ? 5 : 3), lanes, laneW });
        for (let x = -60 + g.rng.range(0, 10); x < 60; x += g.rng.range(17, 22)) {
          lamp(g, x, zc + cw + 0.45, { style: v === 2 ? 'doppio' : 'classico', height: v === 2 ? 7.5 : 4.5 });
          if (v === 2) lamp(g, x + 9, zc - cw - 0.45, { style: 'doppio', height: 7.5, yaw: PI });
        }
        furnish(g, { axis: 'x', line: far + 0.9, from: -30, to: 30, yaw: 0, n: g.n(6) });
        if (v === 2 || g.want('alberi')) { streetTrees(g, { axis: 'x', line: far + walkW - 0.9, from: -60, to: 60 }); }
        if (night(g) || g.want('neon')) neonSigns(g, { axis: 'x', line: far, from: -24, to: 24, side: 1, n: g.n(3, 1), y: 3.4 });
      }
      farCity(g, { count: g.n(150, 60), rMin: 110, rMax: 520, hMin: 20, hMax: 110 });
    },
  },
  {
    id: 'incrocio', label: 'Incrocio con grattacieli', group: 'citta', variants: 2,
    tags: ['incrocio', 'grattacieli', 'metropoli', 'semaforo', 'new york', 'downtown', 'città', 'traffico', 'skyline'],
    thumb: { sky: ['#6aa4dc', '#d7e7f3'], ground: '#5f5e5a', sil: 'towers' },
    times: { alba: 1, mattino: 2, mezzogiorno: 2, tramonto: 2, sera: 1.5, notte: 1.5 },
    build(g) {
      cityTerrain(g, { hills: 6 });
      const lanes = g.spec.variant === 1 ? 4 : 2, laneW = 3.25, walkW = 3, cw = lanes * laneW / 2, size = cw * 2 + walkW * 2 + 4;
      const cx = -(cw + walkW / 2), cz = -(cw + walkW / 2) - 1.5;
      g.add('es_incrocio', { pos: [cx, cz], params: { size, lanes, laneW, walkW, crossing: true, details: true, seed: g.rng.seedInt() }, terrain: false, y: 0 });
      for (let k = 0; k < 4; k++) {
        const dx = [0, 0, 1, -1][k], dz = [1, -1, 0, 0][k];
        for (let s = 0; s < 3; s++) {
          const d = size / 2 + 20 + s * 40;
          g.add('es_strada', { pos: [cx + dx * d, cz + dz * d], yaw: dx ? H : 0, params: { length: 40, lanes, laneW, walkW, walk: 'entrambi', details: true, seed: g.rng.seedInt() }, terrain: false, y: 0 });
        }
      }
      const corner = cw + walkW + 2;
      const towers = ['ed_grattacielo', 'ed_gradoni', 'ed_twist', 'ed_artdeco', 'ed_grattacielo', 'ed_condominio'];
      const spots = [[-1, -1, 0], [1, -1, 0], [-1, 1, H]];
      for (const [sx, sz, face] of spots) {
        const type = g.rng.pick(towers);
        const t = TYPE_BY_ID.get(type);
        const W = t ? Math.min(t.params.find((p) => p.id === 'width')?.max || 40, g.rng.range(26, 36)) : 30;
        const D = W * g.rng.range(0.8, 1.1);
        const x = cx + sx * (corner + W / 2), z = cz + sz * (corner + D / 2);
        g.add(type, { pos: [x, z], yaw: face, terrain: false, y: 0, params: { width: W, depth: D, floors: g.rng.int(30, 70), night: night(g), seed: g.rng.seedInt(), spire: g.rng.chance(0.4) } });
        g.occupyRect(x, z, W / 2, D / 2);
      }
      // towers further down the avenues
      for (let i = 0; i < g.n(6, 3); i++) {
        const along = g.rng.range(55, 160), type = g.rng.pick(towers), W = g.rng.range(24, 34), which = g.rng.int(0, 2);
        const x = which === 0 ? cx + g.rng.sign() * (corner + W / 2) : cx + (which === 1 ? -1 : 1) * along;
        const z = which === 0 ? cz - along : cz - (corner + W / 2);
        g.add(type, { pos: [x, z], yaw: 0, terrain: false, y: 0, r: W * 0.6, free: { corridor: false }, params: { width: W, depth: W, floors: g.rng.int(25, 75), night: night(g), seed: g.rng.seedInt() } });
      }
      for (let k = 0; k < 4; k++) {
        const sx = k & 1 ? 1 : -1, sz = k & 2 ? 1 : -1;
        if (sx > 0 && sz > 0) continue; // the characters' corner: no pole in front of the lens
        g.add('es_semaforo', { pos: [cx + sx * (cw + 0.6), cz + sz * (cw + 0.6)], yaw: Math.atan2(-sx, -sz) + PI, params: { light: g.rng.pick(['rosso', 'verde', 'giallo']), kind: lanes > 2 ? 'sbraccio' : 'palo' }, r: 0.4 });
      }
      traffic(g, { axis: 'x', center: cz, cw, from: cx - 80, to: cx - size / 2 - 3, n: g.n(3), lanes, laneW });
      traffic(g, { axis: 'z', center: cx, cw, from: cz - 90, to: cz - size / 2 - 3, n: g.n(4), lanes, laneW });
      for (const s of [-1, 1]) for (let d = size / 2 + 8; d < 100; d += 22) { lamp(g, cx + s * (cw + 0.5), cz - d, { style: 'stradale', height: 9, yaw: s > 0 ? -H : H }); }
      g.add('es_edicola', { pos: [cx - corner - 1, cz + corner + 2], yaw: PI / 4, r: 2 });
      furnish(g, { axis: 'z', line: cx + cw + walkW - 0.7, from: cz - 60, to: cz - size / 2 - 2, yaw: -H, n: g.n(4) });
      farCity(g, { count: g.n(220, 90), rMin: 120, rMax: 560, hMin: 50, hMax: 220, wide: [18, 42], facade: '#a9b4bf' });
    },
  },
  {
    id: 'vicolo', label: 'Vicolo notturno', group: 'citta', variants: 2,
    tags: ['vicolo', 'notte', 'neon', 'noir', 'cyberpunk', 'stretto', 'callejon', 'città', 'pioggia'],
    thumb: { sky: ['#0c1022', '#2a2f52'], ground: '#2b2c30', sil: 'alley', neon: true },
    times: { alba: 0.2, mattino: 0.3, mezzogiorno: 0.2, tramonto: 0.5, sera: 3, notte: 6 },
    weathers: { sereno: 2, nuvoloso: 2, pioggia: 4, neve: 0.4, nebbia: 1.5 },
    build(g) {
      cityTerrain(g, { hills: 0, base: '#4a4946', alt: '#55534f' });
      const W = g.rng.range(4.2, 6.5);
      g.camDist = 5;
      g.add('es_piazza', { pos: [0, -12], params: { width: W + 0.4, depth: 40, pave: g.rng.pick(['porfido', 'lastre']) }, terrain: false, y: 0 });
      g.add('es_piazza', { pos: [0, -52], params: { width: W + 0.4, depth: 40, pave: 'porfido' }, terrain: false, y: 0 });
      const types = ['ed_storico', 'ed_palazzina', 'ed_negozio', 'ed_storico', 'ed_artdeco'];
      for (const side of [-1, 1]) {
        let z = 12;
        while (z > -75) {
          const type = g.rng.pick(types), w = g.rng.range(15, 24), d = g.rng.range(12, 18);
          g.add(type, { pos: [side * (W / 2 + 0.05), z - w / 2], yaw: side > 0 ? -H : H, fit: { front: true }, terrain: false, y: 0,
            params: { width: w, depth: d, floors: g.rng.int(type === 'ed_negozio' ? 2 : 4, type === 'ed_artdeco' ? 14 : 7), night: night(g), wear: g.rng.pick(['1', '2', '1']), seed: g.rng.seedInt(), shops: g.rng.chance(0.4) } });
          z -= w + g.rng.range(0, 0.4);
        }
      }
      // end of the alley: a lit cross street far away
      g.add('ed_storico', { pos: [0, -78], yaw: 0, fit: { front: true }, terrain: false, y: 0, params: { width: 26, depth: 14, floors: 6, night: night(g), seed: g.rng.seedInt() } });
      neonSigns(g, { axis: 'z', line: W / 2 - 0.02, from: -40, to: -3, side: 1, n: g.n(3, 2) });
      neonSigns(g, { axis: 'z', line: -W / 2 + 0.02, from: -40, to: -3, side: -1, n: g.n(3, 1) });
      const junk = ['es_cassonetto', 'pila_scatole', 'ph_trashbag', 'ph_wooden_crate_01', 'ph_barrel_03', 'scatola', 'ph_plastic_crate_02', 'es_cono', 'es_transenna', 'es_scooter', 'es_bici'];
      for (let i = 0; i < g.n(12, 5); i++) {
        const side = g.rng.sign(), type = g.rng.pick(junk);
        g.tryAdd(type, { r: 0.6, yaw: side > 0 ? -H : H, color: type === 'es_cassonetto' ? g.rng.pick(['#2f6b3a', '#3a3d40', '#1f3a6b']) : null, free: { corridor: false } },
          () => [side * (W / 2 - g.rng.range(0.5, 1.1)), g.rng.range(-45, 1)], 6);
      }
      for (let z = -4; z > -60; z -= g.rng.range(9, 14)) {
        const side = g.rng.sign();
        if (g.add('ph_industrial_wall_lamp', { pos: [side * (W / 2 - 0.15), z], y: 3.2, yaw: side > 0 ? -H : H, terrain: false })) g.items[g.items.length - 1].lamp = { y: 0.2, kelvin: 2600 };
      }
      if (g.rng.chance(0.5) || g.want('animali', 'gatto')) g.animal('gatto', { pos: [g.rng.range(-W / 2 + 0.6, W / 2 - 0.6), g.rng.range(-8, -3)], r: 0.4, free: { corridor: false } });
      g.fogScale = 1.6;
    },
  },
  {
    id: 'tetto', label: 'Tetto di un grattacielo', group: 'citta', variants: 2,
    tags: ['tetto', 'grattacielo', 'terrazza', 'rooftop', 'skyline', 'in alto', 'supereroe', 'città'],
    thumb: { sky: ['#5d8dd0', '#f0c9a0'], ground: '#9c978e', sil: 'roof' },
    times: { alba: 1.5, mattino: 1, mezzogiorno: 1, tramonto: 3, sera: 2, notte: 2.5 },
    build(g) {
      const drop = g.rng.range(70, 140);
      g.flatStage = false;
      const seed = g.rng.seedInt();
      const hills = relief(seed, { stageR: 0, hills: { amp: 30, scale: 200, start: 500, ramp: 300 } });
      g.terrain = { height: (x, z) => -drop + hills(x, z), color: biome(seed, { base: '#6c6a65', alt: '#7a776f', snowCover: g.atm.snowCover * 0.6, stageR: 0 }), roughness: g.atm.wet ? 0.45 : 0.95 };
      const W = g.rng.range(16, 26), D = g.rng.range(14, 22);
      g.add('ls_tetto', { pos: [g.rng.range(-2, 2), -D / 2 + 3.5], terrain: false, y: 0, params: { width: W, depth: D, drop, parapet: g.rng.range(0.6, 1.15), tank: g.rng.chance(0.7), hvac: true, exit: true, antenna: g.rng.chance(0.5), night: night(g), seed: g.rng.seedInt() } });
      g.occupyRect(0, -D / 2 + 3.5, W / 2 + 1, D / 2 + 1);
      g.decks.push({ x: 0, z: -D / 2 + 3.5, hx: W / 2, hz: D / 2, yaw: 0, y: 0 });
      // neighbour towers (some taller than ours)
      const towers = ['ed_grattacielo', 'ed_gradoni', 'ed_twist', 'ed_artdeco', 'ed_condominio'];
      for (let i = 0; i < g.n(9, 5); i++) {
        const type = g.rng.pick(towers), Wt = g.rng.range(22, 36);
        const [x, z] = g.around(40, 140, 120);
        const floors = Math.round((drop + g.rng.range(-35, 70)) / 3.7);
        g.add(type, { pos: [x, z], yaw: g.rng.pick([0, H, -H]), terrain: false, y: -drop, r: Wt * 0.7, free: { corridor: false }, params: { width: Wt, depth: Wt * g.rng.range(0.8, 1.1), floors: Math.max(12, floors), night: night(g), seed: g.rng.seedInt() } });
      }
      farCity(g, { count: g.n(260, 120), rMin: 70, rMax: 650, hMin: 25, hMax: 150, wide: [18, 40] });
      // rooftop details
      const det = ['phc_utility_box_01', 'phc_utility_box_02', 'ph_plastic_monobloc_chair_01', 'ph_barrel_03', 'ph_old_military_crate', 'es_transenna', 'ph_cardboard_box_01'];
      for (let i = 0; i < g.n(5, 2); i++) g.tryAdd(g.rng.pick(det), { r: 0.7, terrain: false, y: 0, free: { corridor: true } }, () => [g.rng.range(-W / 2 + 1.5, W / 2 - 1.5), g.rng.range(-D + 5, 2.5), g.rng.range(-PI, PI)], 8);
      if (g.rng.chance(0.4)) g.add('es_palo', { pos: [W / 2 - 1.5, -D + 5.5], terrain: false, y: 0, params: { style: 'bandiera', height: 5 }, r: 0.3 });
      g.fogScale = 0.8;
      g.view = { el: 4, focal: 30 };
    },
  },
  {
    id: 'piazza', label: 'Piazza europea', group: 'citta', variants: 2,
    tags: ['piazza', 'fontana', 'chiesa', 'europa', 'centro storico', 'italia', 'paese', 'città', 'bar'],
    thumb: { sky: ['#86b4e0', '#efe2c8'], ground: '#a89c8a', sil: 'square' },
    build(g) {
      cityTerrain(g, { hills: 14, base: '#8f877a', alt: '#9a9183' });
      const PW = g.rng.range(30, 40), PD = g.rng.range(30, 40), cz = -PD / 2 + 7;
      g.add('es_piazza', { pos: [0, cz], params: { width: PW, depth: PD, pave: g.rng.pick(['porfido', 'lastre']) }, terrain: false, y: 0 });
      const fz = cz - g.rng.range(2, 6), fx = g.rng.range(-5, 5);
      g.add('ls_fontana', { pos: [fx, fz], terrain: false, y: 0, params: { style: g.rng.pick(['classica', 'classica', 'vasca', 'moderna']), size: g.rng.range(4.5, 7.5), water: g.atm.weather !== 'neve' }, r: 4 });
      // back: church or palace
      const back = cz - PD / 2;
      if (g.spec.variant === 0) g.add('ed_chiesa', { pos: [g.rng.range(-6, 6), back], fit: { front: true }, terrain: false, y: 0, params: { variant: g.rng.pick(['romanica', 'classica', 'gotica']), width: g.rng.range(14, 20), depth: g.rng.range(26, 40), tower: true, towerHeight: g.rng.range(26, 44), seed: g.rng.seedInt() } });
      else g.add('ed_storico', { pos: [0, back], fit: { front: true }, terrain: false, y: 0, params: { variant: g.rng.pick(['neo', 'liberty', 'parigi']), width: Math.min(36, PW), depth: 16, floors: g.rng.int(4, 6), night: night(g), seed: g.rng.seedInt() } });
      for (const s of [-1, 1]) {
        let z = cz + PD / 2;
        while (z > back - 2) {
          const type = g.rng.chance(0.25) ? 'ed_bar' : g.rng.pick(['ed_storico', 'ed_storico', 'ed_negozio']), w = g.rng.range(12, 20);
          g.add(type, { pos: [s * PW / 2, z - w / 2], yaw: s > 0 ? -H : H, fit: { front: true }, terrain: false, y: 0,
            params: { variant: type === 'ed_storico' ? g.rng.pick(['neo', 'liberty', 'parigi']) : undefined, width: w, depth: 14, floors: g.rng.int(3, 5), night: night(g), shops: g.rng.chance(0.5), seed: g.rng.seedInt(), dehors: true } });
          z -= w;
        }
      }
      for (let i = 0; i < g.n(6, 3); i++) {
        const a = (i / 6) * PI * 2;
        lamp(g, fx + Math.cos(a) * 8, fz + Math.sin(a) * 8, { style: 'classico', height: 4.2 });
      }
      for (let i = 0; i < g.n(4, 2); i++) g.tryAdd('es_panchina', { r: 1, params: { style: 'classica' } }, () => { const a = g.rng.range(0, PI * 2); return [fx + Math.cos(a) * 6.5, fz + Math.sin(a) * 6.5, -a - H]; });
      for (let i = 0; i < g.n(4, 2); i++) g.tryAdd('es_vaso_albero', { r: 0.8, params: { plant: g.rng.pick(['albero', 'sfera', 'conifera']), seed: g.rng.seedInt() } }, () => [g.rng.range(-PW / 2 + 2, PW / 2 - 2), g.rng.range(cz - PD / 2 + 2, cz + PD / 2 - 2)]);
      if (g.rng.chance(0.7) || g.want('animali', 'piccioni')) for (let i = 0; i < g.n(5, 2); i++) g.animal('piccione', { pos: [fx + g.rng.range(-5, 5), fz + g.rng.range(4, 7)], r: 0.25, free: { corridor: false } });
      farCity(g, { count: g.n(120, 50), rMin: 90, rMax: 420, hMin: 10, hMax: 28, wide: [12, 24], facade: '#d9c7a8' });
      g.scatterOf('cypress', { count: g.n(40), rMin: 90, rMax: 400, size: [9, 14], colors: ['#ffffff'], look: { leaf: '#3f5a35' }, farR: 120 });
    },
  },
  {
    id: 'residenziale', label: 'Quartiere residenziale', group: 'citta', variants: 2,
    tags: ['quartiere', 'residenziale', 'villette', 'case', 'periferia', 'sobborgo', 'giardini', 'suburbia'],
    thumb: { sky: ['#8ab9e6', '#e3eef6'], ground: '#6a8c3d', sil: 'houses' },
    build(g) {
      const S = g.atm.foliage;
      cityTerrain(g, { hills: 22, base: S.grass, alt: '#7a7a62', flatR: 160 });
      const lanes = 2, laneW = 3.0, walkW = 2.2, cw = lanes * laneW / 2, zc = -(cw + walkW / 2);
      road(g, { axis: 'x', cz: zc, length: 160, lanes, laneW, walkW, center: 'nessuna' });
      const far = zc - cw - walkW;
      let x = -70;
      const houses = g.spec.variant === 1 ? ['ed_schiera'] : ['ed_villetta', 'ed_villetta', 'ed_schiera'];
      while (x < 70) {
        const type = g.rng.pick(houses), w = type === 'ed_schiera' ? g.rng.range(22, 34) : g.rng.range(11, 16), setback = g.rng.range(4, 7);
        g.add(type, { pos: [x + w / 2, far - setback], fit: { front: true }, terrain: false, y: 0, params: { width: w, units: g.rng.int(3, 5), floors: g.rng.int(1, 3), night: night(g), seed: g.rng.seedInt(), gardens: true } });
        g.add('es_siepe', { pos: [x + w / 2, far - 0.6], params: { length: w - 3, height: g.rng.range(0.8, 1.4), seed: g.rng.seedInt() }, terrain: false, y: 0 });
        if (g.rng.chance(0.5)) { const tr = seasonTree(g); g.add(tr.type, { pos: [x + g.rng.range(1, w - 1), far - setback * 0.5], params: { ...tr.params, height: g.rng.range(5, 9) }, color: tr.color, sink: 0.04 }); }
        x += w + g.rng.range(2, 5);
      }
      parkedCars(g, { axis: 'x', line: zc - cw + 1.0, from: -60, to: 60, side: 1, chance: 0.5 });
      for (let xx = -50 + g.rng.range(0, 8); xx < 50; xx += g.rng.range(18, 26)) lamp(g, xx, zc + cw + 0.4, { style: 'classico', height: 4.2 });
      for (const k of ['es_cassonetto', 'es_cassonetto', 'es_cassetta', 'es_idrante', 'es_bici']) g.tryAdd(k, { r: 0.6, yaw: 0, color: k === 'es_cassonetto' ? g.rng.pick(['#2f6b3a', '#e2b21e', '#1f3a6b']) : null, free: { corridor: false } }, () => [g.rng.range(-24, 24), far + 0.7], 6);
      if (g.rng.chance(0.45) || g.want('animali', 'cane')) g.animal(g.rng.pick(['cane_medio', 'cane_piccolo', 'gatto']), { pos: [g.rng.range(-3, 3) + g.rng.sign() * 2.5, g.rng.range(0, 1.5)], r: 0.5, free: { corridor: false } });
      forest(g, { mix: 'latifoglie', count: g.n(160), rMin: 70, rMax: 500, farR: 110 });
      farCity(g, { count: g.n(80, 30), rMin: 80, rMax: 400, hMin: 6, hMax: 12, wide: [10, 16], facade: '#e7dccb' });
    },
  },
  {
    id: 'parcheggio', label: 'Parcheggio', group: 'citta', variants: 2,
    tags: ['parcheggio', 'auto', 'supermercato', 'centro commerciale', 'macchine', 'periferia'],
    thumb: { sky: ['#8ab3dd', '#e8eef3'], ground: '#5d5c59', sil: 'parking' },
    build(g) {
      cityTerrain(g, { hills: 16 });
      const stalls = g.rng.int(8, 14), rows = 2;
      const t = TYPE_BY_ID.get('es_parcheggio');
      const params = t ? cleanParams(t, { ...defaultParams(t), stalls, rows, lines: g.rng.pick(['bianche', 'blu']) }) : { stalls, rows };
      const L = { W: stalls * 2.5 + 1, D: rows * 5 + 6 + 0.6 };
      const pz = -L.D / 2 - 0.5;
      // the characters stand at the front edge, in the aisle of a second lot behind the camera
      g.add('es_parcheggio', { pos: [0, pz], params, terrain: false, y: 0 });
      g.add('es_parcheggio', { pos: [0, pz - L.D], params: { ...params, disabled: false }, terrain: false, y: 0 });
      for (const [oz, lot] of [[pz, 0], [pz - L.D, 1]]) {
        const slots = t?.slots ? t.slots(params) : [];
        let cars = 0;
        for (const s of g.rng.shuffle([...slots])) if (cars < (lot ? 5 : 9) && g.rng.chance(lot ? 0.45 : 0.7)) {
          cars++;
          const type = g.rng.pick(CARS);
          g.add(type, { pos: [s.x, oz + s.z], yaw: s.yaw + (g.rng.chance(0.5) ? PI : 0) + g.rng.range(-0.05, 0.05), color: type === 'es_taxi' ? null : g.rng.pick(CAR_COLORS), r: 1.2, free: { corridor: true, occ: false } });
        }
      }
      const back = pz - L.D * 1.5 - 4;
      if (g.spec.variant === 0) g.add('ed_negozio', { pos: [g.rng.range(-8, 8), back - 3], fit: { front: true }, terrain: false, y: 0, params: { variant: 'market', sign: 'MARKET', width: 16, depth: 14, floors: 1, night: night(g), seed: g.rng.seedInt() } });
      else g.add('ed_capannone', { pos: [g.rng.range(-10, 10), back - 3], fit: { front: true }, terrain: false, y: 0, params: { width: g.rng.range(36, 60), depth: 24, office: true, night: night(g), seed: g.rng.seedInt() } });
      for (let x = -L.W / 2; x <= L.W / 2 + 1; x += L.W / 2) lamp(g, x, pz - L.D / 2 - 0.2, { style: 'stradale', height: 8 });
      for (let i = 0; i < 4; i++) { const tr = seasonTree(g); g.add(tr.type, { pos: [g.rng.sign() * (L.W / 2 + g.rng.range(3, 8)), g.rng.range(back, -2)], params: { ...tr.params, height: g.rng.range(6, 10) }, color: tr.color, r: 2, sink: 0.04 }); }
      forest(g, { mix: 'latifoglie', count: g.n(120), rMin: 60, rMax: 400 });
      farCity(g, { count: g.n(90, 40), rMin: 90, rMax: 460, hMin: 12, hMax: 60 });
    },
  },
  {
    id: 'porto', label: 'Porto', group: 'citta', variants: 2,
    tags: ['porto', 'mare', 'barche', 'molo', 'banchina', 'container', 'navi', 'faro', 'pescatori'],
    thumb: { sky: ['#7fb3e3', '#e7eef2'], ground: '#76736c', sil: 'harbor', water: '#3f6f80' },
    build(g) {
      const seed = g.rng.seedInt(), shore = -g.rng.range(7, 10), level = -1.3;
      g.terrain = {
        height: relief(seed, { stageR: 0, coast: { z: shore, depth: 6, slope: 2.2, wave: 0, landRamp: 8 }, hills: { amp: 25, scale: 140, start: 120, ramp: 200 } }),
        color: biome(seed, { base: '#7b7972', alt: '#86837a', rock: '#6f6a62', rockSlope: 0.3, water: level, mud: true, beach: 0.6, snowCover: g.atm.snowCover * 0.7, stageR: 4 }),
        roughness: g.atm.wet ? 0.45 : 0.95,
        water: { level, color: g.atm.night ? '#14202c' : '#365f6e', roughness: 0.06 },
      };
      // pier, boats, bollards along the quay edge
      const px = g.rng.range(4, 9) * g.rng.sign();
      const mw = g.rng.range(2.4, 3.4);
      g.add('ls_molo', { pos: [px, shore - 12], yaw: H, terrain: false, y: -0.1, params: { length: 26, width: mw, bollards: true } });
      g.decks.push({ x: px, z: shore - 12, hx: mw / 2, hz: 13, yaw: 0, y: 0.38 });
      const kinds = ['pesca', 'vela', 'remi', 'pesca', 'vela'];
      for (let i = 0; i < g.n(5, 2); i++) {
        const k = g.rng.pick(kinds), L = k === 'remi' ? 4 : g.rng.range(7, 11);
        const x = px + g.rng.sign() * g.rng.range(3, 6), z = shore - g.rng.range(6, 24);
        g.add('ls_barca', { pos: [x, z], yaw: H + g.rng.range(-0.25, 0.25), terrain: false, y: level, params: { kind: k, length: L }, color: g.rng.pick(['#2f5a8a', '#b3261e', '#f2f1ec', '#2f6b3a', '#e2b21e']), r: L * 0.45, free: { corridor: false } });
      }
      for (let i = 0; i < g.n(3, 1); i++) g.add('ls_barca', { pos: [g.rng.range(-80, 80), shore - g.rng.range(40, 140)], yaw: g.rng.range(-PI, PI), terrain: false, y: level, params: { kind: g.rng.pick(['vela', 'pesca']), length: g.rng.range(8, 12) }, color: '#f2f1ec', r: 5 });
      // (not on the pier's landing: same random sequence, the skipped spot draws nothing)
      for (let x = -30; x <= 30; x += g.rng.range(5, 8)) if (Math.abs(x - px) > mw / 2 + 0.6) g.add('es_dissuasori', { pos: [x, shore + 0.6], params: { style: 'cemento', count: 1 }, r: 0.3, free: { corridor: false } });
      // containers, crane, warehouse on one side
      const side = -Math.sign(px) || 1;
      const cols = ['#b3261e', '#2f5a8a', '#2f6b3a', '#d98a1c', '#6b6f75', '#7a2f6b'];
      for (let i = 0; i < g.n(8, 4); i++) {
        const stack = g.rng.int(1, 3), x = side * g.rng.range(14, 34), z = g.rng.range(shore + 4, 18), yaw = g.rng.chance(0.7) ? 0 : H;
        if (!g.isFree(x, z, 3.5)) continue;
        g.occupy(x, z, 3.5);
        for (let s = 0; s < stack; s++) g.add('ls_container', { pos: [x, z], y: s * 2.6, terrain: false, yaw, color: g.rng.pick(cols), params: { size: g.rng.chance(0.6) ? '40' : '20' } });
      }
      if (g.spec.variant === 0) g.add('ls_gru', { pos: [side * g.rng.range(22, 30), shore + 6], yaw: H * side, params: { height: g.rng.range(26, 38) }, color: g.rng.pick(['#e0a21c', '#c0392b', '#2f5a8a']), r: 7, free: { corridor: false } });
      g.add('ed_capannone', { pos: [side * g.rng.range(30, 45), g.rng.range(24, 36)], yaw: g.rng.pick([0, PI]), fit: null, terrain: false, y: 0, params: { width: g.rng.range(30, 50), depth: 20, variant: g.rng.pick(['lamiera', 'storico']), night: night(g), seed: g.rng.seedInt() }, r: 18, free: { corridor: false } });
      // lighthouse at the end of a breakwater of rocks
      const lx = g.rng.range(-60, 60), lz = shore - g.rng.range(70, 110);
      for (let t = 0; t < 1; t += 0.08) g.add('es_roccia', { pos: [lx * (0.6 + t * 0.4) + side * 8 * (1 - t), shore - 4 + (lz - shore + 4) * t], terrain: false, y: level - 0.8, params: { size: g.rng.range(2.5, 4), shape: 'masso', count: 3, seed: g.rng.seedInt() } });
      g.add('ed_faro', { pos: [lx, lz], terrain: false, y: level + 1.2, params: { variant: g.rng.pick(['strisce', 'bianco', 'pietra']), height: g.rng.range(18, 28), house: false, night: night(g), seed: g.rng.seedInt() } });
      for (const x of [-12, 0, 12]) lamp(g, x + g.rng.range(-2, 2), shore + 2.5, { style: g.rng.pick(['classico', 'moderno']), height: 5 });
      const props = ['ph_wooden_crate_01', 'ph_wooden_crate_02', 'ph_barrel_03', 'ph_wine_barrel_01', 'ph_old_military_crate', 'phc_old_tyre'];
      for (let i = 0; i < g.n(7, 3); i++) g.tryAdd(g.rng.pick(props), { r: 0.6, free: { corridor: false } }, () => [g.rng.range(-14, 14), g.rng.range(shore + 1.5, shore + 6), g.rng.range(-PI, PI)], 8);
      farCity(g, { count: g.n(70, 30), rMin: 90, rMax: 420, hMin: 10, hMax: 40, arc: 70, a0: 180 });
      for (const it of g.scatter[g.scatter.length - 1]?.items || []) if (it.z < shore - 5) it.y = -100;
      const ent = g.scatter[g.scatter.length - 1];
      if (ent) ent.items = ent.items.filter((it) => it.y > -50);
      g.view = { el: 6 };
    },
  },
];
