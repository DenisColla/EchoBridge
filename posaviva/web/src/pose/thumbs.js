// Lazy thumbnails of pose / hand presets: a private clay mannequin rendered
// with app.renderer into a small sRGB render target (between frames, one per
// call), read back and stored as data URLs in memory + localStorage.
import * as THREE from 'three';
import { Character } from '../core/Character.js';
import { materials } from '../render/materials.js';
import { applyPosePreset, applyHandPreset } from './library.js';

const STORE_KEY = 'posaviva.pose.thumbs.v3'; // v3: reworked presets (lines of action)
const OLD_KEYS = ['posaviva.pose.thumbs.v1', 'posaviva.pose.thumbs.v2'];
const D = Math.PI / 180;
// thumbnail arm pose (raw bone Euler degrees 'ZXY', left side, as the 'wave' preset):
// hand raised beside the head, palm to the front, fingers up — hand signs read at a glance
const HAND_ARM = [['upperarm01.L', -5, -34, -49], ['upperarm02.L', 0, -28, 0], ['lowerarm01.L', -35, -1, 0], ['lowerarm02.L', 0, -1, 0], ['wrist.L', 11, 0, -30]];
// seen from the front, a little from the thumb side and from below the hand
const HAND_VIEW = new THREE.Vector3(-0.3, -0.05, 1);
// 48 poses x 2 sexes + 22 hands x 2 sexes, with some margin
const MAX_ENTRIES = 180;

