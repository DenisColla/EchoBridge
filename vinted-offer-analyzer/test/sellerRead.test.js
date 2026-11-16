import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageFactsOf, parseVintedItemHtml, sellerProfileFor, wardrobeFromProbe } from '../src/core/index.js'

// A listing page as a logged-in visitor gets it: his own account is embedded before the seller's. The real case of
// 15 Nov: a seller with 285 reviews was read as 16 (the visitor's own), and his wardrobe was not read at all.
const page = ({ shown = true, sellerBlock = true, visitor = true } = {}) => `<html><body>
<script>self.__next_f.push([1,"${visitor ? '{\\"currentUser\\":{\\"login\\":\\"io_stesso\\",\\"business\\":true,\\"feedback_count\\":16,\\"feedback_reputation\\":0.9,\\"item_count\\":2}}' : ''}"])</script>
<header><a href="/member/999-io_stesso">Il mio profilo</a></header>
<a href="/member/123-misterbeppe"><span data-testid="profile-username">misterbeppe</span></a>
<div class="web_ui__Rating__rating" role="group" aria-label="L’utente ha ricevuto una valutazione di 5 su 5 stelle">${shown ? '<div class="web_ui__Rating__label"><span>285</span></div>' : ''}</div>
<span data-testid="seller-last-logged-in">Ultima visita 2 ore fa</span>
<script>self.__next_f.push([1,"{\\"data\\":{\\"badges\\":[{\\"type\\":\\"ACTIVE_LISTER\\"}],\\"username\\":\\"misterbeppe\\"}},{\\"data\\":{\\"badges\\":[],\\"business\\":false,\\"feedback_count\\":285,\\"feedback_reputation\\":1,${sellerBlock ? '\\"follow_action_visible\\":true' : '\\"other\\":1'}"])</script>
</body></html>`

test('seller: his reviews, his profile and his badges are read from his own box, not from the visitor\'s account', () => {
  const ex = parseVintedItemHtml(page())
  assert.equal(ex.sellerUsername, 'misterbeppe')
  assert.equal(ex.sellerFeedbackCount, 285)
  assert.equal(ex.sellerRating, 5)
  assert.equal(ex.sellerBusiness, false)
  assert.deepEqual(ex.sellerBadges, ['ACTIVE_LISTER'])
  // The profile is found by his name: the first profile link of the page is the visitor's.
  assert.equal(ex.sellerPath, '/member/123-misterbeppe')
  assert.equal(ex.sellerLastSeenDays, 2 / 24)
  // The figure is not shown next to the name: the seller's own block of the embedded data.
  assert.equal(parseVintedItemHtml(page({ shown: false })).sellerFeedbackCount, 285)
  // Neither is there, and the page holds two different figures: unknown, never the first one found.
  const unsure = parseVintedItemHtml(page({ shown: false, sellerBlock: false }))
  assert.equal(unsure.sellerFeedbackCount, null)
  assert.equal(unsure.sellerBusiness, null)
  // An anonymous page holds one figure, the seller's: read as before.
  assert.equal(parseVintedItemHtml(page({ shown: false, sellerBlock: false, visitor: false })).sellerFeedbackCount, 285)
  // A name with a dot or a dash, and no profile link for it: no guess.
  assert.equal(parseVintedItemHtml('<span data-testid="profile-username">john-noway</span><a href="/member/77-john-noway?x=1">x</a>').sellerPath, '/member/77-john-noway')
  assert.equal(parseVintedItemHtml('<span data-testid="profile-username">mario</span><a href="/member/77-mario_rossi">x</a><a href="/member/5-altro">y</a>').sellerPath, null)
})

