// usage: node shot.cjs <out.png> [jsToEvalAfterLoad] [width] [height]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2], js = process.argv[3] || '', w = +(process.argv[4] || 412), hh = +(process.argv[5] || 860);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: w, height: hh }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(process.env.URL || 'http://localhost:5173/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__pv, null, { timeout: 60000 });
  if (js) { const r = await page.evaluate(js); if (r !== undefined) console.log('eval:', JSON.stringify(r).slice(0, 2000)); }
  await page.evaluate(() => new Promise((r) => { window.__pv.app.invalidate(); requestAnimationFrame(() => requestAnimationFrame(r)); }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: out });
  console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 30).join('\n'));
  await browser.close();
})();
