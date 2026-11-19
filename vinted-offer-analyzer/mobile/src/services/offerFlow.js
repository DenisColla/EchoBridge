/**
 * «Cuore e offerta con un tocco» (1.16): what runs in the page of a listing, in the visible browser, when the user
 * taps the button of a proposal. It does what the user would do by hand, in the same order and in plain sight:
 * the heart, «Fai un'offerta», the amount in Vinted's own field, «Offri». It never runs by itself.
 *
 * Before «Offri» it asks Vinted's own dialog twice: the field must read back the amount, and the total the dialog
 * shows (amount + buyer protection) must be the one the app expects. If either differs, or anything is not where it
 * should be, it stops there with the dialog open and says why: the user finishes by hand.
 *
 * The page answers with messages { type: 'offerFlow', step: 'heart' | 'typed' | 'done', … }; the last one carries
 * { ok, sent, reason, heart: 'added' | 'already' | 'missing', total, typed, said }.
 */
export const OFFER_FLOW_REASONS = {
  no_offer_button: 'non trovo «Fai un\'offerta» in questa pagina (sei entrato in Vinted? l\'annuncio è ancora in vendita?)',
  no_dialog: 'la finestra dell\'offerta non si è aperta',
  no_input: 'non trovo il campo dell\'importo nella finestra',
  check_failed: 'il totale che Vinted mostra non è quello che mi aspettavo',
  submit_disabled: 'Vinted non lascia inviare questo importo',
  not_confirmed: 'ho toccato «Offri» ma la finestra è rimasta aperta',
  error: 'qualcosa nella pagina non è andato come previsto',
}

export const offerFlowScript = ({ amount, expectedTotal, submit = true }) => `(function () {
  if (window.__ovtOfferFlow) return;
  window.__ovtOfferFlow = true;
  var AMOUNT = ${JSON.stringify(Number(amount))};
  var EXPECTED = ${JSON.stringify(Number(expectedTotal))};
  var SUBMIT = ${submit ? 'true' : 'false'};
  var post = function (o) { o.type = 'offerFlow'; o.url = location.href; try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {} };
  var q = function (id) { return document.querySelector('[data-testid="' + id + '"]'); };
  var words = function (el, max) { return el ? String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, max) : null; };
  // «945,70 €», «1.150,00 €», «16.45 €» → number.
  var money = function (text) {
    var m = String(text || '').replace(/\\s/g, '').match(/(\\d[\\d.,]*)/);
    if (!m) return null;
    var n = m[1].indexOf(',') >= 0 ? Number(m[1].replace(/\\./g, '').replace(',', '.')) : Number(m[1]);
    return isFinite(n) ? n : null;
  };
  var waitFor = function (fn, ms, then) {
    var t0 = Date.now();
    (function tick() {
      var v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return then(v);
      if (Date.now() - t0 > ms) return then(null);
      setTimeout(tick, 150);
    })();
  };
  var end = function (o) { window.__ovtOfferFlow = false; o.step = 'done'; post(o); };
  try {
    var heart = 'missing';
    var fav = q('favourite-button');
    if (fav) {
      if (/^\\s*aggiungi/i.test(String(fav.getAttribute('aria-label') || ''))) { fav.click(); heart = 'added'; } else heart = 'already';
    }
    post({ step: 'heart', heart: heart });
    var open = q('item-buyer-offer-button');
    if (!open) return end({ ok: false, reason: 'no_offer_button', heart: heart });
    setTimeout(function () {
      open.click();
      waitFor(function () { return q('offer-modal'); }, 7000, function (modal) {
        if (!modal) return end({ ok: false, reason: 'no_dialog', heart: heart });
        waitFor(function () { return q('offer-price-field--input') || q('custom-offer-price-option'); }, 4000, function (first) {
          if (!first) return end({ ok: false, reason: 'no_input', heart: heart, said: words(modal, 160) });
          if (!q('offer-price-field--input')) { var custom = q('custom-offer-price-option'); if (custom) custom.click(); }
          waitFor(function () { return q('offer-price-field--input'); }, 4000, function (input) {
            if (!input) return end({ ok: false, reason: 'no_input', heart: heart, said: words(modal, 160) });
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            input.focus();
            setter.call(input, String(AMOUNT));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            post({ step: 'typed' });
            var shownTotal = function () { var total = q('total-combined-offer-price'); return total ? money(total.textContent) : null; };
            waitFor(function () {
              var shown = shownTotal();
              return Math.abs(Number(input.value) - AMOUNT) < 0.005 && shown !== null && Math.abs(shown - EXPECTED) < 0.011 ? 'ok' : null;
            }, 5000, function (checked) {
              var total = words(q('total-combined-offer-price'), 30);
              if (!checked) return end({ ok: false, reason: 'check_failed', typed: String(input.value).slice(0, 12), total: total, heart: heart });
              var button = q('offer-submit-button');
              if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return end({ ok: false, reason: 'submit_disabled', total: total, heart: heart, said: words(modal, 160) });
              if (!SUBMIT) return end({ ok: true, sent: false, total: total, heart: heart });
              button.click();
              // Sent when the dialog goes away: Vinted then shows the conversation, or the listing again.
              waitFor(function () { return !q('offer-modal') || !/\\/items\\//.test(location.pathname); }, 9000, function (gone) {
                if (gone) return end({ ok: true, sent: true, total: total, heart: heart });
                end({ ok: false, reason: 'not_confirmed', total: total, heart: heart, said: words(q('offer-modal'), 160) });
              });
            });
          });
        });
      });
    }, heart === 'added' ? 700 : 100);
  } catch (e) {
    end({ ok: false, reason: 'error', heart: 'missing', error: String((e && e.message) || e).slice(0, 120) });
  }
})(); true;`
