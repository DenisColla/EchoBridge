// Small emoji-like SVG faces for the expression cards (48 x 48, data: URLs).
// Descriptors: brows [x1, y1, x2, y2] (viewer's left brow, viewer's right brow),
// eyes (viewer's left, right), mouth, optional extras. Viewer's right is the
// character's left, so a wink of the character's left eye closes eyes[1].
const INK = '#3b2b24';
const SKIN = '#f3d0ad';
const SHADE = '#e2b48f';

const ICONS = {
  neutral: { brows: [[12.5, 15.5, 20, 15.5], [28, 15.5, 35.5, 15.5]], eyes: ['open', 'open'], mouth: 'flat' },
  smile: { brows: [[12.5, 15, 20, 14.5], [28, 14.5, 35.5, 15]], eyes: ['open', 'open'], mouth: 'smile' },
  laugh: { brows: [[12.5, 13.5, 20, 12.5], [28, 12.5, 35.5, 13.5]], eyes: ['happy', 'happy'], mouth: 'laugh' },
  happy: { brows: [[12.5, 14, 20, 13], [28, 13, 35.5, 14]], eyes: ['open', 'open'], mouth: 'grin', extras: ['blushSoft'] },
  sad: { brows: [[12.5, 17, 20, 14], [28, 14, 35.5, 17]], eyes: ['open', 'open'], mouth: 'frown' },
  cry: { brows: [[12.5, 17.5, 20, 13.5], [28, 13.5, 35.5, 17.5]], eyes: ['closedTight', 'closedTight'], mouth: 'wail', extras: ['tears'] },
  angry: { brows: [[12.5, 14, 20.5, 18], [27.5, 18, 35.5, 14]], eyes: ['open', 'open'], mouth: 'tightDown' },
  rage: { brows: [[12, 13, 20.5, 18.5], [27.5, 18.5, 36, 13]], eyes: ['wideSmall', 'wideSmall'], mouth: 'scream', extras: ['vein'] },
  surprised: { brows: [[12.5, 11.5, 20, 10.5], [28, 10.5, 35.5, 11.5]], eyes: ['wide', 'wide'], mouth: 'o' },
  scared: { brows: [[12.5, 14, 20, 10.5], [28, 10.5, 35.5, 14]], eyes: ['wide', 'wide'], mouth: 'fear', extras: ['sweat'] },
  disgust: { brows: [[12.5, 15, 20, 17], [28, 17, 35.5, 15]], eyes: ['squint', 'squint'], mouth: 'disgust' },
  contempt: { brows: [[12.5, 16.5, 20, 16.5], [28, 13, 35.5, 14]], eyes: ['half', 'open'], mouth: 'smirk' },
  thinking: { brows: [[12.5, 16, 20, 16.5], [28, 13.5, 35.5, 13]], eyes: ['lookUp', 'lookUp'], mouth: 'hmm', extras: ['dots'] },
  sleepy: { brows: [[12.5, 15.5, 20, 15], [28, 15, 35.5, 15.5]], eyes: ['half', 'half'], mouth: 'smallO', extras: ['zzz'] },
  wink: { brows: [[12.5, 14, 20, 13.5], [28, 16.5, 35.5, 16]], eyes: ['open', 'happy'], mouth: 'smile' },
  determined: { brows: [[12.5, 15, 20.5, 17], [27.5, 17, 35.5, 15]], eyes: ['squint', 'squint'], mouth: 'tight' },
  shy: { brows: [[12.5, 16, 20, 14], [28, 14, 35.5, 16]], eyes: ['lookDown', 'lookDown'], mouth: 'wavy', extras: ['blush'] },
  kiss: { brows: [[12.5, 15, 20, 14], [28, 14, 35.5, 15]], eyes: ['closed', 'closed'], mouth: 'kiss', extras: ['heart'] },
  bored: { brows: [[12.5, 16, 20, 16], [28, 16, 35.5, 16]], eyes: ['half', 'half'], mouth: 'flatDown' },
  pain: { brows: [[12.5, 17, 20.5, 14.5], [27.5, 14.5, 35.5, 17]], eyes: ['closedTight', 'closedTight'], mouth: 'grimace', extras: ['sweat'] },
};

const stroke = (d, w = 1.9) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

