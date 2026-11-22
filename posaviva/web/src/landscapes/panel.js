// "Paesaggi" tool (group Scena): preset cards by group, quick chips for time of
// day / weather / season / density, "Genera nuovo" (always a new variant),
// "Rigenera" (same request, new seed), "Svuota", "Salva paesaggio".
import { h, section, chips, button, toast, haptic, promptDialog, confirmDialog } from '../ui/kit.js';
import { PRESETS, GROUPS, PRESET_BY_ID } from './presets/index.js';
import { TIMES, WEATHERS, SEASONS } from './atmos.js';
import { presetThumb, storeThumb } from './thumbs.js';
import { ICON_NAMES } from '../ui/icons.js';

const LS_PREFS = 'posaviva.landscapes.prefs';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(LS_PREFS) || '{}') || {}; } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(LS_PREFS, JSON.stringify(p)); } catch { /* private mode */ } };

const DENSITY = [{ id: 'auto', label: 'Auto' }, { id: '0.25', label: 'Poca' }, { id: '0.55', label: 'Media' }, { id: '0.85', label: 'Tanta' }];
const labelOf = (list, id) => list.find((x) => x.id === id)?.label || id;

export function registerLandscapesTool(app, shell, manager) {
  const prefs = { group: 'citta', time: null, weather: null, season: null, density: null, ...loadPrefs() };

  /** Spec from the quick chips (fixed choices; Auto = random each time). */
  const chipSpec = () => {
    const s = {};
    if (prefs.time) s.time = prefs.time;
    if (prefs.weather) s.weather = prefs.weather;
    if (prefs.season) s.season = prefs.season;
    if (prefs.density !== null && prefs.density !== undefined) s.density = prefs.density;
    return s;
  };

  let ui = null;

  async function run(spec, label) {
    if (manager.busy) return;
    haptic('light');
    ui?.setBusy(true, label);
    try {
      const r = await manager.generate(spec);
      if (r?.aborted) return;
      const c = manager.current;
      if (c) {
        const p = PRESET_BY_ID.get(c.resolved.preset);
        toast(`${p?.label || 'Paesaggio'} · ${labelOf(TIMES, c.resolved.time).toLowerCase()} · ${labelOf(WEATHERS, c.resolved.weather).toLowerCase()} — ${c.items} oggetti. Tocca un oggetto per spostarlo o eliminarlo.`, { ms: 3800, kind: 'ok', icon: 'sparkle' });
        captureThumb(c.resolved.preset);
      }
    } catch (e) {
      console.error('[landscapes] generation failed', e);
      toast('Non sono riuscito a creare il paesaggio.', { kind: 'error' });
    } finally {
      ui?.setBusy(false);
      ui?.sync();
    }
  }

  /** Stores a small capture of the result as the card thumbnail of the preset (best effort). */
  function captureThumb(presetId) {
    setTimeout(async () => {
      try {
        if (!app.capture || app.contextLost) return;
        const cv = await app.capture({ width: 240, height: 168, transparent: false });
        const url = cv.toDataURL('image/jpeg', 0.72);
        storeThumb(presetId, url);
        ui?.refreshThumb(presetId);
      } catch { /* decorative */ }
    }, 900);
  }

  async function save() {
    const c = manager.current;
    if (!c) { toast('Prima crea un paesaggio.', { kind: 'info' }); return; }
    const p = PRESET_BY_ID.get(c.resolved.preset);
    const def = `${p?.label || 'Paesaggio'} (${labelOf(TIMES, c.resolved.time).toLowerCase()})`;
    // "Salva in…" sheet of the projects module: name, project, section; it captures its own
    // 3:4 thumbnail with the characters hidden and shows the success toast (null = cancelled)
    if (app.projects?.openSaveSheet) {
      try { await app.projects.openSaveSheet({ type: 'landscape', name: def, data: manager.exportData() }); }
      catch (e) { console.error(e); toast('Salvataggio non riuscito', { kind: 'error' }); }
      return;
    }
    if (app.projects?.saveItem) {
      const name = await promptDialog('Nome del paesaggio', def, { title: 'Salva paesaggio', okLabel: 'Salva', maxLength: 60 });
      if (!name) return;
      try {
        await app.projects.saveItem({ type: 'landscape', name, data: manager.exportData() });
        toast('Paesaggio salvato', { kind: 'ok' });
      } catch (e) { console.error(e); toast('Salvataggio non riuscito', { kind: 'error' }); }
      return;
    }
    // no projects module: save the whole scene (the landscape is part of it)
    if (app.modules.ui?.saveScene) app.modules.ui.saveScene();
    else toast('Salvataggio non disponibile', { kind: 'warning' });
  }

  shell.registerTool({
    id: 'landscapes', label: 'Paesaggi', icon: ICON_NAMES.includes('landscape') ? 'landscape' : 'mountain', group: 'scene', order: 64, title: 'Paesaggi pronti',
    build(el) {
      el.classList.add('pv-ls-panel');
      // ---- current landscape + actions
      const status = h('div', { class: 'pv-ls-status' });
      const busyBar = h('div', { class: 'pv-ls-busy' }, h('span', {}));
      const btnNew = button({ label: 'Genera nuovo', icon: 'sparkle', variant: 'primary', onClick: () => {
        const c = manager.current;
        const spec = { ...chipSpec() };
        if (c) spec.preset = c.resolved.preset; else spec.preset = pickInGroup();
        run(spec, 'Creo un nuovo paesaggio…');
      } });
      const btnRegen = button({ label: 'Rigenera', icon: 'reset', onClick: () => { if (manager.current) run({ ...manager.current.spec }, 'Rigenero…'); } });
      const btnClear = button({ label: 'Svuota', icon: 'trash', onClick: async () => {
        if (!manager.current) return;
        if (!(await confirmDialog('Togliere il paesaggio e tutti i suoi oggetti? (Annulla lo riporta indietro)', { title: 'Svuota paesaggio', okLabel: 'Svuota', danger: true }))) return;
        manager.clear();
        haptic('medium');
        sync();
      } });
      const btnSave = button({ label: 'Salva', icon: 'save', title: 'Salva paesaggio', onClick: save });
      for (const b of [btnRegen, btnClear, btnSave]) b.classList.add('small');
      const actions = h('div', { class: 'pv-row pv-ls-actions' }, btnNew, btnRegen, btnClear, btnSave);

      // ---- quick chips
      const mkChips = (key, list, title) => {
        const items = [{ id: 'auto', label: 'Auto' }, ...list.map((x) => ({ id: x.id, label: x.label }))];
        const c = chips({ items, value: prefs[key] || 'auto', onSelect: (id) => {
          prefs[key] = id === 'auto' ? null : id;
          savePrefs(prefs);
          c.setValue(id);
          haptic('tick');
          // an active landscape changes in place (objects and edits are kept)
          if (manager.current && id !== 'auto' && !manager.busy) { manager.setAtmosphere({ [key]: id }); sync(); }
        } });
        c.classList.add('pv-ls-chips');
        return section(title, [c], { collapsible: false });
      };
      const timeSec = mkChips('time', TIMES, 'Ora del giorno');
      const weatherSec = mkChips('weather', WEATHERS, 'Meteo');
      const seasonSec = mkChips('season', SEASONS, 'Stagione');
      const dens = chips({ items: DENSITY, value: prefs.density === null || prefs.density === undefined ? 'auto' : String(prefs.density), onSelect: (id) => {
        prefs.density = id === 'auto' ? null : +id; savePrefs(prefs); dens.setValue(id); haptic('tick');
      } });
      dens.classList.add('pv-ls-chips');
      const densSec = section('Quantità di oggetti', [dens, h('div', { class: 'pv-ls-note' }, 'Vale dal prossimo «Genera nuovo».')]);
      const quick = h('div', { class: 'pv-ls-quick' }, timeSec, weatherSec, seasonSec, densSec);

      // ---- preset cards by group
      const groupChips = chips({ items: GROUPS, value: prefs.group, onSelect: (id) => { prefs.group = id; savePrefs(prefs); groupChips.setValue(id); fillGrid(); } });
      groupChips.classList.add('pv-ls-groups');
      const grid = h('div', { class: 'pv-cards pv-ls-grid', style: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } });
      const cards = new Map();
      function fillGrid() {
        grid.innerHTML = '';
        cards.clear();
        for (const p of PRESETS.filter((q) => q.group === prefs.group)) {
          const vis = h('div', { class: 'pv-card-visual' }, presetThumb(p));
          const c = h('button', { type: 'button', class: 'pv-card pv-ls-card' }, vis, h('span', { class: 'pv-card-label' }, p.label));
          c.addEventListener('click', () => run({ ...chipSpec(), preset: p.id }, `Creo: ${p.label}…`));
          grid.appendChild(c);
          cards.set(p.id, c);
        }
        markActive();
      }
      function markActive() {
        const cur = manager.current?.resolved?.preset;
        for (const [id, c] of cards) c.classList.toggle('active', id === cur);
      }
      const pickInGroup = () => { const list = PRESETS.filter((q) => q.group === prefs.group); return list[Math.floor(Math.random() * list.length)]?.id; };
      const intro = h('div', { class: 'pv-ls-note' }, 'Tocca un paesaggio: viene creato intorno ai personaggi, ogni volta diverso. Ogni oggetto resta modificabile con Oggetti, Edifici, Esterni e Animali.');

      el.append(status, busyBar, actions, groupChips, grid, quick, intro);

      function sync() {
        const c = manager.current;
        status.innerHTML = '';
        if (c) {
          const p = PRESET_BY_ID.get(c.resolved.preset);
          const r = c.resolved;
          status.append(
            h('div', { class: 'pv-ls-title' }, p?.label || 'Paesaggio'),
            h('div', { class: 'pv-ls-sub' }, `${labelOf(TIMES, r.time)} · ${labelOf(WEATHERS, r.weather)} · ${labelOf(SEASONS, r.season)} · variante ${c.seed % 1000}`),
          );
        } else status.append(h('div', { class: 'pv-ls-title muted' }, 'Nessun paesaggio'), h('div', { class: 'pv-ls-sub' }, 'Scegli un paesaggio qui sotto o premi «Genera nuovo».'));
        btnRegen.disabled = !c || manager.busy;
        btnClear.disabled = !c || manager.busy;
        btnSave.disabled = !c || manager.busy;
        btnNew.disabled = manager.busy;
        markActive();
      }

      ui = {
        sync,
        setBusy(on, label) {
          el.classList.toggle('busy', !!on);
          busyBar.classList.toggle('on', !!on);
          if (on && label) { status.innerHTML = ''; status.append(h('div', { class: 'pv-ls-title' }, label), h('div', { class: 'pv-ls-sub' }, 'Un attimo…')); }
          for (const b of [btnNew, btnRegen, btnClear, btnSave]) b.disabled = !!on;
        },
        refreshThumb(id) {
          const c = cards.get(id), p = PRESET_BY_ID.get(id);
          if (!c || !p) return;
          c.querySelector('.pv-card-visual')?.replaceChildren(presetThumb(p));
        },
      };
      manager.addEventListener('progress', (e) => { if (e.total) busyBar.firstChild.style.width = `${Math.round((e.done / e.total) * 100)}%`; });
      manager.addEventListener('change', () => { if (!manager.busy) sync(); });
      fillGrid();
      sync();
      return { onShow: sync };
    },
  });
}
