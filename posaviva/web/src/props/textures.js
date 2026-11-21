// Procedural canvas textures for props (floors, rugs, paintings, screens, boards).
// Cached by key: the same key always returns the same THREE.CanvasTexture, so
// material-library specs that use it stay identical and share one material.
import * as THREE from 'three';
import { rng } from './params.js';

const cache = new Map();

function make(key, w, h, draw, { repeat = false } = {}) {
  let t = cache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.name = key;
  cache.set(key, t);
  return t;
}

const hsl = (h, s, l) => `hsl(${h},${s}%,${l}%)`;
const shadeHex = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };

/** Wood planks, one texture tile = 1.2 m (uv tile 1.2). tone: 'chiaro' | 'medio' | 'scuro'. */
export function woodFloor(tone = 'medio') {
  const base = { chiaro: [36, 38, 64], medio: [30, 36, 42], scuro: [22, 34, 24] }[tone] || [30, 36, 42];
  return make(`wood:${tone}`, 512, 512, (ctx, W, H) => {
    const r = rng(7);
    const rows = 8, ph = H / rows;
    for (let i = 0; i < rows; i++) {
      let x = -r() * W;
      while (x < W) {
        const len = W * (0.35 + r() * 0.5);
        const l = base[2] + (r() - 0.5) * 10;
        ctx.fillStyle = hsl(base[0] + (r() - 0.5) * 6, base[1], l);
        ctx.fillRect(x, i * ph, len, ph);
        // grain
        ctx.strokeStyle = hsl(base[0], base[1], l - 7);
        ctx.globalAlpha = 0.35;
        for (let g = 0; g < 7; g++) {
          ctx.lineWidth = 0.6 + r() * 1.2;
          ctx.beginPath();
          const y0 = i * ph + r() * ph;
          ctx.moveTo(x, y0);
          for (let s = 1; s <= 8; s++) ctx.lineTo(x + (len * s) / 8, y0 + Math.sin(s * 0.9 + g) * 2 * r());
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(x, i * ph, 2, ph);
        x += len;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, i * ph, W, 2);
    }
    // wrap the vertical joints at the texture edge
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, 1, H);
  }, { repeat: true });
}

/** Square ceramic tiles with grout; one texture tile = 4 x 4 tiles. */
export function tiles(color = '#e8e4dc', grout = '#9c968c') {
  return make(`tiles:${color}:${grout}`, 256, 256, (ctx, W, H) => {
    const r = rng(3);
    ctx.fillStyle = grout; ctx.fillRect(0, 0, W, H);
    const n = 4, s = W / n, g = 3;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      ctx.fillStyle = shadeHex(color, 0.95 + r() * 0.08);
      ctx.fillRect(i * s + g / 2, j * s + g / 2, s - g, s - g);
      const grd = ctx.createLinearGradient(i * s, j * s, i * s + s, j * s + s);
      grd.addColorStop(0, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(0,0,0,0.05)');
      ctx.fillStyle = grd; ctx.fillRect(i * s + g / 2, j * s + g / 2, s - g, s - g);
    }
  }, { repeat: true });
}

/** Checkerboard tiles (bar / diner floors). */
export function checker(a = '#ece8e0', b = '#2b2b2e') {
  return make(`checker:${a}:${b}`, 256, 256, (ctx, W) => {
    const n = 4, s = W / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { ctx.fillStyle = (i + j) % 2 ? b : a; ctx.fillRect(i * s, j * s, s, s); }
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5;
    for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, W); ctx.moveTo(0, i * s); ctx.lineTo(W, i * s); ctx.stroke(); }
  }, { repeat: true });
}

