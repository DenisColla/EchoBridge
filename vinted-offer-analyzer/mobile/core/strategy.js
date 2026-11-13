/**
 * Best-price strategy (app 1.8). The goal is the lowest price actually paid, never «do not offer»:
 *   1. sellerProfileFor reads everything known about the seller (reviews, wardrobe size and prices, cadence, text of the
 *      listing, activity) and classifies them as facile / medio / difficile, with the traits that decided it;
 *   2. strategyFor builds three proposals (prudente, consigliata, audace) centred on the seller type, each with the
 *      acceptance probability, the chance of a counter-offer and the average price paid, and marks the cheapest on
 *      average;
 *   3. the plan of moves follows the type: a difficult seller gets everything (heart, convincing message, offer), an
 *      easy one gets the offer straight away;
 *   4. the moment: a fresh listing or a seller who is online now is answered now, the evening slots are for old
 *      listings.
 * Probabilities start from the engine and are pulled towards the user's own history at that depth of discount
 * (experienceOf): a dozen outcomes already say more than any prior about «their» sellers.
 */
import { CATEGORIES, VINTED } from './constants.js'
import { analyzeOffer, parsePrice } from './analyze.js'
import { formatEuro } from './messages.js'
import { policyAgeTierOf, policyBandOf, precisePriceFor } from './policy.js'

const stFinite = (v) => typeof v === 'number' && Number.isFinite(v)
const stClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const stR2 = (v) => Math.round(v * 100) / 100
const stLogit = (p) => Math.log(p / (1 - p))
const stSquash = (z) => 1 / (1 + Math.exp(-z))
const stMedian = (values) => {
  const a = values.filter(stFinite).sort((x, y) => x - y)
  if (!a.length) return null
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2
}

export const STRATEGY = Object.freeze({
  /** Discount points of the «consigliata» by price band × listing age, before the seller type moves the centre. */
  TABLE: {
    under_12: { fresh: 15, mid: 17, old: 20 },
    from_12_to_20: { fresh: 15, mid: 17, old: 20 },
    from_20_to_40: { fresh: 13, mid: 16, old: 19 },
    from_40_to_100: { fresh: 12, mid: 15, old: 19 },
    over_100: { fresh: 10, mid: 14, old: 18 },
  },
  /** The seller type moves the centre of the three proposals and the acceptance odds (logit). */
  TYPE_SHIFT_PTS: { facile: 4, medio: 0, difficile: -4 },
  TYPE_LOGIT: { facile: 0.4, medio: 0, difficile: -0.4 },
  PRUDENT_STEP_PTS: 6,
  BOLD_STEP_PTS: 9,
  MIN_PTS: 4,
  MAX_CENTER_PTS: 30,
  /** Score thresholds of the seller type. */
  EASY_SCORE: 1.5,
  HARD_SCORE: -1.5,
  /** The user's own outcomes by depth of discount: band upper bounds (%), prior weight and cap of the counts. */
  BANDS: [{ id: 'd10', max: 12.5, counter: 0.05 }, { id: 'd20', max: 22.5, counter: 0.1 }, { id: 'd30', max: 32.5, counter: 0.2 }, { id: 'd40', max: Infinity, counter: 0.3 }],
  PRIOR_WEIGHT: 4,
  MAX_COUNT: 12,
  /** A seller's counter-offer gives back this share of the distance on average (the user's own history: 0,42). */
  COUNTER_GIVE_SHARE: 0.42,
  /** Online within this many days (72 minutes) = «adesso»; a listing younger than FRESH_DAYS is answered today. */
  ONLINE_DAYS: 0.05,
  FRESH_DAYS: 3,
  LOW_BUDGET_EUR: 15,
})

/* ───────── wardrobe ───────── */

