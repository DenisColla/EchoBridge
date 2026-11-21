// Garment pictograms (48x48 SVG) used as card thumbnails. The silhouette is
// filled with the garment color so the catalog previews the current choice.
const S = {
  tshirt: 'M17 7 L8 11 L4 20 L10 23 L13 18 L13 42 L35 42 L35 18 L38 23 L44 20 L40 11 L31 7 Q24 12 17 7 Z',
  tank: 'M17 6 L15 6 Q15 15 11 20 L12 42 L36 42 L37 20 Q33 15 33 6 L31 6 Q28 13 24 13 Q20 13 17 6 Z',
  longsleeve: 'M17 7 L9 10 L4 40 L9 41 L13 20 L13 42 L35 42 L35 20 L39 41 L44 40 L39 10 L31 7 Q24 12 17 7 Z',
  sweatshirt: 'M17 6 L8 10 L3 39 L9 41 L13 21 L12 42 L36 42 L35 21 L39 41 L45 39 L40 10 L31 6 Q24 11 17 6 Z',
  trackjacket: 'M18 5 L8 10 L3 39 L9 41 L13 21 L12 42 L36 42 L35 21 L39 41 L45 39 L40 10 L30 5 L27 9 L21 9 Z',
  shirt: 'M18 6 L9 10 L4 39 L9 41 L13 21 L13 43 L35 43 L35 21 L39 41 L44 39 L39 10 L30 6 L24 10 Z',
  blazer: 'M18 5 L8 10 L4 40 L10 41 L13 22 L12 44 L36 44 L35 22 L38 41 L44 40 L40 10 L30 5 L24 26 Z',
  sporttop: 'M16 8 L14 8 Q14 17 11 21 L12 30 L36 30 L37 21 Q34 17 34 8 L32 8 Q30 18 24 18 Q18 18 16 8 Z',
  jeans: 'M13 5 L35 5 L37 44 L27 44 L24 17 L21 44 L11 44 Z',
  trousers: 'M13 5 L35 5 L37 44 L27 44 L24 17 L21 44 L11 44 Z',
  sweatpants: 'M13 5 L35 5 L38 40 L36 44 L27 44 L26 40 L24 17 L22 40 L21 44 L12 44 L10 40 Z',
  cargo: 'M12 5 L36 5 L39 44 L27 44 L24 17 L21 44 L9 44 Z',
  shorts: 'M12 8 L36 8 L39 30 L27 31 L24 19 L21 31 L9 30 Z',
  leggings: 'M15 5 L33 5 L32 44 L26 44 L24 17 L22 44 L16 44 Z',
  miniskirt: 'M15 10 L33 10 L38 30 L10 30 Z',
  pencilskirt: 'M14 7 L34 7 L35 18 L33 41 L15 41 L13 18 Z',
  flaredskirt: 'M16 6 L32 6 L44 40 Q24 45 4 40 Z',
  dress: 'M18 4 L16 4 Q16 12 15 16 L18 22 L8 44 Q24 47 40 44 L30 22 L33 16 Q32 12 32 4 L30 4 Q28 11 24 11 Q20 11 18 4 Z',
  sneakers: 'M5 30 L6 20 L13 18 L22 26 L37 28 Q44 30 44 36 L44 39 L5 39 Z',
  dressshoes: 'M4 33 L6 25 L14 24 L22 29 L38 30 Q45 32 44 37 L44 38 L4 38 Z',
  boots: 'M10 39 L10 8 L24 8 L24 26 L37 29 Q44 31 44 36 L44 40 L10 40 Z',
  socks: 'M15 4 L27 4 L27 28 L38 35 Q42 40 37 43 L22 43 Q15 42 15 34 Z',
  underwear: 'M8 14 L40 14 L40 20 Q30 23 27 36 L21 36 Q18 23 8 20 Z',
  none: 'M12 12 L36 36 M36 12 L12 36',
};

const DETAIL = {
  tshirt: 'M17 7 Q24 12 31 7',
  sweatshirt: 'M12 39 L36 39 M4 36 L9 37.5 M44 36 L39 37.5',
  trackjacket: 'M24 9 L24 42 M12 39 L36 39',
  shirt: 'M24 10 L24 43 M24 16 h0.01 M24 23 h0.01 M24 30 h0.01 M24 37 h0.01 M18 6 L21 13 L24 10 L27 13 L30 6',
  blazer: 'M18 5 L22 18 L24 26 L26 18 L30 5 M24 30 h0.01 M15 34 L20 34 M28 34 L33 34',
  jeans: 'M13 5 L35 5 M14 12 Q18 12 19 6 M34 12 Q30 12 29 6',
  trousers: 'M16 18 L16 44 M32 18 L32 44 M13 8 L35 8',
  sweatpants: 'M10 40 L22 40 M26 40 L38 40 M13 9 L35 9',
  cargo: 'M9 22 L15 22 L15 30 L9 30 M33 22 L39 22 L39 30 L33 30',
  shorts: 'M12 12 L36 12',
  sneakers: 'M5 35 L44 35 M14 21 L19 25 M16 20 L21 24',
  dressshoes: 'M4 35 L44 35 M33 30 Q35 34 33 37',
  boots: 'M10 34 L44 34 M14 12 L20 12 M14 16 L20 16 M14 20 L20 20',
  socks: 'M15 9 L27 9',
  underwear: 'M8 17 L40 17',
  dress: 'M15 16 L33 16',
};

/** Returns an SVG data URL for a garment pictogram filled with `color`. */
export function garmentIcon(id, color = '#9aa0a8', stroke = '#e9ecf2') {
  const body = S[id] || S.none;
  const fill = id === 'none' ? 'none' : color;
  const det = DETAIL[id] ? `<path d="${DETAIL[id]}" fill="none" stroke="${stroke}" stroke-opacity="0.65" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="${body}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${det}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
