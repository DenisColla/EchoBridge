import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeOffer, articleFor, buildCandidateSlots, buildMessages, computeDiscountPct, easterSunday, formatDayList,
  formatEuro, formatLongDate, formatRelativeDay, formatTime, isItalianHoliday, monthWindowAt, normalizeInput,
  riskBandFor, romeOffsetMinutes, timeWindowAt, CATEGORIES, LISTING_AGES, SELLER_PROFILES, LISTING_SIGNALS, TONES,
} from '../src/core/index.js'

// Sunday 4 October 2026, 16:00 local time.
const SUNDAY_AFTERNOON = new Date(2026, 9, 4, 16, 0)
// Wednesday 7 October 2026, 13:00 (lunch break).
const WEDNESDAY_LUNCH = new Date(2026, 9, 7, 13, 0)

const base = { category: 'sneakers', listPrice: '100', targetPrice: '80', listingAge: 'unknown', sellerProfile: 'unknown', listingSignal: 'none' }

test('enum ids match the spec', () => {
  assert.deepEqual(CATEGORIES.map((c) => c.id), ['sneakers', 'fast_fashion', 'collectible', 'electronics', 'kids', 'luxury', 'other'])
  assert.deepEqual(LISTING_AGES.map((a) => a.id), ['unknown', 'today', 'days_2_6', 'weeks_1_2', 'weeks_2_4', 'over_month'])
  assert.deepEqual(SELLER_PROFILES.map((s) => s.id), ['unknown', 'new_seller', 'expert', 'inactive'])
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
  assert.equal(monthWindowAt(new Date(2026, 9, 25)).weight, 0.2)
  assert.equal(monthWindowAt(new Date(2026, 9, 24)).id, 'month_late')
  assert.ok(monthWindowAt(new Date(2026, 9, 24)).weight > 0.15 && monthWindowAt(new Date(2026, 9, 24)).weight < 0.2)
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
  assert.ok(r.probabilityRange[0] <= r.probability && r.probability <= r.probabilityRange[1])
  assert.ok(r.optimal.date instanceof Date)
  assert.match(r.verdict.headline, /^Invia l'offerta /)
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

test('suggested price appears only when the probability is low and is above the target', () => {
  const r = analyzeOffer({ ...base, category: 'luxury', listPrice: '500', targetPrice: '300', sellerProfile: 'expert' }, SUNDAY_AFTERNOON)
  assert.ok(r.suggestedPrice, 'expected a suggested price')
  assert.ok(r.suggestedPrice.price > 300 && r.suggestedPrice.price < 500)
  assert.ok(r.suggestedPrice.probability >= 0.55)
  assert.ok(['unrealistic', 'ambitious'].includes(r.ambition))

  const easy = analyzeOffer({ ...base, targetPrice: '95' }, SUNDAY_AFTERNOON)
  assert.equal(easy.suggestedPrice, null)
  assert.equal(easy.ambition, null)
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
