import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { INTEREST, INTEREST_CATEGORIES, INTEREST_CATEGORY_LABELS, WATCH, formatEuro, jobActive, jobEndsAt, parsePrice, rankFinds, searchAdviceOf, searchIdeasOf, searchLineOf, searchYields, sourceReport } from '../../core/index.js'
import { space, toneColors as toneOf, useTheme } from '../theme.js'
import { Body, Button, ButtonRow, Card, Chip, Collapsible, Field, InlineAction, SectionLabel } from './ui.js'

/** What can run by itself, in the user's words (1.21): the engine's modes are 'auto' (the first and the last) and 'semi'. */
const CHOICES = [
  { id: 'news', label: 'Ricerche' },
  { id: 'hunt', label: 'Un articolo' },
  { id: 'home', label: 'Home' },
]
const isNews = (job) => Boolean(job && job.kind === 'feed' && Array.isArray(job.sources) && job.sources.length)
const titleOf = (job) => (job.kind === 'hunt' ? `Un articolo${job.label ? ` · ${job.label}` : ''}` : isNews(job) ? 'Le mie ricerche' : 'La mia home')
const keyOf = (label) => String(label || '').replace(/\s+/g, ' ').trim().toLowerCase()
const clock = (ms) => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
const countdown = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * «Caccia»: what runs by itself and what it found. Since 1.21 the screen asks one thing, «what do I run?»:
 * - Le mie ricerche («novità»): the searches the user follows, read in turn from their newest listing for 8 hours.
 *   Each shows what it brought so far, and what he liked suggests others.
 * - Un articolo (the hunt): a search (typed here, or taken from the page open in the Vinted tab: `draft`) is read
 *   again for 24 hours; the best article within the highest price is proposed, and the user sends the offer.
 * - La mia home: the user's Vinted home is read again for 8 hours and what passed there is ranked.
 * While a job runs its card comes first and the choice is not shown; the details and the tools are folded away.
 * `background` ({ alarm, battery, android }): how Android's alarm clock, which starts the readings with the app in
 * any state, answered for the running job ('exact' | 'inexact' | 'failed' | null), and whether Android leaves the app
 * without battery restrictions. A verification asked by Vinted stops the job.
 */
const SCORE_TONE = { affare: 'good', 'da comprare': 'accent', 'da trattare': 'warn', lascia: 'neutral' }
const listOf = (text) => String(text || '').split(/[,;\n]+/).map((w) => w.trim()).filter(Boolean)

