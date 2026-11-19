# Vinted Offer Timing Analyzer — algorithm spec v1 (to be critiqued)

Goal: given an item + target price, estimate acceptance probability of a lowball offer on Vinted (C2C marketplace, Italy),
and pick the exact moment (weekday, time, month window) to send it, minimizing blunt refusal / block.
Vinted facts relevant: a buyer offer expires after 24h; sellers get a push notification; offers per item are limited (max ~5).

## Inputs
- category ∈ {sneakers, fast_fashion, collectible, electronics, kids, luxury}
- listPrice > 0, targetPrice > 0 (EUR)
- listingAge ∈ {unknown, today, days_2_6, weeks_1_2, weeks_2_4, over_month}   (optional)
- sellerProfile ∈ {unknown, new_seller (<5 reviews), expert_5star, inactive}   (optional)
- now: Date (device local time)

## Derived
- discountPct d = (list - target)/list*100
- riskBand: d<15 LOW, 15..30 MEDIUM, >30 HIGH. Special cases: d<=0 → "no offer needed, buy now"; d>=60 → "unrealistic" flag (still compute).

## Model: additive in logit space
logit(P) = base(d) + w_cat + w_age(ageDaysAtSend) + w_seller(d) + w_time(slot) + w_month(dayOfMonth) + w_interact
P = sigmoid(logit) clamped to [3%, 97%]

base(d): piecewise-linear interpolation of (d → P): 0→.92, 5→.90, 10→.84, 15→.75, 20→.65, 25→.55, 30→.45, 35→.35, 40→.26, 50→.14, 60→.07, 80→.03; base = logit(P)

w_cat: fast_fashion +0.35, kids +0.45, sneakers 0, electronics -0.20, collectible -0.50, luxury -0.60
w_interact: (collectible|luxury) & d>30 → -0.40 ; (fast_fashion|kids) & d>30 → +0.15
w_age(days): piecewise-linear 0→-0.40, 3→-0.20, 7→0, 14→+0.10, 21→+0.25, 30→+0.50, 45→+0.60 (cap).
   representative days: today 0, days_2_6 4, weeks_1_2 10, weeks_2_4 21, over_month 35, unknown 7 (→0).
   At send time ageDays = representative + daysWaited (optimism decays while we wait).
w_seller: new +0.20; expert: d<15 → +0.15, 15..30 → -0.10, >30 → -0.35; inactive -0.50 (+ flag "may not answer in 24h"); unknown 0
w_time(slot) (local time; windows):
   Sun 21:00-23:00 → +0.55 (tier S, weekly reset, relaxed, dopamine seeking)
   Mon-Thu 21:30-22:30 → +0.40 (tier A, post-work decision fatigue)
   Fri 21:30-22:30 → +0.20 (social evening, less attention)
   Sat 21:00-23:00 → +0.15
   Sat/Sun 10:00-12:30 → +0.10 (relaxed weekend browsing)
   any day 19:00-21:00 not covered above → +0.10
   Mon-Fri 07:00-09:00 → -0.20 (commute, rushed)
   Mon-Fri 09:00-11:30 → -0.30 (work morning, curt replies)
   Mon-Fri 12:30-14:00 → -0.45 (lunch rush, irritation)
   Mon-Fri 14:00-18:00 → -0.15
   23:00-07:00 any day → -0.35 (asleep; 24h expiry clock burns; read in a bad window)
   else 0
w_month(day): day>=25 → +0.30 (pre-salary liquidity need); day 1..5 → -0.25 (fresh salary, less flexible); day 20..24 → +0.10; else 0

## Scheduler
- Candidate slots: for each day offset k in 0..horizon, canonical send times: Sun 21:45; Mon-Thu 21:45; Fri 21:45; Sat 21:30; Sat/Sun 11:00; daily 20:00. Plus "now (+5 min)" if now is inside a positive window. Skip times in the past.
- horizon: HIGH risk 28 days (reach month-end from any date), MEDIUM 21, LOW 14.
- Availability model (item may sell to someone else while we wait):
   dailySellRate by category: fast_fashion .03, kids .025, sneakers .025, electronics .03, collectible .01, luxury .015
   × age multiplier: today 1.5, days_2_6 1.2, weeks_1_2 1.0, weeks_2_4 0.8, over_month 0.5, unknown 1.0
   availability(k) = (1 - rate)^k
- Response factor: inactive seller → 0.6 (chance they even open it within 24h) applied to expected value only.
- utility(slot) = P_accept(slot) × availability(k) × responseFactor
- Output "optimal" = argmax utility. Output "quick" = best slot within next 48h if different day from optimal.
- Headline percentage shown = P_accept(optimal slot). Secondary line: "Disponibilità stimata tra k giorni: xx%" when k>=2.

## Block / blunt refusal risk (separate from acceptance)
blockScore = (d>30 ? 2 : d>=15 ? 1 : 0) + ((luxury|collectible) ? 1 : 0) + (slot in lunch/morning ? 1 : 0) + (new_seller ? 0.5 : 0) + (d>=50 ? 1 : 0)
→ LOW <1.5, MEDIUM <3, HIGH >=3

## Extra outputs
- Factor breakdown: for each active factor show label + approx effect in percentage points (P with factor − P without, at optimal slot).
- Suggested price: if P_accept(optimal) < 0.55, find the smallest discount d' ≤ d such that P ≥ 0.55 → "Alza a X € per superare il 55%".
- Two-step tip for HIGH risk: open 5-8% below target to leave room for a counter-offer (only if offers remaining allow).
- Message templates (Italian), 3 tones: cordiale / diretto / acquisto immediato; recommended tone: LOW→diretto, MEDIUM→cordiale, HIGH→acquisto immediato (pay now, ship tomorrow). Placeholders {prezzo}, {articolo}.
- Reasoning text: templated Italian sentence combining discount band, chosen time window psychology, month window, age/category.

## Portability constraints
Pure JS core (no DOM, no Intl dependency, manual it-IT date names), React UI separate; must work in React Native later.
