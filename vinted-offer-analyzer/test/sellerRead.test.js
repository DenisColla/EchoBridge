import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVintedItemHtml, sellerProfileFor, wardrobeFromProbe } from '../src/core/index.js'

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
