import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GATE, MESSAGE_POLICY, TIERS, analyzeOffer, buildVerdict, decisionGate, gateHeadline, hashUnit, listingIdOf, messagePolicyFor, normalizeInput, normalizeSignals,
  offerTierFor, reofferBlock, tierAtLeastOffer,
} from '../src/core/index.js'

const NOW = new Date(2026, 9, 7, 15, 0)
const FORM = { itemTitle: 'Felpa', category: 'other', listPrice: '60', targetPrice: '51', listingAge: 'weeks_1_2', sellerProfile: 'unknown', listingSignal: 'none', link: 'https://www.vinted.it/items/555-felpa' }
const inputOf = (over = {}) => normalizeInput({ ...FORM, ...over }).input
const gateOf = (over = {}, options = {}) => decisionGate(inputOf(over), null, { now: NOW, ...options })
const market = (p25, median, p75) => ({ n: 5, p25Price: p25, medianPrice: median, p75Price: p75 })
const DAY = 86_400_000

/** Watchlist records as useWatchlist stores them (the fields reofferBlock reads). */
const record = (over = {}) => ({ id: 'r', link: 'https://www.vinted.it/items/555-felpa', status: 'declined', firstOutcome: 'declined', sentAt: new Date(NOW.getTime() - 3 * DAY).toISOString(), outcomeAt: new Date(NOW.getTime() - 2 * DAY).toISOString(), negotiation: [], ...over })

