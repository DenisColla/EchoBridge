// Builds one garment (all its parts) for one character: drafts, edge
// treatments, hardware, straps, shoe soles, assembly, plus the information the
// outfit manager needs for layering (occupancy) and skin hiding (coverage).
import { buildBodyDraft } from './build.js';
import { buildSkirtDraft, skirtOccupancy, ribbon } from './skirt.js';
import { hemExtras, collarExtras, discExtras, newExtras } from './edges.js';
import { assemble, FOLD_GAIN } from './assemble.js';
import { quadNormals } from './mesh.js';
import { referenceSkin } from './wrinkles.js';

/** occupancy value of body vertices with no garment below (occupancy = signed outer height over the body) */
export const NO_LAYER = -1;

/** Parts of a garment for a sex (each part inherits the garment's fields). */
export function partsOf(def, sex) {
  const parts = def.partsBySex ? (def.partsBySex[sex] || def.partsBySex.F) : def.parts || [null];
  return parts.map((p) => (p ? { ...def, ...p, parts: undefined, partsBySex: undefined } : def));
}

/**
 * ctx: {topo, bi, occ (Float32Array, lower layers, read only), sex, ch}
 * item: {id, color, fit, wrinkles}
 * Returns {runtime, hidden: Uint8Array(model faces) | null, occ: Float32Array (updated copy), drafts}
 */
export function buildGarment(ctx, def, item) {
  const { topo, bi } = ctx;
  const fit = item.fit ?? 0.5;
  const occ = ctx.occ ? ctx.occ.slice() : new Float32Array(topo.nv).fill(NO_LAYER);
  // outer cloth surface height over each body vertex (like occ, without the room for folds)
  const surf = ctx.surf ? ctx.surf.slice() : new Float32Array(topo.nv);
  const pieces = [];
  let hidden = null;
  for (const pdef of partsOf(def, ctx.sex)) {
    const pctx = { ...ctx, occ };
    let draft = null;
    if (pdef.kind === 'skirt') draft = buildSkirtDraft(pctx, pdef, { ...pdef.skirt(bi, fit), fitT: fit });
    else draft = buildBodyDraft(pctx, pdef, { fit });
    if (!draft) continue;
    draft.N = quadNormals(draft.nf, draft.quads, draft.P);
    if (pdef.sole) applySole(draft, pdef.sole, bi);
    const extras = [];
    // edge treatments
    for (const loop of draft.loops) {
      const spec = (pdef.edges && (pdef.edges[loop.id] || pdef.edges.default)) || { type: 'hem' };
      const inBand = pdef.bands && pdef.bands[loop.id];
      const grp = inBand ? 1 : 0;
      if (spec.type === 'hem') extras.push(hemExtras(draft, loop, draft.N, spec, grp));
      else if (spec.type === 'collar') extras.push(collarExtras(draft, loop, draft.N, spec, bi, grp));
    }
    hardware(draft, pdef, bi, extras);
    if (pdef.straps) extras.push(...straps(bi, topo));
    let faceGroup = null;
    if (pdef.sole) { levelSoleLine(draft, pdef.sole); faceGroup = soleGroups(draft, pdef.sole); }
    pieces.push({ draft, extras, wrinkle: pdef.wrinkle, folds: pdef.folds, faceGroup });
    // layering for the next part / garment
    if (draft.kind === 'skirt') { skirtOccupancy(draft, bi, topo, occ); skirtOccupancy(draft, bi, topo, surf); }
    else {
      bodyOccupancy(draft, occ, pdef);
      bodySurface(draft, surf);
      if (pdef.hide !== false) hidden = coverage(topo, draft, hidden);
    }
  }
  if (!pieces.length) return null;
  const runtime = assemble(pieces, bi, { refM: ctx.ch ? referenceSkin(ctx.ch) : null });
  return { runtime, hidden, occ, surf, pieces };
}

