// "Posa" tool panel: mode (Ruota / Trascina / Sposta), selected part with
// navigation, 3 anatomical sliders, part / whole-pose actions, body map and
// finger picker, options.
import { h, section, slider, segmented, button, toggle, iconButton, sheetMenu, toast, haptic, icon } from '../ui/kit.js';
import { AXIS_COLORS, FINGER_NAMES, toDeg, toRad } from './controls.js';
import { buildAdjustSliders } from './adjust.js';

const UP = {
  head: 'neck', neck: 'chest', chest: 'abdomen', abdomen: 'pelvis', shoulder: 'chest', arm: 'shoulder', forearm: 'arm', hand: 'forearm',
  thigh: 'pelvis', shin: 'thigh', foot: 'shin', toes: 'foot',
};
const DOWN = {
  pelvis: 'abdomen', abdomen: 'chest', chest: 'neck', neck: 'head', shoulder: 'arm', arm: 'forearm', forearm: 'hand', hand: 'f31',
  thigh: 'shin', shin: 'foot', foot: 'toes',
};

/** Body map rows: [right side (viewer's left), center, left side] */
const MAP = [
  ['shoulder', 'head', 'shoulder'], ['arm', 'neck', 'arm'], ['forearm', 'chest', 'forearm'], ['hand', 'abdomen', 'hand'],
  ['thigh', 'pelvis', 'thigh'], ['shin', null, 'shin'], ['foot', null, 'foot'], ['toes', null, 'toes'],
];
const SHORT = { forearm: 'Avambraccio', toes: 'Dita piede', pelvis: 'Bacino', shin: 'Gamba', hand: 'Mano' };

