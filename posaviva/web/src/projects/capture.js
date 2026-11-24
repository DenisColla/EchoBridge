// Thumbnails of saved items: the camera view (scenes, landscapes) or one character
// alone, framed from the front three-quarter (characters, poses). Small JPEG data URLs.
import * as THREE from 'three';

export const THUMB_W = 180, THUMB_H = 240;
const BG_TOP = '#30323d', BG_BOTTOM = '#1b1d24';

const _box = new THREE.Box3(), _v = new THREE.Vector3(), _c = new THREE.Vector3();
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function cover(src, w, h, bg = true) {
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const g = out.getContext('2d');
  if (bg) {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, BG_TOP); gr.addColorStop(1, BG_BOTTOM);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  const s = Math.min(src.width / w, src.height / h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, (src.width - w * s) / 2, (src.height - h * s) / 2, w * s, h * s, 0, 0, w, h);
  return out;
}

/** Resolves when the outfits being built are done (max `ms`), so thumbnails show the final look. */
export async function settled(app, ms = 3000) {
  // garment rebuilds after a pose / outfit change are queued on the next frame: let it start
  await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise((r) => setTimeout(r, 120))]);
  const idle = app.clothing?.whenIdle?.();
  if (idle) await Promise.race([idle.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
}

/**
 * The current camera view, 3:4, cover crop (scene / landscape cards). -> data URL | null
 * {noCharacters}: the characters (and what they hold) are hidden — a landscape card shows the place.
 */
export async function viewThumb(app, { w = THUMB_W, h = THUMB_H, noCharacters = false } = {}) {
  await settled(app);
  if (!app.capture || app.contextLost) return null;
  const hidden = [];
  let pending = null;
  try {
    if (noCharacters) {
      for (const ch of app.characters) if (ch.root.visible) { ch.root.visible = false; hidden.push(ch.root); }
      for (const p of app.props?.props || []) if (p.hold && p.root?.visible) { p.root.visible = false; hidden.push(p.root); }
    }
    const c = app.canvas, aspect = (c.clientWidth || 1) / (c.clientHeight || 1);
    // the capture renders synchronously: visibility is restored before any screen frame
    pending = app.capture(aspect < w / h ? { width: Math.round(w * 1.4), transparent: false } : { height: Math.round(h * 1.4), transparent: false });
  } catch (e) { console.warn('[PosaViva] thumbnail failed', e); }
  finally {
    for (const o of hidden) o.visible = true;
    if (hidden.length) { app.lightRig?.markWorldDirty?.(); app.invalidate(); }
  }
  if (!pending) return null;
  try { return cover(await pending, w, h, false).toDataURL('image/jpeg', 0.74); }
  catch (e) { console.warn('[PosaViva] thumbnail failed', e); return null; }
}

/** Sampled world points of a character's skinned body and their bounds (+ margins for hair and soles). */
function bodyPoints(ch) {
  _box.makeEmpty();
  ch.root.updateWorldMatrix(true, true);
  const P = ch.getSkinnedPositions(), M = ch.rig.matrixWorld, verts = ch.model.groupVertices[0];
  const out = new Float32Array(Math.ceil(verts.length / 5) * 3);
  let k = 0;
  for (let i = 0; i < verts.length; i += 5) {
    const j = verts[i] * 3;
    _v.set(P[j], P[j + 1], P[j + 2]).applyMatrix4(M);
    out[k++] = _v.x; out[k++] = _v.y; out[k++] = _v.z;
    _box.expandByPoint(_v);
  }
  const sc = ch.root.scale.y || 1;
  _box.max.y += 0.06 * sc; _box.min.y -= 0.03 * sc;
  return { pts: out.subarray(0, k), box: _box };
}

/**
 * Camera that frames the points from direction `dir` (unit, towards the camera) with a
 * vertical fov and an aspect: the projected extents are centered and fill `fill` of the
 * frame (perspective-correct, per point). -> {position, target}
 */
function fitPoints(pts, box, dir, fov, aspect, fill = 0.86) {
  box.getCenter(_c);
  _r.crossVectors(UP, dir).normalize(); // camera right
  _u.crossVectors(dir, _r).normalize(); // camera up
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    _q.set(pts[i] - _c.x, pts[i + 1] - _c.y, pts[i + 2] - _c.z);
    const x = _q.dot(_r), y = _q.dot(_u);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  // hair above the sampled skin and the soles below it
  y1 = Math.max(y1, box.max.y - _c.y); y0 = Math.min(y0, box.min.y - _c.y);
  const target = _c.clone().addScaledVector(_r, (x0 + x1) / 2).addScaledVector(_u, (y0 + y1) / 2);
  const tanY = Math.tan(fov / 2) * fill, tanX = tanY * aspect;
  let dist = Math.max(0.5, (y1 - y0) / 2 / tanY);
  for (let i = 0; i < pts.length; i += 3) {
    _q.set(pts[i] - target.x, pts[i + 1] - target.y, pts[i + 2] - target.z);
    const z = _q.dot(dir), x = Math.abs(_q.dot(_r)), y = Math.abs(_q.dot(_u));
    dist = Math.max(dist, z + x / tanX, z + y / tanY);
  }
  return { position: target.clone().addScaledVector(dir, dist), target };
}

/**
 * One character alone (other characters, objects and the landscape hidden), from the
 * front three-quarter, transparent capture composited on a soft gradient. The camera
 * and every visibility flag are restored before any frame is drawn (the capture renders
 * synchronously). -> data URL | null
 */
export async function subjectThumb(app, ch, w = THUMB_W, h = THUMB_H) {
  await settled(app);
  if (!ch || !app.capture || app.contextLost || !app.characters.includes(ch)) return null;
  const cam = app.camera;
  const saved = { p: cam.position.clone(), q: cam.quaternion.clone(), up: cam.up.clone() };
  const hidden = [];
  const hide = (o) => { if (o.visible) { o.visible = false; hidden.push(o); } };
  let pending = null;
  try {
    for (const o of app.world.children) if (o !== ch.root) hide(o);
    for (const o of app.scene.children) {
      if (o === app.world || o === app.ground || o === cam || o.isLight) continue;
      let lights = false;
      o.traverse((x) => { if (x.isLight) lights = true; });
      if (!lights) hide(o);
    }
    const { pts, box } = bodyPoints(ch);
    const yaw = ch.root.rotation.y + 0.42; // three-quarter from the character's left-front
    _d.set(Math.sin(yaw), 0.16, Math.cos(yaw)).normalize();
    const fit = fitPoints(pts, box, _d, THREE.MathUtils.degToRad(cam.fov || 35), w / h);
    cam.up.copy(UP);
    cam.position.copy(fit.position);
    cam.lookAt(fit.target);
    cam.updateMatrixWorld();
    pending = app.capture({ width: w * 2, height: h * 2, transparent: true });
  } catch (e) {
    console.warn('[PosaViva] character thumbnail failed', e);
  } finally {
    cam.position.copy(saved.p); cam.quaternion.copy(saved.q); cam.up.copy(saved.up);
    cam.updateMatrixWorld();
    for (const o of hidden) o.visible = true;
    // shadow maps were rendered with the other objects hidden
    app.lightRig?.markWorldDirty?.();
    app.invalidate();
  }
  if (!pending) return null;
  try { return cover(await pending, w, h, true).toDataURL('image/jpeg', 0.8); }
  catch (e) { console.warn('[PosaViva] character thumbnail failed', e); return null; }
}
