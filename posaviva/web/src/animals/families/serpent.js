// Snakes: poseable parts and ready poses of the 'serpent' family
// (species/serpent.js). The body is a chain rooted in the middle: spine1..6
// run toward the head (raw X+ = down, Y+ = toward the snake's left), tail1..14
// toward the tail tip (raw X+ = up, Y+ = toward its right). Ready poses are
// computed from the species' bone lengths: S waves, a flat spiral, a raised
// striking front.
import { registerFamily, AX } from '../controls.js';
import { registerPoses } from '../poses.js';

const range = (p, a, b) => Array.from({ length: b - a + 1 }, (_, i) => p + (a + i));

function serpentControls(entry) {
  const names = new Set(entry.bones.map((b) => b.name));
  const nT = entry.bones.filter((b) => /^tail\d+$/.test(b.name)).length;
  const nF = entry.bones.filter((b) => /^spine\d+$/.test(b.name)).length;
  const fwd = (label, min, max) => [{ ...AX.pitchFwd, label: 'Su / giù', min, max }, { ...AX.turn, label: 'A sinistra / destra', min: -max * 1.6, max: max * 1.6 }, { ...AX.tilt, label: 'Torci', min: -40, max: 40 }];
  const bwd = (min, max) => [{ ...AX.tailSide, label: 'A sinistra / destra', min: -max * 1.6, max: max * 1.6 }, { ...AX.tailUp, label: 'Su / giù', min, max }, { ...AX.tilt, label: 'Torci', min: -40, max: 40 }];
  const h = Math.ceil(nF / 2), m = Math.round(nT * 0.4);
  const list = [
    { id: 'body', label: 'Corpo', bones: ['hips'], axes: [{ ...AX.pitchFwd, label: 'Su / giù', min: -60, max: 60 }, { ...AX.turn, min: -180, max: 180 }, { ...AX.tilt, label: 'Rollio', min: -90, max: 90 }] },
    { id: 'neck', label: 'Collo', bones: range('spine', h + 1, nF), axes: fwd('Collo', -120, 90) },
    { id: 'front', label: 'Corpo anteriore', bones: range('spine', 1, h), axes: fwd('Corpo', -100, 90) },
    { id: 'head', label: 'Testa', bones: ['head'], axes: [{ ...AX.pitchFwd, min: -60, max: 60 }, { ...AX.turn, min: -60, max: 60 }, { ...AX.tilt, min: -45, max: 45 }] },
    { id: 'jaw', label: 'Bocca', bones: ['jaw'], axes: [{ k: 'x', label: 'Apri', sign: 1, min: 0, max: 80 }] },
    { id: 'mid', label: 'Corpo centrale', bones: range('tail', 1, m), axes: bwd(-90, 120) },
    { id: 'tail', label: 'Coda', bones: range('tail', m + 1, nT), axes: bwd(-90, 160) },
  ];
  return list.filter((c) => c.bones.length && c.bones.every((b) => names.has(b)));
}

registerFamily('serpent', { controls: serpentControls });

// ------------------------------------------------------------------ computed poses
/**
 * Chain description of a snake entry: bones ordered from the snout to the
 * tail tip with their arc-length midpoints. heading(s) -> world yaw (deg) and
 * pitch(s) -> world pitch (deg, + = rising toward the head) give the pose.
 */
function chainPose(entry, heading, pitch = () => 0, extra = {}) {
  const by = new Map(entry.bones.map((b) => [b.name, b]));
  const len = (n) => { const b = by.get(n); return Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]); };
  const fwd = entry.bones.filter((b) => /^spine\d+$/.test(b.name)).map((b) => b.name);
  const bwd = entry.bones.filter((b) => /^tail\d+$/.test(b.name)).map((b) => b.name);
  // arc length from the snout: head, spine6 .. spine1, hips, tail1 .. tailN
  const sMid = new Map();
  let s = len('head');
  for (let i = fwd.length - 1; i >= 0; i--) { const l = len(fwd[i]); sMid.set(fwd[i], s + l / 2); s += l; }
  sMid.set('hips', s);
  sMid.set('head', len('head') / 2);
  for (const n of bwd) { const l = len(n); sMid.set(n, s + l / 2); s += l; }
  const total = s;
  const out = {};
  const yaw = (n) => heading(sMid.get(n), total), pit = (n) => pitch(sMid.get(n), total);
  // root: absolute; children: difference to the parent (world aligned rest frames)
  out.hips = [-pit('hips'), yaw('hips'), 0];
  let prevY = yaw('hips'), prevP = pit('hips');
  for (const n of [...fwd, 'head']) {
    const y = yaw(n), p = pit(n);
    // toward the head: X+ = down, so rising = -X; yaw: Y+ turns toward +X
    out[n] = [-(p - prevP), y - prevY, 0];
    prevY = y; prevP = p;
  }
  prevY = yaw('hips'); prevP = pit('hips');
  for (const n of bwd) {
    const y = yaw(n), p = pit(n);
    out[n] = [(p - prevP) * -1, y - prevY, 0];
    prevY = y; prevP = p;
  }
  return { ...out, ...extra };
}

const deg = (r) => (r * 180) / Math.PI;
const P = (id, label, compute, extra = {}) => ({ id, label, bones: {}, compute, ...extra });

export const SERPENT_POSES = [
  P('slither', 'Striscia', (e) => chainPose(e, (s, L) => 28 * Math.sin((s / L) * Math.PI * 4.2 + 0.6) * (0.4 + 0.6 * Math.min(1, s / (0.25 * L))), () => 0, { head: [0, 0, 0] })),
  P('straight', 'Dritto', () => ({})),
  P('coil', 'Arrotolato', (e) => {
    // flat Archimedean spiral from the head (centre) outward, head resting on top
    const gap = 0.075 * 1.18 * (e.height / 0.064);
    let acc = 0, lastS = 0;
    const table = [];
    for (let s = 0; s <= 4; s += 0.005) { const R = 0.09 * (e.height / 0.064) + (gap / (2 * Math.PI)) * acc; acc += (s - lastS) / R; lastS = s; table.push(acc); }
    const ang = (s) => table[Math.min(table.length - 1, Math.round(s / 0.005))];
    return chainPose(e, (s) => deg(ang(s)) - 30, (s, L) => (s < 0.18 * L ? 22 * (1 - s / (0.18 * L)) : 0), { head: [16, 0, 0] });
  }),
  P('strike', 'Attacco', (e) => chainPose(e,
    (s, L) => (s > 0.42 * L ? 60 * Math.sin(((s - 0.42 * L) / (0.58 * L)) * Math.PI * 1.6) : 0),
    (s, L) => (s < 0.42 * L ? 70 * Math.sin((1 - s / (0.42 * L)) * Math.PI) * (s > 0.06 * L ? 1 : s / (0.06 * L)) : 0),
    { head: [6, 0, 0], jaw: [62, 0, 0] })),
  P('raised', 'Sollevato', (e) => chainPose(e,
    (s, L) => (s > 0.4 * L ? 70 * Math.sin(((s - 0.4 * L) / (0.6 * L)) * Math.PI * 1.3) : 0),
    (s, L) => (s < 0.3 * L ? 80 * Math.min(1, (0.3 * L - s) / (0.12 * L)) : 0),
    { head: [62, 0, 0] })),
  P('rest', 'A riposo', (e) => chainPose(e, (s, L) => 120 * (s / L) + 25 * Math.sin((s / L) * Math.PI * 3), () => 0)),
];

registerPoses('serpent', SERPENT_POSES);
void range;
