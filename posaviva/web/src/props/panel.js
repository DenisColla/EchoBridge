// "Oggetti" panel: library (search, categories, lazy thumbnails, room presets)
// when nothing is selected, editor of the selected prop otherwise. A chip
// strip on top lists the props in the scene for quick selection.
import { h, section, slider, segmented, button, swatches, toggle, toast, haptic, icon, chips, confirmDialog } from '../ui/kit.js';
import { PROP_COLORS, TINT_COLORS } from './catalog.js';
import { SIDE_LABEL } from './manager.js';
import { buildLibrary } from './library.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const fmtM = (v) => `${v.toFixed(2)} m`;
const fmtDeg = (v) => `${Math.round(v)}°`;

export function registerPropsTool(app, shell, manager, gizmo, thumbs) {
  shell.registerTool({
    id: 'props', label: 'Oggetti', icon: 'cube', group: 'scene', order: 65, title: 'Oggetti di scena',
    build(el) {
      el.classList.add('pv-pr-panel');
      const strip = h('div', { class: 'pv-chips pv-pr-strip' });
      let library = null;
      const catalog = buildCatalog();
      const editorHost = h('div', { class: 'pv-pr-editor' });
      el.append(strip, catalog, editorHost);
      let editor = null; // {prop, sync()}
      let shown = false;

      // ------------------------------------------------------------ strip
      function renderStrip() {
        strip.innerHTML = '';
        const add = h('button', { type: 'button', class: 'pv-chip pv-pr-add' + (manager.selected ? '' : ' active') }, icon('plus', 18), 'Aggiungi');
        add.addEventListener('click', () => manager.select(null));
        strip.appendChild(add);
        const counts = {};
        for (const p of manager.props) {
          counts[p.type.id] = (counts[p.type.id] || 0) + 1;
          const n = manager.props.filter((q) => q.type.id === p.type.id).length > 1 ? ` ${counts[p.type.id]}` : '';
          const c = h('button', { type: 'button', class: 'pv-chip' + (p === manager.selected ? ' active' : '') }, p.hold ? icon('hand', 16) : null, p.label + n);
          c.addEventListener('click', () => manager.select(p));
          strip.appendChild(c);
        }
        strip.style.display = manager.props.length ? '' : 'none';
      }

      // ------------------------------------------------------------ catalog
      function buildCatalog() {
        library = buildLibrary({ thumbs, onAdd: addProp, onAddPreset: addPreset, panelBody: shell.panelBody });
        return library.el;
      }

      function addProp(id) {
        const ch = app.selection.character;
        const p = manager.add(id, { near: ch });
        if (!p) return;
        haptic(12);
        app.commit('aggiungi oggetto');
        if (p.hold) toast(`${p.label} nella mano ${SIDE_LABEL[p.hold.side]} di ${p.hold.ch.name}`);
        else if (p.isHand && ch) toast(`${ch.name} ha già le mani occupate: ${p.label.toLowerCase()} appoggiato a terra`);
      }

      async function addPreset(preset) {
        const list = await manager.addPreset(preset, { near: app.selection.character });
        if (!list.length) return;
        app.commit('aggiungi stanza');
        toast(`${preset.label}: ${list.length} oggetti. Tocca un mobile per modificarlo o spostare tutta la stanza.`, 3200);
      }

      // ------------------------------------------------------------ editor
      function buildEditor(p) {
        const parts = [];
        const syncers = [];
        const commit = (label) => app.commit(label);

        // header: name + actions
        const head = h('div', { class: 'pv-pr-head' },
          h('div', { class: 'pv-pr-title' }, p.label),
          button({ icon: 'copy', small: true, title: 'Duplica', onClick: () => { manager.duplicate(p); commit('duplica oggetto'); } }),
          button({ icon: 'trash', small: true, variant: 'danger', title: 'Elimina', onClick: () => { manager.remove(p); commit('elimina oggetto'); } }),
          button({ icon: 'check', small: true, title: 'Fine', onClick: () => manager.select(null) }),
        );
        parts.push(head);

        // ---- realistic model still loading
        if (p.type.model) {
          const loading = h('div', { class: 'pv-pr-note pv-pr-loading' }, 'Caricamento del modello…');
          parts.push(loading);
          syncers.push(() => { loading.style.display = p.loading ? '' : 'none'; });
        }

        // ---- new random variant
        if (p.type.params.some((d) => d.type === 'seed')) {
          parts.push(h('div', { class: 'pv-row pv-pr-actions' }, button({ label: 'Rigenera', icon: 'sparkle', variant: 'primary', onClick: () => {
            manager.regenerate(p); haptic(10); commit('rigenera oggetto');
          } }), h('div', { class: 'pv-pr-note pv-pr-inline' }, 'Nuova variante casuale')));
        }

        // ---- room preset group
        if (p.group) {
          const n = manager.groupOf(p).length;
          const together = toggle({ label: 'Muovi tutta la stanza', value: manager.moveTogether, onChange: (v) => { manager.moveTogether = v; } });
          const del = button({ label: 'Elimina stanza', icon: 'trash', variant: 'danger', small: true, onClick: async () => {
            if (await confirmDialog(`Eliminare tutti i ${manager.groupOf(p).length} oggetti della stanza?`, { title: 'Elimina stanza', okLabel: 'Elimina', danger: true })) { manager.removeGroup(p); commit('elimina stanza'); }
          } });
          const split = button({ label: 'Separa', icon: 'unlock', small: true, onClick: () => { manager.ungroup(p); commit('separa oggetto'); editor = null; render(); } });
          parts.push(section(`Stanza (${n} oggetti)`, [h('div', { class: 'pv-pr-note' }, 'Con “Muovi tutta la stanza” trascini o ruoti tutti i mobili insieme.'), together, h('div', { class: 'pv-row pv-pr-actions' }, split, del)]));
          syncers.push(() => together.setValue(manager.moveTogether));
        }

        // ---- hand
        if (p.isHand) {
          const status = h('div', { class: 'pv-pr-note' });
          const sideSeg = segmented({
            options: [{ value: 'L', label: 'Sinistra' }, { value: 'R', label: 'Destra' }], value: p.hold?.side || 'R',
            onChange: (v) => {
              if (p.hold) {
                if (p.hold.side === v) return;
                manager.attach(p, p.hold.ch, v, { pose: true });
                commit('cambia mano');
              }
            },
          });
          const attachBtn = button({ label: 'Attacca alla mano', icon: 'hand', variant: 'primary', onClick: () => {
            const ch = app.selection.character;
            if (!ch) { toast('Seleziona prima un personaggio'); return; }
            const side = sideSeg.querySelector('.active')?.dataset.value || 'R';
            if (manager.attach(p, ch, side, { pose: true })) { haptic(12); commit('attacca alla mano'); toast(`${p.label} nella mano ${SIDE_LABEL[side]} di ${ch.name}`); }
          } });
          const detachBtn = button({ label: 'Stacca', icon: 'unlock', onClick: () => { manager.detach(p); commit('stacca oggetto'); } });
          const closeBtn = button({ label: 'Chiudi la mano', icon: 'hand', small: true, onClick: () => { if (manager.closeHand(p)) commit('chiudi mano'); } });
          const [smin, smax] = p.type.hand.slide(p.params);
          const slide = slider({ label: 'Posizione presa', min: smin, max: smax, step: 0.005, value: p.grip.slide, defaultValue: 0, center: smin < 0 && smax > 0, format: (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)} cm`,
            onInput: (v) => manager.setGrip(p, { slide: v }), onChange: () => commit('presa') });
          const twist = slider({ label: 'Rotazione presa', min: -180, max: 180, step: 1, value: p.grip.twist * R2D, defaultValue: 0, format: fmtDeg,
            onInput: (v) => manager.setGrip(p, { twist: v * D2R }), onChange: () => commit('presa') });
          const flip = toggle({ label: 'Presa invertita', value: p.grip.flip, onChange: (v) => { manager.setGrip(p, { flip: v }); commit('presa'); } });
          const heldBox = h('div', {}, h('div', { class: 'pv-row pv-pr-actions' }, detachBtn, closeBtn), slide, twist, flip);
          const freeBox = h('div', {}, h('div', { class: 'pv-row pv-pr-actions' }, attachBtn));
          parts.push(section('Mano', [status, sideSeg, heldBox, freeBox]));
          syncers.push(() => {
            const held = !!p.hold;
            const ch = held ? p.hold.ch : app.selection.character;
            status.textContent = held ? `In mano a ${p.hold.ch.name} (${SIDE_LABEL[p.hold.side]})`
              : ch ? `Personaggio selezionato: ${ch.name}` : 'Seleziona un personaggio per dargli l’oggetto in mano.';
            heldBox.style.display = held ? '' : 'none';
            freeBox.style.display = held ? 'none' : '';
            attachBtn.disabled = !ch;
            if (held) sideSeg.setValue(p.hold.side);
            slide.setValue(p.grip.slide); twist.setValue(p.grip.twist * R2D); flip.setValue(p.grip.flip);
          });
        }

        // ---- placement (free props)
        const yaw = slider({ label: 'Rotazione', min: -180, max: 180, step: 1, value: p.yaw * R2D, defaultValue: 0, format: fmtDeg,
          onInput: (v) => manager.setYaw(p, (gizmo.snap ? Math.round(v / 15) * 15 : v) * D2R), onChange: () => commit('ruota oggetto') });
        const snap = toggle({ label: 'Scatto 15°', value: gizmo.snap, onChange: (v) => gizmo.setSnap(v) });
        const height = slider({ label: 'Altezza da terra', min: -1, max: 3, step: 0.01, value: p.root.position.y, defaultValue: 0, center: false, format: fmtM,
          onInput: (v) => manager.setHeight(p, v), onChange: () => commit('altezza oggetto') });
        const groundBtn = button({ label: 'Appoggia a terra', icon: 'ground', onClick: () => {
          const s = manager.ground(p);
          commit('appoggia oggetto');
          toast(s ? `Appoggiato su: ${s.label.toLowerCase()}` : 'Appoggiato a terra', 1500);
        } });
        const straightBtn = button({ label: 'Raddrizza', icon: 'reset', onClick: () => { manager.ground(p, { straighten: true }); commit('raddrizza oggetto'); } });
        const tiltX = slider({ label: 'Inclina avanti / indietro', min: -90, max: 90, step: 1, value: p.root.rotation.x * R2D, defaultValue: 0, format: fmtDeg,
          onInput: (v) => manager.setTilt(p, v * D2R, p.root.rotation.z), onChange: () => commit('inclina oggetto') });
        const tiltZ = slider({ label: 'Inclina di lato', min: -90, max: 90, step: 1, value: p.root.rotation.z * R2D, defaultValue: 0, format: fmtDeg,
          onInput: (v) => manager.setTilt(p, p.root.rotation.x, v * D2R), onChange: () => commit('inclina oggetto') });
        const place = section('Posizione', [
          h('div', { class: 'pv-pr-note' }, 'Trascina l’oggetto per spostarlo, l’anello per ruotarlo, la freccia per alzarlo.'),
          yaw, snap, height, h('div', { class: 'pv-row pv-pr-actions' }, groundBtn, straightBtn),
          section('Inclinazione', [tiltX, tiltZ], { collapsible: true, collapsed: !p.tilted }),
        ]);
        parts.push(place);
        syncers.push(() => {
          place.style.display = p.hold ? 'none' : '';
          yaw.setValue(p.yaw * R2D);
          height.setValue(p.root.position.y);
          tiltX.setValue(p.root.rotation.x * R2D);
          tiltZ.setValue(p.root.rotation.z * R2D);
          straightBtn.style.display = p.tilted || p.isHand ? '' : 'none';
        });

        // ---- dimensions
        const dims = [];
        const paramCtl = new Map();
        for (const d of p.type.params) {
          let ctl;
          if (d.type === 'seed') continue;
          if (d.type === 'seg' && d.options.length > 3) {
            ctl = chips({ items: d.options.map((o) => ({ id: String(o.value), label: o.label })), value: String(p.params[d.id]), onSelect: (v) => {
              const opt = d.options.find((o) => String(o.value) === v);
              manager.setParams(p, { [d.id]: opt.value }); ctl.setValue(v); commit('modifica oggetto'); sync();
            } });
            ctl.classList.add('pv-pr-segchips');
            const set = ctl.setValue; ctl.setValue = (v) => set(String(v));
          } else if (d.type === 'seg') ctl = segmented({ options: d.options, value: p.params[d.id], onChange: (v) => { manager.setParams(p, { [d.id]: v }); commit('modifica oggetto'); sync(); } });
          else if (d.type === 'toggle') ctl = toggle({ label: d.label, value: p.params[d.id], onChange: (v) => { manager.setParams(p, { [d.id]: v }); commit('modifica oggetto'); } });
          else {
            const fmt = d.type === 'int' ? (v) => String(Math.round(v)) : d.unit === 'm' ? fmtM : (v) => `${Math.round(v * 100)}%`;
            ctl = slider({ label: d.label, min: d.min, max: d.max, step: d.step, value: p.params[d.id], defaultValue: d.default, center: d.min < 0 && d.max > 0, format: fmt,
              onInput: (v) => schedule(() => manager.setParams(p, { [d.id]: v })), onChange: () => commit('modifica oggetto') });
          }
          paramCtl.set(d.id, ctl);
          dims.push(d.type === 'seg' ? h('div', { class: 'pv-pr-field' }, h('div', { class: 'pv-pr-label' }, d.label), ctl) : ctl);
        }
        const scale = slider({ label: 'Scala', min: 0.25, max: 3, step: 0.01, value: p.scale, defaultValue: 1, center: false, format: (v) => `${Math.round(v * 100)}%`,
          onInput: (v) => manager.setScale(p, v), onChange: () => { if (p.hold) manager.closeHand(p); commit('scala oggetto'); } });
        dims.push(scale);
        parts.push(section(p.type.model ? 'Dimensioni' : 'Forma e dimensioni', dims));
        syncers.push(() => {
          for (const d of p.type.params) paramCtl.get(d.id)?.setValue(p.params[d.id]);
          scale.setValue(p.scale);
          // the opening offset only makes sense with an opening
          if (p.type.id === 'muro') paramCtl.get('offset').style.display = p.params.opening === 'none' ? 'none' : '';
        });

        // ---- color (realistic models: tint over the original textures)
        const sw = swatches({ colors: p.type.model ? TINT_COLORS : PROP_COLORS, value: p.color, onChange: (c) => { manager.setColor(p, c); commit('colore oggetto'); } });
        parts.push(p.type.model ? section('Tinta', [h('div', { class: 'pv-pr-note' }, 'Bianco = colori originali del modello.'), sw]) : section('Colore', [sw]));
        syncers.push(() => sw.setValue(p.color));

        const root = h('div', {}, parts);
        function sync() { for (const s of syncers) s(); }
        sync();
        return { prop: p, el: root, sync };
      }

      // throttle heavy rebuilds (geometry) to animation frames while dragging sliders
      let pendingFn = null;
      function schedule(fn) {
        if (pendingFn) { pendingFn = fn; return; }
        pendingFn = fn;
        requestAnimationFrame(() => { const f = pendingFn; pendingFn = null; f?.(); });
      }

      function render() {
        renderStrip();
        const p = manager.selected;
        catalog.style.display = p ? 'none' : '';
        if (!p) {
          if (editor) shell.panelBody.scrollTop = 0;
          editor = null; editorHost.innerHTML = ''; return;
        }
        if (!editor || editor.prop !== p) {
          editor = buildEditor(p);
          editorHost.innerHTML = '';
          editorHost.appendChild(editor.el);
          shell.panelBody.scrollTop = 0;
        } else editor.sync();
      }

      // sync values while dragging handles (once per frame)
      let syncQueued = false;
      manager.addEventListener('change', () => {
        if (!shown || syncQueued) return;
        syncQueued = true;
        requestAnimationFrame(() => { syncQueued = false; if (editor && manager.props.includes(editor.prop)) editor.sync(); });
      });
      manager.addEventListener('list', () => { if (shown) render(); });
      manager.addEventListener('select', () => { if (shown) render(); });
      app.addEventListener('selection', () => { if (shown && editor) editor.sync(); });
      app.addEventListener('loaded', () => { if (shown) render(); });

      return {
        onShow() { shown = true; render(); app.invalidate(); },
        onHide() { shown = false; shell.hint(''); app.invalidate(); },
      };
    },
  });
}
