/**
 * Phase 1 — find the same product at a better final price on Vinted, Subito and Wallapop.
 *  1. product card: what exactly is being looked for (AI, with a deterministic fallback), the words to search and the
 *     models of the same family with their tier (lower / same / higher) and typical price ratio;
 *  2. pre-filter: cheap checks on the listings read from the search pages, so the AI only sees plausible ones; in the
 *     light mode the accessory and keyword rules are left to the triage and bargains far below the window are kept
 *     as suspects instead of being dropped;
 *  2b. triage: one text-only call that sorts a batch of candidates into same / variant / family / accessory / other
 *     before the (paid) photo verification;
 *  3. verification prompt: same / variant / different, plus whether a different item is an alternative of the same
 *     product family (shown in a separate section);
 *  3b. deterministic attribute check: capacity, size and model number read from the titles, so a "same" with a
 *     different capacity becomes a functional variant whatever the model said;
 *  4. ranking: total cost to the buyer now (price + fee + shipping) and after a realistic negotiation, corrected for
 *     the declared condition and adjusted for the risks the verification found; alternatives carry a deal index
 *     against the typical price of their tier; suspects are listed apart; the offer curve gives the acceptance
 *     probability at each price between the channel floor and the asking price.
 * The AI calls are made by the app (llm.js shapes, the model chosen in the lab).
 */

import { CHANNELS, CONDITION_PENALTY_PCT, buyerFee, conditionGrade, offerFloorFor, withCosts } from './channels.js'
import { vintedSearchQuery } from './catalog.js'
import { engineFactsFor } from './ailab.js'
import { analyzeOffer } from './analyze.js'
import { buildFormFromExtraction, categoryGuess } from './extract.js'
import { formatEuro } from './messages.js'
import { scrubContacts } from './privacy.js'

const round2 = (n) => Math.round(n * 100 + 1e-7) / 100

/* ───────── 1. product card ───────── */

export const FAMILY_TIERS = ['lower', 'same', 'higher']

export const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    brand: { type: 'string' },
    model: { type: 'string' },
    attributes: { type: 'array', items: { type: 'string' } },
    category: { type: 'string' },
    query: { type: 'string' },
    mustWords: { type: 'array', items: { type: 'string' } },
    accessoryWords: { type: 'array', items: { type: 'string' } },
    family: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, tier: { type: 'string', enum: FAMILY_TIERS }, priceRatio: { type: 'number' } },
        required: ['name', 'tier', 'priceRatio'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'brand', 'model', 'attributes', 'category', 'query', 'mustWords', 'accessoryWords', 'family'],
  additionalProperties: false,
}

const PRODUCT_SYSTEM = [
  'Aiuti a cercare lo stesso articolo usato su Vinted, Subito e Wallapop in Italia.',
  'Dal titolo e dalla descrizione di un annuncio ricavi la scheda del prodotto. Usa solo ciò che c\'è nel testo: se un dato manca lascia una stringa vuota o una lista vuota, non inventare.',
  'name: nome completo e preciso del prodotto (marca, modello, versione). brand e model separati. attributes: caratteristiche che distinguono la versione (capacità, taglia, colore, edizione), massimo 5.',
  'query: parole da cercare sui siti, 2-5 parole, senza aggettivi né condizioni (niente "nuovo", "perfetto", "offerta").',
  'mustWords: 1-3 parole che un annuncio dello stesso modello deve contenere (minuscole, es. ["s9","plus"] o ["black","hole"]).',
  'accessoryWords: parole che indicano accessori o ricambi venduti per quel prodotto (es. "cover", "custodia", "pellicola", "tastiera"), massimo 8; lista vuota se il prodotto stesso è un accessorio.',
  'family: da 0 a 4 modelli della stessa famiglia che potrebbero interessare in alternativa (es. per Galaxy Tab S9+ → "Galaxy Tab S9", "Galaxy Tab S9 FE+"), ognuno con name, tier (lower = inferiore, same = pari, higher = superiore rispetto al prodotto cercato) e priceRatio = prezzo tipico del modello diviso prezzo tipico del prodotto cercato (es. 0.7).',
  'Rispondi solo con un oggetto JSON conforme allo schema, in italiano.',
].join('\n')

/** Prompt of the product-card call (text only). */
export function productPrompt(reference) {
  return {
    system: PRODUCT_SYSTEM,
    text: [
      'Annuncio di partenza:',
      `- titolo: ${reference.title ? scrubContacts(reference.title) : 'n.d.'}`,
      `- marca: ${reference.brand || 'n.d.'}`,
      `- taglia/misura: ${reference.size || 'n.d.'}`,
      `- categoria: ${reference.categoryText || 'n.d.'}`,
      `- descrizione: ${reference.description ? scrubContacts(String(reference.description).slice(0, 1500)).slice(0, 800) : 'n.d.'}`,
      'Restituisci il JSON richiesto.',
    ].join('\n'),
    schema: PRODUCT_SCHEMA,
    schemaName: 'scheda_prodotto',
  }
}

