// Body-type thumbnails rendered on the CPU (no WebGL, no extra scene): the
// rest shape of a preset is evaluated with HumanModel.evaluateShape and drawn
// by a tiny z-buffered, Gouraud-shaded triangle rasterizer (2x2 supersampled)
// into a 2D canvas. Results are cached as data URLs; work is queued on idle
// time so opening a panel never stalls a frame.
//
//   const thumbs = new BodyThumbs(model);
//   thumbs.get('f_curvy', {w: 96, h: 136, region: 'full'|'bust', color}) -> Promise<dataURL>
//   thumbs.peek(id, opts) -> dataURL | null (synchronous cache lookup)

const SS = 2; // supersampling factor per axis
const CLAY = '#c9bdb1';

function norm3(x, y, z) { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }
const KEY = norm3(-0.45, 0.55, 0.72); // key light (view space): upper left, in front
const FILL = norm3(0.75, 0.05, 0.45); // soft fill from the right

function hexRGB(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const v = m ? parseInt(m[1], 16) : 0xc9bdb1;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 120 }) : setTimeout(fn, 16));

export class BodyThumbs {
  constructor(model) {
    this.model = model;
    this._urls = new Map();
    this._pending = new Map();
    this._queue = [];
    this._running = false;
    this._tris = null;
    this._shape = null; // last evaluated shape {id, pos, nrm, ...}
    this._bounds = new Map(); // `${yaw}` -> {h, w} max extents over all presets
  }

  _key(id, o) { return `${id}|${o.region || 'full'}|${o.w}x${o.h}|${o.color || CLAY}|${o.yaw ?? ''}|${o.dpr}`; }

  _opts(o = {}) {
    const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
    return { w: 96, h: 136, region: 'full', color: CLAY, ...o, dpr: o.dpr || dpr };
  }

  peek(id, opts) { return this._urls.get(this._key(id, this._opts(opts))) || null; }

  get(id, opts) {
    const o = this._opts(opts);
    const key = this._key(id, o);
    const hit = this._urls.get(key);
    if (hit) return Promise.resolve(hit);
    let p = this._pending.get(key);
    if (p) return p;
    p = new Promise((resolve) => { this._queue.push({ id, o, key, resolve }); });
    this._pending.set(key, p);
    this._pump();
    return p;
  }

  _pump() {
    if (this._running || !this._queue.length) return;
    this._running = true;
    idle(() => {
      const job = this._queue.shift();
      let url = null;
      try { url = this._render(job.id, job.o); } catch (e) { console.warn('[PosaViva] thumbnail failed', e); }
      if (url) this._urls.set(job.key, url);
      this._pending.delete(job.key);
      job.resolve(url);
      this._running = false;
      if (this._queue.length) this._pump();
      else this._shape = null; // release the shape buffers when idle
    });
  }

  // ---------------------------------------------------------------- geometry
  _triangles() {
    if (this._tris) return this._tris;
    const m = this.model, fv = m.faceV, out = [];
    for (const f of m.groupFaces[0]) {
      const a = fv[f * 4], b = fv[f * 4 + 1], c = fv[f * 4 + 2], d = fv[f * 4 + 3];
      out.push(a, b, c);
      if (d !== 0xffff) out.push(a, c, d);
    }
    return (this._tris = Uint32Array.from(out));
  }

