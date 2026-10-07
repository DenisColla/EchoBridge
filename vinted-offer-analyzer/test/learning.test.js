import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import {
  DEFAULT_PROFILE, EXPLORATION_ARMS, LEARNING, LEARNING_DISCOUNT_KNOTS, LEARNING_TIME_GROUPS, analyzeCounter, analyzeOffer, buildDataset, buildXlsx,
  calibrationMetrics, counterAnalytics, decisionSnapshot, isoAcceptanceDiscount, timeWindowAt, defaultDiscountFor, discKnotOf, discKnotWeights, discOffset, dueMonths, explorationBudget,
  explorationKey, explorationPlan, failureRiskFor, fitCorrection, fitFirstOffers, kaplanMeier, learnedOfferRow, learningRecord, monotoneDisc,
  monthKeyOf, monthLabel, monthlyReport, normalizeProfile, optimalDiscount, pickMoments, normalizeInput, predictWith, profileIsActive, proposeProfile,
  reportFileName, reportWorkbook, scoreAt, shiftMonth, squash, timeGroupOf, unsquash, xlsxBase64, xlsxColumn, xlsxCrc32, xlsxDateSerial, xlsxEscape,
  xlsxSheetName, xlsxUtf8,
} from '../src/core/index.js'

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} (±${tol})`)
const FORM = { itemTitle: 'Nike Air Force 1', category: 'sneakers', listPrice: '60', targetPrice: '45', listingAge: 'weeks_1_2', sellerProfile: 'unknown', listingSignal: 'none', link: 'https://www.vinted.it/items/1' }
const NOW = new Date(2026, 9, 7, 15, 0)

/** Reads a STORED zip (what buildXlsx writes) back into { name: text }, checking every CRC. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const files = {}
  let p = 0
  while (view.getUint32(p, true) === 0x04034b50) {
    const method = view.getUint16(p + 8, true)
    const crc = view.getUint32(p + 14, true)
    const size = view.getUint32(p + 18, true)
    const nameLen = view.getUint16(p + 26, true)
    const extra = view.getUint16(p + 28, true)
    const name = Buffer.from(bytes.subarray(p + 30, p + 30 + nameLen)).toString('utf8')
    const start = p + 30 + nameLen + extra
    let data = bytes.subarray(start, start + size)
    if (method === 8) data = inflateRawSync(data)
    assert.equal(xlsxCrc32(data), crc, `crc of ${name}`)
    files[name] = Buffer.from(data).toString('utf8')
    p = start + size
  }
  assert.equal(view.getUint32(p, true), 0x02014b50, 'central directory follows the entries')
  return files
}

/** Deterministic synthetic history: `months` months of `perMonth` offers whose true acceptance is the engine's + `shift`. */
/** mulberry32: a small PRNG whose successive draws are not correlated (an LCG's are, and biased these tests). */
const mulberry32 = (seed) => {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function syntheticItems({ months = 6, perMonth = 10, shift = 0, startMonth = 3, seed = 7 } = {}) {
  const rnd = mulberry32(seed)
  const cats = ['sneakers', 'fast_fashion', 'electronics', 'kids', 'other']
  const items = []
  for (let m = 0; m < months; m++) {
    for (let j = 0; j < perMonth; j++) {
      const created = new Date(2026, startMonth + m, 2 + j * 2, 18, 0)
      const list = [15, 25, 40, 60, 90][j % 5]
      const disc = 12 + Math.floor(rnd() * 20)
      const form = { ...FORM, itemTitle: `Articolo ${m}-${j}`, category: cats[j % 5], listPrice: String(list), targetPrice: String(Math.round(list * (1 - disc / 100))), link: `https://www.vinted.it/items/${m}${j}` }
      const res = analyzeOffer(form, created)
      if (!res.ok || res.kind !== 'analysis') continue
      const sentAt = res.optimal.date
      const pTrue = res.optimal.pAvailable * res.optimal.pRead * squash(res.optimal.score.logit + shift)
      const u = rnd()
      const negotiation = [{ by: 'buyer', kind: 'offer', price: res.input.targetPrice, at: sentAt.toISOString(), planned: false }]
      let status
      let firstOutcome
      let finalPrice = null
      if (u < pTrue) {
        status = 'accepted'; firstOutcome = 'accepted'; finalPrice = res.input.targetPrice
      } else if (u < pTrue + 0.35) {
        firstOutcome = 'countered'
        const S = Math.min(list, Math.round(res.input.targetPrice * 1.3 * 100) / 100)
        const sAt = new Date(sentAt.getTime() + 3 * 3600e3)
        negotiation.push({ by: 'seller', kind: 'counter', price: S, at: sAt.toISOString() })
        const ours = Math.round(((res.input.targetPrice + S) / 2) * 100) / 100
        negotiation.push({ by: 'buyer', kind: 'counter', price: ours, at: new Date(sAt.getTime() + 5 * 3600e3).toISOString(), pAccept: 0.5, pRead: 1 })
        if (rnd() < 0.45) { status = 'accepted'; finalPrice = ours } else status = 'declined'
      } else {
        status = rnd() < 0.5 ? 'declined' : 'no_reply'; firstOutcome = status
      }
      items.push({
        id: `i${m}-${j}`, schema: 3, createdAt: created.toISOString(), title: form.itemTitle, link: form.link, category: form.category, listPrice: list, targetPrice: res.input.targetPrice,
        discountPct: res.input.discountPct, sendAt: sentAt.toISOString(), probability: res.probability, status, firstOutcome, finalPrice, sentAt: sentAt.toISOString(),
        outcomeAt: new Date(sentAt.getTime() + 86400e3).toISOString(), form, negotiation, decision: decisionSnapshot(res, { now: created }),
      })
    }
  }
  return items
}

/* ───────── xlsx writer ───────── */

