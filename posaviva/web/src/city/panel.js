// "Esterni" tool (group Scena): catalog of exterior items (kits, roads,
// vehicles, trees, nature, rocks, logs, street furniture) with thumbnails,
// sub-category chips and search; editor of the selected item with "Rigenera",
// connected road pieces, vehicles on the road, kit (group) actions, parameters,
// color and placement. Drag with one finger to move (roads snap to each other).
import * as THREE from 'three';
import { h, section, slider, segmented, button, swatches, chips, toggle, toast, haptic, icon, confirmDialog } from '../ui/kit.js';
import { TYPE_BY_ID, PROP_TYPES, defaultParams, cleanParams, TINT_COLORS } from '../props/catalog.js';
import { newSeed } from '../props/params.js';
import { KITS } from './kits.js';
import { VEHICLE_COLORS } from './vehicles.js';
import { isCity, isRoad, isVehicle, snapRoad, attachPiece, placeOnRoad, hasRoads, freeConnectors, worldConnectors, wrap } from './snap.js';
import { Y_WALK } from './roads.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const fmtM = (v) => `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} m`;
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const SUBS = [
  { id: 'kit', label: 'Kit pronti' }, { id: 'strade', label: 'Strade' }, { id: 'veicoli', label: 'Veicoli' }, { id: 'alberi', label: 'Alberi' },
  { id: 'natura', label: 'Natura' }, { id: 'rocce', label: 'Rocce' }, { id: 'tronchi', label: 'Tronchi' }, { id: 'arredo', label: 'Arredo urbano' },
];
export const PALETTES = {
  car: VEHICLE_COLORS,
  leaf: ['#6f8f4a', '#5a7f3a', '#8aa356', '#4d6b35', '#9aa84a', '#3f5a36', '#c9a227', '#b5531c', '#8c3a2a', '#e8b4c8'],
  metal: ['#2c3a33', '#2c2f33', '#4a5560', '#8e969d', '#c9ccd0', '#2f5a3e', '#7a1f24', '#2f4a6b', '#b3261e', '#e8e4dc'],
  bins: ['#2f6b3a', '#e2b21e', '#2f5aa8', '#7a7d80', '#6b4a2f', '#c9ccd0'],
  plaster: ['#e8dcc4', '#e9c98f', '#d9a46a', '#c97b54', '#f1ece2', '#cfd6cc', '#b9c6cf', '#e3b8a6', '#9fae8e', '#d8d2c6'],
  rock: ['#ffffff', '#d9d2c4', '#c9c3b8', '#a8a39a', '#bfae94', '#8e8a84', '#cbb89c', '#e6e0d6'],
};
/** Ground-like types: under characters, only pickable while Esterni / Oggetti is open. */
export const isGroundType = (t) => !!t && t.cat === 'esterni' && (t.road || ['es_prato', 'es_collina', 'es_laghetto', 'es_duna', 'es_vialetto', 'es_piazza'].includes(t.id));

const _ndc = new THREE.Vector2(), _plane = new THREE.Plane(), _up = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3();
const _rc = new THREE.Raycaster(), _down = new THREE.Vector3(0, -1, 0);

