// Device tiers: which default quality a phone / tablet gets.
//
// Inputs (all optional, every one feature-detected):
//   - GPU renderer string (WEBGL_debug_renderer_info, else gl.RENDERER): "Adreno (TM) 830",
//     "Mali-G77 MC9", "ANGLE (…SwiftShader…)", "Apple GPU", "NVIDIA GeForce …"
//   - navigator.deviceMemory / hardwareConcurrency
//   - screen size and devicePixelRatio (tablet = shortest side >= 600 CSS px)
//   - window.AndroidBridge.getDeviceInfo(): model, SoC (Android 12+), RAM, refresh rates,
//     smallest width, low-RAM flag, power saving
//
// Tiers:  top  Adreno 730+ / 8xx (S25 Ultra 830, Tab S9 / S9+ 740), Mali-G710+ / Immortalis,
//              Xclipse 940+, Apple, desktop discrete GPUs              -> quality 'alta'
//         mid  Adreno 630-729 (Tab S6 640), Mali-G76/G77/G78 (Nord 2 G77 MC9), Mali-G6xx,
//              Xclipse 920/930, Intel UHD, unknown mobile GPUs          -> quality 'media'
//         low  older Adreno / Mali / PowerVR, < 4 GB RAM, software GPU -> quality 'bassa'
// The tier only picks the DEFAULT quality: the user's choice in Stile > Qualità always wins.
//
// Testing: `?tier=mid`, `?gpu=Adreno%20(TM)%20640&mem=6` (or localStorage
// 'posaviva.device.sim' = JSON {gpu, mem, cores, tier, android}) simulate a device.

/** Quality presets. maxMP caps the TOTAL rendered pixels (tablets), prCap the pixel ratio (phones). */
export const QUALITY = {
  alta: {
    id: 'alta', label: 'Alta', prCap: 2, maxMP: 3.4, shadow: 2048, ao: 'on', aoScale: 0.5, aoSamples: 12,
    shadowEvery: 1, texMax: 0, fps: 0, buildBudget: 12,
  },
  media: {
    id: 'media', label: 'Media', prCap: 1.75, maxMP: 1.8, shadow: 1024, ao: 'rest', aoScale: 0.5, aoSamples: 8,
    shadowEvery: 2, texMax: 1024, fps: 60, buildBudget: 8,
  },
  bassa: {
    id: 'bassa', label: 'Bassa', prCap: 1.25, maxMP: 1.0, shadow: 512, ao: 'off', aoScale: 0.5, aoSamples: 6,
    shadowEvery: 2, texMax: 1024, fps: 60, buildBudget: 6,
  },
};
// ao: 'on' every frame · 'rest' only once the image is still (never during gestures or
//     animations; one extra frame when it settles) · 'off' on screen (exports keep it).
// shadowEvery: while the scene changes every frame (posing, animations), shadow maps are
//     re-rendered every N frames; camera-only frames never re-render them (see app.js).
// texMax: largest texture side uploaded to the GPU (0 = as authored; assets are <= 2048).
// fps: frame-rate cap (0 = display rate, e.g. 120 Hz). Android also lowers the panel rate.
// buildBudget: ms of garment building per frame (app.clothing.manager.budget).

export const TIER_QUALITY = { top: 'alta', mid: 'media', low: 'bassa' };
export const TIER_LABEL = { top: 'alta fascia', mid: 'fascia media', low: 'fascia base' };

/**
 * Known devices of the target list (Build.MODEL prefixes) -> tier, used when the GPU
 * string is masked or unknown. GPU names are authoritative otherwise.
 */
