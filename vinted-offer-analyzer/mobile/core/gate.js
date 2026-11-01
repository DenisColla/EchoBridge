/**
 * Decision gate, tier and message policy (engine 1.4.0, spec §3.3, §3.4, §4.1).
 *
 * The first month of real offers showed that WHETHER to offer mattered more than when: 2 of 12 offers were on items
 * the policy would not ask on, one was a re-offer on a listing that had just ignored the first, most were deep asks on
 * fresh listings. The gate is one deterministic list of ten rules, first match wins, evaluated before the verdict; the
 * tier is a label on the corrected probability; the message policy says whether to write first, offer at once, or let
 * a coin (deterministic per listing and month) decide so the message effect can be measured.
 *
 * Pure functions: constants.js, math.js and messages.js only. Private helpers are prefixed `gt` because the artifact
 * bundler puts every module in one scope.
 */
import { GATE, LEARNING, MESSAGE_POLICY, TIERS } from './constants.js'
import { hashString } from './math.js'
import { formatEuro, recommendedToneFor } from './messages.js'

const DAY_MS = 86_400_000
const gtR2 = (v) => Math.round(v * 100) / 100
const gtDate = (v) => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}
const gtFinite = (v) => typeof v === 'number' && Number.isFinite(v)

/** Deterministic unit in [0, 1) for an offer (`key`), a month and a purpose: the same listing draws the same number all month. */
export const hashUnit = (key, month, purpose) => (hashString(`${key}|${month}|${purpose}`) % 100000) / 100000

/** The Vinted listing id of a link (…/items/123456-title), or null. */
export const listingIdOf = (link) => {
  const m = String(link || '').match(/\/items\/(\d+)/)
  return m ? m[1] : null
}

