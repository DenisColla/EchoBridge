// Local garment-vs-body collision projection. Every garment vertex knows the
// body vertex it comes from; the body faces within two rings of it (BodyTopo
// nearFaces) are the only ones it can penetrate in the rest pose. Points
// closer than their minimum offset to the closest of those faces (signed by
// the face normal) are pushed out along that face normal. Only vertices in
// concave areas (creases: groin, buttocks, armpits, under the bust, toes) and
// near garment edges are tested, so the cost stays small.

/** Closest point on triangle abc to p (Ericson). Writes into out[0..2]. */
function closestTri(px, py, pz, P, a, b, c, out) {
  const ax = P[a], ay = P[a + 1], az = P[a + 2];
  const abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az;
  const acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = P[b]; out[1] = P[b + 1]; out[2] = P[b + 2]; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v; return; }
  const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = P[c]; out[1] = P[c + 1]; out[2] = P[c + 2]; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = P[b] + (P[c] - P[b]) * w; out[1] = P[b + 1] + (P[c + 1] - P[b + 1]) * w; out[2] = P[b + 2] + (P[c + 2] - P[b + 2]) * w; return;
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}

const _cp = new Float64Array(3);

/**
 * Pushes points X (n) out of the body. src[i] = body vertex whose neighbourhood
 * is searched; minOff[i] = required clearance; test[i] = 1 to process.
 * Returns the number of corrected points.
 */
export function collideBody(bi, n, X, src, minOff, test, iterations = 3) {
  const topo = bi.topo, P = bi.P, Q = topo.quads, { off, list } = topo.nearFaces;
  const FN = bi.faceNormals();
  let fixed = 0;
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      if (test && !test[i]) continue;
      const v = src[i];
      if (v < 0) continue;
      const o = i * 3;
      let px = X[o], py = X[o + 1], pz = X[o + 2];
      let bd = Infinity, bf = -1, cx = 0, cy = 0, cz = 0;
      for (let j = off[v]; j < off[v + 1]; j++) {
        const f = list[j], q = f * 4;
        for (let t = 0; t < 2; t++) {
          closestTri(px, py, pz, P, Q[q] * 3, Q[q + 1 + t] * 3, Q[q + 2 + t] * 3, _cp);
          const d = (px - _cp[0]) ** 2 + (py - _cp[1]) ** 2 + (pz - _cp[2]) ** 2;
          if (d < bd) { bd = d; bf = f; cx = _cp[0]; cy = _cp[1]; cz = _cp[2]; }
        }
      }
      if (bf < 0 || bd > 0.0016) continue; // farther than 4 cm: not our business
      const fx = FN[bf * 3], fy = FN[bf * 3 + 1], fz = FN[bf * 3 + 2];
      const sd = (px - cx) * fx + (py - cy) * fy + (pz - cz) * fz;
      const need = minOff[i];
      if (sd >= need) continue;
      const k = need - sd;
      X[o] = px + fx * k; X[o + 1] = py + fy * k; X[o + 2] = pz + fz * k;
      moved++;
    }
    fixed += moved;
    if (!moved) break;
  }
  return fixed;
}
