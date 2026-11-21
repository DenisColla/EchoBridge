// Scenes: saved scenes in localStorage ('posaviva.scenes'), autosave of the
// current scene ('posaviva.autosave', restored at startup), new / open /
// import / export, dirty tracking against the undo history.
//
// 'posaviva.scenes' = [{id, name, date, thumb (JPEG data URL), data (app.serialize())}], newest first.
// 'posaviva.autosave' = {v, time, current:{id, name}, dirty, scene (app.serialize())}.
import { store } from './storage.js';

export const SCENES_KEY = 'posaviva.scenes';
export const AUTOSAVE_KEY = 'posaviva.autosave';
const AUTOSAVE_DELAY = 1200;

/** Minimal structural check of a scene object (app.serialize() output). */
export function isSceneJSON(j) {
  return !!j && typeof j === 'object' && Array.isArray(j.characters) && j.characters.every((c) => c && typeof c === 'object' && typeof c.preset === 'string');
}

export function sceneSlug(name) {
  return (name || 'scena').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'scena';
}

const uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export class SceneManager extends EventTarget {
  /**
   * @param {import('../app.js').App} app
   * @param {{thumbnail: () => Promise<string|null>}} deps
   */
  constructor(app, deps) {
    super();
    this.app = app;
    this.deps = deps;
    /** current scene identity: id of the saved entry it came from (null = never saved) */
    this.current = { id: null, name: 'Senza titolo' };
    this._cleanSnap = null; // history snapshot (JSON string) considered "saved"
    this._markCleanOnReset = false;
    this._autosaveT = 0;
    this._lastAutosave = '';
    this._autosaveWarned = false;
    this._restoring = false;
    this.pristine = null; // default scene captured at startup ("Nuova scena")
    /** module defaults without characters, captured before the autosave is restored */
    this.baseScene = null;

    app.addEventListener('history', () => {
      const h = app.history;
      if (this._markCleanOnReset) { this._markCleanOnReset = false; this._cleanSnap = h.stack[h.index]; }
      this._emit();
      this.scheduleAutosave();
    });
    const flush = () => this.flushAutosave();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);
  }

  _emit() { this.dispatchEvent(new Event('change')); }

  // ---------------------------------------------------------------- state
  get dirty() {
    const h = this.app.history;
    if (!h.stack.length) return false;
    return h.stack[h.index] !== this._cleanSnap;
  }

  /** The current state counts as saved (startup default scene). */
  markClean() {
    const h = this.app.history;
    this._cleanSnap = h.stack[h.index] ?? null;
    this._emit();
  }

  /** Call after a scene has been loaded / created: the undo history restarts and the scene counts as saved (or not). */
  _resetHistory(clean) {
    this._markCleanOnReset = !!clean;
    if (!clean) this._cleanSnap = null;
    this.app.history.reset();
  }

  // ---------------------------------------------------------------- saved scenes
  list() {
    const l = store.get(SCENES_KEY, []);
    return Array.isArray(l) ? l.filter((e) => e && e.id && isSceneJSON(e.data)) : [];
  }

  _write(list) {
    const r = store.set(SCENES_KEY, list);
    if (r.ok) this._emit();
    return r;
  }

  get(id) { return this.list().find((e) => e.id === id) || null; }

  /**
   * Saves the current scene. opts: {name, asNew}. Overwrites the entry the scene
   * came from unless asNew. -> {ok, entry?, quota?, error?}
   */
  async save({ name, asNew = false } = {}) {
    const data = this.app.serialize();
    let thumb = null;
    try { thumb = await this.deps.thumbnail(); } catch { /* keep going without */ }
    const list = this.list();
    const id = !asNew && this.current.id && list.some((e) => e.id === this.current.id) ? this.current.id : uid();
    const entry = { id, name: (name || this.current.name || 'Scena').slice(0, 60), date: Date.now(), thumb, data };
    const next = [entry, ...list.filter((e) => e.id !== id)];
    let r = this._write(next);
    if (!r.ok && r.quota && thumb) { entry.thumb = null; r = this._write(next); } // retry without the picture
    if (!r.ok) return r;
    this.current = { id, name: entry.name };
    this._cleanSnap = this.app.history.stack[this.app.history.index];
    this._emit();
    this.flushAutosave(true);
    return { ok: true, entry };
  }

  rename(id, name) {
    const list = this.list();
    const e = list.find((x) => x.id === id);
    if (!e) return { ok: false };
    e.name = name.slice(0, 60);
    const r = this._write(list);
    if (r.ok && this.current.id === id) { this.current.name = e.name; this._emit(); this.flushAutosave(true); }
    return r;
  }

  duplicate(id) {
    const list = this.list();
    const e = list.find((x) => x.id === id);
    if (!e) return { ok: false };
    const copy = { ...e, id: uid(), name: `${e.name} (copia)`.slice(0, 60), date: Date.now() };
    return this._write([copy, ...list]);
  }

  remove(id) {
    const r = this._write(this.list().filter((e) => e.id !== id));
    if (r.ok && this.current.id === id) { this.current.id = null; this._cleanSnap = null; this._emit(); }
    return r;
  }

  removeAll() {
    store.remove(SCENES_KEY);
    this.current.id = null;
    this._cleanSnap = null;
    this._emit();
  }

  // ---------------------------------------------------------------- loading
  /** Replaces the current scene with a scene JSON. meta: {id, name, clean}. Throws on invalid data. */
  load(json, meta = {}) {
    if (!isSceneJSON(json)) throw new Error('Scena non valida');
    this._restoring = true;
    try { this.app.deserialize(json); } finally { this._restoring = false; }
    this.current = { id: meta.id ?? null, name: meta.name || 'Senza titolo' };
    this._resetHistory(meta.clean !== false);
    this._emit();
    this.flushAutosave(true);
  }

  open(id) {
    const e = this.get(id);
    if (!e) throw new Error('Scena non trovata');
    this.load(e.data, { id: e.id, name: e.name, clean: true });
    return e;
  }

  /** Default scene (one default character, default lights/camera/style). */
  newScene() {
    if (this.pristine) {
      const base = JSON.parse(JSON.stringify(this.pristine));
      for (const c of base.characters) delete c.id; // fresh character ids
      this.load(base, { id: null, name: 'Senza titolo', clean: true });
      return;
    }
    // the startup scene was a restored autosave: rebuild the defaults the same way
    // main.js does (module defaults captured before the restore + a new default character)
    const base = this.baseScene ? JSON.parse(JSON.stringify(this.baseScene)) : { scene: {} };
    base.characters = []; base.selected = -1;
    this._restoring = true;
    try {
      this.app.deserialize(base);
      const ch = this.app.addCharacter({ preset: 'f_normal' });
      this.app.select(ch);
      // as at start-up: the default camera crops the figure in landscape
      const cam = this.app.sceneTools?.camera;
      if (cam?.subjectInView && !cam.subjectInView(1.15)) cam.frameSubject({ animate: false, commit: false });
    } finally { this._restoring = false; }
    this.current = { id: null, name: 'Senza titolo' };
    this._resetHistory(true);
    this._emit();
    this.flushAutosave(true);
  }

  // ---------------------------------------------------------------- files
  /** JSON text of the current scene for export (with its name). */
  exportText() {
    const data = this.app.serialize();
    return JSON.stringify({ ...data, name: this.current.name, exported: new Date().toISOString() });
  }

  /** Parses an imported file. -> {json, name} or throws. */
  parseFile(text, fileName = '') {
    let j;
    try { j = JSON.parse(text); } catch { throw new Error('Il file non è un JSON valido'); }
    if (j && j.app && j.app !== 'PosaViva') throw new Error('Il file non è una scena di PosaViva');
    if (!isSceneJSON(j)) throw new Error('Il file non contiene una scena di PosaViva');
    const name = (typeof j.name === 'string' && j.name.trim()) || fileName.replace(/\.(posaviva\.)?json$/i, '').replace(/[-_]+/g, ' ').trim() || 'Scena importata';
    return { json: j, name: name.slice(0, 60) };
  }

  // ---------------------------------------------------------------- autosave
  scheduleAutosave() {
    if (this._restoring) return;
    clearTimeout(this._autosaveT);
    this._autosaveT = setTimeout(() => this.flushAutosave(), AUTOSAVE_DELAY);
  }

  flushAutosave(force = false) {
    clearTimeout(this._autosaveT);
    if (!this.app.characters) return;
    let scene;
    try { scene = JSON.stringify(this.app.serialize()); } catch (e) { console.warn('[PosaViva] autosave serialize failed', e); return; }
    const head = JSON.stringify({ v: 1, time: Date.now(), current: this.current, dirty: this.dirty });
    if (!force && scene === this._lastAutosave) return;
    const r = store.setRaw(AUTOSAVE_KEY, head.slice(0, -1) + ',"scene":' + scene + '}');
    if (r.ok) { this._lastAutosave = scene; this._autosaveWarned = false; }
    else if (!this._autosaveWarned) {
      this._autosaveWarned = true;
      this.dispatchEvent(Object.assign(new Event('autosave-error'), { quota: r.quota }));
    }
  }

  /** Restores the autosave (call once at startup). Returns true when a scene was restored. */
  restoreAutosave() {
    const a = store.get(AUTOSAVE_KEY, null);
    if (!a) return false;
    const scene = a.scene && isSceneJSON(a.scene) ? a.scene : isSceneJSON(a) ? a : null;
    if (!scene) return false;
    try {
      this.load(scene, { id: a.current?.id ?? null, name: a.current?.name || 'Senza titolo', clean: !a.dirty });
      // the saved entry may have been deleted meanwhile
      if (this.current.id && !this.list().some((e) => e.id === this.current.id)) this.current.id = null;
      return true;
    } catch (e) {
      console.warn('[PosaViva] autosave restore failed', e);
      return false;
    }
  }
}
