// Card thumbnails of the presets: small painted illustrations (2D canvas, no
// rendering cost), replaced by a real capture of the last landscape generated
// from that preset on this device (kept in localStorage, best effort).
const LS = 'posaviva.landscapes.thumbs';
const W = 160, H = 112;

let _saved = null;
function saved() {
  if (_saved) return _saved;
  try { _saved = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { _saved = {}; }
  return _saved;
}
export function storeThumb(id, dataUrl) {
  const s = saved();
  s[id] = dataUrl;
  try { localStorage.setItem(LS, JSON.stringify(s)); } catch { delete s[id]; /* quota: keep the painted one */ }
}
export function savedThumb(id) { return saved()[id] || null; }

const rnd = (seed) => { let a = seed; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; };

function sky(g, [top, bottom], groundY) {
  const gr = g.createLinearGradient(0, 0, 0, groundY);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, W, groundY + 1);
}
function ground(g, col, y, curve = 0) {
  g.fillStyle = col;
  g.beginPath(); g.moveTo(0, y + curve); g.quadraticCurveTo(W / 2, y - curve, W, y + curve); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
}
const rect = (g, c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
function windows(g, x, y, w, h, lit = false, r = Math.random) {
  for (let yy = y + 4; yy < y + h - 4; yy += 6) for (let xx = x + 3; xx < x + w - 4; xx += 6) { g.fillStyle = lit && r() < 0.45 ? '#ffd98a' : 'rgba(40,50,64,.55)'; g.fillRect(xx, yy, 3, 3.5); }
}
function tree(g, x, y, s, col = '#3f6a2e') { rect(g, '#5b4636', x - s * 0.08, y - s * 0.5, s * 0.16, s * 0.5); g.fillStyle = col; g.beginPath(); g.arc(x, y - s * 0.75, s * 0.42, 0, Math.PI * 2); g.fill(); }
function pine(g, x, y, s, col = '#2f5230') { g.fillStyle = col; g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 0.32, y - s * 0.1); g.lineTo(x - s * 0.32, y - s * 0.1); g.closePath(); g.fill(); rect(g, '#4b3a2c', x - 1.5, y - s * 0.1, 3, s * 0.1); }
function peaks(g, y, col, snow, seed, amp = 40) {
  const r = rnd(seed); g.fillStyle = col; g.beginPath(); g.moveTo(0, y);
  const pts = [];
  for (let x = 0; x <= W; x += 16) { const py = y - amp * (0.4 + r() * 0.6); pts.push([x, py]); g.lineTo(x, py); }
  g.lineTo(W, y); g.closePath(); g.fill();
  if (snow) { g.fillStyle = snow; for (const [x, py] of pts) { if (py < y - amp * 0.75) { g.beginPath(); g.moveTo(x, py); g.lineTo(x + 6, py + 8); g.lineTo(x - 6, py + 8); g.closePath(); g.fill(); } } }
}
function person(g, x, y, s = 22, col = 'rgba(25,25,35,.85)') {
  g.fillStyle = col; g.beginPath(); g.arc(x, y - s * 0.88, s * 0.11, 0, Math.PI * 2); g.fill();
  g.fillRect(x - s * 0.12, y - s * 0.76, s * 0.24, s * 0.42); g.fillRect(x - s * 0.1, y - s * 0.36, s * 0.08, s * 0.36); g.fillRect(x + s * 0.02, y - s * 0.36, s * 0.08, s * 0.36);
}

