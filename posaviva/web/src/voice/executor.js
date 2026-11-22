// Executes a command plan (plan.js) on the real module APIs:
//   characters  app.addCharacter + app.clothing (outfit, colours) + app.hair + app.face + pose library
//   animals     app.animals.add + app.modules.animals.applyPreset
//   props       app.props.add (buildings: app.buildings.add, exteriors: app.city.addItem / addKit)
//   rooms       app.props.addPreset(ROOM_PRESETS[i])
//   landscapes  app.landscapes.generate / setAtmosphere (feature-detected)
//   camera      app.sceneTools.camera (quick angles, focal, framing), app.modules.focus
//   lights      app.lightRig.applyPreset
// Positions come from the spatial solver (spatial.js). The whole command is ONE
// undo step: it runs inside app.history.batch('comando vocale', …), which holds
// the modules' own commits and records a single step at the end.
import * as THREE from 'three';
import { E, boxOf, footprintOf, extentAlong, viewAxes, yawToward, yawToCamera, obstacles, roomAt, toRoom, fromRoom, clampToRoom, roomOpening, seatOf, topOf, findFree, isFlat, dependentsOf, isFreeAt } from './spatial.js';
import { characterBounds } from '../scene/bounds.js';
import { OUTFIT_SETS } from './vocab.js';
import { stem, norm } from './lexicon.js';

const SEAT_TYPES = /divan|poltron|sedi|sgabell|panc|pouf|dormeus|futon|trono|chair|stool|sofa|bench|letto|lett/;
const BED_TYPES = /^letto|futon|culla|ph_.*bed|dormeus/;
const FIXED_POSES = new Set(['lie_back', 'lie_front', 'lie_side']);
const CHAIR_POSES = /^sit_(chair|relaxed|legs_crossed|stool)$/;
const _box = new THREE.Box3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const TIME_LIGHT = { alba: 'sunset', mattino: 'studio', mezzogiorno: 'flat', tramonto: 'sunset', sera: 'sunset', notte: 'night', giorno: 'studio' };
const ANGLE_LABEL = { eye: 'altezza occhi', low: 'dal basso', high: 'dall\'alto', top: 'zenitale', front: 'frontale', threeq: '3/4', side: 'di profilo', back: 'da dietro' };
const REL_LABEL = { left: 'a sinistra di', right: 'a destra di', front: 'davanti a', behind: 'dietro a', beside: 'accanto a', near: 'vicino a', on: 'su', under: 'sotto', center: 'al centro', corner: 'nell\'angolo', wall: 'contro il muro', between: 'tra', around: 'intorno a', seat: 'seduto su', hand: 'in mano a', facing: 'di fronte a', in: 'in' };

export class Executor {
  constructor(app, lex, cat) {
    this.app = app; this.lex = lex; this.cat = cat;
    this.lib = null; // pose library (loaded on first use)
  }

  // ------------------------------------------------------------------ run
  /** Runs a normalized plan. Returns {done: [text], failed: [text], undoIndex, created: n}. */
  async run(plan, { label = 'comando vocale' } = {}) {
    const app = this.app;
    this.lib = this.lib || await import('../pose/library.js').catch(() => null);
    this.created = []; this.subjects = []; this.done = []; this.failed = []; this.added = [];
    this.cameraTouched = false; this.landscapeMade = false; this.lastCharacter = null;
    const hist = app.history;
    // trailing saves ("… e salva la scena") run after the step is recorded: they save
    // the finished scene, and the saved scene then counts as unchanged
    let tail = plan.actions.length;
    while (tail > 0 && plan.actions[tail - 1].type === 'project' && plan.actions[tail - 1].op === 'save') tail--;
    const step = async (i) => {
      const a = plan.actions[i];
      try { this.created[i] = (await this.exec(a, i)) || []; }
      catch (e) { console.error('[voice] action failed', a, e); this.failed.push(this.describeFail(a)); this.created[i] = []; }
    };
    // a landscape is generated around the characters: people and animals of the same command
    // come first, so it frames them, keeps its objects off them and puts them on its ground
    const order = [...Array(tail).keys()];
    const isLand = (i) => plan.actions[i].type === 'landscape' && !plan.actions[i].spec?.atmosphereOnly;
    const lastLiving = Math.max(-1, ...order.filter((i) => ['addCharacter', 'addAnimal'].includes(plan.actions[i].type)));
    const firstLand = order.find(isLand);
    if (firstLand !== undefined && lastLiving > firstLand) {
      const lands = order.filter(isLand);
      const rest = order.filter((i) => !isLand(i));
      rest.splice(rest.indexOf(lastLiving) + 1, 0, ...lands);
      order.splice(0, order.length, ...rest);
    }
    const body = async () => {
      for (const i of order) await step(i);
      if (!this.cameraTouched && !this.landscapeMade && this.added.length) this.frameNew();
      if (this.lastCharacter && app.characters.includes(this.lastCharacter)) app.select(this.lastCharacter);
      await this.settle();
    };
    // ONE undo step: the modules' own commits are held while the command runs
    const before = hist.index, top = hist.stack[hist.index];
    if (typeof hist.batch === 'function') await hist.batch(label, body);
    else await legacyBatch(app, label, body);
    app.invalidate();
    const recorded = hist.index !== before || hist.stack[hist.index] !== top;
    for (let i = tail; i < plan.actions.length; i++) await step(i);
    // a scene opened by the command resets the history: nothing to undo then
    return { done: this.done, failed: this.failed, undoIndex: recorded && hist.index > 0 ? hist.index : null, created: this.added.length };
  }

