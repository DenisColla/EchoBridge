// Dogs, wolf, fox, cat, lion, tiger (quadruped archetype, digitigrade paws).
import { quadruped, DOG } from './quadruped.js';
import { mkCoat } from './coat.js';
import { mx, V } from './builder.js';

const furShort = { type: 'short', scale: 14, normalScale: 0.2, roughness: 0.84, sheen: 0.35 };
const furLong = { type: 'long', scale: 9, normalScale: 0.3, roughness: 0.86, sheen: 0.45 };
const furCat = { type: 'short', scale: 26, normalScale: 0.22, roughness: 0.8, sheen: 0.4 };

/** Torso stations scaled: z (length), width, and a vertical squash of the chest. */
const torso = (T, { z = 1, w = 1, bot = 1 } = {}) => T.map(([zz, t, b, ww, wd]) => [zz * z, t, 1 - (1 - b) * bot, ww * w, wd]);
const scaleJ = (j, { x = 1, y = 1, z = 1 }) => [j[0] * x, j[1] * y, j[2] * z];

/** Neck ruff / cheek fur (wolf, fox, tiger). */
function ruff(amount, k = 1) {
  return (B, c) => {
    const { H, hp, HL, HW } = c;
    B.sym((sx) => B.ell(mx(hp(0.16, -0.12, HW * 0.36), sx), [0.06 * H * amount * k, 0.1 * H * amount, 0.085 * H * amount], { bones: ['head', 'neck2'], part: 'ruff', k: 0.04 * H, noise: { amp: 0.012 * H * amount, freq: 22 / H, seed: 9 } }));
    B.loft([
      { p: V.add(c.neckBase, V.mul(c.nd, c.NL * 0.25)), w: c.s.neck.w0 * H * 1.1 * amount, ht: c.s.neck.h0 * H * 1.0, hb: c.s.neck.h0 * H * 1.2 * amount },
      { p: V.add(c.neckBase, V.mul(c.nd, c.NL * 0.75)), w: c.s.neck.w1 * H * 1.25 * amount, ht: c.s.neck.h1 * H * 1.0, hb: c.s.neck.h1 * H * 1.35 * amount },
    ], { bones: ['neck1', 'neck2'], part: 'ruff', k: 0.05 * H, up: [0, 1, -0.6], noise: { amp: 0.01 * H * amount, freq: 18 / H, seed: 7 } });
    void HL;
  };
}

