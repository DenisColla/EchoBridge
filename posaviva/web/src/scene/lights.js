// Managed light rig: key light (shadows), hemisphere ambient/fill, optional
// rim light and up to 3 extra lights (sun / spot / point). Every light is
// described by plain JSON (serialized with the scene) and mirrored into
// three.js lights. Also owns the in-viewport light handles (draggable sprites)
// and the automatic shadow-camera fitting.
//
// Light data (angles in radians, positions in world meters):
//   { id, role:'key'|'rim'|'extra', name, type:'sun'|'spot'|'point', on,
//     kelvin, color (hex|null: custom color overrides kelvin), intensity,
//     az, el, dist, target:[x,y,z], shadow, soft (0..1), angle (deg, full cone), penumbra }
// Direction convention: dir(az, el) = (sin az·cos el, sin el, cos az·cos el)
// points FROM the target TOWARDS the light. az = 0 is +Z (the default front).
//
// Intensity is normalized: for every type `intensity` is the illuminance the
// light produces at its target (spot/point candela = intensity · dist²), so
// moving a lamp further away does not make the subject darker.
import * as THREE from 'three';
import { setColorFromKelvin } from './color.js';
import { worldBounds, characterCenter } from './bounds.js';
import { presetById } from './lightPresets.js';
import { MAX_RADIUS_2D, MAX_RADIUS_POINT } from './shadowPatch.js';

export const MAX_EXTRAS = 3;
export const TYPE_LABELS = { sun: 'Sole', spot: 'Faretto', point: 'Lampadina' };
export const ROLE_LABELS = { key: 'Principale', rim: 'Contorno', extra: 'Extra' };
const DEG = Math.PI / 180;
const EL_LIMIT = 89 * DEG;

let _seq = 0;
const newId = () => `l${(Date.now() % 1e6).toString(36)}${(_seq++).toString(36)}`;

export function makeLightData(p = {}) {
  return {
    id: p.id || newId(),
    role: p.role || 'extra',
    name: p.name || '',
    type: p.type || 'sun',
    on: p.on !== false,
    kelvin: p.kelvin ?? 5600,
    color: p.color || null,
    intensity: p.intensity ?? 2,
    az: p.az ?? 0,
    el: p.el ?? 0.6,
    dist: p.dist ?? 2.5,
    target: p.target ? [...p.target] : [0, 1, 0],
    shadow: p.shadow ?? p.role === 'key',
    soft: p.soft ?? 0.3,
    angle: p.angle ?? 50,
    penumbra: p.penumbra ?? 0.4,
  };
}

export function dirFromAzEl(az, el, out = new THREE.Vector3()) {
  const c = Math.cos(el);
  return out.set(Math.sin(az) * c, Math.sin(el), Math.cos(az) * c);
}

/** Writes az/el (radians) of a unit direction into `d`. */
export function azElFromDir(v, d) {
  d.az = Math.atan2(v.x, v.z);
  d.el = Math.max(-EL_LIMIT, Math.min(EL_LIMIT, Math.asin(Math.max(-1, Math.min(1, v.y)))));
  return d;
}

export function lightLabel(d, lights) {
  if (d.name) return d.name;
  if (d.role !== 'extra') return ROLE_LABELS[d.role];
  const extras = lights.filter((l) => l.role === 'extra' && !l.name);
  return `Extra ${extras.indexOf(d) + 1}`;
}

// ---------------------------------------------------------------- handle icons
const _iconCache = new Map();
/** White glyph with a dark outline, tinted by the sprite color. */
function handleTexture(kind) {
  if (_iconCache.has(kind)) return _iconCache.get(kind);
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const pass = (stroke, width, fill) => {
    g.strokeStyle = stroke; g.lineWidth = width; g.fillStyle = fill;
    g.beginPath();
    if (kind === 'sun') {
      g.arc(0, 0, 20, 0, Math.PI * 2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.moveTo(Math.cos(a) * 31, Math.sin(a) * 31); g.lineTo(Math.cos(a) * 46, Math.sin(a) * 46);
      }
    } else if (kind === 'point') {
      g.arc(0, -8, 26, Math.PI * 0.78, Math.PI * 2.22);
      g.lineTo(11, 30); g.lineTo(-11, 30); g.closePath();
      g.moveTo(-10, 40); g.lineTo(10, 40);
    } else if (kind === 'spot') {
      g.moveTo(-14, -34); g.lineTo(14, -34); g.lineTo(30, 26); g.quadraticCurveTo(0, 40, -30, 26); g.closePath();
    } else if (kind === 'target') {
      g.arc(0, 0, 14, 0, Math.PI * 2);
      g.moveTo(-34, 0); g.lineTo(-22, 0); g.moveTo(22, 0); g.lineTo(34, 0);
      g.moveTo(0, -34); g.lineTo(0, -22); g.moveTo(0, 22); g.lineTo(0, 34);
    }
  };
  pass('rgba(10,12,18,0.85)', 16, 'rgba(10,12,18,0.85)');
  g.fill(); g.stroke();
  pass('#ffffff', 6, '#ffffff');
  if (kind === 'target') g.stroke(); else { g.fill(); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _iconCache.set(kind, tex);
  return tex;
}

const noRaycast = () => {};

function makeHandle(kind) {
  const m = new THREE.SpriteMaterial({ map: handleTexture(kind), depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false, toneMapped: false });
  const s = new THREE.Sprite(m);
  s.renderOrder = 1000;
  s.raycast = noRaycast;
  s.frustumCulled = false;
  s.userData.isHelper = true;
  return s;
}

function makeLine() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  // written by hand (Line.computeLineDistances() allocates a new attribute each call)
  geo.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(2), 1));
  const mat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.06, gapSize: 0.04, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false, toneMapped: false });
  const l = new THREE.Line(geo, mat);
  l.renderOrder = 999;
  l.raycast = noRaycast;
  l.frustumCulled = false;
  l.userData.isHelper = true;
  return l;
}

