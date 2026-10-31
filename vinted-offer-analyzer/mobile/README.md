# Offerta Vinted Timing — app Android

App Android (Expo / React Native) dell'analizzatore di offerte Vinted. Usa lo **stesso motore** della versione web
(`../src/core`, copiato in `core/`) e aggiunge quello che serve per agire al momento giusto:

- **Dal link alla decisione in un tocco**: incolla il link dell'annuncio (o tocca «Incolla»; se torni nell'app con un link Vinted copiato lo trovi già proposto) e «Leggi e calcola» legge titolo, prezzo, marca, condizioni, categoria, data di caricamento, ultima attività del venditore, stelle, recensioni, distintivi e, quando la pagina li mostra, visualizzazioni, interessati, prezzo ribassato, sconto sui lotti e altri articoli del venditore (se Vinted chiede la verifica anti-robot, la supera con il browser interno). La **policy per fascia di prezzo** propone lo sconto di partenza (per esempio −12% su 20–40 € dopo una settimana, +5 se «svuoto l'armadio», −3 con un venditore esperto, prezzi «precisi» come 23 € e mai meno di 2 € di risparmio) e il calcolo parte subito. La pagina del risultato è una sola decisione: «Offri 20 €» con il rischio, il momento, tre numeri (probabilità con la sua forchetta, prezzo atteso, risposta entro), un suggerimento e un solo pulsante; tutto il resto («Messaggio per il venditore», «Perché questo numero», «Altri momenti», «Prezzo, mercato e leve», «Letto dall'annuncio», «Dati dell'offerta») è ripiegato sotto.
- **Lista**: ricerca per titolo, prezzo, categoria o numero dell'annuncio; sezioni «In corso», «Accettate», «Rifiutate», «Tutte»; dentro «In corso» i gruppi «Da aggiornare», «Da fare», «In attesa di risposta». Ogni riga ha un solo passo successivo e un solo pulsante («Copia messaggio» che diventa «Ho inviato l'offerta», poi i quattro esiti; «Altro…» per gli esiti meno comuni, «Elimina» solo nella riga aperta). La riga «2 accettate su 12 (17%) · stima media 56%» dice quanto ci azzecca il motore. Promemoria «Com'è andata?» 36 ore e 7 giorni dopo l'invio.
- **Notifica** 10 minuti prima della finestra consigliata; toccandola si apre la lista sull'articolo, con "Apri annuncio" e "Copia messaggio".
- **Calendario senza permessi**: "Metti in calendario" apre la schermata "nuovo evento" dell'app Calendario del telefono (Samsung o Google) con titolo, orario e note già compilati; tu controlli e tocchi Salva. Se nessuna app calendario risponde, l'app prova da sola Google Calendar precompilato e poi un file .ics. Nella scheda Info c'è "Prova con un evento di test" e l'esito dell'ultima operazione.
- **Obiettivo**: «Voglio più probabilità» propone +10 punti, +20 punti o il massimo raggiungibile su quell'annuncio, e «Portami al N%» elenca i modi più economici per arrivarci: aspettare il momento migliore, alzare di poco l'offerta, o entrambe le cose. «Applica» aggiorna prezzo e momento con un tocco.
- **Controproposta del venditore**: se ti risponde con la sua cifra, tocca "Rispondi alla controproposta" (dal risultato o dalla lista) e scrivila in euro o come "% sopra la tua offerta". L'app calcola la tua risposta: la cifra (precisa, tipo 51,70 €, o la metà strada esatta), quanto sali in euro e in percentuale, la probabilità che accetti subito, il prezzo medio che pagherai, il momento migliore per inviarla (mai a caldo: almeno un'ora dopo la sua risposta, nelle fasce serali buone) e il piano "E dopo?" se resta fermo, se scende o se rifiuta. Se rilanciare farebbe risparmiare troppo poco, ti dice di comprare subito con «Acquista». Con un budget massimo non ti propone mai cifre oltre quel limite.
- **Trattativa salvata**: "Salva e ricordamelo" mette nella lista lo storico (tu 45 € → lui 58,50 € → tu 51,70 €…), ti avvisa 10 minuti prima con la cifra e il messaggio pronto e, se assumiamo che la sua proposta scada, poco prima della scadenza. Dopo "Ho inviato la nuova offerta" arrivano un promemoria per scrivergli due righe se tace per un giorno e uno per lasciar perdere dopo tre giorni; "Ha risposto con un'altra cifra" calcola il round successivo (al massimo tre rilanci, l'ultimo è un'offerta finale).
- **Esiti**: segna accettata / controproposta / rifiutata / nessuna risposta / comprato / venduto ad altri / lasciato perdere; la scheda Info («Quanto ci azzecca») confronta l'accettazione reale con la stima media, mostra il risparmio medio sul listino e quante controproposte hai chiuso sotto la cifra del venditore. La Lista conta lo stato attuale, Info il primo esito. Le trattative eliminate dalla lista restano nell'archivio e contano nel report; «Backup dei dati (JSON)» e «Ripristina da JSON» spostano tutto tra telefoni.
- **Apprendimento**: una **correzione dal vivo** (quanto i tuoi venditori accettano meno o più del prior, e quanto conta lo sconto) si ricalcola a ogni esito segnato, con soglie minime, isteresi e ritorno automatico al punto di controllo se peggiora le previsioni; la scheda Info la mostra («Correzione in uso: −N punti, basata su N tuoi esiti») con «Annulla le correzioni». Il primo del mese (notifica alle 9:07, oppure alla prima apertura) l'app crea l'Excel del mese chiuso con affari conclusi e persi, controproposte, tempi di risposta, fasce orarie, fasce di prezzo, calibrazione, varianti di test e andamento mese per mese, lo salva nella cartella scelta una volta e aggiunge le correzioni per fasce orarie e categorie e lo spostamento dello sconto della policy (al massimo ±6 punti, un punto al mese).
- **Onestà sui numeri e prova del motore**: la probabilità è sempre accompagnata dalla sua forchetta («tra 27% e 75%») e dalla base («stima iniziale» oppure «su N tuoi esiti»); «Perché questo numero» mostra la regola applicata, che cosa pesa (i segnali letti dalla pagina sono marcati «stima» finché non sono verificati), come falliscono di solito le tue offerte e la probabilità di chiudere comunque. Con la prova del motore attiva lo sconto può uscire 4 punti sotto, uguale o 4 punti sopra la tabella, scelto a sorte secondo quanto il motore ha imparato (Thompson sampling, propensione registrata) e sempre segnalato, con «Usa il piano migliore»; quando la policy del messaggio è indifferente, il motore tira a sorte anche «scrivi prima / offri subito» per imparare quale rende.
- **Cerca altrove**: dall'annuncio letto in Calcola, lo stesso articolo su Vinted, Subito e Wallapop ordinato per prezzo finale atteso (sezione qui sotto).
- **Motore 1.6 — un solo obiettivo e il mercato reale**: ogni scelta è misurata con il **prezzo atteso** (probabilità × offerta + resto × quello che pagheresti se rifiuta: il listino o l'alternativa migliore trovata). La scheda «Prezzo atteso» mostra la curva offerta → prezzo atteso e l'offerta che paga meno in media, con «Usa come offerta». Dopo una ricerca su «Cerca altrove» per lo stesso annuncio, il **mercato** (mediana, fascia 25–75%, alternativa migliore) entra nel punteggio («prezzo rispetto al mercato»), nel rischio che l'articolo sparisca, nel valore di una trattativa persa e in un messaggio «informato» che cita onestamente gli altri prezzi. La scheda «Altre leve» elenca cosa paga oltre all'offerta: comprare subito se è già sotto il mercato, l'alternativa più economica, **preferito-e-aspetta** (sconto del venditore a chi ha messo il cuore, con promemoria a 60 ore), pazienza (probabilità stimata di ribasso in 7 giorni contro quella di perderlo). Nella controproposta il motore stima il **minimo che il venditore accetterebbe** dalle sue risposte. Le probabilità delle leve sono priori dichiarati, non ancora tarati sui tuoi esiti.
- **Motore 1.7 — prima «se», poi «quanto», poi «quando»**: prior ricalibrato sul primo mese di offerte reali (molto meno ottimista sotto i 50 €, pesi serali dimezzati, venditore «poco attivo»); un **gate decisionale** con dieci regole ordinate decide se offrire, comprare subito, mettere il cuore e aspettare, scrivere prima, o non rilanciare (mai una seconda offerta sullo stesso annuncio entro 14 giorni da un rifiuto o da un silenzio: la Lista la blocca); una **policy del messaggio** (scrivi prima se il venditore è poco attivo, se lo sconto è profondo su un articolo caro o se è un professionista; «diretto» sotto i 30 €, mai la parola «budget» sotto i 50 €; toni lotto, spedizione inclusa, domanda, dopo il rifiuto); nella controproposta la regola **«Accetta»** quando la sua cifra è già sotto il tuo prezzo atteso o vicina al target della policy (sui tre casi reali del primo mese avrebbe chiuso 3 affari su 3). Ogni offerta registra ciò che serve a imparare: segnali della pagina, mercato, policy, regola del gate, variante e propensione, messaggio prima o dopo; `scripts/replay.mjs` rigioca un backup JSON contro il motore attuale e stampa la tabella controfattuale.
- Tutto resta sul telefono (nessun server, nessun account), tranne i testi e le foto degli annunci che invii ai fornitori AI dal Laboratorio e da «Cerca altrove».

## Cerca altrove (Calcola o scheda Info)

Cerca lo stesso articolo dell'annuncio letto in Calcola su **Vinted, Subito e Wallapop** e lo ordina per quanto dovresti pagarlo davvero.

1. **Scheda prodotto**: GPT-6 Luna (Claude Haiku 5.5 di riserva) ricava dal titolo e dalla descrizione nome, versione, parole da cercare, parole che indicano accessori e modelli della stessa famiglia. Senza chiave usa le parole del titolo. Le parole per ogni sito si possono correggere.
2. **Ricerche**: «Apri le ricerche» apre i tre siti uno dopo l'altro in un browser **visibile**, senza login, con fascia di prezzo (30%–125% del riferimento, ricontrollata anche dall'app) e solo annunci spedibili; su Wallapop la ricerca parte dalla città scelta. L'app legge gli annunci della pagina che vedi (su Wallapop anche quelli che si caricano scorrendo). Nessuna richiesta in background, nessun clic automatico, nessun controllo anti-robot aggirato: se il sito blocca, si salta.
3. **Scrematura e verifica**: un filtro leggero scarta doppioni, venduti/riservati, annunci solo a mano, sopra la fascia di prezzo o senza prezzo/foto (al massimo 20 per sito, i più vicini al prezzo di partenza); gli annunci molto sotto la fascia non vengono scartati ma finiscono in «da controllare». Poi una **scrematura testuale in una sola chiamata** ogni 40 annunci (stesso / variante / famiglia / accessorio / altro, senza foto) toglie accessori e altri prodotti; solo i plausibili vanno alla verifica con le foto di **Qwen 3.8 Flash** (Claude Haiku 5.5 di riserva). Gli annunci già verificati nella stessa ricerca non si pagano due volte; la classifica si aggiorna man mano. Un controllo deterministico su capacità, taglia e numero di modello nel titolo declassa un «stesso» incoerente a variante: le varianti **funzionali** (capacità, taglia, modello) vanno tra le alternative, quelle estetiche restano nella lista principale.
4. **Classifica**: totale subito = prezzo + commissione acquirente + spedizione; **valore equivalente** = totale atteso corretto per le condizioni (ogni grado peggiore rispetto all'annuncio di partenza vale una percentuale per categoria, es. 6% elettronica, 8% abbigliamento); le alternative hanno un livello (modello inferiore/pari/superiore) e sono ordinate per convenienza rispetto al prezzo tipico di ciascun modello, non per prezzo assoluto; il **mercato** dell'articolo (mediana e fascia) viene salvato e usato in Calcola. «**Piano a 3**»: offerte simultanee ai migliori annunci equivalenti, calibrate per minimizzare il totale atteso del più economico che accetta (P(almeno una), totale atteso, confronto con la trattativa singola; su Vinted un'offerta accettata lascia 24 ore per comprare). Totale atteso = prezzo dopo una trattativa realistica (offerta consigliata e probabilità del motore, entro i limiti di ogni sito: Vinted almeno il 60% del prezzo, Wallapop il 70% e niente offerte sui ricondizionati, Subito senza minimo; Wallapop non accetta offerte ai venditori PRO, ma dai risultati di ricerca non si capisce chi lo è: quei risultati lo segnalano come rischio) + commissione + spedizione; l'ordine penalizza verifiche incerte, segnali di rischio, spedizioni stimate e annunci dall'estero. Le alternative della stessa famiglia stanno in una sezione a parte. «Perché conviene» scrive, solo quando lo chiedi, leve di trattativa e profilo del venditore. «Apri annuncio» apre il sito: le offerte le fai tu.

Limiti da sapere: il motore della trattativa è tarato su Vinted, su Subito e Wallapop i numeri sono stime; la commissione di Wallapop è una stima; la lettura delle pagine di Subito e Wallapop non è ancora stata provata su pagine reali dal telefono: se un sito dà 0 annunci, «Invia la pagina per diagnosi» condivide il file della pagina per correggere la lettura. Le condizioni d'uso dei tre siti vietano la lettura automatica delle pagine: l'app legge solo la pagina che apri tu, quando lo chiedi. Dati inviati ai fornitori: titoli, descrizioni e foto pubbliche degli annunci, con numeri di telefono, e-mail e profili social sostituiti da «[contatto]» (riconosciuti dalla forma: un formato insolito può sfuggire); mai chiavi né nomi dei venditori. L'ultima ricerca si può riaprire dalla scheda Info.

## Laboratorio AI (scheda Info)

Serve a scegliere, con un test sui tuoi annunci, il modello AI per la prossima fase (ricerca dello stesso prodotto su più canali). Confronta **Claude Haiku 5.5**, **OpenAI GPT-6 Luna**, **DeepSeek V4.1 Flash** e **Qwen 3.8 Flash** (prezzi di listino all'11/10/2026 nel report).

1. **Chiavi**: creane una per fornitore (Anthropic console, OpenAI platform, DeepSeek platform, Alibaba Cloud Model Studio internazionale, regione Singapore) e incollala in «Inserisci». Restano cifrate nel telefono (Keystore), non finiscono nell'APK né nel report. Imposta sul sito di ogni fornitore un **tetto di spesa mensile** o una ricarica prepagata piccola: è la protezione se il telefono finisce in mani sbagliate. «Prova» fa una chiamata minima per controllare la chiave.
2. **Coppie**: analizza un annuncio dal link (diventa il riferimento), poi «Raccogli coppie» apre la ricerca Vinted in un browser **visibile**, senza login; i risultati della ricerca caricata si leggono nel telefono (se cambi filtri nella pagina, la ricerca viene ricaricata quando tocchi «Usa questi risultati»). **Ogni ricerca ha il suo riferimento** (l'oggetto che vorresti comprare): se cerchi un prodotto diverso dall'annuncio analizzato, l'app chiede di sceglierne uno tra i risultati. Etichetta ogni candidato rispetto al riferimento: Stesso, Variante (stesso modello, colore/taglia/capacità/edizione diversi) o Diverso. Bastano 5–6 ricerche di prodotti diversi da 10–15 annunci, con modelli simili ma diversi. Se tutti i modelli contraddicono una tua etichetta, la coppia compare tra le «etichette contestate» (correggila, eliminala o tocca «Sono sicuro»); se quasi un intero salvataggio è respinto dai modelli, l'app segnala un probabile «riferimento sbagliato» e propone di eliminarlo in blocco, oppure di confermare che il riferimento era giusto.
3. **Test delle foto**: ogni modello confronta le due foto (ridotte a 768 px, uguali per tutti) e i testi; misura quanto spesso trova l'articolo giusto (stesso o variante contro diverso), i falsi «stesso», le etichette esatte, le risposte valide, il costo reale e i tempi. Si può interrompere e riprendere.
4. **Test di psicologia**: per fino a 6 coppie Stesso/Variante (24 testi con 4 modelli) ogni modello spiega perché conviene, su cosa fare leva e com'è il venditore, usando i numeri del motore; tu voti i testi **alla cieca** (lettere mescolate) e segnali se inventano dati; i risultati per modello compaiono solo quando hai votato tutti i testi.
5. **Report**: Excel con riepilogo, tutte le risposte, i voti, i prezzi e il foglio «Metodo» (come è stato chiamato ogni fornitore).

Costo indicativo: meno di un centesimo per coppia per modello; il test completo (circa 80 coppie × 4 modelli + psicologia) resta sotto 1 $ a listino. Dati inviati ai fornitori: testi e foto pubbliche degli annunci, mai le chiavi né i nomi dei venditori. DeepSeek tratta e conserva i dati in Cina (provvedimento del Garante del 30/1/2025 ancora pubblicato): usalo solo se ti sta bene.

## Installare subito: APK precompilato

In `dist/OffertaVintedTiming-arm64.apk` c'è un APK già compilato (29 MB, architettura arm64, cioè qualsiasi telefono
Android degli ultimi anni). Scaricalo sul telefono, aprilo dal gestore file e consenti l'installazione da origini
sconosciute quando Android lo chiede. Niente da installare sul PC. Per rigenerarlo, o per la versione universale con
tutte le architetture, usa `start.bat` qui sotto.

## Creare l'APK su Windows: `start.bat`

1. Scarica il repository (GitHub → Code → Download ZIP) ed estrai la cartella `vinted-offer-analyzer\mobile` in un percorso corto, per esempio `C:\OffertaVinted`.
2. Doppio clic su **`start.bat`**. Lo script, in ordine:
   - installa Node.js LTS e Java 17 se mancano (tramite `winget`, può chiedere conferma UAC);
   - scarica gli Android command-line tools in `%LOCALAPPDATA%\Android\Sdk`, accetta le licenze e installa platform-tools, platform 36 e build-tools 36;
   - esegue `npm install`, copia il motore, genera il progetto nativo con `expo prebuild` e compila con `gradlew assembleRelease`;
   - copia il risultato in **`dist\OffertaVintedTiming.apk`** e apre la cartella.
3. La prima volta scarica circa 3 GB e impiega 15–40 minuti; le volte successive pochi minuti.

Opzioni: `start.bat -DebugApk` produce un APK di debug (più veloce); `start.bat -SkipInstall` non tenta installazioni.
Il log completo di ogni esecuzione è in `tools\ultimo-build.log`.

### Installare sul telefono

- **Via USB**: attiva "Opzioni sviluppatore" → "Debug USB" sul telefono, collegalo e lancia `install-on-phone.bat`.
- **Senza cavo**: copia `dist\OffertaVintedTiming.apk` sul telefono (Drive, Telegram "Messaggi salvati", cavo) e aprilo dal gestore file; alla prima installazione Android chiede di consentire le app da origini sconosciute per quell'app.

L'APK è firmato con la chiave di debug generata da Expo: si installa su qualsiasi telefono ma non è pubblicabile sul Play Store così com'è. Per aggiornare l'app basta installare il nuovo APK sopra il vecchio (stesso `package`, `it.migelino.offertavinted`).

### Se qualcosa va storto

| Sintomo | Rimedio |
| --- | --- |
| `winget` non riconosciuto | Installa a mano Node.js LTS (nodejs.org) e Microsoft OpenJDK 17, poi rilancia. |
| Errori di Gradle su nomi file o percorsi | Sposta la cartella in `C:\OffertaVinted` (percorso corto, senza spazi né accenti). |
| Download interrotti | Rilancia `start.bat`: riprende da dove si era fermato. |
| Non vuoi installare nulla sul PC | `build-cloud.bat`: compila sui server di Expo (account gratuito su expo.dev), poi scarichi l'APK dal link. |
| "Metti in calendario" non apre nulla | Scheda Info → "Prova con un evento di test": la riga "Ultima operazione" dice quale via ha risposto o con quale errore. Serve un'app calendario installata (Samsung Calendar o Google Calendar); senza, l'app passa a Google Calendar nel browser e poi al file .ics. |
| "Estrai e calcola" impiega qualche secondo o mostra "Verifica di Vinted" | Vinted (Cloudflare) fa un controllo anti-robot: l'app apre l'annuncio con il browser interno, che di solito lo supera da solo; se compare una casella, toccala e l'app torna al calcolo. Se la verifica non si completa, riprova tra poco o compila i dati a mano (il link resta per il promemoria). |

## Sviluppo

```bash
cd vinted-offer-analyzer/mobile
npm install
npm run sync-core          # ricopia ../src/core in ./core dopo ogni modifica al motore
npx expo start             # anteprima con Expo Go (le notifiche programmate richiedono la build nativa)
npx expo export --platform web --output-dir .web-check   # anteprima nel browser per controllare il layout
npx expo run:android       # build di sviluppo su emulatore o telefono collegato
```

Struttura:

```
App.js                 shell con tre schede (Calcola, Lista, Info), toast, gestione del tocco sulla notifica
core/                  motore condiviso (copia di ../src/core, non modificare qui)
src/theme.js           token colore chiaro/scuro
src/services/          storage (AsyncStorage), notifications (expo-notifications), calendar (expo-intent-launcher + expo-sharing, senza permessi), clipboard
src/hooks/useWatchlist.js   lista salvata, promemoria, statistiche degli esiti
src/components/        ui.js (primitive), OfferForm, ResultView, WatchlistView, InfoView
tools/build-apk.ps1    script PowerShell eseguito da start.bat
assets/                icona, icona adattiva, splash (generate da scripts, teal #0f766e)
```

Permessi Android dichiarati: notifiche, allarmi esatti. Il canale di notifica si chiama "Promemoria offerte".
