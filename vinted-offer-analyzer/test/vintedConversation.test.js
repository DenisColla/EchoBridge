import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeCounter } from '../src/core/index.js'
import { counterRawFor } from '../mobile/src/services/counterInput.js'
import { offerStatusOf, planInboxRows, planOfferCapture, readConversation } from '../mobile/src/services/vintedConversation.js'
import { classifyVintedNotification } from '../mobile/src/services/vintedEvents.js'
import { pageOf, templateOf } from '../mobile/src/services/vintedNav.js'

const CONV = '01a1e0ab-56c7-7000-acb4-62eadae93ee5'
const URL = `https://www.vinted.it/inbox/${CONV}?referrer=item`
// The browser's reading of the conversation shared on 15 Nov: listing at 9 €, the user's request of 6 € «In sospeso».
const raw = (offers, extra = {}) => ({
  id: CONV, link: '/items/7654321098-fumetto-providence', title: 'Fumetto Providence di Alan Moore volume 1', price: '9,00 €', seller: 'tomsr01', canOffer: true,
  offers, ...extra,
})
const request = (price, status, extra = {}) => ({ kind: 'request', price, original: '9,00 €', status, buy: false, buttons: [], ...extra })
const pending = request('6,00 €', 'In sospeso')
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
  assert.deepEqual(conv.mine, { by: 'buyer', price: 6, original: 9, status: 'pending', statusText: 'In sospeso', buttons: [], open: false, incoming: false })
  assert.equal(conv.standing, null)
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
  assert.equal(planOfferCapture(conv, { items: [item({ status: 'sent' })], analysed }).action, 'attach')
  const known = planOfferCapture(conv, { items: [item({ status: 'sent', conversationId: CONV, sellerName: 'tomsr01' })], analysed })
  assert.deepEqual([known.action, known.recorded], ['none', true])
  assert.equal(planOfferCapture(conv, { items: [item({ status: 'sent', targetPrice: 7, negotiation: [{ by: 'buyer', price: 7 }] })], analysed }).action, 'reprice')
  // A closed offer on the same listing does not swallow a new one; a second request, higher or lower, is the user's.
  assert.equal(planOfferCapture(conv, { items: [item({ status: 'declined' })], analysed }).action, 'record')
  const raised = readConversation(raw([request('5,00 €', 'Rifiutata'), request('7,00 €', 'In sospeso')]), URL)
  assert.deepEqual([planOfferCapture(raised, { items: [], analysed }).action, planOfferCapture(raised, { items: [], analysed }).price], ['record', 7])
  // No link on the page: the title and the listing price identify the listing.
  const noLink = readConversation(raw([pending], { link: '' }), URL)
  assert.equal(noLink.itemId, null)
  assert.equal(planOfferCapture(noLink, { items: [], analysed }).action, 'record')
  assert.equal(planOfferCapture(noLink, { items: [], analysed: { itemId: '7654321098', title: 'Fumetto Providence di Alan Moore volume 1', listPrice: 12 } }).action, 'needs_analysis')
  assert.equal(planOfferCapture(readConversation(raw([]), URL), { items: [item()], analysed }).action, 'none')
  // A request the page lets the user accept is somebody else's (the user sells there): never the user's own offer.
  const selling = readConversation(raw([request('7,00 €', 'In sospeso', { buttons: ['Accetta', 'Rifiuta'] })]), URL)
  assert.equal(selling.mine, null)
  assert.equal(planOfferCapture(selling, { items: [], analysed }).action, 'incoming')
})

test('conversation: the answer read on Vinted closes the offer', () => {
  const sent = item({ status: 'sent', conversationId: CONV })
  const at = (status) => readConversation(raw([request('6,00 €', status)]), URL)
  assert.deepEqual([planOfferCapture(at('Accettata'), { items: [sent] }).action, planOfferCapture(at('Accettata'), { items: [sent] }).status], ['outcome', 'accepted'])
  assert.equal(planOfferCapture(at('Rifiutata'), { items: [sent] }).status, 'declined')
  assert.equal(planOfferCapture(at('Scaduta'), { items: [sent] }).status, 'no_reply')
  assert.equal(planOfferCapture(at('Qualcosa di nuovo'), { items: [sent] }).action, 'none')
  // A plan never sent is not closed by an old refusal in the same conversation; nor is anything recorded from it.
  assert.equal(planOfferCapture(at('Rifiutata'), { items: [item()], analysed }).action, 'none')
  assert.equal(planOfferCapture(at('Rifiutata'), { items: [], analysed }).action, 'none')
  // Another figure and another conversation: not this offer.
  assert.equal(planOfferCapture(readConversation(raw([request('4,00 €', 'Rifiutata')]), URL), { items: [item({ status: 'sent' })] }).action, 'none')
})

