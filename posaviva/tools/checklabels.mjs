import fs from 'fs';
const { TOPICS } = await import(new URL('../web/src/io/guideData.js', import.meta.url).href);
const labels = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
const hay = labels.map(norm).join('\n');
const missing = new Map();
for (const t of TOPICS) {
  if (t.status === 'planned') continue;
  const lines = [...t.steps, ...(t.tips || [])].map((x) => (typeof x === 'string' ? x : x.t));
  for (const l of lines) for (const m of l.matchAll(/\*\*([^*]+)\*\*/g)) {
    const lab = norm(m[1]);
    if (!hay.includes(lab)) missing.set(m[1], (missing.get(m[1]) || []).concat(t.id));
  }
}
for (const [k, v] of missing) console.log(JSON.stringify(k), '->', [...new Set(v)].join(','));
console.log('missing', missing.size);
