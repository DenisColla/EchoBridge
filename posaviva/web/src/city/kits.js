// Ready-made exterior kits: groups of regular, editable props placed around the
// selected character (kit-local origin = where the character stands).
//   items(): [{type, params?, color?, pos: [x, z], yaw (radians)}]
// The character ends on a sidewalk / path, facing the camera side (+Z).
import { VEHICLE_COLORS } from './vehicles.js';

const PI = Math.PI, H = PI / 2;
const CW = 3.25, WW = 2.4; // default carriageway half width, sidewalk width

/** Rotates kit-local (x, z) by k quarter turns. */
const rot = (x, z, k) => { for (let i = 0; i < (k % 4 + 4) % 4; i++) [x, z] = [z, -x]; return [x, z]; };

function incrocio() {
  const it = [];
  // the character stands on the corner sidewalk (+x, +z quadrant) -> intersection center at (-ox, -oz)
  const ox = -(CW + 1.2), oz = -(CW + 6.2);
  const P = (x, z) => [x + ox, z + oz];
  it.push({ type: 'es_incrocio', params: { size: 22, crossing: true }, pos: P(0, 0), yaw: 0 });
  for (let k = 0; k < 4; k++) { const [x, z] = rot(0, 17, k); it.push({ type: 'es_strada', params: { length: 12, crossing: false }, pos: P(x, z), yaw: k * H }); }
  // traffic lights at the four corners, facing the incoming traffic of each arm
  for (let k = 0; k < 4; k++) { const [x, z] = rot(CW + 0.6, CW + 3.3, k); it.push({ type: 'es_semaforo', params: { light: k % 2 ? 'verde' : 'rosso', ped: true }, pos: P(x, z), yaw: k * H }); }
  // street lamps along the arms
  for (let k = 0; k < 4; k++) for (const d of [12, 20]) { const [x, z] = rot(-(CW + WW - 0.4), d, k); it.push({ type: 'es_lampione', params: { style: 'moderno', height: 7.5 }, pos: P(x, z), yaw: k * H + H }); }
  // corner furniture
  it.push({ type: 'es_edicola', pos: P(-(CW + WW + 2.4), -(CW + WW + 2.4)), yaw: PI / 4 });
  it.push({ type: 'es_cestino', params: { style: 'palo' }, pos: P(CW + 2.1, CW + 10.5), yaw: -H });
  it.push({ type: 'es_cassetta', pos: P(-(CW + 1.9), -(CW + 10.5)), yaw: H });
  it.push({ type: 'es_idrante', pos: P(-(CW + 0.6), CW + 11), yaw: 0 });
  it.push({ type: 'es_dissuasori', params: { style: 'metallo', count: 3 }, pos: P(CW + 4.5, -(CW + 0.6)), yaw: 0 });
  it.push({ type: 'es_cartello', params: { kind: 'pedonale', height: 2.6 }, pos: P(-(CW + 0.45), CW + 10.0), yaw: PI });
  it.push({ type: 'es_cartello', params: { kind: 'direzione', height: 2.4 }, pos: P(CW + 0.45, -(CW + 11)), yaw: 0 });
  it.push({ type: 'es_fermata', params: { width: 3.6 }, pos: P(-(CW + 16), CW + 1.75), yaw: PI });
  it.push({ type: 'es_vaso_albero', params: { seed: 5 }, pos: P(CW + 1.6, -(CW + 8)), yaw: 0 });
  it.push({ type: 'es_vaso_albero', params: { seed: 9 }, pos: P(-(CW + 1.6), -(CW + 16)), yaw: 0 });
  // traffic
  it.push({ type: 'es_berlina', color: VEHICLE_COLORS[4], pos: P(CW / 2, 15), yaw: PI });
  it.push({ type: 'es_utilitaria', color: VEHICLE_COLORS[3], pos: P(-14, CW / 2), yaw: H });
  it.push({ type: 'es_taxi', pos: P(-CW / 2, -13), yaw: 0 });
  it.push({ type: 'es_autobus', params: { length: 12 }, pos: P(16, -CW / 2), yaw: -H });
  it.push({ type: 'es_scooter', pos: P(CW / 2 + 0.6, 11.5), yaw: PI });
  return it;
}