test('xlsx: byte helpers match Node (UTF-8, base64, CRC-32)', () => {
  const text = 'Prezzo 45,50 € · àèìòù · 🎉 "x" <y> & z'
  assert.deepEqual(Buffer.from(xlsxUtf8(text)), Buffer.from(text, 'utf8'))
  for (const n of [0, 1, 2, 3, 4, 5, 255, 1000]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256)
    assert.equal(xlsxBase64(bytes), Buffer.from(bytes).toString('base64'), `length ${n}`)
  }
  assert.equal(xlsxCrc32(xlsxUtf8('123456789')), 0xcbf43926)
  // A lone surrogate (an emoji cut in half) must never reach the file as invalid UTF-8.
  assert.deepEqual(Buffer.from(xlsxUtf8('a\uD83Db')), Buffer.from('a\uFFFDb', 'utf8'))
  assert.equal(xlsxEscape('borsa \uD83D'), 'borsa ')
})

test('xlsx: columns, sheet names, escaping, date serials', () => {
  assert.deepEqual([0, 25, 26, 51, 52, 701, 702].map(xlsxColumn), ['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA'])
  const used = new Set()
  assert.equal(xlsxSheetName('Offerte/[ottobre]: tutte le trattative chiuse', used).length <= 31, true)
  assert.equal(xlsxSheetName('Riepilogo', used), 'Riepilogo')
  assert.equal(xlsxSheetName('riepilogo', used), 'riepilogo (2)')
  assert.equal(xlsxEscape('a<b>&"c"\u0001'), 'a&lt;b&gt;&amp;&quot;c&quot;')
  assert.equal(xlsxDateSerial(new Date(1900, 0, 1)), 2)
  near(xlsxDateSerial(new Date(2026, 9, 5, 18, 0)), 46300.75, 1e-9)
  assert.equal(xlsxDateSerial('2026-10-31'), xlsxDateSerial(new Date(2026, 9, 31)), 'a date-only string is a local day')
})

test('xlsx: the workbook is a valid package with typed cells, frozen header and filter', () => {
  const bytes = buildXlsx([
    { name: 'Riepilogo', title: 'Report', note: 'nota & co', columns: [{ header: 'Voce' }, { header: 'Valore' }], rows: [['Offerte', 12], ['Tasso', { value: 0.42, format: 'pct' }], ['Vuoto', null]] },
    { name: 'Offerte', columns: [{ header: 'Data', format: 'datetime' }, { header: 'Prezzo', format: 'eur' }, { header: 'Ok' }], rows: [[new Date(2026, 9, 5, 21, 30), 45.5, true]] },
  ], { title: 'T', creator: 'C', date: new Date(2026, 10, 1, 9) })
  const files = unzip(bytes)
  assert.deepEqual(Object.keys(files), ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'docProps/app.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'])
  assert.match(files['xl/workbook.xml'], /<sheet name="Riepilogo" sheetId="1" r:id="rId1"\/><sheet name="Offerte" sheetId="2" r:id="rId2"\/>/)
  const s1 = files['xl/worksheets/sheet1.xml']
  assert.match(s1, /<pane ySplit="4" topLeftCell="A5"/)
  assert.match(s1, /<c r="B6" s="3"><v>0.42<\/v><\/c>/)
  assert.match(s1, /nota &amp; co/)
  assert.ok(!/r="B7"/.test(s1), 'empty values produce no cell')
  const s2 = files['xl/worksheets/sheet2.xml']
  assert.match(s2, /<c r="A2" s="4"><v>46300\.895833/)
  assert.match(s2, /<c r="B2" s="2"><v>45.5<\/v><\/c>/)
  assert.match(s2, /<c r="C2" t="b"><v>1<\/v><\/c>/)
  assert.match(s2, /<autoFilter ref="A1:C2"\/>/)
  assert.match(files['xl/workbook.xml'], /<definedName name="_xlnm\._FilterDatabase" localSheetId="1" hidden="1">'Offerte'!\$A\$1:\$C\$2<\/definedName>/)
})

/* ───────── profile injection ───────── */

test('profile: absent or default changes nothing; an active one adds one learned row', () => {
  assert.equal(profileIsActive(null), false)
  assert.equal(profileIsActive(DEFAULT_PROFILE), false)
  const base = analyzeOffer(FORM, NOW)
  const same = analyzeOffer(FORM, NOW, { profile: DEFAULT_PROFILE })
  assert.equal(same.probability, base.probability)
  assert.equal(same.optimal.date.getTime(), base.optimal.date.getTime())
  assert.ok(!same.optimal.score.factors.some((f) => f.id === 'learned'))
  const tough = normalizeProfile({ intercept: -0.4 })
  const r = analyzeOffer(FORM, NOW, { profile: tough })
  assert.ok(r.probability < base.probability - 0.03, `${r.probability} vs ${base.probability}`)
  const row = r.optimal.score.factors.find((f) => f.id === 'learned')
  near(row.weight, -0.4, 1e-9)
  near(r.optimal.score.rawLogit + row.weight, r.optimal.score.logit, 1e-9)
  assert.ok(r.factors.rows.some((f) => f.id === 'learned' && f.deltaPoints < 0))
})

test('profile: time-group offsets move the recommended moment toward the group that works for this user', () => {
  const evenings = analyzeOffer(FORM, NOW)
  assert.equal(timeGroupOf(evenings.optimal.score.timeWindow.id), 'prime_evening')
  const r = analyzeOffer(FORM, NOW, { profile: normalizeProfile({ time: { prime_evening: -0.6, weekend: 0.6 } }) })
  assert.equal(timeGroupOf(r.optimal.score.timeWindow.id), 'weekend')
})