test('conversation: a purchase and an article that is gone, as the pages of 15 Nov say them', () => {
  // «31,00 € · 40,00 € · Accettata», then «Acquisto andato a buon fine».
  const bought = (offers, extra = {}) => readConversation(raw(offers, { purchased: true, ...extra }), URL)
  const accepted = bought([request('6,00 €', 'Accettata')])
  const sent = item({ status: 'sent', conversationId: CONV })
  assert.deepEqual([planOfferCapture(accepted, { items: [sent] }).action, planOfferCapture(accepted, { items: [sent] }).status], ['purchase', 'accepted'])
  // Bought at the seller's own offer: a deal at his figure. After a refusal, or with a plan never sent: a purchase at the listing price.
  const noOffers = bought([])
  assert.deepEqual([planOfferCapture(noOffers, { items: [item({ status: 'countered', negotiation: [{ by: 'buyer', price: 6 }, { by: 'seller', price: 8 }] })] }).status], ['accepted'])
  assert.equal(planOfferCapture(bought([request('6,00 €', 'Rifiutata')]), { items: [item({ status: 'declined' })] }).status, 'bought')
  assert.equal(planOfferCapture(bought([request('6,00 €', 'Rifiutata')]), { items: [sent] }).status, 'bought')
  // Bought without waiting for the answer: a purchase at the listing price, not a deal at the figure offered.
  const impatient = planOfferCapture(bought([request('6,00 €', 'In sospeso')]), { items: [sent] })
  assert.deepEqual([impatient.status, impatient.atList], ['bought', true])
  assert.equal(planOfferCapture(accepted, { items: [sent] }).atList, false)
  assert.equal(planOfferCapture(noOffers, { items: [item()] }).status, 'bought')
  // Already closed as a deal, or not in the list: nothing.
  assert.equal(planOfferCapture(accepted, { items: [item({ status: 'accepted', conversationId: CONV })] }).action, 'none')
  assert.equal(planOfferCapture(accepted, { items: [] }).action, 'none')
  // «12,60 € · 21,00 € · Annullata» with «Articolo non disponibile»: somebody else bought it.
  const gone = readConversation(raw([request('6,00 €', 'Annullata')], { unavailable: true }), URL)
  assert.deepEqual([planOfferCapture(gone, { items: [sent] }).action, planOfferCapture(gone, { items: [sent] }).status], ['outcome', 'sold_other'])
  // «Annullata» alone does not say why: nothing changes by itself.
  assert.equal(planOfferCapture(readConversation(raw([request('6,00 €', 'Annullata')]), URL), { items: [sent] }).action, 'none')
  // The article is gone but the user's purchase line is there: his purchase.
  assert.equal(planOfferCapture(bought([request('6,00 €', 'Annullata')], { unavailable: true }), { items: [item({ status: 'countered', negotiation: [{ by: 'buyer', price: 6 }, { by: 'seller', price: 8 }] })] }).action, 'purchase')
})

// The real page of 15 Nov, 23:08: the request of 15 € «Rifiutata», then the seller's own offer of 20 € with «Acquista».
const SB = '01a1e0ee-626b-7000-ab49-c00000bfc9'
const counterPage = (extra = {}, sellerOffer = {}) => readConversation({
  id: SB, link: '/items/8812345678-southern-bastards', title: 'Southetn Bastards Omnibus Volume 1 - Pan', price: '20,00 €', seller: 'ravafra', canOffer: true,
  offers: [
    { kind: 'request', price: '15,00 €', original: '22,00 €', status: 'Rifiutata', buy: false, buttons: [] },
    { kind: 'offer', price: '20,00 €', original: '22,00 €', status: '', buy: true, buttons: ['Acquista'], ...sellerOffer },
  ],
  ...extra,
}, `https://www.vinted.it/inbox/${SB}?referrer=inbox`)
const bastards = (over = {}) => ({
  id: 'sb', status: 'sent', link: 'https://www.vinted.it/items/8812345678-southern-bastards', title: 'Southetn Bastards Omnibus Volume 1 - Panini Comics - Jason Aaron',
  listPrice: 22, targetPrice: 15, sentAt: '2026-11-15T20:38:20.000Z', negotiation: [{ by: 'buyer', kind: 'offer', price: 15, at: '2026-11-15T20:38:20.000Z', planned: false }],
  conversationId: SB, sellerName: 'ravafra', form: { itemTitle: 'Southetn Bastards Omnibus Volume 1', category: 'books', listPrice: '22', targetPrice: '15', listingAge: 'over_month', sellerProfile: 'unknown', listingSignal: 'none', link: 'https://www.vinted.it/items/8812345678-southern-bastards' },
  ...over,
})

