import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLlmRequest, capacitiesOf, cardFactsOf, productIdentityOf, productMarketFrom, productSearchFor, strategyFor } from '../src/core/index.js'

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
  assert.deepEqual(m.dropped, { 'altra capacità': 1, difettoso: 1, accessorio: 1 })
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
  assert.deepEqual(ai.dropped, { 'altro prodotto': 1, variante: 1 })
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
