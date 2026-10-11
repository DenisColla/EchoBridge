/**
 * AI lab: the provider-neutral half of the model test the user runs on the phone.
 *  - the two tasks (photo verification, seller psychology) with their prompts and JSON schemas;
 *  - a validator for the answers (every provider is checked the same way, whatever it enforces);
 *  - scoring against the user's labels (accuracy, false matches, cost, latency, valid-JSON rate);
 *  - the blind comparison of the psychology texts (shuffled letters, ratings by the user);
 *  - the Excel report.
 * The HTTP shapes of each provider live in llm.js; the calls themselves are made by the app.
 */

import { analyzeOffer } from './analyze.js'
import { buildFormFromExtraction } from './extract.js'
import { formatEuro } from './messages.js'
import { XLSX_FORMATS, buildXlsx } from './xlsx.js'

export const LAB_VERSION = 1

/** User labels for a pair (reference listing, candidate). */
export const PAIR_LABELS = [
  { id: 'same', label: 'Stesso', hint: 'Stesso modello, stessa edizione, taglia e colore' },
  { id: 'variant', label: 'Variante', hint: 'Stesso modello ma colore, taglia, edizione o versione diversa' },
  { id: 'different', label: 'Diverso', hint: 'Un altro prodotto' },
]
const LABEL_IDS = PAIR_LABELS.map((l) => l.id)

/* ───────── task 1: photo verification ───────── */

export const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: LABEL_IDS },
    confidence: { type: 'number' },
    differences: { type: 'array', items: { type: 'string' } },
    candidateCondition: { type: 'string' },
    redFlags: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['verdict', 'confidence', 'differences', 'candidateCondition', 'redFlags', 'reason'],
  additionalProperties: false,
}

const VERIFY_SYSTEM = [
  'Sei un perito di articoli usati. Confronti un annuncio di riferimento con un annuncio candidato e decidi se vendono lo stesso prodotto.',
  'Definizioni: "same" = stesso modello e stessa versione (edizione, taglia, colore, capacità); "variant" = stesso modello ma una di queste caratteristiche diversa; "different" = un altro prodotto.',
  'Usa solo ciò che vedi nelle foto e leggi nei testi. Se le foto non bastano, dillo in reason e abbassa confidence. Non inventare dettagli.',
  'confidence è un numero tra 0 e 1. differences elenca le differenze concrete (massimo 4). candidateCondition descrive lo stato del candidato visibile in foto, in poche parole.',
  'redFlags elenca segnali di rischio concreti (foto prese dal web, prezzo incoerente, articolo diverso dal titolo, richiesta di pagamenti esterni), altrimenti lista vuota.',
  'Rispondi solo con un oggetto JSON conforme allo schema, in italiano, senza testo fuori dal JSON.',
].join('\n')

const listingText = (who, l) => [
  `${who}:`,
  `- titolo: ${l.title || 'n.d.'}`,
  `- marca: ${l.brand || 'n.d.'}`,
  `- taglia/misura: ${l.size || 'n.d.'}`,
  `- condizioni dichiarate: ${l.condition || 'n.d.'}`,
  `- prezzo: ${l.price != null ? formatEuro(l.price) : 'n.d.'}`,
].join('\n')

/** Prompt of the verification call. The app attaches two images in this order: reference, candidate. */
export function verifyPrompt(pair) {
  return {
    system: VERIFY_SYSTEM,
    text: [
      'Prima immagine: annuncio di riferimento. Seconda immagine: annuncio candidato.',
      listingText('Annuncio di riferimento', pair.source),
      listingText('Annuncio candidato', pair.candidate),
      'Restituisci il JSON richiesto.',
    ].join('\n\n'),
    schema: VERIFY_SCHEMA,
    schemaName: 'verifica_annuncio',
  }
}

/* ───────── task 2: seller psychology (grounded on the engine's numbers) ───────── */

