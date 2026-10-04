/**
 * Supporting message templates (Italian). Pure data + formatting, no UI.
 * Rules baked in: "Ciao" + tu register, never criticise the item or the price,
 * never compare with other listings, the offer itself is sent through Vinted's button.
 */

export const TONES = [
  { id: 'cordiale', label: 'Cordiale', hint: 'Rompe il ghiaccio e lascia spazio a una controproposta' },
  { id: 'diretto', label: 'Diretto', hint: 'Breve e senza giri di parole; con sconti piccoli l\'offerta può partire anche senza messaggio' },
  { id: 'impegno', label: 'Impegno all\'acquisto', hint: 'Toglie al venditore la paura dell\'offerta accettata e mai pagata' },
  { id: 'motivato', label: 'Motivato', hint: 'Dà un motivo (il budget) senza criticare l\'articolo: adatto a categorie di valore' },
]

export const recommendedToneFor = (input) => {
  if (input.category && input.category.premium) return 'motivato'
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

/**
 * `beforeOffer` = true when the strategy is to write first and send the offer only after a reply
 * (high block risk or inactive seller): the templates then propose the price instead of announcing a sent offer.
 */
export function buildMessages({ itemTitle, targetPrice, listingAge, sendAt, beforeOffer = false }) {
  const item = itemTitle && itemTitle.trim() ? `"${itemTitle.trim()}"` : "l'articolo"
  const Item = item === "l'articolo" ? "L'articolo" : item
  const price = formatEuro(targetPrice)
  const isOld = listingAge && (listingAge.id === 'over_month' || listingAge.id === 'weeks_2_4')

  if (beforeOffer) {
    return [
      {
        tone: 'cordiale',
        text: `Ciao! Mi piace molto ${item}. Ti andrebbe bene ${price}? Se per te può andare ti invio subito l'offerta e completo l'acquisto. ${closing(sendAt)}`,
      },
      {
        tone: 'diretto',
        text: `Ciao! Ti propongo ${price} per ${item}. Se per te va bene ti invio subito l'offerta. Grazie!`,
      },
      {
        tone: 'impegno',
        text: `Ciao! ${isOld ? 'Ho visto che ' + item + ' è online da un po\': ' : ''}ti propongo ${price}. Se accetti ti invio l'offerta e completo subito l'acquisto, così puoi spedire appena ti è comodo. ${closing(sendAt)}`,
      },
      {
        tone: 'motivato',
        text: `Ciao! ${Item} mi interessa davvero: potrei arrivare a ${price}, che è il massimo del mio budget in questo momento. Se per te può andare ti invio subito l'offerta. ${closing(sendAt)}`,
      },
    ]
  }

  return [
    {
      tone: 'cordiale',
      text: `Ciao! Mi piace molto ${item} e ti ho appena inviato un'offerta di ${price}. Se per te può andare confermo subito, altrimenti dimmi pure la tua cifra. ${closing(sendAt)}`,
    },
    {
      tone: 'diretto',
      text: `Ciao! Ti ho inviato un'offerta di ${price} per ${item}. Se va bene per te completo subito l'acquisto. Grazie!`,
    },
    {
      tone: 'impegno',
      text: `Ciao! Ti ho appena inviato un'offerta di ${price} per ${item}. ${isOld ? 'Ho visto che è online da un po\': se' : 'Se'} accetti completo subito l'acquisto, così puoi spedire appena ti è comodo e senza altre trattative. ${closing(sendAt)}`,
    },
    {
      tone: 'motivato',
      text: `Ciao! ${Item} mi interessa davvero e ti ho inviato un'offerta di ${price}: è il massimo del mio budget in questo momento. Se per te può andare completo subito l'acquisto. ${closing(sendAt)}`,
    },
  ]
}
