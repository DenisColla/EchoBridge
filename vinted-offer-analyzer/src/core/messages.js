/**
 * Supporting message templates (Italian). Pure data + formatting, no UI.
 * Rules baked in: "Ciao" + tu register, never criticise the item or the price,
 * never compare with other listings, the offer itself is sent through Vinted's button.
 * One exception, opt-in: the 'informato' tone cites the market median found by the
 * cross-channel search, only when real comparable listings were found and priced lower.
 *
 * Engine 1.4.0 (spec §4.2): under 30 € the message is a one-liner («diretto»), the word «budget» never appears under
 * 50 € (a budget reason on a cheap item reads as haggling), every template promises to pay at once («pago subito» /
 * «completo subito»), and four situational tones join the list only when they apply: 'lotto' (the seller has other
 * items), 'spedizione' (under 15 €: shipping included instead of a discount), 'domanda' (old listing or seller rarely
 * online: ask first), 'dopo_rifiuto' (one closing line after a refusal). Templates never contain names or contacts.
 */

export const TONES = [
  { id: 'cordiale', label: 'Cordiale', hint: 'Rompe il ghiaccio e lascia spazio a una controproposta' },
  { id: 'diretto', label: 'Diretto', hint: 'Breve e senza giri di parole; con sconti piccoli l\'offerta può partire anche senza messaggio' },
  { id: 'impegno', label: 'Impegno all\'acquisto', hint: 'Toglie al venditore la paura dell\'offerta accettata e mai pagata' },
  { id: 'motivato', label: 'Motivato', hint: 'Dà un motivo senza criticare l\'articolo: adatto a categorie di valore' },
]

/** Fifth tone, present only when buildMessages receives a market whose median is below the listing price. */
export const MARKET_TONE = { id: 'informato', label: 'Informato', hint: 'Cita il prezzo visto su altri siti: onesto e verificabile, solo quando il mercato è davvero più basso' }

/** Situational tones (1.4.0): each appears in buildMessages only when its condition holds. */
export const EXTRA_TONES = [
  { id: 'lotto', label: 'Lotto', hint: 'Chiede un prezzo per due articoli con una sola spedizione: lo sconto sul lotto si ottiene più facilmente' },
  { id: 'spedizione', label: 'Spedizione inclusa', hint: 'Sotto 15 €: chiede la spedizione inclusa invece di uno sconto che varrebbe pochi euro' },
  { id: 'domanda', label: 'Domanda', hint: 'Annuncio vecchio o venditore poco presente: chiede se è ancora disponibile e propone la cifra' },
  { id: 'dopo_rifiuto', label: 'Dopo un no', hint: 'Chiude con garbo e lascia la porta aperta a un ribasso' },
]

export const ALL_TONES = [...TONES, MARKET_TONE, ...EXTRA_TONES]

/** Label and hint of any tone id (the UI renders chips over the messages it receives, not over a fixed list). */
export const toneMeta = (id) => ALL_TONES.find((t) => t.id === id) || null

/** List price thresholds of the message rules (euros). */
export const MESSAGE_RULES = Object.freeze({ ONE_LINER_UNDER: 30, NO_BUDGET_UNDER: 50, SHIPPING_UNDER: 15, BUNDLE_MIN_SELLER_ITEMS: 2 })

const msgPrice = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')))
const msgFinite = (v) => Number.isFinite(v) && v > 0

/**
 * Recommended tone for a first offer. Under 30 € the one-liner («diretto»); a premium category gets the reasoned tone
 * only from 50 € (the budget reason is never recommended on a cheap item); otherwise by risk band.
 */
export const recommendedToneFor = (input) => {
  const L = msgPrice(input.listPrice)
  if (msgFinite(L) && L < MESSAGE_RULES.ONE_LINER_UNDER) return 'diretto'
  if (input.category && input.category.premium && (!msgFinite(L) || L >= MESSAGE_RULES.NO_BUDGET_UNDER)) return 'motivato'
  if (input.riskBand.id === 'low') return 'diretto'
  if (input.riskBand.id === 'medium') return 'cordiale'
  return 'impegno'
}

export const formatEuro = (value) => {
  const rounded = Math.round(value * 100) / 100
  const hasCents = Math.abs(rounded - Math.round(rounded)) > 0.004
  const str = hasCents ? rounded.toFixed(2).replace('.', ',') : String(Math.round(rounded))
  return `${str} €`
}

