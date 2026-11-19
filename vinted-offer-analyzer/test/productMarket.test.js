import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MARKET_TRIAGE_NOTE, buildLlmRequest, capacitiesOf, cardFactsOf, productIdentityOf, productMarketFrom, productSearchFor, strategyFor, triagePrompt } from '../src/core/index.js'

// What the pages of the three reports of 16 Nov (20:05–20:07) gave as data.
const PHONE = {
  attributes: { model_nav: 'Modello Galaxy Z Fold7', internal_memory_capacity: 'Capacità di archiviazione 256 MB', status: 'Condizioni Nuovo senza cartellino', color: 'Colore Blu', upload_date: 'Caricato 6 giorni fa' },
  links: { model_nav: '/catalog?brand_collection_ids%5B%5D=9979&catalog%5B%5D=3661' },
  breadcrumbs: [{ text: 'Elettronica', path: '/catalog/2994-electronics?referrer=item-crumbs' }, { text: 'Telefoni cellulari', path: '/catalog/3661-mobile-phones?referrer=item-crumbs' }, { text: 'Samsung Telefoni cellulari', path: '/catalog/3661-mobile-phones/brand/109048-samsung?referrer=item-crumbs' }],
}
const JOGGERS = {
  attributes: { size: 'Taglia M', status: 'Condizioni Ottime', color: 'Colore Grigio', upload_date: 'Caricato 4 min fa' },
  links: {},
  breadcrumbs: [{ text: 'Uomo', path: '/catalog/5-men?referrer=item-crumbs' }, { text: 'Pantaloni della tuta', path: '/catalog/1821-joggers?referrer=item-crumbs' }, { text: 'adidas Pantaloni della tuta', path: '/catalog/1821-joggers/brand/14-adidas?referrer=item-crumbs' }],
}

test('product: a phone is found by its model link, clothes by brand × category', () => {
  const phone = productIdentityOf(PHONE, { brand: 'Samsung' })
  assert.deepEqual([phone.kind, phone.model, phone.capacityGb, phone.band, phone.modelHref], ['model', 'Galaxy Z Fold7', 256, 'new', '/catalog?brand_collection_ids%5B%5D=9979&catalog%5B%5D=3661'])
  assert.deepEqual(productSearchFor(phone), { mode: 'model', query: 'Galaxy Z Fold7', url: 'https://www.vinted.it/catalog?brand_collection_ids%5B%5D=9979&catalog%5B%5D=3661' })
  const joggers = productIdentityOf(JOGGERS, { brand: 'adidas' })
  assert.deepEqual([joggers.kind, joggers.size, joggers.band, joggers.brandHref, joggers.category], ['brand', 'M', 'used', '/catalog/1821-joggers/brand/14-adidas', 'Pantaloni della tuta'])
  // With the words the AI gave: Vinted's own filters, so that the text applies to brand × category.
  assert.equal(productSearchFor(joggers, { query: 'adidas tiro 23' }).url, 'https://www.vinted.it/catalog?catalog%5B%5D=1821&brand_ids%5B%5D=14&search_text=adidas%20tiro%2023')
  assert.deepEqual(productSearchFor(joggers), { mode: 'brand', query: null, url: 'https://www.vinted.it/catalog?catalog%5B%5D=1821&brand_ids%5B%5D=14' })
  // A page that links neither has nothing to search by; a link that is not a catalog search is not followed.
  assert.equal(productIdentityOf({ attributes: { status: 'Condizioni Ottime' }, links: {}, breadcrumbs: [{ text: 'Casa', path: '/catalog/1918-home' }] }), null)
  assert.equal(productIdentityOf({ attributes: {}, links: { model_nav: 'https://altrove.example/x' }, breadcrumbs: [] }), null)
})

test('product: what a card says (the real card text of a search page)', () => {
  assert.deepEqual(cardFactsOf('Afro samurai complete edition, Condizioni: Nuovo senza cartellino, 15.00 €, 16.45 € Afro s'), { title: 'Afro samurai complete edition', brand: null, condition: 'Nuovo senza cartellino', size: null })
  assert.deepEqual(cardFactsOf('Pantaloni tuta adidas tiro, marca: adidas, condizioni: Ottime, taglia: M, 9.00 €, 10.15 € include la Protezione acquisti'), { title: 'Pantaloni tuta adidas tiro', brand: 'adidas', condition: 'Ottime', size: 'M' })
  assert.equal(cardFactsOf('Galaxy Z Fold7 256GB 1150,00 €').title, 'Galaxy Z Fold7 256GB')
  assert.deepEqual(capacitiesOf('Fold7 12GB ram 256 gb'), [12, 256])
  assert.deepEqual(capacitiesOf('256 MB'), [256])
  assert.deepEqual(capacitiesOf('1TB'), [1024])
})

