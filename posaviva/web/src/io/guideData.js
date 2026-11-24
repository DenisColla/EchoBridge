// Contents of the in-app "Guida" (menu ☰ › Guida, the "?" button in the top bar).
//
// Written for what EXISTS in the app: every step was checked in the running app.
// A topic (or a single step / tip) that depends on a feature that may be missing
// (a module not loaded with ?only=…, a feature still being built) declares
// `when(env)`: it is shown only when that feature is really there.
//
// Topic fields:
//   id, chapter, icon (ui/icons.js name), title, summary, keywords (extra search words)
//   art      optional illustration (io/art.js ART key)
//   where    breadcrumb of where it lives in the UI, e.g. ['Posa', 'Ruota']
//   steps    numbered steps; string or {t, when}
//   tips     short notes; string or {t, when}
//   go       "Prova ora" button: {tool, mode?} opens a tool (pose mode), {spot} highlights
//            an on-screen control (see SPOTS in guide.js), {action} runs an io action
//   context  keys that open this topic from the "?" button: 'toolId' or 'toolId:mode'
//   related  ids shown under "Vedi anche"
//   when     (env) => boolean, env = {app, shell, tool(id), posing(fn), render(key)}
//   status   'live' (default) | 'planned' = PLACEHOLDER, never shown to users
//
// Text markup: **Etichetta** = a label as written in the app, [icon] = small inline icon.
//
// Phase A (touch, objects, light, stage UI): tocco-diretto, menu-mano, contatti,
// sposta-premendo, azioni-oggetti, luci-scena, luce-ambientale, vista-pulita, pannello,
// scorciatoie — each guarded by `when` on its module API (app.posing.pinTo / touchMenu /
// carry, app.objectActions, app.practicals, shell.setCleanView / shortcuts).
//
// PLACEHOLDERS for the next phases are at the end of TOPICS (status: 'planned'): animali
// (novità), libreria oggetti/edifici (novità), linea d'azione (avanzata), definizione
// muscolare (novità). Animali, Esterni, Edifici, Oggetti, Paesaggi, Progetti, Comandi vocali,
// Linea d'azione, Definizione muscolare, Linee anatomiche and Deformazione morbida are
// documented (each guarded by `when`, so they disappear if the feature is not in the build).
// To publish one: write steps checked in the running app, set status 'live' (or delete
// the field) and give it a `when` that tests the feature (usually e.tool('<tool id>')).

export const CHAPTERS = [
  { id: 'basi', title: 'Primi passi', icon: 'tap' },
  { id: 'personaggi', title: 'Personaggi', icon: 'people' },
  { id: 'posa', title: 'Mettere in posa', icon: 'pose' },
  { id: 'inquadrare', title: 'Inquadrare da vicino', icon: 'zoom' },
  { id: 'aspetto', title: 'Aspetto', icon: 'shirt' },
  { id: 'scena', title: 'Scena', icon: 'sun' },
  { id: 'camera', title: 'Camera e prospettiva', icon: 'camera' },
  { id: 'stile', title: 'Stile di resa', icon: 'palette' },
  { id: 'file', title: 'Salvare ed esportare', icon: 'save' },
];

/** Topics suggested at the top of the index ("Inizia da qui"). */
export const START_HERE = ['vista', 'tocco-diretto', 'zoom-rapido', 'esportare'];

const hasLine = (e) => e.posing('drawLine');
const hasProjects = (e) => typeof e.app?.projects?.open === 'function';
const noProjects = (e) => !hasProjects(e);
const hasVoice = (e) => typeof e.app?.voice?.open === 'function' || typeof e.app?.modules?.voice?.open === 'function';
/** "Salva posa…" (Posa › Posa intera) and "Le mie pose" (Pose pronte): pose module + projects archive */
const hasMyPoses = (e) => hasProjects(e) && typeof e.app?.projects?.openSaveSheet === 'function' && e.tool('poselib');
const hasAdjust = (e) => e.posing('dynamism') && e.posing('setNaturalness');
const hasSoftSpine = (e) => e.poseState('softSpine');
/** Tablets (Galaxy Tab: >= 700 px wide, both sides >= 600 px): rail + side panel in any orientation */
const isTablet = (e) => !!e.shell?.tablet;
const notTablet = (e) => !isTablet(e);
/** S Pen options exist (io/pen.js) and matter: a tablet, or a pen already used on this device */
const hasPen = (e) => !!e.app?.modules?.ui?.pen && (isTablet(e) || !!e.app.modules.ui.pen.state?.seen);
/** Phase A: direct touch on the body (pose/direct.js), hand / foot menu, contacts, long-press carry */
const hasDirect = (e) => e.posing('pinTo') && e.poseState('direct');
const hasTouchMenu = (e) => e.posing('touchMenu');
const hasContacts = (e) => e.posing('pinTo');
const hasCarry = (e) => !!e.app?.posing?.carry;
/** long-press actions on objects (props/actions.js), practical lights (scene/practicals.js) */
const hasActions = (e) => typeof e.app?.objectActions?.openMenu === 'function';
const hasPracticals = (e) => typeof e.app?.practicals?.ambientMenu === 'function';
/** stage UI (ui/shell.js, ui/shortcuts.js) */
const hasClean = (e) => typeof e.shell?.setCleanView === 'function';
const hasResize = (e) => typeof e.shell?.sheetRange === 'function';
const hasShortcuts = (e) => !!e.shell?.shortcuts;
const hasLandscapes = (e) => typeof e.app?.landscapes?.generate === 'function';

