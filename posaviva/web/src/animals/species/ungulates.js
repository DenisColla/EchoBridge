// Hoofed animals: horse, zebra, cow, pig, sheep, goat, deer, wild boar, giraffe.
import { quadruped, horn, crestMane } from './quadruped.js';
import { mkCoat, R, sstep, fbm, clamp01 } from './coat.js';
import { mx, V } from './builder.js';

const furSleek = { type: 'smooth', scale: 9, normalScale: 0.2, roughness: 0.62, sheen: 0.25 };
const furShort = { type: 'short', scale: 11, normalScale: 0.2, roughness: 0.8, sheen: 0.3 };
const furWool = { type: 'wool', scale: 9, normalScale: 0.55, roughness: 0.95, sheen: 0.5 };
const furBristle = { type: 'bristle', scale: 9, normalScale: 0.45, roughness: 0.88, sheen: 0.25 };
const skinPig = { type: 'smooth', scale: 12, normalScale: 0.15, roughness: 0.6, sheen: 0.2 };

// ------------------------------------------------------------------ equids
export const HORSE = {
  H: 1.6,
  torso: [[-0.56, 0.88, 0.62, 0.07], [-0.47, 0.99, 0.56, 0.15], [-0.34, 1.0, 0.55, 0.185], [-0.18, 0.975, 0.53, 0.19], [0.0, 0.975, 0.52, 0.2], [0.18, 1.0, 0.53, 0.195], [0.32, 1.025, 0.56, 0.175], [0.44, 0.93, 0.6, 0.15], [0.54, 0.79, 0.64, 0.09]],
  hip: [0.11, 0.84, -0.36], knee: [0.125, 0.6, -0.22], hock: [0.085, 0.37, -0.48], hpaw: [0.08, 0.12, -0.43],
  scap: [0.09, 0.95, 0.26], shoulder: [0.13, 0.73, 0.46], elbow: [0.135, 0.58, 0.33], wrist: [0.105, 0.3, 0.36], fpaw: [0.1, 0.12, 0.37],
  spine: [[-0.22, 0.92], [0.02, 0.92], [0.26, 0.95]], tailBase: [-0.54, 0.89],
  neck: { base: [0.42, 0.88], ang: 52, len: 0.6, w0: 0.12, h0: 0.21, w1: 0.065, h1: 0.12, crest: 1.15 },
  head: {
    len: 0.38, pitch: 48, w: 0.4, cranium: [0.2, 0.28],
    muzzle: [[0.32, 0.3, 0.02, 0.18], [0.55, 0.23, 0.02, 0.135], [0.78, 0.2, 0.03, 0.115], [0.96, 0.21, 0.04, 0.13]], muzzleCap: 0.8,
    jaw: [[0.12, 0.3, 0.17], [0.34, 0.22, 0.13], [0.62, 0.11, 0.09], [0.93, 0.1, 0.1]], slitY: -0.2, slitA: [0.78, 1.0],
    nose: { a: 0.94, b: 0.0, w: 0.11, h: 0.1, d: 0.045, nostril: 0.04 },
    eye: { a: 0.3, b: 0.3, x: 0.19, r: 0.058, dir: [0.82, 0.18, 0.54], open: 0.7 }, cheekA: 0.25, canine: 0,
  },
  ear: { type: 'erect', len: 0.26, w: 0.12, ang: 12, a: 0.06, b: 0.32, x: 0.12, face: 0.5, mid: 0.9 },
  fore: [[0, 0.03, 0.08, 0.06], [0.5, 0.07, 0.1, 0.1], [1, 0.08, 0.1, 0.11], [1.5, 0.07, 0.07, 0.1], [2, 0.055, 0.06, 0.06], [2.3, 0.055, 0.06, 0.04], [2.9, 0.034, 0.034, 0.03], [3, 0.042, 0.04, 0.036], [3.5, 0.03, 0.028, 0.033], [4, 0.038, 0.032, 0.04]],
  hind: [[0, 0.1, 0.13, 0.17], [0.4, 0.095, 0.11, 0.15], [1, 0.065, 0.075, 0.08], [1.3, 0.055, 0.05, 0.09], [1.8, 0.04, 0.035, 0.06], [2, 0.042, 0.04, 0.065], [2.5, 0.03, 0.028, 0.034], [3, 0.038, 0.032, 0.04]],
  foot: { type: 'hoof', size: 1.15 },
  tail: { len: 0.24, r: 0.045, carry: -62, curl: -10, taper: 0.4, bones: 3, hair: { len: 0.5, w: 0.07, back: 0.12 } },
  thighD: 1.15, scapW: 1.2,
};

export const horseExtras = (maneOpts) => (B, c) => { crestMane(c, maneOpts); forelock(B, c, maneOpts); };
function forelock(B, c, o) {
  if (o.upright) return;
  const { hp, HL } = c;
  B.loft([{ p: hp(0.02, 0.32), w: 0.07 * HL, ht: 0.04 * HL, hb: 0.04 * HL }, { p: hp(0.2, 0.34), w: 0.08 * HL, ht: 0.03 * HL, hb: 0.03 * HL }], { bones: ['head'], part: 'mane', k: 0.03 * HL, noise: { amp: 0.012 * HL, freq: 30 / HL, seed: 2 } });
}