const MODELS = [
  [/^SM-S93[18]/i, 'top', 'Galaxy S25'],            // S25 / S25 Ultra (Snapdragon 8 Elite, Adreno 830)
  [/^SM-S92[18]/i, 'top', 'Galaxy S24'],
  [/^SM-X(71|81|91)\d/i, 'top', 'Galaxy Tab S9'],  // Tab S9 / S9+ / S9 Ultra (8 Gen 2, Adreno 740)
  [/^SM-X(72|82|92)\d/i, 'top', 'Galaxy Tab S10'],
  [/^SM-T86\d/i, 'mid', 'Galaxy Tab S6'],          // Snapdragon 855, Adreno 640
  [/^SM-P61\d/i, 'mid', 'Galaxy Tab S6 Lite'],
  [/^DN210[1-9]/i, 'mid', 'OnePlus Nord 2'],       // Dimensity 1200, Mali-G77 MC9
];
const SOCS = [
  [/^SM8(75|65|55)0/i, 'top'], [/^SM8(45|47)0/i, 'top'], [/^SM8350/i, 'mid'], [/^SM8250/i, 'mid'], [/^SM8150/i, 'mid'],
  [/^MT689[1-9]|^MT6983|^MT6985|^MT6989|^MT6991/i, 'mid'], [/^s5e9(94|95)/i, 'top'],
];

/** Classifies a GPU renderer string. Returns {family, model, tier} (tier null when unknown). */
export function classifyGpu(str) {
  const s = String(str || '');
  let m;
  if (/swiftshader|llvmpipe|software|softpipe|microsoft basic render/i.test(s)) return { family: 'software', model: null, tier: 'low' };
  if ((m = s.match(/Adreno[^\d]*(\d{3})/i))) {
    const n = +m[1];
    return { family: 'adreno', model: n, tier: n >= 730 ? 'top' : n >= 630 ? 'mid' : 'low' };
  }
  if ((m = s.match(/(Immortalis|Mali)[- ]?G(\d+)/i))) {
    const n = +m[2];
    const tier = /immortalis/i.test(m[1]) ? 'top' : n >= 700 ? 'top' : n >= 600 ? 'mid' : n >= 76 ? 'mid' : 'low';
    return { family: 'mali', model: n, tier };
  }
  if (/Mali/i.test(s)) return { family: 'mali', model: null, tier: 'low' };
  if ((m = s.match(/Xclipse[^\d]*(\d{3})/i))) return { family: 'xclipse', model: +m[1], tier: +m[1] >= 940 ? 'top' : 'mid' };
  if (/PowerVR|IMG BXM|Rogue/i.test(s)) return { family: 'powervr', model: null, tier: 'low' };
  if (/Apple/i.test(s)) return { family: 'apple', model: null, tier: 'top' };
  if (/Intel/i.test(s)) return { family: 'intel', model: null, tier: /Iris|Arc|Xe/i.test(s) ? 'top' : 'mid' };
  if (/NVIDIA|GeForce|Quadro|RTX|Radeon|AMD/i.test(s)) return { family: 'desktop', model: null, tier: 'top' };
  return { family: 'unknown', model: null, tier: null };
}

/** Unmasked GPU renderer string of a WebGL context ('' when unavailable). */
export function gpuString(gl) {
  if (!gl) return '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    return String(s || gl.getParameter(gl.RENDERER) || '');
  } catch { return ''; }
}

function readSim() {
  const sim = {};
  try {
    const q = new URLSearchParams(location.search);
    for (const k of ['gpu', 'mem', 'cores', 'tier']) if (q.has(k)) sim[k] = q.get(k);
  } catch { /* no location */ }
  try { Object.assign(sim, JSON.parse(localStorage.getItem('posaviva.device.sim') || '{}')); } catch { /* private mode */ }
  return sim;
}

