// Shared, immutable human data (topology, presets, slider deltas, skeleton
// definition, skin weights, eye proxy). One instance for the whole app.
//
// human.bin format v2 (tools/build-assets.mjs) stores the bulky parts compactly
// and they are expanded here: preset positions as 0.1 mm steps from the base mesh
// (varint stream), slider deltas as varint streams decoded on first use (only the
// presets/sliders actually touched cost memory), UVs and skin weights as 16-bit
// fractions. The public arrays keep the v1 types (Float32 positions/UV/weights,
// Uint16 idx + Int16 val sparse deltas). v1 files still load.
const CTORS = { Float32Array, Uint16Array, Int16Array, Uint8Array, Uint32Array, Int32Array };

/**
 * Reads n zigzag LEB128 varints from bytes starting at p. Each value is a
 * difference to the value 3 places earlier (same xyz component) when acc3 is
 * set, or a gap to the previous index (+1) when not. Returns the end position.
 */
function readVarints(bytes, p, n, out, acc3) {
  let a0 = 0, a1 = 0, a2 = 0, prev = -1;
  for (let k = 0; k < n; k++) {
    let z = 0, s = 0, b;
    do { b = bytes[p++]; z |= (b & 127) << s; s += 7; } while (b & 128);
    const d = z & 1 ? -((z + 1) >>> 1) : z >>> 1;
    if (!acc3) { prev += d + 1; out[k] = prev; continue; }
    const c = k % 3;
    if (c === 0) out[k] = a0 += d; else if (c === 1) out[k] = a1 += d; else out[k] = a2 += d;
  }
  return p;
}

/** A sparse delta kept as its varint stream until first read ({idx, val, count, scale} like v1). */
class PackedDelta {
  constructor(bytes, count, idxBytes, scale) { this._b = bytes; this._ib = idxBytes; this.count = count; this.scale = scale; this._idx = null; this._val = null; }
  _decode() {
    const n = this.count, idx = new Uint16Array(n), val = new Int16Array(n * 3);
    readVarints(this._b, 0, n, idx, false);
    readVarints(this._b, this._ib, n * 3, val, true);
    this._idx = idx; this._val = val; this._b = null;
  }
  get idx() { if (!this._idx) this._decode(); return this._idx; }
  get val() { if (!this._val) this._decode(); return this._val; }
}

export class HumanModel {
  constructor(meta, buffer) {
    this.meta = meta;
    const view = (ref) => new CTORS[ref.type](buffer, ref.offset, ref.length);
    this.view = view;
    this.vertexCount = meta.vertexCount;
    this.groups = meta.groups; // ['body','tights','skirt','hair','eyeL','eyeR','eyelashes','teethUpper','teethLower','tongue']
    const t = meta.topology;
    /** Faces as 4 mesh-vertex indices each (4th = 0xffff for triangles). */
    this.faceV = view(t.faceV);
    /** Same faces as render-vertex indices (UV seams split). */
    this.faceRV = view(t.faceRV);
    /** Group id per face (index into this.groups). */
    this.faceGroup = view(t.faceGroup);
    this.faceCount = this.faceGroup.length;
    this.rv2v = view(t.rv2v);
    this.rvUV = this._float(t.rvUV);
    this.renderVertexCount = this.rv2v.length;
    this.basePositions = view(t.basePositions);

    this.presets = meta.presets.map((p) => {
      const preset = {
        id: p.id, label: p.label, sex: p.sex, params: p.params,
        deltas: Object.fromEntries(Object.entries(p.deltas).map(([k, d]) => [k, { pos: this._sparse(d.pos), neg: this._sparse(d.neg) }])),
      };
      // positions: Float32Array(NV*3), decoded on first use (most scenes use one or two presets)
      let pos = p.positions.enc ? null : view(p.positions);
      Object.defineProperty(preset, 'positions', { enumerable: true, get: () => pos || (pos = this._positions(p.positions)) });
      return preset;
    });
    this.presetById = new Map(this.presets.map((p) => [p.id, p]));
    this.sliders = meta.sliders; // [{id,label,kind,sex}]
    this.targetDeltas = Object.fromEntries(Object.entries(meta.targetDeltas).map(([k, d]) => [k, { pos: this._sparse(d.pos), neg: this._sparse(d.neg) }]));
    this.expressions = Object.fromEntries(Object.entries(meta.expressions).map(([k, d]) => [k, this._sparse(d)]));
    this.expressionUnits = Object.keys(this.expressions);

    this.bones = meta.bones; // [{name,parent,head,tail,plane}] parent-first order
    this.boneIndex = new Map(this.bones.map((b, i) => [b.name, i]));
    const jn = meta.joints.names, ji = view(meta.joints.indices), jo = view(meta.joints.offsets);
    this.joints = new Map(jn.map((n, k) => [n, ji.subarray(jo[k], jo[k + 1])]));
    this.skinIndex = view(meta.skin.index); // Uint8 x4 per mesh vertex
    this.skinWeight = this._weights(meta.skin.weight); // Float32 x4 per mesh vertex

    const e = meta.eyes;
    this.eyes = {
      scales: e.scales, refs: view(e.refs), weights: view(e.weights), offsets: view(e.offsets),
      side: view(e.side), rv2v: view(e.rv2v), uv: view(e.uv), index: view(e.index),
      vertexCount: view(e.side).length,
    };

    // per-group face lists (indices into faces) for convenience
    this.groupFaces = this.groups.map(() => []);
    for (let f = 0; f < this.faceCount; f++) this.groupFaces[this.faceGroup[f]].push(f);
    // mesh vertices used by each group
    this.groupVertices = this.groups.map((_, g) => {
      const s = new Set();
      for (const f of this.groupFaces[g]) for (let k = 0; k < 4; k++) { const v = this.faceV[f * 4 + k]; if (v !== 0xffff) s.add(v); }
      return Uint32Array.from([...s].sort((a, b) => a - b));
    });
  }

