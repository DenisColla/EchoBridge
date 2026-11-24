// IndexedDB storage of the projects archive (database 'posaviva-projects').
//
// Stores (keyPath 'id'):
//   projects  {id, name, created, updated, order}
//   sections  {id, projectId, name, kind, order, created, updated}
//   items     {id, projectId, sectionId|null, type, name, created, updated, size, meta}   metadata only
//   data      {id, data}    payload of an item (scene JSON, landscape recipe, character, pose)
//   thumbs    {id, thumb}   JPEG/PNG data URL of an item (loaded on demand by the browser)
//
// Metadata is small and kept in memory by the store; payloads and thumbnails are
// read only when needed. When IndexedDB is not available (private mode, blocked
// storage) a memory backend with the same interface is used (`persistent` false).

const DB_NAME = 'posaviva-projects';
const DB_VERSION = 1;
export const STORES = ['projects', 'sections', 'items', 'data', 'thumbs'];

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

class IDBBackend {
  constructor(db) { this.db = db; this.persistent = true; }

  static open() {
    return new Promise((resolve, reject) => {
      let r;
      try { r = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) {
          const os = db.createObjectStore(s, { keyPath: 'id' });
          if (s === 'sections' || s === 'items') os.createIndex('projectId', 'projectId');
        }
      };
      r.onsuccess = () => {
        const db = r.result;
        // another tab upgrading the schema: let it, this one reloads its data on next start
        db.onversionchange = () => db.close();
        resolve(new IDBBackend(db));
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('archivio bloccato da un\'altra finestra'));
    });
  }

  async getAll(store) { return req(this.db.transaction(store).objectStore(store).getAll()); }

  async get(store, id) { return (await req(this.db.transaction(store).objectStore(store).get(id))) ?? null; }

  /** Many keys of one store in one transaction -> Map id -> record. */
  getMany(store, ids) {
    return new Promise((resolve, reject) => {
      const out = new Map();
      if (!ids.length) { resolve(out); return; }
      const tx = this.db.transaction(store);
      const os = tx.objectStore(store);
      for (const id of ids) { const r = os.get(id); r.onsuccess = () => { if (r.result) out.set(id, r.result); }; }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('lettura interrotta'));
    });
  }

  /**
   * Atomic batch: ops = [{store, put: record} | {store, del: id}] (all or nothing).
   * Rejects with the transaction error (QuotaExceededError when the storage is full).
   */
  write(ops) {
    return new Promise((resolve, reject) => {
      if (!ops.length) { resolve(); return; }
      const names = [...new Set(ops.map((o) => o.store))];
      let tx;
      try { tx = this.db.transaction(names, 'readwrite'); } catch (e) { reject(e); return; }
      for (const o of ops) {
        const os = tx.objectStore(o.store);
        if (o.del !== undefined) os.delete(o.del); else os.put(o.put);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => { e.preventDefault?.(); };
      tx.onabort = () => reject(tx.error || new Error('scrittura interrotta'));
    });
  }
}

/** Same interface, kept in memory (nothing survives a reload). */
class MemoryBackend {
  constructor() { this.persistent = false; this.s = Object.fromEntries(STORES.map((n) => [n, new Map()])); }
  async getAll(store) { return [...this.s[store].values()].map((r) => structuredClone(r)); }
  async get(store, id) { const r = this.s[store].get(id); return r ? structuredClone(r) : null; }
  async getMany(store, ids) { const out = new Map(); for (const id of ids) { const r = this.s[store].get(id); if (r) out.set(id, structuredClone(r)); } return out; }
  async write(ops) {
    for (const o of ops) { if (o.del !== undefined) this.s[o.store].delete(o.del); else this.s[o.store].set(o.put.id, structuredClone(o.put)); }
  }
}

/** -> backend (IndexedDB, else memory). Never rejects. */
export async function openBackend() {
  if (typeof indexedDB === 'undefined') return new MemoryBackend();
  try { return await IDBBackend.open(); }
  catch (e) { console.warn('[PosaViva] IndexedDB not available, projects kept in memory', e); return new MemoryBackend(); }
}

export function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || /quota/i.test(e.message || ''));
}
