/**
 * Domain constants: categories, listing ages, seller profiles, listing signals,
 * time windows and the weights of the scoring matrix. Weights are in logit
 * units (0.4 ≈ +10 percentage points around a 50% base probability).
 *
 * Icons are referenced by Lucide icon NAME so this module stays UI-agnostic
 * (the web UI maps them to lucide-react, a React Native UI to lucide-react-native).
 */

/* ───────── Vinted mechanics (verified October 2026; keep configurable) ───────── */
export const VINTED = {
  /** The "Fai un'offerta" button refuses anything below 60% of the listing price (seller counters included). */
  MAX_DISCOUNT_PCT: 40,
  /** Per-account daily cap on buyer offers. */
  OFFERS_PER_DAY: 25,
  /** Heuristic, not a Vinted rule: Vinted states no official expiry for offers. Used to plan around a prudent 24 hours. */
  OFFER_VALIDITY_HOURS: 24,
  /** Buyer fee ("Commissione Vinted", formerly buyer protection): 5% of the price + 0,70 €, shipping excluded. */
  BUYER_FEE_PCT: 5,
  BUYER_FEE_FIXED: 0.7,
}

/** Assumptions about counter-offers that Vinted does not document: configurable, and the plans stay sensible either way. */
export const VINTED_ASSUMED = {
  /** Shortest public claim for a seller counter; null = assume no expiry. Users report that counters do not lapse. */
  COUNTER_VALIDITY_HOURS: 24,
  /** Users report that only the latest offer counts: a new buyer offer may cancel the seller's personal price. */
  NEW_OFFER_REPLACES_COUNTER: true,
}

export const CATEGORIES = [
  { id: 'sneakers', label: 'Sneakers', hint: 'Scarpe sportive, anche hype', icon: 'Footprints', weight: 0, dailySellRate: 0.02, ageMultiplier: 1.0, premium: false, disposable: false },
  { id: 'fast_fashion', label: 'Fast fashion', hint: 'Zara, H&M, Shein, abbigliamento comune', icon: 'Shirt', weight: 0.35, dailySellRate: 0.012, ageMultiplier: 1.2, premium: false, disposable: true },
  { id: 'collectible', label: 'Collezionismo', hint: 'Oggetti rari, vintage, carte', icon: 'Gem', weight: -0.5, dailySellRate: 0.006, ageMultiplier: 0.5, premium: true, disposable: false },
  { id: 'electronics', label: 'Elettronica', hint: 'Smartphone, console, cuffie', icon: 'Smartphone', weight: -0.2, dailySellRate: 0.025, ageMultiplier: 1.1, premium: false, disposable: false },
  { id: 'kids', label: 'Bambini', hint: 'Vestiti e accessori per bambini', icon: 'Baby', weight: 0.4, dailySellRate: 0.01, ageMultiplier: 1.2, premium: false, disposable: true },
  { id: 'luxury', label: 'Lusso', hint: 'Borse e capi high-end', icon: 'Crown', weight: -0.6, dailySellRate: 0.008, ageMultiplier: 0.7, premium: true, disposable: false },
  { id: 'other', label: 'Altro', hint: 'Casa, libri, sport, accessori', icon: 'Package', weight: 0, dailySellRate: 0.015, ageMultiplier: 1.0, premium: false, disposable: false },
]

/**
 * `days` is the count the engine scores the bucket at; `maxDays` the bucket's exclusive upper bound (null = unknown),
 * the thresholds extract.js listingAgeGuess maps a day count read from the page with.
 */
export const LISTING_AGES = [
  { id: 'unknown', label: 'Non lo so', days: 7, maxDays: null },
  { id: 'today', label: 'Caricato oggi', days: 0, maxDays: 1 },
  { id: 'days_2_6', label: '2–6 giorni fa', days: 4, maxDays: 7 },
  { id: 'weeks_1_2', label: '1–2 settimane fa', days: 10, maxDays: 14 },
  { id: 'weeks_2_4', label: '2–4 settimane fa', days: 21, maxDays: 30 },
  { id: 'over_month', label: 'Più di un mese fa', days: 35, maxDays: Infinity },
]

export const SELLER_PROFILES = [
  { id: 'unknown', label: 'Non lo so', hint: '' },
  { id: 'new_seller', label: 'Nuovo', hint: 'Meno di 5 recensioni' },
  { id: 'expert', label: 'Esperto', hint: '5 stelle, molte vendite' },
  { id: 'quiet', label: 'Poco attivo', hint: 'Ultimo accesso da 3 a 13 giorni fa' },
  { id: 'inactive', label: 'Inattivo', hint: 'Ultimo accesso da 2 settimane o più' },
]

/** What the listing text says about negotiation: the strongest observable signal of the seller's intent. */
export const LISTING_SIGNALS = [
  { id: 'none', label: 'Niente di particolare', hint: '', weight: 0, blockScore: 0 },
  { id: 'fixed_price', label: 'Prezzo non trattabile', hint: '"prezzo fisso", "no offerte"', weight: -0.7, blockScore: 1.5 },
  { id: 'open_to_offers', label: 'Accetto offerte', hint: '"trattabile", "fate offerte"', weight: 0.3, blockScore: 0 },
  { id: 'clearing_out', label: 'Svuoto l\'armadio', hint: '"faccio spazio", "vendo tutto"', weight: 0.45, blockScore: 0 },
]

