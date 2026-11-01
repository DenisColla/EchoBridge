import { useEffect, useState } from 'react'
import { Alert, Share, View } from 'react-native'
import { VINTED, formatEuro } from '../../core/index.js'
import { ensureNotificationPermission, getNotificationStatus } from '../services/notifications.js'
import { STEP_LABEL, VIA_LABEL, calendarDiagnostics, eventNotesFor, openCalendarWithEvent } from '../services/calendar.js'
import { loadReadStats } from '../services/readStats.js'
import { space } from '../theme.js'
import { Body, Button, Card, Field, Note, Row, SectionLabel, Title } from './ui.js'
import { LearningCard } from './LearningCard.js'

/** How many items a pasted backup holds (the exported array, or { items, archive }). */
const countOf = (data) => (Array.isArray(data) ? data.length : data && typeof data === 'object' ? (Array.isArray(data.items) ? data.items.length : 0) + (Array.isArray(data.archive) ? data.archive.length : 0) : 0)

/**
 * «Ripristina da JSON»: paste the backup exported by this card on another device (or an offline-fitted dataset) and
 * merge it into the list; the newer copy of each offer wins. Confirmed before anything is written.
 */
function RestoreBlock({ onRestore, onToast }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  if (!onRestore) return null

  const restore = () => {
    let data
    try {
      data = JSON.parse(text)
    } catch {
      onToast('JSON non valido: incolla il contenuto del backup così com\'è.')
      return
    }
    const n = countOf(data)
    if (!n) {
      onToast('Il testo non contiene offerte: serve il backup JSON di questa app.')
      return
    }
    Alert.alert('Ripristinare il backup?', `${n} ${n === 1 ? 'offerta' : 'offerte'} nel testo. Quelle già presenti vengono aggiornate solo se la copia incollata è più recente; nessuna viene cancellata.`, [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Ripristina',
        onPress: async () => {
          setBusy(true)
          try {
            const r = await onRestore(data)
            onToast(`Ripristino fatto: ${r.added} ${r.added === 1 ? 'nuova' : 'nuove'}, ${r.updated} ${r.updated === 1 ? 'aggiornata' : 'aggiornate'}, ${r.skipped} già presenti${r.invalid ? `, ${r.invalid} non valide` : ''}. In lista: ${r.total}.`)
            setText('')
            setOpen(false)
          } catch {
            onToast('Ripristino non riuscito: il backup non è stato scritto.')
          } finally {
            setBusy(false)
          }
        },
      },
    ])
  }

  if (!open) return <Button label="Ripristina da JSON" variant="ghost" small onPress={() => setOpen(true)} />
  return (
    <View style={{ gap: space.sm }}>
      <Field label="Backup da ripristinare" hint="(incolla il JSON)" value={text} onChangeText={setText} placeholder='[{"id": …}]' multiline autoCapitalize="none" />
      <Row>
        <Button label={busy ? 'Ripristino…' : 'Ripristina'} variant="secondary" small onPress={restore} disabled={busy || !text.trim()} />
        <Button label="Annulla" variant="ghost" small onPress={() => { setOpen(false); setText('') }} />
      </Row>
    </View>
  )
}

/** Per-field read counters of the last link extractions (engine-spec §3.1): what Vinted's page really shows us. */
function ReadStats({ stats }) {
  if (!stats || !stats.total) return null
  const n = stats.total
  return (
    <View style={{ gap: 2 }}>
      <Body small style={{ fontWeight: '700' }}>Nelle ultime {n} {n === 1 ? 'lettura' : 'letture'}{stats.viaBrowser ? ` (${stats.viaBrowser} dal browser interno)` : ''}</Body>
      {stats.fields.map((f) => <Body key={f.id} muted small>• {f.label}: letto in {f.read} {n === 1 ? 'dell\'ultima lettura' : `delle ultime ${n} letture`}</Body>)}
    </View>
  )
}

const STATUS_LABEL = {
  granted: 'Notifiche attive',
  undetermined: 'Notifiche non ancora autorizzate',
  denied: 'Notifiche negate: abilitale dalle impostazioni di Android',
  unavailable: 'Notifiche non disponibili su questo dispositivo',
}