const phoneCards = [
  { id: '1', price: '1.050,00', text: 'Samsung Galaxy Z Fold7 256GB, marca: Samsung, condizioni: Nuovo senza cartellino, 1050.00 €' },
  { id: '2', price: '1.100,00', text: 'Galaxy Z Fold 7 nuovo sigillato, marca: Samsung, condizioni: Nuovo con cartellino, 1100.00 €' },
  { id: '3', price: '990,00', text: 'Z Fold7 256 gb blu, marca: Samsung, condizioni: Nuovo senza cartellino, 990.00 €' },
  { id: '4', price: '1.150,00', text: 'Galaxy Fold, marca: Samsung, condizioni: Nuovo senza cartellino, 1150.00 €' }, // the listing itself
  { id: '5', price: '1.300,00', text: 'Galaxy Z Fold7 512GB, marca: Samsung, condizioni: Nuovo senza cartellino, 1300.00 €' },
  { id: '6', price: '400,00', text: 'Galaxy Z Fold7 schermo rotto, marca: Samsung, condizioni: Discrete, 400.00 €' },
  { id: '7', price: '25,00', text: 'Cover Galaxy Z Fold7 originale, marca: Samsung, condizioni: Nuovo senza cartellino, 25.00 €' },
  { id: '8', price: '900,00', text: 'Samsung Z Fold7 usato pochissimo, marca: Samsung, condizioni: Ottime, 900.00 €' },
  { id: '9', price: '1.080,00', text: 'Fold7 12GB ram 256GB, marca: Samsung, condizioni: Nuovo senza cartellino, 1080.00 €' },
]

test('product: the market of a phone — same model, same storage, same condition, no broken ones, no accessories', () => {
  const identity = productIdentityOf(PHONE)
  const m = productMarketFrom(phoneCards, { identity, mode: 'model', selfId: '4', listPrice: 1150 })
  assert.deepEqual(m.dropped, { 'altra capacità': 1, difettoso: 1, accessorio: 1, 'altra condizione': 1 })
  // The report shows what was kept and a few of what was not, with the reason.
  assert.equal(m.examples.tenuti.length, 4)
  assert.ok(m.examples.scartati.some((x) => /^difettoso: Galaxy Z Fold7 schermo rotto — 400 €/.test(x)), JSON.stringify(m.examples.scartati))
  // Five phones are left, four of them new like the listing: those are the market.
  assert.deepEqual([m.seen, m.kept, m.basis, m.conditionMatched, m.confidence, m.ok], [8, 4, 'model', true, 'media', true])
  assert.deepEqual([m.market.minPrice, m.market.medianPrice, m.market.maxPrice, m.market.p25Price], [990, 1065, 1100, 1035])
  assert.equal(m.market.gapPct, 8)
  // The strategy sells again at the lower quartile of that market.
  const s = strategyFor({ listPrice: '1150', category: 'electronics', listingSignal: 'none', itemTitle: 'Galaxy FOLD' }, new Date('2026-11-16T20:06:00Z'), { goal: 'resell', market: m.market, extraction: { shippingFrom: 3.09 } })
  assert.deepEqual(s.costs.resale, { amount: 1035, source: 'market' })
  assert.equal(s.costs.market.basis, 'model')
  assert.ok(s.options.every((o) => o.price <= s.costs.ceiling))
  // Too few new ones: every condition counts, and the result says the condition was not matched.
  const few = productMarketFrom(phoneCards.slice(0, 3).concat(phoneCards[7]), { identity: { ...identity, band: 'used' }, mode: 'model' })
  assert.deepEqual([few.kept, few.conditionMatched, few.ok], [4, false, true])
})

