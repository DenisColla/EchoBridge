// "Personaggi" tool: list of the characters in the scene (select, show/hide,
// rename, duplicate, frame, delete) and the "Aggiungi" flow (Donna/Uomo ->
// body type cards with real body-shape thumbnails -> new character placed at
// a free spot, facing the camera, selected and framed).
import * as THREE from 'three';
import { h, icon, iconButton, button, segmented, toast, haptic, confirmDialog, promptDialog, sheetMenu } from '../ui/kit.js';

export const MAX_CHARACTERS = 8;
export const SEX_LABEL = { F: 'Donna', M: 'Uomo' };
/** default names: "Donna 1", "Uomo 2" … (numbered per sex) */
const DEFAULT_NAME = /^(Donna|Uomo) \d+$/;
const GAP = 0.06; // m of free space between the bounds of characters placed side by side
const STEP = 0.05; // m: search step of a free spot along the camera's right vector

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _pt = new THREE.Vector3(), _box = new THREE.Box3(), _box2 = new THREE.Box3();

/** Hidden state lives in ch.data.ui.hidden (serialized with the character). */
export function setCharacterHidden(ch, hidden) {
  ch.data.ui = { ...(ch.data.ui || {}), hidden: !!hidden };
  if (!hidden) delete ch.data.ui.hidden;
  if (!Object.keys(ch.data.ui).length) delete ch.data.ui;
  if (ch.root.visible !== !hidden) { ch.root.visible = !hidden; ch.dispatchEvent({ type: 'visibility' }); }
}

export function describe(ch) {
  // "Donna 1" already says the sex
  if (ch.name.startsWith(SEX_LABEL[ch.sex] || '\0')) return `Corporatura ${ch.preset.label.toLowerCase()}`;
  return `${SEX_LABEL[ch.sex] || ''} · ${ch.preset.label}`;
}

/** True for an automatic name ("Donna 1", "Uomo 2"), which follows the sex. */
export function isDefaultName(name) { return DEFAULT_NAME.test(name || ''); }

/** World bounds of a character from its skinned body (sampled). */
export function characterBox(ch, box = _box) {
  box.makeEmpty();
  ch.root.updateWorldMatrix(true, true);
  const P = ch.getSkinnedPositions(), M = ch.rig.matrixWorld, verts = ch.model.groupVertices[0];
  for (let i = 0; i < verts.length; i += 7) { const k = verts[i] * 3; box.expandByPoint(_pt.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(M)); }
  return box;
}

export class PeopleTool {
  /** ctx: {app, shell, thumbs, viewOffset} */
  constructor(ctx) {
    this.ctx = ctx;
    this.app = ctx.app;
    this.shell = ctx.shell;
    this.view = 'list';
    this.addSex = 'F';
    this._raf = 0;
    this._popBack = null;
    this.tool = ctx.shell.registerTool({
      id: 'people', group: 'people', label: 'Personaggi', icon: 'people', order: 5, title: 'Personaggi',
      build: (el) => this._build(el),
    });
    const app = this.app;
    for (const ev of ['characters', 'selection', 'loaded']) app.addEventListener(ev, () => this.refresh());
  }

  get visible() { return this.shell.activeToolId === 'people'; }

