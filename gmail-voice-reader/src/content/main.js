import { getSettings } from '../settings.js';
import { getOpenEmail, insertReply } from './gmail.js';
import { Speaker, say } from './speech.js';
import { dictate } from './dictation.js';
import { createPlayer } from './ui.js';
import { cleanEmailText, detectLanguage, hash, localSummary, needsSummary, splitForSpeech } from './text.js';

const PHRASES = {
  it: {
    intro: (e) => `Email da ${e.fromName || 'mittente sconosciuto'}. Oggetto: ${e.subject || 'nessun oggetto'}.`,
    summaryIntro: 'Il riassunto della mail è il seguente.',
    localIntro: 'I punti chiave della mail sono questi.',
    ordinals: ['Primo', 'Secondo', 'Terzo'],
    draftReady: 'Bozza pronta nella risposta. Controllala e premi Invia.',
  },
  en: {
    intro: (e) => `Email from ${e.fromName || 'unknown sender'}. Subject: ${e.subject || 'no subject'}.`,
    summaryIntro: 'Here is the summary of the email.',
    localIntro: 'These are the key points of the email.',
    ordinals: ['First', 'Second', 'Third'],
    draftReady: 'Draft ready in the reply box. Review it and press Send.',
  },
};
const phrases = (lang) => PHRASES[lang] || PHRASES.it;
const RATES = [0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

let settings = null;
let current = null; // { key, email, text, lang, summary: { needed, promise, appended } }
let recording = null;

const speaker = new Speaker();
const player = createPlayer({
  toggle,
  prev: () => speaker.skip(-1),
  next: () => speaker.skip(1),
  stop: () => speaker.stop(),
  speed: cycleRate,
  reply: toggleReply,
  settings: () => chrome.runtime.sendMessage({ type: 'openOptions' }).catch(() => {}),
});

speaker.onChange = ({ state, index, total, segment }) => {
  player.setPlaying(state === 'playing');
  player.setProgress(state === 'idle' && index === 0 ? 0 : index, total);
  if (state === 'playing' && segment) player.setStatus(segment.text);
  if (state === 'paused') player.setStatus('In pausa');
};
speaker.onQueueEnd = onQueueEnd;

function send(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

// ---------- Email lifecycle ----------

function loadEmail(email) {
  speaker.stop();
  const text = cleanEmailText(email.rawText);
  const lang = detectLanguage(text, settings.summaryLang);
  const ui = settings.summaryLang;
  current = {
    key: email.id || hash(email.subject + text.slice(0, 300)),
    email,
    text,
    lang,
    summary: { needed: needsSummary(text, settings.summaryMinLines), promise: null, appended: false },
  };

  speaker.load([
    { text: phrases(ui).intro(email), lang: ui },
    ...splitForSpeech(text).map((t) => ({ text: t, lang })),
  ]);
  player.setStatus(current.summary.needed ? 'Pronto: lettura + riassunto in 3 punti' : 'Pronto a leggere');
  player.show(true);
  if (settings.autoPlay) toggle();
}

function toggle() {
  if (!current) return;
  if (speaker.finished) {
    // Replay from the top (summary, if already fetched, is part of the queue now).
    speaker.index = 0;
  }
  // Summary is requested on first play (not on open), so emails you never
  // listen to cost nothing. It runs while the body is being read.
  if (current.summary.needed && !current.summary.promise) current.summary.promise = fetchSummary(current);
  speaker.toggle();
}

async function fetchSummary(target) {
  const { email, text } = target;
  const res = await send('summarize', {
    id: email.id,
    fromName: email.fromName,
    fromEmail: email.fromEmail,
    subject: email.subject,
    text,
  }).catch((err) => ({ ok: false, error: err.message }));

  if (res?.ok) return { bullets: res.data.bullets, ai: true };
  // Offline fallback: extractive key points, still useful and free.
  return { bullets: localSummary(text), ai: false, error: res?.error };
}

async function onQueueEnd() {
  const target = current;
  if (!target) return;
  const { summary } = target;
  if (!summary.needed || summary.appended) {
    player.setStatus(summary.note ? `Lettura terminata · ${summary.note}` : 'Lettura terminata · 🎤 per rispondere');
    player.setProgress(1, 1);
    return;
  }

  player.setStatus('Preparo il riassunto…', 'busy');
  const result = await summary.promise;
  if (current !== target || summary.appended) return; // user moved to another email
  summary.appended = true;

  const ui = settings.summaryLang;
  const p = phrases(ui);
  const bulletLang = result.ai ? ui : target.lang;
  speaker.append([
    { text: result.ai ? p.summaryIntro : p.localIntro, lang: ui },
    ...result.bullets.map((b, i) => ({ text: `${p.ordinals[i] || ''}: ${b}`, lang: bulletLang })),
  ]);
  if (!result.ai) {
    summary.note = result.error === 'NO_KEY' ? 'punti chiave offline: aggiungi la chiave API per il riassunto AI' : `punti chiave offline (${result.error})`;
  }
  speaker.play();
}

// ---------- Reply by voice ----------

async function toggleReply() {
  if (recording) {
    recording.stop();
    return;
  }
  if (!current) return;
  speaker.pause();
  speechSynthesis.cancel();

  recording = dictate({
    lang: settings.dictationLang,
    onInterim: (t) => player.setStatus(`🎤 ${t}`),
  });
  player.setRecording(true);
  player.setStatus(settings.replyMode === 'ai' ? '🎤 Di\' cosa vuoi rispondere…' : '🎤 Detta la risposta…');

  try {
    const transcript = await recording.promise;
    recording = null;
    player.setRecording(false);
    if (!transcript) {
      player.setStatus('Nessuna voce rilevata');
      return;
    }

    let body = transcript;
    if (settings.replyMode === 'ai') {
      player.setStatus('Scrivo la risposta…', 'busy');
      const res = await send('draftReply', {
        email: { ...current.email, text: current.text },
        instructions: transcript,
      });
      if (res?.ok) body = res.data.reply;
      else player.setStatus(`AI non disponibile (${res?.error}): inserisco il testo dettato`, 'err');
    }

    await insertReply(body);
    player.setStatus('Bozza inserita · controlla e premi Invia');
    say(phrases(settings.summaryLang).draftReady, settings.summaryLang, speaker.rate);
  } catch (err) {
    recording = null;
    player.setRecording(false);
    player.setStatus(err.message, 'err');
  }
}

// ---------- Settings & wiring ----------

function cycleRate() {
  const next = RATES[(RATES.indexOf(speaker.rate) + 1) % RATES.length] ?? 1;
  speaker.setRate(next);
  player.setRate(next);
  chrome.storage.sync.set({ rate: next });
}

async function applySettings() {
  settings = await getSettings();
  speaker.rate = settings.rate;
  speaker.voiceName = settings.voiceName;
  player.setRate(settings.rate);
}

// Gmail is a SPA: watch the DOM, but only re-extract when the visible
// message body element actually changes.
let lastBody = null;
let scheduled = false;
function scan() {
  scheduled = false;
  const bodies = [...document.querySelectorAll('div.a3s')].filter((el) => el.offsetParent !== null);
  const body = bodies[bodies.length - 1] || null;
  if (body === lastBody) return;
  lastBody = body;

  const email = body && getOpenEmail();
  if (!email) {
    speaker.stop();
    current = null;
    player.show(false);
    return;
  }
  const key = email.id || hash(email.subject + cleanEmailText(email.rawText).slice(0, 300));
  if (current?.key !== key) loadEmail(email);
}

function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(scan, 350);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'command') return;
  if (msg.command === 'toggle-play') toggle();
  if (msg.command === 'reply') toggleReply();
});

chrome.storage.onChanged.addListener(applySettings);

applySettings().then(() => {
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  scheduleScan();
});