  /** Waits for camera tweens and pending builds (max ~2 s), so the snapshot is final. */
  async settle() {
    const cam = this.app.sceneTools?.camera;
    const t0 = performance.now();
    while (performance.now() - t0 < 2000) {
      const busy = cam?.animating || cam?.tween || this.app.landscapes?.busy;
      if (!busy) break;
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  async exec(a, i) {
    switch (a.type) {
      case 'addCharacter': return this.addCharacters(a, i);
      case 'addAnimal': return this.addAnimals(a, i);
      case 'addProp': return this.addProps(a, i);
      case 'addRoom': return this.addRoom(a);
      case 'landscape': return this.landscape(a);
      case 'modify': return this.modify(a, i);
      case 'camera': return this.camera(a);
      case 'lights': return this.lights(a);
      case 'remove': return this.remove(a);
      case 'project': return this.project(a);
      default: return [];
    }
  }

  describeFail(a) {
    const what = { addCharacter: 'il personaggio', addAnimal: 'l\'animale', addProp: a.query || a.propType || 'l\'oggetto', addRoom: 'la stanza', landscape: 'il paesaggio', modify: 'la modifica', camera: 'l\'inquadratura', lights: 'le luci', remove: 'la rimozione', project: a.op === 'save' ? 'il salvataggio' : 'l\'apertura' }[a.type];
    return `non sono riuscito a fare ${what}`;
  }

  // ------------------------------------------------------------------ targets
  /** Entities for a target: [{kind, obj}] (empty when nothing matches). */
  resolve(t, { all = false } = {}) {
    const app = this.app;
    if (!t) return [];
    const chars = () => app.characters.filter((c) => c.root.visible);
    const animals = () => app.animals?.animals || [];
    const props = () => (app.props?.props || []);
    switch (t.kind) {
      case 'new': return (this.created[t.index] || []).filter((e) => this.alive(e));
      case 'character': {
        let list = chars();
        if (t.id) { const c = list.find((x) => x.id === t.id); if (c && !t.all) return [E('character', c)]; }
        if (t.name) { const c = list.find((x) => norm(x.name) === norm(t.name)); if (c) return [E('character', c)]; }
        if (t.type === 'F' || t.type === 'M') list = list.filter((c) => c.sex === t.type);
        if (!list.length) return [];
        if (t.all || all) return list.map((c) => E('character', c));
        const sel = app.selection.character;
        return [E('character', pickOrd(list, t.ordinal, list.includes(sel) ? sel : null))];
      }
      case 'animal': {
        let list = animals();
        if (t.id) { const a = list.find((x) => x.id === t.id); if (a && !t.all) return [E('animal', a)]; }
        if (t.type) {
          const grp = t.type.startsWith('cane') && t.query && /^can/.test(norm(t.query)) ? 'cane_' : null;
          list = list.filter((a) => a.species === t.type || (grp && a.species.startsWith(grp)));
        } else if (t.query) list = list.filter((a) => stem(norm(a.entry.label).split(' ')[0]) === stem(norm(t.query).split(' ')[0]));
        if (!list.length) return [];
        if (t.all || all) return list.map((a) => E('animal', a));
        return [E('animal', pickOrd(list, t.ordinal, app.animals.selected))];
      }
      case 'prop': {
        let list = props().filter((p) => !p.hold);
        if (t.id) { const p = list.find((x) => x.id === t.id); if (p && !t.all) return [E('prop', p)]; }
        const qs = t.query ? stem(norm(t.query).split(/\s+/)[0]) : null;
        const ids = new Set();
        if (t.type) ids.add(t.type);
        if (t.query) for (const r of this.lex.rankProps(qs, [], {}).slice(0, 14)) ids.add(r.id);
        list = list.filter((p) => ids.has(p.type.id) || (p.type.variantOf && ids.has(p.type.variantOf)) || (qs && stem(norm(p.type.label).split(/\s+/)[0]) === qs));
        if (!list.length) return [];
        if (t.all || all) return list.map((p) => E('prop', p));
        // prefer the most recent (a room just added) / exact type
        const exact = list.filter((p) => p.type.id === t.type);
        return [E('prop', pickOrd(exact.length ? exact : list, t.ordinal, app.props.selected))];
      }
      case 'it': {
        const g = t.g;
        for (let k = this.subjects.length - 1; k >= 0; k--) {
          const e = this.subjects[k];
          if (!this.alive(e)) continue;
          if (!g || genderOfEntity(e) === g) return [e];
        }
        const sel = app.selection.character;
        if (sel && (!g || (g === 'f') === (sel.sex === 'F'))) return [E('character', sel)];
        const c = chars().filter((x) => !g || (g === 'f') === (x.sex === 'F')).pop();
        if (c) return [E('character', c)];
        if (app.animals?.selected) return [E('animal', app.animals.selected)];
        return [];
      }
      case 'selected': return app.selection.character ? [E('character', app.selection.character)] : [];
      case 'room': { const r = roomAt(app); return r ? [E('prop', r.prop)] : []; }
      case 'window': case 'door': {
        const id = t.kind === 'window' ? 'finestra' : 'porta';
        const p = props().filter((q) => q.type.id === id || stem(norm(q.type.label).split(' ')[0]) === stem(id)).pop();
        if (p) return [E('prop', p)];
        const r = roomAt(app);
        const pt = r && roomOpening(r, t.kind);
        return pt ? [{ kind: 'point', obj: null, point: pt, label: t.kind === 'window' ? 'la finestra' : 'la porta' }] : [];
      }
      case 'camera': return [{ kind: 'camera', obj: null }];
      case 'all': {
        const out = [];
        for (const p of props()) if (!p.hold) out.push(E('prop', p));
        for (const a of animals()) out.push(E('animal', a));
        return out;
      }
      default: return [];
    }
  }

  alive(e) {
    const app = this.app;
    if (e.kind === 'character') return app.characters.includes(e.obj);
    if (e.kind === 'animal') return !!app.animals?.animals.includes(e.obj);
    if (e.kind === 'prop') return !!app.props?.props.includes(e.obj);
    return true;
  }

  /** Point to look at / turn toward for a target entity. */
  pointOf(e, out = new THREE.Vector3()) {
    if (!e) return null;
    if (e.kind === 'point') return out.copy(e.point);
    if (e.kind === 'camera') return out.copy(this.app.camera.position);
    if (e.kind === 'character') { characterBounds(e.obj, _box, 0); out.set((_box.min.x + _box.max.x) / 2, _box.min.y + (_box.max.y - _box.min.y) * 0.9, (_box.min.z + _box.max.z) / 2); return out; }
    boxOf(e, _box);
    return _box.getCenter(out);
  }

  nameOf(e) {
    if (!e) return '';
    if (e.kind === 'character') return e.obj.name;
    if (e.kind === 'animal') return (e.obj.entry?.label || e.obj.name).toLowerCase();
    if (e.kind === 'prop') return e.obj.type.label.toLowerCase();
    if (e.kind === 'point') return e.label;
    if (e.kind === 'camera') return 'la camera';
    return '';
  }

  /** Creates a missing target (a definite "il divano" that is not in the scene). */
  async ensureTarget(t) {
    if (t?.entity) return [t.entity];
    let list = this.resolve(t);
    if (list.length || !t) return list;
    if (t.kind === 'prop' && (t.type || t.query)) {
      const created = await this.addProps({ type: 'addProp', propType: t.type || null, query: t.query, implicit: true }, -1);
      return created.slice(0, 1);
    }
    if (t.kind === 'animal' && t.type) return (await this.addAnimals({ type: 'addAnimal', species: t.type, implicit: true }, -1)).slice(0, 1);
    if (t.kind === 'character') return (await this.addCharacters({ type: 'addCharacter', sex: t.type === 'M' ? 'M' : 'F', implicit: true }, -1)).slice(0, 1);
    return list;
  }

  /** The reference point for things placed without a target: selected / last character, else the view center. */
  anchor() {
    const app = this.app;
    const c = this.lastCharacter || app.selection.character;
    if (c && app.characters.includes(c)) return { x: c.root.position.x, z: c.root.position.z, e: E('character', c) };
    return { x: app.controls.target.x, z: app.controls.target.z, e: null };
  }

  // ------------------------------------------------------------------ placement
  /**
   * Position (and yaw) for a new / moved thing `self` (entity, already created at
   * some spot) according to `place`. Applies it. Returns a short Italian phrase.
   */
  async place(self, place, { index = 0, count = 1, pose = null } = {}) {
    const app = this.app;
    const rel = place?.relation;
    const fp = footprintOf(self);
    const root = self.obj.root;
    const ignore = new Set([self.obj]);
    const isChar = self.kind === 'character';
    let targets = [];
    if (place?.target) targets = await this.ensureTarget(place.target);
    const T = targets[0] || null;
    if (T && T.obj) ignore.add(T.obj);
    // a moved table takes its cups, centerpiece, hanging lamp and chairs along
    const deps = self.kind === 'prop' && this.alive(self) && !this.added.includes(self) ? dependentsOf(app, self.obj) : [];
    for (const d of deps) ignore.add(d);
    const from = { x: root.position.x, z: root.position.z };
    const { rx, rz, fx, fz } = viewAxes(app);
    const anchor = this.anchor();
    const roomT = T?.kind === 'prop' && T.obj.type.id === 'stanza' ? roomAt(app, T.obj.root.position.x, T.obj.root.position.z) : null;
    const room = roomT || (T && T.kind !== 'point' ? roomAt(app, rootPos(T).x, rootPos(T).z) : roomAt(app, anchor.x, anchor.z)) || null;
    const inRoom = (r, x, z) => { const l = toRoom(r, x, z); return Math.abs(l.x) <= r.W / 2 + 0.01 && Math.abs(l.z) <= r.D / 2 + 0.01; };
    const useRoom = room && (!T || T.kind === 'point' || inRoom(room, rootPos(T).x, rootPos(T).z)) ? room : null;
    let x = root.position.x, z = root.position.z, y = null, yaw = null, desc = '';
    const setXZ = (p) => { x = p.x; z = p.z; };
    const free = (px, pz, dx, dz, extraIgnore) => {
      const ig = new Set(ignore); if (extraIgnore) ig.add(extraIgnore);
      const f = findFree(app, px, pz, fp, { ignore: ig, room: useRoom, dx, dz, avoid: this._reserved || [] });
      return f;
    };
    const dirFrom = (e) => {
      // a target's own front (+Z) in world
      const yw = e && e.obj ? e.obj.root.rotation.y : Math.atan2(fx, fz);
      return { x: Math.sin(yw), z: Math.cos(yw) };
    };
    const tfp = T && T.obj ? footprintOf(T) : null;
    const tc = tfp ? { x: tfp.cx, z: tfp.cz } : T?.kind === 'point' ? { x: T.point.x, z: T.point.z } : { x: anchor.x, z: anchor.z };
    const away = (dx, dz, gap = 0.12) => {
      const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
      const d = (tfp ? extentAlong(tfp, dx, dz) : 0.35) + extentAlong(fp, dx, dz) + gap;
      // several things on the same side stand side by side along that side
      const px = -dz, pz = dx;
      const off = count > 1 ? (index - (count - 1) / 2) * (2 * extentAlong(fp, px, pz) + 0.1) : 0;
      const f = free(tc.x + dx * d + px * off, tc.z + dz * d + pz * off, dx, dz);
      setXZ(f);
    };
    const seatType = self.kind === 'prop' && /sedi|sgabell|chair|stool|poltron|panca|divan/.test(self.obj.type.id);
    const tableT = T?.kind === 'prop' && (T.obj.type.cat === 'tavoli' || /tavol|scrivan|banc|cattedra|table|desk/.test(T.obj.type.id));
    switch (rel) {
      case 'left': case 'right': {
        const s = rel === 'left' ? -1 : 1;
        if (!T && useRoom) {
          // the left / right part of the room as seen from the camera
          const p = roomSide(useRoom, s * rx, s * rz, fp, index);
          setXZ(free(p.x, p.z, -s * rx, -s * rz));
        } else away(s * rx, s * rz, isChar || self.kind === 'animal' ? 0.25 : 0.12);
        desc = rel === 'left' ? 'a sinistra' : 'a destra';
        break;
      }
      case 'front': case 'behind': {
        const d = T ? dirFrom(T) : { x: fx, z: fz };
        const s = rel === 'front' ? 1 : -1;
        if (!T && useRoom) { const p = roomSide(useRoom, s * fx, s * fz, fp, index); setXZ(free(p.x, p.z)); }
        else away(s * d.x, s * d.z, rel === 'front' ? 0.35 : 0.2);
        desc = rel === 'front' ? 'davanti' : 'dietro';
        break;
      }
      case 'beside': case 'near': case 'facing': {
        if (rel === 'facing' && T) {
          const d = dirFrom(T);
          const dist = (tfp ? extentAlong(tfp, d.x, d.z) : 0.3) + extentAlong(fp, d.x, d.z) + 0.55;
          setXZ(free(tc.x + d.x * dist, tc.z + d.z * dist, d.x, d.z));
          yaw = yawToward(x, z, tc.x, tc.z);
          desc = 'di fronte';
          break;
        }
        // first free side: viewer's right, left, then front diagonals
        const gap = rel === 'near' ? 0.35 : isChar || self.kind === 'animal' ? 0.18 : 0.1;
        const sides = [[rx, rz], [-rx, -rz], [rx + fx, rz + fz], [-rx + fx, -rz + fz], [fx, fz], [-fx, -fz]];
        const order = index % 2 ? [1, 0, 3, 2, 4, 5] : [0, 1, 2, 3, 4, 5];
        let ok = false;
        const obs = obstacles(app, ignore);
        for (const k of order) {
          let [dx, dz] = sides[k];
          const n = Math.hypot(dx, dz); dx /= n; dz /= n;
          const d = (tfp ? extentAlong(tfp, dx, dz) : 0.35) + extentAlong(fp, dx, dz) + gap;
          let px = tc.x + dx * d, pz = tc.z + dz * d;
          if (useRoom) ({ x: px, z: pz } = clampToRoom(useRoom, px, pz, fp));
          const A = { ...fp, cx: px, cz: pz };
          if (!obs.some((o) => overlapFp(A, o.fp)) && !(this._reserved || []).some((f) => overlapFp(A, f))) { x = px; z = pz; ok = true; break; }
        }
        if (!ok) away(rx, rz, gap);
        desc = rel === 'near' ? 'vicino' : 'accanto';
        break;
      }
      case 'on': case 'seat': case 'in': {
        if (rel === 'in' && (!T || T.obj?.type?.id === 'stanza')) {
          const r = useRoom || roomAt(app);
          if (r) { const p = fromRoom(r, 0, r.D * 0.1); setXZ(free(p.x, p.z)); desc = 'nella stanza'; }
          break;
        }
        if (!T || T.kind !== 'prop') { if (T) away(rx, rz); break; }
        const tp = T.obj;
        const seatLike = SEAT_TYPES.test(tp.type.id) || SEAT_TYPES.test(norm(tp.type.label));
        const bedLike = BED_TYPES.test(tp.type.id) || /^letto/.test(norm(tp.type.label));
        // "seduta al tavolo": on a chair at that table (one is added when none is free)
        if (isChar && rel === 'seat' && tableT && !seatLike) { desc = await this.sitAtTable(self, T, pose, index); return desc; }
        if (isChar && (rel === 'seat' || (seatLike && pose && /^sit_/.test(pose)))) {
          desc = await this.seatCharacter(self.obj, tp, pose, index);
          return desc;
        }
        if (isChar && bedLike && pose && FIXED_POSES.has(pose)) { desc = await this.lieOn(self.obj, tp, pose); return desc; }
        // stand / lie on the top surface (animals on a bed, a vase on a table)
        const top = topOf(tp, { bed: bedLike });
        if (!top) { away(rx, rz); break; }
        const n = Math.max(1, count);
        const off = n > 1 ? ((index / (n - 1)) - 0.5) * Math.min(top.hx * 1.4, 0.35 * (n - 1)) : 0;
        const c = Math.cos(top.yaw), s = Math.sin(top.yaw);
        x = top.x + off * c; z = top.z - off * s;
        if (self.kind === 'prop') {
          root.position.set(x, top.y + 0.3, z);
          if (yaw === null) root.rotation.y = tp.root.rotation.y;
          app.props.ground(self.obj);
          app.props.moveTo(self.obj, x, z);
          return articleName(tp.type.label, 'su');
        }
        y = top.y;
        if (bedLike && self.kind === 'animal') { // animals on a bed: toward its foot, across it
          const lz = top.lcz + Math.min(top.hz * 0.5, 0.35);
          x = tp.root.position.x + top.lcx * c + lz * s + off * c; z = tp.root.position.z - top.lcx * s + lz * c - off * s;
        }
        desc = articleName(tp.type.label, 'su');
        break;
      }
      case 'under': {
        if (T) { x = tc.x + (count > 1 ? (index - (count - 1) / 2) * 0.4 : 0); z = tc.z; y = 0; }
        desc = 'sotto';
        break;
      }
      case 'center': {
        const r = useRoom || (T?.obj?.type?.id === 'stanza' ? roomAt(app) : null);
        let cx, cz;
        if (r) ({ x: cx, z: cz } = fromRoom(r, 0, r.D * 0.05));
        else if (T && T.obj && T.kind === 'prop') { cx = tc.x; cz = tc.z; }
        else { cx = app.controls.target.x; cz = app.controls.target.z; }
        // standing characters step aside afterwards: only furniture blocks the center
        for (const c of app.characters) if (!this.lib?.seatMark?.(c)) ignore.add(c);
        for (const a2 of app.animals?.animals || []) ignore.add(a2);
        setXZ(free(cx, cz));
        this._clearAfter = true;
        desc = 'al centro';
        break;
      }
      case 'corner': {
        const r = useRoom || roomAt(app);
        if (r) {
          const sx = place.side === 'left' ? -1 : place.side === 'right' ? 1 : (index % 2 ? -1 : 1);
          // the back corner on the requested side of the viewer (room local frame)
          const ex = extentAlong({ ...fp, yaw: fp.yaw - r.yaw }, 1, 0), ez = extentAlong({ ...fp, yaw: fp.yaw - r.yaw }, 0, 1);
          const lr = toRoom(r, r.cx + rx, r.cz + rz); // viewer's right in room axes
          const sideX = Math.sign(lr.x || 1) * sx;
          // from the corner along both walls (back wall toward the middle, side wall toward the front)
          const cxl = sideX * (r.W / 2 - ex - 0.08), czl = -r.D / 2 + ez + 0.08;
          const obs = obstacles(app, ignore);
          let hit = null;
          for (let st = 0; st <= 1.5 && !hit; st += 0.15) {
            for (const [lx, lz] of [[cxl - sideX * st, czl], [cxl, czl + st]]) {
              const w = fromRoom(r, lx, lz);
              if (isFreeAt(obs, fp, w.x, w.z, this._reserved || [])) { hit = w; break; }
            }
          }
          if (hit) setXZ(hit);
          else { const p = fromRoom(r, cxl, czl); setXZ(free(p.x, p.z, -sideX, 1)); }
          yaw = yawToward(x, z, r.cx, r.cz);
          yaw = Math.round(yaw / (Math.PI / 4)) * (Math.PI / 4);
        } else away(place.side === 'left' ? -rx - fx : rx - fx, place.side === 'left' ? -rz - fz : rz - fz, 1.2);
        desc = 'nell\'angolo';
        break;
      }
      case 'wall': {
        const r = useRoom || roomAt(app);
        if (r) {
          const ez = extentAlong({ ...fp, yaw: 0 }, 0, 1), ex = extentAlong({ ...fp, yaw: 0 }, 1, 0);
          const shift = count > 1 ? (index - (count - 1) / 2) * (fp.hx * 2 + 0.15) : 0;
          // along the back wall: the middle first, then sliding left / right
          const obs = obstacles(app, ignore);
          const lz = -r.D / 2 + ez + 0.04;
          let hit = null;
          for (let st = 0; st <= r.W / 2 && !hit; st += 0.2) {
            for (const sg of st ? [1, -1] : [1]) {
              const lx = shift + sg * st;
              if (Math.abs(lx) > r.W / 2 - ex - 0.05) continue;
              const w = fromRoom(r, lx, lz);
              if (isFreeAt(obs, { ...fp, yaw: r.yaw }, w.x, w.z, this._reserved || [])) { hit = w; break; }
            }
          }
          if (hit) setXZ(hit); else { const p = fromRoom(r, shift, lz); setXZ(free(p.x, p.z, 1, 0)); }
          yaw = r.yaw; // facing into the room
        } else {
          // no room: against the back, behind the subject, facing the camera
          const d = 1.4 + extentAlong(fp, fx, fz);
          setXZ(free(anchor.x - fx * d, anchor.z - fz * d));
          yaw = yawToCamera(app, x, z);
        }
        desc = 'contro il muro';
        break;
      }
      case 'between': {
        // "tra il tavolo e la finestra", or one plural target: "tra due lampade"
        let T1 = T, T2 = place.target2 ? (await this.ensureTarget(place.target2))[0] : null;
        if (!T2 && targets.length >= 2) { T1 = targets[0]; T2 = targets[1]; }
        if (T1 && T2 && T1.obj && T2.obj) {
          ignore.add(T2.obj);
          const a = rootPos(T1), b = rootPos(T2);
          let dx = b.x - a.x, dz = b.z - a.z;
          const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
          // two things made by this command step apart so the new one fits between them
          const need = extentAlong(fp, dx, dz) * 2 + extentAlong(footprintOf(T1), dx, dz) + extentAlong(footprintOf(T2), dx, dz) + 0.16;
          const mine = (e) => e.kind === 'prop' && this.added.some((q) => q.obj === e.obj);
          if (L < need && mine(T1) && mine(T2)) {
            const m = (need - L) / 2;
            app.props.moveTo(T1.obj, a.x - dx * m, a.z - dz * m);
            app.props.moveTo(T2.obj, b.x + dx * m, b.z + dz * m);
          }
          const a2 = rootPos(T1), b2 = rootPos(T2);
          setXZ(free((a2.x + b2.x) / 2, (a2.z + b2.z) / 2));
          if (self.kind === 'prop' && yaw === null) yaw = yawToCamera(app, x, z);
        } else if (T) away(rx, rz);
        desc = 'in mezzo';
        break;
      }
      case 'around': {
        if (!T) break;
        const n = Math.max(1, count);
        const R = Math.max(tfp ? Math.max(tfp.hx, tfp.hz) : 0.4, 0.3) + Math.max(fp.hx, fp.hz) + 0.12;
        // start on the side away from the camera, so the table stays visible
        const a0 = Math.atan2(-fx, -fz);
        const a = a0 + (index / n) * Math.PI * 2;
        // rectangular targets: push to the nearest side of the rectangle
        let px = tc.x + Math.sin(a) * R, pz = tc.z + Math.cos(a) * R;
        if (tfp) {
          const c = Math.cos(tfp.yaw), s = Math.sin(tfp.yaw);
          const lx = Math.sin(a - tfp.yaw), lz = Math.cos(a - tfp.yaw);
          const ax = Math.abs(lx) > Math.abs(lz);
          const ex = ax ? Math.sign(lx) * (tfp.hx + fp.hz + 0.08) : lx * (tfp.hx * 0.6);
          const ez = ax ? lz * (tfp.hz * 0.6) : Math.sign(lz) * (tfp.hz + fp.hz + 0.08);
          px = tc.x + ex * c + ez * s; pz = tc.z - ex * s + ez * c;
        }
        x = px; z = pz;
        yaw = yawToward(x, z, tc.x, tc.z);
        desc = 'intorno ' + (T.kind === 'prop' ? articleName(T.obj.type.label, 'a') : '');
        break;
      }
      case 'hand': {
        if (self.kind !== 'prop') break;
        const owner = T?.kind === 'character' ? T.obj : this.lastCharacter || app.selection.character;
        if (owner && self.obj.type.hand) {
          const side = app.props.freeHand(owner) || 'R';
          app.props.attach(self.obj, owner, side, { pose: true, emit: true });
          return 'in mano a ' + owner.name;
        }
        if (owner) { const a = rootPos(E('character', owner)); setXZ(free(a.x + rx * 0.5, a.z + rz * 0.5)); }
        break;
      }
      case 'row': default: {
        if (rel === 'row' || count > 1) {
          // side by side along the viewer's right
          const base = this._rowBase || (this._rowBase = { x: anchor.x, z: anchor.z });
          const w = fp.hx * 2 + 0.3;
          setXZ(free(base.x + rx * (index + 1) * w, base.z + rz * (index + 1) * w, rx, rz));
        }
        break;
      }
    }
    // chairs next to a table face it; chairs along a room side face into the room
    if (seatType && yaw === null && ['left', 'right', 'front', 'behind', 'beside', 'near'].includes(rel)) {
      if (tableT) yaw = yawToward(x, z, tc.x, tc.z);
      else if (!T && useRoom) { yaw = yawToward(x, z, useRoom.cx, useRoom.cz); yaw = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2); }
    }
    // apply
    if (self.kind === 'prop') {
      app.props.moveTo(self.obj, x, z);
      if (yaw !== null) app.props.setYaw(self.obj, yaw);
      if (y !== null) app.props.setHeight(self.obj, y); else if (!self.obj.type.spawnY) app.props.ground(self.obj);
      const dx = x - from.x, dz = z - from.z;
      for (const d of deps) app.props.moveTo(d, d.root.position.x + dx, d.root.position.z + dz);
      if (this._clearAfter) { this._clearAfter = false; this.clearCharacters([self.obj, ...deps]); }
    } else if (isChar) {
      const ch = self.obj;
      ch.setPlacement ? ch.setPlacement({ position: [x, y ?? (app.landscapes?.heightAt?.(x, z) || 0), z], rotationY: yaw ?? ch.root.rotation.y }) : ch.root.position.set(x, y ?? 0, z);
      if (pose && this.lib) this.lib.applyPosePreset(ch, pose); else ch.dropToGround?.();
    } else if (self.kind === 'animal') {
      root.position.set(x, y ?? (app.landscapes?.heightAt?.(x, z) || 0), z);
      if (yaw !== null) root.rotation.y = yaw;
      root.updateMatrixWorld(true);
    }
    const tname = T ? this.nameOf(T) : '';
    if (desc && tname && ['a sinistra', 'a destra', 'davanti', 'dietro', 'accanto', 'vicino', 'di fronte', 'sotto'].includes(desc)) desc += ' ' + linkTo(desc, tname);
    return desc;
  }

  /** Sits a character on a seat (sofa, chair, bench, stool, bed edge) at a free slot. */
  async seatCharacter(ch, p, pose, index = 0) {
    const app = this.app;
    const seat = seatOf(p, { bed: BED_TYPES.test(p.type.id) || /^letto/.test(norm(p.type.label)) });
    if (!seat) return '';
    // occupied slots (characters already seated there)
    const taken = app.characters.filter((c) => c !== ch).map((c) => c.root.position);
    let slot = seat.slots.find((s) => !taken.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 0.35));
    if (!slot) slot = seat.slots[index % seat.slots.length];
    const sofa = /divan|poltron|sofa|dormeus|pouf/.test(p.type.id + ' ' + norm(p.type.label));
    let id = pose && /^sit_/.test(pose) ? pose : 'sit_chair';
    if (id === 'sit_floor_cross' || id === 'sit_floor_hug') id = 'sit_chair';
    if (sofa && id === 'sit_chair') id = 'sit_relaxed';
    if (seat.h > 0.58 && id !== 'sit_stool') id = 'sit_stool';
    const floorY = p.root.position.y;
    ch.setPlacement({ position: [slot.x, floorY, slot.z], rotationY: seat.yaw });
    this.lib?.applyPosePreset(ch, id, { seat: seat.h });
    // hips onto the seat point (the pose moves the pelvis relative to the root)
    ch.root.updateWorldMatrix(true, true);
    const hl = ch.boneByName?.get('upperleg01.L'), hr = ch.boneByName?.get('upperleg01.R');
    if (hl && hr) {
      hl.updateWorldMatrix(true, false); hr.updateWorldMatrix(true, false);
      const a = _v.setFromMatrixPosition(hl.matrixWorld), b = _v2.setFromMatrixPosition(hr.matrixWorld);
      const hx = (a.x + b.x) / 2, hz = (a.z + b.z) / 2;
      ch.setPlacement({ position: [ch.root.position.x + slot.x - hx, floorY, ch.root.position.z + slot.z - hz], rotationY: seat.yaw });
    }
    return (ch.sex === 'F' ? 'seduta ' : 'seduto ') + articleName(p.type.label, 'su');
  }

