# Offerta Vinted Timing — app Android

App Android (Expo / React Native) dell'analizzatore di offerte Vinted. Usa lo **stesso motore** della versione web
(`../src/core`, copiato in `core/`) e aggiunge quello che serve per agire al momento giusto:

- **Dal link al verdetto in un tocco**: incolla il link dell'annuncio (o tocca "Incolla dagli appunti", o accetta il banner che compare quando torni nell'app con un link Vinted copiato) e "Estrai e calcola" legge titolo, prezzo, marca, condizioni, categoria, data di caricamento, ultima attività del venditore, stelle, numero di recensioni e distintivi dalla pagina pubblica (se Vinted chiede la verifica anti-robot, la supera con il browser interno), propone un target al −20% e calcola subito. La scheda "Letto dall'annuncio" mostra che cosa è stato trovato, che cosa è stato stimato e che cosa manca; "Modifica i dati" porta al modulo per correggere.
- **Lista "da comprare"**: ogni analisi si salva con titolo, link all'annuncio, prezzi, momento consigliato e messaggio pronto.
- **Notifica** 10 minuti prima della finestra consigliata; toccandola si apre la lista sull'articolo, con "Apri annuncio" e "Copia messaggio".
- **Calendario senza permessi**: "Metti in calendario" apre la schermata "nuovo evento" dell'app Calendario del telefono (Samsung o Google) con titolo, orario e note già compilati; tu controlli e tocchi Salva. Se nessuna app calendario risponde, l'app prova da sola Google Calendar precompilato e poi un file .ics. Nella scheda Info c'è "Prova con un evento di test" e l'esito dell'ultima operazione.
- **Obiettivo**: scegli la probabilità che vorresti (50–90%) e "Portami al N%" elenca i modi più economici per arrivarci: aspettare il momento migliore, alzare di poco l'offerta, o entrambe le cose. "Applica questa scelta" aggiorna prezzo e momento con un tocco.
- **Controproposta del venditore**: se ti risponde con la sua cifra, tocca "Rispondi alla controproposta" (dal risultato o dalla lista) e scrivila in euro o come "% sopra la tua offerta". L'app calcola la tua risposta: la cifra (precisa, tipo 51,70 €, o la metà strada esatta), quanto sali in euro e in percentuale, la probabilità che accetti subito, il prezzo medio che pagherai, il momento migliore per inviarla (mai a caldo: almeno un'ora dopo la sua risposta, nelle fasce serali buone) e il piano "E dopo?" se resta fermo, se scende o se rifiuta. Se rilanciare farebbe risparmiare troppo poco, ti dice di comprare subito con «Acquista». Con un budget massimo non ti propone mai cifre oltre quel limite.
- **Trattativa salvata**: "Salva e ricordamelo" mette nella lista lo storico (tu 45 € → lui 58,50 € → tu 51,70 €…), ti avvisa 10 minuti prima con la cifra e il messaggio pronto e, se assumiamo che la sua proposta scada, poco prima della scadenza. Dopo "Ho inviato la nuova offerta" arrivano un promemoria per scrivergli due righe se tace per un giorno e uno per lasciar perdere dopo tre giorni; "Ha risposto con un'altra cifra" calcola il round successivo (al massimo tre rilanci, l'ultimo è un'offerta finale).
- **Esiti**: segna accettata / controproposta / rifiutata / nessuna risposta / venduto ad altri / lasciato perdere; la scheda Info confronta l'accettazione reale con la stima media, mostra il risparmio medio sul listino e quante controproposte hai chiuso sotto la cifra del venditore. Le trattative eliminate dalla lista restano nell'archivio e contano nel report.
- **Apprendimento mensile**: il primo del mese (notifica alle 9:07, oppure alla prima apertura) l'app crea l'Excel del mese chiuso con affari conclusi e persi, controproposte e salita media, tempi di risposta, fasce orarie, sconti, calibrazione delle stime, varianti di test e andamento mese per mese, lo salva da solo nella cartella scelta una volta (per esempio Documents/Offerte Vinted) e ritara il motore a piccoli passi (solo quando le correzioni migliorano davvero le previsioni), con «Annulla le correzioni». Lo sconto di partenza proposto dal link segue quanto accettano i tuoi venditori. «Esporta adesso il mese in corso» crea l'Excel fino a oggi.
- **Rischio di fallimento e varianti di test**: ogni risultato mostra quanto l'offerta può fallire anche nel momento giusto, con i motivi, come falliscono di solito le tue offerte e la probabilità di chiudere comunque l'affare; circa un'offerta su cinque è una variante di test (±1 ora o circa ±2 punti di sconto, solo se costa poco) segnalata, con «Usa il piano migliore» per evitarla.
- Tutto resta sul telefono (nessun server, nessun account), tranne i testi e le foto degli annunci che invii ai fornitori AI dal Laboratorio.

## Laboratorio AI (scheda Info)

Serve a scegliere, con un test sui tuoi annunci, il modello AI per la prossima fase (ricerca dello stesso prodotto su più canali). Confronta **Claude Haiku 5.5**, **OpenAI GPT-6 Luna**, **DeepSeek V4.1 Flash** e **Qwen 3.8 Flash** (prezzi di listino all'11/10/2026 nel report).

1. **Chiavi**: creane una per fornitore (Anthropic console, OpenAI platform, DeepSeek platform, Alibaba Cloud Model Studio internazionale, regione Singapore) e incollala in «Inserisci». Restano cifrate nel telefono (Keystore), non finiscono nell'APK né nel report. Imposta sul sito di ogni fornitore un **tetto di spesa mensile** o una ricarica prepagata piccola: è la protezione se il telefono finisce in mani sbagliate. «Prova» fa una chiamata minima per controllare la chiave.
2. **Coppie**: analizza un annuncio dal link (diventa il riferimento), poi «Raccogli coppie» apre la ricerca Vinted in un browser **visibile**, senza login; i risultati della ricerca caricata si leggono nel telefono (se cambi filtri nella pagina, la ricerca viene ricaricata quando tocchi «Usa questi risultati»). **Ogni ricerca ha il suo riferimento** (l'oggetto che vorresti comprare): se cerchi un prodotto diverso dall'annuncio analizzato, l'app chiede di sceglierne uno tra i risultati. Etichetta ogni candidato rispetto al riferimento: Stesso, Variante (stesso modello, colore/taglia/capacità/edizione diversi) o Diverso. Bastano 5–6 ricerche di prodotti diversi da 10–15 annunci, con modelli simili ma diversi. Se tutti i modelli contraddicono una tua etichetta, la coppia compare tra quelle «da ricontrollare».
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
