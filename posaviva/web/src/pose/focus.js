// Camera close-ups for the Viso and Mani tools ("Primo piano", "Inquadra la mano").
//
// The orbit camera tweens so that a region of a character (head, hand) fills a
// fraction of the FREE view: the part of the canvas not covered by the tool
// panel, as shown through the UI view offset (app.modules.ui.viewOffset), which
// keeps its own fitting rules. The final pose is found by asking the view offset
// what it would show (vo.update() at candidate camera poses, synchronously, no
// render in between), so both stay consistent: when the camera tween ends, the
// camera rig's refit computes the same offset again.
//
// Nothing is committed (camera framing is a view change, like orbiting).
import * as THREE from 'three';

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _t = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _Hw = new THREE.Matrix4(), _Ri = new THREE.Matrix4();
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- regions
const _regions = new WeakMap(); // model -> {head, hand:{L,R}} body vertex lists by dominant bone
function regions(model) {
  let r = _regions.get(model);
  if (r) return r;
  const SI = model.skinIndex, SW = model.skinWeight;
  const lists = { head: [], L: [], R: [] };
  const handRe = /^(wrist|metacarpal|finger)/;
  for (const v of model.groupVertices[0]) {
    let best = -1, bw = 0;
    for (let k = 0; k < 4; k++) if (SW[v * 4 + k] > bw) { bw = SW[v * 4 + k]; best = SI[v * 4 + k]; }
    if (best < 0) continue;
    const name = model.bones[best].name;
    if (name === 'head') lists.head.push(v);
    else if (handRe.test(name)) lists[name.endsWith('.L') ? 'L' : 'R'].push(v);
  }
  r = { head: Int32Array.from(lists.head), hand: { L: Int32Array.from(lists.L), R: Int32Array.from(lists.R) } };
  _regions.set(model, r);
  return r;
}

/** World positions (packed xyz) of body vertices of a character (current pose). */
function worldPoints(ch, verts, step = 2) {
  ch.root.updateWorldMatrix(true, true);
  const P = ch.getSkinnedPositions(), M = ch.rig.matrixWorld;
  const out = new Float32Array(Math.ceil(verts.length / step) * 3);
  let n = 0;
  for (let i = 0; i < verts.length; i += step) {
    const k = verts[i] * 3;
    _v.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(M);
    out[n++] = _v.x; out[n++] = _v.y; out[n++] = _v.z;
  }
  return out.subarray(0, n);
}

function centerOf(pts, out) {
  const box = new THREE.Box3();
  for (let i = 0; i < pts.length; i += 3) box.expandByPoint(_v.set(pts[i], pts[i + 1], pts[i + 2]));
  return box.getCenter(out);
}

/** World direction the face looks at (rig +Z carried by the head bone). */
export function faceForward(ch, out = new THREE.Vector3()) {
  const hi = ch.model.boneIndex.get('head');
  ch.root.updateWorldMatrix(true, true);
  _Hw.copy(ch.bones[hi].matrixWorld);
  _Ri.copy(ch.restGlobal[hi]).invert();
  // rest rig space -> head-local -> world
  _m.multiplyMatrices(_Hw, _Ri);
  return out.set(0, 0, 1).transformDirection(_m);
}

// ---------------------------------------------------------------- framing
/**
 * Free area of the canvas (CSS px) and the view-offset mapping that will apply
 * for the camera's CURRENT pose: screen = (W/2 + ox, H/2 + oy) + s * (p - (W/2, H/2)),
 * p = un-offset projection.
 */
function freeView(app, shell) {
  const W = app.canvas.clientWidth || 1, H = app.canvas.clientHeight || 1;
  const ins = shell?.getViewInsets?.() || { top: 0, right: 0, bottom: 0, left: 0 };
  const F = { x: ins.left, y: ins.top, w: Math.max(60, W - ins.left - ins.right), h: Math.max(60, H - ins.top - ins.bottom) };
  return { W, H, F };
}

function offsetFor(app) {
  const vo = app.modules?.ui?.viewOffset;
  if (!vo?.update) return { s: 1, ox: 0, oy: 0 };
  vo.update(); // target offset for the current camera pose (animated from where it is now)
  const t = vo.target || vo.cur;
  return t ? { s: t.s, ox: t.ox, oy: t.oy } : { s: 1, ox: 0, oy: 0 };
}

