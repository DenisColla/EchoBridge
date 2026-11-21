// Topology helpers for quad meshes (typed arrays only, no three.js objects):
// edges, vertex adjacency, boundary loops, Catmull-Clark subdivision with
// reusable stencils, sparse stencil application and vertex normals.
//
// Conventions: a quad mesh is `quads` = Uint32Array(4 * faceCount) of vertex
// indices, counter-clockwise seen from outside (same winding as the body).

/** Unique undirected edges. ef1 = -1 marks boundary edges. faceEdges[f*4+k] = edge (v_k, v_k+1). */
export function buildEdges(nv, quads) {
  const nf = quads.length >> 2;
  const map = new Map();
  const cap = nf * 4;
  const ea = new Int32Array(cap), eb = new Int32Array(cap), ef0 = new Int32Array(cap), ef1 = new Int32Array(cap);
  const faceEdges = new Int32Array(nf * 4);
  let ne = 0;
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 4; k++) {
      const a = quads[f * 4 + k], b = quads[f * 4 + ((k + 1) & 3)];
      const lo = a < b ? a : b, hi = a < b ? b : a, key = lo * nv + hi;
      let e = map.get(key);
      if (e === undefined) {
        e = ne++;
        map.set(key, e);
        ea[e] = lo; eb[e] = hi; ef0[e] = f; ef1[e] = -1;
      } else if (ef1[e] === -1) ef1[e] = f;
      faceEdges[f * 4 + k] = e;
    }
  }
  return { ne, ea: ea.subarray(0, ne), eb: eb.subarray(0, ne), ef0: ef0.subarray(0, ne), ef1: ef1.subarray(0, ne), faceEdges, nf };
}

/** Vertex adjacency (CSR) from an edge list. */
export function buildAdjacency(nv, E) {
  const off = new Int32Array(nv + 1);
  for (let e = 0; e < E.ne; e++) { off[E.ea[e] + 1]++; off[E.eb[e] + 1]++; }
  for (let i = 0; i < nv; i++) off[i + 1] += off[i];
  const fill = off.slice(0, nv);
  const adj = new Int32Array(off[nv]);
  for (let e = 0; e < E.ne; e++) { const a = E.ea[e], b = E.eb[e]; adj[fill[a]++] = b; adj[fill[b]++] = a; }
  return { off, adj };
}

/** Per vertex: number of boundary edges (0 = interior). */
export function boundaryCounts(nv, E) {
  const c = new Uint8Array(nv);
  for (let e = 0; e < E.ne; e++) if (E.ef1[e] < 0) { c[E.ea[e]]++; c[E.eb[e]]++; }
  return c;
}

/**
 * Boundary loops as ordered vertex lists, oriented like the faces (interior on
 * the left seen from outside). Returns Int32Array[].
 */
export function boundaryLoops(nv, quads, E) {
  const next = new Int32Array(nv).fill(-1);
  for (let e = 0; e < E.ne; e++) {
    if (E.ef1[e] >= 0) continue;
    const f = E.ef0[e];
    for (let k = 0; k < 4; k++) {
      if (E.faceEdges[f * 4 + k] !== e) continue;
      next[quads[f * 4 + k]] = quads[f * 4 + ((k + 1) & 3)];
    }
  }
  const seen = new Uint8Array(nv), loops = [];
  for (let v = 0; v < nv; v++) {
    if (next[v] < 0 || seen[v]) continue;
    const loop = [];
    let c = v;
    while (c >= 0 && !seen[c]) { seen[c] = 1; loop.push(c); c = next[c]; }
    if (loop.length >= 3) loops.push(Int32Array.from(loop));
  }
  return loops;
}

/**
 * One level of Catmull-Clark subdivision (quads, with boundary creases).
 * Fine vertices: [0, nv) vertex points, [nv, nv+ne) edge points, [nv+ne, ...) face points.
 * Returns {nv, quads, stencil:{off, idx, w}, parents:{idx Int32Array(4n), w Float32Array(4n)}, E}
 * `stencil` reproduces the subdivided positions from any per-coarse-vertex
 * attribute; `parents` is the simple linear (bilinear) interpolation stencil.
 */
