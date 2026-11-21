#!/usr/bin/env node
// Build-time importer of realistic CC0 props from Poly Haven (https://polyhaven.com).
//
//   node posaviva/tools/build-props.mjs [--only id1,id2] [--force] [--refetch] [--jobs 4] [--cache <dir>]
//   --force rebuilds the outputs, --refetch downloads the sources again.
//
// One-time download (cached) of a curated list of Poly Haven models, converted to
// compact assets for the APK (nothing is fetched at runtime):
//   web/public/assets/props/models/<id>.glb   merged meshes, meshopt + quantized geometry,
//                                             WebP textures (base color with the ambient
//                                             occlusion baked in + normal map; roughness and
//                                             metalness reduced to per-material factors),
//                                             origin on the floor at the footprint center
//   web/public/assets/props/thumbs/<id>.webp  128 px catalog thumbnail (Poly Haven render)
//   web/public/assets/props/CREDITS.txt       authors + CC0 license of every model
//   web/src/props/phModels.js                 generated catalog entries (labels, categories,
//                                             tags, sizes) bundled with the app
//
// Requirements: Node 18+ (fetch), Python 3 with Pillow (texture processing) and npx
// (runs @gltf-transform/cli for centering, welding, joining, simplification, meshopt
// compression and WebP encoding).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../web');
const OUT = path.join(WEB, 'public/assets/props');
const GEN = path.join(WEB, 'src/props/phModels.js');
const CLI = ['-y', '-p', '@gltf-transform/cli@4.2.1', 'gltf-transform'];

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const FORCE = args.includes('--force'); // rebuild outputs
const REFETCH = args.includes('--refetch'); // download again (ignores the cache)
const ONLY = opt('--only', '') ? new Set(opt('--only', '').split(',')) : null;
const JOBS = +opt('--jobs', 4);
const CACHE = path.resolve(opt('--cache', path.join(os.tmpdir(), 'posaviva-props-cache')));

