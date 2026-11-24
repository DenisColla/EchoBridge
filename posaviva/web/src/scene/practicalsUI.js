// UI of the practical lights: the controls of a light source (long-press menu
// of an object, objects workstream: app.practicals.menuSection(prop)), the
// "Luce ambientale" menu (long press on an empty spot of the view) and the
// "Fonti nella scena" section of the Luci panel.
import { h, slider, toggle, swatches, stageMenu, button, haptic, icon } from '../ui/kit.js';
import { AMBIENT_PRESETS } from './lightPresets.js';
import { svgIcon, LIGHT_ICONS } from './svg.js';

/** pictograms of the ambient presets and of the windows (same stroke style as ui/icons.js) */
export const PL_ICONS = {
  giorno: LIGHT_ICONS.sun,
  tramonto: '<path d="M3 18h18M6 14.5a6 6 0 0 1 12 0"/><path d="M12 4.5v2.5M4.6 8.1l1.7 1.7M19.4 8.1l-1.7 1.7M5 21.5h14"/>',
  notte: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/><path d="M17 3.5v3M15.5 5h3"/>',
  studio: LIGHT_ICONS.point,
  window: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M12 3v18M4 11.5h16"/>',
};

const MODE_OPTS = [
  { value: 'auto', label: 'Auto' }, { value: 'giorno', label: 'Giorno' }, { value: 'tramonto', label: 'Tramonto' },
  { value: 'notte', label: 'Notte' }, { value: 'chiusa', label: 'Chiusa' },
];
const MODE_LABEL = { giorno: 'Giorno', tramonto: 'Tramonto', notte: 'Notte', chiusa: 'Chiusa' };
/** pictograms of the window modes (Auto follows the time of day of the scene; Chiusa: shutters) */
const WIN_ICONS = {
  auto: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/><path d="M17 3h4v4"/>',
  giorno: PL_ICONS.giorno, tramonto: PL_ICONS.tramonto, notte: PL_ICONS.notte,
  chiusa: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 7.5h16M4 12h16M4 16.5h16"/>',
};
/** colour choices of a lamp: default (its own colour temperature) + candle, warm, neutral, cool, coloured gels */
const LAMP_COLORS = ['#ffb067', '#ffd6a0', '#fff4e5', '#d6e6ff', '#ff5d8f', '#5ab8ff', '#7dff9a'];
const pct = (v) => `${Math.round(v * 100)}%`;

function subtitleOf(pr, prop) {
  const st = pr.state(prop);
  if (!st) return '';
  if (st.kind === 'window') return `${MODE_LABEL[st.mode] || st.mode}${st.setting === 'auto' ? ' (automatica)' : ''} · ${pct(st.intensity)}`;
  const solo = pr.mode === 'solo' && pr.soloId === prop.id;
  return `${st.on ? 'Accesa' : 'Spenta'} · ${pct(st.intensity)}${solo ? ' · da sola' : ''}`;
}

/**
 * Controls of one source for a stage menu: {body, items}. The body keeps itself in sync
 * with the state (slider drags are live and record one undo step on release).
 */