export function subdivide(nv, quads, E = buildEdges(nv, quads)) {
  const nf = quads.length >> 2, ne = E.ne;
  const nfv = nv + ne + nf;
  const bc = boundaryCounts(nv, E);
  // vertex -> incident faces / edges (counts)
  const vf = new Int32Array(nv), ve = new Int32Array(nv);
  for (let f = 0; f < nf; f++) for (let k = 0; k < 4; k++) vf[quads[f * 4 + k]]++;
  for (let e = 0; e < ne; e++) { ve[E.ea[e]]++; ve[E.eb[e]]++; }
  // boundary neighbours of each boundary vertex
  const bn0 = new Int32Array(nv).fill(-1), bn1 = new Int32Array(nv).fill(-1);
  for (let e = 0; e < ne; e++) {
    if (E.ef1[e] >= 0) continue;
    const a = E.ea[e], b = E.eb[e];
    if (bn0[a] < 0) bn0[a] = b; else bn1[a] = b;
    if (bn0[b] < 0) bn0[b] = a; else bn1[b] = a;
  }

  // ---- stencils (CSR built from a dynamic list; sizes are small)
  const sOff = new Int32Array(nfv + 1);
  const sIdx = [], sW = [];
  const acc = new Map();
  const add = (i, w) => acc.set(i, (acc.get(i) || 0) + w);
  const flush = (fv) => { for (const [i, w] of acc) { sIdx.push(i); sW.push(w); } acc.clear(); sOff[fv + 1] = sIdx.length; };

  // vertex points need, per vertex, its faces and edges: gather lists once
  const vfOff = new Int32Array(nv + 1), veOff = new Int32Array(nv + 1);
  for (let v = 0; v < nv; v++) { vfOff[v + 1] = vfOff[v] + vf[v]; veOff[v + 1] = veOff[v] + ve[v]; }
  const vfList = new Int32Array(vfOff[nv]), veList = new Int32Array(veOff[nv]);
  const vfFill = vfOff.slice(0, nv), veFill = veOff.slice(0, nv);
  for (let f = 0; f < nf; f++) for (let k = 0; k < 4; k++) { const v = quads[f * 4 + k]; vfList[vfFill[v]++] = f; }
  for (let e = 0; e < ne; e++) { veList[veFill[E.ea[e]]++] = e; veList[veFill[E.eb[e]]++] = e; }

  for (let v = 0; v < nv; v++) {
    if (bc[v] === 2 && bn1[v] >= 0) {
      add(v, 0.75); add(bn0[v], 0.125); add(bn1[v], 0.125);
    } else if (bc[v] > 0) {
      add(v, 1); // corner / non-manifold: keep
    } else {
      const n = ve[v];
      add(v, (n - 3) / n);
      // F term: (1/n) * avg of face points
      const nfa = vf[v];
      for (let j = vfOff[v]; j < vfOff[v + 1]; j++) {
        const f = vfList[j];
        for (let k = 0; k < 4; k++) add(quads[f * 4 + k], 1 / (n * nfa * 4));
      }
      // 2R/n: R = avg of edge midpoints
      for (let j = veOff[v]; j < veOff[v + 1]; j++) {
        const e = veList[j];
        add(E.ea[e], 1 / (n * n)); add(E.eb[e], 1 / (n * n));
      }
    }
    flush(v);
  }
  for (let e = 0; e < ne; e++) {
    const a = E.ea[e], b = E.eb[e];
    if (E.ef1[e] < 0) { add(a, 0.5); add(b, 0.5); } else {
      add(a, 0.25); add(b, 0.25);
      for (const f of [E.ef0[e], E.ef1[e]]) for (let k = 0; k < 4; k++) add(quads[f * 4 + k], 1 / 16);
    }
    flush(nv + e);
  }
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 4; k++) add(quads[f * 4 + k], 0.25);
    flush(nv + ne + f);
  }

  // ---- linear parents (<= 4 per fine vertex)
  const pIdx = new Int32Array(nfv * 4), pW = new Float32Array(nfv * 4);
  for (let v = 0; v < nv; v++) { pIdx[v * 4] = v; pW[v * 4] = 1; }
  for (let e = 0; e < ne; e++) { const o = (nv + e) * 4; pIdx[o] = E.ea[e]; pIdx[o + 1] = E.eb[e]; pW[o] = pW[o + 1] = 0.5; }
  for (let f = 0; f < nf; f++) { const o = (nv + ne + f) * 4; for (let k = 0; k < 4; k++) { pIdx[o + k] = quads[f * 4 + k]; pW[o + k] = 0.25; } }

  // ---- fine faces
  const fq = new Uint32Array(nf * 16);
  for (let f = 0; f < nf; f++) {
    const c = nv + ne + f;
    for (let k = 0; k < 4; k++) {
      const v = quads[f * 4 + k];
      const eNext = nv + E.faceEdges[f * 4 + k], ePrev = nv + E.faceEdges[f * 4 + ((k + 3) & 3)];
      const o = f * 16 + k * 4;
      fq[o] = v; fq[o + 1] = eNext; fq[o + 2] = c; fq[o + 3] = ePrev;
    }
  }
  return {
    nv: nfv, quads: fq,
    stencil: { off: sOff, idx: Int32Array.from(sIdx), w: Float32Array.from(sW) },
    parents: { idx: pIdx, w: pW },
    coarseEdges: E,
  };
}

/** out[i*dim + c] = sum_j w_j * src[idx_j*dim + c] over a CSR stencil. */
export function applyStencil(st, src, dim, out, n = st.off.length - 1) {
  const { off, idx, w } = st;
  for (let i = 0; i < n; i++) {
    const o = i * dim;
    for (let c = 0; c < dim; c++) out[o + c] = 0;
    for (let j = off[i]; j < off[i + 1]; j++) {
      const s = idx[j] * dim, ww = w[j];
      for (let c = 0; c < dim; c++) out[o + c] += ww * src[s + c];
    }
  }
  return out;
}

