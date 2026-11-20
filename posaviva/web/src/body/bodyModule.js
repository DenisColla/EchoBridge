// "Corpo" tool: body type preset (3 female / 3 male), shape sliders, skin & eye colors.
// Also serves as the reference example of a module + panel built with ui/kit.js.
import { h, section, slider, segmented, cardGrid, swatches, button } from '../ui/kit.js';

export const SKIN_TONES = ['#f6d7c3', '#eac0a2', '#e0b49a', '#c99272', '#a86f4c', '#8a5536', '#6b3f26', '#4a2a19'];
export const EYE_COLORS = ['#5b3a21', '#3d2614', '#7a5a2e', '#4f7a3a', '#3f6f9c', '#7aa6c9', '#6b7378', '#2a2a2a'];

export function createBodyModule(app, shell) {
  const mod = {
    init() {},
    onCharacterAdded() {},
  };

  shell.registerTool({
    id: 'body', label: 'Corpo', icon: 'body', group: 'look', order: 20,
    build(el) {
      let ch = null;
      const sexSeg = segmented({ options: [{ value: 'F', label: 'Donna' }, { value: 'M', label: 'Uomo' }], value: 'F', onChange: (v) => {
        if (!ch) return;
        const kind = ch.presetId.split('_')[1];
        ch.setPreset((v === 'F' ? 'f_' : 'm_') + kind); app.commit('sesso'); refresh();
      } });
      const typeHost = h('div');
      const sliderHost = h('div');
      const skin = swatches({ colors: SKIN_TONES, value: '#e0b49a', onChange: (c) => { ch?.setAppearance({ skin: c }); app.commit('pelle'); } });
      const eyes = swatches({ colors: EYE_COLORS, value: '#5b3a21', onChange: (c) => { ch?.setAppearance({ eyes: c }); app.commit('occhi'); } });
      const reset = button({ label: 'Azzera regolazioni', icon: 'reset', small: true, onClick: () => { if (!ch) return; ch.sliders = {}; ch.rebuildShape(); app.commit('azzera'); refresh(); } });
      el.append(
        section('Sesso', [sexSeg]),
        section('Corporatura', [typeHost]),
        section('Regolazioni', [sliderHost, reset], { collapsible: true }),
        section('Pelle', [skin]),
        section('Occhi', [eyes]),
      );
      function refresh() {
        ch = app.selection.character;
        el.style.opacity = ch ? 1 : 0.4;
        if (!ch) return;
        sexSeg.setValue(ch.sex);
        typeHost.innerHTML = '';
        const presets = app.model.presets.filter((p) => p.sex === ch.sex);
        typeHost.appendChild(cardGrid({ items: presets.map((p) => ({ id: p.id, label: p.label, icon: 'body' })), value: ch.presetId, columns: 3,
          onSelect: (id) => { ch.setPreset(id); app.commit('corporatura'); refresh(); } }));
        sliderHost.innerHTML = '';
        for (const s of app.model.sliders) {
          if (s.sex && s.sex !== ch.sex) continue;
          sliderHost.appendChild(slider({ label: s.label, min: -1, max: 1, step: 0.01, value: ch.sliders[s.id] || 0,
            format: (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + '%',
            onInput: (v) => { ch.sliders[s.id] = v; scheduleShape(); },
            onChange: () => app.commit('forma') }));
        }
        skin.setValue(ch.appearance.skin);
        eyes.setValue(ch.appearance.eyes);
      }
      // throttle shape rebuilds while dragging
      let pending = false;
      function scheduleShape() {
        if (pending) return; pending = true;
        requestAnimationFrame(() => { pending = false; ch?.rebuildShape(); });
      }
      app.addEventListener('selection', () => { if (shell.activeToolId === 'body') refresh(); });
      app.addEventListener('loaded', () => { if (shell.activeToolId === 'body') refresh(); });
      return { onShow: refresh };
    },
  });
  return mod;
}
