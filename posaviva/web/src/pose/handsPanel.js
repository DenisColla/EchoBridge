// "Mani" tool: side (Sinistra / Destra / Entrambe), hand presets with close-up
// thumbnails, per-finger curl (distributed naturally over the 3 phalanges),
// spread, thumb opposition and wrist bend. Tapping a finger in the viewport
// selects that phalanx for the rotation rings.
import { h, section, slider, segmented, button, toast, haptic, icon } from '../ui/kit.js';
import { HAND_PRESETS, applyHandPreset } from './library.js';
import { FINGER_NAMES, toDeg, toRad } from './controls.js';
import { getThumbRenderer } from './thumbs.js';
import { focusHand } from './focus.js';

const D = Math.PI / 180;
// full curl (c = 1) per phalanx, degrees: [base, media, punta]; thumb: [CMC, MCP, IP]
const CURL = { 1: [12, 50, 70], 2: [82, 100, 68], 3: [84, 102, 70], 4: [86, 104, 70], 5: [88, 104, 68] };
// spread (s = 1) abduction toward the little finger, degrees, on phalanx 1 (+ metacarpal)
const SPREAD = { 2: [-14, -3], 3: [-2, 0], 4: [8, 2], 5: [17, 5] };
// thumb opposition at o = 1 on the CMC (finger1-1): flexion, palmar abduction, rotation (degrees)
const OPP = { flex: 28, abd: 42, rot: 26 };

