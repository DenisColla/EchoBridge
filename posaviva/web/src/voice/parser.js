// Offline Italian command parser: text -> plan (see plan.js). Always available,
// no network. Pure (no DOM / three.js): parse(text, lexicon, scene).
//
// Pipeline: tokenize -> tag (lexicon: longest phrases, stems, typos) -> clauses
// ("," "poi" "e" + verb) -> noun phrases with modifiers (colours, garments, hair,
// body type, pose, expression), relations ("sul divano", "a sinistra del tavolo",
// "con un cane accanto"), references ("lei", "il cane", names) -> actions.
//
// scene = {characters: [{id, name, sex}], animals: [{id, species}], props: [{id, type, label}],
//          selected: {kind, id} | null, hasLandscape, rooms: [{id}]}
import { tokenize, norm, stem, shadeHex, FILLERS, FUNCTION_WORDS } from './lexicon.js';
import { OUTFIT_SETS } from './vocab.js';

const SEAT_HEADS = ['divan', 'poltron', 'sedi', 'sgabell', 'panc', 'panchin', 'divanett', 'pouf', 'dormeus', 'sofa', 'seggiol', 'trono', 'altalen'];
const BED_HEADS = ['lett', 'futon', 'brand', 'materass', 'culla', 'amac'];
const PERSON_ONLY = new Set(['expr', 'hairStyle', 'hairColor', 'beard', 'body', 'outfitSet', 'undress', 'garment']);
const LIVING = new Set(['person', 'animal', 'ref']);

/** parse(text, lex, scene) -> {actions, unknown, debug} */
export function parse(text, lex, scene = {}) {
  const tokens = tokenize(text);
  const items = lex.tag(tokens);
  // names of the scene's characters win over any other reading ("gira Anna verso il cane")
  const names = (scene.characters || []).map((c) => ({ c, full: norm(c.name), first: norm(c.name).split(' ')[0] })).filter((x) => x.first.length > 2);
  for (const it of items) {
    if (it.i1 - it.i0 !== 1 || !['word', 'propWord', 'person'].includes(it.kind)) continue;
    const t = tokens[it.i0];
    const hit = names.find((x) => x.full === t.w || (x.first === t.w && (/^[A-ZÀ-Ö]/.test(t.raw) || it.kind !== 'person') && !/^(donna|uomo)$/.test(x.first)));
    if (hit) { it.kind = 'name'; it.data = { id: hit.c.id, name: hit.c.name, sex: hit.c.sex }; }
  }
  const ctx = { lex, scene, tokens, actions: [], unknown: [], lastSubject: null, mentions: [], roomPlanned: null };
  const clauses = splitClauses(items);
  for (const cl of clauses) {
    try { parseClause(cl, ctx); } catch (e) { console.warn('[voice] parse', e); ctx.unknown.push(spanText(tokens, cl)); }
  }
  return { actions: ctx.actions, unknown: dedupe(ctx.unknown), debug: { items: items.map((it) => it.kind + (it.data?.id ? ':' + it.data.id : '')), clauses: clauses.length } };
}

const dedupe = (a) => [...new Set(a.filter(Boolean))];
const spanText = (tokens, cl) => cl.map((it) => tokens.slice(it.i0, it.i1).map((t) => t.raw).join(' ')).join(' ');

function splitClauses(items) {
  const out = [];
  let cur = [];
  const push = () => { if (cur.length) out.push(cur); cur = []; };
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (it.kind === 'sep') { push(); continue; }
    if (it.kind === 'mark' && it.data.mark === 'break') { push(); continue; }
    if (it.kind === 'mark' && it.data.mark === 'and') {
      const nx = items[k + 1];
      // "e" before a verb / pronoun starts a new command ("e girala", "e lei sorride")
      if (nx && (nx.kind === 'intent' || (nx.kind === 'pron' && items[k + 2]?.kind !== 'det'))) { push(); continue; }
    }
    if (it.kind === 'intent' && cur.some((x) => x.kind === 'intent') && cur.some((x) => HEADS.has(x.kind))) push();
    cur.push(it);
  }
  push();
  return out;
}
const HEADS = new Set(['person', 'animal', 'propWord', 'room', 'landscape', 'kit']);

