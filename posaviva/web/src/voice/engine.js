// Command engine: vocabulary from the app catalogs + offline parser + optional
// cloud parser + executor. Loaded on first use (not in the boot path).
import { collectCatalogs, buildLexicon } from './vocab.js';
import { parse } from './parser.js';
import { normalizePlan } from './plan.js';
import { Executor } from './executor.js';

export async function createEngine(app) {
  const cat = await collectCatalogs(app);
  // room presets: the item types each one creates ("il tavolo" of a new kitchen)
  try {
    const { ROOM_PRESETS } = await import('../props/gen/rooms.js');
    for (const r of cat.rooms) r.items = ROOM_PRESETS.find((p) => p.id === r.id)?.items().map((i) => i.type) || [];
  } catch { /* rooms optional */ }
  const lex = buildLexicon(cat);
  const executor = new Executor(app, lex, cat);

  function sceneCtx() {
    const sel = app.selection?.character;
    return {
      characters: app.characters.map((c) => ({ id: c.id, name: c.name, sex: c.sex })),
      animals: (app.animals?.animals || []).map((a) => ({ id: a.id, species: a.species })),
      props: (app.props?.props || []).filter((p) => !p.hold).map((p) => ({ id: p.id, type: p.type.id, label: p.type.label })),
      selected: sel ? { kind: 'character', id: sel.id } : null,
      hasLandscape: !!app.landscapes?.current,
      ...savedCtx(),
    };
  }

  /** Saved items and projects (app.projects, in-memory headers): names for "apri la scena X". */
  function savedCtx() {
    const P = app.projects;
    if (!P?.items) return { saved: [], projects: [] };
    try {
      return {
        saved: P.items({}).map((i) => ({ id: i.id, type: i.type, name: i.name })),
        projects: P.list().map((p) => ({ id: p.id, name: p.name })),
      };
    } catch { return { saved: [], projects: [] }; }
  }

  /** Offline: text -> validated plan {actions, unknown}. */
  function parseOffline(text) {
    const r = parse(text, lex, sceneCtx());
    const plan = normalizePlan({ actions: r.actions, unknown: r.unknown }, cat);
    plan.debug = r.debug;
    return plan;
  }

  /**
   * Understands a command. mode 'hybrid' with an API key and network: Claude first,
   * offline parse on any failure. Returns {plan, source: 'offline'|'cloud', note}.
   */
  async function understand(text, { mode = 'offline', apiKey = '', signal, client } = {}) {
    // verbs on an object of the scene ("siediti sul divano", "prendi il vaso", "apri
    // l'armadio"…): the same actions as the long-press menu (props/actions.js)
    const oa = app.objectActions?.voiceMatch?.(text);
    if (oa) return { plan: { actions: [{ type: 'objectAction' }], unknown: [], objectAction: oa }, source: 'offline' };
    if (mode === 'hybrid' && (apiKey || client)) {
      try {
        const { cloudPlan } = await import('./cloud.js');
        const r = await cloudPlan(text, { apiKey, cat, app, signal, client });
        if (r.ok) {
          const plan = normalizePlan(r.plan, cat);
          if (plan.actions.length || !parseOffline(text).actions.length) return { plan, source: 'cloud', usage: r.usage };
          return { plan: parseOffline(text), source: 'offline', note: 'Claude non ha trovato azioni: uso il riconoscimento offline' };
        }
        if (r.reason === 'aborted') return { plan: parseOffline(text), source: 'offline', note: 'Claude annullato: uso il riconoscimento offline' };
        return { plan: parseOffline(text), source: 'offline', note: r.message ? `${r.message}: uso il riconoscimento offline` : 'Uso il riconoscimento offline' };
      } catch (e) {
        console.warn('[voice] cloud', e);
        return { plan: parseOffline(text), source: 'offline', note: 'Claude non disponibile: uso il riconoscimento offline' };
      }
    }
    return { plan: parseOffline(text), source: 'offline' };
  }

  return { cat, lex, executor, sceneCtx, parseOffline, understand, run: (plan) => (plan.objectAction && app.objectActions ? app.objectActions.voiceRun(plan.objectAction) : executor.run(plan)) };
}
