// Quick close-ups ("zoom rapido").
//
//  - Lens button next to the selected body part: one tap frames that part.
//  - Fixed quick button (bottom-right of the free view): opens a small menu of
//    body parts (Corpo intero, Testa, Mani, Piedi, Parte selezionata).
//  - While in a close-up the orbit target FOLLOWS the part (posing the arm or
//    moving the character keeps it centered); the user can orbit around it and
//    keep editing.
//  - "Torna alla vista" (and the Android back gesture) restores the camera that
//    was active before the first close-up.
// Camera moves are view changes: nothing is committed to the undo history.
import * as THREE from 'three';
import './focus.css';
import { h, icon, haptic } from '../ui/kit.js';
import { focusControl, focusHead, focusHand, focusFoot } from '../pose/focus.js';

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _d = new THREE.Vector3();

export function create(app, shell) {
  const rig = () => app.sceneTools?.camera || null;
  const controlsOf = () => app.posing?.controls || null;

  /** active close-up: {ch, bone, local (target in bone space), last (world), saved view, tweening} */
  let focus = null;
  let popBack = null;

  // ---------------------------------------------------------------- UI
  const lens = h('button', { type: 'button', class: 'pv-focus-lens', title: 'Primo piano sulla parte', 'aria-label': 'Primo piano sulla parte' }, icon('zoom', 20));
  const back = h('button', { type: 'button', class: 'pv-focus-back' }, icon('focusBack', 18), h('span', {}, 'Torna alla vista'));
  const menu = h('div', { class: 'pv-focus-menu', role: 'menu' });
  const fab = h('button', { type: 'button', class: 'pv-focus-fab', title: 'Zoom rapido', 'aria-label': 'Zoom rapido' }, icon('zoom', 22));
  const wrap = h('div', { class: 'pv-focus-wrap' }, menu, fab);
  shell.overlay.append(lens, back, wrap);

  lens.addEventListener('click', (e) => {
    e.stopPropagation();
    const { character: ch, part } = app.selection;
    const c = part && controlsOf()?.get(part);
    if (ch && c) start(ch, () => focusControl(app, shell, ch, c), c.pivot);
  });
  back.addEventListener('click', (e) => { e.stopPropagation(); exit(true); });
  fab.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener('pointerdown', (e) => { if (menuOpen && !wrap.contains(e.target)) toggleMenu(false); }, true);

  let menuOpen = false, popMenuBack = null;
  function toggleMenu(open = !menuOpen) {
    menuOpen = open;
    wrap.classList.toggle('open', open);
    if (open) {
      buildMenu();
      haptic(8);
      popMenuBack ||= app.pushBackHandler(() => { toggleMenu(false); return true; });
    } else if (popMenuBack) { popMenuBack(); popMenuBack = null; }
  }

  function buildMenu() {
    menu.innerHTML = '';
    const ch = app.selection.character || app.characters.find((c) => c.root.visible) || null;
    const part = app.selection.part && controlsOf()?.get(app.selection.part);
    const items = [
      { id: 'body', label: 'Corpo intero', icon: 'body' },
      { id: 'head', label: 'Testa', icon: 'face' },
      { id: 'hand.L', label: 'Mano sinistra', icon: 'hand', flip: true },
      { id: 'hand.R', label: 'Mano destra', icon: 'hand' },
      { id: 'foot.L', label: 'Piede sinistro', icon: 'foot', flip: true },
      { id: 'foot.R', label: 'Piede destro', icon: 'foot' },
    ];
    if (part && !items.some((i) => i.id === part.id)) items.push({ id: part.id, label: part.full || part.label || 'Parte selezionata', icon: 'zoom', sel: true });
    for (const it of items) {
      const ic = icon(it.icon, 20);
      if (it.flip) ic.style.transform = 'scaleX(-1)';
      const b = h('button', { type: 'button', class: 'pv-focus-item' + (it.sel ? ' sel' : ''), role: 'menuitem' }, ic, h('span', {}, it.label));
      if (!ch) b.disabled = true;
      b.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(false); go(ch, it.id); });
      menu.appendChild(b);
    }
    if (!ch) menu.appendChild(h('div', { class: 'pv-focus-empty' }, 'Nessun personaggio in scena'));
  }

  /** Close-up on a menu entry for character ch. */
  function go(ch, id) {
    if (!ch) return;
    haptic(10);
    if (id === 'body') {
      // whole figure: leave close-up mode without restoring the old camera
      clear();
      if (app.selection.character !== ch) app.select(ch, null);
      rig()?.frameSubject ? rig().frameSubject({ animate: true, commit: false }) : null;
      return;
    }
    const c = controlsOf()?.get(id);
    if (c && app.selection.part !== id) app.select(ch, id); // ready to edit that part
    else if (app.selection.character !== ch) app.select(ch, null);
    if (id === 'head') start(ch, () => focusHead(app, shell, ch), 'head');
    else if (id.startsWith('hand.')) start(ch, () => focusHand(app, shell, ch, id.slice(-1)), `wrist.${id.slice(-1)}`);
    else if (id.startsWith('foot.')) start(ch, () => focusFoot(app, shell, ch, id.slice(-1)), `foot.${id.slice(-1)}`);
    else if (c) start(ch, () => focusControl(app, shell, ch, c), c.pivot);
  }

  // ---------------------------------------------------------------- close-up state
  function currentView() {
    const r = rig();
    if (r?.currentView) return r.currentView();
    const p = app.camera.position, t = app.controls.target;
    return { p: p.toArray(), t: t.toArray(), f: app.camera.getFocalLength(), r: 0 };
  }

  function start(ch, doFocus, boneName) {
    const bone = ch.boneByName.get(boneName);
    if (!bone) return;
    const saved = focus?.saved || currentView(); // keep the view from before the FIRST close-up
    if (!doFocus()) return;
    focus = { ch, bone, local: new THREE.Vector3(), last: null, saved, settle: 2 };
    back.classList.add('show');
    popBack ||= app.pushBackHandler(() => { exit(true); return true; });
    app.invalidate();
  }

  function clear() {
    focus = null;
    back.classList.remove('show');
    if (popBack) { popBack(); popBack = null; }
  }

  function exit(restore) {
    if (!focus) return;
    const saved = focus.saved;
    clear();
    if (restore && saved) {
      const r = rig();
      if (r?.applyView) r.applyView(saved, { animate: true, commit: null });
      else {
        app.controls.target.fromArray(saved.t); app.camera.position.fromArray(saved.p);
        app.controls.update();
      }
      haptic(8);
    }
    app.invalidate();
  }

  // the focused character went away / was hidden: drop the close-up
  app.addEventListener('characters', () => { if (focus && !app.characters.includes(focus.ch)) clear(); });

  // ---------------------------------------------------------------- follow the part
  app.addRenderHook(() => {
    if (!focus) return false;
    if (!focus.ch.root.visible) { clear(); return false; }
    const r = rig();
    if (r?.tween) { focus.last = null; focus.settle = 2; return false; } // camera flying in
    focus.bone.updateWorldMatrix(true, false);
    if (!focus.last || focus.settle > 0) {
      // (re)base: remember the orbit target in the bone's frame
      focus.settle = Math.max(0, focus.settle - 1);
      _m.copy(focus.bone.matrixWorld).invert();
      focus.local.copy(app.controls.target).applyMatrix4(_m);
      focus.last = (focus.last || new THREE.Vector3()).copy(app.controls.target);
      return false;
    }
    _v.copy(focus.local).applyMatrix4(focus.bone.matrixWorld);
    _d.subVectors(_v, focus.last);
    if (_d.lengthSq() > 1e-10) {
      app.controls.target.add(_d);
      app.camera.position.add(_d);
      focus.last.copy(_v);
      app.invalidate();
    }
    return false;
  });

  // ---------------------------------------------------------------- lens placement
  const _ndc = new THREE.Vector3();
  function placeLens() {
    const { character: ch, part } = app.selection;
    const c = part && ch && ch.root.visible ? controlsOf()?.get(part) : null;
    const dragging = app.controls.enabled === false; // a gizmo/handle drag is in progress
    if (!c || dragging) { lens.classList.remove('show'); return; }
    const bone = ch.boneByName.get(c.pivot);
    if (!bone) { lens.classList.remove('show'); return; }
    bone.getWorldPosition(_ndc).project(app.camera);
    const W = app.canvas.clientWidth, H = app.canvas.clientHeight;
    if (_ndc.z > 1 || Math.abs(_ndc.x) > 1.05 || Math.abs(_ndc.y) > 1.05) { lens.classList.remove('show'); return; }
    const ins = shell.getViewInsets?.() || { top: 0, right: 0, bottom: 0, left: 0 };
    const r = app.canvas.getBoundingClientRect();
    let x = (_ndc.x * 0.5 + 0.5) * W + 46, y = (0.5 - _ndc.y * 0.5) * H - 46;
    x = Math.min(Math.max(x, ins.left + 26), W - ins.right - 26);
    y = Math.min(Math.max(y, ins.top + 70), H - ins.bottom - 26);
    lens.style.transform = `translate(${Math.round(r.left + x - 20)}px, ${Math.round(r.top + y - 20)}px)`;
    lens.classList.add('show');
  }
  app.addAfterRenderHook(placeLens);
  // a (nearly) full-height sheet leaves no room: hide the quick button instead of pushing it under the top bar
  const fitWrap = () => {
    const ins = shell.getViewInsets?.() || { top: 0, bottom: 0 };
    const free = (app.canvas.clientHeight || window.innerHeight) - ins.top - ins.bottom;
    wrap.style.display = free < 230 ? 'none' : '';
    if (free < 230 && menuOpen) toggleMenu(false);
  };
  app.addEventListener('uilayout', fitWrap);
  app.addEventListener('resize', fitWrap);
  app.addEventListener('selection', () => { placeLens(); if (menuOpen) buildMenu(); });

  return {
    /** programmatic close-ups: id = 'body' | 'head' | 'hand.L' | 'hand.R' | 'foot.L' | 'foot.R' | any pose control id */
    focus: (ch, id) => go(ch || app.selection.character, id),
    exit: () => exit(true),
    get active() { return !!focus; },
  };
}
