import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeOffer, articleFor, buildCandidateSlots, buildMessages, computeDiscountPct, easterSunday, formatDayList,
  formatEuro, formatLongDate, formatPoints, formatRelativeDay, formatTime, isItalianHoliday, monthWindowAt, normalizeInput,
  parsePrice, riskBandFor, romeOffsetMinutes, timeWindowAt, CATEGORIES, LISTING_AGES, SELLER_PROFILES, LISTING_SIGNALS, TONES,
  nextGoalFor, optimizeOffer, parseVintedItemHtml, parseRelativeItalian, buildFormFromExtraction, categoryGuess, signalFromText, cleanTitle,
  sellerProfileGuess, listingAgeGuess, findPriceInText, detectVintedChallenge,
  MONTH_END_WEIGHT, POSITIVE_CAP, QUIET_READ_PROBABILITY, SUGGESTED_PRICE_FLOOR, SUGGESTED_PRICE_SHARE_OF_MAX, goalChoicesFor, maxReachable,
  normalizeProfile, predictiveInterval, priceBandWeight, readProbability, scoreAt,
  DOM_SIGNAL_SCALE, SIGNAL_WEIGHTS, demandWeight, reducedWeight, viewsWeight,
} from '../src/core/index.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Sunday 4 October 2026, 16:00 local time.
const SUNDAY_AFTERNOON = new Date(2026, 9, 4, 16, 0)
// Wednesday 7 October 2026, 13:00 (lunch break).
const WEDNESDAY_LUNCH = new Date(2026, 9, 7, 13, 0)

const base = { category: 'sneakers', listPrice: '100', targetPrice: '80', listingAge: 'unknown', sellerProfile: 'unknown', listingSignal: 'none' }

test('enum ids match the spec', () => {
  assert.deepEqual(CATEGORIES.map((c) => c.id), ['sneakers', 'fast_fashion', 'collectible', 'electronics', 'kids', 'luxury', 'other'])
  assert.deepEqual(LISTING_AGES.map((a) => a.id), ['unknown', 'today', 'days_2_6', 'weeks_1_2', 'weeks_2_4', 'over_month'])
  assert.deepEqual(SELLER_PROFILES.map((s) => s.id), ['unknown', 'new_seller', 'expert', 'quiet', 'inactive'])
  assert.equal(SELLER_PROFILES.find((s) => s.id === 'quiet').label, 'Poco attivo')
  assert.deepEqual(LISTING_SIGNALS.map((s) => s.id), ['none', 'fixed_price', 'open_to_offers', 'clearing_out'])
  assert.deepEqual(TONES.map((t) => t.id), ['cordiale', 'diretto', 'impegno', 'motivato'])
})

test('discount and risk bands follow the spec thresholds (<15 low, 15–30 medium, >30 high)', () => {
  assert.equal(computeDiscountPct(100, 90), 10)
  assert.equal(riskBandFor(10).id, 'low')
  assert.equal(riskBandFor(14.9).id, 'low')
  assert.equal(riskBandFor(15).id, 'medium')
  assert.equal(riskBandFor(30).id, 'medium')
  assert.equal(riskBandFor(30.1).id, 'high')
})

test('validation reports every missing field with an Italian message', () => {
  const { ok, errors } = normalizeInput({ category: '', listPrice: '', targetPrice: 'abc' })
  assert.equal(ok, false)
  assert.ok(errors.category)
  assert.ok(errors.listPrice)
  assert.ok(errors.targetPrice)
})

test('comma decimals are accepted', () => {
  const { ok, input } = normalizeInput({ ...base, listPrice: '12,50', targetPrice: '10' })
  assert.equal(ok, true)
  assert.equal(input.listPrice, 12.5)
  assert.equal(input.discountPct, 20)
})

test('target at or above list price needs no offer', () => {
  const r = analyzeOffer({ ...base, targetPrice: '100' }, SUNDAY_AFTERNOON)
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'no_offer_needed')
})

test('discounts above the Vinted 40% cap are analysed at the minimum sendable price', () => {
  const r = analyzeOffer({ ...base, category: 'electronics', listPrice: '200', targetPrice: '110' }, SUNDAY_AFTERNOON)
  assert.equal(r.kind, 'over_cap')
  assert.equal(r.cappedPrice, 120)
  assert.equal(r.requestedInput.targetPrice, 110)
  assert.equal(r.input.targetPrice, 120)
  assert.ok(r.input.discountPct <= 40)
  assert.ok(r.probability > 0 && r.probability < 1)
  assert.ok(r.capAdvice.length >= 2)
})

test('time windows map to the spec, holidays count as Sundays', () => {
  assert.equal(timeWindowAt(new Date(2026, 9, 4, 21, 30)).id, 'sunday_night')
  assert.equal(timeWindowAt(new Date(2026, 9, 4, 16, 0)).id, 'sunday_afternoon')
  assert.equal(timeWindowAt(new Date(2026, 9, 4, 11, 0)).id, 'sunday_morning')
  assert.equal(timeWindowAt(new Date(2026, 9, 6, 21, 15)).id, 'weeknight_early') // Tuesday
  assert.equal(timeWindowAt(new Date(2026, 9, 6, 21, 45)).id, 'weeknight_late')
  assert.equal(timeWindowAt(new Date(2026, 9, 6, 22, 45)).id, 'weeknight_end')
  assert.equal(timeWindowAt(new Date(2026, 9, 9, 21, 45)).id, 'friday_night')
  assert.equal(timeWindowAt(new Date(2026, 9, 10, 21, 45)).id, 'saturday_night')
  assert.equal(timeWindowAt(new Date(2026, 9, 10, 11, 0)).id, 'saturday_morning')
  assert.equal(timeWindowAt(new Date(2026, 9, 7, 13, 0)).id, 'lunch')
  assert.equal(timeWindowAt(new Date(2026, 9, 7, 12, 10)).id, 'pre_lunch')
  assert.equal(timeWindowAt(new Date(2026, 9, 7, 10, 0)).id, 'work_morning')
  assert.equal(timeWindowAt(new Date(2026, 9, 7, 8, 0)).id, 'commute')
  assert.equal(timeWindowAt(new Date(2026, 9, 7, 15, 0)).id, 'work_afternoon')
  assert.equal(timeWindowAt(new Date(2026, 9, 7, 20, 0)).id, 'after_dinner')
  assert.equal(timeWindowAt(new Date(2026, 9, 7, 2, 0)).id, 'night')
  assert.equal(timeWindowAt(new Date(2026, 9, 7, 23, 30)).id, 'neutral')
  assert.equal(timeWindowAt(new Date(2026, 9, 7, 18, 30)).id, 'neutral')
  assert.equal(timeWindowAt(new Date(2027, 0, 6, 21, 45)).id, 'sunday_night') // Epifania (Wednesday)
  assert.equal(timeWindowAt(new Date(2027, 2, 29, 21, 45)).id, 'sunday_night') // Easter Monday 2027
})