// Lower-case words without accents; "S9+" reads as "s9 plus" so it matches both spellings.
const words = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\+/g, ' plus ').split(/[^a-z0-9]+/).filter(Boolean)
const DEFAULT_ACCESSORIES = ['cover', 'custodia', 'pellicola', 'cavo', 'caricatore', 'ricambio', 'adesivo', 'skin']

/** The card used when the AI is not available: the search words from the title, no family. */
export function fallbackProduct(reference) {
  const query = vintedSearchQuery(reference)
  const must = words(query).filter((w) => w.length > 1 && (/\d/.test(w) || w.length > 3)).slice(0, 2)
  return {
    name: (reference.title ? scrubContacts(reference.title) : '') || query, brand: reference.brand || '', model: '', attributes: [], category: reference.categoryText || '',
    query, mustWords: must, accessoryWords: DEFAULT_ACCESSORIES, family: [], fromAi: false,
  }
}

/**
 * One family entry from the AI card: an object { name, tier, priceRatio } or (older cards) a bare name, which reads
 * as the same tier at the same price. The ratio is clamped to 0.2–3; a missing or non-positive one is 1.
 */
const familyEntry = (f) => {
  const obj = f && typeof f === 'object' ? f : { name: f }
  const name = String(obj.name || '').trim()
  if (!name) return null
  const ratio = Number(obj.priceRatio)
  return { name, tier: FAMILY_TIERS.includes(obj.tier) ? obj.tier : 'same', priceRatio: Number.isFinite(ratio) && ratio > 0 ? Math.min(3, Math.max(0.2, ratio)) : 1 }
}

/** Keeps the AI card within sane bounds (the schema checks types, not content). */
export function cleanProduct(card, reference) {
  const fb = fallbackProduct(reference)
  if (!card || typeof card !== 'object') return fb
  const list = (a, max) => (Array.isArray(a) ? a.map((x) => String(x || '').trim()).filter(Boolean).slice(0, max) : [])
  const query = String(card.query || '').trim().split(/\s+/).slice(0, 6).join(' ') || fb.query
  return {
    name: String(card.name || '').trim() || fb.name,
    brand: String(card.brand || '').trim(),
    model: String(card.model || '').trim(),
    attributes: list(card.attributes, 5),
    category: String(card.category || '').trim(),
    query,
    mustWords: list(card.mustWords, 3).map((w) => w.toLowerCase()),
    accessoryWords: list(card.accessoryWords, 8).map((w) => w.toLowerCase()),
    family: (Array.isArray(card.family) ? card.family.map(familyEntry).filter(Boolean) : []).slice(0, 4),
    fromAi: true,
  }
}

/**
 * The family model a candidate is, by token overlap with the family names: at least 60% of a name's tokens in the
 * title, and every token with a digit (the model number: "Galaxy Tab S9" must not take a "Galaxy Tab S7"); the name
 * with the most matched tokens wins, then the tightest match. Returns { name, tier, priceRatio } or null when the
 * title matches none.
 */
export function tierFor(candidate, product) {
  const family = product && Array.isArray(product.family) ? product.family : []
  const have = new Set(words(candidate && candidate.title))
  let best = null
  for (const f of family) {
    const entry = familyEntry(f)
    const toks = entry ? [...new Set(words(entry.name))] : []
    if (!toks.length) continue
    const matched = toks.filter((t) => have.has(t)).length
    const ratio = matched / toks.length
    if (ratio < 0.6 || toks.some((t) => /\d/.test(t) && !have.has(t))) continue
    if (!best || matched > best.matched || (matched === best.matched && ratio > best.ratio)) best = { matched, ratio, entry }
  }
  return best ? best.entry : null
}

/** Price window for the search pages: no accessories far below, nothing pointlessly above the reference. */
export function priceWindow(referencePrice) {
  const p = Number(referencePrice)
  if (!Number.isFinite(p) || p <= 0) return { minPrice: null, maxPrice: null }
  return { minPrice: Math.max(1, Math.floor(p * 0.3)), maxPrice: Math.ceil(p * 1.25) }
}

/* ───────── 2. pre-filter ───────── */

/**
 * Cheap checks before the AI: drops sold/reserved listings, listings that cannot be shipped, listings without price or
 * photo or outside the price window (the sites' own price filters are not reliable), accessories (when the reference
 * is not one) and duplicates; ranks the rest by how many must-words they contain and by total, and keeps at most
 * `perChannel` per channel. Returns { kept, dropped: { reason: count }, suspects }.
 * `mode: 'light'` (before a triage, which judges accessories and other products better than word lists): no accessory
 * or must-word rule, a price below the window keeps the listing with `suspect: true` (counted in `suspects`; above
 * the window still drops), and the channel cap keeps the listings whose price is closest to `reference.price`.
 */
