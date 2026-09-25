// Shared settings schema (background, content script and options page).

export const DEFAULTS = {
  apiKey: '',
  model: 'claude-opus-5',
  summaryMinLines: 5, // summarize only emails longer than this many visual lines
  summaryLang: 'it',
  rate: 1.1,
  voiceName: '',
  autoPlay: false,
  replyMode: 'ai', // ai = Claude writes the reply from your dictated notes; literal = insert what you said
  replyTone: 'cordiale e professionale',
  signature: '',
  dictationLang: 'it-IT',
};

export const MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — qualità massima (consigliato)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — equilibrio qualità/costo' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — il più rapido ed economico' },
];

export async function getSettings() {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  const local = await chrome.storage.local.get('apiKey'); // the key never syncs across devices
  return { ...DEFAULTS, ...stored, apiKey: local.apiKey || '' };
}
