// Procedural eyelashes. The MakeHuman eyelash helper is a set of quad grids
// (see landmarks.js) that follow the lid expression morphs; here each grid is
// used as a "guide surface": individual tapered lashes (3-sided tubes) run from
// the lid margin (row 0) towards the tip row, plus a thin dark root band that
// reads as the lash line from a distance. Positions are re-evaluated from
// ch.restPositions whenever the shape or the expression changes (blinks), and
// the mesh is skinned like the helper vertices it is built on.
import * as THREE from 'three';
import { rng } from './eyeTexture.js';

const SIDES = 3; // tube cross-section
const RINGS = 3; // rings before the tip point
const V_PER_LASH = SIDES * RINGS + 1;
/** spine samples (fraction of the lash length) of the rings + tip */
const SPINE_T = [0, 0.34, 0.68, 1];
/** tube radius profile (fraction of the root radius) */
const RADIUS_T = [1, 0.72, 0.38];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Lid styles: lash count, length profile along the lid (u: 0 inner corner .. 1 outer), root radius (m), band height (rows). */
const LID = {
  upper: { count: 96, clump: 3, radius: 0.00013, band: 0.13, seed: 3, len: (u) => (0.52 + 0.6 * smooth(0, 0.62, u)) * (1 - 0.2 * smooth(0.9, 1, u)), spread: 0.45, extra: 0.16 },
  lower: { count: 30, clump: 2, radius: 0.00008, band: 0.06, seed: 5, len: (u) => (0.3 + 0.32 * smooth(0.1, 0.72, u)) * (1 - 0.3 * smooth(0.9, 1, u)), spread: 0.8, extra: 0 },
};

export class Lashes {
  /**
   * @param {import('../core/Character.js').Character} ch
   * @param {import('./landmarks.js').LashGrid[]} grids
   */
  constructor(ch, grids) {
    this.ch = ch;
    this.grids = grids;
    this._layout();
    this._buildGeometry();
    const mesh = new THREE.SkinnedMesh(this.geometry, []);
    mesh.name = 'face:lashes';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.faceModule = 'lashes';
    mesh.userData.pickable = false;
    this.mesh = mesh;
  }

  /** Lash parameters along the grids (independent of the body shape). */
  _layout() {
    const lashes = []; // {g, c[4], r[4], rad}
    const bands = []; // {g, cols: [c...], rTop}
    this.grids.forEach((grid, gi) => {
      const P = LID[grid.upper ? 'upper' : 'lower'];
      const rnd = rng(P.seed); // same sequence for both eyes -> mirror-symmetric lashes
      const C = grid.cols - 1, R = grid.rows - 1;
      let clumpFan = 0;
      for (let i = 0; i < P.count; i++) {
        // lashes come in small clumps whose tips converge (mascara-like, reads well)
        if (i % P.clump === 0) clumpFan = (rnd() - 0.5) * P.spread;
        // denser towards the outer corner
        const u0 = Math.min(1, Math.max(0, (i + 0.5 + (rnd() - 0.5) * 0.7) / P.count));
        const u = Math.pow(u0, 0.88);
        const len = P.len(u) * (0.84 + 0.22 * rnd());
        const fan = clumpFan + (rnd() - 0.5) * 0.12 + (u - 0.5) * 0.6; // columns of drift at the tip (+ outward fan)
        const extra = P.extra * (0.6 + 0.8 * rnd());
        const c = [], r = [];
        for (const t of SPINE_T) {
          c.push(Math.min(C, Math.max(0, u * C + fan * Math.pow(t, 1.4))));
          // rows beyond R extrapolate the last segment (longer lashes than the helper)
          r.push(R * len * t * (1 + extra * t));
        }
        lashes.push({ g: gi, c, r, rad: P.radius * (0.8 + 0.4 * rnd()) });
      }
      const cols = [];
      for (let k = 0; k <= C * 3; k++) cols.push(k / 3);
      bands.push({ g: gi, cols, rTop: R * P.band });
    });
    this.lashes = lashes;
    this.bands = bands;
  }