/**
 * Acceptance probability vs requested discount (%), before modifiers. Interpolated in logit space.
 * Engine 1.4.0 prior: an eBay Best-Offer-style curve (sellers accept about half of −15% asks and few beyond −30%);
 * the residual for THIS user's sellers is learned per user by the live profile (learning.js), so the prior only has
 * to be believable for a new user. The 1.3.0 curve (0,65 at −20%) over-predicted the first month of real offers 6×.
 */
export const BASE_CURVE = [
  [0, 0.85], [5, 0.78], [10, 0.62], [15, 0.51], [20, 0.40], [25, 0.30],
  [30, 0.22], [35, 0.15], [40, 0.10], [50, 0.05],
]

/** Effect of the days a listing has been online on the seller's flexibility (multiplied by the category's ageMultiplier). */
export const AGE_CURVE = [
  [0, -0.4], [3, -0.2], [7, 0], [14, 0.1], [21, 0.3], [30, 0.5], [45, 0.65],
]

/**
 * Price band of the listing (logit on the LIST price): on a cheap item the discount is worth a few euros and the seller
 * would rather keep the price; on an expensive one there is room to negotiate. 0/8 real acceptances under 50 €.
 */
export const PRICE_BAND_CURVE = [
  [6, -0.45], [12, -0.4], [20, -0.2], [30, -0.05], [40, 0], [100, 0.1], [300, 0.1],
]

/** Sellers think in euros too: a large absolute gap between list and target price weighs on its own (large gaps only). */
export const GAP_EUR_CURVE = [
  [60, 0], [150, -0.15], [250, -0.3],
]

/**
 * Prior weights of the listing signals (engine-spec §3.2), logit. They are design values, not calibrated: every factor
 * row built from them carries `prior: true` and the record stores it, so a 'demand' family can be fitted once ≥ 10
 * records carry the field.
 *   demand      favourites / interested: none → the seller is glad of any interest; many → he expects his price;
 *               FRESH: a listing under 3 days old with 3 or more hearts is not ready to move.
 *   reduced     a price already cut: ≥ 48 h ago the seller is «in modalità vendita»; under 48 h he has just moved.
 *   views       a stale listing nobody looks at; many views and no hearts (over-priced, the seller knows); a fresh
 *               listing with heavy traffic.
 *   sellerItems logged only: hobby resellers accept bundles, not deep cuts, so the direction is ambiguous.
 */
export const SIGNAL_WEIGHTS = {
  demand: { none: 0.1, few: 0, some: -0.15, many: -0.3, fresh: -0.3 },
  reduced: { settled: 0.15, recent: -0.2 },
  views: { dead: 0.1, overpriced: 0.1, hot: -0.1 },
  sellerItems: 0,
}
/**
 * Multiplier on SIGNAL_WEIGHTS for the fields that only the hydrated DOM provides (interested, views, old price, the
 * seller's other items). They stay at 0, so the fields are logged but weigh nothing, until a real WebView dump is
 * committed as test/fixtures/vinted-item-hydrated-*.html and the parser is verified on it (engine-spec §3.1): a weight
 * on a field that is read wrongly would be worse than no weight. Bumping a value to 1 turns the factor on. Favourites
 * from the cross-channel search are not DOM-only and keep their full weight.
 */
export const DOM_SIGNAL_SCALE = { interested: 0, reduced: 0, views: 0, sellerItems: 0 }
export const SIGNAL_THRESHOLDS = { freshDays: 3, freshHearts: 3, someHearts: 4, manyHearts: 10, recentDropHours: 48, deadAgeDays: 14, deadViewsPerDay: 2, overpricedViews: 150, overpricedHearts: 2, hotDays: 3, hotViewsPerDay: 30 }

/**
 * The decision gate (engine-spec §3.3): ten ordered rules, the first match wins, evaluated before the verdict. Days,
 * hours, euros and points as the rules read them.
 */
export const GATE = {
  /** Rule 3: under this saving an offer is not worth the exchange (analyze.js MIN_MEANINGFUL_GAP_EUR). */
  MIN_GAP_EUR: 2,
  /** Rule 4: a «prezzo fisso» listing younger than this still gets seller discounts on the heart. */
  FIXED_PRICE_MAX_AGE_DAYS: 30,
  /** Rule 5: a fresh listing with hearts. */
  FRESH_DAYS: 3,
  FRESH_HEARTS: 3,
  /** Rule 6: a price cut younger than this with a discount deeper than DROP_MAX_DISCOUNT_PCT; the alternative ask. */
  RECENT_DROP_HOURS: 48,
  DROP_MAX_DISCOUNT_PCT: 10,
  DROP_OFFER_CAP_PCT: 8,
  /** Rule 7: no second offer on a listing that declined or ignored one within this many days. */
  REOFFER_BLOCK_DAYS: 14,
  /** Rule 8: last seen this many days ago or more → write first. */
  INACTIVE_DAYS: 14,
  /** Rule 9: a deep ask on a dear item → write first, unless the listing invites offers. */
  DEEP_DISCOUNT_PCT: 15,
  DEAR_LIST_PRICE_EUR: 40,
  /** How long to wait with the heart on (rules 4, 5) and after a fresh price cut (rule 6). */
  FAVOURITE_WAIT_HOURS: 72,
  DROP_WAIT_HOURS: 48,
  /** Favourite-wait value as leversFor estimates it: chance of a seller discount, its typical size (share of list). */
  FAVOURITE_DISCOUNT_P: 0.25,
  FAVOURITE_DISCOUNT_SHARE: 0.15,
}

