// Birds (runtime + build previews): poseable parts and ready poses of the
// 'bird' family (species/bird.js). Wings and tail are built spread; the stored
// blends 'wingFold.L/.R' (folded wing) and 'tailFan' (closed tail) are driven
// by the "Apertura" sliders and used by the ready poses.
import { registerFamily, AX } from '../controls.js';
import { registerPoses } from '../poses.js';

const WING_RE = /^(wing[123]|pri\d+|sec\d+|ter\d+)\.([LR])$/;

/** Wing controls (shared by birds, griffins, pegasi, dragons). */
export function wingControls(entry, { blend = true, label = 'Ali' } = {}) {
  const names = entry.bones.map((b) => b.name);
  const side = (S) => names.filter((n) => { const m = WING_RE.exec(n) || /^(wing[123]|finger\d+[a-z]?)\.([LR])$/.exec(n); return m && m[2] === S[1]; });
  if (!names.includes('wing1.L')) return [];
  const hasFold = blend && entry.blends && entry.blends['wingFold.L'];
  const list = [];
  const both = [...side('.L'), ...side('.R')];
  list.push({
    id: 'wings', label, bones: ['wing1.L', 'wing1.R'], all: both,
    axes: [
      ...(hasFold ? [{ k: 'blend', blend: ['wingFold.L', 'wingFold.R'], invert: true, label: 'Apertura', unit: '%', min: 0, max: 100 }] : []),
      { k: 'drive', label: 'Batti su / giù', drive: [['wing1.L', 'z', 1], ['wing1.R', 'z', -1]], min: -80, max: 95 },
      { k: 'drive', label: 'Avanti / indietro', drive: [['wing1.L', 'y', -1], ['wing1.R', 'y', 1]], min: -45, max: 70 },
    ],
  });
  for (const S of ['.L', '.R']) {
    const sx = S === '.L' ? 1 : -1;
    const nm = S === '.L' ? 'sinistra' : 'destra';
    list.push({
      id: 'wing' + S, label: 'Ala ' + nm, bones: ['wing1' + S], all: side(S), side: S, mirror: 'wing' + (S === '.L' ? '.R' : '.L'),
      axes: [
        ...(hasFold ? [{ k: 'blend', blend: ['wingFold' + S], invert: true, label: 'Apertura', unit: '%', min: 0, max: 100 }] : []),
        { k: 'z', label: 'Su / giù', sign: sx, min: -85, max: 100 },
        { k: 'y', label: 'Avanti / indietro', sign: -sx, min: -50, max: 80 },
        { k: 'x', label: 'Ruota', sign: -1, min: -45, max: 45 },
      ],
    });
    if (names.includes('wing3' + S)) list.push({
      id: 'wingtip' + S, label: 'Punta ala ' + (S === '.L' ? 'sx' : 'dx'), bones: ['wing3' + S], side: S, mirror: 'wingtip' + (S === '.L' ? '.R' : '.L'),
      all: names.filter((n) => n === 'wing3' + S || (/^pri\d+\./.test(n) && n.endsWith(S)) || (/^finger\d+[a-z]?\./.test(n) && n.endsWith(S))),
      axes: [
        { k: 'z', label: 'Su / giù', sign: sx, min: -60, max: 60 },
        { k: 'y', label: 'Piega', sign: sx, min: -40, max: 160 },
      ],
    });
  }
  return list;
}