  /**
   * Registers an extra expression unit (e.g. a one-sided mouth unit derived by a module).
   * sparse = {idx:Uint16Array|Uint32Array, val:Int16Array|Float32Array (xyz per idx), scale}
   */
  addExpressionUnit(name, sparse) {
    this.expressions[name] = sparse;
    if (!this.expressionUnits.includes(name)) this.expressionUnits.push(name);
    this._exprRegion = null;
    this.expressionVersion = (this.expressionVersion || 0) + 1;
  }

  /**
   * Faces that get vertex normals: every group except the unused MakeHuman
   * proxy helpers (tights, skirt, hair), plus a vertex -> faces table (CSR).
   * Built on first use.
   */
  get normalTopology() {
    if (this._normTopo) return this._normTopo;
    const skip = new Set(['tights', 'skirt', 'hair'].map((n) => this.groups.indexOf(n)).filter((g) => g >= 0));
    const faces = [];
    for (let f = 0; f < this.faceCount; f++) if (!skip.has(this.faceGroup[f])) faces.push(f);
    const NV = this.vertexCount, F = this.faceV;
    const off = new Uint32Array(NV + 1);
    for (const f of faces) for (let k = 0; k < 4; k++) { const v = F[f * 4 + k]; if (v !== 0xffff) off[v + 1]++; }
    for (let v = 0; v < NV; v++) off[v + 1] += off[v];
    const fill = off.slice(0, NV), list = new Uint32Array(off[NV]);
    for (const f of faces) for (let k = 0; k < 4; k++) { const v = F[f * 4 + k]; if (v !== 0xffff) list[fill[v]++] = f; }
    this._normTopo = { faces: Uint32Array.from(faces), vfOff: off, vfList: list };
    return this._normTopo;
  }

