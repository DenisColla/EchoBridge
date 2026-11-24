// On-stage shortcut buttons: round, bottom-right of the free view, stacked above the
// "Zoom rapido" button (focus module) and mirrored by the voice mic on the left.
//  - Centra personaggi: frames every visible character with the scene camera framing
//    (app.sceneTools.camera.frameBox, one undo step 'inquadra'); leaves a close-up first.
//  - Cambia ambiente: a menu at the button (kit.stageMenu) with Studio vuoto, the rooms
//    (landscape group 'stanze') and the other landscape presets by group, the most recent
//    ones first; app.landscapes.generate({preset}) / clear() (one undo step each).
// The shell lays them out: #app[data-fabs] = 'col' (above the zoom button) | 'row' (to its
// left, short free view) | 'none' (no room); hidden in Vista pulita and with .pv-view-short.
import * as THREE from 'three';
import { h, icon, haptic, toast, stageMenu } from './kit.js';
import { characterBounds } from '../scene/bounds.js';

/** Landscape groups shown as sub-menus (the rooms are listed directly). */
const GROUPS = [
  { id: 'citta', label: 'Città', icon: 'building' },
  { id: 'natura', label: 'Natura', icon: 'tree' },
  { id: 'fantasy', label: 'Fantasy', icon: 'sparkle' },
];
const ROOMS = 'stanze';
const GROUP_ICON = { stanze: 'sofa', citta: 'building', natura: 'tree', fantasy: 'sparkle' };
/** Last generations on this device, newest first (written by the landscapes module). */
const RECENT_KEY = 'posaviva.landscapes.recent';
const MAX_RECENT = 3;

const _box = new THREE.Box3(), _b = new THREE.Box3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

export class StageShortcuts {
  constructor(shell) {
    this.shell = shell;
    this.app = null;
    this.busy = false;
    this.menu = null;
    this.centerBtn = this._fab('frameAll', 'Centra personaggi', () => this.centerCharacters());
    this.envBtn = this._fab('landscape', 'Cambia ambiente', () => this.openEnvironments());
    this.envBtn.classList.add('gone'); // until the landscapes module is known to be loaded
    this.el = h('div', { class: 'pv-stage-fabs', 'data-pv-fab': '', role: 'toolbar', 'aria-label': 'Scorciatoie della scena' }, this.centerBtn, this.envBtn);
    shell.overlay.appendChild(this.el);
  }

  _fab(ic, title, fn) {
    const b = h('button', { type: 'button', class: 'pv-stage-fab', title, 'aria-label': title }, icon(ic, 22));
    b.addEventListener('click', (e) => { e.stopPropagation(); haptic('tick'); fn(); });
    return b;
  }

  /** Called by the shell when the app is attached. */
  attach(app) {
    if (this.app === app) return;
    this.app = app;
    const refresh = () => this.refresh();
    for (const ev of ['ready', 'characters', 'loaded']) app.addEventListener(ev, refresh);
    this.refresh();
  }

  refresh() {
    const app = this.app;
    if (!app) return;
    this.envBtn.classList.toggle('gone', typeof app.landscapes?.generate !== 'function');
    this.centerBtn.classList.toggle('off', !app.characters.some((c) => c.root.visible));
  }

  // ------------------------------------------------------------------ Centra personaggi
  /** Frames every visible character (one undo step). Returns false when there is none. */
  centerCharacters({ animate = true, commit = true } = {}) {
    const app = this.app;
    if (!app) return false;
    const chars = app.characters.filter((c) => c.root.visible);
    if (!chars.length) { toast('Nessun personaggio in scena', { kind: 'info' }); return false; }
    _box.makeEmpty();
    for (const ch of chars) _box.union(characterBounds(ch, _b, 0.15));
    // a close-up keeps the orbit target on a body part: leave it first
    const focus = app.modules?.focus;
    if (focus?.active) focus.exit();
    const rig = app.sceneTools?.camera;
    if (typeof rig?.frameBox === 'function') rig.frameBox(_box.clone(), { animate, commit });
    else {
      // without the scene module: same view direction, the whole box in the frame
      const cam = app.camera, t = app.controls.target;
      _box.getCenter(_c);
      const r = _box.getSize(_d).length() / 2;
      const fov = THREE.MathUtils.degToRad(cam.getEffectiveFOV()) / 2;
      const dist = r / Math.sin(Math.max(0.05, Math.min(fov, fov * cam.aspect)));
      _d.subVectors(cam.position, t).normalize();
      t.copy(_c);
      cam.position.copy(_c).addScaledVector(_d, dist);
      app.controls.update();
      app.invalidate();
      if (commit) app.commit('inquadra');
    }
    return true;
  }

