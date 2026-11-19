import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  WATCH, cardsFromHtml, detectVintedChallenge, detectVintedSessionRefresh, favouritesOfCard, findFromCard, jobActive, jobEndsAt, mergeFinds, nextRefreshDelayMs, parseVintedCatalog,
  homeYield, rankFinds, searchAdviceOf, searchIdeasOf, searchLineOf, searchYields, sourceReport, sourcesFor, toleranceFor, waitMatchOf, yieldVerdictOf,
} from '../src/core/index.js'

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

test('watch: the next reading comes after any minute and second between 8:00 and 12:00, drawn anew each time', () => {
  assert.equal(nextRefreshDelayMs(() => 0), 8 * 60 * 1000)
  assert.equal(nextRefreshDelayMs(() => 0.999999), 12 * 60 * 1000)
  assert.equal(nextRefreshDelayMs(() => 1), 12 * 60 * 1000) // a generator that returns 1 does not go past the range
  assert.equal(nextRefreshDelayMs(() => NaN), 8 * 60 * 1000)
  // Not a fixed step: whole seconds, not whole minutes, and many different waits.
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const draws = Array.from({ length: 400 }, () => nextRefreshDelayMs(rnd))
  assert.ok(draws.every((d) => d >= 480_000 && d <= 720_000 && d % 1000 === 0))
  assert.ok(new Set(draws).size > 150)
  assert.ok(draws.some((d) => (d / 1000) % 60 !== 0))
})

test('watch: really good is two of the four signals (+10%) or three and more (+15%)', () => {
  assert.equal(toleranceFor({}), 0)
  assert.equal(toleranceFor({ isNew: true }), 0)
  assert.equal(toleranceFor({ isNew: true, fullMatch: true }), 10)
  assert.equal(toleranceFor({ isNew: true, fullMatch: true, solidSeller: true }), 15)
  assert.equal(toleranceFor({ isNew: true, fullMatch: true, solidSeller: true, underMarket: true }), 15)
  assert.equal(toleranceFor({ isNew: 'yes', fullMatch: 1 }), 0) // unknown is not yes
  assert.equal(toleranceFor(null), 0)
})

// Real card texts (reports of 16 Nov): the description twice, then the visible text with the hearts.
const COAT = 'Cappotto Dekker, Brand: DEKKER, Condizioni: Ottime, Taglia: M, 28.00 €, 30.10 € Cappotto Dekker, Brand: DEKKER, Condizioni: Ottime, Taglia: M, 28.00 €, 30.10 € Ricercato 23 DEKKER M · Ottime 28,00 € 3'
const TOP = 'Maglia manica lunga, Brand: H&M, Condizioni: Nuovo senza cartellino, Taglia: M, 5.00 €, 5.95 € Maglia manica lunga, Brand: H&M, Condizioni: Nuovo senza cartellino, Taglia: M, 5.00 €, 5.95 € 3 H&M M · '

test('watch: what a card says — title, price, condition, size and hearts', () => {
  assert.equal(favouritesOfCard(COAT), 23)
  assert.equal(favouritesOfCard(TOP), 3)
  assert.equal(favouritesOfCard('Libro, Condizioni: Ottime, 7.00 €, 8.05 €'), null)
  assert.deepEqual(findFromCard({ id: 8800000001, price: '28,00', text: COAT }), {
    id: '8800000001', title: 'Cappotto Dekker', brand: 'DEKKER', condition: 'Ottime', band: 'used', size: 'M', price: 28, favourites: 23, boost: false, url: 'https://www.vinted.it/items/8800000001',
  })
  assert.equal(findFromCard({ id: 1, price: null, text: COAT }), null)
})

test('watch: one entry per article across the readings, and a price that dropped is remembered', () => {
  const first = mergeFinds([], [{ id: 1, price: '28,00', text: COAT }, { id: 2, price: '5,00', text: TOP }], { at: 1000, source: 'home' })
  assert.deepEqual([first.finds.length, first.fresh], [2, ['1', '2']])
  const second = mergeFinds(first.finds, [{ id: 1, price: '24,00', text: COAT.replaceAll('28.00', '24.00') }, { id: 3, price: '9,00', text: 'Jeans, Brand: Levi\'s, Condizioni: Buone, Taglia: M, 9.00 €, 10.15 €' }], { at: 2000 })
  assert.deepEqual(second.fresh, ['3'])
  const coat = second.finds.find((f) => f.id === '1')
  assert.deepEqual([coat.price, coat.was, coat.seen, coat.firstSeen, coat.lastSeen, coat.source], [24, 28, 2, 1000, 2000, 'home'])
  // The article that was not on the page this time is kept as it was.
  assert.deepEqual([second.finds.find((f) => f.id === '2').seen, second.finds.find((f) => f.id === '2').lastSeen], [1, 1000])
  // The list has a size: the newest stay.
  const many = mergeFinds([], Array.from({ length: WATCH.MAX_FINDS + 20 }, (_, i) => ({ id: i + 1, price: 5, text: 'x, Condizioni: Ottime, 5.00 €' })), { at: 1 })
  assert.equal(many.finds.length, WATCH.MAX_FINDS)
})

