#!/usr/bin/env node
// Build-time importer of the realistic CC0 exterior models (rocks, logs, trees,
// street pieces) from Poly Haven (https://polyhaven.com) for the "Esterni" tool.
// Not bundled with the app (nothing imports this file).
//
//   node posaviva/web/src/city/build/build-city-assets.mjs [--only id1,id2] [--force] [--jobs 4] [--cache <dir>]
//
// Outputs (ready files, nothing is fetched at runtime):
//   web/public/assets/city/models/<id>.glb   meshopt + quantized geometry, WebP textures
//                                            (AO baked into the base color), origin on
//                                            the floor at the footprint center
//   web/public/assets/city/thumbs/<id>.webp  128 px catalog thumbnail
//   web/public/assets/city/CREDITS.txt       authors + CC0 license
//   web/src/city/phCity.js                   generated catalog entries
//
// Requirements: Node 18+ (fetch), Python 3 + Pillow, npx (@gltf-transform/cli).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../..');
const OUT = path.join(WEB, 'public/assets/city');
const GEN = path.join(WEB, 'src/city/phCity.js');
const CLI = ['-y', '-p', '@gltf-transform/cli@4.2.1', 'gltf-transform'];

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const FORCE = args.includes('--force');
const ONLY = opt('--only', '') ? new Set(opt('--only', '').split(',')) : null;
const JOBS = +opt('--jobs', 4);
const CACHE = path.resolve(opt('--cache', path.join(os.tmpdir(), 'posaviva-city-cache')));

// [polyhavenId, Italian label, sub-category, Italian tags, options]
// options: tex (base color size), ratio (fraction of vertices kept), err (simplify error), yaw (deg, front -> +Z)
const L = [
  // ---- rocce
  ['boulder_01', 'Masso', 'rocce', 'roccia pietra sasso montagna', { ratio: 0.1, err: 0.02, tex: 512 }],
  ['namaqualand_boulder_02', 'Gruppo di rocce', 'rocce', 'rocce pietre deserto', { ratio: 0.08, tex: 1024 }],
  ['namaqualand_boulder_03', 'Masso squadrato', 'rocce', 'roccia pietra', { ratio: 0.12, tex: 1024 }],
  ['namaqualand_boulder_04', 'Masso arrotondato', 'rocce', 'roccia pietra', { ratio: 0.12, tex: 1024 }],
  ['namaqualand_boulder_05', 'Roccia', 'rocce', 'roccia pietra granito', { ratio: 0.12, tex: 1024 }],
  ['namaqualand_boulder_06', 'Roccia appuntita', 'rocce', 'roccia pietra', { ratio: 0.1, tex: 512 }],
  ['rock_07', 'Pietra', 'rocce', 'sasso ciottolo', { ratio: 0.4, tex: 256 }],
  ['rock_face_01', 'Parete rocciosa', 'rocce', 'scogliera falesia montagna', { ratio: 0.6, tex: 1024 }],
  ['rock_face_02', 'Sperone di roccia', 'rocce', 'scogliera montagna', { ratio: 0.5, tex: 1024 }],
  ['namaqualand_cliff_01', 'Parete di massi', 'rocce', 'scogliera rocce', { ratio: 0.12, tex: 1024 }],
  ['mountainside', 'Pendio di montagna', 'rocce', 'montagna versante roccia', { ratio: 0.1, tex: 1024 }],
  // ---- legno
  ['tree_stump_01', 'Ceppo', 'tronchi', 'ceppo albero tagliato bosco', { ratio: 0.3, tex: 512 }],
  ['tree_stump_02', 'Ceppo con muschio', 'tronchi', 'ceppo albero muschio bosco', { ratio: 0.25, tex: 512 }],
  ['dead_tree_trunk', 'Tronco caduto', 'tronchi', 'tronco legno bosco', { ratio: 0.12, tex: 1024 }],
  ['dead_tree_trunk_02', 'Tronco secco', 'tronchi', 'tronco albero morto legno', { ratio: 0.1, tex: 1024 }],
  // ---- alberi
  ['quiver_tree_01', 'Albero faretra', 'alberi', 'aloe deserto africa esotico', { ratio: 0.12, tex: 512 }],
  ['quiver_tree_02', 'Albero faretra basso', 'alberi', 'aloe deserto africa esotico', { ratio: 0.12, tex: 512 }],
  // ---- strada e arredo
  ['street_lamp_01', 'Lampione a lanterna', 'arredo', 'lampione lampada lanterna vittoriano', { ratio: 0.5, tex: 512 }],
  ['water_manhole_cover', 'Tombino in ghisa', 'strade', 'tombino chiusino fogna', { tex: 512 }],
  ['concrete_road_barrier', 'Blocco di cemento', 'arredo', 'barriera new jersey cantiere', { ratio: 0.2, tex: 512 }],
  ['concrete_road_barrier_02', 'Blocco con ganci', 'arredo', 'barriera cemento cantiere', { ratio: 0.3, tex: 512 }],
  ['utility_box_01', 'Armadio elettrico', 'arredo', 'centralina quadro elettrico', { tex: 512 }],
  ['utility_box_02', 'Armadio elettrico verde', 'arredo', 'centralina quadro elettrico', { tex: 512 }],
  ['wooden_picnic_table', 'Tavolo da picnic', 'arredo', 'tavolo panca parco legno', { tex: 512 }],
  ['old_tyre', 'Pneumatico', 'arredo', 'gomma ruota copertone', { tex: 256 }],
  ['covered_car', 'Auto coperta da telo', 'veicoli', 'macchina telo garage', { tex: 512 }],
];

