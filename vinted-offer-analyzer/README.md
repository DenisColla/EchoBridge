# Offerta Vinted Timing

Dashboard web/mobile (React 19 + Tailwind CSS 4 + Lucide) che calcola **quando** inviare un'offerta al ribasso su Vinted
per massimizzare la probabilità di accettazione e ridurre il rischio di rifiuto secco o blocco.

## Avvio rapido

```bash
cd vinted-offer-analyzer
npm install
npm run dev        # http://localhost:5173
npm test           # test del motore (node:test, nessuna dipendenza)
npm run test:rome  # gli stessi test sull'ora italiana (cambio dell'ora incluso)
npm run lint
npm run build      # produzione in dist/
npm run build:artifact   # artifact/VintedOfferAnalyzer.jsx + artifact/index.html
```

## Struttura

```
src/
  core/            motore puro (nessuna dipendenza da DOM o React: riusabile in React Native / Node)
    constants.js   vincoli Vinted, categorie, anzianità, profili venditore, segnali dell'annuncio, finestre e pesi
    scoring.js     sconto → rischio, fattori logit con rampe, finestra oraria/mensile, attribuzione, rischio blocco
    scheduler.js   disponibilità nel tempo, orizzonte, candidati ("adesso" incluso), scelta con regola dei quasi-pari
    reasoning.js   grammatica del verdetto, motivazioni in frasi complete, consigli
    messages.js    quattro template di messaggio (cordiale / diretto / impegno all'acquisto / motivato)
    analyze.js     analyzeOffer(form, now, { preferredSendAt }): punto d'ingresso unico (analisi, nessuna offerta, oltre il tetto)
    optimize.js    optimizeOffer: come arrivare a una probabilità obiettivo (aspetta / alza / entrambe)
    extract.js     parseVintedItemHtml + buildFormFromExtraction: dalla pagina pubblica di un annuncio al modulo compilato
    counter.js     analyzeCounter: la risposta migliore (cifra e momento) a una controproposta del venditore, round dopo round
    learning.js    apprendimento mensile: dataset degli esiti, correzione bayesiana del motore, sconto di partenza, varianti di test, rischio di fallimento, report
    profile.js     profilo appreso: le correzioni che scoring.js e counter.js aggiungono (nessun profilo = motore invariato)
    xlsx.js        scrittore .xlsx senza dipendenze (zip STORE + SpreadsheetML), per il report mensile
    dates.js       formattazione italiana senza Intl, festivi, fuso Europe/Rome, aritmetica DST-safe
    math.js        logit, sigmoide, interpolazione, hash deterministico
  hooks/useOfferAnalysis.js   stato del form e dell'analisi (React puro)
  theme.js         token visivi come classi Tailwind, per tono semantico
  platform/        adapter per API di piattaforma (clipboard)
  components/      componenti presentazionali (ui/ primitive + card del risultato)
  App.jsx          composizione mobile-first
test/              test del motore con node:test
scripts/           bundler per il file singolo da incollare negli Artifacts di Claude
artifact/          output generato: componente singolo e pagina HTML standalone
mobile/            app Android (Expo): start.bat crea l'APK con notifiche, calendario e lista da comprare
docs/              specifica dell'algoritmo (v1 e v2 rivista dai critici)
```

## Come funziona l'algoritmo

Il modello è additivo in spazio logit: `P(accettazione) = squash(base(sconto) + Σ pesi)`; la probabilità in evidenza è
`P(accettazione) × P(articolo ancora disponibile) × P(il venditore legge l'offerta)`.

| Fattore | Effetto (unità logit; 0,4 ≈ 10 punti percentuali a metà scala) |
| --- | --- |
| Sconto richiesto | curva base interpolata in logit e schiacciata in [3%, 97%]: 10% → 82%, 25% → 54%, 30% → 43%, 40% → 23% |
| Rischio | < 15% basso · 15–30% medio · > 30% alto (serve tempismo perfetto) · > 40% non inviabile (limite Vinted) |
| Domenica sera 21–23 | **+0,45** (reset settimanale, relax, gratificazione) |
| Sera lun–gio 21–21:30 / 21:30–22:30 / 22:30–23 | **+0,25 / +0,35 / +0,15** (picco di traffico, difese negoziali al minimo) |
| Venerdì sera · sabato sera · domenica mattina e pomeriggio | +0,20 · +0,15 · +0,15 |
| Fine mese (ultimi 7 giorni) · inizio mese (1–5) | **+0,20** con rampa dal 18 · **−0,15** con rampa fino all'8 |
| Pausa pranzo lun–ven 12:30–14 | **−0,35** (fascia peggiore) · mattina lavorativa 9–12 **−0,25** · notte **−0,20** · pomeriggio **−0,10** |
| Festivi italiani | valutati come domeniche (incluso il lunedì di Pasqua) |
| Categoria | fast fashion +0,35, bambini +0,40, elettronica −0,20, collezionismo −0,50, lusso −0,60; rampa extra oltre il 25% (lusso/collezionismo −0,40, fast fashion/bambini +0,15) |
| Differenza in euro | ≤ 3 € +0,20 … ≥ 250 € −0,45 (il venditore ragiona anche in valore assoluto) |
| Testo dell'annuncio | "prezzo non trattabile" −0,70 · "accetto offerte" +0,30 · "svuoto l'armadio" +0,45 |
| Anzianità annuncio | caricato oggi −0,40 → oltre un mese (35 gg) ≈ +0,48, moltiplicata per la pazienza della categoria; l'attesa viene mostrata come riga separata |
| Venditore | nuovo +0,20 · esperto da +0,15 (sconti piccoli) a −0,35 (sconti alti) con rampe · inattivo: probabilità di lettura 50%, orario quasi irrilevante |

