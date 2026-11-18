/**
 * The two modes that work beside the manual one (1.14), as pure rules:
 *
 * - «caccia» (semi-automatic): a search page is read again and again for HUNT_HOURS; the articles within the user's
 *   highest price (plus a tolerance for the really good ones) are ranked, an exceptional one is told at once, and at
 *   the end the best is proposed — the user sends heart, message and offer with one tap, never the app by itself;
 * - «vetrina» (automatic): the user's Vinted home is read again for FEED_HOURS and what passed there is ranked.
 *
 * The page is read again after a time drawn anew each time between REFRESH_MIN_S and REFRESH_MAX_S (the user's rule:
 * any minute and second from 8:00 to 12:00). Nothing here imitates a person or works around a check: when Vinted
 * asks for a verification the job stops and says so.
 *
 *   nextRefreshDelayMs(random)          → milliseconds until the next reading
 *   toleranceFor(signals)               → 0 | 10 | 15 (% above the highest price)
 *   cardsFromHtml(html)                 → the cards of a downloaded page, from its own markup
 *   findFromCard(card, origin)          → what a card says of an article
 *   mergeFinds(finds, cards, { at })    → { finds, fresh } (one entry per article, price drops kept)
 *   rankFinds(finds, job)               → the list as shown, best first
 *   jobEndsAt(job) · jobActive(job, now)
 */
import { decodeEntities } from './extract.js'
import { cardFactsOf, cardPriceOf, conditionBandOf } from './productMarket.js'

export const WATCH = Object.freeze({
  REFRESH_MIN_S: 8 * 60,
  REFRESH_MAX_S: 12 * 60,
  FEED_HOURS: 8,
  HUNT_HOURS: 24,
  /** At or below this share of the highest price an article is told at once, without waiting for the end. */
  EXCEPTIONAL_SHARE: 0.7,
  MAX_FINDS: 400,
  /** Really good: two of the four signals let the price rise 10%, three or more 15% (the user's rule). */
  TOLERANCE_TWO: 10,
  TOLERANCE_THREE: 15,
  /** «Novità» (1.20): how many of the user's searches are read in turn, and how many of the newest listings of
   *  each page are kept at a reading (what is fresh is at the top; the rest was there before). */
  ROTATION_MAX: 6,
  ROTATION_TAKE: 40,
})

const wtR2 = (v) => Math.round(v * 100) / 100
const wtFinite = (v) => typeof v === 'number' && Number.isFinite(v)
/** The interest score of a find (interest.js), −1 when it has none: scored finds come before the others. */
const wtScore = (f) => (f.score && wtFinite(f.score.total) ? f.score.total : -1)

/** The wait before the next reading: a whole number of seconds drawn between 8:00 and 12:00, anew each time. */
export function nextRefreshDelayMs(random = Math.random) {
  const span = WATCH.REFRESH_MAX_S - WATCH.REFRESH_MIN_S + 1
  const r = Number(random())
  return (WATCH.REFRESH_MIN_S + Math.min(span - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * span)))) * 1000
}

/**
 * The searches «novità» reads in turn, each from its newest listing: one for each of the user's words (brands,
 * authors, phrases), the first ROTATION_MAX. → [{ label, url }]. What is new on Vinted shows first in a search by
 * date, long before the home proposes it — if it ever does.
 */
export function sourcesFor(words, origin = 'https://www.vinted.it') {
  const base = String(origin).replace(/\/+$/, '')
  const seen = new Set()
  const out = []
  for (const raw of Array.isArray(words) ? words : []) {
    const label = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (label.length < 2 || seen.has(label.toLowerCase())) continue
    seen.add(label.toLowerCase())
    out.push({ label, url: `${base}/catalog?search_text=${encodeURIComponent(label)}&order=newest_first` })
    if (out.length >= WATCH.ROTATION_MAX) break
  }
  return out
}

/**
 * How far above the highest price a really good article may go. Signals: `isNew` (new where used was accepted too),
 * `solidSeller` (many reviews, high rating), `underMarket` (still under the market's lower quartile), `fullMatch`
 * (size, colour and version exactly as asked). Unknown counts as no.
 */
export function toleranceFor(signals) {
  const s = signals && typeof signals === 'object' ? signals : {}
  const count = ['isNew', 'solidSeller', 'underMarket', 'fullMatch'].filter((k) => s[k] === true).length
  return count >= 3 ? WATCH.TOLERANCE_THREE : count === 2 ? WATCH.TOLERANCE_TWO : 0
}

