// "Stile" tool panel: render style cards, ink outlines, light/AO, background,
// scene toggles and quality / performance preferences. Built only with ui/kit.js.
import { h, section, slider, toggle, segmented, swatches, cardGrid } from '../ui/kit.js';

const INK_COLORS = ['#141414', '#3a2a20', '#1d2a44', '#5b5f66', '#7a1f1f', '#ffffff'];
const SOLID_BG = ['#2a2c33', '#4a4e57', '#8b9099', '#d9dbe0', '#f4f1ea', '#ffffff'];
/** Italian number formatting (decimal comma). */
const it = (v, d) => v.toFixed(d).replace('.', ',');

const BG_PRESETS = [
  { id: 'dark', label: 'Grafite', bg: { type: 'solid', color: '#2a2c33' } },
  { id: 'grey', label: 'Grigio', bg: { type: 'solid', color: '#8b9099' } },
  { id: 'paper', label: 'Carta', bg: { type: 'solid', color: '#f4f1ea' } },
  { id: 'studio', label: 'Studio', bg: { type: 'gradient', top: '#5d6577', bottom: '#1b1d23' } },
  { id: 'sky', label: 'Cielo', bg: { type: 'gradient', top: '#8fb3dc', bottom: '#e9edf2' } },
  { id: 'transparent', label: 'Trasparente', bg: { type: 'transparent' } },
];

// ---------------------------------------------------------------- thumbnails
function thumb(draw, w = 120, hh = 84) {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = w * dpr; c.height = hh * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  draw(g, w, hh);
  return c;
}

/** Little "head and shoulders" bust used to preview each style. */
function bustPath(g, cx, cy, s) {
  g.beginPath();
  g.ellipse(cx, cy - 10 * s, 12 * s, 14 * s, 0, 0, Math.PI * 2);
  g.moveTo(cx - 30 * s, cy + 30 * s);
  g.bezierCurveTo(cx - 28 * s, cy + 12 * s, cx - 14 * s, cy + 8 * s, cx - 6 * s, cy + 4 * s);
  g.lineTo(cx + 6 * s, cy + 4 * s);
  g.bezierCurveTo(cx + 14 * s, cy + 8 * s, cx + 28 * s, cy + 12 * s, cx + 30 * s, cy + 30 * s);
  g.closePath();
}

const STYLE_THUMBS = {
  realistic: (g, w, hh) => {
    g.fillStyle = '#2a2c33'; g.fillRect(0, 0, w, hh);
    const gr = g.createRadialGradient(w * 0.42, hh * 0.3, 2, w * 0.5, hh * 0.5, 44);
    gr.addColorStop(0, '#f6cfb5'); gr.addColorStop(0.55, '#d79b7c'); gr.addColorStop(1, '#6e3f2c');
    g.fillStyle = gr; bustPath(g, w / 2, hh * 0.5, 1); g.fill();
  },
  clay: (g, w, hh) => {
    g.fillStyle = '#3a3c42'; g.fillRect(0, 0, w, hh);
    const gr = g.createRadialGradient(w * 0.42, hh * 0.3, 2, w * 0.5, hh * 0.5, 44);
    gr.addColorStop(0, '#e9e5df'); gr.addColorStop(0.6, '#b9b3aa'); gr.addColorStop(1, '#5f5b56');
    g.fillStyle = gr; bustPath(g, w / 2, hh * 0.5, 1); g.fill();
  },
  toon: (g, w, hh) => {
    g.fillStyle = '#e8edf3'; g.fillRect(0, 0, w, hh);
    g.save(); bustPath(g, w / 2, hh * 0.5, 1); g.clip();
    g.fillStyle = '#f2c6a8'; g.fillRect(0, 0, w, hh);
    g.fillStyle = '#c98f78'; g.beginPath(); g.ellipse(w * 0.72, hh * 0.62, 34, 50, -0.4, 0, Math.PI * 2); g.fill();
    g.restore();
    g.lineWidth = 2.4; g.strokeStyle = '#141414'; bustPath(g, w / 2, hh * 0.5, 1); g.stroke();
  },
  lines: (g, w, hh) => {
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, w, hh);
    g.fillStyle = '#ffffff'; bustPath(g, w / 2, hh * 0.5, 1); g.fill();
    g.lineWidth = 2; g.strokeStyle = '#141414'; bustPath(g, w / 2, hh * 0.5, 1); g.stroke();
    g.lineWidth = 1.2; g.beginPath(); g.moveTo(w / 2 - 4, hh * 0.5 + 18); g.quadraticCurveTo(w / 2, hh * 0.5 + 24, w / 2 + 4, hh * 0.5 + 18); g.stroke();
  },
};