const log = (...a) => console.log('[city]', ...a);
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const UA = { 'User-Agent': 'posaviva-build-city/1.0' };

async function fetchJSON(url, file) {
  if (file && exists(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      const j = await r.json();
      if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(j)); }
      return j;
    } catch (e) { if (attempt >= 3) throw e; await new Promise((res) => setTimeout(res, 1000 * (attempt + 1))); }
  }
}

async function download(url, file) {
  if (exists(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      fs.writeFileSync(file + '.part', Buffer.from(await r.arrayBuffer()));
      fs.renameSync(file + '.part', file);
      return;
    } catch (e) { if (attempt >= 3) throw e; await new Promise((res) => setTimeout(res, 1000 * (attempt + 1))); }
  }
}

// Pillow: bake AO into the base color, resize, mean roughness / metalness of the ARM map
const PY_TEX = String.raw`
import json, sys
from PIL import Image, ImageChops
jobs = json.load(open(sys.argv[1]))
out = []
def fit(im, size):
    w, h = im.size
    s = min(1.0, size / max(w, h))
    if s < 1.0:
        im = im.resize((max(4, round(w * s)), max(4, round(h * s))), Image.LANCZOS)
    return im
def mean(ch):
    h = ch.histogram(); n = sum(h)
    return sum(i * c for i, c in enumerate(h)) / max(1, n) / 255.0
for j in jobs:
    r = {'rough': None, 'metal': None}
    arm = Image.open(j['arm']).convert('RGB') if j.get('arm') else None
    occ = Image.open(j['occ']).convert('RGB') if j.get('occ') else None
    if arm is not None:
        _, g, b = arm.split(); r['rough'] = mean(g); r['metal'] = mean(b)
    if j.get('base'):
        base = Image.open(j['base'])
        alpha = base.getchannel('A') if base.mode in ('RGBA', 'LA') else None
        rgb = base.convert('RGB')
        src = occ if occ is not None else arm
        if src is not None:
            ao = src.split()[0].resize(rgb.size, Image.BILINEAR).point(lambda v: int(255 - (255 - v) * 0.7))
            rgb = ImageChops.multiply(rgb, Image.merge('RGB', (ao, ao, ao)))
        if alpha is not None: rgb.putalpha(alpha)
        fit(rgb, j['size']).save(j['baseOut'])
    if j.get('normal'):
        fit(Image.open(j['normal']).convert('RGB'), j['nsize']).save(j['normalOut'])
    out.append(r)
json.dump(out, open(sys.argv[2], 'w'))
`;
const PY_THUMB = String.raw`
import sys
from PIL import Image
src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGBA')
bb = im.getbbox()
if bb: im = im.crop(bb)
w, h = im.size
s = (size - 6) / max(w, h)
im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
c = Image.new('RGBA', (size, size), (0, 0, 0, 0))
c.paste(im, ((size - im.size[0]) // 2, (size - im.size[1]) // 2), im)
c.save(dst, 'WEBP', quality=82, method=6)
`;
function script(name, text) {
  const f = path.join(CACHE, name);
  fs.mkdirSync(CACHE, { recursive: true });
  if (!exists(f) || fs.readFileSync(f, 'utf8') !== text) fs.writeFileSync(f, text);
  return f;
}

