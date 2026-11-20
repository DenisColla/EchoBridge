// Central material library with switchable render styles.
//
//   materials.apply(mesh, spec | spec[])   assign (and track) materials for a mesh
//   materials.release(mesh)                stop tracking
//   materials.setStyle('realistic'|'clay'|'toon'|'lines')
//
// spec = { kind, color, ...opts }. kinds: skin, eye, lashes, teeth, tongue,
// cloth, hair, prop, ground. Optional opts: map, normalMap, roughness,
// metalness, sheen, side, pattern …  Materials are cached per (style, spec).
import * as THREE from 'three';

export const STYLES = [
  { id: 'realistic', label: 'Realistico' },
  { id: 'clay', label: 'Manichino' },
  { id: 'toon', label: 'Fumetto' },
  { id: 'lines', label: 'Linee' },
];

const texId = (t) => (t ? t.uuid : null);

function makeGradient(steps = [0.32, 0.62, 1.0]) {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((s, i) => { const v = Math.round(s * 255); data.set([v, v, v, 255], i * 4); });
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const CLAY = { skin: '#c9c2b8', eye: '#d8d4ce', lashes: '#6d6862', teeth: '#e4e0da', tongue: '#b8aea6', cloth: '#9fa6ad', hair: '#7e7a76', prop: '#b0aaa2', ground: '#d6d3cf' };

class MaterialLibrary extends THREE.EventDispatcher {
  constructor() {
    super();
    this.style = 'realistic';
    this.tracked = new Map();
    this.cache = new Map();
    this.gradient = makeGradient();
    this.textures = {};
    /** extra per-style factories can be registered by the render module */
    this.factories = {};
  }

  setTexture(name, tex) { this.textures[name] = tex; this.cache.clear(); this.refreshAll(); }

  apply(mesh, spec) {
    this.tracked.set(mesh, spec);
    mesh.material = this._resolve(spec);
    return mesh.material;
  }

  release(mesh) { this.tracked.delete(mesh); }

  setStyle(style) {
    if (style === this.style) return;
    this.style = style;
    this.refreshAll();
    this.dispatchEvent({ type: 'style', style });
  }

  refreshAll() {
    for (const [mesh, spec] of this.tracked) mesh.material = this._resolve(spec);
  }

  _resolve(spec) { return Array.isArray(spec) ? spec.map((s) => this._get(s)) : this._get(spec); }

  _key(s) {
    const o = {};
    for (const [k, v] of Object.entries(s)) o[k] = v && v.isTexture ? texId(v) : v;
    return this.style + '|' + JSON.stringify(o);
  }

  _get(spec) {
    const key = this._key(spec);
    let m = this.cache.get(key);
    if (!m) {
      const f = this.factories[this.style] || defaultFactories[this.style];
      m = f.call(this, spec);
      m.userData.kind = spec.kind;
      this.cache.set(key, m);
    }
    return m;
  }
}

const defaultFactories = {
  realistic(s) {
    const color = new THREE.Color(s.color || '#cccccc');
    switch (s.kind) {
      case 'skin':
        return new THREE.MeshPhysicalMaterial({ color, roughness: 0.58, metalness: 0, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color('#ff9a7a'), map: s.map || this.textures.skinDetail || null });
      case 'eye':
        return new THREE.MeshPhysicalMaterial({ map: s.map || this.textures.eye || null, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, transparent: false });
      case 'lashes':
        return new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide });
      case 'teeth':
        return new THREE.MeshStandardMaterial({ color, roughness: 0.35 });
      case 'tongue':
        return new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
      case 'cloth':
        return new THREE.MeshPhysicalMaterial({ color, roughness: s.roughness ?? 0.85, metalness: s.metalness ?? 0, sheen: s.sheen ?? 0.6, sheenRoughness: 0.8, sheenColor: color.clone().lerp(new THREE.Color('#ffffff'), 0.35), map: s.map || null, normalMap: s.normalMap || null, side: s.side ?? THREE.FrontSide });
      case 'hair':
        return new THREE.MeshPhysicalMaterial({ color, roughness: s.roughness ?? 0.5, metalness: 0, sheen: 0.8, sheenRoughness: 0.35, sheenColor: color.clone().lerp(new THREE.Color('#ffffff'), 0.5), map: s.map || null, normalMap: s.normalMap || null, side: s.side ?? THREE.FrontSide });
      case 'ground':
        return new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
      default:
        return new THREE.MeshStandardMaterial({ color, roughness: s.roughness ?? 0.7, metalness: s.metalness ?? 0, map: s.map || null, side: s.side ?? THREE.FrontSide });
    }
  },
  clay(s) {
    const color = new THREE.Color(CLAY[s.kind] || '#b5b0a8');
    if (s.kind === 'cloth' || s.kind === 'hair') color.lerp(new THREE.Color(s.color || '#999'), 0.18);
    if (s.kind === 'eye') return new THREE.MeshStandardMaterial({ color, roughness: 0.4, map: null });
    return new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, side: s.side ?? THREE.FrontSide });
  },
  toon(s) {
    const color = new THREE.Color(s.color || '#cccccc');
    if (s.kind === 'eye') return new THREE.MeshToonMaterial({ map: s.map || this.textures.eye || null, gradientMap: this.gradient });
    return new THREE.MeshToonMaterial({ color, gradientMap: this.gradient, map: s.kind === 'cloth' ? s.map || null : null, side: s.side ?? THREE.FrontSide });
  },
  lines(s) {
    const c = s.kind === 'lashes' ? '#222222' : s.kind === 'ground' ? '#ffffff' : '#fbfbfb';
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(c), side: s.side ?? THREE.FrontSide });
  },
};

export const materials = new MaterialLibrary();
