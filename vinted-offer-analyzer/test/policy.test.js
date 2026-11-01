import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  POLICY_BOUNDS, POLICY_MODIFIERS, TARGET_TABLE, policyAgeTierOf, policyBandOf, policyDiscountFor, policyFitsListing, precisePriceFor, quickDiscountsFor,
} from '../src/core/policy.js'
import { LISTING_AGES } from '../src/core/constants.js'

/**
 * The user's 13 real items (backup of 31 October 2026, one month of use), reduced to what the policy reads. Titles and
 * links are left out on purpose. When the original backup is on this machine the fixture is cross-checked against it.
 */
const REAL_ITEMS = [
  { id: 'mvrxvcvq-bjwhuc', category: 'collectible', listPrice: 20, targetPrice: 17, status: 'bought', listingAge: 'weeks_1_2', sellerProfile: 'expert', listingSignal: 'none' },
  { id: 'mvcg7bcy-0e9wd5', category: 'collectible', listPrice: 22, targetPrice: 18, status: 'sent', listingAge: 'today', sellerProfile: 'expert', listingSignal: 'none' },
  { id: 'mv7rtjwb-q657l7', category: 'electronics', listPrice: 419, targetPrice: 335, status: 'accepted', listingAge: 'today', sellerProfile: 'new_seller', listingSignal: 'clearing_out' },
  { id: 'mv6qf10m-wait9i', category: 'electronics', listPrice: 469, targetPrice: 375, status: 'declined', listingAge: 'today', sellerProfile: 'new_seller', listingSignal: 'none', counter: 440 },
  { id: 'mv3ykahv-9z2ed5', category: 'collectible', listPrice: 30, targetPrice: 24, status: 'declined', listingAge: 'over_month', sellerProfile: 'unknown', listingSignal: 'none' },
  { id: 'mv2z0dek-jkdnn4', category: 'electronics', listPrice: 500, targetPrice: 380, status: 'declined', listingAge: 'weeks_1_2', sellerProfile: 'new_seller', listingSignal: 'none' },
  { id: 'mv2u23nu-0smmox', category: 'collectible', listPrice: 9, targetPrice: 7, status: 'declined', listingAge: 'weeks_1_2', sellerProfile: 'unknown', listingSignal: 'none' },
  { id: 'muzawkea-9wzs6w', category: 'collectible', listPrice: 30, targetPrice: 22, status: 'declined', listingAge: 'over_month', sellerProfile: 'unknown', listingSignal: 'none' },
  { id: 'muz6t93o-aej1y7', category: 'other', listPrice: 15, targetPrice: 10, status: 'declined', listingAge: 'days_2_6', sellerProfile: 'new_seller', listingSignal: 'none' },
  { id: 'muvfbizr-gsecaj', category: 'other', listPrice: 27, targetPrice: 18, status: 'declined', listingAge: 'unknown', sellerProfile: 'unknown', listingSignal: 'none', counter: 24 },
  { id: 'muvcbux2-7mka1b', category: 'other', listPrice: 13.5, targetPrice: 8.5, status: 'declined', listingAge: 'unknown', sellerProfile: 'unknown', listingSignal: 'none', counter: 12 },
  { id: 'muv0wxmg-txv3i2', category: 'other', listPrice: 35, targetPrice: 23, status: 'declined', listingAge: 'unknown', sellerProfile: 'unknown', listingSignal: 'none' },
  { id: 'mv2ywtq7-7txbsu', category: 'electronics', listPrice: 500, targetPrice: 355, status: 'sold_other', listingAge: 'weeks_2_4', sellerProfile: 'unknown', listingSignal: 'none' },
]
const BACKUP_PATH = new URL('./fixtures/backup-2026-10.json', import.meta.url)

const policyOf = (item, extra = {}) => policyDiscountFor({ listPrice: item.listPrice, listingAge: item.listingAge, category: item.category, sellerProfile: item.sellerProfile, listingSignal: item.listingSignal, ...extra })
const market = (p25, median, p75) => ({ n: 4, p25Price: p25, medianPrice: median, p75Price: p75 })