/** Bounds + triangle count of the default scene of a GLB (node transforms, quantized accessors). */
function glbBounds(file) {
  const buf = fs.readFileSync(file);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const norm = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
  const mul = (a, b) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; };
  const trs = (n) => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = n.scale || [1, 1, 1];
    const [tx, ty, tz] = n.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  let tris = 0;
  const visit = (ni, parent) => {
    const n = json.nodes[ni];
    const m = mul(parent, trs(n));
    if (n.mesh !== undefined) {
      for (const prim of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        const k = acc.normalized ? norm[acc.componentType] || 1 : 1;
        const a = acc.min.map((v) => v / k), b = acc.max.map((v) => v / k);
        for (let c = 0; c < 8; c++) {
          const p = [c & 1 ? b[0] : a[0], c & 2 ? b[1] : a[1], c & 4 ? b[2] : a[2]];
          for (let r = 0; r < 3; r++) {
            const v = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
            min[r] = Math.min(min[r], v); max[r] = Math.max(max[r], v);
          }
        }
        tris += prim.indices !== undefined ? json.accessors[prim.indices].count / 3 : acc.count / 3;
      }
    }
    for (const c of n.children || []) visit(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const ni of json.scenes[json.scene || 0].nodes) visit(ni, I);
  return { min, max, tris: Math.round(tris) };
}