/** Height of the garment's outer face over each covered body vertex (rest pose). */
function bodySurface(draft, surf) {
  const c = draft.coarse, G = c.G, P0 = c.P0, N0 = c.N0;
  for (let i = 0; i < c.n; i++) {
    const v = c.body[i], o = i * 3;
    const d = (G[o] - P0[o]) * N0[o] + (G[o + 1] - P0[o + 1]) * N0[o + 1] + (G[o + 2] - P0[o + 2]) * N0[o + 2];
    const val = Math.min(0.08, d + draft.thick * 0.5);
    if (val > surf[v]) surf[v] = val;
  }
}

/** Normal offset of the garment over each covered body vertex (+ room for its folds). */
function bodyOccupancy(draft, occ, pdef) {
  const c = draft.coarse, G = c.G, P0 = c.P0, N0 = c.N0;
  // room for the folds of this layer: k * 2L/pi * sqrt(c) at c ~ 0.35, crest part (~70%)
  const w = pdef.wrinkle || {};
  const crest = (w.k ?? 0.8) * (0.6 + 0.8 * (draft.fitT ?? 0.5)) * (2 / Math.PI) * FOLD_GAIN * (w.wl ?? 0.05) * 0.45 * 0.7 + 0.001;
  for (let i = 0; i < c.n; i++) {
    const v = c.body[i], o = i * 3;
    const d = (G[o] - P0[o]) * N0[o] + (G[o + 1] - P0[o + 1]) * N0[o + 1] + (G[o + 2] - P0[o + 2]) * N0[o + 2];
    const val = Math.min(0.08, d + draft.thick * 0.5 + crest);
    if (val > occ[v]) occ[v] = val;
  }
}

/** Body faces hidden under the garment (computed by the draft builder, see EDGE_MARGIN). */
function coverage(topo, draft, hidden) {
  const out = hidden || new Uint8Array(topo.model.faceCount);
  const cf = draft.coveredFaces, hf = draft.hiddenFace;
  for (let i = 0; i < cf.length; i++) if (hf[i]) out[topo.faceIds[cf[i]]] = 1;
  return out;
}

// ------------------------------------------------------------------ hardware
function hardware(draft, pdef, bi, extras) {
  const hw = pdef.hardware;
  if (!hw) return;
  const ex = newExtras(2);
  const C = draft.coords, P = draft.P;
  const frontVertex = (y, maxTh = 0.06) => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < draft.nf; i++) {
      if (C.limb[i] && C.wT[i] < 0.5) continue;
      if (Math.abs(C.thT[i]) > maxTh) continue;
      const d = Math.abs(P[i * 3 + 1] - y) + Math.abs(C.thT[i]) * 0.05;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  if (hw.shirtButtons) {
    const top = bi.land.neck - 0.085, bottom = bi.yOfT(0.3);
    for (let y = top; y > bottom; y -= 0.085) { const v = frontVertex(y); if (v >= 0) discExtras(ex, draft, v, draft.N, 0.0052, 0.0018); }
    ex.kind = 'shirt';
  }
  if (hw.blazerButtons) {
    const v = frontVertex(bi.yOfT(2.25) - 0.035, 0.12);
    if (v >= 0) discExtras(ex, draft, v, draft.N, 0.009, 0.0028, 16);
    ex.kind = 'blazer';
  }
  if (hw.jeansButton) {
    const v = frontVertex(bi.yOfT(1.55) - 0.019, 0.1);
    if (v >= 0) discExtras(ex, draft, v, draft.N, 0.0075, 0.0025, 14);
    ex.kind = 'metal';
  }
  if (hw.zipper) {
    const v = frontVertex(bi.land.neck - 0.04, 0.1);
    if (v >= 0) discExtras(ex, draft, v, draft.N, 0.0055, 0.003, 8);
    ex.kind = 'zipper';
  }
  if (ex.tris.length) extras.push(ex);
}

