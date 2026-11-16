// Floating player. Lives in a Shadow DOM so Gmail's CSS can't touch it (and vice versa).
// Collapsed it is a single round symbol in the bottom-left corner; hovering it
// (or tabbing into it) unfolds the full bar from that same spot, so the play
// button ends up exactly under the pointer.

const ICONS = {
  speaker:
    '<svg class="ico speaker" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/></svg>',
  mic: '<svg class="ico mic" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5.3-3A5.3 5.3 0 0 1 12 16.1 5.3 5.3 0 0 1 6.7 11H5a7 7 0 0 0 6 6.72V21h2v-3.28A7 7 0 0 0 19 11h-1.7z"/></svg>',
  eq: '<span class="ico eq" aria-hidden="true"><i></i><i></i><i></i></span>',
};

const CSS = `
:host { all: initial; }
.shell {
  --bg: #1f1f1f; --fg: #f1f1f1; --accent: #8ab4f8; --accent-hover: #aecbfa; --on-accent: #1f1f1f;
  --hover: rgba(255,255,255,.12); --rail: rgba(255,255,255,.22); --err: #f28b82;
  --shadow: 0 4px 14px rgba(0,0,0,.3);
  position: fixed; left: 16px; bottom: 16px; z-index: 2147483000;
  font: 13px/1.3 "Google Sans", Roboto, system-ui, sans-serif;
}
.shell[hidden] { display: none; }
/* Collapsed the bar is a 44px circle; open, it widens to show the row, which
   keeps its full width throughout so nothing reflows while it unfolds. */
.bar {
  --full: min(620px, calc(100vw - 32px));
  position: relative; width: 44px; height: 44px; overflow: hidden;
  border-radius: 22px; background: var(--bg); color: var(--fg); box-shadow: var(--shadow);
  transition: width .22s ease;
}
.bar.open, .bar.pinned, .bar:has(:focus-visible) { width: var(--full); }
.row {
  box-sizing: border-box; display: flex; align-items: center; gap: 4px;
  width: var(--full); height: 44px; padding: 3px 10px 3px 3px;
}
.dock {
  position: absolute; left: 0; top: 0; z-index: 1; width: 44px; height: 44px;
  display: grid; place-items: center; border-radius: 50%;
  background: var(--bg); color: var(--accent); cursor: pointer;
  transition: opacity .15s ease;
}
/* Open, the dock fades and lets clicks through to the play button under it. */
.bar.open .dock, .bar.pinned .dock, .bar:has(:focus-visible) .dock { opacity: 0; pointer-events: none; }
.dock .ico { display: none; }
.bar[data-state="idle"] .dock .speaker, .bar[data-state="playing"] .dock .eq, .bar[data-state="rec"] .dock .mic { display: inline-flex; }
.bar[data-state="rec"] .dock { color: var(--err); animation: pulse 1.2s infinite; }
.bar[data-alert] .dock { color: var(--err); }
.eq { align-items: flex-end; gap: 3px; height: 16px; }
.eq i { width: 3px; height: 100%; border-radius: 1px; background: currentColor; animation: eq .9s ease-in-out infinite; transform-origin: bottom; }
.eq i:nth-child(2) { animation-delay: -.3s; }
.eq i:nth-child(3) { animation-delay: -.6s; }
@keyframes eq { 0%, 100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
@keyframes pulse { 50% { opacity: .55; } }
button {
  all: unset; flex: none; cursor: pointer; display: grid; place-items: center;
  width: 32px; height: 32px; border-radius: 50%; font-size: 15px; color: inherit;
}
button:hover { background: var(--hover); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button[hidden] { display: none; }
button.primary { width: 38px; height: 38px; background: var(--accent); color: var(--on-accent); font-size: 16px; }
button.primary:hover { background: var(--accent-hover); }
button.rec { background: var(--err); color: #1f1f1f; animation: pulse 1.2s infinite; }
button.chip { width: auto; padding: 0 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; padding: 0 6px; }
.status { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status.busy::before { content: "⏳ "; }
.status.err { color: var(--err); }
.track { --p: 0; position: relative; height: 14px; cursor: pointer; touch-action: none; border-radius: 7px; }
.track:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.rail { position: absolute; left: 0; right: 0; top: 5px; height: 4px; border-radius: 2px; background: var(--rail); overflow: hidden; transition: top .1s, height .1s; }
.fill { height: 100%; width: calc(var(--p) * 100%); background: var(--accent); transition: width .25s; }
.thumb {
  position: absolute; top: 1px; left: calc(var(--p) * 100%); width: 12px; height: 12px; margin-left: -6px;
  border-radius: 50%; background: var(--accent); transform: scale(0); transition: transform .1s, left .25s;
}
.track:hover .rail, .track:focus-visible .rail, .track.dragging .rail { top: 4px; height: 6px; }
.track:hover .thumb, .track:focus-visible .thumb, .track.dragging .thumb { transform: scale(1); }
.track.dragging .fill, .track.dragging .thumb { transition: none; }
.tip {
  position: absolute; bottom: calc(100% + 8px); left: 0; max-width: 320px; padding: 6px 10px;
  border-radius: 8px; background: var(--bg); color: var(--fg); font-size: 12px; box-shadow: var(--shadow);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;
}
.tip[hidden] { display: none; }
@media (prefers-color-scheme: light) {
  .shell {
    --bg: #fff; --fg: #1f1f1f; --accent: #0b57d0; --accent-hover: #0842a0; --on-accent: #fff;
    --hover: rgba(0,0,0,.07); --rail: rgba(0,0,0,.12); --err: #b3261e;
    --shadow: 0 4px 14px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06);
  }
}
`;

