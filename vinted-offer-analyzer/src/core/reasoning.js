import { VINTED } from './constants.js'
import { calendarDaysBetween, capitalize, formatLongDate, formatRelativeDay, formatTime, isItalianHoliday } from './dates.js'

const roundPct = (v) => Math.round(v)

/** Italian partitive article before a number: "dell'8%", "dell'11%", "dell'80%", otherwise "del 25%". */
export const articleFor = (n) => {
  const r = Math.round(n)
  return r === 1 || r === 8 || r === 11 || (r >= 80 && r <= 89) ? "dell'" : 'del '
}

const dayPart = (date) => {
  const hour = date.getHours()
  if (hour >= 17) return 'sera'
  if (hour < 12) return 'mattina'
  return 'pomeriggio'
}

/**
 * The verdict sentence, with a fixed grammar by distance in days:
 * now → "adesso", today → "stasera/oggi alle ore", tomorrow → "domani sera, lunedì 5 ottobre, alle ore",
 * later → "giovedì 29 ottobre alle ore 21:45" + "tra 5 giorni".
 */
export function buildVerdict(chosen, sendNow, now) {
  const k = calendarDaysBetween(now, chosen.date)
  const time = formatTime(chosen.date)
  const dateLabel = formatLongDate(chosen.date, now)
  const window = chosen.score.timeWindow
  const windowLabel = window.range ? `tra le ${window.range.replace('–', ' e le ')}, ideale ${time}` : `alle ${time}`
  const expiresLabel = `${formatLongDate(chosen.expiresAt, now)} alle ${formatTime(chosen.expiresAt)}`

  let headline
  let sublabel
  if (chosen.kind === 'now') {
    headline = "Invia l'offerta adesso"
    sublabel = window.weight > 0
      ? `Sei nella finestra giusta: dura fino alle ${formatTime(sendNow.windowEndsAt)}`
      : 'Aspettare non migliorerebbe le probabilità'
  } else if (k === 0) {
    headline = `Invia l'offerta ${chosen.date.getHours() >= 17 ? 'stasera' : 'oggi'} alle ore ${time}`
    sublabel = capitalize(dateLabel)
  } else if (k === 1) {
    headline = `Invia l'offerta domani ${dayPart(chosen.date)}, ${dateLabel}, alle ore ${time}`
    sublabel = 'Domani'
  } else {
    headline = `Invia l'offerta ${dateLabel} alle ore ${time}`
    sublabel = capitalize(formatRelativeDay(chosen.date, now))
  }

  return { headline, sublabel, when: formatRelativeDay(chosen.date, now), dateLabel, timeLabel: time, windowLabel, expiresLabel, isHoliday: isItalianHoliday(chosen.date) }
}

/** Opening sentence keyed by risk band. */
export function openingSentence(input) {
  const d = roundPct(input.discountPct)
  const art = articleFor(d)
  if (input.riskBand.id === 'low') return `Sconto contenuto ${art}${d}%: quasi ogni fascia serale funziona, quindi conta soprattutto la rapidità.`
  if (input.riskBand.id === 'medium') return `Sconto ${art}${d}%, zona negoziabile: serve un momento in cui il venditore è rilassato e poco difensivo.`
  return `Sconto aggressivo ${art}${d}%: serve tempismo perfetto, con la minima resistenza possibile da parte del venditore.`
}

/**
 * Up to three complete sentences explaining the biggest drivers of the chosen moment.
 */