export function registerHandsTool(ctx) {
  const { app, shell, controls, rig } = ctx;
  let thumbs = null;

  const axisOf = (ctrl, key) => ctrl.axes.findIndex((a) => a.key === key);

  shell.registerTool({
    id: 'hands', group: 'pose', label: 'Mani', icon: 'hand', order: 20,
    build(el) {
      let side = 'R';
      const sides = () => (side === 'both' ? ['L', 'R'] : [side]);
      const sideSeg = segmented({
        options: [{ value: 'R', label: 'Destra' }, { value: 'L', label: 'Sinistra' }, { value: 'both', label: 'Entrambe' }],
        value: side, onChange: (v) => { side = v; haptic('tick'); sync(); },
      });

      // ---------------------------------------------------------------- view
      const frameBtn = button({ label: 'Inquadra la mano', icon: 'hand', small: true, onClick: () => {
        const ch = app.selection.character;
        if (!ch) return;
        haptic('tick');
        if (!focusHand(app, shell, ch, side)) toast('Il personaggio è nascosto', { kind: 'info', ms: 1600 });
      } });
      const fullBtn = button({ label: 'Figura intera', icon: 'person', small: true, variant: 'ghost', onClick: () => {
        if (!app.selection.character) return;
        haptic('tick');
        app.sceneTools?.camera?.frameSubject?.();
      } });

      // ---------------------------------------------------------------- empty state
      const empty = h('div', { class: 'pv-body-empty' },
        icon('user', 30),
        h('strong', {}, 'Nessun personaggio selezionato'),
        h('span', {}, 'Tocca un personaggio nella scena o sceglilo dall\'elenco.'),
        button({ label: 'Personaggi', icon: 'people', small: true, onClick: () => app.modules.ui?.openPeople?.() || shell.openTool('people') }));

      // ---------------------------------------------------------------- presets
      const presetGrid = h('div', { class: 'pv-pose-hand-grid' });
      const presetEmpty = h('div', { class: 'pv-pose-lib-empty' }, icon('hand', 28), h('div', {}, 'Le pose della mano non sono ancora disponibili.'));
      let presetSig = '';
      const presetCards = [];
      function buildPresets() {
        const sig = HAND_PRESETS.map((p) => p.id).join(',');
        if (sig === presetSig) return;
        presetSig = sig;
        presetGrid.replaceChildren();
        presetCards.length = 0;
        presetEmpty.style.display = HAND_PRESETS.length ? 'none' : '';
        for (const p of HAND_PRESETS) {
          const th = h('div', { class: 'pv-pose-thumb loading' });
          const card = h('button', { type: 'button', class: 'pv-pose-card', title: p.label }, th, h('span', { class: 'pv-pose-card-label' }, p.label));
          card.addEventListener('click', () => {
            const ch = app.selection.character;
            if (!ch) { toast('Seleziona un personaggio', { kind: 'warning' }); return; }
            haptic('tick');
            for (const s of sides()) applyHandPreset(ch, p.id, s);
            ctx.edited(ch, true, 'mano: ' + p.label.toLowerCase());
            sync();
          });
          presetGrid.appendChild(card);
          presetCards.push({ preset: p, thumb: th, done: false });
        }
      }
      function pumpThumbs() {
        if (!visible || !thumbs) return;
        const next = presetCards.find((c) => !c.done);
        if (!next) { thumbs.persist(); return; }
        requestAnimationFrame(() => {
          if (!visible) return;
          try {
            const url = thumbs.renderHand(next.preset, app.selection.character?.sex || 'F');
            next.thumb.replaceChildren(h('img', { src: url, alt: '' }));
          } catch (e) { console.warn('[pose] hand thumbnail failed', e); next.thumb.replaceChildren(icon('hand', 26)); }
          next.thumb.classList.remove('loading');
          next.done = true;
          setTimeout(pumpThumbs, 16);
        });
      }

      // ---------------------------------------------------------------- sliders
      let pending = 0;
      const live = () => { const ch = app.selection.character; if (!ch || pending) return; pending = requestAnimationFrame(() => { pending = 0; ctx.edited(ch, false); }); };
      const done = (label) => () => { const ch = app.selection.character; if (ch) ctx.edited(ch, true, label); };
      const pct = (v) => `${Math.round(v * 100)}%`;

      /** curl c (0 = rest, 1 = closed) distributed over the 3 phalanges (thumb: CMC, MCP, IP) */
      function setCurl(ch, s, n, c) {
        for (let j = 1; j <= 3; j++) {
          const ctrl = controls.get(`f${n}${j}.${s}`);
          rig.write(ch, ctrl, axisOf(ctrl, 'flex'), CURL[n][j - 1] * D * c);
        }
      }
      function getCurl(ch, s, n) {
        let num = 0, den = 0;
        [1, 2, 3].forEach((j, idx) => {
          const ctrl = controls.get(`f${n}${j}.${s}`);
          num += rig.read(ch, ctrl, axisOf(ctrl, 'flex')) / D * CURL[n][idx];
          den += CURL[n][idx] * CURL[n][idx];
        });
        return num / den;
      }
      const curlSliders = FINGER_NAMES.map((name, fi) => slider({
        label: name, min: -0.25, max: 1, step: 0.01, value: 0, center: false, defaultValue: 0, format: pct,
        onInput: (v) => { const ch = app.selection.character; if (!ch) return; for (const s of sides()) setCurl(ch, s, fi + 1, v); live(); },
        onChange: done('piega ' + name.toLowerCase()),
      }));

      function setSpread(ch, s, v) {
        for (const n of [2, 3, 4, 5]) {
          const c1 = controls.get(`f${n}1.${s}`), c0 = controls.get(`f${n}0.${s}`);
          rig.write(ch, c1, axisOf(c1, 'abd'), SPREAD[n][0] * D * v);
          rig.write(ch, c0, axisOf(c0, 'abd'), SPREAD[n][1] * D * v);
        }
      }
      function getSpread(ch, s) {
        let num = 0, den = 0;
        for (const n of [2, 4, 5]) { const c1 = controls.get(`f${n}1.${s}`); num += rig.read(ch, c1, axisOf(c1, 'abd')) / D * SPREAD[n][0]; den += SPREAD[n][0] ** 2; }
        return num / den;
      }
      const spreadSlider = slider({ label: 'Allarga dita', min: -0.5, max: 1, step: 0.01, value: 0, center: false, defaultValue: 0, format: pct,
        onInput: (v) => { const ch = app.selection.character; if (!ch) return; for (const s of sides()) setSpread(ch, s, v); live(); },
        onChange: done('allarga dita') });

      /** opposition o (0..1): the thumb metacarpal swings across the palm and turns its pad to the fingers */
      function setOpp(ch, s, o) {
        const c = controls.get(`f11.${s}`);
        rig.write(ch, c, axisOf(c, 'flex'), OPP.flex * D * o);
        rig.write(ch, c, axisOf(c, 'abd'), OPP.abd * D * o);
        rig.write(ch, c, axisOf(c, 'rot'), OPP.rot * D * o);
      }
      function getOpp(ch, s) {
        const c = controls.get(`f11.${s}`);
        return rig.read(ch, c, axisOf(c, 'abd')) / D / OPP.abd;
      }
      const oppSlider = slider({ label: 'Opposizione pollice', min: 0, max: 1, step: 0.01, value: 0, center: false, defaultValue: 0, format: pct,
        onInput: (v) => { const ch = app.selection.character; if (!ch) return; for (const s of sides()) setOpp(ch, s, v); live(); },
        onChange: done('opposizione pollice') });

      const wristSlider = slider({ label: 'Piega polso', min: -70, max: 80, step: 1, value: 0, defaultValue: 0, format: (v) => `${Math.round(v)}°`,
        onInput: (v) => { const ch = app.selection.character; if (!ch) return; for (const s of sides()) { const c = controls.get('hand.' + s); rig.write(ch, c, 0, toRad(v)); } live(); },
        onChange: done('piega polso') });

      const resetBtn = button({ label: 'Mano rilassata', icon: 'reset', small: true, onClick: () => {
        const ch = app.selection.character;
        if (!ch) return;
        haptic('tick');
        for (const s of sides()) for (const c of controls.list) if (c.side === s && (c.region === 'finger' || c.baseId === 'hand')) for (const i of c.boneIdx) if (!app.model.bones[i].name.startsWith('lowerarm')) ch.poseQuat[i].identity();
        ctx.edited(ch, true, 'mano rilassata');
        sync();
      } });
      const mirrorBtn = button({ label: 'Copia sull\'altra mano', icon: 'mirror', small: true, onClick: () => {
        const ch = app.selection.character;
        if (!ch || side === 'both') { toast('Scegli prima Destra o Sinistra', { kind: 'info' }); return; }
        haptic('tick');
        ctx.ops.mirrorPart(ch, controls.get('hand.' + side));
        toast('Copiata sull\'altra mano', { kind: 'ok', ms: 1400 });
      } });

      const hint = h('p', { class: 'pv-pose-note' }, 'Tocca un dito nella vista per ruotarlo con gli anelli.');
      const content = h('div', {},
        sideSeg, h('div', { class: 'pv-pose-actions pv-pose-view' }, frameBtn, fullBtn),
        section('Pose della mano', [presetGrid, presetEmpty]),
        section('Dita', [...curlSliders, spreadSlider, oppSlider]),
        section('Polso', [wristSlider, h('div', { class: 'pv-pose-actions' }, resetBtn, mirrorBtn), hint]),
      );
      el.append(empty, content);

      function sync() {
        const ch = app.selection.character;
        empty.style.display = ch ? 'none' : '';
        content.style.display = ch ? '' : 'none';
        sideSeg.setValue(side);
        frameBtn.querySelector('span').textContent = side === 'both' ? 'Inquadra le mani' : 'Inquadra la mano';
        if (!ch) return;
        const s = side === 'both' ? 'R' : side;
        curlSliders.forEach((sl, fi) => sl.setValue(getCurl(ch, s, fi + 1)));
        spreadSlider.setValue(getSpread(ch, s));
        oppSlider.setValue(getOpp(ch, s));
        wristSlider.setValue(Math.round(toDeg(rig.read(ch, controls.get('hand.' + s), 0))));
      }

      let visible = false;
      ctx.onChange((reason) => {
        if (!visible) return;
        if (reason === 'selection') {
          const c = ctx.sel().control;
          if (c && c.side && (c.region === 'finger' || c.baseId === 'hand') && side !== 'both' && side !== c.side) side = c.side;
        }
        if (reason !== 'pose' || !pending) sync();
      });
      return {
        onShow() {
          visible = true;
          thumbs ||= getThumbRenderer(app);
          buildPresets();
          sync();
          pumpThumbs();
        },
        onHide() { visible = false; },
      };
    },
  });
}