export const PSYCH_SCHEMA = {
  type: 'object',
  properties: {
    why: { type: 'string' },
    leverage: { type: 'array', items: { type: 'string' } },
    sellerProfile: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['why', 'leverage', 'sellerProfile', 'risks'],
  additionalProperties: false,
}

const PSYCH_SYSTEM = [
  'Aiuti un acquirente italiano a comprare un articolo usato al prezzo più basso possibile, in modo onesto: niente bugie al venditore, niente pressioni scorrette.',
  'Ricevi i dati di un annuncio e i numeri calcolati da un motore statistico (probabilità, prezzo e momento consigliati).',
  'Regole: usa solo i dati forniti; non inventare numeri, recensioni o storia del venditore; se un dato manca, dillo; non cambiare i numeri del motore.',
  'why: perché conviene questo annuncio e questo canale (massimo 3 frasi). leverage: da 1 a 3 leve di trattativa concrete basate sui dati. sellerProfile: cosa dicono i segnali sul venditore e quanto è probabile che tratti (massimo 2 frasi). risks: da 0 a 3 rischi concreti.',
  'Rispondi solo con un oggetto JSON conforme allo schema, in italiano.',
].join('\n')

/** The engine numbers for a candidate: the same analysis the app shows, from the fields a search result carries. */
export function engineFactsFor(candidate, source = {}, now = new Date()) {
  const ex = {
    title: candidate.title, listPrice: candidate.price, brand: candidate.brand, condition: candidate.condition,
    categoryText: source.categoryText || null, description: null,
    uploadedDays: candidate.uploadedDays ?? null, uploadedText: candidate.uploadedText ?? null,
    sellerLastSeenDays: candidate.sellerLastSeenDays ?? null, sellerLastSeenText: null,
    sellerFeedbackCount: candidate.sellerFeedbackCount ?? null, sellerRating: candidate.sellerRating ?? null,
    sellerBusiness: candidate.sellerBusiness, sellerBadges: [], sellerUsername: null,
  }
  const { form } = buildFormFromExtraction(ex, { link: candidate.url || '' })
  const result = analyzeOffer(form, now)
  if (!result || !result.ok) return null
  if (result.kind !== 'analysis' || !Number.isFinite(result.probability)) {
    // Cheap listings ('no_offer_needed') or a target over Vinted's cap: no engine numbers to pass on.
    return { listPrice: candidate.price, buyerTotal: candidate.total, target: null, discountPct: null, probability: null, sendAt: null, sendLabel: null, note: result.message || null }
  }
  return {
    listPrice: candidate.price,
    buyerTotal: candidate.total,
    target: result.input ? result.input.targetPrice : null,
    discountPct: result.input ? Math.round(result.input.discountPct) : null,
    probability: Math.round(result.probability * 100),
    sendAt: result.optimal && result.optimal.date ? result.optimal.date.toISOString() : null,
    sendLabel: result.verdict ? [result.verdict.when, result.verdict.timeLabel].filter(Boolean).join(', ') || null : null,
  }
}

/** Prompt of the psychology call for one case. */
export function psychPrompt(caseItem) {
  const c = caseItem.candidate
  const f = caseItem.facts || {}
  const lines = [
    `Canale: ${c.source === 'vinted' ? 'Vinted (offerte fino al 40% sotto il prezzo, al massimo 25 offerte al giorno; commissione acquirente 5% + 0,70 € già nel totale)' : c.source || 'n.d.'}`,
    listingText('Annuncio', c),
    `- totale con commissione: ${c.total != null ? formatEuro(c.total) : 'n.d.'}`,
    `- preferiti: ${c.favourites != null ? c.favourites : 'n.d.'}`,
    `- venditore professionale: ${c.sellerBusiness == null ? 'n.d.' : c.sellerBusiness ? 'sì' : 'no'}`,
    `- annuncio in evidenza a pagamento: ${c.promoted ? 'sì' : 'no'}`,
    `- verifica foto rispetto all'articolo cercato: ${caseItem.label === 'same' ? 'stesso prodotto' : caseItem.label === 'variant' ? 'variante dello stesso modello' : 'n.d.'}`,
    'Numeri del motore:',
    `- offerta consigliata: ${Number.isFinite(f.target) ? formatEuro(f.target) : 'n.d.'}${Number.isFinite(f.discountPct) ? ` (−${f.discountPct}%)` : ''}`,
    `- probabilità stimata che la accetti: ${Number.isFinite(f.probability) ? `${f.probability}%` : 'n.d.'}`,
    `- momento consigliato: ${f.sendLabel || 'n.d.'}`,
  ]
  if (f.note) lines.push(`- nota del motore: ${f.note}`)
  return { system: PSYCH_SYSTEM, text: lines.join('\n'), schema: PSYCH_SCHEMA, schemaName: 'analisi_trattativa' }
}

/* ───────── answer validation (same check for every provider) ───────── */

/** Validates `value` against the small JSON-schema subset used above. Returns a list of problems (empty = valid). */
export function schemaProblems(value, schema, path = '$') {
  const problems = []
  const type = schema.type
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: atteso un oggetto`]
    for (const key of schema.required || []) if (!(key in value)) problems.push(`${path}.${key}: mancante`)
    for (const [key, v] of Object.entries(value)) {
      const sub = schema.properties && schema.properties[key]
      if (!sub) {
        if (schema.additionalProperties === false) problems.push(`${path}.${key}: campo non previsto`)
        continue
      }
      problems.push(...schemaProblems(v, sub, `${path}.${key}`))
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) return [`${path}: attesa una lista`]
    value.forEach((v, i) => problems.push(...schemaProblems(v, schema.items || {}, `${path}[${i}]`)))
  } else if (type === 'string') {
    if (typeof value !== 'string') problems.push(`${path}: atteso un testo`)
    else if (schema.enum && !schema.enum.includes(value)) problems.push(`${path}: "${value}" non è tra ${schema.enum.join('/')}`)
  } else if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) problems.push(`${path}: atteso un numero`)
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') problems.push(`${path}: atteso vero/falso`)
  }
  return problems
}

/** Parses a model's text as JSON (tolerating a ```json fence) and validates it. */
export function readModelJson(text, schema) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (!raw) return { ok: false, value: null, problems: ['risposta vuota'] }
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, value: null, problems: ['JSON non valido'] }
  }
  const problems = schemaProblems(value, schema)
  if (schema === VERIFY_SCHEMA && value && typeof value === 'object' && typeof value.confidence === 'number' && (value.confidence < 0 || value.confidence > 1)) problems.push('$.confidence: fuori da 0–1')
  return { ok: problems.length === 0, value, problems }
}

