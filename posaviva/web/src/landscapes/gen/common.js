// Building blocks shared by the preset generators: roads, street furniture,
// parked cars, trees by season, far city skyline, forests, lamps.
import { relief, biome } from './terrainKit.js';
import { SEASON_LOOK, mixHex } from '../atmos.js';

export const PI = Math.PI, H = PI / 2;
export const CAR_COLORS = ['#c9ccd1', '#1d1f22', '#f2f2ef', '#8c1c1c', '#1f3a6b', '#5d6066', '#2f4f3a', '#d9b23a', '#7a2f1f', '#4a6d8c', '#b8b2a6', '#3b4a5c'];
export const CARS = ['es_utilitaria', 'es_berlina', 'es_suv', 'es_berlina', 'es_utilitaria', 'es_sportiva', 'es_furgone', 'es_pickup', 'es_taxi'];
const CAR_LEN = { es_utilitaria: 3.7, es_berlina: 4.7, es_suv: 4.6, es_sportiva: 4.5, es_furgone: 5.4, es_pickup: 5.4, es_taxi: 4.7, es_polizia: 4.7, es_ambulanza: 5.4 };

/** City ground: flat out to `flatR`, low hills far away, asphalt / concrete colours. */
export function cityTerrain(g, { flatR = 260, hills = 18, base = '#6f6d68', alt = '#7c7a73' } = {}) {
  const seed = g.rng.seedInt();
  g.terrain = {
    height: relief(seed, { stageR: 6, flatR, hills: { amp: hills, scale: 160, start: flatR, ramp: 200 }, mountains: hills > 10 ? { amp: hills * 4, start: 650, scale: 380, sharp: 0.5, back: 0.4 } : null }),
    color: biome(seed, { base, alt, dirt: '#5f5a50', rock: '#77736b', snowCover: g.atm.snowCover * 0.8, stageR: 6 }),
    roughness: g.atm.wet ? 0.45 : 0.95,
  };
}

/** Natural ground (grass / earth) with a biome tuned by season. */
export function natureTerrain(g, o = {}) {
  const seed = g.rng.seedInt(), S = g.atm.foliage;
  const grass = o.base || mixHex(S.grass, '#8a7b4e', S.dry * 0.4);
  g.terrain = {
    height: relief(seed, { stageR: o.stageR ?? Math.max(6, g.stageR + 3), blend: o.blend ?? 14, undul: o.undul ?? 0.8, undulScale: 24, ...o.relief }),
    color: biome(seed, {
      base: grass, alt: o.alt || mixHex(grass, '#4f6b2e', 0.35), dirt: o.dirt || '#6e5a42', rock: o.rock || '#8a867e', sand: o.sand, dirtAmt: o.dirtAmt ?? 0.25,
      rockSlope: o.rockSlope ?? 0.42, snowLine: o.snowLine, snowCover: Math.max(g.atm.snowCover, S.snow * (o.snowK ?? 0)), water: o.water, beach: o.beach, mud: o.mud,
      fields: o.fields, path: o.path, stage: o.stage, stageR: g.stageR + 1.5, rockHigh: o.rockHigh,
    }),
    roughness: g.atm.wet ? 0.5 : 0.96,
    water: o.waterLevel !== undefined ? { level: o.waterLevel, color: o.waterColor || (g.atm.night ? '#1c2a3a' : '#3f6f80'), roughness: g.atm.weather === 'pioggia' ? 0.25 : 0.08 } : null,
  };
}

/** A straight road (pieces of <= 40 m) centred at (cx, cz), along 'x' or 'z'. Returns its cross-section. */
export function road(g, { axis = 'x', cx = 0, cz = 0, length = 120, lanes = 2, laneW = 3.25, walk = 'entrambi', walkW = 2.4, pave = 'lastre', center = 'tratteggiata', crossingAt = null }) {
  const n = Math.max(1, Math.ceil(length / 40)), seg = length / n;
  for (let i = 0; i < n; i++) {
    const t = -length / 2 + seg * (i + 0.5);
    const x = axis === 'x' ? cx + t : cx, z = axis === 'x' ? cz : cz + t;
    g.add('es_strada', { pos: [x, z], yaw: axis === 'x' ? H : 0, params: { length: seg, lanes, laneW, walk, walkW, pave, center, crossing: crossingAt === i, details: true, seed: g.rng.seedInt() }, terrain: false, y: 0 });
  }
  const cw = (lanes * laneW) / 2, ww = walk === 'nessuno' ? 0 : walkW;
  return { cw, ww, half: cw + ww };
}

/** Parked cars along a curb line. side: +1 / -1 (which side of the line the cars face). */
export function parkedCars(g, { axis = 'x', line, from, to, side = 1, gap = [0.8, 3.5], chance = 0.75, types = CARS }) {
  let t = from;
  while (t < to) {
    const type = g.rng.pick(types), L = CAR_LEN[type] || 4.6;
    if (t + L > to) break;
    const c = t + L / 2;
    if (g.rng.chance(chance)) {
      const x = axis === 'x' ? c : line, z = axis === 'x' ? line : c;
      const yaw = axis === 'x' ? (side > 0 ? H : -H) : (side > 0 ? 0 : PI);
      g.add(type, { pos: [x, z], yaw, color: type === 'es_taxi' ? null : g.rng.pick(CAR_COLORS), r: L * 0.45, free: { occ: false }, reserve: true });
    }
    t += L + g.rng.range(gap[0], gap[1]);
  }
}

