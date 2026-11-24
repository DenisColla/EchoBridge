// Reproducible performance benchmark (headless Chromium + SwiftShader).
//
//   NODE_PATH=$(npm root -g) URL=http://localhost:5173/ node tools/bench.cjs <out.json> [scene] [profile] [extra URL query]
//     scene:   interior (3 dressed characters + furnished living room, default) | city (street landscape + 2 characters)
//     profile: s25u | nord2 | tabs6 | tabs9 | tabs9p | small (412x780 @1, default: small)
//              (viewport + devicePixelRatio of the device; the GPU string can be simulated
//               with the query `?gpu=Adreno%20(TM)%20640&mem=6` read by render/device.js)
//
// Measures (all deterministic scene content, fixed seeds):
//   boot: ms to window.__pv, to splash removed, to garments built
//   frame: draw calls / triangles summed over every pass of a frame (G-buffer, AO, ink, shadows),
//          shader programs, geometries, textures
//   gpuMem: bytes of textures + renderbuffers + buffers actually allocated through WebGL
//           (tracked by wrapping the WebGL2 entry points; MSAA renderbuffers count x samples)
//   js: JS ms of a frame (render hooks + renderer CPU work), idle (camera orbit only) and while
//       posing (bone rotations on every character each frame: correctives, garments, hair)
//   wall: same frames incl. waiting for the (software) GPU — relative only, SwiftShader is a CPU
//   heap: JS heap (performance.memory, precise)
// Env: BENCH_N (frames per series, default 16), BENCH_FAST_SETUP=1 (assemble the scene at a tiny
//      resolution: big-screen profiles under SwiftShader would take many minutes otherwise)
const { chromium } = require('playwright');
const fs = require('fs');

const PROFILES = {
  small: { w: 412, h: 780, dpr: 1 },
  s25u: { w: 412, h: 891, dpr: 3.5, mobile: true },   // 1440x3120 QHD+
  nord2: { w: 412, h: 915, dpr: 2.625, mobile: true }, // 1080x2400
  tabs6: { w: 1280, h: 800, dpr: 2, mobile: true },   // 2560x1600
  tabs9: { w: 1280, h: 800, dpr: 2, mobile: true },   // 2560x1600
  tabs9p: { w: 1400, h: 876, dpr: 2, mobile: true },  // 2800x1752
};

