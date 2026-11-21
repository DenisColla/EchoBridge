// Procedural nature: trees (9 species + seasons), tree rows / groves, bushes,
// hedges, grass, flower beds, rocks, logs and stumps, terrain patches, ponds and
// dunes. Everything is seeded ('seed' param -> "Rigenera" gives a new variant).
// Foliage is built from noise-displaced clumps whose normals are blended with
// the direction from the crown center: soft, volumetric crowns with clean
// silhouettes that read well in every render style (and ink nicely in "lines").
import * as THREE from 'three';
import { taperTube, blob, loft, polyXZ, box, cylinder, sphere, rng, makeNoise, mergeVerticesSimple } from './util.js';
import { seed as seedParam, seg, range, int, flag } from '../props/params.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ foliage helpers
/** Vertex colors from a palette with per-vertex noise and a fake occlusion (darker low / inside). */
function paintFoliage(g, center, rInfo, colors, rnd, noise, { ao = 0.42, mix = 0.6 } = {}) {
  const p = g.attributes.position, n = p.count, c = new Float32Array(n * 3);
  const base = colors.map((h) => new THREE.Color(h).convertSRGBToLinear());
  const tmp = new THREE.Color(), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(p, i);
    const t = noise(v.x * 0.9, v.y * 0.9, v.z * 0.9) * 0.5 + 0.5;
    const k = Math.min(base.length - 1, Math.floor(t * base.length * mix + (1 - mix) * rnd() * base.length));
    tmp.copy(base[Math.max(0, k)]);
    const out = Math.min(1, v.distanceTo(center) / Math.max(0.3, rInfo));
    const up = Math.min(1, Math.max(0, (v.y - (center.y - rInfo)) / (2 * rInfo)));
    const shade = 1 - ao + ao * (0.55 * out + 0.45 * up);
    c[i * 3] = tmp.r * shade; c[i * 3 + 1] = tmp.g * shade; c[i * 3 + 2] = tmp.b * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Bends the normals of a clump toward the direction from the crown center (soft crown shading). */
function crownNormals(g, center, k = 0.55) {
  const p = g.attributes.position, nn = g.attributes.normal, v = new THREE.Vector3(), a = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(center).normalize();
    a.fromBufferAttribute(nn, i).multiplyScalar(1 - k).addScaledVector(v, k).normalize();
    nn.setXYZ(i, a.x, a.y, a.z);
  }
  return g;
}

/**
 * Leafy fringe: small double-sided leaf quads scattered on the outer surface of
 * clumps (vertex colors copied from the clump), breaking the smooth blob
 * silhouettes into a leafy edge. Normals follow the crown direction.
 */
