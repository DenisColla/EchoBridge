// Builds one garment (all its parts) for one character: drafts, edge
// treatments, hardware, straps, shoe soles, assembly, plus the information the
// outfit manager needs for layering (occupancy) and skin hiding (coverage).
import { buildBodyDraftSteps } from './build.js';
import { buildSkirtDraft, skirtOccupancy, ribbon } from './skirt.js';
import { hemExtras, collarExtras, discExtras, newExtras, ridgeExtras, frontLine } from './edges.js';
import { assemble, FOLD_GAIN } from './assemble.js';
import { quadNormals, len2, len3 } from './mesh.js';
import { referenceSkin } from './wrinkles.js';

/** occupancy value of body vertices with no garment below (occupancy = signed outer height over the body) */
export const NO_LAYER = -1;
/** Most fold room (m) a layer reserves for its own rest folds under the next layer. */
const CREST_MAX = 0.0035;

/** Parts of a garment for a sex (each part inherits the garment's fields). */
export function partsOf(def, sex) {
  const parts = def.partsBySex ? (def.partsBySex[sex] || def.partsBySex.F) : def.parts || [null];
  return parts.map((p) => (p ? { ...def, ...p, parts: undefined, partsBySex: undefined } : def));
}

/**
 * ctx: {topo, bi, occ (Float32Array, lower layers, read only), surf, sex, ch}
 * item: {id, color, fit, wrinkles}
 * Returns {runtime, hidden: Uint8Array(model faces) | null, occ: Float32Array (updated copy), surf} or null
 */