// --- page instrumentation (runs before any page script) ---------------------------
function instrument() {
  const P = WebGL2RenderingContext.prototype;
  const G = WebGL2RenderingContext;
  const st = window.__glstats = { tex: new Map(), rb: new Map(), buf: new Map(), boundTex: new Map(), unit: 0, boundRb: null, boundBuf: new Map() };
  const bppOf = (ifmt, type) => {
    switch (ifmt) {
      case G.R8: return 1; case G.RG8: return 2; case G.RGB8: case G.SRGB8: return 4; case G.RGBA8: case G.SRGB8_ALPHA8: return 4;
      case G.R16F: return 2; case G.RG16F: return 4; case G.RGB16F: return 8; case G.RGBA16F: return 8;
      case G.R32F: return 4; case G.RG32F: return 8; case G.RGB32F: return 16; case G.RGBA32F: return 16;
      case G.DEPTH_COMPONENT16: return 2; case G.DEPTH_COMPONENT24: case G.DEPTH24_STENCIL8: case G.DEPTH_COMPONENT32F: return 4;
      case G.DEPTH32F_STENCIL8: return 8; case G.R11F_G11F_B10F: case G.RGB10_A2: return 4;
      case G.RGBA: case G.RGB: return type === G.FLOAT ? 16 : type === G.HALF_FLOAT ? 8 : 4;
      case G.LUMINANCE_ALPHA: return 2; case G.LUMINANCE: case G.ALPHA: case G.RED: return 1;
      default: return 4;
    }
  };
  const key = (t) => `${st.unit}:${t}`;
  const wrap = (name, fn) => { const o = P[name]; P[name] = function (...a) { try { fn.call(this, a); } catch { /* stats only */ } return o.apply(this, a); }; };
  wrap('activeTexture', (a) => { st.unit = a[0]; });
  wrap('bindTexture', (a) => { st.boundTex.set(key(a[0]), a[1]); });
  const texRec = (t) => { let r = st.tex.get(t); if (!r) { r = { levels: new Map(), w: 0, h: 0 }; st.tex.set(t, r); } return r; };
  const target2D = (t) => (t >= G.TEXTURE_CUBE_MAP_POSITIVE_X && t <= G.TEXTURE_CUBE_MAP_NEGATIVE_Z ? G.TEXTURE_CUBE_MAP : t);
  wrap('texStorage2D', (a) => {
    const [target, levels, ifmt, w, h] = a; const tex = st.boundTex.get(key(target)); if (!tex) return;
    const r = texRec(tex); const faces = target === G.TEXTURE_CUBE_MAP ? 6 : 1; let b = 0, ww = w, hh = h;
    for (let l = 0; l < levels; l++) { b += ww * hh * bppOf(ifmt) * faces; ww = Math.max(1, ww >> 1); hh = Math.max(1, hh >> 1); }
    r.levels.clear(); r.levels.set('s', b); r.w = w; r.h = h;
  });
  wrap('texStorage3D', (a) => {
    const [target, levels, ifmt, w, h, d] = a; const tex = st.boundTex.get(key(target)); if (!tex) return;
    const r = texRec(tex); let b = 0, ww = w, hh = h;
    for (let l = 0; l < levels; l++) { b += ww * hh * d * bppOf(ifmt); ww = Math.max(1, ww >> 1); hh = Math.max(1, hh >> 1); }
    r.levels.clear(); r.levels.set('s', b); r.w = w; r.h = h;
  });
  wrap('texImage2D', (a) => {
    const target = a[0], level = a[1], ifmt = a[2]; let w, h, type;
    if (a.length >= 8) { w = a[3]; h = a[4]; type = a[7]; } else { const src = a[5]; type = a[4]; w = src?.width || src?.videoWidth || 0; h = src?.height || src?.videoHeight || 0; }
    const tex = st.boundTex.get(key(target2D(target))); if (!tex) return;
    const r = texRec(tex); r.levels.set(`${target}:${level}`, w * h * bppOf(ifmt, type)); if (level === 0) { r.w = w; r.h = h; }
  });
  wrap('compressedTexImage2D', (a) => {
    const target = a[0], level = a[1], w = a[3], h = a[4]; const data = a[6];
    const tex = st.boundTex.get(key(target2D(target))); if (!tex) return;
    const r = texRec(tex); r.levels.set(`${target}:${level}`, data?.byteLength || 0); if (level === 0) { r.w = w; r.h = h; }
  });
  wrap('generateMipmap', (a) => {
    const tex = st.boundTex.get(key(a[0])); const r = tex && st.tex.get(tex); if (!r) return;
    let base = 0; for (const [k, v] of r.levels) if (k === 's' || k.endsWith(':0')) base += v;
    if (!r.levels.has('s')) r.levels.set('mips', Math.round(base / 3));
  });
  wrap('deleteTexture', (a) => { st.tex.delete(a[0]); });
  wrap('bindRenderbuffer', (a) => { st.boundRb = a[1]; });
  wrap('renderbufferStorage', (a) => { if (st.boundRb) st.rb.set(st.boundRb, a[2] * a[3] * bppOf(a[1])); });
  wrap('renderbufferStorageMultisample', (a) => { if (st.boundRb) st.rb.set(st.boundRb, a[3] * a[4] * bppOf(a[2]) * Math.max(1, a[1])); });
  wrap('deleteRenderbuffer', (a) => { st.rb.delete(a[0]); });
  wrap('bindBuffer', (a) => { st.boundBuf.set(a[0], a[1]); });
  wrap('bufferData', (a) => { const b = st.boundBuf.get(a[0]); if (!b) return; const s = a[1]; st.buf.set(b, typeof s === 'number' ? s : s?.byteLength || 0); });
  wrap('deleteBuffer', (a) => { st.buf.delete(a[0]); });
  window.__glmem = () => {
    let tex = 0, texN = 0, big = [];
    for (const r of st.tex.values()) { let b = 0; for (const v of r.levels.values()) b += v; tex += b; texN++; big.push([r.w, r.h, b]); }
    let rb = 0; for (const v of st.rb.values()) rb += v;
    let buf = 0; for (const v of st.buf.values()) buf += v;
    big.sort((x, y) => y[2] - x[2]);
    const hist = {}; for (const [w, h] of big) { const k = `${w}x${h}`; hist[k] = (hist[k] || 0) + 1; }
    return { texMB: +(tex / 1048576).toFixed(1), textures: texN, renderbufMB: +(rb / 1048576).toFixed(1), buffersMB: +(buf / 1048576).toFixed(1),
      totalMB: +((tex + rb + buf) / 1048576).toFixed(1), top: big.slice(0, 8).map(([w, h, b]) => `${w}x${h} ${(b / 1048576).toFixed(1)}MB`),
      sizes: Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 10) };
  };
  try { localStorage.setItem('posaviva.onboarded', '1'); } catch { /* ignore */ }
}