function leafFringe(clumps, center, rnd, { per = 22, size = 0.22, minUp = -0.4 } = {}) {
  const pos = [], col = [], nor = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), d = new THREE.Vector3();
  for (const g of clumps) {
    const pp = g.attributes.position, nn = g.attributes.normal, cc = g.attributes.color;
    for (let k = 0; k < per; k++) {
      const i = Math.floor(rnd() * pp.count);
      n.fromBufferAttribute(nn, i);
      if (n.y < minUp) continue;
      v.fromBufferAttribute(pp, i).addScaledVector(n, size * (0.1 + rnd() * 0.35));
      // random tangent frame around a direction near the normal
      d.copy(n).add(t1.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(1.2)).normalize();
      t1.set(0, 1, 0).cross(d); if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0); t1.normalize();
      t2.crossVectors(d, t1).normalize();
      const s = size * (0.5 + rnd() * 0.6);
      const q = [v.clone().addScaledVector(t1, -s * 0.5), v.clone().addScaledVector(t2, s * 0.32), v.clone().addScaledVector(t1, s * 0.5), v.clone().addScaledVector(t2, -s * 0.32)];
      const k2 = 0.85 + rnd() * 0.35;
      const r = cc ? cc.getX(i) * k2 : k2, gg = cc ? cc.getY(i) * k2 : k2, b = cc ? cc.getZ(i) * k2 : k2;
      const cn = t1.copy(v).sub(center).normalize().lerp(n, 0.5).normalize();
      // winding so the front face looks along cn (double-sided materials flip back-face normals)
      const fn = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[2], q[0]));
      const order = fn.dot(cn) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const idx of order) { pos.push(q[idx].x, q[idx].y, q[idx].z); col.push(r, gg, b); nor.push(cn.x, cn.y, cn.z); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** One foliage clump (lumpy ellipsoid) at c with radius r (scale sx, sy, sz). */
function clump(c, r, noise, { detail = 2, sy = 1, sx = 1, sz = 1, amp = 0.34, freq = 1.25 } = {}) {
  const g = blob(r, detail, (v, n) => 1 + amp * noise.fbm(c.x + n.x * freq, c.y + n.y * freq, c.z + n.z * freq, 2));
  g.scale(sx, sy, sz);
  g.translate(c.x, c.y, c.z);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ branching skeleton
/** A bent polyline from a in direction d with length L (gravity / noise bends). */
function limb(a, d, L, rnd, { segs = 4, droop = 0, wander = 0.15 } = {}) {
  const pts = [a.clone()];
  const dir = d.clone().normalize();
  let p = a.clone();
  for (let i = 1; i <= segs; i++) {
    dir.x += (rnd() - 0.5) * wander; dir.z += (rnd() - 0.5) * wander; dir.y -= droop * (i / segs);
    dir.normalize();
    p = p.clone().addScaledVector(dir, L / segs);
    pts.push(p);
  }
  return pts;
}
const arr = (pts) => pts.map((v) => [v.x, v.y, v.z]);
function tubeOf(pts, r0, r1, sides) {
  const radii = pts.map((_, i) => r0 + (r1 - r0) * (i / (pts.length - 1)));
  return taperTube(arr(pts), radii, { sides, capEnd: true, vScale: 1.2 });
}

// ------------------------------------------------------------------ species
const SPECIES = {
  quercia: { h: 10, trunkF: 0.3, r: 0.32, crownR: 0.48, crownY: 0.62, sq: 0.8, mains: 5, clumps: 34, cr: 0.15, colors: ['#3f5f2c', '#4d6e32', '#5c7c3a', '#41632f'], bark: 'c:bark', spread: 1.0 },
  latifoglia: { h: 11, trunkF: 0.34, r: 0.26, crownR: 0.36, crownY: 0.64, sq: 1.05, mains: 4, clumps: 30, cr: 0.13, colors: ['#4a6d2f', '#5a7f36', '#6a8c3d', '#4f7333'], bark: 'c:bark', spread: 0.8 },
  betulla: { h: 12, trunkF: 0.4, r: 0.15, crownR: 0.24, crownY: 0.66, sq: 1.5, mains: 5, clumps: 34, cr: 0.075, colors: ['#6f8f3a', '#7f9d45', '#8fae4f', '#6a8a36'], bark: 'c:birch', spread: 0.55, droop: 0.25 },
  salice: { h: 9, trunkF: 0.28, r: 0.3, crownR: 0.5, crownY: 0.68, sq: 0.7, mains: 5, clumps: 16, cr: 0.15, colors: ['#6f8c3f', '#7f9b48', '#8aa652', '#6a863c'], bark: 'c:bark', spread: 1.0 },
};
const SEASON = {
  autunno: ['#b5531c', '#d27a22', '#e2a531', '#9c3a1a', '#c9662a'],
  fiori: ['#f4d3df', '#efc0d1', '#f9e6ec', '#e8aac2', '#fdf3f6', '#9db27a'],
};

/** Deciduous broadleaf tree (oak, plane, birch, willow, blossom, autumn, winter). */
function broadleaf(p, kind, out, opt = {}) {
  const S = SPECIES[kind], rnd = rng(p.seed || 1), noise = makeNoise((p.seed || 1) * 7 + 3);
  const H = p.height, W = p.width ?? 1;
  const trunkH = H * S.trunkF * (0.9 + rnd() * 0.2);
  const r0 = S.r * (H / S.h) ** 0.8 * (opt.thin ? 0.7 : 1);
  const season = p.season || 'estate';
  const detail = opt.lod ? 1 : 2;
  const sides = opt.lod ? 5 : 8;
  // trunk with root flare and a slight lean
  const lean = V((rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12);
  const tpts = limb(V(0, 0, 0), lean, trunkH * 1.15, rnd, { segs: 5, wander: 0.05 });
  const trunkR = tpts.map((_, i) => { const t = i / (tpts.length - 1); return r0 * (1 + 0.55 * Math.exp(-t * 9)) * (1 - 0.35 * t); });
  const barkRole = S.bark;
  (out[barkRole] ||= []).push(taperTube(arr(tpts), trunkR, { sides: sides + 2, capEnd: true, vScale: 1.2, noise, noiseAmp: 0.06 }));
  // crown frame
  const crownC = V(tpts[tpts.length - 1].x, H * S.crownY, tpts[tpts.length - 1].z);
  const CR = H * S.crownR * W, CRy = CR * S.sq;
  const tips = [];
  const nMain = S.mains + rnd.int(-1, 1);
  const bare = season === 'inverno';
  for (let m = 0; m < nMain; m++) {
    const a = (m / nMain) * Math.PI * 2 + rnd() * 0.6;
    const startT = 0.55 + rnd() * 0.4;
    const k = Math.min(tpts.length - 1, Math.floor(startT * (tpts.length - 1)));
    const base = tpts[k].clone();
    const up = kind === 'betulla' ? 1.6 : kind === 'salice' ? 1.1 : 0.9;
    const dir = V(Math.cos(a) * S.spread, up + rnd() * 0.4, Math.sin(a) * S.spread);
    const L = CR * (0.75 + rnd() * 0.35) + (H * S.crownY - base.y) * 0.4;
    const pts = limb(base, dir, L, rnd, { segs: 4, droop: kind === 'betulla' ? 0.1 : 0.06 });
    const rb = trunkR[k] * 0.55;
    (out[barkRole]).push(tubeOf(pts, rb, rb * 0.25, sides));
    // secondary branches
    const nSec = bare ? 4 : 3;
    for (let s = 0; s < nSec; s++) {
      const t = 0.4 + 0.55 * (s / nSec) + rnd() * 0.1;
      const q = pts[Math.min(pts.length - 1, Math.round(t * (pts.length - 1)))];
      const bdir = pts[pts.length - 1].clone().sub(pts[0]).normalize();
      const side = V(-bdir.z, 0, bdir.x).multiplyScalar(rnd() < 0.5 ? 1 : -1);
      const d2 = bdir.clone().multiplyScalar(0.7).add(side.multiplyScalar(0.8)).add(V(0, 0.35 + rnd() * 0.3, 0));
      const L2 = L * (0.35 + rnd() * 0.25);
      const p2 = limb(q, d2, L2, rnd, { segs: 3, droop: kind === 'salice' || kind === 'betulla' ? 0.25 : 0.05 });
      (out[barkRole]).push(tubeOf(p2, rb * 0.45, rb * 0.12, Math.max(4, sides - 2)));
      tips.push(p2[p2.length - 1]);
      if (bare) { // twigs
        for (let tw = 0; tw < 3; tw++) {
          const q3 = p2[1 + Math.floor(rnd() * (p2.length - 1))];
          const d3 = d2.clone().add(V((rnd() - 0.5) * 1.2, 0.4 + rnd() * 0.4, (rnd() - 0.5) * 1.2));
          const p3 = limb(q3, d3, L2 * (0.35 + rnd() * 0.3), rnd, { segs: 2 });
          (out[barkRole]).push(tubeOf(p3, rb * 0.12, rb * 0.03, 4));
        }
      }
    }
    tips.push(pts[pts.length - 1]);
  }
  if (bare) return { crownC, CR, CRy, tips };
  // foliage: clumps on the tips + filling the crown ellipsoid
  const role = season === 'autunno' || season === 'fiori' ? 'c:leafVC1' : 'c:foliageVC1';
  const colors = SEASON[season] || S.colors.map((c) => '#' + new THREE.Color(c).lerp(new THREE.Color('#9a9a9a'), 0.25).getHexString());
  const greys = SEASON[season] ? colors : ['#c8c8c8', '#e0e0e0', '#f2f2f2', '#d4d4d4'];
  const cl = [];
  const nC = Math.round(S.clumps * (opt.lod ? 0.55 : 1) * (season === 'autunno' ? 0.85 : 1));
  const cr = H * S.cr * W;
  const centers = tips.map((t) => t.clone());
  while (centers.length < nC) {
    // random point in the crown ellipsoid, biased to the shell
    const u = rnd() * Math.PI * 2, v = Math.acos(2 * rnd() - 1), rr = 0.55 + 0.45 * Math.cbrt(rnd());
    centers.push(V(crownC.x + Math.sin(v) * Math.cos(u) * CR * rr, crownC.y + Math.cos(v) * CRy * rr * (Math.cos(v) < 0 ? 0.75 : 1), crownC.z + Math.sin(v) * Math.sin(u) * CR * rr));
  }
  for (const c of centers.slice(0, nC + 4)) {
    const r = cr * (0.75 + rnd() * 0.6);
    const g = clump(c, r, noise, { detail, sy: kind === 'betulla' ? 1.1 : 0.85 });
    crownNormals(g, crownC, 0.62);
    paintFoliage(g, crownC, Math.max(CR, CRy), greys, rnd, noise);
    cl.push(g);
  }
  (out[role] ||= []).push(...cl);
  if (!opt.lod) out[role].push(leafFringe(cl, crownC, rnd, { per: kind === 'betulla' ? 46 : 40, size: cr * 0.3 }));
  if (kind === 'salice') weepingCurtain(out, crownC, CR, CRy, H, rnd, noise, role === 'c:leafVC1' ? 'c:leafVC' : 'c:foliageVC', greys);
  return { crownC, CR, CRy, tips };
}

/** Hanging strands of a weeping willow (double-sided ribbons). */
function weepingCurtain(out, c, CR, CRy, H, rnd, noise, role, colors) {
  const n = 300, pos = [], col = [];
  const cc = colors.map((h) => new THREE.Color(h).convertSRGBToLinear());
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.1, el = -0.1 - rnd() * 0.5;
    const rr = CR * Math.cos(el) * (0.85 + rnd() * 0.12);
    const top = V(c.x + Math.cos(a) * rr, c.y + CRy * Math.sin(el), c.z + Math.sin(a) * rr);
    const len = top.y - (0.5 + rnd() * 1.6);
    const w = 0.06 + rnd() * 0.06;
    const segs = 6;
    const tang = V(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(w / 2);
    const base = cc[i % cc.length];
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs, t1 = (s + 1) / segs;
      const P = (t) => V(top.x + Math.cos(a) * 0.35 * Math.sin(t * 1.6), top.y - len * t, top.z + Math.sin(a) * 0.35 * Math.sin(t * 1.6));
      const a0 = P(t0), a1 = P(t1);
      const k0 = 1 - t0 * 0.6, k1 = 1 - t1 * 0.6;
      const q = [a0.clone().sub(tang.clone().multiplyScalar(k0)), a0.clone().add(tang.clone().multiplyScalar(k0)), a1.clone().sub(tang.clone().multiplyScalar(k1)), a1.clone().add(tang.clone().multiplyScalar(k1))];
      for (const idx of [0, 2, 1, 1, 2, 3]) { pos.push(q[idx].x, q[idx].y, q[idx].z); const sh = 0.6 + 0.4 * (1 - (idx >> 1 ? t1 : t0)); col.push(base.r * sh, base.g * sh, base.b * sh); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // ribbons: normals mostly outward from the trunk
  const nn = g.attributes.normal, pp = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < nn.count; i++) { v.set(pp.getX(i) - c.x, 0.3, pp.getZ(i) - c.z).normalize(); nn.setXYZ(i, v.x, v.y, v.z); }
  (out[role] ||= []).push(g);
}

/** Umbrella (stone) pine: tall bare trunk, flat wide crown. */
function pinoMarittimo(p, out, opt = {}) {
  const rnd = rng(p.seed || 1), noise = makeNoise((p.seed || 1) * 5 + 1);
  const H = p.height, W = p.width ?? 1, detail = opt.lod ? 1 : 2;
  const r0 = 0.28 * (H / 12) ** 0.8;
  const lean = V((rnd() - 0.5) * 0.35, 1, (rnd() - 0.5) * 0.35);
  const tpts = limb(V(0, 0, 0), lean, H * 0.72, rnd, { segs: 6, wander: 0.08 });
  const trunkR = tpts.map((_, i) => { const t = i / (tpts.length - 1); return r0 * (1 + 0.4 * Math.exp(-t * 10)) * (1 - 0.45 * t); });
  (out['c:bark'] ||= []).push(taperTube(arr(tpts), trunkR, { sides: 9, capEnd: true, vScale: 1.2, noise, noiseAmp: 0.08 }));
  const top = tpts[tpts.length - 1];
  const crownY = H * 0.86, CR = H * 0.42 * W;
  const cc = V(top.x, crownY, top.z);
  const cl = [];
  const n = opt.lod ? 14 : 28;
  for (let m = 0; m < 5; m++) {
    const a = (m / 5) * Math.PI * 2 + rnd() * 0.5;
    const pts = limb(top.clone().add(V(0, -0.4, 0)), V(Math.cos(a), 0.75, Math.sin(a)), CR * 0.75, rnd, { segs: 3 });
    out['c:bark'].push(tubeOf(pts, r0 * 0.5, r0 * 0.15, 6));
  }
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, rr = CR * Math.sqrt(rnd()) * 0.9;
    const c = V(cc.x + Math.cos(a) * rr, crownY + (1 - rr / CR) * H * 0.05 + rnd() * 0.3, cc.z + Math.sin(a) * rr);
    const g = clump(c, H * 0.1 * W * (0.8 + rnd() * 0.5), noise, { detail, sy: 0.62 });
    crownNormals(g, V(cc.x, crownY - CR * 0.4, cc.z), 0.6);
    paintFoliage(g, cc, CR * 0.6, ['#c8cfc0', '#d9e0d0', '#e4e8dc', '#cfd6c6'], rnd, noise, { ao: 0.5 });
    cl.push(g);
  }
  (out['c:foliageVC1'] ||= []).push(...cl);
  if (!opt.lod) out['c:foliageVC1'].push(leafFringe(cl, V(cc.x, crownY - CR * 0.3, cc.z), rnd, { per: 18, size: H * 0.035 }));
}

/** Conifer (fir / spruce): tiers of drooping jagged skirts around a straight trunk. */
function abete(p, out, opt = {}) {
  const rnd = rng(p.seed || 1), noise = makeNoise((p.seed || 1) * 3 + 9);
  const H = p.height, W = p.width ?? 1;
  const r0 = 0.22 * (H / 12) ** 0.8;
  (out['c:bark'] ||= []).push(taperTube([[0, 0, 0], [0, H * 0.5, 0], [0, H * 0.97, 0]], [r0 * 1.25, r0 * 0.7, 0.02], { sides: 8, capEnd: true, vScale: 1.2 }));
  const tiers = opt.lod ? 7 : 10, base = H * 0.14, Rmax = H * 0.27 * W;
  const pos = [], col = [];
  const C = new THREE.Color();
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y0 = base + (H - base) * f * 0.92;
    const R = Rmax * (1 - f * 0.92) * (0.9 + rnd() * 0.2);
    const h = (H - base) / tiers * 1.9;
    const nSeg = opt.lod ? 10 : 16;
    const ring = [], tipY = y0 + h, droop = h * 0.35;
    for (let k = 0; k < nSeg; k++) {
      const a = (k / nSeg) * Math.PI * 2 + t * 0.5;
      const jag = k % 2 ? 0.72 : 1.0;
      const rr = R * jag * (0.92 + rnd() * 0.16);
      ring.push(V(Math.cos(a) * rr, y0 - droop * (k % 2 ? 0.3 : 1) + noise(a, t, 0) * 0.1, Math.sin(a) * rr));
    }
    const apex = V(0, tipY, 0);
    const mid = ring.map((q) => V(q.x * 0.55, (q.y + tipY) / 2 + h * 0.08, q.z * 0.55));
    const shade = 0.55 + 0.45 * f;
    for (let k = 0; k < nSeg; k++) {
      const a = ring[k], b = ring[(k + 1) % nSeg], ma = mid[k], mb = mid[(k + 1) % nSeg];
      const tris = [[apex, mb, ma], [ma, mb, b], [ma, b, a]];
      for (const tri of tris) for (const v of tri) {
        pos.push(v.x, v.y, v.z);
        C.set(k % 3 ? '#e4e9dc' : '#d0d6c8').convertSRGBToLinear();
        const s = shade * (v === apex ? 1 : v === a || v === b ? 0.7 : 0.9);
        col.push(C.r * s, C.g * s, C.b * s);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const nn = g.attributes.normal, pp = g.attributes.position, v = new THREE.Vector3(), n2 = new THREE.Vector3();
  for (let i = 0; i < nn.count; i++) { v.set(pp.getX(i), 0.6 * Math.max(0.3, Rmax), pp.getZ(i)).normalize(); n2.fromBufferAttribute(nn, i); if (n2.y < 0) n2.negate(); n2.lerp(v, 0.6).normalize(); nn.setXYZ(i, n2.x, n2.y, n2.z); }
  (out['c:foliageVC'] ||= []).push(g);
}

/** Cypress: tall flame-shaped column. */
function cipresso(p, out, opt = {}) {
  const rnd = rng(p.seed || 1), noise = makeNoise((p.seed || 1) * 11 + 2);
  const H = p.height, W = p.width ?? 1, Rm = H * 0.085 * W;
  (out['c:bark'] ||= []).push(cylinder(0.12 * (H / 14), 0.08, H * 0.25, { seg: 7 }));
  const prof = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = i === N ? 0 : Rm * Math.pow(Math.sin(Math.PI * Math.min(1, (t + 0.08) * 0.95)), 0.6) * (1 - 0.65 * t ** 1.4);
    prof.push(new THREE.Vector2(Math.max(0.001, r), H * 0.06 + t * H * 0.94));
  }
  prof[0].x = 0.001;
  let g = new THREE.LatheGeometry(prof, opt.lod ? 10 : 16);
  g = mergeVerticesSimple(g);
  const pp = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pp.count; i++) {
    v.fromBufferAttribute(pp, i);
    const r = Math.hypot(v.x, v.z);
    if (r < 0.01) continue;
    const k = 1 + 0.22 * noise.fbm(v.x * 1.4, v.y * 0.9, v.z * 1.4, 3) + 0.08 * noise(v.x * 5, v.y * 4, v.z * 5);
    pp.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  g.computeVertexNormals();
  crownNormals(g, V(0, H * 0.4, 0), 0.35);
  paintFoliage(g, V(0, H * 0.5, 0), H * 0.5, ['#b8bfb0', '#c3cabb', '#aab2a2'], rnd, noise, { ao: 0.35 });
  (out['c:foliageVC1'] ||= []).push(g);
}

/** Palm: curved ringed trunk + crown of drooping pinnate fronds. */
function palma(p, out, opt = {}) {
  const rnd = rng(p.seed || 1);
  const H = p.height;
  const bend = V((rnd() - 0.5) * 0.6, 0, (rnd() - 0.5) * 0.6);
  const tpts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; tpts.push([bend.x * t * t * H * 0.3, t * H * 0.92, bend.z * t * t * H * 0.3]); }
  const radii = tpts.map((_, i) => 0.2 * (1 - 0.3 * (i / 8)) + (i === 0 ? 0.08 : 0));
  (out['c:palmBark'] ||= []).push(taperTube(tpts, radii, { sides: 10, capEnd: true, vScale: 0.25 }));
  const top = V(...tpts[8]);
  // crown base bulge
  (out['c:palmBark']).push(sphere(0.24, { x: top.x, y: top.y + 0.05, z: top.z, ws: 10, hs: 8 }));
  const n = opt.lod ? 10 : 15;
  const pos = [], col = [];
  const C1 = new THREE.Color('#c9d1b8').convertSRGBToLinear(), C2 = new THREE.Color('#a7b393').convertSRGBToLinear();
  for (let f = 0; f < n; f++) {
    const a = (f / n) * Math.PI * 2 + rnd() * 0.3;
    const up = 0.9 - (f % 3) * 0.45 - rnd() * 0.2;
    const L = H * 0.32 * (0.85 + rnd() * 0.3);
    const dir = V(Math.cos(a), up, Math.sin(a)).normalize();
    const side = V(-Math.sin(a), 0, Math.cos(a));
    const S = 14;
    const rach = [];
    for (let s = 0; s <= S; s++) {
      const t = s / S;
      rach.push(top.clone().addScaledVector(dir, L * t).add(V(0, -L * 0.55 * t * t, 0)));
    }
    for (let s = 0; s < S; s++) {
      const t0 = s / S, t1 = (s + 1) / S;
      const w0 = L * 0.13 * Math.sin(Math.PI * Math.min(1, t0 * 1.1 + 0.05)), w1 = L * 0.13 * Math.sin(Math.PI * Math.min(1, t1 * 1.1 + 0.05));
      for (const sd of [-1, 1]) {
        // leaflet blades: zig-zag teeth along the rachis, folded downward (V)
        const a0 = rach[s], a1 = rach[s + 1];
        const e0 = a0.clone().addScaledVector(side, sd * w0).add(V(0, -w0 * 0.45, 0));
        const e1 = a1.clone().addScaledVector(side, sd * w1 * 0.55).add(V(0, -w1 * 0.3, 0));
        const tri = sd > 0 ? [a0, e0, a1, a1, e0, e1] : [a0, a1, e0, a1, e1, e0];
        for (const v of tri) { pos.push(v.x, v.y, v.z); const c = v === a0 || v === a1 ? C2 : C1; col.push(c.r, c.g, c.b); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  (out['c:foliageVC'] ||= []).push(g);
  // dates / coconuts
  if (p.fruit !== false) for (let k = 0; k < 6; k++) { const a = rnd() * 6.28; (out['c:woodDark'] ||= []).push(sphere(0.08, { x: top.x + Math.cos(a) * 0.2, y: top.y - 0.15 - rnd() * 0.1, z: top.z + Math.sin(a) * 0.2, ws: 8, hs: 6 })); }
}

/** Dispatcher: tree of a given species into `out`. */
export function treeInto(out, species, p, opt = {}) {
  switch (species) {
    case 'pino': return pinoMarittimo(p, out, opt);
    case 'abete': return abete(p, out, opt);
    case 'cipresso': return cipresso(p, out, opt);
    case 'palma': return palma(p, out, opt);
    default: return broadleaf(p, species, out, opt);
  }
}

/** Translates every geometry pushed into out since `marks` (role -> count) by (x, z) and yaw. */
function moveNew(out, marks, x, z, yaw, s = 1) {
  for (const [role, list] of Object.entries(out)) {
    for (let i = marks[role] || 0; i < list.length; i++) { if (s !== 1) list[i].scale(s, s, s); list[i].rotateY(yaw); list[i].translate(x, 0, z); }
  }
}
const markOf = (out) => Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]));

// ------------------------------------------------------------------ groups of trees
const MIX = {
  latifoglie: ['quercia', 'latifoglia', 'betulla', 'quercia'],
  conifere: ['abete', 'abete', 'pino', 'abete'],
  misto: ['quercia', 'abete', 'betulla', 'latifoglia', 'abete', 'pino'],
  mediterraneo: ['pino', 'cipresso', 'pino', 'latifoglia'],
};
function grove(p) {
  const out = {}, rnd = rng(p.seed || 1);
  const pts = [];
  const R = p.radius, n = p.count;
  for (let i = 0; i < n * 8 && pts.length < n; i++) {
    const a = rnd() * Math.PI * 2, r = R * Math.sqrt(rnd());
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (pts.every(([u, v]) => Math.hypot(u - x, v - z) > 2.4)) pts.push([x, z]);
  }
  const list = MIX[p.mix] || MIX.misto;
  for (const [x, z] of pts) {
    const sp = list[Math.floor(rnd() * list.length)];
    const h = p.height * (0.7 + rnd() * 0.5) * (sp === 'abete' ? 1.1 : 1);
    const m = markOf(out);
    treeInto(out, sp, { height: h, seed: Math.floor(rnd() * 1e6), season: p.season, width: 0.85 + rnd() * 0.3 }, { lod: true });
    moveNew(out, m, x, z, rnd() * Math.PI * 2);
  }
  return out;
}
function row(p) {
  const out = {}, rnd = rng(p.seed || 1);
  for (let i = 0; i < p.count; i++) {
    const x = (i - (p.count - 1) / 2) * p.spacing;
    const m = markOf(out);
    treeInto(out, p.species, { height: p.height * (0.92 + rnd() * 0.16), seed: Math.floor(rnd() * 1e6), season: p.season, width: 1 }, { lod: p.count > 6 });
    moveNew(out, m, x, 0, rnd() * Math.PI * 2);
  }
  return out;
}

// ------------------------------------------------------------------ bushes, hedges, grass, flowers
const FLOWER_COLORS = { misto: ['#d8343a', '#f2c230', '#f4f1ea', '#8a4fc0', '#ef7aa8', '#ee8a2a'], rosso: ['#c81f2a', '#e0303a', '#a8121c'], giallo: ['#f2c230', '#f7d85a', '#e8a21c'], bianco: ['#f4f1ea', '#ffffff', '#efe8d8'], viola: ['#7a3fb0', '#9a5fd0', '#5c2f8a'], rosa: ['#ef7aa8', '#f59cc0', '#e0558c'] };

function cespuglio(p) {
  const out = {}, rnd = rng(p.seed || 1), noise = makeNoise((p.seed || 1) * 13);
  const R = p.size, n = 4 + Math.round(R * 4);
  const c0 = V(0, R * 0.55, 0);
  const cl = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, rr = R * 0.55 * Math.sqrt(rnd());
    const c = V(Math.cos(a) * rr, R * (0.35 + rnd() * 0.35), Math.sin(a) * rr);
    const g = clump(c, R * (0.4 + rnd() * 0.25), noise, { detail: 2, sy: 0.85, amp: 0.32, freq: 3 });
    crownNormals(g, c0, 0.45);
    paintFoliage(g, c0, R, ['#c8cfc0', '#dde3d4', '#b7c0ae'], rnd, noise, { ao: 0.5 });
    cl.push(g);
  }
  (out['c:foliageVC1'] ||= []).push(...cl, leafFringe(cl, c0, rnd, { per: 30, size: R * 0.12 }));
  if (p.flowers) flowersOn(out, cl, FLOWER_COLORS[p.fcolor] || FLOWER_COLORS.misto, rnd, Math.round(30 * R * R + 20));
  return out;
}
/** Small flower heads scattered on the upper surface of foliage geometries. */
function flowersOn(out, geos, colors, rnd, count) {
  const heads = [];
  for (let k = 0; k < count; k++) {
    const g = geos[Math.floor(rnd() * geos.length)], pp = g.attributes.position, nn = g.attributes.normal;
    const i = Math.floor(rnd() * pp.count);
    if (nn.getY(i) < 0.1) continue;
    const h = new THREE.IcosahedronGeometry(0.035 + rnd() * 0.02, 0);
    h.scale(1, 0.6, 1);
    h.translate(pp.getX(i) + nn.getX(i) * 0.02, pp.getY(i) + nn.getY(i) * 0.02, pp.getZ(i) + nn.getZ(i) * 0.02);
    const c = new THREE.Color(colors[Math.floor(rnd() * colors.length)]).convertSRGBToLinear();
    const a = new Float32Array(h.attributes.position.count * 3);
    for (let j = 0; j < a.length; j += 3) { a[j] = c.r; a[j + 1] = c.g; a[j + 2] = c.b; }
    h.setAttribute('color', new THREE.BufferAttribute(a, 3));
    heads.push(h);
  }
  (out['c:petals'] ||= []).push(...heads);
}

function siepe(p) {
  const out = {}, rnd = rng(p.seed || 1), noise = makeNoise((p.seed || 1) * 17);
  const L = p.length, H = p.height, D = p.depth;
  if (p.style === 'naturale') {
    const n = Math.max(3, Math.round(L / (D * 0.7)));
    const cl = [];
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + D * 0.45 + (i / Math.max(1, n - 1)) * (L - D * 0.9);
      const c = V(x + (rnd() - 0.5) * 0.2, H * 0.55, (rnd() - 0.5) * D * 0.15);
      const g = clump(c, D * 0.62, noise, { detail: 2, sy: (H / D) * 0.85, amp: 0.3, freq: 2.5 });
      crownNormals(g, V(x, H * 0.4, 0), 0.4);
      paintFoliage(g, V(x, H * 0.5, 0), H, ['#c8cfc0', '#dde3d4', '#b7c0ae'], rnd, noise, { ao: 0.45 });
      cl.push(g);
    }
    (out['c:foliageVC1'] ||= []).push(...cl, leafFringe(cl, V(0, H * 0.4, 0), rnd, { per: 30, size: D * 0.1 }));
    return out;
  }
  // trimmed box hedge: subdivided box, rounded edges, leafy noise
  const sx = Math.max(2, Math.round(L * 5)), sy = Math.max(2, Math.round(H * 5)), sz = Math.max(2, Math.round(D * 5));
  let g = new THREE.BoxGeometry(L, H, D, sx, sy, sz);
  g = mergeVerticesSimple(g);
  const pp = g.attributes.position, v = new THREE.Vector3();
  const r = Math.min(0.12, H * 0.2, D * 0.25);
  for (let i = 0; i < pp.count; i++) {
    v.fromBufferAttribute(pp, i);
    // round the edges: clamp into an inner box and push back out by r (rounded box)
    const ix = Math.max(-L / 2 + r, Math.min(L / 2 - r, v.x)), iy = Math.max(-H / 2 + r, Math.min(H / 2 - r, v.y)), iz = Math.max(-D / 2 + r, Math.min(D / 2 - r, v.z));
    const d = V(v.x - ix, v.y - iy, v.z - iz);
    const dl = d.length();
    if (dl > 1e-6) d.multiplyScalar(r / dl);
    const n = d.clone().normalize();
    const k = 0.035 * noise.fbm(v.x * 3, v.y * 3, v.z * 3, 3) + 0.012 * noise(v.x * 14, v.y * 14, v.z * 14);
    pp.setXYZ(i, ix + d.x + n.x * k, iy + d.y + n.y * k + H / 2, iz + d.z + n.z * k);
  }
  g.computeVertexNormals();
  paintFoliage(g, V(0, H * 0.7, 0), Math.max(H, D), ['#c8cfc0', '#d6dccd', '#bcc4b2'], rnd, noise, { ao: 0.35 });
  (out['c:foliageVC1'] ||= []).push(g);
  return out;
}

function prato(p) {
  const out = {}, rnd = rng(p.seed || 1), noise = makeNoise((p.seed || 1) * 19);
  const W = p.width, D = p.depth;
  // ground patch with a soft irregular outline
  const outline = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2, k = 1 + 0.08 * noise(Math.cos(a) * 2, Math.sin(a) * 2, 1);
    outline.push([Math.cos(a) * W / 2 * k, Math.sin(a) * D / 2 * k]);
  }
  if (p.shape === 'rettangolo') { outline.length = 0; outline.push([-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]); }
  (out['c:grassTint'] ||= []).push(polyXZ(outline, 0.006, 2));
  // blades
  const dens = { bassa: 60, media: 140, alta: 260 }[p.density] || 140;
  const n = Math.min(9000, Math.round(W * D * dens * (p.shape === 'rettangolo' ? 1 : 0.78)));
  const pos = [], col = [];
  const C = new THREE.Color();
  const inside = (x, z) => p.shape === 'rettangolo' || (x * x) / (W * W / 4) + (z * z) / (D * D / 4) < 0.92;
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * W, z = (rnd() - 0.5) * D;
    if (!inside(x, z)) continue;
    const h = p.bladeH * (0.5 + rnd() * 0.8) * (0.8 + 0.4 * (noise(x * 0.8, 0, z * 0.8) * 0.5 + 0.5));
    const a = rnd() * Math.PI, w = 0.012 + rnd() * 0.01;
    const lx = Math.cos(a) * w, lz = Math.sin(a) * w;
    const bx = (rnd() - 0.5) * h * 0.5, bz = (rnd() - 0.5) * h * 0.5;
    // both windings (front-side material): whichever side faces the camera keeps an upward normal
    pos.push(x - lx, 0.005, z - lz, x + lx, 0.005, z + lz, x + bx, h, z + bz, x + lx, 0.005, z + lz, x - lx, 0.005, z - lz, x + bx, h, z + bz);
    C.setHSL(0.25 + rnd() * 0.05, 0.08, 0.72 + rnd() * 0.2).convertSRGBToLinear();
    const dark = 0.62;
    for (let k = 0; k < 2; k++) col.push(C.r * dark, C.g * dark, C.b * dark, C.r * dark, C.g * dark, C.b * dark, C.r * 1.08, C.g * 1.08, C.b * 1.08);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < nrm.length; i += 3) { nrm[i] = (rnd() - 0.5) * 0.3; nrm[i + 1] = 0.95; nrm[i + 2] = (rnd() - 0.5) * 0.3; }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  (out['c:grassBlades'] ||= []).push(g);
  if (p.flowers) {
    const heads = [], cs = FLOWER_COLORS.misto;
    for (let i = 0; i < W * D * 3; i++) {
      const x = (rnd() - 0.5) * W, z = (rnd() - 0.5) * D;
      if (!inside(x, z)) continue;
      const h = new THREE.IcosahedronGeometry(0.03, 0); h.scale(1, 0.5, 1); h.translate(x, p.bladeH * (0.8 + rnd() * 0.5), z);
      const c = new THREE.Color(cs[Math.floor(rnd() * cs.length)]).convertSRGBToLinear();
      const a = new Float32Array(h.attributes.position.count * 3); for (let j = 0; j < a.length; j += 3) { a[j] = c.r; a[j + 1] = c.g; a[j + 2] = c.b; }
      h.setAttribute('color', new THREE.BufferAttribute(a, 3));
      heads.push(h);
    }
    (out['c:petals'] ||= []).push(...heads);
  }
  return out;
}