export function registerCityTool(app, shell, thumbs) {
  const props = () => app.props;
  const prefs = { snap: true };

  // ------------------------------------------------------------ ground helpers
  /** Meshes of ground-like exterior props (roads, sidewalks, terrain, lawns). */
  function groundMeshes(except = null) {
    const out = [];
    for (const q of props().props) {
      if (q === except || !isGroundType(q.type) || !q.root.visible) continue;
      // current matrices for the rays (the pivot does not auto-update: refresh from the root down)
      q.root.updateWorldMatrix(true, true);
      out.push(...q.meshes);
    }
    return out;
  }
  /** Ground of a ready landscape at world (x, z) (terrain, roof, pier), 0 without one. */
  function baseY(x, z) {
    const L = app.landscapes;
    const y = L?.heightAt ? L.heightAt(x, z) : 0;
    return Number.isFinite(y) ? y : 0;
  }
  /**
   * Height of the ground under world (x, z): the ground-like exterior pieces
   * (roads, sidewalks, lawns, terrain props) on top of the landscape ground
   * (app.landscapes.heightAt), else the floor y = 0.
   */
  function groundY(x, z, except = null) {
    const base = baseY(x, z);
    const list = groundMeshes(except);
    if (!list.length) return base;
    _rc.set(_v.set(x, base + 60, z), _down);
    _rc.far = 120;
    const hit = _rc.intersectObjects(list, false)[0];
    _rc.far = Infinity;
    return hit ? Math.max(base, hit.point.y) : base;
  }
  /** Drops a non-ground item onto the ground-like surface under it (roads, sidewalks, terrain, landscape). */
  function dropOnGround(p) {
    if (!p || isGroundType(p.type) || p.hold) return;
    const sink = p.type.sub === 'alberi' ? 0.04 : p.type.id === 'es_tronco' ? 0.03 : 0;
    const y = groundY(p.root.position.x, p.root.position.z, p) - sink;
    // trunks sink a little into the soil of a landscape; never below the studio floor
    p.root.position.y = app.landscapes?.current ? y : Math.max(0, y);
  }
  /**
   * True when the character stands on a support above the ground (a table, a bed,
   * a stool: a non-ground prop whose top is at its placement height under it).
   */
  function onSupport(ch, ground) {
    const pos = ch.root.position, M = props();
    if (!M || pos.y < ground + 0.03) return false;
    const list = [];
    for (const q of M.props) {
      if (q.hold || !q.root.visible || isGroundType(q.type)) continue;
      q.root.updateWorldMatrix(true, true);
      for (const m of q.meshes) list.push(m);
    }
    if (!list.length) return false;
    const r = 0.12 * (ch.root.scale.x || 1);
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      _rc.set(_v.set(pos.x + ox, pos.y + 0.35, pos.z + oz), _down);
      _rc.far = 0.6;
      const hits = _rc.intersectObjects(list, false);
      _rc.far = Infinity;
      // any surface near the feet (something else may hang above it: a lamp, a shelf)
      if (hits.some((h) => Math.abs(h.point.y - pos.y) < 0.2)) return true;
    }
    return false;
  }
  /**
   * Lifts (or lowers) a character onto the ground under its feet (sidewalk,
   * terrain, a landscape's hill / roof / pier). Characters standing, sitting or
   * lying on a support above the ground (table, bed…) are left where they are.
   * Returns true when the character moved.
   */
  function liftCharacter(ch) {
    if (!ch) return false;
    const pos = ch.root.position;
    const y = groundY(pos.x, pos.z);
    if (Math.abs(y - pos.y) < 0.004) return false;
    if (onSupport(ch, y)) return false;
    ch.setPlacement({ position: new THREE.Vector3(pos.x, y, pos.z), rotationY: ch.root.rotation.y });
    return true;
  }

  // ------------------------------------------------------------ placement of new items
  /**
   * Reference point of a new item: `near` (a Character, a prop / animal with a root,
   * a Vector3, [x, z] or {x, z}), else the selected character, else the view target.
   */
  function anchor(near) {
    if (near != null) {
      if (near.boneByName && near.root) return { x: near.root.position.x, z: near.root.position.z, ch: near };
      if (near.root?.position) return { x: near.root.position.x, z: near.root.position.z, ch: null };
      if (Array.isArray(near)) return { x: +near[0] || 0, z: +(near.length > 2 ? near[2] : near[1]) || 0, ch: null };
      if (Number.isFinite(near.x) && Number.isFinite(near.z)) return { x: near.x, z: near.z, ch: null };
    }
    const ch = app.selection.character;
    if (ch && ch.root.visible) return { x: ch.root.position.x, z: ch.root.position.z, ch };
    return { x: app.controls.target.x, z: app.controls.target.z, ch: null };
  }
  /** Unit vectors in the ground plane: "back" = away from the camera, "right" = screen right. */
  function viewAxes() {
    const c = app.camera.position, t = app.controls.target;
    let bx = t.x - c.x, bz = t.z - c.z;
    const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l;
    // snap to 15 degrees for tidy layouts
    const a = Math.round(Math.atan2(bx, bz) / (Math.PI / 12)) * (Math.PI / 12);
    return { bx: Math.sin(a), bz: Math.cos(a), yaw: a };
  }
  /** Distance behind the subject where a new road piece is centered (subject ends on its near sidewalk). */
  function roadBack(type, p) {
    const cw = ((p.lanes || 2) * (p.laneW || 3.25)) / 2, ww = p.walk === 'nessuno' ? 0 : (p.walkW || 2.4);
    if (type.id === 'es_rotonda') return p.size / 2 * 0.0 + (p.island + (p.ringLanes || 1) * (p.laneW || 3.25) + 0.6) + ww * 0.5 + 0.2;
    if (type.id === 'es_parcheggio') return (p.rows === 2 ? 16.6 : 11.6) / 2 + 0.8;
    if (type.id === 'es_ferrovia') return 3.5;
    if (['es_piazza', 'es_strisce', 'es_tombino', 'es_marciapiede'].includes(type.id)) return 0;
    if (type.id === 'es_vialetto') return 0;
    return cw + ww * 0.5 + 0.15;
  }

  /**
   * Adds an exterior item (road piece, vehicle, tree, furniture…) next to the
   * subject. opts: {near (see anchor()), commit = true, select = true, toast = true,
   * lift = true (roads: the subject steps onto the new sidewalk)}. Returns the prop.
   */
  function addItem(id, opts = {}) {
    const type = TYPE_BY_ID.get(id);
    if (!type || !props()) return null;
    const { commit = true, select = true, toast: tell = true, lift = true } = opts;
    const M = props();
    const a = anchor(opts.near);
    let p;
    if (type.road) {
      const params = defaultParams(type);
      if ('seed' in params) params.seed = newSeed();
      p = M.create({ type: id, params, color: type.color });
      // continue an existing road when one has a free end nearby
      const roads = M.props.filter((q) => q !== p && isRoad(q));
      let attached = false;
      if (type.connectors && roads.length) {
        let best = null, bd = 40;
        const kind = type.connectors(p.params)[0].kind || 'road';
        for (const q of roads) for (const c of freeConnectors(q, M.props)) {
          if (c.kind !== kind) continue;
          const d = Math.hypot(c.x - a.x, c.z - a.z);
          if (d < bd) { bd = d; best = { q, c }; }
        }
        if (best) {
          const n = type.connectors(p.params).length;
          const which = 0;
          const params2 = cleanParams(type, { ...p.params, ...xsecFrom(best.q, type) });
          p.params = params2; p.rebuild(true);
          matePlaceSafe(p, Math.min(which, n - 1), best.c);
          attached = true;
        }
      }
      if (!attached) {
        const { bx, bz, yaw } = viewAxes();
        const back = roadBack(type, p.params);
        // straight pieces run left-right in the view, crossing pieces are centered behind the subject
        const ryaw = type.id === 'es_strada' || type.id === 'es_ferrovia' || type.id === 'es_marciapiede' || type.id === 'es_curva' ? yaw + Math.PI / 2 : yaw;
        p.root.position.set(a.x + bx * back, 0, a.z + bz * back);
        p.root.rotation.set(0, type.id === 'es_strisce' || type.id === 'es_tombino' ? yaw : ryaw, 0, 'YXZ');
        if (type.onRoad) p.root.position.set(a.x + bx * 2, 0, a.z + bz * 2);
        p.root.position.y = baseY(p.root.position.x, p.root.position.z); // on a landscape: its ground
        // areas without connectors (parking, square): step back until they do not overlap other roads
        if (!type.connectors && !type.onRoad) {
          const mine = new THREE.Box3(), other = new THREE.Box3();
          for (let k = 0; k < 12; k++) {
            p.worldBox(mine);
            const hit = M.props.some((q) => q !== p && isGroundType(q.type) && q.worldBox(other).intersectsBox(mine.clone().expandByScalar(-0.3)));
            if (!hit) break;
            p.root.position.x += bx * 4; p.root.position.z += bz * 4;
          }
        }
      }
      M._meshesDirty = true;
      M._changed?.(p, 'list');
      if (a.ch && lift && back0(type)) liftCharacter(a.ch);
    } else if (type.vehicle) {
      const params = { ...defaultParams(type), seed: newSeed() };
      const same = M.props.filter((q) => q.type.id === id).length;
      const color = same ? pick(VEHICLE_COLORS.filter((c) => c !== type.color)) : type.color;
      p = M.create({ type: id, params, color });
      const { bx, bz, yaw } = viewAxes();
      let onRoad = false;
      if (hasRoads(M.props)) onRoad = placeOnRoad(M, p, a.x + bx * 4, a.z + bz * 4);
      if (!onRoad) {
        if (a.ch || opts.near == null) M._spawn?.(p, a.ch);
        else p.root.position.set(a.x, 0, a.z);
        p.root.rotation.set(0, yaw + Math.PI / 2, 0, 'YXZ'); // side view: nicer reference
        dropOnGround(p);
      }
      M._meshesDirty = true;
      M._changed?.(p, 'list');
    } else {
      p = M.add(id, { near: a.ch, select: false });
      if (!p) return null;
      if (p.type.params.some((d) => d.id === 'seed')) M.setParams(p, { seed: newSeed() });
      // big items (trees, terrain) go behind the subject rather than beside it
      const fr = p.footprintRadius();
      if (!a.ch && opts.near != null && fr <= 2.5) p.root.position.set(a.x, 0, a.z);
      if (fr > 2.5) {
        const { bx, bz } = viewAxes();
        const d = fr * (isGroundType(p.type) ? 0.85 : 0.9) + 0.6;
        p.root.position.set(a.x + bx * d, 0, a.z + bz * d);
      }
      if (isGroundType(p.type)) p.root.position.y = baseY(p.root.position.x, p.root.position.z);
      dropOnGround(p);
      M._changed?.(p);
    }
    if (select) M.select(p);
    if (commit) { haptic(12); app.commit('aggiungi esterno'); }
    if (tell) toast(`${type.label}: trascinalo per spostarlo`, 1600);
    return p;
  }
  const back0 = (type) => !['es_strisce', 'es_tombino', 'es_vialetto'].includes(type.id);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function xsecFrom(q, type) {
    const o = {};
    for (const d of type.params) if (['lanes', 'laneW', 'walk', 'walkW', 'pave', 'center'].includes(d.id) && d.id in q.params) o[d.id] = q.params[d.id];
    return o;
  }
  function matePlaceSafe(p, ci, c) {
    const cc = p.type.connectors(p.params)[ci];
    const yaw = wrap(c.yaw + Math.PI - cc.yaw), co = Math.cos(yaw), sn = Math.sin(yaw);
    p.root.rotation.set(0, yaw, 0, 'YXZ');
    p.root.position.set(c.x - (cc.x * co + cc.z * sn) * p.scale, c.y ?? 0, c.z - (-cc.x * sn + cc.z * co) * p.scale);
  }

  /** Adds a ready kit as a group of props around the subject. */
  async function addKit(kit) {
    const M = props();
    const a = anchor();
    const { yaw: vy } = viewAxes();
    const c = Math.cos(vy + Math.PI), s = Math.sin(vy + Math.PI); // kit +Z toward the camera
    const group = `k${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const created = [];
    let t0 = performance.now();
    const items = kit.items();
    // ground pieces first (so the rest can be dropped on them)
    items.sort((x, y) => (isGroundType(TYPE_BY_ID.get(y.type)) ? 1 : 0) - (isGroundType(TYPE_BY_ID.get(x.type)) ? 1 : 0));
    for (const it of items) {
      const type = TYPE_BY_ID.get(it.type);
      if (!type) continue;
      if (performance.now() - t0 > 14) { M._meshesDirty = true; M._changed?.(null, 'list'); await new Promise((r) => requestAnimationFrame(() => r())); t0 = performance.now(); }
      const params = cleanParams(type, { ...defaultParams(type), ...(it.params || {}) });
      const q = M.create({ type: it.type, params, color: it.color || type.color, group });
      const [lx, lz] = it.pos;
      q.root.position.set(a.x + lx * c + lz * s, 0, a.z - lx * s + lz * c);
      q.root.position.y = baseY(q.root.position.x, q.root.position.z); // landscape ground (ground pieces)
      q.root.rotation.set(0, wrap((it.yaw || 0) + vy + Math.PI), 0, 'YXZ');
      created.push(q);
    }
    const alive = created.filter((q) => M.props.includes(q));
    M._meshesDirty = true;
    for (const q of alive) dropOnGround(q);
    if (a.ch) liftCharacter(a.ch);
    M._changed?.(null, 'list');
    const first = alive.find((q) => !isGroundType(q.type)) || alive[0];
    if (first) M.select(first);
    app.commit('aggiungi kit');
    toast(`${kit.label}: ${alive.length} oggetti. Tocca un oggetto per modificarlo; “Muovi tutto il kit” sposta l’insieme.`, 3400);
    return alive;
  }

  function regenerate(p) {
    const M = props();
    if (p.type.params.some((d) => d.id === 'seed')) M.setParams(p, { seed: newSeed() });
    if (isVehicle(p)) M.setColor(p, pick(VEHICLE_COLORS.filter((c) => c !== p.color)));
    haptic('light');
    app.commit('rigenera');
  }
  function regenerateGroup(p) {
    const M = props();
    for (const q of M.groupOf(p)) {
      if (q.type.params.some((d) => d.id === 'seed')) M.setParams(q, { seed: newSeed() });
      if (isVehicle(q)) M.setColor(q, pick(VEHICLE_COLORS));
    }
    haptic('light');
    app.commit('rigenera kit');
  }

  // ------------------------------------------------------------ drag to move (tool active)
  let drag = null;
  const cv = app.canvas;
  const isActive = () => shell.activeToolId === 'exteriors';
  cv.addEventListener('pointerdown', (e) => {
    if (drag) { if (e.pointerId !== drag.id) e.stopImmediatePropagation(); return; }
    if (!isActive() || e.button > 0) return;
    const p = props()?.selected;
    if (!isCity(p) || p.hold) return;
    app.pointerToNDC(e, _ndc);
    const hit = props().pick(_ndc, { only: p });
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const rc = props().raycaster;
    rc.setFromCamera(_ndc, app.camera);
    _plane.set(_up, -hit.point.y);
    const grab = rc.ray.intersectPlane(_plane, new THREE.Vector3()) || hit.point.clone();
    drag = { id: e.pointerId, p, x0: e.clientX, y0: e.clientY, moved: false, planeY: hit.point.y, offset: p.root.position.clone().sub(grab), ctl: app.controls.enabled, raf: 0, lx: 0, ly: 0, snapped: null,
      rel: p.root.position.y - baseY(p.root.position.x, p.root.position.z),
      // over a landscape the finger follows the ground (the grabbed point's height above it)
      lift: app.landscapes?.hasTerrain && app.landscapes.rayGround ? hit.point.y - baseY(grab.x, grab.z) : null };
    app.controls.enabled = false;
  }, { capture: true });
  cv.addEventListener('pointermove', (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    e.stopImmediatePropagation();
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
    if (!d.moved) { d.moved = true; shell.hint(isRoad(d.p) && prefs.snap ? 'Trascina: le estremità si agganciano alle strade vicine' : 'Trascina per spostare'); }
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
    try { cv.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    shell.hint('');
    if (d.moved) {
      if (!isGroundType(d.p.type)) { const y0 = d.p.root.position.y; dropOnGround(d.p); if (d.p.root.position.y !== y0) props()._changed?.(d.p); }
      app.commit('sposta esterno');
    }
  };
  cv.addEventListener('pointerup', up, { capture: true });
  cv.addEventListener('pointercancel', up, { capture: true });
  function moveTo(d, x, y) {
    app.pointerToNDC({ clientX: x, clientY: y }, _ndc);
    const rc = props().raycaster;
    rc.setFromCamera(_ndc, app.camera);
    let q = d.lift != null ? app.landscapes.rayGround(rc.ray, d.lift, _v, 400) : null;
    if (!q) {
      _plane.set(_up, -d.planeY);
      q = rc.ray.intersectPlane(_plane, _v);
      if (!q || q.distanceTo(app.camera.position) > 1500) return;
    }
    const M = props(), p = d.p;
    const tx = q.x + d.offset.x, tz = q.z + d.offset.z;
    if (isRoad(p) && prefs.snap) {
      const yaw0 = p.root.rotation.y;
      p.root.position.x = tx; p.root.position.z = tz;
      const s = snapRoad(p, M.props);
      if (s) {
        const sx = p.root.position.x, sz = p.root.position.z, sy = p.root.rotation.y;
        p.root.position.x = tx; p.root.position.z = tz; p.root.rotation.y = yaw0;
        if (Math.abs(wrap(sy - yaw0)) > 1e-6) M.setYaw(p, sy);
        M.moveTo(p, sx, sz);
        if (!d.snapped) haptic('tick');
        d.snapped = s;
        return;
      }
      d.snapped = null;
      p.root.position.x = tx; p.root.position.z = tz;
    }
    M.moveTo(p, tx, tz);
    // over a landscape the item follows its ground (cheap analytic height; the exact
    // drop on roads / sidewalks happens on release)
    if (app.landscapes?.current) {
      const yN = baseY(tx, tz) + d.rel;
      if (Math.abs(yN - p.root.position.y) > 1e-5) M.setHeight(p, yN);
    }
  }

  // ------------------------------------------------------------ tool
  shell.registerTool({
    id: 'exteriors', label: 'Esterni', icon: 'tree', group: 'scene', order: 67, title: 'Esterni',
    build(el) {
      el.classList.add('pv-ct-panel');
      const strip = h('div', { class: 'pv-chips pv-ct-strip' });
      const catalog = buildCatalog();
      const editorHost = h('div', { class: 'pv-ct-editor' });
      el.append(strip, catalog.el, editorHost);
      let editor = null, shown = false, popBack = null;

      function renderStrip() {
        strip.innerHTML = '';
        const list = props()?.props.filter(isCity) || [];
        const sel = props()?.selected;
        const add = h('button', { type: 'button', class: 'pv-chip pv-ct-add' + (isCity(sel) ? '' : ' active') }, icon('plus', 18), 'Aggiungi');
        add.addEventListener('click', () => props().select(null));
        strip.appendChild(add);
        // kits collapse into one chip each (the selected piece is shown on its own)
        const seenGroups = new Set();
        let n = 0;
        for (const p of list) {
          if (p.group && p !== sel) {
            if (seenGroups.has(p.group)) continue;
            seenGroups.add(p.group);
            const members = list.filter((q) => q.group === p.group);
            const lead = members.find((q) => !isGroundType(q.type)) || members[0];
            const chip = h('button', { type: 'button', class: 'pv-chip' + (sel?.group === p.group ? ' active' : '') }, icon('layers', 16), `Kit (${members.length})`);
            chip.addEventListener('click', () => props().select(lead));
            strip.appendChild(chip);
            continue;
          }
          if (++n > 40) break;
          const chip = h('button', { type: 'button', class: 'pv-chip' + (p === sel ? ' active' : '') }, icon(p.type.vehicle ? 'car' : 'tree', 16), p.type.label);
          chip.addEventListener('click', () => props().select(p));
          strip.appendChild(chip);
        }
        strip.style.display = list.length ? '' : 'none';
      }

      function buildCatalog() {
        const wrapEl = h('div', { class: 'pv-ct-catalog' });
        const input = h('input', { type: 'search', class: 'pv-ct-search', placeholder: 'Cerca (es. auto, pino, semaforo)…', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false' });
        const note = h('div', { class: 'pv-ct-note' }, 'Tocca un elemento: compare vicino al personaggio selezionato. Le strade si collegano tra loro, i veicoli vanno sulla corsia più vicina.');
        let sub = 'kit', query = '';
        try { sub = localStorage.getItem('posaviva.city.sub') || 'kit'; } catch { /* ignore */ }
        const subChips = chips({ items: SUBS, value: sub, onSelect: (id) => { sub = id; subChips.setValue(id); try { localStorage.setItem('posaviva.city.sub', id); } catch { /* ignore */ } fill(); shell.panelBody.scrollTop = 0; } });
        subChips.classList.add('pv-ct-subs');
        const info = h('div', { class: 'pv-ct-note pv-ct-info' });
        const grid = h('div', { class: 'pv-cards pv-ct-grid', style: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } });
        wrapEl.append(note, input, subChips, info, grid);
        let timer = 0;
        input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { query = input.value.trim(); fill(); }, 150); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
        const io = typeof IntersectionObserver === 'function'
          ? new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) { thumbs.request(en.target); io.unobserve(en.target); } }, { root: shell.panelBody || null, rootMargin: '120px 0px' })
          : null;
        const lazy = (img) => { if (io) io.observe(img); else thumbs.request(img); return img; };
        const types = () => PROP_TYPES.filter((t) => t.cat === 'esterni');
        function card(t, kit = null) {
          const img = lazy(thumbs.imageFor(kit ? { ...kit, kit: true } : t));
          const badge = kit ? h('span', { class: 'pv-ct-badge' }, `${kit.items().length}`)
            : t.model ? h('span', { class: 'pv-ct-badge real', title: 'Modello realistico' }, '3D')
              : t.params?.some((d) => d.id === 'seed') ? h('span', { class: 'pv-ct-badge', title: 'Varianti casuali' }, '∞') : null;
          const c = h('button', { type: 'button', class: 'pv-card pv-ct-card' }, h('div', { class: 'pv-card-visual' }, img), h('span', { class: 'pv-card-label' }, kit ? kit.label : t.label), badge);
          c.addEventListener('click', () => { haptic(12); if (kit) addKit(kit); else addItem(t.id); });
          return c;
        }
        function fill() {
          if (io) io.disconnect();
          grid.innerHTML = '';
          const frag = document.createDocumentFragment();
          let n = 0;
          if (query) {
            const words = norm(query).split(/\s+/).filter(Boolean);
            for (const k of KITS) if (words.every((w) => norm(`${k.label} kit ${k.tags}`).includes(w))) { frag.appendChild(card(null, k)); n++; }
            for (const t of types()) {
              const subL = SUBS.find((s) => s.id === t.sub)?.label || '';
              if (words.every((w) => norm(`${t.label} ${t.tags || ''} ${subL}`).includes(w))) { frag.appendChild(card(t)); n++; }
            }
            info.textContent = n ? `${n} risultati per “${query}”` : `Nessun risultato per “${query}”.`;
          } else if (sub === 'kit') {
            for (const k of KITS) { frag.appendChild(card(null, k)); n++; }
            info.textContent = 'Scene pronte: ogni pezzo resta un oggetto che puoi spostare, modificare o eliminare.';
          } else {
            const list = types().filter((t) => t.sub === sub);
            // procedural first, realistic models after
            list.sort((x, y) => (x.model ? 1 : 0) - (y.model ? 1 : 0));
            for (const t of list) { frag.appendChild(card(t)); n++; }
            info.textContent = `${n} elementi · ∞ = varianti casuali con “Rigenera”, 3D = modello realistico`;
          }
          grid.appendChild(frag);
          subChips.style.display = query ? 'none' : '';
        }
        fill();
        return { el: wrapEl, refresh: fill };
      }

      // throttle heavy rebuilds while dragging sliders
      let pendingFn = null;
      function schedule(fn) {
        if (pendingFn) { pendingFn = fn; return; }
        pendingFn = fn;
        requestAnimationFrame(() => { const f = pendingFn; pendingFn = null; f?.(); });
      }

      function buildEditor(p) {
        const t = p.type, syncers = [], parts = [];
        const M = props();
        const commit = (label) => app.commit(label);
        const setP = (patch) => { M.setParams(p, patch); if (!isGroundType(t)) dropOnGround(p); };
        parts.push(h('div', { class: 'pv-ct-head' },
          h('div', { class: 'pv-ct-title' }, t.label),
          button({ icon: 'copy', small: true, title: 'Duplica', onClick: () => duplicate(p) }),
          button({ icon: 'trash', small: true, variant: 'danger', title: 'Elimina', onClick: () => { M.remove(p); commit('elimina esterno'); } }),
          button({ icon: 'check', small: true, title: 'Fine', onClick: () => M.select(null) })));
        if (t.model) {
          const loading = h('div', { class: 'pv-ct-note' }, 'Caricamento del modello…');
          parts.push(loading);
          syncers.push(() => { loading.style.display = p.loading ? '' : 'none'; });
        }
        // ---- Rigenera
        if (t.params.some((d) => d.id === 'seed') || t.vehicle) {
          const seedLbl = h('span', { class: 'pv-ct-seed' });
          parts.push(h('div', { class: 'pv-row pv-ct-regen' }, button({ label: 'Rigenera', icon: 'sparkle', variant: 'primary', onClick: () => regenerate(p) }), seedLbl));
          syncers.push(() => { seedLbl.textContent = t.vehicle ? 'Nuovo colore e dettagli' : `Variante n. ${p.params.seed}`; });
        }
        // ---- kit (group)
        if (p.group) {
          const n = M.groupOf(p).length;
          const together = toggle({ label: 'Muovi tutto il kit', value: M.moveTogether, onChange: (v) => { M.moveTogether = v; } });
          parts.push(section(`Kit (${n} oggetti)`, [
            h('div', { class: 'pv-ct-note' }, 'Con “Muovi tutto il kit” trascini o ruoti l’intera scena insieme.'),
            together,
            h('div', { class: 'pv-row pv-ct-actions' },
              button({ label: 'Nuove varianti', icon: 'sparkle', small: true, onClick: () => regenerateGroup(p) }),
              button({ label: 'Separa', icon: 'unlock', small: true, onClick: () => { M.ungroup(p); commit('separa'); editor = null; render(); } }),
              button({ label: 'Elimina kit', icon: 'trash', small: true, variant: 'danger', onClick: async () => {
                if (await confirmDialog(`Eliminare tutti i ${M.groupOf(p).length} oggetti del kit?`, { title: 'Elimina kit', okLabel: 'Elimina', danger: true })) { M.removeGroup(p); commit('elimina kit'); }
              } })),
          ]));
          syncers.push(() => together.setValue(M.moveTogether));
        }
        // ---- roads: connected pieces + snapping
        if (isRoad(p)) {
          const kind = t.connectors(p.params)[0].kind || 'road';
          const btn = (label, typeId, which = 0, extra = {}) => button({ label, small: true, onClick: () => {
            const q = attachPiece(M, p, typeId, { which, extra });
            if (!q) { toast('Nessuna estremità libera: sposta il pezzo o aggiungine uno nuovo'); return; }
            M._meshesDirty = true; M._changed?.(q, 'list'); M.select(q); haptic(12); commit('collega strada');
          } });
          const row = kind === 'road' ? [btn('Rettilineo', 'es_strada', 0, { crossing: false }), btn('Curva a sinistra', 'es_curva', 0), btn('Curva a destra', 'es_curva', 1), btn('Incrocio', 'es_incrocio'), btn('Incrocio a T', 'es_incrocio_t'), btn('Rotonda', 'es_rotonda')]
            : kind === 'rail' ? [btn('Binario', 'es_ferrovia')] : kind === 'walk' ? [btn('Marciapiede', 'es_marciapiede')] : [btn('Vialetto dritto', 'es_vialetto', 0, { bend: 0 }), btn('Vialetto curvo', 'es_vialetto', 0, { bend: 45 })];
          const freeInfo = h('div', { class: 'pv-ct-note' });
          const snapT = toggle({ label: 'Aggancio automatico', value: prefs.snap, onChange: (v) => { prefs.snap = v; } });
          parts.push(section('Collega un pezzo', [freeInfo, h('div', { class: 'pv-row pv-ct-actions wrap' }, ...row), snapT,
            h('div', { class: 'pv-row pv-ct-actions' }, button({ label: 'Aggancia ora', icon: 'magnet', small: true, onClick: () => {
              if (snapRoad(p, M.props, { maxDist: 6, maxAngle: 1.6 })) { M._changed?.(p); haptic('tick'); commit('aggancia strada'); } else toast('Nessuna strada vicina a cui agganciarsi');
            } }))]));
          syncers.push(() => { const f = freeConnectors(p, M.props).length, all = worldConnectors(p).length; freeInfo.textContent = f ? `Estremità libere: ${f} di ${all}. Il nuovo pezzo si attacca alla prima libera.` : 'Tutte le estremità sono collegate.'; });
        }
        // ---- vehicles
        if (isVehicle(p)) {
          parts.push(section('Strada', [h('div', { class: 'pv-row pv-ct-actions wrap' },
            button({ label: 'Metti sulla strada', icon: 'car', small: true, onClick: () => {
              if (placeOnRoad(M, p, p.root.position.x, p.root.position.z)) { dropOnGround(p); M._changed?.(p); commit('veicolo su strada'); } else toast('Aggiungi prima una strada (Strade) o un parcheggio');
            } }),
            button({ label: 'Parcheggia', icon: 'ground', small: true, onClick: () => {
              if (placeOnRoad(M, p, p.root.position.x, p.root.position.z, { preferSlots: true })) { M._changed?.(p); commit('parcheggia'); } else toast('Nessun parcheggio o strada nella scena');
            } }),
            button({ label: 'Inverti senso', icon: 'swap', small: true, onClick: () => { M.setYaw(p, p.yaw + Math.PI); commit('ruota veicolo'); } }))]));
        }
        // ---- parameters
        const ctl = new Map(), dims = [], looks = [];
        for (const d of t.params) {
          if (d.type === 'seed') continue;
          let c;
          if (d.type === 'seg') {
            const many = d.options.length > 3;
            const control = many
              ? chips({ items: d.options.map((o) => ({ id: String(o.value), label: o.label })), value: String(p.params[d.id]), onSelect: (v) => { const o = d.options.find((x) => String(x.value) === v); setP({ [d.id]: o.value }); control.setValue(v); commit('modifica esterno'); sync(); } })
              : segmented({ options: d.options, value: p.params[d.id], onChange: (v) => { setP({ [d.id]: v }); commit('modifica esterno'); sync(); } });
            if (many) control.classList.add('pv-ct-segchips');
            c = h('div', { class: 'pv-ct-field' }, h('div', { class: 'pv-ct-label' }, d.label), control);
            c.setValue = (v) => control.setValue(many ? String(v) : v);
            looks.push(c);
          } else if (d.type === 'toggle') {
            c = toggle({ label: d.label, value: p.params[d.id], onChange: (v) => { setP({ [d.id]: v }); commit('modifica esterno'); } });
            looks.push(c);
          } else {
            const fmt = d.type === 'int' ? (v) => String(Math.round(v)) : d.unit === 'm' ? fmtM : d.unit === '°' ? (v) => `${Math.round(v)}°` : (v) => `${Math.round(v * 100)}%`;
            c = slider({ label: d.label, min: d.min, max: d.max, step: d.step, value: p.params[d.id], defaultValue: d.default, center: d.min < 0 && d.max > 0, format: fmt,
              onInput: t.heavy ? undefined : (v) => schedule(() => setP({ [d.id]: v })),
              onChange: (v) => { if (t.heavy) setP({ [d.id]: v }); commit('modifica esterno'); } });
            dims.push(c);
          }
          ctl.set(d.id, c);
        }
        if (looks.length) parts.push(section('Forma e stile', looks));
        const scale = slider({ label: 'Scala', min: 0.25, max: 3, step: 0.01, value: p.scale, defaultValue: 1, center: false, format: (v) => `${Math.round(v * 100)}%`,
          onInput: (v) => props().setScale(p, v), onChange: () => commit('scala esterno') });
        dims.push(scale);
        parts.push(section('Dimensioni', dims));
        // ---- color
        if (!t.noColor) {
          const pal = t.model ? TINT_COLORS : PALETTES[t.palette] || PALETTES.metal;
          const sw = swatches({ colors: pal, value: p.color, onInput: (c) => M.setColor(p, c), onChange: (c) => { M.setColor(p, c); commit('colore esterno'); } });
          parts.push(section(t.model ? 'Tinta' : t.vehicle ? 'Colore carrozzeria' : t.palette === 'leaf' ? 'Colore del fogliame' : 'Colore', [sw]));
          syncers.push(() => sw.setValue(p.color));
        }
        // ---- placement
        const yaw = slider({ label: 'Rotazione', min: -180, max: 180, step: 1, value: p.yaw * R2D, defaultValue: 0, format: (v) => `${Math.round(v)}°`,
          onInput: (v) => M.setYaw(p, v * D2R), onChange: () => commit('ruota esterno') });
        const acts = [
          button({ label: '90°', icon: 'rotate', small: true, onClick: () => { M.setYaw(p, p.yaw + Math.PI / 2); if (isRoad(p) && prefs.snap) snapRoad(p, M.props); commit('ruota esterno'); } }),
          button({ label: 'Verso la camera', icon: 'camera', small: true, onClick: () => { const c = app.camera.position; M.setYaw(p, Math.atan2(c.x - p.root.position.x, c.z - p.root.position.z)); commit('ruota esterno'); } }),
        ];
        if (!isGroundType(t)) acts.push(button({ label: 'Appoggia', icon: 'ground', small: true, onClick: () => { dropOnGround(p); M._changed?.(p); commit('appoggia esterno'); } }));
        const chBtn = button({ label: 'Personaggio sopra', icon: 'person', small: true, onClick: () => {
          const ch = app.selection.character;
          if (!ch) { toast('Seleziona prima un personaggio'); return; }
          if (liftCharacter(ch)) { commit('appoggia personaggio'); toast(`${ch.name} appoggiato sulla superficie`, 1400); } else toast('Il personaggio è già appoggiato', 1200);
        } });
        parts.push(section('Posizione', [h('div', { class: 'pv-ct-note' }, isRoad(p) ? 'Trascina il pezzo con un dito: vicino a un’altra strada si aggancia da solo.' : 'Trascina con un dito per spostare.'), yaw,
          h('div', { class: 'pv-row pv-ct-actions wrap' }, ...acts, ...(isGroundType(t) ? [chBtn] : []))]));
        syncers.push(() => { yaw.setValue(p.yaw * R2D); scale.setValue(p.scale); for (const d of t.params) ctl.get(d.id)?.setValue?.(p.params[d.id]); });
        const root = h('div', {}, parts);
        function sync() { for (const s of syncers) s(); }
        sync();
        return { prop: p, el: root, sync };
      }

      function duplicate(p) {
        const M = props();
        const q = M.duplicate(p);
        if (!q) return;
        if (q.type.params.some((d) => d.id === 'seed')) M.setParams(q, { seed: newSeed() });
        if (isRoad(p)) {
          // continue the road from a free end
          const c = freeConnectors(p, M.props.filter((x) => x !== q))[0];
          if (c) { matePlaceSafe(q, Math.min(1, q.type.connectors(q.params).length - 1), c); M._changed?.(q); }
        } else if (isVehicle(p) && hasRoads(M.props)) {
          placeOnRoad(M, q, p.root.position.x, p.root.position.z);
          M._changed?.(q);
        }
        if (!isGroundType(q.type)) dropOnGround(q);
        M.select(q);
        app.commit('duplica esterno');
      }

      function render() {
        renderStrip();
        const p = props()?.selected;
        const ed = isCity(p) ? p : null;
        catalog.el.style.display = ed ? 'none' : '';
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
        const editing = shown && isCity(props()?.selected);
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

  return { addItem, addKit, regenerate, dropOnGround, liftCharacter, groundY, prefs };
}

export { Y_WALK };