// --- scenes -----------------------------------------------------------------------
const SETUP = {
  async interior() {
    const { app } = window.__pv;
    const ch0 = app.characters[0];
    const c1 = app.addCharacter({ preset: 'm_normal' });
    const c2 = app.addCharacter({ preset: 'f_curvy' });
    const outfits = [['shirt', 'jeans', 'sneakers'], ['blazer', 'trousers', 'dressshoes'], ['dress', 'boots']];
    const hair = ['lunghi_mossi', 'corti_classici', 'coda'];
    [ch0, c1, c2].forEach((ch, i) => {
      ch.setPlacement?.({ position: [(i - 1) * 0.9, 0, 0.2], rotationY: 0 });
      app.clothing?.setItems(ch, outfits[i]);
      app.hair?.setStyle(ch, { style: hair[i] }, false);
    });
    const { ROOM_PRESETS } = await import('/src/props/gen/rooms.js');
    await app.props.addPreset(ROOM_PRESETS.find((r) => r.id === 'soggiorno'), { select: false });
    app.select(null);
  },
  async city() {
    const { app } = window.__pv;
    const c1 = app.addCharacter({ preset: 'm_normal' });
    app.clothing?.setItems(c1, ['tshirt', 'jeans', 'sneakers']);
    await app.landscapes.generate({ preset: 'strada', seed: 4242, time: 'mattino', weather: 'sereno' });
    app.select(null);
  },
};

