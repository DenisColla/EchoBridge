// Italian text helpers for the offline command parser: normalization,
// tokenization, a light stemmer (number / gender endings), typo distance,
// numbers in words and the closed word classes (articles, prepositions, verbs
// of the commands, relations, colours, pronouns). Pure functions and data: no
// DOM, no three.js (unit-testable in Node).

/** Lower case, no accents, typographic apostrophes unified. */
export function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[’‘`´]/g, "'").normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Tokens of a command: [{w (normalized word), raw (original spelling), s (stem)}].
 * Elisions are split ("l'uomo" -> "l", "uomo"; "sull'erba" -> "sull", "erba"),
 * sentence punctuation becomes a "," token (clause break), "t-shirt" -> "tshirt",
 * "35mm" -> "35", "mm", "3/4" stays one token.
 */
export function tokenize(text) {
  const out = [];
  const src = String(text ?? '').replace(/[’‘`´]/g, "'");
  // keep the original spelling of each word (names: "chiamata Anna")
  const re = /(\d+\/\d+)|(\d+(?:[.,]\d+)?)|([A-Za-zÀ-ÖØ-öø-ÿ]+(?:-[A-Za-zÀ-ÖØ-öø-ÿ]+)*)('?)|([,;:.!?\n]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) { out.push(tok(m[1], m[1])); continue; }
    if (m[2]) { out.push(tok(m[2].replace(',', '.'), m[2])); continue; }
    if (m[5]) { if (out.length && out[out.length - 1].w !== ',') out.push(tok(',', m[5])); continue; }
    let raw = m[3];
    let w = norm(raw);
    if (/^(t-?shirt|t-?shirts)$/.test(w)) w = 'tshirt';
    else if (w.includes('-')) {
      // "kung-fu", "blu-scuro": separate words
      for (const part of raw.split('-')) if (part) out.push(tok(norm(part), part));
      continue;
    }
    // "35mm", "50mm" come as two regex matches already; "anni60" etc. are rare
    out.push(tok(w, raw));
  }
  while (out.length && out[out.length - 1].w === ',') out.pop();
  while (out.length && out[0].w === ',') out.shift();
  return out;
}

function tok(w, raw) { return { w, raw, s: stem(w) }; }

/**
 * Light Italian stemmer for matching nouns and adjectives across number and
 * gender: drops the final vowel ("sedia" / "sedie" -> "sedi", "nero" / "neri" ->
 * "ner") and the "h" kept for the hard sound ("bianchi" -> "bianc"). Short words
 * (<= 3 letters: "blu", "bar", "tv") are kept as they are.
 */
export function stem(w) {
  if (!w || w.length <= 3 || /\d/.test(w)) return w;
  let s = w;
  if (/[aeiou]$/.test(s)) s = s.slice(0, -1);
  if (/[cg]h$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** Stems equal, or one a 1-letter extension of the other (min 4 letters). */
export function stemEq(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) !== 1 || Math.min(la, lb) < 4) return false;
  return la < lb ? b.startsWith(a) : a.startsWith(b);
}

/** Optimal string alignment distance (Damerau-Levenshtein, adjacent swaps), capped at max+1. */
export function editDistance(a, b, max = 2) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let p2 = new Array(lb + 1).fill(0), p1 = new Array(lb + 1), cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) p1[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let best = i;
    for (let j = 1; j <= lb; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    const t = p2; p2 = p1; p1 = cur; cur = t;
  }
  return p1[lb];
}

/** Typo tolerance for a word length: 0 below 5 letters, 1 up to 8, 2 above. */
export function typoBudget(len) { return len < 5 ? 0 : len < 9 ? 1 : 2; }

// ---------------------------------------------------------------- numbers
export const NUMBER_WORDS = {
  zero: 0, un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
  undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19, venti: 20,
  trenta: 30, quaranta: 40, cinquanta: 50, novanta: 90, cento: 100,
};
/** Vague quantities -> count. */
export const QUANTIFIERS = {
  'un paio di': 2, 'un paio': 2, 'una coppia di': 2, 'qualche': 3, alcuni: 3, alcune: 3, 'un po di': 3, diversi: 4, diverse: 4,
  molti: 5, molte: 5, tanti: 5, tante: 5, 'una fila di': 4, 'un gruppo di': 4, 'una serie di': 4, parecchi: 5, parecchie: 5,
};

