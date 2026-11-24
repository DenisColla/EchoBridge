// ProjectStore: the archive of comic projects, their sections and the saved items.
// Metadata (projects, sections, item headers) lives in memory for instant lists and
// search; payloads and thumbnails are read from IndexedDB when needed.
// Events (three.js EventDispatcher): 'change' {what: 'projects'|'sections'|'items'|'current'|'all', id}.
import { EventDispatcher } from 'three';
import { openBackend, isQuotaError } from './db.js';

export const ITEM_TYPES = [
  { id: 'scene', label: 'Scena', plural: 'Scene', icon: 'image' },
  { id: 'landscape', label: 'Paesaggio', plural: 'Paesaggi', icon: 'mountain' },
  { id: 'character', label: 'Personaggio', plural: 'Personaggi', icon: 'user' },
  { id: 'pose', label: 'Posa', plural: 'Pose', icon: 'pose' },
];
export const TYPE_BY_ID = new Map(ITEM_TYPES.map((t) => [t.id, t]));

export const SECTION_KINDS = [
  { id: 'capitolo', label: 'Capitolo' },
  { id: 'tavola', label: 'Tavola' },
  { id: 'vignetta', label: 'Vignetta' },
];
export const KIND_BY_ID = new Map(SECTION_KINDS.map((k) => [k.id, k]));

export const DEFAULT_PROJECT_NAME = 'I miei fumetti';
const CURRENT_KEY = 'posaviva.projects.current';
const LEGACY_SCENES_KEY = 'posaviva.scenes';
const MIGRATED_KEY = 'posaviva.projects.migrated';
const NAME_MAX = 60;

let _n = 0;
export const uid = (p) => p + Date.now().toString(36) + (++_n).toString(36) + Math.random().toString(36).slice(2, 6);
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const clean = (s, fallback) => (String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || fallback);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

/** Error with an Italian message for the user (and .quota when the storage is full). */
export function storageError(e) {
  if (isQuotaError(e)) { const err = new Error('Memoria piena: elimina qualcosa che non usi più.'); err.quota = true; return err; }
  return e instanceof Error ? e : new Error(String(e));
}

export class ProjectStore extends EventDispatcher {
  constructor() {
    super();
    this.backend = null;
    this.projects = new Map();
    this.sectionsById = new Map();
    this.itemsById = new Map();
    this._cur = { projectId: null, sectionId: null };
    try { Object.assign(this._cur, JSON.parse(lsGet(CURRENT_KEY) || '{}')); } catch { /* ignore */ }
    this.ready = this._init();
  }

  get persistent() { return !!this.backend?.persistent; }

  async _init() {
    this.backend = await openBackend();
    try {
      const [ps, ss, is] = await Promise.all(['projects', 'sections', 'items'].map((s) => this.backend.getAll(s)));
      for (const p of ps) this.projects.set(p.id, p);
      for (const s of ss) this.sectionsById.set(s.id, s);
      for (const i of is) this.itemsById.set(i.id, i);
    } catch (e) { console.error('[PosaViva] projects: load failed', e); }
    await this._migrateLegacyScenes();
    if (!this.projects.size) await this.create(DEFAULT_PROJECT_NAME, { select: false });
    if (!this.projects.has(this._cur.projectId)) this._cur = { projectId: this.list()[0]?.id || null, sectionId: null };
    if (this._cur.sectionId && this.sectionsById.get(this._cur.sectionId)?.projectId !== this._cur.projectId) this._cur.sectionId = null;
    // ask the browser not to evict the archive under storage pressure (best effort)
    try { navigator.storage?.persist?.().catch(() => {}); } catch { /* ignore */ }
    this._emit('all');
    return this;
  }