test('conversation: «Rifiutata» followed by the seller\'s own offer is a counter-offer, not a refusal', () => {
  const conv = counterPage()
  // The listing's own price is the crossed one: the price on top follows the seller's offer.
  assert.equal(conv.listPrice, 22)
  assert.deepEqual([conv.mine.price, conv.mine.status, conv.standing.by, conv.standing.price, conv.standing.open], [15, 'declined', 'seller', 20, true])
  const plan = planOfferCapture(conv, { items: [bastards()] })
  assert.deepEqual([plan.action, plan.itemId, plan.price, plan.previousOffer], ['counter', 'sb', 20, 15])
  // What 1.10.0 did: it closed the offer as refused. Opening the conversation again reopens it as a counter-offer.
  for (const status of ['declined', 'no_reply']) assert.equal(planOfferCapture(conv, { items: [bastards({ status })] }).action, 'counter', status)
  // Also when the list never knew the conversation: the listing identifies it.
  assert.equal(planOfferCapture(conv, { items: [bastards({ status: 'declined', conversationId: null })] }).action, 'counter')
  // Registered once: the page reports again and nothing more happens.
  const countered = bastards({ status: 'countered', negotiation: [{ by: 'buyer', price: 15 }, { by: 'seller', price: 20 }], counterPlan: { price: 17.5, sentAt: null } })
  const again = planOfferCapture(conv, { items: [countered] })
  assert.deepEqual([again.action, again.recorded, again.counter], ['none', true, true])
  // He changes his figure: a new counter-offer.
  assert.equal(planOfferCapture(counterPage({}, { price: '19,00 €' }), { items: [countered] }).price, 19)
  // An accepted or bought offer is never reopened; a listing that is not in the list is only shown.
  assert.equal(planOfferCapture(conv, { items: [bastards({ status: 'accepted' })] }).action, 'incoming')
  assert.equal(planOfferCapture(conv, { items: [] }).action, 'incoming')
  // His offer no longer stands (no «Acquista»): what remains is the refusal.
  const gone = counterPage({}, { buy: false })
  assert.equal(gone.standing, null)
  assert.deepEqual([planOfferCapture(gone, { items: [bastards()] }).action, planOfferCapture(gone, { items: [bastards()] }).status], ['outcome', 'declined'])
  // The user answers with a new request: the planned reply is now on Vinted, at the figure really typed.
  const replied = (price) => readConversation({ id: SB, link: '/items/8812345678-x', title: 'Southetn Bastards', price: '20,00 €', seller: 'ravafra', canOffer: true, offers: [
    { kind: 'request', price: '15,00 €', original: '22,00 €', status: 'Rifiutata', buy: false, buttons: [] },
    { kind: 'offer', price: '20,00 €', original: '22,00 €', status: '', buy: true, buttons: ['Acquista'] },
    { kind: 'request', price, original: '22,00 €', status: 'In sospeso', buy: false, buttons: [] },
  ] }, URL)
  assert.equal(replied('17,50 €').standing, null)
  assert.deepEqual([planOfferCapture(replied('17,50 €'), { items: [countered] }).action, planOfferCapture(replied('17,50 €'), { items: [countered] }).reprice], ['counter_sent', false])
  assert.deepEqual([planOfferCapture(replied('18,00 €'), { items: [countered] }).action, planOfferCapture(replied('18,00 €'), { items: [countered] }).reprice], ['counter_sent', true])
  // …and when that reply is refused while his offer still stands, the counter-offer is back on the table.
  const refusedAgain = readConversation({ id: SB, link: '/items/8812345678-x', title: 'Southetn Bastards', price: '20,00 €', seller: 'ravafra', offers: [
    { kind: 'offer', price: '20,00 €', original: '22,00 €', status: '', buy: true, buttons: ['Acquista'] },
    { kind: 'request', price: '17,50 €', original: '22,00 €', status: 'Rifiutata', buy: false, buttons: [] },
  ] }, URL)
  assert.equal(refusedAgain.standing.price, 20)
})

