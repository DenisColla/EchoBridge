import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookIdentityOf, bookMarketFrom, bookSearchFor, normalizeIsbn, strategyFor } from '../src/core/index.js'

// The attributes of a book's listing page, as the structure shared on 16 Nov shows them.
const page = ({ isbn = '9788834909195', href = '/catalog?search_text=9788834909195&amp;isbn=1', title = 'NEUN 6.5', author = 'Tsutomu Takahashi' } = {}) => `<html><body>
<div data-testid="item-attributes-language_book"><div>Lingua</div><div>Italiano</div></div>
${author ? `<div data-testid="item-attributes-author"><div><span>Autore</span></div><div><span>${author}</span></div></div>` : ''}
${title ? `<div data-testid="item-attributes-book_title"><div>Titolo</div><div>${title}</div></div>` : ''}
${isbn ? `<div data-testid="item-attributes-isbn_nav"><div>ISBN</div><a class="x" data-testid="item-attributes-isbn_nav-link" href="${href}"><span>${isbn}</span></a></div>` : ''}
<div data-testid="item-attributes-upload_date"><div>Caricato</div><div>23 min fa</div></div></body></html>`

test('book: the ISBN is read only when its check digit holds', () => {
  assert.equal(normalizeIsbn('978-88-349-0919-5'), '9788834909195')
  assert.equal(normalizeIsbn('9788834909196'), null)
  assert.equal(normalizeIsbn('88-04-66823-X'), null)
  assert.equal(normalizeIsbn('0-306-40615-2'), '0306406152')
  assert.equal(normalizeIsbn('230'), null)
})

test('book: identity from the listing page (ISBN link, title, author)', () => {
  assert.deepEqual(bookIdentityOf(page()), { isbn: '9788834909195', isbnHref: '/catalog?search_text=9788834909195&isbn=1', title: 'NEUN 6.5', author: 'Tsutomu Takahashi' })
  // Label and value glued in one element, as the page's text reads («AutoreTsutomu Takahashi»).
  assert.equal(bookIdentityOf('<div data-testid="item-attributes-author">AutoreTsutomu Takahashi</div>').author, 'Tsutomu Takahashi')
  // No ISBN on the page: title and author are what is left.
  assert.deepEqual(bookIdentityOf(page({ isbn: null })), { isbn: null, isbnHref: null, title: 'NEUN 6.5', author: 'Tsutomu Takahashi' })
  // The ISBN written by the seller in the description counts too; a number that is not one does not.
  assert.equal(bookIdentityOf('<p>Come nuovo. ISBN: 978-88-349-0919-5</p>').isbn, '9788834909195')
  assert.equal(bookIdentityOf('<p>Maglione taglia M, 230 grammi</p>'), null)
})

test('book: where to search — the page\'s own ISBN link, else the ISBN, else title and author', () => {
  const id = bookIdentityOf(page())
  assert.deepEqual(bookSearchFor(id), { mode: 'isbn', query: '9788834909195', url: 'https://www.vinted.it/catalog?search_text=9788834909195&isbn=1' })
  // A link that is not a Vinted search is not followed.
  assert.equal(bookSearchFor({ ...id, isbnHref: 'https://altrove.example/isbn/9788834909195' }).url, 'https://www.vinted.it/catalog?search_text=9788834909195')
  assert.deepEqual(bookSearchFor(id, { mode: 'title' }), { mode: 'title', query: 'NEUN 6.5 Tsutomu Takahashi', url: 'https://www.vinted.it/catalog?search_text=NEUN%206.5%20Tsutomu%20Takahashi' })
  // Without the book's details the listing's own title is the query.
  assert.equal(bookSearchFor({ isbn: null, title: null, author: null }, { listingTitle: 'Kobane Calling - ZeroCalcare' }).query, 'Kobane Calling ZeroCalcare')
  assert.equal(bookSearchFor({ isbn: null, title: null, author: null }, { listingTitle: '' }), null)
  assert.equal(bookSearchFor({ isbn: null, title: 'x' }, { mode: 'isbn' }), null)
})