export function buildReasons(input, chosen, attribution) {
  const { category, listingAge, sellerProfile, listingSignal, listPrice, targetPrice } = input
  const k = chosen.daysWaited
  const sentences = []
  const rows = [...attribution.rows].sort((a, b) => Math.abs(b.deltaPoints) - Math.abs(a.deltaPoints))

  for (const row of rows) {
    if (sentences.length >= 3) break
    const positive = row.deltaPoints > 0
    let text = null
    switch (row.id) {
      case 'time':
        text = chosen.score.timeWindow.why
        break
      case 'month':
        if (row.weight > 0) text = chosen.score.monthWindow.why
        else if (row.weight < 0) text = 'Siamo a inizio mese, quando il venditore è meno pressato: per questo non conviene rinviare oltre.'
        break
      case 'age':
        if (listingAge.id === 'today') text = 'L\'annuncio è appena stato pubblicato: il venditore è ancora ottimista sul prezzo.'
        else if (positive) text = `L'annuncio è online ${listingAge.label.toLowerCase().replace(' fa', '')}: il venditore vuole liberarsi dell'invenduto e la finestra ottimale si anticipa.`
        else if (row.weight < 0) text = 'L\'annuncio è recente: il venditore non ha ancora motivo di cedere sul prezzo.'
        break
      case 'wait':
        if (positive && k >= 2) text = `Aspettare ${k} giorni lascia sgonfiare l'ottimismo iniziale del venditore.`
        break
      case 'category':
        if (!category) break
        if (category.disposable) text = `${category.label} è una categoria ad alta rotazione: il venditore vuole liberarsi del capo, ma l'articolo può sparire in fretta.`
        else if (category.premium) text = `${category.label}: il venditore conosce il valore di ciò che vende e negozia lentamente.`
        else if (category.id === 'electronics') text = 'Elettronica: il venditore confronta con il prezzo del nuovo e cede poco.'
        break
      case 'interaction':
        if (row.weight < 0) text = 'Su una categoria di valore uno sconto così alto viene letto come un affronto.'
        else if (row.weight > 0) text = 'In questa categoria anche uno sconto alto viene preso in considerazione.'
        break
      case 'gap':
        if (positive) text = `In euro chiedi solo ${Math.round(listPrice - targetPrice)} € in meno: per il venditore pesa poco.`
        else if (row.weight < 0) text = `In euro la differenza è di ${Math.round(listPrice - targetPrice)} €: il venditore ragiona anche in valore assoluto.`
        break
      case 'signal':
        if (listingSignal.id === 'fixed_price') text = 'L\'annuncio dice "prezzo non trattabile": ogni offerta parte in salita.'
        else if (listingSignal.id === 'open_to_offers') text = 'L\'annuncio invita a fare offerte: il venditore si aspetta una trattativa.'
        else if (listingSignal.id === 'clearing_out') text = 'Il venditore sta svuotando l\'armadio e vuole chiudere in fretta.'
        break
      case 'seller':
        if (sellerProfile === 'new_seller') text = 'Un venditore nuovo vuole le prime recensioni e accetta più volentieri, ma può reagire d\'impulso.'
        else if (sellerProfile === 'expert') text = positive ? 'Un venditore esperto chiude volentieri gli sconti ragionevoli.' : 'Un venditore esperto conosce il mercato e rifiuta gli sconti aggressivi.'
        else if (sellerProfile === 'inactive') text = 'Il venditore è inattivo: la priorità è farsi leggere, più del tempismo perfetto.'
        break
      default:
        break
    }
    if (text && !sentences.includes(text)) sentences.push(text)
  }
  if (sellerProfile === 'inactive' && !sentences.some((s) => s.startsWith('Il venditore è inattivo'))) {
    sentences.splice(Math.min(2, sentences.length), 0, 'Il venditore è inattivo: la priorità è farsi leggere, più del tempismo perfetto.')
  }
  return sentences.slice(0, 3)
}

export function buildTips({ input, moments, blockRisk, twoStep, chosen, now }) {
  const tips = []
  const { riskBand, discountPct, sellerProfile, listingAge, targetPrice } = input

  tips.push(`L'offerta resta valida circa ${VINTED.OFFER_VALIDITY_HOURS} ore e Vinted consente al massimo ${VINTED.OFFERS_PER_DAY} offerte al giorno: usa la prima nel momento giusto.`)
  if (!moments.timingMatters) {
    tips.push(`Qui il tempismo pesa poco (circa ${Math.max(1, Math.round(moments.spread * 100))} punti tra le finestre migliori): la prima buona fascia serale va bene.`)
  }
  if (discountPct < 5) {
    tips.push('Sconto quasi simbolico: valuta di comprare a prezzo pieno o di chiedere la spedizione inclusa invece di un\'offerta.')
  }
  if (twoStep) {
    tips.push(`Strategia a due step: apri a ${twoStep.openingPrice} €, lascia che il venditore controproponga e chiudi intorno a ${Math.round(targetPrice)} €.`)
  }
  if (blockRisk.level === 'high') {
    tips.push('Rischio di reazione brusca alto: manda prima un messaggio cordiale, poi l\'offerta.')
  }
  if (sellerProfile === 'inactive') {
    tips.push('Prima dell\'offerta scrivi un messaggio breve: i messaggi non scadono e ti dicono se il venditore è ancora attivo.')
  } else if (listingAge.days >= 7 && chosen.daysWaited >= 1) {
    tips.push('Metti subito il like: molti venditori inviano uno sconto spontaneo ai follower entro 48–72 ore.')
  }
  if (targetPrice >= 10 && Number.isInteger(targetPrice) && targetPrice % 5 === 0 && riskBand.id !== 'low') {
    tips.push(`Un importo preciso (ad esempio ${targetPrice - 1} € invece di ${targetPrice} €) sembra più ragionato e viene contro-rilanciato meno.`)
  }
  if (now.getMonth() === 7 && now.getDate() <= 25) {
    tips.push('Siamo in piena estate: controlla che il venditore non sia in modalità vacanza prima di inviare.')
  }
  return tips
}
