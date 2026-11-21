// Modal sheets of the io module: scene browser, save flow, unsaved-changes
// guard, image export, settings, info & credits.
import { h, icon, iconButton, button, segmented, toggle, section, toast, haptic, modal, confirmDialog, promptDialog, sheetMenu } from '../ui/kit.js';
import { formatBytes, store } from './storage.js';
import { sceneSlug } from './scenes.js';
import { stamp } from './exporter.js';

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export function formatDate(t) {
  const d = new Date(t), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff === 0) return `Oggi, ${hm}`;
  if (diff === 1) return `Ieri, ${hm}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}, ${hm}`;
}

/** Non-dismissable progress dialog. -> {close()} */
export function busy(text) {
  const m = modal({ body: h('div', { class: 'pv-io-busy' }, h('span', { class: 'pv-io-spinner' }), h('span', {}, text)), dismissable: false, className: 'pv-io-busy-card' });
  return { close: () => m.close(null), setText: (t) => { m.body.querySelector('span:last-child').textContent = t; } };
}

/** Shown when the storage is full. */
export function quotaDialog(ctx) {
  return modal({
    title: 'Memoria piena', icon: 'storage', danger: true,
    body: h('p', { class: 'pv-modal-text' }, 'Non c\'è più spazio per salvare nell\'app. Elimina qualche scena che non usi più, oppure esportala su file (.json) e poi eliminala.'),
    actions: [{ label: 'Chiudi', variant: 'ghost', value: null }, { label: 'Gestisci scene', variant: 'primary', value: 'open', onClick: () => { setTimeout(() => openScenes(ctx), 0); } }],
  }).result;
}

// ---------------------------------------------------------------- save / unsaved guard
/** Saves the current scene (asks a name the first time). -> true when saved */
export async function saveScene(ctx, { asNew = false, askName = false } = {}) {
  const s = ctx.scenes;
  let name = s.current.name;
  if (asNew || askName || !s.current.id) {
    const suggestion = !s.current.id && name === 'Senza titolo' ? `Scena ${s.list().length + 1}` : asNew ? `${name} (copia)` : name;
    name = await promptDialog('Nome della scena', suggestion, { title: asNew ? 'Salva come nuova scena' : 'Salva scena', okLabel: 'Salva', maxLength: 48 });
    if (!name) return false;
  }
  const b = busy('Salvataggio…');
  let r;
  try { r = await s.save({ name, asNew }); } finally { b.close(); }
  if (r.ok) {
    haptic('success');
    toast(`Scena «${r.entry.name}» salvata`, { kind: 'ok', action: asNew ? null : { label: 'Salva come nuova', onClick: () => saveScene(ctx, { asNew: true }) } });
    return true;
  }
  if (r.quota) await quotaDialog(ctx);
  else toast(`Salvataggio non riuscito: ${r.error?.message || 'errore'}`, { kind: 'error' });
  return false;
}

/** Before replacing the scene: 'proceed' | null (cancelled). */
export async function guardUnsaved(ctx, what = 'continuare') {
  if (!ctx.scenes.dirty) return 'proceed';
  const v = await modal({
    title: 'Modifiche non salvate', icon: 'warning',
    body: h('p', { class: 'pv-modal-text' }, `La scena «${ctx.scenes.current.name}» ha modifiche non salvate. Vuoi salvarla prima di ${what}?`),
    actions: [
      { label: 'Annulla', value: null, variant: 'ghost' },
      { label: 'Non salvare', value: 'discard', variant: 'danger' },
      { label: 'Salva', value: 'save', variant: 'primary', icon: 'save' },
    ],
  }).result;
  if (v === 'discard') return 'proceed';
  if (v === 'save') return (await saveScene(ctx)) ? 'proceed' : null;
  return null;
}

export async function newScene(ctx) {
  if (!(await guardUnsaved(ctx, 'creare una nuova scena'))) return;
  ctx.scenes.newScene();
  ctx.shell.closePanel();
  haptic('success');
  toast('Nuova scena', { kind: 'ok', ms: 1500 });
}