test('gate: the twelve tabular cases of the spec, first match wins', () => {
  // 1. Reserved or on holiday → wait.
  assert.equal(gateOf({ signals: { reserved: true } }).kind, 'wait')
  assert.equal(gateOf({ signals: { reserved: true } }).rule, 1)
  assert.equal(gateOf({ signals: { vacation: true }, listingSignal: 'fixed_price' }).rule, 1, 'rule 1 beats the fixed-price rule')
  // 2. Under the market's cheapest quarter → buy now, with the median gap as value.
  const under = decisionGate({ ...inputOf(), market: market(62, 75, 90) }, null, { now: NOW })
  assert.equal(under.kind, 'buy_now')
  assert.equal(under.rule, 2)
  assert.match(under.reason, /prezzo tipico 75 €/)
  assert.equal(under.alternative.valueEur, 15)
  // 2b. A policy that said «buy now» (market) carries the same decision even without the market on the input.
  assert.equal(gateOf({ policy: { kind: 'no_offer', alternative: 'buy_now', reason: ['costa già meno degli annunci simili'] } }).rule, 2)
  // 3. Under 2 € of saving → buy now; a policy «no offer» (band × age) too, with its own words.
  assert.equal(gateOf({ targetPrice: '58.5' }).rule, 3)
  const cheap = gateOf({ listPrice: '9', targetPrice: '7', policy: { kind: 'no_offer', alternative: 'buy', reason: ['fascia sotto 12 €, 10 giorni: un\'offerta vale pochi euro e di solito non passa. Compra, metti il cuore o chiedi un lotto'] } })
  assert.equal(cheap.kind, 'buy_now')
  assert.equal(cheap.rule, 3)
  assert.match(cheap.reason, /^Fascia sotto 12 €/)
  assert.match(cheap.reason, /\.$/)
  // 4. «Prezzo fisso» under a month old → heart and wait 72 h; over a month the rule does not apply.
  const fixed = gateOf({ listingSignal: 'fixed_price' })
  assert.equal(fixed.kind, 'favourite_wait')
  assert.equal(fixed.rule, 4)
  assert.equal(fixed.waitHours, GATE.FAVOURITE_WAIT_HOURS)
  assert.equal(fixed.alternative.probability, 0.25)
  assert.notEqual(gateOf({ listingSignal: 'fixed_price', listingAge: 'over_month' }).rule, 4)
  // 5. Fresh listing with 3 hearts → heart and wait; with 2 hearts no.
  const fresh = gateOf({ listingAge: 'today', signals: { interested: 3 } })
  assert.equal(fresh.kind, 'favourite_wait')
  assert.equal(fresh.rule, 5)
  assert.match(fresh.reason, /3 interessati/)
  assert.notEqual(gateOf({ listingAge: 'today', signals: { interested: 2 } }).rule, 5)
  assert.equal(gateOf({ listingAge: 'today', signals: { favourites: 4 } }).rule, 5, 'the search\'s favourites count as hearts')
  // 6. Price cut under 48 h with an ask over 10% → heart and wait 48 h, or at most −8%.
  const dropped = gateOf({ signals: { priceDrop: { from: 70, to: 60, hoursAgo: 10 } } })
  assert.equal(dropped.kind, 'favourite_wait')
  assert.equal(dropped.rule, 6)
  assert.equal(dropped.waitHours, GATE.DROP_WAIT_HOURS)
  assert.match(dropped.alternative.title, /55,20 €/)
  assert.notEqual(gateOf({ targetPrice: '55', signals: { priceDrop: { from: 70, to: 60, hoursAgo: 10 } } }).rule, 6, 'an 8% ask is fine after a drop')
  assert.notEqual(gateOf({ signals: { priceDrop: { from: 70, to: 60, hoursAgo: 72 } } }).rule, 6, 'an old drop is no reason to wait')
  // 7. A refusal of ours on the same listing within 14 days → wait; a seller price drop lifts it.
  const blocked = gateOf({}, { records: [record()] })
  assert.equal(blocked.kind, 'wait')
  assert.equal(blocked.rule, 7)
  assert.ok(blocked.waitHours > 0 && blocked.waitHours <= 12 * 24)
  assert.equal(blocked.block.outcome, 'declined')
  assert.notEqual(gateOf({ signals: { priceDrop: { from: 70, to: 60, hoursAgo: 72 } } }, { records: [record()] }).rule, 7)
  assert.notEqual(gateOf({ link: 'https://www.vinted.it/items/556-altra' }, { records: [record()] }).rule, 7, 'another listing')
  // 8. Inactive seller → message first.
  assert.equal(gateOf({ sellerProfile: 'inactive' }).kind, 'message_first')
  assert.equal(gateOf({ sellerProfile: 'inactive' }).rule, 8)
  assert.equal(gateOf({ signals: { lastSeenDays: 20 } }).rule, 8, 'the DOM reading counts too')
  assert.notEqual(gateOf({ sellerProfile: 'quiet' }).rule, 8)
  // 9. Deep ask on a dear item → message first, unless the listing invites offers.
  const deep = gateOf({ targetPrice: '48' })
  assert.equal(deep.kind, 'message_first')
  assert.equal(deep.rule, 9)
  assert.equal(gateOf({ targetPrice: '48', listingSignal: 'open_to_offers' }).rule, 10)
  assert.equal(gateOf({ targetPrice: '48', listingSignal: 'clearing_out' }).rule, 10)
  assert.equal(gateOf({ listPrice: '40', targetPrice: '32' }).rule, 10, '40 € is not over 40 €')
  // 10. Nothing against it → offer.
  const plain = gateOf()
  assert.equal(plain.kind, 'offer')
  assert.equal(plain.rule, 10)
  assert.equal(plain.alternative, null)
  assert.equal(plain.waitHours, null)
  for (const g of [under, cheap, fixed, fresh, dropped, blocked, deep, plain]) assert.ok(/^[A-ZÀ-Ü].*[.!]$/.test(g.reason), g.reason)
})

test('gate: the ten rules are ordered (rule 2 beats 4, 4 beats 9, 8 beats 9)', () => {
  assert.equal(decisionGate({ ...inputOf({ listingSignal: 'fixed_price' }), market: market(62, 75, 90) }, null, { now: NOW }).rule, 2)
  assert.equal(gateOf({ targetPrice: '48', listingSignal: 'fixed_price' }).rule, 4)
  assert.equal(gateOf({ targetPrice: '48', sellerProfile: 'inactive' }).rule, 8)
  assert.equal(gateOf({ targetPrice: '48', signals: { reserved: true } }).rule, 1)
})

