// "Corpo" tool: sex, body type (3 female / 3 male presets shown with their body
// shape), proportion & shape sliders, skin & eye colors.
// Also serves as the reference example of a module + panel built with ui/kit.js.
//
// Slider drags rebuild the rest shape at most once per rendered frame (from a
// render hook, so the new shape is drawn in the same frame). Clothes and hair
// listen to the 'shape' event and rebuild themselves once the drag pauses; one
// undo step is recorded on release.
import { h, icon, section, slider, segmented, swatches, button, haptic } from '../ui/kit.js';

export const SKIN_TONES = ['#f6d7c3', '#eac0a2', '#e0b49a', '#c99272', '#a86f4c', '#8a5536', '#6b3f26', '#4a2a19'];
export const EYE_COLORS = ['#5b3a21', '#3d2614', '#7a5a2e', '#4f7a3a', '#3f6f9c', '#7aa6c9', '#6b7378', '#2a2a2a'];

/** Slider groups (ids from model.sliders; unknown ids are ignored, unlisted ones go to the last group). */
const SLIDER_GROUPS = [
  { id: 'proportions', title: 'Proporzioni', ids: ['height', 'legs', 'proportions', 'head', 'neck'] },
  { id: 'shape', title: 'Forme', ids: ['weight', 'muscle', 'shoulders', 'vshape', 'breast', 'waist', 'hips', 'glutes'] },
];
const THUMB = { w: 96, h: 136, region: 'full' }; // same thumbnails as Personaggi › Aggiungi (shared cache)
const pct = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v * 100)) + '%';