export async function openSavedScene(ctx, id) {
  if (ctx.scenes.current.id === id && !ctx.scenes.dirty) return true;
  if (!(await guardUnsaved(ctx, 'aprire un\'altra scena'))) return false;
  try {
    const e = ctx.scenes.open(id);
    haptic('success');
    toast(`Aperta «${e.name}»`, { kind: 'ok', ms: 1600 });
    return true;
  } catch (err) {
    toast(`Impossibile aprire la scena: ${err.message}`, { kind: 'error' });
    return false;
  }
}

// ---------------------------------------------------------------- files
export function exportSceneFile(ctx) {
  const name = `${sceneSlug(ctx.scenes.current.name)}.posaviva.json`;
  const r = ctx.exporter.saveText(ctx.scenes.exportText(), name, 'application/json');
  if (r.ok) { haptic('success'); toast(`File scena salvato in ${r.where}`, { kind: 'ok' }); }
  else toast(`Esportazione non riuscita: ${r.error}`, { kind: 'error' });
}

export async function importSceneFile(ctx) {
  const f = await ctx.exporter.pickTextFile();
  if (!f) return;
  if (f.error) { toast(`Impossibile leggere il file: ${f.error}`, { kind: 'error' }); return; }
  let parsed;
  try { parsed = ctx.scenes.parseFile(f.text, f.name); } catch (e) { haptic('error'); toast(e.message, { kind: 'error', ms: 3200 }); return; }
  if (!(await guardUnsaved(ctx, 'importare la scena'))) return;
  try {
    ctx.scenes.load(parsed.json, { id: null, name: parsed.name, clean: false });
    haptic('success');
    toast(`Importata «${parsed.name}»`, { kind: 'ok', action: { label: 'Salva', onClick: () => saveScene(ctx) } });
  } catch (e) { toast(`Importazione non riuscita: ${e.message}`, { kind: 'error' }); }
}

// ---------------------------------------------------------------- scene browser
export function openScenes(ctx) {
  const s = ctx.scenes;
  const grid = h('div', { class: 'pv-io-scene-grid' });
  const usage = h('div', { class: 'pv-modal-subtitle' });
  const saveBtn = button({ label: 'Salva scena corrente', icon: 'save', variant: 'primary', onClick: async () => { if (await saveScene(ctx, { askName: !s.current.id })) render(); } });
  const importBtn = button({ label: 'Importa', icon: 'upload', onClick: () => { m.close(null); importSceneFile(ctx); } });
  const body = h('div', {}, h('div', { class: 'pv-io-scene-actions' }, saveBtn, importBtn), grid);
  const m = modal({ title: 'Le mie scene', icon: 'folder', kind: 'sheet', body, className: 'pv-io-scenes' });
  m.card.querySelector('.pv-modal-titles').appendChild(usage);

  function render() {
    const list = s.list();
    usage.textContent = `${list.length === 1 ? '1 scena salvata' : `${list.length} scene salvate`} · ${formatBytes(store.usage())} usati`;
    grid.replaceChildren();
    if (!list.length) {
      grid.appendChild(h('div', { class: 'pv-io-empty wide' }, icon('folder', 36), h('strong', {}, 'Nessuna scena salvata'),
        h('span', {}, 'Salva la scena corrente per ritrovarla qui con personaggi, pose, luci e camera.')));
      return;
    }
    for (const e of list) {
      const isCur = e.id === s.current.id;
      const more = iconButton({ icon: 'more', title: 'Azioni', onClick: (ev) => { ev.stopPropagation(); actions(e, more); } });
      const card = h('div', { class: `pv-io-scene ${isCur ? 'current' : ''}`.trim(), role: 'button', tabindex: '0' },
        h('div', { class: 'pv-io-scene-thumb' }, e.thumb ? h('img', { src: e.thumb, alt: '', loading: 'lazy' }) : icon('image', 30),
          isCur ? h('span', { class: 'pv-io-scene-badge' }, s.dirty ? 'Aperta · modificata' : 'Aperta') : null,
          h('span', { class: 'pv-io-scene-count', title: 'Personaggi' }, icon('user', 13), String(e.data.characters.length))),
        h('div', { class: 'pv-io-scene-meta' },
          h('div', { class: 'pv-io-scene-text' }, h('div', { class: 'pv-io-scene-name' }, e.name), h('div', { class: 'pv-io-scene-date' }, formatDate(e.date))),
          more));
      card.addEventListener('click', async () => { haptic('tick'); if (await openSavedScene(ctx, e.id)) m.close(e.id); });
      grid.appendChild(card);
    }
  }

  async function actions(e, anchor) {
    await sheetMenu([
      { id: 'open', label: 'Apri', icon: 'folder', onClick: async () => { if (await openSavedScene(ctx, e.id)) m.close(e.id); } },
      { id: 'rename', label: 'Rinomina', icon: 'edit', onClick: async () => {
        const n = await promptDialog('Nome della scena', e.name, { title: 'Rinomina scena', okLabel: 'Salva', maxLength: 48 });
        if (n && n !== e.name) { const r = s.rename(e.id, n); if (!r.ok && r.quota) quotaDialog(ctx); render(); }
      } },
      { id: 'dup', label: 'Duplica', icon: 'copy', onClick: () => { const r = s.duplicate(e.id); if (!r.ok && r.quota) quotaDialog(ctx); render(); } },
      { id: 'file', label: 'Esporta file (.json)', icon: 'download', onClick: () => {
        const r = ctx.exporter.saveText(JSON.stringify({ ...e.data, name: e.name }), `${sceneSlug(e.name)}.posaviva.json`);
        if (r.ok) toast(`File salvato in ${r.where}`, { kind: 'ok' }); else toast(`Esportazione non riuscita: ${r.error}`, { kind: 'error' });
      } },
      { separator: true },
      { id: 'del', label: 'Elimina', icon: 'trash', danger: true, onClick: async () => {
        if (await confirmDialog(`«${e.name}» verrà eliminata definitivamente.`, { title: 'Eliminare la scena?', okLabel: 'Elimina', danger: true, icon: 'trash' })) {
          s.remove(e.id); render(); toast('Scena eliminata', 1600);
        }
      } },
    ], { title: e.name, anchor });
  }

  const onChange = () => render();
  s.addEventListener('change', onChange);
  m.result.then(() => s.removeEventListener('change', onChange));
  render();
  return m;
}

