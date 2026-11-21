// Loads the animal manifest and species binaries (assets/animals, built by
// tools/build-animals.mjs) and decodes them into shared BufferAttributes.
import * as THREE from 'three';

const BASE = './assets/animals/';
let manifestP = null;
const speciesP = new Map();
const speciesData = new Map(); // id -> decoded data once loaded

/** Decoded species data if already loaded (synchronous), else null. */
export function peekSpecies(id) { return speciesData.get(id) || null; }

/** Manifest {version, species:[entry]} (cached). */
export function loadManifest() {
  if (!manifestP) {
    manifestP = fetch(BASE + 'animals.json').then((r) => {
      if (!r.ok) throw new Error('animals.json ' + r.status);
      return r.json();
    }).catch((e) => { manifestP = null; throw e; });
  }
  return manifestP;
}

/**
 * Decoded species data (cached): {entry, attrs: {position, normal, uv, skinIndex,
 * skinWeight}, index, masks, extra, rest (Float32Array rest positions), count}.
 */
export function loadSpecies(id) {
  let p = speciesP.get(id);
  if (p) return p;
  p = (async () => {
    const man = await loadManifest();
    const entry = man.species.find((s) => s.id === id);
    if (!entry) throw new Error('specie sconosciuta: ' + id);
    const r = await fetch(BASE + entry.file);
    if (!r.ok) throw new Error(entry.file + ' ' + r.status);
    const buf = await r.arrayBuffer();
    const data = decode(entry, buf);
    speciesData.set(id, data);
    return data;
  })();
  p.catch(() => speciesP.delete(id));
  speciesP.set(id, p);
  return p;
}

function decode(entry, buf) {
  const L = entry.layout, n = entry.verts;
  const u16 = new Uint16Array(buf, L.pos[0], L.pos[1]);
  const nrm = new Int8Array(buf, L.nrm[0], L.nrm[1]);
  const chart = new Uint8Array(buf, L.chart[0], L.chart[1]);
  const masks = new Uint8Array(buf, L.mask[0], L.mask[1]);
  const extra = new Uint8Array(buf, L.extra[0], L.extra[1]);
  const skin = new Uint8Array(buf, L.skin[0], L.skin[1]);
  const weight = new Uint8Array(buf, L.weight[0], L.weight[1]);
  const index = entry.indexType === 'u32' ? new Uint32Array(buf, L.index[0], L.index[1]) : new Uint16Array(buf, L.index[0], L.index[1]);
  const { min, size } = entry.quant;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = min[k] + (u16[i * 3 + k] / 65535) * size[k];
  // box-mapped UVs for the fur detail map (1 unit = 1 m; the material scales it)
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], c = chart[i];
    if (c === 0) { uv[i * 2] = z; uv[i * 2 + 1] = y; } else if (c === 1) { uv[i * 2] = x; uv[i * 2 + 1] = z; } else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
  }
  const scale = entry.fur?.scale || 10;
  for (let i = 0; i < uv.length; i++) uv[i] *= scale;
  const attrs = {
    position: new THREE.BufferAttribute(pos, 3),
    normal: new THREE.BufferAttribute(nrm, 3, true),
    uv: new THREE.BufferAttribute(uv, 2),
    skinIndex: new THREE.BufferAttribute(skin, 4),
    skinWeight: new THREE.BufferAttribute(weight, 4, true),
  };
  const nf = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) nf[i] = Math.max(-1, nrm[i] / 127);
  return { entry, attrs, index: new THREE.BufferAttribute(index, 1), masks, extra, rest: pos, normals: nf, count: n, skin, weight };
}
