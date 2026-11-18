import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { INTEREST, INTEREST_CATEGORIES, INTEREST_CATEGORY_LABELS, WATCH, formatEuro, jobActive, jobEndsAt, parsePrice, rankFinds } from '../../core/index.js'
import { space, toneColors as toneOf, useTheme } from '../theme.js'
import { Body, Button, ButtonRow, Card, Chip, Collapsible, Field, InlineAction, SectionLabel } from './ui.js'

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
 * `background` ({ alarm, battery, android }): how Android's alarm clock, which starts the readings with the app in
 * any state, answered for the running job ('exact' | 'inexact' | 'failed' | null), and whether Android leaves the app
 * without battery restrictions. A verification asked by Vinted stops the job.
 */
const SCORE_TONE = { affare: 'good', 'da comprare': 'accent', 'da trattare': 'warn', lascia: 'neutral' }
const listOf = (text) => String(text || '').split(/[,;\n]+/).map((w) => w.trim()).filter(Boolean)

/** The user's interests: the categories he trades in, the brands, authors and words he follows, his sizes. */
function InterestsCard({ profile, onSave }) {
  const [categories, setCategories] = useState(profile ? profile.categories : [])
  const [words, setWords] = useState(profile ? profile.words.join(', ') : '')
  const [sizes, setSizes] = useState(profile ? profile.sizes.join(', ') : '')
  const [saved, setSaved] = useState(false)
  const toggle = (key) => { setSaved(false); setCategories((now) => (now.includes(key) ? now.filter((k) => k !== key) : [...now, key])) }
  const summary = categories.length || words.trim() ? `${categories.length} categorie${words.trim() ? ` · ${listOf(words).length} parole` : ''}` : 'non compilati: conta solo il prezzo'
  return (
    <Collapsible title="I tuoi interessi" summary={summary}>
      <View style={{ gap: space.sm }}>
        <Body small muted>Pesano per un decimo del voto. Le categorie che scegli salgono, le altre scendono; un pollice su un articolo insegna anche la sua marca e la sua categoria.</Body>
        <View style={styles.row}>
          {INTEREST_CATEGORIES.filter((k) => k !== 'altro').map((key) => <Chip key={key} compact label={INTEREST_CATEGORY_LABELS[key]} active={categories.includes(key)} onPress={() => toggle(key)} />)}
        </View>
        <Field label="Marche, autori, parole che segui" value={words} onChangeText={(v) => { setSaved(false); setWords(v) }} placeholder="es. Zerocalcare, Samsung, Nuptse" autoCapitalize="none" />
        <Field label="Le tue taglie (vestiti e scarpe)" value={sizes} onChangeText={(v) => { setSaved(false); setSizes(v) }} placeholder="es. M, 42, W32" autoCapitalize="characters" />
        <ButtonRow>
          <Button label={saved ? 'Salvati' : 'Salva gli interessi'} small variant="secondary" onPress={() => { onSave({ categories, words: listOf(words), sizes: listOf(sizes) }); setSaved(true) }} />
        </ButtonRow>
      </View>
    </Collapsible>
  )
}

/**
 * What the last judgement says about the AI, in the user's words: [text, loud] or null. `job.ai` comes from the
 * engine (watchEngine judge): 'nokey', 'keyerror', 'auth', 'balance', 'budget', 'network'…
 */
function aiNoteOf(job) {
  switch (job.ai) {
    case 'nokey': return ['Manca la chiave dell\'AI: senza schede non ci sono voti. Inseriscila in Info › «Apri il laboratorio» › DeepSeek: appena la salvi valuto da solo quello che ho trovato.', true]
    case 'keyerror': return ['La chiave dell\'AI c\'è, ma in questa lettura il telefono non l\'ha lasciata leggere. Le schede arrivano con l\'app aperta: tocca «Valuta adesso».', true]
    case 'auth': return ['L\'AI ha rifiutato la chiave: controllala in Info › «Apri il laboratorio», poi tocca «Valuta adesso».', true]
    case 'balance': return ['Il credito dell\'AI è finito: ricaricalo dal sito del fornitore, poi tocca «Valuta adesso».', true]
    case 'budget': return ['Tetto di spesa dell\'AI raggiunto per questa ricerca: i voti proseguono con le schede che ci sono.', false]
    case 'network': case 'rate': case 'server': return ['L\'AI non ha risposto in questa lettura (rete o servizio occupato): riprovo alla prossima, oppure tocca «Valuta adesso».', false]
    case 'errore': return ['La valutazione si è interrotta per un errore dell\'app: condividi il diario, così lo correggo.', true]
    default: return job.ai ? [`La risposta dell'AI non era leggibile (${job.ai}): riprovo alla prossima lettura.`, false] : null
  }
}

