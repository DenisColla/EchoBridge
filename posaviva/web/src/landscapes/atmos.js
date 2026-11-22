// Time of day, weather and season -> atmosphere parameters (sun / moon,
// sky colours, clouds, stars, fog, ambient light, foliage palette, ground
// wetness and snow). Pure data + a seeded generator: no three.js objects.
import { clamp, lerp } from './rand.js';

export const TIMES = [
  { id: 'alba', label: 'Alba' },
  { id: 'mattino', label: 'Mattino' },
  { id: 'mezzogiorno', label: 'Mezzogiorno' },
  { id: 'tramonto', label: 'Tramonto' },
  { id: 'sera', label: 'Sera' },
  { id: 'notte', label: 'Notte' },
];
export const WEATHERS = [
  { id: 'sereno', label: 'Sereno' },
  { id: 'nuvoloso', label: 'Nuvoloso' },
  { id: 'pioggia', label: 'Pioggia' },
  { id: 'neve', label: 'Neve' },
  { id: 'nebbia', label: 'Nebbia' },
];
export const SEASONS = [
  { id: 'primavera', label: 'Primavera' },
  { id: 'estate', label: 'Estate' },
  { id: 'autunno', label: 'Autunno' },
  { id: 'inverno', label: 'Inverno' },
];

const DEG = Math.PI / 180;

/**
 * Base look of each time of day (sRGB hex). relAz: sun azimuth relative to the
 * camera (0 = from the camera, 180 = from behind the subject), degrees.
 */
const TIME = {
  alba: { el: [3, 9], relAz: [55, 120], kelvin: [2700, 3300], int: [1.9, 2.4], soft: 0.3,
    zenith: '#58709f', horizon: '#f2b48a', sunGlow: '#ffc690', amb: 0.62, ambColor: '#aab3d6', ambGround: '#5f4c40', fog: '#d8b49c', fogD: 0.0032, stars: 0.05, lamps: false },
  mattino: { el: [22, 38], relAz: [35, 75], kelvin: [4700, 5400], int: [2.6, 3.0], soft: 0.22,
    zenith: '#3b76c6', horizon: '#bdd6ec', sunGlow: '#fff2d8', amb: 0.72, ambColor: '#bcd0ef', ambGround: '#5a5246', fog: '#c6d8ea', fogD: 0.0021, stars: 0, lamps: false },
  mezzogiorno: { el: [55, 70], relAz: [20, 65], kelvin: [5600, 6200], int: [3.0, 3.3], soft: 0.18,
    zenith: '#2c6cc8', horizon: '#c7dbee', sunGlow: '#ffffff', amb: 0.78, ambColor: '#c4d6f2', ambGround: '#5c5448', fog: '#cddcea', fogD: 0.0017, stars: 0, lamps: false },
  tramonto: { el: [2, 7], relAz: [110, 160], kelvin: [2000, 2500], int: [2.6, 3.2], soft: 0.32,
    zenith: '#3a4b84', horizon: '#ff9551', sunGlow: '#ffae5e', amb: 0.6, ambColor: '#8f80d6', ambGround: '#5c3b2a', fog: '#e59d72', fogD: 0.0028, stars: 0.02, lamps: false },
  sera: { el: [-4, -1.5], relAz: [120, 170], kelvin: [9000, 12000], int: [0.8, 1.1], soft: 0.6,
    zenith: '#17234a', horizon: '#5d628f', sunGlow: '#d9866a', amb: 0.6, ambColor: '#5a6bb0', ambGround: '#1e1d2a', fog: '#3f4a72', fogD: 0.0038, stars: 0.35, lamps: true },
  notte: { el: [28, 52], relAz: [-70, -25], kelvin: [7600, 9500], int: [1.0, 1.35], soft: 0.42,
    zenith: '#050a1a', horizon: '#16213d', sunGlow: '#9fb4ff', amb: 0.44, ambColor: '#2f4277', ambGround: '#0d111d', fog: '#0f1830', fogD: 0.0045, stars: 1, lamps: true },
};

const WEATHER = {
  sereno: { cloud: [0.02, 0.28], sun: 1, soft: 0, amb: 1, grey: 0, greyC: '#9aa3ad', fogK: 1, dark: 0 },
  nuvoloso: { cloud: [0.62, 0.85], sun: 0.4, soft: 0.6, amb: 1.25, grey: 0.5, greyC: '#a4abb4', fogK: 1.5, dark: 0.12 },
  pioggia: { cloud: [0.92, 1], sun: 0.22, soft: 0.9, amb: 1.12, grey: 0.78, greyC: '#6f7782', fogK: 3.2, dark: 0.35, rain: true, wet: 1 },
  neve: { cloud: [0.85, 1], sun: 0.3, soft: 0.9, amb: 1.35, grey: 0.72, greyC: '#c4c9d1', fogK: 3.4, dark: 0.1, snow: true, snowCover: 1 },
  nebbia: { cloud: [0.4, 0.7], sun: 0.3, soft: 0.95, amb: 1.3, grey: 0.6, greyC: '#b7bcc2', fogK: 1, fogAbs: [0.022, 0.034], dark: 0.05 },
};