// ------------------------------------------------------------------ clause
function parseClause(items, ctx) {
  const { lex, tokens } = ctx;
  const C = {
    intent: null, clitic: null, nps: [], cur: null, subject: null, flags: {}, time: null, weather: null, season: null,
    angle: null, framing: null, focal: null, light: null, turn: null, unknownWords: [],
  };
  let det = null, count = null, ord = null, rel = null, con = false, che = false, hair = false, nameNext = false, dressColor = false;
  let pendingColor = null, pendingPose = null, lastGarment = null, lastColorTarget = null, andFlag = false, pendingGarments = [];
  let allNext = false, aim = null;
  const take = () => { const d = det, c = count, o = ord; det = null; count = null; ord = null; return { det: d, count: c, ord: o }; };
  const newNP = (kind, it, extra = {}) => {
    const { det: d, count: c, ord: o } = take();
    const np = { kind, i0: it.i0, det: d, count: c ?? (d?.pl ? 2 : null), ord: o, outfit: [], hair: {}, ...extra };
    if (d?.more) np.more = true;
    if (allNext) { np.all = true; if (np.det) np.det = { ...np.det, pl: true }; allNext = false; }
    // "che indica la finestra", "guarda il cane": the object is where the subject faces
    if (aim && !(rel && !rel.done) && kind !== 'garment') {
      np.role = 'target';
      aim.facing = np;
      aim.lookAt = np;
      aim = null;
      C.nps.push(np);
      C.cur = np;
      return np;
    }
    // role: relation target, companion ("con un cane"), or subject
    if (rel && !rel.target && !rel.done) {
      np.role = 'target';
      rel.target = np;
      if (rel.rel === 'between' && rel.subject?.place?.target && rel.subject.place.relation === 'between') rel.subject.place.target2 = np;
      else if (rel.subject) applyRel(rel.subject, rel, np);
      if (rel.rel !== 'between') rel.done = true; else if (rel.subject?.place?.target2) rel.done = true;
    } else if (con && C.cur && np.kind !== 'garment') {
      np.role = 'companion';
      np.owner = ownerOf(C);
      con = false;
    } else {
      np.role = 'subject';
      if (!C.subject) C.subject = np;
      if (andFlag && C.subject && C.subject !== np) np.coSubject = true;
    }
    andFlag = false;
    if (pendingPose && LIVING.has(kind) && np.role !== 'target') { setPose(np, pendingPose); pendingPose = null; }
    C.nps.push(np);
    C.cur = np;
    lastGarment = null;
    return np;
  };
  const personCtx = () => {
    // the person a garment / hair / expression belongs to: current NP, its owner, the subject, a pronoun
    const c = C.cur;
    if (c && (c.kind === 'person' || (c.kind === 'ref' && c.refKind !== 'animal'))) return c;
    for (let k = C.nps.length - 1; k >= 0; k--) { const n = C.nps[k]; if (n.kind === 'person' || (n.kind === 'ref' && n.refKind !== 'animal' && n.refKind !== 'prop')) return n; }
    if (C.clitic !== null || ['dress', 'color', 'turn', 'move', 'look'].includes(C.intent)) return ensureItRef(C, ctx);
    return null;
  };
  const livingCtx = () => {
    const c = C.cur;
    if (c && LIVING.has(c.kind)) return c;
    for (let k = C.nps.length - 1; k >= 0; k--) if (LIVING.has(C.nps[k].kind) && C.nps[k].role !== 'target') return C.nps[k];
    for (let k = C.nps.length - 1; k >= 0; k--) if (LIVING.has(C.nps[k].kind)) return C.nps[k];
    return null;
  };

  for (let k = 0; k < items.length; k++) {
    const it = items[k], d = it.data || {};
    const raw = tokens.slice(it.i0, it.i1).map((t) => t.raw).join(' ');
    const next = items[k + 1];
    switch (it.kind) {
      case 'intent': {
        if (!C.intent) {
          C.intent = d.intent;
          const w = tokens[it.i0].w;
          const m = /(?:[aeiu])(la|lo|li|le|gli)$/.exec(w);
          if (m && it.i1 - it.i0 === 1 && !['voglio', 'metti'].includes(w)) C.clitic = { la: 'f', lo: 'm', li: 'm', le: 'f', gli: 'm' }[m[1]];
          // "falla sedere", "fallo correre": clitic on "fa"
          if (/^(falla|fallo|falli|falle)$/.test(w)) C.clitic = w.endsWith('a') || w.endsWith('e') ? 'f' : 'm';
          // "mettile" / "mettigli": dative (to her / to him) = dress or give
          if (/^(mettile|mettigli|dalle|dagli)$/.test(w)) C.clitic = w.endsWith('le') ? 'f' : 'm';
        } else if (d.intent === 'look' && C.intent !== 'look') C.flags.look = true;
        // "che guarda la finestra" / "guarda il cane": aim the current subject at the next thing
        if (d.intent === 'look' && C.cur && LIVING.has(C.cur.kind) && next && OPENS_TARGET(next) && next.kind !== 'rel') aim = C.cur;
        break;
      }
      case 'det': det = d; break;
      case 'num': {
        if (next?.kind === 'mm') { C.focal = d.n; k++; break; }
        if (next?.kind === 'mark' && next.data.mark === 'degrees') { C.turn = d.n; k++; break; }
        count = d.n;
        break;
      }
      case 'mm': break;
      case 'ord': ord = d.n; break;
      case 'prep': {
        // articulated prepositions carry a definite article ("della donna", "al tavolo")
        if (d.id !== d.p && d.def) det = { def: true, g: d.g, pl: d.pl };
        // "sul divano", "nel letto", "col cane": prepositions that act as relations
        if (d.p === 'su') { rel = startRel(C, 'on', it); if (!next || !OPENS_TARGET(next)) closeRel(rel); break; }
        if (d.p === 'in' && !rel) { rel = startRel(C, 'in', it); if (!next || !OPENS_TARGET(next)) closeRel(rel); break; }
        if (d.p === 'con') { con = true; break; }
        if ((d.p === 'a' || d.p === 'da') && !rel && C.intent && ['add', 'dress', 'remove'].includes(C.intent) && next && (next.kind === 'person' || next.kind === 'mark' && next.data.mark === 'name')) {
          // "metti alla donna una giacca": dative person = the one to dress
          C.flags.dative = true;
        }
        break;
      }
      case 'rel': {
        if (d.rel === 'toward' && next?.kind === 'mark' && next.data.mark === 'me') { const s = livingCtx() || ensureItRef(C, ctx); s.facing = { kind: 'camera' }; k++; break; }
        if (d.rel === 'floor') {
          const s = livingCtx() || pendingTarget(C);
          if (s && s.pose && /^sit_(chair|relaxed|legs|stool)/.test(s.pose)) s.pose = 'sit_floor_cross';
          else if (s) s.floor = true;
          else pendingPose = pendingPose || null;
          break;
        }
        if (d.rel === 'row') { const s = C.cur || C.subject; if (s) s.row = true; break; }
        if (d.rel === 'in' && next && (next.kind === 'garment' || (next.kind === 'color' && items[k + 2]?.kind === 'garment'))) break; // "in jeans e felpa"
        if (C.flags.camera || C.intent === 'camera') {
          // "inquadra di fianco", "inquadra davanti": camera directions
          const a = { front: 'front', behind: 'back', beside: 'side', left: 'side', right: 'side' }[d.rel];
          if (a && !(next && (HEADS.has(next.kind) || next.kind === 'det' || next.kind === 'prep'))) { C.angle = C.angle || a; break; }
        }
        // "spostala a destra", "girala verso la porta": the clitic is the subject
        if (!C.cur && !C.subject && (C.clitic !== null || ['turn', 'move', 'look', 'color', 'dress'].includes(C.intent))) { const r0 = ensureItRef(C, ctx); C.cur = r0; }
        // "nell'angolo a destra": side of the corner
        if ((d.rel === 'left' || d.rel === 'right') && rel?.rel === 'corner' && rel.subject?.place?.relation === 'corner' && items[k - 1]?.kind === 'rel') { rel.subject.place.side = d.rel; break; }
        rel = startRel(C, d.rel, it);
        if (d.rel === 'toward' || d.rel === 'hand') rel.subjectMode = true;
        // a relation with no object ("due sedie a sinistra", "con un cane accanto") applies now
        if (!next || !OPENS_TARGET(next)) closeRel(rel, C);
        break;
      }
      case 'mark': {
        const mk = d.mark;
        if (mk === 'con') { con = true; break; }
        if (mk === 'and') { andFlag = true; if (rel && rel.rel === 'between' && !rel.done) break; if (rel && !rel.done) closeRel(rel, C); rel = null; break; }
        if (mk === 'che') { che = true; break; }
        if (mk === 'hair') { hair = true; break; }
        if (mk === 'name') { nameNext = true; break; }
        if (mk === 'dress') { dressColor = true; break; }
        if (mk === 'camera') {
          if (det && det.def === false && !C.intent?.match(/camera/) && !C.flags.camera) { newNP('room', it, { room: 'camera' }); break; }
          C.flags.camera = true; det = null; break;
        }
        if (mk === 'light') { C.flags.light = true; det = null; break; }
        if (mk === 'landscape') { C.flags.landscape = true; det = null; break; }
        if (mk === 'me') {
          const s = rel && !rel.done ? rel.subject : livingCtx() || ensureItRef(C, ctx);
          if (rel && rel.rel === 'toward' && s) { s.facing = { kind: 'camera' }; rel.done = true; }
          else if (C.intent === 'look' || C.flags.look || (rel && rel.rel === 'toward') || C.intent === 'turn') { if (s) { s.facing = { kind: 'camera' }; if (C.intent === 'look' || C.flags.look) s.lookAt = { kind: 'camera' }; } }
          else if (s) s.facing = { kind: 'camera' };
          det = null;
          break;
        }
        if (mk === 'turnBack') {
          if (C.flags.camera || C.intent === 'camera') { C.angle = 'back'; break; }
          const s = livingCtx() || ensureItRef(C, ctx);
          if (s) s.facing = { kind: 'away' };
          break;
        }
        if (mk === 'mutual') { C.flags.mutual = true; break; }
        if (mk === 'more') { det = { def: false, more: true, n: 1 }; break; }
        if (mk === 'bigger' || mk === 'smaller') { const s = C.cur; if (s) s.size = mk === 'bigger' ? 1.35 : 0.7; break; }
        if (mk === 'halfTurn') { C.turn = 180; break; }
        if (mk === 'quarterTurn') { C.turn = 90; break; }
        if (mk === 'degrees') break;
        if (['window', 'door', 'wall', 'floor', 'room', 'all'].includes(mk)) {
          // as an object to add ("metti una finestra") or a target ("verso la finestra")
          const asProp = { window: 'finestra', door: 'porta', wall: 'muro', room: 'stanza' }[mk];
          if (asProp && det && det.def === false && !rel) { newNP('prop', it, { head: stem(asProp), word: asProp, extra: [] }); break; }
          if (mk === 'all') {
            if (next && ['det', 'propWord', 'person', 'animal', 'num'].includes(next.kind)) { allNext = true; break; }
            newNP('ref', it, { refKind: 'all', all: true }); break;
          }
          if (mk === 'floor') { const s = livingCtx(); if (s && s.pose && /^sit_/.test(s.pose)) s.pose = 'sit_floor_cross'; det = null; break; }
          newNP('special', it, { special: mk });
          break;
        }
        break;
      }
      case 'pron': {
        if (d.all) { newNP('ref', it, { refKind: 'all', all: true, g: d.g }); break; }
        newNP('ref', it, { refKind: d.ref || 'it', g: d.g || null, pl: !!d.pl, both: !!d.both });
        break;
      }
      case 'person': {
        if (nameNext && C.cur) { C.cur.name = raw; nameNext = false; break; }
        // stems drop the gender ("ragazzo" / "ragazza"): the exact word decides
        const pw = tokens[it.i0].w;
        const exact = it.i1 - it.i0 === 1 ? (it.alts || []).find((a) => a.kind === 'person' && norm(a.word) === pw) : null;
        let sex = exact ? exact.sex : d.sex;
        if (!exact && it.i1 - it.i0 === 1 && (it.alts || []).some((a) => a.kind === 'person' && a.sex && a.sex !== d.sex)) sex = /[ae]$/.test(pw) && !/(ore|one|e)$/.test(pw.replace(/(donne|ragazze|signore)$/, 'a')) ? 'F' : /[oi]$/.test(pw) ? 'M' : d.sex;
        const g = det?.g;
        if (!sex && g) sex = g === 'f' ? 'F' : 'M';
        if (d.word === 'signore' && det?.g === 'f') sex = 'F';
        const pl = /^(uomini|ragazzi|ragazze|donne|signori|tizi|tipe|persone|personaggi|maschi|femmine|figure|bambini|bambine|amici|amiche|soldati|poliziotti)$/.test(pw) || (pw === 'signore' && !!det?.pl);
        // "un signore anziano", "una donna giovane": a second person word right after the first is a trait
        const prevIt = items[k - 1];
        if (prevIt?.kind === 'person' && C.cur?.kind === 'person' && !det && !count) {
          const tr2 = (exact || d).traits;
          if (tr2?.hairColor) C.cur.hair.color = tr2.hairColor;
          if (tr2?.body && !C.cur.body) C.cur.body = tr2.body;
          if (tr2?.outfit && !C.cur.outfitSet) C.cur.outfitSet = tr2.outfit;
          break;
        }
        const tr = (exact || d).traits || null;
        const np = newNP('person', it, { sex, traits: tr, word: tokens[it.i0].w });
        if (pl && np.count == null) np.count = 2;
        if (tr?.body) np.body = tr.body;
        if (tr?.hairColor) np.hair.color = tr.hairColor;
        if (tr?.hairStyle) np.hair.style = tr.hairStyle;
        if (tr?.outfit) np.outfitSet = tr.outfit;
        if (tr?.color) np.outfitColor = tr.color;
        if (C.pendingBody) { np.body = C.pendingBody; C.pendingBody = null; }
        if (che) che = false;
        break;
      }
      case 'animal': {
        const np = newNP('animal', it, { species: d.species, word: tokens[it.i0].w });
        const w = tokens[it.i0].w;
        if (/^(cane|cani)$/.test(w)) np.speciesGroup = 'cane_';
        if (np.count == null && /i$|e$/.test(w) && /(cani|gatti|cavalli|lupi|leoni|tigri|mucche|maiali|pecore|capre|cervi|conigli|orsi|elefanti|scimmie|uccelli|piccioni|corvi|galline|squali|delfini|serpenti|draghi|cuccioli|gattini|cagnolini)$/.test(w)) np.count = 2;
        break;
      }
      case 'propWord': {
        if (nameNext && C.cur) { C.cur.name = raw; nameNext = false; break; }
        // compound noun: "sedia da ufficio", "lampada da terra", "vaso di fiori", "tavolo rotondo"
        const extra = [];
        let j = k + 1;
        while (j < items.length) {
          const x = items[j];
          if (x.kind === 'word' || x.kind === 'propWord') { extra.push(x.kind === 'word' ? stem(x.data.w) : x.data.stem); j++; continue; }
          if (x.kind === 'prep' && ['di', 'da', 'a', 'in'].includes(x.data.p) && (x.data.id === x.data.p || x.data.p === 'di') && items[j + 1] && (items[j + 1].kind === 'propWord' || items[j + 1].kind === 'word')) { j++; continue; }
          break;
        }
        const w = tokens[it.i0].w;
        const np = newNP('prop', it, { head: d.stem, word: w, extra });
        if (np.count == null && /[ie]$/.test(w) && w.length > 4 && !/(e|i)$/.test(lex.cat?.props?.find((p) => stem(norm(p.label).split(' ')[0]) === d.stem)?.label?.split(' ')[0] || 'x') ) np.count = np.det?.def ? null : 2;
        if (np.det?.pl && np.count == null) np.count = 2;
        k = j - 1;
        break;
      }
      case 'room': {
        // a room word used as a plain object / target ("sul letto della camera") stays a room context
        if (rel && !rel.done && it.propHit) { newNP('prop', it, { head: it.propHit.s, word: tokens[it.i0].w, extra: [] }); break; }
        newNP('room', it, { room: d.room });
        break;
      }
      case 'landscape': {
        const np = newNP('landscape', it, { landscape: d.landscape, place: raw, propHit: it.propHit });
        // "una strada di città": swallow the "di <word>" complement into the place text
        if (next?.kind === 'prep' && next.data.p === 'di' && items[k + 2] && ['landscape', 'word'].includes(items[k + 2].kind)) { np.place += ' di ' + tokens.slice(items[k + 2].i0, items[k + 2].i1).map((t) => t.raw).join(' '); k += 2; }
        break;
      }
      case 'kit': newNP('kit', it, { kit: d.kit }); break;
      case 'name': { const np = newNP('ref', it, { refKind: 'character', id: d.id, name: d.name, sex: d.sex }); np.det = { def: true }; break; }
      case 'garment': {
        const p = personCtx();
        if (!p && it.propHit && C.intent !== 'dress') { newNP('prop', it, { head: it.propHit.s, word: tokens[it.i0].w, extra: [] }); break; }
        const g = { garment: d.garment, color: null };
        if (pendingColor) { g.color = pendingColor; pendingColor = null; }
        if (p) p.outfit.push(g); else pendingGarments.push(g);
        lastGarment = g;
        lastColorTarget = g;
        break;
      }
      case 'undress': { const p = personCtx(); if (p) p.undress = d.undress; break; }
      case 'outfitSet': { const p = personCtx(); if (p) p.outfitSet = d.outfit; break; }
      case 'color': {
        if (hair) { const p = personCtx(); if (p) p.hair.color = hairHex(d.id, d.hex); hair = false; lastColorTarget = null; break; }
        if (lastGarment && items[k - 1] && (items[k - 1].kind === 'garment' || items[k - 1].kind === 'shade' || items[k - 1].kind === 'word')) { lastGarment.color = d.hex; lastColorTarget = lastGarment; break; }
        if (dressColor) { const p = personCtx(); if (p) { p.outfitColor = d.hex; } dressColor = false; lastColorTarget = null; break; }
        if (next?.kind === 'garment') { pendingColor = d.hex; break; }
        // "una ragazza rossa": hair colour of a person
        if (C.cur?.kind === 'person' && items[k - 1]?.kind === 'person' && ['rosso', 'rossa', 'rossi', 'rosse'].includes(tokens[it.i0].w)) { C.cur.hair.color = '#8c3a1c'; break; }
        if (hair || items[k - 1]?.kind === 'mark' && items[k - 1].data.mark === 'hair') { const p = personCtx(); if (p) p.hair.color = d.hex; break; }
        const t = C.cur && (C.cur.kind === 'prop' || C.cur.kind === 'animal' || C.cur.kind === 'ref' || C.cur.kind === 'special') ? C.cur : (C.intent === 'color' ? C.cur || ensureItRef(C, ctx) : C.cur);
        if (t && t.kind === 'person') { t.outfitColor = t.outfitColor || d.hex; lastColorTarget = null; break; }
        if (t) { t.color = d.hex; lastColorTarget = t; } else pendingColor = d.hex;
        break;
      }
      case 'shade': {
        if (lastColorTarget?.color) lastColorTarget.color = shadeHex(lastColorTarget.color, d.k);
        break;
      }
      case 'hairStyle': {
        const p = personCtx();
        const single = it.i1 - it.i0 === 1;
        const ambiguous = single && ['lunghi', 'corti', 'lisci', 'mossi', 'raccolti', 'ricci', 'coda'].includes(tokens[it.i0].w);
        if (!p || (ambiguous && !hair && !(items[k - 1]?.kind === 'person') && !(lastGarment === null && items[k - 1]?.kind === 'det'))) { if (!p) C.unknownWords.push(raw); break; }
        p.hair.style = d.style;
        break;
      }
      case 'hairColor': { const p = personCtx(); if (p) p.hair.color = hairHex(d.colorId, d.hex); hair = false; break; }
      case 'beard': { const p = personCtx(); if (p) { p.hair.beard = d.beard; if (!p.sex && p.kind === 'person') p.sex = 'M'; } break; }
      case 'body': {
        const p = C.cur?.kind === 'person' ? C.cur : personCtx();
        if (p) p.body = d.body; else C.pendingBody = d.body;
        break;
      }
      case 'expr': {
        // "pensieroso" is both a pose and an expression: the pose comes from the alts below
        const p = personCtx();
        if (p) p.expr = d.expr;
        else C.unknownWords.push(raw);
        const poseAlt = it.alts?.find((a) => a.kind === 'pose');
        if (p && poseAlt && !p.pose) p.pose = poseAlt.pose;
        break;
      }
      case 'pose': case 'apose': {
        const humanId = it.alts?.find((a) => a.kind === 'pose')?.pose || (it.kind === 'pose' ? d.pose : null);
        const animalId = it.alts?.find((a) => a.kind === 'apose')?.apose || (it.kind === 'apose' ? d.apose : null);
        const exprAlt = it.alts?.find((a) => a.kind === 'expr')?.expr;
        let s = livingCtx();
        if (!s && C.clitic !== null) s = ensureItRef(C, ctx);
        if (!s && (C.intent === 'add' || !C.intent) && !C.nps.length) { pendingPose = { human: humanId, animal: animalId }; break; }
        if (!s) { s = ensureItRef(C, ctx); }
        setPose(s, { human: humanId, animal: animalId });
        if (exprAlt && s.kind !== 'animal' && !s.expr) s.expr = exprAlt;
        if (humanId === 'pointing' && next && OPENS_TARGET(next) && next.kind !== 'word') aim = s;
        // "seduto sul divano" / "sdraiato sul letto": the next relation is about this pose
        che = false;
        break;
      }
      case 'time': C.time = d.time; break;
      case 'weather': C.weather = d.weather; break;
      case 'season': C.season = d.season; break;
      case 'light': {
        // "luce dal basso" -> horror; plain "tramonto" etc. handled as time
        C.light = d.light;
        C.flags.light = true;
        break;
      }
      case 'angle': {
        if (C.flags.light || C.intent === 'light') { if (d.angle === 'low') C.light = 'horror'; else if (d.angle === 'high' || d.angle === 'top') C.light = 'top'; else if (d.angle === 'back') C.light = 'backlight'; break; }
        C.angle = d.angle;
        break;
      }
      case 'framing': {
        // "la mano" / "il viso" as part of a camera clause; elsewhere ignored
        if (d.framing === 'hand' && !(C.flags.camera || C.intent === 'camera')) break;
        if (d.framing === 'all' && !(C.flags.camera || C.intent === 'camera')) { newNP('ref', it, { refKind: 'all', all: true }); break; }
        C.framing = d.framing;
        det = null;
        break;
      }
      case 'focal': C.focal = d.focal; break;
      case 'word': {
        const w = d.w;
        if (nameNext && C.cur) { C.cur.name = raw.charAt(0).toUpperCase() + raw.slice(1); nameNext = false; break; }
        // a character of the scene by name ("gira Anna verso la porta")
        const ch = (ctx.scene.characters || []).find((c) => norm(c.name) === w || norm(c.name).split(' ')[0] === w && /^[A-ZÀ-Ö]/.test(raw));
        if (ch) { newNP('ref', it, { refKind: 'character', id: ch.id, name: ch.name }); break; }
        if (!FUNCTION_WORDS.has(w) && !FILLERS.has(w) && w.length > 1) C.unknownWords.push(raw);
        break;
      }
      default: break;
    }
  }
  // "girala di 90 gradi", "spostalo": a verb with a clitic or no object acts on the last subject
  if (!C.nps.some((n) => n.role === 'subject') && (C.clitic !== null || ['turn', 'move', 'look', 'dress', 'color'].includes(C.intent))) ensureItRef(C, ctx);
  if (pendingGarments.length) {
    const p = personCtx() || ensureItRef(C, ctx, 'character');
    p.outfit.push(...pendingGarments);
  }
  if (pendingPose && !C.nps.some((n) => LIVING.has(n.kind))) {
    const s = ensureItRef(C, ctx);
    setPose(s, pendingPose);
  }
  emitClause(C, ctx);
}