test('profile: normalisation clamps every value to its bounds and the default discount to [10, 30]', () => {
  const p = normalizeProfile({ intercept: 9, slope: 0, time: { night: -5 }, disc: { d30: 'x' }, counter: -3, counterShare: 5, sellerReplyHours: 100, discountPct: 80 })
  assert.equal(p.intercept, LEARNING.BOUNDS.intercept[1])
  assert.equal(p.slope, LEARNING.BOUNDS.slope[0])
  assert.equal(p.time.night, LEARNING.BOUNDS.time[0])
  assert.equal(p.disc.d30, 0)
  assert.equal(p.counter, LEARNING.BOUNDS.counter[0])
  assert.equal(p.counterShare, LEARNING.BOUNDS.share[1])
  assert.equal(p.sellerReplyHours, LEARNING.BOUNDS.latency[1])
  assert.equal(defaultDiscountFor(p), 30)
  assert.equal(defaultDiscountFor(null), 20)
  assert.equal(learnedOfferRow(DEFAULT_PROFILE, { logit: 0, windowId: 'night', discountPct: 20 }), null)
})

test('profile: the discount correction is a monotone curve through 10/20/30%, never a step', () => {
  assert.deepEqual(discKnotWeights(5), { d10: 1, d20: 0, d30: 0 })
  assert.deepEqual(discKnotWeights(25), { d10: 0, d20: 0.5, d30: 0.5 })
  assert.deepEqual(discKnotWeights(38), { d10: 0, d20: 0, d30: 1 })
  assert.equal(discKnotOf(14.9), 'd10')
  const P = normalizeProfile({ disc: { d10: -0.3, d20: 0, d30: 0.3 } })
  near(discOffset(P, 15), (P.disc.d10 + P.disc.d20) / 2, 1e-12)
  // The corrected acceptance keeps falling as the discount grows, on a fine grid.
  const input = normalizeInput(FORM).input
  const at = new Date(2026, 9, 8, 21, 40)
  let prevP = Infinity
  for (let d = 5; d <= 40; d += 0.5) {
    const z0 = scoreAt({ ...input, discountPct: d, targetPrice: 60 * (1 - d / 100) }, at, 0).rawLogit
    const p = squash(P.slope * z0 + P.intercept + discOffset(P, d))
    assert.ok(p <= prevP + 1e-9, `p rises at ${d}%`)
    prevP = p
  }
  const steep = monotoneDisc({ d10: -0.6, d20: 0.6, d30: 0.6 }, 1)
  assert.ok(steep.d20 - steep.d10 <= LEARNING.DISC_MONOTONE_MARGIN * 10 * LEARNING.DISC_MIN_ENGINE_SLOPE + 1e-9)
})

test('profile: the counter correction reaches the counter engine', () => {
  const raw = { ...FORM, previousOffer: '45', sellerCounter: '58,50', offerSentAt: new Date(2026, 9, 13, 21, 35), receivedAt: new Date(2026, 9, 13, 21, 40) }
  const now = new Date(2026, 9, 13, 21, 45)
  const a = analyzeCounter(raw, now)
  const b = analyzeCounter(raw, now, { profile: normalizeProfile({ counter: -0.5 }) })
  const pa = a.options.find((o) => o.id === 'balanced')
  const pb = b.options.find((o) => o.id === 'balanced')
  assert.ok(pb.learning && Number.isFinite(pb.learning.rawLogit))
  if (Math.abs(pa.price - pb.price) < 0.01) assert.ok(pb.pAccept < pa.pAccept - 0.05, `${pb.pAccept} vs ${pa.pAccept}`)
  near(pb.learning.learnedWeight, -0.5 + 0, 0.61)
})

test('scheduler: an exact send moment is scored as its own slot and chosen', () => {
  const input = normalizeInput(FORM).input
  const exact = new Date(2026, 9, 8, 22, 33)
  const m = pickMoments(input, NOW, { exactSendAt: exact })
  assert.equal(m.chosen.date.getTime(), new Date(2026, 9, 8, 22, 35).getTime())
  assert.equal(m.pinned, true)
})

/* ───────── months ───────── */

test('months: keys, labels, catch-up', () => {
  assert.equal(monthKeyOf(new Date(2026, 0, 31, 23, 59)), '2026-01')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(monthLabel('2026-10'), 'ottobre 2026')
  assert.deepEqual(dueMonths(null, NOW), [])
  assert.deepEqual(dueMonths('2026-09', NOW), [])
  assert.deepEqual(dueMonths('2026-08', NOW), ['2026-09'])
  assert.deepEqual(dueMonths('2025-01', NOW, 3), ['2026-07', '2026-08', '2026-09'])
})

/* ───────── dataset ───────── */

test('dataset: first outcome, implicit no-reply, rounds and final state', () => {
  const sent = new Date(2026, 8, 3, 21, 30)
  const base = { id: 'a', createdAt: new Date(2026, 8, 3, 12).toISOString(), listPrice: 60, targetPrice: 45, discountPct: 25, form: FORM, sentAt: sent.toISOString(), sendAt: sent.toISOString(), probability: 0.5 }
  const now = new Date(2026, 9, 1, 9)
  assert.equal(learningRecord({ ...base, status: 'planned', sentAt: null }, now), null)
  const acc = learningRecord({ ...base, status: 'accepted', firstOutcome: 'accepted', finalPrice: 45 }, now)
  assert.equal(acc.y, 1)
  assert.equal(acc.closed, true)
  assert.equal(acc.savingEur, 15)
  const quiet = learningRecord({ ...base, status: 'sent' }, now)
  assert.equal(quiet.first, 'no_reply')
  assert.equal(quiet.implicit, true)
  assert.equal(quiet.lost, true)
  const fresh = learningRecord({ ...base, status: 'sent' }, new Date(2026, 8, 5))
  assert.equal(fresh.y, null)
  assert.equal(fresh.pending, true)
  const abandoned = learningRecord({ ...base, status: 'abandoned', firstOutcome: 'abandoned' }, now)
  assert.equal(abandoned.y, null)
  assert.equal(abandoned.lost, true)
  const negotiation = [
    { by: 'buyer', price: 45, at: sent.toISOString() },
    { by: 'seller', price: 58.5, at: new Date(sent.getTime() + 2 * 3600e3).toISOString() },
    { by: 'buyer', price: 51.7, at: new Date(sent.getTime() + 24 * 3600e3).toISOString(), pAccept: 0.52, pRead: 1 },
  ]
  const won = learningRecord({ ...base, negotiation, status: 'accepted', firstOutcome: 'countered', finalPrice: 51.7 }, now)
  assert.equal(won.y, 0)
  assert.equal(won.rounds.length, 1)
  const r = won.rounds[0]
  near(r.sellerRaisePct, 30, 1e-9)
  near(r.sellerGapShare, 0.1, 1e-9)
  near(r.latencyH, 2, 1e-9)
  near(r.replyGapShare, 6.7 / 13.5, 1e-9)
  assert.equal(r.replyAccepted, true)
  near(r.replyRawLogit, unsquash(0.52), 1e-9)
  const raisedAgain = learningRecord({ ...base, negotiation: [...negotiation, { by: 'seller', price: 56, at: now.toISOString() }], status: 'countered', firstOutcome: 'countered' }, now)
  assert.equal(raisedAgain.rounds[0].replyAccepted, false)
  assert.equal(raisedAgain.rounds.length, 2)
})

