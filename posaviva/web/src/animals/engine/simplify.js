// Quadric error metric edge-collapse decimation (build time), after Garland &
// Heckbert, organised like the "fast quadric mesh simplification" scheme:
// per-triangle cached edge errors, a growing error threshold per pass,
// flip / degeneracy checks, periodic compaction. Positions are normalised to
// a unit box during the run so the thresholds are scale independent.

export function simplify(positions, indices, target, { aggressiveness = 7, maxIter = 120, weights = null } = {}) {
  let nv = positions.length / 3;
  let nt = indices.length / 3;
  if (nt <= target) return { positions, indices };
  // normalise
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], positions[i * 3 + k]); mx[k] = Math.max(mx[k], positions[i * 3 + k]); }
  const sc = 1 / Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  const P = new Float64Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) P[i] = (positions[i] - mn[i % 3]) * sc;
  const Q = new Float64Array(nv * 10);
  const tstart = new Int32Array(nv), tcount = new Int32Array(nv), border = new Uint8Array(nv);
  let TV = Int32Array.from(indices);
  let TE = new Float64Array(nt * 4), TD = new Uint8Array(nt), TDirty = new Uint8Array(nt), TN = new Float64Array(nt * 3);
  let refT = new Int32Array(nt * 3 * 2), refV = new Int8Array(nt * 3 * 2), nref = 0;
  const pushRef = (t, v) => {
    if (nref >= refT.length) {
      const a = new Int32Array(refT.length * 2); a.set(refT); refT = a;
      const b = new Int8Array(refV.length * 2); b.set(refV); refV = b;
    }
    refT[nref] = t; refV[nref] = v; nref++;
  };

  const det = (q, o, a11, a12, a13, a21, a22, a23, a31, a32, a33) =>
    q[o + a11] * q[o + a22] * q[o + a33] + q[o + a13] * q[o + a21] * q[o + a32] + q[o + a12] * q[o + a23] * q[o + a31]
    - q[o + a13] * q[o + a22] * q[o + a31] - q[o + a11] * q[o + a23] * q[o + a32] - q[o + a12] * q[o + a21] * q[o + a33];
  const qs = new Float64Array(10);
  const vErr = (q, x, y, z) => q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
  const res = [0, 0, 0];
  function calcError(a, b) {
    for (let k = 0; k < 10; k++) qs[k] = Q[a * 10 + k] + Q[b * 10 + k];
    const bd = border[a] & border[b];
    const d = det(qs, 0, 0, 1, 2, 1, 4, 5, 2, 5, 7);
    if (Math.abs(d) > 1e-15 && !bd) {
      res[0] = (-1 / d) * det(qs, 0, 1, 2, 3, 4, 5, 6, 5, 7, 8);
      res[1] = (1 / d) * det(qs, 0, 0, 2, 3, 1, 5, 6, 2, 7, 8);
      res[2] = (-1 / d) * det(qs, 0, 0, 1, 3, 1, 4, 6, 2, 5, 8);
      // keep the optimum near the edge (ill conditioned quadrics on flat areas)
      const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], ez = P[b * 3 + 2] - P[a * 3 + 2];
      const el = Math.hypot(ex, ey, ez);
      const mx_ = (P[a * 3] + P[b * 3]) / 2, my_ = (P[a * 3 + 1] + P[b * 3 + 1]) / 2, mz_ = (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
      if (Math.hypot(res[0] - mx_, res[1] - my_, res[2] - mz_) < el * 2) return vErr(qs, res[0], res[1], res[2]);
    }
    let best = Infinity;
    for (let s = 0; s < 3; s++) {
      const t = s * 0.5;
      const x = P[a * 3] + (P[b * 3] - P[a * 3]) * t, y = P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t, z = P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * t;
      const e = vErr(qs, x, y, z);
      if (e < best) { best = e; res[0] = x; res[1] = y; res[2] = z; }
    }
    return best;
  }

  function updateMesh(iter) {
    if (iter > 0) { // compact triangles
      let dst = 0;
      for (let i = 0; i < nt; i++) {
        if (TD[i]) continue;
        if (dst !== i) {
          TV[dst * 3] = TV[i * 3]; TV[dst * 3 + 1] = TV[i * 3 + 1]; TV[dst * 3 + 2] = TV[i * 3 + 2];
          for (let k = 0; k < 4; k++) TE[dst * 4 + k] = TE[i * 4 + k];
          for (let k = 0; k < 3; k++) TN[dst * 3 + k] = TN[i * 3 + k];
          TDirty[dst] = TDirty[i];
        }
        TD[dst] = 0;
        dst++;
      }
      nt = dst;
    }
    tcount.fill(0);
    for (let i = 0; i < nt * 3; i++) tcount[TV[i]]++;
    let s = 0;
    for (let v = 0; v < nv; v++) { tstart[v] = s; s += tcount[v]; tcount[v] = 0; }
    nref = s;
    if (refT.length < s) { refT = new Int32Array(s * 2); refV = new Int8Array(s * 2); }
    for (let i = 0; i < nt; i++) for (let j = 0; j < 3; j++) {
      const v = TV[i * 3 + j];
      const r = tstart[v] + tcount[v];
      refT[r] = i; refV[r] = j; tcount[v]++;
    }
    if (iter === 0) {
      // borders: an edge used by one triangle only
      border.fill(0);
      const ids = [], cnt = [];
      for (let v = 0; v < nv; v++) {
        ids.length = 0; cnt.length = 0;
        for (let k = 0; k < tcount[v]; k++) {
          const t = refT[tstart[v] + k];
          for (let j = 0; j < 3; j++) {
            const id = TV[t * 3 + j];
            const f = ids.indexOf(id);
            if (f < 0) { ids.push(id); cnt.push(1); } else cnt[f]++;
          }
        }
        for (let j = 0; j < ids.length; j++) if (cnt[j] === 1) border[ids[j]] = 1;
      }
      Q.fill(0);
      for (let i = 0; i < nt; i++) {
        const a = TV[i * 3], b = TV[i * 3 + 1], c = TV[i * 3 + 2];
        const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
        const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        TN[i * 3] = nx; TN[i * 3 + 1] = ny; TN[i * 3 + 2] = nz;
        const d = -(nx * P[a * 3] + ny * P[a * 3 + 1] + nz * P[a * 3 + 2]);
        const m = [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
        for (const v of [a, b, c]) { const w = weights ? weights[v] : 1; for (let k = 0; k < 10; k++) Q[v * 10 + k] += m[k] * w; }
      }
      for (let i = 0; i < nt; i++) {
        for (let j = 0; j < 3; j++) TE[i * 4 + j] = calcError(TV[i * 3 + j], TV[i * 3 + (j + 1) % 3]);
        TE[i * 4 + 3] = Math.min(TE[i * 4], TE[i * 4 + 1], TE[i * 4 + 2]);
      }
    }
  }

  const del0 = new Uint8Array(4096), del1 = new Uint8Array(4096);
  function flipped(px, py, pz, i0, i1, del) {
    for (let k = 0; k < tcount[i0]; k++) {
      const t = refT[tstart[i0] + k];
      if (TD[t]) continue;
      const s = refV[tstart[i0] + k];
      const id1 = TV[t * 3 + (s + 1) % 3], id2 = TV[t * 3 + (s + 2) % 3];
      if (id1 === i1 || id2 === i1) { del[k] = 1; continue; }
      let ax = P[id1 * 3] - px, ay = P[id1 * 3 + 1] - py, az = P[id1 * 3 + 2] - pz;
      let bx = P[id2 * 3] - px, by = P[id2 * 3 + 1] - py, bz = P[id2 * 3 + 2] - pz;
      const la = Math.hypot(ax, ay, az) || 1, lb = Math.hypot(bx, by, bz) || 1;
      ax /= la; ay /= la; az /= la; bx /= lb; by /= lb; bz /= lb;
      if (Math.abs(ax * bx + ay * by + az * bz) > 0.999) return true;
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const ln = Math.hypot(nx, ny, nz) || 1;
      nx /= ln; ny /= ln; nz /= ln;
      del[k] = 0;
      if (nx * TN[t * 3] + ny * TN[t * 3 + 1] + nz * TN[t * 3 + 2] < 0.2) return true;
    }
    return false;
  }
  let deletedCount = 0;
  function updateTriangles(i0, v, del) {
    for (let k = 0; k < tcount[v]; k++) {
      const r = tstart[v] + k;
      const t = refT[r];
      if (TD[t]) continue;
      if (del[k]) { TD[t] = 1; deletedCount++; continue; }
      TV[t * 3 + refV[r]] = i0;
      TDirty[t] = 1;
      // refresh the normal
      const a = TV[t * 3], b = TV[t * 3 + 1], c = TV[t * 3 + 2];
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      TN[t * 3] = nx / l; TN[t * 3 + 1] = ny / l; TN[t * 3 + 2] = nz / l;
      TE[t * 4] = calcError(a, b); TE[t * 4 + 1] = calcError(b, c); TE[t * 4 + 2] = calcError(c, a);
      TE[t * 4 + 3] = Math.min(TE[t * 4], TE[t * 4 + 1], TE[t * 4 + 2]);
      pushRef(t, refV[r]);
    }
  }

  const startTris = nt;
  for (let iter = 0; iter < maxIter; iter++) {
    if (startTris - deletedCount <= target) break;
    if (iter % 5 === 0) { updateMesh(iter); }
    TDirty.fill(0, 0, nt);
    const threshold = 1e-9 * Math.pow(iter + 3, aggressiveness);
    for (let i = 0; i < nt; i++) {
      if (TE[i * 4 + 3] > threshold || TD[i] || TDirty[i]) continue;
      for (let j = 0; j < 3; j++) {
        if (TE[i * 4 + j] >= threshold) continue;
        const i0 = TV[i * 3 + j], i1 = TV[i * 3 + (j + 1) % 3];
        if (border[i0] !== border[i1]) continue;
        calcError(i0, i1);
        const px = res[0], py = res[1], pz = res[2];
        if (tcount[i0] > del0.length || tcount[i1] > del1.length) continue;
        if (flipped(px, py, pz, i0, i1, del0)) continue;
        if (flipped(px, py, pz, i1, i0, del1)) continue;
        P[i0 * 3] = px; P[i0 * 3 + 1] = py; P[i0 * 3 + 2] = pz;
        for (let k = 0; k < 10; k++) Q[i0 * 10 + k] += Q[i1 * 10 + k];
        const ts = nref;
        updateTriangles(i0, i0, del0);
        updateTriangles(i0, i1, del1);
        const tc = nref - ts;
        if (tc <= tcount[i0]) {
          if (tc) refT.copyWithin(tstart[i0], ts, ts + tc), refV.copyWithin(tstart[i0], ts, ts + tc);
        } else tstart[i0] = ts;
        tcount[i0] = tc;
        break;
      }
      if (startTris - deletedCount <= target) break;
    }
  }
  // compact
  const used = new Int32Array(nv).fill(-1);
  const outT = [];
  for (let i = 0; i < nt; i++) {
    if (TD[i]) continue;
    const a = TV[i * 3], b = TV[i * 3 + 1], c = TV[i * 3 + 2];
    if (a === b || b === c || a === c) continue;
    outT.push(a, b, c);
  }
  let nOut = 0;
  for (const v of outT) if (used[v] < 0) used[v] = nOut++;
  const outP = new Float32Array(nOut * 3);
  for (let v = 0; v < nv; v++) if (used[v] >= 0) for (let k = 0; k < 3; k++) outP[used[v] * 3 + k] = P[v * 3 + k] / sc + mn[k];
  const outI = new Uint32Array(outT.length);
  for (let i = 0; i < outT.length; i++) outI[i] = used[outT[i]];
  return { positions: outP, indices: outI };
}
