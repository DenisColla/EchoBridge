import { DEFAULTS, MODELS, getSettings } from '../settings.js';

const $ = (id) => document.getElementById(id);
const RATES = [0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

$('model').innerHTML = MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
$('rate').innerHTML = RATES.map((r) => `<option value="${r}">${r}×</option>`).join('');

function fillVoices(selected) {
  const voices = speechSynthesis.getVoices().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  $('voiceName').innerHTML =
    '<option value="">Automatica (consigliato)</option>' +
    voices.map((v) => `<option value="${v.name}">${v.name} — ${v.lang}</option>`).join('');
  $('voiceName').value = selected;
}

let toastTimer;
function toast() {
  $('saved').classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('saved').classList.remove('on'), 1200);
}

async function refreshCacheInfo() {
  const { cacheIndex = [] } = await chrome.storage.local.get('cacheIndex');
  $('cacheInfo').textContent = `Riassunti in cache: ${cacheIndex.length} (riascoltarli costa 0 token)`;
}

async function init() {
  const s = await getSettings();
  for (const key of Object.keys(DEFAULTS)) {
    const el = $(key);
    if (!el || key === 'voiceName') continue;
    if (el.type === 'checkbox') el.checked = s[key];
    else el.value = s[key];
  }
  fillVoices(s.voiceName);
  speechSynthesis.addEventListener('voiceschanged', () => fillVoices($('voiceName').value || s.voiceName));
  refreshCacheInfo();

  document.addEventListener('change', async (e) => {
    const key = e.target.id;
    if (!(key in DEFAULTS)) return;
    let value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (typeof DEFAULTS[key] === 'number') value = Number(value) || DEFAULTS[key];
    if (key === 'apiKey') await chrome.storage.local.set({ apiKey: value.trim() });
    else await chrome.storage.sync.set({ [key]: value });
    toast();
  });
}

$('testVoice').addEventListener('click', () => {
  speechSynthesis.cancel();
  const voice = speechSynthesis.getVoices().find((v) => v.name === $('voiceName').value);
  const u = new SpeechSynthesisUtterance(
    voice && !voice.lang.startsWith('it') ? 'Hello, this is how your emails will sound.' : 'Ciao, così suoneranno le tue email.',
  );
  if (voice) u.voice = voice;
  u.lang = voice?.lang || 'it-IT';
  u.rate = Number($('rate').value) || 1;
  speechSynthesis.speak(u);
});

$('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

$('clearCache').addEventListener('click', async () => {
  const { cacheIndex = [] } = await chrome.storage.local.get('cacheIndex');
  await chrome.storage.local.remove([...cacheIndex, 'cacheIndex']);
  refreshCacheInfo();
  toast();
});

init();
