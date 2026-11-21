import './ui/styles.css';
import * as THREE from 'three';
import { loadHumanModel } from './core/HumanModel.js';
import { App } from './app.js';
import { Shell } from './ui/shell.js';
import { materials } from './render/materials.js';
import { createBodyModule } from './body/bodyModule.js';

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
  const model = await loadHumanModel('./assets/');
  const root = document.getElementById('app');
  const shell = new Shell(null, root);
  const app = new App(shell.canvasHost, model);
  shell.app = app;
  app.shell = shell;

  const texLoader = new THREE.TextureLoader();
  texLoader.load('./assets/eye.png', (t) => { t.colorSpace = THREE.SRGBColorSpace; materials.setTexture('eye', t); app.invalidate(); });
  texLoader.load('./assets/skin.png', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; materials.setTexture('skinDetail', t); app.invalidate(); });

  app.registerModule('body', createBodyModule(app, shell));

  const only = new URLSearchParams(location.search).get('only');
  const wanted = only ? new Set(only.split(',')) : null;
  const loaded = await Promise.allSettled(MODULES.filter(([n]) => !wanted || wanted.has(n)).map(async ([name, load]) => [name, await load()]));
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
  app.dispatchEvent({ type: 'ready' });
  app.history.reset();

  window.__pv = { app, shell, THREE, model, materials };
  const loading = document.getElementById('pv-loading');
  loading.style.opacity = 0;
  setTimeout(() => loading.remove(), 450);
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('pv-loading').innerHTML = `<div style="padding:24px;color:#ff8a8a">Errore di avvio: ${e.message}</div>`;
});
