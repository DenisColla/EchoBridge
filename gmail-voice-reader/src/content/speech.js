// Queue-based TTS on top of the browser's speechSynthesis (free, offline-capable,
// uses the OS/browser neural voices). One utterance per sentence gives us
// reliable pause/skip and avoids Chrome cutting off long utterances.

const QUALITY = [
  [/natural|neural|online/i, 4], // Edge "Microsoft ... Online (Natural)" voices are excellent
  [/google/i, 3],
  [/premium|enhanced|siri/i, 3],
];

let voicesReady = null;
function loadVoices() {
  voicesReady ??= new Promise((resolve) => {
    const have = speechSynthesis.getVoices();
    if (have.length) return resolve(have);
    speechSynthesis.addEventListener('voiceschanged', () => resolve(speechSynthesis.getVoices()), { once: true });
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
  });
  return voicesReady;
}

export async function pickVoice(lang, preferredName) {
  const voices = await loadVoices();
  if (preferredName) {
    const preferred = voices.find((v) => v.name === preferredName);
    if (preferred && preferred.lang.toLowerCase().startsWith(lang)) return preferred;
  }
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  const score = (v) => QUALITY.reduce((n, [re, pts]) => n + (re.test(v.name) ? pts : 0), 0);
  return matching.sort((a, b) => score(b) - score(a))[0] || null;
}

export class Speaker {
  constructor() {
    this.queue = [];
    this.index = 0;
    this.state = 'idle'; // idle | playing | paused
    this.rate = 1;
    this.voiceName = '';
    this.generation = 0; // invalidates callbacks of cancelled utterances
    this.onChange = () => {};
    this.onQueueEnd = () => {};
  }

  load(segments) {
    this.stop();
    this.queue = [...segments];
    this.index = 0;
    this.emit();
  }

  append(segments) {
    this.queue.push(...segments);
    this.emit();
  }

  get finished() {
    return this.index >= this.queue.length;
  }

  play() {
    if (this.finished) return;
    this.state = 'playing';
    this.speakCurrent();
  }

  // Chrome's native pause() is unreliable with network voices, so pause means
  // "stop and remember the sentence"; resume restarts that sentence.
  pause() {
    if (this.state !== 'playing') return;
    this.cancelSpeech();
    this.state = 'paused';
    this.emit();
  }

  toggle() {
    this.state === 'playing' ? this.pause() : this.play();
  }

  stop() {
    this.cancelSpeech();
    this.state = 'idle';
    this.index = 0;
    this.emit();
  }

  skip(delta) {
    this.index = Math.min(Math.max(0, this.index + delta), this.queue.length - 1);
    if (this.state === 'playing') {
      this.cancelSpeech();
      this.speakCurrent();
    } else {
      this.emit();
    }
  }

  setRate(rate) {
    this.rate = rate;
    if (this.state === 'playing') {
      this.cancelSpeech();
      this.speakCurrent();
    }
  }

  cancelSpeech() {
    this.generation++;
    speechSynthesis.cancel();
  }

  async speakCurrent() {
    const gen = ++this.generation;
    const seg = this.queue[this.index];
    this.emit();
    const voice = await pickVoice(seg.lang, this.voiceName);
    if (gen !== this.generation) return;

    const u = new SpeechSynthesisUtterance(seg.text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || seg.lang;
    u.rate = this.rate;
    const advance = () => {
      if (gen !== this.generation) return;
      this.index++;
      if (this.finished) {
        this.state = 'idle';
        this.emit();
        this.onQueueEnd();
      } else {
        this.speakCurrent();
      }
    };
    u.onend = advance;
    u.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') advance();
    };
    speechSynthesis.speak(u);
  }

  emit() {
    this.onChange({
      state: this.state,
      index: this.index,
      total: this.queue.length,
      segment: this.queue[this.index] || null,
    });
  }
}

// Speaks one short phrase outside the queue (confirmations, prompts).
export async function say(text, lang, rate = 1) {
  const voice = await pickVoice(lang);
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || lang;
    u.rate = rate;
    u.onend = u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}
