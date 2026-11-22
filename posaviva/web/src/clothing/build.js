// Procedural garment generation from the body mesh.
//
// A garment definition (catalog.js) describes WHERE the fabric is with a list
// of signed constraint fields over the body (>0 inside): hem heights, sleeve /
// leg lengths along the limb axes, necklines, armholes, part exclusions. The
// builder:
//   1. selects the body faces inside all constraints, cleans the selection
//   2. snaps boundary vertices onto the zero level set (clean, straight hems)
//   3. offsets the patch from a smoothed, bump-free body by thickness + ease
//      (gravity-aware: the fabric rests on surfaces that face up, hangs off the
//      others; per-garment ease maps; the layers below measured in the same
//      frame), lets it hang from protrusions (fit.js: cylindrical envelopes for
//      sides and limbs, front / back depth maps for bust, belly, shoulder
//      blades and buttocks), bridges concavities with a constrained membrane
//      smoothing, straightens the edges and rounds the span edges
//   4. derives skin weights from the body (diffused only where the fabric
//      stands off the body: lying on it, it rides the skin exactly)
//   5. Catmull-Clark subdivides once and re-applies the offset constraint
//   6. computes the per-vertex coordinates used by UVs, static folds, edge
//      treatments (hems, rib bands, collars, lapels) and wrinkles
// The result is a "draft" (fine quad surface + metadata) that assemble.js
// turns into a SkinnedMesh geometry and a wrinkle runtime.
import { buildEdges, buildAdjacency, boundaryCounts, boundaryLoops, subdivide, applyStencil, applyParents, quadNormals, normalize3, edgeDistance, len3 } from './mesh.js';
import { PART, NPART, flattenBumps } from './body.js';
import { hangFit, bridgeSmooth, metricSmooth, enforceOffset, smoothWeights, top4, footEnvelope } from './fit.js';
import { collideBody } from './collide.js';

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const PI = Math.PI;

// ------------------------------------------------------------------ mask kit
/**
 * Constraint primitives bound to a body. Each returns {id, fn(v,x,y,z), metric}
 * where fn is positive inside the garment and roughly in meters (metric =
 * meters per unit when not), so band widths and zones can be expressed in m.
 */
export function maskKit(bi) {
  const topo = bi.topo, PW = topo.partW, land = bi.land;
  const partSum = (v, ids) => { let s = 0; for (const p of ids) s += PW[v * NPART + p]; return s; };
  const limbIndex = { L: [1, 3], R: [2, 4] };
  const tmp = new Float32Array(9);
  const k = {
    bi, land,
    /** height of a torso coordinate (see body.js) */
    y: (t) => bi.yOfT(t),
    /** keep y >= yCut */
    above: (id, yCut) => ({ id, fn: (v, x, y) => y - yCut }),
    /** keep y <= yCut */
    below: (id, yCut) => ({ id, fn: (v, x, y) => yCut - y }),
    /** keep arm param <= len (len may be a function of the frontness -1..1) */
    sleeve: (id, side, len) => {
      const r = limbIndex[side][0], L = bi.limbs[r], A = bi.param[r - 1];
      return { id, fn: (v) => (len - A[v]) * L.L[0] };
    },
    /** keep leg param <= len; len may be fn(front -1..1, outer -1..1) for shaped openings */
    legMax: (id, side, len) => {
      const r = limbIndex[side][1], L = bi.limbs[r], A = bi.param[r - 1];
      if (typeof len !== 'function') return { id, fn: (v) => (len - A[v]) * L.L[0] };
      const sgn = side === 'L' ? 1 : -1;
      return {
        id, fn: (v, x, y, z) => {
          const a = A[v];
          if (a < -0.25) return (len(0, 0) - a) * L.L[0];
          L.cyl(Math.max(0, a), x, y, z, tmp);
          return (len(Math.sin(tmp[0]) * sgn, Math.cos(tmp[0])) - a) * L.L[0];
        },
      };
    },
    /** keep leg param >= min (shoes / socks), everything else excluded */
    legMin: (id, side, min) => {
      const r = limbIndex[side][1], L = bi.limbs[r], A = bi.param[r - 1];
      return { id, fn: (v) => (A[v] - min) * L.L[1] };
    },
    /** keep vertices whose total weight of the given parts is below thr */
    exclude: (id, parts, thr = 0.5) => {
      const ids = parts.map((p) => PART[p]);
      return { id, fn: (v) => (thr - partSum(v, ids)) * 0.1 };
    },
    /** keep only vertices with total weight of parts above thr */
    only: (id, parts, thr = 0.5) => {
      const ids = parts.map((p) => PART[p]);
      return { id, fn: (v) => (partSum(v, ids) - thr) * 0.1 };
    },
    /**
     * Neckline: opening around the neck base. spec {front, back (depth below the
     * neck base, m), width (half width of the opening, m), shape 'round'|'v'|'scoop', lift}
     */
    neckline: (id, spec) => {
      const N = land.neckPoint, yN = N[1] + (spec.lift || 0), zN = N[2];
      const W = spec.width;
      const prof = (u, depth, shape) => {
        if (u >= 1) return 0;
        if (shape === 'v') return depth * (1 - u);
        if (shape === 'scoop') return depth * (1 - Math.pow(u, 2.4));
        return depth * Math.sqrt(1 - u * u);
      };
      return {
        id, fn: (v, x, y, z) => {
          const ax = Math.abs(x), u = ax / W;
          const fr = smoothstep(-0.03, 0.04, z - zN);
          const d = prof(u, spec.back, spec.backShape || 'round') * (1 - fr) + prof(u, spec.front, spec.shape || 'round') * fr;
          return yN - d + Math.max(0, ax - W) * 2.5 - y;
        },
      };
    },
    /**
     * Armhole of sleeveless garments: vertical (z-independent) cut around the
     * shoulder. spec {inset (strap edge inside the shoulder joint, m), drop (armhole bottom below the armpit, m), rx}
     */
    armhole: (id, side, spec) => {
      const sx = land.shoulderX, sgn = side === 'L' ? 1 : -1;
      const cx = sx - (spec.inset ?? 0.03) + (spec.rx ?? 0.05);
      const rx = spec.rx ?? 0.05;
      const cy = land.armpit - (spec.drop ?? 0.02) + (spec.ry ?? 0.07);
      const ry = spec.ry ?? 0.07;
      return {
        id, fn: (v, x, y) => {
          const q = x * sgn;
          let xb;
          if (y >= cy) xb = cx - rx;
          else if (y >= cy - ry) { const t = (y - cy) / ry; xb = cx - rx * Math.sqrt(Math.max(0, 1 - t * t)); } else xb = cx + (cy - ry - y) * 6;
          return xb - q;
        },
      };
    },
    /** custom field */
    custom: (id, fn) => ({ id, fn }),
  };
  return k;
}

