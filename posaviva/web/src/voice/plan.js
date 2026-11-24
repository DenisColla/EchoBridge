// The command plan: the common output of the offline parser and of the cloud
// model (Claude, structured output with the zod schema in schema.js), and the
// input of the executor. Plain data, versioned:
//
// Plan = { actions: Action[], unknown: string[] }      (unknown = fragments not understood)
//
// Target = { kind: 'new'|'character'|'animal'|'prop'|'it'|'selected'|'camera'|'room'|'window'|'door'|'all',
//            index?  (kind 'new': index of the action of this plan that created it),
//            id?     (scene id from the scene summary), type? (sex F|M, species id, prop type id),
//            query?  (Italian word, e.g. "tavolo"), name?, ordinal? (1 = first, -1 = last), all? (every match) }
// Place  = { relation: RELATIONS[i], target?: Target, target2?: Target (between), side?: 'left'|'right' }
//
// Actions (field `type`):
//   addCharacter { sex, bodyType?, name?, count?, outfit?: [{garment, color?}], outfitSet?, hair?: {style?, color?, beard?},
//                  pose?, expression?, place?, rotateTowards?, lookAt? }
//   addAnimal    { species, count?, pose?, place?, rotateTowards?, size? }
//   addProp      { propType? | query?, count?, color?, place?, rotateTowards?, size? }
//   addRoom      { preset }
//   landscape    { spec: {preset?, place?, time?, weather?, season?, density?, features?} }
//   modify       { target, pose?, outfit?, color?, expression?, hair?, rotateTowards?, turn? (degrees), place?, lookAt?, size? }
//   camera       { angle?, focal?, framing?, target? }
//   lights       { preset?, time? }
//   remove       { target }
//   project      { op: 'save'|'open'|'browse', what?: 'scene'|'landscape'|'character'|'pose', name?, project?,
//                  section?, sectionKind?: 'capitolo'|'tavola'|'vignetta', query?, target? (character to save / pose to) }
//                  (app.projects: save into a project / section, open a scene, apply a landscape or pose, insert a character)

export const PLAN_VERSION = 1;
export const RELATIONS = ['left', 'right', 'front', 'behind', 'beside', 'near', 'on', 'under', 'center', 'corner', 'wall', 'between', 'around', 'seat', 'hand', 'floor', 'in', 'row', 'facing'];
export const TARGET_KINDS = ['new', 'character', 'animal', 'prop', 'it', 'selected', 'camera', 'room', 'window', 'door', 'all'];
export const ACTION_TYPES = ['addCharacter', 'addAnimal', 'addProp', 'addRoom', 'landscape', 'modify', 'camera', 'lights', 'remove', 'project'];
export const PROJECT_OPS = ['save', 'open', 'browse'];
export const SAVED_TYPES = ['scene', 'landscape', 'character', 'pose'];
export const SECTION_KINDS = ['capitolo', 'tavola', 'vignetta'];
export const BODY_TYPES = ['slim', 'normal', 'curvy'];
export const FRAMINGS = ['subject', 'all', 'face', 'body', 'hand'];
export const LIMITS = { characters: 8, perAction: 12, animals: 12 };

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Validates and cleans a plan against the vocabulary (ids that do not exist are
 * dropped and reported in `unknown`). Never throws: a broken plan becomes an
 * empty one with the problem listed. Returns {actions, unknown}.
 */