test('lunch is the worst window of the week, Sunday night the best', () => {
  const lunch = timeWindowAt(new Date(2026, 9, 7, 13, 0)).weight
  const sunday = timeWindowAt(new Date(2026, 9, 4, 21, 45)).weight
  const weeknight = timeWindowAt(new Date(2026, 9, 6, 21, 45)).weight
  const morning = timeWindowAt(new Date(2026, 9, 7, 10, 0)).weight
  assert.ok(lunch < morning && morning < 0)
  assert.ok(sunday > weeknight && weeknight > 0)
})

test('month windows ramp instead of jumping and follow the end of the month', () => {
  assert.equal(monthWindowAt(new Date(2026, 9, 25)).id, 'month_end')
  assert.equal(MONTH_END_WEIGHT, 0.1)
  assert.equal(monthWindowAt(new Date(2026, 9, 25)).weight, MONTH_END_WEIGHT)
  assert.equal(monthWindowAt(new Date(2026, 9, 24)).id, 'month_late')
  assert.ok(monthWindowAt(new Date(2026, 9, 24)).weight > 0.75 * MONTH_END_WEIGHT && monthWindowAt(new Date(2026, 9, 24)).weight < MONTH_END_WEIGHT)
  assert.equal(monthWindowAt(new Date(2026, 9, 18)).weight, 0)
  assert.equal(monthWindowAt(new Date(2026, 9, 12)).id, 'month_mid')
  assert.equal(monthWindowAt(new Date(2026, 9, 3)).id, 'month_start')
  assert.equal(monthWindowAt(new Date(2026, 9, 3)).weight, -0.15)
  assert.ok(monthWindowAt(new Date(2026, 9, 6)).weight > -0.15 && monthWindowAt(new Date(2026, 9, 6)).weight < 0)
  assert.equal(monthWindowAt(new Date(2026, 9, 9)).weight, 0)
  assert.equal(monthWindowAt(new Date(2027, 1, 22)).id, 'month_end') // short February
})

test('candidate slots: "now" always first, everything in the future, no duplicate window per day', () => {
  const { input } = normalizeInput(base)
  const now = new Date(2026, 9, 4, 21, 20) // Sunday night, inside the S window
  const slots = buildCandidateSlots(input, now, 7)
  assert.equal(slots[0].kind, 'now')
  assert.ok(slots[0].date.getTime() - now.getTime() <= 10 * 60_000)
  assert.ok(slots.every((s) => s.date.getTime() > now.getTime()))
  const sameDaySunday = slots.filter((s) => s.date.getDate() === 4 && s.windowId === 'sunday_night')
  assert.equal(sameDaySunday.length, 1)
  for (const s of slots.filter((x) => x.kind === 'canonical')) {
    assert.ok(timeWindowAt(s.date).weight > 0, `canonical slot in non-positive window: ${s.date}`)
  }
})

test('canonical slots survive the DST change (24 → 25 October 2026)', () => {
  const { input } = normalizeInput(base)
  const slots = buildCandidateSlots(input, new Date(2026, 9, 24, 12, 0), 3)
  const sunday = slots.filter((s) => s.date.getDate() === 25 && s.date.getMonth() === 9)
  assert.ok(sunday.length >= 2)
  // Canonical Sunday times are 11:00, 16:30 and 21:45, each shifted by at most 10 minutes of deterministic jitter.
  const minutes = (d) => d.getHours() * 60 + d.getMinutes()
  assert.ok(sunday.every((s) => [11 * 60, 16 * 60 + 30, 21 * 60 + 45].some((c) => Math.abs(minutes(s.date) - c) <= 10)), sunday.map((s) => s.date.toString()).join(', '))
})

test('analysis returns the full result shape', () => {
  const r = analyzeOffer(base, SUNDAY_AFTERNOON)
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'analysis')
  assert.ok(r.probability > 0 && r.probability < 1)
  assert.ok(r.probabilityRange.low <= r.probability && r.probability <= r.probabilityRange.high)
  assert.equal(r.probabilityRange.n, 0, 'no learned profile: the range is the prior, verified on no outcome')
  assert.ok(r.maxProbability >= r.probability && r.targetProbability > 0)
  assert.ok(r.optimal.date instanceof Date)
  // A 20% ask on 100 € with no signal inviting offers: the gate leads («scrivi prima»), the time slot is the second line.
  assert.equal(r.gate.kind, 'message_first')
  assert.equal(r.gate.rule, 9)
  assert.equal(r.verdict.headline, 'Scrivi prima, offri dopo la risposta')
  assert.match(r.verdict.sublabel, /^Se risponde, offri: /)
  assert.match(r.verdict.timing.headline, /^Invia l'offerta /)
  assert.deepEqual(Object.keys(r.tier), ['id', 'label', 'min'])
  assert.equal(r.messagePolicy.assigned, 'message_first')
  assert.equal(r.messageBeforeOffer, true)
  assert.ok(r.verdict.expiresLabel.length > 5)
  assert.ok(r.opening.length > 20)
  assert.ok(r.reasons.length >= 1 && r.reasons.length <= 3)
  assert.ok(r.reasons.every((s) => /[.!]$/.test(s) && !s.includes(': :')))
  assert.equal(typeof r.sendNow.ok, 'boolean')
  assert.equal(r.messages.length, 4)
  assert.ok(TONES.some((t) => t.id === r.recommendedTone))
  assert.ok(r.avoid.length >= 3)
  assert.match(r.avoid[0].rangeLabel, /^\d\d:\d\d–\d\d:\d\d$/)
  assert.ok(r.avoid[0].daysLabel.length > 0)
  assert.ok(['low', 'medium', 'high'].includes(r.blockRisk.level))
  assert.ok(Array.isArray(r.blockRisk.reasons))
  assert.ok(Array.isArray(r.warnings))
  assert.ok(r.tips.length >= 1)
})

test('factor rows add up exactly from the base to the headline acceptance', () => {
  const scenarios = [
    base,
    { ...base, category: 'luxury', targetPrice: '62', sellerProfile: 'expert', listingAge: 'weeks_1_2' },
    { ...base, category: 'fast_fashion', listPrice: '40', targetPrice: '26', listingAge: 'today' },
    { ...base, category: 'kids', listPrice: '15', targetPrice: '12', listingAge: 'weeks_2_4', sellerProfile: 'new_seller', listingSignal: 'clearing_out' },
    { ...base, category: 'collectible', listingAge: 'over_month', sellerProfile: 'inactive', listingSignal: 'fixed_price' },
  ]
  for (const raw of scenarios) {
    const r = analyzeOffer(raw, WEDNESDAY_LUNCH)
    const sum = r.factors.rows.reduce((s, row) => s + row.deltaPoints, 0)
    assert.equal(r.factors.basePct + sum, r.factors.totalPct, JSON.stringify(raw))
    assert.equal(r.factors.totalPct, Math.round(r.components.pAccept * 100))
  }
})