function residenziale() {
  const it = [];
  // road along X behind the character: center line at z = zc
  const zc = -(CW + 1.3);
  for (const x of [-12, 12]) it.push({ type: 'es_strada', params: { length: 24, crossing: x > 0, laneW: 3.25, center: 'tratteggiata' }, pos: [x, zc], yaw: x > 0 ? H : -H });
  const near = zc + CW + WW, far = zc - CW - WW;
  // street trees and lamps on the far sidewalk, lamps on the near one
  for (const x of [-18, -6, 6, 18]) it.push({ type: 'es_latifoglia', params: { height: 8, width: 0.8, seed: 10 + Math.round(x) }, pos: [x, zc - CW - 1.1], yaw: 0 });
  for (const x of [-12, 0, 12]) it.push({ type: 'es_lampione', params: { style: 'classico', height: 4.2 }, pos: [x, zc - CW - 1.2], yaw: 0 });
  for (const x of [-18, -6, 6, 18]) it.push({ type: 'es_lampione', params: { style: 'classico', height: 4.2 }, pos: [x, zc + CW + 0.6], yaw: 0 });
  // parked cars along both curbs
  const cars = [['es_utilitaria', 0, -14], ['es_berlina', 4, -6.5], ['es_suv', 5, 8.5], ['es_furgone', 2, 15.5], ['es_sportiva', 7, -15], ['es_berlina', 9, 3], ['es_pickup', 10, 12]];
  cars.forEach(([type, c, x], i) => { const nearSide = i < 4; it.push({ type, color: VEHICLE_COLORS[c % VEHICLE_COLORS.length], pos: [x, nearSide ? zc + CW - 1.1 : zc - CW + 1.1], yaw: nearSide ? H : -H }); });
  it.push({ type: 'es_bici', pos: [-3.5, zc + CW + 1.6], yaw: H });
  // front gardens: low walls with hedges and gates on the far side, fence on the near side
  for (const x of [-15, -5, 5, 15]) {
    it.push({ type: 'es_muretto', params: { material: x % 10 === 5 ? 'intonaco' : 'mattoni', length: 8, height: 0.7 }, color: '#e8dcc4', pos: [x, far - 0.2], yaw: 0 });
    it.push({ type: 'es_siepe', params: { length: 7.6, height: 1.3, depth: 0.6, seed: 3 + x }, pos: [x, far - 0.8], yaw: 0 });
  }
  it.push({ type: 'es_recinzione', params: { style: 'ringhiera', length: 10, height: 1.1 }, pos: [-12, near + 0.3], yaw: 0 });
  it.push({ type: 'es_recinzione', params: { style: 'ringhiera', length: 10, height: 1.1 }, pos: [12, near + 0.3], yaw: 0 });
  it.push({ type: 'es_cespuglio', params: { size: 1.1, flowers: true, fcolor: 'rosa', seed: 4 }, pos: [-6, near + 1.4], yaw: 0 });
  it.push({ type: 'es_cespuglio', params: { size: 1.3, seed: 8 }, pos: [7, near + 1.5], yaw: 0 });
  it.push({ type: 'es_panchina', params: { style: 'classica', length: 1.8 }, pos: [3, zc + CW + 1.9], yaw: PI });
  it.push({ type: 'es_cestino', params: { style: 'palo' }, pos: [5, zc + CW + 0.35], yaw: PI });
  it.push({ type: 'es_idrante', pos: [-9, zc + CW + 0.45], yaw: 0 });
  it.push({ type: 'es_cassonetto', color: '#2f6b3a', pos: [-20, zc + CW - 0.75], yaw: 0 });
  it.push({ type: 'es_cassonetto', color: '#e2b21e', pos: [-21.9, zc + CW - 0.75], yaw: 0 });
  it.push({ type: 'es_cartello', params: { kind: 'limite', height: 2.5 }, pos: [10, zc + CW + 0.4], yaw: -H });
  return it;
}

function parco() {
  const it = [];
  it.push({ type: 'es_prato', params: { width: 34, depth: 26, density: 'bassa', bladeH: 0.12, shape: 'rettangolo' }, pos: [0, -9], yaw: 0 });
  it.push({ type: 'es_vialetto', params: { length: 14, width: 2.2, bend: 40, surface: 'ghiaia' }, pos: [-4, -4], yaw: H });
  it.push({ type: 'es_vialetto', params: { length: 16, width: 2.2, bend: -30, surface: 'ghiaia' }, pos: [7, -10], yaw: 0.3 });
  it.push({ type: 'es_laghetto', params: { size: 7, seed: 3 }, pos: [-9, -14], yaw: 0 });
  it.push({ type: 'es_salice', params: { height: 8, seed: 2 }, pos: [-14.5, -18], yaw: 0 });
  it.push({ type: 'es_quercia', params: { height: 10, seed: 5 }, pos: [10, -20], yaw: 0 });
  it.push({ type: 'es_quercia', params: { height: 9, seed: 11 }, pos: [-13, -3], yaw: 1 });
  it.push({ type: 'es_betulla', params: { height: 11, seed: 3 }, pos: [14, -5], yaw: 0 });
  it.push({ type: 'es_betulla', params: { height: 10, seed: 8 }, pos: [12.5, -8.5], yaw: 0 });
  it.push({ type: 'es_pino', params: { height: 12, seed: 4 }, pos: [2, -22], yaw: 0 });
  it.push({ type: 'es_ciliegio', params: { height: 6, seed: 6 }, pos: [4.5, -5.5], yaw: 0 });
  it.push({ type: 'es_panchina', params: { style: 'parco', length: 1.8 }, pos: [-1.2, -1.6], yaw: PI });
  it.push({ type: 'es_panchina', params: { style: 'classica', length: 1.8 }, pos: [3, -14], yaw: H });
  it.push({ type: 'es_lampione', params: { style: 'sfera', height: 3.6 }, pos: [-6.5, -1.6], yaw: 0 });
  it.push({ type: 'es_lampione', params: { style: 'sfera', height: 3.6 }, pos: [5.5, -14], yaw: 0 });
  it.push({ type: 'es_cestino', params: { style: 'colonna' }, pos: [0.6, -1.4], yaw: 0 });
  it.push({ type: 'es_fontanella', pos: [-3, -8.6], yaw: 0 });
  it.push({ type: 'es_aiuola', params: { width: 3, depth: 1.4, fcolor: 'misto', seed: 2 }, pos: [3.5, -2.2], yaw: 0 });
  it.push({ type: 'es_cespuglio', params: { size: 1.4, flowers: true, fcolor: 'rosso', seed: 12 }, pos: [-8, -6], yaw: 0 });
  it.push({ type: 'es_cespuglio', params: { size: 1.0, seed: 13 }, pos: [9, -1.8], yaw: 0 });
  it.push({ type: 'es_cespuglio', params: { size: 1.6, seed: 14 }, pos: [15, -15], yaw: 0 });
  it.push({ type: 'es_siepe', params: { length: 10, height: 1.0, depth: 0.7, seed: 2 }, pos: [-11, 3.6], yaw: 0 });
  it.push({ type: 'es_siepe', params: { length: 10, height: 1.0, depth: 0.7, seed: 6 }, pos: [11, 3.6], yaw: 0 });
  return it;
}