// ------------------------------------------------------------------------------------------
// Curated list: [polyhavenId, Italian label, category, sub-category, extra Italian tags, options]
// options: ceil (hangs from the ceiling), wall (mounted on a wall), lie (long tool: added lying down), tex (base color size),
//          ratio (simplify: fraction of vertices to keep), yaw (degrees, front -> +Z)
// ------------------------------------------------------------------------------------------
const L = [
  // ---- Sedute
  ['ArmChair_01', 'Poltrona vittoriana', 'sedute', 'poltrone', 'antica classica imbottita'],
  ['BarberShopChair_01', 'Poltrona da barbiere', 'sedute', 'poltrone', 'barbiere vintage pelle'],
  ['mid_century_lounge_chair', 'Poltrona lounge anni ’50', 'sedute', 'poltrone', 'design pelle relax'],
  ['modern_arm_chair_01', 'Poltrona moderna in pelle', 'sedute', 'poltrone', 'moderna pelle salotto'],
  ['Ottoman_01', 'Pouf', 'sedute', 'poltrone', 'poggiapiedi pouf'],
  ['chinese_armchair', 'Poltrona cinese', 'sedute', 'poltrone', 'orientale antica legno'],
  ['GreenChair_01', 'Sedia imbottita verde', 'sedute', 'sedie', 'antica classica'],
  ['Rockingchair_01', 'Sedia a dondolo', 'sedute', 'sedie', 'dondolo legno nonna'],
  ['SchoolChair_01', 'Sedia scolastica', 'sedute', 'sedie', 'scuola aula'],
  ['dining_chair_02', 'Sedia da pranzo moderna', 'sedute', 'sedie', 'moderna cucina pranzo'],
  ['gallinera_chair', 'Sedia in legno intrecciato', 'sedute', 'sedie', 'antica legno'],
  ['painted_wooden_chair_01', 'Sedia rustica', 'sedute', 'sedie', 'legno campagna cucina'],
  ['painted_wooden_chair_02', 'Sedia rustica con braccioli', 'sedute', 'sedie', 'legno campagna'],
  ['plastic_monobloc_chair_01', 'Sedia di plastica', 'sedute', 'sedie', 'giardino bar esterno'],
  ['Sofa_01', 'Divano vittoriano', 'sedute', 'divani', 'antico classico'],
  ['sofa_02', 'Divano rétro', 'sedute', 'divani', 'vintage salotto'],
  ['sofa_03', 'Divano capitonné', 'sedute', 'divani', 'chesterfield elegante'],
  ['chinese_sofa', 'Divano cinese', 'sedute', 'divani', 'orientale legno'],
  ['painted_wooden_sofa', 'Divanetto in legno', 'sedute', 'divani', 'panchina veranda'],
  ['vintage_day_bed', 'Dormeuse', 'sedute', 'divani', 'letto divano antico'],
  ['bar_chair_round_01', 'Sgabello da bar', 'sedute', 'sgabelli', 'bar pub alto'],
  ['metal_stool_01', 'Sgabello in metallo e pelle', 'sedute', 'sgabelli', 'vintage bar'],
  ['metal_stool_03', 'Sgabello alto con schienale', 'sedute', 'sgabelli', 'bar officina'],
  ['metal_stool_02', 'Sgabello da officina', 'sedute', 'sgabelli', 'laboratorio industriale'],
  ['folding_wooden_stool', 'Sgabello pieghevole', 'sedute', 'sgabelli', 'campeggio legno'],
  ['wooden_stool_01', 'Sgabello in legno', 'sedute', 'sgabelli', 'rustico'],
  ['painted_wooden_stool', 'Sgabello dipinto', 'sedute', 'sgabelli', 'rustico'],
  ['chinese_stool', 'Sgabello cinese', 'sedute', 'sgabelli', 'orientale'],
  ['wooden_stool_02', 'Poggiapiedi in legno', 'sedute', 'sgabelli', 'sgabellino piccolo'],
  ['painted_wooden_bench', 'Panca dipinta', 'sedute', 'panche', 'panchina legno'],

  // ---- Tavoli
  ['dining_table', 'Tavolo con tovaglia a quadri', 'tavoli', 'pranzo', 'trattoria tovaglia cucina'],
  ['painted_wooden_table', 'Tavolo rustico lungo', 'tavoli', 'pranzo', 'campagna legno'],
  ['round_wooden_table_01', 'Tavolo rotondo in legno', 'tavoli', 'pranzo', 'tondo'],
  ['round_wooden_table_02', 'Tavolino rotondo antico', 'tavoli', 'pranzo', 'tondo bistrot'],
  ['wooden_table_02', 'Tavolo semplice in legno', 'tavoli', 'pranzo', 'rustico'],
  ['outdoor_table_chair_set_01', 'Tavolino e sedie pieghevoli', 'tavoli', 'pranzo', 'giardino terrazza bar'],
  ['CoffeeTable_01', 'Tavolino dipinto', 'tavoli', 'salotto', 'tavolino caffè'],
  ['WoodenTable_01', 'Tavolo basso in legno', 'tavoli', 'salotto', 'tavolino'],
  ['coffee_table_round_01', 'Tavolino tondo in marmo', 'tavoli', 'salotto', 'moderno marmo'],
  ['modern_coffee_table_01', 'Tavolino moderno in pietra', 'tavoli', 'salotto', 'moderno'],
  ['modern_coffee_table_02', 'Tavolino quadrato moderno', 'tavoli', 'salotto', 'moderno'],
  ['industrial_coffee_table', 'Tavolino industriale', 'tavoli', 'salotto', 'metallo loft'],
  ['gothic_coffee_table', 'Tavolino gotico', 'tavoli', 'salotto', 'antico intagliato'],
  ['chinese_tea_table', 'Tavolino da tè cinese', 'tavoli', 'salotto', 'orientale'],
  ['SchoolDesk_01', 'Banco di scuola', 'tavoli', 'scrivanie', 'aula scuola studente'],
  ['metal_office_desk', 'Scrivania in metallo', 'tavoli', 'scrivanie', 'ufficio vintage'],
  ['ClassicNightstand_01', 'Comodino classico', 'tavoli', 'comodini', 'camera letto'],
  ['painted_wooden_nightstand', 'Comodino dipinto', 'tavoli', 'comodini', 'camera rustico'],
  ['side_table_01', 'Tavolino laterale moderno', 'tavoli', 'comodini', 'moderno'],
  ['side_table_tall_01', 'Tavolino alto', 'tavoli', 'comodini', 'antico'],
  ['WoodenTable_02', 'Tavolino tondo piccolo', 'tavoli', 'comodini', 'tondo'],
  ['small_wooden_table_01', 'Tavolino in legno', 'tavoli', 'comodini', 'piccolo'],
  ['ClassicConsole_01', 'Consolle classica', 'tavoli', 'consolle', 'ingresso antica'],
  ['chinese_console_table', 'Consolle cinese', 'tavoli', 'consolle', 'orientale'],

  // ---- Letti
  ['GothicBed_01', 'Letto gotico a baldacchino', 'letti', 'letti', 'antico castello matrimoniale'],
  ['old_bed_frame', 'Letto in ferro', 'letti', 'letti', 'vintage ospedale caserma singolo'],

  // ---- Armadi e mensole
  ['painted_wooden_cabinet_02', 'Armadio rustico', 'armadi', 'armadi', 'guardaroba legno'],
  ['chinese_cabinet', 'Armadio cinese', 'armadi', 'armadi', 'orientale'],
  ['vintage_cabinet_01', 'Vetrina vintage', 'armadi', 'credenze', 'credenza antica cucina', { ratio: 0.5 }],
  ['GothicCabinet_01', 'Credenza gotica', 'armadi', 'credenze', 'antica'],
  ['painted_wooden_cabinet', 'Credenza dipinta', 'armadi', 'credenze', 'rustica'],
  ['modern_wooden_cabinet', 'Madia moderna', 'armadi', 'credenze', 'mobile tv basso'],
  ['WoodenTable_03', 'Credenza bassa', 'armadi', 'credenze', 'buffet'],
  ['GothicCommode_01', 'Comò gotico', 'armadi', 'cassettiere', 'cassetti'],
  ['drawer_cabinet', 'Cassettiera alta', 'armadi', 'cassettiere', 'cassetti ufficio'],
  ['vintage_wooden_drawer_01', 'Schedario in legno', 'armadi', 'cassettiere', 'archivio ufficio biblioteca'],
  ['wooden_bookshelf_worn', 'Libreria consumata', 'armadi', 'librerie', 'scaffale vecchio'],
  ['steel_frame_shelves_03', 'Libreria moderna', 'armadi', 'librerie', 'scaffale design'],
  ['wooden_display_shelves_01', 'Espositore a cubi', 'armadi', 'librerie', 'scaffale negozio'],
  ['Shelf_01', 'Scaffale in legno', 'armadi', 'librerie', 'mensole'],
  ['painted_wooden_shelves', 'Mensole dipinte', 'armadi', 'librerie', 'scaffale rustico'],
  ['steel_frame_shelves_01', 'Scaffale in acciaio', 'armadi', 'librerie', 'magazzino negozio'],
  ['steel_frame_shelves_02', 'Scaffale stretto in acciaio', 'armadi', 'librerie', 'magazzino'],
  ['worn_metal_rack', 'Scaffale metallico arrugginito', 'armadi', 'librerie', 'garage cantina'],

  // ---- Cucina
  ['electric_stove', 'Cucina elettrica', 'cucina', 'elettrodomestici', 'fornelli forno'],
  ['vintage_microwave', 'Microonde vintage', 'cucina', 'elettrodomestici', 'forno'],
  ['vintage_electric_kettle', 'Bollitore', 'cucina', 'elettrodomestici', 'teiera acqua'],
  ['CoffeeCart_01', 'Carrello del caffè', 'cucina', 'mobili', 'bar ambulante chiosco'],
  ['barrel_stove', 'Stufa a barile', 'cucina', 'mobili', 'stufa fuoco riscaldamento'],
  ['brass_pan_01', 'Padella in rame', 'cucina', 'pentole', 'padella'],
  ['brass_pot_01', 'Pentola in ottone', 'cucina', 'pentole', 'pentola'],
  ['brass_pot_02', 'Tegame in ottone', 'cucina', 'pentole', 'tegame'],
  ['ceramic_pot', 'Pentola in coccio', 'cucina', 'pentole', 'terracotta'],
  ['pot_enamel_01', 'Pentolino smaltato', 'cucina', 'pentole', 'pentola'],
  ['wooden_cutting_board', 'Tagliere', 'cucina', 'utensili', 'legno'],
  ['wooden_spoon', 'Cucchiaio di legno', 'cucina', 'utensili', 'mestolo'],

  // ---- Bagno (pochi modelli: il resto è procedurale)
  ['rubber_duck_toy', 'Paperella di gomma', 'bagno', 'accessori', 'gioco vasca'],
  ['plunger', 'Sturalavandini', 'bagno', 'accessori', 'pulizia'],
  ['bleach_bottle', 'Flacone di candeggina', 'bagno', 'accessori', 'detersivo pulizia'],
  ['multi_cleaner_bottle', 'Spray detergente', 'bagno', 'accessori', 'pulizia'],

  // ---- Ufficio
  ['book_encyclopedia_set_01', 'Enciclopedia', 'ufficio', 'libri', 'libri biblioteca', { ratio: 0.35 }],
  ['binder_notebook', 'Agenda in pelle', 'ufficio', 'cancelleria', 'quaderno diario'],
  ['office_notepads', 'Blocchi per appunti', 'ufficio', 'cancelleria', 'fogli carta'],
  ['clipboard', 'Portablocco', 'ufficio', 'cancelleria', 'cartellina'],
  ['vintage_stapler', 'Pinzatrice', 'ufficio', 'cancelleria', 'spillatrice'],
  ['stationery_supplies', 'Penne e matite', 'ufficio', 'cancelleria', 'cancelleria scuola'],
  ['postcard_set_01', 'Cartoline', 'ufficio', 'cancelleria', 'lettere carta'],
  ['standing_chalkboard_01', 'Lavagna da cavalletto', 'ufficio', 'mobili', 'lavagna menu ristorante'],

  // ---- Elettronica
  ['Television_01', 'Televisore vintage in legno', 'elettronica', 'tv-audio', 'tv anni 60'],
  ['television_02', 'Televisore a tubo', 'elettronica', 'tv-audio', 'tv crt vecchio'],
  ['boombox', 'Stereo portatile', 'elettronica', 'tv-audio', 'radio musica anni 80'],
  ['portable_cassette_player', 'Registratore a cassette', 'elettronica', 'tv-audio', 'musica'],
  ['cassette_player', 'Walkman', 'elettronica', 'tv-audio', 'musica cuffie'],
  ['vintage_radio_transceiver', 'Radio militare', 'elettronica', 'tv-audio', 'ricetrasmittente guerra'],
  ['classic_laptop', 'Portatile anni ’90', 'elettronica', 'computer', 'laptop computer'],
  ['gaming_console', 'Console per videogiochi', 'elettronica', 'computer', 'videogiochi'],
  ['gamepad', 'Joypad', 'elettronica', 'computer', 'controller videogiochi'],
  ['circuit_board', 'Scheda elettronica', 'elettronica', 'computer', 'circuito hacker'],
  ['Camera_01', 'Macchina fotografica antica', 'elettronica', 'foto-video', 'foto'],
  ['vintage_video_camera', 'Cinepresa', 'elettronica', 'foto-video', 'film video'],
  ['filmstrip_projector_8mm', 'Proiettore 8 mm', 'elettronica', 'foto-video', 'cinema film'],
  ['projector_screen', 'Schermo per proiezioni', 'elettronica', 'foto-video', 'telo cinema presentazione'],
  ['CashRegister_01', 'Registratore di cassa', 'elettronica', 'negozio', 'cassa negozio bar'],
  ['Megaphone_01', 'Megafono', 'elettronica', 'negozio', 'altoparlante polizia'],
  ['alarm_clock_01', 'Sveglia', 'elettronica', 'negozio', 'orologio comodino'],
  ['ceiling_fan', 'Ventilatore da soffitto', 'elettronica', 'negozio', 'pale aria', { ceil: true }],

  // ---- Luci
  ['Chandelier_01', 'Lampadario classico', 'luci', 'soffitto', 'candelabro cristallo', { ceil: true }],
  ['Chandelier_02', 'Lampadario elegante', 'luci', 'soffitto', 'candelabro', { ceil: true }],
  ['Chandelier_03', 'Lampadario a candele', 'luci', 'soffitto', 'candelabro castello', { ceil: true }],
  ['lantern_chandelier_01', 'Lampadario a lanterna', 'luci', 'soffitto', 'vittoriano', { ceil: true }],
  ['chinese_chandelier', 'Lanterna cinese da soffitto', 'luci', 'soffitto', 'orientale', { ceil: true }],
  ['modern_ceiling_lamp_01', 'Lampada a sospensione moderna', 'luci', 'soffitto', 'vetro', { ceil: true }],
  ['hanging_industrial_lamp', 'Lampada industriale a sospensione', 'luci', 'soffitto', 'fabbrica bunker', { ceil: true }],
  ['caged_hanging_light', 'Plafoniera a gabbia', 'luci', 'soffitto', 'neon magazzino', { ceil: true }],
  ['mounted_fluorescent_lights', 'Neon da soffitto', 'luci', 'soffitto', 'garage officina', { ceil: true }],
  ['desk_lamp_arm_01', 'Lampada da tavolo snodata', 'luci', 'terra-tavolo', 'scrivania'],
  ['industrial_pipe_lamp', 'Lampada a tubi', 'luci', 'terra-tavolo', 'scrivania industriale'],
  ['vintage_oil_lamp', 'Lume a petrolio', 'luci', 'terra-tavolo', 'antico'],
  ['brass_candleholders', 'Candelabri in ottone', 'luci', 'terra-tavolo', 'candele', { ratio: 0.4 }],
  ['wooden_candlestick', 'Candeliere in legno', 'luci', 'terra-tavolo', 'candela'],
  ['industrial_wall_lamp', 'Applique industriale', 'luci', 'parete', 'lampada muro', { wall: true }],
  ['industrial_wall_sconce', 'Applique antica', 'luci', 'parete', 'lampada muro', { wall: true }],
  ['Lantern_01', 'Lanterna', 'luci', 'portatili', 'antica vetro'],
  ['wooden_lantern_01', 'Lanterna in legno', 'luci', 'portatili', 'rustica'],
  ['brass_diya_lantern', 'Lanterna orientale', 'luci', 'portatili', 'ottone'],
  ['vintage_flashlight', 'Torcia vintage', 'luci', 'portatili', 'pila'],
  ['lightbulb_01', 'Lampadina', 'luci', 'portatili', 'idea'],

  // ---- Decorazioni
  ['hanging_picture_frame_01', 'Quadro moderno', 'decorazioni', 'quadri', 'cornice poster', { wall: true }],
  ['hanging_picture_frame_02', 'Quadro con cornice in legno', 'decorazioni', 'quadri', 'dipinto', { wall: true }],
  ['hanging_picture_frame_03', 'Foto d’epoca', 'decorazioni', 'quadri', 'cornice', { wall: true }],
  ['fancy_picture_frame_01', 'Dipinto antico', 'decorazioni', 'quadri', 'museo', { wall: true }],
  ['fancy_picture_frame_02', 'Cornice dorata', 'decorazioni', 'quadri', 'museo barocco', { wall: true, ratio: 0.4 }],
  ['standing_picture_frame_01', 'Portafoto moderno', 'decorazioni', 'quadri', 'foto'],
  ['standing_picture_frame_02', 'Portafoto in legno', 'decorazioni', 'quadri', 'foto'],
  ['ornate_mirror_01', 'Specchio decorato', 'decorazioni', 'quadri', 'specchio', { wall: true }],
  ['ceramic_vase_01', 'Vaso alto in ceramica', 'decorazioni', 'vasi', 'moderno'],
  ['ceramic_vase_02', 'Vaso in ceramica', 'decorazioni', 'vasi', 'moderno'],
  ['ceramic_vase_03', 'Vaso dipinto', 'decorazioni', 'vasi', 'stretto'],
  ['ceramic_vase_04', 'Vaso decorato', 'decorazioni', 'vasi', 'moderno'],
  ['antique_ceramic_vase_01', 'Vaso antico', 'decorazioni', 'vasi', 'porcellana'],
  ['brass_vase_01', 'Vaso in ottone', 'decorazioni', 'vasi', 'antico', { ratio: 0.4 }],
  ['brass_vase_02', 'Anfora in ottone', 'decorazioni', 'vasi', 'antico'],
  ['marble_bust_01', 'Busto in marmo', 'decorazioni', 'statue', 'scultura museo testa'],
  ['horse_statue_01', 'Statuina cavallo', 'decorazioni', 'statue', 'porcellana'],
  ['carved_wooden_elephant', 'Elefante intagliato', 'decorazioni', 'statue', 'legno'],
  ['bronze_shark_statue', 'Statua squalo in bronzo', 'decorazioni', 'statue', 'scultura'],
  ['lion_head', 'Testa di leone intagliata', 'decorazioni', 'statue', 'scultura', { ratio: 0.4 }],
  ['concrete_cat_statue', 'Statua gatto', 'decorazioni', 'statue', 'giardino'],
  ['garden_gnome', 'Nano da giardino', 'decorazioni', 'statue', 'giardino', { ratio: 0.5 }],
  ['wall_clock', 'Orologio da parete', 'decorazioni', 'orologi', 'ore', { wall: true }],
  ['vintage_telephone_wall_clock', 'Orologio a telefono', 'decorazioni', 'orologi', 'antico', { wall: true }],
  ['mantel_clock_01', 'Orologio da camino', 'decorazioni', 'orologi', 'antico'],
  ['vintage_grandfather_clock_01', 'Pendola', 'decorazioni', 'orologi', 'orologio a pendolo antico'],
  ['throw_pillows_01', 'Cuscini decorativi', 'decorazioni', 'tessili', 'cuscino divano'],
  ['chinese_screen_panels', 'Paravento', 'decorazioni', 'varie', 'separé orientale'],
  ['katana_stand_01', 'Supporto per katana', 'decorazioni', 'varie', 'giappone'],
  ['seadogs_compass', 'Bussola nautica', 'decorazioni', 'varie', 'nave ottone'],
  ['lambis_shell', 'Conchiglia', 'decorazioni', 'varie', 'mare'],

  // ---- Piante
  ['potted_plant_01', 'Pianta in vaso di terracotta', 'piante', 'piante', 'verde', { ratio: 0.18 }],
  ['potted_plant_02', 'Pianta in vaso', 'piante', 'piante', 'verde', { ratio: 0.25 }],
  ['potted_plant_04', 'Aloe in vasetto', 'piante', 'piante', 'grassa cactus'],
  ['planter_pot_clay', 'Vaso di terracotta', 'piante', 'vasi', 'coccio'],

  // ---- Cibo e stoviglie
  ['food_apple_01', 'Mela', 'cibo', 'frutta-verdura', 'frutta', { tex: 256 }],
  ['bananas', 'Banane', 'cibo', 'frutta-verdura', 'frutta', { tex: 256, ratio: 0.25 }],
  ['lemon', 'Limone', 'cibo', 'frutta-verdura', 'frutta agrumi', { tex: 256 }],
  ['food_lime_01', 'Lime', 'cibo', 'frutta-verdura', 'frutta agrumi', { tex: 256 }],
  ['food_avocado_01', 'Avocado', 'cibo', 'frutta-verdura', 'frutta', { tex: 256 }],
  ['food_kiwi_01', 'Kiwi', 'cibo', 'frutta-verdura', 'frutta', { tex: 256 }],
  ['food_pomegranate_01', 'Melograno', 'cibo', 'frutta-verdura', 'frutta', { tex: 256 }],
  ['food_pears_asian_01', 'Pere', 'cibo', 'frutta-verdura', 'frutta', { tex: 256 }],
  ['yellow_onion', 'Cipolla', 'cibo', 'frutta-verdura', 'verdura', { tex: 256 }],
  ['sweet_potato', 'Patata dolce', 'cibo', 'frutta-verdura', 'verdura', { tex: 256 }],
  ['food_ginger_01', 'Zenzero', 'cibo', 'frutta-verdura', 'verdura', { tex: 256 }],
  ['croissant', 'Cornetto', 'cibo', 'dolci-pane', 'colazione brioche', { tex: 256 }],
  ['hamburger_buns', 'Panini', 'cibo', 'dolci-pane', 'pane', { tex: 256 }],
  ['carrot_cake', 'Torta di carote', 'cibo', 'dolci-pane', 'dolce compleanno', { tex: 256 }],
  ['strawberry_chocolate_cake', 'Torta al cioccolato', 'cibo', 'dolci-pane', 'dolce compleanno fragole', { tex: 256 }],
  ['tea_set_01', 'Servizio da tè', 'cibo', 'stoviglie', 'tazze teiera', { ratio: 0.35 }],
  ['jug_01', 'Brocca in ceramica', 'cibo', 'stoviglie', 'latte caraffa', { tex: 256 }],
  ['metal_jug', 'Bricco in metallo', 'cibo', 'stoviglie', 'latte', { tex: 256 }],
  ['wooden_bowl_01', 'Ciotola in legno', 'cibo', 'stoviglie', 'insalatiera frutta'],
  ['wooden_bowl_02', 'Ciotolina intagliata', 'cibo', 'stoviglie', 'ciotola', { tex: 256 }],
  ['carved_wooden_plate', 'Piatto in legno', 'cibo', 'stoviglie', 'vassoio', { tex: 256 }],
  ['brass_goblets', 'Calici in ottone', 'cibo', 'stoviglie', 'coppa medievale', { tex: 256 }],
  ['wine_bottles_01', 'Bottiglie di vino', 'cibo', 'bevande', 'vino champagne', { ratio: 0.4 }],
  ['plastic_thermos', 'Thermos', 'cibo', 'bevande', 'caffè', { tex: 256 }],
  ['long_life_food', 'Spesa a lunga conservazione', 'cibo', 'dispensa', 'latte scatolette'],
  ['russian_food_cans_01', 'Scatolette', 'cibo', 'dispensa', 'lattine', { tex: 256 }],

  // ---- Contenitori
  ['cardboard_box_01', 'Scatola di cartone', 'contenitori', 'scatole', 'trasloco pacco'],
  ['plastic_container', 'Contenitore di plastica', 'contenitori', 'scatole', 'box'],
  ['industrial_pastic_container', 'Cassa industriale', 'contenitori', 'scatole', 'box'],
  ['CheeseBox_01', 'Scatola di legno', 'contenitori', 'scatole', 'formaggio', { tex: 256 }],
  ['ammo_box', 'Cassetta metallica', 'contenitori', 'scatole', 'munizioni militare', { tex: 256 }],
  ['wooden_crate_01', 'Cassa di legno', 'contenitori', 'casse', 'cassetta'],
  ['wooden_crate_02', 'Cassa di legno grande', 'contenitori', 'casse', 'cassone'],
  ['wooden_military_crate', 'Cassa militare', 'contenitori', 'casse', 'esercito'],
  ['old_military_crate', 'Cassa da trasporto', 'contenitori', 'casse', 'militare'],
  ['treasure_chest', 'Forziere del tesoro', 'contenitori', 'casse', 'pirati baule', { ratio: 0.15 }],
  ['plastic_crate_01', 'Cassetta per bottiglie', 'contenitori', 'casse', 'plastica latte'],
  ['plastic_crate_02', 'Cassetta di plastica', 'contenitori', 'casse', 'frutta'],
  ['Barrel_01', 'Fusto rosso', 'contenitori', 'barili', 'bidone petrolio esplosivo'],
  ['barrel_03', 'Fusto metallico', 'contenitori', 'barili', 'bidone'],
  ['Barrel_02', 'Fusto di plastica', 'contenitori', 'barili', 'bidone acqua'],
  ['wine_barrel_01', 'Botte di vino', 'contenitori', 'barili', 'cantina legno'],
  ['wicker_basket_01', 'Cesto da picnic', 'contenitori', 'cesti-secchi', 'vimini', { ratio: 0.5 }],
  ['wicker_basket_02', 'Cesto in rattan', 'contenitori', 'cesti-secchi', 'vimini'],
  ['wooden_bucket_01', 'Secchio di legno', 'contenitori', 'cesti-secchi', 'pozzo'],
  ['wooden_bucket_02', 'Mastello di legno', 'contenitori', 'cesti-secchi', 'tinozza'],
  ['trashbag', 'Sacco della spazzatura', 'contenitori', 'cesti-secchi', 'rifiuti'],
  ['metal_jerrycan', 'Tanica di metallo', 'contenitori', 'taniche', 'benzina'],
  ['plastic_jerrycan', 'Tanica di plastica', 'contenitori', 'taniche', 'benzina'],
  ['propane_tank', 'Bombola del gas', 'contenitori', 'taniche', 'gpl'],
  ['vintage_suitcase', 'Valigia vintage', 'accessori', 'borse-valigie', 'viaggio bagaglio'],

  // ---- Attrezzi
  ['metal_toolbox', 'Cassetta degli attrezzi', 'attrezzi', 'officina', 'utensili'],
  ['metal_tool_chest', 'Cassettiera attrezzi', 'attrezzi', 'officina', 'garage'],
  ['tool_cart', 'Carrello attrezzi', 'attrezzi', 'officina', 'garage meccanico', { ratio: 0.5 }],
  ['bench_vice_01', 'Morsa da banco', 'attrezzi', 'officina', 'garage'],
  ['old_drill_press', 'Trapano a colonna', 'attrezzi', 'officina', 'garage'],
  ['hand_truck', 'Carrello portapacchi', 'attrezzi', 'officina', 'trasloco magazzino'],
  ['korean_fire_extinguisher_01', 'Estintore', 'attrezzi', 'officina', 'incendio sicurezza'],
  ['WetFloorSign_01', 'Cartello pavimento bagnato', 'attrezzi', 'pulizia', 'attenzione'],
  ['Drill_01', 'Trapano', 'attrezzi', 'utensili', 'avvitatore', { tex: 256 }],
  ['cross_pein_hammer', 'Martello', 'attrezzi', 'utensili', 'chiodi', { tex: 256, lie: true }],
  ['sledgehammer_01', 'Mazza', 'attrezzi', 'utensili', 'martello grande demolizione', { tex: 256 }],
  ['hatchet', 'Accetta', 'attrezzi', 'utensili', 'ascia', { tex: 256, lie: true }],
  ['wooden_axe', 'Ascia', 'attrezzi', 'utensili', 'scure boscaiolo', { tex: 256, lie: true }],
  ['handsaw_wood', 'Sega', 'attrezzi', 'utensili', 'legno', { tex: 256 }],
  ['adjustable_wrench', 'Chiave inglese', 'attrezzi', 'utensili', 'meccanico', { tex: 256, lie: true }],
  ['pipe_wrench', 'Giratubi', 'attrezzi', 'utensili', 'idraulico', { tex: 256, lie: true }],
  ['pliers', 'Pinze', 'attrezzi', 'utensili', 'tenaglie', { tex: 256, lie: true }],
  ['screwdrivers_02', 'Cacciaviti', 'attrezzi', 'utensili', 'giravite', { tex: 256 }],
  ['crowbar_01', 'Piede di porco', 'attrezzi', 'utensili', 'leva scasso', { tex: 256, lie: true }],
  ['bolt_cutters_01', 'Tronchesi', 'attrezzi', 'utensili', 'cesoie scasso', { tex: 256, lie: true }],
  ['measuring_tape_01', 'Metro a nastro', 'attrezzi', 'utensili', 'misura', { tex: 256 }],
  ['magnifying_glass_01', 'Lente d’ingrandimento', 'attrezzi', 'utensili', 'detective', { tex: 256 }],
  ['rusted_spade_01', 'Vanga', 'attrezzi', 'giardino', 'pala', { tex: 256 }],
  ['watering_can_metal_01', 'Annaffiatoio', 'attrezzi', 'giardino', 'innaffiatoio', { tex: 256 }],
  ['wooden_broom', 'Scopa di saggina', 'attrezzi', 'pulizia', 'strega', { tex: 256 }],
  ['plastic_broom', 'Scopa', 'attrezzi', 'pulizia', 'pavimento'],
  ['dustpan', 'Paletta', 'attrezzi', 'pulizia', 'spazzatura', { tex: 256 }],
  ['wooden_ladder_02', 'Scaleo in legno', 'attrezzi', 'scale', 'scala'],
  ['ladder_sectioned_01', 'Scala in alluminio', 'attrezzi', 'scale', 'scala'],
  ['vintage_microscope', 'Microscopio', 'attrezzi', 'scienza', 'laboratorio'],
  ['chemistry_set', 'Set da chimica', 'attrezzi', 'scienza', 'laboratorio provette', { ratio: 0.35 }],
  ['bunsen_burner', 'Becco Bunsen', 'attrezzi', 'scienza', 'laboratorio', { tex: 256 }],
  ['binoculars', 'Binocolo', 'attrezzi', 'scienza', 'cannocchiale', { tex: 256 }],
  ['antique_katana_01', 'Katana', 'attrezzi', 'armi', 'spada samurai', { tex: 256, lie: true }],
  ['wooden_handle_saber', 'Sciabola', 'attrezzi', 'armi', 'spada pirata', { tex: 256, lie: true }],
  ['antique_estoc', 'Stocco', 'attrezzi', 'armi', 'spada', { tex: 256, lie: true }],
  ['ornate_medieval_dagger', 'Pugnale', 'attrezzi', 'armi', 'coltello', { tex: 256, lie: true }],
  ['machete', 'Machete', 'attrezzi', 'armi', 'coltello', { tex: 256, lie: true }],
  ['ornate_medieval_mace', 'Mazza ferrata', 'attrezzi', 'armi', 'medievale', { tex: 256, lie: true }],
  ['ornate_war_hammer', 'Martello da guerra', 'attrezzi', 'armi', 'medievale', { tex: 256, lie: true }],
  ['kite_shield', 'Scudo a goccia', 'attrezzi', 'armi', 'cavaliere'],
  ['service_pistol', 'Pistola', 'attrezzi', 'armi', 'arma da fuoco', { tex: 256, ratio: 0.5 }],
  ['bolt_action_rifle_7_62', 'Fucile', 'attrezzi', 'armi', 'arma da fuoco', { tex: 256 }],

  // ---- Sport e svago
  ['football', 'Pallone da calcio', 'sport', 'palloni', 'calcio palla', { tex: 256 }],
  ['american_football', 'Palla da football', 'sport', 'palloni', 'rugby', { tex: 256 }],
  ['baseball_01', 'Palla da baseball', 'sport', 'palloni', 'palla', { tex: 256 }],
  ['baseball_bat', 'Mazza da baseball', 'sport', 'palloni', 'mazza', { tex: 256, lie: true }],
  ['chess_set', 'Scacchiera', 'sport', 'giochi', 'scacchi', { ratio: 0.25 }],
  ['dartboard', 'Bersaglio per freccette', 'sport', 'giochi', 'pub bar', { wall: true, tex: 256 }],
  ['Ukulele_01', 'Ukulele', 'sport', 'musica', 'chitarra strumento', { lie: true }],

  // ---- Scarpe e accessori
  ['rubber_boots', 'Stivali di gomma', 'accessori', 'scarpe', 'stivali pioggia', { ratio: 0.35 }],
  ['round_spectacles', 'Occhiali tondi', 'accessori', 'occhiali-orologi', 'occhiali', { tex: 256 }],
  ['pocket_watch', 'Orologio da taschino', 'accessori', 'occhiali-orologi', 'orologio', { tex: 256 }],
  ['digital_wrist_watch', 'Orologio digitale', 'accessori', 'occhiali-orologi', 'orologio polso', { tex: 256 }],
  ['fishermans_hat', 'Cappello da pescatore', 'accessori', 'varie', 'cappello'],
  ['garden_gloves_01', 'Guanti da lavoro', 'accessori', 'varie', 'guanti', { tex: 256 }],
  ['old_gas_mask', 'Maschera antigas', 'accessori', 'varie', 'guerra', { tex: 256, lie: true }],
  ['vintage_lighter', 'Accendino', 'accessori', 'varie', 'zippo', { tex: 256 }],
  ['cigarette_pack', 'Pacchetto di sigarette', 'accessori', 'varie', 'fumo', { tex: 256 }],
];