test('low-risk offers go out quickly, high-risk offers wait for a top-tier window', () => {
  const low = analyzeOffer({ ...base, targetPrice: '92' }, WEDNESDAY_LUNCH)
  assert.ok(low.optimal.daysWaited <= 1, `low risk waited ${low.optimal.daysWaited} days`)
  assert.ok(low.optimal.score.timeWindow.weight > 0)

  const high = analyzeOffer({ ...base, targetPrice: '62' }, WEDNESDAY_LUNCH)
  assert.ok(['sunday_night', 'weeknight_late', 'weeknight_early'].includes(high.optimal.score.timeWindow.id), high.optimal.score.timeWindow.id)
  assert.ok(high.probability < low.probability)
  assert.equal(high.sendNow.ok, false)
  assert.equal(high.nowInAvoid, true)
})

test('the recommended moment never lands in a negative window', () => {
  const inputs = [
    { ...base },
    { ...base, category: 'luxury', targetPrice: '62', sellerProfile: 'expert' },
    { ...base, category: 'fast_fashion', targetPrice: '60', listingAge: 'today' },
    { ...base, category: 'collectible', listingAge: 'over_month', sellerProfile: 'inactive' },
    { ...base, category: 'kids', targetPrice: '70', listingAge: 'weeks_2_4', sellerProfile: 'new_seller' },
    { ...base, category: 'other', targetPrice: '75', listingSignal: 'open_to_offers' },
  ]
  const nows = [SUNDAY_AFTERNOON, WEDNESDAY_LUNCH, new Date(2026, 9, 30, 9, 0), new Date(2026, 10, 1, 23, 30), new Date(2026, 9, 5, 2, 0)]
  for (const now of nows) {
    for (const raw of inputs) {
      const r = analyzeOffer(raw, now)
      assert.ok(r.optimal.score.timeWindow.weight >= 0, `${JSON.stringify(raw)} @ ${now} → ${r.optimal.score.timeWindow.id}`)
      assert.ok(r.optimal.date.getTime() > now.getTime())
    }
  }
})

test('quick alternative exists only when the recommended moment is more than 36 hours away', () => {
  const r = analyzeOffer({ ...base, category: 'fast_fashion', listPrice: '40', targetPrice: '26', listingAge: 'today' }, SUNDAY_AFTERNOON)
  if (r.optimal.date.getTime() - SUNDAY_AFTERNOON.getTime() > 36 * 3_600_000) {
    assert.ok(r.quick, 'expected a quick alternative')
    assert.ok(r.quick.date.getTime() < r.optimal.date.getTime())
    assert.ok(r.quick.date.getTime() - SUNDAY_AFTERNOON.getTime() <= 48 * 3_600_000)
  } else {
    assert.equal(r.quick, null)
  }
  const tonight = analyzeOffer({ ...base, targetPrice: '92' }, SUNDAY_AFTERNOON)
  assert.equal(tonight.quick, null)

  // Regression: the quick alternative must always come BEFORE the recommended moment.
  const edge = analyzeOffer({ category: 'fast_fashion', listPrice: '132.5', targetPrice: '62.23', listingAge: 'today', sellerProfile: 'inactive', listingSignal: 'fixed_price' }, new Date(2027, 1, 12, 21, 46))
  if (edge.quick) assert.ok(edge.quick.date.getTime() < edge.optimal.date.getTime())
})

test('suggested price appears only when the probability is under the relative target and is above the target price', () => {
  const r = analyzeOffer({ ...base, category: 'luxury', listPrice: '500', targetPrice: '300', sellerProfile: 'expert' }, SUNDAY_AFTERNOON)
  assert.ok(r.suggestedPrice, 'expected a suggested price')
  assert.ok(r.suggestedPrice.price > 300 && r.suggestedPrice.price < 500)
  // The target is relative: 75% of what the listing can reach at the top of the price grid, never under 25%.
  assert.ok(Math.abs(r.targetProbability - Math.max(SUGGESTED_PRICE_FLOOR, SUGGESTED_PRICE_SHARE_OF_MAX * r.maxProbability)) < 1e-12)
  assert.ok(r.suggestedPrice.probability >= r.targetProbability)
  assert.ok(r.probability < r.targetProbability)
  assert.ok(['unrealistic', 'ambitious'].includes(r.ambition))

  const easy = analyzeOffer({ ...base, targetPrice: '95' }, SUNDAY_AFTERNOON)
  assert.equal(easy.suggestedPrice, null)
  assert.equal(easy.ambition, null)
  assert.ok(easy.probability >= easy.targetProbability)
})

test('inactive sellers: send soon, read probability halves the headline', () => {
  const r = analyzeOffer({ ...base, category: 'collectible', listingAge: 'over_month', sellerProfile: 'inactive' }, SUNDAY_AFTERNOON)
  assert.equal(r.components.pRead, 0.5)
  assert.ok(Math.abs(r.probability - r.components.pAccept * r.components.pAvailable * 0.5) < 1e-9)
  assert.ok(r.optimal.daysWaited <= 1)
  assert.ok(r.tips.some((t) => t.includes('messaggio')))
})

test('a "prezzo non trattabile" listing raises the block risk', () => {
  const fixed = analyzeOffer({ ...base, targetPrice: '70', listingSignal: 'fixed_price' }, SUNDAY_AFTERNOON)
  const open = analyzeOffer({ ...base, targetPrice: '70', listingSignal: 'open_to_offers' }, SUNDAY_AFTERNOON)
  assert.ok(fixed.probability < open.probability)
  assert.ok(fixed.blockRisk.score > open.blockRisk.score)
  assert.ok(fixed.blockRisk.reasons.some((x) => x.includes('non trattabile')))
})

test('Italian date formatting without Intl', () => {
  const d = new Date(2026, 9, 29, 21, 45)
  assert.equal(formatLongDate(d), 'giovedì 29 ottobre')
  assert.equal(formatLongDate(new Date(2027, 0, 3), d), 'domenica 3 gennaio 2027')
  assert.equal(formatTime(d), '21:45')
  assert.equal(formatRelativeDay(d, new Date(2026, 9, 29, 8, 0)), 'oggi')
  assert.equal(formatRelativeDay(d, new Date(2026, 9, 28, 23, 59)), 'domani')
  assert.equal(formatRelativeDay(d, new Date(2026, 9, 24, 8, 0)), 'tra 5 giorni')
  assert.equal(formatDayList([1, 2, 3, 4, 5]), 'lun–ven')
  assert.equal(formatDayList([0, 6]), 'sab e dom')
  assert.equal(formatDayList([0, 1, 2, 3, 4, 5, 6]), 'tutti i giorni')
  assert.equal(formatDayList([0]), 'dom')
  assert.equal(articleFor(8), "dell'")
  assert.equal(articleFor(11), "dell'")
  assert.equal(articleFor(25), 'del ')
})