  /** A character sits at a table: a free chair around it, else a new chair on its far side (facing it). */
  async sitAtTable(e, T, pose, index = 0) {
    const app = this.app, tp = T.obj;
    const tfp = footprintOf(T);
    const reach = Math.max(tfp.hx, tfp.hz) + 0.9;
    const taken = app.characters.filter((c) => c !== e.obj && this.lib?.seatMark?.(c)).map((c) => c.root.position);
    const cam = app.camera.position;
    const chairs = (app.props?.props || [])
      .filter((p) => p !== tp && !p.hold && /sedi|sgabell|chair|stool|panca|panchett/.test(p.type.id))
      .map((p) => ({ p, f: footprintOf(E('prop', p)) }))
      .filter(({ f }) => Math.hypot(f.cx - tfp.cx, f.cz - tfp.cz) < reach)
      .filter(({ f }) => !taken.some((q) => Math.hypot(q.x - f.cx, q.z - f.cz) < 0.45))
      // the chair farthest from the camera first: the character faces the viewer across the table
      .sort((a, b) => Math.hypot(b.f.cx - cam.x, b.f.cz - cam.z) - Math.hypot(a.f.cx - cam.x, a.f.cz - cam.z));
    let chair = chairs[0]?.p || null;
    if (!chair) {
      chair = app.props.add('sedia', { near: null, select: false });
      if (!chair) return '';
      const ce = E('prop', chair);
      this.added.push(ce);
      const { fx, fz, rx, rz } = viewAxes(app);
      const sides = [[-fx, -fz], [rx, rz], [-rx, -rz], [fx, fz]];
      const [dx, dz] = sides[index % sides.length];
      const d = extentAlong(tfp, dx, dz) + extentAlong(footprintOf(ce), dx, dz) * 0.6 + 0.05;
      const cx = tfp.cx + dx * d, cz = tfp.cz + dz * d;
      app.props.setYaw?.(chair, yawToward(cx, cz, tfp.cx, tfp.cz));
      app.props.moveTo(chair, cx, cz);
    }
    const w = await this.seatCharacter(e.obj, chair, pose, index);
    return w ? (e.obj.sex === 'F' ? 'seduta ' : 'seduto ') + articleName(tp.type.label, 'a') : '';
  }