// ------------------------------------------------------------------------------------------
const log = (...a) => console.log('[props]', ...a);
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

async function fetchJSON(url, file) {
  if (file && exists(file) && !REFETCH) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'posaviva-build-props/1.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      const j = await r.json();
      if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(j)); }
      return j;
    } catch (e) { if (attempt >= 3) throw e; await new Promise((res) => setTimeout(res, 1000 * (attempt + 1))); }
  }
}

async function download(url, file) {
  if (exists(file) && !REFETCH) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'posaviva-build-props/1.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(file + '.part', buf);
      fs.renameSync(file + '.part', file);
      return;
    } catch (e) { if (attempt >= 3) throw e; await new Promise((res) => setTimeout(res, 1000 * (attempt + 1))); }
  }
}

// Texture processing (Pillow). Reads a job list: for each material, the base color,
// normal, ARM (AO/rough/metal) and occlusion images; writes the baked/resized images
// and returns mean roughness / metalness of the ARM map.
const PY = String.raw`
import json, sys
from PIL import Image, ImageChops
jobs = json.load(open(sys.argv[1]))
out = []
def fit(im, size):
    w, h = im.size
    s = min(1.0, size / max(w, h))
    if s < 1.0:
        im = im.resize((max(4, round(w * s)), max(4, round(h * s))), Image.LANCZOS)
    return im
def mean(ch):
    h = ch.histogram()
    n = sum(h)
    return sum(i * c for i, c in enumerate(h)) / max(1, n) / 255.0
for j in jobs:
    r = {'rough': None, 'metal': None}
    arm = Image.open(j['arm']).convert('RGB') if j.get('arm') else None
    occ = Image.open(j['occ']).convert('RGB') if j.get('occ') else None
    if arm is not None:
        _, g, b = arm.split()
        r['rough'] = mean(g); r['metal'] = mean(b)
    if j.get('base'):
        base = Image.open(j['base'])
        alpha = base.getchannel('A') if base.mode in ('RGBA', 'LA') else None
        rgb = base.convert('RGB')
        ao_src = occ if occ is not None else arm
        if ao_src is not None and j.get('aoBake', 0) > 0:
            ao = ao_src.split()[0].resize(rgb.size, Image.BILINEAR)
            k = j['aoBake']
            ao = ao.point(lambda v: int(255 - (255 - v) * k))
            rgb = ImageChops.multiply(rgb, Image.merge('RGB', (ao, ao, ao)))
        if alpha is not None:
            rgb.putalpha(alpha)
        fit(rgb, j['size']).save(j['baseOut'])
    if j.get('normal'):
        fit(Image.open(j['normal']).convert('RGB'), j['nsize']).save(j['normalOut'])
    out.append(r)
json.dump(out, open(sys.argv[2], 'w'))
`;

