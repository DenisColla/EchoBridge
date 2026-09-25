# EchoBridge Mail: lettore vocale per Gmail

Estensione per Chrome/Edge desktop. Apri un'email in Gmail e premi **▶**: la mail viene letta per intero. Se è più lunga di 5 righe, alla fine senti *"Il riassunto della mail è il seguente"* e **3 punti chiave**. Con **🎤** detti la risposta e la bozza compare nella casella di risposta di Gmail. L'invio resta sempre a te.

## Installazione (2 minuti)

```bash
cd gmail-voice-reader
npm install
npm run build        # crea la cartella dist/
```

1. Apri `chrome://extensions` (o `edge://extensions`) e attiva **Modalità sviluppatore**.
2. Clicca **Carica estensione non pacchettizzata** e scegli `gmail-voice-reader/dist`.
3. Si apre la pagina Impostazioni: incolla la chiave API Anthropic (facoltativa, vedi sotto).
4. Ricarica Gmail e apri un'email: in basso compare la barra del lettore.

| Comando | Azione |
|---|---|
| ▶ / ⏸ oppure **Alt+Shift+L** | Leggi / pausa |
| ⏮ ⏭ | Frase precedente / successiva |
| 1.1× | Cambia velocità (da 0.9× a 2×) |
| 🎤 oppure **Alt+Shift+R** | Rispondi a voce; clicca di nuovo, oppure resta in silenzio 3 s, per terminare |

## Come funziona

```
Gmail (DOM) ──► content script ──────────────────────────────► voce del browser (gratis)
                 │  estrae la mail aperta, toglie citazioni,       lettura frase per frase
                 │  firme, disclaimer e link
                 │
                 └─ solo se > 5 righe ──► service worker ──► Claude API (riassunto in 3 punti)
                                            │ cache per mail: al secondo ascolto 0 token
                                            └─ senza chiave o API giù ► punti chiave estratti offline
```

**Scelte per l'efficienza dei token**
- La **lettura** usa le voci neurali del sistema (`speechSynthesis`): 0 token e 0 costi. Su Edge le voci "Online (Natural)" sono particolarmente naturali.
- Il **riassunto** viene chiesto solo per le mail oltre la soglia (5 righe visive, configurabile), e solo quando premi play. Le mail che apri senza ascoltarle non costano nulla.
- A Claude arriva **solo testo pulito**: niente HTML, cronologia citata, firme, disclaimer o URL. Il limite è di circa 3k token; le mail più lunghe tengono inizio e fine.
- Il prompt è breve e fisso, l'output è di sole 3 righe, con `effort: low` per un compito semplice.
- C'è una **cache per mail** (300 voci, LRU): riascoltare una mail non spende token.
- Il riassunto viene generato **mentre** la mail viene letta, quindi a fine lettura è già pronto.
- Se manca la chiave API o l'API non risponde, c'è un **fallback offline**: un riassunto estrattivo che privilegia richieste, scadenze, date, importi e domande.

**Risposte**
- In modalità **AI** detti le istruzioni ("digli che va bene martedì ma il preventivo arriva lunedì") e Claude scrive la mail nella lingua dell'email ricevuta, con il tono e la firma scelti, senza inventare impegni.
- In modalità **Dettatura** viene inserito esattamente ciò che dici.
- La bozza viene inserita nella risposta di Gmail. **Non viene mai inviata in automatico.**

**Altro**
- Le voci vengono scelte in automatico in base alla lingua della mail (it/en/es/fr/de).
- Nei thread viene letto il messaggio aperto più recente.
- Tutta la conoscenza del DOM di Gmail è in `src/content/gmail.js`: se Google cambia layout si interviene in un solo file.

## Privacy
La chiave API resta in `chrome.storage.local`: non viene sincronizzata e parte solo verso `api.anthropic.com`. Il testo della mail va a Claude solo per il riassunto o la risposta. La lettura avviene nel browser. Per un uso aziendale su molti PC conviene spostare la chiave su un piccolo proxy server.

## Sviluppo

```bash
npm test          # test unitari (pulizia testo, soglia, frasi, lingua, riassunto offline)
npm run watch     # ricompila a ogni modifica, poi ricarica l'estensione
```

| File | Ruolo |
|---|---|
| `src/content/main.js` | Orchestrazione: rilevamento mail, coda di lettura, riassunto, risposta |
| `src/content/gmail.js` | Estrazione dal DOM di Gmail e inserimento della bozza |
| `src/content/text.js` | Funzioni pure: pulizia, soglia righe, frasi, lingua, riassunto offline |
| `src/content/speech.js` | Motore TTS a coda (pausa, salto frase, velocità, scelta voce) |
| `src/content/dictation.js` | Dettatura vocale (Web Speech API) |
| `src/content/ui.js` | Barra flottante in Shadow DOM, con tema chiaro e scuro |
| `src/background.js` | Chiamate a Claude (SDK ufficiale), cache, scorciatoie |
| `src/options/` | Pagina impostazioni |
