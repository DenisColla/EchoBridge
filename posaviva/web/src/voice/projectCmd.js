// Project commands of the offline parser (Progetti): save, open / apply and browse
// saved items. Pure (no DOM / three.js), used by parser.js before the scene parser:
//
//   "salva la scena come Inseguimento nel progetto Noir, tavola 3"
//   "salva la donna come Nina"  ·  "salva la posa dell'uomo come Saluto"
//   "salva il paesaggio nel progetto Viaggio"  ·  "salva"
//   "apri la scena Inseguimento"  ·  "applica il paesaggio Spiaggia"
//   "inserisci il personaggio Nina"  ·  "applica la posa Saluto alla donna"
//   "apri i progetti"  ·  "apri il progetto Noir"  ·  "cerca Nina nei progetti"
//
// splitProjectCommands(text, scene) -> {text (what is left for the scene parser),
// before: Action[] (run before the rest), after: Action[] (run after it)}.
// scene: {characters: [{id, name, sex}], saved: [{id, type, name}], projects: [{id, name}]}.
//
// Action (plan.js): project {op: 'save'|'open'|'browse', what?: 'scene'|'landscape'|'character'|'pose',
//   name?, project?, section?, sectionKind?: 'capitolo'|'tavola'|'vignetta', query?, target?}

const SAVE_VERBS = 'salva|salvami|salvala|salvalo|salvali|salvare|salviamo|memorizza|memorizzala|registra|archivia|conserva|conservala|tieni';
const OPEN_VERBS = 'apri|aprimi|riapri|carica|caricami|ricarica|applica|applicami|inserisci|inseriscimi|usa|metti|mettimi|rimetti|riprendi|recupera|ripristina|richiama|torna a|torna alla|torna al';
const BROWSE_VERBS = 'apri|aprimi|mostra|mostrami|fammi vedere|vai a|vai ai|vai nei|entra nei|cerca|trova';
const ALL_VERBS = new RegExp(`^(?:${SAVE_VERBS}|${OPEN_VERBS}|${BROWSE_VERBS})\\b`);

const TYPE_WORDS = [
  ['landscape', /\b(paesaggi?o?|paesaggi|ambiente|ambientazione|sfondo|location)\b/],
  ['pose', /\bpos[ae]\b/],
  ['character', /\b(personaggi?o?|personaggi)\b/],
  ['scene', /\b(scen[ae]|tutto|lavoro|disegno)\b/],
];
const KIND_WORDS = { capitolo: 'capitolo', tavola: 'tavola', pagina: 'tavola', vignetta: 'vignetta', sezione: null, parte: null };
const STOP = '(?=\\s*(?:,|;|$)|\\s+(?:nel|nella|nello|nell|in|dentro|sotto|sul|sulla|come|con|col|chiamat[ao]|di nome|alla|al|all|allo|ai|per)\\b)';