// ------------------------------------------------------------------ bovids / cervids
function cowHorns(B, c, { len = 0.3, r = 0.045, up = 0.6, fwd = 0.3 } = {}) {
  const { hp, HL, HW } = c;
  B.sym((sx) => {
    const b0 = mx(hp(0.05, 0.22, HW * 0.42), sx);
    const p1 = V.add(b0, [sx * len * 0.5 * HL, len * 0.15 * HL, fwd * 0.2 * HL]);
    const p2 = V.add(b0, [sx * len * 0.85 * HL, len * up * 0.6 * HL, fwd * 0.6 * HL]);
    const p3 = V.add(b0, [sx * len * 0.9 * HL, len * up * HL, fwd * HL]);
    horn(B, [b0, p1, p2, p3], [r * HL, r * 0.85 * HL, r * 0.6 * HL, r * 0.2 * HL], ['head']);
  });
}

function goatHorns(B, c, { len = 0.75, r = 0.05 } = {}) {
  const { hp, HL, HW } = c;
  B.sym((sx) => {
    const pts = [], rad = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5, a = t * 1.9; // sweep back in an arc
      pts.push(mx(hp(0.18 - Math.sin(a) * len * 0.45, 0.24 + (1 - Math.cos(a)) * -0.05 + Math.sin(a * 0.8) * len * 0.35, HW * 0.2 + t * 0.08 * HL), sx));
      rad.push(r * HL * (1 - 0.8 * t));
    }
    horn(B, pts, rad, ['head']);
  });
}

function antlers(B, c, { size = 1 } = {}) {
  const { hp, HL, HW } = c;
  const L = HL * 1.6 * size;
  B.sym((sx) => {
    const b0 = mx(hp(0.12, 0.24, HW * 0.3), sx);
    // main beam: up, out and back, then forward at the top
    const beam = [b0, V.add(b0, [sx * 0.12 * L, 0.25 * L, -0.12 * L]), V.add(b0, [sx * 0.26 * L, 0.55 * L, -0.2 * L]), V.add(b0, [sx * 0.34 * L, 0.82 * L, -0.12 * L]), V.add(b0, [sx * 0.36 * L, 1.0 * L, 0.02 * L])];
    const r0 = 0.03 * L;
    horn(B, beam, [r0 * 1.15, r0, r0 * 0.85, r0 * 0.65, r0 * 0.35], ['head'], { part: 'antler', k: r0 * 0.5 });
    // tines: brow, bez, trez and the crown
    const tine = (from, dir, len, rr) => horn(B, [from, V.add(from, V.mul(V.norm(dir), len * 0.55)), V.add(from, V.mul(V.norm(V.add(dir, [0, 0.4, 0])), len))], [rr, rr * 0.6, rr * 0.2], ['head'], { part: 'antler', k: rr * 0.5 });
    tine(V.lerp(beam[0], beam[1], 0.35), [sx * 0.1, 0.25, 1], 0.32 * L, r0 * 0.75);
    tine(V.lerp(beam[1], beam[2], 0.2), [sx * 0.15, 0.3, 1], 0.26 * L, r0 * 0.65);
    tine(V.lerp(beam[2], beam[3], 0.4), [sx * 0.2, 0.3, 0.9], 0.2 * L, r0 * 0.55);
    tine(beam[3], [sx * 0.4, 0.7, -0.3], 0.18 * L, r0 * 0.45);
    tine(V.lerp(beam[3], beam[4], 0.5), [-sx * 0.2, 0.8, 0.4], 0.15 * L, r0 * 0.4);
  });
}

