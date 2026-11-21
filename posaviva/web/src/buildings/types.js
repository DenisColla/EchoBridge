// Building prop types (category 'edifici'). Each type = a style generator +
// its parameters. Registered into the props catalog by index.js.
import { range, int, seg, flag, COMMON } from './styles/common.js';
import { palazzina60, condominio, storico, negozio, bar } from './styles/urban.js';
import { villetta, schiera, cascina, baita, giapponese } from './styles/houses.js';
import { grattacielo, gradoni, twist, artdeco } from './styles/towers.js';
import { capannone, benzinaio, chiesa, castello, tempio, faro } from './styles/special.js';
import { isolato } from './styles/block.js';
import { Builder } from './kit.js';

/** Sub-categories (chips in the Edifici tool; `sub` on each type). */
export const SUBS = [
  { id: 'case', label: 'Case' },
  { id: 'palazzi', label: 'Palazzi' },
  { id: 'torri', label: 'Grattacieli' },
  { id: 'negozi', label: 'Negozi e servizi' },
  { id: 'industria', label: 'Industria' },
  { id: 'monumenti', label: 'Monumenti' },
  { id: 'isolati', label: 'Isolati' },
];

/** Listed by the Edifici tool (ownTool), not by "Oggetti". */
export const CATEGORY = { id: 'edifici', label: 'Edifici', subs: SUBS, ownTool: true };

const ROOF2 = (def = 'piano') => seg('roof', 'Tetto', [['piano', 'Piano'], ['falde', 'A falde']], def);
const BALC = (def = 'all') => seg('balc', 'Balconi', [['none', 'No'], ['some', 'Alcuni'], ['all', 'Tutti']], def);
const SIGN = (def) => seg('sign', 'Insegna', def.map((s) => [s, s.charAt(0) + s.slice(1).toLowerCase()]), def[0]);
const W = (min, max, def) => range('width', 'Larghezza', min, max, 0.5, def);
const Dp = (min, max, def) => range('depth', 'Profondità', min, max, 0.5, def);
const FL = (min, max, def) => int('floors', 'Piani', min, max, def);

/** A generator drawing into a Builder -> a prop build() returning role geometries. */
const wrap = (fn) => (p) => fn(p, new Builder()).finish();

/**
 * Types. Fields: id, label, cat, sub, color (default facade color = prop color),
 * palette (swatch family for the Edifici tool), heavy (rebuild on release only),
 * params, build(params), tags.
 */
