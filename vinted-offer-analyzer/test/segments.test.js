import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SEGMENTS, GROUPS, OUTCOME_REMINDER_HOURS, badgeCountOf, categoryLabelOf, closedOrder, estimateOf, groupOf, hostOf, inSegment, lastBuyerAt, linkIdOf,
  matchesQuery, momentLabel, nextStepOf, normalizeText, offerExpiryOf, openGroups, outcomeReminderTimes, outsideQuietHours, overflowSplit, relativeDayLabel,
  rowStateOf, sectionsFor, segmentCounts, segmentOf, shortDate, sinceLabel, timeLabelOf, whenLabel,
} from '../mobile/src/services/segments.js'

// Saturday 31 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 31, 10, 0)
const at = (d, h = 12, m = 0, month = 9) => new Date(2026, month, d, h, m)
const iso = (d) => d.toISOString()
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000)
const hoursAhead = (h) => new Date(NOW.getTime() + h * 3_600_000)

const base = (over = {}) => ({
  id: over.id || `it-${Math.random().toString(36).slice(2, 8)}`, title: 'Black hole di Charles Burns', link: 'https://www.vinted.it/items/10404231478-black-hole-di-charles-burns',
  category: 'collectible', listPrice: 22, targetPrice: 18, discountPct: 18.18, probability: 0.65, status: 'planned', sendAt: iso(hoursAhead(30)), windowLabel: 'Domenica sera',
  createdAt: iso(hoursAgo(5)), outcomeAt: null, sentAt: null, negotiation: [{ by: 'buyer', kind: 'offer', price: 18, at: iso(hoursAhead(30)), planned: true }], counterPlan: null, ...over,
})
const sent = (hAgo, over = {}) => base({ status: 'sent', sentAt: iso(hoursAgo(hAgo)), sendAt: iso(hoursAgo(hAgo + 1)), negotiation: [{ by: 'buyer', kind: 'offer', price: 18, at: iso(hoursAgo(hAgo)), planned: false }], ...over })
const closed = (status, outcomeHoursAgo, over = {}) => sent(outcomeHoursAgo + 20, { status, outcomeAt: iso(hoursAgo(outcomeHoursAgo)), firstOutcome: status, ...over })
const countered = (over = {}) => sent(50, {
  status: 'countered',
  negotiation: [{ by: 'buyer', kind: 'offer', price: 18, at: iso(hoursAgo(50)), planned: false }, { by: 'seller', kind: 'counter', price: 21, at: iso(hoursAgo(3)) }],
  counterPlan: { price: 19.5, accept: false, sentAt: null, sendAt: iso(hoursAhead(9)), pAccept: 0.41, windowLabel: 'Sabato sera' },
  ...over,
})

// The shape of the user's October list: 1 sent, 1 accepted, 1 bought, 9 declined, 1 sold to someone else.
const OCTOBER = [
  closed('bought', 1, { firstOutcome: null }), sent(300), closed('accepted', 400), ...Array.from({ length: 9 }, (_, i) => closed('declined', 48 + i * 30)), closed('sold_other', 470),
]

test('SEGMENTS: the four segments with the exact statuses', () => {
  assert.deepEqual(SEGMENTS.map((s) => s.id), ['open', 'won', 'lost', 'all'])
  assert.deepEqual(SEGMENTS[0].statuses, ['planned', 'sent', 'countered'])
  assert.deepEqual(SEGMENTS[1].statuses, ['accepted', 'bought'])
  assert.deepEqual(SEGMENTS[2].statuses, ['declined', 'no_reply', 'sold_other', 'abandoned'])
  assert.equal(SEGMENTS[3].statuses, null)
  assert.deepEqual(GROUPS.map((g) => g.id), ['update', 'todo', 'waiting'])
})

test('segmentOf uses the current status; unknown statuses fall back to «Tutte»', () => {
  assert.equal(segmentOf(base()), 'open')
  assert.equal(segmentOf(sent(2)), 'open')
  assert.equal(segmentOf(countered()), 'open')
  assert.equal(segmentOf(closed('accepted', 1)), 'won')
  assert.equal(segmentOf(closed('bought', 1)), 'won')
  // A deal closed after a counter: the first outcome is «countered» but the row sits in «Accettate».
  assert.equal(segmentOf(closed('accepted', 1, { firstOutcome: 'countered' })), 'won')
  for (const s of ['declined', 'no_reply', 'sold_other', 'abandoned']) assert.equal(segmentOf(closed(s, 1)), 'lost')
  assert.equal(segmentOf({ status: 'weird' }), 'all')
  assert.equal(segmentOf(null), 'all')
})