test('product: clothes — without the AI the cards are only «same brand and kind»: a range, not a market to rest on', () => {
  const identity = productIdentityOf(JOGGERS, { brand: 'adidas' })
  const cards = [
    { id: '1', price: '9,00', text: 'Pantaloni tuta adidas tiro, marca: adidas, condizioni: Ottime, taglia: M, 9.00 €' },
    { id: '2', price: '12,00', text: 'Adidas Tiro 23 neri, marca: adidas, condizioni: Buone, taglia: M, 12.00 €' },
    { id: '3', price: '15,00', text: 'adidas tiro pantaloni, marca: adidas, condizioni: Ottime, taglia: M, 15.00 €' },
    { id: '4', price: '35,00', text: 'Adidas Firebird track pants, marca: adidas, condizioni: Ottime, taglia: M, 35.00 €' },
    { id: '5', price: '14,00', text: 'Tiro 23 adidas, marca: adidas, condizioni: Ottime, taglia: L, 14.00 €' },
    { id: '6', price: '40,00', text: 'adidas tiro nuovi, marca: adidas, condizioni: Nuovo con cartellino, taglia: M, 40.00 €' },
    { id: '7', price: '13,00', text: 'Tuta adidas tiro, marca: adidas, condizioni: Ottime, taglia: M, 13.00 €' },
  ]
  const plain = productMarketFrom(cards, { identity, mode: 'brand', listPrice: 9 })
  assert.deepEqual([plain.basis, plain.confidence, plain.ok, plain.conditionMatched, plain.sizeMatched], ['brand', 'bassa', false, true, true])
  assert.equal(plain.kept, 5) // used, size M: the Firebird is still in
  // With the AI's verdicts only the same article counts; a card it did not answer for is not vouched for.
  const verdicts = { 1: 'same', 2: 'same', 3: 'same', 4: 'other', 5: 'variant', 6: 'same', 7: 'same' }
  const ai = productMarketFrom(cards, { identity, mode: 'brand', listPrice: 9, verdicts })
  assert.deepEqual([ai.basis, ai.kept, ai.confidence, ai.ok], ['ai', 4, 'media', true])
  assert.deepEqual(ai.dropped, { 'altro prodotto': 1, variante: 1, 'altra condizione': 1 })
  assert.equal(ai.sizeMatched, true) // the four left are all size M
  assert.match(ai.examples.tenuti[0], /^\[same\] Pantaloni tuta adidas tiro — 9 € \(Ottime, M\)/)
  assert.deepEqual([ai.market.medianPrice, ai.market.p25Price], [12.5, 11.25])
  const partial = productMarketFrom(cards, { identity, mode: 'brand', verdicts: new Map([['1', 'same'], ['2', 'same']]) })
  assert.deepEqual([partial.kept, partial.ok, partial.dropped['non giudicato']], [2, false, 5])
})

test('product: cards too far apart are not one market', () => {
  const identity = productIdentityOf(PHONE)
  const wide = [100, 110, 120, 300, 320, 340].map((p, i) => ({ id: String(i), price: p, text: `Galaxy Z Fold7, condizioni: Nuovo senza cartellino, ${p}.00 €` }))
  const m = productMarketFrom(wide, { identity, mode: 'model' })
  // Six cards of the same condition would be «alta»: the spread takes a step away.
  assert.ok(m.market.spread > 0.6)
  assert.equal(m.confidence, 'media')
})

