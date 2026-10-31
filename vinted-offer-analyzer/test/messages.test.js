import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_TONES, EXTRA_TONES, MARKET_TONE, MESSAGE_RULES, TONES, analyzeOffer, buildAfterRefusalMessage, buildMessages, normalizeInput, recommendedToneFor, toneMeta,
} from '../src/core/index.js'

const SUNDAY_NIGHT = new Date(2026, 9, 4, 21, 45)
const args = (over = {}) => ({ itemTitle: 'Felpa Nike', listPrice: 100, targetPrice: 80, listingAge: { id: 'weeks_1_2' }, sendAt: SUNDAY_NIGHT, ...over })
const inputOf = (form) => normalizeInput({ category: 'other', listingAge: 'weeks_1_2', sellerProfile: 'unknown', listingSignal: 'none', ...form }).input
const PAYS = /pago subito|completo subito/i

/** Spec §4.2 rules, on every first-offer template in both modes. */
const assertRules = (msgs, listPrice) => {
  assert.ok(msgs.length >= 4)
  for (const m of msgs) {
    assert.match(m.text, /^Ciao!/, m.tone)
    assert.match(m.text, PAYS, `${m.tone}: ${m.text}`)
    assert.ok(!/minimo/i.test(m.text), `${m.tone} says «minimo»`)
    if (Number.isFinite(listPrice) && listPrice < MESSAGE_RULES.NO_BUDGET_UNDER) assert.ok(!/budget/i.test(m.text), `${m.tone} says «budget» under 50 €`)
    // No seller names, handles, links or phone numbers in any template.
    assert.ok(!/@|https?:|www\.|\d{7,}/.test(m.text), `${m.tone}: ${m.text}`)
    assert.ok(toneMeta(m.tone), `${m.tone} has a label`)
  }
}

test('messages: tones catalogue, unique ids, meta for every tone', () => {
  assert.deepEqual(TONES.map((t) => t.id), ['cordiale', 'diretto', 'impegno', 'motivato'])
  assert.deepEqual(EXTRA_TONES.map((t) => t.id), ['lotto', 'spedizione', 'domanda', 'dopo_rifiuto'])
  assert.equal(new Set(ALL_TONES.map((t) => t.id)).size, ALL_TONES.length)
  assert.equal(toneMeta('informato'), MARKET_TONE)
  assert.equal(toneMeta('nope'), null)
  for (const t of ALL_TONES) assert.ok(t.label && t.hint && !/budget/i.test(t.hint), t.id)
})

test('messages: the rules hold for every template, cheap and expensive, before and after the offer', () => {
  for (const L of [8, 12, 25, 45, 50, 100, 450]) {
    for (const beforeOffer of [false, true]) {
      const msgs = buildMessages(args({ listPrice: L, targetPrice: Math.round(L * 0.85 * 2) / 2, beforeOffer, signals: { sellerItems: 3 }, afterRefusal: true, listingAge: { id: 'over_month' } }))
      assertRules(msgs, L)
      if (beforeOffer) assert.ok(msgs.filter((m) => TONES.some((t) => t.id === m.tone)).every((m) => !/ho inviato|ho appena inviato/.test(m.text)))
    }
  }
})

test('messages: under 30 € the «diretto» text is a one-liner, under 50 € no one talks about a budget', () => {
  const cheap = buildMessages(args({ listPrice: 24, targetPrice: 20 }))
  const diretto = cheap.find((m) => m.tone === 'diretto')
  assert.equal(diretto.text, "Ciao! Ti ho inviato un'offerta di 20 €, se ti va bene pago subito.")
  assert.ok(!cheap.find((m) => m.tone === 'motivato').text.includes('budget'))
  assert.match(cheap.find((m) => m.tone === 'motivato').text, /quanto riesco a spendere adesso/)
  const beforeCheap = buildMessages(args({ listPrice: 24, targetPrice: 20, beforeOffer: true })).find((m) => m.tone === 'diretto')
  assert.equal(beforeCheap.text, 'Ciao! Ti andrebbe bene 20 € per "Felpa Nike"? Se sì ti invio l\'offerta e pago subito.')
  const mid = buildMessages(args({ listPrice: 45, targetPrice: 38 }))
  assert.match(mid.find((m) => m.tone === 'diretto').text, /per "Felpa Nike"\. Se va bene per te completo subito/)
  assert.ok(!mid.some((m) => /budget/i.test(m.text)))
  const dear = buildMessages(args({ listPrice: 60, targetPrice: 50 }))
  assert.match(dear.find((m) => m.tone === 'motivato').text, /massimo del mio budget/)
  const unknown = buildMessages({ itemTitle: 'Giacca', targetPrice: 12.5, listingAge: { id: 'unknown' }, sendAt: SUNDAY_NIGHT })
  assert.equal(unknown.length, 4, 'without a list price the four base templates only')
})