test('watch: the hunt — within the highest price, a tolerance for the really good, the exceptional told at once', () => {
  const job = { kind: 'hunt', startedAt: 500, hours: 24, maxPrice: 20, size: 'M', band: 'used' }
  assert.equal(jobEndsAt(job), 500 + 24 * 3_600_000)
  assert.deepEqual([jobActive(job, 600), jobActive(job, 500 + 25 * 3_600_000), jobActive({ ...job, stopped: 'verifica' }, 600)], [true, false, false])
  const finds = mergeFinds([], [
    { id: 1, price: '21,50', text: 'Jeans 511, Brand: Levi\'s, Condizioni: Nuovo senza cartellino, Taglia: M, 21.50 €' }, // new and the size asked for: +10%
    { id: 2, price: '21,50', text: 'Jeans 511, Brand: Levi\'s, Condizioni: Ottime, Taglia: M, 21.50 €' }, // only the size: over
    { id: 3, price: '13,00', text: 'Jeans 511, Brand: Levi\'s, Condizioni: Buone, Taglia: L, 13.00 €' }, // 65% of the highest price
    { id: 4, price: '18,00', text: 'Jeans 511, Brand: Levi\'s, Condizioni: Ottime, Taglia: M, 18.00 €' },
  ], { at: 1000 }).finds
  const ranked = rankFinds([...finds, { id: '9', price: 5, lastSeen: 100 }], job)
  assert.deepEqual(ranked.map((f) => f.id), ['3', '4', '1', '2']) // the old find of another job is not shown
  assert.deepEqual(ranked.map((f) => [f.eligible, f.exceptional, f.tolerancePct, f.limit]), [[true, true, 0, 20], [true, false, 0, 20], [true, false, 10, 22], [false, false, 0, 20]])
  // With what the full analysis adds (a solid seller, still under the market) the same article may go 15% over.
  assert.deepEqual(rankFinds([{ ...finds.find((f) => f.id === '1'), price: 23, solidSeller: true }], job).map((f) => [f.tolerancePct, f.eligible]), [[15, true]])
})

test('watch: the feed — the most wanted first, then what dropped in price, then the newest', () => {
  const ranked = rankFinds([
    { id: 'a', price: 10, favourites: 2, lastSeen: 5 },
    { id: 'b', price: 8, was: 12, favourites: null, lastSeen: 1 },
    { id: 'c', price: 30, favourites: 23, lastSeen: 2 },
    { id: 'd', price: 4, favourites: null, lastSeen: 9 },
  ], { kind: 'feed', startedAt: 0 })
  assert.deepEqual(ranked.map((f) => [f.id, f.dropped]), [['c', 0], ['a', 0], ['b', 4], ['d', 0]])
})

test('watch: a card price is read with or without the euro sign', () => {
  const text = COAT
  assert.equal(findFromCard({ id: 1, price: '18,00 €', text }).price, 18)
  assert.equal(findFromCard({ id: 1, price: '1.150,00', text }).price, 1150)
  assert.equal(findFromCard({ id: 1, price: '€', text }), null)
})

// The home as the phone reads it (17 November 2026): «Include la commissione Vinted» after the prices, then the hearts.
const HOME = 'Manubri, brand: Domyos, condizioni: Ottime, 24.00 €, 25.90 € Include la commissione Vinted Manubri, brand: Domyos, condizioni: Ottime, 24.00 €, 25.90 € Include la commissione Vinted 1 Domyos Ottime 24,00 € 25,90 € incl.'

