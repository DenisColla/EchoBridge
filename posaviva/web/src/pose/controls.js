// Anatomical control model: user-facing body parts ("parti") mapped to bones,
// each with up to 3 anatomical axes (Italian labels, natural limits).
//
// Axis -> bone mapping was determined empirically (single-axis renders + numeric
// probes of the rest frames, see the report): rest pose is an A-pose with the
// elbows ~40-50 deg flexed; bone frames have Y along the bone and X = normal of
// the MakeHuman rotation plane (= hinge axis of elbows, knees and fingers).
// Signs below are for the LEFT side; the right side follows the mirror
// convention q(x,y,z,w) -> q(x,-y,-z,w), i.e. X keeps its sign, Y/Z flip.
//
// A control value is read from the bones it drives with a least-squares fit
// (value = sum(w*c) / sum(w^2), c = signed Euler component of each bone) and
// written as a delta distributed by the drive weights. Distributed controls
// (spine, neck, twist bones) use weights summing to 1; "together" controls
// (toes) use weight 1 on every bone.

const D = Math.PI / 180;

/** Ring / slider colors of the 3 axis slots (flexion, abduction/lateral, rotation). */
export const AXIS_COLORS = ['#ff6b7a', '#5fdc8c', '#5aa9ff'];

/** Euler order per bone family (outermost first). Root: yaw first; clavicle: elevation first; wrist: flexion (Z) first. */
function orderOf(name) {
  if (name === 'root') return 'ZXY';
  if (name.startsWith('clavicle') || name.startsWith('shoulder01')) return 'ZXY';
  if (name.startsWith('wrist')) return 'ZXY';
  return 'XZY';
}

const FINGERS = [
  { n: 1, label: 'Pollice' }, { n: 2, label: 'Indice' }, { n: 3, label: 'Medio' }, { n: 4, label: 'Anulare' }, { n: 5, label: 'Mignolo' },
];
export const FINGER_NAMES = FINGERS.map((f) => f.label);
const SEGMENTS = ['metacarpo', 'base', 'media', 'punta'];

// ---------------------------------------------------------------- soft spine
/** Bones of the coupled back + neck chain (pelvis -> head). */
const SPINE_CHAIN = ['spine05', 'spine04', 'spine03', 'spine02', 'spine01', 'neck01', 'neck02', 'neck03'];
/**
 * Weight profiles of the chain controls over SPINE_CHAIN (each sums to 1: the chain end
 * turns by the control value). 'soft' ("Colonna morbida"): overlapping bell-shaped
 * profiles, lumbar-heavy for the abdomen, thoracic-heavy for the chest (twist mostly
 * thoracic, as in a real spine), the neck starting in the upper back: any of the three
 * bends the back as one continuous curve. 'hard': the old one-part-only distribution.
 * Values are read back with the pseudo-inverse of the profile matrix (per axis), so
 * every control keeps its own value although the bones are shared.
 */
const SPINE_PROFILES = {
  soft: {
    abdomen: { flex: [0.30, 0.29, 0.21, 0.12, 0.06, 0.02, 0, 0], lat: [0.26, 0.27, 0.23, 0.14, 0.08, 0.02, 0, 0], rot: [0.16, 0.22, 0.25, 0.20, 0.15, 0.02, 0, 0] },
    chest: { flex: [0.03, 0.07, 0.20, 0.31, 0.29, 0.07, 0.03, 0], lat: [0.04, 0.09, 0.22, 0.30, 0.27, 0.06, 0.02, 0], rot: [0.02, 0.05, 0.18, 0.32, 0.35, 0.06, 0.02, 0] },
    neck: { flex: [0, 0, 0, 0.04, 0.10, 0.34, 0.29, 0.23], lat: [0, 0, 0, 0.04, 0.10, 0.34, 0.29, 0.23], rot: [0, 0, 0, 0, 0.08, 0.36, 0.30, 0.26] },
  },
  hard: {
    abdomen: { all: [0.5, 0.5, 0, 0, 0, 0, 0, 0] },
    chest: { all: [0, 0, 1 / 3, 1 / 3, 1 / 3, 0, 0, 0] },
    neck: { all: [0, 0, 0, 0, 0, 1 / 3, 1 / 3, 1 / 3] },
  },
};