// ---------------------------------------------------------------- export image
export function openExport(ctx, { share = false } = {}) {
  const { exporter, settings, app } = ctx;
  let scale = settings.get('exportScale') || 2;
  let transparent = !!settings.get('exportTransparent');
  const guides = app.sceneTools?.guides;
  const frameRect = guides?.getFrameRectNormalized?.() || null;
  let crop = frameRect ? settings.get('exportCrop') !== false : false;
  // perspective guides drawn into the picture (only offered while some guide is shown)
  const guidesShown = !!guides?.active && typeof guides.drawOnCapture === 'function';
  let withGuides = guidesShown && settings.get('exportGuides') === true;
  /** capture -> optional guides -> optional crop to the comic panel */
  const compose = (canvas) => {
    if (withGuides) guides.drawOnCapture(canvas, { crop: crop && !!frameRect });
    return crop && frameRect ? exporter.crop(canvas, frameRect) : canvas;
  };

  const preview = h('div', { class: 'pv-io-export-preview' }, h('span', { class: 'pv-io-spinner' }));
  const sizeLabel = h('div', { class: 'pv-io-export-size' });
  const updateSize = () => {
    const sz = exporter.exportSize(scale);
    const w = crop && frameRect ? Math.round(sz.w * frameRect.w) : sz.w, hh = crop && frameRect ? Math.round(sz.h * frameRect.h) : sz.h;
    sizeLabel.textContent = `${w} × ${hh} px · PNG${transparent ? ' con trasparenza' : ''}`;
  };
  const scaleSeg = segmented({ options: [{ value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 3, label: '3×' }], value: scale,
    onChange: (v) => { haptic('tick'); scale = +v; settings.set('exportScale', scale); updateSize(); } });
  const transpToggle = toggle({ label: 'Sfondo trasparente', value: transparent, onChange: (v) => { transparent = v; settings.set('exportTransparent', v); updateSize(); renderPreview(); } });
  const cropToggle = frameRect ? toggle({ label: 'Ritaglia alla vignetta', value: crop, onChange: (v) => { crop = v; settings.set('exportCrop', v); updateSize(); renderPreview(); } }) : null;
  const guidesToggle = guidesShown ? toggle({ label: 'Includi le guide prospettiche', value: withGuides, onChange: (v) => { withGuides = v; settings.set('exportGuides', v); renderPreview(); } }) : null;
  const note = h('p', { class: 'pv-io-note' }, guidesShown
    ? 'Maniglie, selezione e altri strumenti a schermo non compaiono nell\'immagine.'
    : 'Gli strumenti a schermo non compaiono nell\'immagine. Le guide prospettiche si attivano in Camera › Guide.');

  const body = h('div', { class: 'pv-io-export' },
    preview,
    h('div', { class: 'pv-io-export-opts' },
      section('Risoluzione', [scaleSeg, sizeLabel]),
      section('Opzioni', [transpToggle, cropToggle, guidesToggle, note])));
  const m = modal({
    title: share ? 'Condividi immagine' : 'Esporta immagine', icon: share ? 'share' : 'image', kind: 'sheet', body, className: 'pv-io-export-sheet',
    actions: share
      ? [{ label: 'Salva', icon: 'download', variant: 'ghost', onClick: () => { run(false); return false; } }, { label: 'Condividi', icon: 'share', variant: 'primary', onClick: () => { run(true); return false; } }]
      : [{ label: 'Condividi', icon: 'share', variant: 'ghost', onClick: () => { run(true); return false; } }, { label: exporter.hasBridge ? 'Salva in Galleria' : 'Scarica PNG', icon: 'download', variant: 'primary', onClick: () => { run(false); return false; } }],
  });
  updateSize();

  let prevToken = 0;
  async function renderPreview() {
    const tok = ++prevToken;
    try {
      const c = app.canvas;
      const big = await exporter.capture({ height: Math.min(360, Math.round((c.clientHeight || 360) * 0.6)), transparent });
      if (tok !== prevToken) return;
      const out = compose(big);
      out.className = 'pv-io-export-canvas';
      preview.classList.toggle('checker', transparent);
      preview.replaceChildren(out);
    } catch (e) { console.warn('[PosaViva] preview failed', e); preview.replaceChildren(icon('image', 30)); }
  }
  // after the enter transition: the capture blocks the main thread briefly
  setTimeout(renderPreview, 260);

  let running = false;
  async function run(doShare) {
    if (running) return;
    running = true;
    haptic('tick');
    const b = busy('Preparo l\'immagine…');
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the progress dialog paint
      const canvas = compose(await exporter.capture({ scale, transparent }));
      const name = stamp();
      const r = doShare ? await exporter.shareImage(canvas, name) : await exporter.saveImage(canvas, name);
      b.close();
      if (r.ok) {
        m.close(doShare ? 'share' : 'save');
        haptic('success');
        if (!r.shared) toast(`Immagine salvata in ${r.where}`, { kind: 'ok', ms: 2800 });
      } else if (!r.cancelled) toast(`Esportazione non riuscita: ${r.error}`, { kind: 'error', ms: 3500 });
    } catch (e) {
      b.close();
      (app.contextLost ? console.warn : console.error)(e);
      toast(`Esportazione non riuscita: ${e.message || e}`, { kind: 'error', ms: 3500 });
    } finally { running = false; }
  }
  return m;
}

