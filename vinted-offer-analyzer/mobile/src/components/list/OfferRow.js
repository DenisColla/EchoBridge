import { useEffect, useRef, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { buildAfterRefusalMessage, formatEuro, toPercent } from '../../../core/index.js'
import { copyText } from '../../services/clipboard.js'
import { estimateOf, hasSellerCounter, hostOf, nextStepOf, rowStateOf, segmentOf, timeLabelOf, whenLabel } from '../../services/segments.js'
import { statusMeta } from '../../services/storage.js'
import { space, useTheme } from '../../theme.js'
import { Badge, Body, Button, Card, Chip, Row } from '../ui.js'
import { negotiationLine } from '../CounterView.js'
import { OutcomePanel } from './OutcomePanel.js'

const openLink = (link) => Linking.openURL(link).catch(() => {})

/** Calls an optional watch-list setter: the row works even before App.js passes `actions`. */
const call = (actions, name, ...args) => (actions && typeof actions[name] === 'function' ? actions[name](...args) : undefined)

/**
 * One saved offer: collapsed by default (state badge, title, prices, ONE next-step sentence, ONE primary action),
 * tapping the body opens the footer with the secondary actions. `onSent(item)` tells the list a first offer was just
 * marked sent (it shows the undo line); `scrollRef` (optional) is the page ScrollView, used to bring a highlighted row
 * into view; `openOutcome` opens the outcome panel, at mount or when it turns true (a «com'è andata?» notification tap).
 */
export function OfferRow({ item, now, highlighted, openOutcome = false, actions, onStatus, onRemove, onCalendar, onCounter, onCounterSent, onReanalyze, onToast, onSent, scrollRef }) {
  const t = useTheme()
  const [expanded, setExpanded] = useState(false)
  const [outcomeOpen, setOutcomeOpen] = useState(openOutcome)
  useEffect(() => {
    if (!openOutcome) return undefined
    const timer = setTimeout(() => setOutcomeOpen(true), 0) // the list may already be on screen when the tap arrives
    return () => clearTimeout(timer)
  }, [openOutcome])
  const [copied, setCopied] = useState(false) // «Copiato!» for 2 s
  const [copiedOnce, setCopiedOnce] = useState(false) // the planned-future primary becomes «Ho inviato l'offerta»
  const [confirmDelete, setConfirmDelete] = useState(false)
  const rowRef = useRef(null)
  const copiedTimer = useRef(null)
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])

  // A highlighted row (notification tap) scrolls into view when the page ScrollView is known. Best effort.
  useEffect(() => {
    if (!highlighted || !scrollRef || !scrollRef.current || !rowRef.current) return undefined
    const scroller = scrollRef.current
    const node = rowRef.current
    const timer = setTimeout(() => {
      try {
        const inner = typeof scroller.getInnerViewNode === 'function' ? scroller.getInnerViewNode() : scroller
        node.measureLayout(inner, (x, y) => scroller.scrollTo({ y: Math.max(0, y - space.sm), animated: true }), () => {})
      } catch {
        // measuring can fail on web or before layout: the highlight border still marks the row
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [highlighted, scrollRef])

  const state = rowStateOf(item, now)
  const meta = statusMeta(item.status)
  const plan = item.counterPlan
  const step = nextStepOf(item, now)
  const estimate = estimateOf(item)
  const open = segmentOf(item) === 'open'
  const hasCounter = hasSellerCounter(item)
  const discount = item.listPrice > 0 && item.targetPrice != null ? Math.round(((item.listPrice - item.targetPrice) / item.listPrice) * 100) : Math.round(item.discountPct || 0)
  const canCopy = Boolean(item.message)
  const calendarable = state === 'planned_future' || (state === 'counter_pending' && plan && plan.sendAt && new Date(plan.sendAt).getTime() > now.getTime())
  const reminderActive = Boolean(item.notificationId || (plan && Object.keys(plan.reminderIds || {}).length) || (Array.isArray(item.outcomeReminderIds) && item.outcomeReminderIds.length))
  // After a refusal: one closing line, no new number (engine-spec §4.1). A message-first offer waits for the reply to
  // the message before the offer goes out: «Ha risposto al messaggio» records it and sets the 2-hour nudge.
  const declined = item.status === 'declined'
  const messageFirst = Boolean(item.messagePolicy && item.messagePolicy.assigned === 'message_first')
  const awaitingReply = state.startsWith('sent') && messageFirst && !item.replyReceivedAt && !hasCounter
  const gateNote = item.gate && item.gate.kind && item.gate.kind !== 'offer' && item.gate.reason ? item.gate.reason : null

  const copyMessage = async () => {
    const ok = await copyText(item.message)
    if (!ok) {
      if (onToast) onToast('Non riesco a copiare il messaggio.')
      return
    }
    setCopied(true)
    setCopiedOnce(true)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 2000)
    call(actions, 'markMessageCopied', item.id)
  }

  /** «Ho inviato l'offerta» on a planned row: the message went with it only when it was copied first. */
  const markSent = async () => {
    if (copiedOnce) await call(actions, 'markMessageSent', item.id)
    await onStatus(item.id, 'sent')
    if (onSent) onSent(item)
  }

  /** The closing template after a «no»: thanks, the door stays open, no new number. */
  const copyClosing = async () => {
    const ok = await copyText(buildAfterRefusalMessage())
    if (onToast) onToast(ok ? 'Messaggio di chiusura copiato.' : 'Non riesco a copiare il messaggio.')
  }

  /** The seller answered the message sent before the offer: logged, with a reminder to send the offer in the same chat. */
  const markReplied = async () => {
    const r = await call(actions, 'markReplied', item.id)
    if (!onToast) return
    if (r && r.reminder === 'scheduled') onToast('Risposta segnata: tra 2 ore ti ricordo di inviare l\'offerta nella stessa chat.')
    else onToast(r ? 'Risposta segnata. Invia l\'offerta nella stessa chat entro 2 ore.' : 'Non riesco a segnare la risposta.')
  }

  const pick = async (statusId) => {
    setOutcomeOpen(false)
    if (statusId === 'countered') {
      onCounter(item)
      return
    }
    await onStatus(item.id, statusId)
    if (statusId === 'sent' && item.status === 'planned') {
      if (onSent) onSent(item)
      return
    }
    if (statusId === 'declined') {
      // The closing line lives in the footer: open it, so the next step is one tap away.
      setExpanded(true)
      if (onToast) onToast('Segnata come rifiutata · il messaggio di chiusura è qui sotto')
      return
    }
    if (onToast) onToast(`Segnata come ${statusMeta(statusId).label.toLowerCase()}`)
  }

  const copyLabel = copied ? 'Copiato!' : 'Copia messaggio'
  const outcomeChips = (ids) => (
    <Row>
      {ids.map((id) => <Chip key={id} compact label={statusMeta(id).label} onPress={() => pick(id)} />)}
      {state.startsWith('sent') ? <Button label="Altro…" variant="ghost" small onPress={() => setOutcomeOpen((v) => !v)} /> : null}
    </Row>
  )

  let actionsRow = null
  switch (state) {
    case 'planned_future':
      actionsRow = (
        <View style={styles.actionRow}>
          {copiedOnce || !canCopy
            ? <Button label="Ho inviato l'offerta" onPress={markSent} style={styles.grow} />
            : <Button label={copyLabel} onPress={copyMessage} style={styles.grow} />}
          {item.link ? <Button label="Apri annuncio" variant="secondary" small onPress={() => openLink(item.link)} /> : null}
        </View>
      )
      break
    case 'planned_recent':
      actionsRow = (
        <View style={styles.actionRow}>
          <Button label="Ho inviato l'offerta" onPress={markSent} style={styles.grow} />
          {canCopy ? <Button label={copyLabel} variant="secondary" small onPress={copyMessage} /> : null}
        </View>
      )
      break
    case 'planned_stale':
      actionsRow = (
        <View style={{ gap: space.sm }}>
          <Row>
            {['accepted', 'declined', 'no_reply'].map((id) => <Chip key={id} compact label={statusMeta(id).label} onPress={() => pick(id)} />)}
            <Chip compact label="Lascio perdere" onPress={() => pick('abandoned')} />
          </Row>
          {onReanalyze ? <Button label="Ricalcola" variant="secondary" small onPress={() => onReanalyze(item)} style={styles.selfStart} /> : null}
        </View>
      )
      break
    case 'counter_pending':
      actionsRow = (
        <View style={styles.actionRow}>
          <Button label={`Ho inviato ${formatEuro(plan.price)}`} onPress={() => onCounterSent(item.id)} style={styles.grow} />
          <Button label="Ricalcola" variant="secondary" small onPress={() => onCounter(item)} />
        </View>
      )
      break
    case 'counter_accept':
      actionsRow = (
        <View style={styles.actionRow}>
          {item.link ? <Button label="Apri e compra" onPress={() => openLink(item.link)} style={styles.grow} /> : null}
          <Chip compact label="Accettata, comprato" onPress={() => pick('accepted')} />
        </View>
      )
      break
    case 'counter_other':
      actionsRow = <Button label="Ricalcola" variant="secondary" small onPress={() => onCounter(item)} style={styles.selfStart} />
      break
    case 'sent_waiting':
    case 'sent_stale':
      actionsRow = outcomeChips(['accepted', 'declined', 'countered', 'no_reply'])
      break
    default:
      actionsRow = null
  }

  return (
    <View ref={rowRef} collapsable={false}>
      <Card style={highlighted ? { borderColor: t.accent, borderWidth: 2 } : null}>
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityHint={expanded ? 'Nasconde le altre azioni' : 'Mostra le altre azioni'}
          style={({ pressed }) => [styles.body, { opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={styles.topRow}>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <Text style={[styles.time, { color: t.ink3 }]} numberOfLines={1}>{timeLabelOf(item, now)}</Text>
          </View>
          <Text style={[styles.title, { color: t.ink }]} numberOfLines={2}>{item.title || 'Articolo senza titolo'}</Text>
          <Body muted small>
            {formatEuro(item.targetPrice)} su {formatEuro(item.listPrice)} (−{discount}%){estimate != null ? ` · stima ${toPercent(estimate)}%` : ''}
          </Body>
          {step ? (
            <Body>
              <Text style={styles.lead}>{step.lead}</Text>{step.rest}
            </Body>
          ) : null}
        </Pressable>

        {actionsRow}

        {expanded ? (
          <View style={[styles.footer, { borderTopColor: t.line }]}>
            <View style={styles.ghosts}>
              {item.link ? <Button label="Apri annuncio" variant="ghost" small onPress={() => openLink(item.link)} /> : null}
              {canCopy ? <Button label={copyLabel} variant="ghost" small onPress={copyMessage} /> : null}
              {calendarable ? <Button label={item.calendarOpenedAt ? 'Calendario aperto' : 'Calendario'} variant="ghost" small onPress={() => onCalendar(item)} /> : null}
              {open ? <Button label="Controproposta" variant="ghost" small onPress={() => onCounter(item)} /> : null}
              {awaitingReply ? <Button label="Ha risposto al messaggio" variant="ghost" small onPress={markReplied} /> : null}
              {declined ? <Button label="Copia il messaggio di chiusura" variant="ghost" small onPress={copyClosing} /> : null}
              <Button label={outcomeOpen ? 'Chiudi esito' : open ? 'Segna esito' : 'Ha risposto dopo'} variant="ghost" small onPress={() => setOutcomeOpen((v) => !v)} />
              {!confirmDelete ? <Button label="Elimina" variant="ghostDanger" small onPress={() => setConfirmDelete(true)} /> : null}
            </View>
            {confirmDelete ? (
              <Row>
                <Body small style={styles.confirmText}>{item.sentAt || item.status !== 'planned' ? "Eliminare? L'esito resta nei dati del motore." : 'Eliminare questa offerta?'}</Body>
                <Button label="Elimina" variant="danger" small onPress={() => onRemove(item.id)} />
                <Button label="Annulla" variant="ghost" small onPress={() => setConfirmDelete(false)} />
              </Row>
            ) : null}
            <Row>
              {open ? <Badge tone="neutral">{reminderActive ? 'Promemoria attivo' : 'Nessun promemoria'}</Badge> : null}
              {item.link ? <Text style={[styles.meta, { color: t.ink3 }]} numberOfLines={1}>{hostOf(item.link)}</Text> : null}
            </Row>
            {hasCounter ? <Body muted small>Trattativa: {negotiationLine(item)}</Body> : null}
            {item.decision && item.decision.exploration && item.decision.exploration.varied !== false ? <Body muted small>Prova del motore: {item.decision.exploration.label}</Body> : null}
            {messageFirst && open ? <Body muted small>{item.replyReceivedAt ? `Ha risposto al messaggio ${whenLabel(item.replyReceivedAt, now)}: l'offerta va nella stessa chat.` : 'Scrivi prima: l\'offerta parte dopo la sua risposta.'}</Body> : null}
            {gateNote ? <Body muted small>Regola: {gateNote}</Body> : null}
          </View>
        ) : null}

        {outcomeOpen ? <OutcomePanel item={item} onPick={pick} /> : null}
      </Card>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  time: { fontSize: 12, flexShrink: 1, minWidth: 0, textAlign: 'right' },
  title: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  lead: { fontWeight: '700' },
  actionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  // 190 + a small secondary does not fit a 360 dp phone (≈ 296 px inside the card): the secondary wraps below instead of
  // squeezing «Ho inviato l'offerta» into an ellipsis; on wider phones both share the line.
  grow: { flexGrow: 1, flexBasis: 190, minWidth: 0 },
  selfStart: { alignSelf: 'flex-start' },
  footer: { borderTopWidth: 1, paddingTop: space.md, gap: space.sm },
  ghosts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  confirmText: { flex: 1, minWidth: 140 },
  meta: { fontSize: 12, flexShrink: 1, minWidth: 0 },
})
