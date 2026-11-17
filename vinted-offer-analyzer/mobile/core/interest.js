/**
 * The interest score (1.18): how much an article seen by the feed or by a hunt is worth buying to sell again, 0–100.
 *
 * The AI reads, the engine computes. The AI fills a fixed card for each article (what it is, brand, model, variant,
 * defects, an estimate of its prices); the score comes from the formula below, so that it is stable, explainable and
 * the same whatever model filled the card.
 *
 * What a high score means was chosen by the user: «compravendita». The heart of it is the margin left after buying
 * (price + Vinted's buyer protection + shipping) and selling again at the prudent resale value. The margin at which he
 * says «lo compro» comes from his own ten choices (17 November 2026): about 27% where the resale is sure (phones,
 * consoles, headphones, LEGO sets, complete manga series) and about 35% where it is less so (clothes, shoes, books,
 * e-readers, sport watches).
 *
 *   score = 40·convenienza + 20·domanda + 15·qualità + 10·trattabilità + 10·pertinenza + 5·venditore   (each 0–1)
 *
 * and above the sum: without a good price the score cannot be high (the gate), a value that only the AI estimated
 * makes it «provvisorio» (70 at most), and an article that was not identified stops at 55.
 *
 *   interestPrompt(items, { target })       → the prompt of one batch of cards
 *   cleanInterestCards(value, items)        → { id: card }
 *   comparablesOf(candidates, card, find)   → the prices of the same product among the results of a search
 *   marketReferenceOf(prices)               → { value, median, n } (value: the lower quartile) or null
 *   aiReferenceOf(card)                     → the same from the AI's own estimate, marked as such
 *   interestScore(find, { card, ref, profile, match }) → { total, label, provisional, parts, margin, target, reasons }
 *   rankByInterest(finds)                   → best first
 */
import { vintedBuyerFee } from './costs.js'
import { scrubContacts } from './privacy.js'
import { attributeConflict } from './search.js'

export const INTEREST_CATEGORIES = Object.freeze([
  'telefoni', 'console_giochi', 'audio', 'tablet_ereader_wearable', 'computer_foto', 'fumetti_manga', 'libri', 'sneakers', 'abbigliamento',
  'borse_accessori', 'sport', 'lego_collezionismo', 'casa', 'altro',
])
export const INTEREST_CATEGORY_LABELS = Object.freeze({
  telefoni: 'Telefoni', console_giochi: 'Console e giochi', audio: 'Audio', tablet_ereader_wearable: 'Tablet, e-reader, orologi', computer_foto: 'Computer e foto',
  fumetti_manga: 'Fumetti e manga', libri: 'Libri', sneakers: 'Sneakers', abbigliamento: 'Abbigliamento', borse_accessori: 'Borse e accessori', sport: 'Sport',
  lego_collezionismo: 'LEGO e collezionismo', casa: 'Casa', altro: 'Altro',
})
export const INTEREST_RISKS = Object.freeze(['falso', 'difettoso', 'incompleto', 'ricambio_accessorio', 'non_identificato'])

