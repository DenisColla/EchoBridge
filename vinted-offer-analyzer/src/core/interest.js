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
 * makes it «provvisorio» (70 at most), and an article whose price cannot be judged (not identified, no reference,
 * or asked many times its reference) stops under «da trattare» and is called «da verificare».
 *
 * Lots (1.18.2, from the first diary of real cards: «Ken il guerriero Deluxe Edition 1-4» at 130 € was compared with
 * single volumes at 40 €). Volumes of a series (books, comics) are compared piece by piece: the reference of a lot is
 * the price of one piece times its pieces. A lot of anything else keeps the AI's estimate of the whole.
 *
 * The user's own scores (1.19.0). On an article he may write the score he would give: that article takes it, and
 * the difference from the engine's own score moves the scores of the same category from then on (calibrationOf).
 *
 * The listing's own page (1.20). What reaches the list is first read on its page: the description (lots, defects,
 * what is missing — a second card by the AI), how long it has been there, when its seller was last seen and how he
 * is reviewed (listingFactsOf, kept on the find as `page`). A seller away for two weeks is not listed: he may never
 * ship. A search of the market is made only where it could change the verdict (lookupCouldMatter).
 *
 *   interestPrompt(items, { target })       → the prompt of one batch of cards
 *   cleanInterestCards(value, items)        → { id: card }
 *   listingFactsOf(extraction)              → what the listing's page says, to keep on the find (no seller's name)
 *   lookupCouldMatter(find, card, score)    → whether a search of the market could change the verdict
 *   calibrationOf(ratings)                  → { n, global, byCategory }: how far his scores are from the engine's
 *   seriesPiecesOf(title)                   → how many volumes a title sells (1, n, or null: a lot of unknown size)
 *   lotOf(find, card)                       → { pieces, series, comparable }
 *   comparablesOf(candidates, card, find)   → the prices of one piece of the same product among the results of a search
 *   marketReferenceOf(prices, { pieces })   → { value, median, n } (value: the lower quartile, times the pieces) or null
 *   referenceAmong(find, card, others)      → the same from other finds that are the same product (a hunt's results)
 *   aiReferenceOf(card)                     → the same from the AI's own estimate, marked as such
 *   interestScore(find, { card, ref, profile, match }) → { total, label, provisional, parts, margin, target, reasons }
 *   rankByInterest(finds)                   → best first
 */
import { vintedBuyerFee } from './costs.js'
import { SELLER_INACTIVE_DAYS, sellerProfileGuess, signalFromText } from './extract.js'
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
  /** An article whose price cannot be judged stays under «da trattare» (55): from CHECK_MIN up it is «da verificare». */
  UNKNOWN_CAP: 54,
  CHECK_MIN: 45,
  REJECTED_CAP: 40,
  /** Asked this many times what the same thing sells for (and at least ODD_PRICE_MIN €): it is likely another thing,
   *  a lot or a rare edition, and the loss the numbers would show is not a fact. */
  ODD_PRICE_TIMES: 2.5,
  ODD_PRICE_MIN: 15,
  /** What the user decided on 18 November 2026: the list shows from SHOW_MIN up, and an article from TELL_MIN up
   *  is told at once. (He may give his own score to any article shown.) */
  SHOW_MIN: 55,
  TELL_MIN: 70,
  /** A market read from fewer listings than this is thin; if it is also worth more than DISPUTE_TIMES the most the AI
   *  thought, the listings may be of another edition: the score stops at PROVISIONAL_CAP and says so (1.20.1). */
  THIN_MARKET: 8,
  DISPUTE_TIMES: 2,
  /** A defect the seller declares (underlined pages, a stain, a missing piece) lowers what the thing sells for again
   *  by this much of the market's value, each, up to DEFECT_CUT_MAX: the listings compared are mostly without it. An
   *  estimate, not a measure (1.20.2: a book at 15 € against 35 € was underlined in pen, and the score did not say). */
  DEFECT_CUT: 0.12,
  DEFECT_CUT_MAX: 0.3,
  /** One the seller calls slight («lieve piega», «riga sottile») cuts less (1.21.1: two of them took 24% off a book). */
  DEFECT_CUT_LIGHT: 0.05,
  /** His scores move those of a category by this much at most, and count as if this many neutral ones came before. */
  CALIBRATION_MAX: 12,
  CALIBRATION_PRIOR: 2,
  /** From this many scores on, what he says of everything counts in full for the categories he never scored. */
  CALIBRATION_WIDE: 6,
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
const itWords = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\+/g, ' plus ')
  // «12kg» and «12 kg» are the same two words.
  .replace(/(\d)(kg|gr|g|cm|mm|ml|cl|lt|l|gb|tb|mah)\b/g, '$1 $2').split(/[^a-z0-9]+/).filter(Boolean)