  /** Scenes saved by earlier versions in localStorage -> items of the default project (ids kept). */
  async _migrateLegacyScenes() {
    if (lsGet(MIGRATED_KEY) === '1' && lsGet(LEGACY_SCENES_KEY) === null) return;
    let list = [];
    try { list = JSON.parse(lsGet(LEGACY_SCENES_KEY) || '[]'); } catch { list = []; }
    list = Array.isArray(list) ? list.filter((e) => e && e.id && e.data && Array.isArray(e.data.characters)) : [];
    if (!list.length) { lsSet(MIGRATED_KEY, '1'); return; }
    let proj = [...this.projects.values()].find((p) => p.name === DEFAULT_PROJECT_NAME);
    const ops = [];
    const now = Date.now();
    if (!proj) {
      proj = { id: uid('p'), name: DEFAULT_PROJECT_NAME, created: now, updated: now, order: 0 };
      ops.push({ store: 'projects', put: proj });
    }
    const added = [];
    for (const e of list) {
      if (this.itemsById.has(e.id)) continue;
      const text = JSON.stringify(e.data);
      const item = { id: e.id, projectId: proj.id, sectionId: null, type: 'scene', name: clean(e.name, 'Scena'), created: e.date || now, updated: e.date || now, size: text.length, meta: sceneMeta(e.data) };
      ops.push({ store: 'items', put: item }, { store: 'data', put: { id: e.id, data: e.data } });
      if (e.thumb) ops.push({ store: 'thumbs', put: { id: e.id, thumb: e.thumb } });
      added.push(item);
    }
    proj.updated = Math.max(proj.updated, ...added.map((i) => i.updated));
    ops.push({ store: 'projects', put: proj });
    try {
      await this.backend.write(ops);
      this.projects.set(proj.id, proj);
      for (const it of added) this.itemsById.set(it.id, it);
      if (this.backend.persistent) {
        // the scenes now live in IndexedDB: free the localStorage space (the autosave needs it)
        lsDel(LEGACY_SCENES_KEY);
        lsSet(MIGRATED_KEY, '1');
      }
      if (!this._cur.projectId) this._cur.projectId = proj.id;
      console.info(`[PosaViva] ${added.length} saved scene(s) moved into «${proj.name}»`);
    } catch (e) { console.error('[PosaViva] projects: scene migration failed (kept in localStorage)', e); }
  }

  _emit(what, id = null) { this.dispatchEvent({ type: 'change', what, id }); }

  _saveCurrent() { lsSet(CURRENT_KEY, JSON.stringify(this._cur)); }

  async _write(ops) {
    try { await this.backend.write(ops); } catch (e) { throw storageError(e); }
  }

  // ---------------------------------------------------------------- projects
  /** Projects, most recently used first, with counts. */
  list() {
    const counts = new Map();
    for (const it of this.itemsById.values()) {
      const c = counts.get(it.projectId) || counts.set(it.projectId, { total: 0, scene: 0, landscape: 0, character: 0, pose: 0 }).get(it.projectId);
      c.total++; c[it.type] = (c[it.type] || 0) + 1;
    }
    const secs = new Map();
    for (const s of this.sectionsById.values()) secs.set(s.projectId, (secs.get(s.projectId) || 0) + 1);
    return [...this.projects.values()]
      .map((p) => ({ ...p, counts: counts.get(p.id) || { total: 0, scene: 0, landscape: 0, character: 0, pose: 0 }, sectionCount: secs.get(p.id) || 0 }))
      .sort((a, b) => b.updated - a.updated);
  }

  get(id) { return this.projects.get(id) || null; }

  get current() { return this.projects.get(this._cur.projectId) || null; }
  get currentSection() { return this.sectionsById.get(this._cur.sectionId) || null; }

  /** Makes a project (and optionally a section of it) the default target of saves. */
  setCurrent(projectId, sectionId = null) {
    if (!this.projects.has(projectId)) return;
    if (sectionId && this.sectionsById.get(sectionId)?.projectId !== projectId) sectionId = null;
    if (this._cur.projectId === projectId && this._cur.sectionId === sectionId) return;
    this._cur = { projectId, sectionId };
    this._saveCurrent();
    this._emit('current');
  }

  uniqueProjectName(base, except = null) {
    const taken = new Set([...this.projects.values()].filter((p) => p.id !== except).map((p) => norm(p.name)));
    if (!taken.has(norm(base))) return base;
    for (let i = 2; ; i++) { const n = `${base} (${i})`; if (!taken.has(norm(n))) return n; }
  }

