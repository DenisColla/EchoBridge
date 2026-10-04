import { useState } from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { capitalize, formatEuro, formatLongDate, formatRelativeDay, formatTime, toPercent } from '../../core/index.js'
import { copyText } from '../services/clipboard.js'
import { STATUSES, statusMeta } from '../services/storage.js'
import { space, useTheme } from '../theme.js'
import { Badge, Body, Button, Card, Chip, Note, Row, SectionLabel, Title } from './ui.js'

const hostOf = (link) => {
  try {
    return new URL(link).hostname.replace(/^www\./, '') || link
  } catch {
    return link
  }
}

function ItemCard({ item, highlighted, onStatus, onRemove, onCalendar, onGoogleCalendar, now }) {
  const t = useTheme()
  const [copied, setCopied] = useState(false)
  const [showOutcome, setShowOutcome] = useState(false)
  const sendAt = new Date(item.sendAt)
  const meta = statusMeta(item.status)
  const past = sendAt.getTime() < now.getTime()

  const copyMessage = async () => {
    const ok = await copyText(item.message)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card style={highlighted ? { borderColor: t.accent, borderWidth: 2 } : null}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <Text style={{ color: t.ink3, fontSize: 12 }}>{toPercent(item.probability)}% stimato</Text>
      </Row>
      <Title>{item.title || 'Articolo senza titolo'}</Title>
      <Body muted small>
        Listino {formatEuro(item.listPrice)} · offerta {formatEuro(item.targetPrice)} · sconto {Math.round(item.discountPct)}%
      </Body>
      <Body>
        <Text style={{ fontWeight: '700' }}>{item.status === 'planned' && !past ? 'Invia ' : 'Momento consigliato: '}</Text>
        {capitalize(formatLongDate(sendAt, now))} alle {formatTime(sendAt)} ({formatRelativeDay(sendAt, now)}){item.windowLabel ? ` · ${item.windowLabel.toLowerCase()}` : ''}
      </Body>
      {item.status === 'planned' && past && <Note tone="warn">La finestra consigliata è passata: ricalcola l'offerta o segna l'esito.</Note>}
      {item.notificationId ? <Body muted small>Promemoria impostato 10 minuti prima.</Body> : item.status === 'planned' ? <Body muted small>Nessun promemoria attivo (troppo vicino o permesso negato).</Body> : null}
      {item.link ? <Body muted small numberOfLines={1}>{hostOf(item.link)}</Body> : null}
      <Row>
        {item.link ? <View style={styles.btn}><Button label="Apri annuncio" onPress={() => Linking.openURL(item.link).catch(() => {})} /></View> : null}
        <View style={styles.btn}><Button label={copied ? 'Copiato!' : 'Copia messaggio'} variant="secondary" onPress={copyMessage} /></View>
      </Row>
      <Row>
        <View style={styles.btn}><Button label={item.calendarEventId ? 'In calendario' : 'Calendario'} variant="secondary" disabled={Boolean(item.calendarEventId)} onPress={() => onCalendar(item)} /></View>
        <View style={styles.btn}><Button label="Google Calendar" variant="secondary" onPress={() => onGoogleCalendar(item)} /></View>
      </Row>
      <Button label={showOutcome ? 'Chiudi' : 'Segna esito'} variant="secondary" onPress={() => setShowOutcome((v) => !v)} />
      {showOutcome && (
        <View style={{ gap: space.sm }}>
          <SectionLabel>Com'è andata?</SectionLabel>
          <Row>
            {STATUSES.map((s) => (
              <View key={s.id} style={{ flexGrow: 0, flexBasis: 'auto' }}>
                <Chip label={s.label} active={item.status === s.id} onPress={() => { onStatus(item.id, s.id); setShowOutcome(false) }} />
              </View>
            ))}
          </Row>
          <Body muted small>Gli esiti restano sul telefono e servono a misurare quanto sono affidabili le stime.</Body>
        </View>
      )}
      <Button label="Elimina" variant="danger" onPress={() => onRemove(item.id)} />
    </Card>
  )
}

export function WatchlistView({ items, ready, highlightId, onStatus, onRemove, onCalendar, onGoogleCalendar, now }) {
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
    const rank = (it) => (it.status === 'planned' ? 0 : 1)
    return rank(a) - rank(b) || new Date(a.sendAt) - new Date(b.sendAt)
  })
  return (
    <View style={{ gap: space.lg }}>
      {sorted.map((item) => (
        <ItemCard key={item.id} item={item} highlighted={item.id === highlightId} onStatus={onStatus} onRemove={onRemove} onCalendar={onCalendar} onGoogleCalendar={onGoogleCalendar} now={now} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  btn: { flex: 1, minWidth: 140 },
})
