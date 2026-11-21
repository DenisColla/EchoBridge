// Winged quadrupeds (pegasus, griffin, dragon): the quadruped controls plus
// the wings (feathered: pri/sec/ter feather bones; membrane: finger bones),
// the quadruped ready poses with the wings folded, and flight poses.
import { registerFamily, quadrupedControls } from '../controls.js';
import { registerPoses, FAMILY_POSES } from '../poses.js';
import { wingControls } from './bird.js';

registerFamily('winged', { controls: (e) => [...quadrupedControls(e), ...wingControls(e)] });

const FOLD = { 'wingFold*': 1 };
const P = (id, label, bones, extra = {}) => ({ id, label, bones, ...extra });
// legs gathered under the body in flight (from the quadruped jump pose)
const TUCK = { 'upperarm*': [-62, 0, 0], 'forearm*': [-56, 0, 0], 'hand*': [80, 0, 0], 'thigh*': [52, 0, 0], 'shin*': [-24, 0, 0], 'foot*': [40, 0, 0], 'toes*': [20, 0, 0] };

const ground = FAMILY_POSES.quadruped
  .filter((p) => !['play', 'jump'].includes(p.id))
  .map((p) => ({ ...p, blend: { ...FOLD, ...(p.blend || {}) }, only: p.id === 'rear' ? ['pegaso'] : p.only }));

export const WINGED_POSES = [
  ...ground,
  P('spread', 'Ali spiegate', { neck1: [-10, 0, 0], neck2: [-8, 0, 0], head: [-10, 0, 0], jaw: [22, 0, 0], 'wing1*': [0, -8, 30], 'wing3*': [0, 0, -12], tail1: [6, 0, 0] }),
  P('flyup', 'Vola: ali su', { ...TUCK, neck1: [-12, 0, 0], head: [10, 0, 0], 'wing1*': [6, 6, 62], 'wing2*': [0, 6, -8], 'wing3*': [-6, -8, -26], tail1: [-10, 0, 0], tail2: [-6, 0, 0] }, { air: 0.7 }),
  P('flydown', 'Vola: ali giù', { ...TUCK, neck1: [-8, 0, 0], head: [8, 0, 0], 'wing1*': [-8, -12, -40], 'wing2*': [0, -6, 6], 'wing3*': [10, 10, 16], tail1: [-10, 0, 0] }, { air: 0.7 }),
  P('glide', 'Plana', { ...TUCK, neck1: [-10, 0, 0], head: [8, 0, 0], 'wing1*': [4, 0, 8], 'wing3*': [0, 0, 4], tail1: [-14, 0, 0], tail2: [-4, 0, 0] }, { air: 0.7 }),
  P('land', 'Atterra', { hips: [-24, 0, 0], neck1: [10, 0, 0], head: [12, 0, 0], 'wing1*': [-10, -30, 42], 'wing2*': [0, -10, 0], 'wing3*': [8, 10, 14], 'upperarm*': [-40, 0, 0], 'forearm*': [-30, 0, 0], 'thigh*': [-10, 0, 0], tail1: [-16, 0, 0] }, { air: 0.15 }),
  P('roar', 'Ruggito / grido', { hips: [-10, 0, 0], neck1: [-24, 0, 0], neck2: [-16, 0, 0], head: [-24, 0, 0], jaw: [40, 0, 0], 'wing1*': [0, -16, 52], 'wing3*': [0, -10, -16], 'upperarm.L': [-30, 0, 0], 'forearm.L': [-50, 0, 0], tail1: [10, 0, 0] }),
];

registerPoses('winged', WINGED_POSES);