export const INTEREST = Object.freeze({
  WEIGHTS: Object.freeze({ convenienza: 40, domanda: 20, qualita: 15, trattabilita: 10, pertinenza: 10, venditore: 5 }),
  /** The margin, in % of the resale value, at which the user says «lo compro»: A where the resale is sure, B elsewhere. */
  MARGIN: Object.freeze({ A: 27, B: 35 }),
  SURE: Object.freeze(['telefoni', 'console_giochi', 'audio', 'lego_collezionismo', 'fumetti_manga']),
  /** Under this profit in euro an article is not a «sì», whatever the percentage. */
  MIN_PROFIT: 5,
  /** What a part is worth when nothing is known about it. */
  NEUTRAL: 0.7,
  /** «Più al ribasso»: a value that only the AI estimated is taken a little lower. */
  AI_PRUDENCE: 0.9,
  PROVISIONAL_CAP: 70,
  UNKNOWN_CAP: 55,
  REJECTED_CAP: 40,
  /** Vinted lets an offer go down to 60% of the price. */
  MAX_OFFER_DISCOUNT: 0.4,
  LABELS: Object.freeze([[85, 'affare'], [70, 'da comprare'], [55, 'da trattare'], [0, 'lascia']]),
  /** Shipping paid by the buyer when the listing does not say it: by the weight the card estimates ([up to kg, €]),
   *  never under what a valuable article costs to send, and by category when the weight is not known. */
  SHIPPING_BY_WEIGHT: Object.freeze([[0.5, 3], [1, 3.5], [2, 4.5], [5, 6], [10, 8], [Infinity, 10]]),
  SHIPPING_FLOOR: Object.freeze({ telefoni: 5, console_giochi: 6, computer_foto: 7 }),
  SHIPPING: Object.freeze({
    telefoni: 5, console_giochi: 6.5, audio: 4, tablet_ereader_wearable: 4, computer_foto: 7, fumetti_manga: 3.5, libri: 3, sneakers: 4.5, abbigliamento: 3.5,
    borse_accessori: 4, sport: 5, lego_collezionismo: 6, casa: 6, altro: 4,
  }),
  MARKET_MIN: 3,
  BATCH: 20,
})

const itFinite = (v) => typeof v === 'number' && Number.isFinite(v)
const itR2 = (v) => Math.round(v * 100) / 100
const itClamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const itWords = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\+/g, ' plus ').split(/[^a-z0-9]+/).filter(Boolean)
const itEuro = (v) => `${(Math.round(v * 100) / 100).toLocaleString('it-IT', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`
const IT_BROKEN = /\b(rott[oaie]|non funziona\w*|difett\w+|per ricambi|da riparare|guast[oaie]|crep[ao]t?\w*|scheggiat\w+|schermo rotto|non si accende)\b/i
const IT_ACCESSORY = ['cover', 'custodia', 'pellicola', 'cavo', 'caricatore', 'ricambio', 'ricambi', 'adesivo', 'skin', 'cinturino', 'scatola vuota', 'solo scatola', 'vetro temperato']
const IT_LOT = /\b(lotto|stock|bundle|set di \d+|\d+ pezzi|\d+ libri|\d+ volumi)\b/i

/* ───────── the card the AI fills ───────── */

export const INTEREST_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          categoria: { type: 'string', enum: INTEREST_CATEGORIES },
          tipo: { type: 'string' },
          marca: { type: 'string' },
          modello: { type: 'string' },
          variante: { type: 'string' },
          cerca: { type: 'string' },
          parole: { type: 'array', items: { type: 'string' } },
          difetti: { type: 'array', items: { type: 'string' } },
          pezzi: { type: 'integer' },
          peso_kg: { type: 'number' },
          nuovo: { type: 'number' },
          usato_min: { type: 'number' },
          usato_max: { type: 'number' },
          fiducia: { type: 'number' },
          rischi: { type: 'array', items: { type: 'string', enum: INTEREST_RISKS } },
          corrisponde: { type: 'string', enum: ['si', 'variante', 'no', 'nd'] },
        },
        required: ['id', 'categoria', 'tipo', 'marca', 'modello', 'variante', 'cerca', 'parole', 'difetti', 'pezzi', 'peso_kg', 'nuovo', 'usato_min', 'usato_max', 'fiducia', 'rischi', 'corrisponde'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
}

