// Unit test of the cloud path with a MOCKED Anthropic client (no network, no key):
//   node posaviva/web/src/voice/test/cloud.test.mjs
// Checks the request shape (model, structured output with the zod plan schema,
// effort 'low', cached system prompt, no thinking / tool_choice / prefill), the
// refusal and error fallbacks, and that offline plans validate against the same schema.
import assert from 'node:assert/strict';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { cloudPlan, CLOUD_MODEL, vocabularyText } from '../cloud.js';
import { makePlanSchema } from '../schema.js';
import { normalizePlan } from '../plan.js';
import { buildLexicon } from '../vocab.js';
import { parse } from '../parser.js';

const cat = {
  presets: [{ id: 'f_normal', label: 'Normale', sex: 'F' }, { id: 'm_normal', label: 'Normale', sex: 'M' }],
  garments: [{ id: 'tshirt', label: 'T-shirt' }, { id: 'jeans', label: 'Jeans' }, { id: 'sweatshirt', label: 'Felpa' }],
  hairStyles: [{ id: 'coda', label: 'Coda di cavallo' }], beards: [{ id: 'piena', label: 'Barba piena' }], hairColors: [{ id: 'biondo', label: 'Biondo', hex: '#d0aa68' }],
  poses: [{ id: 'sit_chair', label: 'Sedia composta', seat: 0.45 }, { id: 'sit_relaxed', label: 'Sedia rilassata', seat: 0.45 }, { id: 'run', label: 'Corsa' }],
  expressions: [{ id: 'smile', label: 'Sorriso' }],
  animals: [{ id: 'cane_medio', label: 'Cane medio', poses: [{ id: 'stand', label: 'In piedi' }, { id: 'sit', label: 'Seduto' }] }, { id: 'gatto', label: 'Gatto', poses: [{ id: 'stand', label: 'In piedi' }] }],
  props: [{ id: 'divano', label: 'Divano', cat: 'sedute', tags: 'divano sofà' }, { id: 'letto', label: 'Letto', cat: 'letti', tags: 'letto' }, { id: 'tavolo', label: 'Tavolo', cat: 'tavoli', tags: '' }, { id: 'sedia', label: 'Sedia', cat: 'sedute', tags: '' }],
  categories: [{ id: 'sedute', label: 'Sedute' }, { id: 'letti', label: 'Letti' }, { id: 'tavoli', label: 'Tavoli' }],
  rooms: [{ id: 'cucina', label: 'Cucina', items: ['tavolo'] }], landscapes: [{ id: 'strada', label: 'Strada di città', group: 'citta', tags: [] }],
  lights: [{ id: 'sunset', label: 'Tramonto caldo' }], angles: [{ id: 'low', label: 'Dal basso' }, { id: 'high', label: "Dall'alto" }],
};

const GOOD_PLAN = {
  actions: [
    { type: 'addProp', propType: 'divano' },
    { type: 'addCharacter', sex: 'M', outfit: [{ garment: 'tshirt', color: '#f2f1ec' }], pose: 'sit_relaxed', place: { relation: 'seat', target: { kind: 'new', index: 0 } } },
    { type: 'addAnimal', species: 'cane_medio', place: { relation: 'beside', target: { kind: 'new', index: 1 } } },
  ],
  unknown: [],
};

function mockClient(reply, calls) {
  return { messages: { parse: async (params, opts) => { calls.push({ params, opts }); if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply(params) : reply; } } };
}

let n = 0;
const ok = (name) => { n++; console.log('ok', n, name); };

