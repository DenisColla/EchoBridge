// Catalog thumbnails of the Esterni tool: each procedural type (and each kit) is
// rendered once with its real material colors and textures (fixed look,
// independent of the render style), lazily when its card scrolls into view, one
// per animation frame, then cached in localStorage (small WebP) so later sessions
// show them instantly. Realistic models use their shipped image.
import * as THREE from 'three';
import { ROLES, defaultParams, cleanParams, TYPE_BY_ID } from '../props/catalog.js';
import { mergeParts } from '../props/geo.js';

const SIZE = 120;
const KEY = 'posaviva.city.thumbs.v4';
let store = null;
const load = () => { if (store) return store; try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { store = {}; } return store; };
let saveTimer = 0;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* quota: keep in memory */ } }, 900); };

/** Camera direction per kind of item: [elevation (rad), yaw of the item (rad), fill]. */
function viewOf(type) {
  if (type.kit) return [0.75, 0.6, 0.78];
  if (type.road) return [0.95, 0.35, 0.86];
  if (type.vehicle) return [0.28, 0.65, 1.0];
  if (type.sub === 'alberi') return [0.12, 0.3, 1.05];
  if (type.id === 'es_prato' || type.id === 'es_collina' || type.id === 'es_duna' || type.id === 'es_laghetto' || type.id === 'es_aiuola') return [0.6, 0.5, 0.9];
  return [0.3, 0.55, 1.0];
}

export class CityThumbs {
  constructor(app) { this.app = app; this.queue = []; this.els = new Map(); this._raf = 0; this.scene = null; }

  /** <img> element for a type or a kit ({kit: true, id, items}); filled when rendered. */
  imageFor(type) {
    const key = type.id;
    const img = document.createElement('img');
    img.className = 'pv-ct-thumb';
    img.alt = '';
    img.draggable = false;
    if (type.thumb) { img.src = type.thumb; img.classList.add('ready'); return img; }
    const cached = load()[key];
    if (cached) { img.src = cached; img.classList.add('ready'); return img; }
    img._ctJob = type;
    return img;
  }

  /** Starts rendering a thumbnail element (lazy). */
  request(img) {
    const job = img?._ctJob;
    if (!job || img._ctQueued) return;
    img._ctQueued = true;
    const done = this.els.get(job.id);
    if (done) { img.src = done; img.classList.add('ready'); return; }
    this.queue.push(img);
    this._schedule();
  }

  _schedule() {
    if (this._raf || !this.queue.length) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const img = this.queue.shift();
      const job = img._ctJob;
      try {
        let url = this.els.get(job.id);
        if (!url) { url = this._render(job); this.els.set(job.id, url); load()[job.id] = url; save(); }
        img.src = url; img.classList.add('ready');
      } catch (e) { console.warn('[city] thumbnail failed', job.id, e); }
      if (this.queue.length) setTimeout(() => this._schedule(), 16); else this._dispose();
    });
  }

  _setup() {
    if (this.scene) return;
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight('#e6eeff', '#5f5a52', 1.7));
    const key = new THREE.DirectionalLight('#fff3e0', 2.4); key.position.set(3, 5, 4); s.add(key);
    const rim = new THREE.DirectionalLight('#cfe0ff', 0.7); rim.position.set(-3, 2, -3); s.add(rim);
    this.scene = s;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 2000);
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    this.pixels = new Uint8Array(SIZE * SIZE * 4);
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx.createImageData(SIZE, SIZE);
    this.content = new THREE.Group(); s.add(this.content);
    this.mats = new Map();
  }

  _material(spec) {
    const key = JSON.stringify(spec, (k, v) => (v && v.isTexture ? v.uuid : v));
    let m = this.mats.get(key);
    if (m) return m;
    const col = new THREE.Color(spec.color ?? '#cccccc');
    m = new THREE.MeshStandardMaterial({
      color: col, map: spec.map || null, normalMap: spec.normalMap || null, roughness: spec.roughness ?? 0.7,
      metalness: Math.min(0.4, spec.metalness ?? 0), vertexColors: !!spec.vertexColors,
      side: spec.side === 'double' ? THREE.DoubleSide : THREE.FrontSide, transparent: !!spec.transparent, opacity: spec.transparent ? Math.max(0.35, spec.opacity ?? 1) : 1,
      alphaTest: spec.alphaTest || 0,
    });
    this.mats.set(key, m);
    return m;
  }

  _addType(type, params, color, parent) {
    if (type.model) {
      const [w, h, d] = type.size || [0.5, 0.5, 0.5];
      const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0);
      parent.add(new THREE.Mesh(g, this._material({ color: '#a39d93', roughness: 0.9 })));
      return;
    }
    const parts = type.build(params);
    const specs = parts.$specs || {};
    for (const [role, list] of Object.entries(parts)) {
      if (role === '$specs') continue;
      const geo = mergeParts(list);
      if (!geo) continue;
      const sp = specs[role] ? (typeof specs[role] === 'function' ? specs[role](color) : specs[role]) : (ROLES[role] || ROLES.main)(color);
      parent.add(new THREE.Mesh(geo, this._material(sp)));
    }
  }

  _render(job) {
    this._setup();
    const [el, yaw, fill] = viewOf(job);
    if (job.kit) {
      for (const it of job.items()) {
        const type = TYPE_BY_ID.get(it.type);
        if (!type) continue;
        const g = new THREE.Group();
        this._addType(type, cleanParams(type, { ...defaultParams(type), ...(it.params || {}) }), it.color || type.color, g);
        g.position.set(it.pos[0], 0, it.pos[1]);
        g.rotation.y = it.yaw || 0;
        this.content.add(g);
      }
    } else this._addType(job, defaultParams(job), job.color, this.content);
    this.content.rotation.set(0, yaw, 0);
    this.content.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.content);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const cam = this.camera;
    const dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
    const dist = (sphere.radius / Math.sin((cam.fov * Math.PI) / 360)) * fill;
    cam.position.copy(sphere.center).addScaledVector(dir, dist);
    cam.near = Math.max(0.01, dist / 50); cam.far = dist * 4;
    cam.lookAt(sphere.center);
    cam.updateProjectionMatrix();
    const r = this.app.renderer;
    const prevTarget = r.getRenderTarget(), prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const prevShadow = r.shadowMap.autoUpdate, prevTone = r.toneMapping, prevExp = r.toneMappingExposure;
    r.shadowMap.autoUpdate = false;
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1;
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(this.scene, cam);
    r.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.pixels);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    r.shadowMap.autoUpdate = prevShadow; r.toneMapping = prevTone; r.toneMappingExposure = prevExp;
    const src = this.pixels, dst = this.image.data;
    for (let y = 0; y < SIZE; y++) {
      const sy = (SIZE - 1 - y) * SIZE * 4, dy = y * SIZE * 4;
      for (let x = 0; x < SIZE * 4; x += 4) {
        const a = src[sy + x + 3], k = a > 0 && a < 255 ? 255 / a : 1;
        dst[dy + x] = Math.min(255, src[sy + x] * k); dst[dy + x + 1] = Math.min(255, src[sy + x + 1] * k); dst[dy + x + 2] = Math.min(255, src[sy + x + 2] * k); dst[dy + x + 3] = a;
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.content.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.content.clear();
    this.content.rotation.set(0, 0, 0);
    let url = this.canvas.toDataURL('image/webp', 0.82);
    if (!url.startsWith('data:image/webp')) url = this.canvas.toDataURL('image/png');
    return url;
  }

  _dispose() {
    if (!this.scene) return;
    this.target.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
    this.scene = null; this.target = null;
  }
}
