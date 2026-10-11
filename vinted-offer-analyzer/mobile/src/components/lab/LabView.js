import { useEffect, useMemo, useState } from 'react'
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { LLM_MODELS, LLM_PROVIDERS, PAIR_LABELS, blindOrder, estimateCallCost, formatEuro, vintedSearchQuery } from '../../../core/index.js'
import { radius, space, useTheme } from '../../theme.js'
import { Body, Button, ButtonRow, Card, Meter, Note, SectionLabel, Title, Toggle } from '../ui.js'
import { CollectSheet } from './CollectSheet.js'

const TARGET_PAIRS = 100
const PAIR_PAGE = 30
/** Italian decimals: "0,59 cent", "1,20 $". */
const usd = (v) => (v == null ? '—' : (v < 0.01 ? `${(v * 100).toFixed(2)} cent` : `${v.toFixed(2)} $`).replace('.', ','))
const ratio = (n, d) => (d ? ` (${n}/${d})` : '')
const secs = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`)
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`)

/** Destructive confirmation; react-native-web has no Alert dialogs, so the web preview uses the browser's. */
const confirmAction = (title, message, action, onConfirm) => {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n${message}`)) onConfirm()
    return
  }
  Alert.alert(title, message, [{ text: 'Annulla', style: 'cancel' }, { text: action, style: 'destructive', onPress: onConfirm }])
}

function KeyRow({ provider, masked, onSave, onTest }) {
  const t = useTheme()
  const info = LLM_PROVIDERS[provider]
  const model = LLM_MODELS.find((m) => m.provider === provider)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const ok = await onSave(provider, value)
    setBusy(false)
    if (!ok) {
      setStatus({ tone: 'warn', text: 'Chiave non salvata: riprova.' })
      return
    }
    setValue('')
    setEditing(false)
    setStatus(null)
  }
  const remove = () => confirmAction('Eliminare la chiave?', 'Per usarla di nuovo dovrai crearne una sul sito del fornitore.', 'Elimina', async () => {
    await onSave(provider, '')
    setStatus(null)
  })
  const test = async () => {
    setBusy(true)
    setStatus(null)
    const res = await onTest(model.key)
    setStatus(res.ok ? { tone: 'good', text: `Funziona (${secs(res.latencyMs)}, ${usd(res.costUsd)}).` } : { tone: 'warn', text: res.error || 'Errore' })
    setBusy(false)
  }
  return (
    <View style={[styles.keyRow, { borderColor: t.line }]}>
      <Text style={{ color: t.ink, fontWeight: '700' }}>{info.label} · {model.label}</Text>
      <Text style={{ color: masked ? t.ink2 : t.ink3, fontSize: 13 }}>{masked ? `Chiave salvata: ${masked}` : 'Nessuna chiave'}</Text>
      <Text style={{ color: t.ink3, fontSize: 12 }}>{info.note}</Text>
      {editing ? (
        <View style={{ gap: space.xs }}>
          <TextInput value={value} onChangeText={setValue} placeholder={info.keyHint} placeholderTextColor={t.ink3} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" importantForAutofill="no" style={[styles.input, { color: t.ink, borderColor: t.line, backgroundColor: t.bg }]} />
          <ButtonRow>
            <Button label="Salva" small onPress={save} disabled={busy || !value.trim()} />
            <Button label="Annulla" variant="secondary" small onPress={() => { setEditing(false); setValue('') }} />
          </ButtonRow>
        </View>
      ) : (
        <ButtonRow>
          <Button label={masked ? 'Cambia' : 'Inserisci'} variant="secondary" small onPress={() => setEditing(true)} />
          {masked ? <Button label={busy ? 'Provo…' : 'Prova'} variant="secondary" small onPress={test} disabled={busy} /> : <Button label="Crea la chiave" variant="ghost" small onPress={() => Linking.openURL(info.console).catch(() => {})} />}
          {masked ? <Button label="Elimina" variant="ghostDanger" small onPress={remove} disabled={busy} /> : null}
        </ButtonRow>
      )}
      {status ? <Note tone={status.tone}>{status.text}</Note> : null}
    </View>
  )
}

function ModelPicker({ keys, selected, onToggle }) {
  return LLM_MODELS.map((m) => (
    <Toggle key={m.key} label={`${m.label}${keys[m.provider] ? '' : ' (manca la chiave)'}`} value={Boolean(selected[m.key]) && Boolean(keys[m.provider])} onChange={(v) => keys[m.provider] && onToggle(m.key, v)} />
  ))
}

function Stars({ value, onChange }) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: 5, now: value }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} hitSlop={6} accessibilityLabel={`${n} su 5`}>
          <Text style={{ fontSize: 26, color: n <= value ? t.warn : t.line }}>★</Text>
        </Pressable>
      ))}
    </View>
  )
}

function BlindRating({ lab, cases, psychRuns, onRate, seed }) {
  const t = useTheme()
  const [wanted, setIndex] = useState(0)
  // The case list can shrink while rating (a pair relabelled or deleted): stay on a valid case.
  const index = Math.min(wanted, Math.max(0, cases.length - 1))
  const c = cases[index]
  if (!c) return <Note>Nessun caso da valutare.</Note>
  const outputs = psychRuns.filter((r) => r.caseId === c.caseId && r.ok)
  const order = blindOrder(c.caseId, outputs.map((r) => r.modelKey), seed)
  const ratingOf = (modelKey) => lab.ratings.find((r) => r.caseId === c.caseId && r.modelKey === modelKey) || { score: 0, invented: false }
  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>CASO {index + 1} DI {cases.length}</Text>
      <Text style={{ color: t.ink, fontWeight: '700' }}>{c.candidate.title}</Text>
      <Body small muted>{[c.candidate.brand, c.candidate.size, c.candidate.condition].filter(Boolean).join(' · ')}{c.candidate.price != null ? ` · ${formatEuro(c.candidate.price)}` : ''}</Body>
      {order.length === 0 ? <Note>Nessun testo per questo caso: genera prima i testi.</Note> : null}
      {order.map(({ letter, modelKey }) => {
        const out = outputs.find((r) => r.modelKey === modelKey).value
        const rating = ratingOf(modelKey)
        return (
          <View key={letter} style={[styles.blind, { borderColor: t.line, backgroundColor: t.card }]}>
            <Text style={{ color: t.accentInk, fontWeight: '800' }}>Testo {letter}</Text>
            <Body small>{out.why}</Body>
            {(out.leverage || []).map((x, i) => <Body key={`l${i}`} small>• {x}</Body>)}
            <Body small muted>{out.sellerProfile}</Body>
            {(out.risks || []).map((x, i) => <Body key={`r${i}`} small muted>Rischio: {x}</Body>)}
            <Stars value={rating.score} onChange={(score) => onRate(c.caseId, modelKey, { score })} />
            <Toggle label="Inventa dati che non ci sono" value={rating.invented} onChange={(invented) => onRate(c.caseId, modelKey, { invented })} />
          </View>
        )
      })}
      <ButtonRow>
        <Button label="Precedente" variant="secondary" small onPress={() => setIndex(Math.max(0, index - 1))} disabled={index === 0} />
        <Button label="Successivo" variant="secondary" small onPress={() => setIndex(Math.min(cases.length - 1, index + 1))} disabled={index >= cases.length - 1} />
      </ButtonRow>
    </View>
  )
}

/**
 * «Laboratorio AI» (Info tab): keys of the four providers, labelled pairs collected from the user's own searches,
 * the photo-verification test, the blind psychology test, spend and the Excel report. The state lives in App
 * (useLab) so a running test survives closing this screen.
 */
export function LabView({ labState, onClose, reference = null, onToast = () => {}, onCollectingChange = () => {} }) {
  const t = useTheme()
  const { ready, loadFailed, lab, keys, job, cases, psychRuns, verification, psychology, allRated } = labState
  const [collecting, setCollecting] = useState(false)
  const [selected, setSelected] = useState(() => Object.fromEntries(LLM_MODELS.map((m) => [m.key, true])))
  const [rating, setRating] = useState(false)
  const [showPairs, setShowPairs] = useState(false)
  const [pairLimit, setPairLimit] = useState(PAIR_PAGE)
  // App needs to know: a reminder tap must not close the lab under an open collection with unsaved labels.
  useEffect(() => {
    onCollectingChange(collecting)
    return () => onCollectingChange(false)
  }, [collecting, onCollectingChange])

  const activeModels = useMemo(() => LLM_MODELS.filter((m) => selected[m.key] && keys[m.provider]).map((m) => m.key), [selected, keys])
  const counts = useMemo(() => {
    const c = { same: 0, variant: 0, different: 0 }
    for (const p of (lab ? lab.pairs : [])) if (c[p.label] !== undefined) c[p.label]++
    return c
  }, [lab])
  if (!ready) return <Card><Body>Carico il laboratorio…</Body></Card>

  const totalPairs = counts.same + counts.variant + counts.different
  const spendTotal = Object.values(lab.spend || {}).reduce((a, b) => a + b, 0)
  const verifyEstimate = activeModels.reduce((sum, k) => sum + totalPairs * (estimateCallCost(k, 'verify') || 0), 0)
  const psychEstimate = activeModels.reduce((sum, k) => sum + cases.length * (estimateCallCost(k, 'psych') || 0), 0)
  const nameOf = (k) => (LLM_MODELS.find((m) => m.key === k) || {}).label || k
  const hasRef = Boolean(reference && reference.photo)

  const run = async (fn, label) => {
    const res = await fn(activeModels)
    if (res) onToast(`${label}: ${res.done} ${res.done === 1 ? 'risposta' : 'risposte'}${res.failed ? `, ${res.failed} con errore` : ''}, spesa ${usd(res.cost)}${res.cancelled ? ' (interrotto)' : ''}.`)
  }

  return (
    <View style={{ gap: space.lg }}>
      <Card>
        <SectionLabel>Laboratorio AI</SectionLabel>
        <Title>Quale modello lavora meglio per te</Title>
        <Body muted small>Confronto quattro modelli sugli stessi annunci: riconoscere lo stesso prodotto dalle foto e spiegare perché conviene trattare. Le chiavi restano cifrate nel telefono; i testi e le foto degli annunci vengono inviati ai fornitori che scegli.</Body>
        <Body small>Spesa stimata finora: {usd(spendTotal)}{spendTotal ? ` (${Object.entries(lab.spend).filter(([, v]) => v > 0).map(([p, v]) => `${LLM_PROVIDERS[p] ? LLM_PROVIDERS[p].label : p} ${usd(v)}`).join(', ')})` : ''}</Body>
        {loadFailed ? <Note tone="warn">Non riesco a leggere i dati salvati del laboratorio. Per non cancellarli non salvo nulla: chiudi e riapri l'app.</Note> : null}
        <Button label="Chiudi il laboratorio" variant="secondary" small onPress={onClose} />
      </Card>

      <Card>
        <SectionLabel>1 · Chiavi</SectionLabel>
        <Body muted small>Una per fornitore. Imposta sul sito del fornitore un tetto di spesa mensile: è l'unica protezione se il telefono finisce in mani sbagliate.</Body>
        {Object.keys(LLM_PROVIDERS).map((p) => <KeyRow key={p} provider={p} masked={keys[p]} onSave={labState.saveKey} onTest={labState.checkKey} />)}
      </Card>

      <Card>
        <SectionLabel>2 · Coppie etichettate</SectionLabel>
        <Title>{totalPairs} di {TARGET_PAIRS}</Title>
        <Meter value={Math.min(1, totalPairs / TARGET_PAIRS)} />
        <Body small>Stesso {counts.same} · Variante {counts.variant} · Diverso {counts.different}</Body>
        <Body muted small>Cerca su Vinted un prodotto che ti interessa e confronta i risultati con l'annuncio di riferimento. Circa 10 ricerche da 10 annunci bastano; includi anche annunci diversi.</Body>
        {!hasRef ? <Note>Suggerimento: analizza prima un annuncio dal link (scheda Calcola): lo uso come riferimento e come ricerca di partenza.</Note> : null}
        <Button label="Raccogli coppie" onPress={() => setCollecting(true)} disabled={Boolean(job)} />
        {totalPairs ? <Button label={showPairs ? 'Nascondi le coppie' : 'Mostra e correggi le coppie'} variant="ghost" small onPress={() => setShowPairs((v) => !v)} /> : null}
        {showPairs ? lab.pairs.slice().reverse().slice(0, pairLimit).map((p) => (
          <View key={p.id} style={[styles.pairRow, { borderColor: t.line }]}>
            <Text style={{ color: t.ink, fontSize: 13 }} numberOfLines={1}>Rif.: {p.source.title}</Text>
            <Text style={{ color: t.ink2, fontSize: 13 }} numberOfLines={1}>Cand.: {p.candidate.title}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, alignItems: 'center' }}>
              {PAIR_LABELS.map((l) => (
                <Pressable key={l.id} onPress={() => labState.relabel(p.id, l.id)} style={[styles.miniChip, { borderColor: p.label === l.id ? t.accent : t.line, backgroundColor: p.label === l.id ? t.accent : t.card }]}>
                  <Text style={{ color: p.label === l.id ? t.onAccent : t.ink, fontSize: 12, fontWeight: '700' }}>{l.label}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => labState.removePair(p.id)} hitSlop={6}><Text style={{ color: t.bad, fontSize: 12, fontWeight: '700' }}>Elimina</Text></Pressable>
            </View>
          </View>
        )) : null}
        {showPairs && lab.pairs.length > pairLimit ? <Button label={`Mostra altre ${Math.min(PAIR_PAGE, lab.pairs.length - pairLimit)}`} variant="ghost" small onPress={() => setPairLimit((n) => n + PAIR_PAGE)} /> : null}
      </Card>

      <Card>
        <SectionLabel>3 · Test delle foto</SectionLabel>
        <Body muted small>Ogni modello confronta foto e testo di ogni coppia e risponde Stesso, Variante o Diverso. Misuro accuratezza, falsi «stesso» (l'errore che costa di più), risposte valide, costo e tempi.</Body>
        <ModelPicker keys={keys} selected={selected} onToggle={(k, v) => setSelected((s) => ({ ...s, [k]: v }))} />
        {totalPairs && activeModels.length ? <Body muted small>Stima per tutte le coppie: {usd(verifyEstimate)} ({totalPairs} coppie × {activeModels.length} modelli; il costo reale è nel report).</Body> : null}
        {job ? (
          <View style={{ gap: space.xs }}>
            <Body small>{job.kind === 'verify' ? 'Test delle foto' : 'Testi di psicologia'}: {job.done} di {job.total}{job.failed ? `, ${job.failed} errori` : ''} · {usd(job.cost)}</Body>
            <Meter value={job.total ? job.done / job.total : 0} />
            <Button label="Interrompi" variant="danger" small onPress={labState.cancel} />
          </View>
        ) : (
          <ButtonRow>
            <Button label="Avvia" onPress={() => run(labState.runVerification, 'Test delle foto')} disabled={!activeModels.length || !totalPairs} />
            <Button label="Rifai tutto" variant="secondary" onPress={() => run((m) => labState.runVerification(m, { rerun: true }), 'Test delle foto')} disabled={!activeModels.length || !totalPairs} />
          </ButtonRow>
        )}
        {verification.length ? (
          <View style={{ gap: space.xs }}>
            {verification.map((v) => (
              <View key={v.modelKey} style={[styles.resultRow, { borderColor: t.line }]}>
                <Text style={{ color: t.ink, fontWeight: '700' }}>{nameOf(v.modelKey)}</Text>
                <Body small>Accuratezza {pct(v.accuracy)} · falsi «stesso» {pct(v.falseMatchRate)}{ratio(v.falseMatches, v.differentPairs)} · mancati {pct(v.missRate)}{ratio(v.misses, v.samePairs)}</Body>
                <Body small muted>Risposte valide {pct(v.validRate)} · {usd(v.costPerPair)} a coppia · {secs(v.latencyP50)} tipico · {v.n} coppie</Body>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <SectionLabel>4 · Test di psicologia (alla cieca)</SectionLabel>
        <Body muted small>Per {cases.length || 'fino a 10'} annunci etichettati Stesso o Variante, ogni modello spiega perché conviene, su cosa fare leva e com'è il venditore, usando i numeri del motore. Tu voti i testi senza sapere chi li ha scritti.</Body>
        {!cases.length ? <Note>Servono coppie etichettate Stesso o Variante.</Note> : null}
        {cases.length && activeModels.length ? <Body muted small>Stima: {usd(psychEstimate)} ({cases.length} casi × {activeModels.length} modelli).</Body> : null}
        {!job ? (
          <ButtonRow>
            <Button label="Genera i testi" onPress={() => run(labState.runPsychology, 'Testi di psicologia')} disabled={!activeModels.length || !cases.length} />
            <Button label={rating ? 'Chiudi la valutazione' : 'Valuta alla cieca'} variant="secondary" onPress={() => setRating((v) => !v)} disabled={!psychRuns.some((r) => r.ok)} />
          </ButtonRow>
        ) : null}
        {rating ? <BlindRating lab={lab} cases={cases} psychRuns={psychRuns} onRate={labState.rate} seed={lab.seed} /> : null}
        {psychology.length && !allRated ? <Note>I risultati per modello compaiono quando hai votato tutti i testi: così il test resta alla cieca.</Note> : null}
        {psychology.length && allRated && !rating ? (
          <View style={{ gap: space.xs }}>
            {psychology.map((p) => (
              <View key={p.modelKey} style={[styles.resultRow, { borderColor: t.line }]}>
                <Text style={{ color: t.ink, fontWeight: '700' }}>{nameOf(p.modelKey)}</Text>
                <Body small>Voto medio {p.meanScore != null ? p.meanScore.toFixed(1).replace('.', ',') : '—'} su 5 · migliore {p.wins} {p.wins === 1 ? 'volta' : 'volte'} · inventa dati {pct(p.inventedRate)}</Body>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <SectionLabel>5 · Report</SectionLabel>
        <Body muted small>Excel con riepilogo, tutte le risposte, i voti e i prezzi usati per i costi. La parte di psicologia entra quando hai votato tutti i testi.</Body>
        <ButtonRow>
          <Button label="Esporta Excel" onPress={async () => { const f = await labState.exportReport(); if (f) onToast(f.savedTo === 'folder' ? 'Report salvato nella cartella scelta.' : f.localUri ? 'Report pronto: scegli dove mandarlo.' : f.error || 'Report non salvato.') }} disabled={!verification.length && !(psychology.length && allRated)} />
          <Button label="Azzera il test" variant="ghostDanger" onPress={() => confirmAction('Azzerare il test?', 'Cancello coppie, risposte e voti. Le chiavi restano.', 'Azzera', () => labState.reset())} disabled={Boolean(job) || loadFailed} />
        </ButtonRow>
      </Card>

      {collecting ? (
        <CollectSheet
          visible
          initialQuery={reference ? vintedSearchQuery(reference) : ''}
          reference={hasRef ? reference : null}
          onClose={() => setCollecting(false)}
          onSave={async (pairs) => {
            const next = await labState.addPairs(pairs)
            setCollecting(false)
            onToast(`${pairs.length} ${pairs.length === 1 ? 'coppia salvata' : 'coppie salvate'}. Totale ${next ? next.pairs.length : totalPairs + pairs.length}.`)
          }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  keyRow: { gap: space.xs, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: { minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 15 },
  pairRow: { gap: 2, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  miniChip: { paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  resultRow: { gap: 2, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  blind: { gap: space.xs, padding: space.md, borderWidth: 1, borderRadius: radius.md },
})