test('segmentCounts on the October list: 1 open, 2 won, 10 lost, 13 in all', () => {
  assert.deepEqual(segmentCounts(OCTOBER), { open: 1, won: 2, lost: 10, all: 13 })
  assert.deepEqual(segmentCounts([]), { open: 0, won: 0, lost: 0, all: 0 })
  assert.ok(inSegment(OCTOBER[1], 'open') && inSegment(OCTOBER[1], 'all') && !inSegment(OCTOBER[1], 'won'))
})

test('rowStateOf and groupOf: the three open groups are disjoint and closed rows have none', () => {
  assert.equal(rowStateOf(base(), NOW), 'planned_future')
  assert.equal(groupOf(base(), NOW), 'todo')
  assert.equal(rowStateOf(base({ sendAt: iso(hoursAgo(2)) }), NOW), 'planned_recent')
  assert.equal(groupOf(base({ sendAt: iso(hoursAgo(2)) }), NOW), 'todo')
  assert.equal(rowStateOf(base({ sendAt: iso(hoursAgo(30)) }), NOW), 'planned_stale')
  assert.equal(groupOf(base({ sendAt: iso(hoursAgo(30)) }), NOW), 'update')
  assert.equal(rowStateOf(sent(2), NOW), 'sent_waiting')
  assert.equal(groupOf(sent(2), NOW), 'waiting')
  assert.equal(rowStateOf(sent(30), NOW), 'sent_stale')
  assert.equal(groupOf(sent(30), NOW), 'update')
  assert.equal(rowStateOf(countered(), NOW), 'counter_pending')
  assert.equal(groupOf(countered(), NOW), 'todo')
  const accept = countered({ counterPlan: { price: null, accept: true, sentAt: null } })
  assert.equal(rowStateOf(accept, NOW), 'counter_accept')
  assert.equal(groupOf(accept, NOW), 'todo')
  assert.equal(groupOf(countered({ counterPlan: null }), NOW), 'todo') // no plan: still something to do
  for (const s of ['accepted', 'bought', 'declined', 'no_reply', 'sold_other', 'abandoned']) {
    assert.equal(rowStateOf(closed(s, 1), NOW), 'closed')
    assert.equal(groupOf(closed(s, 1), NOW), null)
  }
})

test('a planned row without a send moment (hand-edited backup) is «Da aggiornare», never a 1970 moment', () => {
  const noMoment = base({ sendAt: null, negotiation: [] })
  assert.equal(rowStateOf(noMoment, NOW), 'planned_stale')
  assert.equal(groupOf(noMoment, NOW), 'update')
  assert.equal(badgeCountOf([noMoment], NOW), 1)
  assert.equal(timeLabelOf(noMoment, NOW), '')
  const step = nextStepOf(noMoment, NOW)
  assert.equal(`${step.lead}${step.rest}`, "L'hai inviata? Segna com'è andata o lascia perdere")
  assert.deepEqual(openGroups([noMoment, base({ id: 'future' })], NOW).map((g) => [g.id, g.items.length]), [['update', 1], ['todo', 1]])
  // The row labels never turn a missing value into the epoch.
  for (const v of [null, undefined, '', 'not a date']) {
    assert.equal(relativeDayLabel(v, NOW), '')
    assert.equal(momentLabel(v, NOW), '')
    assert.equal(whenLabel(v, NOW), '')
    assert.equal(shortDate(v), '')
  }
  assert.equal(relativeDayLabel(at(31, 20).toISOString(), NOW), 'oggi') // ISO strings and Dates still read
  assert.equal(momentLabel(at(31, 21, 30).getTime(), NOW), 'oggi alle 21:30')
})

