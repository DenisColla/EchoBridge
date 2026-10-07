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

export const LISTING_AGES = [
  { id: 'unknown', label: 'Non lo so', days: 7 },
  { id: 'today', label: 'Caricato oggi', days: 0 },
  { id: 'days_2_6', label: '2–6 giorni fa', days: 4 },
  { id: 'weeks_1_2', label: '1–2 settimane fa', days: 10 },
  { id: 'weeks_2_4', label: '2–4 settimane fa', days: 21 },
  { id: 'over_month', label: 'Più di un mese fa', days: 35 },
]

export const SELLER_PROFILES = [
  { id: 'unknown', label: 'Non lo so', hint: '' },
  { id: 'new_seller', label: 'Nuovo', hint: 'Meno di 5 recensioni' },
  { id: 'expert', label: 'Esperto', hint: '5 stelle, molte vendite' },
  { id: 'inactive', label: 'Inattivo', hint: 'Ultimo accesso settimane fa' },
]

/** What the listing text says about negotiation: the strongest observable signal of the seller's intent. */
export const LISTING_SIGNALS = [
  { id: 'none', label: 'Niente di particolare', hint: '', weight: 0, blockScore: 0 },
  { id: 'fixed_price', label: 'Prezzo non trattabile', hint: '"prezzo fisso", "no offerte"', weight: -0.7, blockScore: 1.5 },
  { id: 'open_to_offers', label: 'Accetto offerte', hint: '"trattabile", "fate offerte"', weight: 0.3, blockScore: 0 },
  { id: 'clearing_out', label: 'Svuoto l\'armadio', hint: '"faccio spazio", "vendo tutto"', weight: 0.45, blockScore: 0 },
]

/** Acceptance probability vs requested discount (%), before modifiers. Interpolated in logit space. */
export const BASE_CURVE = [
  [0, 0.93], [5, 0.9], [10, 0.84], [15, 0.75], [20, 0.65], [25, 0.54],
  [30, 0.43], [35, 0.32], [40, 0.21], [50, 0.1],
]

/** Effect of the days a listing has been online on the seller's flexibility (multiplied by the category's ageMultiplier). */
export const AGE_CURVE = [
  [0, -0.4], [3, -0.2], [7, 0], [14, 0.1], [21, 0.25], [30, 0.45], [45, 0.55],
]

/** Sellers think in euros too: the absolute gap between list and target price. */
export const GAP_CURVE = [
  [3, 0.2], [8, 0.1], [25, 0], [60, -0.15], [150, -0.3], [250, -0.45],
]

/** Daily sell-through hazard multiplier by listing age (feed boost in the first days, stale after a month). */
export const ageHazardMultiplier = (ageDays) =>
  ageDays < 1 ? 2.0 : ageDays < 7 ? 1.3 : ageDays < 14 ? 1.0 : ageDays < 30 ? 0.7 : 0.4

export const RISK_BANDS = [
  { id: 'low', label: 'Basso', tone: 'good', description: 'Sconto contenuto' },
  { id: 'medium', label: 'Medio', tone: 'warn', description: 'Zona negoziabile' },
  { id: 'high', label: 'Alto', tone: 'bad', description: 'Richiede tempismo perfetto' },
]

/** Caps on the stacked modifiers so that extreme combinations stay plausible. */
export const POSITIVE_CAP = 1.2
export const NEGATIVE_CAP = -1.6

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [1, 2, 3, 4, 5]
const h = (hours, minutes = 0) => hours * 60 + minutes

/**
 * Time-of-day windows, evaluated in order (first match wins). `from` inclusive,
 * `to` exclusive, minutes of the local day. `days` uses getDay(): 0 = Sunday.
 * Italian public holidays are evaluated as Sundays. `why` is a complete sentence.
 */
