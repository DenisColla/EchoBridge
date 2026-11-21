// Material roles of the exterior props (registered into the props ROLES table,
// prefix 'c:'). Each role is a function (propColor) -> material-library spec
// (kind 'prop'), so every render style works. Specs are identical across props
// (same textures, same numbers) so materials are shared by the cache.
import * as THREE from 'three';
import { registerPropRoles } from '../props/catalog.js';
import * as T from './tex.js';

const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const mix = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

/** Fixed roles. */
const R = {
  // ---- road surfaces
  'c:asphalt': () => ({ kind: 'prop', color: '#8c8f94', map: T.asphalt().map, normalMap: T.asphalt().normalMap, normalScale: 0.6, roughness: 0.92 }),
  'c:asphaltOld': () => ({ kind: 'prop', color: '#a3a19c', map: T.asphalt().map, normalMap: T.asphalt().normalMap, normalScale: 0.6, roughness: 0.95 }),
  'c:paint': () => ({ kind: 'prop', color: '#eeeeea', roughness: 0.7 }),
  'c:paintY': () => ({ kind: 'prop', color: '#e8b51c', roughness: 0.7 }),
  'c:paintB': () => ({ kind: 'prop', color: '#2f63b8', roughness: 0.7 }),
  'c:pavers': () => ({ kind: 'prop', color: '#ffffff', map: T.pavers().map, normalMap: T.pavers().normalMap, normalScale: 0.8, roughness: 0.88 }),
  'c:cobbles': () => ({ kind: 'prop', color: '#ffffff', map: T.cobbles().map, normalMap: T.cobbles().normalMap, normalScale: 1, roughness: 0.8 }),
  'c:curb': () => ({ kind: 'prop', color: '#e6e3dc', map: T.concrete().map, normalMap: T.concrete().normalMap, normalScale: 0.5, roughness: 0.85 }),
  'c:concrete': () => ({ kind: 'prop', color: '#d2cec6', map: T.concrete().map, normalMap: T.concrete().normalMap, normalScale: 0.5, roughness: 0.9 }),
  'c:iron': () => ({ kind: 'prop', color: '#3a3836', metalness: 0.55, roughness: 0.6 }),
  'c:gravel': () => ({ kind: 'prop', color: '#ffffff', map: T.gravel().map, normalMap: T.gravel().normalMap, normalScale: 1, roughness: 0.95 }),
  'c:sleeper': () => ({ kind: 'prop', color: '#6b5440', roughness: 0.85 }),
  'c:rail': () => ({ kind: 'prop', color: '#8d8a86', metalness: 0.8, roughness: 0.38 }),
  // ---- nature
  'c:grass': () => ({ kind: 'prop', color: '#ffffff', map: T.grass().map, normalMap: T.grass().normalMap, normalScale: 0.6, roughness: 0.95 }),
  'c:dirt': () => ({ kind: 'prop', color: '#ffffff', map: T.dirt().map, normalMap: T.dirt().normalMap, normalScale: 0.8, roughness: 0.97 }),
  'c:sand': () => ({ kind: 'prop', color: '#ffffff', map: T.sand().map, normalMap: T.sand().normalMap, normalScale: 0.6, roughness: 0.96 }),
  'c:snow': () => ({ kind: 'prop', color: '#ffffff', map: T.snow().map, normalMap: T.snow().normalMap, normalScale: 0.4, roughness: 0.75 }),
  'c:rock': () => ({ kind: 'prop', color: '#ffffff', map: T.rock().map, normalMap: T.rock().normalMap, normalScale: 0.9, roughness: 0.9 }),
  'c:bark': () => ({ kind: 'prop', color: '#ffffff', map: T.bark().map, normalMap: T.bark().normalMap, normalScale: 1, roughness: 0.95 }),
  'c:birch': () => ({ kind: 'prop', color: '#ffffff', map: T.birch().map, normalMap: T.birch().normalMap, normalScale: 0.6, roughness: 0.8 }),
  'c:palmBark': () => ({ kind: 'prop', color: '#ffffff', map: T.palmBark().map, normalMap: T.palmBark().normalMap, normalScale: 1, roughness: 0.92 }),
  'c:endGrain': () => ({ kind: 'prop', color: '#ffffff', map: T.endGrain().map, roughness: 0.85 }),
  'c:water': () => ({ kind: 'prop', color: '#3f6f7a', normalMap: T.water().normalMap, normalScale: 0.35, roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.82 }),
  'c:mud': () => ({ kind: 'prop', color: '#4b3b2a', roughness: 0.6 }),
  'c:leafVC': () => ({ kind: 'prop', color: '#ffffff', roughness: 0.78, vertexColors: true, side: 'double' }),
  'c:leafVC1': () => ({ kind: 'prop', color: '#ffffff', roughness: 0.78, vertexColors: true }),
  'c:petals': () => ({ kind: 'prop', color: '#ffffff', roughness: 0.6, vertexColors: true, side: 'double' }),
  'c:stem': () => ({ kind: 'prop', color: '#4c6a33', roughness: 0.75 }),
  'c:reed': () => ({ kind: 'prop', color: '#7a8a4a', roughness: 0.8, side: 'double' }),
  // ---- vehicles
  'c:glass': () => ({ kind: 'prop', color: '#1d2630', roughness: 0.06, metalness: 0.4 }),
  'c:glassT': () => ({ kind: 'prop', color: '#9fb6c2', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35 }),
  'c:tire': () => ({ kind: 'prop', color: '#1e1e20', roughness: 0.82 }),
  'c:rim': () => ({ kind: 'prop', color: '#b9bcc1', metalness: 0.85, roughness: 0.28 }),
  'c:rimDark': () => ({ kind: 'prop', color: '#3a3c40', metalness: 0.6, roughness: 0.35 }),
  'c:trim': () => ({ kind: 'prop', color: '#1b1c1f', roughness: 0.55 }),
  'c:chrome': () => ({ kind: 'prop', color: '#dde1e6', metalness: 1, roughness: 0.12 }),
  'c:headlight': () => ({ kind: 'prop', color: '#dfe6ea', roughness: 0.08, metalness: 0.55 }),
  'c:taillight': () => ({ kind: 'prop', color: '#8e0f16', roughness: 0.1, metalness: 0.2 }),
  'c:lightsVC': () => ({ kind: 'prop', color: '#ffffff', roughness: 0.12, metalness: 0.05, vertexColors: true }),
  'c:seat': () => ({ kind: 'prop', color: '#2b2b2e', roughness: 0.7 }),
  'c:leather': () => ({ kind: 'prop', color: '#3a2a20', roughness: 0.55 }),
  'c:white': () => ({ kind: 'prop', color: '#f0f0ec', roughness: 0.35 }),
  'c:decalTaxi': () => ({ kind: 'prop', color: '#ffffff', map: T.textTex('TAXI', { color: '#111111', bg: '#f4d03f' }).map, roughness: 0.4 }),
  'c:decalPolizia': () => ({ kind: 'prop', color: '#ffffff', map: T.textTex('POLIZIA', { color: '#ffffff', w: 512, h: 96, font: 'bold 70px Arial, sans-serif' }).map, transparent: true, alphaTest: 0.4, roughness: 0.4 }),
  'c:decalAmbu': () => ({ kind: 'prop', color: '#ffffff', map: T.textTex('AMBULANZA', { color: '#d1261c', w: 512, h: 96, font: 'bold 64px Arial, sans-serif' }).map, transparent: true, alphaTest: 0.4, roughness: 0.4 }),
  'c:decalAmbuM': () => ({ kind: 'prop', color: '#ffffff', map: T.textTex('AMBULANZA', { color: '#d1261c', w: 512, h: 96, font: 'bold 64px Arial, sans-serif', mirror: true }).map, transparent: true, alphaTest: 0.4, roughness: 0.4 }),
  'c:decalBus': () => ({ kind: 'prop', color: '#ffffff', map: T.textTex('64  TERMINI', { color: '#ffb020', bg: '#101010', w: 512, h: 64, font: 'bold 44px Arial, sans-serif' }).map, roughness: 0.3 }),
  // ---- street furniture
  'c:metalDark': () => ({ kind: 'prop', color: '#2c2f33', metalness: 0.6, roughness: 0.45 }),
  'c:metalGreen': () => ({ kind: 'prop', color: '#2f4a3a', metalness: 0.5, roughness: 0.5 }),
  'c:steel': () => ({ kind: 'prop', color: '#a9adb2', metalness: 0.8, roughness: 0.35 }),
  'c:galv': () => ({ kind: 'prop', color: '#9ea3a6', metalness: 0.7, roughness: 0.45 }),
  'c:wood': () => ({ kind: 'prop', color: '#8a6142', roughness: 0.7 }),
  'c:woodDark': () => ({ kind: 'prop', color: '#5a3d28', roughness: 0.7 }),
  'c:lampGlass': () => ({ kind: 'prop', color: '#fff3d6', roughness: 0.25, metalness: 0 }),
  'c:redPaint': () => ({ kind: 'prop', color: '#b3261e', roughness: 0.45 }),
  'c:orange': () => ({ kind: 'prop', color: '#ea6a1f', roughness: 0.5 }),
  'c:yellowPaint': () => ({ kind: 'prop', color: '#e8b51c', roughness: 0.5 }),
  'c:whitePaint': () => ({ kind: 'prop', color: '#f2f1ec', roughness: 0.45 }),
  'c:plasticVC': () => ({ kind: 'prop', color: '#ffffff', roughness: 0.5, vertexColors: true }),
  'c:brick': () => ({ kind: 'prop', color: '#a0523a', roughness: 0.9 }),
  'c:stone': () => ({ kind: 'prop', color: '#ffffff', map: T.rock().map, normalMap: T.rock().normalMap, normalScale: 0.6, roughness: 0.9 }),
  'c:chain': () => ({ kind: 'prop', color: '#ffffff', map: T.chainLink().map, alphaTest: 0.45, transparent: false, side: 'double', metalness: 0.6, roughness: 0.4 }),
  'c:mags': () => ({ kind: 'prop', color: '#ffffff', map: T.magazines().map, roughness: 0.6 }),
  'c:poster': () => ({ kind: 'prop', color: '#ffffff', map: T.posterTex().map, roughness: 0.3 }),
  'c:signBack': () => ({ kind: 'prop', color: '#8e9296', metalness: 0.5, roughness: 0.5 }),
};
for (const [kind] of T.SIGN_TYPES) R['c:sign:' + kind] = () => ({ kind: 'prop', color: '#ffffff', map: T.signTex(kind).map, roughness: 0.4 });

