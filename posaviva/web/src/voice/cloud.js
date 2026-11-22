// OPTIONAL cloud understanding with Claude (hybrid mode). Runs ONLY when the
// user entered an Anthropic API key in the voice settings (stored on this device
// only), the device is online and the mode is "ibrida". Any problem (refusal,
// network, key, quota, invalid output) returns {ok: false} and the caller uses
// the offline parse instead.
//
// Official SDK in the browser: new Anthropic({apiKey, dangerouslyAllowBrowser: true}),
// client.messages.parse with structured output (zodOutputFormat of the same plan
// schema the offline parser produces) and effort 'low'. The model always thinks
// (adaptive): no thinking config is sent, no forced tool_choice, no prefill.
// The system prompt holds the instructions + catalog vocabulary (stable, cached with
// cache_control) followed by the current scene summary (after the cache breakpoint,
// so scene changes never invalidate the cached prefix); the command is the user message.
import { makePlanSchema } from './schema.js';

export const CLOUD_MODEL = 'claude-opus-5-5';

const INSTRUCTIONS = `Sei il motore dei comandi vocali di PosaViva, un'app per fumettisti che compone scene 3D di riferimento: personaggi umani in posa e vestiti, animali, oggetti, stanze arredate, edifici, esterni, paesaggi, luci e camera.
Ricevi la scena attuale e un comando in italiano (spesso dettato a voce: può contenere errori di trascrizione, parole colloquiali o refusi). Traduci il comando in un piano di azioni che usa SOLO gli id del vocabolario qui sotto.

Regole:
- Un'azione per ogni cosa da creare o modificare, nell'ordine in cui vanno eseguite: crea prima gli oggetti che servono da riferimento (es. il divano prima dell'uomo seduto sul divano).
- Per riferirti a qualcosa creato da un'azione precedente dello stesso piano usa target {kind:"new", index:i} (i = indice da 0 dell'azione).
- Per le cose già in scena usa gli id del riepilogo (kind character/animal/prop con id). "lui"/"lei"/"lo"/"la" = l'ultimo soggetto nominato (kind "it") o il personaggio selezionato.
- Articolo determinativo ("il divano", "la donna") = una cosa già esistente se c'è; altrimenti creala.
- sinistra/destra sono quelle di chi guarda lo schermo; davanti/dietro rispetto al fronte del bersaglio.
- "seduto su X" = place {relation:"seat", target:X} con una posa seduta; "sul letto" per animali o oggetti = relation "on"; "in mano" = relation "hand".
- Stanze pronte (addRoom) per "una cucina", "un soggiorno"...; paesaggi (landscape) per ambientazioni esterne con ora, meteo e stagione; luci (lights) per "luce da tramonto", "fai notte".
- Inquadrature: camera.angle (dal basso = low, dall'alto = high, zenitale = top, di profilo = side, 3/4 = threeq, da dietro = back, altezza occhi = eye, frontale = front), camera.focal in mm (grandangolo 24, tele 135), camera.framing (face = primo piano, body/subject = figura intera, all = tutta la scena).
- Colori sempre in esadecimale #rrggbb (bianco #f2f1ec, nero #1c1c1f, rosso #c0392b, blu #2c4f9e, verde #2e8b57, giallo #f1c40f, grigio #86888c, marrone #6b4423, rosa #e88aa8, viola #6a3a9e, beige #d8c3a5, azzurro #5dade2, arancione #e67e22).
- Se una parte del comando non è eseguibile con il vocabolario, NON inventare id: mettila in "unknown" (brevi frammenti in italiano). Se non capisci nulla, restituisci actions vuoto e il comando in unknown.
- Non aggiungere cose non richieste.`;

/** Compact, deterministic vocabulary text (cached part of the system prompt). */
export function vocabularyText(cat) {
  const line = (arr, f = (x) => `${x.id}: ${x.label}`) => (arr || []).map(f).join('\n');
  const parts = [];
  parts.push('## Corporature (bodyType)\nslim: magra/o\nnormal: normale\ncurvy: curvy (donna) / robusto (uomo)');
  parts.push('## Capi (outfit.garment)\n' + line(cat.garments, (g) => `${g.id}: ${g.label}${g.sex === 'F' ? ' (solo donna)' : ''}`));
  parts.push('## Capelli (hair.style)\n' + line(cat.hairStyles));
  parts.push('## Barba (hair.beard)\n' + line(cat.beards));
  parts.push('## Colori capelli (hair.color)\n' + line(cat.hairColors, (c) => `${c.hex}: ${c.label}`));
  parts.push('## Pose dei personaggi (pose)\n' + line(cat.poses, (p) => `${p.id}: ${p.label}${p.seat ? ` (seduta, altezza ${p.seat} m)` : ''}`));
  parts.push('## Espressioni (expression)\n' + line(cat.expressions));
  parts.push('## Animali (species) e loro pose\n' + line(cat.animals, (a) => `${a.id}: ${a.label}${a.sub ? ' (' + a.sub + ')' : ''} | pose: ${(a.poses || []).map((p) => p.id).join(', ')}`));
  parts.push('## Stanze pronte (addRoom.preset)\n' + line(cat.rooms));
  parts.push('## Paesaggi (landscape.spec.preset)\n' + line((cat.landscapes || []).filter((l) => l.group !== 'stanze')));
  parts.push('## Luci (lights.preset)\n' + line(cat.lights));
  parts.push('## Angolazioni camera (camera.angle)\n' + line(cat.angles));
  const byCat = new Map();
  for (const p of cat.props || []) { if (!byCat.has(p.cat)) byCat.set(p.cat, []); byCat.get(p.cat).push(p); }
  const catLabel = new Map((cat.categories || []).map((c) => [c.id, c.label]));
  const propLines = [];
  for (const [c, list] of [...byCat].sort((a, b) => a[0].localeCompare(b[0]))) {
    propLines.push(`[${catLabel.get(c) || c}]${c === 'mano' ? ' (oggetti da tenere in mano)' : ''}`);
    for (const p of list) propLines.push(`${p.id}: ${p.label}`);
  }
  parts.push('## Oggetti, edifici ed esterni (addProp.propType)\n' + propLines.join('\n'));
  return parts.join('\n\n');
}

