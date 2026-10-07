import { useState } from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { capitalize, formatEuro, formatLongDate, formatRelativeDay, formatTime, toPercent } from '../../core/index.js'
import { copyText } from '../services/clipboard.js'
import { STATUSES, statusMeta } from '../services/storage.js'
import { space, useTheme } from '../theme.js'
import { Badge, Body, Button, ButtonRow, Card, Chip, Note, Row, SectionLabel, Title } from './ui.js'
import { negotiationLine } from './CounterView.js'

const hostOf = (link) => {
  try {
    return new URL(link).hostname.replace(/^www\./, '') || link
  } catch {
    return link
  }
}

function ItemCard({ item, highlighted, onStatus, onRemove, onCalendar, onCounter, onCounterSent, now }) {
  const t = useTheme()
  const [copied, setCopied] = useState(false)
  const [showOutcome, setShowOutcome] = useState(false)
  const sendAt = new Date(item.sendAt)
  const meta = statusMeta(item.status)
  const past = sendAt.getTime() < now.getTime()
  const plan = item.counterPlan
  const history = item.negotiation || []
  const lastEntry = history[history.length - 1]
  const hasCounter = history.some((e) => e.by === 'seller')
  const pendingCounter = item.status === 'countered' && plan && plan.price != null && !plan.sentAt
  const awaitingReply = item.status === 'sent' && lastEntry && lastEntry.by === 'buyer'
  const estimate = pendingCounter ? plan.pAccept : awaitingReply && hasCounter ? (lastEntry.pAccept ?? null) : hasCounter ? null : item.probability

  const copyMessage = async () => {
    const ok = await copyText(item.message)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card style={highlighted ? { borderColor: t.accent, borderWidth: 2 } : null}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {estimate != null ? <Text style={{ color: t.ink3, fontSize: 12 }}>{toPercent(estimate)}% stimato</Text> : null}
      </Row>
      <Title>{item.title || 'Articolo senza titolo'}</Title>
      <Body muted small>
        Listino {formatEuro(item.listPrice)} · prima offerta {formatEuro(item.targetPrice)} · sconto {Math.round(item.discountPct)}%
      </Body>
      {hasCounter ? <Body small>Trattativa: {negotiationLine(item)}</Body> : null}
      {pendingCounter ? (
        <Body>
          <Text style={{ fontWeight: '700' }}>Rispondi con {formatEuro(plan.price)}: </Text>
          {capitalize(formatLongDate(sendAt, now))} alle {formatTime(sendAt)} ({formatRelativeDay(sendAt, now)}){plan.windowLabel ? ` · ${plan.windowLabel.toLowerCase()}` : ''}
        </Body>
      ) : item.status === 'countered' && plan && plan.accept ? (
        <Note tone="good">Conviene comprare alla sua cifra: premi «Acquista» e poi segna l'esito «Accettata».</Note>
      ) : awaitingReply && hasCounter ? (
        <Body>Hai proposto {formatEuro(lastEntry.price)}{lastEntry.isFinal ? ' (ultima offerta)' : ''}: aspetta la sua risposta.</Body>
      ) : item.status === 'planned' ? (
        <Body>
          <Text style={{ fontWeight: '700' }}>{!past ? 'Invia ' : 'Momento consigliato: '}</Text>
          {capitalize(formatLongDate(sendAt, now))} alle {formatTime(sendAt)} ({formatRelativeDay(sendAt, now)}){item.windowLabel ? ` · ${item.windowLabel.toLowerCase()}` : ''}
        </Body>
      ) : null}
      {item.status === 'planned' && past && <Note tone="warn">La finestra consigliata è passata: ricalcola l'offerta o segna l'esito.</Note>}
      {pendingCounter && past && <Note tone="warn">Il momento consigliato è passato: tocca «Ricalcola» per un nuovo piano.</Note>}
      {item.notificationId || (plan && Object.keys(plan.reminderIds || {}).length) ? <Body muted small>Promemoria impostato.</Body> : item.status === 'planned' ? <Body muted small>Nessun promemoria attivo (troppo vicino o permesso negato).</Body> : null}
      {item.link ? <Body muted small numberOfLines={1}>{hostOf(item.link)}</Body> : null}
      <ButtonRow>
        {item.link ? <Button label="Apri annuncio" onPress={() => Linking.openURL(item.link).catch(() => {})} /> : null}
        <Button label={copied ? 'Copiato!' : 'Copia messaggio'} variant={item.link ? 'secondary' : 'primary'} onPress={copyMessage} />
      </ButtonRow>
      {pendingCounter && (
        <ButtonRow>
          <Button label="Ho inviato la nuova offerta" small onPress={() => onCounterSent(item.id)} />
          <Button label="Ricalcola" variant="secondary" small onPress={() => onCounter(item)} />
        </ButtonRow>
      )}
      {(awaitingReply || (item.status === 'planned' && past)) && (
        <Button label={hasCounter ? 'Ha risposto con un\'altra cifra' : 'Ha fatto una controproposta'} variant="secondary" small onPress={() => onCounter(item)} />
      )}
      <View style={styles.actions}>
        {(item.status === 'planned' || pendingCounter) && !past ? <Button label={item.calendarOpenedAt ? 'Calendario aperto' : 'Calendario'} variant="ghost" small onPress={() => onCalendar(item)} /> : null}
        <Button label={showOutcome ? 'Chiudi esito' : 'Segna esito'} variant="ghost" small onPress={() => setShowOutcome((v) => !v)} />
        <Button label="Elimina" variant="ghostDanger" small onPress={() => onRemove(item.id)} />
      </View>
      {showOutcome && (
        <View style={{ gap: space.sm }}>
          <SectionLabel>Com'è andata?</SectionLabel>
          <Row>
            {STATUSES.map((s) => (
              <Chip key={s.id} compact label={s.label} active={item.status === s.id} onPress={() => { setShowOutcome(false); if (s.id === 'countered') onCounter(item); else onStatus(item.id, s.id) }} />
            ))}
          </Row>
          <Body muted small>«Controproposta» apre il calcolo della tua risposta. Gli esiti restano sul telefono e servono a misurare quanto sono affidabili le stime.</Body>
        </View>
      )}
    </Card>
  )
}

export function WatchlistView({ items, ready, highlightId, onStatus, onRemove, onCalendar, onCounter, onCounterSent, now }) {
  if (!ready) return <Card><Body muted>Carico la lista…</Body></Card>
  if (items.length === 0) {
    return (
      <Card muted>
        <SectionLabel>Lista da comprare</SectionLabel>
        <Title>Ancora vuota</Title>
        <Body muted>Calcola un'offerta e premi "Salva e ricordamelo": qui troverai articolo, link, momento consigliato e messaggio pronto, con il promemoria impostato.</Body>
      </Card>
    )
  }
  const sorted = [...items].sort((a, b) => {
    const rank = (it) => (it.status === 'planned' || (it.status === 'countered' && it.counterPlan && it.counterPlan.price != null && !it.counterPlan.sentAt) ? 0 : 1)
    return rank(a) - rank(b) || new Date(a.sendAt) - new Date(b.sendAt)
  })
  return (
    <View style={{ gap: space.lg }}>
      {sorted.map((item) => (
        <ItemCard key={item.id} item={item} highlighted={item.id === highlightId} onStatus={onStatus} onRemove={onRemove} onCalendar={onCalendar} onCounter={onCounter} onCounterSent={onCounterSent} now={now} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.xs },
})