/** The scores the user may give with one touch. */
const RATING_STEPS = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]

export function AutoPanel({ auto, nextAt = null, onMode, onStartHunt, onStartFeed, onStop, onOpen, onClearFinds, onFeasibility, onShareLog, busy = false, background = null, onBattery = null, onVote = null, onProfile = null, onJudge = null, onRate = null }) {
  const t = useTheme()
  const { mode, job, finds, draft, profile } = auto
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
  // The list (the user's choice of 18 November): from 55 up only, best first; the rest on request. What «Svuota»
  // put away stays away.
  const [showAll, setShowAll] = useState(false)
  const [rating, setRating] = useState(null)
  const ranked = rankFinds(finds.filter((f) => !Number.isFinite(f.hidden)), job && job.kind === 'hunt' ? job : null)
  const strong = ranked.filter((f) => f.score && f.score.total >= INTEREST.SHOW_MIN)
  const weak = ranked.length - strong.length
  const shown = (showAll ? ranked : strong).slice(0, 60)
  const stopped = job && job.stopped
  const scored = finds.filter((f) => f.score).length
  const provisional = finds.filter((f) => f.score && f.score.provisional).length
  const noCard = finds.filter((f) => !f.card).length
  const aiNote = job ? aiNoteOf(job) : null
  // Readings in a row that read nothing, while the job runs: said as soon as there are two.
  const staleNote = !running || !job.stale || job.stale < 2 ? null
    : job.staleWhy === 'sessione' ? `Le ultime ${job.stale} letture non hanno letto nulla: Vinted chiede di rinnovare la sessione. Tieni l'app aperta un momento: la rinnovo con il browser.`
      : `Le ultime ${job.stale} letture non hanno letto nulla (${job.staleWhy === 'network' || job.staleWhy === 'timeout' ? 'rete' : 'pagina senza articoli'}).`
  const status = !job ? null
    : running && job.waiting ? `In pausa · ${job.reads || 0} letture: Vinted ha risposto con un controllo mentre l'app era dietro. Riprendo da qui, con l'app aperta.`
      : running ? `In corso · ${job.reads || 0} ${job.reads === 1 ? 'lettura' : 'letture'}${job.empty ? ` (${job.empty} a vuoto)` : ''}${auto.reading ? ' · leggo…' : nextAt && nextAt > now ? ` · prossima tra ${countdown(nextAt - now)}` : ' · prossima a momenti'} · fino alle ${clock(jobEndsAt(job))}`
      : stopped === 'verifica' ? 'Fermata: Vinted ha chiesto una verifica. Aprila nella scheda Vinted, poi riavvia.'
        : stopped === 'utente' ? 'Fermata da te.'
          : `Finita: ${job.reads || 0} letture${job.empty ? `, ${job.empty} a vuoto` : ''}.`

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
            <Body small muted>Dimmi cosa cerchi e quanto vuoi spendere al massimo: per {WATCH.HUNT_HOURS} ore rileggo la ricerca ogni 8–12 minuti. L'AI dice quali annunci sono proprio quel prodotto e ognuno prende un voto; un affare te lo dico subito, alla fine ti propongo quello col voto più alto e l'offerta la mandi tu, con un tocco.</Body>
            {draft ? <Body small>Dalla pagina aperta: <Text style={{ fontWeight: '700' }}>{draft.label}</Text></Body> : (
              <Field label="Cosa cerco" value={words} onChangeText={setWords} placeholder="es. Levi's 511 W32" returnKeyType="done" />
            )}
            <Field label="Taglia (se conta)" value={size} onChangeText={setSize} placeholder="es. M, W32, 42" returnKeyType="done" />
            <Field label="Prezzo massimo" value={maxText} onChangeText={setMaxText} placeholder="20" keyboardType="decimal-pad" suffix="€" returnKeyType="done" />
            <Body small muted>Per un articolo veramente buono salgo del 10% con due segnali e del 15% con tre: nuovo, proprio il prodotto cercato (e la taglia, se l'hai scritta), sotto il mercato. Il venditore solido si aggiunge quando leggo l'annuncio.</Body>
            <ButtonRow>
              <Button label={`Avvia la caccia (${WATCH.HUNT_HOURS} ore)`} small disabled={!canHunt || running || busy} onPress={() => onStartHunt({ words: draft ? null : words.trim(), maxPrice, size: size.trim() || null })} />
            </ButtonRow>
          </View>
        ) : null}
        {mode === 'auto' ? (
          <View style={{ gap: space.sm }}>
            <Body small muted>Per {WATCH.FEED_HOURS} ore rileggo la tua home di Vinted ogni 8–12 minuti: ogni volta una decina di articoli scelti da Vinted per te. L'AI compila la scheda di ognuno, per i promettenti leggo il mercato, e li metto in classifica per voto. Un affare te lo dico subito.</Body>
            <ButtonRow>
              <Button label={`Avvia la vetrina (${WATCH.FEED_HOURS} ore)`} small disabled={running || busy} onPress={onStartFeed} />
            </ButtonRow>
          </View>
        ) : null}
        {mode !== 'manual' ? (
          <View style={{ gap: space.xs }}>
            <Body small muted>Ogni lettura la fa partire la sveglia di sistema di Android: avviene anche con l'app dietro, lo schermo spento o l'app chiusa. Una notifica resta visibile finché la ricerca è in corso. Se Vinted chiede una verifica mi fermo e te lo dico.</Body>
            {background && background.android && background.battery === false ? (
              <View style={{ gap: space.xs }}>
                <Body small style={{ color: t.warnInk || t.ink, fontWeight: '600' }}>Batteria: Android limita l'app. Per 24 ore di fila serve «Senza restrizioni»: Impostazioni dell'app › Batteria.</Body>
                {onBattery ? <InlineAction label="Apri le impostazioni dell'app" onPress={onBattery} /> : null}
              </View>
            ) : null}
            {background && background.android && background.battery === true ? <Body small muted>Batteria: senza restrizioni.</Body> : null}
          </View>
        ) : null}
      </Card>

      {job ? (
        <Card>
          <SectionLabel>{job.kind === 'hunt' ? 'Caccia' : 'Vetrina'}{job.label ? ` · ${job.label}` : ''}</SectionLabel>
          <Body small style={stopped === 'verifica' ? { color: t.warnInk || t.ink, fontWeight: '600' } : null}>{status}</Body>
          {staleNote ? <Body small style={{ color: t.warn, fontWeight: '600' }}>{staleNote}</Body> : null}
          {job.kind === 'hunt' && Number.isFinite(job.maxPrice) ? <Body small muted>Prezzo massimo {formatEuro(job.maxPrice)}.</Body> : null}
          {auto.judging ? <Body small style={{ fontWeight: '600' }}>Chiedo le schede all'AI…</Body>
            : aiNote ? <Body small muted={!aiNote[1]} style={aiNote[1] ? { color: t.warn, fontWeight: '600' } : null}>{aiNote[0]}</Body> : null}
          {!auto.judging && aiNote && job.aiDetail && job.ai !== 'budget' ? <Body small muted>{job.aiDetail}</Body> : null}
          {scored || noCard ? <Body small muted>{[scored ? `${scored} con voto${provisional ? `, ${provisional} provvisori` : ''}` : null, noCard ? `${noCard} senza scheda` : null, job.aiCost ? `AI ${job.aiCost.toFixed(3).replace('.', ',')} $` : null].filter(Boolean).join(' · ')}</Body> : null}
          {running && background && background.android ? (
            <Body small muted>
              {background.alarm === 'exact' ? 'Sveglie di sistema attive: leggo anche con l\'app chiusa.'
                : background.alarm === 'inexact' ? 'Sveglie non esatte: con l\'app dietro Android può ritardare o saltare le letture.'
                  : 'Senza sveglie di sistema: leggo solo con l\'app aperta e tengo lo schermo acceso.'}
            </Body>
          ) : null}
          <ButtonRow>
            {running ? <Button label="Ferma" variant="secondary" small onPress={onStop} /> : null}
            {onJudge && noCard ? <Button label={auto.judging ? 'Valuto…' : `Valuta adesso (${noCard})`} variant={aiNote && aiNote[1] ? 'primary' : 'secondary'} small disabled={Boolean(auto.judging)} onPress={onJudge} /> : null}
            <Button label="Condividi il diario" variant="ghost" small onPress={onShareLog} />
          </ButtonRow>
        </Card>
      ) : null}

      <Card>
        <SectionLabel>Trovati{shown.length ? ` · ${shown.length}` : ''}{showAll ? '' : ` · da ${INTEREST.SHOW_MIN} in su`}</SectionLabel>
        {!ranked.length ? <Body small muted>Ancora niente. Avvia una caccia o la vetrina: qui compare quello che trovano da {INTEREST.SHOW_MIN} in su.</Body> : null}
        {ranked.length && !shown.length ? <Body small muted>Niente da {INTEREST.SHOW_MIN} in su, per ora: {weak === 1 ? 'l\'articolo letto sta' : `i ${weak} articoli letti stanno`} sotto, e non {weak === 1 ? 'vale' : 'valgono'} un'offerta.</Body> : null}
        {shown.length ? <Body small muted>Dal voto più alto. Da {INTEREST.TELL_MIN} ti avviso subito; tra {INTEREST.SHOW_MIN} e {INTEREST.TELL_MIN - 1} c'è scritta l'offerta che lo rende da comprare. Con «Dai voto», sotto i pollici, scrivi il voto che gli daresti tu: sposta i prossimi della stessa categoria.</Body> : null}
        {shown.map((f) => {
          const tone = f.score ? toneOf(t, SCORE_TONE[f.score.label] || 'neutral') : null
          // His own score: a button under the thumbs on every article that has a score (1.19.1: as a line of text
          // under the best ones only, it was not seen as something to touch).
          const canRate = Boolean(onRate) && Boolean(f.score)
          const open = canRate && rating === f.id
          return (
            <View key={f.id} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
            <View style={styles.find}>
              {f.score ? (
                <View style={[styles.score, { backgroundColor: tone.bg }]}>
                  <Text style={{ color: tone.fg, fontWeight: '800', fontSize: 16 }}>{f.score.total}</Text>
                </View>
              ) : null}
              <Pressable onPress={() => onOpen(f.url)} accessibilityRole="button" style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: t.ink, fontWeight: '600' }}>{f.title || 'Articolo'}</Text>
                <Text numberOfLines={1} style={{ color: t.ink3, fontSize: 12 }}>
                  {[f.score ? `${f.score.label}${f.score.rated ? ' (voto tuo)' : f.score.provisional && !f.score.unsure ? ' (provvisorio)' : ''}` : null, f.brand, f.size, f.condition, f.favourites > 0 ? `${f.favourites} ♥` : null, f.boost ? 'boost' : null].filter(Boolean).join(' · ')}
                </Text>
                {f.score && f.score.reasons.length ? <Text numberOfLines={3} style={{ color: t.ink2, fontSize: 12 }}>{f.score.reasons.slice(0, 2).join(' · ')}</Text> : null}
                {f.exceptional || f.tolerancePct || f.eligible === false ? (
                  <Text numberOfLines={1} style={{ color: f.eligible === false ? t.ink3 : t.accentInk, fontSize: 12, fontWeight: '600' }}>
                    {f.eligible === false ? `oltre il massimo (${formatEuro(f.limit)})` : [f.exceptional ? 'sotto il 70% del massimo' : null, f.tolerancePct ? `veramente buono: fino a ${formatEuro(f.limit)}` : null].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </Pressable>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={{ color: t.ink, fontWeight: '700' }}>{formatEuro(f.price)}</Text>
                {Number.isFinite(f.was) && f.was > f.price ? <Text style={{ color: t.ink3, fontSize: 12, textDecorationLine: 'line-through' }}>{formatEuro(f.was)}</Text> : null}
                {onVote ? (
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <Pressable onPress={() => onVote(f.id, f.vote === 1 ? 0 : 1)} accessibilityRole="button" accessibilityLabel="Mi interessa" hitSlop={6} style={[styles.thumb, { borderColor: f.vote === 1 ? t.good : t.line, backgroundColor: f.vote === 1 ? t.goodSoft : 'transparent' }]}>
                      <Text style={{ fontSize: 13 }}>👍</Text>
                    </Pressable>
                    <Pressable onPress={() => onVote(f.id, f.vote === -1 ? 0 : -1)} accessibilityRole="button" accessibilityLabel="Non mi interessa" hitSlop={6} style={[styles.thumb, { borderColor: f.vote === -1 ? t.bad : t.line, backgroundColor: f.vote === -1 ? t.badSoft : 'transparent' }]}>
                      <Text style={{ fontSize: 13 }}>👎</Text>
                    </Pressable>
                  </View>
                ) : null}
                {canRate ? (
                  <Pressable
                    onPress={() => setRating(open ? null : f.id)} accessibilityRole="button" hitSlop={6}
                    accessibilityLabel={f.score.rated ? `Il tuo voto: ${f.score.total}. Cambia` : 'Dai il tuo voto'}
                    style={({ pressed }) => [styles.rate, { borderColor: t.accent, backgroundColor: f.score.rated ? t.accent : open ? t.accentSoft : 'transparent', opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: f.score.rated ? t.onAccent : t.accentInk }}>{f.score.rated ? `Tuo: ${f.score.total}` : 'Dai voto'}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            {open ? (
              <View style={[styles.rating, { backgroundColor: t.bg, borderColor: t.line }]}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>Che voto gli daresti?</Text>
                <Text style={{ color: t.ink2, fontSize: 12 }}>{f.score.rated ? `Il mio era ${f.score.base}. ` : `Il mio è ${f.score.total}. `}Tocca un numero: questo articolo lo prende, e i prossimi della stessa categoria si spostano un po'.</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                  {RATING_STEPS.map((n) => <Chip key={n} compact label={String(n)} active={Boolean(f.score.rated) && f.score.total === n} onPress={() => { onRate(f.id, n); setRating(null) }} />)}
                </View>
                <View style={{ flexDirection: 'row', gap: space.md }}>
                  {f.score.rated ? <InlineAction label="Togli il mio voto" tone="danger" onPress={() => { onRate(f.id, null); setRating(null) }} /> : null}
                  <InlineAction label="Chiudi" tone="neutral" onPress={() => setRating(null)} />
                </View>
              </View>
            ) : null}
            </View>
          )
        })}
        {weak ? <InlineAction label={showAll ? `Mostra solo da ${INTEREST.SHOW_MIN} in su` : `Mostra anche ${weak === 1 ? 'quello' : `i ${weak}`} sotto ${INTEREST.SHOW_MIN}`} tone="neutral" onPress={() => setShowAll(!showAll)} /> : null}
        {ranked.length ? <InlineAction label="Svuota i trovati" onPress={onClearFinds} /> : null}
        {ranked.length ? <Body small muted>Svuotare non cancella quello che hai insegnato: pollici e voti tuoi restano in memoria e valgono per le prossime ricerche.</Body> : null}
      </Card>

      {onProfile ? <InterestsCard key={profile ? 'loaded' : 'empty'} profile={profile} onSave={onProfile} /> : null}

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
  find: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  score: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 30, height: 26, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  // As wide as the two thumbs above it.
  rate: { width: 64, height: 28, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  rating: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: space.md, marginBottom: space.sm, gap: space.sm },
})