test('seller: the profile page as it reads in November 2026', () => {
  // What the probe returns on the profile of the screenshots: «5 articoli», «19 follower», «285 recensioni»,
  // «Annunci frequenti», «Acquista set · Ottieni fino al 25% di sconto · Crea set».
  const probe = {
    kind: 'member', frequentLister: true, cards: 5, prices: ['6,00', '12,00', '9,50', '21,00', '4,00'], itemCountText: '5', followersText: '19', feedbackText: '285',
    bundleText: ' Acquista setOttieni fino al 25% di scontoCrea set5 articoli', flight: { item_count: 2, followers_count: 3, feedback_count: 16, given_item_count: 310 },
  }
  const w = wardrobeFromProbe(probe)
  // What the page shows in words wins over the embedded data (which here is somebody else's).
  assert.deepEqual([w.itemCount, w.followers, w.feedbackCount, w.soldCount], [5, 19, 285, 310])
  // Vinted now calls the bundle a «set».
  assert.deepEqual([w.bundleOffered, w.bundleDiscountPct, w.frequentLister], [true, 25, true])
  assert.equal(wardrobeFromProbe({ ...probe, bundleText: null, frequentLister: false }).bundleOffered, false)
  // A cup set in a title is not a bundle discount.
  assert.equal(wardrobeFromProbe({ ...probe, bundleText: 'Set di tazze 25% cotone' }).bundleOffered, false)
  const form = { listPrice: '6', category: 'books', listingSignal: 'none' }
  const read = sellerProfileFor({ extraction: { ...parseVintedItemHtml(page()), uploadedDays: 1, condition: 'nuovo con etichetta' }, wardrobe: w, form })
  const ids = read.traits.map((t) => t.id)
  for (const id of ['serial', 'active_lister', 'bundle', 'fresh', 'cheap', 'new_with_tags']) assert.ok(ids.includes(id), `${id} in ${ids}`)
  assert.match(read.traits.find((t) => t.id === 'serial').label, /285 recensioni/)
  // The misreading of 1.10: 16 reviews, no wardrobe → the seller looked like a private seller with nothing known.
  const misread = sellerProfileFor({ extraction: { sellerFeedbackCount: 16, uploadedDays: 1, condition: 'nuovo con etichetta' }, wardrobe: null, form })
  assert.deepEqual(misread.traits.map((t) => t.id).sort(), ['cheap', 'fresh', 'new_with_tags'])
  // The badge alone, read on the listing page.
  assert.ok(sellerProfileFor({ extraction: { sellerBadges: ['ACTIVE_LISTER'] }, form }).traits.some((t) => t.id === 'active_lister'))
  assert.ok(!sellerProfileFor({ extraction: { sellerBadges: ['SPEEDY_SHIPPING'] }, form }).traits.some((t) => t.id === 'active_lister'))
})

test('listing: «Nuovo senza cartellino» is not «nuovo con etichetta»', () => {
  // schema.org says NewCondition for both; the page's own «Condizioni» label decides (seen on real listings, Nov 2026:
  // a «Nuovo senza cartellino» book was profiled as «nuovo con etichetta: ragiona sul prezzo del negozio»).
  const ld = (shown) => `<script type="application/ld+json">{"@type":"Product","name":"Kobane Calling","offers":{"@type":"Offer","price":"17.00","priceCurrency":"EUR","itemCondition":"https://schema.org/NewCondition"}}</script><div><span>Condizioni</span><span>${shown}</span></div>`
  assert.equal(parseVintedItemHtml(ld('Nuovo senza cartellino')).condition, 'nuovo senza etichetta')
  assert.equal(parseVintedItemHtml(ld('Nuovo con cartellino')).condition, 'nuovo con etichetta')
  // No label on the page: the embedded data stays, as before.
  assert.equal(parseVintedItemHtml(ld('')).condition, 'nuovo con etichetta')
  // The label of another listing shown on the page (a card of «articoli simili») does not count.
  assert.equal(parseVintedItemHtml(ld('Nuovo con cartellino') + '<div class="card"><p>Altro fumetto</p><p>Nuovo senza cartellino</p></div>').condition, 'nuovo con etichetta')
  const form = { listPrice: '17', category: 'books', listingSignal: 'none' }
  const without = sellerProfileFor({ extraction: { ...parseVintedItemHtml(ld('Nuovo senza cartellino')), uploadedDays: 60 }, form })
  assert.ok(!without.traits.some((t) => t.id === 'new_with_tags'))
  // …so a seller who simply has not touched the price for two months is no longer «Fermo sul prezzo».
  assert.notEqual(without.archetype.id, 'firm')
  assert.equal(sellerProfileFor({ extraction: { ...parseVintedItemHtml(ld('Nuovo con cartellino')), uploadedDays: 60 }, form }).archetype.id, 'firm')
})