/** On-screen rect (CSS px, after the view offset) of world points for the current camera pose. */
function screenRect(cam, pts, W, H, off) {
  cam.updateMatrixWorld();
  const view = cam.view, had = !!view?.enabled;
  if (had) { view.enabled = false; cam.updateProjectionMatrix(); }
  _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  if (had) { view.enabled = true; cam.updateProjectionMatrix(); }
  const e = _m.elements;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= cam.near) continue;
    const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w * 0.5 + 0.5) * W;
    const sy = (0.5 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w * 0.5) * H;
    if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
  }
  if (!(x1 > x0)) return null;
  const map = (px, py) => [W / 2 + off.ox + off.s * (px - W / 2), H / 2 + off.oy + off.s * (py - H / 2)];
  const [a, b] = map(x0, y0), [c, d] = map(x1, y1);
  return { x: a, y: b, w: c - a, h: d - b, cx: (a + c) / 2, cy: (b + d) / 2 };
}

/**
 * Tweens the camera onto world points `pts` so that they fill `fill` of the free view
 * (largest of the height / width ratios). dir: unit vector from the region to the
 * camera (default: keep the current viewing direction). Returns false if nothing to do.
 */
export function focusPoints(app, shell, pts, opts = {}) {
  if (!pts || pts.length < 9) return false;
  // a full-height sheet leaves no view to frame into: lower it to half first
  if (shell?.mode === 'sheet' && shell.sheetSnap === 'full' && shell.setSheetSnap) {
    shell.setSheetSnap('half');
    setTimeout(() => focusNow(app, shell, pts, opts), 380); // after the sheet transition
    return true;
  }
  return focusNow(app, shell, pts, opts);
}

function focusNow(app, shell, pts, { dir = null, fill = 0.35, duration = 520 } = {}) {
  const cam = app.camera, controls = app.controls;
  const rig = app.sceneTools?.camera;
  const C = centerOf(pts, new THREE.Vector3());
  const D = (dir ? _d.copy(dir) : _d.subVectors(cam.position, controls.target)).normalize();
  if (!(D.lengthSq() > 0.5)) D.set(0, 0, 1);
  const p0 = cam.position.clone(), q0 = cam.quaternion.clone();
  const minD = Math.max(controls.minDistance || 0.1, cam.near * 4), maxD = controls.maxDistance || 50;
  const clampD = (x) => Math.max(minD, Math.min(maxD, x));
  const { W, H, F } = freeView(app, shell);
  const fcx = F.x + F.w / 2, fcy = F.y + F.h / 2;
  let d = clampD(cam.position.distanceTo(controls.target));
  let best = -1, bestErr = Infinity;
  const place = (dist) => { cam.position.copy(C).addScaledVector(D, dist); cam.lookAt(C); cam.updateMatrixWorld(); };
  try {
    for (let it = 0; it < 12; it++) {
      place(d);
      const r = screenRect(cam, pts, W, H, offsetFor(app));
      if (!r) { d = clampD(d * 1.5); continue; }
      const k = Math.max(r.h / F.h, r.w / F.w) / fill; // on-screen size ~ 1/d
      // the view offset fits a whole character that is not much larger than the screen
      // (the region is then off-center and small): go closer until it frames the detail
      const centered = Math.abs(r.cx - fcx) < 0.18 * F.w && Math.abs(r.cy - fcy) < 0.18 * F.h;
      if (!centered) { if (it === 0) d = clampD(d * k); else d = clampD(d * 0.82); continue; }
      const err = Math.abs(Math.log(k));
      if (err < bestErr) { bestErr = err; best = d; }
      if (err < 0.04) break;
      const nd = clampD(d * k);
      if (Math.abs(nd - d) < 1e-4) break;
      d = nd;
    }
    if (best > 0) d = best;
    // leave the view offset targeting the final pose: it animates while the camera moves
    place(d);
    offsetFor(app);
  } finally {
    cam.position.copy(p0); cam.quaternion.copy(q0);
    cam.updateMatrixWorld();
  }
  const P = C.clone().addScaledVector(D, d);
  if (rig?.applyView) {
    rig.applyView({ p: P.toArray(), t: C.toArray(), f: rig.focal, r: rig.roll }, { animate: true, commit: null, duration });
  } else tweenCamera(app, C, P, duration);
  app.invalidate();
  return true;
}

