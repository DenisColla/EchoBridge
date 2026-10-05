import { useCallback, useMemo, useState } from 'react'
import { VINTED, analyzeOffer, computeDiscountPct, findPriceInText, nextGoalFor, optimizeOffer, parsePrice, riskBandFor, signalFromText } from '../core/index.js'

export const EXAMPLE_FORM = {
  itemTitle: 'Nike Air Force 1 bianche, 42',
  category: 'sneakers',
  listPrice: '60',
  targetPrice: '45',
  listingAge: 'weeks_1_2',
  sellerProfile: 'unknown',
  listingSignal: 'none',
}

export const EMPTY_FORM = {
  itemTitle: '',
  category: '',
  listPrice: '',
  targetPrice: '',
  listingAge: 'unknown',
  sellerProfile: 'unknown',
  listingSignal: 'none',
}

/**
 * Holds the form state and the last analysis. Pure React (no DOM): reusable in React Native.
 * `clock` is injectable so tests and the artifact preview can freeze "now".
 */
export function useOfferAnalysis({ initialForm = EXAMPLE_FORM, clock = () => new Date() } = {}) {
  const [form, setForm] = useState(initialForm)
  const [result, setResult] = useState(null)
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState(false)
  const [goal, setGoal] = useState(0.7)
  const [plan, setPlan] = useState(null)

  const setField = useCallback((name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }))
  }, [])

  const livePreview = useMemo(() => {
    const list = parsePrice(form.listPrice)
    const target = parsePrice(form.targetPrice)
    if (!(list > 0) || !(target > 0)) return null
    const discountPct = computeDiscountPct(list, target)
    return { discountPct, riskBand: discountPct > 0 ? riskBandFor(discountPct) : null, overCap: discountPct > VINTED.MAX_DISCOUNT_PCT }
  }, [form.listPrice, form.targetPrice])

  /** Quick-select: sets the target price from a discount percentage of the list price. */
  const applyDiscount = useCallback((pct) => {
    setForm((prev) => {
      const list = parsePrice(prev.listPrice)
      if (!(list > 0)) return prev
      const raw = list * (1 - pct / 100)
      const target = list >= 20 ? Math.round(raw) : Math.round(raw * 2) / 2
      return { ...prev, targetPrice: String(target).replace('.', ',') }
    })
  }, [])

  const run = useCallback((nextForm, preferredSendAt) => {
    setTouched(true)
    const outcome = analyzeOffer(nextForm, clock(), preferredSendAt ? { preferredSendAt } : {})
    if (!outcome.ok) {
      setErrors(outcome.errors)
      setResult(null)
      return null
    }
    setErrors({})
    setResult(outcome)
    if (outcome.kind !== 'no_offer_needed') setGoal(nextGoalFor(outcome.probability))
    return outcome
  }, [clock])

  const analyze = useCallback(() => {
    setPlan(null)
    return run(form, null)
  }, [form, run])

  /** Finds the cheapest changes (wait, raise the offer, both) that reach `goal`. */
  const optimize = useCallback(() => {
    const next = optimizeOffer(form, clock(), { targetProbability: goal })
    setPlan(next)
    return next
  }, [form, clock, goal])

  /** Applies one optimizer option: sets the price in the form and pins the chosen moment. */
  const applyOption = useCallback((option) => {
    const nextForm = { ...form, targetPrice: String(option.apply.targetPrice).replace('.', ',') }
    setForm(nextForm)
    setPlan(null)
    return run(nextForm, option.apply.preferredSendAt)
  }, [form, run])

  /** Reads negotiation signals (and a price, when the form has none) from pasted listing text. */
  const applyListingText = useCallback((text) => {
    const signal = signalFromText(text)
    const price = findPriceInText(text)
    setForm((prev) => ({
      ...prev,
      listingSignal: signal.id,
      listPrice: prev.listPrice || (price ? String(price).replace('.', ',') : prev.listPrice),
    }))
    return { signal, price }
  }, [])

  const reset = useCallback(() => {
    setForm(EMPTY_FORM)
    setResult(null)
    setErrors({})
    setTouched(false)
    setPlan(null)
  }, [])

  return { form, setField, applyDiscount, errors, touched, result, livePreview, analyze, reset, goal, setGoal, plan, optimize, applyOption, applyListingText }
}