export function prefilter(candidates, product, reference, { perChannel = 20, window = null, mode = 'strict' } = {}) {
  const light = mode === 'light'
  const dropped = {}
  const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1 }
  // An accessory word stays out of the filter only when the reference IS that accessory ("Apple caricatore 20W",
  // "iPhone 13 cover MagSafe"): it is named in the title before any extras clause ("iPhone 13 con cover" is a phone).
  // The description often lists the extras and must not switch the filter off.
  // Bundles ("iPhone 13 + cover", "iPhone 13, cover", "iPhone 13 cover inclusa") are the product, not the accessory.
  const rawHead = String(reference.title || '').split(/\s\+\s?|\s?[,;(]|\s[-–—]\s|\s\/\s/)[0]
  const refHead = ` ${words(rawHead).join(' ')} `
    .replace(/ [a-z0-9]+ (?:in )?(?:regalo|omaggio|inclus[oaie]) /g, ' ')
    .split(/ (?:con|e|piu|incluso|inclusa|inclusi|incluse|omaggio|regalo) /)[0] + ' '
  const accessories = (product.accessoryWords || []).map((w) => words(w).join(' ')).filter((w) => w && !refHead.includes(` ${w} `))
  const must = (product.mustWords || []).map((w) => words(w).join(' ')).filter(Boolean)
  // "<accessory> … per <product>" marks an accessory only when the product is not named before it ("iPad Air 5 con
  // cover per iPad" is the iPad) and only when there are product words to look for.
  const forProduct = must.length ? (a) => new RegExp(` ${a}( [a-z0-9]+){0,2} per( [a-z0-9]+){0,3} (${must.join('|')}) `) : null
  const subjectFirst = (text, a) => {
    const before = text.slice(0, text.indexOf(` ${a} `) + 1)
    return must.some((m) => before.includes(` ${m} `))
  }
  const minPrice = window && Number.isFinite(window.minPrice) ? window.minPrice : null
  const maxPrice = window && Number.isFinite(window.maxPrice) ? window.maxPrice : null
  const seen = new Set()
  const scored = []
  for (const c of candidates) {
    const key = `${c.source}:${c.id}`
    if (seen.has(key)) { drop('doppione'); continue }
    seen.add(key)
    if (reference.id && c.source === (reference.source || 'vinted') && String(c.id) === String(reference.id)) { drop('annuncio di partenza'); continue }
    if (c.sold || c.reserved) { drop('venduto o riservato'); continue }
    if (c.shipping && c.shipping.available === false) { drop('senza spedizione'); continue }
    if (!Number.isFinite(c.price) || c.price <= 0) { drop('senza prezzo'); continue }
    const below = minPrice != null && c.price < minPrice
    if ((below && !light) || (maxPrice != null && c.price > maxPrice)) { drop('fuori fascia di prezzo'); continue }
    if (!c.photo) { drop('senza foto'); continue }
    if (light) { scored.push({ c: below ? { ...c, suspect: true } : c, hits: 1 }); continue }
    // An accessory sold for the product: its title starts with the accessory ("Cover Galaxy Tab S9") or names it
    // shortly before "per" + the product ("Pellicola vetro temperato per Tab S9"). "Tab S9 con cover, perfetto per la
    // scuola" is the product, and stays.
    const text = ` ${words(c.title).join(' ')} `
    const isAccessory = accessories.some((a) => text.startsWith(` ${a} `) || (forProduct && !subjectFirst(text, a) && forProduct(a).test(text)))
    if (isAccessory) { drop('accessorio'); continue }
    const all = ` ${words(`${c.title} ${c.description || ''}`).join(' ')} `
    const hits = must.length ? must.filter((m) => all.includes(` ${m} `)).length / must.length : 1
    if (must.length && hits === 0) { drop('altro prodotto (parole chiave assenti)'); continue }
    scored.push({ c, hits })
  }
  const kept = []
  const perCh = {}
  let suspects = 0
  const cost = (c) => c.total ?? c.price
  const refPrice = light && reference && Number.isFinite(reference.price) && reference.price > 0 ? reference.price : null
  scored.sort(refPrice != null
    ? (a, b) => Math.abs(a.c.price - refPrice) - Math.abs(b.c.price - refPrice) || cost(a.c) - cost(b.c)
    : (a, b) => b.hits - a.hits || cost(a.c) - cost(b.c))
  for (const { c } of scored) {
    perCh[c.source] = (perCh[c.source] || 0) + 1
    if (perCh[c.source] > perChannel) { drop('oltre il limite per canale'); continue }
    if (c.suspect) suspects++
    kept.push(c)
  }
  return { kept, dropped, suspects }
}

/* ───────── 2b. triage (one text-only call per batch) ───────── */

export const TRIAGE_VERDICTS = ['same', 'variant', 'family', 'accessory', 'other']

export const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: TRIAGE_VERDICTS },
          confidence: { type: 'number' },
        },
        required: ['id', 'verdict', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
}

