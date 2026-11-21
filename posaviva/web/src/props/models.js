// Loader + cache of the realistic (glTF) prop models.
//
// A model prop type has `model: 'assets/props/models/x.glb'` (URL relative to the
// app) and `size: [w, h, d]` (meters, used for the placeholder box while the file
// loads). Files are loaded once on first use and shared by every instance: parts
// keep the GLB geometry (quantized attributes + node matrix) and the textures;
// the props module turns each part into a mesh with a material-library spec, so
// every render style works.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let _loader = null;
function loader() {
  if (!_loader) {
    _loader = new GLTFLoader();
    _loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return _loader;
}

/** url -> {state: 'loading'|'ready'|'error', parts, box, promise, error} */
const cache = new Map();

/**
 * Model parts of a URL: {parts: [{geometry, matrix, mat: {...}}], box} once loaded.
 * Returns the cache entry (state may still be 'loading'; await entry.promise).
 */
export function loadModel(url) {
  let e = cache.get(url);
  if (e) return e;
  e = { state: 'loading', parts: null, box: null, error: null, promise: null };
  cache.set(url, e);
  e.promise = new Promise((resolve) => {
    loader().load(url, (gltf) => {
      try {
        e.parts = extractParts(gltf.scene);
        e.box = new THREE.Box3();
        for (const p of e.parts) e.box.union(p.box);
        e.state = 'ready';
      } catch (err) { e.state = 'error'; e.error = err; console.warn('[props] model parse failed', url, err); }
      resolve(e);
    }, undefined, (err) => {
      e.state = 'error'; e.error = err;
      console.warn('[props] model load failed', url, err?.message || err);
      resolve(e);
    });
  });
  return e;
}

export function modelEntry(url) { return cache.get(url) || null; }

/** Preloads a few URLs (idle time, e.g. the items of a room preset). */
export function preloadModels(urls) { return Promise.all(urls.map((u) => loadModel(u).promise)); }

function extractParts(root) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    // GLTFLoader may add a vertex color attribute; props only use position/normal/uv
    if (g.attributes.color && !(o.material?.vertexColors)) g.deleteAttribute('color');
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingSphere) g.computeBoundingSphere();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    // multi-material primitives are split by GLTFLoader into separate meshes already
    const m = mats[0] || {};
    const matrix = o.matrixWorld.clone();
    const box = g.boundingBox.clone().applyMatrix4(matrix);
    for (const t of [m.map, m.normalMap]) if (t) t.anisotropy = 4;
    parts.push({
      geometry: g,
      matrix,
      box,
      mat: {
        color: m.color ? '#' + m.color.getHexString() : '#ffffff',
        map: m.map || null,
        normalMap: m.normalMap || null,
        normalScale: m.normalMap && m.normalScale ? [m.normalScale.x, m.normalScale.y] : undefined,
        roughness: m.roughness ?? 0.7,
        metalness: m.metalness ?? 0,
        side: m.side === THREE.DoubleSide ? 'double' : undefined,
        alphaTest: m.alphaTest || undefined,
        transparent: m.transparent || undefined,
        opacity: m.transparent ? m.opacity : undefined,
      },
    });
    // the GLTF material itself is not used (the material library builds the real ones)
    for (const mm of mats) mm?.dispose?.();
  });
  return parts;
}

/**
 * Material-library spec of a model part with an optional tint (multiplied with
 * the part's own base color). White = original look.
 */
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
export function partSpec(part, tint) {
  const m = part.mat;
  _c1.set(m.color);
  if (tint && tint.toLowerCase() !== '#ffffff') _c1.multiply(_c2.set(tint));
  const s = { kind: 'prop', color: '#' + _c1.getHexString(), roughness: +m.roughness.toFixed(3), metalness: +m.metalness.toFixed(3) };
  if (m.map) s.map = m.map;
  if (m.normalMap) { s.normalMap = m.normalMap; if (m.normalScale) s.normalScale = m.normalScale; }
  if (m.side) s.side = m.side;
  if (m.alphaTest) s.alphaTest = m.alphaTest;
  if (m.transparent) { s.transparent = true; if (m.opacity !== undefined) s.opacity = m.opacity; }
  return s;
}