// ------------------------------------------------------------------ species
export const UNGULATES = [
  {
    id: 'cavallo', label: 'Cavallo', group: 'fattoria', family: 'quadruped', gait: 'unguligrade', tris: 26000,
    build: () => quadruped({ ...HORSE, extras: horseExtras({ h: 0.065, w: 0.034, start: -0.02, end: 1.02, noise: 0.1 }) }),
    coat: mkCoat({ legs: [0.2, 0.32], mane: 1, tail: 0, muzzle: 0.35, extra: { fn: (v, lm) => (v.part === 'head' || v.part === 'muzzle' ? sstep(0.08, 0.02, Math.abs(v.p[0])) * sstep(0.3, 0.6, v.n[2] + v.n[1] * 0.3) * 0 : 0) }, shade: 0.25 }),
    fur: furSleek, iris: '#3a2414', pupil: 'bar',
    palettes: [
      { id: 'baio', label: 'Baio', colors: { base: '#7a4a2a', points: '#1d1714', nose: '#2a2220', keratin: '#3a3430' } },
      { id: 'sauro', label: 'Sauro', colors: { base: '#a2582c', points: '#b8763e', nose: '#3a2a24', keratin: '#5a4a3e' } },
      { id: 'morello', label: 'Morello', colors: { base: '#1c1a19', points: '#121111', nose: '#151313', keratin: '#2a2725' } },
      { id: 'grigio', label: 'Grigio', colors: { base: '#c9c6c0', points: '#8a8680', nose: '#4a4542', keratin: '#4a4542' } },
      { id: 'palomino', label: 'Palomino', colors: { base: '#d8b46e', points: '#efe3c8', nose: '#4a3a32', keratin: '#6a5a4c' } },
    ],
  },
  {
    id: 'zebra', label: 'Zebra', group: 'esotici', family: 'quadruped', gait: 'unguligrade', tris: 25000,
    build: () => quadruped({
      ...HORSE, H: 1.3,
      torso: HORSE.torso.map(([z, t, b, w]) => [z, t, b + 0.015, w * 1.06]),
      neck: { ...HORSE.neck, w0: 0.13, h0: 0.22, w1: 0.075, h1: 0.13, ang: 46 },
      head: { ...HORSE.head, len: 0.4 },
      ear: { ...HORSE.ear, len: 0.34, w: 0.16 },
      tail: { len: 0.4, r: 0.03, carry: -75, curl: 0, taper: 0.4, bones: 4, tuft: 0.05 },
      extras: horseExtras({ h: 0.075, w: 0.022, start: -0.02, end: 1.04, noise: 0.15, upright: true }),
    }),
    coat: mkCoat({ pattern: { type: 'zebra', width: 0.5, freq: 1.05, warp: 0.6 }, extra: { muzzle: 1.0 }, mane: 0, shade: 0.2 }),
    fur: furSleek, iris: '#2a1c12', pupil: 'bar',
    palettes: [
      { id: 'pianura', label: 'Classica', colors: { base: '#efebe3', pattern: '#171514', extra: '#2a2624', keratin: '#2a2725', nose: '#1a1817' } },
      { id: 'ombra', label: 'Con ombre', colors: { base: '#e3dccf', pattern: '#1f1b19', extra: '#3a2a20', keratin: '#2a2725', nose: '#1a1817' } },
    ],
  },
  {
    id: 'mucca', label: 'Mucca', group: 'fattoria', family: 'quadruped', gait: 'unguligrade', tris: 25000,
    build: () => quadruped({
      H: 1.4,
      torso: [[-0.66, 0.96, 0.66, 0.1], [-0.58, 1.02, 0.55, 0.2], [-0.44, 1.02, 0.48, 0.235], [-0.22, 1.0, 0.43, 0.25], [0.0, 1.0, 0.42, 0.26], [0.2, 1.0, 0.46, 0.235], [0.38, 1.0, 0.5, 0.19], [0.52, 0.9, 0.52, 0.15], [0.62, 0.75, 0.55, 0.09]],
      hip: [0.13, 0.86, -0.47], knee: [0.15, 0.58, -0.33], hock: [0.095, 0.36, -0.57], hpaw: [0.09, 0.1, -0.53],
      scap: [0.12, 0.95, 0.28], shoulder: [0.16, 0.66, 0.5], elbow: [0.17, 0.52, 0.36], wrist: [0.135, 0.26, 0.4], fpaw: [0.13, 0.1, 0.42],
      spine: [[-0.3, 0.92], [0.0, 0.92], [0.28, 0.94]], tailBase: [-0.64, 0.95],
      neck: { base: [0.52, 0.84], ang: 18, len: 0.42, w0: 0.16, h0: 0.25, w1: 0.1, h1: 0.15 },
      head: {
        len: 0.37, pitch: 48, w: 0.56, cranium: [0.22, 0.24],
        muzzle: [[0.34, 0.27, 0.02, 0.21], [0.6, 0.21, 0.02, 0.16], [0.82, 0.19, 0.03, 0.17], [0.97, 0.21, 0.05, 0.2]], muzzleCap: 0.5,
        jaw: [[0.15, 0.26, 0.2], [0.45, 0.16, 0.13], [0.9, 0.11, 0.15]], slitY: -0.2, slitA: [0.7, 1.0],
        nose: { a: 0.97, b: -0.02, w: 0.17, h: 0.11, d: 0.05, nostril: 0.035 },
        eye: { a: 0.27, b: 0.3, x: 0.24, r: 0.06, dir: [0.82, 0.22, 0.52], open: 0.75 }, cheekA: 0.3, canine: 0,
      },
      ear: { type: 'side', len: 0.32, w: 0.13, ang: 5, a: 0.06, b: 0.2, x: 0.27 },
      fore: [[0, 0.035, 0.09, 0.07], [0.5, 0.08, 0.11, 0.11], [1, 0.09, 0.11, 0.12], [1.5, 0.08, 0.08, 0.11], [2, 0.065, 0.07, 0.07], [2.3, 0.06, 0.065, 0.05], [2.9, 0.042, 0.04, 0.035], [3, 0.045, 0.045, 0.04], [3.6, 0.04, 0.035, 0.038], [4, 0.045, 0.04, 0.042]],
      hind: [[0, 0.11, 0.13, 0.17], [0.4, 0.1, 0.11, 0.15], [1, 0.07, 0.08, 0.09], [1.3, 0.06, 0.055, 0.09], [1.8, 0.045, 0.04, 0.065], [2, 0.047, 0.045, 0.068], [2.5, 0.036, 0.034, 0.04], [3, 0.043, 0.04, 0.045]],
      foot: { type: 'cloven', size: 1.35, hoofH: 1.0 },
      tail: { len: 0.58, r: 0.03, carry: -86, curl: 0, taper: 0.35, bones: 4, tuft: 0.05 },
      extras: (B, c) => {
        const { H } = c;
        cowHorns(B, c, { len: 0.22, r: 0.04, up: 0.5, fwd: 0.25 });
        // dewlap and udder
        B.loft([{ p: V.add(c.neckBase, [0, -0.08 * H, 0.0]), w: 0.05 * H, ht: 0.12 * H, hb: 0.14 * H }, { p: V.add(c.neckMid, [0, -0.1 * H, 0]), w: 0.035 * H, ht: 0.08 * H, hb: 0.08 * H }], { bones: ['neck1', 'chest'], part: 'neck', k: 0.06 * H });
        B.ell([0, 0.44 * H, -0.42 * H], [0.12 * H, 0.09 * H, 0.13 * H], { bones: ['hips'], part: 'udder', mat: 'skin', k: 0.05 * H });
        B.sym((sx) => { for (const dz of [-0.05, 0.05]) B.cone([sx * 0.045 * H, 0.38 * H, (-0.42 + dz) * H], [sx * 0.05 * H, 0.33 * H, (-0.42 + dz) * H], 0.014 * H, 0.009 * H, { bones: ['hips'], part: 'udder', mat: 'skin', k: 0.01 * H }); });
        // hook bones (hips)
        B.sym((sx) => B.ell([sx * 0.2 * H, 0.98 * H, -0.42 * H], [0.06 * H, 0.05 * H, 0.08 * H], { bones: ['hips'], part: 'torso', k: 0.06 * H }));
      },
    }),
    coat: mkCoat({ pattern: { type: 'patches', freq: 3.2, thr: 0.02, seed: 7, legsWhite: [0.25, 0.45] }, shade: 0.2 }),
    fur: furShort, iris: '#2a1c12', pupil: 'bar',
    palettes: [
      { id: 'pezzata', label: 'Pezzata nera', colors: { base: '#f1eee8', pattern: '#1b1918', nose: '#d9a7a2', keratin: '#d8ccb4', skin: '#e8b8b0' } },
      { id: 'rossa', label: 'Pezzata rossa', colors: { base: '#f1eee8', pattern: '#8a3e22', nose: '#d9a7a2', keratin: '#d8ccb4', skin: '#e8b8b0' } },
      { id: 'bruna', label: 'Bruna', colors: { base: '#8c7258', pattern: '#7a6048', nose: '#2a2421', keratin: '#d8ccb4', skin: '#6a5448' } },
      { id: 'nera', label: 'Nera', colors: { base: '#1e1c1b', pattern: '#181716', nose: '#221f1e', keratin: '#cfc3ab', skin: '#2a2624' } },
    ],
  },
  {
    id: 'maiale', label: 'Maiale', group: 'fattoria', family: 'quadruped', gait: 'unguligrade', tris: 22000,
    build: () => quadruped({
      H: 0.8,
      torso: [[-0.82, 0.88, 0.48, 0.12], [-0.72, 0.99, 0.38, 0.25], [-0.5, 1.03, 0.32, 0.29], [-0.2, 1.03, 0.29, 0.3], [0.1, 1.01, 0.29, 0.3], [0.35, 0.98, 0.32, 0.29], [0.55, 0.93, 0.35, 0.25], [0.7, 0.86, 0.4, 0.19]],
      hip: [0.15, 0.7, -0.6], knee: [0.17, 0.44, -0.48], hock: [0.13, 0.24, -0.66], hpaw: [0.125, 0.08, -0.61],
      scap: [0.14, 0.84, 0.42], shoulder: [0.19, 0.58, 0.58], elbow: [0.19, 0.4, 0.48], wrist: [0.16, 0.2, 0.52], fpaw: [0.155, 0.08, 0.54],
      spine: [[-0.4, 0.86], [0.0, 0.86], [0.4, 0.85]], tailBase: [-0.8, 0.84],
      neck: { base: [0.66, 0.7], ang: 12, len: 0.16, w0: 0.24, h0: 0.28, w1: 0.2, h1: 0.24 },
      head: {
        len: 0.45, pitch: 26, w: 0.62, cranium: [0.25, 0.28],
        muzzle: [[0.38, 0.3, 0.02, 0.22], [0.58, 0.2, 0.03, 0.15], [0.84, 0.15, 0.03, 0.12], [0.98, 0.15, 0.03, 0.125]], muzzleCap: 0.15,
        jaw: [[0.2, 0.22, 0.2], [0.55, 0.12, 0.13], [0.86, 0.08, 0.09]], slitY: -0.18, slitA: [0.55, 1.0],
        nose: { a: 1.0, b: -0.03, w: 0.13, h: 0.12, d: 0.025, nostril: 0.028 },
        eye: { a: 0.4, b: 0.3, x: 0.22, r: 0.04, dir: [0.6, 0.2, 0.77], open: 0.6 }, canine: 0,
      },
      ear: { type: 'drop', flat: true, a: 0.2, b: 0.42, x: 0.22, len: 0.3, w: 0.2, out: 0.1, fwd: 0.34, th: 0.03 },
      fore: [[0, 0.04, 0.08, 0.07], [0.5, 0.07, 0.1, 0.1], [1, 0.08, 0.1, 0.11], [1.5, 0.075, 0.08, 0.1], [2, 0.065, 0.065, 0.07], [3, 0.05, 0.05, 0.045], [4, 0.045, 0.045, 0.045]],
      hind: [[0, 0.1, 0.14, 0.17], [0.4, 0.1, 0.12, 0.15], [1, 0.07, 0.07, 0.09], [1.5, 0.055, 0.05, 0.07], [2, 0.05, 0.05, 0.06], [3, 0.045, 0.045, 0.045]],
      foot: { type: 'cloven', size: 0.95, hoofH: 1.0 },
      tail: { len: 0.24, r: 0.02, carry: 40, curl: 330, taper: 0.4, bones: 4 },
    }),
    coat: mkCoat({ under: 0.3, shade: 0.15 }),
    fur: skinPig, iris: '#3a2a20', pupil: 'round',
    palettes: [
      { id: 'rosa', label: 'Rosa', colors: { base: '#e6b0a2', under: '#efc4b8', nose: '#d98f86', keratin: '#9a7f6e', skin: '#e6b0a2', shadeAmp: 0.1 } },
      { id: 'pezzato', label: 'Pezzato', colors: { base: '#e6b0a2', under: '#efc4b8', nose: '#d98f86', keratin: '#9a7f6e' } },
      { id: 'nero', label: 'Nero', colors: { base: '#2a2423', under: '#352e2c', nose: '#3a2e2c', keratin: '#3a3230' } },
    ],
  },
  {
    id: 'pecora', label: 'Pecora', group: 'fattoria', family: 'quadruped', gait: 'unguligrade', tris: 24000,
    build: () => quadruped({
      H: 0.75, wool: 0.022,
      torso: [[-0.62, 0.98, 0.56, 0.16], [-0.5, 1.07, 0.48, 0.28], [-0.3, 1.1, 0.45, 0.31], [0.0, 1.1, 0.45, 0.32], [0.25, 1.1, 0.47, 0.3], [0.45, 1.05, 0.5, 0.26], [0.58, 0.94, 0.55, 0.18]],
      hip: [0.11, 0.72, -0.4], knee: [0.12, 0.5, -0.28], hock: [0.085, 0.3, -0.48], hpaw: [0.08, 0.08, -0.45],
      scap: [0.1, 0.9, 0.26], shoulder: [0.13, 0.64, 0.44], elbow: [0.13, 0.5, 0.33], wrist: [0.105, 0.26, 0.36], fpaw: [0.1, 0.08, 0.38],
      spine: [[-0.25, 0.9], [0.05, 0.9], [0.3, 0.92]], tailBase: [-0.6, 0.92],
      neck: { base: [0.5, 0.86], ang: 40, len: 0.3, w0: 0.2, h0: 0.25, w1: 0.11, h1: 0.14 },
      head: {
        len: 0.36, pitch: 42, w: 0.48, cranium: [0.22, 0.26],
        muzzle: [[0.36, 0.28, 0.02, 0.16], [0.6, 0.24, 0.02, 0.13], [0.84, 0.2, 0.03, 0.11], [0.97, 0.17, 0.03, 0.1]],
        jaw: [[0.18, 0.2, 0.15], [0.5, 0.12, 0.11], [0.9, 0.08, 0.08]], slitY: -0.2, slitA: [0.65, 1.0],
        nose: { a: 0.96, b: 0.0, w: 0.08, h: 0.07, d: 0.04, nostril: 0.022 },
        eye: { a: 0.32, b: 0.32, x: 0.21, r: 0.065, dir: [0.8, 0.2, 0.56], open: 0.65 }, canine: 0,
      },
      ear: { type: 'side', len: 0.36, w: 0.13, ang: -18, a: 0.1, b: 0.24, x: 0.22 },
      fore: [[0, 0.06, 0.1, 0.1], [0.5, 0.09, 0.12, 0.12], [1, 0.09, 0.1, 0.11], [1.5, 0.07, 0.08, 0.09], [2, 0.04, 0.045, 0.04], [2.3, 0.034, 0.04, 0.03], [3, 0.026, 0.026, 0.024], [4, 0.03, 0.028, 0.03]],
      hind: [[0, 0.12, 0.15, 0.17], [0.45, 0.11, 0.12, 0.14], [1, 0.05, 0.05, 0.06], [1.4, 0.04, 0.035, 0.06], [2, 0.03, 0.03, 0.04], [3, 0.03, 0.028, 0.03]],
      foot: { type: 'cloven', size: 0.75, hoofH: 1.0 },
      tail: { len: 0.2, r: 0.06, carry: -80, curl: 0, taper: 0.5, bones: 2 },
    }),
    coat: mkCoat({ points: 0, extra: { head: 1, legs: [0.36, 0.48] }, shade: 0.35, shadeFreq: 40 }),
    fur: furWool, iris: '#8a6a2a', pupil: 'bar',
    palettes: [
      { id: 'bianca', label: 'Bianca', colors: { base: '#e9e2d2', extra: '#e4dccb', nose: '#c9a49a', keratin: '#6a5e52' } },
      { id: 'musonera', label: 'Muso nero', colors: { base: '#e6dfcf', extra: '#1f1c1a', nose: '#1a1817', keratin: '#2a2725' } },
      { id: 'nera', label: 'Nera', colors: { base: '#2e2a27', extra: '#1f1c1a', nose: '#1a1817', keratin: '#2a2725' } },
    ],
  },
  {
    id: 'capra', label: 'Capra', group: 'fattoria', family: 'quadruped', gait: 'unguligrade', tris: 23000,
    build: () => quadruped({
      H: 0.72,
      torso: [[-0.58, 0.9, 0.62, 0.07], [-0.5, 1.0, 0.56, 0.15], [-0.32, 1.0, 0.5, 0.19], [-0.08, 0.98, 0.44, 0.21], [0.16, 0.98, 0.46, 0.2], [0.34, 1.0, 0.5, 0.17], [0.48, 0.92, 0.54, 0.13], [0.58, 0.8, 0.58, 0.08]],
      hip: [0.1, 0.8, -0.4], knee: [0.115, 0.55, -0.27], hock: [0.08, 0.33, -0.5], hpaw: [0.075, 0.08, -0.46],
      scap: [0.09, 0.92, 0.28], shoulder: [0.12, 0.68, 0.47], elbow: [0.125, 0.54, 0.35], wrist: [0.1, 0.27, 0.38], fpaw: [0.095, 0.08, 0.4],
      spine: [[-0.25, 0.92], [0.05, 0.9], [0.3, 0.93]], tailBase: [-0.57, 0.94],
      neck: { base: [0.5, 0.86], ang: 52, len: 0.42, w0: 0.11, h0: 0.17, w1: 0.07, h1: 0.1 },
      head: {
        len: 0.36, pitch: 40, w: 0.46, cranium: [0.22, 0.27],
        muzzle: [[0.36, 0.28, 0.02, 0.16], [0.6, 0.22, 0.02, 0.12], [0.84, 0.18, 0.03, 0.1], [0.97, 0.16, 0.03, 0.09]],
        jaw: [[0.18, 0.2, 0.15], [0.5, 0.12, 0.1], [0.9, 0.08, 0.07]], slitY: -0.2, slitA: [0.65, 1.0],
        nose: { a: 0.96, b: 0.0, w: 0.075, h: 0.065, d: 0.04, nostril: 0.02 },
        eye: { a: 0.3, b: 0.33, x: 0.2, r: 0.068, dir: [0.8, 0.22, 0.56], open: 0.72 }, canine: 0,
      },
      ear: { type: 'side', len: 0.4, w: 0.13, ang: 8, a: 0.12, b: 0.24, x: 0.2 },
      fore: [[0, 0.03, 0.07, 0.06], [0.5, 0.06, 0.08, 0.08], [1, 0.07, 0.08, 0.09], [1.5, 0.06, 0.06, 0.08], [2, 0.04, 0.045, 0.045], [2.3, 0.035, 0.04, 0.03], [3, 0.026, 0.026, 0.024], [4, 0.03, 0.028, 0.03]],
      hind: [[0, 0.09, 0.12, 0.15], [0.45, 0.085, 0.09, 0.12], [1, 0.05, 0.05, 0.06], [1.4, 0.04, 0.035, 0.06], [2, 0.03, 0.03, 0.04], [3, 0.03, 0.028, 0.03]],
      foot: { type: 'cloven', size: 0.75, hoofH: 1.0 },
      tail: { len: 0.16, r: 0.04, carry: 55, curl: 0, taper: 0.5, bones: 2 },
      extras: (B, c) => {
        goatHorns(B, c, { len: 1.0, r: 0.07 });
        const { hp, HL } = c; // beard
        B.loft([{ p: hp(0.78, -0.3), w: 0.045 * HL, ht: 0.045 * HL, hb: 0.045 * HL }, { p: V.add(hp(0.78, -0.3), [0, -0.18 * HL, -0.04 * HL]), w: 0.04 * HL, ht: 0.035 * HL, hb: 0.035 * HL }, { p: V.add(hp(0.78, -0.3), [0, -0.34 * HL, -0.1 * HL]), w: 0.015 * HL, ht: 0.015 * HL, hb: 0.015 * HL }], { bones: ['jaw'], part: 'beard', k: 0.03 * HL, noise: { amp: 0.01 * HL, freq: 40 / HL, seed: 5 } });
      },
    }),
    coat: mkCoat({ under: 0.4, shade: 0.3 }),
    fur: furShort, iris: '#b8943a', pupil: 'bar',
    palettes: [
      { id: 'bianca', label: 'Bianca', colors: { base: '#ebe6dc', under: '#f2eee7', nose: '#c9a49a', keratin: '#8a7e6e' } },
      { id: 'camoscio', label: 'Camosciata', colors: { base: '#8a5a32', under: '#3a2a20', nose: '#2a2220', keratin: '#3a3430' } },
      { id: 'nera', label: 'Nera', colors: { base: '#262321', under: '#2e2a28', nose: '#1a1817', keratin: '#3a3430' } },
    ],
  },
  {
    id: 'cervo', label: 'Cervo', group: 'selvatici', family: 'quadruped', gait: 'unguligrade', tris: 27000,
    build: () => quadruped({
      H: 1.2,
      torso: [[-0.52, 0.88, 0.62, 0.06], [-0.44, 0.98, 0.56, 0.13], [-0.3, 0.99, 0.55, 0.16], [-0.12, 0.97, 0.54, 0.17], [0.06, 0.98, 0.52, 0.18], [0.22, 1.0, 0.53, 0.17], [0.36, 1.0, 0.56, 0.15], [0.46, 0.9, 0.6, 0.12], [0.54, 0.78, 0.64, 0.07]],
      hip: [0.1, 0.84, -0.36], knee: [0.115, 0.6, -0.22], hock: [0.08, 0.38, -0.48], hpaw: [0.075, 0.1, -0.44],
      scap: [0.09, 0.95, 0.26], shoulder: [0.12, 0.72, 0.46], elbow: [0.125, 0.58, 0.34], wrist: [0.1, 0.3, 0.37], fpaw: [0.095, 0.1, 0.38],
      spine: [[-0.22, 0.92], [0.02, 0.92], [0.26, 0.95]], tailBase: [-0.52, 0.9],
      neck: { base: [0.43, 0.88], ang: 56, len: 0.6, w0: 0.12, h0: 0.22, w1: 0.07, h1: 0.11 },
      head: {
        len: 0.36, pitch: 40, w: 0.42, cranium: [0.22, 0.28],
        muzzle: [[0.34, 0.28, 0.02, 0.16], [0.58, 0.21, 0.02, 0.12], [0.82, 0.17, 0.03, 0.1], [0.97, 0.16, 0.03, 0.1]],
        jaw: [[0.15, 0.24, 0.15], [0.45, 0.14, 0.1], [0.9, 0.08, 0.08]], slitY: -0.2, slitA: [0.7, 1.0],
        nose: { a: 0.96, b: 0.0, w: 0.08, h: 0.07, d: 0.04, nostril: 0.024 },
        eye: { a: 0.3, b: 0.32, x: 0.19, r: 0.07, dir: [0.8, 0.22, 0.56], open: 0.75 }, canine: 0,
      },
      ear: { type: 'erect', len: 0.42, w: 0.2, ang: 38, a: 0.1, b: 0.28, x: 0.17, face: 0.6 },
      fore: [[0, 0.03, 0.08, 0.06], [0.5, 0.065, 0.09, 0.09], [1, 0.075, 0.09, 0.1], [1.5, 0.065, 0.065, 0.09], [2, 0.045, 0.05, 0.05], [2.3, 0.04, 0.045, 0.034], [3, 0.026, 0.028, 0.026], [4, 0.03, 0.028, 0.03]],
      hind: [[0, 0.09, 0.12, 0.15], [0.4, 0.085, 0.1, 0.13], [1, 0.055, 0.06, 0.07], [1.3, 0.045, 0.04, 0.075], [2, 0.032, 0.032, 0.045], [3, 0.03, 0.028, 0.032]],
      foot: { type: 'cloven', size: 0.8, hoofH: 1.0 },
      tail: { len: 0.14, r: 0.04, carry: -70, curl: 0, taper: 0.4, bones: 2 },
      extras: (B, c) => { antlers(B, c, { size: 1 }); const { H } = c; B.loft([{ p: V.add(c.neckBase, V.mul(c.nd, c.NL * 0.2)), w: 0.13 * H, ht: 0.2 * H, hb: 0.25 * H }, { p: V.add(c.neckBase, V.mul(c.nd, c.NL * 0.7)), w: 0.08 * H, ht: 0.12 * H, hb: 0.16 * H }], { bones: ['neck1', 'neck2'], part: 'ruff', k: 0.05 * H, up: [0, 1, -0.6], noise: { amp: 0.012 * H, freq: 18 / H, seed: 4 } }); },
    }),
    coat: mkCoat({ under: 0.6, extra: { rump: 1, tailTip: 0.01 }, muzzle: 0.4, shade: 0.3 }),
    fur: furShort, iris: '#2e1e14', pupil: 'bar',
    palettes: [
      { id: 'rosso', label: 'Rosso', colors: { base: '#8a5a36', under: '#b89a78', extra: '#e0cfb0', points: '#4a3424', keratin: '#d6c6a6' } },
      { id: 'grigio', label: 'Invernale', colors: { base: '#6e5e4e', under: '#9a8a76', extra: '#d8cbb4', points: '#3a2e24', keratin: '#d6c6a6' } },
    ],
  },
  {
    id: 'cinghiale', label: 'Cinghiale', group: 'selvatici', family: 'quadruped', gait: 'unguligrade', tris: 23000,
    build: () => quadruped({
      H: 0.85,
      torso: [[-0.6, 0.8, 0.52, 0.08], [-0.5, 0.86, 0.45, 0.16], [-0.3, 0.88, 0.41, 0.19], [-0.05, 0.92, 0.39, 0.2], [0.2, 0.99, 0.4, 0.205], [0.38, 1.03, 0.44, 0.2], [0.52, 0.96, 0.49, 0.17], [0.62, 0.82, 0.55, 0.11]],
      hip: [0.11, 0.6, -0.44], knee: [0.13, 0.4, -0.31], hock: [0.095, 0.2, -0.49], hpaw: [0.09, 0.07, -0.46],
      scap: [0.1, 0.95, 0.3], shoulder: [0.145, 0.62, 0.52], elbow: [0.15, 0.42, 0.4], wrist: [0.12, 0.2, 0.44], fpaw: [0.115, 0.07, 0.46],
      spine: [[-0.3, 0.76], [0.02, 0.82], [0.3, 0.9]], tailBase: [-0.59, 0.78],
      neck: { base: [0.58, 0.76], ang: 8, len: 0.2, w0: 0.2, h0: 0.28, w1: 0.16, h1: 0.22 },
      head: {
        len: 0.56, pitch: 32, w: 0.46, cranium: [0.25, 0.3],
        muzzle: [[0.38, 0.32, 0.02, 0.2], [0.6, 0.2, 0.03, 0.12], [0.85, 0.13, 0.03, 0.09], [0.99, 0.13, 0.03, 0.1]], muzzleCap: 0.15,
        jaw: [[0.2, 0.22, 0.18], [0.55, 0.11, 0.11], [0.88, 0.07, 0.07]], slitY: -0.15, slitA: [0.5, 1.0],
        nose: { a: 1.01, b: -0.04, w: 0.1, h: 0.095, d: 0.025, nostril: 0.022 },
        eye: { a: 0.34, b: 0.28, x: 0.17, r: 0.035, dir: [0.65, 0.2, 0.73], open: 0.6 }, canine: 0,
      },
      ear: { type: 'erect', len: 0.24, w: 0.14, ang: 30, a: 0.18, b: 0.32, x: 0.15 },
      foot: { type: 'cloven', size: 0.85, hoofH: 1.0 },
      fore: [[0, 0.04, 0.08, 0.07], [0.5, 0.07, 0.1, 0.1], [1, 0.08, 0.1, 0.11], [1.5, 0.07, 0.07, 0.09], [2, 0.05, 0.055, 0.055], [3, 0.035, 0.035, 0.032], [4, 0.036, 0.035, 0.036]],
      hind: [[0, 0.09, 0.12, 0.15], [0.45, 0.085, 0.1, 0.12], [1, 0.055, 0.055, 0.07], [1.4, 0.045, 0.04, 0.065], [2, 0.035, 0.035, 0.045], [3, 0.034, 0.032, 0.035]],
      tail: { len: 0.32, r: 0.018, carry: -82, curl: 0, taper: 0.3, bones: 3, tuft: 0.035 },
      extras: (B, c) => {
        const { hp, HL, H } = c;
        crestMane(c, { h: 0.06, w: 0.03, start: -0.6, end: 1.05, noise: 0.45, part: 'mane' });
        B.sym((sx) => horn(B, [mx(hp(0.78, -0.17, 0.07 * HL), sx), mx(hp(0.8, -0.08, 0.1 * HL), sx), mx(hp(0.76, 0.0, 0.11 * HL), sx)], [0.018 * HL, 0.014 * HL, 0.004 * HL], ['jaw'], { part: 'tusk' }));
        void H;
      },
    }),
    coat: mkCoat({ mane: 1, legs: [0.2, 0.35], pattern: { type: 'grizzle', amount: 0.5 }, extra: { muzzle: 0.5 }, shade: 0.45 }),
    fur: furBristle, iris: '#2a1c14', pupil: 'round', teethColor: '#efe6cf',
    palettes: [
      { id: 'scuro', label: 'Bruno scuro', colors: { base: '#3e342c', pattern: '#5a4e42', points: '#1c1816', extra: '#5a4a3e', nose: '#2a2220', keratin: '#e8dcc0' } },
      { id: 'grigio', label: 'Grigio', colors: { base: '#5a544c', pattern: '#7a736a', points: '#2a2624', extra: '#6a625a', nose: '#2a2220', keratin: '#e8dcc0' } },
    ],
  },
  {
    id: 'giraffa', label: 'Giraffa', group: 'esotici', family: 'quadruped', gait: 'unguligrade', tris: 25000,
    build: () => quadruped({
      H: 3.0,
      torso: [[-0.38, 0.74, 0.6, 0.05], [-0.32, 0.81, 0.56, 0.085], [-0.2, 0.845, 0.55, 0.105], [-0.05, 0.89, 0.55, 0.115], [0.1, 0.95, 0.56, 0.115], [0.22, 1.0, 0.6, 0.105], [0.3, 0.98, 0.64, 0.085], [0.36, 0.88, 0.68, 0.05]],
      hip: [0.055, 0.74, -0.27], knee: [0.065, 0.58, -0.17], hock: [0.045, 0.36, -0.33], hpaw: [0.04, 0.06, -0.31],
      scap: [0.055, 0.95, 0.16], shoulder: [0.075, 0.76, 0.3], elbow: [0.075, 0.62, 0.22], wrist: [0.06, 0.32, 0.25], fpaw: [0.055, 0.06, 0.27],
      spine: [[-0.15, 0.78], [0.05, 0.85], [0.2, 0.92]], tailBase: [-0.37, 0.76],
      neck: { base: [0.3, 0.9], ang: 62, len: 0.64, w0: 0.065, h0: 0.12, w1: 0.03, h1: 0.05 },
      head: {
        len: 0.2, pitch: 30, w: 0.44, cranium: [0.22, 0.27],
        muzzle: [[0.34, 0.27, 0.02, 0.16], [0.58, 0.21, 0.02, 0.12], [0.82, 0.18, 0.03, 0.1], [0.97, 0.17, 0.04, 0.11]],
        jaw: [[0.15, 0.22, 0.15], [0.45, 0.13, 0.1], [0.9, 0.08, 0.08]], slitY: -0.2, slitA: [0.7, 1.0],
        nose: { a: 0.95, b: 0.0, w: 0.08, h: 0.07, d: 0.04, nostril: 0.03 },
        eye: { a: 0.3, b: 0.32, x: 0.21, r: 0.075, dir: [0.8, 0.22, 0.56], open: 0.7 }, canine: 0,
      },
      ear: { type: 'side', len: 0.4, w: 0.12, ang: 15, a: 0.06, b: 0.24, x: 0.19 },
      fore: [[0, 0.015, 0.04, 0.03], [0.5, 0.035, 0.045, 0.045], [1, 0.04, 0.045, 0.05], [1.5, 0.033, 0.034, 0.045], [2, 0.026, 0.028, 0.028], [2.3, 0.024, 0.026, 0.02], [3, 0.016, 0.016, 0.015], [4, 0.018, 0.017, 0.018]],
      hind: [[0, 0.05, 0.06, 0.08], [0.4, 0.045, 0.05, 0.07], [1, 0.03, 0.032, 0.04], [1.3, 0.026, 0.024, 0.04], [2, 0.017, 0.017, 0.024], [3, 0.018, 0.017, 0.018]],
      foot: { type: 'cloven', size: 0.5, hoofH: 1.0, dew: false },
      tail: { len: 0.32, r: 0.012, carry: -86, curl: 0, taper: 0.3, bones: 4, tuft: 0.025 },
      extras: (B, c) => {
        const { hp, HL } = c;
        crestMane(c, { h: 0.018, w: 0.006, start: 0.0, end: 1.0, noise: 0.2, part: 'mane', upright: true });
        B.sym((sx) => horn(B, [mx(hp(0.12, 0.22, 0.12 * HL), sx), mx(hp(0.08, 0.4, 0.14 * HL), sx), mx(hp(0.06, 0.48, 0.15 * HL), sx)], [0.05 * HL, 0.04 * HL, 0.055 * HL], ['head'], { part: 'ossicone', mat: 'fur' }));
      },
    }),
    coat: mkCoat({ pattern: { type: 'giraffe', scale: 7.5 }, mane: 0.6, shade: 0.2 }),
    fur: furSleek, iris: '#2a1c14', pupil: 'bar',
    palettes: [
      { id: 'reticolata', label: 'Reticolata', colors: { base: '#efe2c6', pattern: '#8a4a22', points: '#4a2e1c', nose: '#3a2e28', keratin: '#3a3430' } },
      { id: 'masai', label: 'Masai', colors: { base: '#e6d6b4', pattern: '#5a3a22', points: '#3a2618', nose: '#3a2e28', keratin: '#3a3430' } },
    ],
  },
];