const INTEREST_SYSTEM = [
  'Sei un perito dell\'usato in Italia: valuti annunci di Vinted per chi compra per rivendere.',
  'Per ogni annuncio ricevi id, titolo, marca, taglia, condizioni dichiarate e prezzo. Compili una scheda per ciascuno, con lo stesso id.',
  'Identità: usa solo ciò che c\'è nel testo. categoria: una delle voci ammesse. tipo: che cos\'è, in 1-3 parole (es. "smartphone", "cuffie over-ear", "graphic novel", "piumino"). marca, modello, variante (memoria, taglia, edizione, volume, colore): stringa vuota se non ci sono; non inventare modelli.',
  'cerca: 2-5 parole per trovare lo stesso prodotto su Vinted, senza aggettivi né condizioni. parole: 1-3 parole minuscole che un annuncio dello stesso prodotto deve contenere (es. ["s25","ultra"], ["1000xm5"], ["persepolis"]).',
  'difetti: difetti o mancanze dichiarati nel titolo (lista vuota se nessuno). pezzi: quanti articoli sono venduti insieme (1 se uno solo). peso_kg: il peso stimato del pacco in chili, per tutti i pezzi (0 se non sai stimarlo).',
  'Prezzi in euro, dal tuo sapere sul mercato italiano, prudenti: nuovo = prezzo a cui si compra nuovo oggi; usato_min e usato_max = fascia a cui si vende tra privati NELLE CONDIZIONI DICHIARATE, per tutti i pezzi dell\'annuncio. Se non conosci il prodotto metti 0 e una fiducia bassa: è meglio 0 di un numero inventato.',
  'fiducia: da 0 a 1, quanto sei sicuro dell\'identificazione e dei prezzi. rischi: "falso" se è un articolo di marca molto contraffatto a un prezzo sospetto, "difettoso", "incompleto", "ricambio_accessorio" se l\'annuncio è un accessorio o un ricambio e non il prodotto, "non_identificato" se dal testo non si capisce che cos\'è.',
  'corrisponde: solo quando ti è dato che cosa cerca l\'utente: "si" se l\'annuncio è proprio quel prodotto, "variante" se è lo stesso modello in un\'altra versione, "no" se è altro; "nd" quando non ti è dato che cosa cerca.',
  'Rispondi solo con un oggetto JSON conforme allo schema.',
].join('\n')

/** One batch of cards. `items`: finds ({ id, title, brand, size, condition, price }); `target`: what a hunt looks for. */
export function interestPrompt(items, { target = '' } = {}) {
  const line = (f) => `#${f.id} | ${scrubContacts(String(f.title || '').slice(0, 140))} | marca: ${f.brand || 'n.d.'} | taglia: ${f.size || 'n.d.'} | condizioni: ${f.condition || 'n.d.'} | ${itFinite(f.price) ? `${f.price} €` : 'prezzo n.d.'}`
  return {
    system: INTEREST_SYSTEM,
    text: [
      target ? `L'utente cerca: «${scrubContacts(String(target).slice(0, 120))}».` : 'Non è data una ricerca dell\'utente: corrisponde = "nd".',
      'Annunci:',
      ...items.map(line),
      'Restituisci il JSON richiesto, una scheda per ogni id.',
    ].join('\n'),
    schema: INTEREST_SCHEMA,
    schemaName: 'schede_interesse',
  }
}

const itText = (v, max = 60) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const itMoney = (v) => (itFinite(v) && v > 0 && v < 100000 ? itR2(v) : 0)

