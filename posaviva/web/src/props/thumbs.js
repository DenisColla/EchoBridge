// Catalog thumbnails. Procedural types are rendered once, lazily (only when
// their card scrolls into view, one per animation frame so the panel never
// janks), with the app's renderer into a small sRGB render target and copied
// into a 2D canvas. Realistic models ship a pre-rendered image (type.thumb).
// Room presets are rendered as a miniature of their procedural pieces.
// Thumbnail meshes are UI imagery (not scene props), so they use private,
// fixed-look materials independent of the current render style.
import * as THREE from 'three';
import { ROLES, defaultParams, cleanParams, TYPE_BY_ID } from './catalog.js';
import { mergeParts } from './geo.js';

const SIZE = 144;
/** per type thumbnail orientation (Euler XYZ, radians) where the default view is unclear */
const THUMB_ROT = {
  scudo: [-0.35, 0.5, 0],
  tazza: [0.15, 0.6, 0],
  borsa: [0.15, 0.6, 0],
  ombrello: [-0.55, 0.3, 0.3],
  telefono: [0.25, -1.25, 0.3],
  bicchiere: [0.15, 0.5, 0],
  bottiglia: [0.15, 0.5, 0],
  manubrio: [0.3, 0.6, -1.2],
  chitarra: [0.1, 0.5, 0.25],
  tende: [0, 0.25, 0],
  quadro: [0, 0.3, 0],
  finestra: [0, 0.35, 0],
  porta: [0, 0.45, 0],
  lavagna: [0, 0.35, 0],
  tappeto: [0.5, 0.4, 0],
};
const DIR_DEFAULT = new THREE.Vector3(0.0, 0.42, 1).normalize();
const DIR_TOP = new THREE.Vector3(0.0, 1.1, 1).normalize();

export class ThumbRenderer {
  constructor(app) {
    this.app = app;
    this.queue = [];
    this.done = new Map(); // key -> canvas
    this._raf = 0;
    this.scene = null;
  }

  /**
   * Thumbnail element of a type: an <img> for types with a shipped image, a
   * canvas otherwise (blank until rendered). `lazy`: rendering starts on request().
   */
  elementFor(type, { lazy = false } = {}) {
    if (type.thumb) {
      const img = document.createElement('img');
      img.className = 'pv-pr-thumb';
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.onload = () => img.classList.add('ready');
      img.onerror = () => img.classList.add('ready');
      if (lazy) img.dataset.src = type.thumb; else img.src = type.thumb;
      return img;
    }
    return this.canvasFor(type, { lazy });
  }

  /** Canvas for a type (blank until rendered; lazy: rendering starts on request()). */
  canvasFor(type, { lazy = false } = {}) {
    return this._canvas(type.id, { type }, lazy);
  }

  /** Canvas for a room preset (rendered on request). */
  presetCanvas(preset) {
    return this._canvas(`preset:${preset.id}`, { preset }, true);
  }

  _canvas(key, job, lazy) {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    c.className = 'pv-pr-thumb';
    c._pvJob = { ...job, key };
    const src = this.done.get(key);
    if (src) { c.getContext('2d').drawImage(src, 0, 0); c.classList.add('ready'); return c; }
    if (!lazy) this.request(c);
    return c;
  }

  /** Starts rendering a lazy thumbnail element (canvas job or <img data-src>). */
  request(el) {
    if (!el) return;
    if (el.tagName === 'IMG') { if (el.dataset.src && !el.getAttribute('src')) el.src = el.dataset.src; return; }
    const job = el._pvJob;
    if (!job || job.queued || el.classList.contains('ready')) return;
    job.queued = true;
    this.queue.push(el);
    this._schedule();
  }