const itEuro = (v) => `${(Math.round(v * 100) / 100).toLocaleString('it-IT', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`
/** A defect said to be slight. */
const IT_LIGHT = /\b(liev[ei]|lievemente|legger[oaie]|leggermente|piccol[oaie]|piccolissim[oaie]|minim[oaie]|sottil[ei]|appena|quasi invisibil[ei]|impercettibil[ei])\b/i
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
          autore: { type: 'string' },
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
        required: ['id', 'categoria', 'tipo', 'marca', 'autore', 'modello', 'variante', 'cerca', 'parole', 'difetti', 'pezzi', 'peso_kg', 'nuovo', 'usato_min', 'usato_max', 'fiducia', 'rischi', 'corrisponde'],
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
  'Identità: usa solo ciò che c\'è nel testo. categoria: una delle voci ammesse (un manga, un fumetto o una graphic novel sono "fumetti_manga" anche quando il titolo non lo dice). tipo: che cos\'è, in 1-3 parole (es. "smartphone", "cuffie over-ear", "graphic novel", "piumino"). marca, modello, variante (memoria, taglia, edizione, volume, colore): stringa vuota se non ci sono; non inventare modelli.',
  'autore: per libri, fumetti e manga, l\'autore principale (nome e cognome) se è scritto nell\'annuncio o se lo conosci con certezza; stringa vuota in ogni altro caso e per le altre categorie.',
  'cerca: 2-5 parole per trovare lo stesso prodotto su Vinted, senza aggettivi né condizioni. parole: 1-3 parole minuscole che un annuncio dello stesso prodotto deve contenere: quelle che lo distinguono dagli altri della stessa marca o serie (il titolo, il modello), mai il tipo di oggetto né il colore. Esempi: ["s25","ultra"], ["1000xm5"], ["persepolis"]; per «Corto Maltese. Una ballata del mare salato» ["ballata","salato"] e non ["corto","maltese"]; per «Maglione SuitSupply merino» ["suitsupply","merino"] e non ["maglione"].',
  'Se il titolo nomina solo la serie, l\'autore o la marca senza dire quale volume o modello («Corto Maltese», «Fumetto», «Manubri»), il rischio è "non_identificato" e la fiducia bassa.',
  'difetti: difetti o mancanze dichiarati nel titolo (lista vuota se nessuno). pezzi: quanti articoli sono venduti insieme (1 se uno solo; "1-4", "vol. 1 2 3", "lotto di 5 libri", "serie completa" sono più pezzi: se il numero non è scritto, stimalo). peso_kg: il peso stimato del pacco in chili, per tutti i pezzi (0 se non sai stimarlo).',
  'Quando un annuncio porta anche la descrizione scritta dal venditore, vale più del titolo: dice quanti pezzi sono venduti, che cosa manca, i difetti, l\'edizione. Usala per pezzi, difetti, variante e prezzi.',
  'Prezzi in euro, dal tuo sapere sul mercato italiano, prudenti: nuovo = prezzo a cui si compra nuovo oggi; usato_min e usato_max = fascia a cui si vende tra privati NELLE CONDIZIONI DICHIARATE, per tutti i pezzi dell\'annuncio. Se non conosci il prodotto metti 0 e una fiducia bassa: è meglio 0 di un numero inventato.',
  'fiducia: da 0 a 1, quanto sei sicuro dell\'identificazione e dei prezzi. rischi: "falso" se è un articolo di marca molto contraffatto a un prezzo sospetto, "difettoso", "incompleto", "ricambio_accessorio" se l\'annuncio è un accessorio o un ricambio e non il prodotto, "non_identificato" se dal testo non si capisce che cos\'è.',
  'corrisponde: solo quando ti è dato che cosa cerca l\'utente: "si" se l\'annuncio è proprio quel prodotto, "variante" se è lo stesso modello in un\'altra versione, "no" se è altro; "nd" quando non ti è dato che cosa cerca.',
  'Rispondi solo con un oggetto JSON conforme allo schema.',
].join('\n')