/**
 * The hearts a card shows. After the card's description («…, 28.00 €, 30.10 €», on the home followed by «Include la
 * commissione Vinted») its visible text begins with an optional badge and the count («Ricercato 23 DEKKER M ·
 * Ottime…», «3 H&M M ·…», «1 Domyos Ottime 24,00 €»): the last such number, else null. A reading of the page that
 * found the heart button itself (`card.hearts`) is preferred to this.
 */
export function favouritesOfCard(text) {
  let last = null
  const re = /\d+\.\d{2}\s?€\s+(?:include\s+la\s+(?:commissione\s+vinted|protezione\s+acquisti)\s+)?(?:[A-Za-zÀ-ÿ]+\s+)?(\d{1,5})\s+[^\d\s]/gi
  for (const m of String(text || '').matchAll(re)) last = Number(m[1])
  return last
}

/**
 * The cards of a page downloaded without a browser, from its own markup: every link to an article that carries the
 * description («titolo, brand: X, condizioni: Y, 24.00 €, 25.90 € …») in its `title`, and the hearts of the button
 * that follows it. The same shape the in-app reader gives: { id, price, text, hearts }.
 */
export function cardsFromHtml(html, limit = 120) {
  const src = String(html || '')
  const out = []
  const seen = new Set()
  const tags = /<a\b[^>]*>/gi
  let m
  while ((m = tags.exec(src)) && out.length < limit) {
    const tag = m[0]
    const id = (tag.match(/\bhref="[^"]*\/items\/(\d{6,})/) || [])[1]
    const title = (tag.match(/\btitle="([^"]*)"/) || [])[1]
    if (!id || !title || seen.has(id)) continue
    const text = decodeEntities(title).replace(/\s+/g, ' ').trim()
    const price = (text.match(/(\d+(?:[.,]\d{2})?)\s?€/) || [])[1] || null
    if (!price) continue
    seen.add(id)
    // What belongs to this card: up to the next link to another article.
    const tail = src.slice(m.index + tag.length, m.index + tag.length + 4000)
    const next = tail.search(/<a\b[^>]*\/items\/\d{6,}/i)
    const own = next >= 0 ? tail.slice(0, next) : tail
    const hearts = own.match(/preferiti da\s*(\d+)/i)
    out.push({ id, price, text: text.slice(0, 300), hearts: hearts ? Number(hearts[1]) : /favourite/i.test(own) ? 0 : null, boost: /bump-text/i.test(own) })
  }
  return out
}

/**
 * What a card says of an article: { id, title, brand, condition, band, size, price, favourites, boost, url }, or
 * null. A card is what the in-app reader or cardsFromHtml give ({ id, price, text, hearts }), or an entry of the
 * search page's own data (catalog.js: { source: 'vinted', id, title, price, brand, size, condition, favourites,
 * promoted, url }).
 */
export function findFromCard(card, origin = 'https://www.vinted.it') {
  if (!card || card.id === undefined || card.id === null) return null
  const base = String(origin).replace(/\/+$/, '')
  if (card.source === 'vinted' && typeof card.title === 'string') {
    const amount = cardPriceOf(card.price)
    if (amount === null) return null
    return {
      // An article without a brand carries its title in the brand's place: that is no brand.
      id: String(card.id), title: card.title, brand: card.brand && card.brand !== card.title ? card.brand : null, condition: card.condition || null, band: conditionBandOf(card.condition),
      size: card.size || null, price: amount, favourites: wtFinite(card.favourites) ? card.favourites : null, boost: card.promoted === true,
      url: typeof card.url === 'string' && card.url ? card.url : `${base}/items/${card.id}`,
    }
  }
  const price = cardPriceOf(card.price)
  if (price === null) return null
  const said = cardFactsOf(card.text)
  return {
    id: String(card.id), title: said.title || '', brand: said.brand || null, condition: said.condition || null, band: conditionBandOf(said.condition),
    size: said.size || null, price, favourites: wtFinite(card.hearts) ? card.hearts : favouritesOfCard(card.text),
    boost: card.boost === true || /\bcon boost\b/i.test(String(card.text || '')), url: `${base}/items/${card.id}`,
  }
}