const TRIAGE_SYSTEM = [
  'Sei un perito di articoli usati. Dal solo testo (titolo, canale, prezzo, condizioni) smisti in blocco gli annunci trovati cercando un articolo su Vinted, Subito e Wallapop.',
  'Per ogni annuncio dai un verdict: "same" = stesso modello e stessa versione dell\'articolo cercato (edizione, taglia, colore, capacità); "variant" = stesso modello, una di queste caratteristiche diversa; "family" = un altro modello della stessa famiglia di prodotto, che potrebbe interessare in alternativa; "accessory" = accessorio, ricambio, custodia o scatola per il prodotto, non il prodotto; "other" = un altro prodotto.',
  'confidence è un numero tra 0 e 1. Nel dubbio tra same e variant scegli variant; nel dubbio tra family e other scegli family. Usa solo ciò che c\'è nel testo: se il titolo non basta, abbassa confidence, non inventare.',
  'Rispondi solo con un oggetto JSON conforme allo schema: items con una voce per ogni id ricevuto (lo stesso id, senza il cancelletto), nello stesso ordine, senza testo fuori dal JSON.',
].join('\n')

const candidateId = (c) => `${c.source}:${c.id}`

/**
 * Prompt of the triage call for one batch of candidates: the reference (no description) and one line per candidate
 * (id, channel, scrubbed title, price, condition; no description, to keep the call cheap).
 */
export function triagePrompt(reference, product, candidates) {
  const ref = reference || {}
  return {
    system: TRIAGE_SYSTEM,
    text: [
      [
        'Articolo cercato:',
        `- titolo: ${ref.title ? scrubContacts(ref.title) : 'n.d.'}`,
        `- marca: ${ref.brand || 'n.d.'}`,
        `- taglia/misura: ${ref.size || 'n.d.'}`,
        `- condizioni dichiarate: ${ref.condition || 'n.d.'}`,
        `- prezzo: ${Number.isFinite(ref.price) ? formatEuro(ref.price) : 'n.d.'}`,
        ...(product && product.name ? [`- prodotto: ${scrubContacts(product.name)}${product.attributes && product.attributes.length ? ` (${product.attributes.map(scrubContacts).join(', ')})` : ''}`] : []),
      ].join('\n'),
      [
        'Annunci candidati (#id [canale] titolo — prezzo — condizioni):',
        ...candidates.map((c) => `#${candidateId(c)} [${CHANNELS[c.source] ? CHANNELS[c.source].label : c.source || 'n.d.'}] ${c.title ? scrubContacts(c.title) : 'n.d.'} — ${Number.isFinite(c.price) ? formatEuro(c.price) : 'n.d.'} — ${c.condition || 'n.d.'}`),
      ].join('\n'),
      'Restituisci il JSON richiesto.',
    ].join('\n\n'),
    schema: TRIAGE_SCHEMA,
    schemaName: 'triage_ricerca',
  }
}

/** Splits the candidates into batches of at most `size` for the triage calls. */
export function triageBatches(candidates, size = 40) {
  const n = Math.max(1, Math.floor(size) || 1)
  const out = []
  for (let i = 0; i < candidates.length; i += n) out.push(candidates.slice(i, i + n))
  return out
}

/**
 * Applies the triage answers (the `items` of every batch, concatenated) to the candidates. Returns
 * { plausible, rejected: { reason: count }, unanswered }: plausible = same, variant and family, plus accessory and
 * other with confidence below 0.4 (benefit of the doubt), each with `triage: { verdict, confidence }`; candidates
 * the model did not answer for are plausible too, with `triage: null`, and listed in `unanswered`.
 */
export function applyTriage(candidates, answers) {
  const byId = new Map()
  for (const a of Array.isArray(answers) ? answers : []) {
    if (!a || typeof a !== 'object' || !TRIAGE_VERDICTS.includes(a.verdict)) continue
    const id = String(a.id || '').trim().replace(/^#/, '')
    if (id && !byId.has(id)) byId.set(id, a)
  }
  const plausible = []
  const unanswered = []
  const rejected = {}
  const reject = (why) => { rejected[why] = (rejected[why] || 0) + 1 }
  for (const c of candidates) {
    const a = byId.get(candidateId(c))
    if (!a) { unanswered.push(c); plausible.push({ ...c, triage: null }); continue }
    const confidence = Number.isFinite(a.confidence) ? Math.max(0, Math.min(1, a.confidence)) : 0.5
    const sure = confidence >= 0.4
    if (a.verdict === 'accessory' && sure) { reject('accessorio'); continue }
    if (a.verdict === 'other' && sure) { reject('altro prodotto'); continue }
    plausible.push({ ...c, triage: { verdict: a.verdict, confidence } })
  }
  return { plausible, rejected, unanswered }
}

/* ───────── 3. verification ───────── */

export const SEARCH_VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['same', 'variant', 'different'] },
    family: { type: 'boolean' },
    confidence: { type: 'number' },
    differences: { type: 'array', items: { type: 'string' } },
    candidateCondition: { type: 'string' },
    redFlags: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['verdict', 'family', 'confidence', 'differences', 'candidateCondition', 'redFlags', 'reason'],
  additionalProperties: false,
}