// 1. request shape + parsed plan
{
  const calls = [];
  const fmt = zodOutputFormat(makePlanSchema(cat));
  const client = mockClient((params) => ({ stop_reason: 'end_turn', parsed_output: params.output_config.format.parse(JSON.stringify(GOOD_PLAN)), usage: { input_tokens: 10, output_tokens: 20 } }), calls);
  const r = await cloudPlan('metti un uomo con una maglietta bianca seduto sul divano con un cane accanto', { client, cat, summary: '(scena vuota)' });
  assert.equal(r.ok, true);
  const p = calls[0].params;
  assert.equal(p.model, CLOUD_MODEL);
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(typeof p.output_config.format.parse, 'function');
  assert.deepEqual(Object.keys(p.output_config.format.schema).sort(), Object.keys(fmt.schema).sort());
  assert.ok(!('thinking' in p), 'no thinking config');
  assert.ok(!('tool_choice' in p) && !('tools' in p), 'no tools / forced tool choice');
  assert.equal(p.messages.length, 1);
  assert.equal(p.messages[0].role, 'user', 'no assistant prefill');
  assert.ok(p.messages[0].content.includes('Comando: metti un uomo'));
  assert.ok(Array.isArray(p.system) && p.system[0].cache_control?.type === 'ephemeral', 'system prompt cached');
  assert.ok(p.system[1].text.includes('Scena attuale') && !p.system[1].cache_control, 'scene summary after the cache breakpoint');
  assert.ok(p.system[0].text.includes('divano: Divano') && p.system[0].text.includes('cane_medio: Cane medio'), 'vocabulary in the system prompt');
  const plan = normalizePlan(r.plan, cat);
  assert.equal(plan.actions.length, 3);
  assert.equal(plan.actions[1].place.target.index, 0);
  ok('request shape, structured output, plan');
}
// 2. refusal -> fallback signal
{
  const r = await cloudPlan('x', { client: mockClient({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, parsed_output: null, content: [] }, []), cat, summary: '' });
  assert.equal(r.ok, false); assert.equal(r.reason, 'refusal');
  ok('refusal -> offline');
}
// 3. network / API errors -> fallback signal
for (const [err, reason] of [[Object.assign(new Error('fetch failed'), { name: 'TypeError' }), 'network'], [Object.assign(new Error('unauthorized'), { status: 401 }), 'auth'], [Object.assign(new Error('rate'), { status: 429 }), 'ratelimit']]) {
  const r = await cloudPlan('x', { client: mockClient(err, []), cat, summary: '' });
  assert.equal(r.ok, false); assert.equal(r.reason, reason);
  ok('error -> ' + reason);
}
// 4. truncated / invalid output
{
  let r = await cloudPlan('x', { client: mockClient({ stop_reason: 'max_tokens', parsed_output: null }, []), cat, summary: '' });
  assert.equal(r.reason, 'truncated');
  r = await cloudPlan('x', { client: mockClient({ stop_reason: 'end_turn', parsed_output: null }, []), cat, summary: '' });
  assert.equal(r.reason, 'invalid');
  ok('truncated / invalid -> offline');
}
// 5. never without a key (and no injected client)
{
  const r = await cloudPlan('x', { cat });
  assert.equal(r.ok, false); assert.equal(r.reason, 'nokey');
  ok('no key -> no request');
}
// 6. the schema rejects ids outside the catalog; normalizePlan reports them
{
  const fmt = zodOutputFormat(makePlanSchema(cat));
  assert.throws(() => fmt.parse(JSON.stringify({ actions: [{ type: 'addAnimal', species: 'unicorno_rosa' }], unknown: [] })));
  const plan = normalizePlan({ actions: [{ type: 'addProp', propType: 'astronave' }, { type: 'addRoom', preset: 'castello' }], unknown: [] }, cat);
  assert.equal(plan.actions.length, 1); // the prop survives as a query, the room is dropped
  assert.ok(plan.unknown.includes('castello'));
  ok('catalog ids enforced');
}
// 7. offline plans conform to the same schema
{
  const lex = buildLexicon(cat);
  const fmt = zodOutputFormat(makePlanSchema(cat));
  for (const t of ['metti un uomo con una maglietta bianca seduto sul divano con un cane accanto', 'metti un gatto sul letto', 'inquadra dal basso', 'luce da tramonto', 'aggiungi una donna in jeans e felpa nera che corre', 'voglio una cucina']) {
    const r = parse(t, lex, { characters: [], animals: [], props: [] });
    const plan = normalizePlan({ actions: r.actions, unknown: r.unknown }, cat);
    assert.ok(plan.actions.length > 0, t);
    fmt.parse(JSON.stringify(plan)); // throws if the offline plan does not match the cloud schema
  }
  ok('offline plans validate against the zod schema');
}
// 8. project commands (Progetti): split off before the scene parser, valid plans
{
  const lex = buildLexicon(cat);
  const fmt = zodOutputFormat(makePlanSchema(cat));
  const scene = { characters: [{ id: 'c1', name: 'Donna 1', sex: 'F' }], animals: [], props: [], saved: [{ id: 'i1', type: 'scene', name: 'Inseguimento' }, { id: 'i2', type: 'pose', name: 'Saluto' }], projects: [{ id: 'p1', name: 'Noir' }] };
  const want = {
    'salva la scena come Fuga nel progetto Noir, tavola 3': { op: 'save', what: 'scene', name: 'Fuga', project: 'Noir', section: 'Tavola 3', sectionKind: 'tavola' },
    'apri la scena Inseguimento': { op: 'open', what: 'scene', name: 'Inseguimento' },
    'applica la posa Saluto alla donna': { op: 'open', what: 'pose', name: 'Saluto' },
    'apri i progetti': { op: 'browse' },
  };
  for (const [t, w] of Object.entries(want)) {
    const r = parse(t, lex, scene);
    const plan = normalizePlan({ actions: r.actions, unknown: r.unknown }, cat);
    assert.equal(plan.actions.length, 1, t);
    for (const [k, v] of Object.entries(w)) assert.equal(plan.actions[0][k], v, `${t}: ${k}`);
    fmt.parse(JSON.stringify(plan));
  }
  // a save after scene actions stays last; "metti una posa" without a saved item is not a project command
  const r = parse('metti un uomo e salva la scena come Uomo', lex, scene);
  assert.equal(r.actions[r.actions.length - 1].type, 'project');
  assert.equal(r.actions[0].type, 'addCharacter');
  assert.ok(!parse('metti una sedia', lex, scene).actions.some((a) => a.type === 'project'));
  ok('project commands');
}
assert.ok(vocabularyText(cat).length > 200);
console.log(`\n${n} cloud tests passed`);