function birdControls(entry) {
  const names = new Set(entry.bones.map((b) => b.name));
  const has = (n) => names.has(n);
  const rects = entry.bones.filter((b) => /^rect\d+\./.test(b.name)).map((b) => b.name);
  const list = [
    { id: 'body', label: 'Corpo', bones: ['hips'], axes: [{ ...AX.pitchFwd, label: 'Inclina', min: -80, max: 95 }, { ...AX.turn, min: -60, max: 60 }, { ...AX.tilt, label: 'Sul fianco', min: -95, max: 95 }] },
    { id: 'neck', label: 'Collo', bones: ['neck1', 'neck2', 'neck3'], axes: [{ ...AX.pitchFwd, min: -90, max: 110 }, { ...AX.turn, min: -170, max: 170 }, { ...AX.tilt, min: -60, max: 60 }] },
    { id: 'head', label: 'Testa', bones: ['head'], axes: [{ ...AX.pitchFwd, min: -60, max: 70 }, { ...AX.turn, min: -90, max: 90 }, { ...AX.tilt, min: -70, max: 70 }] },
    { id: 'jaw', label: 'Becco', bones: ['jaw'], axes: [{ k: 'x', label: 'Apri', sign: 1, min: 0, max: 45 }] },
    ...wingControls(entry),
    { id: 'tail', label: 'Coda', bones: ['tail1'], all: ['tail1', ...rects], axes: [
      { ...AX.tailUp, min: -60, max: 70 }, { ...AX.tailSide, min: -45, max: 45 },
      ...(entry.blends?.tailFan ? [{ k: 'blend', blend: ['tailFan'], invert: true, label: 'Apertura ventaglio', unit: '%', min: 0, max: 100 }] : []),
    ] },
  ];
  for (const S of ['.L', '.R']) {
    const s = S === '.L' ? ' sx' : ' dx', m = (id) => id + (S === '.L' ? '.R' : '.L');
    list.push(
      { id: 'thigh' + S, label: 'Coscia' + s, bones: ['thigh' + S], side: S, mirror: m('thigh'), axes: [{ ...AX.swing, min: -80, max: 80 }, { ...AX.spread, min: -30, max: 40 }] },
      { id: 'shin' + S, label: 'Gamba' + s, bones: ['shin' + S], side: S, mirror: m('shin'), axes: [{ ...AX.swing, min: -120, max: 60 }, { ...AX.spread, min: -25, max: 25 }] },
      { id: 'hock' + S, label: 'Tarso' + s, bones: ['foot' + S], side: S, mirror: m('hock'), axes: [{ ...AX.swing, min: -60, max: 140 }, { ...AX.spread, min: -25, max: 25 }, { ...AX.twist, min: -30, max: 30 }] },
      { id: 'toes' + S, label: 'Dita' + s, bones: ['toes' + S], all: ['toes' + S, 'hallux' + S], side: S, mirror: m('toes'), axes: [{ k: 'drive', label: 'Stringi', drive: [['toes' + S, 'x', 1], ['hallux' + S, 'x', -1]], min: -20, max: 90 }] },
    );
  }
  return list.filter((c) => c.bones.every(has));
}

registerFamily('bird', { controls: birdControls });

// ------------------------------------------------------------------ ready poses
// Raw Euler XYZ degrees (world aligned rest frames; '*' = both sides mirrored).
// wing1 z+ = left wing up; y+ = swept back; wing3 y+ = tip folded back.
// Legs: thigh / shin / foot X+ swings back; toes X+ curl down, hallux X- curls.
const P = (id, label, bones, extra = {}) => ({ id, label, bones, ...extra });
const FOLD = { 'wingFold*': 1, tailFan: 1 };
const TUCK = { 'thigh*': [40, 0, 6], 'shin*': [-40, 0, 0], 'foot*': [120, 0, 0], 'toes*': [70, 0, 0], 'hallux*': [-50, 0, 0] };

