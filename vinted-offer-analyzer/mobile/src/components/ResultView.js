import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  GOAL_CHOICES, TONES, articleFor, capitalize, expectedPriceCurve, formatEuro, formatLongDate, formatPoints, formatRelativeDay, formatSignedPoints, formatTime,
  isSameDay, leversFor, prepArticleFor, toPercent,
} from '../../core/index.js'
import { copyText } from '../services/clipboard.js'
import { radius, space, toneColors, toneForLevel, toneForProbability, useTheme } from '../theme.js'
import { Badge, Body, Button, ButtonRow, Card, Chip, Collapsible, Meter, Note, Row, SectionLabel, Title } from './ui.js'

/**
 * The market picture from «Cerca altrove» (same product, other listings): where this price sits and whether the
 * numbers below were anchored to it. `marketInfo` = { market, at } or null.
 */
const daysAgo = (date, now) => {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  return days <= 0 ? 'oggi' : days === 1 ? 'ieri' : `${days} giorni fa`
}

function MarketCard({ result, marketInfo, onOpenSearch, onRecalc }) {
  const t = useTheme()
  const applied = Boolean(result.market)
  const m = result.market || (marketInfo && marketInfo.market)
  if (!m || !(m.n >= 2)) {
    return onOpenSearch ? (
      <Card muted>
        <SectionLabel>Mercato</SectionLabel>
        <Body small muted>Senza un confronto con altri annunci l'offerta parte da regole generali. Con «Cerca altrove» il motore ancora il prezzo al mercato reale di questo articolo.</Body>
        <Button label="Cerca lo stesso articolo altrove" small variant="secondary" onPress={onOpenSearch} />
      </Card>
    ) : null
  }
  const gap = Number.isFinite(m.gapPct) ? m.gapPct : null
  const when = marketInfo && marketInfo.at ? new Date(marketInfo.at) : null
  return (
    <Card>
      <SectionLabel>Mercato di questo articolo</SectionLabel>
      <Title>{gap === null ? `Mediana ${formatEuro(m.medianPrice)}` : gap > 10 ? `Prezzo ${gap}% sopra il mercato` : gap < -10 ? `Prezzo ${-gap}% sotto il mercato` : 'Prezzo nella norma del mercato'}</Title>
      <Body small>Mediana {formatEuro(m.medianPrice)} · metà degli annunci tra {formatEuro(m.p25Price)} e {formatEuro(m.p75Price)} · {m.n} annunci confrontati{when ? `, ${daysAgo(when, new Date())}` : ''}.</Body>
      <Body small muted>
        {gap !== null && gap > 10 ? 'Il venditore chiede più degli altri: lo sconto che proponi è giustificato e il calcolo ne tiene conto.' : gap !== null && gap < -10 ? 'È già tra i più economici: si vende in fretta, meglio non tirare troppo.' : 'Prezzo allineato: contano di più momento e tono.'}
        {m.best && m.best.expectedTotal && m.best.title ? ` L'alternativa più conveniente trovata: ${m.best.title} a circa ${formatEuro(m.best.expectedTotal)} tutto compreso.` : ''}
      </Body>
      {applied
        ? <Text style={[styles.factorValue, { color: t.ink3, fontSize: 12 }]}>Entra nel punteggio come «prezzo rispetto al mercato» e nel rischio che l'articolo sparisca.</Text>
        : (
          <View style={{ gap: space.sm }}>
            <Note tone="warn">Mercato trovato dopo questo calcolo: i numeri qui sopra non lo usano ancora.</Note>
            {onRecalc ? <Button label="Ricalcola con il mercato" small onPress={onRecalc} /> : null}
          </View>
        )}
    </Card>
  )
}

/**
 * One metric for every choice: the expected final price = p·offerta + (1−p)·quello che paghi se rifiuta (il listino,
 * o l'alternativa migliore trovata). The curve is computed lazily: forty analyses take a moment on a phone.
 */