// ------------------------------------------------------------------ selection
function selectFaces(topo, vals, P) {
  const nf = topo.nf, Q = topo.quads, E = topo.E;
  const faceIn = new Uint8Array(nf);
  for (let f = 0; f < nf; f++) {
    let inside = 1;
    for (const val of vals) {
      const s = val[Q[f * 4]] + val[Q[f * 4 + 1]] + val[Q[f * 4 + 2]] + val[Q[f * 4 + 3]];
      if (s <= 0) { inside = 0; break; }
    }
    faceIn[f] = inside;
  }
  // cleanup: fill notches, remove peninsulas
  const nb = (f) => {
    let c = 0;
    for (let k = 0; k < 4; k++) {
      const e = E.faceEdges[f * 4 + k];
      const g = E.ef0[e] === f ? E.ef1[e] : E.ef0[e];
      if (g >= 0 && faceIn[g]) c++;
    }
    return c;
  };
  for (let pass = 0; pass < 3; pass++) {
    let changed = 0;
    for (let f = 0; f < nf; f++) {
      const c = nb(f);
      if (!faceIn[f] && c >= 3) { faceIn[f] = 1; changed++; } else if (faceIn[f] && c <= 1) { faceIn[f] = 0; changed++; }
    }
    if (!changed) break;
  }
  // non-manifold vertices (two fans touching at one vertex): drop faces until clean
  for (let pass = 0; pass < 6; pass++) {
    const { bad } = fanCheck(topo, faceIn);
    if (!bad.length) break;
    for (const v of bad) {
      // remove the included face around v with the fewest included neighbours
      let best = -1, bc = 9;
      for (let j = topo.vf.off[v]; j < topo.vf.off[v + 1]; j++) {
        const f = topo.vf.list[j];
        if (!faceIn[f]) continue;
        const c = nb(f);
        if (c < bc) { bc = c; best = f; }
      }
      if (best >= 0) faceIn[best] = 0;
    }
  }
  // drop tiny islands (< 12 faces)
  const comp = new Int32Array(nf).fill(-1), sizes = [];
  for (let f = 0; f < nf; f++) {
    if (!faceIn[f] || comp[f] >= 0) continue;
    const id = sizes.length, stack = [f];
    comp[f] = id;
    let n = 0;
    while (stack.length) {
      const g = stack.pop(); n++;
      for (let k = 0; k < 4; k++) {
        const e = E.faceEdges[g * 4 + k];
        const h = E.ef0[e] === g ? E.ef1[e] : E.ef0[e];
        if (h >= 0 && faceIn[h] && comp[h] < 0) { comp[h] = id; stack.push(h); }
      }
    }
    sizes.push(n);
  }
  for (let f = 0; f < nf; f++) if (faceIn[f] && sizes[comp[f]] < 12) faceIn[f] = 0;
  return faceIn;
}

/** Vertices where included faces form more than one fan (bow-ties) -> non-manifold boundary. */
function fanCheck(topo, faceIn) {
  const bad = [];
  const cnt = new Uint8Array(topo.nv);
  // count boundary edges per vertex (edge between an included and an excluded / missing face)
  const E = topo.E;
  for (let e = 0; e < E.ne; e++) {
    const a = E.ef0[e] >= 0 && faceIn[E.ef0[e]], b = E.ef1[e] >= 0 && faceIn[E.ef1[e]];
    if (a !== b) { cnt[E.ea[e]]++; cnt[E.eb[e]]++; }
  }
  for (let v = 0; v < topo.nv; v++) if (cnt[v] > 2) bad.push(v);
  return { bad };
}

// ------------------------------------------------------------------ body-derived draft
/**
 * @param ctx {topo, bi, occ: Float32Array(nv) offsets of lower layers, sex}
 * @param def garment definition (catalog.js)
 * @param opts {fit 0..1}
 */
export function buildBodyDraft(ctx, def, opts) {
  const { topo, bi } = ctx;
  const P = bi.P, nvb = topo.nv;
  const fitT = opts.fit ?? 0.5;
  const kit = maskKit(bi);
  const cons = def.mask(kit, ctx.sex, opts).filter(Boolean);
  const vals = cons.map(() => new Float32Array(nvb));
  for (let v = 0; v < nvb; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    for (let i = 0; i < cons.length; i++) vals[i][v] = cons[i].fn(v, x, y, z);
  }
  const faceIn = selectFaces(topo, vals, P);
  return runSteps(draftFromFaces(ctx, def, opts, faceIn, cons, vals, fitT));
}

/** buildBodyDraft as a generator: yields between the mask, the fit, the weights and the subdivision. */
export function* buildBodyDraftSteps(ctx, def, opts) {
  const { topo, bi } = ctx;
  const P = bi.P, nvb = topo.nv;
  const fitT = opts.fit ?? 0.5;
  const kit = maskKit(bi);
  const cons = def.mask(kit, ctx.sex, opts).filter(Boolean);
  const vals = cons.map(() => new Float32Array(nvb));
  for (let v = 0; v < nvb; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    for (let i = 0; i < cons.length; i++) vals[i][v] = cons[i].fn(v, x, y, z);
  }
  const faceIn = selectFaces(topo, vals, P);
  yield 'mask';
  return yield* draftFromFaces(ctx, def, opts, faceIn, cons, vals, fitT);
}