test('watch: a card of the home — hearts after «Include la commissione Vinted», and the heart button when it was read', () => {
  assert.equal(favouritesOfCard(HOME), 1)
  const said = findFromCard({ id: 8800000002, price: '24.00', text: HOME })
  assert.deepEqual([said.title, said.brand, said.condition, said.price, said.favourites, said.boost], ['Manubri', 'Domyos', 'Ottime', 24, 1, false])
  // the button read on the page wins over the text: a title beginning with a number is not a count of hearts
  const numbered = '3 libri Zerocalcare, condizioni: Ottime, 8.00 €, 9.10 € Include la commissione Vinted 3 libri Zerocalcare Con boost Ottime 8,00 €'
  assert.equal(findFromCard({ id: 2, price: '8.00', text: numbered, hearts: 0 }).favourites, 0)
  assert.equal(findFromCard({ id: 2, price: '8.00', text: numbered, hearts: 0 }).boost, true)
})

test('watch: an entry of the search page data becomes a find as it is', () => {
  const entry = { source: 'vinted', id: '10328455376', title: 'Nike air max moto 2k 40,5', url: 'https://www.vinted.it/items/10328455376-nike-air-max-moto-2k-405', price: 25, brand: 'Nike', size: '40,5', condition: 'Nuovo con cartellino', favourites: 15, promoted: true }
  assert.deepEqual(findFromCard(entry), {
    id: '10328455376', title: 'Nike air max moto 2k 40,5', brand: 'Nike', condition: 'Nuovo con cartellino', band: 'new', size: '40,5', price: 25, favourites: 15, boost: true,
    url: 'https://www.vinted.it/items/10328455376-nike-air-max-moto-2k-405',
  })
  assert.equal(findFromCard({ source: 'vinted', id: '7', title: 'Diamante azul - Care Santos', brand: 'Diamante azul - Care Santos', price: 1 }).brand, null)
  const { finds, fresh } = mergeFinds([], [entry, { source: 'vinted', id: '1', title: 'Senza prezzo', price: null }], { at: 10 })
  assert.deepEqual([finds.length, fresh], [1, ['10328455376']])
})

test('watch: the cards of a downloaded page, from its markup', () => {
  const html = `<div data-testid="feed-item"><a class="x" data-testid="feed-item--overlay-link" href="https://www.vinted.it/items/8800000011-seven-sons?referrer=homepage" title="Seven sons - Robert Windom, condizioni: Nuovo senza cartellino, 18.00 €, 19.60 € Include la commissione Vinted"></a>
    <button aria-label="Aggiungi ai preferiti. Aggiunto ai preferiti da 11" data-testid="feed-item--favourite"><span data-testid="favourite-count-text">11</span></button><p data-testid="feed-item--bump-text">Con boost</p></div>
    <div data-testid="feed-item"><a data-testid="feed-item--overlay-link" href="/items/8800000012-decathlon" title="Felpa &quot;basic&quot;, brand: H&amp;M, condizioni: Nuovo senza cartellino, taglia: M, 30.00 €, 32.20 € Include la commissione Vinted"></a>
    <button aria-label="Aggiungi ai preferiti" data-testid="feed-item--favourite"></button></div>
    <a href="/items/8800000011-seven-sons" title="doppione, 1.00 €"></a><a href="/member/12">profilo</a><a href="/items/8800000013-x">senza titolo</a>`
  const cards = cardsFromHtml(html)
  assert.deepEqual(cards.map((c) => [c.id, c.price, c.hearts, c.boost]), [['8800000011', '18.00', 11, true], ['8800000012', '30.00', 0, false]])
  const finds = cards.map((c) => findFromCard(c))
  assert.deepEqual(finds.map((f) => [f.title, f.brand, f.size, f.price, f.favourites]), [['Seven sons - Robert Windom', null, null, 18, 11], ['Felpa "basic"', 'H&M', 'M', 30, 0]])
  assert.deepEqual(cardsFromHtml(''), [])
})

test('watch: Vinted\'s «Session refresh» page is told apart from a check and from a page of results', () => {
  // The page a plain download got 43 times out of 48 in the night of 17 November 2026 (19 813 characters).
  const refresh = fixture('vinted-session-refresh-2026-11.html')
  assert.equal(detectVintedSessionRefresh(refresh), true)
  // It asks nothing of a person: not a check. And it carries no listing.
  assert.equal(detectVintedChallenge(refresh), null)
  assert.deepEqual([parseVintedCatalog(refresh).items.length, parseVintedCatalog(refresh).catalog, cardsFromHtml(refresh).length], [0, false, 0])
  const search = fixture('vinted-catalog-2026-10.html')
  assert.equal(detectVintedSessionRefresh(search), false)
  assert.equal(parseVintedCatalog(search).catalog, true)
  assert.equal(detectVintedSessionRefresh(''), false)
  assert.equal(detectVintedSessionRefresh('<html><head><title>Vinted | Tutta la seconda mano</title></head></html>'), false)
  // The title alone, or the page's own name in its data, is enough.
  assert.equal(detectVintedSessionRefresh('<title>Session refresh</title>'), true)
  assert.equal(detectVintedSessionRefresh('self.__next_f.push([1,"17:[\\"$\\",\\"$L1c\\",null,{\\"pageId\\":\\"session-refresh\\"}]"])'), true)
})