I modificatori positivi sono limitati a +1,2 e quelli negativi a −1,6, così le combinazioni estreme restano plausibili.
La scomposizione mostrata nella card del punteggio è sequenziale: le righe sommano esattamente dalla base al totale.

Lo scheduler valuta "adesso" più le fasce canoniche dei prossimi 7–21 giorni (orizzonte dipendente dal rischio di
vendita a terzi, 10 giorni per annunci datati) e massimizza `P(complessiva) × 0,99^giorni di attesa`; tra i momenti quasi
equivalenti (entro 1,5 punti o il 3%) vince il più vicino, così il verdetto non salta di settimane per rumore. Il risultato
include: risposta esplicita "posso inviare adesso?" (mai "sì" in una fascia sfavorevole), alternativa entro 48 ore quando
il momento consigliato è lontano, altre finestre valide, fasce da evitare nel giorno scelto, scadenza dell'offerta, prezzo
consigliato per superare il 55% (60% se il rischio blocco è alto; per venditori inattivi la soglia è scalata sulla
probabilità di lettura), strategia a due step e quattro template di messaggio nel tono adatto, formulati "prima
dell'offerta" quando conviene scrivere e aspettare la risposta.

**Ottimizzatore.** Scelto un obiettivo (50–90%), `optimizeOffer` cerca il modo più economico per raggiungerlo: solo
aspettare il momento migliore nell'orizzonte, solo alzare l'offerta tenendo il momento consigliato (bisezione sulla
griglia dei prezzi), oppure la combinazione più economica; riporta anche il massimo raggiungibile senza pagare il
prezzo pieno. "Applica" fissa il momento scelto (`analyzeOffer(form, now, { preferredSendAt })`).

Vincoli Vinted incorporati (verificati a ottobre 2026, configurabili in `constants.js`): sconto massimo 40% per
offerta, 25 offerte al giorno per account, commissione acquirente 5% + 0,70 €. Vinted non indica una scadenza delle
offerte né delle controproposte: il piano assume prudentemente circa 24 ore (euristica, `OFFER_VALIDITY_HOURS` e
`VINTED_ASSUMED.COUNTER_VALIDITY_HOURS`).

## Controproposta del venditore

Quando il venditore risponde con la sua cifra ("Fai il tuo prezzo"), `src/core/counter.js` calcola la risposta che
minimizza il **prezzo finale atteso** per l'acquirente: per ogni cifra candidata e ogni momento di invio considera
che il venditore accetti, rilanci di nuovo (con un round di previsione), rifiuti o che qualcun altro compri l'articolo
nel frattempo. Le probabilità vengono dal modello di campo di eBay Best Offer (Backus et al. 2020) sulla quota della
distanza che concedi, con il bonus della metà strada esatta, la rigidità mostrata dal venditore e le fasce orarie e
mensili già usate per la prima offerta; il momento rispetta un'attesa minima di un'ora (rispondere a caldo segnala
fretta). Le cifre sono "precise" (,30 / ,70 / ,80 o interi non multipli di 5) oppure la metà strada esatta; i rilanci
successivi scendono di passo e finiscono con una sola offerta finale. Le regole che Vinted non documenta (durata della
controproposta, sopravvivenza della sua cifra dopo una nuova offerta, numero di rilanci) sono ipotesi configurabili in
`VINTED_ASSUMED` e `COUNTER` (`constants.js`), con la fonte o l'etichetta "euristica" accanto a ogni parametro.

## Apprendimento mensile

L'app Android tiene traccia di ogni offerta (cosa consigliava il motore, quando e a che prezzo l'hai inviata, com'è
andata, ogni controproposta) e il primo del mese, alla prima apertura, chiude il mese:

