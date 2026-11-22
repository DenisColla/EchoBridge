// UI of the projects module (loaded on first use / when the app is idle):
//   openBrowser   "Progetti": projects with covers -> a project's sections and items
//                 (thumbnails, type filter, search), item actions (Apri / Applica / Inserisci…)
//   openSaveSheet "Salva in…": what (scena / paesaggio / personaggio / posa), name,
//                 project, section (new project / section inline)
//   pickTarget    project + section picker ("Sposta in…")
import './projects.css';
import { h, icon, iconButton, button, segmented, toast, haptic, modal, confirmDialog, promptDialog, sheetMenu } from '../ui/kit.js';
import { ITEM_TYPES, TYPE_BY_ID, SECTION_KINDS, KIND_BY_ID, norm } from './store.js';
import { viewThumb, subjectThumb } from './capture.js';
import { landscapeData, landscapeMeta } from './items.js';
import { formatDate } from '../io/sheets.js';
import { formatBytes } from '../io/storage.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const kindLabel = (k) => KIND_BY_ID.get(k)?.label || 'Sezione';
const errText = (e) => e?.message || String(e || 'errore');

/** Small round badge with the icon of an item type. */
function typeBadge(type, size = 13) {
  const t = TYPE_BY_ID.get(type);
  return h('span', { class: `pv-pj-type t-${type}`, title: t?.label || '' }, icon(t?.icon || 'file', size));
}

function emptyState(ic, title, text, ...extra) {
  return h('div', { class: 'pv-pj-empty' }, icon(ic, 34), h('strong', {}, title), text ? h('span', {}, text) : null, ...extra);
}

// ================================================================= target picker
/**
 * Project + section chooser (chips, with "+ Nuovo" / "+ Nuova sezione" inline).
 * init: {projectId, sectionId}. -> {el, get value() {projectId, sectionId}, onChange}
 */
function targetPicker(ctx, init = {}) {
  const P = ctx.api;
  let projectId = P.get(init.projectId) ? init.projectId : P.current?.id || P.list()[0]?.id;
  let sectionId = init.sectionId !== undefined ? init.sectionId : (projectId === P.current?.id ? P.currentSection?.id || null : null);
  const api = { onChange: null };

  const projChips = h('div', { class: 'pv-chips pv-pj-chips' });
  const secChips = h('div', { class: 'pv-chips pv-pj-chips' });

  // inline "new project"
  const projInput = h('input', { type: 'text', class: 'pv-input', placeholder: 'Nome del fumetto', maxlength: 60, enterkeyhint: 'done', autocomplete: 'off' });
  const projCreate = button({ label: 'Crea', variant: 'primary', small: true, onClick: () => createProject() });
  const projNew = h('div', { class: 'pv-pj-inline', hidden: true }, projInput, projCreate);
  projInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createProject(); } });

  // inline "new section": kind + name
  let secKind = 'tavola', secNameEdited = false;
  const secInput = h('input', { type: 'text', class: 'pv-input', maxlength: 60, enterkeyhint: 'done', autocomplete: 'off' });
  const kindSeg = segmented({ options: SECTION_KINDS.map((k) => ({ value: k.id, label: k.label })), value: secKind, onChange: (v) => { haptic('tick'); secKind = v; if (!secNameEdited) secInput.value = P.nextSectionName(projectId, v); } });
  kindSeg.classList.add('pv-pj-kinds');
  const secCreate = button({ label: 'Crea', variant: 'primary', small: true, onClick: () => createSection() });
  const secNew = h('div', { class: 'pv-pj-inline col', hidden: true }, kindSeg, h('div', { class: 'pv-pj-inline' }, secInput, secCreate));
  secInput.addEventListener('input', () => { secNameEdited = true; });
  secInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createSection(); } });

  async function createProject() {
    const name = projInput.value.trim();
    if (!name) { projInput.focus(); return; }
    try {
      const p = await P.create(name);
      projectId = p.id; sectionId = null;
      projNew.hidden = true; projInput.value = '';
      haptic('success');
      render(); changed();
    } catch (e) { toast(`Impossibile creare il progetto: ${errText(e)}`, { kind: 'error' }); }
  }
  async function createSection() {
    const name = secInput.value.trim() || P.nextSectionName(projectId, secKind);
    try {
      const s = await P.createSection(projectId, name, secKind);
      sectionId = s.id;
      secNew.hidden = true; secNameEdited = false;
      haptic('success');
      render(); changed();
    } catch (e) { toast(`Impossibile creare la sezione: ${errText(e)}`, { kind: 'error' }); }
  }
  const changed = () => api.onChange?.(api.value);

  function chip(label, active, onClick, extra = {}) {
    const c = h('button', { type: 'button', class: `pv-chip ${active ? 'active' : ''} ${extra.cls || ''}`.trim() }, extra.icon ? icon(extra.icon, 16) : null, extra.kind ? h('small', { class: 'pv-pj-kind' }, extra.kind) : null, label);
    c.addEventListener('click', () => { haptic('tick'); onClick(); });
    return c;
  }

  function render() {
    projChips.replaceChildren(
      ...P.list().map((p) => chip(p.name, p.id === projectId, () => { if (projectId === p.id) return; projectId = p.id; sectionId = null; secNew.hidden = true; render(); changed(); })),
      chip('Nuovo', false, () => { projNew.hidden = !projNew.hidden; if (!projNew.hidden) setTimeout(() => projInput.focus(), 30); }, { icon: 'plus', cls: 'ghost' }),
    );
    const secs = P.sections(projectId);
    if (sectionId && !secs.some((s) => s.id === sectionId)) sectionId = null;
    secChips.replaceChildren(
      chip('Nessuna', !sectionId, () => { sectionId = null; render(); changed(); }),
      ...secs.map((s) => chip(s.name, s.id === sectionId, () => { sectionId = s.id; render(); changed(); }, { kind: s.name.startsWith(kindLabel(s.kind)) ? null : kindLabel(s.kind) })),
      chip('Nuova sezione', false, () => {
        secNew.hidden = !secNew.hidden;
        if (!secNew.hidden) { if (!secNameEdited) secInput.value = P.nextSectionName(projectId, secKind); setTimeout(() => { secInput.focus(); secInput.select(); }, 30); }
      }, { icon: 'plus', cls: 'ghost' }),
    );
    for (const row of [projChips, secChips]) requestAnimationFrame(() => row.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }

  api.el = h('div', { class: 'pv-pj-target' },
    h('div', { class: 'pv-pj-label' }, icon('book', 16), 'Progetto'), projChips, projNew,
    h('div', { class: 'pv-pj-label' }, icon('section', 16), 'Sezione'), secChips, secNew);
  Object.defineProperty(api, 'value', { get: () => ({ projectId, sectionId }) });
  render();
  return api;
}

