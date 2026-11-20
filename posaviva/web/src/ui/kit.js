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
  input.addEventListener('input', () => { fill(); onInput?.(+input.value); });
  input.addEventListener('change', () => onChange?.(+input.value));
  // double tap resets to the default value
  let lastTap = 0;
  input.addEventListener('pointerdown', () => {
    const now = performance.now();
    if (now - lastTap < 280) { input.value = opts.defaultValue ?? (center ? 0 : value); fill(); onInput?.(+input.value); onChange?.(+input.value); }
    lastTap = now;
  });
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

/** Color swatches. opts: {colors:[hex], value, onChange(hex), allowCustom} -> el.setValue(hex) */
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
    custom.addEventListener('input', () => { el.setValue(custom.value); opts.onChange?.(custom.value); });
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

/** Transient message at the bottom of the screen. */
export function toast(message, ms = 2200) {
  let host = document.getElementById('pv-toasts');
  if (!host) { host = h('div', { id: 'pv-toasts' }); document.body.appendChild(host); }
  const t = h('div', { class: 'pv-toast' }, message);
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

/** Light haptic feedback through the Android bridge (no-op on web). */
export function haptic(ms = 12) {
  try { window.AndroidBridge?.vibrate?.(ms); } catch { /* ignore */ }
}
