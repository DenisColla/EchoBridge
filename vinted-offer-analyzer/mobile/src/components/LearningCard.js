import { useState } from 'react'
import { View } from 'react-native'
import { LEARNING, MONTHS_IT, formatEuro, monthLabel, profileIsActive } from '../../core/index.js'
import { openReport, shareReport } from '../services/reports.js'
import { space } from '../theme.js'
import { Body, Button, ButtonRow, Card, Note, SectionLabel, Title, Toggle } from './ui.js'

/** Probability points of a logit change on an offer at 50% (the engine's squash: 0,94 × ¼ per logit unit). */
const POINTS_PER_LOGIT = 23.5
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)

/** One applied change in words the user can check: points of probability, percent, or a factor. */
export function describeChange(c) {
  const dec = (v) => String(v).replace('.', ',')
  if (c.key === 'discountPct') return `${c.label}: ${dec(c.from)}% → ${dec(c.to)}%`
  if (c.key === 'slope' || c.key === 'counterShare') return `${c.label}: ×${dec(c.from)} → ×${dec(c.to)}`
  if (c.key === 'sellerReplyHours') return `${c.label}: ${dec(c.from)} → ${dec(c.to)} ore`
  const pts = (v) => signed(Math.round(v * POINTS_PER_LOGIT))
  return `${c.label}: ${pts(c.from)} → ${pts(c.to)} punti`
}

const SAVED_TO = {
  folder: (folder) => `Salvato nella cartella ${folder ? folder.label : 'scelta'} e nell'app.`,
  app: () => 'Salvato nell\'app: scegli una cartella per averlo anche nei tuoi file.',
  download: () => 'Scaricato dal browser.',
  none: () => 'Il file non è stato salvato.',
}

/**
 * The monthly learning loop in the Info tab: where the Excel goes, what the last report said and changed, the test
 * variations switch, «Annulla» and a manual export of the month in progress.
 */