test('a sent row after our counter counts the silence from OUR last entry, not the first send', () => {
  const afterCounter = sent(100, {
    negotiation: [{ by: 'buyer', kind: 'offer', price: 18, at: iso(hoursAgo(100)), planned: false }, { by: 'seller', kind: 'counter', price: 21, at: iso(hoursAgo(60)) }, { by: 'buyer', kind: 'counter', price: 19.5, at: iso(hoursAgo(3)), planned: false, pAccept: 0.4 }],
    counterPlan: { price: 19.5, sentAt: iso(hoursAgo(3)) },
  })
  assert.equal(lastBuyerAt(afterCounter), hoursAgo(3).getTime())
  assert.equal(groupOf(afterCounter, NOW), 'waiting')
  assert.equal(estimateOf(afterCounter), 0.4)
  assert.equal(estimateOf(countered()), 0.41)
  assert.equal(estimateOf(sent(2)), 0.65)
  assert.equal(estimateOf(closed('declined', 1, { negotiation: [{ by: 'buyer', price: 18, at: iso(hoursAgo(30)) }, { by: 'seller', price: 21, at: iso(hoursAgo(10)) }] })), null)
})

test('badgeCountOf = Da aggiornare + Da fare, never the waiting or closed rows', () => {
  const items = [base(), base({ sendAt: iso(hoursAgo(30)) }), sent(2), sent(30), countered(), closed('declined', 1), closed('accepted', 1)]
  assert.equal(badgeCountOf(items, NOW), 4)
  assert.equal(badgeCountOf(OCTOBER, NOW), 1) // the one sent on 18 October, long silent
  assert.equal(badgeCountOf([], NOW), 0)
  assert.equal(badgeCountOf(undefined, NOW), 0)
})

test('openGroups: update oldest first, todo by moment ascending (overdue first), waiting most recent first', () => {
  const items = [
    base({ id: 'todo-late', sendAt: iso(hoursAgo(2)) }), base({ id: 'todo-soon', sendAt: iso(hoursAhead(5)) }), base({ id: 'todo-far', sendAt: iso(hoursAhead(40)) }),
    countered({ id: 'todo-counter', counterPlan: { price: 19.5, accept: false, sentAt: null, sendAt: iso(hoursAhead(9)) } }),
    sent(30, { id: 'upd-30' }), sent(100, { id: 'upd-100' }), base({ id: 'upd-planned', sendAt: iso(hoursAgo(50)) }),
    sent(2, { id: 'wait-2' }), sent(10, { id: 'wait-10' }),
    closed('declined', 1, { id: 'closed' }),
  ]
  const groups = openGroups(items, NOW)
  assert.deepEqual(groups.map((g) => g.id), ['update', 'todo', 'waiting'])
  assert.deepEqual(groups[0].items.map((it) => it.id), ['upd-100', 'upd-planned', 'upd-30'])
  assert.deepEqual(groups[1].items.map((it) => it.id), ['todo-late', 'todo-soon', 'todo-counter', 'todo-far'])
  assert.deepEqual(groups[2].items.map((it) => it.id), ['wait-2', 'wait-10'])
  assert.equal(groups[0].label, 'Da aggiornare')
  assert.equal(groups[1].label, 'Da fare')
  assert.equal(groups[2].label, 'In attesa di risposta')
  // Empty groups disappear.
  assert.deepEqual(openGroups([sent(2)], NOW).map((g) => g.id), ['waiting'])
})

test('sectionsFor: closed segments by last change, «Tutte» = open groups then «Concluse»', () => {
  const items = [closed('declined', 5, { id: 'd5' }), closed('declined', 1, { id: 'd1' }), closed('accepted', 3, { id: 'a3' }), closed('accepted', 2, { id: 'a2', outcomeAt: null, createdAt: iso(hoursAgo(2)) }), sent(2, { id: 's' }), base({ id: 'p' })]
  assert.deepEqual(sectionsFor(items, 'lost', NOW).map((s) => s.items.map((it) => it.id)), [['d1', 'd5']])
  assert.equal(sectionsFor(items, 'lost', NOW)[0].label, null)
  assert.deepEqual(sectionsFor(items, 'won', NOW)[0].items.map((it) => it.id), ['a2', 'a3']) // createdAt is the fallback
  const all = sectionsFor(items, 'all', NOW)
  assert.deepEqual(all.map((s) => s.id), ['todo', 'waiting', 'closed'])
  assert.equal(all[2].label, 'Concluse')
  assert.deepEqual(all[2].items.map((it) => it.id), ['d1', 'a2', 'a3', 'd5'])
  assert.deepEqual(sectionsFor(items, 'open', NOW).map((s) => s.id), ['todo', 'waiting'])
  assert.deepEqual(sectionsFor([], 'won', NOW), [])
  assert.deepEqual(closedOrder([]), [])
})