export function buildMenuSection(pr, prop, opts = {}) {
  if (!pr.isSource(prop)) return { body: null, items: [] };
  const app = pr.app;
  const st0 = pr.state(prop);
  const win = st0.kind === 'window';
  const parts = [];
  let modeSeg = null, onT = null, sw = null, colorsRow = null;
  const inten = slider({
    label: 'Intensità', min: 0, max: 2, step: 0.01, value: st0.intensity, defaultValue: 1, format: pct,
    onInput: (v) => pr.set(prop, { intensity: v }, false),
    onChange: () => app.commit('intensità luce'),
  });
  if (win) {
    // one row of pictograms (the light that comes in: a time of day, or closed shutters)
    modeSeg = h('div', { class: 'pv-pl-wmodes', role: 'radiogroup', 'aria-label': 'Luce dalla finestra' });
    for (const o of MODE_OPTS) {
      const b = h('button', { type: 'button', class: 'pv-pl-wmode', title: o.label, 'data-value': o.value }, svgIcon(WIN_ICONS[o.value], 20), h('span', {}, o.label));
      b.addEventListener('click', () => { modeSeg.setValue(o.value); pr.set(prop, { mode: o.value }, 'luce finestra'); haptic('tick'); });
      modeSeg.appendChild(b);
    }
    modeSeg.setValue = (v) => { for (const b of modeSeg.children) b.classList.toggle('active', b.dataset.value === v); };
    modeSeg.setValue(st0.setting);
    parts.push(h('div', { class: 'pv-pl-label' }, 'Luce dalla finestra'), modeSeg, inten);
  } else {
    // switch and intensity on one row; the colours behind "Colore…" (the card stays short)
    onT = toggle({ label: 'Accesa', value: st0.on, onChange: (v) => { pr.set(prop, { on: v }, v ? 'accendi luce' : 'spegni luce'); haptic('tick'); } });
    parts.push(h('div', { class: 'pv-pl-line' }, onT, inten));
    if (!opts.compact) {
      sw = swatches({
        colors: LAMP_COLORS, value: st0.customColor ? st0.color : null,
        onInput: (c) => pr.set(prop, { color: c }, false),
        onChange: (c) => pr.set(prop, { color: c }, 'colore luce'),
      });
      const reset = h('button', { type: 'button', class: 'pv-pl-reset', title: 'Colore originale' }, 'Originale');
      reset.addEventListener('click', () => { pr.set(prop, { color: null }, 'colore luce'); haptic('tick'); });
      colorsRow = h('div', { class: 'pv-pl-colors', hidden: true }, sw, reset);
      const more = h('button', { type: 'button', class: 'pv-pl-more' }, icon('palette', 16), h('span', {}, 'Colore…'));
      more.addEventListener('click', () => { colorsRow.hidden = !colorsRow.hidden; more.classList.toggle('open', !colorsRow.hidden); haptic('tick'); });
      parts.push(more, colorsRow);
    }
  }
  // a source over the device's light budget lights nothing: say so (a touch device has no tooltips)
  const warn = h('div', { class: 'pv-pl-warn', hidden: true }, icon('warning', 16), h('span', {}, 'Troppe luci accese: questa non illumina. Spegnine un\'altra o usa «Accendi solo questa».'));
  parts.push(warn);
  const body = h('div', { class: 'pv-pl-section' + (win ? ' win' : '') }, parts);
  const culled = () => !!pr.sources().find((x) => x.prop === prop)?.culled;
  const refresh = () => {
    if (!body.isConnected && body._seen) { pr.removeEventListener('change', refresh); return; }
    if (body.isConnected) body._seen = true;
    const st = pr.state(prop);
    if (!st) return;
    onT?.setValue(st.on);
    modeSeg?.setValue(st.setting);
    if (document.activeElement !== inten.input) inten.setValue(st.intensity);
    sw?.setValue(st.customColor ? st.color : null);
    warn.hidden = !culled();
    // the menu's own items follow too (Accendi solo questa / Combina…: their check marks)
    const card = body.closest('.pv-stage-menu');
    if (card) {
      card.querySelector('[data-id="pl-solo"]')?.classList.toggle('checked', pr.mode === 'solo' && pr.soloId === prop.id);
      card.querySelector('[data-id="pl-mix"]')?.classList.toggle('checked', pr.mode === 'mix' && st.on);
    }
    opts.onRefresh?.(st);
  };
  pr.addEventListener('change', refresh);
  // the light assignment runs on the next frame: the culled note after it
  requestAnimationFrame(() => requestAnimationFrame(refresh));
  const solo = pr.mode === 'solo' && pr.soloId === prop.id;
  const items = [
    { id: 'pl-solo', label: win ? 'Solo la luce della finestra' : 'Accendi solo questa', icon: 'bulb', checked: solo, checkable: true, hint: 'Lo studio resta come un riempimento debole', onClick: () => pr.solo(prop) },
    { id: 'pl-mix', label: 'Combina con la luce di studio', icon: 'sun', checked: pr.mode === 'mix' && st0.on, checkable: true, onClick: () => pr.mix(prop) },
  ];
  return { body, items, refresh };
}

/** Stage menu of a source (fallback when no other module handles the long press on it). */
export function openPracticalMenu(pr, prop, x, y) {
  const app = pr.app;
  let m = null;
  const sec = buildMenuSection(pr, prop, { onRefresh: () => { const s = m?.card.querySelector('.pv-modal-subtitle'); if (s) s.textContent = subtitleOf(pr, prop); } });
  m = stageMenu([...sec.items, { separator: true }, { id: 'pl-panel', label: 'Pannello Luci', icon: 'sliders', onClick: () => app.shell?.openTool('lights') }], {
    x, y, title: pr.state(prop).label, subtitle: subtitleOf(pr, prop), body: sec.body, width: 300,
  });
  return m;
}