test('seller: the profile of the recording (16 Nov) gives a complete profile once it is read', () => {
  // What the probe reads on kokosc23's page when it waits for it to fill: 44 articoli, 7 follower, «Annunci frequenti»,
  // «Acquista set · Ottieni fino al 15% di sconto». 1.10.2 and 1.11.0 read it empty, one second after opening it.
  const probe = {
    kind: 'member', frequentLister: true, cards: 20, prices: ['30,00', '17,00', '4,00', '6,00', '8,00', '5,00', '12,00', '3,00', '9,00', '10,00'],
    itemCountText: '44', followersText: '7', feedbackText: null, bundleText: '\n\nAcquista set\n\nOttieni fino al 15% di sconto\n\nCrea set\n44 articoli\n30,00 €', flight: {},
  }
  const w = wardrobeFromProbe(probe)
  assert.deepEqual([w.itemCount, w.followers, w.bundleOffered, w.bundleDiscountPct, w.frequentLister, w.sampleCount], [44, 7, true, 15, true, 10])
  const form = { listPrice: '17', category: 'books', listingSignal: 'none' }
  const ex = { sellerFeedbackCount: 30, sellerRating: 5, sellerLastSeenDays: 31 / 1440, uploadedDays: 60, condition: 'nuovo senza etichetta', sellerBadges: ['ACTIVE_LISTER'], signals: {} }
  const read = sellerProfileFor({ extraction: ex, wardrobe: w, form })
  const blind = sellerProfileFor({ extraction: { ...ex, condition: 'nuovo con etichetta' }, wardrobe: null, form })
  assert.equal(read.confidence, 'alta')
  assert.equal(blind.confidence, 'media')
  for (const id of ['bundle', 'online', 'active_lister']) assert.ok(read.traits.some((t) => t.id === id), id)
  // The wardrobe and the right condition move the score: the seller of the recording was shown as «medio · Fermo sul prezzo».
  assert.ok(read.score > blind.score, `${read.score} > ${blind.score}`)
  assert.equal(blind.archetype.id, 'firm')
  assert.notEqual(read.archetype.id, 'firm')
})

test('seller: «Acquista set» alone is Vinted\'s button, not a discount the seller activated', () => {
  // The report of 16 Nov, 13:19 (a 230 € listing): «bundleOffered: true, bundleDiscountPct: null» and the trait
  // «+1 ha attivato lo sconto sui lotti». The button is there for every seller with two articles.
  const probe = { kind: 'member', frequentLister: true, cards: 15, prices: [], itemCountText: '15', followersText: '3', feedbackText: null, bundleText: '\nAcquista set\nRisparmia sulle spese di spedizione\nCrea set\n15 articoli', flight: {} }
  const w = wardrobeFromProbe(probe)
  assert.deepEqual([w.itemCount, w.bundleOffered, w.bundleDiscountPct], [15, false, null])
  const form = { listPrice: '230', category: 'books', listingSignal: 'none' }
  const ex = { sellerFeedbackCount: 39, sellerRating: 4.9, sellerLastSeenDays: 32 / 1440, uploadedDays: 14, condition: 'nuovo senza etichetta', sellerBadges: ['ACTIVE_LISTER', 'SPEEDY_SHIPPING'], signals: {} }
  const read = sellerProfileFor({ extraction: ex, wardrobe: w, form })
  assert.ok(!read.traits.some((t) => t.id === 'bundle'))
  assert.equal(read.score, 0.25)
  assert.equal(read.type, 'medio')
  // With a percentage the seller did activate it, and the trait says how much.
  const set = sellerProfileFor({ extraction: ex, wardrobe: wardrobeFromProbe({ ...probe, bundleText: '\nAcquista set\nOttieni fino al 15% di sconto\nCrea set' }), form })
  assert.match(set.traits.find((t) => t.id === 'bundle').label, /15%/)
  assert.equal(set.score, 1.25)
  // The old wording still counts.
  assert.equal(wardrobeFromProbe({ ...probe, bundleText: 'Sconto sui lotti attivo' }).bundleOffered, true)
})

