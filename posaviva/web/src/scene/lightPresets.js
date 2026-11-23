// Light presets. Azimuths (`relAz`, degrees) are relative to the camera
// direction when the preset is applied: 0 = from the camera, +90 = from the
// right side of the frame, 180 = from behind the subject (backlight).
// `el` = elevation in degrees above the horizon (negative = from below).
// Intensities use the rig's normalized units (≈ sun-equivalent at the target).

const OFF = { on: false };

export const LIGHT_PRESETS = [
  {
    id: 'studio', label: 'Studio 3 punti',
    ambient: { intensity: 0.55, kelvin: 7500, ground: '#3e3833' },
    lights: [
      { role: 'key', type: 'sun', relAz: 40, el: 38, intensity: 2.6, kelvin: 5200, shadow: true, soft: 0.35 },
      { role: 'rim', type: 'sun', relAz: -150, el: 30, intensity: 2.0, kelvin: 7000, shadow: false },
      { role: 'extra', name: 'Riempimento', type: 'sun', relAz: -55, el: 12, intensity: 0.7, kelvin: 6500, shadow: false },
    ],
  },
  {
    id: 'rembrandt', label: 'Rembrandt',
    ambient: { intensity: 0.22, kelvin: 6000, ground: '#2b2622' },
    lights: [
      { role: 'key', type: 'sun', relAz: 55, el: 45, intensity: 3.0, kelvin: 4600, shadow: true, soft: 0.14 },
      { role: 'rim', ...OFF, type: 'sun', relAz: -150, el: 30, intensity: 1.2, kelvin: 6500 },
    ],
  },
  {
    id: 'backlight', label: 'Controluce',
    ambient: { intensity: 0.5, kelvin: 8500, ground: '#2f3238' },
    lights: [
      { role: 'key', type: 'sun', relAz: 160, el: 22, intensity: 3.6, kelvin: 4300, shadow: true, soft: 0.3 },
      { role: 'rim', type: 'sun', relAz: -160, el: 32, intensity: 2.2, kelvin: 5000, shadow: false },
      { role: 'extra', name: 'Riempimento', type: 'sun', relAz: 0, el: 8, intensity: 0.35, kelvin: 7500, shadow: false },
    ],
  },
  {
    id: 'top', label: 'Drammatica dall\'alto',
    ambient: { intensity: 0.2, kelvin: 6500, ground: '#26221f' },
    lights: [
      { role: 'key', type: 'spot', relAz: 14, el: 72, dist: 3.4, angle: 48, penumbra: 0.5, intensity: 4.0, kelvin: 5000, shadow: true, soft: 0.14 },
      { role: 'rim', ...OFF, type: 'sun', relAz: -150, el: 30, intensity: 1.2, kelvin: 6500 },
    ],
  },
  {
    id: 'horror', label: 'Dal basso (horror)',
    ambient: { intensity: 0.07, color: '#5a7a66', ground: '#0c100d' },
    lights: [
      { role: 'key', type: 'sun', relAz: 6, el: -58, intensity: 3.2, color: '#b4f5c8', shadow: true, soft: 0.12 },
      { role: 'rim', type: 'spot', relAz: 180, el: 12, dist: 2.6, angle: 40, penumbra: 0.6, intensity: 1.8, color: '#ff4a3d', shadow: false },
    ],
  },
  {
    id: 'sunset', label: 'Tramonto caldo',
    ambient: { intensity: 0.6, color: '#8f7fd8', ground: '#5c3b2a' },
    lights: [
      { role: 'key', type: 'sun', relAz: 68, el: 9, intensity: 3.3, kelvin: 2400, shadow: true, soft: 0.4 },
      { role: 'rim', type: 'sun', relAz: -125, el: 14, intensity: 1.1, color: '#ff8fb1', shadow: false },
    ],
  },
  {
    id: 'night', label: 'Notte / luna',
    ambient: { intensity: 0.32, color: '#2c3d70', ground: '#0d111d' },
    lights: [
      { role: 'key', type: 'sun', relAz: -35, el: 52, intensity: 1.15, kelvin: 10000, shadow: true, soft: 0.45 },
      { role: 'rim', type: 'sun', relAz: 160, el: 26, intensity: 0.9, color: '#7fa8ff', shadow: false },
      { role: 'extra', name: 'Lampione', type: 'point', relAz: 78, el: 28, dist: 2.2, intensity: 1.3, kelvin: 2300, shadow: false },
    ],
  },
  {
    id: 'flat', label: 'Luce piatta',
    ambient: { intensity: 1.7, kelvin: 6500, ground: '#9a9590' },
    lights: [
      { role: 'key', type: 'sun', relAz: 0, el: 24, intensity: 1.1, kelvin: 6000, shadow: false, soft: 0.5 },
      { role: 'rim', ...OFF, type: 'sun', relAz: -150, el: 30, intensity: 1.2, kelvin: 6500 },
    ],
  },
];

/**
 * Presets of the "Luce ambientale" menu (long press on an empty spot) that are not
 * in the Luci panel strip: soft daylight from a window-high sun with a sky fill.
 */
export const AMBIENT_PRESETS = [
  {
    id: 'day', label: 'Giorno',
    ambient: { intensity: 0.95, kelvin: 9000, ground: '#4a4339' },
    lights: [
      { role: 'key', type: 'sun', relAz: 50, el: 42, intensity: 2.7, kelvin: 5600, shadow: true, soft: 0.22 },
      { role: 'rim', type: 'sun', relAz: -140, el: 35, intensity: 0.9, kelvin: 8500, shadow: false },
    ],
  },
];

export const presetById = new Map([...LIGHT_PRESETS, ...AMBIENT_PRESETS].map((p) => [p.id, p]));