test('dataset: an item created from the counter screen counts for negotiations, not for first-offer calibration', () => {
  const at = new Date(2026, 8, 10, 22, 0).toISOString()
  const rec = learningRecord({
    id: 'c', createdAt: at, listPrice: 60, targetPrice: 45, form: FORM, status: 'countered', firstOutcome: 'countered', sentAt: null, sendAt: new Date(2026, 8, 11, 21, 5).toISOString(),
    negotiation: [{ by: 'buyer', kind: 'offer', price: 45, at: null, planned: false }, { by: 'seller', kind: 'counter', price: 58.5, rawPrice: 58.5, at }],
  }, new Date(2026, 8, 11))
  assert.equal(rec.sentKnown, false)
  assert.equal(rec.y, null)
  assert.equal(rec.month, '2026-09')
  assert.equal(rec.rounds.length, 1)
  assert.equal(rec.rounds[0].latencyH, null, 'no fake reply time')
})

test('dataset: re-scores the first offer at the real send time with the current engine', () => {
  const late = new Date(2026, 8, 9, 13, 0) // weekday lunch, not the recommended evening
  const rec = learningRecord({ id: 'b', createdAt: new Date(2026, 8, 8, 12).toISOString(), listPrice: 60, targetPrice: 45, form: FORM, sentAt: late.toISOString(), status: 'declined', firstOutcome: 'declined' }, new Date(2026, 9, 1))
  assert.equal(rec.windowId, 'lunch')
  assert.equal(rec.timeGroup, 'daytime')
  const input = normalizeInput(FORM).input
  near(rec.rawLogit, scoreAt(input, late, 1).logit, 1e-9)
})

/* ───────── fit ───────── */

test('fit: recovers a known shift with many outcomes, stays at zero without signal', () => {
  const recs = []
  let s = 3
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) / 16777216 }
  for (let i = 0; i < 3000; i++) {
    const rawLogit = -1.5 + 3 * rnd()
    recs.push({ rawLogit, k: 1, timeGroup: 'prime_evening', band: 'medium', y: rnd() < squash(rawLogit - 0.5) ? 1 : 0 })
  }
  const fit = fitCorrection(recs, ['intercept'], recs.map(() => 1))
  near(fit.theta.intercept, -0.5, 0.12)
  const none = fitCorrection([], ['intercept'], [])
  assert.equal(none.theta.intercept, 0)
})

test('fit: a general shift does not leak into the time groups that hold the data', () => {
  const items = syntheticItems({ months: 3, shift: -0.8 })
  const recs = buildDataset(items, new Date(2026, 6, 1))
  const fit = fitFirstOffers(recs, new Date(2026, 6, 1))
  assert.ok(fit.theta.intercept < -0.2, `intercept ${fit.theta.intercept}`)
  const groups = LEARNING_TIME_GROUPS.map((g) => g.id).filter((g) => fit.nEff[`time.${g}`] > 0)
  const weighted = groups.reduce((acc, g) => acc + fit.nEff[`time.${g}`] * fit.theta[`time.${g}`], 0)
  near(weighted, 0, 1e-6, 'time offsets are centred')
})

test('guardrails: minimum data, bounded steps, evidence gate', () => {
  const now = new Date(2026, 9, 1)
  const fit = (theta, nEff, cov = null) => ({ theta: { intercept: 0, ...theta }, nEff: { intercept: 0, ...nEff }, keys: ['intercept'], cov, n: nEff.intercept || 0, weightTotal: nEff.intercept || 0, ladder: {} })
  let out = proposeProfile({ previous: null, firstFit: fit({ intercept: -0.8 }, { intercept: 5 }), month: '2026-09', now })
  assert.equal(out.profile.intercept, 0)
  assert.equal(out.changes.find((c) => c.key === 'intercept').status, 'waiting_data')
  out = proposeProfile({ previous: null, firstFit: fit({ intercept: -0.8 }, { intercept: 20 }, [[0.04]]), month: '2026-09', now })
  assert.equal(out.profile.intercept, -LEARNING.MAX_STEP.intercept)
  assert.equal(out.changes.find((c) => c.key === 'intercept').status, 'capped')
  assert.equal(out.profile.id, '2026-09')
  assert.equal(out.profile.parentId, 'default')
  out = proposeProfile({ previous: { intercept: -0.3, id: '2026-09' }, firstFit: fit({ intercept: -0.4 }, { intercept: 20 }, [[0.09]]), month: '2026-10', now })
  assert.equal(out.profile.intercept, -0.3, 'within half a posterior sd: no move')
  assert.equal(out.profile.id, '2026-09', 'no move, same profile')
})