(async () => {
  const out = process.argv[2] || 'bench.json';
  const sceneId = process.argv[3] || 'interior';
  const prof = PROFILES[process.argv[4] || 'small'];
  const query = process.argv[5] || '';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const ctx = await browser.newContext({ viewport: { width: prof.w, height: prof.h }, deviceScaleFactor: prof.dpr, hasTouch: true, isMobile: !!prof.mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.addInitScript(instrument);
  const base = process.env.URL || 'http://localhost:5173/';
  const t0 = Date.now();
  await page.goto(base + (query ? (query.startsWith('?') ? query : '?' + query) : ''), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__pv && window.__pv.app, null, { timeout: 120000 });
  const tPv = Date.now() - t0;
  await page.waitForFunction(() => !document.getElementById('pv-loading'), null, { timeout: 30000 }).catch(() => {});
  const tSplash = Date.now() - t0;
  await page.evaluate(() => window.__pv.app.clothing?.whenIdle?.());
  const tBuilt = Date.now() - t0;
  const bootMem = await page.evaluate(() => window.__glmem());

  const ts = Date.now();
  // BENCH_FAST_SETUP=1: assemble the scene at a tiny resolution (SwiftShader draws every
  // garment-build frame), the measured frames use the real pixel ratio again
  const fast = process.env.BENCH_FAST_SETUP === '1';
  if (fast) await page.evaluate(() => { const r = window.__pv.app.renderer; window.__benchPR = r.getPixelRatio(); r.setPixelRatio(0.15); });
  await page.evaluate(`(${SETUP[sceneId].toString().replace(/^async \w+\(\)/, 'async () =>')})()`);
  await page.evaluate(async () => {
    const { app } = window.__pv;
    await app.clothing?.whenIdle?.();
    // model props load asynchronously
    for (let i = 0; i < 100; i++) { if (!app.props || app.props.props.every((p) => !p._loading && !p.loading)) break; await new Promise((r) => setTimeout(r, 100)); }
    await new Promise((r) => setTimeout(r, 1500));
    await app.clothing?.whenIdle?.();
    app.modules.scene?.frameAll?.();
    app.sceneTools?.camera?.frameSubject?.({ animate: false });
  });
  const setupMs = Date.now() - ts;
  await page.waitForTimeout(1500);
  // settle the animating render hooks (hair physics, garment builds) without drawing: at
  // SwiftShader frame rates they would otherwise still be running during the idle frames
  const settleIters = await page.evaluate(() => { const { app } = window.__pv; let i = 0; while (i < 900 && app._runHooks(1 / 60)) i++; return i; });
  if (fast) await page.evaluate(() => { window.__pv.app.renderer.setPixelRatio(window.__benchPR); });

  const N = +(process.env.BENCH_N || 16);
  const result = await page.evaluate(async (N) => {
    const { app } = window.__pv;
    const r = app.renderer, gl = r.getContext();
    r.info.autoReset = false;
    // stop the real loop: frames are driven one by one below
    r.setAnimationLoop(null); app._looping = true; clearTimeout(app._heartbeatT);
    const finish = () => { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    const frame = () => {
      r.info.reset();
      app._needsRender = true;
      const a = performance.now();
      app._frame();
      const b = performance.now();
      finish();
      const c = performance.now();
      return { js: b - a, wall: c - a, calls: r.info.render.calls, tris: r.info.render.triangles };
    };
    const stats = (arr) => { const s = [...arr].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { med: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2) }; };
    for (let i = 0; i < 3; i++) frame(); // warm-up (program compile)
    // idle: orbit the camera a little each frame
    const idle = [];
    const target = app.controls.target.clone();
    for (let i = 0; i < N; i++) {
      const off = app.camera.position.clone().sub(target).applyAxisAngle(new window.__pv.THREE.Vector3(0, 1, 0), 0.01);
      app.camera.position.copy(target).add(off);
      idle.push(frame());
    }
    // posing: rotate an arm and the spine of every character each frame
    const THREE = window.__pv.THREE;
    const q = new THREE.Quaternion();
    const pose = [];
    for (let i = 0; i < N; i++) {
      for (const ch of app.characters) {
        q.setFromEuler(new THREE.Euler(0.4 * Math.sin(i * 0.4), 0, 0.3 * Math.cos(i * 0.3)));
        ch.setBoneRotation('upperarm01.L', q, false);
        q.setFromEuler(new THREE.Euler(0.15 * Math.sin(i * 0.5), 0.1 * Math.sin(i * 0.2), 0));
        ch.setBoneRotation('spine03', q, false);
        ch.applyPose();
      }
      pose.push(frame());
    }
    app._looping = false; app._startLoop();
    const progs = r.info.programs || [];
    const pr = r.getPixelRatio();
    const mem = performance.memory ? { usedMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), totalMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1) } : null;
    let meshes = 0, visibleMeshes = 0;
    app.scene.traverse((o) => { if (o.isMesh) { meshes++; } });
    app.scene.traverseVisible((o) => { if (o.isMesh) visibleMeshes++; });
    const S = (k, arr) => stats(arr.map((f) => f[k]));
    return {
      canvas: `${app.renderer.domElement.width}x${app.renderer.domElement.height}`, mpix: +((app.renderer.domElement.width * app.renderer.domElement.height) / 1e6).toFixed(2), pixelRatio: pr,
      dpr: window.devicePixelRatio, gpu: (() => { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })(),
      quality: app.modules.render?.quality?.id, tier: app.modules.render?.device?.tier || null,
      pipeline: { ...app.modules.render?.pipeline?.stats }, renderOverride: !!app.renderOverride,
      calls: idle[0].calls, tris: idle[0].tris, callsPosing: pose[0].calls,
      programs: progs.length, geometries: r.info.memory.geometries, textures: r.info.memory.textures,
      meshes, visibleMeshes,
      jsIdle: S('js', idle), jsPosing: S('js', pose), wallIdle: S('wall', idle), wallPosing: S('wall', pose),
      heap: mem, gpuMem: window.__glmem(),
    };
  }, N);
  const shot = out.replace(/\.json$/, '.png');
  await page.screenshot({ path: shot });
  const report = { scene: sceneId, profile: process.argv[4] || 'small', query, boot: { pvMs: tPv, splashMs: tSplash, builtMs: tBuilt, gpuMemAtBoot: bootMem.totalMB }, setupMs, settleIters, ...result, errors: errors.slice(0, 20), errorCount: errors.length };
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