/** Tree prop for the season: city / nature broadleaf types follow the 'season' param. */
export function seasonTree(g, kind = 'any') {
  const s = g.spec.season, rng = g.rng;
  const broad = ['es_quercia', 'es_latifoglia', 'es_betulla'];
  let type;
  if (kind === 'conifer') type = rng.pick(['es_abete', 'es_abete', 'es_pino']);
  else if (kind === 'med') type = rng.pick(['es_pino', 'es_cipresso', 'es_latifoglia']);
  else if (kind === 'street') type = 'es_latifoglia';
  else type = rng.pick(broad);
  const params = { seed: rng.seedInt(), width: rng.range(0.85, 1.15) };
  if (['es_quercia', 'es_latifoglia', 'es_betulla', 'es_salice'].includes(type)) {
    params.season = s === 'autunno' ? 'autunno' : s === 'inverno' ? 'inverno' : s === 'primavera' && rng.chance(0.3) ? 'fiori' : 'estate';
  }
  let color = null;
  if (s === 'primavera') color = '#86b04e';
  if (s === 'inverno' && (type === 'es_abete' || type === 'es_pino')) color = g.atm.snowCover > 0.3 ? '#c9d3cf' : '#5f735a';
  if (s === 'autunno' && type === 'es_betulla') color = '#e2a531';
  return { type, params, color };
}

/** Far skyline (instanced boxes) all around beyond rMin. */
export function farCity(g, { count = 160, rMin = 90, rMax = 420, hMin = 12, hMax = 90, arc = 180, a0 = 0, wide = [14, 38], facade = '#b9b6ae' } = {}) {
  const items = g.scatterOf('tower', { count, rMin, rMax, arc, a0, minSep: 22, size: [1, 1], clear: 12, farR: 160, sink: 0 });
  for (const it of items) {
    const w = g.rng.range(wide[0], wide[1]), d = g.rng.range(wide[0], wide[1]);
    const near = 1 - Math.min(1, (Math.hypot(it.x, it.z) - rMin) / (rMax - rMin));
    const h = g.rng.range(hMin, hMax) * (0.6 + 0.6 * (1 - near) * (g.rng() < 0.2 ? 1.6 : 1));
    it.sx = w; it.sy = h; it.sz = d; it.s = 1;
    it.rot = Math.round(it.rot / (PI / 2)) * (PI / 2) + g.rng.range(-0.05, 0.05);
    it.c = mixHex(facade, g.rng.pick(['#8f9aa6', '#c8b79c', '#d9d4ca', '#9c8f84', '#a9b3bd']), g.rng.range(0.2, 0.7));
  }
  const ent = g.scatter[g.scatter.length - 1];
  if (ent?.kind === 'tower') ent.look = { facade };
  return items;
}

/** Forest scatter by season: broadleaf / conifer / mixed. */
export function forest(g, { mix = 'misto', count = 300, rMin = 30, rMax = 600, arc = 180, minSep = 3.5, size = [7, 14], farR = 90, avoid } = {}) {
  const S = g.atm.foliage;
  const leafCols = S.leaf, kinds = [];
  const bare = !!S.bare;
  if (mix !== 'conifere') kinds.push([bare ? 'bare' : 'broadleaf', mix === 'latifoglie' ? 0.85 : 0.5]);
  if (mix !== 'latifoglie') kinds.push(['conifer', mix === 'conifere' ? 1 : 0.5]);
  const tot = kinds.reduce((a, k) => a + k[1], 0);
  const VAR = ['#ffffff', '#f1f3ea', '#e4e8dc', '#fbf6ee'];
  for (const [kind, w] of kinds) {
    const n = count * w / tot;
    const common = { rMin, rMax, arc, minSep, farR, avoid, maxSlope: 0.9, minH: -0.2, sink: 0.02 };
    if (kind === 'broadleaf') {
      // one entry per crown colour (vertex colours keep the trunks brown), light per-tree variation
      const cols = g.rng.shuffle([...leafCols]).slice(0, 3);
      for (const c of cols) g.scatterOf(kind, { ...common, count: n / cols.length, size, colors: VAR, look: { leaf: c, snow: g.atm.snowCover * 0.6 } });
    } else if (kind === 'bare') g.scatterOf(kind, { ...common, count: n, size, colors: VAR, look: { snow: g.atm.snowCover * 0.7 } });
    else g.scatterOf(kind, { ...common, count: n, size: [size[0] * 1.1, size[1] * 1.25], colors: VAR, look: { leaf: g.spec.season === 'primavera' ? '#46683a' : '#3c5a35', snow: g.atm.snowCover } });
  }
}

/** Street lamp + its head position (for night lights). */
export function lamp(g, x, z, { style = 'classico', height = 4.2, yaw = 0 } = {}) {
  if (!g.add('es_lampione', { pos: [x, z], yaw, params: { style, height }, r: 0.25, free: { stage: true, corridor: false } })) return false;
  g.items[g.items.length - 1].lamp = { y: height - 0.3 };
  return true;
}

export { relief, biome, SEASON_LOOK, mixHex };