const stNum = (v) => {
  if (stFinite(v)) return v
  if (typeof v !== 'string') return null
  const m = v.replace(/\./g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

/**
 * Normalises what the in-app browser read on the seller's wardrobe page. Every field is optional and nullable:
 * { itemCount, soldCount, followers, feedbackCount, prices: number[], ageDays: number[], newWithTags, bundleDiscountPct,
 *   sampleCount, medianPrice, lowBudgetShare, staleShare }.
 */
export function wardrobeStats(raw) {
  if (!raw || typeof raw !== 'object') return null
  const prices = (Array.isArray(raw.prices) ? raw.prices : []).map(stNum).filter((v) => stFinite(v) && v > 0 && v < 100000)
  const ages = (Array.isArray(raw.ageDays) ? raw.ageDays : []).map(stNum).filter((v) => stFinite(v) && v >= 0)
  const itemCount = stNum(raw.itemCount)
  const bundleText = typeof raw.bundleText === 'string' ? raw.bundleText : ''
  const bundleFromText = /lott|bundle|pi[uù] articoli/i.test(bundleText) ? stNum((bundleText.match(/(\d{1,2})\s?%/) || [])[1]) : null
  const bundle = stNum(raw.bundleDiscountPct) ?? bundleFromText
  const out = {
    itemCount: stFinite(itemCount) ? itemCount : prices.length || null,
    soldCount: stNum(raw.soldCount),
    followers: stNum(raw.followers),
    feedbackCount: stNum(raw.feedbackCount),
    newWithTags: stNum(raw.newWithTags),
    bundleDiscountPct: stFinite(bundle) && bundle > 0 && bundle <= 60 ? bundle : null,
    bundleOffered: bundle !== null || /lott|bundle/i.test(bundleText) || raw.bundleOffered === true,
    sampleCount: prices.length,
    medianPrice: stMedian(prices),
    lowBudgetShare: prices.length ? prices.filter((p) => p <= STRATEGY.LOW_BUDGET_EUR).length / prices.length : null,
    staleShare: ages.length ? ages.filter((d) => d > 60).length / ages.length : null,
  }
  return Object.values(out).some((v) => v !== null && v !== false && v !== 0) ? out : null
}

/**
 * The wardrobe as the in-app browser's probe read it on the seller's page ({ kind: 'member', cards, prices,
 * itemCountText, followersText, feedbackText, bundleText, flight }) → wardrobeStats, or null when it read nothing.
 */
export function wardrobeFromProbe(details) {
  if (!details || typeof details !== 'object' || details.kind !== 'member') return null
  const fl = details.flight && typeof details.flight === 'object' ? details.flight : {}
  const pick = (a, b) => (stFinite(a) ? a : stNum(b))
  return wardrobeStats({
    itemCount: pick(fl.item_count, details.itemCountText) ?? (stFinite(details.cards) && details.cards > 0 ? details.cards : null),
    soldCount: stFinite(fl.given_item_count) ? fl.given_item_count : null,
    followers: pick(fl.followers_count, details.followersText),
    feedbackCount: pick(fl.feedback_count, details.feedbackText),
    prices: details.prices,
    bundleText: details.bundleText,
  })
}

/* ───────── seller profile ───────── */

const TYPE_LABEL = { facile: 'Venditore facile', medio: 'Venditore medio', difficile: 'Venditore difficile' }

/**
 * The seller's negotiation profile. Inputs, all optional: `extraction` (the listing page: sellerFeedbackCount,
 * sellerRating, sellerBusiness, sellerLastSeenDays, uploadedDays, condition), `signals` (interested, sellerItems,
 * bundleOffered, bundleDiscountPct, priceDropped, lastSeenDays), `wardrobe` (wardrobeStats), `form` (listPrice,
 * category, listingSignal, sellerProfile, listingAge). Returns
 * { type, label, score, archetype: { id, label }, traits: [{ id, label, pts }], confidence: 'alta'|'media'|'bassa' }.
 * Positive points make the seller easier; the weights are priors, the outcome log will tune them.
 */
export function sellerProfileFor({ extraction = null, signals = null, wardrobe = null, form = null } = {}) {
  const ex = extraction || {}
  const sig = signals || {}
  const w = wardrobe && typeof wardrobe === 'object' ? wardrobe : null
  const f = form || {}
  const traits = []
  const add = (id, pts, label) => traits.push({ id, pts, label })
  const L = parsePrice(f.listPrice)
  const signalId = f.listingSignal && typeof f.listingSignal === 'object' ? f.listingSignal.id : f.listingSignal
  const categoryId = f.category && typeof f.category === 'object' ? f.category.id : f.category
  const category = CATEGORIES.find((c) => c.id === categoryId) || null

  if (signalId === 'clearing_out') add('clearing_out', 2, 'scrive che svuota l\'armadio')
  else if (signalId === 'open_to_offers') add('open_to_offers', 1.5, 'dice di accettare offerte')
  else if (signalId === 'fixed_price') add('fixed_price', -3, 'scrive che il prezzo non è trattabile')

  const business = ex.sellerBusiness === true || sig.sellerBusiness === true
  if (business) add('business', -2, 'venditore professionale')

  const reviews = stFinite(ex.sellerFeedbackCount) ? ex.sellerFeedbackCount : w && stFinite(w.feedbackCount) ? w.feedbackCount : f.sellerProfile === 'new_seller' ? 2 : f.sellerProfile === 'expert' ? 60 : null
  if (reviews !== null) {
    if (reviews < 5) add('few_reviews', 0.5, `${reviews === 0 ? 'nessuna recensione' : `solo ${reviews} recension${reviews === 1 ? 'e' : 'i'}`}: poco abituato a trattare`)
    else if (reviews >= 200) add('serial', -1, `${reviews} recensioni: venditore seriale, conosce i prezzi`)
    else if (reviews >= 50) add('seasoned', -0.5, `${reviews} recensioni: venditore rodato`)
  }

  const items = w && stFinite(w.itemCount) ? w.itemCount : stFinite(sig.sellerItems) ? sig.sellerItems : null
  const median = w ? w.medianPrice : null
  const lowBudget = w && stFinite(w.lowBudgetShare) ? w.lowBudgetShare >= 0.6 : median !== null ? median <= STRATEGY.LOW_BUDGET_EUR : null
  if (items !== null && items >= 80) {
    if (lowBudget === true) add('hoarder', 1, `${items} articoli quasi tutti a poco prezzo: svuota tutto, attira chi cerca l'affare`)
    else if (lowBudget === false) add('reseller', -0.5, `${items} articoli di valore: rivenditore, non ha fretta`)
    else add('big_wardrobe', 0.25, `armadio grande (${items} articoli)`)
  } else if (items !== null && items >= 15 && lowBudget === true) add('low_budget', 0.5, `${items} articoli a poco prezzo: abituato a piccoli sconti`)
  else if (items !== null && items <= 3) add('occasional', 0.25, 'vende di rado: prezzo poco ragionato')

  if (w && stFinite(w.staleShare) && w.staleShare >= 0.5 && w.sampleCount >= 6) add('stale_stock', 1, 'molti articoli fermi da mesi: accumula, ha bisogno di vendere')
  if (w && stFinite(w.soldCount) && items !== null && w.soldCount >= 30 && w.soldCount / (w.soldCount + items) >= 0.6) add('sells_fast', -0.5, `${w.soldCount} vendite: i suoi articoli vanno via, non serve scendere`)
  if ((w && w.bundleOffered) || sig.bundleOffered === true || stFinite(sig.bundleDiscountPct)) add('bundle', 1, 'ha attivato lo sconto sui lotti: è abituato a scendere')

  const lastSeen = stFinite(sig.lastSeenDays) ? sig.lastSeenDays : stFinite(ex.sellerLastSeenDays) ? ex.sellerLastSeenDays : f.sellerProfile === 'inactive' ? 20 : f.sellerProfile === 'quiet' ? 7 : null
  if (lastSeen !== null && lastSeen <= STRATEGY.ONLINE_DAYS) add('online', 0.5, 'è online adesso')
  else if (lastSeen !== null && lastSeen >= 7) add('absent', -1, `non entra da ${Math.round(lastSeen)} giorni`)

  const age = stFinite(ex.uploadedDays) ? ex.uploadedDays : stFinite(sig.uploadedDays) ? sig.uploadedDays : null
  const dropped = sig.priceDropped === true || Boolean(sig.priceDrop)
  if (dropped) add('dropped', 1, 'ha già ribassato il prezzo')
  if (age !== null && age < STRATEGY.FRESH_DAYS) add('fresh', 0.5, 'annuncio appena caricato: vuole vendere adesso')
  else if (age !== null && age > 45 && !dropped) add('anchored', -0.5, `fermo sullo stesso prezzo da ${Math.round(age)} giorni`)

  if (/nuovo con (etichetta|cartellino)/i.test(String(ex.condition || ''))) add('new_with_tags', -0.5, 'nuovo con etichetta: ragiona sul prezzo del negozio')
  if (stFinite(L) && L < 20) add('cheap', 0.5, 'articolo economico: chiude volentieri')
  else if (stFinite(L) && L >= 150) add('dear', -0.5, 'cifra importante: più prudente')
  if (category && category.premium) add('premium', -0.5, `${category.label.toLowerCase()}: tiene al valore`)

  const score = stR2(traits.reduce((s, t) => s + t.pts, 0))
  const type = score >= STRATEGY.EASY_SCORE ? 'facile' : score <= STRATEGY.HARD_SCORE ? 'difficile' : 'medio'
  const has = (id) => traits.some((t) => t.id === id)
  const archetype = business ? { id: 'pro', label: 'Professionale' }
    : has('hoarder') || has('stale_stock') ? { id: 'hoarder', label: 'Accumulatore che svuota' }
      : has('reseller') || has('serial') ? { id: 'serial', label: 'Rivenditore seriale' }
        : has('fixed_price') || (has('anchored') && has('new_with_tags')) ? { id: 'firm', label: 'Fermo sul prezzo' }
          : has('few_reviews') || has('occasional') ? { id: 'occasional', label: 'Venditore occasionale' }
            : { id: 'active', label: 'Privato attivo' }
  const known = [reviews !== null, items !== null, lastSeen !== null, age !== null, Boolean(w && w.sampleCount >= 4)].filter(Boolean).length
  return { type, label: TYPE_LABEL[type], score, archetype, traits: traits.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)), confidence: known >= 4 ? 'alta' : known >= 2 ? 'media' : 'bassa' }
}