  /**
   * "una donna seduta" with nothing to sit on: a chair (a stool for "Sgabello alto")
   * where the character stands, then the character sits on it.
   */
  async sitOnNewSeat(e, pose) {
    const app = this.app;
    if (!app.props) { this.lib?.applyPosePreset(e.obj, pose); return ''; }
    const ch = e.obj;
    const typeId = pose === 'sit_stool' ? 'sgabello' : 'sedia';
    const p = app.props.add(typeId, { near: null, select: false });
    if (!p) { this.lib?.applyPosePreset(ch, pose); return ''; }
    const yaw = ch.root.rotation.y;
    // the chair goes where the character is, facing the same way; the character keeps its spot
    app.props.setYaw(p, yaw);
    app.props.moveTo(p, ch.root.position.x - Math.sin(yaw) * 0.12, ch.root.position.z - Math.cos(yaw) * 0.12);
    app.props.ground(p);
    this.added.push(E('prop', p));
    this.done.push((genderNum(p.type.label).f ? 'Aggiunta anche ' : 'Aggiunto anche ') + indefName(p.type.label));
    return this.seatCharacter(ch, p, pose, 0);
  }

  /** Lays a character on a bed (head toward the headboard). */
  async lieOn(ch, p, pose) {
    const top = topOf(p, { bed: true });
    if (!top) return '';
    ch.setPlacement({ position: [top.x, top.y, top.z], rotationY: p.root.rotation.y });
    this.lib?.applyPosePreset(ch, pose);
    ch.root.updateWorldMatrix(true, true);
    const head = ch.boneByName?.get('head'), fl = ch.boneByName?.get('foot.L'), fr = ch.boneByName?.get('foot.R');
    if (head && fl && fr) {
      const H = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
      const F = new THREE.Vector3().setFromMatrixPosition(fl.matrixWorld).add(_v.setFromMatrixPosition(fr.matrixWorld)).multiplyScalar(0.5);
      // body axis feet -> head should point to the headboard (the bed's local -Z)
      const yawBody = Math.atan2(H.x - F.x, H.z - F.z);
      const want = Math.atan2(-Math.sin(p.root.rotation.y), -Math.cos(p.root.rotation.y));
      const ry = ch.root.rotation.y + (want - yawBody);
      ch.setPlacement({ position: [top.x, top.y, top.z], rotationY: ry });
      ch.root.updateWorldMatrix(true, true);
      const H2 = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
      const F2 = new THREE.Vector3().setFromMatrixPosition(fl.matrixWorld).add(_v.setFromMatrixPosition(fr.matrixWorld)).multiplyScalar(0.5);
      const mx = (H2.x + F2.x) / 2, mz = (H2.z + F2.z) / 2;
      ch.setPlacement({ position: [ch.root.position.x + top.x - mx, top.y, ch.root.position.z + top.z - mz], rotationY: ry });
      ch.dropToGround?.();
    }
    return (ch.sex === 'F' ? 'sdraiata ' : 'sdraiato ') + articleName(p.type.label, 'su');
  }

  /** Turns an entity toward a target (or the camera / a screen direction / away). */
  turnToward(e, t, { away = false } = {}) {
    const app = this.app;
    const r = e.obj.root;
    let yaw = null, label = '';
    if (away) { yaw = yawToCamera(app, r.position.x, r.position.z, false) + Math.PI; label = 'di spalle'; }
    else if (t?.kind === 'direction') {
      const { rx, rz, fx, fz } = viewAxes(app);
      const d = { left: [-rx, -rz], right: [rx, rz], front: [fx, fz], behind: [-fx, -fz] }[t.type] || [fx, fz];
      yaw = Math.atan2(d[0], d[1]);
      label = { left: 'verso sinistra', right: 'verso destra', front: 'verso di te', behind: 'di spalle' }[t.type] || '';
    } else {
      const tgt = t?.entity || this.resolve(t)[0];
      if (!tgt) return null;
      const p = this.pointOf(tgt, new THREE.Vector3());
      yaw = yawToward(r.position.x, r.position.z, p.x, p.z);
      label = 'verso ' + this.nameOf(tgt).replace(/^la camera$/, 'di te');
    }
    if (e.kind === 'character') e.obj.setPlacement ? e.obj.setPlacement({ rotationY: yaw }) : (r.rotation.y = yaw);
    else if (e.kind === 'prop') app.props.setYaw(e.obj, yaw);
    else { r.rotation.y = yaw; r.updateMatrixWorld(true); app.invalidate(); }
    return label;
  }

  lookAt(e, t) {
    if (e.kind !== 'character' || !this.app.face) return;
    if (t.kind === 'camera') { this.app.face.setLookAtCamera(e.obj, true); return; }
    const tgt = t.entity || this.resolve(t)[0];
    if (!tgt) return;
    this.app.face.setLookAtPoint(e.obj, this.pointOf(tgt, new THREE.Vector3()));
  }

