import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { inSegment, matchesQuery, sectionsFor, segmentCounts, segmentLabel, segmentOf } from '../services/segments.js'
import { radius, space, useTheme } from '../theme.js'
import { Body, Button, Card, InlineAction, SectionLabel, Title } from './ui.js'
import { ListToolbar } from './list/ListToolbar.js'
import { OfferRow } from './list/OfferRow.js'

const EMPTY = {
  open: { title: 'Nessuna offerta in corso', body: 'Tutte le tue offerte hanno un esito: le trovi in Accettate, Rifiutate o Tutte.' },
  won: { title: 'Ancora nessuna accettata', body: "Quando un venditore accetta, segna l'esito dalla scheda dell'offerta." },
  lost: { title: 'Nessuna rifiutata', body: 'Qui finiscono rifiuti, mancate risposte, articoli venduti ad altri e offerte lasciate perdere.' },
  all: { title: 'Nessuna offerta', body: 'Le offerte salvate compaiono qui.' },
}

const UNDO_MS = 8000

/**
 * The Lista: toolbar (search, segments, honesty line), the rows grouped as the segment asks, the empty states.
 * `segment` and `query` live here and reset on every mount. `actions` is the whole useWatchlist object.
 * `onGoInfo` and `scrollRef` are optional extras (Info tab for «Perché →», page ScrollView for scrolling to a row).
 */
export function WatchlistView({ items, ready, highlightId, now, stats, actions, onStatus, onRemove, onCalendar, onCounter, onCounterSent, onGoCalcola, onGoInfo, onReanalyze, onToast, scrollRef }) {
  const t = useTheme()
  const [segment, setSegment] = useState('open')
  const [query, setQuery] = useState('')
  const [undo, setUndo] = useState(null) // { id }: «Segnata come inviata · Annulla» for a few seconds
  const [outcomeFor, setOutcomeFor] = useState(null) // row whose outcome panel opens (a «com'è andata?» tap)
  const undoTimer = useRef(null)
  // Latest props for the deferred highlight handler: the effect must not re-run on every parent render.
  const itemsRef = useRef(items)
  const toastRef = useRef(onToast)
  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => { toastRef.current = onToast }, [onToast])
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current) }, [])

  // A notification tap lands on its row: the segment that holds it, no query, outcome panel open for a sent offer.
  useEffect(() => {
    if (!ready || !highlightId) return undefined
    const timer = setTimeout(() => {
      const item = itemsRef.current.find((it) => it.id === highlightId)
      if (!item) {
        if (toastRef.current) toastRef.current('Offerta non più in lista')
        return
      }
      setQuery('')
      setSegment(segmentOf(item))
      setOutcomeFor(item.status === 'sent' ? item.id : null)
    }, 0)
    return () => clearTimeout(timer)
  }, [highlightId, ready])

  const changeSegment = (id) => {
    setSegment(id)
    setOutcomeFor(null) // a hand-picked segment ends the notification's "open the outcome panel" request
  }

  const counts = useMemo(() => segmentCounts(items), [items])

  const sections = useMemo(() => sectionsFor(items.filter((it) => matchesQuery(it, query)), segment, now), [items, query, segment, now])
  const shown = sections.reduce((n, s) => n + s.items.length, 0)
  const elsewhere = useMemo(() => {
    if (shown > 0 || !query.trim() || segment === 'all') return null
    const count = items.filter((it) => !inSegment(it, segment) && matchesQuery(it, query)).length
    return count ? { count, segmentLabel: segmentLabel(segment) } : null
  }, [items, query, segment, shown])

  const noteSent = (item) => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndo({ id: item.id })
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS)
    if (onToast) onToast('Segnata come inviata')
  }
  const undoSent = async () => {
    const id = undo && undo.id
    setUndo(null)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    if (!id) return
    await onStatus(id, 'planned')
    if (onToast) onToast('Rimessa tra quelle da inviare')
  }

  if (!ready) return <Card><Body muted>Carico la lista…</Body></Card>
  if (items.length === 0) {
    return (
      <Card>
        <Title>Nessuna offerta salvata</Title>
        <Body muted>Analizza un annuncio in Calcola e tocca «Salva e ricordamelo»: la troverai qui con orario e messaggio pronti.</Body>
        {onGoCalcola ? <Button label="Vai a Calcola" onPress={onGoCalcola} /> : null}
      </Card>
    )
  }

  const empty = EMPTY[segment] || EMPTY.all
  return (
    <View style={{ gap: space.lg }}>
      <ListToolbar query={query} onQuery={setQuery} segment={segment} onSegment={changeSegment} counts={counts} stats={stats} onGoInfo={onGoInfo} elsewhere={elsewhere} />
      {undo ? (
        <View style={[styles.undo, { backgroundColor: t.cardMuted }]}>
          <Body small style={styles.undoText}>Segnata come inviata.</Body>
          <InlineAction label="Annulla" onPress={undoSent} />
        </View>
      ) : null}
      {shown === 0 ? (
        query.trim() ? (
          <Card muted>
            <Title>Nessun risultato per «{query.trim()}»</Title>
            <Button label="Cancella la ricerca" variant="ghost" small onPress={() => setQuery('')} />
          </Card>
        ) : (
          <Card muted>
            <Title>{empty.title}</Title>
            <Body muted>{empty.body}</Body>
          </Card>
        )
      ) : (
        sections.map((section) => [
          section.label ? <SectionLabel key={`label-${section.id}`}>{section.label}</SectionLabel> : null,
          ...section.items.map((item) => (
            <OfferRow
              key={item.id}
              item={item}
              now={now}
              highlighted={item.id === highlightId}
              openOutcome={item.id === outcomeFor}
              actions={actions}
              onStatus={onStatus}
              onRemove={onRemove}
              onCalendar={onCalendar}
              onCounter={onCounter}
              onCounterSent={onCounterSent}
              onReanalyze={onReanalyze}
              onToast={onToast}
              onSent={noteSent}
              scrollRef={scrollRef}
            />
          )),
        ])
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  undo: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  undoText: { flexShrink: 1, minWidth: 0 },
})