  /**
   * What an expression change can touch (union of every expression unit):
   * verts (moved vertices), faces (normal faces using them), nverts (vertices
   * whose normal changes), rranges ([start, count] runs of render vertices to
   * upload). Rebuilt when units are added (expressionVersion).
   */
  get expressionRegion() {
    if (this._exprRegion) return this._exprRegion;
    const NV = this.vertexCount, F = this.faceV, topo = this.normalTopology;
    const moved = new Uint8Array(NV);
    for (const name of this.expressionUnits) { const d = this.expressions[name]; if (d?.idx) for (let k = 0; k < d.idx.length; k++) moved[d.idx[k]] = 1; }
    const faces = [], touched = new Uint8Array(NV);
    for (const f of topo.faces) {
      let hit = false;
      for (let k = 0; k < 4; k++) { const v = F[f * 4 + k]; if (v !== 0xffff && moved[v]) { hit = true; break; } }
      if (!hit) continue;
      faces.push(f);
      for (let k = 0; k < 4; k++) { const v = F[f * 4 + k]; if (v !== 0xffff) touched[v] = 1; }
    }
    const verts = [], nverts = [];
    for (let v = 0; v < NV; v++) { if (moved[v]) verts.push(v); if (touched[v]) nverts.push(v); }
    // render vertices to upload, as runs (small gaps merged)
    const rranges = [];
    let start = -1, last = -2;
    for (let r = 0; r < this.renderVertexCount; r++) {
      const v = this.rv2v[r];
      if (!moved[v] && !touched[v]) continue;
      if (start < 0 || r - last > 24) { if (start >= 0) rranges.push(start, last - start + 1); start = r; }
      last = r;
    }
    if (start >= 0) rranges.push(start, last - start + 1);
    this._exprRegion = { verts: Uint32Array.from(verts), faces: Uint32Array.from(faces), nverts: Uint32Array.from(nverts), rranges, version: this.expressionVersion || 0 };
    return this._exprRegion;
  }

  _sparse(ref) {
    if (ref.enc) return new PackedDelta(this.view(ref.enc), ref.count, ref.idxBytes, this.meta.quantization);
    return { idx: this.view(ref.idx), val: this.view(ref.val), count: ref.count, scale: this.meta.quantization };
  }

  /** Float32 array from a Float32 ref or a 16-bit normalized one. */
  _float(ref) {
    const a = this.view(ref);
    if (!ref.normalized) return a;
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i] / 65535;
    return out;
  }

  /** Skin weights (4 per vertex) as Float32, renormalized to sum 1 after 16-bit storage. */
  _weights(ref) {
    const a = this.view(ref);
    if (!ref.normalized) return a;
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 4) {
      const s = a[i] + a[i + 1] + a[i + 2] + a[i + 3];
      if (s) for (let k = 0; k < 4; k++) out[i + k] = a[i + k] / s;
    }
    return out;
  }

  /** Preset rest positions: base mesh + 0.1 mm steps. */
  _positions(ref) {
    const n = ref.count * 3, q = new Int32Array(n), out = new Float32Array(n), B = this.basePositions, sc = this.meta.quantization;
    readVarints(this.view(ref.enc), ref.idxBytes || 0, n, q, true);
    for (let i = 0; i < n; i++) out[i] = B[i] + q[i] * sc;
    return out;
  }

  /** out += w * sparseDelta */
  static addSparse(out, d, w) {
    if (!w) return;
    const s = d.scale * w, idx = d.idx, val = d.val;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k] * 3, j = k * 3;
      out[i] += val[j] * s; out[i + 1] += val[j + 1] * s; out[i + 2] += val[j + 2] * s;
    }
  }

  /**
   * Writes preset positions + slider deltas into out (Float32Array NV*3).
   * (v2 assets: slider deltas skip the unused MakeHuman proxy helpers, groups
   * tights/skirt/hair, which keep the preset shape; everything drawn or read by
   * the app - body, eyes, lashes, teeth, tongue, joints - follows the sliders.)
   */
  evaluateShape(presetId, sliders, out) {
    const p = this.presetById.get(presetId) || this.presets[0];
    out.set(p.positions);
    for (const s of this.sliders) {
      const v = sliders[s.id] || 0;
      if (!v) continue;
      const d = s.kind === 'macro' ? p.deltas[s.id] : this.targetDeltas[s.id];
      if (!d) continue;
      HumanModel.addSparse(out, v > 0 ? d.pos : d.neg, Math.abs(v));
    }
    return out;
  }
}

export async function loadHumanModel(base = './assets/') {
  const [meta, bin] = await Promise.all([
    fetch(base + 'human.json').then((r) => { if (!r.ok) throw new Error('human.json ' + r.status); return r.json(); }),
    fetch(base + 'human.bin').then((r) => { if (!r.ok) throw new Error('human.bin ' + r.status); return r.arrayBuffer(); }),
  ]);
  return new HumanModel(meta, bin);
}