/** The AI's answer → { id: card }, with every field in its place and nothing that was not asked for. */
export function cleanInterestCards(value, items) {
  const known = new Set((Array.isArray(items) ? items : []).map((f) => String(f.id)))
  const out = {}
  for (const raw of value && Array.isArray(value.items) ? value.items : []) {
    if (!raw || typeof raw !== 'object') continue
    const id = String(raw.id ?? '').replace(/^#/, '').trim()
    if (!known.has(id) || out[id]) continue
    const lo = itMoney(raw.usato_min)
    const hi = itMoney(raw.usato_max)
    out[id] = {
      category: INTEREST_CATEGORIES.includes(raw.categoria) ? raw.categoria : 'altro',
      kind: itText(raw.tipo, 40), brand: itText(raw.marca, 40), model: itText(raw.modello, 60), variant: itText(raw.variante, 40),
      query: itText(raw.cerca, 60), words: (Array.isArray(raw.parole) ? raw.parole : []).map((w) => itWords(w).join(' ')).filter(Boolean).slice(0, 3),
      defects: (Array.isArray(raw.difetti) ? raw.difetti : []).map((d) => itText(d, 40)).filter(Boolean).slice(0, 4),
      pieces: Number.isInteger(raw.pezzi) && raw.pezzi > 1 && raw.pezzi < 200 ? raw.pezzi : 1,
      weightKg: itFinite(raw.peso_kg) && raw.peso_kg > 0 && raw.peso_kg < 100 ? itR2(raw.peso_kg) : 0,
      newPrice: itMoney(raw.nuovo), usedLow: lo && hi ? Math.min(lo, hi) : lo || hi, usedHigh: lo && hi ? Math.max(lo, hi) : hi || lo,
      confidence: itFinite(raw.fiducia) ? itClamp(raw.fiducia) : 0.3,
      risks: (Array.isArray(raw.rischi) ? raw.rischi : []).filter((r) => INTEREST_RISKS.includes(r)),
      match: ['si', 'variante', 'no'].includes(raw.corrisponde) ? raw.corrisponde : null,
    }
  }
  return out
}

/* ───────── the reference: what the same product sells for ───────── */

const itBand = (condition) => (/nuovo/i.test(String(condition || '')) ? 'new' : /ottim|buon|discret|soddisfacent/i.test(String(condition || '')) ? 'used' : null)

/**
 * The same product among the results of a search (catalog.js candidates): the titles carry the card's words, are not
 * accessories or lots, do not differ on capacity, size or model number, and are in the same state (new or used) when
 * enough are. Returns their prices.
 */
export function comparablesOf(candidates, card, find) {
  const must = (card && Array.isArray(card.words) ? card.words : []).flatMap((w) => itWords(w))
  if (!must.length) return []
  const lot = card.pieces > 1
  const accessory = card.risks && card.risks.includes('ricambio_accessorio')
  const rows = []
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c || !itFinite(c.price) || c.price <= 0 || String(c.id) === String(find.id)) continue
    const said = itWords(`${c.title || ''} ${c.brand || ''}`)
    const joined = ` ${said.join(' ')} `
    // «1000xm5» also matches «wh-1000xm5» written as one word, «s25» does not match «s25fe».
    if (!must.every((w) => said.includes(w) || (w.length >= 5 && joined.includes(w)))) continue
    if (!accessory && IT_ACCESSORY.some((w) => joined.includes(` ${w} `))) continue
    if (!lot && IT_LOT.test(String(c.title || ''))) continue
    if (IT_BROKEN.test(String(c.title || ''))) continue
    if (attributeConflict(find.title || '', c.title || '')) continue
    rows.push({ price: c.price, band: itBand(c.condition) })
  }
  const band = find.band || itBand(find.condition)
  const same = band ? rows.filter((r) => r.band === band) : []
  return (same.length >= 5 ? same : rows).map((r) => r.price)
}

const itPercentile = (sorted, p) => {
  if (!sorted.length) return null
  const at = (sorted.length - 1) * p
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}

/** From the prices of the same product: { value: the lower quartile, median, n, source: 'market' }, or null under three. */
export function marketReferenceOf(prices) {
  let sorted = (Array.isArray(prices) ? prices : []).filter((p) => itFinite(p) && p > 0).sort((a, b) => a - b)
  if (sorted.length < INTEREST.MARKET_MIN) return null
  // What costs a third or three times the middle is another thing (an accessory, a lot, a mistake).
  const mid = itPercentile(sorted, 0.5)
  if (sorted.length >= 4) sorted = sorted.filter((p) => p >= mid / 3 && p <= mid * 3)
  if (sorted.length < INTEREST.MARKET_MIN) return null
  return { value: itR2(itPercentile(sorted, 0.25)), median: itR2(itPercentile(sorted, 0.5)), n: sorted.length, source: 'market' }
}

/** The reference from the AI's own estimate (the low end of its used range, a little lower still), or null. */
export function aiReferenceOf(card) {
  if (!card || !itFinite(card.usedLow) || card.usedLow <= 0) return null
  return { value: itR2(card.usedLow * INTEREST.AI_PRUDENCE), median: itR2((card.usedLow + (card.usedHigh || card.usedLow)) / 2), n: 0, source: 'ai' }
}