/**
 * Adds the cards of one reading to what was found so far. One entry per article: when it was first and last seen,
 * how many times, and the price it had when first seen if it has dropped since (`was`). `fresh`: the ids new now.
 * `from`: where this reading read (the home, one of the searches): kept on what is new, for the report by source.
 */
export function mergeFinds(finds, cards, { at = Date.now(), source = 'read', origin = 'https://www.vinted.it', from = null } = {}) {
  const byId = new Map((Array.isArray(finds) ? finds : []).filter((f) => f && f.id).map((f) => [String(f.id), f]))
  const fresh = []
  for (const card of Array.isArray(cards) ? cards : []) {
    const found = findFromCard(card, origin)
    if (!found) continue
    const old = byId.get(found.id)
    if (!old) {
      byId.set(found.id, { ...found, firstSeen: at, lastSeen: at, seen: 1, source, ...(from ? { from } : {}), heartsAtFirst: found.favourites ?? null })
      fresh.push(found.id)
      continue
    }
    const was = found.price < old.price - 0.004 ? (wtFinite(old.was) ? Math.max(old.was, old.price) : old.price) : old.was
    byId.set(found.id, { ...old, ...found, favourites: found.favourites ?? old.favourites ?? null, was: was ?? null, lastSeen: at, seen: (old.seen || 1) + 1 })
  }
  // When the list is full the best scored stay (1.18), then the newest.
  const kept = (f) => (f.score && wtFinite(f.score.total) ? f.score.total : 50)
  const all = [...byId.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, WATCH.MAX_FINDS * 2).sort((a, b) => kept(b) - kept(a) || b.lastSeen - a.lastSeen).slice(0, WATCH.MAX_FINDS)
  return { finds: all, fresh }
}

/**
 * How each source did (1.20): [{ fonte, articoli, da_55, da_70, sponsorizzati, cuori_mediani, non_in_vendita }], the
 * richest in articles from `showMin` first (those still on sale: what was gone when read is counted apart). To see where reading pays: the home, or which of the searches.
 */
export function sourceReport(finds, { showMin = 55, tellMin = 70 } = {}) {
  const groups = new Map()
  for (const f of Array.isArray(finds) ? finds : []) {
    if (!f) continue
    const key = f.from || (f.source === 'hunt' ? 'caccia' : f.source === 'feed' ? 'home' : f.source || 'altro')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(f)
  }
  const median = (values) => {
    const sorted = values.filter(wtFinite).sort((a, b) => a - b)
    return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null
  }
  return [...groups.entries()].map(([fonte, rows]) => ({
    fonte, articoli: rows.length,
    da_55: rows.filter((f) => !f.gone && wtScore(f) >= showMin).length, da_70: rows.filter((f) => !f.gone && wtScore(f) >= tellMin).length,
    sponsorizzati: rows.filter((f) => f.boost === true).length, cuori_mediani: median(rows.map((f) => f.favourites)),
    non_in_vendita: rows.filter((f) => Boolean(f.gone)).length,
  })).sort((a, b) => b.da_55 - a.da_55 || b.articoli - a.articoli)
}

/**
 * Which article of the waiting list a notification of Vinted's speaks of (1.20). `text`: its title and body;
 * `waits`: [{ id, title }]. → { id, price } when the text carries most of the words of one title (`price`: the
 * amount in the text, or null) · { all: true } when it names none but speaks of a price or an offer · null.
 */
export function waitMatchOf(text, waits) {
  const words = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
  const said = new Set(words(text))
  if (!said.size) return null
  let best = null
  for (const w of Array.isArray(waits) ? waits : []) {
    const title = [...new Set(words(w && w.title))].slice(0, 8)
    if (!title.length) continue
    const hits = title.filter((x) => said.has(x)).length
    const share = hits / title.length
    // Most of the title, and two words at least (one, when the title is one long word).
    if (share < 0.6 || (hits < 2 && !(title.length === 1 && title[0].length >= 5))) continue
    if (!best || share > best.share || (share === best.share && hits > best.hits)) best = { id: w.id, share, hits }
  }
  const amount = String(text || '').match(/(\d{1,5}(?:[.,]\d{1,2})?)\s*€/) || String(text || '').match(/€\s*(\d{1,5}(?:[.,]\d{1,2})?)/)
  const price = amount ? Number(amount[1].replace(',', '.')) : null
  if (best) return { id: best.id, price: Number.isFinite(price) && price > 0 ? price : null }
  return /prezz|scont|ribass|ridott|offert/i.test(String(text || '')) ? { all: true } : null
}

