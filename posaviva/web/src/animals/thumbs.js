// Species thumbnails for the "Animali" catalog: each species is rendered once
// (lazily, one per frame) with the app renderer into a small target, using
// private fixed-look materials (vertex colours of the first coat), then kept
// as a data URL in localStorage so later sessions show them instantly.
import * as THREE from 'three';
import { loadSpecies } from './loader.js';
import { coatColors } from './coatColor.js';
import { posesFor, resolvePose } from './poses.js';

const D2R = Math.PI / 180;

/** Rest positions skinned into the species' default pose (birds: wings folded), or null. */
function defaultPosePositions(data) {
  const e = data.entry;
  const def = e.defaultPose && posesFor(e).find((p) => p.id === e.defaultPose);
  if (!def) return null;
  const eul = resolvePose(e, def);
  const nb = e.bones.length, world = [], skinM = [];
  const q = new THREE.Quaternion(), t = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), m = new THREE.Matrix4();
  for (let i = 0; i < nb; i++) {
    const b = e.bones[i], r = eul[b.name];
    q.identity();
    if (r) q.setFromEuler(new THREE.Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'XYZ'));
    if (b.parent < 0) t.fromArray(b.head); else { const p = e.bones[b.parent]; t.set(b.head[0] - p.head[0], b.head[1] - p.head[1], b.head[2] - p.head[2]); }
    const local = new THREE.Matrix4().compose(t, q, one);
    world[i] = b.parent < 0 ? local : new THREE.Matrix4().multiplyMatrices(world[b.parent], local);
    skinM[i] = new THREE.Matrix4().multiplyMatrices(world[i], m.makeTranslation(-b.head[0], -b.head[1], -b.head[2]));
  }
  const n = data.count, P = data.rest, NR = data.normals, out = new Float32Array(n * 3), nout = new Float32Array(n * 3);
  const v = new THREE.Vector3(), acc = new THREE.Vector3(), nv = new THREE.Vector3(), nacc = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    acc.set(0, 0, 0); nacc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = data.weight[i * 4 + k];
      if (!w) continue;
      const M = skinM[data.skin[i * 4 + k]];
      v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(M);
      acc.addScaledVector(v, w / 255);
      nv.set(NR[i * 3], NR[i * 3 + 1], NR[i * 3 + 2]).transformDirection(M);
      nacc.addScaledVector(nv, w / 255);
    }
    nacc.normalize();
    out[i * 3] = acc.x; out[i * 3 + 1] = acc.y; out[i * 3 + 2] = acc.z;
    nout[i * 3] = nacc.x; nout[i * 3 + 1] = nacc.y; nout[i * 3 + 2] = nacc.z;
  }
  const bi = new Map(e.bones.map((b, i) => [b.name, i]));
  const eyes = (e.eyes || []).map((y) => ({ r: y.r, pos: new THREE.Vector3().fromArray(y.pos).applyMatrix4(skinM[bi.get(y.bone) ?? 0]) }));
  return { pos: out, nrm: nout, eyes };
}

const SIZE = 160;
const KEY = 'posaviva.animals.thumbs.v2';

function loadStore() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }

export class AnimalThumbs {
  constructor(app) {
    this.app = app;
    this.store = loadStore();
    this.queue = [];
    this.busy = false;
    this.scene = null;
  }

  /** <img> for a species entry; rendering starts when request(img) is called. */
  imageFor(entry) {
    const img = document.createElement('img');
    img.className = 'pv-an-thumb';
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.onload = () => img.classList.add('ready');
    const key = entry.id + ':' + entry.bytes;
    if (this.store[key]) img.src = this.store[key];
    else img._pvEntry = entry;
    return img;
  }

  request(img) {
    if (!img?._pvEntry || img._pvQueued) return;
    img._pvQueued = true;
    this.queue.push(img);
    this._next();
  }