/** One batch of cards. `items`: finds ({ id, title, brand, size, condition, price }); `target`: what a hunt looks for. */
export function interestPrompt(items, { target = '' } = {}) {
  // The description comes from the listing's page, when it was read: with it the card is the second, closer one.
  const said = (f) => (f.page && f.page.description ? ` | descrizione: ${scrubContacts(String(f.page.description).slice(0, 400))}` : '')
  const line = (f) => `#${f.id} | ${scrubContacts(String(f.title || '').slice(0, 140))} | marca: ${f.brand || 'n.d.'} | taglia: ${f.size || 'n.d.'} | condizioni: ${f.condition || 'n.d.'} | ${itFinite(f.price) ? `${f.price} €` : 'prezzo n.d.'}${said(f)}`
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
/** A number however the model wrote it (230, "230", "230,50 €"); NaN when it is none. */
const itNumber = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /\d/.test(v) ? Number(v.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.').replace(/[^\d.]/g, '')) : NaN)
const itMoney = (v) => {
  const n = itNumber(v)
  return itFinite(n) && n > 0 && n < 100000 ? itR2(n) : 0
}
/** A list however the model wrote it: a list, or one text with commas. */
const itList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(/[,;]+/) : []).filter((x) => typeof x === 'string')
const IT_CONFIDENCE_WORDS = { alta: 0.85, media: 0.6, bassa: 0.3 }

/**
 * The AI's answer → { id: card }, with every field in its place and nothing that was not asked for. It forgives what a
 * model gets wrong in a long answer (a number written as text, a list as one text, a missing field): one card that is
 * off must not lose the other nine.
 */
export function cleanInterestCards(value, items) {
  const known = new Set((Array.isArray(items) ? items : []).map((f) => String(f.id)))
  const out = {}
  for (const raw of value && Array.isArray(value.items) ? value.items : []) {
    if (!raw || typeof raw !== 'object') continue
    const id = String(raw.id ?? '').replace(/^#/, '').trim()
    if (!known.has(id) || out[id]) continue
    const lo = itMoney(raw.usato_min)
    const hi = itMoney(raw.usato_max)
    const pieces = Math.round(itNumber(raw.pezzi))
    const weight = itNumber(raw.peso_kg)
    const sure = itNumber(raw.fiducia)
    const match = itText(raw.corrisponde, 12).toLowerCase().replace('sì', 'si')
    out[id] = {
      category: INTEREST_CATEGORIES.includes(raw.categoria) ? raw.categoria : 'altro',
      kind: itText(raw.tipo, 40), brand: itText(raw.marca, 40), author: itText(raw.autore, 40), model: itText(raw.modello, 60), variant: itText(raw.variante, 40),
      query: itText(raw.cerca, 60), words: itList(raw.parole).map((w) => itWords(w).join(' ')).filter(Boolean).slice(0, 3),
      defects: itList(raw.difetti).map((d) => itText(d, 60)).filter(Boolean).slice(0, 4),
      pieces: pieces > 1 && pieces < 200 ? pieces : 1,
      weightKg: itFinite(weight) && weight > 0 && weight < 100 ? itR2(weight) : 0,
      newPrice: itMoney(raw.nuovo), usedLow: lo && hi ? Math.min(lo, hi) : lo || hi, usedHigh: lo && hi ? Math.max(lo, hi) : hi || lo,
      confidence: itFinite(sure) ? itClamp(sure > 1.5 ? sure / 100 : sure) : IT_CONFIDENCE_WORDS[itText(raw.fiducia, 10).toLowerCase()] ?? 0.3,
      risks: itList(raw.rischi).map((r) => r.trim()).filter((r) => INTEREST_RISKS.includes(r)),
      match: ['si', 'variante', 'no'].includes(match) ? match : null,
    }
  }
  return out
}

/* ───────── the reference: what the same product sells for ───────── */

export const SELLER_AWAY_DAYS = SELLER_INACTIVE_DAYS

/** «disco» and «dischi», «maglia» and «maglie»: one word, when two titles are compared (1.20.1). */
const itStem = (w) => {
  if (!/^[a-z]{4,}$/.test(w)) return w
  const cut = w.replace(/[aeiou]+$/, '').replace(/h$/, '')
  return cut.length >= 3 ? cut : w
}

const itBand = (condition) => (/nuovo/i.test(String(condition || '')) ? 'new' : /ottim|buon|discret|soddisfacent/i.test(String(condition || '')) ? 'used' : null)

/* ───────── lots: how many pieces a listing sells ───────── */

/** Where a lot is pieces of one series (volumes) and is worth its pieces; elsewhere a lot is a thing of its own. */
const IT_SERIES = ['libri', 'fumetti_manga']
const IT_NUM = '(?<!\\d)\\d{1,3}(?!\\d)'
/** After a number, what makes it a measure (an age, a size, a weight) and not a count of volumes. */
const IT_MEASURE = '(?!\\s*(?:anni|anno|mesi|years|ans|mois|cm|mm|kg|gr?\\b|ml|euro|€|pagine|pag\\b|ore\\b|%))'
const IT_COUNTED = new RegExp('(?<!\\d)(\\d{1,2})\\s*(?:volumi|vol|libri|numeri|albi|fumetti|tomi|romanzi)\\b')
const IT_SPAN = new RegExp(`\\bdal?\\s+(${IT_NUM})\\s+al?\\s+(${IT_NUM})${IT_MEASURE}`)
const IT_LISTED = new RegExp(`\\b(?:volumi|volume|vol|numeri|nn|n°)\\.?\\s*(${IT_NUM}(?:\\s*(?:[-/,+&]|\\be\\b)?\\s*${IT_NUM})+)${IT_MEASURE}`)
const IT_GROUP = new RegExp(`(${IT_NUM}(?:\\s*(?:[-/,+&]|\\be\\b)\\s*${IT_NUM})+)${IT_MEASURE}`)
const IT_LOT_UNKNOWN = /\b(lotto|lotti|stock|bundle|blocco|serie completa|collezione completa|collana completa|intera serie|tutti i volumi|tutta la serie)\b/i
const IT_LOT_MAX = 150

/** «1-4» → 4, «1/10» → 10, «1, 2, 3» → 3, «1 e 2» → 2; 1 when the numbers are not a run of volumes («24/7»). */
function itRunOf(group) {
  const nums = group.match(/\d+/g).map(Number)
  if (nums.length === 2 && /^\d+\s*[-/]\s*\d+$/.test(group.trim())) return nums[1] > nums[0] ? nums[1] - nums[0] + 1 : 1
  return nums.every((n, i) => i === 0 || n > nums[i - 1]) ? nums.length : 1
}

/**
 * How many volumes the title of a book or a comic sells: «Ken il guerriero 1-4» → 4, «3 volumi» → 3,
 * «dal 1 al 10» → 10, «vol. 1 2 3» → 3; 1 for one volume; null for a lot that does not say how many
 * («lotto fumetti», «serie completa»). Ages and measures are not counts («3-6 anni»).
 */
export function seriesPiecesOf(title) {
  const said = String(title || '').toLowerCase().replace(/[–—]/g, '-')
  const sane = (n) => (n >= 2 && n <= IT_LOT_MAX ? n : null)
  const counted = IT_COUNTED.exec(said)
  if (counted && sane(Number(counted[1]))) return Number(counted[1])
  const span = IT_SPAN.exec(said)
  if (span && sane(Number(span[2]) - Number(span[1]) + 1)) return Number(span[2]) - Number(span[1]) + 1
  const group = IT_LISTED.exec(said) || IT_GROUP.exec(said)
  if (group && sane(itRunOf(group[1]))) return itRunOf(group[1])
  return IT_LOT_UNKNOWN.test(said) ? null : 1
}

/**
 * What kind of lot a find is: { pieces: how many (1 for one article, null when a lot does not say), series: its
 * pieces are volumes of a series, comparable: its market can be read from a search }. A lot is compared only as
 * volumes of a series, piece by piece; a lot of anything else keeps the AI's estimate of the whole.
 */
export function lotOf(find, card) {
  const series = IT_SERIES.includes((card && card.category) || 'altro')
  const title = String((find && find.title) || '')
  const said = card && itFinite(card.pieces) && card.pieces >= 2 ? Math.min(Math.round(card.pieces), IT_LOT_MAX) : null
  let pieces
  if (series) {
    const read = seriesPiecesOf(title)
    // What the title says first; then what the AI understood («trilogia completa» → 3).
    pieces = read === null ? said : read >= 2 ? read : said || 1
  } else pieces = said || (IT_LOT.test(title) ? null : 1)
  return { pieces, series, comparable: pieces === 1 || (series && pieces !== null) }
}

/**
 * The same product among the results of a search (catalog.js candidates): the titles carry the card's words, are not
 * accessories, do not differ on capacity, size or model number, and are in the same state (new or used) when enough
 * are. Returns the prices of ONE piece: for a single article the lots are left out; for a lot of volumes every
 * listing counts by its price a volume. Empty for a lot that cannot be compared (see lotOf).
 */
export function comparablesOf(candidates, card, find) {
  const must = (card && Array.isArray(card.words) ? card.words : []).flatMap((w) => itWords(w))
  if (!must.length) return []
  const lot = lotOf(find, card)
  if (!lot.comparable) return []
  const accessory = card.risks && card.risks.includes('ricambio_accessorio')
  const rows = []
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c || !itFinite(c.price) || c.price <= 0 || String(c.id) === String(find.id)) continue
    const said = itWords(`${c.title || ''} ${c.brand || ''}`)
    const joined = ` ${said.join(' ')} `
    const stems = new Set(said.map(itStem))
    // «1000xm5» also matches «wh-1000xm5» written as one word, «s25» does not match «s25fe»; «disco» matches
    // «dischi» but not «discoteca» (a word with no digit is found inside another only when digits follow it).
    const glued = (w) => w.length >= 5 && (/\d/.test(w) ? joined.includes(w) : said.some((t) => t.startsWith(w) && /^\d+$/.test(t.slice(w.length))))
    if (!must.every((w) => said.includes(w) || stems.has(itStem(w)) || glued(w))) continue
    if (!accessory && IT_ACCESSORY.some((w) => joined.includes(` ${w} `))) continue
    if (IT_BROKEN.test(String(c.title || ''))) continue
    let price = c.price
    if (lot.series) {
      // Volumes of one series cost alike whatever their number: no conflict of «model» between volume 3 and 7.
      const pieces = seriesPiecesOf(c.title)
      if (pieces === null || (pieces > 1 && lot.pieces === 1)) continue
      price = c.price / pieces
    } else {
      if (IT_LOT.test(String(c.title || ''))) continue
      if (attributeConflict(find.title || '', c.title || '')) continue
    }
    rows.push({ price, band: itBand(c.condition) })
  }
  const band = find.band || itBand(find.condition)
  const same = band ? rows.filter((r) => r.band === band) : []
  return (same.length >= 5 ? same : rows).map((r) => itR2(r.price))
}

