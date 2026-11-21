// Poseable parts ("controls") of the animal families. A control drives one
// or more bones (a chain shares the angle: tail curl, neck, back) and has up
// to three axes in DISPLAY convention (degrees, positive = the label's
// direction). Rest frames are world aligned, the animal faces +Z, its left
// is +X; raw bone Euler XYZ relates to the display through `sign`.
//
// Families add their own list with registerFamily(id, {controls, labels}).

const AX = {
  // head-like (pointing forward): +X raw = down
  pitchFwd: { k: 'x', label: 'Su / giù', sign: -1 },
  turn: { k: 'y', label: 'Gira a sinistra / destra', sign: 1 },
  tilt: { k: 'z', label: 'Inclina', sign: -1 },
  // limbs (pointing down): +X raw = swing back
  swing: { k: 'x', label: 'Avanti / indietro', sign: -1 },
  spread: { k: 'z', label: 'Apri / chiudi', sign: 1, sided: true },
  twist: { k: 'y', label: 'Ruota', sign: 1, sided: true },
  // tail (pointing back): +X raw = up
  tailUp: { k: 'x', label: 'Su / giù', sign: 1 },
  tailSide: { k: 'y', label: 'A sinistra / destra', sign: -1 },
};

const ax = (base, min, max) => ({ ...AX[base], min, max });

function limb(side, id, label, bones, swing, spread = [-25, 35], twist = [-30, 30]) {
  return { id: id + side, label, bones: bones.map((b) => b + side), side, axes: [ax('swing', swing[0], swing[1]), ax('spread', spread[0], spread[1]), ax('twist', twist[0], twist[1])], mirror: id + (side === '.L' ? '.R' : '.L') };
}

function quadrupedControls(entry, labels = {}) {
  const has = (n) => entry.bones.some((b) => b.name === n);
  const tails = entry.bones.filter((b) => /^tail\d+$/.test(b.name)).map((b) => b.name);
  const trunk = entry.bones.filter((b) => /^trunk\d+$/.test(b.name)).map((b) => b.name);
  const L = { shoulder: 'Spalla', arm: 'Braccio', forearm: 'Avambraccio', wrist: 'Polso', fpaw: 'Zampa anteriore', thigh: 'Coscia', shin: 'Gamba', hock: 'Garretto', hpaw: 'Zampa posteriore', ...labels };
  const list = [
    { id: 'body', label: 'Corpo', bones: ['hips'], axes: [{ ...AX.pitchFwd, label: 'Impenna / abbassa', min: -75, max: 40 }, { ...AX.turn, min: -45, max: 45 }, { ...AX.tilt, label: 'Sul fianco', min: -95, max: 95 }] },
    { id: 'back', label: 'Schiena', bones: ['spine1', 'spine2', 'chest'], axes: [{ ...AX.pitchFwd, label: 'Inarca / curva', min: -40, max: 45 }, { ...AX.turn, label: 'Piega di lato', min: -50, max: 50 }, { ...AX.tilt, label: 'Torci', min: -40, max: 40 }] },
    { id: 'neck', label: 'Collo', bones: ['neck1', 'neck2'], axes: [ax('pitchFwd', -60, 70), ax('turn', -80, 80), ax('tilt', -40, 40)] },
    { id: 'head', label: 'Testa', bones: ['head'], axes: [ax('pitchFwd', -50, 60), ax('turn', -60, 60), ax('tilt', -45, 45)] },
    { id: 'jaw', label: 'Bocca', bones: ['jaw'], axes: [{ k: 'x', label: 'Apri', sign: 1, min: 0, max: 50 }, { k: 'y', label: 'Di lato', sign: 1, min: -8, max: 8 }] },
  ];
  if (has('ear.L')) for (const s of ['.L', '.R']) list.push({ id: 'ear' + s, label: s === '.L' ? 'Orecchio sinistro' : 'Orecchio destro', bones: ['ear' + s], side: s, axes: [{ ...AX.pitchFwd, label: 'Avanti / indietro', min: -60, max: 60 }, { ...AX.tilt, label: 'Su / giù', sign: s === '.L' ? -1 : 1, min: -60, max: 60 }, ax('twist', -45, 45)], mirror: 'ear' + (s === '.L' ? '.R' : '.L') });
  if (tails.length) list.push({ id: 'tail', label: 'Coda', bones: tails, axes: [ax('tailUp', -100, 120), ax('tailSide', -120, 120), { ...AX.tilt, label: 'Torci', min: -45, max: 45 }] });
  if (trunk.length) list.push({ id: 'trunk', label: 'Proboscide', bones: trunk, axes: [{ ...AX.pitchFwd, label: 'Su / giù', sign: 1, min: -150, max: 120 }, { ...AX.turn, label: 'A sinistra / destra', min: -90, max: 90 }, { ...AX.tilt, label: 'Torci', min: -45, max: 45 }] });
  for (const s of ['.L', '.R']) {
    const side = s === '.L' ? ' sx' : ' dx';
    list.push(
      limb(s, 'shoulder', L.shoulder + side, ['scapula'], [-30, 30], [-10, 15], [-10, 10]),
      limb(s, 'arm', L.arm + side, ['upperarm'], [-80, 70]),
      limb(s, 'forearm', L.forearm + side, ['forearm'], [-130, 30], [-15, 15], [-20, 20]),
      limb(s, 'wrist', L.wrist + side, ['hand'], [-30, 130], [-20, 20], [-20, 20]),
      limb(s, 'fpaw', L.fpaw + side, ['fingers'], [-60, 80], [-15, 15], [-15, 15]),
      limb(s, 'thigh', L.thigh + side, ['thigh'], [-100, 60]),
      limb(s, 'shin', L.shin + side, ['shin'], [-30, 140], [-15, 15], [-20, 20]),
      limb(s, 'hock', L.hock + side, ['foot'], [-130, 40], [-15, 15], [-20, 20]),
      limb(s, 'hpaw', L.hpaw + side, ['toes'], [-60, 80], [-15, 15], [-15, 15]),
    );
  }
  return list.filter((c) => c.bones.every(has));
}

const FAMILIES = new Map();

/** Registers a family: {controls(entry) -> control list, labels?} */
export function registerFamily(id, def) { FAMILIES.set(id, def); }

registerFamily('quadruped', { controls: (e) => quadrupedControls(e) });
registerFamily('primate', {
  controls: (e) => quadrupedControls(e, { shoulder: 'Spalla', arm: 'Braccio', forearm: 'Avambraccio', wrist: 'Mano', fpaw: 'Dita mano', thigh: 'Coscia', shin: 'Gamba', hock: 'Piede', hpaw: 'Dita piede' }),
});

registerFamily('macropod', {
  controls: (e) => quadrupedControls(e, { shoulder: 'Spalla', arm: 'Braccio', forearm: 'Avambraccio', wrist: 'Zampa anteriore', fpaw: 'Dita', thigh: 'Coscia', shin: 'Gamba', hock: 'Piede', hpaw: 'Dita piede' }),
});

/** Control list of a species entry (cached on the entry). */
export function controlsFor(entry) {
  if (entry._controls) return entry._controls;
  const fam = FAMILIES.get(entry.family) || FAMILIES.get('quadruped');
  const list = fam.controls(entry);
  const byBone = new Map();
  for (const c of list) for (const b of c.bones) byBone.set(b, c);
  entry._controls = { list, byId: new Map(list.map((c) => [c.id, c])), byBone };
  return entry._controls;
}
