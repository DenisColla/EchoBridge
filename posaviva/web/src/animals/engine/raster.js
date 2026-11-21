// Tiny software rasterizer for build previews (node, no GPU): orthographic
// views of a baked animal, optionally posed with linear blend skinning, with
// Lambert + AO shading and the coat colours; writes PNG files (zlib only).
import zlib from 'node:zlib';
import fs from 'node:fs';
import { coatColors } from '../coatColor.js';

// ------------------------------------------------------------------ PNG
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}

// ------------------------------------------------------------------ math
function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function qrot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
export function eulerDegToQuat(e) { // XYZ intrinsic order like three's Euler 'XYZ'
  const [a, b, c] = e.map((d) => (d * Math.PI) / 360);
  const c1 = Math.cos(a), c2 = Math.cos(b), c3 = Math.cos(c), s1 = Math.sin(a), s2 = Math.sin(b), s3 = Math.sin(c);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}

/** Posed bone transforms (rotation quaternion + translation), rest frames are world aligned. */
export function poseBones(bones, pose = {}, rootOffset = [0, 0, 0]) {
  const out = [];
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    const q = pose[b.name] || [0, 0, 0, 1];
    if (b.parent < 0) { out.push({ q, t: [b.head[0] + rootOffset[0], b.head[1] + rootOffset[1], b.head[2] + rootOffset[2]] }); continue; }
    const P = out[b.parent], pb = bones[b.parent];
    const off = [b.head[0] - pb.head[0], b.head[1] - pb.head[1], b.head[2] - pb.head[2]];
    const r = qrot(P.q, off);
    out.push({ q: qmul(P.q, q), t: [P.t[0] + r[0], P.t[1] + r[1], P.t[2] + r[2]] });
  }
  return out;
}

export function skin(data, bones, posed) {
  const n = data.positions.length / 3;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 4; k++) {
      const w = data.skinWeight[v * 4 + k] / 255;
      if (!w) continue;
      const bi = data.skinIndex[v * 4 + k], B = bones[bi], T = posed[bi];
      const rel = [data.positions[v * 3] - B.head[0], data.positions[v * 3 + 1] - B.head[1], data.positions[v * 3 + 2] - B.head[2]];
      const r = qrot(T.q, rel), rn = qrot(T.q, [data.normals[v * 3], data.normals[v * 3 + 1], data.normals[v * 3 + 2]]);
      px += w * (r[0] + T.t[0]); py += w * (r[1] + T.t[1]); pz += w * (r[2] + T.t[2]);
      nx += w * rn[0]; ny += w * rn[1]; nz += w * rn[2];
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    P[v * 3] = px; P[v * 3 + 1] = py; P[v * 3 + 2] = pz; N[v * 3] = nx / l; N[v * 3 + 1] = ny / l; N[v * 3 + 2] = nz / l;
  }
  return { P, N };
}

// ------------------------------------------------------------------ raster
/**
 * views: [{yaw, pitch}] degrees (yaw 90 = from the animal's left side).
 * Returns RGBA buffer (cols x rows tiles of tw x th).
 */