const salutationFor = (sendAt) => {
  if (!sendAt) return ''
  const hour = sendAt.getHours()
  if (hour < 12) return 'buona giornata'
  if (hour >= 17) return 'buona serata'
  return ''
}

const closing = (sendAt) => {
  const s = salutationFor(sendAt)
  return s ? `Grazie e ${s}!` : 'Grazie!'
}

/** The one closing line after a refusal: no new number, the door stays open. */
export const buildAfterRefusalMessage = () => 'Ciao! Grazie comunque: se dovessi ribassare resto interessato e pago subito.'

/**
 * `beforeOffer` = true when the strategy is to write first and send the offer only after a reply
 * (high block risk or inactive seller): the templates then propose the price instead of announcing a sent offer.
 * `market` (value.js marketFromRows, optional): with at least two comparable listings whose median is below the
 * listing price, a fifth 'informato' message cites that median; without it the four messages are unchanged.
 * `signals.sellerItems` ≥ 2 (or `otherItem`) adds 'lotto'; a list price under 15 € adds 'spedizione'; an old listing
 * or a seller rarely online ('quiet' / 'inactive') adds 'domanda'; `afterRefusal` adds 'dopo_rifiuto'.
 */
export function buildMessages({ itemTitle, listPrice, targetPrice, listingAge, sendAt, beforeOffer = false, market = null, signals = null, sellerProfile = null, otherItem = null, bundlePrice = null, afterRefusal = false }) {
  const item = itemTitle && itemTitle.trim() ? `"${itemTitle.trim()}"` : "l'articolo"
  const Item = item === "l'articolo" ? "L'articolo" : item
  const price = formatEuro(targetPrice)
  const L = msgPrice(listPrice)
  const cheap = msgFinite(L) && L < MESSAGE_RULES.ONE_LINER_UNDER
  const noBudget = msgFinite(L) && L < MESSAGE_RULES.NO_BUDGET_UNDER
  const isOld = listingAge && (listingAge.id === 'over_month' || listingAge.id === 'weeks_2_4')
  const informed = market && market.n >= 2 && Number.isFinite(market.medianPrice) && Number.isFinite(listPrice) && market.medianPrice < listPrice
    ? formatEuro(market.medianPrice)
    : null
  const sellerId = sellerProfile && typeof sellerProfile === 'object' ? sellerProfile.id : sellerProfile
  const sellerItems = signals && Number.isFinite(signals.sellerItems) ? signals.sellerItems : 0
  const extras = []
  if (sellerItems >= MESSAGE_RULES.BUNDLE_MIN_SELLER_ITEMS || (otherItem && String(otherItem).trim())) {
    const other = otherItem && String(otherItem).trim() ? `"${String(otherItem).trim()}"` : 'un altro tuo articolo'
    const bundle = msgFinite(msgPrice(bundlePrice)) ? formatEuro(msgPrice(bundlePrice)) : 'un prezzo'
    extras.push({ tone: 'lotto', text: `Ciao! Mi piace ${item}. Se prendo anche ${other}, riusciresti a farmi ${bundle} per entrambi con una sola spedizione? Pago subito. ${closing(sendAt)}` })
  }
  if (msgFinite(L) && L < MESSAGE_RULES.SHIPPING_UNDER) {
    extras.push({ tone: 'spedizione', text: `Ciao! Mi piace ${item}: se la spedizione fosse inclusa lo prenderei a ${formatEuro(L)} e pago subito. ${closing(sendAt)}` })
  }
  if (isOld || sellerId === 'quiet' || sellerId === 'inactive') {
    extras.push({ tone: 'domanda', text: `Ciao! ${Item} è ancora disponibile? Accetteresti ${price}? Se sì pago subito. Grazie!` })
  }
  if (afterRefusal) extras.push({ tone: 'dopo_rifiuto', text: buildAfterRefusalMessage() })

  if (beforeOffer) {
    return [
      {
        tone: 'cordiale',
        text: `Ciao! Mi piace molto ${item}. Ti andrebbe bene ${price}? Se per te può andare ti invio subito l'offerta e pago subito. ${closing(sendAt)}`,
      },
      {
        tone: 'diretto',
        text: cheap
          ? `Ciao! Ti andrebbe bene ${price} per ${item}? Se sì ti invio l'offerta e pago subito.`
          : `Ciao! Ti propongo ${price} per ${item}. Se per te va bene ti invio subito l'offerta e pago subito. Grazie!`,
      },
      {
        tone: 'impegno',
        text: `Ciao! ${isOld ? 'Ho visto che ' + item + ' è online da un po\': ' : ''}ti propongo ${price}. Se accetti ti invio l'offerta e completo subito l'acquisto, così puoi spedire appena ti è comodo. ${closing(sendAt)}`,
      },
      {
        tone: 'motivato',
        text: noBudget
          ? `Ciao! ${Item} mi interessa davvero: potrei arrivare a ${price}, che è quanto riesco a spendere adesso. Se per te può andare ti invio subito l'offerta e pago subito. ${closing(sendAt)}`
          : `Ciao! ${Item} mi interessa davvero: potrei arrivare a ${price}, che è il massimo del mio budget in questo momento. Se per te può andare ti invio subito l'offerta e pago subito. ${closing(sendAt)}`,
      },
      ...(informed ? [{
        tone: MARKET_TONE.id,
        text: `Ciao! Mi piace molto ${item}. Ho visto lo stesso modello intorno a ${informed} su altri siti, per questo ti propongo ${price}: se per te può andare ti invio subito l'offerta e completo subito l'acquisto. ${closing(sendAt)}`,
      }] : []),
      ...extras,
    ]
  }

  return [
    {
      tone: 'cordiale',
      text: `Ciao! Mi piace molto ${item} e ti ho appena inviato un'offerta di ${price}. Se per te può andare pago subito, altrimenti dimmi pure la tua cifra. ${closing(sendAt)}`,
    },
    {
      tone: 'diretto',
      text: cheap
        ? `Ciao! Ti ho inviato un'offerta di ${price}, se ti va bene pago subito.`
        : `Ciao! Ti ho inviato un'offerta di ${price} per ${item}. Se va bene per te completo subito l'acquisto. Grazie!`,
    },
    {
      tone: 'impegno',
      text: `Ciao! Ti ho appena inviato un'offerta di ${price} per ${item}. ${isOld ? 'Ho visto che è online da un po\': se' : 'Se'} accetti completo subito l'acquisto, così puoi spedire appena ti è comodo e senza altre trattative. ${closing(sendAt)}`,
    },
    {
      tone: 'motivato',
      text: noBudget
        ? `Ciao! ${Item} mi interessa davvero e ti ho inviato un'offerta di ${price}: è quanto riesco a spendere adesso. Se per te può andare completo subito l'acquisto. ${closing(sendAt)}`
        : `Ciao! ${Item} mi interessa davvero e ti ho inviato un'offerta di ${price}: è il massimo del mio budget in questo momento. Se per te può andare completo subito l'acquisto. ${closing(sendAt)}`,
    },
    ...(informed ? [{
      tone: MARKET_TONE.id,
      text: `Ciao! Mi piace molto ${item} e ti ho appena inviato un'offerta di ${price}. Ho visto lo stesso modello intorno a ${informed} su altri siti, per questo la cifra: se per te può andare completo subito l'acquisto. ${closing(sendAt)}`,
    }] : []),
    ...extras,
  ]
}