function bosco() {
  const it = [];
  it.push({ type: 'es_collina', params: { shape: 'ondulato', width: 40, depth: 30, height: 0.8, rough: 0.5, surface: 'terra', seed: 3 }, pos: [0, -17], yaw: 0 });
  it.push({ type: 'es_bosco', params: { count: 16, radius: 15, height: 12, mix: 'misto', seed: 7 }, pos: [0, -20], yaw: 0 });
  it.push({ type: 'es_vialetto', params: { length: 18, width: 1.4, bend: 35, surface: 'terra', edging: false }, pos: [1, -8], yaw: 0 });
  it.push({ type: 'es_abete', params: { height: 14, seed: 4 }, pos: [-5, -4.5], yaw: 0 });
  it.push({ type: 'es_quercia', params: { height: 11, seed: 9 }, pos: [6.5, -6], yaw: 0 });
  it.push({ type: 'es_betulla', params: { height: 12, seed: 2 }, pos: [-8.5, -9], yaw: 0 });
  it.push({ type: 'es_abete', params: { height: 11, seed: 12 }, pos: [10, -12], yaw: 0 });
  it.push({ type: 'es_roccia', params: { size: 1.6, shape: 'masso', count: 3, moss: true, seed: 5 }, pos: [-3.5, -2.5], yaw: 0 });
  it.push({ type: 'es_roccia', params: { size: 0.8, shape: 'ciottolo', count: 5, seed: 8 }, pos: [3.8, -1.5], yaw: 0 });
  it.push({ type: 'phc_namaqualand_boulder_04', pos: [-11, -15], yaw: 0.4 });
  it.push({ type: 'es_tronco', params: { kind: 'tronco', length: 3.4, diameter: 0.45, seed: 3 }, pos: [2.8, -4.5], yaw: 0.6 });
  it.push({ type: 'es_tronco', params: { kind: 'ceppo', length: 2, diameter: 0.6, seed: 4 }, pos: [-2.2, -7], yaw: 0 });
  it.push({ type: 'phc_tree_stump_02', pos: [8, -3], yaw: 1.2 });
  it.push({ type: 'es_cespuglio', params: { size: 1.2, seed: 21 }, pos: [-6.5, -2], yaw: 0 });
  it.push({ type: 'es_cespuglio', params: { size: 0.9, seed: 22 }, pos: [5.5, -9], yaw: 0 });
  it.push({ type: 'es_prato', params: { width: 6, depth: 4, density: 'alta', bladeH: 0.4, seed: 2 }, pos: [-1, -11], yaw: 0 });
  it.push({ type: 'es_prato', params: { width: 5, depth: 3, density: 'media', bladeH: 0.3, flowers: true, seed: 5 }, pos: [5, -2.5], yaw: 0 });
  return it;
}

export const KITS = [
  { id: 'kit_incrocio', label: 'Incrocio di città', size: [48, 48], items: incrocio, tags: 'città incrocio semafori traffico' },
  { id: 'kit_residenziale', label: 'Strada residenziale', size: [48, 22], items: residenziale, tags: 'via strada case auto parcheggiate' },
  { id: 'kit_parco', label: 'Parco', size: [34, 26], items: parco, tags: 'parco giardino laghetto panchine' },
  { id: 'kit_bosco', label: 'Bosco', size: [40, 34], items: bosco, tags: 'bosco foresta alberi sentiero' },
];