export function createBodyModule(app, shell) {
  const mod = {
    init() {},
    onCharacterAdded() {},
  };

  shell.registerTool({
    id: 'body', label: 'Corpo', icon: 'body', group: 'look', order: 20,
    build(el) {
      let ch = null;
      el.classList.add('pv-body');

      // keeps the whole figure inside the area above the panel after the body grows or shrinks
      // (only moves the view when the figure no longer fits)
      const refit = () => app.modules.ui?.viewOffset?.update?.({ keepIfVisible: true });

      // ---- sex + body type
      const sexSeg = segmented({
        options: [{ value: 'F', label: 'Donna', icon: 'female' }, { value: 'M', label: 'Uomo', icon: 'male' }], value: 'F',
        onChange: (v) => {
          if (!ch || ch.sex === v) return;
          haptic('tick');
          const kind = ch.presetId.split('_')[1];
          ch.setPreset((v === 'F' ? 'f_' : 'm_') + kind);
          app.commit('sesso');
          refresh();
          refit();
        },
      });
      const typeGrid = h('div', { class: 'pv-body-types', role: 'radiogroup', 'aria-label': 'Corporatura' });
      let typeSex = null;
      function renderTypes() {
        if (typeSex === ch.sex) return syncTypes();
        typeSex = ch.sex;
        const thumbs = app.modules.ui?.thumbs;
        typeGrid.replaceChildren(...app.model.presets.filter((p) => p.sex === ch.sex).map((p) => {
          const vis = h('span', { class: 'pv-body-type-visual' }, icon('body', 30));
          const set = (url) => { if (url) vis.replaceChildren(h('img', { src: url, alt: '' })); };
          if (thumbs) { const hit = thumbs.peek(p.id, THUMB); if (hit) set(hit); else thumbs.get(p.id, THUMB).then(set); }
          const b = h('button', { type: 'button', class: 'pv-body-type', role: 'radio' }, vis, h('span', { class: 'pv-body-type-label' }, p.label));
          b.dataset.id = p.id;
          b.addEventListener('click', () => {
            if (!ch || ch.presetId === p.id) return;
            haptic('tick');
            ch.setPreset(p.id);
            app.commit('corporatura');
            refresh();
            refit();
          });
          return b;
        }));
        syncTypes();
      }
      function syncTypes() {
        for (const b of typeGrid.children) {
          const on = b.dataset.id === ch.presetId;
          b.classList.toggle('active', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        }
      }

      // ---- colors
      const skin = swatches({
        colors: SKIN_TONES, value: '#e0b49a',
        onInput: (c) => ch?.setAppearance({ skin: c }),
        onChange: (c) => { if (!ch) return; ch.setAppearance({ skin: c }); app.commit('pelle'); },
      });
      const eyes = swatches({
        colors: EYE_COLORS, value: '#5b3a21',
        onInput: (c) => ch?.setAppearance({ eyes: c }),
        onChange: (c) => { if (!ch) return; ch.setAppearance({ eyes: c }); app.commit('occhi'); },
      });

      // ---- shape sliders (live rebuild, throttled to one per frame)
      let pending = false;
      app.addRenderHook(() => {
        if (!pending) return false;
        pending = false;
        ch?.rebuildShape();
        return false;
      });
      const flush = () => { if (pending) { pending = false; ch?.rebuildShape(); } };
      const sliderEls = new Map();
      const groupHosts = SLIDER_GROUPS.map(() => h('div'));
      let slidersSex = null;
      function renderSliders() {
        if (slidersSex !== ch.sex) {
          slidersSex = ch.sex;
          sliderEls.clear();
          groupHosts.forEach((g) => g.replaceChildren());
          const known = new Set(SLIDER_GROUPS.flatMap((g) => g.ids));
          const list = app.model.sliders.filter((s) => !s.sex || s.sex === ch.sex);
          const byId = new Map(list.map((s) => [s.id, s]));
          const place = (s, gi) => {
            const el = slider({
              label: s.label, min: -1, max: 1, step: 0.01, value: 0, defaultValue: 0, format: pct,
              onInput: (v) => { if (!ch) return; ch.sliders[s.id] = v; el.classList.toggle('changed', v !== 0); pending = true; app.invalidate(); },
              onChange: () => { if (!ch) return; flush(); app.commit('forma'); syncReset(); refit(); },
            });
            sliderEls.set(s.id, el);
            groupHosts[gi].appendChild(el);
          };
          SLIDER_GROUPS.forEach((g, gi) => g.ids.forEach((id) => { if (byId.has(id)) place(byId.get(id), gi); }));
          for (const s of list) if (!known.has(s.id)) place(s, SLIDER_GROUPS.length - 1);
        }
        for (const [id, el] of sliderEls) { const v = ch.sliders[id] || 0; el.setValue(v); el.classList.toggle('changed', v !== 0); }
        syncReset();
      }
      const reset = button({
        label: 'Azzera regolazioni', icon: 'reset', small: true,
        onClick: () => {
          if (!ch || !Object.values(ch.sliders).some((v) => v)) return;
          haptic('light');
          ch.sliders = {};
          ch.rebuildShape();
          app.commit('azzera forma');
          refresh();
          refit();
        },
      });
      function syncReset() { reset.disabled = !ch || !Object.values(ch.sliders).some((v) => v); }

      // ---- empty state (no character selected)
      const empty = h('div', { class: 'pv-body-empty' },
        icon('user', 30),
        h('strong', {}, 'Nessun personaggio selezionato'),
        h('span', {}, 'Tocca un personaggio nella scena o sceglilo dall\'elenco.'),
        button({ label: 'Personaggi', icon: 'people', small: true, onClick: () => app.modules.ui?.openPeople?.() || shell.openTool('people') }));
      const content = h('div', { class: 'pv-body-content' },
        section('Sesso', [sexSeg]),
        section('Corporatura', [typeGrid]),
        section('Pelle', [skin]),
        section('Occhi', [eyes]),
        section(SLIDER_GROUPS[0].title, [groupHosts[0]], { collapsible: true }),
        section(SLIDER_GROUPS[1].title, [groupHosts[1]], { collapsible: true }),
        h('div', { class: 'pv-body-reset' }, h('span', { class: 'pv-body-note' }, 'Doppio tocco su un cursore per azzerarlo'), reset),
      );
      el.append(empty, content);

      function refresh() {
        ch = app.selection.character;
        empty.style.display = ch ? 'none' : '';
        content.style.display = ch ? '' : 'none';
        if (!ch) return;
        sexSeg.setValue(ch.sex);
        renderTypes();
        renderSliders();
        skin.setValue(ch.appearance.skin);
        eyes.setValue(ch.appearance.eyes);
      }
      const onApp = () => { if (shell.activeToolId === 'body') refresh(); };
      app.addEventListener('selection', () => { if (app.selection.character !== ch) flush(); onApp(); });
      app.addEventListener('loaded', onApp);
      app.addEventListener('characters', onApp);
      return { onShow: refresh, onHide: flush };
    },
  });
  return mod;
}