/** The user's interests: the categories he trades in, the brands, authors and words he follows, his sizes. */
function InterestsCard({ profile, onSave }) {
  const [categories, setCategories] = useState(profile ? profile.categories : [])
  const [sizes, setSizes] = useState(profile ? profile.sizes.join(', ') : '')
  const [saved, setSaved] = useState(false)
  const toggle = (key) => { setSaved(false); setCategories((now) => (now.includes(key) ? now.filter((k) => k !== key) : [...now, key])) }
  const summary = categories.length || sizes.trim() ? `${categories.length} ${categories.length === 1 ? 'categoria' : 'categorie'}${sizes.trim() ? ` · taglie ${listOf(sizes).join(', ')}` : ''}` : 'non compilati: conta solo il prezzo'
  return (
    <Collapsible title="I tuoi interessi" summary={summary}>
      <View style={{ gap: space.sm }}>
        <Body small muted>Pesano per un decimo del voto: le categorie che scegli salgono, le altre scendono. Le ricerche che segui contano già come interessi, e un pollice insegna marca e categoria.</Body>
        <View style={styles.row}>
          {INTEREST_CATEGORIES.filter((k) => k !== 'altro').map((key) => <Chip key={key} compact label={INTEREST_CATEGORY_LABELS[key]} active={categories.includes(key)} onPress={() => toggle(key)} />)}
        </View>
        <Field label="Le tue taglie (vestiti e scarpe)" value={sizes} onChangeText={(v) => { setSaved(false); setSizes(v) }} placeholder="es. M, 42, W32" autoCapitalize="characters" />
        <ButtonRow>
          <Button label={saved ? 'Salvati' : 'Salva gli interessi'} small variant="secondary" onPress={() => { onSave({ categories, sizes: listOf(sizes) }); setSaved(true) }} />
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

/**
 * What changes every second (the countdown to the next reading), apart: the panel and its list are drawn again
 * only when something happens, not sixty times a minute (1.21).
 */
function Ticking({ children }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return children(now)
}

/** A search followed: what it brought so far, and what to do with it. */
function SearchRow({ label, line, onRemove = null }) {
  const t = useTheme()
  const color = line.tone === 'neutral' ? t.ink3 : toneOf(t, line.tone).fg
  return (
    <View style={[styles.search, { borderColor: t.line }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: t.ink, fontWeight: '600' }}>{label}</Text>
        <Text numberOfLines={3} style={{ color, fontSize: 12 }}>{line.text}</Text>
      </View>
      {onRemove ? (
        <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Togli ${label}`} hitSlop={6} style={({ pressed }) => [styles.rate, { borderColor: t.line, marginTop: 0, opacity: pressed ? 0.7 : 1 }]}>
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: t.ink2 }}>Togli</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/** The scores the user may give with one touch. */
const RATING_STEPS = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]

export function AutoPanel({ auto, nextAt = null, onMode, onStartHunt, onStartFeed, onStop, onOpen, onClearFinds, onFeasibility, onShareLog, busy = false, background = null, onBattery = null, onVote = null, onProfile = null, onJudge = null, onRate = null, onStartNews = null, onWait = null, onUnwait = null }) {
  const t = useTheme()
  const { mode, job, finds, draft, profile } = auto
  const [words, setWords] = useState('')
  const [maxText, setMaxText] = useState('')
  const [size, setSize] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const running = jobActive(job, now)
  useEffect(() => {
    if (!running) return undefined
    // Only to see the job's end: the countdown ticks in its own component.
    const id = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(id)
  }, [running])

  const maxPrice = parsePrice(maxText)
  const canHunt = Number.isFinite(maxPrice) && maxPrice > 0 && (Boolean(draft) || words.trim().length >= 2)
  // The list (the user's choice of 18 November): from 55 up only, best first; the rest on request. What «Svuota»
  // put away stays away.
  const [showAll, setShowAll] = useState(false)
  const [rating, setRating] = useState(null)
  const ranked = rankFinds(finds.filter((f) => !Number.isFinite(f.hidden) && !f.waiting), job && job.kind === 'hunt' ? job : null)
  // What to run: his searches unless he chose otherwise; a page handed over by the Vinted tab is one article.
  const [picked, setPicked] = useState(null)
  const what = draft ? 'hunt' : picked || (mode === 'semi' ? 'hunt' : job && job.kind === 'feed' && !isNews(job) ? 'home' : 'news')
  const pick = (id) => { setPicked(id); onMode(id === 'hunt' ? 'semi' : 'auto') }
  const [details, setDetails] = useState(false)
  // The searches followed are the user's own words (his interests): saved as they change, shown at once.
  const [edited, setEdited] = useState(null)
  const [typing, setTyping] = useState('')
  const searches = edited || (profile && Array.isArray(profile.words) ? profile.words : [])
  const followed = searches.slice(0, WATCH.ROTATION_MAX)
  const change = (next) => { setEdited(next); if (onProfile) onProfile({ words: next }) }
  const typed = typing.replace(/\s+/g, ' ').trim().slice(0, 60)
  const canAdd = typed.length >= 2 && searches.length < WATCH.ROTATION_MAX && !searches.some((w) => keyOf(w) === keyOf(typed))
  const add = (label) => { if (searches.length < WATCH.ROTATION_MAX && !searches.some((w) => keyOf(w) === keyOf(label))) change([...searches, label]) }
  const typedAdvice = typed.length >= 2 ? searchAdviceOf(typed) : null
  const waits = Array.isArray(auto.waits) ? auto.waits : []
  // Where reading pays: how many of what each source brought are worth a look — in this job, and in those before.
  const report = sourceReport(finds).filter((r) => r.articoli > 0)
  const news = isNews(job)
  const yields = searchYields(auto.history, news && !job.stopped ? report : null)
  const lineOf = (label) => searchLineOf(label, yields[keyOf(label)], { showMin: INTEREST.SHOW_MIN, tellMin: INTEREST.TELL_MIN })
  const ideas = searchIdeasOf({ finds, waits, likes: profile ? profile.likes : null, history: auto.history, following: searches, tellMin: INTEREST.TELL_MIN })
  const others = report.filter((r) => !news || !job.sources.some((x) => keyOf(x.label) === keyOf(r.fonte)))
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
  const statusAt = (at) => (!job ? null
    : running && job.waiting ? `In pausa · ${job.reads || 0} letture: Vinted ha risposto con un controllo mentre l'app era dietro. Riprendo da qui, con l'app aperta.`
      : running ? `In corso · ${job.reads || 0} ${job.reads === 1 ? 'lettura' : 'letture'}${job.empty ? ` (${job.empty} a vuoto)` : ''}${auto.reading ? ' · leggo…' : nextAt && nextAt > at ? ` · prossima tra ${countdown(nextAt - at)}` : ' · prossima a momenti'} · fino alle ${clock(jobEndsAt(job))}`
      : stopped === 'verifica' ? 'Fermata: Vinted ha chiesto una verifica. Aprila nella scheda Vinted, poi riavvia.'
        : stopped === 'utente' ? 'Fermata da te.'
          : `Finita: ${job.reads || 0} letture${job.empty ? `, ${job.empty} a vuoto` : ''}.`)

  // The job's card: first while it runs, after the choice once it ended. What needs the user is said; the rest folds.
  const alarmNote = !running || !background || !background.android || background.alarm === 'exact' ? null
    : background.alarm === 'inexact' ? 'Sveglie non esatte: con l\'app dietro Android può ritardare o saltare le letture.'
      : 'Senza sveglie di sistema: leggo solo con l\'app aperta e tengo lo schermo acceso.'
  const batteryNote = background && background.android && background.battery === false ? (
    <View style={{ gap: space.xs }}>
      <Body small style={{ color: t.warnInk || t.ink, fontWeight: '600' }}>Batteria: Android limita l'app. Per ore di fila serve «Senza restrizioni»: Impostazioni dell'app › Batteria.</Body>
      {onBattery ? <InlineAction label="Apri le impostazioni dell'app" onPress={onBattery} /> : null}
    </View>
  ) : null
  const counts = [scored ? `${scored} con voto${provisional ? `, ${provisional} provvisori` : ''}` : null, noCard ? `${noCard} senza scheda` : null, job && job.aiCost ? `AI ${job.aiCost.toFixed(3).replace('.', ',')} $` : null].filter(Boolean).join(' · ')
  const jobCard = job ? (
    <Card>
      <SectionLabel>{running ? '' : 'Ultima ricerca · '}{titleOf(job)}</SectionLabel>
      {running && !job.waiting ? <Ticking>{(at) => <Body small>{statusAt(at)}</Body>}</Ticking>
        : <Body small style={stopped === 'verifica' ? { color: t.warnInk || t.ink, fontWeight: '600' } : null}>{statusAt(now)}</Body>}
      {staleNote ? <Body small style={{ color: t.warn, fontWeight: '600' }}>{staleNote}</Body> : null}
      {auto.judging ? <Body small style={{ fontWeight: '600' }}>Chiedo le schede all'AI…</Body>
        : aiNote && aiNote[1] ? <Body small style={{ color: t.warn, fontWeight: '600' }}>{aiNote[0]}</Body> : null}
      {alarmNote ? <Body small style={{ color: t.warn, fontWeight: '600' }}>{alarmNote}</Body> : null}
      {running ? batteryNote : null}
      {running && news ? job.sources.map((x) => <SearchRow key={x.label} label={x.label} line={lineOf(x.label)} />) : null}
      <ButtonRow>
        {running ? <Button label="Ferma" variant="secondary" small onPress={onStop} /> : null}
        {onJudge && noCard ? <Button label={auto.judging ? 'Valuto…' : `Valuta adesso (${noCard})`} variant={aiNote && aiNote[1] ? 'primary' : 'secondary'} small disabled={Boolean(auto.judging)} onPress={onJudge} /> : null}
        <Button label="Condividi il diario" variant="ghost" small onPress={onShareLog} />
      </ButtonRow>
      <InlineAction label={details ? 'Nascondi i dettagli' : 'Dettagli'} tone="neutral" onPress={() => setDetails(!details)} />
      {details ? (
        <View style={{ gap: space.xs }}>
          {counts ? <Body small muted>{counts}</Body> : null}
          {!auto.judging && aiNote && !aiNote[1] ? <Body small muted>{aiNote[0]}</Body> : null}
          {!auto.judging && aiNote && job.aiDetail && job.ai !== 'budget' ? <Body small muted>{job.aiDetail}</Body> : null}
          {job.kind === 'hunt' && Number.isFinite(job.maxPrice) ? <Body small muted>Prezzo massimo {formatEuro(job.maxPrice)}.</Body> : null}
          {others.length ? <Body small muted>Resa: {others.slice(0, 6).map((r) => `${r.fonte} ${r.da_55} su ${r.articoli}${r.da_70 ? ` (${r.da_70} da ${INTEREST.TELL_MIN})` : ''}`).join(' · ')} da {INTEREST.SHOW_MIN} in su.</Body> : null}
          {running && background && background.android && background.alarm === 'exact' ? <Body small muted>Sveglie di sistema attive: leggo anche con l'app chiusa.</Body> : null}
          {background && background.android && background.battery === true ? <Body small muted>Batteria: senza restrizioni.</Body> : null}
        </View>
      ) : null}
    </Card>
  ) : null

  return (
    <View style={{ gap: space.md }}>
      {running ? jobCard : (
        <Card>
          <SectionLabel>Cosa faccio girare?</SectionLabel>
          <View style={styles.row}>
            {CHOICES.map((c) => <Chip key={c.id} compact label={c.label} active={what === c.id} onPress={() => pick(c.id)} />)}
          </View>
          {what === 'news' ? (
            <View style={{ gap: space.sm }}>
              <Body small muted>Per {WATCH.FEED_HOURS} ore leggo le tue ricerche dal più recente, una per volta: un annuncio lo vedi appena pubblicato.</Body>
              {followed.map((label) => <SearchRow key={label} label={label} line={lineOf(label)} onRemove={() => change(searches.filter((w) => w !== label))} />)}
              {searches.length > followed.length ? <Body small muted>Seguo le prime {WATCH.ROTATION_MAX}: le altre {searches.length - followed.length} contano solo come interessi.</Body> : null}
              {!followed.length ? <Body small muted>Rende una marca, un autore o un modello: «zerocalcare», «lego star wars», «nintendo switch oled». Un tipo di oggetto («maglia», «dischi») no: non ha un prezzo di rivendita con cui confrontare.</Body> : null}
              {searches.length < WATCH.ROTATION_MAX ? (
                <View style={{ gap: space.xs }}>
                  <Field label={`Aggiungi una ricerca (${searches.length} di ${WATCH.ROTATION_MAX})`} value={typing} onChangeText={setTyping} placeholder="marca, autore o modello" autoCapitalize="none" returnKeyType="done" onSubmitEditing={() => { if (canAdd) { add(typed); setTyping('') } }} />
                  {typedAdvice ? <Body small style={{ color: t.warn }}>{typedAdvice.text}</Body> : null}
                  <ButtonRow>
                    <Button label="Aggiungi" variant="secondary" small disabled={!canAdd} onPress={() => { add(typed); setTyping('') }} />
                  </ButtonRow>
                </View>
              ) : null}
              {ideas.length && searches.length < WATCH.ROTATION_MAX ? (
                <View style={{ gap: space.xs }}>
                  <Body small muted>Idee da ciò che ti è piaciuto o ha già reso (tocca per aggiungere):</Body>
                  <View style={styles.row}>
                    {ideas.map((i) => <Chip key={i.label} compact label={`+ ${i.label}`} onPress={() => add(i.label)} />)}
                  </View>
                </View>
              ) : null}
              <ButtonRow>
                <Button label={`Avvia per ${WATCH.FEED_HOURS} ore`} small disabled={!followed.length || busy || !onStartNews} onPress={() => onStartNews(followed)} />
              </ButtonRow>
            </View>
          ) : null}
          {what === 'hunt' ? (
            <View style={{ gap: space.sm }}>
              <Body small muted>Per {WATCH.HUNT_HOURS} ore rileggo una ricerca precisa entro il tuo prezzo massimo: un affare te lo dico subito, alla fine ti propongo il migliore.</Body>
              {draft ? <Body small>Dalla pagina aperta: <Text style={{ fontWeight: '700' }}>{draft.label}</Text></Body> : (
                <Field label="Cosa cerco" value={words} onChangeText={setWords} placeholder="es. Levi's 511 W32" returnKeyType="done" />
              )}
              <Field label="Taglia (se conta)" value={size} onChangeText={setSize} placeholder="es. M, W32, 42" returnKeyType="done" />
              <Field label="Prezzo massimo" value={maxText} onChangeText={setMaxText} placeholder="20" keyboardType="decimal-pad" suffix="€" returnKeyType="done" />
              <ButtonRow>
                <Button label={`Avvia per ${WATCH.HUNT_HOURS} ore`} small disabled={!canHunt || busy} onPress={() => onStartHunt({ words: draft ? null : words.trim(), maxPrice, size: size.trim() || null })} />
              </ButtonRow>
            </View>
          ) : null}
          {what === 'home' ? (
            <View style={{ gap: space.sm }}>
              <Body small muted>Per {WATCH.FEED_HOURS} ore rileggo la tua home di Vinted: a ogni lettura una decina di articoli scelti da Vinted per te.</Body>
              <ButtonRow>
                <Button label={`Avvia per ${WATCH.FEED_HOURS} ore`} small disabled={busy} onPress={onStartFeed} />
              </ButtonRow>
            </View>
          ) : null}
          {batteryNote}
        </Card>
      )}
      {!running ? jobCard : null}

      <Card>
        <SectionLabel>Trovati{shown.length ? ` · ${shown.length}` : ''}{showAll ? '' : ` · da ${INTEREST.SHOW_MIN} in su`}</SectionLabel>
        {!ranked.length ? <Body small muted>Ancora niente: qui compare quello che una ricerca trova da {INTEREST.SHOW_MIN} in su.</Body> : null}
        {ranked.length && !shown.length ? <Body small muted>Niente da {INTEREST.SHOW_MIN} in su, per ora: {weak === 1 ? 'l\'articolo letto sta' : `i ${weak} articoli letti stanno`} sotto, e non {weak === 1 ? 'vale' : 'valgono'} un'offerta.</Body> : null}
        {shown.length ? <Body small muted>Dal voto più alto. Da {INTEREST.TELL_MIN} ti avviso subito.</Body> : null}
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
                {f.score && f.score.reasons.length ? <Text numberOfLines={4} style={{ color: t.ink2, fontSize: 12 }}>{f.score.reasons.slice(0, 3).join(' · ')}</Text> : null}
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
                {onWait && f.score && f.score.total >= INTEREST.SHOW_MIN && f.score.total < INTEREST.TELL_MIN ? (
                  <Pressable onPress={() => onWait(f)} accessibilityRole="button" accessibilityLabel="Metti in attesa" hitSlop={6} style={({ pressed }) => [styles.rate, { borderColor: t.warn, opacity: pressed ? 0.7 : 1 }]}>
                    <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: t.warn }}>In attesa</Text>
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
        {ranked.length ? <Body small muted>Pollici e voti tuoi restano in memoria.</Body> : null}
      </Card>

      {waits.length ? (
        <Card>
          <SectionLabel>In attesa · {waits.length}</SectionLabel>
          <Body small muted>Li riguardo mentre una ricerca gira e quando Vinted notifica un ribasso (serve il tuo cuore). Ti avviso a {INTEREST.TELL_MIN}.</Body>
          {waits.map((w) => {
            const tone = w.score ? toneOf(t, SCORE_TONE[w.score.label] || 'neutral') : null
            const buy = w.score && w.score.target ? w.score.target.buy : null
            return (
              <View key={w.id} style={[styles.find, { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }]}>
                {w.score ? (
                  <View style={[styles.score, { backgroundColor: tone.bg }]}>
                    <Text style={{ color: tone.fg, fontWeight: '800', fontSize: 16 }}>{w.score.total}</Text>
                  </View>
                ) : null}
                <Pressable onPress={() => onOpen(w.url)} accessibilityRole="button" style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: t.ink, fontWeight: '600' }}>{w.title || 'Articolo'}</Text>
                  <Text numberOfLines={2} style={{ color: w.gone ? t.warn : t.ink2, fontSize: 12 }}>
                    {w.gone ? (w.gone === 'riservato' ? 'Riservato a un altro acquirente.' : 'Non è più in vendita.')
                      : Number.isFinite(buy) && w.price > buy ? `Da comprare a ${formatEuro(buy)}: ti avviso se ci arriva.` : Number.isFinite(buy) ? 'È già al tuo prezzo.' : 'Ti avviso se il prezzo scende.'}
                  </Text>
                </Pressable>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={{ color: t.ink, fontWeight: '700' }}>{formatEuro(w.price)}</Text>
                  {Number.isFinite(w.was) && w.was > w.price ? <Text style={{ color: t.ink3, fontSize: 12, textDecorationLine: 'line-through' }}>{formatEuro(w.was)}</Text> : null}
                  {onUnwait ? (
                    <Pressable onPress={() => onUnwait(w.id)} accessibilityRole="button" accessibilityLabel="Togli dall'attesa" hitSlop={6} style={({ pressed }) => [styles.rate, { borderColor: t.line, opacity: pressed ? 0.7 : 1 }]}>
                      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: t.ink2 }}>Togli</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            )
          })}
        </Card>
      ) : null}

      {onProfile ? <InterestsCard key={profile ? 'loaded' : 'empty'} profile={profile} onSave={onProfile} /> : null}

      <Collapsible title="Strumenti e spiegazioni" summary="come lavoro, prova di fattibilità">
        <View style={{ gap: space.sm }}>
          <Body small muted>Ogni lettura, una ogni 8–12 minuti, la fa partire la sveglia di sistema di Android: avviene anche con l'app dietro, lo schermo spento o l'app chiusa, e una notifica resta visibile finché la ricerca gira. Se Vinted chiede una verifica mi fermo e te lo dico.</Body>
          <Body small muted>L'AI compila la scheda di ogni articolo, per i promettenti leggo il mercato e l'annuncio, e il voto li mette in classifica. Tra {INTEREST.SHOW_MIN} e {INTEREST.TELL_MIN - 1} c'è scritta l'offerta che lo rende da comprare; con «Dai voto» scrivi il voto che gli daresti tu, e i prossimi della stessa categoria si spostano.</Body>
          <Body small muted>«Un articolo»: per uno veramente buono salgo del 10% sul prezzo massimo con due segnali e del 15% con tre (nuovo, proprio il prodotto cercato e la taglia, sotto il mercato, venditore solido).</Body>
          <Body small muted>Prova di fattibilità: misura in che modi la ricerca e la home si riescono a leggere su questo telefono. Meno di un minuto; il risultato lo condividi con chi sviluppa l'app.</Body>
          <ButtonRow>
            <Button label={busy ? 'Provo…' : 'Esegui la prova'} variant="secondary" small disabled={busy} onPress={onFeasibility} />
          </ButtonRow>
        </View>
      </Collapsible>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  find: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs, borderTopWidth: StyleSheet.hairlineWidth },
  score: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 30, height: 26, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  // As wide as the two thumbs above it.
  rate: { width: 64, height: 28, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  rating: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: space.md, marginBottom: space.sm, gap: space.sm },
})
