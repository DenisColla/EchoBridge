// App shell: top bar, bottom tool bar (portrait) / side rail (landscape),
// bottom sheet with snap points (portrait) / right side panel (landscape),
// viewport overlay and hint line. Modules register their tools:
//
//   shell.registerTool({ id, label, icon, group, order, title?, build(container, app) => ({ onShow?, onHide? }) })
//   shell.openTool(id) / shell.closePanel() / shell.hint(text, ms) / shell.overlay / shell.topLeft / shell.topRight
//
// Layout API (used by the io module to keep the 3D view centered in the
// uncovered area, and by anything that positions floating UI):
//   shell.mode                     'sheet' (portrait phone) | 'side' (landscape / wide)
//   shell.sheetSnap                'peek' | 'half' | 'full' (portrait sheet height), shell.setSheetSnap(name)
//   shell.getViewInsets()          {top, right, bottom, left} CSS px of the canvas covered by opaque UI
//   shell.addEventListener('layout', e => e.live)  fired on open/close/snap/drag/resize (live = while dragging)
//   app event 'uilayout' {insets, live}            same, on the app
// CSS vars on <html>: --cover-top/right/bottom/left (px), --pv-free-cx (center of the free area, px).
import { h, icon, iconButton, hasOpenLayer, closeTopLayer, haptic, toast } from './kit.js';