test('calendar helpers: Easter, holidays, Rome offset', () => {
  assert.equal(easterSunday(2027).getMonth(), 2)
  assert.equal(easterSunday(2027).getDate(), 28)
  assert.equal(isItalianHoliday(new Date(2027, 0, 1)), true)
  assert.equal(isItalianHoliday(new Date(2027, 2, 29)), true) // Easter Monday
  assert.equal(isItalianHoliday(new Date(2026, 9, 7)), false)
  assert.equal(romeOffsetMinutes(new Date(Date.UTC(2026, 6, 1))), 120)
  assert.equal(romeOffsetMinutes(new Date(Date.UTC(2026, 11, 1))), 60)
  assert.equal(romeOffsetMinutes(new Date(Date.UTC(2026, 9, 25, 0, 30))), 120)
  assert.equal(romeOffsetMinutes(new Date(Date.UTC(2026, 9, 25, 1, 30))), 60)
})

test('messages include the price in Italian format and the item title', () => {
  const msgs = buildMessages({ itemTitle: 'Giacca', targetPrice: 12.5, listingAge: { id: 'unknown' }, sendAt: new Date(2026, 9, 4, 21, 45) })
  assert.equal(msgs.length, 4)
  assert.ok(msgs.every((m) => m.text.includes('12,50 €')))
  assert.ok(msgs.every((m) => m.text.includes('"Giacca"')))
  assert.ok(msgs.every((m) => /^Ciao!/.test(m.text)))
  assert.ok(msgs.find((m) => m.tone === 'impegno').text.includes('. Se accetti'))
  assert.equal(formatEuro(45), '45 €')
})

test('exact 15% / 30% / 40% offers on decimal prices land in the right band (no float drift)', () => {
  assert.equal(computeDiscountPct(8, 5.6), 30)
  assert.equal(riskBandFor(computeDiscountPct(8, 5.6)).id, 'medium')
  assert.equal(riskBandFor(computeDiscountPct(7, 5.95)).id, 'medium')
  const r = analyzeOffer({ ...base, listPrice: '55,50', targetPrice: '33,30' }, SUNDAY_AFTERNOON)
  assert.equal(r.kind, 'analysis')
})

test('prices typed the Italian way are parsed, garbage is rejected', () => {
  assert.equal(parsePrice('12,50'), 12.5)
  assert.equal(parsePrice('1.200'), 1200)
  assert.equal(parsePrice('1.200,50'), 1200.5)
  assert.equal(parsePrice('45 €'), 45)
  assert.equal(parsePrice('1.5'), 1.5)
  assert.ok(Number.isNaN(parsePrice('0x50')))
  assert.ok(Number.isNaN(parsePrice('abc')))
  assert.ok(Number.isNaN(parsePrice('')))
})

test('"Adesso?" is never a yes inside an unfavourable window', () => {
  const inputs = [
    { ...base, targetPrice: '85', sellerProfile: 'inactive' },
    { ...base, category: 'kids', listPrice: '10', targetPrice: '8' },
    { ...base, category: 'collectible', targetPrice: '80', listingAge: 'over_month', sellerProfile: 'inactive', listingSignal: 'fixed_price' },
    { ...base, targetPrice: '97', listingAge: 'over_month' },
  ]
  for (const now of [WEDNESDAY_LUNCH, new Date(2026, 9, 5, 2, 0), new Date(2026, 9, 7, 15, 0), new Date(2026, 9, 26, 13, 0)]) {
    for (const raw of inputs) {
      const r = analyzeOffer(raw, now)
      assert.equal(r.nowInAvoid, true)
      assert.equal(r.sendNow.ok, false, `${JSON.stringify(raw)} @ ${now}`)
      assert.equal(r.sendNow.reason, 'avoid_window')
      assert.ok(r.sendNow.windowEndsAt.getTime() > now.getTime())
    }
  }
})

test('"now" is not recommended in the last minutes of a negative window', () => {
  const r = analyzeOffer({ ...base, targetPrice: '97' }, new Date(2026, 9, 24, 6, 55)) // Saturday, night window until 07:00
  assert.notEqual(r.optimal.kind, 'now')
})

test('quick alternative is never the "now" slot nor on the recommended day; alternatives never repeat shown slots', () => {
  const cases = [
    [{ ...base, category: 'collectible', targetPrice: '85', listingAge: 'today', listingSignal: 'fixed_price' }, new Date(2026, 9, 1, 21, 40)],
    [{ ...base, category: 'collectible', targetPrice: '85', listingAge: 'today', listingSignal: 'fixed_price' }, new Date(2026, 9, 24, 0, 30)],
    [{ ...base, category: 'fast_fashion', listPrice: '40', targetPrice: '26', listingAge: 'today' }, SUNDAY_AFTERNOON],
    [{ ...base, category: 'luxury', targetPrice: '92', listingAge: 'today', listingSignal: 'fixed_price' }, new Date(2026, 9, 1, 0, 30)],
  ]
  for (const [raw, now] of cases) {
    const r = analyzeOffer(raw, now)
    if (r.quick) {
      assert.notEqual(r.quick.kind, 'now')
      assert.ok(r.quick.daysWaited < r.optimal.daysWaited)
    }
    const shown = [r.optimal, r.alsoGood, r.quick].filter(Boolean).map((s) => s.date.toDateString())
    for (const a of r.alternatives) assert.ok(!shown.includes(a.date.toDateString()), 'alternative repeats a shown day')
    for (let i = 1; i < r.alternatives.length; i++) assert.ok(r.alternatives[i].date > r.alternatives[i - 1].date, 'alternatives are chronological')
  }
})

test('weekday "fasce da evitare" lead with the lunch break', () => {
  const r = analyzeOffer({ ...base, targetPrice: '92' }, WEDNESDAY_LUNCH)
  const weekday = r.avoidToday.length === 6 ? r.avoidToday : analyzeOffer({ ...base, targetPrice: '92' }, new Date(2026, 9, 6, 9, 0)).avoidToday
  assert.equal(weekday[0].id, 'lunch')
})

test('inactive sellers get a suggested price relative to what they can reach (the read probability caps it), quickly', () => {
  const started = Date.now()
  const r = analyzeOffer({ ...base, category: 'luxury', listPrice: '500', targetPrice: '300', sellerProfile: 'inactive' }, SUNDAY_AFTERNOON)
  assert.ok(Date.now() - started < 400)
  assert.ok(r.suggestedPrice, 'expected a suggested price for an inactive seller')
  assert.ok(r.maxProbability <= 0.5, 'half the offers lapse unread: the ceiling is under 50%')
  assert.ok(r.suggestedPrice.probability >= r.targetProbability && r.suggestedPrice.probability <= r.maxProbability + 1e-9)
  assert.ok(r.messageBeforeOffer)
  assert.ok(r.messages.every((m) => !m.text.includes('ho inviato') && !m.text.includes('ho appena inviato')))
})