test('product: what the first real reports of 1.13.0 taught (a phone by model, jeans with DeepSeek)', () => {
  // «Nuovo senza cartellino» in the attributes, «usato pochissimo» in the description: it compares with the used ones.
  const facts = { attributes: { model_nav: 'Modello Galaxy S25 Ultra', internal_memory_capacity: 'Capacità di archiviazione 256 MB', status: 'Condizioni Nuovo senza cartellino' }, links: { model_nav: '/catalog?brand_collection_ids%5B%5D=9142&catalog%5B%5D=3661&search_start_type=item_page_model' }, breadcrumbs: [] }
  const said = productIdentityOf(facts, { description: 'Vendo Samsung Galaxy S25 ultra 256gb usato pochissimo pari al nuovo' })
  assert.deepEqual([said.band, said.bandFromDescription], ['used', true])
  assert.deepEqual([productIdentityOf(facts, { description: 'Mai usato, ancora sigillato' }).band, productIdentityOf(facts).band], ['new', 'new'])
  // The same model does not vary threefold: 215 € and 1500 € among phones around 700 € are something else.
  const prices = [215, 600, 630, 650, 700, 720, 780, 800, 1500]
  const cards = prices.map((p, i) => ({ id: String(i), price: p, text: `Samsung s25ultra, Brand: Samsung, Modello: Galaxy S25 Ultra, Condizioni: Ottime, ${p}.00 €` }))
  const m = productMarketFrom(cards, { identity: said, mode: 'model' })
  assert.deepEqual([m.kept, m.dropped['prezzo anomalo'], m.market.minPrice, m.market.maxPrice], [7, 2, 600, 800])
  // The card's own storage field decides, whatever the title says.
  const other = productMarketFrom([...cards, { id: 'x', price: 900, text: 'S25 Ultra come nuovo, Brand: Samsung, Capacità di archiviazione: 512 GB, Condizioni: Ottime, 900.00 €' }], { identity: said, mode: 'model' })
  assert.equal(other.dropped['altra capacità'], 1)
  // Sorting cards is not a job to think about: 45 seconds with thinking on, on the first real run.
  const prompt = { system: 's', text: 't', schema: { type: 'object' } }
  const fast = buildLlmRequest('deepseek:deepseek-flash', prompt, [], { effort: 'low', maxTokens: 900, think: false }).body
  assert.deepEqual([fast.thinking, fast.reasoning_effort], [{ type: 'disabled' }, undefined])
  const slow = buildLlmRequest('deepseek:deepseek-flash', prompt, [], { effort: 'low', maxTokens: 900 }).body
  assert.deepEqual([slow.thinking, slow.reasoning_effort], [undefined, 'low'])
})

test('strategy: three real choices under the ceiling, and a minimum margin moves the ceiling', () => {
  // The S25 Ultra of 16 Nov: 630 €, sold again at 630 € (the market's lower quartile), free shipping. The ceiling left
  // «prudente» at 595 € and «consigliata» at 592 €.
  const market = { n: 17, medianPrice: 700, p25Price: 630, p75Price: 780, basis: 'model' }
  const form = { listPrice: '630', category: 'electronics', listingSignal: 'none', itemTitle: 'Galaxy S25 Ultra' }
  const at = new Date('2026-11-16T20:41:00Z')
  const s = strategyFor(form, at, { goal: 'resell', market, extraction: { shippingFrom: 0, uploadedDays: 2 } })
  const [top, mid, low] = s.options.map((o) => o.price)
  assert.equal(s.costs.ceiling, 599.33)
  assert.ok(top <= 599.33 && top > mid && mid > low)
  assert.ok(top - mid >= 0.25 * (top - low), `the middle one stands apart: ${top} / ${mid} / ${low}`)
  // Keeping 10% of the resale value: the ceiling is 630 × 0,9 less the costs, and every proposal is under it.
  const kept = strategyFor(form, at, { goal: 'resell', marginPct: 10, market, extraction: { shippingFrom: 0, uploadedDays: 2 } })
  assert.equal(kept.costs.marginPct, 10)
  assert.equal(kept.costs.ceiling, 539.33)
  assert.ok(kept.options.every((o) => o.price <= 539.33 && o.margin >= 63 - 0.01))
})