function hairHex(id, hex) {
  const map = { nero: '#15110f', castano_scuro: '#2e1d14', castano: '#4a2f1d', castano_chiaro: '#7a5434', biondo_scuro: '#9b7442', biondo: '#d0aa68', ramato: '#8c3a1c', grigio: '#8d8a86', bianco: '#dedad3', rosso: '#8c3a1c', blu: '#2b4fb8', rosa: '#e07aa8', viola: '#6a3a9e', verde: '#2f8a52', argento: '#b9c0c8' };
  return map[id] || hex;
}

function setPose(np, p) {
  if (np.kind === 'animal' || (np.kind === 'ref' && np.refKind === 'animal')) { if (p.animal) np.apose = p.animal; else if (p.human) np.apose = humanToAnimal(p.human); }
  else if (p.human) np.pose = p.human;
  else if (p.animal) { np.apose = p.animal; np.pose = animalToHuman(p.animal); }
}
const humanToAnimal = (id) => ({ sit_chair: 'sit', sit_relaxed: 'sit', sit_floor_cross: 'sit', lie_back: 'lie', lie_side: 'sleep', lie_front: 'lie', run: 'run', sprint: 'run', walk: 'walk', jump: 'jump', relaxed: 'stand' }[id] || null);
const animalToHuman = (id) => ({ sit: 'sit_chair', lie: 'lie_back', sleep: 'lie_side', run: 'run', walk: 'walk', jump: 'jump', stand: 'relaxed', play: 'cheer' }[id] || null);