/** Days online today: the form's listing age (unknown → null), the DOM's `uploadedDays` when the signals carry it. */
const gtAgeDays = (input) => {
  const sig = input.signals || {}
  if (gtFinite(sig.uploadedDays)) return sig.uploadedDays
  const age = input.listingAge
  if (!age || age.id === 'unknown') return null
  return age.days
}
/** Days since the seller's last visit: the signal when read, else the profile's meaning (inactive ≥ 14, quiet ≥ 3), else null. */
const gtLastSeenDays = (input) => {
  const sig = input.signals || {}
  if (gtFinite(sig.lastSeenDays)) return sig.lastSeenDays
  if (gtFinite(sig.sellerLastSeenDays)) return sig.sellerLastSeenDays
  if (input.sellerProfile === 'inactive') return GATE.INACTIVE_DAYS
  if (input.sellerProfile === 'quiet') return MESSAGE_POLICY.QUIET_PROFILE_DAYS
  return null
}
const gtHearts = (sig) => (gtFinite(sig.interested) ? sig.interested : gtFinite(sig.favourites) ? sig.favourites : null)
const gtDropHours = (sig) => (sig.priceDrop && gtFinite(sig.priceDrop.hoursAgo) ? sig.priceDrop.hoursAgo : gtFinite(sig.priceDropHoursAgo) ? sig.priceDropHoursAgo : null)
const gtDropped = (sig) => sig.priceDropped === true || (sig.priceDrop && typeof sig.priceDrop === 'object') || gtDropHours(sig) !== null
const gtMarketOk = (market) => Boolean(market && gtFinite(market.n) && market.n >= 2 && gtFinite(market.p25Price) && gtFinite(market.medianPrice))
const gtHours = (h) => `${h} h`
/** A policy reason as one capitalised sentence with its full stop, or the fallback. */
const gtSentence = (text, fallback) => {
  const s = typeof text === 'string' ? text.trim() : ''
  if (!s) return fallback
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}`
}

/* ───────── rule 7: no re-offer on a listing that just said no ───────── */

/**
 * Whether a new offer on `link` is blocked by a recent refusal of ours on the same listing (gate rule 7): among
 * `records` (watchlist items { link, listPrice, status, outcomeAt, firstOutcome, sentAt, negotiation }) a `declined`
 * or `no_reply` outcome within REOFFER_BLOCK_DAYS before `now`. An offer still unanswered after NO_REPLY_AFTER_DAYS
 * counts as no reply from that day, and that day also caps the refusal moment: an outcome tapped weeks later records
 * an old no, it does not renew the block. Exempt: negotiations the seller countered (he engaged: the counter screen is
 * the place to continue), plans never sent, and records the seller moved on since — `listPrice` (the listing's price
 * today) under the price we asked on, or a price drop (`dropHoursAgo`, hours before `now`) after the refusal; the
 * gate and the save-time check pass the same options, so they reach the same decision.
 * Returns null, or { until: Date, outcome: 'declined' | 'no_reply', at: Date, recordId }.
 */
export function reofferBlock(records, link, now = new Date(), { listPrice = null, dropHoursAgo = null } = {}) {
  const id = listingIdOf(link)
  if (!id || !Array.isArray(records)) return null
  const ref = gtDate(now) || new Date()
  const silentAfter = LEARNING.NO_REPLY_AFTER_DAYS * DAY_MS
  let block = null
  for (const r of records) {
    if (!r || listingIdOf(r.link) !== id) continue
    const history = Array.isArray(r.negotiation) ? r.negotiation : []
    if (history.some((e) => e && e.by === 'seller')) continue
    if (r.firstOutcome === 'countered' || r.status === 'countered') continue
    const sentAt = gtDate(r.sentAt)
    if (!sentAt) continue
    // The refusal moment: the tap, capped at the offer's own horizon (silence is a no from that day anyway).
    const latest = sentAt.getTime() + silentAfter
    const tapped = gtDate(r.outcomeAt) || gtDate(r.firstOutcomeAt)
    let outcome = null
    let at = null
    const first = r.firstOutcome || r.status
    if (first === 'declined') {
      outcome = 'declined'
      at = new Date(Math.min((tapped || sentAt).getTime(), latest))
    } else if (first === 'no_reply') {
      outcome = 'no_reply'
      at = new Date(Math.min(tapped ? tapped.getTime() : latest, latest))
    } else if (r.status === 'sent' && ref.getTime() - sentAt.getTime() >= silentAfter) {
      outcome = 'no_reply'
      at = new Date(latest)
    }
    if (!outcome || at.getTime() > ref.getTime()) continue
    // The seller moved since: a lower list price than the one we asked on, or a price cut after the refusal.
    const askedOn = Number(r.listPrice)
    if (gtFinite(listPrice) && Number.isFinite(askedOn) && askedOn > 0 && listPrice < askedOn - 0.004) continue
    if (gtFinite(dropHoursAgo) && ref.getTime() - dropHoursAgo * 3_600_000 > at.getTime()) continue
    const until = new Date(at.getTime() + GATE.REOFFER_BLOCK_DAYS * DAY_MS)
    if (until.getTime() <= ref.getTime()) continue
    if (!block || until.getTime() > block.until.getTime()) block = { until, outcome, at, recordId: r.id || null }
  }
  return block
}

/* ───────── the gate ───────── */

const gtFavouriteAlternative = (L) => ({
  title: 'Metti nei preferiti e aspetta',
  valueEur: gtR2(GATE.FAVOURITE_DISCOUNT_P * GATE.FAVOURITE_DISCOUNT_SHARE * L),
  probability: GATE.FAVOURITE_DISCOUNT_P,
})

/**
 * The ten ordered rules (engine-spec §3.3), first match wins. `input` is the normalised analysis input (prices,
 * category, listingAge, sellerProfile, listingSignal, signals, market, policy, link); `moments` is pickMoments'
 * output (kept for callers that have it; no rule reads it today); options: { records, now, link, policy }.
 * Returns { kind: 'offer' | 'buy_now' | 'favourite_wait' | 'message_first' | 'wait', rule: 1..10, reason (Italian,
 * one sentence), alternative: { title, valueEur, probability } | null, waitHours: number | null, block }.
 */
export function decisionGate(input, moments, { records = null, now = new Date(), link = null, policy = null } = {}) {
  const sig = input.signals || {}
  const L = input.listPrice
  const d = input.discountPct
  const market = input.market || null
  const pol = policy || input.policy || null
  const ageDays = gtAgeDays(input)
  const out = (kind, rule, reason, { alternative = null, waitHours = null, block = null } = {}) => ({ kind, rule, reason, alternative, waitHours, block })

  // 1. Reserved for someone, or the seller is on holiday: nothing to do until that changes.
  if (sig.reserved === true) return out('wait', 1, 'L\'articolo è riservato a un altro acquirente: aspetta che torni disponibile prima di offrire.')
  if (sig.vacation === true) return out('wait', 1, 'Il venditore è in modalità vacanza: l\'offerta scadrebbe prima che la legga, aspetta il suo rientro.')

  // 2. Already under the market's cheapest quarter: buy, an offer can only lose the item.
  const policyBuyNow = pol && pol.kind === 'no_offer' && pol.alternative === 'buy_now'
  if ((gtMarketOk(market) && L <= market.p25Price) || policyBuyNow) {
    const median = gtMarketOk(market) ? market.medianPrice : null
    const reason = median !== null
      ? `Costa già meno del quarto più economico degli annunci simili (prezzo tipico ${formatEuro(median)}): compra subito, un'offerta rischia di fartelo perdere.`
      : gtSentence(pol.reason && pol.reason[0], 'Costa già meno degli annunci simili: compra subito, un\'offerta rischia di fartelo perdere.')
    const alternative = median !== null && median > L ? { title: 'Sotto il mercato: compra subito', valueEur: gtR2(median - L), probability: null } : null
    return out('buy_now', 2, reason, { alternative })
  }

  // 3. Too little to bargain over, or the policy table says the band and age are not worth an offer.
  const policyBuy = pol && pol.kind === 'no_offer'
  if (L - input.targetPrice < GATE.MIN_GAP_EUR || policyBuy) {
    const reason = policyBuy
      ? gtSentence(pol.reason && pol.reason[0], 'Su questa fascia di prezzo un\'offerta vale pochi euro e di solito non passa: compra, metti il cuore o chiedi un lotto.')
      : `Risparmieresti solo ${formatEuro(L - input.targetPrice)}: compra a prezzo pieno, oppure chiedi la spedizione inclusa o un lotto.`
    return out('buy_now', 3, reason)
  }

  // 4. «Prezzo fisso» on a listing under a month old: the heart gets the seller's own discount, without the 60% floor.
  if (input.listingSignal && input.listingSignal.id === 'fixed_price' && (ageDays === null || ageDays < GATE.FIXED_PRICE_MAX_AGE_DAYS)) {
    return out('favourite_wait', 4, `L'annuncio dice «prezzo non trattabile» ed è online da meno di un mese: metti il cuore e aspetta ${gtHours(GATE.FAVOURITE_WAIT_HOURS)}, gli sconti che manda il venditore non hanno il limite del 40%.`, { alternative: gtFavouriteAlternative(L), waitHours: GATE.FAVOURITE_WAIT_HOURS })
  }

  // 5. A fresh listing that others already want: the seller has no reason to move yet.
  const hearts = gtHearts(sig)
  if (ageDays !== null && ageDays < GATE.FRESH_DAYS && hearts !== null && hearts >= GATE.FRESH_HEARTS) {
    return out('favourite_wait', 5, `Annuncio di ${Math.max(1, Math.round(ageDays))} ${Math.round(ageDays) <= 1 ? 'giorno' : 'giorni'} con già ${hearts} interessati: il venditore non ha motivo di scendere ora, metti il cuore e riprova tra ${gtHours(GATE.FAVOURITE_WAIT_HOURS)}.`, { alternative: gtFavouriteAlternative(L), waitHours: GATE.FAVOURITE_WAIT_HOURS })
  }

  // 6. The price was just cut and the ask is still deep: he has moved, wait, or ask very little.
  const dropHours = gtDropHours(sig)
  const recentDrop = gtDropped(sig) && dropHours !== null && dropHours < GATE.RECENT_DROP_HOURS
  if (recentDrop && d > GATE.DROP_MAX_DISCOUNT_PCT) {
    const capPrice = gtR2(L * (1 - GATE.DROP_OFFER_CAP_PCT / 100))
    return out('favourite_wait', 6, `Il venditore ha appena ribassato il prezzo: uno sconto del ${Math.round(d)}% ora non passa, metti il cuore e aspetta ${gtHours(GATE.DROP_WAIT_HOURS)}, oppure offri al massimo ${formatEuro(capPrice)} (−${GATE.DROP_OFFER_CAP_PCT}%).`, {
      alternative: { title: `Oppure offri al massimo ${formatEuro(capPrice)}`, valueEur: gtR2(L - capPrice), probability: null },
      waitHours: GATE.DROP_WAIT_HOURS,
    })
  }

  // 7. A refusal of ours on this very listing within 14 days, unless the seller moved since: a list price under the one
  //    we asked on, or a price cut dated after the refusal (a crossed-out price alone says nothing about when).
  const blockLink = link || input.link || null
  const block = blockLink ? reofferBlock(records, blockLink, now, { listPrice: L, dropHoursAgo: gtDropped(sig) ? dropHours : null }) : null
  if (block) {
    const hours = Math.max(1, Math.ceil((block.until.getTime() - (gtDate(now) || new Date()).getTime()) / 3_600_000))
    const what = block.outcome === 'declined' ? 'ha rifiutato la tua offerta' : 'non ha risposto alla tua offerta'
    return out('wait', 7, `Su questo annuncio il venditore ${what} da poco: non rilanciare prima di ${Math.ceil(hours / 24)} ${Math.ceil(hours / 24) === 1 ? 'giorno' : 'giorni'}, segnalerebbe che la prima era solo un tentativo.`, { waitHours: hours, block })
  }

  // 8. An inactive seller: the offer would lapse unread, a message does not.
  const lastSeen = gtLastSeenDays(input)
  if (lastSeen !== null && lastSeen >= GATE.INACTIVE_DAYS) {
    return out('message_first', 8, `Il venditore non entra da ${Math.round(lastSeen)} giorni: scrivi prima un messaggio, i messaggi non scadono, e invia l'offerta quando risponde.`)
  }

  // 9. A deep ask on a dear item: write first, unless the listing itself invites offers.
  const invites = input.listingSignal && (input.listingSignal.id === 'clearing_out' || input.listingSignal.id === 'open_to_offers')
  if (d > GATE.DEEP_DISCOUNT_PCT && L > GATE.DEAR_LIST_PRICE_EUR && !invites) {
    return out('message_first', 9, `Uno sconto del ${Math.round(d)}% su ${formatEuro(L)} è una richiesta importante: scrivi prima un messaggio e invia l'offerta dopo la risposta.`)
  }

  // 10. Nothing against it: offer.
  return out('offer', 10, 'Nessun segnale contrario: invia l\'offerta nel momento consigliato.')
}