function ExpectedPriceCard({ result, profile, market, onApplyPrice }) {
  const t = useTheme()
  // Keyed by the analysis moment: a new analysis gets a fresh (null) curve without a synchronous setState in the effect.
  // The curve is built from what was ANALYSED (result.input), never from the live form, so it cannot drift from the
  // score above it nor re-run forty analyses on every keystroke.
  const stamp = result.now.getTime()
  const [state, setState] = useState({ stamp: 0, curve: null })
  const input = result.input
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      let c
      try {
        const analysed = {
          itemTitle: input.itemTitle, category: input.category.id, listingAge: input.listingAge.id, sellerProfile: input.sellerProfile || 'unknown',
          listingSignal: input.listingSignal.id, listPrice: String(input.listPrice).replace('.', ','), targetPrice: String(input.targetPrice).replace('.', ','),
          ...(input.signals ? { signals: input.signals } : {}),
        }
        c = expectedPriceCurve(analysed, result.now, { profile, market: result.market ? market : null }) || { empty: true }
      } catch {
        c = { empty: true }
      }
      if (alive) setState({ stamp, curve: c })
    }, 120)
    return () => { alive = false; clearTimeout(timer) }
  }, [input, profile, market, result.now, result.market, stamp])
  const curve = state.stamp === stamp ? state.curve : null
  if (!curve) return <Card muted><SectionLabel>Prezzo atteso</SectionLabel><Body small muted>Calcolo la curva delle offerte…</Body></Card>
  if (curve.empty || !curve.best) return null
  const best = curve.best
  const at = curve.atTarget
  const sameAsTarget = at && Math.abs(best.price - at.price) < 0.005
  const shown = curve.points.filter((p, i) => i % Math.max(1, Math.floor(curve.points.length / 6)) === 0 || p === best || p === at)
  return (
    <Card>
      <SectionLabel>Prezzo atteso</SectionLabel>
      <Title>{sameAsTarget ? `La tua offerta è già quella che paga meno: circa ${formatEuro(best.expected)}` : `Paghi meno in media offrendo ${formatEuro(best.price)}`}</Title>
      <Body small muted>
        Prezzo atteso = probabilità × offerta + (1 − probabilità) × il prezzo pieno (se rifiuta, compri qui a listino; un'alternativa più economica è tra le leve). {at ? `Con la tua offerta di ${formatEuro(at.price)} (${toPercent(at.probability)}%) il prezzo atteso è ${formatEuro(at.expected)}` : ''}{!sameAsTarget && at ? `; con ${formatEuro(best.price)} (${toPercent(best.probability)}%) scende a ${formatEuro(best.expected)}` : ''}.
      </Body>
      <View style={{ gap: 4 }}>
        {shown.map((p) => (
          <View key={p.price} style={styles.factorRow}>
            <Body small style={[styles.factorLabel, { fontWeight: p === best ? '700' : '400' }]}>{p === best ? '★ ' : ''}{formatEuro(p.price)} (−{Math.round(p.discountPct)}%) · {toPercent(p.probability)}%</Body>
            <Text style={[styles.factorValue, { color: p === best ? t.good : t.ink }]}>{formatEuro(p.expected)}</Text>
          </View>
        ))}
      </View>
      {!sameAsTarget && onApplyPrice ? <Button label={`Usa ${formatEuro(best.price)} come offerta`} small variant="secondary" onPress={() => onApplyPrice(best.price)} /> : null}
      <Body small muted>Vale per la prima offerta; il risparmio atteso rispetto al prezzo pieno è circa {formatEuro(curve.savingVsList)}.</Body>
    </Card>
  )
}

/** Ways to pay less that are not an offer: each with its value in euro and, where it exists, a reminder. */
function LeversCard({ result, form, market, signals, onLever }) {
  const t = useTheme()
  const levers = leversFor({ result, form, market, signals: signals || {}, now: result.now })
  if (!levers.length) return null
  return (
    <Card>
      <SectionLabel>Altre leve</SectionLabel>
      <Title>Oltre all'offerta</Title>
      {levers.map((l) => (
        <View key={l.id} style={[styles.optionBox, { borderColor: t.line, backgroundColor: t.cardMuted }]}>
          <View style={styles.factorRow}>
            <Body style={[styles.factorLabel, { fontWeight: '700' }]}>{l.title}</Body>
            {Number.isFinite(l.valueEur) && l.valueEur > 0 ? <Text style={[styles.factorValue, { color: t.good }]}>≈ {formatEuro(l.valueEur)}</Text> : null}
          </View>
          <Body small>{l.body}</Body>
          {l.action && l.action.kind === 'reminder' && onLever ? <Button label={`Ricordamelo tra ${l.action.hours} ore`} small variant="secondary" onPress={() => onLever(l)} /> : null}
        </View>
      ))}
    </Card>
  )
}