let _shared = null;
/** One renderer per app (private mannequins + render target are shared by the panels). */
export function getThumbRenderer(app) { return (_shared ||= new ThumbRenderer(app)); }

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export class ThumbRenderer {
  constructor(app) {
    this.app = app;
    this.W = 150; this.H = 200; // output size: cards are ~120 CSS px wide, shown on ~3x screens
    this.SS = 2; // supersampling
    this.rt = new THREE.WebGLRenderTarget(this.W * this.SS, this.H * this.SS, { depthBuffer: true });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace; // GPU encodes to sRGB on write
    this.buf = new Uint8Array(this.W * this.SS * this.H * this.SS * 4);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight('#f4f6ff', '#4a4540', 1.25));
    const key = new THREE.DirectionalLight('#fff5ea', 2.6);
    key.position.set(-1.5, 3, 3);
    const rim = new THREE.DirectionalLight('#dfe8ff', 1.4);
    rim.position.set(2, 2.5, -3);
    this.scene.add(key, rim);
    this.camera = new THREE.PerspectiveCamera(20, this.W / this.H, 0.1, 50);
    this.material = new THREE.MeshStandardMaterial({ color: '#c4bbb0', roughness: 0.82, metalness: 0 });
    this.material.name = 'pv:pose-thumb-clay';
    this.hidden = new THREE.MeshStandardMaterial({ color: '#8d857c', roughness: 0.9 }); // lashes / mouth of the mannequin
    this.chars = {};
    this.mem = new Map();
    this.store = {};
    try { this.store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { this.store = {}; }
    try { for (const k of OLD_KEYS) localStorage.removeItem(k); } catch { /* private mode */ }
    this._dirty = false;
    this._canvas = document.createElement('canvas');
    this._canvas.width = this.W * this.SS; this._canvas.height = this.H * this.SS;
    this._out = document.createElement('canvas');
    this._out.width = this.W; this._out.height = this.H;
  }

  _char(sex) {
    if (this.chars[sex]) return this.chars[sex];
    const ch = new Character(this.app.model, { preset: sex === 'M' ? 'm_normal' : 'f_normal' });
    // private mannequin: neutral clay look independent of the render style
    materials.release(ch.body); materials.release(ch.eyeMesh);
    ch.body.material = [this.material, this.hidden, this.hidden, this.hidden]; // lashes / teeth / tongue toggled for hand shots
    ch.eyeMesh.material = this.material;
    ch.body.castShadow = false; ch.body.receiveShadow = false;
    this.scene.add(ch.root);
    ch.root.visible = false;
    this.chars[sex] = ch;
    return ch;
  }

  key(kind, preset, sex) { return `${kind}|${sex}|${preset.id}|${hash(JSON.stringify(preset.pose || preset.bones))}`; }

  cached(preset, sex, kind = 'pose') {
    const k = this.key(kind, preset, sex);
    return this.mem.get(k) || this.store[k] || null;
  }

  /** Renders a full-body pose preset; returns a data URL. */
  render(preset, sex) {
    const k = this.key('pose', preset, sex);
    const hit = this.mem.get(k) || this.store[k];
    if (hit) return hit;
    const ch = this._char(sex);
    ch.resetPose();
    applyPosePreset(ch, preset.id);
    const url = this._shoot(ch, null);
    this._remember(k, url);
    return url;
  }

  /** Renders a hand preset on the left hand (close-up); returns a data URL. */
  renderHand(preset, sex = 'F', viewDir = HAND_VIEW) {
    const k = this.key('hand', preset, sex);
    const hit = this.mem.get(k) || this.store[k];
    if (hit) return hit;
    const ch = this._char(sex);
    ch.resetPose();
    // left arm reaching forward so the hand is isolated against the background
    for (const [b, x, y, z] of HAND_ARM) ch.poseQuat[this.app.model.boneIndex.get(b)].setFromEuler(new THREE.Euler(x * D, y * D, z * D, 'ZXY'));
    applyHandPreset(ch, preset.id, 'L');
    const { verts, hidden } = this._handMask();
    // only the hand is drawn (any view angle stays clean)
    ch.setHiddenBodyFaces(hidden);
    this.hidden.visible = false;
    let url;
    try { url = this._shoot(ch, verts, viewDir.clone()); }
    finally { ch.setHiddenBodyFaces(null); this.hidden.visible = true; }
    this._remember(k, url);
    return url;
  }

  /** left-hand vertices (framing) + face mask hiding everything else (built once) */
  _handMask() {
    if (this._hand) return this._hand;
    const m = this.app.model;
    const hand = new Set(), arm = new Set();
    m.bones.forEach((b, i) => {
      if (!b.name.endsWith('.L')) return;
      if (b.name.startsWith('finger') || b.name.startsWith('metacarpal') || b.name.startsWith('wrist')) hand.add(i);
      else if (b.name.startsWith('lowerarm')) arm.add(i);
    });
    const wv = new Float32Array(m.vertexCount);
    const verts = [];
    for (const v of m.groupVertices[0]) {
      let s = 0, a = 0;
      for (let q = 0; q < 4; q++) {
        const b = m.skinIndex[v * 4 + q], w = m.skinWeight[v * 4 + q];
        if (hand.has(b)) s += w; else if (arm.has(b)) a += w;
      }
      // the forearm is drawn too (it leaves the frame: no ragged cut at the wrist), framing uses the hand only
      wv[v] = s + a;
      if (s > 0.5) verts.push(v);
    }
    const hidden = new Uint8Array(m.faceCount).fill(1);
    for (const f of m.groupFaces[0]) {
      let mx = 0;
      for (let q = 0; q < 4; q++) { const v = m.faceV[f * 4 + q]; if (v !== 0xffff) mx = Math.max(mx, wv[v]); }
      if (mx > 0.2) hidden[f] = 0;
    }
    return (this._hand = { verts, hidden });
  }

  _remember(k, url) {
    this.mem.set(k, url);
    this.store[k] = url;
    this._dirty = true;
  }

  _shoot(ch, subset, viewDir = new THREE.Vector3(0.42, 0.14, 0.9)) {
    const app = this.app, r = app.renderer;
    ch.root.visible = true;
    ch.root.updateMatrixWorld(true);
    // frame the skinned vertices (subsampled) from a 3/4 view, nearly orthographic
    const P = ch.getSkinnedPositions();
    const list = subset || app.model.groupVertices[0];
    const step = subset ? 1 : 5;
    const dir = viewDir.clone().normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const c0 = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < list.length; i += step) { const v = list[i] * 3; c0.x += P[v]; c0.y += P[v + 1]; c0.z += P[v + 2]; n++; }
    c0.multiplyScalar(1 / Math.max(1, n));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const t = new THREE.Vector3();
    for (let i = 0; i < list.length; i += step) {
      const v = list[i] * 3;
      t.set(P[v] - c0.x, P[v + 1] - c0.y, P[v + 2] - c0.z);
      const x = t.dot(right), y = t.dot(up);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const center = c0.clone().addScaledVector(right, (x0 + x1) / 2).addScaledVector(up, (y0 + y1) / 2);
    const aspect = this.W / this.H;
    const halfH = Math.max((y1 - y0) / 2, (x1 - x0) / 2 / aspect) * 1.1 + 0.01;
    const dist = subset ? 2 : 8;
    const cam = this.camera;
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfH / dist));
    cam.aspect = aspect;
    cam.near = dist * 0.5; cam.far = dist * 1.6;
    cam.position.copy(center).addScaledVector(dir, dist);
    cam.up.copy(up);
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // render into the private target, restoring the renderer state afterwards
    const prevRT = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const prevAuto = r.autoClear;
    const W = this.W * this.SS, H = this.H * this.SS;
    try {
      r.setRenderTarget(this.rt);
      r.setClearColor(0x000000, 0);
      r.autoClear = true;
      r.clear(true, true, true);
      r.render(this.scene, cam);
      r.readRenderTargetPixels(this.rt, 0, 0, W, H, this.buf);
    } finally {
      r.setRenderTarget(prevRT);
      r.setClearColor(prevColor, prevAlpha);
      r.autoClear = prevAuto;
      ch.root.visible = false;
      app.invalidate();
    }
    // flip Y into the canvas, then downsample
    const g = this._canvas.getContext('2d');
    const img = g.createImageData(W, H);
    const row = W * 4;
    for (let y = 0; y < H; y++) img.data.set(this.buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    g.putImageData(img, 0, 0);
    const o = this._out.getContext('2d');
    o.clearRect(0, 0, this.W, this.H);
    o.imageSmoothingQuality = 'high';
    o.drawImage(this._canvas, 0, 0, this.W, this.H);
    let url = this._out.toDataURL('image/webp', 0.85);
    if (!url.startsWith('data:image/webp')) url = this._out.toDataURL('image/png');
    return url;
  }

  /** Writes the cache to localStorage (bounded). */
  persist() {
    if (!this._dirty) return;
    this._dirty = false;
    const keys = Object.keys(this.store);
    if (keys.length > MAX_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete this.store[k];
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.store)); }
    catch {
      // quota: keep only what this session rendered
      this.store = Object.fromEntries(this.mem);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.store)); } catch { /* give up, memory cache still works */ }
    }
  }
}