test('policy: price bands and age tiers follow the table boundaries, unknown age is the middle tier', () => {
  assert.equal(policyBandOf(11.99).id, 'under_12')
  assert.equal(policyBandOf(12).id, 'from_12_to_20')
  assert.equal(policyBandOf('19,99').id, 'from_12_to_20')
  assert.equal(policyBandOf(20).id, 'from_20_to_40')
  assert.equal(policyBandOf(40).id, 'from_40_to_100')
  assert.equal(policyBandOf(100).id, 'over_100')
  assert.equal(policyBandOf(0), null)
  assert.equal(policyBandOf('abc'), null)
  assert.deepEqual([policyAgeTierOf(0).id, policyAgeTierOf(6.9).id, policyAgeTierOf(7).id, policyAgeTierOf(30).id, policyAgeTierOf(30.1).id], ['fresh', 'fresh', 'mid', 'mid', 'old'])
  assert.equal(policyAgeTierOf(null).id, 'mid')
  assert.equal(policyAgeTierOf(null).known, false)
  assert.equal(policyAgeTierOf(10).known, true)
  // Table cells as the spec writes them.
  assert.deepEqual(TARGET_TABLE.under_12, { fresh: null, mid: null, old: 10 })
  assert.deepEqual(TARGET_TABLE.from_12_to_20, { fresh: null, mid: 10, old: 15 })
  assert.deepEqual(TARGET_TABLE.from_20_to_40, { fresh: 8, mid: 12, old: 18 })
  assert.deepEqual(TARGET_TABLE.from_40_to_100, { fresh: 10, mid: 15, old: 20 })
  assert.deepEqual(TARGET_TABLE.over_100, { fresh: 10, mid: 15, old: 20 })
})