test('the "importo preciso" tip never proposes a price below the Vinted cap', () => {
  for (const raw of [
    { ...base, listPrice: '50', targetPrice: '30' },
    { ...base, category: 'electronics', listPrice: '200', targetPrice: '110' },
    { ...base, listPrice: '100', targetPrice: '60' },
  ]) {
    const r = analyzeOffer(raw, SUNDAY_AFTERNOON)
    const tip = r.tips.find((t) => t.startsWith('Un importo preciso'))
    if (tip) {
      const proposed = Number(tip.match(/esempio (\d+) €/)[1])
      assert.ok(computeDiscountPct(r.input.listPrice, proposed) <= 40, tip)
    }
  }
})

test('over-cap prices are formatted in Italian and tiny prices fall back to "buy it"', () => {
  const r = analyzeOffer({ ...base, category: 'other', listPrice: '37', targetPrice: '20' }, SUNDAY_AFTERNOON)
  assert.equal(r.kind, 'over_cap')
  assert.equal(r.cappedPrice, 22.2)
  assert.ok(r.message.includes('22,20 €'))
  assert.ok(r.capAdvice.some((a) => a.includes('22,20 €')))
  const tiny = analyzeOffer({ ...base, listPrice: '1', targetPrice: '0.5' }, SUNDAY_AFTERNOON)
  assert.equal(tiny.kind, 'no_offer_needed') // 60% of 1 € leaves a gap under 2 €: nothing worth offering
  const symbolic = analyzeOffer({ ...base, listPrice: '250', targetPrice: '249.9' }, SUNDAY_AFTERNOON)
  assert.equal(symbolic.kind, 'no_offer_needed')
  // The floor is 2 €: 1,90 € of saving is not an offer, 2 € is.
  assert.equal(analyzeOffer({ ...base, listPrice: '20', targetPrice: '18.1' }, SUNDAY_AFTERNOON).kind, 'no_offer_needed')
  assert.equal(analyzeOffer({ ...base, listPrice: '20', targetPrice: '18' }, SUNDAY_AFTERNOON).kind, 'analysis')
})

test('holiday verdicts do not talk about Sunday', () => {
  const r = analyzeOffer({ ...base, category: 'electronics', listPrice: '300', targetPrice: '200', listingAge: 'weeks_1_2', sellerProfile: 'expert' }, new Date(2026, 11, 24, 21, 10))
  if (r.verdict.isHoliday && r.optimal.date.getDay() !== 0) {
    assert.ok(!r.optimal.score.timeWindow.label.toLowerCase().includes('domenica'))
    assert.ok(!r.reasons.some((s) => s.includes('prima del lunedì')))
  }
})

test('plural helpers and articles', () => {
  assert.equal(formatPoints(1), '+1 punto')
  assert.equal(formatPoints(-1), '−1 punto')
  assert.equal(formatPoints(-5), '−5 punti')
  assert.equal(articleFor(0), 'dello ')
})

test('optimizer: goal steps, reachable options and applying an option raises the probability', () => {
  // Relative goals: +10 points, capped at what the listing can reach (0,95 when the ceiling is unknown).
  assert.equal(nextGoalFor(0.63), 0.73)
  assert.equal(nextGoalFor(0.63, 0.7), 0.7)
  assert.equal(nextGoalFor(0.92), 0.95)
  assert.equal(nextGoalFor(0.5, 0.4), 0.5, 'never below the current probability')
  const raw = { ...base, category: 'sneakers', listPrice: '100', targetPrice: '70', listingAge: 'weeks_1_2' }
  const before = analyzeOffer(raw, WEDNESDAY_LUNCH)
  const plan = optimizeOffer(raw, WEDNESDAY_LUNCH, { targetProbability: 0.7 })
  assert.equal(plan.ok, true)
  assert.equal(plan.target, 0.7)
  assert.ok(plan.maxAchievable.probability >= plan.current.probability)
  assert.ok(Math.abs(plan.current.probability - before.probability) < 1e-9)
  for (const o of plan.options) {
    assert.ok(o.probability >= 0.7, o.id)
    assert.ok(o.price >= 70 && o.price < 100)
    assert.ok(o.apply.targetPrice === o.price)
    const applied = analyzeOffer({ ...raw, targetPrice: String(o.price) }, WEDNESDAY_LUNCH, { preferredSendAt: o.apply.preferredSendAt })
    assert.ok(applied.pinned || applied.optimal.date.getTime() === new Date(o.apply.preferredSendAt).getTime(), 'slot pinned')
    assert.ok(Math.abs(applied.probability - o.probability) < 0.011, `${o.id}: ${applied.probability} vs ${o.probability}`)
  }
  if (plan.recommended) assert.ok(plan.recommended.priceIncrease <= plan.options[plan.options.length - 1].priceIncrease)
})

test('optimizer: unreachable goals report the ceiling, over-cap inputs are optimised from the capped price', () => {
  const plan = optimizeOffer({ ...base, category: 'luxury', listPrice: '500', targetPrice: '300', sellerProfile: 'expert' }, SUNDAY_AFTERNOON, { targetProbability: 0.99 })
  assert.equal(plan.reachable, false)
  assert.ok(plan.maxAchievable.probability < 0.99)
  assert.ok(plan.maxAchievable.slot.date instanceof Date)
  const capped = optimizeOffer({ ...base, category: 'electronics', listPrice: '200', targetPrice: '110' }, SUNDAY_AFTERNOON, { targetProbability: 0.5 })
  assert.equal(capped.capped, true)
  assert.equal(capped.current.price, 120)
})

const FIXTURE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'vinted-item-sample.html'), 'utf8')

test('extractor: a real Vinted item page yields title, price, brand, upload age and seller activity', () => {
  const ex = parseVintedItemHtml(FIXTURE)
  assert.ok(ex.title && ex.title.includes('Abitino'))
  assert.equal(ex.listPrice, 8.9)
  assert.equal(ex.currency, 'EUR')
  assert.equal(ex.brand, 'H&M')
  assert.equal(ex.condition, 'usato')
  assert.ok(ex.categoryText.startsWith('Donna'))
  assert.equal(ex.uploadedText, 'un minuto fa')
  assert.ok(ex.uploadedDays !== null && ex.uploadedDays < 0.01)
  assert.equal(ex.sellerUsername, 'venditore_demo')
  assert.equal(ex.sellerRating, 5)
  assert.equal(ex.sellerFeedbackCount, 1626)
  assert.equal(ex.sellerBusiness, false)
  assert.deepEqual(ex.sellerBadges, ['ACTIVE_LISTER', 'SPEEDY_SHIPPING'])
  assert.ok(ex.sellerLastSeenText.includes('26 min'))
  assert.ok(ex.sellerLastSeenDays < 0.05)
  assert.ok(ex.found.includes('prezzo') && ex.found.includes('data di caricamento'))
})

const fixture = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8')