/** Marble slabs (white with grey veins). */
export function marble(tone = '#eeebe6') {
  return make(`marble:${tone}`, 512, 512, (ctx, W, H) => {
    const r = rng(11);
    ctx.fillStyle = tone; ctx.fillRect(0, 0, W, H);
    for (let v = 0; v < 14; v++) {
      ctx.strokeStyle = `rgba(90,90,96,${0.08 + r() * 0.18})`;
      ctx.lineWidth = 0.5 + r() * 2.5;
      ctx.beginPath();
      let x = r() * W, y = 0;
      ctx.moveTo(x, y);
      while (y < H) { x += (r() - 0.5) * 40; y += 10 + r() * 25; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, W, H);
  }, { repeat: true });
}

/** Concrete (smooth, slightly mottled). */
export function concrete() {
  return make('concrete', 256, 256, (ctx, W, H) => {
    const r = rng(5);
    ctx.fillStyle = '#9d9a94'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r() * 0.05})`;
      const s = 2 + r() * 14;
      ctx.fillRect(r() * W, r() * H, s, s);
    }
  }, { repeat: true });
}

/** Rugs: 'persiano' | 'moderno' | 'righe' | 'geometrico'. Palette from the seed. */
export function rug(pattern, seedValue, color) {
  return make(`rug:${pattern}:${seedValue}:${color}`, 512, 512, (ctx, W, H) => {
    const r = rng(seedValue);
    const base = new THREE.Color(color);
    const hsl0 = {}; base.getHSL(hsl0);
    const hue = Math.round(hsl0.h * 360);
    const pal = [hsl(hue, 45, 32), hsl((hue + 25) % 360, 40, 55), hsl((hue + 180) % 360, 35, 40), hsl(hue, 30, 82), hsl((hue + 330) % 360, 50, 25)];
    if (pattern === 'righe') {
      let x = 0;
      while (x < W) { const w = 12 + r() * 50; ctx.fillStyle = r.pick(pal); ctx.fillRect(x, 0, w, H); x += w; }
    } else if (pattern === 'geometrico') {
      ctx.fillStyle = pal[3]; ctx.fillRect(0, 0, W, H);
      const n = 6, s = W / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        ctx.fillStyle = pal[(i + j * 2) % 3];
        ctx.beginPath();
        if ((i + j) % 2) { ctx.moveTo(i * s, j * s); ctx.lineTo(i * s + s, j * s); ctx.lineTo(i * s, j * s + s); }
        else { ctx.moveTo(i * s + s, j * s + s); ctx.lineTo(i * s, j * s + s); ctx.lineTo(i * s + s, j * s); }
        ctx.fill();
      }
    } else if (pattern === 'moderno') {
      ctx.fillStyle = pal[3]; ctx.fillRect(0, 0, W, H);
      for (let k = 0; k < 7; k++) {
        ctx.fillStyle = r.pick(pal.slice(0, 3)); ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.arc(r() * W, r() * H, 30 + r() * 120, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pal[4]; ctx.lineWidth = 6;
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(r() * W, 0); ctx.bezierCurveTo(r() * W, H * 0.3, r() * W, H * 0.7, r() * W, H); ctx.stroke(); }
    } else {
      // persiano: field, medallion, borders
      ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = pal[4]; ctx.fillRect(18, 18, W - 36, H - 36);
      ctx.fillStyle = pal[0]; ctx.fillRect(34, 34, W - 68, H - 68);
      ctx.strokeStyle = pal[3]; ctx.lineWidth = 3; ctx.strokeRect(40, 40, W - 80, H - 80);
      for (let k = 0; k < 40; k++) { // border motifs
        const t = k / 40;
        for (const [x, y] of [[26 + t * (W - 52), 26], [26 + t * (W - 52), H - 26], [26, 26 + t * (H - 52)], [W - 26, 26 + t * (H - 52)]]) {
          ctx.fillStyle = pal[1 + (k % 2)]; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.save(); ctx.translate(W / 2, H / 2);
      for (let ring = 5; ring >= 1; ring--) {
        ctx.fillStyle = pal[ring % pal.length];
        ctx.beginPath();
        for (let a = 0; a <= 16; a++) { const ang = (a / 16) * Math.PI * 2, rr = ring * 26 * (a % 2 ? 0.78 : 1); ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr); }
        ctx.fill();
      }
      ctx.restore();
      for (const [cx, cy] of [[90, 90], [W - 90, 90], [90, H - 90], [W - 90, H - 90]]) {
        ctx.fillStyle = pal[2]; ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = pal[1]; ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill();
      }
    }
    // pile noise
    for (let i = 0; i < 2500; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`; ctx.fillRect(r() * W, r() * H, 2, 2); }
  });
}

