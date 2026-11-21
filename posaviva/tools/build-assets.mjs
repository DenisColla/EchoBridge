#!/usr/bin/env node
// Builds the compact human asset pack used by the PosaViva web app from the
// CC0 MakeHuman data (base mesh hm08, targets, default skeleton/weights, eyes).
//
//   node tools/build-assets.mjs [path/to/makehuman/data]
//
// Output: web/public/assets/human.json (metadata) + human.bin (typed arrays)
//         web/public/assets/eye.png, skin.png
// All positions are emitted in METERS, Y up, character facing +Z.
// Format v2 (~3.6 MB instead of 8.2): preset positions as 0.1 mm steps from the
// base mesh and slider deltas as varint streams (see encodeStream), UVs and skin
// weights as 16-bit fractions; decoded by web/src/core/HumanModel.js.
// Verified: every preset and slider reproduces the v1 shapes within 0.09 mm.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.argv[2] || path.join(HERE, '.cache/makehuman/makehuman/data');
const OUT = path.join(HERE, '../web/public/assets');
const DM2M = 0.1; // MakeHuman units are decimeters

if (!fs.existsSync(path.join(DATA, '3dobjs/base.obj'))) {
  console.error(`MakeHuman data not found in ${DATA}. Run tools/fetch-makehuman.sh first.`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- OBJ parse
function parseOBJ(file) {
  const v = [], vt = [], faces = [];
  let group = '';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('v ')) { const p = line.split(/\s+/); v.push(+p[1], +p[2], +p[3]); }
    else if (line.startsWith('vt ')) { const p = line.split(/\s+/); vt.push(+p[1], +p[2]); }
    else if (line.startsWith('g ')) group = line.slice(2).trim();
    else if (line.startsWith('f ')) {
      const c = line.trim().split(/\s+/).slice(1).map(s => { const q = s.split('/'); return [(+q[0]) - 1, q[1] ? (+q[1]) - 1 : -1]; });
      faces.push({ group, c });
    }
  }
  return { v: new Float64Array(v), vt: new Float64Array(vt), faces };
}

const base = parseOBJ(path.join(DATA, '3dobjs/base.obj'));
const NV = base.v.length / 3;
console.log(`base.obj: ${NV} verts, ${base.faces.length} faces`);

const GROUPS = ['body', 'tights', 'skirt', 'hair', 'eyeL', 'eyeR', 'eyelashes', 'teethUpper', 'teethLower', 'tongue'];
function groupId(g) {
  if (g === 'body') return 0;
  if (g === 'helper-tights') return 1;
  if (g === 'helper-skirt') return 2;
  if (g === 'helper-hair') return 3;
  if (g === 'helper-l-eye') return 4;
  if (g === 'helper-r-eye') return 5;
  if (g.includes('eyelashes')) return 6;
  if (g === 'helper-upper-teeth') return 7;
  if (g === 'helper-lower-teeth') return 8;
  if (g === 'helper-tongue') return 9;
  return -1; // joint cubes, genital helper
}

// Render vertices: unique (meshVertex, uv) pairs, so UV seams are split.
const rvKey = new Map();
const rv2v = [], rvUV = [];
const faceV = [], faceRV = [], faceG = [];
for (const f of base.faces) {
  const gid = groupId(f.group);
  if (gid < 0) continue;
  if (f.c.length < 3 || f.c.length > 4) throw new Error('unexpected face size ' + f.c.length);
  const vv = [], rr = [];
  for (const [vi, ti] of f.c) {
    const key = vi * 65536 + (ti < 0 ? 65535 : ti);
    let r = rvKey.get(key);
    if (r === undefined) {
      r = rv2v.length; rvKey.set(key, r); rv2v.push(vi);
      rvUV.push(ti < 0 ? 0 : base.vt[ti * 2], ti < 0 ? 0 : base.vt[ti * 2 + 1]);
    }
    vv.push(vi); rr.push(r);
  }
  if (vv.length === 3) { vv.push(0xffff); rr.push(0xffff); }
  faceV.push(...vv); faceRV.push(...rr); faceG.push(gid);
}
console.log(`render verts: ${rv2v.length}, faces kept: ${faceG.length}`);
if (rv2v.length >= 65535) throw new Error('too many render verts for Uint16');

// Vertices the app uses: faces of every group except the MakeHuman proxy helpers
// (tights, skirt, hair: never drawn or read), skeleton joint vertices and the eye
// proxy anchors. Slider deltas skip the others (they keep the preset shape).
const NEEDED = (() => {
  const need = new Uint8Array(NV);
  const unused = new Set([1, 2, 3]);
  for (let f = 0; f < faceG.length; f++) {
    if (unused.has(faceG[f])) continue;
    for (let k = 0; k < 4; k++) { const v = faceV[f * 4 + k]; if (v !== 0xffff) need[v] = 1; }
  }
  const sk = JSON.parse(fs.readFileSync(path.join(DATA, 'rigs/default.mhskel'), 'utf8'));
  for (const list of Object.values(sk.joints)) for (const v of list) need[v] = 1;
  let inVerts = false;
  for (const raw of fs.readFileSync(path.join(DATA, 'eyes/high-poly/high-poly.mhclo'), 'utf8').split('\n')) {
    const p = raw.trim().split(/\s+/);
    if (p[0] === 'verts') { inVerts = true; continue; }
    if (!inVerts || !p[0] || p[0].startsWith('#')) continue;
    if (!/^\d/.test(p[0])) { inVerts = false; continue; }
    for (const s of p.length === 1 ? [p[0]] : p.slice(0, 3)) need[+s] = 1;
  }
  let n = 0; for (const x of need) n += x;
  console.log(`vertices used by the app: ${n} of ${NV}`);
  return need;
})();

// ---------------------------------------------------------------- targets
const targetCache = new Map();
function loadTarget(rel) {
  if (targetCache.has(rel)) return targetCache.get(rel);
  const file = path.join(DATA, 'targets', rel);
  if (!fs.existsSync(file)) throw new Error('missing target ' + rel);
  const idx = [], d = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    idx.push(+p[0]); d.push(+p[1], +p[2], +p[3]);
  }
  const t = { idx: Int32Array.from(idx), d: Float64Array.from(d) };
  targetCache.set(rel, t);
  return t;
}
function addTarget(pos, rel, w) {
  if (!w) return;
  const t = loadTarget(rel);
  for (let k = 0; k < t.idx.length; k++) {
    const i = t.idx[k] * 3;
    pos[i] += w * t.d[k * 3]; pos[i + 1] += w * t.d[k * 3 + 1]; pos[i + 2] += w * t.d[k * 3 + 2];
  }
}

// three-level weights (min / average / max) for a 0..1 macro value, 0.5 = average
function tri(x, names) {
  const [lo, mid, hi] = names; const o = {};
  if (x < 0.5) { o[lo] = (0.5 - x) / 0.5; o[mid] = x / 0.5; }
  else { o[mid] = (1 - x) / 0.5; o[hi] = (x - 0.5) / 0.5; }
  return o;
}
const MUSCLE = ['minmuscle', 'averagemuscle', 'maxmuscle'];
const WEIGHT = ['minweight', 'averageweight', 'maxweight'];

// Full shape evaluation (young adult). p: {gender, muscle, weight, height,
// proportions, cup, firmness, linear: {targetRel: weight}} -> Float64Array (dm)
function evalShape(p) {
  const pos = Float64Array.from(base.v);
  const genders = { female: 1 - p.gender, male: p.gender };
  const mus = tri(p.muscle, MUSCLE), wei = tri(p.weight, WEIGHT);
  const races = { caucasian: 1 / 3, african: 1 / 3, asian: 1 / 3 };
  for (const [g, gw] of Object.entries(genders)) {
    if (!gw) continue;
    for (const [r, rw] of Object.entries(races)) addTarget(pos, `macrodetails/${r}-${g}-young.target`, gw * rw);
    for (const [m, mw] of Object.entries(mus)) {
      if (!mw) continue;
      for (const [w, ww] of Object.entries(wei)) {
        if (!ww) continue;
        const k = gw * mw * ww;
        addTarget(pos, `macrodetails/universal-${g}-young-${m}-${w}.target`, k);
        if (p.height < 0.5) addTarget(pos, `macrodetails/height/${g}-young-${m}-${w}-minheight.target`, k * (0.5 - p.height) / 0.5);
        if (p.height > 0.5) addTarget(pos, `macrodetails/height/${g}-young-${m}-${w}-maxheight.target`, k * (p.height - 0.5) / 0.5);
        if (p.proportions < 0.5) addTarget(pos, `macrodetails/proportions/${g}-young-${m}-${w}-uncommonproportions.target`, k * (0.5 - p.proportions) / 0.5);
        if (p.proportions > 0.5) addTarget(pos, `macrodetails/proportions/${g}-young-${m}-${w}-idealproportions.target`, k * (p.proportions - 0.5) / 0.5);
        if (g === 'female') {
          const cups = tri(p.cup ?? 0.5, ['mincup', 'averagecup', 'maxcup']);
          const firms = tri(p.firmness ?? 0.5, ['minfirmness', 'averagefirmness', 'maxfirmness']);
          for (const [c, cw] of Object.entries(cups)) for (const [f, fw] of Object.entries(firms)) {
            if (!cw || !fw || (c === 'averagecup' && f === 'averagefirmness')) continue;
            addTarget(pos, `breast/female-young-${m}-${w}-${c}-${f}.target`, k * cw * fw);
          }
        }
      }
    }
  }
  for (const [rel, w] of Object.entries(p.linear || {})) addTarget(pos, rel, w);
  return pos;
}