test('messages: situational tones appear only on their condition and keep the base four first', () => {
  const base = buildMessages(args())
  assert.deepEqual(base.map((m) => m.tone), ['cordiale', 'diretto', 'impegno', 'motivato'])
  const shipping = buildMessages(args({ listPrice: 12, targetPrice: 10 }))
  assert.deepEqual(shipping.map((m) => m.tone), ['cordiale', 'diretto', 'impegno', 'motivato', 'spedizione'])
  assert.match(shipping[4].text, /spedizione fosse inclusa lo prenderei a 12 € e pago subito/)
  assert.equal(buildMessages(args({ listPrice: 15, targetPrice: 12 })).length, 4, '15 € is not under 15')
  const bundle = buildMessages(args({ signals: { sellerItems: 2 } }))
  assert.equal(bundle[4].tone, 'lotto')
  assert.match(bundle[4].text, /Se prendo anche un altro tuo articolo, riusciresti a farmi un prezzo per entrambi con una sola spedizione\? Pago subito\./)
  const named = buildMessages(args({ otherItem: 'Pantaloni Nike', bundlePrice: 130 }))
  assert.match(named.find((m) => m.tone === 'lotto').text, /Se prendo anche "Pantaloni Nike", riusciresti a farmi 130 € per entrambi/)
  assert.equal(buildMessages(args({ signals: { sellerItems: 1 } })).length, 4)
  const old = buildMessages(args({ listingAge: { id: 'over_month' } }))
  assert.equal(old[4].tone, 'domanda')
  assert.equal(old[4].text, 'Ciao! "Felpa Nike" è ancora disponibile? Accetteresti 80 €? Se sì pago subito. Grazie!')
  assert.equal(buildMessages(args({ listingAge: { id: 'weeks_2_4' } }))[4].tone, 'domanda')
  assert.equal(buildMessages(args({ sellerProfile: 'quiet' }))[4].tone, 'domanda')
  assert.equal(buildMessages(args({ sellerProfile: 'inactive' }))[4].tone, 'domanda')
  const refused = buildMessages(args({ afterRefusal: true }))
  assert.equal(refused[4].tone, 'dopo_rifiuto')
  assert.equal(refused[4].text, buildAfterRefusalMessage())
  assert.match(buildAfterRefusalMessage(), /^Ciao! Grazie comunque: se dovessi ribassare resto interessato/)
  // With a market the informato tone comes before the situational ones.
  const all = buildMessages(args({ market: { n: 3, medianPrice: 72.5 }, signals: { sellerItems: 3 }, listingAge: { id: 'over_month' }, afterRefusal: true }))
  assert.deepEqual(all.map((m) => m.tone), ['cordiale', 'diretto', 'impegno', 'motivato', 'informato', 'lotto', 'domanda', 'dopo_rifiuto'])
  assert.deepEqual(buildMessages(args({ beforeOffer: true, market: { n: 3, medianPrice: 72.5 }, listingAge: { id: 'over_month' } })).map((m) => m.tone), ['cordiale', 'diretto', 'impegno', 'motivato', 'informato', 'domanda'])
})

test('messages: recommended tone is «diretto» under 30 €, «motivato» only for premium items from 50 €', () => {
  assert.equal(recommendedToneFor(inputOf({ listPrice: '24', targetPrice: '16', category: 'collectible' })), 'diretto', 'premium but cheap')
  assert.equal(recommendedToneFor(inputOf({ listPrice: '29', targetPrice: '18' })), 'diretto', 'high risk but cheap')
  assert.equal(recommendedToneFor(inputOf({ listPrice: '40', targetPrice: '30', category: 'luxury' })), 'cordiale', 'premium under 50 €: by risk band, never the budget reason')
  assert.equal(recommendedToneFor(inputOf({ listPrice: '60', targetPrice: '50', category: 'luxury' })), 'motivato')
  assert.equal(recommendedToneFor(inputOf({ listPrice: '60', targetPrice: '55' })), 'diretto')
  assert.equal(recommendedToneFor(inputOf({ listPrice: '60', targetPrice: '48' })), 'cordiale')
  assert.equal(recommendedToneFor(inputOf({ listPrice: '60', targetPrice: '38' })), 'impegno')
  assert.ok(['diretto', 'cordiale', 'impegno'].includes(recommendedToneFor(inputOf({ listPrice: '45', targetPrice: '30', category: 'collectible' }))))
})

test('messages: the analysis carries the situational tones and the recommended one exists among its messages', () => {
  const cheap = analyzeOffer({ itemTitle: 'Maglietta', category: 'fast_fashion', listPrice: '12', targetPrice: '10', listingAge: 'over_month', sellerProfile: 'quiet', listingSignal: 'none', signals: { sellerItems: 4 } }, SUNDAY_NIGHT)
  assert.equal(cheap.kind, 'analysis')
  assert.equal(cheap.recommendedTone, 'diretto')
  assert.deepEqual(cheap.messages.map((m) => m.tone), ['cordiale', 'diretto', 'impegno', 'motivato', 'lotto', 'spedizione', 'domanda'])
  assert.ok(cheap.messages.some((m) => m.tone === cheap.recommendedTone))
  assertRules(cheap.messages, 12)
  const plain = analyzeOffer({ itemTitle: 'Nike Air Force 1', category: 'sneakers', listPrice: '100', targetPrice: '80', listingAge: 'weeks_1_2', sellerProfile: 'unknown', listingSignal: 'none' }, SUNDAY_NIGHT)
  assert.equal(plain.messages.length, 4, 'nothing situational on a plain 100 € listing')
})