test('policy: the twelve tabular cases of the spec', () => {
  // 1. 9 € → no offer (cheap and not old).
  const cheap = policyDiscountFor({ listPrice: 9, ageDays: 10 })
  assert.equal(cheap.kind, 'no_offer')
  assert.equal(cheap.noOffer, true)
  assert.equal(cheap.discountPct, null)
  assert.equal(cheap.targetPrice, null)
  assert.equal(cheap.alternative, 'buy')
  assert.match(cheap.reason[0], /sotto 12 €/)
  // 2. 28 € / 10 d / new seller → 12 + 2 = 14% → 24 €.
  const comic = policyDiscountFor({ listPrice: 28, ageDays: 10, sellerProfile: 'new_seller' })
  assert.equal(comic.kind, 'offer')
  assert.equal(comic.discountPct, 14)
  assert.equal(comic.targetPrice, 24)
  assert.equal(comic.band, 'from_20_to_40')
  assert.equal(comic.ageTier, 'mid')
  assert.equal(comic.table, 12)
  assert.deepEqual(comic.modifiers, [{ id: 'new_seller', pts: 2, label: 'venditore nuovo' }])
  assert.equal(comic.summary, '−14%: fascia 20–40 €, 10 giorni, venditore nuovo +2')
  // 3. 500 € / 25 d → 15% → 425 is a multiple of 5, so 424; with an expert seller −3 → 12% → 440 → 439.
  assert.equal(policyDiscountFor({ listPrice: 500, ageDays: 25 }).discountPct, 15)
  assert.equal(policyDiscountFor({ listPrice: 500, ageDays: 25 }).targetPrice, 424)
  assert.equal(policyDiscountFor({ listPrice: 500, ageDays: 25, sellerProfile: 'expert' }).targetPrice, 439)
  // 4. At or under the market's cheapest quarter → no offer, buy now.
  const under = policyDiscountFor({ listPrice: 50, ageDays: 10, market: market(55, 70, 80) })
  assert.equal(under.kind, 'no_offer')
  assert.equal(under.alternative, 'buy_now')
  assert.match(under.reason[0], /prezzo tipico 70 €/)
  // 5. clearing_out +5, open_to_offers +3.
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 10, listingSignal: 'clearing_out' }).discountPct, 20)
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 10, listingSignal: 'open_to_offers' }).discountPct, 18)
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 10, listingSignal: 'fixed_price' }).discountPct, 15, 'a fixed price is the gate\'s business, not a points modifier')
  // 6. expert −3, new_seller +2.
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 10, sellerProfile: 'expert' }).discountPct, 12)
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 10, sellerProfile: 'new_seller' }).discountPct, 17)
  // 7. business → never above 10.
  const business = policyDiscountFor({ listPrice: 60, ageDays: 40, sellerBusiness: true, listingSignal: 'clearing_out' })
  assert.equal(business.discountPct, 10)
  assert.deepEqual(business.caps.map((c) => c.id), ['business'])
  assert.ok(business.reason.some((r) => /non oltre il 10%/.test(r)))
  // 8. price dropped → cap 10; dropped under 48 h → cap 8 (both on the new price).
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 40, signals: { priceDropped: true } }).discountPct, 10)
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 40, signals: { priceDrop: { from: 70, to: 60, hoursAgo: 10 } } }).discountPct, 8)
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 40, signals: { priceDropped: true, priceDropHoursAgo: 72 } }).discountPct, 10)
  // 9. Market: listed at or above the 75th percentile → +5.
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 10, market: market(30, 40, 55) }).discountPct, 20)
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 10, market: market(30, 40, 65) }).discountPct, 15, 'between p25 and p75: no market modifier')
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 10, market: { n: 1, p25Price: 30, p75Price: 55 } }).discountPct, 15, 'one row is not a market')
  // 10. Categories.
  assert.equal(policyDiscountFor({ listPrice: 400, ageDays: 40, category: 'luxury' }).discountPct, 17)
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 10, category: 'collectible' }).discountPct, 12)
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 10, category: 'fast_fashion' }).discountPct, 18)
  assert.equal(policyDiscountFor({ listPrice: 15, ageDays: 40, category: { id: 'kids' } }).discountPct, 18)
  // 11. Learned shift, clamped to ±6, reported.
  const up = policyDiscountFor({ listPrice: 60, ageDays: 10, profile: { discountShift: 9 } })
  assert.equal(up.discountPct, 21)
  assert.equal(up.shift, 6)
  assert.ok(up.reason.some((r) => /Dai tuoi esiti: \+6 punti/.test(r)))
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 10, profile: { discountShift: -9 } }).discountPct, 9)
  assert.equal(policyDiscountFor({ listPrice: 60, ageDays: 10, profile: { discountShift: 'x' } }).shift, 0)
  // 12. Bounds [5, 25] and the 60% / market floor.
  assert.equal(policyDiscountFor({ listPrice: 22, ageDays: 0, category: 'collectible', sellerProfile: 'expert' }).discountPct, POLICY_BOUNDS.MIN_PCT)
  const deep = policyDiscountFor({ listPrice: 60, ageDays: 40, listingSignal: 'clearing_out', category: 'kids', profile: { discountShift: 6 } })
  assert.equal(deep.discountPct, POLICY_BOUNDS.MAX_PCT)
  assert.ok(deep.targetPrice >= 0.6 * 60)
  const floored = policyDiscountFor({ listPrice: 60, ageDays: 40, listingSignal: 'clearing_out', market: market(58, 70, 90) })
  assert.ok(floored.targetPrice >= 0.95 * 58 - 1e-9, `${floored.targetPrice} under the market floor`)
  assert.ok(floored.reason.some((r) => /Mai sotto/.test(r)))
})