// ---------------------------------------------------------------- settings
export const QUALITY_OPTS = [{ value: 'alta', label: 'Alta' }, { value: 'media', label: 'Media' }, { value: 'bassa', label: 'Bassa' }];
export const QUALITY_CAP = { alta: 2, media: 1.5, bassa: 1 };

export function currentQuality(ctx) {
  return ctx.app.modules.render?.prefs?.quality || ctx.settings.get('quality') || 'alta';
}

/** Applies a quality level (render module when present, else a pixel-ratio cap). */
export function applyQuality(ctx, q) {
  const render = ctx.app.modules.render;
  ctx.settings.set('quality', q);
  if (typeof render?.setQuality === 'function') render.setQuality(q);
  else if (typeof ctx.app.setQuality === 'function') ctx.app.setQuality(q);
  else {
    const r = ctx.app.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_CAP[q] || 2));
    ctx.app.invalidate();
  }
}

export function openSettings(ctx) {
  const { settings, scenes } = ctx;
  const usage = h('div', { class: 'pv-io-setting-value' });
  const refreshUsage = () => { const n = scenes.list().length; usage.textContent = `${n === 1 ? '1 scena' : `${n} scene`} · ${formatBytes(store.usage())}`; };
  refreshUsage();
  const body = h('div', { class: 'pv-io-settings' },
    section('Grafica', [
      h('div', { class: 'pv-io-setting-label' }, icon('gauge', 20), h('span', {}, 'Qualità di resa')),
      segmented({ options: QUALITY_OPTS, value: currentQuality(ctx), onChange: (v) => { haptic('tick'); applyQuality(ctx, v); } }),
      h('p', { class: 'pv-io-note' }, 'Alta: massimo dettaglio. Bassa: più fluida e consuma meno batteria.'),
    ]),
    section('Interazione', [
      settingToggle('vibrate', 'Vibrazione', 'Piccolo feedback al tocco', settings.get('haptics') !== false, (v) => { settings.set('haptics', v); if (v) haptic('medium'); }),
      settingToggle('sparkle', 'Suggerimenti', 'Consigli brevi la prima volta che apri uno strumento', settings.get('tips') !== false, (v) => settings.set('tips', v)),
    ]),
    section('Lingua', [
      h('div', { class: 'pv-io-setting-row static' }, icon('globe', 20), h('div', { class: 'pv-io-setting-text' }, h('span', {}, 'Lingua dell\'app'), h('small', {}, 'Altre lingue in arrivo')), h('span', { class: 'pv-io-setting-value' }, 'Italiano')),
    ]),
    section('Aiuto', [
      h('div', { class: 'pv-io-setting-row' }, icon('help', 20), h('div', { class: 'pv-io-setting-text' }, h('span', {}, 'Guida'), h('small', {}, 'Istruzioni passo per passo di tutte le funzioni')),
        button({ label: 'Apri', small: true, onClick: () => { m.close(null); ctx.actions.openGuide(); } })),
      h('div', { class: 'pv-io-setting-row' }, icon('bookOpen', 20), h('div', { class: 'pv-io-setting-text' }, h('span', {}, 'Tutorial iniziale'), h('small', {}, 'Rivedi le schede di benvenuto e riattiva i suggerimenti')),
        button({ label: 'Ripristina', small: true, onClick: () => { m.close(null); ctx.actions.restartTutorial(); } })),
    ]),
    section('Archivio', [
      h('div', { class: 'pv-io-setting-row' }, icon('storage', 20), h('div', { class: 'pv-io-setting-text' }, h('span', {}, 'Scene salvate'), usage),
        button({ label: 'Gestisci', small: true, onClick: () => { m.close(null); openScenes(ctx); } })),
      button({ label: 'Elimina tutte le scene salvate', icon: 'trash', variant: 'danger', small: true, onClick: async () => {
        if (!scenes.list().length) { toast('Non ci sono scene salvate', 1600); return; }
        if (await confirmDialog('Tutte le scene salvate verranno eliminate definitivamente. La scena aperta resta sullo schermo.', { title: 'Eliminare tutte le scene?', okLabel: 'Elimina tutto', danger: true, icon: 'trash' })) {
          scenes.removeAll(); refreshUsage(); toast('Scene eliminate', 1600);
        }
      } }),
    ]),
    h('button', { type: 'button', class: 'pv-io-about-link', onClick: () => { m.close(null); openInfo(ctx); } }, icon('info', 18), 'Info e crediti'),
  );
  const m = modal({ title: 'Impostazioni', icon: 'settings', kind: 'sheet', body, className: 'pv-io-settings-sheet' });
  return m;
}