  // ------------------------------------------------------------------ characters
  async addCharacters(a, i) {
    const app = this.app;
    const out = [];
    const n = a.count || 1;
    for (let k = 0; k < n; k++) {
      if (app.characters.length >= 8) { this.failed.push('massimo 8 personaggi nella scena'); break; }
      const body = a.bodyType || 'normal';
      const preset = (a.sex === 'M' ? 'm_' : 'f_') + body;
      if (!app.model.presetById?.get(preset)) continue;
      const people = app.modules.ui?.people;
      const name = a.name ? uniqueName(app, a.name) : people?.defaultName?.(a.sex) || undefined;
      // a free spot next to the anchor first (the relation below may move it)
      const an = this.anchor();
      const ch = app.addCharacter({ preset, name, position: [an.x, 0, an.z], rotationY: yawToCamera(app, an.x, an.z) });
      const e = E('character', ch);
      out.push(e);
      this.added.push(e);
      if (!a.place || a.place.relation === 'row') {
        const spot = people?.freeSpot ? people.freeSpot(new THREE.Vector3(an.x, 0, an.z), ch) : null;
        if (spot) ch.setPlacement({ position: [spot.x, 0, spot.z], rotationY: yawToCamera(app, spot.x, spot.z) });
      }
      this.dress(ch, a);
      if (a.hair && app.hair) app.hair.setStyle(ch, a.hair, false);
      if (a.expression && app.face) app.face.setPreset(ch, a.expression, false);
      const pose = a.pose || null;
      let where = '';
      if (a.place && a.place.relation !== 'row') where = await this.place(e, a.place, { index: k, count: n, pose });
      else if (pose && CHAIR_POSES.test(pose)) where = await this.sitOnNewSeat(e, pose);
      else if (pose && this.lib) this.lib.applyPosePreset(ch, pose);
      if (a.mutual && k === 1 && out[0]) {
        // two characters facing each other, side by side for the viewer
        const o = out[0].obj;
        const { rx, rz } = viewAxes(app);
        ch.setPlacement({ position: [o.root.position.x + rx * 1.1, 0, o.root.position.z + rz * 1.1] });
        this.turnToward(e, { entity: out[0] });
        this.turnToward(out[0], { entity: e });
        if (app.face) { this.lookAt(e, { entity: out[0] }); this.lookAt(out[0], { entity: e }); }
      }
      if (a.rotateTowards) this.turnToward(e, a.rotateTowards);
      if (a.turnAway) this.turnToward(e, null, { away: true });
      if (a.lookAt) this.lookAt(e, a.lookAt);
      if (a.size) ch.setSlider?.('height', a.size > 1 ? 0.8 : 0.2);
      // onto the ground under the feet (sidewalk, a landscape's hill or pier); the city
      // module leaves characters standing / lying on a support (bed, table) alone
      if (!this.lib?.seatMark?.(ch)) app.city?.liftCharacter?.(ch);
      this.subjects.push(e);
      this.lastCharacter = ch;
      this.done.push(this.describeCharacter(ch, a, where));
    }
    return out;
  }

  /** Outfit: quick set, single garments with colours, undress. */
  dress(ch, a) {
    const C = this.app.clothing;
    if (!C) return;
    const items = () => C.items(ch);
    if (a.outfitSet && OUTFIT_SETS[a.outfitSet]) {
      const set = OUTFIT_SETS[a.outfitSet][ch.sex] || OUTFIT_SETS[a.outfitSet].F;
      const keep = items().filter((x) => ['underwear', 'socks'].includes(x.id));
      C.setItems(ch, [...keep.map((x) => x), ...set.map((g) => (Array.isArray(g) ? g[0] : g))]);
      for (const g of set) if (Array.isArray(g)) C.update(ch, g[0], { color: g[1] });
    }
    for (const g of a.outfit || []) {
      const def = C.catalog?.GARMENTS?.find((x) => x.id === g.garment);
      if (def?.sex && def.sex !== ch.sex) continue;
      C.wear(ch, g.garment, g.color ? { color: g.color } : {});
    }
    if (a.undress === 'all') C.setItems(ch, ['underwear']);
    else if (a.undress === 'shoes') C.setItems(ch, items().filter((x) => !['sneakers', 'dressshoes', 'boots', 'socks'].includes(x.id)));
    else if (a.undress === 'top') C.setItems(ch, items().filter((x) => !['tshirt', 'tank', 'longsleeve', 'sweatshirt', 'trackjacket', 'shirt', 'blazer', 'sporttop', 'dress'].includes(x.id)));
  }

  describeCharacter(ch, a, where) {
    const bits = [];
    const G = this.app.clothing?.catalog?.GARMENTS || [];
    for (const g of (a.outfit || []).slice(0, 3)) {
      const lab = (G.find((x) => x.id === g.garment)?.label || g.garment).toLowerCase();
      bits.push(g.color ? `${lab} ${agree(colorName(g.color), lab)}` : lab);
    }
    const pl = this.cat.poses?.find((p) => p.id === a.pose);
    if (pl && !/^(sedut|sdraiat)/.test(where)) bits.push(pl.label.toLowerCase());
    const ex = this.cat.expressions?.find((p) => p.id === a.expression);
    if (ex) bits.push(ex.label.toLowerCase());
    if (where) bits.push(where);
    return `Aggiunt${ch.sex === 'F' ? 'a' : 'o'} ${ch.name}${bits.length ? ' (' + bits.join(', ') + ')' : ''}`;
  }

  // ------------------------------------------------------------------ animals
  async addAnimals(a, i) {
    const app = this.app;
    if (!app.animals) { this.failed.push('animali non disponibili'); return []; }
    const out = [];
    const n = a.count || 1;
    const entry = this.cat.animals?.find((s) => s.id === a.species);
    for (let k = 0; k < n; k++) {
      const an = this.anchor();
      const anim = await app.animals.add(a.species, { select: false, near: an.e?.obj || null });
      const e = E('animal', anim);
      out.push(e);
      this.added.push(e);
      let where = '';
      if (a.pose) {
        const ok = app.modules.animals?.applyPreset?.(anim, a.pose) || app.modules.animals?.applyPreset?.(anim, fallbackAnimalPose(a.pose, entry));
        void ok;
      }
      if (a.size) anim.setSize?.(a.size);
      if (a.color && anim.entry?.palettes?.length) anim.setPalette?.(nearestPalette(anim.entry.palettes, a.color));
      if (a.place) where = await this.place(e, a.place, { index: k, count: n });
      else if (an.e) { await this.place(e, { relation: 'beside', target: { entity: an.e } }, { index: k, count: n }); if (!a.rotateTowards) e.obj.root.rotation.y = yawToCamera(app, e.obj.root.position.x, e.obj.root.position.z, false) - Math.PI * 0.375; }
      else if (n > 1) where = await this.place(e, { relation: 'row' }, { index: k, count: n });
      if (a.rotateTowards) this.turnToward(e, a.rotateTowards);
      this.subjects.push(e);
      if (k === 0) { const fem = genderNum(entry?.label || a.species).f; this.done.push(`Aggiunt${n > 1 ? (fem ? 'e ' : 'i ') + n + ' × ' + (entry?.label || a.species).toLowerCase() : (fem ? 'a ' : 'o ') + indefName(entry?.label || a.species)}${where ? ' ' + where : ''}`); }
    }
    app.invalidate();
    return out;
  }

  // ------------------------------------------------------------------ props
  async addProps(a, i) {
    const app = this.app;
    if (!app.props) { this.failed.push('oggetti non disponibili'); return []; }
    if (a.kit) {
      const kit = app.city?.kits?.find((k) => k.id === a.kit);
      if (kit) { const list = await app.city.addKit(kit); this.done.push(`Aggiunto ${kit.label}`); return (list || []).map((p) => E('prop', p)); }
    }
    let typeId = a.propType && this.lex.propById.has(a.propType) ? a.propType : null;
    if (!typeId && a.query) typeId = this.lex.propForQuery(a.query, { hand: a.place?.relation === 'hand' });
    if (!typeId) { this.failed.push(`non conosco «${a.query || a.propType}»`); return []; }
    const type = this.lex.propById.get(typeId);
    const n = a.count || 1;
    const out = [];
    this._rowBase = null;
    for (let k = 0; k < n; k++) {
      let p;
      const building = type.cat === 'edifici';
      const exterior = !building && type.cat === 'esterni' && a.place?.relation !== 'hand';
      const near = this.lastCharacter || app.selection.character || null;
      if (building && app.buildings?.add) {
        // public API: fresh variant, behind the subject as seen from the camera (or placed below)
        p = app.buildings.add(typeId, { near, place: !a.place, commit: false, select: false, toast: false });
        if (!p) continue;
      } else if (building) {
        const t = (await import('../props/catalog.js')).TYPE_BY_ID.get(typeId);
        const params = {};
        for (const d of t.params || []) params[d.id] = d.default;
        if ('seed' in params) params.seed = 1 + Math.floor(Math.random() * 999999);
        p = app.props.create({ type: typeId, params, color: t.color }, { emit: true });
        if (!a.place && app.buildings?.placeBehind) app.buildings.placeBehind(p, near);
      } else if (exterior && app.city?.addItem) {
        // roads snap to the roads already there, vehicles go onto a lane, nature on the ground
        p = app.city.addItem(typeId, { near: a.place ? undefined : near || undefined, commit: false, select: false, toast: false });
        if (!p) continue;
      } else {
        const near = a.place ? null : (this.lastCharacter || app.selection.character || null);
        p = app.props.add(typeId, { near: a.place?.relation === 'hand' ? null : near, select: false });
        if (!p) continue;
        if (p.type.params.some((d) => d.id === 'seed') && n > 1) app.props.setParams(p, { seed: 1 + Math.floor(Math.random() * 999999) });
      }
      if (a.color) app.props.setColor(p, a.color);
      if (a.size) app.props.setScale(p, a.size);
      const e = E('prop', p);
      out.push(e);
      this.added.push(e);
      let where = '';
      if (a.place) where = await this.place(e, a.place, { index: k, count: n });
      else if (n > 1 && !building) where = await this.place(e, { relation: 'row' }, { index: k, count: n });
      if (!building && type.cat === 'esterni' && !p.hold) app.city?.dropOnGround?.(p);
      if (a.rotateTowards) this.turnToward(e, a.rotateTowards);
      if (k === 0) this.lastWhere = where;
    }
    this._rowBase = null;
    const fem = genderNum(type.label).f;
    if (out.length) this.done.push(`${n > 1 ? (fem ? 'Aggiunte' : 'Aggiunti') : fem ? 'Aggiunta' : 'Aggiunto'}${a.implicit ? ' anche' : ''} ${n > 1 ? n + ' × ' + type.label.toLowerCase() : indefName(type.label)}${a.color ? ' ' + agree(colorName(a.color), type.label) : ''}${this.lastWhere ? ' ' + this.lastWhere : ''}`);
    app.invalidate();
    return out;
  }

