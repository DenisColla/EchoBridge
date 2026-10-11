import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalogCandidate, flightText, parseVintedCatalog, vintedSearchQuery, vintedSearchUrl } from '../src/core/index.js'

const fixture = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8')

test('catalog: the October 2026 search page yields every result with price, fee, total, brand, size, condition and photo', () => {
  const { items, total } = parseVintedCatalog(fixture('vinted-catalog-2026-10.html'))
  assert.equal(total, 5)
  assert.equal(items.length, 5)
  const first = items[0]
  assert.equal(first.source, 'vinted')
  assert.equal(first.title, 'Basket Nike Air Max')
  assert.equal(first.price, 8)
  assert.equal(first.buyerFee, 1.1)
  assert.equal(first.total, 9.1)
  assert.equal(first.currency, 'EUR')
  assert.equal(first.brand, 'Nike')
  assert.equal(first.size, '40')
  assert.equal(first.condition, 'Buone')
  assert.ok(first.url.startsWith('https://www.vinted.it/items/'))
  assert.ok(first.photo.includes('/f800/'), 'the large photo, not the thumbnail')
  assert.equal(first.sellerId, '1000000001')
  // Vinted's own fee rule: 5% + 0.70 €, already inside the total.
  for (const it of items) assert.ok(Math.abs(it.total - (it.price + it.buyerFee)) < 0.011, it.title)
  assert.equal(items[1].size, '40.5')
  assert.equal(items[3].size, '38,5')
  assert.equal(items[2].condition, 'Nuovo senza cartellino')
  assert.equal(items[2].sellerBusiness, true)
})

test('catalog: payload split across chunks, the productItem fallback and garbage never throw', () => {
  const html = fixture('vinted-catalog-2026-10.html')
  assert.ok(flightText(html).includes('"items":{"items":['), 'chunks are concatenated before parsing')
  // Without the items wrapper the per-item scan still finds them.
  const variant = html.replace('\\"items\\":{\\"items\\":', '\\"results\\":{\\"list\\":')
  assert.equal(parseVintedCatalog(variant).items.length, 5)
  assert.deepEqual(parseVintedCatalog('').items, [])
  assert.deepEqual(parseVintedCatalog('<html>Please wait</html>').items, [])
  assert.deepEqual(parseVintedCatalog('self.__next_f.push([1,"unterminated').items, [])
  assert.equal(catalogCandidate({ productItem: { id: 1 } }), null, 'no title, no candidate')
})

test('catalog: duplicates are dropped and "$undefined" placeholders become null', () => {
  const entry = { productItem: { id: 7, title: 'Felpa', url: '/items/7-felpa', price: { amount: '10.00', currencyCode: 'EUR' }, serviceFee: '$undefined', totalItemPrice: '$undefined', thumbnailUrl: '$undefined', itemBox: { firstLine: '$undefined', secondLine: 'Discrete', accessibilityLabel: '$undefined' } } }
  const page = `self.__next_f.push([1,${JSON.stringify(`"items":{"items":${JSON.stringify([entry, entry])}}`)}])`
  const { items } = parseVintedCatalog(page)
  assert.equal(items.length, 1)
  assert.equal(items[0].buyerFee, null)
  assert.equal(items[0].total, null)
  assert.equal(items[0].brand, null)
  assert.equal(items[0].condition, 'Discrete')
  assert.equal(items[0].size, null)
  assert.equal(items[0].photo, null)
})

test('catalog: search words keep brand and product, drop sale words, sizes and emoji', () => {
  assert.equal(vintedSearchQuery({ title: '🎀Strepitoso🎀 Abitino cut out velour nero elasticizzato H&M divided tg. XS', brand: 'H&M' }), 'H&M Abitino cut out velour nero')
  assert.equal(vintedSearchQuery({ title: 'Charles Burns, Black Hole', brand: null }), 'Charles Burns Black Hole')
  assert.equal(vintedSearchQuery({ title: 'Nike Air Max 90 come nuove taglia 42', brand: 'Nike' }), 'Nike Air Max 90 42')
  assert.equal(vintedSearchQuery({ title: '', brand: '[object Object]' }), '')
  assert.equal(vintedSearchUrl('Charles Burns Black Hole'), 'https://www.vinted.it/catalog?search_text=Charles%20Burns%20Black%20Hole')
})