test('extractor: the October 2026 page (Next.js, streamed sections) still yields every field; an empty brand is null', () => {
  const ex = parseVintedItemHtml(fixture('vinted-item-2026-10.html'))
  assert.equal(ex.title, 'Charles Burns, Black Hole')
  assert.equal(ex.listPrice, 22)
  assert.equal(ex.currency, 'EUR')
  assert.equal(ex.brand, null, 'JSON-LD brand {"@type":"Brand","name":""} must not become "[object Object]"')
  assert.equal(ex.condition, 'usato')
  assert.ok(ex.categoryText.startsWith('Libri e media'))
  assert.equal(ex.uploadedText, '3 settimane fa')
  assert.equal(ex.uploadedDays, 21)
  assert.equal(ex.sellerUsername, 'venditore_test')
  assert.equal(ex.sellerRating, 4.9)
  assert.equal(ex.sellerFeedbackCount, 144)
  assert.equal(ex.sellerBusiness, false)
  assert.deepEqual(ex.sellerBadges, ['ACTIVE_LISTER'])
  assert.ok(ex.sellerLastSeenText.includes('14 ore'))
  assert.deepEqual(ex.missing, ['marca'])
  assert.equal(ex.photo, 'https://images1.vinted.net/t/sample.webp', 'the listing photo comes from JSON-LD or og:image')
  const built = buildFormFromExtraction(ex, { link: 'https://www.vinted.it/items/9964852697-charles-burns-black-hole' })
  assert.equal(built.form.listPrice, '22')
  assert.ok(!JSON.stringify(built).includes('[object Object]'))
})

test('extractor: brand as a plain string, a named Brand object or missing', () => {
  const page = (brand) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Felpa', ...(brand === undefined ? {} : { brand }), offers: { price: 10, priceCurrency: 'EUR' } })}</script>`
  assert.equal(parseVintedItemHtml(page('Nike')).brand, 'Nike')
  assert.equal(parseVintedItemHtml(page({ '@type': 'Brand', name: 'Levi&#39;s' })).brand, "Levi's")
  assert.equal(parseVintedItemHtml(page({ '@type': 'Brand', name: '  ' })).brand, null)
  assert.equal(parseVintedItemHtml(page({ '@type': 'Brand' })).brand, null)
  assert.equal(parseVintedItemHtml(page(undefined)).brand, null)
})

test('extractor: Cloudflare and DataDome challenge pages are recognised, real pages never are', () => {
  const cf = fixture('vinted-cloudflare-challenge.html')
  assert.equal(detectVintedChallenge(cf), 'cloudflare')
  const ex = parseVintedItemHtml(cf)
  assert.equal(ex.title, null)
  assert.equal(ex.listPrice, null)
  assert.equal(detectVintedChallenge('<html><head><title>Just a moment...</title></head><body></body></html>'), 'cloudflare')
  assert.equal(detectVintedChallenge('<html><body><script>var dd={\'rt\':\'c\',\'host\':\'geo.captcha-delivery.com\'}</script></body></html>'), 'datadome')
  // Real pages load DataDome's and Cloudflare's scripts too: the listing data wins.
  assert.equal(detectVintedChallenge(fixture('vinted-item-2026-10.html')), null)
  assert.equal(detectVintedChallenge(FIXTURE), null)
  assert.equal(detectVintedChallenge(fixture('vinted-item-2026-10.html') + '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><script>datadome captcha</script>'), null)
  // Every Vinted page (a 404 too) loads Cloudflare's bot snippet from /cdn-cgi/challenge-platform/scripts/jsd/.
  const jsd = '<script>(function(){var b=document.createElement("iframe");b.style.display="none";document.body.appendChild(b);var a=b.contentDocument.createElement("script");a.src="/cdn-cgi/challenge-platform/scripts/jsd/main.js";b.contentDocument.head.appendChild(a)})()</script>'
  assert.equal(detectVintedChallenge(`<html><head><title>Pagina non trovata | Vinted</title></head><body>404${jsd}</body></html>`), null)
  assert.equal(detectVintedChallenge(`<html><body><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=1"></script></body></html>`), 'cloudflare')
  assert.equal(detectVintedChallenge(''), null)
  assert.equal(detectVintedChallenge('<html><body>Pagina non trovata</body></html>'), null)
})