function aiuola(p) {
  const out = {}, rnd = rng(p.seed || 1);
  const W = p.width, D = p.depth;
  // raised soil bed + edging
  (out['c:dirt'] ||= []).push(box(W, 0.14, D, { y: 0.07, r: 0.03 }));
  if (p.edge !== 'nessuno') {
    const role = p.edge === 'mattoni' ? 'c:brick' : 'c:curb';
    const t = 0.1, h = 0.22;
    (out[role] ||= []).push(box(W + 2 * t, h, t, { y: h / 2, z: D / 2 + t / 2, r: 0.01 }), box(W + 2 * t, h, t, { y: h / 2, z: -D / 2 - t / 2, r: 0.01 }),
      box(t, h, D, { y: h / 2, x: W / 2 + t / 2, r: 0.01 }), box(t, h, D, { y: h / 2, x: -W / 2 - t / 2, r: 0.01 }));
  }
  const cs = FLOWER_COLORS[p.fcolor] || FLOWER_COLORS.misto;
  const stems = [], leaves = [], heads = [];
  const n = Math.round(W * D * 30);
  const C = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * (W - 0.1), z = (rnd() - 0.5) * (D - 0.1), h = 0.25 + rnd() * 0.25;
    stems.push(cylinderSimple(0.004, h, x, 0.14, z, (rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.25));
    // leaf rosette
    if (i % 2 === 0) { const l = new THREE.IcosahedronGeometry(0.07, 0); l.scale(1.2, 0.35, 1.2); l.translate(x, 0.17, z); leaves.push(l); }
    // head: 5-petal star disc
    const hd = flowerHead(0.05 + rnd() * 0.035);
    hd.rotateX((rnd() - 0.5) * 0.6); hd.rotateY(rnd() * 6);
    hd.translate(x + (rnd() - 0.5) * 0.06, 0.14 + h, z + (rnd() - 0.5) * 0.06);
    C.set(cs[Math.floor(rnd() * cs.length)]).convertSRGBToLinear();
    const a = new Float32Array(hd.attributes.position.count * 3);
    for (let j = 0; j < a.length; j += 3) { const k = j === 0 ? 0.6 : 1; a[j] = C.r * k; a[j + 1] = C.g * k; a[j + 2] = C.b * k; }
    hd.setAttribute('color', new THREE.BufferAttribute(a, 3));
    heads.push(hd);
  }
  (out['c:stem'] ||= []).push(...stems);
  (out['c:foliage'] ||= []).push(...leaves);
  (out['c:petals'] ||= []).push(...heads);
  return out;
}
function cylinderSimple(r, h, x, y, z, tx = 0, tz = 0) {
  const g = new THREE.CylinderGeometry(r * 0.7, r, h, 4, 1, true);
  g.translate(0, h / 2, 0);
  g.rotateX(tx); g.rotateZ(tz);
  g.translate(x, y, z);
  return g;
}
function flowerHead(r) {
  const pos = [];
  const P = 5;
  for (let k = 0; k < P; k++) {
    const a0 = (k / P) * Math.PI * 2, a1 = a0 + Math.PI / P, a2 = a0 + (2 * Math.PI) / P;
    pos.push(0, 0.004, 0, Math.cos(a0) * r * 0.35, 0, Math.sin(a0) * r * 0.35, Math.cos(a1) * r, 0, Math.sin(a1) * r);
    pos.push(0, 0.004, 0, Math.cos(a1) * r, 0, Math.sin(a1) * r, Math.cos(a2) * r * 0.35, 0, Math.sin(a2) * r * 0.35);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const nn = g.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
  return g;
}

// ------------------------------------------------------------------ rocks, logs, stumps
function rockGeo(r, rnd, noise, { flat = 1, sharp = 0.5, detail = 3 } = {}) {
  const g = blob(r, detail, (v, n) => {
    const big = noise.fbm(n.x * 1.3 + 7, n.y * 1.3, n.z * 1.3, 4);
    const ridge = 1 - Math.abs(noise(n.x * 2.6, n.y * 2.6 + 3, n.z * 2.6));
    return 1 + 0.32 * big + sharp * 0.12 * ridge;
  });
  const pp = g.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    let y = pp.getY(i) * flat;
    if (y < -r * 0.25 * flat) y = -r * 0.25 * flat + (y + r * 0.25 * flat) * 0.15; // flat-ish bottom, sunk into the ground
    pp.setY(i, y);
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y - r * 0.08, 0);
  // spherical uvs (rock texture)
  const uv = g.attributes.uv, v = new THREE.Vector3();
  for (let i = 0; i < pp.count; i++) { v.fromBufferAttribute(pp, i); uv.setXY(i, (Math.atan2(v.x, v.z) / (Math.PI * 2) + 0.5) * r * 3, v.y * 1.2); }
  return g;
}
function roccia(p) {
  const out = {}, rnd = rng(p.seed || 1), noise = makeNoise((p.seed || 1) * 23);
  const shape = { masso: { flat: 0.8, sharp: 0.4 }, lastra: { flat: 0.4, sharp: 0.3 }, appuntita: { flat: 1.5, sharp: 1.0 }, ciottolo: { flat: 0.6, sharp: 0.05 } }[p.shape] || { flat: 0.8, sharp: 0.4 };
  const n = p.count;
  const geos = [];
  for (let i = 0; i < n; i++) {
    const s = i === 0 ? 1 : 0.35 + rnd() * 0.45;
    const g = rockGeo(p.size / 2 * s, rnd, makeNoise((p.seed || 1) * 31 + i), { ...shape, detail: p.size > 1.2 ? 3 : 2 });
    g.rotateY(rnd() * 6);
    if (i > 0) { const a = rnd() * Math.PI * 2, d = p.size * (0.55 + rnd() * 0.5); g.translate(Math.cos(a) * d, 0, Math.sin(a) * d); }
    geos.push(g);
  }
  (out['c:rockTint'] ||= []).push(...geos);
  if (p.moss) {
    // moss caps: the upper faces of the rocks, slightly offset, green
    for (const g of geos) {
      const m = g.clone(), pp = m.attributes.position, nn = m.attributes.normal;
      for (let i = 0; i < pp.count; i++) { const k = nn.getY(i) > 0.55 + 0.25 * noise(pp.getX(i) * 2, pp.getY(i) * 2, pp.getZ(i) * 2) ? 0.012 : -0.05; pp.setXYZ(i, pp.getX(i) + nn.getX(i) * k, pp.getY(i) + nn.getY(i) * k, pp.getZ(i) + nn.getZ(i) * k); }
      (out['c:moss'] ||= []).push(m);
    }
  }
  return out;
}