/** Items that can begin the object of a relation ("del tavolo", "alla finestra", "Anna"). */
const OPENS_TARGET = (x) => ['det', 'prep', 'num', 'ord', 'person', 'animal', 'propWord', 'room', 'landscape', 'kit', 'pron', 'word', 'garment'].includes(x.kind) ||
  (x.kind === 'mark' && ['window', 'door', 'wall', 'floor', 'room', 'me', 'all', 'more'].includes(x.data.mark));
/** A relation without an object: relative to the room / scene, or to the owner of a companion. */
function closeRel(rel, C = null) {
  if (rel.done) return;
  rel.done = true;
  const s = rel.subject;
  if (!s) return;
  // "metti il tavolo al centro e due sedie a sinistra": relative to the thing named just before
  if (C && s.coSubject && ['left', 'right', 'front', 'behind', 'beside', 'near', 'around'].includes(rel.rel)) {
    const prev = C.nps.filter((n) => n !== s && n.role === 'subject' && (n.kind === 'prop' || n.kind === 'person' || n.kind === 'animal'))[0];
    if (prev) { s.place = { relation: rel.rel, target: prev }; return; }
  }
  if (rel.rel === 'toward' || rel.rel === 'in') return;
  if (rel.rel === 'hand') { s.place = { relation: 'hand', target: null }; return; }
  if (rel.rel === 'floor') { s.floor = true; return; }
  if (rel.rel === 'row') { s.row = true; return; }
  if (rel.rel === 'on') return;
  s.place = { relation: rel.rel, target: null };
}