export const BIRD_POSES = [
  P('stand', 'In piedi', {}, { blend: FOLD }),
  P('perch', 'Appollaiato', { hips: [4, 0, 0], 'thigh*': [-14, 0, 4], 'shin*': [30, 0, 0], 'foot*': [-22, 0, 0], 'toes*': [38, 0, 0], 'hallux*': [-30, 0, 0], tail1: [-8, 0, 0], neck1: [6, 0, 0], neck2: [-4, 0, 0] }, { blend: FOLD }),
  P('walk', 'Cammina', { 'thigh.L': [-18, 0, 0], 'shin.L': [10, 0, 0], 'foot.L': [-6, 0, 0], 'toes.L': [-12, 0, 0], 'thigh.R': [14, 0, 0], 'shin.R': [8, 0, 0], 'foot.R': [-30, 0, 0], 'toes.R': [40, 0, 0], neck1: [10, 0, 0], neck2: [-6, 6, 0], head: [-4, 4, 0] }, { blend: FOLD }),
  P('peck', 'Becca', { hips: [30, 0, 0], neck1: [30, 0, 0], neck2: [20, 0, 0], neck3: [12, 0, 0], head: [20, 0, 0], tail1: [24, 0, 0], 'thigh*': [-20, 0, 0], 'shin*': [12, 0, 0] }, { blend: FOLD }),
  P('call', 'Canta / gracchia', { hips: [-8, 0, 0], neck1: [-20, 0, 0], neck2: [-14, 0, 0], neck3: [-8, 0, 0], head: [-20, 0, 0], jaw: [28, 0, 0], tail1: [-6, 0, 0] }, { blend: FOLD }),
  P('lookback', 'Si gira', { neck1: [0, 40, 0], neck2: [0, 40, 0], neck3: [0, 30, 6], head: [0, 20, 10] }, { blend: FOLD }),
  P('spread', 'Ali spiegate', { 'wing1*': [0, -6, 22], 'wing3*': [0, -4, -10], tail1: [10, 0, 0], neck1: [-6, 0, 0], head: [-8, 0, 0], jaw: [10, 0, 0] }, { blend: { tailFan: 0 } }),
  P('flyup', 'Vola: ali su', { hips: [26, 0, 0], neck1: [-14, 0, 0], neck2: [-8, 0, 0], head: [-10, 0, 0], 'wing1*': [8, 4, 62], 'wing2*': [0, 6, -8], 'wing3*': [-6, -8, -24], tail1: [-14, 0, 0], ...TUCK }, { blend: { tailFan: 0.45 }, air: 0.9 }),
  P('flydown', 'Vola: ali giù', { hips: [26, 0, 0], neck1: [-14, 0, 0], neck2: [-8, 0, 0], head: [-10, 0, 0], 'wing1*': [-10, -12, -46], 'wing2*': [0, -6, 6], 'wing3*': [10, 10, 18], tail1: [-14, 0, 0], ...TUCK }, { blend: { tailFan: 0.45 }, air: 0.9 }),
  P('glide', 'Plana', { hips: [24, 0, 0], neck1: [-12, 0, 0], neck2: [-8, 0, 0], head: [-8, 0, 0], 'wing1*': [4, 0, 6], 'wing3*': [0, 0, 4], tail1: [-12, 0, 0], ...TUCK }, { blend: { tailFan: 0.3 }, air: 0.9 }),
  P('land', 'Atterra', { hips: [-26, 0, 0], neck1: [18, 0, 0], neck2: [10, 0, 0], head: [10, 0, 0], 'wing1*': [-10, -30, 40], 'wing2*': [0, -10, 0], 'wing3*': [8, 10, 14], tail1: [-26, 0, 0], 'thigh*': [-40, 0, 6], 'shin*': [-10, 0, 0], 'foot*': [-20, 0, 0], 'toes*': [-18, 0, 0], 'hallux*': [14, 0, 0] }, { blend: { tailFan: 0 }, air: 0.15 }),
  P('sit', 'Accovacciato', { 'thigh*': [-30, 0, 6], 'shin*': [76, 0, 0], 'foot*': [-74, 0, 0], 'toes*': [30, 0, 0], neck1: [14, 0, 0], neck2: [-10, 0, 0], tail1: [6, 0, 0] }, { blend: FOLD }),
  P('sleep', 'Dorme', { 'thigh*': [-30, 0, 6], 'shin*': [76, 0, 0], 'foot*': [-74, 0, 0], 'toes*': [30, 0, 0], neck1: [10, 70, 0], neck2: [6, 60, 0], neck3: [0, 40, 0], head: [20, 20, 30] }, { blend: FOLD, sleep: true }),
];

registerPoses('bird', BIRD_POSES);