function tronco(p) {
  const out = {}, rnd = rng(p.seed || 1), noise = makeNoise((p.seed || 1) * 29);
  const L = p.length, r = p.diameter / 2;
  if (p.kind === 'ceppo') {
    const h = Math.max(0.2, L * 0.15);
    const pts = [[0, 0, 0], [0, h * 0.5, 0], [0, h, 0]];
    (out['c:bark'] ||= []).push(taperTube(pts, [r * 1.35, r * 1.05, r], { sides: 12, capEnd: false, vScale: 0.6, noise, noiseAmp: 0.1 }));
    const top = new THREE.CircleGeometry(r * 0.98, 16); top.rotateX(-Math.PI / 2); top.translate(0, h, 0);
    (out['c:endGrain'] ||= []).push(top);
    for (let k = 0; k < 5; k++) { // roots
      const a = (k / 5) * Math.PI * 2 + rnd() * 0.4;
      out['c:bark'].push(taperTube([[Math.cos(a) * r * 0.8, h * 0.3, Math.sin(a) * r * 0.8], [Math.cos(a) * r * 1.4, 0.06, Math.sin(a) * r * 1.4], [Math.cos(a) * r * 2.0, -0.02, Math.sin(a) * r * 2.0]], [r * 0.35, r * 0.2, r * 0.06], { sides: 6, vScale: 0.6 }));
    }
    return out;
  }
  // lying log along X, resting on the ground
  const pts = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([-L / 2 + L * t, r + (rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.04]); }
  const radii = pts.map((_, i) => r * (1 - 0.12 * (i / 6)));
  (out['c:bark'] ||= []).push(taperTube(pts, radii, { sides: 14, capEnd: false, vScale: 0.6, noise, noiseAmp: 0.06 }));
  for (const [x, rr, s] of [[-L / 2, radii[0], -1], [L / 2, radii[6], 1]]) {
    const c = new THREE.CircleGeometry(rr * 0.97, 18); c.rotateY(s * Math.PI / 2); c.translate(x, r, 0);
    (out['c:endGrain'] ||= []).push(c);
  }
  if (p.kind === 'catasta') { // woodpile: more logs stacked
    const out2 = out;
    let k = 0;
    for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) {
      if (row === 0 && i === 0) continue;
      const z = (i - (2 - row) / 2) * r * 2.02, y = row * r * 1.75;
      const g = taperTube([[-L / 2, r + y, z], [L / 2, r + y, z]], [r * 0.95, r * 0.9], { sides: 12, capEnd: false, vScale: 0.6 });
      out2['c:bark'].push(g);
      for (const s of [-1, 1]) { const c = new THREE.CircleGeometry(r * 0.88, 14); c.rotateY(s * Math.PI / 2); c.translate(s * L / 2, r + y, z); out2['c:endGrain'].push(c); }
      k++;
    }
  }
  return out;
}