const SEARCH_VERIFY_SYSTEM = [
  'Sei un perito di articoli usati. Confronti l\'articolo cercato (annuncio di riferimento) con un annuncio candidato e decidi se vendono lo stesso prodotto.',
  'Definizioni: "same" = stesso modello e stessa versione (edizione, taglia, colore, capacità); "variant" = stesso modello ma una di queste caratteristiche diversa; "different" = un altro prodotto.',
  'family: true solo se verdict è "different" ma il candidato è un modello diverso della stessa famiglia di prodotto, che potrebbe interessare in alternativa (es. Galaxy Tab S9 FE rispetto a Galaxy Tab S9+); altrimenti false. Accessori, ricambi e scatole vuote non sono mai family.',
  'Usa solo ciò che vedi nelle foto e leggi nei testi. Se le foto non bastano, dillo in reason e abbassa confidence. Non inventare dettagli.',
  'confidence è un numero tra 0 e 1. differences elenca le differenze concrete (massimo 4). candidateCondition descrive lo stato del candidato in poche parole.',
  'redFlags elenca segnali di rischio concreti (foto prese dal web, prezzo incoerente, articolo diverso dal titolo, difetti dichiarati, richiesta di pagamenti esterni), altrimenti lista vuota.',
  'Rispondi solo con un oggetto JSON conforme allo schema, in italiano, senza testo fuori dal JSON.',
].join('\n')

const describeListing = (who, l, extra = []) => [
  `${who}:`,
  `- canale: ${CHANNELS[l.source] ? CHANNELS[l.source].label : l.source || 'n.d.'}`,
  `- titolo: ${l.title ? scrubContacts(l.title) : 'n.d.'}`,
  `- marca: ${l.brand || 'n.d.'}`,
  `- taglia/misura: ${l.size || 'n.d.'}`,
  `- condizioni dichiarate: ${l.condition || 'n.d.'}`,
  `- prezzo: ${Number.isFinite(l.price) ? formatEuro(l.price) : 'n.d.'}`,
  `- descrizione: ${l.description ? scrubContacts(String(l.description).slice(0, 1500)).replace(/\s+/g, ' ').slice(0, 400) : 'n.d.'}`,
  ...extra,
].join('\n')

/**
 * Verification prompt for a search candidate. Images: reference first, candidate second; when the reference has no
 * photo, only the candidate's.
 */
export function searchVerifyPrompt(reference, product, candidate, { withReferencePhoto = true } = {}) {
  return {
    system: SEARCH_VERIFY_SYSTEM,
    text: [
      withReferencePhoto ? 'Prima immagine: articolo cercato. Seconda immagine: annuncio candidato.' : 'Unica immagine: annuncio candidato (l\'articolo cercato non ha foto: confronta i testi).',
      describeListing('Articolo cercato', reference, product && product.name ? [`- prodotto: ${scrubContacts(product.name)}${product.attributes && product.attributes.length ? ` (${product.attributes.map(scrubContacts).join(', ')})` : ''}`] : []),
      describeListing('Annuncio candidato', candidate),
      'Restituisci il JSON richiesto.',
    ].join('\n\n'),
    schema: SEARCH_VERIFY_SCHEMA,
    schemaName: 'verifica_ricerca',
  }
}

/* ───────── 3b. deterministic attribute check on the titles ───────── */

const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Storage capacity in GB from a title ("256GB", "1 TB"; TB = 1024 GB), skipping RAM ("8GB RAM", "RAM 8 GB"). With
 * two capacities ("8/128GB", "8GB 256GB") the larger is the storage. Null when absent.
 */
function storageOf(text) {
  const re = /(\d+)\s?(gb|tb)\b/g
  let best = null
  let m
  while ((m = re.exec(text))) {
    if (/^\s*(?:di\s+)?ram\b/.test(text.slice(m.index + m[0].length)) || /ram\s*$/.test(text.slice(0, m.index))) continue
    const gb = m[2] === 'tb' ? Number(m[1]) * 1024 : Number(m[1])
    if (!best || gb > best.gb) best = { gb, label: `${m[1]}${m[2].toUpperCase()}` }
  }
  return best
}

const LETTER_SIZES = String.raw`xxs|xs|s|m|l|xl|xxl|xxxl|[2-6]xl`
const PREFIXED_SIZE = new RegExp(String.raw`\b(tg|taglia|size|eu|it|uk|us)\.?\s?(${LETTER_SIZES}|\d{1,2}(?:[.,]5)?)\b`)
const BARE_SIZE = new RegExp(String.raw`(?:^|\s)(${LETTER_SIZES})(?=\s|$)`)

/**
 * Clothing or shoe size from a title: after "tg", "taglia", "size", "EU", "IT", "UK", "US" (the prefix fixes the
 * scale: letters, European numbers, UK or US numbers) or a bare XS–XXXL token. Null when absent.
 */
function sizeOf(text) {
  const m = PREFIXED_SIZE.exec(text)
  if (m) {
    const value = m[2].replace(',', '.').toUpperCase()
    return { scale: /^[A-Z]/.test(value) ? 'letter' : m[1] === 'uk' || m[1] === 'us' ? m[1] : 'eu', value }
  }
  const bare = BARE_SIZE.exec(text)
  return bare ? { scale: 'letter', value: bare[1].toUpperCase() } : null
}

