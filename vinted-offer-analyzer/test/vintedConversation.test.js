import { test } from 'node:test'
import assert from 'node:assert/strict'
import { offerStatusOf, planInboxRows, planOfferCapture, readConversation } from '../mobile/src/services/vintedConversation.js'
import { classifyVintedNotification } from '../mobile/src/services/vintedEvents.js'
import { pageOf, templateOf } from '../mobile/src/services/vintedNav.js'

const CONV = '01a1e0ab-56c7-7000-acb4-62eadae93ee5'
const URL = `https://www.vinted.it/inbox/${CONV}?referrer=item`
// The browser's reading of the conversation shared on 15 Nov: listing at 9 €, the user's offer of 6 € «In sospeso».
const raw = (offers, extra = {}) => ({
  id: CONV, link: '/items/7654321098-fumetto-providence', title: 'Fumetto Providence di Alan Moore volume 1', price: '9,00 €', seller: 'tomsr01', canOffer: true,
  offers, ...extra,
})
const pending = { price: '6,00 €', original: '9,00 €', status: 'In sospeso', buttons: [] }
const item = (over = {}) => ({
  id: 'a1', status: 'planned', link: 'https://www.vinted.it/items/7654321098-fumetto-providence', title: 'Fumetto Providence di Alan Moore volume 1',
  listPrice: 9, targetPrice: 6, negotiation: [{ by: 'buyer', kind: 'offer', price: 6, planned: true }], conversationId: null, sellerName: null, ...over,
})
const analysed = { itemId: '7654321098', title: 'Fumetto Providence di Alan Moore volume 1', listPrice: 9 }

test('conversation: the page is read into the listing, the offers and their status', () => {
  const conv = readConversation(raw([pending]), URL)
  assert.equal(conv.convId, CONV)
  assert.equal(conv.itemId, '7654321098')
  assert.equal(conv.itemLink, 'https://www.vinted.it/items/7654321098')
  assert.equal(conv.listPrice, 9)
  assert.equal(conv.seller, 'tomsr01')
  assert.deepEqual(conv.last, { price: 6, original: 9, status: 'pending', statusText: 'In sospeso', buttons: [], incoming: false })
  // Nothing readable → no offer; a name that is a sentence is not kept as a name.
  assert.equal(readConversation(raw([{ price: '', original: '', status: '' }]), URL).last, null)
  assert.equal(readConversation(raw([pending], { seller: 'Ciao! Venderesti questo prodotto' }), URL).seller, null)
  assert.equal(readConversation(null, URL).convId, null)
  // The status by its stem; what is not understood stays unknown and changes nothing.
  assert.equal(offerStatusOf('In sospeso'), 'pending')
  assert.equal(offerStatusOf('Accettata'), 'accepted')
  assert.equal(offerStatusOf('Rifiutata'), 'declined')
  assert.equal(offerStatusOf('Non accettata'), 'declined')
  assert.equal(offerStatusOf('Scaduta'), 'expired')
  assert.equal(offerStatusOf('Annullata'), 'cancelled')
  assert.equal(offerStatusOf('Boh'), 'unknown')
  assert.equal(offerStatusOf(''), 'unknown')
})