  // ------------------------------------------------------------------ rooms & landscapes
  async addRoom(a) {
    const app = this.app;
    const { ROOM_PRESETS } = await import('../props/gen/rooms.js');
    const preset = ROOM_PRESETS.find((r) => r.id === a.preset);
    if (!preset || !app.props) return [];
    const near = this.lastCharacter || app.selection.character || null;
    const list = await app.props.addPreset(preset, { near, select: false });
    // characters inside the furniture step to a free floor spot of the room
    this.clearCharacters(list);
    this.done.push(`Stanza: ${preset.label.toLowerCase()} (${list.length} oggetti)`);
    this.added.push(...list.filter((p) => p.type.id === 'stanza').map((p) => E('prop', p)));
    return list.map((p) => E('prop', p));
  }

  /** Moves standing characters that ended up inside furniture to the nearest free spot. */
  clearCharacters(props) {
    const app = this.app;
    for (const ch of app.characters) {
      if (this.lib?.seatMark?.(ch)) continue;
      const fp = footprintOf(E('character', ch));
      const obs = obstacles(app, new Set([ch])).filter((o) => o.obj.isProp !== false && props.includes(o.obj));
      if (!obs.some((o) => overlapFp(fp, o.fp))) continue;
      const room = roomAt(app, ch.root.position.x, ch.root.position.z);
      const f = findFree(app, ch.root.position.x, ch.root.position.z, fp, { ignore: new Set([ch]), room });
      ch.setPlacement({ position: [f.x, ch.root.position.y, f.z] });
    }
  }

  async landscape(a) {
    const app = this.app;
    const L = app.landscapes;
    const spec = { ...a.spec };
    if (L && spec.atmosphereOnly) {
      if (L.current) { L.setAtmosphere({ time: spec.time, weather: spec.weather, season: spec.season }); this.done.push('Atmosfera: ' + [spec.time, spec.weather, spec.season].filter(Boolean).join(', ')); return []; }
    }
    delete spec.atmosphereOnly;
    if (L?.generate) {
      this.landscapeMade = true;
      const r = await L.generate(spec);
      const label = L.presets?.find((p) => p.id === (r?.spec?.preset || spec.preset))?.label || spec.place || 'paesaggio';
      const extra = [spec.time, spec.weather, spec.season].filter(Boolean).join(', ');
      this.done.push(`Paesaggio: ${label.toLowerCase()}${extra ? ' (' + extra + ')' : ''}`);
      return [];
    }
    // without the landscapes module: a ready kit of the exteriors + the light of the time of day
    const kits = app.city?.kits || [];
    const want = /strad|citt|incroc|vicol/.test(norm(spec.preset || spec.place || '')) ? 'kit_incrocio' : /bosc|forest|pinet/.test(norm(spec.preset || spec.place || '')) ? 'kit_bosco' : /parc|prat|giardin/.test(norm(spec.preset || spec.place || '')) ? 'kit_parco' : null;
    const kit = kits.find((k) => k.id === want);
    if (kit) { await app.city.addKit(kit); this.done.push(`Aggiunto ${kit.label}`); }
    else this.failed.push('paesaggi non disponibili');
    if (spec.time) await this.lights({ time: spec.time });
    return [];
  }

  // ------------------------------------------------------------------ projects (app.projects)
  /**
   * Save into / open from the Progetti archive. Saving changes nothing in the scene
   * (no undo step of its own); a landscape, character or pose applied from the archive
   * joins the command's undo step; a scene opened from it replaces the scene (asking
   * about unsaved changes) and starts a new history.
   */
  async project(a) {
    const app = this.app, P = app.projects;
    if (!P?.saveItem) { this.failed.push('i Progetti non sono disponibili'); return []; }
    await P.ready;
    const TYPE = { scene: 'scena', landscape: 'paesaggio', character: 'personaggio', pose: 'posa' };
    try {
      if (a.op === 'browse') {
        const proj = a.project ? findByName(P.list(), a.project) : null;
        P.open?.({ projectId: proj?.id, type: a.what, query: a.query || (a.project && !proj ? a.project : undefined) });
        this.done.push(proj ? `Aperto il progetto «${proj.name}»` : a.query ? `Cerco «${a.query}» nei Progetti` : 'Aperti i Progetti');
        this.cameraTouched = true;
        return [];
      }
      if (a.op === 'save') {
        const what = a.what || 'scene';
        let ch = null;
        if (what === 'character' || what === 'pose') {
          ch = a.target ? this.resolve(a.target).find((e) => e.kind === 'character')?.obj : null;
          ch ||= (this.lastCharacter && app.characters.includes(this.lastCharacter) ? this.lastCharacter : null) || app.selection.character || app.characters[0] || null;
          if (!ch) { this.failed.push('non c\'è nessun personaggio da salvare'); return []; }
        }
        if (what === 'landscape' && !app.landscapes?.current && !(app.props?.props || []).length) { this.failed.push('non c\'è nessun paesaggio da salvare'); return []; }
        await this.settle();
        // finished outfits and hair in the thumbnail
        await Promise.race([app.clothing?.whenIdle?.() || null, new Promise((r) => setTimeout(r, 5000))]);
        const where = await this.projectPlace(P, a);
        const item = await P.saveItem({ type: what, name: a.name, character: ch || undefined, ...where.ids });
        const pj = P.get?.(item.projectId)?.name || where.projectName || '';
        const sec = item.sectionId ? P.section?.(item.sectionId)?.name : '';
        const fem = what === 'scene' || what === 'pose';
        this.done.push(`Salvat${fem ? 'a' : 'o'} ${fem ? 'la' : 'il'} ${TYPE[what]} «${item.name}»${pj ? ' in ' + pj : ''}${sec ? ' › ' + sec : ''}${where.created.length ? ' (creat' + (where.created.length > 1 ? 'i ' : 'o ') + where.created.join(' e ') + ')' : ''}`);
        return [];
      }
      // open / apply / insert
      const hits = P.find({ text: a.name, type: a.what });
      const n = norm(a.name);
      const it = hits.find((h) => norm(h.name) === n) || hits.find((h) => norm(h.name).startsWith(n)) || hits[0];
      if (!it) { this.failed.push(`non trovo ${a.what ? TYPE[a.what] + ' ' : ''}«${a.name}» nei Progetti`); return []; }
      let ch = null;
      if (it.type === 'pose') {
        ch = a.target ? this.resolve(a.target).find((e) => e.kind === 'character')?.obj : null;
        ch ||= (this.lastCharacter && app.characters.includes(this.lastCharacter) ? this.lastCharacter : null) || app.selection.character || null;
        if (!ch) { this.failed.push('nessun personaggio a cui applicare la posa'); return []; }
      }
      const before = new Set(app.characters);
      const r = await P.loadItem(it.id, ch ? { character: ch } : {});
      if (r && r.ok === false) { this.failed.push(`apertura di «${it.name}» annullata`); return []; }
      if (it.type === 'scene') {
        this.done.push(`Aperta la scena «${it.name}»`);
        this.cameraTouched = true; this.landscapeMade = true; this.lastCharacter = null;
        this.created = []; this.subjects = []; this.added = [];
        return [];
      }
      if (it.type === 'landscape') { this.landscapeMade = true; this.done.push(`Applicato il paesaggio «${it.name}»`); return []; }
      if (it.type === 'character') {
        const nc = r?.character || app.characters.find((c) => !before.has(c));
        if (!nc) { this.done.push(`Inserito il personaggio «${it.name}»`); return []; }
        const e = E('character', nc);
        this.added.push(e); this.subjects.push(e); this.lastCharacter = nc;
        this.cameraTouched = true; // the projects module frames it
        this.done.push(`Inserito il personaggio «${it.name}»`);
        return [e];
      }
      if (it.type === 'pose') {
        const e = E('character', ch);
        this.subjects.push(e); this.lastCharacter = ch;
        this.done.push(`Applicata la posa «${it.name}» a ${ch.name}`);
        return [e];
      }
      return [];
    } catch (e) {
      console.warn('[voice] projects', e);
      this.failed.push(cap1(e?.message || 'operazione sui Progetti non riuscita'));
      return [];
    }
  }

  /** Project / section of a save: found by name, else created. -> {ids: {projectId, sectionId}, created, projectName} */
  async projectPlace(P, a) {
    const created = [];
    let proj = null;
    if (a.project) {
      proj = findByName(P.list(), a.project);
      if (!proj) { proj = await P.create(cap1(a.project)); created.push(`il progetto «${proj.name}»`); }
    }
    const pid = proj?.id || P.current?.id || null;
    let sec = null;
    if (a.section && pid) {
      const secs = P.sections(pid) || [];
      sec = findByName(secs, a.section) || (a.sectionKind && /^\d+$/.test(a.section.split(' ').pop()) ? secs.find((s) => s.kind === a.sectionKind && norm(s.name).endsWith(' ' + a.section.split(' ').pop())) : null);
      if (!sec) { sec = await P.createSection(pid, cap1(a.section), a.sectionKind || 'tavola'); created.push(`la sezione «${sec.name}»`); }
    }
    const ids = {};
    if (proj) ids.projectId = proj.id;
    if (sec) { ids.projectId = pid; ids.sectionId = sec.id; }
    return { ids, created, projectName: proj?.name };
  }