const itPercentile = (sorted, p) => {
  if (!sorted.length) return null
  const at = (sorted.length - 1) * p
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}

/**
 * From the prices of one piece of the same product: { value: the lower quartile, median, n, source: 'market' }, or
 * null under three. For a lot of `pieces` volumes value and median are of the whole lot, with `unit` and `pieces`.
 */
export function marketReferenceOf(prices, { pieces = 1 } = {}) {
  let sorted = (Array.isArray(prices) ? prices : []).filter((p) => itFinite(p) && p > 0).sort((a, b) => a - b)
  if (sorted.length < INTEREST.MARKET_MIN) return null
  // What costs a third or three times the middle is another thing (an accessory, a lot, a mistake).
  const mid = itPercentile(sorted, 0.5)
  if (sorted.length >= 4) sorted = sorted.filter((p) => p >= mid / 3 && p <= mid * 3)
  if (sorted.length < INTEREST.MARKET_MIN) return null
  const many = itFinite(pieces) && pieces > 1 ? Math.round(pieces) : 1
  const unit = itPercentile(sorted, 0.25)
  const ref = { value: itR2(unit * many), median: itR2(itPercentile(sorted, 0.5) * many), n: sorted.length, source: 'market' }
  return many > 1 ? { ...ref, unit: itR2(unit), pieces: many } : ref
}