test('policy: inputs come as numbers, form strings, LISTING_AGES ids or objects; no price → null', () => {
  assert.equal(policyDiscountFor({ listPrice: '13,5', listingAge: 'unknown' }).targetPrice, 11.5)
  assert.equal(policyDiscountFor({ listPrice: 27, listingAge: LISTING_AGES.find((a) => a.id === 'weeks_1_2') }).ageDays, 10)
  assert.equal(policyDiscountFor({ listPrice: 27, listingAge: 'over_month' }).ageTier, 'old')
  assert.equal(policyDiscountFor({ listPrice: 27, listingAge: 'unknown' }).ageDays, null)
  assert.equal(policyDiscountFor({ listPrice: 27, ageDays: 3, listingAge: 'over_month' }).ageTier, 'fresh', 'explicit days win over the id')
  assert.equal(policyDiscountFor({ listPrice: '' }), null)
  assert.equal(policyDiscountFor({ listPrice: 0 }), null)
  assert.equal(policyDiscountFor({}), null)
  assert.equal(policyDiscountFor({ listPrice: 27, listingSignal: { id: 'clearing_out' } }).discountPct, 17)
  for (const p of [policyDiscountFor({ listPrice: 27 }), policyDiscountFor({ listPrice: 9 })]) {
    assert.ok(Array.isArray(p.reason) && p.reason.every((r) => typeof r === 'string' && r.length > 10))
    assert.equal(p.source, 'policy')
    assert.ok(!JSON.stringify(p).includes('[object Object]'))
    assert.ok(JSON.parse(JSON.stringify(p)), 'plain object, JSON round-trips')
  }
})

test('policy: precise prices (0,50 steps under 20 €, no multiples of 5 above), floors and the list price', () => {
  assert.equal(precisePriceFor(24.08, 28), 24)
  assert.equal(precisePriceFor(24.6, 28), 24, '25 is a multiple of 5: the nearer of 24 and 26')
  assert.equal(precisePriceFor(25.5, 30), 26)
  assert.equal(precisePriceFor(425, 500), 424, 'ties go to the lower number')
  assert.equal(precisePriceFor(12.15, 13.5), 12)
  assert.equal(precisePriceFor(12.3, 15), 12.5)
  assert.equal(precisePriceFor(7.6, 10), 7.5)
  assert.equal(precisePriceFor(19.95, 21, { max: 21 }), 19)
  assert.equal(precisePriceFor(20.9, 22, { max: 22 }), 21)
  assert.equal(precisePriceFor(21.6, 22, { max: 22 }), 21, 'never at or above the list price')
  assert.equal(precisePriceFor(33, 60, { min: 36 }), 36)
  assert.equal(precisePriceFor(33, 60, { min: 35 }), 36, 'the floor itself is a multiple of 5: the next integer')
  assert.equal(precisePriceFor(8.1, 15, { min: 9 }), 9)
  assert.equal(precisePriceFor(NaN, 28), null)
  assert.equal(precisePriceFor(10, 0), null)
})

test('policy: quick chips sit around the policy default, legacy chips without one', () => {
  assert.deepEqual(quickDiscountsFor({ discountPct: 14 }), [10, 14, 18, 22])
  assert.deepEqual(quickDiscountsFor({ discountPct: 5 }), [5, 9, 13])
  assert.deepEqual(quickDiscountsFor({ discountPct: 25 }), [21, 25, 29, 33])
  assert.deepEqual(quickDiscountsFor({ kind: 'no_offer', discountPct: null, band: 'under_12' }), [6, 10, 14, 18])
  assert.deepEqual(quickDiscountsFor({ kind: 'no_offer', discountPct: null, band: 'from_12_to_20' }), [6, 10, 14, 18])
  assert.deepEqual(quickDiscountsFor(null), POLICY_BOUNDS.QUICK_DEFAULT)
  assert.deepEqual(quickDiscountsFor(undefined), [10, 15, 20, 25, 30])
  assert.ok(quickDiscountsFor({ discountPct: 14 }).includes(14), 'd₀ is one of the chips (the one to highlight)')
})