export const TOPICS = [
  // ------------------------------------------------------------------ primi passi
  {
    id: 'interfaccia', chapter: 'basi', icon: 'layers', title: 'Com\'è fatta l\'app',
    summary: 'Barra degli strumenti, pannello, tasti in alto',
    keywords: 'interfaccia barra strumenti pannello menu schede orizzontale verticale indietro chiudere',
    steps: [
      { t: 'In basso c\'è la barra degli strumenti: **Personaggi**, **Posa**, **Aspetto**, **Scena**, **Camera**, **Stile**. Toccane uno per aprire il suo pannello.', when: notTablet },
      { t: 'Alcuni gruppi hanno più strumenti: li trovi come schede in cima al pannello (per esempio **Posa** › **Pose pronte** › **Mani** › **Viso**).', when: notTablet },
      { t: 'Trascina la maniglia del pannello in su o in giù per allargarlo o ridurlo; toccala per cambiare altezza. Trascinalo tutto in giù, o tocca [close], per chiuderlo.', when: notTablet },
      { t: 'A sinistra c\'è la colonna degli strumenti: **Personaggi**, **Posa**, **Aspetto**, **Scena**, **Camera**, **Stile**. Toccane uno per aprire il suo pannello a destra, accanto alla vista.', when: isTablet },
      { t: 'Sotto il gruppo aperto compaiono i suoi strumenti (per esempio **Posa**: **Pose pronte**, **Mani**, **Viso**): toccane uno per passare a quello.', when: isTablet },
      { t: 'Tocca [panelWide] in cima al pannello per allargarlo, oppure trascina il suo bordo sinistro. Tocca [close], o di nuovo il gruppo nella colonna, per chiuderlo e avere tutta la vista.', when: isTablet },
      'In alto a sinistra c\'è il personaggio selezionato: toccalo per aprire l\'elenco dei personaggi.',
      { t: 'In alto a destra: [undo] [redo] annulla e ripeti, [help] questa guida, [menu] il menu con **Progetti**, salvataggio, esportazione e impostazioni.', when: hasProjects },
      { t: 'In alto a destra: [undo] [redo] annulla e ripeti, [help] questa guida, [menu] il menu con scene, esportazione e impostazioni.', when: noProjects },
      { t: 'In basso sulla vista: a sinistra [mic] apre i **Comandi** vocali, a destra [zoom] lo zoom rapido.', when: hasVoice },
      { t: 'In alto [cleanView] **Vista pulita** nasconde tutto tranne la scena.', when: hasClean },
    ],
    tips: [
      { t: 'Con il telefono in orizzontale gli strumenti diventano una colonna a sinistra e il pannello si apre a destra.', when: notTablet },
      { t: 'Quando la barra in alto ha spazio mostra anche [book] **Progetti**, [save] **Salva** ed [image] **Esporta**.', when: isTablet },
      'Il tasto Indietro di Android chiude prima menu e finestre, poi il pannello. Con niente aperto, premilo due volte per uscire.',
    ],
    go: { spot: 'toolbar' }, related: ['vista', 'annulla'],
  },
  {
    id: 'penna', chapter: 'basi', icon: 'pen', title: 'Tablet e S Pen',
    summary: 'Pannello laterale, penna di precisione, palmo appoggiato',
    keywords: 'tablet galaxy tab s pen penna stilo palmo mano appoggiata tasto laterale pulsante evidenzia hover precisione pannello largo stretto',
    when: hasPen,
    steps: [
      'Sul tablet gli strumenti sono nella colonna a sinistra e il pannello resta aperto a destra, accanto alla vista, in verticale e in orizzontale.',
      'Per un pannello più largo tocca [panelWide] in cima al pannello, oppure trascina il suo bordo sinistro; tocca due volte il bordo per passare tra larghezza normale e ampia.',
      'Con la **S Pen** tocca parti del corpo, articolazioni e anelli con precisione: la punta raggiunge anche dita e articolazioni piccole.',
      'Avvicina la penna allo schermo senza toccarlo: con **Posa** o **Mani** aperti la parte del corpo sotto la punta si illumina di azzurro.',
      'Tieni premuto il tasto laterale della penna e trascina: giri attorno alla scena anche sopra il personaggio, senza muovere anelli o parti.',
      'Mentre la penna tocca o sfiora la vista puoi appoggiare il palmo sullo schermo: viene ignorato.',
    ],
    tips: [
      'In [menu] › **Impostazioni** › **Penna (S Pen)**: **La penna non muove la vista** fa girare la vista solo con le dita (o con il tasto laterale), così un tratto di penna fuori dagli anelli non sposta l\'inquadratura.',
      'Con il pannello largo le griglie di pose, oggetti, animali, edifici e paesaggi mostrano più colonne.',
    ],
    go: { action: 'openSettings', label: 'Apri Impostazioni' }, related: ['interfaccia', 'posa-ruota', 'vista'],
  },
  {
    id: 'vista', chapter: 'basi', icon: 'orbit', art: 'pinch', title: 'Muovere la vista',
    summary: 'Girare attorno, zoomare e spostare con le dita',
    keywords: 'gesti dita orbita ruotare girare zoom pizzico pinch spostare pan inquadratura vista telecamera',
    steps: [
      '**Un dito** sullo sfondo (non sul personaggio): giri attorno alla scena.',
      '**Due dita** che si allargano o si stringono: avvicini o allontani la vista.',
      '**Due dita** trascinate insieme: sposti la vista in su, in giù o di lato.',
      'Per rivedere tutto il personaggio: [zoom] **Zoom rapido** › **Corpo intero**, oppure **Camera** › **Centra sul personaggio**.',
    ],
    tips: [
      'Girare o zoomare la vista non è una modifica della scena: **Annulla** non la tocca.',
      'Per un\'inquadratura precisa usa gli strumenti di **Camera** (obiettivo, punto focale, angolazioni, viste salvate).',
      { t: '[frameAll] **Centra personaggi**, sopra lo zoom rapido, inquadra tutti i personaggi in un tocco.', when: hasShortcuts },
      { t: 'Tenendo premuto uno spazio vuoto si apre invece la **Luce ambientale**.', when: hasPracticals },
    ],
    related: ['zoom-rapido', 'punto-focale', 'scorciatoie'],
  },
  {
    id: 'vista-pulita', chapter: 'basi', icon: 'cleanView', title: 'Vista pulita',
    summary: 'Solo la scena, senza pulsanti né pannelli',
    keywords: 'vista pulita nascondi interfaccia comandi pulsanti pannelli schermo intero solo scena guardare composizione',
    when: hasClean,
    steps: [
      'Tocca [cleanView] **Vista pulita** nella barra in alto, oppure [menu] › **Vista pulita**: spariscono barre, pannello, pulsanti e i menu aperti sulla scena.',
      'Puoi ancora girare la vista, zoomare e posare con le dita.',
      'Per tornare tocca [cleanExit] in alto a destra, premi Indietro oppure tocca due volte con due dita.',
    ],
    tips: [
      'Il pannello che avevi aperto si riapre da solo.',
      'Le immagini esportate non cambiano: l\'interfaccia non c\'è mai.',
      { t: 'Sul tablet in verticale, con il pannello aperto, il pulsante non sta nella barra: usa [menu] › **Vista pulita**.', when: isTablet },
    ],
    go: { spot: 'clean' }, related: ['vista', 'pannello'],
  },
  {
    id: 'pannello', chapter: 'basi', icon: 'sliders', title: 'Pannello più alto o più largo',
    summary: 'Trascina la maniglia o il bordo del pannello',
    keywords: 'pannello altezza larghezza ridimensionare dimensione maniglia bordo mini medio alto allargare restringere',
    when: hasResize,
    steps: [
      { t: 'Trascina la maniglia in cima al pannello: si ferma all\'altezza che vuoi, con tre scatti «Mini», «Medio» e «Alto» (mentre trascini un\'etichetta dice dove sei).', when: notTablet },
      { t: 'Una spinta veloce porta allo scatto successivo; tirala tutta in giù per chiudere il pannello. Un tocco sulla maniglia passa all\'altezza successiva.', when: notTablet },
      { t: 'Trascina il bordo sinistro del pannello per allargarlo o restringerlo: si aggancia alle due larghezze di [panelWide].', when: isTablet },
      { t: 'Con il telefono in orizzontale il pannello si apre a destra: trascina il suo bordo sinistro per allargarlo o restringerlo; tocca due volte il bordo per passare tra larghezza normale e ampia.', when: notTablet },
      'La vista 3D si sposta da sola per restare libera, e la misura scelta resta anche alla prossima apertura.',
    ],
    related: ['interfaccia', 'vista-pulita'],
  },
  {
    id: 'selezionare', chapter: 'basi', icon: 'tap', art: 'tap', title: 'Selezionare personaggi e parti',
    summary: 'Toccare un personaggio, un braccio, una mano…',
    keywords: 'selezione selezionare toccare tap parte corpo braccio mano testa deselezionare elenco destra sinistra',
    steps: [
      'Tocca un personaggio nella vista per selezionarlo: il suo nome compare in alto a sinistra.',
      'Con **Posa** aperta, oppure con il pannello chiuso, tocca una parte del corpo (braccio, mano, testa…): si colora e compaiono gli anelli per ruotarla.',
      'Tocca lo sfondo per lasciare la parte selezionata.',
      { t: 'Toccando una mano o un piede si apre anche il suo menu: forma della mano, raggiungere un punto, appoggiare.', when: hasTouchMenu },
      'Parte troppo piccola o nascosta? In **Posa** apri **Scegli parte** (colonne Destra, Centro, Sinistra) oppure **Dita della mano** per ogni falange.',
    ],
    tips: [
      'Destra e sinistra sono quelle del personaggio, non le tue.',
      'Toccando nella vista un oggetto, un edificio o un animale lo selezioni e si apre il suo pannello.',
    ],
    go: { tool: 'pose', mode: 'rotate' }, related: ['posa-ruota', 'personaggi'],
  },
  {
    id: 'annulla', chapter: 'basi', icon: 'undo', title: 'Annullare e ripetere',
    summary: 'Tornare indietro di una modifica (o rifarla)',
    keywords: 'annulla ripeti undo redo errore indietro cronologia azzerare doppio tocco cursore',
    steps: [
      'Tocca [undo] in alto a destra per annullare l\'ultima modifica, [redo] per rifarla.',
      'Ogni gesto completo è un passo: un trascinamento, un cursore rilasciato, una posa pronta, un capo indossato.',
      'Dopo **Azzera posa** o dopo aver eliminato un personaggio compare un avviso con **Annulla**: toccalo per tornare indietro subito.',
      'Doppio tocco su un cursore: torna al suo valore iniziale.',
    ],
    go: { spot: 'history' }, related: ['vista'],
  },

  {
    id: 'voce', chapter: 'basi', icon: 'mic', title: 'Comandi vocali e scritti',
    summary: 'Descrivi la scena a voce o per iscritto: personaggi, vestiti, pose, animali, oggetti, stanze, paesaggi, luci, camera',
    keywords: 'voce comandi vocali parlare microfono dettare scrivere comando testo frase descrivi metti aggiungi gira togli inquadra claude ibrida offline chiave api annulla esempi prova recenti non ho capito',
    where: ['Microfono (in basso a sinistra)', 'Comandi'],
    when: hasVoice,
    steps: [
      'Tocca [mic], il pulsante tondo in basso a sinistra della vista: si apre **Comandi** e PosaViva ti ascolta. La prima volta Android chiede il permesso di usare il microfono.',
      'Descrivi cosa vuoi, per esempio «metti un uomo con una maglietta bianca seduto sul divano con un cane accanto». Mentre parli vedi le parole; quando smetti di parlare il comando viene eseguito.',
      'Se preferisci, scrivi il comando nel campo **Scrivi un comando…** e tocca la freccia.',
      'Sotto compare cosa è stato fatto; le parti che non ha capito sono elencate in «Non ho capito». **Annulla** toglie tutto il comando in un solo passo.',
      'I suggerimenti **Prova** eseguono un esempio; **Recenti** ripropone i comandi già usati.',
    ],
    tips: [
      'Più cose insieme: «voglio una cucina, metti il tavolo al centro e due sedie a sinistra».',
      'Sinistra e destra sono quelle che vedi sullo schermo; davanti e dietro seguono il fronte della cosa nominata.',
      'Anche per la scena: «crea una strada di città di notte con pioggia», «luce da tramonto», «fai notte».',
      'Anche per la camera: «inquadra dal basso», «primo piano della donna», «grandangolo».',
      'Per cambiare quello che c\'è già: «gira la donna verso la finestra», «falla sorridere», «colora il divano di blu», «togli il cane».',
      'Il pulsante [settings] di **Comandi** (o [menu] › **Impostazioni** › **Comandi vocali**) apre **Comandi vocali**: **Solo offline** capisce i comandi sul telefono, senza rete; **Ibrida** usa Claude se inserisci la tua chiave API e sei online, altrimenti torna offline. La chiave resta solo su questo dispositivo.',
      'Accanto a **Comandi** vedi la modalità in uso (**Offline** o **Ibrida**): toccala per cambiarla.',
    ],
    go: { action: 'openVoice', label: 'Apri Comandi' },
    related: ['personaggi', 'oggetti', 'paesaggi', 'annulla'],
  },

  // ------------------------------------------------------------------ personaggi
  {
    id: 'personaggi', chapter: 'personaggi', icon: 'userPlus', title: 'Aggiungere e gestire i personaggi',
    summary: 'Fino a 8 personaggi: aggiungere, nascondere, rinominare, duplicare',
    keywords: 'personaggio aggiungere nuovo donna uomo corporatura nascondere rinominare duplicare eliminare elenco otto 8 manichino',
    where: ['Personaggi'],
    steps: [
      'Tocca il nome in alto a sinistra, oppure **Personaggi** nella barra.',
      'Tocca **Aggiungi**, scegli **Donna** o **Uomo** e una corporatura: il nuovo personaggio compare accanto agli altri, rivolto verso la camera.',
      'Tocca una riga dell\'elenco per selezionare quel personaggio.',
      '[eye] **Nascondi** toglie un personaggio dalla vista senza eliminarlo; toccalo di nuovo per mostrarlo.',
      'Tieni premuta una riga, o tocca [more], per **Seleziona e inquadra**, **Rinomina**, **Duplica** (stessa forma, posa e vestiti) ed **Elimina**.',
    ],
    tips: [
      'Puoi avere fino a 8 personaggi nella stessa scena.',
      'Per dare la stessa posa a due personaggi: **Posa** › **Copia su…**.',
      { t: 'Riusa i tuoi personaggi: nel menu [more] di una riga scegli **Salva personaggio…** o **Salva posa…**; [book] **Personaggi salvati** li inserisce di nuovo, con vestiti, capelli, viso e posa.', when: hasProjects },
    ],
    go: { tool: 'people' }, context: ['people'], related: ['posa-intera', 'corpo'],
  },

  {
    id: 'animali', chapter: 'personaggi', icon: 'paw', title: 'Aggiungere e posare animali',
    summary: '39 animali: domestici, selvatici, uccelli, marini, rettili e fantasy; pose pronte, parti, mantello',
    keywords: 'animali animale cane gatto cavallo mucca maiale pecora capra cervo orso elefante giraffa gorilla canguro domestici fattoria selvatici esotici zampe coda mantello taglia cucciolo uccelli corvo aquila gufo pappagallo gallina marini squalo delfino rettili serpente coccodrillo tartaruga fantasy drago unicorno grifone pegaso ali',
    where: ['Personaggi', 'Animali'],
    when: (e) => e.tool('animals'),
    steps: [
      'Apri **Personaggi** › **Animali** e scegli un gruppo: **Domestici**, **Fattoria**, **Selvatici**, **Esotici**, **Uccelli**, **Marini**, **Rettili**, **Fantasy** (o **Tutti**).',
      'Tocca un animale: compare accanto al personaggio.',
      'In **Pose pronte** scegli una posa (per esempio In piedi, Cammina, Seduto, Sdraiato, Dorme); **Specchia**, **Azzera** e **A terra** la completano.',
      'Per posarlo a mano tocca una parte sull\'animale (testa, zampe, coda…) o sceglila in **Parti del corpo**, poi regola i cursori; **Azzera parte** la riporta a riposo.',
      '**Mantello e taglia**: colori del manto, **Colore libero**, **Taglia** ed **Età** (da cucciolo ad adulto). **Bocca aperta** apre il muso.',
      'Trascina l\'animale per spostarlo; l\'anello arancione, o il cursore **Rotazione**, lo gira. In alto: [zoom] inquadra, [copy] duplica, [trash] elimina.',
    ],
    tips: ['Tocca un animale nella vista per riaprire le sue impostazioni.', 'Uccelli e draghi: i cursori **Apertura** aprono ali e coda; **Altezza da terra** li solleva (in volo, appollaiati o in acqua per squali e delfini).', 'Con un animale selezionato, il pulsante di **zoom rapido** offre anche l\'animale intero e la sua testa.'],
    go: { tool: 'animals' }, context: ['animals'], related: ['personaggi', 'zoom-rapido'],
  },

  // ------------------------------------------------------------------ posa
  {
    id: 'posa-ruota', chapter: 'posa', icon: 'pose', art: 'rotate', title: 'Mettere in posa un personaggio',
    summary: 'Ruotare ogni articolazione con gli anelli colorati',
    keywords: 'posa ruota ruotare anelli articolazione giuntura gradi cursori parte braccio gamba testa busto limiti anatomici rotazione libera sfera',
    where: ['Posa', 'Ruota'],
    steps: [
      'Apri **Posa** e scegli la modalità [rotate] **Ruota**.',
      'Tocca la parte da muovere, per esempio l\'avambraccio: si colora e compaiono gli anelli.',
      'Trascina un anello colorato per ruotare la parte su quell\'asse; trascina la sfera al centro per una rotazione libera.',
      'Per un valore preciso usa i cursori nel pannello (in gradi). [chevronUp] [chevronDown] passano alla parte vicina, [swap] alla stessa parte dell\'altro lato.',
      '**Azzera parte** la riporta a riposo; **Copia sull\'altro lato** ripete la stessa rotazione, specchiata, sul lato opposto.',
    ],
    tips: [
      'Chiudi il pannello per posare a tutto schermo: anelli e selezione restano attivi.',
      'In **Opzioni**, **Limiti anatomici** impedisce pieghe impossibili: spegnilo solo per pose estreme.',
      'Con **Mostra articolazioni** (in **Opzioni**) compare un punto toccabile su ogni giuntura.',
      { t: '**Colonna morbida** (in **Opzioni**): ruotando busto, addome o collo la schiena curva tutta insieme, senza angoli.', when: hasSoftSpine },
    ],
    go: { tool: 'pose', mode: 'rotate' }, context: ['pose:rotate', 'pose'], related: ['tocco-diretto', 'trascina', 'linea', 'zoom-rapido'],
  },
  {
    id: 'tocco-diretto', chapter: 'posa', icon: 'tap', art: 'tap', title: 'Tocco diretto: trascinare il corpo',
    summary: 'Trascina col dito mani, piedi, braccia, gambe e testa',
    keywords: 'tocco diretto trascinare dito corpo mano piede braccio avambraccio gamba coscia testa bacino fianchi accovacciare dita piegare touch arto',
    when: hasDirect,
    steps: [
      'Con il pannello chiuso, oppure con **Posa** o **Mani** aperti, appoggia il dito su una parte del corpo e trascinalo: la parte segue il dito.',
      'Mano o piede: si spostano e braccio o gamba li seguono; il piede d\'appoggio resta a terra.',
      'Braccio, avambraccio, coscia, gamba, busto, collo: ruotano entro i limiti anatomici. La testa guarda verso dove la porti.',
      'Fianchi: abbassali per accovacciare o far sedere il personaggio, i piedi restano dove sono.',
      'Un dito della mano: trascinalo per piegarlo (in **Mani** o da vicino; con tutto il corpo inquadrato le dita spostano la mano intera).',
      'Dopo un trascinamento la parte resta selezionata con gli anelli sbiaditi: puoi subito trascinare un\'altra parte. Tocca la parte per usare i suoi anelli.',
    ],
    tips: [
      'Ogni trascinamento è un passo: [undo] Annulla lo toglie.',
      'Due dita, anche partendo dal corpo, muovono la vista; un dito sullo sfondo la fa girare.',
      'Appoggia il dito e tiralo quando vuoi: un piccolo cerchio che si riempie avvisa che sta per partire la pressione lunga (sposta il personaggio). Se il dito trema un poco su una mano, un piede o la testa resta un trascinamento.',
      'Per spegnerlo: **Posa** › **Opzioni** › **Tocco diretto**, oppure [menu] › **Impostazioni** › **Tocco diretto**.',
      'In **Sposta** il dito sposta il personaggio invece di posarlo; in **Linea** disegna la linea d\'azione.',
    ],
    go: { tool: 'pose', mode: 'rotate' }, related: ['menu-mano', 'contatti', 'posa-ruota'],
  },
  {
    id: 'menu-mano', chapter: 'posa', icon: 'hand', title: 'Il menu della mano e del piede',
    summary: 'Pugno, mano aperta, raggiungere un punto, appoggiare',
    keywords: 'menu mano piede pugno aperta afferra indica rilassata raggiungere tocca un punto fissa superficie libera appoggia a terra',
    when: hasTouchMenu,
    steps: [
      'Con il pannello chiuso, oppure con **Posa** aperta, tocca una mano: accanto al dito si apre il suo menu.',
      'Scegli la forma: **Pugno**, **Aperta**, **Afferra**, **Indica**, **Rilassata**.',
      '**Tocca un punto da raggiungere**, poi tocca un oggetto, il pavimento o un altro personaggio: la mano ci arriva e resta appoggiata. Per un punto basso il personaggio si accovaccia; se è troppo lontano la posa non cambia e **Avvicina** lo porta lì vicino.',
      '**Fissa a superficie** blocca la mano dov\'è; **Libera contatto** la lascia andare.',
      'Toccando un piede: **Appoggia a terra** lo posa piatto su quello che ha sotto, **Tocca un punto** lo porta su un gradino o una sedia, **Libera** lo stacca.',
    ],
    tips: ['Il menu non copre la scena (in orizzontale si apre accanto alla mano): tocca la vista per chiuderlo. Indietro annulla un «Tocca un punto» in attesa.'],
    go: { tool: 'pose', mode: 'rotate' }, related: ['contatti', 'tocco-diretto', 'mani'],
  },
  {
    id: 'contatti', chapter: 'posa', icon: 'lock', title: 'Mani e piedi appoggiati (contatti)',
    summary: 'Una mano sul tavolo o sulla spalla di qualcuno, che resta lì',
    keywords: 'contatti contatto appoggiare appoggiata mano tavolo spalla piede gradino sedia fissare mantieni il contatto libera spostare corpo',
    when: hasContacts,
    steps: [
      'Dal menu della mano o del piede: **Tocca un punto da raggiungere** (poi tocca la superficie) oppure **Fissa a superficie**.',
      'Il palmo o la pianta si appoggiano sulla superficie e compare un anellino: turchese su un oggetto o sul pavimento, arancione su un personaggio.',
      'Ora muovi il corpo, i fianchi o tutto il personaggio: la mano resta appoggiata e il braccio la segue.',
      'Su un oggetto la mano lo segue quando lo sposti; sulla spalla di un altro personaggio segue lui.',
      'In **Posa** la sezione **Contatti** elenca mani e piedi appoggiati: **Libera** ne stacca uno.',
    ],
    tips: [
      'Con **Mantieni il contatto** spento (in **Posa** › **Opzioni**) i contatti restano salvati ma non trattengono la mano.',
      'Una posa pronta, **Azzera posa** o **Specchia posa** lasciano andare i contatti.',
      'Spostando lontano un personaggio, la mano che non arriva più viene lasciata e compare un avviso.',
    ],
    related: ['menu-mano', 'tocco-diretto', 'sposta-premendo'],
  },
  {
    id: 'trascina', chapter: 'posa', icon: 'tap', title: 'Trascinare mani e piedi',
    summary: 'Modalità Trascina: braccia e gambe seguono da sole',
    keywords: 'trascina ik cinematica inversa maniglie mani piedi sguardo bacino accovacciare sedere piedi fissi raggiungere',
    where: ['Posa', 'Trascina'],
    steps: [
      'In **Posa** scegli [tap] **Trascina**.',
      'Compaiono le maniglie: viola per le mani, turchese per i piedi, gialla per lo sguardo, arancione per il bacino.',
      'Trascina una mano o un piede dove vuoi: braccio e gamba seguono in modo naturale.',
      'Trascina la maniglia gialla per far girare testa e sguardo verso un punto.',
      'Con **Piedi fissi** acceso, abbassa il bacino per accovacciare o far sedere il personaggio: i piedi restano dove sono.',
    ],
    tips: [
      'Per rifinire una singola articolazione torna a **Ruota**.',
      { t: 'Con **Tocco diretto** trascini mani e piedi anche senza maniglie, direttamente sul corpo.', when: hasDirect },
    ],
    go: { tool: 'pose', mode: 'ik' }, context: ['pose:ik'], related: ['posa-ruota', 'tocco-diretto', 'sposta'],
  },
  {
    id: 'linea', chapter: 'posa', icon: 'edit', art: 'line', title: 'Disegnare la linea d\'azione',
    summary: 'Una curva col dito e il corpo la segue',
    keywords: 'linea d\'azione linea azione curva disegnare dito schiena colonna c s dinamica gesto fluida morbida rigida dinamismo',
    where: ['Posa', 'Linea'],
    when: hasLine,
    steps: [
      'In **Posa** scegli [edit] **Linea**.',
      'Disegna con un dito una curva sopra il personaggio: dal bacino alla testa piega la schiena a C, a S o dritta.',
      'Una curva da un piede a una mano coinvolge anche quella gamba e quel braccio.',
      'Nella vista la traccia lilla è la tua linea, quella arancione la linea del corpo ottenuta.',
      { t: 'Regola **Curva** (sotto 100% raddrizza, sopra accentua) e **Dinamismo** (esagera o attenua tutta la posa). **Nascondi traccia** toglie le linee.', when: hasAdjust },
    ],
    tips: [
      'Per girare la vista in questa modalità trascina con un dito fuori dal personaggio.',
      { t: '**Colonna morbida** fa curvare schiena e collo insieme; **Il bacino compensa** tiene i piedi a terra mentre la schiena si piega.', when: hasSoftSpine },
      'Ogni linea disegnata è un passo: se non ti piace, [undo] Annulla.',
    ],
    go: { tool: 'pose', mode: 'line' }, context: ['pose:line'], related: ['pose-pronte', 'posa-ruota'],
  },
  {
    id: 'sposta', chapter: 'posa', icon: 'move', title: 'Spostare e girare il personaggio',
    summary: 'Modalità Sposta: posizione, rotazione, altezza da terra',
    keywords: 'sposta spostare muovere posizione ruotare girare pomello anello terra altezza saltare appoggia a terra pavimento',
    where: ['Posa', 'Sposta'],
    steps: [
      'In **Posa** scegli [move] **Sposta**.',
      'Trascina l\'anello a terra, o il personaggio stesso, per spostarlo sul pavimento.',
      'Trascina il pomello sull\'anello per girarlo su se stesso, oppure usa il cursore **Rotazione**.',
      '**Altezza da terra** lo solleva (salti, tuffi); **Appoggia a terra** lo riporta giù con i piedi sul pavimento.',
    ],
    tips: [{ t: 'Più veloce, senza aprire nulla: tieni premuto il personaggio e fallo scorrere.', when: hasCarry }],
    go: { tool: 'pose', mode: 'move' }, context: ['pose:move'], related: ['sposta-premendo', 'personaggi', 'trascina'],
  },
  {
    id: 'sposta-premendo', chapter: 'posa', icon: 'move', title: 'Spostare un personaggio tenendolo premuto',
    summary: 'Pressione lunga e trascina: il personaggio scivola nella scena',
    keywords: 'pressione lunga tieni premuto spostare trascinare personaggio scivolare ruotare girare due dita menu duplica specchia elimina primo piano',
    when: hasCarry,
    steps: [
      'Tieni il dito fermo su un personaggio per un attimo: si solleva un poco e un cerchio tratteggiato segna il suo posto.',
      'Senza alzare il dito, fallo scorrere: segue il terreno e si ferma contro mobili, pareti e altri personaggi (non passa dall\'altra parte).',
      'Appoggia un secondo dito e giralo: il personaggio ruota su se stesso.',
      'Alza il dito per lasciarlo lì. È un solo passo: [undo] Annulla lo riporta dov\'era.',
      'Se alzi il dito senza muoverlo si apre un menu: **Seleziona e posa**, **Duplica**, **Specchia posa**, **Appoggia a terra**, **Ruota di 45°**, **Primo piano**, **Elimina**.',
    ],
    tips: ['Gli oggetti che ha in mano vengono con lui, e così i piedi appoggiati a terra; le mani appoggiate su altro restano dove sono.'],
    related: ['sposta', 'contatti', 'azioni-oggetti'],
  },
  {
    id: 'pose-pronte', chapter: 'posa', icon: 'people', art: 'poses', title: 'Partire da una posa pronta',
    summary: 'Camminata, corsa, combattimento, seduti… in un tocco',
    keywords: 'pose pronte preset libreria camminata corsa salto combattimento seduto sedia a terra sdraiato gesti specchia dinamismo naturalezza asimmetrie le mie pose salvate',
    where: ['Posa', 'Pose pronte'],
    steps: [
      'Seleziona il personaggio, poi apri **Posa** › **Pose pronte**.',
      'Scegli una categoria: **In piedi**, **Azione**, **Combattimento**, **Seduti**, **A terra**, **Gesti**.',
      'Tocca una miniatura: la posa si applica al personaggio selezionato, con i piedi a terra.',
      'Accendi **Specchia** prima di toccare per avere la versione speculare.',
      { t: 'Apri **Regola: Dinamismo · Naturalezza**: **Dinamismo** esagera o attenua tutta la posa, **Naturalezza** aggiunge piccole asimmetrie, diverse per ogni personaggio.', when: hasAdjust },
    ],
    tips: [
      'Una posa pronta è un punto di partenza: rifiniscila con **Ruota**, **Trascina** o **Linea**.',
      { t: 'Le tue pose: salvale con **Posa intera** › **Salva posa…**; poi in **Pose pronte** › **Le mie pose** tocca una posa per darla al personaggio selezionato.', when: hasMyPoses },
      { t: 'Una tua posa da riusare: [menu] › **Salva in…** › **Posa**; poi in **Progetti** toccala e scegli **Applica posa** (va sul personaggio selezionato).', when: (e) => hasProjects(e) && !hasMyPoses(e) },
      'Le pose sedute si appoggiano all\'altezza di una sedia: aggiungine una da **Scena** › **Oggetti**.',
    ],
    go: { tool: 'poselib' }, context: ['poselib'], related: ['linea', 'posa-intera'],
  },
  {
    id: 'posa-intera', chapter: 'posa', icon: 'mirror', title: 'Specchiare, copiare o azzerare la posa',
    summary: 'Specchia posa, Copia su…, Salva posa…, Azzera posa e opzioni',
    keywords: 'specchia specchiare copia copiare altro personaggio azzera azzerare reset salva posa le mie pose riusare opzioni limiti colonna morbida bacino piedi fissi articolazioni',
    where: ['Posa', 'Posa intera'],
    steps: [
      'Apri **Posa** e scorri fino a **Posa intera**.',
      '**Specchia posa** scambia il lato destro con il sinistro.',
      '**Copia su…** copia la posa su un altro personaggio, o su tutti.',
      '**Azzera posa** riporta tutte le articolazioni alla posizione di partenza: l\'avviso che compare ha **Annulla**.',
      { t: '**Salva posa…** conserva la posa in **Progetti** (nome, progetto e sezione): la ritrovi in **Pose pronte** › **Le mie pose**.', when: hasMyPoses },
      'In **Opzioni** trovi **Limiti anatomici**, **Piedi fissi** e **Mostra articolazioni**.',
    ],
    go: { tool: 'pose', mode: 'rotate' }, related: ['posa-ruota', 'personaggi'],
  },
  {
    id: 'mani', chapter: 'posa', icon: 'hand', title: 'Mettere in posa le mani',
    summary: 'Pose della mano, dita una per una, polso',
    keywords: 'mani mano dita dito pugno indicare presa pinza pollice polso falange allarga opposizione inquadra la mano copia',
    where: ['Posa', 'Mani'],
    steps: [
      'Apri **Posa** › **Mani** e scegli **Destra**, **Sinistra** o **Entrambe**.',
      'Tocca una posa della mano: **Pugno**, **Indicare**, **Presa cilindrica**, **Pinza**…',
      'Rifinisci con i cursori **Dita** (uno per dito), **Allarga dita** e **Opposizione pollice**; **Piega polso** muove il polso.',
      'Per un solo dito: toccalo nella vista e ruotalo con gli anelli.',
      '**Inquadra la mano** avvicina la camera alla mano; **Figura intera** torna a tutto il personaggio.',
      '**Mano rilassata** la riporta a riposo; **Copia sull\'altra mano** la ripete sull\'altra.',
    ],
    tips: ['Per tenere un oggetto (tazza, spada, telefono…) vedi «Mettere un oggetto in mano»: le dita si chiudono da sole.'],
    go: { tool: 'hands' }, context: ['hands'], related: ['zoom-rapido', 'in-mano'],
  },
  {
    id: 'viso', chapter: 'posa', icon: 'face', title: 'Espressioni e sguardo',
    summary: 'Sorriso, rabbia, sorpresa… e dove guarda',
    keywords: 'viso faccia espressione sorriso rabbia triste sorpresa occhiolino intensità sguardo occhi guarda camera punto sopracciglia ciglia colore occhi primo piano ritocchi',
    where: ['Posa', 'Viso'],
    steps: [
      'Apri **Posa** › **Viso**; **Primo piano** porta la camera sul volto, **Figura intera** la riporta indietro.',
      'Tocca un\'espressione e regola **Intensità**. **Inverti lati** scambia i lati delle espressioni asimmetriche (come **Occhiolino**); **Neutro** la toglie.',
      '**Sguardo**: trascina l\'iride nel riquadro per orientare gli occhi; **Guarda la camera** fa guardare verso di te.',
      '**Guarda un punto**: poi tocca nella scena cosa guardare, per esempio il viso di un altro personaggio. **Centra** riporta lo sguardo dritto.',
      '**Ritocchi** regola i singoli movimenti del viso; più sotto scegli sopracciglia, ciglia e colore degli occhi.',
    ],
    go: { tool: 'face' }, context: ['face'], related: ['zoom-rapido', 'capelli'],
  },

  // ------------------------------------------------------------------ inquadrare
  {
    id: 'zoom-rapido', chapter: 'inquadrare', icon: 'zoom', art: 'zoom', title: 'Inquadrare la mano (zoom rapido)',
    summary: 'Primo piano al volo su testa, mani, piedi o la parte selezionata',
    keywords: 'zoom rapido primo piano inquadrare mano testa piede lente lentina dettaglio avvicinare torna alla vista indietro corpo intero',
    steps: [
      'Tocca [zoom] **Zoom rapido**, il tasto tondo in basso a destra della vista.',
      'Scegli **Testa**, **Mano sinistra**, **Mano destra**, **Piede sinistro**, **Piede destro** o **Corpo intero**. Se hai selezionato una parte, in fondo al menu c\'è anche lei.',
      'Ancora più veloce: seleziona una parte e tocca la piccola lente [zoom] che compare accanto.',
      'Nel primo piano puoi continuare a posare e a girare la vista: l\'inquadratura segue la parte anche quando si muove. Trascina il corpo per posarlo, lo sfondo per girare la vista; con [orbit] **Ruota la vista** ogni trascinamento gira la vista.',
      'Tocca [focusBack] **Torna alla vista**, o il tasto Indietro, per tornare all\'inquadratura di prima.',
    ],
    tips: [
      'Lo zoom rapido cambia solo la vista: non modifica la scena e non entra in **Annulla**.',
      'In **Mani** e **Viso** trovi anche **Inquadra la mano** e **Primo piano**.',
    ],
    go: { spot: 'zoom' }, context: ['focus'], related: ['mani', 'viso', 'vista'],
  },
  {
    id: 'scorciatoie', chapter: 'inquadrare', icon: 'frameAll', title: 'Centra personaggi e Cambia ambiente',
    summary: 'I pulsanti rotondi sopra lo zoom rapido',
    keywords: 'scorciatoie centra personaggi inquadra tutti cambia ambiente stanza paesaggio studio vuoto pulsanti rotondi',
    when: hasShortcuts,
    steps: [
      'Sopra [zoom] lo zoom rapido, in basso a destra, ci sono due pulsanti rotondi.',
      '[frameAll] **Centra personaggi** inquadra tutti i personaggi visibili (e lascia un primo piano).',
      { t: '[landscape] **Cambia ambiente** apre un menu: gli ultimi usati, **Studio vuoto**, le **Stanze** e gli **Altri ambienti** (**Città**, **Natura**, **Fantasy**). Toccane uno per costruirlo attorno ai personaggi.', when: hasLandscapes },
      'Ogni scelta è un passo: [undo] Annulla torna a prima.',
    ],
    tips: ['Quando lo spazio è poco i pulsanti si mettono in fila accanto allo zoom rapido, o si nascondono.'],
    go: { spot: 'fabs' }, related: ['zoom-rapido', 'paesaggi', 'vista'],
  },

  // ------------------------------------------------------------------ aspetto
  {
    id: 'corpo', chapter: 'aspetto', icon: 'body', title: 'Corporatura, pelle e proporzioni',
    summary: 'Donna o uomo, magra, normale o curvy, e tutte le misure',
    keywords: 'corpo corporatura sesso donna uomo magra normale curvy pelle occhi proporzioni altezza gambe eroiche testa collo forme peso muscoli spalle vita fianchi definizione muscolare anatomia',
    where: ['Aspetto', 'Corpo'],
    steps: [
      'Apri **Aspetto** › **Corpo**.',
      '**Sesso** e **Corporatura** (Magra, Normale, Curvy) cambiano la base del corpo.',
      '**Pelle**: tocca una tinta. **Occhi**: il colore dell\'iride.',
      { t: '**Anatomia** › **Definizione muscolare**: quanto si vedono muscoli e ossa sotto la pelle (pettorali, addominali, ginocchia…).', when: (e) => e.characterHas('definition') },
      '**Proporzioni** (Altezza, Gambe lunghe, Proporzioni eroiche, Testa, Collo) e **Forme** (Peso, Muscoli, Spalle, Vita, Fianchi…): trascina i cursori.',
      'Doppio tocco su un cursore per azzerarlo; **Azzera regolazioni** li riporta tutti a zero.',
    ],
    tips: ['**Proporzioni eroiche** allunga il corpo come nei canoni del fumetto.'],
    go: { tool: 'body' }, context: ['body'], related: ['vestiti', 'capelli'],
  },
  {
    id: 'vestiti', chapter: 'aspetto', icon: 'shirt', title: 'Vestire il personaggio',
    summary: 'Outfit pronti, capi singoli, colori, vestibilità e pieghe',
    keywords: 'vestiti abiti capi outfit maglietta t-shirt jeans pantaloni gonna vestito scarpe giacca camicia felpa colore vestibilità aderente largo pieghe togliere skinny slim regolare comodo oversize taglio',
    where: ['Aspetto', 'Vestiti'],
    steps: [
      'Apri **Aspetto** › **Vestiti**.',
      'Per un look completo tocca uno degli **Outfit rapidi**: Casual, Formale, Sport/Action, Street, Solo intimo.',
      'Oppure, in **Aggiungi capi**, scegli una categoria (Sopra, Sotto, Interi, Scarpe, Calze e intimo) e tocca un capo: prende il posto di quello dello stesso tipo.',
      'Tocca un capo in **Indossati** per cambiarne colore, **Vestibilità** e **Pieghe**, o per toglierlo con **Togli**. La **Vestibilità** va da **Aderente** a **Largo** passando per **Slim**, **Normale** e **Comodo**: i jeans diventano skinny, slim, dritti, comodi o larghi; magliette e felpe passano da attillate a oversize.',
      '**Pieghe (tutti i capi)** regola le pieghe di tutto l\'outfit; **Togli tutto** toglie tutti i capi.',
    ],
    tips: [
      'Le pieghe seguono la posa: piega un braccio e la manica si raggrinzisce.',
      'I capi seguono le forme del corpo: appoggiano su spalle e fianchi e scendono dritti sotto il seno, la pancia e i glutei, come la stoffa vera; con **Largo** cadono più morbidi e fanno più pieghe.',
    ],
    go: { tool: 'clothes' }, context: ['clothes'], related: ['capelli', 'corpo'],
  },
  {
    id: 'capelli', chapter: 'aspetto', icon: 'hair', title: 'Capelli e barba',
    summary: 'Acconciature, colori naturali o da fumetto, barba e baffi',
    keywords: 'capelli acconciatura taglio colore lunghezza volume riga frangia barba baffi pizzetto coda chignon treccia ricci afro biondo castano fumetto',
    where: ['Aspetto', 'Capelli'],
    steps: [
      'Apri **Aspetto** › **Capelli**.',
      'Tocca un\'**Acconciatura**: da Rasato a Lunghi mossi, Coda di cavallo, Chignon, Treccia…',
      '**Colore**: tinte naturali o, sotto **Fumetto**, colori accesi come blu, rosa e viola; l\'ultimo pallino apre un colore a scelta.',
      '**Lunghezza**, **Volume**, **Riga** e **Frangia** rifiniscono il taglio.',
      '**Barba e baffi**: Barba corta, Barba piena, Pizzetto, Baffi.',
    ],
    tips: ['Sopracciglia e ciglia prendono da sole il colore dei capelli.'],
    go: { tool: 'hair' }, context: ['hair'], related: ['viso', 'vestiti'],
  },

  // ------------------------------------------------------------------ scena
  {
    id: 'luci', chapter: 'scena', icon: 'sun', title: 'Illuminare la scena',
    summary: 'Preset di luce, luci da spostare, colore e ombre',
    keywords: 'luci luce illuminazione preset studio rembrandt controluce tramonto notte horror sole faretto lampadina intensità temperatura colore gelatina ombre morbide ambiente maniglie',
    where: ['Scena', 'Luci'],
    steps: [
      'Apri **Scena** › **Luci** e tocca un **Preset**: Studio 3 punti, Rembrandt, Controluce, Tramonto caldo, Notte / luna…',
      'Tocca una luce in **Luci della scena** per regolarla; [plus] **Luce** ne aggiunge un\'altra.',
      'Spostala trascinando il punto luminoso sulla sfera, oppure la sua maniglia nella vista. **Davanti** / **Dietro** la porta davanti o dietro al personaggio.',
      'Scegli il tipo (**Sole**, **Faretto**, **Lampadina**), poi **Intensità**, **Temperatura colore** o una gelatina colorata.',
      '**Ombre**: accendile o spegnile e decidi quanto sono morbide. **Posizione precisa** dà Azimut ed Elevazione in gradi.',
      '**Ambiente (riempimento)** schiarisce le zone in ombra.',
    ],
    tips: [
      '**Punta sul personaggio** riorienta le luci sul soggetto selezionato.',
      'Spegni **Maniglie delle luci nella vista** per una vista pulita.',
    ],
    go: { tool: 'lights' }, context: ['lights'], related: ['luci-scena', 'luce-ambientale', 'stili'],
  },
  {
    id: 'luci-scena', chapter: 'scena', icon: 'bulb', title: 'Lampade, candele e finestre che illuminano',
    summary: 'Le luci degli oggetti della scena fanno luce davvero',
    keywords: 'lampade lampada candele candela abat-jour lampione schermo tv falò camino finestra luce dalla finestra accendi spegni accesa intensità colore solo questa giorno tramonto notte chiusa auto fonti nella scena',
    when: hasPracticals,
    steps: [
      'Lampade, candele, schermi, lampioni, falò e finestre della scena illuminano davvero i personaggi.',
      'Tieni premuta una lampada: il menu si apre accanto e in cima trovi **Accesa** e **Intensità**; **Colore…** apre i colori della luce (**Originale** torna al suo). Le altre azioni sono in **Azioni…**.',
      '**Accendi solo questa** lascia la scena alla lampada (lo studio resta un riempimento debole); **Combina con la luce di studio** le somma.',
      'Tieni premuta una finestra (o la finestra di una stanza): in **Luce dalla finestra** scegli **Auto**, **Giorno**, **Tramonto**, **Notte** o **Chiusa** e regola l\'intensità; **Solo la luce della finestra** spegne il resto.',
      'In **Scena** › **Luci** la sezione **Fonti nella scena** elenca lampade e finestre, con interruttore e intensità.',
    ],
    tips: [
      'In **Auto** la finestra segue l\'ora del paesaggio o della luce ambientale.',
      'Con tante lampade accese le più lontane si limitano a brillare, per tenere fluida la scena: il loro menu lo dice («Troppe luci accese…»).',
    ],
    go: { tool: 'lights' }, related: ['luce-ambientale', 'luci', 'azioni-oggetti'],
  },
  {
    id: 'luce-ambientale', chapter: 'scena', icon: 'sun', title: 'Luce ambientale',
    summary: 'Tieni premuto uno spazio vuoto: giorno, tramonto, notte',
    keywords: 'luce ambientale ambiente giorno tramonto notte studio calda fredda intensità solo luci della scena pressione lunga pavimento cielo spazio vuoto',
    when: hasPracticals,
    steps: [
      'Tieni premuto uno spazio vuoto della vista: il pavimento, il cielo, il pavimento di una stanza.',
      'Nel menu **Luce ambientale** scegli **Giorno**, **Tramonto**, **Notte** o **Studio**: con un paesaggio cambia la sua ora, altrimenti la luce di studio.',
      'Regola **Intensità** e **Calda · Fredda**.',
      '**Solo luci della scena** lascia accese solo lampade e finestre (lo studio resta un riempimento debole).',
    ],
    tips: [
      'Le finestre seguono la scelta, anche quelle impostate a mano; quelle chiuse restano chiuse.',
      'Su una parete di una stanza: tieni premuto e scegli **Luce ambientale…** in fondo al menu.',
      'Ogni scelta è un passo: [undo] Annulla torna alla luce di prima. **Pannello Luci** apre **Scena** › **Luci**.',
    ],
    related: ['luci-scena', 'luci', 'paesaggi'],
  },
  {
    id: 'oggetti', chapter: 'scena', icon: 'cube', title: 'Aggiungere oggetti e stanze',
    summary: 'Sedie, tavoli, armadi, stanze arredate pronte',
    keywords: 'oggetti oggetto oggetti di scena sedia tavolo divano letto armadio cucina bagno lampada pianta stanza stanze pronte soggiorno aula bar cercare preferiti rigenera varianti scala colore',
    where: ['Scena', 'Oggetti'],
    steps: [
      'Apri **Scena** › **Oggetti**: cerca per nome (es. «sedia», «lampada») oppure sfoglia le categorie.',
      'Tocca un oggetto per aggiungerlo vicino al personaggio selezionato.',
      'Trascina l\'oggetto per spostarlo, l\'anello per ruotarlo, la freccia per alzarlo. Nel pannello trovi anche **Rotazione**, **Altezza da terra**, **Appoggia a terra**, **Inclinazione**, **Scala** e colore.',
      'In alto: [copy] duplica, [trash] elimina, [check] fine. Più tardi, tocca l\'oggetto nella vista per modificarlo di nuovo.',
      '★ lo aggiunge ai preferiti; il simbolo ⚙ indica un oggetto con misure modificabili, ∞ uno con varianti casuali (**Rigenera**).',
      '**Stanze pronte**: soggiorno, cucina, aula, bar… ogni mobile resta un oggetto; **Muovi tutta la stanza** li sposta insieme.',
    ],
    tips: [{ t: 'Tieni premuto un oggetto per farci qualcosa con un personaggio: sedersi, prendere, aprire…', when: hasActions }],
    go: { tool: 'props' }, context: ['props'], related: ['azioni-oggetti', 'in-mano', 'edifici'],
  },
  {
    id: 'in-mano', chapter: 'scena', icon: 'hand', title: 'Mettere un oggetto in mano',
    summary: 'Spada, tazza, telefono: le dita si chiudono da sole',
    keywords: 'in mano tenere impugnare spada bastone lancia scudo libro tazza telefono borsa ombrello bicchiere bottiglia chitarra presa stacca attacca',
    where: ['Scena', 'Oggetti', 'In mano'],
    steps: [
      'Seleziona il personaggio, poi apri **Scena** › **Oggetti** › **In mano**.',
      'Tocca un oggetto (Spada, Tazza, Telefono…): va nella mano libera e le dita si chiudono attorno.',
      'Nel pannello, sezione **Mano**: **Sinistra** / **Destra**, **Posizione presa**, **Rotazione presa**, **Presa invertita** e **Chiudi la mano**.',
      '**Stacca** lascia l\'oggetto dov\'è; **Attacca alla mano** lo rimette in mano.',
    ],
    tips: [
      'L\'oggetto segue la mano: muovi il braccio con **Ruota** o **Trascina** e l\'oggetto lo accompagna.',
      { t: 'Vasi, libri, bottiglie e attrezzi posati nella scena: tienili premuti e scegli **Prendi**.', when: hasActions },
    ],
    go: { tool: 'props' }, related: ['oggetti', 'azioni-oggetti', 'mani'],
  },
  {
    id: 'azioni-oggetti', chapter: 'scena', icon: 'chair', title: 'Azioni sugli oggetti',
    summary: 'Tieni premuto un oggetto: siediti, sdraiati, prendi, apri…',
    keywords: 'azioni oggetti pressione lunga tieni premuto siediti sedia divano letto sdraiati prendi posa a terra apri chiudi armadio frigo cassetto guarda avvicinati appoggiati inginocchiati accarezza guarda fuori finestra chi animale',
    when: hasActions,
    steps: [
      'Tieni premuto un oggetto, un mobile, un edificio o un animale: accanto al dito si apre il menu di quello che si può fare.',
      'Agisce il personaggio selezionato (o il più vicino); con più personaggi scegli chi in **Chi?**.',
      'Sedia, poltrona, panchina, muretto: **Siediti** (sul letto, dal lato più vicino). Letto o divano: **Sdraiati** › **Sulla schiena**, **Su un fianco** o **A pancia in giù**. Tavolo: Siediti al tavolo (aggiunge una sedia se serve) o **Appoggiati al piano** (sposta la sedia che c\'è davanti).',
      'Oggetti piccoli (vaso, libro, bottiglia, attrezzi): **Prendi**. Tieni premuto l\'oggetto in mano per **Posa a terra**, posarlo su un tavolo vicino o **Cambia mano**.',
      'Armadio, cassettiera, frigo, porta, portatile: **Apri** / **Chiudi**. Finestra: **Guarda fuori**. Parete, armadio, albero, auto: **Appoggiati**; piano della cucina, cassettiera: **Appoggiati al piano**.',
      'Inoltre **Guarda**, **Avvicinati**, **Inginocchiati**, e su un animale **Accarezza**. In fondo: **Sposta**, **Ruota 90°**, **Duplica**, **Elimina**, **Dettagli**.',
    ],
    tips: [
      'Ogni azione è un solo passo: [undo] Annulla la toglie tutta.',
      'Un tocco breve sull\'oggetto lo seleziona come sempre e apre il suo pannello.',
      { t: 'Su una lampada o una finestra, in cima al menu ci sono anche i comandi della luce.', when: hasPracticals },
      { t: 'Le stesse azioni a voce: «siediti sul divano», «prendi il vaso», «apri l\'armadio».', when: hasVoice },
    ],
    related: ['oggetti', 'in-mano', 'luci-scena'],
  },
  {
    id: 'edifici', chapter: 'scena', icon: 'building', title: 'Aggiungere edifici',
    summary: 'Case, palazzi, grattacieli, negozi, monumenti',
    keywords: 'edifici edificio casa palazzo grattacielo negozio bar chiesa castello torre faro capannone isolato città sfondo piani facciata usura finestre rigenera',
    where: ['Scena', 'Edifici'],
    when: (e) => e.tool('buildings'),
    steps: [
      'Apri **Scena** › **Edifici** e scegli un gruppo: Case, Palazzi, Grattacieli, Negozi e servizi, Industria, Monumenti, Isolati.',
      'Tocca uno stile: l\'edificio compare dietro al personaggio selezionato, rivolto verso di te.',
      '**Rigenera** crea una variante diversa dello stesso stile.',
      'Cambia **Forma e stile**, **Dimensioni** (piani, larghezza, profondità, scala) e **Facciata** (colore, usura, finestre illuminate).',
      'Trascina l\'edificio con un dito per spostarlo; **90°**, **Verso la camera** e **Dietro al personaggio** lo riorientano.',
    ],
    tips: ['Per vederlo intero allontana la vista con due dita, oppure scegli un obiettivo corto (24 mm) in **Camera**.'],
    go: { tool: 'buildings' }, context: ['buildings'], related: ['oggetti', 'obiettivo'],
  },

  {
    id: 'esterni', chapter: 'scena', icon: 'tree', title: 'Strade, veicoli e natura (Esterni)',
    summary: 'Incroci, parchi e boschi pronti, strade che si agganciano, auto, alberi',
    keywords: 'esterni esterno paesaggio strada strade incrocio rotonda curva marciapiede veicoli auto macchina parcheggio alberi pino natura rocce tronchi arredo urbano semaforo panchina parco bosco città kit',
    where: ['Scena', 'Esterni'],
    when: (e) => e.tool('exteriors'),
    steps: [
      'Apri **Scena** › **Esterni**: scegli **Kit pronti**, **Strade**, **Veicoli**, **Alberi**, **Natura**, **Rocce**, **Tronchi** o **Arredo urbano**, oppure cerca per nome (es. «auto», «pino», «semaforo»).',
      'Tocca un elemento: compare vicino al personaggio selezionato. Un kit pronto (Incrocio di città, Strada residenziale, Parco, Bosco) crea una scena intera in cui ogni pezzo resta modificabile.',
      'Strade: in **Collega un pezzo** tocca Rettilineo, Curva, Incrocio, Rotonda… e il pezzo si attacca all\'estremità libera. Trascinando una strada vicino a un\'altra si aggancia da sola (**Aggancio automatico**).',
      'Veicoli: **Metti sulla strada** li porta sulla corsia più vicina; ci sono anche **Parcheggia** e **Inverti senso**.',
      '**Rigenera** crea una variante; poi **Forma e stile**, **Dimensioni** e colore. Trascina con un dito per spostare; **Rotazione**, **90°** e **Verso la camera** lo girano.',
    ],
    tips: [
      '**Personaggio sopra** appoggia il personaggio selezionato sulla superficie (marciapiede, roccia, tronco…).',
      'Con **Muovi tutto il kit** trascini o ruoti un kit intero.',
    ],
    go: { tool: 'exteriors' }, context: ['exteriors'], related: ['paesaggi', 'edifici', 'oggetti'],
  },

  {
    id: 'paesaggi', chapter: 'scena', icon: 'landscape', title: 'Paesaggi pronti',
    summary: 'Un ambiente completo intorno ai personaggi in un tocco: città, natura, fantasy, stanze',
    keywords: 'paesaggio paesaggi sfondo ambiente ambientazione cielo meteo pioggia neve nebbia stagione ora alba tramonto sera notte città strada incrocio grattacieli vicolo tetto piazza quartiere parcheggio porto bosco pineta foresta montagna deserto spiaggia mare lago prato giungla fattoria campagna villaggio medievale rovine castello stanza soggiorno cucina genera rigenera svuota salva',
    where: ['Scena', 'Paesaggi'],
    when: (e) => e.tool('landscapes'),
    steps: [
      'Apri **Scena** › **Paesaggi** e scegli un gruppo: **Città**, **Natura**, **Fantasy** o **Stanze**.',
      'Tocca un paesaggio: viene creato intorno ai personaggi, con cielo, luce del sole, terreno e oggetti, e la camera li inquadra con il paesaggio alle spalle. Ogni volta è diverso.',
      'Sotto le schede scegli **Ora del giorno**, **Meteo** e **Stagione**: con un paesaggio già creato cambiano solo luce, cielo e atmosfera, gli oggetti restano dove sono. **Auto** lascia la scelta al caso.',
      '**Genera nuovo** crea un\'altra variante dello stesso paesaggio; **Rigenera** ripete la stessa richiesta con un risultato nuovo; **Svuota** toglie il paesaggio e tutti i suoi oggetti.',
      'Ogni oggetto del paesaggio resta modificabile: toccalo per spostarlo, cambiarlo o eliminarlo con **Oggetti**, **Edifici**, **Esterni** o **Animali**.',
      { t: '**Salva** apre **Salva in…**: scegli nome, progetto e sezione. Si salva solo l\'ambiente, senza i personaggi; per riusarlo: [menu] › **Progetti**, tocca il paesaggio › **Applica paesaggio**.', when: hasProjects },
    ],
    tips: [
      '**Quantità di oggetti** (**Poca**, **Media**, **Tanta**) vale dal prossimo **Genera nuovo**.',
      'Con [undo] **Annulla** torni al paesaggio precedente o alla scena senza paesaggio.',
      'Nello stile **Linee** il cielo diventa carta bianca: restano i contorni di personaggi e oggetti.',
      { t: 'Anche a voce: «crea una spiaggia al tramonto»; con un paesaggio già creato «metti la pioggia» o «fai notte».', when: hasVoice },
    ],
    go: { tool: 'landscapes' }, context: ['landscapes'], related: ['esterni', 'edifici', 'luci', 'progetti'],
  },

  // ------------------------------------------------------------------ camera
  {
    id: 'obiettivo', chapter: 'camera', icon: 'aperture', title: 'Scegliere l\'obiettivo',
    summary: 'Lunghezza focale da 14 a 200 mm, dolly zoom',
    keywords: 'obiettivo focale lunghezza focale mm grandangolo teleobiettivo prospettiva scorcio deformazione dolly zoom mantieni inquadratura',
    where: ['Camera', 'Camera'],
    steps: [
      'Apri **Camera**: in **Obiettivo** tocca una focale (14, 24, 35, 50, 85, 135, 200 mm) o usa il cursore.',
      'Corta (14–24 mm): prospettiva forte, scorci drammatici. 50 mm: vista naturale. Lunga (85–135 mm): volti e figure senza deformazioni.',
      'Con **Mantieni inquadratura** la camera si avvicina o si allontana per tenere il soggetto della stessa grandezza (effetto dolly zoom).',
    ],
    go: { tool: 'camera' }, context: ['camera'], related: ['punto-focale', 'guide'],
  },
  {
    id: 'punto-focale', chapter: 'camera', icon: 'target', title: 'Punto focale, angolazioni e viste',
    summary: 'Cosa sta al centro, da dove guardi, viste da richiamare',
    keywords: 'punto focale centro centra angolazione dal basso dall\'alto zenitale frontale tre quarti 3/4 profilo retro olandese inclinazione viste salvate slot',
    where: ['Camera', 'Camera'],
    steps: [
      'Tocca **Punto focale**, poi tocca nella scena il punto da mettere al centro (Indietro annulla).',
      '**Centra sul personaggio** inquadra il personaggio selezionato.',
      '**Angolazione**: Altezza occhi, Dal basso, Dall\'alto, Zenitale, Frontale, 3/4, Profilo, Retro, sempre riferite al personaggio selezionato.',
      '**Inclinazione (olandese)** inclina l\'orizzonte per scene tese o dinamiche.',
      '**Viste salvate**: tocca uno slot vuoto per salvare la vista, tocca una vista per richiamarla, tienila premuta per sovrascriverla.',
    ],
    go: { tool: 'camera' }, related: ['obiettivo', 'zoom-rapido'],
  },
  {
    id: 'guide', chapter: 'camera', icon: 'perspective', title: 'Guide prospettiche e vignetta',
    summary: 'Punti di fuga, orizzonte, regola dei terzi, formato della vignetta',
    keywords: 'guide prospettiche prospettiva punti di fuga 1 2 3 punti orizzonte griglia allinea densità colori opacità terzi vignetta formato 16:9 9:16 4:3 1:1 composizione',
    where: ['Camera', 'Guide'],
    steps: [
      'Apri **Camera** › **Guide** e accendi **Mostra guide**.',
      '**Prospettiva**: 1, 2 o 3 punti di fuga, calcolati dalla camera.',
      '**Linea d\'orizzonte**; **Rotazione griglia**, **Allinea al personaggio** o **Allinea alla vista** orientano le linee.',
      '**Densità linee**, **Colori per asse** e **Opacità** cambiano l\'aspetto delle linee.',
      '**Composizione**: **Regola dei terzi** e **Vignetta** (1:1, 4:3, 3:2, 16:9, 2:1, 9:16, 3:4).',
    ],
    tips: ['Esportando l\'immagine puoi ritagliarla alla vignetta e includere le guide.'],
    go: { tool: 'guides' }, context: ['guides'], related: ['obiettivo', 'esportare'],
  },

  // ------------------------------------------------------------------ stile
  {
    id: 'stili', chapter: 'stile', icon: 'palette', title: 'Stili di resa',
    summary: 'Realistico, Manichino, Fumetto, Linee; china, sfondo, qualità',
    keywords: 'stile resa realistico manichino clay fumetto toon linee china contorni inchiostro sfondo trasparente carta pavimento griglia ombre esposizione occlusione qualità prestazioni fps',
    where: ['Stile'],
    steps: [
      'Apri **Stile** e scegli lo **Stile di resa**: **Realistico**, **Manichino** (volumi e luci senza distrazioni), **Fumetto**, **Linee**.',
      '**Contorni a china**: spessore della linea, **Linee interne (pieghe)** e colore della china.',
      { t: '**Linee anatomiche** (con Fumetto o Linee e i contorni accesi): segna i solchi di muscoli e ossa.', when: (e) => e.renderSetting('anatomy') },
      { t: '**Articolazioni** › **Deformazione morbida**: gomiti, polsi, spalle e anche si piegano senza strozzature, braccia e gambe mantengono il volume.', when: (e) => e.renderHas('softSkin') },
      '**Sfondo**: Grafite, Grigio, Carta, Studio, Cielo o **Trasparente**. **Pavimento**, **Griglia** e **Ombre** si accendono e spengono.',
      '**Qualità e prestazioni**: Alta, Media, Bassa; **Risoluzione dinamica durante i gesti** mantiene fluidi i movimenti.',
    ],
    tips: ['**Esposizione** e **Occlusione ambientale (AO)** compaiono negli stili che usano le luci.'],
    go: { tool: 'style' }, context: ['style'], related: ['luci', 'esportare'],
  },

  // ------------------------------------------------------------------ file
  {
    id: 'progetti', chapter: 'file', icon: 'book', title: 'Progetti e sezioni del fumetto',
    summary: 'Scene, paesaggi, personaggi e pose divisi per fumetto, capitolo, tavola, vignetta',
    keywords: 'progetti progetto fumetto fumetti sezione sezioni capitolo tavola vignetta salva in salvare paesaggio personaggio posa riusare inserisci applica cerca copertina esporta importa posaviva file archivio i miei fumetti',
    where: ['Menu', 'Progetti'],
    when: hasProjects,
    steps: [
      'Tocca [menu] › **Progetti**: ogni progetto è un fumetto, con la copertina fatta dalle ultime cose salvate. In «I miei fumetti» trovi anche le scene salvate prima.',
      '**Nuovo progetto** crea un fumetto; toccalo per aprirlo. **Sezione** aggiunge un **Capitolo**, una **Tavola** o una **Vignetta** con il nome che vuoi.',
      'Per salvare: [menu] › **Salva in…**, poi scegli cosa (**Scena**, **Paesaggio**, **Personaggio**, **Posa**), il nome, il progetto e la sezione (anche nuovi, lì sul momento).',
      'Dentro un progetto, **Salva qui…** o [save] accanto a una sezione salvano direttamente lì.',
      'Tocca una cosa salvata: **Apri scena**, **Applica paesaggio** (i personaggi restano), **Inserisci nella scena** (un nuovo personaggio con quell\'aspetto) o **Applica posa** (al personaggio selezionato).',
      'Cerca con **Cerca in tutti i progetti…**; i filtri **Scene**, **Paesaggi**, **Personaggi** e **Pose** mostrano un tipo solo.',
    ],
    tips: [
      '[more] su una sezione: **Rinomina o cambia tipo**, **Sposta su**, **Sposta giù**, **Elimina sezione**. Su una cosa salvata: **Rinomina**, **Sposta in…**, **Duplica**, **Elimina**.',
      '[more] su un progetto › **Esporta file (.posaviva)**: tutto il fumetto in un file, da conservare o da aprire su un altro telefono con **Importa**.',
      'Applicare un paesaggio, una posa o inserire un personaggio si annulla con [undo].',
      { t: 'Le pose salvate compaiono anche in **Posa** › **Pose pronte** › **Le mie pose**.', when: hasMyPoses },
    ],
    go: { action: 'openProjects', label: 'Apri Progetti' }, related: ['salvare', 'paesaggi', 'personaggi'],
  },
  {
    id: 'salvare', chapter: 'file', icon: 'save', title: 'Salvare e aprire le scene',
    summary: 'Salva scena, apri una scena salvata, nuova scena',
    keywords: 'salvare salva scena aprire apri le mie scene nuova scena rinomina duplica elimina salvataggio automatico autosave salva in copia versione salvata',
    where: ['Menu'],
    steps: [
      { t: 'Tocca [menu] › **Salva scena**: la prima volta scegli nome, progetto e sezione; le volte successive aggiorna la stessa scena.', when: hasProjects },
      { t: '[menu] › **Salva in…** salva una copia con un altro nome o in un\'altra sezione.', when: hasProjects },
      { t: 'Per riaprirla: [menu] › **Progetti**, entra nel progetto e tocca la scena › **Apri scena**.', when: hasProjects },
      { t: 'Tocca [menu] › **Salva scena**: la prima volta scegli un nome, le volte successive aggiorna la stessa scena.', when: noProjects },
      { t: '[menu] › **Apri scena…** mostra **Le mie scene** con le anteprime: tocca una scena per aprirla. [more] su una scena per **Rinomina**, **Duplica**, **Esporta file (.json)** o **Elimina**.', when: noProjects },
      '[menu] › **Nuova scena** riparte dalla scena iniziale; se ci sono modifiche non salvate te lo chiede prima.',
    ],
    tips: ['Il lavoro si salva anche da solo: riaprendo l\'app ritrovi la scena com\'era.'],
    go: { action: 'openScenes', label: 'Apri le scene salvate' }, related: ['progetti', 'esportare', 'file-scena'],
  },
  {
    id: 'esportare', chapter: 'file', icon: 'image', title: 'Esportare o condividere l\'immagine',
    summary: 'PNG fino a 3×, sfondo trasparente, ritaglio alla vignetta',
    keywords: 'esportare esporta immagine png salvare galleria condividi condividere risoluzione trasparente ritaglia vignetta guide foto',
    where: ['Menu'],
    steps: [
      'Tocca [menu] › **Esporta immagine PNG** (o **Condividi immagine**).',
      '**Risoluzione**: 1×, 2× o 3×; sotto vedi la misura in pixel.',
      '**Sfondo trasparente** per scontornare la figura; **Ritaglia alla vignetta** se hai scelto una vignetta in **Camera** › **Guide**; **Includi le guide prospettiche** se sono visibili.',
      '**Salva in Galleria** (sul computer: **Scarica PNG**) oppure **Condividi** per inviarla a un\'altra app.',
    ],
    tips: ['Anelli, maniglie e selezione non compaiono mai nell\'immagine.'],
    go: { action: 'exportImage', label: 'Apri Esporta immagine' }, related: ['stili', 'guide'],
  },
  {
    id: 'file-scena', chapter: 'file', icon: 'fileCode', title: 'Portare una scena su un altro dispositivo',
    summary: 'Esporta e importa il file della scena (.json)',
    keywords: 'file scena json esporta importa backup copia altro telefono dispositivo computer condividere scena',
    where: ['Menu'],
    steps: [
      'Tocca [menu] › **Esporta file scena (.json)**: tutta la scena finisce in un file.',
      'Sull\'altro dispositivo: [menu] › **Importa file scena** e scegli il file.',
      'Dopo l\'importazione tocca **Salva** nell\'avviso per tenerla tra le tue scene.',
    ],
    go: { spot: 'menu' }, related: ['salvare'],
  },
  {
    id: 'impostazioni', chapter: 'file', icon: 'settings', title: 'Impostazioni',
    summary: 'Qualità, vibrazione, suggerimenti, comandi vocali, tutorial, spazio occupato',
    keywords: 'impostazioni qualità batteria fluida vibrazione suggerimenti tutorial benvenuto archivio spazio memoria lingua comandi vocali voce microfono',
    where: ['Menu', 'Impostazioni'],
    steps: [
      'Tocca [menu] › **Impostazioni**.',
      '**Qualità di resa**: Alta per il massimo dettaglio, Bassa per più fluidità e meno batteria.',
      '**Vibrazione** e **Suggerimenti** si accendono e spengono.',
      { t: '**Tocco diretto**: trascini mani, piedi, braccia e gambe toccando il corpo (spento: solo con anelli e maniglie).', when: hasDirect },
      { t: '**Comandi vocali** › **Apri**: lingua e modalità dei comandi a voce (solo offline o con Claude).', when: hasVoice },
      '**Tutorial iniziale** › **Ripristina** fa rivedere le schede di benvenuto.',
      { t: '**Archivio** mostra quanto spazio occupano i progetti salvati; **Gestisci** apre **Progetti**.', when: hasProjects },
      { t: '**Archivio** mostra quanto spazio occupano le scene salvate.', when: noProjects },
    ],
    go: { action: 'openSettings', label: 'Apri Impostazioni' }, related: ['salvare'],
  },

  // ================================================================== PLACEHOLDERS
  // Features of the next phases. NOT SHOWN to users (status 'planned'). Fill the steps
  // after checking the feature in the running app, then set status 'live' and a `when`.
  {
    id: 'animali-avanzato', chapter: 'personaggi', icon: 'paw', title: 'Animali: novità', status: 'planned',
    summary: 'TODO(animali): estensioni future (il topic "animali" documenta il tool Animali già presente)',
    keywords: 'animali',
    todo: 'Per esempio: anelli di rotazione sugli animali, animali tenuti al guinzaglio o in braccio, nuove specie.',
    steps: [],
  },
  {
    id: 'libreria-estesa', chapter: 'scena', icon: 'library', title: 'Libreria oggetti ed edifici: novità', status: 'planned',
    summary: 'TODO(libreria): nuove categorie o kit della libreria Oggetti / Edifici',
    keywords: 'libreria oggetti edifici kit',
    todo: 'I topic "oggetti", "in-mano", "stanze" ed "edifici" sono già pubblicati: aggiungere qui solo le funzioni nuove della libreria quando arrivano.',
    steps: [],
  },
  {
    id: 'linea-azione-avanzata', chapter: 'posa', icon: 'edit', title: 'Linea d\'azione: funzioni avanzate', status: 'planned',
    summary: 'TODO(linea d\'azione): estensioni future (il topic "linea" è già pubblicato)',
    keywords: 'linea d\'azione',
    todo: 'Il topic "linea" documenta la modalità Posa › Linea già presente. Usare questo segnaposto per estensioni (più tratti, linee per braccia/gambe separate…).',
    steps: [],
  },
  {
    id: 'anatomia-avanzata', chapter: 'aspetto', icon: 'body', title: 'Definizione muscolare: novità', status: 'planned',
    summary: 'TODO(anatomia): estensioni future (Corpo › Definizione muscolare e Stile › Deformazione morbida sono già documentati)',
    keywords: 'muscoli definizione anatomia',
    todo: 'Definizione muscolare (topic "corpo"), Linee anatomiche e Deformazione morbida (topic "stili") sono già documentate con `when`. Qui le future aggiunte.',
    steps: [],
  },
];

/** Ids of the placeholders (kept for tests / the next phases). */
export const PLANNED_IDS = TOPICS.filter((t) => t.status === 'planned').map((t) => t.id);