// A model number: a bare 2–4 digit integer ("13", "501", "2019") or one or two letters plus digits ("s9", "a54",
// "x816b"), not a unit's value, a size or a year of purchase.
const MODEL_TOKEN = /^(?:\d{2,4}|[a-z]{1,2}\d{1,4}[a-z]?)$/
const UNIT_AFTER = /^(?:gb|tb|ram|mah|w|hz|mp|mm|cm|pollici|euro)$/
const NOT_MODEL_BEFORE = new Set(['tg', 'taglia', 'size', 'eu', 'it', 'uk', 'us', 'numero', 'num', 'n', 'anno', 'del', 'year'])
const isModelToken = (toks, i) => MODEL_TOKEN.test(toks[i]) && !UNIT_AFTER.test(toks[i + 1] || '') && !NOT_MODEL_BEFORE.has(toks[i - 1] || '')

/**
 * Different model numbers in the same position of two titles that share their first (brand-like) token, right after a
 * shared word: "iPhone 13" vs "iPhone 14", "Tab S9" vs "Tab S8". Conservative: nothing when either side has no model
 * token there. Returns [ref, cand] or null.
 */
function modelConflict(ref, cand) {
  if (ref.length < 2 || cand.length < 2 || ref[0] !== cand[0]) return null
  const n = Math.min(ref.length, cand.length)
  for (let i = 1; i < n; i++) {
    if (ref[i - 1] !== cand[i - 1] || ref[i] === cand[i]) continue
    if (isModelToken(ref, i) && isModelToken(cand, i)) return [ref[i], cand[i]]
  }
  return null
}

/**
 * Attributes read from the two titles that cannot both be true of the same item: storage capacity, size (compared
 * only on the same scale) and model number. Returns { capacity, size, model }, each [reference, candidate] or null,
 * or null when nothing conflicts.
 */
export function attributeConflict(refTitle, candTitle) {
  const a = plain(refTitle)
  const b = plain(candTitle)
  const out = { capacity: null, size: null, model: null }
  const ca = storageOf(a)
  const cb = storageOf(b)
  if (ca && cb && ca.gb !== cb.gb) out.capacity = [ca.label, cb.label]
  const sa = sizeOf(a)
  const sb = sizeOf(b)
  if (sa && sb && sa.scale === sb.scale && sa.value !== sb.value) out.size = [sa.value, sb.value]
  const m = modelConflict(words(a), words(b))
  if (m) out.model = [m[0].toUpperCase(), m[1].toUpperCase()]
  return out.capacity || out.size || out.model ? out : null
}

/** The conflicts as differences for the row, in Italian. */
const conflictTexts = (conflict) => [
  ...(conflict.capacity ? [`capacità ${conflict.capacity[1]} invece di ${conflict.capacity[0]}`] : []),
  ...(conflict.size ? [`taglia ${conflict.size[1]} invece di ${conflict.size[0]}`] : []),
  ...(conflict.model ? [`modello ${conflict.model[1]} invece di ${conflict.model[0]}`] : []),
]

/* ───────── 4. ranking ───────── */

/**
 * Expected outcome of a negotiation on one candidate: the offer the engine suggests (within the channel's floor),
 * its acceptance probability, and the expected price (accepted → offer, otherwise the asking price).
 * The engine is calibrated on Vinted: on Subito and Wallapop the numbers are an estimate and are marked as such.
 */
export function negotiationFor(candidate, now = new Date()) {
  const price = candidate.price
  const floor = offerFloorFor(candidate.source, price, { sellerBusiness: candidate.sellerBusiness, refurbished: candidate.refurbished })
  if (!Number.isFinite(price) || floor == null) return null
  if (floor >= price) return { offer: price, probability: 1, expectedPrice: price, estimated: false, noOffer: true, note: candidate.refurbished ? 'Niente offerte su questo annuncio (ricondizionato).' : 'Niente offerte su questo annuncio (venditore professionale).' }
  const facts = engineFactsFor({ ...candidate, price }, {}, now)
  if (!facts || !Number.isFinite(facts.target) || !Number.isFinite(facts.probability)) {
    return { offer: price, probability: 1, expectedPrice: price, estimated: true, note: facts && facts.note ? facts.note : null }
  }
  const offer = round2(Math.max(floor, Math.min(price, facts.target)))
  const p = Math.max(0, Math.min(1, facts.probability / 100))
  return { offer, probability: p, expectedPrice: round2(p * offer + (1 - p) * price), estimated: candidate.source !== 'vinted', sendLabel: facts.sendLabel || null, note: null }
}

/** Engine category whose condition penalty applies: the card's id, the reference's id, else a guess from the reference. */
const penaltyCategory = (reference, product) => {
  if (product && CONDITION_PENALTY_PCT[product.categoryId]) return product.categoryId
  if (reference && CONDITION_PENALTY_PCT[reference.category]) return reference.category
  if (reference) return categoryGuess({ categoryText: reference.categoryText || '', brand: reference.brand || '', title: reference.title || '', listPrice: Number.isFinite(reference.price) ? reference.price : null }).id
  return 'other'
}

