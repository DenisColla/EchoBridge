// Registry of the species built by tools/build-animals.mjs (build time only:
// the runtime reads assets/animals/animals.json). Order = catalog order.
import { CARNIVORES } from './carnivores.js';
import { UNGULATES } from './ungulates.js';
import { OTHERS } from './others.js';
import { PRIMATES } from './primates.js';
import { BIRDS } from './birds.js';
import { MARINE } from './marine.js';
import { SERPENTS } from './serpent.js';
import { REPTILES } from './reptiles.js';
import { FANTASY } from './fantasy.js';

export const SPECIES = [...CARNIVORES, ...UNGULATES, ...OTHERS, ...PRIMATES, ...BIRDS, ...MARINE, ...SERPENTS, ...REPTILES, ...FANTASY];
