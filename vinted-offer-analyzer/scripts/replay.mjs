#!/usr/bin/env node
/**
 * Offline replay of the user's own offers against the CURRENT engine (engine-spec §8).
 *
 *   TZ=Europe/Rome node scripts/replay.mjs <backup.json> [--now=2026-10-31T12:00:00Z] [--json]
 *
 * Input: the app's JSON backup (the array of saved items, or an object with an `items` array). Every decided first
 * offer is rebuilt with `buildDataset` (the stored form, re-scored at the real send time), then three predictions
 * are compared with the observed outcome: the probability shown at the time (`decision.probability`, the engine of
 * that day: the 1.3.0 baseline for the first month), the plain engine as it is now, and the engine plus the live
 * profile fitted on these very records (`liveProfile`, when the engine exports it; the gated value, and the fitted
 * value before the gates as a what-if). Metrics: mean prediction vs observed rate, log loss, Brier, O/E with z,
 * Spiegelhalter Z, tables by price band × discount knot, and a leave-one-out log score of the live fit (each record
 * predicted by a profile fitted without it). Counterfactual acceptance under other discounts is NOT observable here.
 *
 * The time windows are Italian: the script refuses to run outside Europe/Rome, because every send time would land in
 * the wrong window otherwise.
 */
import { readFileSync } from 'node:fs'
import * as core from '../src/core/index.js'

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
if (tz !== 'Europe/Rome') {
  console.error(`Fuso orario ${tz}: esegui con TZ=Europe/Rome (le fasce orarie sono italiane).`)
  process.exit(2)
}

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.error('Uso: TZ=Europe/Rome node scripts/replay.mjs <backup.json> [--now=ISO] [--json]')
  process.exit(2)
}
const opt = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const asJson = args.includes('--json')

const parsed = JSON.parse(readFileSync(file, 'utf8'))
const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : []
if (!items.length) {
  console.error('Nessun articolo nel backup.')
  process.exit(1)
}

/** `now` = the explicit option, else one day after the latest timestamp in the backup (so the last outcomes count). */
const latest = Math.max(...items.flatMap((it) => [it.createdAt, it.sentAt, it.outcomeAt, ...(it.events || []).map((e) => e.at)].map((v) => (v ? new Date(v).getTime() : NaN)).filter(Number.isFinite)))
const now = opt('now') ? new Date(opt('now')) : new Date(latest + 86_400_000)

const { buildDataset, predictWith, calibrationMetrics, ENGINE_VERSION, LEARNING, normalizeProfile, discKnotOf } = core
const records = buildDataset(items, now)
const decided = records.filter((r) => r.y != null && Number.isFinite(r.rawLogit))
const mature = decided.filter((r) => now.getTime() - r.sentAt.getTime() >= LEARNING.NO_REPLY_AFTER_DAYS * 86_400_000)

const hasLive = typeof core.liveProfile === 'function'
const live = hasLive ? core.liveProfile(records, now) : null
// Fallback for an engine without the live fit: the monthly fit's posterior intercept, applied without gates.
const fallbackFit = !hasLive ? core.fitFirstOffers(records, now) : null
const liveProfileObj = hasLive ? live.profile : normalizeProfile({ intercept: fallbackFit.theta.intercept })
// What-if: the fitted values applied without the gates (what the user would see once one more outcome opens them).
const fittedProfileObj = hasLive ? normalizeProfile({ ...live.profile, intercept: live.fitted.intercept, dslope: live.gain && live.gain.admitted ? live.fitted.dslope : 0, live: true }) : liveProfileObj

const pct = (p) => (p == null || !Number.isFinite(p) ? '  —  ' : `${String(Math.round(p * 100)).padStart(3)}%`)
const num = (x, d = 3) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d))
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))

const rows = decided.map((r) => ({
  id: r.id,
  title: r.title || '(senza titolo)',
  listPrice: r.listPrice,
  price: r.price,
  discountPct: r.discountPct,
  sentAt: r.sentAt.toISOString(),
  mature: mature.includes(r),
  outcome: r.first,
  y: r.y,
  shown: r.pShown,
  engine: predictWith(null, r),
  live: predictWith(liveProfileObj, r),
  fitted: predictWith(fittedProfileObj, r),
  priceBand: r.priceBand || (r.listPrice < 20 ? 'under_20' : r.listPrice <= 50 ? 'from_20_to_50' : 'over_50'),
  knot: r.knot || discKnotOf(r.discountPct),
  range: r.input ? (() => {
    // The 80% band the app would show today for this record (plain engine: prior uncertainty).
    const z = r.rawLogit
    const sd = Math.sqrt(LEARNING.PRIOR_SD.intercept ** 2 + (LEARNING.PRIOR_SD.dslope * (r.discountPct - 20) / 10) ** 2)
    return [r.k * core.squash(z - 1.28 * sd), r.k * core.squash(z + 1.28 * sd)]
  })() : null,
}))

