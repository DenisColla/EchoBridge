#!/usr/bin/env node
/**
 * Copies the shared engine (../src/core) into ./core so the mobile project is
 * self-contained. Run after every change to the web project's engine.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, '..', '..', 'src', 'core')
const target = join(here, '..', 'core')

if (!existsSync(source)) {
  console.log(`Motore sorgente non trovato in ${source}: uso la copia già presente in ${target}.`)
  process.exit(0)
}
mkdirSync(target, { recursive: true })
for (const entry of readdirSync(target)) rmSync(join(target, entry), { recursive: true, force: true })
cpSync(source, target, { recursive: true })
console.log(`Motore copiato: ${readdirSync(target).length} file in mobile/core`)
