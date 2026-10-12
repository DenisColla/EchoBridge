import { useEffect, useState } from 'react'
import { Alert, Image, Linking, StyleSheet, Text, View } from 'react-native'
import { CHANNELS, CHANNEL_IDS, ITALIAN_CITIES, channelOfUrl, formatEuro, savingVersus } from '../../../core/index.js'
import { radius, space, useTheme } from '../../theme.js'
import { Badge, Body, Button, ButtonRow, Card, Chip, Collapsible, Field, Meter, Note, SectionLabel, Title } from '../ui.js'
import { ChannelSweep } from './ChannelSweep.js'

/*
 * «Cerca altrove»: from the listing read in Calcola to the same product on Vinted, Subito and Wallapop, ranked by what
 * it should really cost after a negotiation. The app never sends offers or buys: each row opens the listing on its site.
 */

const VERDICT = {
  same: { label: 'Stesso articolo', tone: 'good' },
  variant: { label: 'Variante', tone: 'warn' },
  alternative: { label: 'Alternativa', tone: 'accent' },
}

const pct = (p) => `${Math.round(p * 100)}%`
const usd = (n) => `${n < 0.01 ? n.toFixed(4) : n.toFixed(2)} $`
const est = (flag) => (flag ? ' (stima)' : '')

function Thumb({ uri }) {
  const t = useTheme()
  return uri
    ? <Image source={{ uri }} style={styles.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
    : <View style={[styles.thumb, { backgroundColor: t.cardMuted }]} />
}

/** Opens a listing on its own site, only for the three channels' https pages. */
const openListing = (url) => {
  if (!/^https:\/\//i.test(url || '') || !channelOfUrl(url)) return
  Linking.openURL(url).catch(() => Alert.alert('Non riesco ad aprire l\'annuncio', url))
}

function Explanation({ value }) {
  return (
    <View style={{ gap: space.xs }}>
      <Body small>{value.why}</Body>
      {(value.leverage || []).length ? <Body small style={{ fontWeight: '700' }}>Leve di trattativa</Body> : null}
      {(value.leverage || []).map((l, i) => <Body key={`l${i}`} small>• {l}</Body>)}
      {value.sellerProfile ? <Body small muted>{value.sellerProfile}</Body> : null}
      {(value.risks || []).map((r, i) => <Body key={`r${i}`} small muted>⚠ {r}</Body>)}
    </View>
  )
}

function ResultRow({ row, outlook, explanation, onExplain, canExplain, stale }) {
  const t = useTheme()
  const c = row.candidate
  const v = VERDICT[row.group === 'alternative' ? 'alternative' : row.verdict] || VERDICT.same
  const saving = savingVersus(row, outlook)
  const negotiated = Number.isFinite(row.offer) && row.offer < c.price && Number.isFinite(row.probability)
  return (
    <Card>
      <View style={styles.rowHead}>
        <Thumb uri={c.thumb || c.photo} />
        <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
          <View style={styles.badges}>
            <Badge tone="neutral">{CHANNELS[c.source] ? CHANNELS[c.source].label : c.source}</Badge>
            <Badge tone={v.tone}>{v.label} · {pct(row.confidence)}</Badge>
          </View>
          <Body numberOfLines={2} style={{ fontWeight: '600' }}>{c.title}</Body>
          {c.location ? <Body small muted numberOfLines={1}>{c.location}</Body> : null}
        </View>
      </View>
      <View style={{ gap: 2 }}>
        <Text style={[styles.total, { color: t.ink }]}>{formatEuro(row.expectedTotal)} <Text style={[styles.totalNote, { color: t.ink3 }]}>totale atteso</Text></Text>
        <Body small muted>
          Prezzo {formatEuro(c.price)} + commissione {Number.isFinite(c.buyerFee) ? formatEuro(c.buyerFee) : 'n.d.'}{est(c.feeEstimated)} + spedizione {Number.isFinite(c.shippingCost) ? formatEuro(c.shippingCost) : 'n.d.'}{est(c.shippingEstimated)} = {formatEuro(row.totalNow)} subito
        </Body>
        {negotiated ? (
          <Body small>Offri {formatEuro(row.offer)}: accettata nel {pct(row.probability)} dei casi stimati{row.sendLabel && !stale ? `, meglio ${row.sendLabel}` : ''}.</Body>
        ) : row.negotiationNote ? <Body small muted>{row.negotiationNote}</Body> : null}
        {saving ? (
          <Body small style={{ color: saving.expected > 0 ? t.good : t.ink3, fontWeight: '600' }}>
            {saving.expected > 0 ? `Circa ${formatEuro(saving.expected)} in meno dell'annuncio di partenza` : saving.expected < 0 ? `Circa ${formatEuro(-saving.expected)} in più dell'annuncio di partenza` : 'Stesso costo dell\'annuncio di partenza'}
          </Body>
        ) : null}
      </View>
      {row.reason ? <Body small muted>{row.reason}</Body> : null}
      {row.differences.length ? <Body small muted>Differenze: {row.differences.join('; ')}</Body> : null}
      {row.risks.length ? (
        <View style={styles.badges}>{row.risks.map((r, i) => <Badge key={`${i}-${r}`} tone="warn">{r}</Badge>)}</View>
      ) : null}
      {explanation && explanation.value ? <Explanation value={explanation.value} /> : null}
      {explanation && explanation.error ? <Note tone="warn">{explanation.error}</Note> : null}
      <ButtonRow>
        <Button label="Apri annuncio" small variant="secondary" onPress={() => openListing(c.url)} disabled={!c.url} />
        {!explanation || explanation.error ? (
          <Button label={explanation && explanation.error ? 'Riprova' : 'Perché conviene'} small variant="ghost" onPress={onExplain} disabled={!canExplain} />
        ) : explanation.loading ? <Button label="Scrivo…" small variant="ghost" disabled onPress={() => {}} /> : null}
      </ButtonRow>
    </Card>
  )
}

/**
 * Props: `search` (useSearch), `reference` (last listing read in Calcola, or null), `onClose`, `onOpenLab` (keys).
 */
export function SearchView({ search, reference, onClose, onOpenLab }) {
  const t = useTheme()
  const [sweepOpen, setSweepOpen] = useState(false)
  const [showCities, setShowCities] = useState(false)
  const run = search.run
  const { checkKeys } = search

  useEffect(() => { checkKeys() }, [checkKeys])

  const keys = search.keys
  const last = search.store && search.store.last
  const sameReference = run && !run.reopened && reference && run.reference && run.reference.url === reference.url

  if (!run) {
    return (
      <View style={{ gap: space.lg }}>
        <Card>
          <SectionLabel>Cerca altrove</SectionLabel>
          <Title>Lo stesso articolo, al prezzo finale più basso</Title>
          <Body muted>Cerco l'articolo su Vinted, Subito e Wallapop: apri le tre ricerche, l'app legge gli annunci che vedi, li confronta con le foto e li ordina per quanto dovresti pagare davvero dopo la trattativa.</Body>
          {reference ? (
            <Button label={`Cerca «${String(reference.title || 'questo annuncio').slice(0, 40)}»`} onPress={() => search.start(reference)} />
          ) : (
            <Note>Leggi prima un annuncio Vinted dalla scheda Calcola (link o «Incolla»): è il punto di partenza della ricerca.</Note>
          )}
          {last ? <Button label="Riapri l'ultima ricerca" variant="secondary" onPress={search.reopenLast} /> : null}
          <Button label="Chiudi" variant="ghost" onPress={onClose} />
        </Card>
      </View>
    )
  }

  const ref = run.reference
  const product = run.product
  const job = run.job
  const running = Boolean(job && job.running)
  const reads = CHANNEL_IDS.map((id) => ({ id, ...run.channels[id] }))
  const totalRead = reads.reduce((n, r) => n + r.items.length, 0)
  const ranking = run.ranking
  const outlook = run.outlook || null
  const explanations = run.explanations || {}
  const keyOf = (row) => `${row.candidate.source}:${row.candidate.id}`

  const analyze = () => {
    if (keys && !keys.verify) {
      Alert.alert('Serve una chiave', 'Per confrontare gli annunci con le foto serve la chiave di Qwen (o di Anthropic come riserva). La aggiungi nel Laboratorio AI.')
      return
    }
    search.analyze()
  }
  const closeAll = () => {
    if (running) {
      Alert.alert('Interrompere l\'analisi?', 'Gli annunci già verificati restano nella spesa ma non nei risultati.', [
        { text: 'Continua', style: 'cancel' },
        { text: 'Interrompi ed esci', style: 'destructive', onPress: () => { search.close(); onClose() } },
      ])
      return
    }
    onClose()
  }
  /** The saved search replaces the current one: ask first when the current one holds work not analysed yet. */
  const reopen = () => {
    if (!run.finishedAt && (totalRead || run.cardLoading)) {
      Alert.alert('Riaprire l\'ultima ricerca?', 'La ricerca attuale non è stata analizzata: gli annunci letti andranno persi.', [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Riapri', onPress: search.reopenLast },
      ])
      return
    }
    search.reopenLast()
  }
  const restart = () => {
    if (!reference) return
    Alert.alert('Nuova ricerca?', 'La ricerca attuale viene chiusa. Puoi riaprire l\'ultima ricerca analizzata finché non ne analizzi un\'altra.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Nuova ricerca', onPress: () => search.start(reference) },
    ])
  }

  return (
    <View style={{ gap: space.lg }}>
      <View style={styles.topBar}>
        <Title style={{ flex: 1 }}>Cerca altrove</Title>
        <Button label="Chiudi" small variant="ghost" onPress={closeAll} />
      </View>

      <Card>
        <SectionLabel>Annuncio di partenza</SectionLabel>
        <View style={styles.rowHead}>
          <Thumb uri={ref.thumb || ref.photo} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Body numberOfLines={2} style={{ fontWeight: '600' }}>{ref.title || 'Annuncio Vinted'}</Body>
            <Body small muted>{Number.isFinite(ref.price) ? formatEuro(ref.price) : 'prezzo n.d.'}{outlook ? ` · ${formatEuro(outlook.totalNow)} subito, circa ${formatEuro(outlook.expectedTotal)} trattando` : ''}</Body>
          </View>
        </View>
        {!ref.photo ? <Body small muted>Senza foto: il confronto userà solo i testi e sarà meno sicuro.</Body> : null}
        {reference && !sameReference && !running ? <Button label="Nuova ricerca dall'annuncio in Calcola" small variant="secondary" onPress={restart} /> : null}
        {last && !running && last.at !== run.finishedAt ? <Button label="Riapri l'ultima ricerca analizzata" small variant="ghost" onPress={reopen} /> : null}
      </Card>

      {keys && !keys.verify ? (
        <Card muted>
          <Note tone="warn">Per confrontare gli annunci con le foto serve la chiave di Qwen (Alibaba Cloud) o, in riserva, di Anthropic.</Note>
          {onOpenLab ? <Button label="Aggiungi le chiavi nel Laboratorio AI" small variant="secondary" onPress={onOpenLab} /> : null}
        </Card>
      ) : null}
      {keys && keys.verify && !keys.text ? <Note>Senza chiave OpenAI o Anthropic la scheda prodotto usa le parole del titolo e «Perché conviene» non è disponibile.</Note> : null}

      {!run.reopened ? (
        <Card>
          <SectionLabel>Cosa cerco</SectionLabel>
          {run.cardLoading ? <Body muted>Preparo la scheda del prodotto…</Body> : (
            <View style={{ gap: space.xs }}>
              <Body style={{ fontWeight: '600' }}>{product.name}</Body>
              {product.attributes.length ? <Body small muted>{product.attributes.join(' · ')}</Body> : null}
              {product.family.length ? <Body small muted>Stessa famiglia: {product.family.join(', ')}</Body> : null}
              {run.cardError ? <Body small muted>Scheda dal titolo (AI non disponibile: {run.cardError}).</Body> : null}
            </View>
          )}
          {CHANNEL_IDS.map((id) => (
            <Field
              key={id}
              label={`Parole su ${CHANNELS[id].label}`}
              value={run.queries[id] || ''}
              onChangeText={(q) => search.setQuery(id, q)}
              autoCapitalize="none"
            />
          ))}
          {Number.isFinite(run.window.minPrice) ? <Body small muted>Prezzi tra {formatEuro(run.window.minPrice)} e {formatEuro(run.window.maxPrice)}, solo annunci con spedizione.</Body> : null}
          <View style={{ gap: space.xs }}>
            <Body small>Wallapop cerca intorno a: <Text style={{ fontWeight: '700' }}>{search.city.label}</Text> <Text style={{ color: t.accentInk, fontWeight: '700' }} onPress={() => setShowCities((v) => !v)}>{showCities ? 'chiudi' : 'cambia'}</Text></Body>
            {showCities ? (
              <View style={styles.badges}>
                {ITALIAN_CITIES.map((c) => <Chip key={c.label} compact label={c.label} active={c.label === search.city.label} onPress={() => { search.setCity(c.label); setShowCities(false) }} />)}
              </View>
            ) : null}
          </View>
          <Body small muted>Letti: {reads.map((r) => `${CHANNELS[r.id].label} ${r.read ? r.items.length : '—'}`).join(' · ')}</Body>
          <ButtonRow>
            <Button label={totalRead ? 'Riapri le ricerche' : 'Apri le ricerche'} variant={totalRead ? 'secondary' : 'primary'} onPress={() => setSweepOpen(true)} disabled={running} />
            {totalRead ? <Button label={`Analizza ${totalRead}`} onPress={analyze} disabled={running} /> : null}
          </ButtonRow>
          <Body small muted>Le pagine si aprono in un browser dentro l'app, senza accesso al tuo account. Leggere i siti con un'app non è previsto dalle loro condizioni d'uso: lo fai tu, su tua richiesta, una pagina alla volta.</Body>
        </Card>
      ) : (
        <Note>Ricerca salvata del {new Date(run.finishedAt).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}: prezzi e disponibilità possono essere cambiati.</Note>
      )}

      {running ? (
        <Card>
          <SectionLabel>Verifica con le foto</SectionLabel>
          <Body>{job.done} di {job.total}{job.failed ? ` · ${job.failed} non riusciti` : ''}</Body>
          <Meter value={job.total ? job.done / job.total : 0} />
          <Body small muted>Spesa finora: {usd(run.cost || 0)}</Body>
          <Button label="Interrompi" variant="secondary" small onPress={search.cancel} />
        </Card>
      ) : null}

      {ranking ? (
        <View style={{ gap: space.md }}>
          {run.summary ? (
            <Body small muted>
              Letti {run.summary.read} · verificati {run.summary.verified} di {run.summary.kept}{run.summary.reused ? ` (${run.summary.reused} già verificati prima)` : ''}{run.summary.failed ? ` · ${run.summary.failed} non riusciti` : ''}{run.summary.different ? ` · ${run.summary.different} erano altri prodotti` : ''}{run.summary.cancelled ? ' · interrotta' : ''}{!run.reopened && run.cost ? ` · spesa ${usd(run.cost)}` : ''}
            </Body>
          ) : null}
          {run.dropped && Object.keys(run.dropped).length ? (
            <Body small muted>Scartati prima della verifica: {Object.entries(run.dropped).map(([why, n]) => `${n} ${why}`).join(', ')}.</Body>
          ) : null}

          <SectionLabel>Stesso articolo, dal più conveniente</SectionLabel>
          {ranking.main.length ? ranking.main.map((row) => (
            <ResultRow key={keyOf(row)} row={row} outlook={outlook} explanation={explanations[keyOf(row)]} onExplain={() => search.explain(row)} canExplain={Boolean(keys && keys.text) && !run.reopened} stale={Boolean(run.reopened)} />
          )) : <Note>Nessun annuncio dello stesso articolo tra quelli letti. Prova altre parole o scorri di più le ricerche.</Note>}

          {ranking.alternatives.length ? (
            <>
              <SectionLabel>Alternative della stessa famiglia</SectionLabel>
              {ranking.alternatives.map((row) => (
                <ResultRow key={keyOf(row)} row={row} outlook={outlook} explanation={explanations[keyOf(row)]} onExplain={() => search.explain(row)} canExplain={Boolean(keys && keys.text) && !run.reopened} stale={Boolean(run.reopened)} />
              ))}
            </>
          ) : null}

          {run.failures && run.failures.length ? (
            <Collapsible title={`Non verificati (${run.failures.length})`} summary="Annunci che l'AI non è riuscita a confrontare.">
              {run.failures.slice(0, 30).map((f) => (
                <Body key={`${f.candidate.source}:${f.candidate.id}`} small muted numberOfLines={2}>{CHANNELS[f.candidate.source] ? CHANNELS[f.candidate.source].label : f.candidate.source} · {f.candidate.title}: {f.error}</Body>
              ))}
            </Collapsible>
          ) : null}
          <Body small muted>Totale atteso = prezzo dopo una trattativa realistica + commissione + spedizione. Su Subito e Wallapop la trattativa è stimata con il modello di Vinted. Le offerte le fai tu sul sito: l'app non invia niente.</Body>
        </View>
      ) : null}

      {sweepOpen ? (
        <ChannelSweep
          search={search}
          onClose={() => setSweepOpen(false)}
          onDone={() => { setSweepOpen(false); analyze() }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowHead: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  thumb: { width: 72, height: 72, borderRadius: radius.md },
  total: { fontSize: 20, fontWeight: '800' },
  totalNote: { fontSize: 13, fontWeight: '500' },
})
