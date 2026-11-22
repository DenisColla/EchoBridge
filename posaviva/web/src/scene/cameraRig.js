// Camera tools: focal length (35mm-equivalent) with optional dolly zoom,
// Dutch angle (roll that survives OrbitControls), animated transitions
// (quick angles, framing, saved views), tap-to-aim focal point, ground floor
// clamp and OrbitControls tuning for touch.
//
// OrbitControls.update() runs every frame and re-orients the camera with
// lookAt(target) (camera.up = +Y). `onFrame()` is called right after it (from
// the scene module's render hook) and applies, in order: active tween, floor
// clamp, roll. Rolling after lookAt keeps orbit/pan/zoom fully functional.
import * as THREE from 'three';
import { characterBounds, characterCenter, characterEyes, characterYaw, worldBounds } from './bounds.js';

const DEG = Math.PI / 180;
export const FOCAL_MIN = 12;
export const FOCAL_MAX = 200;
export const FOCAL_CHIPS = [14, 24, 35, 50, 85, 135, 200];
export const DEFAULT_FOCAL = 50;
export const ROLL_LIMIT = 45;
export const MAX_VIEWS = 6;
/** lowest camera height (m). Just above the floor: the ground is single-sided. */
export const CAMERA_FLOOR = 0.02;
/** offsets (m) around the camera where a landscape's ground is probed (the highest wins) */
const FLOOR_PROBE = [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]];
/** OrbitControls damping per 60 Hz frame; rescaled to the real frame time (120 Hz displays) */
const DAMPING_60HZ = 0.1;

export const QUICK_ANGLES = [
  { id: 'eye', label: 'Altezza occhi' },
  { id: 'low', label: 'Dal basso' },
  { id: 'high', label: 'Dall\'alto' },
  { id: 'top', label: 'Zenitale' },
  { id: 'front', label: 'Frontale' },
  { id: 'threeq', label: '3/4' },
  { id: 'side', label: 'Profilo' },
  { id: 'back', label: 'Retro' },
];

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _zAxis = new THREE.Vector3(0, 0, 1);
const _sph = new THREE.Spherical(), _box = new THREE.Box3();
const _ray = new THREE.Raycaster();
const _liveEvent = { type: 'change', live: true };

export class CameraRig extends THREE.EventDispatcher {
  constructor(app, shell) {
    super();
    this.app = app;
    this.shell = shell;
    this.camera = app.camera;
    this.controls = app.controls;
    /** focal length in mm (35mm equivalent on the long side of the screen) */
    this.focal = DEFAULT_FOCAL;
    // three keeps the vertical FOV on resize, so a focal set before the first
    // resize would read differently in landscape: re-apply it explicitly
    app.camera.filmGauge = 35;
    app.camera.setFocalLength(this.focal);
    /** roll in degrees (Dutch angle) */
    this.roll = 0;
    this.keepFraming = true;
    /** saved views: [{p, t, f, r, thumb}] | null per slot */
    this.views = new Array(MAX_VIEWS).fill(null);
    /** camera revision: bumped by committed camera actions only (see deserialize) */
    this.crev = 0;
    this.tween = null;
    this.aiming = false;
    this._tune();
    // re-apply the focal length when the aspect changes (filmGauge is mapped
    // to the long side, so the field of view would drift on rotation). The
    // vertical field of view of a 50 mm drops from ~39 to ~18 degrees when the
    // phone turns to landscape: a subject that was entirely in view is framed again.
    this._aspect = app.camera.aspect;
    app.addEventListener('resize', () => {
      const a0 = this._aspect, a1 = this.camera.aspect;
      this._aspect = a1;
      this.camera.setFocalLength(this.focal);
      if ((a0 < 1) !== (a1 < 1)) this.refitForAspect(a0);
      this._changed();
    });
    /** aspect of a restored camera state (scene opened / autosave): refit once the characters exist */
    this._pendingAspect = 0;
    app.addEventListener('loaded', () => {
      const a = this._pendingAspect;
      this._pendingAspect = 0;
      if (a) this.refitForAspect(a);
    });
    this.controls.addEventListener('start', () => { if (this.tween) this._endTween(false); });
    // opening another tool leaves the tap-to-aim mode
    app.addEventListener('tool', (e) => { if (e.id && this.aiming) this.cancelAim(); });
  }

