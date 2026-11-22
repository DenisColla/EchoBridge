// Entry point of the "projects" module (Progetti). See posaviva/ARCHITECTURE.md and README.md here.
//
// Comic projects (fumetti) -> ordered sections (capitolo / tavola / vignetta) -> saved items:
// complete scenes, landscapes (environment without characters), characters (body, outfit,
// hair, face, pose) and poses. Stored in IndexedDB (payloads + thumbnails); the scenes saved
// by earlier versions in localStorage are moved into the default project "I miei fumetti".
//
// Public API: app.projects (also app.modules.projects)
//   ready                                    Promise, resolves when the archive is loaded
//   list() -> projects [{id, name, created, updated, counts, sectionCount}] (most recent first)
//   current / currentSection                 default target of saves; setCurrent(projectId, sectionId?)
//   get(projectId)
//   create(name) / rename(projectId, name) / remove(projectId)                   -> Promise
//   sections(projectId) -> ordered sections [{id, projectId, name, kind, order}]
//   createSection(projectId, name, kind 'capitolo'|'tavola'|'vignetta')        -> Promise<section>
//   updateSection(id, {name, kind}) / renameSection / moveSection(id, ±1) / removeSection(id, {withItems})
//   saveItem({type: 'scene'|'landscape'|'character'|'pose', name, projectId?, sectionId?, data?, thumb?,
//             id? (overwrite), character? (for character / pose)})            -> Promise<item>
//       data omitted = the current scene / landscape / selected character / its pose
//   loadItem(id, {character?, force?}) -> Promise<{item, character?}>
//       scene: opens it (asks about unsaved changes unless force); landscape: applies it to the
//       current scene; character: inserts a new character; pose: applies it to the selected one
//   getItem(id) -> Promise<item + data + thumb>; item(id); items({projectId, sectionId, type})
//   removeItem(id) / renameItem(id, name) / moveItem(id, {projectId, sectionId}) / duplicateItem(id)
//   find(query: text | {text, type, projectId}) -> item headers with projectName / sectionName
//   exportProject(id) / importFile()        .posaviva file (whole project, one JSON)
//   open({projectId, type, query}) / openSaveSheet({type, name, data, thumb, character})   UI
//   TYPES, SECTION_KINDS; events: addEventListener('change', e => e.what)
import { ProjectStore, ITEM_TYPES, TYPE_BY_ID, SECTION_KINDS, norm, sceneMeta } from './store.js';
import { viewThumb, subjectThumb } from './capture.js';
import { landscapeData, landscapeMeta, characterData, characterMeta, poseData, targetCharacter, applyLandscape, insertCharacter, applyPose } from './items.js';