/* ───────── scoring ───────── */

/** Failure kinds that are not the model's answer: they are shown in the progress but never stored or scored. */
export const NOT_MODEL_KINDS = ['photo', 'cancelled', 'network', 'auth', 'balance', 'rate', 'server']

const quantile = (values, q) => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

/**
 * Scores verification runs. `runs` = [{ modelKey, pairId, verdict|null, ok, error, costUsd, latencyMs }], `pairs` =
 * labelled pairs. Per model: answered/valid rate, 3-class accuracy, match accuracy (same/variant vs different),
 * false matches (labelled different, answered same: the costly error), misses (labelled same, answered different),
 * confusion matrix, cost per pair and latency p50/p90.
 */
export function scoreVerification(runs, pairs) {
  const labelOf = new Map(pairs.filter((p) => LABEL_IDS.includes(p.label)).map((p) => [p.id, p.label]))
  const byModel = new Map()
  for (const r of runs) {
    // Runs that failed for reasons outside the model (photo, network, key, balance, limits) say nothing about it.
    if (!labelOf.has(r.pairId) || NOT_MODEL_KINDS.includes(r.kind)) continue
    if (!byModel.has(r.modelKey)) byModel.set(r.modelKey, [])
    byModel.get(r.modelKey).push(r)
  }
  const rows = []
  for (const [modelKey, list] of byModel) {
    const confusion = Object.fromEntries(LABEL_IDS.map((t) => [t, Object.fromEntries([...LABEL_IDS, 'none'].map((p) => [p, 0]))]))
    let valid = 0
    let exact = 0
    let match = 0
    let falseMatch = 0
    let different = 0
    let miss = 0
    let same = 0
    let cost = 0
    const latencies = []
    for (const r of list) {
      const truth = labelOf.get(r.pairId)
      const answer = r.ok && LABEL_IDS.includes(r.verdict) ? r.verdict : null
      confusion[truth][answer || 'none']++
      if (answer) valid++
      if (answer === truth) exact++
      if (answer && (answer === 'different') === (truth === 'different')) match++
      if (truth === 'different') { different++; if (answer === 'same') falseMatch++ }
      if (truth === 'same') { same++; if (answer === 'different') miss++ }
      if (Number.isFinite(r.costUsd)) cost += r.costUsd
      if (Number.isFinite(r.latencyMs) && r.latencyMs > 0) latencies.push(r.latencyMs)
    }
    const n = list.length
    rows.push({
      modelKey, n, valid, validRate: n ? valid / n : null,
      accuracy: n ? exact / n : null, matchAccuracy: n ? match / n : null,
      falseMatchRate: different ? falseMatch / different : null, falseMatches: falseMatch, differentPairs: different,
      missRate: same ? miss / same : null, misses: miss, samePairs: same,
      costUsd: cost, costPerPair: n ? cost / n : null,
      latencyP50: quantile(latencies, 0.5), latencyP90: quantile(latencies, 0.9),
      confusion,
    })
  }
  // Finding the right article (same or variant vs different) is what the search needs; exact labels break ties.
  return rows.sort((a, b) => (b.matchAccuracy ?? -1) - (a.matchAccuracy ?? -1) || (b.accuracy ?? -1) - (a.accuracy ?? -1) || (a.costPerPair ?? 9) - (b.costPerPair ?? 9))
}