export function LearningCard({ learning, onToast }) {
  const [busy, setBusy] = useState(false)
  if (!learning || !learning.ready) return null
  const { profile, folder, reports, exploration, canUndo, nextReportAt } = learning
  const last = reports[0] || null
  const active = profileIsActive(profile) && profile.month
  const next = nextReportAt ? `${nextReportAt.getDate()} ${MONTHS_IT[nextReportAt.getMonth()]}` : ''

  const run = async (fn) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const pickFolder = () => run(async () => {
    const res = await learning.chooseFolder()
    if (res.ok) onToast(`Cartella scelta: ${res.label}. Ogni mese l'Excel finisce lì da solo.`)
    else if (res.reason === 'unsupported') onToast('La cartella si sceglie dall\'app Android.')
    else if (res.reason !== 'cancelled') onToast('Non riesco ad accedere a quella cartella: scegline un\'altra (non la radice di Download).')
  })

  const exportNow = () => run(async () => {
    const file = await learning.exportNow()
    if (!file) return
    if (file.savedTo === 'folder') onToast(`Excel di ${file.label} (fino a oggi) salvato in ${folder ? folder.label : 'cartella'}.`)
    else if (file.savedTo === 'app') {
      onToast('Excel pronto: scegli dove mandarlo.')
      await shareReport(file.localUri, `Offerte ${file.label}`)
    } else if (file.savedTo === 'download') onToast('Excel scaricato.')
    else onToast(file.error || 'Non sono riuscito a creare il file.')
  })

  return (
    <Card>
      <SectionLabel>Apprendimento mensile</SectionLabel>
      <Title>{active ? `Motore ritarato sui tuoi esiti (${monthLabel(profile.month)})` : 'Il motore impara dai tuoi esiti'}</Title>
      <Body muted small>
        Il primo del mese, alla prima apertura dell'app, creo l'Excel del mese chiuso (affari conclusi e persi, controproposte, salite, tempi di risposta, fasce orarie e sconti) e correggo il motore: piccoli passi, solo quando i dati bastano. Prossimo report: {next}.
      </Body>

      {folder ? (
        <Body small>Cartella del report: <Body small style={{ fontWeight: '700' }}>{folder.label}</Body></Body>
      ) : (
        <Note tone="warn">Scegli una volta la cartella dove salvare l'Excel ogni mese, per esempio Documents/Offerte Vinted (Android non permette la radice di Download).</Note>
      )}
      <Button label={folder ? 'Cambia cartella' : 'Scegli la cartella'} variant={folder ? 'secondary' : 'primary'} small onPress={pickFolder} disabled={busy} />

      {last && (
        <View style={{ gap: space.sm }}>
          <Body style={{ fontWeight: '700' }}>Ultimo report: {last.label}</Body>
          <Body small>{last.headline}</Body>
          <Body muted small>
            Accettazione reale {pct(last.summary.firstAcceptRate)} contro una stima del {pct(last.summary.predictedFirstAccept)}
            {last.summary.sellerCounters ? ` · ${last.summary.sellerCounters} controproposte, salita media ${last.summary.avgSellerRaisePct == null ? '—' : `${Math.round(last.summary.avgSellerRaisePct)}%`}` : ''}
            {last.summary.totalSavedEur ? ` · risparmiati ${formatEuro(last.summary.totalSavedEur)}` : ''}
          </Body>
          <Body muted small>{(SAVED_TO[last.savedTo] || SAVED_TO.none)(folder)}</Body>
          {last.error ? <Note tone="warn">{last.error}</Note> : null}
          {last.rollback ? <Note tone="warn">Le correzioni del mese prima prevedevano peggio di quelle precedenti: sono tornato ai valori di prima.</Note> : null}
          {last.changes.length > 0 ? (
            <View style={{ gap: 2 }}>
              <Body small style={{ fontWeight: '700' }}>{last.reverted ? 'Correzioni annullate:' : 'Correzioni applicate:'}</Body>
              {last.changes.map((c) => <Body key={c.key} small>• {describeChange(c)}</Body>)}
            </View>
          ) : (
            <Body muted small>Nessuna correzione: i dati del mese non bastano o confermano il motore.</Body>
          )}
          {last.notes && last.notes.length ? last.notes.map((n) => <Body key={n} muted small>{n}</Body>) : null}
          <ButtonRow>
            {last.localUri ? <Button label="Apri l'Excel" small onPress={() => openReport(last.localUri, `Offerte ${last.label}`)} /> : null}
            {last.localUri ? <Button label="Condividi" variant="secondary" small onPress={() => shareReport(last.localUri, `Offerte ${last.label}`)} /> : null}
          </ButtonRow>
          {canUndo && last.changes.length > 0 && !last.reverted ? (
            <Button label="Annulla le correzioni di questo mese" variant="ghostDanger" small onPress={() => run(async () => { if (await learning.undoLast()) onToast('Correzioni annullate: torno al motore del mese prima.') })} />
          ) : null}
        </View>
      )}

      <Toggle label={`Varianti di test: circa 1 offerta su ${Math.round(1 / LEARNING.EXPLORE_SHARE)} esce ±1 ora o ±2 punti di sconto, sempre segnalata`} value={exploration} onChange={(v) => learning.setExploration(v)} />
      <Body muted small>Le varianti costano al massimo {Math.round(LEARNING.EXPLORE_MAX_COST * 100)} punti di probabilità e servono a capire se orari e sconti vicini rendono di più. Puoi sempre scegliere «Usa il piano migliore».</Body>
      <Button label={busy || learning.busy ? 'Preparo l\'Excel…' : 'Esporta adesso il mese in corso'} variant="secondary" small onPress={exportNow} disabled={busy || learning.busy} />
      <Body muted small>Per imparare servono gli esiti: segna «Inviata» quando mandi l'offerta e poi com'è andata, anche «Venduto ad altri» o «Lasciato perdere».</Body>
    </Card>
  )
}
