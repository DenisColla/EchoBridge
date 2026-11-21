// Model-level face analysis, computed once per HumanModel and shared by every
// character (topology does not change with the body shape):
//
//   lashGrids  the MakeHuman eyelash helper (group 'eyelashes') is made of four
//              quad grids (upper / lower lid of each eye), 5 rows from the lid
//              margin (row 0) to the lash tips. The helper vertices are part of
//              the expression morphs, so they follow blinks: lash geometry is
//              generated along these grids.
//   browFaces  skin triangles around the eyebrows (projection targets).
//   eyeUV      UV of the gaze axis of each eyeball (centre of the painted iris).
import * as THREE from 'three';

const cache = new WeakMap();

/** @returns {{lashGrids: LashGrid[], browTris: Uint32Array, eyeUV: number[][]}} */
export function faceLandmarks(model, ch) {
  let L = cache.get(model);
  if (!L) {
    L = { lashGrids: extractLashGrids(model, ch), browTris: collectBrowTris(model, ch), eyeUV: eyeUVCenters(model, ch) };
    cache.set(model, L);
  }
  return L;
}

/** Rest position (rig space) of a bone head of this character. */
export function boneRestPos(ch, name, out = new THREE.Vector3()) {
  const i = ch.model.boneIndex.get(name);
  return out.setFromMatrixPosition(ch.restGlobal[i]);
}

// ---------------------------------------------------------------- lash grids
/**
 * @typedef {{side: 1|-1, upper: boolean, rows: number, cols: number, v: Uint32Array}} LashGrid
 * side +1 = character's left eye (+X), v[r * cols + c] = mesh vertex, row 0 on the
 * lid margin, column 0 at the inner (medial) corner.
 */
function extractLashGrids(model, ch) {
  const P = ch.shapePositions;
  const quads = model.groupFaces[model.groups.indexOf('eyelashes')].map((f) => [0, 1, 2, 3].map((k) => model.faceV[f * 4 + k]));
  // connected components (union-find)
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const q of quads) for (const v of q) if (!parent.has(v)) parent.set(v, v);
  for (const q of quads) for (let k = 1; k < 4; k++) { const a = find(q[0]), b = find(q[k]); if (a !== b) parent.set(a, b); }
  const comps = new Map();
  for (const q of quads) { const r = find(q[0]); (comps.get(r) || comps.set(r, []).get(r)).push(q); }

  const eyeL = boneRestPos(ch, 'eye.L'), eyeR = boneRestPos(ch, 'eye.R');
  const grids = [];
  for (const cq of comps.values()) {
    const g = gridFromQuads(cq, P, eyeL, eyeR);
    if (g) grids.push(g);
  }
  return grids;
}

function gridFromQuads(quads, P, eyeL, eyeR) {
  const ekey = (a, b) => (a < b ? a * 65536 + b : b * 65536 + a);
  const vQuads = new Map(), edgeN = new Map();
  quads.forEach((q, qi) => {
    for (let k = 0; k < 4; k++) {
      (vQuads.get(q[k]) || vQuads.set(q[k], []).get(q[k])).push(qi);
      const e = ekey(q[k], q[(k + 1) % 4]);
      edgeN.set(e, (edgeN.get(e) || 0) + 1);
    }
  });
  // border walk
  const bAdj = new Map();
  for (const q of quads) for (let k = 0; k < 4; k++) {
    const a = q[k], b = q[(k + 1) % 4];
    if (edgeN.get(ekey(a, b)) !== 1) continue;
    (bAdj.get(a) || bAdj.set(a, []).get(a)).push(b);
    (bAdj.get(b) || bAdj.set(b, []).get(b)).push(a);
  }
  const corners = [...vQuads].filter(([, qs]) => qs.length === 1).map(([v]) => v);
  if (corners.length !== 4) return null;
  const loop = [corners[0]];
  for (let prev = -1, cur = corners[0]; ;) {
    const nx = bAdj.get(cur).find((x) => x !== prev && x !== loop[0]);
    if (nx === undefined || loop.includes(nx)) break;
    loop.push(nx); prev = cur; cur = nx;
  }
  // split the loop into its 4 sides
  const sides = [];
  let curSide = [loop[0]];
  for (let i = 1; i <= loop.length; i++) {
    const v = loop[i % loop.length];
    curSide.push(v);
    if (corners.includes(v)) { sides.push(curSide); curSide = [v]; }
  }
  sides.sort((a, b) => b.length - a.length);
  const longs = sides.slice(0, 2), shortLen = sides[3].length;
  const cx = longs[0].reduce((s, v) => s + P[v * 3], 0) / longs[0].length;
  const side = cx >= 0 ? 1 : -1;
  const eye = side > 0 ? eyeL : eyeR;
  const meanDist = (s) => s.reduce((acc, v) => acc + Math.hypot(P[v * 3] - eye.x, P[v * 3 + 1] - eye.y, P[v * 3 + 2] - eye.z), 0) / s.length;
  let root = meanDist(longs[0]) < meanDist(longs[1]) ? longs[0] : longs[1];
  if (Math.abs(P[root[0] * 3]) > Math.abs(P[root[root.length - 1] * 3])) root = root.slice().reverse(); // medial first
  // march rows across the quads
  const rows = [root];
  const quadWith = (a, b, avoid) => {
    for (const qi of vQuads.get(a)) {
      const q = quads[qi];
      if (!q.includes(b)) continue;
      if (avoid && (q.includes(avoid[0]) || q.includes(avoid[1]))) continue;
      return q;
    }
    return null;
  };
  const across = (q, a, b) => { const i = q.indexOf(a); const n1 = q[(i + 1) % 4], n3 = q[(i + 3) % 4]; return n1 === b ? n3 : n1; };
  for (let r = 1; r < shortLen; r++) {
    const prev = rows[r - 1], back = r > 1 ? rows[r - 2] : null;
    const next = new Array(prev.length);
    for (let k = 0; k < prev.length - 1; k++) {
      const q = quadWith(prev[k], prev[k + 1], back ? [back[k], back[k + 1]] : null);
      if (!q) return null;
      next[k] = across(q, prev[k], prev[k + 1]);
      next[k + 1] = across(q, prev[k + 1], prev[k]);
    }
    rows.push(next);
  }
  const cols = root.length, nRows = rows.length;
  const v = new Uint32Array(cols * nRows);
  rows.forEach((row, r) => row.forEach((x, c) => { v[r * cols + c] = x; }));
  // upper lid if the grid lies above the eye centre
  let my = 0;
  for (const x of v) my += P[x * 3 + 1];
  my /= v.length;
  return { side, upper: my > eye.y, rows: nRows, cols, v };
}