function createLight(type) {
  let L;
  if (type === 'spot') {
    L = new THREE.SpotLight(0xffffff, 1, 0, Math.PI / 6, 0.4, 2);
    L.shadow.mapSize.set(1024, 1024);
    L.shadow.camera.near = 0.05;
  } else if (type === 'point') {
    L = new THREE.PointLight(0xffffff, 1, 0, 2);
    L.shadow.mapSize.set(512, 512);
    L.shadow.camera.near = 0.05;
  } else {
    L = new THREE.DirectionalLight(0xffffff, 1);
    L.shadow.mapSize.set(2048, 2048);
  }
  L.name = `pv-${type}`;
  // shadow resolution/radius/bias are chosen per light by the rig (softness);
  // other modules should cap them with app.lightRig.setShadowQuality(size)
  L.userData.pvManagedShadow = true;
  return L;
}

/**
 * Shadow softness is a blur half-width in meters (independent from the
 * frustum size). The PCF radius (texels) is capped; softer shadows lower the
 * map resolution instead, which keeps the filtering smooth and cheap.
 */
function shadowResolution(size, soft, maxRes, maxRadius, forcedRes = 0) {
  const blur = 0.002 + soft * soft * 0.08;
  let res = forcedRes || maxRes;
  if (!forcedRes) while (res > 128 && blur / (size / res) > maxRadius) res >>= 1;
  const texel = size / res;
  return { res, texel, radius: Math.max(1, Math.min(maxRadius, blur / texel)) };
}

/**
 * Normal offset of the shadow lookup (meters). It must cover the PCF footprint
 * on sloped receivers, but every millimetre also erases small cast shadows
 * (nose, brow ridge, lips, hair on the forehead): a sample pushed 2 cm off the
 * cheek is outside the nose shadow. The body casts from its back faces
 * (three.js FrontSide -> BackSide shadow pass), so about one texel plus half
 * the filter radius is enough (checked for acne from grazing to frontal light
 * on skin, cloth, hair and the floor).
 */
export function normalBiasFor(texel, radius) { return texel * (1 + 0.5 * radius); }

/** Fill from the environment map (render module) relative to the rig's ambient: 0.8 = as styled. */
const ENV_REF_AMBIENT = 0.8, ENV_MAX_SCALE = 1.5;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _dir = new THREE.Vector3();
const _box = new THREE.Box3(), _m = new THREE.Matrix4(), _sphere = new THREE.Sphere();
const _ndc = new THREE.Vector2(), _plane = new THREE.Plane();
const _white = new THREE.Color(1, 1, 1);

export class LightRig extends THREE.EventDispatcher {
  constructor(app) {
    super();
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'pvLightRig';
    this.handleGroup = new THREE.Group();
    this.handleGroup.name = 'pvLightHandles';
    this.handleGroup.visible = false;
    this.handleGroup.userData.isHelper = true;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    this.group.add(this.hemi);
    app.scene.add(this.group, this.handleGroup);

    this.targetMarker = makeHandle('target');
    this.handleGroup.add(this.targetMarker);

    /** live state (plain JSON) */
    this.state = { v: 1, preset: null, ambient: { intensity: 0.8, kelvin: 7500, color: null, ground: '#3e3833' }, lights: [], handles: true };
    /** id -> {light, type, handle, line, kind} */
    this.entries = new Map();
    this.selectedId = null;
    this._handlesWanted = false;
    this._worldBox = new THREE.Box3(new THREE.Vector3(-0.6, 0, -0.4), new THREE.Vector3(0.6, 1.9, 0.4));
    this._fitBox = this._worldBox.clone().expandByScalar(0.2);
    this._worldDirty = true;
    this._sig = NaN;
    this._lastSig = 0;
    this._lastFit = -1e9;
    this._drag = null;
    this._raycaster = new THREE.Raycaster();
    /** shadow map size caps (set by the render quality preset via setShadowQuality) */
    this._maxRes = { d2: 2048, spot: 1024, point: 512 };
    /** sizes imposed by another module that rewrites mapSize (adopted instead of fighting) */
    this._forcedRes = { d2: 0, point: 0 };
    this._viewKey = new Float64Array(13);
    this._viewVals = new Float64Array(13);
    /** environment (IBL) intensity chosen by the render style, scaled by the ambient level */
    this._envBase = null;
    this._envLast = NaN;
    this._setupInput();
  }