test('conversation: an offer made on Vinted reaches the list by itself', () => {
  const conv = readConversation(raw([pending]), URL)
  // The user's flow: analysed in the browser, offer typed on Vinted → recorded as sent, no tap.
  assert.equal(planOfferCapture(conv, { items: [], analysed }).action, 'record')
  assert.equal(planOfferCapture(conv, { items: [], analysed }).price, 6)
  // A saved plan of the listing on screen is replaced by the record of what was really offered.
  assert.equal(planOfferCapture(conv, { items: [item()], analysed }).action, 'record')
  // A saved plan, another listing on screen: the plan becomes sent; the figure follows Vinted when it differs.
  const other = { itemId: '111', title: 'Altro', listPrice: 30 }
  assert.deepEqual([planOfferCapture(conv, { items: [item()], analysed: other }).action, planOfferCapture(conv, { items: [item()], analysed: other }).reprice], ['send', false])
  assert.equal(planOfferCapture(conv, { items: [item({ targetPrice: 6.5, negotiation: [{ by: 'buyer', price: 6.5, planned: true }] })], analysed: null }).reprice, true)
  // Never analysed and not in the list: one tap analyses and records.
  const need = planOfferCapture(conv, { items: [], analysed: other })
  assert.deepEqual([need.action, need.link], ['needs_analysis', 'https://www.vinted.it/items/7654321098'])
  // Already sent: the conversation is attached once, then nothing more (the page reports again and again).
  const sent = item({ status: 'sent' })
  assert.equal(planOfferCapture(conv, { items: [sent], analysed }).action, 'attach')
  const known = planOfferCapture(conv, { items: [item({ status: 'sent', conversationId: CONV, sellerName: 'tomsr01' })], analysed })
  assert.deepEqual([known.action, known.recorded], ['none', true])
  assert.equal(planOfferCapture(conv, { items: [item({ status: 'sent', targetPrice: 7, negotiation: [{ by: 'buyer', price: 7 }] })], analysed }).action, 'reprice')
  // A closed offer on the same listing does not swallow a new one.
  assert.equal(planOfferCapture(conv, { items: [item({ status: 'declined' })], analysed }).action, 'record')
  // The reply planned for a counter-offer, now on Vinted.
  const countered = item({ status: 'countered', negotiation: [{ by: 'buyer', price: 5 }, { by: 'seller', price: 7 }], counterPlan: { price: 6, sentAt: null } })
  assert.equal(planOfferCapture(conv, { items: [countered], analysed: null }).action, 'counter_sent')
  assert.equal(planOfferCapture(conv, { items: [item({ status: 'countered', counterPlan: { price: 6.5, sentAt: null } })], analysed: null }).action, 'none')
  // No link on the page: the title and the listing price identify the listing.
  const noLink = readConversation(raw([pending], { link: '' }), URL)
  assert.equal(noLink.itemId, null)
  assert.equal(planOfferCapture(noLink, { items: [], analysed }).action, 'record')
  assert.equal(planOfferCapture(noLink, { items: [], analysed: { itemId: '7654321098', title: 'Fumetto Providence di Alan Moore volume 1', listPrice: 12 } }).action, 'needs_analysis')
  assert.equal(planOfferCapture(readConversation(raw([]), URL), { items: [item()], analysed }).action, 'none')
})

test('conversation: the answer read on Vinted closes the offer; the seller\'s own offer changes nothing', () => {
  const sent = item({ status: 'sent', conversationId: CONV })
  const at = (status, buttons = []) => readConversation(raw([{ price: '6,00 €', original: '9,00 €', status, buttons }]), URL)
  assert.deepEqual([planOfferCapture(at('Accettata'), { items: [sent] }).action, planOfferCapture(at('Accettata'), { items: [sent] }).status], ['outcome', 'accepted'])
  assert.equal(planOfferCapture(at('Rifiutata'), { items: [sent] }).status, 'declined')
  assert.equal(planOfferCapture(at('Scaduta'), { items: [sent] }).status, 'no_reply')
  assert.equal(planOfferCapture(at('Qualcosa di nuovo'), { items: [sent] }).action, 'none')
  // A plan never sent is not closed by an old refusal in the same conversation; nor is anything recorded from it.
  assert.equal(planOfferCapture(at('Rifiutata'), { items: [item()], analysed }).action, 'none')
  assert.equal(planOfferCapture(at('Rifiutata'), { items: [], analysed }).action, 'none')
  // Another figure and another conversation: not this offer.
  assert.equal(planOfferCapture(readConversation(raw([{ price: '4,00 €', original: '9,00 €', status: 'Rifiutata', buttons: [] }]), URL), { items: [item({ status: 'sent' })] }).action, 'none')
  // A pending figure above the offer before it, with no button to tell whose it is: never recorded as the user's own.
  const raised = readConversation(raw([{ price: '5,00 €', original: '9,00 €', status: 'Rifiutata', buttons: [] }, { price: '7,00 €', original: '9,00 €', status: 'In sospeso', buttons: [] }]), URL)
  assert.equal(planOfferCapture(raised, { items: [], analysed }).action, 'unclear')
  assert.equal(planOfferCapture(raised, { items: [item({ status: 'sent', targetPrice: 5, negotiation: [{ by: 'buyer', price: 5 }] })], analysed }).action, 'unclear')
  // …unless it is exactly what the list expects: the figure already recorded, or the reply planned for a counter-offer.
  assert.equal(planOfferCapture(raised, { items: [item({ status: 'sent', targetPrice: 7, negotiation: [{ by: 'buyer', price: 7 }] })], analysed }).action, 'attach')
  assert.equal(planOfferCapture(raised, { items: [item({ status: 'countered', counterPlan: { price: 7, sentAt: null } })], analysed }).action, 'counter_sent')
  // A lower second offer can only be the buyer's.
  const lowered = readConversation(raw([{ price: '7,00 €', original: '9,00 €', status: 'Scaduta', buttons: [] }, { price: '6,00 €', original: '9,00 €', status: 'In sospeso', buttons: [] }]), URL)
  assert.equal(planOfferCapture(lowered, { items: [], analysed }).action, 'record')
  // The last offer carries «Accetta»: it is the seller's counter-offer, announced and never applied.
  const counter = readConversation(raw([{ price: '5,00 €', original: '9,00 €', status: 'Rifiutata', buttons: [] }, { price: '7,00 €', original: '9,00 €', status: 'In sospeso', buttons: ['Accetta', 'Rifiuta'] }]), URL)
  const plan = planOfferCapture(counter, { items: [sent], analysed })
  assert.deepEqual([plan.action, plan.price, plan.itemId], ['incoming', 7, 'a1'])
})