/** Runs a generator to completion and returns its value. */
function runSteps(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

function* draftFromFaces(ctx, def, opts, faceIn, cons, vals, fitT) {
  const { topo, bi, occ } = ctx;
  const P = bi.P, N = bi.N;
  const fit = def.fit || {};
  // ---- coarse vertex set
  const local = new Int32Array(topo.nv).fill(-1);
  const bodyOf = [];
  let nfc = 0;
  for (let f = 0; f < topo.nf; f++) if (faceIn[f]) nfc++;
  if (nfc < 8) return null;
  const cq = new Uint32Array(nfc * 4);
  const coveredFaces = new Int32Array(nfc);
  let fi = 0;
  for (let f = 0; f < topo.nf; f++) {
    if (!faceIn[f]) continue;
    coveredFaces[fi] = f;
    for (let k = 0; k < 4; k++) {
      const v = topo.quads[f * 4 + k];
      if (local[v] < 0) { local[v] = bodyOf.length; bodyOf.push(v); }
      cq[fi * 4 + k] = local[v];
    }
    fi++;
  }
  const n = bodyOf.length;
  const body = Int32Array.from(bodyOf);
  const E = buildEdges(n, cq);
  const adj = buildAdjacency(n, E);
  const bcount = boundaryCounts(n, E);
  const loops = boundaryLoops(n, cq, E);
  const bnd = new Uint8Array(n), bprev = new Int32Array(n).fill(-1), bnext = new Int32Array(n).fill(-1);
  for (const L of loops) for (let i = 0; i < L.length; i++) { const v = L[i]; bnd[v] = 1; bprev[v] = L[(i + L.length - 1) % L.length]; bnext[v] = L[(i + 1) % L.length]; }
  for (let i = 0; i < n; i++) if (bcount[i] && !bnd[i]) bnd[i] = 1;

  // ---- body reference (snapped boundary)
  const P0 = new Float32Array(n * 3), N0 = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = body[i];
    P0[i * 3] = P[v * 3]; P0[i * 3 + 1] = P[v * 3 + 1]; P0[i * 3 + 2] = P[v * 3 + 2];
    N0[i * 3] = N[v * 3]; N0[i * 3 + 1] = N[v * 3 + 1]; N0[i * 3 + 2] = N[v * 3 + 2];
  }
  const active = new Int8Array(n).fill(-1);
  const snapClear = new Float32Array(n).fill(-1);
  const cvals = cons.map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < cons.length; c++) cvals[c][i] = vals[c][body[i]];
  for (let i = 0; i < n; i++) {
    if (!bnd[i]) continue;
    const v = body[i];
    let ia = 0, mv = Infinity;
    for (let c = 0; c < cons.length; c++) if (vals[c][v] < mv) { mv = vals[c][v]; ia = c; }
    active[i] = ia;
    const val = vals[ia];
    let best = Infinity, bu = -1, bt = 0;
    for (let j = topo.adj.off[v]; j < topo.adj.off[v + 1]; j++) {
      const u = topo.adj.adj[j];
      if ((val[v] > 0) === (val[u] > 0)) continue;
      const t = Math.min(0.8, val[v] / (val[v] - val[u]));
      const d = t * len3(P[u * 3] - P[v * 3], P[u * 3 + 1] - P[v * 3 + 1], P[u * 3 + 2] - P[v * 3 + 2]);
      if (d < best) { best = d; bu = u; bt = t; }
    }
    if (bu >= 0) {
      // move along the edge; normal and crease clearance follow the edge too
      for (let k = 0; k < 3; k++) {
        P0[i * 3 + k] = P[v * 3 + k] + (P[bu * 3 + k] - P[v * 3 + k]) * bt;
        N0[i * 3 + k] = N[v * 3 + k] + (N[bu * 3 + k] - N[v * 3 + k]) * bt;
      }
      const l = len3(N0[i * 3], N0[i * 3 + 1], N0[i * 3 + 2]) || 1;
      N0[i * 3] /= l; N0[i * 3 + 1] /= l; N0[i * 3 + 2] /= l;
      snapClear[i] = bi.clearance[v] + (bi.clearance[bu] - bi.clearance[v]) * bt;
      cvals[ia][i] = 0;
    }
  }
  // straighten loops
  const tmp = new Float32Array(n * 3);
  for (let it = 0; it < 3; it++) {
    tmp.set(P0);
    for (let i = 0; i < n; i++) {
      if (!bnd[i] || bprev[i] < 0) continue;
      const a = bprev[i] * 3, b = bnext[i] * 3, o = i * 3;
      for (let c = 0; c < 3; c++) tmp[o + c] = P0[o + c] * 0.5 + (P0[a + c] + P0[b + c]) * 0.25;
    }
    P0.set(tmp);
  }

  // ---- coordinates (regions, limb params, torso/limb cylindrical coords)
  const coords = coarseCoords(bi, topo, body, P0, n);

  // ---- zones (rib bands near specific edges)
  const bands = def.bands || {};
  const zone = new Float32Array(n);
  cons.forEach((c, ci) => {
    const b = bands[c.id];
    if (!b) return;
    for (let i = 0; i < n; i++) {
      const z = 1 - smoothstep(b.h * 0.75, b.h * 1.15, cvals[ci][i]);
      if (z > zone[i]) zone[i] = z;
    }
  });
  yield 'coarse';

  // ---- offsets
  const thick = fit.thickness ?? 0.002;
  const ease = easeOf(fit, fitT);
  // the fabric rests on a smoothed body (no nipples, navel, rib or muscle detail);
  // against the true body only a small hard clearance is enforced
  const base = bi.smoothBase(fit.smooth ?? 8);
  const P0s = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = body[i];
    // snapped boundary vertices keep their offset to the base of their vertex
    for (let k = 0; k < 3; k++) P0s[i * 3 + k] = P0[i * 3 + k] + base[v * 3 + k] - P[v * 3 + k];
  }
  taubin(n, P0s, adj, bnd, 2);
  const N0s = quadNormals(n, cq, P0s);
  // Ease is not a uniform shell: a garment hangs from the surfaces that carry it.
  // Where the body faces up (top of the shoulders, upper bust, hip shelf, top of
  // the deltoid in the rest pose) the fabric lies on it; sideways and downward
  // facing surfaces get the full ease. Garments may shape it further (easeMap:
  // jeans hug the seat, open up below the knee).
  const contact = fit.contact ?? 0.75;
  // the layer below, as the fabric feels it: its height over the smoothed base
  // (measured from the true body, then corrected: lower where the base fills a
  // hollow such as the gluteal cleft, higher where it shaved off a bump such as
  // a nipple), with its edges and bumps (bra cup rim, waistband step) bridged
  // over a few vertex rings instead of copied
  let lowS = null;
  if (occ) {
    lowS = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = body[i], k = i * 3;
      if (!(occ[v] > -0.5)) continue;
      const d0 = (P0[k] - P0s[k]) * N0s[k] + (P0[k + 1] - P0s[k + 1]) * N0s[k + 1] + (P0[k + 2] - P0s[k + 2]) * N0s[k + 2];
      lowS[i] = Math.max(0, occ[v] + d0);
    }
    softLayer(n, lowS, adj, 5);
  }
  const off = new Float32Array(n);
  // ease per vertex, then smoothed over the surface: the contact factor reads the
  // normal, which flips up and down around small dense features (nipples, navel)
  const eas = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = ease * (1 - zone[i] * 0.85);
    e *= 1 - contact * smoothstep(0.15, 0.75, N0s[i * 3 + 1]);
    if (fit.easeMap) e *= fit.easeMap(coords, i, P0, bi, fitT);
    eas[i] = e;
  }
  smoothField(n, eas, adj, P0s, bnd, EASE_SMOOTH);
  for (let i = 0; i < n; i++) {
    let o = thick + eas[i];
    if (fit.offset) o += fit.offset(coords, i, P0, bi) || 0;
    if (lowS && lowS[i] > 0.0004) o = Math.max(o, lowS[i] + thick * 0.6 + 0.0012);
    off[i] = o;
  }
  // Edge zone (visible skin around the garment, see coverage margins): the
  // garment must clear the true body there. Inside, the body is hidden, so only
  // lower layers must be cleared and small protrusions (nipples, navel) vanish.
  // Hidden skin: covered faces whose vertices are all farther than EDGE_MARGIN
  // from the garment edge. Every garment vertex touching a visible face must
  // clear the true body ("edge zone").
  const margin = def.hideMargin ?? EDGE_MARGIN;
  const edgeD = edgeDistance(n, adj, P0, bnd.reduce((a, b, i) => { if (b) a.push(i); return a; }, []), margin + 0.01);
  const hiddenFace = new Uint8Array(nfc);
  const visV = new Uint8Array(n);
  for (let f = 0; f < nfc; f++) {
    let hid = def.hide !== false;
    for (let k = 0; k < 4 && hid; k++) if (!(edgeD[cq[f * 4 + k]] >= margin)) hid = false;
    hiddenFace[f] = hid ? 1 : 0;
    if (!hid) for (let k = 0; k < 4; k++) visV[cq[f * 4 + k]] = 1;
  }
  for (let i = 0; i < n; i++) if (bnd[i]) visV[i] = 1;
  const edgeZone = (i) => visV[i] === 1;
  const offMin = new Float32Array(n), offBody = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = body[i];
    const lower = occ && occ[v] > -0.5 ? occ[v] + thick * 0.4 + 0.0006 : -1;
    // (a little extra near edges: skinning differences while posing)
    const bodyMin = edgeZone(i) ? thick * 0.7 + 0.0015 + (snapClear[i] >= 0 ? snapClear[i] : bi.clearance[v]) : -1;
    offBody[i] = bodyMin;
    offMin[i] = Math.max(lower, bodyMin);
    // a hem lying on a layer below stands a little off it (the rolled edge, and
    // room for that layer's folds when the legs move: no jeans through a T-shirt hem)
    if (lowS && lowS[i] > 0.0004 && edgeD[i] < HEM_LIFT_R) off[i] += HEM_LIFT * (1 - edgeD[i] / HEM_LIFT_R);
    if (off[i] < offMin[i]) off[i] = offMin[i];
  }
  const G = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) G[i] = P0s[i] + N0s[i] * off[Math.floor(i / 3)];
  enforceOffset(n, G, P0, N0, offMin);
  const c = { n, body, P0: P0s, N0: N0s, off, G, coords, adj, bnd, bprev, bnext, hard: { P0, N0, offMin }, span: new Float32Array(n) };
  const loose = lerp(fit.loose?.[0] ?? 0, fit.loose?.[1] ?? 0.3, fitT);
  {
    const fade = new Float32Array(n);
    for (let i = 0; i < n; i++) fade[i] = 1 - zone[i];
    if (fit.looseFade) for (let i = 0; i < n; i++) fade[i] *= fit.looseFade(coords, i, cvals, cons);
    const slope = geo(fit.slope?.[0] ?? 0.8, fit.slope?.[1] ?? 0.3, fitT);
    // sleeves / trouser legs may drape differently from the body of the garment
    const limb = (spec, def) => (spec ? {
      loose: lerp(spec.loose?.[0] ?? 0, spec.loose?.[1] ?? 0, fitT), slope: geo(spec.slope?.[0] ?? 0.8, spec.slope?.[1] ?? 0.3, fitT),
      slopeUpper: spec.slopeUpper ? geo(spec.slopeUpper[0], spec.slopeUpper[1], fitT) : undefined, bridgeSlope: spec.bridgeSlope ?? def.bridgeSlope,
    } : null);
    const torso = { loose, slope, bridgeSlope: fit.bridgeSlope ?? 0.8 };
    hangFit(c, bi, {
      loose, slope, innerSlope: fit.innerSlope ?? 1.4, fade, bridgeSlope: torso.bridgeSlope, hullAmount: fit.hull ?? (fit.bridgeSlope >= 1.9 ? 0 : 0.85),
      arm: limb(fit.sleeve, torso), leg: limb(fit.leg, torso),
    });
  }
  bridgeSmooth(c, fit.bridge ?? 12);
  // edges are one clean line: straighten every boundary loop along itself (a hem
  // crossing the gluteal cleft or the ankle otherwise zigzags and folds back,
  // a slit or jagged teeth once the rolled hem is added)
  straightenLoops(c, fit.loopSmooth ?? 8);
  // collision against the true body in creases and near the edges
  const near = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (bnd[i]) { near[i] = 1; for (let j = adj.off[i]; j < adj.off[i + 1]; j++) near[adj.adj[j]] = 1; }
  const test = new Uint8Array(n);
  for (let i = 0; i < n; i++) test[i] = (near[i] || bi.risky[body[i]]) && offBody[i] > 0 ? 1 : 0;
  collideBody(bi, n, G, body, offBody, test, 3);
  metricSmooth(c, fit.finalSmooth ?? 4);
  // where a span leaves the body (under the bust) the fabric turns over a sharp
  // edge: round it (the skin there is hidden; only the layers below are kept clear)
  roundSpanEdges(c, 6);
  // no small bumps in the fabric itself either (a bra apex, a nipple, the navel
  // rim show through as points): spatial bump removal, then the hard clearances
  if (!fit.envelope) {
    flattenBumps(G, N0s, n, 0.01, 0.8);
    enforceOffset(n, G, P0, N0, offMin);
  }
  // shoes / socks: cross-section hull around the foot axis (one toe box, no
  // toes). Last shaping step: any smoothing after it would slide the toe-gap
  // walls back between the toes.
  if (fit.envelope) footEnvelope(c, bi, fit.envelope);
  collideBody(bi, n, G, body, offBody, test, 2);
  yield 'fit';

  // ---- skin weights (dense over the bones in use)
  const model = topo.model, SI = model.skinIndex, SW = model.skinWeight;
  const boneLocal = new Map(), boneIds = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) {
    const v = body[i];
    if (SW[v * 4 + k] > 0 && !boneLocal.has(SI[v * 4 + k])) { boneLocal.set(SI[v * 4 + k], boneIds.length); boneIds.push(SI[v * 4 + k]); }
  }
  const extraBones = def.weightBones ? def.weightBones.map((nm) => model.boneIndex.get(nm)).filter((b) => b !== undefined) : [];
  for (const b of extraBones) if (!boneLocal.has(b)) { boneLocal.set(b, boneIds.length); boneIds.push(b); }
  const nb = boneIds.length;
  const W = new Float32Array(n * nb);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) {
    const v = body[i], w = SW[v * 4 + k];
    if (w > 0) W[i * nb + boneLocal.get(SI[v * 4 + k])] += w;
  }
  if (def.weightBlend) def.weightBlend(W, nb, boneLocal, c, bi, model, fitT);
  // Weight diffusion only where the fabric stands off the body (bridged spans,
  // hanging hems): there it must not tear between bones. Fabric lying on the
  // body keeps the body's own weights, so it rides the skin exactly (a diffused
  // sleeve cap lags behind the deltoid when the arm comes down: a puffed shoulder).
  const wAmt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const gap = (G[o] - P0[o]) * N0[o] + (G[o + 1] - P0[o + 1]) * N0[o + 1] + (G[o + 2] - P0[o + 2]) * N0[o + 2] - thick;
    wAmt[i] = Math.max(fit.wSmoothMin ?? 0.15, smoothstep(0.01, 0.035, gap));
  }
  smoothWeights(n, nb, W, adj, Math.round((fit.wSmooth ?? 2) + loose * 6), wAmt);
  yield 'weights';

  // ---- subdivision
  const levels = def.subdiv ?? 1;
  let fine;
  if (levels > 0) fine = subdivide(n, cq, E);
  else {
    const idx = new Int32Array(n * 4), w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { idx[i * 4] = i; w[i * 4] = 1; }
    const off2 = new Int32Array(n + 1), sidx = new Int32Array(n), sw = new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) { off2[i + 1] = i + 1; sidx[i] = i; }
    fine = { nv: n, quads: cq, stencil: { off: off2, idx: sidx, w: sw }, parents: { idx, w } };
  }
  const nf = fine.nv;
  const FP = applyStencil(fine.stencil, G, 3, new Float32Array(nf * 3), nf);
  const FB = applyParents(fine.parents, P0, 3, new Float32Array(nf * 3), nf);
  const FBN = normalize3(applyParents(fine.parents, N0, 3, new Float32Array(nf * 3), nf), nf);
  // minimum offsets (-1 = none): linear when every parent has one, else the max
  const fineMin = (src) => {
    const out = new Float32Array(nf);
    for (let i = 0; i < nf; i++) {
      let m = -1, lin = 0, all = true;
      for (let k = 0; k < 4; k++) {
        const w = fine.parents.w[i * 4 + k];
        if (!w) continue;
        const x = src[fine.parents.idx[i * 4 + k]];
        if (x < 0) all = false;
        if (x > m) m = x;
        lin += w * x;
      }
      out[i] = all ? lin : m;
    }
    return out;
  };
  const Foff = fineMin(offMin), FoffBody = fineMin(offBody);
  enforceOffset(nf, FP, FB, FBN, Foff);
  {
    const src = new Int32Array(nf), ftest = new Uint8Array(nf);
    const pi = fine.parents.idx, pw = fine.parents.w;
    for (let i = 0; i < nf; i++) {
      src[i] = body[pi[i * 4]];
      let t = 0;
      for (let k = 0; k < 4; k++) if (pw[i * 4 + k] > 0 && test[pi[i * 4 + k]]) t = 1;
      ftest[i] = t && FoffBody[i] > 0 ? 1 : 0;
    }
    collideBody(bi, nf, FP, src, FoffBody, ftest, 3);
  }
  const fcoords = fineCoords(coords, fine.parents, nf, bi, FP);
  const fzone = applyParents(fine.parents, zone, 1, new Float32Array(nf), nf);
  const fspan = applyParents(fine.parents, c.span, 1, new Float32Array(nf), nf);
  const fcvals = cvals.map((cv) => applyParents(fine.parents, cv, 1, new Float32Array(nf), nf));
  const FW = applyParents(fine.parents, W, nb, new Float32Array(nf * nb), nf);
  const skin = top4(nf, nb, FW, boneIds);
  const coarseSkin = top4(n, nb, W, boneIds);
  // inward room for wrinkle valleys (never into the body / lower layer)
  const room = new Float32Array(nf);
  for (let i = 0; i < nf; i++) {
    const o = i * 3;
    const d = (FP[o] - FB[o]) * FBN[o] + (FP[o + 1] - FB[o + 1]) * FBN[o + 1] + (FP[o + 2] - FB[o + 2]) * FBN[o + 2];
    room[i] = Math.max(0, d - Math.max(Foff[i], thick * 0.5));
  }

  // ---- fine boundary loops with their constraint type
  const FE = buildEdges(nf, fine.quads);
  const floops = boundaryLoops(nf, fine.quads, FE).map((L) => {
    const votes = new Map();
    for (const v of L) if (v < n && active[v] >= 0) votes.set(active[v], (votes.get(active[v]) || 0) + 1);
    let best = -1, bc = 0;
    for (const [k, c2] of votes) if (c2 > bc) { bc = c2; best = k; }
    return { verts: L, id: best >= 0 ? cons[best].id : null };
  });

  return {
    kind: 'body', def, n, nf,
    P: FP, quads: fine.quads, B: FB, BN: FBN, off: Foff, room, zone: fzone, span: fspan,
    coords: fcoords, cons, cvals: fcvals, skin, loops: floops, thick,
    fitT, loose,
    coarse: { n, G, quads: cq, adj, skin: coarseSkin, parents: fine.parents, P0, N0, body, coords },
    coveredFaces, // local body faces fully under this garment (before margins)
    hiddenFace, // per covered face: 1 = skin hidden under the garment
    bodyVerts: body,
    bodyP: P,
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
/** Geometric interpolation (slopes: equal steps in ratio, so "Normale" sits between a cling and a hang). */
const geo = (a, b, t) => (a > 0 && b > 0 ? a * Math.pow(b / a, t) : lerp(a, b, t));
/**
 * Radial ease (m) of a garment at fit t ("Vestibilità": 0 aderente .. 1 largo).
 * fit.ease = [at 0, at 1]; optional fit.easeMid = value at 0.5 (piecewise
 * quadratic through the three points: the slider reads in real-world steps,
 * aderente / slim / normale / comodo / largo).
 */
export function easeOf(fit, t) {
  const a = fit.ease?.[0] ?? 0.001, b = fit.ease?.[1] ?? 0.012;
  if (fit.easeMid === undefined) return lerp(a, b, t);
  const m = fit.easeMid;
  // quadratic through (0,a) (0.5,m) (1,b)
  return a * (1 - t) * (1 - 2 * t) + m * 4 * t * (1 - t) + b * t * (2 * t - 1);
}
/** Skin within this geodesic distance (m) of a garment edge stays visible (looking into openings). */
export const EDGE_MARGIN = 0.022;

/**
 * Heights of the layers below per coarse vertex (in place; 0 where there is
 * none), relaxed without ever going below the true height: dips are filled and
 * steps become ramps a few rings wide (the fabric spans them).
 */
function softLayer(n, H, adj, iterations) {
  const H0 = H.slice();
  let h = H.slice(), t = new Float32Array(n);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const d = adj.off[i + 1] - adj.off[i];
      if (!d) { t[i] = h[i]; continue; }
      let s = 0;
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) s += h[adj.adj[j]];
      const m = h[i] * 0.5 + (s / d) * 0.5;
      t[i] = m > h[i] ? m : Math.max(H0[i], m);
    }
    const x = h; h = t; t = x;
  }
  H.set(h);
}