function bgThumb(bg) {
  return thumb((g, w, hh) => {
    if (bg.type === 'transparent') {
      const s = 10;
      for (let y = 0; y < hh; y += s) for (let x = 0; x < w; x += s) { g.fillStyle = ((x + y) / s) % 2 ? '#cfcfcf' : '#eeeeee'; g.fillRect(x, y, s, s); }
    } else if (bg.type === 'gradient') {
      const gr = g.createLinearGradient(0, 0, 0, hh);
      gr.addColorStop(0, bg.top); gr.addColorStop(1, bg.bottom);
      g.fillStyle = gr; g.fillRect(0, 0, w, hh);
    } else { g.fillStyle = bg.color; g.fillRect(0, 0, w, hh); }
    g.fillStyle = 'rgba(128,128,128,.35)';
    bustPath(g, w / 2, hh * 0.56, 0.8); g.fill();
  }, 96, 56);
}

const sameBg = (a, b) => a.type === b.type && (a.type === 'transparent' || (a.type === 'solid' ? a.color.toLowerCase() === b.color.toLowerCase() : a.top.toLowerCase() === b.top.toLowerCase() && a.bottom.toLowerCase() === b.bottom.toLowerCase()));

// ---------------------------------------------------------------- panel
/**
 * ctx: {app, STYLES, QUALITY, STYLE_RENDER, getState(), getPrefs(), set(patch, {commit}), setStyle(id), setQuality(id), setPref(k, v)}
 * returns {sync()}
 */
