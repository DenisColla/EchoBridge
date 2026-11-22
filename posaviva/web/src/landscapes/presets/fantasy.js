// Fantasy / historical presets: medieval village, ancient ruins, castle.
import { natureTerrain, seasonTree, forest, PI, H, mixHex } from '../gen/common.js';

const night = (g) => g.atm.night || g.atm.dusk;

function lanterns(g, n, rMin, rMax, style = 'palo') {
  for (let i = 0; i < n; i++) {
    const lit = night(g) || g.atm.weather === 'nebbia';
    if (g.tryAdd('ls_lanterna', { r: 0.4, params: { style, height: style === 'torcia' ? 1.8 : 2.4, lit } }, () => g.around(rMin, rMax, 150), 8) && lit) g.items[g.items.length - 1].lamp = { y: style === 'torcia' ? 1.9 : 1.9, kelvin: 1900, intensity: 1.2, name: 'Lanterna' };
  }
}

export const FANTASY = [
  {
    id: 'villaggio', label: 'Villaggio medievale', group: 'fantasy', variants: 2,
    tags: ['villaggio', 'medievale', 'medioevo', 'borgo', 'mercato', 'pozzo', 'fantasy', 'contadini', 'locanda'],
    thumb: { sky: ['#86b2dc', '#ece4cf'], ground: '#7d6a4c', sil: 'village' },
    build(g) {
      const cx = g.rng.range(-30, 30), cz = -g.rng.range(110, 150), ch = g.rng.range(14, 24);
      natureTerrain(g, { undul: 0.8, dirtAmt: 0.45, stage: '#8a7656', relief: { hills: { amp: 18, scale: 100, start: 45, ramp: 90 }, bumps: [{ x: cx, z: cz, r: 60, h: ch }] } });
      g.add('ls_pozzo', { pos: [g.rng.range(-3, 3), -g.rng.range(6, 9)], params: { radius: g.rng.range(0.8, 1.1), roof: g.rng.chance(0.7) }, r: 1.6 });
      const houses = ['ed_cascina', 'ed_baita', 'ed_cascina', 'ed_baita', 'ed_torre'];
      const n = g.n(7, 4);
      for (let i = 0; i < n; i++) {
        const a = (-120 + (240 * i) / Math.max(1, n - 1) + g.rng.range(-10, 10)) * PI / 180, R = g.rng.range(17, 26);
        const x = Math.sin(a) * R, z = -Math.cos(a) * R - 4;
        const type = g.rng.pick(houses);
        const params = type === 'ed_torre' ? { width: g.rng.range(5, 7), height: g.rng.range(14, 22), roof: g.rng.pick(['merlata', 'conico']), seed: g.rng.seedInt() }
          : type === 'ed_baita' ? { variant: g.rng.pick(['tronchi', 'assi']), floors: g.rng.int(1, 2), width: g.rng.range(7, 10), depth: g.rng.range(6, 8), roof: g.rng.pick(['legno', 'pietra']), night: night(g), seed: g.rng.seedInt() }
            : { variant: g.rng.pick(['pietra', 'pietra', 'intonaco']), floors: g.rng.int(1, 2), width: g.rng.range(9, 13), depth: g.rng.range(7, 9), barn: g.rng.chance(0.3), night: night(g), seed: g.rng.seedInt() };
        g.add(type, { pos: [x, z], yaw: Math.atan2(-x, -z - 4) + g.rng.range(-0.2, 0.2), params, r: type === 'ed_torre' ? 4.5 : 6.5, free: { corridor: true } });
      }
      for (let i = 0; i < g.n(3, 2); i++) g.tryAdd('ls_bancarella', { r: 1.8, color: g.rng.pick(['#b3261e', '#2f5a8a', '#2f6b3a', '#c9a227', '#7a2f6b']), params: { width: g.rng.range(2, 3.2), seed: g.rng.seedInt() } }, () => { const [x, z] = g.around(5, 11, 120); return [x, z, Math.atan2(-x, -z)]; }, 10);
      g.tryAdd('ls_carretto', { r: 2, params: { load: g.rng.chance(0.6) } }, () => g.around(5, 12, 150));
      const stuff = ['ph_wine_barrel_01', 'ph_wooden_crate_01', 'ph_wooden_crate_02', 'ph_wooden_bucket_01', 'ph_wicker_basket_01', 'ph_wooden_bucket_02'];
      for (let i = 0; i < g.n(8, 4); i++) g.tryAdd(g.rng.pick(stuff), { r: 0.5 }, () => g.around(3.2, 12, 165));
      g.tryAdd('ls_fieno', { r: 2.2, params: { kind: 'balle', count: g.rng.int(3, 7), seed: g.rng.seedInt() } }, () => g.around(8, 16, 150));
      lanterns(g, g.n(4, 2), 4, 12, g.rng.pick(['palo', 'torcia']));
      for (const [sp, k] of [['gallina', 3], ['maiale', 1], ['cavallo', 1], ['cane_medio', 1], ['capra', 1]]) {
        if (!(g.rng.chance(0.6) || g.want('animali'))) continue;
        for (let i = 0; i < k; i++) g.animal(sp, { pos: g.around(3.5, 10, 150).slice(0, 2), r: sp === 'gallina' ? 0.35 : 1 });
      }
      // castle on the hill in the background
      g.add('ed_castello', { pos: [cx, cz], yaw: Math.atan2(-cx, -cz), terrain: false, y: ch - 0.3, params: { width: g.rng.range(28, 40), height: g.rng.range(20, 30), roof: g.rng.pick(['merlata', 'conico']), seed: g.rng.seedInt() } });
      forest(g, { mix: 'misto', count: g.n(380, 140), rMin: 40, rMax: 520, minSep: 4, farR: 80, avoid: (x, z) => Math.hypot(x - cx, z - cz) < 45 });
    },
  },
  {
    id: 'rovine', label: 'Rovine antiche', group: 'fantasy', variants: 3,
    tags: ['rovine', 'antiche', 'tempio', 'colonne', 'grecia', 'roma', 'archeologia', 'avventura', 'templi'],
    thumb: { sky: ['#8ab8e3', '#f1e6cc'], ground: '#a89a6a', sil: 'ruins' },
    build(g) {
      const v = g.spec.variant; // 0 Mediterranean, 1 overgrown jungle, 2 desert
      if (v === 2) natureTerrain(g, { base: '#d6b07a', alt: '#dcbb88', dirt: '#b88b5c', dirtAmt: 0.1, rock: '#b48a60', rockSlope: 0.5, undul: 0.6, snowK: 0, relief: { dunes: { amp: 3, scale: 24 }, mountains: { amp: 90, start: 220, scale: 220, sharp: 0.3, back: 0.5, plateau: 0.5 } } });
      else if (v === 1) natureTerrain(g, { base: '#3f6a2c', alt: '#4d7a32', dirt: '#4a3a28', dirtAmt: 0.4, undul: 1.4, snowK: 0, relief: { hills: { amp: 30, scale: 80, start: 30, ramp: 70 } } });
      else natureTerrain(g, { base: mixHex(g.atm.foliage.grass, '#b4a66a', 0.55), alt: '#9c9a62', dirt: '#a08a62', dirtAmt: 0.35, undul: 1.2, rockSlope: 0.35, relief: { hills: { amp: g.rng.range(25, 45), scale: 100, start: 30, ramp: 80 } } });
      const marble = v === 1 ? '#a8a894' : v === 2 ? '#dcc59c' : '#ece6d6';
      g.add('ed_tempio', { pos: [g.rng.range(-6, 6), -g.rng.range(28, 38)], yaw: g.rng.range(-0.3, 0.3), fit: { front: true }, color: marble, params: { variant: 'rovina', columns: g.rng.int(5, 8), width: g.rng.range(14, 22), depth: g.rng.range(24, 36), wear: '2', seed: g.rng.seedInt() }, r: 14 });
      for (let i = 0; i < g.n(5, 3); i++) g.tryAdd('ls_rovina', { r: 3.5, color: marble, params: { kind: g.rng.pick(['muro', 'colonne', 'arco', 'colonne']), length: g.rng.range(4, 10), count: g.rng.int(2, 5), seed: g.rng.seedInt() } }, () => { const [x, z] = g.around(7, 24, 160); return [x, z, g.rng.range(-PI, PI)]; }, 10);
      for (let i = 0; i < g.n(4, 2); i++) g.tryAdd('colonna', { r: 0.8, color: marble, params: { style: 'classica', height: g.rng.range(1.2, 4) } }, () => g.around(4, 14, 160));
      if (v === 1) {
        for (let i = 0; i < g.n(8, 3); i++) g.tryAdd('ls_tropicale', { r: 0.9, params: { height: g.rng.range(1.2, 3), seed: g.rng.seedInt() } }, () => g.around(3, 14, 170));
        for (let i = 0; i < g.n(4, 2); i++) g.tryAdd('es_palma', { r: 1.5, params: { height: g.rng.range(7, 12), seed: g.rng.seedInt() } }, () => g.around(6, 20, 160));
        g.scatterOf('jungle', { count: g.n(420, 160), rMin: 24, rMax: 420, size: [12, 20], colors: ['#ffffff', '#e2efd8'], look: { leaf: '#2f6a2a' }, farR: 70, minSep: 4 });
        g.fogScale = 1.6;
      } else if (v === 2) {
        for (let i = 0; i < g.n(3, 1); i++) g.tryAdd('es_palma', { r: 1.5, params: { height: g.rng.range(6, 10), seed: g.rng.seedInt() } }, () => g.around(8, 22, 150));
        g.scatterOf('rock', { count: g.n(120, 40), rMin: 15, rMax: 400, size: [0.8, 3.5], colors: ['#ffffff'], look: { rock: '#b99068' }, farR: 70 });
      } else {
        for (let i = 0; i < g.n(5, 2); i++) g.tryAdd('es_cipresso', { r: 1.2, params: { height: g.rng.range(8, 14), seed: g.rng.seedInt() }, sink: 0.05 }, () => g.around(8, 30, 160));
        for (let i = 0; i < g.n(3, 1); i++) g.tryAdd('es_latifoglia', { r: 2, color: '#8a9a60', params: { height: g.rng.range(5, 8), season: 'estate', width: 1.2, seed: g.rng.seedInt() }, sink: 0.05 }, () => g.around(8, 26, 160));
        g.scatterOf('cypress', { count: g.n(70, 25), rMin: 30, rMax: 400, size: [8, 13], colors: ['#ffffff'], look: { leaf: '#3f5a35' }, farR: 90, minSep: 5 });
        g.scatterOf('broadleaf', { count: g.n(90, 30), rMin: 30, rMax: 400, size: [4, 7], colors: ['#ffffff', '#eef0e0'], look: { leaf: '#7f8f5a' }, farR: 90, minSep: 6 });
      }
      const stones = ['es_roccia'];
      for (let i = 0; i < g.n(4, 2); i++) g.tryAdd(stones[0], { r: 1, params: { size: g.rng.range(0.4, 1.2), shape: 'lastra', count: g.rng.int(2, 5), moss: v === 1, seed: g.rng.seedInt() }, color: marble, sink: 0.05 }, () => g.around(3.5, 16, 165));
      if (g.want('animali') || g.rng.chance(0.3)) g.animal(v === 1 ? g.rng.pick(['serpente', 'scimpanze', 'pappagallo']) : v === 2 ? 'serpente' : g.rng.pick(['capra', 'corvo', 'gufo']), { pos: g.around(4, 9, 120).slice(0, 2), r: 0.6 });
      g.view = { el: 3, focal: 32 };
    },
  },
  {
    id: 'castello', label: 'Castello', group: 'fantasy', variants: 2,
    tags: ['castello', 'fortezza', 'torri', 'medievale', 'fantasy', 'cavalieri', 'drago', 'mura', 'regno'],
    thumb: { sky: ['#7aa8d8', '#efe0c6'], ground: '#6f8a45', sil: 'castle' },
    times: { alba: 1.5, mattino: 2, mezzogiorno: 1.5, tramonto: 2.5, sera: 1.5, notte: 1.5 },
    build(g) {
      const cx = g.rng.range(-12, 12), cz = -g.rng.range(70, 95), ch = g.rng.range(6, 14);
      natureTerrain(g, { undul: 1, dirtAmt: 0.25, relief: { hills: { amp: 25, scale: 110, start: 40, ramp: 100 }, mountains: { amp: g.rng.range(120, 260), start: 260, scale: 260, sharp: 0.8, back: 0.7 }, bumps: [{ x: cx, z: cz, r: 70, h: ch }] }, snowLine: 170, snowK: 1, rockSlope: 0.4 });
      g.add('ed_castello', { pos: [cx, cz], yaw: Math.atan2(-cx, -cz), terrain: false, y: ch - 0.3, params: { width: g.rng.range(36, 54), height: g.rng.range(24, 36), roof: g.rng.pick(['merlata', 'conico', 'conico']), seed: g.rng.seedInt() } });
      if (g.spec.variant === 1) for (const s of [-1, 1]) g.add('ed_torre', { pos: [cx + s * g.rng.range(40, 55), cz + g.rng.range(10, 25)], params: { shape: g.rng.pick(['quadrata', 'tonda']), width: 6, height: g.rng.range(16, 24), roof: 'conico', seed: g.rng.seedInt() }, r: 4, free: { corridor: false } });
      g.add('es_vialetto', { pos: [cx * 0.25, -16], yaw: Math.atan2(cx, -cz) * 0.4, params: { length: 26, width: 2.6, bend: g.rng.range(-25, 25), surface: 'terra', edging: false } });
      g.add('es_vialetto', { pos: [cx * 0.6, -40], yaw: Math.atan2(cx, -cz) * 0.6, params: { length: 26, width: 2.6, bend: g.rng.range(-25, 25), surface: 'terra', edging: false } });
      for (let i = 0; i < g.n(3, 2); i++) g.tryAdd('es_palo', { r: 0.4, params: { style: 'bandiera', height: g.rng.range(4, 6) } }, () => g.around(5, 14, 120));
      lanterns(g, g.n(3, 1), 4, 12, 'torcia');
      for (let i = 0; i < g.n(4, 2); i++) { const tr = seasonTree(g, 'any'); g.tryAdd(tr.type, { params: { ...tr.params, height: g.rng.range(8, 13) }, color: tr.color, r: 2.4, sink: 0.05 }, () => g.around(10, 30, 160)); }
      for (let i = 0; i < g.n(3, 1); i++) g.tryAdd('es_roccia', { r: 1.1, params: { size: g.rng.range(0.6, 1.6), shape: 'masso', count: g.rng.int(1, 3), moss: true, seed: g.rng.seedInt() } }, () => g.around(4, 16, 160));
      if (g.rng.chance(0.55) || g.want('cavalli', 'animali')) g.animal('cavallo', { pos: g.around(4, 8, 100).slice(0, 2), r: 1.4 });
      const beast = g.want('drago') ? 'drago' : g.want('unicorno') ? 'unicorno' : g.rng.chance(0.2) ? g.rng.pick(['drago', 'unicorno', 'grifone']) : null;
      if (beast) g.animal(beast, { pos: g.around(9, 15, 80).slice(0, 2), r: 3, size: beast === 'drago' ? g.rng.range(1.4, 2.2) : 1 });
      forest(g, { mix: 'misto', count: g.n(420, 160), rMin: 35, rMax: 560, minSep: 4, farR: 85, avoid: (x, z) => Math.hypot(x - cx, z - cz) < 50 });
      g.view = { el: 2, focal: 30 };
    },
  },
];
