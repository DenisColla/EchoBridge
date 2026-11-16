// Pure text utilities (no DOM, no chrome.*) so they can be unit-tested in Node.

const CUT_MARKERS = [
  // Quoted replies: everything after these lines is history, not the new message.
  /^(il giorno|in data) .{3,200}(ha scritto|scrive)\s*:?\s*$/i,
  /^on .{3,200} wrote\s*:?\s*$/i,
  /^el .{3,200} escribió\s*:?\s*$/i,
  /^le .{3,200} a écrit\s*:?\s*$/i,
  /^am .{3,200} schrieb .{0,80}:?\s*$/i,
  /^-{2,}\s*(messaggio originale|original message|forwarded message|messaggio inoltrato)\s*-{2,}/i,
  /^(da|from)\s*:\s*.+@.+$/i,
  // Signatures and mobile footers.
  /^--\s*$/,
  /^(inviato da|sent from|envoyé de|enviado desde|gesendet von) (il mio |my |mon |mi )?(iphone|ipad|android|samsung|outlook|mobile|smartphone)/i,
  // Legal disclaimers are never worth hearing.
  /^(questo messaggio|questa e-?mail|le informazioni contenute|this (e-?mail|message) (and any|is confidential|may contain)|confidentiality notice|avviso di riservatezza)/i,
];

export function cleanEmailText(raw) {
  if (!raw) return '';
  const lines = raw
    .replace(/\r/g, '')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim());

  const out = [];
  for (const line of lines) {
    if (CUT_MARKERS.some((re) => re.test(line))) break;
    if (line.startsWith('>')) continue;
    out.push(line);
  }

  return out
    .join('\n')
    .replace(/https?:\/\/\S+/gi, 'link')
    .replace(/\bwww\.\S+/gi, 'link')
    .replace(/(link[\s,]*){2,}/gi, 'link ')
    .replace(/[*_~`#|]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Gmail wraps long paragraphs, so "lines" means visual lines: a real line
// longer than ~90 chars counts as several.
const CHARS_PER_LINE = 90;
export function countVisualLines(text) {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / CHARS_PER_LINE)), 0);
}

export function needsSummary(text, minLines = 5) {
  return countVisualLines(text) > minLines;
}

// Sentence chunks for TTS: short enough to dodge Chrome's ~15s utterance
// cut-off and to allow sentence-level skip, long enough to sound natural.
const MAX_CHUNK = 220;
export function splitForSpeech(text) {
  const sentences = text
    .split(/\n+/)
    .flatMap((p) => p.match(/[^.!?…]+(?:[.!?…]+["'»)\]]*|$)/g) || [])
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));

  const chunks = [];
  for (const s of sentences) {
    if (s.length <= MAX_CHUNK) {
      const prev = chunks[chunks.length - 1];
      if (prev && prev.length + s.length < 60) chunks[chunks.length - 1] = `${prev} ${s}`;
      else chunks.push(s);
      continue;
    }
    let rest = s;
    while (rest.length > MAX_CHUNK) {
      const window = rest.slice(0, MAX_CHUNK);
      const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '));
      const at = cut > 60 ? cut + 1 : window.lastIndexOf(' ') > 60 ? window.lastIndexOf(' ') : MAX_CHUNK;
      chunks.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) chunks.push(rest);
  }
  return chunks;
}

const STOPWORDS = {
  it: ['il', 'che', 'di', 'per', 'non', 'una', 'sono', 'della', 'con', 'grazie', 'buongiorno', 'gentile', 'cordiali', 'saluti', 'anche', 'questo', 'alla', 'nel', 'ciao'],
  en: ['the', 'and', 'you', 'that', 'for', 'with', 'this', 'are', 'please', 'thanks', 'regards', 'dear', 'have', 'will', 'your', 'hi', 'would'],
  es: ['el', 'los', 'las', 'que', 'por', 'para', 'con', 'una', 'gracias', 'saludos', 'estimado', 'muy', 'pero', 'hola', 'esta'],
  fr: ['le', 'les', 'des', 'est', 'pour', 'avec', 'une', 'vous', 'merci', 'bonjour', 'cordialement', 'nous', 'dans', 'pas', 'sur'],
  de: ['der', 'die', 'und', 'ist', 'nicht', 'mit', 'für', 'sie', 'ich', 'danke', 'grüße', 'bitte', 'wir', 'eine', 'das'],
};

export function detectLanguage(text, fallback = 'it') {
  const words = text.toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < 3) return fallback;
  let best = fallback;
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    const score = words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return best;
}

// Offline extractive summary, used when no API key is set or the API fails.
// Scores sentences by keyword frequency, requests/deadlines/questions, and position.
// Unicode-aware word boundaries: JS \b treats accented letters ("venerdì") as non-word.
const wordRe = (list) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${list})(?![\\p{L}\\p{N}])`, 'iu');
const CUE = wordRe('chiedo|chiediamo|richiest[ao]|potresti|potrebbe|puoi|può|vorrei|vorremmo|abbiamo bisogno|ho bisogno|serve|servirebbe|necessario|urgente|entro|scadenza|confermare|confermi|conferma|inviare|invii|mandare|mandi|allegat\\p{L}*|preventivo|fattura|pagamento|riunione|appuntamento|please|could you|can you|need|deadline|asap|confirm|send|invoice|meeting');
const DATE = wordRe('\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?|\\d{1,2}[:.]\\d{2}|lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|domani|oggi|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|monday|tuesday|wednesday|thursday|friday|tomorrow|today|€\\s?\\d+|\\d+\\s?(?:€|euro|eur)');
const GREETING = /^(gentil\w*|egregi\w*|buongiorno|buonasera|ciao|salve|dear|hi|hello|cordiali saluti|distinti saluti|saluti|grazie( mille)?[,.!]?$|best regards|kind regards|regards|thanks[,.!]?$)/i;

export function localSummary(text, count = 3) {
  const sentences = splitForSpeech(text).filter((s) => s.split(/\s+/).length >= 4 && !GREETING.test(s));
  if (sentences.length <= count) return sentences;

  const freq = new Map();
  for (const w of text.toLowerCase().match(/\p{L}{5,}/gu) || []) freq.set(w, (freq.get(w) || 0) + 1);

  const scored = sentences.map((s, i) => {
    const words = s.toLowerCase().match(/\p{L}{5,}/gu) || [];
    let score = words.reduce((n, w) => n + (freq.get(w) || 0), 0) / Math.max(4, words.length);
    if (CUE.test(s)) score += 2;
    if (DATE.test(s)) score += 1.5;
    if (s.includes('?')) score += 1;
    if (i === 0) score += 0.5;
    return { s, i, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
}

// Hard cap on what we send to the model. ~12k chars ≈ 3k tokens covers
// virtually every real email; longer ones keep head and tail, where the
// greeting/context and the actual ask usually are.
export const MAX_PROMPT_CHARS = 12000;
export function clipForPrompt(text, max = MAX_PROMPT_CHARS) {
  if (text.length <= max) return { text, clipped: false };
  const head = Math.floor(max * 0.7);
  return { text: `${text.slice(0, head)}\n[…]\n${text.slice(-(max - head))}`, clipped: true };
}

export function parseBullets(raw, count = 3) {
  return (raw || '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, count);
}

// Short, stable hash for cache keys (FNV-1a).
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