/**
 * Pairs to look at again: at least `minAnswers` models answered and every one of them contradicts the label on the
 * question that matters (same article — same or variant — versus different). Usually a wrong reference or a slip
 * in labelling, not four models wrong together. `runs` = latest verify run per (model, pair).
 */
export function pairsToRecheck(runs, pairs, minAnswers = 3) {
  const labelOf = new Map(pairs.filter((p) => LABEL_IDS.includes(p.label)).map((p) => [p.id, p.label]))
  const answers = new Map()
  for (const r of runs) {
    if (!labelOf.has(r.pairId) || !r.ok || !LABEL_IDS.includes(r.verdict)) continue
    if (!answers.has(r.pairId)) answers.set(r.pairId, [])
    answers.get(r.pairId).push(r.verdict)
  }
  const out = []
  for (const [pairId, list] of answers) {
    const labelMatch = labelOf.get(pairId) !== 'different'
    if (list.length >= minAnswers && list.every((v) => (v !== 'different') !== labelMatch)) out.push(pairId)
  }
  return out
}

/* ───────── blind comparison of the psychology texts ───────── */

/** Small deterministic PRNG so a round's letters stay stable when the screen is reopened. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hashString = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Letters A, B, C… assigned to the models of one case in a shuffled, seeded order. */
export function blindOrder(caseId, modelKeys, seed = 1) {
  const rand = mulberry32(hashString(`${caseId}|${seed}`))
  // Sorted first: the letters depend only on which models answered, not on the order their runs were stored in.
  const order = [...modelKeys].sort()
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order.map((modelKey, i) => ({ letter: String.fromCharCode(65 + i), modelKey }))
}

/**
 * Aggregates the user's ratings. `ratings` = [{ caseId, modelKey, score 1–5, invented: boolean }].
 * Per model: mean score, how often it was the best of its case, and how often it invented data.
 */
export function scorePsychology(ratings) {
  const byCase = new Map()
  for (const r of ratings) {
    if (!byCase.has(r.caseId)) byCase.set(r.caseId, [])
    byCase.get(r.caseId).push(r)
  }
  const stats = new Map()
  const get = (k) => {
    if (!stats.has(k)) stats.set(k, { modelKey: k, n: 0, sum: 0, wins: 0, invented: 0 })
    return stats.get(k)
  }
  for (const list of byCase.values()) {
    const best = Math.max(...list.map((r) => r.score || 0))
    for (const r of list) {
      const s = get(r.modelKey)
      s.n++
      s.sum += r.score || 0
      if (r.invented) s.invented++
      if (best > 0 && r.score === best) s.wins++
    }
  }
  return [...stats.values()]
    .map((s) => ({ modelKey: s.modelKey, n: s.n, meanScore: s.n ? s.sum / s.n : null, wins: s.wins, inventedRate: s.n ? s.invented / s.n : null }))
    .sort((a, b) => (b.meanScore ?? 0) - (a.meanScore ?? 0))
}

/* ───────── Excel report ───────── */

const pctCell = (v) => (v == null ? '' : { value: v, format: XLSX_FORMATS.pct })
/** Costs of a single call are fractions of a cent: general format, six decimals. */
const usdCell = (v) => (v == null || !Number.isFinite(v) ? '' : Math.round(v * 1e6) / 1e6)

