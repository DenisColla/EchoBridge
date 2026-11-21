// Catalog thumbnails for the Edifici tool: each building type rendered once
// with its real facade textures (fixed look, independent of the render style),
// one per animation frame, and cached in localStorage so later sessions show
// them instantly.
import * as THREE from 'three';
import { ROLES, defaultParams } from '../props/catalog.js';

const W = 168, H = 168;
const KEY = 'posaviva.buildings.thumbs.v5';

let store = null;
function loadStore() {
  if (store) return store;
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { store = {}; }
  return store;
}
let saveTimer = 0;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* quota: keep in memory */ } }, 800);
}

export class BuildingThumbs {
  constructor(app) {
    this.app = app;
    this.queue = [];
    this.done = new Map(); // type id -> img|canvas element
    this._raf = 0;
  }

  /** Image element for a type (filled when ready). */
  imageFor(type) {
    let el = this.done.get(type.id);
    if (el) return el;
    el = document.createElement('img');
    el.className = 'pv-bd-thumb';
    el.alt = '';
    const cached = loadStore()[type.id];
    if (cached) { el.src = cached; el.classList.add('ready'); }
    else { this.queue.push(type); this._schedule(); }
    this.done.set(type.id, el);
    return el;
  }

  _schedule() {
    if (this._raf || !this.queue.length) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const type = this.queue.shift();
      try { this._render(type, this.done.get(type.id)); } catch (e) { console.warn('[buildings] thumbnail failed', type.id, e); }
      if (this.queue.length) setTimeout(() => this._schedule(), 30); else this._dispose();
    });
  }

  _setup() {
    if (this.scene) return;
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight('#dfe9ff', '#6b6358', 1.6));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
    sun.position.set(3, 5, 4);
    s.add(sun);
    this.scene = s;
    this.camera = new THREE.PerspectiveCamera(28, W / H, 0.1, 5000);
    this.target = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    this.pixels = new Uint8Array(W * H * 4);
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx2d = this.canvas.getContext('2d');
    this.image = this.ctx2d.createImageData(W, H);
    this.content = new THREE.Group();
    s.add(this.content);
  }

  _render(type, el) {
    this._setup();
    const parts = type.build(defaultParams(type));
    const mats = [];
    for (const [role, list] of Object.entries(parts)) {
      const geo = list[0];
      if (!geo) continue;
      const spec = (ROLES[role] || ROLES.main)(type.color);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(spec.color), map: spec.map || null, normalMap: spec.normalMap || null,
        roughness: spec.roughness ?? 0.8, metalness: Math.min(0.4, spec.metalness ?? 0),
        side: spec.side === 'double' ? THREE.DoubleSide : THREE.FrontSide, transparent: !!spec.transparent, opacity: spec.opacity ?? 1,
      });
      mats.push(mat);
      this.content.add(new THREE.Mesh(geo, mat));
    }
    this.content.rotation.set(0, -0.62, 0);
    this.content.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.content);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const cam = this.camera;
    // seen from slightly above street level, a bit below the middle (buildings look tall)
    const dir = new THREE.Vector3(0, 0.22, 1).normalize();
    const fitH = size.y / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const fitW = Math.max(size.x, size.z) / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const dist = Math.max(fitH, fitW * 0.92) * 1.04 + Math.max(size.x, size.z) * 0.22;
    cam.position.copy(c).addScaledVector(dir, dist);
    cam.near = dist / 50; cam.far = dist * 4;
    cam.lookAt(c);
    cam.updateProjectionMatrix();

    const r = this.app.renderer;
    const prevTarget = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const prevShadow = r.shadowMap.autoUpdate, prevTone = r.toneMapping, prevExp = r.toneMappingExposure;
    r.shadowMap.autoUpdate = false;
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1;
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(this.scene, cam);
    r.readRenderTargetPixels(this.target, 0, 0, W, H, this.pixels);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    r.shadowMap.autoUpdate = prevShadow;
    r.toneMapping = prevTone; r.toneMappingExposure = prevExp;

    const src = this.pixels, dst = this.image.data;
    for (let y = 0; y < H; y++) {
      const sy = (H - 1 - y) * W * 4, dy = y * W * 4;
      for (let x = 0; x < W * 4; x += 4) {
        const a = src[sy + x + 3], k = a > 0 && a < 255 ? 255 / a : 1;
        dst[dy + x] = Math.min(255, src[sy + x] * k);
        dst[dy + x + 1] = Math.min(255, src[sy + x + 1] * k);
        dst[dy + x + 2] = Math.min(255, src[sy + x + 2] * k);
        dst[dy + x + 3] = a;
      }
    }
    this.ctx2d.putImageData(this.image, 0, 0);
    let url = this.canvas.toDataURL('image/webp', 0.86);
    if (!url.startsWith('data:image/webp')) url = this.canvas.toDataURL('image/png');
    el.src = url;
    el.classList.add('ready');
    loadStore()[type.id] = url;
    saveStore();
    for (const m of [...this.content.children]) { m.geometry.dispose(); this.content.remove(m); }
    for (const m of mats) m.dispose();
  }

  _dispose() {
    if (!this.scene) return;
    this.target.dispose();
    this.scene = null;
    this.target = null;
  }
}
