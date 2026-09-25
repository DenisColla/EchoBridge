// Floating player. Lives in a Shadow DOM so Gmail's CSS can't touch it (and vice versa).

const CSS = `
:host { all: initial; }
.bar {
  position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
  z-index: 2147483000; display: flex; align-items: center; gap: 6px;
  min-width: 360px; max-width: min(720px, calc(100vw - 32px));
  padding: 8px 10px; border-radius: 999px;
  background: #1f1f1f; color: #f1f1f1; box-shadow: 0 6px 24px rgba(0,0,0,.28);
  font: 13px/1.3 "Google Sans", Roboto, system-ui, sans-serif;
}
.bar[hidden] { display: none; }
button {
  all: unset; cursor: pointer; display: grid; place-items: center;
  width: 32px; height: 32px; border-radius: 50%; font-size: 15px; color: inherit;
}
button:hover { background: rgba(255,255,255,.12); }
button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
button.primary { width: 38px; height: 38px; background: #8ab4f8; color: #1f1f1f; font-size: 16px; }
button.primary:hover { background: #aecbfa; }
button.rec { background: #f28b82; color: #1f1f1f; animation: pulse 1.2s infinite; }
button.speed { width: auto; padding: 0 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
@keyframes pulse { 50% { opacity: .6; } }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding: 0 4px; }
.status { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status.busy::before { content: "⏳ "; }
.status.err { color: #f28b82; }
.track { height: 3px; border-radius: 2px; background: rgba(255,255,255,.18); overflow: hidden; }
.fill { height: 100%; width: 0; background: #8ab4f8; transition: width .25s; }
@media (prefers-color-scheme: light) {
  .bar { background: #fff; color: #1f1f1f; box-shadow: 0 6px 24px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06); }
  button:hover { background: rgba(0,0,0,.07); }
  button.primary { background: #0b57d0; color: #fff; }
  button.primary:hover { background: #0842a0; }
  .track { background: rgba(0,0,0,.1); }
  .fill { background: #0b57d0; }
  .status.err { color: #b3261e; }
}
`;

export function createPlayer(actions) {
  const host = document.createElement('div');
  host.id = 'echobridge-mail-player';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="bar" role="region" aria-label="Lettore vocale email" hidden>
      <button class="primary" data-a="toggle" title="Leggi / Pausa (Alt+Shift+L)">▶</button>
      <button data-a="prev" title="Frase precedente">⏮</button>
      <button data-a="next" title="Frase successiva">⏭</button>
      <button data-a="stop" title="Stop">⏹</button>
      <div class="info">
        <div class="status" aria-live="polite">Pronto a leggere</div>
        <div class="track"><div class="fill"></div></div>
      </div>
      <button class="speed" data-a="speed" title="Velocità">1×</button>
      <button data-a="reply" title="Rispondi a voce (Alt+Shift+R)">🎤</button>
      <button data-a="settings" title="Impostazioni">⚙</button>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (sel) => root.querySelector(sel);
  const bar = $('.bar');
  const status = $('.status');

  bar.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a) actions[a]?.();
  });

  return {
    show(visible) {
      bar.hidden = !visible;
    },
    setPlaying(playing) {
      $('[data-a="toggle"]').textContent = playing ? '⏸' : '▶';
    },
    setProgress(index, total) {
      $('.fill').style.width = total ? `${Math.round((index / total) * 100)}%` : '0';
    },
    setStatus(text, kind = '') {
      status.textContent = text;
      status.className = `status ${kind}`;
      status.title = text;
    },
    setRate(rate) {
      $('[data-a="speed"]').textContent = `${rate}×`;
    },
    setRecording(on) {
      $('[data-a="reply"]').classList.toggle('rec', on);
      $('[data-a="reply"]').title = on ? 'Stop dettatura' : 'Rispondi a voce (Alt+Shift+R)';
    },
  };
}