/* ───────── the user's own history by depth of discount ───────── */

const bandOf = (discountPct) => STRATEGY.BANDS.find((b) => discountPct < b.max) || STRATEGY.BANDS[STRATEGY.BANDS.length - 1]
const CLOSED = ['accepted', 'declined', 'no_reply', 'sold_other', 'countered', 'bought', 'abandoned']

/**
 * First offers with an outcome, counted by band of discount: { d10: { n, accepted, countered }, … }. `records` are
 * watchlist items (list + archive). A counter-offer is its own outcome: the seller answered with a price.
 */
export function experienceOf(records) {
  const out = Object.fromEntries(STRATEGY.BANDS.map((b) => [b.id, { n: 0, accepted: 0, countered: 0 }]))
  for (const it of Array.isArray(records) ? records : []) {
    if (!it || typeof it !== 'object') continue
    const first = Array.isArray(it.negotiation) ? it.negotiation.find((e) => e && e.by === 'buyer') : null
    const list = Number(it.listPrice)
    const offered = first && stFinite(first.price) ? first.price : Number(it.targetPrice)
    const outcome = it.firstOutcome || (CLOSED.includes(it.status) ? it.status : null)
    if (!outcome || !CLOSED.includes(outcome) || outcome === 'abandoned' || !(list > 0) || !(offered > 0) || offered >= list) continue
    // «Comprato» without a first answer is a purchase at the listing price: the offer itself did not pass.
    const cell = out[bandOf(((list - offered) / list) * 100).id]
    cell.n += 1
    if (outcome === 'accepted') cell.accepted += 1
    else if (outcome === 'countered') cell.countered += 1
  }
  return out
}