  _buildGeometry() {
    const m = this.ch.model;
    let nv = this.lashes.length * V_PER_LASH;
    for (const b of this.bands) nv += b.cols.length * 2;
    const idx = [];
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    const copySkin = (dst, v) => { for (let k = 0; k < 4; k++) { si[dst * 4 + k] = m.skinIndex[v * 4 + k]; sw[dst * 4 + k] = m.skinWeight[v * 4 + k]; } };
    let o = 0;
    for (const L of this.lashes) {
      const grid = this.grids[L.g];
      const rootV = grid.v[Math.round(L.c[0])];
      for (let k = 0; k < V_PER_LASH; k++) copySkin(o + k, rootV);
      for (let ring = 0; ring < RINGS - 1; ring++) {
        for (let j = 0; j < SIDES; j++) {
          const a = o + ring * SIDES + j, b = o + ring * SIDES + (j + 1) % SIDES;
          const c = b + SIDES, d = a + SIDES;
          idx.push(a, b, c, a, c, d);
        }
      }
      const tip = o + RINGS * SIDES, last = o + (RINGS - 1) * SIDES;
      for (let j = 0; j < SIDES; j++) idx.push(last + j, last + (j + 1) % SIDES, tip);
      o += V_PER_LASH;
    }
    this._bandStart = o;
    for (const B of this.bands) {
      const grid = this.grids[B.g], n = B.cols.length;
      for (let k = 0; k < n; k++) {
        const rootV = grid.v[Math.round(B.cols[k])];
        copySkin(o + k * 2, rootV); copySkin(o + k * 2 + 1, rootV);
        if (k < n - 1) { const a = o + k * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
      }
      o += n * 2;
    }
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(nv * 3);
    this.nor = new Float32Array(nv * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.setIndex(nv < 65535 ? new THREE.BufferAttribute(Uint16Array.from(idx), 1) : new THREE.BufferAttribute(Uint32Array.from(idx), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10); // CPU-updated, culling disabled anyway
    this.geometry = geo;
  }

  /** Re-evaluates every vertex from the current rest positions (shape + expression). */
  update() {
    const R = this.ch.restPositions, pos = this.pos, nor = this.nor;
    const sp = _sp, tg = _tg, side = _side, bin = _bin, lid = _lid;
    let o = 0;
    for (const L of this.lashes) {
      const grid = this.grids[L.g];
      for (let k = 0; k < 4; k++) evalGrid(R, grid, L.c[k], L.r[k], sp[k]);
      // lid direction at the root (frame reference)
      evalGrid(R, grid, Math.min(grid.cols - 1, L.c[0] + 0.5), 0, lid);
      evalGrid(R, grid, Math.max(0, L.c[0] - 0.5), 0, _tmp);
      lid.sub(_tmp);
      for (let ring = 0; ring < RINGS; ring++) {
        const p = sp[ring];
        tg.subVectors(sp[Math.min(3, ring + 1)], sp[Math.max(0, ring - 1)]).normalize();
        side.copy(lid).addScaledVector(tg, -lid.dot(tg));
        if (side.lengthSq() < 1e-14) side.set(1, 0, 0);
        side.normalize();
        bin.crossVectors(tg, side);
        const rad = L.rad * RADIUS_T[ring];
        for (let j = 0; j < SIDES; j++) {
          const a = (j / SIDES) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
          const nx = ca * side.x + sa * bin.x, ny = ca * side.y + sa * bin.y, nz = ca * side.z + sa * bin.z;
          const v = (o + ring * SIDES + j) * 3;
          pos[v] = p.x + nx * rad; pos[v + 1] = p.y + ny * rad; pos[v + 2] = p.z + nz * rad;
          nor[v] = nx; nor[v + 1] = ny; nor[v + 2] = nz;
        }
      }
      const tv = (o + RINGS * SIDES) * 3;
      tg.subVectors(sp[3], sp[2]).normalize();
      pos[tv] = sp[3].x; pos[tv + 1] = sp[3].y; pos[tv + 2] = sp[3].z;
      nor[tv] = tg.x; nor[tv + 1] = tg.y; nor[tv + 2] = tg.z;
      o += V_PER_LASH;
    }
    for (const B of this.bands) {
      const grid = this.grids[B.g], n = B.cols.length;
      for (let k = 0; k < n; k++) {
        const c = B.cols[k];
        evalGrid(R, grid, c, 0, sp[0]);
        evalGrid(R, grid, c, B.rTop, sp[1]);
        // band normal: along-lid x root->top
        evalGrid(R, grid, Math.min(grid.cols - 1, c + 0.34), 0, lid);
        evalGrid(R, grid, Math.max(0, c - 0.34), 0, _tmp);
        lid.sub(_tmp);
        tg.subVectors(sp[1], sp[0]);
        side.crossVectors(lid, tg).normalize();
        if (grid.side < 0) side.negate();
        for (let h = 0; h < 2; h++) {
          const v = (o + k * 2 + h) * 3, p = sp[h];
          pos[v] = p.x; pos[v + 1] = p.y; pos[v + 2] = p.z;
          nor[v] = side.x; nor[v + 1] = side.y; nor[v + 2] = side.z;
        }
      }
      o += n * 2;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }

  dispose() { this.geometry.dispose(); }
}

const _sp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _tg = new THREE.Vector3(), _side = new THREE.Vector3(), _bin = new THREE.Vector3(), _lid = new THREE.Vector3(), _tmp = new THREE.Vector3();

/**
 * Bilinear point of a lash grid at fractional column c / row r (mesh rest
 * positions P). Rows beyond the last one extrapolate the last row segment.
 */
function evalGrid(P, grid, c, r, out) {
  const C = grid.cols, Rn = grid.rows, V = grid.v;
  const c0 = Math.min(C - 2, Math.max(0, Math.floor(c))), fc = c - c0;
  let r0 = Math.min(Rn - 2, Math.max(0, Math.floor(r)));
  const fr = r - r0; // may exceed 1 on the last segment (extrapolation)
  let x = 0, y = 0, z = 0;
  for (let dr = 0; dr < 2; dr++) {
    const wr = dr ? fr : 1 - fr;
    for (let dc = 0; dc < 2; dc++) {
      const w = wr * (dc ? fc : 1 - fc);
      if (!w) continue;
      const v = V[(r0 + dr) * C + c0 + dc] * 3;
      x += w * P[v]; y += w * P[v + 1]; z += w * P[v + 2];
    }
  }
  return out.set(x, y, z);
}
