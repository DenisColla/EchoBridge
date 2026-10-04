import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  TONES, articleFor, capitalize, formatEuro, formatLongDate, formatPoints, formatRelativeDay, formatSignedPoints, formatTime,
  isSameDay, toPercent,
} from '../../core/index.js'
import { copyText } from '../services/clipboard.js'
import { radius, space, toneColors, toneForLevel, toneForProbability, useTheme } from '../theme.js'
import { Badge, Body, Button, Card, Chip, Meter, Note, Row, SectionLabel, Title } from './ui.js'

function ScoreCard({ result }) {
  const t = useTheme()
  const { probability, probabilityRange, uncertainty, components, riskBand, blockRisk, factors, ambition, input, suggestedPrice } = result
  const tone = toneForProbability(probability)
  const c = toneColors(t, tone)
  const rows = factors.rows.filter((r) => r.deltaPoints !== 0)
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
      <View style={{ gap: 6 }}>
        <SectionLabel>Che cosa pesa sul risultato</SectionLabel>
        <Row style={styles.factorRow}>
          <Body style={{ flex: 1 }}>Sconto {articleFor(input.discountPct)}{Math.round(input.discountPct)}%: punto di partenza</Body>
          <Text style={[styles.factorValue, { color: t.ink }]}>{factors.basePct}%</Text>
        </Row>
        {rows.map((f) => (
          <View key={f.id} style={{ gap: 3 }}>
            <Row style={styles.factorRow}>
              <Body style={{ flex: 1 }} numberOfLines={1}>{f.label}</Body>
              <Text style={[styles.factorValue, { color: f.deltaPoints > 0 ? t.good : t.bad }]}>{formatSignedPoints(f.deltaPoints)} pt</Text>
            </Row>
            <View style={[styles.miniTrack, { backgroundColor: t.cardMuted }]}>
              <View style={[styles.miniFill, { backgroundColor: f.deltaPoints > 0 ? t.good : t.bad, width: `${Math.min(100, Math.abs(f.deltaPoints) * 5)}%` }]} />
            </View>
          </View>
        ))}
        <Row style={[styles.factorRow, { borderTopWidth: 1, borderTopColor: t.line, paddingTop: 6 }]}>
          <Body style={{ flex: 1, fontWeight: '600' }}>Accettazione nel momento consigliato</Body>
          <Text style={[styles.factorValue, { color: t.ink }]}>{factors.totalPct}%</Text>
        </Row>
      </View>
      {blockRisk.reasons.length > 0 && (
        <View style={{ gap: 6 }}>
          <SectionLabel>Perché il rischio di rifiuto secco è {blockRisk.label.toLowerCase()}</SectionLabel>
          <Row>{blockRisk.reasons.map((r) => <Badge key={r} tone={toneForLevel(blockRisk.level)}>{r}</Badge>)}</Row>
        </View>
      )}
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
    if (sendNow.ok) nowText = `Sì, anche subito va bene (${sendNow.deltaPoints === 0 ? 'stesse probabilità' : formatPoints(sendNow.deltaPoints)}): ${name}.`
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
          Resta valida circa 24 ore: fino a {verdict.expiresLabel}{verdict.isHoliday ? ' · giorno festivo, si comporta come una domenica' : ''}
        </Text>
      </View>
      <Body style={{ fontWeight: '600' }}>{opening}</Body>
      {reasons.map((r) => <Body key={r}>• {r}</Body>)}
      {timingNote && <Body muted small>{timingNote}</Body>}
      {alsoGood && (
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
      {alternatives.length > 0 && (
        <View style={{ gap: 4 }}>
          <SectionLabel>Altre finestre valide</SectionLabel>
          {alternatives.map((s) => (
            <Row key={s.date.getTime()} style={styles.factorRow}>
              <Body style={{ flex: 1 }}>{capitalize(formatLongDate(s.date, now))} · {formatTime(s.date)} · {formatRelativeDay(s.date, now)}</Body>
              <Text style={[styles.factorValue, { color: t.ink }]}>{toPercent(s.pOverall)}%</Text>
            </Row>
          ))}
        </View>
      )}
      {avoidToday.length > 0 && (
        <View style={{ gap: 6 }}>
          <SectionLabel>Fasce da evitare {optimal.daysWaited === 0 ? 'oggi' : formatLongDate(optimal.date, now).split(' ')[0]}</SectionLabel>
          <Row>{avoidToday.map((w) => <Badge key={w.id} tone="bad">{w.label} · {w.rangeLabel}</Badge>)}</Row>
        </View>
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
          <View key={x.id} style={{ flexGrow: 0, flexBasis: 'auto' }}>
            <Chip label={`${x.id === recommendedTone ? '★ ' : ''}${x.label}`} active={x.id === tone} onPress={() => { setTone(x.id); setCopied(false) }} />
          </View>
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

export function ResultView({ result, onSave, saveState, onCalendar, onGoogleCalendar }) {
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
      <Card style={{ borderColor: t.accent }}>
        <SectionLabel>Promemoria</SectionLabel>
        <Title>Salva e ricordamelo</Title>
        <Body muted small>
          Salva l'articolo nella lista, ricevi una notifica 10 minuti prima della finestra consigliata e, se vuoi, aggiungi l'evento al calendario del telefono.
        </Body>
        {saveState && saveState.message ? <Note tone={saveState.tone}>{saveState.message}</Note> : null}
        <Button label={saveState && saveState.saved ? 'Salvato nella lista' : 'Salva e ricordamelo'} onPress={onSave} disabled={Boolean(saveState && saveState.saved)} />
        <Row>
          <View style={{ flex: 1, minWidth: 150 }}><Button label="Aggiungi al calendario" variant="secondary" onPress={onCalendar} /></View>
          <View style={{ flex: 1, minWidth: 150 }}><Button label="Apri Google Calendar" variant="secondary" onPress={onGoogleCalendar} /></View>
        </Row>
      </Card>
      <ScoreCard result={result} />
      <VerdictCard result={result} />
      <StrategyCard result={result} />
      <MessageCard key={result.now.getTime()} result={result} />
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { fontSize: 60, fontWeight: '700', letterSpacing: -1, lineHeight: 64 },
  heroPct: { fontSize: 28, fontWeight: '500' },
  factorRow: { justifyContent: 'space-between', flexWrap: 'nowrap' },
  factorValue: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  miniTrack: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  miniFill: { height: '100%', borderRadius: radius.pill },
  heroBox: { borderRadius: radius.lg, padding: space.lg, gap: 6 },
  heroEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', opacity: 0.85 },
  heroHeadline: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  heroMeta: { fontSize: 12, opacity: 0.9 },
})