/** Paintings: 'astratto' | 'paesaggio' | 'geometrico' | 'mare' | 'notte'. */
export function painting(subject, seedValue) {
  return make(`paint:${subject}:${seedValue}`, 256, 256, (ctx, W, H) => {
    const r = rng(seedValue);
    if (subject === 'paesaggio' || subject === 'mare' || subject === 'notte') {
      const night = subject === 'notte';
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.6);
      sky.addColorStop(0, night ? '#0f1736' : hsl(205 + r() * 20, 60, 62));
      sky.addColorStop(1, night ? '#3b3466' : hsl(30 + r() * 20, 70, 82));
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = night ? '#f6f1cf' : '#fff3c4';
      ctx.beginPath(); ctx.arc(W * (0.2 + r() * 0.6), H * (0.15 + r() * 0.2), 14 + r() * 10, 0, Math.PI * 2); ctx.fill();
      if (night) for (let i = 0; i < 60; i++) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(r() * W, r() * H * 0.5, 1.5, 1.5); }
      const layers = subject === 'mare' ? 1 : 3;
      for (let l = 0; l < layers; l++) {
        ctx.fillStyle = night ? hsl(240, 20, 12 + l * 6) : hsl(110 + l * 15 + r() * 20, 30 + l * 8, 50 - l * 10);
        ctx.beginPath(); ctx.moveTo(0, H);
        const y0 = H * (0.45 + l * 0.13);
        for (let x = 0; x <= W; x += 16) ctx.lineTo(x, y0 + Math.sin(x * 0.02 + r() * 6) * 18 - r() * 10);
        ctx.lineTo(W, H); ctx.fill();
      }
      if (subject === 'mare') {
        ctx.fillStyle = hsl(200, 55, 38); ctx.fillRect(0, H * 0.58, W, H * 0.42);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        for (let i = 0; i < 25; i++) { const y = H * 0.6 + r() * H * 0.38; ctx.beginPath(); ctx.moveTo(r() * W, y); ctx.lineTo(r() * W, y); ctx.stroke(); }
      }
    } else if (subject === 'geometrico') {
      ctx.fillStyle = '#f1ede4'; ctx.fillRect(0, 0, W, H);
      const cols = ['#d23a2e', '#2a4fa0', '#f2c230', '#f1ede4', '#f1ede4'];
      const split = (x, y, w, h, d) => {
        if (d > 3 || w < 40 || h < 40 || (d > 1 && r() < 0.3)) {
          ctx.fillStyle = r.pick(cols); ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = '#111'; ctx.lineWidth = 5; ctx.strokeRect(x, y, w, h); return;
        }
        if (w > h) { const s = w * (0.3 + r() * 0.4); split(x, y, s, h, d + 1); split(x + s, y, w - s, h, d + 1); }
        else { const s = h * (0.3 + r() * 0.4); split(x, y, w, s, d + 1); split(x, y + s, w, h - s, d + 1); }
      };
      split(0, 0, W, H, 0);
    } else {
      const hue = r() * 360;
      ctx.fillStyle = hsl(hue, 30, 85); ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = hsl((hue + r() * 140) % 360, 50 + r() * 30, 35 + r() * 35);
        ctx.globalAlpha = 0.6 + r() * 0.4;
        ctx.beginPath();
        if (r() < 0.5) ctx.arc(r() * W, r() * H, 15 + r() * 60, 0, Math.PI * 2);
        else { ctx.moveTo(r() * W, r() * H); for (let k = 0; k < 4; k++) ctx.quadraticCurveTo(r() * W, r() * H, r() * W, r() * H); }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  });
}