/* ───────── counter-offer messages (our reply to the seller's "Fai il tuo prezzo") ───────── */

/**
 * Rules (enforced by tests): start with "Ciao!", "tu" register, never repeat the seller's number, never criticise the
 * item, give a real reason (the total with the Vinted fee) and promise to pay at once, "metà strada" only for a split,
 * "massimo" only for a final offer, no deadlines or threats. First person without past participles that agree with
 * the writer's gender ("ho alzato", not "sono salito"). Coherent with the first-offer "motivato" template, which
 * already called the first offer the top of the budget: counters say "Ho rifatto i conti".
 */
export function buildCounterMessages({ itemTitle, price, previousOffer, firstOffer, sendAt, isSplit = false, isFinal = false, stale = false, total }) {
  const item = itemTitle && itemTitle.trim() ? `"${itemTitle.trim()}"` : "l'articolo"
  const p = formatEuro(price)
  const prev = formatEuro(previousOffer)
  const first = formatEuro(firstOffer ?? previousOffer)
  const tot = formatEuro(total ?? price)
  const end = closing(sendAt)
  const hi = stale ? 'Ciao! Scusa se ti rispondo solo ora.' : 'Ciao!'

  let texts
  if (isFinal) {
    const mid = isSplit ? ' a metà strada,' : ''
    texts = {
      cordiale: `${hi} Ci ho pensato bene: per ${item} posso arrivare${mid} a ${p}: è il massimo che riesco a fare. Se ti va bene lo compro subito; in ogni caso grazie!`,
      diretto: `${hi} ${isSplit ? `Facciamo a metà strada: ${p}` : p} è il massimo che posso fare per ${item}: se ti va, lo compro subito. Grazie!`,
      impegno: `${hi} Ultimo passo da parte mia${isSplit ? ', a metà strada' : ''}: ${p}, il massimo che posso spendere. Se accetti pago subito. Grazie comunque della disponibilità!`,
      motivato: `${hi} Ci ho pensato bene: per ${item} posso arrivare${mid} a ${p}, che con la commissione Vinted diventa circa ${tot}, ed è davvero il massimo che riesco a spendere. Se ti va bene lo compro subito; in ogni caso grazie della disponibilità!`,
    }
  } else if (isSplit) {
    texts = {
      cordiale: `${hi} Grazie per la risposta. Che ne dici se ci veniamo incontro a metà strada, a ${p}? Se ti va bene lo compro subito. ${end}`,
      diretto: `${hi} Facciamo a metà strada? ${p} e lo compro subito. Grazie!`,
      impegno: `${hi} Grazie per la risposta. Ho già alzato la mia offerta rispetto a ${first}: facciamo a metà strada? Ti propongo ${p} e, se accetti, lo compro subito, così puoi spedire quando ti è comodo. ${end}`,
      motivato: `${hi} Ho rifatto i conti: facciamo a metà strada a ${p}? Con la commissione Vinted per me diventa già circa ${tot}. Se ti va bene lo compro subito. ${end}`,
    }
  } else {
    texts = {
      cordiale: `${hi} Grazie per la risposta, ${item} mi piace davvero. Mi chiedevo se ${p} potesse andarti bene: se sì, lo compro subito. ${end}`,
      diretto: `${hi} Ti propongo ${p} per ${item}: se ti va bene lo compro subito. Grazie!`,
      impegno: `${hi} Ti propongo ${p} per ${item}. Se accetti pago subito, così puoi spedire quando ti è comodo. ${end}`,
      motivato: `${hi} Grazie per la risposta. Ho rifatto i conti e ho alzato la mia offerta da ${prev} a ${p}: con la commissione Vinted per me diventa già circa ${tot}. Mi chiedevo se così potesse andarti bene: se sì, lo compro subito. ${end}`,
    }
  }
  return TONES.map((t) => ({ tone: t.id, text: texts[t.id] }))
}

