import { useEffect, useState } from 'react'
import { Share, View } from 'react-native'
import { VINTED } from '../../core/index.js'
import { ensureNotificationPermission, getNotificationStatus } from '../services/notifications.js'
import { STEP_LABEL, VIA_LABEL, calendarDiagnostics, eventNotesFor, openCalendarWithEvent } from '../services/calendar.js'
import { space } from '../theme.js'
import { Body, Button, Card, Note, SectionLabel, Title } from './ui.js'

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
        "Metti in calendario" apre la schermata "nuovo evento" del calendario del telefono (Samsung o Google) con titolo, orario e note già compilati; non serve nessun permesso. Se nessuna app calendario risponde, l'app prova da sola Google Calendar e poi un file .ics.
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

export function InfoView({ stats, items }) {
  const [status, setStatus] = useState('undetermined')
  useEffect(() => {
    getNotificationStatus().then(setStatus)
  }, [])

  const exportData = async () => {
    try {
      await Share.share({ title: 'Esiti offerte Vinted', message: JSON.stringify(items, null, 2) })
    } catch {
      // user dismissed the share sheet
    }
  }

  return (
    <View style={{ gap: space.lg }}>
      <Card>
        <SectionLabel>Promemoria</SectionLabel>
        <Title>{STATUS_LABEL[status] || STATUS_LABEL.undetermined}</Title>
        <Body muted small>La notifica arriva 10 minuti prima della finestra consigliata e, toccandola, apre la lista con l'articolo da comprare.</Body>
        {status !== 'granted' && <Button label="Attiva le notifiche" onPress={async () => { await ensureNotificationPermission(); setStatus(await getNotificationStatus()) }} />}
      </Card>

      <CalendarSection />

      <Card>
        <SectionLabel>I tuoi esiti</SectionLabel>
        <Title>Quanto sono affidabili le stime</Title>
        <Body>Offerte salvate: {stats.total} · da inviare: {stats.planned} · con esito: {stats.sent}</Body>
        <Body>Accettate: {stats.accepted} · controproposte: {stats.countered} · rifiutate: {stats.declined} · senza risposta: {stats.noReply}</Body>
        {stats.acceptanceRate !== null ? (
          <Note tone={stats.acceptanceRate >= (stats.predictedAverage || 0) ? 'good' : 'warn'}>
            Accettazione reale {Math.round(stats.acceptanceRate * 100)}% contro una stima media del {Math.round((stats.predictedAverage || 0) * 100)}%. Con qualche decina di esiti i pesi del modello si possono ritarare.
          </Note>
        ) : (
          <Body muted small>Segna l'esito di ogni offerta inviata: è l'unico modo per capire se il modello sovrastima o sottostima.</Body>
        )}
        <Button label="Esporta gli esiti (JSON)" variant="secondary" onPress={exportData} disabled={items.length === 0} />
      </Card>

      <Card>
        <SectionLabel>Lettura dal link</SectionLabel>
        <Title>Che cosa legge l'app da un annuncio</Title>
        <Body>• Dalla pagina pubblica dell'annuncio: titolo, prezzo, marca, condizioni, categoria, data di caricamento e ultima attività del venditore (es. "Ultima visita 26 min fa"), più la valutazione in stelle.</Body>
        <Body>• Da questi dati stima categoria e tipo di venditore e propone un target al −{20}%: controlla sempre i campi stimati prima di salvare.</Body>
        <Body>• Il numero di recensioni e i distintivi del venditore vengono letti quando la pagina li contiene; se mancano, il tipo di venditore resta "Non lo so" e puoi impostarlo a mano.</Body>
        <Body muted small>La lettura usa solo la pagina pubblica, senza login. Se Vinted blocca la richiesta, l'app te lo dice e puoi compilare i dati a mano.</Body>
      </Card>

      <Card>
        <SectionLabel>Come funziona</SectionLabel>
        <Title>Il motore in breve</Title>
        <Body>• Sconto sotto il 15% rischio basso, 15–30% medio, oltre il 30% alto. Oltre il {VINTED.MAX_DISCOUNT_PCT}% Vinted non accetta l'offerta.</Body>
        <Body>• Domenica sera 21–23 è la finestra migliore, poi la tarda serata infrasettimanale. Pausa pranzo e mattina lavorativa sono le peggiori. Fine mese aiuta, inizio mese penalizza.</Body>
        <Body>• Categoria, differenza in euro, anzianità dell'annuncio, tipo di venditore e testo dell'annuncio spostano la probabilità; il risultato tiene conto anche del rischio che l'articolo venga venduto mentre aspetti.</Body>
        <Body>• L'offerta vale circa {VINTED.OFFER_VALIDITY_HOURS} ore e puoi inviarne al massimo {VINTED.OFFERS_PER_DAY} al giorno.</Body>
        <Body muted small>Stime euristiche basate su psicologia della negoziazione e abitudini d'uso di Vinted, non su dati ufficiali. Tutti i dati restano sul telefono.</Body>
      </Card>
    </View>
  )
}