test('matchesQuery: title (accent-insensitive), prices, category label, host, link id, every word must hit', () => {
  const item = base({ title: 'Melville – storia di Samuel Beauclair', listPrice: 9, targetPrice: 7.5, category: 'electronics', link: 'https://www.vinted.it/items/10178113788-melville' })
  assert.equal(matchesQuery(item, ''), true)
  assert.equal(matchesQuery(item, '   '), true)
  assert.equal(matchesQuery(item, 'MELVILLE'), true)
  assert.equal(matchesQuery(item, 'beauclàir'), true)
  assert.equal(matchesQuery(item, 'samuel storia'), true) // order-free AND
  assert.equal(matchesQuery(item, 'samuel pippo'), false)
  assert.equal(matchesQuery(item, '9'), true)
  assert.equal(matchesQuery(item, '9 €'), true)
  assert.equal(matchesQuery(item, '7,5'), true)
  assert.equal(matchesQuery(item, '7.5'), true)
  assert.equal(matchesQuery(item, '7,50 €'), true)
  assert.equal(matchesQuery(item, 'elettronica'), true)
  assert.equal(matchesQuery(item, 'Elettrònica'), true)
  assert.equal(matchesQuery(item, 'vinted.it'), true)
  assert.equal(matchesQuery(item, '10178113788'), true)
  assert.equal(matchesQuery(item, 'sneakers'), false)
  assert.equal(matchesQuery(base({ title: '', link: '', listPrice: null, targetPrice: undefined, category: null }), 'x'), false)
})

test('normalizeText, hostOf, linkIdOf, categoryLabelOf', () => {
  assert.equal(normalizeText('Perù È CAFFÈ'), 'peru e caffe')
  assert.equal(normalizeText(null), '')
  assert.equal(hostOf('https://www.vinted.it/items/123-x'), 'vinted.it')
  assert.equal(hostOf('vinted.it/items/123'), 'vinted.it')
  assert.equal(hostOf('http://subito.it/a?b=c'), 'subito.it')
  assert.equal(hostOf(''), '')
  assert.equal(hostOf(null), '')
  assert.equal(linkIdOf('https://www.vinted.it/items/10404231478-black-hole'), '10404231478')
  assert.equal(linkIdOf('https://www.vinted.it/member/1'), '')
  assert.equal(categoryLabelOf('collectible'), 'Collezionismo')
  assert.equal(categoryLabelOf('nope'), '')
})

test('short labels: shortDate, relativeDayLabel, sinceLabel, whenLabel, momentLabel', () => {
  assert.equal(shortDate(at(12, 9)), '12 ott')
  assert.equal(shortDate(at(3, 9, 0, 0)), '3 gen')
  assert.equal(shortDate(at(1, 9, 0, 8)), '1 set')
  assert.equal(shortDate('not a date'), '')
  assert.equal(relativeDayLabel(at(31, 20), NOW), 'oggi')
  assert.equal(relativeDayLabel(at(1, 20, 0, 10), NOW), 'domani')
  assert.equal(relativeDayLabel(at(30, 20), NOW), 'ieri')
  assert.equal(relativeDayLabel(at(28, 20), NOW), '3 giorni fa')
  assert.equal(relativeDayLabel(at(4, 20, 0, 10), NOW), 'tra 4 giorni')
  assert.equal(sinceLabel(hoursAgo(0.5), NOW), 'da pochi minuti')
  assert.equal(sinceLabel(hoursAgo(1), NOW), 'da 1 ora')
  assert.equal(sinceLabel(hoursAgo(5), NOW), 'da 5 ore')
  assert.equal(sinceLabel(hoursAgo(26), NOW), 'da 1 giorno')
  assert.equal(sinceLabel(hoursAgo(72), NOW), 'da 3 giorni')
  assert.equal(sinceLabel(null, NOW), '')
  assert.equal(whenLabel(at(31, 8, 5), NOW), 'oggi alle 08:05')
  assert.equal(whenLabel(at(30, 20, 45), NOW), 'ieri alle 20:45')
  assert.equal(whenLabel(at(28, 20, 45), NOW), '3 giorni fa')
  assert.equal(momentLabel(at(31, 21, 30), NOW), 'oggi alle 21:30')
  assert.equal(momentLabel(at(1, 21, 30, 10), NOW), 'domani alle 21:30')
  assert.equal(momentLabel(at(2, 21, 30, 10), NOW), 'lunedì 2 novembre alle 21:30')
})