/**
 * The reference of a find from other finds that are the same product (`others`: finds with their card, as a hunt's
 * own results): piece by piece as in comparablesOf. Null when the find cannot be compared or the others are few.
 */
export function referenceAmong(find, card, others) {
  const lot = lotOf(find, card)
  if (!lot.comparable) return null
  const prices = []
  for (const o of Array.isArray(others) ? others : []) {
    if (!o || !itFinite(o.price) || o.price <= 0) continue
    const other = lotOf(o, o.card || null)
    if (!other.comparable || (other.pieces > 1 && lot.pieces === 1)) continue
    prices.push(o.price / other.pieces)
  }
  return marketReferenceOf(prices, { pieces: lot.pieces })
}

/**
 * How much a search of the market is worth for a find, to choose the few done at each reading: first what is close
 * to a buy (the search makes it sure), then what the AI's estimate explains worst (asked many times its estimate),
 * then where many want it and where more money is at stake.
 */
export function lookupWorthOf(find, score) {
  const hearts = itFinite(find.favourites) ? Math.max(0, find.favourites) : 0
  const price = itFinite(find.price) ? Math.max(0, find.price) : 0
  return (score && score.total >= 55 ? 100 : 0) + (score && score.unsure === 'prezzo' ? 15 : 0) + 12 * Math.log1p(hearts) + 8 * Math.log1p(price)
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
 * product searched ('si' | 'variante' | 'no'). In the result `unsure` says why the price could not be judged
 * ('riferimento' | 'prezzo' | 'identita'), or is null. `calibration` (calibrationOf): what the user's own scores
 * taught. In the result `base` is the engine's score before that, and `rated` says the total is the score the user
 * gave to this very article (`find.rated`).
 */
export function interestScore(find, { card = null, ref = null, profile = null, match = null, calibration = null } = {}) {
  const W = INTEREST.WEIGHTS
  const category = (card && card.category) || 'altro'
  const required = requiredMarginFor(category)
  const shipping = shippingFor(card)
  const price = find.price
  const { q, broken } = qualityOf(find, card)
  const d = demandOf(find)
  // The seller, once the listing's page was read: neutral until then.
  const page = find.page && typeof find.page === 'object' ? find.page : null
  const seller = page ? sellerProfileGuess({ lastSeenDays: itFinite(page.sellerDays) ? page.sellerDays : null, feedbackCount: itFinite(page.reviews) ? page.reviews : null, rating: itFinite(page.rating) ? page.rating : null }) : null
  const v = !seller ? INTEREST.NEUTRAL : seller.id === 'expert' ? 1 : seller.id === 'inactive' ? 0.1 : seller.id === 'quiet' ? 0.4 : seller.id === 'new_seller' ? 0.5 : INTEREST.NEUTRAL
  const p = match ? (match === 'si' ? 1 : match === 'variante' ? 0.6 : 0.1) : pertinenceOf(find, card, profile)
  const reasons = []
  let c = 0.4
  let margin = null
  let target = { buy: null, deal: null }
  let neg = { n: 0.3, discount: null }
  // Why the price cannot be judged, when it cannot: 'riferimento' (no value to compare with), 'prezzo' (asked many
  // times what the same thing sells for), 'identita' (the AI did not understand what it is).
  let unsure = null
  const known = ref && itFinite(ref.value) && ref.value > 0 && itFinite(price) && price > 0
  // What the seller declares as defects: the AI's own estimate has read them already, the market's listings have not.
  const defects = card && !broken && Array.isArray(card.defects) ? card.defects : []
  const cut = known && ref.source === 'market' && defects.length ? itR2(Math.min(INTEREST.DEFECT_CUT_MAX, defects.reduce((sum, d) => sum + (IT_LIGHT.test(d) ? INTEREST.DEFECT_CUT_LIGHT : INTEREST.DEFECT_CUT), 0))) : 0
  const worth = known ? itR2(ref.value * (1 - cut)) : null
  // What the same thing sells for at most: the middle of the market, or the top of the AI's range.
  const usual = !known ? null : ref.source === 'market' ? ref.median : card && itFinite(card.usedHigh) && card.usedHigh > 0 ? card.usedHigh : ref.value / INTEREST.AI_PRUDENCE
  if (known && price >= INTEREST.ODD_PRICE_MIN && itFinite(usual) && usual > 0 && price >= INTEREST.ODD_PRICE_TIMES * usual) {
    // The numbers would say a heavy loss; more likely the listing is not what the reference prices.
    unsure = 'prezzo'
    const times = price / usual
    const lot = (ref.pieces || (card && card.pieces) || 1) > 1
    reasons.push(`Chiesto ${(times >= 10 ? Math.round(times) : Math.round(times * 10) / 10).toLocaleString('it-IT')} volte ${ref.source === 'market' ? `il prezzo di ${ref.n} annunci uguali` : 'la stima dell\'AI'} (${itEuro(usual)}): ${lot ? 'forse un\'edizione rara' : 'forse un lotto o un\'edizione particolare'}, da aprire`)
  } else if (known) {
    const cost = itR2(price + vintedBuyerFee(price) + shipping)
    const profit = itR2(worth - cost)
    const pct = profit / worth
    margin = { resale: worth, cost, profit, pct: Math.round(pct * 100), required }
    c = convenienceOf(pct / (required / 100))
    if (profit < INTEREST.MIN_PROFIT) c = Math.min(c, 0.5)
    target = { buy: buyPriceFor(worth, shipping, required), deal: buyPriceFor(worth, shipping, required * 1.3) }
    neg = negotiabilityOf(find, target.buy)
    // What the seller wrote, and a listing that has been there a month, move how likely an offer is to pass.
    if (page && neg.discount !== null && neg.discount > 0 && neg.discount <= INTEREST.MAX_OFFER_DISCOUNT) {
      neg = { ...neg, n: itClamp(neg.n + (page.says === 'open_to_offers' || page.says === 'clearing_out' ? 0.1 : 0) + (itFinite(page.ageDays) && page.ageDays >= 30 ? 0.05 : 0)) }
    }
    const about = ref.source !== 'market' ? `circa ${itEuro(ref.value)} (stima dell'AI)`
      : ref.pieces > 1 ? `${itEuro(worth)} (${ref.pieces} pezzi a ${itEuro(ref.unit)}, da ${ref.n} annunci${cut ? `, −${Math.round(cut * 100)}% difetti` : ''})`
        : cut ? `${itEuro(worth)} (${ref.n} annunci a ${itEuro(ref.value)}, −${Math.round(cut * 100)}% difetti)` : `${itEuro(worth)} (${ref.n} annunci uguali)`
    if (profit >= INTEREST.MIN_PROFIT) reasons.push(`Rivendendo a ${about} restano ${itEuro(profit)} (${margin.pct}%)`)
    else if (profit > 0) reasons.push(`Rivendendo a ${about} restano solo ${itEuro(profit)}`)
    else reasons.push(`Rivendendo a ${about} perdi ${itEuro(-profit)}`)
    if (target.buy === null) reasons.push('Si rivende a troppo poco per lasciare un margine da solo: vale in lotto')
    else if (neg.discount === 0) reasons.push(`Sotto il tuo prezzo di acquisto (${itEuro(target.buy)})`)
    else if (neg.discount <= INTEREST.MAX_OFFER_DISCOUNT) reasons.push(`Con un'offerta a ${itEuro(target.buy)} (−${Math.round(neg.discount * 100)}%) è da comprare`)
    else reasons.push(`Da comprare solo a ${itEuro(target.buy)}: sotto il minimo d'offerta di Vinted`)
  } else {
    unsure = 'riferimento'
    reasons.push('Non ho un valore di riferimento: non so dire se il prezzo è buono')
  }

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
  if (!unsure && risks.includes('non_identificato')) unsure = 'identita'
  // No offer Vinted allows makes it a buy (or nothing does): it is not «da trattare», whatever the rest says.
  // The seller writes that the price is fixed, and at that price it is not a buy: no offer will make it one.
  const fixed = Boolean(page && page.says === 'fixed_price' && neg.discount !== null && neg.discount > 0)
  // A seller not seen for two weeks may never answer nor ship: the money comes back, days later.
  const away = Boolean(seller && seller.id === 'inactive')
  // A market of a few listings worth much more than the AI thought: they may be of another edition (1.20.1).
  const most = card && itFinite(card.usedHigh) && card.usedHigh > 0 ? card.usedHigh : null
  const disputed = Boolean(margin !== null && !unsure && ref.source === 'market' && itFinite(ref.n) && ref.n < INTEREST.THIN_MARKET && most !== null && ref.value > INTEREST.DISPUTE_TIMES * most)
  if (disputed) reasons.splice(1, 0, `Solo ${ref.n} annunci di confronto, e l'AI stimava ${itEuro(card.usedLow > 0 ? card.usedLow : most)}–${itEuro(most)}: controlla che sia la stessa edizione`)
  const noDeal = !unsure && margin !== null && (target.buy === null || fixed || away || (neg.discount !== null && neg.discount > INTEREST.MAX_OFFER_DISCOUNT))
  if (away) reasons.splice(1, 0, `Venditore assente da ${Math.round(page.sellerDays)} giorni: può non spedire`)
  else if (fixed) reasons.splice(1, 0, 'Il venditore scrive che il prezzo non è trattabile')
  // Said right after the price, before any other caution: it is often the reason of a low price.
  if (defects.length) reasons.splice(1, 0, `Difetti dichiarati: ${defects.slice(0, 2).join(', ')}`)
  else if (seller && seller.id === 'expert') reasons.push(`Venditore solido (${page.reviews} recensioni)`)
  else if (seller && seller.id === 'quiet') reasons.push(`Venditore visto ${Math.round(page.sellerDays)} giorni fa`)
  if (page && !away && !fixed && (page.says === 'open_to_offers' || page.says === 'clearing_out') && neg.discount) reasons.push(page.says === 'clearing_out' ? 'Il venditore sta svuotando l\'armadio' : 'L\'annuncio invita a fare offerte')
  const capped = (raw) => {
    let t = raw
    if (unsure || noDeal) t = Math.min(t, INTEREST.UNKNOWN_CAP)
    else if (provisional || disputed) t = Math.min(t, INTEREST.PROVISIONAL_CAP)
    if (broken || match === 'no' || find.vote === -1) t = Math.min(t, INTEREST.REJECTED_CAP)
    return Math.round(itClamp(t, 0, 100))
  }
  // The engine's own score, and the same moved by what the user's scores taught for this category.
  const base = capped(total)
  const rated = itFinite(find.rated) ? Math.round(itClamp(find.rated, 0, 100)) : null
  // Whole points: half a point taught by a score on something else moves nothing.
  total = rated !== null ? rated : capped(total + Math.round(calibrationFor(calibration, category)))
  if (rated !== null) reasons.unshift(rated === base ? `Il tuo voto: ${rated}, come il mio` : `Il tuo voto: ${rated} (il mio era ${base})`)
  return {
    // What cannot be judged is never «da trattare»: it is to be looked at, or left. The user's own score is his.
    total, base, shift: rated !== null ? 0 : total - base, rated: rated !== null,
    label: rated !== null ? labelOf(total) : unsure ? (total >= INTEREST.CHECK_MIN ? 'da verificare' : 'lascia') : labelOf(total), provisional, unsure,
    parts: { convenienza: itR2(c), domanda: itR2(d), qualita: itR2(q), trattabilita: itR2(neg.n), pertinenza: itR2(p), venditore: itR2(v) },
    margin, target, shipping, reasons: reasons.slice(0, 4), read: Boolean(page), seller: seller ? seller.id : null, disputed,
  }
}

/* ───────── the listing's own page ───────── */

/**
 * What the page of a listing says, to keep on the find (`page`). `extraction`: parseVintedItemHtml(html). →
 * { price, description, category, ageDays, sellerDays, reviews, rating, business, reserved, oldPrice, says } or null
 * when the page carries no listing. Never the seller's name: only how long he has been away and how he is reviewed.
 */
export function listingFactsOf(extraction) {
  const ex = extraction && typeof extraction === 'object' ? extraction : null
  if (!ex || (!ex.title && !itFinite(ex.listPrice))) return null
  const signals = ex.signals && typeof ex.signals === 'object' ? ex.signals : {}
  const num = (x) => (itFinite(x) ? x : null)
  return {
    price: itFinite(ex.listPrice) && ex.listPrice > 0 ? ex.listPrice : null,
    description: scrubContacts(String(ex.description || '')).replace(/\s+/g, ' ').trim().slice(0, 400),
    category: String(ex.categoryText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    ageDays: num(ex.uploadedDays), sellerDays: num(ex.sellerLastSeenDays), reviews: num(ex.sellerFeedbackCount), rating: num(ex.sellerRating),
    business: ex.sellerBusiness === true, reserved: signals.reserved === true, oldPrice: num(signals.oldPrice),
    says: signalFromText(`${ex.title || ''} ${ex.description || ''}`).id,
  }
}

/**
 * Whether a search of the market could change what is said of an article (1.20): it could if the article would be
 * worth an offer were it sold for twice the most the AI thinks, or if its price is one the estimate does not
 * explain. A paperback at 4 € is not searched: the searches the app makes are few, and are made with the user's own
 * session. With no estimate at all, only what is not a trifle.
 */
export function lookupCouldMatter(find, card, score = null) {
  if (!card || !find || !itFinite(find.price)) return false
  if (score && score.unsure === 'prezzo') return true
  const most = itFinite(card.usedHigh) && card.usedHigh > 0 ? card.usedHigh : itFinite(card.usedLow) && card.usedLow > 0 ? card.usedLow : null
  if (most === null) return find.price >= 10 || (itFinite(find.favourites) && find.favourites >= 10)
  const plain = { ...find }
  delete plain.rated
  delete plain.vote
  delete plain.page
  const best = interestScore(plain, { card, ref: { value: most * 2, median: most * 2, n: INTEREST.MARKET_MIN, source: 'market' } })
  return best.total >= INTEREST.SHOW_MIN || best.unsure === 'prezzo'
}

/* ───────── the user's own scores ───────── */

/**
 * What the user's scores taught. `ratings`: [{ category, system, user }] — on an article of `category` the engine
 * said `system` and he said `user`. → { n, global, byCategory: { category: points } }: how many points the scores
 * move from now on.
 * A category he scored moves by the mean of his differences there, pulled toward zero when they are few
 * (CALIBRATION_PRIOR: one score moves a third of its difference, five alike about 70%). The categories he never
 * scored move by `global`, the same mean over everything he scored, pulled harder and counted in full only from
 * CALIBRATION_WIDE scores on: one score on a pair of shoes says little about headphones. Never more than
 * CALIBRATION_MAX points.
 */
export function calibrationOf(ratings) {
  const rows = (Array.isArray(ratings) ? ratings : []).filter((r) => r && itFinite(r.user) && itFinite(r.system))
  const K = INTEREST.CALIBRATION_PRIOR
  const M = INTEREST.CALIBRATION_MAX
  const far = (r) => itClamp(r.user - r.system, -40, 40)
  const round = (x) => Math.round(itClamp(x, -M, M) * 10) / 10
  const global = rows.length ? (rows.reduce((sum, r) => sum + far(r), 0) / (rows.length + 2 * K)) * Math.min(1, rows.length / INTEREST.CALIBRATION_WIDE) : 0
  const sums = {}
  for (const r of rows) {
    const c = typeof r.category === 'string' && r.category ? r.category : 'altro'
    sums[c] = sums[c] || { sum: 0, n: 0 }
    sums[c].sum += far(r)
    sums[c].n += 1
  }
  const byCategory = {}
  for (const [c, { sum, n }] of Object.entries(sums)) byCategory[c] = round(sum / (n + K))
  return { n: rows.length, global: round(global), byCategory }
}

/** The points of `category` in a calibration: its own, or what he says of everything. */
function calibrationFor(calibration, category) {
  if (!calibration || typeof calibration !== 'object') return 0
  const own = calibration.byCategory && calibration.byCategory[category]
  return itFinite(own) ? own : itFinite(calibration.global) ? calibration.global : 0
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