test('rollback: a profile that predicts worse than its parent comes back to the parent and freezes for a month', () => {
  const now = new Date(2026, 10, 1)
  const fit = { theta: { intercept: -0.9 }, nEff: { intercept: 30 }, keys: ['intercept'], cov: [[0.01]], n: 30, weightTotal: 30, ladder: {} }
  // The active profile says sellers are tough; last month they accepted almost everything.
  const active = { id: '2026-09', intercept: -1, parent: { intercept: 0 }, changes: [{ key: 'intercept' }] }
  const recs = Array.from({ length: 12 }, (_, i) => ({ rawLogit: 1, k: 1, timeGroup: 'prime_evening', discountPct: 20, y: i < 11 ? 1 : 0 }))
  const out = proposeProfile({ previous: active, firstFit: fit, month: '2026-10', now, lastMonthRecords: recs })
  assert.ok(out.score < LEARNING.ROLLBACK_LOG_BF, `score ${out.score}`)
  assert.equal(out.rollback, true)
  assert.equal(out.profile.intercept, 0, 'parent values restored')
  const row = out.changes.find((c) => c.key === 'intercept')
  assert.equal(row.status, 'rollback')
  assert.deepEqual([row.from, row.to], [-1, 0])
  assert.equal(out.changes.filter((c) => c.key === 'intercept').length, 1, 'one row per parameter')
  assert.equal(out.profile.frozen.intercept, '2026-11')
  assert.equal(out.profile.parentId, '2026-09')
  assert.ok(out.profile.changes.some((c) => c.status === 'rollback'), 'the rollback is undoable')
  // A good profile accumulates evidence instead.
  const good = proposeProfile({ previous: { ...active, intercept: 1.2 }, firstFit: fit, month: '2026-10', now, lastMonthRecords: recs })
  assert.equal(good.rollback, false)
})

test('discount: no data → the default stays; the target moves only with data, by one point a month', () => {
  const now = new Date(2026, 9, 1)
  const fit = { theta: { intercept: 0 }, nEff: { intercept: 0 }, keys: ['intercept'], cov: null, n: 0, weightTotal: 0 }
  const out = proposeProfile({ previous: null, firstFit: fit, records: [], month: '2026-09', now })
  assert.equal(out.profile.discountPct, 20)
  const items = syntheticItems({ months: 6, shift: 0.8 })
  const recs = buildDataset(items, new Date(2026, 9, 1))
  const withData = optimalDiscount(recs, normalizeProfile({ intercept: 0.8 }), now)
  const priors = optimalDiscount(recs, DEFAULT_PROFILE, now, { priorsOnly: true })
  assert.ok(withData.target >= priors.target, `${withData.target} vs ${priors.target}`)
  for (const p of withData.curve) assert.ok(p.pAccept > 0 && p.pAccept < 1)
})

/* ───────── exploration ───────── */

test('exploration: deterministic, about 1 offer in 5, off when disabled, propensity logged', () => {
  const base = analyzeOffer(FORM, NOW)
  let n = 0
  for (let i = 0; i < 400; i++) if (explorationPlan(FORM, base, NOW, { key: `k${i}`, month: '2026-10' })) n++
  assert.ok(n > 50 && n < 110, `${n} / 400`)
  const keyed = Array.from({ length: 200 }, (_, i) => `x${i}`).find((k) => explorationPlan(FORM, base, NOW, { key: k, month: '2026-10' }))
  const a = explorationPlan(FORM, base, NOW, { key: keyed, month: '2026-10' })
  const b = explorationPlan(FORM, base, NOW, { key: keyed, month: '2026-10' })
  assert.deepEqual(a.exploration, b.exploration)
  near(a.exploration.propensity, LEARNING.EXPLORE_SHARE / a.exploration.safe.length, 1e-12)
  assert.ok(a.exploration.safe.includes(a.exploration.arm))
  assert.equal(explorationPlan(FORM, base, NOW, { key: keyed, month: '2026-10', enabled: false }), null)
  assert.equal(explorationKey({ link: 'HTTPS://www.Vinted.it/items/123?ref=x' }), 'www.vinted.it/items/123')
  const cheap = analyzeOffer({ ...FORM, listPrice: '8', targetPrice: '6' }, NOW)
  assert.equal(explorationPlan({ ...FORM, listPrice: '8', targetPrice: '6' }, cheap, NOW, { key: keyed, month: '2026-10' }), null, 'no variations under 10 €')
})

test('exploration: every variation is small, cheap, out of quiet hours and within the monthly budget', () => {
  const base = analyzeOffer(FORM, NOW)
  const seen = new Set()
  for (let i = 0; i < 300; i++) {
    const out = explorationPlan(FORM, base, NOW, { key: `v${i}`, month: '2026-10' })
    if (!out) continue
    const { result, exploration } = out
    seen.add(exploration.arm)
    assert.ok(exploration.costPoints <= Math.round(LEARNING.EXPLORE_MAX_COST * 100), `${exploration.arm} cost ${exploration.costPoints}`)
    assert.ok(exploration.savingCostPct <= LEARNING.EXPLORE_MAX_SAVING_COST * 100 + 1e-9)
    assert.equal(result.exploration, exploration)
    const m = result.optimal.date.getHours() * 60 + result.optimal.date.getMinutes()
    assert.ok(!(m >= 23 * 60 || m < 7 * 60), `${exploration.arm} at ${result.optimal.date}`)
    if (exploration.kind === 'time') {
      near(Math.abs(result.optimal.date - base.optimal.date) / 60000, 60, 5, exploration.arm)
      assert.equal(result.input.targetPrice, base.input.targetPrice)
    } else {
      const delta = result.input.discountPct - base.input.discountPct
      assert.ok(exploration.arm === 'deeper' ? delta > 0 : delta < 0, `${exploration.arm} ${delta}`)
      assert.ok(Math.abs(delta) <= 3.4, `${delta}`)
    }
  }
  assert.ok(seen.size >= 2, `arms seen: ${[...seen]}`)
  // Budget: once the month's variations have cost 3% of the base acceptance, no more variations.
  const spentAll = { baseTotal: 1, spent: 1 }
  for (let i = 0; i < 100; i++) assert.equal(explorationPlan(FORM, base, NOW, { key: `v${i}`, month: '2026-10', budget: spentAll }), null)
  const items = [{ decision: { at: NOW.toISOString(), probability: 0.5, exploration: { base: { probability: 0.55 } } } }, { decision: { at: NOW.toISOString(), probability: 0.6, exploration: null } }]
  const bud = explorationBudget(items, '2026-10')
  near(bud.baseTotal, 1.15, 1e-12)
  near(bud.spent, 0.05, 1e-12)
})

