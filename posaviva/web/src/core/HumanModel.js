// Shared, immutable human data (topology, presets, slider deltas, skeleton
// definition, skin weights, eye proxy). One instance for the whole app.
const CTORS = { Float32Array, Uint16Array, Int16Array, Uint8Array, Uint32Array, Int32Array };

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
    this.rvUV = view(t.rvUV);
    this.renderVertexCount = this.rv2v.length;
    this.basePositions = view(t.basePositions);

    this.presets = meta.presets.map((p) => ({
      id: p.id, label: p.label, sex: p.sex, params: p.params,
      positions: view(p.positions),
      deltas: Object.fromEntries(Object.entries(p.deltas).map(([k, d]) => [k, { pos: this._sparse(d.pos), neg: this._sparse(d.neg) }])),
    }));
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
    this.skinWeight = view(meta.skin.weight); // Float32 x4 per mesh vertex

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

  _sparse(ref) {
    return { idx: this.view(ref.idx), val: this.view(ref.val), count: ref.count, scale: this.meta.quantization };
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

  /** Writes preset positions + slider deltas into out (Float32Array NV*3). */
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
