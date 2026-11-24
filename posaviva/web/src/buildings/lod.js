// Runtime helpers for building props (no per-frame work):
//  - LOD: small detail meshes (frames, sills, railings, shutters, rooftop
//    clutter…) are hidden when a building is small on screen. Re-evaluated only
//    when the camera / viewport / props change; full detail during captures.
//  - Night windows: lit window roles carry emissive fields in their material
//    spec; the material library does not apply emissive yet, so the cached
//    material (unique to that spec) is patched in realistic / toon styles.
import * as THREE from 'three';
import { isDetailRole, descOf } from './mats.js';

const _v = new THREE.Vector3(), _box = new THREE.Box3(), _s = new THREE.Sphere();
const HIDE_PX = 100, SHOW_PX = 125; // projected bounding-sphere radius (CSS px), with hysteresis

export const isBuilding = (p) => !!p && p.type?.cat === 'edifici';

export class BuildingRuntime {
  constructor(app) {
    this.app = app;
    this.full = false; // capture in progress: every detail visible
    this._raf = 0;
    const sched = () => this.schedule();
    app.props?.addEventListener('change', sched);
    app.props?.addEventListener('list', sched);
    app.controls?.addEventListener('change', () => this.scheduleLOD());
    app.sceneTools?.camera?.addEventListener?.('change', () => this.scheduleLOD());
    app.addEventListener('resize', () => this.scheduleLOD());
    app.addEventListener('loaded', sched);
    app.materials?.addEventListener?.('refresh', () => this.patchLit());
    app.addEventListener('capture', (e) => {
      if (e.phase === 'before') { this.full = true; this.applyLOD(); }
      else { this.full = false; this.applyLOD(); }
    });
  }

  get buildings() { return (this.app.props?.props || []).filter(isBuilding); }

  schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.patchLit(); this.applyLOD(); });
  }

  scheduleLOD() {
    if (this._lodRaf) return;
    this._lodRaf = requestAnimationFrame(() => { this._lodRaf = 0; this.applyLOD(); });
  }

  /** Emissive for lit windows / lamps (realistic + toon only: clay stays matte, lines has no lighting). */
  patchLit() {
    const mats = this.app.materials, style = mats?.style;
    const on = style === 'realistic' || style === 'toon';
    let changed = false;
    for (const p of this.buildings) for (const mesh of p.meshes) {
      const d = descOf(mesh.userData.role);
      if (!d?.lit) continue;
      const m = mesh.material, spec = mats.tracked?.get(mesh);
      if (!m || !spec || !m.emissive || m.userData.pvBldLit === style) continue;
      if (on) {
        m.emissive.set(spec.emissive || '#ffd9a0');
        m.emissiveIntensity = spec.emissiveIntensity ?? 1;
        if (spec.emissiveMap) m.emissiveMap = spec.emissiveMap;
        m.needsUpdate = true;
      }
      m.userData.pvBldLit = style;
      changed = true;
    }
    if (changed) this.app.invalidate();
  }

  /** Hides / shows detail meshes from the projected size of each building. */
  applyLOD() {
    const app = this.app, cam = app.camera;
    const h = app.canvas?.clientHeight || 800;
    const k = h / 2 / Math.tan((cam.fov * Math.PI) / 360);
    let changed = false;
    for (const p of this.buildings) {
      let detail = true;
      if (!this.full) {
        p.worldBox(_box);
        _box.getBoundingSphere(_s);
        const dist = Math.max(0.1, cam.position.distanceTo(_s.center) - _s.radius * 0.5);
        const px = (_s.radius / dist) * k;
        const was = p._bldDetail !== false;
        detail = was ? px > HIDE_PX : px > SHOW_PX;
      }
      if (p._bldDetail === detail && p._bldFirst === p.meshes[0]) continue;
      if (p._bldFirst !== p.meshes[0]) for (const mesh of p.meshes) { const d = descOf(mesh.userData.role); if (d && !d.cast) mesh.castShadow = false; }
      p._bldDetail = detail;
      p._bldFirst = p.meshes[0];
      for (const mesh of p.meshes) if (isDetailRole(mesh.userData.role)) { if (mesh.visible !== detail) { mesh.visible = detail; changed = true; } }
    }
    if (changed) app.invalidate();
  }
}

export { _v };