export function normalizePlan(plan, cat = {}) {
  const out = { actions: [], unknown: [] };
  if (!isObj(plan)) { out.unknown.push('risposta non valida'); return out; }
  const ids = (arr) => new Set((arr || []).map((x) => x.id));
  const S = {
    garments: ids(cat.garments), poses: ids(cat.poses), expr: ids(cat.expressions), species: ids(cat.animals), props: ids(cat.props),
    rooms: ids(cat.rooms), landscapes: ids(cat.landscapes), lights: ids(cat.lights), angles: ids(cat.angles), hair: ids(cat.hairStyles), beards: ids(cat.beards),
    animalPoses: new Map((cat.animals || []).map((a) => [a.id, new Set((a.poses || []).map((p) => p.id))])),
  };
  const known = (set, v) => (v === undefined ? undefined : !set.size || set.has(v) ? v : (out.unknown.push(String(v)), undefined));
  for (const u of Array.isArray(plan.unknown) ? plan.unknown : []) if (str(u)) out.unknown.push(str(u));
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const indexMap = new Map(); // original index -> cleaned index (targets of kind 'new')
  const target = (t) => {
    if (!isObj(t) || !TARGET_KINDS.includes(t.kind)) return undefined;
    const o = { kind: t.kind };
    if (t.kind === 'new') { const k = indexMap.get(num(t.index)); if (k === undefined) return undefined; o.index = k; }
    for (const f of ['id', 'type', 'query', 'name']) if (str(t[f])) o[f] = str(t[f]);
    if (num(t.ordinal) !== undefined) o.ordinal = Math.round(t.ordinal);
    if (t.all === true) o.all = true;
    if (t.g === 'f' || t.g === 'm') o.g = t.g;
    return o;
  };
  const place = (p) => {
    if (!isObj(p) || !RELATIONS.includes(p.relation)) return undefined;
    const o = { relation: p.relation };
    const t = target(p.target); if (t) o.target = t;
    const t2 = target(p.target2); if (t2) o.target2 = t2;
    if (p.side === 'left' || p.side === 'right') o.side = p.side;
    return o;
  };
  const outfit = (arr) => (Array.isArray(arr) ? arr.map((g) => (isObj(g) ? { garment: known(S.garments, str(g.garment)), color: hex(g.color) } : null)).filter((g) => g && g.garment).map((g) => (g.color ? g : { garment: g.garment })) : undefined);
  const hair = (h) => {
    if (!isObj(h)) return undefined;
    const o = {};
    const st = known(S.hair, str(h.style)); if (st) o.style = st;
    const c = hex(h.color); if (c) o.color = c;
    const b = known(S.beards, str(h.beard)); if (b) o.beard = b;
    return Object.keys(o).length ? o : undefined;
  };
  const count = (v, max) => (num(v) === undefined ? undefined : clamp(Math.round(v), 1, max));
  actions.forEach((a, i) => {
    if (!isObj(a) || !ACTION_TYPES.includes(a.type)) { if (isObj(a)) out.unknown.push(String(a.type || 'azione')); return; }
    let o = null;
    switch (a.type) {
      case 'addCharacter': {
        const sex = a.sex === 'M' || a.sex === 'F' ? a.sex : 'F';
        o = { type: a.type, sex };
        if (BODY_TYPES.includes(a.bodyType)) o.bodyType = a.bodyType;
        if (str(a.name)) o.name = str(a.name).slice(0, 40);
        const c = count(a.count, LIMITS.characters); if (c > 1) o.count = c;
        const of = outfit(a.outfit); if (of?.length) o.outfit = of;
        if (str(a.outfitSet)) o.outfitSet = str(a.outfitSet);
        if (['all', 'shoes', 'top'].includes(a.undress)) o.undress = a.undress;
        const hr = hair(a.hair); if (hr) o.hair = hr;
        const ps = known(S.poses, str(a.pose)); if (ps) o.pose = ps;
        const ex = known(S.expr, str(a.expression)); if (ex) o.expression = ex;
        break;
      }
      case 'addAnimal': {
        const sp = known(S.species, str(a.species));
        if (!sp) return;
        o = { type: a.type, species: sp };
        const c = count(a.count, LIMITS.animals); if (c > 1) o.count = c;
        const ap = str(a.pose); if (ap) { const set = S.animalPoses.get(sp); if (!set || !set.size || set.has(ap)) o.pose = ap; }
        const ac = hex(a.color); if (ac) o.color = ac;
        break;
      }
      case 'addProp': {
        const pt = str(a.propType) && (!S.props.size || S.props.has(str(a.propType))) ? str(a.propType) : undefined;
        const q = str(a.query) || (str(a.propType) && !pt ? str(a.propType) : undefined);
        if (!pt && !q && !str(a.kit)) return;
        o = { type: a.type };
        if (pt) o.propType = pt;
        if (q) o.query = q.slice(0, 60);
        const c = count(a.count, LIMITS.perAction); if (c > 1) o.count = c;
        const col = hex(a.color); if (col) o.color = col;
        break;
      }
      case 'addRoom': {
        const r = known(S.rooms, str(a.preset));
        if (!r) return;
        o = { type: a.type, preset: r };
        break;
      }
      case 'landscape': {
        const sp = isObj(a.spec) ? a.spec : {};
        const spec = {};
        const pr = str(sp.preset); if (pr && (!S.landscapes.size || S.landscapes.has(pr))) spec.preset = pr;
        for (const f of ['place', 'time', 'weather', 'season']) if (str(sp[f])) spec[f] = str(sp[f]).slice(0, 80);
        if (num(sp.density) !== undefined) spec.density = clamp(sp.density, 0, 1);
        if (Array.isArray(sp.features)) spec.features = sp.features.map(str).filter(Boolean).slice(0, 12);
        if (sp.atmosphereOnly === true) spec.atmosphereOnly = true;
        o = { type: a.type, spec };
        break;
      }
      case 'modify': {
        const t = target(a.target);
        if (!t) { out.unknown.push('modifica senza soggetto'); return; }
        o = { type: a.type, target: t };
        const ps = str(a.pose); if (ps) o.pose = ps; // human or animal pose id (checked by the executor)
        const of = outfit(a.outfit); if (of?.length) o.outfit = of;
        if (['all', 'shoes', 'top'].includes(a.undress)) o.undress = a.undress;
        const col = hex(a.color); if (col) o.color = col;
        const ex = known(S.expr, str(a.expression)); if (ex) o.expression = ex;
        const hr = hair(a.hair); if (hr) o.hair = hr;
        if (num(a.turn) !== undefined) o.turn = clamp(a.turn, -360, 360);
        break;
      }
      case 'camera': {
        o = { type: a.type };
        const an = known(S.angles, str(a.angle)); if (an) o.angle = an;
        if (num(a.focal) !== undefined) o.focal = clamp(Math.round(a.focal), 8, 400);
        if (FRAMINGS.includes(a.framing)) o.framing = a.framing;
        const t = target(a.target); if (t) o.target = t;
        if (!o.angle && !o.focal && !o.framing && !o.target) return;
        break;
      }
      case 'lights': {
        o = { type: a.type };
        const pr = known(S.lights, str(a.preset)); if (pr) o.preset = pr;
        if (str(a.time)) o.time = str(a.time);
        if (!o.preset && !o.time) return;
        break;
      }
      case 'remove': {
        const t = target(a.target);
        if (!t) return;
        o = { type: a.type, target: t };
        break;
      }
      case 'project': {
        if (!PROJECT_OPS.includes(a.op)) return;
        o = { type: a.type, op: a.op };
        if (SAVED_TYPES.includes(a.what)) o.what = a.what;
        for (const f of ['name', 'project', 'section', 'query']) if (str(a[f])) o[f] = str(a[f]).slice(0, 80);
        if (SECTION_KINDS.includes(a.sectionKind)) o.sectionKind = a.sectionKind;
        const t = target(a.target); if (t) o.target = t;
        if (a.op === 'open' && !o.name) { out.unknown.push('quale elemento salvato'); return; }
        break;
      }
    }
    if (!o) return;
    // shared optional fields
    if (a.type !== 'addRoom' && a.type !== 'landscape' && a.type !== 'camera' && a.type !== 'lights' && a.type !== 'remove' && a.type !== 'project') {
      const pl = place(a.place); if (pl) o.place = pl;
      const rt = target(a.rotateTowards); if (rt) o.rotateTowards = rt;
      const la = target(a.lookAt); if (la) o.lookAt = la;
      if (num(a.size) !== undefined) o.size = clamp(a.size, 0.3, 3);
      if (a.implicit === true) o.implicit = true;
      if (a.existing === true) o.existing = true;
      if (a.turnAway === true) o.turnAway = true;
      if (a.arrange === 'row') o.arrange = 'row';
      if (a.mutual === true && a.type === 'addCharacter') o.mutual = true;
      if (a.type === 'addProp' && str(a.kit)) o.kit = str(a.kit);
    }
    indexMap.set(i, out.actions.length);
    out.actions.push(o);
  });
  return out;
}

/** True if the plan has nothing to do. */
export const isEmptyPlan = (p) => !p || !p.actions?.length;