const pairs = (key) => rows.filter((x) => x[key] != null).map((x) => [x[key], x.y])
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const metricsFor = (key) => {
  const ps = pairs(key)
  return { n: ps.length, meanPredicted: mean(ps.map(([p]) => p)), observedRate: mean(ps.map(([, y]) => y)), ...calibrationMetrics(ps) }
}
const summary = { shown: metricsFor('shown'), engine: metricsFor('engine'), live: metricsFor('live'), fitted: metricsFor('fitted') }

// Engine vs reality by price band and by discount knot: where the miss sits.
const BAND_LABELS = { under_20: 'Sotto 20 €', from_20_to_50: 'Da 20 a 50 €', over_50: 'Oltre 50 €' }
const KNOT_LABELS = { d10: 'sconto ~10%', d20: 'sconto ~20%', d30: 'sconto 30%+' }
const cell = (rs) => ({ n: rs.length, observed: rs.filter((x) => x.y === 1).length, expectedEngine: rs.reduce((s, x) => s + x.engine, 0), expectedShown: rs.reduce((s, x) => s + (x.shown || 0), 0) })
const byBand = Object.keys(BAND_LABELS).map((id) => ({ id, label: BAND_LABELS[id], ...cell(rows.filter((x) => x.priceBand === id)) }))
const byKnot = Object.keys(KNOT_LABELS).map((id) => ({ id, label: KNOT_LABELS[id], ...cell(rows.filter((x) => x.knot === id)) }))
const byBandKnot = Object.keys(BAND_LABELS).flatMap((b) => Object.keys(KNOT_LABELS).map((k) => ({ band: b, knot: k, ...cell(rows.filter((x) => x.priceBand === b && x.knot === k)) }))).filter((c) => c.n)

// Leave-one-out log score of the live fit: refit without each record, predict it, sum the log densities.
let loo = null
if (hasLive && mature.length >= 2) {
  let sumLive = 0
  let sumEngine = 0
  for (const r of mature) {
    const others = records.filter((x) => x.id !== r.id)
    const fit = core.liveProfile(others, now)
    const p = predictWith(fit.profile, r)
    const q = predictWith(null, r)
    sumLive += r.y ? Math.log(p) : Math.log(1 - p)
    sumEngine += r.y ? Math.log(q) : Math.log(1 - q)
  }
  loo = { n: mature.length, live: sumLive / mature.length, engine: sumEngine / mature.length }
}

/*
 * Counterfactual policy table (engine-spec §8.2): for each past offer, what the 1.7 engine would have said BEFORE the
 * send (the table's ask, the gate, the message mode) and, for the seller counters, whether the accept rule would have
 * fired. Only what is observable is summarised: the outcomes of the offers the gates would have blocked, and the
 * counters the rule would have taken (their saving against the list price). Acceptance under another discount is not
 * observable from these data and is never estimated here.
 */