/** Extra clearance (m) of a hem over the layer below, fading out over HEM_LIFT_R from the edge. */
const HEM_LIFT = 0.004, HEM_LIFT_R = 0.03;

/** Smoothing passes of the per-vertex ease field. */
const EASE_SMOOTH = 8;

/** Edge-length weighted Laplacian smoothing of a scalar field (boundary values kept). */
function smoothField(n, F, adj, X, fixed, iterations) {
  const W = new Float32Array(adj.adj.length);
  for (let i = 0; i < n; i++) for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j]; W[j] = 1 / (len3(X[u * 3] - X[i * 3], X[u * 3 + 1] - X[i * 3 + 1], X[u * 3 + 2] - X[i * 3 + 2]) + 0.002); }
  const T = new Float32Array(n);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      if (fixed[i]) { T[i] = F[i]; continue; }
      let s = 0, w = 0;
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { s += F[adj.adj[j]] * W[j]; w += W[j]; }
      T[i] = w ? F[i] * 0.5 + (s / w) * 0.5 : F[i];
    }
    F.set(T);
  }
}

/**
 * Rounds the garment where a bridged span departs from the body: Laplacian
 * smoothing around the spans (dilated by two rings), limited to SPAN_ROUND_IN
 * inwards and kept clear of the lower layers / visible skin (hard offsets only).
 */
