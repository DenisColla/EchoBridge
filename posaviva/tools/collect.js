// Collects every visible label of the app (all tools, pose modes, editors, menus, sheets,
// Progetti, Comandi vocali, Paesaggi) into the JSON file named by process.env.OUT, for
// tools/checklabels.mjs (guide labels vs the running app).
//   module.exports(page, shot, log): page = Playwright page on the full app (window.__pv ready)
// Calls that open a sheet are never awaited (their promise settles only when it closes).
// Each block is optional: a module missing from the build (?only=…) is skipped, a selector
// that no longer matches is logged as "miss" so the audit itself can be kept up to date.
module.exports = async (page, shot, log = console.log) => {
  const texts = new Set();
  const grab = async (root = 'body') => {
    const r = await page.evaluate((root) => {
      const out = [];
      const el = document.querySelector(root) || document.body;
      out.push(el.innerText);
      el.querySelectorAll('[title],[aria-label],input[placeholder],textarea[placeholder]').forEach((e) => out.push(e.getAttribute('title') || '', e.getAttribute('aria-label') || '', e.getAttribute('placeholder') || ''));
      return out.join('\n');
    }, root);
    r.split('\n').forEach((x) => x.trim() && texts.add(x.trim()));
  };
  // every page call is bounded: a promise that never settles (e.g. a build waiting for frames)
  // is logged and skipped instead of stalling the whole audit
  const ev = (fn, arg, ms = 60000) => {
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => { log('timeout: ' + String(fn).slice(0, 90)); resolve(undefined); }, ms); });
    return Promise.race([page.evaluate(fn, arg).finally(() => clearTimeout(timer)), late]);
  };
  const wait = (ms) => page.waitForTimeout(ms);
  // DOM click (Playwright's actionability checks wait for stable animation frames, which take
  // seconds each under SwiftShader). 'css:has-text("text")' = first match whose text contains text.
  const click = async (sel, ms = 400) => {
    const m = /^(.*):has-text\("([^"]*)"\)(.*)$/.exec(sel);
    const ok = await ev(([css, text]) => {
      const el = [...document.querySelectorAll(css)].find((e) => text == null || e.textContent.includes(text));
      if (!el) return false;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      el.click();
      return true;
    }, m ? [m[1] + m[3], m[2]] : [sel, null]).catch(() => false);
    if (!ok) { log('miss: ' + sel); return false; }
    await wait(ms);
    return true;
  };
  const esc = async () => { await page.keyboard.press('Escape'); await wait(350); };
  // closes every dialog / menu / sheet still open
  const escAll = async () => { for (let i = 0; i < 6 && await page.$('#pv-layers .pv-modal:not(.leaving)'); i++) await esc(); };
  const expand = () => ev(() => document.querySelectorAll('.pv-panel .pv-section.collapsed').forEach((s) => s.classList.remove('collapsed')));
  const block = async (name, fn) => { log(`block ${name} (${texts.size} labels)`); try { await fn(); } catch (e) { log(`block ${name} failed: ${e.message}`); await escAll().catch(() => {}); } };

  await ev(() => window.__pv.shell.setSheetSnap('full', { persist: false }));
  const ids = await ev(() => window.__pv.shell.tools.map((t) => t.id));
  log('tools: ' + ids.join(','));
  for (const id of ids) {
    log(`tool ${id} (${texts.size} labels)`);
    await ev((id) => window.__pv.shell.openTool(id), id);
    await wait(400);
    if (id === 'pose') {
      for (const m of ['rotate', 'ik', 'line', 'move']) { await ev((m) => window.__pv.app.posing.setMode(m), m); await wait(250); await grab('.pv-panel'); }
      await ev(() => { window.__pv.app.posing.setMode('rotate'); const { app } = window.__pv; app.select(app.characters[0], 'forearm.L'); });
      await wait(400);
      await expand();
    }
    if (id === 'face' || id === 'body' || id === 'style' || id === 'lights') await expand();
    if (id === 'style') {
      for (const st of ['toon', 'lines', 'realistic']) { await ev((st) => window.__pv.app.modules.render.setStyle(st), st); await ev(() => window.__pv.app.modules.render.set({ outline: { toon: true, lines: true, realistic: false } })); await wait(500); await grab('.pv-panel'); }
    }
    await grab('.pv-panel');
  }

  // prop editors: a chair and a hand prop
  await block('props', async () => {
    await ev(() => { const { app } = window.__pv; app.select(app.characters[0]); });
    await ev(() => window.__pv.shell.openTool('props'));
    await wait(400);
    // the library opens on its first category: search the chair
    if (!await ev(() => { const i = document.querySelector('.pv-panel .pv-pr-search-input'); if (!i) return false; i.value = 'sedia'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })) log('miss: props search');
    await wait(600);
    await click('.pv-panel .pv-pr-card', 1500); await expand(); await grab('.pv-panel');
    await ev(() => window.__pv.app.props.select(null)); await wait(300);
    await click('.pv-panel .pv-pr-search-clear', 300);
    await ev(() => window.__pv.app.props.select(null)); await wait(300);
    await click('.pv-panel button.pv-chip:has-text("In mano")', 500); await grab('.pv-panel');
    await click('.pv-panel button:has-text("Tazza")', 1500); await grab('.pv-panel');
    await ev(() => window.__pv.app.props.select(null)); await wait(300);
    await click('.pv-panel button.pv-chip:has-text("Stanze pronte")', 500); await grab('.pv-panel');
    // a ready room: its editor ("Muovi tutta la stanza"), then removed again
    const before = await ev(() => window.__pv.app.props.props.length);
    if (await click('.pv-panel .pv-pr-preset', 3000)) {
      await ev(() => { const P = window.__pv.app.props; P.select(P.props[P.props.length - 1] || null); }); await wait(600); await expand(); await grab('.pv-panel');
      await ev((n) => { const P = window.__pv.app.props; P.select(null); for (const p of P.props.slice(n)) P.remove(p); }, before); await wait(400);
    }
  });
  // building editor
  if (ids.includes('buildings')) await block('buildings', async () => {
    await ev(() => window.__pv.shell.openTool('buildings')); await wait(400);
    await click('.pv-panel button:has-text("Villetta moderna")', 2500); await grab('.pv-panel');
  });
  // animals and exteriors editors
  if (ids.includes('animals')) await block('animals', async () => {
    await ev(() => window.__pv.shell.openTool('animals'));
    await page.waitForSelector('.pv-panel .pv-an-grid .pv-card', { timeout: 20000 }).catch(() => log('miss: animal cards'));
    await grab('.pv-panel');
    await click('.pv-panel .pv-an-grid .pv-card', 6000); await grab('.pv-panel');
  });
  if (ids.includes('exteriors')) await block('exteriors', async () => {
    await ev(() => window.__pv.shell.openTool('exteriors')); await wait(800); await grab('.pv-panel');
    await click('.pv-panel button.pv-chip:has-text("Strade")', 500);
    await click('.pv-panel .pv-card', 2500); await grab('.pv-panel');
    await click('.pv-panel button:has-text("Aggiungi")', 500);
    await click('.pv-panel button.pv-chip:has-text("Veicoli")', 500); await grab('.pv-panel');
    await click('.pv-panel .pv-card', 3000); await grab('.pv-panel');
    // a ready kit: its editor ("Muovi tutto il kit")
    await click('.pv-panel button:has-text("Aggiungi")', 500);
    if (await click('.pv-panel button.pv-chip:has-text("Kit pronti")', 500) && await click('.pv-panel .pv-card', 5000)) {
      await ev(() => { const P = window.__pv.app.props; const p = P.props[P.props.length - 1]; if (p && P.selected !== p) P.select(p); }); await wait(800); await expand(); await grab('.pv-panel');
    }
  });
  // clothes: a worn item and every step of its "Vestibilità" (Aderente, Slim, Normale, Comodo, Largo)
  await block('clothes', async () => {
    await ev(() => { const { app } = window.__pv; app.select(app.characters[0]); window.__pv.shell.openTool('clothes'); }); await wait(400); await grab('.pv-panel');
    if (await click('.pv-panel .pv-clothes-wornchip', 500)) {
      await grab('.pv-panel');
      const fits = await ev(async () => {
        const sl = [...document.querySelectorAll('.pv-panel .pv-slider')].find((s) => /Vestibilit/.test(s.textContent));
        const input = sl?.querySelector('input[type=range]');
        if (!input) return [];
        const out = [];
        for (const v of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          input.value = v; input.dispatchEvent(new Event('input', { bubbles: true }));
          out.push(sl.querySelector('.pv-slider-value')?.textContent || '');
        }
        input.value = 0.5; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
        return out;
      });
      fits.forEach((x) => x && texts.add(x));
      await ev(() => Promise.race([window.__pv.app.clothing?.whenIdle?.(), new Promise((r) => setTimeout(r, 20000))]));
    }
  });
  // people: add view, saved characters, row menu
  await block('people', async () => {
    await ev(() => window.__pv.shell.openTool('people')); await wait(300);
    await grab('.pv-panel');
    await click('.pv-io-person .pv-icon-btn[title="Altre azioni"]', 400); await grab('#pv-layers'); await escAll();
    await click('.pv-panel button:has-text("Aggiungi")', 500); await grab('.pv-panel');
    await ev(() => window.__pv.shell.closePanel()); await wait(300);
  });
  // menus and sheets
  await block('menus', async () => {
    await grab('.pv-topbar');
    await click('.pv-io-menu-btn', 500); await grab('#pv-layers'); await escAll();
    await ev(() => { window.__pv.app.modules.ui.openSettings(); }); await wait(600); await grab('#pv-layers'); await escAll();
    await ev(() => { window.__pv.app.modules.ui.openExport({}); }); await wait(900); await grab('#pv-layers'); await escAll();
    await ev(() => { window.__pv.app.modules.ui.openExport({ share: true }); }); await wait(900); await grab('#pv-layers'); await escAll();
    // with a comic-panel frame and visible guides ("Ritaglia alla vignetta", "Includi le guide
    // prospettiche"), and as in the APK (AndroidBridge: "Salva in Galleria"); state restored after
    const restore = await ev(() => { const g = window.__pv.app.sceneTools?.guides; if (!g) return null; const old = g.getState(); g.set({ visible: true, mode: 2, frame: '4:3' }); window.AndroidBridge ||= { __collectStub: true }; return old; });
    await ev(() => { window.__pv.app.modules.ui.openExport({}); }); await wait(1200); await grab('#pv-layers'); await escAll();
    await ev((old) => { if (window.AndroidBridge?.__collectStub) delete window.AndroidBridge; if (old) window.__pv.app.sceneTools.guides.setState(old); }, restore);
    await ev(() => { window.__pv.app.modules.ui.openInfo(); }); await wait(700); await grab('#pv-layers'); await escAll();
    await ev(() => { window.__pv.app.modules.ui.openScenes(); }); await wait(800); await grab('#pv-layers'); await escAll();
  });
  // quick zoom
  await block('focus', async () => {
    await click('.pv-focus-fab', 500); await grab('.pv-overlay'); await click('.pv-focus-fab', 300);
    await ev(() => { const { app } = window.__pv; app.select(app.characters[0], 'forearm.L'); }); await wait(300);
    await click('.pv-focus-lens', 1500); await grab('.pv-overlay');
    await ev(() => window.__pv.app.modules.focus?.exit?.()); await wait(600);
  });

  // ☰ › Progetti: project ⋯, section ⋯, the menu of a saved item of each type, "Salva in…"
  if (await ev(() => !!window.__pv.app.projects)) await block('projects', async () => {
    await ev(async () => { await window.__pv.app.projects.ready; });
    // a section, a character, a pose, a scene and an environment so every menu has content
    await ev(async () => {
      const { app } = window.__pv, P = app.projects;
      app.select(app.characters[0]);
      const s = await P.createSection(P.current.id, '', 'tavola');
      await P.saveItem({ type: 'character', sectionId: s.id });
      await P.saveItem({ type: 'pose', sectionId: s.id });
      await P.saveItem({ type: 'scene', name: 'Scena di prova', sectionId: s.id, data: app.serialize() });
      try { await P.saveItem({ type: 'landscape', name: 'Ambiente di prova', sectionId: s.id }); } catch { /* nothing to save as a landscape */ }
    });
    await ev(() => { window.__pv.app.modules.ui.saveIn({}); }); await wait(900); await grab('#pv-layers');
    await click('#pv-layers .pv-pj-target .pv-chip:has-text("Nuova sezione")', 300); await grab('#pv-layers'); await escAll();
    await ev(() => { window.__pv.app.projects.open({}); }); await wait(900); await grab('#pv-layers');
    await click('.pv-pj-project .pv-icon-btn', 400); await grab('#pv-layers'); await esc();
    await click('.pv-pj-project', 700); await grab('#pv-layers');
    await click('.pv-pj-ghead .pv-icon-btn[title="Azioni della sezione"]', 400); await grab('#pv-layers'); await esc();
    for (const t of ['scene', 'landscape', 'character', 'pose']) {
      if (await page.$(`.pv-pj-item:has(.t-${t})`)) { await click(`.pv-pj-item:has(.t-${t})`, 400); await grab('#pv-layers'); await esc(); }
    }
    await click('.pv-pj-actions .pv-btn:has-text("Sezione")', 400); await grab('#pv-layers'); await esc();
    await click('.pv-pj-actions .pv-btn:has-text("Salva qui")', 900); await grab('#pv-layers');
    await click('#pv-layers .pv-pj-target .pv-chip:has-text("Nuova sezione")', 300); await grab('#pv-layers');
    await escAll();
  });

  // Comandi vocali: the panel, then its settings in "Ibrida" mode (back to "Solo offline")
  if (await page.$('.pv-vc-fab')) await block('voice', async () => {
    await ev(() => window.__pv.shell.closePanel()); await wait(300);
    await ev(() => { window.__pv.app.voice.open({ listen: false }); }); await wait(800); await grab('.pv-vc-panel');
    await ev(() => { window.__pv.app.voice.openSettings(); }); await wait(600); await grab('#pv-layers');
    if (await click('#pv-layers .pv-seg-btn:has-text("Ibrida")', 300)) { await grab('#pv-layers'); await click('#pv-layers .pv-seg-btn:has-text("Solo offline")', 300); }
    await escAll();
    await ev(() => window.__pv.app.voice.close()); await wait(300);
  });

  // Paesaggi: the panel before and after a generation (Genera nuovo / Rigenera / Svuota / Salva)
  if (ids.includes('landscapes')) await block('landscapes', async () => {
    await ev(() => window.__pv.shell.openTool('landscapes')); await wait(500); await grab('.pv-panel');
    await ev(async () => { await window.__pv.app.landscapes.generate({ preset: 'vicolo' }); }, null, 120000); await wait(1500); await expand(); await grab('.pv-panel');
    for (const g of ['Natura', 'Fantasy', 'Stanze']) { await click(`.pv-panel button.pv-chip:has-text("${g}")`, 400); await grab('.pv-panel'); }
    await ev(() => window.__pv.app.landscapes.clear()); await wait(500);
    await ev(() => window.__pv.shell.closePanel()); await wait(300);
  });

  // menus on the stage (kit.stageMenu): hand / foot (tap), character (long press), objects and
  // light sources (long press), "Luce ambientale", "Cambia ambiente"; the stage buttons; Vista pulita
  if (await ev(() => !!window.__pv.app.objectActions && !!window.__pv.app.posing?.touchMenu)) await block('stage', async () => {
    await ev(() => window.__pv.shell.closePanel()); await wait(300);
    const at = { x: 200, y: 260 };
    await ev((at) => { const { app } = window.__pv; app.posing.touchMenu(app.characters[0], 'hand.R', at.x, at.y); }, at); await wait(500); await grab('#pv-layers'); await escAll();
    await ev((at) => { const { app } = window.__pv; app.posing.pinTo(app.characters[0], 'foot.L', app.posing.ik.effectorPoint(app.characters[0], 'foot.L', new window.__pv.THREE.Vector3()).setY(0), [0, 1, 0], { commit: false }); app.posing.touchMenu(app.characters[0], 'foot.L', at.x, at.y); }, at); await wait(500); await grab('#pv-layers'); await escAll();
    await ev((at) => { const { app } = window.__pv; app.posing.touchMenu(app.characters[0], 'hand.L', at.x, at.y); }, at); await wait(300);
    await ev(() => { const { app } = window.__pv; app.posing.unpin(app.characters[0], 'foot.L', { commit: false }); }); await escAll();
    await ev(() => { const { app } = window.__pv; app.posing.pinTo(app.characters[0], 'hand.L', [0.3, 0.8, 0.3], [0, 1, 0], { commit: false }); }); await wait(200);
    await ev((at) => { const { app } = window.__pv; app.posing.touchMenu(app.characters[0], 'hand.L', at.x, at.y); }, at); await wait(400); await grab('#pv-layers'); await escAll();
    await ev(() => { const { app, shell } = window.__pv; shell.openTool('pose'); app.posing.setMode('rotate'); app.select(app.characters[0], 'hand.L'); }); await wait(600); await expand(); await grab('.pv-panel');
    await ev(() => { const { app, shell } = window.__pv; app.posing.unpin(app.characters[0], 'hand.L', { commit: false }); shell.closePanel(); }); await wait(300);
    await ev((at) => { const { app } = window.__pv; app.posing.carry.openMenu(app.characters[0], at.x, at.y); }, at); await wait(500); await grab('#pv-layers'); await escAll();
    // a furnished corner: room with a window, table, bed, wardrobe, floor lamp, a vase
    const made = await ev(async () => {
      const { app } = window.__pv, P = app.props;
      const mk = (type, pos, params = {}) => P.create({ type, params, pos, rot: [0, 0, 0] }, { emit: true });
      const ids = {
        room: mk('stanza', [0, 0, -0.9], { width: 5, depth: 4.2, height: 2.7, walls: '3', window: 'fondo', ceiling: false }).id,
        table: mk('tavolo', [1.2, 0, 0.6]).id, bed: mk('letto', [-1.4, 0, -1.6]).id, ward: mk('armadio', [1.6, 0, -2.4]).id,
        lamp: mk('lampada_terra', [-2.0, 0, 0.4]).id, vase: mk('ph_ceramic_vase_02', [0.6, 0, 0.9]).id,
      };
      await new Promise((r) => setTimeout(r, 1500));
      return ids;
    });
    const menu = async (key, opts = '{}') => {
      await ev(([id, at, o]) => { const { app } = window.__pv; const p = app.props.props.find((q) => q.id === id); app.objectActions.openMenu(p, { x: at.x, y: at.y, ...JSON.parse(o) }); }, [made[key], at, opts]);
      await wait(600); await grab('#pv-layers');
    };
    for (const k of ['table', 'ward', 'lamp', 'vase']) { await menu(k); await escAll(); }
    await menu('bed'); await click('#pv-layers .pv-menu-item:has-text("Sdraiati")', 600); await grab('#pv-layers'); await escAll();
    // the window of the room (its light controls) and a held object (Posa a terra, Cambia mano)
    const win = await ev((id) => { const { app } = window.__pv; const p = app.props.props.find((q) => q.id === id); const b = p.worldBox(new window.__pv.THREE.Box3()); return JSON.stringify({ point: { x: 0, y: 1.4, z: b.min.z + 0.05 } }); }, made.room);
    await ev(([id, at, o]) => { const { app, THREE } = window.__pv; const p = app.props.props.find((q) => q.id === id); const q = JSON.parse(o).point; app.objectActions.openMenu(p, { x: at.x, y: at.y, point: new THREE.Vector3(q.x, q.y, q.z) }); }, [made.room, at, win]);
    await wait(600); await grab('#pv-layers'); await escAll();
    await ev(async (id) => { const { app } = window.__pv; const p = app.props.props.find((q) => q.id === id); app.modules.ui.addCharacter?.('m_normal'); await app.objectActions.take(app.characters[0], p); }, made.vase); await wait(800);
    await menu('vase'); await escAll();
    // an animal (Accarezza, Inginocchiati accanto)
    if (await ev(async (at) => {
      const { app } = window.__pv; if (!app.animals?.add) return false;
      const d = await app.animals.add('cane_medio', { select: false, position: [-1.2, 0, 1.2] });
      app.objectActions.openMenu(d, { x: at.x, y: at.y }); return true;
    }, at)) { await wait(600); await grab('#pv-layers'); await escAll(); await ev(() => { const A = window.__pv.app.animals; for (const d of [...A.animals]) A.remove(d); }); }
    await ev((at) => { window.__pv.app.practicals.ambientMenu(at.x, at.y); }, at); await wait(600); await grab('#pv-layers'); await escAll();
    await ev(() => { window.__pv.shell.openTool('lights'); }); await wait(700); await expand(); await grab('.pv-panel');
    await ev(() => window.__pv.shell.closePanel()); await wait(300);
    if (await ev(() => typeof window.__pv.app.landscapes?.generate === 'function')) {
      await ev(() => { window.__pv.shell.shortcuts?.openEnvironments(); }); await wait(700); await grab('#pv-layers');
      await click('#pv-layers .pv-env-group:has-text("Natura")', 500); await grab('#pv-layers'); await escAll();
    }
    await grab('.pv-overlay');
    await ev(() => window.__pv.shell.setCleanView(true)); await wait(500); await grab('body');
    await ev(() => window.__pv.shell.setCleanView(false)); await wait(500);
    await ev(() => { const { app } = window.__pv; app.props.clear(); while (app.characters.length > 1) app.removeCharacter(app.characters[app.characters.length - 1]); });
  });

  // the guide topics as the running app shows them (each when() resolved), for checklabels.mjs
  const topics = await ev(async () => {
    try {
      const g = await import('/src/io/guide.js');
      const { app, shell } = window.__pv;
      return g.visibleTopics(g.guideEnv(app, shell)).map((t) => ({ id: t.id, lines: [...t.steps, ...(t.tips || [])] }));
    } catch { return null; } // built app: checklabels falls back to every line of guideData.js
  });
  if (topics) { require('fs').writeFileSync(process.env.OUT.replace(/(\.json)?$/, '.topics.json'), JSON.stringify(topics)); log('visible guide topics: ' + topics.length); }
  require('fs').writeFileSync(process.env.OUT, JSON.stringify([...texts]));
  log('labels collected: ' + texts.size);
};
