import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { WATCH, formatEuro, jobActive, jobEndsAt, parsePrice, rankFinds } from '../../core/index.js'
import { space, useTheme } from '../theme.js'
import { Body, Button, ButtonRow, Card, Chip, Field, InlineAction, SectionLabel, Title } from './ui.js'

const MODES = [
  { id: 'manual', label: 'Manuale' },
  { id: 'semi', label: 'Semi-automatica' },
  { id: 'auto', label: 'Automatica' },
]
const clock = (ms) => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
const countdown = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * «Caccia» (1.14): the three modes and what the two automatic ones found.
 * - Manuale: nothing runs by itself.
 * - Semi-automatica: a search (typed here, or taken from the page open in the Vinted tab: `draft`) is read again for
 *   24 hours; the best article within the highest price is proposed, and the user sends the offer.
 * - Automatica: the user's Vinted home is read again for 8 hours and what passed there is ranked.
 * The readings happen while the app is open; a verification asked by Vinted stops the job.
 */
export function AutoPanel({ auto, nextAt = null, onMode, onStartHunt, onStartFeed, onStop, onOpen, onClearFinds, onFeasibility, onShareLog, busy = false }) {
  const t = useTheme()
  const { mode, job, finds, draft } = auto
  const [words, setWords] = useState('')
  const [maxText, setMaxText] = useState('')
  const [size, setSize] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const running = jobActive(job, now)
  useEffect(() => {
    if (!running) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const maxPrice = parsePrice(maxText)
  const canHunt = Number.isFinite(maxPrice) && maxPrice > 0 && (Boolean(draft) || words.trim().length >= 2)
  const shown = rankFinds(finds, job && job.kind === 'hunt' ? job : null).slice(0, 60)
  const stopped = job && job.stopped
  const status = !job ? null
    : running ? `In corso · ${job.reads || 0} ${job.reads === 1 ? 'lettura' : 'letture'}${nextAt && nextAt > now ? ` · prossima tra ${countdown(nextAt - now)}` : ' · leggo…'} · fino alle ${clock(jobEndsAt(job))}`
      : stopped === 'verifica' ? 'Fermata: Vinted ha chiesto una verifica. Aprila nella scheda Vinted, poi riavvia.'
        : stopped === 'utente' ? 'Fermata da te.'
          : `Finita: ${job.reads || 0} letture.`

  return (
    <View style={{ gap: space.md }}>
      <Card>
        <SectionLabel>Modalità</SectionLabel>
        <View style={styles.row}>
          {MODES.map((m) => <Chip key={m.id} compact label={m.label} active={mode === m.id} onPress={() => onMode(m.id)} />)}
        </View>
        {mode === 'manual' ? <Body small muted>Come sempre: apri un annuncio e lo analizzi tu. Niente gira da solo.</Body> : null}
        {mode === 'semi' ? (
          <View style={{ gap: space.sm }}>
            <Body small muted>Dimmi cosa cerchi e quanto vuoi spendere al massimo: per {WATCH.HUNT_HOURS} ore rileggo la ricerca ogni 8–12 minuti. Un affare eccezionale te lo dico subito; alla fine ti propongo il migliore e l'offerta la mandi tu, con un tocco.</Body>
            {draft ? <Body small>Dalla pagina aperta: <Text style={{ fontWeight: '700' }}>{draft.label}</Text></Body> : (
              <Field label="Cosa cerco" value={words} onChangeText={setWords} placeholder="es. Levi's 511 W32" returnKeyType="done" />
            )}
            <Field label="Taglia (se conta)" value={size} onChangeText={setSize} placeholder="es. M, W32, 42" returnKeyType="done" />
            <Field label="Prezzo massimo" value={maxText} onChangeText={setMaxText} placeholder="20" keyboardType="decimal-pad" suffix="€" returnKeyType="done" />
            <Body small muted>Per un articolo veramente buono salgo del 10% con due segnali e del 15% con tre. Per ora conto i due che la scheda mostra (nuovo, taglia giusta); venditore solido e sotto il mercato si aggiungono quando leggo l'annuncio.</Body>
            <ButtonRow>
              <Button label={`Avvia la caccia (${WATCH.HUNT_HOURS} ore)`} small disabled={!canHunt || running || busy} onPress={() => onStartHunt({ words: draft ? null : words.trim(), maxPrice, size: size.trim() || null })} />
            </ButtonRow>
          </View>
        ) : null}
        {mode === 'auto' ? (
          <View style={{ gap: space.sm }}>
            <Body small muted>Per {WATCH.FEED_HOURS} ore rileggo la tua home di Vinted ogni 8–12 minuti e tengo quello che passa: i più cercati e quelli che calano di prezzo in cima.</Body>
            <ButtonRow>
              <Button label={`Avvia la vetrina (${WATCH.FEED_HOURS} ore)`} small disabled={running || busy} onPress={onStartFeed} />
            </ButtonRow>
          </View>
        ) : null}
        {mode !== 'manual' ? <Body small muted>Per ora legge mentre l'app è aperta sullo schermo: finché una ricerca è in corso tengo lo schermo acceso (meglio col telefono in carica). Se esci dall'app le letture si fermano e riprendono quando torni. Se Vinted chiede una verifica mi fermo e te lo dico.</Body> : null}
      </Card>

      {job ? (
        <Card>
          <SectionLabel>{job.kind === 'hunt' ? 'Caccia' : 'Vetrina'}{job.label ? ` · ${job.label}` : ''}</SectionLabel>
          <Body small style={stopped === 'verifica' ? { color: t.warnInk || t.ink, fontWeight: '600' } : null}>{status}</Body>
          {job.kind === 'hunt' && Number.isFinite(job.maxPrice) ? <Body small muted>Prezzo massimo {formatEuro(job.maxPrice)}.</Body> : null}
          <ButtonRow>
            {running ? <Button label="Ferma" variant="secondary" small onPress={onStop} /> : null}
            <Button label="Condividi il diario" variant="ghost" small onPress={onShareLog} />
          </ButtonRow>
        </Card>
      ) : null}

      <Card>
        <SectionLabel>Trovati{shown.length ? ` · ${shown.length}` : ''}</SectionLabel>
        {!shown.length ? <Body small muted>Ancora niente. Avvia una caccia o la vetrina: qui compare quello che trovano.</Body> : null}
        {shown.map((f) => (
          <Pressable key={f.id} onPress={() => onOpen(f.url)} accessibilityRole="button" style={[styles.find, { borderColor: t.line }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: t.ink, fontWeight: '600' }}>{f.title || 'Articolo'}</Text>
              <Text numberOfLines={1} style={{ color: t.ink3, fontSize: 12 }}>
                {[f.brand, f.size, f.condition, Number.isFinite(f.favourites) ? `${f.favourites} ♥` : null, f.seen > 1 ? `visto ${f.seen} volte` : null].filter(Boolean).join(' · ')}
              </Text>
              {f.exceptional || f.tolerancePct || f.eligible === false ? (
                <Text numberOfLines={1} style={{ color: f.eligible === false ? t.ink3 : t.accentInk, fontSize: 12, fontWeight: '600' }}>
                  {f.eligible === false ? `oltre il massimo (${formatEuro(f.limit)})` : [f.exceptional ? 'affare' : null, f.tolerancePct ? `veramente buono: fino a ${formatEuro(f.limit)}` : null].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: t.ink, fontWeight: '700' }}>{formatEuro(f.price)}</Text>
              {Number.isFinite(f.was) && f.was > f.price ? <Text style={{ color: t.ink3, fontSize: 12, textDecorationLine: 'line-through' }}>{formatEuro(f.was)}</Text> : null}
            </View>
          </Pressable>
        ))}
        {shown.length ? <InlineAction label="Svuota i trovati" onPress={onClearFinds} /> : null}
      </Card>

      <Card muted>
        <SectionLabel>Prova di fattibilità</SectionLabel>
        <Body small muted>Misura sul tuo telefono in che modi la ricerca e la home si riescono a leggere. Dura meno di un minuto; il risultato lo condividi con chi sviluppa l'app.</Body>
        <ButtonRow>
          <Button label={busy ? 'Provo…' : 'Esegui la prova'} variant="secondary" small disabled={busy} onPress={onFeasibility} />
        </ButtonRow>
      </Card>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  find: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
})
