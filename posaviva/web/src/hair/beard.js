// Facial hair: a skin-bound shell over the beard region (stubble / base) plus
// short clumps rooted on it (full beard, goatee, mustache). Everything is bound
// to skin faces, so it follows expressions (jaw opening, smiles) through a
// cheap refit, and it is skinned with the face's own bone weights.
import * as THREE from 'three';
import { SkinPatch } from './patch.js';
import { StrandSet, HairGeometry } from './strands.js';
import { rng, smoothstep, clamp } from './util.js';

/** shell: thickness (m); clumps: count; len: [min, max] clump length (m); region: mask kind */
export const BEARD_SPECS = {
  // stubble: thin semi-transparent shell (reads as shadow of hair under the skin)
  corta: { region: 'full', shell: 0.0009, clumps: 0, edge: 0.004, stubble: true },
  piena: { region: 'full', shell: 0.0055, clumps: 460, len: [0.012, 0.03], edge: 0.004, width: 0.55 },
  pizzetto: { region: 'goatee', shell: 0.0035, clumps: 160, len: [0.008, 0.02], edge: 0.003, width: 0.55 },
  baffi: { region: 'mustache', shell: 0.004, clumps: 80, len: [0.011, 0.019], edge: 0.004, width: 0.55, inside: 0.3, lift: 0.2 },
};

/** Region masks (meters, > 0 inside) from head landmarks. */
function beardMask(kind, F) {
  const s = F.s, M = F.mouth, C = F.chin, E = F.ear, nb = F.nose.baseY;
  const lips = (x, y, z) => {
    if (z < M.z - 0.035 * s) return 1;
    const q = Math.hypot(x / (M.halfW + 0.003 * s), (y - M.y) / (0.0105 * s));
    return (q - 1) * 0.008 * s;
  };
  const nose = (x, y) => (Math.abs(x) < 0.028 * s ? nb - 0.0015 * s - y : 1);
  if (kind === 'mustache') {
    return (x, y, z) => {
      const ax = Math.abs(x);
      const low = M.y + 0.0055 * s - 0.014 * s * smoothstep(M.halfW - 0.006 * s, M.halfW + 0.01 * s, ax);
      return Math.min(nb - 0.0015 * s - y, y - low, M.halfW + 0.01 * s - ax, z - (M.z - 0.03 * s), lips(x, y, z));
    };
  }
  if (kind === 'goatee') {
    return (x, y, z) => {
      const q = Math.hypot(x / (M.halfW + 0.013 * s), (y - (M.y - 0.012 * s)) / (0.046 * s));
      return Math.min((1 - q) * 0.012 * s, z - (M.z - 0.05 * s), y - (C.y - 0.012 * s), lips(x, y, z), nose(x, y));
    };
  }
  // full beard
  const p1x = E.x - 0.008 * s, p1y = E.y + 0.004 * s, p2x = M.halfW + 0.011 * s, p2y = nb - 0.004 * s;
  return (x, y, z) => {
    const ax = Math.abs(x);
    const tl = clamp((ax - p2x) / (p1x - p2x), 0, 1);
    const cheek = p2y + (p1y - p2y) * tl - y; // below the cheek line
    const front = z - (E.z + 0.012 * s); // in front of the ear
    const tz = clamp((z - E.z) / (C.z - E.z), 0, 1);
    const neck = y - (E.y - 0.035 * s + (C.y - 0.03 * s - (E.y - 0.035 * s)) * tz); // above the neckline
    return Math.min(cheek, front, neck, lips(x, y, z), nose(x, y));
  };
}

export class Beard {
  /**
   * @param {import('../core/Character.js').Character} ch
   * @param {object} frame headFrame()
   * @param {string} kind key of BEARD_SPECS
   */
  constructor(ch, frame, kind) {
    const spec = BEARD_SPECS[kind];
    this.ch = ch;
    this.spec = spec;
    const m = ch.model, s = frame.s, P = ch.shapePositions;
    const mask = beardMask(spec.region, frame);
    // candidate faces: front of the head and upper neck
    const faces = [];
    const F = m.faceV;
    for (const f of m.groupFaces[0]) {
      let ok = true;
      for (let k = 0; k < 4 && ok; k++) {
        const v = F[f * 4 + k];
        if (v === 0xffff) continue;
        const y = P[v * 3 + 1], z = P[v * 3 + 2];
        ok = y > frame.chin.y - 0.08 * s && y < frame.eyeY && z > frame.ear.z - 0.03 * s;
      }
      if (ok) faces.push(f);
    }
    const edge = (spec.edge || 0.003) * s;
    this.patch = new SkinPatch(m, P, { mask, edge, sub: 4, faces });
    this.offset = spec.shell * s;
    this.strands = new StrandSet();
    this.roots = [];
    this.K = 5;
    if (spec.clumps) this._clumps(mask, frame, spec, edge);
    this.hg = new HairGeometry(this.strands, this.patch, [], frame.headBone);
    // the shell keeps a darker tone (density), the clumps are lit normally
    this.hg.col.fill(0.78, 0, this.patch.count * 3);
    this._buf = new Float32Array(this.K * 3);
    this.fit();
    const mesh = new THREE.SkinnedMesh(this.hg.geometry, []);
    mesh.name = 'beard';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.pickable = false;
    mesh.userData.hairModule = true;
    this.mesh = mesh;
  }

