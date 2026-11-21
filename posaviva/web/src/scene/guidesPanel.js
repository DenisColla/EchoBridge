// "Guide" tool panel: perspective (1/2/3 vanishing points), horizon, grid
// rotation, line style, rule of thirds and comic panel frames.
import { h, section, slider, toggle, segmented, button, swatches, chips, toast } from '../ui/kit.js';
import { FRAME_RATIOS, GUIDE_COLORS } from './guides.js';

export function registerGuidesTool(app, shell, guides) {
  shell.registerTool({
    id: 'guides', group: 'camera', label: 'Guide', icon: 'perspective', order: 85, title: 'Guide prospettiche',
    build(el) {
      el.classList.add('pv-sc-panel');
      let visible = false;
      const set = (patch) => guides.set(patch);

      const show = toggle({ label: 'Mostra guide', value: true, onChange: (v) => set({ visible: v }) });
      const mode = segmented({
        options: [{ value: 0, label: 'Nessuna' }, { value: 1, label: '1 punto' }, { value: 2, label: '2 punti' }, { value: 3, label: '3 punti' }], value: 0,
        onChange: (v) => set({ mode: +v, visible: true, horizon: guides.state.horizon || +v > 0 }),
      });
      const horizon = toggle({ label: 'Linea d\'orizzonte', value: false, onChange: (v) => set({ horizon: v, visible: true }) });
      const yaw = slider({ label: 'Rotazione griglia', min: -45, max: 45, step: 0.5, value: 0, defaultValue: 0, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`, onInput: (v) => set({ yaw: v }) });
      const alignCh = button({ label: 'Allinea al personaggio', icon: 'person', small: true, onClick: () => { if (!guides.alignToCharacter()) toast('Seleziona un personaggio'); } });
      const alignView = button({ label: 'Allinea alla vista', icon: 'eye', small: true, onClick: () => guides.alignToView() });
      const gridSync = toggle({ label: 'Ruota anche la griglia del pavimento', value: true, onChange: (v) => set({ gridSync: v }) });
      const density = slider({ label: 'Densità linee', min: 4, max: 48, step: 1, value: 16, format: (v) => `${Math.round(v)}`, onInput: (v) => set({ density: v }) });
      const status = h('div', { class: 'pv-sc-note pv-sc-status' });

      const perAxis = toggle({ label: 'Colori per asse', value: true, onChange: (v) => set({ color: v ? null : (guides.state.lastColor || '#ffffff') }) });
      const colors = swatches({ colors: GUIDE_COLORS, value: null, onChange: (c) => set({ color: c, lastColor: c }) });
      const opacity = slider({ label: 'Opacità', min: 0.1, max: 1, step: 0.01, value: 0.75, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => set({ opacity: v }) });

      const thirds = toggle({ label: 'Regola dei terzi', value: false, onChange: (v) => set({ thirds: v, visible: true }) });
      const frames = chips({ items: [{ id: 'none', label: 'Nessuna' }, ...FRAME_RATIOS.map((f) => ({ id: f.id, label: f.id }))], value: 'none', onSelect: (id) => { set({ frame: id === 'none' ? null : id, visible: true }); frames.setValue(id); } });
      frames.classList.add('pv-sc-wrapchips');
      const mask = slider({ label: 'Oscura fuori vignetta', min: 0, max: 0.9, step: 0.01, value: 0.5, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => set({ mask: v }) });

      el.append(
        show,
        section('Prospettiva', [mode, horizon, yaw, h('div', { class: 'pv-sc-grid2' }, alignCh, alignView), gridSync, density, status]),
        section('Stile linee', [perAxis, colors, opacity], { collapsible: true }),
        section('Composizione', [thirds, h('div', { class: 'pv-sc-label' }, 'Vignetta'), frames, mask]),
      );

      let raf = 0;
      function schedule() { if (!visible || raf) return; raf = requestAnimationFrame(() => { raf = 0; refresh(); }); }
      function describe() {
        const s = guides.state;
        if (!s.visible || s.mode === 0) return s.visible ? '' : 'Guide nascoste.';
        // relative to the exported image (or the comic panel), not to the UI-shifted canvas
        const A = guides.info.area || { x: 0, y: 0, w: guides._cssW, h: guides._cssH };
        const x0 = A.x, y0 = A.y, x1 = A.x + A.w, y1 = A.y + A.h;
        const parts = guides.info.vps.map((vp) => {
          if (!vp.finite) return `${vp.label}: all'infinito (linee parallele)`;
          if (vp.x >= x0 && vp.x <= x1 && vp.y >= y0 && vp.y <= y1) return `${vp.label}: nell'inquadratura`;
          const dir = [];
          if (vp.y < y0) dir.push('sopra'); else if (vp.y > y1) dir.push('sotto');
          if (vp.x < x0) dir.push('a sinistra'); else if (vp.x > x1) dir.push('a destra');
          return `${vp.label}: fuori, ${dir.join(' ')}`;
        });
        return parts.join(' · ');
      }
      function refresh() {
        const s = guides.state;
        show.setValue(s.visible);
        mode.setValue(s.mode);
        horizon.setValue(s.horizon);
        yaw.setValue(s.yaw);
        gridSync.setValue(s.gridSync);
        density.setValue(s.density);
        perAxis.setValue(!s.color);
        colors.setValue(s.color);
        colors.style.opacity = s.color ? 1 : 0.5;
        opacity.setValue(s.opacity);
        thirds.setValue(s.thirds);
        frames.setValue(s.frame || 'none');
        mask.setValue(s.mask);
        mask.style.display = s.frame ? '' : 'none';
        status.textContent = describe();
      }
      guides.addEventListener('change', schedule);
      guides.addEventListener('drawn', schedule);
      return {
        onShow() { visible = true; refresh(); },
        onHide() { visible = false; },
      };
    },
  });
}
