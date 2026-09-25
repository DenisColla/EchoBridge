// Service worker: the only place that talks to Claude. The content script
// sends already-cleaned text, so every token we pay for is signal.

import Anthropic from '@anthropic-ai/sdk';
import { getSettings } from './settings.js';
import { clipForPrompt, hash, parseBullets } from './content/text.js';

const LANG_NAMES = { it: 'italiano', en: 'English', es: 'español', fr: 'français', de: 'Deutsch' };
const CACHE_LIMIT = 300;

// Short, fixed system prompts: cheap to send, and stable for when the account
// crosses the prompt-cache minimum.
const SUMMARY_SYSTEM = `Riassumi un'email per chi la ascolta a voce. Rispondi SOLO con 3 righe che iniziano con "- ", in LINGUA_OUT. Ogni riga max 20 parole, frase parlata completa con soggetto esplicito (es. "Il mittente chiede…", "Serve una risposta entro…"). Priorità: cosa chiede o vuole il mittente, scadenze/date/importi, azioni richieste a chi riceve. Niente saluti, niente markdown.`;

const REPLY_SYSTEM = `Scrivi il corpo di una risposta email pronta da inviare, nella stessa lingua dell'email ricevuta. Tono: TONO. Segui le istruzioni dettate dall'utente (possono essere frammentarie o colloquiali: rendile ben scritte). Non inventare fatti, date, prezzi o impegni non presenti nelle istruzioni. Nessun oggetto, nessun segnaposto tra parentesi, nessun commento: solo il testo della mail, con saluto iniziale e chiusura.FIRMA`;

function client(apiKey) {
  // The key lives in chrome.storage.local and only ever goes to api.anthropic.com.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 60_000 });
}

// Per-model request options. Summaries and short replies are simple tasks,
// so effort stays low: fewer thinking tokens, faster audio.
function modelOptions(model) {
  if (model.startsWith('claude-haiku')) return {};
  const opts = { output_config: { effort: 'low' } };
  if (model === 'claude-opus-5') {
    // If Opus declines (safety classifier false positive), the API retries on a
    // fallback model within the same call instead of returning nothing.
    opts.betas = ['server-side-fallback-2026-07-01'];
    opts.fallbacks = 'default';
  }
  return opts;
}

async function ask({ settings, system, content, maxTokens }) {
  if (!settings.apiKey) throw new Error('NO_KEY');
  const response = await client(settings.apiKey).beta.messages.create({
    model: settings.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    ...modelOptions(settings.model),
  });
  if (response.stop_reason === 'refusal') throw new Error('Richiesta rifiutata dal modello');
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) throw new Error('Risposta vuota');
  return text;
}

function emailBlock({ fromName, fromEmail, subject, text }) {
  const { text: body } = clipForPrompt(text);
  return `Da: ${fromName}${fromEmail ? ` <${fromEmail}>` : ''}\nOggetto: ${subject}\n\n${body}`;
}

async function cacheGet(key) {
  return (await chrome.storage.local.get(key))[key];
}

async function cachePut(key, value) {
  const { cacheIndex = [] } = await chrome.storage.local.get('cacheIndex');
  const index = [...cacheIndex.filter((k) => k !== key), key];
  const evicted = index.splice(0, Math.max(0, index.length - CACHE_LIMIT));
  if (evicted.length) await chrome.storage.local.remove(evicted);
  await chrome.storage.local.set({ [key]: value, cacheIndex: index });
}

async function summarize(email) {
  const settings = await getSettings();
  // Same email (id + content) with the same model and language is never paid twice.
  const key = `sum:${hash(`${settings.model}|${settings.summaryLang}|${email.id || ''}|${email.text}`)}`;
  const cached = await cacheGet(key);
  if (cached) return { bullets: cached, cached: true };

  const raw = await ask({
    settings,
    system: SUMMARY_SYSTEM.replace('LINGUA_OUT', LANG_NAMES[settings.summaryLang] || 'italiano'),
    content: emailBlock(email),
    maxTokens: 1500, // output is ~60 words; the rest is headroom for adaptive thinking
  });
  const bullets = parseBullets(raw);
  if (!bullets.length) throw new Error('Riassunto non valido');
  await cachePut(key, bullets);
  return { bullets, cached: false };
}

async function draftReply({ email, instructions }) {
  const settings = await getSettings();
  const system = REPLY_SYSTEM.replace('TONO', settings.replyTone).replace(
    'FIRMA',
    settings.signature ? ` Firma come: ${settings.signature}.` : '',
  );
  const reply = await ask({
    settings,
    system,
    content: `EMAIL RICEVUTA:\n${emailBlock(email)}\n\nISTRUZIONI DETTATE PER LA RISPOSTA:\n${instructions}`,
    maxTokens: 3000,
  });
  return { reply };
}

const HANDLERS = { summarize, draftReply };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  handler(msg.payload)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => {
      const status = err instanceof Anthropic.APIError ? err.status : undefined;
      const message =
        err.message === 'NO_KEY'
          ? 'NO_KEY'
          : err instanceof Anthropic.AuthenticationError
            ? 'Chiave API non valida'
            : err instanceof Anthropic.RateLimitError
              ? 'Limite di richieste raggiunto, riprova tra poco'
              : status
                ? `Errore API ${status}`
                : err.message;
      sendResponse({ ok: false, error: message });
    });
  return true; // async response
});

// Keyboard shortcuts → forward to the Gmail tab.
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith('https://mail.google.com/')) chrome.tabs.sendMessage(tab.id, { type: 'command', command });
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