  async create(name, { select = true } = {}) {
    const now = Date.now();
    const p = { id: uid('p'), name: this.uniqueProjectName(clean(name, 'Nuovo fumetto')), created: now, updated: now, order: 0 };
    await this._write([{ store: 'projects', put: p }]);
    this.projects.set(p.id, p);
    if (select) { this._cur = { projectId: p.id, sectionId: null }; this._saveCurrent(); }
    this._emit('projects', p.id);
    return { ...p };
  }

  async rename(projectId, name) {
    const p = this.projects.get(projectId);
    if (!p) throw new Error('Progetto non trovato');
    const next = { ...p, name: this.uniqueProjectName(clean(name, p.name), p.id), updated: Date.now() };
    await this._write([{ store: 'projects', put: next }]);
    this.projects.set(p.id, next);
    this._emit('projects', p.id);
    return { ...next };
  }

  /** Deletes a project with its sections and items. */
  async remove(projectId) {
    const p = this.projects.get(projectId);
    if (!p) return false;
    const ops = [{ store: 'projects', del: projectId }];
    const secs = [...this.sectionsById.values()].filter((s) => s.projectId === projectId);
    const items = [...this.itemsById.values()].filter((i) => i.projectId === projectId);
    for (const s of secs) ops.push({ store: 'sections', del: s.id });
    for (const i of items) ops.push({ store: 'items', del: i.id }, { store: 'data', del: i.id }, { store: 'thumbs', del: i.id });
    await this._write(ops);
    this.projects.delete(projectId);
    for (const s of secs) this.sectionsById.delete(s.id);
    for (const i of items) this.itemsById.delete(i.id);
    if (this._cur.projectId === projectId) {
      if (!this.projects.size) await this.create(DEFAULT_PROJECT_NAME, { select: false });
      this._cur = { projectId: this.list()[0]?.id || null, sectionId: null };
      this._saveCurrent();
    }
    this._emit('projects', projectId);
    return true;
  }

  _touchProject(projectId, ops = []) {
    const p = this.projects.get(projectId);
    if (!p) return ops;
    const next = { ...p, updated: Date.now() };
    this.projects.set(p.id, next);
    ops.push({ store: 'projects', put: next });
    return ops;
  }

