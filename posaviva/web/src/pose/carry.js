// Long press on a character (app.addHoldHandler, priority 60):
//  - where: with Tocco diretto posing the press (no panel, Posa, Mani) only the trunk carries
//    (Busto, Addome, Bacino). A long press on a limb, the neck or the head is a careful pose
//    drag (a finger / S Pen resting to aim before pulling): moving afterwards poses that part
//    (direct.dragFrom), releasing still opens the character menu. Where touch does not pose
//    (another panel, Sposta, Tocco diretto off) any part of the body carries.
//  - the character lifts a little (and a shadow ring marks its spot on the floor); sliding
//    the finger carries it over the ground (landscape terrain followed, props and other
//    characters it was not already touching are not walked into), a second finger turns
//    it; releasing drops it (one undo step).
//  - contacts on the floor (the feet it stands on) travel with it, contacts on props or
//    other characters stay and the limbs reach back to them; one that cannot be reached
//    any more is let go when the character is dropped. Props held in the hands come along.
//  - released without moving: a menu at the finger (Seleziona e posa, Duplica, Specchia
//    posa, Appoggia a terra, Ruota di 45°, Primo piano, Elimina).
import * as THREE from 'three';
import { haptic, stageMenu, toast } from '../ui/kit.js';
import { EFFECTOR_LABEL } from './contacts.js';

const LIFT = 0.05; // m (scaled)
const FOOT_R = 0.17; // footprint radius (m, scaled)
/** px a limb long press must then travel before it becomes a pose drag (as a carry starts moving) */
const LIMB_SLOP = 8;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _n = new THREE.Vector3();
const _box = new THREE.Box3();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane();
const _rc = new THREE.Raycaster();
const DIRS = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(Math.cos((i * Math.PI) / 4), 0, Math.sin((i * Math.PI) / 4)));

export class CharacterCarry {
  constructor(ctx) {
    this.ctx = ctx;
    this.app = ctx.app;
    this.shell = ctx.shell;
    this.d = null;
    this._deco = (g, project) => this._draw(g, project);
    this.app.addHoldHandler((t) => this._hold(t), 60);
    const c = this.app.canvas;
    // second finger: turns the carried character
    c.addEventListener('pointerdown', (e) => this._down2(e), { capture: true });
    c.addEventListener('pointermove', (e) => this._move2(e), { capture: true });
    const up2 = (e) => { const d = this.d; if (d?.rot && e.pointerId === d.rot.id) d.rot = null; };
    window.addEventListener('pointerup', up2, true);
    window.addEventListener('pointercancel', up2, true);
  }

  get active() { return !!this.d; }

  _hold({ ndc, x, y, x0, y0, t0, event }) {
    if (this.d) return false;
    const { app, ctx } = this;
    if (event && event.pointerType === 'mouse' && event.button > 0) return false;
    const hit = ctx.picker.pick(ndc);
    if (!hit) return false;
    // an object in front of the body: its own long press (objects, priority 50)
    const pp = app.props?.pick?.(ndc, { occlusion: false });
    if (pp && pp.distance < hit.distance - 0.01) return false;
    // Tocco diretto: a limb held still is a pose drag about to start, only the trunk carries
    const limb = event && ctx.direct?.holdPoses?.(event);
    if (limb) return this._limbHold(limb, x, y, x0 ?? x, y0 ?? y, t0 ?? event.timeStamp);
    ctx.direct?.cancelPress();
    ctx.direct?.closeMenu();
    return this._begin(hit.character, hit, x, y, event?.pointerId);
  }

  /**
   * Long press on a limb (Tocco diretto): nothing lifts. Moving on poses the part as if the
   * press had moved at once (measured from where it started); released still, the character
   * menu opens (as for a carry released without moving).
   */
  _limbHold(hit, x, y, x0, y0, t0) {
    const { ctx, shell } = this;
    const ch = hit.character;
    ctx.direct.closeMenu();
    shell.hint('Trascina per posare · il busto sposta il personaggio');
    let done = false;
    return {
      move: (e) => {
        if (done || Math.hypot(e.clientX - x, e.clientY - y) < LIMB_SLOP) return;
        done = true;
        shell.hint('');
        ctx.direct.dragFrom({ id: e.pointerId, x0, y0, t0, hit, type: e.pointerType }, e);
      },
      end: (e, cancelled) => {
        if (done) return;
        done = true;
        shell.hint('');
        if (!cancelled && this.app.characters.includes(ch)) this.openMenu(ch, x, y);
      },
    };
  }

