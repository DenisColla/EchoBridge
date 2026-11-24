// Environment layer of a landscape: sky dome, terrain + water, backdrop
// scatter, precipitation and fog. Rebuilt deterministically from a description
// (no state of its own is persisted: the landscape module stores {spec, seed}).
// Lights are not touched here (see lighting.js): the scene module persists them.
import * as THREE from 'three';
import { SkyDome } from './sky.js';
import { Terrain } from './terrain.js';
import { buildScatter, facadeTextures } from './vegetation.js';
import { Precipitation } from './weather.js';
import { dirFromAzEl } from '../lighting.js';

const _c = new THREE.Color(), _c2 = new THREE.Color();
const DEG = Math.PI / 180;

export class Environment {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'landscape:env';
    this.group.userData.landscape = 'env';
    app.scene.add(this.group);
    this.sky = new SkyDome();
    this.terrain = new Terrain(app.materials);
    this.precip = new Precipitation();
    this.scatter = null;
    this.desc = null;
    this.active = false;
    this.fog = null;
    this.style = app.materials.style;
    this._groundWas = null;
  }

  get heightAt() { return (x, z) => this.terrain.heightAt(x, z); }

  /**
   * desc: {atm, frame:{x,z,yaw}, seed, terrain: cfg | null, scatter: [{kind, look, items(local)}],
   *        precip: 'rain'|'snow'|null, sky: bool, below: hex}
   */
  build(desc) {
    this.clear(!desc.terrain); // no terrain (rooms): the studio floor comes back
    this.desc = desc;
    const { atm, frame } = desc;
    // ---- sky
    if (desc.sky !== false) {
      const sunDir = dirFromAzEl(frame.yaw + atm.sky.sunRelAz * DEG, Math.max(-12, atm.sky.sunEl) * DEG, new THREE.Vector3());
      const moonDir = dirFromAzEl(frame.yaw + atm.sky.moonRelAz * DEG, atm.sky.moonEl * DEG, new THREE.Vector3());
      this.sky.set(atm, sunDir, moonDir, desc.below || atm.fog.color, desc.seed || 1);
      this.group.add(this.sky.mesh);
    }
    // ---- terrain + water (terrain in app.world: camera aim / look-at rays hit it)
    if (desc.terrain) {
      const m = this.terrain.build(desc.terrain, frame);
      this.app.world.add(m);
      if (this.terrain.water) this.group.add(this.terrain.water);
    }
    // ---- scatter (local -> world)
    if (desc.scatter?.length) {
      const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
      const entries = desc.scatter.map((e) => ({
        ...e,
        items: e.items.map((it) => ({ ...it, x: frame.x + it.x * c + it.z * s, z: frame.z - it.x * s + it.z * c, rot: (it.rot || 0) + frame.yaw })),
      }));
      for (const e of entries) if (e.kind === 'tower') { const f = facadeTextures(); e.map = f.map; e.emap = f.emap; }
      this.scatter = buildScatter(this.app.materials, entries, { center: frame, emissive: atm.night || atm.dusk ? 1.1 : 0 });
      this.group.add(this.scatter);
    }
    // ---- precipitation
    if (desc.precip) this.group.add(this.precip.build(desc.precip, frame, desc.seed || 1, { density: desc.precipDensity ?? 1 }));
    this.active = true;
    this.applyStyle(this.app.materials.style);
    this.app.lightRig?.markWorldDirty?.();
    this.app.invalidate();
  }

  /** Re-applies style-dependent looks (sky mode, fog, neutral clay colours). */
  applyStyle(style = this.app.materials.style) {
    this.style = style;
    const app = this.app;
    if (!this.active || !this.desc) return;
    this.sky.setMode(style);
    this.scatter?.setStyle?.(style);
    this.precip.setLook({ night: this.desc.atm.night || this.desc.atm.dusk, style });
    // fog: off in the line-art style (paper), neutral grey in clay
    const f = this.desc.atm.fog;
    if (style === 'lines' || !f || f.density <= 0) app.scene.fog = null;
    else {
      _c.set(f.color);
      if (style === 'clay') { const l = _c.r * 0.2126 + _c.g * 0.7152 + _c.b * 0.0722; _c2.setRGB(l, l, l); _c.lerp(_c2, 0.75); }
      if (!this.fog) this.fog = new THREE.FogExp2(_c.getHex(), f.density);
      this.fog.color.copy(_c);
      this.fog.density = f.density * (this.desc.fogScale ?? 1);
      app.scene.fog = this.fog;
    }
    this.hideStudioFloor();
    app.invalidate();
  }

  /** The terrain replaces the studio floor and grid (re-asserted after render setting changes). */
  hideStudioFloor() {
    const app = this.app;
    if (!this.active || !this.desc?.terrain) return;
    if (app.ground && app.ground.visible) app.ground.visible = false;
    if (app.grid && app.grid.visible) app.grid.visible = false;
  }

  /** Removes everything; restore = give the studio floor / grid back (render settings). */
  clear(restore = true) {
    if (this.scatter) { this.scatter.dispose(); this.scatter = null; }
    this.precip.dispose();
    this.terrain.dispose();
    this.sky.mesh.removeFromParent();
    if (this.app.scene.fog === this.fog) this.app.scene.fog = null;
    this.active = false;
    this.desc = null;
    if (restore) {
      const st = this.app.modules?.render?.getSettings?.();
      if (this.app.ground) this.app.ground.visible = st ? !!st.ground : true;
      if (this.app.grid) this.app.grid.visible = st ? !!st.grid : true;
    }
    this.app.lightRig?.markWorldDirty?.();
    this.app.invalidate();
  }
}