const { policyDiscountFor, decisionGate, messagePolicyFor, offerTierFor, analyzeCounter } = core
const counterfactual = decided.map((r) => {
  const input = r.input
  const pol = input ? policyDiscountFor({ listPrice: r.listPrice, listingAge: input.listingAge, category: input.category, sellerProfile: input.sellerProfile, listingSignal: input.listingSignal }) : null
  // The other saved items stand for the watchlist as it was: rule 7 looks for an earlier refusal on the same listing.
  const gate = input ? decisionGate(input, null, { records: items.filter((it) => it.id !== r.id), now: r.sentAt, link: r.link, policy: pol }) : null
  const message = input && gate ? messagePolicyFor(input, gate, null, { tier: offerTierFor(predictWith(null, r)) }) : null
  const round = r.rounds[0] || null
  let accept = null
  if (round && input) {
    const receivedAt = round.receivedAt ? new Date(round.receivedAt) : new Date(r.sentAt.getTime() + 3_600_000)
    const form = {
      itemTitle: r.title, category: input.category.id, listPrice: String(r.listPrice), targetPrice: String(r.price), listingAge: input.listingAge.id, sellerProfile: input.sellerProfile, listingSignal: input.listingSignal.id,
      previousOffer: String(round.buyerPrice), sellerCounter: String(round.sellerPrice), offerSentAt: r.sentAt, receivedAt,
    }
    const res = analyzeCounter(form, new Date(receivedAt.getTime() + 5 * 60_000), { policyTarget: pol && pol.kind === 'offer' ? pol.targetPrice : null })
    accept = res.ok && res.accept ? { recommended: res.accept.recommended, reason: res.accept.reason, saving: Math.round((r.listPrice - round.sellerPrice) * 100) / 100 } : null
  }
  return {
    id: r.id, title: r.title || '(senza titolo)', listPrice: r.listPrice, price: r.price, discountPct: r.discountPct, outcome: r.first, y: r.y, closed: r.closed, savingEur: r.savingEur,
    policy: pol ? (pol.kind === 'offer' ? { target: pol.targetPrice, discountPct: pol.discountPct } : { noOffer: true, alternative: pol.alternative }) : null,
    gate: gate ? { kind: gate.kind, rule: gate.rule } : null,
    message: message ? message.mode : null,
    counter: round ? { seller: round.sellerPrice, ours: round.replyPrice, accept } : null,
  }
})
const gated = counterfactual.filter((c) => c.gate && c.gate.kind !== 'offer' && c.gate.rule >= 2 && c.gate.rule <= 9)
const acceptedCounters = counterfactual.filter((c) => c.counter && c.counter.accept && c.counter.accept.recommended)
const realisedSaving = decided.filter((r) => r.closed).reduce((s, r) => s + (r.savingEur || 0), 0)
const counterSaving = acceptedCounters.reduce((s, c) => s + c.counter.accept.saving, 0)
const wilsonLow = (k, n, z = 1.645) => {
  if (!n) return null
  const p = k / n
  const d = 1 + (z * z) / n
  return Math.max(0, (p + (z * z) / (2 * n)) / d - (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d)
}
const today = {
  decided: decided.length,
  accepted: decided.filter((r) => r.y === 1).length,
  acceptRate: decided.length ? decided.filter((r) => r.y === 1).length / decided.length : null,
  acceptWilsonLow: wilsonLow(decided.filter((r) => r.y === 1).length, decided.length),
  closed: decided.filter((r) => r.closed).length,
  closeRate: decided.length ? decided.filter((r) => r.closed).length / decided.length : null,
  savingPerOffer: decided.length ? realisedSaving / decided.length : null,
  overrideShare: decided.filter((r) => r.userOverride != null).length ? decided.filter((r) => r.userOverride === true).length / decided.filter((r) => r.userOverride != null).length : null,
}
/** Pre-registered prospective targets for the next 30 offers under 1.7 (engine-spec §8.3): what counts as success. */
const PROSPECTIVE_TARGETS = [
  { id: 'first_accept', text: 'Accettazione della prima offerta ≥ 25%, con limite inferiore Wilson 90% > 10%', today: today.acceptRate == null ? null : `${pct(today.acceptRate).trim()} (${today.accepted} su ${today.decided}; limite inferiore ${pct(today.acceptWilsonLow).trim()})` },
  { id: 'close_rate', text: 'Tasso di chiusura, controproposte accettate incluse, ≥ 40%', today: today.closeRate == null ? null : `${pct(today.closeRate).trim()} (${today.closed} su ${today.decided})` },
  { id: 'saving_per_offer', text: 'Euro risparmiati per offerta inviata ≥ 8 €', today: today.savingPerOffer == null ? null : `${num(today.savingPerOffer, 1)} € (${num(realisedSaving, 1)} € su ${today.decided} offerte)` },
  { id: 'outcomes_48h', text: 'Quota di esiti segnati entro 48 ore ≥ 80%', today: 'non misurabile sui dati vecchi (manca il promemoria esito)' },
  { id: 'override_share', text: 'Quota di prezzi inviati diversi dal piano (userOverride) < 25%, altrimenti le propensioni non sono usabili', today: today.overrideShare == null ? 'nessun dato' : pct(today.overrideShare).trim() },
]

const out = {
  engine: ENGINE_VERSION,
  now: now.toISOString(),
  records: records.length,
  decided: decided.length,
  mature: mature.length,
  observed: decided.filter((r) => r.y === 1).length,
  rows,
  summary,
  byBand,
  byKnot,
  byBandKnot,
  counterfactual,
  counterfactualSummary: {
    gated: gated.map((c) => ({ id: c.id, rule: c.gate.rule, kind: c.gate.kind, outcome: c.outcome, y: c.y })),
    gatedAccepted: gated.filter((c) => c.y === 1).length,
    counters: counterfactual.filter((c) => c.counter).length,
    countersAccepted: acceptedCounters.length,
    counterSavingEur: Math.round(counterSaving * 100) / 100,
    realisedSavingEur: Math.round(realisedSaving * 100) / 100,
    observableOnly: true,
  },
  today,
  prospectiveTargets: PROSPECTIVE_TARGETS,
  live: hasLive
    ? { intercept: live.profile.intercept, dslope: live.profile.dslope, status: live.status, nEff: live.nEff, basedOn: live.basedOn, sd: live.sd || null, fitted: live.fitted || null, gain: live.gain || null, arms: live.arms || null, rollback: live.rollback || false }
    : { intercept: fallbackFit.theta.intercept, note: 'motore senza liveProfile: intercetta del fit mensile senza cancelli', nEff: fallbackFit.nEff.intercept, basedOn: fallbackFit.n },
  loo,
}

if (asJson) {
  console.log(JSON.stringify(out, null, 2))
  process.exit(0)
}

console.log(`Replay · motore ${ENGINE_VERSION} · now ${now.toISOString()} · ${records.length} record, ${decided.length} prime offerte con esito (${mature.length} mature), ${out.observed} accettate`)
console.log('')
console.log(`${'Articolo'.padEnd(28)} ${'L€'.padStart(6)} ${'off€'.padStart(6)} ${'sc%'.padStart(5)}  ${'allora'.padStart(6)} ${'ora'.padStart(6)} ${'ora+live'.padStart(8)} ${'se fit'.padStart(6)}  ${'fascia 80%'.padStart(10)}  esito`)
for (const x of rows) {
  const band = x.range ? `${pct(x.range[0]).trim()}–${pct(x.range[1]).trim()}` : '—'
  console.log(`${short(x.title, 28)} ${String(x.listPrice).padStart(6)} ${String(x.price).padStart(6)} ${String(Math.round(x.discountPct)).padStart(5)}  ${pct(x.shown).padStart(6)} ${pct(x.engine).padStart(6)} ${pct(x.live).padStart(8)} ${pct(x.fitted).padStart(6)}  ${band.padStart(10)}  ${x.y ? 'SÌ' : 'no'} (${x.outcome}${x.mature ? '' : ', non matura'})`)
}
console.log('')
const line = (label, m) => console.log(`${label.padEnd(26)} n=${m.n}  media prevista ${pct(m.meanPredicted)}  osservata ${pct(m.observedRate)}  log loss ${num(m.logLoss)}  Brier ${num(m.brier)}  O/E ${num(m.oeRatio, 2)}  oeZ ${num(m.oeZ, 2)}  Spiegelhalter Z ${num(m.spiegelhalterZ, 2)}`)
line('Stima mostrata allora', summary.shown)
line('Motore attuale', summary.engine)
line('Motore + profilo live', summary.live)
line('Motore + fit senza cancelli', summary.fitted)
console.log('')
const table = (title, cells, labelOf) => {
  console.log(title)
  for (const c of cells) console.log(`  ${labelOf(c).padEnd(30)} n=${String(c.n).padStart(2)}  accettate ${c.observed}  attese allora ${num(c.expectedShown, 1)}  attese ora ${num(c.expectedEngine, 1)}`)
}
table('Per fascia di prezzo:', byBand, (c) => c.label)
table('Per sconto:', byKnot, (c) => c.label)
table('Fascia × sconto (solo celle con dati):', byBandKnot, (c) => `${BAND_LABELS[c.band]} · ${KNOT_LABELS[c.knot]}`)
console.log('')
if (hasLive) {
  const sd0 = out.live.sd && out.live.sd.intercept != null ? ` ± ${num(out.live.sd.intercept, 2)}` : ''
  console.log(`Profilo live: intercetta ${num(out.live.intercept, 3)}${sd0} (${out.live.status.intercept}), dslope ${num(out.live.dslope, 3)} (${out.live.status.dslope}), nEff ${num(out.live.nEff, 2)}, basato su ${out.live.basedOn} esiti${out.live.rollback ? ', ROLLBACK' : ''}`)
  if (out.live.fitted) {
    const z = out.live.sd && out.live.sd.intercept ? out.live.fitted.intercept / out.live.sd.intercept : null
    console.log(`  valori stimati prima dei cancelli: intercetta ${num(out.live.fitted.intercept, 3)} (z ${num(z, 2)}, cancello ${LEARNING.LIVE.GATE_Z}), dslope ${num(out.live.fitted.dslope, 3)}; bracci di sconto ${JSON.stringify(out.live.arms)}`)
  }
} else {
  console.log(`Motore senza liveProfile: intercetta del fit mensile ${num(out.live.intercept, 3)} (nEff ${num(out.live.nEff, 2)}, ${out.live.basedOn} esiti), senza cancelli né passo massimo`)
}
if (loo) console.log(`Leave-one-out (log score medio, più alto è meglio): live ${num(loo.live)} vs motore ${num(loo.engine)} su ${loo.n} esiti maturi`)
console.log('')

// §8.2: what the 1.7 engine would have said before each send.
const GATE_LABELS = { offer: 'offri', buy_now: 'compra', favourite_wait: 'cuore e aspetta', message_first: 'scrivi prima', wait: 'aspetta' }
const MESSAGE_LABELS = { message_first: 'messaggio prima', offer_direct: 'offerta diretta', optional: 'a sorte' }
console.log('Tabella controfattuale (motore 1.7 prima dell\'invio):')
console.log(`${'Articolo'.padEnd(28)} ${'L€'.padStart(6)} ${'off€'.padStart(6)}  ${'tabella'.padStart(9)}  ${'cancello'.padEnd(18)} ${'messaggio'.padEnd(16)} esito            controproposta`)
for (const c of counterfactual) {
  const table = !c.policy ? '—' : c.policy.noOffer ? 'no offerta' : `${c.policy.target} € (−${c.policy.discountPct}%)`
  const gate = c.gate ? `${GATE_LABELS[c.gate.kind] || c.gate.kind} (regola ${c.gate.rule})` : '—'
  const counter = c.counter ? `${c.counter.seller} €${c.counter.ours != null ? ` → noi ${c.counter.ours} €` : ''}: regola accetta ${c.counter.accept ? (c.counter.accept.recommended ? `SÌ (${c.counter.accept.reason})` : 'no') : '—'}` : ''
  console.log(`${short(c.title, 28)} ${String(c.listPrice).padStart(6)} ${String(c.price).padStart(6)}  ${table.padStart(9)}  ${gate.padEnd(18)} ${(MESSAGE_LABELS[c.message] || '—').padEnd(16)} ${String(c.outcome).padEnd(16)} ${counter}`)
}
console.log('')
console.log(`Offerte che i cancelli 2–9 avrebbero fermato: ${gated.length} su ${counterfactual.length}${gated.length ? ` (${gated.map((c) => `regola ${c.gate.rule}: ${c.outcome}`).join(', ')})` : ''}; accettate tra queste: ${gated.filter((c) => c.y === 1).length}.`)
console.log(`Controproposte che la regola «accetta» avrebbe chiuso: ${acceptedCounters.length} su ${counterfactual.filter((c) => c.counter).length} → +${acceptedCounters.length} affari, +${num(counterSaving, 1)} € risparmiati sul listino (da ${num(realisedSaving, 1)} € a ${num(realisedSaving + counterSaving, 1)} € su ${counterfactual.length} offerte).`)
console.log('Nota: l\'accettazione con sconti diversi da quelli inviati NON è osservabile da questi dati: la colonna «tabella» dice solo che cosa il motore avrebbe chiesto, non se sarebbe passato. Le colonne delle stime confrontano solo stime e esiti reali.')
console.log('')
console.log('Obiettivi prospettici pre-registrati per le prossime 30 offerte con la 1.7 (engine-spec §8.3):')
for (const tgt of PROSPECTIVE_TARGETS) console.log(`  · ${tgt.text}${tgt.today ? ` — oggi: ${tgt.today}` : ''}`)