test('policy: retro table on the user\'s 13 real items (two «no offer», comics 5–15%, tablets 12–17%, counters anchored)', () => {
  const days = (id) => (id === 'unknown' ? null : LISTING_AGES.find((a) => a.id === id).days)
  const tierOf = (d) => (d === null ? 'mid' : d < 7 ? 'fresh' : d <= 30 ? 'mid' : 'old')
  const bandOf = (L) => (L < 12 ? 'under_12' : L < 20 ? 'from_12_to_20' : L < 40 ? 'from_20_to_40' : L < 100 ? 'from_40_to_100' : 'over_100')
  const byId = Object.fromEntries(REAL_ITEMS.map((it) => [it.id, policyOf(it)]))
  for (const it of REAL_ITEMS) {
    const p = byId[it.id]
    const cell = TARGET_TABLE[bandOf(it.listPrice)][tierOf(days(it.listingAge))]
    if (cell === null) {
      assert.equal(p.kind, 'no_offer', it.id)
      continue
    }
    // Recomputed by hand: table + signal + seller + category, bounded.
    const mods = (POLICY_MODIFIERS[it.listingSignal] || 0) + (POLICY_MODIFIERS[it.sellerProfile] || 0) + (POLICY_MODIFIERS[it.category] || 0)
    const expected = Math.min(25, Math.max(5, cell + mods))
    assert.equal(p.kind, 'offer', it.id)
    assert.equal(p.discountPct, expected, `${it.id}: ${it.listPrice} €`)
    assert.ok(p.targetPrice < it.listPrice && p.targetPrice >= 0.6 * it.listPrice, `${it.id}: ${p.targetPrice}`)
    assert.ok(p.discountPct < (it.listPrice - it.targetPrice) / it.listPrice * 100 + 1e-9 || it.listPrice >= 400, `${it.id}: the policy never asks more than the user did on cheap items`)
  }
  // The two items the spec calls «no offer»: 9 € (1–2 weeks) and 15 € (fresh).
  assert.equal(byId['mv2u23nu-0smmox'].kind, 'no_offer')
  assert.equal(byId['muz6t93o-aej1y7'].kind, 'no_offer')
  // Comics (20–35 €): 5–15% instead of the 15–37% the user asked; tablets (419–500 €): 12–17% instead of 20–29%.
  const comics = REAL_ITEMS.filter((it) => it.listPrice >= 20 && it.listPrice < 40).map((it) => byId[it.id].discountPct)
  assert.ok(comics.every((d) => d >= 5 && d <= 15), JSON.stringify(comics))
  const tablets = REAL_ITEMS.filter((it) => it.listPrice >= 400).map((it) => byId[it.id].discountPct)
  assert.ok(tablets.every((d) => d >= 12 && d <= 17), JSON.stringify(tablets))
  // Anchors of the counter accept rule (spec §7): 413 / 24 / 12 € for the three listings whose sellers countered.
  assert.equal(byId['mv6qf10m-wait9i'].targetPrice, 413)
  assert.equal(byId['muvfbizr-gsecaj'].targetPrice, 24)
  assert.equal(byId['muvcbux2-7mka1b'].targetPrice, 11.5)
  // Every summary is a short Italian line the UI can show under «Perché questo numero».
  for (const p of Object.values(byId)) assert.match(p.summary, /^(−\d+%: fascia|nessuna offerta: )/)
})

test('policy: the inline fixture matches the user\'s backup when it is on this machine', { skip: !existsSync(BACKUP_PATH) }, () => {
  const items = JSON.parse(readFileSync(BACKUP_PATH, 'utf8'))
  assert.equal(items.length, REAL_ITEMS.length)
  for (const fx of REAL_ITEMS) {
    const it = items.find((x) => x.id === fx.id)
    assert.ok(it, fx.id)
    assert.equal(it.listPrice, fx.listPrice)
    assert.equal(it.targetPrice, fx.targetPrice)
    assert.equal(it.category, fx.category)
    assert.equal(it.status, fx.status)
    assert.equal((it.form || {}).listingAge || 'unknown', fx.listingAge)
    assert.equal((it.form || {}).sellerProfile || 'unknown', fx.sellerProfile)
    const seller = (it.negotiation || []).find((e) => e.by === 'seller')
    assert.equal(seller ? seller.price : undefined, fx.counter)
  }
})