  // ------------------------------------------------------------------ modify / remove
  async modify(a, i) {
    const app = this.app;
    let list = this.resolve(a.target);
    if (!list.length && ['character', 'animal', 'prop'].includes(a.target.kind)) list = await this.ensureTarget(a.target);
    if (!list.length) { this.failed.push(`non trovo ${targetLabel(a.target)}`); return []; }
    const bits = [];
    let k = 0;
    for (const e of list) {
      if (e.kind === 'character') {
        const ch = e.obj;
        if (a.outfit || a.undress) this.dress(ch, a);
        if (a.hair && app.hair) app.hair.setStyle(ch, a.hair, false);
        if (a.expression && app.face) app.face.setPreset(ch, a.expression, false);
        if (a.place) { const w = await this.place(e, a.place, { index: k, count: list.length, pose: a.pose || null }); if (w) bits.push(w); }
        else if (a.pose && CHAIR_POSES.test(a.pose) && !this.lib?.seatMark?.(ch)) { const w = await this.sitOnNewSeat(e, a.pose); if (w) bits.push(w); }
        else if (a.pose && this.lib) this.lib.applyPosePreset(ch, a.pose);
        this.lastCharacter = ch;
      } else if (e.kind === 'animal') {
        if (a.pose) app.modules.animals?.applyPreset?.(e.obj, a.pose) || app.modules.animals?.applyPreset?.(e.obj, fallbackAnimalPose(a.pose, this.cat.animals?.find((s) => s.id === e.obj.species)));
        if (a.size) e.obj.setSize?.(a.size);
        if (a.place) { const w = await this.place(e, a.place, { index: k, count: list.length }); if (w) bits.push(w); }
      } else if (e.kind === 'prop') {
        if (a.color) app.props.setColor(e.obj, a.color);
        if (a.size) app.props.setScale(e.obj, e.obj.scale * a.size);
        if (a.place) { const w = await this.place(e, a.place, { index: k, count: list.length }); if (w) bits.push(w); }
      }
      if (a.rotateTowards) { const w = this.turnToward(e, a.rotateTowards); if (w) bits.push(w); }
      if (a.turnAway) bits.push(this.turnToward(e, null, { away: true }));
      if (a.turn) {
        const r = e.obj.root;
        const yaw = r.rotation.y + (a.turn * Math.PI) / 180;
        if (e.kind === 'character') e.obj.setPlacement({ rotationY: yaw }); else if (e.kind === 'prop') app.props.setYaw(e.obj, yaw); else r.rotation.y = yaw;
        bits.push(`girato di ${Math.round(a.turn)}°`);
      }
      if (a.lookAt) this.lookAt(e, a.lookAt);
      this.subjects.push(e);
      k++;
    }
    const who = list.length > 1 ? `${list.length} × ${this.nameOf(list[0])}` : cap1(this.nameOf(list[0]));
    const what = [];
    if (a.pose) what.push((this.cat.poses?.find((p) => p.id === a.pose)?.label || a.pose).toLowerCase());
    if (a.expression) what.push((this.cat.expressions?.find((p) => p.id === a.expression)?.label || a.expression).toLowerCase());
    if (a.outfit) what.push(a.outfit.map((g) => { const lab = (this.app.clothing?.catalog?.GARMENTS?.find((x) => x.id === g.garment)?.label || g.garment).toLowerCase(); return lab + (g.color ? ' ' + agree(colorName(g.color), lab) : ''); }).join(', '));
    if (a.color) what.push(agree(colorName(a.color), this.nameOf(list[0])));
    if (a.hair) what.push('capelli');
    if (a.lookAt && !a.rotateTowards) what.push('sguardo');
    this.done.push(`${who}: ${[...what, ...bits].filter(Boolean).join(', ') || 'modificato'}`);
    app.invalidate();
    return list;
  }

  async remove(a) {
    const app = this.app;
    const t = a.target;
    if (t.kind === 'all' && t.type === 'landscape') { if (app.landscapes?.current) { app.landscapes.clear({ commit: false }); this.done.push('Tolto il paesaggio'); } else this.failed.push('non c\'è nessun paesaggio'); return []; }
    let list = this.resolve(t, { all: !!t.all });
    if (t.kind === 'room') {
      const r = roomAt(app);
      if (!r) { this.failed.push('non c\'è nessuna stanza'); return []; }
      const n = app.props.groupOf(r.prop).length;
      app.props.removeGroup(r.prop);
      this.done.push(`Tolta la stanza (${n} oggetti)`);
      return [];
    }
    if (!list.length) { this.failed.push(`non trovo ${targetLabel(t)}`); return []; }
    if (t.kind === 'all' && app.landscapes?.current) app.landscapes.clear({ commit: false });
    list = list.filter((e) => this.alive(e));
    const names = new Map();
    for (const e of list) {
      const nm = this.nameOf(e);
      names.set(nm, (names.get(nm) || 0) + 1);
      if (e.kind === 'character') app.removeCharacter(e.obj);
      else if (e.kind === 'animal') app.animals.remove(e.obj);
      else if (e.kind === 'prop' && app.props.props.includes(e.obj)) app.props.remove(e.obj);
    }
    this.done.push('Tolto: ' + [...names].map(([n, c]) => (c > 1 ? `${c} × ${n.toLowerCase()}` : n.toLowerCase())).join(', '));
    app.invalidate();
    return [];
  }

  // ------------------------------------------------------------------ camera & lights
  async camera(a) {
    const app = this.app;
    const cam = app.sceneTools?.camera;
    this.cameraTouched = true;
    let subject = a.target ? this.resolve(a.target)[0] : null;
    if (subject?.kind === 'character') app.select(subject.obj);
    const bits = [];
    if (a.framing === 'all') { this.frameEntities(this.everything(), { animate: true }); bits.push('tutta la scena'); }
    if (a.focal && cam) { cam.setFocal(a.focal, { keepFraming: true, animate: true, commit: false }); bits.push(`obiettivo ${a.focal} mm`); await waitTween(cam); }
    if (a.angle && cam) {
      if (subject && subject.kind !== 'character') this.frameEntities([subject], { animate: false });
      cam.quickAngle(a.angle);
      bits.push(ANGLE_LABEL[a.angle] || a.angle);
      await waitTween(cam);
    }
    const ch = subject?.kind === 'character' ? subject.obj : app.selection.character;
    if (a.framing === 'face' || a.framing === 'hand') {
      if (ch && app.modules.focus?.focus) { app.modules.focus.focus(ch, a.framing === 'face' ? 'head' : 'hand.R'); bits.push(a.framing === 'face' ? `primo piano di ${ch.name}` : `mano di ${ch.name}`); }
      else this.failed.push('nessun personaggio da inquadrare');
    } else if (a.framing === 'body' || a.framing === 'subject') {
      if (subject && subject.kind !== 'character') this.frameEntities([subject], { animate: true });
      else if (ch && cam) { app.select(ch); cam.frameSubject({ animate: true, commit: false }); }
      bits.push(`inquadra ${subject ? this.nameOf(subject) : ch?.name || 'la scena'}`);
    }
    if (bits.length) this.done.push('Camera: ' + bits.join(', '));
    return [];
  }

  async lights(a) {
    const app = this.app;
    const rig = app.lightRig;
    if (a.time && app.landscapes?.current && app.landscapes.setAtmosphere) {
      app.landscapes.setAtmosphere({ time: a.time });
      this.done.push(`Atmosfera: ${a.time}`);
      if (!a.preset) return [];
    }
    const id = a.preset || TIME_LIGHT[a.time] || 'studio';
    if (!rig?.applyPreset) { this.failed.push('luci non disponibili'); return []; }
    rig.applyPreset(id);
    this.done.push(`Luci: ${(this.cat.lights?.find((l) => l.id === id)?.label || id).toLowerCase()}`);
    return [];
  }

  // ------------------------------------------------------------------ framing
  everything() {
    const app = this.app, out = [];
    for (const c of app.characters) if (c.root.visible) out.push(E('character', c));
    for (const a of app.animals?.animals || []) out.push(E('animal', a));
    for (const p of app.props?.props || []) if (!p.hold && !isFlat(p) && p.type.cat !== 'edifici' && p.footprintRadius() < 6) out.push(E('prop', p));
    return out;
  }

  /** Frames the new things (with the selected character) when some are out of view. */
  frameNew() {
    const app = this.app;
    const list = this.added.filter((e) => this.alive(e) && !(e.kind === 'prop' && (isFlat(e.obj) && e.obj.type.id !== 'stanza')));
    if (!list.length) return;
    const cam = app.camera;
    cam.updateMatrixWorld();
    const proj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const out = list.some((e) => {
      boxOf(e, _box);
      for (let k = 0; k < 8; k++) {
        _v.set(k & 1 ? _box.max.x : _box.min.x, k & 2 ? _box.max.y : _box.min.y, k & 4 ? _box.max.z : _box.min.z).applyMatrix4(proj);
        if (Math.abs(_v.x) > 0.98 || Math.abs(_v.y) > 0.98 || _v.z > 1) return true;
      }
      return false;
    });
    if (!out) return;
    const sel = app.selection.character;
    const all = [...list];
    if (sel && !list.some((e) => e.obj === sel)) all.push(E('character', sel));
    this.frameEntities(all, { animate: true });
  }

  /** Animated framing of a set of entities, keeping the view direction (applyView: no commit). */
  frameEntities(list, { animate = true } = {}) {
    const app = this.app, cam = app.camera, rig = app.sceneTools?.camera;
    const box = new THREE.Box3();
    for (const e of list) { if (e.kind === 'prop' && e.obj.type.id === 'stanza') { e.obj.worldBox(_box); _box.max.y = Math.min(_box.max.y, 2.2); box.union(_box); } else box.union(boxOf(e, _box)); }
    if (box.isEmpty()) return;
    const C = box.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3().subVectors(cam.position, app.controls.target).normalize();
    const q = cam.quaternion.clone().invert();
    const focal = rig?.focal || cam.getFocalLength();
    const tanY = (cam.filmGauge / (2 * focal * Math.max(cam.aspect, 1))), tanX = tanY * cam.aspect;
    let d = 0.5;
    for (let k = 0; k < 8; k++) {
      _v.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).sub(C).applyQuaternion(q);
      d = Math.max(d, Math.abs(_v.x) / (0.86 * tanX) + _v.z, Math.abs(_v.y) / (0.86 * tanY) + _v.z);
    }
    d = Math.min(d, 120);
    const P = C.clone().addScaledVector(dir, d);
    if (P.y < 0.15) P.y = 0.15;
    const view = { p: P.toArray(), t: C.toArray(), f: focal, r: rig?.roll || 0 };
    if (rig?.applyView) rig.applyView(view, { animate, commit: null });
    else { app.controls.target.copy(C); cam.position.copy(P); app.controls.update(); app.invalidate(); }
  }
}

// ------------------------------------------------------------------ helpers
/** Coat palette whose base colour is closest to a hex colour ("un gatto nero"). */
/**
 * Older cores without app.history.batch: hold the modules' commits by shadowing
 * history.push while the command runs, then record one step.
 */