  // ---------------------------------------------------------------- queries
  get lights() { return this.state.lights; }
  get(id) { return this.state.lights.find((l) => l.id === id) || null; }
  get selected() { return this.get(this.selectedId) || this.state.lights[0] || null; }
  extrasCount() { return this.state.lights.filter((l) => l.role === 'extra').length; }

  /** Pivot used by the handle of a light: orbit target for suns, own target otherwise. */
  pivotOf(d, out = new THREE.Vector3()) {
    return d.type === 'sun' ? out.copy(this.app.controls.target) : out.fromArray(d.target);
  }

  /** Radius of the sphere on which a sun handle is displayed/dragged. */
  sunHandleRadius() {
    // ~70% of the visible half-extent at the target distance (narrow side), so
    // sun handles stay on screen in portrait and landscape at any focal length
    const cam = this.app.camera, t = this.app.controls.target;
    const tanY = 1 / cam.projectionMatrix.elements[5], tanX = 1 / cam.projectionMatrix.elements[0];
    return Math.max(0.3, Math.min(3, cam.position.distanceTo(t) * Math.min(tanX, tanY) * 0.72));
  }

  /** World position of the light's handle. */
  handlePosition(d, out = new THREE.Vector3()) {
    this.pivotOf(d, out);
    dirFromAzEl(d.az, d.el, _dir);
    return out.addScaledVector(_dir, d.type === 'sun' ? this.sunHandleRadius() : d.dist);
  }

  /** Subject used to aim presets: selected character, else the whole world, else the orbit target. */
  subjectCenter(out = new THREE.Vector3()) {
    const ch = this.app.selection.character;
    if (ch) return characterCenter(ch, out);
    if (worldBounds(this.app, _box)) return _box.getCenter(out);
    return out.copy(this.app.controls.target);
  }

  // ---------------------------------------------------------------- state
  getState() { return JSON.parse(JSON.stringify(this.state)); }

  /** Replaces the whole rig (load / undo). Cheap when nothing changed. */
  setState(s) {
    if (!s || !Array.isArray(s.lights)) return;
    const key = JSON.stringify(s);
    if (key === this._appliedKey) return;
    const lights = s.lights.map((l) => makeLightData(l));
    if (!lights.some((l) => l.role === 'key')) lights.unshift(makeLightData({ role: 'key' }));
    this.state = {
      v: 1, preset: s.preset ?? null,
      ambient: { intensity: 0.8, kelvin: 7500, color: null, ground: null, ...(s.ambient || {}) },
      lights, handles: s.handles !== false,
    };
    this._syncAll();
    this._appliedKey = JSON.stringify(this.state);
    if (!this.get(this.selectedId)) this.selectedId = lights[0].id;
    this._emit('state');
  }

  /** Patch one light. `live` = during a drag (no structural changes expected). */
  set(id, patch, opts = {}) {
    const d = this.get(id);
    if (!d) return;
    Object.assign(d, patch);
    if (patch.target) d.target = [...patch.target];
    if (!opts.keepPreset) this.state.preset = null;
    this._syncLight(d);
    this._afterChange(opts.live);
  }

  setAmbient(patch, opts = {}) {
    Object.assign(this.state.ambient, patch);
    this.state.preset = null;
    this._syncAmbient();
    this._afterChange(opts.live);
  }

  /** Ends a live edit (slider release, globe drag end): records the undo step. */
  endLive(label = 'luce') {
    this._appliedKey = JSON.stringify(this.state);
    this._worldDirty = true;
    this._emit('change');
    this.app.commit(label);
  }

  setHandlesPref(on) { this.state.handles = !!on; this._updateHandleVisibility(); this._emit('handles'); }

  select(id) {
    if (this.selectedId === id || !this.get(id)) return;
    this.selectedId = id;
    this._updateHandles();
    this.app.invalidate();
    this._emit('select');
  }