function settingToggle(ic, label, sub, value, onChange) {
  const t = toggle({ label: '', value, onChange: (v) => { haptic('tick'); onChange(v); } });
  t.classList.add('pv-io-setting-row');
  t.prepend(icon(ic, 20), h('div', { class: 'pv-io-setting-text' }, h('span', {}, label), h('small', {}, sub)));
  t.querySelector(':scope > span:not(.pv-toggle-track):not(.pv-io-setting-text)')?.remove();
  return t;
}

// ---------------------------------------------------------------- info & credits
export function appVersion() {
  try { const d = JSON.parse(window.AndroidBridge?.getDeviceInfo?.() || '{}'); return { version: d.appVersion || '1.0', device: d }; } catch { return { version: '1.0', device: {} }; }
}

/** App logo: the splash / launcher artwork (wooden mannequin) when available. */
function brandLogo(ctx) {
  if (!ctx.logoSVG) return h('div', { class: 'pv-io-logo' }, icon('pose', 34));
  const el = h('div', { class: 'pv-io-logo art', 'aria-hidden': 'true' });
  el.innerHTML = ctx.logoSVG;
  return el;
}

export function openInfo(ctx) {
  const { version, device } = appVersion();
  const dev = device.model ? `${device.manufacturer ? device.manufacturer + ' ' : ''}${device.model} · Android ${device.release || ''}${device.maxRefreshRate ? ` · ${Math.round(device.maxRefreshRate)} Hz` : ''}` : null;
  const body = h('div', { class: 'pv-io-info' },
    h('div', { class: 'pv-io-brand' }, brandLogo(ctx), h('div', {}, h('div', { class: 'pv-io-brand-name' }, 'PosaViva'), h('div', { class: 'pv-io-brand-sub' }, `Versione ${version} · Manichini 3D posabili per fumettisti`))),
    section('Gesti', [
      h('ul', { class: 'pv-io-gestures' },
        h('li', {}, icon('tap', 20), h('span', {}, h('b', {}, 'Tocca'), ' una parte del corpo per selezionarla')),
        h('li', {}, icon('rotate', 20), h('span', {}, h('b', {}, 'Trascina gli anelli'), ' per ruotare l\'articolazione')),
        h('li', {}, icon('orbit', 20), h('span', {}, h('b', {}, 'Un dito'), ' sullo sfondo per girare attorno alla scena')),
        h('li', {}, icon('pinch', 20), h('span', {}, h('b', {}, 'Due dita'), ' per spostare e zoomare')),
        h('li', {}, icon('zoom', 20), h('span', {}, h('b', {}, 'Zoom rapido'), ' (in basso a destra) per inquadrare testa, mani o piedi'))),
      button({ label: 'Apri la guida completa', icon: 'help', small: true, onClick: () => { m.close(null); ctx.actions.openGuide(); } }),
    ]),
    section('Crediti', [
      h('p', { class: 'pv-io-credit' }, h('b', {}, 'Modello umano: MakeHuman. '), 'Mesh di base, target delle forme, scheletro ed occhi provengono dal progetto MakeHuman (makehumancommunity.org) e sono rilasciati con licenza ', h('b', {}, 'CC0 1.0'), ' (pubblico dominio). Grazie alla comunità MakeHuman!'),
      h('p', { class: 'pv-io-credit' }, h('b', {}, 'Motore 3D: three.js '), '(licenza MIT).'),
      h('p', { class: 'pv-io-credit' }, h('b', {}, 'Oggetti, piante e rocce realistici: Poly Haven. '), 'Modelli 3D di polyhaven.com con licenza ', h('b', {}, 'CC0'), ' (pubblico dominio); elenco completo degli autori in assets/props/CREDITS.txt e assets/city/CREDITS.txt.'),
      h('p', { class: 'pv-io-credit' }, h('b', {}, 'Animali, edifici, veicoli e strade '), 'sono generati dal codice di PosaViva.'),
      h('p', { class: 'pv-io-credit muted' }, 'Il codice di PosaViva è originale: non include codice del programma MakeHuman.'),
      dev ? h('p', { class: 'pv-io-credit muted' }, `Dispositivo: ${dev}`) : null,
    ]),
  );
  const m = modal({ title: 'Info e crediti', icon: 'info', kind: 'sheet', body, className: 'pv-io-info-sheet' });
  return m;
}
