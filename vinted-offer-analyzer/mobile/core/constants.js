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
  /** The "Fai un'offerta" button refuses anything below 60% of the listing price. */
  MAX_DISCOUNT_PCT: 40,
  /** Per-account daily cap on buyer offers. */
  OFFERS_PER_DAY: 25,
  /** The seller typically has this long to answer before the offer lapses. */
  OFFER_VALIDITY_HOURS: 24,
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