/** UI tier from the corrected overall probability (engine-spec §3.4), highest threshold first. */
export const TIERS = [
  { id: 'strong', min: 0.45, label: 'Offri deciso' },
  { id: 'offer', min: 0.25, label: 'Offri' },
  { id: 'soft', min: 0.12, label: 'Scrivi prima o metti il cuore' },
  { id: 'no', min: 0, label: 'Non offrire' },
]

/** Message-first / offer-direct policy (engine-spec §4.1). */
export const MESSAGE_POLICY = {
  /** Write first when the seller was last seen more than this many days ago… */
  QUIET_DAYS: 3,
  /** A «quiet» seller profile (last seen 3–13 days ago) without the exact reading stands for this many days. */
  QUIET_PROFILE_DAYS: 7,
  /** …or the ask is deeper than this on an item dearer than that… */
  DEEP_DISCOUNT_PCT: 15,
  DEAR_LIST_PRICE_EUR: 40,
  /** …or the listing is fresh and the ask deeper than this. */
  FRESH_DAYS: 3,
  FRESH_DEEP_DISCOUNT_PCT: 10,
  /** Offer directly when the ask is small and the seller was online within a day… */
  DIRECT_MAX_DISCOUNT_PCT: 12,
  ACTIVE_WITHIN_DAYS: 1,
  /** …or the listing is old and the tier says «Offri». */
  OLD_LISTING_DAYS: 14,
  /** Bundle: the seller has this many items and the user flagged another one. */
  BUNDLE_MIN_SELLER_ITEMS: 2,
  /** The optional case is a coin toss, logged with this propensity (§5.3). */
  RANDOM_PROPENSITY: 0.5,
}

/** Daily sell-through hazard multiplier by listing age (feed boost in the first days, stale after a month). */
export const ageHazardMultiplier = (ageDays) =>
  ageDays < 1 ? 2.0 : ageDays < 7 ? 1.3 : ageDays < 14 ? 1.0 : ageDays < 30 ? 0.7 : 0.4

export const RISK_BANDS = [
  { id: 'low', label: 'Basso', tone: 'good', description: 'Sconto contenuto' },
  { id: 'medium', label: 'Medio', tone: 'warn', description: 'Zona negoziabile' },
  { id: 'high', label: 'Alto', tone: 'bad', description: 'Richiede tempismo perfetto' },
]

/**
 * Caps on the stacked modifiers so that extreme combinations stay plausible. The positive cap is tight (0,7 logit ≈
 * +16 points at 50%): optimistic factors stack on every offer, pessimistic ones rarely do.
 */
export const POSITIVE_CAP = 0.7
export const NEGATIVE_CAP = -1.6

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [1, 2, 3, 4, 5]
const h = (hours, minutes = 0) => hours * 60 + minutes

/**
 * Time-of-day windows, evaluated in order (first match wins). `from` inclusive,
 * `to` exclusive, minutes of the local day. `days` uses getDay(): 0 = Sunday.
 * Italian public holidays are evaluated as Sundays. `why` is a complete sentence.
 */