  /** OrbitControls tuned for touch: 1 finger orbit, 2 fingers pan + pinch zoom. */
  _tune() {
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = DAMPING_60HZ;
    c.rotateSpeed = 0.85;
    c.zoomSpeed = 1.1;
    c.panSpeed = 0.9;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    c.minDistance = 0.12;
    c.maxDistance = 45;
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }

  _changed() { this.app.invalidate(); this.dispatchEvent({ type: 'change' }); }

  /** Commits a camera action to the undo history. */
  commit(label) { this.crev++; this.app.commit(label); }

  // ---------------------------------------------------------------- focal
  /**
   * Sets the focal length. keepFraming: dolly along the view axis so the
   * subject at the orbit target keeps its size (perspective exaggeration).
   */
  setFocal(f, { keepFraming = this.keepFraming, animate = false, commit = false } = {}) {
    f = Math.max(FOCAL_MIN, Math.min(FOCAL_MAX, f));
    if (animate) {
      const d0 = this.camera.position.distanceTo(this.controls.target);
      const d1 = keepFraming ? this._clampDist(d0 * f / this.focal) : d0;
      this._startTween({ focal: f, radius: d1 }, { duration: 420, commit: commit ? 'obiettivo' : null, mode: 'orbit' });
      return;
    }
    // a direct change wins over a running transition (which would overwrite it next frame)
    if (this.tween) this._endTween(false);
    if (keepFraming) {
      const t = this.controls.target, p = this.camera.position;
      const d0 = p.distanceTo(t);
      const d1 = this._clampDist(d0 * f / this.focal);
      _v.subVectors(p, t).multiplyScalar(d1 / Math.max(1e-6, d0));
      p.copy(t).add(_v);
    }
    this.focal = f;
    this.camera.setFocalLength(f);
    this._changed();
    if (commit) this.commit('obiettivo');
  }