test('policy: the precise rounding never eats the 2 € minimum saving', () => {
  // 22 € comic, 2–4 weeks, expert seller: table 12 − 3 = 9% → 20,02 € → the precise rule would say 21 € (1 € saved).
  const p = policyDiscountFor({ listPrice: 22, listingAge: 'weeks_2_4', category: 'collectible', sellerProfile: 'expert' })
  assert.equal(p.kind, 'offer')
  assert.equal(p.targetPrice, 20)
  assert.ok(p.reason.some((r) => /Almeno 2 € di risparmio/.test(r)))
  // 13,50 € at 7–30 days: 10% → 12,15 → 12 € saves 1,50 €; the next half step keeps the gap and is still near the table.
  const q = policyDiscountFor({ listPrice: 13.5, ageDays: 10 })
  assert.equal(q.targetPrice, 11.5)
  // When keeping the gap would ask far more than the table, the policy says «compra».
  const r = policyDiscountFor({ listPrice: 12, ageDays: 10 })
  assert.equal(r.kind, 'no_offer')
  assert.equal(r.alternative, 'buy')
})

test('policy: the precise rounding never crosses the floor; a policy fits a listing while its band and age tier still match', () => {
  // The %5 skip used to step one integer under `min`: 21 € with the market floor 19,55 gave 19 instead of 20.
  assert.equal(precisePriceFor(20.5, 21, { min: 19.5, max: 21 }), 20)
  assert.equal(precisePriceFor(25.2, 26, { min: 24.7, max: 26 }), 25, 'the multiple of 5 stays when it is the only integer left under the list price')
  assert.equal(precisePriceFor(33, 60, { min: 35 }), 36, 'room above a floor that is a multiple of 5: the next integer, as before')
  // Through the policy: 21 € fresh, p25 20,58 → floor 19,55 → 20 € saves only 1 €, and the 2 € rule finds 19 € under the
  // floor → «compra». The old 19 € contradicted the policy's own «Mai sotto 19,55 €».
  const p = policyDiscountFor({ listPrice: 21, ageDays: 2, market: { n: 5, p25Price: 20.58, medianPrice: 23.1, p75Price: 27.3 } })
  assert.equal(p.kind, 'no_offer')
  assert.equal(p.alternative, 'buy')
  let offers = 0
  for (let L = 20; L <= 40; L += 0.5) {
    for (let p25 = L - 3; p25 < L; p25 += 0.25) {
      for (const ageDays of [2, 10, 40]) {
        const pol = policyDiscountFor({ listPrice: L, ageDays, market: { n: 5, p25Price: p25, medianPrice: p25 * 1.12, p75Price: p25 * 1.3 } })
        if (pol.kind !== 'offer') continue
        offers++
        assert.ok(pol.targetPrice === null || pol.targetPrice >= pol.floor - 1e-9, `${L} € / p25 ${p25} / ${ageDays} d: ${pol.targetPrice} € under the floor ${pol.floor} €`)
        assert.ok(pol.targetPrice < L && L - pol.targetPrice >= POLICY_BOUNDS.MIN_GAP_EUR - 1e-9, `${L} € / p25 ${p25}: ${pol.targetPrice} €`)
      }
    }
  }
  assert.ok(offers > 100, `${offers} offers in the sweep`)
  // policyFitsListing: the stamps of a policy computed earlier against the listing as it is now.
  const fresh = policyDiscountFor({ listPrice: 15, ageDays: 2 })
  assert.equal(policyFitsListing(fresh, { listPrice: 15, ageDays: 2 }), true)
  assert.equal(policyFitsListing(fresh, { listPrice: 15, ageDays: 40 }), false, 'another age tier')
  assert.equal(policyFitsListing(fresh, { listPrice: 45, ageDays: 2 }), false, 'another band')
  assert.equal(policyFitsListing(policyDiscountFor({ listPrice: 30 }), { listPrice: 30, ageDays: null }), true, 'unknown age on both sides: the middle tier')
  assert.equal(policyFitsListing({ kind: 'no_offer', alternative: 'buy' }, { listPrice: 9 }), true, 'no stamps: kept')
  assert.equal(policyFitsListing(null, { listPrice: 9 }), false)
})
