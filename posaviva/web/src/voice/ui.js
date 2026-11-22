// Voice / text command UI:
//   - floating mic button (bottom-left of the free view, mirrors the "Zoom rapido" button)
//   - "Comandi" panel: big mic with level ring + live transcript, text field (same engine),
//     result summary ("Fatto" lines, "Non ho capito: ..."), quick "Annulla", mode badge,
//     example chips ("Prova: ..."), recent commands
//   - "Comandi vocali" settings sheet (lingua, modalità solo offline / ibrida, chiave API Claude)
import { h, icon, toast, haptic, modal, segmented, button, confirmDialog } from '../ui/kit.js';
import { Speech } from './speech.js';
import { loadSettings, saveSettings, loadHistory, pushHistory, clearHistory } from './settings.js';

const SVG = {
  mic: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5.5a3 3 0 0 0-5.9-.7M5.5 11a6.5 6.5 0 0 0 10.6 5M18.5 11a6.4 6.4 0 0 1-.6 2.7M12 17.5V21M8.5 21h7"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5 20 4"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/></svg>',
  device: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
};
const svg = (k, cls = '') => h('span', { class: 'pv-vc-svg ' + cls, html: SVG[k] });

export const EXAMPLES = [
  'metti un uomo con una maglietta bianca seduto sul divano con un cane accanto',
  'aggiungi una donna curvy in jeans e felpa nera che corre',
  'voglio una cucina, metti il tavolo al centro e due sedie a sinistra',
  'crea una strada di città di notte con pioggia',
  'metti un gatto sul letto',
  'gira la donna verso la finestra',
  'inquadra dal basso',
  'luce da tramonto',
  'un uomo e una donna che si guardano',
  'primo piano della donna',
];

export class VoiceUI {
  /** ctx: {app, shell, getEngine: () => Promise<engine>} */
  constructor(ctx) {
    this.app = ctx.app; this.shell = ctx.shell; this.getEngine = ctx.getEngine;
    this.settings = loadSettings();
    this.history = loadHistory();
    this.speech = new Speech();
    this.busy = false;
    this.lastUndo = null;
    this._popBack = null;
    this._abort = null;
    this._build();
    this._wireSpeech();
    this.app.addEventListener('tool', () => { if (this.isOpen && this.shell.activeToolId) this.close(); });
    this.app.addEventListener('history', () => this._syncUndo());
  }

  get isOpen() { return this.panel.classList.contains('open'); }

  // ------------------------------------------------------------------ DOM
  _build() {
    const fab = h('button', { type: 'button', class: 'pv-vc-fab', title: 'Comandi vocali', 'aria-label': 'Comandi vocali' }, svg('mic'));
    fab.addEventListener('click', () => { haptic('tick'); this.open({ listen: this.speech.available }); });
    this.fab = fab;
    this.shell.overlay.append(h('div', { class: 'pv-vc-fabwrap' }, fab));

    // ---- panel
    this.modeBadge = h('button', { type: 'button', class: 'pv-vc-mode', title: 'Modalità dei comandi' });
    this.modeBadge.addEventListener('click', () => this.openSettings());
    const settingsBtn = h('button', { type: 'button', class: 'pv-icon-btn pv-vc-hbtn', title: 'Impostazioni comandi vocali', 'aria-label': 'Impostazioni comandi vocali' }, icon('settings', 20));
    settingsBtn.addEventListener('click', () => this.openSettings());
    const closeBtn = h('button', { type: 'button', class: 'pv-icon-btn pv-vc-hbtn', title: 'Chiudi', 'aria-label': 'Chiudi' }, icon('close', 20));
    closeBtn.addEventListener('click', () => this.close());
    const head = h('div', { class: 'pv-vc-head' }, h('div', { class: 'pv-vc-title' }, 'Comandi'), this.modeBadge, h('div', { class: 'pv-vc-sp' }), settingsBtn, closeBtn);

    // live area: mic with level ring + transcript
    this.ring = h('span', { class: 'pv-vc-ring' });
    this.micBtn = h('button', { type: 'button', class: 'pv-vc-mic', title: 'Parla', 'aria-label': 'Parla' }, this.ring, svg('mic', 'on'), svg('stop', 'stop'));
    this.micBtn.addEventListener('click', () => this.toggleListen());
    if (!this.speech.available) { this.micBtn.classList.add('off'); this.micBtn.title = 'Microfono non disponibile: scrivi il comando'; }
    this.status = h('div', { class: 'pv-vc-status' }, this.speech.available ? 'Tocca il microfono e parla' : 'Scrivi un comando qui sotto');
    this.transcript = h('div', { class: 'pv-vc-transcript', 'aria-live': 'polite' });
    const live = h('div', { class: 'pv-vc-live' }, this.micBtn, h('div', { class: 'pv-vc-livetext' }, this.status, this.transcript));

    // text field
    this.input = h('input', { type: 'text', class: 'pv-vc-input', placeholder: 'Scrivi un comando… (es. metti un gatto sul letto)', enterkeyhint: 'send', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Comando' });
    this.sendBtn = h('button', { type: 'button', class: 'pv-vc-send', title: 'Esegui', 'aria-label': 'Esegui' }, svg('send'));
    this.sendBtn.addEventListener('click', () => this.submit());
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submit(); } });
    this.input.addEventListener('input', () => this.sendBtn.classList.toggle('ready', !!this.input.value.trim()));
    this.input.addEventListener('focus', () => this.panel.classList.remove('has-result'));
    const form = h('div', { class: 'pv-vc-form' }, this.input, this.sendBtn);