// ---------------------------------------------------------------- definitions
// axis: [key, label, min, max, drives:[[bone, letter, signL, weight]], opts?]
// opts.extra: shown/editable only with "Limiti anatomici" off (non-anatomical DOF)
// opts.hinge: limits are anatomical (from a straight joint); the rest bend is measured per body
// opts.hint: short help shown under the slider
const CENTER = [
  {
    id: 'pelvis', label: 'Bacino', full: 'Bacino (corpo intero)', pivot: 'root', own: ['root', 'pelvis.L', 'pelvis.R'], size: 'l', free: true, region: 'torso',
    axes: [
      ['flex', 'Inclinazione avanti', -180, 180, [['root', 'x', -1, 1]]],
      ['lat', 'Inclinazione laterale', -180, 180, [['root', 'y', -1, 1]]],
      ['rot', 'Rotazione', -180, 180, [['root', 'z', 1, 1]]],
    ],
  },
  // abdomen / chest / neck form one coupled chain (see SPINE_CHAIN above): their axes
  // drive every bone of spine05..neck03 with overlapping weight profiles, so bending
  // one part curves the whole back (no single hinge); the 'drives' listed here only
  // give letter and sign, the weights come from setSoft()
  {
    id: 'abdomen', label: 'Addome', pivot: 'spine05', own: ['spine05', 'spine04'], size: 'l', region: 'torso', chain: 'spine',
    axes: [
      ['flex', 'Flessione (avanti)', -25, 45, SPINE_CHAIN.map((b) => [b, 'x', -1, 0])],
      ['lat', 'Inclinazione laterale', -25, 25, SPINE_CHAIN.map((b) => [b, 'z', 1, 0])],
      ['rot', 'Torsione', -20, 20, SPINE_CHAIN.map((b) => [b, 'y', 1, 0])],
    ],
  },
  {
    id: 'chest', label: 'Busto', pivot: 'spine03', own: ['spine03', 'spine02', 'spine01'], size: 'l', region: 'torso', chain: 'spine',
    axes: [
      ['flex', 'Flessione (avanti)', -25, 50, SPINE_CHAIN.map((b) => [b, 'x', -1, 0])],
      ['lat', 'Inclinazione laterale', -30, 30, SPINE_CHAIN.map((b) => [b, 'z', 1, 0])],
      ['rot', 'Torsione', -35, 35, SPINE_CHAIN.map((b) => [b, 'y', 1, 0])],
    ],
  },
  {
    id: 'neck', label: 'Collo', pivot: 'neck01', own: ['neck01', 'neck02', 'neck03'], size: 'm', region: 'head', chain: 'spine',
    axes: [
      ['flex', 'Flessione (avanti)', -45, 50, SPINE_CHAIN.map((b) => [b, 'x', -1, 0])],
      ['lat', 'Inclinazione laterale', -35, 35, SPINE_CHAIN.map((b) => [b, 'z', 1, 0])],
      ['rot', 'Rotazione', -60, 60, SPINE_CHAIN.map((b) => [b, 'y', 1, 0])],
    ],
  },
  {
    id: 'head', label: 'Testa', pivot: 'head', own: ['head', 'eye.L', 'eye.R'], size: 'm', region: 'head',
    axes: [
      ['flex', 'Flessione (mento giù)', -35, 30, [['head', 'x', -1, 1]]],
      ['lat', 'Inclinazione laterale', -25, 25, [['head', 'z', 1, 1]]],
      ['rot', 'Rotazione', -35, 35, [['head', 'y', 1, 1]]],
    ],
  },
];

