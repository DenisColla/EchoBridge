// Image capture and file output. Uses app.capture() (render module: same
// style, outlines and AO as the screen, any resolution) when available, else
// renders one frame and reads the canvas back in the same task
// (preserveDrawingBuffer is false). Files go through the Android bridge when
// running in the APK, otherwise through a download link / Web Share.

/** 'posaviva-20261120-143205' */
export function stamp(prefix = 'posaviva') {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export class Exporter {
  /** @param {import('../app.js').App} app  @param {import('./viewOffset.js').ViewOffset} viewOffset */
  constructor(app, viewOffset) {
    this.app = app;
    this.viewOffset = viewOffset;
  }

  get hasBridge() { return !!window.AndroidBridge; }

  /** Pixel size an export would have at a given scale (CSS canvas size * scale, capped like the render module). */
  exportSize(scale) {
    const c = this.app.canvas;
    let W = Math.round((c.clientWidth || c.width) * scale), H = Math.round((c.clientHeight || c.height) * scale);
    const k = Math.min(1, 8192 / W, 8192 / H, Math.sqrt(36e6 / (W * H)));
    return { w: Math.floor(W * k), h: Math.floor(H * k) };
  }

  /**
   * Renders the camera view (never the UI-shifted projection) into a canvas.
   * opts: {scale, width, height, transparent}
   */
  async capture(opts = {}) {
    const app = this.app;
    if (typeof app.capture === 'function') return app.capture(opts);
    // fallback: plain renderer, one frame at the requested pixel ratio
    const r = app.renderer, scene = app.scene;
    const pr0 = r.getPixelRatio();
    const cw = app.canvas.clientWidth || 1, ch = app.canvas.clientHeight || 1;
    let pr = opts.scale || 1;
    if (opts.width) pr = opts.width / cw; else if (opts.height) pr = opts.height / ch;
    const bg0 = scene.background, alpha0 = r.getClearAlpha();
    const out = document.createElement('canvas');
    this.viewOffset?.without(() => {
      try {
        if (opts.transparent) { scene.background = null; r.setClearAlpha(0); }
        if (Math.abs(pr - pr0) > 1e-3) r.setPixelRatio(pr);
        app.renderNow();
        out.width = app.canvas.width; out.height = app.canvas.height;
        out.getContext('2d').drawImage(app.canvas, 0, 0);
      } finally {
        scene.background = bg0; r.setClearAlpha(alpha0);
        if (Math.abs(r.getPixelRatio() - pr0) > 1e-3) r.setPixelRatio(pr0);
        app.invalidate();
      }
    });
    return out;
  }

  /** Small JPEG (3:4, cover crop) for the scene list. */
  async thumbnail(w = 180, h = 240) {
    const c = this.app.canvas;
    const aspect = (c.clientWidth || 1) / (c.clientHeight || 1);
    const src = await this.capture(aspect < w / h ? { width: Math.round(w * 1.4) } : { height: Math.round(h * 1.4) });
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const g = out.getContext('2d');
    g.fillStyle = '#2a2c33';
    g.fillRect(0, 0, w, h);
    const s = Math.min(src.width / w, src.height / h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, (src.width - w * s) / 2, (src.height - h * s) / 2, w * s, h * s, 0, 0, w, h);
    return out.toDataURL('image/jpeg', 0.72);
  }

  /** Crops a canvas to a normalized rect {x, y, w, h}. */
  crop(canvas, r) {
    if (!r) return canvas;
    const x = Math.round(r.x * canvas.width), y = Math.round(r.y * canvas.height);
    const w = Math.max(1, Math.round(r.w * canvas.width)), h = Math.max(1, Math.round(r.h * canvas.height));
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return out;
  }

  // ---------------------------------------------------------------- output
  /** Saves a PNG canvas to the gallery (APK) or downloads it. -> {ok, where?, error?} */
  async saveImage(canvas, name) {
    const file = name.endsWith('.png') ? name : name + '.png';
    if (window.AndroidBridge?.saveImage) {
      const b64 = canvas.toDataURL('image/png').split(',')[1];
      const res = String(window.AndroidBridge.saveImage(b64, file) || '');
      return res.startsWith('ok') ? { ok: true, where: 'Galleria › PosaViva' } : { ok: false, error: res.replace(/^error:/, '') || 'errore sconosciuto' };
    }
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return { ok: false, error: 'immagine troppo grande' };
    this._download(blob, file);
    return { ok: true, where: 'Download' };
  }

  /** Opens the system share sheet with the image (APK / Web Share), else downloads it. */
  async shareImage(canvas, name) {
    const file = name.endsWith('.png') ? name : name + '.png';
    if (window.AndroidBridge?.shareImage) {
      window.AndroidBridge.shareImage(canvas.toDataURL('image/png').split(',')[1], file);
      return { ok: true, shared: true };
    }
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return { ok: false, error: 'immagine troppo grande' };
    const f = typeof File === 'function' ? new File([blob], file, { type: 'image/png' }) : null;
    if (f && navigator.canShare?.({ files: [f] })) {
      try { await navigator.share({ files: [f], title: 'PosaViva' }); return { ok: true, shared: true }; }
      catch (e) { if (e?.name === 'AbortError') return { ok: false, cancelled: true }; }
    }
    this._download(blob, file);
    return { ok: true, where: 'Download' };
  }

  /** Saves a text file (APK: Download/PosaViva) or downloads it. */
  saveText(text, name, mime = 'application/json') {
    if (window.AndroidBridge?.saveTextFile) {
      const res = String(window.AndroidBridge.saveTextFile(text, name, mime) || '');
      return res.startsWith('ok') ? { ok: true, where: 'Download › PosaViva' } : { ok: false, error: res.replace(/^error:/, '') || 'errore sconosciuto' };
    }
    this._download(new Blob([text], { type: mime }), name);
    return { ok: true, where: 'Download' };
  }

  _download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  }

  /** Lets the user pick a text file. -> Promise<{text, name}|null> */
  pickTextFile(accept = '.json,application/json') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      let done = false;
      const finish = (v) => { if (done) return; done = true; input.remove(); resolve(v); };
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return finish(null);
        if (f.size > 20 * 1024 * 1024) return finish({ error: 'File troppo grande' });
        try { finish({ text: await f.text(), name: f.name }); } catch (e) { finish({ error: e.message }); }
      });
      input.addEventListener('cancel', () => finish(null));
      document.body.appendChild(input);
      input.click();
    });
  }
}