/* ───────── moment ───────── */

/** «Adesso» when the seller is online or the listing is fresh (and it is not the middle of the night), else the slot. */
export function momentFor({ extraction = null, signals = null, form = null, now = new Date() } = {}) {
  const ex = extraction || {}
  const sig = signals || {}
  const lastSeen = stFinite(sig.lastSeenDays) ? sig.lastSeenDays : stFinite(ex.sellerLastSeenDays) ? ex.sellerLastSeenDays : null
  const age = stFinite(ex.uploadedDays) ? ex.uploadedDays : stFinite(sig.uploadedDays) ? sig.uploadedDays : form && form.listingAge === 'today' ? 0.5 : form && form.listingAge === 'days_2_6' ? 2.5 : null
  const hour = now.getHours()
  if (lastSeen !== null && lastSeen <= STRATEGY.ONLINE_DAYS) return { kind: 'now', reason: 'Il venditore è online adesso: invia subito, risponde a caldo.' }
  if (age !== null && age < STRATEGY.FRESH_DAYS) {
    if (hour >= 7 && hour < 23) return { kind: 'now', reason: 'Annuncio appena caricato: chi arriva prima chiude, non aspettare la sera giusta.' }
    return { kind: 'morning', reason: 'Annuncio fresco ma è notte: invia appena sveglio, prima degli altri.' }
  }
  return { kind: 'slot', reason: 'Annuncio non recente: conta di più il momento in cui il venditore è rilassato.' }
}

