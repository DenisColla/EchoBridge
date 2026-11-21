// "Light globe": a shaded sphere seen from the current camera. Each light is
// a dot on the sphere (hollow when it is behind the subject); dragging moves
// the selected light around the subject. The same software shader renders the
// preset thumbnails.
import * as THREE from 'three';
import { dirFromAzEl, azElFromDir } from './lights.js';
import { kelvinToSRGB } from './color.js';

const DEG = Math.PI / 180;
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
// ACES filmic fit (Narkowicz), same family as the renderer's tone mapping
const aces = (x) => Math.max(0, Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));

const _c = { r: 1, g: 1, b: 1 };
const _col = new THREE.Color();
/** linear RGB of a light (custom color or kelvin) into out[0..2] */
export function lightLinearRGB(d, out) {
  if (d.color) { _col.set(d.color); out[0] = _col.r; out[1] = _col.g; out[2] = _col.b; return out; }
  kelvinToSRGB(d.kelvin ?? 6500, _c);
  out[0] = srgbToLinear(_c.r); out[1] = srgbToLinear(_c.g); out[2] = srgbToLinear(_c.b);
  return out;
}

/**
 * Software-shaded sphere into an ImageData (N×N).
 * lights: [{x,y,z (unit, camera space, toward light), rgb:[...] (linear × intensity)}]
 * amb: {sky:[], ground:[], up:[x,y,z] (world up in camera space)}
 */
export function shadeSphere(img, lights, amb, albedo = 0.72) {
  const N = img.width, data = img.data, R = N / 2 - 1;
  const invPi = 1 / Math.PI, k = albedo * invPi;
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const o = (py * N + px) * 4;
      const nx = (px + 0.5 - N / 2) / R, ny = -(py + 0.5 - N / 2) / R;
      const rr = nx * nx + ny * ny;
      if (rr > 1.04) { data[o + 3] = 0; continue; }
      const nz = Math.sqrt(Math.max(0, 1 - rr));
      // hemisphere ambient
      const hu = 0.5 + 0.5 * (nx * amb.up[0] + ny * amb.up[1] + nz * amb.up[2]);
      let r = (amb.ground[0] + (amb.sky[0] - amb.ground[0]) * hu) * k;
      let g = (amb.ground[1] + (amb.sky[1] - amb.ground[1]) * hu) * k;
      let b = (amb.ground[2] + (amb.sky[2] - amb.ground[2]) * hu) * k;
      for (let i = 0; i < lights.length; i++) {
        const L = lights[i];
        const ndl = nx * L.x + ny * L.y + nz * L.z;
        if (ndl <= 0) continue;
        // Lambert + a soft Blinn highlight (view = +Z)
        const hx = L.x, hy = L.y, hz = L.z + 1, hl = Math.hypot(hx, hy, hz) || 1;
        const ndh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
        const spec = Math.pow(ndh, 48) * 0.18;
        const f = ndl * k + spec * ndl;
        r += L.rgb[0] * f; g += L.rgb[1] * f; b += L.rgb[2] * f;
      }
      data[o] = 255 * linearToSrgb(aces(r));
      data[o + 1] = 255 * linearToSrgb(aces(g));
      data[o + 2] = 255 * linearToSrgb(aces(b));
      // anti-aliased rim
      data[o + 3] = 255 * Math.max(0, Math.min(1, (1 - Math.sqrt(rr)) * R + 0.5));
    }
  }
  return img;
}

function ambientRGB(a, out = { sky: [0, 0, 0], ground: [0, 0, 0], up: [0, 1, 0] }) {
  const I = a.intensity ?? 0.8;
  lightLinearRGB({ color: a.color, kelvin: a.kelvin ?? 7500 }, out.sky);
  if (a.ground) { _col.set(a.ground); out.ground[0] = _col.r; out.ground[1] = _col.g; out.ground[2] = _col.b; }
  else { out.ground[0] = out.sky[0] * 0.18 + 0.05; out.ground[1] = out.sky[1] * 0.18 + 0.04; out.ground[2] = out.sky[2] * 0.18 + 0.035; }
  for (let i = 0; i < 3; i++) { out.sky[i] *= I; out.ground[i] *= I; }
  return out;
}