// ------------------------------------------------------------------ terrain, pond, dune
/** Round terrain patch: polar grid inside a noisy elliptical outline (natural edges). */
function roundField(W, D, hfn, role, out, { tile = 2, seed = 1, rings = 30, segs = 72 } = {}) {
  const noise = makeNoise(seed * 3 + 77);
  const pos = [], uv = [], idx = [];
  pos.push(0, Math.max(0.004, hfn(0, 0, 0)), 0); uv.push(0, 0);
  const edge = (a) => 1 + 0.12 * noise(Math.cos(a) * 1.7, Math.sin(a) * 1.7, 3) + 0.05 * noise(Math.cos(a) * 5, Math.sin(a) * 5, 9);
  for (let r = 1; r <= rings; r++) {
    const t = r / rings;
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2, e = edge(a) * t;
      const x = Math.cos(a) * W / 2 * e, z = Math.sin(a) * D / 2 * e;
      const fall = r === rings ? 0 : 1;
      pos.push(x, Math.max(0.004, hfn(x, z, t) * fall), z); uv.push(x / tile, z / tile);
    }
  }
  for (let k = 0; k < segs; k++) idx.push(0, 1 + ((k + 1) % segs), 1 + k);
  for (let r = 1; r < rings; r++) for (let k = 0; k < segs; k++) {
    const a = 1 + (r - 1) * segs + k, b = 1 + (r - 1) * segs + ((k + 1) % segs), c = a + segs, d = b + segs;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  (out[role] ||= []).push(g);
  return g;
}