  // ---------------------------------------------------------------- sections
  /** Sections of a project in their order. */
  sections(projectId) {
    return [...this.sectionsById.values()].filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order || a.created - b.created).map((s) => ({ ...s }));
  }

  section(id) { const s = this.sectionsById.get(id); return s ? { ...s } : null; }

  /** "Tavola 3": next free automatic name of a kind in a project. */
  nextSectionName(projectId, kind = 'tavola') {
    const base = KIND_BY_ID.get(kind)?.label || 'Sezione';
    const taken = new Set(this.sections(projectId).map((s) => norm(s.name)));
    for (let i = 1; ; i++) if (!taken.has(norm(`${base} ${i}`))) return `${base} ${i}`;
  }

  async createSection(projectId, name, kind = 'tavola') {
    if (!this.projects.has(projectId)) throw new Error('Progetto non trovato');
    if (!KIND_BY_ID.has(kind)) kind = 'tavola';
    const now = Date.now();
    const order = Math.max(-1, ...this.sections(projectId).map((s) => s.order)) + 1;
    const s = { id: uid('s'), projectId, name: clean(name, this.nextSectionName(projectId, kind)), kind, order, created: now, updated: now };
    await this._write(this._touchProject(projectId, [{ store: 'sections', put: s }]));
    this.sectionsById.set(s.id, s);
    this._emit('sections', s.id);
    return { ...s };
  }

  /** patch: {name, kind} */
  async updateSection(sectionId, patch = {}) {
    const s = this.sectionsById.get(sectionId);
    if (!s) throw new Error('Sezione non trovata');
    const next = { ...s, updated: Date.now() };
    if (patch.name !== undefined) next.name = clean(patch.name, s.name);
    if (patch.kind && KIND_BY_ID.has(patch.kind)) next.kind = patch.kind;
    await this._write([{ store: 'sections', put: next }]);
    this.sectionsById.set(s.id, next);
    this._emit('sections', s.id);
    return { ...next };
  }

  renameSection(sectionId, name) { return this.updateSection(sectionId, { name }); }

  /** Moves a section by `delta` places (-1 up, +1 down) or to `{index}`. */
  async moveSection(sectionId, delta) {
    const s = this.sectionsById.get(sectionId);
    if (!s) return false;
    const list = this.sections(s.projectId);
    const i = list.findIndex((x) => x.id === sectionId);
    const j = typeof delta === 'object' ? Math.max(0, Math.min(list.length - 1, delta.index | 0)) : Math.max(0, Math.min(list.length - 1, i + delta));
    if (i === j) return false;
    const [moved] = list.splice(i, 1);
    list.splice(j, 0, moved);
    const ops = [];
    list.forEach((x, k) => { if (x.order !== k) { const n = { ...this.sectionsById.get(x.id), order: k }; this.sectionsById.set(x.id, n); ops.push({ store: 'sections', put: n }); } });
    await this._write(ops);
    this._emit('sections', sectionId);
    return true;
  }

  /** Deletes a section. Its items go to the project root, or are deleted with {withItems: true}. */
  async removeSection(sectionId, { withItems = false } = {}) {
    const s = this.sectionsById.get(sectionId);
    if (!s) return false;
    const items = [...this.itemsById.values()].filter((i) => i.sectionId === sectionId);
    const ops = [{ store: 'sections', del: sectionId }];
    for (const it of items) {
      if (withItems) ops.push({ store: 'items', del: it.id }, { store: 'data', del: it.id }, { store: 'thumbs', del: it.id });
      else ops.push({ store: 'items', put: { ...it, sectionId: null } });
    }
    await this._write(ops);
    this.sectionsById.delete(sectionId);
    for (const it of items) { if (withItems) this.itemsById.delete(it.id); else this.itemsById.set(it.id, { ...it, sectionId: null }); }
    if (this._cur.sectionId === sectionId) { this._cur.sectionId = null; this._saveCurrent(); }
    this._emit('sections', sectionId);
    return true;
  }

  // ---------------------------------------------------------------- items
  item(id) { const i = this.itemsById.get(id); return i ? { ...i } : null; }

  /** Item headers filtered by {projectId, sectionId (null = project root), type}, newest first. */
  items(f = {}) {
    const out = [];
    for (const i of this.itemsById.values()) {
      if (f.projectId && i.projectId !== f.projectId) continue;
      if (f.sectionId !== undefined && (i.sectionId || null) !== (f.sectionId || null)) continue;
      if (f.type && i.type !== f.type) continue;
      out.push({ ...i });
    }
    return out.sort((a, b) => b.updated - a.updated);
  }

  uniqueItemName(base, projectId, type, except = null) {
    const taken = new Set(this.items({ projectId, type }).filter((i) => i.id !== except).map((i) => norm(i.name)));
    if (!taken.has(norm(base))) return base;
    for (let i = 2; ; i++) { const n = `${base} ${i}`; if (!taken.has(norm(n))) return n; }
  }

  /**
   * Writes an item. rec: {id? (overwrite), type, name, projectId, sectionId, data, thumb, meta}.
   * A thumb of `undefined` keeps the stored one on overwrite. -> item header
   */
  async putItem(rec) {
    if (!TYPE_BY_ID.has(rec.type)) throw new Error(`Tipo non valido: ${rec.type}`);
    if (rec.data === undefined || rec.data === null) throw new Error('Niente da salvare');
    const old = rec.id ? this.itemsById.get(rec.id) : null;
    const projectId = rec.projectId || old?.projectId || this._cur.projectId;
    if (!this.projects.has(projectId)) throw new Error('Progetto non trovato');
    let sectionId = rec.sectionId !== undefined ? rec.sectionId : old ? old.sectionId : null;
    if (sectionId && this.sectionsById.get(sectionId)?.projectId !== projectId) sectionId = null;
    const now = Date.now();
    const text = JSON.stringify(rec.data);
    const item = {
      id: old?.id || rec.id || uid('i'), projectId, sectionId: sectionId || null, type: rec.type,
      name: clean(rec.name, old?.name || TYPE_BY_ID.get(rec.type).label),
      created: old?.created || now, updated: now, size: text.length + (rec.thumb ? rec.thumb.length : 0),
      meta: rec.meta || old?.meta || {},
    };
    const ops = [{ store: 'items', put: item }, { store: 'data', put: { id: item.id, data: rec.data } }];
    if (rec.thumb) ops.push({ store: 'thumbs', put: { id: item.id, thumb: rec.thumb } });
    else if (rec.thumb === null) ops.push({ store: 'thumbs', del: item.id });
    await this._write(this._touchProject(projectId, ops));
    this.itemsById.set(item.id, item);
    this._emit('items', item.id);
    return { ...item };
  }

  /** Header + payload + thumbnail. */
  async getItem(id) {
    const head = this.itemsById.get(id);
    if (!head) return null;
    const [d, t] = await Promise.all([this.backend.get('data', id), this.backend.get('thumbs', id)]);
    return { ...head, data: d?.data ?? null, thumb: t?.thumb ?? null };
  }

  async thumbs(ids) {
    const m = await this.backend.getMany('thumbs', ids);
    const out = new Map();
    for (const [id, r] of m) out.set(id, r.thumb);
    return out;
  }

  async renameItem(id, name) {
    const it = this.itemsById.get(id);
    if (!it) throw new Error('Elemento non trovato');
    const next = { ...it, name: clean(name, it.name), updated: Date.now() };
    await this._write([{ store: 'items', put: next }]);
    this.itemsById.set(id, next);
    this._emit('items', id);
    return { ...next };
  }

  /** to: {projectId, sectionId} */
  async moveItem(id, to = {}) {
    const it = this.itemsById.get(id);
    if (!it) throw new Error('Elemento non trovato');
    const projectId = to.projectId || it.projectId;
    if (!this.projects.has(projectId)) throw new Error('Progetto non trovato');
    let sectionId = to.sectionId === undefined ? (projectId === it.projectId ? it.sectionId : null) : to.sectionId;
    if (sectionId && this.sectionsById.get(sectionId)?.projectId !== projectId) sectionId = null;
    const next = { ...it, projectId, sectionId: sectionId || null };
    await this._write(this._touchProject(projectId, [{ store: 'items', put: next }]));
    this.itemsById.set(id, next);
    this._emit('items', id);
    return { ...next };
  }

  async duplicateItem(id) {
    const full = await this.getItem(id);
    if (!full) throw new Error('Elemento non trovato');
    return this.putItem({ type: full.type, name: this.uniqueItemName(`${full.name} (copia)`, full.projectId, full.type), projectId: full.projectId, sectionId: full.sectionId, data: full.data, thumb: full.thumb, meta: full.meta });
  }

  async removeItem(id) {
    const it = this.itemsById.get(id);
    if (!it) return false;
    await this._write([{ store: 'items', del: id }, { store: 'data', del: id }, { store: 'thumbs', del: id }]);
    this.itemsById.delete(id);
    this._emit('items', id);
    return true;
  }

  async removeAll() {
    const ops = [];
    for (const id of this.projects.keys()) ops.push({ store: 'projects', del: id });
    for (const id of this.sectionsById.keys()) ops.push({ store: 'sections', del: id });
    for (const id of this.itemsById.keys()) ops.push({ store: 'items', del: id }, { store: 'data', del: id }, { store: 'thumbs', del: id });
    await this._write(ops);
    this.projects.clear(); this.sectionsById.clear(); this.itemsById.clear();
    await this.create(DEFAULT_PROJECT_NAME);
    this._emit('all');
  }

  /**
   * Search. query: text, or {text, type, projectId}. Matches item, section and project
   * names and type labels (accent-insensitive, every word must match). -> item headers
   * with projectName / sectionName, best matches first.
   */
  find(query) {
    const q = typeof query === 'string' ? { text: query } : { ...(query || {}) };
    const words = norm(q.text || '').split(/\s+/).filter(Boolean);
    const out = [];
    for (const it of this.itemsById.values()) {
      if (q.type && it.type !== q.type) continue;
      if (q.projectId && it.projectId !== q.projectId) continue;
      const p = this.projects.get(it.projectId), s = it.sectionId ? this.sectionsById.get(it.sectionId) : null;
      const t = TYPE_BY_ID.get(it.type);
      const name = norm(it.name);
      const hay = `${name} ${norm(s?.name)} ${norm(KIND_BY_ID.get(s?.kind)?.label)} ${norm(p?.name)} ${norm(t?.label)} ${norm(t?.plural)} ${norm(it.meta?.label)}`;
      if (words.length && !words.every((w) => hay.includes(w))) continue;
      const score = words.reduce((a, w) => a + (name.startsWith(w) ? 3 : name.includes(w) ? 2 : 1), 0);
      out.push({ ...it, projectName: p?.name || '', sectionName: s?.name || '', _score: score });
    }
    out.sort((a, b) => b._score - a._score || b.updated - a.updated);
    for (const o of out) delete o._score;
    return out;
  }

  /** Bytes used by a project's payloads and thumbnails (approx., UTF-16). */
  usage(projectId = null) {
    let n = 0;
    for (const it of this.itemsById.values()) if (!projectId || it.projectId === projectId) n += (it.size || 0) * 2;
    return n;
  }

  // ---------------------------------------------------------------- files
  /** Whole project as one JSON object (.posaviva). */
  async exportProject(projectId) {
    const p = this.projects.get(projectId);
    if (!p) throw new Error('Progetto non trovato');
    const heads = this.items({ projectId });
    const [data, thumbs] = await Promise.all([this.backend.getMany('data', heads.map((i) => i.id)), this.backend.getMany('thumbs', heads.map((i) => i.id))]);
    return {
      app: 'PosaViva', kind: 'project', version: 1, exported: new Date().toISOString(),
      project: { name: p.name, created: p.created, updated: p.updated },
      sections: this.sections(projectId).map((s) => ({ id: s.id, name: s.name, kind: s.kind, order: s.order, created: s.created })),
      items: heads.filter((i) => data.has(i.id)).map((i) => ({ id: i.id, type: i.type, name: i.name, sectionId: i.sectionId, created: i.created, updated: i.updated, meta: i.meta, data: data.get(i.id).data, thumb: thumbs.get(i.id)?.thumb || null })),
    };
  }

  /** Imports an exported project as a NEW project (new ids). -> project */
  async importProject(obj) {
    if (!obj || obj.kind !== 'project' || !obj.project || !Array.isArray(obj.items)) throw new Error('Il file non contiene un progetto di PosaViva');
    const now = Date.now();
    const p = { id: uid('p'), name: this.uniqueProjectName(clean(obj.project.name, 'Progetto importato')), created: obj.project.created || now, updated: now, order: 0 };
    const ops = [{ store: 'projects', put: p }];
    const secMap = new Map(), secs = [], items = [];
    for (const s of (obj.sections || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      const ns = { id: uid('s'), projectId: p.id, name: clean(s.name, 'Sezione'), kind: KIND_BY_ID.has(s.kind) ? s.kind : 'tavola', order: secs.length, created: s.created || now, updated: now };
      secMap.set(s.id, ns.id); secs.push(ns); ops.push({ store: 'sections', put: ns });
    }
    for (const i of obj.items) {
      if (!TYPE_BY_ID.has(i?.type) || i.data === undefined || i.data === null) continue;
      if (i.type === 'scene' && !Array.isArray(i.data.characters)) continue;
      const text = JSON.stringify(i.data);
      const ni = { id: uid('i'), projectId: p.id, sectionId: secMap.get(i.sectionId) || null, type: i.type, name: clean(i.name, TYPE_BY_ID.get(i.type).label), created: i.created || now, updated: i.updated || now, size: text.length + (i.thumb?.length || 0), meta: i.meta || {} };
      items.push(ni);
      ops.push({ store: 'items', put: ni }, { store: 'data', put: { id: ni.id, data: i.data } });
      if (typeof i.thumb === 'string' && i.thumb.startsWith('data:image/')) ops.push({ store: 'thumbs', put: { id: ni.id, thumb: i.thumb } });
    }
    await this._write(ops);
    this.projects.set(p.id, p);
    for (const s of secs) this.sectionsById.set(s.id, s);
    for (const i of items) this.itemsById.set(i.id, i);
    this._emit('projects', p.id);
    return { ...p, itemCount: items.length, sectionCount: secs.length };
  }
}

/** Small summary of a scene payload, shown on its card. */
export function sceneMeta(data) {
  return { chars: Array.isArray(data?.characters) ? data.characters.length : 0 };
}