export function buildGarment(ctx, def, item) {
  const gen = buildGarmentSteps(ctx, def, item);
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

/**
 * Same as buildGarment, as a generator that yields between the expensive stages
 * (one draft, its edges + hardware, the assembly): the outfit manager spreads a
 * build over several frames. The return value is buildGarment's result.
 */
export function* buildGarmentSteps(ctx, def, item) {
  const { topo, bi } = ctx;
  const fit = item.fit ?? 0.5;
  const occ = ctx.occ ? ctx.occ.slice() : new Float32Array(topo.nv).fill(NO_LAYER);
  // outer cloth surface height over each body vertex (like occ, without the room for folds)
  const surf = ctx.surf ? ctx.surf.slice() : new Float32Array(topo.nv);
  const pieces = [];
  let hidden = null;
  for (const pdef of partsOf(def, ctx.sex)) {
    // later parts of the same garment may hug the earlier ones (dress skirt over its bodice)
    const pctx = { ...ctx, occ, surf };
    let draft = null;
    if (pdef.kind === 'skirt') draft = buildSkirtDraft(pctx, pdef, { ...pdef.skirt(bi, fit), fitT: fit });
    else draft = yield* buildBodyDraftSteps(pctx, pdef, { fit });
    if (!draft) continue;
    yield 'draft';
    // rib bands / waistbands / cuffs: their border is a smooth line, not the mesh grid
    if (draft.kind === 'body' && pdef.bands) bandSplit(draft, pdef.bands);
    draft.N = quadNormals(draft.nf, draft.quads, draft.P);
    // enveloped parts (shoes, socks) keep body-derived folds in their toe gaps:
    // a smoothed normal field gives them one coherent outward direction
    if (pdef.fit?.envelope) smoothNormals(draft, 8);
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
    if (pdef.straps && !ctx.noStraps) extras.push(...straps(bi, topo));
    let faceGroup = null;
    // sole / upper border: a clean horizontal line (iso-line split), not the faces' staircase
    if (pdef.sole) soleSplit(draft, pdef.sole);
    pieces.push({ draft, extras, wrinkle: pdef.wrinkle, folds: pdef.folds, faceGroup, ampScale: foldFade(draft, pdef.foldFade) });
    // layering for the next part / garment
    if (draft.kind === 'skirt') { skirtOccupancy(draft, bi, topo, occ); skirtOccupancy(draft, bi, topo, surf); }
    else {
      bodyOccupancy(draft, occ, pdef, extras);
      ribbonOccupancy(extras, bi, topo, occ);
      bodySurface(draft, surf);
      if (pdef.hide !== false) hidden = coverage(topo, draft, hidden);
    }
    yield 'part';
  }
  if (!pieces.length) return null;
  const runtime = assemble(pieces, bi, { refM: ctx.ch ? referenceSkin(ctx.ch) : null });
  if (!runtime) return null;
  return { runtime, hidden, occ, surf };
}

/**
 * Dynamic fold amplitude fading out below torso height t1 (to `min` at t0):
 * the bodice of a dress under its skirt must not fold through it.
 */
function foldFade(draft, spec) {
  if (!spec || !draft.coords?.tT) return null;
  const tT = draft.coords.tT, [t0, t1, min = 0] = spec;
  return (i) => { const t = tT[i]; const f = t >= t1 ? 1 : t <= t0 ? 0 : (t - t0) / (t1 - t0); return min + (1 - min) * f * f * (3 - 2 * f); };
}

/** Laplacian smoothing of a draft's unit normals (in place), `passes` times. */
function smoothNormals(draft, passes) {
  const N = draft.N, Q = draft.quads, nf = draft.nf, nq = Q.length >> 2;
  const acc = new Float32Array(nf * 3);
  for (let p = 0; p < passes; p++) {
    acc.set(N);
    for (let f = 0; f < nq; f++) {
      let sx = 0, sy = 0, sz = 0;
      for (let k = 0; k < 4; k++) { const v = Q[f * 4 + k] * 3; sx += N[v]; sy += N[v + 1]; sz += N[v + 2]; }
      for (let k = 0; k < 4; k++) { const v = Q[f * 4 + k] * 3; acc[v] += sx; acc[v + 1] += sy; acc[v + 2] += sz; }
    }
    for (let i = 0; i < nf; i++) {
      const l = len3(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]) || 1;
      N[i * 3] = acc[i * 3] / l; N[i * 3 + 1] = acc[i * 3 + 1] / l; N[i * 3 + 2] = acc[i * 3 + 2] / l;
    }
  }
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
function bodyOccupancy(draft, occ, pdef, extras = null) {
  const c = draft.coarse, G = c.G, P0 = c.P0, N0 = c.N0;
  // the edge finishes and hardware (rolled hems, waistband top, buttons) stand
  // above the surface: the layer over this one must clear them too
  const lift = new Float32Array(c.n);
  if (extras) {
    const P = draft.P, N = draft.N, pi = c.parents.idx, pw = c.parents.w;
    for (const ex of extras) {
      if (!ex) continue;
      for (let q = 0; q < ex.parent.length; q++) {
        const v = ex.parent[q];
        if (v < 0) continue;
        const h = (ex.pos[q * 3] - P[v * 3]) * N[v * 3] + (ex.pos[q * 3 + 1] - P[v * 3 + 1]) * N[v * 3 + 1] + (ex.pos[q * 3 + 2] - P[v * 3 + 2]) * N[v * 3 + 2];
        if (!(h > 0)) continue;
        // to the coarse vertices this fine vertex comes from
        for (let k = 0; k < 4; k++) if (pw[v * 4 + k] > 0.2) { const ci = pi[v * 4 + k]; if (h > lift[ci]) lift[ci] = Math.min(0.008, h); }
      }
    }
  }
  // room for the folds of this layer at rest. Only a share of the full crest
  // height (k * 2L/pi * sqrt(c)): posed folds that rise higher push the layer
  // above out at runtime (GarmentRuntime layer pass), so the outer garment does
  // not stand off the body by a whole fold height everywhere (T-shirt over jeans).
  const w = pdef.wrinkle || {};
  const full = (w.k ?? 0.8) * (0.6 + 0.8 * (draft.fitT ?? 0.5)) * (2 / Math.PI) * FOLD_GAIN * (w.wl ?? 0.05) * 0.45 * 0.7;
  const crest = Math.min(CREST_MAX, full * 0.3) + 0.0008;
  for (let i = 0; i < c.n; i++) {
    const v = c.body[i], o = i * 3;
    const d = (G[o] - P0[o]) * N0[o] + (G[o + 1] - P0[o + 1]) * N0[o + 1] + (G[o + 2] - P0[o + 2]) * N0[o + 2];
    const val = Math.min(0.08, d + draft.thick * 0.5 + crest + lift[i]);
    if (val > occ[v]) occ[v] = val;
  }
}

/** Reach (m) of a ribbon (bra strap) over the body vertices around it, for the next layer. */
const RIBBON_REACH = 0.012;

/**
 * Ribbons laid on the body outside the part's own surface (bra straps: extras
 * with no parent vertex) stand above the skin too: the body vertices under and
 * beside them get their height, so a close top over them keeps clear of them
 * instead of letting them through.
 */
function ribbonOccupancy(extras, bi, topo, occ) {
  const P = bi.P, N = bi.N, r2 = RIBBON_REACH * RIBBON_REACH;
  for (const ex of extras) {
    if (!ex || !ex.pos || !ex.parent.length || ex.parent.some((v) => v >= 0)) continue;
    const Q = ex.pos, m = Q.length / 3;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let q = 0; q < m; q++) {
      const x = Q[q * 3], y = Q[q * 3 + 1], z = Q[q * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    for (let v = 0; v < topo.nv; v++) {
      const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
      if (px < x0 - RIBBON_REACH || px > x1 + RIBBON_REACH || py < y0 - RIBBON_REACH || py > y1 + RIBBON_REACH || pz < z0 - RIBBON_REACH || pz > z1 + RIBBON_REACH) continue;
      let best = r2, h = -1;
      for (let q = 0; q < m; q++) {
        const dx = Q[q * 3] - px, dy = Q[q * 3 + 1] - py, dz = Q[q * 3 + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= best) continue;
        best = d2; h = dx * N[v * 3] + dy * N[v * 3 + 1] + dz * N[v * 3 + 2];
      }
      if (h > 0) { const val = Math.min(0.02, h + 0.0012); if (val > occ[v]) occ[v] = val; }
    }
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
  // raised bands lying on the garment (main fabric): shirt placket, jacket front edge
  const band = newExtras(0);
  if (hw.shirtButtons) {
    const top = bi.land.neck - 0.085, bottom = bi.yOfT(0.3);
    // the button placket: a band 2.6 cm wide down the centre front, buttons on it
    if (hw.placket) ridgeExtras(band, draft, draft.N, frontLine(draft, 0, bi.land.neckPoint[1] - 0.06, bottomOf(draft, 0.12) + 0.012), hw.placket, 0.0011);
    for (let y = top; y > bottom; y -= 0.085) { const v = frontVertex(y); if (v >= 0) discExtras(ex, draft, v, draft.N, 0.0052, hw.placket ? 0.0028 : 0.0018); }
    ex.kind = 'shirt';
  }
  if (hw.blazerButtons) {
    // two buttons on the front below the lapels' break, then the fronts curve
    // apart (catalog.js blazerFront); the overlapping front edge between them
    const yb = bi.yOfT(2.25), fr = typeof hw.blazerButtons === 'object' ? hw.blazerButtons : null;
    for (const y of fr ? [yb - 0.025, yb - 0.025 - fr.buttonGap] : [yb - 0.035]) { const v = frontVertex(y, 0.12); if (v >= 0) discExtras(ex, draft, v, draft.N, 0.0085, 0.0028, 16); }
    if (fr) ridgeExtras(band, draft, draft.N, frontLine(draft, fr.edgeX, yb + 0.004, yb - fr.open), 0.007, 0.0022);
    ex.kind = 'blazer';
  }
  if (hw.sleeveButtons) sleeveButtons(draft, bi, ex, hw.sleeveButtons);
  if (band.tris.length) extras.push(band);
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

/** Lowest point (y) of the garment's front within |x| < w (rest pose). */
function bottomOf(draft, w) {
  const P = draft.P, N = draft.N;
  let y = Infinity;
  for (let i = 0; i < draft.nf; i++) if (Math.abs(P[i * 3]) < w && N[i * 3 + 2] > 0.3 && P[i * 3 + 1] < y) y = P[i * 3 + 1];
  return y;
}

/**
 * Jacket sleeve buttons: `count` small buttons in a row on the back of each
 * sleeve, 3 cm above the cuff edge.
 */
function sleeveButtons(draft, bi, ex, count) {
  const C = draft.coords, P = draft.P, N = draft.N, nf = draft.nf;
  for (const [r, sgn] of [[1, 1], [2, -1]]) {
    // end of this sleeve (largest arm parameter on it)
    let aEnd = -Infinity;
    for (let i = 0; i < nf; i++) if (C.limb[i] === r && C.wT[i] < 0.5 && C.aL[i] > aEnd) aEnd = C.aL[i];
    if (!(aEnd > 1.2)) continue;
    const perM = 1 / (bi.limbs[r].L[1] || 0.25);
    for (let b = 0; b < count; b++) {
      const a = aEnd - (0.03 + b * 0.017) * perM;
      let best = -1, bs = -Infinity;
      for (let i = 0; i < nf; i++) {
        if (C.limb[i] !== r || C.wT[i] > 0.5 || Math.abs(C.aL[i] - a) > 0.02 * perM) continue;
        // back and outer side of the forearm (rest pose)
        const s = -N[i * 3 + 2] * 0.8 + N[i * 3] * sgn * 0.6 - (Math.abs(C.aL[i] - a) / perM) * 60;
        if (s > bs) { bs = s; best = i; }
      }
      if (best >= 0) discExtras(ex, draft, best, N, 0.0055, 0.002, 10);
    }
  }
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
    const dl = len2(dx, dz) || 1;
    const px = P[i * 3] - ax, pz = P[i * 3 + 2] - az;
    const along = (px * dx + pz * dz) / dl;
    let ox = px - (dx / dl) * along, oz = pz - (dz / dl) * along;
    if (along < 0) { ox = px; oz = pz; } // heel: radial from the ankle
    const ol = len2(ox, oz) || 1;
    const t = 1 - Math.max(0, y) / top;
    const push = welt * Math.min(1, t * 1.6);
    P[i * 3] += (ox / ol) * push; P[i * 3 + 2] += (oz / ol) * push;
    // flat outsole
    if (N[i * 3 + 1] < -0.5 || y < 0.004) P[i * 3 + 1] = -below;
  }
  draft.room.fill(0.0005);
}

/**
 * The sole / upper border at the top of the midsole: a clean horizontal line
 * (iso-line split of the height field), sole group 2 below it.
 */
function soleSplit(draft, sole) {
  const P = draft.P, line = sole.top * 0.8, f = new Float32Array(draft.nf);
  for (let i = 0; i < draft.nf; i++) f[i] = P[i * 3 + 1] - line;
  isoSplit(draft, f, 2, 0);
}

/**
 * Rib bands (hems, cuffs, neck bands, waistbands): band group 1 where the
 * distance from the band's cut is under 0.95 h (the 0.5 level of the zone
 * field of build.js, which also tightens the band).
 */
function bandSplit(draft, bands) {
  const nf = draft.nf, f = new Float32Array(nf).fill(Infinity);
  let any = false;
  draft.cons.forEach((c, ci) => {
    const b = bands[c.id];
    if (!b || !draft.cvals[ci]) return;
    const cv = draft.cvals[ci], H = b.h * 0.95;
    any = true;
    for (let i = 0; i < nf; i++) { const x = cv[i] - H; if (x < f[i]) f[i] = x; }
  });
  if (any) isoSplit(draft, f, 1, 0);
}

/**
 * Two materials on one surface (main fabric | rib band, upper | sole) assigned
 * per quad follow the body mesh grid, whose rows are oblique to the border: a
 * staircase of teeth. Here the border becomes a smooth line: every fine edge
 * crossing the zero level of `field` has its nearer end moved onto the crossing
 * point, with all its per-vertex data interpolated along the edge (the fold,
 * UV and weave coordinates stay continuous), and the quads on the line are
 * split along the diagonal that lies on it, each triangle in its own group
 * (draft.triGroups, read by assemble.js). Boundary-loop vertices never move.
 * field < 0 -> group gIn, else gOut.
 */
function isoSplit(draft, field, gIn, gOut) {
  const nf = draft.nf, Q = draft.quads, nq = Q.length >> 2;
  const onLoop = new Uint8Array(nf);
  for (const l of draft.loops || []) for (const v of l.verts) onLoop[v] = 1;
  const best = new Float32Array(nf).fill(2), to = new Int32Array(nf).fill(-1);
  for (let q = 0; q < nq; q++) for (let k = 0; k < 4; k++) {
    let a = Q[q * 4 + k], b = Q[q * 4 + ((k + 1) & 3)];
    const fa = field[a], fb = field[b];
    if ((fa < 0) === (fb < 0)) continue;
    let t = fa / (fa - fb); // crossing at a + (b - a) t
    // the nearer end moves (a loop vertex stays: the other end moves instead)
    if ((t > 0.5 && !onLoop[b]) || onLoop[a]) { const x = a; a = b; b = x; t = 1 - t; }
    if (onLoop[a] || t >= best[a]) continue;
    best[a] = t; to[a] = b;
  }
  const side = new Int8Array(nf);
  for (let i = 0; i < nf; i++) side[i] = field[i] < 0 ? -1 : 1;
  const moves = [];
  for (let a = 0; a < nf; a++) if (to[a] >= 0) { moves.push(a); side[a] = 0; }
  if (!moves.length) return;
  // every per-vertex quantity follows the vertex along its edge; new values are
  // computed from the unmoved ones first (a target may move too, by its own crossing)
  const nm = moves.length, buf = new Float32Array(nm * 3);
  const move = (A, dim, isAngle = null) => {
    if (!A) return;
    for (let q = 0; q < nm; q++) {
      const a = moves[q], b = to[a], t = best[a];
      for (let c = 0; c < dim; c++) {
        let d = A[b * dim + c] - A[a * dim + c];
        if (isAngle) { if (isAngle(a, b)) { if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI; } else d = 0; }
        buf[q * dim + c] = A[a * dim + c] + d * t;
      }
    }
    for (let q = 0; q < nm; q++) for (let c = 0; c < dim; c++) A[moves[q] * dim + c] = buf[q * dim + c];
  };
  const C = draft.coords;
  move(draft.P, 3); move(draft.B, 3); move(draft.BN, 3);
  if (draft.BN) for (const a of moves) { const o = a * 3, l = len3(draft.BN[o], draft.BN[o + 1], draft.BN[o + 2]) || 1; draft.BN[o] /= l; draft.BN[o + 1] /= l; draft.BN[o + 2] /= l; }
  for (const A of [draft.off, draft.room, draft.zone, draft.span]) move(A, 1);
  if (C) {
    for (const A of [C.wT, C.aL, C.sT, C.sL, C.tT]) move(A, 1);
    move(C.thT, 1, () => true);
    move(C.thL, 1, (a, b) => C.limb[a] === C.limb[b]);
  }
  for (const A of draft.cvals || []) move(A, 1);
  const TRI = [[0, 1, 2, 0, 2, 3], [0, 1, 3, 1, 2, 3]];
  const sgn = (vs, i0, i1, i2) => {
    const s0 = side[vs[i0]], s1 = side[vs[i1]], s2 = side[vs[i2]];
    const neg = s0 < 0 || s1 < 0 || s2 < 0, pos = s0 > 0 || s1 > 0 || s2 > 0;
    return neg && pos ? -2 : neg ? gIn : gOut;
  };
  // per quad: g0 | g1 << 2 | diagonal << 4 (0: v0-v2, 1: v1-v3, 2: the shorter one)
  draft.triGroups = (vs) => {
    let neg = 0, pos = 0;
    for (let k = 0; k < 4; k++) { const s = side[vs[k]]; if (s < 0) neg++; else if (s > 0) pos++; }
    if (!neg) return gOut | (gOut << 2) | (2 << 4);
    if (!pos) return gIn | (gIn << 2) | (2 << 4);
    for (let d = 0; d < 2; d++) {
      const T = TRI[d], g0 = sgn(vs, T[0], T[1], T[2]), g1 = sgn(vs, T[3], T[4], T[5]);
      if (g0 >= 0 && g1 >= 0) return g0 | (g1 << 2) | (d << 4);
    }
    const g = neg >= pos ? gIn : gOut;
    return g | (g << 2) | (2 << 4);
  };
}