  _clampDist(d) { return Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, d)); }

  /** Vertical field of view in degrees (for display). */
  get fovDeg() { return this.camera.getEffectiveFOV(); }
  /** Field of view across the long side of the screen, degrees (filmGauge maps to the long side). */
  get longSideFovDeg() { return (2 * Math.atan(this.camera.filmGauge / 2 / this.focal)) / DEG; }

  // ---------------------------------------------------------------- roll
  setRoll(deg, { commit = false } = {}) {
    if (this.tween) this._endTween(false);
    this.roll = Math.max(-ROLL_LIMIT, Math.min(ROLL_LIMIT, deg));
    this._changed();
    if (commit) this.commit('olandese');
  }

  // ---------------------------------------------------------------- per frame
  /**
   * Called after OrbitControls.update(). Returns true while animating.
   * dt (s): frame time, used to keep the orbit inertia frame-rate independent.
   */
  onFrame(now, dt = 1 / 60) {
    // OrbitControls applies dampingFactor once per update(): at 120 Hz the inertia
    // would die out twice as fast. Same decay per second as 0.1 at 60 Hz.
    const f = 1 - Math.pow(1 - DAMPING_60HZ, Math.max(1 / 240, Math.min(0.1, dt || 1 / 60)) * 60);
    if (Math.abs(this.controls.dampingFactor - f) > 1e-4) this.controls.dampingFactor = f;
    let animating = false;
    if (this.tween) animating = this._stepTween(now);
    this._clampFloor();
    if (this.roll) {
      _q.setFromAxisAngle(_zAxis, -this.roll * DEG);
      this.camera.quaternion.multiply(_q);
    }
    return animating;
  }

  /**
   * Lowest camera height at world (x, z): just above the studio floor, or above a
   * ready landscape's ground (app.landscapes.heightAt: terrain, roofs, piers) with a
   * margin for the terrain mesh, which is coarser far from the characters.
   */
  floorAt(x, z) {
    const L = this.app.landscapes;
    if (!L?.current || !L.heightAt || L.hasTerrain === false) return CAMERA_FLOOR;
    let h = -Infinity;
    for (const [dx, dz] of FLOOR_PROBE) h = Math.max(h, L.heightAt(x + dx, z + dz));
    if (!Number.isFinite(h)) return CAMERA_FLOOR;
    const f = L.current.frame, r = f ? Math.hypot(x - f.x, z - f.z) : 0;
    return h + 0.05 + Math.min(0.5, r * 0.004);
  }

  _clampFloor() {
    const c = this.controls, t = c.target, p = this.camera.position;
    const L = this.app.landscapes, land = !!(L?.current && L.heightAt && L.hasTerrain !== false);
    // the orbit target stays on or above the ground (a landscape's hills, else y = 0)
    const tFloor = land ? L.heightAt(t.x, t.z) : 0;
    if (Number.isFinite(tFloor) && t.y < tFloor) t.y = tFloor;
    _v.subVectors(p, t);
    const r = _v.length();
    if (r < 1e-6) return;
    const floor = land ? this.floorAt(p.x, p.z) : CAMERA_FLOOR;
    if (p.y < floor) {
      const ny = floor - t.y;
      const hor = Math.hypot(_v.x, _v.z);
      if (Math.abs(ny) < r && hor > 1e-6) {
        const k = Math.sqrt(r * r - ny * ny) / hor;
        _v.x *= k; _v.z *= k;
      }
      _v.y = ny;
      p.copy(t).add(_v);
      this.camera.lookAt(t);
    }
    // prevent OrbitControls (and its damping) from pushing below the floor next frame
    c.maxPolarAngle = Math.acos(Math.max(-1, Math.min(1, (floor - t.y) / Math.max(r, 1e-3))));
  }

  // ---------------------------------------------------------------- tweens
  /**
   * Animated transition. `to` may contain: target (Vector3), radius, theta,
   * phi (orbit mode, spherical around the interpolated target), position
   * (linear mode), focal, roll. Missing fields keep their current value.
   */
  _startTween(to, { duration = 500, commit = null, mode = 'orbit' } = {}) {
    if (this.tween) this._endTween(false);
    const t0 = this.controls.target.clone();
    _sph.setFromVector3(_v.subVectors(this.camera.position, t0));
    const from = { target: t0, radius: _sph.radius, theta: _sph.theta, phi: _sph.phi, position: this.camera.position.clone(), focal: this.focal, roll: this.roll };
    const dest = {
      target: to.target ? to.target.clone() : t0.clone(),
      radius: to.radius ?? from.radius,
      theta: to.theta ?? from.theta,
      phi: to.phi ?? from.phi,
      position: to.position ? to.position.clone() : null,
      focal: to.focal ?? this.focal,
      roll: to.roll ?? this.roll,
    };
    // shortest way around
    dest.theta = from.theta + wrapPi(dest.theta - from.theta);
    this.tween = { from, to: dest, start: performance.now(), duration, commit, mode };
    this.app.invalidate();
  }

  _stepTween(now) {
    const tw = this.tween, a = tw.from, b = tw.to;
    const k = Math.min(1, (now - tw.start) / tw.duration), e = ease(k);
    const c = this.controls, p = this.camera.position;
    c.target.lerpVectors(a.target, b.target, e);
    const f = a.focal * Math.pow(b.focal / a.focal, e);
    if (Math.abs(f - this.focal) > 1e-4) { this.focal = f; this.camera.setFocalLength(f); }
    this.roll = a.roll + (b.roll - a.roll) * e;
    if (tw.mode === 'linear' && b.position) {
      p.lerpVectors(a.position, b.position, e);
    } else {
      const r = a.radius * Math.pow(b.radius / a.radius, e);
      _sph.set(r, a.phi + (b.phi - a.phi) * e, a.theta + (b.theta - a.theta) * e).makeSafe();
      p.copy(c.target).add(_v.setFromSpherical(_sph));
    }
    this.camera.lookAt(c.target);
    if (k >= 1) { this._endTween(true); return false; }
    this.dispatchEvent(_liveEvent);
    return true;
  }

  _endTween(completed) {
    const tw = this.tween;
    this.tween = null;
    if (!tw) return;
    if (completed) { this.focal = tw.to.focal; this.camera.setFocalLength(this.focal); this.roll = tw.to.roll; }
    // sync OrbitControls' internal state with the new pose
    this.controls.update();
    this._changed();
    if (tw.commit) this.commit(tw.commit);
    // framing actions compose the full canvas (= the export); while a tool panel
    // covers part of it, let the UI view offset bring the subject back into the free area
    if (completed) this.app.modules?.ui?.viewOffset?.update?.({ keepIfVisible: true });
  }

  get animating() { return !!this.tween; }

  // ---------------------------------------------------------------- subject helpers
  _subject() {
    const ch = this.app.selection.character;
    if (ch) {
      characterBounds(ch, _box);
      return { ch, box: _box.clone(), center: characterCenter(ch, new THREE.Vector3()), eyes: characterEyes(ch, new THREE.Vector3()), yaw: characterYaw(ch) };
    }
    const box = new THREE.Box3();
    const empty = !worldBounds(this.app, box);
    if (empty) box.setFromCenterAndSize(this.controls.target, _v.set(0.6, 1.8, 0.4));
    const center = box.getCenter(new THREE.Vector3());
    return { ch: null, box, center, eyes: center.clone().setY(box.min.y + (box.max.y - box.min.y) * 0.92), yaw: 0, empty };
  }

  // ---------------------------------------------------------------- actions
  /**
   * Frames the selected character (or everything) keeping the current view
   * direction: the orbit target goes to the center of the subject (so orbiting
   * afterwards pivots around it) and the distance is the smallest one at which
   * every corner of its bounds fits in the canvas with a margin. The canvas
   * (not the area above the tool panel) is used so the framing matches exports.
   */
  frameSubject({ animate = true, commit = true } = {}) {
    const box = this._subject().box;
    const cam = this.camera;
    const C = box.getCenter(new THREE.Vector3());
    const d = this._frameDist(box, C, cam.aspect);
    _v2.subVectors(cam.position, this.controls.target).normalize();
    const P = C.clone().addScaledVector(_v2, d);
    if (!animate) {
      if (this.tween) this._endTween(false);
      this.controls.target.copy(C); cam.position.copy(P); this.controls.update(); this._changed();
      if (commit) this.commit('inquadra');
      return;
    }
    this._startTween({ target: C, position: P }, { duration: 520, commit: commit ? 'inquadra' : null, mode: 'linear' });
  }

  /**
   * Smallest camera distance from C (along the current view direction) at which
   * every corner of `box` fits in the frame of a given aspect with a margin.
   */
  _frameDist(box, C, aspect) {
    const Rinv = _q.copy(this.camera.quaternion).invert();
    const tanY = this.camera.filmGauge / (2 * this.focal * Math.max(aspect, 1)), tanX = tanY * aspect;
    const m = 0.88; // fraction of the half-frame the subject may use
    let d = this.controls.minDistance;
    for (let i = 0; i < 8; i++) {
      // corner offset in camera space; at camera distance d its depth is d - oz
      _v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(C).applyQuaternion(Rinv);
      d = Math.max(d, Math.abs(_v.x) / (m * tanX) + _v.z, Math.abs(_v.y) / (m * tanY) + _v.z);
    }
    return this._clampDist(d);
  }

  /**
   * After a portrait <-> landscape change (or a scene saved in the other
   * orientation) the focal length stays on the long side, so the subject would
   * be cropped (portrait -> landscape) or tiny (landscape -> portrait). When the
   * subject was entirely in view with the previous aspect, it is framed again if
   * it is cropped now, or if it filled the old frame and would now be much
   * smaller. A close-up on a detail is left alone. No undo step.
   */
  refitForAspect(oldAspect) {
    const cam = this.camera;
    if (!(oldAspect > 0) || (oldAspect < 1) === (cam.aspect < 1) || this.tween) return false;
    const sub = this._subject(), box = sub.box;
    if (sub.empty || box.isEmpty() || !this._boxInView(box, oldAspect, 1.15)) return false;
    const C = box.getCenter(new THREE.Vector3());
    const dir = _v2.subVectors(cam.position, this.controls.target).normalize();
    const dCur = _v.subVectors(cam.position, C).dot(dir);
    const filled = dCur <= 1.3 * this._frameDist(box, C, oldAspect);
    if (this._boxInView(box, cam.aspect, 1) && !(filled && dCur > 1.3 * this._frameDist(box, C, cam.aspect))) return false;
    this.frameSubject({ animate: false, commit: false });
    this.app.modules?.ui?.viewOffset?.update?.({ keepIfVisible: true });
    return true;
  }

  /** True if the subject's bounds are inside the camera frame (current aspect). */
  subjectInView(tol = 1) {
    const sub = this._subject();
    return sub.empty || sub.box.isEmpty() || this._boxInView(sub.box, this.camera.aspect, tol);
  }

  /**
   * True if every corner of `box` is inside the plain (un-offset) camera frame
   * for a given aspect, with the current focal length (filmGauge on the long
   * side). tol > 1 accepts corners slightly outside (the box is conservative).
   */
  _boxInView(box, aspect, tol = 1) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const tanY = (cam.filmGauge / (2 * this.focal * Math.max(aspect, 1))) * tol, tanX = tanY * aspect;
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(cam.matrixWorldInverse);
      const z = -_v.z;
      if (z < 1e-3 || Math.abs(_v.x) > z * tanX || Math.abs(_v.y) > z * tanY) return false;
    }
    return true;
  }

  /** Animated quick angle around the selected character (see QUICK_ANGLES). */
  quickAngle(id) {
    const s = this._subject();
    _sph.setFromVector3(_v.subVectors(this.camera.position, this.controls.target));
    let { radius, theta, phi } = _sph;
    const height = Math.max(0.5, s.box.max.y - s.box.min.y);
    const target = s.center.clone();
    switch (id) {
      case 'eye':
        target.copy(s.eyes);
        phi = Math.PI / 2;
        break;
      case 'low': {
        target.y = s.box.min.y + height * 0.62;
        radius = Math.max(radius, height * 0.95);
        const camY = 0.1;
        phi = Math.acos(Math.max(-0.98, (camY - target.y) / radius));
        break;
      }
      case 'high':
        target.y = s.box.min.y + height * 0.5;
        radius = Math.max(radius, height * 1.3);
        phi = 38 * DEG;
        break;
      case 'top':
        target.y = s.box.min.y + height * 0.45;
        radius = Math.max(radius, height * 1.6);
        phi = 0.002;
        break;
      case 'front': theta = s.yaw; break;
      case 'threeq': theta = s.yaw + 45 * DEG; break;
      case 'side': theta = s.yaw + 90 * DEG; break;
      case 'back': theta = s.yaw + Math.PI; break;
      default: return;
    }
    // direction presets keep the current elevation, unless it is extreme
    // (after a zenithal / worm's-eye shot "Frontale" should look frontal)
    if (['front', 'threeq', 'side', 'back'].includes(id) && (phi < 40 * DEG || phi > 112 * DEG)) {
      phi = 80 * DEG;
      radius = Math.max(Math.min(radius, height * 2.6), height * 1.2);
    }
    if (phi > Math.PI / 2 && id !== 'low' && id !== 'eye') phi = Math.min(phi, 100 * DEG);
    const label = QUICK_ANGLES.find((q) => q.id === id)?.label.toLowerCase() || 'angolo';
    this._startTween({ target, radius, theta, phi }, { duration: 620, commit: label, mode: 'orbit' });
  }

  // ---------------------------------------------------------------- tap to aim
  startAim() {
    if (this.aiming) return;
    this.aiming = true;
    this._offTap = this.app.addTapHandler((ev) => this._onAimTap(ev), 100);
    this._offBack = this.app.pushBackHandler(() => { this.cancelAim(); return true; });
    this.shell?.hint('Tocca il punto da mettere al centro · Indietro per annullare', 0);
    this.dispatchEvent({ type: 'aim', active: true });
  }

  cancelAim() {
    if (!this.aiming) return;
    this.aiming = false;
    this._offTap?.(); this._offBack?.();
    this._offTap = this._offBack = null;
    this.shell?.hint('');
    this.dispatchEvent({ type: 'aim', active: false });
  }

  /** Raycasts the visible meshes of the world and the ground. */
  raycastScene(ndc) {
    const app = this.app;
    app.camera.updateMatrixWorld();
    _ray.setFromCamera(ndc, app.camera);
    const objs = [];
    app.world.traverseVisible((o) => {
      if (!(o.isMesh || o.isSkinnedMesh) || o.userData.isHelper) return;
      // skinned bounds are cached by three.js and go stale when posing
      if (o.isSkinnedMesh) { o.boundingSphere = null; o.boundingBox = null; }
      objs.push(o);
    });
    if (app.ground?.visible !== false) objs.push(app.ground);
    const hits = _ray.intersectObjects(objs, false);
    return hits[0] || null;
  }

  _onAimTap({ ndc }) {
    const hit = this.raycastScene(ndc);
    if (!hit) { this.shell?.hint('Nessun punto qui: tocca il personaggio o il pavimento', 1800); return true; }
    this.cancelAim();
    this.aimAt(hit.point);
    this.dispatchEvent({ type: 'aimed', point: hit.point.clone() });
    return true;
  }

  /** Smoothly turns the camera (which stays in place) toward a world point and orbits around it. */
  aimAt(point, { commit = true } = {}) {
    const P = this.camera.position.clone();
    if (P.distanceTo(point) < this.controls.minDistance * 1.5) {
      _v.subVectors(P, point).normalize().multiplyScalar(this.controls.minDistance * 1.5);
      P.copy(point).add(_v);
    }
    this._startTween({ target: point.clone(), position: P }, { duration: 480, commit: commit ? 'punto focale' : null, mode: 'linear' });
  }

  // ---------------------------------------------------------------- saved views
  /**
   * Small JPEG of the current view for the saved-view slot. Rendered with the
   * plain camera projection (never the UI view offset used while a panel is
   * open) and keeping the canvas aspect, so it shows the real framing.
   */
  _captureThumb() {
    const app = this.app, src = app.canvas;
    const draw = () => {
      app.renderNow(); // the drawing buffer stays valid until the end of this task
      const sw = src.width, sh = src.height;
      const k = 120 / Math.max(sw, sh);
      const W = Math.max(8, Math.round(sw * k)), H = Math.max(8, Math.round(sh * k));
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = '#2a2c33'; g.fillRect(0, 0, W, H);
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, sw, sh, 0, 0, W, H);
      return c.toDataURL('image/jpeg', 0.72);
    };
    try {
      const vo = app.modules?.ui?.viewOffset;
      const url = vo?.without ? vo.without(draw) : draw();
      app.invalidate(); // back to the on-screen projection on the next frame
      return url;
    } catch { return null; }
  }

  currentView() {
    const p = this.camera.position, t = this.controls.target;
    return { p: [r4(p.x), r4(p.y), r4(p.z)], t: [r4(t.x), r4(t.y), r4(t.z)], f: r4(this.focal), r: r4(this.roll) };
  }

  saveView(slot) {
    if (slot < 0 || slot >= MAX_VIEWS) return;
    this.views[slot] = { ...this.currentView(), thumb: this._captureThumb() };
    this.dispatchEvent({ type: 'views' });
    this.app.commit('vista salvata');
  }

  deleteView(slot) {
    if (!this.views[slot]) return;
    this.views[slot] = null;
    this.dispatchEvent({ type: 'views' });
    this.app.commit('vista eliminata');
  }

  restoreView(slot, { animate = true } = {}) {
    const v = this.views[slot];
    if (v) this.applyView(v, { animate, commit: 'vista' });
  }

  applyView(v, { animate = true, commit = null, duration = 600 } = {}) {
    const target = new THREE.Vector3().fromArray(v.t);
    _sph.setFromVector3(_v.fromArray(v.p).sub(target));
    const to = { target, radius: _sph.radius, theta: _sph.theta, phi: _sph.phi, focal: v.f ?? this.focal, roll: v.r ?? 0 };
    if (animate) { this._startTween(to, { duration, commit, mode: 'orbit' }); return; }
    if (this.tween) this._endTween(false);
    this.controls.target.copy(target);
    this.camera.position.fromArray(v.p);
    this.focal = to.focal; this.camera.setFocalLength(this.focal);
    this.roll = to.roll;
    this.camera.lookAt(target);
    this.controls.update();
    this._changed();
    if (commit) this.commit(commit);
  }

  // ---------------------------------------------------------------- (de)serialization
  getState() {
    // a: aspect of the view, so a scene opened in the other orientation can be framed again
    return { ...this.currentView(), a: r4(this.camera.aspect), keep: this.keepFraming, crev: this.crev, views: this.views.map((v) => (v ? { ...v } : null)) };
  }

  /**
   * fromHistory: undo/redo. The live camera is only moved when the step being
   * undone/redone was a committed camera action (different `crev`), so undoing
   * a pose does not throw the user's current point of view away.
   */
  setState(s, { fromHistory = false } = {}) {
    if (!s) return;
    if (Array.isArray(s.views)) {
      const key = JSON.stringify(s.views);
      if (key !== this._viewsKey) {
        this.views = Array.from({ length: MAX_VIEWS }, (_, i) => (s.views[i] ? { ...s.views[i] } : null));
        this._viewsKey = key;
        this.dispatchEvent({ type: 'views' });
      }
    }
    if (typeof s.keep === 'boolean') this.keepFraming = s.keep;
    const crev = s.crev ?? 0;
    if (fromHistory && crev === this.crev) return;
    this.crev = crev;
    if (!Array.isArray(s.p) || !Array.isArray(s.t)) return;
    // a scene saved in the other orientation: checked on 'loaded', when its characters exist
    if (!fromHistory && s.a > 0 && (s.a < 1) !== (this.camera.aspect < 1)) this._pendingAspect = s.a;
    const cur = this.currentView();
    if (JSON.stringify([cur.p, cur.t, cur.f, cur.r]) === JSON.stringify([s.p, s.t, s.f, s.r])) return;
    this.applyView(s, { animate: fromHistory, duration: 320 });
  }
}