/** Messages when the plan is to buy at the seller's price ("Acquista"): optional, they only close on a friendly note. */
export function buildAcceptMessages({ stale = false } = {}) {
  const hi = stale ? 'Ciao! Scusa se ti rispondo solo ora.' : 'Ciao!'
  const texts = {
    cordiale: `${hi} Affare fatto, lo compro subito. Grazie!`,
    diretto: `${hi} Va bene, lo compro subito. Grazie!`,
    impegno: `${hi} Affare fatto: lo compro adesso e pago subito. Grazie!`,
    motivato: `${hi} Grazie della disponibilità: lo compro subito.`,
  }
  return TONES.map((t) => ({ tone: t.id, text: texts[t.id] }))
}

/** A nudge after a day of silence: no new number, only a reminder that our offer is waiting. */
export const buildCounterNudge = ({ itemTitle }) => {
  const item = itemTitle && itemTitle.trim() ? `"${itemTitle.trim()}"` : "l'articolo"
  return `Ciao! Ti ho fatto una proposta per ${item}: quando hai un momento fammi sapere. Grazie!`
}

/** Final offer → reason (motivato); split → payment promise (impegno); tough seller or valuable item → motivato. */
export const recommendedCounterToneFor = ({ isSplit = false, isFinal = false, stance = null, premium = false }) => {
  if (isFinal) return 'motivato'
  if (isSplit) return 'impegno'
  if (premium || stance === 'firm' || stance === 'hold') return 'motivato'
  return 'cordiale'
}