/** Lower case without accents, same length as the input (indices stay aligned). */
export function fold(s) {
  let o = '';
  for (const ch of String(s ?? '')) o += /[’‘`´]/.test(ch) ? "'" : (ch.normalize('NFD')[0] || ch).toLowerCase();
  return o;
}
const clean = (s) => String(s || '').replace(/^[\s«"'“]+|[\s»"'”.!?]+$/g, '').trim();
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const words = (s) => fold(s).replace(/'/g, ' ').split(/\s+/).filter(Boolean);

/** Saved item whose name matches `name` (exact, then prefix, then every word), of `type` when given. */
export function matchSaved(saved, name, type = null) {
  const n = words(name).join(' ');
  if (!n) return null;
  const list = (saved || []).filter((it) => !type || it.type === type);
  const nm = (it) => words(it.name).join(' ');
  return list.find((it) => nm(it) === n) || list.find((it) => nm(it).startsWith(n) && n.length >= 3) ||
    list.find((it) => { const w = nm(it); return n.split(' ').every((x) => x.length > 1 && w.includes(x)); }) || null;
}

function typeOf(objText) {
  for (const [t, re] of TYPE_WORDS) if (re.test(objText)) return t;
  return null;
}

/** "alla donna", "a Anna", "all'uomo", "su di lei" -> character target (plan.js Target) or null. */
function characterRef(txt, scene) {
  const t = fold(txt).replace(/'/g, ' ').trim();
  if (!t) return null;
  for (const c of scene.characters || []) {
    const cn = fold(c.name);
    if (cn && (t === cn || t.endsWith(' ' + cn) || t.split(' ').includes(cn.split(' ')[0]) && /^[a-z]{3,}$/.test(cn.split(' ')[0]) && !/^(donna|uomo)$/.test(cn.split(' ')[0]))) return { kind: 'character', id: c.id };
  }
  if (/\b(donna|ragazza|signora|lei|tipa|bambina)\b/.test(t)) return { kind: 'character', type: 'F' };
  if (/\b(uomo|ragazzo|signore|lui|tizio|tipo|bambino)\b/.test(t)) return { kind: 'character', type: 'M' };
  if (/\b(selezionat[oa]|quest[oa])\b/.test(t)) return { kind: 'selected' };
  return null;
}

/** Pulls `re` (with one capture group) out of s: returns [value | null, rest]. */
function take(s, re) {
  const m = re.exec(s);
  if (!m) return [null, s];
  return [m[1], (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim()];
}

/** Project / section / name complements of a save or open clause (on the original text). */
function complements(raw) {
  let s = ' ' + raw + ' ';
  const f = () => fold(s);
  const out = {};
  // project: "nel progetto Noir", "in progetto «Viaggio»"
  {
    const m = new RegExp(`\\s(?:nel|in|dentro al|sul|al)\\s+(?:mio\\s+|nuovo\\s+)?(?:progetto|fumetto)\\s+(.+?)${STOP}`).exec(f());
    if (m) { out.project = clean(s.substr(m.index + m[0].length - m[1].length, m[1].length)); s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); }
  }
  // section: "nella tavola 3", "nel capitolo Fuga", ", tavola 2"
  {
    const m = new RegExp(`(?:\\s(?:nella|nel|in|alla|al|sotto|dentro la|dentro il)\\s+|,\\s*)(?:(?:nuova|nuovo)\\s+)?(sezione|capitolo|tavola|pagina|vignetta|parte)\\s+(.+?)${STOP}`).exec(f());
    if (m) {
      const word = m[1];
      const val = clean(s.substr(m.index + m[0].length - m[2].length, m[2].length));
      out.sectionKind = KIND_WORDS[word] || undefined;
      out.section = /^\d+$/.test(val) || !KIND_WORDS[word] ? (KIND_WORDS[word] ? cap(word === 'pagina' ? 'tavola' : word) + ' ' + val : val) : val;
      s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    }
  }
  // name: "come Inseguimento", "con il nome Nina", "chiamata «Fuga»"
  {
    const m = new RegExp(`\\s(?:come|con il nome|con nome|col nome|chiamandol[ao]|chiamandola|chiamat[ao]|di nome|dal nome|intitolat[ao])\\s+(.+?)${STOP}`).exec(f());
    if (m) { out.name = clean(s.substr(m.index + m[0].length - m[1].length, m[1].length)); s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); }
  }
  out.rest = s.replace(/\s+/g, ' ').trim();
  return out;
}

/** One clause -> project action, or null when it is not a project command. */
export function parseProjectClause(raw, scene = {}) {
  const text = clean(raw);
  const t = fold(text);
  if (!ALL_VERBS.test(t)) return null;
  // ---- browse: "apri i progetti", "mostrami l'archivio", "apri il progetto Noir", "cerca Nina nei progetti"
  {
    const m = new RegExp(`^(?:${BROWSE_VERBS})\\s+(?:(?:i|l'|l|gli|il|la|le)\\s+)?(?:miei\\s+|mio\\s+)?(progetti|archivio|progetto|salvataggi|cose salvate|elementi salvati)\\b(.*)$`).exec(t);
    if (m) {
      const o = { type: 'project', op: 'browse' };
      if (m[1] === 'progetto') { const name = clean(text.slice(t.length - m[2].length)); if (name) o.project = name; }
      return o;
    }
    const q = new RegExp(`^(?:cerca|trova)\\s+(.+?)\\s+(?:nei|tra i|fra i|nell'|nell|in)\\s*(?:progetti|archivio|salvataggi)\\b`).exec(t);
    if (q) return { type: 'project', op: 'browse', query: clean(text.substr(q[0].indexOf(q[1]), q[1].length)) };
  }
  // ---- save
  {
    const m = new RegExp(`^(${SAVE_VERBS})\\b(.*)$`).exec(t);
    if (m) {
      if (m[1] === 'tieni' && !/\bprogett/.test(t)) return null;
      const c = complements(text.slice(m[1].length));
      const obj = fold(c.rest);
      let what = typeOf(obj);
      let target = null;
      if (what === 'pose' || what === 'character' || !what) {
        // "la posa della donna", "salva Anna", "salva l'uomo"
        const of = /\b(?:di|del|della|dello|dell'|dell)\s*(.+)$/.exec(obj);
        target = characterRef(of ? of[1] : obj, scene);
        if (!what && target) what = 'character';
        if (!what && /^(salvala|memorizzala|conservala)$/.test(m[1])) what = 'scene';
      }
      const o = { type: 'project', op: 'save', what: what || 'scene' };
      for (const k of ['name', 'project', 'section', 'sectionKind']) if (c[k]) o[k] = c[k];
      if (target && (o.what === 'character' || o.what === 'pose')) o.target = target;
      return o;
    }
  }
  // ---- open / apply / insert a saved item
  {
    const m = new RegExp(`^(${OPEN_VERBS})\\s+(.*)$`).exec(t);
    if (!m) return null;
    const verb = m[1];
    let rest = text.slice(t.length - m[2].length);
    let f = fold(rest);
    // explicit: "salvato", "dai progetti", "dall'archivio", "che ho salvato"
    const explicit = /\b(salvat[aoie]|dai progetti|dal progetto|dall'archivio|dall archivio|dell'archivio|che ho salvato|mi[aeo] |miei )\b/.test(f + ' ');
    // target of a pose: "alla donna", "a Anna", "su di lui"
    let target = null;
    const tm = /\s(?:a|ad|al|alla|allo|all'|all|ai|su|sulla|sul|per)\s*(?:di\s+)?([^,]+)$/.exec(' ' + f);
    if (tm) {
      const r = characterRef(tm[1], scene);
      if (r) { target = r; rest = rest.slice(0, Math.max(0, tm.index - 1)); f = fold(rest); }
    }
    let what = null, name = '';
    const head = /^(?:(?:la|il|lo|l'|l|un|una|uno|quell[ao]|quel|mi[ao])\s*)?(?:mi[ao]\s+)?(scena|paesaggio|ambiente|ambientazione|sfondo|personaggio|posa)\b\s*(?:salvat[ao]\s*)?(?:(?:chiamat[ao]|di nome|dal nome|che si chiama)\s+)?(.*)$/.exec(f);
    if (head) {
      what = { scena: 'scene', paesaggio: 'landscape', ambiente: 'landscape', ambientazione: 'landscape', sfondo: 'landscape', personaggio: 'character', posa: 'pose' }[head[1]];
      name = clean(rest.slice(rest.length - head[2].length).replace(/\b(salvat[aoie]|dai progetti|dal progetto|dall'archivio)\b/gi, ''));
    } else {
      name = clean(rest.replace(/^(?:(?:la|il|lo|l'|l)\s*)/i, '').replace(/\b(salvat[aoie]|dai progetti|dal progetto|dall'archivio)\b/gi, ''));
    }
    if (!name) {
      // "apri la scena" / "carica la posa" without a name: the browser filtered by type
      if (what && (explicit || /^(apri|aprimi|carica|caricami|riapri)$/.test(verb))) return { type: 'project', op: 'browse', what };
      return null;
    }
    const hit = matchSaved(scene.saved, name, what);
    // only when it is clearly about a saved item: the main parser keeps "metti una posa seduta"
    if (!hit && !explicit && !(what === 'scene' && /^(apri|aprimi|riapri|carica|caricami|ricarica|torna a|torna alla)$/.test(verb))) return null;
    const o = { type: 'project', op: 'open', name };
    if (what || hit) o.what = what || hit.type;
    if (target) o.target = target;
    return o;
  }
}

const SPLIT = /\s*(?:[,;.!?]+|\b(?:e poi|poi|e quindi|quindi|dopo di che|dopodiche|e dopo|e infine|infine|e)\b)\s*/gi;
const MAYBE = /\b(salv|memorizz|registr|archivi|conserv|progett|apri|riapri|caric|applic|inserisc|usa|mett|rimett|ripren|recuper|ripristin|richiam|torna|mostr|cerca|trova|tieni)/;
const SECTION_ONLY = /^(sezione|capitolo|tavola|pagina|vignetta|parte)\s+\S+(\s+\S+)?$/;

/**
 * Splits the project clauses off a command. Clause breaks are punctuation and
 * "e / poi / quindi" before a verb; clauses that are not project commands are
 * given back to the scene parser (the original text when there is no project clause).
 */
export function splitProjectCommands(text, scene = {}) {
  const src = String(text ?? '');
  const none = { text: src, before: [], after: [] };
  if (!MAYBE.test(fold(src))) return none;
  const parts = [];
  let last = 0, m;
  SPLIT.lastIndex = 0;
  while ((m = SPLIT.exec(src))) {
    if (m[0].length === 0) { SPLIT.lastIndex++; continue; }
    parts.push({ text: src.slice(last, m.index), joint: m[0] });
    last = m.index + m[0].length;
  }
  parts.push({ text: src.slice(last), joint: '' });
  const clauses = [];
  for (const p of parts) {
    const f = fold(p.text.trim());
    const prev = clauses[clauses.length - 1];
    // "e" splits only before a verb ("una sedia e un tavolo" stays together)
    if (prev && /^\s*(e|ed)\s*$/i.test(prev.joint) && !ALL_VERBS.test(f)) { prev.text += prev.joint + p.text; prev.joint = p.joint; continue; }
    // "…nel progetto Noir, tavola 3": the section belongs to the save before it
    if (prev && SECTION_ONLY.test(f) && new RegExp(`^(${SAVE_VERBS})\\b`).test(fold(prev.text.trim()))) { prev.text += ', ' + p.text; prev.joint = p.joint; continue; }
    clauses.push({ ...p });
  }
  const before = [], after = [], kept = [];
  for (const c of clauses) {
    if (!c.text.trim()) continue;
    const a = parseProjectClause(c.text, scene);
    if (a) (kept.length ? after : before).push(a);
    else kept.push(c.text.trim());
  }
  if (!before.length && !after.length) return none;
  return { text: kept.join(', '), before, after };
}