function startRel(C, relName, it) {
  // subject of the relation: the current NP (or the clause subject); a pose just
  // stated ("seduto sul ...") makes it a seat relation
  const subject = C.cur && C.cur.role !== 'target' ? C.cur : C.cur && C.cur.role === 'target' ? findOwnerOfTarget(C, C.cur) : C.subject;
  return { rel: relName, subject: subject || null, i0: it.i0 };
}
function findOwnerOfTarget(C, t) {
  for (let k = C.nps.length - 1; k >= 0; k--) { const n = C.nps[k]; if (n.place?.target === t) return n; }
  return C.subject;
}

function applyRel(subject, rel, target) {
  let r = rel.rel;
  if (r === 'toward') { subject.facing = target; return; }
  if (r === 'hand') { subject.place = { relation: 'hand', target }; return; }
  if (r === 'in') {
    if (target.kind === 'room' || target.kind === 'landscape' || target.kind === 'special' && target.special === 'room') { subject.inRoom = target; return; }
    r = 'on';
  }
  if (r === 'on' && target.kind === 'prop') {
    if (subject.pose && /^sit_/.test(subject.pose) || subject.apose === 'sit' && subject.kind !== 'animal') r = 'seat';
    else if (subject.kind === 'person' && !subject.pose && SEAT_HEADS.some((h) => target.head?.startsWith(h))) { r = 'seat'; subject.pose = subject.pose || 'sit_relaxed'; }
  }
  if (r === 'on' && target.kind === 'special' && target.special === 'floor') { subject.floor = true; return; }
  subject.place = { relation: r, target };
}

/** A pronoun / clitic reference as an NP (the last mentioned subject, else the selection). */
function ensureItRef(C, ctx, kind = null) {
  const ex = C.nps.find((n) => n.kind === 'ref' && n.implicitIt);
  if (ex) return ex;
  const np = { kind: 'ref', refKind: kind || 'it', g: C.clitic || null, implicitIt: true, role: 'subject', outfit: [], hair: {}, i0: -1 };
  C.nps.unshift(np);
  if (!C.subject) C.subject = np;
  return np;
}
function pendingTarget(C) { return C.subject; }
function ownerOf(C) {
  // the person / animal / prop a companion belongs to: the last subject-ish NP
  for (let k = C.nps.length - 1; k >= 0; k--) { const n = C.nps[k]; if (n.role !== 'target' && n.role !== 'companion') return n; }
  return C.cur;
}