// ============================================================================= ambient light
const AMB = [
  { id: 'giorno', label: 'Giorno', time: 'mattino', preset: 'day' },
  { id: 'tramonto', label: 'Tramonto', time: 'tramonto', preset: 'sunset' },
  { id: 'notte', label: 'Notte', time: 'notte', preset: 'night' },
  { id: 'studio', label: 'Studio', time: null, preset: 'studio' },
];

/** Which ambient preset is on now (landscape time or rig preset). */
function currentAmbient(pr) {
  const L = pr.app.landscapes?.current;
  const pre = pr.rig.state.preset;
  if (pre === 'studio') return 'studio';
  if (L?.resolved?.time) {
    const t = L.resolved.time;
    return t === 'tramonto' || t === 'alba' ? 'tramonto' : t === 'sera' || t === 'notte' ? 'notte' : 'giorno';
  }
  return pre === 'day' ? 'giorno' : pre === 'sunset' ? 'tramonto' : pre === 'night' ? 'notte' : null;
}

/** Applies an ambient preset: landscape atmosphere when a landscape is active, else a rig preset. One undo step. */
export function applyAmbient(pr, id) {
  const app = pr.app, a = AMB.find((x) => x.id === id);
  if (!a) return Promise.resolve();
  return app.history.batch('luce ambientale', () => {
    const L = app.landscapes;
    if (a.time && L?.current && L.setAtmosphere) L.setAtmosphere({ time: a.time });
    else if (a.preset === 'day') pr.rig.applyPresetDef(AMBIENT_PRESETS.find((p) => p.id === 'day'));
    else pr.rig.applyPreset(a.preset);
    // the windows show that time of day (a window set by hand to Giorno / Tramonto / Notte follows
    // again; a closed one stays closed)
    for (const s of pr.sources()) if (s.kind === 'window' && s.state.setting !== 'auto' && s.state.setting !== 'chiusa') pr.set(s.prop, { mode: 'auto' }, false);
    app.commit('luce ambientale');
  });
}

/** "Luce ambientale" popover at (x, y): presets, intensity, warm / cool, scene lights only. */
export function openAmbientMenu(pr, x, y) {
  const app = pr.app, rig = pr.rig;
  const chips = h('div', { class: 'pv-pl-amb' });
  const btns = AMB.map((a) => {
    const b = h('button', { type: 'button', class: 'pv-chip pv-pl-amb-btn' }, svgIcon(PL_ICONS[a.id], 20), h('span', {}, a.label));
    b.dataset.id = a.id;
    b.addEventListener('click', async () => { haptic('tick'); await applyAmbient(pr, a.id); sync(); });
    chips.appendChild(b);
    return b;
  });
  const level = slider({
    label: 'Intensità', min: 0, max: 2, step: 0.01, value: rig.state.level ?? 1, defaultValue: 1, format: pct,
    onInput: (v) => rig.setLevel(v, { live: true }), onChange: () => rig.endLive('luce ambientale'),
  });
  const tint = slider({
    label: 'Calda · Fredda', min: -1, max: 1, step: 0.01, value: rig.state.tint ?? 0, defaultValue: 0, center: true,
    format: (v) => (Math.abs(v) < 0.03 ? 'neutra' : v < 0 ? `calda ${Math.round(-v * 100)}%` : `fredda ${Math.round(v * 100)}%`),
    onInput: (v) => rig.setTint(v, { live: true }), onChange: () => rig.endLive('luce ambientale'),
  });
  tint.classList.add('pv-sc-kelvin');
  tint.input.style.setProperty('--kgrad', 'linear-gradient(90deg, #ffb469, #f2efe8 50%, #9cc4ff)');
  const only = toggle({ label: 'Solo luci della scena', value: pr.sceneOnly, onChange: (v) => { pr.setSceneOnly(v); haptic('tick'); sync(); } });
  const note = h('div', { class: 'pv-pl-note' });
  const body = h('div', { class: 'pv-pl-section' }, chips, level, tint, only, note);
  const sync = () => {
    const sub = m?.card?.querySelector('.pv-modal-subtitle');
    if (sub) sub.textContent = ambientSubtitle();
    const n = pr.sources().length;
    note.textContent = n ? `${n} ${n === 1 ? 'fonte' : 'fonti'} nella scena (lampade, finestre…)` : 'Nessuna lampada o finestra nella scena: con «Solo luci della scena» resta solo un riempimento debole.';
    const cur = currentAmbient(pr);
    for (const b of btns) b.classList.toggle('active', b.dataset.id === cur);
    if (document.activeElement !== level.input) level.setValue(rig.state.level ?? 1);
    if (document.activeElement !== tint.input) tint.setValue(rig.state.tint ?? 0);
    only.setValue(pr.sceneOnly);
  };
  let m = null;
  sync();
  const onRig = (e) => { if (e.what !== 'live') sync(); };
  rig.addEventListener('change', onRig);
  pr.addEventListener('change', sync);
  // what is on now, in words (the Studio chip is one of the choices: never "Luce di studio" while Notte is on)
  const ambientSubtitle = () => {
    const cur = AMB.find((a) => a.id === currentAmbient(pr));
    const base = app.landscapes?.current ? 'Segue il paesaggio' : 'Senza paesaggio';
    return pr.sceneOnly ? `${base} · solo luci della scena` : cur ? `${base} · ${cur.label}` : base;
  };
  m = stageMenu([{ id: 'pl-panel', label: 'Pannello Luci', icon: 'sliders', onClick: () => app.shell?.openTool('lights') }], {
    x, y, title: 'Luce ambientale', subtitle: ambientSubtitle(), body, width: 312,
    onClose: () => { rig.removeEventListener('change', onRig); pr.removeEventListener('change', sync); },
  });
  return m;
}

