// App shell: top bar, bottom tool bar, bottom sheet (portrait) / side panel
// (landscape), viewport overlay, hint line. Modules register their tools:
//
//   shell.registerTool({ id, label, icon, order, build(container, app) => ({ onShow?, onHide? }) })
//   shell.openTool(id) / shell.closePanel() / shell.hint(text) / shell.overlay
import { h, icon, button } from './kit.js';

/** Toolbar groups. A tool declares `group`; a group with several tools shows sub-tabs. */
export const TOOL_GROUPS = [
  { id: 'people', label: 'Personaggi', icon: 'people' },
  { id: 'pose', label: 'Posa', icon: 'pose' },
  { id: 'look', label: 'Aspetto', icon: 'shirt' },
  { id: 'scene', label: 'Scena', icon: 'sun' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
  { id: 'style', label: 'Stile', icon: 'palette' },
];

export class Shell {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.tools = [];
    this.active = null;

    this.viewport = h('div', { class: 'pv-viewport' });
    this.overlay = h('div', { class: 'pv-overlay' });
    this.hintEl = h('div', { class: 'pv-hint' });
    this.topLeft = h('div', { class: 'pv-top-left' });
    this.topRight = h('div', { class: 'pv-top-right' });
    this.topBar = h('div', { class: 'pv-topbar' }, this.topLeft, this.topRight);
    this.panelTitle = h('div', { class: 'pv-panel-title' });
    this.panelBody = h('div', { class: 'pv-panel-body' });
    const closeBtn = button({ icon: 'close', variant: 'ghost', small: true, title: 'Chiudi', onClick: () => this.closePanel() });
    this.handle = h('div', { class: 'pv-panel-handle' }, h('span'));
    this.subTabs = h('div', { class: 'pv-chips pv-subtabs' });
    this.panel = h('div', { class: 'pv-panel' }, this.handle, h('div', { class: 'pv-panel-head' }, this.panelTitle, closeBtn), this.subTabs, this.panelBody);
    this.toolbar = h('nav', { class: 'pv-toolbar' });
    root.append(this.viewport, this.overlay, this.topBar, this.hintEl, this.panel, this.toolbar);
    this._setupSheetDrag();
    this._setupBack();
  }

  /** The element that should host the WebGL canvas. */
  get canvasHost() { return this.viewport; }

  registerTool(tool) {
    tool.order ??= this.tools.length * 10;
    this.tools.push(tool);
    this.tools.sort((a, b) => a.order - b.order);
    this._renderToolbar();
    return tool;
  }

  _groupOf(t) { return t.group || t.id; }

  _renderToolbar() {
    this.toolbar.innerHTML = '';
    this._lastInGroup ||= {};
    const groups = [];
    for (const g of TOOL_GROUPS) { const tools = this.tools.filter((t) => this._groupOf(t) === g.id); if (tools.length) groups.push({ ...g, tools }); }
    for (const t of this.tools) if (!TOOL_GROUPS.some((g) => g.id === this._groupOf(t))) groups.push({ id: t.id, label: t.label, icon: t.icon, tools: [t] });
    const activeGroup = this.active ? this._groupOf(this.active.tool) : null;
    for (const g of groups) {
      const b = h('button', { type: 'button', class: 'pv-tool' + (activeGroup === g.id ? ' active' : '') }, icon(g.icon), h('span', {}, g.label));
      b.dataset.group = g.id;
      b.addEventListener('click', () => {
        if (activeGroup === g.id) return this.closePanel();
        const last = g.tools.find((t) => t.id === this._lastInGroup[g.id]) || g.tools[0];
        this.openTool(last.id);
      });
      this.toolbar.appendChild(b);
    }
    // sub-tabs for the active group
    this.subTabs.innerHTML = '';
    const ag = groups.find((g) => g.id === activeGroup);
    this.subTabs.style.display = ag && ag.tools.length > 1 ? '' : 'none';
    if (ag && ag.tools.length > 1) for (const t of ag.tools) {
      const c = h('button', { type: 'button', class: 'pv-chip' + (this.active.tool === t ? ' active' : '') }, icon(t.icon, 18), t.label);
      c.addEventListener('click', () => this.openTool(t.id));
      this.subTabs.appendChild(c);
    }
  }

  openTool(id) {
    const tool = this.tools.find((t) => t.id === id);
    if (!tool) return;
    if (this.active?.tool === tool) return;
    this.active?.ctrl?.onHide?.();
    tool._container ||= h('div', { class: 'pv-tool-content' });
    if (!tool._built) { tool._ctrl = tool.build(tool._container, this.app) || {}; tool._built = true; }
    this.panelBody.innerHTML = '';
    this.panelBody.appendChild(tool._container);
    this.panelTitle.textContent = tool.title || tool.label;
    this.active = { tool, ctrl: tool._ctrl };
    (this._lastInGroup ||= {})[this._groupOf(tool)] = tool.id;
    this.root.classList.add('panel-open');
    this.panel.classList.remove('collapsed');
    tool._ctrl.onShow?.();
    this._renderToolbar();
    this.app.dispatchEvent({ type: 'tool', id });
  }

  closePanel() {
    if (!this.active) return;
    this.active.ctrl?.onHide?.();
    this.active = null;
    this.root.classList.remove('panel-open');
    this._renderToolbar();
    this.app.dispatchEvent({ type: 'tool', id: null });
  }

  get activeToolId() { return this.active?.tool.id || null; }

  hint(text, ms = 0) {
    this.hintEl.textContent = text || '';
    this.hintEl.classList.toggle('show', !!text);
    clearTimeout(this._hintT);
    if (text && ms) this._hintT = setTimeout(() => this.hint(''), ms);
  }

  _setupSheetDrag() {
    let y0 = null, h0 = 0;
    this.handle.addEventListener('pointerdown', (e) => { y0 = e.clientY; h0 = this.panel.getBoundingClientRect().height; this.handle.setPointerCapture(e.pointerId); });
    this.handle.addEventListener('pointermove', (e) => {
      if (y0 === null) return;
      const nh = Math.max(120, Math.min(window.innerHeight * 0.85, h0 + (y0 - e.clientY)));
      this.panel.style.setProperty('--sheet-h', nh + 'px');
    });
    const end = (e) => {
      if (y0 === null) return;
      if (e.clientY - y0 > 140) this.closePanel();
      y0 = null;
    };
    this.handle.addEventListener('pointerup', end);
    this.handle.addEventListener('pointercancel', end);
  }

  _setupBack() {
    // Android back button: close panel first, then let the app exit
    window.__onAndroidBack = () => {
      if (this.app._backHandlers?.length) { const fn = this.app._backHandlers[this.app._backHandlers.length - 1]; if (fn() !== false) return true; }
      if (this.active) { this.closePanel(); return true; }
      return false;
    };
  }
}