const PY_THUMB = String.raw`
import sys
from PIL import Image
src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGBA')
bb = im.getbbox()
if bb: im = im.crop(bb)
w, h = im.size
s = (size - 6) / max(w, h)
im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
canvas.paste(im, ((size - im.size[0]) // 2, (size - im.size[1]) // 2), im)
canvas.save(dst, 'WEBP', quality=82, method=6)
`;

// helper scripts are written once (workers run in parallel)
const _temps = new Map();
function writeTemp(name, text) {
  if (_temps.has(name)) return _temps.get(name);
  const f = path.join(CACHE, name);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, text);
  _temps.set(name, f);
  return f;
}

/** Bounds of the default scene of a GLB (handles KHR_mesh_quantization node transforms). */
function glbBounds(file) {
  const buf = fs.readFileSync(file);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const norm = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
  const mul = (a, b) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; };
  const trs = (n) => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = n.scale || [1, 1, 1];
    const [tx, ty, tz] = n.translation || [0, 0, 0];
    return [
      (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1];
  };
  let tris = 0;
  const visit = (ni, parent) => {
    const n = json.nodes[ni];
    const m = mul(parent, trs(n));
    if (n.mesh !== undefined) {
      for (const prim of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        const k = acc.normalized ? norm[acc.componentType] || 1 : 1;
        const a = acc.min.map((v) => v / k), b = acc.max.map((v) => v / k);
        for (let c = 0; c < 8; c++) {
          const p = [c & 1 ? b[0] : a[0], c & 2 ? b[1] : a[1], c & 4 ? b[2] : a[2]];
          for (let r = 0; r < 3; r++) {
            const v = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
            min[r] = Math.min(min[r], v); max[r] = Math.max(max[r], v);
          }
        }
        tris += prim.indices !== undefined ? json.accessors[prim.indices].count / 3 : acc.count / 3;
      }
    }
    for (const c of n.children || []) visit(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const ni of json.scenes[json.scene || 0].nodes) visit(ni, I);
  return { min, max, tris: Math.round(tris), materials: (json.materials || []).length };
}