test('failure risk: complement of the estimate, a range, reasons, failure mix and the chance to close anyway', () => {
  const r = analyzeOffer({ ...FORM, targetPrice: '40' }, NOW)
  const risk = failureRiskFor(r)
  near(risk.pFail, 1 - r.probability, 1e-12)
  assert.ok(risk.range[0] <= risk.pFail && risk.pFail <= risk.range[1])
  assert.equal(risk.basis, 'engine')
  assert.ok(risk.reasons.length >= 1)
  near(risk.failureMix.reduce((s, m) => s + m.share, 0), 1, 1e-9)
  assert.ok(risk.pClose >= r.probability && risk.pClose <= 1)
  assert.ok(risk.pCloseRange[0] <= risk.pClose + 1e-9 && risk.pClose <= risk.pCloseRange[1] + 1e-9)
  const items = syntheticItems({ months: 4, shift: -0.5 })
  const now = new Date(2026, 7, 1)
  const report = monthlyReport({ items, month: '2026-07', now })
  const profile = report.nextProfile
  const r2 = analyzeOffer({ ...FORM, targetPrice: '48' }, now, { profile })
  const risk2 = failureRiskFor(r2, { profile, records: report.records, now })
  assert.equal(risk2.basis, 'history')
  assert.ok(risk2.similar && risk2.similar.n >= 3)
  assert.ok(['low', 'medium', 'high'].includes(risk2.level))
  // The synthetic sellers counter 35% of the time and decline the rest: the mix must lean on counters.
  assert.equal(risk2.failureMix[0].id, 'countered')
})

test('calibration: equal-mass bins with Wilson intervals, observed vs expected, Spiegelhalter Z', () => {
  const pairs = Array.from({ length: 27 }, (_, i) => [0.2 + (i % 9) * 0.07, i % 3 === 0 ? 1 : 0])
  const m = calibrationMetrics(pairs)
  assert.equal(m.n, 27)
  assert.equal(m.bins.length, 3)
  assert.equal(m.bins.reduce((s, b) => s + b.n, 0), 27)
  for (const b of m.bins) assert.ok(b.low <= b.observed && b.observed <= b.high)
  assert.equal(m.observed, 9)
  assert.ok(m.oeRatio < 1 && m.oeZ < 0)
  assert.ok(Number.isFinite(m.spiegelhalterZ) && Number.isFinite(m.logLossSe))
  assert.equal(calibrationMetrics([]).n, 0)
})

test('counters: Kaplan–Meier reply times and the seller concession share feed the counter engine', () => {
  const km = kaplanMeier([{ t: 1, event: true }, { t: 2, event: true }, { t: 3, event: false }, { t: 5, event: true }, { t: 168, event: false }])
  near(km.table.find((x) => x.hours === 1).survival, 0.8, 1e-12)
  near(km.table.find((x) => x.hours === 6).survival, 0.8 * 0.75 * (1 - 1 / 2), 1e-12)
  assert.equal(km.median, 5)
  const items = syntheticItems({ months: 4 })
  const stats = counterAnalytics(buildDataset(items, new Date(2026, 7, 1)), new Date(2026, 7, 1))
  assert.ok(stats.rounds > 0)
  // Synthetic sellers counter at 1,3 × our offer from the list price: they concede more than eBay's 42%? check the direction.
  assert.ok(stats.sharePosterior > 0 && stats.sharePosterior < 1)
  near(stats.shareMultiplier, stats.sharePosterior / LEARNING.SELLER_SHARE_PRIOR, 1e-12)
  // A learned multiplier changes how firm the counter engine reads the seller.
  const raw = { ...FORM, previousOffer: '45', sellerCounter: '55', offerSentAt: new Date(2026, 9, 13, 21, 35), receivedAt: new Date(2026, 9, 13, 21, 40) }
  const now = new Date(2026, 9, 13, 21, 45)
  const plain = analyzeCounter(raw, now)
  const generous = analyzeCounter(raw, now, { profile: normalizeProfile({ counterShare: 1.3 }) })
  assert.ok(generous.negotiation && plain.negotiation)
  assert.notEqual(JSON.stringify(generous.factors), JSON.stringify(plain.factors))
})

test('ladder: the slope stays out when the engine already ranks offers right', () => {
  const recs = []
  let s = 9
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) / 16777216 }
  const at = new Date(2026, 3, 1)
  for (let i = 0; i < 80; i++) {
    const rawLogit = -1.5 + 3 * rnd()
    recs.push({ rawLogit, k: 1, timeGroup: 'prime_evening', discountPct: 20, discW: discKnotWeights(20), y: rnd() < squash(rawLogit - 0.4) ? 1 : 0, sentAt: at })
  }
  const fit = fitFirstOffers(recs, new Date(2026, 4, 1))
  assert.ok(fit.ladder.slope, 'evaluated with ≥ 40 outcomes')
  assert.equal(fit.ladder.slope.admitted, false, `gain ${fit.ladder.slope.gain}`)
  assert.ok(!fit.keys.includes('slope'))
  assert.ok(fit.cov && fit.cov.length === fit.keys.length, 'joint covariance')
})

