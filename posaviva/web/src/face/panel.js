// "Viso" tool panel: expression presets, intensity, gaze pad, fine tuning,
// eyebrow style, eyelashes and eye colour. Works on the selected character.
import * as THREE from 'three';
import { h, section, slider, toggle, cardGrid, chips, button, iconButton, swatches, haptic, icon, toast } from '../ui/kit.js';
import { EYE_COLORS } from '../body/bodyModule.js';
import { PRESETS, FINE_GROUPS, composeExpression, sameWeights, isAsymmetric } from './expressions.js';
import { BROW_STYLES } from './brows.js';
import { faceIconURL } from './faceIcons.js';
import { currentPad, eyesWorld } from './gaze.js';
import { focusHead } from '../pose/focus.js';

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _q = new THREE.Quaternion();

export function buildFacePanel(el, app, shell, face) {
  el.classList.add('pvf');
  let ch = null;
  let visible = false;

  // ------------------------------------------------------------ view (close-up / full figure)
  const closeBtn = button({ label: 'Primo piano', icon: 'face', small: true, onClick: () => {
    if (!ch) return;
    haptic('tick');
    if (!focusHead(app, shell, ch)) toast('Il personaggio è nascosto', { kind: 'info', ms: 1600 });
  } });
  const fullBtn = button({ label: 'Figura intera', icon: 'person', small: true, variant: 'ghost', onClick: () => {
    if (!ch) return;
    haptic('tick');
    app.sceneTools?.camera?.frameSubject?.();
  } });
  const viewRow = h('div', { class: 'pvf-actions pvf-view' }, closeBtn, fullBtn);

  // ------------------------------------------------------------ empty state (no character selected)
  const empty = h('div', { class: 'pv-body-empty pvf-empty' },
    icon('user', 30),
    h('strong', {}, 'Nessun personaggio selezionato'),
    h('span', {}, 'Tocca un personaggio nella scena o sceglilo dall\'elenco.'),
    button({ label: 'Personaggi', icon: 'people', small: true, onClick: () => app.modules.ui?.openPeople?.() || shell.openTool('people') }));

  // ------------------------------------------------------------ expressions
  const grid = cardGrid({
    items: PRESETS.map((p) => ({ id: p.id, label: p.label, thumb: faceIconURL(p.id) })),
    value: null, columns: 4,
    onSelect: (id) => { if (!ch) return; haptic('tick'); face.setPreset(ch, id); refresh(); },
  });
  grid.classList.add('pvf-grid');
  const intensity = slider({
    label: 'Intensità', min: 0, max: 1.5, step: 0.01, value: 1, defaultValue: 1,
    format: (v) => Math.round(v * 100) + '%',
    onInput: (v) => ch && face.setIntensity(ch, v, false),
    onChange: (v) => ch && face.setIntensity(ch, v, true),
  });
  const mirrorBtn = button({ label: 'Inverti lati', icon: 'mirror', small: true, onClick: () => { if (!ch) return; haptic('tick'); face.toggleMirror(ch); refresh(); } });
  const neutralBtn = button({ label: 'Neutro', icon: 'reset', small: true, variant: 'ghost', onClick: () => { if (!ch) return; haptic('tick'); face.resetExpression(ch); refresh(); } });
  const exprState = h('span', { class: 'pvf-state' });

  // ------------------------------------------------------------ gaze
  const pad = gazePad({
    flip: () => cameraFlip(),
    onInput: (gx, gy) => { if (ch) { face.setGaze(ch, gx, gy, false); syncGazeToggles(); } },
    onEnd: () => ch && face.commitGaze(ch),
  });
  const camToggle = toggle({ label: 'Guarda la camera', value: false, onChange: (on) => { if (!ch) return; face.setLookAtCamera(ch, on); syncGaze(); } });
  const pointBtn = button({ label: 'Guarda un punto', icon: 'target', small: true, onClick: () => startPointPick() });
  const pointClear = iconButton({ icon: 'close', title: 'Smetti di guardare il punto', onClick: () => { if (!ch) return; face.setLookAtPoint(ch, null); syncGaze(); } });
  const centerBtn = button({ label: 'Centra', small: true, variant: 'ghost', onClick: () => { if (!ch) return; haptic('tick'); face.setGaze(ch, 0, 0, true); syncGaze(); } });

  // ------------------------------------------------------------ fine tuning
  const fineSliders = new Map();
  const fineBody = [];
  for (const g of FINE_GROUPS) {
    fineBody.push(h('div', { class: 'pvf-sub' }, g.label, g.note ? h('small', {}, ' · ' + g.note) : null));
    for (const it of g.items) {
      const s = slider({
        label: it.label, min: it.min ?? 0, max: 1, step: 0.01, value: 0, defaultValue: 0,
        format: (v) => (v > 0 && it.min ? '+' : '') + Math.round(v * 100) + '%',
        onInput: (v) => ch && face.setFine(ch, it.id, v, false),
        onChange: (v) => { if (ch) { face.setFine(ch, it.id, v, true); syncExpressionState(); } },
      });
      fineSliders.set(it.id, s);
      fineBody.push(s);
    }
  }
  const resetFine = button({ label: 'Azzera ritocchi', icon: 'reset', small: true, onClick: () => { if (!ch) return; face.resetFine(ch); refresh(); } });
  fineBody.push(h('div', { class: 'pvf-actions' }, resetFine));

  // ------------------------------------------------------------ details
  const brows = chips({ items: BROW_STYLES.map((s) => ({ id: s.id, label: s.label })), value: 'natural', onSelect: (id) => { if (!ch) return; haptic('tick'); face.setBrows(ch, id); brows.setValue(id); } });
  const lashes = toggle({ label: 'Ciglia', value: true, onChange: (on) => ch && face.setLashes(ch, on) });
  // custom picker: live preview while it moves, one undo step on release
  const eyeColor = swatches({ colors: EYE_COLORS, value: '#5b3a21',
    onInput: (c) => { if (ch) ch.setAppearance({ eyes: c }); },
    onChange: (c) => { if (!ch) return; ch.setAppearance({ eyes: c }); app.commit('colore occhi'); } });

  const exprSection = section('Espressione', [
    h('div', { class: 'pvf-exprhead' }, intensity),
    grid,
    h('div', { class: 'pvf-actions' }, exprState, mirrorBtn, neutralBtn),
  ]);
  const gazeSection = section('Sguardo', [
    pad.el,
    h('div', { class: 'pvf-hint' }, 'Trascina l’iride per orientare lo sguardo'),
    camToggle,
    h('div', { class: 'pvf-actions' }, pointBtn, pointClear, centerBtn),
  ]);
  const fineSection = section('Ritocchi', fineBody, { collapsible: true, collapsed: true });
  const detailSection = section('Sopracciglia, ciglia e occhi', [
    h('div', { class: 'pvf-sub' }, 'Sopracciglia'), brows,
    lashes,
    h('div', { class: 'pvf-sub' }, 'Colore occhi'), eyeColor,
  ]);
  const content = h('div', { class: 'pvf-content' }, viewRow, exprSection, gazeSection, fineSection, detailSection);
  el.append(empty, content);

  // ------------------------------------------------------------ sync
  function refresh() {
    ch = app.selection.character;
    empty.style.display = ch ? 'none' : '';
    content.style.display = ch ? '' : 'none';
    if (!ch) return;
    const st = face.state(ch);
    intensity.setValue(st.intensity);
    for (const [id, s] of fineSliders) s.setValue(st.fine[id] || 0);
    brows.setValue(st.brows);
    lashes.setValue(st.lashes !== false);
    eyeColor.setValue(ch.appearance.eyes);
    syncExpressionState();
    syncGaze();
  }

  /** Highlights the preset only while ch.expression still matches the face state. */
  function syncExpressionState() {
    if (!ch) return;
    const st = face.state(ch);
    const matches = sameWeights(face.composeFor ? face.composeFor(ch) : composeExpression(st), ch.expression);
    grid.setValue(matches ? st.preset : null);
    const tuned = matches && Object.keys(st.fine).length > 0;
    exprState.textContent = !matches ? 'Personalizzata' : tuned ? 'Con ritocchi' : '';
    mirrorBtn.disabled = !(matches && isAsymmetric(st.preset));
    mirrorBtn.classList.toggle('active', !!st.mirror);
    intensity.classList.toggle('pvf-dim', !matches || st.preset === 'neutral');
  }

  function syncGazeToggles() {
    const st = face.state(ch);
    camToggle.setValue(st.lookAtCamera);
    pointBtn.classList.toggle('active', !!st.lookAt);
    pointBtn.querySelector('span').textContent = st.lookAt ? 'Cambia punto' : 'Guarda un punto';
    pointClear.style.display = st.lookAt ? '' : 'none';
    pad.el.classList.toggle('pvf-auto', !!(st.lookAtCamera || st.lookAt));
  }

  function syncGaze() {
    if (!ch) return;
    syncGazeToggles();
    const st = face.state(ch);
    if (st.lookAtCamera || st.lookAt) { const [x, y] = currentPad(ch); pad.setValue(x * cameraFlip(), y); }
    else pad.setValue(st.gaze[0] * cameraFlip(), st.gaze[1]);
  }

  /** +1 when the camera sees the character's face (pad right = screen right = character's left). */
  function cameraFlip() {
    if (!ch) return 1;
    ch.root.getWorldQuaternion(_q);
    _f.set(0, 0, 1).applyQuaternion(_q);
    eyesWorld(ch, _v);
    const cam = app.camera.position; // the camera has no parent: local = world
    return (cam.x - _v.x) * _f.x + (cam.z - _v.z) * _f.z >= 0 ? 1 : -1;
  }

  // ------------------------------------------------------------ look at a point
  let picking = null;
  function startPointPick() {
    if (!ch || picking) return;
    haptic('tick');
    const target = ch;
    const done = (p) => {
      picking?.off(); picking?.offBack(); picking = null;
      shell.hint('');
      pointBtn.classList.remove('pvf-picking');
      if (p) { face.setLookAtPoint(target, p); haptic('success'); }
      syncGaze();
      app.invalidate();
    };
    const off = app.addTapHandler(({ ndc }) => {
      app.raycaster.setFromCamera(ndc, app.camera);
      const objs = [];
      app.world.traverseVisible((o) => { if (o.isMesh && o.userData.character !== target && !o.userData.faceModule && !o.isSkinnedMesh) objs.push(o); });
      // other characters: raycast their bodies (skinned)
      for (const c of app.characters) if (c !== target && c.root.visible) objs.push(c.body);
      if (app.ground) objs.push(app.ground);
      const hit = app.raycaster.intersectObjects(objs, false)[0];
      let p = hit?.point;
      if (!p) { // nothing hit: point on a plane through the eyes facing the camera
        eyesWorld(target, _v);
        const n = app.camera.getWorldDirection(_f);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, _v.clone().addScaledVector(n, 1.2));
        p = app.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      }
      if (p) done(p);
      return true;
    }, 100);
    const offBack = app.pushBackHandler(() => { done(null); return true; });
    picking = { off, offBack };
    pointBtn.classList.add('pvf-picking');
    shell.hint('Tocca nella scena il punto da guardare (es. il viso di un altro personaggio)');
  }

  /** Small crosshair helper shown at the current look-at point while the panel is open. */
  let marker = null;
  function pointMarker() {
    const g = new THREE.RingGeometry(0.018, 0.026, 32);
    const m = new THREE.MeshBasicMaterial({ color: '#a89dff', depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    m.toneMapped = false;
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 999;
    mesh.name = 'face:lookAtMarker';
    return mesh;
  }
  function updateMarker() {
    const st = ch ? face.state(ch) : null;
    const show = visible && st?.lookAt;
    if (show && !marker) { marker = pointMarker(); app.scene.add(marker); }
    if (!show && marker) { marker.removeFromParent(); marker.geometry.dispose(); marker.material.dispose(); marker = null; }
    if (marker) {
      marker.position.fromArray(st.lookAt);
      marker.quaternion.copy(app.camera.quaternion);
    }
    app.invalidate();
  }
  const markerHook = () => { if (marker) marker.quaternion.copy(app.camera.quaternion); return false; };
  app.addRenderHook(markerHook);

  // gaze followed by the camera / point modes: move the pad dot (throttled to frames)
  let gazeRaf = 0;
  face.onGaze = (c) => {
    if (!visible || c !== ch || gazeRaf) return;
    gazeRaf = requestAnimationFrame(() => { gazeRaf = 0; syncGaze(); });
  };

  // ------------------------------------------------------------ app events
  const live = () => visible;
  app.addEventListener('selection', () => { if (live()) { refresh(); updateMarker(); } });
  app.addEventListener('loaded', () => { if (live()) { refresh(); updateMarker(); } });
  app.addEventListener('history', () => { if (live()) refresh(); });
  app.addEventListener('characters', () => { if (live()) { refresh(); updateMarker(); } });
  app.addEventListener('facechange', (e) => { if (live() && e.character === ch) { if (e.what === 'gaze') updateMarker(); if (e.what === 'expression') syncExpressionState(); } });
  // orbiting behind the character mirrors the pad (it always maps to screen directions)
  let flipRaf = 0, lastFlip = 1;
  app.controls.addEventListener('change', () => {
    if (!live() || !ch || flipRaf) return;
    flipRaf = requestAnimationFrame(() => { flipRaf = 0; if (!ch) return; const f = cameraFlip(); if (f !== lastFlip) { lastFlip = f; syncGaze(); } });
  });

  return {
    onShow() { visible = true; refresh(); updateMarker(); },
    onHide() { visible = false; if (picking) { picking.off(); picking.offBack(); picking = null; shell.hint(''); } updateMarker(); },
  };
}

// ====================================================================== gaze pad
/**
 * Almond-shaped eye: drag the iris to aim the gaze. Values gx (right +) / gy (up +) in [-1, 1].
 * opts: {onInput(gx, gy), onEnd(), flip() -> +1 | -1}
 */
function gazePad(opts) {
  const W = 220, H = 112, CX = W / 2, CY = H / 2, RX = 70, RY = 30;
  const el = h('div', { class: 'pvf-pad', role: 'slider', 'aria-label': 'Direzione dello sguardo', tabindex: '0' });
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <clipPath id="pvf-almond"><path d="M8,${CY} C60,-14 ${W - 60},-14 ${W - 8},${CY} C${W - 60},${H + 14} 60,${H + 14} 8,${CY} Z"/></clipPath>
        <radialGradient id="pvf-irisg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#cfc6ff"/><stop offset="55%" stop-color="#8d7dff"/><stop offset="100%" stop-color="#4b3fb0"/>
        </radialGradient>
        <radialGradient id="pvf-sclerag" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stop-color="#f4f2ff"/><stop offset="100%" stop-color="#bdb8d6"/>
        </radialGradient>
      </defs>
      <path class="pvf-pad-sclera" d="M8,${CY} C60,-14 ${W - 60},-14 ${W - 8},${CY} C${W - 60},${H + 14} 60,${H + 14} 8,${CY} Z" fill="url(#pvf-sclerag)"/>
      <g clip-path="url(#pvf-almond)">
        <path d="M${CX},6 V${H - 6} M14,${CY} H${W - 14}" stroke="rgba(60,50,120,.18)" stroke-width="1.2" stroke-dasharray="3 4"/>
        <g class="pvf-iris">
          <circle r="27" fill="url(#pvf-irisg)"/>
          <circle r="27" fill="none" stroke="#2c2470" stroke-width="2.5" opacity=".7"/>
          <circle r="11" fill="#151225"/>
          <circle cx="-8" cy="-9" r="4.5" fill="#fff" opacity=".85"/>
        </g>
      </g>
      <path d="M8,${CY} C60,-14 ${W - 60},-14 ${W - 8},${CY} C${W - 60},${H + 14} 60,${H + 14} 8,${CY} Z" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2"/>
    </svg>`;
  const iris = el.querySelector('.pvf-iris');
  let gx = 0, gy = 0, drag = null, lastTap = 0;
  const place = () => iris.setAttribute('transform', `translate(${CX + gx * RX} ${CY - gy * RY})`);
  const fromEvent = (e) => {
    const r = el.querySelector('svg').getBoundingClientRect();
    // viewBox is letter-boxed inside the element: map with the actual drawn size
    const s = Math.min(r.width / W, r.height / H);
    const ox = r.left + (r.width - W * s) / 2, oy = r.top + (r.height - H * s) / 2;
    const x = (e.clientX - ox) / s, y = (e.clientY - oy) / s;
    gx = Math.max(-1, Math.min(1, (x - CX) / RX));
    gy = Math.max(-1, Math.min(1, -(y - CY) / RY));
  };
  const emit = () => { const f = opts.flip?.() || 1; opts.onInput?.(gx * f, gy); };
  el.addEventListener('pointerdown', (e) => {
    const now = performance.now();
    if (now - lastTap < 300) { gx = 0; gy = 0; place(); emit(); opts.onEnd?.(); lastTap = 0; return; }
    lastTap = now;
    drag = e.pointerId;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    fromEvent(e); place(); emit();
  });
  el.addEventListener('pointermove', (e) => { if (drag !== e.pointerId) return; fromEvent(e); place(); emit(); });
  const end = (e) => {
    if (drag !== e.pointerId) return;
    drag = null;
    el.classList.remove('dragging');
    opts.onEnd?.();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[e.key];
    if (!k) return;
    e.preventDefault();
    gx = Math.max(-1, Math.min(1, gx + k[0])); gy = Math.max(-1, Math.min(1, gy + k[1]));
    place(); emit(); opts.onEnd?.();
  });
  place();
  return {
    el,
    setValue(x, y) { if (drag !== null) return; gx = Math.max(-1, Math.min(1, x)); gy = Math.max(-1, Math.min(1, y)); place(); },
  };
}