/** Foliage / ground palettes per season (sRGB hex). */
export const SEASON_LOOK = {
  primavera: { leaf: ['#5f8f3a', '#73a045', '#86b04e', '#6a9a3e'], blossom: ['#f3c9d8', '#f9e6ee', '#ffffff', '#e9a9c3'], blossomP: 0.22, grass: '#6f9a43', dry: 0, snow: 0, flowers: 1 },
  estate: { leaf: ['#3f5f2c', '#4d6e32', '#5c7c3a', '#41632f'], blossom: null, blossomP: 0, grass: '#6a8c3d', dry: 0.25, snow: 0, flowers: 0.5 },
  autunno: { leaf: ['#b5531c', '#d27a22', '#e2a531', '#9c3a1a', '#c9662a', '#7f7a2a'], blossom: null, blossomP: 0, grass: '#8a8a45', dry: 0.6, snow: 0, flowers: 0.1 },
  inverno: { leaf: ['#3e5536', '#47603b', '#3a4f33'], bare: true, blossom: null, blossomP: 0, grass: '#7c8463', dry: 0.5, snow: 0.35, flowers: 0 },
};

const mixHex = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p, s) => (p >> s) & 255;
  const m = (s) => Math.round(lerp(ch(pa, s), ch(pb, s), t));
  return '#' + ((1 << 24) | (m(16) << 8 << 8) | (m(8) << 8) | m(0)).toString(16).slice(1);
};
export { mixHex };

/**
 * Atmosphere of a resolved spec. rng: seeded generator (sun angles, clouds...).
 * Returns plain data in sRGB hex / degrees.
 */
export function atmosphere({ time, weather, season }, rng) {
  const T = TIME[time] || TIME.mattino, W = WEATHER[weather] || WEATHER.sereno, S = SEASON_LOOK[season] || SEASON_LOOK.estate;
  const night = time === 'notte', dusk = time === 'sera';
  const el = rng.range(T.el[0], T.el[1]);
  const relAz = rng.sign() * rng.range(Math.abs(T.relAz[0]), Math.abs(T.relAz[1])) * (T.relAz[0] < 0 ? -1 : 1);
  const kelvin = rng.range(T.kelvin[0], T.kelvin[1]);
  const cloud = clamp(rng.range(W.cloud[0], W.cloud[1]), 0, 1);
  const grey = W.grey;
  // dark weather at night stays dark: no grey veil brighter than the night sky
  const gC = night || dusk ? mixHex(W.greyC, '#101420', 0.82) : W.greyC;
  const zenith = mixHex(T.zenith, gC, grey * (night ? 0.4 : 1));
  const horizon = mixHex(T.horizon, gC, grey * 0.85 * (night ? 0.5 : 1));
  let fog = mixHex(T.fog, gC, grey * 0.8);
  let fogD = T.fogD * W.fogK;
  if (W.fogAbs) { fogD = rng.range(W.fogAbs[0], W.fogAbs[1]); fog = mixHex(horizon, '#c8ccd0', night ? 0 : 0.35); }
  // snow scenes: whiter fog / horizon in daylight
  if (W.snow && !night) fog = mixHex(fog, '#e4e8ee', 0.5);
  const sunVisible = !night && el > -1;
  const sun = {
    relAz, el: night ? el : Math.max(el, dusk ? 3 : el), // at dusk the key is the bright sky where the sun went down
    kelvin: night ? kelvin : kelvin,
    color: null,
    intensity: rng.range(T.int[0], T.int[1]) * (night ? Math.max(0.55, W.sun * 1.6) : W.sun),
    soft: clamp(T.soft + W.soft, 0.1, 1),
    shadow: true,
    name: night ? 'Luna' : dusk ? 'Cielo' : 'Sole',
  };
  // cool fill from the opposite side of the sky (off at night: the ambient does it)
  const rim = night ? null : {
    relAz: relAz + 180 + rng.range(-25, 25), el: rng.range(18, 35), kelvin: dusk ? 11000 : time === 'tramonto' || time === 'alba' ? 9000 : 8000,
    intensity: (dusk ? 0.25 : 0.5) * (1 - W.grey * 0.5), name: 'Cielo',
  };
  const ambient = {
    intensity: T.amb * W.amb,
    color: mixHex(T.ambColor, gC, grey * 0.6),
    ground: mixHex(T.ambGround, S.snow > 0.5 || W.snowCover ? '#8a8f98' : T.ambGround, W.snowCover ? 0.6 : 0),
  };
  return {
    time, weather, season, night, dusk,
    sun, rim, ambient,
    sky: {
      zenith, horizon, sunGlow: T.sunGlow,
      sunEl: night ? -20 : dusk ? T.el[0] : el, sunRelAz: relAz,
      sunVisible, moon: night, moonEl: night ? el : -30, moonRelAz: relAz,
      cloud, cloudDark: W.dark + (night ? 0.4 : 0), stars: T.stars * (1 - cloud * 0.85),
      haze: clamp(0.25 + grey * 0.5, 0, 1),
    },
    fog: { color: fog, density: fogD },
    lamps: T.lamps || (weather === 'pioggia' && time === 'tramonto'),
    rain: !!W.rain, snow: !!W.snow, wet: W.wet || 0,
    snowCover: Math.max(W.snowCover || 0, season === 'inverno' ? (weather === 'neve' ? 1 : rng.chance(0.35) ? 0.55 : 0) : 0),
    foliage: S,
    DEG,
  };
}