  /** Re-renders the list on the next frame (cheap: at most 8 rows). */
  refresh() {
    if (!this.el || !this.visible || this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._render(); });
  }

  /** Opens the tool, optionally straight on the add flow. */
  open({ add = false } = {}) {
    this.shell.openTool('people');
    this._setView(add ? 'add' : 'list');
  }

  _build(el) {
    this.el = el;
    el.classList.add('pv-io-people-tool');
    this.listView = h('div', { class: 'pv-io-view' });
    this.addView = h('div', { class: 'pv-io-view' });
    el.append(this.listView, this.addView);
    this._render();
    return {
      onShow: () => { this._render(); },
      onHide: () => { this._setView('list', false); },
    };
  }

  _setView(v, render = true) {
    if (this.view === v) { if (render && this.el) this._render(); return; }
    this.view = v;
    // Android back leaves the add flow first
    this._popBack?.(); this._popBack = null;
    if (v === 'add') this._popBack = this.app.pushBackHandler(() => { this._setView('list'); return true; });
    if (render && this.el) { this._render(); this.shell.panelBody.scrollTop = 0; }
  }

  _render() {
    if (!this.el) return;
    this.listView.style.display = this.view === 'list' ? '' : 'none';
    this.addView.style.display = this.view === 'add' ? '' : 'none';
    if (this.view === 'list') this._renderList(); else this._renderAdd();
  }

  // ---------------------------------------------------------------- list
  _renderList() {
    const app = this.app, chars = app.characters, sel = app.selection.character;
    const full = chars.length >= MAX_CHARACTERS;
    const add = button({ label: 'Aggiungi', icon: 'userPlus', variant: 'primary', onClick: () => { haptic('tick'); this._tryAdd(); } });
    if (full) add.classList.add('soft-disabled');
    const head = h('div', { class: 'pv-io-people-head' },
      h('div', { class: 'pv-io-count' }, h('strong', {}, String(chars.length)), ` di ${MAX_CHARACTERS} personaggi`),
      add);
    const list = h('div', { class: 'pv-io-people', role: 'list' });
    chars.forEach((ch) => list.appendChild(this._row(ch, ch === sel)));
    if (!chars.length) {
      list.appendChild(h('div', { class: 'pv-io-empty' }, icon('people', 34), h('strong', {}, 'La scena è vuota'), h('span', {}, 'Aggiungi una donna o un uomo per iniziare.')));
    }
    const tip = chars.length ? h('p', { class: 'pv-io-note' }, 'Tocca un personaggio per selezionarlo. Tieni premuto o usa ⋯ per rinominarlo, duplicarlo o eliminarlo.') : null;
    this.listView.replaceChildren(head, list, tip || '');
  }

  _row(ch, selected) {
    const hidden = !ch.root.visible;
    const avatar = this._avatar(ch, 44);
    const eye = iconButton({ icon: hidden ? 'eyeOff' : 'eye', title: hidden ? 'Mostra' : 'Nascondi', onClick: (e) => { e.stopPropagation(); this.toggleHidden(ch); } });
    const more = iconButton({ icon: 'more', title: 'Altre azioni', onClick: (e) => { e.stopPropagation(); this.menu(ch, more); } });
    const row = h('div', { class: `pv-io-person ${selected ? 'selected' : ''} ${hidden ? 'hidden' : ''}`.trim(), role: 'listitem', tabindex: '0' },
      avatar,
      h('div', { class: 'pv-io-person-info' },
        h('div', { class: 'pv-io-person-name' }, h('span', { class: 'pv-io-person-label' }, ch.name), selected ? h('span', { class: 'pv-io-tag' }, 'Selezionato') : null, hidden ? h('span', { class: 'pv-io-tag muted' }, 'Nascosto') : null),
        h('div', { class: 'pv-io-person-sub' }, describe(ch))),
      eye, more);
    row.addEventListener('click', () => { haptic('tick'); this.app.select(ch); });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.app.select(ch); });
    // long press -> actions
    let lp = 0, sx = 0, sy = 0;
    row.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      sx = e.clientX; sy = e.clientY;
      clearTimeout(lp);
      lp = setTimeout(() => { lp = 0; haptic('medium'); row._longPressed = true; this.menu(ch, more); }, 520);
    });
    const cancel = (e) => { if (lp && (e.type !== 'pointermove' || Math.hypot(e.clientX - sx, e.clientY - sy) > 8)) { clearTimeout(lp); lp = 0; } };
    row.addEventListener('pointermove', cancel);
    row.addEventListener('pointerup', cancel);
    row.addEventListener('pointercancel', cancel);
    row.addEventListener('click', (e) => { if (row._longPressed) { row._longPressed = false; e.stopImmediatePropagation(); } }, true);
    return row;
  }

  /** Round bust avatar tinted with the character's skin color. */
  _avatar(ch, size) {
    const wrap = h('div', { class: `pv-io-avatar ${ch.sex === 'M' ? 'm' : 'f'}`, style: { width: size + 'px', height: size + 'px' } }, icon(ch.sex === 'M' ? 'male' : 'female', Math.round(size * 0.5)));
    const opts = { w: size, h: size, region: 'bust', color: ch.appearance.skin };
    const set = (url) => { if (!url) return; const img = h('img', { src: url, alt: '' }); wrap.replaceChildren(img); };
    const hit = this.ctx.thumbs.peek(ch.presetId, opts);
    if (hit) set(hit); else this.ctx.thumbs.get(ch.presetId, opts).then(set);
    return wrap;
  }

  async menu(ch, anchor) {
    const hidden = !ch.root.visible;
    await sheetMenu([
      { id: 'select', label: 'Seleziona e inquadra', icon: 'target', onClick: () => { this.app.select(ch); this.frame(ch, { commit: true }); } },
      { id: 'rename', label: 'Rinomina', icon: 'edit', onClick: () => this.rename(ch) },
      { id: 'dup', label: 'Duplica', icon: 'copy', hint: 'Stessa forma, posa e vestiti', onClick: () => this.duplicate(ch) },
      { id: 'hide', label: hidden ? 'Mostra' : 'Nascondi', icon: hidden ? 'eye' : 'eyeOff', onClick: () => this.toggleHidden(ch) },
      { separator: true },
      { id: 'del', label: 'Elimina', icon: 'trash', danger: true, onClick: () => this.remove(ch) },
    ], { title: ch.name, anchor });
  }

  // ---------------------------------------------------------------- actions
  toggleHidden(ch) {
    const hide = ch.root.visible;
    setCharacterHidden(ch, hide);
    haptic('tick');
    this.app.invalidate();
    this.app.commit(hide ? 'nascondi personaggio' : 'mostra personaggio');
    toast(hide ? `${ch.name} nascosto` : `${ch.name} visibile`, 1600);
    this.refresh();
  }

  async rename(ch) {
    const name = await promptDialog('Nome del personaggio', ch.name, { title: 'Rinomina', okLabel: 'Salva', maxLength: 32 });
    if (!name || name === ch.name || !this.app.characters.includes(ch)) return;
    ch.name = name;
    this.app.dispatchEvent({ type: 'characters' });
    this.app.commit('rinomina');
  }

  duplicate(ch) {
    if (this.app.characters.length >= MAX_CHARACTERS) return this._limitMessage();
    const c2 = this.app.duplicateCharacter(ch);
    // keep a readable, unique name ("Anna" -> "Anna 2", "Donna 1" -> "Donna 2")
    c2.name = isDefaultName(ch.name) ? this.defaultName(c2.sex, c2) : this.uniqueName(ch.name.replace(/\s+\d+$/, ''), c2);
    const spot = this.freeSpot(ch.root.position, c2);
    if (spot) this._place(c2, spot, c2.root.rotation.y);
    // props held in its hands come along (same side, fingers already posed)
    this.app.props?.copyHeld?.(ch, c2);
    this.app.invalidate();
    this.app.dispatchEvent({ type: 'characters' });
    this.app.commit('duplica personaggio');
    haptic('success');
    toast(`Creato ${c2.name}`, { kind: 'ok', ms: 1800 });
  }

  async remove(ch) {
    const ok = await confirmDialog(`«${ch.name}» verrà rimosso dalla scena. Potrai recuperarlo con Annulla.`, { title: 'Eliminare il personaggio?', okLabel: 'Elimina', danger: true, icon: 'trash' });
    if (!ok || !this.app.characters.includes(ch)) return;
    const name = ch.name;
    this.app.removeCharacter(ch);
    this.app.commit('elimina personaggio');
    const h = this.app.history, idx = h.index;
    // undo only if nothing else was recorded meanwhile
    toast(`${name} eliminato`, { action: { label: 'Annulla', onClick: () => { if (h.index === idx) h.undo(); } } });
  }

  _limitMessage() {
    haptic('warning');
    toast(`Al massimo ${MAX_CHARACTERS} personaggi per scena: elimina o nascondi qualcuno per fare spazio.`, { kind: 'warning', ms: 3600 });
  }

  _tryAdd() {
    if (this.app.characters.length >= MAX_CHARACTERS) return this._limitMessage();
    this._setView('add');
  }

  /** Name not used by another character: "Curvy", "Curvy 2", ... */
  uniqueName(base, except = null) {
    const taken = new Set(this.app.characters.filter((c) => c !== except).map((c) => c.name));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  /** First free automatic name of a sex: "Donna 1", "Donna 2", "Uomo 1" … */
  defaultName(sex, except = null) {
    const base = SEX_LABEL[sex] || 'Personaggio';
    const taken = new Set(this.app.characters.filter((c) => c !== except).map((c) => c.name));
    for (let i = 1; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  /**
   * Ground spot near `around` (default: the selected character, else the orbit
   * target) where `ch` (default: an A-pose body about 1 m wide) does not touch
   * another character, searched side by side along the camera's right vector
   * (right first). Spacing comes from the actual bounds (arms, poses, body
   * types), so new characters in A-pose never interlock their hands.
   */
  freeSpot(around = null, ch = null) {
    const app = this.app, cam = app.camera;
    const sel = app.selection.character;
    const c = (around ? _v.copy(around) : sel && sel !== ch ? _v.copy(sel.root.position) : _v.copy(app.controls.target)).setY(0);
    const right = _v2.set(1, 0, 0).applyQuaternion(cam.quaternion).setY(0);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
    const fwd = _v3.set(-right.z, 0, right.x);
    // extent of a box along a horizontal axis: center and half size
    const cen = (b, a) => ((b.min.x + b.max.x) * a.x + (b.min.z + b.max.z) * a.z) / 2;
    const half = (b, a) => (Math.abs(a.x) * (b.max.x - b.min.x) + Math.abs(a.z) * (b.max.z - b.min.z)) / 2;
    // the new character: offset of its bounds center from its root (along right / forward) and half sizes
    let nr = 0, nf = 0, hr = 0.53, hf = 0.22;
    if (ch) {
      const b = characterBox(ch, _box2), p = ch.root.position;
      nr = cen(b, right) - (p.x * right.x + p.z * right.z); nf = cen(b, fwd) - (p.x * fwd.x + p.z * fwd.z);
      hr = half(b, right); hf = half(b, fwd);
    }
    const others = app.characters.filter((o) => o !== ch && o.root.visible).map((o) => {
      const b = characterBox(o, _box2);
      return { r: cen(b, right), f: cen(b, fwd), hr: half(b, right), hf: half(b, fwd) };
    });
    const c0r = c.x * right.x + c.z * right.z + nr, c0f = c.x * fwd.x + c.z * fwd.z + nf;
    const free = (t) => others.every((o) => Math.abs(c0r + t - o.r) >= hr + o.hr + GAP || Math.abs(c0f - o.f) >= hf + o.hf + GAP);
    for (let i = 0; i < 240; i++) {
      const t = (i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2)) * STEP;
      if (free(t)) return new THREE.Vector3(c.x + right.x * t, 0, c.z + right.z * t);
    }
    return null;
  }

  _place(ch, pos, rotationY) {
    if (typeof ch.setPlacement === 'function') ch.setPlacement({ position: pos, rotationY });
    else { ch.root.position.copy(pos); ch.root.rotation.y = rotationY; }
  }

  /** Adds a character of a preset, selects it and frames it. */
  add(presetId) {
    const app = this.app;
    if (app.characters.length >= MAX_CHARACTERS) { this._limitMessage(); return null; }
    const preset = app.model.presetById.get(presetId);
    if (!preset) return null;
    // created at the anchor facing the camera, then moved to a spot that fits its real bounds
    const sel = app.selection.character;
    const anchor = (sel ? sel.root.position.clone() : app.controls.target.clone()).setY(0);
    const face = (p) => {
      const step = Math.PI / 12; // snapped to 15 degrees
      return Math.round(Math.atan2(app.camera.position.x - p.x, app.camera.position.z - p.z) / step) * step || 0;
    };
    const ch = app.addCharacter({ preset: presetId, name: this.defaultName(preset.sex), position: anchor.toArray(), rotationY: face(anchor) });
    let spot = this.freeSpot(anchor, ch);
    if (spot) {
      this._place(ch, spot, face(spot));
      // turning toward the camera from the new spot changes its width a little: check again
      spot = this.freeSpot(spot, ch);
      if (spot) this._place(ch, spot, face(spot));
    } else {
      // crowded: at the right end of the row
      const xs = app.characters.filter((o) => o !== ch).map((o) => o.root.position.x);
      const p = new THREE.Vector3((xs.length ? Math.max(...xs) : anchor.x) + 1.3, 0, anchor.z);
      this._place(ch, p, face(p));
    }
    this.ctx.viewOffset?.holdSelection(700);
    app.select(ch);
    this.frame(ch);
    app.commit('nuovo personaggio');
    haptic('success');
    toast(`${ch.name} aggiunto alla scena`, { kind: 'ok', ms: 1800 });
    return ch;
  }

  /** Frames a character (camera module when present, else a direct fit). */
  frame(ch, { commit = false } = {}) {
    const app = this.app;
    const camTools = app.sceneTools?.camera;
    if (app.selection.character !== ch) app.select(ch);
    if (camTools?.frameSubject) camTools.frameSubject({ animate: true, commit });
    else {
      const box = characterBox(ch), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const cam = app.camera, dir = new THREE.Vector3().subVectors(cam.position, app.controls.target).normalize();
      const fov = THREE.MathUtils.degToRad(cam.getEffectiveFOV());
      const dist = Math.max(size.y / 0.88 / (2 * Math.tan(fov / 2)), size.x / 0.88 / (2 * Math.tan(fov / 2) * cam.aspect)) + size.z;
      app.controls.target.copy(center);
      cam.position.copy(center).addScaledVector(dir, Math.max(0.5, dist));
      app.controls.update();
      app.invalidate();
      if (commit) app.commit('inquadra');
    }
    this.ctx.viewOffset?.refreshAfter(camTools?.frameSubject ? 560 : 30);
  }

  // ---------------------------------------------------------------- add flow
  _renderAdd() {
    const app = this.app;
    const back = iconButton({ icon: 'arrowLeft', title: 'Indietro', onClick: () => { haptic('tick'); this._setView('list'); } });
    const head = h('div', { class: 'pv-io-add-head' }, back, h('div', {}, h('div', { class: 'pv-io-add-title' }, 'Nuovo personaggio'), h('div', { class: 'pv-io-add-sub' }, 'Scegli sesso e corporatura')));
    const sex = segmented({ options: [{ value: 'F', label: 'Donna', icon: 'female' }, { value: 'M', label: 'Uomo', icon: 'male' }], value: this.addSex,
      onChange: (v) => { haptic('tick'); this.addSex = v; this._renderAdd(); } });
    const grid = h('div', { class: 'pv-io-body-cards' });
    for (const p of app.model.presets.filter((x) => x.sex === this.addSex)) {
      const vis = h('div', { class: 'pv-io-body-visual' }, icon('body', 40));
      const card = h('button', { type: 'button', class: 'pv-io-body-card' }, vis, h('span', { class: 'pv-io-body-label' }, p.label));
      const opts = { w: 96, h: 136, region: 'full' };
      const set = (url) => { if (url) vis.replaceChildren(h('img', { src: url, alt: p.label })); };
      const hit = this.ctx.thumbs.peek(p.id, opts);
      if (hit) set(hit); else this.ctx.thumbs.get(p.id, opts).then(set);
      card.addEventListener('click', () => { if (this.add(p.id)) this._setView('list'); });
      grid.appendChild(card);
    }
    const note = h('p', { class: 'pv-io-note' }, 'Il nuovo personaggio appare accanto agli altri, rivolto verso la camera. Potrai regolarne forma, pelle e occhi in Aspetto › Corpo.');
    this.addView.replaceChildren(head, sex, grid, note);
    // warm up the other sex in the background
    for (const p of app.model.presets) this.ctx.thumbs.get(p.id, { w: 96, h: 136, region: 'full' });
  }
}
