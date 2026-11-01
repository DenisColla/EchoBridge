import { useEffect, useState } from 'react'
import { expectedPriceCurve } from '../../core/index.js'

/**
 * The expected-price curve of the analysis on screen, computed once per analysis and shared by the hero tile and the
 * price table so the two never disagree. Forty engine runs take a moment on a phone, hence the 120 ms deferral.
 * Built from what was ANALYSED (result.input), never from the live form, so it cannot drift from the score nor re-run
 * on every keystroke. Returns null while computing (the UI shows «…»), `{ empty: true }` when there is no curve for
 * these data, otherwise value.js's curve ({ points, best, atTarget, savingVsList }).
 */
export function useExpectedCurve({ result, profile = null, market = null }) {
  const stamp = result && result.now ? result.now.getTime() : 0
  const input = result && result.ok && result.kind !== 'no_offer_needed' ? result.input : null
  const anchored = Boolean(result && result.market)
  const [state, setState] = useState({ stamp: 0, curve: null })

  useEffect(() => {
    if (!input || !stamp) return undefined
    let alive = true
    const timer = setTimeout(() => {
      let curve
      try {
        const analysed = {
          itemTitle: input.itemTitle,
          category: input.category.id,
          listingAge: input.listingAge.id,
          sellerProfile: input.sellerProfile || 'unknown',
          listingSignal: input.listingSignal.id,
          listPrice: String(input.listPrice).replace('.', ','),
          targetPrice: String(input.targetPrice).replace('.', ','),
          ...(input.signals ? { signals: input.signals } : {}),
        }
        // The market only when the analysis itself used it: otherwise the curve would disagree with the hero.
        curve = expectedPriceCurve(analysed, new Date(stamp), { profile, market: anchored ? market : null }) || { empty: true }
      } catch {
        curve = { empty: true }
      }
      if (alive) setState({ stamp, curve })
    }, 120)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [input, profile, market, anchored, stamp])

  if (!input || state.stamp !== stamp) return null
  return state.curve
}
