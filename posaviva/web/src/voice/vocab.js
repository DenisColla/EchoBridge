// Vocabulary of the command parser, built at runtime FROM THE APP CATALOGS
// (body presets, garments, hair, poses, expressions, animal species and their
// poses, the props / buildings / exteriors registry, room presets, landscapes,
// light presets, camera angles) plus hand-written Italian synonyms.
//
//   collectCatalogs(app)  -> plain data (browser: reads the modules' public data)
//   buildLexicon(catalogs) -> Lexicon (pure; also used by the Node tests)
//
// A Lexicon tags a token stream with the longest matching phrases (stems, typo
// tolerant for content words) and ranks prop types for a noun phrase.
import {
  norm, stem, stemEq, editDistance, typoBudget, INTENT_PHRASES, RELATION_PHRASES, COLORS, COLOR_PHRASES,
  ARTICLES, PREP_ART, PRONOUNS, ORDINALS, NUMBER_WORDS, QUANTIFIERS, FUNCTION_WORDS,
} from './lexicon.js';

// ---------------------------------------------------------------- hand-written synonyms
const PERSON_WORDS = {
  M: 'uomo, uomini, ragazzo, ragazzi, signore, tizio, tizi, maschio, maschi, giovanotto, vecchio, vecchietto, anziano, nonno, bambino, bimbo, bambinetto, ragazzino, uomo d affari, poliziotto, soldato, guerriero, cavaliere, re, principe, cameriere, cuoco, dottore, medico, studente, professore, pugile, ladro, detective, investigatore, supereroe, eroe, mago, pirata, cowboy, marito, padre, papa, fratello, amico, fidanzato, operaio, contadino, scienziato, giocatore, calciatore, motociclista, modello, ballerino, gentiluomo, sposo, manager, impiegato, avvocato, ninja, samurai, vichingo, barbone, senzatetto, poeta, pittore, attore, killer, criminale, gangster, agente, sergente, capitano, figlio, zio, nipote',
  F: 'donna, donne, ragazza, ragazze, signora, tizia, tipa, tipe, femmina, femmine, vecchia, vecchietta, anziana, nonna, bambina, bimba, bambinetta, ragazzina, poliziotta, soldatessa, guerriera, regina, principessa, cameriera, cuoca, dottoressa, studentessa, professoressa, ladra, investigatrice, supereroina, eroina, maga, strega, piratessa, moglie, madre, mamma, sorella, amica, fidanzata, operaia, contadina, scienziata, giocatrice, calciatrice, modella, ballerina, sposa, signorina, impiegata, avvocatessa, attrice, figlia, zia, cowgirl, infermiera, segretaria',
  X: 'persona, persone, personaggio, personaggi, qualcuno, figura, figure, atleta, cantante, musicista, ciclista, turista, artista, giornalista, pianista, chitarrista, collega, insegnante, umano, essere umano, gente, adolescente, giovane',
};
/** Extra traits of some person words (hair, outfit). */
const PERSON_TRAITS = {
  vecchio: { hairColor: '#8d8a86' }, vecchietto: { hairColor: '#8d8a86' }, anziano: { hairColor: '#dedad3' }, nonno: { hairColor: '#dedad3' },
  vecchia: { hairColor: '#8d8a86' }, vecchietta: { hairColor: '#dedad3' }, anziana: { hairColor: '#dedad3' }, nonna: { hairColor: '#dedad3', hairStyle: 'chignon' },
  bambino: { body: 'slim' }, bambina: { body: 'slim' }, bimbo: { body: 'slim' }, bimba: { body: 'slim' }, ragazzino: { body: 'slim' }, ragazzina: { body: 'slim' }, ragazzo: { body: 'slim' }, ragazza: { body: 'slim' },
  'uomo d affari': { outfit: 'formal' }, manager: { outfit: 'formal' }, avvocato: { outfit: 'formal' }, avvocatessa: { outfit: 'formal' }, impiegato: { outfit: 'formal' }, impiegata: { outfit: 'formal' },
  gentiluomo: { outfit: 'formal' }, sposo: { outfit: 'formal' }, sposa: { outfit: 'dress', color: '#f6f4ef' }, segretaria: { outfit: 'formal' },
  atleta: { outfit: 'sport' }, pugile: { outfit: 'sport', body: 'curvy' }, calciatore: { outfit: 'sport' }, calciatrice: { outfit: 'sport' }, ballerina: { outfit: 'sport' },
  poliziotto: { outfit: 'police' }, poliziotta: { outfit: 'police' }, agente: { outfit: 'police' }, soldato: { outfit: 'army' }, soldatessa: { outfit: 'army' }, sergente: { outfit: 'army' },
  supereroe: { body: 'curvy', outfit: 'sport' }, supereroina: { outfit: 'sport' }, operaio: { outfit: 'work' }, operaia: { outfit: 'work' }, contadino: { outfit: 'work' }, contadina: { outfit: 'work' },
  barbone: { outfit: 'street' }, senzatetto: { outfit: 'street' }, gangster: { outfit: 'formal' }, killer: { outfit: 'formal' },
};
const BODY_WORDS = {
  slim: 'magro, magra, magri, magre, snello, snella, snelli, esile, sottile, slanciato, slanciata, minuto, minuta, smilzo, smilza, mingherlino, gracile, asciutto, asciutta, filiforme, longilineo, longilinea, secco, secca',
  normal: 'normale, normali, medio, media, nella media, atletico, atletica, in forma, sportivo, sportiva',
  curvy: 'curvy, curvilinea, formosa, formoso, formose, robusto, robusta, robusti, in carne, grasso, grassa, grassi, cicciottello, cicciottella, cicciotto, paffuto, paffuta, sovrappeso, corpulento, corpulenta, muscoloso, muscolosa, muscolosi, palestrato, palestrata, massiccio, massiccia, grosso, grossa, prosperosa, abbondante, burroso, burrosa, tarchiato, tarchiata, possente, nerboruto, culturista',
};
const GARMENT_WORDS = {
  tshirt: 'maglietta, magliette, tshirt, t shirt, maglia a maniche corte, maglietta a maniche corte, maglia, magliettina',
  tank: 'canotta, canottiera, smanicato, smanicata, top senza maniche, canotte',
  longsleeve: 'maglia a maniche lunghe, maglietta a maniche lunghe, maglia lunga, maglione, maglioncino, lupetto, pullover',
  sweatshirt: 'felpa, felpe, felpa con cappuccio, felpona',
  trackjacket: 'felpa con zip, felpa con la zip, giacca della tuta, giubbotto sportivo, giacchetto, giubbino, giubbotto, bomber',
  shirt: 'camicia, camicie, camicetta, camiciola',
  blazer: 'giacca, giacche, giacchetta, blazer, giacca elegante, giacca e cravatta, completo, giacca di pelle',
  sporttop: 'top sportivo, top, reggiseno sportivo, crop top, top corto',
  jeans: 'jeans, pantaloni di jeans, jeans strappati, denim',
  trousers: 'pantaloni eleganti, pantaloni, pantalone, calzoni, pantaloni lunghi',
  sweatpants: 'pantaloni della tuta, tuta, tuta da ginnastica, pantaloni da ginnastica, joggers, jogger, pantaloni sportivi',
  cargo: 'pantaloni cargo, cargo, pantaloni militari, pantaloni mimetici',
  shorts: 'pantaloncini, shorts, short, pantaloni corti, bermuda, calzoncini, pantaloncino',
  leggings: 'leggings, leggins, fuseaux, fuseau',
  miniskirt: 'minigonna, gonna corta, gonnellina, minigonne',
  pencilskirt: 'gonna, gonne, gonna a tubino, gonna elegante, gonna dritta, gonna a matita',
  flaredskirt: 'gonna svasata, gonna lunga, gonna a ruota, gonna midi, gonna larga, gonna a pieghe',
  dress: 'vestito, vestiti, vestitino, abito, abiti, abito da sera, tubino, abito elegante, abitino, vestito da sera, vestito lungo',
  sneakers: 'scarpe da ginnastica, sneakers, sneaker, scarpe sportive, scarpette, snickers, scarpe da tennis',
  dressshoes: 'scarpe eleganti, scarpe, mocassini, scarpe nere, scarpe di pelle, decollete, scarpe col tacco, tacchi',
  boots: 'stivali, anfibi, scarponi, stivaletti, stivale, scarponcini',
  socks: 'calzini, calze, calzettoni',
  underwear: 'intimo, mutande, biancheria, biancheria intima, slip, reggiseno, costume, costume da bagno, bikini, boxer',
};
/** Quick outfits (person traits, "elegante", "in tuta"...): garment ids by sex. */
export const OUTFIT_SETS = {
  formal: { F: ['shirt', 'pencilskirt', 'blazer', 'dressshoes'], M: ['shirt', 'trousers', 'blazer', 'dressshoes'] },
  sport: { F: ['sporttop', 'leggings', 'sneakers'], M: ['tank', 'sweatpants', 'sneakers'] },
  street: { F: ['sweatshirt', 'cargo', 'boots'], M: ['sweatshirt', 'cargo', 'boots'] },
  casual: { F: ['tshirt', 'jeans', 'sneakers'], M: ['tshirt', 'jeans', 'sneakers'] },
  dress: { F: ['dress', 'dressshoes'], M: ['shirt', 'trousers', 'blazer', 'dressshoes'] },
  police: { F: [['shirt', '#2b3a55'], ['trousers', '#1f2a44'], ['dressshoes', '#1b1b1c']], M: [['shirt', '#2b3a55'], ['trousers', '#1f2a44'], ['dressshoes', '#1b1b1c']] },
  army: { F: [['tshirt', '#5b5e45'], ['cargo', '#5b5e45'], 'boots'], M: [['tshirt', '#5b5e45'], ['cargo', '#5b5e45'], 'boots'] },
  work: { F: [['longsleeve', '#6b6e72'], ['cargo', '#3f4a3c'], 'boots'], M: [['longsleeve', '#6b6e72'], ['cargo', '#3f4a3c'], 'boots'] },
};
const OUTFIT_WORDS = {
  formal: 'elegante, eleganti, elegantissimo, elegantissima, in giacca e cravatta, in abito, in completo, vestito elegante, vestita elegante, ben vestito, ben vestita, in tiro',
  sport: 'in tuta, sportivo, sportiva, in tenuta sportiva, da palestra, in tuta da ginnastica',
  casual: 'casual, in jeans e maglietta, vestito normale, vestita normale',
  street: 'stile street, streetwear, da strada',
};
const HAIR_STYLE_WORDS = {
  nessuno: 'calvo, calva, pelato, pelata, senza capelli, testa pelata',
  rasato: 'rasato, rasata, capelli rasati, testa rasata, rapato, rapata, a zero, capelli a zero',
  corti_classici: 'capelli corti, corti, capelli cortissimi',
  corti_spettinati: 'spettinato, spettinata, capelli spettinati, scompigliati, capelli arruffati, arruffati',
  undercut: 'undercut, rasato ai lati',
  pompadour: 'pompadour, ciuffo, ciuffo alto, banana',
  caschetto: 'caschetto, a caschetto, bob, capelli a caschetto',
  lunghi_lisci: 'capelli lunghi, lunghi, capelli lisci, lisci, capelli lunghi e lisci, chioma lunga',
  lunghi_mossi: 'capelli mossi, mossi, ondulati, capelli ondulati, capelli lunghi e mossi',
  ricci: 'ricci, riccia, ricciolo, ricciolina, capelli ricci, riccioluto, riccioluta, boccoli',
  afro: 'afro, capelli afro',
  coda: 'coda, coda di cavallo, codino, capelli legati',
  chignon: 'chignon, crocchia, capelli raccolti in uno chignon',
  treccia: 'treccia, trecce, capelli intrecciati',
  codini: 'codini, due codini, due code',
  cresta: 'cresta, moicano, cresta punk, punk',
  raccolti: 'capelli raccolti, raccolti, capelli tirati su',
};
const HAIR_COLOR_WORDS = {
  nero: 'mora, moro, mori, more, capelli neri, corvino, corvina, bruna, bruno',
  castano_scuro: 'castano scuro, castana scura',
  castano: 'castano, castana, castani, castane, capelli castani',
  castano_chiaro: 'castano chiaro, castana chiara',
  biondo: 'biondo, bionda, biondi, bionde, capelli biondi, biondina, biondino, biondissima',
  biondo_scuro: 'biondo scuro, bionda scura',
  ramato: 'rossa di capelli, capelli rossi, rosso di capelli, ramato, ramata, rossiccio, rossiccia, capelli ramati, dai capelli rossi',
  grigio: 'brizzolato, brizzolata, capelli grigi, grigio di capelli, canuto',
  bianco: 'capelli bianchi, dai capelli bianchi, capelli argentati',
};
const BEARD_WORDS = {
  piena: 'barba, barba lunga, barba folta, barbuto, barba piena',
  corta: 'barba corta, barbetta, barba di tre giorni, barba incolta, barba sfatta, accenno di barba',
  pizzetto: 'pizzetto, pizzo',
  baffi: 'baffi, baffuto, baffetti, coi baffi',
  nessuna: 'senza barba, sbarbato, glabro, ben rasato',
};
// character poses (pose library ids)
const POSE_WORDS = {
  relaxed: 'in piedi, dritto, dritta, fermo, ferma, rilassato, rilassata, eretto, eretta, sta in piedi, stanno in piedi, in posa normale, normale in piedi',
  contrapposto: 'contrapposto, peso su una gamba, posa da modella, in posa',
  hands_on_hips: 'mani sui fianchi, mani ai fianchi, con le mani sui fianchi, pugni sui fianchi',
  arms_crossed: 'braccia conserte, braccia incrociate, a braccia conserte, con le braccia conserte, con le braccia incrociate, incrocia le braccia',
  hands_behind_back: 'mani dietro la schiena, mani dietro, mani dietro alla schiena',
  wave: 'saluta, salutare, salutando, che saluta, saluto, fa ciao, agita la mano, salutano',
  lean_wall: 'appoggiato al muro, appoggiata al muro, appoggiato alla parete, appoggiata alla parete, poggiato al muro, poggiata al muro, contro il muro',
  lean_side: 'appoggiato di lato, appoggiata di lato, appoggiato, appoggiata, si appoggia, appoggiati',
  walk: 'cammina, camminare, camminando, che cammina, passeggia, passeggiando, a passeggio, camminata, camminano, passeggiano, mentre cammina, sta camminando',
  run: 'corre, correre, correndo, che corre, di corsa, in corsa, corsa, corrono, corri, mentre corre, sta correndo, corridore, scappa, scappando, fugge, in fuga',
  sprint: 'scatta, scatto, sprint, sprinta, corre veloce, corsa veloce, scattando',
  jump: 'salta, saltare, saltando, che salta, salto, saltano, balza, balzo, in aria, saltella',
  jump_arms_up: 'salta con le braccia alzate, salto a braccia alzate, salta di gioia',
  fall: 'cade, cadere, cadendo, caduta, precipita, precipitando, inciampa, in caduta',
  throw: 'lanciare, lanciando, lancio, tira una palla, getta, gettando, scaglia',
  superhero_landing: 'atterraggio da supereroe, atterra, atterraggio, atterrando',
  climb: 'si arrampica, arrampicata, arrampicando, scala il muro, arrampicarsi',
  push: 'spinge, spingere, spingendo, spinta, spingono',
  boxing_guard: 'in guardia, guardia da boxe, boxe, pronto a combattere, pronta a combattere, combatte, combattendo, lotta, lottano, combattono, fa a botte, guardia',
  jab: 'tira un pugno, pugno, da un pugno, colpisce, prende a pugni, pugni, diretto',
  hook: 'gancio, tira un gancio',
  front_kick: 'calcio, tira un calcio, calcio frontale, calcia, scalcia, calcio volante',
  side_kick: 'calcio laterale, calcio di lato',
  sword_guard: 'guardia con spada, in guardia con la spada, impugna la spada',
  dodge: 'schiva, schivata, schivare, schivando, scansa',
  kung_fu: 'kung fu, arti marziali, karate, mossa di karate, posa kung fu',
  sit_chair: 'seduto, seduta, seduti, sedute, siede, sedere, si siede, sta seduto, sta seduta, siedono, seduta composta, seduto composto, si sieda, sedersi, accomodato, accomodata',
  sit_relaxed: 'seduto rilassato, seduta rilassata, stravaccato, stravaccata, spaparanzato, spaparanzata, seduto comodo, seduta comoda, sbracato, sbracata, svaccato',
  sit_legs_crossed: 'gambe accavallate, accavallate, accavalla le gambe, con le gambe accavallate, accavallando',
  sit_stool: 'seduto sullo sgabello, seduta sullo sgabello',
  sit_floor_cross: 'seduto a terra, seduta a terra, seduto per terra, seduta per terra, gambe incrociate, a gambe incrociate, seduto sul pavimento, seduta sul pavimento, a gambe incrociate per terra, seduto sull erba, seduta sull erba, alla turca',
  sit_floor_hug: 'gambe raccolte, abbraccia le ginocchia, rannicchiato, rannicchiata, raggomitolato, raggomitolata',
  lie_back: 'sdraiato, sdraiata, sdraiati, disteso, distesa, steso, stesa, coricato, coricata, supino, supina, a pancia in su, si sdraia, sdraia, si stende, giace, sdraiarsi',
  lie_front: 'prono, prona, a pancia in giu, a pancia sotto, a faccia in giu',
  lie_side: 'su un fianco, sul fianco, dorme, dormire, dormendo, addormentato, addormentata, che dorme, sta dormendo, dormono',
  kneel: 'inginocchiato, inginocchiata, in ginocchio, inginocchia, si inginocchia, inginocchiati, prega, pregando',
  kneel_one: 'su un ginocchio, in ginocchio su una gamba, proposta di matrimonio, chiede la mano',
  crouch: 'accovacciato, accovacciata, accucciato, accucciata, accosciato, accosciata, chinato, chinata, si accovaccia, acquattato, acquattata, accovacciati, nascosto, nascosta',
  all_fours: 'carponi, gattoni, a quattro zampe, a gattoni',
  pointing: 'indica, indicare, indicando, che indica, punta il dito, punta, indicano, mostra col dito',
  thinking: 'pensa, riflette, mano sul mento, pensando, riflettendo',
  raise_hand: 'alza la mano, mano alzata, con la mano alzata, alzare la mano, alza il braccio',
  cheer: 'esulta, esultare, esultando, festeggia, festeggiando, braccia al cielo, braccia alzate, vittoria, esultano, tifa, esultante',
  facepalm: 'facepalm, mano in faccia, mano sulla fronte, si dispera',
  bow: 'inchino, si inchina, inchina, inchinarsi, inchinandosi',
  phone_call: 'al telefono, telefona, telefonando, parla al telefono, col telefono, chiama al telefono',
  arms_open: 'braccia aperte, a braccia aperte, apre le braccia, spalanca le braccia, abbraccia',
};
// animal poses: family pose ids (filtered per species at execution)
const APOSE_WORDS = {
  stand: 'in piedi, fermo, ferma, eretto',
  walk: 'cammina, camminando, che cammina, passeggia, al passo',
  run: 'corre, correndo, che corre, di corsa, galoppa, al galoppo, galoppando, galoppo, scappa, corrono, salta e corre',
  sit: 'seduto, seduta, seduti, siede, si siede, accucciato, accucciata',
  lie: 'sdraiato, sdraiata, disteso, distesa, steso, stesa, coricato, a cuccia, riposa, a riposo',
  sleep: 'dorme, dormendo, addormentato, addormentata, che dorme, sonnecchia, raggomitolato',
  jump: 'salta, saltando, che salta, salto, balza',
  attack: 'attacca, attacco, ringhia, ringhiando, ruggisce, ruggendo, ruggito, aggressivo, aggressiva, feroce, minaccioso, minacciosa, abbaia, soffia, morde',
  lookup: 'guarda in alto, ulula, ululando, guarda su, alza la testa',
  play: 'gioca, giocando, che gioca, giocherella, scodinzola, scodinzolando, felice',
  rear: 'impennato, impennata, si impenna, impenna, su due zampe, sulle zampe posteriori',
  perch: 'appollaiato, appollaiata, posato, posata',
  peck: 'becca, beccando, becchetta',
  call: 'canta, cantando, gracchia, chiama, cinguetta',
  spread: 'ali spiegate, ali aperte, apre le ali, a ali spiegate',
  flyup: 'vola, volando, in volo, che vola, spicca il volo, sbatte le ali',
  glide: 'plana, planando, in planata',
  land: 'atterra, atterrando',
  swim: 'nuota, nuotando, che nuota',
  dive: 'si tuffa, picchiata, scende in picchiata',
  rise: 'risale, emerge',
  coil: 'arrotolato, arrotolata, attorcigliato, attorcigliata, avvolto, avvolta, a spirale',
  strike: 'scatta, colpisce',
  raised: 'sollevato, sollevata, alzato, alzata, ritto',
  hide: 'nel guscio, nascosto nel guscio, si nasconde',
  eat: 'mangia, mangiando, bruca, brucando, che mangia, pascola',
  roar: 'urla, grida, sputa fuoco',
  rest: 'a riposo, riposa',
};
const EXPR_WORDS = {
  neutral: 'neutro, neutra, serio, seria, impassibile, inespressivo, inespressiva',
  smile: 'sorride, sorridente, sorridenti, sorriso, sorridendo, sorridere, sorridono, col sorriso, con un sorriso',
  laugh: 'ride, ridere, risata, ridendo, che ride, ridono, sghignazza, a crepapelle',
  happy: 'felice, felici, contento, contenta, allegro, allegra, gioioso, gioiosa, entusiasta',
  sad: 'triste, tristi, malinconico, malinconica, giu di morale, abbattuto, abbattuta, depresso, depressa, afflitto',
  cry: 'piange, piangere, piangendo, in lacrime, che piange, disperato, disperata, piangono',
  angry: 'arrabbiato, arrabbiata, arrabbiati, incazzato, incazzata, irritato, irritata, nervoso, nervosa, imbronciato, imbronciata, accigliato, accigliata, arrabbiarsi',
  rage: 'furioso, furiosa, furibondo, furibonda, urla, urlando, rabbioso, rabbiosa, fuori di se, infuriato, infuriata',
  surprised: 'sorpreso, sorpresa, stupito, stupita, meravigliato, meravigliata, stupefatto, sbalordito, sbalordita, a bocca aperta',
  scared: 'spaventato, spaventata, impaurito, impaurita, terrorizzato, terrorizzata, paura, ha paura, atterrito, preoccupato, preoccupata',
  disgust: 'disgustato, disgustata, schifato, schifata, nauseato, nauseata',
  contempt: 'sprezzante, altezzoso, altezzosa, arrogante, sdegnoso, sdegnosa, beffardo, beffarda',
  thinking: 'pensieroso, pensierosa, pensierosi, assorto, assorta',
  sleepy: 'assonnato, assonnata, stanco, stanca, sonno, ha sonno, sbadiglia',
  wink: 'occhiolino, ammicca, fa l occhiolino, strizza l occhio',
  determined: 'determinato, determinata, deciso, decisa, concentrato, concentrata, risoluto, risoluta, grintoso, grintosa',
  shy: 'imbarazzato, imbarazzata, timido, timida, vergogna, si vergogna, arrossisce',
  kiss: 'bacio, manda un bacio, bacia, fa il bacio',
  bored: 'annoiato, annoiata, noia, si annoia',
  pain: 'dolore, sofferente, soffre, dolorante, ferito, ferita',
};
const ANIMAL_WORDS = {
  cane_medio: 'cane, cani, labrador, golden retriever, retriever, cagnone, cagna, meticcio, bastardino',
  cane_grande: 'cane grande, cane lupo, pastore tedesco, cagnolone, dobermann, alano, husky, rottweiler, cane da guardia',
  cane_piccolo: 'cane piccolo, cagnolino, cagnolina, cagnolini, cucciolo, cuccioli, cucciolo di cane, terrier, barboncino, chihuahua, bassotto, jack russell, volpino, carlino',
  gatto: 'gatto, gatta, gatti, gattino, gattina, gattini, micio, micia, micetto, gattone, felino',
  cavallo: 'cavallo, cavalli, puledro, stallone, giumenta, cavalla, destriero',
  lupo: 'lupo, lupi, lupa', volpe: 'volpe, volpi', leone: 'leone, leoni, leonessa', tigre: 'tigre, tigri', zebra: 'zebra, zebre',
  mucca: 'mucca, mucche, vacca, toro, bue, vitello', maiale: 'maiale, maiali, porco, maialino, suino', pecora: 'pecora, pecore, agnello, agnellino, montone',
  capra: 'capra, capre, caprone, capretta, capretto', cervo: 'cervo, cervi, daino, cerbiatto, renna, alce', cinghiale: 'cinghiale, cinghiali',
  giraffa: 'giraffa, giraffe', coniglio: 'coniglio, conigli, coniglietto, lepre', orso: 'orso, orsi, orsa, orsetto, grizzly',
  elefante: 'elefante, elefanti', rinoceronte: 'rinoceronte, rinoceronti', gorilla: 'gorilla, scimmione',
  scimpanze: 'scimpanze, scimmia, scimmie, scimmietta', canguro: 'canguro, canguri',
  corvo: 'corvo, corvi, cornacchia, merlo', piccione: 'piccione, piccioni, colomba, colombo, uccellino, uccello, uccelli, passero',
  aquila: 'aquila, aquile, falco, rapace, poiana', gufo: 'gufo, gufi, civetta, barbagianni', pappagallo: 'pappagallo, pappagalli, ara',
  gallina: 'gallina, galline, pollo, gallo, pulcino', squalo: 'squalo, squali, pescecane', delfino: 'delfino, delfini, pesce',
  serpente: 'serpente, serpenti, biscia, vipera, cobra, pitone, boa', coccodrillo: 'coccodrillo, coccodrilli, alligatore',
  tartaruga: 'tartaruga, tartarughe, testuggine', drago: 'drago, draghi, dragone, draghetto', unicorno: 'unicorno, unicorni',
  grifone: 'grifone, grifo', pegaso: 'pegaso, cavallo alato, cavallo con le ali',
};
const ROOM_WORDS = {
  soggiorno: 'soggiorno, salotto, living, sala, sala da pranzo, stanza del divano',
  cucina: 'cucina, cucinotto, angolo cottura',
  camera: 'camera da letto, camera, stanza da letto, cameretta, camera matrimoniale',
  bagno: 'bagno, toilette, bagno di casa',
  ufficio: 'ufficio, open space, ufficio moderno',
  aula: 'aula, classe, aula scolastica, scuola, aula di scuola',
  bar: 'bar, pub, locale, osteria, taverna',
  studio: 'set fotografico, studio fotografico, set, studio di posa, sala posa',
};
const LANDSCAPE_WORDS = {
  strada: 'strada di citta, strada, citta, strada cittadina, centro citta, viale, in citta, metropoli, strada di una citta',
  incrocio: 'incrocio, incrocio con grattacieli, downtown, metropoli moderna, citta con grattacieli',
  vicolo: 'vicolo, vicoli, vicolo buio, vicolo notturno, stradina',
  tetto: 'tetto di un grattacielo, rooftop, terrazza panoramica, tetti della citta',
  piazza: 'piazza, piazza europea, piazzetta',
  residenziale: 'quartiere, quartiere residenziale, periferia, sobborgo, villette, zona residenziale',
  parcheggio: 'parcheggio, posteggio, garage',
  porto: 'porto, molo, banchina, porticciolo',
  bosco: 'bosco, foresta, boschi, sottobosco',
  pineta: 'pineta, pini, foresta di pini, abetaia',
  montagna: 'montagna, montagne, monti, alpi, vetta, in montagna',
  deserto: 'deserto, dune, deserto di sabbia',
  spiaggia: 'spiaggia, mare, al mare, costa, riva, lido, scogliera',
  fattoria: 'fattoria, campagna, in campagna, cascina, aia',
  lago: 'lago, laghetto, riva del lago',
  prato: 'prato, prato fiorito, campo, campo fiorito, prateria, radura',
  giungla: 'giungla, jungla, foresta tropicale, foresta pluviale',
  villaggio: 'villaggio, villaggio medievale, borgo, borgo medievale, paesino',
  rovine: 'rovine, rovine antiche, ruderi, tempio in rovina',
  castello: 'castello, fortezza, maniero',
};
const TIME_WORDS = {
  alba: 'alba, all alba, aurora, primo mattino', mattino: 'mattina, mattino, di mattina, pomeriggio, di pomeriggio',
  mezzogiorno: 'mezzogiorno, giorno, di giorno, pieno giorno, mezzodi', tramonto: 'tramonto, al tramonto, ora d oro, ora dorata',
  sera: 'sera, di sera, crepuscolo, imbrunire, serata', notte: 'notte, di notte, notturno, notturna, mezzanotte, buio, al buio, chiaro di luna',
};
const WEATHER_WORDS = {
  sereno: 'sereno, sole, soleggiato, col sole, con il sole, limpido, cielo sereno, bel tempo', nuvoloso: 'nuvoloso, nuvole, coperto, cielo coperto, cielo grigio',
  pioggia: 'pioggia, piove, piovoso, con la pioggia, sotto la pioggia, temporale, tempesta, acquazzone, diluvio', neve: 'neve, nevica, innevato, innevata, con la neve, nevicata, bufera',
  nebbia: 'nebbia, nebbioso, nebbiosa, foschia, con la nebbia',
};
const SEASON_WORDS = { primavera: 'primavera, primaverile, in primavera', estate: 'estate, estivo, estiva, d estate', autunno: 'autunno, autunnale, d autunno', inverno: 'inverno, invernale, d inverno' };
const LIGHT_WORDS = {
  studio: 'luce da studio, studio 3 punti, tre punti, luce di studio, illuminazione da studio', rembrandt: 'rembrandt, luce rembrandt, chiaroscuro',
  backlight: 'controluce, in controluce, retroilluminato, retroilluminata, luce da dietro', top: 'luce dall alto, drammatica, luce drammatica, luce zenitale',
  horror: 'horror, luce horror, luce dal basso, illuminazione horror, da film horror, spettrale', sunset: 'luce da tramonto, luce del tramonto, luce calda, tramonto caldo, luce dorata',
  night: 'luce notturna, notte luna, luce della luna, luce lunare, notturna', flat: 'luce piatta, piatta, uniforme, luce uniforme, luce neutra, neutra',
};
const ANGLE_WORDS = {
  eye: 'altezza occhi, ad altezza occhi, all altezza degli occhi, ad altezza d uomo, altezza uomo, altezza d uomo',
  low: 'dal basso, dal basso verso l alto, dal basso in alto, dal pavimento, rasoterra, contre plongee, prospettiva dal basso, angolazione dal basso, ripresa dal basso, punto di vista basso, sotto in su, verme',
  high: 'dall alto, dall alto verso il basso, dall alto in basso, plongee, angolazione dall alto, ripresa dall alto, punto di vista alto',
  top: 'zenitale, a volo d uccello, a picco, perpendicolare, in pianta, vista dall alto a picco, dall alto a picco, vista aerea, dal cielo',
  front: 'frontale, dal davanti, di faccia, frontalmente',
  threeq: 'tre quarti, di tre quarti, 3/4, a tre quarti',
  side: 'di profilo, profilo, di lato, laterale, di fianco, lateralmente',
  back: 'da dietro, di spalle, retro, dalle spalle, da tergo, alle spalle',
};
const FRAMING_WORDS = {
  face: 'primo piano, primissimo piano, close up, viso, faccia, volto, ritratto, la faccia, il viso, il volto, dettaglio del viso',
  body: 'figura intera, campo intero, intera, tutto il corpo, corpo intero, piano americano, mezzo busto, mezzobusto, piano medio',
  all: 'tutto, tutti, tutta la scena, la scena, campo lungo, totale, panoramica, insieme, tutti quanti, campo lunghissimo',
  hand: 'mano, mani, la mano, le mani',
};
const FOCAL_WORDS = { 24: 'grandangolo, grandangolare, grand angolo', 14: 'ultra grandangolo, fisheye, fish eye, occhio di pesce', 50: 'obiettivo normale, focale normale', 85: 'mediotele, obiettivo da ritratto', 135: 'teleobiettivo, tele, zoom lungo' };