/** Screen contents: 'desktop' | 'video' | 'codice' | 'spento'. */
export function screen(kind) {
  return make(`screen:${kind}`, 256, 160, (ctx, W, H) => {
    const r = rng(kind.length * 13);
    if (kind === 'spento') { ctx.fillStyle = '#0b0c0f'; ctx.fillRect(0, 0, W, H); const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(255,255,255,0.08)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return; }
    if (kind === 'codice') {
      ctx.fillStyle = '#16181d'; ctx.fillRect(0, 0, W, H);
      for (let y = 8; y < H; y += 7) { let x = 6 + Math.floor(r() * 4) * 8; while (x < W - 20 && r() < 0.85) { const w = 8 + r() * 30; ctx.fillStyle = r.pick(['#7fb4ff', '#c792ea', '#c3e88d', '#f78c6c', '#d0d0d0']); ctx.fillRect(x, y, w, 3); x += w + 4; } }
      return;
    }
    if (kind === 'video') {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#4f86c6'); g.addColorStop(1, '#e9b38a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#2f4f3a'; ctx.beginPath(); ctx.moveTo(0, H); for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H * 0.62 + Math.sin(x * 0.03) * 14); ctx.lineTo(W, H); ctx.fill();
      return;
    }
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2a5298'); g.addColorStop(1, '#6a3093'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20,20,24,0.85)'; ctx.fillRect(0, H - 12, W, 12);
    for (let k = 0; k < 2; k++) {
      const x = 20 + r() * 100, y = 15 + r() * 50, w = 90 + r() * 60, h = 60 + r() * 30;
      ctx.fillStyle = '#f4f4f6'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#d9dbe0'; ctx.fillRect(x, y, w, 8);
      ctx.fillStyle = '#c3c6cc'; for (let l = 0; l < 5; l++) ctx.fillRect(x + 6, y + 14 + l * 9, w * (0.4 + r() * 0.5), 3);
    }
  });
}

/** Writing boards: 'bianca' (whiteboard) | 'nera' (chalkboard). */
export function board(kind) {
  return make(`board:${kind}`, 512, 256, (ctx, W, H) => {
    const r = rng(kind === 'nera' ? 21 : 22);
    const dark = kind === 'nera';
    ctx.fillStyle = dark ? '#28352d' : '#f6f7f5'; ctx.fillRect(0, 0, W, H);
    if (dark) for (let i = 0; i < 400; i++) { ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(r() * W, r() * H, 6, 3); }
    ctx.strokeStyle = dark ? 'rgba(240,240,230,0.85)' : r.pick(['#1f4fbf', '#202124']);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    for (let line = 0; line < 6; line++) {
      let x = 30 + r() * 30; const y = 40 + line * 34;
      while (x < W - 80 && r() < 0.9) {
        const w = 14 + r() * 50;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let s = 1; s <= 6; s++) ctx.lineTo(x + (w * s) / 6, y + (r() - 0.5) * 9);
        ctx.stroke(); x += w + 10;
      }
    }
    ctx.beginPath(); ctx.arc(W * 0.78, H * 0.55, 38, 0, Math.PI * 2); ctx.moveTo(W * 0.7, H * 0.85); ctx.lineTo(W * 0.92, H * 0.25); ctx.stroke();
  });
}

/** Book spines / small labels are vertex colors; this gives a palette of believable cover colors. */
export const BOOK_COLORS = ['#7a1f24', '#2f4a6b', '#4f6b3a', '#c9a227', '#3b3b40', '#e8e4dc', '#8a5a3b', '#a83c32', '#1e5a5a', '#5b3f6e', '#d9822b', '#29303d', '#9fb3c8', '#6d2e46', '#b7a57a'];