// Positive weights halved in 1.4.0: 10 of the first 12 real offers went out in the prime evening windows, so the time
// effect is not identifiable from outcomes yet; the learned time-group offsets can restore it. Negatives unchanged.
export const TIME_WINDOWS = [
  { id: 'sunday_night', days: [0], from: h(21), to: h(23), weight: 0.25, tier: 'S', label: 'Domenica sera', range: '21:00–23:00', why: 'È il reset settimanale: il venditore è rilassato, cerca piccole gratificazioni e ha tempo prima del lunedì.' },
  { id: 'weeknight_late', days: [1, 2, 3, 4], from: h(21, 30), to: h(22, 30), weight: 0.2, tier: 'A', label: 'Tarda serata infrasettimanale', range: '21:30–22:30', why: 'Dopo la giornata di lavoro le difese negoziali sono al minimo e il contesto è senza fretta.' },
  { id: 'weeknight_early', days: [1, 2, 3, 4], from: h(21), to: h(21, 30), weight: 0.15, tier: 'A', label: 'Sera infrasettimanale', range: '21:00–21:30', why: 'È il picco di traffico serale di Vinted: il venditore è sull\'app e rilassato.' },
  { id: 'weeknight_end', days: [1, 2, 3, 4], from: h(22, 30), to: h(23), weight: 0.075, tier: 'B', label: 'Fine serata', range: '22:30–23:00', why: 'Il venditore è ancora sveglio e rilassato, ma inizia a staccare.' },
  { id: 'friday_night', days: [5], from: h(21), to: h(23), weight: 0.1, tier: 'B', label: 'Venerdì sera', range: '21:00–23:00', why: 'L\'umore da inizio weekend è positivo, anche se l\'attenzione è un po\' dispersa.' },
  { id: 'saturday_night', days: [6], from: h(21), to: h(23, 30), weight: 0.075, tier: 'B', label: 'Sabato sera', range: '21:00–23:30', why: 'Serata sociale: la risposta può arrivare più tardi, ma in un contesto rilassato.' },
  { id: 'sunday_afternoon', days: [0], from: h(15), to: h(19), weight: 0.075, tier: 'B', label: 'Domenica pomeriggio', range: '15:00–19:00', why: 'La pausa della domenica pomeriggio è un momento di navigazione senza fretta.' },
  { id: 'sunday_morning', days: [0], from: h(10), to: h(12, 30), weight: 0.075, tier: 'B', label: 'Domenica mattina', range: '10:00–12:30', why: 'La domenica mattina si naviga con calma, senza la pressione dei giorni lavorativi.' },
  { id: 'saturday_morning', days: [6], from: h(10), to: h(12, 30), weight: 0.025, tier: 'C', label: 'Sabato mattina', range: '10:00–12:30', why: 'Il sabato mattina è tranquillo, ma spesso occupato da commissioni.' },
  { id: 'night', days: ALL_DAYS, from: 0, to: h(7), weight: -0.2, tier: 'D', label: 'Notte', range: '00:00–07:00', why: 'Il venditore dorme: leggerà l\'offerta la mattina, di fretta e con poca voglia di trattare.' },
  { id: 'commute', days: WEEKDAYS, from: h(7), to: h(9), weight: -0.15, tier: 'C', label: 'Prima mattina lavorativa', range: '07:00–09:00', why: 'Tra uscita di casa e spostamenti non c\'è spazio per riflettere su un\'offerta.' },
  { id: 'work_morning', days: WEEKDAYS, from: h(9), to: h(12), weight: -0.25, tier: 'D', label: 'Mattina lavorativa', range: '09:00–12:00', why: 'In orario di lavoro manca il tempo per riflettere e le risposte sono secche.' },
  { id: 'pre_lunch', days: WEEKDAYS, from: h(12), to: h(12, 30), weight: -0.25, tier: 'D', label: 'Tarda mattinata', range: '12:00–12:30', why: 'Prima di pranzo la fame e la fretta rendono il venditore poco paziente.' },
  { id: 'lunch', days: WEEKDAYS, from: h(12, 30), to: h(14), weight: -0.35, tier: 'D', label: 'Pausa pranzo infrasettimanale', range: '12:30–14:00', why: 'La pausa pranzo è fretta e stress: il rischio di una reazione irritata è il più alto della giornata.' },
  { id: 'work_afternoon', days: WEEKDAYS, from: h(14), to: h(18), weight: -0.1, tier: 'C', label: 'Pomeriggio lavorativo', range: '14:00–18:00', why: 'Nel pomeriggio lavorativo l\'attenzione è frammentata.' },
  { id: 'after_dinner', days: ALL_DAYS, from: h(19, 30), to: h(21), weight: 0.025, tier: 'C', label: 'Ora di cena', range: '19:30–21:00', why: 'Dopo cena il telefono torna in mano, anche se l\'attenzione è ancora dispersa.' },
]

/** Italian public holidays are scored as Sundays; these labels replace the Sunday-specific prose on a weekday holiday. */
export const HOLIDAY_WINDOW_LABELS = { sunday_night: 'Sera di festa', sunday_afternoon: 'Pomeriggio di festa', sunday_morning: 'Mattina di festa' }
export const HOLIDAY_WINDOW_WHY = 'È un giorno festivo: il venditore è a casa, rilassato e con tempo per valutare l\'offerta con calma, come di domenica.'

export const NEUTRAL_WINDOW = { id: 'neutral', days: ALL_DAYS, from: 0, to: h(24), weight: 0, tier: 'C', label: 'Fascia neutra', range: '', why: 'In questa fascia non c\'è nessun effetto psicologico marcato.' }

/** Canonical send times per weekday (0 = Sunday; holidays use Sunday). [hours, minutes]. */
export const CANONICAL_SLOTS = {
  0: [[11, 0], [16, 30], [21, 45]],
  1: [[21, 45]],
  2: [[21, 45]],
  3: [[21, 45]],
  4: [[21, 45]],
  5: [[21, 45]],
  6: [[11, 0], [21, 30]],
}

/** Deterministic minute offsets applied to canonical slots so that different items do not all say 21:45. */
export const JITTER_MINUTES = [-10, -5, 0, 5, 10]

export const MONTH_WINDOWS = {
  end: { id: 'month_end', label: 'Fine mese', why: 'A fine mese il budget si assottiglia e una vendita immediata vale di più.' },
  late: { id: 'month_late', label: 'Verso fine mese', why: 'Ci si avvicina a fine mese e il portafoglio comincia a farsi sentire.' },
  start: { id: 'month_start', label: 'Inizio mese', why: 'A inizio mese il venditore si sente meno pressato a vendere.' },
  mid: { id: 'month_mid', label: 'Metà mese', why: 'A metà mese non c\'è nessun effetto economico marcato.' },
}
export const MONTH_END_WEIGHT = 0.1
export const MONTH_START_WEIGHT = -0.15

