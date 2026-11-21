// Tiny DOM component kit shared by every panel. Signatures are a stable
// contract: modules build their panels only with these helpers.
import { icon } from './icons.js';

export { icon };

/** h('div', {class:'x', onClick: fn, style:{...}}, child, 'text', [children]) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

/** Titled group of controls. opts: {collapsible, collapsed} */
export function section(title, children = [], opts = {}) {
  const body = h('div', { class: 'pv-section-body' }, children);
  const head = h('div', { class: 'pv-section-title' }, title);
  const el = h('div', { class: 'pv-section' + (opts.collapsed ? ' collapsed' : '') }, title ? head : null, body);
  if (opts.collapsible) {
    head.classList.add('collapsible');
    head.addEventListener('click', () => el.classList.toggle('collapsed'));
  }
  el.body = body;
  return el;
}

export function row(...children) { return h('div', { class: 'pv-row' }, children); }

/**
 * Slider. opts: {label, min, max, step, value, format(v)->string, onInput(v), onChange(v), center (bool: bipolar fill)}
 * Returned element has .setValue(v) and .getValue().
 */
export function slider(opts) {
  const { label, min = 0, max = 1, step = 0.01, value = 0, format, onInput, onChange, center = min < 0 && max > 0 } = opts;
  const input = h('input', { type: 'range', min, max, step, value });
  const out = h('span', { class: 'pv-slider-value' });
  const fill = () => {
    const v = +input.value, t = (v - min) / (max - min), c = center ? (0 - min) / (max - min) : 0;
    const a = Math.min(t, c) * 100, b = Math.max(t, c) * 100;
    input.style.setProperty('--fa', a + '%'); input.style.setProperty('--fb', b + '%');
    out.textContent = format ? format(v) : (Math.abs(max - min) <= 2 ? v.toFixed(2) : String(Math.round(v)));
  };
  // Double tap resets to the default value. The reset is applied when the second tap
  // ends: the browser moves the thumb to the finger on pointerdown, which would
  // otherwise overwrite a value set there. A second tap that turns into a drag is a drag.
  let lastTap = 0, resetting = null, skipChange = false;
  const doReset = () => {
    resetting = null;
    input.value = opts.defaultValue ?? (center ? 0 : value);
    fill(); onInput?.(+input.value); onChange?.(+input.value);
    // the browser may still fire 'change' for this gesture: report the reset once
    skipChange = true; setTimeout(() => { skipChange = false; }, 0);
  };
  input.addEventListener('pointerdown', (e) => {
    const now = performance.now();
    resetting = now - lastTap < 320 ? { x: e.clientX, y: e.clientY, v: input.value } : null;
    lastTap = resetting ? 0 : now;
  });
  input.addEventListener('pointermove', (e) => {
    if (resetting && Math.hypot(e.clientX - resetting.x, e.clientY - resetting.y) > 8) { resetting = null; fill(); onInput?.(+input.value); }
  });
  input.addEventListener('pointerup', () => { if (resetting) doReset(); });
  input.addEventListener('pointercancel', () => { if (resetting) { input.value = resetting.v; resetting = null; fill(); } });
  input.addEventListener('input', () => { if (resetting) return; fill(); onInput?.(+input.value); });
  input.addEventListener('change', () => { if (resetting) return doReset(); if (skipChange) return; onChange?.(+input.value); });
  const el = h('label', { class: 'pv-slider' }, h('div', { class: 'pv-slider-head' }, h('span', { class: 'pv-slider-label' }, label), out), input);
  el.setValue = (v) => { input.value = v; fill(); };
  el.getValue = () => +input.value;
  el.input = input;
  fill();
  return el;
}

/** Toggle switch. opts: {label, value, onChange(bool)} -> el.setValue(b) */
export function toggle(opts) {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!opts.value;
  input.addEventListener('change', () => opts.onChange?.(input.checked));
  const el = h('label', { class: 'pv-toggle' }, h('span', {}, opts.label), input, h('span', { class: 'pv-toggle-track' }));
  el.setValue = (v) => { input.checked = !!v; };
  el.getValue = () => input.checked;
  return el;
}