/* ───────── proposals ───────── */

const OPTION_LABEL = { prudente: 'Prudente', consigliata: 'Consigliata', audace: 'Audace', tua: 'La tua cifra' }

function convincingMessage({ title, price, type }) {
  const name = title ? `«${String(title).slice(0, 60)}»` : 'il tuo articolo'
  if (type === 'difficile') return `Ciao! Ho messo «mi piace» a ${name}: mi interessa davvero e lo cerco da un po'. Ti ho inviato un'offerta di ${formatEuro(price)}: se per te va bene pago subito, così chiudiamo oggi e spedisci con comodo. Se hai in mente un'altra cifra dimmela pure, ci veniamo incontro. Grazie!`
  if (type === 'medio') return `Ciao! Ti ho inviato un'offerta di ${formatEuro(price)} per ${name}: se va bene pago subito. Grazie!`
  return `Ciao! Ti ho inviato un'offerta di ${formatEuro(price)}, se ti va bene pago subito.`
}

/** The moves in order, by seller type: a difficult seller gets everything, an easy one the offer straight away. */
export function planFor({ type, price, title }) {
  const offer = { id: 'offer', label: `Invia l'offerta di ${formatEuro(price)}` }
  const heart = { id: 'heart', label: 'Metti «mi piace» all\'annuncio' }
  const text = convincingMessage({ title, price, type })
  if (type === 'difficile') return [heart, offer, { id: 'message', label: 'Subito dopo, manda il messaggio', text }]
  if (type === 'medio') return [heart, offer, { id: 'message', label: 'Due righe di accompagnamento (facoltative)', text, optional: true }]
  return [offer]
}

/**
 * The whole strategy for a form. Options: everything analyzeOffer takes (profile, market, records, key, month) plus
 * `extraction`, `signals`, `wardrobe` (for the seller profile), `chosen` ('prudente' | 'consigliata' | 'audace' or a
 * price) and `seller` (a profile already computed). Returns
 * { ok, seller, options: [{ id, label, price, discountPct, probability, engineProbability, counterChance,
 *   counterPrice, expectedPrice, saving, history: { n, accepted }, recommended }], recommendedId, chosenId, moment,
 *   plan, experience, result } where `result` is analyzeOffer on the chosen option; { ok: false, errors } when the
 * form itself is not valid.
 */