  addLight(type = 'point') {
    if (this.extrasCount() >= MAX_EXTRAS) return null;
    const center = this.subjectCenter(_v);
    const camAz = this._cameraAzimuth(center);
    // spawn in front of the subject, near enough to be visible (and grabbable) on screen
    const dist = Math.max(0.4, Math.min(2.2, this.sunHandleRadius() * 1.3));
    const d = makeLightData({
      role: 'extra', type, intensity: 1.4, kelvin: type === 'point' ? 3200 : 5600,
      az: camAz + (this.extrasCount() % 2 ? -35 : 35) * DEG, el: 25 * DEG, dist,
      target: center.toArray(), shadow: type === 'spot', soft: 0.3, angle: 50,
    });
    this.state.lights.push(d);
    this.state.preset = null;
    this._syncLight(d);
    this.selectedId = d.id;
    this._afterChange(false);
    this._emit('select');
    return d.id;
  }

  removeLight(id) {
    const d = this.get(id);
    if (!d || d.role !== 'extra') return;
    this.state.lights.splice(this.state.lights.indexOf(d), 1);
    this._disposeEntry(id);
    if (this.selectedId === id) this.selectedId = this.state.lights[0]?.id;
    this.state.preset = null;
    this._afterChange(false);
    this._emit('select');
  }

  /** Re-aims spot/point lights (and the preset pivot) at the selected character. */
  aimAtSubject() {
    const c = this.subjectCenter(_v2).toArray();
    for (const d of this.state.lights) if (d.type !== 'sun') { d.target = [...c]; this._syncLight(d); }
    this._afterChange(false);
  }

  applyPreset(id) {
    const p = presetById.get(id);
    if (!p) return;
    const center = this.subjectCenter(new THREE.Vector3());
    const camAz = this._cameraAzimuth(center);
    const prevSel = this.selected?.role;
    const lights = p.lights.map((l) => makeLightData({
      ...l,
      az: camAz + (l.relAz || 0) * DEG,
      el: (l.el ?? 30) * DEG,
      dist: l.dist ?? 2.5,
      target: center.toArray(),
      shadow: l.shadow ?? false,
    }));
    if (!lights.some((l) => l.role === 'rim')) lights.splice(1, 0, makeLightData({ role: 'rim', on: false, az: camAz + Math.PI * 0.85, el: 30 * DEG, target: center.toArray() }));
    for (const id of [...this.entries.keys()]) this._disposeEntry(id);
    this.state.lights = lights;
    this.state.ambient = { intensity: 0.8, kelvin: 7500, color: null, ground: null, ...p.ambient };
    this.state.preset = id;
    this.selectedId = (lights.find((l) => l.role === prevSel) || lights[0]).id;
    this._syncAll();
    this._afterChange(false);
    this._emit('select');
  }

  _cameraAzimuth(center) {
    const c = this.app.camera.position;
    const dx = c.x - center.x, dz = c.z - center.z;
    return Math.abs(dx) + Math.abs(dz) < 1e-6 ? 0 : Math.atan2(dx, dz);
  }

  _afterChange(live) {
    this._fitAllShadows();
    this._updateHandles();
    this.app.invalidate();
    if (!live) this._appliedKey = JSON.stringify(this.state);
    this._emit(live ? 'live' : 'change');
  }

  _emit(what) { this.dispatchEvent({ type: 'change', what }); }

  // ---------------------------------------------------------------- three.js sync
  _syncAll() {
    const ids = new Set(this.state.lights.map((l) => l.id));
    for (const id of [...this.entries.keys()]) if (!ids.has(id)) this._disposeEntry(id);
    this._syncAmbient();
    for (const d of this.state.lights) this._syncLight(d);
    this._fitAllShadows();
    this._updateHandleVisibility();
    this._updateHandles();
    this.app.invalidate();
  }

  _syncAmbient() {
    const a = this.state.ambient;
    if (a.color) this.hemi.color.set(a.color); else setColorFromKelvin(this.hemi.color, a.kelvin ?? 7500);
    if (a.ground) this.hemi.groundColor.set(a.ground);
    else this.hemi.groundColor.copy(this.hemi.color).multiplyScalar(0.18).add(_v.set(0.05, 0.04, 0.035));
    this.hemi.intensity = a.intensity;
  }

  /**
   * Image-based fill scale. The render module applies style env x envScale
   * (render/index.js applyEnv), so low-key setups (Rembrandt, horror, night)
   * are not flattened by a constant environment light.
   */
  get envScale() {
    return Math.max(0, Math.min(ENV_MAX_SCALE, (this.state.ambient.intensity ?? ENV_REF_AMBIENT) / ENV_REF_AMBIENT));
  }