test('timeLabelOf per state', () => {
  assert.equal(timeLabelOf(base({ sendAt: iso(at(1, 21, 30, 10)) }), NOW), 'domani')
  assert.equal(timeLabelOf(base({ sendAt: iso(at(28, 21, 30)) }), NOW), '3 giorni fa')
  assert.equal(timeLabelOf(sent(5), NOW), 'da 5 ore')
  assert.equal(timeLabelOf(sent(50), NOW), 'da 2 giorni')
  assert.equal(timeLabelOf(countered({ counterPlan: { price: 19.5, sentAt: null, sendAt: iso(at(31, 21)) } }), NOW), 'oggi')
  assert.equal(timeLabelOf(closed('declined', 1, { outcomeAt: iso(at(12, 9)) }), NOW), '12 ott')
  assert.equal(timeLabelOf(closed('declined', 1, { outcomeAt: null }), NOW), '')
})

test('nextStepOf: one sentence per state, none for closed rows', () => {
  const step = (item) => { const s = nextStepOf(item, NOW); return s ? `${s.lead}${s.rest}` : s }
  assert.equal(step(base({ sendAt: iso(at(1, 21, 30, 10)) })), 'Invia domani alle 21:30 · domenica sera')
  assert.equal(step(base({ sendAt: iso(at(1, 21, 30, 10)), windowLabel: null })), 'Invia domani alle 21:30')
  assert.equal(step(base({ sendAt: iso(hoursAgo(2)) })), "Finestra passata: invia ora o segna l'esito")
  assert.equal(step(base({ sendAt: iso(hoursAgo(30)) })), "L'hai inviata? Segna com'è andata o lascia perdere")
  assert.equal(step(countered({ counterPlan: { price: 19.5, accept: false, sentAt: null, sendAt: iso(at(31, 21)) } })), 'Rispondi con 19,50 € · oggi alle 21:00')
  assert.equal(step(countered({ counterPlan: { price: 19.5, accept: false, sentAt: null, sendAt: iso(hoursAgo(1)) } })), 'Momento passato: ricalcola la risposta')
  assert.equal(step(countered({ counterPlan: { price: null, accept: true, sentAt: null } })), 'Conviene comprare alla sua cifra: compra, poi segna Accettata')
  assert.equal(step(countered({ counterPlan: null })), 'Ha fatto una controproposta: ricalcola la risposta')
  const sentToday = sent(2, { sentAt: iso(at(31, 8, 0)), negotiation: [{ by: 'buyer', price: 18, at: iso(at(31, 8, 0)), planned: false }] })
  assert.equal(step(sentToday), 'Inviata oggi alle 08:00: aspetta la risposta (scade domani alle 08:00)')
  const sentLastNight = sent(2, { sentAt: iso(at(30, 22, 0)), negotiation: [{ by: 'buyer', price: 18, at: iso(at(30, 22, 0)), planned: false }] })
  assert.equal(step(sentLastNight), 'Inviata ieri alle 22:00: aspetta la risposta (scade alle 22:00)')
  const afterCounter = sent(100, {
    negotiation: [{ by: 'buyer', price: 18, at: iso(hoursAgo(100)), planned: false }, { by: 'seller', price: 21, at: iso(hoursAgo(60)) }, { by: 'buyer', kind: 'counter', price: 19.5, at: iso(hoursAgo(3)), planned: false }],
  })
  assert.equal(step(afterCounter), 'Hai proposto 19,50 €: aspetta la risposta')
  assert.equal(step(sent(30)), "Scaduta da 1 giorno: com'è andata?")
  assert.equal(step(sent(72)), "Scaduta da 3 giorni: com'è andata?")
  assert.equal(step(sent(24 * 7 + 1)), "Scaduta da 7 giorni: com'è andata? · senza risposta conta come rifiuto")
  for (const s of ['accepted', 'bought', 'declined', 'no_reply', 'sold_other', 'abandoned']) assert.equal(step(closed(s, 1)), null)
})