/** The calendar needs no permission: this card explains the behaviour and lets the user try it with a test event. */
function CalendarSection() {
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState(null)
  const last = calendarDiagnostics.last

  const tryNow = async () => {
    setBusy(true)
    try {
      const sendAt = new Date()
      sendAt.setDate(sendAt.getDate() + 1)
      sendAt.setHours(21, 30, 0, 0)
      const result = await openCalendarWithEvent({
        title: 'evento di prova (puoi annullare)',
        link: 'https://www.vinted.it/',
        sendAt,
        notes: eventNotesFor({ link: 'https://www.vinted.it/', targetPrice: '10', probability: 0.5, message: 'Ciao! Ti ho inviato un\'offerta.' }),
      })
      setOutcome(result.ok ? { tone: 'good', text: VIA_LABEL[result.via] || VIA_LABEL.intent } : { tone: 'bad', text: `Nessuna app calendario ha risposto: ${result.errors.join(' · ')}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <SectionLabel>Calendario</SectionLabel>
      <Title>Si apre l'app Calendario, tu tocchi Salva</Title>
      <Body muted small>
        «Calendario» apre la schermata "nuovo evento" del calendario del telefono (Samsung o Google) con titolo, orario e note già compilati; non serve nessun permesso. Se nessuna app calendario risponde, l'app prova da sola Google Calendar e poi un file .ics.
      </Body>
      {outcome && <Note tone={outcome.tone}>{outcome.text}</Note>}
      {last && (
        <Body muted small>
          Ultima operazione: {STEP_LABEL[last.step] || last.step}{last.error ? ` · errore: ${last.error}` : ''}{last.fallbackFrom ? ` · vie precedenti fallite: ${last.fallbackFrom.join('; ')}` : ''}.
        </Body>
      )}
      <Button label={busy ? 'Apro il calendario…' : 'Prova con un evento di test'} variant="secondary" onPress={tryNow} disabled={busy} />
    </Card>
  )
}

/** Info tab, outcomes first: how well the estimates match reality, then the engine's learning, reminders, calendar, tools and the explanations. */
export function InfoView({ stats, items, learning = null, onToast = () => {}, onOpenLab = null, onOpenSearch = null, onRestore = null }) {
  const [status, setStatus] = useState('undetermined')
  const [reads, setReads] = useState(null)
  useEffect(() => {
    getNotificationStatus().then(setStatus)
    loadReadStats().then(setReads).catch(() => setReads(null))
  }, [])

  const exportData = async () => {
    try {
      await Share.share({ title: 'Esiti offerte Vinted', message: JSON.stringify(items, null, 2) })
    } catch {
      // user dismissed the share sheet
    }
  }

  const discount = learning ? learning.discountPct : 20

  return (
    <View style={{ gap: space.lg }}>
      <Card>
        <SectionLabel>I tuoi esiti</SectionLabel>
        <Title>Quanto ci azzecca</Title>
        <Body>Offerte salvate: {stats.total} · da inviare: {stats.planned} · con esito: {stats.sent}</Body>
        <Body>Accettate: {stats.accepted} · controproposte: {stats.countered} · rifiutate: {stats.declined} · senza risposta: {stats.noReply}{stats.soldOther ? ` · vendute ad altri: ${stats.soldOther}` : ''}</Body>
        {stats.archived ? <Body muted small>Più {stats.archived} {stats.archived === 1 ? 'trattativa eliminata dalla lista' : 'trattative eliminate dalla lista'}: restano nel report mensile.</Body> : null}
        {stats.averageSaving != null ? <Body>Risparmio medio sul listino: {formatEuro(stats.averageSaving)} su {stats.closedDeals} {stats.closedDeals === 1 ? 'acquisto' : 'acquisti'}</Body> : null}
        {stats.countersWon != null ? <Body>Controproposte chiuse sotto la cifra del venditore: {Math.round(stats.countersWon * 100)}% ({stats.countersClosed} {stats.countersClosed === 1 ? 'trattativa' : 'trattative'})</Body> : null}
        {stats.acceptanceRate !== null ? (
          <Note tone={stats.acceptanceRate >= (stats.predictedAverage || 0) ? 'good' : 'warn'}>
            Accettazione reale {Math.round(stats.acceptanceRate * 100)}% contro una stima media del {Math.round((stats.predictedAverage || 0) * 100)}%. Il report mensile ritara il motore su questi esiti, a piccoli passi.
          </Note>
        ) : (
          <Body muted small>Segna l'esito di ogni offerta inviata: è l'unico modo per capire se il modello sovrastima o sottostima.</Body>
        )}
        <Body muted small>La Lista conta lo stato attuale, qui il primo esito.</Body>
        <Row>
          <Button label="Backup dei dati (JSON)" variant="ghost" small onPress={exportData} disabled={items.length === 0} />
          <RestoreBlock onRestore={onRestore} onToast={onToast} />
        </Row>
      </Card>

      <LearningCard learning={learning} onToast={onToast} />

      <Card>
        <SectionLabel>Promemoria</SectionLabel>
        <Title>{STATUS_LABEL[status] || STATUS_LABEL.undetermined}</Title>
        <Body muted small>Con «Salva e ricordamelo» l'articolo va in Lista con link e messaggio pronti; la notifica arriva 10 minuti prima della finestra consigliata e, toccandola, apre la Lista.</Body>
        {status !== 'granted' && <Button label="Attiva le notifiche" onPress={async () => { await ensureNotificationPermission(); setStatus(await getNotificationStatus()) }} />}
      </Card>

      <CalendarSection />

      {onOpenSearch ? (
        <Card>
          <SectionLabel>Cerca altrove</SectionLabel>
          <Title>Lo stesso articolo su Vinted, Subito e Wallapop</Title>
          <Body muted small>Parti da un annuncio letto in Calcola: apri le tre ricerche, l'app legge le pagine che vedi, confronta le foto con il modello di visione scelto nel Laboratorio e ordina gli annunci per il prezzo finale atteso. Titoli, descrizioni e foto degli annunci vanno ai fornitori scelti, con telefoni, e-mail e profili social sostituiti da «[contatto]»; nomi dei venditori no.</Body>
          <Button label="Apri «Cerca altrove»" onPress={onOpenSearch} />
        </Card>
      ) : null}

      {onOpenLab ? (
        <Card>
          <SectionLabel>Laboratorio AI</SectionLabel>
          <Title>Scegli il modello AI con un test reale</Title>
          <Body muted small>Confronta i modelli disponibili su annunci veri: riconoscere lo stesso prodotto dalle foto e spiegare come trattare. Ti servono le chiavi dei fornitori; testi e foto degli annunci vanno a loro.</Body>
          <Button label="Apri il laboratorio" onPress={onOpenLab} />
        </Card>
      ) : null}

      <Card>
        <SectionLabel>Lettura dal link</SectionLabel>
        <Title>Che cosa legge l'app da un annuncio</Title>
        <Body>• Dalla pagina pubblica dell'annuncio: titolo, prezzo, marca, condizioni, categoria, data di caricamento e ultima attività del venditore (es. "Ultima visita 26 min fa"), più la valutazione in stelle.</Body>
        <Body>• Da questi dati stima categoria e tipo di venditore e propone un'offerta al −{discount}%{discount !== 20 ? ' (appreso dai tuoi esiti)' : ''}: controlla sempre i campi stimati prima di salvare.</Body>
        <Body>• Il numero di recensioni e i distintivi del venditore vengono letti quando la pagina li contiene; se mancano, il tipo di venditore resta "Non lo so" e puoi impostarlo a mano.</Body>
        <Body>• Dalla pagina aperta nel browser interno legge anche visualizzazioni, interessati, un prezzo precedente barrato, lo sconto sui lotti e gli altri articoli del venditore: entrano nel calcolo come stime, finché i tuoi esiti non dicono quanto pesano.</Body>
        <ReadStats stats={reads} />
        <Body muted small>La lettura usa solo la pagina pubblica, senza login. Se Vinted blocca la richiesta, l'app te lo dice e puoi compilare i dati a mano.</Body>
      </Card>

      <Card>
        <SectionLabel>Come funziona</SectionLabel>
        <Title>Il motore in breve</Title>
        <Body>• Sconto sotto il 15% rischio basso, 15–30% medio, oltre il 30% alto. Oltre il {VINTED.MAX_DISCOUNT_PCT}% Vinted non accetta l'offerta.</Body>
        <Body>• Domenica sera 21–23 è la finestra migliore, poi la tarda serata infrasettimanale. Pausa pranzo e mattina lavorativa sono le peggiori. Fine mese aiuta, inizio mese penalizza.</Body>
        <Body>• Categoria, differenza in euro, anzianità dell'annuncio, tipo di venditore e testo dell'annuncio spostano la probabilità; il risultato tiene conto anche del rischio che l'articolo venga venduto mentre aspetti.</Body>
        <Body>• Conta su circa {VINTED.OFFER_VALIDITY_HOURS} ore per la risposta (Vinted non indica una scadenza ufficiale) e puoi inviare al massimo {VINTED.OFFERS_PER_DAY} offerte al giorno.</Body>
        <Body>• L'offerta si invia dal pulsante di Vinted; il messaggio la accompagna in chat.</Body>
        <Body>• Prezzo atteso = probabilità × offerta + (1 − probabilità) × prezzo pieno: vale per la prima offerta e dice quanto paghi in media.</Body>
        <Body>• Senza un confronto con altri annunci l'offerta parte da regole generali; con «Cerca altrove» il motore ancora il prezzo al mercato reale dell'articolo.</Body>
        <Body>• «Voglio più probabilità» cerca il modo più economico per salire: aspettare un momento migliore, alzare di poco l'offerta o entrambe le cose.</Body>
        <Body>• Prova del motore: circa 1 offerta su 5 esce con un piccolo scarto di orario o di sconto, per capire se rende di più. Inviala così, oppure usa il piano migliore.</Body>
        <Body>• Controproposta ricevuta? Inserisci la sua cifra: l'app calcola la risposta, quanto salire e quando inviarla.</Body>
        <Body muted small>Stime euristiche basate su psicologia della negoziazione e abitudini d'uso di Vinted, non su dati ufficiali. Tutti i dati restano sul telefono, tranne nel Laboratorio AI (facoltativo): lì testi e foto degli annunci vanno ai fornitori che scegli.</Body>
      </Card>
    </View>
  )
}