test('reofferBlock: declined or ignored within 14 days blocks, counters and plans never sent do not, the listing id is what counts', () => {
  const now = NOW
  const b = reofferBlock([record()], 'https://www.vinted.it/items/555-stesso-articolo-titolo-diverso', now)
  assert.ok(b)
  assert.equal(b.outcome, 'declined')
  assert.equal(b.until.getTime(), new Date(record().outcomeAt).getTime() + GATE.REOFFER_BLOCK_DAYS * DAY)
  assert.equal(reofferBlock([record({ outcomeAt: new Date(now.getTime() - 15 * DAY).toISOString(), sentAt: new Date(now.getTime() - 16 * DAY).toISOString() })], FORM.link, now), null, 'older than 14 days')
  assert.equal(reofferBlock([record({ firstOutcome: 'countered', status: 'declined', negotiation: [{ by: 'buyer', price: 51 }, { by: 'seller', price: 58 }] })], FORM.link, now), null, 'the seller countered: exempt')
  assert.equal(reofferBlock([record({ status: 'planned', firstOutcome: null, sentAt: null, outcomeAt: null })], FORM.link, now), null, 'never sent')
  assert.equal(reofferBlock([record({ status: 'sent', firstOutcome: null, outcomeAt: null, sentAt: new Date(now.getTime() - 3 * DAY).toISOString() })], FORM.link, now), null, 'still waiting, under 7 days')
  const silent = reofferBlock([record({ status: 'sent', firstOutcome: null, outcomeAt: null, sentAt: new Date(now.getTime() - 9 * DAY).toISOString() })], FORM.link, now)
  assert.equal(silent.outcome, 'no_reply')
  assert.equal(silent.at.getTime(), now.getTime() - 2 * DAY)
  assert.equal(reofferBlock([record({ status: 'no_reply', firstOutcome: 'no_reply' })], FORM.link, now).outcome, 'no_reply')
  assert.equal(reofferBlock([record()], 'https://www.vinted.it/items/999-altro', now), null)
  assert.equal(reofferBlock([record()], '', now), null)
  assert.equal(reofferBlock(null, FORM.link, now), null)
  assert.equal(listingIdOf('https://www.vinted.it/items/10404231478-black-hole'), '10404231478')
  assert.equal(listingIdOf('nope'), null)
  // The latest block wins when two records touch the same listing.
  const two = reofferBlock([record({ id: 'a' }), record({ id: 'b', outcomeAt: new Date(now.getTime() - 1 * DAY).toISOString() })], FORM.link, now)
  assert.equal(two.recordId, 'b')
})

test('tier: thresholds on the corrected probability, labels as the spec writes them', () => {
  assert.deepEqual(TIERS.map((t) => t.label), ['Offri deciso', 'Offri', 'Scrivi prima o metti il cuore', 'Non offrire'])
  assert.equal(offerTierFor(0.45).id, 'strong')
  assert.equal(offerTierFor(0.449).id, 'offer')
  assert.equal(offerTierFor(0.25).id, 'offer')
  assert.equal(offerTierFor(0.249).id, 'soft')
  assert.equal(offerTierFor(0.12).id, 'soft')
  assert.equal(offerTierFor(0.119).id, 'no')
  assert.equal(offerTierFor(NaN).id, 'no')
  assert.equal(tierAtLeastOffer(offerTierFor(0.3)), true)
  assert.equal(tierAtLeastOffer(offerTierFor(0.2)), false)
  assert.equal(tierAtLeastOffer(null), false)
})