function roundSpanEdges(c, iterations) {
  const { n, G, adj, span, bnd } = c;
  if (!span) return;
  let k = new Float32Array(n);
  for (let i = 0; i < n; i++) k[i] = Math.min(1, Math.max(0, (span[i] - 0.003) / 0.01));
  for (let ring = 0; ring < 2; ring++) {
    const k2 = k.slice();
    for (let i = 0; i < n; i++) for (let j = adj.off[i]; j < adj.off[i + 1]; j++) if (k[adj.adj[j]] * 0.8 > k2[i]) k2[i] = k[adj.adj[j]] * 0.8;
    k = k2;
  }
  let any = false;
  for (let i = 0; i < n; i++) if (k[i] > 0 && !bnd[i]) { any = true; break; }
  if (!any) return;
  const start = G.slice(), tmp = new Float32Array(n * 3);
  for (let it = 0; it < iterations; it++) {
    tmp.set(G);
    for (let i = 0; i < n; i++) {
      if (!k[i] || bnd[i]) continue;
      let ax = 0, ay = 0, az = 0, m = 0;
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j] * 3; ax += G[u]; ay += G[u + 1]; az += G[u + 2]; m++; }
      if (!m) continue;
      const w = 0.5 * k[i], o = i * 3;
      tmp[o] = G[o] + w * (ax / m - G[o]); tmp[o + 1] = G[o + 1] + w * (ay / m - G[o + 1]); tmp[o + 2] = G[o + 2] + w * (az / m - G[o + 2]);
    }
    G.set(tmp);
  }
  // bounded inward travel (along the base normal), then the hard constraints
  for (let i = 0; i < n; i++) {
    const o = i * 3, N = c.N0;
    const d = (G[o] - start[o]) * N[o] + (G[o + 1] - start[o + 1]) * N[o + 1] + (G[o + 2] - start[o + 2]) * N[o + 2];
    if (d < -SPAN_ROUND_IN) { const f = -SPAN_ROUND_IN - d; G[o] += N[o] * f; G[o + 1] += N[o + 1] * f; G[o + 2] += N[o + 2] * f; }
  }
  if (c.hard) enforceOffset(n, G, c.hard.P0, c.hard.N0, c.hard.offMin);
}
/** Most a span edge may be rounded inwards (m). */
const SPAN_ROUND_IN = 0.009;