// marker words that set the domain of a clause
const MARKERS = {
  camera: 'camera, telecamera, fotocamera, inquadratura, inquadrature, vista, visuale, punto di vista, angolazione, ripresa, prospettiva, obiettivo, focale, scatto, foto',
  light: 'luce, luci, illuminazione, illuminato, illuminata, atmosfera',
  landscape: 'sfondo, ambientazione, ambiente, scenario, paesaggio, location, ambientato, ambientata, sfondi, panorama, contesto, scena ambientata, una scena',
  hair: 'capelli, capello, chioma, capigliatura, acconciatura, pettinatura, taglio',
  name: 'di nome, chiamato, chiamata, che si chiama, si chiama, nome',
  me: 'me, di me, verso di me, verso la camera, verso la telecamera, verso l obiettivo, lo spettatore, chi guarda, il lettore, verso noi, in camera, l obiettivo',
  floor: 'terra, pavimento, suolo, erba',
  window: 'finestra, finestre, la finestra',
  door: 'porta, porte, ingresso, uscio',
  room: 'stanza, stanze',
  wall: 'muro, parete, pareti, muri',
  all: 'tutto, tutti, tutte, ogni cosa, tutto quanto, tutti quanti, la scena',
  turnBack: 'di spalle, dando le spalle, con la schiena',
  dress: 'vestito di, vestita di, vestiti di, vestite di, tutto di, tutta di, in total',
  con: 'con, insieme con, col, coi, che ha, che indossa, indossa, indossano, ha addosso, vestito con, vestita con, munito di, munita di',
  che: 'che, mentre, intento a, intenta a, impegnato a, impegnata a',
  and: 'e, ed',
  break: 'poi, dopo, quindi, infine, inoltre, e poi, e dopo, dopodiche, successivamente, infine, alla fine, poi anche',
  more: 'piu, ancora, altri, altre, altro, altra, un altro, un altra',
  bigger: 'piu grande, grande, enorme, gigante, gigantesco, grosso',
  smaller: 'piu piccolo, piccolo, piccola, piccolino, minuscolo',
  degrees: 'gradi, grado',
  halfTurn: 'mezzo giro, di 180',
  quarterTurn: 'un quarto di giro',
  mutual: 'si guardano, che si guardano, faccia a faccia, uno di fronte all altro, una di fronte all altra, si fronteggiano, uno davanti all altro, una davanti all altra, si parlano, che si parlano, parlano tra loro, che parlano',
};