// ---------------------------------------------------------------- brow region
/** Skin triangles (mesh-vertex index triplets) of the forehead / brow area. */
function collectBrowTris(model, ch) {
  const P = ch.shapePositions;
  const eL = boneRestPos(ch, 'eye.L'), eR = boneRestPos(ch, 'eye.R');
  const ey = (eL.y + eR.y) / 2, ez = (eL.z + eR.z) / 2, ipd = eL.x - eR.x;
  const s = ipd / 0.058; // region scales with the face
  const out = [];
  for (const f of model.groupFaces[0]) {
    let x = 0, y = 0, z = 0, n = 0;
    for (let k = 0; k < 4; k++) { const v = model.faceV[f * 4 + k]; if (v === 0xffff) continue; x += P[v * 3]; y += P[v * 3 + 1]; z += P[v * 3 + 2]; n++; }
    x /= n; y /= n; z /= n;
    if (Math.abs(x) > 0.09 * s || y < ey - 0.014 * s || y > ey + 0.07 * s || z < ez - 0.05 * s) continue;
    const a = model.faceV[f * 4], b = model.faceV[f * 4 + 1], c = model.faceV[f * 4 + 2], d = model.faceV[f * 4 + 3];
    out.push(a, b, c);
    if (d !== 0xffff) out.push(a, c, d);
  }
  return Uint32Array.from(out);
}

// ---------------------------------------------------------------- eyeball UVs
/** UV where the gaze axis (eye bone +Y) pierces each eyeball (cornea shells excluded). */
function eyeUVCenters(model, ch) {
  const e = model.eyes, g = ch.eyeMesh.geometry;
  const P = g.attributes.position.array, UV = g.attributes.uv.array, I = g.index.array;
  const isCornea = (i) => UV[i * 2] > 0.85 && UV[i * 2 + 1] < 0.15;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3(), bc = new THREE.Vector3();
  const fallback = [[0.2987, 0.2944], [0.6996, 0.6952]];
  return [0, 1].map((s) => {
    const G = ch.restGlobal[model.boneIndex.get(s === 0 ? 'eye.L' : 'eye.R')];
    const ray = new THREE.Ray(new THREE.Vector3().setFromMatrixPosition(G), new THREE.Vector3().setFromMatrixColumn(G, 1).normalize());
    let best = null, bestD = -1;
    for (let t = 0; t < I.length; t += 3) {
      const i0 = I[t], i1 = I[t + 1], i2 = I[t + 2];
      if (e.side[e.rv2v[i0]] !== s || isCornea(i0)) continue;
      a.fromArray(P, i0 * 3); b.fromArray(P, i1 * 3); c.fromArray(P, i2 * 3);
      if (!ray.intersectTriangle(a, b, c, false, hit)) continue;
      const d = hit.distanceTo(ray.origin);
      if (d <= bestD) continue;
      THREE.Triangle.getBarycoord(hit, a, b, c, bc);
      bestD = d;
      best = [bc.x * UV[i0 * 2] + bc.y * UV[i1 * 2] + bc.z * UV[i2 * 2], bc.x * UV[i0 * 2 + 1] + bc.y * UV[i1 * 2 + 1] + bc.z * UV[i2 * 2 + 1]];
    }
    return best || fallback[s];
  });
}