export const TIME_WINDOWS = [
  { id: 'sunday_night', days: [0], from: h(21), to: h(23), weight: 0.45, tier: 'S', label: 'Domenica sera', range: '21:00–23:00', why: 'È il reset settimanale: il venditore è rilassato, cerca piccole gratificazioni e ha tempo prima del lunedì.' },
  { id: 'weeknight_late', days: [1, 2, 3, 4], from: h(21, 30), to: h(22, 30), weight: 0.35, tier: 'A', label: 'Tarda serata infrasettimanale', range: '21:30–22:30', why: 'Dopo la giornata di lavoro le difese negoziali sono al minimo e il contesto è senza fretta.' },
  { id: 'weeknight_early', days: [1, 2, 3, 4], from: h(21), to: h(21, 30), weight: 0.25, tier: 'A', label: 'Sera infrasettimanale', range: '21:00–21:30', why: 'È il picco di traffico serale di Vinted: il venditore è sull\'app e rilassato.' },
  { id: 'weeknight_end', days: [1, 2, 3, 4], from: h(22, 30), to: h(23), weight: 0.15, tier: 'B', label: 'Fine serata', range: '22:30–23:00', why: 'Il venditore è ancora sveglio e rilassato, ma inizia a staccare.' },
  { id: 'friday_night', days: [5], from: h(21), to: h(23), weight: 0.2, tier: 'B', label: 'Venerdì sera', range: '21:00–23:00', why: 'L\'umore da inizio weekend è positivo, anche se l\'attenzione è un po\' dispersa.' },
  { id: 'saturday_night', days: [6], from: h(21), to: h(23, 30), weight: 0.15, tier: 'B', label: 'Sabato sera', range: '21:00–23:30', why: 'Serata sociale: la risposta può arrivare più tardi, ma in un contesto rilassato.' },
  { id: 'sunday_afternoon', days: [0], from: h(15), to: h(19), weight: 0.15, tier: 'B', label: 'Domenica pomeriggio', range: '15:00–19:00', why: 'La pausa della domenica pomeriggio è un momento di navigazione senza fretta.' },
  { id: 'sunday_morning', days: [0], from: h(10), to: h(12, 30), weight: 0.15, tier: 'B', label: 'Domenica mattina', range: '10:00–12:30', why: 'La domenica mattina si naviga con calma, senza la pressione dei giorni lavorativi.' },
  { id: 'saturday_morning', days: [6], from: h(10), to: h(12, 30), weight: 0.05, tier: 'C', label: 'Sabato mattina', range: '10:00–12:30', why: 'Il sabato mattina è tranquillo, ma spesso occupato da commissioni.' },
  { id: 'night', days: ALL_DAYS, from: 0, to: h(7), weight: -0.2, tier: 'D', label: 'Notte', range: '00:00–07:00', why: 'Il venditore dorme: leggerà l\'offerta la mattina, di fretta e con poca voglia di trattare.' },
  { id: 'commute', days: WEEKDAYS, from: h(7), to: h(9), weight: -0.15, tier: 'C', label: 'Prima mattina lavorativa', range: '07:00–09:00', why: 'Tra uscita di casa e spostamenti non c\'è spazio per riflettere su un\'offerta.' },
  { id: 'work_morning', days: WEEKDAYS, from: h(9), to: h(12), weight: -0.25, tier: 'D', label: 'Mattina lavorativa', range: '09:00–12:00', why: 'In orario di lavoro manca il tempo per riflettere e le risposte sono secche.' },
  { id: 'pre_lunch', days: WEEKDAYS, from: h(12), to: h(12, 30), weight: -0.25, tier: 'D', label: 'Tarda mattinata', range: '12:00–12:30', why: 'Prima di pranzo la fame e la fretta rendono il venditore poco paziente.' },
  { id: 'lunch', days: WEEKDAYS, from: h(12, 30), to: h(14), weight: -0.35, tier: 'D', label: 'Pausa pranzo infrasettimanale', range: '12:30–14:00', why: 'La pausa pranzo è fretta e stress: il rischio di una reazione irritata è il più alto della giornata.' },
  { id: 'work_afternoon', days: WEEKDAYS, from: h(14), to: h(18), weight: -0.1, tier: 'C', label: 'Pomeriggio lavorativo', range: '14:00–18:00', why: 'Nel pomeriggio lavorativo l\'attenzione è frammentata.' },
  { id: 'after_dinner', days: ALL_DAYS, from: h(19, 30), to: h(21), weight: 0.05, tier: 'C', label: 'Ora di cena', range: '19:30–21:00', why: 'Dopo cena il telefono torna in mano, anche se l\'attenzione è ancora dispersa.' },
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
export const MONTH_END_WEIGHT = 0.2
export const MONTH_START_WEIGHT = -0.15

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

export const SUGGESTED_PRICE_TARGET = 0.55
export const SUGGESTED_PRICE_TARGET_HIGH_BLOCK = 0.6
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
  CLOSE_GAP_EUR: 2, // H: fixed cost of bargaining
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

/** Stamped on every decision snapshot, so the monthly report knows which engine produced each estimate. */
export const ENGINE_VERSION = '1.3.0'

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

export const LEARNING_BANDS = [
  { id: 'low', label: 'Sconto sotto il 15%' },
  { id: 'medium', label: 'Sconto 15–30%' },
  { id: 'high', label: 'Sconto oltre il 30%' },
]

/**
 * Parameters of the monthly learning loop (src/core/learning.js). All H (heuristic) unless noted: they are tuned for
 * a buyer with fewer than 15 offers a month, so every learned value starts at the engine default and moves slowly.
 * Logit units unless noted. The fit uses all history, older months weighted by a half-life.
 */
export const LEARNING = {
  HALF_LIFE_MONTHS: 6,
  PRIOR_SD: { intercept: 0.5, slope: 0.25, time: 0.35, band: 0.35, counter: 0.5 },
  /** Weighted outcomes a parameter needs before it may move at all. */
  MIN_EFFECTIVE: { intercept: 8, slope: 40, time: 6, band: 6, counter: 6, discount: 10 },
  /** Largest change applied in one month (the fit may want more: the rest waits for next month). */
  MAX_STEP: { intercept: 0.3, slope: 0.15, time: 0.2, band: 0.2, counter: 0.3, discountPct: 1 },
  BOUNDS: { intercept: [-1, 1], slope: [0.7, 1.3], time: [-0.6, 0.6], band: [-0.6, 0.6], counter: [-1, 1], discountPct: [10, 30] },
  /** Changes smaller than this are not worth a new profile (logit units, or points for the discount). */
  MIN_CHANGE: 0.02,
  MIN_CHANGE_DISCOUNT_PCT: 0.5,
  DEFAULT_DISCOUNT_PCT: 20,
  /** An offer sent with no outcome after this many days counts as "no reply" (Vinted offers lapse well before). */
  NO_REPLY_AFTER_DAYS: 7,
  /** A counter of ours with no outcome after this many days counts as not accepted. */
  COUNTER_NO_REPLY_AFTER_DAYS: 4,
  /** Exploration: share of first offers that get a small, flagged variation (user choice: about 1 in 5). */
  EXPLORE_SHARE: 0.2,
  EXPLORE_TIME_MINUTES: 60,
  EXPLORE_DISCOUNT_PTS: 2,
  /** A variation is skipped when it would cost more than this in estimated acceptance (probability points). */
  EXPLORE_MAX_COST: 0.06,
  /** Reliability table bins for the calibration sheet. */
  RELIABILITY_BINS: [0, 0.2, 0.4, 0.6, 0.8, 1.0001],
  /** Months of reports caught up at once when the app was not opened for a while. */
  MAX_CATCH_UP_MONTHS: 6,
  /**
   * Starting-discount objective (share of list price): ES(d) = p(d)·d + (1 − p(d))·[q(d)·ρ·d − (1 − q(d))·LOSS].
   * q = chance a failed first offer still ends in a deal, ρ = saving of those deals relative to the first discount,
   * LOSS = cost of losing the item (buying elsewhere at list price + 5%, as COUNTER.LOSS_PREMIUM). Priors with weight.
   * Aggressive openers (27–33%) halve q: an irritated seller rarely keeps negotiating (blockRiskAt's ramp).
   */
  CLOSE_AFTER_FAIL_PRIOR: 0.4,
  CONTINUATION_RATIO_PRIOR: 0.5,
  CONTINUATION_PRIOR_WEIGHT: 4,
  LOSS_COST_SHARE: 0.05,
  AGGRESSIVE_RAMP_PCT: [27, 33],
}
