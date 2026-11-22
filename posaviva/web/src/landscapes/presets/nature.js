// Nature presets: wood, pine forest, mountain, desert, beach, countryside farm,
// lake, flower meadow, jungle.
import { natureTerrain, seasonTree, forest, PI, H, mixHex } from '../gen/common.js';

const night = (g) => g.atm.night || g.atm.dusk;

/** Hero trees around the stage (editable props). */
function heroTrees(g, { n, rMin = 9, rMax = 30, kind = 'any', arc = 118, height = [8, 14], open = 24 }) {
  for (let i = 0; i < n; i++) {
    const tr = seasonTree(g, kind);
    g.tryAdd(tr.type, { params: { ...tr.params, height: g.rng.range(height[0], height[1]) }, color: tr.color, r: 2.2, sink: 0.05 }, () => g.aroundOpen(rMin, rMax, arc, open), 10);
  }
}

function rocks(g, n, { rMin = 4, rMax = 22, arc = 160, moss = false, big = false } = {}) {
  const models = ['phc_namaqualand_boulder_02', 'phc_namaqualand_boulder_04', 'phc_namaqualand_boulder_05', 'phc_boulder_01', 'phc_namaqualand_boulder_06'];
  for (let i = 0; i < n; i++) {
    if (g.rng.chance(0.45)) g.tryAdd(g.rng.pick(models), { r: 1.4, sink: 0.15 }, () => g.around(rMin, rMax, arc), 8);
    else g.tryAdd('es_roccia', { r: 1.2, sink: 0.1, params: { size: g.rng.range(0.5, big ? 3 : 1.6), shape: g.rng.pick(['masso', 'masso', 'lastra', 'appuntita', 'ciottolo']), count: g.rng.int(1, 4), moss, seed: g.rng.seedInt() } }, () => g.around(rMin, rMax, arc), 8);
  }
}

function bushes(g, n, { rMin = 3.5, rMax = 18, flowers = 0.2 } = {}) {
  for (let i = 0; i < n; i++) g.tryAdd('es_cespuglio', { r: 0.9, color: g.spec.season === 'autunno' ? '#9a7a35' : null, params: { size: g.rng.range(0.7, 1.6), flowers: g.rng.chance(flowers * g.atm.foliage.flowers * 2), fcolor: g.rng.pick(['misto', 'rosso', 'rosa', 'bianco', 'giallo']), seed: g.rng.seedInt() } }, () => g.around(rMin, rMax, 165), 8);
}

function grassPatches(g, n, { flowers = false, rMin = 2.5, rMax = 14, size = [3, 7] } = {}) {
  for (let i = 0; i < n; i++) {
    const [x, z] = g.around(rMin, rMax, 170);
    if (!g.isFree(x, z, 1.2, { stage: false, occ: false })) continue;
    g.add('es_prato', { pos: [x, z], params: { width: g.rng.range(size[0], size[1]), depth: g.rng.range(size[0], size[1]) * 0.7, bladeH: g.rng.range(0.12, 0.35), density: g.rng.pick(['media', 'alta']), shape: 'ovale', flowers: flowers && g.atm.foliage.flowers > 0.3, seed: g.rng.seedInt() }, color: g.spec.season === 'autunno' ? '#8f8a45' : g.spec.season === 'inverno' ? '#7c8463' : null });
  }
}

function wildlife(g, list, chance = 0.45, max = 2) {
  if (!(g.rng.chance(chance) || g.want('animali'))) return;
  const n = g.rng.int(1, max);
  for (let i = 0; i < n; i++) {
    const sp = g.rng.pick(list);
    g.animal(sp, { pos: g.around(6, 14, 120).slice(0, 2), r: 1.2 });
  }
}

/** A path from the stage into the background. */
function path(g, { surface = 'terra', width = 1.6 } = {}) {
  const bend = g.rng.range(-40, 40);
  g.add('es_vialetto', { pos: [g.rng.range(-1.5, 1.5), -9], yaw: 0, params: { length: 16, width, bend, surface, edging: false } });
  g.add('es_vialetto', { pos: [g.rng.range(-6, 6), -24], yaw: g.rng.range(-0.3, 0.3), params: { length: 16, width: width * 0.9, bend: -bend * 0.7, surface, edging: false } });
}