function eye(type, cx, cy) {
  switch (type) {
    case 'open': return `<ellipse cx="${cx}" cy="${cy}" rx="2.1" ry="2.7" fill="${INK}"/>`;
    case 'wide': return `<circle cx="${cx}" cy="${cy}" r="3.7" fill="#fff" stroke="${INK}" stroke-width="1.3"/><circle cx="${cx}" cy="${cy + 0.3}" r="1.6" fill="${INK}"/>`;
    case 'wideSmall': return `<circle cx="${cx}" cy="${cy}" r="3.2" fill="#fff" stroke="${INK}" stroke-width="1.3"/><circle cx="${cx}" cy="${cy}" r="1" fill="${INK}"/>`;
    case 'happy': return stroke(`M${cx - 3},${cy + 1} q3,-4 6,0`);
    case 'closed': return stroke(`M${cx - 3},${cy - 0.5} q3,3 6,0`);
    case 'closedTight': { // ">" "<" pointing at the nose
      const s = cx < 24 ? 1 : -1;
      return stroke(`M${cx - 2.4 * s},${cy - 2.2} L${cx + 2.4 * s},${cy} L${cx - 2.4 * s},${cy + 2.2}`);
    }
    case 'squint': return stroke(`M${cx - 3},${cy} q3,-1.6 6,0`, 2.2) + `<ellipse cx="${cx}" cy="${cy + 0.6}" rx="1.4" ry="1" fill="${INK}"/>`;
    case 'half': return `<path d="M${cx - 2.6},${cy} a2.6,2.6 0 0 0 5.2,0 z" fill="${INK}"/>` + stroke(`M${cx - 3.2},${cy} h6.4`, 1.6);
    case 'lookUp': return `<ellipse cx="${cx + 1}" cy="${cy - 1}" rx="2" ry="2.6" fill="${INK}"/>`;
    case 'lookDown': return `<ellipse cx="${cx - 0.6}" cy="${cy + 1.2}" rx="2" ry="2.3" fill="${INK}"/>`;
    default: return '';
  }
}

function mouth(type) {
  const dark = '#5a2a2a', teeth = '#ffffff', tongue = '#d86a6a';
  switch (type) {
    case 'flat': return stroke('M18.5,34 h11');
    case 'flatDown': return stroke('M18,34.5 q6,-1 12,0.8');
    case 'smile': return stroke('M15.5,31.5 q8.5,7 17,0');
    case 'grin': return `<path d="M15,31 h18 q-1.5,8 -9,8 q-7.5,0 -9,-8 z" fill="${dark}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/><path d="M16,31.8 h16 q-0.3,1.8 -1,2.8 h-14 q-0.7,-1 -1,-2.8 z" fill="${teeth}"/>`;
    case 'laugh': return `<path d="M13.5,29.5 h21 q-1,11.5 -10.5,11.5 q-9.5,0 -10.5,-11.5 z" fill="${dark}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/><path d="M14.6,30.4 h18.8 q-0.2,2 -0.8,3.2 h-17.2 q-0.6,-1.2 -0.8,-3.2 z" fill="${teeth}"/><path d="M18.5,38.5 q5.5,-4 11,0 q-5.5,2.6 -11,0 z" fill="${tongue}"/>`;
    case 'frown': return stroke('M17,37 q7,-6 14,0');
    case 'wail': return `<path d="M16,38 q8,-11 16,0 q-8,3 -16,0 z" fill="${dark}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`;
    case 'tightDown': return stroke('M17.5,35.5 q6.5,-3 13,0', 2.3);
    case 'tight': return stroke('M17.5,34.5 h13', 2.4);
    case 'scream': return `<path d="M15.5,30 q8.5,-3 17,0 q1,11 -8.5,11 q-9.5,0 -8.5,-11 z" fill="${dark}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/><path d="M16.6,30.6 q7.4,-2.4 14.8,0 l-0.2,1.9 q-7.2,-2 -14.4,0 z" fill="${teeth}"/><path d="M17.6,39.2 l1,-1.8 h10.8 l1,1.8 q-6.4,2.6 -12.8,0 z" fill="${teeth}"/>`;
    case 'o': return `<ellipse cx="24" cy="35" rx="3.4" ry="4.4" fill="${dark}" stroke="${INK}" stroke-width="1.4"/>`;
    case 'smallO': return `<ellipse cx="24.5" cy="35" rx="2" ry="2.4" fill="${dark}" stroke="${INK}" stroke-width="1.3"/>`;
    case 'fear': return `<path d="M16,36 q2,-4 4,-2 t4,0 t4,0 t4,2 q-8,4 -16,0 z" fill="${dark}" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/><path d="M17,35.6 q7,1.4 14,0" stroke="${teeth}" stroke-width="1.3" fill="none"/>`;
    case 'disgust': return stroke('M16,35 q3,-3.5 6,-1.2 q3,2.2 6,-1 q2.4,-2 4.5,1.2');
    case 'smirk': return stroke('M17.5,35 q7,1.5 13.5,-3.5');
    case 'hmm': return stroke('M19,35 q4,-1.2 9,0.6');
    case 'wavy': return stroke('M16.5,34.5 q2,-2.2 4,0 t3.8,0 t3.8,0 t3.8,0', 1.7);
    case 'kiss': return stroke('M22.5,31.5 q4,0.8 1,3 q3.4,1.2 -0.6,3.6', 1.9);
    case 'grimace': return `<rect x="15" y="31" width="18" height="7" rx="2.5" fill="${teeth}" stroke="${INK}" stroke-width="1.5"/>` + stroke('M15.5,34.5 h17 M19.5,31.5 v6 M24,31.5 v6 M28.5,31.5 v6', 1.1);
    default: return '';
  }
}

