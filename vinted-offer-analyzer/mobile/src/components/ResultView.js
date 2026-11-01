import { useState } from 'react'
import { Text, View } from 'react-native'
import { articleFor } from '../../core/index.js'
import { space } from '../theme.js'
import { Button, Note } from './ui.js'
import { DecisionHero } from './result/DecisionHero.js'
import { MessageSection } from './result/MessageSection.js'
import { WhySection } from './result/WhySection.js'
import { MomentsSection } from './result/MomentsSection.js'
import { PriceSection } from './result/PriceSection.js'
import { SourceSection } from './result/SourceSection.js'

/**
 * The result page, decision first: the hero, then six closed folds, then «Nuova analisi». Everything is computed by
 * App.js (curve, levers, risk) and passed down, so the hero tile and the price table never disagree. `dataFold` is the
 * «Dati dell'offerta» Collapsible the screen owns (its open state survives a new analysis).
 */
export function ResultView({
  result, risk = null, levers = [], curve = null, extraction = null, marketInfo = null, policy = null, saveState = null, calendarBusy = false, now = null,
  goal, onGoal, plan = null, optimizing = false, onOptimize, onApply,
  onSave, onSaveAndMarkSent, onCalendar, onCounter, onSkipExploration = null, onApplyPrice = null, onLever = null, onPickMoment = null, link = null, onCopyMessage = null,
  onOpenSearch = null, searchJob = null, onRecalc = null, onEditData, onReset, dataFold = null,
}) {
  // Controlled so the hero's «Vedi mercato» can open the price fold.
  const [priceOpen, setPriceOpen] = useState(false)

  if (result.kind === 'no_offer_needed') {
    return (
      <View style={{ gap: space.lg }}>
        <DecisionHero result={result} policy={policy} onEdit={onEditData} />
        {dataFold}
        <Button label="Nuova analisi" variant="ghost" onPress={onReset} />
      </View>
    )
  }

  const marketLater = Boolean(marketInfo && marketInfo.market && marketInfo.market.n >= 2 && !result.market)
  return (
    <View style={{ gap: space.lg }}>
      {result.warnings.map((w) => <Note key={w.id} tone="warn">{w.text}</Note>)}
      {result.kind === 'over_cap' && (
        <Note tone="bad">
          <Text style={{ fontWeight: '700' }}>Sconto {articleFor(result.requestedInput.discountPct)}{Math.round(result.requestedInput.discountPct)}%: oltre il limite di Vinted. </Text>
          {result.message}{'\n'}{result.capAdvice.map((a) => `• ${a}`).join('\n')}
        </Note>
      )}
      <DecisionHero
        result={result}
        levers={levers}
        curve={curve}
        risk={risk}
        policy={policy}
        saveState={saveState}
        calendarBusy={calendarBusy}
        now={now}
        onEdit={onEditData}
        onSave={onSave}
        onSaveAndMarkSent={onSaveAndMarkSent}
        onCalendar={onCalendar}
        onCounter={onCounter}
        onApplyPrice={onApplyPrice}
        onSkipExploration={onSkipExploration}
        link={link}
        onCopyMessage={onCopyMessage}
        onOpenPrice={() => setPriceOpen(true)}
      />
      {marketLater && (
        <View style={{ gap: space.sm }}>
          <Note tone="warn">Mercato trovato dopo il calcolo: i numeri non lo usano.</Note>
          {onRecalc ? <Button label="Ricalcola con il mercato" small variant="secondary" onPress={onRecalc} /> : null}
        </View>
      )}
      <MessageSection key={result.now.getTime()} result={result} />
      <WhySection result={result} risk={risk} policy={policy} />
      <MomentsSection result={result} onPickMoment={onPickMoment} />
      <PriceSection
        result={result}
        curve={curve}
        marketInfo={marketInfo}
        levers={levers}
        goal={goal}
        onGoal={onGoal}
        plan={plan}
        onOptimize={onOptimize}
        onApply={onApply}
        optimizing={optimizing}
        onLever={onLever}
        onOpenSearch={onOpenSearch}
        searchJob={searchJob}
        onRecalc={onRecalc}
        open={priceOpen}
        onToggle={setPriceOpen}
      />
      {extraction && extraction.ok ? <SourceSection extraction={extraction} onEdit={onEditData} /> : null}
      {dataFold}
      <Button label="Nuova analisi" variant="ghost" onPress={onReset} />
    </View>
  )
}
