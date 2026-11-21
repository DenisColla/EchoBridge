// Color helpers for the light rig: black-body temperature -> RGB.
import * as THREE from 'three';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Approximate sRGB color of a black-body radiator at `kelvin` (1000..40000 K),
 * using the classic curve fit published by Tanner Helland (public formula).
 * Writes 0..1 sRGB components into `out` ({r,g,b}) and returns it.
 */
export function kelvinToSRGB(kelvin, out = { r: 1, g: 1, b: 1 }) {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  out.r = clamp01(r / 255); out.g = clamp01(g / 255); out.b = clamp01(b / 255);
  return out;
}

const _srgb = { r: 1, g: 1, b: 1 };

/** Sets a THREE.Color (working/linear space) from a temperature. */
export function setColorFromKelvin(color, kelvin) {
  kelvinToSRGB(kelvin, _srgb);
  return color.setRGB(_srgb.r, _srgb.g, _srgb.b, THREE.SRGBColorSpace);
}

/** CSS hex string for a temperature (used by UI swatches / gradients). */
export function kelvinToHex(kelvin) {
  kelvinToSRGB(kelvin, _srgb);
  const h = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(_srgb.r)}${h(_srgb.g)}${h(_srgb.b)}`;
}

/** CSS linear-gradient spanning a temperature range (for the Kelvin slider track). */
export function kelvinGradientCSS(min = 2000, max = 10000, steps = 9) {
  const stops = [];
  for (let i = 0; i < steps; i++) {
    const k = min + ((max - min) * i) / (steps - 1);
    stops.push(`${kelvinToHex(k)} ${((i / (steps - 1)) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