export const CARNIVORES = [
  {
    id: 'cane_medio', label: 'Cane medio', sub: 'Labrador', group: 'domestici', family: 'quadruped', gait: 'digitigrade', tris: 22000,
    build: () => quadruped({}),
    coat: mkCoat({ under: 0.25, shade: 0.3 }),
    fur: furShort, iris: '#5a3518', pupil: 'round',
    palettes: [
      { id: 'miele', label: 'Miele', colors: { base: '#c9974f', under: '#ddb983', nose: '#2a2220' } },
      { id: 'nero', label: 'Nero', colors: { base: '#1d1b1a', under: '#262321', nose: '#141212' } },
      { id: 'cioccolato', label: 'Cioccolato', colors: { base: '#5b3622', under: '#6b4129', nose: '#3a2620' } },
      { id: 'crema', label: 'Crema', colors: { base: '#e2c99b', under: '#efdcb8', nose: '#3a2a22' } },
    ],
  },
  {
    id: 'cane_grande', label: 'Cane grande', sub: 'Pastore tedesco', group: 'domestici', family: 'quadruped', gait: 'digitigrade', tris: 23000,
    build: () => quadruped({
      H: 0.63,
      torso: [[-0.66, 0.78, 0.64, 0.07], [-0.58, 0.9, 0.58, 0.13], [-0.44, 0.93, 0.6, 0.15], [-0.24, 0.95, 0.66, 0.15], [-0.04, 0.97, 0.52, 0.175], [0.16, 0.99, 0.45, 0.19], [0.32, 1.0, 0.45, 0.185], [0.46, 0.92, 0.49, 0.155], [0.6, 0.74, 0.55, 0.09]],
      hip: [0.1, 0.7, -0.46], knee: [0.12, 0.41, -0.25], hock: [0.095, 0.2, -0.66], hpaw: [0.09, 0.045, -0.6],
      scap: [0.09, 0.9, 0.26], shoulder: [0.14, 0.6, 0.53], elbow: [0.15, 0.45, 0.33], wrist: [0.125, 0.12, 0.37], fpaw: [0.125, 0.045, 0.42],
      spine: [[-0.3, 0.84], [-0.02, 0.86], [0.26, 0.89]], tailBase: [-0.64, 0.8],
      neck: { base: [0.47, 0.8], ang: 40, len: 0.5, w0: 0.14, h0: 0.19, w1: 0.09, h1: 0.11 },
      head: { len: 0.42, w: 0.52, muzzle: [[0.38, 0.32, 0.02, 0.19], [0.55, 0.25, 0.03, 0.15], [0.8, 0.21, 0.035, 0.12], [0.98, 0.18, 0.02, 0.1]], jaw: [[0.2, 0.16, 0.15], [0.5, 0.11, 0.12], [0.92, 0.08, 0.08]], nose: { a: 0.99, b: 0.03, w: 0.075, h: 0.065, d: 0.06, nostril: 0.018 }, eye: { a: 0.38, b: 0.19, x: 0.19, r: 0.05, dir: [0.5, 0.12, 0.86], open: 0.7 } },
      ear: { type: 'erect', len: 0.5, w: 0.21, ang: 14, a: 0.2, b: 0.34, x: 0.2 },
      tail: { len: 0.8, r: 0.055, carry: -62, curl: 35, bushy: 0.7, taper: 0.5 },
      extras: ruff(0.8),
    }),
    coat: mkCoat({ under: 0.4, pattern: { type: 'saddle' }, shade: 0.35 }),
    fur: furLong, iris: '#4a2a12', pupil: 'round',
    palettes: [
      { id: 'focato', label: 'Nero focato', colors: { base: '#b27a3e', under: '#c99a5e', pattern: '#1e1a17' } },
      { id: 'nero', label: 'Nero', colors: { base: '#1e1c1b', under: '#24211f', pattern: '#161413' } },
      { id: 'grigio', label: 'Grigio lupo', colors: { base: '#8f857a', under: '#b5ab9e', pattern: '#3a3532' } },
      { id: 'bianco', label: 'Bianco', colors: { base: '#e9e3d6', under: '#f2eee5', pattern: '#ddd5c6' } },
    ],
  },
  {
    id: 'cane_piccolo', label: 'Cane piccolo', sub: 'Terrier', group: 'domestici', family: 'quadruped', gait: 'digitigrade', tris: 18000,
    build: () => quadruped({
      H: 0.3,
      torso: torso(DOG.torso, { z: 0.95, w: 1.02, bot: 0.92 }),
      head: { len: 0.5, w: 0.62, muzzle: [[0.42, 0.33, 0.02, 0.2], [0.58, 0.27, 0.03, 0.17], [0.8, 0.22, 0.035, 0.14], [0.97, 0.19, 0.02, 0.12]], eye: { a: 0.42, b: 0.19, x: 0.21, r: 0.058, dir: [0.5, 0.12, 0.86] } },
      ear: { type: 'drop', a: 0.22, b: 0.36, x: 0.24, len: 0.24, w: 0.16, out: 0.12, fwd: 0.14, th: 0.035 },
      tail: { len: 0.45, r: 0.07, carry: 70, curl: -10, bones: 3, taper: 0.55 },
      neck: { base: [0.44, 0.8], ang: 48, len: 0.42 },
    }),
    coat: mkCoat({ under: 0.3, pattern: { type: 'patches', freq: 2.6, thr: 0.12, seed: 5, legsWhite: [0.4, 0.6] }, extra: { head: 0.0 }, shade: 0.25 }),
    fur: furShort, iris: '#3e2410', pupil: 'round',
    palettes: [
      { id: 'tricolore', label: 'Bianco e focato', colors: { base: '#f0ebe1', under: '#f6f2ea', pattern: '#a86a36', nose: '#1d1a19' } },
      { id: 'nero', label: 'Bianco e nero', colors: { base: '#f0ebe1', under: '#f6f2ea', pattern: '#1f1c1b' } },
      { id: 'focato', label: 'Focato', colors: { base: '#b07a45', under: '#d4b48b', pattern: '#7a4a22' } },
      { id: 'grigio', label: 'Grigio', colors: { base: '#8b8987', under: '#b9b5af', pattern: '#5b5957' } },
    ],
  },
  {
    id: 'lupo', label: 'Lupo', group: 'selvatici', family: 'quadruped', gait: 'digitigrade', tris: 23000,
    build: () => quadruped({
      H: 0.8,
      torso: [[-0.6, 0.82, 0.68, 0.06], [-0.52, 0.94, 0.62, 0.12], [-0.38, 0.96, 0.62, 0.14], [-0.2, 0.96, 0.64, 0.14], [-0.02, 0.97, 0.54, 0.16], [0.16, 0.99, 0.48, 0.17], [0.3, 1.0, 0.48, 0.165], [0.44, 0.92, 0.52, 0.14], [0.56, 0.75, 0.57, 0.085]],
      hip: [0.09, 0.74, -0.42], knee: [0.11, 0.45, -0.23], hock: [0.09, 0.23, -0.57], hpaw: [0.085, 0.045, -0.53],
      scap: [0.08, 0.9, 0.24], shoulder: [0.12, 0.62, 0.48], elbow: [0.13, 0.48, 0.3], wrist: [0.11, 0.13, 0.33], fpaw: [0.11, 0.045, 0.37],
      neck: { base: [0.42, 0.8], ang: 30, len: 0.42, w0: 0.13, h0: 0.2, w1: 0.1, h1: 0.12 },
      head: { len: 0.36, w: 0.55, muzzle: [[0.42, 0.3, 0.02, 0.19], [0.58, 0.24, 0.03, 0.15], [0.8, 0.2, 0.035, 0.12], [0.98, 0.17, 0.02, 0.1]], jaw: [[0.2, 0.16, 0.16], [0.5, 0.12, 0.12], [0.92, 0.08, 0.08]], eye: { a: 0.4, b: 0.2, x: 0.2, r: 0.048, dir: [0.45, 0.12, 0.88], open: 0.62 }, canine: 0.1 },
      ear: { type: 'erect', len: 0.38, w: 0.2, ang: 18, a: 0.22, b: 0.34, x: 0.22 },
      tail: { len: 0.6, r: 0.06, carry: -75, curl: 10, bushy: 0.9, taper: 0.4 },
      foot: { size: 1.05 }, legR: 0.92,
      extras: ruff(1),
    }),
    coat: mkCoat({ under: { amount: 0.85 }, pattern: { type: 'grizzle', amount: 0.7 }, muzzle: 0, extra: { muzzle: 0.7, tailTip: 0.85 }, shade: 0.4 }),
    fur: furLong, iris: '#c89a3a', pupil: 'round',
    palettes: [
      { id: 'grigio', label: 'Grigio', colors: { base: '#8a8178', under: '#d6d0c6', pattern: '#4a443f', extra: '#2a2624' } },
      { id: 'bruno', label: 'Bruno', colors: { base: '#7a6046', under: '#c9b190', pattern: '#3e3024', extra: '#241c16' } },
      { id: 'nero', label: 'Nero', colors: { base: '#2b2928', under: '#4a4644', pattern: '#1b1a19', extra: '#151413' } },
      { id: 'artico', label: 'Artico', colors: { base: '#e7e3da', under: '#f1eee8', pattern: '#cfc9bd', extra: '#bdb6aa' } },
    ],
  },
  {
    id: 'volpe', label: 'Volpe', group: 'selvatici', family: 'quadruped', gait: 'digitigrade', tris: 21000,
    build: () => quadruped({
      H: 0.38,
      torso: torso(DOG.torso, { z: 1.18, w: 0.82, bot: 0.8 }),
      hip: [0.09, 0.74, -0.5], knee: [0.11, 0.45, -0.28], hock: [0.09, 0.23, -0.64], hpaw: [0.085, 0.045, -0.6],
      scap: [0.08, 0.9, 0.28], shoulder: [0.12, 0.6, 0.58], elbow: [0.13, 0.47, 0.38], wrist: [0.11, 0.13, 0.41], fpaw: [0.11, 0.045, 0.45],
      spine: [[-0.33, 0.86], [-0.02, 0.87], [0.28, 0.89]], tailBase: [-0.7, 0.85],
      neck: { base: [0.52, 0.8], ang: 34, len: 0.42, w0: 0.13, h0: 0.18, w1: 0.09, h1: 0.11 },
      head: { len: 0.42, w: 0.5, muzzle: [[0.42, 0.3, 0.02, 0.18], [0.58, 0.22, 0.02, 0.13], [0.8, 0.17, 0.025, 0.1], [0.98, 0.14, 0.02, 0.075]], jaw: [[0.2, 0.15, 0.15], [0.5, 0.1, 0.11], [0.92, 0.065, 0.06]], nose: { a: 0.99, b: 0.02, w: 0.055, h: 0.05, d: 0.05, nostril: 0.014 }, eye: { a: 0.4, b: 0.2, x: 0.19, r: 0.052, dir: [0.45, 0.14, 0.88], open: 0.6 } },
      ear: { type: 'erect', len: 0.56, w: 0.27, ang: 20, a: 0.22, b: 0.32, x: 0.2 },
      tail: { len: 1.0, r: 0.075, carry: -28, curl: 12, bushy: 1.35, taper: 0.35, bones: 5 },
      extras: ruff(0.9, 1.1),
    }),
    coat: mkCoat({ legs: [0.22, 0.4], ears: 'back', extra: { tailTip: 0.84, under: 1.1, muzzle: 0.55, chest: 0.9 }, shade: 0.3 }),
    fur: furLong, iris: '#d29a2c', pupil: 'slit',
    palettes: [
      { id: 'rossa', label: 'Rossa', colors: { base: '#c2632a', points: '#231b17', extra: '#f1ebe1' } },
      { id: 'argentata', label: 'Argentata', colors: { base: '#3b3735', points: '#151313', extra: '#ece8e0' } },
      { id: 'artica', label: 'Artica', colors: { base: '#ece9e3', points: '#d6d1c8', extra: '#f7f5f1' } },
    ],
  },
  {
    id: 'gatto', label: 'Gatto', group: 'domestici', family: 'quadruped', gait: 'digitigrade', tris: 20000,
    build: () => quadruped({
      H: 0.25,
      torso: [[-0.78, 0.86, 0.68, 0.08], [-0.68, 1.02, 0.6, 0.16], [-0.5, 1.04, 0.56, 0.19], [-0.25, 1.0, 0.53, 0.2], [0.0, 0.98, 0.5, 0.2], [0.22, 0.98, 0.48, 0.2], [0.4, 0.99, 0.5, 0.18], [0.56, 0.9, 0.54, 0.14], [0.68, 0.74, 0.58, 0.08]],
      hip: [0.11, 0.8, -0.56], knee: [0.13, 0.5, -0.32], hock: [0.11, 0.3, -0.74], hpaw: [0.1, 0.05, -0.66],
      scap: [0.1, 0.92, 0.36], shoulder: [0.14, 0.64, 0.6], elbow: [0.15, 0.5, 0.42], wrist: [0.13, 0.13, 0.46], fpaw: [0.13, 0.05, 0.5],
      spine: [[-0.38, 0.9], [-0.05, 0.88], [0.34, 0.9]], tailBase: [-0.76, 0.9],
      neck: { base: [0.56, 0.82], ang: 50, len: 0.36, w0: 0.16, h0: 0.2, w1: 0.13, h1: 0.15 },
      head: {
        len: 0.36, w: 0.95, pitch: 4, cranium: [0.36, 0.38],
        muzzle: [[0.6, 0.3, 0.03, 0.24], [0.72, 0.25, 0.05, 0.22], [0.86, 0.2, 0.05, 0.17], [0.93, 0.16, 0.03, 0.11]], muzzleCap: 0.7,
        jaw: [[0.3, 0.14, 0.22], [0.65, 0.1, 0.15], [0.88, 0.07, 0.08]], slitA: [0.7, 0.96],
        nose: { a: 0.93, b: 0.05, w: 0.07, h: 0.045, d: 0.04, nostril: 0.012 },
        eye: { a: 0.56, b: 0.27, x: 0.24, r: 0.1, dir: [0.3, 0.06, 0.95], open: 0.74 }, canine: 0.07, cheekA: 0.56,
      },
      ear: { type: 'erect', len: 0.4, w: 0.27, ang: 26, a: 0.3, b: 0.4, x: 0.3, face: 0.2 },
      tail: { len: 1.1, r: 0.055, carry: -35, curl: 75, taper: 0.35, bones: 6 },
      foot: { size: 0.95, claws: false }, thighD: 1.1,
    }),
    coat: mkCoat({ under: 0.6, pattern: { type: 'tabby', width: 0.22, freq: 1.5, breakup: 0.35, belly: 0.9, headK: 0.5 }, extra: { muzzle: 0.0 }, shade: 0.3 }),
    fur: furCat, iris: '#9aa53a', pupil: 'slit',
    palettes: [
      { id: 'tigrato', label: 'Tigrato', colors: { base: '#8c7a62', under: '#c9b89c', pattern: '#3a3026' } },
      { id: 'rosso', label: 'Rosso', colors: { base: '#d08a4a', under: '#e8c49a', pattern: '#a65a24' } },
      { id: 'nero', label: 'Nero', colors: { base: '#1c1b1b', under: '#242222', pattern: '#141313' } },
      { id: 'grigio', label: 'Grigio', colors: { base: '#8d9096', under: '#b8bbc0', pattern: '#5e6167' } },
      { id: 'bianco', label: 'Bianco', colors: { base: '#eeebe6', under: '#f6f4f0', pattern: '#e3dfd8', nose: '#d58a88' } },
    ],
  },
  {
    id: 'leone', label: 'Leone', group: 'esotici', family: 'quadruped', gait: 'digitigrade', tris: 26000,
    build: () => quadruped({
      H: 1.1,
      torso: [[-0.88, 0.82, 0.64, 0.09], [-0.78, 0.93, 0.56, 0.17], [-0.6, 0.94, 0.58, 0.19], [-0.35, 0.93, 0.6, 0.19], [-0.1, 0.96, 0.5, 0.21], [0.15, 0.99, 0.45, 0.225], [0.35, 1.0, 0.44, 0.22], [0.52, 0.92, 0.47, 0.18], [0.66, 0.74, 0.54, 0.1]],
      hip: [0.12, 0.72, -0.64], knee: [0.14, 0.43, -0.38], hock: [0.115, 0.22, -0.78], hpaw: [0.11, 0.055, -0.72],
      scap: [0.11, 0.9, 0.3], shoulder: [0.16, 0.58, 0.58], elbow: [0.17, 0.43, 0.38], wrist: [0.15, 0.12, 0.42], fpaw: [0.15, 0.055, 0.47],
      spine: [[-0.45, 0.85], [-0.05, 0.87], [0.3, 0.89]], tailBase: [-0.86, 0.84],
      neck: { base: [0.52, 0.78], ang: 22, len: 0.42, w0: 0.17, h0: 0.22, w1: 0.13, h1: 0.16 },
      head: {
        len: 0.36, w: 0.8, pitch: 8, cranium: [0.3, 0.36],
        muzzle: [[0.56, 0.36, 0.03, 0.27], [0.7, 0.3, 0.06, 0.25], [0.86, 0.25, 0.07, 0.21], [0.95, 0.21, 0.05, 0.16]], muzzleCap: 0.75,
        jaw: [[0.22, 0.2, 0.22], [0.6, 0.15, 0.18], [0.9, 0.12, 0.12]], slitA: [0.6, 1.0],
        nose: { a: 0.99, b: 0.03, w: 0.09, h: 0.065, d: 0.05, nostril: 0.018 },
        eye: { a: 0.48, b: 0.26, x: 0.25, r: 0.045, dir: [0.36, 0.1, 0.93], open: 0.66 }, canine: 0.11, cheekA: 0.5,
      },
      ear: { type: 'round', len: 0.16, w: 0.16, a: 0.2, b: 0.4, x: 0.3 },
      tail: { len: 0.85, r: 0.032, carry: -72, curl: 30, taper: 0.25, tuft: 0.055, bones: 6 },
      foot: { size: 1.25 }, legR: 1.2, thighW: 1.1, blend: 1.1,
      extras: (B, c) => { // mane
        const { H, hp, HW, HL } = c;
        B.loft([
          { p: V.add(c.neckBase, [0, 0.08 * H, -0.06 * H]), w: 0.18 * H, ht: 0.2 * H, hb: 0.14 * H },
          { p: V.add(c.neckMid, [0, 0.06 * H, 0]), w: 0.24 * H, ht: 0.24 * H, hb: 0.26 * H },
          { p: hp(0.12, -0.02), w: HW * 0.95, ht: 0.34 * HL, hb: 0.5 * HL },
          { p: hp(0.3, -0.06), w: HW * 0.72, ht: 0.24 * HL, hb: 0.3 * HL },
        ], { bones: ['neck1', 'neck2', 'head'], part: 'mane', k: 0.05 * H, up: [0, 1, -0.3], noise: { amp: 0.03 * H, freq: 8 / H, seed: 5, oct: 4 }, caps: [0.6, 0.7] });
        B.ell([0, 0.55 * H, 0.52 * H], [0.12 * H, 0.15 * H, 0.1 * H], { bones: ['chest'], part: 'mane', k: 0.05 * H, noise: { amp: 0.02 * H, freq: 10 / H, seed: 6 } });
      },
    }),
    coat: mkCoat({ under: 0.55, mane: 1, extra: { muzzle: 0.5 }, eyes: 0.0, shade: 0.35 }),
    fur: furShort, iris: '#b98a2e', pupil: 'round', teethColor: '#efe6cf',
    palettes: [
      { id: 'fulvo', label: 'Fulvo', colors: { base: '#c59a5a', under: '#e0c59a', points: '#5a3a22', extra: '#e8dcc6' } },
      { id: 'chiaro', label: 'Chiaro', colors: { base: '#d8b98a', under: '#eadbbf', points: '#8a5a32', extra: '#efe6d6' } },
      { id: 'bianco', label: 'Bianco', colors: { base: '#e8e0d0', under: '#f2ece2', points: '#cdbfa6', extra: '#f4f0e8' } },
    ],
  },
  {
    id: 'tigre', label: 'Tigre', group: 'esotici', family: 'quadruped', gait: 'digitigrade', tris: 26000,
    build: () => quadruped({
      H: 1.0,
      torso: [[-0.92, 0.82, 0.62, 0.09], [-0.82, 0.93, 0.55, 0.17], [-0.62, 0.94, 0.56, 0.2], [-0.36, 0.93, 0.56, 0.2], [-0.1, 0.96, 0.48, 0.22], [0.15, 0.99, 0.44, 0.23], [0.36, 1.0, 0.43, 0.225], [0.54, 0.92, 0.46, 0.18], [0.68, 0.74, 0.53, 0.1]],
      hip: [0.12, 0.72, -0.68], knee: [0.14, 0.43, -0.42], hock: [0.115, 0.22, -0.82], hpaw: [0.11, 0.055, -0.76],
      scap: [0.11, 0.9, 0.32], shoulder: [0.16, 0.57, 0.6], elbow: [0.17, 0.42, 0.4], wrist: [0.15, 0.12, 0.44], fpaw: [0.15, 0.055, 0.49],
      spine: [[-0.48, 0.85], [-0.05, 0.87], [0.32, 0.89]], tailBase: [-0.9, 0.84],
      neck: { base: [0.54, 0.78], ang: 20, len: 0.42, w0: 0.17, h0: 0.22, w1: 0.13, h1: 0.16 },
      head: {
        len: 0.37, w: 0.82, pitch: 8, cranium: [0.3, 0.36],
        muzzle: [[0.56, 0.36, 0.03, 0.28], [0.7, 0.3, 0.06, 0.26], [0.86, 0.25, 0.07, 0.22], [0.95, 0.21, 0.05, 0.16]], muzzleCap: 0.75,
        jaw: [[0.22, 0.2, 0.22], [0.6, 0.15, 0.18], [0.9, 0.12, 0.12]], slitA: [0.6, 1.0],
        nose: { a: 0.99, b: 0.03, w: 0.09, h: 0.065, d: 0.05, nostril: 0.018 },
        eye: { a: 0.48, b: 0.26, x: 0.25, r: 0.045, dir: [0.36, 0.1, 0.93], open: 0.66 }, canine: 0.11, cheekA: 0.5,
      },
      ear: { type: 'round', len: 0.17, w: 0.17, a: 0.2, b: 0.38, x: 0.31 },
      tail: { len: 0.95, r: 0.05, carry: -62, curl: 35, taper: 0.4, bones: 6 },
      foot: { size: 1.25 }, legR: 1.2, thighW: 1.1, blend: 1.1,
      extras: ruff(1.0, 1.2),
    }),
    coat: mkCoat({ under: { amount: 1.0, torso: 0.05, legs: 0.2 }, pattern: { type: 'stripes', width: 0.24, freq: 1.35, breakup: 0.25, belly: 0.75, headK: 0.8 }, extra: { muzzle: 0.75, eyes: 0.8 }, shade: 0.3 }),
    fur: furShort, iris: '#c9a23a', pupil: 'round', teethColor: '#efe6cf',
    palettes: [
      { id: 'bengala', label: 'Bengala', colors: { base: '#d0782e', under: '#f2ece0', pattern: '#1a1614', extra: '#f2ece0' } },
      { id: 'bianca', label: 'Bianca', colors: { base: '#eeeae2', under: '#f6f4ef', pattern: '#2a2624', extra: '#f6f4ef', iris: '#5d8fc0' } },
      { id: 'dorata', label: 'Dorata', colors: { base: '#dca765', under: '#f3eadb', pattern: '#a8692e', extra: '#f3eadb' } },
    ],
  },
];
