# Progetti (projects, sections, saved items)

A comic artist's archive: **projects** (one per comic) → ordered **sections**
(capitolo / tavola / vignetta, free names) → saved **items**:

| type        | what is saved                                                        | how it comes back                                   |
|-------------|----------------------------------------------------------------------|-----------------------------------------------------|
| `scene`     | `app.serialize()` (everything)                                       | replaces the scene (asks about unsaved changes)     |
| `landscape` | `app.landscapes.exportData()`, or `{kind:'environment', scene:{props, animals, lights, landscapes}}` for a place built by hand (no characters, no held props) | `app.landscapes.applySaved(data)` / environment replaced, characters and camera kept (one undo step) |
| `character` | `ch.toJSON()` without id / position (body, outfit, hair, face, pose) | a NEW character at a free spot, facing the camera, framed (one undo step) |
| `pose`      | `{bones, root (f_normal units), ground: 'shoes'|'skin'|null, seat}`  | applied to the selected character like *Copia su…* (re-grounded / seated, arms out of the body) |

## How the user reaches it

* Menu ☰ › **Progetti**: covers of the projects → a project (sections with
  thumbnails, filter Scene / Paesaggi / Personaggi / Pose, search across all projects).
  Tap an item: **Apri scena**, **Applica paesaggio**, **Inserisci nella scena**,
  **Applica posa**, then Rinomina / Sposta in… / Duplica / Elimina.
* Menu ☰ › **Salva scena** (first time: the *Salva in…* sheet), **Salva in…**
  (what, name, project, section; new project / section inline).
* Personaggi: 📖 **Personaggi salvati**; row ⋯ › **Salva personaggio…** / **Salva posa…**.
* Project ⋯ › **Esporta file (.posaviva)** / **Importa** (a project, or a single scene file).

## Storage

IndexedDB `posaviva-projects` (stores `projects`, `sections`, `items` = headers,
`data` = payloads, `thumbs` = JPEG data URLs). Headers are kept in memory (instant
lists and search); payloads and thumbnails are read on demand. Without IndexedDB a
memory backend is used (`app.projects.persistent === false`, the UI warns).
At first start the scenes of earlier versions (`localStorage posaviva.scenes`) move
into the project **I miei fumetti** with their ids (the autosave keeps pointing to
them), then the localStorage key is removed. Current target of saves:
`localStorage posaviva.projects.current = {projectId, sectionId}`.

`.posaviva` file: `{app:'PosaViva', kind:'project', version:1, project, sections[], items:[{…header, data, thumb}]}`.
Import always creates a new project (new ids, unique name).

## API (`app.projects`, also `app.modules.projects`)

Queries are synchronous (in-memory headers; empty until `ready`), changes return Promises.

```js
await app.projects.ready
app.projects.list()                         // [{id, name, created, updated, counts:{total, scene, landscape, character, pose}, sectionCount}]
app.projects.current / .currentSection      // default target of saves;  setCurrent(projectId, sectionId?)
await app.projects.create(name) / rename(id, name) / remove(id)
app.projects.sections(projectId)            // [{id, projectId, name, kind, order}] in order
await app.projects.createSection(projectId, name, 'capitolo'|'tavola'|'vignetta')
await app.projects.updateSection(id, {name, kind}) / moveSection(id, ±1) / removeSection(id, {withItems})
await app.projects.saveItem({type, name, projectId?, sectionId?, data?, thumb?, id?, character?})  // -> item header
      // data omitted: current scene / landscape (exportData, else serialize) / selected (or `character`) character / its pose
      // projectId omitted: current project; sectionId omitted: current section (when saving into the current project)
      // type 'scene' without data: the scene on screen becomes this saved scene
await app.projects.loadItem(id, {character?, force?})   // -> {item, ok, character?}; throws Error (Italian message)
await app.projects.getItem(id)              // header + data + thumb
app.projects.items({projectId, sectionId, type}) / item(id) / find('testo' | {text, type, projectId})
await app.projects.renameItem / moveItem(id, {projectId, sectionId}) / duplicateItem / removeItem
await app.projects.exportProject(id) / importFile() / importText(text, fileName)
app.projects.open({projectId, type, query}) // browser UI
await app.projects.openSaveSheet({type, name, data, thumb, character, projectId, sectionId, title, silent})  // -> item | null
app.projects.addEventListener('change', (e) => e.what)   // 'projects' | 'sections' | 'items' | 'current' | 'all'
```

## Files

```
index.js    module entry, public API, save defaults (prepare), scene follow-up
store.js    ProjectStore: in-memory headers, CRUD, migration, search, export / import
db.js       IndexedDB backend (+ memory fallback)
items.js    per type: data from the scene, apply / insert
capture.js  thumbnails: camera view (landscapes without characters) / one character framed alone
ui.js       Progetti browser, "Salva in…" sheet, "Sposta in…" picker (lazy chunk)
projects.css
```