/** Minimal tween when the scene module (camera rig) is not loaded. */
function tweenCamera(app, target, position, duration) {
  const cam = app.camera, controls = app.controls;
  const fromT = controls.target.clone(), fromP = cam.position.clone(), start = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - start) / duration), e = 1 - Math.pow(1 - k, 3);
    controls.target.lerpVectors(fromT, target, e);
    cam.position.lerpVectors(fromP, position, e);
    cam.lookAt(controls.target);
    controls.update();
    app.invalidate();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Rotates unit vector a toward unit vector b by `ang` radians (around their common normal). */
function rotateToward(a, b, ang, out) {
  _p.copy(b).addScaledVector(a, -b.dot(a));
  if (_p.lengthSq() < 1e-6) _p.crossVectors(a, _t.set(0, 1, 0)); // b opposite to a: any side
  if (_p.lengthSq() < 1e-6) _p.set(1, 0, 0);
  _p.normalize();
  return out.copy(a).multiplyScalar(Math.cos(ang)).addScaledVector(_p, Math.sin(ang)).normalize();
}

/**
 * "Primo piano": the head of `ch` fills ~35% of the free view. The current view
 * direction is kept while it sees the face (within ~65°); otherwise the camera
 * moves to a 3/4 front view on the side it was on.
 */
export function focusHead(app, shell, ch, { fill = 0.35 } = {}) {
  if (!ch || !ch.root.visible) return false;
  const pts = worldPoints(ch, regions(ch.model).head, 2);
  const fwd = faceForward(ch, new THREE.Vector3());
  const cur = new THREE.Vector3().subVectors(app.camera.position, app.controls.target).normalize();
  let dir = cur;
  if (cur.dot(fwd) < Math.cos(65 * DEG)) {
    if (Math.abs(fwd.y) < 0.7) {
      // upright face: 3/4 front view on the side the camera was on, slightly above the eyes
      const fx = fwd.x, fz = fwd.z, hl = Math.hypot(fx, fz) || 1;
      const side = Math.sign((fz * cur.x - fx * cur.z) / hl) || 1; // + : camera on the +yaw side
      const a = side * 25 * DEG, el = 6 * DEG;
      const x = (fx * Math.cos(a) + fz * Math.sin(a)) / hl, z = (-fx * Math.sin(a) + fz * Math.cos(a)) / hl;
      dir = new THREE.Vector3(x * Math.cos(el), Math.sin(el), z * Math.cos(el));
    } else dir = rotateToward(fwd, cur, 25 * DEG, new THREE.Vector3()); // lying: from the camera's side
  }
  return focusPoints(app, shell, pts, { dir, fill });
}

/**
 * "Inquadra la mano": the hand of `side` ('L' | 'R') fills ~42% of the free view;
 * 'both' frames the two hands together across ~80% of it.
 */
export function focusHand(app, shell, ch, side, { fill = side === 'both' ? 0.8 : 0.42 } = {}) {
  if (!ch || !ch.root.visible) return false;
  const R = regions(ch.model).hand;
  const sides = side === 'both' ? ['L', 'R'] : [side];
  const parts = sides.map((s) => worldPoints(ch, R[s], 2));
  const pts = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { pts.set(p, o); o += p.length; }
  // keep the viewing direction, but never look straight down / up onto the hand
  const dir = new THREE.Vector3().subVectors(app.camera.position, app.controls.target).normalize();
  if (Math.abs(dir.y) > Math.sin(60 * DEG)) {
    const h = Math.hypot(dir.x, dir.z) || 1;
    const el = Math.sign(dir.y) * 45 * DEG;
    dir.set((dir.x / h) * Math.cos(el), Math.sin(el), (dir.z / h) * Math.cos(el));
    if (h < 1e-3) dir.set(0, Math.sin(el), Math.cos(el));
  }
  return focusPoints(app, shell, pts, { dir, fill });
}