const PAINT = {
  street(g, t) { sky(g, t.sky, 70); const r = rnd(3); for (let x = 0; x < W; x += 26) { const h = 34 + r() * 30; rect(g, ['#cdb79a', '#b9a58f', '#d9c9b0', '#9fa7ad'][Math.floor(r() * 4)], x, 70 - h, 25, h); windows(g, x, 70 - h, 25, h, false, r); } rect(g, '#bdb8b0', 0, 70, W, 6); rect(g, '#4b4b4f', 0, 76, W, 18); for (let x = 6; x < W; x += 20) rect(g, '#e8e8e2', x, 84, 10, 2); rect(g, '#bdb8b0', 0, 94, W, H - 94); person(g, 70, 108); person(g, 88, 108); },
  towers(g, t) { sky(g, t.sky, 80); const r = rnd(5); for (let x = -4; x < W; x += 22) { const h = 40 + r() * 60; rect(g, ['#8ea4b8', '#6f8aa0', '#b7c4cf', '#a69a86'][Math.floor(r() * 4)], x, 80 - h, 20, h); windows(g, x, 80 - h, 20, h, false, r); } rect(g, '#4b4b4f', 0, 80, W, H - 80); for (let x = 50; x < 110; x += 8) rect(g, '#ececec', x, 92, 5, 14); person(g, 30, 110); person(g, 44, 110); },
  alley(g, t) { sky(g, t.sky, 60); g.fillStyle = '#2b2d36'; g.beginPath(); g.moveTo(0, 0); g.lineTo(64, 30); g.lineTo(64, 78); g.lineTo(0, H); g.fill(); g.beginPath(); g.moveTo(W, 0); g.lineTo(96, 30); g.lineTo(96, 78); g.lineTo(W, H); g.fill(); rect(g, '#3a3c44', 64, 30, 32, 48); g.fillStyle = '#1e1f24'; g.beginPath(); g.moveTo(0, H); g.lineTo(64, 78); g.lineTo(96, 78); g.lineTo(W, H); g.fill(); for (const [x, y, c] of [[18, 40, '#ff4fb8'], [138, 52, '#43b6ff'], [52, 52, '#ffd23f'], [110, 44, '#55ff8a']]) { g.shadowColor = c; g.shadowBlur = 10; rect(g, c, x, y, 10, 5); } g.shadowBlur = 0; person(g, 74, 106, 24, '#0d0d12'); person(g, 90, 106, 24, '#0d0d12'); },
  roof(g, t) { sky(g, t.sky, 78); const r = rnd(9); for (let x = 0; x < W; x += 14) { const h = 10 + r() * 45; rect(g, ['#7a8696', '#9aa3ad', '#6a7583'][Math.floor(r() * 3)], x, 78 - h, 12, h); windows(g, x, 78 - h, 12, h, true, r); } rect(g, '#9c978e', 0, 82, W, H - 82); rect(g, '#bdb8ae', 0, 78, W, 6); rect(g, '#6b5a48', 116, 40, 18, 20); rect(g, '#6b5a48', 121, 60, 3, 18); rect(g, '#6b5a48', 128, 60, 3, 18); person(g, 60, 106); person(g, 78, 106); },
  square(g, t) { sky(g, t.sky, 72); rect(g, '#e0c9a2', 52, 30, 56, 42); g.fillStyle = '#c9a77a'; g.beginPath(); g.moveTo(48, 32); g.lineTo(80, 14); g.lineTo(112, 32); g.fill(); rect(g, '#d6bd93', 100, 4, 12, 40); rect(g, '#e8d3b0', 0, 40, 50, 32); rect(g, '#d9c0a0', 110, 42, 50, 30); windows(g, 0, 40, 50, 32); windows(g, 110, 42, 50, 30); rect(g, '#b5a68f', 0, 72, W, H - 72); g.fillStyle = '#9d9585'; g.beginPath(); g.ellipse(80, 86, 22, 6, 0, 0, Math.PI * 2); g.fill(); rect(g, '#cfc6b6', 77, 70, 6, 16); g.fillStyle = '#7fb3c4'; g.beginPath(); g.ellipse(80, 86, 18, 4, 0, 0, Math.PI * 2); g.fill(); person(g, 50, 108); person(g, 118, 108); },
  houses(g, t) { sky(g, t.sky, 68); ground(g, '#7aa04a', 68); const r = rnd(4); for (let x = 4; x < W; x += 38) { rect(g, ['#efe6d6', '#e7d2b8', '#d9e2ea'][Math.floor(r() * 3)], x, 44, 28, 24); g.fillStyle = '#a5523a'; g.beginPath(); g.moveTo(x - 3, 45); g.lineTo(x + 14, 32); g.lineTo(x + 31, 45); g.fill(); rect(g, '#6b4a2f', x + 11, 56, 6, 12); tree(g, x + 34, 68, 18, '#4d7a32'); } rect(g, '#555558', 0, 80, W, 12); rect(g, '#c9c4bb', 0, 92, W, H - 92); person(g, 70, 108); person(g, 86, 108); },
  parking(g, t) { sky(g, t.sky, 56); rect(g, '#d8d4cc', 20, 30, 120, 26); rect(g, '#c0392b', 20, 30, 120, 6); g.fillStyle = '#fff'; g.font = 'bold 8px sans-serif'; g.fillText('MARKET', 64, 46); rect(g, '#5d5c59', 0, 56, W, H - 56); for (let x = 4; x < W; x += 18) rect(g, '#e8e8e2', x, 62, 2, 18); const cs = ['#c0392b', '#1f3a6b', '#c9ccd1', '#2f4f3a', '#1d1f22']; for (let i = 0; i < 8; i++) { rect(g, cs[i % 5], 7 + i * 18, 66, 12, 12); } person(g, 66, 108); person(g, 82, 108); },
  harbor(g, t) { sky(g, t.sky, 60); rect(g, t.water || '#3f6f80', 0, 60, W, 22); rect(g, '#e0a21c', 120, 18, 4, 42); rect(g, '#e0a21c', 100, 18, 40, 4); for (const [x, c] of [[10, '#b3261e'], [24, '#2f5a8a'], [17, '#2f6b3a']]) rect(g, c, x, 48 + (x === 17 ? -8 : 0), 16, 8); g.fillStyle = '#f2f1ec'; g.beginPath(); g.moveTo(60, 70); g.lineTo(84, 70); g.lineTo(80, 76); g.lineTo(64, 76); g.fill(); g.beginPath(); g.moveTo(72, 69); g.lineTo(72, 46); g.lineTo(84, 66); g.fill(); rect(g, '#8a8780', 0, 82, W, H - 82); rect(g, '#c0221c', 140, 30, 5, 30); person(g, 64, 108); person(g, 80, 108); },
  forest(g, t) { sky(g, t.sky, 60); ground(g, '#5a7a35', 62, 4); const r = rnd(7); for (let i = 0; i < 26; i++) { const x = r() * W, y = 60 + r() * 14; tree(g, x, y, 14 + r() * 12, ['#3f5f2c', '#4d6e32', '#5c7c3a'][Math.floor(r() * 3)]); } g.fillStyle = '#8a7450'; g.beginPath(); g.moveTo(72, H); g.lineTo(88, H); g.lineTo(82, 74); g.lineTo(78, 74); g.fill(); for (const x of [10, 30, 130, 150]) tree(g, x, 106, 44, '#3f6a2e'); person(g, 72, 108); person(g, 88, 108); },
  pines(g, t) { sky(g, t.sky, 62); peaks(g, 62, '#8a9aa8', '#eef2f6', 11, 36); ground(g, '#5b5a3e', 64, 3); const r = rnd(8); for (let i = 0; i < 30; i++) pine(g, r() * W, 64 + r() * 12, 16 + r() * 14); for (const x of [8, 28, 136, 152]) pine(g, x, 110, 60, '#2a4a2c'); person(g, 72, 108); person(g, 88, 108); },
  mountains(g, t) { sky(g, t.sky, 70); peaks(g, 74, '#7d8a99', '#f4f6f9', 21, 56); peaks(g, 80, '#6a7a63', null, 33, 22); ground(g, '#6e8a45', 82, 3); for (const x of [20, 130]) pine(g, x, 96, 22); person(g, 72, 108); person(g, 88, 108); },
  desert(g, t) { sky(g, t.sky, 66); rect(g, '#c98b55', 104, 44, 40, 22); rect(g, '#b8794a', 24, 52, 28, 14); ground(g, '#e2c08a', 66, 6); g.fillStyle = '#d4ad74'; g.beginPath(); g.moveTo(0, 90); g.quadraticCurveTo(60, 72, 160, 92); g.lineTo(160, 112); g.lineTo(0, 112); g.fill(); g.fillStyle = '#5f7f3a'; rect(g, '#5f7f3a', 128, 60, 6, 36); rect(g, '#5f7f3a', 120, 70, 8, 4); rect(g, '#5f7f3a', 120, 62, 4, 10); rect(g, '#5f7f3a', 134, 74, 8, 4); rect(g, '#5f7f3a', 138, 66, 4, 10); person(g, 68, 108); person(g, 84, 108); },
  beach(g, t) { sky(g, t.sky, 58); rect(g, t.water || '#3f8ea0', 0, 58, W, 22); rect(g, '#bfe3ea', 0, 78, W, 3); rect(g, '#e3cfa0', 0, 80, W, H - 80); g.strokeStyle = '#7a6650'; g.lineWidth = 3; g.beginPath(); g.moveTo(26, 110); g.quadraticCurveTo(22, 70, 34, 44); g.stroke(); g.fillStyle = '#4f7a33'; for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(34 + Math.cos(k) * 10, 44 + Math.sin(k) * 4, 12, 3, k, 0, Math.PI * 2); g.fill(); } g.fillStyle = '#d8343a'; g.beginPath(); g.moveTo(108, 78); g.lineTo(140, 78); g.lineTo(124, 68); g.fill(); rect(g, '#888', 123, 78, 2, 18); person(g, 70, 108); person(g, 86, 108); },
  farm(g, t) { sky(g, t.sky, 60); g.fillStyle = '#9ab85a'; g.beginPath(); g.moveTo(0, 66); g.quadraticCurveTo(50, 44, 100, 62); g.quadraticCurveTo(130, 50, 160, 60); g.lineTo(160, 112); g.lineTo(0, 112); g.fill(); for (let i = 0; i < 6; i++) rect(g, i % 2 ? '#c9a94e' : '#7f9f45', 0, 70 + i * 3, W, 3); rect(g, '#cfc2a6', 92, 40, 34, 22); g.fillStyle = '#8f3a2a'; g.beginPath(); g.moveTo(88, 42); g.lineTo(109, 28); g.lineTo(130, 42); g.fill(); rect(g, '#87a04a', 0, 88, W, H - 88); for (let x = 0; x < W; x += 10) rect(g, '#8a6142', x, 86, 2, 10); rect(g, '#8a6142', 0, 88, W, 2); g.fillStyle = '#f1efe9'; g.beginPath(); g.ellipse(120, 100, 9, 5, 0, 0, Math.PI * 2); g.fill(); person(g, 64, 110); person(g, 80, 110); },
  lake(g, t) { sky(g, t.sky, 58); peaks(g, 62, '#7d8fa0', '#f4f6f9', 41, 40); rect(g, t.water || '#3f7f8f', 0, 62, W, 22); rect(g, '#6a8c3d', 0, 84, W, H - 84); rect(g, '#8a6142', 72, 70, 6, 16); rect(g, '#8a6142', 60, 70, 30, 3); tree(g, 14, 100, 40, '#6f8c3f'); tree(g, 148, 104, 46, '#4d6e32'); person(g, 70, 110); person(g, 86, 110); },
  meadow(g, t) { sky(g, t.sky, 62); g.fillStyle = '#8fbf55'; g.beginPath(); g.moveTo(0, 70); g.quadraticCurveTo(60, 50, 160, 66); g.lineTo(160, 112); g.lineTo(0, 112); g.fill(); const r = rnd(12); const cs = ['#e84a5f', '#f6d743', '#ffffff', '#9b59d0', '#ff8fb1']; for (let i = 0; i < 160; i++) { const y = 66 + r() * 46; g.fillStyle = cs[Math.floor(r() * cs.length)]; g.fillRect(r() * W, y, 1.5 + (y - 60) / 25, 1.5 + (y - 60) / 25); } tree(g, 118, 68, 40, '#f3c9d8'); person(g, 64, 108); person(g, 80, 108); },
  jungle(g, t) { sky(g, t.sky, 50); rect(g, '#2f5a28', 0, 50, W, H - 50); const r = rnd(14); for (let i = 0; i < 40; i++) { g.fillStyle = ['#2f6b2a', '#3d7f30', '#4a8a35', '#1f4a1e'][Math.floor(r() * 4)]; g.beginPath(); g.ellipse(r() * W, 40 + r() * 70, 8 + r() * 14, 4 + r() * 6, r() * 3, 0, Math.PI * 2); g.fill(); } person(g, 72, 108, 22, '#10220e'); person(g, 88, 108, 22, '#10220e'); },
  village(g, t) { sky(g, t.sky, 58); g.fillStyle = '#7c9a55'; g.beginPath(); g.ellipse(120, 62, 40, 16, 0, Math.PI, 0); g.fill(); rect(g, '#bfb39b', 104, 30, 32, 18); for (const x of [102, 114, 126, 134]) rect(g, '#bfb39b', x, 26, 4, 5); rect(g, '#a89c86', 112, 18, 10, 14); rect(g, '#7d6a4c', 0, 62, W, H - 62); for (const [x, c] of [[6, '#cfc2a6'], [40, '#8a5a3b'], [116, '#cfc2a6']]) { rect(g, c, x, 56, 30, 24); g.fillStyle = '#6b4a30'; g.beginPath(); g.moveTo(x - 3, 57); g.lineTo(x + 15, 44); g.lineTo(x + 33, 57); g.fill(); } rect(g, '#9d9585', 74, 84, 14, 10); person(g, 62, 110); person(g, 98, 110); },
  ruins(g, t) { sky(g, t.sky, 66); ground(g, '#a89a6a', 68, 4); rect(g, '#ece6d6', 40, 36, 80, 6); for (let x = 44; x < 120; x += 14) rect(g, '#e3dccb', x, 42, 7, 28 - (x === 100 ? 12 : 0)); rect(g, '#d8cfbc', 30, 96, 22, 8); rect(g, '#d8cfbc', 120, 92, 8, 18); rect(g, '#3f5a35', 12, 44, 6, 26); rect(g, '#3f5a35', 146, 40, 6, 30); person(g, 74, 108); person(g, 90, 108); },
  castle(g, t) { sky(g, t.sky, 64); g.fillStyle = '#7a9a55'; g.beginPath(); g.ellipse(80, 66, 70, 20, 0, Math.PI, 0); g.fill(); rect(g, '#bfb39b', 52, 30, 56, 24); for (const x of [44, 104]) { rect(g, '#b5a98f', x, 18, 14, 36); g.fillStyle = '#7a3a2a'; g.beginPath(); g.moveTo(x - 2, 19); g.lineTo(x + 7, 6); g.lineTo(x + 16, 19); g.fill(); } for (let x = 54; x < 108; x += 8) rect(g, '#bfb39b', x, 26, 4, 5); rect(g, '#6f8a45', 0, 66, W, H - 66); g.fillStyle = '#8a7450'; g.beginPath(); g.moveTo(70, H); g.lineTo(92, H); g.lineTo(82, 64); g.lineTo(78, 64); g.fill(); person(g, 60, 108); person(g, 104, 108); },
  room(g, t) { rect(g, '#e9e2d4', 0, 0, W, H); rect(g, '#d9cbb3', 0, 0, 22, H); rect(g, '#d9cbb3', W - 22, 0, 22, H); g.fillStyle = '#b98c5f'; g.beginPath(); g.moveTo(0, H); g.lineTo(22, 80); g.lineTo(W - 22, 80); g.lineTo(W, H); g.fill(); rect(g, '#9fc4e0', 60, 20, 40, 30); rect(g, '#fff', 79, 20, 2, 30); rect(g, '#5d6b7a', 34, 64, 50, 18); rect(g, '#4a5866', 34, 56, 50, 10); rect(g, '#7a4b3a', 104, 66, 24, 14); person(g, 86, 108); person(g, 102, 108); },
};

/** Painted canvas for a preset (or the stored capture as an <img>). */
export function presetThumb(p) {
  const data = savedThumb(p.id);
  if (data) { const img = new Image(); img.src = data; img.alt = ''; img.className = 'pv-ls-thumb'; return img; }
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = W * dpr; c.height = H * dpr;
  c.className = 'pv-ls-thumb';
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const t = p.thumb || { sky: ['#8ab9e6', '#e3eef6'], ground: '#6a8c3d', sil: 'forest' };
  try { (PAINT[t.sil] || PAINT.forest)(g, t); } catch { /* decorative */ }
  return c;
}