function heightField(W, D, res, hfn, role, out, { tile = 2 } = {}) {
  const nx = Math.max(8, Math.round(res * W / Math.max(W, D))), nz = Math.max(8, Math.round(res * D / Math.max(W, D)));
  const g = new THREE.PlaneGeometry(W, D, nx, nz);
  g.rotateX(-Math.PI / 2);
  const pp = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), z = pp.getZ(i);
    pp.setY(i, Math.max(0.004, hfn(x, z)));
    uv.setXY(i, x / tile, z / tile);
  }
  g.computeVertexNormals();
  (out[role] ||= []).push(g);
  return g;
}
const SURF = { erba: 'c:grass', terra: 'c:dirt', sabbia: 'c:sand', neve: 'c:snow', roccia: 'c:rock' };
function collina(p) {
  const out = {}, noise = makeNoise((p.seed || 1) * 37);
  const W = p.width, D = p.depth, H = p.height, rough = p.rough;
  const edge = (x, z) => { const u = Math.min(1, Math.hypot((2 * x) / W, (2 * z) / D)); return u >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * u); };
  const f = {
    collina: (x, z) => H * edge(x, z) ** 1.3,
    ondulato: (x, z) => H * (0.5 + 0.5 * noise.fbm(x * 0.12 + 3, 0, z * 0.12, 3)),
    pendio: (x, z) => H * Math.max(0, 0.5 - z / D) ** 1.5 * Math.min(1, (1 - Math.abs(2 * x / W)) * 4) * Math.min(1, (0.5 + z / D) * 8),
  }[p.shape] || ((x, z) => H * edge(x, z));
  const hf = (x, z) => f(x, z) * (1 + rough * 0.35 * noise.fbm(x * 0.35, 1, z * 0.35, 4)) + rough * 0.06 * noise(x * 2, 2, z * 2) * Math.min(1, f(x, z) / Math.max(0.01, H) * 5);
  if (p.shape === 'pendio') heightField(W, D, 64, hf, SURF[p.surface] || 'c:grass', out, { tile: 2 });
  else {
    // round patch: heights fade to the noisy outline
    const g = (x, z, t) => (p.shape === 'collina' ? hf(x, z) : hf(x, z) * Math.min(1, (1 - t) * 4));
    roundField(W, D, g, SURF[p.surface] || 'c:grass', out, { tile: 2, seed: p.seed || 1 });
  }
  return out;
}
function laghetto(p) {
  const out = {}, rnd = rng(p.seed || 1), noise = makeNoise((p.seed || 1) * 41);
  const R = p.size / 2, N = 48;
  const rad = (a) => R * (1 + 0.18 * noise(Math.cos(a) * 1.5 + 5, Math.sin(a) * 1.5, 0) + 0.06 * noise(Math.cos(a) * 4, Math.sin(a) * 4, 2));
  const water = [], bankIn = [], bankOut = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, r = rad(a);
    water.push([Math.cos(a) * (r + 0.05), Math.sin(a) * (r + 0.05)]);
    bankIn.push([Math.cos(a) * r, Math.sin(a) * r]);
    bankOut.push([Math.cos(a) * (r + 1.1), Math.sin(a) * (r + 1.1)]);
  }
  // dark bed + water surface
  (out['c:mud'] ||= []).push(polyXZ(water, 0.004, 1));
  (out['c:water'] ||= []).push(polyXZ(water, 0.05, 3));
  // bank: ring sloping from the water line up to the edge and back down to the ground
  const rings = [];
  for (const [k, y] of [[0, 0.03], [0.3, 0.12], [0.75, 0.1], [1, 0.004]]) {
    const ring = [];
    for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2, r = rad(a) + k * 1.1; ring.push([Math.cos(a) * r, y + 0.03 * noise(Math.cos(a) * 3, Math.sin(a) * 3, k * 4), Math.sin(a) * r]); }
    rings.push(ring);
  }
  // loft across the bank (rings are closed loops along the angle -> transpose: strips per angle)
  const strips = [];
  for (let i = 0; i <= N; i++) strips.push(rings.map((r) => r[i % N]));
  let g = loft(strips, { closed: false });
  if (g.attributes.normal.getY(1) < 0) { g.dispose(); g = loft(strips, { closed: false, flip: true }); }
  const pp = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pp.count; i++) uv.setXY(i, pp.getX(i) / 2, pp.getZ(i) / 2);
  (out[p.bank === 'sabbia' ? 'c:sand' : p.bank === 'terra' ? 'c:dirt' : 'c:grass'] ||= []).push(g);
  if (p.stones) {
    const geos = [];
    for (let i = 0; i < Math.round(R * 6); i++) {
      const a = rnd() * Math.PI * 2, r = rad(a) + 0.1 + rnd() * 0.35;
      const s = 0.12 + rnd() * 0.22;
      const st = rockGeo(s, rnd, makeNoise(i * 7 + (p.seed || 1)), { flat: 0.55, sharp: 0.1, detail: 1 });
      st.translate(Math.cos(a) * r, 0.04, Math.sin(a) * r);
      geos.push(st);
    }
    (out['c:rock'] ||= []).push(...geos);
  }
  if (p.reeds) {
    const pos = [];
    for (let i = 0; i < Math.round(R * 50); i++) {
      const a = rnd() * Math.PI * 2, r = rad(a) - 0.1 + rnd() * 0.4;
      if (rnd() < 0.5 && Math.cos(a * 3 + 1) < 0) continue; // clustered
      const x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.6 + rnd() * 0.9, w = 0.02;
      const tx = (rnd() - 0.5) * 0.3, tz = (rnd() - 0.5) * 0.3, o = rnd() * Math.PI;
      pos.push(x - Math.cos(o) * w, 0.03, z - Math.sin(o) * w, x + Math.cos(o) * w, 0.03, z + Math.sin(o) * w, x + tx, h, z + tz);
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.computeVertexNormals();
    (out['c:reed'] ||= []).push(rg);
  }
  return out;
}
function duna(p) {
  const out = {}, noise = makeNoise((p.seed || 1) * 43);
  const W = p.width, D = p.depth, H = p.height;
  roundField(W, D, (x, z, t) => {
    const u = z / (D / 2); // -1..1 along the wind: gentle windward slope (-z), steep lee (+z)
    const crest = 0.25 + 0.15 * noise(x * 0.15, 0, 3);
    const prof = u < crest ? Math.pow(Math.max(0, (u + 1) / (crest + 1)), 1.6) : Math.max(0, 1 - ((u - crest) / (1 - crest)) * 1.15) ** 0.7;
    const side = Math.max(0, 1 - Math.abs(2 * x / W) ** 2.2);
    return H * prof * side * Math.min(1, (1 - t) * 3) * (1 + 0.1 * noise.fbm(x * 0.2, 0, z * 0.2, 3));
  }, 'c:sand', out, { tile: 2, seed: p.seed || 1, rings: 36 });
  return out;
}

