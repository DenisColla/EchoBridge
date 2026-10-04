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

export function buildMessages({ itemTitle, targetPrice, listingAge, sendAt }) {
  const item = itemTitle && itemTitle.trim() ? `"${itemTitle.trim()}"` : "l'articolo"
  const price = formatEuro(targetPrice)
  const isOld = listingAge && (listingAge.id === 'over_month' || listingAge.id === 'weeks_2_4')

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
      text: `Ciao! ${item === "l'articolo" ? "L'articolo" : item} mi interessa davvero e ti ho inviato un'offerta di ${price}: è il massimo del mio budget in questo momento. Se per te può andare completo subito l'acquisto. ${closing(sendAt)}`,
    },
  ]
}