/** Short scene summary for the user message (ids the model may reference). */
export function sceneSummary(app) {
  const r = (v) => Math.round(v * 100) / 100;
  const lines = [];
  const sel = app.selection?.character;
  for (const c of app.characters || []) lines.push(`personaggio id=${c.id} nome="${c.name}" sesso=${c.sex} corporatura=${c.presetId?.split('_')[1] || ''} pos=(${r(c.root.position.x)}, ${r(c.root.position.z)})${c === sel ? ' [selezionato]' : ''}`);
  for (const a of app.animals?.animals || []) lines.push(`animale id=${a.id} specie=${a.species} pos=(${r(a.root.position.x)}, ${r(a.root.position.z)})`);
  const props = (app.props?.props || []).filter((p) => !p.hold).slice(-80);
  for (const p of props) lines.push(`oggetto id=${p.id} tipo=${p.type.id} "${p.type.label}" pos=(${r(p.root.position.x)}, ${r(p.root.position.z)})${p.group ? ' gruppo=' + p.group : ''}`);
  if (app.landscapes?.current) lines.push(`paesaggio=${app.landscapes.current.spec?.preset || app.landscapes.current.resolved?.preset || 'sì'}`);
  return lines.length ? lines.join('\n') : '(scena vuota)';
}

/**
 * Asks Claude for a plan. opts: {apiKey, cat, app, signal, client (tests: a mock with
 * messages.parse)}. Returns {ok: true, plan, usage} or {ok: false, reason, message}.
 */
export async function cloudPlan(text, opts = {}) {
  const { apiKey, cat, signal } = opts;
  if (!apiKey && !opts.client) return { ok: false, reason: 'nokey' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !opts.client) return { ok: false, reason: 'offline', message: 'Sei offline' };
  let Anthropic, zodOutputFormat;
  try {
    ({ zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod'));
    if (!opts.client) Anthropic = (await import('@anthropic-ai/sdk')).default;
  } catch (e) { return { ok: false, reason: 'sdk', message: String(e?.message || e) }; }
  const client = opts.client || new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 45000 });
  const schema = makePlanSchema(cat);
  const summary = opts.summary ?? (opts.app ? sceneSummary(opts.app) : '(scena vuota)');
  // stable part (instructions + vocabulary) cached; the scene summary follows the breakpoint
  const system = [
    { type: 'text', text: INSTRUCTIONS + '\n\n# Vocabolario\n\n' + vocabularyText(cat), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: '# Scena attuale\n' + summary },
  ];
  let msg;
  try {
    msg = await client.messages.parse({
      model: CLOUD_MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: `Comando: ${text}` }],
      output_config: { format: zodOutputFormat(schema), effort: 'low' },
    }, signal ? { signal } : undefined);
  } catch (e) {
    return { ok: false, reason: errorReason(e, Anthropic), message: errorMessage(e, Anthropic) };
  }
  if (msg?.stop_reason === 'refusal') return { ok: false, reason: 'refusal', message: 'Claude ha rifiutato la richiesta' };
  if (msg?.stop_reason === 'max_tokens') return { ok: false, reason: 'truncated', message: 'Risposta incompleta' };
  const plan = msg?.parsed_output;
  if (!plan || !Array.isArray(plan.actions)) return { ok: false, reason: 'invalid', message: 'Risposta non valida' };
  return { ok: true, plan, usage: msg.usage || null };
}

// Typed SDK errors (most specific first); anything else (network, abort) -> offline.
function errorReason(e, Anthropic) {
  if (e?.name === 'AbortError' || e?.constructor?.name === 'APIUserAbortError') return 'aborted';
  const A = Anthropic || {};
  if (A.AuthenticationError && e instanceof A.AuthenticationError) return 'auth';
  if (A.PermissionDeniedError && e instanceof A.PermissionDeniedError) return 'auth';
  if (A.RateLimitError && e instanceof A.RateLimitError) return 'ratelimit';
  if (A.BadRequestError && e instanceof A.BadRequestError) return 'badrequest';
  if (A.APIConnectionError && e instanceof A.APIConnectionError) return 'network';
  if (A.APIError && e instanceof A.APIError) return 'api';
  if (e?.status === 401 || e?.status === 403) return 'auth';
  if (e?.status === 429) return 'ratelimit';
  return 'network';
}
function errorMessage(e, Anthropic) {
  const r = errorReason(e, Anthropic);
  return {
    aborted: 'Annullato', auth: 'Chiave API non valida', ratelimit: 'Troppe richieste a Claude, riprova tra poco', badrequest: 'Richiesta non accettata da Claude',
    network: 'Claude non raggiungibile', api: 'Errore del servizio Claude',
  }[r] || 'Errore';
}