test('conversation list: only the offers whose conversation is known are touched', () => {
  const rows = [
    { id: CONV, seller: 'tomsr01', text: 'Ci spiace, tomsr01 non ha accettato la tua offerta' },
    { id: '01a1d58f-469f-764d-aea0-fa5d34f0eb5e', seller: 'vale13791', text: 'Ci spiace, vale13791 non ha accettato la tua offerta' },
    { id: 'x3', seller: 'misterbeppe', text: 'misterbeppe ha accettato la tua offerta di €12.60' },
  ]
  const items = [item({ status: 'sent', conversationId: CONV }), item({ id: 'b2', status: 'sent', conversationId: 'x3' }), item({ id: 'c3', status: 'sent', sellerName: 'vale13791' })]
  const plans = planInboxRows(rows, items)
  assert.deepEqual(plans.map((p) => [p.itemId, p.action, p.status]), [['a1', 'outcome', 'declined'], ['b2', 'outcome', 'accepted']])
  // The user's own offer as last message, a chat line, a closed offer: nothing.
  assert.deepEqual(planInboxRows([{ id: CONV, seller: 'tomsr01', text: 'Ciao! Venderesti questo prodotto a €6.00' }], items), [])
  assert.deepEqual(planInboxRows([{ id: CONV, seller: 'tomsr01', text: 'Buona giornata' }], items), [])
  assert.deepEqual(planInboxRows(rows, [item({ status: 'declined', conversationId: CONV })]), [])
  assert.equal(planInboxRows([{ id: CONV, seller: 'tomsr01', text: 'tomsr01 ti ha fatto una nuova offerta: €7.50' }], items)[0].action, 'counter')
  // Vinted's refusal says «non ha accettato»: it must never read as an acceptance.
  assert.equal(classifyVintedNotification({ text: 'Ci spiace, vale13791 non ha accettato la tua offerta' }).kind, 'declined')
  assert.equal(classifyVintedNotification({ text: 'La tua offerta non è stata accettata' }).kind, 'declined')
  assert.equal(classifyVintedNotification({ title: 'misterbeppe', text: 'misterbeppe ha accettato la tua offerta di €12.60' }).kind, 'accepted')
})

test('vinted browser: a conversation is a code with dashes on the new pages', () => {
  assert.deepEqual(pageOf(URL), { type: 'conversation', id: CONV })
  assert.deepEqual(pageOf('https://www.vinted.it/inbox/987654'), { type: 'conversation', id: '987654' })
  assert.equal(pageOf('https://www.vinted.it/inbox').type, 'inbox')
  assert.equal(templateOf(URL), 'www.vinted.it/inbox/{id}?referrer')
})