// ------------------------------------------------------------------ actions
function emitClause(C, ctx) {
  const { scene, lex } = ctx;
  const A = ctx.actions;
  const unknown = C.unknownWords;
  const nps = C.nps;
  const cameraClause = C.intent === 'camera' || C.flags.camera || ((C.angle || C.framing || C.focal) && !C.flags.light && !nps.some((n) => n.role === 'subject' && n.kind !== 'ref' && !(n.det?.def)));
  const lightClause = !cameraClause && (C.intent === 'light' || C.flags.light || C.light);

  // ---- camera
  if (cameraClause) {
    const a = { type: 'camera' };
    if (C.angle) a.angle = C.angle;
    if (C.focal) a.focal = C.focal;
    if (C.framing) a.framing = C.framing;
    const subj = nps.find((n) => n.role !== 'companion' && (n.kind === 'person' || n.kind === 'animal' || n.kind === 'prop' || n.kind === 'ref'));
    if (subj) { const t = resolveTarget(subj, ctx, { create: false }); if (t) a.target = t; }
    if (subj?.all) { a.framing = 'all'; delete a.target; }
    if (!a.angle && !a.focal && !a.framing) a.framing = a.target ? 'subject' : 'all';
    A.push(a);
    if (unknown.length) ctx.unknown.push(unknown.join(' '));
    return;
  }
  // ---- lights / time of day
  const landscapeNP = nps.find((n) => n.kind === 'landscape' && n.role !== 'target');
  const useLandscape = landscapeNP && !landscapeNP.place?.relation && (C.intent === 'add' || !C.intent || C.flags.landscape || C.time || C.weather) &&
    !(landscapeNP.propHit && (landscapeNP.count > 1 || nps.some((n) => n.place?.target === landscapeNP)));
  if (lightClause && !useLandscape && !nps.some((n) => n.kind !== 'ref' && n.kind !== 'special' && n.role === 'subject')) {
    const a = { type: 'lights' };
    if (C.light) a.preset = C.light;
    if (C.time) a.time = C.time;
    if (!a.preset && !a.time) a.preset = 'studio';
    A.push(a);
    if (unknown.length) ctx.unknown.push(unknown.join(' '));
    return;
  }
  // ---- landscape
  if (useLandscape || (C.flags.landscape && (C.time || C.weather || C.season))) {
    const spec = {};
    if (landscapeNP?.landscape) spec.preset = landscapeNP.landscape;
    if (landscapeNP?.place) spec.place = landscapeNP.place;
    if (C.time) spec.time = C.time;
    if (C.weather) spec.weather = C.weather;
    if (C.season) spec.season = C.season;
    const feats = [];
    for (const n of nps) if (n !== landscapeNP && (n.kind === 'prop' || n.kind === 'animal')) { const f = featureOf(n); if (f) { feats.push(f); n.consumed = true; } }
    if (feats.length) spec.features = feats;
    A.push({ type: 'landscape', spec });
    if (landscapeNP) landscapeNP.consumed = true;
  } else if (!lightClause && (C.time || C.weather) && !nps.some((n) => n.role === 'subject' && n.kind !== 'ref')) {
    // "fai notte", "metti la pioggia": atmosphere / lights
    if (C.weather && scene.hasLandscape) A.push({ type: 'landscape', spec: { weather: C.weather, ...(C.time ? { time: C.time } : {}), atmosphereOnly: true } });
    else A.push({ type: 'lights', ...(C.time ? { time: C.time } : { preset: C.weather === 'nebbia' ? 'flat' : 'night' }) });
    if (unknown.length) ctx.unknown.push(unknown.join(' '));
    return;
  } else if (lightClause) {
    A.push({ type: 'lights', ...(C.light ? { preset: C.light } : {}), ...(C.time ? { time: C.time } : {}) });
  }
  if (C.time && useLandscape === false && lightClause === false && !A.some((a) => a.type === 'landscape')) {
    A.push({ type: 'lights', time: C.time });
  }

  // ---- remove
  if (C.intent === 'remove') {
    const targets = nps.filter((n) => n.role !== 'companion' && n.kind !== 'special');
    if (!targets.length && C.clitic !== null) targets.push(ensureItRef(C, ctx));
    for (const n of targets) {
      if (n.kind === 'room') { A.push({ type: 'remove', target: { kind: 'room', ...(n.room ? { type: n.room } : {}) } }); continue; }
      if (n.kind === 'landscape') { A.push({ type: 'remove', target: { kind: 'all', type: 'landscape' } }); continue; }
      if (n.kind === 'ref' && n.all) { A.push({ type: 'remove', target: { kind: 'all' } }); continue; }
      const t = resolveTarget(n, ctx, { create: false, plural: true });
      if (t) A.push({ type: 'remove', target: t }); else unknown.push(n.word || '');
    }
    if (!targets.length) unknown.push('cosa togliere');
    if (unknown.filter(Boolean).length) ctx.unknown.push(unknown.filter(Boolean).join(' '));
    return;
  }

  // ---- rooms
  for (const n of nps) {
    if (n.kind !== 'room' || n.consumed || n.role === 'target') continue;
    if (n.place?.relation && n.propHit) { n.kind = 'prop'; n.head = n.propHit.s; n.extra = []; continue; }
    A.push({ type: 'addRoom', preset: n.room });
    ctx.roomPlanned = { index: A.length - 1, preset: n.room };
    n.consumed = true;
    n.newIndex = A.length - 1;
  }
  // ---- kits (only without the landscapes module)
  for (const n of nps) {
    if (n.kind !== 'kit' || n.consumed) continue;
    A.push({ type: 'addProp', query: n.kit, propType: undefined, kit: n.kit });
    n.consumed = true;
  }

  // ---- entities: subjects in order, each target created first when needed
  const done = new Set();
  const emit = (n) => {
    if (done.has(n) || n.consumed) return n.newIndex ?? null;
    done.add(n);
    if (n.kind === 'landscape') {
      // landscape word used as a thing ("dietro il castello"): a building / prop with that name
      if (n.propHit) { n.kind = 'prop'; n.head = n.propHit.s; n.extra = []; } else return null;
    }
    if (n.kind === 'special') return null;
    // targets first
    if (n.place?.target) emitTarget(n.place.target);
    if (n.place?.target2) emitTarget(n.place.target2);
    if (n.facing && n.facing.kind !== 'camera' && n.facing.kind !== 'away' && n.facing.i0 !== undefined) emitTarget(n.facing);
    if (n.owner && n.owner.newIndex === undefined && n.owner.kind !== 'ref') emit(n.owner);
    const existing = isDefinite(n) ? resolveTarget(n, ctx, { create: false, plural: n.det?.pl }) : null;
    const modifying = n.kind === 'ref' || existing || ['turn', 'move', 'look', 'dress', 'color'].includes(C.intent) && (n.det?.def || n.kind === 'ref');
    if (modifying) {
      const target = existing || resolveTarget(n, ctx, { create: false }) || itTarget(n, ctx);
      const a = { type: 'modify', target };
      fillModify(a, n, C, ctx);
      if (Object.keys(a).length > 2 || a.rotateTowards || a.place) A.push(a);
      else if (C.intent === 'add' && existing) unknown.push('è già in scena');
      n.ref = target;
      if (target.kind === 'new') n.newIndex = target.index;
      ctx.lastSubject = n;
      return null;
    }
    const a = makeAdd(n, C, ctx, unknown);
    if (!a) return null;
    A.push(a);
    n.newIndex = A.length - 1;
    ctx.mentions.push({ np: n, index: n.newIndex });
    if (n.role === 'subject') ctx.lastSubject = n;
    return n.newIndex;
  };
  const emitTarget = (t) => {
    if (t.kind === 'special' || t.kind === 'room' || t.kind === 'landscape' && !t.propHit) return;
    if (t.kind === 'ref') return;
    // a definite target that exists (scene or this plan) needs no action
    if (resolveTarget(t, ctx, { create: false })) return;
    t.implicit = isDefinite(t);
    emit(t);
  };
  for (const n of nps) if (n.role === 'subject' || n.role === 'companion') emit(n);
  for (const n of nps) if (!done.has(n) && n.role === 'target' && !n.consumed) emitTarget(n);

  // "un uomo e una donna che si guardano": face each other
  if (C.flags.mutual) {
    const pair = nps.filter((n) => (n.kind === 'person' || n.kind === 'ref' || n.kind === 'animal') && n.role !== 'target').slice(0, 2);
    if (pair.length === 1 && pair[0].count >= 2) {
      const a = A[pair[0].newIndex];
      if (a) a.mutual = true;
    } else if (pair.length === 2) {
      const ta = targetOfNP(pair[0], ctx), tb = targetOfNP(pair[1], ctx);
      if (ta && tb) {
        const b = A.find((x) => x.type !== 'modify' && pair[1].newIndex !== undefined && A.indexOf(x) === pair[1].newIndex);
        if (b && !b.place) b.place = { relation: 'facing', target: ta };
        else A.push({ type: 'modify', target: tb, rotateTowards: ta });
        A.push({ type: 'modify', target: ta, rotateTowards: tb, lookAt: tb });
        A.push({ type: 'modify', target: tb, lookAt: ta });
      }
    }
  }
  if (unknown.filter(Boolean).length) ctx.unknown.push(unknown.filter(Boolean).join(' '));
}