test('watch: «novità» reads the user\'s own searches, newest first, six at most', () => {
  const sources = sourcesFor(['Zerocalcare', '  chainsaw   man variant ', 'zerocalcare', 'x', '', null, 'Absolute DC', 'a1', 'b2', 'c3', 'd4'])
  assert.deepEqual(sources.map((x) => x.label), ['Zerocalcare', 'chainsaw man variant', 'Absolute DC', 'a1', 'b2', 'c3'])
  assert.equal(sources.length, WATCH.ROTATION_MAX)
  assert.equal(sources[1].url, 'https://www.vinted.it/catalog?search_text=chainsaw%20man%20variant&order=newest_first')
  assert.deepEqual(sourcesFor(null), [])
  assert.equal(sourcesFor(['lego'], 'https://www.vinted.fr/')[0].url, 'https://www.vinted.fr/catalog?search_text=lego&order=newest_first')
})

test('watch: what is new keeps where it was read, and each source has its report', () => {
  const card = (id, price, hearts) => ({ id, price: price.toFixed(2), text: `Art ${id}, condizioni: Ottime, ${price.toFixed(2)} €, ${(price * 1.05 + 0.7).toFixed(2)} € Include la commissione Vinted`, hearts, boost: id === 3 })
  const a = mergeFinds([], [card(1, 10, 3), card(2, 20, 9)], { at: 1000, source: 'feed', from: 'zerocalcare' })
  const b = mergeFinds(a.finds, [card(2, 20, 12), card(3, 5, 0)], { at: 2000, source: 'feed', from: 'home' })
  assert.deepEqual(b.finds.map((f) => [f.id, f.from]).sort(), [['1', 'zerocalcare'], ['2', 'zerocalcare'], ['3', 'home']])
  const scored = b.finds.map((f) => ({ ...f, score: { total: f.id === '1' ? 72 : f.id === '2' ? 58 : 90 }, gone: f.id === '3' ? 'tolto' : undefined }))
  // what was gone when its page was read is not among what is worth a look, however good it was
  assert.deepEqual(sourceReport(scored), [
    { fonte: 'zerocalcare', articoli: 2, da_55: 2, da_70: 1, sponsorizzati: 0, cuori_mediani: 3, non_in_vendita: 0 },
    { fonte: 'home', articoli: 1, da_55: 0, da_70: 0, sponsorizzati: 1, cuori_mediani: 0, non_in_vendita: 1 },
  ])
  // what was found before sources had a name is told by the kind of job
  assert.deepEqual(sourceReport([{ id: '9', source: 'hunt', price: 5 }, { id: '8', source: 'feed', price: 5 }]).map((r) => r.fonte).sort(), ['caccia', 'home'])
  assert.deepEqual(sourceReport(null), [])
})

test('watch: a notification of Vinted\'s is matched to the article that waits', () => {
  const waits = [{ id: '1', title: 'Absolute Transmetropolitan Volume 1/2/3' }, { id: '2', title: 'Zerocalcare un polpo alla gola' }, { id: '3', title: 'Lotto fumetti Orfani (44 volumi)' }]
  assert.deepEqual(waitMatchOf('Prezzo ridotto! Absolute Transmetropolitan Volume 1/2/3 ora costa 190,00 €', waits), { id: '1', price: 190 })
  assert.deepEqual(waitMatchOf('Il venditore ti ha fatto un\'offerta per «Zerocalcare un polpo alla gola»: € 4,50', waits), { id: '2', price: 4.5 })
  // the article named, no price: to be looked at
  assert.deepEqual(waitMatchOf('Lotto fumetti Orfani (44 volumi): il venditore ha aggiornato l\'annuncio', waits), { id: '3', price: null })
  // a price with no name: every article that waits is looked at
  assert.deepEqual(waitMatchOf('Un articolo tra i tuoi preferiti è stato scontato', waits), { all: true })
  // nothing of ours
  assert.equal(waitMatchOf('Hai un nuovo messaggio da un utente', waits), null)
  assert.equal(waitMatchOf('Il pacco è stato consegnato', waits), null)
  assert.equal(waitMatchOf('', waits), null)
  // one common word is not a match
  assert.deepEqual(waitMatchOf('Fumetti in offerta questa settimana', waits), { all: true })
})

