import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyzeCounter, buildCounterMessages, buildCounterReminders, buildVerdict, buyerTotal, counterFromPercent, counterPreview, evaluateCounter,
  formatEuro, isPrecisePrice, isSplitPrice, normalizeCounterInput, parsePercent, preciseBelow, precisePricesIn, splitPrice,
  timeWindowAt, wholeEuroFallback, TONES,
} from '../src/core/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const at = (d, h, m) => new Date(2026, 9, d, h, m)
const H = (...rows) => rows.map(([by, price, when]) => ({ by, price, at: when }))
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} (±${tol})`)
const P = 0.005
const EUR = 0.011
const sameTime = (a, b) => assert.equal(a.getTime(), b.getTime(), `${a} ≠ ${b}`)
// Some expectations hold only on Italian time (the 25 October 2026 DST change): skip them elsewhere (run `npm run test:rome`).
const IS_ROME = new Date(2026, 9, 24, 12).getTimezoneOffset() === -120 && new Date(2026, 9, 26, 12).getTimezoneOffset() === -60
const IS_UTC = new Date(2026, 9, 24, 12).getTimezoneOffset() === 0 && new Date(2026, 9, 26, 12).getTimezoneOffset() === 0

const EX1 = {
  itemTitle: 'Nike Air Force 1', category: 'sneakers', listPrice: '60', previousOffer: '45', sellerCounter: '58,50',
  listingAge: 'weeks_1_2', sellerProfile: 'unknown', listingSignal: 'none', offerSentAt: at(13, 21, 35), receivedAt: at(13, 21, 40),
}
const NOW1 = at(13, 21, 45)
const EX2 = {
  itemTitle: 'Vestito Zara', category: 'fast_fashion', listPrice: '15', previousOffer: '10', sellerCounter: '13,50',
  listingAge: 'weeks_2_4', sellerProfile: 'new_seller', listingSignal: 'none', offerSentAt: at(18, 11, 0), receivedAt: at(18, 15, 10),
}
const EX3 = {
  itemTitle: 'Charizard PSA 9', category: 'collectible', listPrice: '420', previousOffer: '320', sellerCounter: '390',
  listingAge: 'weeks_2_4', sellerProfile: 'expert', listingSignal: 'none', offerSentAt: at(24, 21, 5), receivedAt: at(24, 22, 10),
}
const option = (r, id) => r.options.find((o) => o.id === id)

/** §3.8 guard rails on every counter option. */
function assertGuardRails(r, rawInput) {
  const n = r.negotiation
  const L = n.listPrice
  const B = n.previousOffer
  const S = n.sellerCounter
  for (const o of r.options.filter((x) => x.id !== 'accept')) {
    assert.ok(o.price > B && o.price < S, `${o.price} outside (${B}, ${S})`)
    if (n.maxPrice != null) assert.ok(o.price <= n.maxPrice + 1e-9, `${o.price} over budget ${n.maxPrice}`)
    assert.ok(o.price >= Math.ceil(L * 60 - 1e-6) / 100, `${o.price} under 60% of list`)
    assert.ok(o.price >= 0.6 * S - 1e-9)
    assert.ok(isPrecisePrice(o.price, L) || isSplitPrice(o.price, B, S, L), `${o.price} neither precise nor split`)
    if (n.buyerCountersSent === 0) assert.ok(o.price <= (B + S) / 2 + 1e-9, `${o.price} beyond the midpoint`)
  }
  return rawInput
}

/* ───────── helpers ───────── */

test('counter helpers: percent parsing, fee, precise grid, split, whole-euro fallback', () => {
  assert.equal(parsePercent('30'), 30)
  assert.equal(parsePercent('30%'), 30)
  assert.equal(parsePercent('30,5'), 30.5)
  for (const bad of ['abc', '-5', '250', '']) assert.ok(Number.isNaN(parsePercent(bad)), bad)
  assert.equal(counterFromPercent(45, 30), 58.5)
  assert.equal(counterFromPercent(45, 30.5), 58.73)
  assert.equal(counterFromPercent(10, 35), 13.5)
  for (const [p, t] of [[51.7, 54.99], [58.5, 62.13], [11, 12.25], [13.5, 14.88], [355, 373.45], [390, 410.2]]) assert.equal(buyerTotal(p), t)
  for (const p of [49.7, 49.3, 51]) assert.ok(isPrecisePrice(p, 60), String(p))
  for (const p of [50, 49.5, 49.37]) assert.ok(!isPrecisePrice(p, 60), String(p))
  assert.ok(isPrecisePrice(341, 420))
  assert.ok(!isPrecisePrice(340, 420))
  assert.ok(!isPrecisePrice(341.5, 420))
  assert.deepEqual(precisePricesIn(47.025, 51.75, 60), [47.3, 47.7, 47.8, 48, 48.3, 48.7, 48.8, 49, 49.3, 49.7, 49.8, 50.3, 50.7, 50.8, 51, 51.3, 51.7])
  assert.equal(preciseBelow(55.05, 60, 51.7), 54.8)
  assert.equal(preciseBelow(11.5, 15, 11), 11.3)
  assert.equal(splitPrice(45, 58.5, 60), 51.75)
  assert.ok(isSplitPrice(51.7, 45, 58.5, 60))
  assert.ok(!isSplitPrice(51.6, 45, 58.5, 60))
  assert.equal(splitPrice(320, 390, 420), 355)
  assert.equal(splitPrice(355, 381.43, 420), 368)
  for (const [p, w] of [[51.7, 52], [48.7, 49], [11.75, 12], [54.19, 54]]) assert.equal(wholeEuroFallback(p), w)
})

/* ───────── normalisation and routing ───────── */

test('counter: euro and "% over my offer" give the same diagnosis and price', () => {
  const eur = analyzeCounter(EX1, NOW1)
  const pct = analyzeCounter({ ...EX1, sellerCounter: '30', counterMode: 'pct' }, NOW1)
  for (const r of [eur, pct]) {
    const n = r.negotiation
    assert.equal(n.sellerCounter, 58.5)
    near(n.counterOverOfferPct, 30, 1e-9)
    assert.equal(n.sellerStepEur, 1.5)
    near(n.sellerStepPct, 2.5, 1e-9)
    near(n.sellerConcessionShare, 0.1, 1e-9)
    assert.equal(n.sellerStance, 'firm')
  }
  assert.equal(eur.recommended.price, pct.recommended.price)
  assert.deepEqual(pct.negotiation.sellerCounterEntered, { mode: 'pct', value: 30 })
})

test('counter: validation messages', () => {
  assert.equal(analyzeCounter({ ...EX1, sellerCounter: '' }, NOW1).errors.sellerCounter, 'Inserisci la controproposta del venditore (ad esempio 58,50 o 30%).')
  assert.equal(analyzeCounter({ ...EX1, sellerCounter: '61' }, NOW1).errors.sellerCounter, 'La controproposta non può superare il prezzo di listino.')
  assert.match(analyzeCounter({ ...EX1, sellerCounter: '40', counterMode: 'pct' }, NOW1).errors.sellerCounter, /63 €/)
  assert.ok(analyzeCounter({ ...EX1, previousOffer: '', targetPrice: '' }, NOW1).errors.previousOffer)
  assert.ok(analyzeCounter({ ...EX1, history: H(['buyer', 45], ['seller', 58.5], ['buyer', 50]) }, NOW1).errors.history)
  assert.ok(analyzeCounter({ ...EX1, category: '' }, NOW1).errors.category)
})

test('counter: floor warning, routing to accept / walk away / stop', () => {
  const floor = analyzeCounter({ ...EX1, previousOffer: '30', sellerCounter: '50' }, NOW1)
  assert.ok(floor.ok)
  assert.ok(floor.warnings.some((w) => w.id === 'below_floor'))
  assert.equal(floor.recommended.price, 37)
  for (const o of floor.options) assert.ok(o.price >= 36)

  for (const s of ['45', '44']) assert.equal(analyzeCounter({ ...EX1, sellerCounter: s }, NOW1).kind, 'accept_counter')
  assert.equal(analyzeCounter({ ...EX1, goalPrice: 59 }, NOW1).kind, 'accept_counter')
  for (const s of ['48', '47', '46']) {
    const r = analyzeCounter({ ...EX1, sellerCounter: s }, NOW1)
    assert.equal(r.kind, 'accept', s)
    assert.equal(r.recommended.id, 'accept')
  }
  assert.equal(analyzeCounter({ ...EX1, maxPrice: '46' }, NOW1).kind, 'walk_away')
  const stop = analyzeCounter({ ...EX1, history: H(['buyer', 45], ['seller', 58.5], ['buyer', 48.7], ['seller', 56], ['buyer', 51.3], ['seller', 55], ['buyer', 52.3], ['seller', 54.5]) }, NOW1)
  assert.equal(stop.kind, 'stop')
  assert.equal(stop.recommended, null)
})

/* ───────── worked example 1 ───────── */

test('counter EX1 (60 / 45 / 58,50): split at 51,70 € tomorrow 21:05, with the bold and accept options', () => {
  const r = analyzeCounter(EX1, NOW1)
  const n = r.negotiation
  assert.equal(r.kind, 'counter')
  near(n.sellerConcessionShare, 0.1, 1e-9)
  assert.equal(n.sellerStance, 'firm')
  near(n.splitTolerance, 0.0675, 1e-9)
  near(r.candidates.lo, 47.025, 1e-9)
  near(r.candidates.hi, 51.75, 1e-9)
  assert.equal(r.candidates.prices.length, 18)

  const rec = r.recommended
  assert.equal(rec.id, 'balanced')
  assert.equal(rec.price, 51.7)
  assert.ok(rec.isSplit && !rec.isFinal)
  near(rec.gapShare, 0.496, 0.001)
  near(rec.pAccept, 0.522, P)
  near(rec.expectedPrice, 54.72, 0.02)
  near(rec.expectedSaving, 3.78, 0.02)
  near(rec.pBelowSeller, 0.653, P)
  assert.equal(rec.totalWithFee, 54.99)
  assert.equal(rec.wholeEuroFallback, 52)

  sameTime(r.optimal.date, at(14, 21, 5))
  assert.equal(r.optimal.windowId, 'weeknight_early')
  assert.equal(r.optimal.tier, 'on_time')
  assert.equal(r.sendNow.reason, 'too_soon')
  sameTime(n.tooSoonUntil, at(13, 22, 40))
  assert.equal(n.deadline - n.receivedAt, 23.5 * 3_600_000)
  assert.equal(n.assumedExpiry - n.receivedAt, 24 * 3_600_000)
  sameTime(r.alsoGood.date, at(14, 21, 35))
  assert.equal(r.alsoGood.tier, 'tight')
  near(r.alsoGood.pAccept, 0.542, P)
  near(r.nowSlot.pAccept, 0.434, P)

  const bold = option(r, 'bold')
  assert.equal(bold.price, 48.7)
  near(bold.pAccept, 0.221, P)
  near(bold.expectedPrice, 55.32, 0.02)
  assert.equal(option(r, 'split'), undefined)
  assert.equal(option(r, 'accept').totalWithFee, 62.13)
  const ordered = r.options
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i].price > ordered[i - 1].price)
    assert.ok(ordered[i].pAccept > ordered[i - 1].pAccept)
  }

  assert.deepEqual({ ...rec.next.ifHolds, pAccept: Math.round(rec.next.ifHolds.pAccept * 1000) / 1000 }, { action: 'counter', price: 54.8, isFinal: true, isSplit: false, pAccept: 0.366, sellerPrice: 58.5 })
  assert.equal(rec.next.ifMoves.sellerPrice, 56.68)
  assert.equal(rec.next.ifMoves.price, 54.19)
  assert.ok(rec.next.ifMoves.isSplit)
  near(rec.next.ifMoves.pAccept, 0.626, P)

  assert.equal(r.factors.basePct, 42)
  assert.equal(r.factors.totalPct, 52)
  const pts = Object.fromEntries(r.factors.rows.map((x) => [x.id, x.deltaPoints]))
  assert.deepEqual({ split: pts.split, counter_stance: pts.counter_stance, time: pts.time, counter_delay: pts.counter_delay, counter_cooling: pts.counter_cooling, counter_habit: pts.counter_habit, counter_latency: pts.counter_latency, counter_message: pts.counter_message },
    { split: 8, counter_stance: -9, time: 6, counter_delay: 2, counter_cooling: -2, counter_habit: 2, counter_latency: -2, counter_message: 5 })
  assert.equal(r.factors.rows.reduce((s, x) => s + x.deltaPoints, 0), r.factors.totalPct - r.factors.basePct)

  assert.equal(r.verdict.hero.title, 'Rispondi con 51,70 €')
  assert.equal(r.verdict.headline, 'Invia la nuova offerta domani sera, mercoledì 14 ottobre, alle ore 21:05')
  assert.equal(r.recommendedTone, 'impegno')
  assert.match(r.ladder, /^Listino 60 € → tua offerta 45 € \(−25%\) → sua controproposta 58,50 € \(\+30% sulla tua, −2,5% dal listino\) → tua nuova offerta 51,70 €/)
  assert.ok(r.plan.some((l) => l === 'Se resta a 58,50 €: ultima offerta 54,80 €, poi basta.'))
  assert.match(r.reasons[0], /sceso solo di 1,50 € \(il 10% della distanza; di solito si scende del 40% circa\)/)
  assert.match(r.lines.risk, /Rischi al massimo 1,50 €/)
  assertGuardRails(r)
})

test('counter EX1: the recommendation is the minimum expected price over prices and on-time moments', () => {
  const norm = normalizeCounterInput(EX1, NOW1)
  const r = analyzeCounter(EX1, NOW1)
  for (const c of r.candidates.prices) {
    const e = evaluateCounter(norm.state, c, r.optimal.date, { isFinal: false })
    assert.ok(e.expectedPrice >= r.recommended.expectedPrice - 1e-9, `${c}: ${e.expectedPrice}`)
  }
  near(analyzeCounter({ ...EX1, publicPrice: true }, NOW1).recommended.expectedPrice, 54.74, 0.02)
  const chat = analyzeCounter({ ...EX1, channel: 'chat' }, NOW1)
  near(chat.recommended.expectedPrice, 54.63, 0.02)
  assert.equal(chat.recommended.price, 51.7)
})

/* ───────── seller stance and budget ───────── */

test('counter: the seller stance changes the step (flexible → small step, hold → one final offer)', () => {
  const flexible = analyzeCounter({ ...EX1, sellerCounter: '52' }, NOW1)
  assert.equal(flexible.negotiation.sellerStance, 'flexible')
  assert.equal(flexible.recommended.price, 47)
  near(flexible.recommended.pAccept, 0.25, P)
  near(flexible.recommended.expectedPrice, 50.016, 0.02)
  assert.equal(option(flexible, 'split').price, 48.5)
  near(option(flexible, 'split').pAccept, 0.554, P)

  const moving = analyzeCounter({ ...EX1, sellerCounter: '55' }, NOW1)
  assert.equal(moving.negotiation.sellerStance, 'moving')
  assert.equal(moving.recommended.price, 50)
  assert.ok(moving.recommended.isSplit)

  const firm = analyzeCounter({ ...EX1, sellerCounter: '57' }, NOW1)
  assert.equal(firm.recommended.price, 51)
  assert.ok(firm.recommended.isSplit)

  const hold = analyzeCounter({ ...EX1, sellerCounter: '60' }, NOW1)
  assert.equal(hold.negotiation.sellerStance, 'hold')
  assert.equal(hold.recommended.price, 49.8)
  assert.ok(hold.recommended.isFinal)
  assert.ok(hold.recommended.gapShare <= 0.35)
  near(hold.recommended.pAccept, 0.241, P)
  assert.ok(hold.tips.some((t) => t.includes('riprova')))
  assert.equal(hold.recommendedTone, 'motivato')
})

test('counter: a maximum budget caps every option, hides the saving and can force a final or a walk away', () => {
  assert.equal(analyzeCounter({ ...EX1, maxPrice: '75' }, NOW1).recommended.price, 51.7)
  assert.equal(analyzeCounter({ ...EX1, maxPrice: '58,50' }, NOW1).recommended.price, 51.7)
  const w55 = analyzeCounter({ ...EX1, maxPrice: '55' }, NOW1)
  assert.equal(w55.recommended.price, 51.7)
  sameTime(w55.optimal.date, at(14, 21, 35))
  assert.equal(w55.optimal.tier, 'tight')
  sameTime(w55.safeAlternative.date, at(14, 21, 5))
  assert.ok(option(w55, 'accept').overBudget)
  assert.equal(w55.recommended.expectedSaving, null)
  assert.equal(analyzeCounter({ ...EX1, maxPrice: '52' }, NOW1).recommended.price, 51.75)
  assert.equal(analyzeCounter({ ...EX1, maxPrice: '50' }, NOW1).recommended.price, 49.3)
  const w47 = analyzeCounter({ ...EX1, maxPrice: '47' }, NOW1)
  assert.equal(w47.recommended.price, 47)
  assert.ok(w47.recommended.isFinal)
  assert.equal(analyzeCounter({ ...EX1, maxPrice: '46' }, NOW1).kind, 'walk_away')
  for (const w of ['75', '58,50', '55', '52', '50', '47']) assertGuardRails(analyzeCounter({ ...EX1, maxPrice: w }, NOW1))
})

/* ───────── timing ───────── */

test('counter timing: sale risk, inactive seller, unknown send time, opening the app later', () => {
  const competition = analyzeCounter({ ...EX1, competition: true }, NOW1)
  sameTime(competition.optimal.date, at(14, 21, 5))
  near(competition.recommended.expectedPrice, 54.93, 0.02)
  sameTime(analyzeCounter({ ...EX1, category: 'electronics', listingAge: 'today', publicPrice: true }, NOW1).optimal.date, at(13, 22, 40))

  const inactive = analyzeCounter({ ...EX1, sellerProfile: 'inactive' }, NOW1)
  sameTime(inactive.optimal.date, at(13, 22, 10))
  near(inactive.components.pRead, 0.889, 0.002)
  near(inactive.recommended.pAccept, 0.428, P)

  const noSent = analyzeCounter({ ...EX1, offerSentAt: null }, NOW1)
  assert.equal(noSent.factors.rows.find((x) => x.id === 'counter_latency'), undefined)
  near(noSent.recommended.pAccept, 0.545, P)

  const morning = analyzeCounter(EX1, at(14, 7, 50))
  sameTime(morning.optimal.date, at(14, 21, 5))
  assert.equal(morning.sendNow.reason, 'avoid_window')
  assert.equal(analyzeCounter(EX1, at(14, 20, 50)).sendNow.reason, 'worse')
  const nine = analyzeCounter(EX1, at(14, 21, 0))
  assert.equal(nine.optimal.kind, 'now')
  sameTime(nine.optimal.date, at(14, 21, 5))
  assert.equal(nine.sendNow.reason, 'chosen')
})

test('counter timing: lunch, late counters, forced bad window, Sunday, holiday', () => {
  const lunch = analyzeCounter({ ...EX1, offerSentAt: at(14, 12, 0), receivedAt: at(14, 12, 50) }, at(14, 13, 0))
  sameTime(lunch.optimal.date, at(14, 21, 35))
  assert.equal(lunch.optimal.windowId, 'weeknight_late')
  assert.equal(lunch.optimal.tier, 'on_time')
  assert.equal(lunch.sendNow.reason, 'too_soon')

  const late = analyzeCounter({ ...EX1, offerSentAt: at(14, 21, 45), receivedAt: at(14, 22, 40) }, at(15, 9, 0))
  sameTime(late.optimal.date, at(15, 21, 45))
  assert.ok(late.optimal.date <= late.negotiation.deadline)
  assert.equal(late.sendNow.reason, 'avoid_window')

  const forced = analyzeCounter({ ...EX1, offerSentAt: at(13, 21, 45), receivedAt: at(14, 10, 0) }, at(15, 9, 0))
  sameTime(forced.optimal.date, at(15, 9, 5))
  assert.ok(forced.timing.deadlineForcesBadWindow)
  sameTime(forced.reapproach.date, at(15, 21, 35))
  assert.ok(forced.tips.some((t) => t.includes('scade')))

  const sunday = analyzeCounter({ ...EX1, offerSentAt: at(18, 21, 0), receivedAt: at(18, 21, 45) }, at(18, 21, 50))
  sameTime(sunday.optimal.date, at(18, 22, 45))
  assert.equal(sunday.optimal.windowId, 'sunday_night')

  const holiday = analyzeCounter({ ...EX1, offerSentAt: new Date(2026, 11, 7, 21, 0), receivedAt: new Date(2026, 11, 7, 21, 40) }, new Date(2026, 11, 7, 21, 45))
  sameTime(holiday.optimal.date, new Date(2026, 11, 8, 21, 5))
  assert.equal(holiday.optimal.windowId, 'sunday_night')
  assert.equal(holiday.optimal.score.timeWindow.label, 'Sera di festa')
})

test('counter timing: stale counter, chat counter, received-ago chip, pinned moment, no assumed expiry', () => {
  const stale = analyzeCounter(EX1, at(15, 9, 0))
  assert.equal(stale.kind, 'counter_stale')
  sameTime(stale.optimal.date, at(15, 21, 35))
  assert.match(option(stale, 'accept').label, /se il pulsante non c'è più/)
  for (const m of stale.messages) assert.match(m.text, /^Ciao! Scusa se ti rispondo solo ora\./)

  const chat = analyzeCounter({ ...EX1, channel: 'chat' }, NOW1)
  assert.equal(chat.negotiation.assumedExpiry, null)
  assert.equal(chat.negotiation.deadline, null)
  assert.ok(chat.negotiation.sellerPriceSurvives)
  assert.match(option(chat, 'accept').label, /Fai un'offerta/)
  assert.ok(!chat.reminders.some((x) => x.kind === 'counter_deadline'))
  sameTime(chat.optimal.date, at(14, 21, 5))

  const chip = analyzeCounter({ ...EX1, receivedAt: null, offerSentAt: null, receivedAgo: 'hours_1_3' }, NOW1)
  sameTime(chip.negotiation.receivedAt, new Date(NOW1.getTime() - 120 * 60_000))
  assert.equal(chip.negotiation.receivedUncertaintyMinutes, 60)
  assert.equal(chip.negotiation.assumedExpiry - chip.negotiation.receivedAt, (24 * 60 - 60) * 60_000)
  assert.equal(chip.factors.rows.find((x) => x.id === 'counter_habit'), undefined)
  sameTime(chip.optimal.date, at(13, 21, 50))
  assert.equal(chip.sendNow.reason, 'chosen')

  const pinned = analyzeCounter(EX1, NOW1, { preferredSendAt: at(14, 21, 35) })
  assert.ok(pinned.pinned)
  sameTime(pinned.optimal.date, at(14, 21, 35))
  assert.equal(pinned.recommended.price, 51.7)
  near(pinned.recommended.pAccept, 0.542, P)

  const open = analyzeCounter(EX1, NOW1, { validityHours: null })
  assert.equal(open.negotiation.assumedExpiry, null)
  sameTime(open.best.date, at(14, 21, 35))
  assert.ok(open.optimal.date <= open.best.date)
  assert.ok(open.optimal.expectedPrice <= open.best.expectedPrice + Math.max(0.02, 0.03 * (58.5 - open.best.expectedPrice)) + 1e-9)
})

test('counter timing [Rome]: DST weekend keeps 23,5 h of real time to the soft deadline', { skip: !IS_ROME && !IS_UTC }, () => {
  const r = analyzeCounter({ ...EX1, offerSentAt: at(24, 21, 30), receivedAt: at(24, 22, 0) }, at(24, 22, 5))
  assert.equal(r.negotiation.deadline - r.negotiation.receivedAt, 23.5 * 3_600_000)
  if (IS_ROME) {
    assert.equal(r.negotiation.deadline.getHours(), 20)
    assert.equal(r.negotiation.deadline.getMinutes(), 30)
    sameTime(r.optimal.date, at(25, 10, 5))
    assert.equal(r.optimal.windowId, 'sunday_morning')
    sameTime(r.alsoGood.date, at(25, 21, 5))
    near(r.alsoGood.pAccept, 0.595, P)
  } else {
    sameTime(r.optimal.date, at(25, 21, 5))
  }
})

test('counter timing invariants over a week of counters (polite delay, no bad windows, no quiet hours, guard rails)', () => {
  let runs = 0
  for (let day = 12; day <= 18; day++) {
    for (let hour = 0; hour < 24; hour += 3) {
      for (const lag of [5, 300]) {
        for (const sellerProfile of ['unknown', 'inactive']) {
          const receivedAt = at(day, hour, 25)
          const now = new Date(receivedAt.getTime() + lag * 60_000)
          const r = analyzeCounter({ ...EX1, sellerProfile, offerSentAt: new Date(receivedAt.getTime() - 3_600_000), receivedAt }, now)
          runs++
          if (!r.optimal) continue
          assert.ok(r.optimal.date > now)
          const minDelay = sellerProfile === 'inactive' ? 30 : 60
          if (r.kind !== 'counter_stale') assert.ok(r.optimal.date - receivedAt >= minDelay * 60_000 - 1)
          const w = timeWindowAt(r.optimal.date)
          if (!r.timing.deadlineForcesBadWindow) assert.ok(w.weight >= 0, `bad window ${w.id} at ${r.optimal.date}`)
          const m = r.optimal.date.getHours() * 60 + r.optimal.date.getMinutes()
          if (m >= 23 * 60 || m < 7 * 60) assert.ok(w.weight > 0 || r.timing.deadlineForcesBadWindow, `quiet hour ${r.optimal.date}`)
          assertGuardRails(r)
        }
      }
    }
  }
  assert.equal(runs, 7 * 8 * 2 * 2)
})

/* ───────── small and large prices ───────── */

test('counter: tiny gaps go to the split or to accepting', () => {
  const ff = { ...EX1, category: 'fast_fashion' }
  assert.equal(analyzeCounter({ ...ff, listPrice: '8', previousOffer: '5,50', sellerCounter: '7' }, NOW1).kind, 'accept')
  const r = analyzeCounter({ ...ff, listPrice: '8', previousOffer: '5,50', sellerCounter: '7,50' }, NOW1)
  assert.equal(r.recommended.price, 6.5)
  assert.ok(r.recommended.isSplit)
  assert.equal(analyzeCounter({ ...ff, listPrice: '6', previousOffer: '4', sellerCounter: '5,50' }, NOW1).kind, 'accept')
})

test('counter EX2 (cheap fast fashion): 11 € on Sunday night, split shown as the safer option', () => {
  const r = analyzeCounter(EX2, at(18, 15, 20))
  assert.deepEqual(r.candidates.prices, [11, 11.3, 11.7, 11.75])
  assert.equal(r.recommended.price, 11)
  near(r.recommended.pAccept, 0.407, P)
  near(r.recommended.expectedPrice, 12.14, 0.02)
  near(r.recommended.expectedSaving, 1.36, 0.02)
  assert.equal(r.recommended.totalWithFee, 12.25)
  const split = option(r, 'split')
  assert.equal(split.price, 11.75)
  near(split.pAccept, 0.717, P)
  near(split.expectedPrice, 12.18, 0.02)
  assert.equal(option(r, 'bold'), undefined)
  sameTime(r.optimal.date, at(18, 21, 5))
  assert.equal(r.optimal.windowId, 'sunday_night')
  assert.equal(r.sendNow.reason, 'too_soon')
  assert.equal(r.recommended.next.ifHolds.price, 11.3)
  assert.ok(r.recommended.next.ifHolds.isFinal)
  assert.equal(r.recommended.next.ifMoves.sellerPrice, 12.51)
  assert.equal(r.recommended.next.ifMoves.price, 11.7)
  assertGuardRails(r)
})

test('counter EX3 (expensive collectible): 355 € split on Sunday night, integer grid above 200 €', () => {
  const r = analyzeCounter(EX3, at(24, 22, 15))
  assert.equal(r.candidates.prices.length, 15)
  assert.equal(r.recommended.price, 355)
  assert.ok(r.recommended.isSplit)
  sameTime(r.optimal.date, at(25, 21, 5))
  assert.equal(option(r, 'bold').price, 338)
  assert.equal(r.recommended.next.ifHolds.price, 372)
  assert.ok(r.recommended.next.ifHolds.isFinal)
  assert.equal(r.recommended.next.ifMoves.sellerPrice, 381.43)
  assert.equal(r.recommended.next.ifMoves.price, 368)
  assert.equal(r.recommended.totalWithFee, 373.45)
  if (IS_ROME) {
    near(r.recommended.pAccept, 0.639, P)
    assert.equal(r.optimal.tier, 'tight')
    sameTime(r.safeAlternative.date, at(25, 10, 5))
    assert.equal(r.negotiation.assumedExpiry.getHours(), 21)
    assert.equal(r.negotiation.assumedExpiry.getMinutes(), 10)
  } else if (IS_UTC) {
    near(r.recommended.pAccept, 0.644, P)
  }
  assertGuardRails(r)
})

test('counter: large luxury item stays fast and uses non-multiples of 5', () => {
  const t0 = Date.now()
  const r = analyzeCounter({ ...EX1, category: 'luxury', listPrice: '1000', previousOffer: '650', sellerCounter: '980', listingAge: 'weeks_2_4', sellerProfile: 'expert' }, NOW1)
  assert.ok(Date.now() - t0 < 1000)
  assert.equal(r.recommended.price, 815)
  assert.ok(r.recommended.isSplit)
  assert.equal(option(r, 'bold').price, 733)
  for (const p of r.candidates.prices) if (p !== splitPrice(650, 980, 1000)) assert.ok(Number.isInteger(p) && p % 5 !== 0, String(p))
})

/* ───────── later rounds ───────── */

test('counter round 2 after 51,70 €: final after a hold, split when he moves, accept when close', () => {
  const round2 = (s2) => analyzeCounter({ ...EX1, history: H(['buyer', 45, at(13, 21, 35)], ['seller', 58.5, at(13, 21, 40)], ['buyer', 51.7, at(14, 21, 5)], ['seller', s2, at(14, 21, 50)]) }, at(14, 21, 55))
  const hold = round2(58.5)
  assert.equal(hold.recommended.price, 54.8)
  assert.ok(hold.recommended.isFinal)
  sameTime(hold.optimal.date, at(15, 21, 5))
  near(hold.recommended.pAccept, 0.384, P)
  near(hold.recommended.expectedPrice, 57.25, 0.02)
  const raised = round2(59)
  assert.equal(raised.recommended.price, 54.8)
  assert.ok(raised.warnings.some((w) => w.id === 'seller_raised'))
  assert.equal(round2(57.5).recommended.price, 54.6)
  assert.ok(round2(57.5).recommended.isSplit)
  const close = round2(56.7)
  assert.equal(close.recommended.price, 54.2)
  sameTime(close.optimal.date, at(14, 22, 50))
  assert.equal(round2(56).recommended.price, 53.85)
  assert.equal(round2(54).kind, 'accept')
  for (const s2 of [58.5, 57.5, 56.7, 56]) assert.ok(round2(s2).recommended.price - 51.7 <= 0.75 * 6.7 + 1e-9)
})

test('counter round 2 after 48,70 € and round 3', () => {
  const round2 = (s2) => analyzeCounter({ ...EX1, history: H(['buyer', 45, at(13, 21, 35)], ['seller', 58.5, at(13, 21, 40)], ['buyer', 48.7, at(14, 21, 5)], ['seller', s2, at(14, 21, 50)]) }, at(14, 21, 55))
  const final = round2(58.5)
  assert.equal(final.recommended.price, 50.3)
  assert.ok(final.recommended.isFinal)
  assert.equal(round2(57.5).recommended.price, 50.8)
  assert.equal(round2(56).recommended.price, 51)
  assert.equal(round2(55.9).recommended.price, 51.3)
  const split = round2(54)
  assert.equal(split.recommended.price, 51.35)
  assert.ok(split.recommended.isSplit)
  const r3 = analyzeCounter({ ...EX1, history: H(['buyer', 45, at(13, 21, 35)], ['seller', 58.5, at(13, 21, 40)], ['buyer', 48.7, at(14, 21, 5)], ['seller', 56, at(14, 21, 50)], ['buyer', 51.3, at(15, 21, 5)], ['seller', 55, at(15, 21, 50)]) }, at(15, 21, 55))
  assert.equal(r3.kind, 'accept')
})

/* ───────── messages, preview, reminders ───────── */

test('counter messages: never repeat his number, split and final wording only when true, payment promise, no threats', () => {
  const variants = [
    { isSplit: false, isFinal: false, price: 49.3 },
    { isSplit: true, isFinal: false, price: 51.7 },
    { isSplit: false, isFinal: true, price: 54.8 },
    { isSplit: true, isFinal: true, price: 51.7 },
  ]
  for (const v of variants) {
    const msgs = buildCounterMessages({ itemTitle: 'Nike Air Force 1', previousOffer: 45, firstOffer: 45, sendAt: at(14, 21, 5), total: buyerTotal(v.price), ...v })
    assert.deepEqual(msgs.map((m) => m.tone), TONES.map((t) => t.id))
    for (const m of msgs) {
      assert.match(m.text, /^Ciao!/)
      assert.ok(m.text.includes(formatEuro(v.price)), m.text)
      assert.ok(!m.text.includes('58,50'), m.text)
      assert.equal(m.text.includes('metà strada'), v.isSplit, m.text)
      assert.equal(m.text.includes('massimo'), v.isFinal, m.text)
      assert.ok((m.text.match(/massimo/g) || []).length <= 1, m.text)
      assert.ok(/subito|appena accetti/.test(m.text), m.text)
      assert.ok(!/entro|scade|non vale|rovinat|troppo caro|difett|sono salit/.test(m.text), m.text)
      assert.ok(m.text.length <= 300, `${m.text.length}: ${m.text}`)
    }
    if (!v.isSplit && !v.isFinal) {
      const motivato = msgs.find((m) => m.tone === 'motivato').text
      assert.match(motivato, /Ho rifatto i conti/)
      assert.match(motivato, /ho alzato la mia offerta da 45 €/)
    }
  }
})

test('counter preview line under the field', () => {
  assert.equal(counterPreview({ listPrice: '60', previousOffer: '45', sellerCounter: '58,50' }).text, '58,50 € · il 30% sopra la tua offerta · è sceso di 1,50 € dal listino (−2,5%), il 10% della distanza')
  assert.equal(counterPreview({ listPrice: '60', previousOffer: '45', sellerCounter: '30', counterMode: 'pct' }).S, 58.5)
  assert.ok(counterPreview({ listPrice: '60', previousOffer: '45', sellerCounter: '63' }).overList)
  assert.equal(counterPreview({ listPrice: '60', previousOffer: '45', sellerCounter: '' }), null)
  assert.equal(counterPreview({ listPrice: '60', previousOffer: '51,70', sellerCounter: '56,70', sellerPrevious: 58.5 }).text, '56,70 € · il 10% sopra la tua offerta · è sceso di 1,80 € dalla sua proposta precedente (−3,1%), il 26% della distanza')
})

test('counter reminders: send and last call before, nudge and give-up after, nothing in quiet hours', () => {
  const r = analyzeCounter(EX1, NOW1)
  const before = Object.fromEntries(r.reminders.map((x) => [x.kind, x]))
  sameTime(before.counter_send.at, at(14, 20, 55))
  sameTime(before.counter_deadline.at, at(14, 21, 25))
  const after = buildCounterReminders(r, { sentAt: at(14, 21, 5) })
  const followup = after.find((x) => x.kind === 'counter_followup')
  assert.equal(followup.at.getDate(), 15)
  assert.ok(timeWindowAt(followup.at).weight > 0)
  sameTime(after.find((x) => x.kind === 'counter_giveup').at, at(17, 21, 5))
  for (const x of [...r.reminders, ...after]) {
    const m = x.at.getHours() * 60 + x.at.getMinutes()
    assert.ok(m >= 7 * 60 && m < 23 * 60, `${x.kind} at ${x.at}`)
  }
  if (IS_ROME) assert.ok(!analyzeCounter(EX3, at(24, 22, 15)).reminders.some((x) => x.kind === 'counter_deadline'))
})

/* ───────── regressions ───────── */

test('counter: the first-offer verdict keeps its wording, the counter verdict exposes the action', () => {
  const slot = { date: at(14, 21, 5), kind: 'canonical', score: { timeWindow: timeWindowAt(at(14, 21, 5)) }, expiresAt: at(15, 21, 5), pOverall: 0.5 }
  assert.match(buildVerdict(slot, {}, NOW1).headline, /^Invia l'offerta /)
  const v = buildVerdict(slot, {}, NOW1, null, { subject: 'la nuova offerta' })
  assert.equal(v.action, v.headline.replace('Invia la nuova offerta ', ''))
})

test('mobile/core is a byte-identical copy of src/core (run `npm run sync-core` in mobile/)', () => {
  const src = join(root, 'src/core')
  const dst = join(root, 'mobile/core')
  const files = readdirSync(src).sort()
  assert.deepEqual(readdirSync(dst).sort(), files)
  for (const f of files) assert.equal(readFileSync(join(dst, f), 'utf8'), readFileSync(join(src, f), 'utf8'), f)
})

test('the artifact bundler accepts every module (no collisions, no dangling imports)', () => {
  const out = spawnSync(process.execPath, [join(root, 'scripts/build-artifact.mjs'), '--check'], { encoding: 'utf8' })
  assert.equal(out.status, 0, out.stderr)
})