const byScore = (a, b) => a.score - b.score || a.totalNow - b.totalNow
const byDeal = (a, b) => (a.dealIndex == null) - (b.dealIndex == null) || (a.dealIndex ?? 0) - (b.dealIndex ?? 0) || byScore(a, b)

/**
 * Ranks verified candidates. `results` = [{ candidate, verdict, family, confidence, differences, redFlags, reason }];
 * `reference` (the listing searched for) and `product` (its card) refine the rows when given, old positional calls
 * still work. Returns { main, alternatives, suspects }.
 * - Verdict: a "same" whose title conflicts with the reference's on capacity, size or model number becomes a
 *   variant with the difference spelled out. A variant with such a conflict is a functional variant and goes to the
 *   alternatives (`variantKind: 'functional'`); one without (colour, edition) stays in the main list ('cosmetic').
 *   Alternatives also hold the different items of the same family.
 * - Value: expected total after negotiation, corrected for the declared condition against the reference's
 *   (`conditionDeltaPct`: +pct per grade worse, at most −5% for a better one, pct by category) → `valueTotal`; the
 *   score is the value raised by the risks (lower is better).
 * - Alternatives carry `tier` (the family model matched) and `dealIndex` = value / (reference price × typical price
 *   ratio of the tier), and are sorted by it (unknown last); main rows by score.
 * - Suspects (candidates kept by the light pre-filter far below the price window) are listed apart, whatever their
 *   group, with the warning first among their risks.
 */
export function rankResults(results, now = new Date(), { reference = null, product = null } = {}) {
  const refPrice = reference && Number.isFinite(reference.price) && reference.price > 0 ? reference.price : null
  const refGrade = reference ? conditionGrade(reference.condition, reference.source || 'vinted') : null
  const pct = CONDITION_PENALTY_PCT[penaltyCategory(reference, product)]
  const rows = []
  for (const r of results) {
    const c = r.candidate
    if (!c || !Number.isFinite(c.price)) continue
    let verdict = r.verdict
    const differences = Array.isArray(r.differences) ? r.differences.filter(Boolean) : []
    const conflict = reference && reference.title && c.title ? attributeConflict(reference.title, c.title) : null
    if (conflict && verdict === 'same') verdict = 'variant'
    if (conflict && verdict === 'variant') differences.push(...conflictTexts(conflict))
    const variantKind = verdict === 'variant' ? (conflict ? 'functional' : 'cosmetic') : null
    const group = verdict === 'same' || variantKind === 'cosmetic' ? 'main'
      : variantKind === 'functional' || (verdict === 'different' && r.family) || verdict === 'family' ? 'alternative' : null
    if (!group) continue
    const neg = negotiationFor(c, now)
    const shipping = Number.isFinite(c.shippingCost) ? c.shippingCost : 0
    const feeNow = Number.isFinite(c.buyerFee) ? c.buyerFee : 0
    const expectedPrice = neg ? neg.expectedPrice : c.price
    const feeAfter = buyerFee(c.source, expectedPrice).amount ?? feeNow
    const totalNow = round2(c.price + feeNow + shipping)
    const expectedTotal = round2(expectedPrice + feeAfter + shipping)
    const risks = []
    if (c.suspect) risks.push('prezzo molto sotto il mercato: verifica')
    let penalty = 0
    const confidence = Number.isFinite(r.confidence) ? Math.max(0, Math.min(1, r.confidence)) : 0.5
    if (confidence < 0.7) { penalty += (0.7 - confidence) * 0.2; risks.push('verifica incerta') }
    const flags = Array.isArray(r.redFlags) ? r.redFlags.filter(Boolean) : []
    if (flags.length) { penalty += 0.05 * Math.min(3, flags.length); risks.push(...flags.slice(0, 3)) }
    if (verdict === 'variant') risks.push('variante: controlla la differenza')
    if (c.shippingEstimated) { penalty += 0.01; risks.push('spedizione stimata') }
    if (c.feeEstimated) risks.push('commissione stimata')
    if (c.abroad) { penalty += 0.02; risks.push('spedizione dall\'estero') }
    // Wallapop search results do not say whether the seller is PRO (no offers allowed): the negotiation may not exist.
    if (c.source === 'wallapop' && c.sellerBusiness == null && neg && neg.offer < c.price) risks.push('offerta possibile solo se il venditore non è PRO')
    if (neg && neg.estimated) risks.push('trattativa stimata con il modello Vinted')
    // Declared condition against the reference's: a worse one costs pct per grade, a better one is worth a little.
    const candGrade = conditionGrade(c.condition, c.source)
    let conditionDeltaPct = null
    if (refGrade != null && candGrade != null) {
      const delta = candGrade - refGrade
      conditionDeltaPct = delta > 0 ? delta * pct : Math.max(-5, delta * pct / 2)
      if (delta >= 1) risks.push(`condizioni peggiori (${c.condition} vs ${reference.condition})`)
    }
    const valueTotal = round2(expectedTotal * (1 + (conditionDeltaPct || 0) / 100))
    const tier = group === 'alternative' ? tierFor(c, product) : null
    const dealIndex = tier && refPrice != null ? Math.round(valueTotal / (refPrice * tier.priceRatio) * 1000) / 1000 : null
    rows.push({
      group, candidate: c, verdict, variantKind, conflict, confidence, reason: r.reason || '', differences,
      totalNow, expectedTotal, conditionGrade: candGrade, conditionDeltaPct, valueTotal, score: round2(valueTotal * (1 + penalty)),
      tier, dealIndex,
      offer: neg ? neg.offer : null, probability: neg ? neg.probability : null, sendLabel: neg ? neg.sendLabel : null,
      negotiationNote: neg ? neg.note : null, risks,
    })
  }
  return {
    main: rows.filter((r) => r.group === 'main' && !r.candidate.suspect).sort(byScore),
    alternatives: rows.filter((r) => r.group === 'alternative' && !r.candidate.suspect).sort(byDeal),
    suspects: rows.filter((r) => r.candidate.suspect).sort(byScore),
  }
}