// ---------------------------------------------------------------- articles & prepositions
// def: definite (refers to something that may exist), g: gender m/f, pl: plural
export const ARTICLES = {
  il: { def: true, g: 'm' }, lo: { def: true, g: 'm' }, la: { def: true, g: 'f' }, l: { def: true }, i: { def: true, g: 'm', pl: true },
  gli: { def: true, g: 'm', pl: true }, le: { def: true, g: 'f', pl: true },
  un: { def: false, g: 'm', n: 1 }, uno: { def: false, g: 'm', n: 1 }, una: { def: false, g: 'f', n: 1 },
  dei: { def: false, g: 'm', pl: true }, degli: { def: false, g: 'm', pl: true }, delle: { def: false, g: 'f', pl: true },
  questo: { def: true, g: 'm' }, questa: { def: true, g: 'f' }, quel: { def: true, g: 'm' }, quello: { def: true, g: 'm' }, quella: { def: true, g: 'f' }, quell: { def: true },
  quei: { def: true, pl: true }, quegli: { def: true, pl: true }, quelle: { def: true, g: 'f', pl: true }, questi: { def: true, pl: true }, queste: { def: true, g: 'f', pl: true },
  mio: { def: true, g: 'm' }, mia: { def: true, g: 'f' },
};
/** Articulated prepositions -> {p: preposition, def, g, pl}. */
export const PREP_ART = (() => {
  const o = {};
  const forms = { l: {}, il: { g: 'm' }, lo: { g: 'm' }, la: { g: 'f' }, i: { g: 'm', pl: true }, gli: { g: 'm', pl: true }, le: { g: 'f', pl: true } };
  const table = {
    di: ['dell', 'del', 'dello', 'della', 'dei', 'degli', 'delle'],
    a: ['all', 'al', 'allo', 'alla', 'ai', 'agli', 'alle'],
    da: ['dall', 'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle'],
    in: ['nell', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle'],
    su: ['sull', 'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle'],
    con: ['coll', 'col', 'collo', 'colla', 'coi', 'cogli', 'colle'],
  };
  const keys = Object.keys(forms);
  for (const [p, list] of Object.entries(table)) list.forEach((w, k) => { o[w] = { p, def: true, ...forms[keys[k]] }; });
  return o;
})();
export const PREPOSITIONS = new Set(['di', 'a', 'ad', 'da', 'in', 'su', 'con', 'per', 'tra', 'fra', 'verso', 'sopra', 'sotto', 'dietro', 'davanti', 'accanto', 'vicino', 'contro', 'dentro', 'fuori']);

// ---------------------------------------------------------------- verbs of the commands
// intent: add | remove | turn | move | dress | color | camera | light | look | pose | face | sit | select | undo
// Verb forms are listed with their common clitic variants ("girala", "mettimi").
const V = (intent, words) => words.split(/\s*,\s*/).map((w) => [w, intent]);
export const INTENT_PHRASES = [
  ...V('add', 'metti, mettere, mettimi, mettici, mettiamo, metta, metteresti, aggiungi, aggiungere, aggiungimi, aggiungici, aggiungiamo, aggiunga, inserisci, inserire, inseriscimi, posiziona, posizionare, piazzami, voglio, vorrei, crea, creare, creami, creiamo, genera, generami, disegna, disegnami, fammi, fai, fate, ci vuole, ci vogliono, ci sia, ci siano, c e, ci sono, serve, servono, dammi, prepara, preparami, costruisci, costruiscimi, butta, buttami, schiaffa, mostrami, carica, caricami, ho bisogno di, mi serve, mi servono, aggiungerei, metterei, portami, voglio vedere, falla, fallo, falli, falle, fagli, fate in modo che'),
  ...V('remove', 'togli, togliere, toglimi, toglila, toglilo, toglili, togliamo, rimuovi, rimuovere, rimuovila, rimuovilo, elimina, eliminare, eliminala, eliminalo, cancella, cancellare, cancellala, cancellalo, leva, levare, levami, levala, levalo, butta via, porta via, manda via, sbarazzati di, fai sparire, svuota'),
  ...V('turn', 'gira, girare, girala, giralo, girali, girale, girati, giriamo, ruota, ruotare, ruotala, ruotalo, volta, voltare, voltala, voltalo, orienta, orientala, orientalo, rivolgi, fai girare, falla girare, fallo girare'),
  ...V('move', 'sposta, spostare, spostala, spostalo, spostali, sposti, muovi, muovere, muovila, muovilo, avvicina, avvicinala, avvicinalo, allontana, allontanala, allontanalo, trascina, metti piu in la'),
  ...V('dress', 'vesti, vestire, vestila, vestilo, mettile, mettigli, falle indossare, fagli indossare, indossa, indossare, cambiale, cambiagli'),
  ...V('color', 'colora, colorare, colorala, coloralo, dipingi, dipingila, dipingilo, tingi, cambia colore, cambia il colore, rendi, rendila, rendilo'),
  ...V('camera', 'inquadra, inquadrare, inquadrala, inquadralo, inquadrali, inquadrami, riprendi, riprendila, riprendilo, zooma, zoom, fai uno zoom, avvicinati, allontanati, stringi, allarga, mostra, mostrami'),
  ...V('light', 'illumina, illuminare, illuminala, accendi, spegni'),
  ...V('look', 'guarda, guardare, guardi, guardano, fai guardare, falla guardare, fallo guardare, guardate, fissa, osserva'),
  ...V('select', 'seleziona, selezionare, selezionala, selezionalo'),
  ...V('undo', 'annulla, annullare, torna indietro, disfa'),
];
/** Clitic suffix of a verb form -> gender of the object (la = her / it f., lo = him / it m.). */
export function cliticOf(w) {
  const m = /(?:[aeiu])(la|lo|li|le|gli|mi|ci)$/.exec(w);
  if (!m) return null;
  return { la: 'f', lo: 'm', li: 'm', le: 'f', gli: 'm', mi: null, ci: null }[m[1]] ?? null;
}

// ---------------------------------------------------------------- spatial relations
// rel ids: left right front behind beside near on under center corner wall between around toward in hand floor
// Each phrase may be followed by an article/preposition ("a sinistra del tavolo").
const R = (rel, words, extra = {}) => words.split(/\s*,\s*/).map((w) => [w, { rel, ...extra }]);
export const RELATION_PHRASES = [
  ...R('left', 'a sinistra, alla sinistra, sulla sinistra, sinistra, verso sinistra, a manca, alla sua sinistra, sul lato sinistro, sul lato sinistro di'),
  ...R('right', 'a destra, alla destra, sulla destra, destra, verso destra, alla sua destra, sul lato destro, sul lato destro di'),
  ...R('front', 'davanti, davanti a, di fronte, di fronte a, dinanzi, innanzi, avanti, in primo piano'),
  ...R('behind', 'dietro, dietro a, dietro di, alle spalle di, alle sue spalle, sullo sfondo, in fondo, nel retro'),
  ...R('beside', 'accanto, accanto a, di fianco, di fianco a, a fianco, a fianco di, affianco, affianco a, al fianco di, insieme a, assieme a, al lato di, ai lati di, di lato a'),
  ...R('near', 'vicino, vicino a, vicini, vicine, vicina, presso, nei pressi di, poco lontano da, non lontano da'),
  ...R('on', 'sopra, sopra a, sopra il, su, in cima a, in cima, addosso a, sull'),
  ...R('under', 'sotto, sotto a, sotto il, sotto la, al di sotto di, sotto di'),
  ...R('center', 'al centro, nel centro, in centro, in mezzo, nel mezzo, al centro di, in mezzo a, nel mezzo di'),
  ...R('corner', 'nell angolo, in un angolo, in angolo, all angolo, nello spigolo, in fondo all angolo'),
  ...R('wall', 'contro il muro, contro la parete, contro al muro, al muro, alla parete, lungo il muro, lungo la parete, appoggiato al muro, appoggiata al muro, appoggiato alla parete, appoggiata alla parete, addossato al muro, addossata al muro, a muro, a parete, sulla parete, sul muro'),
  ...R('between', 'tra, fra, in mezzo tra, in mezzo fra'),
  ...R('around', 'intorno, intorno a, attorno, attorno a, tutto intorno, in cerchio intorno a, in cerchio'),
  ...R('toward', 'verso, rivolto verso, rivolta verso, girato verso, girata verso, in direzione di, in direzione'),
  ...R('hand', 'in mano, nella mano, nelle mani, tra le mani, in pugno, impugna, impugnando, tiene in mano, tenendo, regge, reggendo, stringe'),
  ...R('floor', 'a terra, per terra, sul pavimento, sul prato, sull erba, in terra'),
  ...R('in', 'dentro, dentro a, all interno di, all interno, nel, nella, in'),
  ...R('row', 'in fila, in riga, in linea, uno accanto all altro, una accanto all altra, uno dietro l altro'),
];
/** Pronouns referring to something already mentioned. */
export const PRONOUNS = {
  lui: { g: 'm', ref: 'character' }, lei: { g: 'f', ref: 'character' }, loro: { pl: true }, esso: { g: 'm' }, essa: { g: 'f' },
  quello: { g: 'm' }, quella: { g: 'f' }, questo: { g: 'm' }, questa: { g: 'f' }, egli: { g: 'm', ref: 'character' }, ella: { g: 'f', ref: 'character' },
  entrambi: { pl: true, both: true }, entrambe: { pl: true, both: true, g: 'f' }, tutti: { pl: true, all: true }, tutte: { pl: true, all: true, g: 'f' },
};
export const ORDINALS = { primo: 1, prima: 1, secondo: 2, seconda: 2, terzo: 3, terza: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5, ultimo: -1, ultima: -1, nuovo: -1, nuova: -1 };

// ---------------------------------------------------------------- colours
// Hex values chosen to read well on fabric / props in every render style.
export const COLORS = {
  bianco: '#f2f1ec', nero: '#1c1c1f', grigio: '#86888c', rosso: '#c0392b', rosa: '#e88aa8', fucsia: '#d0368a', arancione: '#e67e22', arancio: '#e67e22',
  giallo: '#f1c40f', oro: '#c9a227', dorato: '#c9a227', beige: '#d8c3a5', crema: '#efe6cf', panna: '#f3ecdc', avorio: '#f3ecdc', sabbia: '#d7c49e',
  marrone: '#6b4423', cammello: '#b0814e', cioccolato: '#4a2c1a', verde: '#2e8b57', oliva: '#6b6e3a', militare: '#5b5e45', smeraldo: '#1f8a5b',
  azzurro: '#5dade2', celeste: '#8ec9ea', blu: '#2c4f9e', turchese: '#1abc9c', viola: '#6a3a9e', lilla: '#b39ddb', lavanda: '#b39ddb', porpora: '#7a1f4f',
  bordeaux: '#6d1a24', bordo: '#6d1a24', argento: '#c0c4c8', argentato: '#c0c4c8', cachi: '#b8a77a', kaki: '#b8a77a', senape: '#c9a227', corallo: '#f08070',
  petrolio: '#1f5e66', tortora: '#a89a8e', antracite: '#2f3338', ruggine: '#9c4a1c', salmone: '#f4a582', menta: '#98d8b8',
  bianca: '#f2f1ec', nera: '#1c1c1f', grigia: '#86888c', rossa: '#c0392b', gialla: '#f1c40f', azzurra: '#5dade2', dorata: '#c9a227',
};
/** Multi-word colours (checked before single words). */
export const COLOR_PHRASES = {
  'blu scuro': '#1f2a44', 'blu notte': '#1a2238', 'blu navy': '#1f2a44', navy: '#1f2a44', 'blu elettrico': '#2a5cff', 'verde scuro': '#1e4d2b', 'verde chiaro': '#8fd18a',
  'verde acqua': '#3fb8a5', 'verde militare': '#5b5e45', 'grigio chiaro': '#bdbdbd', 'grigio scuro': '#4a4a4d', 'rosso scuro': '#7a1f24', 'rosso fuoco': '#d4271c',
  'rosa chiaro': '#f4c2d0', 'rosa antico': '#c48b8b', 'azzurro chiaro': '#a8d8f0', 'marrone chiaro': '#a0754f', 'marrone scuro': '#3f2a1c', 'giallo ocra': '#c99a2e',
  'bianco sporco': '#e9e4d8', 'color crema': '#efe6cf', 'a righe': null, 'a quadri': null, 'a fiori': null,
};
/** "chiaro" / "scuro" after a colour. */
export function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (k > 1) { r += (255 - r) * (k - 1); g += (255 - g) * (k - 1); b += (255 - b) * (k - 1); } else { r *= k; g *= k; b *= k; }
  const h = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

// ---------------------------------------------------------------- words that never take part in fuzzy matching
export const FUNCTION_WORDS = new Set([
  ...Object.keys(ARTICLES), ...Object.keys(PREP_ART), ...PREPOSITIONS, ...Object.keys(PRONOUNS), 'e', 'ed', 'o', 'oppure', 'poi', 'che', 'chi', 'cui', 'non', 'piu', 'meno',
  'molto', 'poco', 'tutto', 'tutti', 'tutta', 'tutte', 'anche', 'pure', 'ancora', 'gia', 'ora', 'adesso', 'subito', 'qui', 'qua', 'li', 'la', 'ci', 'si', 'mi', 'ti', 'vi', 'ne',
  'per', 'favore', 'grazie', 'ok', 'okay', 'bene', 'allora', 'dunque', 'quindi', 'infine', 'dopo', 'prima', 'mentre', 'come', 'dove', 'quando', 'sua', 'suo', 'suoi', 'sue',
  'ha', 'hanno', 'ho', 'e', 'sono', 'sta', 'stanno', 'sia', 'essere', 'avere', 'con', 'senza', 'nel', 'cosi', 'proprio', 'davvero', 'tipo', 'po', 'bello', 'bella',
  'nuovo', 'nuova', 'altro', 'altra', 'altri', 'altre', 'stesso', 'stessa',
]);
/** Fillers dropped before parsing ("per favore", "dai"). */
export const FILLERS = new Set(['per favore', 'perfavore', 'grazie', 'dai', 'ecco', 'allora', 'ok', 'okay', 'ehm', 'uhm', 'beh', 'mah', 'tipo', 'diciamo', 'insomma', 'praticamente', 'magari', 'pure', 'anche', 'ora', 'adesso', 'subito']);
