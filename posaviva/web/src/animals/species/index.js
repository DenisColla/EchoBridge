// Registry of the species built by tools/build-animals.mjs (build time only:
// the runtime reads assets/animals/animals.json). Order = catalog order.
import { CARNIVORES } from './carnivores.js';
import { UNGULATES } from './ungulates.js';
import { OTHERS } from './others.js';
import { PRIMATES } from './primates.js';

export const SPECIES = [...CARNIVORES, ...UNGULATES, ...OTHERS, ...PRIMATES];