/** Bra straps over the shoulders (front cup top -> shoulder -> back band). */
function straps(bi, topo) {
  const L = bi.land, out = [];
  for (const s of [1, -1]) {
    const cz = bi.cz(L.bust);
    const ctrl = [
      [s * 0.082, L.bust + 0.055, L.bustZ - 0.035],
      [s * 0.088, L.armpit + 0.045, cz + 0.06],
      [s * 0.092, L.shoulder + 0.05, L.neckZ],
      [s * 0.085, L.armpit + 0.02, cz - 0.14],
      [s * 0.08, L.underBust + 0.012, cz - 0.16],
    ];
    const rb = ribbon(bi, topo, ctrl, { width: 0.011, offset: 0.0022 + 0.001, samples: 44 });
    const ex = newExtras(0);
    ex.pos = rb.pos; ex.uv = rb.uv; ex.tris = rb.tris;
    ex.parent = new Array(rb.count).fill(-1);
    ex.skinIdx = rb.skinIdx; ex.skinW = rb.skinW;
    out.push(ex);
  }
  return out;
}

// ------------------------------------------------------------------ shoe soles
function applySole(draft, sole, bi) {
  const P = draft.P, N = draft.N, nf = draft.nf, C = draft.coords;
  const top = sole.top, below = sole.below, welt = sole.welt ?? 0.004;
  for (let i = 0; i < nf; i++) {
    const y = P[i * 3 + 1];
    if (y > top) continue;
    const r = C.limb[i] >= 3 ? C.limb[i] : (P[i * 3] > 0 ? 3 : 4);
    const L = bi.limbs[r];
    // horizontal direction away from the foot centre line (ankle -> toe tip)
    const ax = L.J[6], az = L.J[8], dx = L.J[9] - ax, dz = L.J[11] - az;
    const dl = Math.hypot(dx, dz) || 1;
    const px = P[i * 3] - ax, pz = P[i * 3 + 2] - az;
    const along = (px * dx + pz * dz) / dl;
    let ox = px - (dx / dl) * along, oz = pz - (dz / dl) * along;
    if (along < 0) { ox = px; oz = pz; } // heel: radial from the ankle
    const ol = Math.hypot(ox, oz) || 1;
    const t = 1 - Math.max(0, y) / top;
    const push = welt * Math.min(1, t * 1.6);
    P[i * 3] += (ox / ol) * push; P[i * 3 + 2] += (oz / ol) * push;
    // flat outsole
    if (N[i * 3 + 1] < -0.5 || y < 0.004) P[i * 3 + 1] = -below;
  }
  draft.room.fill(0.0005);
}

/**
 * The sole / upper border follows the mesh faces: on a coarse foot mesh it is a
 * staircase. Vertices shared by sole and upper faces are moved to one height
 * (the top of the midsole), so the border reads as a clean horizontal line.
 */
function levelSoleLine(draft, sole) {
  const P = draft.P, Q = draft.quads, nq = Q.length >> 2, line = sole.top * 0.8;
  const inSole = new Uint8Array(draft.nf), inUpper = new Uint8Array(draft.nf);
  for (let f = 0; f < nq; f++) {
    let y = 0;
    for (let k = 0; k < 4; k++) y += P[Q[f * 4 + k] * 3 + 1];
    const mark = y / 4 < line ? inSole : inUpper;
    for (let k = 0; k < 4; k++) mark[Q[f * 4 + k]] = 1;
  }
  for (let i = 0; i < draft.nf; i++) if (inSole[i] && inUpper[i] && P[i * 3 + 1] > 0) P[i * 3 + 1] = line;
}

function soleGroups(draft, sole) {
  const P = draft.P, top = sole.top;
  return (f, vs) => {
    let y = 0;
    for (const v of vs) y += P[v * 3 + 1];
    return y / 4 < top * 0.8 ? 2 : 0;
  };
}