  _disposeEntry(id) {
    const e = this.entries.get(id);
    if (!e) return;
    this.group.remove(e.light);
    if (e.light.target) this.group.remove(e.light.target);
    e.light.dispose();
    this.handleGroup.remove(e.handle, e.line);
    e.handle.material.dispose();
    e.line.geometry.dispose(); e.line.material.dispose();
    this.entries.delete(id);
  }

  _syncLight(d) {
    let e = this.entries.get(d.id);
    if (e && e.type !== d.type) { this._disposeEntry(d.id); e = null; }
    if (!e) {
      const light = createLight(d.type);
      this.group.add(light);
      if (light.target) this.group.add(light.target);
      const handle = makeHandle(d.type);
      const line = makeLine();
      this.handleGroup.add(line, handle);
      e = { light, type: d.type, handle, line, shadowSize: light.shadow.mapSize.x };
      this.entries.set(d.id, e);
    }
    const L = e.light;
    L.visible = !!d.on;
    if (d.color) L.color.set(d.color); else setColorFromKelvin(L.color, d.kelvin);
    dirFromAzEl(d.az, d.el, _dir);
    if (d.type === 'sun') {
      L.intensity = d.intensity;
      this._placeSun(d, L);
    } else {
      L.position.fromArray(d.target).addScaledVector(_dir, d.dist);
      L.intensity = d.intensity * d.dist * d.dist;
      if (d.type === 'spot') {
        L.target.position.fromArray(d.target);
        L.angle = Math.max(2, Math.min(170, d.angle)) * 0.5 * DEG;
        L.penumbra = d.penumbra;
        L.target.updateMatrixWorld();
      }
      L.shadow.camera.far = d.dist + 8;
    }
    L.castShadow = !!(d.on && d.shadow);
    // handle tint: light color pushed toward white so it stays readable
    e.handle.material.color.copy(L.color).lerp(_white, 0.3);
    e.line.material.color.copy(e.handle.material.color);
  }

  // ---------------------------------------------------------------- shadows
  /**
   * Fits every shadow camera. Directional lights get an orthographic frustum
   * tightly wrapped around the bounds of all characters/props (in light space),
   * extended in depth so that shadows falling on the ground are covered.
   * Softness is expressed in world units and converted to a PCF radius in
   * texels; very soft shadows use a smaller map so the grid PCF stays smooth
   */
  _fitAllShadows() {
    for (const d of this.state.lights) {
      const e = this.entries.get(d.id);
      if (!e || !e.light.castShadow) continue;
      if (d.type === 'sun') this._fitSun(d, e);
      else this._fitLocal(d, e);
    }
  }

  _setShadowResolution(e, size) {
    const s = e.light.shadow;
    e.res = size;
    if (s.mapSize.x === size) return;
    s.mapSize.set(size, size);
    if (s.map) { s.map.dispose(); s.map = null; }
  }

  /**
   * A directional light shines along target -> position: place both around
   * the scene bounds (the distance only matters for the shadow camera).
   */
  _placeSun(d, L) {
    this._fitBox.getBoundingSphere(_sphere);
    dirFromAzEl(d.az, d.el, _dir);
    L.target.position.copy(_sphere.center);
    L.position.copy(_sphere.center).addScaledVector(_dir, _sphere.radius + 1.5);
    L.updateMatrixWorld(); L.target.updateMatrixWorld();
  }