/** Workbook bytes for the lab results. `models` maps modelKey → label. */
export function labWorkbook({ generatedAt = new Date(), models = {}, verification = [], psychology = [], runs = [], pairs = [], ratings = [], prices = [], method = [], recheck = [] }) {
  const name = (k) => models[k] || k
  const pairById = new Map(pairs.map((p) => [p.id, p]))
  const toRecheck = new Set(recheck)
  const references = new Set(pairs.map((p) => (p.source && (p.source.id || p.source.title)) || '')).size
  const sheets = [
    {
      name: 'Riepilogo',
      columns: [{ width: 26 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 12 }],
      rows: [
        ['Verifica delle foto'],
        ['Modello', 'Coppie', 'JSON valido', 'Trova l\'articolo', 'Esatte (3 classi)', 'Falsi "stesso"', 'Mancati', 'Costo per coppia $', 'Latenza p50 s', 'Latenza p90 s'],
        ...verification.map((v) => [name(v.modelKey), v.n, pctCell(v.validRate), pctCell(v.matchAccuracy), pctCell(v.accuracy), pctCell(v.falseMatchRate), pctCell(v.missRate), usdCell(v.costPerPair), v.latencyP50 != null ? v.latencyP50 / 1000 : '', v.latencyP90 != null ? v.latencyP90 / 1000 : '']),
        ['Annunci di riferimento', references],
        ['Coppie da ricontrollare (tutti i modelli contro l\'etichetta)', toRecheck.size],
        [],
        ['Psicologia (giudizio alla cieca)'],
        ['Modello', 'Valutazioni', 'Voto medio 1–5', 'Volte migliore', 'Dati inventati'],
        ...psychology.map((p) => [name(p.modelKey), p.n, p.meanScore != null ? Math.round(p.meanScore * 100) / 100 : '', p.wins, pctCell(p.inventedRate)]),
        [],
        ['Generato', { value: generatedAt, format: XLSX_FORMATS.datetime }],
      ],
      filter: false,
    },
    {
      name: 'Verifiche',
      columns: [{ width: 22 }, { width: 34 }, { width: 34 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 10 }, { width: 12 }, { width: 10 }, { width: 40 }, { width: 14 }],
      rows: [
        ['Modello', 'Riferimento', 'Candidato', 'Etichetta', 'Risposta', 'Corretto', 'Fiducia', 'Costo $', 'Latenza s', 'Motivo o errore', 'Da ricontrollare'],
        ...runs.filter((r) => r.task === 'verify').map((r) => {
          const p = pairById.get(r.pairId) || {}
          return [name(r.modelKey), (p.source && p.source.title) || '', (p.candidate && p.candidate.title) || '', p.label || '', r.verdict || '', r.verdict ? (r.verdict === p.label ? 'sì' : 'no') : '', r.confidence ?? '', usdCell(r.costUsd), r.latencyMs != null ? r.latencyMs / 1000 : '', r.error || r.reason || '', toRecheck.has(r.pairId) ? 'sì' : '']
        }),
      ],
    },
    {
      name: 'Psicologia',
      columns: [{ width: 22 }, { width: 34 }, { width: 8 }, { width: 10 }, { width: 60 }],
      rows: [
        ['Modello', 'Annuncio', 'Voto', 'Inventa', 'Testo'],
        ...ratings.map((r) => [name(r.modelKey), r.caseTitle || '', r.score ?? '', r.invented ? 'sì' : 'no', r.text || '']),
      ],
    },
    {
      name: 'Prezzi',
      columns: [{ width: 22 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 50 }],
      rows: [
        ['Fornitore', 'Modello', 'Input $/M', 'Output $/M', 'Fonte e note'],
        ...prices.map((p) => [p.provider, p.model, p.input, p.output, p.note || '']),
      ],
      filter: false,
    },
    {
      name: 'Metodo',
      columns: [{ width: 22 }, { width: 60 }, { width: 50 }],
      rows: [
        ['Fornitore', 'Test delle foto', 'Psicologia'],
        ...method.map((m) => [m.provider, m.verify, m.psych]),
        [],
        ['Foto ridotte a 768 px sul lato lungo, JPEG, uguali per tutti i modelli. Ogni risposta è controllata con lo stesso schema dall\'app.'],
        ['Costi calcolati dai token riportati da ciascun fornitore e dai prezzi di listino nel foglio Prezzi; fa fede la fattura del fornitore.'],
      ],
      filter: false,
    },
  ]
  return buildXlsx(sheets)
}
