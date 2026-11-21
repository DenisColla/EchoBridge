// First-run onboarding: a few short hint cards with small illustrations.
// Dismissable (Salta, back button, backdrop), swipeable, stored in localStorage.
import { h, modal, haptic } from '../ui/kit.js';
import { store } from './storage.js';

export const ONBOARDED_KEY = 'posaviva.onboarded';

// Illustrations: 200x130 viewBox, currentColor = muted lines, accent via classes.
const FIG = (x, y, s = 1, extra = '') => `<g transform="translate(${x} ${y}) scale(${s})" class="fig">
  <circle cx="0" cy="-38" r="8"/><path d="M0-29v30M0 1l-9 34M0 1l9 34M-17 -4l17-19 17 19${extra}"/></g>`;

const ART = {
  tap: `<svg viewBox="0 0 200 130"><g class="fig">
      <circle cx="100" cy="24" r="10"/><path d="M100 35v38M100 73l-11 44M100 73l11 44M100 40l-26 26"/>
      <path class="hl" d="M100 40l24 10 14 24"/></g>
      <circle class="ripple" cx="138" cy="74" r="9"/><circle class="ripple r2" cx="138" cy="74" r="17"/>
      <path class="finger" d="M146 86v-16a5 5 0 0 1 10 0v12l11 3a6 6 0 0 1 4 7l-2 13a8 8 0 0 1-8 7h-9a9 9 0 0 1-7-4l-8-11a4 4 0 0 1 6-5z"/></svg>`,
  rotate: `<svg viewBox="0 0 200 130">
      <ellipse class="ring rx" cx="100" cy="65" rx="46" ry="14"/>
      <ellipse class="ring ry" cx="100" cy="65" rx="14" ry="46"/>
      <circle class="ring rz" cx="100" cy="65" r="46"/>
      <circle class="joint" cx="100" cy="65" r="7"/>
      <path class="arrow" d="M150 40a56 56 0 0 1 2 46"/><path class="arrow" d="m146 82 6 6 4-8"/></svg>`,
  pinch: `<svg viewBox="0 0 200 130">
      <rect class="frame" x="40" y="14" width="120" height="102" rx="14"/>
      <circle class="dot" cx="80" cy="74" r="9"/><circle class="dot" cx="120" cy="56" r="9"/>
      <path class="arrow" d="M70 84l-16 16m0 0h10m-10 0V90M130 46l16-16m0 0h-10m10 0v10"/>
      <path class="arrow soft" d="M100 26v-8m0 0-4 4m4-4 4 4M100 104v8m0 0-4-4m4 4 4-4"/></svg>`,
  poses: `<svg viewBox="0 0 200 130">
      <rect class="frame" x="14" y="20" width="52" height="92" rx="10"/><rect class="frame on" x="74" y="20" width="52" height="92" rx="10"/><rect class="frame" x="134" y="20" width="52" height="92" rx="10"/>
      ${FIG(40, 86, 0.82)}
      <g transform="translate(100 86) scale(.82)" class="fig hlfig"><circle cx="0" cy="-38" r="8"/><path d="M0-29v30M0 1l-14 30M0 1l12 34M-20-34l20 11 18-22"/></g>
      <g transform="translate(160 86) scale(.82)" class="fig"><circle cx="4" cy="-36" r="8"/><path d="M2-27 0 1M0 1l-14 16 6 18M0 1l12 34M-16 0 2-21 18-6"/></g>
      <path class="spark" d="M118 12c.6 3.5 2.2 5.2 5.7 5.8-3.5.6-5.1 2.3-5.7 5.8-.6-3.5-2.2-5.2-5.7-5.8 3.5-.6 5.1-2.3 5.7-5.8z"/></svg>`,
};

const CARDS = [
  { art: 'tap', title: 'Tocca per selezionare', text: 'Tocca una parte del corpo (braccio, mano, testa…) per selezionarla. Tocca un altro personaggio per passare a lui.' },
  { art: 'rotate', title: 'Trascina gli anelli', text: 'Gli anelli colorati ruotano l\'articolazione selezionata. Muoviti con calma: ogni gesto si può annullare.' },
  { art: 'pinch', title: 'Muovi la vista', text: 'Un dito sullo sfondo gira attorno alla scena. Con due dita sposti e zoomi, come in una foto.' },
  { art: 'poses', title: 'Parti da una posa pronta', text: 'In Posa trovi pose pronte da rifinire. In Personaggi aggiungi fino a 8 manichini nella stessa inquadratura.' },
];

export function isOnboarded() { return store.getRaw(ONBOARDED_KEY) === '1'; }
export function resetOnboarding() { store.remove(ONBOARDED_KEY); }

/** Shows the onboarding cards. -> Promise (resolves when closed) */
export function showOnboarding() {
  let i = 0;
  const art = h('div', { class: 'pv-io-ob-art' });
  const title = h('div', { class: 'pv-io-ob-title' });
  const text = h('p', { class: 'pv-io-ob-text' });
  const dots = h('div', { class: 'pv-io-ob-dots' }, CARDS.map((_, k) => h('button', { type: 'button', class: 'pv-io-ob-dot', 'aria-label': `Scheda ${k + 1}`, onClick: () => go(k) })));
  const skip = h('button', { type: 'button', class: 'pv-btn ghost' }, 'Salta');
  const next = h('button', { type: 'button', class: 'pv-btn primary' }, 'Avanti');
  const stage = h('div', { class: 'pv-io-ob-stage' }, art, h('div', { class: 'pv-io-ob-step' }), title, text);
  const body = h('div', { class: 'pv-io-ob' }, stage, dots, h('div', { class: 'pv-io-ob-actions' }, skip, next));
  const m = modal({ body, className: 'pv-io-onboarding', onClose: () => store.setRaw(ONBOARDED_KEY, '1') });

  function go(k, dir = k > i ? 1 : -1) {
    i = Math.max(0, Math.min(CARDS.length - 1, k));
    const c = CARDS[i];
    art.innerHTML = ART[c.art];
    stage.querySelector('.pv-io-ob-step').textContent = `${i + 1} di ${CARDS.length}`;
    title.textContent = c.title;
    text.textContent = c.text;
    [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
    next.textContent = i === CARDS.length - 1 ? 'Inizia' : 'Avanti';
    skip.style.visibility = i === CARDS.length - 1 ? 'hidden' : '';
    stage.classList.remove('in-left', 'in-right');
    void stage.offsetWidth;
    stage.classList.add(dir > 0 ? 'in-right' : 'in-left');
  }
  next.addEventListener('click', () => { haptic('tick'); if (i < CARDS.length - 1) go(i + 1); else m.close('done'); });
  skip.addEventListener('click', () => { haptic('tick'); m.close('skip'); });

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