/**
 * Laplacian smoothing of the boundary loops of the coarse garment along the
 * loops only (Taubin pairs: no shrinking of the opening), then the offset
 * constraints again.
 */
function straightenLoops(c, iterations) {
  const { n, G, bnd, bprev, bnext } = c;
  if (iterations <= 0) return;
  const tmp = new Float32Array(n * 3);
  for (let it = 0; it < iterations * 2; it++) {
    const k = it & 1 ? -0.53 : 0.5;
    tmp.set(G);
    for (let i = 0; i < n; i++) {
      if (!bnd[i]) continue;
      const a = bprev[i], b = bnext[i];
      if (a < 0 || b < 0) continue;
      for (let q = 0; q < 3; q++) tmp[i * 3 + q] = G[i * 3 + q] + k * ((G[a * 3 + q] + G[b * 3 + q]) * 0.5 - G[i * 3 + q]);
    }
    G.set(tmp);
  }
  enforceOffset(n, G, c.P0, c.N0, c.off);
  if (c.hard) enforceOffset(n, G, c.hard.P0, c.hard.N0, c.hard.offMin);
}

/** Taubin (lambda|mu) smoothing: removes small detail without shrinking. Boundary vertices fixed. */
function taubin(n, X, adj, fixed, iterations) {
  const tmp = new Float32Array(n * 3);
  for (let it = 0; it < iterations * 2; it++) {
    const k = it & 1 ? -0.53 : 0.5;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const d = adj.off[i + 1] - adj.off[i];
      if (fixed[i] || !d) { tmp[o] = X[o]; tmp[o + 1] = X[o + 1]; tmp[o + 2] = X[o + 2]; continue; }
      let ax = 0, ay = 0, az = 0;
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j] * 3; ax += X[u]; ay += X[u + 1]; az += X[u + 2]; }
      tmp[o] = X[o] + k * (ax / d - X[o]); tmp[o + 1] = X[o + 1] + k * (ay / d - X[o + 1]); tmp[o + 2] = X[o + 2] + k * (az / d - X[o + 2]);
    }
    X.set(tmp);
  }
}

