/**
 * The input of the counter-offer engine (core analyzeCounter), built outside the screen that asks for it: the reply
 * planner types it by hand, the Vinted browser fills it from what the conversation page shows. Pure functions, no
 * React Native: the Node tests run them as they are.
 */
import { parsePrice, policyDiscountFor } from '../../core/index.js'

/** «17,5» → «17,50», «20» → «20»: a price as the form's fields hold it. */
export const priceText = (v) => (Math.abs(v - Math.round(v)) > 0.004 ? v.toFixed(2) : String(Math.round(v))).replace('.', ',')

/** The price the policy (price band × age, modifiers) would have asked for this listing: the form's own policy when it has one. */
export const policyTargetFor = (form, { market, profile }) => {
  if (form && form.policy && Number.isFinite(form.policy.targetPrice)) return form.policy.targetPrice
  const pol = form ? policyDiscountFor({
    listPrice: form.listPrice, listingAge: form.listingAge, category: form.category, sellerProfile: form.sellerProfile,
    listingSignal: form.listingSignal, signals: form.signals, market, profile,
  }) : null
  return pol && pol.kind === 'offer' ? pol.targetPrice : null
}

/** The form of a saved offer, or the little its fields allow to rebuild. */
export const formOfItem = (item) => item.form || {
  itemTitle: item.title || '', category: item.category || '', listPrice: String(item.listPrice ?? '').replace('.', ','),
  targetPrice: String(item.targetPrice ?? '').replace('.', ','), listingAge: 'unknown', sellerProfile: 'unknown', listingSignal: 'none', link: item.link || '',
}

/**
 * The engine input for «the seller answered this saved offer with `sellerPrice`», with the planner's defaults (no
 * budget, no competition, received now): what the reply planner would compute if opened and left as it is.
 * `previousOffer`: the user's figure as Vinted shows it, when known; else the last one of the saved history.
 * A counter-offer already in the history without an answer of ours is replaced by this one (he changed his figure).
 */
export function counterRawFor(item, sellerPrice, { previousOffer = null, receivedAgo = 'just_now' } = {}) {
  const history = Array.isArray(item.negotiation) ? item.negotiation : []
  const form = formOfItem(item)
  const lastEntry = history[history.length - 1]
  const base = lastEntry && lastEntry.by === 'seller' ? history.slice(0, -1) : history
  const lastBuyer = [...base].reverse().find((e) => e.by === 'buyer')
  const B = Number.isFinite(previousOffer) ? previousOffer : lastBuyer ? lastBuyer.price : parsePrice(form.targetPrice)
  // A planned (never marked as sent) offer has no real send time; each counter keeps its «final» flag and uncertainty.
  const entries = base.map((e) => ({ by: e.by, price: e.price, at: e.planned ? null : (e.at || null), isFinal: Boolean(e.isFinal), receivedUncertaintyMinutes: e.receivedUncertaintyMinutes || 0 }))
  if (entries.length && entries[entries.length - 1].by === 'buyer' && Number.isFinite(B)) entries[entries.length - 1] = { ...entries[entries.length - 1], price: B }
  return {
    ...form,
    previousOffer: Number.isFinite(B) ? priceText(B) : '', sellerCounter: priceText(sellerPrice), counterMode: 'eur', receivedAgo,
    maxPrice: '', channel: 'button', competition: false, publicPrice: false, offerSentAt: item.sentAt || null,
    ...(entries.length ? { history: [...entries, { by: 'seller', price: sellerPrice, at: null, receivedUncertaintyMinutes: 0 }] } : {}),
  }
}