/**
 * Chance the seller even opens the offer before it lapses, by activity: last seen within 3 days ("active", the default
 * for unknown sellers too), 3–13 days ("quiet"), 14 days or more ("inactive").
 */
export const ACTIVE_READ_PROBABILITY = 0.9
export const QUIET_READ_PROBABILITY = 0.75
export const INACTIVE_READ_PROBABILITY = 0.5
export const INACTIVE_TIME_DAMPING = 0.3

/** Scheduler tuning. */
export const IMPATIENCE_PER_DAY = 0.99
export const HORIZON_MIN_DAYS = 7
export const HORIZON_MAX_DAYS = 21
export const HORIZON_STALE_LISTING_DAYS = 10
export const HORIZON_AVAILABILITY_FLOOR = 0.5
export const NEAR_TIE_ABS = 0.015
export const NEAR_TIE_REL = 0.03
export const QUICK_ALTERNATIVE_MIN_HOURS = 36
export const SEND_NOW_TOLERANCE = 0.03
export const TIMING_MATTERS_SPREAD = 0.03

/**
 * The suggested price aims at a share of the BEST probability this listing can reach (the top of the price grid), never
 * below the floor: a fixed 55% target was unreachable once the engine stopped promising 65% on every −20% offer.
 */
export const SUGGESTED_PRICE_SHARE_OF_MAX = 0.75
export const SUGGESTED_PRICE_FLOOR = 0.25
export const UNCERTAINTY_PER_UNKNOWN = 0.04
export const UNCERTAINTY_MAX = 0.08
export const NEGLIGIBLE_DISCOUNT_PCT = 5

/* ───────── counter-offers (buyer's reply to a seller's "Fai il tuo prezzo") ───────── */

/**
 * Parameters of the counter-offer engine (src/core/counter.js). E = evidence, H = heuristic.
 * Core acceptance: Backus, Blake, Larsen & Tadelis 2020 (eBay Best Offer, Table 5), logistic on the share of the
 * remaining gap we concede, +0,36 at the exact split (Backus; Keniston). Delay: Fong & Waisman 2025. Response
 * latency: Cotet, Zhao & Krajbich 2025. Messages: Backus et al. 2025, Kuno 2026. Shrinking steps: Tey et al. 2021.
 * Precise numbers: Mason et al. 2013 (halved). Seller reply table: Backus Fig. 4, Keniston Table 1.
 */