/** Per coarse vertex: torso weight, limb id + param, cylindrical coords in torso and limb frames. */
function coarseCoords(bi, topo, body, P0, n) {
  const wT = new Float32Array(n), limb = new Int8Array(n), aL = new Float32Array(n);
  const sT = new Float32Array(n), cT = new Float32Array(n), snT = new Float32Array(n);
  const sL = new Float32Array(n), cL = new Float32Array(n), snL = new Float32Array(n);
  const tmp = new Float32Array(9);
  for (let i = 0; i < n; i++) {
    const v = body[i], x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2];
    const r = topo.limb[v];
    const wt = topo.regionWeight(v, 0), wl = r ? topo.regionWeight(v, r) : 0;
    wT[i] = wt + wl > 0 ? wt / (wt + wl) : 1;
    limb[i] = r;
    bi.torsoCyl(x, y, z, tmp);
    sT[i] = -y; cT[i] = Math.cos(tmp[0]); snT[i] = Math.sin(tmp[0]);
    if (r) {
      const a = bi.param[r - 1][v];
      aL[i] = a;
      bi.limbs[r].cyl(Math.max(0, a), x, y, z, tmp);
      sL[i] = bi.limbs[r].metric(a); cL[i] = Math.cos(tmp[0]); snL[i] = Math.sin(tmp[0]);
    } else { aL[i] = -0.3; cL[i] = 1; }
  }
  return { n, wT, limb, aL, sT, cT, snT, sL, cL, snL };
}