  async _next() {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    const img = this.queue.shift();
    const entry = img._pvEntry;
    const key = entry.id + ':' + entry.bytes;
    try {
      if (!this.store[key]) {
        const data = await loadSpecies(entry.id);
        await new Promise((r) => requestAnimationFrame(r));
        this.store[key] = this._render(data);
        try { localStorage.setItem(KEY, JSON.stringify(this.store)); } catch { /* quota: keep in memory */ }
      }
      img.src = this.store[key];
    } catch (e) { console.warn('[animals] thumbnail failed', entry.id, e); }
    this.busy = false;
    if (this.queue.length) this._next(); else this._dispose();
  }

  _setup() {
    if (this.scene) return;
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight('#ffffff', '#5a5650', 1.6));
    const key = new THREE.DirectionalLight('#fff4ea', 2.0);
    key.position.set(2, 3, 2.5);
    const rim = new THREE.DirectionalLight('#cfe0ff', 1.0);
    rim.position.set(-2.5, 1.5, -2);
    s.add(key, rim);
    this.scene = s;
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.01, 100);
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    this.pixels = new Uint8Array(SIZE * SIZE * 4);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    this.eyeMat = new THREE.MeshStandardMaterial({ color: '#1a1412', roughness: 0.2 });
  }

  _render(data) {
    this._setup();
    const e = data.entry;
    const g = new THREE.BufferGeometry();
    const posed = defaultPosePositions(data);
    if (posed) { g.setAttribute('position', new THREE.BufferAttribute(posed.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(posed.nrm, 3)); }
    else { g.setAttribute('position', data.attrs.position); g.setAttribute('normal', data.attrs.normal); }
    const col = new Float32Array(data.count * 3);
    coatColors(e.palettes[0].colors, data.masks, data.extra, data.count, col);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(data.index);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(g, this.material));
    for (const eye of posed ? posed.eyes : e.eyes || []) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(eye.r, 12, 8), this.eyeMat);
      if (posed) m.position.copy(eye.pos); else m.position.fromArray(eye.pos);
      group.add(m);
    }
    group.rotation.y = 0.95; // 3/4 view from the animal's left front
    this.scene.add(group);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const cam = this.camera;
    const dir = new THREE.Vector3(0, 0.32, 1).normalize();
    const dist = (sphere.radius / Math.sin((cam.fov * Math.PI) / 360)) * 0.8;
    cam.position.copy(sphere.center).addScaledVector(dir, dist);
    cam.near = dist / 20; cam.far = dist * 4;
    cam.lookAt(sphere.center);
    cam.updateProjectionMatrix();
    const r = this.app.renderer;
    const prevTarget = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(this.scene, cam);
    r.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.pixels);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    r.shadowMap.autoUpdate = prevShadow;
    const ctx = this.canvas.getContext('2d');
    const im = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      const sy = (SIZE - 1 - y) * SIZE * 4, dy = y * SIZE * 4;
      for (let x = 0; x < SIZE * 4; x += 4) {
        const a = this.pixels[sy + x + 3], k = a > 0 && a < 255 ? 255 / a : 1;
        im.data[dy + x] = Math.min(255, this.pixels[sy + x] * k);
        im.data[dy + x + 1] = Math.min(255, this.pixels[sy + x + 1] * k);
        im.data[dy + x + 2] = Math.min(255, this.pixels[sy + x + 2] * k);
        im.data[dy + x + 3] = a;
      }
    }
    ctx.putImageData(im, 0, 0);
    this.scene.remove(group);
    g.dispose();
    for (const c of group.children) if (c.geometry !== g) c.geometry.dispose();
    let url = this.canvas.toDataURL('image/webp', 0.86);
    if (!url.startsWith('data:image/webp')) url = this.canvas.toDataURL('image/png');
    return url;
  }

  _dispose() {
    if (!this.scene) return;
    this.target.dispose();
    this.material.dispose(); this.eyeMat.dispose();
    this.scene = null;
  }
}
