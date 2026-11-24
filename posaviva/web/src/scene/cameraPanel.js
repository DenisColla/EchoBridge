// "Camera" tool panel: lens (focal length + dolly zoom), focal point / framing,
// quick angles, Dutch angle and saved views.
import { h, section, slider, toggle, button, haptic, toast } from '../ui/kit.js';
import { FOCAL_MIN, FOCAL_MAX, FOCAL_CHIPS, QUICK_ANGLES, ROLL_LIMIT, MAX_VIEWS } from './cameraRig.js';
import { svgIcon, ANGLE_ICONS } from './svg.js';

// logarithmic focal slider: equal steps feel equal (14→24 as wide as 85→135)
const LOG_RANGE = Math.log(FOCAL_MAX / FOCAL_MIN);
const tFromFocal = (f) => Math.log(f / FOCAL_MIN) / LOG_RANGE;
const focalFromT = (t) => FOCAL_MIN * Math.exp(t * LOG_RANGE);

const lensName = (f) => (f < 20 ? 'ultra grandangolo' : f < 32 ? 'grandangolo' : f < 45 ? 'standard largo' : f < 65 ? 'normale' : f < 110 ? 'ritratto' : 'teleobiettivo');

export function registerCameraTool(app, shell, cam) {
  shell.registerTool({
    id: 'camera', group: 'camera', label: 'Camera', icon: 'camera', order: 80, title: 'Camera',
    build(el) {
      el.classList.add('pv-sc-panel');
      let visible = false;

      // ---------------------------------------------------------- lens
      const focalBig = h('div', { class: 'pv-sc-focal-value' });
      const focalSub = h('div', { class: 'pv-sc-focal-sub' });
      const focal = slider({
        label: 'Lunghezza focale', min: 0, max: 1, step: 0.001, value: tFromFocal(cam.focal),
        format: (t) => `${Math.round(focalFromT(t))} mm`,
        onInput: (t) => cam.setFocal(focalFromT(t)),
        onChange: () => cam.commit('obiettivo'),
      });
      focal.classList.add('pv-sc-nodefault');
      const chipsEl = h('div', { class: 'pv-chips pv-sc-focal-chips' });
      const chipBtns = FOCAL_CHIPS.map((f) => {
        const c = h('button', { type: 'button', class: 'pv-chip' }, `${f}`);
        c.addEventListener('click', () => { cam.setFocal(f, { animate: true, commit: true }); haptic(); });
        chipsEl.appendChild(c);
        return [f, c];
      });
      const keep = toggle({ label: 'Mantieni inquadratura (dolly zoom)', value: cam.keepFraming, onChange: (v) => { cam.keepFraming = v; } });
      const keepNote = h('div', { class: 'pv-sc-note' }, 'La camera si avvicina o si allontana per tenere il soggetto della stessa dimensione: con 14 mm la prospettiva diventa estrema, con 135 mm si appiattisce.');
      const lensSec = section('Obiettivo', [h('div', { class: 'pv-sc-focal-head' }, focalBig, focalSub), focal, chipsEl, keep, keepNote]);

      // ---------------------------------------------------------- focal point / framing
      // aiming is a viewport gesture: the sheet is closed so the whole scene can be tapped
      const aimBtn = button({ label: 'Punto focale', icon: 'target', onClick: () => { if (cam.aiming) cam.cancelAim(); else { shell.closePanel(); cam.startAim(); } } });
      const frameBtn = button({ label: 'Centra sul personaggio', icon: 'person', onClick: () => { cam.frameSubject(); haptic(); } });
      const frameSec = section('Inquadratura', [h('div', { class: 'pv-sc-grid2' }, aimBtn, frameBtn)]);

      // ---------------------------------------------------------- quick angles
      const angleGrid = h('div', { class: 'pv-sc-angles' });
      for (const q of QUICK_ANGLES) {
        const b = h('button', { type: 'button', class: 'pv-sc-angle', title: q.label }, svgIcon(ANGLE_ICONS[q.id], 30), h('span', {}, q.label));
        b.addEventListener('click', () => { cam.quickAngle(q.id); haptic(); });
        angleGrid.appendChild(b);
      }
      const angleSec = section('Angolazione', [angleGrid, h('div', { class: 'pv-sc-note' }, 'Riferite al personaggio selezionato.')]);

      // ---------------------------------------------------------- dutch angle
      const roll = slider({
        label: 'Inclinazione (olandese)', min: -ROLL_LIMIT, max: ROLL_LIMIT, step: 0.5, value: cam.roll, defaultValue: 0,
        format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`,
        onInput: (v) => cam.setRoll(v), onChange: (v) => cam.setRoll(v, { commit: true }),
      });
      const rollSec = section('Inquadratura olandese', [roll]);

      // ---------------------------------------------------------- saved views
      const viewGrid = h('div', { class: 'pv-sc-views' });
      const viewSec = section('Viste salvate', [viewGrid, h('div', { class: 'pv-sc-note' }, 'Tocca uno slot vuoto per salvare la vista. Tocca una vista per richiamarla, tieni premuto per sovrascriverla.')]);
      function renderViews() {
        viewGrid.innerHTML = '';
        for (let i = 0; i < MAX_VIEWS; i++) {
          const v = cam.views[i];
          const slot = h('button', { type: 'button', class: 'pv-sc-view' + (v ? ' filled' : '') });
          if (v) {
            if (v.thumb) slot.appendChild(h('img', { src: v.thumb, alt: '' }));
            slot.appendChild(h('span', { class: 'pv-sc-view-label' }, `${i + 1} · ${Math.round(v.f)} mm`));
            const del = h('span', { class: 'pv-sc-view-del', title: 'Elimina', role: 'button' }, svgIcon('<path d="M6 6l12 12M18 6 6 18"/>', 14));
            del.addEventListener('click', (e) => { e.stopPropagation(); cam.deleteView(i); });
            slot.appendChild(del);
          } else {
            slot.append(svgIcon('<path d="M12 5v14M5 12h14"/>', 20), h('span', { class: 'pv-sc-view-label' }, `Salva vista ${i + 1}`));
          }
          // tap = restore (or save when empty), long press = overwrite
          let timer = 0, long = false;
          slot.addEventListener('pointerdown', () => { long = false; clearTimeout(timer); if (cam.views[i]) timer = setTimeout(() => { long = true; cam.saveView(i); haptic(30); toast(`Vista ${i + 1} sovrascritta`); }, 600); });
          const cancel = () => clearTimeout(timer);
          slot.addEventListener('pointerup', cancel); slot.addEventListener('pointerleave', cancel); slot.addEventListener('pointercancel', cancel);
          slot.addEventListener('click', () => {
            if (long) return;
            if (cam.views[i]) cam.restoreView(i);
            else { cam.saveView(i); haptic(); toast(`Vista ${i + 1} salvata`); }
          });
          viewGrid.appendChild(slot);
        }
      }

      el.append(lensSec, frameSec, angleSec, rollSec, viewSec);

      // ---------------------------------------------------------- refresh
      let raf = 0;
      function schedule() { if (!visible || raf) return; raf = requestAnimationFrame(() => { raf = 0; refresh(); }); }
      function refresh() {
        const f = cam.focal;
        focalBig.textContent = `${Math.round(f)} mm`;
        focalSub.textContent = `${lensName(f)} · campo ${cam.longSideFovDeg.toFixed(0)}°`;
        focal.setValue(tFromFocal(f));
        for (const [cf, c] of chipBtns) c.classList.toggle('active', Math.abs(cf - f) < 0.5);
        keep.setValue(cam.keepFraming);
        roll.setValue(cam.roll);
        aimBtn.classList.toggle('primary', cam.aiming);
      }
      cam.addEventListener('change', schedule);
      cam.addEventListener('aim', schedule);
      cam.addEventListener('views', () => { if (visible) renderViews(); });
      return {
        onShow() { visible = true; refresh(); renderViews(); },
        onHide() { visible = false; },
      };
    },
  });
}