/* ───────── tier ───────── */

/** UI tier from the corrected overall probability (engine-spec §3.4): { id, label, min }. */
export function offerTierFor(pOverall) {
  const p = gtFinite(pOverall) ? pOverall : 0
  const tier = TIERS.find((t) => p >= t.min) || TIERS[TIERS.length - 1]
  return { id: tier.id, label: tier.label, min: tier.min }
}
const TIER_RANK = Object.fromEntries(TIERS.map((t, i) => [t.id, TIERS.length - i]))
/** True when `tier` is at least «Offri». */
export const tierAtLeastOffer = (tier) => Boolean(tier && TIER_RANK[tier.id] >= TIER_RANK.offer)

/* ───────── message policy ───────── */

/**
 * Message first, offer at once, or optional (engine-spec §4.1). `input` as for the gate, `gate` its output (a
 * message-first gate decides the mode), `signals` the listing signals (defaults to input.signals); options
 * { tier, key, month, otherItem }. In the optional case the assignment is a deterministic coin per listing and month
 * (hashUnit, §5.3) when `key` and `month` are given, logged with propensity 0,5; without them it is offer-direct.
 * Returns { mode: 'message_first' | 'offer_direct' | 'optional', rule, tone, randomised, propensity, assigned }.
 */
export function messagePolicyFor(input, gate = null, signals = null, { tier = null, key = null, month = null, otherItem = null } = {}) {
  const sig = signals || input.signals || {}
  const L = input.listPrice
  const d = input.discountPct
  const M = MESSAGE_POLICY
  const ageDays = gtAgeDays({ ...input, signals: sig })
  const lastSeen = gtLastSeenDays({ ...input, signals: sig })
  const base = recommendedToneFor(input)
  const decide = (mode, rule, tone) => ({ mode, rule, tone, randomised: false, propensity: null, assigned: mode === 'message_first' ? 'message_first' : 'offer_direct' })

  if (gate && gate.kind === 'message_first') return decide('message_first', `gate_${gate.rule}`, lastSeen !== null && lastSeen >= M.QUIET_DAYS ? 'domanda' : base)
  if (lastSeen !== null && lastSeen > M.QUIET_DAYS) return decide('message_first', 'seller_quiet', 'domanda')
  if (d > M.DEEP_DISCOUNT_PCT && L > M.DEAR_LIST_PRICE_EUR) return decide('message_first', 'deep_on_dear', base)
  if (sig.sellerBusiness === true) return decide('message_first', 'business', base)
  const wantsBundle = Boolean(otherItem || sig.bundleInterest === true || sig.otherItem)
  if (gtFinite(sig.sellerItems) && sig.sellerItems >= M.BUNDLE_MIN_SELLER_ITEMS && wantsBundle) return decide('message_first', 'bundle', 'lotto')
  if (ageDays !== null && ageDays < M.FRESH_DAYS && d > M.FRESH_DEEP_DISCOUNT_PCT) return decide('message_first', 'fresh_deep', base)

  if (d <= M.DIRECT_MAX_DISCOUNT_PCT && lastSeen !== null && lastSeen < M.ACTIVE_WITHIN_DAYS) return decide('offer_direct', 'small_ask_active_seller', base)
  if (ageDays !== null && ageDays > M.OLD_LISTING_DAYS && tierAtLeastOffer(tier)) return decide('offer_direct', 'old_listing_good_tier', base)

  // Optional: the coin decides, so the message effect can be measured (§5.3). Without a key the offer goes direct.
  const randomised = Boolean(key && month)
  const assigned = randomised ? (hashUnit(key, month, 'msg') < M.RANDOM_PROPENSITY ? 'message_first' : 'offer_direct') : 'offer_direct'
  return { mode: 'optional', rule: 'optional', tone: base, randomised, propensity: randomised ? M.RANDOM_PROPENSITY : null, assigned }
}