/** Thumbnail canvas for a preset (canonical camera looking at the subject from the front). */
export function presetThumb(preset, size = 64) {
  const N = 64;
  const img = new ImageData(N, N);
  const lights = preset.lights.filter((l) => l.on !== false).map((l) => {
    const d = dirFromAzEl((l.relAz || 0) * DEG, (l.el ?? 30) * DEG);
    const rgb = lightLinearRGB(l, [0, 0, 0]).map((v) => v * (l.intensity ?? 2));
    return { x: d.x, y: d.y, z: d.z, rgb };
  });
  shadeSphere(img, lights, ambientRGB(preset.ambient || {}));
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = N;
  tmp.getContext('2d').putImageData(img, 0, 0);
  const c = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  c.width = c.height = Math.round(size * dpr);
  c.style.width = c.style.height = size + 'px';
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(tmp, 0, 0, c.width, c.height);
  return c;
}

const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _v = new THREE.Vector3();

/**
 * Interactive globe. opts: {size, onPick(id), onDrag(id, {az, el}, phase:'move'|'end')}
 * Call render(rig, camera) whenever lights or the camera change.
 */
export class LightGlobe {
  constructor(opts = {}) {
    this.opts = opts;
    this.size = opts.size || 150;
    this.N = 112; // internal shading resolution
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pv-sc-globe';
    this.canvas.style.width = this.canvas.style.height = this.size + 'px';
    this.ctx = this.canvas.getContext('2d');
    this._img = new ImageData(this.N, this.N);
    this._tmp = document.createElement('canvas');
    this._tmp.width = this._tmp.height = this.N;
    this._tctx = this._tmp.getContext('2d');
    this._lights = [];
    this._dots = [];
    this._pool = [];
    this._amb = { sky: [0, 0, 0], ground: [0, 0, 0], up: [0, 1, 0] };
    this._geom = { C: 0, R: 1, dpr: 1 };
    this.back = false; // hemisphere used while dragging
    this._setupInput();
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const px = Math.round(this.size * dpr);
    if (this.canvas.width !== px) { this.canvas.width = this.canvas.height = px; }
    return dpr;
  }

  /** Pooled per-light records (the globe redraws on every camera change). */
  _record(i) {
    let r = this._pool[i];
    if (!r) r = this._pool[i] = { id: '', x: 0, y: 0, z: 1, on: true, sel: false, rgb: [1, 1, 1], css: '', L: { x: 0, y: 0, z: 1, rgb: [1, 1, 1] } };
    return r;
  }