/* ───────── the score ───────── */

export const requiredMarginFor = (category) => (INTEREST.SURE.includes(category) ? INTEREST.MARGIN.A : INTEREST.MARGIN.B)

export function shippingFor(card) {
  const category = (card && card.category) || 'altro'
  if (card && itFinite(card.weightKg) && card.weightKg > 0) {
    const byWeight = INTEREST.SHIPPING_BY_WEIGHT.find(([upTo]) => card.weightKg <= upTo)[1]
    return Math.max(byWeight, INTEREST.SHIPPING_FLOOR[category] || 0)
  }
  return INTEREST.SHIPPING[category] ?? INTEREST.SHIPPING.altro
}

/** The highest listing price that leaves `marginPct` of the resale value (and at least `minProfit`), or null. */
export function buyPriceFor(resale, shipping, marginPct, minProfit = INTEREST.MIN_PROFIT) {
  if (!itFinite(resale) || resale <= 0) return null
  const profit = Math.max((resale * marginPct) / 100, minProfit)
  const price = (resale - profit - 0.7 - shipping) / 1.05
  return price >= 1 ? itR2(Math.floor(price * 2) / 2) : null
}

const IT_CONV = [[-0.3, 0], [0, 0.1], [0.4, 0.3], [0.7, 0.55], [1, 0.8], [1.3, 1]]
/** How good the price is, from the margin over the margin the user asks: 0.8 at his «sì», 1 a third above it. */
function convenienceOf(ratio) {
  if (ratio <= IT_CONV[0][0]) return 0
  for (let i = 1; i < IT_CONV.length; i++) {
    const [x1, y1] = IT_CONV[i]
    const [x0, y0] = IT_CONV[i - 1]
    if (ratio <= x1) return y0 + ((ratio - x0) / (x1 - x0)) * (y1 - y0)
  }
  return 1
}

function qualityOf(find, card) {
  const said = String(find.condition || '')
  let q = /nuovo con cartellino/i.test(said) ? 1 : /nuovo/i.test(said) ? 0.92 : /ottim/i.test(said) ? 0.8 : /buon/i.test(said) ? 0.6 : /discret|soddisfacent/i.test(said) ? 0.35 : 0.65
  const broken = IT_BROKEN.test(String(find.title || '')) || (card && card.risks.includes('difettoso'))
  if (broken) q = Math.min(q, 0.25)
  else if (card && card.defects.length) q = Math.max(0.2, q - 0.15 * card.defects.length)
  if (card && card.risks.includes('incompleto')) q = Math.max(0.2, q - 0.15)
  return { q, broken }
}

function demandOf(find) {
  const h = find.favourites
  if (!itFinite(h)) return 0.6
  const base = h <= 0 ? 0.45 : h <= 2 ? 0.55 : h <= 5 ? 0.65 : h <= 10 ? 0.75 : h <= 20 ? 0.85 : h <= 40 ? 0.93 : 1
  // Hearts that grew while the article was being watched say more than their number.
  return itClamp(base + (itFinite(find.heartsAtFirst) && h - find.heartsAtFirst >= 2 ? 0.05 : 0))
}

function negotiabilityOf(find, buy) {
  if (!itFinite(buy)) return { n: 0.3, discount: null }
  if (find.price <= buy + 1e-9) return { n: 1, discount: 0 }
  const discount = 1 - buy / find.price
  let n = discount <= 0.1 ? 0.85 : discount <= 0.2 ? 0.65 : discount <= 0.3 ? 0.45 : discount <= INTEREST.MAX_OFFER_DISCOUNT ? 0.25 : 0.05
  // A seller who paid to be seen, who already lowered the price, or whose article is still there after three
  // readings is more likely to come down.
  if (discount <= INTEREST.MAX_OFFER_DISCOUNT) n += (find.boost ? 0.05 : 0) + (itFinite(find.was) && find.was > find.price ? 0.05 : 0) + ((find.seen || 1) >= 3 ? 0.05 : 0)
  return { n: itClamp(n), discount }
}

