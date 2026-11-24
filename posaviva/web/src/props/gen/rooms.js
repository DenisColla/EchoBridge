// Furnished room presets ("Stanze pronte"): each preset is a list of props
// (a "Stanza" + furniture) placed together as a group. Every piece stays a
// normal prop that can be selected, moved and edited on its own; the group id
// lets the editor move or delete the whole room at once.
//
// Item: {type, params?, color?, pos: [x, y, z] (meters, room space: x right,
// z toward the open front), yaw (degrees, 0 = front faces +Z), ax/az: which side
// of the rotated footprint lands on pos (-1 min, 0 center, 1 max)}.

const W = (w, d, extra = {}) => ({ type: 'stanza', params: { width: w, depth: d, ...extra }, pos: [0, 0, 0] });

export const ROOM_PRESETS = [
  {
    id: 'soggiorno', label: 'Soggiorno', size: [5, 4.5], tags: 'salotto divano tv living',
    items: () => [
      W(5, 4.5, { door: 'sinistra', window: 'fondo', floor: 'legno' }),
      { type: 'tappeto', params: { width: 2.4, depth: 1.7, pattern: 'persiano' }, color: '#7a1f24', pos: [0.1, 0, 0.1], yaw: 90 },
      { type: 'divano', params: { width: 2.2, style: 'moderno', pillows: true }, color: '#5d6b7a', pos: [-1.05, 0, 0.1], yaw: 90 },
      { type: 'tavolino', params: { width: 1.1, style: 'legno', decor: true }, color: '#6b4a2f', pos: [0.15, 0, 0.1], yaw: 90 },
      { type: 'mobile_tv', params: { width: 1.8, tv: true, finish: 'scuro' }, pos: [2.5, 0, 0.1], yaw: -90, ax: 1 },
      { type: 'poltrona', params: { style: 'club' }, color: '#7a4b3a', pos: [0.9, 0, -1.2], yaw: 200 },
      { type: 'lampada_terra', params: { style: 'arco' }, pos: [-1.75, 0, -1.55], yaw: 40 },
      { type: 'libreria', params: { width: 1.4, height: 2.1, style: 'legno' }, color: '#b98c5f', pos: [-1.5, 0, -2.25], az: -1 },
      { type: 'ph_potted_plant_02', pos: [2.0, 0, -1.75] },
      { type: 'tende', params: { width: 1.9, height: 2.45, open: 0.55 }, color: '#d9cbb3', pos: [0, 0, -2.25], az: -1 },
      { type: 'quadro', params: { subject: 'paesaggio', width: 0.9 }, pos: [2.5, 1.45, -1.3], yaw: -90, ax: 1 },
      { type: 'vaso_fiori', params: { kind: 'tulipani' }, pos: [0.15, 0.42, 0.45] },
    ],
  },
  {
    id: 'cucina', label: 'Cucina', size: [4.2, 3.8], tags: 'cucina pranzo tavolo',
    items: () => [
      W(4.2, 3.8, { door: 'destra', window: 'fondo', floor: 'piastrelle' }),
      { type: 'cucina', params: { shape: 'L', length: 3.0, side: 2.4, wall: true, fridge: false }, color: '#e8e4dc', pos: [-2.1, 0, -1.9], ax: -1, az: -1 },
      // the fridge is its own prop (it opens: Apri / Chiudi)
      { type: 'frigo', params: { style: 'moderno' }, pos: [0.92, 0, -1.9], ax: -1, az: -1 },
      { type: 'tavolo_rotondo', params: { diameter: 1.1, base: 'centrale' }, color: '#c49a6c', pos: [0.7, 0, 0.6] },
      { type: 'sedia_design', color: '#e8e4dc', pos: [0.7, 0, 1.35], yaw: 180 },
      { type: 'sedia_design', color: '#e8e4dc', pos: [0.7, 0, -0.15], yaw: 0 },
      { type: 'sedia_design', color: '#c0504d', pos: [1.45, 0, 0.6], yaw: -90 },
      { type: 'sedia_design', color: '#c0504d', pos: [-0.05, 0, 0.6], yaw: 90 },
      { type: 'coperto', pos: [0.7, 0.75, 0.95], yaw: 0 },
      { type: 'coperto', pos: [0.7, 0.75, 0.25], yaw: 180 },
      { type: 'sospensione', params: { style: 'campana', cable: 0.9 }, color: '#2f4a6b', pos: [0.7, 1.55, 0.6] },
      { type: 'ph_wooden_bowl_01', pos: [0.7, 0.75, 0.6] },
      { type: 'pianta', params: { species: 'sansevieria', height: 0.8 }, pos: [1.8, 0, -1.6] },
    ],
  },
  {
    id: 'camera', label: 'Camera da letto', size: [4.2, 4], tags: 'letto camera notte',
    items: () => [
      W(4.2, 4, { door: 'sinistra', window: 'destra', floor: 'legno' }),
      { type: 'letto', params: { width: 1.6, model: 'imbottito', made: false }, color: '#8c8f99', pos: [0.2, 0, -2.0], az: -1 },
      { type: 'comodino', params: { lamp: true }, color: '#8a5a3b', pos: [-0.9, 0, -2.0], az: -1 },
      { type: 'comodino', params: { lamp: true }, color: '#8a5a3b', pos: [1.3, 0, -2.0], az: -1 },
      { type: 'armadio', params: { width: 2.0, style: 'scorrevole', finish: 'bianco' }, pos: [-2.1, 0, 0.6], yaw: 90, ax: -1 },
      { type: 'tappeto', params: { width: 2.0, depth: 1.3, pattern: 'moderno' }, color: '#c9a227', pos: [0.2, 0, 0.9] },
      { type: 'cassettiera', params: { style: 'classico', width: 1.1 }, color: '#8a5a3b', pos: [2.1, 0, 1.0], yaw: -90, ax: 1 },
      { type: 'quadro', params: { subject: 'astratto', width: 1.1 }, pos: [0.2, 1.35, -2.0], az: -1 },
      { type: 'tende', params: { width: 1.7, height: 2.4, open: 0.6 }, color: '#e8e4dc', pos: [2.1, 0, 0], yaw: -90, ax: 1 },
      { type: 'specchio', params: { style: 'terra' }, color: '#3b3b40', pos: [1.6, 0, -0.9], yaw: -70 },
    ],
  },
  {
    id: 'bagno', label: 'Bagno', size: [3, 2.6], tags: 'bagno doccia vasca',
    items: () => [
      W(3, 2.6, { door: 'sinistra', window: 'fondo', floor: 'piastrelle', height: 2.6 }),
      { type: 'vasca', params: { style: 'incasso', length: 1.7 }, pos: [0.65, 0, -1.3], az: -1 },
      { type: 'wc', params: { style: 'sospeso' }, pos: [-1.5, 0, -0.55], yaw: 90, ax: -1 },
      { type: 'lavabo', params: { style: 'mobile', width: 0.8, mirror: true }, color: '#e8e4dc', pos: [1.5, 0, 0.35], yaw: -90, ax: 1 },
      { type: 'portasciugamani', color: '#6d8fb0', pos: [-1.0, 0, -1.25], az: -1 },
      { type: 'lavatrice', pos: [1.5, 0, -0.45], yaw: -90, ax: 1 },
      { type: 'tappeto', params: { width: 0.9, depth: 0.55, pattern: 'righe' }, color: '#6d8fb0', pos: [0.4, 0, -0.35] },
      { type: 'ph_rubber_duck_toy', pos: [1.35, 0.6, -1.55] },
    ],
  },
  {
    id: 'ufficio', label: 'Ufficio', size: [6, 5], tags: 'ufficio lavoro open space',
    items: () => [
      W(6, 5, { door: 'destra', window: 'fondo', floor: 'moquette' }),
      { type: 'postazione', params: { shape: 'U', monitors: 2 }, pos: [-1.6, 0, -2.5], az: -1 },
      { type: 'postazione', params: { shape: 'U', monitors: 1, seed: 21 }, pos: [0.4, 0, -2.5], az: -1 },
      { type: 'scrivania', params: { style: 'legno', pc: 'laptop', width: 1.6, clutter: 0.6 }, color: '#8a5a3b', pos: [1.6, 0, 1.0], yaw: -90 },
      { type: 'sedia_ufficio', params: { headrest: true }, pos: [2.35, 0, 1.0], yaw: -90 },
      { type: 'schedario', params: { drawers: 4 }, pos: [2.95, 0, -1.0], yaw: -90, ax: 1 },
      { type: 'erogatore', pos: [2.95, 0, -2.2], yaw: -90, ax: 1 },
      { type: 'lavagna', params: { kind: 'bianca', width: 1.8, stand: true }, pos: [-2.4, 0, 0.6], yaw: 90 },
      { type: 'pianta', params: { species: 'ficus', height: 1.5 }, pos: [2.5, 0, -2.0] },
      { type: 'plafoniera', params: { style: 'neon' }, pos: [-0.6, 2.6, 0], ceil: true },
      { type: 'plafoniera', params: { style: 'neon' }, pos: [1.4, 2.6, 0], ceil: true },
    ],
  },
  {
    id: 'aula', label: 'Aula scolastica', size: [7, 6.5], tags: 'scuola classe banchi lavagna',
    items: () => [
      W(7, 6.5, { door: 'sinistra', window: 'destra', floor: 'piastrelle', height: 3.2 }),
      { type: 'banchi_aula', params: { rows: 3, cols: 3 }, color: '#4f6b3a', pos: [0, 0, 1.0] },
      { type: 'cattedra', params: { platform: true }, color: '#8a5a3b', pos: [-1.0, 0, -2.55] },
      { type: 'sedia_ufficio', pos: [-1.0, 0.15, -3.0] },
      { type: 'lavagna', params: { kind: 'nera', width: 2.6, stand: false }, color: '#6b4a2f', pos: [0.8, 0.9, -3.25], az: -1 },
      { type: 'mappamondo', pos: [-1.5, 0.93, -2.4] },
      { type: 'libreria', params: { width: 1.2, height: 1.8, style: 'legno' }, pos: [3.5, 0, -2.4], yaw: -90, ax: 1 },
      { type: 'cestino', params: { style: 'rete' }, pos: [0.2, 0, -2.9] },
      { type: 'ph_wall_clock', pos: [-2.5, 2.2, -3.25], az: -1 },
    ],
  },
  {
    id: 'bar', label: 'Bar', size: [6, 5], tags: 'bar pub locale bancone',
    items: () => [
      W(6, 5, { door: 'destra', window: 'sinistra', floor: 'scacchi', height: 3.0 }),
      { type: 'bancone', params: { length: 3.6, stools: 4, shelf: true }, color: '#7a1f24', pos: [-0.6, 0, -2.5], az: -1 },
      { type: 'tavolo_rotondo', params: { diameter: 0.7, base: 'centrale' }, color: '#2b2b2e', pos: [-1.6, 0, 1.2] },
      { type: 'ph_bar_chair_round_01', pos: [-1.6, 0, 1.75], yaw: 180 },
      { type: 'ph_bar_chair_round_01', pos: [-1.6, 0, 0.65] },
      { type: 'tavolo_rotondo', params: { diameter: 0.7, base: 'centrale' }, color: '#2b2b2e', pos: [0.4, 0, 1.4] },
      { type: 'ph_bar_chair_round_01', pos: [0.95, 0, 1.4], yaw: -90 },
      { type: 'ph_bar_chair_round_01', pos: [-0.15, 0, 1.4], yaw: 90 },
      { type: 'biliardo', params: { size: 'normale' }, color: '#1f6b3a', pos: [2.0, 0, -0.1], yaw: 90 },
      { type: 'sospensione', params: { style: 'cono', cable: 0.9 }, color: '#c9a227', pos: [-1.5, 1.85, -1.85] },
      { type: 'sospensione', params: { style: 'cono', cable: 0.9 }, color: '#c9a227', pos: [0.3, 1.85, -1.85] },
      { type: 'ph_dartboard', pos: [-2.95, 1.6, -0.6], yaw: 90, ax: -1 },
      { type: 'bicchiere', params: { kind: 'boccale', full: true }, pos: [-1.2, 1.1, -2.2] },
      { type: 'bottiglia', params: { kind: 'birra' }, pos: [0.4, 0.75, 1.3] },
    ],
  },
  {
    id: 'studio', label: 'Set fotografico', size: [5, 4], tags: 'studio foto set fondale luci',
    items: () => [
      { type: 'pavimento', params: { kind: 'cemento', width: 5, depth: 4 }, pos: [0, 0, 0] },
      { type: 'muro', params: { length: 4.5, height: 3.0, thickness: 0.1 }, color: '#f2f0ea', pos: [0, 0, -1.9], az: -1 },
      { type: 'faretto', params: { style: 'softbox', height: 1.8 }, pos: [-1.6, 0, 0.6], yaw: 130 },
      { type: 'faretto', params: { style: 'softbox', height: 1.6 }, pos: [1.7, 0, 0.4], yaw: -120 },
      { type: 'faretto', params: { style: 'spot', height: 2.2 }, pos: [1.2, 0, -1.2], yaw: -40 },
      { type: 'sgabello', params: { height: 0.65 }, color: '#3b3b40', pos: [0, 0, -0.6] },
    ],
  },
];
