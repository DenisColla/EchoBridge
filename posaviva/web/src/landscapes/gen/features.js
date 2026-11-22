// Extra objects asked for with spec.features (Italian keywords: 'alberi', 'auto',
// 'fontana', 'neon', 'lampioni', 'panchine', 'fiori', 'rocce', 'animali',
// 'barche', 'bancarelle', 'fuoco', 'cespugli', 'lanterne') when the preset did not
// already add them: a few pieces placed around the stage, every preset.
import { seasonTree, lamp, CAR_COLORS, CARS } from './common.js';

const NEON = ['rosa', 'blu', 'verde', 'rosso', 'giallo', 'viola'];
const NEON_HEX = { rosa: '#ff4fb8', blu: '#43b6ff', verde: '#55ff8a', rosso: '#ff3b3b', giallo: '#ffd23f', viola: '#b467ff' };
const ANIMALS = {
  citta: ['cane_medio', 'gatto', 'piccione', 'cane_piccolo'], natura: ['cervo', 'volpe', 'coniglio', 'cavallo', 'pecora'],
  fantasy: ['cavallo', 'unicorno', 'drago', 'grifone'], stanze: ['gatto', 'cane_piccolo'],
};

const RULES = [
  { words: ['fontana', 'fontane'], types: ['ls_fontana'], add: (g) => g.tryAdd('ls_fontana', { r: 3.5, params: { style: g.rng.pick(['classica', 'vasca', 'moderna']), size: g.rng.range(3.5, 6), water: g.atm.weather !== 'neve' } }, () => g.aroundOpen(7, 16, 120)) },
  { words: ['neon', 'insegne', 'insegna'], types: ['ls_insegna'], add: (g) => {
    for (let i = 0; i < 3; i++) {
      const color = g.rng.pick(NEON);
      if (g.tryAdd('ls_insegna', { r: 0.6, y: g.h(0, 0) + g.rng.range(2.4, 3.6), params: { text: g.rng.pick(['BAR', 'HOTEL', '24H', 'OPEN', 'NEON', 'CLUB']), color, mount: 'parete', width: g.rng.range(1.2, 2) } }, () => g.aroundOpen(5, 12, 110), 8)) g.items[g.items.length - 1].lamp = { y: 0.3, color: NEON_HEX[color], intensity: 0.9 };
    }
  } },
  { words: ['alberi', 'albero', 'verde'], types: ['es_quercia', 'es_latifoglia', 'es_betulla', 'es_abete', 'es_pino', 'es_palma'], min: 3, add: (g) => { for (let i = 0; i < 4; i++) { const t = seasonTree(g); g.tryAdd(t.type, { r: 2, params: { ...t.params, height: g.rng.range(7, 12) }, color: t.color, sink: 0.05 }, () => g.aroundOpen(8, 24, 125)); } } },
  { words: ['auto', 'macchine', 'macchina', 'traffico'], types: CARS, add: (g) => { for (let i = 0; i < 3; i++) { const type = g.rng.pick(CARS); g.tryAdd(type, { r: 2.4, color: type === 'es_taxi' ? null : g.rng.pick(CAR_COLORS) }, () => g.aroundOpen(6, 16, 120)); } } },
  { words: ['lampioni', 'lampione', 'luci'], types: ['es_lampione'], add: (g) => { for (let i = 0; i < 3; i++) { const [x, z] = g.aroundOpen(4, 12, 130); lamp(g, x, z, { style: g.rng.pick(['classico', 'moderno', 'sfera']), height: 4.2 }); } } },
  { words: ['panchine', 'panchina'], types: ['es_panchina'], add: (g) => { for (let i = 0; i < 2; i++) g.tryAdd('es_panchina', { r: 1, params: { style: g.rng.pick(['classica', 'parco', 'moderna']) } }, () => g.aroundOpen(4, 10, 120)); } },
  { words: ['fiori', 'fiorito'], types: ['es_aiuola'], add: (g) => { for (let i = 0; i < 3; i++) g.tryAdd(g.rng.chance(0.5) ? 'es_aiuola' : 'es_cespuglio', { r: 1.2, params: { fcolor: g.rng.pick(['misto', 'rosso', 'giallo', 'rosa']), flowers: true, size: 1.2 } }, () => g.aroundOpen(3.5, 10, 140)); } },
  { words: ['rocce', 'sassi', 'massi'], types: ['es_roccia'], add: (g) => { for (let i = 0; i < 3; i++) g.tryAdd('es_roccia', { r: 1.2, params: { size: g.rng.range(0.6, 2), shape: 'masso', count: g.rng.int(1, 3), seed: g.rng.seedInt() }, sink: 0.1 }, () => g.aroundOpen(4, 14, 140)); } },
  { words: ['cespugli', 'siepi'], types: ['es_cespuglio', 'es_siepe'], add: (g) => { for (let i = 0; i < 3; i++) g.tryAdd('es_cespuglio', { r: 1, params: { size: g.rng.range(0.8, 1.5), seed: g.rng.seedInt() } }, () => g.aroundOpen(3.5, 12, 140)); } },
  { words: ['bancarelle', 'mercato'], types: ['ls_bancarella'], add: (g) => { for (let i = 0; i < 2; i++) g.tryAdd('ls_bancarella', { r: 1.8, color: g.rng.pick(['#b3261e', '#2f5a8a', '#2f6b3a', '#c9a227']), params: { width: 2.6, seed: g.rng.seedInt() } }, () => g.aroundOpen(5, 11, 120)); } },
  { words: ['fuoco', 'falo', 'bivacco'], types: ['ls_falo'], add: (g) => { if (g.tryAdd('ls_falo', { r: 1, params: { lit: true, seed: g.rng.seedInt() } }, () => g.around(3.5, 5.5, 70))) g.items[g.items.length - 1].lamp = { y: 0.6, kelvin: 1900, intensity: 1.6, name: 'Falò' }; } },
  { words: ['lanterne', 'lanterna', 'torce'], types: ['ls_lanterna'], add: (g) => { for (let i = 0; i < 3; i++) if (g.tryAdd('ls_lanterna', { r: 0.4, params: { style: g.rng.pick(['palo', 'torcia']), lit: true } }, () => g.aroundOpen(3.5, 9, 140))) g.items[g.items.length - 1].lamp = { y: 0.5, kelvin: 1900, intensity: 1.1, name: 'Lanterna' }; } },
  { words: ['barche', 'barca'], types: ['ls_barca'], add: (g) => { if (!g.terrain?.water) return; const lvl = g.terrain.water.level; for (let i = 0; i < 3; i++) g.tryAdd('ls_barca', { r: 3, terrain: false, y: lvl, params: { kind: g.rng.pick(['remi', 'vela', 'pesca']), length: g.rng.range(4, 9) } }, () => { const p = g.around(15, 60, 60); return g.h(p[0], p[1]) < lvl - 0.6 ? p : [0, 0]; }, 20); } },
  { words: ['animali', 'animale', 'cane', 'gatto', 'cavallo'], animals: true, add: (g, presetGroup) => {
    const wanted = ['cane', 'gatto', 'cavallo'].find((w) => g.want(w));
    const sp = wanted === 'cane' ? 'cane_medio' : wanted || g.rng.pick(ANIMALS[presetGroup] || ANIMALS.natura);
    g.animal(sp, { pos: g.around(3.2, 7, 90).slice(0, 2), r: 0.8 });
  } },
];

/** Adds what the user asked for and the preset did not provide. */
export function applyFeatures(g, presetGroup) {
  if (!g.features.length) return;
  const types = new Set(g.items.map((it) => it.type));
  for (const rule of RULES) {
    if (!rule.words.some((w) => g.want(w))) continue;
    if (rule.animals ? g.animals.length > 0 && !['cane', 'gatto', 'cavallo'].some((w) => g.want(w)) : rule.types.filter((t) => types.has(t)).length >= (rule.min || 1)) continue;
    try { rule.add(g, presetGroup); } catch (e) { console.warn('[landscapes] feature', rule.words[0], e); }
  }
}