- **Report Excel** (`reportWorkbook`, 11 fogli: riepilogo, offerte, trattative, analisi delle controproposte, fasce
  orarie, sconti, calibrazione, varianti di test, modifiche al motore, andamento mese per mese, note) salvato da solo
  nella cartella scelta una volta (Storage Access Framework, permesso conservato da Android) e in una copia interna da
  aprire o condividere.
- **Correzione del motore** (`learning.js`): regressione logistica bayesiana (MAP + Laplace, priori centrati su
  "nessuna correzione", mesi vecchi pesati con un'emivita di 6 mesi, orizzonte fisso di 7 giorni). Prima la correzione
  generale, poi fasce orarie e curva dello sconto (lineare tra 10, 20 e 30%, sempre decrescente) sulla parte che resta,
  centrate perché esprimano solo differenze tra fasce. Ogni gradino entra solo se migliora le previsioni
  leave-one-out di almeno 1 nat e di un errore standard; poi ogni valore si muove solo con abbastanza esiti, oltre
  mezzo errore standard e al massimo di un passo al mese.
- **Rollback**: se le correzioni in uso prevedono peggio di quelle che hanno sostituito (log Bayes factor
  prequenziale sotto −2) tornano i valori precedenti e quei parametri restano fermi un mese. Tutto si annulla con un
  tocco.
- **Sconto di partenza**: il −20% proposto dal link diventa lo sconto più profondo al quale i tuoi venditori accettano
  ancora quanto il motore prevede al −20% (venditori più generosi → apertura più aggressiva, più duri → più morbida),
  al massimo un punto al mese.
- **Controproposte**: quota della distanza concessa dai venditori (stimata verso lo 0,42 di eBay) e tempi di risposta
  (Kaplan–Meier) correggono il motore delle controproposte.
- **Varianti di test**: circa un'offerta su cinque esce un'ora prima o dopo, o con circa due punti di sconto in più o
  in meno, scelta solo tra le varianti sicure (al massimo 6 punti di probabilità e l'1% del listino di risparmio atteso
  in meno, mai di notte, budget mensile del 3%), segnalata e con la propensione registrata.
- **Rischio di fallimento**: anche nel momento e al prezzo consigliati l'offerta può fallire; il risultato mostra la
  probabilità con un intervallo, i motivi, come falliscono di solito le tue offerte e la probabilità di chiudere
  comunque l'affare dopo le controproposte.

Pensato per pochi dati (meno di 15 offerte al mese): con il motore già corretto il profilo resta quasi sempre fermo,
con venditori più duri del previsto converge in pochi mesi (`test/learning.test.js` lo verifica su storie simulate).

## Lettura dell'annuncio

Il motore include un estrattore (`src/core/extract.js`) che legge la pagina pubblica di un annuncio Vinted (JSON-LD
e frammenti server-side: titolo, prezzo, marca, condizioni, categoria, "caricato … fa", "ultima visita … fa",
stelle, numero di recensioni, distintivi del venditore) e compila il modulo da solo, con un target al −20% (o lo
sconto di partenza appreso dai tuoi esiti).
L'app Android lo usa da "Estrai e calcola": basta il link. Da ottobre 2026 www.vinted.it è dietro Cloudflare, che a
un download diretto risponde spesso con una verifica anti-robot (`detectVintedChallenge` la riconosce): in quel caso
l'app apre l'annuncio con un browser interno nascosto (WebView), che supera la verifica automatica come Chrome e
restituisce la pagina allo stesso estrattore; se la verifica chiede un tocco, la mostra a schermo intero. Nel browser le pagine di Vinted non sono leggibili per
via del CORS, quindi la versione web offre "Leggi segnali dal testo": incolla il testo dell'annuncio e ricava
prezzo e segnali ("prezzo fisso", "accetto offerte", "svuoto l'armadio").

## App Android (APK)

La cartella `mobile/` contiene l'app Expo / React Native pronta: stesso motore (copiato in `mobile/core` da
`npm run sync-core`), "Estrai e calcola" dal link, lista "da comprare" con link, notifiche locali 10 minuti prima
della finestra consigliata, evento in calendario aperto già compilato nell'app Calendario del telefono (senza permessi;
Google Calendar e file .ics come alternative automatiche), registro degli esiti. Un APK già compilato è in `mobile/dist/OffertaVintedTiming-arm64.apk`:
basta copiarlo sul telefono e aprirlo. Su Windows `mobile\start.bat` installa i prerequisiti, compila e lascia la
versione universale in `mobile\dist\OffertaVintedTiming.apk`. Istruzioni complete in `mobile/README.md`.

## Claude Artifacts

`npm run build:artifact` genera `artifact/VintedOfferAnalyzer.jsx`: un unico componente React (import di `react` e
`lucide-react`, classi Tailwind) pronto da incollare come artifact. `artifact/index.html` è la stessa app
eseguibile da sola con React, Lucide e Tailwind caricati da CDN.
