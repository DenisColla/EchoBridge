// Field -> triangle mesh (build time): narrow-band sampling + surface nets
// (dual contouring family: one vertex per surface cell, quads across every
// sign-changing grid edge), vertices projected onto the exact zero level set
// with Newton steps on the analytic field. Output is a closed, indexed mesh.

/**
 * @param {import('./sdf.js').Field} field
 * @param {number} h voxel size (m)
 * @returns {{positions: Float32Array, indices: Uint32Array, stats}}
 */
export function meshField(field, h, { block = 4, lipschitz = 1.7, project = 2 } = {}) {
  const t0 = Date.now();
  const pad = 3 * h;
  const o = [field.min[0] - pad, field.min[1] - pad, field.min[2] - pad];
  const B = block;
  // node counts, rounded up to whole blocks
  const n = [0, 1, 2].map((k) => Math.ceil((field.max[k] + pad - o[k]) / h / B) * B + 1);
  const [nx, ny, nz] = n;
  const sxy = nx * ny;
  const vals = new Float32Array(nx * ny * nz).fill(NaN);
  let evals = 0;
  const ev = (i, j, k) => {
    const id = i + j * nx + k * sxy;
    let v = vals[id];
    if (v !== v) { v = field.eval(o[0] + i * h, o[1] + j * h, o[2] + k * h); vals[id] = v; evals++; }
    return v;
  };
  // ---- coarse pass + active blocks
  const bx = (nx - 1) / B, by = (ny - 1) / B, bz = (nz - 1) / B;
  const thr = B * h * Math.sqrt(3) * 0.5 * lipschitz;
  const active = new Uint8Array(bx * by * bz);
  let nActive = 0;
  for (let K = 0; K < bz; K++) for (let J = 0; J < by; J++) for (let I = 0; I < bx; I++) {
    let mn = Infinity, pos = false, neg = false;
    for (let c = 0; c < 8; c++) {
      const v = ev((I + (c & 1)) * B, (J + ((c >> 1) & 1)) * B, (K + ((c >> 2) & 1)) * B);
      mn = Math.min(mn, Math.abs(v));
      if (v > 0) pos = true; else neg = true;
    }
    if (mn < thr || (pos && neg)) { active[I + J * bx + K * bx * by] = 1; nActive++; }
  }
  // ---- fine values in active blocks
  for (let K = 0; K < bz; K++) for (let J = 0; J < by; J++) for (let I = 0; I < bx; I++) {
    if (!active[I + J * bx + K * bx * by]) continue;
    for (let k = 0; k <= B; k++) for (let j = 0; j <= B; j++) for (let i = 0; i <= B; i++) ev(I * B + i, J * B + j, K * B + k);
  }
  // ---- surface nets vertices
  const cellVert = new Map(); // cell id -> vertex index
  const pos = [];
  const cx = nx - 1, cy = ny - 1;
  const cellId = (i, j, k) => i + j * cx + k * cx * cy;
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let K = 0; K < bz; K++) for (let J = 0; J < by; J++) for (let I = 0; I < bx; I++) {
    if (!active[I + J * bx + K * bx * by]) continue;
    for (let k = K * B; k < K * B + B; k++) for (let j = J * B; j < J * B + B; j++) for (let i = I * B; i < I * B + B; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const v = vals[(i + (c & 1)) + (j + ((c >> 1) & 1)) * nx + (k + ((c >> 2) & 1)) * sxy];
        corner[c] = v;
        if (v < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      let ax = 0, ay = 0, az = 0, cnt = 0;
      for (const [a, b] of EDGES) {
        const va = corner[a], vb = corner[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        const pa = [a & 1, (a >> 1) & 1, (a >> 2) & 1], pb = [b & 1, (b >> 1) & 1, (b >> 2) & 1];
        ax += pa[0] + (pb[0] - pa[0]) * t; ay += pa[1] + (pb[1] - pa[1]) * t; az += pa[2] + (pb[2] - pa[2]) * t;
        cnt++;
      }
      cellVert.set(cellId(i, j, k), pos.length / 3);
      pos.push(o[0] + (i + ax / cnt) * h, o[1] + (j + ay / cnt) * h, o[2] + (k + az / cnt) * h);
    }
  }
  // ---- quads across sign-changing edges
  const quads = [];
  const vAt = (i, j, k) => cellVert.get(cellId(i, j, k));
  for (const [cid, vi] of cellVert) {
    const i = cid % cx, j = Math.floor(cid / cx) % cy, k = Math.floor(cid / (cx * cy));
    const v0 = vals[i + j * nx + k * sxy];
    // edges from the cell's min corner along +x, +y, +z; the 4 cells around each edge
    // are (this cell) and its neighbours in the two other axes (negative side)
    const ends = [vals[i + 1 + j * nx + k * sxy], vals[i + (j + 1) * nx + k * sxy], vals[i + j * nx + (k + 1) * sxy]];
    for (let axis = 0; axis < 3; axis++) {
      const v1 = ends[axis];
      if (v1 !== v1 || (v0 < 0) === (v1 < 0)) continue;
      let a, b, c;
      if (axis === 0) { if (j === 0 || k === 0) continue; a = vAt(i, j - 1, k); b = vAt(i, j - 1, k - 1); c = vAt(i, j, k - 1); }
      else if (axis === 1) { if (i === 0 || k === 0) continue; a = vAt(i, j, k - 1); b = vAt(i - 1, j, k - 1); c = vAt(i - 1, j, k); }
      else { if (i === 0 || j === 0) continue; a = vAt(i - 1, j, k); b = vAt(i - 1, j - 1, k); c = vAt(i, j - 1, k); }
      if (a === undefined || b === undefined || c === undefined) continue;
      // inside (negative) at the edge start: one winding, otherwise the other
      if (v0 < 0) quads.push(vi, a, b, c); else quads.push(vi, c, b, a);
    }
  }
  const positions = new Float32Array(pos);
  // ---- project onto the level set
  for (let it = 0; it < project; it++) {
    for (let v = 0; v < positions.length; v += 3) {
      const x = positions[v], y = positions[v + 1], z = positions[v + 2];
      const d = field.eval(x, y, z);
      if (Math.abs(d) < h * 1e-3) continue;
      const g = field.grad(x, y, z, h * 0.25);
      let step = d / Math.max(0.3, g[3]);
      step = Math.max(-h * 0.75, Math.min(h * 0.75, step));
      positions[v] = x - g[0] * step; positions[v + 1] = y - g[1] * step; positions[v + 2] = z - g[2] * step;
    }
  }
  // ---- triangulate along the shorter diagonal
  const idx = new Uint32Array((quads.length / 4) * 6);
  let t = 0;
  const d2 = (a, b) => { const x = positions[a * 3] - positions[b * 3], y = positions[a * 3 + 1] - positions[b * 3 + 1], z = positions[a * 3 + 2] - positions[b * 3 + 2]; return x * x + y * y + z * z; };
  for (let q = 0; q < quads.length; q += 4) {
    const a = quads[q], b = quads[q + 1], c = quads[q + 2], d = quads[q + 3];
    if (d2(a, c) <= d2(b, d)) { idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = a; idx[t++] = c; idx[t++] = d; }
    else { idx[t++] = a; idx[t++] = b; idx[t++] = d; idx[t++] = b; idx[t++] = c; idx[t++] = d; }
  }
  return { positions, indices: idx, stats: { grid: n, evals, activeBlocks: nActive, verts: positions.length / 3, tris: idx.length / 3, ms: Date.now() - t0 } };
}
