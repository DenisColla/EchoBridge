import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideNavigation, isCheckoutUrl, isGoogleSignInUrl, isVintedUrl, pageOf, siteOf, templateOf } from '../mobile/src/services/vintedNav.js'

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

test('vinted browser: Google sign-in passes whole, with the hops across its own sites', () => {
  // The hosts of a real sign-in from the navigation log (15 Nov): the last two were blocked and Google answered «unknown error».
  const flow = [
    'https://accounts.google.com/v3/signin/identifier?opparams=x&dsh=x&access_type=offline&client_id=x&o2v=2&redirect_uri=x&response_type=code&scope=x',
    'https://accounts.google.com/v3/signin/challenge/pwd?TL=x',
    'https://accounts.google.com/v3/signin/challenge/dp?TL=x',
    'https://accounts.google.com/v3/signin/speedbump/changepassword/changepasswordnudge?TL=x',
    'https://accounts.youtube.com/accounts/SetSID?ssdc=1&sidt=x&continue=x',
    'https://accounts.google.it/accounts/SetSID?ssdc=1&sidt=x&continue=x',
    'https://accounts.google.com/v3/signin/accountchooser?access_type=offline',
  ]
  for (const u of flow) {
    assert.ok(isGoogleSignInUrl(u), u)
    assert.equal(decideNavigation(u), 'allow', u)
    assert.equal(pageOf(u).type, 'signin', u)
  }
  for (const u of ['https://accounts.google.co.uk/accounts/SetSID', 'https://accounts.google.com.br/accounts/SetSID']) assert.ok(isGoogleSignInUrl(u), u)
  // Look-alikes and Google's other sites are not the sign-in.
  for (const u of ['https://accounts.google.com.evil.com/', 'https://accounts.google.xyz/', 'https://accounts.youtube.com.evil.it/', 'https://accounts.google.com@evil.com/', 'http://accounts.google.com/', 'https://www.google.com/', 'https://www.youtube.com/', 'https://gds.google.com/web/chip']) {
    assert.ok(!isGoogleSignInUrl(u), u)
    assert.equal(pageOf(u).type, 'external', u)
  }
  for (const u of ['https://accounts.google.com.evil.com/', 'https://accounts.google.xyz/', 'https://accounts.google.com@evil.com/', 'http://accounts.google.com/']) assert.equal(decideNavigation(u), 'block', u)
  // Google's other sites open only while a sign-in is under way (a recovery reminder, a consent page), and only they do.
  const now = 1_000_000
  const open = { signInUntil: now + 60_000, now }
  for (const u of ['https://gds.google.com/web/chip', 'https://myaccount.google.com/', 'https://consent.youtube.com/', 'https://www.google.it/']) {
    assert.equal(decideNavigation(u, { now }), 'block', u)
    assert.equal(decideNavigation(u, { signInUntil: now - 1, now }), 'block', u)
    assert.equal(decideNavigation(u, open), 'allow', u)
  }
  for (const u of ['https://www.subito.it/', 'https://google.com.evil.com/', 'https://notgoogle.com/', 'http://www.google.com/', 'intent://accounts.google.com#Intent;end']) assert.equal(decideNavigation(u, open), 'block', u)
  assert.equal(siteOf('https://accounts.google.it/accounts/SetSID?x=1'), 'accounts.google.it')
  assert.equal(siteOf('intent://x'), '')
})