test('extract: the set button on a listing page is not a bundle discount, a percentage next to it is', () => {
  const html = (text) => `<html><head><meta property="og:title" content="Libro"><script type="application/ld+json">{"@type":"Product","name":"Libro","offers":{"price":"230","priceCurrency":"EUR"}}</script></head><body><p>${text}</p></body></html>`
  const plain = parseVintedItemHtml(html('Acquista set Risparmia sulle spese di spedizione Crea set'))
  assert.equal(plain.signals.bundleOffered, null)
  assert.equal(plain.signals.bundleDiscountPct, null)
  const pct = parseVintedItemHtml(html('Acquista set Ottieni fino al 25% di sconto Crea set'))
  assert.deepEqual([pct.signals.bundleOffered, pct.signals.bundleDiscountPct], [true, 25])
})

test('extract: the listing page of a logged-in visitor, as its structure was shared on 16 Nov', () => {
  // «Neun Box» 20,00 € → 21,70 €, «Spedizione da 3,09 €», heart «Aggiunto ai preferiti da 4», set «fino al 20%»,
  // «Caricato 23 min fa», «Ultima visita 30 min fa». The embedded data carries the favourites of other listings too.
  const html = `<html><head><meta property="og:title" content="Neun Box Volumi 1-6 +6,5"><link rel="canonical" href="https://www.vinted.it/items/8800000001-neun-box">
  <script type="application/ld+json">{"@type":"Product","name":"Neun Box Volumi 1-6 +6,5","offers":{"price":"20.00","priceCurrency":"EUR"}}</script>
  <script>self.__next_f.push([1,"{\\"id\\":7700000009,\\"favourite_count\\":262},{\\"id\\":8800000001,\\"title\\":\\"Neun\\",\\"favourite_count\\":4}"])</script></head><body>
  <button type="button" aria-label="Aggiungi ai preferiti. Aggiunto ai preferiti da 4 " data-testid="favourite-button"><span data-testid="favourite-icon"></span><span>4</span></button>
  <div data-testid="item-price"><p>20,00 €</p></div><span data-testid="total-combined-price">21,70 €</span><span data-testid="service-fee-included-title">incl. la commissione Vinted</span>
  <div data-testid="item-attributes-upload_date"><div>Caricato</div><div>23 min fa</div></div>
  <div data-testid="item-shipping-banner"><h2 data-testid="item-shipping-banner-title">Spedizione</h2><span data-testid="item-shipping-banner-price">da 3,09 €</span></div>
  <span data-testid="profile-username">biancamaravela</span><span data-testid="seller-last-logged-in">Ultima visita 30 min fa</span>
  <div data-testid="buy-bundle-banner"><div data-testid="buy-bundle-banner--title">Acquista set</div><div data-testid="buy-bundle-banner--content">Ottieni fino al 20% di sconto</div><button data-testid="buy-bundle-banner-shop-button">Crea set</button></div>
  </body></html>`
  const ex = parseVintedItemHtml(html)
  assert.equal(ex.listPrice, 20)
  assert.equal(ex.shippingFrom, 3.09)
  assert.equal(ex.signals.interested, 4)
  assert.deepEqual([ex.signals.bundleOffered, ex.signals.bundleDiscountPct], [true, 20])
  assert.equal(ex.sellerLastSeenText, 'Ultima visita 30 min fa')
  assert.match(ex.uploadedText, /23 min fa/)
  // Without the heart the figure next to this listing's id is taken, not the first one on the page (262).
  assert.equal(parseVintedItemHtml(html.replace(/<button type="button" aria-label[\s\S]*?<\/button>/, '')).signals.interested, 4)
  // A heart nobody pressed says no number: zero, not the other listings' figure.
  assert.equal(parseVintedItemHtml(html.replace('Aggiungi ai preferiti. Aggiunto ai preferiti da 4 ', 'Aggiungi ai preferiti').replace('<span>4</span>', '')).signals.interested, 0)
  // What the live page read wins over the embedded data.
  assert.equal(parseVintedItemHtml('<html><head><meta property="og:title" content="x"></head><body></body></html>', { favourites: 7, flight: { favourite_count: 262 } }).signals.interested, 7)
})