const SIDED = [
  {
    id: 'shoulder', label: 'Spalla', f: true, pivot: 'clavicle', dot: ['clavicle', 0.55], own: ['clavicle', 'shoulder01'], size: 'm', region: 'arm',
    axes: [
      ['elev', 'Alza / abbassa', -12, 35, [['clavicle', 'z', -1, 0.65], ['shoulder01', 'z', -1, 0.35]]],
      ['prot', 'Avanti / indietro', -20, 25, [['clavicle', 'x', -1, 0.65], ['shoulder01', 'x', -1, 0.35]]],
      ['rot', 'Rotazione', -15, 15, [['clavicle', 'y', 1, 0.65], ['shoulder01', 'y', 1, 0.35]], { extra: true }],
    ],
  },
  {
    id: 'arm', label: 'Braccio', pivot: 'upperarm01', own: ['upperarm01', 'upperarm02'], size: 'l', region: 'arm',
    axes: [
      ['flex', 'Flessione (avanti)', -60, 175, [['upperarm01', 'x', -1, 1]]],
      ['abd', 'Abduzione (apri)', -55, 130, [['upperarm01', 'z', -1, 1]]],
      ['rot', 'Rotazione (esterna)', -75, 85, [['upperarm01', 'y', -1, 0.5], ['upperarm02', 'y', -1, 0.5]]],
    ],
  },
  {
    id: 'forearm', label: 'Avambraccio', pivot: 'lowerarm01', own: ['lowerarm01', 'lowerarm02'], size: 'm', region: 'arm',
    axes: [
      ['flex', 'Flessione gomito', -2, 148, [['lowerarm01', 'x', -1, 1]], { hinge: 'elbow' }],
      ['rot', 'Pronazione (palmo giù)', -85, 85, [['lowerarm01', 'y', 1, 0.35], ['lowerarm02', 'y', 1, 0.65]]],
      ['lat', 'Laterale', -30, 30, [['lowerarm01', 'z', 1, 1]], { extra: true }],
    ],
  },
  {
    id: 'hand', label: 'Mano', f: true, full: 'Polso / mano', pivot: 'wrist', dot: ['wrist', 0.45], own: ['wrist'], size: 'm', region: 'hand',
    axes: [
      ['flex', 'Flessione (palmo)', -70, 80, [['wrist', 'z', 1, 1]]],
      ['dev', 'Deviazione (verso mignolo)', -20, 35, [['wrist', 'x', 1, 1]]],
      ['rot', 'Pronazione (palmo giù)', -85, 85, [['lowerarm01', 'y', 1, 0.35], ['lowerarm02', 'y', 1, 0.65]]],
    ],
  },
  {
    id: 'thigh', label: 'Coscia', f: true, pivot: 'upperleg01', own: ['upperleg01', 'upperleg02'], size: 'l', region: 'leg',
    axes: [
      ['flex', 'Flessione (avanti)', -30, 130, [['upperleg01', 'x', 1, 1]]],
      ['abd', 'Abduzione (apri)', -30, 60, [['upperleg01', 'z', 1, 1]]],
      ['rot', 'Rotazione (esterna)', -40, 50, [['upperleg01', 'y', -1, 0.5], ['upperleg02', 'y', -1, 0.5]]],
    ],
  },
  {
    id: 'shin', label: 'Gamba', f: true, full: 'Gamba (ginocchio)', pivot: 'lowerleg01', own: ['lowerleg01', 'lowerleg02'], size: 'l', region: 'leg',
    axes: [
      ['flex', 'Flessione ginocchio', -3, 160, [['lowerleg01', 'x', -1, 1]], { hinge: 'knee' }],
      ['rot', 'Rotazione (esterna)', -25, 25, [['lowerleg01', 'y', -1, 0.5], ['lowerleg02', 'y', -1, 0.5]]],
      ['lat', 'Laterale', -20, 20, [['lowerleg01', 'z', 1, 1]], { extra: true }],
    ],
  },
  {
    id: 'foot', label: 'Piede', pivot: 'foot', dot: ['foot', 0.5], own: ['foot'], size: 'm', region: 'leg',
    axes: [
      ['flex', 'Punta in giù', -35, 50, [['foot', 'x', -1, 1]]],
      ['abd', 'Punta in fuori', -25, 25, [['foot', 'z', 1, 1]]],
      ['inv', 'Inversione (pianta dentro)', -20, 30, [['foot', 'y', -1, 1]]],
    ],
  },
  {
    id: 'toes', label: 'Dita del piede', f: true, plural: true, pivot: 'toe3-1', dot: ['toe3-1', 0.5], own: ['toe1-1', 'toe2-1', 'toe3-1', 'toe4-1', 'toe5-1'], size: 's', region: 'leg',
    axes: [
      ['flex', 'Flessione (giù)', -45, 40, [1, 2, 3, 4, 5].map((n) => [`toe${n}-1`, 'x', -1, 1])],
      ['abd', 'Apertura', -15, 15, [[`toe1-1`, 'z', -1, 1], [`toe2-1`, 'z', -1, 0.5], [`toe4-1`, 'z', 1, 0.5], [`toe5-1`, 'z', 1, 1]], { extra: true }],
    ],
  },
];

