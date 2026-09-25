import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const out = 'dist';

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await Promise.all([
  cp('src/manifest.json', `${out}/manifest.json`),
  cp('src/options/options.html', `${out}/options.html`),
]);

const common = { bundle: true, target: 'chrome116', logLevel: 'info', legalComments: 'none', minify: !watch };
const builds = [
  { ...common, entryPoints: ['src/background.js'], outfile: `${out}/background.js`, format: 'esm' },
  { ...common, entryPoints: ['src/content/main.js'], outfile: `${out}/content.js`, format: 'iife' },
  { ...common, entryPoints: ['src/options/options.js'], outfile: `${out}/options.js`, format: 'iife' },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