// ------------------------------------------------------------------ registry
const S = seedParam;
const HEIGHT = (def, min = 3, max = 25) => range('height', 'Altezza', min, max, 0.5, def);
const WIDTH = range('width', 'Chioma', 0.6, 1.5, 0.05, 1, '');
const SEASONS = seg('season', 'Stagione', [['estate', 'Estate'], ['autunno', 'Autunno'], ['inverno', 'Inverno'], ['fiori', 'Fioritura']], 'estate');
const T = (id, label, sub, color, params, build, extra = {}) => ({ id, label, cat: 'esterni', sub, color, params: [...params, S(1)], build, palette: 'leaf', ...extra });
const treeType = (id, label, species, color, h, extra = {}, season = 'estate') => T(id, label, 'alberi', color,
  [HEIGHT(h), WIDTH, ...(['quercia', 'latifoglia', 'betulla', 'salice'].includes(species) ? [{ ...SEASONS, default: season }] : [])],
  (p) => { const out = {}; treeInto(out, species, p); return out; }, { tree: species, ...extra });

export const NATURE_TYPES = [
  treeType('es_quercia', 'Quercia', 'quercia', '#6f8f4a', 10, { tags: 'albero quercia grande parco' }),
  treeType('es_latifoglia', 'Albero da viale', 'latifoglia', '#6f8f4a', 11, { tags: 'albero platano tiglio viale' }),
  treeType('es_betulla', 'Betulla', 'betulla', '#8aa356', 12, { tags: 'albero betulla bianco' }),
  treeType('es_pino', 'Pino marittimo', 'pino', '#4f6b3a', 13, { tags: 'albero pino domestico ombrello mediterraneo' }),
  treeType('es_abete', 'Abete', 'abete', '#4d6e40', 14, { tags: 'albero conifera natale montagna' }),
  treeType('es_cipresso', 'Cipresso', 'cipresso', '#46603a', 12, { tags: 'albero toscana cimitero' }),
  treeType('es_palma', 'Palma', 'palma', '#6c8a3e', 8, { tags: 'albero tropicale spiaggia mare' }),
  treeType('es_salice', 'Salice piangente', 'salice', '#7f9e4a', 9, { tags: 'albero salice lago' }),
  treeType('es_acero', 'Albero autunnale', 'latifoglia', '#ffffff', 10, { tags: 'albero acero autunno foglie rosse' }, 'autunno'),
  treeType('es_spoglio', 'Albero spoglio', 'quercia', '#6f8f4a', 10, { tags: 'albero inverno nudo secco' }, 'inverno'),
  treeType('es_ciliegio', 'Albero in fiore', 'latifoglia', '#ffffff', 7, { tags: 'albero ciliegio primavera fiori rosa' }, 'fiori'),
  T('es_filare', 'Filare di alberi', 'alberi', '#6f8f4a', [int('count', 'Alberi', 2, 12, 5), range('spacing', 'Distanza', 3, 15, 0.5, 7), HEIGHT(9),
    seg('species', 'Specie', [['latifoglia', 'Da viale'], ['quercia', 'Quercia'], ['betulla', 'Betulla'], ['cipresso', 'Cipresso'], ['pino', 'Pino'], ['palma', 'Palma']], 'latifoglia'), SEASONS], row,
  { tags: 'alberi viale fila', heavy: true }),
  T('es_bosco', 'Gruppo di alberi', 'alberi', '#6f8f4a', [int('count', 'Alberi', 3, 30, 12), range('radius', 'Raggio', 4, 30, 0.5, 10), HEIGHT(11),
    seg('mix', 'Tipo', [['misto', 'Misto'], ['latifoglie', 'Latifoglie'], ['conifere', 'Conifere'], ['mediterraneo', 'Mediterraneo']], 'misto'), SEASONS], grove,
  { tags: 'bosco foresta alberi macchia', heavy: true }),
  T('es_cespuglio', 'Cespuglio', 'natura', '#5f7f3f', [range('size', 'Dimensione', 0.4, 3, 0.05, 1.2), flag('flowers', 'Fiori', false), seg('fcolor', 'Colore fiori', [['misto', 'Misti'], ['rosso', 'Rossi'], ['rosa', 'Rosa'], ['bianco', 'Bianchi'], ['giallo', 'Gialli']], 'rosa')], cespuglio,
    { tags: 'cespuglio arbusto pianta' }),
  T('es_siepe', 'Siepe', 'natura', '#4d6b35', [range('length', 'Lunghezza', 0.5, 12, 0.1, 3), range('height', 'Altezza', 0.4, 3, 0.05, 1.2), range('depth', 'Spessore', 0.4, 1.5, 0.05, 0.7),
    seg('style', 'Forma', [['potata', 'Potata'], ['naturale', 'Naturale']], 'potata')], siepe, { tags: 'siepe bosso recinzione verde' }),
  T('es_prato', 'Prato', 'natura', '#6a8a3e', [range('width', 'Larghezza', 1, 20, 0.5, 5), range('depth', 'Profondità', 1, 20, 0.5, 4), range('bladeH', 'Altezza erba', 0.05, 0.8, 0.01, 0.18),
    seg('density', 'Densità', [['bassa', 'Bassa'], ['media', 'Media'], ['alta', 'Alta']], 'media'), seg('shape', 'Forma', [['ovale', 'Ovale'], ['rettangolo', 'Rettangolo']], 'ovale'), flag('flowers', 'Fiori di campo', false)], prato,
  { tags: 'erba prato ciuffi giardino', heavy: true }),
  T('es_aiuola', 'Aiuola fiorita', 'natura', '#4f7a3a', [range('width', 'Larghezza', 0.5, 6, 0.1, 2), range('depth', 'Profondità', 0.4, 4, 0.1, 1),
    seg('fcolor', 'Fiori', [['misto', 'Misti'], ['rosso', 'Rossi'], ['giallo', 'Gialli'], ['bianco', 'Bianchi'], ['viola', 'Viola'], ['rosa', 'Rosa']], 'misto'), seg('edge', 'Bordo', [['pietra', 'Pietra'], ['mattoni', 'Mattoni'], ['nessuno', 'Nessuno']], 'pietra')], aiuola,
  { tags: 'fiori aiuola giardino' }),
  T('es_roccia', 'Roccia', 'rocce', '#c9c3b8', [range('size', 'Dimensione', 0.2, 6, 0.05, 1.2), seg('shape', 'Forma', [['masso', 'Masso'], ['lastra', 'Lastra'], ['appuntita', 'Appuntita'], ['ciottolo', 'Ciottolo']], 'masso'),
    int('count', 'Quante', 1, 9, 1), flag('moss', 'Muschio', false)], roccia, { tags: 'roccia masso sasso pietra', tint: true, palette: 'rock' }),
  T('es_tronco', 'Tronco', 'tronchi', '#ffffff', [seg('kind', 'Tipo', [['tronco', 'Tronco'], ['ceppo', 'Ceppo'], ['catasta', 'Catasta']], 'tronco'), range('length', 'Lunghezza', 0.5, 8, 0.1, 3), range('diameter', 'Diametro', 0.1, 1.2, 0.02, 0.4)], tronco,
    { tags: 'tronco legno ceppo catasta legna', palette: 'rock' }),
  T('es_collina', 'Collina', 'natura', '#ffffff', [seg('shape', 'Forma', [['collina', 'Collina'], ['ondulato', 'Ondulato'], ['pendio', 'Pendio']], 'collina'), range('width', 'Larghezza', 4, 60, 1, 20), range('depth', 'Profondità', 4, 60, 1, 20),
    range('height', 'Altezza', 0.3, 12, 0.1, 3), range('rough', 'Irregolarità', 0, 1, 0.05, 0.4, ''), seg('surface', 'Superficie', [['erba', 'Erba'], ['terra', 'Terra'], ['sabbia', 'Sabbia'], ['neve', 'Neve'], ['roccia', 'Roccia']], 'erba')], collina,
  { tags: 'collina terreno prato montagna neve', palette: 'rock', heavy: true }),
  T('es_laghetto', 'Laghetto', 'natura', '#ffffff', [range('size', 'Dimensione', 2, 20, 0.5, 6), seg('bank', 'Sponda', [['erba', 'Erba'], ['terra', 'Terra'], ['sabbia', 'Sabbia']], 'erba'), flag('stones', 'Sassi', true), flag('reeds', 'Canne', true)], laghetto,
    { tags: 'lago stagno acqua pozza', palette: 'rock' }),
  T('es_duna', 'Duna di sabbia', 'natura', '#ffffff', [range('width', 'Larghezza', 4, 60, 1, 16), range('depth', 'Profondità', 4, 60, 1, 14), range('height', 'Altezza', 0.3, 10, 0.1, 2.5)], duna,
    { tags: 'deserto sabbia spiaggia duna', palette: 'rock', heavy: true }),
];

export const NATURE_ROLES = {
  'c:moss': () => ({ kind: 'prop', color: '#556b2f', roughness: 0.95 }),
};
export { SPECIES };
