import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyVintedNotification, matchVintedEvent, planVintedEvent, vintedEventKey, vintedPriceOf, vintedSellerOf } from '../mobile/src/services/vintedEvents.js'

const NOW = new Date('2026-11-10T10:00:00Z')
const item = (over = {}) => ({ id: 'a', title: 'Will Eisner - Verso la tempesta', listPrice: 15, targetPrice: 12.5, status: 'sent', sentAt: '2026-11-09T20:00:00Z', negotiation: [{ by: 'buyer', price: 12.5 }], sellerName: 'mario_rossi', ...over })

test('vinted notifications: what each one says', () => {
  const k = (title, text) => classifyVintedNotification({ title, text }).kind
  assert.equal(k('Vinted', 'mario_rossi ha accettato la tua offerta'), 'accepted')
  assert.equal(k('Offerta rifiutata', 'mario_rossi ha rifiutato la tua offerta di 12,50 €'), 'declined')
  assert.equal(k('Vinted', 'La tua offerta è scaduta'), 'expired')
  assert.equal(k('mario_rossi', 'Ti ha fatto un\'offerta: 13,00 €'), 'counter')
  assert.equal(k('Vinted', 'Offerta speciale per te: sconto del 10%'), 'seller_offer')
  assert.equal(k('Prezzo ridotto!', 'Un articolo tra i tuoi preferiti ora costa meno'), 'price_drop')
  assert.equal(k('mario_rossi', 'Ti ha inviato un messaggio'), 'message')
  assert.equal(k('Vinted', 'Completa il tuo profilo'), 'other')
  assert.equal(classifyVintedNotification({ title: 'x', text: 'Ti ha fatto un\'offerta: 13,00 €' }).price, 13)
  assert.equal(classifyVintedNotification({ text: 'sconto del 15%' }).pct, 15)
})

test('vinted notifications: matched to the right saved offer, automatic only when certain', () => {
  const items = [item(), item({ id: 'b', title: 'Wanted', sellerName: 'luca', negotiation: [{ by: 'buyer', price: 12.5 }] }), item({ id: 'c', title: 'Pyongyang', status: 'accepted', sellerName: 'anna' })]
  const accepted = { key: 'k1', at: 1, title: 'Vinted', text: 'mario_rossi ha accettato la tua offerta per Will Eisner - Verso la tempesta' }
  const m = matchVintedEvent(accepted, classifyVintedNotification(accepted), items, NOW)
  assert.equal(m.item.id, 'a')
  assert.ok(m.certain)
  const plan = planVintedEvent(accepted, items, NOW)
  assert.deepEqual([plan.action, plan.status, plan.itemId], ['auto', 'accepted', 'a'])
  // Only the seller's name and two open offers at the same price: the name decides.
  const byName = planVintedEvent({ key: 'k2', at: 2, title: 'luca', text: 'Ha rifiutato la tua offerta' }, items, NOW)
  assert.deepEqual([byName.action, byName.status, byName.itemId], ['auto', 'declined', 'b'])
  // Nothing identifies the offer and two are waiting: ask nothing, report it.
  const vague = planVintedEvent({ key: 'k3', at: 3, title: 'Vinted', text: 'La tua offerta è stata accettata' }, items, NOW)
  assert.equal(vague.action, 'unmatched')
  // A single offer waiting: the likely one, to be confirmed with a tap.
  const single = planVintedEvent({ key: 'k4', at: 4, title: 'Vinted', text: 'La tua offerta è stata accettata' }, [items[0]], NOW)
  assert.deepEqual([single.action, single.itemId], ['ask', 'a'])
  // A counter-offer opens the counter screen with the figure, it never changes the status by itself.
  const counter = planVintedEvent({ key: 'k5', at: 5, title: 'mario_rossi', text: 'Ti ha fatto un\'offerta: 13,50 €' }, items, NOW)
  assert.deepEqual([counter.action, counter.itemId, counter.price], ['counter', 'a', 13.5])
  // Group summaries and unrelated notifications are ignored; an answer never reopens a closed offer.
  assert.equal(planVintedEvent({ title: 'Vinted', text: '3 nuove notifiche', summary: true }, items, NOW).action, 'ignore')
  assert.equal(planVintedEvent({ title: 'anna', text: 'ha accettato la tua offerta per Pyongyang' }, items, NOW).action, 'unmatched')
  assert.notEqual(vintedEventKey({ key: 'a', at: 1, text: 'x' }), vintedEventKey({ key: 'a', at: 2, text: 'x' }))
})

test('vinted notifications: the real format (title = seller, «€12.60» with the symbol first)', () => {
  const real = { key: 'r1', at: 10, title: 'misterbeppe', text: 'misterbeppe ha accettato la tua offerta di €12.60' }
  const cls = classifyVintedNotification(real)
  assert.deepEqual([cls.kind, cls.price], ['accepted', 12.6])
  assert.equal(vintedSellerOf(real), 'misterbeppe')
  assert.equal(vintedSellerOf({ title: 'Vinted', text: 'Vinted ti dà il benvenuto' }), null)
  assert.equal(vintedPriceOf('offerta di €12.60'), 12.6)
  assert.equal(vintedPriceOf('12,60 €'), 12.6)
  assert.equal(vintedPriceOf('€1.250,00'), 1250)
  assert.equal(vintedPriceOf('€ 335'), 335)
  assert.equal(vintedPriceOf('nessuna cifra'), null)
  // Saved before the app knew the seller's name: the exact figure of the only offer at that price is enough.
  const offers = [item({ id: 'x', title: 'Fumetto qualsiasi', listPrice: 14, targetPrice: 12.6, negotiation: [{ by: 'buyer', price: 12.6 }], sellerName: null }), item({ id: 'y', title: 'Altro', negotiation: [{ by: 'buyer', price: 12.5 }], sellerName: null })]
  const plan = planVintedEvent(real, offers, NOW)
  assert.deepEqual([plan.action, plan.status, plan.itemId, plan.seller], ['auto', 'accepted', 'x', 'misterbeppe'])
  // Two open offers at the same figure and no name: a question, never a guess.
  const twins = [offers[0], item({ id: 'z', title: 'Gemello', targetPrice: 12.6, negotiation: [{ by: 'buyer', price: 12.6 }], sellerName: null })]
  assert.equal(planVintedEvent(real, twins, NOW).action, 'ask')
  // Once the name is known it decides, even among twins.
  const named = [{ ...twins[0], sellerName: 'misterbeppe' }, twins[1]]
  assert.deepEqual([planVintedEvent(real, named, NOW).action, planVintedEvent(real, named, NOW).itemId], ['auto', 'x'])
})