export function registerPoseTool(ctx) {
  const { app, shell, controls, rig, state } = ctx;

  /** id of the neighbor part (up/down the chain, or the other side) */
  function neighbor(ctrl, dir) {
    if (!ctrl) return null;
    const sfx = ctrl.side ? '.' + ctrl.side : '';
    if (dir === 'swap') return ctrl.mirrorId;
    if (ctrl.region === 'finger') {
      const f = ctrl.finger, j = ctrl.phalanx;
      const first = f === 1 ? 1 : 0;
      if (dir === 'up') return j > first ? `f${f}${j - 1}${sfx}` : `hand${sfx}`;
      return j < 3 ? `f${f}${j + 1}${sfx}` : null;
    }
    const t = (dir === 'up' ? UP : DOWN)[ctrl.baseId];
    if (!t) return null;
    if (t.startsWith('f')) return t + sfx;
    return controls.get(t + sfx) ? t + sfx : t;
  }

  shell.registerTool({
    id: 'pose', group: 'pose', label: 'Posa', icon: 'pose', order: 10,
    build(el) {
      // ---------------------------------------------------------------- mode
      const modeSeg = segmented({
        options: [{ value: 'rotate', label: 'Ruota', icon: 'rotate' }, { value: 'ik', label: 'Trascina', icon: 'tap' }, { value: 'line', label: 'Linea', icon: 'edit' }, { value: 'move', label: 'Sposta', icon: 'move' }],
        value: state.mode,
        onChange: (v) => { haptic('tick'); ctx.setPref('mode', v); refresh(); modeHint(); },
      });
      modeSeg.classList.add('pv-pose-modes');

      // ---------------------------------------------------------------- part header
      const partName = h('div', { class: 'pv-pose-part-name' });
      const partSub = h('div', { class: 'pv-pose-part-sub' });
      const upBtn = iconButton({ icon: 'chevronUp', title: 'Parte superiore', onClick: () => go('up') });
      const downBtn = iconButton({ icon: 'chevronDown', title: 'Parte successiva', onClick: () => go('down') });
      const swapBtn = iconButton({ icon: 'swap', title: 'Stessa parte, altro lato', onClick: () => go('swap') });
      const header = h('div', { class: 'pv-pose-part' }, h('div', { class: 'pv-pose-part-icon' }, icon('target', 20)), h('div', { class: 'pv-pose-part-text' }, partName, partSub), upBtn, downBtn, swapBtn);
      function go(dir) {
        const { character: ch, control } = ctx.sel();
        const id = neighbor(control, dir);
        if (ch && id && controls.get(id)) { haptic('tick'); app.select(ch, id); }
      }

      // ---------------------------------------------------------------- sliders
      const sliderHost = h('div', { class: 'pv-pose-sliders' });
      let sliders = [];
      let sliderKey = '';
      let sliding = -1, following = null;
      let pendingApply = 0;
      function buildSliders(ch, ctrl) {
        const vis = ctx.visibleAxes(ctrl);
        // ranges depend on the body (hinge rest bend): rebuild per character / shape too
        const key = ctrl.id + '|' + vis.join(',') + '|' + state.limits + '|' + ch.id + '|' + vis.map((k) => rig.offset(ch, ctrl, ctrl.axes[k]).toFixed(3)).join(',');
        if (key === sliderKey) return;
        sliderKey = key;
        sliderHost.replaceChildren();
        sliders = vis.map((k, slot) => {
          const a = ctrl.axes[k];
          const off = toDeg(rig.offset(ch, ctrl, a));
          const lim = rig.limitsOf(ch, ctrl, k);
          const min = lim ? Math.round(toDeg(lim[0]) + off) : Math.round(-180 + (a.hinge ? off : 0));
          const max = lim ? Math.round(toDeg(lim[1]) + off) : Math.round(180 + (a.hinge ? off : 0));
          const s = slider({
            label: a.label, min, max, step: 1, value: Math.round(toDeg(rig.readDisplay(ch, ctrl, k))), defaultValue: Math.round(off),
            center: min < 0 && max > 0,
            format: (v) => `${Math.round(v)}°`,
            onInput: (v) => {
              const c = ctx.sel().character;
              if (!c) return;
              // the pelvis follows a side bend / twist of the back (planted feet)
              if (sliding !== k || following !== c) { following = c; ctx.follow.begin(c, ctrl); }
              sliding = k;
              rig.write(c, ctrl, k, toRad(v) - rig.offset(c, ctrl, a));
              ctx.follow.update();
              if (!pendingApply) pendingApply = requestAnimationFrame(() => { pendingApply = 0; ctx.edited(c, false); });
            },
            onChange: () => {
              sliding = -1; following = null;
              ctx.follow.end();
              const c = ctx.sel().character;
              if (c) ctx.edited(c, true, 'posa: ' + ctrl.label.toLowerCase());
            },
          });
          s.classList.add('pv-pose-axis');
          s.style.setProperty('--axis-color', AXIS_COLORS[slot]);
          s._k = k;
          s.input.addEventListener('pointerup', () => { sliding = -1; following = null; ctx.follow.end(); });
          return s;
        });
        sliderHost.append(...sliders);
      }
      function syncSliders(ch, ctrl) {
        for (const s of sliders) if (s._k !== sliding) s.setValue(Math.round(toDeg(rig.readDisplay(ch, ctrl, s._k))));
      }

      const resetPartBtn = button({ label: 'Azzera parte', icon: 'reset', small: true, onClick: () => { const { character: ch, control } = ctx.sel(); if (ch && control) { haptic('tick'); ctx.ops.resetPart(ch, control); } } });
      const mirrorPartBtn = button({ label: 'Copia sull\'altro lato', icon: 'mirror', small: true, onClick: () => {
        const { character: ch, control } = ctx.sel();
        if (!ch || !control) return;
        haptic('tick');
        ctx.ops.mirrorPart(ch, control);
        toast(control.side ? 'Copiata sull\'altro lato' : 'Parte specchiata', { kind: 'ok', ms: 1400 });
      } });
      const partActions = h('div', { class: 'pv-pose-actions' }, resetPartBtn, mirrorPartBtn);
      const emptyHint = h('div', { class: 'pv-pose-empty' }, icon('tap', 26), h('div', {}, h('b', {}, 'Tocca una parte del corpo'), h('div', {}, 'oppure sceglila qui sotto. Trascina gli anelli colorati per ruotarla, la sfera centrale per una rotazione libera.')));
      const rotatePane = h('div', {}, header, sliderHost, partActions);

      // ---------------------------------------------------------------- body map + fingers
      const mapGrid = h('div', { class: 'pv-pose-map' },
        h('div', { class: 'pv-pose-map-head' }, 'Destra'), h('div', { class: 'pv-pose-map-head' }, 'Centro'), h('div', { class: 'pv-pose-map-head' }, 'Sinistra'));
      const mapBtns = new Map();
      for (const row of MAP) {
        row.forEach((base, col) => {
          if (!base) { mapGrid.appendChild(h('div')); return; }
          const id = col === 1 ? base : base + (col === 0 ? '.R' : '.L');
          const c = controls.get(id);
          const b = h('button', { type: 'button', class: 'pv-pose-map-btn' + (col === 1 ? ' center' : '') }, SHORT[base] || c.short);
          b.addEventListener('click', () => pickPart(id));
          mapBtns.set(id, b);
          mapGrid.appendChild(b);
        });
      }
      let fingerSide = 'L';
      const fingerSideSeg = segmented({ options: [{ value: 'R', label: 'Mano destra' }, { value: 'L', label: 'Mano sinistra' }], value: fingerSide, onChange: (v) => { fingerSide = v; refreshMap(); } });
      const fingerGrid = h('div', { class: 'pv-pose-fingers' }, h('div'), ...['metac.', 'base', 'media', 'punta'].map((t) => h('div', { class: 'pv-pose-map-head' }, t)));
      const fingerBtns = [];
      FINGER_NAMES.forEach((name, fi) => {
        fingerGrid.appendChild(h('div', { class: 'pv-pose-finger-name' }, name));
        for (let j = 0; j < 4; j++) {
          if (fi === 0 && j === 0) { fingerGrid.appendChild(h('div')); continue; }
          const b = h('button', { type: 'button', class: 'pv-pose-map-btn small' }, j === 0 ? 'M' : String(j));
          b.addEventListener('click', () => pickPart(`f${fi + 1}${j}.${fingerSide}`));
          b._f = fi + 1; b._j = j;
          fingerBtns.push(b);
          fingerGrid.appendChild(b);
        }
      });
      function pickPart(id) {
        const ch = app.selection.character;
        if (!ch) { toast('Nessun personaggio selezionato', { kind: 'warning' }); return; }
        haptic('tick');
        if (state.mode !== 'rotate') { ctx.setPref('mode', 'rotate'); modeSeg.setValue('rotate'); }
        app.select(ch, id);
      }
      const mapSection = section('Scegli parte', [mapGrid], { collapsible: true, collapsed: true });
      const fingerSection = section('Dita della mano', [fingerSideSeg, fingerGrid], { collapsible: true, collapsed: true });

      // ---------------------------------------------------------------- IK + move panes
      const ikPane = h('div', { class: 'pv-pose-info' },
        h('div', { class: 'pv-pose-legend' },
          legend('#b69bff', 'Mani'), legend('#4fd1c5', 'Piedi'), legend('#ffd166', 'Sguardo'), legend('#ff9f5a', 'Bacino')),
        h('p', {}, 'Trascina le maniglie: braccia e gambe seguono in modo naturale. Con ', h('b', {}, 'Piedi fissi'), ' abbassa il bacino per accovacciare o sedere il personaggio.'));
      const pinToggle = toggle({ label: 'Piedi fissi', value: state.pinFeet, onChange: (v) => ctx.setPref('pinFeet', v) });

      const yawSlider = slider({ label: 'Rotazione', min: -180, max: 180, step: 1, value: 0, format: (v) => `${Math.round(v)}°`,
        onInput: (v) => { const ch = app.selection.character; if (!ch) return; turnAboutPelvis(ch, toRad(v)); ctx.placed(ch); },
        onChange: () => { const ch = app.selection.character; if (ch) ctx.placed(ch, true, 'ruota personaggio'); } });
      // height above the floor (a ready landscape's ground under the character, else y = 0)
      const floorOf = (ch) => ctx.floorAt(ch.root.position.x, ch.root.position.z);
      const heightSlider = slider({ label: 'Altezza da terra', min: -0.5, max: 2.5, step: 0.01, value: 0, center: false, defaultValue: 0, format: (v) => `${v.toFixed(2)} m`,
        onInput: (v) => { const ch = app.selection.character; if (!ch) return; ch.root.position.y = floorOf(ch) + v; ch.root.updateMatrixWorld(true); ctx.placed(ch); },
        onChange: () => { const ch = app.selection.character; if (ch) ctx.placed(ch, true, 'altezza personaggio'); } });
      const dropBtn = button({ label: 'Appoggia a terra', icon: 'ground', onClick: () => { const ch = app.selection.character; if (!ch) return; haptic('tick'); ch.root.position.y = ctx.groundAt(ch.root.position.x, ch.root.position.z); ch.root.updateMatrixWorld(true); ctx.ops.dropToGround(ch); ctx.placed(ch); } });
      const movePane = h('div', {}, h('p', { class: 'pv-pose-note' }, 'Trascina l\'anello a terra (o il personaggio) per spostarlo, il pomello per ruotarlo.'), yawSlider, heightSlider, h('div', { class: 'pv-pose-actions' }, dropBtn));

      // ---------------------------------------------------------------- line of action pane
      const adjust = buildAdjustSliders(ctx);
      const softToggle = toggle({ label: 'Colonna morbida', value: state.softSpine, onChange: (v) => { ctx.setPref('softSpine', v); softToggle2.setValue(v); sliderKey = ''; refresh(); } });
      const tiltToggle = toggle({ label: 'Il bacino compensa', value: state.counterTilt, onChange: (v) => { ctx.setPref('counterTilt', v); tiltToggle2.setValue(v); } });
      const clearLineBtn = button({ label: 'Nascondi traccia', icon: 'eyeOff', small: true, onClick: () => { ctx.line.clear(); app.invalidate(); } });
      const linePane = h('div', {},
        h('div', { class: 'pv-pose-info' },
          h('div', { class: 'pv-pose-legend' }, legend('#c9b8ff', 'La tua linea'), legend('#ffb86b', 'Linea del corpo')),
          h('p', {}, 'Disegna con un dito una curva sopra il personaggio: dal bacino alla testa piega la schiena (C, S o dritta), da un piede a una mano coinvolge anche gamba e braccio. Ruota la vista con un dito fuori dal personaggio.')),
        adjust.el,
        h('div', { class: 'pv-pose-actions wrap' }, clearLineBtn));

      function turnAboutPelvis(ch, yaw) {
        // keep the pelvis (ring center) fixed while turning
        const C = rig.worldPos(ch, 0);
        const dy = yaw - ch.root.rotation.y;
        const ox = C.x - ch.root.position.x, oz = C.z - ch.root.position.z;
        const rx = ox * Math.cos(dy) + oz * Math.sin(dy), rz = -ox * Math.sin(dy) + oz * Math.cos(dy);
        ch.root.rotation.y = yaw;
        ch.root.position.x = C.x - rx; ch.root.position.z = C.z - rz;
        ch.root.updateMatrixWorld(true);
      }

      // ---------------------------------------------------------------- whole pose + options
      const mirrorPoseBtn = button({ label: 'Specchia posa', icon: 'mirror', small: true, onClick: () => { const ch = app.selection.character; if (!ch) return; haptic('tick'); ctx.ops.mirrorPose(ch); toast('Posa specchiata', { kind: 'ok', ms: 1400 }); } });
      const copyBtn = button({ label: 'Copia su…', icon: 'copy', small: true, onClick: (e) => copyMenu(e.currentTarget) });
      const resetPoseBtn = button({ label: 'Azzera posa', icon: 'reset', small: true, variant: 'danger', onClick: () => {
        const ch = app.selection.character;
        if (!ch) return;
        haptic('medium');
        ctx.ops.resetPose(ch);
        toast('Posa azzerata', { action: { label: 'Annulla', onClick: () => app.history.undo() } });
      } });
      // "Salva posa…": the projects module's "Salva in…" sheet (pose of the selected character)
      // (the projects module loads after this one: shown once it is there)
      const savePoseBtn = button({ label: 'Salva posa…', icon: 'save', small: true, onClick: () => {
        const ch = app.selection.character;
        if (!ch || !app.projects?.openSaveSheet) return;
        haptic('tick');
        app.projects.openSaveSheet({ type: 'pose', character: ch })?.catch?.((e) => { console.error(e); toast('Salvataggio non riuscito', { kind: 'error' }); });
      } });
      savePoseBtn.classList.add('pv-pose-save');
      const poseSection = section('Posa intera', [h('div', { class: 'pv-pose-actions wrap' }, mirrorPoseBtn, copyBtn, savePoseBtn, resetPoseBtn)]);
      async function copyMenu(anchor) {
        const src = app.selection.character;
        if (!src) return;
        const others = app.characters.filter((c) => c !== src);
        if (!others.length) { toast('Aggiungi un altro personaggio per copiare la posa', { kind: 'info' }); return; }
        const items = others.map((c, i) => ({ id: 'c' + i, label: c.name, icon: 'person', onClick: () => { ctx.ops.copyPose(src, c); toast(`Posa copiata su ${c.name}`, { kind: 'ok', ms: 1600 }); } }));
        if (others.length > 1) items.push({ separator: true }, { id: 'all', label: 'Tutti gli altri', icon: 'people', onClick: () => { for (const c of others) ctx.ops.copyPose(src, c); toast('Posa copiata su tutti', { kind: 'ok', ms: 1600 }); } });
        await sheetMenu(items, { title: 'Copia la posa su', anchor });
      }
      const limitsToggle = toggle({ label: 'Limiti anatomici', value: state.limits, onChange: (v) => { ctx.setPref('limits', v); sliderKey = ''; refresh(); } });
      const softToggle2 = toggle({ label: 'Colonna morbida (schiena e collo curvano insieme)', value: state.softSpine, onChange: (v) => { ctx.setPref('softSpine', v); softToggle.setValue(v); sliderKey = ''; refresh(); } });
      const tiltToggle2 = toggle({ label: 'Il bacino compensa (piedi a terra)', value: state.counterTilt, onChange: (v) => { ctx.setPref('counterTilt', v); tiltToggle.setValue(v); } });
      const pinToggle2 = toggle({ label: 'Piedi fissi (Trascina)', value: state.pinFeet, onChange: (v) => { ctx.setPref('pinFeet', v); pinToggle.setValue(v); } });
      const jointsToggle = toggle({ label: 'Mostra articolazioni', value: state.showJoints, onChange: (v) => ctx.setPref('showJoints', v) });
      const optSection = section('Opzioni', [limitsToggle, softToggle2, tiltToggle2, pinToggle2, jointsToggle], { collapsible: true });

      // same empty state as the other character tools (Corpo, Viso, Mani, Vestiti)
      const noChar = h('div', { class: 'pv-body-empty' },
        icon('user', 30),
        h('strong', {}, 'Nessun personaggio selezionato'),
        h('span', {}, 'Tocca un personaggio nella scena o sceglilo dall\'elenco.'),
        button({ label: 'Personaggi', icon: 'people', small: true, onClick: () => app.modules.ui?.openPeople?.() || shell.openTool('people') }));
      const modePanes = h('div', { class: 'pv-pose-pane' });
      const content = h('div', {}, modeSeg, modePanes, mapSection, fingerSection, poseSection, optSection);
      el.append(noChar, content);

      function legend(color, label) { return h('span', { class: 'pv-pose-legend-item' }, h('i', { style: { background: color } }), label); }

      function modeHint() {
        const t = { rotate: 'Tocca una parte, poi trascina un anello', ik: 'Trascina mani, piedi, testa o bacino', move: 'Trascina l\'anello a terra per spostare', line: 'Disegna una curva sopra il personaggio' }[state.mode];
        shell.hint(t, 2200);
      }

      // ---------------------------------------------------------------- refresh
      let lastPane = '';
      function refresh() {
        const { character: ch, control } = ctx.sel();
        savePoseBtn.style.display = app.projects?.openSaveSheet ? '' : 'none';
        modeSeg.setValue(state.mode);
        noChar.style.display = ch ? 'none' : '';
        content.style.display = ch ? '' : 'none';
        let pane = state.mode;
        if (pane === 'rotate' && !control) pane = 'empty';
        if (pane !== lastPane) {
          lastPane = pane;
          modePanes.replaceChildren(pane === 'rotate' ? rotatePane : pane === 'empty' ? emptyHint : pane === 'ik' ? h('div', {}, ikPane, pinToggle) : pane === 'line' ? h('div', {}, linePane, softToggle, tiltToggle) : movePane);
          if (pane === 'empty') mapSection.classList.remove('collapsed');
        }
        mapSection.style.display = state.mode === 'move' || state.mode === 'line' ? 'none' : '';
        fingerSection.style.display = state.mode === 'move' || state.mode === 'line' ? 'none' : '';
        pinToggle.setValue(state.pinFeet); pinToggle2.setValue(state.pinFeet);
        softToggle.setValue(state.softSpine); softToggle2.setValue(state.softSpine);
        tiltToggle.setValue(state.counterTilt); tiltToggle2.setValue(state.counterTilt);
        if (ch && state.mode === 'line') adjust.refresh();
        limitsToggle.setValue(state.limits); jointsToggle.setValue(state.showJoints);
        if (ch && control && state.mode === 'rotate') {
          partName.textContent = control.label;
          partSub.textContent = ch.name + (control.free ? ' · rotazione libera' : state.limits ? '' : ' · senza limiti');
          upBtn.setDisabled(!neighbor(control, 'up'));
          downBtn.setDisabled(!neighbor(control, 'down'));
          swapBtn.setDisabled(!control.mirrorId);
          mirrorPartBtn.querySelector('span').textContent = control.side ? 'Copia sull\'altro lato' : 'Specchia';
          buildSliders(ch, control);
          syncSliders(ch, control);
          if (control.side && control.region === 'finger' && control.side !== fingerSide) { fingerSide = control.side; fingerSideSeg.setValue(fingerSide); }
        }
        if (ch && state.mode === 'move') {
          let deg = Math.round(toDeg(ch.root.rotation.y)); if (deg === -180) deg = 180;
          yawSlider.setValue(deg);
          heightSlider.setValue(ch.root.position.y - floorOf(ch));
        }
        refreshMap();
      }
      function refreshMap() {
        const sel = app.selection.part;
        for (const [id, b] of mapBtns) b.classList.toggle('active', id === sel || (id.startsWith('hand') && sel && sel.startsWith('f') && sel.endsWith(id.slice(-2))));
        for (const b of fingerBtns) b.classList.toggle('active', sel === `f${b._f}${b._j}.${fingerSide}`);
      }

      let visible = false;
      ctx.onChange((reason) => { if (visible && reason !== 'prefs-silent') refresh(); });
      return {
        onShow() {
          visible = true; sliderKey = ''; lastPane = '';
          refresh();
          if (!ctx.sel().control && state.mode === 'rotate') modeHint();
        },
        onHide() { visible = false; },
      };
    },
  });
}