test('strategy: in the first hours the seller is at the peak of his confidence — gentler proposals, lower odds', () => {
  // The jeans of 16 Nov: 15 €, uploaded two hours before, a seller the profile calls «facile». Until 1.13.1 a fresh
  // listing made the seller easier and the bold proposal was the one recommended.
  const form = { listPrice: '15', category: 'other', listingSignal: 'none', itemTitle: 'Levi\'s 511' }
  const at = new Date('2026-11-16T20:44:00Z')
  const seller = { type: 'facile', score: 2.25, traits: [], archetype: { id: 'active', label: 'Privato attivo' }, confidence: 'alta' }
  const run = (uploadedDays) => strategyFor(form, at, { goal: 'keep', seller, extraction: { shippingFrom: 2.59, uploadedDays } })
  const fresh = run(2 / 24)
  const settled = run(2)
  assert.equal(fresh.firstHours, 1)
  assert.equal(settled.firstHours, 0)
  // Every proposal is at least as near the price, and each is less likely to pass than the same step two days later.
  for (let i = 0; i < 3; i++) {
    assert.ok(fresh.options[i].price >= settled.options[i].price, `${fresh.options[i].price} >= ${settled.options[i].price}`)
    assert.ok(fresh.options[i].probability < settled.options[i].probability + 1e-9 || fresh.options[i].price > settled.options[i].price)
  }
  assert.ok(fresh.options[2].price > settled.options[2].price, 'the bold one is not as bold')
  // To sell again, with the real market of that listing: the bold proposal gains a few cents more on average, and in
  // the first hours that is a tie — the middle one is recommended. Two days later the bold one is.
  const market = { n: 11, medianPrice: 20, p25Price: 19, p75Price: 25, basis: 'ai' }
  const resell = (uploadedDays) => strategyFor(form, at, { goal: 'resell', seller, market, extraction: { shippingFrom: 2.59, uploadedDays } })
  assert.equal(resell(2 / 24).recommendedId, 'consigliata')
  assert.equal(resell(2).recommendedId, 'audace')
  // Half a day later half of that caution is left; after a day none.
  assert.ok(run(0.5).firstHours > 0.5 && run(0.5).firstHours < 0.6)
  assert.equal(run(1.2).firstHours, 0)
  // The same price is less likely to pass in the first hours.
  const same = (uploadedDays) => strategyFor(form, at, { goal: 'keep', seller, customPrice: 12, extraction: { shippingFrom: 2.59, uploadedDays } }).options.find((o) => o.id === 'tua' || Math.abs(o.price - 12) < 0.005).probability
  assert.ok(same(2 / 24) < same(2) - 0.03, `${same(2 / 24)} < ${same(2)}`)
})

test('product: the report of 16 Nov 21:12 — three cards of one size are a worse market than all the same articles', () => {
  // A Jack & Jones jumper, new, size S: the AI kept 13 cards, 3 of them in size S (9,99 · 9,99 · 25 €). Narrowed to
  // those the market was «bassa» and unused; the size moves the price of a jumper little.
  const identity = { kind: 'brand', size: 'S', band: 'new', condition: 'Nuovo senza cartellino' }
  const prices = [['S', 9.99], ['S', 9.99], ['S', 25], ['M', 12], ['M', 14], ['L', 13], ['L', 15], ['XL', 12.5], ['M', 16], ['L', 11]]
  const cards = prices.map(([size, p], i) => ({ id: String(i), price: p, text: `Maglione Jack & Jones JJstudio Knit, Brand: Jack & Jones, Condizioni: Nuovo senza cartellino, Taglia: ${size}, ${p} €` }))
  const verdicts = Object.fromEntries(cards.map((c) => [c.id, 'same']))
  const m = productMarketFrom(cards, { identity, mode: 'brand', listPrice: 15, verdicts })
  assert.deepEqual([m.kept, m.sizeMatched, m.conditionMatched, m.ok], [10, false, true, true])
  assert.deepEqual([m.market.p25Price, m.market.medianPrice], [11.25, 12.75])
  // With five of the same size, the size is the market.
  const more = productMarketFrom([...cards, { id: 'a', price: 11, text: 'Jack & Jones knit, Condizioni: Nuovo senza cartellino, Taglia: S, 11 €' }, { id: 'b', price: 12, text: 'JJ knit crew, Condizioni: Nuovo con cartellino, Taglia: S, 12 €' }], { identity, mode: 'brand', verdicts: { ...verdicts, a: 'same', b: 'same' } })
  assert.deepEqual([more.kept, more.sizeMatched, more.dropped['altra taglia']], [5, true, 7])
})

test('strategy: a market too thin to be one can lower the resale value, never raise it', () => {
  const form = { listPrice: '15', category: 'other', listingSignal: 'none', itemTitle: 'Maglione' }
  const at = new Date('2026-11-16T21:12:00Z')
  const base = { goal: 'resell', extraction: { shippingFrom: 2.59, uploadedDays: 2 } }
  // Three listings of the same jumper, a quarter of them at 9,99 €: reselling at this listing's 15 € is not counted on.
  const low = strategyFor(form, at, { ...base, resaleHint: { amount: 9.99, n: 3, basis: 'ai' } })
  assert.deepEqual(low.costs.resale, { amount: 9.99, source: 'few' })
  assert.deepEqual(low.costs.hint, { n: 3, basis: 'ai', similar: false })
  assert.equal(low.costs.reachable, false) // not worth buying to sell again: said, instead of a margin of cents
  // Above the listing's price the thin market says nothing; a typed value and a real market come first.
  assert.deepEqual(strategyFor(form, at, { ...base, resaleHint: { amount: 22, n: 2, basis: 'model' } }).costs.resale, { amount: 15, source: 'listing' })
  assert.equal(strategyFor(form, at, { ...base, resale: 18, resaleHint: { amount: 9.99, n: 3 } }).costs.resale.source, 'user')
  assert.equal(strategyFor(form, at, { ...base, market: { n: 8, medianPrice: 20, p25Price: 17, p75Price: 24 }, resaleHint: { amount: 9.99, n: 3 } }).costs.resale.source, 'market')
})

