#!/usr/bin/env node
// Builds the poseable animals: species descriptions (web/src/animals/species)
// -> signed distance field -> surface nets mesh -> quadric decimation ->
// skin weights / coat masks / AO -> web/public/assets/animals/<id>.bin and
// the manifest animals.json. Everything is original procedural geometry (no
// third-party models), so the output is free to ship.
//
//   node tools/build-animals.mjs                 all species
//   node tools/build-animals.mjs cane_medio gatto  a subset (manifest merged)
//   --preview <dir>   also write PNG previews (rest pose + test poses)
//   --res <n>         grid cells along the longest side (default 300)
//   --dry             do not write assets
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Field, V } from '../web/src/animals/engine/sdf.js';
import { meshField } from '../web/src/animals/engine/mesher.js';
import { simplify } from '../web/src/animals/engine/simplify.js';
import { bake } from '../web/src/animals/engine/bake.js';
import { pack } from '../web/src/animals/engine/format.js';
import { renderViews, writePNG, poseBones, skin, eulerDegToQuat } from '../web/src/animals/engine/raster.js';
import { SPECIES } from '../web/src/animals/species/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '../web/public/assets/animals');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const previewDir = opt('--preview', null);
const RES = +opt('--res', 380);
const dry = flag('--dry');
const posesArg = opt('--poses', null);
const ids = args.length ? args : SPECIES.map((s) => s.id);
const VERSION = 1;

fs.mkdirSync(OUT, { recursive: true });
if (previewDir) fs.mkdirSync(previewDir, { recursive: true });
const manifestFile = path.join(OUT, 'animals.json');

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r4a = (a) => a.map(r4);