  _schedule() {
    if (this._raf || !this.queue.length) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const c = this.queue.shift();
      const job = c._pvJob;
      try {
        const src = this.done.get(job.key);
        if (src) { c.getContext('2d').drawImage(src, 0, 0); c.classList.add('ready'); }
        else {
          if (job.preset) this._renderPreset(job.preset, c); else this._render(job.type, c);
          this.done.set(job.key, c);
        }
      } catch (e) { console.warn('[props] thumbnail failed', job.key, e); }
      if (this.queue.length) this._schedule(); else this._dispose();
    });
  }

  _setup() {
    if (this.scene) return;
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight('#ffffff', '#5a5650', 1.5));
    const key = new THREE.DirectionalLight('#fff4ea', 1.9);
    key.position.set(2, 3, 2.5);
    const rim = new THREE.DirectionalLight('#cfe0ff', 0.9);
    rim.position.set(-2.5, 1.5, -2);
    s.add(key, rim);
    this.scene = s;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    this.pixels = new Uint8Array(SIZE * SIZE * 4);
    this.image = new ImageData(SIZE, SIZE);
    this.content = new THREE.Group();
    s.add(this.content);
    this.mats = new Map();
  }

  /** Private (style-independent) material for a role spec. */
  _material(spec) {
    const key = JSON.stringify(spec, (k, v) => (v && v.isTexture ? v.uuid : v));
    let m = this.mats.get(key);
    if (m) return m;
    const col = new THREE.Color(spec.color ?? '#cccccc');
    // very dark parts (phone, screen) would vanish on the dark cards: lift them a bit
    const lum = col.r * 0.2126 + col.g * 0.7152 + col.b * 0.0722; // linear
    if (lum < 0.05 && !spec.map) col.lerp(new THREE.Color('#8b93a3'), 0.4);
    m = new THREE.MeshStandardMaterial({
      color: col, roughness: spec.roughness ?? 0.6, map: spec.map || null, vertexColors: !!spec.vertexColors,
      metalness: Math.min(0.35, spec.metalness ?? 0), side: spec.side === 'double' ? THREE.DoubleSide : THREE.FrontSide,
      transparent: !!spec.transparent, opacity: spec.transparent ? Math.max(0.35, spec.opacity ?? 1) : 1,
    });
    this.mats.set(key, m);
    return m;
  }

  /** Adds the meshes of a procedural type to `parent`; returns false for model types. */
  _addType(type, params, color, parent) {
    if (type.model) return false;
    const parts = type.build(params);
    const specs = parts.$specs || {};
    for (const [role, list] of Object.entries(parts)) {
      if (role === '$specs') continue;
      const geo = mergeParts(list);
      if (!geo) continue;
      const sp = specs[role] ? (typeof specs[role] === 'function' ? specs[role](color) : specs[role]) : (ROLES[role] || ROLES.main)(color);
      parent.add(new THREE.Mesh(geo, this._material(sp)));
    }
    return true;
  }

  _render(type, canvas) {
    this._setup();
    this._addType(type, defaultParams(type), type.color, this.content);
    // hand props are shown as held (grip space), scene props from a 3/4 view
    const rot = THUMB_ROT[type.id] || (type.hand ? [0.35, 0.9, -0.5] : [0, 0.55, 0]);
    this.content.rotation.set(rot[0], rot[1], rot[2]);
    this._shoot(canvas, type.id === 'stanza' || type.id === 'pavimento' || type.id === 'cucina' ? DIR_TOP : DIR_DEFAULT);
  }

  _renderPreset(preset, canvas) {
    this._setup();
    const box = new THREE.Box3();
    for (const it of preset.items()) {
      const type = TYPE_BY_ID.get(it.type);
      if (!type) continue;
      const g = new THREE.Group();
      if (type.model) {
        // realistic pieces: a soft stand-in block of their size
        const [w, h, d] = type.size || [0.3, 0.3, 0.3];
        const geo = new THREE.BoxGeometry(w, h, d); geo.translate(0, h / 2, 0);
        g.add(new THREE.Mesh(geo, this._material({ color: '#a7a198', roughness: 0.8 })));
      } else {
        const params = cleanParams(type, { ...defaultParams(type), ...(it.params || {}) });
        this._addType(type, params, it.color || type.color, g);
      }
      g.rotation.y = ((it.yaw || 0) * Math.PI) / 180;
      g.updateMatrixWorld(true);
      box.setFromObject(g);
      const ax = it.ax || 0, az = it.az || 0;
      const fx = ax < 0 ? box.min.x : ax > 0 ? box.max.x : (box.min.x + box.max.x) / 2;
      const fz = az < 0 ? box.min.z : az > 0 ? box.max.z : (box.min.z + box.max.z) / 2;
      const [x, y, z] = it.pos || [0, 0, 0];
      g.position.set(x - fx, y, z - fz);
      this.content.add(g);
    }
    this.content.rotation.set(0, 0.5, 0);
    this._shoot(canvas, new THREE.Vector3(0, 1.25, 1).normalize(), 0.92);
  }

  _shoot(canvas, dir, fill = 1.02) {
    this.content.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.content);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const cam = this.camera;
    const dist = (sphere.radius / Math.sin((cam.fov * Math.PI) / 360)) * fill;
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

    // flip vertically and un-premultiply the MSAA-resolved edges
    const src = this.pixels, dst = this.image.data;
    for (let y = 0; y < SIZE; y++) {
      const sy = (SIZE - 1 - y) * SIZE * 4, dy = y * SIZE * 4;
      for (let x = 0; x < SIZE * 4; x += 4) {
        const a = src[sy + x + 3];
        const k = a > 0 && a < 255 ? 255 / a : 1;
        dst[dy + x] = Math.min(255, src[sy + x] * k);
        dst[dy + x + 1] = Math.min(255, src[sy + x + 1] * k);
        dst[dy + x + 2] = Math.min(255, src[sy + x + 2] * k);
        dst[dy + x + 3] = a;
      }
    }
    canvas.getContext('2d').putImageData(this.image, 0, 0);
    canvas.classList.add('ready');

    this.content.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.content.clear();
  }

  _dispose() {
    if (!this.scene) return;
    this.target.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
    this.scene = null;
    this.target = null;
  }
}
