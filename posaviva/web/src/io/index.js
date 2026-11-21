// Entry point of the "ui" module (folder io/). See posaviva/ARCHITECTURE.md.
//
// - top bar: selected-character chip, undo / redo, main menu
// - "Personaggi" tool: character list + add flow (max 8)
// - scenes: save / open / rename / delete in localStorage, autosave + restore at startup,
//   new scene, .json export / import
// - image export (PNG 1x/2x/3x, transparent background, comic-panel crop) and sharing
// - settings (quality, vibration, tips, language, tutorial), info & credits
// - first-run onboarding and first-use tips per tool group
// - keeps the 3D subject visible when the sheet / side panel is open (camera view offset)
//
// Public API: app.modules.ui = { scenes, exporter, settings, thumbs, viewOffset, people,
//   openPeople({add}), addCharacter(presetId), saveScene(), newScene(), openScenes(), openExport({share}),
//   exportSceneFile(), importSceneFile(), openSettings(), openInfo(), showOnboarding(), tip(groupId) }
import './io.css';
import { toast } from '../ui/kit.js';
import { Settings } from './storage.js';
import { BodyThumbs } from './thumbs.js';
import { ViewOffset } from './viewOffset.js';
import { Exporter } from './exporter.js';
import { SceneManager } from './scenes.js';
import { PeopleTool, setCharacterHidden } from './people.js';
import { TopBar } from './topbar.js';
import { showOnboarding, isOnboarded, resetOnboarding } from './onboarding.js';
import * as S from './sheets.js';

/** First-use tips, shown once per tool group (Impostazioni › Suggerimenti). */
const TIPS = {
  people: 'Tocca un personaggio per selezionarlo',
  pose: 'Tocca una parte del corpo e trascina gli anelli',
  look: 'Forma, capelli e vestiti del selezionato',
  scene: 'Trascina le luci per spostarle',
  camera: 'Scegli obiettivo e punto focale',
  style: 'Prova lo stile Fumetto per la china',
};

export function create(app, shell) {
  const settings = new Settings();
  const thumbs = new BodyThumbs(app.model);
  const viewOffset = new ViewOffset(app, shell);
  const exporter = new Exporter(app, viewOffset);
  const scenes = new SceneManager(app, { thumbnail: () => exporter.thumbnail() });
  const ctx = { app, shell, settings, thumbs, viewOffset, exporter, scenes };

  const actions = {
    newScene: () => S.newScene(ctx),
    saveScene: () => S.saveScene(ctx),
    openScenes: () => S.openScenes(ctx),
    exportImage: (share) => S.openExport(ctx, { share }),
    exportSceneFile: () => S.exportSceneFile(ctx),
    importSceneFile: () => S.importSceneFile(ctx),
    openSettings: () => S.openSettings(ctx),
    openInfo: () => S.openInfo(ctx),
    restartTutorial: () => { resetOnboarding(); settings.set('tipsSeen', {}); settings.set('tips', true); showOnboarding(); },
  };
  ctx.actions = actions;

  const people = new PeopleTool(ctx);
  ctx.people = people;
  const topbar = new TopBar(ctx);

  // ---- tips: once per group, the first time it is opened
  function tip(group) {
    if (!group || settings.get('tips') === false) return;
    const seen = settings.get('tipsSeen') || {};
    if (seen[group] || !TIPS[group]) return;
    settings.set('tipsSeen', { ...seen, [group]: true });
    shell.hint(TIPS[group], 4200);
  }
  // (not under automation: keeps e2e / screenshot runs of other modules clean; ?tour=1 forces them)
  const automated = navigator.webdriver && !/[?&]tour=1\b/.test(location.search);
  app.addEventListener('tool', (e) => {
    if (!e.id || automated || !isOnboarded()) return;
    const t = shell.tools.find((x) => x.id === e.id);
    tip(t?.group || t?.id);
  });

  scenes.addEventListener('autosave-error', (e) => {
    toast(e.quota ? 'Memoria piena: il salvataggio automatico è sospeso. Elimina qualche scena salvata.' : 'Salvataggio automatico non riuscito', { kind: 'warning', ms: 4200, action: e.quota ? { label: 'Gestisci', onClick: actions.openScenes } : null });
  });

  // ---- startup: restore the autosave once every module is registered. Deferred to a
  // microtask so every module's 'ready' listener and main.js's history.reset() have run
  // (no frame is drawn in between, so the default scene never flashes).
  app.addEventListener('ready', () => queueMicrotask(() => {
    try { scenes.pristine = app.serialize(); } catch { scenes.pristine = null; }
    // the render module owns quality when present; otherwise apply our own cap
    if (!app.modules.render && settings.get('quality')) S.applyQuality(ctx, settings.get('quality'));
    const restored = earlyRestored || scenes.restoreAutosave();
    if (restored) console.info('[PosaViva] autosave restored');
    else scenes.markClean();
    const forceTour = /[?&]tour=1\b/.test(location.search);
    if (forceTour || (!isOnboarded() && !navigator.webdriver)) {
      // after the loading screen has faded; e2e scripts may set the flag meanwhile
      setTimeout(() => { if (forceTour || !isOnboarded()) showOnboarding(); }, 750);
    }
  }));

  // ---- per-character listeners (chip / list refresh on preset or skin changes)
  const listeners = new WeakMap();
  let earlyRestored = false;
  const mod = {
    /** main.js asks modules for the initial scene before creating the default character */
    provideInitialScene() {
      earlyRestored = scenes.restoreAutosave();
      return earlyRestored;
    },
    // public API
    scenes, exporter, settings, thumbs, viewOffset, people, actions,
    openPeople: (o) => people.open(o),
    addCharacter: (presetId) => people.add(presetId),
    saveScene: actions.saveScene, newScene: actions.newScene, openScenes: actions.openScenes,
    openExport: (o = {}) => S.openExport(ctx, o),
    exportSceneFile: actions.exportSceneFile, importSceneFile: actions.importSceneFile,
    openSettings: actions.openSettings, openInfo: actions.openInfo,
    showOnboarding, tip,

    // module hooks
    onCharacterAdded(ch) {
      let last = '';
      const fn = () => {
        const key = `${ch.presetId}|${ch.appearance.skin}|${ch.name}`;
        if (key === last) return;
        last = key;
        topbar.refresh();
        people.refresh();
      };
      listeners.set(ch, fn);
      ch.addEventListener('shape', fn);
      ch.addEventListener('appearance', fn);
      mod.deserializeCharacter(ch);
    },
    onCharacterRemoved(ch) {
      const fn = listeners.get(ch);
      if (fn) { ch.removeEventListener('shape', fn); ch.removeEventListener('appearance', fn); }
    },
    deserializeCharacter(ch) {
      const hidden = !!ch.data?.ui?.hidden;
      if (ch.root.visible === hidden) setCharacterHidden(ch, hidden);
    },
  };
  return mod;
}
