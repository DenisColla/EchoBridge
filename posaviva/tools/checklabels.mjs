// Guide labels vs the running app: every **Etichetta** written in io/guideData.js must appear
// among the labels collected by tools/collect.js.
//   node tools/checklabels.mjs <labels.json>
// When collect.js also wrote <labels>.topics.json (the topics as the running app shows them,
// each when() resolved), only those lines are checked: steps written for a configuration that
// is not running (e.g. without the projects module) are skipped instead of reported.
import fs from 'fs';
const { TOPICS } = await import(new URL('../web/src/io/guideData.js', import.meta.url).href);
const file = process.argv[2];
const labels = JSON.parse(fs.readFileSync(file, 'utf8'));
const topicsFile = file.replace(/(\.json)?$/, '.topics.json');
const resolved = fs.existsSync(topicsFile) ? JSON.parse(fs.readFileSync(topicsFile, 'utf8')) : null;
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
const hay = labels.map(norm).join('\n');
const missing = new Map();
const topics = resolved || TOPICS.filter((t) => t.status !== 'planned').map((t) => ({ id: t.id, lines: [...t.steps, ...(t.tips || [])].map((x) => (typeof x === 'string' ? x : x.t)) }));
for (const t of topics) {
  for (const l of t.lines) for (const m of l.matchAll(/\*\*([^*]+)\*\*/g)) {
    const lab = norm(m[1]);
    if (!hay.includes(lab)) missing.set(m[1], (missing.get(m[1]) || []).concat(t.id));
  }
}
if (resolved) {
  const shown = new Set(resolved.map((t) => t.id));
  const hidden = TOPICS.filter((t) => t.status !== 'planned' && !shown.has(t.id)).map((t) => t.id);
  console.log(`topics checked: ${resolved.length} (as shown by the running app)${hidden.length ? `; not shown there: ${hidden.join(', ')}` : ''}`);
}
for (const [k, v] of missing) console.log(JSON.stringify(k), '->', [...new Set(v)].join(','));
console.log('missing', missing.size);
