// Speech input: the Android shell's native recognizer (android.speech.SpeechRecognizer,
// on-device when available) through window.AndroidBridge.startListening / stopListening
// and window.__onSpeech({partial|final|error|level|state}); in a browser,
// webkitSpeechRecognition / SpeechRecognition when present; otherwise none
// (text commands only).
//
// Events (EventTarget): 'state' {state: 'idle'|'starting'|'listening'|'processing'},
// 'partial' {text}, 'final' {text}, 'level' {value 0..1}, 'error' {code, message}.

const ERR_IT = {
  permission: 'Serve il permesso del microfono per i comandi vocali. Puoi darlo nelle impostazioni di Android (App › PosaViva › Autorizzazioni › Microfono), oppure scrivere il comando.',
  'not-allowed': 'Il browser non ha il permesso di usare il microfono. Puoi scrivere il comando.',
  'service-not-allowed': 'Il riconoscimento vocale non è disponibile in questo browser. Puoi scrivere il comando.',
  'no-speech': 'Non ho sentito niente. Riprova parlando vicino al telefono.',
  'no-match': 'Non ho capito le parole. Riprova o scrivi il comando.',
  network: 'Il riconoscimento vocale richiede la rete su questo dispositivo. Puoi scrivere il comando.',
  'audio-capture': 'Il microfono non è disponibile.',
  busy: 'Il riconoscimento vocale è occupato, riprova tra un attimo.',
  unavailable: 'Il riconoscimento vocale non è disponibile su questo dispositivo. Puoi scrivere il comando.',
  aborted: '',
  client: '',
};
export const speechErrorText = (code, fallback) => ERR_IT[code] ?? fallback ?? 'Errore del riconoscimento vocale.';

export class Speech extends EventTarget {
  constructor() {
    super();
    const ab = typeof window !== 'undefined' ? window.AndroidBridge : null;
    const W = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
    let native = false;
    try { native = !!ab && typeof ab.startListening === 'function' && (typeof ab.speechAvailable !== 'function' || ab.speechAvailable() !== false); } catch { native = false; }
    this.kind = native ? 'android' : W ? 'web' : null;
    this.state = 'idle';
    this._Web = W;
    this._rec = null;
    this._final = '';
    if (this.kind === 'android') {
      // the native side calls this from the UI thread through evaluateJavascript
      window.__onSpeech = (ev) => { try { this._onNative(typeof ev === 'string' ? JSON.parse(ev) : ev); } catch (e) { console.error('[voice] speech event', e); } };
    }
  }

  get available() { return !!this.kind; }
  get listening() { return this.state === 'listening' || this.state === 'starting'; }

  _emit(type, detail = {}) { this.dispatchEvent(Object.assign(new Event(type), detail)); }
  _setState(s) { if (this.state !== s) { this.state = s; this._emit('state', { state: s }); } }

  start(lang = 'it-IT') {
    if (!this.kind || this.listening) return false;
    this._final = '';
    this._setState('starting');
    if (this.kind === 'android') {
      let r = '';
      try { r = String(window.AndroidBridge.startListening(lang) ?? ''); } catch (e) { r = 'error:client'; }
      if (r.startsWith('error')) { this._fail(r.slice(6) || 'unavailable'); return false; }
      return true;
    }
    try {
      const rec = new this._Web();
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onstart = () => this._setState('listening');
      rec.onaudiostart = () => this._setState('listening');
      rec.onspeechstart = () => this._emit('level', { value: 0.6 });
      rec.onspeechend = () => this._emit('level', { value: 0 });
      rec.onresult = (e) => {
        let interim = '', fin = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) fin += t; else interim += t;
        }
        if (fin) { this._final += fin; this._emit('final', { text: this._final.trim() }); }
        else if (interim) { this._emit('partial', { text: (this._final + interim).trim() }); this._emit('level', { value: 0.35 + Math.random() * 0.5 }); }
      };
      rec.onerror = (e) => { if (e.error !== 'aborted') this._fail(e.error); };
      rec.onend = () => { this._rec = null; if (this.state !== 'idle') this._setState('idle'); };
      this._rec = rec;
      rec.start();
      return true;
    } catch (e) {
      this._fail('unavailable');
      return false;
    }
  }

  stop() {
    if (this.kind === 'android') { try { window.AndroidBridge.stopListening(); } catch { /* ignore */ } }
    else if (this._rec) { try { this._rec.stop(); } catch { /* ignore */ } }
  }

  cancel() {
    if (this.kind === 'android') { try { (window.AndroidBridge.cancelListening || window.AndroidBridge.stopListening).call(window.AndroidBridge); } catch { /* ignore */ } }
    else if (this._rec) { try { this._rec.abort(); } catch { /* ignore */ } }
    this._setState('idle');
  }

  _fail(code, message) {
    this._setState('idle');
    const text = speechErrorText(code, message);
    if (text) this._emit('error', { code, message: text });
  }

  _onNative(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.state) this._setState(ev.state === 'ready' || ev.state === 'listening' ? 'listening' : ev.state === 'end' ? 'idle' : ev.state);
    if (typeof ev.level === 'number') this._emit('level', { value: Math.max(0, Math.min(1, ev.level)) });
    if (typeof ev.partial === 'string' && ev.partial) this._emit('partial', { text: ev.partial });
    if (typeof ev.final === 'string') { this._setState('idle'); if (ev.final.trim()) this._emit('final', { text: ev.final.trim() }); else this._fail('no-match'); }
    if (ev.error) this._fail(ev.error, ev.message);
  }
}