test('extract: a clothing page as shared on 16 Nov — fixed shipping, no set discount, what the page exposes', () => {
  // «Nikeminds» 68,00 € → 72,10 €, «Spedizione 4,99 €» (no «da»), heart 15, set banner «Risparmia sulle spese di
  // spedizione» (no discount), brand, size, condition and colour as attribute blocks; the model only in the title.
  const html = `<html><head><meta property="og:title" content="Nikeminds"><link rel="canonical" href="https://www.vinted.it/items/8800000002-nikeminds">
  <script type="application/ld+json">{"@type":"Product","name":"Nikeminds","brand":{"name":"Nike"},"offers":{"price":"68.00","priceCurrency":"EUR"}}</script></head><body>
  <a data-testid="breadcrumb" href="/catalog/5-men">Uomo</a><a data-testid="breadcrumb" href="/catalog/1231-shoes">Scarpe</a><a data-testid="breadcrumb" href="https://www.vinted.it/catalog/2656-slides?brand_ids[]=53">Nike Infradito e ciabatte</a>
  <button type="button" aria-label="Aggiungi ai preferiti. Aggiunto ai preferiti da 15" data-testid="favourite-button"><span>15</span></button>
  <div data-testid="item-page-summary-plugin"><h1>Nikeminds</h1><span>42,5</span><span>Ottime</span><span>Nike</span></div><div data-testid="item-sidebar-price-container">
  <div data-testid="item-price"><p>68,00 €</p></div><span data-testid="total-combined-price">72,10 €</span></div>
  <div data-testid="item-attributes-brand"><span>Brand</span><a>Nike</a><button data-testid="item-attributes-brand-menu-button">Menu del brand</button></div>
  <div data-testid="item-attributes-size"><div>Taglia</div><div>42,5</div><button data-testid="item-attributes-size-faq-link"></button></div>
  <div data-testid="item-attributes-status"><div>Condizioni</div><div>Ottime</div></div><div data-testid="item-attributes-color"><div>Colore</div><div>Nero</div></div>
  <div data-testid="item-attributes-upload_date"><div>Caricato</div><div>3 giorni fa</div></div>
  <div data-testid="item-shipping-banner"><h2 data-testid="item-shipping-banner-title">Spedizione</h2><div data-testid="item-shipping-banner--suffix"><span data-testid="item-shipping-banner-price">4,99 €</span></div></div>
  <span data-testid="profile-username">venditore</span><span data-testid="seller-last-logged-in">Ultima visita 31 min fa</span>
  <div data-testid="buy-bundle-banner"><div data-testid="buy-bundle-banner--title">Acquista set</div><div data-testid="buy-bundle-banner--content">Risparmia sulle spese di spedizione</div><button data-testid="buy-bundle-banner-shop-button">Crea set</button></div>
  </body></html>`
  const ex = parseVintedItemHtml(html)
  assert.equal(ex.shippingFrom, 4.99)
  assert.equal(ex.signals.interested, 15)
  assert.deepEqual([ex.signals.bundleOffered, ex.signals.bundleDiscountPct], [null, null])
  // Without the element the sentence as shown still gives the fixed price, and «gratis sopra 20 €» is not one.
  assert.equal(parseVintedItemHtml(html.replace('data-testid="item-shipping-banner-price"', 'class="x"')).shippingFrom, 4.99)
  assert.equal(parseVintedItemHtml('<html><head><meta property="og:title" content="x"></head><body><p>Spedizione gratuita sopra 20 €</p></body></html>').shippingFrom, null)
  const facts = pageFactsOf(html)
  assert.deepEqual(Object.keys(facts.attributes), ['brand', 'size', 'status', 'color', 'upload_date'])
  assert.equal(facts.attributes.size, 'Taglia 42,5')
  assert.equal(facts.attributes.brand, 'Brand Nike')
  assert.deepEqual(facts.breadcrumbs[2], { text: 'Nike Infradito e ciabatte', path: '/catalog/2656-slides?brand_ids[]=53' })
  assert.equal(facts.summary, 'Nikeminds 42,5 Ottime Nike')
})
