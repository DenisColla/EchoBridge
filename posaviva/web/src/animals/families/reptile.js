// Reptiles on four legs (crocodile, tortoise): quadruped controls with
// reptile ready poses. The crocodile's limbs sprawl sideways, so walking
// swings them about the vertical axis (raw Y: left limb Y- = forward, right
// limb Y+ = forward); the tortoise keeps its back rigid (shell).
import { registerFamily, quadrupedControls } from '../controls.js';
import { registerPoses } from '../poses.js';

registerFamily('reptile', {
  controls: (e) => quadrupedControls(e, { shoulder: 'Spalla', arm: 'Braccio', forearm: 'Avambraccio', wrist: 'Polso', fpaw: 'Zampa anteriore', thigh: 'Coscia', shin: 'Gamba', hock: 'Caviglia', hpaw: 'Zampa posteriore' })
    .filter((c) => !(e.limits?.rigidBack && c.id === 'back')),
});

const P = (id, label, bones, extra = {}) => ({ id, label, bones, ...extra });
const CROC = ['coccodrillo'], TORT = ['tartaruga'];
const tailWave = (a, n = 10) => Object.fromEntries(Array.from({ length: n }, (_, i) => ['tail' + (i + 1), [0, a * Math.sin((i / n) * Math.PI * 2), 0]]));

export const REPTILE_POSES = [
  P('stand', 'In piedi', {}),
  // ---- crocodile
  P('lie', 'Sdraiato', { 'thigh*': [0, 20, 30], 'shin*': [0, 0, -24], 'foot*': [0, 0, -8], 'upperarm*': [0, -20, 28], 'forearm*': [0, 0, -24], 'hand*': [0, 0, -6], neck1: [4, 0, 0], head: [2, 0, 0], ...tailWave(8) }, { only: CROC }),
  P('walk', 'Cammina', {
    'thigh.L': [0, -26, 4], 'thigh.R': [0, -18, 8], 'upperarm.L': [0, 18, 6], 'upperarm.R': [0, 24, 2],
    spine1: [0, 5, 0], spine2: [0, -3, 0], chest: [0, -6, 0], neck1: [0, 4, 0], head: [0, 4, 0], ...tailWave(9),
  }, { only: CROC }),
  P('attack', 'Attacco', { hips: [-4, 0, 0], spine2: [-6, 0, 0], chest: [-6, 0, 0], neck1: [-10, 0, 0], neck2: [-4, 0, 0], head: [-14, 0, 0], jaw: [42, 0, 0], 'upperarm*': [0, -12, -10], 'forearm*': [0, 0, 6], ...tailWave(14) }, { only: CROC }),
  P('gape', 'Bocca aperta', { 'thigh*': [0, 20, 30], 'shin*': [0, 0, -24], 'upperarm*': [0, -20, 28], 'forearm*': [0, 0, -24], neck1: [-6, 0, 0], head: [-6, 0, 0], jaw: [34, 0, 0] }, { only: CROC }),
  P('swim', 'Nuota', { 'upperarm*': [0, 62, 10], 'forearm*': [0, 30, 0], 'thigh*': [0, 55, 12], 'shin*': [0, 30, 0], 'foot*': [0, 20, 0], ...tailWave(18), neck1: [0, -4, 0] }, { only: CROC, air: 0.1 }),
  P('turn', 'Si gira', { spine1: [0, 12, 0], spine2: [0, 14, 0], chest: [0, 14, 0], neck1: [0, 12, 0], neck2: [0, 8, 0], head: [0, 6, 0], tail1: [0, -8, 0], tail2: [0, -10, 0], tail3: [0, -10, 0], tail4: [0, -10, 0], tail5: [0, -8, 0], 'thigh.L': [0, -20, 4], 'upperarm.R': [0, 20, 4] }, { only: CROC }),
  // ---- tortoise
  P('walk', 'Cammina', { 'upperarm.L': [-16, 0, 0], 'forearm.L': [-10, 0, 0], 'upperarm.R': [12, 0, 0], 'thigh.L': [12, 0, 0], 'thigh.R': [-14, 0, 0], 'shin.R': [8, 0, 0], neck1: [-6, 4, 0], head: [4, 4, 0] }, { only: TORT }),
  P('hide', 'Nel guscio', { neck1: [62, 0, 0], neck2: [-128, 0, 0], head: [70, 0, 0], 'upperarm*': [-46, 0, -16], 'forearm*': [-40, 0, 0], 'thigh*': [36, 0, -18], 'shin*': [30, 0, 0], tail1: [-40, 0, 0] }, { only: TORT }),
  P('lookup', 'Guarda in alto', { neck1: [-30, 0, 0], neck2: [-10, 0, 0], head: [-16, 0, 0], 'upperarm*': [-6, 0, 0] }, { only: TORT }),
  P('eat', 'Mangia', { neck1: [16, 0, 0], neck2: [12, 0, 0], head: [22, 0, 0], jaw: [26, 0, 0] }, { only: TORT }),
  P('rest', 'A riposo', { 'upperarm*': [0, 0, 42], 'forearm*': [0, 0, -34], 'thigh*': [0, 0, 40], 'shin*': [0, 0, -32], neck1: [12, 0, 0], head: [6, 0, 0] }, { only: TORT }),
];

registerPoses('reptile', REPTILE_POSES);