/** Same with the fixed 4-parent stencil. */
export function applyParents(par, src, dim, out, n = par.idx.length >> 2) {
  const { idx, w } = par;
  for (let i = 0; i < n; i++) {
    const o = i * dim;
    for (let c = 0; c < dim; c++) out[o + c] = 0;
    for (let k = 0; k < 4; k++) {
      const ww = w[i * 4 + k];
      if (!ww) continue;
      const s = idx[i * 4 + k] * dim;
      for (let c = 0; c < dim; c++) out[o + c] += ww * src[s + c];
    }
  }
  return out;
}

/** Area-weighted vertex normals of a quad mesh (quad normal from its diagonals). */
export function quadNormals(nv, quads, P, out = new Float32Array(nv * 3)) {
  out.fill(0, 0, nv * 3);
  const nf = quads.length >> 2;
  for (let f = 0; f < nf; f++) {
    const a = quads[f * 4] * 3, b = quads[f * 4 + 1] * 3, c = quads[f * 4 + 2] * 3, d = quads[f * 4 + 3] * 3;
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2];
    const vx = P[d] - P[b], vy = P[d + 1] - P[b + 1], vz = P[d + 2] - P[b + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
    out[d] += nx; out[d + 1] += ny; out[d + 2] += nz;
  }
  normalize3(out, nv);
  return out;
}

export function normalize3(A, n) {
  for (let i = 0; i < n; i++) {
    const o = i * 3, l = Math.hypot(A[o], A[o + 1], A[o + 2]);
    if (l > 1e-20) { A[o] /= l; A[o + 1] /= l; A[o + 2] /= l; } else { A[o] = 0; A[o + 1] = 1; A[o + 2] = 0; }
  }
  return A;
}

/** Breadth-first ring distance (in edges) from a seed set; unreachable = 255. */
export function ringDistance(nv, adjacency, seeds, maxRing = 254) {
  const d = new Uint8Array(nv).fill(255);
  let frontier = [];
  for (const s of seeds) { d[s] = 0; frontier.push(s); }
  const { off, adj } = adjacency;
  for (let r = 1; r <= maxRing && frontier.length; r++) {
    const nextF = [];
    for (const v of frontier) for (let j = off[v]; j < off[v + 1]; j++) {
      const u = adj[j];
      if (d[u] === 255) { d[u] = r; nextF.push(u); }
    }
    frontier = nextF;
  }
  return d;
}

/**
 * Multi-source geodesic distance along mesh edges (Dijkstra, binary heap),
 * stopped at maxDist. X: positions (n*3). Unreached = Infinity.
 */
export function edgeDistance(nv, adjacency, X, seeds, maxDist = Infinity) {
  const dist = new Float32Array(nv).fill(Infinity);
  const heapV = new Int32Array(Math.max(16, adjacency.adj.length + seeds.length)), heapD = new Float32Array(heapV.length);
  let size = 0;
  const push = (v, d) => {
    let i = size++;
    while (i > 0) { const p = (i - 1) >> 1; if (heapD[p] <= d) break; heapV[i] = heapV[p]; heapD[i] = heapD[p]; i = p; }
    heapV[i] = v; heapD[i] = d;
  };
  const pop = () => {
    const v = heapV[0], d = heapD[0];
    const lv = heapV[--size], ld = heapD[size];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= size) break;
      if (c + 1 < size && heapD[c + 1] < heapD[c]) c++;
      if (heapD[c] >= ld) break;
      heapV[i] = heapV[c]; heapD[i] = heapD[c]; i = c;
    }
    heapV[i] = lv; heapD[i] = ld;
    return [v, d];
  };
  for (const s of seeds) { dist[s] = 0; push(s, 0); }
  const { off, adj } = adjacency;
  while (size) {
    const [v, d] = pop();
    if (d > dist[v] || d > maxDist) continue;
    for (let j = off[v]; j < off[v + 1]; j++) {
      const u = adj[j];
      const nd = d + Math.hypot(X[u * 3] - X[v * 3], X[u * 3 + 1] - X[v * 3 + 1], X[u * 3 + 2] - X[v * 3 + 2]);
      if (nd < dist[u] && size < heapV.length) { dist[u] = nd; push(u, nd); }
    }
  }
  return dist;
}

/** 2D convex hull (monotone chain) of points [x0,z0,x1,z1...] -> hull point list. */
export function hull2(pts) {
  const n = pts.length / 2, idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => pts[a * 2] - pts[b * 2] || pts[a * 2 + 1] - pts[b * 2 + 1]);
  const cross = (o, a, b) => (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) - (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
  const lower = [], upper = [];
  for (const i of idx) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop(); lower.push(i); }
  for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop(); upper.push(i); }
  upper.pop(); lower.pop();
  return lower.concat(upper).map((i) => [pts[i * 2], pts[i * 2 + 1]]);
}

/** Radius of a convex polygon (around the origin) along direction (dx, dz). */
export function hullRadius(h, dx, dz) {
  let best = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    // ray o + t d intersect segment a-b
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (a[0] * ez - a[1] * ex) / den, u = (a[0] * dz - a[1] * dx) / den;
    if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && t > best) best = t;
  }
  return best;
}

