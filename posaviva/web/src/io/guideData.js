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
export const START_HERE = ['vista', 'posa-ruota', 'zoom-rapido', 'esportare'];

const hasLine = (e) => e.posing('drawLine');
const hasProjects = (e) => typeof e.app?.projects?.open === 'function';
const noProjects = (e) => !hasProjects(e);
const hasVoice = (e) => typeof e.app?.modules?.voice?.open === 'function' || !!document.querySelector?.('.pv-vc-fab');
const hasAdjust = (e) => e.posing('dynamism') && e.posing('setNaturalness');
const hasSoftSpine = (e) => e.poseState('softSpine');

export const TOPICS = [
  // ------------------------------------------------------------------ primi passi
  {
    id: 'interfaccia', chapter: 'basi', icon: 'layers', title: 'Com\'è fatta l\'app',
    summary: 'Barra degli strumenti, pannello, tasti in alto',
    keywords: 'interfaccia barra strumenti pannello menu schede orizzontale verticale indietro chiudere',
    steps: [
      'In basso c\'è la barra degli strumenti: **Personaggi**, **Posa**, **Aspetto**, **Scena**, **Camera**, **Stile**. Toccane uno per aprire il suo pannello.',
      'Alcuni gruppi hanno più strumenti: li trovi come schede in cima al pannello (per esempio **Posa** › **Pose pronte** › **Mani** › **Viso**).',
      'Trascina la maniglia del pannello in su o in giù per allargarlo o ridurlo; toccala per cambiare altezza. Trascinalo tutto in giù, o tocca [close], per chiuderlo.',
      'In alto a sinistra c\'è il personaggio selezionato: toccalo per aprire l\'elenco dei personaggi.',
      { t: 'In alto a destra: [undo] [redo] annulla e ripeti, [help] questa guida, [menu] il menu con **Progetti**, salvataggio, esportazione e impostazioni.', when: hasProjects },
      { t: 'In alto a destra: [undo] [redo] annulla e ripeti, [help] questa guida, [menu] il menu con scene, esportazione e impostazioni.', when: noProjects },
      { t: 'In basso sulla vista: a sinistra [mic] apre i **Comandi** vocali, a destra [zoom] lo zoom rapido.', when: hasVoice },
    ],
    tips: [
      'Con il telefono in orizzontale gli strumenti diventano una colonna a sinistra e il pannello si apre a destra.',
      'Il tasto Indietro di Android chiude prima menu e finestre, poi il pannello. Con niente aperto, premilo due volte per uscire.',
    ],
    go: { spot: 'toolbar' }, related: ['vista', 'annulla'],
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
    ],
    related: ['zoom-rapido', 'punto-focale'],
  },
  {
    id: 'selezionare', chapter: 'basi', icon: 'tap', art: 'tap', title: 'Selezionare personaggi e parti',
    summary: 'Toccare un personaggio, un braccio, una mano…',
    keywords: 'selezione selezionare toccare tap parte corpo braccio mano testa deselezionare elenco destra sinistra',
    steps: [
      'Tocca un personaggio nella vista per selezionarlo: il suo nome compare in alto a sinistra.',
      'Con **Posa** aperta, oppure con il pannello chiuso, tocca una parte del corpo (braccio, mano, testa…): si colora e compaiono gli anelli per ruotarla.',
      'Tocca lo sfondo per lasciare la parte selezionata.',
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
    summary: 'Descrivi la scena a voce o per iscritto e l\'app la costruisce',
    keywords: 'voce comandi vocali parlare microfono dettare scrivere comando frase metti aggiungi gira inquadra offline ibrida claude chiave api esempi prova recenti',
    where: ['Comandi'],
    when: hasVoice,
    steps: [
      'Tocca [mic], il tasto tondo in basso a sinistra della vista: si apre **Comandi** e l\'app ti ascolta.',
      'Parla in italiano, per esempio «metti un gatto sul letto», «crea una strada di città di notte con pioggia», «gira la donna verso la finestra», «inquadra dal basso».',
      'Oppure scrivi in **Scrivi un comando…** e tocca la freccia. Sotto **Prova** ci sono esempi da toccare; i comandi già usati restano tra i recenti.',
      'Il pannello dice cosa ha fatto e cosa non ha capito. **Annulla** toglie tutto il comando in un passo.',
      'Tocca [settings] nel pannello (o [menu] › **Impostazioni** › **Comandi vocali**) per la **Modalità**: **Solo offline** capisce i comandi sul telefono, senza internet; **Ibrida** usa anche Claude per le frasi più difficili, con la tua chiave API.',
    ],
    tips: [
      'La chiave API resta solo su questo dispositivo. Senza rete, o senza chiave, i comandi vengono capiti offline.',
      'Accanto a **Comandi** vedi la modalità in uso (**Offline** o **Ibrida**): toccala per cambiarla.',
    ],
    go: { spot: 'mic' }, related: ['personaggi', 'paesaggi', 'annulla'],
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
    go: { tool: 'pose', mode: 'rotate' }, context: ['pose:rotate', 'pose'], related: ['trascina', 'linea', 'zoom-rapido'],
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
    tips: ['Per rifinire una singola articolazione torna a **Ruota**.'],
    go: { tool: 'pose', mode: 'ik' }, context: ['pose:ik'], related: ['posa-ruota', 'sposta'],
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
    go: { tool: 'pose', mode: 'move' }, context: ['pose:move'], related: ['personaggi', 'trascina'],
  },
  {
    id: 'pose-pronte', chapter: 'posa', icon: 'people', art: 'poses', title: 'Partire da una posa pronta',
    summary: 'Camminata, corsa, combattimento, seduti… in un tocco',
    keywords: 'pose pronte preset libreria camminata corsa salto combattimento seduto sedia a terra sdraiato gesti specchia dinamismo naturalezza asimmetrie',
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
      { t: 'Una tua posa da riusare: [menu] › **Salva in…** › **Posa**; poi in **Progetti** toccala e scegli **Applica posa** (va sul personaggio selezionato).', when: hasProjects },
      'Le pose sedute si appoggiano all\'altezza di una sedia: aggiungine una da **Scena** › **Oggetti**.',
    ],
    go: { tool: 'poselib' }, context: ['poselib'], related: ['linea', 'posa-intera'],
  },
  {
    id: 'posa-intera', chapter: 'posa', icon: 'mirror', title: 'Specchiare, copiare o azzerare la posa',
    summary: 'Specchia posa, Copia su…, Azzera posa e opzioni',
    keywords: 'specchia specchiare copia copiare altro personaggio azzera azzerare reset opzioni limiti colonna morbida bacino piedi fissi articolazioni',
    where: ['Posa', 'Posa intera'],
    steps: [
      'Apri **Posa** e scorri fino a **Posa intera**.',
      '**Specchia posa** scambia il lato destro con il sinistro.',
      '**Copia su…** copia la posa su un altro personaggio, o su tutti.',
      '**Azzera posa** riporta tutte le articolazioni alla posizione di partenza: l\'avviso che compare ha **Annulla**.',
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
      'Nel primo piano puoi continuare a posare e a girare la vista: l\'inquadratura segue la parte anche quando si muove.',
      'Tocca [focusBack] **Torna alla vista**, o il tasto Indietro, per tornare all\'inquadratura di prima.',
    ],
    tips: [
      'Lo zoom rapido cambia solo la vista: non modifica la scena e non entra in **Annulla**.',
      'In **Mani** e **Viso** trovi anche **Inquadra la mano** e **Primo piano**.',
    ],
    go: { spot: 'zoom' }, context: ['focus'], related: ['mani', 'viso', 'vista'],
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
    keywords: 'vestiti abiti capi outfit maglietta t-shirt jeans pantaloni gonna vestito scarpe giacca camicia felpa colore vestibilità aderente largo pieghe togliere',
    where: ['Aspetto', 'Vestiti'],
    steps: [
      'Apri **Aspetto** › **Vestiti**.',
      'Per un look completo tocca uno degli **Outfit rapidi**: Casual, Formale, Sport/Action, Street, Solo intimo.',
      'Oppure, in **Aggiungi capi**, scegli una categoria (Sopra, Sotto, Interi, Scarpe, Calze e intimo) e tocca un capo: prende il posto di quello dello stesso tipo.',
      'Tocca un capo in **Indossati** per cambiarne colore, **Vestibilità** (Normale, Aderente, Largo) e **Pieghe**, o per toglierlo con **Togli**.',
      '**Pieghe (tutti i capi)** regola le pieghe di tutto l\'outfit; **Togli tutto** toglie tutti i capi.',
    ],
    tips: ['Le pieghe seguono la posa: piega un braccio e la manica si raggrinzisce.'],
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
    go: { tool: 'lights' }, context: ['lights'], related: ['stili', 'oggetti'],
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
    go: { tool: 'props' }, context: ['props'], related: ['in-mano', 'edifici'],
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
    tips: ['L\'oggetto segue la mano: muovi il braccio con **Ruota** o **Trascina** e l\'oggetto lo accompagna.'],
    go: { tool: 'props' }, related: ['oggetti', 'mani'],
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
    go: { tool: 'exteriors' }, context: ['exteriors'], related: ['edifici', 'oggetti'],
  },

  {
    id: 'paesaggi', chapter: 'scena', icon: 'mountain', title: 'Paesaggi pronti',
    summary: 'Città, natura, fantasy e stanze creati intorno ai personaggi, ogni volta diversi',
    keywords: 'paesaggi paesaggio sfondo ambiente città natura fantasy stanze spiaggia bosco montagna deserto vicolo piazza castello genera nuovo rigenera svuota salva ora del giorno alba tramonto notte meteo pioggia neve nebbia stagione inverno estate',
    where: ['Scena', 'Paesaggi'],
    when: (e) => e.tool('landscapes'),
    steps: [
      'Apri **Scena** › **Paesaggi** e scegli un gruppo: **Città**, **Natura**, **Fantasy** o **Stanze**.',
      'Tocca un paesaggio (per esempio **Vicolo notturno** o **Piazza europea**): viene creato intorno ai personaggi, ogni volta diverso, e la camera lo inquadra.',
      '**Ora del giorno**, **Meteo** e **Stagione** cambiano subito luce, cielo e tempo del paesaggio; con **Auto** sceglie l\'app. **Quantità di oggetti** vale dal prossimo **Genera nuovo**.',
      '**Genera nuovo** ne crea un altro dello stesso tipo, **Rigenera** rifà lo stesso con una nuova variante, **Svuota** lo toglie.',
      { t: '**Salva** lo mette in un progetto (solo l\'ambiente, senza personaggi). Per riusarlo: [menu] › **Progetti**, tocca il paesaggio › **Applica paesaggio**.', when: hasProjects },
    ],
    tips: [
      'Ogni pezzo del paesaggio resta modificabile con **Oggetti**, **Edifici**, **Esterni** e **Animali**.',
      'Non ti piace? [undo] annulla la generazione.',
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
