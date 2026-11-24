// Marine animals (shark, dolphin): poseable parts and ready poses of the
// 'marine' family (species/marine.js). Tail bones point backward: raw X+ =
// tail up, raw Y+ = tail toward the animal's right. Sharks swim with lateral
// waves (gait 'lateral'), dolphins with vertical ones (gait 'vertical').
import { registerFamily, AX } from '../controls.js';
import { registerPoses } from '../poses.js';

function marineControls(entry) {
  const names = new Set(entry.bones.map((b) => b.name));
  const list = [
    { id: 'body', label: 'Corpo', bones: ['hips'], axes: [{ ...AX.pitchFwd, label: 'Su / giù', min: -90, max: 90 }, { ...AX.turn, min: -90, max: 90 }, { ...AX.tilt, label: 'Rollio', min: -180, max: 180 }] },
    { id: 'front', label: 'Parte anteriore', bones: ['chest'], axes: [{ ...AX.turn, label: 'A sinistra / destra', min: -40, max: 40 }, { ...AX.pitchFwd, label: 'Su / giù', min: -35, max: 35 }] },
    { id: 'head', label: 'Testa', bones: ['head'], axes: [{ ...AX.turn, min: -30, max: 30 }, { ...AX.pitchFwd, min: -30, max: 30 }] },
    { id: 'jaw', label: 'Bocca', bones: ['jaw'], axes: [{ k: 'x', label: 'Apri', sign: 1, min: 0, max: 45 }] },
    { id: 'mid', label: 'Corpo posteriore', bones: ['tail1', 'tail2'], axes: [{ ...AX.tailSide, min: -60, max: 60 }, { ...AX.tailUp, min: -60, max: 60 }] },
    { id: 'tail', label: 'Coda', bones: ['tail3', 'tail4', 'tail5'], axes: [{ ...AX.tailSide, min: -100, max: 100 }, { ...AX.tailUp, min: -100, max: 100 }] },
  ];
  for (const S of ['.L', '.R']) {
    const sx = S === '.L' ? 1 : -1;
    list.push({ id: 'fin' + S, label: 'Pinna ' + (S === '.L' ? 'sinistra' : 'destra'), bones: ['fin' + S], side: S, mirror: 'fin' + (S === '.L' ? '.R' : '.L'),
      axes: [{ k: 'z', label: 'Su / giù', sign: sx, min: -50, max: 60 }, { k: 'y', label: 'Avanti / indietro', sign: -sx, min: -50, max: 50 }, { k: 'x', label: 'Ruota', sign: -1, min: -45, max: 45 }] });
  }
  return list.filter((c) => c.bones.every((b) => names.has(b)));
}

registerFamily('marine', { controls: marineControls });

const P = (id, label, bones, extra = {}) => ({ id, label, bones, ...extra });
// vertical (dolphin) version of a lateral wave: Y -> X (tail up = X+)
const V_ = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, /^tail|chest|head/.test(k) ? [-v[1], 0, v[2]] : v]));

const SWIM = { tail1: [0, 6, 0], tail2: [0, 9, 0], tail3: [0, -8, 0], tail4: [0, -14, 0], tail5: [0, -12, 0], chest: [0, -4, 0], head: [0, -3, 0], 'fin*': [0, 0, -6] };
const TURN = { hips: [0, 0, 18], chest: [0, 22, 0], head: [0, 12, 0], tail1: [0, -14, 0], tail2: [0, -16, 0], tail3: [0, -16, 0], tail4: [0, -12, 0], tail5: [0, -8, 0], 'fin.L': [0, 0, 10], 'fin.R': [0, 0, -18] };
const ATTACK = { hips: [-14, 0, 0], chest: [-10, 0, 0], head: [-14, 0, 0], jaw: [38, 0, 0], tail1: [0, 8, 0], tail2: [0, 12, 0], tail3: [6, -12, 0], tail4: [4, -18, 0], tail5: [0, -14, 0], 'fin*': [0, 10, 16] };
const GLIDE = { tail3: [0, 3, 0], tail4: [0, 4, 0], 'fin*': [0, 0, 4] };

export const MARINE_POSES = [
  P('swim', 'Nuota', SWIM, { air: 0.16, gait: { vertical: { bones: V_(SWIM), replace: true } } }),
  P('glide', 'Scivola', GLIDE, { air: 0.16 }),
  P('turn', 'Virata', TURN, { air: 0.2 }),
  P('attack', 'Attacco', ATTACK, { air: 0.2, gait: { vertical: { bones: { hips: [-20, 0, 0], chest: [-8, 0, 0], head: [-10, 0, 0], jaw: [24, 0, 0], tail1: [8, 0, 0], tail2: [10, 0, 0], tail3: [-10, 0, 0], tail4: [-16, 0, 0], tail5: [-10, 0, 0] }, replace: true } } }),
  P('dive', 'Scende in picchiata', { hips: [48, 0, 0], chest: [6, 0, 0], tail1: [0, 4, 0], tail2: [0, 6, 0], tail3: [0, -6, 0], tail4: [0, -8, 0], 'fin*': [0, 0, 8] }, { air: 0.25 }),
  P('rise', 'Risale', { hips: [-42, 0, 0], chest: [-6, 0, 0], tail1: [0, -6, 0], tail2: [0, -8, 0], tail3: [0, 8, 0], tail4: [0, 10, 0] }, { air: 0.25 }),
  P('jump', 'Salto', { hips: [-38, 0, 0], chest: [-14, 0, 0], head: [-6, 0, 0], tail1: [16, 0, 0], tail2: [18, 0, 0], tail3: [16, 0, 0], tail4: [12, 0, 0], tail5: [8, 0, 0], 'fin*': [0, -10, 6] }, { air: 0.45, only: ['delfino'] }),
  P('rest', 'Sul fondo', { tail3: [0, -4, 0], tail4: [0, -6, 0], 'fin*': [0, 0, 12] }),
];

registerPoses('marine', MARINE_POSES);