  _fitSun(d, e) {
    const L = e.light, box = this._fitBox;
    this._placeSun(d, L); // leaves the bounding sphere in _sphere
    const cam = L.shadow.camera;
    cam.position.copy(L.position);
    cam.lookAt(_sphere.center);
    cam.updateMatrixWorld(true);
    _m.copy(cam.matrixWorld).invert();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(_m);
      if (_v.x < x0) x0 = _v.x; if (_v.x > x1) x1 = _v.x;
      if (_v.y < y0) y0 = _v.y; if (_v.y > y1) y1 = _v.y;
      if (_v.z < z0) z0 = _v.z; if (_v.z > z1) z1 = _v.z;
    }
    const near = Math.max(0.05, -z1 - 0.1);
    // receivers: a caster at height h throws its shadow h / sin(el) further along the light direction
    const groundReach = _dir.y > 0.02 ? Math.min(40, Math.max(0, box.max.y) / Math.max(_dir.y, 0.1)) : 0;
    const far = Math.min(near + 90, -z0 + groundReach + 0.5);
    const size = Math.max(x1 - x0, y1 - y0);
    const { res, radius, texel } = shadowResolution(size, d.soft, this._maxRes.d2, MAX_RADIUS_2D, this._forcedRes.d2);
    this._setShadowResolution(e, res);
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1;
    cam.near = near; cam.far = far;
    cam.updateProjectionMatrix();
    const s = L.shadow;
    s.radius = radius;
    s.bias = -0.0015 / (far - near);
    s.normalBias = normalBiasFor(texel, radius);
    s.needsUpdate = true;
  }

  _fitLocal(d, e) {
    const L = e.light, s = L.shadow;
    // frustum width at the target distance
    const half = d.type === 'spot' ? Math.tan(Math.min(80, d.angle * 0.5) * DEG) : 1;
    const size = 2 * d.dist * half;
    const { res, radius, texel } = d.type === 'spot'
      ? shadowResolution(size, d.soft, this._maxRes.spot, MAX_RADIUS_2D, this._forcedRes.d2)
      : shadowResolution(size, d.soft, this._maxRes.point, MAX_RADIUS_POINT, this._forcedRes.point);
    this._setShadowResolution(e, res);
    s.radius = radius;
    s.bias = -0.0004;
    s.normalBias = normalBiasFor(texel, s.radius);
    s.camera.near = 0.05;
    s.camera.far = d.dist + 8;
    s.camera.updateProjectionMatrix();
    s.needsUpdate = true;
  }

  /**
   * Upper bound for shadow map sizes (e.g. from a render quality preset).
   * The rig still lowers the resolution of soft shadows below this cap.
   */
  setShadowQuality(size) {
    size = Math.max(256, Math.min(8192, size | 0));
    this._maxRes.d2 = size;
    this._maxRes.spot = Math.max(256, size >> 1);
    this._maxRes.point = Math.max(256, size >> 2);
    this._forcedRes.d2 = this._forcedRes.point = 0;
    this._fitAllShadows();
    this.app.invalidate();
  }

  /**
   * If another module rewrites the shadow map size of our lights, adopt that
   * size (and recompute the PCF radius for it) instead of re-allocating maps
   * back and forth every frame.
   */
  _checkExternalShadowSizes() {
    let changed = false;
    for (const e of this.entries.values()) {
      if (!e.light.castShadow || !e.res) continue;
      const ms = e.light.shadow.mapSize.x;
      if (ms === e.res) continue;
      const key = e.light.isPointLight ? 'point' : 'd2';
      if (this._forcedRes[key] !== ms) { this._forcedRes[key] = ms; changed = true; }
      e.res = ms;
    }
    if (changed) { this._fitAllShadows(); this.app.invalidate(); }
  }

  markWorldDirty() { this._worldDirty = true; }

  /** Cheap signature of the placement of everything in app.world. */
  _signature() {
    const ch = this.app.world.children;
    let s = ch.length * 1000;
    for (let i = 0; i < ch.length; i++) {
      const o = ch[i], p = o.position, q = o.quaternion, k = i + 1;
      s += k * (p.x * 1.31 + p.y * 2.17 + p.z * 3.07 + q.x * 5.3 + q.y * 7.1 + q.z * 11.3 + q.w * 0.7 + o.scale.x * 13.7 + (o.visible ? 17 : 0));
    }
    return s;
  }

  _refreshBounds() {
    if (!worldBounds(this.app, this._worldBox)) this._worldBox.set(_v.set(-0.6, 0, -0.4), _v2.set(0.6, 1.9, 0.4));
    const wb = this._worldBox, fb = this._fitBox;
    // big sets (buildings, streets, forests): keep the shadow map focused around the
    // characters so their shadows stay crisp; far scenery still casts within ~25 m
    const chars = this.app.characters.filter((c) => c.root.visible);
    if (chars.length) {
      let cx = 0, cz = 0;
      for (const c of chars) { cx += c.root.position.x; cz += c.root.position.z; }
      cx /= chars.length; cz /= chars.length;
      const R = 25;
      wb.min.x = Math.max(wb.min.x, cx - R); wb.max.x = Math.min(wb.max.x, cx + R);
      wb.min.z = Math.max(wb.min.z, cz - R); wb.max.z = Math.min(wb.max.z, cz + R);
      wb.max.y = Math.min(wb.max.y, 40);
      if (wb.isEmpty()) wb.set(_v.set(cx - 0.6, 0, cz - 0.4), _v2.set(cx + 0.6, 1.9, cz + 0.4));
    }
    // hysteresis: refit only when something leaves the fitted box or it became much too large
    const tooBig = (fb.max.x - fb.min.x) - (wb.max.x - wb.min.x) > 0.9 || (fb.max.y - fb.min.y) - (wb.max.y - wb.min.y) > 0.9 || (fb.max.z - fb.min.z) - (wb.max.z - wb.min.z) > 0.9;
    if (fb.containsBox(wb) && !tooBig) return false;
    fb.copy(wb).expandByScalar(0.2);
    return true;
  }

  // ---------------------------------------------------------------- per frame
  /** Called from the scene module's render hook (after OrbitControls.update). */
  onFrame(now) {
    if (now - this._lastSig > 250) {
      this._lastSig = now;
      const s = this._signature();
      if (s !== this._sig) { this._sig = s; this._worldDirty = true; }
      this._checkExternalShadowSizes();
    }
    if (this._worldDirty && now - this._lastFit > 120 && !this._drag) {
      this._worldDirty = false;
      this._lastFit = now;
      if (this._refreshBounds()) {
        for (const d of this.state.lights) { const e = this.entries.get(d.id); if (e && d.type === 'sun') this._placeSun(d, e.light); }
        this._fitAllShadows();
        this.app.invalidate();
      }
    }
    if (this.handleGroup.visible && this._viewChanged()) this._updateHandles();
  }

  /** True when the camera moved / zoomed / resized since the last handle update. */
  _viewChanged() {
    // position/quaternion are final here (matrixWorld is only refreshed by the render)
    const cam = this.app.camera, k = this._viewKey, p = cam.projectionMatrix.elements;
    const t = this.app.controls.target, H = this.app.canvas.clientHeight, P = cam.position, Q = cam.quaternion;
    const vals = this._viewVals;
    vals[0] = P.x; vals[1] = P.y; vals[2] = P.z; vals[3] = Q.x; vals[4] = Q.y; vals[5] = Q.z; vals[6] = Q.w;
    vals[7] = p[0]; vals[8] = p[5]; vals[9] = H; vals[10] = t.x; vals[11] = t.y; vals[12] = t.z;
    let changed = false;
    for (let i = 0; i < 13; i++) if (k[i] !== vals[i]) { k[i] = vals[i]; changed = true; }
    return changed;
  }

  // ---------------------------------------------------------------- handles
  setHandlesWanted(on) { this._handlesWanted = !!on; this._updateHandleVisibility(); }

  _updateHandleVisibility() {
    const v = this._handlesWanted && this.state.handles !== false;
    if (this.handleGroup.visible !== v) { this.handleGroup.visible = v; this.app.invalidate(); }
    if (v) this._updateHandles();
  }

  _updateHandles() {
    if (!this.handleGroup.visible) return;
    const cam = this.app.camera;
    const H = this.app.canvas.clientHeight || 1;
    const P11 = cam.projectionMatrix.elements[5];
    const unit = 2 / (P11 * H); // sprite scale per screen pixel (sizeAttenuation off)
    const sel = this.selected;
    for (const d of this.state.lights) {
      const e = this.entries.get(d.id);
      if (!e) continue;
      const active = sel && d.id === sel.id;
      this.handlePosition(d, e.handle.position);
      e.handle.scale.setScalar((active ? 46 : 36) * unit);
      e.handle.material.opacity = d.on ? (active ? 1 : 0.8) : 0.35;
      const pa = e.line.geometry.attributes.position;
      this.pivotOf(d, _v);
      pa.setXYZ(0, e.handle.position.x, e.handle.position.y, e.handle.position.z);
      pa.setXYZ(1, _v.x, _v.y, _v.z);
      pa.needsUpdate = true;
      const ld = e.line.geometry.attributes.lineDistance;
      ld.setX(1, e.handle.position.distanceTo(_v));
      ld.needsUpdate = true;
      e.line.material.opacity = active ? 0.85 : 0.35;
      e.line.material.dashSize = 0.05 * (e.handle.position.distanceTo(cam.position) * 0.3 + 0.3);
      e.line.material.gapSize = e.line.material.dashSize * 0.7;
    }
    if (sel) {
      this.pivotOf(sel, this.targetMarker.position);
      this.targetMarker.scale.setScalar(22 * unit);
      this.targetMarker.material.opacity = 0.9;
      this.targetMarker.visible = true;
    } else this.targetMarker.visible = false;
  }

  /** Index of the handle under a client point (or null). */
  pickHandle(clientX, clientY) {
    if (!this.handleGroup.visible) return null;
    const cam = this.app.camera, r = this.app.canvas.getBoundingClientRect();
    let best = null, bestD = 34 * 34;
    for (const d of this.state.lights) {
      const e = this.entries.get(d.id);
      if (!e) continue;
      _v.copy(e.handle.position).applyMatrix4(cam.matrixWorldInverse);
      if (_v.z > -0.01) continue; // behind the camera
      _v.applyMatrix4(cam.projectionMatrix);
      const sx = r.left + (_v.x + 1) * 0.5 * r.width, sy = r.top + (1 - _v.y) * 0.5 * r.height;
      const dd = (sx - clientX) ** 2 + (sy - clientY) ** 2;
      // the selected light wins ties
      const bias = this.selectedId === d.id ? 0.8 : 1;
      if (dd * bias < bestD) { bestD = dd * bias; best = { id: d.id, sx, sy }; }
    }
    return best;
  }

  // ---------------------------------------------------------------- dragging
  _setupInput() {
    const app = this.app, c = app.canvas;
    const down = (e) => {
      if (this._drag) { // ignore extra fingers while dragging a handle
        if (e.pointerId !== this._drag.pointerId) { e.stopImmediatePropagation(); }
        return;
      }
      if (e.button > 0) return;
      const hit = this.pickHandle(e.clientX, e.clientY);
      if (!hit) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const d = this.get(hit.id);
      this.select(hit.id);
      const ent = this.entries.get(hit.id);
      this._drag = {
        pointerId: e.pointerId, id: hit.id,
        offX: hit.sx - e.clientX, offY: hit.sy - e.clientY,
        mode: d.type === 'point' ? 'plane' : 'sphere',
        radius: d.type === 'sun' ? this.sunHandleRadius() : d.dist,
        center: this.pivotOf(d, new THREE.Vector3()),
        last: ent.handle.position.clone(),
        planePoint: ent.handle.position.clone(),
        controlsWasEnabled: app.controls.enabled,
        moved: false,
      };
      app.controls.enabled = false;
      this._dragHint(d);
    };
    const move = (e) => {
      const g = this._drag;
      if (!g || e.pointerId !== g.pointerId) return;
      e.stopImmediatePropagation();
      this._dragTo(e.clientX + g.offX, e.clientY + g.offY);
    };
    const up = (e) => {
      const g = this._drag;
      if (!g || e.pointerId !== g.pointerId) return;
      e.stopImmediatePropagation();
      this._drag = null;
      app.controls.enabled = g.controlsWasEnabled;
      try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      app.shell?.hint('');
      if (g.moved) {
        this._appliedKey = JSON.stringify(this.state);
        this._worldDirty = true;
        this._emit('change');
        app.commit('luce');
      }
    };
    c.addEventListener('pointerdown', down, { capture: true });
    c.addEventListener('pointermove', move, { capture: true });
    c.addEventListener('pointerup', up, { capture: true });
    c.addEventListener('pointercancel', up, { capture: true });
  }

  get dragging() { return !!this._drag; }

  _dragTo(clientX, clientY) {
    const g = this._drag, d = this.get(g.id);
    if (!d) return;
    const app = this.app;
    app.pointerToNDC({ clientX, clientY }, _ndc);
    this._raycaster.setFromCamera(_ndc, app.camera);
    const ray = this._raycaster.ray;
    const patch = {};
    if (g.mode === 'sphere') {
      // intersect the pointer ray with the sphere around the pivot; pick the
      // intersection closest to the previous handle position (continuity), or
      // slide along the silhouette when the ray misses the sphere
      const C = g.center, R = g.radius;
      const ox = ray.origin.x - C.x, oy = ray.origin.y - C.y, oz = ray.origin.z - C.z;
      const b = ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z;
      const c2 = ox * ox + oy * oy + oz * oz - R * R;
      const disc = b * b - c2;
      if (disc >= 0) {
        const s = Math.sqrt(disc);
        ray.at(-b - s, _v);
        ray.at(-b + s, _v2);
        const p = (-b - s > 0 && _v.distanceToSquared(g.last) <= _v2.distanceToSquared(g.last)) || -b + s <= 0 ? _v : _v2;
        _dir.subVectors(p, C).normalize();
      } else {
        ray.at(Math.max(0, -b), _v);
        _dir.subVectors(_v, C).normalize();
      }
      g.last.copy(C).addScaledVector(_dir, R);
      azElFromDir(_dir, patch);
    } else {
      // point light: move in the camera-facing plane through the grab point
      app.camera.getWorldDirection(_v2);
      _plane.setFromNormalAndCoplanarPoint(_v2, g.planePoint);
      if (!ray.intersectPlane(_plane, _v)) return;
      _v.y = Math.max(0.03, _v.y);
      const T = _v2.fromArray(d.target);
      _dir.subVectors(_v, T);
      const dist = Math.max(0.15, _dir.length());
      _dir.multiplyScalar(1 / dist);
      azElFromDir(_dir, patch);
      patch.dist = Math.min(12, dist);
    }
    g.moved = true;
    this.set(g.id, patch, { live: true });
    this._dragHint(d);
  }

  _dragHint(d) {
    const deg = (r) => Math.round(r / DEG);
    const label = lightLabel(d, this.state.lights);
    this.app.shell?.hint(`${label} · azimut ${deg(d.az)}° · elevazione ${deg(d.el)}°${d.type === 'sun' ? '' : ` · ${d.dist.toFixed(1)} m`}`);
  }
}
