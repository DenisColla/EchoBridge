import './ui/styles.css';
import * as THREE from 'three';
import { loadHumanModel } from './core/HumanModel.js';
import { App } from './app.js';
import { Shell } from './ui/shell.js';
import { materials } from './render/materials.js';
import { createBodyModule } from './body/bodyModule.js';
import { toast } from './ui/kit.js';

// Feature modules. Each entry file exports `create(app, shell)` returning a
// module object (see ARCHITECTURE.md). They are loaded independently so a
// failure in one module never prevents the app from starting.
// `?only=pose,clothing` loads a subset (useful while developing a module).
const MODULES = [
  ['render', () => import('./render/index.js')],
  ['scene', () => import('./scene/index.js')],
  ['ui', () => import('./io/index.js')],
  ['pose', () => import('./pose/index.js')],
  ['face', () => import('./face/index.js')],
  ['clothing', () => import('./clothing/index.js')],
  ['hair', () => import('./hair/index.js')],
  ['props', () => import('./props/index.js')],
];

async function boot() {
  // fetch the body data and the feature modules' code in parallel
  const only = new URLSearchParams(location.search).get('only');
  const wanted = only ? new Set(only.split(',')) : null;
  const imports = Promise.allSettled(MODULES.filter(([n]) => !wanted || wanted.has(n)).map(async ([name, load]) => [name, await load()]));
  const model = await loadHumanModel('./assets/');
  const root = document.getElementById('app');
  const shell = new Shell(null, root);
  const app = new App(shell.canvasHost, model);
  shell.app = app;
  app.shell = shell;
  app.holdRendering(true);

  const texLoader = new THREE.TextureLoader();
  texLoader.load('./assets/eye.png', (t) => { t.colorSpace = THREE.SRGBColorSpace; materials.setTexture('eye', t); app.invalidate(); });
  texLoader.load('./assets/skin.png', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; materials.setTexture('skinDetail', t); app.invalidate(); });

  app.registerModule('body', createBodyModule(app, shell));

  const loaded = await imports;
  for (const r of loaded) {
    if (r.status !== 'fulfilled') { console.error('[PosaViva] module load failed', r.reason); continue; }
    const [name, mod] = r.value;
    try { app.registerModule(name, mod.create(app, shell) || {}); }
    catch (e) { console.error(`[PosaViva] module ${name} init failed`, e); }
  }

  // ---- initial scene (a module may replace it, e.g. by restoring the autosave) ----
  for (const m of Object.values(app.modules)) { try { if (m.provideInitialScene?.()) break; } catch (e) { console.error('[PosaViva] initial scene failed', e); } }
  if (!app.characters.length) {
    const ch = app.addCharacter({ preset: 'f_normal' });
    app.select(ch);
  }
  app.holdRendering(false);
  app.dispatchEvent({ type: 'ready' });
  app.history.reset();

  watchGpuContext(app);
  window.__pv = { app, shell, THREE, model, materials };
  revealWhenDrawn(app);
}

/**
 * Keeps the splash screen up until the first scene is complete: the outfits are
 * built over several frames and the first full frame compiles the shaders (a
 * hitch of up to a second or two on a phone GPU). Revealing after that avoids a
 * character that pops from bare to dressed and a frozen first touch. Never waits
 * more than MAX_SPLASH_MS.
 */
const MAX_SPLASH_MS = 3500;
function revealWhenDrawn(app) {
  const loading = document.getElementById('pv-loading');
  if (!loading) return;
  let done = false;
  const reveal = () => {
    if (done) return;
    done = true;
    loading.style.opacity = 0;
    setTimeout(() => loading.remove(), 450);
  };
  setTimeout(reveal, MAX_SPLASH_MS);
  const built = app.clothing?.whenIdle?.() || Promise.resolve();
  built.then(() => {
    // two complete frames after the build queue drained (the first one compiles the programs)
    let frames = 0;
    const off = app.addAfterRenderHook(() => { if (++frames >= 2) { off(); requestAnimationFrame(reveal); } else app.invalidate(); });
    app.invalidate();
  }, reveal);
}

/**
 * The browser normally gives a lost WebGL context back within a second or two
 * (App redraws by itself then). If it does not (repeated GPU resets make Chrome
 * refuse new contexts for the page), offer a reload: the scene is autosaved and
 * comes back on start.
 */
function watchGpuContext(app) {
  let timer = 0, note = null;
  app.addEventListener('contextlost', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!app.contextLost) return;
      try { app.modules.ui?.scenes?.flushAutosave?.(true); } catch (e) { console.warn('[PosaViva] autosave before reload failed', e); }
      note = toast('La grafica si è interrotta.', {
        kind: 'warning', ms: 60000,
        action: { label: 'Ricarica', onClick: () => { try { app.modules.ui?.scenes?.flushAutosave?.(true); } catch { /* reload anyway */ } location.reload(); } },
      });
    }, 4000);
  });
  app.addEventListener('contextrestored', () => { clearTimeout(timer); note?._dismiss?.(); note = null; });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('pv-loading').innerHTML = `<div style="padding:24px;color:#ff8a8a">Errore di avvio: ${e.message}</div>`;
});