/**
 * How much the article is the user's kind. `profile`: { categories: [keys], words: [brands, authors, words],
 * sizes: [..], likes: { 'brand:nike': 2, 'cat:libri': -1, … } } (likes: thumbs up minus thumbs down).
 */
export function pertinenceOf(find, card, profile) {
  if (find.vote === 1) return 1
  if (find.vote === -1) return 0.1
  const p = profile && typeof profile === 'object' ? profile : {}
  const cats = Array.isArray(p.categories) ? p.categories : []
  const category = (card && card.category) || null
  let v = cats.length && category ? (cats.includes(category) ? 0.85 : 0.45) : INTEREST.NEUTRAL
  const said = ` ${itWords(`${find.title || ''} ${find.brand || ''} ${(card && card.brand) || ''} ${(card && card.model) || ''}`).join(' ')} `
  const wanted = (Array.isArray(p.words) ? p.words : []).map((w) => itWords(w).join(' ')).filter((w) => w.length >= 2)
  if (wanted.some((w) => said.includes(` ${w} `))) v += 0.15
  const sizes = (Array.isArray(p.sizes) ? p.sizes : []).map((s) => String(s).toLowerCase().replace(/\s+/g, '')).filter(Boolean)
  if (sizes.length && find.size && ['abbigliamento', 'sneakers'].includes(category)) v += sizes.includes(String(find.size).toLowerCase().replace(/\s+/g, '')) ? 0.05 : -0.1
  const likes = p.likes && typeof p.likes === 'object' ? p.likes : {}
  const brand = itWords((card && card.brand) || find.brand || '').join(' ')
  const learned = (brand ? likes[`brand:${brand}`] || 0 : 0) + (category ? likes[`cat:${category}`] || 0 : 0)
  if (learned > 0) v += Math.min(0.15, 0.05 * learned)
  if (learned < 0) v -= Math.min(0.3, 0.1 * -learned)
  return itClamp(v, 0.05, 1)
}

const labelOf = (total) => INTEREST.LABELS.find(([min]) => total >= min)[1]

/**
 * The score of one article. `card`: the AI's card (null when there is none); `ref`: its reference (marketReferenceOf
 * or aiReferenceOf, null when there is none); `profile`: the user's interests; `match`: in a hunt, whether it is the
 * product searched ('si' | 'variante' | 'no').
 */
