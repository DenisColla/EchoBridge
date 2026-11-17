# Piano: il punteggio di interesse (vetrina e caccia)

Deciso con l'utente il 17 novembre 2026. Stato: fase 1 consegnata con la 1.17.0, in attesa di prova sul telefono;
fasi 2–5 da fare, dopo il giudizio dell'utente sulla lista di taratura (`docs/taratura/lista-taratura-30.xlsx`).

## Decisioni dell'utente

| Domanda | Risposta |
|---|---|
| Che cosa vuol dire un voto alto | **Compravendita**: margine atteso rivendendo, qualità, velocità di vendita |
| Riferimenti del prezzo | Mercato Vinted sempre; in più **prezzo da nuovo dall'AI**, **altri mercati dell'usato** (Subito, Wallapop), **ricerca web per i migliori**, e una **lista di partenza** che l'utente corregge a mano |
| Quanto può lavorare l'AI | **Media**: circa 0,20–0,50 € per sessione di 8 ore |
| Pertinenza | **Profilo compilato una volta + quello che l'utente fa** (cuori, analisi, offerte, acquisti, pollice su/giù) |

Vincoli che restano: niente campo «Rivenduto a»; l'app non manda offerte da sola; nessuna imitazione di una persona
e nessun aggiramento dei controlli di Vinted; all'AI vanno solo titoli, prezzi e condizioni, mai i nomi dei venditori.

## Principio

**L'AI legge, il motore calcola.** L'AI compila una scheda fissa per ogni articolo (categoria, marca, modello,
variante, condizioni, difetti, completezza); il voto esce da una formula del motore, così è stabile, spiegabile e
uguale con qualsiasi AI. Non si addestra un modello: si danno una scheda di giudizio, riferimenti reali e memoria.

## Il punteggio 0–100 (pesi iniziali per la compravendita)

| Voce | Peso | Misura |
|---|---|---|
| Convenienza | 40 | Guadagno atteso: valore di rivendita prudente meno costo vero (prezzo + protezione 0,70 € + 5% + spedizione), in % del valore e in euro |
| Domanda | 20 | Cuori per ora dall'inserimento, «Ricercato», annunci simili che spariscono tra una lettura e l'altra |
| Qualità | 15 | Condizioni, completezza, parole di difetto |
| Trattabilità | 10 | Probabilità che il venditore scenda (`negotiationFor`: ore online, cali, boost) |
| Pertinenza | 10 | Categorie, marche, autori, taglie del profilo e del comportamento |
| Venditore | 5 | Recensioni e affidabilità, quando letto |

Sopra la formula:

- **Fiducia**: senza riferimento letto dal vero il voto è «provvisorio» e non supera 70.
- **Rischio**: griffato molto sotto mercato, venditore senza recensioni, parole di difetto abbassano il voto.
- **Soglie di partenza** (da tarare sulla lista): voto ≥ 85 se resta un guadagno del 30% e di almeno 5 €; voto ≥ 70 con
  il 15% e almeno 3 €. Gli articoli sotto i 10–15 € comprati da soli non arrivano mai a 70: valgono solo in lotto.

Ogni articolo mostra voto, fiducia e tre motivi.

## Schede di categoria

- **Telefoni ed elettronica**: marca, modello, memoria, batteria, blocco, accessori. Riferimento: mercato dello stesso
  modello e memoria; altri mercati dell'usato; nuovo come tetto.
- **Libri, fumetti, manga**: ISBN oppure titolo, autore, volume, edizione, variant. Copertina come tetto; l'edizione
  decide per i testi universitari.
- **Abbigliamento e scarpe**: fascia della marca, tipo, taglia, condizioni, modello se nominato. Rischio falsi.
- **Resto** (sport, casa, collezionismo): scheda generica, fiducia più bassa.

I prezzi dell'usato li impara l'app: ogni mercato letto viene salvato con la data e riusato per un giorno. La lista di
partenza porta solo i fatti stabili e le correzioni dell'utente.

## Catena a ogni lettura (dentro gli 8–12 minuti)

1. Raccolta: solo i nuovi o quelli cambiati di prezzo.
2. Scrematura a regole, gratis.
3. Scheda dell'AI a lotti (10–20 articoli per chiamata, veloce, temperatura 0).
4. Riferimento vero per i promettenti: stessa ricerca su Vinted (mediana, quartile basso), con memoria di un giorno.
5. Punteggio e motivi; sopra 85 avviso subito.
6. A fine sessione: classifica, analisi completa dei primi dieci (venditore, costi, proposta), offerta a un tocco.

## La caccia

Stesso motore; la pertinenza diventa **corrispondenza** con il prodotto cercato (`triagePrompt`: lo stesso, una
variante, altro). «Il migliore» è il voto più alto entro il massimo, non il meno caro. I quattro segnali del +10/15%
(nuovo, corrispondenza piena, venditore solido, sotto mercato) diventano tutti calcolabili.

## Fasi

1. **Fondamenta** — letture avviate dalla sveglia di Android, motore fuori dall'interfaccia, diario con l'innesco.
   *Consegnata con la 1.17.0; da provare a telefono bloccato.*
2. **Punteggio sulla vetrina** — scheda dell'AI a lotti, voto, motivi, classifica, avviso sopra 85.
3. **Riferimenti e pertinenza** — mercato letto con memoria, altri mercati, ricerca web per i primi, profilo e pollici.
4. **Caccia con punteggio** — corrispondenza, i quattro segnali, primi tre con analisi completa.
5. **Taratura** — pesi e soglie dai giudizi sulla lista e dagli esiti dell'utente.

## Cosa esiste già nel motore e va riusato

`productPrompt` / `cleanProduct` (scheda prodotto), `triagePrompt` / `applyTriage` (lo stesso o no), `productMarketFrom`
e `bookMarketFrom` (mercato), `negotiationFor` e `probabilityAt` (trattabilità), `ceilingPriceFor` (costo vero),
`CONDITION_PENALTY_PCT` (condizioni per categoria), i lettori di Subito e Wallapop in `channels.js`.