function featureOf(n) {
  const w = n.word || '';
  const map = [[/alber|pin|abet|quercia/, 'alberi'], [/auto|macchin/, 'auto'], [/fontan/, 'fontana'], [/neon|insegn/, 'neon'], [/lampion/, 'lampioni'], [/panchin|panc/, 'panchine'], [/fior/, 'fiori'], [/rocc|sass/, 'rocce'], [/barc/, 'barche'], [/bancarell/, 'bancarelle'], [/fuoc|falo/, 'fuoco'], [/cespugl|siep/, 'cespugli'], [/lantern/, 'lanterne']];
  if (n.kind === 'animal') return 'animali';
  for (const [re, f] of map) if (re.test(w)) return f;
  return null;
}

const isDefinite = (n) => !!(n.det?.def) && !n.more;

function itTarget(n, ctx) {
  // pronoun / clitic: last subject of this command (matching gender), else the selection
  const g = n.g;
  const ms = ctx.mentions.slice().reverse();
  const m = ms.find((x) => (x.np.kind === 'person' || x.np.kind === 'animal') && (!g || genderOf(x.np) === g)) || ms[0];
  if (m) return { kind: 'new', index: m.index };
  if (n.refKind === 'character') return { kind: 'selected' };
  return { kind: 'it', ...(g ? { g } : {}) };
}
const genderOf = (np) => (np.kind === 'person' ? (np.sex === 'F' ? 'f' : 'm') : /a$/.test(np.word || '') ? 'f' : 'm');

function targetOfNP(n, ctx) {
  if (n.newIndex !== undefined) return { kind: 'new', index: n.newIndex };
  if (n.ref) return n.ref;
  return resolveTarget(n, ctx, { create: false }) || (n.kind === 'ref' ? itTarget(n, ctx) : null);
}

/**
 * Target object for an NP: a plan-created entity ({kind:'new', index}) or a
 * scene entity description the executor resolves ({kind, type, query, id...}).
 * Returns null when a definite NP matches nothing (scene and plan).
 */
function resolveTarget(n, ctx, { plural = false } = {}) {
  if (n.newIndex !== undefined) return { kind: 'new', index: n.newIndex };
  if (n.ref) return n.ref;
  const { scene } = ctx;
  if (n.kind === 'ref') {
    if (n.refKind === 'character' && n.id) return { kind: 'character', id: n.id };
    if (n.all) return { kind: 'all' };
    return itTarget(n, ctx);
  }
  if (n.kind === 'special') return { kind: { window: 'window', door: 'door', room: 'room', wall: 'room' }[n.special] || 'room' };
  if (n.kind === 'room') return { kind: 'room' };
  // entities created earlier in this command (most recent first)
  for (const m of ctx.mentions.slice().reverse()) if (sameThing(m.np, n)) return { kind: 'new', index: m.index };
  if (n.kind === 'person') {
    const chars = (scene.characters || []).filter((c) => !n.sex || c.sex === n.sex);
    if (!chars.length) return null;
    const pick = pickOrdinal(chars, n.ord, scene.selected?.kind === 'character' ? scene.selected.id : null);
    return { kind: 'character', id: pick.id, type: pick.sex, ...(plural && n.det?.pl ? { all: true } : {}) };
  }
  if (n.kind === 'animal') {
    const list = (scene.animals || []).filter((a) => a.species === n.species || (n.speciesGroup && a.species.startsWith(n.speciesGroup)));
    if (!list.length) return null;
    const pick = pickOrdinal(list, n.ord, null);
    return { kind: 'animal', id: pick.id, type: pick.species, ...(plural && n.det?.pl ? { all: true } : {}) };
  }
  if (n.kind === 'prop') {
    const ids = propIds(n, ctx);
    const match = (scene.props || []).filter((p) => ids.has(p.type) || stem(norm(p.label).split(/\s+/)[0]) === n.head);
    if (match.length) {
      const pick = pickOrdinal(match, n.ord, null);
      return { kind: 'prop', id: pick.id, type: pick.type, query: n.word, ...(plural && n.det?.pl ? { all: true } : {}) };
    }
    // a prop of a room created by this command ("voglio una cucina, metti il tavolo al centro")
    if (ctx.roomPlanned) {
      const room = (ctx.lex.cat.rooms || []).find((r) => r.id === ctx.roomPlanned.preset);
      const hit = room?.items?.find((t) => ids.has(t) || stem(t.split('_')[0]) === n.head);
      if (hit) return { kind: 'prop', type: hit, query: n.word, ...(plural && n.det?.pl ? { all: true } : {}) };
    }
    return null;
  }
  return null;
}
function sameThing(a, b) {
  if (a === b) return true;
  if (a.kind !== b.kind || !b.det?.def) return false;
  if (a.kind === 'person') return !b.sex || a.sex === b.sex;
  if (a.kind === 'animal') return a.species === b.species || (b.speciesGroup && a.species?.startsWith(b.speciesGroup));
  if (a.kind === 'prop') return a.head === b.head;
  return false;
}
function pickOrdinal(list, ord, preferId) {
  if (ord === -1) return list[list.length - 1];
  if (ord > 0 && list[ord - 1]) return list[ord - 1];
  return list.find((x) => x.id === preferId) || list[list.length - 1];
}
/** Candidate prop type ids for an NP (ranked), cached on the NP. */
function propIds(n, ctx) {
  if (n._ids) return n._ids;
  const ranked = ctx.lex.rankProps(n.head, n.extra || [], {});
  n._ranked = ranked;
  n._ids = new Set(ranked.slice(0, 12).map((r) => r.id));
  return n._ids;
}

function placeOf(n, ctx) {
  if (!n.place) return null;
  const p = { relation: n.place.relation };
  if (n.place.target) { const t = targetFor(n.place.target, ctx); if (t) p.target = t; }
  if (n.place.target2) { const t = targetFor(n.place.target2, ctx); if (t) p.target2 = t; }
  if (n.place.side) p.side = n.place.side;
  return p;
}
function targetFor(t, ctx) {
  if (t.kind === 'camera') return { kind: 'camera' };
  if (t.kind === 'away') return null;
  if (t.newIndex !== undefined) return { kind: 'new', index: t.newIndex };
  return resolveTarget(t, ctx, {}) || (t.kind === 'ref' ? itTarget(t, ctx) : null);
}