// ============================================================================= Luci panel section
/** "Fonti nella scena": every practical with switch + intensity (windows: mode). Returns {el, refresh}. */
export function buildSourcesSection(app, pr) {
  const list = h('div', { class: 'pv-pl-list' });
  const only = toggle({ label: 'Solo luci della scena', value: pr.sceneOnly, onChange: (v) => { pr.setSceneOnly(v); haptic('tick'); } });
  const empty = h('div', { class: 'pv-pl-empty' },
    h('div', { class: 'pv-sc-note' }, 'Lampade, candele, schermi, lampioni e finestre della scena fanno luce davvero. Tieni premuto su uno spazio vuoto per la luce ambientale.'),
    button({ label: 'Aggiungi una lampada', icon: 'bulb', small: true, onClick: () => {
      const p = app.props?.add?.('lampada_terra', { near: app.selection.character, select: false });
      if (p) { app.commit('aggiungi lampada'); haptic('tick'); }
    } }));
  const el = h('div', { class: 'pv-pl-sources' }, only, list, empty);
  let key = '';
  const rows = new Map();
  function build() {
    const srcs = pr.sources();
    const k = srcs.map((s) => s.prop.id + s.kind).join();
    if (k === key) return false;
    key = k;
    list.innerHTML = '';
    rows.clear();
    const counts = {};
    for (const s of srcs) {
      const p = s.prop;
      const name = s.state.label;
      counts[name] = (counts[name] || 0) + 1;
      const title = h('button', { type: 'button', class: 'pv-pl-name', title: 'Seleziona' }, s.kind === 'window' ? svgIcon(PL_ICONS.window, 18) : icon('bulb', 18), h('span', {}, `${name} ${counts[name]}`));
      title.addEventListener('click', () => { app.props?.select?.(p); haptic('tick'); });
      const sec = buildMenuSection(pr, p, { compact: true });
      const solo = h('button', { type: 'button', class: 'pv-pl-solo', title: 'Accendi solo questa' }, 'Solo');
      solo.addEventListener('click', () => { if (pr.mode === 'solo' && pr.soloId === p.id) pr.mix(p); else pr.solo(p); haptic('tick'); });
      const row = h('div', { class: 'pv-pl-row' }, h('div', { class: 'pv-pl-head' }, title, solo), sec.body);
      rows.set(p, { row, solo, title, sec });
      list.appendChild(row);
    }
    return true;
  }
  function refresh() {
    build();
    const srcs = pr.sources();
    empty.style.display = srcs.length ? 'none' : '';
    only.style.display = srcs.length ? '' : 'none';
    only.setValue(pr.sceneOnly);
    for (const s of srcs) {
      const r = rows.get(s.prop);
      if (!r) continue;
      r.solo.classList.toggle('active', pr.mode === 'solo' && pr.soloId === s.prop.id);
      r.row.classList.toggle('off', !s.state.on);
      r.row.classList.toggle('culled', s.culled);
      r.title.title = 'Seleziona';
    }
  }
  return { el, refresh };
}