test('watch: a search that names only a kind of thing is said before it runs (1.21)', () => {
  // The two searches of the diary of 18 November that brought nothing from 55 out of 151.
  assert.equal(searchAdviceOf('dischi 10 kg').kind, 'generica')
  assert.equal(searchAdviceOf('Maglia sotto giacca').kind, 'generica')
  assert.equal(searchAdviceOf('libri').kind, 'generica')
  assert.equal(searchAdviceOf('scarpe uomo 42 nere').kind, 'generica')
  // A brand, an author, a model: nothing to say.
  for (const fine of ['Will Eisner contratto con Dio', 'zerocalcare', "Levi's 511", 'lego star wars', 'iphone 12', 'ps5', 'Nintendo Switch OLED']) assert.equal(searchAdviceOf(fine), null, fine)
  assert.equal(searchAdviceOf('corto maltese una ballata del mare salato prima edizione rizzoli').kind, 'lunga')
  assert.equal(searchAdviceOf(''), null)
  assert.equal(searchAdviceOf(null), null)
})

test('watch: what each followed search brought, over the jobs kept and the one running (1.21)', () => {
  const history = [
    { tipo: 'feed', fonti: ['dischi 10 kg', 'Will Eisner'], resa: [{ fonte: 'Will Eisner', articoli: 40, da_55: 4, da_70: 2 }, { fonte: 'dischi 10 kg', articoli: 80, da_55: 0, da_70: 0 }] },
    { tipo: 'feed', resa: [{ fonte: 'home', articoli: 120, da_55: 9, da_70: 1 }] },
    { tipo: 'hunt', cosa: 'levis 511', resa: [{ fonte: 'caccia', articoli: 30, da_55: 3, da_70: 0 }] },
    { tipo: 'feed', resa: [{ fonte: 'will eisner', articoli: 30, da_55: 1, da_70: 0 }] },
  ]
  const y = searchYields(history, [{ fonte: 'Dischi 10 kg', articoli: 71, da_55: 0, da_70: 0 }, { fonte: 'hugo pratt', articoli: 10, da_55: 1, da_70: 0 }])
  assert.deepEqual(y, {
    'will eisner': { articoli: 70, da_55: 5, da_70: 2, lavori: 2 },
    'dischi 10 kg': { articoli: 151, da_55: 0, da_70: 0, lavori: 2 },
    'hugo pratt': { articoli: 10, da_55: 1, da_70: 0, lavori: 1 },
  })
  assert.equal(yieldVerdictOf(y['will eisner']), 'buona')
  assert.equal(yieldVerdictOf(y['dischi 10 kg']), 'nulla')
  assert.equal(yieldVerdictOf(y['hugo pratt']), null)
  assert.equal(yieldVerdictOf({ articoli: 200, da_55: 3, da_70: 0 }), 'scarsa')
  assert.equal(yieldVerdictOf({ articoli: 200, da_55: 3, da_70: 1 }), 'buona')
  assert.equal(yieldVerdictOf(null), null)
  assert.deepEqual(searchYields(null), {})

  assert.deepEqual(searchLineOf('Will Eisner', y['will eisner']), { text: '5 da 55 su 70 letti (2 da 70): rende, tienila', tone: 'good', verdict: 'buona' })
  const none = searchLineOf('dischi 10 kg', y['dischi 10 kg'])
  assert.equal(none.tone, 'warn')
  assert.match(none.text, /^0 da 55 su 151 letti: non rende\. Nomina solo un tipo di oggetto/)
  assert.match(searchLineOf('zerocalcare', { articoli: 90, da_55: 0, da_70: 0 }).text, /non rende\. Cambiala, o stringila/)
  assert.deepEqual(searchLineOf('hugo pratt', y['hugo pratt']), { text: '1 da 55 su 10 letti: ancora poco per dirlo', tone: 'neutral', verdict: null })
  assert.deepEqual(searchLineOf('zerocalcare'), { text: 'Mai provata', tone: 'neutral', verdict: null })
  assert.equal(searchLineOf('maglia').tone, 'warn')
})