test('book: the market by ISBN — every card is the same edition, but lots, the listing itself and absurd prices', () => {
  const cards = [
    { id: '1', price: '12,00', text: 'Kobane Calling Zerocalcare Ottime' },
    { id: '2', price: '14,00', text: 'Kobane calling' },
    { id: '3', price: '10,00', text: 'kobane calling zerocalcare bao' },
    { id: '4', price: '17,00', text: 'Kobane Calling - ZeroCalcare' }, // the listing itself
    { id: '5', price: '45,00', text: 'Lotto 5 libri Zerocalcare' },
    { id: '6', price: '16,00', text: 'Kobane Calling oggi' },
    { id: '7', price: '150,00', text: 'Kobane Calling' }, // a typo or a placeholder
    { id: '2', price: '14,00', text: 'Kobane calling' }, // the same card twice
    { id: '8', price: null, text: 'Kobane Calling' },
  ]
  const m = bookMarketFrom(cards, { identity: { isbn: '9788865436189', title: 'Kobane Calling', author: 'Zerocalcare' }, mode: 'isbn', selfId: '4', listingTitle: 'Kobane Calling - ZeroCalcare', listPrice: 17 })
  assert.equal(m.ok, true)
  assert.deepEqual([m.seen, m.kept, m.basis, m.confidence], [6, 4, 'isbn', 'media'])
  assert.deepEqual([m.market.n, m.market.medianPrice, m.market.minPrice, m.market.maxPrice], [4, 13, 10, 16])
  assert.equal(m.market.gapPct, 31) // 17 € against a median of 13 €
  // Two cards are told, not used.
  const few = bookMarketFrom(cards.slice(0, 2), { identity: { isbn: '9788865436189' }, mode: 'isbn' })
  assert.deepEqual([few.ok, few.kept, few.market.medianPrice], [false, 2, 13])
  assert.equal(bookMarketFrom([], { mode: 'isbn' }).market, null)
})

test('book: the market by title — only the cards that carry the title and the same volume', () => {
  const cards = [
    { id: '1', price: '6,00', text: 'Neun 6.5 Takahashi' },
    { id: '2', price: '7,50', text: 'NEUN vol 6,5 manga' },
    { id: '3', price: '5,00', text: 'Neun 3' },
    { id: '4', price: '4,00', text: 'Sidooh 6.5 Takahashi' },
    { id: '5', price: '8,00', text: 'neun 6.5 come nuovo' },
    { id: '6', price: '20,00', text: 'Neun Box Volumi 1-6 +6,5' },
    { id: '7', price: '9,00', text: '' },
  ]
  const m = bookMarketFrom(cards, { identity: { isbn: null, title: 'NEUN 6.5', author: 'Tsutomu Takahashi' }, mode: 'title', listingTitle: 'Neun 6.5', listPrice: 9 })
  assert.deepEqual([m.ok, m.kept, m.basis, m.confidence, m.market.medianPrice], [true, 3, 'title', 'bassa', 7.5])
  // The listing is the box set: only box sets and lots compare with it.
  const box = bookMarketFrom([...cards, { id: '8', price: '24,00', text: 'Neun cofanetto volumi 1-6' }, { id: '9', price: '30,00', text: 'Neun box completo' }], { identity: { isbn: '9788834909195', title: 'NEUN 6.5' }, mode: 'isbn', selfId: '6', listingTitle: 'Neun Box Volumi 1-6 +6,5' })
  assert.deepEqual([box.kept, box.market.medianPrice], [2, 27])
  // A title without a number: another volume of the series is another book.
  const k = bookMarketFrom([{ id: '1', price: '10', text: 'Blame! vol. 2' }, { id: '2', price: '11', text: 'Blame! master edition' }, { id: '3', price: '12', text: 'Blame Nihei' }, { id: '4', price: '9', text: 'BLAME' }], { identity: { title: 'Blame' }, mode: 'title' })
  assert.deepEqual([k.kept, k.market.medianPrice], [3, 11])
})

test('book: the market feeds the strategy — the resale value is the median of the same book', () => {
  const m = bookMarketFrom([{ id: '1', price: 12, text: 'a' }, { id: '2', price: 14, text: 'a' }, { id: '3', price: 10, text: 'a' }, { id: '4', price: 16, text: 'a' }], { identity: { isbn: '9788865436189' }, mode: 'isbn', listPrice: 9 })
  const s = strategyFor({ listPrice: '9', category: 'books', listingSignal: 'none', itemTitle: 'Kobane Calling' }, new Date('2026-11-16T18:00:00Z'), { goal: 'resell', market: m.market, extraction: { shippingFrom: 2.29 } })
  assert.deepEqual(s.costs.resale, { amount: 13, source: 'market' })
  assert.deepEqual([s.costs.market.n, s.costs.market.medianPrice, s.costs.market.basis], [4, 13, 'isbn'])
  assert.equal(s.costs.reachable, true)
})
