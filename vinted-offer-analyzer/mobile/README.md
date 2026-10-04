# Offerta Vinted Timing — app Android

App Android (Expo / React Native) dell'analizzatore di offerte Vinted. Usa lo **stesso motore** della versione web
(`../src/core`, copiato in `core/`) e aggiunge quello che serve per agire al momento giusto:

- **Lista "da comprare"**: ogni analisi si salva con titolo, link all'annuncio, prezzi, momento consigliato e messaggio pronto.
- **Notifica** 10 minuti prima della finestra consigliata; toccandola si apre la lista sull'articolo, con "Apri annuncio" e "Copia messaggio".
- **Calendario**: evento di 30 minuti con allarme nel calendario del telefono, oppure "Apri Google Calendar" senza permessi.
- **Esiti**: segna accettata / controproposta / rifiutata / nessuna risposta; la scheda Info confronta l'accettazione reale con la stima media ed esporta i dati in JSON.
- Tutto resta sul telefono: nessun server, nessun account.

## Installare subito: APK precompilato

In `dist/OffertaVintedTiming-arm64.apk` c'è un APK già compilato (26 MB, architettura arm64, cioè qualsiasi telefono
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

## Sviluppo

```bash
cd vinted-offer-analyzer/mobile
npm install
npm run sync-core          # ricopia ../src/core in ./core dopo ogni modifica al motore
npx expo start             # anteprima con Expo Go (le notifiche programmate richiedono la build nativa)
npx expo run:android       # build di sviluppo su emulatore o telefono collegato
```

Struttura:

```
App.js                 shell con tre schede (Calcola, Lista, Info), toast, gestione del tocco sulla notifica
core/                  motore condiviso (copia di ../src/core, non modificare qui)
src/theme.js           token colore chiaro/scuro
src/services/          storage (AsyncStorage), notifications (expo-notifications), calendar (expo-calendar), clipboard
src/hooks/useWatchlist.js   lista salvata, promemoria, statistiche degli esiti
src/components/        ui.js (primitive), OfferForm, ResultView, WatchlistView, InfoView
tools/build-apk.ps1    script PowerShell eseguito da start.bat
assets/                icona, icona adattiva, splash (generate da scripts, teal #0f766e)
```

Permessi Android dichiarati: notifiche, lettura/scrittura calendario, allarmi esatti. Il canale di notifica si chiama "Promemoria offerte".