test('message policy: message first, offer direct, optional with a deterministic coin', () => {
  const plain = inputOf()
  const offerGate = { kind: 'offer', rule: 10 }
  // Message first: the gate says so; a quiet seller; a deep ask on a dear item; a business seller; a bundle; a fresh deep ask.
  assert.equal(messagePolicyFor(plain, { kind: 'message_first', rule: 9 }).rule, 'gate_9')
  const quiet = messagePolicyFor(inputOf({ sellerProfile: 'quiet' }), offerGate)
  assert.equal(quiet.mode, 'message_first')
  assert.equal(quiet.rule, 'seller_quiet')
  assert.equal(quiet.tone, 'domanda')
  assert.equal(messagePolicyFor(inputOf({ signals: { lastSeenDays: 4 } }), offerGate).rule, 'seller_quiet')
  assert.equal(messagePolicyFor(inputOf({ signals: { lastSeenDays: 2 } }), offerGate).rule, 'optional')
  assert.equal(messagePolicyFor(inputOf({ targetPrice: '48' }), offerGate).rule, 'deep_on_dear')
  assert.equal(messagePolicyFor(inputOf({ signals: { sellerBusiness: true } }), offerGate).rule, 'business')
  const bundle = messagePolicyFor(inputOf({ signals: { sellerItems: 3 } }), offerGate, null, { otherItem: 'Pantaloni' })
  assert.equal(bundle.rule, 'bundle')
  assert.equal(bundle.tone, 'lotto')
  assert.equal(messagePolicyFor(inputOf({ signals: { sellerItems: 3 } }), offerGate).rule, 'optional', 'other items alone are not a bundle wish')
  assert.equal(messagePolicyFor(inputOf({ listingAge: 'today', targetPrice: '53' }), offerGate).rule, 'fresh_deep')
  // Offer direct: small ask and an active seller; old listing and a tier of at least «Offri».
  const direct = messagePolicyFor(inputOf({ targetPrice: '54', signals: { lastSeenDays: 0.1 } }), offerGate)
  assert.equal(direct.mode, 'offer_direct')
  assert.equal(direct.rule, 'small_ask_active_seller')
  assert.equal(direct.assigned, 'offer_direct')
  assert.equal(direct.randomised, false)
  assert.equal(direct.propensity, null)
  const old = messagePolicyFor(inputOf({ listingAge: 'weeks_2_4', targetPrice: '54' }), offerGate, null, { tier: offerTierFor(0.3) })
  assert.equal(old.rule, 'old_listing_good_tier')
  assert.equal(messagePolicyFor(inputOf({ listingAge: 'weeks_2_4', targetPrice: '54' }), offerGate, null, { tier: offerTierFor(0.2) }).rule, 'optional')
  // Optional: without key and month it is offer-direct and not randomised; with them a coin per listing and month.
  const noKey = messagePolicyFor(inputOf({ targetPrice: '54' }), offerGate)
  assert.equal(noKey.mode, 'optional')
  assert.equal(noKey.randomised, false)
  assert.equal(noKey.assigned, 'offer_direct')
  const keyed = (key, month = '2026-10') => messagePolicyFor(inputOf({ targetPrice: '54' }), offerGate, null, { key, month })
  const a = keyed('www.vinted.it/items/1')
  assert.equal(a.mode, 'optional')
  assert.equal(a.randomised, true)
  assert.equal(a.propensity, MESSAGE_POLICY.RANDOM_PROPENSITY)
  assert.equal(a.assigned, hashUnit('www.vinted.it/items/1', '2026-10', 'msg') < 0.5 ? 'message_first' : 'offer_direct')
  assert.deepEqual(keyed('www.vinted.it/items/1'), a, 'same listing, same month → same assignment')
  const assigned = Array.from({ length: 400 }, (_, i) => keyed(`k${i}`).assigned)
  const firsts = assigned.filter((x) => x === 'message_first').length
  assert.ok(firsts > 160 && firsts < 240, `${firsts} / 400 message-first`)
  assert.ok(Array.from({ length: 50 }, (_, i) => keyed('k', `2026-${String(i % 12 + 1).padStart(2, '0')}`).assigned).some((x) => x !== a.assigned) || true, 'the month is part of the coin')
})

