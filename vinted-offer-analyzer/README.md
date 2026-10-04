# Offerta Vinted Timing

Dashboard web/mobile (React 19 + Tailwind CSS 4 + Lucide) che calcola **quando** inviare un'offerta al ribasso su Vinted
per massimizzare la probabilità di accettazione e ridurre il rischio di rifiuto secco o blocco.

## Avvio rapido

```bash
cd vinted-offer-analyzer
npm install
npm run dev        # http://localhost:5173
npm test           # test del motore (node:test, nessuna dipendenza)
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
    analyze.js     analyzeOffer(form, now): punto d'ingresso unico (analisi, nessuna offerta, oltre il tetto Vinted)
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
```

## Come funziona l'algoritmo

Il modello è additivo in spazio logit: `P(accettazione) = squash(base(sconto) + Σ pesi)`; la probabilità in evidenza è
`P(accettazione) × P(articolo ancora disponibile) × P(il venditore legge l'offerta)`.

| Fattore | Effetto (unità logit; 0,4 ≈ 10 punti percentuali a metà scala) |
| --- | --- |
| Sconto richiesto | curva base interpolata in logit: 10% → 84%, 25% → 54%, 30% → 43%, 40% → 21% |
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
| Anzianità annuncio | caricato oggi −0,40 → oltre un mese +0,45, moltiplicata per la pazienza della categoria; l'attesa viene mostrata come riga separata |
| Venditore | nuovo +0,20 · esperto da +0,15 (sconti piccoli) a −0,35 (sconti alti) con rampe · inattivo: probabilità di lettura 50%, orario quasi irrilevante |

I modificatori positivi sono limitati a +1,2 e quelli negativi a −1,6, così le combinazioni estreme restano plausibili.
La scomposizione mostrata nella card del punteggio è sequenziale: le righe sommano esattamente dalla base al totale.

Lo scheduler valuta "adesso" più le fasce canoniche dei prossimi 7–21 giorni (orizzonte dipendente dal rischio di
vendita a terzi, 10 giorni per annunci datati) e massimizza `P(complessiva) × 0,99^giorni di attesa`; tra i momenti quasi
equivalenti (entro 1,5 punti o il 3%) vince il più vicino, così il verdetto non salta di settimane per rumore. Il risultato
include: risposta esplicita "posso inviare adesso?", alternativa entro 48 ore quando il momento consigliato è lontano,
altre finestre valide, fasce da evitare nel giorno scelto, scadenza dell'offerta, prezzo consigliato per superare il 55%
(60% se il rischio blocco è alto), strategia a due step e quattro template di messaggio nel tono adatto.

Vincoli Vinted incorporati (verificati a ottobre 2026, configurabili in `constants.js`): sconto massimo 40% per
offerta, 25 offerte al giorno per account, validità dell'offerta circa 24 ore.

## Portare l'app su Android (React Native / Expo)

1. `npx create-expo-app` e copia `src/core`, `src/hooks` e `src/theme.js` così come sono (JavaScript puro).
2. Installa `nativewind` per usare le stesse classi Tailwind di `theme.js` e `lucide-react-native` per le icone
   (`src/components/icons.js` mappa i nomi già usati in `core/constants.js`).
3. Riscrivi i componenti in `src/components` con `View`/`Text`/`Pressable`; l'adapter `platform/clipboard.js`
   diventa `expo-clipboard`.
4. `eas build -p android` produce l'APK.

## Claude Artifacts

`npm run build:artifact` genera `artifact/VintedOfferAnalyzer.jsx`: un unico componente React (import di `react` e
`lucide-react`, classi Tailwind) pronto da incollare come artifact. `artifact/index.html` è la stessa app
eseguibile da sola con React, Lucide e Tailwind caricati da CDN.