test('report: learns a tough market month after month, never by more than one step', () => {
  // 14 offers a month (the user's volume is under 15). The ladder only moves when the sample really shows the shift,
  // so a seed whose sample hides it may stay put: judge the behaviour across seeds, and never in the wrong direction.
  const finals = []
  for (const seed of [1, 7, 11, 13, 21]) {
    const items = syntheticItems({ months: 6, perMonth: 14, shift: -0.8, seed })
    let profile = null
    const history = []
    for (const month of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) {
      const now = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 1, 9)
      const visible = items.filter((it) => new Date(it.sentAt) < now)
      const rep = monthlyReport({ items: visible, month, now, previous: profile, profileHistory: history })
      for (const c of rep.changes) {
        if (c.key === 'sellerReplyHours') {
          assert.ok(c.from == null || c.to / c.from <= LEARNING.MAX_STEP.latency + 1e-9, `${month} ${c.key} ${c.from}→${c.to}`)
          continue
        }
        const kind = { discountPct: 'discountPct', counterShare: 'share' }[c.key] || c.key.split('.')[0]
        assert.ok(Math.abs(c.to - c.from) <= LEARNING.MAX_STEP[kind] + 1e-9, `${month} ${c.key} ${c.from}→${c.to}`)
      }
      profile = rep.nextProfile
      history.push(profile)
    }
    finals.push(profile.intercept)
    assert.ok(profile.intercept <= 0.05, `seed ${seed}: moved the wrong way (${profile.intercept})`)
    const decided = buildDataset(items, new Date(2026, 9, 1)).filter((r) => r.y != null)
    const ll = (p) => decided.reduce((s, r) => s - (r.y ? Math.log(predictWith(p, r)) : Math.log(1 - predictWith(p, r))), 0)
    assert.ok(ll(profile) <= ll(null) + 1e-9, `seed ${seed}: the learned profile predicts the history at least as well as the plain engine`)
  }
  assert.ok(finals.filter((x) => x < -0.1).length >= 3, `seeds that learned the shift: ${finals}`)
  assert.ok(finals.reduce((a, b) => a + b, 0) / finals.length < -0.25, `mean intercept ${finals}`)
})

test('report: with an engine that is already right, the profile barely moves', () => {
  const finals = []
  for (const seed of [1, 7, 11]) {
    const items = syntheticItems({ months: 6, perMonth: 14, shift: 0, seed })
    let profile = null
    for (const month of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) {
      const now = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 1, 9)
      profile = monthlyReport({ items: items.filter((it) => new Date(it.sentAt) < now), month, now, previous: profile }).nextProfile
    }
    // A lucky streak (seed 11 sees 90% acceptances for three months) may move it: never by more than the bound.
    assert.ok(Math.abs(profile.intercept) <= 0.45, `seed ${seed}: intercept ${profile.intercept}`)
    assert.ok(Math.abs(profile.discountPct - 20) <= 3, `seed ${seed}: discount ${profile.discountPct}`)
    finals.push(profile.intercept)
  }
  assert.ok(Math.abs(finals.reduce((a, b) => a + b, 0) / finals.length) <= 0.2, `mean intercept ${finals}`)
})