export const COUNTER = {
  CORE_INTERCEPT: -0.34, // E
  CORE_SLOPE: 4.94, // E
  SPLIT_BONUS: 0.36, // E
  SPLIT_TOLERANCE_SHARE: 0.005, // E (Backus: γ = 0,50 ± 0,005)
  SPLIT_RATIO_RAMP: [0.6, 0.75], // H on E direction: the split norm fades at low offer ratios
  STANCE_CURVE: [[0, -0.5], [0.1, -0.4], [0.2, -0.25], [0.42, 0], [0.6, 0.15], [0.8, 0.25]], // H on E direction
  STANCE_THRESHOLDS: { hold: 0.02, firm: 0.2, moving: 0.45 }, // E/H
  ROUND_MEAN_SHARE: [0.42, 0.23, 0.15], // E (third extrapolated)
  PRIOR_DAMPING: 0.5, // H: the counter already reveals most of the seller's type
  DELAY_PER_DOUBLING: 0.06, // E
  DELAY_REF_HOURS: 6,
  DELAY_MIN_HOURS: 1,
  DELAY_MAX_HOURS: 20, // H: saturation
  COOLING: -0.25, // H
  COOLING_FROM_HOURS: 20,
  COOLING_TO_HOURS: 30,
  HABIT: 0.1, // H: reply at the clock time he was on the app
  HABIT_TOLERANCE_MINUTES: 60,
  HABIT_MIN_DELAY_HOURS: 12,
  HABIT_MAX_UNCERTAINTY_MINUTES: 30,
  LATENCY_COEF: 0.06, // E (halved)
  LATENCY_REF_HOURS: 1.5,
  LATENCY_MIN: -0.1,
  LATENCY_MAX: 0.15,
  MESSAGE_BONUS: 0.2, // E (conservative)
  LATE_PENALTY: -0.1, // H
  NEXT_ROUND_WINDOW: 0.25, // H: a typical good window for the next round
  COUNTER_SHARE: { hold: 0.45, firm: 0.55, moving: 0.66, flexible: 0.72 }, // E base 0,66, tilts H
  HOLD_PROB: { hold: 0.7, firm: 0.55, moving: 0.35, flexible: 0.25 }, // E/H
  MOVE_SHARE: { hold: 0.25, firm: 0.3, moving: 0.35, flexible: 0.4 }, // E/H
  EAGER_RAMP: [0.35, 0.5], // H on Lawler & MacMurray 1980 direction
  EAGER_HOLD: 0.15,
  EAGER_MOVE: 0.3,
  HOLD_PROB_MAX: 0.9,
  PRECISION_PULL: 0.07, // E (Mason 2013) halved
  RECOVER_PROB: 0.8, // H: chance he still sells at his price if we re-offer it after a breakdown
  LOSS_PREMIUM: 0.05, // H: losing the item costs a substitute at list price + search
  SELLER_REPLY_HOURS: 2, // E (Cotet medians)
  COMPETITION_MULT: 2, // H
  PUBLIC_PRICE_MULT: 1.5, // H
  RECIPROCITY_GAP_SHARE: 0.25, // E
  MIN_FIRST_SHARE: 0.15, // H: no token steps
  HOLD_MAX_SHARE: 0.35, // E
  SHRINK_MIN: 0.6, // E (Tey 2021)
  SHRINK_MAX: 0.75,
  FINAL_STEP: 0.5,
  MAX_BUYER_COUNTERS: 3, // E (Backus: 1,66 offers per thread)
  CLOSE_GAP_EUR: 3, // H: fixed cost of bargaining
  CLOSE_GAP_PCT: 5,
  MIN_SAVING_EUR: 1, // H
  MIN_SAVING_EUR_SMALL: 0.5,
  SMALL_ITEM_EUR: 20,
  MIN_SAVING_PCT: 2,
  BOLD_BAND_SHARE: 0.25, // H
  BOLD_MIN_SHARE: 0.25, // E
  MIN_DELAY_MINUTES: 60, // E (Fong & Waisman)
  MIN_DELAY_INACTIVE_MINUTES: 30, // H
  DEADLINE_MARGIN_MINUTES: 30, // H
  PLAN_HORIZON_HOURS: 30,
  STALE_AFTER_HOURS: 30,
  STALE_PLAN_HOURS: 72,
  NEAR_TIE_EUR: 0.02, // H (mirrors NEAR_TIE_REL)
  NEAR_TIE_SHARE: 0.03,
  TIGHT_GAIN_EUR: 0.15, // H
  TIGHT_GAIN_SHARE: 0.05,
  LATE_GAIN_EUR: 0.3,
  LATE_GAIN_SHARE: 0.1,
  QUIET_FROM_MINUTES: 23 * 60, // H: no sends or reminders at night
  QUIET_TO_MINUTES: 7 * 60,
  INACTIVE_READ_FLOOR: 0.5, // H
  INACTIVE_READ_TAU_HOURS: 2,
  DAILY_QUOTA_WARN: 20, // official cap 25
  FOLLOWUP_HOURS: 24, // H
  GIVEUP_HOURS: 72, // H
}

/** "Quando l'hai ricevuta?" chips: midpoint and half-width of the uncertainty, in minutes. */
export const COUNTER_RECEIVED_AGO = [
  { id: 'just_now', label: 'Adesso', minutes: 2, halfWidth: 2 },
  { id: 'within_hour', label: 'Meno di un\'ora fa', minutes: 30, halfWidth: 30 },
  { id: 'hours_1_3', label: '1–3 ore fa', minutes: 120, halfWidth: 60 },
  { id: 'hours_3_8', label: '3–8 ore fa', minutes: 330, halfWidth: 150 },
  { id: 'hours_8_16', label: '8–16 ore fa', minutes: 720, halfWidth: 240 },
  { id: 'over_16', label: 'Più di 16 ore fa', minutes: 1080, halfWidth: 120 },
]

export const COUNTER_OPTION_LABELS = { bold: 'Tiro sul prezzo', balanced: 'Consigliata', split: 'A metà strada', accept: 'Accetta e compra' }

/** How the seller moved, from the share of the gap he conceded (normalised to the first round). */
export const SELLER_STANCES = {
  hold: { label: 'Non si è mosso', why: 'Ha risposto con il prezzo pieno.' },
  firm: { label: 'Rigido', why: 'È sceso pochissimo rispetto alla distanza.' },
  moving: { label: 'Tratta', why: 'È sceso, ma meno della media.' },
  flexible: { label: 'Flessibile', why: 'È sceso almeno quanto fa di solito chi vuole chiudere.' },
}

/* ───────── monthly learning loop (calibration from the user's own outcomes) ───────── */

/**
 * Stamped on every decision snapshot and on the learned profile. A profile fitted against another engine version
 * drops its first-offer corrections (profile.js normalizeProfile): the live fit re-estimates them on the new prior.
 */
export const ENGINE_VERSION = '1.4.0'

/**
 * The 16 time windows pooled into 5 groups: with a handful of offers a month a single window never collects enough
 * outcomes, a group does. Holidays fall into the Sunday windows, so into the same groups.
 */
export const LEARNING_TIME_GROUPS = [
  { id: 'prime_evening', label: 'Sere migliori (dom e lun–gio 21–23)', windows: ['sunday_night', 'weeknight_late', 'weeknight_early', 'weeknight_end'] },
  { id: 'weekend', label: 'Weekend (ven–sab sera, sab–dom di giorno)', windows: ['friday_night', 'saturday_night', 'sunday_afternoon', 'sunday_morning', 'saturday_morning'] },
  { id: 'evening_other', label: 'Ora di cena e fasce neutre', windows: ['after_dinner', 'neutral'] },
  { id: 'daytime', label: 'Giorno lavorativo (7–18)', windows: ['commute', 'work_morning', 'pre_lunch', 'lunch', 'work_afternoon'] },
  { id: 'night', label: 'Notte (0–7)', windows: ['night'] },
]