  /** Rest positions + outward vertex normals of a preset (body group only). */
  _evalShape(id) {
    if (this._shape?.id === id) return this._shape;
    const m = this.model, NV = m.vertexCount;
    const pos = m.evaluateShape(id, {}, new Float32Array(NV * 3));
    const nrm = new Float32Array(NV * 3);
    const T = this._triangles();
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // area weighted
      nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
      nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
      nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
    }
    const verts = m.groupVertices[0];
    let cx = 0, cy = 0, cz = 0, minY = Infinity, maxY = -Infinity;
    for (const v of verts) { const k = v * 3; cx += pos[k]; cy += pos[k + 1]; cz += pos[k + 2]; if (pos[k + 1] < minY) minY = pos[k + 1]; if (pos[k + 1] > maxY) maxY = pos[k + 1]; }
    cx /= verts.length; cy /= verts.length; cz /= verts.length;
    // winding is not guaranteed: flip so normals point away from the centroid
    let dot = 0;
    for (const v of verts) { const k = v * 3; dot += (pos[k] - cx) * nrm[k] + (pos[k + 1] - cy) * nrm[k + 1] + (pos[k + 2] - cz) * nrm[k + 2]; }
    const sign = dot < 0 ? -1 : 1;
    for (const v of verts) {
      const k = v * 3, l = sign / (Math.hypot(nrm[k], nrm[k + 1], nrm[k + 2]) || 1);
      nrm[k] *= l; nrm[k + 1] *= l; nrm[k + 2] *= l;
    }
    return (this._shape = { id, pos, nrm, minY, maxY, verts });
  }

  /** Horizontal extent of a shape seen with a yaw rotation. */
  _extent(sh, cs, sn) {
    let minX = Infinity, maxX = -Infinity;
    const P = sh.pos;
    for (const v of sh.verts) { const k = v * 3, x = P[k] * cs + P[k + 2] * sn; if (x < minX) minX = x; if (x > maxX) maxX = x; }
    return { minX, maxX };
  }

  /** Largest height / width over all presets so every full-body thumbnail shares one scale. */
  _globalBounds(yaw) {
    const k = yaw.toFixed(3);
    let b = this._bounds.get(k);
    if (b) return b;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    b = { h: 0, w: 0 };
    const keep = this._shape;
    for (const p of this.model.presets) {
      const m = this.model, P = m.evaluateShape(p.id, {}, new Float32Array(m.vertexCount * 3));
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const v of m.groupVertices[0]) {
        const i = v * 3, x = P[i] * cs + P[i + 2] * sn;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (P[i + 1] < minY) minY = P[i + 1]; if (P[i + 1] > maxY) maxY = P[i + 1];
      }
      b.h = Math.max(b.h, maxY - minY); b.w = Math.max(b.w, maxX - minX);
    }
    this._shape = keep;
    this._bounds.set(k, b);
    return b;
  }

  // ---------------------------------------------------------------- rasterizer
  _render(id, o) {
    const sh = this._evalShape(id);
    const bust = o.region === 'bust';
    const yaw = o.yaw ?? (bust ? 0.22 : 0.3);
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const ow = Math.round(o.w * o.dpr), oh = Math.round(o.h * o.dpr);
    const W = ow * SS, H = oh * SS;
    const P = sh.pos, N = sh.nrm, NV = this.model.vertexCount;
    const height = sh.maxY - sh.minY;

    // view transform: screen = ((x' - cx) * s + W/2, (top - y) * s + y0)
    let s, cx, top, y0;
    if (bust) {
      top = sh.maxY + height * 0.02;
      const bottom = sh.maxY - height * 0.27;
      s = H / (top - bottom);
      // center on the head
      let sum = 0, n = 0;
      for (const v of sh.verts) { const k = v * 3; if (P[k + 1] > sh.maxY - height * 0.12) { sum += P[k] * cs + P[k + 2] * sn; n++; } }
      cx = n ? sum / n : 0;
      y0 = 0;
    } else {
      const g = this._globalBounds(yaw);
      s = Math.min((H * 0.93) / g.h, (W * 0.94) / g.w);
      const e = this._extent(sh, cs, sn);
      cx = (e.minX + e.maxX) / 2;
      top = sh.maxY;
      y0 = H * 0.965 - height * s; // feet on a common baseline
    }

    // project vertices + per-vertex lighting
    const SX = new Float32Array(NV), SY = new Float32Array(NV), SZ = new Float32Array(NV), SI = new Float32Array(NV);
    for (const v of sh.verts) {
      const k = v * 3;
      const x = P[k] * cs + P[k + 2] * sn, z = -P[k] * sn + P[k + 2] * cs;
      SX[v] = (x - cx) * s + W / 2;
      SY[v] = (top - P[k + 1]) * s + y0;
      SZ[v] = z;
      const nx = N[k] * cs + N[k + 2] * sn, ny = N[k + 1], nz = -N[k] * sn + N[k + 2] * cs;
      const d1 = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]);
      const d2 = Math.max(0, nx * FILL[0] + ny * FILL[1] + nz * FILL[2]);
      const rim = Math.pow(1 - Math.max(0, nz), 3);
      SI[v] = 0.26 + 0.74 * d1 + 0.16 * d2 + 0.3 * rim + 0.18 * Math.pow(d1, 24);
    }

    const depth = new Float32Array(W * H).fill(-Infinity);
    const shade = new Float32Array(W * H);
    const T = this._triangles();
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t], b = T[t + 1], c = T[t + 2];
      const ax = SX[a], ay = SY[a], bx = SX[b], by = SY[b], qx = SX[c], qy = SY[c];
      const area = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
      if (area === 0) continue;
      let x0 = Math.floor(Math.min(ax, bx, qx)), x1 = Math.ceil(Math.max(ax, bx, qx));
      let ya = Math.floor(Math.min(ay, by, qy)), yb = Math.ceil(Math.max(ay, by, qy));
      if (x1 < 0 || ya >= H || x0 >= W || yb < 0) continue;
      if (x0 < 0) x0 = 0; if (ya < 0) ya = 0; if (x1 > W - 1) x1 = W - 1; if (yb > H - 1) yb = H - 1;
      const inv = 1 / area;
      const az = SZ[a], bz = SZ[b], cz = SZ[c], ai = SI[a], bi = SI[b], ci = SI[c];
      for (let y = ya; y <= yb; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const w0 = ((bx - px) * (qy - py) - (by - py) * (qx - px)) * inv;
          if (w0 < -1e-5) continue;
          const w1 = ((qx - px) * (ay - py) - (qy - py) * (ax - px)) * inv;
          if (w1 < -1e-5) continue;
          const w2 = 1 - w0 - w1;
          if (w2 < -1e-5) continue;
          const z = w0 * az + w1 * bz + w2 * cz, i = y * W + x;
          if (z <= depth[i]) continue;
          depth[i] = z;
          shade[i] = w0 * ai + w1 * bi + w2 * ci;
        }
      }
    }

    // resolve the supersampled buffer
    const [r0, g0, b0] = hexRGB(o.color);
    const canvas = document.createElement('canvas');
    canvas.width = ow; canvas.height = oh;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(ow, oh), D = img.data;
    const n = SS * SS;
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        let cov = 0, sum = 0;
        for (let j = 0; j < SS; j++) {
          const row = (y * SS + j) * W + x * SS;
          for (let i = 0; i < SS; i++) { if (depth[row + i] !== -Infinity) { cov++; sum += shade[row + i]; } }
        }
        if (!cov) continue;
        const l = sum / cov, hi = l > 1 ? (l - 1) * 160 : 0;
        const o4 = (y * ow + x) * 4;
        D[o4] = Math.min(255, r0 * l + hi); D[o4 + 1] = Math.min(255, g0 * l + hi); D[o4 + 2] = Math.min(255, b0 * l + hi);
        D[o4 + 3] = Math.round((cov / n) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }
}