  render(rig, camera) {
    this.rig = rig; this.camera = camera;
    const dpr = this._resize();
    const S = this.canvas.width, g = this.ctx;
    camera.getWorldQuaternion(_q);
    _qi.copy(_q).invert();
    // lights in camera space
    const lights = this._lights; lights.length = 0;
    const dots = this._dots; dots.length = 0;
    const sel = rig.selected;
    const list = rig.lights;
    for (let i = 0; i < list.length; i++) {
      const d = list[i], r = this._record(i);
      dirFromAzEl(d.az, d.el, _v).applyQuaternion(_qi);
      r.id = d.id; r.x = _v.x; r.y = _v.y; r.z = _v.z; r.on = d.on; r.sel = !!sel && sel.id === d.id;
      lightLinearRGB(d, r.rgb);
      r.css = `rgb(${Math.round(255 * linearToSrgb(Math.min(1, r.rgb[0])))},${Math.round(255 * linearToSrgb(Math.min(1, r.rgb[1])))},${Math.round(255 * linearToSrgb(Math.min(1, r.rgb[2])))})`;
      dots.push(r);
      if (!d.on) continue;
      const L = r.L;
      L.x = _v.x; L.y = _v.y; L.z = _v.z;
      L.rgb[0] = r.rgb[0] * d.intensity; L.rgb[1] = r.rgb[1] * d.intensity; L.rgb[2] = r.rgb[2] * d.intensity;
      lights.push(L);
    }
    _v.set(0, 1, 0).applyQuaternion(_qi);
    const amb = ambientRGB(rig.state.ambient, this._amb);
    amb.up[0] = _v.x; amb.up[1] = _v.y; amb.up[2] = _v.z;
    shadeSphere(this._img, lights, amb);
    this._tctx.putImageData(this._img, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    const pad = 10 * dpr, R = S / 2 - pad, C = S / 2;
    // backdrop ring (the "back" hemisphere is the area outside the sphere outline)
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.beginPath(); g.arc(C, C, R + pad * 0.8, 0, Math.PI * 2); g.fill();
    g.imageSmoothingQuality = 'high';
    g.drawImage(this._tmp, C - R, C - R, 2 * R, 2 * R);
    // guides: equator & meridian of the view
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1 * dpr;
    g.beginPath(); g.ellipse(C, C, R, R * 0.28, 0, 0, Math.PI * 2); g.moveTo(C, C - R); g.lineTo(C, C + R); g.stroke();
    // dots: unselected first, the selected one on top
    for (let pass = 0; pass < 2; pass++) {
      for (const dot of dots) {
        if (dot.sel !== (pass === 1)) continue;
        this._drawDot(g, dot, C + dot.x * R, C - dot.y * R, dpr);
      }
    }
    this._geom.C = C; this._geom.R = R; this._geom.dpr = dpr;
    if (!this._dragging) for (const dot of dots) if (dot.sel) this.back = dot.z < 0;
  }

  _drawDot(g, dot, x, y, dpr) {
    const front = dot.z >= 0;
    const rad = (dot.sel ? 9 : 6) * dpr;
    g.lineWidth = 2 * dpr;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2);
    if (front) {
      // in front of the subject: solid dot in the light color
      g.fillStyle = dot.on ? dot.css : 'rgba(120,120,120,0.8)'; g.fill();
      g.strokeStyle = dot.sel ? '#ffffff' : 'rgba(0,0,0,0.7)'; g.stroke();
    } else {
      // behind the subject: hollow ring in the light color
      g.fillStyle = 'rgba(15,16,20,0.45)'; g.fill();
      g.lineWidth = 2.5 * dpr; g.strokeStyle = dot.on ? dot.css : 'rgba(120,120,120,0.8)'; g.stroke();
      g.lineWidth = 1 * dpr; g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.beginPath(); g.arc(x, y, rad + 1.6 * dpr, 0, Math.PI * 2); g.stroke();
    }
    if (dot.sel) {
      g.strokeStyle = 'rgba(124,108,255,0.9)'; g.lineWidth = 2 * dpr;
      g.beginPath(); g.arc(x, y, rad + 4 * dpr, 0, Math.PI * 2); g.stroke();
    }
  }

  _setupInput() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    const local = (e) => {
      const r = c.getBoundingClientRect(), k = c.width / r.width;
      return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
    };
    c.addEventListener('pointerdown', (e) => {
      if (!this.rig) return;
      const [x, y] = local(e);
      const { C, R, dpr } = this._geom;
      // tap on another light's dot selects it
      let hit = null, best = (16 * dpr) ** 2;
      for (const d of this._dots) {
        const dd = (C + d.x * R - x) ** 2 + (C - d.y * R - y) ** 2;
        if (dd < best) { best = dd; hit = d; }
      }
      if (hit && !hit.sel) { this.opts.onPick?.(hit.id); this._dragging = { id: hit.id, pointerId: e.pointerId, moved: false }; this.back = hit.z < 0; }
      else {
        const sel = this.rig.selected;
        if (!sel) return;
        this._dragging = { id: sel.id, pointerId: e.pointerId, moved: false };
        this._move(x, y);
      }
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      if (!this._dragging || e.pointerId !== this._dragging.pointerId) return;
      const [x, y] = local(e);
      this._move(x, y);
    });
    const end = (e) => {
      const g = this._dragging;
      if (!g || e.pointerId !== g.pointerId) return;
      this._dragging = null;
      if (g.moved) this.opts.onDrag?.(g.id, null, 'end');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  /** Converts a point on the globe into a world direction for the dragged light. */
  _move(x, y) {
    const g = this._dragging, { C, R } = this._geom;
    let u = (x - C) / R, v = -(y - C) / R;
    const l = Math.hypot(u, v);
    if (l > 1) { u /= l; v /= l; }
    const z = Math.sqrt(Math.max(0, 1 - u * u - v * v)) * (this.back ? -1 : 1);
    _v.set(u, v, z).applyQuaternion(this.camera.getWorldQuaternion(_q)).normalize();
    const ae = azElFromDir(_v, {});
    g.moved = true;
    this.opts.onDrag?.(g.id, ae, 'move');
  }
}