/** "Sposta in…": -> Promise<{projectId, sectionId} | null> */
export function pickTarget(ctx, { projectId, sectionId, title = 'Sposta in…', okLabel = 'Sposta' } = {}) {
  const picker = targetPicker(ctx, { projectId, sectionId });
  const m = modal({
    title, icon: 'folder', kind: 'sheet', className: 'pv-pj-save', body: picker.el,
    actions: [{ label: 'Annulla', variant: 'ghost', value: null }, { label: okLabel, variant: 'primary', onClick: () => { m.close(picker.value); return false; } }],
  });
  return m.result;
}

// ================================================================= "Salva in…"
/**
 * opts: {type?, name?, data?, thumb?, character?, projectId?, sectionId?, title?, silent?}
 * With `data` the type is fixed (e.g. the Paesaggi panel's landscape). -> Promise<item | null>
 */
export function openSaveSheet(ctx, opts = {}) {
  const { app, api: P } = ctx;
  const fixed = opts.data !== undefined;
  let type = TYPE_BY_ID.has(opts.type) ? opts.type : 'scene';
  let nameEdited = !!opts.name;
  const thumbs = new Map(); // type -> data URL (preview, reused for the save)
  if (opts.thumb) thumbs.set(type, opts.thumb);

  const ch = () => (opts.character && app.characters.includes(opts.character) ? opts.character : app.selection.character);
  /** null when the type can be saved now, else the reason (Italian). */
  function unavailable(t) {
    if (fixed) return null;
    if (t === 'character' || t === 'pose') return ch() ? null : 'Seleziona prima un personaggio (toccalo nella vista).';
    if (t === 'landscape') { try { landscapeData(app); return null; } catch (e) { return errText(e); } }
    return null;
  }
  function defaultName(t) {
    if (fixed && opts.name) return opts.name;
    const c = ch();
    if (t === 'scene') {
      const cur = app.modules.ui?.scenes?.current;
      return opts.name || (cur && cur.name !== 'Senza titolo' ? cur.name : `Scena ${P.items({ type: 'scene' }).length + 1}`);
    }
    if (t === 'landscape') { let label = ''; try { label = landscapeMeta(app, landscapeData(app)).label; } catch { /* none */ } return label || `Paesaggio ${P.items({ type: 'landscape' }).length + 1}`; }
    if (t === 'character') return c?.name || 'Personaggio';
    if (t === 'pose') return c ? `Posa di ${c.name}` : 'Posa';
    return '';
  }

  // ---- what
  const typeBtns = new Map();
  const typeRow = h('div', { class: 'pv-pj-types', role: 'radiogroup' });
  for (const t of ITEM_TYPES) {
    const b = h('button', { type: 'button', class: 'pv-pj-typebtn', role: 'radio' }, typeBadge(t.id, 18), h('span', {}, t.label));
    b.addEventListener('click', () => { haptic('tick'); setType(t.id); });
    typeBtns.set(t.id, b);
    typeRow.appendChild(b);
  }
  const reason = h('p', { class: 'pv-pj-reason', hidden: true });

  // ---- preview + name
  const preview = h('div', { class: 'pv-pj-preview' }, h('span', { class: 'pv-io-spinner' }));
  const nameInput = h('input', { type: 'text', class: 'pv-input', maxlength: 60, enterkeyhint: 'done', autocomplete: 'off', spellcheck: 'false' });
  nameInput.addEventListener('input', () => { nameEdited = true; sync(); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } });
  const what = h('div', { class: 'pv-pj-what' });
  const nameBox = h('div', { class: 'pv-pj-namebox' }, h('label', { class: 'pv-field' }, h('span', { class: 'pv-field-label' }, 'Nome'), nameInput), what);

  const picker = targetPicker(ctx, { projectId: opts.projectId, sectionId: opts.sectionId });
  const body = h('div', { class: 'pv-pj-savebody' },
    fixed ? null : typeRow, reason,
    h('div', { class: 'pv-pj-head' }, preview, nameBox),
    picker.el);

  let saving = false;
  const m = modal({
    title: opts.title || 'Salva in…', icon: 'save', kind: 'sheet', className: 'pv-pj-save', body,
    actions: [{ label: 'Annulla', variant: 'ghost', value: null }, { label: 'Salva', icon: 'save', variant: 'primary', onClick: () => { save(); return false; } }],
  });
  const saveBtn = m.card.querySelector('.pv-modal-actions .primary');

  const WHAT = {
    scene: 'Tutta la scena: personaggi, pose, oggetti, paesaggio, luci e camera.',
    landscape: 'Solo l\'ambiente (paesaggio, oggetti, edifici, esterni, animali e luci), senza personaggi.',
    character: 'Il personaggio selezionato: corpo, vestiti, capelli, viso e posa.',
    pose: 'La posa del personaggio selezionato (anche mani e dita).',
  };

  function sync() {
    const why = unavailable(type);
    reason.hidden = !why; reason.textContent = why || '';
    for (const [id, b] of typeBtns) { b.classList.toggle('active', id === type); b.setAttribute('aria-checked', id === type ? 'true' : 'false'); b.classList.toggle('off', !!unavailable(id)); }
    what.textContent = fixed && opts.type === 'landscape' ? WHAT.landscape : WHAT[type];
    saveBtn.disabled = !!why || !nameInput.value.trim() || saving;
  }

  let thumbToken = 0;
  async function loadPreview() {
    const tok = ++thumbToken, t = type;
    if (unavailable(t)) { preview.replaceChildren(typeBadge(t, 26)); preview.classList.add('none'); return; }
    preview.classList.remove('none');
    if (!thumbs.has(t)) {
      preview.replaceChildren(h('span', { class: 'pv-io-spinner' }));
      await new Promise((r) => setTimeout(r, 30));
      const c = ch();
      const url = (t === 'character' || t === 'pose') ? await subjectThumb(app, c) : await viewThumb(app, { noCharacters: t === 'landscape' });
      thumbs.set(t, url || null);
    }
    if (tok !== thumbToken) return;
    const url = thumbs.get(t);
    preview.replaceChildren(url ? h('img', { src: url, alt: '' }) : typeBadge(t, 26));
  }

  function setType(t) {
    const prev = type;
    type = t;
    if (!nameEdited || nameInput.value.trim() === defaultName(prev)) { nameInput.value = defaultName(t); nameEdited = false; }
    sync();
    loadPreview();
  }

  async function save() {
    if (saving || unavailable(type) || !nameInput.value.trim()) return;
    saving = true; sync();
    const { projectId, sectionId } = picker.value;
    try {
      const item = await P.saveItem({
        type, name: nameInput.value.trim(), projectId, sectionId,
        data: fixed ? opts.data : undefined,
        thumb: thumbs.has(type) ? thumbs.get(type) : undefined,
        character: opts.character,
      });
      P.setCurrent(projectId, sectionId);
      haptic('success');
      if (!opts.silent) {
        const p = P.get(item.projectId)?.name || '', s = item.sectionId ? P.section(item.sectionId)?.name : '';
        toast(`${TYPE_BY_ID.get(type).label} «${item.name}» salvat${type === 'scene' || type === 'pose' ? 'a' : 'o'} in ${s ? `${p} › ${s}` : p}`, { kind: 'ok', ms: 2600 });
      }
      m.close(item);
    } catch (e) {
      saving = false; sync();
      if (e.quota) { haptic('error'); toast(e.message, { kind: 'error', ms: 4200, action: { label: 'Progetti', onClick: () => openBrowser(ctx, {}) } }); }
      else toast(`Salvataggio non riuscito: ${errText(e)}`, { kind: 'error', ms: 3600 });
    }
  }

  // first type: the requested one if available, else the first available
  if (!fixed && unavailable(type)) type = ITEM_TYPES.find((t) => !unavailable(t.id))?.id || 'scene';
  nameInput.value = opts.name && (fixed || opts.type === type) ? opts.name : defaultName(type);
  sync();
  // the capture blocks the main thread briefly: after the enter transition
  setTimeout(loadPreview, 260);
  if (P.persistent === false) toast('Questo dispositivo non conserva l\'archivio dopo la chiusura: esporta i progetti su file.', { kind: 'warning', ms: 4200 });
  return m.result;
}