/** Toolbar groups. A tool declares `group`; a group with several tools shows sub-tabs. */
export const TOOL_GROUPS = [
  { id: 'people', label: 'Personaggi', icon: 'people' },
  { id: 'pose', label: 'Posa', icon: 'pose' },
  { id: 'look', label: 'Aspetto', icon: 'shirt' },
  { id: 'scene', label: 'Scena', icon: 'sun' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
  { id: 'style', label: 'Stile', icon: 'palette' },
];

/** Portrait sheet snap points, as fractions of the height above the toolbar ('full' is capped below the top bar). */
const SNAPS = { peek: 0.31, half: 0.47, full: 1 };
const SNAP_ORDER = ['peek', 'half', 'full'];
const SNAP_KEY = 'posaviva.ui.sheet';
const SIDE_QUERY = '(orientation: landscape) and (min-width: 700px)';

export class Shell extends EventTarget {
  constructor(app, root) {
    super();
    this.app = app;
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
    this.handle = h('div', { class: 'pv-panel-handle', 'aria-hidden': 'true' }, h('span'));
    // A group with several tools shows its sub-tabs in the header row, in place of
    // the title (the active tab names the tool): one row less above the content.
    this.subTabs = h('div', { class: 'pv-chips pv-subtabs', role: 'tablist' });
    this.subTabs.addEventListener('scroll', () => this._subTabsFade(), { passive: true });
    // a hairline under the header once the content scrolls beneath it
    this.panelBody.addEventListener('scroll', () => this.panel.classList.toggle('scrolled', this.panelBody.scrollTop > 2), { passive: true });
    this.panelHead = h('div', { class: 'pv-panel-head' }, this.panelTitle, this.subTabs, closeBtn);
    this.panel = h('div', { class: 'pv-panel', role: 'region', 'aria-label': 'Strumenti' }, this.handle, this.panelHead, this.panelBody);
    this.toolbar = h('nav', { class: 'pv-toolbar', 'aria-label': 'Strumenti' });
    // measures env(safe-area-inset-*) / the --safe-* vars injected by the Android shell
    this._probe = h('div', { class: 'pv-safe-probe', 'aria-hidden': 'true' });
    root.append(this.viewport, this.overlay, this.topBar, this.hintEl, this.panel, this.toolbar, this._probe);

    this._mq = window.matchMedia(SIDE_QUERY);
    let snap = 'half';
    try { snap = localStorage.getItem(SNAP_KEY) || 'half'; } catch { /* private mode */ }
    this.sheetSnap = SNAP_ORDER.includes(snap) ? snap : 'half';
    this._sheetPx = 0; // current sheet height (px) in portrait
    this._insets = { top: 0, right: 0, bottom: 0, left: 0 };

    this._setupSheetDrag();
    this._setupBack();
    this._setupLayoutWatch();
    this._applySheetHeight();
    this._renderToolbar();
  }

  /** The element that should host the WebGL canvas. */
  get canvasHost() { return this.viewport; }

  /** 'sheet' (portrait: bottom toolbar + bottom sheet) or 'side' (landscape: left rail + right panel). */
  get mode() { return this._mq.matches ? 'side' : 'sheet'; }

  get panelOpen() { return !!this.active; }

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
    this.toolbar.replaceChildren();
    this.toolbar.style.setProperty('--n', groups.length);
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
    }
    // sub-tabs for the active group (in the header row, replacing the title)
    this.subTabs.replaceChildren();
    const ag = groups.find((g) => g.id === activeGroup);
    const show = !!ag && ag.tools.length > 1;
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
   * tighter labels ('tight', e.g. the five Scena tabs on a 412 px phone); if they still
   * do not fit the row scrolls, with faded edges where more tabs are hidden.
   */
  _fitSubTabs() {
    const st = this.subTabs;
    if (st.style.display === 'none') return;
    st.classList.remove('compact', 'tight');
    for (const level of ['compact', 'tight']) {
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

  /** Sheet heights (px) for each snap point at the current window size. */
  snapHeights() {
    const H = this.root.clientHeight || window.innerHeight;
    const tb = this.toolbar.offsetHeight || 64;
    const avail = Math.max(200, H - tb);
    const topReserve = this.topBar.offsetTop + this.topBar.offsetHeight + 6;
    const full = Math.max(260, H - tb - topReserve);
    return {
      peek: Math.round(Math.min(full, Math.max(210, avail * SNAPS.peek))),
      half: Math.round(Math.min(full, Math.max(300, avail * SNAPS.half))),
      full: Math.round(full),
    };
  }

  setSheetSnap(name, { persist = true } = {}) {
    if (!SNAP_ORDER.includes(name)) return;
    this.sheetSnap = name;
    if (persist) { try { localStorage.setItem(SNAP_KEY, name); } catch { /* ignore */ } }
    this._applySheetHeight();
    this._emitLayout(false);
  }

  _applySheetHeight(px) {
    this._sheetPx = px ?? this.snapHeights()[this.sheetSnap];
    this.panel.style.setProperty('--sheet-h', this._sheetPx + 'px');
    this.panel.dataset.snap = px === undefined ? this.sheetSnap : '';
  }

  /** CSS px of the canvas hidden by opaque UI in the current (target) state. */
  getViewInsets() {
    const r = this.root.getBoundingClientRect();
    const ins = { top: 0, right: 0, bottom: 0, left: 0 };
    if (this.mode === 'side') {
      ins.left = this.toolbar.getBoundingClientRect().right - r.left;
      if (this.active) {
        ins.right = this.panel.offsetWidth;
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
    const ins = this.getViewInsets();
    this._insets = ins;
    const ds = document.documentElement.style;
    ds.setProperty('--cover-top', ins.top + 'px');
    ds.setProperty('--cover-right', ins.right + 'px');
    ds.setProperty('--cover-bottom', ins.bottom + 'px');
    ds.setProperty('--cover-left', ins.left + 'px');
    const W = this.root.clientWidth || window.innerWidth, H = this.root.clientHeight || window.innerHeight;
    ds.setProperty('--pv-free-cx', Math.round(ins.left + (W - ins.left - ins.right) / 2) + 'px');
    // toasts sit just above the sheet; when the sheet leaves no room for them (full
    // height) they float over its lower edge instead of covering the top bar
    const topBarBottom = this.topBar.offsetTop + this.topBar.offsetHeight;
    const roomy = H - ins.bottom - topBarBottom >= 120;
    const tb = this.mode === 'sheet' ? this.toolbar.offsetHeight : this.safeInsets().bottom;
    ds.setProperty('--pv-toast-bottom', Math.round((roomy ? Math.max(ins.bottom, tb) : tb) + 14) + 'px');
    const ev = new Event('layout');
    ev.live = live; ev.insets = ins;
    this.dispatchEvent(ev);
    this.app?.dispatchEvent({ type: 'uilayout', insets: ins, live });
  }

  _setupLayoutWatch() {
    let raf = 0;
    const relayout = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; this.root.classList.toggle('pv-side', this.mode === 'side'); this._applySheetHeight(); this._fitSubTabs(); this._emitLayout(false); });
    };
    this.root.classList.toggle('pv-side', this.mode === 'side');
    this._mq.addEventListener?.('change', relayout);
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
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, h0: this._sheetPx, moved: false, el: e.currentTarget };
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
      const hs = this.snapHeights();
      let nh = drag.h0 - dy;
      // rubber band above 'full' and below 'peek'
      if (nh > hs.full) nh = hs.full + (nh - hs.full) * 0.25;
      if (nh < 120) nh = 120 - (120 - nh) * 0.3;
      this._applySheetHeight(Math.round(nh));
      samples.push([e.clientY, e.timeStamp]);
      if (samples.length > 6) samples.shift();
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; this._emitLayout(true); });
    };
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      this.panel.classList.remove('dragging');
      if (d.moved) {
        // the click that may follow a drag must not activate a tab or close the panel
        this._suppressClick = true;
        setTimeout(() => { this._suppressClick = false; }, 0);
      }
      if (!d.moved) {
        // tap on the grip cycles peek -> half -> full -> peek
        if (d.el === this.handle && e.type === 'pointerup') { haptic('tick'); this.setSheetSnap(SNAP_ORDER[(SNAP_ORDER.indexOf(this.sheetSnap) + 1) % SNAP_ORDER.length]); }
        return;
      }
      // velocity (px/ms, positive = finger moving down)
      let v = 0;
      if (samples.length > 1) { const a = samples[0], b = samples[samples.length - 1]; v = (b[0] - a[0]) / Math.max(1, b[1] - a[1]); }
      const hs = this.snapHeights();
      const projected = this._sheetPx - v * 160; // where a flick would carry the sheet
      if (projected < hs.peek * 0.62 || (v > 1.1 && this._sheetPx < hs.half)) { this._applySheetHeight(this.snapHeights()[this.sheetSnap]); this.closePanel(); return; }
      let best = 'half', bd = Infinity;
      for (const s of SNAP_ORDER) { const dd = Math.abs(hs[s] - projected); if (dd < bd) { bd = dd; best = s; } }
      haptic('tick');
      this.setSheetSnap(best);
    };
    for (const el of [this.handle, this.panelHead]) {
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
  }

  // ------------------------------------------------------------ back button
  _setupBack() {
    // Android back: dialogs/menus first, then temporary modes, then the panel. With
    // nothing left to close, a first back only warns and a second one within 2 s
    // exits (false lets the Android shell finish the activity).
    const back = () => {
      if (hasOpenLayer()) { closeTopLayer(); return true; }
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