// ---------------------------------------------------------------- presets
const PRESETS = [
  { id: 'f_slim', label: 'Magra', sex: 'F', p: { gender: 0, muscle: 0.5, weight: 0.02, height: 0.6, proportions: 0.8, cup: 0.3, firmness: 0.6, linear: { 'bodyshapes/bodyshapes-elvs-fem-lean-column.target': 0.5 } } },
  { id: 'f_normal', label: 'Normale', sex: 'F', p: { gender: 0, muscle: 0.56, weight: 0.42, height: 0.54, proportions: 0.72, cup: 0.55, firmness: 0.55, linear: { 'bodyshapes/bodyshapes-elvs-fem-neat-hourglass.target': 0.35, 'stomach/stomach-tone-incr.target': 0.25 } } },
  { id: 'f_curvy', label: 'Curvy', sex: 'F', p: { gender: 0, muscle: 0.5, weight: 0.88, height: 0.52, proportions: 0.62, cup: 0.95, firmness: 0.45, linear: { 'bodyshapes/bodyshapes-elvs-fem-full-hourglass.target': 1.0, 'buttocks/buttocks-volume-incr.target': 0.7, 'hip/hip-scale-horiz-incr.target': 0.4, 'measure/measure-waist-circ-decr.target': 0.35 } } },
  { id: 'm_slim', label: 'Magro', sex: 'M', p: { gender: 1, muscle: 0.45, weight: 0.0, height: 0.6, proportions: 0.78, linear: { 'bodyshapes/bodyshapes-elvs-man-lean-column.target': 0.5 } } },
  { id: 'm_normal', label: 'Normale', sex: 'M', p: { gender: 1, muscle: 0.72, weight: 0.42, height: 0.57, proportions: 0.78, linear: { 'bodyshapes/bodyshapes-elvs-man-invert-triangle.target': 0.35, 'stomach/stomach-tone-incr.target': 0.35, 'torso/torso-muscle-pectoral-incr.target': 0.2 } } },
  { id: 'm_curvy', label: 'Robusto', sex: 'M', p: { gender: 1, muscle: 0.55, weight: 0.98, height: 0.52, proportions: 0.55, linear: { 'bodyshapes/bodyshapes-elvs-man-apple.target': 0.5 } } },
];

// Sliders. kind 'macro' -> per-preset deltas evaluated by perturbing a macro
// parameter; kind 'target' -> global sparse deltas from incr/decr targets.
const SLIDERS = [
  { id: 'height', label: 'Altezza', kind: 'macro', param: 'height', range: 0.42 },
  { id: 'weight', label: 'Peso', kind: 'macro', param: 'weight', range: 0.35 },
  { id: 'muscle', label: 'Muscoli', kind: 'macro', param: 'muscle', range: 0.45 },
  { id: 'proportions', label: 'Proporzioni eroiche', kind: 'macro', param: 'proportions', range: 0.5 },
  { id: 'breast', label: 'Seno', kind: 'macro', param: 'cup', range: 0.45, sex: 'F' },
  { id: 'shoulders', label: 'Spalle', kind: 'target', pos: ['measure/measure-shoulder-dist-incr.target'], neg: ['measure/measure-shoulder-dist-decr.target'] },
  { id: 'vshape', label: 'Torso a V', kind: 'target', pos: ['torso/torso-vshape-incr.target'], neg: ['torso/torso-vshape-decr.target'] },
  { id: 'waist', label: 'Vita', kind: 'target', pos: ['measure/measure-waist-circ-incr.target'], neg: ['measure/measure-waist-circ-decr.target'] },
  { id: 'hips', label: 'Fianchi', kind: 'target', pos: ['hip/hip-scale-horiz-incr.target'], neg: ['hip/hip-scale-horiz-decr.target'] },
  { id: 'glutes', label: 'Glutei', kind: 'target', pos: ['buttocks/buttocks-volume-incr.target'], neg: ['buttocks/buttocks-volume-decr.target'] },
  { id: 'legs', label: 'Gambe lunghe', kind: 'target', pos: ['measure/measure-upperleg-height-incr.target', 'measure/measure-lowerleg-height-incr.target'], neg: ['measure/measure-upperleg-height-decr.target', 'measure/measure-lowerleg-height-decr.target'] },
  { id: 'head', label: 'Testa', kind: 'target', pos: ['head/head-scale-depth-incr.target', 'head/head-scale-horiz-incr.target', 'head/head-scale-vert-incr.target'], neg: ['head/head-scale-depth-decr.target', 'head/head-scale-horiz-decr.target', 'head/head-scale-vert-decr.target'] },
  { id: 'neck', label: 'Collo', kind: 'target', pos: ['neck/neck-scale-vert-incr.target'], neg: ['neck/neck-scale-vert-decr.target'] },
];

// ---------------------------------------------------------------- binary writer
const chunks = []; let offset = 0;
function emit(arr) {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  const ref = { type: arr.constructor.name, offset, length: arr.length };
  chunks.push(Buffer.from(buf)); offset += buf.byteLength;
  return ref;
}
const Q = 1e4; // sparse delta quantization: 0.1 mm
function sparseOf(deltaDm, mask = null) {
  const idx = [], val = [];
  for (let i = 0; i < NV; i++) {
    if (mask && !mask[i]) continue;
    const x = deltaDm[i * 3] * DM2M, y = deltaDm[i * 3 + 1] * DM2M, z = deltaDm[i * 3 + 2] * DM2M;
    if (Math.abs(x) < 5e-5 && Math.abs(y) < 5e-5 && Math.abs(z) < 5e-5) continue;
    idx.push(i); val.push(Math.round(x * Q), Math.round(y * Q), Math.round(z * Q));
  }
  for (const q of val) if (Math.abs(q) > 32767) throw new Error('delta overflow');
  return { idx, val };
}
/** Plain typed arrays (Uint16 idx + Int16 xyz): expression units, read and patched by the face module. */
function emitSparse(deltaDm) {
  const { idx, val } = sparseOf(deltaDm);
  return { idx: emit(Uint16Array.from(idx)), val: emit(Int16Array.from(val)), count: idx.length };
}

// Compact varint streams (format v2), decoded by HumanModel on first use:
//   idx: gap to the previous index - 1, LEB128 (dense runs cost 1 byte per vertex)
//   val: per component, difference to the previous entry's value (neighbouring
//        vertices move alike), zigzag + LEB128. Lossless for the 0.1 mm grid.
function varints(out, ints) {
  for (const x of ints) {
    let z = x >= 0 ? x * 2 : -x * 2 - 1;
    while (z >= 128) { out.push(0x80 | (z & 127)); z = Math.floor(z / 128); }
    out.push(z);
  }
}
function encodeStream(idx, val) {
  const bytes = [];
  if (idx) { let prev = -1; varints(bytes, idx.map((i) => { const g = i - prev - 1; prev = i; return g; })); }
  const idxBytes = bytes.length;
  const d = new Array(val.length);
  for (let k = 0; k < val.length; k++) d[k] = val[k] - (k >= 3 ? val[k - 3] : 0);
  varints(bytes, d);
  return { enc: emit(Uint8Array.from(bytes)), idxBytes };
}
/** Slider delta as a compact stream; vertices outside `mask` are left out. */
function emitSparseV2(deltaDm, mask) {
  const { idx, val } = sparseOf(deltaDm, mask);
  return { ...encodeStream(idx, val), count: idx.length };
}
function diff(a, b) { const d = new Float64Array(a.length); for (let i = 0; i < a.length; i++) d[i] = a[i] - b[i]; return d; }
const toM = a => Float32Array.from(a, x => x * DM2M);

const meta = {
  version: 2,
  units: 'meters',
  source: 'MakeHuman hm08 base mesh, targets, default skeleton & weights (CC0 1.0) — makehumancommunity.org',
  vertexCount: NV,
  groups: GROUPS,
  quantization: 1 / Q,
};

const basePosM = toM(base.v);
meta.topology = {
  faceV: emit(Uint16Array.from(faceV)),
  faceRV: emit(Uint16Array.from(faceRV)),
  faceGroup: emit(Uint8Array.from(faceG)),
  rv2v: emit(Uint16Array.from(rv2v)),
  // UVs are in [0, 1]: 16-bit normalized (1/65535 = 0.016 px on a 1024 map)
  rvUV: { ...emit(Uint16Array.from(rvUV, (u) => Math.round(Math.min(1, Math.max(0, u)) * 65535))), normalized: true },
  basePositions: emit(basePosM),
};

// presets (positions as 0.1 mm steps from the base mesh) + macro slider deltas
meta.presets = [];
for (const pr of PRESETS) {
  const pos = evalShape(pr.p);
  const q = new Array(NV * 3);
  for (let i = 0; i < NV * 3; i++) {
    q[i] = Math.round((pos[i] * DM2M - basePosM[i]) * Q);
    if (Math.abs(q[i]) > 32767) throw new Error('preset offset overflow');
  }
  const entry = { id: pr.id, label: pr.label, sex: pr.sex, params: pr.p, positions: { ...encodeStream(null, q), count: NV, fromBase: true }, deltas: {} };
  for (const s of SLIDERS.filter(s => s.kind === 'macro')) {
    if (s.sex && s.sex !== pr.sex) continue;
    const v0 = pr.p[s.param] ?? 0.5;
    const up = Math.min(1, v0 + s.range), dn = Math.max(0, v0 - s.range);
    const pu = evalShape({ ...pr.p, [s.param]: up });
    const pd = evalShape({ ...pr.p, [s.param]: dn });
    entry.deltas[s.id] = { pos: emitSparseV2(diff(pu, pos), NEEDED), neg: emitSparseV2(diff(pd, pos), NEEDED) };
  }
  meta.presets.push(entry);
  console.log(`preset ${pr.id} done`);
}
meta.sliders = SLIDERS.map(s => ({ id: s.id, label: s.label, kind: s.kind, sex: s.sex || null }));
meta.targetDeltas = {};
for (const s of SLIDERS.filter(s => s.kind === 'target')) {
  const sum = list => { const d = new Float64Array(NV * 3); for (const rel of list) addTarget(d, rel, 1); return d; };
  meta.targetDeltas[s.id] = { pos: emitSparseV2(sum(s.pos), NEEDED), neg: emitSparseV2(sum(s.neg), NEEDED) };
}

// expression units (morph based facial expressions)
const EXP_DIR = path.join(DATA, 'targets/expression/units/caucasian');
meta.expressions = {};
for (const f of fs.readdirSync(EXP_DIR).filter(f => f.endsWith('.target')).sort()) {
  const d = new Float64Array(NV * 3); addTarget(d, `expression/units/caucasian/${f}`, 1);
  meta.expressions[f.replace('.target', '')] = emitSparse(d);
}
console.log('expressions:', Object.keys(meta.expressions).length);

