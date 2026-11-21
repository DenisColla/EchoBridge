// First-run onboarding: a few short hint cards with small illustrations.
// Dismissable (Salta, back button, backdrop), swipeable, stored in localStorage.
// The last card points to the Guida (menu ☰ › Guida, "?" in the top bar).
import { h, modal, haptic } from '../ui/kit.js';
import { store } from './storage.js';
import { ART } from './art.js';

export const ONBOARDED_KEY = 'posaviva.onboarded';

const CARDS = [
  { art: 'tap', title: 'Tocca per selezionare', text: 'Tocca un personaggio per selezionarlo. Con Posa aperta, o col pannello chiuso, tocca una parte del corpo: braccio, mano, testa…' },
  { art: 'rotate', title: 'Trascina gli anelli', text: 'Gli anelli colorati ruotano la parte selezionata. In Posa trovi anche Trascina per mani e piedi. Ogni gesto si può annullare.' },
  { art: 'pinch', title: 'Muovi la vista', text: 'Un dito sullo sfondo gira attorno alla scena. Con due dita sposti e zoomi, come in una foto.' },
  { art: 'zoom', title: 'Zoom rapido', text: 'Il tasto con la lente, in basso a destra, inquadra al volo testa, mani o piedi. «Torna alla vista» (o Indietro) ti riporta dov\'eri.' },
  { art: 'poses', title: 'Parti da una posa pronta', text: 'In Posa › Pose pronte trovi pose da rifinire. In Personaggi aggiungi fino a 8 personaggi nella stessa inquadratura.' },
  { art: 'guide', title: 'Tutto spiegato nella Guida', text: 'Tocca ? in alto, o apri il menu ☰ › Guida: istruzioni passo per passo per ogni strumento, con la ricerca.', guide: true },
];

export function isOnboarded() { return store.getRaw(ONBOARDED_KEY) === '1'; }
export function resetOnboarding() { store.remove(ONBOARDED_KEY); }

/**
 * Shows the onboarding cards. opts: {openGuide(opts)} enables the "Apri la guida"
 * button on the last card. -> Promise (resolves when closed: 'done' | 'skip' | 'guide' | null)
 */
export function showOnboarding(opts = {}) {
  let i = 0;
  const art = h('div', { class: 'pv-io-art pv-io-ob-art' });
  const title = h('div', { class: 'pv-io-ob-title' });
  const text = h('p', { class: 'pv-io-ob-text' });
  const dots = h('div', { class: 'pv-io-ob-dots' }, CARDS.map((_, k) => h('button', { type: 'button', class: 'pv-io-ob-dot', 'aria-label': `Scheda ${k + 1}`, onClick: () => go(k) })));
  const skip = h('button', { type: 'button', class: 'pv-btn ghost' }, 'Salta');
  const guideBtn = h('button', { type: 'button', class: 'pv-btn ghost pv-io-ob-guide' }, 'Apri la guida');
  const next = h('button', { type: 'button', class: 'pv-btn primary' }, 'Avanti');
  const stage = h('div', { class: 'pv-io-ob-stage' }, art, h('div', { class: 'pv-io-ob-step' }), title, text);
  const body = h('div', { class: 'pv-io-ob' }, stage, dots, h('div', { class: 'pv-io-ob-actions' }, skip, guideBtn, next));
  const m = modal({ body, className: 'pv-io-onboarding', onClose: () => store.setRaw(ONBOARDED_KEY, '1') });

  function go(k, dir = k > i ? 1 : -1) {
    i = Math.max(0, Math.min(CARDS.length - 1, k));
    const c = CARDS[i];
    const last = i === CARDS.length - 1;
    art.innerHTML = ART[c.art];
    stage.querySelector('.pv-io-ob-step').textContent = `${i + 1} di ${CARDS.length}`;
    title.textContent = c.title;
    text.textContent = c.text;
    [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
    next.textContent = last ? 'Inizia' : 'Avanti';
    skip.style.display = last ? 'none' : '';
    guideBtn.style.display = last && opts.openGuide ? '' : 'none';
    stage.classList.remove('in-left', 'in-right');
    void stage.offsetWidth;
    stage.classList.add(dir > 0 ? 'in-right' : 'in-left');
  }
  next.addEventListener('click', () => { haptic('tick'); if (i < CARDS.length - 1) go(i + 1); else m.close('done'); });
  skip.addEventListener('click', () => { haptic('tick'); m.close('skip'); });
  guideBtn.addEventListener('click', () => { haptic('tick'); m.close('guide'); setTimeout(() => opts.openGuide?.(), 180); });

  // horizontal swipe between cards
  let x0 = null;
  stage.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  stage.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) { haptic('tick'); go(i + (dx < 0 ? 1 : -1)); }
  });
  stage.addEventListener('pointercancel', () => { x0 = null; });
  go(0, 1);
  return m.result;
}
