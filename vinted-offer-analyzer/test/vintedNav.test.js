import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideNavigation, isCheckoutUrl, isVintedUrl, pageOf, templateOf } from '../mobile/src/services/vintedNav.js'

test('vinted browser: only Vinted, plus the checks, the sign-in providers and the payment window', () => {
  for (const u of ['https://www.vinted.it/', 'https://vinted.it/items/123-x', 'https://www.vinted.fr/catalog', 'https://www.vinted.co.uk/']) assert.ok(isVintedUrl(u), u)
  for (const u of ['https://www.vinted.it.evil.com/', 'https://notvinted.it/', 'https://www.subito.it/', 'intent://vinted']) assert.ok(!isVintedUrl(u), u)
  assert.equal(decideNavigation('https://www.vinted.it/inbox'), 'allow')
  assert.equal(decideNavigation('https://www.google.com/search?q=x'), 'block')
  assert.equal(decideNavigation('https://geo.captcha-delivery.com/captcha/'), 'allow')
  assert.equal(decideNavigation('https://accounts.google.com/o/oauth2'), 'allow')
  assert.equal(decideNavigation('intent://www.vinted.it/items/1#Intent;scheme=https;end'), 'block')
  assert.equal(decideNavigation('vinted://items/1'), 'block')
  assert.equal(decideNavigation('mailto:a@b.it'), 'external')
  // Outside a payment a bank page is blocked; within the window after a checkout page it opens, as does a bank app.
  const now = 1_000_000
  assert.equal(decideNavigation('https://acs.banca.example/3ds', { payUntil: 0, now }), 'block')
  assert.equal(decideNavigation('https://acs.banca.example/3ds', { payUntil: now + 60_000, now }), 'allow')
  assert.equal(decideNavigation('intent://pay#Intent;package=it.banca;end', { payUntil: now + 60_000, now }), 'external')
  assert.equal(decideNavigation('https://acs.banca.example/3ds', { payUntil: now - 1, now }), 'block')
  assert.equal(decideNavigation('https://www.paypal.com/checkoutnow'), 'allow')
  assert.ok(isCheckoutUrl('https://www.vinted.it/checkout?transaction_id=1'))
  assert.ok(isCheckoutUrl('https://checkoutshopper-live.adyen.com/x'))
  assert.ok(!isCheckoutUrl('https://www.vinted.it/items/1-x'))
})

test('vinted browser: what a page is, and the address kept for the log', () => {
  assert.deepEqual(pageOf('https://www.vinted.it/items/10655918070-pyongyang?referrer=catalog'), { type: 'item', id: '10655918070' })
  assert.deepEqual(pageOf('https://www.vinted.it/member/12345-mario'), { type: 'member', id: '12345' })
  assert.equal(pageOf('https://www.vinted.it/inbox/987654').type, 'conversation')
  assert.equal(pageOf('https://www.vinted.it/inbox').type, 'inbox')
  assert.equal(pageOf('https://www.vinted.it/catalog?search_text=burns').type, 'catalog')
  assert.equal(pageOf('https://www.vinted.it/').type, 'home')
  assert.equal(pageOf('https://www.vinted.it/checkout?x=1').type, 'checkout')
  assert.equal(pageOf('https://www.google.com/').type, 'external')
  assert.equal(templateOf('https://www.vinted.it/items/10655918070-pyongyang?referrer=catalog&x=2'), 'www.vinted.it/items/{id}?referrer&x')
  assert.equal(templateOf('https://www.vinted.it/inbox/987654'), 'www.vinted.it/inbox/{id}')
})