// ---------------------------------------------------------------- skeleton
const skel = JSON.parse(fs.readFileSync(path.join(DATA, 'rigs/default.mhskel'), 'utf8'));
const wfile = JSON.parse(fs.readFileSync(path.join(DATA, 'rigs/default_weights.mhw'), 'utf8'));
const SIDE = ['L', 'R'];
const KEEP = new Set(['root', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01', 'neck01', 'neck02', 'neck03', 'head']);
for (const s of SIDE) {
  for (const b of ['clavicle', 'shoulder01', 'upperarm01', 'upperarm02', 'lowerarm01', 'lowerarm02', 'wrist',
    'metacarpal1', 'metacarpal2', 'metacarpal3', 'metacarpal4', 'pelvis', 'upperleg01', 'upperleg02', 'lowerleg01', 'lowerleg02', 'foot', 'eye',
    'toe1-1', 'toe2-1', 'toe3-1', 'toe4-1', 'toe5-1']) KEEP.add(`${b}.${s}`);
  for (let f = 1; f <= 5; f++) for (let j = 1; j <= 3; j++) KEEP.add(`finger${f}-${j}.${s}`);
}
for (const k of KEEP) if (!skel.bones[k]) throw new Error('missing bone ' + k);
function keptAncestor(name) {
  let n = name;
  while (n && !KEEP.has(n)) n = skel.bones[n].parent;
  if (!n) throw new Error('no kept ancestor for ' + name);
  return n;
}
// Eyes: weights go to head (eye bones only drive the eyeball meshes).
function weightTarget(name) {
  const k = keptAncestor(name);
  return k.startsWith('eye.') ? 'head' : k;
}
// order bones parent-first
const boneNames = [];
const visit = n => { boneNames.push(n); for (const [c, b] of Object.entries(skel.bones)) if (KEEP.has(c) && keptAncestor(b.parent || c) === n && c !== n && b.parent) { if (!boneNames.includes(c)) visit(c); } };
visit('root');
if (boneNames.length !== KEEP.size) throw new Error(`bone ordering mismatch ${boneNames.length} vs ${KEEP.size}`);
const boneIndex = new Map(boneNames.map((n, i) => [n, i]));
meta.bones = boneNames.map(n => {
  const b = skel.bones[n];
  return { name: n, parent: n === 'root' ? -1 : boneIndex.get(keptAncestor(b.parent)), head: b.head, tail: b.tail, plane: skel.planes[`${n}____plane`] };
});
// joints referenced by kept bones (head/tail/plane)
const usedJoints = new Set();
for (const b of meta.bones) { usedJoints.add(b.head); usedJoints.add(b.tail); for (const j of b.plane || []) usedJoints.add(j); }
const jointNames = [...usedJoints].sort();
const jIdx = [], jOff = [0];
for (const j of jointNames) { const list = skel.joints[j]; if (!list) throw new Error('missing joint ' + j); jIdx.push(...list); jOff.push(jIdx.length); }
meta.joints = { names: jointNames, indices: emit(Uint16Array.from(jIdx)), offsets: emit(Uint32Array.from(jOff)) };

// weights: merge into kept bones, top-4, normalized
const perV = Array.from({ length: NV }, () => new Map());
for (const [bn, list] of Object.entries(wfile.weights)) {
  const t = boneIndex.get(weightTarget(bn));
  for (const [vi, w] of list) perV[vi].set(t, (perV[vi].get(t) || 0) + w);
}
smoothSkinWeights(perV);
const skinIndex = new Uint8Array(NV * 4), skinWeight = new Float32Array(NV * 4);
let unweighted = 0;
for (let i = 0; i < NV; i++) {
  const e = [...perV[i].entries()].sort((a, b) => b[1] - a[1]).filter((x, k) => k === 0 || x[1] >= 0.004).slice(0, 4);
  const sum = e.reduce((s, x) => s + x[1], 0);
  if (!sum) { unweighted++; skinIndex[i * 4] = boneIndex.get('spine05'); skinWeight[i * 4] = 1; continue; }
  e.forEach(([b, w], k) => { skinIndex[i * 4 + k] = b; skinWeight[i * 4 + k] = w / sum; });
}
console.log(`bones kept: ${boneNames.length}, unweighted verts: ${unweighted}`);
// weights as 16-bit fractions (renormalized to sum 1 when loaded)
meta.skin = { index: emit(skinIndex), weight: { ...emit(Uint16Array.from(skinWeight, (w) => Math.round(w * 65535))), normalized: true } };

// ---------------------------------------------------------------- soft joints (weight smoothing)
// MakeHuman's default weights switch from one bone to the next over a few cm,
// which bends elbows, knees, shoulders and hips like hinges (a pinched crease
// on the inside, a flattened corner outside). Here the weights are diffused
// over the body surface (graph Laplacian = geodesic smoothing) inside a soft
// region around each joint, widest on the inner side of a bend. Fingers, toes
// and the face are locked; weights never cross the body midline to the other
// side's bones. The result is renormalized; skinning still uses 4 influences.
function smoothSkinWeights(perV) {
  const NB = boneNames.length, P = base.v, M = 0.1; // base mesh dm -> m
  const jp = (name) => { const l = skel.joints[name]; const p = [0, 0, 0]; for (const v of l) { p[0] += P[v * 3] * M; p[1] += P[v * 3 + 1] * M; p[2] += P[v * 3 + 2] * M; } return p.map((x) => x / l.length); };
  const head = (b) => jp(skel.bones[b].head);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const nrm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // dense weights for body vertices
  const isBody = new Uint8Array(NV);
  for (let f = 0; f < faceG.length; f++) if (faceG[f] === 0) for (let k = 0; k < 4; k++) { const v = faceV[f * 4 + k]; if (v !== 0xffff) isBody[v] = 1; }
  const W = new Float32Array(NV * NB);
  for (let v = 0; v < NV; v++) {
    if (!isBody[v]) continue;
    let s = 0; for (const w of perV[v].values()) s += w;
    for (const [b, w] of perV[v]) W[v * NB + b] = w / (s || 1);
  }
  // adjacency (quad / triangle edges of the body)
  const nb = Array.from({ length: NV }, () => new Set());
  for (let f = 0; f < faceG.length; f++) {
    if (faceG[f] !== 0) continue;
    const q = [0, 1, 2, 3].map((k) => faceV[f * 4 + k]).filter((v) => v !== 0xffff);
    for (let k = 0; k < q.length; k++) { const a = q[k], b = q[(k + 1) % q.length]; nb[a].add(b); nb[b].add(a); }
  }
  // locks: fingers, toes, face (head-dominant) keep their weights exactly
  const idxOf = (re) => boneNames.map((n, i) => (re.test(n) ? i : -1)).filter((i) => i >= 0);
  const fingers = idxOf(/^(finger|toe)/), headB = boneIndex.get('head');
  const locked = new Uint8Array(NV);
  for (let v = 0; v < NV; v++) {
    if (!isBody[v]) { locked[v] = 1; continue; }
    let fw = 0; for (const b of fingers) fw += W[v * NB + b];
    if (fw > 0.02 || W[v * NB + headB] > 0.985) locked[v] = 1;
  }
  // regions: [joint bone, radius m, strength, inner-bend direction (unit, optional), inner boost]
  const regions = [];
  for (const s of SIDE) {
    const sh = head(`upperarm01.${s}`), el = head(`lowerarm01.${s}`), wr = head(`wrist.${s}`);
    const ua = nrm(sub(el, sh)), fa = nrm(sub(wr, el));
    const elbowIn = nrm(sub(fa, ua.map((x) => x * dot(fa, ua)))); // where the forearm folds to (anterior)
    regions.push([`lowerarm01.${s}`, 0.085, 0.75, elbowIn, 0.55]);
    regions.push([`lowerarm02.${s}`, 0.10, 0.45]);
    regions.push([`upperarm02.${s}`, 0.10, 0.4]);
    regions.push([`upperarm01.${s}`, 0.115, 0.7, [0, -1, 0], 0.35]); // armpit side smoother than the deltoid cap
    regions.push([`shoulder01.${s}`, 0.075, 0.5]);
    regions.push([`clavicle.${s}`, 0.06, 0.3]);
    regions.push([`wrist.${s}`, 0.045, 0.45]);
    regions.push([`upperleg01.${s}`, 0.14, 0.6, [0, -0.2, 1], 0.3]); // groin crease side
    regions.push([`upperleg02.${s}`, 0.12, 0.4]);
    regions.push([`lowerleg01.${s}`, 0.10, 0.75, [0, 0, -1], 0.5]); // back of the knee
    regions.push([`lowerleg02.${s}`, 0.11, 0.4]);
    regions.push([`foot.${s}`, 0.06, 0.4]);
  }
  for (const b of ['spine04', 'spine03', 'spine02', 'spine01']) regions.push([b, 0.12, 0.5]);
  regions.push(['neck01', 0.07, 0.5], ['neck02', 0.06, 0.45], ['head', 0.065, 0.45]);
  const R = regions.map(([b, r, st, dir, boost]) => ({ c: head(b), r, st, dir, boost: boost || 0 }));
  const S = new Float32Array(NV);
  for (let v = 0; v < NV; v++) {
    if (locked[v]) continue;
    const p = [P[v * 3] * M, P[v * 3 + 1] * M, P[v * 3 + 2] * M];
    let s = 0;
    for (const g of R) {
      const d = sub(p, g.c), dl = Math.hypot(...d);
      if (dl >= g.r) continue;
      const t = 1 - dl / g.r;
      let k = g.st * t * t * (3 - 2 * t);
      // inner side of a bend: wider blend (round fold); outer side: tighter (bony corner)
      if (g.dir) k *= 1 - g.boost + g.boost * 2 * Math.max(0, Math.min(1, 0.5 + 0.5 * dot(d, g.dir) / (dl || 1)));
      s = Math.max(s, k);
    }
    S[v] = Math.min(0.9, s);
  }
  // side of each bone (+1 left, -1 right, 0 center)
  const side = boneNames.map((n) => (n.endsWith('.L') ? 1 : n.endsWith('.R') ? -1 : 0));
  const active = []; for (let v = 0; v < NV; v++) if (S[v] > 0.001) active.push(v);
  const tmp = new Float32Array(NB);
  let A = Float32Array.from(W), B = Float32Array.from(W);
  const ITER = 36;
  for (let it = 0; it < ITER; it++) {
    for (const v of active) {
      tmp.fill(0);
      let n = 0;
      for (const u of nb[v]) { n++; const o = u * NB; for (let b = 0; b < NB; b++) tmp[b] += A[o + b]; }
      const s = S[v], o = v * NB, x = P[v * 3] * M;
      let sum = 0;
      for (let b = 0; b < NB; b++) {
        let w = (1 - s) * A[o + b] + (n ? s * tmp[b] / n : 0);
        if ((side[b] > 0 && x < -0.008) || (side[b] < 0 && x > 0.008)) w = 0; // never across the midline
        B[o + b] = w; sum += w;
      }
      if (sum > 0) for (let b = 0; b < NB; b++) B[o + b] /= sum;
    }
    [A, B] = [B, A];
  }
  let changed = 0, maxD = 0;
  for (const v of active) {
    const m = new Map();
    let d = 0;
    for (let b = 0; b < NB; b++) { const w = A[v * NB + b]; if (w > 1e-4) m.set(b, w); d = Math.max(d, Math.abs(w - W[v * NB + b])); }
    if (d > 0.01) changed++;
    maxD = Math.max(maxD, d);
    perV[v] = m;
  }
  console.log(`soft joints: ${active.length} vertices smoothed, ${changed} changed by > 1% (max ${maxD.toFixed(2)})`);
}

// ---------------------------------------------------------------- pose correctives
// Pose-space corrective shapes, applied on the CPU by Character to its rest
// positions as functions of joint angles (see Character.flushCorrectives): biceps
// bulge, inner-elbow volume and olecranon when the elbow flexes; kneecap and
// back-of-knee volume when the knee bends; deltoid / trapezius bunching when the
// arm is raised; gluteal and groin volume at hip flexion. Each corrective is a
// sparse list of body vertices with a signed weight (Int8, x amp meters) along the
// rest normal, generated from the geometry: limb frames from the skeleton
// joints, angular masks around the limb axis, gated by the skin weights and
// smoothed over the surface. Drivers:
//   flexX  rotation of the bone about its rest X axis (hinge), degrees * sign
//   raise  elevation of the bone's Y axis from the torso's down axis, minus rest
{
  const P = toM(evalShape({ gender: 0.5, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.6 }));
  const isBody = new Uint8Array(NV);
  const bodyF = [];
  for (let f = 0; f < faceG.length; f++) if (faceG[f] === 0) { bodyF.push(f); for (let k = 0; k < 4; k++) { const v = faceV[f * 4 + k]; if (v !== 0xffff) isBody[v] = 1; } }
  const N = new Float32Array(NV * 3);
  for (const f of bodyF) {
    const q = [0, 1, 2, 3].map((k) => faceV[f * 4 + k]).filter((v) => v !== 0xffff);
    const [a, b, c] = q;
    const u = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), w = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const v of q) for (let k = 0; k < 3; k++) N[v * 3 + k] += n[k];
  }
  for (let v = 0; v < NV; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; for (let k = 0; k < 3; k++) N[v * 3 + k] /= l; }
  const nbrs = Array.from({ length: NV }, () => new Set());
  for (const f of bodyF) {
    const q = [0, 1, 2, 3].map((k) => faceV[f * 4 + k]).filter((v) => v !== 0xffff);
    for (let k = 0; k < q.length; k++) { const a = q[k], b = q[(k + 1) % q.length]; nbrs[a].add(b); nbrs[b].add(a); }
  }
  const jp = (name) => { const l = skel.joints[name]; const p = [0, 0, 0]; for (const v of l) for (let k = 0; k < 3; k++) p[k] += P[v * 3 + k]; return p.map((x) => x / l.length); };
  const head = (b) => jp(skel.bones[b].head);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const nrm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const perp = (a, u) => nrm(sub(a, u.map((x) => x * dot(a, u))));
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const bump = (t, a, pk, b) => (t < pk ? sstep(a, pk, t) : 1 - sstep(pk, b, t));
  const boneSum = (v, names) => { let s = 0; for (let k = 0; k < 4; k++) if (names.has(boneNames[skinIndex[v * 4 + k]])) s += skinWeight[v * 4 + k]; return s; };
  /**
   * Mask over a limb segment A->B: t along it (0..1), angular falloff around
   * `dir` (unit, perpendicular to the segment), gated by the listed bones.
   */
  const limbMask = ({ A, B, t: [t0, tp, t1], dir, cmin, bones, gate = 1.5 }) => {
    const u = nrm(sub(B, A)), L = Math.hypot(...sub(B, A)), m = new Float32Array(NV), set = new Set(bones);
    for (let v = 0; v < NV; v++) {
      if (!isBody[v]) continue;
      const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], d = sub(p, A), t = dot(d, u) / L;
      if (t < t0 || t > t1) continue;
      const r = perp(d, u), c = dir ? dot(r, dir) : 1;
      const g = Math.min(1, boneSum(v, set) * gate);
      if (!g) continue;
      m[v] = bump(t, t0, tp, t1) * (dir ? sstep(cmin, 1, c) : 1) * g;
    }
    return m;
  };
  /** Mask around a point, on the side whose normals face `dir`. */
  const blobMask = ({ C, r, dir, cmin, bones, gate = 1.5 }) => {
    const m = new Float32Array(NV), set = bones ? new Set(bones) : null;
    for (let v = 0; v < NV; v++) {
      if (!isBody[v]) continue;
      const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], dl = Math.hypot(...sub(p, C));
      if (dl > r) continue;
      const n = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
      const g = set ? Math.min(1, boneSum(v, set) * gate) : 1;
      m[v] = (1 - sstep(0.35 * r, r, dl)) * (dir ? sstep(cmin, 1, dot(n, dir)) : 1) * g;
    }
    return m;
  };
  const smoothM = (m, it) => {
    let a = m, b = new Float32Array(NV);
    for (let k = 0; k < it; k++) {
      for (let v = 0; v < NV; v++) { if (!isBody[v] || !nbrs[v].size) { b[v] = a[v]; continue; } let s = 0; for (const u of nbrs[v]) s += a[u]; b[v] = 0.5 * a[v] + 0.5 * s / nbrs[v].size; }
      [a, b] = [b, a];
    }
    return a;
  };
  const combine = (parts) => { const m = new Float32Array(NV); for (const [w, mk] of parts) for (let v = 0; v < NV; v++) m[v] += w * mk[v]; return m; };
  const list = [];
  const push = (id, side, driver, amp, mask) => {
    const sm = smoothM(mask, 3);
    let mx = 0; for (let v = 0; v < NV; v++) mx = Math.max(mx, Math.abs(sm[v]));
    const idx = [], w = [];
    for (let v = 0; v < NV; v++) { const q = Math.round((sm[v] / (mx || 1)) * 127); if (q) { idx.push(v); w.push(q); } }
    list.push({ id, side, driver, amp: +(amp * mx).toFixed(5), idx: emit(Uint16Array.from(idx)), w: emit(Int8Array.from(w)), count: idx.length });
  };
  for (const s of SIDE) {
    const sg = s === 'L' ? 1 : -1;
    const sh = head(`upperarm01.${s}`), el = head(`lowerarm01.${s}`), wr = head(`wrist.${s}`);
    const ua = nrm(sub(el, sh)), fa = nrm(sub(wr, el));
    const ant = perp(fa, ua); // where the forearm folds to: the biceps side of the upper arm
    const antF = perp(ua.map((x) => -x), fa); // the flexor side of the forearm (faces the upper arm when bent)
    const UA = [`upperarm01.${s}`, `upperarm02.${s}`], FA = [`lowerarm01.${s}`, `lowerarm02.${s}`];
    // elbow flexion: biceps peak + brachialis, flexor mass, inner fold volume, olecranon; triceps lengthens
    push(`elbow.${s}`, s, { type: 'flexX', bone: `lowerarm01.${s}`, sign: -1, from: 4, to: 95 }, 0.013, combine([
      [1.0, limbMask({ A: sh, B: el, t: [0.3, 0.68, 1.02], dir: ant, cmin: -0.15, bones: UA })],
      [0.45, limbMask({ A: el, B: wr, t: [-0.02, 0.2, 0.5], dir: antF, cmin: -0.3, bones: FA })],
      [0.35, blobMask({ C: el, r: 0.06, dir: ant, cmin: 0.1 })],
      [0.4, blobMask({ C: el.map((x, k) => x - ant[k] * 0.02 - ua[k] * 0.01), r: 0.035, dir: ant.map((x) => -x), cmin: 0.3, bones: [...UA, ...FA] })],
      [-0.3, limbMask({ A: sh, B: el, t: [0.25, 0.6, 0.95], dir: ant.map((x) => -x), cmin: 0.2, bones: UA })],
    ]));
    // knee flexion: kneecap stays prominent, back of the knee keeps its volume (calf / hamstrings)
    const hp = head(`upperleg01.${s}`), kn = head(`lowerleg01.${s}`), an = head(`foot.${s}`);
    const th = nrm(sub(kn, hp)), sn = nrm(sub(an, kn));
    const front = perp([0, 0, 1], th), back = front.map((x) => -x);
    const UL = [`upperleg01.${s}`, `upperleg02.${s}`], LL = [`lowerleg01.${s}`, `lowerleg02.${s}`];
    push(`knee.${s}`, s, { type: 'flexX', bone: `lowerleg01.${s}`, sign: -1, from: 4, to: 115 }, 0.010, combine([
      [1.0, blobMask({ C: kn.map((x, k) => x + front[k] * 0.03 + th[k] * 0.012), r: 0.06, dir: front, cmin: 0.2 })],
      [0.8, blobMask({ C: kn.map((x, k) => x + back[k] * 0.025), r: 0.08, dir: back, cmin: 0.0 })],
      [0.6, limbMask({ A: kn, B: an, t: [0.02, 0.22, 0.5], dir: perp(back, sn), cmin: -0.2, bones: LL })],
      [0.4, limbMask({ A: hp, B: kn, t: [0.55, 0.85, 1.05], dir: perp(back, th), cmin: 0.0, bones: UL })],
    ]));
    // arm raised: deltoid bunches over the shoulder, upper trapezius rises
    const cl = head(`clavicle.${s}`), sp = head(`shoulder01.${s}`);
    const up = [0, 1, 0], out = [sg, 0, 0];
    push(`shoulder.${s}`, s, { type: 'raise', bone: `upperarm01.${s}`, from: 8, to: 105 }, 0.011, combine([
      [1.0, blobMask({ C: sh.map((x, k) => x + up[k] * 0.025 + out[k] * 0.01), r: 0.085, dir: nrm([sg * 0.6, 0.8, 0]), cmin: -0.1, bones: [...UA, `shoulder01.${s}`, `clavicle.${s}`] })],
      [0.5, limbMask({ A: sh, B: el, t: [-0.05, 0.18, 0.5], dir: perp(up, ua), cmin: -0.2, bones: UA })],
      [0.45, blobMask({ C: cl.map((x, k) => (x + sp[k]) / 2 + up[k] * 0.03), r: 0.07, dir: up, cmin: 0.2, bones: [`clavicle.${s}`, `shoulder01.${s}`, 'neck01', 'spine01'] })],
    ]));
    // hip flexion: buttock keeps its round volume, groin fold keeps out of the belly
    const pel = [`pelvis.${s}`, ...UL, 'root', 'spine05'];
    push(`hip.${s}`, s, { type: 'flexX', bone: `upperleg01.${s}`, sign: 1, from: 6, to: 100 }, 0.013, combine([
      [1.0, blobMask({ C: hp.map((x, k) => x + [0, -0.05, -0.07][k] + out[k] * 0.01), r: 0.12, dir: [0, -0.25, -1].map((x) => x / Math.hypot(0.25, 1)), cmin: 0.1, bones: pel })],
      [0.35, blobMask({ C: hp.map((x, k) => x + [0, -0.01, 0.06][k]), r: 0.07, dir: nrm([0, 0.3, 1]), cmin: 0.2, bones: pel })],
    ]));
  }
  // reference upper-arm length of the shape the masks were built on (amplitudes scale with body size)
  meta.correctives = { version: 1, list, refArm: +Math.hypot(...sub(head('lowerarm01.L'), head('upperarm01.L'))).toFixed(4) };
  console.log(`correctives: ${list.map((c) => `${c.id}:${c.count}`).join(' ')}`);
}

