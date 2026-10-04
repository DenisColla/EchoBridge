import { useEffect, useState } from 'react'
import { Share, View } from 'react-native'
import { VINTED } from '../../core/index.js'
import { ensureNotificationPermission, getNotificationStatus } from '../services/notifications.js'
import { space } from '../theme.js'
import { Body, Button, Card, Note, SectionLabel, Title } from './ui.js'

const STATUS_LABEL = {
  granted: 'Notifiche attive',
  undetermined: 'Notifiche non ancora autorizzate',
  denied: 'Notifiche negate: abilitale dalle impostazioni di Android',
  unavailable: 'Notifiche non disponibili su questo dispositivo',
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