test('watch: ideas of searches come from what he liked, and never repeat what he follows (1.21)', () => {
  const find = (id, extra) => ({ id: String(id), title: `Articolo ${id}`, price: 10, ...extra })
  const finds = [
    find(1, { title: 'Contratto con Dio di Will Eisner', score: { total: 95 }, card: { brand: 'Will Eisner', model: 'Contratto con Dio', category: 'fumetti_manga' } }),
    find(2, { score: { total: 60 }, vote: 1, card: { brand: 'Samsung', model: 'Galaxy S21', category: 'telefoni' } }),
    find(3, { score: { total: 90 }, vote: -1, card: { brand: 'Hugo Pratt', model: '', category: 'fumetti_manga' } }),
    find(4, { score: { total: 80 }, gone: 'venduto', card: { brand: 'Bonelli', model: '', category: 'fumetti_manga' } }),
    find(5, { score: { total: 40 }, card: { brand: 'Zara', model: '', category: 'abbigliamento' } }),
    find(6, { score: { total: 75 }, card: { brand: 'n.d.', model: '', category: 'altro' }, brand: '' }),
    find(7, { rated: 80, score: { total: 80 }, brand: 'Bao Publishing' }),
  ]
  const history = [{ tipo: 'feed', resa: [{ fonte: 'lego star wars', articoli: 90, da_55: 8, da_70: 2 }, { fonte: 'maglia', articoli: 90, da_55: 0, da_70: 0 }] }]
  const ideas = searchIdeasOf({ finds, history, likes: { 'brand:nike': 3, 'brand:zara': 1, 'cat:libri': 5 }, following: ['Will Eisner contratto con Dio'] })
  assert.deepEqual(ideas.map((i) => i.label), ['lego star wars', 'Samsung Galaxy S21', 'Will Eisner', 'Bao Publishing', 'nike'])
  assert.match(ideas[0].why, /ha già reso 8 da 55 su 90/)
  assert.match(ideas[1].why, /il tuo pollice/)
  // What a followed search already covers is not offered again; a kind of thing never is.
  assert.deepEqual(searchIdeasOf({ finds, history, following: ['will eisner', 'LEGO', 'samsung'] }).map((i) => i.label), ['Bao Publishing'])
  assert.deepEqual(searchIdeasOf({ finds: [find(1, { score: { total: 90 }, card: { brand: 'Libri', model: '', category: 'libri' } })] }), [])
  assert.deepEqual(searchIdeasOf(), [])
  assert.equal(searchIdeasOf({ finds, history, max: 2 }).length, 2)
})

test('watch: a comic suggests its author, and the home has its own count (1.21.1)', () => {
  // The diary of 19 November: three comics from 90, no brand on any, and the ideas were a pair of earphones and a shop.
  const comic = (id, title, total, author) => ({ id: String(id), title, price: 10, score: { total }, card: { brand: '', author, model: title, category: 'fumetti_manga' } })
  const ideas = searchIdeasOf({ finds: [comic(1, 'Extremity', 90, 'Daniel Warren Johnson'), comic(2, 'Corpicino', 70, 'Tuono Pettinato'), comic(3, 'Vermis 2', 97, ''), comic(4, 'Polina', 40, 'Bastien Vivès')], following: ['Will Eisner contratto con Dio'] })
  assert.deepEqual(ideas.map((i) => i.label), ['Daniel Warren Johnson', 'Tuono Pettinato'])
  const history = [
    { tipo: 'feed', resa: [{ fonte: 'Will Eisner', articoli: 64, da_55: 2, da_70: 2 }] },
    { tipo: 'feed', resa: [{ fonte: 'home', articoli: 64, da_55: 2, da_70: 1 }] },
    { tipo: 'feed', resa: [{ fonte: 'home', articoli: 100, da_55: 6, da_70: 4 }] },
  ]
  assert.deepEqual(homeYield(history), { articoli: 164, da_55: 8, da_70: 5, lavori: 2 })
  assert.deepEqual(homeYield(history, [{ fonte: 'home', articoli: 10, da_55: 1, da_70: 0 }]), { articoli: 174, da_55: 9, da_70: 5, lavori: 3 })
  assert.equal(homeYield([{ tipo: 'feed', resa: [{ fonte: 'zerocalcare', articoli: 5, da_55: 0, da_70: 0 }] }]), null)
  assert.equal(homeYield(null), null)
})