/** Fine coordinates by parent interpolation; angles through cos/sin. */
function fineCoords(c, par, nf, bi, FP) {
  const pick = (src) => applyParents(par, src, 1, new Float32Array(nf), nf);
  const wT = pick(c.wT), aL = new Float32Array(nf), sT = new Float32Array(nf), sL = new Float32Array(nf);
  const thT = new Float32Array(nf), thL = new Float32Array(nf), limb = new Int8Array(nf), tT = new Float32Array(nf);
  const cT = pick(c.cT), snT = pick(c.snT), cL = new Float32Array(nf), snL = new Float32Array(nf);
  for (let i = 0; i < nf; i++) {
    // limb: any parent's limb (prefer the most weighted)
    let L = 0, wbest = -1, aS = 0, sS = 0, cS = 0, nS = 0, wS = 0;
    for (let k = 0; k < 4; k++) {
      const w = par.w[i * 4 + k];
      if (!w) continue;
      const p = par.idx[i * 4 + k];
      if (c.limb[p] && (1 - c.wT[p]) * w > wbest) { wbest = (1 - c.wT[p]) * w; L = c.limb[p]; }
    }
    for (let k = 0; k < 4; k++) {
      const w = par.w[i * 4 + k];
      if (!w) continue;
      const p = par.idx[i * 4 + k];
      if (c.limb[p] !== L) continue;
      aS += w * c.aL[p]; sS += w * c.sL[p]; cS += w * c.cL[p]; nS += w * c.snL[p]; wS += w;
    }
    limb[i] = L;
    if (L && wS > 0) { aL[i] = aS / wS; sL[i] = sS / wS; cL[i] = cS / wS; snL[i] = nS / wS; } else { aL[i] = -0.3; cL[i] = 1; }
    thT[i] = Math.atan2(snT[i], cT[i]); thL[i] = Math.atan2(snL[i], cL[i]);
    sT[i] = -FP[i * 3 + 1];
    tT[i] = bi.T(FP[i * 3 + 1]);
  }
  return { wT, limb, aL, sT, thT, sL, thL, tT };
}

// ------------------------------------------------------------------ static folds
/**
 * Static fold features (garment-type drape, stacking, bunching, creases).
 * feature: {type:'rings'|'vertical'|'crease'|'bump', region:'torso'|'arm'|'leg',
 *   near: constraint id (zone measured from that cut), width (m), amp (m), wl (m),
 *   theta: center angle, spread: half width (rad), from/to (s range) ...}
 * Returns Float32Array(nf) displacement along the normal.
 */
export function staticFolds(draft, features, noise, strength = 1) {
  const nf = draft.nf, out = new Float32Array(nf);
  if (!features || !features.length) return out;
  const C = draft.coords, P = draft.P;
  for (const f of features) {
    // zone distance: min over the referenced cuts (meters from the edge)
    let cv = null;
    if (f.near) {
      const ids = Array.isArray(f.near) ? f.near : [f.near];
      const sel = ids.map((id) => draft.cons.findIndex((c) => c.id === id)).filter((i) => i >= 0).map((i) => draft.cvals[i]);
      if (!sel.length) continue;
      cv = sel.length === 1 ? sel[0] : new Float32Array(nf).map((_, i) => Math.min(...sel.map((a) => a[i])));
    }
    for (let i = 0; i < nf; i++) {
      const isLimb = C.limb[i] && C.wT[i] < 0.5;
      const reg = f.region === 'torso' ? !isLimb : f.region === 'arm' ? isLimb && C.limb[i] <= 2 : f.region === 'leg' ? isLimb && C.limb[i] >= 3 : true;
      if (!reg) continue;
      const th = isLimb ? C.thL[i] : C.thT[i];
      const s = isLimb ? C.sL[i] : C.sT[i];
      let env = 1;
      if (cv) env *= 1 - smoothstep(f.width * 0.4, f.width, cv[i]);
      if (f.sector) { const d = angDiff(th, f.sector[0]); env *= 1 - smoothstep(f.sector[1] * 0.6, f.sector[1], Math.abs(d)); }
      if (f.sRange) env *= smoothstep(f.sRange[0] - 0.02, f.sRange[0] + 0.02, s) * (1 - smoothstep(f.sRange[1] - 0.02, f.sRange[1] + 0.02, s));
      if (env <= 0.001) continue;
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const nz = noise(x * 9.1, y * 9.1, z * 9.1);
      let d = 0;
      switch (f.type) {
        case 'rings': { // folds stacked along the axis (bunching, stacking, slack)
          const ph = (s / f.wl) * 2 * PI + nz * 2.2 + Math.sin(th * 2 + nz) * 0.9;
          d = f.amp * (foldProfile(ph) - 0.25) * (0.6 + 0.6 * noise(x * 4.3 + 7, y * 4.3, z * 4.3 + 3));
          break;
        }
        case 'vertical': { // drape folds hanging down (count around)
          const ph = th * f.count + nz * 1.6;
          d = f.amp * (foldProfile(ph) - 0.3);
          break;
        }
        case 'crease': { // pressed crease along the axis at angle theta
          const dd = Math.abs(angDiff(th, f.theta)) * (isLimb ? 0.07 : 0.15);
          d = f.amp * Math.max(0, 1 - dd / f.halfWidth) ** 2;
          break;
        }
        case 'bump': // raised patch (pockets, plackets): smooth plateau
          d = f.amp;
          break;
        default:
      }
      out[i] += d * env * strength;
    }
  }
  return out;
}

export function angDiff(a, b) {
  let d = a - b;
  while (d > PI) d -= 2 * PI;
  while (d < -PI) d += 2 * PI;
  return d;
}

/** Fold profile 0..1 with period 2pi: sharp valleys at 0, broad rounded crests at pi. */
const PROF_N = 512;
export const PROFILE = new Float32Array(PROF_N + 1);
for (let i = 0; i <= PROF_N; i++) PROFILE[i] = Math.pow(Math.abs(Math.sin((i / PROF_N) * PI)), 0.75);
export function foldProfile(ph) {
  let t = ph / (2 * PI);
  t -= Math.floor(t);
  const f = t * PROF_N, i = f | 0;
  return PROFILE[i] + (PROFILE[i + 1] - PROFILE[i]) * (f - i);
}
export { smoothstep, clamp };