/** When a job ends (ms), and whether it is still running. */
export const jobEndsAt = (job) => (job && wtFinite(job.startedAt) ? job.startedAt + (wtFinite(job.hours) ? job.hours : job.kind === 'hunt' ? WATCH.HUNT_HOURS : WATCH.FEED_HOURS) * 3_600_000 : null)
export const jobActive = (job, now = Date.now()) => Boolean(job && !job.stopped && jobEndsAt(job) !== null && now < jobEndsAt(job))

/**
 * The finds as shown, best first.
 * Hunt (`job.kind` 'hunt', `job.maxPrice`): only what was seen by this job; an article is `eligible` within the
 * highest price plus its tolerance, `exceptional` at or below EXCEPTIONAL_SHARE of it; among the eligible the best
 * interest score first (1.18), then the cheapest.
 * Feed: the best interest score first; without scores the most wanted (hearts), then the price drops, then the newest.
 */
export function rankFinds(finds, job = null) {
  const list = (Array.isArray(finds) ? finds : []).filter((f) => f && wtFinite(f.price))
  if (job && job.kind === 'hunt') {
    const max = wtFinite(job.maxPrice) && job.maxPrice > 0 ? job.maxPrice : null
    const wantSize = job.size ? String(job.size).toLowerCase().replace(/\s+/g, '') : null
    return list.filter((f) => !wtFinite(job.startedAt) || f.lastSeen >= job.startedAt).map((f) => {
      // 1.18: with the AI's card «the product searched» is known, and with a reference read from the market «still
      // under the market» is too. Without them the size asked for is the only match a card can show.
      const sizeOk = Boolean(wantSize && f.size && String(f.size).toLowerCase().replace(/\s+/g, '') === wantSize)
      const matched = f.card && f.card.match ? f.card.match === 'si' && (!wantSize || sizeOk) : sizeOk
      const signals = {
        isNew: f.band === 'new' && job.band !== 'new',
        fullMatch: matched,
        solidSeller: f.solidSeller === true,
        underMarket: f.underMarket === true || Boolean(f.ref && f.ref.source === 'market' && wtFinite(f.ref.value) && f.price <= f.ref.value),
      }
      const tolerancePct = toleranceFor(signals)
      const limit = max === null ? null : wtR2(max * (1 + tolerancePct / 100))
      return { ...f, tolerancePct, limit, eligible: limit === null || f.price <= limit + 1e-9, exceptional: max !== null && f.price <= max * WATCH.EXCEPTIONAL_SHARE + 1e-9 }
    }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || wtScore(b) - wtScore(a) || a.price - b.price || b.lastSeen - a.lastSeen)
  }
  return list.map((f) => ({ ...f, dropped: wtFinite(f.was) && f.was > f.price ? wtR2(f.was - f.price) : 0 }))
    .sort((a, b) => wtScore(b) - wtScore(a) || (b.favourites || 0) - (a.favourites || 0) || b.dropped - a.dropped || b.lastSeen - a.lastSeen)
}

/* ───────── which searches to follow (1.21) ─────────
 * «Novità» reads the user's own searches: what they bring depends on how they are worded. A search that names only
 * a kind of thing («maglia», «dischi 10 kg») brings hundreds of listings with no resale value to compare with; a
 * brand, an author or a model brings fewer, and comparable. The first diary of «novità» (18 November 2026): two
 * searches of the first kind gave 0 articles from 55 out of 151, the third gave the two that were bought.
 */

/** Words that say what kind of thing it is, its colour, size or state — not which one. */
const WT_GENERIC = new Set(('maglia maglie maglietta magliette maglione maglioni felpa felpe giacca giacche giubbotto giubbotti cappotto cappotti piumino piumini pantalone pantaloni jeans gonna gonne vestito vestiti abito abiti camicia camicie '
  + 'scarpa scarpe stivale stivali sneakers sandali borsa borse zaino zaini cintura cinture cappello cappelli sciarpa sciarpe costume costumi tuta tute pigiama intimo calze guanti occhiali '
  + 'libro libri fumetto fumetti manga dvd cd vinile vinili disco dischi gioco giochi videogioco videogiochi rivista riviste romanzo romanzi '
  + 'telefono telefoni cellulare cellulari smartphone tablet cuffie auricolari console computer pc portatile tv televisore orologio orologi fotocamera cover custodia caricatore cavo '
  + 'peso pesi manubrio manubri bilanciere panca bici bicicletta casco tenda lampada tazza tazze piatto piatti giocattolo giocattoli peluche bambola bambole puzzle carte quadro quadri '
  + 'nero nera neri nere bianco bianca bianchi bianche rosso rossa blu verde giallo gialla grigio grigia rosa marrone beige azzurro viola arancione '
  + 'uomo donna bambino bambina bambini unisex ragazzo ragazza neonato '
  + 'nuovo nuova nuovi nuove usato usata usati usate vintage originale originali lotto stock set kit pezzi pezzo taglia misura '
  + 'xs s m l xl xxl xxxl kg g gr cm mm lt ml pz').split(' '))