export const NATURE = [
  {
    id: 'bosco', label: 'Bosco', group: 'natura', variants: 3,
    tags: ['bosco', 'foresta', 'alberi', 'sentiero', 'querce', 'natura', 'selva', 'radura'],
    thumb: { sky: ['#8cbbe0', '#e4efe0'], ground: '#5f7f3a', sil: 'forest' },
    build(g) {
      const v = g.spec.variant;
      natureTerrain(g, { undul: 1.2, relief: { hills: { amp: g.rng.range(15, 35), scale: 110, start: 50, ramp: 120 } }, dirtAmt: 0.35 });
      if (v !== 1) path(g, { surface: 'terra' });
      heroTrees(g, { n: g.n(v === 1 ? 8 : 12, 5), rMin: v === 1 ? 13 : 8, rMax: 32 });
      bushes(g, g.n(7, 3));
      rocks(g, g.n(4, 1), { moss: true });
      for (let i = 0; i < g.n(3, 1); i++) g.tryAdd(g.rng.chance(0.5) ? 'es_tronco' : 'phc_dead_tree_trunk_02', { r: 1.6, params: { kind: g.rng.pick(['tronco', 'ceppo', 'tronco']), length: g.rng.range(2, 4), diameter: g.rng.range(0.3, 0.55), seed: g.rng.seedInt() }, sink: 0.04 }, () => g.around(4, 16, 160));
      for (let i = 0; i < g.n(5, 2); i++) g.tryAdd('ls_felce', { r: 0.6, params: { height: g.rng.range(0.5, 1), seed: g.rng.seedInt() } }, () => g.around(3.5, 12, 170));
      grassPatches(g, g.n(3, 1), { flowers: v === 1 });
      if (night(g) && (g.rng.chance(0.5) || g.want('fuoco', 'falo'))) { const [x, z] = g.around(3.5, 5, 60); if (g.add('ls_falo', { pos: [x, z], params: { lit: true, seed: g.rng.seedInt() }, r: 1 })) g.items[g.items.length - 1].lamp = { y: 0.6, kelvin: 1900, intensity: 1.6, name: 'Falò' }; }
      wildlife(g, ['cervo', 'volpe', 'coniglio', 'cinghiale', 'cervo']);
      forest(g, { mix: v === 2 ? 'misto' : 'latifoglie', count: g.n(520, 200), rMin: v === 1 ? 32 : 22, rMax: 520, minSep: 3.2, farR: 75 });
      g.scatterOf('bush', { count: g.n(140, 50), rMin: 16, rMax: 140, size: [1, 2.4], colors: g.atm.foliage.leaf, look: { leaf: '#ffffff', snow: g.atm.snowCover }, farR: 60, minSep: 2 });
    },
  },
  {
    id: 'pineta', label: 'Foresta di pini', group: 'natura', variants: 2,
    tags: ['pineta', 'pini', 'abeti', 'conifere', 'foresta', 'taiga', 'montagna', 'nebbia', 'bosco'],
    thumb: { sky: ['#9fb9cc', '#e1e8ea'], ground: '#5b5a3e', sil: 'pines' },
    weathers: { sereno: 3, nuvoloso: 2, pioggia: 1, neve: 1.2, nebbia: 2 },
    build(g) {
      natureTerrain(g, { base: '#6b6342', alt: '#5a6a3a', dirt: '#5b4632', dirtAmt: 0.5, undul: 1.4, relief: { hills: { amp: 30, scale: 120, start: 45, ramp: 120 }, mountains: { amp: g.rng.range(140, 260), start: 260, scale: 300, sharp: 0.75, back: 0.6 } }, snowLine: 160, rockSlope: 0.45, snowK: 1 });
      path(g, { surface: 'terra', width: 1.4 });
      heroTrees(g, { n: g.n(13, 6), kind: 'conifer', rMin: 7, rMax: 32, height: [12, 22] });
      rocks(g, g.n(4, 2), { moss: g.spec.season !== 'inverno' });
      for (let i = 0; i < g.n(4, 1); i++) g.tryAdd('phc_tree_stump_02', { r: 1, sink: 0.03 }, () => g.around(4, 14, 160));
      for (let i = 0; i < g.n(4, 1); i++) g.tryAdd('ls_felce', { r: 0.6, params: { height: g.rng.range(0.4, 0.8), seed: g.rng.seedInt() } }, () => g.around(3.5, 10, 170));
      if (night(g) || g.want('fuoco', 'falo', 'campeggio')) { const [x, z] = g.around(3.5, 5, 60); if (g.add('ls_falo', { pos: [x, z], params: { lit: true, seed: g.rng.seedInt() }, r: 1 })) g.items[g.items.length - 1].lamp = { y: 0.6, kelvin: 1900, intensity: 1.7, name: 'Falò' }; }
      wildlife(g, ['orso', 'lupo', 'cervo', 'volpe'], 0.35, 1);
      forest(g, { mix: 'conifere', count: g.n(650, 260), rMin: 22, rMax: 560, minSep: 3, size: [9, 17], farR: 75 });
      g.fogScale = 1.3;
    },
  },
  {
    id: 'montagna', label: 'Montagna', group: 'natura', variants: 3,
    tags: ['montagna', 'alpi', 'vette', 'neve', 'rocce', 'baita', 'alpeggio', 'picchi', 'valle'],
    thumb: { sky: ['#6fa7df', '#e2edf6'], ground: '#6e8a45', sil: 'mountains' },
    build(g) {
      const v = g.spec.variant, winter = g.spec.season === 'inverno';
      natureTerrain(g, {
        undul: 1.8, dirtAmt: 0.2, rockSlope: 0.32, snowLine: winter ? 25 : g.rng.range(120, 190), rock: '#7f7b74', snowK: 1,
        relief: { hills: { amp: 22, scale: 70, start: 25, ramp: 70 }, mountains: { amp: g.rng.range(280, 480), start: 110, ramp: 220, scale: g.rng.range(220, 320), sharp: 0.85, back: v === 2 ? 0.2 : 0.65 } },
      });
      if (v === 1) g.add('ed_baita', { pos: [g.rng.sign() * g.rng.range(9, 14), -g.rng.range(14, 20)], yaw: g.rng.range(-0.4, 0.4), fit: { front: true }, params: { variant: g.rng.pick(['tronchi', 'assi']), floors: g.rng.int(1, 2), width: g.rng.range(8, 11), depth: g.rng.range(7, 9), night: night(g), seed: g.rng.seedInt() }, r: 7 });
      const faces = ['phc_rock_face_01', 'phc_rock_face_02', 'phc_mountainside', 'phc_namaqualand_cliff_01'];
      for (let i = 0; i < g.n(4, 2); i++) g.tryAdd(g.rng.pick(faces), { r: 3.5, sink: 0.3 }, () => g.around(9, 30, 140), 8);
      rocks(g, g.n(6, 3), { big: true });
      heroTrees(g, { n: g.n(6, 2), kind: 'conifer', rMin: 9, rMax: 30, height: [8, 15] });
      if (g.rng.chance(0.4)) g.add('es_recinzione', { pos: [g.rng.range(-6, 6), -g.rng.range(7, 10)], yaw: g.rng.range(-0.3, 0.3), params: { style: 'staccionata', length: g.rng.range(6, 10), height: 1 }, r: 0 });
      wildlife(g, ['capra', 'capra', 'mucca', 'aquila', 'cervo', 'lupo'], 0.5, 2);
      const treeLine = (x, z) => g.h(x, z) > (winter ? 60 : 110);
      forest(g, { mix: 'conifere', count: g.n(380, 140), rMin: 30, rMax: 700, minSep: 4, size: [8, 15], farR: 80, avoid: treeLine });
      g.scatterOf('rock', { count: g.n(120, 40), rMin: 12, rMax: 400, size: [1, 5], colors: ['#ffffff', '#e6e1d8', '#d4d0c8'], look: { rock: '#8b877f', snow: g.atm.snowCover }, farR: 70, maxSlope: 1.4 });
      g.view = { el: 3, focal: 32 };
    },
  },
  {
    id: 'deserto', label: 'Deserto', group: 'natura', variants: 3,
    tags: ['deserto', 'sabbia', 'dune', 'cactus', 'west', 'canyon', 'sahara', 'arido', 'mesa'],
    thumb: { sky: ['#8ab8e6', '#f3dfbd'], ground: '#d8b47a', sil: 'desert' },
    weathers: { sereno: 8, nuvoloso: 1.5, pioggia: 0.1, neve: 0.05, nebbia: 0.4 },
    seasons: { primavera: 0.5, estate: 3, autunno: 0.6, inverno: 0.2 },
    build(g) {
      const v = g.spec.variant;
      const sand = v === 0 ? '#d9b57e' : '#c98b55';
      natureTerrain(g, {
        base: sand, alt: mixHex(sand, '#e6c89a', 0.5), dirt: '#b07a4c', rock: v === 0 ? '#b88d62' : '#a5603a', dirtAmt: 0.15, rockSlope: 0.5, undul: 0.4, snowK: 0,
        relief: v === 0 ? { dunes: { amp: g.rng.range(2.5, 6), scale: g.rng.range(18, 30) }, mountains: { amp: g.rng.range(60, 120), start: 260, scale: 260, sharp: 0.3, back: 0.5, plateau: 0.55 } }
          : { undul: 1, hills: { amp: 8, scale: 60, start: 30, ramp: 60 }, mountains: { amp: g.rng.range(90, 170), start: 90, ramp: 120, scale: 160, sharp: 0.25, back: 0.55, plateau: 0.5 } },
      });
      const cacti = v === 0 ? 0.35 : 1;
      for (let i = 0; i < g.n(8, 3) * cacti; i++) {
        const kind = g.rng.pick(['saguaro', 'saguaro', 'barile', 'opunzia']);
        const height = kind === 'saguaro' ? g.rng.range(2.5, 7) : kind === 'barile' ? g.rng.range(0.5, 1.3) : g.rng.range(1, 2.4);
        g.tryAdd('ls_cactus', { r: kind === 'saguaro' ? 1 : 0.8, params: { kind, height, seed: g.rng.seedInt() }, sink: 0.05 }, () => g.around(kind === 'saguaro' ? 7 : 4, 30, 160));
      }
      for (let i = 0; i < g.n(2) * (v === 0 ? 1 : 0.5); i++) g.tryAdd(g.rng.pick(['phc_quiver_tree_01', 'phc_quiver_tree_02']), { r: 1.2 }, () => g.around(6, 24, 150));
      rocks(g, g.n(5, 2), { big: true });
      if (v === 2 || g.want('rovine')) for (let i = 0; i < 2; i++) g.tryAdd('ls_rovina', { r: 4, params: { kind: g.rng.pick(['muro', 'arco', 'colonne']), length: g.rng.range(5, 9), count: 4, seed: g.rng.seedInt() }, color: '#d8c19a' }, () => g.around(12, 26, 120));
      if (g.rng.chance(0.3) || g.want('animali', 'serpente')) g.animal('serpente', { pos: g.around(3.5, 6, 90).slice(0, 2), r: 0.6 });
      g.scatterOf('cactus', { count: g.n(90, 30) * cacti, rMin: 30, rMax: 300, size: [2, 6], colors: ['#ffffff', '#e8eadc'], look: { leaf: '#5f7f3a' }, farR: 80, minSep: 6 });
      g.scatterOf('rock', { count: g.n(140, 50), rMin: 15, rMax: 500, size: [0.8, 4], colors: ['#ffffff', '#f0e2cc'], look: { rock: v === 0 ? '#b99068' : '#a9653e' }, farR: 70 });
      g.view = { el: 3, focal: 32 };
    },
  },
  {
    id: 'spiaggia', label: 'Spiaggia', group: 'natura', variants: 2,
    tags: ['spiaggia', 'mare', 'sabbia', 'palme', 'estate', 'costa', 'ombrellone', 'onde', 'tropicale', 'baia'],
    thumb: { sky: ['#6fb1ea', '#e6f2f8'], ground: '#e3cfa0', sil: 'beach', water: '#3f8ea0' },
    seasons: { primavera: 0.6, estate: 4, autunno: 0.5, inverno: 0.2 },
    weathers: { sereno: 7, nuvoloso: 2, pioggia: 0.6, neve: 0.05, nebbia: 0.5 },
    build(g) {
      const v = g.spec.variant, level = -0.35, shore = -g.rng.range(11, 17);
      natureTerrain(g, {
        base: '#e2cd9c', alt: '#d9c08a', sand: '#c9ae7c', dirtAmt: 0, rockSlope: 0.35, rock: '#8a7f72', water: level, beach: 1.2, snowK: 0,
        relief: { stageR: 0, coast: { z: shore, depth: 4, slope: 16, wave: v === 1 ? 10 : 4, landRamp: 30, bay: v === 1 ? 25 : 0 }, hills: { amp: v === 1 ? 45 : 18, scale: 90, start: 40, ramp: 90 } },
        waterLevel: level, waterColor: g.atm.night ? '#142634' : g.spec.weather === 'sereno' ? '#2f8aa0' : '#4d7480',
      });
      g.terrain.height = ((f) => (x, z) => { const h = f(x, z); return Math.abs(x) < 70 && z > shore - 2 ? Math.min(h, 0.15 + Math.max(0, (z - shore)) * 0.02) : h; })(g.terrain.height);
      for (let i = 0; i < g.n(5, 2); i++) g.tryAdd('es_palma', { r: 1.5, params: { height: g.rng.range(6, 11), seed: g.rng.seedInt() }, sink: 0.05 }, () => { const z = g.rng.range(shore + 3, 2); return [g.rng.sign() * g.rng.range(2.5, Math.max(5, (g.camDist - z) * (i < 2 ? 0.42 : 1.2))), z]; }, 10);
      const summer = g.spec.season === 'estate' && !['pioggia', 'neve'].includes(g.spec.weather) && !night(g);
      if (summer || g.want('ombrelloni')) for (let i = 0; i < g.n(4, 1); i++) {
        const z = g.rng.range(shore + 3, -2), x = g.rng.sign() * g.rng.range(2.5, Math.max(4, (g.camDist - z) * (i < 2 ? 0.45 : 1.1)));
        if (g.add('ls_ombrellone', { pos: [x, z], color: g.rng.pick(['#d8343a', '#2f63b8', '#f2c230', '#2f8a5a', '#ef7aa8']), params: { radius: g.rng.range(0.9, 1.3) }, r: 1.6, free: { corridor: false } })) {
          g.add('ls_lettino', { pos: [x + 0.4, z + 0.6], yaw: g.rng.range(-0.3, 0.3), color: g.rng.pick(['#2f63b8', '#f4f1ea', '#d8343a']), r: 0, terrain: true });
        }
      }
      rocks(g, g.n(3, 1), { rMin: 10, rMax: 30 });
      g.add('ls_barca', { pos: [g.rng.range(-40, 40), shore - g.rng.range(25, 70)], yaw: g.rng.range(-PI, PI), terrain: false, y: level, params: { kind: 'vela', length: g.rng.range(7, 11) }, color: '#f2f1ec' });
      if (g.rng.chance(0.4)) g.add('ls_barca', { pos: [g.rng.sign() * g.rng.range(6, 12), shore + 2.5], yaw: g.rng.range(-PI, PI), terrain: false, y: 0.1, params: { kind: 'remi', length: 4 }, color: g.rng.pick(['#2f5a8a', '#b3261e', '#f2f1ec']), r: 2 });
      g.scatterOf('palm', { count: g.n(70, 25), rMin: 25, rMax: 260, size: [7, 12], colors: ['#ffffff', '#e9f0dc'], look: { leaf: '#4f7a33' }, farR: 80, minH: 0.4, minSep: 4 });
      g.scatterOf('bush', { count: g.n(90, 30), rMin: 20, rMax: 220, size: [1, 3], colors: ['#ffffff'], look: { leaf: '#5d7f3a' }, farR: 70, minH: 1.2 });
      g.view = { el: 4, focal: 32 };
    },
  },
  {
    id: 'fattoria', label: 'Campagna / fattoria', group: 'natura', variants: 2,
    tags: ['campagna', 'fattoria', 'animali', 'mucche', 'cascina', 'fieno', 'colline', 'toscana', 'campi', 'stalla'],
    thumb: { sky: ['#8fbde5', '#eef2e2'], ground: '#87a04a', sil: 'farm' },
    build(g) {
      const S = g.atm.foliage;
      const fieldCols = g.spec.season === 'inverno' ? ['#8a8466', '#7b7a5e', '#9a9070'] : g.spec.season === 'autunno' ? ['#9b7d4a', '#7f6a3e', '#8c8a4a', '#6f5a3a'] : g.spec.season === 'estate' ? ['#c9a94e', '#8aa54a', '#d4b860', '#6f8f3a'] : ['#7fae4a', '#94b85a', '#6a9a3e', '#a8c060'];
      natureTerrain(g, { undul: 1.2, dirtAmt: 0.2, relief: { hills: { amp: g.rng.range(18, 38), scale: g.rng.range(90, 140), start: 35, ramp: 90 } }, fields: { scale: g.rng.range(35, 60), colors: fieldCols, from: 40 } });
      const fx = g.rng.sign() * g.rng.range(4, 12), fz = -g.rng.range(24, 32);
      g.add('ed_cascina', { pos: [fx, fz], yaw: g.rng.range(-0.25, 0.25), fit: { front: true }, params: { variant: g.rng.pick(['pietra', 'intonaco']), floors: 2, width: g.rng.range(12, 17), depth: 9, barn: true, night: night(g), seed: g.rng.seedInt() }, r: 10 });
      // paddock fence in front of the farmhouse
      const pw = g.rng.range(14, 20), pz = -g.rng.range(9, 12), px = -fx * 0.4;
      g.add('es_recinzione', { pos: [px, pz - pw * 0.35], params: { style: 'staccionata', length: pw, height: 1.1 }, r: 0 });
      g.add('es_recinzione', { pos: [px - pw / 2, pz], yaw: H, params: { style: 'staccionata', length: pw * 0.7, height: 1.1 }, r: 0 });
      g.add('es_recinzione', { pos: [px + pw / 2, pz], yaw: H, params: { style: 'staccionata', length: pw * 0.7, height: 1.1 }, r: 0 });
      g.occupyRect(px, pz, pw / 2 + 0.5, pw * 0.35 + 0.5);
      const herd = [['mucca', 2], ['cavallo', 1], ['pecora', 3], ['maiale', 1], ['capra', 1], ['gallina', 4]];
      for (const [sp, k] of herd) {
        const n = Math.round(k * (0.5 + g.density) * (g.want('animali') ? 1.5 : 1));
        for (let i = 0; i < n; i++) {
          const inPen = sp !== 'gallina' && sp !== 'cavallo';
          const pos = inPen ? [px + g.rng.range(-pw / 2 + 1.5, pw / 2 - 1.5), pz + g.rng.range(-pw * 0.3, pw * 0.3)] : g.around(4, 10, 120).slice(0, 2);
          g.animal(sp, { pos, r: sp === 'gallina' ? 0.4 : 1.1, free: { occ: !inPen } });
        }
      }
      for (let i = 0; i < g.n(3, 1); i++) g.tryAdd('ls_fieno', { r: 2.5, params: { kind: g.rng.pick(['rotoli', 'balle']), count: g.rng.int(2, 6), seed: g.rng.seedInt() } }, () => g.around(9, 22, 150));
      g.tryAdd('ls_carretto', { r: 2, params: { load: g.rng.chance(0.6) } }, () => g.around(5, 12, 140));
      g.add('es_vialetto', { pos: [fx * 0.5, (fz + 2) / 2], yaw: Math.atan2(fx, -fz) * 0.5, params: { length: Math.abs(fz) - 4, width: 2.6, bend: g.rng.range(-20, 20), surface: 'terra', edging: false } });
      for (let i = 0; i < g.n(4, 2); i++) { const tr = seasonTree(g); g.tryAdd(tr.type, { params: { ...tr.params, height: g.rng.range(8, 13) }, color: tr.color, r: 2.5, sink: 0.05 }, () => g.around(14, 40, 160)); }
      if (g.rng.chance(0.6)) g.add('es_filare', { pos: [g.rng.range(-30, 30), -g.rng.range(45, 70)], yaw: g.rng.range(-0.4, 0.4), params: { count: 8, spacing: 6, height: 11, species: 'cipresso', seed: g.rng.seedInt() } });
      // vineyard / orchard rows on the hills (instanced bushes along lines)
      const rows = g.scatter;
      const vine = { kind: 'bush', look: { leaf: S.bare ? '#6b5a44' : S.leaf[1] || '#5d7f3a' }, items: [] };
      const ox = g.rng.range(-120, 120), oz = -g.rng.range(80, 140), ang = g.rng.range(-0.5, 0.5);
      for (let r = 0; r < 18; r++) for (let k = 0; k < 40; k++) {
        const lx = (k - 20) * 2.2, lz = r * 2.6;
        const x = ox + lx * Math.cos(ang) - lz * Math.sin(ang), z = oz + lx * Math.sin(ang) + lz * Math.cos(ang);
        if (!g.isFree(x, z, 1)) continue;
        vine.items.push({ x, y: g.h(x, z) - 0.05, z, s: 1.3, sx: 1.3, sy: 1.1, sz: 0.8, rot: ang, far: true, c: '#ffffff' });
      }
      rows.push(vine);
      g.scatterOf('cypress', { count: g.n(60, 20), rMin: 40, rMax: 400, size: [9, 14], colors: ['#ffffff'], look: { leaf: '#3c5a33' }, farR: 90, minSep: 5 });
      forest(g, { mix: 'latifoglie', count: g.n(160, 60), rMin: 60, rMax: 500, minSep: 7, farR: 90 });
      g.view = { el: 4, focal: 32 };
    },
  },
  {
    id: 'lago', label: 'Lago', group: 'natura', variants: 2,
    tags: ['lago', 'acqua', 'pontile', 'barca', 'riva', 'montagne', 'salici', 'specchio'],
    thumb: { sky: ['#78aee0', '#e3eef5'], ground: '#6a8c3d', sil: 'lake', water: '#3f7f8f' },
    build(g) {
      const v = g.spec.variant, level = -0.4;
      const bz = -g.rng.range(70, 95), br = g.rng.range(55, 75);
      natureTerrain(g, {
        undul: 0.8, dirtAmt: 0.2, water: level, beach: 0.9, mud: v === 0, sand: '#c9b48a', snowLine: g.spec.season === 'inverno' ? 30 : 170, rockSlope: 0.4,
        relief: { basin: { x: 0, z: bz, r: br, depth: 5 }, hills: { amp: 20, scale: 90, start: 40, ramp: 80 }, mountains: { amp: g.rng.range(150, 320), start: 150, ramp: 200, scale: 260, sharp: 0.8, back: 0.55 } },
        waterLevel: level, waterColor: g.atm.night ? '#142634' : '#3a6f7c',
      });
      const shoreZ = bz + br * 0.82;
      const mx = g.rng.range(-6, 6), mw = g.rng.range(1.8, 2.6);
      g.add('ls_molo', { pos: [mx, shoreZ - 9], yaw: H, terrain: false, y: level + 0.25, params: { length: 22, width: mw, bollards: false } });
      g.decks.push({ x: mx, z: shoreZ - 9, hx: mw / 2, hz: 11, yaw: 0, y: level + 0.73 });
      g.add('ls_barca', { pos: [g.rng.range(-4, 4) + 3, shoreZ - 14], yaw: H + g.rng.range(-0.3, 0.3), terrain: false, y: level, params: { kind: 'remi', length: 4 }, color: g.rng.pick(['#2f5a8a', '#b3261e', '#e8e4dc', '#2f6b3a']) });
      for (let i = 0; i < g.n(5, 2); i++) { const tr = { type: g.rng.pick(['es_salice', 'es_betulla', 'es_salice']), params: { seed: g.rng.seedInt(), season: g.spec.season === 'autunno' ? 'autunno' : g.spec.season === 'inverno' ? 'inverno' : 'estate' } }; g.tryAdd(tr.type, { params: { ...tr.params, height: g.rng.range(7, 11) }, r: 2.5, sink: 0.05 }, () => [g.rng.sign() * g.rng.range(6, 26), g.rng.range(shoreZ - 2, -6)], 10); }
      rocks(g, g.n(3, 1), { rMin: 6, rMax: 20 });
      bushes(g, g.n(4, 2));
      grassPatches(g, g.n(2, 1));
      wildlife(g, ['cervo', 'volpe'], 0.3, 1);
      forest(g, { mix: g.rng.pick(['conifere', 'misto']), count: g.n(380, 150), rMin: 30, rMax: 560, minSep: 4, farR: 85, avoid: (x, z) => g.h(x, z) < level + 0.5 || g.h(x, z) > 120 });
      g.view = { el: 4, focal: 32 };
    },
  },
  {
    id: 'prato', label: 'Prato fiorito', group: 'natura', variants: 2,
    tags: ['prato', 'fiori', 'primavera', 'campo', 'collina', 'verde', 'margherite', 'radura'],
    thumb: { sky: ['#7fb7ea', '#eef6f0'], ground: '#7fae4a', sil: 'meadow' },
    seasons: { primavera: 4, estate: 2, autunno: 0.6, inverno: 0.3 },
    build(g) {
      const S = g.atm.foliage;
      natureTerrain(g, { base: mixHex(S.grass, '#9bc25a', g.spec.season === 'primavera' ? 0.4 : 0), undul: 1.5, dirtAmt: 0.05, relief: { hills: { amp: g.rng.range(15, 40), scale: g.rng.range(80, 140), start: 25, ramp: 80 } } });
      grassPatches(g, g.n(6, 3), { flowers: true, rMin: 2.5, rMax: 16, size: [4, 9] });
      const lone = g.rng.chance(0.75);
      if (lone) {
        const tr = g.spec.season === 'primavera' && g.rng.chance(0.6) ? { type: 'es_ciliegio', params: { seed: g.rng.seedInt(), season: 'fiori' } } : seasonTree(g);
        g.tryAdd(tr.type, { params: { ...tr.params, height: g.rng.range(8, 12) }, color: tr.color, r: 3, sink: 0.05 }, () => g.around(10, 18, 70), 10);
      }
      bushes(g, g.n(3, 1), { flowers: 1 });
      wildlife(g, ['coniglio', 'cavallo', 'pecora', 'coniglio'], 0.4, 2);
      const fcols = g.spec.season === 'autunno' ? ['#e0b03a', '#c8662a'] : g.spec.season === 'inverno' ? ['#f2f2f2'] : ['#e84a5f', '#f6d743', '#ffffff', '#9b59d0', '#ff8fb1', '#f5a623'];
      if (g.spec.season !== 'inverno') g.scatterOf('flowers', { count: g.n(1100, 400), rMin: 2.5, rMax: 160, size: [0.7, 1.4], colors: ['#ffffff'], look: { flowers: fcols, leaf: S.grass }, farR: 50, bias: 0.75, clear: 0.6 });
      forest(g, { mix: 'latifoglie', count: g.n(90, 30), rMin: 50, rMax: 500, minSep: 10, farR: 100 });
      g.view = { el: 2, focal: 35 };
    },
  },
  {
    id: 'giungla', label: 'Giungla', group: 'natura', variants: 2,
    tags: ['giungla', 'foresta pluviale', 'tropicale', 'liane', 'palme', 'felci', 'amazzonia', 'umido', 'esotico'],
    thumb: { sky: ['#9cc3c8', '#e2eee6'], ground: '#3f6a2c', sil: 'jungle' },
    weathers: { sereno: 2, nuvoloso: 3, pioggia: 2.5, neve: 0, nebbia: 2 },
    seasons: { primavera: 1, estate: 3, autunno: 0.2, inverno: 0.05 },
    build(g) {
      natureTerrain(g, { base: '#3f6a2c', alt: '#4d7a32', dirt: '#4a3a28', dirtAmt: 0.45, undul: 1.6, snowK: 0, relief: { hills: { amp: g.rng.range(25, 45), scale: 80, start: 30, ramp: 70 }, mountains: { amp: g.rng.range(80, 160), start: 200, scale: 180, sharp: 0.4, back: 0.6 } } });
      for (let i = 0; i < g.n(5, 2); i++) g.tryAdd('es_palma', { r: 1.5, params: { height: g.rng.range(7, 13), seed: g.rng.seedInt() }, sink: 0.05 }, () => g.around(5, 20, 160));
      for (let i = 0; i < g.n(7, 3); i++) g.tryAdd('es_latifoglia', { r: 2.5, color: g.rng.pick(['#3f7a33', '#2f6a2a', '#4f8a38']), params: { height: g.rng.range(12, 20), width: g.rng.range(1.1, 1.4), season: 'estate', seed: g.rng.seedInt() }, sink: 0.05 }, () => g.around(8, 30, 160));
      for (let i = 0; i < g.n(10, 4); i++) g.tryAdd('ls_tropicale', { r: 0.9, params: { height: g.rng.range(1.2, 3.2), seed: g.rng.seedInt() } }, () => g.around(2.6, 14, 175));
      for (let i = 0; i < g.n(8, 3); i++) g.tryAdd('ls_felce', { r: 0.6, params: { height: g.rng.range(0.6, 1.3), seed: g.rng.seedInt() } }, () => g.around(2.5, 11, 175));
      rocks(g, g.n(3, 1), { moss: true });
      if (g.spec.variant === 1 || g.want('rovine')) g.tryAdd('ls_rovina', { r: 4, params: { kind: g.rng.pick(['muro', 'arco']), length: 7, seed: g.rng.seedInt() }, color: '#9a9a86' }, () => g.around(10, 22, 120));
      wildlife(g, ['gorilla', 'scimpanze', 'tigre', 'pappagallo', 'serpente'], 0.5, 2);
      g.scatterOf('jungle', { count: g.n(520, 200), rMin: 22, rMax: 480, size: [12, 22], colors: ['#ffffff', '#e2efd8', '#d4e6c8'], look: { leaf: '#2f6a2a' }, farR: 70, minSep: 4 });
      g.scatterOf('palm', { count: g.n(140, 50), rMin: 20, rMax: 300, size: [8, 14], colors: ['#ffffff'], look: { leaf: '#3f7a2e' }, farR: 70, minSep: 5 });
      g.scatterOf('bush', { count: g.n(220, 80), rMin: 12, rMax: 160, size: [1.2, 3], colors: ['#ffffff', '#dfeccd'], look: { leaf: '#3a6e2e' }, farR: 55, minSep: 2 });
      g.fogScale = 1.8;
    },
  },
];