  // ------------------------------------------------------------ session
  _begin(ch, hit, x, y, pointerId) {
    const { app, ctx } = this;
    const s = ch.root.scale.y || 1;
    if (app.selection.character !== ch) app.select(ch, null);
    ch.root.updateMatrixWorld(true);
    const pos = ch.root.position;
    const pelvis = ctx.rig.worldPos(ch, 0, new THREE.Vector3());
    const d = {
      ch, id: pointerId, x0: x, y0: y, lx: x, ly: y, raf: 0, moved: false, rotated: false,
      startPos: pos.clone(), startYaw: ch.root.rotation.y, lift: LIFT * s,
      pins0: JSON.stringify(ch.data?.pose?.pins || null),
      cOff: new THREE.Vector3(pelvis.x - pos.x, 0, pelvis.z - pos.z),
      base: pos.clone(), yaw: ch.root.rotation.y, r: FOOT_R * s,
    };
    d.rel = pos.y - ctx.floorAt(pos.x, pos.z);
    d.onGround = Math.abs(pos.y - ctx.groundAt(pos.x, pos.z)) < 0.03;
    // drag plane: horizontal through the touched point (the point stays under the finger);
    // seen edge-on (camera at that height): screen mapping instead
    const ray = this._ray(x, y);
    d.planeY = hit.point.y;
    d.screen = Math.abs(ray.direction.y) < 0.12;
    if (!d.screen) {
      _plane.set(_n.set(0, 1, 0), -d.planeY);
      d.grab = ray.intersectPlane(_plane, new THREE.Vector3());
      if (!d.grab) d.screen = true;
    }
    if (d.screen) {
      d.wpp = this._wpp(hit.point);
      d.right = new THREE.Vector3().setFromMatrixColumn(app.camera.matrixWorld, 0); d.right.y = 0; d.right.normalize();
      d.fwd = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d.right).normalize();
    }
    d.obstacles = this._obstacles(ch, d);
    this.d = d;
    // lift (the floor contacts come along)
    ctx.contacts.carry(ch, () => { pos.y += d.lift; ch.root.updateMatrixWorld(true); });
    ctx.placed(ch);
    ctx.contacts.decorators.add(this._deco);
    this.shell.hint('Trascina per spostarlo · un secondo dito lo ruota');
    app.invalidate();
    return { move: (e) => this._move(e), end: (e, cancelled) => this._end(e, cancelled) };
  }

  _ray(x, y) {
    const app = this.app;
    app.pointerToNDC({ clientX: x, clientY: y }, _ndc);
    app.camera.updateMatrixWorld();
    _rc.setFromCamera(_ndc, app.camera);
    return _rc.ray;
  }

  /** world meters per screen pixel around p */
  _wpp(p) {
    const cam = this.app.camera;
    const d = cam.position.distanceTo(p);
    const h = this.app.canvas.getBoundingClientRect().height || 1;
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / h;
  }

  _move(e) {
    const d = this.d;
    if (!d) return;
    d.lx = e.clientX; d.ly = e.clientY;
    if (!d.moved && Math.hypot(d.lx - d.x0, d.ly - d.y0) < 8) return;
    if (!d.moved) { d.moved = true; haptic('light'); }
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; if (this.d === d) this._apply(d); });
  }

  /** base position (finger 1) + yaw (finger 2) -> placement, avoiding obstacles */
  _apply(d) {
    const { ctx } = this;
    const ch = d.ch;
    if (!this.app.characters.includes(ch)) return;
    let nx = d.startPos.x, nz = d.startPos.z;
    if (!d.moved) { /* turning only */ } else if (d.screen) {
      const dx = (d.lx - d.x0) * d.wpp, dy = (d.ly - d.y0) * d.wpp;
      nx = d.startPos.x + d.right.x * dx - d.fwd.x * dy;
      nz = d.startPos.z + d.right.z * dx - d.fwd.z * dy;
    } else {
      _plane.set(_n.set(0, 1, 0), -d.planeY);
      const p = this._ray(d.lx, d.ly).intersectPlane(_plane, _v);
      if (!p || p.distanceTo(this.app.camera.position) > 150) return;
      nx = d.startPos.x + p.x - d.grab.x; nz = d.startPos.z + p.z - d.grab.z;
    }
    // turning about the pelvis (second finger)
    const dy = d.yaw - d.startYaw, c = Math.cos(dy), s = Math.sin(dy);
    const ox = d.cOff.x * c + d.cOff.z * s, oz = -d.cOff.x * s + d.cOff.z * c;
    const tx = nx + d.cOff.x - ox, tz = nz + d.cOff.z - oz;
    // walk from where it is toward the finger in short steps (never through a table, a wall or
    // somebody: a far target past an obstacle stops at it), sliding along what blocks the way
    const cur = ch.root.position;
    let fx = cur.x, fz = cur.z;
    const step = 0.5 * d.r;
    const maxN = Math.min(200, 2 * Math.ceil(Math.hypot(tx - cur.x, tz - cur.z) / step) + 4);
    for (let i = 0; i < maxN; i++) {
      const dx = tx - fx, dz = tz - fz, L = Math.hypot(dx, dz);
      if (L < 1e-4) break;
      const k = Math.min(L, step) / L, sx = fx + dx * k, sz = fz + dz * k;
      if (!this._blocked(d, sx, sz, ox, oz)) { fx = sx; fz = sz; continue; }
      if (Math.abs(dx * k) > 1e-4 && !this._blocked(d, sx, fz, ox, oz)) { fx = sx; continue; }
      if (Math.abs(dz * k) > 1e-4 && !this._blocked(d, fx, sz, ox, oz)) { fz = sz; continue; }
      break;
    }
    ctx.contacts.carry(ch, () => {
      ch.root.rotation.y = d.yaw;
      cur.set(fx, ctx.floorAt(fx, fz) + d.rel + d.lift, fz);
      ch.root.updateMatrixWorld(true);
    });
    ctx.placed(ch);
  }

  _end(e, cancelled) {
    const d = this.d;
    if (!d) return;
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    this.d = null;
    const { app, ctx } = this;
    const ch = d.ch;
    ctx.contacts.decorators.delete(this._deco);
    this.shell.hint('');
    if (!app.characters.includes(ch)) return;
    const restore = () => {
      ch.root.position.copy(d.startPos);
      ch.root.rotation.y = d.startYaw;
      ch.root.updateMatrixWorld(true);
      const pins = JSON.parse(d.pins0);
      const pd = ch.data.pose || (ch.data.pose = {});
      if (pins) pd.pins = pins; else { delete pd.pins; if (!Object.keys(pd).length) delete ch.data.pose; }
      ctx.placed(ch);
    };
    if (cancelled) { restore(); return; }
    if (!d.moved && !d.rotated) {
      restore();
      this.openMenu(ch, d.x0, d.y0);
      return;
    }
    if (e && d.moved) { d.lx = e.clientX; d.ly = e.clientY; }
    this._apply(d); // the last move / turn (a frame may still be pending)
    // drop: back on the ground it was on (sidewalks, terrain), or at the same height above it
    const pos = ch.root.position;
    ctx.contacts.carry(ch, () => {
      pos.y = d.onGround ? ctx.groundAt(pos.x, pos.z) : ctx.floorAt(pos.x, pos.z) + d.rel;
      ch.root.updateMatrixWorld(true);
    });
    ctx.placed(ch);
    const lost = ctx.contacts.releaseLost(ch);
    if (lost.length) toast(`Contatto lasciato: ${lost.map((x) => EFFECTOR_LABEL[x].toLowerCase()).join(', ')}`, { ms: 2000 });
    haptic('light');
    ctx.placed(ch, true, d.rotated && !d.moved ? 'ruota personaggio' : 'sposta personaggio');
  }

  // ------------------------------------------------------------ second finger: turn
  _down2(e) {
    const d = this.d;
    if (!d || e.pointerId === d.id || d.rot) return;
    d.rot = { id: e.pointerId, a0: Math.atan2(e.clientY - d.ly, e.clientX - d.lx), yaw0: d.yaw, x: e.clientX, y: e.clientY };
    e.stopImmediatePropagation();
  }

  _move2(e) {
    const d = this.d;
    if (!d?.rot || e.pointerId !== d.rot.id) return;
    e.stopImmediatePropagation();
    const a = Math.atan2(e.clientY - d.ly, e.clientX - d.lx);
    let da = a - d.rot.a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    // screen clockwise = the character turns clockwise seen from above
    const yaw = d.rot.yaw0 - da;
    if (Math.abs(yaw - d.yaw) < 1e-4) return;
    const k0 = Math.round((d.yaw * 180) / Math.PI / 15), k1 = Math.round((yaw * 180) / Math.PI / 15);
    if (k0 !== k1) haptic(6);
    d.yaw = yaw;
    d.rotated = true;
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; if (this.d === d) this._apply(d); });
  }

  // ------------------------------------------------------------ obstacles
  /**
   * What the character should not walk into: props (boxes; rooms and other enclosures by
   * their walls: rays) and other characters (circles) it is not already touching. Flat
   * things (rugs, roads) and held props never block.
   */
  _obstacles(ch, d) {
    const app = this.app;
    const out = { boxes: [], walls: [], people: [] };
    const cx = d.startPos.x + d.cOff.x, cz = d.startPos.z + d.cOff.z, y0 = d.startPos.y;
    for (const p of app.props?.props || []) {
      if (p.hold || !p.root.visible) continue;
      p.worldBox(_box);
      if (_box.isEmpty() || _box.max.y - _box.min.y < 0.08 || _box.max.y < y0 + 0.12 || _box.min.y > y0 + 1.6) continue;
      const area = (_box.max.x - _box.min.x) * (_box.max.z - _box.min.z);
      const inside = cx > _box.min.x && cx < _box.max.x && cz > _box.min.z && cz < _box.max.z;
      if (inside && (area > 4 || p.type?.id === 'stanza')) { out.walls.push(p); continue; } // a room around it
      if (cx > _box.min.x - d.r && cx < _box.max.x + d.r && cz > _box.min.z - d.r && cz < _box.max.z + d.r) continue; // already there
      out.boxes.push(_box.clone());
    }
    for (const c of app.characters) {
      if (c === ch || !c.root.visible) continue;
      const q = this.ctx.rig.worldPos(c, 0, new THREE.Vector3());
      const rr = d.r + FOOT_R * (c.root.scale.y || 1);
      if (Math.hypot(q.x - cx, q.z - cz) < rr) continue;
      out.people.push({ x: q.x, z: q.z, r: rr });
    }
    return out;
  }

  _blocked(d, x, z, ox, oz) {
    const o = d.obstacles;
    const cx = x + ox, cz = z + oz, r = d.r;
    for (const b of o.boxes) if (cx > b.min.x - r && cx < b.max.x + r && cz > b.min.z - r && cz < b.max.z + r) return true;
    for (const p of o.people) if (Math.hypot(p.x - cx, p.z - cz) < p.r) return true;
    if (o.walls.length) {
      const y = d.startPos.y + 0.5 * (d.ch.root.scale.y || 1);
      const meshes = o.walls.flatMap((p) => p.meshes || []);
      _rc.far = r;
      for (const dir of DIRS) {
        _rc.set(_v2.set(cx, y, cz), dir);
        if (_rc.intersectObjects(meshes, false).length) { _rc.far = Infinity; return true; }
      }
      _rc.far = Infinity;
    }
    return false;
  }

  // ------------------------------------------------------------ overlay: shadow ring
  _draw(g, project) {
    const d = this.d;
    if (!d) return;
    const ch = d.ch;
    const P = this.ctx.rig.worldPos(ch, 0, _v);
    const y = ch.root.position.y - d.lift;
    const r = 0.38 * (ch.root.scale.y || 1);
    const pts = [];
    for (let j = 0; j <= 32; j++) {
      const t = (j / 32) * Math.PI * 2;
      const o = project(_v2.set(P.x + Math.cos(t) * r, y, P.z + Math.sin(t) * r), { x: 0, y: 0 });
      if (!o) return;
      pts.push(o);
    }
    g.save();
    g.beginPath();
    pts.forEach((o, j) => (j ? g.lineTo(o.x, o.y) : g.moveTo(o.x, o.y)));
    g.fillStyle = 'rgba(10,12,18,.28)'; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = '#4fd1c5'; g.setLineDash([6, 5]); g.stroke();
    g.restore();
  }

  // ------------------------------------------------------------ character menu
  openMenu(ch, x, y) {
    const { app, ctx, shell } = this;
    const people = app.modules.ui?.people;
    const turn45 = () => {
      const P = ctx.rig.worldPos(ch, 0, new THREE.Vector3());
      const dy = Math.PI / 4;
      const ox = P.x - ch.root.position.x, oz = P.z - ch.root.position.z;
      const rx = ox * Math.cos(dy) + oz * Math.sin(dy), rz = -ox * Math.sin(dy) + oz * Math.cos(dy);
      ctx.contacts.carry(ch, () => {
        ch.root.rotation.y = Math.atan2(Math.sin(ch.root.rotation.y + dy), Math.cos(ch.root.rotation.y + dy));
        ch.root.position.x = P.x - rx; ch.root.position.z = P.z - rz;
        ch.root.updateMatrixWorld(true);
      });
      ctx.placed(ch);
      const lost = ctx.contacts.releaseLost(ch);
      if (lost.length) toast(`Contatto lasciato: ${lost.map((x) => EFFECTOR_LABEL[x].toLowerCase()).join(', ')}`, { ms: 2000 });
      ctx.placed(ch, true, 'ruota personaggio');
    };
    const items = [
      { id: 'pose', label: 'Seleziona e posa', icon: 'pose', onClick: () => { app.select(ch, null); shell.openTool('pose'); } },
      { id: 'dup', label: 'Duplica', icon: 'copy', onClick: () => { if (people?.duplicate) people.duplicate(ch); else { app.duplicateCharacter(ch); app.commit('duplica personaggio'); } } },
      { id: 'mirror', label: 'Specchia posa', icon: 'mirror', onClick: () => { ctx.ops.mirrorPose(ch); toast('Posa specchiata', { kind: 'ok', ms: 1400 }); } },
      { id: 'ground', label: 'Appoggia a terra', icon: 'ground', onClick: () => {
        const pos = ch.root.position;
        ctx.contacts.carry(ch, () => { pos.y = ctx.groundAt(pos.x, pos.z); ch.root.updateMatrixWorld(true); });
        ctx.ops.dropToGround(ch);
        ctx.placed(ch);
      } },
      { id: 'turn', label: 'Ruota di 45°', icon: 'rotate', onClick: turn45 },
      { id: 'focus', label: 'Primo piano', icon: 'zoom', disabled: !app.modules.focus?.focus, onClick: () => { app.select(ch, null); app.modules.focus?.focus?.(ch, 'head'); } },
      { separator: true },
      { id: 'del', label: 'Elimina', icon: 'trash', danger: true, onClick: () => { if (people?.remove) people.remove(ch); else { app.removeCharacter(ch); app.commit('elimina personaggio'); } } },
    ];
    // opened by the release of the finger: kit.stageMenu ignores the click of that release
    // (with Tocco diretto only the trunk carries: say where to hold)
    const sub = ctx.direct?.posesTouch?.() ? 'Tieni premuto il busto e trascina per spostarlo' : 'Tieni premuto e trascina per spostarlo';
    return stageMenu(items, { x, y, title: ch.name, subtitle: sub, width: 264 });
  }
}