export function renderViews(data, palette, { P, N, views, tw = 420, th = 320, cols = 2, extras = [], bg = [46, 49, 56], fit = null, center = null, spheres = [] }) {
  const n = data.positions.length / 3;
  const col = new Float32Array(n * 3);
  coatColors(palette, data.masks, data.extra, n, col);
  const rows = Math.ceil(views.length / cols);
  const W = tw * cols, H = th * rows;
  const img = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { img[i * 4] = bg[0]; img[i * 4 + 1] = bg[1]; img[i * 4 + 2] = bg[2]; img[i * 4 + 3] = 255; }
  const zb = new Float32Array(tw * th);
  const L = norm([0.45, 0.8, 0.55]), L2 = norm([-0.6, 0.3, -0.5]);
  // bounding box of all views (same scale)
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[v * 3 + k]); mx[k] = Math.max(mx[k], P[v * 3 + k]); }
  const c = center || [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  const rad = fit || Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
  const scale = (Math.min(tw, th) * 0.48) / rad;
  views.forEach((view, vi) => {
    const ox = (vi % cols) * tw, oy = Math.floor(vi / cols) * th;
    zb.fill(-Infinity);
    const ya = (view.yaw * Math.PI) / 180, pa = (view.pitch * Math.PI) / 180;
    // camera basis: looking from direction d toward the center
    const d = [Math.sin(ya) * Math.cos(pa), Math.sin(pa), Math.cos(ya) * Math.cos(pa)];
    const right = norm([d[2], 0, -d[0]]);
    const up = cross(d, right);
    const proj = (x, y, z) => {
      const rx = x - c[0], ry = y - c[1], rz = z - c[2];
      return [tw / 2 + (rx * right[0] + ry * right[1] + rz * right[2]) * scale, th / 2 - (rx * up[0] + ry * up[1] + rz * up[2]) * scale + (view.dy || 0), rx * d[0] + ry * d[1] + rz * d[2]];
    };
    const sp = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) { const q = proj(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); sp[v * 3] = q[0]; sp[v * 3 + 1] = q[1]; sp[v * 3 + 2] = q[2]; }
    // ground line
    const gy = proj(c[0], 0, c[2])[1];
    const shadeV = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
      const dl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]), dl2 = Math.max(0, nx * L2[0] + ny * L2[1] + nz * L2[2]);
      const amb = 0.35 + 0.15 * ny;
      const k = amb + 0.85 * dl + 0.25 * dl2;
      for (let j = 0; j < 3; j++) shadeV[v * 3 + j] = srgb(col[v * 3 + j] * k * 1.25);
    }
    const I = data.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], cc = I[t + 2];
      const x0 = sp[a * 3], y0 = sp[a * 3 + 1], x1 = sp[b * 3], y1 = sp[b * 3 + 1], x2 = sp[cc * 3], y2 = sp[cc * 3 + 1];
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (area >= 0) continue; // back face (screen y down)
      const minx = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxx = Math.min(tw - 1, Math.ceil(Math.max(x0, x1, x2)));
      const miny = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxy = Math.min(th - 1, Math.ceil(Math.max(y0, y1, y2)));
      for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5, py = y + 0.5;
        let w0 = (x1 - px) * (y2 - py) - (x2 - px) * (y1 - py);
        let w1 = (x2 - px) * (y0 - py) - (x0 - px) * (y2 - py);
        let w2 = (x0 - px) * (y1 - py) - (x1 - px) * (y0 - py);
        if (w0 > 0 || w1 > 0 || w2 > 0) continue;
        w0 /= area; w1 /= area; w2 /= area;
        const z = w0 * sp[a * 3 + 2] + w1 * sp[b * 3 + 2] + w2 * sp[cc * 3 + 2];
        if (z <= zb[y * tw + x]) continue;
        zb[y * tw + x] = z;
        const o = ((oy + y) * W + ox + x) * 4;
        for (let j = 0; j < 3; j++) img[o + j] = Math.min(255, (w0 * shadeV[a * 3 + j] + w1 * shadeV[b * 3 + j] + w2 * shadeV[cc * 3 + j]) * 255);
      }
    }
    // analytic spheres (eyeballs in previews)
    for (const sp of spheres) {
      const q = proj(sp.c[0], sp.c[1], sp.c[2]);
      const R = sp.r * scale;
      for (let y = Math.max(0, Math.floor(q[1] - R)); y <= Math.min(th - 1, Math.ceil(q[1] + R)); y++) {
        for (let x = Math.max(0, Math.floor(q[0] - R)); x <= Math.min(tw - 1, Math.ceil(q[0] + R)); x++) {
          const dx = (x + 0.5 - q[0]) / R, dy = (y + 0.5 - q[1]) / R, dd = dx * dx + dy * dy;
          if (dd > 1) continue;
          const dz = Math.sqrt(1 - dd);
          const z = q[2] + dz * sp.r;
          if (z <= zb[y * tw + x]) continue;
          zb[y * tw + x] = z;
          // normal in world space
          const nw = [right[0] * dx - up[0] * dy + d[0] * dz, right[1] * dx - up[1] * dy + d[1] * dz, right[2] * dx - up[2] * dy + d[2] * dz];
          const hl = Math.pow(Math.max(0, nw[0] * L[0] + nw[1] * L[1] + nw[2] * L[2]), 40);
          const o = ((oy + y) * W + ox + x) * 4;
          for (let j = 0; j < 3; j++) img[o + j] = Math.min(255, sp.color[j] * (0.6 + 0.4 * dz) + hl * 255);
        }
      }
    }
    // ground line + extras (bone points)
    if (gy > 0 && gy < th) for (let x = 0; x < tw; x++) { const o = ((oy + Math.round(gy)) * W + ox + x) * 4; if (zb[Math.round(gy) * tw + x] === -Infinity) { img[o] = 120; img[o + 1] = 125; img[o + 2] = 135; } }
    for (const e of extras) {
      const q = proj(e.p[0], e.p[1], e.p[2]);
      for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) {
        const X = Math.round(q[0]) + xx, Y = Math.round(q[1]) + yy;
        if (X < 0 || Y < 0 || X >= tw || Y >= th) continue;
        const o = ((oy + Y) * W + ox + X) * 4; img[o] = e.c[0]; img[o + 1] = e.c[1]; img[o + 2] = e.c[2];
      }
    }
  });
  return { img, W, H };
}

function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function srgb(x) { x = Math.max(0, Math.min(1, x)); return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; }