async function processModel(entry, info) {
  const [id, label, cat, sub, tags, o = {}] = entry;
  const dir = path.join(CACHE, id);
  const glbOut = path.join(OUT, 'models', `${id}.glb`);
  const thumbOut = path.join(OUT, 'thumbs', `${id}.webp`);
  fs.mkdirSync(path.dirname(glbOut), { recursive: true });
  fs.mkdirSync(path.dirname(thumbOut), { recursive: true });

  // ---- thumbnail
  if (!exists(thumbOut) || FORCE) {
    const png = path.join(dir, 'thumb.png');
    await download(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`, png);
    await run('python3', ['-I', writeTemp('thumb.py', PY_THUMB), png, thumbOut, '128']);
  }

  if (exists(glbOut) && !FORCE) return { ...glbBounds(glbOut), bytes: fs.statSync(glbOut).size };

  // ---- download the 1k glTF (2k when no 1k variant is published)
  const files = await fetchJSON(`https://api.polyhaven.com/files/${id}`, path.join(dir, 'files.json'));
  const g = files.gltf['1k'] || files.gltf['2k'];
  if (!g) throw new Error(`no glTF for ${id}`);
  const src = path.join(dir, 'src');
  const gltfFile = path.join(src, `${id}.gltf`);
  await download(g.gltf.url, gltfFile);
  await Promise.all(Object.entries(g.gltf.include).map(([rel, f]) => download(f.url, path.join(src, rel))));

  // ---- textures: bake AO into the base color, resize, drop ARM / occlusion
  const gltf = JSON.parse(fs.readFileSync(gltfFile, 'utf8'));
  const longest = Math.max(...(info.dimensions || [500, 500, 500])) / 1000;
  const size = o.tex || (longest > 1.2 ? 1024 : longest > 0.25 ? 512 : 256);
  const nsize = Math.min(512, size);
  const stage = path.join(dir, 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'tex'), { recursive: true });
  const imgPath = (texIndex) => {
    const t = gltf.textures?.[texIndex];
    if (!t) return null;
    const img = gltf.images[t.source];
    return img?.uri ? path.join(src, decodeURIComponent(img.uri)) : null;
  };
  const jobs = [];
  const newImages = [];
  const addImage = (file) => { newImages.push({ uri: `tex/${path.basename(file)}`, mimeType: 'image/png' }); return newImages.length - 1; };
  const newTextures = [];
  const addTexture = (img) => { newTextures.push({ source: img, sampler: 0 }); return newTextures.length - 1; };
  for (const [mi, mat] of (gltf.materials || []).entries()) {
    const pbr = mat.pbrMetallicRoughness || (mat.pbrMetallicRoughness = {});
    const base = pbr.baseColorTexture ? imgPath(pbr.baseColorTexture.index) : null;
    const normal = mat.normalTexture ? imgPath(mat.normalTexture.index) : null;
    const arm = pbr.metallicRoughnessTexture ? imgPath(pbr.metallicRoughnessTexture.index) : null;
    const occ = mat.occlusionTexture ? imgPath(mat.occlusionTexture.index) : null;
    const job = { mi, arm, occ: occ !== arm ? occ : null, aoBake: 0.7, size, nsize };
    if (base) { job.base = base; job.baseOut = path.join(stage, 'tex', `m${mi}_base.png`); }
    if (normal) { job.normal = normal; job.normalOut = path.join(stage, 'tex', `m${mi}_nor.png`); }
    jobs.push(job);
  }
  const jobFile = path.join(dir, 'jobs.json'), resFile = path.join(dir, 'jobs-out.json');
  fs.writeFileSync(jobFile, JSON.stringify(jobs));
  await run('python3', ['-I', writeTemp('tex.py', PY), jobFile, resFile], { maxBuffer: 1 << 24 });
  const res = JSON.parse(fs.readFileSync(resFile, 'utf8'));
  for (const [k, job] of jobs.entries()) {
    const mat = gltf.materials[job.mi], pbr = mat.pbrMetallicRoughness;
    const r = res[k];
    if (job.base) pbr.baseColorTexture = { index: addTexture(addImage(job.baseOut)) }; else delete pbr.baseColorTexture;
    if (job.normal) mat.normalTexture = { index: addTexture(addImage(job.normalOut)), scale: mat.normalTexture?.scale ?? 1 }; else delete mat.normalTexture;
    if (r.rough !== null) pbr.roughnessFactor = +(Math.min(1, (pbr.roughnessFactor ?? 1) * r.rough)).toFixed(3);
    if (r.metal !== null) pbr.metallicFactor = +(Math.min(1, (pbr.metallicFactor ?? 1) * r.metal)).toFixed(3);
    delete pbr.metallicRoughnessTexture;
    delete mat.occlusionTexture;
    delete mat.emissiveTexture;
    // material extensions: glass (transmission) becomes plain transparency, the rest is dropped
    const ext = mat.extensions || {};
    if (ext.KHR_materials_transmission) {
      mat.alphaMode = 'BLEND';
      const f = pbr.baseColorFactor || [1, 1, 1, 1];
      pbr.baseColorFactor = [f[0], f[1], f[2], Math.min(f[3] ?? 1, 0.3)];
      pbr.roughnessFactor = Math.min(pbr.roughnessFactor ?? 0.1, 0.15);
    }
    delete mat.extensions;
  }
  for (const k of ['extensionsUsed', 'extensionsRequired']) if (gltf[k]) gltf[k] = gltf[k].filter((x) => !x.startsWith('KHR_materials_'));
  gltf.images = newImages;
  gltf.textures = newTextures;
  gltf.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
  // buffers next to the staged file
  for (const b of gltf.buffers || []) {
    if (!b.uri || b.uri.startsWith('data:')) continue;
    const from = path.join(src, decodeURIComponent(b.uri));
    const to = path.join(stage, path.basename(from));
    fs.copyFileSync(from, to);
    b.uri = path.basename(from);
  }
  // optional yaw fix (front -> +Z)
  if (o.yaw) {
    const a = (o.yaw * Math.PI) / 360;
    const sc = gltf.scenes[gltf.scene || 0];
    gltf.nodes.push({ name: 'yaw', rotation: [0, Math.sin(a), 0, Math.cos(a)], children: sc.nodes });
    sc.nodes = [gltf.nodes.length - 1];
  }
  const staged = path.join(stage, `${id}.gltf`);
  fs.writeFileSync(staged, JSON.stringify(gltf));

  // ---- geometry: center on the floor, weld, simplify, join, meshopt + quantization, WebP
  const centered = path.join(dir, 'centered.glb');
  await run('npx', [...CLI, 'center', staged, centered, '--pivot', 'below'], { maxBuffer: 1 << 24 });
  const optArgs = ['optimize', centered, glbOut, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(size),
    '--instance', 'false', '--palette', 'false', '--simplify-error', '0.0004'];
  if (o.ratio) optArgs.push('--simplify-ratio', String(o.ratio), '--simplify-error', '0.004');
  await run('npx', [...CLI, ...optArgs], { maxBuffer: 1 << 24 });
  return { ...glbBounds(glbOut), bytes: fs.statSync(glbOut).size };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  log('cache:', CACHE);
  const index = await fetchJSON('https://api.polyhaven.com/assets?t=models', path.join(CACHE, 'assets.json'));
  const list = L.filter((e) => !ONLY || ONLY.has(e[0]));
  const missing = list.filter((e) => !index[e[0]]);
  if (missing.length) log('not on Poly Haven (skipped):', missing.map((e) => e[0]).join(', '));
  const todo = list.filter((e) => index[e[0]]);
  let done = 0;
  const results = await pool(todo, JOBS, async (e) => {
    try {
      const r = await processModel(e, index[e[0]]);
      log(`${++done}/${todo.length} ${e[0]} ${(r.bytes / 1024).toFixed(0)} KB, ${r.tris} tris`);
      return r;
    } catch (err) {
      log(`FAILED ${e[0]}: ${err.message.split('\n')[0]}`);
      return null;
    }
  });

  // ---- generated catalog module + credits (every curated entry that has a built asset)
  const all = L.filter((e) => index[e[0]] && exists(path.join(OUT, 'models', `${e[0]}.glb`)));
  const byId = new Map(todo.map((e, i) => [e[0], results[i]]));
  const entries = [];
  let total = 0;
  for (const e of all) {
    const [id, label, cat, sub, tags, o = {}] = e;
    const r = byId.get(id) || { ...glbBounds(path.join(OUT, 'models', `${id}.glb`)), bytes: fs.statSync(path.join(OUT, 'models', `${id}.glb`)).size };
    total += r.bytes + (exists(path.join(OUT, 'thumbs', `${id}.webp`)) ? fs.statSync(path.join(OUT, 'thumbs', `${id}.webp`)).size : 0);
    const size = [0, 1, 2].map((k) => +(r.max[k] - r.min[k]).toFixed(3));
    const ph = index[id];
    const t = [...new Set([...(tags || '').split(/\s+/).filter(Boolean), ...(ph.tags || []).slice(0, 4).map((x) => x.toLowerCase())])].join(' ');
    const item = { id: `ph_${id}`, ph: id, label, cat, sub, tags: t, size, tris: r.tris };
    if (o.ceil) item.mount = 'ceil';
    if (o.wall) item.mount = 'wall';
    if (o.lie) item.lie = true;
    entries.push(item);
  }
  const header = '// GENERATED by posaviva/tools/build-props.mjs — do not edit by hand.\n'
    + '// Realistic CC0 models from Poly Haven (https://polyhaven.com), see public/assets/props/CREDITS.txt.\n'
    + '// Each entry: id, ph (Poly Haven id), label, cat, sub, tags, size [w, h, d] meters, tris, mount?.\n';
  fs.writeFileSync(GEN, header + 'export const PH_MODELS = [\n' + entries.map((x) => '  ' + JSON.stringify(x) + ',').join('\n') + '\n];\n');

  const credits = ['PosaViva — realistic props', '',
    'The 3D models in models/ and their thumbnails in thumbs/ come from Poly Haven (https://polyhaven.com)',
    'and are licensed CC0 1.0 Universal (public domain): https://creativecommons.org/publicdomain/zero/1.0/',
    'They were converted (merged meshes, simplified geometry, smaller textures with baked ambient occlusion).',
    'Thanks to the Poly Haven team and to the artists listed below.', ''];
  for (const x of entries) {
    const ph = index[x.ph];
    credits.push(`${x.label} — "${ph.name}" by ${Object.keys(ph.authors || {}).join(', ') || 'Poly Haven'} — https://polyhaven.com/a/${x.ph}`);
  }
  fs.writeFileSync(path.join(OUT, 'CREDITS.txt'), credits.join('\n') + '\n');
  log(`${entries.length} models, ${(total / 1048576).toFixed(1)} MB in ${path.relative(process.cwd(), OUT)}; catalog -> ${path.relative(process.cwd(), GEN)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
