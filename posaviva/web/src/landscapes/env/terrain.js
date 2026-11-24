// Terrain heightfield around the stage: a polar grid centred on the landscape
// anchor (dense near the characters, coarse towards the horizon), exactly flat
// inside the stage, vertex-coloured by biome (grass, earth, sand, rock, snow,
// asphalt…), with a neutral detail texture. Material kind 'ground' through the
// material library (every render style), receives shadows, never inked.
// Also the water surface (sea / lake) as a large disc at the water level.
import * as THREE from 'three';
import { groundDetail, waterNormal } from './textures.js';

const _c = new THREE.Color();

/** Ring radii: ~0.8 m steps near the stage growing geometrically to outerR. */
function ringRadii(outerR) {
  const r = [0];
  let x = 0.8, step = 0.8;
  while (x < outerR) { r.push(x); step = Math.max(0.8, x * 0.08); x += step; }
  r.push(outerR);
  return r;
}

export class Terrain {
  constructor(materials) {
    this.materials = materials;
    this.mesh = null;
    this.water = null;
    this.cfg = null;
  }

  /**
   * cfg: {height(x, z), color(x, z, h, slope, rgb[3] sRGB 0..1), outerR, segs, roughness,
   *       water: {level, color} | null}; frame: {x, z, yaw} (local -> world).
   */
  build(cfg, frame) {
    this.dispose();
    this.cfg = cfg;
    this.frame = frame;
    const R = ringRadii(cfg.outerR || 1500), S = cfg.segs || 160;
    const NV = 1 + (R.length - 1) * S;
    const pos = new Float32Array(NV * 3), col = new Float32Array(NV * 3), uv = new Float32Array(NV * 2);
    const H = cfg.height;
    // vertices
    let k = 0;
    const put = (x, z) => {
      const y = H(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      uv[k * 2] = x / 4.5; uv[k * 2 + 1] = z / 4.5;
      k++;
    };
    put(0, 0);
    for (let i = 1; i < R.length; i++) {
      const r = R[i], off = (i % 2) * 0.5; // staggered rings: nicer triangles
      for (let j = 0; j < S; j++) { const a = ((j + off) / S) * Math.PI * 2; put(Math.cos(a) * r, Math.sin(a) * r); }
    }
    // indices
    const idx = [];
    for (let j = 0; j < S; j++) idx.push(0, 1 + ((j + 1) % S), 1 + j);
    for (let i = 1; i < R.length - 1; i++) {
      const a0 = 1 + (i - 1) * S, b0 = 1 + i * S;
      for (let j = 0; j < S; j++) {
        const j1 = (j + 1) % S;
        // ring i is offset by half a segment relative to ring i-1 (alternating)
        if (i % 2) { idx.push(a0 + j, a0 + j1, b0 + j); idx.push(a0 + j1, b0 + j1, b0 + j); }
        else { idx.push(a0 + j, b0 + j1, b0 + j); idx.push(a0 + j, a0 + j1, b0 + j1); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(NV > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    // colours from height / slope (normals known now)
    const nrm = geo.attributes.normal.array, rgb = [0, 0, 0];
    for (let v = 0; v < NV; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const slope = 1 - nrm[v * 3 + 1];
      cfg.color(x, z, y, slope, rgb);
      _c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      col[v * 3] = _c.r; col[v * 3 + 1] = _c.g; col[v * 3 + 2] = _c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo);
    mesh.name = 'landscape:terrain';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.isGround = true;
    mesh.userData.noBounds = true; // lights / framing: not part of the subject
    mesh.userData.landscape = 'terrain';
    mesh.position.set(frame.x, 0, frame.z);
    mesh.rotation.y = frame.yaw;
    const d = groundDetail();
    this.materials.apply(mesh, { kind: 'ground', color: '#ffffff', map: d.map, normalMap: d.normalMap, normalScale: 0.75, roughness: cfg.roughness ?? 0.96, vertexColors: true });
    this.mesh = mesh;

    if (cfg.water) {
      const wg = new THREE.CircleGeometry(cfg.outerR || 1500, 96).rotateX(-Math.PI / 2);
      const wuv = wg.attributes.uv, wp = wg.attributes.position;
      for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wp.getX(i) / 9, wp.getZ(i) / 9);
      const w = new THREE.Mesh(wg);
      w.name = 'landscape:water';
      w.position.set(frame.x, cfg.water.level, frame.z);
      w.rotation.y = frame.yaw;
      w.receiveShadow = true;
      w.userData.isGround = true;
      w.userData.noBounds = true;
      w.userData.landscape = 'water';
      this.materials.apply(w, { kind: 'ground', color: cfg.water.color || '#3d6f80', normalMap: waterNormal(), normalScale: 0.3, roughness: cfg.water.roughness ?? 0.08, metalness: 0.15 });
      this.water = w;
    }
    return mesh;
  }

  /** World -> local frame. */
  toLocal(x, z) {
    const f = this.frame, dx = x - f.x, dz = z - f.z, c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    return [dx * c - dz * s, dx * s + dz * c];
  }

  /** Terrain height at a world position (the analytic function the mesh samples). */
  heightAt(x, z) {
    if (!this.cfg) return 0;
    const [lx, lz] = this.toLocal(x, z);
    return this.cfg.height(lx, lz);
  }

  dispose() {
    for (const m of [this.mesh, this.water]) {
      if (!m) continue;
      this.materials.release(m);
      m.geometry.dispose();
      m.removeFromParent();
    }
    this.mesh = this.water = null;
    this.cfg = null;
  }
}