// ================================================================= browser
/** opts: {projectId, type, query} */
export function openBrowser(ctx, opts = {}) {
  const { app, api: P } = ctx;
  let view = opts.projectId || opts.type ? 'project' : 'home';
  // opened straight on a project (e.g. "Personaggi salvati"): Android back closes, ← goes to all projects
  let entered = view === 'home';
  let projectId = P.get(opts.projectId) ? opts.projectId : P.current?.id;
  let filter = TYPE_BY_ID.has(opts.type) ? opts.type : null;
  let query = opts.query || '';
  const collapsed = new Set();
  const thumbCache = new Map(); // id -> data URL | null
  let renderT = 0;

  // ---- search bar (sticky)
  const search = h('input', { type: 'search', class: 'pv-input pv-pj-search', placeholder: 'Cerca in tutti i progetti…', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false', value: query });
  const clear = iconButton({ icon: 'close', title: 'Cancella ricerca', size: 18, onClick: () => { search.value = ''; setQuery(''); search.focus(); } });
  clear.classList.add('pv-pj-clear');
  const backBtn = iconButton({ icon: 'arrowLeft', title: 'Tutti i progetti', onClick: () => { haptic('tick'); goHome(); } });
  backBtn.classList.add('pv-pj-back');
  const bar = h('div', { class: 'pv-pj-bar' }, backBtn, h('div', { class: 'pv-pj-searchwrap' }, icon('search', 18), search, clear));
  search.addEventListener('input', () => setQuery(search.value));
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search.blur(); } });
  const content = h('div', { class: 'pv-pj-content' });
  // tablets: the projects (and, in landscape, the sections of the open project) are listed in
  // panes beside the content: 0 = one pane (phones), 2 = projects | content, 3 = projects | sections | content
  const nav = h('nav', { class: 'pv-pj-nav', 'aria-label': 'Progetti' });
  const secnav = h('nav', { class: 'pv-pj-secnav', 'aria-label': 'Sezioni' });
  const main = h('div', { class: 'pv-pj' }, bar, content);
  const frame = h('div', { class: 'pv-pj-frame' }, nav, secnav, main);
  const panes = () => (app.shell?.tablet ? (app.shell.tier === 'tablet-wide' ? 3 : 2) : 0);
  let split = 0;
  let secFocus = null; // section highlighted in the sections pane ('all' | 'root' | id)

  const m = modal({
    title: 'Progetti', icon: 'book', kind: 'sheet', className: 'pv-pj-browser', body: frame,
    onBack: () => {
      if (query) { search.value = ''; setQuery(''); return true; }
      if (view === 'project' && entered && !split) { goHome(); return true; }
      return false;
    },
  });
  const titleEl = m.card.querySelector('.pv-modal-title');
  const subEl = h('div', { class: 'pv-modal-subtitle' });
  m.card.querySelector('.pv-modal-titles').appendChild(subEl);

  const onChange = () => schedule();
  P.addEventListener('change', onChange);
  const onSel = () => schedule();
  app.addEventListener('selection', onSel);
  // rotation / split screen while open: switch between one and several panes
  const onLayout = () => { if (panes() !== split) schedule(); };
  app.shell?.addEventListener?.('layout', onLayout);
  m.result.then(() => { P.removeEventListener('change', onChange); app.removeEventListener('selection', onSel); app.shell?.removeEventListener?.('layout', onLayout); clearTimeout(renderT); });

  function schedule() { clearTimeout(renderT); renderT = setTimeout(render, 30); }
  function setQuery(q) { query = q.trim(); bar.classList.toggle('has-query', !!query); schedule(); }
  const scroller = () => (split ? main : m.body);
  function goHome() { view = 'home'; filter = null; entered = true; render(); scroller().scrollTop = 0; }
  function goProject(id, type = null) { if (id !== projectId) secFocus = null; projectId = id; view = 'project'; filter = type; render(); scroller().scrollTop = 0; }

  // ---- thumbnails (batch read, cached for this browser)
  async function fillThumbs(root) {
    const imgs = [...root.querySelectorAll('[data-thumb]')];
    const need = [...new Set(imgs.map((e) => e.dataset.thumb).filter((id) => !thumbCache.has(id)))];
    if (need.length) {
      try { const got = await P.thumbs(need); for (const id of need) thumbCache.set(id, got.get(id) || null); }
      catch (e) { console.warn('[PosaViva] thumbnails', e); }
    }
    for (const el of imgs) {
      const url = thumbCache.get(el.dataset.thumb);
      if (url) { const img = h('img', { src: url, alt: '', decoding: 'async' }); el.replaceChildren(img); el.classList.add('has'); }
    }
  }

  // ---- render
  function render() {
    if (!P.get(projectId)) projectId = P.current?.id || P.list()[0]?.id;
    split = panes();
    frame.classList.toggle('split', !!split);
    frame.classList.toggle('three', split === 3);
    m.card.classList.toggle('split', !!split);
    // several panes: the projects are always listed on the left, the content shows one of them
    if (split && view === 'home' && projectId) view = 'project';
    backBtn.hidden = split ? true : view !== 'project' && !query;
    if (query) renderSearch();
    else if (view === 'project') renderProject();
    else renderHome();
    if (split) renderNav(); else nav.replaceChildren();
    if (split === 3) renderSecNav(); else secnav.replaceChildren();
    fillThumbs(frame);
  }

  // ---------------------------------------------------------------- tablets: panes
  function homeSummary() {
    return `${plural(P.list().length, 'fumetto', 'fumetti')} · ${plural(P.items().length, 'elemento salvato', 'elementi salvati')} · ${formatBytes(P.usage())}`;
  }

  function renderNav() {
    const list = P.list();
    const rows = list.map((p) => {
      const on = !query && view === 'project' && p.id === projectId;
      const latest = P.items({ projectId: p.id })[0];
      const cover = h('span', { class: `pv-pj-navcover ${latest ? '' : 'blank'}`.trim(), 'data-thumb': latest?.id }, latest ? typeBadge(latest.type, 12) : (p.name.trim()[0] || '?').toUpperCase());
      const c = p.counts || {};
      const b = h('button', { type: 'button', class: `pv-pj-navrow ${on ? 'active' : ''}`.trim(), title: p.name, 'aria-current': on ? 'true' : null },
        cover,
        h('span', { class: 'pv-pj-navtext' }, h('span', { class: 'pv-pj-navname' }, p.name),
          h('small', {}, c.total ? plural(c.total, 'elemento', 'elementi') : 'Vuoto', p.sectionCount ? ` · ${plural(p.sectionCount, 'sezione', 'sezioni')}` : '')),
        p.id === P.current?.id ? h('span', { class: 'pv-pj-navcur', title: 'In uso per i salvataggi' }) : null);
      b.addEventListener('click', () => {
        haptic('tick');
        if (query) { search.value = ''; query = ''; bar.classList.remove('has-query'); }
        goProject(p.id);
      });
      return b;
    });
    nav.replaceChildren(
      h('div', { class: 'pv-pj-navhead' }, h('span', {}, 'Fumetti'), h('small', {}, String(list.length))),
      h('div', { class: 'pv-pj-navactions' },
        button({ label: 'Nuovo', icon: 'plus', variant: 'primary', small: true, onClick: newProject }),
        button({ label: 'Importa', icon: 'upload', small: true, onClick: importFile })),
      h('div', { class: 'pv-pj-navlist' }, rows),
      h('p', { class: 'pv-pj-note' }, `Archivio: ${formatBytes(P.usage())}`));
  }

  function renderSecNav() {
    const p = P.get(projectId);
    if (!p || query || view !== 'project') { secnav.replaceChildren(); return; }
    const all = P.items({ projectId }), secs = P.sections(projectId);
    const row = (id, label, n, kind, here) => {
      const b = h('button', { type: 'button', class: `pv-pj-secrow ${(secFocus || 'all') === id ? 'active' : ''}`.trim(), title: label },
        icon(id === 'all' ? 'library' : kind ? 'section' : 'folder', 17),
        h('span', { class: 'pv-pj-sectext' }, h('span', { class: 'pv-pj-secname' }, label),
          kind || here ? h('span', { class: 'pv-pj-secsub' }, kind ? h('span', { class: 'pv-pj-kind' }, kindLabel(kind)) : null, here ? h('span', { class: 'pv-pj-here', title: 'Qui vanno i salvataggi' }, 'in uso') : null) : null),
        h('small', {}, String(n)));
      b.addEventListener('click', () => { haptic('tick'); focusSection(id); });
      return b;
    };
    const rootN = all.filter((i) => !i.sectionId).length;
    secnav.replaceChildren(
      h('div', { class: 'pv-pj-navhead' }, h('span', {}, 'Sezioni'), h('small', {}, String(secs.length))),
      h('div', { class: 'pv-pj-navlist' },
        row('all', 'Tutto il progetto', all.length),
        rootN || !secs.length ? row('root', 'Generale', rootN) : null,
        secs.map((s) => row(s.id, s.name, all.filter((i) => i.sectionId === s.id).length, s.kind, P.current?.id === projectId && P.currentSection?.id === s.id))),
      button({ label: 'Nuova sezione', icon: 'plus', small: true, onClick: () => newSection() }));
  }

  /** Sections pane: scrolls the content to a section (expanding it). */
  function focusSection(id) {
    secFocus = id;
    if (id !== 'all') collapsed.delete(id);
    render();
    const el = id === 'all' ? null : content.querySelector(`[data-sec="${id}"]`);
    main.scrollTop = el ? Math.max(0, el.offsetTop - bar.offsetHeight - 10) : 0;
  }

  function setTitle(t, sub) { titleEl.textContent = t; subEl.textContent = sub || ''; }

  // ---------------------------------------------------------------- home: projects
  function renderHome() {
    const list = P.list();
    const items = P.items();
    setTitle('Progetti', `${plural(list.length, 'fumetto', 'fumetti')} · ${plural(items.length, 'elemento salvato', 'elementi salvati')} · ${formatBytes(P.usage())}`);
    const actions = h('div', { class: 'pv-pj-actions' },
      button({ label: 'Nuovo progetto', icon: 'plus', variant: 'primary', onClick: newProject }),
      button({ label: 'Importa', icon: 'upload', onClick: importFile }));
    const grid = h('div', { class: 'pv-pj-projects' });
    for (const p of list) grid.appendChild(projectCard(p));
    content.replaceChildren(actions, grid,
      h('p', { class: 'pv-pj-note' }, 'Un progetto è un fumetto: dividilo in sezioni (capitoli, tavole, vignette) e salvaci scene, paesaggi, personaggi e pose. Esporta un progetto (⋯ › Esporta file) per conservarlo fuori dall\'app o portarlo su un altro dispositivo.'));
  }

  function cover(p) {
    const latest = P.items({ projectId: p.id }).slice(0, 4);
    const el = h('div', { class: `pv-pj-cover n${Math.max(1, latest.length)}` });
    if (!latest.length) {
      el.classList.add('blank');
      el.append(h('span', { class: 'pv-pj-initial' }, (p.name.trim()[0] || '?').toUpperCase()), icon('book', 22));
      return el;
    }
    for (const it of latest) el.appendChild(h('div', { class: 'pv-pj-cell', 'data-thumb': it.id }, typeBadge(it.type, 14)));
    return el;
  }

  function projectCard(p) {
    const isCur = p.id === P.current?.id;
    const more = iconButton({ icon: 'more', title: 'Azioni', size: 20, onClick: (e) => { e.stopPropagation(); projectMenu(p, more); } });
    const c = p.counts;
    const counts = h('div', { class: 'pv-pj-counts' }, ...ITEM_TYPES.filter((t) => c[t.id]).map((t) => h('span', { title: t.plural }, typeBadge(t.id, 11), String(c[t.id]))));
    const card = h('div', { class: `pv-pj-project ${isCur ? 'current' : ''}`.trim(), role: 'button', tabindex: '0' },
      cover(p),
      isCur ? h('span', { class: 'pv-pj-badge' }, 'In uso') : null,
      h('div', { class: 'pv-pj-pmeta' },
        h('div', { class: 'pv-pj-ptext' },
          h('div', { class: 'pv-pj-pname' }, p.name),
          h('div', { class: 'pv-pj-psub' }, c.total ? plural(c.total, 'elemento', 'elementi') : 'Vuoto', p.sectionCount ? ` · ${plural(p.sectionCount, 'sezione', 'sezioni')}` : ''),
          c.total ? counts : null),
        more));
    card.addEventListener('click', () => { haptic('tick'); goProject(p.id); });
    return card;
  }

  async function newProject() {
    const name = await promptDialog('Nome del fumetto', '', { title: 'Nuovo progetto', okLabel: 'Crea', placeholder: 'Es. Le avventure di Nina', maxLength: 60 });
    if (!name) return;
    try { const p = await P.create(name); haptic('success'); goProject(p.id); }
    catch (e) { toast(`Impossibile creare il progetto: ${errText(e)}`, { kind: 'error' }); }
  }

  async function importFile() {
    try {
      const r = await P.importFile();
      if (!r) return;
      haptic('success');
      if (r.project) { toast(`Importato «${r.project.name}»: ${plural(r.project.itemCount, 'elemento', 'elementi')}`, { kind: 'ok', ms: 2800 }); goProject(r.project.id); }
      else if (r.item) { toast(`Scena «${r.item.name}» aggiunta a ${P.get(r.item.projectId)?.name || ''}`, { kind: 'ok', ms: 2800 }); goProject(r.item.projectId, null); }
    } catch (e) { haptic('error'); toast(errText(e), { kind: 'error', ms: 3600 }); }
  }

  async function projectMenu(p, anchor) {
    const isCur = p.id === P.current?.id;
    await sheetMenu([
      { id: 'open', label: 'Apri', icon: 'folder', onClick: () => goProject(p.id) },
      isCur ? null : { id: 'use', label: 'Usa per i salvataggi', icon: 'checkCircle', hint: '«Salva in…» propone questo progetto', onClick: () => { P.setCurrent(p.id, null); toast(`I salvataggi vanno in «${p.name}»`, { kind: 'ok', ms: 1800 }); } },
      { id: 'rename', label: 'Rinomina', icon: 'edit', onClick: async () => {
        const n = await promptDialog('Nome del fumetto', p.name, { title: 'Rinomina progetto', okLabel: 'Salva', maxLength: 60 });
        if (n && n !== p.name) try { await P.rename(p.id, n); } catch (e) { toast(errText(e), { kind: 'error' }); }
      } },
      { id: 'export', label: 'Esporta file (.posaviva)', icon: 'download', hint: 'Tutto il progetto in un file', onClick: () => exportProject(p) },
      { separator: true },
      { id: 'del', label: 'Elimina progetto', icon: 'trash', danger: true, onClick: () => removeProject(p) },
    ], { title: p.name, anchor });
  }

  async function exportProject(p) {
    const b = busyToast('Preparo il file…');
    try {
      const r = await P.exportProject(p.id);
      b._dismiss?.();
      if (r.ok) { haptic('success'); toast(`«${p.name}» esportato in ${r.where} (${plural(r.items, 'elemento', 'elementi')})`, { kind: 'ok', ms: 3200 }); }
      else toast(`Esportazione non riuscita: ${r.error}`, { kind: 'error' });
    } catch (e) { b._dismiss?.(); toast(`Esportazione non riuscita: ${errText(e)}`, { kind: 'error' }); }
  }

  async function removeProject(p) {
    const n = P.items({ projectId: p.id }).length;
    const ok = await confirmDialog(`«${p.name}» verrà eliminato definitivamente${n ? `, con ${plural(n, 'elemento salvato', 'elementi salvati')}` : ''}. Per conservarlo prima esportalo su file.`, { title: 'Eliminare il progetto?', okLabel: 'Elimina', danger: true, icon: 'trash' });
    if (!ok) return;
    try { await P.remove(p.id); toast('Progetto eliminato', 1600); if (view === 'project' && projectId === p.id) goHome(); }
    catch (e) { toast(errText(e), { kind: 'error' }); }
  }

  // ---------------------------------------------------------------- project: sections + items
  function renderProject() {
    const p = P.get(projectId);
    if (!p) { goHome(); return; }
    const all = P.items({ projectId });
    const secs = P.sections(projectId);
    const sub = `${plural(secs.length, 'sezione', 'sezioni')} · ${plural(all.length, 'elemento', 'elementi')} · ${formatBytes(P.usage(projectId))}`;
    // several panes: the dialog title stays «Progetti», the project is named above its content
    if (split) setTitle('Progetti', homeSummary()); else setTitle(p.name, sub);
    const isCur = p.id === P.current?.id;

    const more = iconButton({ icon: 'more', title: 'Azioni del progetto', onClick: () => projectMenu(p, more) });
    const actions = h('div', { class: 'pv-pj-actions' },
      button({ label: 'Salva qui…', icon: 'save', variant: 'primary', onClick: () => saveHere(null) }),
      button({ label: 'Sezione', icon: 'plus', onClick: () => newSection() }),
      more);

    // type filter with counts
    const counts = Object.fromEntries(ITEM_TYPES.map((t) => [t.id, all.filter((i) => i.type === t.id).length]));
    const chipsEl = h('div', { class: 'pv-chips pv-pj-filter' },
      filterChip(null, 'Tutto', all.length),
      ...ITEM_TYPES.filter((t) => counts[t.id] || filter === t.id).map((t) => filterChip(t.id, t.plural, counts[t.id], t.icon)));

    const groups = h('div', { class: 'pv-pj-groups' });
    const root = all.filter((i) => !i.sectionId);
    if (root.length || !secs.length) groups.appendChild(group(null, 'Generale', root));
    for (const s of secs) groups.appendChild(group(s, s.name, all.filter((i) => i.sectionId === s.id)));
    content.replaceChildren(...[
      split ? h('div', { class: 'pv-pj-phead' }, h('div', { class: 'pv-pj-ptitle' }, p.name), h('div', { class: 'pv-pj-psub2' }, sub)) : null,
      isCur ? null : h('button', { type: 'button', class: 'pv-pj-usehint', onClick: () => { haptic('tick'); P.setCurrent(p.id, null); } }, icon('checkCircle', 16), 'Usa questo progetto per i salvataggi'),
      actions, all.length ? chipsEl : null, groups].filter(Boolean));
  }

  function filterChip(type, label, n, ic) {
    const c = h('button', { type: 'button', class: `pv-chip ${filter === type ? 'active' : ''}`.trim() }, ic ? icon(ic, 16) : null, label, h('small', {}, String(n)));
    c.addEventListener('click', () => { haptic('tick'); filter = type; render(); });
    if (type && !n) c.classList.add('dim');
    return c;
  }

  function group(s, title, items) {
    const id = s?.id || 'root';
    const shown = filter ? items.filter((i) => i.type === filter) : items;
    const isCurSec = s && P.current?.id === projectId && P.currentSection?.id === s.id;
    const isClosed = collapsed.has(id);
    const head = h('div', { class: 'pv-pj-ghead' },
      h('button', { type: 'button', class: 'pv-pj-gtitle', 'aria-expanded': isClosed ? 'false' : 'true' },
        icon(isClosed ? 'chevronRight' : 'chevronDown', 18),
        s ? h('span', { class: 'pv-pj-kind' }, kindLabel(s.kind)) : null,
        h('span', { class: 'pv-pj-gname' }, title),
        h('small', {}, String(shown.length)),
        isCurSec ? h('span', { class: 'pv-pj-here', title: 'Qui vanno i salvataggi' }, 'in uso') : null));
    head.firstChild.addEventListener('click', () => { haptic('tick'); if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); render(); });
    const add = iconButton({ icon: 'save', title: 'Salva qui…', size: 19, onClick: () => saveHere(s?.id || null) });
    head.appendChild(add);
    if (s) { const more = iconButton({ icon: 'more', title: 'Azioni della sezione', size: 20, onClick: () => sectionMenu(s, more) }); head.appendChild(more); }
    const el = h('section', { class: `pv-pj-group ${isClosed ? 'closed' : ''}`.trim(), 'data-sec': id }, head);
    if (isClosed) return el;
    if (!shown.length) {
      el.appendChild(h('div', { class: 'pv-pj-gempty' },
        filter ? `Nessun elemento di tipo «${TYPE_BY_ID.get(filter).plural.toLowerCase()}» qui.`
          : s ? ['Sezione vuota: tocca ', icon('save', 15), ' per salvarci la scena, un paesaggio, un personaggio o una posa.']
            : 'Progetto vuoto: salva qui scene, paesaggi, personaggi e pose. Puoi anche creare sezioni (capitoli, tavole, vignette).'));
      return el;
    }
    const grid = h('div', { class: 'pv-pj-items' });
    for (const it of shown) grid.appendChild(itemCard(it));
    el.appendChild(grid);
    return el;
  }

  function itemCard(it, caption = null) {
    const t = TYPE_BY_ID.get(it.type);
    const isOpen = it.type === 'scene' && app.modules.ui?.scenes?.current?.id === it.id;
    const label = it.meta?.label && norm(it.meta.label) !== norm(it.name) ? it.meta.label : null;
    const sub = caption || (it.type === 'scene' && it.meta?.chars != null ? `${plural(it.meta.chars, 'personaggio', 'personaggi')}` : label || formatDate(it.updated));
    const card = h('button', { type: 'button', class: `pv-pj-item ${isOpen ? 'current' : ''}`.trim(), title: `${t.label}: ${it.name}` },
      h('div', { class: `pv-pj-thumb t-${it.type}`, 'data-thumb': it.id }, icon(t.icon, 28)),
      typeBadge(it.type),
      isOpen ? h('span', { class: 'pv-pj-open' }, 'Aperta') : null,
      h('div', { class: 'pv-pj-iname' }, it.name),
      h('div', { class: 'pv-pj-isub' }, sub));
    card.addEventListener('click', () => { haptic('tick'); itemMenu(it, card); });
    return card;
  }

  // ---------------------------------------------------------------- search
  function renderSearch() {
    const res = P.find(query);
    const projs = P.list().filter((p) => norm(p.name).includes(norm(query)));
    setTitle('Progetti', `Risultati per «${query}»`);
    const blocks = [];
    if (projs.length) {
      const g = h('div', { class: 'pv-pj-projects compact' });
      for (const p of projs) g.appendChild(projectCard(p));
      blocks.push(h('div', { class: 'pv-pj-label' }, icon('book', 16), 'Progetti'), g);
    }
    if (res.length) {
      const grid = h('div', { class: 'pv-pj-items' });
      for (const it of res.slice(0, 120)) grid.appendChild(itemCard(it, it.sectionName ? `${it.projectName} › ${it.sectionName}` : it.projectName));
      blocks.push(h('div', { class: 'pv-pj-label' }, icon('library', 16), `Elementi (${res.length})`), grid);
    }
    if (!blocks.length) blocks.push(emptyState('search', 'Nessun risultato', 'Prova con un\'altra parola: nome, tipo (scena, paesaggio, personaggio, posa), sezione o progetto.'));
    content.replaceChildren(...blocks);
  }

  // ---------------------------------------------------------------- sections
  async function newSection() {
    const r = await sectionDialog({ title: 'Nuova sezione', kind: 'tavola', name: '' });
    if (!r) return;
    try { const s = await P.createSection(projectId, r.name, r.kind); haptic('success'); collapsed.delete(s.id); }
    catch (e) { toast(errText(e), { kind: 'error' }); }
  }

  /** Kind + name dialog. -> {kind, name} | null */
  function sectionDialog({ title, kind, name }) {
    let k = kind, edited = !!name;
    const input = h('input', { type: 'text', class: 'pv-input', maxlength: 60, value: name || P.nextSectionName(projectId, k), enterkeyhint: 'done', autocomplete: 'off' });
    input.addEventListener('input', () => { edited = true; });
    const seg = segmented({ options: SECTION_KINDS.map((x) => ({ value: x.id, label: x.label })), value: k, onChange: (v) => { haptic('tick'); k = v; if (!edited) input.value = P.nextSectionName(projectId, v); } });
    seg.classList.add('pv-pj-kinds');
    const d = modal({
      title, icon: 'section', className: 'pv-pj-secdlg',
      body: h('div', { class: 'pv-pj-secform' }, h('div', { class: 'pv-field' }, h('span', { class: 'pv-field-label' }, 'Tipo'), seg), h('label', { class: 'pv-field' }, h('span', { class: 'pv-field-label' }, 'Nome'), input)),
      actions: [{ label: 'Annulla', variant: 'ghost', value: null }, { label: 'OK', variant: 'primary', onClick: () => { const n = input.value.trim(); if (!n) return false; d.close({ kind: k, name: n }); return false; } }],
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); d.card.querySelector('.pv-modal-actions .primary').click(); } });
    setTimeout(() => { input.focus({ preventScroll: true }); input.select(); }, 60);
    return d.result;
  }

  async function sectionMenu(s, anchor) {
    const list = P.sections(s.projectId), i = list.findIndex((x) => x.id === s.id);
    const n = P.items({ projectId: s.projectId, sectionId: s.id }).length;
    await sheetMenu([
      { id: 'save', label: 'Salva qui…', icon: 'save', onClick: () => saveHere(s.id) },
      { id: 'edit', label: 'Rinomina o cambia tipo', icon: 'edit', onClick: async () => {
        const r = await sectionDialog({ title: 'Modifica sezione', kind: s.kind, name: s.name });
        if (r) try { await P.updateSection(s.id, r); } catch (e) { toast(errText(e), { kind: 'error' }); }
      } },
      { id: 'up', label: 'Sposta su', icon: 'arrowUp', disabled: i <= 0, onClick: () => P.moveSection(s.id, -1) },
      { id: 'down', label: 'Sposta giù', icon: 'arrowDown', disabled: i >= list.length - 1, onClick: () => P.moveSection(s.id, 1) },
      { separator: true },
      { id: 'del', label: 'Elimina sezione', icon: 'trash', danger: true, hint: n ? `${plural(n, 'elemento', 'elementi')}: puoi tenerli in Generale` : null, onClick: () => removeSection(s, n) },
    ], { title: `${kindLabel(s.kind)} · ${s.name}`, anchor });
  }

  async function removeSection(s, n) {
    if (!n) {
      if (await confirmDialog(`La sezione «${s.name}» è vuota e verrà eliminata.`, { title: 'Eliminare la sezione?', okLabel: 'Elimina', danger: true, icon: 'trash' })) await P.removeSection(s.id).catch((e) => toast(errText(e), { kind: 'error' }));
      return;
    }
    const v = await modal({
      title: 'Eliminare la sezione?', icon: 'trash', danger: true,
      body: h('p', { class: 'pv-modal-text' }, `«${s.name}» contiene ${plural(n, 'elemento', 'elementi')}. Puoi spostarli in Generale oppure eliminarli insieme alla sezione.`),
      actions: [{ label: 'Annulla', variant: 'ghost', value: null }, { label: 'Elimina tutto', variant: 'danger', value: 'all' }, { label: 'Tieni gli elementi', variant: 'primary', value: 'keep' }],
    }).result;
    if (!v) return;
    try { await P.removeSection(s.id, { withItems: v === 'all' }); toast('Sezione eliminata', 1600); }
    catch (e) { toast(errText(e), { kind: 'error' }); }
  }

  async function saveHere(sectionId) {
    const item = await openSaveSheet(ctx, { projectId, sectionId });
    if (item) { filter = null; collapsed.delete(item.sectionId || 'root'); }
  }

  // ---------------------------------------------------------------- items
  async function itemMenu(it, anchor) {
    const sel = app.selection.character;
    const sc = app.modules.ui?.scenes;
    const isOpen = it.type === 'scene' && sc?.current?.id === it.id;
    const primary = {
      scene: isOpen
        ? { id: 'open', label: sc.dirty ? 'Torna alla versione salvata' : 'Già aperta', icon: sc.dirty ? 'undo' : 'checkCircle', hint: sc.dirty ? 'Annulla le modifiche fatte dopo l\'ultimo salvataggio' : 'È la scena sullo schermo', disabled: !sc.dirty }
        : { id: 'open', label: 'Apri scena', icon: 'folder', hint: 'Sostituisce la scena sullo schermo' },
      landscape: { id: 'apply', label: 'Applica paesaggio', icon: 'mountain', hint: 'Sostituisce l\'ambiente; i personaggi restano' },
      character: { id: 'insert', label: 'Inserisci nella scena', icon: 'userPlus', hint: 'Aggiunge un nuovo personaggio con questo aspetto' },
      pose: { id: 'pose', label: 'Applica posa', icon: 'pose', hint: sel ? `A «${sel.name}»` : 'Seleziona prima un personaggio', disabled: !sel },
    }[it.type];
    const where = it.sectionId ? `${P.get(it.projectId)?.name || ''} › ${P.section(it.sectionId)?.name || ''}` : P.get(it.projectId)?.name || '';
    await sheetMenu([
      { header: `${TYPE_BY_ID.get(it.type).label} · ${where} · ${formatDate(it.updated)}` },
      { ...primary, onClick: () => runPrimary(it) },
      { separator: true },
      { id: 'rename', label: 'Rinomina', icon: 'edit', onClick: async () => {
        const n = await promptDialog('Nome', it.name, { title: 'Rinomina', okLabel: 'Salva', maxLength: 60 });
        if (n && n !== it.name) try { await P.renameItem(it.id, n); } catch (e) { toast(errText(e), { kind: 'error' }); }
      } },
      { id: 'move', label: 'Sposta in…', icon: 'folder', hint: 'Un\'altra sezione o un altro progetto', onClick: async () => {
        const to = await pickTarget(ctx, { projectId: it.projectId, sectionId: it.sectionId });
        if (to) try { const r = await P.moveItem(it.id, to); toast(`Spostato in ${r.sectionId ? `${P.get(r.projectId)?.name} › ${P.section(r.sectionId)?.name}` : P.get(r.projectId)?.name}`, { kind: 'ok', ms: 1800 }); } catch (e) { toast(errText(e), { kind: 'error' }); }
      } },
      { id: 'dup', label: 'Duplica', icon: 'copy', onClick: () => P.duplicateItem(it.id).catch((e) => toast(errText(e), { kind: e.quota ? 'error' : 'warning' })) },
      it.type === 'scene' ? { id: 'file', label: 'Esporta file scena (.json)', icon: 'download', onClick: () => exportScene(it) } : null,
      { separator: true },
      { id: 'del', label: 'Elimina', icon: 'trash', danger: true, onClick: async () => {
        if (!(await confirmDialog(`«${it.name}» verrà eliminato definitivamente.`, { title: 'Eliminare?', okLabel: 'Elimina', danger: true, icon: 'trash' }))) return;
        try { await P.removeItem(it.id); toast('Eliminato', 1500); } catch (e) { toast(errText(e), { kind: 'error' }); }
      } },
    ], { title: it.name, anchor });
  }

  async function exportScene(it) {
    try {
      const full = await P.getItem(it.id);
      const slug = norm(it.name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'scena';
      const r = app.modules.ui.exporter.saveText(JSON.stringify({ ...full.data, name: it.name }), `${slug}.posaviva.json`);
      if (r.ok) toast(`File salvato in ${r.where}`, { kind: 'ok' }); else toast(`Esportazione non riuscita: ${r.error}`, { kind: 'error' });
    } catch (e) { toast(`Esportazione non riuscita: ${errText(e)}`, { kind: 'error' }); }
  }

  async function runPrimary(it) {
    const undo = { label: 'Annulla', onClick: () => app.history.undo() };
    if (it.type === 'scene') {
      try { const r = await P.loadItem(it.id); if (r.ok) m.close(it.id); }
      catch (e) { toast(`Impossibile aprire la scena: ${errText(e)}`, { kind: 'error' }); }
      return;
    }
    m.close(it.id);
    const wait = it.type === 'landscape' ? busyToast('Applico il paesaggio…') : null;
    try {
      const r = await P.loadItem(it.id);
      wait?._dismiss?.();
      haptic('success');
      if (it.type === 'landscape') toast(`Paesaggio «${it.name}» applicato`, { kind: 'ok', action: undo });
      else if (it.type === 'character') toast(`«${r.character?.name || it.name}» inserito nella scena`, { kind: 'ok', action: undo });
      else toast(`Posa «${it.name}» applicata a ${r.character?.name || ''}`, { kind: 'ok', action: undo });
    } catch (e) {
      wait?._dismiss?.();
      haptic('error');
      toast(errText(e), { kind: 'error', ms: 3600 });
    }
  }

  function busyToast(text) { return toast(text, { kind: 'info', icon: 'clock', ms: 20000 }); }

  bar.classList.toggle('has-query', !!query);
  render();
  return m;
}