function androidInfo(sim) {
  if (sim.android) return sim.android;
  try {
    const raw = window.AndroidBridge?.getDeviceInfo?.();
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

const TIER_RANK = { low: 0, mid: 1, top: 2 };
const RANK_TIER = ['low', 'mid', 'top'];

/**
 * Detects the device and its tier.
 * @param {WebGL2RenderingContext} gl
 * @returns {{tier, quality, gpu, gpuFamily, gpuModel, memoryGB, cores, tablet, screen, android, maxTextureSize, reasons: string[], simulated: boolean}}
 */
export function detectDevice(gl) {
  const sim = readSim();
  const reasons = [];
  const gpu = sim.gpu || gpuString(gl);
  const g = classifyGpu(gpu);
  const and = androidInfo(sim);
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const memoryGB = +(sim.mem || (and?.ramMB ? and.ramMB / 1024 : 0) || nav.deviceMemory || 0) || null;
  const cores = +(sim.cores || and?.cores || nav.hardwareConcurrency || 0) || null;
  const scr = typeof screen !== 'undefined' ? screen : { width: 0, height: 0 };
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const shortCss = Math.min(scr.width || 0, scr.height || 0);
  const tablet = and?.smallestWidthDp ? and.smallestWidthDp >= 600 : shortCss >= 600;
  let maxTextureSize = 4096, fragHighp = true;
  try {
    maxTextureSize = gl?.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    // three.js compiles every program in highp (G-buffer depth, DQ skinning, AO need it);
    // a GPU without highp fragment floats falls back to mediump: lowest tier then
    const hp = gl?.getShaderPrecisionFormat?.(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    if (hp && hp.precision === 0) fragHighp = false;
  } catch { /* lost */ }

  let tier = g.tier;
  if (tier) reasons.push(`GPU ${gpu.replace(/^ANGLE \(|\)$/g, '').slice(0, 60)} → ${tier}`);
  // the target devices by model / SoC when the GPU string tells nothing
  if (!tier && and?.model) {
    const hit = MODELS.find(([re]) => re.test(and.model));
    if (hit) { tier = hit[1]; reasons.push(`modello ${and.model} (${hit[2]}) → ${tier}`); }
  }
  if (!tier && and?.socModel) {
    const hit = SOCS.find(([re]) => re.test(and.socModel));
    if (hit) { tier = hit[1]; reasons.push(`SoC ${and.socModel} → ${tier}`); }
  }
  if (!tier) {
    // unknown GPU: memory and cores decide (desktop browsers without a mobile UA → top)
    const mobile = /Android|Mobile|iPad|iPhone/i.test(nav.userAgent || '');
    tier = !mobile ? 'top' : memoryGB >= 8 && cores >= 8 ? 'top' : memoryGB && memoryGB < 4 ? 'low' : 'mid';
    reasons.push(`GPU sconosciuta (${mobile ? 'mobile' : 'desktop'}, ${memoryGB || '?'} GB) → ${tier}`);
  }
  // little memory: one step down (WebGL + the WebView renderer need ~0.6-1 GB on big scenes)
  if (memoryGB && memoryGB < 4 && tier !== 'low') { tier = RANK_TIER[TIER_RANK[tier] - 1]; reasons.push(`${memoryGB} GB di RAM → ${tier}`); }
  if (and?.lowRam && tier !== 'low') { tier = 'low'; reasons.push('dispositivo a poca RAM → low'); }
  if (!fragHighp && tier !== 'low') { tier = 'low'; reasons.push('GPU senza precisione highp → low'); }
  // automated browsers (tests, screenshots) on a software GPU keep the reference quality
  if (g.family === 'software' && nav.webdriver) { tier = 'top'; reasons.push('browser automatico: qualità di riferimento'); }
  if (sim.tier && TIER_RANK[sim.tier] !== undefined) { tier = sim.tier; reasons.push(`simulato: ${tier}`); }

  return {
    tier, quality: TIER_QUALITY[tier], gpu, gpuFamily: g.family, gpuModel: g.model,
    memoryGB, cores, tablet, maxTextureSize, fragHighp,
    screen: { cssW: scr.width || 0, cssH: scr.height || 0, dpr, physW: Math.round((scr.width || 0) * dpr), physH: Math.round((scr.height || 0) * dpr) },
    android: and, reasons, simulated: Object.keys(sim).length > 0,
  };
}

/**
 * Pixel ratio for a canvas of cssW x cssH under a quality preset: min(devicePixelRatio, prCap),
 * lowered so that the drawing buffer stays within maxMP megapixels (big tablet screens).
 */
export function pixelRatioFor(q, cssW, cssH, dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1) {
  let pr = Math.min(dpr, q.prCap);
  const area = Math.max(1, cssW * cssH);
  if (q.maxMP && area * pr * pr > q.maxMP * 1e6) pr = Math.sqrt((q.maxMP * 1e6) / area);
  return Math.max(0.5, Math.round(pr * 100) / 100);
}
