// App shell: top bar, bottom tool bar (portrait) / side rail (landscape),
// bottom sheet with snap points (portrait) / right side panel (landscape),
// viewport overlay and hint line. Modules register their tools:
//
//   shell.registerTool({ id, label, icon, group, order, title?, build(container, app) => ({ onShow?, onHide? }) })
//   shell.openTool(id) / shell.closePanel() / shell.hint(text, ms) / shell.overlay / shell.topLeft / shell.topRight
//
// Layout API (used by the io module to keep the 3D view centered in the
// uncovered area, and by anything that positions floating UI):
//   shell.mode                     'sheet' (portrait phone) | 'side' (landscape / wide / tablets)
//   shell.tier                     'phone' | 'tablet' (>= 700 px wide, both sides >= 600 px: portrait or
//                                  split screen) | 'tablet-wide' (landscape >= 1000 px); shell.tablet (bool)
//   shell.sheetSnap                'peek' | 'half' | 'full' (= Mini / Medio / Alto) or null when the user dragged the
//                                  sheet to a free height; shell.setSheetSnap(name)
//   shell.sheetHeight / shell.sheetRange() / shell.setSheetHeight(px, {live, persist, magnet})
//                                  portrait sheet height: any height between ~20 % and 70 % of the screen (drag the
//                                  grip or the header), snap points act as magnets; remembered (as a fraction)
//   shell.sideWidth / shell.sideWidths() / shell.setSideWidth(px | 'normal' | 'wide' | 'toggle')
//                                  tablets: side panel width 280-520 px (two presets + drag on the panel edge,
//                                  remembered per tier)
//   shell.cleanView / shell.setCleanView(on, {restore}) / shell.toggleCleanView()
//                                  "Vista pulita": only the 3D view (top bar, rail, panel and floating buttons hidden;
//                                  toasts, hints, dialogs and menus still show); a translucent button in the corner,
//                                  Android back / Esc and a two-finger double tap bring the UI back. 'cleanview' event
//                                  {on} on the shell and on the app. Floating UI of other modules: mark it with
//                                  data-pv-fab (hidden without room and in Vista pulita) or data-pv-chrome (Vista pulita).
//   shell.shortcuts                on-stage buttons above "Zoom rapido": Centra personaggi, Cambia ambiente (shortcuts.js)
//   shell.setDock(id, el | null)   tablets: a floating panel (e.g. the voice panel) docked in the side-panel slot
//                                  counts as covering the view; shell.viewCovered = tool panel or dock open
//   shell.getViewInsets()          {top, right, bottom, left} CSS px of the canvas covered by opaque UI
//   shell.addEventListener('layout', e => e.live)  fired on open/close/snap/drag/resize (live = while dragging)
//   app event 'uilayout' {insets, live}            same, on the app
// CSS vars on <html>: --cover-top/right/bottom/left (px), --pv-free-cx (center of the free area, px),
// --side-w (tablets: side panel width), --fab-l/--fab-r/--fab-b (px: where the floating buttons of the free
// view sit, cover + safe area + margin). Classes on #app and <html>: pv-tablet, pv-tablet-wide (tablet tiers),
// pv-clean (Vista pulita); #app[data-fabs] = 'col' | 'row' | 'none' (layout of the on-stage shortcut buttons).
// On tablets the sub-tools of the active group are listed in the rail under the group
// (the panel header then shows the tool title); without room they fall back to header chips.
import './tablet.css';
import { h, icon, iconButton, hasOpenLayer, closeTopLayer, haptic, toast, closeStageMenus } from './kit.js';
import { StageShortcuts } from './shortcuts.js';

