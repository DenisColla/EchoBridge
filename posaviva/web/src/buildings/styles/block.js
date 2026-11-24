// "Isolato": a city block front composed of several buildings side by side
// (party walls, aligned on the street line) with a sidewalk and curb. The
// whole block is ONE prop: every building is merged into the same per-material
// meshes, so a block of 8 buildings costs ~25 draw calls.
import { Builder, M, contextOf, palette } from './common.js';
import { SKIP } from '../kit.js';
import { PALETTES, ACCENTS } from '../mats.js';
import { palazzina60, condominio, storico, negozio, bar } from './urban.js';
import { artdeco } from './towers.js';
import { cleanParams } from '../../props/catalog.js';

/** Style mixes: [style key, weight]. */
const MIX = {
  centro: [['storico', 4], ['palazzina', 2], ['negozio', 1.5], ['bar', 1.5]],
  moderno: [['condominio', 4], ['palazzina', 2], ['artdeco', 1], ['negozio', 1]],
  periferia: [['palazzina', 4], ['condominio', 2], ['negozio', 1.2], ['bar', 1]],
  misto: [['storico', 2], ['palazzina', 2], ['condominio', 2], ['negozio', 1], ['bar', 1], ['artdeco', 0.6]],
};

/** Per style: generator, type id (for parameter defaults), width range, floors by height class, color family. */
const STYLE = {
  storico: { fn: storico, type: 'ed_storico', w: [13, 22], floors: { bassa: [3, 4], media: [4, 5], alta: [5, 7] }, pal: 'plaster' },
  palazzina: { fn: palazzina60, type: 'ed_palazzina', w: [12, 19], floors: { bassa: [3, 4], media: [5, 7], alta: [7, 10] }, pal: 'plaster' },
  condominio: { fn: condominio, type: 'ed_condominio', w: [16, 24], floors: { bassa: [4, 5], media: [6, 8], alta: [9, 13] }, pal: 'modern' },
  negozio: { fn: negozio, type: 'ed_negozio', w: [7, 11], floors: { bassa: [1, 2], media: [2, 3], alta: [3, 4] }, pal: 'plaster' },
  bar: { fn: bar, type: 'ed_bar', w: [8, 12], floors: { bassa: [2, 3], media: [3, 4], alta: [4, 5] }, pal: 'plaster' },
  artdeco: { fn: artdeco, type: 'ed_artdeco', w: [16, 22], floors: { bassa: [6, 8], media: [9, 12], alta: [13, 18] }, pal: 'stone' },
};

function pickWeighted(R, list) {
  const tot = list.reduce((a, [, w]) => a + w, 0);
  let r = R.next() * tot;
  for (const [k, w] of list) { r -= w; if (r <= 0) return k; }
  return list[list.length - 1][0];
}

/** Plans the block: [{style, w}] filling length L. */
export function planBlock(R, L, mix) {
  const list = MIX[mix] || MIX.misto;
  const out = [];
  let left = L, prev = null;
  while (left > 0.5) {
    let s = pickWeighted(R, list);
    if (s === prev && R.chance(0.6)) s = pickWeighted(R, list);
    let [a, c] = STYLE[s].w;
    let w = Math.round(R.range(a, c) * 2) / 2;
    if (left - w < 7) {
      // last one takes the rest: switch to a style wide enough for it when needed
      if (left > c + 2) {
        const fit = list.filter(([k]) => STYLE[k].w[1] + 2 >= left);
        if (fit.length) { s = pickWeighted(R, fit); [a, c] = STYLE[s].w; }
      }
      w = left;
    }
    if (w > c + 6) { // the rest is too wide for one building: split it
      w = Math.round((left / 2) * 2) / 2;
    }
    w = Math.min(w, left);
    if (w < 6 && out.length) { out[out.length - 1].w += w; break; }
    out.push({ style: s, w });
    left -= w; prev = s;
  }
  return out;
}

export function isolato(p, b = new Builder(), types = null) {
  const ctx = contextOf(p, 40), R = ctx.rand;
  const L = p.length, D = p.depth;
  const plan = planBlock(R, L, p.mix);
  const two = (list) => { const a = R.pick(list); let b2 = R.pick(list); if (b2 === a) b2 = list[(list.indexOf(a) + 1) % list.length]; return [a, b2]; };
  const accents = { shutter: two(ACCENTS.shutter), door: two(ACCENTS.door), awning: two(ACCENTS.awning), roof: two(ACCENTS.roof) };
  let x = -L / 2;
  plan.forEach((it, k) => {
    const S = STYLE[it.style];
    const type = types?.get(S.type);
    const [f0, f1] = S.floors[p.height] || S.floors.media;
    const raw = {
      width: it.w, depth: Math.max(8, D - (R.chance(0.5) ? R.range(0, 2.5) : 0)), floors: R.int(f0, f1), seed: R.int(1, 999),
      wear: p.wear, night: p.night, shops: p.shops ? R.chance(0.75) : false, roof: R.chance(p.mix === 'centro' ? 0.65 : 0.25) ? 'falde' : 'piano',
      balc: R.pick(['none', 'some', 'all', 'all']), dehors: p.shops && R.chance(0.6), umbrellas: R.chance(0.6),
    };
    const params = type ? cleanParams(type, raw) : raw;
    // party walls: let the generator place the building, then fix the color
    params.__color = R.pick(PALETTES[S.pal]);
    params.__party = true;
    params.__accents = accents;
    params.width = it.w; // the block layout wins over the type's range
    // variant picks
    if (type) for (const prm of type.params) if (prm.id === 'variant') params.variant = prm.options[R.int(0, prm.options.length - 1)].value;
    if (it.style === 'negozio' || it.style === 'bar') { const sp = type?.params.find((q) => q.id === 'sign'); if (sp) params.sign = sp.options[R.int(0, sp.options.length - 1)].value; }
    b.push().translate(x + it.w / 2, p.sidewalk ? 0.15 : 0, D / 2 - params.depth / 2);
    S.fn(params, b);
    b.pop();
    x += it.w;
    void k;
  });
  // sidewalk + curb along the street front
  const P = palette(ctx, {});
  if (p.sidewalk) {
    const sw = 3.6;
    b.box(M('paving', '#c2bdb3', { wear: ctx.wear, r: 0.9 }), -L / 2, 0, D / 2, L / 2, 0.15, D / 2 + sw - 0.25, SKIP.ny);
    b.box(M('concrete', '#a9a59c', { wear: ctx.wear }), -L / 2, 0, -D / 2 - 0.3, L / 2, 0.15, D / 2, SKIP.ny);
    b.box(M('stone', '#9c988f', { wear: ctx.wear, r: 0.85 }), -L / 2, 0, D / 2 + sw - 0.25, L / 2, 0.15, D / 2 + sw, SKIP.ny);
  }
  void P;
  return b;
}

/** Block wrapper for the type registry (types are resolved lazily to avoid import cycles). */
export function makeIsolato(getTypes) {
  return (p) => isolato(p, new Builder(), getTypes());
}