/**
 * Discount correction as a piecewise-linear curve through three knots (flat outside 10–30%): a step per risk band
 * would make the corrected acceptance jump UP when an offer crosses 15% or 30%, which the price search would exploit.
 */
export const LEARNING_DISCOUNT_KNOTS = [
  { id: 'd10', pct: 10, label: 'Sconto intorno al 10%' },
  { id: 'd20', pct: 20, label: 'Sconto intorno al 20%' },
  { id: 'd30', pct: 30, label: 'Sconto dal 30% in su' },
]

/**
 * Parameters of the monthly learning loop (src/core/learning.js). All H (heuristic) unless noted, tuned for a buyer
 * with fewer than 15 offers a month: every learned value starts at the engine default and moves slowly. Logit units
 * unless noted. Sources for the statistical choices: priors and Laplace (Gelman 2008), recalibration before revision
 * at small n (Steyerberg 2004, Vergouwe 2017), prequential rollback (Dawid 1984, Kass & Raftery 1995), conservative
 * batched exploration (Wu 2016, Perchet 2016), counter priors from eBay field data (Backus 2020, Cotet 2025).
 */
export const LEARNING = {
  HALF_LIFE_MONTHS: 6,
  /**
   * Prior sd of each correction (logit). The intercept prior is wide (1,0): engines err by optimism and the live fit
   * must be able to reach −1 within a dozen outcomes; dslope is the live correction per 10 points of discount.
   */
  PRIOR_SD: { intercept: 1.0, dslope: 0.35, slope: 0.25, time: 0.35, disc: 0.35, counter: 0.5 },
  /** Weighted outcomes a parameter needs before it may move at all (monthly path); `discount` also gates the shift. */
  MIN_EFFECTIVE: { intercept: 8, slope: 40, time: 6, disc: 6, counter: 6, discount: 10, share: 8, latency: 8 },
  /** Largest change applied in one month (latency: multiplicative factor). Not applied to the live intercept/dslope. */
  MAX_STEP: { intercept: 0.3, slope: 0.15, time: 0.2, disc: 0.2, counter: 0.3, discountPct: 1, discountShift: 1, share: 0.1, latency: 1.5 },
  /**
   * Asymmetric intercept bounds: engines err by optimism, a user's sellers can be much tougher than the prior.
   * discountShift moves the whole policy table (policy.js) by at most 6 points either way (engine-spec §2.3).
   */
  BOUNDS: { intercept: [-3, 1.5], dslope: [-1, 0.4], slope: [0.7, 1.3], time: [-0.6, 0.6], disc: [-0.6, 0.6], counter: [-1, 1], discountPct: [10, 30], discountShift: [-6, 6], share: [0.7, 1.3], latency: [0.5, 12] },
  /**
   * Live recalibration (learning.js liveProfile): the intercept and the discount slope are re-fitted on every change
   * of the watchlist and applied at the posterior mode, with these gates instead of a monthly step.
   *   MIN_EFFECTIVE   weighted outcomes before the intercept may move; GATE_Z: |θ̂| must exceed this many posterior sd
   *   SLOPE_*         dslope needs 15 weighted outcomes spread over at least two discount arms (≥ 3 each) and a LOO gain
   *   DSLOPE_MAX      the corrected curve must keep falling with the discount (80% of the engine's 0,088 logit/point
   *                   margin, minus the part the knots may already take): in practice +0,4 per 10 points
   *   HYSTERESIS      a new value replaces the applied one only when it differs by this much (no flicker on every tap)
   *   FREEZE_DAYS     after a rollback (or «Annulla») the live values stay at the checkpoint for this long; the checkpoint
   *                   itself is the live profile applied at least this many days ago
   */
  LIVE: { MIN_EFFECTIVE: 6, GATE_Z: 1.0, SLOPE_MIN_EFFECTIVE: 15, SLOPE_MIN_PER_ARM: 3, DSLOPE_MAX: 0.4, HYSTERESIS: 0.1, FREEZE_DAYS: 30 },
  /** No move while the current value is within this many posterior sd of the target (noise). */
  EVIDENCE_GATE_SD: 0.5,
  /** The slope and the group offsets join only when leave-one-out says they predict better (nats, and ≥ 1 se). */
  LADDER_MIN_ELPD_GAIN: 1,
  /** Corrected acceptance must keep falling with the discount: engine slope ≥ 0,088 logit per point, 80% margin. */
  DISC_MIN_ENGINE_SLOPE: 0.088,
  DISC_MONOTONE_MARGIN: 0.8,
  /** Changes smaller than this are not worth a new profile (logit units, or points for the discount and the shift). */
  MIN_CHANGE: 0.02,
  MIN_CHANGE_DISCOUNT_PCT: 1,
  MIN_CHANGE_SHIFT_PTS: 0.5,
  DEFAULT_DISCOUNT_PCT: 20,
  /**
   * The slope scales the engine's logit around this value (a typical offer's logit), so a pure level shift lands in
   * the intercept and the two are nearly uncorrelated (a raw-logit slope absorbed part of every shift).
   */
  SLOPE_CENTER: 1,
  /** Prequential log Bayes factor of the active profile against its parent below which the parent comes back. */
  ROLLBACK_LOG_BF: -2,
  FREEZE_MONTHS: 1,
  /** An offer sent with no outcome after this many days counts as "no reply"; younger offers wait for the next fit. */
  NO_REPLY_AFTER_DAYS: 7,
  /** A counter of ours with no outcome after this many days counts as not accepted. */
  COUNTER_NO_REPLY_AFTER_DAYS: 4,
  /** Exploration: share of first offers that get a small, flagged variation (user choice: about 1 in 5). */
  EXPLORE_SHARE: 0.2,
  EXPLORE_TIME_MINUTES: 60,
  EXPLORE_DISCOUNT_PTS: 2,
  /** A variation is unsafe when it costs more than this in acceptance (probability points)… */
  EXPLORE_MAX_COST: 0.06,
  /** …or in expected saving (share of list price). */
  EXPLORE_MAX_SAVING_COST: 0.01,
  /** Monthly budget: total acceptance given up by variations ≤ this share of the month's total base acceptance. */
  EXPLORE_BUDGET_SHARE: 0.03,
  /** No exploration under this list price: the policy table says «non offrire» on cheap items anyway (engine-spec §5.1). */
  EXPLORE_MIN_LIST_PRICE: 12,
  /**
   * Thompson exploration (engine-spec §5): discount arms at d₀ − ARM_PTS / d₀ / d₀ + ARM_PTS around the policy default,
   * DRAWS posterior draws of [intercept, dslope], the arm sampled from the floored win shares (MIN_PROPENSITY, then
   * renormalised: the logged propensity is the real sampling probability, which an argmax under a floor would not be).
   * The deeper arm needs a corrected acceptance of at least DEEPER_MIN_P at d₀, a list price from DEEPER_MIN_LIST_PRICE
   * and a category that is not premium.
   */
  THOMPSON_ARM_PTS: 4,
  THOMPSON_DRAWS: 200,
  THOMPSON_MIN_PROPENSITY: 0.1,
  THOMPSON_DEEPER_MIN_P: 0.3,
  THOMPSON_DEEPER_MIN_LIST_PRICE: 20,
  /** Report (§5.4): the softer − base acceptance difference is shown only with this many offers in each arm. */
  THOMPSON_REPORT_MIN_PER_ARM: 6,
  /** Reliability table: equal-mass bins, between 2 and this many. */
  RELIABILITY_MAX_BINS: 5,
  /** Months of reports caught up at once when the app was not opened for a while. */
  MAX_CATCH_UP_MONTHS: 6,
  /**
   * Starting discount: iso-acceptance. The learned default is the deepest discount whose corrected acceptance, averaged
   * over the user's own items, is still at least what the plain engine gives at −20%: as far as these sellers allow,
   * at the same chance of success. The expected-saving curve below is reported, not used (its optimum sits on the
   * aggressive-offer knee, so it would not respond smoothly to the data).
   * Expected saving (share of list price): ES(d) = p(d)·d + (1 − p(d))·[q(d)·ρ·d − (1 − q(d))·LOSS].
   * q = chance a failed first offer still ends in a deal, ρ = saving of those deals relative to the first discount,
   * LOSS = cost of losing the item (buying elsewhere at list price + 5%, as COUNTER.LOSS_PREMIUM). Priors with weight.
   * Aggressive openers (27–33%) halve q: an irritated seller rarely keeps negotiating (blockRiskAt's ramp).
   */
  CLOSE_AFTER_FAIL_PRIOR: 0.4,
  CONTINUATION_RATIO_PRIOR: 0.5,
  CONTINUATION_PRIOR_WEIGHT: 4,
  LOSS_COST_SHARE: 0.05,
  AGGRESSIVE_RAMP_PCT: [27, 33],
  /** Failure reasons: engine split of "read but not accepted" (Backus 2020 replies), smoothed with the user's mix. */
  REASON_PRIOR_SPLIT: { countered: 0.45, declined: 0.35, no_reply: 0.2 },
  REASON_PRIOR_WEIGHT: 6,
  /** Chance a negotiation still closes after each kind of failed first offer (prior means, weight in outcomes). */
  CLOSE_AFTER_REASON_PRIOR: { countered: 0.6, declined: 0.1, no_reply: 0.1, sold_other: 0 },
  CLOSE_AFTER_REASON_WEIGHT: 4,
  /** Seller concession share in his first counter (Backus 2020 Table 4: 0,42–0,45), prior weight in rounds. */
  SELLER_SHARE_PRIOR: 0.42,
  SELLER_SHARE_PRIOR_WEIGHT: 8,
  /** Survival table of the seller's reply time (hours). */
  KM_HOURS: [1, 3, 6, 12, 24, 48],
}
