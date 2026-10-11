import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PSYCH_SCHEMA, VERIFY_SCHEMA, blindOrder, engineFactsFor, labWorkbook, parseVintedCatalog, psychPrompt, readModelJson,
  schemaProblems, scorePsychology, scoreVerification, verifyPrompt,
} from '../src/core/index.js'

const fixture = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8')
const { items } = parseVintedCatalog(fixture('vinted-catalog-2026-10.html'))
const source = { title: 'Nike Air Max 90', brand: 'Nike', size: '40', condition: 'Ottime', price: 30 }

test('lab: the verification prompt carries both listings and asks for the schema; images go reference first', () => {
  const p = verifyPrompt({ id: 'p1', source, candidate: items[0] })
  assert.match(p.text, /Prima immagine: annuncio di riferimento\. Seconda immagine: annuncio candidato/)
  assert.match(p.text, /Annuncio candidato:\n- titolo: Basket Nike Air Max/)
  assert.match(p.text, /- prezzo: 8 €/)
  assert.equal(p.schema, VERIFY_SCHEMA)
  assert.match(p.system, /"same" = stesso modello/)
  assert.match(p.system, /Non inventare/)
})

test('lab: psychology prompt is grounded on the engine numbers of the candidate', () => {
  const facts = engineFactsFor(items[0], {}, new Date('2026-10-11T10:00:00Z'))
  assert.ok(facts && facts.target > 0 && facts.target < items[0].price)
  assert.ok(facts.probability > 0 && facts.probability < 100)
  const p = psychPrompt({ candidate: items[0], facts, label: 'same' })
  assert.match(p.text, /offerta consigliata: 6,50 €/)
  assert.match(p.text, new RegExp(`probabilità stimata che la accetti: ${facts.probability}%`))
  assert.match(p.text, /commissione acquirente 5% \+ 0,70 €/)
  assert.match(p.system, /non inventare numeri/)
  assert.equal(p.schema, PSYCH_SCHEMA)
  // Missing numbers are said, not invented.
  assert.match(psychPrompt({ candidate: { ...items[0], favourites: null }, facts: null }).text, /preferiti: n\.d\./)
})

test('lab: answers are validated the same way for every provider', () => {
  const good = { verdict: 'variant', confidence: 0.7, differences: ['colore'], candidateCondition: 'buone', redFlags: [], reason: 'stesso modello, altro colore' }
  assert.deepEqual(readModelJson(JSON.stringify(good), VERIFY_SCHEMA).problems, [])
  assert.equal(readModelJson('```json\n' + JSON.stringify(good) + '\n```', VERIFY_SCHEMA).ok, true, 'a json fence is tolerated')
  assert.deepEqual(readModelJson('', VERIFY_SCHEMA).problems, ['risposta vuota'])
  assert.deepEqual(readModelJson('Ecco il risultato: {…}', VERIFY_SCHEMA).problems, ['JSON non valido'])
  const bad = readModelJson(JSON.stringify({ ...good, verdict: 'forse', confidence: 1.4, extra: 1 }), VERIFY_SCHEMA).problems
  assert.ok(bad.some((p) => p.includes('"forse"')))
  assert.ok(bad.some((p) => p.includes('fuori da 0–1')))
  assert.ok(bad.some((p) => p.includes('campo non previsto')))
  assert.deepEqual(schemaProblems({ why: 'x', leverage: ['a'], sellerProfile: 'y', risks: [] }, PSYCH_SCHEMA), [])
  assert.ok(schemaProblems({ why: 'x', leverage: 'a', sellerProfile: 'y', risks: [] }, PSYCH_SCHEMA).length === 1)
})

test('lab: verification scores separate the costly false matches from misses and count invalid answers', () => {
  const pairs = [
    { id: 'a', label: 'same' }, { id: 'b', label: 'same' }, { id: 'c', label: 'variant' }, { id: 'd', label: 'different' }, { id: 'e', label: 'different' },
    { id: 'skip', label: null },
  ]
  const run = (modelKey, pairId, verdict, extra = {}) => ({ modelKey, pairId, verdict, ok: verdict != null, costUsd: 0.0004, latencyMs: 1000, ...extra })
  const runs = [
    run('m1', 'a', 'same'), run('m1', 'b', 'same'), run('m1', 'c', 'variant'), run('m1', 'd', 'different'), run('m1', 'e', 'different'),
    run('m2', 'a', 'different'), run('m2', 'b', null, { error: 'JSON non valido' }), run('m2', 'c', 'same'), run('m2', 'd', 'same'), run('m2', 'e', 'different', { latencyMs: 3000 }),
    run('m2', 'skip', 'same'),
  ]
  const [m1, m2] = scoreVerification(runs, pairs)
  assert.equal(m1.modelKey, 'm1')
  assert.equal(m1.accuracy, 1)
  assert.equal(m1.falseMatchRate, 0)
  assert.equal(m2.n, 5, 'unlabelled pairs are ignored')
  assert.equal(m2.validRate, 0.8)
  assert.equal(m2.accuracy, 1 / 5)
  assert.equal(m2.falseMatches, 1)
  assert.equal(m2.falseMatchRate, 0.5)
  assert.equal(m2.misses, 1)
  assert.equal(m2.missRate, 0.5)
  assert.equal(m2.matchAccuracy, 2 / 5, 'c: variant answered same still counts as a match; a: miss; b: invalid')
  assert.equal(m2.confusion.same.none, 1)
  assert.equal(m2.latencyP50, 1000)
  assert.ok(Math.abs(m2.costPerPair - 0.0004) < 1e-12)
})