export function buildStylePanel(el, ctx) {
  const { STYLES, QUALITY, STYLE_RENDER } = ctx;
  const S = () => ctx.getState();

  // --- style cards
  const styleCards = cardGrid({
    items: STYLES.map((s) => ({ id: s.id, label: s.label, thumb: thumb(STYLE_THUMBS[s.id] || STYLE_THUMBS.clay) })),
    value: S().style, columns: 4,
    onSelect: (id) => { styleCards.setValue(id); ctx.setStyle(id); },
  });
  styleCards.classList.add('pv-style-cards');

  // --- light & AO (realistic / clay)
  const exposure = slider({ label: 'Esposizione', min: 0.4, max: 2, step: 0.01, value: S().exposure, defaultValue: 1,
    format: (v) => it(v, 2) + '×',
    onInput: (v) => ctx.set({ exposure: v }), onChange: () => ctx.app.commit('esposizione') });
  const aoToggle = toggle({ label: 'Occlusione ambientale (AO)', value: S().ao, onChange: (v) => ctx.set({ ao: v }, { commit: 'occlusione' }) });
  const aoAmount = slider({ label: 'Intensità AO', min: 0, max: 1.5, step: 0.01, value: S().aoIntensity, defaultValue: 0.8,
    format: (v) => Math.round(v * 100) + '%',
    onInput: (v) => ctx.set({ aoIntensity: v }), onChange: () => ctx.app.commit('occlusione') });
  // the quality preset may keep AO out of the moving image (Media) or the screen (Bassa)
  const aoNote = h('div', { class: 'pv-note', style: { marginTop: '6px', fontSize: '12px', color: 'var(--muted)' } });
  const lightSec = section('Resa', [exposure, aoToggle, aoAmount, aoNote]);

  // --- ink outlines
  const inkToggle = toggle({ label: 'Contorni a china', value: false, onChange: (v) => ctx.set({ outline: { [S().style]: v } }, { commit: 'contorni' }) });
  const inkWidth = slider({ label: 'Spessore linea', min: 1, max: 4, step: 0.25, value: S().inkWidth, defaultValue: 1.5,
    format: (v) => it(v, v % 1 ? (v * 2) % 1 ? 2 : 1 : 0) + ' px',
    onInput: (v) => ctx.set({ inkWidth: v }), onChange: () => ctx.app.commit('spessore linea') });
  const crease = slider({ label: 'Linee interne (pieghe)', min: 0, max: 1, step: 0.01, value: S().crease, defaultValue: 0.45,
    format: (v) => (v < 0.005 ? 'off' : Math.round(v * 100) + '%'),
    onInput: (v) => ctx.set({ crease: v }), onChange: () => ctx.app.commit('linee interne') });
  // custom pickers: live preview while the picker moves, one undo step when it is released
  const inkColor = swatches({ colors: INK_COLORS, value: S().inkColor,
    onInput: (c) => ctx.set({ inkColor: c }), onChange: (c) => ctx.set({ inkColor: c }, { commit: 'colore china' }) });
  // anatomical crease lines drawn by the skin (toon / lines): groove strength threshold
  const anatomy = slider({ label: 'Linee anatomiche', min: 0, max: 1, step: 0.01, value: S().anatomy ?? 0.3, defaultValue: 0.3,
    format: (v) => (v < 0.005 ? 'off' : Math.round(v * 100) + '%'),
    onInput: (v) => ctx.set({ anatomy: v }), onChange: () => ctx.app.commit('linee anatomiche') });
  const inkBody = h('div', {}, inkWidth, crease, anatomy, h('div', { class: 'pv-slider-head' }, h('span', { class: 'pv-slider-label' }, 'Colore china')), inkColor);
  const inkSec = section('Contorni', [inkToggle, inkBody]);

  // --- joints: dual-quaternion skinning
  const softT = toggle({ label: 'Deformazione morbida', value: S().softSkin !== false, onChange: (v) => ctx.set({ softSkin: v }, { commit: 'deformazione morbida' }) });
  const softNote = h('div', { class: 'pv-note', style: { marginTop: '6px', fontSize: '12px', color: 'var(--muted)' } },
    'Gomiti, polsi, spalle e anche si piegano e ruotano senza strozzature: braccia e gambe mantengono il loro volume.');
  const jointSec = section('Articolazioni', [softT, softNote]);

  // --- background
  const bgCards = cardGrid({
    items: BG_PRESETS.map((p) => ({ id: p.id, label: p.label, thumb: bgThumb(p.bg) })),
    value: null, columns: 3,
    onSelect: (id) => {
      const p = BG_PRESETS.find((x) => x.id === id);
      ctx.set({ bg: { ...p.bg } }, { commit: 'sfondo' });
    },
  });
  const bgPicker = (patch) => ({
    onInput: (c) => ctx.set({ bg: patch(c) }),
    onChange: (c) => ctx.set({ bg: patch(c) }, { commit: 'sfondo' }),
  });
  const bgSolid = swatches({ colors: SOLID_BG, value: null, ...bgPicker((c) => ({ type: 'solid', color: c })) });
  const bgTop = swatches({ colors: [], value: S().bg.top, ...bgPicker((c) => ({ type: 'gradient', top: c })) });
  const bgBottom = swatches({ colors: [], value: S().bg.bottom, ...bgPicker((c) => ({ type: 'gradient', bottom: c })) });
  const gradRow = h('div', { class: 'pv-row', style: { marginTop: '10px' } },
    h('div', { class: 'pv-row', style: { flex: '0 1 auto', gap: '8px' } }, h('span', { class: 'pv-slider-label' }, 'Alto'), bgTop),
    h('div', { class: 'pv-row', style: { flex: '0 1 auto', gap: '8px' } }, h('span', { class: 'pv-slider-label' }, 'Basso'), bgBottom));
  const solidRow = h('div', { style: { marginTop: '10px' } }, bgSolid);
  const transpNote = h('div', { class: 'pv-note', style: { marginTop: '8px', fontSize: '12px', color: 'var(--muted)' } },
    'La scacchiera è solo un’anteprima: le immagini PNG esportate avranno lo sfondo trasparente (ombre comprese).');
  const bgSec = section('Sfondo', [bgCards, solidRow, gradRow, transpNote]);

  // --- scene toggles
  const groundT = toggle({ label: 'Pavimento', value: S().ground, onChange: (v) => ctx.set({ ground: v }, { commit: 'pavimento' }) });
  const gridT = toggle({ label: 'Griglia', value: S().grid, onChange: (v) => ctx.set({ grid: v }, { commit: 'griglia' }) });
  const shadowT = toggle({ label: 'Ombre', value: S().shadows, onChange: (v) => ctx.set({ shadows: v }, { commit: 'ombre' }) });
  const sceneSec = section('Pavimento e ombre', [groundT, gridT, shadowT]);

  // --- quality / performance (device preferences, not part of the scene)
  // 'Auto' follows the device tier (render/device.js); a level picked here is remembered
  const qOpts = [{ value: 'auto', label: 'Auto' }, ...Object.values(QUALITY).map((q) => ({ value: q.id, label: q.label }))];
  const qSeg = segmented({ options: qOpts, value: ctx.getPrefs().quality, onChange: (v) => ctx.setQuality(v) });
  const qInfo = h('div', { style: { fontSize: '12px', color: 'var(--muted)', margin: '8px 0 2px', lineHeight: '1.45' } });
  const dynT = toggle({ label: 'Risoluzione dinamica durante i gesti', value: ctx.getPrefs().dynamic, onChange: (v) => ctx.setPref('dynamic', v) });
  const fpsT = toggle({ label: 'Mostra FPS', value: ctx.getPrefs().fps, onChange: (v) => ctx.setPref('fps', v) });
  const perfSec = section('Qualità e prestazioni', [qSeg, qInfo, dynT, fpsT], { collapsible: true });

  el.append(section('Stile di resa', [styleCards]), lightSec, inkSec, jointSec, bgSec, sceneSec, perfSec);

  function sync() {
    const s = S(), p = ctx.getPrefs(), sr = STYLE_RENDER[s.style];
    styleCards.setValue(s.style);
    // light / AO only where they apply
    lightSec.style.display = sr.exposure ? '' : 'none';
    exposure.setValue(s.exposure);
    aoToggle.setValue(s.ao);
    aoAmount.setValue(s.aoIntensity);
    aoAmount.style.display = s.ao ? '' : 'none';
    const qa = ctx.getQuality?.();
    aoNote.textContent = !s.ao || !qa || qa.ao === 'on' ? ''
      : qa.ao === 'rest' ? `Qualità ${qa.label}: l'occlusione compare quando l'immagine è ferma (gesti più fluidi).`
        : `Qualità ${qa.label}: l'occlusione è calcolata solo nelle immagini esportate.`;
    aoNote.style.display = aoNote.textContent ? '' : 'none';
    // ink
    const inkOn = !!s.outline[s.style];
    inkToggle.setValue(inkOn);
    inkBody.style.display = inkOn ? '' : 'none';
    inkWidth.setValue(s.inkWidth);
    crease.setValue(s.crease);
    anatomy.setValue(s.anatomy ?? 0.3);
    anatomy.style.display = ctx.ANATOMY_LINE_STYLES?.has(s.style) ? '' : 'none';
    // joints
    const sk = ctx.softSkin;
    softT.setValue(s.softSkin !== false && (!sk || sk.supported));
    softT.querySelector('input').disabled = !!sk && !sk.supported;
    softNote.textContent = sk && !sk.supported
      ? 'Non disponibile su questo dispositivo: le articolazioni usano la deformazione lineare.'
      : 'Gomiti, polsi, spalle e anche si piegano e ruotano senza strozzature: braccia e gambe mantengono il loro volume.';
    inkColor.setValue(s.inkColor);
    // background
    const preset = BG_PRESETS.find((x) => sameBg(x.bg, { ...s.bg }));
    bgCards.setValue(preset ? preset.id : null);
    bgSolid.setValue(s.bg.type === 'solid' ? s.bg.color : null);
    solidRow.style.display = s.bg.type === 'solid' ? '' : 'none';
    gradRow.style.display = s.bg.type === 'gradient' ? '' : 'none';
    transpNote.style.display = s.bg.type === 'transparent' ? '' : 'none';
    bgTop.setValue(s.bg.top); bgBottom.setValue(s.bg.bottom);
    // scene
    groundT.setValue(s.ground); gridT.setValue(s.grid); shadowT.setValue(s.shadows);
    // prefs
    qSeg.setValue(p.quality);
    const q = ctx.getQuality ? ctx.getQuality() : QUALITY[p.quality] || QUALITY.alta;
    const dev = ctx.device;
    const pr = ctx.perf ? ctx.perf.basePixelRatio : Math.min(window.devicePixelRatio || 1, q.prCap);
    const W = Math.round((window.innerWidth || 0) * pr), H = Math.round((window.innerHeight || 0) * pr);
    const ao = q.ao === 'rest' ? 'AO a riposo' : q.ao === 'off' ? 'AO solo export' : `AO ${q.aoSamples} campioni`;
    const fps = ctx.app.frameRateCap ? `max ${ctx.app.frameRateCap} fps` : 'fps pieni';
    const rec = dev ? QUALITY[dev.quality]?.label : null;
    const head = p.quality === 'auto'
      ? `Automatica: ${q.label}${dev ? ` (dispositivo di ${ctx.TIER_LABEL?.[dev.tier] || dev.tier})` : ''}`
      : `Scelta manuale: ${q.label}${rec ? ` · consigliata ${rec}` : ''}`;
    qInfo.textContent = `${head}\n${W}×${H} px (${it(pr, 2)}×) · ombre ${q.shadow}px · ${ao} · ${fps}`;
    qInfo.style.whiteSpace = 'pre-line';
    dynT.setValue(p.dynamic); fpsT.setValue(p.fps);
  }
  sync();
  return { sync };
}