/** Color-following roles (the prop color = the "main" paint of the object). */
const C = {
  'c:paintMain': (c) => ({ kind: 'prop', color: c, roughness: 0.32, metalness: 0.25 }), // car paint
  'c:paintMainM': (c) => ({ kind: 'prop', color: c, roughness: 0.5, metalness: 0.1 }), // matte paint
  'c:foliage': (c) => ({ kind: 'prop', color: c, roughness: 0.85, side: 'double' }),
  'c:grassBlades': (c) => ({ kind: 'prop', color: c, roughness: 0.86, vertexColors: true }),
  'c:foliageVC1': (c) => ({ kind: 'prop', color: c, roughness: 0.85, vertexColors: true }),
  'c:foliageVC': (c) => ({ kind: 'prop', color: c, roughness: 0.85, vertexColors: true, side: 'double' }),
  'c:foliageDark': (c) => ({ kind: 'prop', color: shade(c, 0.72), roughness: 0.85, side: 'double' }),
  'c:mainRough': (c) => ({ kind: 'prop', color: c, roughness: 0.85 }),
  'c:mainShade': (c) => ({ kind: 'prop', color: shade(c, 0.75), roughness: 0.6 }),
  'c:mainLight': (c) => ({ kind: 'prop', color: mix(c, '#ffffff', 0.35), roughness: 0.6 }),
  'c:rockTint': (c) => ({ kind: 'prop', color: c, map: T.rock().map, normalMap: T.rock().normalMap, normalScale: 0.9, roughness: 0.9 }),
  'c:grassTint': (c) => ({ kind: 'prop', color: mix('#ffffff', c, 0.35), map: T.grass().map, normalMap: T.grass().normalMap, normalScale: 0.6, roughness: 0.95 }),
};

let done = false;
export function registerCityRoles() {
  if (done) return;
  done = true;
  registerPropRoles({ ...R, ...C });
}

/** Roles of flat surfaces that should not cast shadows (decals, road layers). */
export const NO_SHADOW_ROLES = new Set(['c:asphalt', 'c:asphaltOld', 'c:paint', 'c:paintY', 'c:paintB', 'c:pavers', 'c:cobbles', 'c:gravel', 'c:water',
  'c:decalTaxi', 'c:decalPolizia', 'c:decalAmbu', 'c:decalAmbuM', 'c:grassTint', 'c:mud']);

/** Roles never inked in the 'lines' style (thousands of tiny blades would hatch the page). */
export const NO_INK_ROLES = new Set(['c:grassBlades', 'c:reed']);

export { shade, mix };