for (const id of ids) {
  const sp = SPECIES.find((s) => s.id === id);
  if (!sp) { console.error('unknown species', id); continue; }
  const t0 = Date.now();
  const { B, lm } = sp.build();
  B.finalize();
  const field = new Field(B.prims);
  const size = field.max.map((v, k) => v - field.min[k]);
  const h = Math.max(...size) / (sp.res || RES);
  const mesh = meshField(field, h);
  // keep more triangles where comic artists look first: head, ears, feet
  const focus = [];
  const hb = B.bones.find((b) => b.name === 'head');
  if (hb) focus.push({ c: V.lerp(hb.head, hb.tail, 0.45), r: Math.max(V.dist(hb.head, hb.tail) * 0.95, lm.H * 0.12), w: 5 });
  for (const b of B.bones) if (/^(fingers|toes)\.[LR]$/.test(b.name)) focus.push({ c: b.head, r: lm.H * 0.09, w: 2 });
  const nvm = mesh.positions.length / 3, weights = new Float32Array(nvm).fill(1);
  for (let i = 0; i < nvm; i++) {
    const p = [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
    for (const f of focus) { const d = V.dist(p, f.c); if (d < f.r) weights[i] = Math.max(weights[i], 1 + (f.w - 1) * Math.min(1, (f.r - d) / (f.r * 0.3))); }
  }
  const simp = simplify(mesh.positions, mesh.indices, sp.tris || 22000, { weights });
  const baked = bake(simp, field, B.bones, {
    blend: sp.blend ?? lm.H * 0.08, h, aoScale: lm.H * 0.022,
    coat: (v) => {
      const m = sp.coat(v, lm);
      if (sp.skinFn) { const w = sp.skinFn(v, lm); if (w > (m.regionW || 0)) { m.region = 'skin'; m.regionW = w; } }
      return m;
    },
  });
  // ---- origin on the floor at the footprint centre
  const feet = B.bones.filter((b) => /^(fingers|toes)\.[LR]$/.test(b.name));
  let cx = 0, cz = 0;
  for (const b of feet) { cx += b.head[0]; cz += b.head[2]; }
  cx /= feet.length || 1; cz /= feet.length || 1;
  let minY = Infinity;
  for (let i = 1; i < baked.positions.length; i += 3) minY = Math.min(minY, baked.positions[i]);
  const T = [-cx, -minY, -cz];
  const mv = (p) => [p[0] + T[0], p[1] + T[1], p[2] + T[2]];
  for (let i = 0; i < baked.positions.length; i += 3) { baked.positions[i] += T[0]; baked.positions[i + 1] += T[1]; baked.positions[i + 2] += T[2]; }
  for (const b of B.bones) { b.head = mv(b.head); b.tail = mv(b.tail); }
  const eyes = B.eyes.map((e) => ({ bone: e.bone, pos: r4a(mv(e.pos)), r: r4(e.r), dir: r4a(e.dir), side: e.side }));
  const teeth = B.teeth.map((t) => ({ bone: t.bone, base: r4a(mv(t.base)), tip: r4a(mv(t.tip)), r: r4(t.r) }));
  let mx = [-Infinity, -Infinity, -Infinity], mn = [Infinity, Infinity, Infinity];
  for (let i = 0; i < baked.positions.length; i += 3) for (let k = 0; k < 3; k++) { mx[k] = Math.max(mx[k], baked.positions[i + k]); mn[k] = Math.min(mn[k], baked.positions[i + k]); }

  const packed = pack(baked);
  const file = `${id}.bin`;
  if (!dry) fs.writeFileSync(path.join(OUT, file), packed.buffer);
  const entry = {
    id, label: sp.label, sub: sp.sub || '', group: sp.group, family: sp.family, gait: sp.gait, file, bytes: packed.buffer.byteLength,
    verts: packed.verts, tris: packed.tris, layout: packed.layout, quant: { min: r4a(packed.quant.min), size: packed.quant.size.map((v) => Math.round(v * 1e5) / 1e5) }, indexType: packed.indexType,
    groups: baked.groups,
    bones: B.bones.map((b) => ({ name: b.name, parent: b.parent, head: r4a(b.head), tail: r4a(b.tail) })),
    eyes, teeth,
    bounds: { min: r4a(mn), max: r4a(mx) },
    height: r4(lm.H), fur: sp.fur, iris: sp.iris || '#4a3020', pupil: sp.pupil || 'round', teethColor: sp.teethColor || '#e9e2d0',
    palettes: sp.palettes, limits: sp.limits || null, poses: sp.poses || null, labels: sp.labels || null,
  };
  if (!dry) updateManifest(entry);
  console.log(`${id}: grid ${mesh.stats.grid.join('x')} h=${(h * 1000).toFixed(1)}mm, surface nets ${mesh.stats.tris} tris (${mesh.stats.ms} ms), -> ${packed.tris} tris / ${packed.verts} verts, ${(packed.buffer.byteLength / 1024).toFixed(0)} KB, diffusion ${baked.stats.diffusionIters} it, ${Date.now() - t0} ms`);

  if (previewDir) {
    const pal = sp.palettes[0].colors;
    const views = [{ yaw: 90, pitch: 5 }, { yaw: 35, pitch: 15 }, { yaw: 0, pitch: 5 }, { yaw: 180, pitch: 30 }];
    const spheres = eyes.map((e) => ({ c: e.pos, r: e.r, color: [40, 28, 20] }));
    const rest = renderViews(baked, pal, { P: baked.positions, N: baked.normals, views, tw: 520, th: 400, spheres });
    writePNG(path.join(previewDir, `${id}.png`), rest.W, rest.H, rest.img);
    // head close-up
    const head = B.bones.find((b) => b.name === 'head');
    if (head) {
      const hv = renderViews(baked, pal, { P: baked.positions, N: baked.normals, views: [{ yaw: 90, pitch: 0 }, { yaw: 30, pitch: 10 }], tw: 420, th: 420, fit: lm.HL * 0.8 || lm.H * 0.3, center: head.tail, spheres });
      writePNG(path.join(previewDir, `${id}-head.png`), hv.W, hv.H, hv.img);
    }
    if (posesArg) {
      const poses = JSON.parse(fs.readFileSync(posesArg, 'utf8'));
      for (const [pname, pose] of Object.entries(poses)) {
        const q = {};
        for (const [bn, e] of Object.entries(pose)) q[bn] = eulerDegToQuat(e);
        const posed = poseBones(B.bones, q);
        const sk = skin(baked, B.bones, posed);
        const img = renderViews(baked, pal, { P: sk.P, N: sk.N, views: [{ yaw: 90, pitch: 5 }, { yaw: 35, pitch: 20 }], tw: 520, th: 400 });
        writePNG(path.join(previewDir, `${id}-pose-${pname}.png`), img.W, img.H, img.img);
      }
    }
  }
}

/** Read-modify-write of the manifest under a lock file (several builds may run in parallel). */
function updateManifest(entry) {
  const lock = manifestFile + '.lock';
  for (let tries = 0; ; tries++) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch {
      if (tries > 600) { try { fs.unlinkSync(lock); } catch { /* stale */ } }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    let man = { version: VERSION, species: [] };
    if (fs.existsSync(manifestFile)) { try { man = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { /* rebuild */ } }
    const i = man.species.findIndex((s) => s.id === entry.id);
    if (i >= 0) man.species[i] = entry; else man.species.push(entry);
    man.version = VERSION;
    man.species = man.species.filter((s) => SPECIES.some((x) => x.id === s.id));
    man.species.sort((a, b) => SPECIES.findIndex((s) => s.id === a.id) - SPECIES.findIndex((s) => s.id === b.id));
    fs.writeFileSync(manifestFile, JSON.stringify(man));
  } finally { fs.unlinkSync(lock); }
}