async function processModel(entry) {
  const [id, , , , o = {}] = entry;
  const dir = path.join(CACHE, id);
  const glbOut = path.join(OUT, 'models', `${id}.glb`);
  const thumbOut = path.join(OUT, 'thumbs', `${id}.webp`);
  fs.mkdirSync(path.dirname(glbOut), { recursive: true });
  fs.mkdirSync(path.dirname(thumbOut), { recursive: true });
  if (!exists(thumbOut) || FORCE) {
    const png = path.join(dir, 'thumb.png');
    await download(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`, png);
    await run('python3', ['-I', script('thumb.py', PY_THUMB), png, thumbOut, '128']);
  }
  if (exists(glbOut) && !FORCE) return { ...glbBounds(glbOut), bytes: fs.statSync(glbOut).size };

  const files = await fetchJSON(`https://api.polyhaven.com/files/${id}`, path.join(dir, 'files.json'));
  const g = files.gltf['1k'] || files.gltf['2k'];
  if (!g) throw new Error(`no glTF for ${id}`);
  const src = path.join(dir, 'src');
  const gltfFile = path.join(src, `${id}.gltf`);
  await download(g.gltf.url, gltfFile);
  await Promise.all(Object.entries(g.gltf.include).map(([rel, f]) => download(f.url, path.join(src, rel))));

  const gltf = JSON.parse(fs.readFileSync(gltfFile, 'utf8'));
  const size = o.tex || 512, nsize = Math.min(512, size);
  const stage = path.join(dir, 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'tex'), { recursive: true });
  const imgPath = (ti) => { const t = gltf.textures?.[ti]; const img = t && gltf.images[t.source]; return img?.uri ? path.join(src, decodeURIComponent(img.uri)) : null; };
  const jobs = [], newImages = [], newTextures = [];
  const addImage = (file) => { newImages.push({ uri: `tex/${path.basename(file)}`, mimeType: 'image/png' }); return newImages.length - 1; };
  const addTexture = (img) => { newTextures.push({ source: img, sampler: 0 }); return newTextures.length - 1; };
  for (const [mi, mat] of (gltf.materials || []).entries()) {
    const pbr = mat.pbrMetallicRoughness || (mat.pbrMetallicRoughness = {});
    const base = pbr.baseColorTexture ? imgPath(pbr.baseColorTexture.index) : null;
    const normal = mat.normalTexture ? imgPath(mat.normalTexture.index) : null;
    const arm = pbr.metallicRoughnessTexture ? imgPath(pbr.metallicRoughnessTexture.index) : null;
    const occ = mat.occlusionTexture ? imgPath(mat.occlusionTexture.index) : null;
    const job = { mi, arm, occ: occ !== arm ? occ : null, size, nsize };
    if (base) { job.base = base; job.baseOut = path.join(stage, 'tex', `m${mi}_base.png`); }
    if (normal) { job.normal = normal; job.normalOut = path.join(stage, 'tex', `m${mi}_nor.png`); }
    jobs.push(job);
  }
  const jobFile = path.join(dir, 'jobs.json'), resFile = path.join(dir, 'jobs-out.json');
  fs.writeFileSync(jobFile, JSON.stringify(jobs));
  await run('python3', ['-I', script('tex.py', PY_TEX), jobFile, resFile], { maxBuffer: 1 << 24 });
  const res = JSON.parse(fs.readFileSync(resFile, 'utf8'));
  for (const [k, job] of jobs.entries()) {
    const mat = gltf.materials[job.mi], pbr = mat.pbrMetallicRoughness, r = res[k];
    if (job.base) pbr.baseColorTexture = { index: addTexture(addImage(job.baseOut)) }; else delete pbr.baseColorTexture;
    if (job.normal) mat.normalTexture = { index: addTexture(addImage(job.normalOut)), scale: mat.normalTexture?.scale ?? 1 }; else delete mat.normalTexture;
    if (r.rough !== null) pbr.roughnessFactor = +(Math.min(1, (pbr.roughnessFactor ?? 1) * r.rough)).toFixed(3);
    if (r.metal !== null) pbr.metallicFactor = +(Math.min(1, (pbr.metallicFactor ?? 1) * r.metal)).toFixed(3);
    delete pbr.metallicRoughnessTexture; delete mat.occlusionTexture; delete mat.emissiveTexture; delete mat.extensions;
  }
  for (const k of ['extensionsUsed', 'extensionsRequired']) if (gltf[k]) gltf[k] = gltf[k].filter((x) => !x.startsWith('KHR_materials_'));
  gltf.images = newImages; gltf.textures = newTextures;
  gltf.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
  for (const b of gltf.buffers || []) {
    if (!b.uri || b.uri.startsWith('data:')) continue;
    const from = path.join(src, decodeURIComponent(b.uri));
    fs.copyFileSync(from, path.join(stage, path.basename(from)));
    b.uri = path.basename(from);
  }
  if (o.yaw) {
    const a = (o.yaw * Math.PI) / 360, sc = gltf.scenes[gltf.scene || 0];
    gltf.nodes.push({ name: 'yaw', rotation: [0, Math.sin(a), 0, Math.cos(a)], children: sc.nodes });
    sc.nodes = [gltf.nodes.length - 1];
  }
  const staged = path.join(stage, `${id}.gltf`);
  fs.writeFileSync(staged, JSON.stringify(gltf));
  const centered = path.join(dir, 'centered.glb');
  await run('npx', [...CLI, 'center', staged, centered, '--pivot', 'below'], { maxBuffer: 1 << 24 });
  const optArgs = ['optimize', centered, glbOut, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(size),
    '--instance', 'false', '--palette', 'false', '--simplify-error', '0.0004'];
  if (o.ratio) optArgs.push('--simplify-ratio', String(o.ratio), '--simplify-error', String(o.err || 0.004));
  await run('npx', [...CLI, ...optArgs], { maxBuffer: 1 << 24 });
  return { ...glbBounds(glbOut), bytes: fs.statSync(glbOut).size };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  log('cache:', CACHE);
  const index = await fetchJSON('https://api.polyhaven.com/assets?t=models', path.join(CACHE, 'assets.json'));
  const todo = L.filter((e) => (!ONLY || ONLY.has(e[0])) && index[e[0]]);
  let done = 0;
  await pool(todo, JOBS, async (e) => {
    try { const r = await processModel(e); log(`${++done}/${todo.length} ${e[0]} ${(r.bytes / 1024).toFixed(0)} KB, ${r.tris} tris`); }
    catch (err) { log(`FAILED ${e[0]}: ${String(err.message).split('\n')[0]}`); }
  });
  const entries = [];
  let total = 0;
  for (const [id, label, sub, tags] of L) {
    const glb = path.join(OUT, 'models', `${id}.glb`), th = path.join(OUT, 'thumbs', `${id}.webp`);
    if (!index[id] || !exists(glb)) continue;
    const r = glbBounds(glb);
    total += fs.statSync(glb).size + (exists(th) ? fs.statSync(th).size : 0);
    entries.push({ id: `phc_${id}`, ph: id, label, sub, tags, size: [0, 1, 2].map((k) => +(r.max[k] - r.min[k]).toFixed(3)), tris: r.tris });
  }
  fs.writeFileSync(GEN, '// GENERATED by city/build/build-city-assets.mjs — do not edit by hand.\n'
    + '// Realistic CC0 models from Poly Haven (https://polyhaven.com), see public/assets/city/CREDITS.txt.\n'
    + 'export const PH_CITY = [\n' + entries.map((x) => '  ' + JSON.stringify(x) + ',').join('\n') + '\n];\n');
  const credits = ['PosaViva — Esterni (realistic models)', '',
    'The 3D models in models/ and their thumbnails in thumbs/ come from Poly Haven (https://polyhaven.com)',
    'and are licensed CC0 1.0 Universal (public domain): https://creativecommons.org/publicdomain/zero/1.0/',
    'They were converted (merged meshes, simplified geometry, smaller textures with baked ambient occlusion).', ''];
  for (const x of entries) credits.push(`${x.label} — "${index[x.ph].name}" by ${Object.keys(index[x.ph].authors || {}).join(', ') || 'Poly Haven'} — https://polyhaven.com/a/${x.ph}`);
  fs.writeFileSync(path.join(OUT, 'CREDITS.txt'), credits.join('\n') + '\n');
  log(`${entries.length} models, ${(total / 1048576).toFixed(2)} MB`);
}
main().catch((e) => { console.error(e); process.exit(1); });
