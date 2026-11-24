// Binary layout of a baked animal (one .bin per species). The manifest entry
// (assets/animals/animals.json) describes the sections:
//   pos    Uint16 x3  quantized in [quant.min, quant.min + quant.size]
//   nrm    Int8   x3  normalized
//   chart  Uint8  x1  box-mapping axis of the fur normal map (0 = x, 1 = y, 2 = z)
//   mask   Uint8  x4  coat masks: under, pattern, points, extra
//   extra  Uint8  x4  region id, region weight, fur shade, ambient occlusion
//   skin   Uint8  x4  bone indices
//   weight Uint8  x4  bone weights (sum 255)
//   uv     Uint16 x2  (optional) 0..1 UVs of the explicit sheets (chart 3: feathers)
//   index  Uint16|Uint32 x3 triangles, sorted by material region (manifest.groups)
// Every section starts on a 4-byte boundary.

export const SECTIONS = [
  ['pos', 'u16', 3], ['nrm', 'i8', 3], ['chart', 'u8', 1], ['mask', 'u8', 4], ['extra', 'u8', 4], ['skin', 'u8', 4], ['weight', 'u8', 4],
];

/** Packs baked arrays; returns {buffer: Uint8Array, layout, quant, indexType}. */
export function pack(b) {
  const nv = b.positions.length / 3;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.positions[i * 3 + k]); mx[k] = Math.max(mx[k], b.positions[i * 3 + k]); }
  const size = mx.map((v, k) => Math.max(1e-6, v - mn[k]));
  const pos = new Uint16Array(nv * 3);
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = Math.round(((b.positions[i * 3 + k] - mn[k]) / size[k]) * 65535);
  const nrm = new Int8Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) nrm[i] = Math.max(-127, Math.min(127, Math.round(b.normals[i] * 127)));
  const big = nv > 65535;
  const index = big ? Uint32Array.from(b.indices) : Uint16Array.from(b.indices);
  const parts = { pos, nrm, chart: b.chart, mask: b.masks, extra: b.extra, skin: b.skinIndex, weight: b.skinWeight };
  if (b.uv) { const uv = new Uint16Array(nv * 2); for (let i = 0; i < nv * 2; i++) uv[i] = Math.round(Math.max(0, Math.min(1, b.uv[i])) * 65535); parts.uv = uv; }
  parts.index = index;
  const layout = {};
  let off = 0;
  const chunks = [];
  for (const [name, arr] of Object.entries(parts)) {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    layout[name] = [off, arr.length];
    chunks.push([off, bytes]);
    off += bytes.byteLength;
    off = (off + 3) & ~3;
  }
  const buffer = new Uint8Array(off);
  for (const [o, bytes] of chunks) buffer.set(bytes, o);
  return { buffer, layout, quant: { min: mn, size }, indexType: big ? 'u32' : 'u16', verts: nv, tris: b.indices.length / 3 };
}