// ---------------------------------------------------------------- eyes proxy
{
  const eyeDir = path.join(DATA, 'eyes/high-poly');
  const obj = parseOBJ(path.join(eyeDir, 'high-poly.obj'));
  const lines = fs.readFileSync(path.join(eyeDir, 'high-poly.mhclo'), 'utf8').split('\n');
  const scales = {};
  const refs = [], wts = [], offs = [];
  let inVerts = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = line.split(/\s+/);
    if (/^[xyz]_scale$/.test(p[0])) { scales[p[0][0]] = [+p[1], +p[2], +p[3]]; continue; }
    if (p[0] === 'verts') { inVerts = true; continue; }
    if (inVerts) {
      if (!/^\d/.test(p[0])) { inVerts = false; continue; }
      if (p.length === 1) { refs.push(+p[0], +p[0], +p[0]); wts.push(1, 0, 0); offs.push(0, 0, 0); }
      else { refs.push(+p[0], +p[1], +p[2]); wts.push(+p[3], +p[4], +p[5]); offs.push(+p[6] * DM2M, +p[7] * DM2M, +p[8] * DM2M); }
    }
  }
  const nEye = obj.v.length / 3;
  if (refs.length / 3 !== nEye) throw new Error(`eye mhclo verts ${refs.length / 3} != obj verts ${nEye}`);
  // render verts for eye
  const key = new Map(), e2v = [], eUV = [], eIdx = [];
  for (const f of obj.faces) {
    const rr = f.c.map(([vi, ti]) => {
      const k = vi * 65536 + ti; let r = key.get(k);
      if (r === undefined) { r = e2v.length; key.set(k, r); e2v.push(vi); eUV.push(obj.vt[ti * 2], obj.vt[ti * 2 + 1]); }
      return r;
    });
    for (let k = 1; k + 1 < rr.length; k++) eIdx.push(rr[0], rr[k], rr[k + 1]);
  }
  // which eye each proxy vertex belongs to (by x of rest fit on base mesh)
  const side = new Uint8Array(nEye);
  for (let i = 0; i < nEye; i++) side[i] = obj.v[i * 3] > 0 ? 0 : 1; // +x = character left
  meta.eyes = {
    scales: { x: [scales.x[0], scales.x[1], scales.x[2] * DM2M], y: [scales.y[0], scales.y[1], scales.y[2] * DM2M], z: [scales.z[0], scales.z[1], scales.z[2] * DM2M] },
    refs: emit(Uint16Array.from(refs)), weights: emit(Float32Array.from(wts)), offsets: emit(Float32Array.from(offs)),
    side: emit(side), rv2v: emit(Uint16Array.from(e2v)), uv: emit(Float32Array.from(eUV)), index: emit(Uint16Array.from(eIdx)),
  };
  writeEyeTexture(path.join(DATA, 'eyes/materials/brown_eye.png'), path.join(OUT, 'eye.png'), 256);
  console.log(`eyes: ${nEye} verts, ${eIdx.length / 3} tris`);
}