const WT_STOP = new Set('di da per con in su sotto sopra e ed il lo la i gli le un una uno a al alla allo ai del della dello dei delle degli tra fra o'.split(' '))
const wtWords = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9']+/).map((w) => w.replace(/^'+|'+$/g, '')).filter((w) => w && !WT_STOP.has(w))
const wtKindOnly = (w) => WT_GENERIC.has(w) || /^\d+([.,]\d+)?(kg|g|gr|cm|mm|lt|l|ml|pz)?$/.test(w)
const wtKey = (label) => String(label || '').replace(/\s+/g, ' ').trim().toLowerCase()

export const SEARCHES = Object.freeze({
  /** Fewer articles read than this say nothing yet about a search. */
  YIELD_MIN: 60,
  /** Under this share from the list's threshold, and none worth a notification, a search brings little. */
  YIELD_POOR: 0.03,
  /** More words than this make a search of one thing only. */
  WORDS_MAX: 5,
})

/**
 * How a search to follow is worded, before it runs: { kind, text } or null when there is nothing to say.
 * 'generica': it names only a kind of thing; 'lunga': so many words that it is one article, not a search.
 */
export function searchAdviceOf(text) {
  const words = wtWords(text)
  if (!words.length) return null
  if (words.every(wtKindOnly)) return { kind: 'generica', text: 'Dice solo che tipo di oggetto è: aggiungi una marca, un autore o un modello, altrimenti non c\'è un prezzo di rivendita con cui confrontare.' }
  if (words.length > SEARCHES.WORDS_MAX) return { kind: 'lunga', text: 'Molto precisa: usciranno pochi annunci nuovi. Per un articolo solo c\'è «Un articolo».' }
  return null
}

/**
 * What each search followed brought: { [search, lower case]: { articoli, da_55, da_70, lavori } }. `history`: the
 * summaries of the jobs that ended (endJob: `resa` is sourceReport of what that job read); `live`: sourceReport of
 * the job that is running, or null. The home and a hunt are not searches to follow.
 */
export function searchYields(history, live = null) {
  const out = {}
  const add = (rows, jobs) => {
    for (const r of Array.isArray(rows) ? rows : []) {
      const key = r ? wtKey(r.fonte) : ''
      if (!key || key === 'home' || key === 'caccia' || key === 'altro' || key === 'feed' || key === 'hunt') continue
      const now = out[key] || { articoli: 0, da_55: 0, da_70: 0, lavori: 0 }
      out[key] = { articoli: now.articoli + (wtFinite(r.articoli) ? r.articoli : 0), da_55: now.da_55 + (wtFinite(r.da_55) ? r.da_55 : 0), da_70: now.da_70 + (wtFinite(r.da_70) ? r.da_70 : 0), lavori: now.lavori + jobs }
    }
  }
  for (const h of Array.isArray(history) ? history : []) if (h && h.tipo !== 'hunt') add(h.resa, 1)
  add(live, 1)
  return out
}

/** A search's yield in a word: 'buona' | 'scarsa' | 'nulla', or null when too little was read to say. */
export function yieldVerdictOf(y) {
  if (!y || !wtFinite(y.articoli) || y.articoli < SEARCHES.YIELD_MIN) return null
  if (!y.da_55) return 'nulla'
  return !y.da_70 && y.da_55 / y.articoli < SEARCHES.YIELD_POOR ? 'scarsa' : 'buona'
}

/**
 * The line under a search followed: what it brought and what to do with it. → { text, tone, verdict } with tone
 * 'good' | 'warn' | 'neutral'. `y`: its entry in searchYields, or nothing when it never ran.
 */
