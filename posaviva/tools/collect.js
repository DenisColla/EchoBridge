// collects every visible label of the app (all tools, pose modes, editors, menus, sheets)
module.exports = async (page, shot, log) => {
  const texts = new Set();
  const grab = async (root = 'body') => {
    const r = await page.evaluate((root) => {
      const out = [];
      const el = document.querySelector(root) || document.body;
      out.push(el.innerText);
      el.querySelectorAll('[title],[aria-label],input[placeholder]').forEach((e) => out.push(e.getAttribute('title') || '', e.getAttribute('aria-label') || '', e.getAttribute('placeholder') || ''));
      return out.join('\n');
    }, root);
    r.split('\n').forEach((x) => x.trim() && texts.add(x.trim()));
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => window.__pv.shell.setSheetSnap('full', { persist: false }));
  const ids = await ev(() => window.__pv.shell.tools.map((t) => t.id));
  log('tools: ' + ids.join(','));
  for (const id of ids) {
    await ev((id) => window.__pv.shell.openTool(id), id);
    await page.waitForTimeout(400);
    if (id === 'pose') {
      for (const m of ['rotate', 'ik', 'line', 'move']) { await ev((m) => window.__pv.app.posing.setMode(m), m); await page.waitForTimeout(250); await grab('.pv-panel'); }
      await ev(() => { window.__pv.app.posing.setMode('rotate'); const { app } = window.__pv; app.select(app.characters[0], 'forearm.L'); });
      await page.waitForTimeout(400);
      await ev(() => document.querySelectorAll('.pv-section.collapsed').forEach((s) => s.classList.remove('collapsed')));
    }
    if (id === 'face' || id === 'body' || id === 'style' || id === 'lights') await ev(() => document.querySelectorAll('.pv-panel .pv-section.collapsed').forEach((s) => s.classList.remove('collapsed')));
    if (id === 'style') {
      for (const st of ['toon', 'lines', 'realistic']) { await ev((st) => window.__pv.app.modules.render.setStyle(st), st); await ev(() => window.__pv.app.modules.render.set({ outline: { toon: true, lines: true, realistic: false } })); await page.waitForTimeout(500); await grab('.pv-panel'); }
    }
    await grab('.pv-panel');
  }
  // prop editors: a chair and a hand prop
  await ev(() => { const { app } = window.__pv; app.select(app.characters[0]); });
  await ev(() => window.__pv.shell.openTool('props'));
  await page.waitForTimeout(400);
  const types = await ev(() => { const t = window.__pv.app.props; return null; });
  await page.click('.pv-panel button:has-text("Sedia")').catch(() => {});
  await page.waitForTimeout(1500); await ev(() => document.querySelectorAll('.pv-panel .pv-section.collapsed').forEach((s) => s.classList.remove('collapsed'))); await grab('.pv-panel');
  await ev(() => window.__pv.app.props.select(null)); await page.waitForTimeout(300);
  await page.click('.pv-panel button.pv-chip:has-text("In mano")').catch(() => {}); await page.waitForTimeout(500); await grab('.pv-panel');
  await page.click('.pv-panel button:has-text("Tazza")').catch(() => {}); await page.waitForTimeout(1500); await grab('.pv-panel');
  await ev(() => window.__pv.app.props.select(null)); await page.waitForTimeout(300);
  await page.click('.pv-panel button.pv-chip:has-text("Stanze pronte")').catch(() => {}); await page.waitForTimeout(500); await grab('.pv-panel');
  // building editor
  if (ids.includes('buildings')) {
    await ev(() => window.__pv.shell.openTool('buildings')); await page.waitForTimeout(400);
    await page.click('.pv-panel button:has-text("Villetta moderna")').catch(() => {}); await page.waitForTimeout(2500); await grab('.pv-panel');
  }
  // animals and exteriors editors
  if (ids.includes('animals')) {
    await ev(() => window.__pv.shell.openTool('animals')); await page.waitForTimeout(1500); await grab('.pv-panel');
    await page.click('.pv-panel .pv-card').catch(() => {}); await page.waitForTimeout(6000); await grab('.pv-panel');
  }
  if (ids.includes('exteriors')) {
    await ev(() => window.__pv.shell.openTool('exteriors')); await page.waitForTimeout(800); await grab('.pv-panel');
    await page.click('.pv-panel button.pv-chip:has-text("Strade")').catch(() => {}); await page.waitForTimeout(500);
    await page.click('.pv-panel .pv-card').catch(() => {}); await page.waitForTimeout(2500); await grab('.pv-panel');
    await page.click('.pv-panel button:has-text("Aggiungi")').catch(() => {}); await page.waitForTimeout(500);
    await page.click('.pv-panel button.pv-chip:has-text("Veicoli")').catch(() => {}); await page.waitForTimeout(500); await grab('.pv-panel');
    await page.click('.pv-panel .pv-card').catch(() => {}); await page.waitForTimeout(3000); await grab('.pv-panel');
  }
  // clothes: select a worn item
  await ev(() => window.__pv.shell.openTool('clothes')); await page.waitForTimeout(400); await grab('.pv-panel');
  // people: add view
  await ev(() => window.__pv.shell.openTool('people')); await page.waitForTimeout(300);
  await page.click('.pv-panel button:has-text("Aggiungi")').catch(() => {}); await page.waitForTimeout(500); await grab('.pv-panel');
  await ev(() => window.__pv.shell.closePanel()); await page.waitForTimeout(300);
  // menus and sheets
  await grab('.pv-topbar');
  await page.click('.pv-io-menu-btn'); await page.waitForTimeout(500); await grab('#pv-layers'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await ev(() => window.__pv.app.modules.ui.openSettings()); await page.waitForTimeout(600); await grab('#pv-layers'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await ev(() => window.__pv.app.modules.ui.openExport({})); await page.waitForTimeout(900); await grab('#pv-layers'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await ev(() => window.__pv.app.modules.ui.openExport({ share: true })); await page.waitForTimeout(900); await grab('#pv-layers'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await ev(() => window.__pv.app.modules.ui.openScenes()); await page.waitForTimeout(600); await grab('#pv-layers'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await page.click('.pv-focus-fab'); await page.waitForTimeout(500); await grab('.pv-overlay'); await page.click('.pv-focus-fab'); await page.waitForTimeout(300);
  await ev(() => { const { app } = window.__pv; app.select(app.characters[0], 'forearm.L'); }); await page.waitForTimeout(300);
  await page.click('.pv-focus-lens').catch(() => {}); await page.waitForTimeout(1500); await grab('.pv-overlay');
  require('fs').writeFileSync(process.env.OUT, JSON.stringify([...texts]));
  log('labels collected: ' + texts.size);
};