/** Generic nouns -> the type a person most likely means (when no other word narrows it). */
const HEAD_DEFAULTS = {
  albero: 'es_latifoglia', alberello: 'es_vaso_albero', macchina: 'es_berlina', auto: 'es_berlina', automobile: 'es_berlina', vettura: 'es_berlina', utilitaria: 'es_utilitaria',
  moto: 'es_moto', motocicletta: 'es_moto', motorino: 'es_scooter', bici: 'es_bici', bicicletta: 'es_bici', camion: 'es_camion', autobus: 'es_autobus', bus: 'es_autobus', pullman: 'es_autobus', furgone: 'es_furgone',
  lampada: 'lampada_terra', lampadario: 'ph_Chandelier_01', casa: 'ed_villetta', villetta: 'ed_villetta', palazzo: 'ed_palazzina', palazzina: 'ed_palazzina', condominio: 'ed_condominio', grattacielo: 'ed_grattacielo',
  negozio: 'ed_negozio', chiesa: 'ed_chiesa', faro: 'ed_faro', torre: 'ed_torre', castello: 'ed_castello', strada: 'es_strada', marciapiede: 'es_marciapiede', panchina: 'es_panchina', lampione: 'es_lampione',
  semaforo: 'es_semaforo', cespuglio: 'es_cespuglio', siepe: 'es_siepe', roccia: 'es_roccia', sasso: 'es_roccia', masso: 'es_roccia', pianta: 'pianta', fiori: 'vaso_fiori', quadro: 'quadro', computer: 'pc',
  pc: 'pc', tv: 'tv', televisore: 'tv', televisione: 'tv', telefono: 'telefono', cellulare: 'telefono', smartphone: 'telefono', libro: 'libro', palla: 'palla', pallone: 'ph_football', specchio: 'specchio', tappeto: 'tappeto',
  armadio: 'armadio', scrivania: 'scrivania', tavolo: 'tavolo', tavolino: 'tavolino', sedia: 'sedia', sgabello: 'sgabello', divano: 'divano', poltrona: 'poltrona', letto: 'letto', cassa: 'ph_wooden_crate_01',
  scatola: 'scatola', valigia: 'ph_vintage_suitcase', chitarra: 'chitarra', pianoforte: 'pianoforte', piano: 'pianoforte', frigorifero: 'frigo', frigo: 'frigo', bicchiere: 'bicchiere', bottiglia: 'bottiglia',
  tazza: 'tazza', pistola: 'ph_service_pistol', fucile: 'ph_bolt_action_rifle_7_62', coltello: 'ph_ornate_medieval_dagger', pugnale: 'ph_ornate_medieval_dagger', scala: 'ph_ladder_sectioned_01', scalinata: 'scala_interna',
  muro: 'muro', parete: 'muro', finestra: 'finestra', porta: 'porta', ombrello: 'ombrello', borsa: 'borsa', zaino: 'zaino', vaso: 'vaso_fiori', orologio: 'ph_wall_clock', candela: 'ph_wooden_candlestick',
  lanterna: 'ph_Lantern_01', cuscino: 'cuscino', baule: 'ph_treasure_chest', forziere: 'ph_treasure_chest', barile: 'ph_wine_barrel_01', botte: 'ph_wine_barrel_01', cesto: 'ph_wicker_basket_01',
};