test('lab: blind letters are shuffled per case, stable for the same seed, and ratings aggregate per model', () => {
  const keys = ['anthropic', 'openai', 'deepseek', 'qwen']
  const a = blindOrder('case-1', keys, 7)
  assert.deepEqual(a, blindOrder('case-1', keys, 7))
  assert.deepEqual(a.map((x) => x.letter), ['A', 'B', 'C', 'D'])
  assert.deepEqual([...a.map((x) => x.modelKey)].sort(), [...keys].sort())
  const orders = new Set(['case-1', 'case-2', 'case-3', 'case-4', 'case-5'].map((c) => blindOrder(c, keys, 7).map((x) => x.modelKey).join(',')))
  assert.ok(orders.size > 1, 'different cases get different orders')
  const scores = scorePsychology([
    { caseId: '1', modelKey: 'a', score: 5 }, { caseId: '1', modelKey: 'b', score: 3, invented: true },
    { caseId: '2', modelKey: 'a', score: 2 }, { caseId: '2', modelKey: 'b', score: 4 },
  ])
  assert.deepEqual(scores.map((s) => s.modelKey), ['a', 'b'])
  assert.equal(scores[0].meanScore, 3.5)
  assert.equal(scores[0].wins, 1)
  assert.equal(scores[1].inventedRate, 0.5)
})

test('lab: the report workbook is a valid zip with the five sheets', () => {
  const bytes = labWorkbook({
    models: { m1: 'Claude Haiku 5.5' },
    verification: scoreVerification([{ modelKey: 'm1', pairId: 'a', verdict: 'same', ok: true, costUsd: 0.0004, latencyMs: 900 }], [{ id: 'a', label: 'same', source: { title: 'A' }, candidate: { title: 'B' } }]),
    psychology: [], runs: [{ task: 'verify', modelKey: 'm1', pairId: 'a', verdict: 'same', costUsd: 0.0004, latencyMs: 900 }],
    pairs: [{ id: 'a', label: 'same', source: { title: 'A' }, candidate: { title: 'B' } }],
    prices: [{ provider: 'Anthropic', model: 'claude-haiku-5-5', input: 0.1, output: 0.5 }],
  })
  assert.ok(bytes instanceof Uint8Array && bytes.length > 1000)
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b)
  const text = new TextDecoder().decode(bytes)
  for (const name of ['Riepilogo', 'Verifiche', 'Psicologia', 'Prezzi', 'Metodo']) assert.ok(text.includes(name), name)
})

test('lab: hostile or odd inputs never throw and never feed NaN to the models', () => {
  // A cheap listing: the engine says no offer is needed, so the prompt has no made-up numbers.
  const cheap = engineFactsFor({ ...items[0], price: 1, total: 1.75 }, {}, new Date('2026-10-11T10:00:00Z'))
  assert.equal(cheap.probability, null)
  const text = psychPrompt({ candidate: { ...items[0], price: 1 }, facts: cheap, label: 'same' }).text
  assert.doesNotMatch(text, /NaN/)
  assert.match(text, /probabilità stimata che la accetti: n\.d\./)
  // A json_object provider answering a bare null is an invalid answer, not a crash.
  for (const raw of ['null', '```json\nnull\n```', '[]', '42']) assert.equal(readModelJson(raw, VERIFY_SCHEMA).ok, false)
})

test('lab: runs that never reached the provider do not count against the model', () => {
  const pairs = [{ id: 'a', label: 'same' }, { id: 'b', label: 'same' }]
  const [row] = scoreVerification([
    { modelKey: 'm', pairId: 'a', ok: true, verdict: 'same', costUsd: 0.001, latencyMs: 4000 },
    { modelKey: 'm', pairId: 'b', ok: false, kind: 'photo', error: 'Foto: rete', costUsd: 0, latencyMs: 0 },
  ], pairs)
  assert.equal(row.n, 1)
  assert.equal(row.validRate, 1)
  assert.equal(row.latencyP50, 4000)
})