/** Segmented control. opts: {options:[{value,label,icon?}], value, onChange(value)} -> el.setValue(v) */
export function segmented(opts) {
  const el = h('div', { class: 'pv-seg' });
  const btns = opts.options.map((o) => {
    const b = h('button', { type: 'button', class: 'pv-seg-btn', title: o.label }, o.icon ? icon(o.icon) : null, o.label && !opts.iconsOnly ? h('span', {}, o.label) : null);
    b.addEventListener('click', () => { el.setValue(o.value); opts.onChange?.(o.value); });
    b.dataset.value = String(o.value);
    el.appendChild(b);
    return b;
  });
  el.setValue = (v) => btns.forEach((b) => b.classList.toggle('active', b.dataset.value === String(v)));
  el.setValue(opts.value);
  return el;
}

/** Button. opts: {label, icon, onClick, variant:'primary'|'ghost'|'danger', small} */
export function button(opts) {
  const b = h('button', { type: 'button', class: `pv-btn ${opts.variant || ''} ${opts.small ? 'small' : ''}`.trim(), title: opts.title || opts.label || '' },
    opts.icon ? icon(opts.icon) : null, opts.label ? h('span', {}, opts.label) : null);
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

/**
 * Color swatches. opts: {colors:[hex], value, onChange(hex), onInput(hex), allowCustom} -> el.setValue(hex)
 * The custom picker reports live changes through onInput (when given; onChange otherwise)
 * and the final color through onChange, so a picker drag records one undo step.
 */
export function swatches(opts) {
  const el = h('div', { class: 'pv-swatches' });
  const items = opts.colors.map((c) => {
    const s = h('button', { type: 'button', class: 'pv-swatch', style: { background: c }, title: c });
    s.dataset.value = c.toLowerCase();
    s.addEventListener('click', () => { el.setValue(c); opts.onChange?.(c); });
    el.appendChild(s);
    return s;
  });
  let custom = null;
  if (opts.allowCustom !== false) {
    custom = h('input', { type: 'color', class: 'pv-swatch custom', value: opts.value || '#888888' });
    custom.addEventListener('input', () => { el.setValue(custom.value); (opts.onInput || opts.onChange)?.(custom.value); });
    if (opts.onInput) custom.addEventListener('change', () => { el.setValue(custom.value); opts.onChange?.(custom.value); });
    el.appendChild(custom);
  }
  el.setValue = (v) => {
    const lv = (v || '').toLowerCase();
    let found = false;
    items.forEach((s) => { const on = s.dataset.value === lv; s.classList.toggle('active', on); found ||= on; });
    if (custom) { custom.classList.toggle('active', !found && !!v); if (v) custom.value = v; }
  };
  el.setValue(opts.value);
  return el;
}

/**
 * Grid of selectable cards. opts: {items:[{id,label,icon?,thumb?(url|canvas),badge?}], value, onSelect(id), columns, multi}
 * -> el.setValue(id | id[])
 */
export function cardGrid(opts) {
  const el = h('div', { class: 'pv-cards', style: { gridTemplateColumns: `repeat(${opts.columns || 3}, minmax(0, 1fr))` } });
  const cards = opts.items.map((it) => {
    let visual = null;
    if (it.thumb instanceof HTMLCanvasElement) visual = it.thumb;
    else if (it.thumb) visual = h('img', { src: it.thumb, alt: '' });
    else if (it.icon) visual = icon(it.icon);
    const c = h('button', { type: 'button', class: 'pv-card' }, visual ? h('div', { class: 'pv-card-visual' }, visual) : null, h('span', { class: 'pv-card-label' }, it.label), it.badge ? h('span', { class: 'pv-card-badge' }, it.badge) : null);
    c.dataset.id = it.id;
    c.addEventListener('click', () => opts.onSelect?.(it.id));
    el.appendChild(c);
    return c;
  });
  el.setValue = (v) => {
    const set = new Set(Array.isArray(v) ? v : [v]);
    cards.forEach((c) => c.classList.toggle('active', set.has(c.dataset.id)));
  };
  el.setValue(opts.value);
  return el;
}

/** Horizontal scrolling chip list. opts: {items:[{id,label}], value, onSelect(id)} */
export function chips(opts) {
  const el = h('div', { class: 'pv-chips' });
  const cs = opts.items.map((it) => {
    const c = h('button', { type: 'button', class: 'pv-chip' }, it.icon ? icon(it.icon) : null, it.label);
    c.dataset.id = it.id;
    c.addEventListener('click', () => opts.onSelect?.(it.id));
    el.appendChild(c);
    return c;
  });
  el.setValue = (v) => { const set = new Set(Array.isArray(v) ? v : [v]); cs.forEach((c) => c.classList.toggle('active', set.has(c.dataset.id))); };
  el.setValue(opts.value);
  return el;
}


/** Round icon-only button (>= 40px target). opts: {icon, title, onClick, variant, active} -> el.setActive(b), el.setDisabled(b) */
export function iconButton(opts) {
  const b = h('button', { type: 'button', class: `pv-icon-btn ${opts.variant || ''}`.trim(), title: opts.title || '', 'aria-label': opts.title || '' }, icon(opts.icon, opts.size || 22));
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  b.setActive = (on) => b.classList.toggle('active', !!on);
  b.setDisabled = (on) => { b.disabled = !!on; };
  b.setIcon = (name) => b.replaceChildren(icon(name, opts.size || 22));
  if (opts.active) b.setActive(true);
  return b;
}

// ---------------------------------------------------------------- haptics
// One switch for the whole app (Impostazioni > Vibrazione). Read once from the
// persisted settings so it is honored before the io module boots.
const HAPTIC_MS = { tick: 8, light: 12, medium: 22, heavy: 40, success: 18, warning: 30, error: 45 };
let hapticsOn = true;
try { hapticsOn = JSON.parse(localStorage.getItem('posaviva.settings') || '{}').haptics !== false; } catch { /* private mode */ }

/** Enables / disables every haptic() call. */
export function setHapticsEnabled(on) { hapticsOn = !!on; }
export function hapticsEnabled() { return hapticsOn; }

/**
 * Short haptic feedback through the Android bridge (navigator.vibrate in
 * browsers that support it). ms: number or 'tick'|'light'|'medium'|'heavy'|'success'|'warning'|'error'.
 */
export function haptic(ms = 12) {
  if (!hapticsOn) return;
  const d = typeof ms === 'string' ? HAPTIC_MS[ms] || 12 : ms;
  try {
    if (window.AndroidBridge?.vibrate) window.AndroidBridge.vibrate(d);
    else if (navigator.vibrate && navigator.userActivation?.isActive) navigator.vibrate(d);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- toasts
const TOAST_ICONS = { ok: 'checkCircle', error: 'warning', warning: 'warning', info: 'info' };

/**
 * Transient message near the bottom of the free area (above the tool sheet).
 * toast(message, ms = 2200) or toast(message, {ms, kind:'ok'|'error'|'warning'|'info', icon, action:{label, onClick}}).
 * An identical message already on screen is refreshed instead of stacked. Returns the element.
 */
export function toast(message, opts = 2200) {
  const o = typeof opts === 'number' ? { ms: opts } : { ...opts };
  const ms = o.ms ?? (o.action ? 4500 : 2200);
  let host = document.getElementById('pv-toasts');
  if (!host) { host = h('div', { id: 'pv-toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(host); }
  const text = String(message);
  for (const t of host.children) {
    if (t._text === text && !t._leaving) { clearTimeout(t._timer); t._timer = setTimeout(t._dismiss, ms); return t; }
  }
  const ic = o.icon || TOAST_ICONS[o.kind];
  const t = h('div', { class: `pv-toast ${o.kind || ''}`.trim() }, ic ? icon(ic, 18) : null, h('span', { class: 'pv-toast-text' }, text));
  t._text = text;
  t._dismiss = () => {
    if (t._leaving) return;
    t._leaving = true;
    t.classList.remove('show');
    setTimeout(() => t.remove(), 260);
  };
  if (o.action) {
    const a = h('button', { type: 'button', class: 'pv-toast-action' }, o.action.label);
    a.addEventListener('click', () => { t._dismiss(); o.action.onClick?.(); });
    t.appendChild(a);
    t.classList.add('has-action');
  }
  host.appendChild(t);
  while (host.children.length > 3) host.firstChild.remove();
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  t._timer = setTimeout(t._dismiss, ms);
  return t;
}

// ---------------------------------------------------------------- layers (dialogs, menus)
// Every modal surface registers in one stack so the Android back button (and
// Escape on desktop) closes the topmost one first.
const layers = [];

/** True while a dialog / menu / sheet created by the kit is open. */
export function hasOpenLayer() { return layers.length > 0; }

/** Closes (cancels) the topmost dialog or menu. Returns true if one was open. */
export function closeTopLayer() {
  const l = layers[layers.length - 1];
  if (!l) return false;
  if (l.dismissable === false) return true; // e.g. a blocking progress dialog: swallow back
  l.close(null);
  return true;
}

function layerHost() {
  let host = document.getElementById('pv-layers');
  if (!host) { host = h('div', { id: 'pv-layers' }); document.body.appendChild(host); }
  return host;
}

/**
 * Generic modal surface.
 * opts: {title, subtitle, body: Node|Node[], actions:[{label, value, variant:'primary'|'danger'|'ghost', icon}],
 *        kind:'dialog'|'sheet' (sheet = bottom sheet on phones, centered card on wide screens),
 *        dismissable=true (backdrop tap / back), className, icon, onClose(value)}
 * Returns {el, card, body, close(value), result: Promise<value|null>}.
 */
export function modal(opts = {}) {
  const kind = opts.kind || 'dialog';
  const body = h('div', { class: 'pv-modal-body' }, opts.body || null);
  const head = opts.title ? h('div', { class: 'pv-modal-head' },
    opts.icon ? h('div', { class: `pv-modal-icon ${opts.danger ? 'danger' : ''}`.trim() }, icon(opts.icon, 22)) : null,
    h('div', { class: 'pv-modal-titles' }, h('div', { class: 'pv-modal-title' }, opts.title), opts.subtitle ? h('div', { class: 'pv-modal-subtitle' }, opts.subtitle) : null),
    kind === 'sheet' && opts.dismissable !== false ? iconButton({ icon: 'close', title: 'Chiudi', onClick: () => api.close(null) }) : null) : null;
  const actions = opts.actions?.length ? h('div', { class: 'pv-modal-actions' }) : null;
  const card = h('div', { class: `pv-modal-card ${opts.className || ''}`.trim(), role: 'dialog', 'aria-modal': 'true' },
    kind === 'sheet' ? h('div', { class: 'pv-modal-grip' }, h('span')) : null, head, body, actions);
  const el = h('div', { class: `pv-modal pv-modal-${kind}` }, h('div', { class: 'pv-modal-backdrop' }), card);
  let resolve;
  const result = new Promise((r) => { resolve = r; });
  let closed = false;
  const layer = { dismissable: opts.dismissable !== false, close: (v) => api.close(v) };
  const api = {
    el, card, body, result,
    close(value = null) {
      if (closed) return;
      closed = true;
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
      el.classList.remove('show');
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 240);
      opts.onClose?.(value);
      resolve(value);
    },
  };
  if (actions) for (const a of opts.actions) {
    const b = button({ label: a.label, icon: a.icon, variant: a.variant });
    b.addEventListener('click', () => { haptic('tick'); if (a.onClick?.() === false) return; api.close(a.value ?? a.label); });
    actions.appendChild(b);
  }
  el.querySelector('.pv-modal-backdrop').addEventListener('click', () => { if (layer.dismissable) api.close(null); });
  if (kind === 'sheet' && layer.dismissable) sheetDragToDismiss(card, () => api.close(null));
  layers.push(layer);
  layerHost().appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  return api;
}

/** Bottom sheets: drag the grip / title row down to dismiss (phones only: wide screens show a card). */
function sheetDragToDismiss(card, dismiss) {
  let d = null;
  const down = (e) => {
    if (window.matchMedia('(min-width: 700px)').matches || e.target.closest('button, input')) return;
    d = { id: e.pointerId, y0: e.clientY, t0: e.timeStamp, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!d || e.pointerId !== d.id) return;
    d.dy = Math.max(0, e.clientY - d.y0);
    card.style.transition = 'none';
    card.style.transform = `translateY(${d.dy}px)`;
  };
  const up = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const v = d.dy / Math.max(1, e.timeStamp - d.t0);
    const go = d.dy > 110 || (d.dy > 30 && v > 0.6);
    d = null;
    card.style.transition = '';
    card.style.transform = go ? 'translateY(100%)' : '';
    if (go) dismiss();
  };
  for (const sel of ['.pv-modal-grip', '.pv-modal-head']) {
    const el = card.querySelector(sel);
    if (!el) continue;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}

/** Yes/no question. opts: {title, okLabel='OK', cancelLabel='Annulla', danger, icon} -> Promise<boolean> */
export function confirmDialog(text, opts = {}) {
  const m = modal({
    title: opts.title || (opts.danger ? 'Sei sicuro?' : 'Conferma'),
    icon: opts.icon || (opts.danger ? 'warning' : null), danger: opts.danger,
    body: h('p', { class: 'pv-modal-text' }, text),
    actions: [
      { label: opts.cancelLabel || 'Annulla', value: false, variant: 'ghost' },
      { label: opts.okLabel || 'OK', value: true, variant: opts.danger ? 'danger-solid' : 'primary' },
    ],
  });
  if (opts.danger) haptic('warning');
  return m.result.then((v) => v === true);
}

/**
 * Text input dialog. opts: {title, okLabel='OK', placeholder, maxLength=60, selectAll=true}
 * -> Promise<string|null> (trimmed; null when cancelled or empty).
 */
export function promptDialog(label, value = '', opts = {}) {
  const input = h('input', { type: 'text', class: 'pv-input', value: value ?? '', placeholder: opts.placeholder || '', maxlength: opts.maxLength || 60, enterkeyhint: 'done', autocomplete: 'off', spellcheck: 'false' });
  const field = h('label', { class: 'pv-field' }, h('span', { class: 'pv-field-label' }, label), input);
  let ok;
  const m = modal({
    title: opts.title || label, body: field,
    actions: [
      { label: 'Annulla', value: null, variant: 'ghost' },
      { label: opts.okLabel || 'OK', variant: 'primary', onClick: () => { submit(); return false; } },
    ],
  });
  ok = m.card.querySelector('.pv-modal-actions .primary');
  const sync = () => { ok.disabled = !input.value.trim(); };
  function submit() { const v = input.value.trim(); if (v) m.close(v); }
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  sync();
  // focus after the enter transition so the soft keyboard opens reliably
  setTimeout(() => { input.focus({ preventScroll: true }); if (opts.selectAll !== false) input.select(); }, 60);
  return m.result.then((v) => (typeof v === 'string' && v.trim() ? v.trim() : null));
}

/**
 * Action list. items: [{id, label, icon, hint, danger, disabled, checked, onClick}] or {separator:true}.
 * opts: {title, anchor: Element} — with an anchor on wide screens it opens as a
 * popover next to it, otherwise as a bottom action sheet. -> Promise<id|null>
 * (item.onClick runs after the menu has closed).
 */
export function sheetMenu(items, opts = {}) {
  const wide = window.matchMedia('(min-width: 700px)').matches;
  const asPopover = !!opts.anchor && (wide || opts.popover === true);
  const list = h('div', { class: 'pv-menu', role: 'menu' });
  let m;
  for (const it of items) {
    if (!it) continue;
    if (it.separator) { list.appendChild(h('div', { class: 'pv-menu-sep' })); continue; }
    if (it.header) { list.appendChild(h('div', { class: 'pv-menu-header' }, it.header)); continue; }
    const b = h('button', { type: 'button', role: 'menuitem', class: `pv-menu-item ${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}`.trim(), disabled: it.disabled },
      it.icon ? icon(it.icon, 21) : h('span', { class: 'pv-menu-noicon' }),
      h('span', { class: 'pv-menu-label' }, it.label, it.hint ? h('small', {}, it.hint) : null),
      it.checked ? icon('check', 18) : null);
    b.addEventListener('click', () => { haptic('tick'); m.close(it.id); setTimeout(() => it.onClick?.(), 0); });
    list.appendChild(b);
  }
  if (asPopover) {
    m = modal({ body: list, kind: 'popover', className: 'pv-popover' });
    const r = opts.anchor.getBoundingClientRect();
    const card = m.card;
    const W = window.innerWidth, H = window.innerHeight;
    const w = 280;
    const right = r.right > W / 2;
    // short screens (landscape phone): open over the anchor so the whole menu fits
    const top = H < 520 ? Math.max(8, r.top) : Math.min(H - 80, r.bottom + 6);
    card.style.width = w + 'px';
    card.style.top = top + 'px';
    if (right) card.style.right = Math.max(8, W - r.right) + 'px';
    else card.style.left = Math.max(8, r.left) + 'px';
    card.style.maxHeight = `calc(100vh - ${Math.round(top + 8)}px - var(--safe-bottom))`;
    card.style.transformOrigin = right ? 'top right' : 'top left';
  } else {
    m = modal({ title: opts.title, body: list, kind: 'sheet', className: 'pv-action-sheet' });
  }
  return m.result;
}