test('extractor: relative Italian times', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`)
  near(parseRelativeItalian('Ultima visita 26 min fa') * 1440, 26)
  near(parseRelativeItalian("un'ora fa") * 24, 1)
  near(parseRelativeItalian('2 ore fa') * 24, 2)
  assert.equal(parseRelativeItalian('ieri'), 1)
  assert.equal(parseRelativeItalian('3 giorni fa'), 3)
  assert.equal(parseRelativeItalian('una settimana fa'), 7)
  assert.equal(parseRelativeItalian('2 settimane fa'), 14)
  assert.equal(parseRelativeItalian('un mese fa'), 30)
  assert.equal(parseRelativeItalian('3 mesi fa'), 90)
  assert.equal(parseRelativeItalian('un anno fa'), 365)
  assert.equal(parseRelativeItalian('boh'), null)
})

test('extractor: mapping onto the form, with a default −20% target', () => {
  const ex = parseVintedItemHtml(FIXTURE)
  const { form, summary } = buildFormFromExtraction(ex, { link: 'https://www.vinted.it/items/10255420870', previousForm: { listingSignal: 'none' } })
  assert.equal(form.category, 'fast_fashion')
  assert.equal(form.listingAge, 'today')
  assert.equal(form.listPrice, '8,9')
  assert.equal(form.targetPrice, '7')
  assert.equal(form.listingSignal, 'none')
  assert.equal(form.sellerProfile, 'expert')
  assert.ok(!/[🎀]/u.test(form.itemTitle) && form.itemTitle.startsWith('Strepitoso Abitino'), form.itemTitle)
  assert.equal(cleanTitle('🎀Strepitoso🎀 Abitino cut out velour nero elasticizzato ed avvolgente H&M divided tg. XS', 40), 'Strepitoso Abitino cut out velour nero')
  assert.equal(cleanTitle('  Giacca   Zara  '), 'Giacca Zara')
  assert.ok(summary.found.some((f) => f.includes('1626 recensioni') && f.includes('spedisce in fretta')))
  assert.ok(summary.found.length >= 3)
  assert.ok(summary.guessed.some((g) => g.startsWith('Categoria')))
  // 8,90 € → 7 € saves 1,90 €: under the 2 € floor an offer is not worth the exchange (engine-spec §2.1).
  const r = analyzeOffer(form, SUNDAY_AFTERNOON)
  assert.equal(r.kind, 'no_offer_needed')
  assert.ok(r.message.includes('spedizione'))
  assert.equal(analyzeOffer({ ...form, targetPrice: '6,5' }, SUNDAY_AFTERNOON).kind, 'analysis')
})

test('extractor: category, seller and signal heuristics', () => {
  assert.equal(categoryGuess({ categoryText: 'Bambini Scarpe', brand: 'Nike' }).id, 'kids')
  assert.equal(categoryGuess({ categoryText: 'Donna Borse', brand: 'Gucci', listPrice: 450 }).id, 'luxury')
  assert.equal(categoryGuess({ categoryText: 'Uomo Scarpe Sneakers', brand: 'Nike', title: 'Nike Air Force 1' }).id, 'sneakers')
  assert.equal(categoryGuess({ categoryText: 'Elettronica Console', brand: 'Nintendo', title: 'Nintendo Switch' }).id, 'electronics')
  assert.equal(categoryGuess({ categoryText: 'Collezionismo Carte', title: 'Carta Pokémon Charizard' }).id, 'collectible')
  assert.equal(categoryGuess({ categoryText: 'Donna Jeans', brand: 'Zara' }).id, 'fast_fashion')
  assert.equal(categoryGuess({ categoryText: 'Donna Jeans', brand: "Levi's" }).id, 'other')
  assert.equal(sellerProfileGuess({ lastSeenDays: 20 }).id, 'inactive')
  assert.equal(sellerProfileGuess({ feedbackCount: 2, rating: 5 }).id, 'new_seller')
  assert.equal(sellerProfileGuess({ feedbackCount: 120, rating: 4.9 }).id, 'expert')
  assert.equal(sellerProfileGuess({ feedbackCount: null, rating: 5, lastSeenDays: 0.1 }).id, 'unknown')
  assert.equal(listingAgeGuess(0.2), 'today')
  assert.equal(listingAgeGuess(10), 'weeks_1_2')
  assert.equal(listingAgeGuess(45), 'over_month')
  assert.equal(signalFromText('Bellissima giacca, prezzo non trattabile').id, 'fixed_price')
  assert.equal(signalFromText('Svuoto l\'armadio, vendo tutto!').id, 'clearing_out')
  assert.equal(signalFromText('Accetto offerte ragionevoli').id, 'open_to_offers')
  assert.equal(signalFromText('Giacca in ottime condizioni').id, 'none')
  assert.equal(findPriceInText('Vendo a 12,50 € spedizione esclusa'), 12.5)
  assert.equal(findPriceInText('nessun prezzo'), null)
})

/* ───────── engine 1.4.0: prior reset, read probability, honest range, relative goals ───────── */

const TYPICAL = { category: 'collectible', listPrice: '30', targetPrice: '24', listingAge: 'weeks_1_2', sellerProfile: 'unknown', listingSignal: 'none' }
const TYPICAL_NOW = new Date(2026, 9, 7, 15, 0)

test('prior reset: typical cheap item at −20% shows ≤ 40% before any learning; the price band weighs on cheap listings', () => {
  const at20 = analyzeOffer(TYPICAL, TYPICAL_NOW)
  assert.ok(at20.probability <= 0.4 && at20.probability >= 0.2, `${at20.probability}`)
  const at12 = analyzeOffer({ ...TYPICAL, targetPrice: '26.4' }, TYPICAL_NOW)
  const at30 = analyzeOffer({ ...TYPICAL, targetPrice: '21' }, TYPICAL_NOW)
  assert.ok(at12.probability > at20.probability && at20.probability > at30.probability)
  assert.ok(at12.probability <= 0.55 && at30.probability <= 0.25)
  assert.equal(POSITIVE_CAP, 0.7)

  const cheap = scoreAt(normalizeInput({ ...base, category: 'collectible', listPrice: '9', targetPrice: '7' }).input, SUNDAY_AFTERNOON, 0)
  assert.deepEqual(cheap.factors.map((f) => f.id), ['category', 'interaction', 'price_band', 'gap_eur', 'signal', 'age', 'wait', 'seller', 'time', 'month'])
  assert.ok(cheap.factors.find((f) => f.id === 'price_band').rawWeight <= -0.4, 'a 9 € listing: the discount is worth a few euros to the seller')
  assert.equal(cheap.factors.find((f) => f.id === 'gap_eur').rawWeight, 0, 'the euro gap weighs on its own only when large')
  assert.match(cheap.factors.find((f) => f.id === 'price_band').label, /^Prezzo in annuncio 9 €$/)
  const dear = scoreAt(normalizeInput({ ...base, listPrice: '500', targetPrice: '300' }).input, SUNDAY_AFTERNOON, 0)
  assert.ok(dear.factors.find((f) => f.id === 'price_band').rawWeight > 0)
  assert.ok(dear.factors.find((f) => f.id === 'gap_eur').rawWeight < 0)
  assert.equal(priceBandWeight(40), 0)
  assert.ok(analyzeOffer({ ...base, category: 'collectible', listPrice: '9', targetPrice: '7' }, SUNDAY_AFTERNOON).reasons.some((t) => t.includes('9 €')))
})

test('prior factors (engine-spec §3.2): hearts, price drop, views and seller items join the list only with signals, flagged as priors, DOM-only weights at 0', () => {
  const at = new Date(2026, 9, 7, 21, 40)
  const plain = scoreAt(normalizeInput(TYPICAL).input, at, 0)
  assert.deepEqual(plain.factors.map((f) => f.id), ['category', 'interaction', 'price_band', 'gap_eur', 'signal', 'age', 'wait', 'seller', 'time', 'month'], 'unchanged without signals')
  assert.ok(plain.factors.every((f) => !f.prior))
  const withAll = scoreAt(normalizeInput({ ...TYPICAL, signals: { favourites: 0, views: 300, sellerItems: 3, priceDrop: { from: 36, to: 30, hoursAgo: 80 } } }).input, at, 0)
  assert.deepEqual(withAll.factors.map((f) => f.id), ['category', 'interaction', 'price_band', 'gap_eur', 'signal', 'age', 'wait', 'seller', 'demand', 'reduced', 'views', 'seller_items', 'time', 'month'])
  const byId = Object.fromEntries(withAll.factors.map((f) => [f.id, f]))
  for (const id of ['demand', 'reduced', 'views', 'seller_items']) assert.equal(byId[id].prior, true, id)
  // Favourites come from the search, not the DOM: full weight. No heart → +0,1; 4–9 → −0,15; 10+ → −0,3.
  assert.equal(byId.demand.rawWeight, 0.1)
  assert.equal(byId.demand.label, 'Nessun preferito')
  assert.equal(demandWeight({ favourites: 5 }), -0.15)
  assert.equal(demandWeight({ favourites: 12 }), -0.3)
  assert.equal(demandWeight({ favourites: 2 }), 0)
  assert.equal(demandWeight({ favourites: 3 }, 1), -0.3, 'a fresh listing with 3 hearts')
  assert.equal(demandWeight({ favourites: 3 }, 10), 0)
  // DOM-only readings are logged, not weighed, until a hydrated fixture exists.
  assert.deepEqual(DOM_SIGNAL_SCALE, { interested: 0, reduced: 0, views: 0, sellerItems: 0 })
  assert.equal(byId.reduced.rawWeight, 0)
  assert.equal(byId.reduced.label, 'Prezzo ribassato da tempo')
  assert.equal(byId.views.rawWeight, 0)
  assert.equal(byId.views.label, '300 visualizzazioni')
  assert.equal(byId.seller_items.rawWeight, 0)
  assert.equal(demandWeight({ interested: 12 }), 0, 'interessati from the DOM weigh 0 for now')
  assert.equal(scoreAt(normalizeInput({ ...TYPICAL, signals: { interested: 12 } }).input, at, 0).factors.find((f) => f.id === 'demand').label, '12 interessati')
  // The designed weights are there for the one-line bump: the scale, not the design, is 0.
  assert.equal(SIGNAL_WEIGHTS.reduced.settled * 1, 0.15)
  assert.equal(SIGNAL_WEIGHTS.views.dead, 0.1)
  assert.equal(reducedWeight({ priceDrop: { hoursAgo: 10 } }), 0, 'a recent drop: designed −0,2, scaled to 0 (and never −0)')
  assert.equal(viewsWeight({ views: 10 }, 20), 0)
  assert.equal(SIGNAL_WEIGHTS.reduced.recent, -0.2)
  // The probability is unchanged by zero-weight rows, and the rows do not show up in the attribution.
  const r = analyzeOffer({ ...TYPICAL, signals: { interested: 12, views: 300, sellerItems: 3 } }, TYPICAL_NOW)
  const r0 = analyzeOffer(TYPICAL, TYPICAL_NOW)
  assert.equal(r.probability, r0.probability)
  assert.ok(!r.factors.rows.some((row) => ['views', 'seller_items', 'demand'].includes(row.id)))
})

test('read probability by seller activity: active 0,9, quiet 0,75, inactive 0,5', () => {
  const at = (sellerProfile) => analyzeOffer({ ...base, sellerProfile }, SUNDAY_AFTERNOON)
  assert.equal(at('unknown').components.pRead, 0.9)
  assert.equal(at('quiet').components.pRead, QUIET_READ_PROBABILITY)
  assert.equal(QUIET_READ_PROBABILITY, 0.75)
  assert.equal(at('inactive').components.pRead, 0.5)
  assert.ok(at('quiet').probability < at('unknown').probability && at('quiet').probability > at('inactive').probability)
  assert.equal(readProbability({ sellerProfile: 'quiet' }), 0.75)
  assert.equal(readProbability({ sellerProfile: 'expert' }), 0.9)
  assert.ok(at('quiet').reasons.some((t) => t.includes('entra di rado')) || at('quiet').optimal.score.factors.some((f) => f.label === 'Venditore poco attivo'))
})

test('predictive interval: a wide prior band without outcomes, a narrower one with a fitted profile, always around the estimate', () => {
  const r = analyzeOffer(TYPICAL, TYPICAL_NOW)
  const { low, high, n } = r.probabilityRange
  assert.equal(n, 0)
  assert.ok(low <= r.probability && r.probability <= high)
  assert.ok(high - low >= 0.4, `width ${high - low}`)
  assert.ok(low <= 0.13, `lower bound ${low} reaches the Wilson range of 1 acceptance in 12 (2–30%)`)
  // A profile fitted on 12 outcomes (the user's October): ≈ −0,66 ± 0,71 logit.
  const profile = normalizeProfile({ intercept: -0.66, cov: [[0.5, 0], [0, 0.1225]], paramKeys: ['intercept', 'dslope'], basedOn: 12 })
  const rp = analyzeOffer(TYPICAL, TYPICAL_NOW, { profile })
  assert.equal(rp.probabilityRange.n, 12)
  assert.ok(rp.probability < r.probability)
  assert.ok(rp.probabilityRange.low <= rp.probability && rp.probability <= rp.probabilityRange.high)
  assert.ok(rp.probabilityRange.high - rp.probabilityRange.low <= 0.3, `width ${rp.probabilityRange.high - rp.probabilityRange.low}`)
  assert.ok(rp.probabilityRange.low <= 0.12)
  const direct = predictiveInterval(rp, profile)
  assert.ok(Math.abs(direct.low - rp.probabilityRange.low) < 1e-12 && Math.abs(direct.high - rp.probabilityRange.high) < 1e-12)
  const wider = predictiveInterval(rp, profile, { level: 0.9 })
  assert.ok(wider.low < direct.low && wider.high > direct.high)
  // The slope term widens the band away from −20%.
  const far = predictiveInterval(analyzeOffer({ ...TYPICAL, targetPrice: '19.5' }, TYPICAL_NOW, { profile }), profile)
  assert.ok(far.sd > direct.sd)
  assert.equal(predictiveInterval(null), null)
})

test('relative goals: the suggested price and the optimiser aim at a share of what the listing can reach', () => {
  const r = analyzeOffer({ ...base, targetPrice: '70', listingAge: 'weeks_1_2' }, WEDNESDAY_LUNCH)
  assert.ok(r.ceiling && r.ceiling.price === 99 && r.ceiling.probability >= r.probability)
  assert.ok(Math.abs(r.maxProbability - Math.max(r.probability, r.ceiling.probability)) < 1e-12)
  assert.ok(Math.abs(r.targetProbability - Math.max(SUGGESTED_PRICE_FLOOR, SUGGESTED_PRICE_SHARE_OF_MAX * r.maxProbability)) < 1e-12)
  assert.ok(r.suggestedPrice && r.suggestedPrice.probability >= r.targetProbability && r.suggestedPrice.price > 70)
  const goals = goalChoicesFor(r)
  assert.deepEqual(goals.map((g) => g.id), ['plus10', 'plus20', 'max'])
  assert.ok(Math.abs(goals[0].probability - Math.round((r.probability + 0.1) * 100) / 100) < 1e-9)
  assert.equal(goals[2].probability, Math.round(r.maxProbability * 100) / 100)
  assert.match(goals[2].label, /^il massimo \(−\d+%\)$/)
  assert.ok(goals.every((g) => g.deltaPoints > 0 && g.probability > r.probability))
  // The optimiser's default goal is +10 points, capped at the ceiling.
  const plan = optimizeOffer({ ...base, targetPrice: '70', listingAge: 'weeks_1_2' }, WEDNESDAY_LUNCH)
  assert.ok(Math.abs(plan.target - Math.min(plan.maxAchievable.probability + 1e-9, r.probability + 0.1)) < 0.011 || plan.target <= r.probability + 0.1 + 1e-9)
  // Near the ceiling only the ceiling remains (or nothing); a «compra» result has no goals.
  const high = analyzeOffer({ ...base, targetPrice: '97' }, SUNDAY_AFTERNOON)
  assert.ok(goalChoicesFor(high).length <= 1)
  assert.deepEqual(goalChoicesFor({ ok: true, kind: 'no_offer_needed' }), [])
  assert.equal(maxReachable(normalizeInput({ ...base, targetPrice: '99' }).input, SUNDAY_AFTERNOON), null)
})
