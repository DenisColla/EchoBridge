// "Edifici" tool (group Scena): catalog of building styles with textured
// thumbnails and sub-category chips; editor of the selected building with
// style, size, facade color, wear, night lights, details, placement and
// "Rigenera" (new random variant). Buildings are regular props (app.props).
import * as THREE from 'three';
import { h, section, slider, segmented, button, swatches, cardGrid, chips, toggle, toast, haptic, icon } from '../ui/kit.js';
import { BUILDING_TYPES, SUBS, TYPE_MAP } from './types.js';
import { PALETTES } from './mats.js';
import { defaultParams } from '../props/catalog.js';
import { isBuilding } from './lod.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const fmtM = (v) => `${v >= 100 ? Math.round(v) : v.toFixed(1)} m`;
const STYLE_IDS = new Set(['variant', 'shape', 'mix', 'sign', 'roof', 'balc', 'height']);
const _ndc = new THREE.Vector2(), _plane = new THREE.Plane(), _n = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3(), _box = new THREE.Box3();

export function registerBuildingsTool(app, shell, thumbs) {
  const props = () => app.props;

  // ------------------------------------------------------------ placement helpers
  /**
   * Puts p behind the selected character (or the view target) as seen from the
   * camera, its front facing the camera, beside the other buildings of the street.
   */
  function placeBehind(p, ch = app.selection.character) {
    let ox, oz;
    if (ch && ch.root.visible) { ox = ch.root.position.x; oz = ch.root.position.z; }
    else { ox = app.controls.target.x; oz = app.controls.target.z; }
    const c = app.camera.position;
    let yaw = Math.atan2(c.x - ox, c.z - oz);
    // aligned with the character when it roughly faces the camera (tidy street lines)
    if (ch && Math.abs(Math.atan2(Math.sin(yaw - ch.root.rotation.y), Math.cos(yaw - ch.root.rotation.y))) < 0.45) yaw = ch.root.rotation.y;
    else yaw = Math.round(yaw / (Math.PI / 36)) * (Math.PI / 36);
    const s = p.scale, b = p.localBox;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const gap = 2.6;
    const front = b.max.z * s, hw = ((b.max.x - b.min.x) / 2) * s, cxl = ((b.max.x + b.min.x) / 2) * s;
    const back = gap + front; // origin distance behind the subject
    const depthN = (b.max.z - b.min.z) * s;
    // occupied intervals along the street line (other buildings overlapping our depth band)
    const occ = [];
    for (const q of props().props) {
      if (q === p || !isBuilding(q) || q.hold) continue;
      q.worldBox(_box);
      let a0 = Infinity, a1 = -Infinity, f0 = Infinity, f1 = -Infinity;
      for (let i = 0; i < 4; i++) {
        const x = (i & 1 ? _box.max.x : _box.min.x) - ox, z = (i & 2 ? _box.max.z : _box.min.z) - oz;
        const u = x * rx + z * rz, f = x * fx + z * fz;
        a0 = Math.min(a0, u); a1 = Math.max(a1, u); f0 = Math.min(f0, f); f1 = Math.max(f1, f);
      }
      if (f1 > -back - depthN && f0 < -gap) occ.push([a0, a1]);
    }
    const free = (sft) => occ.every(([a, c]) => sft + cxl + hw <= a - 0.05 || sft + cxl - hw >= c + 0.05);
    const cands = [0];
    for (const [a, c] of occ) cands.push(c + 0.06 + hw - cxl, a - 0.06 - hw - cxl);
    cands.sort((x, y) => Math.abs(x) - Math.abs(y));
    const sft = cands.find(free) ?? 0;
    p.root.position.set(ox - fx * back + rx * sft, 0, oz - fz * back + rz * sft);
    p.root.rotation.set(0, yaw, 0, 'YXZ');
    p.root.scale.setScalar(p.scale);
    p.root.position.y = groundOf(p);
    props()._changed?.(p);
  }

  /** Ground under a building: a landscape's terrain (lowest point of the footprint) or y = 0. */
  const groundOf = (p) => props().floorUnder ? props().floorUnder(p, { lowest: true }) : 0;

  /**
   * Adds a building with a fresh random variant. opts: {near: Character (placed
   * behind it as seen from the camera; default the selected character), place = true
   * (false: leave it at the origin, the caller places it), commit = true, select = true,
   * toast = true, params, color}. Returns the prop.
   */
  function addBuilding(id, opts = {}) {
    const type = TYPE_MAP.get(id);
    if (!type || !props()) return null;
    const { near, place = true, commit = true, select = true, toast: tell = true } = opts;
    const same = props().props.filter((q) => q.type.id === id).length;
    // built once, directly with a fresh random variant (and a new color for repeats)
    const params = { ...defaultParams(type), seed: 1 + Math.floor(Math.random() * 999999), ...(opts.params || {}) };
    const color = opts.color || (same && !type.noColor ? pickColor(type, type.color) : type.color);
    const p = props().create({ type: id, params, color });
    if (!p) return null;
    if (place) placeBehind(p, near !== undefined ? near : app.selection.character);
    props()._changed?.(p, 'list');
    if (select) props().select(p);
    if (commit) { haptic(12); app.commit('aggiungi edificio'); }
    if (tell) toast(`${type.label}: trascinalo per spostarlo`, 1800);
    return p;
  }

  function pickColor(type, current) {
    const list = (PALETTES[type.palette] || PALETTES.plaster).filter((c) => c !== current);
    return list[Math.floor(Math.random() * list.length)];
  }

  function regenerate(p) {
    const patch = { seed: 1 + Math.floor(Math.random() * 999999) };
    props().setParams(p, patch);
    if (!p.type.noColor) props().setColor(p, pickColor(p.type, p.color));
    haptic('light');
    app.commit('rigenera edificio');
  }

  // ------------------------------------------------------------ drag to move (tool active)
  let drag = null;
  const c = app.canvas;
  const isActive = () => shell.activeToolId === 'buildings';
  c.addEventListener('pointerdown', (e) => {
    if (drag) { if (e.pointerId !== drag.id) e.stopImmediatePropagation(); return; }
    if (!isActive() || e.button > 0) return;
    const p = props()?.selected;
    if (!isBuilding(p) || p.hold) return;
    app.pointerToNDC(e, _ndc);
    const hit = props().pick(_ndc, { only: p });
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const rc = props().raycaster;
    rc.setFromCamera(_ndc, app.camera);
    _plane.set(_n, -hit.point.y);
    const grab = rc.ray.intersectPlane(_plane, new THREE.Vector3()) || hit.point.clone();
    drag = { id: e.pointerId, p, x0: e.clientX, y0: e.clientY, moved: false, planeY: hit.point.y, offset: p.root.position.clone().sub(grab), ctl: app.controls.enabled, raf: 0, lx: 0, ly: 0, rel: p.root.position.y - groundOf(p),
      lift: app.landscapes?.hasTerrain && app.landscapes.rayGround ? hit.point.y - app.landscapes.heightAt(grab.x, grab.z) : null };
    app.controls.enabled = false;
  }, { capture: true });
  c.addEventListener('pointermove', (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    e.stopImmediatePropagation();
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
    if (!d.moved) { d.moved = true; shell.hint('Trascina per spostare l’edificio'); }
    d.lx = e.clientX; d.ly = e.clientY;
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; moveTo(d, d.lx, d.ly); });
  }, { capture: true });
  const up = (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    e.stopImmediatePropagation();
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    if (d.moved && e.type === 'pointerup') moveTo(d, e.clientX, e.clientY);
    drag = null;
    app.controls.enabled = d.ctl;
    try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    shell.hint('');
    if (d.moved) app.commit('sposta edificio');
  };
  c.addEventListener('pointerup', up, { capture: true });
  c.addEventListener('pointercancel', up, { capture: true });
  function moveTo(d, x, y) {
    app.pointerToNDC({ clientX: x, clientY: y }, _ndc);
    const rc = props().raycaster;
    rc.setFromCamera(_ndc, app.camera);
    let q = d.lift != null ? app.landscapes.rayGround(rc.ray, d.lift, _v, 800) : null;
    if (!q) {
      _plane.set(_n, -d.planeY);
      q = rc.ray.intersectPlane(_plane, _v);
      if (!q) return;
      // keep it within a sane distance of the camera target
      if (q.distanceTo(app.camera.position) > 2000) return;
    }
    props().moveTo(d.p, q.x + d.offset.x, q.z + d.offset.z);
    // on a landscape the building follows the ground (same height above it as before the drag)
    const yN = groundOf(d.p) + d.rel;
    if (Math.abs(yN - d.p.root.position.y) > 1e-5) props().setHeight(d.p, yN);
  }

  // ------------------------------------------------------------ tool
  shell.registerTool({
    id: 'buildings', label: 'Edifici', icon: 'building', group: 'scene', order: 66, title: 'Edifici',
    build(el) {
      el.classList.add('pv-bd-panel');
      const strip = h('div', { class: 'pv-chips pv-bd-strip' });
      const catalog = buildCatalog();
      const editorHost = h('div', { class: 'pv-bd-editor' });
      el.append(strip, catalog, editorHost);
      let editor = null, shown = false, popBack = null;

      function renderStrip() {
        strip.innerHTML = '';
        const list = props()?.props.filter(isBuilding) || [];
        const sel = props()?.selected;
        const add = h('button', { type: 'button', class: 'pv-chip pv-bd-add' + (isBuilding(sel) ? '' : ' active') }, icon('plus', 18), 'Aggiungi');
        add.addEventListener('click', () => props().select(null));
        strip.appendChild(add);
        const counts = {};
        for (const p of list) {
          counts[p.type.id] = (counts[p.type.id] || 0) + 1;
          const n = list.filter((q) => q.type.id === p.type.id).length > 1 ? ` ${counts[p.type.id]}` : '';
          const chip = h('button', { type: 'button', class: 'pv-chip' + (p === sel ? ' active' : '') }, icon('building', 16), p.type.label + n);
          chip.addEventListener('click', () => props().select(p));
          strip.appendChild(chip);
        }
        strip.style.display = list.length ? '' : 'none';
      }

      function buildCatalog() {
        const wrap = h('div', { class: 'pv-bd-catalog' });
        wrap.appendChild(h('div', { class: 'pv-bd-note' }, 'Tocca uno stile: l’edificio compare dietro al personaggio selezionato, rivolto verso di te. Poi puoi cambiarne piani, misure, colori e generare varianti.'));
        let sub = 'all';
        const subChips = chips({ items: [{ id: 'all', label: 'Tutti' }, ...SUBS], value: sub, onSelect: (id) => { sub = id; subChips.setValue(id); fill(); } });
        subChips.classList.add('pv-bd-subs');
        const grid = h('div', { class: 'pv-bd-grid' });
        wrap.append(subChips, grid);
        function fill() {
          grid.innerHTML = '';
          const items = BUILDING_TYPES.filter((t) => sub === 'all' || t.sub === sub).map((t) => ({ id: t.id, label: t.label, thumb: null }));
          const g = cardGrid({ items, columns: 3, onSelect: (id) => addBuilding(id) });
          // thumbnails are <img> elements: put them in the card visuals
          g.querySelectorAll('.pv-card').forEach((card) => {
            const t = TYPE_MAP.get(card.dataset.id);
            const vis = h('div', { class: 'pv-card-visual' }, thumbs.imageFor(t));
            card.insertBefore(vis, card.firstChild);
          });
          grid.appendChild(g);
        }
        fill();
        return wrap;
      }

      // throttle rebuilds while dragging sliders
      let pendingFn = null;
      function schedule(fn) {
        if (pendingFn) { pendingFn = fn; return; }
        pendingFn = fn;
        requestAnimationFrame(() => { const f = pendingFn; pendingFn = null; f?.(); });
      }

      function buildEditor(p) {
        const t = p.type, syncers = [], parts = [];
        const commit = (label) => app.commit(label);
        const setP = (patch) => props().setParams(p, patch);
        // header
        parts.push(h('div', { class: 'pv-bd-head' },
          h('div', { class: 'pv-bd-title' }, t.label),
          button({ icon: 'copy', small: true, title: 'Duplica accanto', onClick: () => duplicate(p) }),
          button({ icon: 'trash', small: true, variant: 'danger', title: 'Elimina', onClick: () => { props().remove(p); commit('elimina edificio'); } }),
          button({ icon: 'check', small: true, title: 'Fine', onClick: () => props().select(null) })));
        const seedLbl = h('span', { class: 'pv-bd-seed' });
        parts.push(h('div', { class: 'pv-row pv-bd-regen' },
          button({ label: 'Rigenera', icon: 'sparkle', variant: 'primary', onClick: () => regenerate(p) }), seedLbl));
        syncers.push(() => { seedLbl.textContent = `Variante n. ${p.params.seed}`; });

        const ctl = new Map();
        const mk = (d) => {
          let el;
          if (d.type === 'seg') {
            el = h('div', { class: 'pv-bd-field' }, h('div', { class: 'pv-bd-label' }, d.label),
              segmented({ options: d.options, value: p.params[d.id], onChange: (v) => { setP({ [d.id]: v }); commit('modifica edificio'); } }));
            el.setValue = (v) => el.lastChild.setValue(v);
            if (d.options.length > 3 && d.options.some((o) => o.label.length > 9) || d.options.length > 4) el.classList.add('wrap');
          } else if (d.type === 'toggle') {
            el = toggle({ label: d.label, value: p.params[d.id], onChange: (v) => { setP({ [d.id]: v }); commit('modifica edificio'); } });
          } else {
            const fmt = d.type === 'int' ? (v) => String(Math.round(v)) : d.unit === 'm' ? fmtM : d.unit === '°' ? (v) => `${Math.round(v)}°` : (v) => String(v);
            el = slider({ label: d.label, min: d.min, max: d.max, step: d.step, value: p.params[d.id], defaultValue: d.default, center: false, format: fmt,
              onInput: t.heavy ? undefined : (v) => schedule(() => setP({ [d.id]: v })),
              onChange: (v) => { if (t.heavy) setP({ [d.id]: v }); commit('modifica edificio'); } });
          }
          ctl.set(d.id, el);
          return el;
        };
        const styleCtl = [], dimCtl = [], detailCtl = [];
        for (const d of t.params) {
          if (d.id === 'seed' || d.id === 'wear' || d.id === 'night') continue;
          if (d.type === 'seg' && STYLE_IDS.has(d.id)) styleCtl.push(mk(d));
          else if (d.type === 'toggle') detailCtl.push(mk(d));
          else dimCtl.push(mk(d));
        }
        if (styleCtl.length) parts.push(section('Forma e stile', styleCtl));
        const scale = slider({ label: 'Scala', min: 0.5, max: 2, step: 0.01, value: p.scale, defaultValue: 1, center: false, format: (v) => `${Math.round(v * 100)}%`,
          onInput: (v) => props().setScale(p, v), onChange: () => commit('scala edificio') });
        dimCtl.push(scale);
        parts.push(section('Dimensioni', dimCtl));
        // facade
        const fac = [];
        if (!t.noColor) {
          const sw = swatches({ colors: PALETTES[t.palette] || PALETTES.plaster, value: p.color, onInput: (c) => props().setColor(p, c), onChange: (c) => { props().setColor(p, c); commit('colore edificio'); } });
          fac.push(h('div', { class: 'pv-bd-label' }, t.palette === 'glass' ? 'Colore dei vetri' : t.palette === 'metal' ? 'Colore principale' : 'Colore della facciata'), sw);
          syncers.push(() => sw.setValue(p.color));
        }
        const wd = t.params.find((d) => d.id === 'wear'), nd = t.params.find((d) => d.id === 'night');
        if (wd) fac.push(mk(wd));
        if (nd) fac.push(mk(nd));
        parts.push(section('Facciata', fac));
        if (detailCtl.length) parts.push(section('Dettagli', detailCtl));
        // placement
        const yaw = slider({ label: 'Rotazione', min: -180, max: 180, step: 1, value: p.yaw * R2D, defaultValue: 0, format: (v) => `${Math.round(v)}°`,
          onInput: (v) => props().setYaw(p, v * D2R), onChange: () => commit('ruota edificio') });
        const rot90 = button({ label: '90°', icon: 'rotate', small: true, onClick: () => { props().setYaw(p, p.yaw + Math.PI / 2); commit('ruota edificio'); } });
        const face = button({ label: 'Verso la camera', icon: 'camera', small: true, onClick: () => {
          const cpos = app.camera.position;
          props().setYaw(p, Math.atan2(cpos.x - p.root.position.x, cpos.z - p.root.position.z));
          commit('ruota edificio');
        } });
        const behind = button({ label: 'Dietro al personaggio', icon: 'person', small: true, onClick: () => {
          if (!app.selection.character) { toast('Seleziona prima un personaggio'); return; }
          placeBehind(p);
          commit('sposta edificio');
        } });
        parts.push(section('Posizione', [h('div', { class: 'pv-bd-note' }, 'Trascina l’edificio con un dito per spostarlo.'), yaw, h('div', { class: 'pv-row pv-bd-actions' }, rot90, face, behind)]));
        syncers.push(() => { yaw.setValue(p.yaw * R2D); scale.setValue(p.scale); for (const d of t.params) ctl.get(d.id)?.setValue?.(p.params[d.id]); });
        const root = h('div', {}, parts);
        const sync = () => syncers.forEach((s) => s());
        sync();
        return { prop: p, el: root, sync };
      }

      function duplicate(p) {
        const q = props().duplicate(p);
        if (!q) return;
        props().setParams(q, { seed: 1 + Math.floor(Math.random() * 999999) });
        // next to the original along its street line (right side)
        const w = (p.localBox.max.x - p.localBox.min.x) * p.scale + 0.05;
        const yaw = p.yaw;
        const rel = p.root.position.y - groundOf(p); // same height above the ground (landscapes)
        q.root.position.set(p.root.position.x + Math.cos(yaw) * w, p.root.position.y, p.root.position.z - Math.sin(yaw) * w);
        q.root.rotation.set(0, yaw, 0, 'YXZ');
        q.root.position.y = groundOf(q) + rel;
        props()._changed?.(q);
        props().select(q);
        app.commit('duplica edificio');
      }

      function render() {
        renderStrip();
        const p = props()?.selected;
        const ed = isBuilding(p) ? p : null;
        catalog.style.display = ed ? 'none' : '';
        if (!ed) { editor = null; editorHost.innerHTML = ''; syncBack(); return; }
        if (!editor || editor.prop !== ed) {
          editor = buildEditor(ed);
          editorHost.innerHTML = '';
          editorHost.appendChild(editor.el);
          shell.panelBody.scrollTop = 0;
        } else editor.sync();
        syncBack();
      }
      function syncBack() {
        const editing = shown && isBuilding(props()?.selected);
        if (editing && !popBack) popBack = app.pushBackHandler(() => { props().select(null); return true; });
        else if (!editing && popBack) { popBack(); popBack = null; }
      }

      let syncQueued = false;
      props()?.addEventListener('change', () => {
        if (!shown || syncQueued) return;
        syncQueued = true;
        requestAnimationFrame(() => { syncQueued = false; if (editor && props().props.includes(editor.prop)) editor.sync(); });
      });
      props()?.addEventListener('list', () => { if (shown) render(); });
      props()?.addEventListener('select', () => { if (shown) render(); });
      app.addEventListener('loaded', () => { if (shown) render(); });

      return {
        onShow() { shown = true; render(); app.invalidate(); },
        onHide() { shown = false; syncBack(); shell.hint(''); },
      };
    },
  });

  return { addBuilding, placeBehind, regenerate };
}