export function createPlayer(actions) {
  const host = document.createElement('div');
  host.id = 'echobridge-mail-player';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="shell" hidden>
      <div class="tip" role="tooltip" hidden></div>
      <div class="bar" role="region" aria-label="Lettore vocale email" data-state="idle">
        <span class="dock">${ICONS.speaker}${ICONS.eq}${ICONS.mic}</span>
        <div class="row">
          <button class="primary" data-a="toggle" title="Leggi / Pausa (Alt+Shift+L)">▶</button>
          <button data-a="prev" title="Frase precedente">⏮</button>
          <button data-a="next" title="Frase successiva">⏭</button>
          <button data-a="stop" title="Stop">⏹</button>
          <div class="info">
            <div class="status" aria-live="polite">Pronto a leggere</div>
            <div class="track" role="slider" tabindex="0" aria-label="Posizione di lettura"
                 aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div class="rail"><div class="fill"></div></div>
              <div class="thumb"></div>
            </div>
          </div>
          <button class="chip" data-a="summary" title="Salta al riassunto" hidden>Riassunto</button>
          <button class="chip" data-a="speed" title="Velocità">1×</button>
          <button data-a="reply" title="Rispondi a voce (Alt+Shift+R)">🎤</button>
          <button data-a="settings" title="Impostazioni">⚙</button>
        </div>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (sel) => root.querySelector(sel);
  const shell = $('.shell');
  const bar = $('.bar');
  const status = $('.status');
  const track = $('.track');
  const tip = $('.tip');

  bar.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a) actions[a]?.();
  });

  // Hovering the symbol opens the bar; leaving it closes after a short grace
  // period, so brushing past the edge doesn't snap it shut.
  let closeTimer = 0;
  bar.addEventListener('pointerenter', () => {
    clearTimeout(closeTimer);
    bar.classList.add('open');
  });
  bar.addEventListener('pointerleave', () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => bar.classList.remove('open'), 350);
  });

  let playing = false;
  let recording = false;
  const syncState = () => {
    bar.dataset.state = recording ? 'rec' : playing ? 'playing' : 'idle';
  };

  // ---------- Timeline: click or drag to jump, hover to preview ----------

  let shown = 0; // where playback is; the bar returns here if a drag is cancelled
  let dragging = false;
  const paint = (f) => track.style.setProperty('--p', f);
  const fractionAt = (e) => {
    const r = track.getBoundingClientRect();
    return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
  };
  const showTip = (f) => {
    const text = actions.preview?.(f);
    if (!text) {
      tip.hidden = true;
      return;
    }
    tip.textContent = text;
    tip.hidden = false;
    const t = track.getBoundingClientRect();
    const s = shell.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const x = t.left - s.left + f * t.width;
    tip.style.left = `${Math.min(Math.max(x - half, 0), s.width - tip.offsetWidth)}px`;
  };
  const endDrag = (commitAt) => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('dragging');
    bar.classList.remove('pinned');
    tip.hidden = true;
    if (commitAt == null) paint(shown);
    else actions.seek?.(commitAt);
  };

  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    track.setPointerCapture(e.pointerId);
    track.classList.add('dragging');
    bar.classList.add('pinned'); // stay open even if the pointer drifts off the bar
    const f = fractionAt(e);
    paint(f);
    showTip(f);
  });
  track.addEventListener('pointermove', (e) => {
    const f = fractionAt(e);
    if (dragging) paint(f);
    showTip(f);
  });
  track.addEventListener('pointerleave', () => {
    if (!dragging) tip.hidden = true;
  });
  track.addEventListener('pointerup', (e) => endDrag(fractionAt(e)));
  track.addEventListener('pointercancel', () => endDrag(null));
  track.addEventListener('keydown', (e) => {
    const keys = {
      ArrowLeft: actions.prev,
      ArrowRight: actions.next,
      Home: () => actions.seek?.(0),
      End: () => actions.seek?.(1),
      Escape: () => endDrag(null),
    };
    if (!keys[e.key] || (e.key === 'Escape' && !dragging)) return;
    e.preventDefault();
    e.stopPropagation(); // keep Gmail's own shortcuts out of it
    keys[e.key]();
  });

  return {
    show(visible) {
      shell.hidden = !visible;
    },
    setPlaying(on) {
      playing = on;
      $('[data-a="toggle"]').textContent = on ? '⏸' : '▶';
      syncState();
    },
    setProgress(fraction, label = '') {
      shown = fraction;
      if (!dragging) paint(fraction);
      track.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      if (label) track.setAttribute('aria-valuetext', label);
    },
    setStatus(text, kind = '') {
      status.textContent = text;
      status.className = `status ${kind}`;
      status.title = text;
      bar.toggleAttribute('data-alert', kind === 'err');
    },
    setRate(rate) {
      $('[data-a="speed"]').textContent = `${rate}×`;
    },
    setRecording(on) {
      recording = on;
      $('[data-a="reply"]').classList.toggle('rec', on);
      $('[data-a="reply"]').title = on ? 'Stop dettatura' : 'Rispondi a voce (Alt+Shift+R)';
      syncState();
    },
    setSummaryJump(available) {
      $('[data-a="summary"]').hidden = !available;
    },
  };
}