test('counter-offer: the reply plan is computed from the saved offer, as the planner would', () => {
  const now = new Date(2026, 10, 15, 23, 10)
  const input = counterRawFor(bastards(), 20, { previousOffer: 15 })
  assert.deepEqual([input.previousOffer, input.sellerCounter, input.listPrice, input.receivedAgo, input.channel], ['15', '20', '22', 'just_now', 'button'])
  assert.deepEqual(input.history.map((e) => [e.by, e.price]), [['buyer', 15], ['seller', 20]])
  const result = analyzeCounter(input, now, {})
  assert.equal(result.ok, true)
  assert.deepEqual([result.negotiation.previousOffer, result.negotiation.sellerCounter], [15, 20])
  assert.ok(result.recommended && (result.recommended.id === 'accept' || (result.recommended.price > 15 && result.recommended.price <= 20)), JSON.stringify(result.recommended))
  // Vinted's figure for the user's request wins over the saved one; a counter-offer not answered yet is replaced.
  assert.equal(counterRawFor(bastards(), 20, { previousOffer: 16 }).history[0].price, 16)
  const replaced = counterRawFor(bastards({ negotiation: [{ by: 'buyer', price: 15, at: '2026-11-15T20:38:20.000Z' }, { by: 'seller', price: 20 }] }), 19)
  assert.deepEqual(replaced.history.map((e) => [e.by, e.price]), [['buyer', 15], ['seller', 19]])
  // An offer saved without its form still gets a plan.
  assert.equal(analyzeCounter(counterRawFor(bastards({ form: null, category: 'books' }), 20), now, {}).ok, true)
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

test('conversation list: a bare figure is the seller\'s offer, also on an offer closed as refused', () => {
  // The real rows of 15 Nov: «ravafra · €20.00», «tomsr01 · €7.00».
  const row = [{ id: SB, seller: 'ravafra', text: '€20.00' }]
  const sent = planInboxRows(row, [bastards()])
  assert.deepEqual(sent.map((p) => [p.itemId, p.action, p.price, p.previousOffer]), [['sb', 'counter', 20, 15]])
  // The check the user asked for: among the closed ones, the refusal that came with a counter-offer.
  assert.deepEqual(planInboxRows(row, [bastards({ status: 'declined' })]).map((p) => [p.action, p.price]), [['counter', 20]])
  assert.deepEqual(planInboxRows(row, [bastards({ status: 'no_reply' })]).map((p) => p.action), ['counter'])
  // Already registered, a plan never sent, an accepted offer, another conversation, a figure that is not above the user's: nothing.
  assert.deepEqual(planInboxRows(row, [bastards({ status: 'countered', negotiation: [{ by: 'buyer', price: 15 }, { by: 'seller', price: 20 }] })]), [])
  assert.deepEqual(planInboxRows(row, [bastards({ status: 'planned' })]), [])
  assert.deepEqual(planInboxRows(row, [bastards({ status: 'accepted' })]), [])
  assert.deepEqual(planInboxRows(row, [bastards({ conversationId: 'altro' })]), [])
  assert.deepEqual(planInboxRows([{ id: SB, seller: 'ravafra', text: '€15.00' }], [bastards()]), [])
  // A new figure after one already registered is a new counter-offer; «20,00 €» reads the same.
  assert.equal(planInboxRows([{ id: SB, seller: 'ravafra', text: '19,00 €' }], [bastards({ status: 'countered', negotiation: [{ by: 'buyer', price: 15 }, { by: 'seller', price: 20 }] })])[0].price, 19)
  // A sentence with a figure is not a bare figure.
  assert.deepEqual(planInboxRows([{ id: SB, seller: 'ravafra', text: 'Te lo lascio a €20.00 se compri oggi' }], [bastards({ status: 'declined' })]), [])
})

test('vinted browser: a conversation is a code with dashes on the new pages', () => {
  assert.deepEqual(pageOf(URL), { type: 'conversation', id: CONV })
  assert.deepEqual(pageOf('https://www.vinted.it/inbox/987654'), { type: 'conversation', id: '987654' })
  assert.equal(pageOf('https://www.vinted.it/inbox').type, 'inbox')
  assert.equal(templateOf(URL), 'www.vinted.it/inbox/{id}?referrer')
})
