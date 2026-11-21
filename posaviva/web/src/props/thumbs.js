// Generated catalog thumbnails. Each prop type is rendered once, lazily (one
// per animation frame so opening the panel never janks), with the app's
// renderer into a small sRGB render target and copied into a 2D canvas.
// Thumbnail meshes are UI imagery (not scene props), so they use private,
// fixed-look materials independent of the current render style.
import * as THREE from 'three';
import { ROLES, defaultParams } from './catalog.js';
import { mergeParts } from './geo.js';

const SIZE = 144;
/** per type thumbnail orientation (Euler XYZ, radians) where the default view is unclear */
const THUMB_ROT = {
  scudo: [-0.35, 0.5, 0],
  tazza: [0.15, 0.6, 0],
  borsa: [0.15, 0.6, 0],
  ombrello: [-0.55, 0.3, 0.3],
  telefono: [0.25, -1.25, 0.3],
};

export class ThumbRenderer {
  constructor(app) {
    this.app = app;
    this.queue = [];
    this.done = new Map(); // type id -> canvas
    this._raf = 0;
    this.scene = null;
  }

  /** Canvas for a type (blank until rendered). */
  canvasFor(type) {
    let c = this.done.get(type.id);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = SIZE;
    c.className = 'pv-pr-thumb';
    this.done.set(type.id, c);
    this.queue.push(type);
    this._schedule();
    return c;
  }

  _schedule() {
    if (this._raf || !this.queue.length) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const type = this.queue.shift();
      try { this._render(type, this.done.get(type.id)); } catch (e) { console.warn('[props] thumbnail failed', type.id, e); }
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
  }

  _render(type, canvas) {
    this._setup();
    const params = defaultParams(type);
    const parts = type.build(params);
    const mats = [];
    for (const [role, list] of Object.entries(parts)) {
      const geo = mergeParts(list);
      if (!geo) continue;
      const spec = (ROLES[role] || ROLES.main)(type.color);
      // very dark parts (phone, screen) would vanish on the dark cards: lift them a bit
      const col = new THREE.Color(spec.color);
      const lum = col.r * 0.2126 + col.g * 0.7152 + col.b * 0.0722; // linear
      if (lum < 0.05) col.lerp(new THREE.Color('#8b93a3'), 0.4);
      const mat = new THREE.MeshStandardMaterial({
        color: col, roughness: spec.roughness ?? 0.6,
        metalness: Math.min(0.35, spec.metalness ?? 0), side: spec.side === 'double' ? THREE.DoubleSide : THREE.FrontSide,
      });
      mats.push(mat);
      this.content.add(new THREE.Mesh(geo, mat));
    }
    // hand props are shown as held (grip space), scene props from a 3/4 view
    const rot = THUMB_ROT[type.id] || (type.hand ? [0.35, 0.9, -0.5] : [0, 0.55, 0]);
    this.content.rotation.set(rot[0], rot[1], rot[2]);
    this.content.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.content);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const cam = this.camera;
    const dist = (sphere.radius / Math.sin((cam.fov * Math.PI) / 360)) * 1.02;
    const dir = new THREE.Vector3(0.0, 0.42, 1).normalize();
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