test('strategy: a lower offer is never likelier to pass than a higher one (two lucky deals in one band)', () => {
  // The coat of 16 Nov 21:28: 28 €, proposals 27 / 26 / 24 €. The user's history had deals accepted between 12,5% and
  // 22,5% off and refusals below: the bold proposal came out at 42% against the middle one's 36%, and was recommended.
  const records = [
    { listPrice: 17, targetPrice: 14, status: 'accepted', firstOutcome: 'accepted' },
    { listPrice: 20, targetPrice: 17, status: 'accepted', firstOutcome: 'accepted' },
    { listPrice: 20, targetPrice: 19, status: 'declined', firstOutcome: 'declined' },
    { listPrice: 30, targetPrice: 28, status: 'declined', firstOutcome: 'declined' },
  ]
  const form = { listPrice: '28', category: 'other', listingSignal: 'none', itemTitle: 'Cappotto' }
  const s = strategyFor(form, new Date('2026-11-16T21:28:00Z'), { goal: 'keep', records, extraction: { shippingFrom: 3.09, uploadedDays: 2 } })
  const byPrice = [...s.options].sort((a, b) => b.price - a.price)
  for (let i = 1; i < byPrice.length; i++) assert.ok(byPrice[i].probability <= byPrice[i - 1].probability + 1e-12, byPrice.map((o) => `${o.price}: ${o.probability.toFixed(3)}`).join(' · '))
  // The history still counts: without it the dearest proposal would be likelier than it is with two refusals there.
  const plain = strategyFor(form, new Date('2026-11-16T21:28:00Z'), { goal: 'keep', extraction: { shippingFrom: 3.09, uploadedDays: 2 } })
  assert.ok(byPrice[0].probability < [...plain.options].sort((a, b) => b.price - a.price)[0].probability)
})

test('product: cards the AI calls alike are not the same article — and the kind of garment decides', () => {
  // The two real runs of 16 Nov on DEKKER outerwear: every card kept was a «variant», coats and jackets together
  // (19 € to 120 €), and the market was called «alta» and used.
  const identity = { kind: 'brand', size: 'M', band: 'used', condition: 'Ottime' }
  const kept = [['Cappotto Dekker', 19], ['Cappotto Dekker uomo tg M', 20], ['Cappotto uomo Dekker', 68], ['Cappotto marca DEKKER', 50], ['Cappottino Uomo Dekker', 50], ['Cappotto da uomo Dekker', 45]]
  const cards = kept.map(([title, p], i) => ({ id: String(i), price: p, text: `${title}, Brand: DEKKER, Condizioni: Ottime, Taglia: M, ${p}.00 €` }))
  const alike = productMarketFrom(cards, { identity, mode: 'brand', listPrice: 28, verdicts: Object.fromEntries(cards.map((c) => [c.id, 'variant'])) })
  assert.deepEqual([alike.similar, alike.verdicts, alike.kept], [true, { variant: 6 }, 6])
  // Alike is never a market to rest the resale value on, however close the prices: told, not used.
  assert.deepEqual([alike.confidence, alike.ok, alike.market.similar], ['bassa', false, true])
  const tight = productMarketFrom(cards.map((c, i) => ({ ...c, price: 40 + i * 2 })), { identity, mode: 'brand', verdicts: Object.fromEntries(cards.map((c) => [c.id, 'variant'])) })
  assert.deepEqual([tight.confidence, tight.ok], ['bassa', false])
  // …and among cards that are only alike a cheap one is as real as a dear one: 10 € and 13 € stay beside 120 €.
  const wide = [10, 13, 19, 20, 45, 45, 50, 50, 68, 120].map((p, i) => ({ id: `w${i}`, price: p, text: `Cappotto Dekker, Brand: DEKKER, Condizioni: Ottime, Taglia: M, ${p}.00 €` }))
  const all = productMarketFrom(wide, { identity, mode: 'brand', verdicts: Object.fromEntries(wide.map((c) => [c.id, 'variant'])) })
  assert.deepEqual([all.kept, all.market.minPrice, all.market.medianPrice], [10, 10, 45])
  // The same article, by the AI's word, can be «alta».
  const same = productMarketFrom(cards.map((c, i) => ({ ...c, price: 40 + i * 2 })), { identity, mode: 'brand', verdicts: Object.fromEntries(cards.map((c) => [c.id, 'same'])) })
  assert.deepEqual([same.similar, same.confidence], [false, 'alta'])
  // The rule the AI is given for this job travels in the prompt.
  const prompt = triagePrompt({ title: 'Cappotto Dekker', brand: 'DEKKER' }, null, [{ source: 'vinted', id: '1', title: 'Giubbotto Dekker', price: 120, condition: 'Ottime' }], { note: MARKET_TRIAGE_NOTE })
  assert.match(prompt.text, /cappotto con cappotto, giubbotto con giubbotto/)
  assert.ok(!/cappotto con cappotto/.test(triagePrompt({ title: 'x' }, null, []).text))
})

