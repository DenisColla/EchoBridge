import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import {
  DEFAULT_PROFILE, ENGINE_VERSION, EXPLORATION_ARMS, LEARNING, LEARNING_DISCOUNT_KNOTS, LEARNING_TIME_GROUPS, LIVE_KEYS, analyzeCounter, analyzeOffer, applyCheckpoint, buildDataset, buildXlsx,
  calibrationMetrics, counterAnalytics, decisionSnapshot, isoAcceptanceDiscount, timeWindowAt, defaultDiscountFor, discKnotOf, discKnotWeights, discOffset, dueMonths, explorationBudget,
  explorationKey, explorationPlan, failureRiskFor, firstOfferCorrected, fitCorrection, fitFirstOffers, kaplanMeier, learnedOfferRow, learningRecord, liveCheckpoint, liveDiffers, liveProfile, monotoneDisc,
  monthKeyOf, monthLabel, monthlyReport, normalizeProfile, optimalDiscount, pickMoments, normalizeInput, predictWith, predictiveInterval, prequentialScore, profileIsActive, profileIsStale, proposeProfile,
  reportFileName, reportWorkbook, scoreAt, shiftMonth, squash, timeGroupOf, unsquash, withLiveHistory, xlsxBase64, xlsxColumn, xlsxCrc32, xlsxDateSerial, xlsxEscape,
  xlsxSheetName, xlsxUtf8,
  THOMPSON_ARMS, continuationPosterior, explorationStats, isoAcceptanceShift, snapshotSignals, thompsonArm,
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

/** Hand-built decided records: `rawLogit` 0 (a 50% offer), sent `daysAgo` days before `now`, outcome `y`. */
const rec = (id, y, { rawLogit = 0, discountPct = 20, daysAgo = 20, now = new Date(2026, 9, 1), appliedCorrection = null, k = 1 } = {}) => ({
  id, y, rawLogit, k, discountPct, knot: discKnotOf(discountPct), discW: discKnotWeights(discountPct), timeGroup: 'prime_evening',
  sentAt: new Date(now.getTime() - daysAgo * 86400e3), appliedCorrection, priceBand: 'from_20_to_50',
})

test('live gates: too few outcomes → no correction; enough → the posterior mode, no monthly step, inside the wide bounds', () => {
  const now = new Date(2026, 9, 1)
  // 5 refusals of 50% offers: a clear miss, but under MIN_EFFECTIVE (6) nothing moves.
  const five = liveProfile(Array.from({ length: 5 }, (_, i) => rec(`a${i}`, 0, { now })), now)
  assert.equal(five.status.intercept, 'waiting_data')
  assert.equal(five.profile.intercept, 0)
  assert.equal(five.profile.live, false)
  assert.ok(five.fitted.intercept < -0.5, 'the fit itself says the sellers are tougher')
  assert.equal(five.basedOn, 5)
  assert.ok(five.profile.cov && five.profile.paramKeys.length === 2, 'the posterior covariance is kept for the interval')
  // 20 refusals: applied at the posterior mode, far beyond the old monthly step of 0,3 and the old −1 bound.
  const twenty = liveProfile(Array.from({ length: 20 }, (_, i) => rec(`b${i}`, 0, { now })), now)
  assert.equal(twenty.status.intercept, 'applied')
  assert.ok(twenty.profile.intercept < -1.2, `${twenty.profile.intercept}`)
  assert.ok(twenty.profile.intercept >= LEARNING.BOUNDS.intercept[0])
  assert.equal(twenty.profile.live, true)
  assert.equal(twenty.profile.engine, ENGINE_VERSION)
  assert.match(twenty.profile.id, /^live\.2026-10-01$/)
  assert.equal(twenty.profile.checkpointId, 'default')
  assert.equal(twenty.status.dslope, 'waiting_data', 'one discount arm only: no slope')
  // Mixed evidence near the engine's own estimate: |θ̂| under one posterior sd → no correction (no flicker).
  const mixed = liveProfile(Array.from({ length: 12 }, (_, i) => rec(`c${i}`, i % 2, { now })), now)
  assert.equal(mixed.status.intercept, 'waiting_data')
  assert.ok(Math.abs(mixed.fitted.intercept) < LEARNING.LIVE.GATE_Z * mixed.sd.intercept)
  // Hysteresis: one more refusal moves the fit by less than 0,1 → the applied value stays.
  const more = liveProfile(Array.from({ length: 21 }, (_, i) => rec(`b${i}`, 0, { now })), now, { previous: twenty.profile })
  assert.ok(Math.abs(more.fitted.intercept - twenty.fitted.intercept) < LEARNING.LIVE.HYSTERESIS)
  assert.equal(more.profile.intercept, twenty.profile.intercept)
  assert.equal(more.profile.id, twenty.profile.id)
  assert.equal(more.profile.appliedAt, twenty.profile.appliedAt)
  assert.equal(more.changed, true, 'the data basis grew, so the stored profile is updated anyway')
  assert.equal(liveProfile(Array.from({ length: 21 }, (_, i) => rec(`b${i}`, 0, { now })), now, { previous: more.profile }).changed, false, 'same data twice: nothing to store')
  // Ten acceptances on top move it a lot: new value, new id.
  const swing = liveProfile([...Array.from({ length: 20 }, (_, i) => rec(`b${i}`, 0, { now })), ...Array.from({ length: 10 }, (_, i) => rec(`d${i}`, 1, { now }))], new Date(2026, 9, 2), { previous: twenty.profile })
  assert.ok(swing.profile.intercept > twenty.profile.intercept + 0.3)
  assert.equal(swing.profile.id, 'live.2026-10-02')
  assert.equal(swing.profile.parentId, twenty.profile.id)
})

test('monthly rollback: a time-group offset that predicts worse than its parent comes back and freezes for a month; the live level is not judged', () => {
  const now = new Date(2026, 10, 1)
  const fit = { theta: { intercept: 0 }, nEff: { intercept: 30 }, keys: ['intercept'], cov: [[0.01]], n: 30, weightTotal: 30, ladder: {} }
  // The active profile says prime evenings are much worse than the engine thinks; last month they accepted almost everything there.
  const active = { id: '2026-09', intercept: -0.5, live: true, time: { prime_evening: -0.6 }, parent: { intercept: 0, time: { prime_evening: 0 } }, changes: [{ key: 'time.prime_evening' }] }
  const recs = Array.from({ length: 12 }, (_, i) => ({ rawLogit: 1, k: 1, timeGroup: 'prime_evening', discountPct: 20, y: i < 11 ? 1 : 0 }))
  const out = proposeProfile({ previous: active, firstFit: fit, month: '2026-10', now, lastMonthRecords: recs })
  assert.ok(out.score < LEARNING.ROLLBACK_LOG_BF, `score ${out.score}`)
  assert.equal(out.rollback, true)
  assert.equal(out.profile.time.prime_evening, 0, 'parent offsets restored')
  const row = out.changes.find((c) => c.key === 'time.prime_evening')
  assert.equal(row.status, 'rollback')
  assert.deepEqual([row.from, row.to], [-0.6, 0])
  assert.equal(out.profile.frozen.time, '2026-11')
  assert.equal(out.profile.parentId, '2026-09')
  assert.ok(out.profile.changes.some((c) => c.status === 'rollback'), 'the rollback is undoable')
  // The live intercept is the live fit's business: with no records it is waiting for data, and it is never a monthly rollback row.
  const live = out.changes.find((c) => c.key === 'intercept')
  assert.equal(live.status, 'waiting_data')
  assert.ok(!out.changes.some((c) => LIVE_KEYS.includes(c.key) && c.status === 'rollback'))
  // Only the monthly families are judged: the same intercept on both sides, so a profile whose offsets are right is not rolled back.
  const good = proposeProfile({ previous: { ...active, time: { prime_evening: 0.3 } }, firstFit: fit, month: '2026-10', now, lastMonthRecords: recs })
  assert.equal(good.rollback, false)
  const levelOnly = proposeProfile({ previous: { id: '2026-09', intercept: -1.5, live: true, parent: { intercept: 0 }, changes: [{ key: 'intercept' }] }, firstFit: fit, month: '2026-10', now, lastMonthRecords: recs })
  assert.equal(levelOnly.rollback, false, 'a live level alone is never judged by the monthly path')
})

test('live rollback: when the corrections really applied predict worse than the checkpoint by 2 nats, the values go back and freeze for 30 days', () => {
  const now = new Date(2026, 10, 1)
  // The live profile has said −1 logit since 1 September; the ten offers sent since then (with that −1 applied) were mostly accepted.
  const previous = normalizeProfile({ id: 'live.2026-09-01', intercept: -1, live: true, appliedAt: new Date(2026, 8, 1).toISOString(), cov: [[0.1, 0], [0, 0.12]], paramKeys: ['intercept', 'dslope'], basedOn: 15 })
  const later = Array.from({ length: 10 }, (_, i) => rec(`l${i}`, i < 8 ? 1 : 0, { now, daysAgo: 10 + i, appliedCorrection: -1 }))
  const judged = prequentialScore(later, previous, null, now)
  assert.equal(judged.n, 10)
  assert.ok(judged.score < LEARNING.ROLLBACK_LOG_BF, `score ${judged.score}`)
  const out = liveProfile(later, now, { previous, checkpoint: null })
  assert.equal(out.status.intercept, 'rollback')
  assert.ok(out.rollback && out.rollback.n === 10)
  assert.equal(out.profile.intercept, 0, 'back to the checkpoint (the plain engine)')
  assert.equal(out.profile.checkpointId, 'default')
  assert.equal(out.profile.frozenReason, 'rollback')
  assert.equal(out.profile.frozenUntil, new Date(now.getTime() + LEARNING.LIVE.FREEZE_DAYS * 86400e3).toISOString())
  // While frozen the fit still runs (the ten acceptances would push the level up) but nothing is applied.
  const frozen = liveProfile(later, new Date(2026, 10, 5), { previous: out.profile, checkpoint: null })
  assert.equal(frozen.status.intercept, 'frozen')
  assert.equal(frozen.frozen, true)
  assert.equal(frozen.profile.intercept, 0)
  assert.ok(frozen.fitted.intercept > 0.5)
  // After the freeze the live fit applies again.
  const thawed = liveProfile(later.map((r) => ({ ...r, sentAt: new Date(r.sentAt.getTime() + 40 * 86400e3) })), new Date(2026, 11, 10), { previous: out.profile, checkpoint: null })
  assert.notEqual(thawed.status.intercept, 'frozen')
  // Records sent before the checkpoint was applied, or without a stored correction, do not count.
  const checkpoint = { ...previous, id: 'live.2026-08-01', appliedAt: new Date(2026, 7, 1).toISOString(), intercept: -0.5 }
  const early = rec('e', 1, { now, daysAgo: 100, appliedCorrection: -1 })
  const bare = rec('b', 1, { now, daysAgo: 15 })
  assert.equal(prequentialScore([early, bare], null, checkpoint, now).n, 0)
  assert.equal(prequentialScore([bare], previous, checkpoint, now).n, 1, 'a bare record sent while the applied profile was in force uses its correction')
  // «Annulla»: the same move, by the user, frozen for 30 days.
  const undone = applyCheckpoint(previous, null, now, { reason: 'undo' })
  assert.equal(undone.intercept, 0)
  assert.equal(undone.frozenReason, 'undo')
  assert.equal(undone.parentId, 'live.2026-09-01')
  assert.ok(liveProfile(later, new Date(2026, 10, 2), { previous: undone }).status.intercept === 'frozen')
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
  // «Calibrated» needs a moved first-offer correction: force one if this sample did not move it.
  const profile = normalizeProfile({ ...report.nextProfile, intercept: report.nextProfile.intercept || -0.4 })
  assert.equal(failureRiskFor(analyzeOffer({ ...FORM, targetPrice: '48' }, now, { profile: { ...profile, intercept: 0, slope: 1, time: {}, disc: {} } }), { profile: { ...profile, intercept: 0, slope: 1, time: {}, disc: {} } }).basis, 'engine', 'counter-only changes do not calibrate the first offer')
  const r2 = analyzeOffer({ ...FORM, targetPrice: '48' }, now, { profile })
  const risk2 = failureRiskFor(r2, { profile, records: report.records, now })
  assert.equal(risk2.basis, 'history')
  assert.ok(risk2.similar && risk2.similar.n >= 3)
  assert.ok(risk2.similar.band === null || typeof risk2.similar.bandLabel === 'string', 'band-matched when the band has enough offers')
  assert.ok(['low', 'medium', 'high'].includes(risk2.level))
  // The synthetic sellers counter 35% of the time, decline or stay silent otherwise: a proper mix led by one of those.
  near(risk2.failureMix.reduce((s, m) => s + m.share, 0), 1, 1e-9)
  assert.ok(['countered', 'no_reply', 'declined'].includes(risk2.failureMix[0].id))
  // The range is the 90% predictive interval of the corrected estimate.
  const band = predictiveInterval(r2, profile, { level: 0.9 })
  near(risk2.range[0], 1 - band.high, 1e-12)
  near(risk2.range[1], 1 - band.low, 1e-12)
  // Even an active seller misses one offer in ten: the read reason is there without saying «inattivo».
  assert.ok(risk.reasons.some((x) => x.id === 'read' && !x.text.includes('inattivo')))
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

test('report: learns a tough market month after month; the live level moves in one step, the monthly families by at most one step', () => {
  // 14 offers a month (the user's volume is under 15). The live intercept moves as soon as its gates open, the monthly
  // families only when the sample really shows a difference between groups: judge across seeds, never the wrong way.
  const finals = []
  for (const seed of [1, 7, 11, 13, 21]) {
    const items = syntheticItems({ months: 6, perMonth: 14, shift: -0.8, seed })
    let profile = null
    const history = []
    for (const month of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) {
      const now = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 1, 9)
      const visible = items.filter((it) => new Date(it.sentAt) < now)
      const rep = monthlyReport({ items: visible, month, now, previous: profile, profileHistory: history })
      assert.equal(rep.nextProfile.intercept, rep.live.profile.intercept, 'the monthly report carries the live level, never a second correction')
      for (const c of rep.changes) {
        if (LIVE_KEYS.includes(c.key)) {
          assert.ok(['live', 'waiting_data', 'frozen', 'rollback_live'].includes(c.status), `${month} ${c.key} ${c.status}`)
          continue
        }
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
  assert.ok(finals.filter((x) => x < -0.3).length >= 4, `seeds that learned the shift: ${finals}`)
  assert.ok(finals.reduce((a, b) => a + b, 0) / finals.length < -0.4, `mean intercept ${finals}`)
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
    // A lucky streak may open the live gate (|θ̂| ≥ one posterior sd, about one seed in three): never by much.
    assert.ok(Math.abs(profile.intercept) <= 0.7, `seed ${seed}: intercept ${profile.intercept}`)
    assert.ok(Math.abs(profile.discountPct - 20) <= 3, `seed ${seed}: discount ${profile.discountPct}`)
    finals.push(profile.intercept)
  }
  assert.ok(Math.abs(finals.reduce((a, b) => a + b, 0) / finals.length) <= 0.3, `mean intercept ${finals}`)
})

test('report: month numbers, counters, workbook, deterministic output', () => {
  const items = syntheticItems({ months: 2 })
  const now = new Date(2026, 5, 1, 9)
  const rep = monthlyReport({ items, month: '2026-05', now })
  const s = rep.summary
  assert.equal(s.offersSent, rep.inMonth.length)
  assert.equal(s.accepted + s.countered + s.declined + s.noReply + s.soldOther, s.decidedFirst)
  assert.equal(s.closedDeals + s.lostDeals + s.pending, s.offersSent)
  if (s.sellerCounters) assert.ok(s.avgSellerRaisePct > 0 && s.avgSellerRaisePct <= 30 + 1e-9, `${s.avgSellerRaisePct}`) // counters at ×1,3, capped at the list price
  assert.equal(reportFileName(rep), 'Offerte-Vinted-2026-05.xlsx')
  const a = reportWorkbook(rep)
  const b = reportWorkbook(monthlyReport({ items, month: '2026-05', now }))
  assert.deepEqual(Buffer.from(a), Buffer.from(b), 'same inputs → same bytes')
  const files = unzip(a)
  const names = [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(names, ['Riepilogo', 'Offerte', 'Aggiornamenti', 'Trattative', 'Controproposte', 'Fasce orarie', 'Sconti', 'Calibrazione', 'Varianti di test', 'Modifiche motore', 'Andamento', 'Note'])
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
  let liveMoved = 0
  const runs = 20
  for (let seed = 1; seed <= runs; seed++) {
    const items = syntheticItems({ months: 3, perMonth: 10, shift: 0, seed: seed * 7 + 1 })
    const rep = monthlyReport({ items, month: '2026-06', now: new Date(2026, 6, 1, 9) })
    // First-offer engine only: the synthetic sellers really concede little in counters, so those parameters may move.
    const firstOffer = (k) => k === 'slope' || k.startsWith('time.') || k.startsWith('disc.')
    if (!rep.changes.some((x) => (x.status === 'applied' || x.status === 'capped') && firstOffer(x.key))) still++
    if (rep.live.status.intercept === 'applied') liveMoved++
  }
  assert.ok(still >= runs * 0.75, `${still}/${runs} runs without engine changes`)
  // The live gate is one posterior sd: a right engine still gets a (small) correction in about one run in three.
  assert.ok(liveMoved <= runs * 0.6, `${liveMoved}/${runs} runs with a live correction`)
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

test('workbook review: late outcomes reach the next file, unknown send times stay blank, previews say «proposta»', () => {
  const sent = new Date(2026, 7, 30, 21, 45)
  const item = {
    id: 'late', createdAt: new Date(2026, 7, 30, 12).toISOString(), title: 'Felpa', listPrice: 60, targetPrice: 45, discountPct: 25, form: FORM, sentAt: sent.toISOString(), sentAtSource: 'tap',
    status: 'accepted', firstOutcome: 'countered', firstOutcomeAt: new Date(2026, 8, 2, 10).toISOString(), finalPrice: 52, outcomeAt: new Date(2026, 8, 4, 20).toISOString(),
    negotiation: [{ by: 'buyer', price: 45, at: sent.toISOString() }, { by: 'seller', price: 58, at: new Date(2026, 8, 2, 10).toISOString() }, { by: 'buyer', price: 52, at: new Date(2026, 8, 2, 21, 30).toISOString() }],
  }
  const counterOnly = {
    id: 'cs', createdAt: new Date(2026, 8, 20, 21, 40).toISOString(), title: 'Borsa', listPrice: 60, targetPrice: 45, form: FORM, sentAt: null, status: 'countered', firstOutcome: 'countered',
    negotiation: [{ by: 'buyer', price: 45, at: null, planned: false }, { by: 'seller', price: 58.5, at: new Date(2026, 8, 20, 21, 40).toISOString() }],
  }
  const rep = monthlyReport({ items: [item, counterOnly], month: '2026-09', now: new Date(2026, 9, 1, 9) })
  assert.equal(rep.touched.length, 1)
  assert.ok(rep.roundsThisMonth.length >= 2, 'September rounds of an August offer are in September')
  assert.equal(rep.summary.unknownStart, 1)
  const files = unzip(reportWorkbook(rep))
  const upd = files['xl/worksheets/sheet3.xml']
  assert.ok(upd.includes('Felpa') && upd.includes('Affare concluso'))
  const offers = files['xl/worksheets/sheet2.xml']
  assert.ok(offers.includes('sconosciuto'))
  assert.ok(files['xl/worksheets/sheet1.xml'].includes('Generato il 01/10/2026'))
  // Preview (manual export / caught-up month): nothing is called applied.
  const preview = monthlyReport({ items: [item, counterOnly], month: '2026-09', now: new Date(2026, 9, 1, 9), applied: false })
  assert.ok(preview.changes.every((c) => c.status !== 'applied' && c.status !== 'capped'))
  const pf = unzip(reportWorkbook(preview))
  assert.ok(!Object.values(pf).some((x) => x.includes('>Applicata<')))
  assert.ok(pf['xl/worksheets/sheet10.xml'].includes('Correzioni proposte (non applicate)'))
})

test('engine review: a test variation never says «send now», and the price suggestion uses the same moment', () => {
  const base = analyzeOffer(FORM, NOW)
  for (let i = 0; i < 200; i++) {
    const out = explorationPlan(FORM, base, NOW, { key: `t${i}`, month: '2026-10', share: 1 })
    if (!out || out.exploration.kind !== 'time') continue
    assert.equal(out.result.sendNow.ok, false)
    assert.equal(out.result.sendNow.reason, 'exploration')
    if (out.result.suggestedPrice) near(out.result.suggestedPrice.date.getTime(), out.result.optimal.date.getTime(), 6 * 60000)
  }
})

/* ───────── live recalibration (engine-spec §1) ───────── */

/** The user's first month (12 decided first offers, 1 accepted), anonymised: titles and links removed, everything the fit reads kept. */
const REAL_LIKE = [{"id":"r1","title":"Articolo 1","link":"","createdAt":"2026-10-28T09:55:39.638Z","status":"bought","outcomeAt":"2026-10-31T08:47:03.556Z","listPrice":20,"targetPrice":17,"discountPct":15,"finalPrice":20,"probability":0.7833120224010645,"category":"collectible","form":{"category":"collectible","listPrice":"20","targetPrice":"17","listingAge":"weeks_1_2","sellerProfile":"expert","listingSignal":"none"},"negotiation":[{"by":"buyer","kind":"offer","price":17,"at":"2026-10-28T20:50:00.000Z","planned":true}],"decision":{"engine":"1.3.0","rawLogit":1.3950408600966813,"learnedWeight":0,"k":1,"probability":0.7833120224010645,"recommendedAt":"2026-10-28T20:50:00.000Z","profileId":"default"}},{"id":"r2","title":"Articolo 2","link":"","createdAt":"2026-10-17T13:44:31.810Z","sentAt":"2026-10-18T20:45:21.855Z","sentAtSource":"tap","status":"sent","outcomeAt":"2026-10-18T20:45:21.855Z","listPrice":22,"targetPrice":18,"discountPct":18.181818,"probability":0.6506557439589186,"category":"collectible","form":{"category":"collectible","listPrice":"22","targetPrice":"18","listingAge":"today","sellerProfile":"expert","listingSignal":"none"},"negotiation":[{"by":"buyer","kind":"offer","price":18,"at":"2026-10-18T20:45:21.855Z","planned":false}],"decision":{"engine":"1.3.0","rawLogit":0.7022173201829003,"learnedWeight":0,"k":0.988,"probability":0.6506557439589186,"recommendedAt":"2026-10-18T19:55:00.000Z","profileId":"default"}},{"id":"r3","title":"Articolo 3","link":"","createdAt":"2026-10-14T07:10:54.203Z","sentAt":"2026-10-14T19:45:00.000Z","sentAtSource":"imputed","status":"accepted","firstOutcome":"accepted","firstOutcomeAt":"2026-10-14T21:07:02.362Z","outcomeAt":"2026-10-14T21:07:02.362Z","listPrice":419,"targetPrice":335,"discountPct":20.047733,"finalPrice":335,"probability":0.6754826093648181,"category":"electronics","form":{"category":"electronics","listPrice":"419","targetPrice":"335","listingAge":"today","sellerProfile":"new_seller","listingSignal":"clearing_out"},"negotiation":[{"by":"buyer","kind":"offer","price":335,"at":"2026-10-14T19:45:00.000Z","planned":false}],"decision":{"engine":"1.3.0","rawLogit":0.7846602158424603,"learnedWeight":0,"k":1,"probability":0.6754826093648181,"recommendedAt":"2026-10-14T19:45:00.000Z","profileId":"default"}},{"id":"r4","title":"Articolo 4","link":"","createdAt":"2026-10-13T13:43:50.758Z","sentAt":"2026-10-13T20:35:41.066Z","sentAtSource":"tap","status":"declined","firstOutcome":"countered","firstOutcomeAt":"2026-10-17T17:12:37.711Z","outcomeAt":"2026-10-18T20:43:44.805Z","listPrice":469,"targetPrice":375,"discountPct":20.042644,"probability":0.5742120568444927,"category":"electronics","form":{"category":"electronics","listPrice":"469","targetPrice":"375","listingAge":"today","sellerProfile":"new_seller","listingSignal":"none"},"negotiation":[{"by":"buyer","kind":"offer","price":375,"at":"2026-10-13T20:35:41.066Z","planned":false},{"by":"seller","kind":"counter","price":440,"rawPrice":440,"at":"2026-10-17T17:12:37.711Z"},{"by":"buyer","kind":"counter","price":407,"at":"2026-10-17T20:01:39.153Z","planned":false}],"decision":{"engine":"1.3.0","rawLogit":0.3184604105328631,"learnedWeight":0,"k":1,"probability":0.5742120568444927,"recommendedAt":"2026-10-13T19:35:00.000Z","profileId":"default"}},{"id":"r5","title":"Articolo 5","link":"","createdAt":"2026-10-11T15:08:34.723Z","sentAt":"2026-10-11T19:50:00.000Z","sentAtSource":"imputed","status":"declined","firstOutcome":"declined","firstOutcomeAt":"2026-10-12T08:07:38.096Z","outcomeAt":"2026-10-12T08:07:38.096Z","listPrice":30,"targetPrice":24,"discountPct":20,"probability":0.7079816862604636,"category":"collectible","form":{"category":"collectible","listPrice":"30","targetPrice":"24","listingAge":"over_month","sellerProfile":"unknown","listingSignal":"none"},"negotiation":[{"by":"buyer","kind":"offer","price":24,"at":"2026-10-11T19:50:00.000Z","planned":false}],"decision":{"engine":"1.3.0","rawLogit":0.9507058750728903,"learnedWeight":0,"k":1,"probability":0.7079816862604636,"recommendedAt":"2026-10-11T19:50:00.000Z","profileId":"default"}},{"id":"r6","title":"Articolo 6","link":"","createdAt":"2026-10-10T22:33:18.812Z","sentAt":"2026-10-11T20:44:00.141Z","sentAtSource":"tap","status":"declined","firstOutcome":"declined","firstOutcomeAt":"2026-10-18T20:43:23.927Z","outcomeAt":"2026-10-18T20:43:23.927Z","listPrice":500,"targetPrice":380,"discountPct":24,"probability":0.614940514867817,"category":"electronics","form":{"category":"electronics","listPrice":"500","targetPrice":"380","listingAge":"weeks_1_2","sellerProfile":"new_seller","listingSignal":"none"},"negotiation":[{"by":"buyer","kind":"offer","price":380,"at":"2026-10-11T20:44:00.141Z","planned":false}],"decision":{"engine":"1.3.0","rawLogit":0.4992248188842454,"learnedWeight":0,"k":1,"probability":0.614940514867817,"recommendedAt":"2026-10-11T19:45:00.000Z","profileId":"default"}},{"id":"r7","title":"Articolo 7","link":"","createdAt":"2026-10-10T20:14:41.418Z","sentAt":"2026-10-11T20:44:34.329Z","sentAtSource":"tap","status":"declined","firstOutcome":"declined","firstOutcomeAt":"2026-10-31T08:47:32.949Z","outcomeAt":"2026-10-31T08:47:32.949Z","listPrice":9,"targetPrice":7,"discountPct":22.222222,"probability":0.6317572111541501,"category":"collectible","form":{"category":"collectible","listPrice":"9","targetPrice":"7","listingAge":"weeks_1_2","sellerProfile":"unknown","listingSignal":"none"},"negotiation":[{"by":"buyer","kind":"offer","price":7,"at":"2026-10-11T20:44:34.329Z","planned":false}],"decision":{"engine":"1.3.0","rawLogit":0.5937455203281463,"learnedWeight":0,"k":0.994,"probability":0.6317572111541501,"recommendedAt":"2026-10-11T19:55:00.000Z","profileId":"default"}},{"id":"r8","title":"Articolo 8","link":"","createdAt":"2026-10-08T08:55:11.938Z","sentAt":"2026-10-11T07:49:43.437Z","sentAtSource":"tap","status":"declined","firstOutcome":"declined","firstOutcomeAt":"2026-10-11T20:45:11.970Z","outcomeAt":"2026-10-11T20:45:11.970Z","listPrice":30,"targetPrice":22,"discountPct":26.666667,"probability":0.5323656912947824,"category":"collectible","form":{"category":"collectible","listPrice":"30","targetPrice":"22","listingAge":"over_month","sellerProfile":"unknown","listingSignal":"none"},"negotiation":[{"by":"buyer","kind":"offer","price":22,"at":"2026-10-11T07:49:43.437Z","planned":false}],"decision":{"engine":"1.3.0","rawLogit":0.1379446731902035,"learnedWeight":0,"k":1,"probability":0.5323656912947824,"recommendedAt":"2026-10-08T19:55:00.000Z","profileId":"default"}},{"id":"r9","title":"Articolo 9","link":"","createdAt":"2026-10-08T07:00:38.865Z","sentAt":"2026-10-11T10:46:20.960Z","sentAtSource":"imputed","status":"declined","firstOutcome":"declined","firstOutcomeAt":"2026-10-11T10:46:20.960Z","outcomeAt":"2026-10-11T10:46:20.960Z","listPrice":15,"targetPrice":10,"discountPct":33.333333,"probability":0.5184397955113325,"category":"other","form":{"category":"other","listPrice":"15","targetPrice":"10","listingAge":"days_2_6","sellerProfile":"new_seller","listingSignal":"none"},"negotiation":[{"by":"buyer","kind":"offer","price":10,"at":"2026-10-11T10:46:20.960Z","planned":false}],"decision":{"engine":"1.3.0","rawLogit":0.2135351124967937,"learnedWeight":0,"k":0.9426333351250001,"probability":0.5184397955113325,"recommendedAt":"2026-10-11T19:45:00.000Z","profileId":"default"}},{"id":"r10","title":"Articolo 10","link":"","createdAt":"2026-10-05T15:47:43.719Z","status":"declined","firstOutcome":"countered","firstOutcomeAt":"2026-10-07T09:22:08.666Z","outcomeAt":"2026-10-11T20:44:57.198Z","listPrice":27,"targetPrice":18,"discountPct":33.333333,"probability":0.5424160135310869,"category":"other","form":{"category":"other","listPrice":"27","targetPrice":"18","listingAge":"unknown","sellerProfile":"unknown","listingSignal":"none"},"negotiation":[{"by":"buyer","kind":"offer","price":18,"at":"2026-10-05T19:55:00.000Z","planned":false},{"by":"seller","kind":"counter","price":24,"at":"2026-10-07T09:22:08.666Z"},{"by":"buyer","kind":"counter","price":19.8,"at":"2026-10-08T06:52:01.444Z","planned":false}]},{"id":"r11","title":"Articolo 11","link":"","createdAt":"2026-10-05T14:24:00.329Z","status":"declined","firstOutcome":"countered","firstOutcomeAt":"2026-10-07T19:25:30.562Z","outcomeAt":"2026-10-08T18:16:28.325Z","listPrice":13.5,"targetPrice":8.5,"discountPct":37.037037,"probability":0.28516853409864334,"category":"other","form":{"category":"other","listPrice":"13,5","targetPrice":"8,5","listingAge":"unknown","sellerProfile":"unknown","listingSignal":"none"},"negotiation":[{"by":"buyer","kind":"offer","price":8.5,"at":"2026-10-07T19:45:00.000Z","planned":false},{"by":"seller","kind":"counter","price":12,"at":"2026-10-07T19:25:30.562Z"},{"by":"buyer","kind":"counter","price":9.8,"at":"2026-10-08T17:11:48.245Z","planned":false}]},{"id":"r12","title":"Articolo 12","link":"","createdAt":"2026-10-05T09:04:28.216Z","sentAt":"2026-10-07T19:34:34.807Z","sentAtSource":"imputed","status":"declined","firstOutcome":"declined","firstOutcomeAt":"2026-10-07T19:34:34.807Z","outcomeAt":"2026-10-07T19:34:34.807Z","listPrice":35,"targetPrice":23,"discountPct":34.285714,"probability":0.4002499001393909,"category":"other","form":{"category":"other","listPrice":"35","targetPrice":"23","listingAge":"unknown","sellerProfile":"unknown","listingSignal":"none"},"negotiation":[{"by":"buyer","kind":"offer","price":23,"at":"2026-10-07T19:40:00.000Z","planned":false}]},{"id":"r13","title":"Articolo 13","link":"","createdAt":"2026-10-10T22:30:33.343Z","sentAt":"2026-10-11T19:40:00.000Z","sentAtSource":"imputed","status":"sold_other","firstOutcome":"sold_other","firstOutcomeAt":"2026-10-11T20:43:00.736Z","outcomeAt":"2026-10-11T20:43:00.736Z","listPrice":500,"targetPrice":355,"discountPct":29,"probability":0.509380175566363,"category":"electronics","form":{"category":"electronics","listPrice":"500","targetPrice":"355","listingAge":"weeks_2_4","sellerProfile":"unknown","listingSignal":"none"},"negotiation":[{"by":"buyer","kind":"offer","price":355,"at":"2026-10-11T19:40:00.000Z","planned":false}],"decision":{"engine":"1.3.0","rawLogit":0.039920941635578994,"learnedWeight":0,"k":1,"probability":0.509380175566363,"recommendedAt":"2026-10-11T19:40:00.000Z","profileId":"default"},"deletedAt":"2026-10-13T13:39:44.198Z"}]
const REAL_NOW = new Date('2026-11-01T08:47:32.952Z')

test('live fit on the real-like month: the engine prior lands under a third, the fit pulls further toward the observed 1 in 12', () => {
  const records = buildDataset(REAL_LIKE, REAL_NOW)
  const decided = records.filter((r) => r.y != null && Number.isFinite(r.rawLogit))
  assert.equal(decided.length, 12)
  assert.equal(decided.filter((r) => r.y === 1).length, 1)
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  assert.ok(mean(decided.map((r) => r.pShown)) > 0.5, 'the 1.3.0 engine showed over 50% on average')
  const engineMean = mean(decided.map((r) => predictWith(null, r)))
  assert.ok(engineMean >= 0.18 && engineMean <= 0.35, `prior reset: mean ${engineMean}`)
  const live = liveProfile(records, REAL_NOW)
  assert.equal(live.basedOn, 12)
  assert.ok(live.nEff > 10)
  assert.ok(live.fitted.intercept <= -0.5, `fitted intercept ${live.fitted.intercept}`)
  assert.ok(live.sd.intercept > 0.5 && live.sd.intercept < 0.9, `sd ${live.sd.intercept}`)
  assert.equal(live.status.dslope, 'waiting_data', 'two discount arms but under 15 weighted outcomes')
  assert.equal(live.profile.dslope, 0)
  // Whether the one-sd gate is open depends on the exact logits (0,8–1,0 sd here): applied → the mode; otherwise 0.
  if (live.status.intercept === 'applied') assert.ok(live.profile.intercept <= -0.5)
  else assert.equal(live.profile.intercept, 0)
  const fitted = normalizeProfile({ intercept: live.fitted.intercept })
  const correctedMean = mean(decided.map((r) => predictWith(fitted, r)))
  assert.ok(correctedMean >= 0.1 && correctedMean <= 0.25, `corrected mean ${correctedMean}`)
  assert.ok(Math.abs(calibrationMetrics(decided.map((r) => [predictWith(fitted, r), r.y])).oeZ) < 1.5)
  // The plan never sent (bought at list price) is not a record; the two counter-screen items date their first offer
  // from the negotiation history, so all 12 records calibrate the first offer.
  assert.equal(records.length, 12)
  assert.ok(records.every((r) => r.sentKnown))
  assert.equal(REAL_LIKE.length, 13)
  // The honest range on a typical item with this profile: no wider than 30 points, lower bound near the observed rate.
  const profile = { ...live.profile, intercept: live.fitted.intercept, live: true }
  const typical = analyzeOffer({ category: 'collectible', listPrice: '30', targetPrice: '24', listingAge: 'weeks_1_2', sellerProfile: 'unknown', listingSignal: 'none' }, new Date(2026, 9, 7, 15, 0), { profile })
  assert.equal(typical.probabilityRange.n, 12)
  assert.ok(typical.probabilityRange.high - typical.probabilityRange.low <= 0.3)
  assert.ok(typical.probabilityRange.low <= 0.12)
  assert.ok(typical.probability >= 0.1 && typical.probability <= 0.25)
})

test('live fit: outcomes generated by the engine itself leave it alone; one discount arm never earns a slope', () => {
  for (const seed of [1, 2, 3]) {
    const items = syntheticItems({ months: 4, perMonth: 10, shift: 0, seed })
    const now = new Date(2026, 7, 10)
    const live = liveProfile(buildDataset(items, now), now)
    assert.ok(live.basedOn >= 35, `${live.basedOn} outcomes`)
    assert.ok(Math.abs(live.profile.intercept) < 0.3, `seed ${seed}: intercept ${live.profile.intercept} (fitted ${live.fitted.intercept})`)
    assert.equal(live.profile.dslope, 0, `seed ${seed}: dslope`)
    assert.ok(live.gain == null || !live.gain.admitted)
  }
  // 30 outcomes all at −20%: tougher sellers, but no slope (one arm).
  const flat = Array.from({ length: 30 }, (_, i) => rec(`f${i}`, i % 5 === 0 ? 1 : 0, { discountPct: 20, now: new Date(2026, 9, 1) }))
  const out = liveProfile(flat, new Date(2026, 9, 1))
  assert.ok(out.profile.intercept < -0.5)
  assert.equal(out.profile.dslope, 0)
  assert.equal(out.status.dslope, 'waiting_data')
  assert.deepEqual(Object.keys(out.arms), ['d20'])
  // Two arms with a real slope: deep asks refused, soft asks accepted → a negative slope, bounded, curve still falling.
  const twoArms = [
    ...Array.from({ length: 16 }, (_, i) => rec(`s${i}`, i % 4 === 0 ? 0 : 1, { discountPct: 10, now: new Date(2026, 9, 1) })),
    ...Array.from({ length: 16 }, (_, i) => rec(`d${i}`, i % 8 === 0 ? 1 : 0, { discountPct: 32, now: new Date(2026, 9, 1) })),
  ]
  const sloped = liveProfile(twoArms, new Date(2026, 9, 1))
  assert.equal(sloped.status.dslope, 'applied', `gain ${JSON.stringify(sloped.gain)}`)
  assert.ok(sloped.profile.dslope < 0 && sloped.profile.dslope >= LEARNING.BOUNDS.dslope[0])
  assert.equal(sloped.status.intercept, 'applied', 'the pair is applied together')
  assert.ok(sloped.profile.cov.length === 2 && sloped.profile.paramKeys[1] === 'dslope')
  const row = learnedOfferRow(sloped.profile, { logit: 0, windowId: 'sunday_night', discountPct: 30 })
  near(row.learned.dslope, sloped.profile.dslope, 1e-12)
  assert.ok(learnedOfferRow(sloped.profile, { logit: 0, windowId: 'sunday_night', discountPct: 10 }).weight > row.weight)
})

test('engine bump: a profile fitted against another engine drops its first-offer corrections and keeps the counter side', () => {
  const fitted = normalizeProfile({ intercept: -0.8, dslope: -0.2, slope: 1.1, time: { prime_evening: -0.2 }, disc: { d30: -0.3 }, counter: -0.3, counterShare: 1.2, sellerReplyHours: 5, basedOn: 20, cov: [[0.1, 0], [0, 0.1]], paramKeys: ['intercept', 'dslope'], live: true, appliedAt: '2026-10-01T00:00:00.000Z' })
  assert.equal(fitted.engine, ENGINE_VERSION)
  assert.equal(fitted.intercept, -0.8)
  const stale = normalizeProfile({ ...fitted, engine: '1.3.0' })
  assert.ok(profileIsStale({ ...fitted, engine: '1.3.0' }))
  assert.equal(stale.intercept, 0)
  assert.equal(stale.dslope, 0)
  assert.equal(stale.slope, 1)
  assert.equal(stale.time.prime_evening, 0)
  assert.equal(stale.disc.d30, 0)
  assert.equal(stale.cov, null)
  assert.equal(stale.basedOn, 0)
  assert.equal(stale.live, false)
  assert.equal(stale.counter, -0.3)
  assert.equal(stale.counterShare, 1.2)
  assert.equal(stale.sellerReplyHours, 5)
  assert.equal(stale.engine, ENGINE_VERSION)
  assert.equal(firstOfferCorrected(stale), false)
  // A stored v2 profile (no stamp) is stale; a bare hand-built correction is current.
  assert.equal(normalizeProfile({ version: 2, intercept: -0.5, counter: 0.2 }).intercept, 0)
  assert.equal(normalizeProfile({ version: 2, intercept: -0.5, counter: 0.2 }).counter, 0.2)
  assert.equal(normalizeProfile({ intercept: -0.5 }).intercept, -0.5)
  assert.equal(profileIsStale(DEFAULT_PROFILE), false)
  // The decision snapshot carries the engine, so the replay can tell which prior showed each estimate.
  assert.equal(decisionSnapshot(analyzeOffer(FORM, NOW), { now: NOW }).engine, ENGINE_VERSION)
})

test('scale leak: a pure shift the intercept prior cannot absorb does not earn the offsets an admission', () => {
  const saved = LEARNING.PRIOR_SD.intercept
  LEARNING.PRIOR_SD.intercept = 0.5
  try {
    for (const seed of [1, 2, 3]) {
      const items = syntheticItems({ months: 4, perMonth: 10, shift: -2.5, seed })
      const now = new Date(2026, 7, 10)
      const fit = fitFirstOffers(buildDataset(items, now), now)
      assert.ok(fit.n >= 35)
      assert.ok(fit.theta.intercept > -1.6, `the 0,5 prior shrinks the −2,5 shift to ${fit.theta.intercept}`)
      assert.equal(fit.ladder.offsets.admitted, false, `seed ${seed}: offsets gain ${fit.ladder.offsets.gain}`)
      const offsets = Object.entries(fit.theta).filter(([k]) => k.startsWith('time.') || k.startsWith('disc.'))
      assert.ok(offsets.every(([, v]) => Math.abs(v) < 0.5), `seed ${seed}: ${JSON.stringify(offsets)}`)
      const timeKeys = offsets.filter(([k]) => k.startsWith('time.') && fit.nEff[k] > 0)
      near(timeKeys.reduce((s, [k, v]) => s + fit.nEff[k] * v, 0), 0, 1e-6, 'centred: the leaked shift is not in the offsets')
    }
  } finally {
    LEARNING.PRIOR_SD.intercept = saved
  }
})

test('live fit inside the monthly report: one correction, shown as live; the offsets fit the residual after it', () => {
  const items = syntheticItems({ months: 6, perMonth: 14, shift: -0.8, seed: 7 })
  const now = new Date(2026, 9, 1, 9)
  const rep = monthlyReport({ items, month: '2026-09', now })
  assert.ok(['applied', 'waiting_data'].includes(rep.live.status.intercept))
  const row = rep.changes.find((c) => c.key === 'intercept')
  assert.equal(row.status, rep.live.status.intercept === 'applied' ? 'live' : 'waiting_data')
  assert.equal(row.minEffective, LEARNING.LIVE.MIN_EFFECTIVE)
  assert.ok(rep.changes.some((c) => c.key === 'dslope'))
  assert.ok(!rep.changes.some((c) => c.key === 'slope'), 'the monthly slope is no longer a parameter of the profile')
  assert.equal(rep.nextProfile.intercept, rep.live.profile.intercept)
  assert.equal(rep.nextProfile.basedOn, rep.live.basedOn)
  assert.deepEqual(rep.nextProfile.paramKeys, ['intercept', 'dslope'])
  assert.equal(rep.byPriceBand.length, 3)
  assert.equal(rep.byPriceBand.reduce((s, b) => s + b.n, 0), rep.records.filter((r) => r.y != null && Number.isFinite(r.rawLogit)).length)
  const files = unzip(reportWorkbook(rep))
  assert.ok(files['xl/worksheets/sheet7.xml'].includes('fascia di prezzo'))
  if (rep.live.status.intercept === 'applied') {
    assert.ok(files['xl/worksheets/sheet10.xml'].includes('Applicata (dal vivo)'))
    assert.ok(rep.notes.some((n) => n.includes('dal vivo')))
  }
  for (const xml of Object.values(files)) assert.ok(!/undefined|NaN|\[object Object\]/.test(xml))
  // The corrected engine predicts the history at least as well as the plain one.
  const decided = rep.records.filter((r) => r.y != null)
  const ll = (p) => decided.reduce((s, r) => s - (r.y ? Math.log(predictWith(p, r)) : Math.log(1 - predictWith(p, r))), 0)
  assert.ok(ll(rep.nextProfile) <= ll(null) + 1e-9)
})

test('live history and checkpoints: one entry per day, monthly entries untouched, the checkpoint is the live profile applied 30 days ago', () => {
  const day = (d) => new Date(2026, 9, d, 12)
  const prof = (d, intercept) => normalizeProfile({ id: `live.2026-10-${String(d).padStart(2, '0')}`, intercept, live: true, appliedAt: day(d).toISOString(), month: '2026-09' })
  let history = [{ id: '2026-09', month: '2026-09', intercept: 0, changes: [] }]
  history = withLiveHistory(history, prof(1, -0.5))
  history = withLiveHistory(history, prof(1, -0.6))
  history = withLiveHistory(history, prof(3, -0.7))
  assert.equal(history.length, 3)
  assert.equal(history.find((p) => p.id === 'live.2026-10-01').intercept, -0.6, 'the newest value of the day wins')
  assert.equal(history[0].id, '2026-09', 'monthly entries stay')
  assert.ok(history.filter((p) => p.live).every((p) => p.month === null), 'live entries carry no month')
  for (let d = 4; d <= 20; d++) history = withLiveHistory(history, prof(d, -0.7))
  assert.equal(history.filter((p) => p.live).length, 12, 'at most 12 live entries')
  assert.ok(history.some((p) => p.id === '2026-09'))
  assert.equal(liveCheckpoint(history, day(25)), null, 'nothing applied 30 days ago yet')
  assert.equal(liveCheckpoint(history, new Date(2026, 10, 12)).id, 'live.2026-10-12')
  assert.equal(liveCheckpoint(history, new Date(2026, 10, 15)).id, 'live.2026-10-15')
  assert.equal(liveCheckpoint(null, day(1)), null)
  assert.equal(liveDiffers(prof(3, -0.7), prof(3, -0.7)), false)
  assert.equal(liveDiffers(prof(3, -0.7), prof(3, -0.75)), true)
  assert.equal(withLiveHistory(history, normalizeProfile({ intercept: 0 })).length, history.length, 'an inactive profile adds nothing')
})

/* ───────── engine 1.4.0 part 2: Thompson arms, logging, the policy shift (engine-spec §2.3, §5, §6) ───────── */

const T_FORM = { itemTitle: 'Felpa', category: 'other', listPrice: '60', targetPrice: '48', listingAge: 'weeks_1_2', sellerProfile: 'unknown', listingSignal: 'none', link: 'https://www.vinted.it/items/777-felpa' }
const propsOf = (out) => Object.fromEntries(out.exploration.arms.map((a) => [a.id, a.propensity]))

test('thompson: three arms around the policy default, exact floor, sum one, same key and month → same arm, nothing under 12 €', () => {
  const base = analyzeOffer(T_FORM, NOW)
  const a = thompsonArm(T_FORM, base, NOW, { key: 'www.vinted.it/items/777', month: '2026-10' })
  assert.ok(a, 'an arm is always drawn (the base arm is a plan too)')
  assert.deepEqual(THOMPSON_ARMS.map((x) => x.id), ['softer', 'base', 'deeper'])
  assert.deepEqual(a.exploration.arms.map((x) => x.id), ['softer', 'base', 'deeper'], 'p(d₀) ≥ 0,3, not premium, 60 €: the deeper arm is allowed')
  assert.equal(a.exploration.d0, 20, 'no policy on the form: d₀ is the current discount')
  // Prices sit on the engine's 1 € grid (60 € → 50 / 48 / 46), so the discounts are the grid's, not exactly ±4.
  assert.deepEqual(a.exploration.arms.map((x) => x.price), [50, 48, 46])
  assert.deepEqual(a.exploration.arms.map((x) => x.discountPct), [16.7, 20, 23.3])
  assert.equal(a.exploration.draws, LEARNING.THOMPSON_DRAWS)
  const mu = propsOf(a)
  near(Object.values(mu).reduce((s, v) => s + v, 0), 1, 1e-6, 'Σμ = 1')
  for (const v of Object.values(mu)) assert.ok(v >= LEARNING.THOMPSON_MIN_PROPENSITY - 1e-9, `propensity ${v} under the floor`)
  assert.equal(a.exploration.propensity, mu[a.exploration.arm])
  assert.equal(a.exploration.base.price, 48)
  near(a.exploration.base.probability, base.probability, 1e-12)
  assert.equal(a.result.exploration, a.exploration)
  assert.equal(typeof a.exploration.costPoints, 'number')
  assert.equal(a.exploration.method, 'thompson')
  assert.equal(a.exploration.posterior, 'prior')
  // Deterministic per listing and month.
  const b = thompsonArm(T_FORM, base, NOW, { key: 'www.vinted.it/items/777', month: '2026-10' })
  assert.deepEqual(b.exploration, a.exploration)
  assert.equal(b.result.input.targetPrice, a.result.input.targetPrice)
  // Across listings every arm is drawn, with the logged propensities as frequencies (loosely).
  const tally = { softer: 0, base: 0, deeper: 0 }
  for (let i = 0; i < 120; i++) tally[thompsonArm(T_FORM, base, NOW, { key: `k${i}`, month: '2026-10' }).exploration.arm]++
  for (const id of Object.keys(tally)) assert.ok(tally[id] >= 4, `${id} drawn ${tally[id]} times in 120`)
  // The chosen arm's analysis is at the arm's price and the base moment; the base arm at the user's price is the analysis itself.
  const chosen = a.exploration.arms.find((x) => x.id === a.exploration.arm)
  assert.equal(a.result.input.targetPrice, chosen.price)
  if (a.exploration.arm === 'base') assert.equal(a.exploration.varied, false)
  else assert.ok(Math.abs(a.result.optimal.date.getTime() - base.optimal.date.getTime()) <= 3 * 3_600_000)
  // Off switch, and no exploration under 12 €.
  assert.equal(thompsonArm(T_FORM, base, NOW, { key: 'k', month: '2026-10', enabled: false }), null)
  const cheap = { ...T_FORM, listPrice: '11', targetPrice: '9' }
  assert.equal(thompsonArm(cheap, analyzeOffer(cheap, NOW), NOW, { key: 'k', month: '2026-10' }), null)
  assert.equal(LEARNING.EXPLORE_MIN_LIST_PRICE, 12)
  // The policy default on the form sets d₀; a «no offer» policy falls back to the current discount.
  const withPolicy = thompsonArm({ ...T_FORM, policy: { kind: 'offer', discountPct: 12 } }, base, NOW, { key: 'k', month: '2026-10' })
  assert.equal(withPolicy.exploration.d0, 12)
  assert.deepEqual(withPolicy.exploration.arms.map((x) => x.price), [55, 53, 50])
  assert.equal(thompsonArm({ ...T_FORM, policy: { kind: 'no_offer', discountPct: null } }, base, NOW, { key: 'k', month: '2026-10' }).exploration.d0, 20)
})

test('thompson: a posterior that says «rifiutano dal 20% in su» sends the softer arm ≥ 70%; the deeper arm never under p(d₀) 0,3 nor on premium items', () => {
  // Intercept −1 and dslope −1 (per 10 points), known precisely: acceptance collapses above 20%.
  const tough = normalizeProfile({ intercept: -1, dslope: -1, cov: [[0.01, 0], [0, 0.005]], paramKeys: ['intercept', 'dslope'], basedOn: 40, live: true })
  const base = analyzeOffer(T_FORM, NOW, { profile: tough })
  const out = thompsonArm(T_FORM, base, NOW, { key: 'k', month: '2026-10', profile: tough, options: { profile: tough } })
  const mu = propsOf(out)
  assert.ok(mu.softer >= 0.7, `softer ${mu.softer}`)
  assert.equal(out.exploration.posterior, 'live')
  assert.ok(base.probability < LEARNING.THOMPSON_DEEPER_MIN_P, `p(d₀) ${base.probability}`)
  assert.ok(!out.exploration.arms.some((x) => x.id === 'deeper'), 'deeper excluded under 0,3')
  near(Object.values(mu).reduce((s, v) => s + v, 0), 1, 1e-6)
  for (const v of Object.values(mu)) assert.ok(v >= LEARNING.THOMPSON_MIN_PROPENSITY - 1e-9)
  // Premium category, or under 20 €: no deeper arm even with a good base probability.
  const lux = { ...T_FORM, category: 'luxury', listPrice: '300', targetPrice: '270' }
  const luxOut = thompsonArm(lux, analyzeOffer(lux, NOW), NOW, { key: 'k', month: '2026-10' })
  assert.ok(luxOut && !luxOut.exploration.arms.some((x) => x.id === 'deeper'))
  const small = { ...T_FORM, listPrice: '15', targetPrice: '12' }
  const smallOut = thompsonArm(small, analyzeOffer(small, NOW), NOW, { key: 'k', month: '2026-10' })
  assert.ok(smallOut && !smallOut.exploration.arms.some((x) => x.id === 'deeper'), 'under 20 €: no deeper arm')
  assert.deepEqual(smallOut.exploration.arms.map((x) => x.price), [12.5, 12], '0,50 grid under 20 €')
  // q and ρ: the priors without records, the user's own continuation with them.
  const priors = continuationPosterior(null, NOW)
  near(priors.q, LEARNING.CLOSE_AFTER_FAIL_PRIOR, 1e-12)
  near(priors.rho, LEARNING.CONTINUATION_RATIO_PRIOR, 1e-12)
  const records = buildDataset(REAL_LIKE, REAL_NOW)
  assert.ok(continuationPosterior(records, REAL_NOW).q < priors.q, 'three counters, all lost: the chance to close after a no falls')
})

test('snapshot (engine-spec §6): extraction, signals, market, policy, gate, message policy, factors, tier ride on the decision', () => {
  const market = { n: 5, p25Price: 50, medianPrice: 70, p75Price: 90 }
  const form = { ...T_FORM, signals: { favourites: 2, views: 300, sellerItems: 3, priceDrop: { from: 70, to: 60, hoursAgo: 80 } }, policy: { kind: 'offer', band: 'from_40_to_100', ageTier: 'mid', table: 15, modifiers: [{ id: 'new_seller', pts: 2, label: 'venditore nuovo' }], shift: 0, discountPct: 17 } }
  const r = analyzeOffer(form, NOW, { market, key: 'www.vinted.it/items/777', month: '2026-10' })
  const ex = { uploadedDays: 10, sellerLastSeenDays: 0.5, sellerFeedbackCount: 12, sellerRating: 4.9, sellerBusiness: false, sellerBadges: ['ACTIVE_LISTER'], condition: 'usato', brand: 'Nike', categoryText: 'Uomo Felpe', title: 'Felpa', description: 'Svuoto l\'armadio' }
  const snap = decisionSnapshot(r, { now: NOW, extraction: ex, market })
  assert.equal(snap.engine, ENGINE_VERSION)
  assert.deepEqual(snap.extraction, { uploadedDays: 10, sellerLastSeenDays: 0.5, sellerFeedbackCount: 12, sellerRating: 4.9, sellerBusiness: false, sellerBadges: ['ACTIVE_LISTER'], condition: 'usato', brand: 'Nike', categoryText: 'Uomo Felpe', textHits: ['clearing_out'] })
  assert.deepEqual(snap.signals, { favourites: 2, interested: null, views: 300, sellerItems: 3, bundleDiscountPct: null, lastSeenDays: null, priceDrop: { from: 70, to: 60, hoursAgo: 80 }, reserved: null, vacation: null })
  assert.deepEqual(snap.market, { n: 5, medianPrice: 70, p25Price: 50, p75Price: 90, gapPct: null, at: NOW.toISOString() })
  assert.deepEqual(snap.policy, { band: 'from_40_to_100', ageTier: 'mid', table: 15, modifiers: [{ id: 'new_seller', pts: 2 }], shift: 0, d0: 17, kind: 'offer', source: null })
  assert.deepEqual(snap.gate, { kind: r.gate.kind, rule: r.gate.rule, waitHours: null })
  assert.deepEqual(snap.messagePolicy, { mode: r.messagePolicy.mode, rule: r.messagePolicy.rule, tone: r.messagePolicy.tone, randomised: r.messagePolicy.randomised, propensity: r.messagePolicy.propensity, assigned: r.messagePolicy.assigned })
  assert.deepEqual(snap.tier, { id: r.tier.id, label: r.tier.label })
  assert.ok(snap.factors.some((f) => f.id === 'demand' && f.prior === true))
  assert.ok(snap.factors.some((f) => f.id === 'market' && f.prior === false))
  assert.equal(snap.appliedCorrection, 0)
  assert.equal(snap.probabilityRange.n, 0)
  // Without the optional inputs: nulls, never guesses; an old-style call still works.
  const bare = decisionSnapshot(analyzeOffer(FORM, NOW), { now: NOW })
  assert.equal(bare.extraction, null)
  assert.equal(bare.signals, null)
  assert.equal(bare.market, null)
  assert.equal(bare.policy, null)
  assert.equal(bare.gate.kind, 'message_first')
  assert.equal(bare.exploration, null)
  assert.equal(snapshotSignals({ priceDropped: true, oldPrice: 70 }).priceDrop.from, 70)
  assert.equal(snapshotSignals(null), null)
  assert.ok(JSON.parse(JSON.stringify(snap)), 'JSON round-trips')
})

test('rescoring (engine-spec §6): the record rebuilt with the item\'s market and signals gives the stored rawLogit back', () => {
  const market = { n: 5, p25Price: 50, medianPrice: 70, p75Price: 90 }
  const signals = { favourites: 7, views: 300, sellerItems: 3, priceDrop: { from: 70, to: 60, hoursAgo: 80 } }
  const form = { ...T_FORM, signals }
  const r = analyzeOffer(form, NOW, { market })
  const snap = decisionSnapshot(r, { now: NOW, market })
  const sentAt = r.optimal.date
  const item = {
    id: 'rs', createdAt: NOW.toISOString(), listPrice: 60, targetPrice: 48, discountPct: r.input.discountPct, form, signals, market, sentAt: sentAt.toISOString(), sentAtSource: 'tap',
    status: 'declined', firstOutcome: 'declined', outcomeAt: new Date(sentAt.getTime() + 3600e3).toISOString(), decision: snap, messageCopiedAt: new Date(sentAt.getTime() - 60e3).toISOString(), answered: true,
  }
  const rec = learningRecord(item, new Date(NOW.getTime() + 20 * 86400e3))
  near(rec.rawLogit, snap.rawLogit, 1e-6, 'rawLogit')
  near(rec.k, snap.k, 1e-9, 'k')
  assert.ok(rec.factors.some((f) => f.id === 'market'), 'the market factor is back on the record')
  assert.equal(rec.priceBand, 'over_50')
  assert.equal(rec.ageTier, 'mid')
  assert.equal(rec.arm, null)
  assert.equal(rec.propensity, null)
  assert.equal(rec.messageBefore, true, 'copied before the send')
  assert.equal(rec.answered, 1)
  assert.equal(rec.userOverride, false)
  assert.equal(rec.gateKind, r.gate.kind)
  assert.equal(rec.messageMode, r.messagePolicy.mode)
  assert.equal(rec.marketGap, -14)
  assert.equal(rec.tier, r.tier.id)
  // Without the market on the item the rescored logit differs (the market factor is gone): the fix is the point.
  const noMarket = learningRecord({ ...item, market: null }, new Date(NOW.getTime() + 20 * 86400e3))
  assert.ok(Math.abs(noMarket.rawLogit - snap.rawLogit) > 0.05)
  // Overrides and silence.
  const over = learningRecord({ ...item, targetPrice: 46, userOverride: 46 }, new Date(NOW.getTime() + 20 * 86400e3))
  assert.equal(over.userOverride, true)
  const silent = learningRecord({ ...item, status: 'no_reply', firstOutcome: 'no_reply', answered: null, messageCopiedAt: null }, new Date(NOW.getTime() + 20 * 86400e3))
  assert.equal(silent.answered, 0)
  assert.equal(silent.messageBefore, true, 'the policy assigned a message first')
  // With a Thompson arm on the decision, arm and propensity reach the record.
  const base = analyzeOffer(T_FORM, NOW)
  const varied = thompsonArm(T_FORM, base, NOW, { key: 'k', month: '2026-10' })
  const withArm = learningRecord({ ...item, decision: decisionSnapshot(varied.result, { now: NOW, exploration: varied.exploration }) }, new Date(NOW.getTime() + 20 * 86400e3))
  assert.equal(withArm.arm, varied.exploration.arm)
  near(withArm.propensity, varied.exploration.propensity, 1e-12)
})

test('dataset round-trip of the real-like backup: the new fields are null on old items, nothing throws', () => {
  const records = buildDataset(REAL_LIKE, REAL_NOW)
  assert.equal(records.length, 12)
  for (const r of records) {
    assert.ok(['fresh', 'mid', 'old'].includes(r.ageTier), r.id)
    assert.equal(r.arm, null)
    assert.equal(r.propensity, null)
    assert.equal(r.messageBefore, null, 'no message log on the old items')
    assert.ok([0, 1, null].includes(r.answered), 'sold to someone else says nothing about an answer')
    assert.ok(r.userOverride === null || r.userOverride === false, `${r.id}: ${r.userOverride}`)
    assert.equal(r.gateKind, null)
    assert.equal(r.messageMode, null)
    assert.equal(r.marketGap, null)
    assert.equal(r.signals, null)
    assert.ok(Array.isArray(r.factors) && r.factors.length >= 10)
    assert.equal(r.tier, null)
  }
  assert.equal(records.filter((r) => r.answered === 1).length, 10, 'ten answers, one silence, one sold to someone else')
  assert.equal(records.filter((r) => r.answered === 0).length, 1)
  // A monthly report still runs on them, with the shift waiting for data (nEff under 10 on the table's items).
  const rep = monthlyReport({ items: REAL_LIKE, month: '2026-10', now: REAL_NOW })
  const shift = rep.changes.find((c) => c.key === 'discountShift')
  assert.equal(shift.status, 'waiting_data')
  assert.equal(shift.to, 0)
  assert.ok(!rep.changes.some((c) => c.key === 'discountPct'), 'the default discount is no longer learned: the table owns the ask')
  assert.equal(rep.nextProfile.discountPct, 20)
  assert.equal(rep.discount.shift.n, 10, 'two items the table would not ask on are left out')
  assert.deepEqual(rep.exploration.map((a) => a.id), ['none', 'softer', 'base', 'deeper'])
  assert.equal(rep.exploration.ipw, null)
  const files = unzip(reportWorkbook(rep))
  assert.ok(files['xl/worksheets/sheet9.xml'].includes('servono almeno 6 offerte per braccio'))
  for (const xml of Object.values(files)) assert.ok(!/undefined|NaN|\[object Object\]/.test(xml))
})

test('discountShift (engine-spec §2.3): clamped to ±6, zero without a correction, moves with it, one point a month behind the gate', () => {
  assert.equal(normalizeProfile({ discountShift: 9 }).discountShift, 6)
  assert.equal(normalizeProfile({ discountShift: -9 }).discountShift, -6)
  assert.equal(normalizeProfile({ discountShift: 'x' }).discountShift, 0)
  assert.equal(DEFAULT_PROFILE.discountShift, 0)
  assert.deepEqual(LEARNING.BOUNDS.discountShift, [-6, 6])
  assert.equal(profileIsActive(normalizeProfile({ discountShift: 2 })), true)
  assert.equal(firstOfferCorrected(normalizeProfile({ discountShift: 2 })), false, 'the shift does not touch the first-offer estimate')
  const items = syntheticItems({ months: 4, perMonth: 14 })
  const now = new Date(2026, 7, 1)
  const recs = buildDataset(items, now)
  const none = isoAcceptanceShift(recs, DEFAULT_PROFILE, now)
  assert.equal(none.target, 0, 'uncorrected engine: no shift')
  assert.ok(none.nEff >= 10)
  assert.ok(isoAcceptanceShift(recs, normalizeProfile({ intercept: -0.5 }), now).target < 0, 'tough sellers: softer table')
  assert.ok(isoAcceptanceShift(recs, normalizeProfile({ intercept: 0.5 }), now).target > 0, 'generous sellers: deeper table')
  assert.equal(isoAcceptanceShift([], DEFAULT_PROFILE, now).target, null)
  // Through the monthly path: at most one point a month, never from under 10 weighted outcomes.
  const fit = { theta: { intercept: 0 }, nEff: { intercept: 0 }, keys: ['intercept'], cov: null, n: 0, weightTotal: 0, ladder: {} }
  const tough = normalizeProfile({ intercept: -0.9, live: true })
  const out = proposeProfile({ previous: tough, firstFit: fit, records: recs, month: '2026-07', now, live: { profile: tough, status: { intercept: 'applied', dslope: 'waiting_data' }, nEff: 40, fitted: { intercept: -0.9, dslope: 0 } } })
  const row = out.changes.find((c) => c.key === 'discountShift')
  assert.ok(['applied', 'capped'].includes(row.status), row.status)
  assert.equal(row.to, -1, 'one point a month')
  assert.equal(out.profile.discountShift, -1)
  const few = proposeProfile({ previous: tough, firstFit: fit, records: recs.slice(0, 5), month: '2026-07', now, live: { profile: tough, status: { intercept: 'applied', dslope: 'waiting_data' }, nEff: 5, fitted: { intercept: -0.9, dslope: 0 } } })
  assert.equal(few.changes.find((c) => c.key === 'discountShift').status, 'waiting_data')
  assert.equal(few.profile.discountShift, 0)
})

test('report «Varianti di test» (engine-spec §5.4): the three arms with n, accepted, expected, O − E, and the IPW difference only with 6 per arm', () => {
  const mk = (id, arm, propensity, y) => ({ ...rec(id, y, { now: NOW }), exploration: arm ? { method: 'thompson', arm, propensity } : null, propensity: arm ? propensity : null, closed: y === 1, savingShare: y === 1 ? 0.2 : null })
  const few = [...Array.from({ length: 5 }, (_, i) => mk(`s${i}`, 'softer', 0.5, i % 2)), ...Array.from({ length: 6 }, (_, i) => mk(`b${i}`, 'base', 0.4, 0)), mk('n', null, null, 1)]
  const rowsFew = explorationStats(few, null)
  assert.deepEqual(rowsFew.map((r) => [r.id, r.n]), [['none', 1], ['softer', 5], ['base', 6], ['deeper', 0]])
  assert.equal(rowsFew.ipw, null, 'five softer offers are not enough')
  const enough = [...few, mk('s5', 'softer', 0.5, 1)]
  const rows = explorationStats(enough, null)
  assert.ok(rows.ipw)
  assert.equal(rows.ipw.nSofter, 6)
  assert.equal(rows.ipw.nBase, 6)
  near(rows.ipw.diff, 0.5, 1e-9, 'equal propensities within an arm: the plain rates')
  assert.ok(rows.ipw.se > 0 && rows.ipw.se < 0.5)
  const softer = rows.find((r) => r.id === 'softer')
  assert.equal(softer.successes, 3)
  near(softer.expected, 6 * squash(0), 0.01)
  near(softer.oe, 3 - 6 * squash(0), 0.01)
  near(softer.ipwRate, 0.5, 1e-9)
  // Unequal propensities: the weighted rate leans on the rarer offers.
  const skewed = [mk('a', 'base', 0.1, 1), mk('b', 'base', 0.9, 0), mk('c', 'base', 0.9, 0)]
  near(explorationStats(skewed, null).find((r) => r.id === 'base').ipwRate, 10 / (10 + 1 / 0.9 + 1 / 0.9), 1e-9)
  // Legacy ±1 h arms from 1.3 keep their own rows only when records carry them.
  const legacy = [{ ...mk('l', 'later', 0.05, 0), exploration: { arm: 'later', kind: 'time', propensity: 0.05 } }]
  assert.ok(explorationStats(legacy, null).some((r) => r.id === 'legacy_later'))
  assert.ok(!explorationStats(few, null).some((r) => r.id.startsWith('legacy_')))
})