// ---------------------------------------------------------------- helpers
const list = (s) => String(s).split(/\s*,\s*/).map((x) => x.replace(/\?/g, '').trim()).filter(Boolean);
const phraseStems = (p) => norm(p).replace(/['’]/g, ' ').split(/[\s/]+/).filter(Boolean).map((w) => (/^\d+\/\d+$/.test(w) ? w : stem(w)));

/**
 * Pure: builds the lexicon from plain catalogs.
 * cat = {presets, garments, hairStyles, beards, hairColors, poses, expressions, animals,
 *        props, categories, rooms, kits, landscapes, lights, angles, outfits}
 */
export function buildLexicon(cat) {
  const lex = new Lexicon(cat);
  const add = (kind, id, phrases, data = {}, prio = 0) => { for (const p of [].concat(phrases)) lex.addPhrase(p, { kind, id, ...data }, prio); };
  // closed classes
  for (const [w, intent] of INTENT_PHRASES) add('intent', intent, w, { intent }, 6);
  for (const [w, r] of RELATION_PHRASES) add('rel', r.rel, w, { rel: r.rel }, 5);
  for (const [w, a] of Object.entries(ARTICLES)) add('det', w, w, { ...a }, 4);
  for (const [w, a] of Object.entries(PREP_ART)) add('prep', w, w, { ...a }, 4);
  for (const p of ['di', 'a', 'ad', 'da', 'su', 'per', 'tra', 'fra']) add('prep', p, p, { p }, 3);
  for (const [w, n] of Object.entries(NUMBER_WORDS)) if (!['un', 'uno', 'una'].includes(w)) add('num', w, w, { n }, 4);
  for (const [w, n] of Object.entries(QUANTIFIERS)) add('num', w, w, { n, vague: true }, 4);
  for (const [w, p] of Object.entries(PRONOUNS)) add('pron', w, w, { ...p }, 3);
  for (const [w, n] of Object.entries(ORDINALS)) add('ord', w, w, { n }, 2);
  for (const [k, words] of Object.entries(MARKERS)) add('mark', k, list(words), { mark: k }, 3);
  // colours (multi-word first by length; single words)
  for (const [w, hex] of Object.entries(COLOR_PHRASES)) add('color', w, w, { hex }, 3);
  for (const [w, hex] of Object.entries(COLORS)) add('color', w, w, { hex }, 2);
  add('shade', 'chiaro', ['chiaro', 'chiara', 'chiari', 'chiare', 'pastello'], { k: 1.45 }, 2);
  add('shade', 'scuro', ['scuro', 'scura', 'scuri', 'scure'], { k: 0.6 }, 2);
  // people
  for (const [sex, words] of Object.entries(PERSON_WORDS)) for (const w of list(words)) add('person', w, w, { sex: sex === 'X' ? null : sex, traits: PERSON_TRAITS[norm(w)] || null, word: w }, 2);
  for (const p of cat.presets || []) add('body', p.id.split('_')[1], norm(p.label), { body: p.id.split('_')[1] }, 1);
  for (const [body, words] of Object.entries(BODY_WORDS)) add('body', body, list(words), { body }, 2);
  for (const [o, words] of Object.entries(OUTFIT_WORDS)) add('outfitSet', o, list(words), { outfit: o }, 2);
  // garments: catalog labels + synonyms
  const garmentIds = new Set((cat.garments || []).map((g) => g.id));
  for (const g of cat.garments || []) add('garment', g.id, norm(g.label).replace(/\s*\/\s*/g, ' / ').split(' / '), { garment: g.id }, 1);
  for (const [id, words] of Object.entries(GARMENT_WORDS)) if (!garmentIds.size || garmentIds.has(id)) add('garment', id, list(words), { garment: id }, 2);
  add('undress', 'nudo', ['nudo', 'nuda', 'nudi', 'in mutande', 'in intimo', 'in biancheria', 'in costume'], { undress: 'all' }, 3);
  add('undress', 'scalzo', ['scalzo', 'scalza', 'scalzi', 'a piedi nudi', 'senza scarpe'], { undress: 'shoes' }, 3);
  add('undress', 'torso', ['a torso nudo', 'senza maglietta', 'a petto nudo'], { undress: 'top' }, 3);
  // hair
  for (const s of cat.hairStyles || []) add('hairStyle', s.id, norm(s.label), { style: s.id }, 1);
  for (const [id, words] of Object.entries(HAIR_STYLE_WORDS)) add('hairStyle', id, list(words), { style: id }, 2);
  const hairHex = new Map((cat.hairColors || []).map((c) => [c.id, c.hex]));
  for (const [id, words] of Object.entries(HAIR_COLOR_WORDS)) add('hairColor', id, list(words), { hex: hairHex.get(id) || null, colorId: id }, 2);
  for (const b of cat.beards || []) add('beard', b.id, norm(b.label), { beard: b.id }, 1);
  for (const [id, words] of Object.entries(BEARD_WORDS)) add('beard', id, list(words), { beard: id }, 2);
  // poses and expressions
  const poseIds = new Set((cat.poses || []).map((p) => p.id));
  for (const p of cat.poses || []) add('pose', p.id, norm(p.label), { pose: p.id }, 1);
  for (const [id, words] of Object.entries(POSE_WORDS)) if (!poseIds.size || poseIds.has(id)) add('pose', id, list(words), { pose: id }, 2);
  for (const [id, words] of Object.entries(APOSE_WORDS)) add('apose', id, list(words), { apose: id }, 1);
  const exprIds = new Set((cat.expressions || []).map((p) => p.id));
  for (const p of cat.expressions || []) add('expr', p.id, norm(p.label), { expr: p.id }, 1);
  for (const [id, words] of Object.entries(EXPR_WORDS)) if (!exprIds.size || exprIds.has(id)) add('expr', id, list(words), { expr: id }, 2);
  // animals
  const species = new Set((cat.animals || []).map((a) => a.id));
  for (const a of cat.animals || []) {
    add('animal', a.id, norm(a.label), { species: a.id }, 2);
    if (a.sub) add('animal', a.id, norm(a.sub), { species: a.id }, 1);
  }
  for (const [id, words] of Object.entries(ANIMAL_WORDS)) if (!species.size || species.has(id)) add('animal', id, list(words), { species: id }, 3);
  // rooms, kits, landscapes
  for (const r of cat.rooms || []) add('room', r.id, norm(r.label), { room: r.id }, 2);
  for (const [id, words] of Object.entries(ROOM_WORDS)) if ((cat.rooms || []).some((r) => r.id === id)) add('room', id, list(words), { room: id }, 2);
  const lsIds = new Set((cat.landscapes || []).map((l) => l.id));
  for (const l of cat.landscapes || []) if (l.group !== 'stanze') add('landscape', l.id, norm(l.label), { landscape: l.id }, 1);
  for (const [id, words] of Object.entries(LANDSCAPE_WORDS)) add('landscape', id, list(words), { landscape: lsIds.has(id) ? id : null, place: id }, 1);
  for (const k of cat.kits || []) add('kit', k.id, norm(k.label), { kit: k.id }, 1);
  for (const [id, words] of Object.entries(TIME_WORDS)) add('time', id, list(words), { time: id }, 2);
  for (const [id, words] of Object.entries(WEATHER_WORDS)) add('weather', id, list(words), { weather: id }, 2);
  for (const [id, words] of Object.entries(SEASON_WORDS)) add('season', id, list(words), { season: id }, 2);
  // lights and camera
  for (const l of cat.lights || []) add('light', l.id, norm(l.label), { light: l.id }, 1);
  for (const [id, words] of Object.entries(LIGHT_WORDS)) add('light', id, list(words), { light: id }, 2);
  for (const [id, words] of Object.entries(ANGLE_WORDS)) add('angle', id, list(words), { angle: id }, 2);
  for (const [id, words] of Object.entries(FRAMING_WORDS)) add('framing', id, list(words), { framing: id }, 1);
  for (const [mm, words] of Object.entries(FOCAL_WORDS)) add('focal', mm, list(words), { focal: +mm }, 2);
  add('mm', 'mm', ['mm', 'millimetri', 'millimetro', 'milli'], {}, 2);
  // props / buildings / exteriors: indexed for noun phrases (see rankProps)
  lex.indexProps(cat.props || [], cat.categories || []);
  return lex;
}

const EXACT_KINDS = new Set(['det', 'prep', 'num', 'pron', 'ord', 'mark', 'intent']);
const KIND_PRIO = { intent: 7, rel: 6, mark: 5, det: 5, prep: 5, num: 5, pron: 4, ord: 4, color: 4, shade: 4, undress: 5, person: 4, animal: 4, garment: 3, hairStyle: 3, hairColor: 3, beard: 3, pose: 3, apose: 2, expr: 3, body: 3, outfitSet: 3, room: 2, landscape: 2, kit: 1, time: 3, weather: 3, season: 3, light: 2, angle: 3, framing: 2, focal: 3, mm: 3 };

export class Lexicon {
  constructor(cat) {
    this.cat = cat;
    this.trie = new Map(); // first stem -> [{stems, entry, prio}]
    this.singleKeys = new Map(); // stem -> original word (for fuzzy matching of content words)
    this.props = [];
    this.propIndex = new Map();
    this.propById = new Map();
  }

  addPhrase(phrase, entry, prio = 0) {
    const stems = phraseStems(phrase);
    if (!stems.length) return;
    const k = stems[0];
    if (!this.trie.has(k)) this.trie.set(k, []);
    this.trie.get(k).push({ stems, entry, prio: prio + (KIND_PRIO[entry.kind] || 0) * 0.01, phrase });
    if (stems.length === 1 && !FUNCTION_WORDS.has(norm(phrase)) && norm(phrase).length >= (entry.kind === 'intent' ? 6 : 4) && !['det', 'prep', 'rel', 'mark', 'num', 'pron', 'ord'].includes(entry.kind)) {
      this.singleKeys.set(stems[0], norm(phrase));
    }
  }

  /** Prop types indexed by label words (first word weighs most), tags and category labels. */
  indexProps(props, categories) {
    const catLabel = new Map(categories.map((c) => [c.id, norm(c.label)]));
    this.props = props;
    for (const t of props) {
      this.propById.set(t.id, t);
      const lw = norm(t.label).replace(/['’]/g, ' ').split(/[^a-z0-9]+/).filter((w) => w && !FUNCTION_WORDS.has(w) && !/^\d+$/.test(w));
      const tags = norm(Array.isArray(t.tags) ? t.tags.join(' ') : t.tags || '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !FUNCTION_WORDS.has(w));
      const put = (w, weight, field) => {
        const s = stem(w);
        if (!this.propIndex.has(s)) this.propIndex.set(s, []);
        const arr = this.propIndex.get(s);
        const ex = arr.find((x) => x.id === t.id);
        if (ex) { if (weight > ex.w) { ex.w = weight; ex.field = field; } } else arr.push({ id: t.id, w: weight, field });
        if (w.length >= 4) this.singleKeys.set(s, w);
      };
      lw.forEach((w, i) => put(w, i === 0 ? 3 : 1.5, i === 0 ? 'head' : 'label'));
      for (const [w, id] of Object.entries(HEAD_DEFAULTS)) if (id === t.id) put(w, 3.2, 'default');
      for (const w of tags) put(w, 1, 'tag');
      const cl = catLabel.get(t.cat);
      if (cl) for (const w of cl.split(/[^a-z0-9]+/)) if (w.length > 3) put(w, 0.4, 'cat');
    }
  }

  /** Looks up a stem exactly, else with a typo budget among content words. Returns [{stem, cost}]. */
  _keysFor(tok) {
    const out = [{ s: tok.s, cost: 0 }];
    if (FUNCTION_WORDS.has(tok.w) || tok.w.length < 4 || /\d/.test(tok.w)) return out;
    if (this.trie.has(tok.s) || this.propIndex.has(tok.s)) return out;
    // stems differing by one trailing letter ("grig" / "grigi")
    for (const k of [tok.s.slice(0, -1)]) if (k.length >= 4 && (this.trie.has(k) || this.propIndex.has(k))) out.push({ s: k, cost: 0.1 });
    if (out.length > 1) return out;
    let best = null;
    for (const [s, word] of this.singleKeys) {
      if (Math.abs(word.length - tok.w.length) > 2 || word[0] !== tok.w[0] && word[1] !== tok.w[1]) continue;
      const budget = typoBudget(Math.max(word.length, tok.w.length));
      if (!budget) continue;
      const d = Math.min(editDistance(tok.w, word, budget), editDistance(tok.s, s, budget));
      if (d <= budget && (!best || d < best.cost)) best = { s, cost: d };
    }
    if (best) out.push(best);
    return out;
  }

  /**
   * Tags tokens: returns items [{kind, data, i0, i1, cost}] (kind 'word' for unmatched,
   * 'sep' for clause punctuation). Longest phrase wins, ties by priority.
   */
  tag(tokens) {
    const items = [];
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.w === ',') { items.push({ kind: 'sep', i0: i, i1: i + 1 }); i++; continue; }
      if (/^\d+(\.\d+)?$/.test(t.w)) { items.push({ kind: 'num', data: { n: +t.w, digits: true }, i0: i, i1: i + 1 }); i++; continue; }
      const found = [];
      for (const key of this._keysFor(t)) {
        const cands = this.trie.get(key.s);
        if (!cands) continue;
        for (const c of cands) {
          const n = c.stems.length;
          if (i + n > tokens.length) continue;
          let ok = true, cost = key.cost;
          for (let k = 1; k < n && ok; k++) {
            const tk = tokens[i + k];
            if (tk.s === c.stems[k] || stemEq(tk.s, c.stems[k])) continue;
            if (tk.w.length >= 5 && c.stems[k].length >= 4 && editDistance(tk.s, c.stems[k], 1) <= 1) { cost += 1; continue; }
            ok = false;
          }
          if (!ok) continue;
          // short words and closed classes only match exactly ("della" is not "delle")
          if (n === 1 && (t.w.length <= 3 || EXACT_KINDS.has(c.entry.kind)) && norm(c.phrase) !== t.w && key.cost === 0) continue;
          found.push({ score: n * 10 - cost * 3 + c.prio, n, entry: c.entry, cost, phrase: c.phrase });
        }
      }
      const propHit = this._propHead(t);
      if (found.length) {
        found.sort((a, b) => b.score - a.score);
        const best = found[0];
        // alternatives of the same span (e.g. "seduto": human pose / animal pose)
        const alts = [];
        for (const f of found) if (f.n === best.n && !alts.some((a) => a.kind === f.entry.kind && a.id === f.entry.id)) alts.push(f.entry);
        items.push({ kind: best.entry.kind, data: best.entry, alts, i0: i, i1: i + best.n, cost: best.cost, phrase: best.phrase, propHit: best.n === 1 ? propHit : null });
        i += best.n;
      } else if (propHit) {
        items.push({ kind: 'propWord', data: { stem: propHit.s }, i0: i, i1: i + 1, cost: propHit.cost });
        i++;
      } else {
        items.push({ kind: 'word', data: { w: t.w }, i0: i, i1: i + 1 });
        i++;
      }
    }
    return items;
  }

  /** A token naming a prop type (head word / label word / tag), with its typo cost. */
  _propHead(t) {
    if (FUNCTION_WORDS.has(t.w)) return null;
    if (this.propIndex.has(t.s)) return { s: t.s, cost: 0 };
    if (t.w.length < 4) return null;
    const k = t.s.slice(0, -1);
    if (k.length >= 4 && this.propIndex.has(k)) return { s: k, cost: 0.1 };
    let best = null;
    // 4-letter words: one missing letter only ("leto" -> "letto")
    const short = t.w.length === 4;
    const budget = short ? 1 : typoBudget(t.w.length);
    if (!budget) return null;
    for (const s of this.propIndex.keys()) {
      if (Math.abs(s.length - t.s.length) > budget || s[0] !== t.s[0]) continue;
      if (short && s.length !== t.s.length + 1) continue;
      const d = editDistance(t.s, s, budget);
      if (d <= budget && (!best || d < best.cost)) best = { s, cost: d };
    }
    return best;
  }

  /**
   * Ranks prop types for a noun phrase: head stem + extra words (adjectives,
   * complements). opts: {cats: preferred categories, hand: prefer hand props}.
   * Returns [{id, score}] best first.
   */
  rankProps(headStem, extraStems = [], opts = {}) {
    const base = this.propIndex.get(headStem) || [];
    const scores = new Map();
    for (const { id, w, field } of base) scores.set(id, w + (field === 'head' ? 0.5 : field === 'default' ? 0.9 : 0));
    let narrowed = false;
    for (const s of extraStems) {
      const arr = this.propIndex.get(s);
      if (!arr) continue;
      for (const { id, w } of arr) if (scores.has(id)) { scores.set(id, scores.get(id) + Math.min(1.6, w * 0.6 + 0.4)); narrowed = true; }
    }
    // "una macchina fotografica": the extra words win over the generic default
    if (narrowed) for (const { id, field } of base) if (field === 'default') scores.set(id, scores.get(id) - 2.0);
    const out = [];
    for (const [id, sc] of scores) {
      const t = this.propById.get(id);
      let s = sc;
      const words = norm(t.label).split(/\s+/).length;
      s -= words * 0.12; // generic, short labels first ("Sedia" before "Sedia da pranzo moderna")
      if (!t.variantOf) s += 0.15;
      if (t.realistic) s -= 0.05;
      if (opts.cats?.includes(t.cat)) s += 0.6;
      if (opts.hand && t.hand) s += 0.8;
      if (t.cat === 'mano' && !opts.hand) s -= 0.3;
      out.push({ id, score: s });
    }
    out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return out;
  }

  /** Free text -> best prop type id (used for `query` in plans, e.g. from the cloud). */
  propForQuery(text, opts = {}) {
    const toks = norm(text).split(/[^a-z0-9]+/).filter((w) => w && !FUNCTION_WORDS.has(w));
    if (!toks.length) return null;
    if (this.propById.has(norm(text).trim())) return norm(text).trim();
    let best = null;
    for (let k = 0; k < toks.length; k++) {
      const h = this._propHead({ w: toks[k], s: stem(toks[k]) });
      if (!h) continue;
      const r = this.rankProps(h.s, toks.filter((_, j) => j !== k).map(stem), opts)[0];
      if (r && (!best || r.score - h.cost > best.score)) best = { id: r.id, score: r.score - h.cost - k * 0.2 };
    }
    return best?.id || null;
  }
}

// ---------------------------------------------------------------- browser: catalogs from the app
/**
 * Collects the plain catalogs from the running app (modules are feature-detected;
 * their static data modules are imported, which shares the already loaded instances).
 */
export async function collectCatalogs(app) {
  const safe = async (fn, def) => { try { return (await fn()) ?? def; } catch (e) { console.warn('[voice] catalog', e); return def; } };
  const cat = {};
  cat.presets = (app.model?.presets || []).map((p) => ({ id: p.id, label: p.label, sex: p.sex }));
  cat.garments = await safe(async () => {
    const G = app.clothing?.catalog?.GARMENTS || (await import('../clothing/catalog.js')).GARMENTS;
    return G.map((g) => ({ id: g.id, label: g.label, slot: g.slot, sex: g.sex || null, palette: g.palette || [] }));
  }, []);
  cat.hairStyles = (app.hair?.styles || []).map((s) => ({ id: s.id, label: s.label }));
  cat.beards = (app.hair?.beards || []).map((s) => ({ id: s.id, label: s.label }));
  cat.hairColors = await safe(async () => { const m = await import('../hair/state.js'); return [...m.NATURAL_COLORS, ...m.COMIC_COLORS].map((c) => ({ id: c.id, label: c.label, hex: c.hex })); }, []);
  cat.poses = await safe(async () => (await import('../pose/library.js')).POSE_PRESETS.map((p) => ({ id: p.id, label: p.label, category: p.category, seat: p.seat || 0 })), []);
  cat.expressions = await safe(async () => (await import('../face/expressions.js')).PRESETS.map((p) => ({ id: p.id, label: p.label })), []);
  cat.animals = await safe(async () => {
    if (!app.animals) return [];
    const man = app.animals.manifest || await app.animals.ready;
    if (!man) return [];
    const { posesFor } = await import('../animals/poses.js');
    return man.species.map((e) => ({ id: e.id, label: e.label, sub: e.sub || '', group: e.group, family: e.family, height: e.height, poses: posesFor(e).map((p) => ({ id: p.id, label: p.label })) }));
  }, []);
  cat.props = await safe(async () => {
    const C = await import('../props/catalog.js');
    return C.PROP_TYPES.map((t) => ({ id: t.id, label: t.label, cat: t.cat, sub: t.sub || null, tags: t.tags || '', variantOf: t.variantOf || null, realistic: !!t.realistic, hand: !!t.hand, mount: t.mount || null }));
  }, []);
  cat.categories = await safe(async () => (await import('../props/catalog.js')).CATEGORIES.map((c) => ({ id: c.id, label: c.label })), []);
  cat.rooms = await safe(async () => (await import('../props/gen/rooms.js')).ROOM_PRESETS.map((r) => ({ id: r.id, label: r.label, tags: r.tags || '', size: r.size })), []);
  cat.kits = (app.city?.kits || []).map((k) => ({ id: k.id, label: k.label, tags: k.tags || '' }));
  cat.landscapes = (app.landscapes?.presets || []).map((p) => ({ id: p.id, label: p.label, group: p.group, tags: p.tags || [] }));
  cat.lights = await safe(async () => (await import('../scene/lightPresets.js')).LIGHT_PRESETS.map((p) => ({ id: p.id, label: p.label })), []);
  cat.angles = [
    { id: 'eye', label: 'Altezza occhi' }, { id: 'low', label: 'Dal basso' }, { id: 'high', label: 'Dall\'alto' }, { id: 'top', label: 'Zenitale' },
    { id: 'front', label: 'Frontale' }, { id: 'threeq', label: '3/4' }, { id: 'side', label: 'Profilo' }, { id: 'back', label: 'Retro' },
  ];
  cat.times = ['alba', 'mattino', 'mezzogiorno', 'tramonto', 'sera', 'notte'];
  cat.weathers = ['sereno', 'nuvoloso', 'pioggia', 'neve', 'nebbia'];
  cat.seasons = ['primavera', 'estate', 'autunno', 'inverno'];
  return cat;
}