test('product: the same listing sorted twice (16 Nov 22:13 and 22:14) — without a model, «same» and «variant» are one thing', () => {
  // An H&M crew-neck jumper, new, size S, analysed twice a minute apart with the fast AI. First run: 4 «same» (all of
  // size S, used) and 67 «variant», so a market of four used jumpers was used. Second run: no «same» at all, eleven
  // new «variant» ones, nothing used. The listing names no model: the AI's line between the two is arbitrary.
  const identity = { kind: 'brand', size: 'S', band: 'new', condition: 'Nuovo senza cartellino' }
  const cards = [
    ['Maglione H&M grigio scuro antracite girocollo - Taglia S', 8, 'Ottime', 'S'], ['Pullover girocollo H&M taglia S', 6, 'Ottime', 'S'],
    ['Maglione H&M Uomo Taglia S Grigio Melange', 5.99, 'Ottime', 'S'], ['Pullover girocollo H&M color nero taglia S', 5, 'Ottime', 'S'],
    ['Maglia manica lunga', 5, 'Nuovo senza cartellino', 'M'], ['Maglione uomo', 7, 'Nuovo senza cartellino', 'M'], ['Maglione leggero M', 11, 'Nuovo senza cartellino', 'M'],
    ['Pullover uomo H&M', 4, 'Nuovo senza cartellino', 'M'], ['Maglione H&M', 5, 'Nuovo senza cartellino', 'S'], ['Maglione uomo H&M tg. M', 5, 'Ottime', 'M'],
  ].map(([title, p, cond, size], i) => ({ id: String(i), price: p, text: `${title}, Brand: H&M, Condizioni: ${cond}, Taglia: ${size}, ${p} €` }))
  const first = Object.fromEntries(cards.map((c, i) => [c.id, i < 4 ? 'same' : 'variant']))
  const second = Object.fromEntries(cards.map((c) => [c.id, 'variant']))
  const run = (verdicts) => productMarketFrom(cards, { identity, mode: 'brand', listPrice: 5, verdicts, strict: false })
  const a = run(first)
  const b = run(second)
  // The two runs now give the same cards and the same answer: alike, told, not used.
  assert.deepEqual([a.similar, a.ok, a.kept, a.market.medianPrice], [b.similar, b.ok, b.kept, b.market.medianPrice])
  assert.deepEqual([a.similar, a.ok, a.kept, a.conditionMatched], [true, false, 5, true])
  // With a model in the listing the AI's «same» is still what counts.
  assert.deepEqual([productMarketFrom(cards, { identity, mode: 'brand', verdicts: first }).similar, productMarketFrom(cards, { identity, mode: 'brand', verdicts: first }).kept], [false, 4])
  // A fixed temperature for the sorting, only where it applies (no thinking).
  const prompt = { system: 's', text: 't', schema: { type: 'object' } }
  assert.equal(buildLlmRequest('deepseek:deepseek-flash', prompt, [], { think: false, temperature: 0 }).body.temperature, 0)
  assert.equal(buildLlmRequest('deepseek:deepseek-flash', prompt, [], { temperature: 0 }).body.temperature, undefined)
})