    // result
    this.result = h('div', { class: 'pv-vc-result' });
    // examples + history
    this.chips = h('div', { class: 'pv-vc-chips' });
    this.hist = h('div', { class: 'pv-vc-hist' });
    const body = h('div', { class: 'pv-vc-body' }, live, form, this.result, this.chips, this.hist);
    this.panel = h('div', { class: 'pv-vc-panel', role: 'dialog', 'aria-label': 'Comandi vocali' }, head, body);
    document.body.appendChild(this.panel);
    this._renderMode();
    this._renderChips();
  }

  _renderMode() {
    const hybrid = this.settings.mode === 'hybrid' && !!this.settings.apiKey;
    this.modeBadge.replaceChildren(svg(hybrid ? 'cloud' : 'device'), h('span', {}, hybrid ? 'Ibrida' : 'Offline'));
    this.modeBadge.classList.toggle('cloud', hybrid);
  }

  _renderChips() {
    this.chips.replaceChildren(h('div', { class: 'pv-vc-label' }, 'Prova'));
    const row = h('div', { class: 'pv-vc-chiprow' });
    for (const ex of EXAMPLES) {
      const c = h('button', { type: 'button', class: 'pv-chip pv-vc-chip' }, ex);
      c.addEventListener('click', () => { haptic('tick'); this.input.value = ex; this.sendBtn.classList.add('ready'); this.submit(); });
      row.appendChild(c);
    }
    this.chips.appendChild(row);
    this.hist.replaceChildren();
    if (this.history.length) {
      const clear = h('button', { type: 'button', class: 'pv-vc-link' }, 'Cancella');
      clear.addEventListener('click', () => { clearHistory(); this.history = []; this._renderChips(); });
      this.hist.append(h('div', { class: 'pv-vc-label' }, 'Recenti', h('span', { class: 'pv-vc-sp' }), clear));
      for (const t of this.history.slice(0, 4)) {
        const b = h('button', { type: 'button', class: 'pv-vc-histitem' }, icon('clock', 16), h('span', {}, t));
        b.addEventListener('click', () => { haptic('tick'); this.input.value = t; this.sendBtn.classList.add('ready'); this.input.focus({ preventScroll: true }); });
        this.hist.appendChild(b);
      }
    }
  }

  // ------------------------------------------------------------------ open / close
  open({ listen = false } = {}) {
    if (!this.isOpen) {
      if (this.shell.panelOpen) this.shell.closePanel();
      this.panel.classList.add('open');
      this.fab.classList.add('hidden');
      this._popBack = this.app.pushBackHandler(() => { this.close(); return true; });
      this.getEngine().catch((e) => console.error('[voice] engine', e)); // warm up the vocabulary
    }
    this._renderMode();
    if (listen && this.speech.available && !this.busy) this.startListening();
  }

  close() {
    if (!this.isOpen) return;
    if (this.speech.listening) this.speech.cancel();
    this.panel.classList.remove('open');
    this.fab.classList.remove('hidden');
    this._popBack?.(); this._popBack = null;
    this.input.blur();
  }

  // ------------------------------------------------------------------ speech
  _wireSpeech() {
    const s = this.speech;
    s.addEventListener('state', (e) => {
      this.panel.classList.toggle('listening', e.state === 'listening' || e.state === 'starting');
      if (e.state === 'listening') this._status('Ti ascolto…');
      if (e.state === 'processing') this._status('Un attimo…');
      if (e.state === 'idle' && !this.busy && this.panel.classList.contains('heard') === false) this._status(this.speech.available ? 'Tocca il microfono e parla' : 'Scrivi un comando');
      if (e.state === 'idle') this._level(0);
    });
    s.addEventListener('partial', (e) => { this.transcript.textContent = e.text; this.transcript.classList.add('partial'); });
    s.addEventListener('final', (e) => {
      this.transcript.textContent = e.text;
      this.transcript.classList.remove('partial');
      this.panel.classList.add('heard');
      this.run(e.text);
    });
    s.addEventListener('level', (e) => this._level(e.value));
    s.addEventListener('error', (e) => { this._status(e.message, 'warn'); haptic('warning'); });
  }

  _level(v) { this.ring.style.setProperty('--lvl', String(Math.max(0, Math.min(1, v || 0)))); }
  _status(text, kind = '') { this.status.textContent = text; this.status.className = 'pv-vc-status ' + kind; }

  startListening() {
    this.transcript.textContent = '';
    this.panel.classList.remove('heard', 'has-result');
    this.result.replaceChildren();
    haptic('light');
    if (!this.speech.start(this.settings.lang || 'it-IT')) return;
    this._status('Ti ascolto…');
  }

  toggleListen() {
    if (!this.speech.available) { toast('Il microfono non è disponibile qui: scrivi il comando', { kind: 'info' }); this.input.focus(); return; }
    if (this.busy) { this._abort?.abort(); return; }
    if (this.speech.listening) this.speech.stop(); else this.startListening();
  }

  // ------------------------------------------------------------------ run
  submit() {
    const t = this.input.value.trim();
    if (!t || this.busy) return;
    if (this.speech.listening) this.speech.cancel();
    this.input.value = '';
    this.sendBtn.classList.remove('ready');
    this.input.blur();
    this.transcript.textContent = t;
    this.transcript.classList.remove('partial');
    this.run(t);
  }

  /** Understands and executes a command; shows the summary. Returns the result. */
  async run(text, { mode } = {}) {
    if (this.busy) return null;
    this.busy = true;
    this.panel.classList.add('busy');
    this.result.replaceChildren();
    const useMode = mode || (this.settings.mode === 'hybrid' && this.settings.apiKey ? 'hybrid' : 'offline');
    this._status(useMode === 'hybrid' ? 'Chiedo a Claude…' : 'Sto eseguendo…');
    let out = null;
    try {
      const eng = await this.getEngine();
      this._abort = typeof AbortController === 'function' ? new AbortController() : null;
      const u = await eng.understand(text, { mode: useMode, apiKey: this.settings.apiKey, signal: this._abort?.signal });
      this._abort = null;
      this._status('Sto eseguendo…');
      let res = { done: [], failed: [], undoIndex: null };
      if (u.plan.actions.length) res = await eng.run(u.plan);
      out = { text, source: u.source, note: u.note, plan: u.plan, ...res, unknown: u.plan.unknown };
      this.lastUndo = res.undoIndex;
      this._showResult(out);
      if (u.plan.actions.length) { this.history = pushHistory(text); this._renderChips(); haptic(res.failed.length ? 'warning' : 'success'); }
      else haptic('warning');
    } catch (e) {
      console.error('[voice] run', e);
      this._status('Qualcosa è andato storto', 'warn');
      out = { text, error: String(e?.message || e) };
    } finally {
      this.busy = false;
      this.panel.classList.remove('busy');
    }
    return out;
  }

  _showResult(r) {
    const list = h('div', { class: 'pv-vc-lines' });
    for (const d of r.done) list.appendChild(h('div', { class: 'pv-vc-line ok' }, icon('check', 16), h('span', {}, d)));
    for (const f of r.failed) list.appendChild(h('div', { class: 'pv-vc-line warn' }, icon('warning', 16), h('span', {}, cap(f))));
    const unk = (r.unknown || []).filter(Boolean);
    if (unk.length) list.appendChild(h('div', { class: 'pv-vc-line warn' }, icon('help', 16), h('span', {}, 'Non ho capito: «' + unk.join('», «') + '»')));
    if (!r.done.length && !r.failed.length && !unk.length) list.appendChild(h('div', { class: 'pv-vc-line warn' }, icon('help', 16), h('span', {}, 'Non ho capito il comando. Prova con uno degli esempi.')));
    const src = h('span', { class: 'pv-vc-src' + (r.source === 'cloud' ? ' cloud' : '') }, svg(r.source === 'cloud' ? 'cloud' : 'device'), r.source === 'cloud' ? 'Capito con Claude' : 'Capito offline');
    const foot = h('div', { class: 'pv-vc-foot' }, src);
    if (r.note) foot.appendChild(h('span', { class: 'pv-vc-note' }, r.note));
    foot.appendChild(h('span', { class: 'pv-vc-sp' }));
    if (r.undoIndex !== null && r.undoIndex !== undefined) {
      this.undoBtn = button({ label: 'Annulla', icon: 'undo', small: true, variant: 'ghost', onClick: () => this.undo() });
      this.undoBtn.classList.add('pv-vc-undo');
      foot.appendChild(this.undoBtn);
    }
    this.result.replaceChildren(list, foot);
    // the summary and Annulla in view (short landscape screens scroll the panel body)
    requestAnimationFrame(() => { try { foot.scrollIntoView({ block: 'nearest' }); } catch { /* old WebView */ } });
    // compact after a result: the scene stays visible (examples / history come back on input)
    this.panel.classList.toggle('has-result', r.done.length > 0);
    this._status(r.done.length ? 'Fatto' : 'Nessuna modifica', r.done.length ? 'ok' : 'warn');
  }

  undo() {
    const H = this.app.history;
    if (this.lastUndo === null || H.index !== this.lastUndo || !H.canUndo) { toast('Il comando è già stato annullato o modificato', { kind: 'info' }); return; }
    H.undo();
    this.lastUndo = null;
    haptic('light');
    this.undoBtn?.remove();
    this._status('Annullato', '');
  }

  _syncUndo() { if (this.undoBtn && this.lastUndo !== null && this.app.history.index !== this.lastUndo) { this.undoBtn.remove(); this.lastUndo = null; } }

  // ------------------------------------------------------------------ settings sheet
  openSettings() {
    const s = { ...this.settings };
    const keyInput = h('input', { type: 'password', class: 'pv-input pv-vc-key', value: s.apiKey || '', placeholder: 'sk-ant-…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Chiave API Claude' });
    const show = h('button', { type: 'button', class: 'pv-vc-link' }, 'Mostra');
    show.addEventListener('click', () => { const hid = keyInput.type === 'password'; keyInput.type = hid ? 'text' : 'password'; show.textContent = hid ? 'Nascondi' : 'Mostra'; });
    const keyNote = h('p', { class: 'pv-vc-help' });
    const syncNote = () => {
      const k = keyInput.value.trim();
      keyNote.textContent = s.mode === 'hybrid'
        ? (k ? 'La chiave resta solo su questo dispositivo. Il testo del comando e un riepilogo della scena vengono inviati ad Anthropic solo in modalità ibrida e solo se sei online; altrimenti PosaViva capisce i comandi offline.' : 'Senza chiave i comandi vengono capiti offline.')
        : 'Solo offline: i comandi sono capiti sul telefono, nessun dato esce dal dispositivo.';
      keyRow.style.display = s.mode === 'hybrid' ? '' : 'none';
    };
    const keyRow = h('div', { class: 'pv-vc-keyrow' }, h('label', { class: 'pv-field' }, h('span', { class: 'pv-field-label' }, 'Chiave API Claude'), keyInput), show);
    const mode = segmented({ options: [{ value: 'offline', label: 'Solo offline' }, { value: 'hybrid', label: 'Ibrida' }], value: s.mode, onChange: (v) => { s.mode = v; syncNote(); } });
    const lang = segmented({ options: [{ value: 'it-IT', label: 'Italiano' }], value: 'it-IT', onChange: () => {} });
    const mic = h('p', { class: 'pv-vc-help' }, this.speech.available
      ? (this.speech.kind === 'android' ? 'Microfono: riconoscimento vocale di Android (sul dispositivo quando disponibile).' : 'Microfono: riconoscimento vocale del browser.')
      : 'Microfono non disponibile qui: puoi scrivere i comandi.');
    const body = [
      h('div', { class: 'pv-vc-set' }, h('div', { class: 'pv-vc-label' }, 'Lingua'), lang, mic),
      h('div', { class: 'pv-vc-set' }, h('div', { class: 'pv-vc-label' }, 'Modalità'), mode, keyRow, keyNote),
    ];
    syncNote();
    const m = modal({
      title: 'Comandi vocali', icon: 'settings', kind: 'sheet', className: 'pv-vc-settings', body,
      actions: [
        { label: 'Annulla', value: null, variant: 'ghost' },
        { label: 'Salva', variant: 'primary', onClick: () => {
          s.apiKey = keyInput.value.trim();
          if (s.mode === 'hybrid' && s.apiKey && !/^sk-ant-/.test(s.apiKey)) { toast('La chiave di solito inizia con «sk-ant-»: controllala', { kind: 'warning' }); }
          this.settings = saveSettings(s);
          this._renderMode();
          toast(this.settings.mode === 'hybrid' && this.settings.apiKey ? 'Modalità ibrida attiva' : 'Comandi solo offline', { kind: 'ok' });
          return true;
        } },
      ],
    });
    if (s.apiKey) {
      const rm = h('button', { type: 'button', class: 'pv-vc-link danger' }, 'Rimuovi la chiave');
      rm.addEventListener('click', async () => {
        if (!(await confirmDialog('Rimuovere la chiave API da questo dispositivo?', { danger: true, okLabel: 'Rimuovi' }))) return;
        keyInput.value = ''; s.apiKey = ''; this.settings = saveSettings({ ...this.settings, apiKey: '' }); this._renderMode(); syncNote();
      });
      keyRow.appendChild(rm);
    }
    return m;
  }
}

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