/* ───────── offer curve ───────── */

/** The extraction a search candidate amounts to (the fields a search result carries), as engineFactsFor builds it. */
export function extractionFor(candidate, source = {}) {
  return {
    title: candidate.title, listPrice: candidate.price, brand: candidate.brand, condition: candidate.condition,
    categoryText: source.categoryText || null, description: null,
    uploadedDays: candidate.uploadedDays ?? null, uploadedText: candidate.uploadedText ?? null,
    sellerLastSeenDays: candidate.sellerLastSeenDays ?? null, sellerLastSeenText: null,
    sellerFeedbackCount: candidate.sellerFeedbackCount ?? null, sellerRating: candidate.sellerRating ?? null,
    sellerBusiness: candidate.sellerBusiness, sellerBadges: [], sellerUsername: null,
  }
}

/**
 * Acceptance probability (0–1) of an offer at `price` on a candidate, from the engine at its best moment; null when
 * the engine has no analysis for it (no offer needed at that price, or a discount over Vinted's cap).
 */
export function probabilityAt(candidate, price, now = new Date()) {
  if (!candidate || !Number.isFinite(candidate.price) || candidate.price <= 0 || !Number.isFinite(price) || price <= 0) return null
  const { form } = buildFormFromExtraction(extractionFor(candidate), { link: candidate.url || '' })
  form.targetPrice = String(round2(price)).replace('.', ',')
  const result = analyzeOffer(form, now)
  if (!result || !result.ok || result.kind !== 'analysis' || !Number.isFinite(result.probability)) return null
  return Math.max(0, Math.min(1, result.probability))
}

/**
 * Offer curve of a candidate: `steps` equal steps from the channel floor to the asking price, each point
 * { price, total (price + fee + shipping), probability }; the asking price has probability 1 (no offer needed), points
 * the engine cannot price are left out. A channel floor at or above the price gives the single asking-price point.
 * Returns { id, label, points } sorted by price.
 */
export function offerCurveFor(candidate, now = new Date(), { steps = 6 } = {}) {
  const id = candidateId(candidate)
  const label = candidate.title || ''
  const price = candidate.price
  if (!Number.isFinite(price) || price <= 0) return { id, label, points: [] }
  const shipping = Number.isFinite(candidate.shippingCost) ? candidate.shippingCost : 0
  const point = (p, probability) => ({ price: p, total: round2(p + (buyerFee(candidate.source, p).amount ?? 0) + shipping), probability })
  const floor = offerFloorFor(candidate.source, price, { sellerBusiness: candidate.sellerBusiness, refurbished: candidate.refurbished })
  if (floor == null || floor >= price) return { id, label, points: [point(price, 1)] }
  const n = Math.max(1, Math.floor(steps) || 1)
  const points = []
  for (let k = 0; k < n; k++) {
    const p = round2(floor + (price - floor) * k / n)
    const probability = probabilityAt(candidate, p, now)
    if (probability != null) points.push(point(p, probability))
  }
  points.push(point(price, 1))
  return { id, label, points: points.sort((a, b) => a.price - b.price) }
}

/**
 * The reference listing on the rows' basis: total now (estimated shipping) and expected total after the same kind of
 * negotiation. Null without a price.
 */
export function referenceOutlook(reference, now = new Date()) {
  if (!reference || !Number.isFinite(reference.price) || reference.price <= 0) return null
  const c = withCosts({ ...reference, source: reference.source || 'vinted', shipping: {} })
  if (c.total == null) return null
  const neg = negotiationFor(c, now)
  const expectedPrice = neg ? neg.expectedPrice : c.price
  const fee = buyerFee(c.source, expectedPrice).amount ?? c.buyerFee
  return { totalNow: c.total, expectedTotal: round2(expectedPrice + fee + c.shippingCost) }
}

/** Saving of a row versus the reference (positive = cheaper): now, and after negotiating both. */
export function savingVersus(row, outlook) {
  if (!row || !outlook) return null
  return { now: round2(outlook.totalNow - row.totalNow), expected: round2(outlook.expectedTotal - row.expectedTotal) }
}