export function strategyFor(form, now = new Date(), options = {}) {
  const L = parsePrice(form && form.listPrice)
  if (!stFinite(L) || L <= 0) {
    const bad = analyzeOffer(form, now, options)
    return { ok: false, errors: bad.errors || { listPrice: 'Inserisci il prezzo dell\'annuncio.' } }
  }
  const signals = options.signals || (form && form.signals) || null
  const seller = options.seller || sellerProfileFor({ extraction: options.extraction || null, signals, wardrobe: options.wardrobe || null, form })
  const experience = experienceOf(options.records)
  const moment = momentFor({ extraction: options.extraction || null, signals, form, now })

  const band = policyBandOf(L)
  const ex = options.extraction || {}
  const ageDays = stFinite(ex.uploadedDays) ? ex.uploadedDays : null
  const tier = policyAgeTierOf(ageDays ?? ({ today: 0.5, days_2_6: 3, weeks_1_2: 10, weeks_2_4: 21, over_month: 45 })[form.listingAge] ?? null)
  const table = STRATEGY.TABLE[band.id][tier.id === 'fresh' || tier.id === 'mid' || tier.id === 'old' ? tier.id : 'mid']
  const signalId = form.listingSignal && typeof form.listingSignal === 'object' ? form.listingSignal.id : form.listingSignal
  const market = options.market && stFinite(options.market.p25Price) && stFinite(options.market.p75Price) && options.market.n >= 2 ? options.market : null
  let center = table + STRATEGY.TYPE_SHIFT_PTS[seller.type]
  if (signalId === 'clearing_out') center += 4
  else if (signalId === 'open_to_offers') center += 2
  else if (signalId === 'fixed_price') center -= 5
  if (market && L >= market.p75Price) center += 4
  if (market && L <= market.p25Price) center -= 6
  center = stClamp(center, STRATEGY.MIN_PTS + 2, STRATEGY.MAX_CENTER_PTS)

  const floor = L * (1 - VINTED.MAX_DISCOUNT_PCT / 100)
  const step = L < 20 ? 0.5 : L >= 200 ? 5 : 1
  const priceAt = (pts) => {
    const p = precisePriceFor(L * (1 - pts / 100), L, { min: floor, max: L })
    return p === null ? null : Math.min(p, stR2(L - (L < 20 ? 0.5 : 1)))
  }
  const wanted = [['prudente', Math.max(STRATEGY.MIN_PTS, center - STRATEGY.PRUDENT_STEP_PTS)], ['consigliata', center], ['audace', Math.min(VINTED.MAX_DISCOUNT_PCT - 2, center + STRATEGY.BOLD_STEP_PTS)]]
  const priced = []
  for (const [id, pts] of wanted) {
    let price = priceAt(pts)
    if (price === null) continue
    // Three different prices: a deeper option that rounds onto the previous one steps down the grid, if the floor allows.
    const prev = priced.length ? priced[priced.length - 1].price : null
    if (prev !== null && price >= prev) price = stR2(prev - step)
    if (price < floor - 1e-9 || price <= 0) continue
    priced.push({ id, price })
  }
  if (!priced.length) priced.push({ id: 'consigliata', price: stR2(L - step) })
  // A price the user typed that is none of the three rides along as «La tua cifra» and is the one analysed.
  const custom = stFinite(options.customPrice) ? stR2(Math.max(options.customPrice, Math.ceil(floor * 100) / 100)) : null
  const ownIsNew = custom !== null && custom > 0 && custom < L && !priced.some((o) => Math.abs(o.price - custom) < 0.005)
  if (ownIsNew) priced.push({ id: 'tua', price: custom })

  const engineOptions = { ...options, bestPrice: true, sellerType: seller.type, ...(moment.kind === 'now' && !options.preferredSendAt ? { preferredSendAt: now } : {}) }
  const analysed = priced.map((o) => {
    const result = analyzeOffer({ ...form, targetPrice: String(o.price).replace('.', ',') }, now, engineOptions)
    const discountPct = ((L - o.price) / L) * 100
    const engineP = result && result.ok && stFinite(result.probability) ? result.probability : null
    const b = bandOf(discountPct)
    const cell = experience[b.id]
    const scale = cell.n > STRATEGY.MAX_COUNT ? STRATEGY.MAX_COUNT / cell.n : 1
    const n = cell.n * scale
    const shifted = engineP === null ? null : stSquash(stLogit(stClamp(engineP, 0.01, 0.99)) + STRATEGY.TYPE_LOGIT[seller.type])
    const probability = shifted === null ? null : (STRATEGY.PRIOR_WEIGHT * shifted + cell.accepted * scale) / (STRATEGY.PRIOR_WEIGHT + n)
    const counterRaw = (STRATEGY.PRIOR_WEIGHT * b.counter + cell.countered * scale) / (STRATEGY.PRIOR_WEIGHT + n)
    const counterChance = probability === null ? null : Math.min(counterRaw, Math.max(0, 0.95 - probability))
    const counterPrice = stR2(Math.min(L, L - STRATEGY.COUNTER_GIVE_SHARE * (L - o.price)))
    const expectedPrice = probability === null ? null : stR2(probability * o.price + counterChance * counterPrice + (1 - probability - counterChance) * L)
    return { id: o.id, label: OPTION_LABEL[o.id], price: o.price, discountPct: Math.round(discountPct * 10) / 10, probability, engineProbability: engineP, counterChance, counterPrice, expectedPrice, saving: stR2(L - o.price), history: { n: cell.n, accepted: cell.accepted, countered: cell.countered }, result }
  })
  const scored = analysed.filter((o) => o.expectedPrice !== null && o.id !== 'tua')
  // The cheapest on average wins; within 1% of the listing price the type decides (difficile → the gentler option).
  let best = scored.length ? scored.reduce((a, b) => (b.expectedPrice < a.expectedPrice ? b : a)) : analysed[0]
  if (scored.length > 1) {
    const near = scored.filter((o) => o.expectedPrice - best.expectedPrice <= 0.01 * L)
    if (near.length > 1) best = seller.type === 'difficile' ? near[0] : seller.type === 'facile' ? near[near.length - 1] : near.find((o) => o.id === 'consigliata') || best
  }
  const chosenOpt = (typeof options.chosen === 'string' ? analysed.find((o) => o.id === options.chosen) : null)
    || (custom !== null ? analysed.find((o) => Math.abs(o.price - custom) < 0.005) : null) || best
  const result = chosenOpt.result
  return {
    ok: Boolean(result && result.ok),
    errors: result && !result.ok ? result.errors : null,
    seller,
    options: analysed.map((o) => ({ ...o, result: undefined, recommended: o.id === best.id })),
    recommendedId: best.id,
    chosenId: chosenOpt.id,
    moment,
    plan: planFor({ type: seller.type, price: chosenOpt.price, title: form.itemTitle }),
    experience,
    result,
  }
}

/** What the watchlist stores about the strategy of a saved offer (small: the type, the traits' ids, the option taken). */
export function strategySnapshot(strategy) {
  if (!strategy || !strategy.seller) return null
  const chosen = (strategy.options || []).find((o) => o.id === strategy.chosenId) || null
  return {
    sellerType: strategy.seller.type, sellerScore: strategy.seller.score, archetype: strategy.seller.archetype ? strategy.seller.archetype.id : null,
    traits: (strategy.seller.traits || []).map((t) => t.id), confidence: strategy.seller.confidence,
    option: strategy.chosenId, recommended: strategy.recommendedId, moment: strategy.moment ? strategy.moment.kind : null,
    probability: chosen ? chosen.probability : null, expectedPrice: chosen ? chosen.expectedPrice : null,
  }
}