test('report: month numbers, counters, workbook, deterministic output', () => {
  const items = syntheticItems({ months: 2 })
  const now = new Date(2026, 5, 1, 9)
  const rep = monthlyReport({ items, month: '2026-05', now })
  const s = rep.summary
  assert.equal(s.offersSent, rep.inMonth.length)
  assert.equal(s.accepted + s.countered + s.declined + s.noReply + s.soldOther, s.decidedFirst)
  assert.equal(s.closedDeals + s.lostDeals + s.pending, s.offersSent)
  if (s.sellerCounters) near(s.avgSellerRaisePct, 30, 2)
  assert.equal(reportFileName(rep), 'Offerte-Vinted-2026-05.xlsx')
  const a = reportWorkbook(rep)
  const b = reportWorkbook(monthlyReport({ items, month: '2026-05', now }))
  assert.deepEqual(Buffer.from(a), Buffer.from(b), 'same inputs → same bytes')
  const files = unzip(a)
  const names = [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(names, ['Riepilogo', 'Offerte', 'Trattative', 'Controproposte', 'Fasce orarie', 'Sconti', 'Calibrazione', 'Varianti di test', 'Modifiche motore', 'Andamento', 'Note'])
  const offers = files['xl/worksheets/sheet2.xml']
  assert.equal((offers.match(/<row /g) || []).length, 1 + rep.inMonth.length)
  for (const xml of Object.values(files)) assert.ok(!/undefined|NaN|\[object Object\]/.test(xml), xml.slice(0, 120))
})

test('report: an empty month still produces a readable workbook', () => {
  const rep = monthlyReport({ items: [], month: '2026-09', now: new Date(2026, 9, 1, 9) })
  assert.equal(rep.summary.offersSent, 0)
  assert.ok(rep.notes.length >= 1)
  assert.equal(rep.nextProfile.discountPct, 20)
  assert.equal(rep.changes.filter((c) => c.status === 'applied').length, 0)
  const files = unzip(reportWorkbook(rep))
  assert.ok(files['xl/worksheets/sheet1.xml'].includes('Offerte inviate nel mese'))
})

test('snapshot: what the engine recommended is frozen with the item', () => {
  const r = analyzeOffer(FORM, NOW)
  const snap = decisionSnapshot(r, { now: NOW })
  assert.equal(snap.knot, discKnotOf(r.input.discountPct))
  assert.equal(snap.recommendedAt, r.optimal.date.toISOString())
  near(snap.k * squash(snap.rawLogit), r.probability, 1e-9)
})

test('determinism: the same month twice gives the same profile; item order does not matter', () => {
  const items = syntheticItems({ months: 4, perMonth: 14, shift: -0.6 })
  const now = new Date(2026, 7, 1, 9)
  const a = monthlyReport({ items, month: '2026-07', now })
  const b = monthlyReport({ items: [...items].reverse(), month: '2026-07', now })
  assert.equal(JSON.stringify(a.nextProfile), JSON.stringify(b.nextProfile))
  assert.deepEqual(Buffer.from(reportWorkbook(a)), Buffer.from(reportWorkbook(b)))
  const c = monthlyReport({ items, month: '2026-07', now, previous: a.previousProfile })
  assert.equal(c.nextProfile.id, a.nextProfile.id)
})

test('no signal: with the engine already right, most seeded runs move nothing', () => {
  let still = 0
  const runs = 20
  for (let seed = 1; seed <= runs; seed++) {
    const items = syntheticItems({ months: 3, perMonth: 10, shift: 0, seed: seed * 7 + 1 })
    const rep = monthlyReport({ items, month: '2026-06', now: new Date(2026, 6, 1, 9) })
    // First-offer engine only: the synthetic sellers really concede little in counters, so those parameters may move.
    const firstOffer = (k) => k === 'intercept' || k === 'slope' || k.startsWith('time.') || k.startsWith('disc.')
    if (!rep.changes.some((x) => (x.status === 'applied' || x.status === 'capped') && firstOffer(x.key))) still++
  }
  assert.ok(still >= runs * 0.75, `${still}/${runs} runs without engine changes`)
})

test('review fixes: plans never sent, tapped outcomes after a counter, missing estimates, off-plan counters', () => {
  const now = new Date(2026, 9, 10)
  const planned = new Date(2026, 8, 20, 21, 30).toISOString()
  const base = { id: 'p', createdAt: new Date(2026, 8, 20, 12).toISOString(), listPrice: 60, targetPrice: 45, discountPct: 25, form: FORM, sendAt: planned }
  // A plan abandoned or bought at list price without any offer is not an offer.
  assert.equal(learningRecord({ ...base, status: 'abandoned', firstOutcome: 'abandoned', negotiation: [{ by: 'buyer', price: 45, at: planned, planned: true }] }, now), null)
  assert.equal(learningRecord({ ...base, status: 'bought', finalPrice: 60, negotiation: [{ by: 'buyer', price: 45, at: planned, planned: true }] }, now), null)
  // An «imputed» send time stamped after the seller's counter is the outcome tap: unknown send time.
  const counterAt = new Date(2026, 8, 28, 22, 0).toISOString()
  const rec = learningRecord({
    ...base, status: 'accepted', firstOutcome: 'countered', finalPrice: 51.7, probability: null, sentAt: new Date(2026, 9, 2, 13, 10).toISOString(), sentAtSource: 'imputed',
    negotiation: [{ by: 'buyer', price: 45, at: null, planned: false }, { by: 'seller', price: 58.5, at: counterAt }, { by: 'buyer', price: 51.7, at: new Date(2026, 8, 29, 9, 0).toISOString(), plannedAt: new Date(2026, 8, 29, 21, 35).toISOString(), pAccept: 0.52, rawLogit: null }],
  }, now)
  assert.equal(rec.sentKnown, false)
  assert.equal(rec.y, null)
  assert.equal(rec.month, '2026-09')
  assert.equal(rec.pShown, null, 'a missing estimate is not 0%')
  assert.equal(rec.latencyFirstH, null)
  // Our counter went out 12 hours before the planned moment: its stored logit does not describe it.
  assert.equal(rec.rounds[0].replyOffPlan, true)
  assert.equal(rec.rounds[0].replyRawLogit, null)
  assert.equal(rec.rounds[0].replyWindowId, timeWindowAt(new Date(2026, 8, 29, 9, 0)).id)
})

test('review fixes: discount variations stay near ±2 points on cheap items and say how many points', () => {
  for (const [L, T] of [[12, 9], [21, 16], [24, 18], [60, 48]]) {
    const raw = { ...FORM, listPrice: String(L), targetPrice: String(T) }
    const base = analyzeOffer(raw, NOW)
    for (let i = 0; i < 200; i++) {
      const out = explorationPlan(raw, base, NOW, { key: `c${L}-${i}`, month: '2026-10' })
      if (!out || out.exploration.kind !== 'discount') continue
      const delta = Math.abs(out.result.input.discountPct - base.input.discountPct)
      assert.ok(delta <= LEARNING.EXPLORE_DISCOUNT_PTS + 1 + 1e-9, `L=${L}: ${delta} points`)
      assert.match(out.exploration.label, new RegExp(`^${String(Math.round(delta * 10) / 10).replace('.', ',')} punt`))
    }
  }
})

test('review fixes: risk shows «calibrated» only with a real profile; iso-acceptance discount moves both ways', () => {
  const r = analyzeOffer(FORM, NOW)
  const thin = normalizeProfile({ cov: [[0.2]], paramKeys: ['intercept'], basedOn: 2 })
  assert.equal(failureRiskFor(r, { profile: thin }).basis, 'engine')
  const items = syntheticItems({ months: 4, perMonth: 14 })
  const recs = buildDataset(items, new Date(2026, 7, 1))
  const now = new Date(2026, 7, 1)
  assert.equal(isoAcceptanceDiscount(recs, DEFAULT_PROFILE, now).target, 20, 'uncorrected engine: −20%')
  assert.ok(isoAcceptanceDiscount(recs, normalizeProfile({ intercept: -0.5 }), now).target < 20, 'tough sellers: softer opener')
  assert.ok(isoAcceptanceDiscount(recs, normalizeProfile({ intercept: 0.5 }), now).target > 20, 'generous sellers: deeper opener')
  // The slope pivots around SLOPE_CENTER: at that logit only the intercept acts.
  const row = learnedOfferRow(normalizeProfile({ slope: 1.2, intercept: -0.1 }), { logit: LEARNING.SLOPE_CENTER, windowId: 'sunday_night', discountPct: 20 })
  near(row.weight, -0.1, 1e-12)
})
