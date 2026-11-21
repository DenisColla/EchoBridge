// "Vestiti" panel: worn items (tap to edit), editor of the selected item
// (color, Vestibilità aderente <-> largo, Pieghe, Togli), catalog by category
// with garment pictograms, quick outfits per style, global wrinkle intensity
// and "Togli tutto".
import { h, section, slider, button, swatches, cardGrid, chips, toast, haptic, icon } from '../ui/kit.js';
import { GARMENT_BY_ID, CATEGORIES, OUTFITS, STYLES, garmentsFor } from './catalog.js';
import { garmentIcon } from './icons.js';
import './clothing.css';

const STYLE_LABEL = new Map(STYLES.map((s) => [s.id, s.label]));
const pct = (v) => Math.round(v * 100) + '%';

export function buildPanel(el, app, shell, mgr) {
  let ch = null;
  let cat = 'top';
  let selected = null; // id of the item being edited
  el.classList.add('pv-clothes');

  // ---------------------------------------------------------------- worn items + editor
  const wornRow = h('div', { class: 'pv-chips pv-clothes-worn' });
  const edName = h('div', { class: 'pv-clothes-edname' });
  const edStyle = h('span', { class: 'pv-clothes-edstyle' });
  let colorEl = h('div');
  const colorHost = h('div', { class: 'pv-clothes-colors' }, colorEl);
  const fitSl = slider({
    label: 'Vestibilità', min: 0, max: 1, step: 0.01, value: 0.5, defaultValue: 0.5,
    format: (v) => (v < 0.2 ? 'Aderente' : v > 0.8 ? 'Largo' : v < 0.4 ? 'Slim' : v > 0.6 ? 'Comodo' : 'Normale'),
    onInput: (v) => schedule(() => ch && selected && mgr.update(ch, selected, { fit: v })),
    onChange: () => { flush(); app.commit('vestibilità'); },
  });
  const fitEnds = h('div', { class: 'pv-clothes-ends' }, h('span', {}, 'Aderente'), h('span', {}, 'Largo'));
  const wrSl = slider({
    label: 'Pieghe', min: 0, max: 2, step: 0.01, value: 1, defaultValue: 1, format: pct,
    onInput: (v) => schedule(() => ch && selected && mgr.update(ch, selected, { wrinkles: v })),
    onChange: () => { flush(); app.commit('pieghe'); },
  });
  const removeBtn = button({ label: 'Togli', icon: 'trash', small: true, variant: 'ghost', onClick: () => {
    if (!ch || !selected) return;
    haptic('light');
    const label = GARMENT_BY_ID.get(selected)?.label;
    mgr.takeOff(ch, selected);
    selected = null;
    app.commit('togli capo');
    toast(`${label} tolto`, { ms: 1600, kind: 'info' });
    refresh();
  } });
  const editor = h('div', { class: 'pv-clothes-editor' },
    h('div', { class: 'pv-clothes-edhead' }, h('div', {}, edName, edStyle), removeBtn),
    colorHost, fitSl, fitEnds, wrSl);

  // ---------------------------------------------------------------- catalog
  const catChips = chips({ items: CATEGORIES.map((c) => ({ id: c.id, label: c.label })), value: cat, onSelect: (id) => { haptic('tick'); cat = id; renderCards(); catChips.setValue(cat); } });
  const cardsHost = h('div', { class: 'pv-clothes-cards' });

  // ---------------------------------------------------------------- outfits + global
  const outfitRow = h('div', { class: 'pv-clothes-outfits' });
  for (const o of OUTFITS) {
    const b = h('button', { type: 'button', class: 'pv-chip pv-clothes-outfit' }, icon(o.id === 'under' ? 'user' : o.id === 'formal' ? 'sparkle' : o.id === 'sport' ? 'pose' : 'shirt', 18), o.label);
    b.addEventListener('click', () => {
      if (!ch) return;
      haptic('light');
      const ids = o.items[ch.sex] || o.items.F;
      // keep colors of items already worn
      const cur = new Map(mgr.items(ch).map((x) => [x.id, x]));
      mgr.setItems(ch, ids.map((id) => cur.get(id) || id));
      selected = ids[0];
      app.commit('outfit');
      toast(`Outfit ${o.label}`, { ms: 1400, kind: 'ok' });
      refresh();
    });
    outfitRow.appendChild(b);
  }
  const globalSl = slider({
    label: 'Pieghe (tutti i capi)', min: 0, max: 2, step: 0.01, value: mgr.intensity, defaultValue: 1, format: pct,
    onInput: (v) => mgr.setIntensity(v),
    onChange: () => app.commit('pieghe globali'),
  });
  const clearBtn = button({ label: 'Togli tutto', icon: 'trash', small: true, variant: 'danger', onClick: () => {
    if (!ch) return;
    haptic('medium');
    const keep = mgr.items(ch).filter((x) => GARMENT_BY_ID.get(x.id).slot === 'underwear');
    mgr.setItems(ch, keep);
    selected = null;
    app.commit('togli tutto');
    toast(keep.length ? 'Resta solo l\'intimo' : 'Tutti i capi tolti', { ms: 1600 });
    refresh();
  } });

  const empty = h('div', { class: 'pv-clothes-empty' }, 'Seleziona un personaggio');
  const wornSection = section('Indossati', [wornRow, editor]);
  el.append(
    empty,
    wornSection,
    section('Aggiungi capi', [catChips, cardsHost]),
    section('Outfit rapidi', [outfitRow]),
    section('Generale', [globalSl, h('div', { class: 'pv-row pv-clothes-actions' }, clearBtn)]),
  );

  // ---------------------------------------------------------------- rendering
  // worn items in reading order: tops, full, bottoms, shoes, socks, underwear
  const SLOT_VIEW = ['outer', 'top', 'full', 'bottom', 'shoes', 'socks', 'underwear'];
  function worn() {
    return ch ? mgr.items(ch).sort((a, b) => SLOT_VIEW.indexOf(GARMENT_BY_ID.get(a.id).slot) - SLOT_VIEW.indexOf(GARMENT_BY_ID.get(b.id).slot)) : [];
  }

  function renderWorn() {
    wornRow.replaceChildren();
    const list = worn();
    if (!list.length) wornRow.appendChild(h('span', { class: 'pv-clothes-none' }, 'Nessun capo: scegli dal catalogo qui sotto'));
    for (const it of list) {
      const def = GARMENT_BY_ID.get(it.id);
      const c = h('button', { type: 'button', class: 'pv-chip pv-clothes-wornchip' + (it.id === selected ? ' active' : '') },
        h('span', { class: 'pv-clothes-dot', style: { background: it.color } }), def.label);
      c.addEventListener('click', () => { haptic('tick'); selected = it.id; refresh(); });
      wornRow.appendChild(c);
      if (it.id === selected) requestAnimationFrame(() => {
        const l = c.offsetLeft - wornRow.offsetLeft, r = l + c.offsetWidth;
        if (l < wornRow.scrollLeft) wornRow.scrollLeft = l - 12;
        else if (r > wornRow.scrollLeft + wornRow.clientWidth) wornRow.scrollLeft = r - wornRow.clientWidth + 12;
      });
    }
  }

  function renderEditor() {
    const it = worn().find((x) => x.id === selected);
    editor.style.display = it ? '' : 'none';
    if (!it) return;
    const def = GARMENT_BY_ID.get(it.id);
    edName.textContent = def.label;
    edStyle.textContent = def.styles.map((s) => STYLE_LABEL.get(s)).join(' · ');
    const pal = def.palette || [];
    const colors = pal.includes(def.color) ? pal : [def.color, ...pal].slice(0, 9);
    const sw = swatches({ colors, value: it.color, onChange: (c) => { if (!ch) return; mgr.update(ch, it.id, { color: c }); scheduleCommit('colore'); renderWorn(); renderCards(); } });
    colorHost.replaceChildren(sw);
    colorEl = sw;
    fitSl.setValue(it.fit ?? 0.5);
    wrSl.setValue(it.wrinkles ?? 1);
    // fit makes no sense for shoes / socks / underwear: keep the slider but dim it
    const fixed = ['shoes', 'socks', 'underwear'].includes(def.slot) || def.id === 'leggings' || def.id === 'sporttop';
    fitSl.classList.toggle('pv-clothes-dim', fixed);
    fitEnds.classList.toggle('pv-clothes-dim', fixed);
  }

  function renderCards() {
    cardsHost.replaceChildren();
    if (!ch) return;
    const list = garmentsFor(ch.sex, cat);
    const wornMap = new Map(worn().map((x) => [x.id, x]));
    const items = list.map((g) => {
      const w = wornMap.get(g.id);
      return { id: g.id, label: g.label, thumb: garmentIcon(g.icon || g.id, w ? w.color : '#5d6270', w ? '#ffffff' : '#c3c8d4'), badge: w ? '✓' : '' };
    });
    if (cat === 'under') items.push({ id: '__nounder', label: 'Nessun intimo', thumb: garmentIcon('none', 'none', '#c3c8d4') });
    const grid = cardGrid({
      items, columns: shell.mode === 'side' ? 3 : 4, value: [...wornMap.keys()],
      onSelect: (id) => {
        if (!ch) return;
        haptic('tick');
        if (id === '__nounder') {
          const u = worn().find((x) => GARMENT_BY_ID.get(x.id).slot === 'underwear');
          if (u) { mgr.takeOff(ch, u.id); app.commit('nessun intimo'); }
          selected = null; refresh(); return;
        }
        if (wornMap.has(id)) { selected = id; refresh(); return; }
        const def = GARMENT_BY_ID.get(id);
        const replaced = worn().filter((x) => {
          const s = GARMENT_BY_ID.get(x.id).slot;
          return s === def.slot || (def.slot === 'full' && (s === 'top' || s === 'bottom')) || ((def.slot === 'top' || def.slot === 'bottom') && s === 'full');
        });
        mgr.wear(ch, id);
        selected = id;
        app.commit('indossa ' + def.label);
        if (replaced.length) toast(`${def.label} al posto di ${replaced.map((x) => GARMENT_BY_ID.get(x.id).label).join(' e ')}`, { ms: 1800 });
        refresh();
      },
    });
    grid.classList.add('pv-clothes-grid');
    cardsHost.appendChild(grid);
  }

  function refresh() {
    ch = app.selection.character || app.characters[0] || null;
    empty.style.display = ch ? 'none' : '';
    for (const s of el.querySelectorAll('.pv-section')) s.style.display = ch ? '' : 'none';
    if (!ch) return;
    const list = worn();
    if (selected && !list.some((x) => x.id === selected)) selected = null;
    if (!selected && list.length) selected = list[0].id;
    renderWorn();
    renderEditor();
    renderCards();
    catChips.setValue(cat);
    globalSl.setValue(mgr.intensity);
  }

  // slider drags: one rebuild per animation frame; flush() applies the last
  // value synchronously (the slider 'change' commits right after)
  let pending = null;
  function schedule(fn) {
    const first = !pending;
    pending = fn;
    if (first) requestAnimationFrame(flush);
  }
  function flush() { const f = pending; pending = null; f?.(); }
  let commitTimer = 0;
  function scheduleCommit(label) { clearTimeout(commitTimer); commitTimer = setTimeout(() => app.commit(label), 350); }

  const visible = () => shell.activeToolId === 'clothes';
  app.addEventListener('selection', () => { if (visible()) refresh(); });
  app.addEventListener('loaded', () => { if (visible()) refresh(); });
  app.addEventListener('characters', () => { if (visible()) refresh(); });
  mgr.addEventListener('intensity', () => globalSl.setValue(mgr.intensity));
  mgr.addEventListener('change', (e) => { if (visible() && e.character === ch && !pending) { renderWorn(); renderCards(); } });

  return { onShow: refresh };
}
