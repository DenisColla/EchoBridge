// Time of day -> state of the scene module's light rig (app.lightRig, public
// setState API): key = sun / moon / dusk sky, rim = cool sky fill, ambient =
// hemisphere sky / ground colours, extras = street lamps near the characters at
// night (point lights, max 3). Directions follow the rig convention:
// dir(az, el) = (sin az cos el, sin el, cos az cos el), from the target to the light.
import * as THREE from 'three';

const DEG = Math.PI / 180;

export function dirFromAzEl(az, el, out = new THREE.Vector3()) {
  const c = Math.cos(el);
  return out.set(Math.sin(az) * c, Math.sin(el), Math.cos(az) * c);
}

let _n = 0;
const lid = (p) => `ls${p}${(Date.now() % 1e6).toString(36)}${(_n++).toString(36)}`;

/**
 * atm: atmosphere(); frame: {x, z, yaw}; target: [x, y, z] subject centre;
 * lamps: [{x, y, z}] world positions of lamp heads (nearest first).
 */
export function rigState(atm, frame, target, lamps = [], handles = true) {
  const s = atm.sun;
  const lights = [{
    id: lid('k'), role: 'key', name: s.name, type: 'sun', on: true,
    kelvin: Math.round(s.kelvin), color: null, intensity: +s.intensity.toFixed(3),
    az: frame.yaw + s.relAz * DEG, el: Math.max(2, s.el) * DEG, dist: 2.5, target: [...target],
    shadow: true, soft: +s.soft.toFixed(2), angle: 50, penumbra: 0.4,
  }];
  if (atm.rim) {
    lights.push({
      id: lid('r'), role: 'rim', name: atm.rim.name, type: 'sun', on: atm.rim.intensity > 0.05,
      kelvin: atm.rim.kelvin, color: null, intensity: +atm.rim.intensity.toFixed(3),
      az: frame.yaw + atm.rim.relAz * DEG, el: atm.rim.el * DEG, dist: 2.5, target: [...target],
      shadow: false, soft: 0.6, angle: 50, penumbra: 0.4,
    });
  } else {
    lights.push({ id: lid('r'), role: 'rim', name: '', type: 'sun', on: false, kelvin: 9000, color: null, intensity: 0.6, az: frame.yaw + Math.PI, el: 30 * DEG, dist: 2.5, target: [...target], shadow: false, soft: 0.4, angle: 50, penumbra: 0.4 });
  }
  if (atm.lamps) {
    for (const L of lamps.slice(0, 3)) {
      const d = new THREE.Vector3(L.x - target[0], L.y - target[1], L.z - target[2]);
      const dist = Math.max(0.8, d.length());
      d.normalize();
      lights.push({
        id: lid('e'), role: 'extra', name: L.name || 'Lampione', type: 'point', on: true,
        kelvin: L.kelvin || 2400, color: L.color || null, intensity: L.intensity ?? (dist > 6 ? 0.9 : 1.3),
        az: Math.atan2(d.x, d.z), el: Math.asin(Math.max(-1, Math.min(1, d.y))), dist: +dist.toFixed(3), target: [...target],
        shadow: false, soft: 0.4, angle: 50, penumbra: 0.4,
      });
    }
  }
  return {
    v: 1, preset: null,
    ambient: { intensity: +atm.ambient.intensity.toFixed(3), kelvin: 7500, color: atm.ambient.color, ground: atm.ambient.ground },
    lights, handles,
  };
}
