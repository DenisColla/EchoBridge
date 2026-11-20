#!/usr/bin/env node
// Builds the compact human asset pack used by the PosaViva web app from the
// CC0 MakeHuman data (base mesh hm08, targets, default skeleton/weights, eyes).
//
//   node tools/build-assets.mjs [path/to/makehuman/data]
//
// Output: web/public/assets/human.json (metadata) + human.bin (typed arrays)
//         web/public/assets/eye.png
// All positions are emitted in METERS, Y up, character facing +Z.

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
  { id: 'f_slim', label: 'Magra', sex: 'F', p: { gender: 0, muscle: 0.45, weight: 0.02, height: 0.6, proportions: 0.8, cup: 0.3, firmness: 0.6, linear: { 'bodyshapes/bodyshapes-elvs-fem-lean-column.target': 0.5 } } },
  { id: 'f_normal', label: 'Normale', sex: 'F', p: { gender: 0, muscle: 0.5, weight: 0.42, height: 0.54, proportions: 0.72, cup: 0.55, firmness: 0.55, linear: { 'bodyshapes/bodyshapes-elvs-fem-neat-hourglass.target': 0.35 } } },
  { id: 'f_curvy', label: 'Curvy', sex: 'F', p: { gender: 0, muscle: 0.5, weight: 0.88, height: 0.52, proportions: 0.62, cup: 0.95, firmness: 0.45, linear: { 'bodyshapes/bodyshapes-elvs-fem-full-hourglass.target': 1.0, 'buttocks/buttocks-volume-incr.target': 0.7, 'hip/hip-scale-horiz-incr.target': 0.4, 'measure/measure-waist-circ-decr.target': 0.35 } } },
  { id: 'm_slim', label: 'Magro', sex: 'M', p: { gender: 1, muscle: 0.38, weight: 0.0, height: 0.6, proportions: 0.78, linear: { 'bodyshapes/bodyshapes-elvs-man-lean-column.target': 0.5 } } },
  { id: 'm_normal', label: 'Normale', sex: 'M', p: { gender: 1, muscle: 0.68, weight: 0.42, height: 0.57, proportions: 0.78, linear: { 'bodyshapes/bodyshapes-elvs-man-invert-triangle.target': 0.35 } } },
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
function emitSparse(deltaDm) {
  const idx = [], val = [];
  for (let i = 0; i < NV; i++) {
    const x = deltaDm[i * 3] * DM2M, y = deltaDm[i * 3 + 1] * DM2M, z = deltaDm[i * 3 + 2] * DM2M;
    if (Math.abs(x) < 5e-5 && Math.abs(y) < 5e-5 && Math.abs(z) < 5e-5) continue;
    idx.push(i); val.push(Math.round(x * Q), Math.round(y * Q), Math.round(z * Q));
  }
  for (const q of val) if (Math.abs(q) > 32767) throw new Error('delta overflow');
  return { idx: emit(Uint16Array.from(idx)), val: emit(Int16Array.from(val)), count: idx.length };
}
function diff(a, b) { const d = new Float64Array(a.length); for (let i = 0; i < a.length; i++) d[i] = a[i] - b[i]; return d; }
const toM = a => Float32Array.from(a, x => x * DM2M);

const meta = {
  version: 1,
  units: 'meters',
  source: 'MakeHuman hm08 base mesh, targets, default skeleton & weights (CC0 1.0) — makehumancommunity.org',
  vertexCount: NV,
  groups: GROUPS,
  quantization: 1 / Q,
};

meta.topology = {
  faceV: emit(Uint16Array.from(faceV)),
  faceRV: emit(Uint16Array.from(faceRV)),
  faceGroup: emit(Uint8Array.from(faceG)),
  rv2v: emit(Uint16Array.from(rv2v)),
  rvUV: emit(Float32Array.from(rvUV)),
  basePositions: emit(toM(base.v)),
};

// presets + macro slider deltas
meta.presets = [];
for (const pr of PRESETS) {
  const pos = evalShape(pr.p);
  const entry = { id: pr.id, label: pr.label, sex: pr.sex, params: pr.p, positions: emit(toM(pos)), deltas: {} };
  for (const s of SLIDERS.filter(s => s.kind === 'macro')) {
    if (s.sex && s.sex !== pr.sex) continue;
    const v0 = pr.p[s.param] ?? 0.5;
    const up = Math.min(1, v0 + s.range), dn = Math.max(0, v0 - s.range);
    const pu = evalShape({ ...pr.p, [s.param]: up });
    const pd = evalShape({ ...pr.p, [s.param]: dn });
    entry.deltas[s.id] = { pos: emitSparse(diff(pu, pos)), neg: emitSparse(diff(pd, pos)) };
  }
  meta.presets.push(entry);
  console.log(`preset ${pr.id} done`);
}
meta.sliders = SLIDERS.map(s => ({ id: s.id, label: s.label, kind: s.kind, sex: s.sex || null }));
meta.targetDeltas = {};
for (const s of SLIDERS.filter(s => s.kind === 'target')) {
  const sum = list => { const d = new Float64Array(NV * 3); for (const rel of list) addTarget(d, rel, 1); return d; };
  meta.targetDeltas[s.id] = { pos: emitSparse(sum(s.pos)), neg: emitSparse(sum(s.neg)) };
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
const skinIndex = new Uint8Array(NV * 4), skinWeight = new Float32Array(NV * 4);
let unweighted = 0;
for (let i = 0; i < NV; i++) {
  const e = [...perV[i].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = e.reduce((s, x) => s + x[1], 0);
  if (!sum) { unweighted++; skinIndex[i * 4] = boneIndex.get('spine05'); skinWeight[i * 4] = 1; continue; }
  e.forEach(([b, w], k) => { skinIndex[i * 4 + k] = b; skinWeight[i * 4 + k] = w / sum; });
}
console.log(`bones kept: ${boneNames.length}, unweighted verts: ${unweighted}`);
meta.skin = { index: emit(skinIndex), weight: emit(skinWeight) };

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
  fs.copyFileSync(path.join(DATA, 'eyes/materials/brown_eye.png'), path.join(OUT, 'eye.png'));
  console.log(`eyes: ${nEye} verts, ${eIdx.length / 3} tris`);
}

// ---------------------------------------------------------------- write
const bin = Buffer.concat(chunks);
fs.writeFileSync(path.join(OUT, 'human.bin'), bin);
fs.writeFileSync(path.join(OUT, 'human.json'), JSON.stringify(meta));
console.log(`human.bin ${(bin.length / 1e6).toFixed(2)} MB, human.json ${(JSON.stringify(meta).length / 1e3).toFixed(1)} KB`);