/** Finger segments: thumb has 3 (no metacarpal bone), the other fingers metacarpal + 3 phalanges. */
function fingerDefs() {
  const out = [];
  for (const f of FINGERS) {
    const segs = f.n === 1 ? [1, 2, 3] : [0, 1, 2, 3];
    for (const j of segs) {
      const bone = j === 0 ? `metacarpal${f.n - 1}` : `finger${f.n}-${j}`;
      const id = `f${f.n}${j}`;
      let axes;
      if (f.n === 1 && j === 1) {
        axes = [
          ['flex', 'Flessione (verso il palmo)', -25, 45, [[bone, 'x', -1, 1]]],
          ['abd', 'Abduzione palmare', -15, 55, [[bone, 'z', -1, 1]]],
          ['rot', 'Rotazione (opposizione)', -35, 35, [[bone, 'y', 1, 1]]],
        ];
      } else if (j === 0) {
        axes = [
          ['flex', 'Chiusura palmo', -10, 20, [[bone, 'x', -1, 1]]],
          ['abd', 'Apertura (verso mignolo)', -10, 10, [[bone, 'z', 1, 1]]],
          ['rot', 'Rotazione', -15, 15, [[bone, 'y', 1, 1]], { extra: true }],
        ];
      } else {
        const flexMax = f.n === 1 ? (j === 2 ? 65 : 85) : j === 1 ? 90 : j === 2 ? 110 : 85;
        const flexMin = f.n === 1 ? (j === 2 ? -10 : -20) : j === 1 ? -25 : j === 2 ? -5 : -10;
        axes = [
          ['flex', 'Flessione', flexMin, flexMax, [[bone, 'x', -1, 1]]],
          ['abd', 'Apertura (verso mignolo)', -25, 25, [[bone, 'z', 1, 1]], j === 1 && f.n !== 1 ? {} : { extra: true }],
          ['rot', 'Rotazione', -15, 15, [[bone, 'y', 1, 1]], { extra: true }],
        ];
      }
      out.push({
        id, label: f.label, seg: SEGMENTS[j], finger: f.n, phalanx: j, pivot: bone, own: [bone], size: 's', region: 'finger',
        dot: [bone, 0.5], axes,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- expansion
const SIDE_WORD = { L: ['sinistro', 'sinistra', 'sinistri', 'sinistre'], R: ['destro', 'destra', 'destri', 'destre'] };

function sideWord(def, side) { return SIDE_WORD[side][(def.f ? 1 : 0) + (def.plural ? 2 : 0)]; }

/**
 * Expanded control: {id, baseId, label, side, pivot, dot:[bone,t], own:[names], size, free, region,
 *  axes:[{key, label, min, max (radians), extra, hinge, drives:[{bone, i, letter, sign, w}]}], mirrorId}
 */
function expand(def, side, model) {
  const sfx = side ? '.' + side : '';
  const bn = (b) => (side && !b.endsWith('.L') && !b.endsWith('.R') && b !== 'root' && !b.startsWith('spine') && !b.startsWith('neck') && b !== 'head' ? b + sfx : b);
  const id = def.id + sfx;
  const isFinger = def.region === 'finger';
  const label = isFinger
    ? `${def.label} ${sideWord({ f: false }, side)} · ${def.seg}`
    : side ? `${def.full || def.label} ${sideWord(def, side)}` : (def.full || def.label);
  const axes = def.axes.map(([key, lab, min, max, drives, opts = {}]) => ({
    key, label: lab, min: min * D, max: max * D, extra: !!opts.extra, hinge: opts.hinge || null,
    drives: drives.map(([b, letter, sign, w]) => {
      const name = bn(b);
      const i = model.boneIndex.get(name);
      if (i === undefined) throw new Error(`[pose] unknown bone ${name}`);
      // mirror convention: X keeps its sign, Y and Z flip on the right side
      const s = side === 'R' && letter !== 'x' ? -sign : sign;
      return { bone: name, i, letter, li: 'xyz'.indexOf(letter), sign: s, w };
    }),
  }));
  const pivotIndex = model.boneIndex.get(bn(def.pivot));
  for (const a of axes) {
    a.coupled = !!def.chain;
    // drive on the pivot bone (ring axis, ring knob, trackball deltas); else the first
    a.pd = a.drives.find((d) => d.i === pivotIndex) || a.drives[0];
    sumWeights(a);
  }
  const dot = def.dot ? [bn(def.dot[0]), def.dot[1]] : [bn(def.pivot), 0];
  return {
    id, baseId: def.id, label, short: def.label, seg: def.seg || null, finger: def.finger || 0, phalanx: def.phalanx ?? -1,
    side: side || null, pivot: bn(def.pivot), pivotIndex, dot, own: def.own.map(bn),
    size: def.size, free: !!def.free, region: def.region, axes, coupled: !!def.chain,
    mirrorId: side ? def.id + (side === 'L' ? '.R' : '.L') : null,
  };
}

function sumWeights(a) {
  let w = 0, w2 = 0;
  for (const d of a.drives) { w += d.w; w2 += d.w * d.w; }
  a.wsum2 = w2;
  // distributed axes (weights sum to 1) read as the plain sum of their bones,
  // "together" axes (toes, weight 1 each) as the least-squares common value
  a.sum = Math.abs(w - 1) < 1e-6;
}

/** Inverse of a small symmetric positive definite matrix (Gauss-Jordan), n x n, row-major arrays. */
function invert(M) {
  const n = M.length, A = M.map((r, i) => [...r, ...M.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-12;
    for (let k = 0; k < 2 * n; k++) A[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (f) for (let k = 0; k < 2 * n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((r) => r.slice(n));
}

/** Builds the control table for a model (one instance per app). */
export class ControlSet {
  constructor(model) {
    this.model = model;
    /** @type {any[]} */
    this.list = [];
    for (const d of CENTER) this.list.push(expand(d, null, model));
    for (const side of ['L', 'R']) {
      for (const d of SIDED) this.list.push(expand(d, side, model));
      for (const d of fingerDefs()) this.list.push(expand(d, side, model));
    }
    this.byId = new Map(this.list.map((c) => [c.id, c]));
    // bone -> owning control (picking, highlight)
    this.ownerOfBone = new Array(model.bones.length).fill(null);
    for (const c of this.list) for (const b of c.own) { const i = model.boneIndex.get(b); if (i !== undefined) this.ownerOfBone[i] = c; }
    // per-bone Euler order + letter ranges (used to choose between the two Euler solutions)
    this.order = model.bones.map((b) => orderOf(b.name));
    this.range = model.bones.map(() => [[-Math.PI, Math.PI], [-Math.PI, Math.PI], [-Math.PI, Math.PI]]);
    this.chainControls = this.list.filter((c) => c.coupled);
    this.soft = null;
    this.setSoft(true); // also computes the Euler ranges
    // bones driven by each control (unique, hierarchy order) and the topmost one
    for (const c of this.list) {
      const set = new Set();
      for (const a of c.axes) for (const d of a.drives) set.add(d.i);
      c.boneIdx = [...set].sort((a, b) => a - b);
      for (const a of c.axes) for (const d of a.drives) d.j = c.boneIdx.indexOf(d.i); // slot in boneIdx
      c.topIndex = c.boneIdx.reduce((best, i) => (isAncestor(model, i, best) ? i : best), c.boneIdx[0]);
      // bones a free (trackball) rotation is applied to: the pivot plus sibling roots
      // (toes), never bones above the pivot (the hand's forearm twist bone)
      const below = c.boneIdx.filter((i) => !isAncestor(model, i, c.pivotIndex));
      c.freeRoots = below.filter((i) => i === c.pivotIndex || !below.some((j) => j !== i && isAncestor(model, j, i)));
    }
  }

  /**
   * "Colonna morbida": soft (overlapping, continuous) or hard (one part only) weight
   * profiles of the abdomen / chest / neck chain. Bone rotations are kept: only how
   * they are split among the three parts (and read back) changes.
   */
  setSoft(on) {
    on = !!on;
    if (this.soft === on) return;
    this.soft = on;
    const P = SPINE_PROFILES[on ? 'soft' : 'hard'];
    const cs = this.chainControls;
    for (const key of ['flex', 'lat', 'rot']) {
      const axes = cs.map((c) => c.axes.find((a) => a.key === key));
      const W = cs.map((c) => { const p = P[c.baseId]; return p[key] || p.all; });
      // read weights = rows of the pseudo-inverse (W W^T)^-1 W of the profile matrix
      const G = W.map((wi) => W.map((wj) => wi.reduce((s, v, b) => s + v * wj[b], 0)));
      const Gi = invert(G);
      axes.forEach((a, ci) => {
        a.drives.forEach((d, b) => {
          d.w = W[ci][b];
          d.rw = W.reduce((s, wk, k) => s + Gi[ci][k] * wk[b], 0);
        });
        sumWeights(a);
      });
    }
    this._ranges();
  }

  /** Euler ranges per bone letter (picks between the two Euler solutions): sum of every control's share. */
  _ranges() {
    const lo = this.range.map(() => [0, 0, 0]), hi = this.range.map(() => [0, 0, 0]), hit = this.range.map(() => [false, false, false]);
    for (const c of this.list) {
      if (c.free) continue;
      for (const a of c.axes) for (const d of a.drives) {
        if (!d.w) continue;
        // per-bone share of the control range (sign aware)
        lo[d.i][d.li] += Math.min(a.min * d.w * d.sign, a.max * d.w * d.sign);
        hi[d.i][d.li] += Math.max(a.min * d.w * d.sign, a.max * d.w * d.sign);
        hit[d.i][d.li] = true;
      }
    }
    // generous margin; bones no control drives keep the full circle
    for (let i = 0; i < this.range.length; i++) for (let l = 0; l < 3; l++) this.range[i][l] = hit[i][l] ? [lo[i][l] - 0.35, hi[i][l] + 0.35] : [-Math.PI, Math.PI];
  }

  get(id) { return this.byId.get(id) || null; }

  /** control owning a bone index (or null) */
  forBone(i) { return this.ownerOfBone[i] || null; }

  /** Finger control id: finger 1..5, segment 0 (metacarpal) ..3, side 'L'|'R' */
  fingerId(finger, seg, side) { return `f${finger}${seg}.${side}`; }
}

function isAncestor(model, a, b) {
  // true if bone a is an ancestor of bone b
  let p = model.bones[b].parent;
  while (p >= 0) { if (p === a) return true; p = model.bones[p].parent; }
  return false;
}

/** Display helpers */
export const toDeg = (r) => r / D;
export const toRad = (d) => d * D;