export function interestScore(find, { card = null, ref = null, profile = null, match = null } = {}) {
  const W = INTEREST.WEIGHTS
  const category = (card && card.category) || 'altro'
  const required = requiredMarginFor(category)
  const shipping = shippingFor(card)
  const price = find.price
  const { q, broken } = qualityOf(find, card)
  const d = demandOf(find)
  const v = INTEREST.NEUTRAL
  const p = match ? (match === 'si' ? 1 : match === 'variante' ? 0.6 : 0.1) : pertinenceOf(find, card, profile)
  const reasons = []
  let c = 0.4
  let margin = null
  let target = { buy: null, deal: null }
  let neg = { n: 0.3, discount: null }
  if (ref && itFinite(ref.value) && ref.value > 0 && itFinite(price) && price > 0) {
    const cost = itR2(price + vintedBuyerFee(price) + shipping)
    const profit = itR2(ref.value - cost)
    const pct = profit / ref.value
    margin = { resale: ref.value, cost, profit, pct: Math.round(pct * 100), required }
    c = convenienceOf(pct / (required / 100))
    if (profit < INTEREST.MIN_PROFIT) c = Math.min(c, 0.5)
    target = { buy: buyPriceFor(ref.value, shipping, required), deal: buyPriceFor(ref.value, shipping, required * 1.3) }
    neg = negotiabilityOf(find, target.buy)
    const about = ref.source === 'market' ? `${itEuro(ref.value)} (${ref.n} annunci uguali)` : `circa ${itEuro(ref.value)} (stima dell'AI)`
    if (profit >= INTEREST.MIN_PROFIT) reasons.push(`Rivendendo a ${about} restano ${itEuro(profit)} (${margin.pct}%)`)
    else if (profit > 0) reasons.push(`Rivendendo a ${about} restano solo ${itEuro(profit)}`)
    else reasons.push(`Rivendendo a ${about} perdi ${itEuro(-profit)}`)
    if (target.buy === null) reasons.push('Costa troppo poco per lasciare un margine da solo: vale in lotto')
    else if (neg.discount === 0) reasons.push(`Sotto il tuo prezzo di acquisto (${itEuro(target.buy)})`)
    else if (neg.discount <= INTEREST.MAX_OFFER_DISCOUNT) reasons.push(`Con un'offerta a ${itEuro(target.buy)} (−${Math.round(neg.discount * 100)}%) è da comprare`)
    else reasons.push(`Da comprare solo a ${itEuro(target.buy)}: sotto il minimo d'offerta di Vinted`)
  } else reasons.push('Non ho un valore di riferimento: non so dire se il prezzo è buono')

  let total = W.convenienza * c + W.domanda * d + W.qualita * q + W.trattabilita * neg.n + W.pertinenza * p + W.venditore * v
  // Without a good price the rest does not make an article worth buying to sell again.
  total = Math.min(total, 100 * (0.35 + 0.65 * c))
  const risks = card ? card.risks : []
  if (risks.includes('falso')) {
    total -= 12
    reasons.push('Marca molto contraffatta a questo prezzo: verifica che sia originale')
  }
  if (broken) reasons.push('Dichiarato difettoso o da riparare')
  else if (/nuovo/i.test(String(find.condition || ''))) reasons.push(find.condition)
  if (itFinite(find.favourites) && find.favourites >= 6) reasons.push(`${find.favourites} cuori`)
  if (itFinite(find.was) && find.was > price) reasons.push(`Calato da ${itEuro(find.was)}`)
  const provisional = !ref || ref.source !== 'market'
  if (!ref || risks.includes('non_identificato')) total = Math.min(total, INTEREST.UNKNOWN_CAP)
  else if (provisional) total = Math.min(total, INTEREST.PROVISIONAL_CAP)
  if (broken || match === 'no' || find.vote === -1) total = Math.min(total, INTEREST.REJECTED_CAP)
  total = Math.round(itClamp(total, 0, 100))
  return {
    total, label: labelOf(total), provisional,
    parts: { convenienza: itR2(c), domanda: itR2(d), qualita: itR2(q), trattabilita: itR2(neg.n), pertinenza: itR2(p), venditore: itR2(v) },
    margin, target, shipping, reasons: reasons.slice(0, 4),
  }
}

/** Best first: the score, then the sure ones before the provisional, then the profit, then the newest. */
export function rankByInterest(finds) {
  const score = (f) => (f.score && itFinite(f.score.total) ? f.score.total : -1)
  const profit = (f) => (f.score && f.score.margin ? f.score.margin.profit : -Infinity)
  return [...(Array.isArray(finds) ? finds : [])].sort((a, b) => score(b) - score(a) || Number(Boolean(a.score && a.score.provisional)) - Number(Boolean(b.score && b.score.provisional)) || profit(b) - profit(a) || (b.lastSeen || 0) - (a.lastSeen || 0))
}

/** What a thumb teaches: the article's brand and category move up or down by one. Returns the new `likes`. */
export function learnFromVote(likes, find, card, vote) {
  const out = { ...(likes && typeof likes === 'object' ? likes : {}) }
  const brand = itWords((card && card.brand) || find.brand || '').join(' ')
  const bump = (key) => { out[key] = Math.max(-5, Math.min(5, (out[key] || 0) + vote)) }
  if (brand) bump(`brand:${brand}`)
  if (card && card.category) bump(`cat:${card.category}`)
  return out
}
