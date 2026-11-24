// AnimalManager (app.animals): the animals of the scene, selection, picking,
// persistence. Events: 'list' (added / removed), 'select' {animal, part},
// 'change' {animal} (pose / appearance / placement edits).
import * as THREE from 'three';
import { Animal } from './Animal.js';
import { loadManifest, loadSpecies, peekSpecies } from './loader.js';
import { materials } from '../render/materials.js';

const _ray = new THREE.Raycaster();
const _box = new THREE.Box3();

export class AnimalManager extends THREE.EventDispatcher {
  constructor(app) {
    super();
    this.app = app;
    this.animals = [];
    this.selected = null;
    this.part = null; // selected control id
    this.raycaster = _ray;
    this.manifest = null;
    this.ready = loadManifest().then((m) => { this.manifest = m; return m; }).catch((e) => { console.warn('[animals] manifest', e); return null; });
    this._pending = 0;
    this._pendingJson = new Map();
    materials.addEventListener('style', () => { for (const a of this.animals) a.applyMaterials(); app.invalidate(); });
  }

  entry(id) { return this.manifest?.species.find((s) => s.id === id) || null; }

  /** Ground height at world (x, z): a ready landscape's terrain / roof / pier, else 0. */
  floorAt(x, z) {
    const L = this.app.landscapes;
    const y = L?.heightAt ? L.heightAt(x, z) : 0;
    return Number.isFinite(y) ? y : 0;
  }

  /** Ground height under an animal's root. */
  floorUnder(a) { return this.floorAt(a.root.position.x, a.root.position.z); }

  /** Adds an animal of a species. opts: {near: Character|Animal, select, position, rotationY, ...Animal opts}. */
  async add(speciesId, opts = {}) {
    const data = await loadSpecies(speciesId);
    const a = new Animal(data, opts);
    if (!opts.position) this._placeNew(a, opts.near);
    this._attach(a);
    if (!opts.pose && !(a.entry.defaultPose && this.applyPreset?.(a, a.entry.defaultPose))) a.dropToGround();
    if (opts.select !== false) this.select(a);
    return a;
  }

  _attach(a) {
    this.app.world.add(a.root);
    this.animals.push(a);
    const inv = () => this.app.invalidate();
    a.addEventListener('pose', () => { inv(); this.dispatchEvent({ type: 'change', animal: a, what: 'pose' }); });
    a.addEventListener('appearance', () => { inv(); this.dispatchEvent({ type: 'change', animal: a, what: 'appearance' }); });
    this.dispatchEvent({ type: 'list' });
    inv();
  }

  /** Free spot beside the reference (selected character or animal), facing the camera's side. */
  _placeNew(a, near) {
    const app = this.app;
    const ref = near || app.selection.character || this.selected || app.characters[0] || null;
    const e = a.entry;
    const len = (e.bounds.max[2] - e.bounds.min[2]) * a.root.scale.z;
    const width = (e.bounds.max[0] - e.bounds.min[0]) * a.root.scale.x;
    let x = 0, z = 0;
    if (ref) {
      const p = ref.root.position;
      x = p.x + 0.45 + width / 2 + len * 0.35; z = p.z + 0.25;
    }
    // avoid other animals
    for (let k = 0; k < 12; k++) {
      const clash = this.animals.some((o) => Math.hypot(o.root.position.x - x, o.root.position.z - z) < Math.max(0.5, len * 0.6));
      if (!clash) break;
      x += Math.max(0.5, width + 0.3);
    }
    a.root.position.set(x, this.floorAt(x, z), z);
    // side view toward the camera reads best: body across the view
    const cam = app.camera.position;
    const toCam = Math.atan2(cam.x - x, cam.z - z);
    a.root.rotation.y = toCam - Math.PI / 2 * 0.75;
  }

  remove(a) {
    const i = this.animals.indexOf(a);
    if (i < 0) return;
    this.animals.splice(i, 1);
    if (this.selected === a) this.select(null);
    a.dispose();
    this.dispatchEvent({ type: 'list' });
    this.app.invalidate();
  }

  async duplicate(a) {
    const j = a.toJSON();
    delete j.id;
    const rel = j.position[1] - this.floorUnder(a); // same height above the ground (landscapes)
    j.position[0] += Math.max(0.5, (a.entry.bounds.max[0] - a.entry.bounds.min[0]) * a.root.scale.x + 0.3);
    j.position[1] = this.floorAt(j.position[0], j.position[2]) + rel;
    const b = await this.add(a.species, { ...j, rotationY: j.rotationY, select: true });
    return b;
  }

  clear() { for (const a of [...this.animals]) this.remove(a); }

  select(a, part = null) {
    if (a && !this.animals.includes(a)) a = null;
    this.selected = a;
    this.part = a ? part : null;
    this.dispatchEvent({ type: 'select', animal: a, part: this.part });
    this.app.invalidate();
  }

  selectPart(part) { if (this.selected) this.select(this.selected, part); }

  /** Nearest animal under the NDC point: {animal, point, distance, bone, control} | null. */
  pick(ndc, { only = null } = {}) {
    _ray.setFromCamera(ndc, this.app.camera);
    let best = null;
    for (const a of this.animals) {
      if (only && a !== only) continue;
      if (!a.root.visible) continue;
      const h = a.raycast(_ray.ray);
      if (h && (!best || h.distance < best.distance)) best = h;
    }
    return best;
  }

  // ------------------------------------------------------------------ persistence
  serialize() {
    // animals still loading (scene just opened) are kept as they were saved
    const list = this.animals.map((a) => a.toJSON());
    for (const [id, j] of this._pendingJson) if (!list.some((x) => x.id === id)) list.push(j);
    return { v: 1, animals: list };
  }

  deserialize(obj) {
    const list = obj?.animals || [];
    const ids = new Set(list.map((j) => j.id));
    for (const a of [...this.animals]) if (!ids.has(a.id)) this.remove(a);
    for (const id of [...this._pendingJson.keys()]) if (!ids.has(id)) this._pendingJson.delete(id);
    const sel = this.selected;
    for (const j of list) {
      const a = this.animals.find((x) => x.id === j.id);
      if (a && a.species === j.species) { a.fromJSON(j); continue; }
      if (a) this.remove(a);
      const ready = peekSpecies(j.species);
      if (ready) { // species already loaded (undo / redo): restore synchronously
        const b = new Animal(ready, { ...j });
        b.fromJSON(j);
        this._attach(b);
        continue;
      }
      // not in the scene yet: create once its species is loaded
      if (this._pendingJson.has(j.id)) { this._pendingJson.set(j.id, j); continue; }
      this._pending++;
      this._pendingJson.set(j.id, j);
      loadSpecies(j.species).then((data) => {
        const jj = this._pendingJson.get(j.id);
        if (!jj || this.animals.some((x) => x.id === j.id)) return;
        const b = new Animal(data, { ...jj });
        b.fromJSON(jj);
        this._attach(b);
      }).catch((e) => console.warn('[animals] restore failed', j.species, e)).finally(() => { this._pending--; this._pendingJson.delete(j.id); });
    }
    if (sel && !this.animals.includes(sel)) this.select(null);
    this.app.invalidate();
  }

  /** Resolves when every pending restore has finished. */
  async whenIdle() { while (this._pending > 0) await new Promise((r) => setTimeout(r, 30)); }

  /** World bounding box of an animal (posed). */
  boxOf(a) { return a.worldBox(_box).clone(); }
}