function makeAdd(n, C, ctx, unknown) {
  const A = ctx.actions;
  let a = null;
  const count = Math.max(1, Math.min(12, n.count || 1));
  if (n.kind === 'person' || (n.kind === 'ref' && n.refKind === 'character' && !n.id)) {
    const sex = n.sex || balanceSex(ctx);
    a = { type: 'addCharacter', sex };
    if (n.body) a.bodyType = n.body;
    if (n.name) a.name = n.name;
    if (count > 1) a.count = Math.min(8, count);
    personFields(a, n, sex);
  } else if (n.kind === 'animal') {
    a = { type: 'addAnimal', species: n.species };
    if (count > 1) a.count = count;
    if (n.color) a.color = n.color;
    if (n.apose) a.pose = n.apose;
    if (n.size) a.size = n.size;
  } else if (n.kind === 'prop') {
    const ranked = n._ranked || ctx.lex.rankProps(n.head, n.extra || [], { hand: n.place?.relation === 'hand' });
    if (n.place?.relation === 'hand' && !n._handRanked) { n._ranked = ctx.lex.rankProps(n.head, n.extra || [], { hand: true }); }
    const best = (n.place?.relation === 'hand' ? n._ranked : ranked)[0];
    if (!best) { unknown.push(n.word); return null; }
    a = { type: 'addProp', propType: best.id, query: [n.word, ...(n.extraWords || [])].join(' ') };
    if (count > 1) a.count = count;
    if (n.color) a.color = n.color;
    if (n.size) a.size = n.size;
  } else return null;
  const pl = placeOf(n, ctx);
  if (n.owner && !pl) {
    // companion: "con un cane (accanto)"
    const ot = n.owner.newIndex !== undefined ? { kind: 'new', index: n.owner.newIndex } : targetOfNP(n.owner, ctx);
    if (ot) a.place = { relation: n.kind === 'prop' && ctx.lex.propById.get(a.propType)?.hand && (n.owner.kind === 'person' || n.owner.kind === 'ref') ? 'hand' : 'beside', target: ot };
  } else if (pl) {
    if (!pl.target && n.owner && pl.relation !== 'center' && pl.relation !== 'corner' && pl.relation !== 'wall') {
      const ot = n.owner.newIndex !== undefined ? { kind: 'new', index: n.owner.newIndex } : targetOfNP(n.owner, ctx);
      if (ot) pl.target = ot;
    }
    a.place = pl;
  } else if (n.floor && a.type === 'addCharacter') { /* on the floor: default */ }
  if (n.inRoom && a.place == null) a.place = { relation: 'in', target: { kind: 'room' } };
  if (n.facing) {
    if (n.facing.kind === 'camera') a.rotateTowards = { kind: 'camera' };
    else if (n.facing.kind === 'away') a.turnAway = true;
    else { const t = targetFor(n.facing, ctx); if (t) a.rotateTowards = t; }
  }
  if (n.lookAt) { const t = n.lookAt.kind === 'camera' ? { kind: 'camera' } : targetFor(n.lookAt, ctx); if (t) a.lookAt = t; }
  if (n.row) a.arrange = 'row';
  if (n.implicit) a.implicit = true;
  if (C.flags.look && a.rotateTowards && !a.lookAt) a.lookAt = a.rotateTowards;
  void A;
  return a;
}

function personFields(a, n, sex) {
  const outfit = [];
  const setName = n.outfitSet && OUTFIT_SETS[n.outfitSet];
  if (setName) for (const g of setName[sex] || setName.F) outfit.push(Array.isArray(g) ? { garment: g[0], color: g[1] } : { garment: g });
  for (const g of n.outfit) {
    const i = outfit.findIndex((x) => x.garment === g.garment);
    const o = g.color ? { garment: g.garment, color: g.color } : { garment: g.garment };
    if (i >= 0) outfit[i] = o; else outfit.push(o);
  }
  if (n.outfitColor) {
    // "vestita di rosso": the main garments take the colour
    if (!outfit.length) outfit.push(...(n.outfitSet === 'dress' || sex === 'F' && n.outfitColor ? [] : []));
    if (!outfit.some((g) => ['tshirt', 'shirt', 'sweatshirt', 'dress', 'longsleeve', 'tank', 'blazer'].includes(g.garment))) outfit.push({ garment: sex === 'F' && n.outfitSet === 'dress' ? 'dress' : 'tshirt' });
    for (const g of outfit) if (!g.color && !['sneakers', 'dressshoes', 'boots', 'socks', 'underwear'].includes(g.garment)) g.color = n.outfitColor;
  }
  if (outfit.length) a.outfit = outfit;
  if (n.outfitSet && !a.outfitSet) a.outfitSet = n.outfitSet;
  if (n.undress) a.undress = n.undress;
  const h = {};
  if (n.hair.style) h.style = n.hair.style;
  if (n.hair.color) h.color = n.hair.color;
  if (n.hair.beard) h.beard = n.hair.beard;
  if (Object.keys(h).length) a.hair = h;
  if (n.pose) a.pose = n.pose;
  if (n.expr) a.expression = n.expr;
  if (n.size) a.size = n.size;
}

function fillModify(a, n, C, ctx) {
  if (n.pose) a.pose = n.pose;
  if (n.apose) a.pose = n.apose;
  if (n.expr) a.expression = n.expr;
  if (n.outfit.length || n.outfitSet || n.outfitColor || n.undress) {
    const tmp = {};
    personFields(tmp, n, n.sex || (a.target?.type === 'M' ? 'M' : 'F'));
    if (tmp.outfit) a.outfit = tmp.outfit;
    if (tmp.undress) a.undress = tmp.undress;
  }
  const h = {};
  if (n.hair.style) h.style = n.hair.style;
  if (n.hair.color) h.color = n.hair.color;
  if (n.hair.beard) h.beard = n.hair.beard;
  if (Object.keys(h).length) a.hair = h;
  if (n.color) a.color = n.color;
  if (n.size) a.size = n.size;
  const pl = placeOf(n, ctx);
  if (pl) a.place = pl;
  if (n.inRoom && !a.place) a.place = { relation: 'in', target: { kind: 'room' } };
  if (n.facing) {
    if (n.facing.kind === 'camera') a.rotateTowards = { kind: 'camera' };
    else if (n.facing.kind === 'away') a.turnAway = true;
    else { const t = targetFor(n.facing, ctx); if (t) a.rotateTowards = t; }
  }
  if (n.lookAt) { const t = n.lookAt.kind === 'camera' ? { kind: 'camera' } : targetFor(n.lookAt, ctx); if (t) a.lookAt = t; }
  if ((C.intent === 'look' || C.flags.look) && a.rotateTowards && !a.lookAt) a.lookAt = a.rotateTowards;
  if (C.turn && C.intent === 'turn') a.turn = C.turn;
  if (C.intent === 'turn' && !a.rotateTowards && !a.turn && !a.turnAway && a.place?.relation && ['left', 'right', 'behind', 'front'].includes(a.place.relation) && !a.place.target) {
    // "gira la donna a sinistra": a direction, not a place
    a.rotateTowards = { kind: 'direction', type: a.place.relation };
    delete a.place;
  }
  if (C.intent === 'turn' && !a.rotateTowards && !a.turn && !a.turnAway && !a.place) a.turn = 180;
}

function balanceSex(ctx) {
  const chars = ctx.scene.characters || [];
  let f = chars.filter((c) => c.sex === 'F').length, m = chars.length - f;
  for (const a of ctx.actions) if (a.type === 'addCharacter') { if (a.sex === 'F') f += a.count || 1; else m += a.count || 1; }
  return f > m ? 'M' : 'F';
}