test('overflowSplit: a list over the storage cap sheds its oldest closed rows first, never an open one', () => {
  const pad = 'x'.repeat(400)
  const items = [
    base({ id: 'open-planned', pad }), sent(2, { id: 'open-sent', pad }), countered({ id: 'open-countered', pad }),
    closed('declined', 10, { id: 'd-10', pad }), closed('accepted', 300, { id: 'a-300', pad }), closed('bought', 50, { id: 'b-50', pad, outcomeAt: null, createdAt: iso(hoursAgo(50)) }),
    closed('no_reply', 200, { id: 'n-200', pad }), closed('sold_other', 1, { id: 's-1', pad }), closed('abandoned', 100, { id: 'ab-100', pad }),
  ]
  const full = JSON.stringify(items).length
  // Fits: the very same array back, nothing moved.
  const same = overflowSplit(items, full)
  assert.equal(same.keep, items)
  assert.deepEqual(same.moved, [])
  // One row too many: the single oldest closed row goes (accepted 300 h ago), and the rest fits exactly.
  const one = overflowSplit(items, full - 1)
  assert.deepEqual(one.moved.map((it) => it.id), ['a-300'])
  assert.deepEqual(one.keep.map((it) => it.id), items.filter((it) => it.id !== 'a-300').map((it) => it.id))
  assert.ok(JSON.stringify(one.keep).length <= full - 1)
  // A much smaller cap: closed rows leave by outcome time ascending (creation time when there is none) until it fits.
  const sizeOf = (it) => JSON.stringify(it).length + 1 // the item and its comma inside the array
  const cap = full - ['a-300', 'n-200', 'ab-100', 'b-50'].reduce((s, id) => s + sizeOf(items.find((it) => it.id === id)), 0)
  const small = overflowSplit(items, cap)
  assert.deepEqual(small.moved.map((it) => it.id), ['a-300', 'n-200', 'ab-100', 'b-50'])
  assert.equal(JSON.stringify(small.keep).length, cap) // fits exactly: the per-item sizes add up to the array's JSON
  assert.ok(JSON.stringify([...small.keep, small.moved[3]]).length > cap) // minimal: one fewer moved would not fit
  // Open rows are never moved, even when the cap cannot be met: everything closed goes, the open rows stay.
  const floor = overflowSplit(items, 10)
  assert.deepEqual(floor.keep.map((it) => it.id), ['open-planned', 'open-sent', 'open-countered'])
  assert.deepEqual(floor.moved.map((it) => it.id), ['a-300', 'n-200', 'ab-100', 'b-50', 'd-10', 's-1'])
  assert.deepEqual(overflowSplit([], 10), { keep: [], moved: [] })
  assert.deepEqual(overflowSplit(null, 10), { keep: [], moved: [] })
})

test('offerExpiryOf: 24 h after the real send, null before', () => {
  assert.equal(offerExpiryOf(base()), null)
  assert.equal(offerExpiryOf(sent(2)).getTime(), hoursAgo(2).getTime() + 24 * 3_600_000)
})

test('outcome reminders: +36 h and +7 d, moved out of the quiet hours (23:00–07:00)', () => {
  assert.deepEqual(OUTCOME_REMINDER_HOURS, [36, 168])
  assert.equal(outsideQuietHours(at(10, 12, 0)).getTime(), at(10, 12, 0).getTime())
  assert.equal(outsideQuietHours(at(10, 22, 59)).getTime(), at(10, 22, 59).getTime())
  assert.equal(outsideQuietHours(at(10, 23, 0)).getTime(), at(11, 7, 0).getTime())
  assert.equal(outsideQuietHours(at(10, 23, 30)).getTime(), at(11, 7, 0).getTime())
  assert.equal(outsideQuietHours(at(10, 3, 0)).getTime(), at(10, 7, 0).getTime())
  assert.equal(outsideQuietHours(at(10, 6, 59)).getTime(), at(10, 7, 0).getTime())
  assert.equal(outsideQuietHours(at(10, 7, 0)).getTime(), at(10, 7, 0).getTime())
  // Sent Sunday 18 October 20:45 → +36 h = Tuesday 08:45 (kept), +7 d = Sunday 25 October 20:45 (kept).
  const times = outcomeReminderTimes(at(18, 20, 45))
  assert.deepEqual(times.map((d) => d.getTime()), [at(20, 8, 45).getTime(), at(25, 20, 45).getTime()])
  // Sent at 20:00 → +36 h = 08:00 kept; sent at 12:00 → +36 h = 00:00 → 07:00 the same morning.
  assert.equal(outcomeReminderTimes(at(10, 12, 0))[0].getTime(), at(12, 7, 0).getTime())
  assert.deepEqual(outcomeReminderTimes(null), [])
  assert.deepEqual(outcomeReminderTimes('garbage'), [])
})