  /** Picks clump roots among the shell vertices well inside the region (blue noise). */
  _clumps(mask, frame, spec, edge) {
    const p = this.patch, s = frame.s, P = this.ch.shapePositions;
    p.fit(P, this.ch.restNormals, 0);
    const cand = [];
    for (let v = 0; v < p.count; v++) if (p.mask[v] > edge * (spec.inside ?? 0.8)) cand.push(v);
    // region area from the shell triangles
    let area = 0;
    const I = p.index, X = p.pos;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    const dmin = Math.sqrt(area / spec.clumps) * 0.85;
    const rnd = rng(0xbea4d);
    for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
    const cell = new Map(), key = (x, y, z) => `${Math.floor(x / dmin)},${Math.floor(y / dmin)},${Math.floor(z / dmin)}`;
    const K = 5;
    this.K = K;
    for (const v of cand) {
      const x = X[v * 3], y = X[v * 3 + 1], z = X[v * 3 + 2];
      let near = false;
      for (let dx = -1; dx <= 1 && !near; dx++) for (let dy = -1; dy <= 1 && !near; dy++) for (let dz = -1; dz <= 1 && !near; dz++) {
        const lst = cell.get(key(x + dx * dmin, y + dy * dmin, z + dz * dmin));
        if (lst) for (const q of lst) if (Math.hypot(X[q * 3] - x, X[q * 3 + 1] - y, X[q * 3 + 2] - z) < dmin) { near = true; break; }
      }
      if (near) continue;
      const k = key(x, y, z);
      (cell.get(k) || cell.set(k, []).get(k)).push(v);
      // length: longer on the chin, shorter on the cheeks and towards the region border
      const chinK = 1 - smoothstep(0.01 * s, 0.06 * s, Math.abs(x));
      const L = (spec.len[0] + (spec.len[1] - spec.len[0]) * (0.35 + 0.65 * chinK) * (0.8 + 0.4 * rnd())) * s * (0.55 + 0.45 * smoothstep(edge, edge * 4, p.mask[v]));
      const pts = new Float32Array(K * 3);
      const si = [0, 0, 0, 0], sw = [0, 0, 0, 0];
      for (let q = 0; q < 4; q++) { si[q] = p.skinIndex[v * 4 + q]; sw[q] = p.skinWeight[v * 4 + q]; }
      this.roots.push({ v, L, side: Math.sign(x) || 1, lift: (spec.lift || 0.04) + 0.08 * rnd(), curl: (rnd() - 0.5) * 0.5, mustache: spec.region === 'mustache' || y > frame.mouth.y });
      this.strands.add({ pts, pin: K, w: dmin * spec.width, flat: 0.42, rootW: 1, taper0: 0.15, tipW: 0.04, tone: 0.85 + 0.25 * rnd(), samples: K, sides: 5, bias: 0.55, skinIndex: si, skinWeight: sw });
    }
  }

  /** Re-evaluates shell and clumps from the current rest positions (shape + expression). */
  fit() {
    const ch = this.ch, P = ch.restPositions, N = ch.restNormals, p = this.patch, hg = this.hg;
    if (!this._thick) {
      // rounded volume: full thickness only well inside the region
      this._thick = new Float32Array(p.count);
      const e = p.edge;
      for (let v = 0; v < p.count; v++) this._thick[v] = 0.35 + 0.65 * smoothstep(e * 0.5, e * 3, p.mask[v]);
    }
    p.fit(P, N, this.offset, 0.00025, this._thick);
    hg.writePatch();
    if (this.roots.length) {
      const out = this._buf, K = this.K;
      const ax = this._axis || (this._axis = { cx: 0, cy: 0, cz: 0, dx: 0, dy: -1, dz: 0 });
      this.roots.forEach((r, i) => {
        const v = r.v;
        const px = p.pos[v * 3], py = p.pos[v * 3 + 1], pz = p.pos[v * 3 + 2];
        const nx = p.nor[v * 3], ny = p.nor[v * 3 + 1], nz = p.nor[v * 3 + 2];
        // growth direction: down along the skin (mustache: down and outwards)
        let gx = r.mustache ? r.side * 0.55 : r.curl * 0.3, gy = -1, gz = 0.12;
        const d = gx * nx + gy * ny + gz * nz;
        gx -= d * nx; gy -= d * ny; gz -= d * nz;
        let gl = Math.hypot(gx, gy, gz);
        if (gl < 0.2) { gx = 0; gy = -0.3; gz = 1; const d2 = gz * nz + gy * ny; gx -= d2 * nx; gy -= d2 * ny; gz -= d2 * nz; gl = Math.hypot(gx, gy, gz) || 1; }
        gx /= gl; gy /= gl; gz /= gl;
        for (let k = 0; k < K; k++) {
          const u = k / (K - 1), a = r.L * u;
          const h = this.offset * 0.4 + r.L * r.lift * Math.sin(u * Math.PI * 0.6);
          out[k * 3] = px - nx * this.offset * 0.8 + gx * a + nx * h;
          out[k * 3 + 1] = py - ny * this.offset * 0.8 + gy * a + ny * h;
          out[k * 3 + 2] = pz - nz * this.offset * 0.8 + gz * a + nz * h;
        }
        // tubes are flattened against the skin: "outward" = skin normal at the root
        ax.cx = px - nx; ax.cy = py - ny; ax.cz = pz - nz; ax.dx = 0; ax.dy = 0; ax.dz = 0;
        hg.writeStrand(i, out, 0, ax);
      });
    }
    hg.markDirty(true);
  }

  dispose() { this.hg.dispose(); }
}