export function searchLineOf(label, y = null, { showMin = 55, tellMin = 70 } = {}) {
  const advice = searchAdviceOf(label)
  const verdict = yieldVerdictOf(y)
  const count = y && y.articoli ? `${y.da_55} da ${showMin} su ${y.articoli} letti${y.da_70 ? ` (${y.da_70} da ${tellMin})` : ''}` : null
  if (verdict === 'buona') return { text: `${count}: rende, tienila`, tone: 'good', verdict }
  if (verdict === 'nulla') return { text: `${count}: non rende. ${advice ? 'Nomina solo un tipo di oggetto: metti marca, autore o modello.' : 'Cambiala, o stringila su un modello.'}`, tone: 'warn', verdict }
  if (verdict === 'scarsa') return { text: `${count}: rende poco${advice && advice.kind === 'generica' ? ', è troppo generica' : ''}`, tone: 'warn', verdict }
  if (advice) return { text: `${count ? `${count}. ` : ''}${advice.kind === 'generica' ? 'Nomina solo un tipo di oggetto: metti marca, autore o modello.' : 'Molto precisa: pochi annunci nuovi.'}`, tone: 'warn', verdict }
  return { text: count ? `${count}: ancora poco per dirlo` : 'Mai provata', tone: 'neutral', verdict }
}

const WT_NO_BRAND = /^(n\.?d\.?|nessun[ao]?|senza marca|altro|non specificat[oa]|sconosciut[oa]|generic[oa]|vari[e]?|-+)$/i
const WT_BY_MODEL = ['telefoni', 'console_giochi', 'audio', 'informatica', 'elettronica', 'abbigliamento', 'scarpe']

/**
 * Searches worth following that the user does not follow yet: [{ label, why }], the first `max`.
 * - one that paid in a past job and is not followed any more;
 * - the brand (the author, for books and comics) of what he liked: a thumb up, a score of his own or of the engine
 *   from `tellMin`. Where a brand alone is too wide (phones, clothes) the model goes with it;
 * - a brand that took two thumbs up more than down.
 * Nothing that names only a kind of thing, and nothing that a followed search already covers.
 */
export function searchIdeasOf({ finds = [], waits = [], likes = null, history = [], following = [], tellMin = 70, max = 5 } = {}) {
  const taken = (Array.isArray(following) ? following : []).map(wtKey).filter(Boolean)
  const out = []
  const offer = (raw, why) => {
    const label = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 60)
    const key = wtKey(label)
    if (key.length < 3 || WT_NO_BRAND.test(key) || searchAdviceOf(label)) return
    // A followed search that is wider covers it; one that is narrower («will eisner contratto con dio») does not.
    if (taken.some((w) => ` ${key} `.includes(` ${w} `)) || out.some((o) => wtKey(o.label) === key)) return
    out.push({ label, why })
  }
  const yields = searchYields(history)
  for (const [key, y] of Object.entries(yields).sort((a, b) => b[1].da_55 - a[1].da_55)) {
    if (yieldVerdictOf(y) === 'buona') offer(key, `ha già reso ${y.da_55} da 55 su ${y.articoli}`)
  }
  const liked = [...(Array.isArray(finds) ? finds : []), ...(Array.isArray(waits) ? waits : [])]
    .filter((f) => f && !f.gone && f.vote !== -1 && (f.vote === 1 || (wtFinite(f.rated) && f.rated >= tellMin) || wtScore(f) >= tellMin))
    .sort((a, b) => Number(b.vote === 1) - Number(a.vote === 1) || wtScore(b) - wtScore(a))
  for (const f of liked) {
    const card = f.card || {}
    const brand = String(card.brand || f.brand || '').trim()
    if (!brand) continue
    const model = String(card.model || '').trim()
    const title = String(f.title || '').slice(0, 30)
    offer(WT_BY_MODEL.includes(card.category) && model && model.split(/\s+/).length <= 3 ? `${brand} ${model}` : brand, f.vote === 1 ? `il tuo pollice su «${title}»` : `«${title}» ha preso ${wtScore(f)}`)
  }
  for (const [key, n] of Object.entries(likes && typeof likes === 'object' ? likes : {}).sort((a, b) => b[1] - a[1])) {
    if (key.startsWith('brand:') && n >= 2) offer(key.slice(6), `${n} pollici in su`)
  }
  return out.slice(0, Math.max(0, max))
}