  // ------------------------------------------------------------------ Cambia ambiente
  /** Landscape presets by id, the active one and the recent ones (ids, newest first). */
  _catalog() {
    const L = this.app.landscapes;
    const list = L.presets || [];
    const byId = new Map(list.map((p) => [p.id, p]));
    const cur = L.current ? (L.current.resolved?.preset || L.current.spec?.preset || null) : null;
    let rec = [];
    try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); if (Array.isArray(v)) rec = v; } catch { /* private mode */ }
    const recent = [];
    for (const r of rec) {
      const id = typeof r === 'string' ? r : r?.p;
      if (id && byId.has(id) && !recent.includes(id)) recent.push(id);
    }
    return { L, list, byId, cur, recent };
  }

  /** Opens the environment menu at the button. */
  openEnvironments() {
    const L = this.app?.landscapes;
    if (typeof L?.generate !== 'function') { toast('Gli ambienti non sono disponibili', { kind: 'info' }); return null; }
    if (this.busy || L.busy) { toast('Sto ancora preparando l’ambiente…', { kind: 'info' }); return null; }
    const { byId, cur } = this._catalog();
    const r = this.envBtn.getBoundingClientRect();
    const W = window.innerWidth;
    // the card's right edge lines up with the button and it opens above it (kept in sight);
    // on short screens (phone in landscape) it opens beside the button column instead, wider
    // (three tiles per row) so that the whole menu fits the height without scrolling
    const beside = window.innerHeight < 560;
    const width = Math.min(beside ? 440 : this.shell.tablet ? 380 : 320, W - 16);
    const x = Math.max(8 + width / 2, Math.min(W - 8 - width / 2, beside ? r.left - 10 - width / 2 : r.right - width / 2));
    const y = beside ? r.top + r.height / 2 : r.top;
    this.root = h('div', { class: 'pv-env' });
    this.menu = stageMenu([], {
      x, y, width, title: 'Cambia ambiente',
      subtitle: `Ora: ${cur ? byId.get(cur)?.label || 'paesaggio' : 'studio vuoto'}`,
      body: this.root,
      onClose: () => { this.menu = null; this.root = null; },
    });
    this.menu.card.classList.add('pv-env-menu');
    this.menu.card.classList.toggle('pv-env-wide', width >= 400);
    this._renderMain();
    return this.menu;
  }

  _item({ label, ic, hint, checked, onClick, cls = '' }) {
    const b = h('button', { type: 'button', role: 'menuitem', class: `pv-menu-item pv-env-item ${checked ? 'checked' : ''} ${cls}`.trim() },
      ic ? icon(ic, 20) : h('span', { class: 'pv-menu-noicon' }),
      h('span', { class: 'pv-menu-label' }, label, hint ? h('small', {}, hint) : null),
      checked ? icon('check', 18) : null);
    b.addEventListener('click', (e) => { e.stopPropagation(); haptic('tick'); onClick(); });
    return b;
  }

  _tile(p, cur) {
    const on = p.id === cur;
    const b = h('button', { type: 'button', role: 'menuitem', class: 'pv-env-tile' + (on ? ' active' : ''), 'aria-pressed': on ? 'true' : 'false', title: p.label },
      icon(GROUP_ICON[p.group] || 'landscape', 18), h('span', {}, p.label));
    b.dataset.preset = p.id;
    b.addEventListener('click', (e) => { e.stopPropagation(); haptic('tick'); this._choose(p.id); });
    return b;
  }

  _renderMain() {
    const root = this.root;
    if (!root) return;
    const { list, byId, cur, recent } = this._catalog();
    const kids = [];
    const rec = recent.slice(0, MAX_RECENT);
    if (rec.length) {
      kids.push(h('div', { class: 'pv-menu-header' }, 'Recenti'),
        h('div', { class: 'pv-env-grid pv-env-recent' }, rec.map((id) => this._tile(byId.get(id), cur))));
    }
    kids.push(this._item({ label: 'Studio vuoto', ic: 'cube', hint: 'Nessun ambiente, solo lo studio', checked: !cur && !this.app.landscapes.current, onClick: () => this._choose(null) }));
    // rooms: most recent first, then catalog order
    const order = (ps) => [...ps].sort((a, b) => rank(a.id) - rank(b.id));
    const rank = (id) => { const i = recent.indexOf(id); return i < 0 ? 1000 + list.findIndex((p) => p.id === id) : i; };
    const rooms = order(list.filter((p) => p.group === ROOMS));
    if (rooms.length) kids.push(h('div', { class: 'pv-menu-header' }, 'Stanze'), h('div', { class: 'pv-env-grid' }, rooms.map((p) => this._tile(p, cur))));
    const groups = GROUPS.map((g) => ({ ...g, n: list.filter((p) => p.group === g.id).length })).filter((g) => g.n);
    // presets of groups this menu does not know (future ones) join "Altri"
    const known = new Set([ROOMS, ...GROUPS.map((g) => g.id)]);
    if (list.some((p) => !known.has(p.group))) groups.push({ id: '*', label: 'Altri', icon: 'landscape', n: list.filter((p) => !known.has(p.group)).length });
    if (groups.length) {
      kids.push(h('div', { class: 'pv-menu-header' }, 'Altri ambienti'),
        h('div', { class: 'pv-env-groups' }, groups.map((g) => {
          const has = cur && (byId.get(cur)?.group === g.id || (g.id === '*' && !known.has(byId.get(cur)?.group)));
          const b = h('button', { type: 'button', class: 'pv-env-group' + (has ? ' active' : ''), title: g.label },
            icon(g.icon, 20), h('span', {}, g.label), h('small', {}, `${g.n}`));
          b.dataset.group = g.id;
          b.addEventListener('click', (e) => { e.stopPropagation(); haptic('tick'); this._renderGroup(g); });
          return b;
        })));
    }
    root.replaceChildren(...kids);
    this._scrollTop();
  }

  /** The menu body scrolls (the title stays): back to its top after switching page. */
  _scrollTop() {
    const sc = this.menu?.body;
    if (sc) sc.scrollTop = 0;
  }

  _renderGroup(g) {
    const root = this.root;
    if (!root) return;
    const { list, cur, recent } = this._catalog();
    const known = new Set([ROOMS, ...GROUPS.map((x) => x.id)]);
    const ps = list.filter((p) => (g.id === '*' ? !known.has(p.group) : p.group === g.id));
    const rank = (id) => { const i = recent.indexOf(id); return i < 0 ? 1000 + list.findIndex((p) => p.id === id) : i; };
    ps.sort((a, b) => rank(a.id) - rank(b.id));
    root.replaceChildren(
      this._item({ label: 'Altri ambienti', ic: 'chevronLeft', cls: 'pv-env-back', onClick: () => this._renderMain() }),
      h('div', { class: 'pv-menu-header' }, g.label),
      h('div', { class: 'pv-env-grid' }, ps.map((p) => this._tile(p, cur))));
    this._scrollTop();
    // the card may now be shorter / taller: keep it on screen
    const card = this.menu?.card;
    if (card) requestAnimationFrame(() => {
      const rc = card.getBoundingClientRect(), H = window.innerHeight;
      if (rc.bottom > H - 8) card.style.top = Math.max(8, H - 8 - rc.height) + 'px';
    });
  }

  _choose(id) {
    this.menu?.close(id || 'studio');
    if (id) this.applyEnvironment(id); else this.clearEnvironment();
  }

  _setBusy(on) {
    this.busy = on;
    this.envBtn.classList.toggle('busy', on);
    this.envBtn.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  /** Generates landscape preset id around the characters (one undo step). -> Promise<boolean> */
  async applyEnvironment(id) {
    const app = this.app, L = app?.landscapes;
    if (typeof L?.generate !== 'function' || this.busy || L.busy) return false;
    const p = (L.presets || []).find((x) => x.id === id);
    const label = p?.label || 'ambiente';
    this._setBusy(true);
    const wait = toast(`Preparo «${label}»…`, { ms: 30000, icon: 'landscape' });
    try {
      const res = await L.generate({ preset: id });
      wait?._dismiss?.();
      if (res?.aborted) return false;
      haptic('success');
      toast(`Ambiente: ${label}`, { kind: 'ok', action: { label: 'Annulla', onClick: () => app.history?.undo?.() } });
      return true;
    } catch (e) {
      wait?._dismiss?.();
      console.error('[PosaViva] environment failed', e);
      toast('Impossibile preparare l’ambiente', { kind: 'error' });
      return false;
    } finally { this._setBusy(false); }
  }

  /** Back to the empty studio (one undo step when a landscape was shown). */
  clearEnvironment() {
    const app = this.app, L = app?.landscapes;
    if (!L) return false;
    if (!L.current) { toast('Sei già nello studio vuoto', { kind: 'info' }); return false; }
    L.clear();
    haptic('success');
    toast('Studio vuoto', { kind: 'ok', action: { label: 'Annulla', onClick: () => app.history?.undo?.() } });
    return true;
  }
}