export const BUILDING_TYPES = [
  // ---------------------------------------------------------------- case
  { id: 'ed_villetta', label: 'Villetta moderna', sub: 'case', color: '#f1efea', palette: 'modern',
    params: [seg('variant', 'Forma', [['cubica', 'Cubica'], ['falda', 'Falda'], ['elle', 'A L']], 'cubica'), FL(1, 2, 2), W(8, 22, 12), Dp(7, 16, 10), ...COMMON()],
    build: wrap(villetta), tags: ['villa', 'casa', 'moderna', 'giardino'] },
  { id: 'ed_schiera', label: 'Case a schiera', sub: 'case', color: '#e8dcc4', palette: 'plaster',
    params: [seg('variant', 'Stile', [['italiana', 'Italiana'], ['inglese', 'Inglese'], ['nordica', 'Nordica']], 'italiana'),
      int('units', 'Case', 2, 8, 4), range('unitWidth', 'Larghezza casa', 4.5, 8, 0.25, 6), FL(2, 4, 3), Dp(8, 14, 10), flag('gardens', 'Giardinetti', true), ...COMMON()],
    build: wrap(schiera), tags: ['schiera', 'villette', 'londra', 'amsterdam'] },
  { id: 'ed_cascina', label: 'Casa di campagna', sub: 'case', color: '#cfc2a6', palette: 'stone',
    params: [seg('variant', 'Muri', [['pietra', 'Pietra'], ['intonaco', 'Intonaco']], 'pietra'), FL(2, 3, 2), W(9, 22, 13), Dp(7, 13, 9), flag('barn', 'Fienile con portico', true), ...COMMON()],
    build: wrap(cascina), tags: ['cascina', 'fattoria', 'campagna', 'casale', 'fienile'] },
  { id: 'ed_baita', label: 'Baita di montagna', sub: 'case', color: '#8a5a3b', palette: 'wood',
    params: [seg('variant', 'Legno', [['tronchi', 'Tronchi'], ['assi', 'Assi']], 'assi'), FL(1, 3, 2), W(6, 14, 9), Dp(6, 12, 8),
      seg('roof', 'Tetto', [['pietra', 'Lose di pietra'], ['legno', 'Scandole']], 'pietra'), ...COMMON()],
    build: wrap(baita), tags: ['baita', 'chalet', 'montagna', 'legno', 'rifugio'] },
  { id: 'ed_giapponese', label: 'Casa giapponese', sub: 'case', color: '#ece6d6', palette: 'white',
    params: [seg('variant', 'Tipo', [['minka', 'Minka'], ['machiya', 'Machiya']], 'minka'), W(8, 18, 12), Dp(6, 14, 9), ...COMMON()],
    build: wrap(giapponese), tags: ['giappone', 'shoji', 'tradizionale', 'oriente'] },
  // ---------------------------------------------------------------- palazzi
  { id: 'ed_palazzina', label: 'Palazzina anni ’60', sub: 'palazzi', color: '#e9c98f', palette: 'plaster',
    params: [seg('variant', 'Facciata', [['a', 'Intonaco'], ['b', 'Klinker'], ['c', 'Mattoni']], 'a'), FL(3, 10, 6), W(10, 32, 16), Dp(8, 20, 12),
      ROOF2('piano'), BALC('all'), flag('shops', 'Negozi al piano terra', true), ...COMMON()],
    build: wrap(palazzina60), tags: ['condominio', 'anni 60', 'appartamenti', 'città', 'periferia'] },
  { id: 'ed_condominio', label: 'Condominio moderno', sub: 'palazzi', color: '#f1efea', palette: 'modern',
    params: [seg('variant', 'Finitura', [['a', 'Bianco e legno'], ['b', 'Grigio'], ['c', 'Mattoni']], 'a'), FL(4, 14, 8), W(14, 36, 22), Dp(10, 22, 14),
      BALC('some'), flag('attic', 'Attico arretrato', true), flag('shops', 'Negozi al piano terra', false), ...COMMON()],
    build: wrap(condominio), tags: ['moderno', 'appartamenti', 'vetro', 'residence'] },
  { id: 'ed_storico', label: 'Palazzo storico', sub: 'palazzi', color: '#e3b77d', palette: 'plaster',
    params: [seg('variant', 'Stile', [['neo', 'Neoclassico'], ['liberty', 'Liberty'], ['parigi', 'Parigino']], 'neo'), FL(3, 7, 5), W(12, 36, 20), Dp(10, 22, 14),
      ROOF2('falde'), flag('shops', 'Negozi al piano terra', false), ...COMMON()],
    build: wrap(storico), tags: ['palazzo', 'storico', 'neoclassico', 'liberty', 'parigi', 'europa', 'centro'] },
  { id: 'ed_artdeco', label: 'Edificio Art Déco', sub: 'palazzi', color: '#d8cfbd', palette: 'stone',
    params: [FL(8, 30, 14), W(16, 36, 22), Dp(14, 30, 20), ...COMMON()],
    build: wrap(artdeco), tags: ['art deco', 'anni 30', 'new york', 'gotham', 'noir'] },
  // ---------------------------------------------------------------- grattacieli
  { id: 'ed_grattacielo', label: 'Grattacielo in vetro', sub: 'torri', color: '#6f8aa0', palette: 'glass', heavy: true,
    params: [seg('shape', 'Pianta', [['prisma', 'Prisma'], ['smussato', 'Smussata'], ['ovale', 'Ovale']], 'prisma'), FL(12, 80, 40), W(18, 50, 28), Dp(18, 50, 28),
      flag('spire', 'Guglia', false), ...COMMON()],
    build: wrap(grattacielo), tags: ['grattacielo', 'vetro', 'uffici', 'skyline', 'torre'] },
  { id: 'ed_gradoni', label: 'Grattacielo a gradoni', sub: 'torri', color: '#c9b48e', palette: 'stone', heavy: true,
    params: [seg('variant', 'Rivestimento', [['pietra', 'Pietra'], ['vetro', 'Vetro']], 'pietra'), FL(12, 60, 30), int('tiers', 'Gradoni', 2, 4, 3), W(20, 50, 32), Dp(20, 50, 30),
      flag('spire', 'Guglia', true), ...COMMON()],
    build: wrap(gradoni), tags: ['grattacielo', 'gradoni', 'new york', 'anni 30'] },
  { id: 'ed_twist', label: 'Torre twist / curva', sub: 'torri', color: '#7d8f9c', palette: 'glass', heavy: true,
    params: [seg('variant', 'Forma', [['twist', 'Ruotata'], ['ovale', 'Curva']], 'twist'), FL(15, 70, 40), range('twist', 'Rotazione', 20, 180, 5, 90, '°'), W(16, 40, 24), Dp(16, 40, 24), ...COMMON()],
    build: wrap(twist), tags: ['torre', 'twist', 'curva', 'futuristico', 'skyline'] },
  // ---------------------------------------------------------------- negozi e servizi
  { id: 'ed_negozio', label: 'Negozio con vetrina', sub: 'negozi', color: '#e7d3b8', palette: 'plaster',
    params: [seg('variant', 'Tipo', [['bottega', 'Bottega'], ['moderno', 'Moderno'], ['market', 'Market']], 'bottega'), FL(1, 4, 2), W(6, 16, 9), Dp(6, 14, 9),
      SIGN(['PANETTERIA', 'FARMACIA', 'ALIMENTARI', 'LIBRERIA', 'FIORI', 'BOUTIQUE', 'OTTICA', 'MACELLERIA', 'GELATERIA', 'TABACCHI', 'MARKET', 'CINEMA', 'BANCA', 'POSTE', 'HOTEL']),
      ROOF2('falde'), ...COMMON()],
    build: wrap(negozio), tags: ['bottega', 'vetrina', 'insegna', 'shop', 'negozio'] },
  { id: 'ed_bar', label: 'Bar / ristorante', sub: 'negozi', color: '#e9c98f', palette: 'plaster',
    params: [FL(1, 5, 3), W(7, 20, 11), Dp(7, 16, 10),
      SIGN(['BAR', 'CAFFÈ', 'RISTORANTE', 'TRATTORIA', 'PIZZERIA', 'BIRRERIA', 'PUB', 'SUSHI', 'DINER', 'CAFÉ', 'GELATERIA']),
      flag('dehors', 'Dehors con tavolini', true), flag('umbrellas', 'Ombrelloni', true), ROOF2('falde'), ...COMMON()],
    build: wrap(bar), tags: ['caffè', 'ristorante', 'dehors', 'tavolini', 'pizzeria', 'bistrot'] },
  { id: 'ed_benzinaio', label: 'Stazione di servizio', sub: 'negozi', color: '#c0221c', palette: 'metal',
    params: [W(12, 30, 18), Dp(8, 18, 12), ...COMMON()],
    build: wrap(benzinaio), tags: ['benzina', 'distributore', 'pompe', 'carburante', 'autogrill'] },
  // ---------------------------------------------------------------- industria
  { id: 'ed_capannone', label: 'Capannone industriale', sub: 'industria', color: '#d8d4cc', palette: 'metal',
    params: [seg('variant', 'Pareti', [['cemento', 'Cemento'], ['lamiera', 'Lamiera'], ['storico', 'Fabbrica']], 'cemento'), W(15, 80, 32), Dp(12, 50, 22), range('height', 'Altezza', 5, 14, 0.5, 8),
      seg('roof', 'Tetto', [['falde', 'A falde'], ['curvo', 'Curvo']], 'falde'), flag('office', 'Palazzina uffici', true), ...COMMON()],
    build: wrap(capannone), tags: ['fabbrica', 'magazzino', 'industria', 'officina', 'deposito'] },
  // ---------------------------------------------------------------- monumenti
  { id: 'ed_chiesa', label: 'Chiesa con campanile', sub: 'monumenti', color: '#e3c9a0', palette: 'stone', heavy: true,
    params: [seg('variant', 'Stile', [['romanica', 'Romanica'], ['classica', 'Classica'], ['gotica', 'Gotica']], 'romanica'), W(10, 24, 14), Dp(18, 50, 30), range('height', 'Altezza navata', 9, 22, 0.5, 14),
      flag('tower', 'Campanile', true), range('towerHeight', 'Altezza campanile', 18, 60, 1, 32), flag('apse', 'Abside', true), ...COMMON()],
    build: wrap(chiesa), tags: ['chiesa', 'campanile', 'duomo', 'cattedrale', 'gotica'] },
  { id: 'ed_torre', label: 'Torre medievale', sub: 'monumenti', color: '#bfb39b', palette: 'stone',
    params: [seg('shape', 'Pianta', [['quadrata', 'Quadrata'], ['tonda', 'Tonda']], 'quadrata'), range('width', 'Larghezza', 5, 12, 0.25, 7), range('height', 'Altezza', 12, 40, 0.5, 24),
      seg('roof', 'Cima', [['merlata', 'Merlata'], ['conico', 'Tetto a punta']], 'merlata'), ...COMMON()],
    build: wrap((p, b) => castello({ ...p, variant: 'torre' }, b)), tags: ['torre', 'medioevo', 'merli', 'fortezza'] },
  { id: 'ed_castello', label: 'Castello', sub: 'monumenti', color: '#bfb39b', palette: 'stone', heavy: true,
    params: [range('width', 'Lato cortile', 20, 60, 1, 32), range('height', 'Altezza mastio', 14, 40, 0.5, 24), seg('roof', 'Torri', [['merlata', 'Merlate'], ['conico', 'Tetti a punta']], 'merlata'), ...COMMON()],
    build: wrap((p, b) => castello({ ...p, variant: 'castello', shape: 'quadrata' }, b)), tags: ['castello', 'fortezza', 'medioevo', 'fantasy', 'mura'] },
  { id: 'ed_tempio', label: 'Tempio classico', sub: 'monumenti', color: '#ece6d6', palette: 'white',
    params: [seg('variant', 'Ordine', [['dorico', 'Dorico'], ['ionico', 'Ionico'], ['rovina', 'Rovine']], 'dorico'), int('columns', 'Colonne in facciata', 4, 10, 6), W(10, 30, 16), Dp(16, 50, 30), ...COMMON()],
    build: wrap(tempio), tags: ['tempio', 'greco', 'romano', 'colonne', 'rovine', 'antico'] },
  { id: 'ed_faro', label: 'Faro', sub: 'monumenti', color: '#c0221c', palette: 'metal',
    params: [seg('variant', 'Livrea', [['strisce', 'A strisce'], ['bianco', 'Bianco'], ['pietra', 'Pietra']], 'strisce'), range('height', 'Altezza', 12, 50, 0.5, 26), range('radius', 'Raggio base', 2, 5, 0.1, 3),
      flag('house', 'Casa del guardiano', true), ...COMMON()],
    build: wrap(faro), tags: ['faro', 'mare', 'porto', 'costa'] },
  // ---------------------------------------------------------------- isolati
  { id: 'ed_isolato', label: 'Isolato (fronte strada)', sub: 'isolati', color: '#e8dcc4', palette: 'plaster', heavy: true, noColor: true,
    params: [seg('mix', 'Quartiere', [['centro', 'Centro'], ['moderno', 'Moderno'], ['periferia', 'Periferia'], ['misto', 'Misto']], 'centro'),
      range('length', 'Lunghezza', 24, 140, 1, 64), range('depth', 'Profondità', 12, 24, 0.5, 16), seg('height', 'Altezza', [['bassa', 'Bassa'], ['media', 'Media'], ['alta', 'Alta']], 'media'),
      flag('shops', 'Negozi e bar', true), flag('sidewalk', 'Marciapiede', true), ...COMMON()],
    build: (p) => isolato(p, new Builder(), TYPE_MAP).finish(), tags: ['isolato', 'strada', 'città', 'quartiere', 'blocco'] },
];
for (const t of BUILDING_TYPES) t.cat = CATEGORY.id;
export const TYPE_MAP = new Map(BUILDING_TYPES.map((t) => [t.id, t]));
export { range, int, seg, flag };