/** Toolbar groups. A tool declares `group`; a group with several tools shows sub-tabs. */
export const TOOL_GROUPS = [
  { id: 'people', label: 'Personaggi', icon: 'people' },
  { id: 'pose', label: 'Posa', icon: 'pose' },
  { id: 'look', label: 'Aspetto', icon: 'shirt' },
  { id: 'scene', label: 'Scena', icon: 'sun' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
  { id: 'style', label: 'Stile', icon: 'palette' },
];

/** Portrait sheet snap points Mini / Medio, as fractions of the height above the toolbar; Alto = top of the range. */
const SNAPS = { peek: 0.31, half: 0.47 };
const SNAP_ORDER = ['peek', 'half', 'full'];
/** Italian names of the sheet snap points. */
export const SNAP_LABELS = { peek: 'Mini', half: 'Medio', full: 'Alto' };
/** Free sheet heights: fractions of the screen height (never under the top bar, never below SHEET_MIN_PX). */
const SHEET_MIN_FRAC = 0.2, SHEET_MAX_FRAC = 0.7, SHEET_MIN_PX = 150;
/** px: a height released this close to a snap point snaps to it (and the drag ticks when it gets there). */
const SNAP_MAGNET = 24;
const SNAP_KEY = 'posaviva.ui.sheet';
const SIDE_QUERY = '(orientation: landscape) and (min-width: 700px)';
/** Tablets (Galaxy Tab S6 / S9 / S9+ in either orientation, or a big split-screen window): side layout. */
const TABLET_QUERY = '(min-width: 700px) and (min-height: 600px)';
/** Wide tablets (landscape, 1280 x 800 and up): wider rail and panel. */
const TABLET_WIDE_QUERY = '(min-width: 1000px) and (min-height: 600px) and (orientation: landscape)';
/** Rail width per tier (CSS px): keep in sync with --rail-w in tablet.css. */
const RAIL_W = { tablet: 88, 'tablet-wide': 96 };
const SIDE_KEY = 'posaviva.ui.side';
/** Tablet side panel width range (CSS px); the view keeps at least SIDE_VIEW_MIN next to it. */
const SIDE_MIN = 280, SIDE_MAX = 520, SIDE_VIEW_MIN = 300;
/** Free view (CSS px) below which the floating buttons (mic, quick zoom) are hidden: two 48 px buttons + margins side by side, room above the sheet. */
const FAB_MIN_FREE_H = 230, FAB_MIN_FREE_W = 150;
/** Floating buttons: size, gap, margin from the free view's edge (CSS px). */
const FAB = 48, FAB_GAP = 10, FAB_MARGIN = 14;
/** Shortcut buttons stacked above the quick zoom button (column) or beside it (row). */
const SHORTCUTS = 2;
const CLEAN_TIP_KEY = 'posaviva.ui.cleanTip';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Shell extends EventTarget {
  constructor(app, root) {
    super();
    this._app = null;
    this.root = root;
    this.tools = [];
    this.active = null;
    this._lastInGroup = {};
    root.classList.add('pv-root');

    this.viewport = h('div', { class: 'pv-viewport' });
    this.overlay = h('div', { class: 'pv-overlay' });
    this.hintEl = h('div', { class: 'pv-hint', role: 'status' });
    this.topLeft = h('div', { class: 'pv-top-left' });
    this.topRight = h('div', { class: 'pv-top-right' });
    this.topBar = h('div', { class: 'pv-topbar' }, this.topLeft, this.topRight);
    this.panelTitle = h('div', { class: 'pv-panel-title' });
    this.panelBody = h('div', { class: 'pv-panel-body' });
    const closeBtn = iconButton({ icon: 'close', title: 'Chiudi', variant: 'ghost', onClick: () => { if (this._suppressClick) return; haptic('tick'); this.closePanel(); } });
    // grip of the portrait sheet: drag to any height (snap points Mini / Medio / Alto), tap cycles them;
    // the badge names the height while dragging
    this.sizeBadge = h('em', { class: 'pv-panel-size', 'aria-hidden': 'true' });
    this.handle = h('div', { class: 'pv-panel-handle', title: 'Trascina per cambiare l’altezza del pannello' }, h('span'), this.sizeBadge);
    // A group with several tools shows its sub-tabs in the header row, in place of
    // the title (the active tab names the tool): one row less above the content.
    this.subTabs = h('div', { class: 'pv-chips pv-subtabs', role: 'tablist' });
    this.subTabs.addEventListener('scroll', () => this._subTabsFade(), { passive: true });
    // a hairline under the header once the content scrolls beneath it
    this.panelBody.addEventListener('scroll', () => this.panel.classList.toggle('scrolled', this.panelBody.scrollTop > 2), { passive: true });
    // tablets: panel width (two presets; the left edge of the panel can also be dragged)
    this.widthBtn = iconButton({ icon: 'panelWide', title: 'Pannello più largo', variant: 'ghost', onClick: () => { if (this._suppressClick) return; haptic('tick'); this.setSideWidth('toggle'); } });
    this.widthBtn.classList.add('pv-panel-width');
    this.grip = h('div', { class: 'pv-panel-grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Larghezza del pannello', title: 'Trascina per allargare o restringere il pannello' }, h('span'));
    this.panelHead = h('div', { class: 'pv-panel-head' }, this.panelTitle, this.subTabs, this.widthBtn, closeBtn);
    this.panel = h('div', { class: 'pv-panel', role: 'region', 'aria-label': 'Strumenti' }, this.handle, this.grip, this.panelHead, this.panelBody);
    this.toolbar = h('nav', { class: 'pv-toolbar', 'aria-label': 'Strumenti' });
    // measures env(safe-area-inset-*) / the --safe-* vars injected by the Android shell
    this._probe = h('div', { class: 'pv-safe-probe', 'aria-hidden': 'true' });
    // "Vista pulita": button in the top bar (first in the right group; the io module appends its
    // buttons after it) and the translucent way back in the corner
    this._clean = false;
    this.cleanBtn = iconButton({ icon: 'cleanView', title: 'Vista pulita', onClick: () => { haptic('tick'); this.setCleanView(true); } });
    this.cleanBtn.classList.add('pv-clean-btn');
    this.topRight.append(this.cleanBtn);
    this.cleanExit = h('button', { type: 'button', class: 'pv-clean-exit', title: 'Mostra i comandi', 'aria-label': 'Mostra i comandi' }, icon('cleanExit', 22));
    this.cleanExit.addEventListener('click', (e) => { e.stopPropagation(); haptic('tick'); this.setCleanView(false); });
    root.append(this.viewport, this.overlay, this.topBar, this.hintEl, this.panel, this.toolbar, this.cleanExit, this._probe);

    this._mq = window.matchMedia(SIDE_QUERY);
    this._mqTab = window.matchMedia(TABLET_QUERY);
    this._mqWide = window.matchMedia(TABLET_WIDE_QUERY);
    // sheet height: a snap name, or a free height stored as a fraction of the screen height
    let snap = 'half';
    try { snap = localStorage.getItem(SNAP_KEY) || 'half'; } catch { /* private mode */ }
    this._sheetFrac = null;
    if (SNAP_ORDER.includes(snap)) this.sheetSnap = snap;
    else if (+snap > 0.05 && +snap < 0.95) { this.sheetSnap = null; this._sheetFrac = +snap; }
    else this.sheetSnap = 'half';
    this._sheetPx = 0; // current sheet height (px) in portrait
    this._insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this._sidePref = {}; // tier -> chosen side panel width (px)
    try { const s = JSON.parse(localStorage.getItem(SIDE_KEY) || '{}'); if (s && typeof s === 'object') this._sidePref = s; } catch { /* private mode */ }
    this._docks = new Map(); // id -> element docked in the side-panel slot (tablets)
    this._railSubsOk = true; // the rail has room for the sub-tool list (tablets)
    this._tier = null;

    this._applyTier();
    this._setupSheetDrag();
    this._setupSideResize();
    this._setupBack();
    this._setupCleanGestures();
    this._setupLayoutWatch();
    this._applySheetHeight();
    this._renderToolbar();
    // on-stage shortcut buttons (Centra personaggi, Cambia ambiente) above the quick zoom button
    this.shortcuts = new StageShortcuts(this);
    if (app) this.app = app;
  }

  /** The app (main.js attaches it after construction). */
  get app() { return this._app; }
  set app(a) {
    this._app = a || null;
    if (a) this.shortcuts?.attach(a);
  }

  /** The element that should host the WebGL canvas. */
  get canvasHost() { return this.viewport; }

  /** 'sheet' (portrait phone: bottom toolbar + bottom sheet) or 'side' (landscape, tablets: left rail + right panel). */
  get mode() { return this._mqTab.matches || this._mq.matches ? 'side' : 'sheet'; }

  /** 'phone' | 'tablet' (portrait or split screen, >= 700 px wide) | 'tablet-wide' (landscape >= 1000 px). */
  get tier() { return this._mqWide.matches ? 'tablet-wide' : this._mqTab.matches ? 'tablet' : 'phone'; }

  get tablet() { return this.tier !== 'phone'; }

  get panelOpen() { return !!this.active; }

  /** True while a tool panel, or (tablets) a docked panel such as the voice commands, covers part of the view. */
  get viewCovered() { return !this._clean && (!!this.active || this._dockOpen()); }

  _dockOpen() { return this.tablet && this._docks.size > 0; }

  /**
   * Tablets: docks a floating panel (e.g. the voice commands) in the side-panel slot, so that
   * the view insets, the top bar and the 3D framing make room for it. el = null undocks.
   * On phones it is recorded but has no effect on the layout.
   */
  setDock(id, el) {
    // a panel that opens (voice commands…) brings the interface back
    if (el && this._clean) this.setCleanView(false, { restore: false });
    const had = this._dockOpen();
    if (el) this._docks.set(id, el); else this._docks.delete(id);
    this.root.classList.toggle('pv-docked', this._docks.size > 0);
    if (had || this._dockOpen()) this._emitLayout(false);
  }

  // ------------------------------------------------------------ tablets: side panel width
  /** Side panel widths at the current window size (CSS px): {normal, wide, min, max}. */
  sideWidths() {
    const W = this.root.clientWidth || window.innerWidth;
    const tier = this.tier;
    const safe = this.safeInsets();
    const free = W - (RAIL_W[tier] || 84) - safe.left - safe.right;
    // 280-520 px, and the view keeps at least 300 px next to the panel
    const max = Math.max(SIDE_MIN, Math.min(SIDE_MAX, free - SIDE_VIEW_MIN));
    const normal = tier === 'tablet-wide' ? clamp(Math.round(W * 0.3125), 380, 440) : clamp(Math.round(W * 0.44), 320, 360);
    const wide = tier === 'tablet-wide' ? SIDE_MAX : 440;
    return { normal: Math.min(normal, max), wide: Math.min(wide, max), min: SIDE_MIN, max };
  }

  /** Current side panel width (CSS px) on tablets; null on phones (CSS default). */
  get sideWidth() {
    if (!this.tablet) return null;
    const ws = this.sideWidths();
    const p = this._liveSideW ?? this._sidePref[this.tier];
    return Math.round(clamp(typeof p === 'number' ? p : ws.normal, ws.min, ws.max));
  }

  /** True when the side panel is closer to the wide preset than to the normal one. */
  get sideIsWide() {
    const w = this.sideWidth, ws = this.sideWidths();
    return w != null && ws.wide > ws.normal && w > (ws.normal + ws.wide) / 2;
  }

  /**
   * Tablets: sets the side panel width. w = px | 'normal' | 'wide' | 'toggle'.
   * opts.live: while dragging (not remembered); opts.persist (default true).
   */
  setSideWidth(w, { live = false, persist = true } = {}) {
    if (!this.tablet) return;
    const ws = this.sideWidths();
    if (w === 'toggle') w = this.sideIsWide ? 'normal' : 'wide';
    const px = Math.round(clamp(w === 'wide' ? ws.wide : w === 'normal' ? ws.normal : +w || ws.normal, ws.min, ws.max));
    if (live) this._liveSideW = px;
    else {
      this._liveSideW = null;
      this._sidePref[this.tier] = px;
      if (persist) { try { localStorage.setItem(SIDE_KEY, JSON.stringify(this._sidePref)); } catch { /* ignore */ } }
    }
    this._applySideWidth();
    this._fitSubTabs();
    this._emitLayout(live);
  }

  _applySideWidth() {
    const ds = document.documentElement.style;
    const w = this.sideWidth;
    if (w == null) { ds.removeProperty('--side-w'); return; }
    ds.setProperty('--side-w', w + 'px');
    // a window too narrow for two distinct widths: no width button (the edge still drags)
    const ws = this.sideWidths();
    this.widthBtn.classList.toggle('off', ws.wide - ws.normal < 24);
    const wide = this.sideIsWide;
    if (this._widthBtnWide !== wide) {
      this._widthBtnWide = wide;
      this.widthBtn.setIcon(wide ? 'panelNarrow' : 'panelWide');
      this.widthBtn.title = wide ? 'Pannello più stretto' : 'Pannello più largo';
      this.widthBtn.setAttribute('aria-label', this.widthBtn.title);
    }
  }

  /** Tier classes on #app and <html> (body-level layers such as dialogs and the voice panel read them). */
  _applyTier() {
    const tier = this.tier;
    const changed = tier !== this._tier;
    this._tier = tier;
    for (const el of [this.root, document.documentElement]) {
      el.classList.toggle('pv-tablet', tier !== 'phone');
      el.classList.toggle('pv-tablet-wide', tier === 'tablet-wide');
    }
    this.root.classList.toggle('pv-side', this.mode === 'side');
    this._applySideWidth();
    return changed;
  }

  /** Drag the left edge of the side panel (tablets) to resize it; a double tap toggles the two presets. */
  _setupSideResize() {
    let d = null, lastTap = 0;
    const g = this.grip;
    g.addEventListener('pointerdown', (e) => {
      if (!this.tablet || this.mode !== 'side' || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      e.stopPropagation();
      d = { id: e.pointerId, x0: e.clientX, w0: this.sideWidth, moved: false };
      try { g.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.panel.classList.add('resizing');
    });
    g.addEventListener('pointermove', (e) => {
      if (!d || e.pointerId !== d.id) return;
      const dx = d.x0 - e.clientX;
      if (!d.moved && Math.abs(dx) < 4) return;
      d.moved = true;
      this.setSideWidth(d.w0 + dx, { live: true });
      // a tick when the edge reaches a preset width or a limit (it snaps there on release)
      const ws = this.sideWidths(), w = this._liveSideW;
      const near = Math.abs(w - ws.normal) < 18 ? 'normal' : Math.abs(w - ws.wide) < 18 ? 'wide' : w <= ws.min ? 'min' : w >= ws.max ? 'max' : '';
      if (near !== (d.near || '')) { if (near) haptic('tick'); d.near = near; this.panel.dataset.near = near; }
    });
    const end = (e) => {
      if (!d || e.pointerId !== d.id) return;
      const dd = d; d = null;
      this.panel.classList.remove('resizing');
      delete this.panel.dataset.near;
      try { g.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (dd.moved) {
        // close to a preset: snap to it
        const ws = this.sideWidths(), w = this._liveSideW ?? this.sideWidth;
        const snap = Math.abs(w - ws.normal) < 18 ? 'normal' : Math.abs(w - ws.wide) < 18 ? 'wide' : w;
        haptic('tick');
        this.setSideWidth(snap);
        return;
      }
      if (e.type !== 'pointerup') return;
      const now = performance.now();
      if (now - lastTap < 350) { lastTap = 0; haptic('tick'); this.setSideWidth('toggle'); } else lastTap = now;
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
  }

  registerTool(tool) {
    tool.order ??= this.tools.length * 10;
    this.tools.push(tool);
    this.tools.sort((a, b) => a.order - b.order);
    this._renderToolbar();
    return tool;
  }

  _groupOf(t) { return t.group || t.id; }

  _groups() {
    const groups = [];
    for (const g of TOOL_GROUPS) { const tools = this.tools.filter((t) => this._groupOf(t) === g.id); if (tools.length) groups.push({ ...g, tools }); }
    for (const t of this.tools) if (!TOOL_GROUPS.some((g) => g.id === this._groupOf(t)) && !groups.some((g) => g.id === this._groupOf(t))) {
      groups.push({ id: this._groupOf(t), label: t.label, icon: t.icon, tools: this.tools.filter((x) => this._groupOf(x) === this._groupOf(t)) });
    }
    return groups;
  }

  _renderToolbar() {
    const groups = this._groups();
    const activeGroup = this.active ? this._groupOf(this.active.tool) : null;
    const ag = groups.find((g) => g.id === activeGroup);
    // tablets: the sub-tools of the active group are listed in the rail, under the group
    const railSubs = this.tablet && this.mode === 'side' && this._railSubsOk && !!ag && ag.tools.length > 1;
    this.toolbar.replaceChildren();
    this.toolbar.style.setProperty('--n', groups.length);
    this.toolbar.classList.toggle('has-subs', railSubs);
    for (const g of groups) {
      const on = activeGroup === g.id;
      const b = h('button', { type: 'button', class: 'pv-tool' + (on ? ' active' : ''), 'aria-pressed': on ? 'true' : 'false', title: g.label },
        h('span', { class: 'pv-tool-pill' }, icon(g.icon, 22)), h('span', { class: 'pv-tool-label' }, g.label));
      b.dataset.group = g.id;
      b.addEventListener('click', () => {
        haptic('tick');
        if (this._groupOf(this.active?.tool || {}) === g.id) return this.closePanel();
        const last = g.tools.find((t) => t.id === this._lastInGroup[g.id]) || g.tools[0];
        this.openTool(last.id);
      });
      this.toolbar.appendChild(b);
      if (railSubs && on) {
        // the list slides in when the group opens, not on every switch between its tools
        const list = h('div', { class: 'pv-rail-subs' + (this._railGroup !== g.id ? ' enter' : ''), role: 'tablist', 'aria-label': g.label });
        for (const t of ag.tools) {
          const sel = this.active.tool === t;
          const s = h('button', { type: 'button', role: 'tab', class: 'pv-rail-sub' + (sel ? ' active' : ''), 'aria-selected': sel ? 'true' : 'false', title: t.title || t.label },
            icon(t.icon, 18), h('span', { class: 'pv-rail-sub-label' }, t.label));
          s.dataset.tool = t.id;
          s.addEventListener('click', () => { haptic('tick'); this.openTool(t.id); });
          list.appendChild(s);
        }
        this.toolbar.appendChild(list);
      }
    }
    this._railGroup = railSubs ? activeGroup : null;
    if (railSubs) {
      // no room in the rail (short window, split screen): header chips instead
      requestAnimationFrame(() => {
        if (!this.toolbar.classList.contains('has-subs')) return;
        if (this.toolbar.scrollHeight > this.toolbar.clientHeight + 1) { this._railSubsOk = false; this._renderToolbar(); }
      });
    }
    // sub-tabs for the active group (in the header row, replacing the title)
    this.subTabs.replaceChildren();
    const show = !!ag && ag.tools.length > 1 && !railSubs;
    this.subTabs.style.display = show ? '' : 'none';
    this.panelTitle.style.display = show ? 'none' : '';
    this.panelHead.classList.toggle('tabs', show);
    if (show) {
      for (const t of ag.tools) {
        const on = this.active.tool === t;
        const c = h('button', { type: 'button', role: 'tab', class: 'pv-chip' + (on ? ' active' : ''), 'aria-selected': on ? 'true' : 'false', title: t.title || t.label }, icon(t.icon, 18), t.label);
        c.addEventListener('click', () => { if (this._suppressClick) return; haptic('tick'); this.openTool(t.id); });
        this.subTabs.appendChild(c);
        // horizontal scroll only (scrollIntoView could also scroll overflow-hidden ancestors)
        if (on) requestAnimationFrame(() => {
          this._fitSubTabs();
          const st = this.subTabs, l = c.offsetLeft - st.offsetLeft, r = l + c.offsetWidth;
          if (l < st.scrollLeft + 8) st.scrollLeft = l - 24;
          else if (r > st.scrollLeft + st.clientWidth - 8) st.scrollLeft = r - st.clientWidth + 24;
          this._subTabsFade();
        });
      }
    }
  }

  /**
   * Makes the sub-tabs fit the header row: first without icons ('compact'), then with
   * tighter labels ('tight', e.g. the five Scena tabs on a 412 px phone), then with
   * the least padding that keeps them readable ('tighter', e.g. the same tabs in the
   * 374-380 px landscape side panel); if they still do not fit the row scrolls, with
   * faded edges where more tabs are hidden. The font size never drops below 13 px.
   */
  _fitSubTabs() {
    const st = this.subTabs;
    if (st.style.display === 'none') return;
    st.classList.remove('compact', 'tight', 'tighter');
    for (const level of ['compact', 'tight', 'tighter']) {
      if (st.scrollWidth <= st.clientWidth + 1) break;
      st.classList.add(level);
    }
    this._subTabsFade();
  }

  /** Fades the edge of the sub-tab row where more tabs are hidden. */
  _subTabsFade() {
    const st = this.subTabs;
    st.classList.toggle('more-l', st.scrollLeft > 2);
    st.classList.toggle('more-r', st.scrollLeft + st.clientWidth < st.scrollWidth - 2);
  }

  openTool(id) {
    const tool = this.tools.find((t) => t.id === id);
    if (!tool) return;
    // a tool opened from code (a stage menu action, a voice command…) brings the interface back
    if (this._clean) this.setCleanView(false, { restore: false });
    if (this.active?.tool === tool) return;
    const wasOpen = !!this.active;
    this.active?.ctrl?.onHide?.();
    tool._container ||= h('div', { class: 'pv-tool-content' });
    if (!tool._built) {
      try { tool._ctrl = tool.build(tool._container, this.app) || {}; }
      catch (e) { console.error(`[PosaViva] tool ${id} build failed`, e); tool._ctrl = {}; }
      tool._built = true;
    }
    this.panelBody.replaceChildren(tool._container);
    this.panelBody.scrollTop = 0;
    this.panel.classList.remove('scrolled');
    tool._container.classList.remove('pv-enter');
    void tool._container.offsetWidth; // restart the enter animation
    tool._container.classList.add('pv-enter');
    this.panelTitle.textContent = tool.title || tool.label;
    this.panel.setAttribute('aria-label', tool.title || tool.label);
    this.active = { tool, ctrl: tool._ctrl };
    this._lastInGroup[this._groupOf(tool)] = tool.id;
    this.root.classList.add('panel-open');
    this.panel.classList.remove('collapsed');
    try { tool._ctrl.onShow?.(); } catch (e) { console.error(`[PosaViva] tool ${id} onShow failed`, e); }
    this._renderToolbar();
    this.app?.dispatchEvent({ type: 'tool', id });
    if (!wasOpen) this._emitLayout(false);
  }

  closePanel() {
    if (!this.active) return;
    try { this.active.ctrl?.onHide?.(); } catch (e) { console.error('[PosaViva] onHide failed', e); }
    this.active = null;
    this.root.classList.remove('panel-open');
    this._renderToolbar();
    this.app?.dispatchEvent({ type: 'tool', id: null });
    this._emitLayout(false);
  }

  get activeToolId() { return this.active?.tool.id || null; }

  /** One-line hint below the top bar. ms = 0 keeps it until hint('') */
  hint(text, ms = 0) {
    if (text) this.hintEl.textContent = text;
    this.hintEl.classList.toggle('show', !!text);
    clearTimeout(this._hintT);
    if (text && ms) this._hintT = setTimeout(() => this.hint(''), ms);
  }

  // ------------------------------------------------------------ layout
  /** Safe-area insets in px (env() or the vars injected by the Android shell). */
  safeInsets() {
    const cs = getComputedStyle(this._probe);
    return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
  }

  /**
   * Portrait sheet heights (px) at the current window size: the free range {min, max}
   * (~20 % .. 70 % of the screen, never under the top bar) and the snap points
   * peek / half / full (Mini / Medio / Alto; Alto = max).
   */
  sheetRange() {
    const H = this.root.clientHeight || window.innerHeight;
    const tb = this.toolbar.offsetHeight || 64;
    const avail = Math.max(200, H - tb);
    const topReserve = this.topBar.offsetTop + this.topBar.offsetHeight + 6;
    const room = Math.max(SHEET_MIN_PX + 60, H - tb - topReserve);
    const max = Math.round(Math.min(room, Math.max(SHEET_MIN_PX + 60, H * SHEET_MAX_FRAC)));
    const min = Math.round(Math.min(max - 60, Math.max(SHEET_MIN_PX, H * SHEET_MIN_FRAC)));
    return {
      min, max,
      peek: Math.round(clamp(Math.max(210, avail * SNAPS.peek), min, max)),
      half: Math.round(clamp(Math.max(300, avail * SNAPS.half), min, max)),
      full: max,
    };
  }

  /** Sheet heights (px) for each snap point at the current window size. */
  snapHeights() {
    const r = this.sheetRange();
    return { peek: r.peek, half: r.half, full: r.full };
  }

  /** Current portrait sheet height (CSS px; the target height while it animates). */
  get sheetHeight() { return this._sheetPx; }

  setSheetSnap(name, { persist = true } = {}) {
    if (!SNAP_ORDER.includes(name)) return;
    this.sheetSnap = name;
    this._sheetFrac = null;
    if (persist) { try { localStorage.setItem(SNAP_KEY, name); } catch { /* ignore */ } }
    this._applySheetHeight();
    this._emitLayout(false);
  }

  /**
   * Portrait sheet height in px, clamped to sheetRange(). live: while dragging (not
   * remembered, no snapping); otherwise a height within the magnet distance of a snap
   * point becomes that snap point, any other height is remembered as a fraction of the
   * screen height (so it survives rotations and window resizes).
   */
  setSheetHeight(px, { live = false, persist = true, magnet = true } = {}) {
    const r = this.sheetRange();
    const v = Math.round(clamp(+px || r.half, r.min, r.max));
    if (live) {
      this._applySheetHeight(v);
      this._emitLayout(true);
      return;
    }
    const near = magnet ? this._nearSnap(v, r) : null;
    if (near) { this.setSheetSnap(near, { persist }); return; }
    const H = this.root.clientHeight || window.innerHeight;
    this.sheetSnap = null;
    this._sheetFrac = v / H;
    if (persist) { try { localStorage.setItem(SNAP_KEY, this._sheetFrac.toFixed(4)); } catch { /* ignore */ } }
    this._applySheetHeight();
    this._emitLayout(false);
  }

  /** The snap point within `within` px of height px (closest first), or null. */
  _nearSnap(px, r = this.sheetRange(), within = SNAP_MAGNET) {
    let best = null, bd = within;
    for (const s of SNAP_ORDER) { const d = Math.abs(r[s] - px); if (d <= bd) { bd = d; best = s; } }
    return best;
  }

  /** Target sheet height (px) of the remembered snap point or free height. */
  _sheetTarget() {
    const r = this.sheetRange();
    if (this.sheetSnap) return r[this.sheetSnap];
    const H = this.root.clientHeight || window.innerHeight;
    return Math.round(clamp((this._sheetFrac ?? 0.45) * H, r.min, r.max));
  }

  _applySheetHeight(px) {
    this._sheetPx = px ?? this._sheetTarget();
    this.panel.style.setProperty('--sheet-h', this._sheetPx + 'px');
    this.panel.dataset.snap = px === undefined ? this.sheetSnap || 'free' : '';
  }

  // ------------------------------------------------------------ Vista pulita
  /** True while only the 3D view is shown (top bar, rail, panel and floating buttons hidden). */
  get cleanView() { return this._clean; }

  toggleCleanView() { this.setCleanView(!this._clean); }

  /**
   * "Vista pulita". on: remembers the open tool and closes it, closes a docked panel (voice),
   * hides the interface. off: shows it again and, with restore (default), reopens the tool.
   * Captures are unaffected (they never include the DOM). Fires 'cleanview' {on}.
   */
  setCleanView(on, { restore = true } = {}) {
    on = !!on;
    if (on === this._clean) return;
    const app = this.app;
    if (on) {
      this._cleanTool = this.activeToolId;
      if (this._docks.size) { try { app?.voice?.close?.(); } catch (e) { console.warn('[PosaViva] voice close failed', e); } }
      this._clean = true;
      if (this.active) this.closePanel();
      // context menus on the stage (hand, character, object, light) belong to the interface
      closeStageMenus();
      for (const el of [this.root, document.documentElement]) el.classList.add('pv-clean');
      this.cleanBtn.setAttribute('aria-pressed', 'true');
      this._cleanWake();
      let seen = false;
      try { seen = localStorage.getItem(CLEAN_TIP_KEY) === '1'; localStorage.setItem(CLEAN_TIP_KEY, '1'); } catch { /* private mode */ }
      if (!seen) toast('Vista pulita: tocca il pulsante in alto a destra, Indietro o due dita due volte per tornare', { ms: 4200, icon: 'cleanView' });
    } else {
      this._clean = false;
      for (const el of [this.root, document.documentElement]) el.classList.remove('pv-clean');
      this.cleanBtn.setAttribute('aria-pressed', 'false');
      clearTimeout(this._cleanDimT);
      this.cleanExit.classList.remove('dim');
      const id = restore ? this._cleanTool : null;
      this._cleanTool = null;
      if (id && !this.active) this.openTool(id);
    }
    this._emitLayout(false);
    const ev = new Event('cleanview');
    ev.on = on;
    this.dispatchEvent(ev);
    app?.dispatchEvent({ type: 'cleanview', on });
    app?.invalidate?.();
  }

  /** The way-back button is bright for a moment, then dims (any touch wakes it). */
  _cleanWake() {
    this.cleanExit.classList.remove('dim');
    clearTimeout(this._cleanDimT);
    this._cleanDimT = setTimeout(() => { if (this._clean) this.cleanExit.classList.add('dim'); }, 2600);
  }

  /** Two-finger double tap anywhere restores the interface while in Vista pulita (and wakes the button). */
  _setupCleanGestures() {
    const pts = new Map();
    let cand = null, lastTwo = -Infinity;
    const opts = { capture: true, passive: true };
    window.addEventListener('pointerdown', (e) => {
      if (!this._clean) return;
      this._cleanWake();
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) cand = { t0: e.timeStamp, ok: true, n: 1 };
      else if (cand) {
        cand.n = Math.max(cand.n, pts.size);
        // two fingers landing together; a third finger is something else
        if (pts.size > 2 || e.timeStamp - cand.t0 > 200) cand.ok = false;
      }
    }, opts);
    window.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (p && cand && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 24) cand.ok = false;
    }, opts);
    const up = (e) => {
      if (!pts.delete(e.pointerId) || pts.size || !cand) return;
      const c = cand; cand = null;
      if (!this._clean || !c.ok || c.n !== 2 || e.type === 'pointercancel' || e.timeStamp - c.t0 > 380) return;
      if (e.timeStamp - lastTwo < 520) { lastTwo = -Infinity; haptic('tick'); this.setCleanView(false); }
      else lastTwo = e.timeStamp;
    };
    window.addEventListener('pointerup', up, opts);
    window.addEventListener('pointercancel', up, opts);
  }

  /** CSS px of the canvas hidden by opaque UI in the current (target) state. */
  getViewInsets() {
    const r = this.root.getBoundingClientRect();
    const ins = { top: 0, right: 0, bottom: 0, left: 0 };
    if (this._clean) return ins;
    if (this.mode === 'side') {
      ins.left = this.toolbar.getBoundingClientRect().right - r.left;
      // tablets: the target width (the panel may still be animating to it after a rotation or a resize)
      const sideW = this.tablet ? this.sideWidth + this.safeInsets().right : 0;
      if (this.active) {
        ins.right = sideW || this.panel.offsetWidth;
        ins.top = this.topBar.offsetTop + this.topBar.offsetHeight;
      } else if (this._dockOpen()) {
        ins.right = sideW;
        ins.top = this.topBar.offsetTop + this.topBar.offsetHeight;
      }
    } else {
      ins.bottom = this.toolbar.offsetHeight;
      if (this.active) {
        ins.bottom += this._sheetPx;
        ins.top = this.topBar.offsetTop + this.topBar.offsetHeight;
      }
    }
    return ins;
  }

  _emitLayout(live) {
    // every layout read first, then the writes (one style recalc for the listeners instead
    // of one per read: this runs on every frame of a panel drag)
    const ins = this.getViewInsets();
    this._insets = ins;
    const W = this.root.clientWidth || window.innerWidth, H = this.root.clientHeight || window.innerHeight;
    const safe = this.safeInsets();
    const topBarBottom = this.topBar.offsetTop + this.topBar.offsetHeight;
    const tb = this.mode === 'sheet' && !this._clean ? this.toolbar.offsetHeight : safe.bottom;
    // toasts sit just above the sheet; when the sheet leaves no room for them (full
    // height) they float over its lower edge instead of covering the top bar
    const roomy = H - ins.bottom - topBarBottom >= 120;
    // Floating buttons of the free view (voice mic bottom-left, quick zoom bottom-right):
    // when a (nearly) full-height sheet, or a very narrow free view, leaves no room for
    // them they are hidden (styles.css) instead of sliding under the top bar or each other.
    const freeH = H - ins.top - ins.bottom, freeW = W - ins.left - ins.right;
    // where they sit: the edge of the free view, at least the safe area (cutouts, gesture bar), + margin
    const fabL = Math.round(Math.max(ins.left, safe.left) + FAB_MARGIN);
    const fabR = Math.round(Math.max(ins.right, safe.right) + FAB_MARGIN);
    const fabB = Math.round(Math.max(ins.bottom, safe.bottom) + FAB_MARGIN);
    // on-stage shortcuts: a column above the quick zoom button when it stays clear of the top
    // bar, else a row to its left when it stays clear of the mic, else hidden
    const span = SHORTCUTS * (FAB + FAB_GAP);
    const colTop = H - fabB - FAB - span;
    const rowLeft = W - fabR - FAB - span;
    const fabs = colTop >= Math.max(topBarBottom, ins.top) + 8 ? 'col' : rowLeft >= fabL + FAB + 12 ? 'row' : 'none';
    // writes (only the values that changed)
    this._setVar('--cover-top', ins.top + 'px');
    this._setVar('--cover-right', ins.right + 'px');
    this._setVar('--cover-bottom', ins.bottom + 'px');
    this._setVar('--cover-left', ins.left + 'px');
    this._setVar('--pv-free-cx', Math.round(ins.left + freeW / 2) + 'px');
    this._setVar('--pv-toast-bottom', Math.round((roomy ? Math.max(ins.bottom, tb) : tb) + 14) + 'px');
    this._setVar('--fab-l', fabL + 'px');
    this._setVar('--fab-r', fabR + 'px');
    this._setVar('--fab-b', fabB + 'px');
    this.root.classList.toggle('pv-view-short', freeH < FAB_MIN_FREE_H || freeW < FAB_MIN_FREE_W);
    if (this.root.dataset.fabs !== fabs) this.root.dataset.fabs = fabs;
    const ev = new Event('layout');
    ev.live = live; ev.insets = ins;
    this.dispatchEvent(ev);
    this.app?.dispatchEvent({ type: 'uilayout', insets: ins, live });
  }

  /** Sets a CSS variable on <html> when its value changed (no style invalidation otherwise). */
  _setVar(name, v) {
    const c = (this._vars ||= new Map());
    if (c.get(name) === v) return;
    c.set(name, v);
    document.documentElement.style.setProperty(name, v);
  }

  _setupLayoutWatch() {
    let raf = 0, lastH = 0;
    const relayout = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const tierChanged = this._applyTier();
        // rotation / split screen: try the rail sub-tool list again
        const H = this.root.clientHeight;
        if (tierChanged || H !== lastH) { lastH = H; this._railSubsOk = true; this._renderToolbar(); }
        this._applySheetHeight(); this._fitSubTabs(); this._emitLayout(false);
      });
    };
    this.root.classList.toggle('pv-side', this.mode === 'side');
    lastH = this.root.clientHeight;
    this._mq.addEventListener?.('change', relayout);
    this._mqTab.addEventListener?.('change', relayout);
    this._mqWide.addEventListener?.('change', relayout);
    window.addEventListener('resize', relayout);
    new ResizeObserver(relayout).observe(this.root);
    // the Android shell reports system bar / cutout insets here
    const prev = window.__onInsets;
    window.__onInsets = (i) => { try { prev?.(i); } finally { relayout(); } };
    // first emission once the app is attached (main.js sets shell.app after construction)
    requestAnimationFrame(() => this._emitLayout(false));
  }

  // ------------------------------------------------------------ sheet drag (portrait)
  _setupSheetDrag() {
    let drag = null;
    let raf = 0;
    const samples = [];
    // The grip and the whole header row drag the sheet, sub-tabs and the close
    // button included: a tap still activates them, a vertical drag moves the sheet
    // (the pointer is captured only once the drag starts, so taps keep their target),
    // a horizontal drag scrolls the sub-tabs.
    const start = (e) => {
      if (this.mode !== 'sheet' || !this.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, h0: this._sheetPx, moved: false, el: e.currentTarget, range: this.sheetRange(), near: null };
      samples.length = 0;
      samples.push([e.clientY, e.timeStamp]);
      if (drag.el === this.handle) drag.el.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y0, dx = e.clientX - drag.x0;
      if (!drag.moved) {
        if (Math.abs(dy) < 6 || Math.abs(dy) < Math.abs(dx)) {
          if (Math.abs(dx) > 10 && drag.el !== this.handle) drag = null; // horizontal: sub-tab scroll
          return;
        }
        drag.moved = true;
        this.panel.classList.add('dragging');
        try { drag.el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      }
      const r = drag.range;
      let nh = drag.h0 - dy;
      // rubber band above the top of the range; below the bottom it follows more slowly
      // (pulled well below it, the release closes the panel)
      if (nh > r.max) nh = r.max + (nh - r.max) * 0.25;
      if (nh < r.min) nh = r.min - (r.min - nh) * 0.5;
      nh = Math.round(nh);
      this._applySheetHeight(nh);
      // the snap points are magnets: a tick when the edge reaches one, and the badge names it
      const near = this._nearSnap(nh, r);
      if (near !== drag.near) { if (near) haptic('tick'); drag.near = near; }
      this._sheetBadge(nh, near, r);
      samples.push([e.clientY, e.timeStamp]);
      if (samples.length > 6) samples.shift();
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; this._emitLayout(true); });
    };
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      this.panel.classList.remove('dragging');
      this._sheetBadge(null);
      if (d.moved) {
        // the click that may follow a drag must not activate a tab or close the panel
        this._suppressClick = true;
        setTimeout(() => { this._suppressClick = false; }, 0);
      }
      if (!d.moved) {
        // tap on the grip: next snap point up (Mini -> Medio -> Alto -> Mini)
        if (d.el === this.handle && e.type === 'pointerup') { haptic('tick'); this.setSheetSnap(this._nextSnapUp()); }
        return;
      }
      // velocity (px/ms, positive = finger moving down)
      // (a finger that stopped before lifting placed the sheet: no flick)
      let v = 0;
      if (samples.length > 1) { const a = samples[0], b = samples[samples.length - 1]; v = e.timeStamp - b[1] > 120 ? 0 : (b[0] - a[0]) / Math.max(1, b[1] - a[1]); }
      const r = this.sheetRange();
      const cur = this._sheetPx;
      const close = () => { this._applySheetHeight(); this.closePanel(); };
      // pulled well below the smallest height: close
      if (cur < r.min - 36) { close(); return; }
      if (Math.abs(v) > 0.6) {
        // a flick goes on to the next snap point in its direction; down past Mini closes
        const order = SNAP_ORDER.map((s) => [s, r[s]]);
        if (v > 0) {
          const below = order.filter(([, hpx]) => hpx < cur - 8).pop();
          if (!below) { if (v > 1 || cur < r.peek - 8) { close(); return; } }
          haptic('tick');
          this.setSheetSnap(below ? below[0] : 'peek');
        } else {
          const above = order.find(([, hpx]) => hpx > cur + 8);
          haptic('tick');
          this.setSheetSnap(above ? above[0] : 'full');
        }
        return;
      }
      // released: the sheet stays at that height (a snap point when close to one)
      this.setSheetHeight(cur);
    };
    for (const el of [this.handle, this.panelHead]) {
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
  }

  /** The first snap point above the current height (Alto -> Mini). */
  _nextSnapUp() {
    if (this.sheetSnap) return SNAP_ORDER[(SNAP_ORDER.indexOf(this.sheetSnap) + 1) % SNAP_ORDER.length];
    const r = this.sheetRange();
    return SNAP_ORDER.find((s) => r[s] > this._sheetPx + 8) || 'peek';
  }

  /** Badge on the grip while dragging: the snap point's name, or the share of the screen. null hides it. */
  _sheetBadge(px, near = null, r = null) {
    const b = this.sizeBadge;
    if (px == null) { b.classList.remove('show'); this.panel.removeAttribute('data-near'); return; }
    const H = this.root.clientHeight || window.innerHeight;
    const clampedPx = r ? clamp(px, r.min, r.max) : px;
    const txt = near ? SNAP_LABELS[near] : `${Math.round((clampedPx / H) * 100)}%`;
    if (b.textContent !== txt) b.textContent = txt;
    b.classList.add('show');
    if ((this.panel.dataset.near || '') !== (near || '')) this.panel.dataset.near = near || '';
  }

  // ------------------------------------------------------------ back button
  _setupBack() {
    // Android back: dialogs/menus first, then temporary modes, then the panel. With
    // nothing left to close, a first back only warns and a second one within 2 s
    // exits (false lets the Android shell finish the activity).
    const back = () => {
      if (hasOpenLayer()) { closeTopLayer(); return true; }
      // Vista pulita: back brings the interface back first
      if (this._clean) { this.setCleanView(false); return true; }
      const bh = this.app?._backHandlers;
      if (bh?.length) { const fn = bh[bh.length - 1]; if (fn() !== false) return true; }
      if (this.active) { this.closePanel(); return true; }
      return false;
    };
    let armed = -Infinity;
    window.__onAndroidBack = () => {
      if (back()) { armed = -Infinity; return true; }
      const now = performance.now();
      if (now - armed < 2000) return false;
      armed = now;
      haptic('tick');
      toast('Premi di nuovo Indietro per uscire', { ms: 2000 });
      return true;
    };
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (back()) e.preventDefault();
    });
  }
}
