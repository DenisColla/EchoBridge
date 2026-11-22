// Entry point of the "voice" module (Comandi vocali e testuali). See posaviva/ARCHITECTURE.md
// and voice/README.md.
//
// A floating mic button (bottom-left of the free view) opens the "Comandi" panel:
// speak (Android: native SpeechRecognizer through the shell bridge; browser:
// Web Speech API when present) or type a command in Italian. The command is
// understood offline (parser.js, vocabulary built from the app catalogs) or, in
// "ibrida" mode with the user's own Anthropic API key, by Claude (cloud.js), and
// executed on the modules' APIs as ONE undo step (executor.js + spatial.js).
//
// Public runtime API: app.voice = {
//   run(text, {mode}) -> Promise<result>   understand + execute + show the summary
//   parse(text) -> Promise<plan>           offline plan only (no execution)
//   execute(plan) -> Promise<result>       execute a plan (plan.js format)
//   open({listen}), close(), openSettings()  UI
//   engine() -> Promise<engine>            {cat, lex, parseOffline, understand, run, executor}
//   speech                                 Speech (available, kind 'android'|'web'|null)
// }
import './voice.css';
import { VoiceUI } from './ui.js';

export function create(app, shell) {
  let engineP = null;
  const getEngine = () => {
    if (!engineP) engineP = import('./engine.js').then((m) => m.createEngine(app)).catch((e) => { engineP = null; throw e; });
    return engineP;
  };
  const ui = new VoiceUI({ app, shell, getEngine });
  // the vocabulary is built in idle time after start-up, so the first command is immediate
  app.addEventListener('ready', () => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
    setTimeout(() => idle(() => getEngine().catch(() => {}), { timeout: 4000 }), 5000);
  });

  const api = {
    run: (text, opts) => ui.run(text, opts),
    parse: async (text) => (await getEngine()).parseOffline(text),
    execute: async (plan) => {
      const eng = await getEngine();
      const { normalizePlan } = await import('./plan.js');
      return eng.run(normalizePlan(plan, eng.cat));
    },
    open: (o) => ui.open(o),
    close: () => ui.close(),
    openSettings: () => ui.openSettings(),
    engine: getEngine,
    speech: ui.speech,
    ui,
  };
  app.voice = api;
  return { open: api.open, openSettings: api.openSettings, run: api.run, parse: api.parse };
}