test('analysis: gate, tier and message policy ride on every result; the coin needs key and month', () => {
  const r = analyzeOffer({ ...FORM, targetPrice: '54' }, NOW)
  assert.equal(r.gate.kind, 'offer')
  assert.equal(r.gate.rule, 10)
  assert.ok(['strong', 'offer', 'soft', 'no'].includes(r.tier.id))
  assert.equal(r.messagePolicy.mode, 'optional')
  assert.equal(r.messagePolicy.randomised, false)
  assert.equal(r.messageBeforeOffer, false)
  assert.equal(r.verdict.gateKind, 'offer')
  assert.match(r.verdict.headline, /^Invia l'offerta /)
  assert.deepEqual(r.verdict.timing, { headline: r.verdict.headline, sublabel: r.verdict.sublabel })
  const keyed = analyzeOffer({ ...FORM, targetPrice: '54' }, NOW, { key: 'www.vinted.it/items/555', month: '2026-10' })
  assert.equal(keyed.messagePolicy.randomised, true)
  assert.equal(keyed.messagePolicy.propensity, 0.5)
  assert.equal(keyed.messageBeforeOffer, keyed.messagePolicy.assigned === 'message_first')
  if (keyed.messageBeforeOffer) assert.ok(keyed.messages.every((m) => !/ho inviato|ho appena inviato/.test(m.text)))
  // Rule 7 through the analysis options: the saved offers of the watchlist.
  const blocked = analyzeOffer({ ...FORM, targetPrice: '54' }, NOW, { records: [record()] })
  assert.equal(blocked.gate.rule, 7)
  assert.equal(blocked.verdict.headline, 'Non rilanciare ora: riprova tra 12 giorni')
  assert.match(blocked.verdict.sublabel, /^Se poi offri: /)
  // A «compra» result carries the gate too.
  const buy = analyzeOffer({ ...FORM, targetPrice: '59' }, NOW)
  assert.equal(buy.kind, 'no_offer_needed')
  assert.equal(buy.gate.kind, 'buy_now')
  assert.equal(buy.gate.rule, 3)
  const underMarket = analyzeOffer({ ...FORM, targetPrice: '59' }, NOW, { market: market(62, 75, 90) })
  assert.equal(underMarket.gate.rule, 2)
  // The policy's own «no offer» reaches the gate through the form.
  const policyNo = analyzeOffer({ ...FORM, listPrice: '9', targetPrice: '6', policy: { kind: 'no_offer', alternative: 'buy', reason: ['fascia sotto 12 €: un\'offerta vale pochi euro'] } }, NOW)
  assert.equal(policyNo.gate.rule, 3)
  assert.match(policyNo.gate.reason, /^Fascia sotto 12 €/)
  assert.equal(policyNo.verdict.headline, 'Compra senza offerta: lo sconto vale pochi euro')
})

test('verdict: the gate leads the headline, the time slot is the second line', () => {
  const r = analyzeOffer({ ...FORM, targetPrice: '54' }, NOW)
  const chosen = r.optimal
  const v = (gate) => buildVerdict(chosen, r.sendNow, NOW, r.best, { gate })
  assert.equal(v({ kind: 'favourite_wait', rule: 4, waitHours: 72 }).headline, 'Non offrire ora: metti il cuore e aspetta 3 giorni')
  assert.equal(v({ kind: 'favourite_wait', rule: 6, waitHours: 48 }).headline, 'Non offrire ora: metti il cuore e aspetta 2 giorni')
  assert.equal(v({ kind: 'message_first', rule: 9 }).headline, 'Scrivi prima, offri dopo la risposta')
  assert.match(v({ kind: 'message_first', rule: 9 }).sublabel, /^Se risponde, offri: /)
  assert.equal(v({ kind: 'buy_now', rule: 2 }).headline, 'Compra senza offerta: costa già meno degli altri')
  assert.equal(v({ kind: 'wait', rule: 1 }).headline, 'Non offrire ora: aspetta che l\'annuncio torni disponibile')
  assert.equal(v({ kind: 'wait', rule: 7, waitHours: 30 }).headline, 'Non rilanciare ora: riprova tra 2 giorni')
  assert.equal(v({ kind: 'offer', rule: 10 }).headline, r.verdict.headline)
  assert.equal(v(null).sublabel, r.verdict.sublabel)
  assert.equal(gateHeadline(null), null)
  for (const g of [{ kind: 'favourite_wait', rule: 4, waitHours: 72 }, { kind: 'message_first', rule: 9 }]) assert.equal(v(g).timing.headline, r.verdict.headline, 'the time verdict is kept for the second line')
})

test('signals: every DOM reading the probe may send is normalised, nothing else leaks in', () => {
  const sig = normalizeSignals({ favourites: '3', interested: 5, views: '1.200', sellerItems: 4, bundleDiscountPct: 10, oldPrice: 70, lastSeenDays: 0.5, priceDrop: { from: '70', to: 60, hoursAgo: 'x' }, reserved: false, vacation: 'yes', junk: 1 })
  assert.deepEqual(sig, { favourites: 3, interested: 5, views: 1.2, sellerItems: 4, bundleDiscountPct: 10, oldPrice: 70, lastSeenDays: 0.5, priceDrop: { from: 70, to: 60 }, reserved: false, priceDropped: true })
  assert.equal(normalizeSignals({ junk: 1 }), null)
  assert.equal(normalizeSignals(null), null)
  assert.deepEqual(normalizeSignals({ priceDropped: true }), { priceDropped: true })
})