export function create(app, shell) {
  const store = new ProjectStore();
  let uiMod = null;
  const loadUI = () => (uiMod ||= import('./ui.js'));
  const io = () => app.modules?.ui || null;

  /** Fills data / thumb / meta / name of a save request from the current scene. */
  async function prepare(o) {
    const type = o.type;
    if (!TYPE_BY_ID.has(type)) throw new Error(`Tipo non valido: ${type}`);
    let { data, thumb, name } = o;
    let meta = o.meta;
    if (type === 'scene') {
      data ??= app.serialize();
      if (thumb === undefined) thumb = await viewThumb(app);
      meta ||= sceneMeta(data);
      name ||= io()?.scenes?.current?.name && io().scenes.current.name !== 'Senza titolo' ? io().scenes.current.name : `Scena ${store.items({ type: 'scene' }).length + 1}`;
    } else if (type === 'landscape') {
      data ??= landscapeData(app);
      if (thumb === undefined) thumb = await viewThumb(app, { noCharacters: true });
      meta ||= landscapeMeta(app, data);
      name ||= meta.label || `Paesaggio ${store.items({ type: 'landscape' }).length + 1}`;
    } else if (type === 'character') {
      const ch = data ? null : targetCharacter(app, o.character);
      if (!data) { data = characterData(ch); meta ||= characterMeta(ch); }
      if (thumb === undefined) thumb = ch ? await subjectThumb(app, ch) : null;
      meta ||= { sex: data?.json?.preset?.startsWith('m') ? 'M' : 'F', preset: data?.json?.preset };
      name ||= ch?.name || data?.json?.name || 'Personaggio';
    } else if (type === 'pose') {
      const ch = data ? null : targetCharacter(app, o.character);
      if (!data) data = await poseData(ch);
      if (thumb === undefined) thumb = ch ? await subjectThumb(app, ch) : null;
      meta ||= ch ? { sex: ch.sex, ground: data.ground } : {};
      name ||= ch ? `Posa di ${ch.name}` : 'Posa';
    }
    return { ...o, data, thumb, meta, name };
  }

  const api = {
    store,
    ready: store.ready.then(() => api),
    TYPES: ITEM_TYPES,
    SECTION_KINDS,
    get persistent() { return store.persistent; },

    // ---- projects
    list: () => store.list(),
    get current() { return store.current; },
    get currentSection() { return store.currentSection; },
    setCurrent: (projectId, sectionId) => store.setCurrent(projectId, sectionId),
    get: (id) => store.get(id),
    create: async (name) => { await store.ready; return store.create(name); },
    rename: async (id, name) => { await store.ready; return store.rename(id, name); },
    remove: async (id) => { await store.ready; return store.remove(id); },

    // ---- sections
    sections: (projectId = store.current?.id) => store.sections(projectId),
    section: (id) => store.section(id),
    createSection: async (projectId, name, kind) => { await store.ready; return store.createSection(projectId || store.current?.id, name, kind); },
    updateSection: async (id, patch) => { await store.ready; return store.updateSection(id, patch); },
    renameSection: async (id, name) => { await store.ready; return store.updateSection(id, { name }); },
    moveSection: async (id, delta) => { await store.ready; return store.moveSection(id, delta); },
    removeSection: async (id, opts) => { await store.ready; return store.removeSection(id, opts); },
    nextSectionName: (projectId, kind) => store.nextSectionName(projectId, kind),

    // ---- items
    item: (id) => store.item(id),
    items: (f) => store.items(f),
    getItem: async (id) => { await store.ready; return store.getItem(id); },
    thumbs: async (ids) => { await store.ready; return store.thumbs(ids); },
    find: (q) => store.find(q),
    renameItem: async (id, name) => { await store.ready; const it = await store.renameItem(id, name); followScene(it); return it; },
    moveItem: async (id, to) => { await store.ready; return store.moveItem(id, to); },
    duplicateItem: async (id) => { await store.ready; return store.duplicateItem(id); },
    removeItem: async (id) => { await store.ready; return store.removeItem(id); },
    usage: (projectId) => store.usage(projectId),

    /**
     * Saves an item (see the header). Without projectId: the current project; without
     * sectionId: the current section when saving into the current project.
     */
    async saveItem(opts = {}) {
      await store.ready;
      const o = await prepare(opts);
      const old = o.id ? store.item(o.id) : null;
      const projectId = o.projectId || old?.projectId || store.current?.id;
      let sectionId = o.sectionId;
      if (sectionId === undefined) sectionId = old ? old.sectionId : projectId === store.current?.id ? store.currentSection?.id || null : null;
      const item = await store.putItem({ id: o.id, type: o.type, name: o.name, projectId, sectionId, data: o.data, thumb: o.thumb, meta: o.meta });
      // the scene on screen becomes this saved scene ("Salva in…")
      if (o.type === 'scene' && opts.data === undefined) io()?.scenes?.adopt?.(item);
      return item;
    },

    async loadItem(id, opts = {}) {
      await store.ready;
      const it = await store.getItem(id);
      if (!it) throw new Error('Elemento non trovato');
      if (it.data == null) throw new Error('Il contenuto di questo elemento è andato perso');
      if (it.type === 'scene') {
        const ui = io();
        if (ui?.loadScene) { const ok = await ui.loadScene(it.data, { id: it.id, name: it.name, guard: !opts.force }); return { item: it, ok }; }
        app.deserialize(it.data);
        app.history.reset();
        return { item: it, ok: true };
      }
      if (it.type === 'landscape') { await applyLandscape(app, it.data); return { item: it, ok: true }; }
      if (it.type === 'character') { const ch = insertCharacter(app, it.data, it.name); return { item: it, ok: true, character: ch }; }
      if (it.type === 'pose') { const ch = await applyPose(app, it.data, opts.character); return { item: it, ok: true, character: ch }; }
      throw new Error('Tipo non valido');
    },

    // ---- files
    async exportProject(id) {
      await store.ready;
      const obj = await store.exportProject(id);
      const ex = io()?.exporter;
      const slug = norm(obj.project.name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'progetto';
      const text = JSON.stringify(obj);
      if (!ex?.saveText) throw new Error('Esportazione non disponibile');
      return { ...ex.saveText(text, `${slug}.posaviva`, 'application/json'), items: obj.items.length };
    },
    /** Imports a .posaviva project, or a single scene file into the current project. */
    async importText(text, fileName = '') {
      await store.ready;
      let j;
      try { j = JSON.parse(text); } catch { throw new Error('Il file non è un file di PosaViva valido'); }
      if (j?.kind === 'project') return { project: await store.importProject(j) };
      if (j && Array.isArray(j.characters)) {
        const name = (typeof j.name === 'string' && j.name.trim()) || fileName.replace(/\.(posaviva\.)?json$/i, '').replace(/[-_]+/g, ' ').trim() || 'Scena importata';
        const data = { ...j }; delete data.name; delete data.exported;
        const item = await store.putItem({ type: 'scene', name, projectId: store.current?.id, sectionId: null, data, thumb: null, meta: sceneMeta(data) });
        return { item };
      }
      throw new Error('Il file non contiene un progetto o una scena di PosaViva');
    },
    async importFile() {
      const ex = io()?.exporter;
      if (!ex?.pickTextFile) throw new Error('Importazione non disponibile');
      const f = await ex.pickTextFile('.posaviva,.json,application/json', 200 * 1024 * 1024);
      if (!f) return null;
      if (f.error) throw new Error(`Impossibile leggere il file: ${f.error}`);
      return api.importText(f.text, f.name);
    },

    // ---- UI
    open: (o = {}) => loadUI().then((m) => m.openBrowser(ctx, o)),
    openSaveSheet: (o = {}) => loadUI().then((m) => m.openSaveSheet(ctx, o)),

    addEventListener: (t, fn) => store.addEventListener(t, fn),
    removeEventListener: (t, fn) => store.removeEventListener(t, fn),
  };
  const ctx = { app, shell, api, store, io };

  /** A renamed / deleted scene item that is the scene on screen. */
  function followScene(it) {
    const sc = io()?.scenes;
    if (sc?.current?.id === it?.id && it?.name) sc.adoptName?.(it.name);
  }
  store.addEventListener('change', (e) => {
    const sc = io()?.scenes;
    if (!sc?.current?.id) return;
    if ((e.what === 'items' || e.what === 'projects' || e.what === 'all') && !store.item(sc.current.id)) sc.detach?.();
  });

  app.projects = api;
  // fetch the UI chunk when the app is idle, so the first "Progetti" opens instantly
  app.addEventListener('ready', () => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    setTimeout(() => idle(() => loadUI().catch(() => { uiMod = null; })), 5000);
  });
  return api;
}
