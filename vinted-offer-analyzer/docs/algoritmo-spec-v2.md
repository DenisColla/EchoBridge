# Spec v2 (synthesis of 3 critics + verified Vinted facts)

Verified Vinted mechanics (Oct 2026 sources): buyer offer cannot go below 60% of list (max 40% off, "offerta troppo bassa");
25 offers/day per account (old 5/day/item rule gone); seller usually has ~24h to answer; after acceptance the buyer pays within 24h;
offer sheet pre-suggests -10% / -20%.

## Inputs
itemTitle?, category ∈ {sneakers, fast_fashion, collectible, electronics, kids, luxury, other}, listPrice, targetPrice,
listingAge ∈ {unknown, today, days_2_6, weeks_1_2, weeks_2_4, over_month}, sellerProfile ∈ {unknown, new_seller, expert, inactive},
listingSignal ∈ {none, fixed_price, open_to_offers, clearing_out} (optional, from the listing text), now (device clock).

## Discount & bands (user's definition, kept)
d = (L−T)/L·100. LOW d<15 · MEDIUM 15≤d≤30 · HIGH d>30. d ≤ 0 → no offer needed. d > 40 → "over_cap": not sendable via
Offer button; show capped price ceil(L·0.6), analysis at d=40, alternatives (message / like & wait). d < 5 → tip "negligible".

## Model (logit-additive, weights scaled so Σpos ≤ +1.2 and Σneg ≥ −1.6)
base(d): logit-space interpolation of 0→.93 5→.90 10→.84 15→.75 20→.65 25→.54 30→.43 35→.32 40→.21 50→.10
category: ff +0.35 kids +0.40 sneakers 0 electronics −0.20 collectible −0.50 luxury −0.60 other 0
interaction r=clamp((d−25)/10,0,1): premium −0.40·r ; disposable +0.15·r
euro gap g=L−T (linear between knots): ≤3 +0.20 · 8 +0.10 · 25 0 · 60 −0.15 · 150 −0.30 · ≥250 −0.45
listing signal: fixed_price −0.70 · open_to_offers +0.30 · clearing_out +0.45
age curve(days): 0 −0.40 · 3 −0.20 · 7 0 · 14 +0.10 · 21 +0.25 · 30 +0.45 · 45 +0.55 ; × m_cat (ff 1.2 kids 1.2 sneakers 1 electronics 1.1 collectible 0.5 luxury 0.7 other 1)
  rows: "Anzianità annuncio" = curve(rep) ; "Effetto attesa" = curve(rep+k) − curve(rep). unknown: rep 7, k=0 weight 0, wait effect ×0.5 capped +0.15, no day count shown.
seller: new +0.20 · expert ramp (+0.15 @d≤10 → −0.10 @20, flat to 25, → −0.35 @35) · inactive 0 (pRead 0.5, time weights ×0.3) · unknown 0
time (local; holidays = Sunday): Sun 21–23 +0.45 · Mon–Thu 21:30–22:30 +0.35, 21–21:30 +0.25, 22:30–23 +0.15 · Fri 21–23 +0.20 · Sat 21–23:30 +0.15
  Sun 15–19 +0.15 · Sun 10–12:30 +0.15 · Sat 10–12:30 +0.05 · all 19:30–21 +0.05 · 00–07 −0.20 · Mon–Fri 07–09 −0.15 · 09–12 −0.25 · 12:30–14 −0.35 (worst, per user) · 12–12:30 −0.25 · 14–18 −0.10 · else 0
month (daysToEnd = daysInMonth − day): daysToEnd ≤ 6 → +0.20 ; 7..13 → linear +0.20→0 ; day 1–5 → −0.15 ; day 6–8 → linear −0.15→0 ; else 0
pAccept = 0.03 + 0.94·sigmoid(L) (soft squash, no ties). pAvailable(k) = Π_{j<k}(1 − rate·ageMult(rep+j)), rate: ff .012 kids .010 sneakers .020 electronics .025 collectible .006 luxury .008 other .015; ageMult <1d 2.0, 1–6 1.3, 7–13 1.0, 14–29 0.7, ≥30 0.4
pRead: inactive 0.5 else 1. pOverall = pAccept·pAvailable·pRead (headline). Uncertainty ±4pp per unknown optional (max ±8).
Attribution: sequential, fixed order [category, interaction, gap, signal, age, wait, seller, time, month] → rows sum exactly to P − P_base.

## Scheduler
candidates: "Adesso" (now+5, true window weight, always) + per day: 21:45 (Sat 21:30), Sun 11:00 & 16:30, Sat 11:00; dedupe same window/day; deterministic ±10 min jitter (hash of inputs, 5-min steps) inside the window.
horizon = days until pAvailable < 0.5, clamped [7, 21]; over_month → max 10. U(k) = pOverall·0.99^k. chosen = EARLIEST slot with U ≥ Umax − max(0.015, 0.03·Umax); alsoGood = Umax slot if on another day.
quick = best U within 48h, only if chosen − now > 36h. timingMatters = spread of U over top-5 distinct days ≥ 0.03.
sendNow = {ok: pOverallNow ≥ chosen.pOverall − 0.03, window, pOverall, delta, windowEndsAt, advice}. expiresAt = sendAt + 24h.
warnings: device offset ≠ Europe/Rome offset (EU DST rule) · August 1–25 vacation note.

## Block risk (chosen slot and now)
score = 2·clamp((d−27)/6,0,1) + 0.5·[d≥38] + 1·[premium] + 1.5·[fixed_price] + 0.5·[new_seller] − 0.5·[expert] + 2·max(0,−w_time(slot)) ; LOW <1 · MEDIUM <2.5 · HIGH ≥2.5 ; reasons[].

## Strategy
suggestedPrice: if pOverall(chosen) < target (0.55; 0.60 if block HIGH): search price upward from T (step 0.5 € <20, 1 € <200, 5 € otherwise), re-run scheduler, first price whose best pOverall ≥ target.
twoStep (HIGH only): needs d+6 ≤ 40, pAccept(d+6) ≥ 0.20, block(d+6) < HIGH → opening = round(T·0.94) (avoid multiples of 5) "Apri a X, chiudi a T".
tips: 24h validity + 25/day; like-first (age ≥ 7d, active seller); precise amounts; inactive → message first; block HIGH → message before offer; d<5 → buy now / ask shipping; over_cap → ask seller offer.

## Messages (sendAt-aware salutation; never criticise item/price)
cordiale (MEDIUM) · diretto (LOW; note: offer can go without message) · impegno (HIGH: "se accetti completo subito l'acquisto") · motivato (premium override: "è il massimo del mio budget").

## Output grammar
verdict by k: now-window → "Invia l'offerta adesso: la finestra buona dura fino alle 23:00"; k=0 → "stasera/oggi alle HH:MM"; k=1 → "domani sera, lunedì 5 ottobre, alle 21:45"; k≥2 → "martedì 6 ottobre alle 21:45" + "tra k giorni". Window label "tra le 21:30 e le 22:30 (ideale 21:45)". Year appended only if ≠ now. Article: dell' for 1, 8, 11, 80–89.
reasons[]: ≤3 complete Italian sentences (no "label: why" concatenation). avoid[] with rangeLabel/daysLabel from core; avoidToday; nowInAvoid.
