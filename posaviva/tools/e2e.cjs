// End-to-end smoke test: boots the full app, opens every tool, exercises the
// public APIs, collects console errors and writes screenshots.
//   NODE_PATH=$(npm root -g) URL=http://localhost:5173/ node tools/e2e.cjs <outDir> [portrait|landscape]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const out = process.argv[2] || 'e2e-out';
  const orient = process.argv[3] || 'portrait';
  fs.mkdirSync(out, { recursive: true });
  const vp = orient === 'landscape' ? { width: 915, height: 412 } : { width: 412, height: 915 };
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto(process.env.URL || 'http://localhost:5173/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__pv && window.__pv.app, null, { timeout: 120000 });
  const bootMs = Date.now() - t0;
  const shot = async (name) => {
    await page.evaluate(() => new Promise((r) => { window.__pv.app.invalidate(); requestAnimationFrame(() => requestAnimationFrame(r)); }));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, name + '.png') });
  };
  await page.evaluate(() => { try { localStorage.setItem('posaviva.onboarded', '1'); } catch {} });
  await shot('00-boot');
  const tools = await page.evaluate(() => window.__pv.shell.tools.map((t) => t.id));
  for (const id of tools) {
    await page.evaluate((id) => window.__pv.shell.openTool(id), id);
    await page.waitForTimeout(200);
    await shot('tool-' + id);
  }
  await page.evaluate(() => window.__pv.shell.closePanel());
  // extra scenario steps supplied by the integrator
  const extra = process.env.E2E_SCRIPT ? fs.readFileSync(process.env.E2E_SCRIPT, 'utf8') : '';
  if (extra) {
    const steps = eval(extra); // array of {name, js}
    for (const s of steps) {
      try { const r = await page.evaluate(s.js); if (r !== undefined) console.log(s.name, '->', JSON.stringify(r).slice(0, 400)); }
      catch (e) { errors.push(`step ${s.name}: ${e.message}`); }
      await page.waitForTimeout(s.wait || 300);
      if (s.shot !== false) await shot('step-' + s.name);
    }
  }
  const perf = await page.evaluate(() => ({ chars: window.__pv.app.characters.length, info: window.__pv.app.renderer.info.render, mem: window.__pv.app.renderer.info.memory }));
  console.log(JSON.stringify({ bootMs, tools, perf, errors: errors.slice(0, 40), errorCount: errors.length }, null, 1));
  await browser.close();
})();
