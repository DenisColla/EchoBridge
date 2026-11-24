// "Stanza" presets: the furnished rooms of the props module (ROOM_PRESETS) with
// walls, every time with different wall / floor / furniture colours, door and
// window sides, a few decorations added or left out, and the light of the
// chosen time of day (lamps on in the evening).
import { ROOM_PRESETS } from '../../props/gen/rooms.js';

const WALLS = ['#e4ddd0', '#f1ede4', '#d9cbb3', '#c9d4d8', '#e8d9c8', '#cfd8c4', '#e6c9b8', '#b9c6d6', '#efe6d2', '#d8d2e0'];
const FURN = ['#5d6b7a', '#7a4b3a', '#8c8f99', '#3f5a4a', '#b98c5f', '#7a1f24', '#2f4a6b', '#c49a6c', '#e8e4dc', '#4a4a50', '#9a6b3f', '#6b7a4a'];
const FLOORS_BY_ROOM = { bagno: ['piastrelle', 'marmo', 'scacchi'], cucina: ['piastrelle', 'scacchi', 'legno', 'marmo'], bar: ['scacchi', 'legno', 'piastrelle'], aula: ['piastrelle', 'legno'], ufficio: ['moquette', 'legno', 'cemento'] };
const SIDES = ['fondo', 'sinistra', 'destra'];
const STRUCTURE = new Set(['stanza', 'pavimento', 'muro']);
const EXTRAS = [
  { type: 'pianta', params: { species: 'ficus', height: 1.4 } }, { type: 'ph_potted_plant_01' }, { type: 'ph_potted_plant_02' },
  { type: 'lampada_terra', params: { style: 'arco' } }, { type: 'lampada_terra' }, { type: 'pila_scatole' }, { type: 'ph_cardboard_box_01' },
  { type: 'ph_wicker_basket_02' }, { type: 'ph_ceramic_vase_01' }, { type: 'zaino' }, { type: 'scatola' },
];

function roomPreset(R) {
  return {
    id: `stanza_${R.id}`, label: R.label, group: 'stanze', variants: 1, room: R.id,
    tags: ['stanza', 'interno', 'casa', ...String(R.tags || '').split(/\s+/).filter(Boolean), R.label.toLowerCase()],
    thumb: { sky: ['#e9e2d4', '#f6f2ea'], ground: '#b98c5f', sil: 'room' },
    times: { alba: 0.5, mattino: 2, mezzogiorno: 1, tramonto: 1.5, sera: 2, notte: 2 },
    weathers: { sereno: 4, nuvoloso: 2, pioggia: 1, neve: 0.4, nebbia: 0.3 },
    build(g) {
      const rng = g.rng;
      g.terrain = null;
      g.noPrecip = true;
      g.fogScale = 0;
      g.indoor = true;
      const [width, depth] = R.size || [4, 4];
      const z0 = -Math.max(0, depth / 2 - 1.6);
      const list = R.items();
      const wall = rng.pick(WALLS), floors = FLOORS_BY_ROOM[R.id] || ['legno', 'piastrelle', 'marmo', 'cemento', 'moquette', 'legno'];
      let removed = 0;
      for (const it of list) {
        const params = { ...(it.params || {}) };
        let color = it.color || null;
        if (it.type === 'stanza') {
          params.floor = rng.pick(floors);
          // the floor continues towards the camera (the room is open in front)
          g.items.push({ type: 'pavimento', params: { kind: params.floor, width: Math.min(12, (params.width || width) + 1), depth: 5 }, color: null, x: 0, y: 0, z: z0 + depth / 2 + 2.5, yaw: 0, fit: null, lamp: null, tag: 'room' });
          params.door = rng.pick([...SIDES, 'nessuna']);
          params.window = rng.pick(SIDES.filter((s) => s !== params.door));
          color = wall;
        } else if (it.type === 'muro') color = wall;
        else if (!STRUCTURE.has(it.type)) {
          // decorations (small, on the floor) may be left out; furniture gets new colours
          if (removed < 2 && !it.ceil && (it.type.startsWith('ph_') || ['vaso_fiori', 'quadro', 'tappeto', 'cestino', 'coperto'].includes(it.type)) && rng.chance(0.25)) { removed++; continue; }
          if (color || rng.chance(0.35)) color = rng.pick(FURN);
          if ('seed' in params || rng.chance(0.5)) params.seed = rng.seedInt();
        }
        const [x, y, z] = it.pos || [0, 0, 0];
        g.items.push({ type: it.type, params, color, x, y, z: z + z0, yaw: ((it.yaw || 0) * Math.PI) / 180, fit: it.ax || it.az ? { ax: it.ax || 0, az: it.az || 0 } : null, lamp: null, tag: 'room' });
      }
      // a few extras along the walls
      const [W, D] = R.size || [4, 4];
      for (let i = 0; i < rng.int(1, 3); i++) {
        const e = rng.pick(EXTRAS), side = rng.pick(['L', 'R', 'B']);
        const x = side === 'L' ? -W / 2 + 0.45 : side === 'R' ? W / 2 - 0.45 : rng.range(-W / 2 + 0.6, W / 2 - 0.6);
        const z = side === 'B' ? -D / 2 + 0.45 : rng.range(-D / 2 + 0.6, D / 2 - 1.2);
        if (Math.hypot(x, z + z0) < 1.5) continue;
        g.items.push({ type: e.type, params: e.params ? { ...e.params } : null, color: null, x, y: 0, z: z + z0, yaw: side === 'L' ? Math.PI / 2 : side === 'R' ? -Math.PI / 2 : 0, fit: null, lamp: null, tag: 'room' });
      }
      g.view = { el: 6, focal: 28, dist: 1.25 };
    },
  };
}

export const ROOMS = ROOM_PRESETS.map(roomPreset);