async function legacyBatch(app, label, fn) {
  const hist = app.history;
  const hadOwn = Object.prototype.hasOwnProperty.call(hist, 'push');
  const ownPush = hist.push;
  hist.push = () => {};
  try { await fn(); } finally { if (hadOwn) hist.push = ownPush; else delete hist.push; app.commit(label); }
}

/** Entry of `list` ({name}) whose name matches `name` (exact, then prefix, then contains), accent-insensitive. */
function findByName(list, name) {
  const n = norm(name).trim();
  if (!n) return null;
  return list.find((x) => norm(x.name) === n) || list.find((x) => norm(x.name).startsWith(n)) || list.find((x) => norm(x.name).includes(n)) || null;
}

function nearestPalette(pals, hex) {
  const rgb = (h) => { const n = parseInt(String(h).replace('#', '').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const [r, g, b] = rgb(hex);
  let best = pals[0].id, bd = Infinity;
  for (const p of pals) { const c = p.colors?.base; if (!c) continue; const [r2, g2, b2] = rgb(c); const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2; if (d < bd) { bd = d; best = p.id; } }
  return best;
}
const cap1 = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
function pickOrd(list, ord, prefer) {
  if (ord === -1) return list[list.length - 1];
  if (ord > 0 && list[ord - 1]) return list[ord - 1];
  return prefer && list.includes(prefer) ? prefer : list[list.length - 1];
}
function rootPos(e) { return e.obj ? e.obj.root.position : e.point; }
function genderOfEntity(e) {
  if (e.kind === 'character') return e.obj.sex === 'F' ? 'f' : 'm';
  const lab = norm(e.kind === 'animal' ? e.obj.entry?.label || '' : e.obj.type?.label || '');
  return /a$/.test(lab.split(' ')[0]) ? 'f' : 'm';
}
function overlapFp(A, B) {
  // local import-free copy of spatial.overlap with a small margin
  const axes = [[Math.cos(A.yaw), -Math.sin(A.yaw)], [Math.sin(A.yaw), Math.cos(A.yaw)], [Math.cos(B.yaw), -Math.sin(B.yaw)], [Math.sin(B.yaw), Math.cos(B.yaw)]];
  const dx = B.cx - A.cx, dz = B.cz - A.cz;
  for (const [ax, az] of axes) if (Math.abs(dx * ax + dz * az) >= extentAlong(A, ax, az) + extentAlong(B, ax, az) + 0.03) return false;
  return true;
}
/** A spot in the part of the room toward a world direction (dx, dz): left / right / front / back. */
function roomSide(r, dx, dz, fp, index = 0) {
  const l = toRoom(r, r.cx + dx, r.cz + dz); // direction in room axes
  const ax = Math.abs(l.x) >= Math.abs(l.z);
  const ex = extentAlong({ ...fp, yaw: fp.yaw - r.yaw }, 1, 0), ez = extentAlong({ ...fp, yaw: fp.yaw - r.yaw }, 0, 1);
  let lx, lz;
  if (ax) { lx = Math.sign(l.x) * (r.W / 2 - ex - 0.35); lz = r.D * 0.05 + (index % 2 ? -1 : 1) * Math.ceil(index / 2) * (ez * 2 + 0.2); }
  else { lz = Math.sign(l.z) * (r.D / 2 - ez - 0.35); lx = (index % 2 ? -1 : 1) * Math.ceil(index / 2) * (ex * 2 + 0.2); }
  return fromRoom(r, lx, lz);
}
async function waitTween(cam) {
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 30));
  while ((cam.animating || cam.tween) && performance.now() - t0 < 1500) await new Promise((r) => setTimeout(r, 40));
}
function fallbackAnimalPose(id, entry) {
  const have = new Set((entry?.poses || []).map((p) => p.id));
  const alt = { sleep: ['lie', 'rest', 'sit'], lie: ['rest', 'sit', 'sleep'], sit: ['rest', 'lie', 'perch'], run: ['flyup', 'swim', 'slither', 'walk'], walk: ['run', 'swim', 'slither'], jump: ['flyup', 'run'], attack: ['roar', 'strike', 'call'], play: ['run', 'jump'], flyup: ['spread', 'run'] }[id] || [];
  return alt.find((x) => have.has(x)) || null;
}
function uniqueName(app, base) {
  const taken = new Set(app.characters.map((c) => c.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}
/** Gender / number of an Italian noun phrase (first word). */
function genderNum(label) {
  const w = norm(label).split(/[\s/]+/)[0];
  const INV_F = new Set(['tv', 'radio', 'moto', 'bici', 'foto', 'auto', 'mano']);
  const INV_M = new Set(['wc', 'bidet', 'pc', 'monitor', 'computer', 'laptop', 'futon', 'pouf', 'cactus', 'ficus', 'skateboard', 'top', 'jeans', 'intimo', 'bar', 'set']);
  const PL = /^(jeans|pantaloni|shorts|leggings|sneakers|scarpe|stivali|calzini|banchi|tende|mensole|panini|banane|pere|cuscini|candelabri|occhiali|cacciaviti|pinze|tronchesi|scatolette|calici|cartoline|penne|blocchi)$/;
  const pl = PL.test(w);
  let f;
  if (INV_F.has(w)) f = true; else if (INV_M.has(w)) f = false;
  else if (/^(t-?shirt|tshirt)$/.test(w)) f = true;
  else if (pl) f = /e$/.test(w) && !/^(sneakers)$/.test(w) || w === 'sneakers';
  else f = /a$/.test(w) || /(ione|zione|trice|ice)$/.test(w) && !/^(camion|leone|bastione)$/.test(w);
  return { f, pl, w };
}
/** "il divano", "la sedia", "l'armadio", "lo sgabello" (+ articulated: su -> sul, a -> al, di -> del). */
function articleName(label, prep = '') {
  const { f, pl, w } = genderNum(label);
  const l = label.toLowerCase();
  const vowel = /^[aeiou]/.test(w), s_imp = /^(s[bcdfgklmnpqrstvz]|z|gn|ps|x|y)/.test(w);
  let art = pl ? (f ? 'le' : vowel || s_imp ? 'gli' : 'i') : vowel ? 'l\'' : f ? 'la' : s_imp ? 'lo' : 'il';
  const P = { su: 'su', al: 'a', a: 'a', di: 'di' }[prep] || '';
  if (P) {
    const pre = { su: 'su', a: 'a', di: 'de' }[P];
    const map = { il: pre + 'l', lo: pre + 'llo', la: pre + 'lla', 'l\'': pre + 'll\'', i: pre + 'i', gli: pre + 'gli', le: pre + 'lle' };
    art = map[art] || art;
    if (P === 'di' && art.startsWith('de')) art = art.replace(/^de/, 'de');
  }
  return art.endsWith('\'') ? art + l : art + ' ' + l;
}
/** "un divano", "una sedia", "uno sgabello", "un'auto", "2 × sedie". */
function indefName(label) {
  const { f, w, pl } = genderNum(label);
  if (pl) return (f ? 'delle ' : /^[aeiou]|^(s[bcdfgklmnpqrstvz]|z|gn|ps)/.test(w) ? 'degli ' : 'dei ') + label.toLowerCase();
  const l = label.toLowerCase();
  const vowel = /^[aeiou]/.test(w), s_imp = /^(s[bcdfgklmnpqrstvz]|z|gn|ps|x|y)/.test(w);
  if (f) return (vowel ? 'un\'' : 'una ') + l;
  return (s_imp ? 'uno ' : 'un ') + l;
}
/** Colour adjective agreeing with a noun ("t-shirt bianca", "jeans neri"). */
function agree(color, label) {
  const { f, pl } = genderNum(label);
  if (/^(blu|rosa|viola|beige|bordeaux|oro|argento|blu scuro|lilla|crema|panna)$/.test(color)) return color;
  if (/e$/.test(color)) return pl ? color.replace(/e$/, 'i') : color; // verde / marrone / arancione
  const stemC = color.replace(/[oa]$/, '');
  if (color.endsWith('io')) return stemC.replace(/i$/, '') + (pl ? (f ? 'ie' : 'i') : f ? 'ia' : 'io');
  const suf = pl ? (f ? 'e' : 'i') : f ? 'a' : 'o';
  return stemC + (/[cg]$/.test(stemC) && /^[ei]/.test(suf) ? 'h' : '') + suf;
}
function linkTo(desc, name) {
  if (/^[A-Z]/.test(name) && !/^(La|Il|Lo|L')\b/.test(name)) {
    const prep = desc.startsWith('a sinistra') || desc.startsWith('a destra') ? 'di' : 'a';
    return prep + ' ' + name;
  }
  const prep = desc.startsWith('a sinistra') || desc.startsWith('a destra') ? 'di' : 'a';
  return articleName(name, prep);
}
function targetLabel(t) {
  if (!t) return 'il soggetto';
  if (t.kind === 'character') return t.type === 'M' ? 'un uomo' : t.type === 'F' ? 'una donna' : 'il personaggio';
  if (t.kind === 'animal') return t.query || t.type || 'l\'animale';
  if (t.kind === 'prop') return t.query || t.type || 'l\'oggetto';
  if (t.kind === 'window') return 'una finestra';
  if (t.kind === 'door') return 'una porta';
  if (t.kind === 'room') return 'una stanza';
  return 'il soggetto';
}
const COLOR_NAMES = [['#f2f1ec', 'bianco'], ['#1c1c1f', 'nero'], ['#86888c', 'grigio'], ['#c0392b', 'rosso'], ['#e88aa8', 'rosa'], ['#e67e22', 'arancione'], ['#f1c40f', 'giallo'], ['#c9a227', 'oro'], ['#d8c3a5', 'beige'], ['#6b4423', 'marrone'], ['#2e8b57', 'verde'], ['#5dade2', 'azzurro'], ['#2c4f9e', 'blu'], ['#1f2a44', 'blu scuro'], ['#6a3a9e', 'viola'], ['#6d1a24', 'bordeaux'], ['#c0c4c8', 'argento']];
export function colorName(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  let best = '', bd = Infinity;
  for (const [h, name] of COLOR_NAMES) { const m = parseInt(h.slice(1), 16); const d = ((m >> 16 & 255) - r) ** 2 + ((m >> 8 & 255) - g) ** 2 + ((m & 255) - b) ** 2; if (d < bd) { bd = d; best = name; } }
  return best;
}