// ---------------------------------------------------------------- write
const bin = Buffer.concat(chunks);
fs.writeFileSync(path.join(OUT, 'human.bin'), bin);
fs.writeFileSync(path.join(OUT, 'human.json'), JSON.stringify(meta));
console.log(`human.bin ${(bin.length / 1e6).toFixed(2)} MB, human.json ${(JSON.stringify(meta).length / 1e3).toFixed(1)} KB`);

// ---------------------------------------------------------------- skin detail texture
// A near-white multiplicative albedo map (multiplied by the chosen skin color):
// lips, nails, lighter palms/soles, slight redness on ears/nose/knees/elbows and
// low-frequency mottling. Masks are computed per vertex in 3D, then rasterized
// in UV space. Written to skin.png (sRGB).
import zlib from 'node:zlib';
{
  const SIZE = 1024;
  const P = toM(evalShape(PRESETS[1].p)); // neutral-ish female, meters, MH centered
  const nv = NV;
  // per-vertex masks
  const lip = new Float32Array(nv), nail = new Float32Array(nv), palm = new Float32Array(nv), red = new Float32Array(nv);
  const mag = (rel) => { const d = new Float64Array(nv * 3); addTarget(d, rel, 1); const m = new Float32Array(nv); let mx = 0; for (let i = 0; i < nv; i++) { m[i] = Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]); mx = Math.max(mx, m[i]); } for (let i = 0; i < nv; i++) m[i] /= mx || 1; return m; };
  const ever = mag('expression/units/caucasian/mouth-eversion.target');
  const prot = mag('expression/units/caucasian/mouth-protusion.target');
  for (let i = 0; i < nv; i++) lip[i] = Math.min(1, Math.max(0, (Math.max(ever[i] * 1.25, prot[i] * 0.95) - 0.38) / 0.35));
  // vertex normals of the neutral shape (body faces)
  const N = new Float32Array(nv * 3);
  for (let f = 0; f < faceG.length; f++) {
    if (faceG[f] !== 0) continue;
    const q = faceV.slice(f * 4, f * 4 + 4).filter((v) => v !== 0xffff);
    const [a, b, c] = q;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of q) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; }
  }
  for (let i = 0; i < nv; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }
  // joints from the skeleton definition (mean of joint vertices)
  const jpos = (name) => { const l = skel.joints[name]; const p = [0, 0, 0]; for (const v of l) { p[0] += P[v * 3]; p[1] += P[v * 3 + 1]; p[2] += P[v * 3 + 2]; } return p.map((x) => x / l.length); };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const bw = (i, bone) => { let w = 0; for (let k = 0; k < 4; k++) if (skinIndex[i * 4 + k] === boneIndex.get(bone)) w += skinWeight[i * 4 + k]; return w; };
  for (const s of SIDE) {
    // palm normal from wrist -> middle finger base and index -> pinky base
    const w0 = jpos(`wrist.${s}____head`), m0 = jpos(`finger3-1.${s}____head`), i0 = jpos(`finger2-1.${s}____head`), p0 = jpos(`finger5-1.${s}____head`);
    let palmN = norm(cross(sub(m0, w0), sub(p0, i0)));
    // orient: palm faces the body side/forward in A-pose -> decide by majority of hand normals later (store both signs)
    const sideSign = s === 'L' ? 1 : -1;
    if (dot(palmN, [sideSign, 0, 0]) > 0) palmN = palmN.map((x) => -x); // palm points toward the body (inward) in A-pose
    for (let f = 1; f <= 5; f++) {
      const tip = jpos(`finger${f}-3.${s}____tail`), base = jpos(`finger${f}-3.${s}____head`);
      const dir = norm(sub(tip, base));
      const len = Math.hypot(...sub(tip, base));
      for (let i = 0; i < nv; i++) {
        if (bw(i, `finger${f}-3.${s}`) < 0.5) continue;
        const rel = sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], base);
        const t = dot(rel, dir) / len;
        const n = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
        // dorsal side = opposite to the palm normal (thumb: use its own plane, so relax the threshold)
        const d = -dot(n, palmN);
        const m = Math.min(1, Math.max(0, (t - 0.38) / 0.18)) * Math.min(1, Math.max(0, (d - (f === 1 ? 0.0 : 0.35)) / 0.3));
        nail[i] = Math.max(nail[i], m);
      }
    }
    for (let i = 0; i < nv; i++) {
      let hw = bw(i, `wrist.${s}`) + bw(i, `metacarpal1.${s}`) + bw(i, `metacarpal2.${s}`) + bw(i, `metacarpal3.${s}`) + bw(i, `metacarpal4.${s}`);
      for (let f = 1; f <= 5; f++) for (let j = 1; j <= 3; j++) hw += bw(i, `finger${f}-${j}.${s}`);
      if (hw > 0.3) { const d = dot([N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], palmN); palm[i] = Math.max(palm[i], Math.min(1, Math.max(0, (d - 0.2) / 0.4)) * Math.min(1, hw)); }
      const fw = bw(i, `foot.${s}`) + bw(i, `toe1-1.${s}`);
      if (fw > 0.3 && N[i * 3 + 1] < -0.6) palm[i] = Math.max(palm[i], Math.min(1, fw));
      // knees / elbows redness
      const knee = jpos(`lowerleg01.${s}____head`), elbow = jpos(`lowerarm01.${s}____head`);
      const pi = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
      const dk = Math.hypot(...sub(pi, knee)), de = Math.hypot(...sub(pi, elbow));
      red[i] = Math.max(red[i], Math.max(0, 1 - dk / 0.07) * 0.6 * Math.max(0, N[i * 3 + 2]), Math.max(0, 1 - de / 0.05) * 0.4);
    }
  }
  // ears & nose tip & cheeks (head region, by position relative to head joint)
  const headJ = jpos('head____head');
  for (let i = 0; i < nv; i++) {
    if (bw(i, 'head') < 0.5) continue;
    const x = P[i * 3], y = P[i * 3 + 1] - headJ[1], z = P[i * 3 + 2] - headJ[2];
    const ear = Math.max(0, 1 - Math.max(0, 0.068 - Math.abs(x)) / 0.012) * (Math.abs(x) > 0.06 ? 1 : 0);
    const cheek = Math.max(0, 1 - Math.hypot(Math.abs(x) - 0.042, y - 0.07, z - 0.09) / 0.03);
    const nose = Math.max(0, 1 - Math.hypot(x, y - 0.085, z - 0.135) / 0.022);
    red[i] = Math.max(red[i], ear * 0.55, cheek * 0.45, nose * 0.4);
  }
  // simple 3D value noise for mottling
  const hash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  const vnoise = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    const s = (t) => t * t * (3 - 2 * t); const u = s(xf), v = s(yf), w = s(zf);
    let r = 0;
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++)
      r += hash(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    return r;
  };
  // rasterize body faces in UV space
  const img = new Float32Array(SIZE * SIZE * 3), cov = new Uint8Array(SIZE * SIZE);
  const tri = (ra, rb, rc) => {
    const ua = rvUV[ra * 2] * SIZE, va = (1 - rvUV[ra * 2 + 1]) * SIZE, ub = rvUV[rb * 2] * SIZE, vb = (1 - rvUV[rb * 2 + 1]) * SIZE, uc = rvUV[rc * 2] * SIZE, vc = (1 - rvUV[rc * 2 + 1]) * SIZE;
    const minX = Math.max(0, Math.floor(Math.min(ua, ub, uc)) - 1), maxX = Math.min(SIZE - 1, Math.ceil(Math.max(ua, ub, uc)) + 1);
    const minY = Math.max(0, Math.floor(Math.min(va, vb, vc)) - 1), maxY = Math.min(SIZE - 1, Math.ceil(Math.max(va, vb, vc)) + 1);
    const den = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc);
    if (Math.abs(den) < 1e-9) return;
    const A = rv2v[ra], B = rv2v[rb], Cc = rv2v[rc];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l1 = ((vb - vc) * (px - uc) + (uc - ub) * (py - vc)) / den, l2 = ((vc - va) * (px - uc) + (ua - uc) * (py - vc)) / den, l3 = 1 - l1 - l2;
      if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
      const I = (k) => [A, B, Cc].reduce((s, v, j) => s + [l1, l2, l3][j] * k[v], 0);
      const X = l1 * P[A * 3] + l2 * P[B * 3] + l3 * P[Cc * 3], Y = l1 * P[A * 3 + 1] + l2 * P[B * 3 + 1] + l3 * P[Cc * 3 + 1], Z = l1 * P[A * 3 + 2] + l2 * P[B * 3 + 2] + l3 * P[Cc * 3 + 2];
      const lipM = I(lip), nailM = I(nail), palmM = I(palm), redM = I(red);
      const n1 = vnoise(X * 18, Y * 18, Z * 18), n2 = vnoise(X * 70 + 11, Y * 70, Z * 70);
      let r = 0.93, g = 0.93, b = 0.93;
      const mott = (n1 - 0.5) * 0.05 + (n2 - 0.5) * 0.025;
      r += mott; g += mott * 1.1; b += mott * 1.1;
      // redness
      g -= redM * 0.06; b -= redM * 0.06;
      // palms & soles lighter, slightly less saturated
      r += palmM * 0.06; g += palmM * 0.065; b += palmM * 0.07;
      // nails: lighter pink with a pale tip
      r = r * (1 - nailM) + nailM * 1.0; g = g * (1 - nailM) + nailM * 0.9; b = b * (1 - nailM) + nailM * 0.9;
      // lips: deeper rose
      const lm = lipM * 0.62; r = r * (1 - lm) + lm * 0.86; g = g * (1 - lm) + lm * 0.66; b = b * (1 - lm) + lm * 0.68;
      const o = (y * SIZE + x);
      img[o * 3] = r; img[o * 3 + 1] = g; img[o * 3 + 2] = b; cov[o] = 1;
    }
  };
  for (let f = 0; f < faceG.length; f++) {
    if (faceG[f] !== 0) continue;
    const r = faceRV.slice(f * 4, f * 4 + 4);
    tri(r[0], r[1], r[2]); if (r[3] !== 0xffff) tri(r[0], r[2], r[3]);
  }
  // dilate 4 px to hide UV seams
  for (let it = 0; it < 4; it++) {
    const add = [];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const o = y * SIZE + x; if (cov[o]) continue;
      let s = [0, 0, 0], n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= SIZE || yy >= SIZE) continue; const q = yy * SIZE + xx; if (cov[q] === 1) { s[0] += img[q * 3]; s[1] += img[q * 3 + 1]; s[2] += img[q * 3 + 2]; n++; } }
      if (n) add.push([o, s.map((v) => v / n)]);
    }
    for (const [o, c] of add) { img[o * 3] = c[0]; img[o * 3 + 1] = c[1]; img[o * 3 + 2] = c[2]; cov[o] = 2; }
    for (const [o] of add) cov[o] = 1;
  }
  // fill the rest with base value, encode PNG (8-bit sRGB values, already perceptual)
  const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 3 + 1)] = 0;
    for (let x = 0; x < SIZE; x++) {
      const o = y * SIZE + x, p = y * (SIZE * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[p + k] = Math.round(Math.min(1, Math.max(0, cov[o] ? img[o * 3 + k] : 0.93)) * 255);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(path.join(OUT, 'skin.png'), png);
  console.log(`skin.png ${(png.length / 1e3).toFixed(0)} KB`);
}

// ---------------------------------------------------------------- anatomical normal maps
// Tangent-space normal maps in body UV space with muscle and bony relief, one per
// sex: skin_normal.png (female; also the generic fallback) and skin_normal_m.png
// (male). The relief is the band-passed displacement, along the normal, from the
// average shape to muscular / lean / toned MakeHuman shapes: the local form of
// pectorals, abs, serratus, deltoids, arm and leg muscles, clavicles, scapulae,
// ribs, kneecaps … without their volume (the silhouette keeps the preset shape).
// It is baked as the normals of the displaced mesh expressed in each render
// vertex's UV tangent frame (smooth, no faceting), plus fine procedural relief
// (knuckles, hand/foot tendons, kneecap rim) as a texel height map.
// three.js builds the TBN from screen-space UV derivatives, so the frame used
// here is (dP/du, dP/dv, N) orthogonalized against N; image row 0 is v = 1.
{
  const SIZE = 1024;
  const t0 = Date.now();
  const bodyF = [];
  const isBody = new Uint8Array(NV);
  for (let f = 0; f < faceG.length; f++) if (faceG[f] === 0) { bodyF.push(f); for (let k = 0; k < 4; k++) { const v = faceV[f * 4 + k]; if (v !== 0xffff) isBody[v] = 1; } }
  // vertex adjacency (CSR) over body edges
  const adjS = Array.from({ length: NV }, () => new Set());
  for (const f of bodyF) {
    const q = [0, 1, 2, 3].map((k) => faceV[f * 4 + k]).filter((v) => v !== 0xffff);
    for (let k = 0; k < q.length; k++) { const a = q[k], b = q[(k + 1) % q.length]; adjS[a].add(b); adjS[b].add(a); }
  }
  const aOff = new Uint32Array(NV + 1);
  for (let v = 0; v < NV; v++) aOff[v + 1] = aOff[v] + adjS[v].size;
  const aList = new Uint32Array(aOff[NV]);
  for (let v = 0; v < NV; v++) { let k = aOff[v]; for (const u of adjS[v]) aList[k++] = u; }
  /** Jacobi Laplacian smoothing of a scalar field over the body surface. */
  const smoothField = (h, iters, lam = 0.5) => {
    let a = Float32Array.from(h), b = new Float32Array(NV);
    for (let it = 0; it < iters; it++) {
      for (let v = 0; v < NV; v++) {
        const n = aOff[v + 1] - aOff[v];
        if (!isBody[v] || !n) { b[v] = a[v]; continue; }
        let s = 0; for (let k = aOff[v]; k < aOff[v + 1]; k++) s += a[aList[k]];
        b[v] = (1 - lam) * a[v] + lam * s / n;
      }
      [a, b] = [b, a];
    }
    return a;
  };
  const band = (h, lo, hi) => { const s1 = smoothField(h, lo), s2 = smoothField(h, hi); for (let v = 0; v < NV; v++) s1[v] -= s2[v]; return s1; };
  /** Area-weighted vertex normals over body faces. */
  const vnormals = (P) => {
    const N = new Float32Array(NV * 3);
    for (const f of bodyF) {
      const a = faceV[f * 4], b = faceV[f * 4 + 1], c = faceV[f * 4 + 2], d = faceV[f * 4 + 3];
      const p = (i, k) => P[i * 3 + k];
      let ux, uy, uz, vx, vy, vz;
      if (d !== 0xffff) { ux = p(c, 0) - p(a, 0); uy = p(c, 1) - p(a, 1); uz = p(c, 2) - p(a, 2); vx = p(d, 0) - p(b, 0); vy = p(d, 1) - p(b, 1); vz = p(d, 2) - p(b, 2); }
      else { ux = p(b, 0) - p(a, 0); uy = p(b, 1) - p(a, 1); uz = p(b, 2) - p(a, 2); vx = p(c, 0) - p(a, 0); vy = p(c, 1) - p(a, 1); vz = p(c, 2) - p(a, 2); }
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c, d]) if (v !== 0xffff) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; }
    }
    for (let v = 0; v < NV; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; }
    return N;
  };
  const headB = boneIndex.get('head');
  const boneW = (v, re) => { let w = 0; for (let k = 0; k < 4; k++) if (re.test(boneNames[skinIndex[v * 4 + k]])) w += skinWeight[v * 4 + k]; return w; };
  // face / skull: no body relief (expressions own the face); soft border on the neck
  const faceMask = new Float32Array(NV);
  for (let v = 0; v < NV; v++) { let w = 0; for (let k = 0; k < 4; k++) if (skinIndex[v * 4 + k] === headB) w += skinWeight[v * 4 + k]; faceMask[v] = w; }
  const keep = smoothField(faceMask, 4).map((w) => 1 - Math.min(1, Math.max(0, (w - 0.25) / 0.5)));
  const fingerW = new Float32Array(NV);
  for (let v = 0; v < NV; v++) fingerW[v] = boneW(v, /^(finger|metacarpal|toe)/);

  const tgt = (rels) => { const d = new Float64Array(NV * 3); for (const r of rels) addTarget(d, r, 1); return Float32Array.from(d, (x) => x * DM2M); };
  const along = (D, N) => { const h = new Float32Array(NV); for (let v = 0; v < NV; v++) h[v] = D[v * 3] * N[v * 3] + D[v * 3 + 1] * N[v * 3 + 1] + D[v * 3 + 2] * N[v * 3 + 2]; return h; };
  const minus = (A, B) => { const o = new Float32Array(A.length); for (let i = 0; i < A.length; i++) o[i] = A[i] - B[i]; return o; };
  const sides = (rel) => [rel.replace('{s}', 'l'), rel.replace('{s}', 'r')];
  const TONE = [
    'stomach/stomach-tone-incr.target', 'pelvis/pelvis-tone-incr.target', 'torso/torso-muscle-pectoral-incr.target', 'torso/torso-muscle-dorsi-incr.target',
    ...sides('armslegs/{s}-upperarm-muscle-incr.target'), ...sides('armslegs/{s}-lowerarm-muscle-incr.target'), ...sides('armslegs/{s}-upperarm-shoulder-muscle-incr.target'),
    ...sides('armslegs/{s}-upperleg-muscle-incr.target'), ...sides('armslegs/{s}-lowerleg-muscle-incr.target'),
  ];
  const toneD = tgt(TONE);

  // ---- per-sex relief (m along the normal)
  const relief = (g) => {
    const avg = { gender: g, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.6, cup: 0.5, firmness: 0.5 };
    const P0 = toM(evalShape(avg)), N0 = vnormals(P0);
    const leanP = toM(evalShape({ ...avg, muscle: 0.5, weight: 0 }));
    const musc = along(minus(toM(evalShape({ ...avg, muscle: 1, weight: 0 })), leanP), N0); // muscle growth on a lean body
    const lean = along(minus(leanP, P0), N0); // fat loss: bony landmarks
    const tone = along(toneD, N0);
    const bm = band(musc, 2, 12), bl = band(lean, 2, 12), bt = band(tone, 2, 16);
    const h = new Float32Array(NV);
    const kM = g ? 1.2 : 1.45, kL = g ? 0.6 : 0.95, kT = g ? 0.7 : 0.75;
    // soft limit (nipples, navel, genitals carry the largest offsets): |h| < ~7 mm
    for (let v = 0; v < NV; v++) h[v] = isBody[v] ? 0.007 * Math.tanh(keep[v] * (kM * bm[v] + kL * bl[v] + kT * bt[v]) / 0.007) : 0;
    if (process.env.DEBUG_RELIEF) {
      for (const [nm, f] of [['musc', bm], ['lean', bl], ['tone', bt], ['all', h]]) debugField(f, `${process.env.DEBUG_RELIEF}/relief-${g ? 'm' : 'f'}-${nm}.png`);
      debugField(Float32Array.from({ length: NV }, (_, v) => N0[v * 3 + 2] * 0.006), `${process.env.DEBUG_RELIEF}/front-${g}.png`);
      debugField(Float32Array.from({ length: NV }, (_, v) => (P0[v * 3 + 1] - 0.4) * 0.006 / 0.8), `${process.env.DEBUG_RELIEF}/height-${g}.png`);
    }
    return { P0, N0, h: smoothField(h, 1, 0.3) };
  };

  // ---- fine relief (texel height, m) from the skeleton: knuckles, extensor tendons, kneecap rim
  const fine = (P0) => {
    const jp = (name) => { const l = skel.joints[name]; const p = [0, 0, 0]; for (const v of l) for (let k = 0; k < 3; k++) p[k] += P0[v * 3 + k]; return p.map((x) => x / l.length); };
    const segs = []; // [a, b, radius, height, kind]
    for (const s of SIDE) {
      for (let f = 2; f <= 5; f++) {
        const k = jp(`finger${f}-1.${s}____head`), w = jp(`wrist.${s}____head`);
        segs.push({ a: w, b: k, r: 0.0032, hgt: 0.0010, t0: 0.25, t1: 0.92, depth: 0.03 }); // extensor tendon on the back of the hand
        segs.push({ a: k, b: k, r: 0.0065, hgt: 0.0016, dot: true, depth: 0.03 }); // knuckle
        for (let j = 2; j <= 3; j++) { const q = jp(`finger${f}-${j}.${s}____head`); segs.push({ a: q, b: q, r: 0.0042, hgt: 0.0007, dot: true, depth: 0.02 }); }
      }
      const fk = jp(`finger1-2.${s}____head`); segs.push({ a: fk, b: fk, r: 0.005, hgt: 0.0008, dot: true, depth: 0.025 });
      for (let f = 1; f <= 5; f++) { const ft = jp(`toe${f}-1.${s}____head`), an = jp(`foot.${s}____head`); segs.push({ a: an, b: ft, r: 0.0034, hgt: 0.0009, t0: 0.3, t1: 0.85, depth: 0.045 }); }
      const kn = jp(`lowerleg01.${s}____head`), an = jp(`foot.${s}____head`), hp = jp(`upperleg01.${s}____head`);
      // tibia crest (shin) and Achilles tendon
      segs.push({ a: kn, b: an, r: 0.006, hgt: 0.0012, t0: 0.12, t1: 0.8, front: true, depth: 0.06 });
      segs.push({ a: an, b: kn, r: 0.007, hgt: 0.0012, t0: 0.05, t1: 0.35, back: true, depth: 0.075 });
      segs.push({ knee: true, c: kn, up: [hp[0] - kn[0], hp[1] - kn[1], hp[2] - kn[2]] });
    }
    return (X, n, out) => {
      let hsum = 0;
      for (const s of segs) {
        if (s.knee) {
          // patella: raised rounded plate on the front of the knee with a soft rim
          const L = Math.hypot(...s.up), u = s.up.map((x) => x / L);
          const d = [X[0] - s.c[0], X[1] - s.c[1], X[2] - s.c[2]];
          const along = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
          const front = n[2];
          if (front < 0.2 || Math.hypot(...d) > 0.12) continue;
          const lat = Math.hypot(d[0] - u[0] * along, 0);
          const e = ((along - 0.012) / 0.03) ** 2 + (lat / 0.026) ** 2;
          hsum += 0.0022 * Math.exp(-e * 1.6) * Math.min(1, (front - 0.2) / 0.4);
          continue;
        }
        const ab = [s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]], ll = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
        let t = ll ? ((X[0] - s.a[0]) * ab[0] + (X[1] - s.a[1]) * ab[1] + (X[2] - s.a[2]) * ab[2]) / ll : 0;
        let fade = 1;
        if (!s.dot) { if (t < s.t0 || t > s.t1) continue; const m = Math.min(t - s.t0, s.t1 - t) / 0.08; fade = Math.min(1, m); }
        t = Math.max(0, Math.min(1, t));
        const q = [s.a[0] + ab[0] * t, s.a[1] + ab[1] * t, s.a[2] + ab[2] * t];
        // distance to the axis measured on the surface: drop the component along the normal
        const d = [X[0] - q[0], X[1] - q[1], X[2] - q[2]];
        const dn = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
        if (dn < 0 || dn > s.depth) continue; // skin right over the axis, on its outer side
        if (s.front && n[2] < 0.3) continue;
        if (s.back && n[2] > -0.3) continue;
        const dt = Math.hypot(d[0] - n[0] * dn, d[1] - n[1] * dn, d[2] - n[2] * dn);
        if (dt > s.r * 3) continue;
        hsum += s.hgt * fade * Math.exp(-((dt / s.r) ** 2));
      }
      out[0] = hsum;
    };
  };

  /** debug: a per-vertex field rasterized in UV space as grey (±6 mm). */
  const debugField = (f, file) => {
    const S = 512, im = new Uint8Array(S * S * 4).fill(255);
    for (const fc of bodyF) {
      const r = [faceRV[fc * 4], faceRV[fc * 4 + 1], faceRV[fc * 4 + 2], faceRV[fc * 4 + 3]];
      for (const [a, b, c] of r[3] !== 0xffff ? [[r[0], r[1], r[2]], [r[0], r[2], r[3]]] : [[r[0], r[1], r[2]]]) {
        const P = [a, b, c].map((x) => [rvUV[x * 2] * S, (1 - rvUV[x * 2 + 1]) * S, f[rv2v[x]]]);
        const den = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]);
        if (Math.abs(den) < 1e-9) continue;
        for (let y = Math.floor(Math.min(P[0][1], P[1][1], P[2][1])); y <= Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])); y++) for (let x = Math.floor(Math.min(P[0][0], P[1][0], P[2][0])); x <= Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])); x++) {
          if (x < 0 || y < 0 || x >= S || y >= S) continue;
          const l1 = ((P[1][1] - P[2][1]) * (x - P[2][0]) + (P[2][0] - P[1][0]) * (y - P[2][1])) / den, l2 = ((P[2][1] - P[0][1]) * (x - P[2][0]) + (P[0][0] - P[2][0]) * (y - P[2][1])) / den, l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const val = l1 * P[0][2] + l2 * P[1][2] + l3 * P[2][2];
          const g8 = Math.max(0, Math.min(255, Math.round(128 + val / 0.006 * 127)));
          const o = (y * S + x) * 4; im[o] = im[o + 1] = im[o + 2] = g8;
        }
      }
    }
    writePNG(file, S, S, im);
  };
  const bake = (g, file) => {
    const { P0, N0, h } = relief(g);
    // displaced surface normals (the relief at vertex resolution)
    const P1 = new Float32Array(NV * 3);
    for (let v = 0; v < NV; v++) for (let k = 0; k < 3; k++) P1[v * 3 + k] = P0[v * 3 + k] + N0[v * 3 + k] * h[v];
    const N1 = vnormals(P1);
    // UV tangent frame per render vertex
    const NR = rv2v.length, Tu = new Float64Array(NR * 3), Tv = new Float64Array(NR * 3);
    const tris = [];
    for (const f of bodyF) {
      const r = [faceRV[f * 4], faceRV[f * 4 + 1], faceRV[f * 4 + 2], faceRV[f * 4 + 3]];
      tris.push([r[0], r[1], r[2]]); if (r[3] !== 0xffff) tris.push([r[0], r[2], r[3]]);
    }
    const triT = new Float32Array(tris.length * 2); // |dP/du|, |dP/dv| per triangle (m per UV unit)
    tris.forEach(([a, b, c], ti) => {
      const pa = rv2v[a] * 3, pb = rv2v[b] * 3, pc = rv2v[c] * 3;
      const e1 = [P0[pb] - P0[pa], P0[pb + 1] - P0[pa + 1], P0[pb + 2] - P0[pa + 2]], e2 = [P0[pc] - P0[pa], P0[pc + 1] - P0[pa + 1], P0[pc + 2] - P0[pa + 2]];
      const du1 = rvUV[b * 2] - rvUV[a * 2], dv1 = rvUV[b * 2 + 1] - rvUV[a * 2 + 1], du2 = rvUV[c * 2] - rvUV[a * 2], dv2 = rvUV[c * 2 + 1] - rvUV[a * 2 + 1];
      const det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) < 1e-12) return;
      const r = 1 / det;
      const tu = [0, 1, 2].map((k) => (e1[k] * dv2 - e2[k] * dv1) * r), tv = [0, 1, 2].map((k) => (e2[k] * du1 - e1[k] * du2) * r);
      triT[ti * 2] = Math.hypot(...tu); triT[ti * 2 + 1] = Math.hypot(...tv);
      for (const x of [a, b, c]) for (let k = 0; k < 3; k++) { Tu[x * 3 + k] += tu[k]; Tv[x * 3 + k] += tv[k]; }
    });
    const TS = new Float32Array(NR * 3), RB = new Float32Array(NR * 9); // tangent-space detail normal; frame (T, B, N)
    for (let r = 0; r < NR; r++) {
      const v = rv2v[r], n = [N0[v * 3], N0[v * 3 + 1], N0[v * 3 + 2]];
      let t = [Tu[r * 3], Tu[r * 3 + 1], Tu[r * 3 + 2]];
      let dn = t[0] * n[0] + t[1] * n[1] + t[2] * n[2]; t = t.map((x, k) => x - n[k] * dn); let l = Math.hypot(...t) || 1; t = t.map((x) => x / l);
      // bitangent exactly as three.js builds it from a tangent attribute: cross(N, T) * w
      let b = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
      if (b[0] * Tv[r * 3] + b[1] * Tv[r * 3 + 1] + b[2] * Tv[r * 3 + 2] < 0) b = b.map((x) => -x);
      const m = [N1[v * 3], N1[v * 3 + 1], N1[v * 3 + 2]];
      TS[r * 3] = m[0] * t[0] + m[1] * t[1] + m[2] * t[2];
      TS[r * 3 + 1] = m[0] * b[0] + m[1] * b[1] + m[2] * b[2];
      TS[r * 3 + 2] = m[0] * n[0] + m[1] * n[1] + m[2] * n[2];
      RB.set([...t, ...b, ...n], r * 9);
    }
    // rasterize: interpolated detail normal, 3D position, normal and UV scale per texel
    const S = SIZE, img = new Float32Array(S * S * 3), pos = new Float32Array(S * S * 3), nrm = new Float32Array(S * S * 3), scl = new Float32Array(S * S * 2), cov = new Uint8Array(S * S);
    const fineH = fine(P0);
    tris.forEach(([ra, rb, rc], ti) => {
      const ua = rvUV[ra * 2] * S, va = (1 - rvUV[ra * 2 + 1]) * S, ub = rvUV[rb * 2] * S, vb = (1 - rvUV[rb * 2 + 1]) * S, uc = rvUV[rc * 2] * S, vc = (1 - rvUV[rc * 2 + 1]) * S;
      const minX = Math.max(0, Math.floor(Math.min(ua, ub, uc)) - 1), maxX = Math.min(S - 1, Math.ceil(Math.max(ua, ub, uc)) + 1);
      const minY = Math.max(0, Math.floor(Math.min(va, vb, vc)) - 1), maxY = Math.min(S - 1, Math.ceil(Math.max(va, vb, vc)) + 1);
      const den = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc);
      if (Math.abs(den) < 1e-9) return;
      const A = rv2v[ra], B = rv2v[rb], C = rv2v[rc];
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const l1 = ((vb - vc) * (px - uc) + (uc - ub) * (py - vc)) / den, l2 = ((vc - va) * (px - uc) + (ua - uc) * (py - vc)) / den, l3 = 1 - l1 - l2;
        if (l1 < -0.01 || l2 < -0.01 || l3 < -0.01) continue;
        const o = y * S + x;
        for (let k = 0; k < 3; k++) {
          img[o * 3 + k] = l1 * TS[ra * 3 + k] + l2 * TS[rb * 3 + k] + l3 * TS[rc * 3 + k];
          pos[o * 3 + k] = l1 * P0[A * 3 + k] + l2 * P0[B * 3 + k] + l3 * P0[C * 3 + k];
          nrm[o * 3 + k] = l1 * N0[A * 3 + k] + l2 * N0[B * 3 + k] + l3 * N0[C * 3 + k];
        }
        scl[o * 2] = triT[ti * 2]; scl[o * 2 + 1] = triT[ti * 2 + 1];
        cov[o] = 1;
      }
    });
    // fine relief: texel heights -> slopes in the UV frame (central differences inside an island)
    const H = new Float32Array(S * S), tmp = [0];
    for (let o = 0; o < S * S; o++) if (cov[o]) { fineH([pos[o * 3], pos[o * 3 + 1], pos[o * 3 + 2]], [nrm[o * 3], nrm[o * 3 + 1], nrm[o * 3 + 2]], tmp); H[o] = tmp[0]; }
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const o = y * S + x;
      if (!cov[o] || !scl[o * 2]) continue;
      const hx0 = cov[o - 1] ? H[o - 1] : H[o], hx1 = cov[o + 1] ? H[o + 1] : H[o];
      const hy0 = cov[o - S] ? H[o - S] : H[o], hy1 = cov[o + S] ? H[o + S] : H[o];
      // per texel: du = 1/S -> |dP/du|/S meters; image y grows as v decreases
      const sx = (hx1 - hx0) / (2 * scl[o * 2] / S), sy = -(hy1 - hy0) / (2 * scl[o * 2 + 1] / S);
      img[o * 3] -= sx; img[o * 3 + 1] -= sy;
    }
    // dilate islands (mip-mapping / filtering at seams)
    for (let it = 0; it < 6; it++) {
      const add = [];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const o = y * S + x; if (cov[o]) continue;
        const s = [0, 0, 0]; let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue; const q = yy * S + xx; if (cov[q] === 1) { s[0] += img[q * 3]; s[1] += img[q * 3 + 1]; s[2] += img[q * 3 + 2]; n++; } }
        if (n) add.push([o, s.map((c) => c / n)]);
      }
      for (const [o, c] of add) { img[o * 3] = c[0]; img[o * 3 + 1] = c[1]; img[o * 3 + 2] = c[2]; cov[o] = 2; }
      for (const [o] of add) cov[o] = 1;
    }
    const rgba = new Uint8Array(S * S * 4);
    let maxSlope = 0;
    for (let o = 0; o < S * S; o++) {
      let x = 0, y = 0, z = 1;
      if (cov[o]) {
        x = img[o * 3]; y = img[o * 3 + 1]; z = Math.max(0.2, img[o * 3 + 2]); const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
        // tilt limit (45 deg): normalScale multiplies x/y at runtime
        const sl = Math.hypot(x, y); if (sl > 0.707) { x *= 0.707 / sl; y *= 0.707 / sl; z = 0.707; }
        maxSlope = Math.max(maxSlope, Math.hypot(x, y));
      }
      rgba[o * 4] = Math.round((x * 0.5 + 0.5) * 255); rgba[o * 4 + 1] = Math.round((y * 0.5 + 0.5) * 255); rgba[o * 4 + 2] = Math.round((z * 0.5 + 0.5) * 255); rgba[o * 4 + 3] = 255;
    }
    writePNG(path.join(OUT, file), S, S, rgba);
    let hmin = 0, hmax = 0; for (const x of h) { hmin = Math.min(hmin, x); hmax = Math.max(hmax, x); }
    console.log(`${file}: ${S}x${S}, relief ${(hmin * 1000).toFixed(1)}..${(hmax * 1000).toFixed(1)} mm, max tilt ${(Math.asin(Math.min(1, maxSlope)) * 180 / Math.PI).toFixed(0)} deg, ${(fs.statSync(path.join(OUT, file)).size / 1e3).toFixed(0)} KB`);
  };
  bake(0, 'skin_normal.png');
  bake(1, 'skin_normal_m.png');
  console.log(`normal maps baked in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// ---------------------------------------------------------------- PNG helpers
// Minimal PNG reader (8-bit RGBA/RGB, non-interlaced) and RGBA writer, used to
// downsample the stock eye texture (only shown until the face module builds its
// procedural texture) while keeping the transparent cornea.
function readPNG(file) {
  const b = fs.readFileSync(file);
  let o = 8, w = 0, h = 0, ct = 0, idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8), data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG'); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : (() => { throw new Error('unsupported PNG color type ' + ct); })();
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = k < bpp ? cur[x * bpp + k] : 255;
    prev = cur;
  }
  return { w, h, data: out };
}
function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bb) => { let c = 0xffffffff; for (const x of bb) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
function writeEyeTexture(src, dst, size) {
  const im = readPNG(src), f = im.w / size, out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const acc = [0, 0, 0, 0];
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) { const o = ((y * f + j) * im.w + x * f + i) * 4; for (let k = 0; k < 4; k++) acc[k] += im.data[o + k]; }
    for (let k = 0; k < 4; k++) out[(y * size + x) * 4 + k] = Math.round(acc[k] / (f * f));
  }
  writePNG(dst, size, size, out);
  console.log(`eye.png ${size}x${size}`);
}
