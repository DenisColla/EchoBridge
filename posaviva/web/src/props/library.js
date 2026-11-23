// "Oggetti" library: browses hundreds of prop types.
//   search field (Italian names, tags, category names; accent-insensitive)
//   category chips (+ Preferiti, Recenti) and sub-category chips
//   card grid with lazy thumbnails (rendered / loaded only when visible)
//   star on each card = favorite; long press = menu (aggiungi, preferito)
//   "Stanze pronte": furnished room presets added as groups of props
// Favorites, recents and the last category are per-device conveniences
// (localStorage, best effort).
import { h, toast, haptic, sheetMenu } from '../ui/kit.js';
import { CATEGORIES, PROP_TYPES, onPropTypesChanged } from './catalog.js';
import { ROOM_PRESETS } from './gen/rooms.js';

const LS_FAV = 'posaviva.props.fav', LS_RECENT = 'posaviva.props.recent', LS_CAT = 'posaviva.props.cat';
const MAX_RECENT = 24;

const load = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? def; } catch { return def; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const norm = (s) => (Array.isArray(s) ? s.join(' ') : String(s ?? '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');

const SVG = {
  search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  clear: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3.2l2.6 5.6 6.1.7-4.5 4.2 1.2 6.1L12 16.8l-5.4 3 1.2-6.1-4.5-4.2 6.1-.7z" fill="currentColor"/></svg>',
  starO: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3.2l2.6 5.6 6.1.7-4.5 4.2 1.2 6.1L12 16.8l-5.4 3 1.2-6.1-4.5-4.2 6.1-.7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
};
const svg = (name) => { const s = document.createElement('span'); s.className = 'pv-pr-svg'; s.innerHTML = SVG[name]; return s; };

/**
 * Builds the library UI. opts: {thumbs, onAdd(typeId), onAddPreset(preset), panelBody}
 * Returns {el, refresh(), markRecent(id)}.
 */
export function buildLibrary({ thumbs, onAdd, onAddPreset, panelBody }) {
  let fav = new Set(load(LS_FAV, []));
  let recent = load(LS_RECENT, []);
  let cat = load(LS_CAT, null);
  let subId = 'all';
  let query = '';

  const el = h('div', { class: 'pv-pr-catalog' });
  // ---- search
  const input = h('input', { type: 'search', class: 'pv-pr-search-input', placeholder: 'Cerca oggetti (es. sedia, lampada, gatto)…', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false' });
  const clearBtn = h('button', { type: 'button', class: 'pv-pr-search-clear', title: 'Cancella', 'aria-label': 'Cancella ricerca' }, svg('clear'));
  const search = h('div', { class: 'pv-pr-search' }, svg('search'), input, clearBtn);
  const catChips = h('div', { class: 'pv-chips pv-pr-cats' });
  const subChips = h('div', { class: 'pv-chips pv-pr-subs' });
  const info = h('div', { class: 'pv-pr-note pv-pr-info' });
  const grid = h('div', { class: 'pv-cards pv-pr-grid', style: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } });
  const empty = h('div', { class: 'pv-pr-empty' });
  el.append(search, catChips, subChips, info, grid, empty);

  let timer = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { query = input.value.trim(); clearBtn.style.visibility = query ? 'visible' : 'hidden'; renderGrid(); renderChips(); }, 140);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  clearBtn.style.visibility = 'hidden';
  clearBtn.addEventListener('click', () => { input.value = ''; query = ''; clearBtn.style.visibility = 'hidden'; renderGrid(); renderChips(); });

  // ---- lazy thumbnails
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { thumbs.request(e.target); io.unobserve(e.target); } }, { root: panelBody || null, rootMargin: '160px 0px' })
    : null;
  const lazy = (thumbEl) => { if (io) io.observe(thumbEl); else thumbs.request(thumbEl); return thumbEl; };

  const visibleCats = () => CATEGORIES.filter((c) => !c.ownTool && (c.presets || PROP_TYPES.some((t) => t.cat === c.id)));
  const typesOf = (cid) => PROP_TYPES.filter((t) => t.cat === cid);
  const byId = (id) => PROP_TYPES.find((t) => t.id === id);

  function current() {
    const cats = visibleCats();
    if (cat === 'fav' && fav.size) return 'fav';
    if (cat === 'recent' && recent.length) return 'recent';
    if (cats.some((c) => c.id === cat)) return cat;
    return recent.length ? 'recent' : cats[0]?.id;
  }

  function renderChips() {
    catChips.innerHTML = '';
    const cur = current();
    const add = (id, label, extra) => {
      const c = h('button', { type: 'button', class: 'pv-chip' + (!query && id === cur ? ' active' : '') }, extra || null, label);
      c.addEventListener('click', () => {
        if (query) { input.value = ''; query = ''; clearBtn.style.visibility = 'hidden'; }
        cat = id; subId = 'all'; save(LS_CAT, cat);
        renderChips(); renderGrid();
        panelBody && (panelBody.scrollTop = 0);
      });
      catChips.appendChild(c);
      return c;
    };
    if (fav.size) add('fav', 'Preferiti', svg('star'));
    if (recent.length) add('recent', 'Recenti');
    for (const c of visibleCats()) add(c.id, c.label);
    // keep the active chip in view
    requestAnimationFrame(() => catChips.querySelector('.active')?.scrollIntoView?.({ block: 'nearest', inline: 'center' }));
    // sub-categories
    subChips.innerHTML = '';
    const c = CATEGORIES.find((x) => x.id === cur);
    const subs = !query && c?.subs ? c.subs.filter((s) => typesOf(c.id).some((t) => t.sub === s.id)) : [];
    subChips.style.display = subs.length > 1 ? '' : 'none';
    if (subs.length > 1) {
      for (const s of [{ id: 'all', label: 'Tutto' }, ...subs]) {
        const b = h('button', { type: 'button', class: 'pv-chip small' + (s.id === subId ? ' active' : '') }, s.label);
        b.addEventListener('click', () => { subId = s.id; renderChips(); renderGrid(); });
        subChips.appendChild(b);
      }
    }
  }

  function items() {
    if (query) {
      const words = norm(query).split(/\s+/).filter(Boolean);
      const catLabel = new Map(CATEGORIES.map((c) => [c.id, c]));
      const scored = [];
      for (const t of PROP_TYPES) {
        const c = catLabel.get(t.cat);
        if (!c || c.ownTool) continue;
        const subLabel = c.subs?.find((s) => s.id === t.sub)?.label || '';
        const label = norm(t.label), hay = `${label} ${norm(t.tags)} ${norm(c.label)} ${norm(subLabel)}`;
        if (!words.every((w) => hay.includes(w))) continue;
        let score = 0;
        for (const w of words) { if (label.startsWith(w)) score += 3; else if (label.includes(w)) score += 2; else score += 0.5; }
        scored.push([score, t]);
      }
      for (const p of ROOM_PRESETS) {
        const hay = norm(`${p.label} stanza ${p.tags}`);
        if (words.every((w) => hay.includes(w))) scored.push([2.5, { preset: p }]);
      }
      scored.sort((a, b) => b[0] - a[0]);
      return scored.map((x) => x[1]);
    }
    const cur = current();
    if (cur === 'fav') return [...fav].map(byId).filter(Boolean);
    if (cur === 'recent') return recent.map((id) => (id.startsWith('preset:') ? { preset: ROOM_PRESETS.find((p) => `preset:${p.id}` === id) } : byId(id))).filter((x) => x && (x.preset || x.id));
    const c = CATEGORIES.find((x) => x.id === cur);
    if (c?.presets) return ROOM_PRESETS.map((p) => ({ preset: p }));
    let list = typesOf(cur);
    // "In mano" also lists the hand-held items of the other categories (bottle, glass, guitar…)
    if (cur === 'mano') list = [...list, ...PROP_TYPES.filter((t) => t.hand && !t.hand.carry && t.cat !== 'mano' && CATEGORIES.some((c) => c.id === t.cat && !c.ownTool))];
    if (subId !== 'all') list = list.filter((t) => t.sub === subId);
    // parametric (procedural) items first inside a sub-category: they have the most options
    return list;
  }

  function card(t) {
    if (t.preset) {
      const p = t.preset;
      const visual = lazy(thumbs.presetCanvas(p));
      const c = h('button', { type: 'button', class: 'pv-card pv-pr-card pv-pr-preset' }, h('div', { class: 'pv-card-visual' }, visual), h('span', { class: 'pv-card-label' }, p.label));
      c.addEventListener('click', () => { haptic(12); pushRecent(`preset:${p.id}`); onAddPreset(p); });
      return c;
    }
    const visual = lazy(thumbs.elementFor(t, { lazy: true }));
    const star = h('span', { class: 'pv-pr-star' + (fav.has(t.id) ? ' on' : ''), role: 'button', 'aria-label': 'Preferito' }, svg(fav.has(t.id) ? 'star' : 'starO'));
    const badge = t.params?.some((d) => d.type === 'seed') ? h('span', { class: 'pv-pr-badge', title: 'Varianti casuali' }, '∞')
      : !t.model && t.params?.length ? h('span', { class: 'pv-pr-badge', title: 'Modificabile' }, '⚙') : null;
    const c = h('button', { type: 'button', class: 'pv-card pv-pr-card' }, h('div', { class: 'pv-card-visual' }, visual), h('span', { class: 'pv-card-label' }, t.label), star, badge);
    c.dataset.id = t.id;
    let longPress = 0, pressed = false;
    c.addEventListener('pointerdown', () => { pressed = false; longPress = setTimeout(() => { pressed = true; haptic(15); menu(t, c); }, 520); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) c.addEventListener(ev, () => clearTimeout(longPress));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('click', (e) => {
      if (pressed) { pressed = false; return; }
      if (e.target.closest('.pv-pr-star')) { toggleFav(t.id); return; }
      haptic(12);
      pushRecent(t.id);
      onAdd(t.id);
    });
    return c;
  }

  async function menu(t, anchor) {
    const isFav = fav.has(t.id);
    const id = await sheetMenu([
      { header: t.label },
      { id: 'add', label: 'Aggiungi alla scena', icon: 'plus' },
      { id: 'fav', label: isFav ? 'Togli dai preferiti' : 'Aggiungi ai preferiti', icon: 'heart' },
    ], { title: t.label, anchor });
    if (id === 'add') { pushRecent(t.id); onAdd(t.id); }
    else if (id === 'fav') toggleFav(t.id);
  }

  function toggleFav(id) {
    if (fav.has(id)) fav.delete(id); else fav.add(id);
    save(LS_FAV, [...fav]);
    haptic(8);
    const on = fav.has(id);
    for (const s of grid.querySelectorAll(`.pv-pr-card[data-id="${CSS.escape(id)}"] .pv-pr-star`)) { s.classList.toggle('on', on); s.replaceChildren(svg(on ? 'star' : 'starO')); }
    toast(on ? 'Aggiunto ai preferiti' : 'Tolto dai preferiti', 1200);
    renderChips();
    if (current() === 'fav' && !query) renderGrid();
  }

  function pushRecent(id) {
    recent = [id, ...recent.filter((x) => x !== id)].slice(0, MAX_RECENT);
    save(LS_RECENT, recent);
  }

  function renderGrid() {
    if (io) io.disconnect();
    grid.innerHTML = '';
    const list = items();
    const frag = document.createDocumentFragment();
    for (const t of list) frag.appendChild(card(t));
    grid.appendChild(frag);
    const cur = current();
    if (query) info.textContent = list.length ? `${list.length} risultati per “${query}”` : '';
    else if (CATEGORIES.find((c) => c.id === cur)?.presets) info.textContent = 'Stanze arredate pronte: ogni mobile resta un oggetto che puoi spostare e modificare.';
    else if (cur === 'mano') info.textContent = 'Vanno direttamente nella mano libera del personaggio selezionato.';
    else info.textContent = `${list.length} oggetti · tocca per aggiungere, ★ per i preferiti`;
    empty.textContent = list.length ? '' : query ? `Nessun oggetto trovato per “${query}”.` : 'Nessun oggetto.';
    empty.style.display = list.length ? 'none' : '';
  }

  function refresh() { renderChips(); renderGrid(); }
  onPropTypesChanged(() => { if (el.isConnected) refresh(); });
  refresh();
  return { el, refresh, markRecent: pushRecent };
}