function extra(type) {
  switch (type) {
    case 'blush': return '<ellipse cx="13" cy="28.5" rx="3.6" ry="2" fill="#f08a8a" opacity=".75"/><ellipse cx="35" cy="28.5" rx="3.6" ry="2" fill="#f08a8a" opacity=".75"/>';
    case 'blushSoft': return '<ellipse cx="13" cy="28.5" rx="3.2" ry="1.8" fill="#f2a0a0" opacity=".55"/><ellipse cx="35" cy="28.5" rx="3.2" ry="1.8" fill="#f2a0a0" opacity=".55"/>';
    case 'tears': return '<path d="M15.5,26 q-1.6,3.2 0,4.4 q1.6,-1.2 0,-4.4 z M32.5,26 q-1.6,3.2 0,4.4 q1.6,-1.2 0,-4.4 z" fill="#6fb3ff" stroke="#3d7fd0" stroke-width=".7"/>';
    case 'sweat': return '<path d="M37.5,9 q-2.4,4.2 0,5.6 q2.4,-1.4 0,-5.6 z" fill="#8fd0ff" stroke="#3d7fd0" stroke-width=".7"/>';
    case 'vein': return `<path d="M33,7.5 l2,2 m1.6,-2.4 l-2,2 m0.6,1.6 l2,2 m-4.4,-0.6 l2,-2" stroke="#e04848" stroke-width="1.5" stroke-linecap="round"/>`;
    case 'zzz': return `<text x="35" y="12" font-family="Arial, sans-serif" font-size="8" font-weight="700" fill="#7c6cff">z</text><text x="40" y="7" font-family="Arial, sans-serif" font-size="6" font-weight="700" fill="#7c6cff">z</text>`;
    case 'heart': return '<path d="M39,8.5 c-1.4,-2.2 -4.6,-1 -3.6,1.6 c0.6,1.4 3.6,3.6 3.6,3.6 s3,-2.2 3.6,-3.6 c1,-2.6 -2.2,-3.8 -3.6,-1.6 z" fill="#ff5c7a"/>';
    case 'dots': return '<circle cx="38.5" cy="9" r="1.4" fill="#cfc6ff"/><circle cx="41.8" cy="6.2" r="1.7" fill="#cfc6ff"/><circle cx="45" cy="3.2" r="2" fill="#cfc6ff"/>';
    default: return '';
  }
}

/** SVG markup of the icon of a preset (falls back to neutral). */
export function faceIconSVG(id) {
  const d = ICONS[id] || ICONS.neutral;
  const body = [
    `<circle cx="24" cy="25" r="19.5" fill="${SKIN}" stroke="${INK}" stroke-width="1.6"/>`,
    `<path d="M9.5,31 a15,15 0 0 0 29,0 a19.5,19.5 0 0 1 -29,0 z" fill="${SHADE}" opacity=".55"/>`,
    ...(d.extras || []).filter((x) => x.startsWith('blush')).map(extra),
    stroke(`M${d.brows[0][0]},${d.brows[0][1]} L${d.brows[0][2]},${d.brows[0][3]}`, 2.1),
    stroke(`M${d.brows[1][0]},${d.brows[1][1]} L${d.brows[1][2]},${d.brows[1][3]}`, 2.1),
    eye(d.eyes[0], 16.5, 22), eye(d.eyes[1], 31.5, 22),
    mouth(d.mouth),
    ...(d.extras || []).filter((x) => !x.startsWith('blush')).map(extra),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">${body.join('')}</svg>`;
}

const _urls = new Map();
/** data: URL of the icon (cached). */
export function faceIconURL(id) {
  let u = _urls.get(id);
  if (!u) { u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(faceIconSVG(id)); _urls.set(id, u); }
  return u;
}