/** What the extractor read from the listing, what it guessed and what it could not find: the user sees the basis of the numbers. */
function SourceCard({ extraction, onEdit }) {
  const { summary } = extraction
  const guessed = summary.guessed.filter((g) => !/\(nessun indizio|non lo so/i.test(g))
  return (
    <Card>
      <SectionLabel>Letto dall'annuncio</SectionLabel>
      <Title>Su che cosa si basa il calcolo</Title>
      {summary.found.map((f) => <Body key={f} small>✓ {f}</Body>)}
      {summary.condition || summary.brand ? <Body muted small>{[summary.brand && `Marca ${summary.brand}`, summary.condition && `condizioni: ${summary.condition}`].filter(Boolean).join(' · ')}</Body> : null}
      {guessed.length > 0 && (
        <View style={{ gap: 2 }}>
          <Body small style={{ fontWeight: '700' }}>Stimati, da controllare:</Body>
          {guessed.map((g) => <Body key={g} small>• {g}</Body>)}
        </View>
      )}
      {summary.missing.length > 0 && <Body muted small>Non trovati: {summary.missing.join(', ')}. Puoi indicarli a mano nel modulo.</Body>}
      <Button label="Modifica i dati" variant="secondary" small onPress={onEdit} />
    </Card>
  )
}

function ScoreCard({ result }) {
  const t = useTheme()
  const { probability, probabilityRange, uncertainty, components, riskBand, blockRisk, factors, ambition, input, suggestedPrice } = result
  const tone = toneForProbability(probability)
  const c = toneColors(t, tone)
  const rows = factors.rows.filter((r) => r.deltaPoints !== 0)
  const strongest = [...rows].sort((a, b) => Math.abs(b.deltaPoints) - Math.abs(a.deltaPoints)).slice(0, 2)
  const factorSummary = [`sconto ${Math.round(input.discountPct)}% → ${factors.basePct}%`, ...strongest.map((f) => `${f.label.toLowerCase()} ${formatSignedPoints(f.deltaPoints)}`)].join(' · ')
  const showEquation = components.pAvailable < 0.995 || components.pRead < 0.995 || toPercent(probability) !== factors.totalPct
  const missing = [
    input.listingAge.id === 'unknown' && "l'anzianità dell'annuncio",
    (!input.sellerProfile || input.sellerProfile === 'unknown') && 'il tipo di venditore',
  ].filter(Boolean).join(' e ')

  return (
    <Card>
      <SectionLabel>Score di fattibilità</SectionLabel>
      <Title>Quante possibilità hai?</Title>
      <Text style={[styles.hero, { color: c.fg }]}>{toPercent(probability)}<Text style={styles.heroPct}>%</Text></Text>
      <Body muted small>
        probabilità complessiva nel momento consigliato
        {uncertainty > 0 ? `\nstima tra ${toPercent(probabilityRange[0])}% e ${toPercent(probabilityRange[1])}%: indica ${missing} per restringerla` : ''}
      </Body>
      <Row>
        <Badge tone={riskBand.tone}>Rischio {riskBand.label.toLowerCase()} · sconto {Math.round(input.discountPct)}%</Badge>
        <Badge tone={toneForLevel(blockRisk.level)}>Rifiuto secco / blocco: {blockRisk.label.toLowerCase()}</Badge>
      </Row>
      <Meter value={probability} tone={tone} />
      {showEquation && (
        <Body muted small>
          Accettazione {toPercent(components.pAccept)}%
          {components.pAvailable < 0.995 ? ` × ancora in vendita ${toPercent(components.pAvailable)}%` : ''}
          {components.pRead < 0.995 ? ` × il venditore la legge ${toPercent(components.pRead)}%` : ''}
          {` = ${toPercent(probability)}% complessivo`}
        </Body>
      )}
      {ambition && (
        <Note tone="bad">
          {ambition === 'unrealistic' ? 'Così non passa: anche nel momento perfetto il rifiuto è quasi certo.' : 'Obiettivo molto ambizioso: anche nel momento migliore le probabilità restano basse.'}
          {' '}{suggestedPrice ? 'Usa il prezzo consigliato nella strategia.' : 'Alza il prezzo o scrivi prima al venditore.'}
        </Note>
      )}
      <Collapsible title="Che cosa pesa sul risultato" summary={factorSummary}>
        <View style={styles.factorRow}>
          <Body style={styles.factorLabel}>Sconto {articleFor(input.discountPct)}{Math.round(input.discountPct)}%: punto di partenza</Body>
          <Text style={[styles.factorValue, { color: t.ink }]}>{factors.basePct}%</Text>
        </View>
        {rows.map((f) => (
          <View key={f.id} style={{ gap: 3 }}>
            <View style={styles.factorRow}>
              <Body style={styles.factorLabel} numberOfLines={1}>{f.label}</Body>
              <Text style={[styles.factorValue, { color: f.deltaPoints > 0 ? t.good : t.bad }]}>{formatSignedPoints(f.deltaPoints)} pt</Text>
            </View>
            <View style={[styles.miniTrack, { backgroundColor: t.cardMuted }]}>
              <View style={[styles.miniFill, { backgroundColor: f.deltaPoints > 0 ? t.good : t.bad, width: `${Math.min(100, Math.abs(f.deltaPoints) * 5)}%` }]} />
            </View>
          </View>
        ))}
        <View style={[styles.factorRow, { borderTopWidth: 1, borderTopColor: t.line, paddingTop: 6 }]}>
          <Body style={[styles.factorLabel, { fontWeight: '600' }]}>Accettazione nel momento consigliato</Body>
          <Text style={[styles.factorValue, { color: t.ink }]}>{factors.totalPct}%</Text>
        </View>
        {blockRisk.reasons.length > 0 && (
          <View style={{ gap: 6, paddingTop: 4 }}>
            <SectionLabel>Perché il rischio di rifiuto secco è {blockRisk.label.toLowerCase()}</SectionLabel>
            <Row>{blockRisk.reasons.map((r) => <Badge key={r} tone={toneForLevel(blockRisk.level)}>{r}</Badge>)}</Row>
          </View>
        )}
      </Collapsible>
    </Card>
  )
}

function VerdictCard({ result }) {
  const t = useTheme()
  const { verdict, opening, reasons, optimal, alsoGood, quick, alternatives, now, avoidToday, sendNow, timingNote, nowInAvoid, blockRiskNow } = result
  const sameDay = alsoGood && isSameDay(alsoGood.date, optimal.date)
  let nowText = null
  if (optimal.kind !== 'now') {
    const name = sendNow.window.label.toLowerCase()
    if (sendNow.reason === 'exploration') nowText = 'No: è una variante di test, inviala all\'orario indicato (oppure usa il piano migliore).'
    else if (sendNow.ok) nowText = `Sì, anche subito va bene (${sendNow.deltaPoints === 0 ? 'stesse probabilità' : formatPoints(sendNow.deltaPoints)}): ${name}.`
    else if (nowInAvoid || sendNow.reason === 'avoid_window') nowText = `No: sei in una fascia sfavorevole (${name}, ${formatPoints(sendNow.deltaPoints)}${blockRiskNow.level !== 'low' ? ', rischio di rifiuto secco più alto' : ''}). Aspetta.`
    else nowText = `No: ${name} (${formatPoints(sendNow.deltaPoints)} rispetto al momento consigliato). Aspetta.`
  }

  return (
    <Card>
      <SectionLabel>Verdetto temporale</SectionLabel>
      <Title>Quando inviare l'offerta</Title>
      {nowText && <Note tone={sendNow.ok ? 'good' : 'bad'}><Text style={{ fontWeight: '700' }}>Adesso? </Text>{nowText}</Note>}
      <View style={[styles.heroBox, { backgroundColor: t.accent }]}>
        <Text style={[styles.heroEyebrow, { color: t.onAccent }]}>{verdict.sublabel}</Text>
        <Text style={[styles.heroHeadline, { color: t.onAccent }]}>{verdict.headline}</Text>
        <Text style={[styles.heroMeta, { color: t.onAccent }]}>
          {optimal.score.timeWindow.label}{optimal.score.timeWindow.range ? ` · ${optimal.score.timeWindow.range}` : ''}
          {optimal.score.monthWindow.weight !== 0 ? ` · ${optimal.score.monthWindow.label}` : ''} · {toPercent(optimal.pOverall)}% complessivo
        </Text>
        <Text style={[styles.heroMeta, { color: t.onAccent }]}>
          Conta su circa 24 ore per la risposta: fino a {verdict.expiresLabel}{verdict.isHoliday ? ' · giorno festivo, si comporta come una domenica' : ''}
        </Text>
      </View>
      <Body style={{ fontWeight: '600' }}>{opening}</Body>
      {reasons.map((r) => <Body key={r}>• {r}</Body>)}
      {timingNote && <Body muted small>{timingNote}</Body>}
      {/* With a test variation the better plan is offered by «Usa il piano migliore», not as «se puoi aspettare». */}
      {alsoGood && !result.exploration && (
        <Note>
          <Text style={{ fontWeight: '700' }}>{sameDay ? 'Ancora meglio: ' : 'Pari merito: '}</Text>
          {sameDay ? `alle ${formatTime(alsoGood.date)}` : `${formatLongDate(alsoGood.date, now)} alle ${formatTime(alsoGood.date)} (${formatRelativeDay(alsoGood.date, now)})`}
          {' '}vale {toPercent(alsoGood.pOverall)}%{sameDay ? ', se puoi aspettare.' : '. Scegli il giorno più comodo.'}
        </Note>
      )}
      {quick && (
        <Note tone="warn">
          <Text style={{ fontWeight: '700' }}>Hai fretta? </Text>
          {capitalize(formatLongDate(quick.date, now))} alle {formatTime(quick.date)} ({formatRelativeDay(quick.date, now)}): {toPercent(quick.pOverall)}%
          {' '}({toPercent(quick.pOverall) - toPercent(optimal.pOverall) === 0 ? 'stesse probabilità' : formatPoints(toPercent(quick.pOverall) - toPercent(optimal.pOverall))} rispetto al momento consigliato, {quick.daysWaited === 0 ? 'con nessun rischio' : 'con meno rischio'} che venga venduto prima).
        </Note>
      )}
      {(alternatives.length > 0 || avoidToday.length > 0) && (
        <Collapsible
          title="Altre finestre e fasce da evitare"
          summary={[alternatives.length ? `${alternatives.length} altre finestre valide` : null, avoidToday.length ? `evita: ${avoidToday.map((w) => w.label.toLowerCase()).join(', ')}` : null].filter(Boolean).join(' · ')}
        >
          {alternatives.length > 0 && (
            <View style={{ gap: 4 }}>
              <SectionLabel>Altre finestre valide</SectionLabel>
              {alternatives.map((s) => (
                <View key={s.date.getTime()} style={styles.factorRow}>
                  <Body style={styles.factorLabel} numberOfLines={1}>{capitalize(formatLongDate(s.date, now))} · {formatTime(s.date)} · {formatRelativeDay(s.date, now)}</Body>
                  <Text style={[styles.factorValue, { color: t.ink }]}>{toPercent(s.pOverall)}%</Text>
                </View>
              ))}
            </View>
          )}
          {avoidToday.length > 0 && (
            <View style={{ gap: 6 }}>
              <SectionLabel>Fasce da evitare {optimal.daysWaited === 0 ? 'oggi' : formatLongDate(optimal.date, now).split(' ')[0]}</SectionLabel>
              <Row>{avoidToday.map((w) => <Badge key={w.id} tone="bad">{w.label} · {w.rangeLabel}</Badge>)}</Row>
            </View>
          )}
        </Collapsible>
      )}
    </Card>
  )
}

function StrategyCard({ result }) {
  const { suggestedPrice, twoStep, tips, input } = result
  return (
    <Card>
      <SectionLabel>Strategia</SectionLabel>
      <Title>Come aumentare le probabilità</Title>
      {suggestedPrice && (
        <Note tone="warn">
          Con <Text style={{ fontWeight: '700' }}>{formatEuro(suggestedPrice.price)}</Text> (sconto {Math.round(suggestedPrice.discountPct)}% invece di {Math.round(input.discountPct)}%) la probabilità complessiva sale a <Text style={{ fontWeight: '700' }}>{Math.round(suggestedPrice.probability * 100)}%</Text>.
        </Note>
      )}
      {twoStep && (
        <Note>
          <Text style={{ fontWeight: '700' }}>Due step: </Text>apri a {formatEuro(twoStep.openingPrice)} ({Math.round(twoStep.openingProbability * 100)}% di accettazione diretta) e chiudi intorno a {formatEuro(twoStep.closingPrice)} sulla controproposta.
        </Note>
      )}
      {tips.map((tip) => <Body key={tip}>• {tip}</Body>)}
      <Body muted small>Stime basate su euristiche di psicologia della negoziazione e sulle abitudini d'uso di Vinted, non su dati ufficiali della piattaforma.</Body>
    </Card>
  )
}

function MessageCard({ result }) {
  const { messages, recommendedTone, messageBeforeOffer } = result
  const [tone, setTone] = useState(recommendedTone)
  const [copied, setCopied] = useState(false)
  const current = messages.find((m) => m.tone === tone) || messages[0]
  const meta = TONES.find((x) => x.id === tone)
  const handleCopy = async () => {
    const ok = await copyText(current.text)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Card>
      <SectionLabel>Messaggio di supporto</SectionLabel>
      <Title>Che cosa scrivere al venditore</Title>
      <Row>
        {TONES.map((x) => (
          <Chip key={x.id} compact label={`${x.id === recommendedTone ? '★ ' : ''}${x.label}`} active={x.id === tone} onPress={() => { setTone(x.id); setCopied(false) }} />
        ))}
      </Row>
      <Body muted small>{meta ? meta.hint : ''}{tone === recommendedTone ? ' · consigliato per questo livello di rischio' : ''}</Body>
      <Note>{current.text}</Note>
      <Body muted small>
        {messageBeforeOffer
          ? "Invia prima questo messaggio in chat; l'offerta dal pulsante di Vinted parte solo dopo la risposta."
          : "L'offerta si invia dal pulsante di Vinted; il messaggio la accompagna in chat."}
      </Body>
      <Button label={copied ? 'Copiato!' : 'Copia il messaggio'} variant="secondary" onPress={handleCopy} />
    </Card>
  )
}

function OptimizeCard({ result, goal, onGoal, plan, onOptimize, onApply, busy }) {
  const t = useTheme()
  const currentPct = toPercent(result.probability)
  return (
    <Card>
      <SectionLabel>Obiettivo</SectionLabel>
      <Title>Quante probabilità vorresti?</Title>
      <Row>
        {GOAL_CHOICES.map((g) => (
          <Chip key={g} compact label={`${Math.round(g * 100)}%`} active={Math.abs(goal - g) < 0.001} onPress={() => onGoal(g)} />
        ))}
      </Row>
      <Body muted small>
        Oggi sei al {currentPct}%. Con un tocco cerco il modo più economico per arrivare al {Math.round(goal * 100)}%: aspettare un momento migliore, alzare di poco l'offerta, o entrambe le cose.
      </Body>
      <Button label={busy ? 'Calcolo…' : `Portami al ${Math.round(goal * 100)}%`} onPress={onOptimize} disabled={busy || currentPct >= Math.round(goal * 100)} />
      {currentPct >= Math.round(goal * 100) && <Body muted small>Sei già oltre questo obiettivo: scegli una percentuale più alta.</Body>}
      {plan && !plan.ok && <Note tone="warn">Non posso ottimizzare questa offerta: {plan.reason === 'no_offer_needed' ? 'non serve nessuna offerta.' : 'controlla i dati inseriti.'}</Note>}
      {plan && plan.ok && (
        <View style={{ gap: space.md }}>
          {plan.options.length === 0 && (
            <Note tone="warn">
              Il {Math.round(plan.target * 100)}% non è raggiungibile senza pagare quasi il prezzo pieno. Il massimo è {toPercent(plan.maxAchievable.probability)}%: {plan.maxAchievable.changes.join(' e ').toLowerCase()}.
            </Note>
          )}
          {plan.options.map((o, index) => (
            <View key={o.id} style={[styles.optionBox, { borderColor: index === 0 ? t.accent : t.line, backgroundColor: t.cardMuted }]}>
              <View style={styles.factorRow}>
                <Body style={[styles.factorLabel, { fontWeight: '700' }]}>{index === 0 ? '★ ' : ''}{o.label}</Body>
                <Text style={[styles.factorValue, { color: t.good }]}>{toPercent(o.probability)}% ({formatPoints(o.deltaPoints)})</Text>
              </View>
              {o.changes.map((c) => <Body key={c} small>• {c}</Body>)}
              <Button label="Applica questa scelta" variant={index === 0 ? 'primary' : 'secondary'} small onPress={() => onApply(o)} />
            </View>
          ))}
          {plan.options.length > 0 && plan.maxAchievable.probability > plan.options[0].probability + 0.05 && (
            <Body muted small>Massimo raggiungibile: {toPercent(plan.maxAchievable.probability)}% ({plan.maxAchievable.changes.join(', ').toLowerCase()}).</Body>
          )}
        </View>
      )}
    </Card>
  )
}

/**
 * Failure risk even at the recommended moment and price: the complement of the estimate with a range, the reasons and
 * what the user's own history says. Without outcomes the range is wide on purpose.
 */
function RiskCard({ risk }) {
  if (!risk) return null
  const tone = toneForLevel(risk.level)
  const pct = (x) => Math.round(x * 100)
  return (
    <Card>
      <SectionLabel>Rischio di fallimento</SectionLabel>
      <Title>Anche nel momento giusto può andare male</Title>
      <Row>
        <Badge tone={tone}>{pct(risk.pFail)}% di rischio · tra {pct(risk.range[0])} e {pct(risk.range[1])}%</Badge>
        <Badge tone="neutral">{risk.basis === 'history' ? 'Calibrato sui tuoi esiti' : 'Stima del motore, non ancora corretta dai tuoi esiti'}</Badge>
      </Row>
      {risk.reasons.length > 0 && (
        <View style={{ gap: 2 }}>
          <Body small style={{ fontWeight: '700' }}>Perché può fallire</Body>
          {risk.reasons.map((r) => <Body key={r.id} small>• {r.text}</Body>)}
        </View>
      )}
      {risk.failureMix && risk.failureMix.length > 0 && (
        <View style={{ gap: 2 }}>
          <Body small style={{ fontWeight: '700' }}>Se non passa, di solito è</Body>
          {risk.failureMix.filter((m) => m.share >= 0.05).map((m) => (
            <Body key={m.id} small>• {m.label}: {pct(m.share)}% dei casi{m.closeAfter >= 0.05 ? `, poi l'affare si chiude comunque ${prepArticleFor('in', m.closeAfter * 100)}${pct(m.closeAfter)}%` : ''}</Body>
          ))}
        </View>
      )}
      <Note tone={risk.pClose >= 0.6 ? 'good' : 'neutral'}>
        Probabilità di chiudere l'affare, anche dopo controproposte: {pct(risk.pClose)}% (tra {pct(risk.pCloseRange[0])} e {pct(risk.pCloseRange[1])}%).
      </Note>
      {risk.similar ? (
        <Body muted small>Nel tuo storico, con uno sconto simile: {risk.similar.successes} {risk.similar.successes === 1 ? 'accettata' : 'accettate'} su {risk.similar.n} offerte.</Body>
      ) : null}
      {risk.plan.map((p) => <Note key={p}>{p}</Note>)}
    </Card>
  )
}

/** The flagged test variation (about 1 offer in 5) and the way out of it: a real button, reachable with TalkBack. */
function ExplorationNote({ exploration, onSkip }) {
  if (!exploration) return null
  const what = exploration.kind === 'time'
    ? `invio ${exploration.label}`
    : `${exploration.label} (${formatEuro(exploration.price)} invece di ${formatEuro(exploration.base.price)}${exploration.price > exploration.base.price ? `: paghi ${formatEuro(exploration.price - exploration.base.price)} in più` : ''})`
  const n = exploration.costPoints
  const cost = n > 0 ? `Costo stimato: ${n} ${n === 1 ? 'punto' : 'punti'} di probabilità.` : 'Nessun costo in probabilità.'
  return (
    <View style={{ gap: space.sm }}>
      <Note tone="warn">Variante di test: {what}. {cost} Serve al motore per capire se orari e sconti vicini rendono di più; inviala proprio così.</Note>
      {onSkip ? <Button label="Usa il piano migliore" variant="secondary" small onPress={onSkip} /> : null}
    </View>
  )
}

export function ResultView({ result, onSave, saveState, onCalendar, calendarBusy = false, goal, onGoal, plan, onOptimize, onApply, optimizing, extraction = null, onEditData, onCounter, risk = null, onSkipExploration = null, form = null, profile = null, marketInfo = null, onOpenSearch = null, onApplyPrice = null, onLever = null, onRecalc = null }) {
  const t = useTheme()
  if (result.kind === 'no_offer_needed') {
    return (
      <Card>
        <Title>Nessuna offerta necessaria</Title>
        <Body>{result.message}</Body>
      </Card>
    )
  }
  return (
    <View style={{ gap: space.lg }}>
      {result.warnings.map((w) => <Note key={w.id} tone="warn">{w.text}</Note>)}
      {result.kind === 'over_cap' && (
        <Note tone="bad">
          <Text style={{ fontWeight: '700' }}>Sconto {articleFor(result.requestedInput.discountPct)}{Math.round(result.requestedInput.discountPct)}%: oltre il limite di Vinted. </Text>
          {result.message}{'\n'}{result.capAdvice.map((a) => `• ${a}`).join('\n')}
        </Note>
      )}
      {result.exploration ? <ExplorationNote exploration={result.exploration} onSkip={onSkipExploration} /> : result.pinned && <Note>Momento fissato dall'ottimizzatore: {result.verdict.headline.replace("Invia l'offerta ", 'invio ')}.</Note>}
      <ScoreCard result={result} />
      <VerdictCard result={result} />
      <MarketCard result={result} marketInfo={marketInfo} onOpenSearch={onOpenSearch} onRecalc={onRecalc} />
      {form ? <ExpectedPriceCard result={result} profile={profile} market={marketInfo ? marketInfo.market : null} onApplyPrice={onApplyPrice} /> : null}
      {form ? <LeversCard result={result} form={form} market={marketInfo ? marketInfo.market : null} signals={marketInfo ? marketInfo.signals : null} onLever={onLever} /> : null}
      <RiskCard risk={risk} />
      {extraction && extraction.ok && <SourceCard extraction={extraction} onEdit={onEditData} />}
      <Card style={{ borderColor: t.accent }}>
        <SectionLabel>Promemoria</SectionLabel>
        <Title>Salva e ricordamelo</Title>
        <Body muted small>
          L'articolo finisce nella lista con link e messaggio; ricevi una notifica 10 minuti prima della finestra consigliata. "Metti in calendario" apre l'app Calendario con l'evento già compilato: tu tocchi Salva.
        </Body>
        {saveState && saveState.message ? <Note tone={saveState.tone}>{saveState.message}</Note> : null}
        <ButtonRow>
          <Button label={saveState && saveState.saved ? 'Salvato nella lista' : 'Salva e ricordamelo'} onPress={onSave} disabled={Boolean(saveState && saveState.saved)} />
          <Button label={calendarBusy ? 'Apro il calendario…' : 'Metti in calendario'} variant="secondary" onPress={onCalendar} disabled={calendarBusy} />
        </ButtonRow>
      </Card>
      {onCounter && (
        <Card>
          <SectionLabel>Dopo l'invio</SectionLabel>
          <Title>Ti ha risposto con una controproposta?</Title>
          <Body muted small>Inserisci la sua cifra: calcolo la tua risposta migliore, quanto salire in euro e in percentuale e quando inviarla.</Body>
          <Button label="Rispondi alla controproposta" variant="secondary" onPress={onCounter} />
        </Card>
      )}
      <OptimizeCard result={result} goal={goal} onGoal={onGoal} plan={plan} onOptimize={onOptimize} onApply={onApply} busy={optimizing} />
      <StrategyCard result={result} />
      <MessageCard key={result.now.getTime()} result={result} />
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { fontSize: 60, fontWeight: '700', letterSpacing: -1, lineHeight: 64 },
  heroPct: { fontSize: 28, fontWeight: '500' },
  factorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  factorLabel: { flex: 1, flexShrink: 1, minWidth: 0 },
  factorValue: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 0 },
  optionBox: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: 6 },
  miniTrack: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  miniFill: { height: '100%', borderRadius: radius.pill },
  heroBox: { borderRadius: radius.lg, padding: space.lg, gap: 6 },
  heroEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', opacity: 0.85 },
  heroHeadline: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  heroMeta: { fontSize: 12, opacity: 0.9 },
})
