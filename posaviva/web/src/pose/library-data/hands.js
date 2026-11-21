// Hand preset authoring data (LEFT hand; the right hand is mirrored at load).
//
// Compact anatomical format, compiled to per-bone quaternions by ../library.js:
//   i, m, r, p : index, middle, ring, pinky = [mcp, pip, dip, spread] in degrees.
//                Curl angles are FLEXION (positive = toward the palm; 0 = straight
//                as in the rest pose; small negatives hyper-extend). spread > 0
//                moves the finger away from the middle finger (index toward the
//                thumb, ring / pinky toward the ulnar side); for the middle
//                finger spread > 0 leans it toward the ring finger.
//   t          : thumb = [cmcX, cmcY, cmcZ, mcpFlex, ipFlex]. The first three are
//                raw local Euler degrees of `finger1-1` (see the axis table in
//                ../library.js: X- brings the thumb across the palm, Z- spreads it
//                away from the index in the palm plane, Y twists the thumb pad
//                toward the fingers (+) / away (-)); the last two are flexion of
//                `finger1-2` and `finger1-3` (positive = toward the palm).
//   cup        : palm cupping (degrees of metacarpal flexion at the pinky side,
//                fading to 0 at the index), the hollow of a fist or a cupped hand.
// Every preset is complete: bones not mentioned are set to the rest pose.

export const HAND_DEFS = [
  // --- everyday
  { id: 'relaxed', label: 'Rilassata', i: [12, 16, 8, -4], m: [16, 20, 10, 0], r: [20, 24, 10, -3], p: [24, 26, 12, -4], t: [-12, 12, 6, 8, 10], cup: 6 },
  { id: 'open', label: 'Aperta', i: [2, 3, 2, -6], m: [2, 3, 2, 0], r: [3, 3, 2, -5], p: [4, 4, 2, -9], t: [-4, 6, 10, 2, 2], cup: 0 },
  { id: 'spread', label: 'Dita divaricate', i: [-4, 0, 0, 12], m: [-4, 0, 0, 0], r: [-4, 0, 0, 10], p: [-4, 0, 0, 20], t: [8, -10, -24, -4, -6], cup: 0 },
  { id: 'half', label: 'Semichiusa', i: [38, 50, 30, 0], m: [44, 54, 32, 0], r: [50, 58, 32, 2], p: [56, 60, 32, 4], t: [-24, 22, 0, 18, 18], cup: 8 },
  { id: 'fist', label: 'Pugno', i: [84, 100, 64, 0], m: [88, 100, 64, 0], r: [90, 100, 62, 0], p: [92, 98, 58, 2], t: [-46, 38, 4, 38, 30], cup: 12 },
  { id: 'wave', label: 'Saluto', i: [0, 2, 0, 5], m: [0, 2, 0, 0], r: [2, 3, 0, 4], p: [3, 4, 2, 8], t: [0, 0, -12, 0, 0], cup: 0 },
  { id: 'karate', label: 'Mano a taglio', i: [0, 0, 0, -8], m: [0, 0, 0, 0], r: [0, 0, 0, -7], p: [0, 0, 0, -12], t: [-26, 20, 10, 30, 24], cup: 0 },
  { id: 'claw', label: 'Artiglio', i: [-6, 72, 56, 8], m: [-6, 74, 56, 0], r: [-4, 74, 54, 6], p: [-2, 72, 50, 12], t: [-6, 18, -22, 30, 40], cup: 4 },

  // --- signs
  { id: 'point', label: 'Indicare', i: [0, 2, 0, 0], m: [86, 100, 62, 0], r: [90, 100, 60, 0], p: [92, 96, 56, 2], t: [-40, 34, 6, 32, 26], cup: 12 },
  { id: 'peace', label: 'Pace (V)', i: [0, 0, 0, 10], m: [0, 0, 0, -10], r: [88, 100, 60, 0], p: [90, 96, 56, 2], t: [-42, 36, 4, 36, 30], cup: 10 },
  { id: 'thumbs_up', label: 'Pollice su', i: [84, 100, 64, 0], m: [88, 100, 64, 0], r: [90, 100, 62, 0], p: [92, 98, 58, 2], t: [8, 0, 22, -4, -8], cup: 12 },
  { id: 'ok', label: 'OK', i: [46, 50, 30, 2], m: [6, 6, 4, 0], r: [10, 10, 6, 4], p: [14, 12, 8, 10], t: [-36, 34, 0, 20, 24], cup: 4 },
  { id: 'horns', label: 'Corna', i: [0, 0, 0, 8], m: [88, 100, 62, 0], r: [90, 100, 60, 0], p: [0, 0, 0, 14], t: [-44, 36, 4, 36, 32], cup: 8 },
  // finger gun: index + middle together as the barrel, thumb cocked up (tells it apart from 'Due')
  { id: 'finger_gun', label: 'Pistola', i: [0, 0, 0, -9], m: [3, 3, 0, -15], r: [90, 100, 60, 0], p: [92, 96, 56, 2], t: [8, -8, -14, -4, -6], cup: 10 },
  // counting the Italian way: one = thumb, two = thumb + index, three = + middle
  { id: 'count1', label: 'Uno (pollice)', i: [84, 100, 64, 0], m: [88, 100, 64, 0], r: [90, 100, 62, 0], p: [92, 98, 58, 2], t: [4, -6, -16, -4, -6], cup: 12 },
  { id: 'count2', label: 'Due', i: [0, 0, 0, 4], m: [86, 100, 62, 0], r: [90, 100, 60, 0], p: [92, 96, 56, 2], t: [2, -4, -6, -2, -4], cup: 10 },
  { id: 'count3', label: 'Tre', i: [0, 0, 0, 4], m: [0, 0, 0, -2], r: [88, 100, 60, 0], p: [90, 96, 56, 2], t: [4, -6, -16, -4, -6], cup: 8 },

  // --- holding
  { id: 'grip', label: 'Presa cilindrica', i: [62, 74, 44, 0], m: [66, 76, 44, 0], r: [70, 76, 42, 0], p: [72, 74, 40, 2], t: [-30, 34, 0, 30, 24], cup: 10 },
  { id: 'pinch', label: 'Pinza', i: [40, 44, 26, 0], m: [30, 30, 16, 0], r: [34, 34, 18, 2], p: [38, 36, 20, 4], t: [-34, 30, -2, 18, 20], cup: 4 },
  { id: 'hold', label: 'Tenere (piatto)', i: [24, 26, 14, 0], m: [26, 28, 14, 0], r: [28, 30, 14, 2], p: [30, 30, 14, 4], t: [-8, 10, -10, 6, 8], cup: 4 },
  { id: 'cup', label: 'Tazza', i: [48, 60, 36, 0], m: [54, 64, 38, 0], r: [60, 68, 38, 2], p: [66, 70, 38, 4], t: [-24, 30, -4, 18, 16], cup: 8 },
  { id: 'phone', label: 'Telefono', i: [30, 34, 18, 2], m: [36, 40, 20, 0], r: [42, 46, 22, 2], p: [48, 50, 24, 4], t: [-16, 20, -6, 10, 10], cup: 6 },
];
