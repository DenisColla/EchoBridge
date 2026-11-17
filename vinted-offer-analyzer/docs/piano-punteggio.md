# Piano: il punteggio di interesse (vetrina e caccia)

Deciso con l'utente il 17 novembre 2026. Stato: fasi 1–4 nel codice dalla 1.18.0 (`src/core/interest.js`,
`mobile/src/services/watchEngine.js`), da provare sul telefono; fase 5 (taratura dagli esiti) da fare.
La lista di taratura (`docs/taratura/lista-taratura-30.xlsx`) è stata giudicata «molto bene» dall'utente, che ha poi
scelto dieci prezzi d'acquisto (`docs/taratura/scelte-utente.json`): da lì vengono i margini qui sotto.

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

## Il punteggio 0–100 (come è nel codice)

`voto = 40·convenienza + 20·domanda + 15·qualità + 10·trattabilità + 10·pertinenza + 5·venditore` (ogni voce da 0 a 1)

| Voce | Peso | Come si calcola |
|---|---|---|
| Convenienza | 40 | Guadagno rivendendo al valore prudente, dopo prezzo + protezione (0,70 € + 5%) + spedizione, diviso per il **margine che l'utente chiede**: vale 0,8 al suo «lo compro», 1 un terzo sopra, 0,1 in pari |
| Domanda | 20 | Cuori (0 → 0,45 … oltre 40 → 1), più un poco se crescono mentre l'articolo è osservato |
| Qualità | 15 | Condizioni dichiarate (nuovo con cartellino 1 … discrete 0,35), meno i difetti letti dall'AI |
| Trattabilità | 10 | Quanto sconto serve per arrivare al prezzo d'acquisto: 1 se è già sotto, 0,05 oltre il 40% che Vinted non lascia offrire |
| Pertinenza | 10 | Categorie, parole e taglie del profilo, pollici; in una caccia la corrispondenza con il prodotto cercato |
| Venditore | 5 | Neutro (0,7) finché l'annuncio non viene letto |

**Margine chiesto** (dalle dieci scelte dell'utente): **27%** dove la rivendita è sicura (telefoni, console e giochi,
audio, LEGO e collezionismo, fumetti e manga), **35%** altrove. Sotto 5 € di guadagno non è mai un «sì».

Sopra la somma:

- **Senza convenienza il voto non sale**: non supera `35 + 65·convenienza`.
- **Provvisorio**: se il valore è solo una stima dell'AI (presa un 10% più bassa), il voto non supera 70.
- **Non identificato o senza valore**: non supera 55. **Difettoso, non il prodotto cercato, pollice giù**: non supera 40.
- **Marca molto contraffatta a prezzo sospetto**: 12 punti in meno e l'avviso di verificare.

Etichette: **85+ affare**, **70+ da comprare**, **55+ da trattare** (c'è scritto a quale offerta diventa da comprare),
sotto **lascia**. Ogni articolo mostra voto, etichetta e i motivi. Gli articoli sotto i 10–15 € comprati da soli non
arrivano a 70: lo dicono («vale in lotto»).

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

1. Lettura della pagina (scaricata) e raccolta: un articolo per riga, con il primo e l'ultimo avvistamento.
2. Sveglia per la lettura successiva, prima di tutto il resto.
3. Scheda dell'AI per gli articoli nuovi: lotti da 10, quattro chiamate affiancate, 40 articoli a lettura al massimo.
4. Riferimento: nella caccia sono i risultati stessi della ricerca (quelli che l'AI dice essere il prodotto cercato);
   nella vetrina tre ricerche su Vinted a lettura per i promettenti e poi per i più cari, con memoria di un giorno.
5. Voto e motivi di tutti; un «affare» con valore letto dal mercato viene notificato subito, una volta sola.
6. A fine sessione: notifica con il primo della classifica; l'analisi completa dei primi dieci è ancora da fare.

Il giudizio (passi 3–5, senza le ricerche di mercato) parte anche senza una lettura: quando si salva una chiave
dell'AI, quando l'app torna davanti con articoli senza scheda, e con «Valuta adesso» (1.18.1). Un articolo conta come
chiesto solo se l'AI ha risposto; dopo due risposte senza scheda resta senza, finché non lo si chiede a mano.

Tetto di spesa dell'AI per ricerca: 0,60 $. Niente in una lettura aspetta un timer dell'app (con l'app dietro possono
non scattare): le richieste di rete passano da `services/http.js`.

## La caccia

Stesso motore; la pertinenza diventa **corrispondenza** con il prodotto cercato (`triagePrompt`: lo stesso, una
variante, altro). «Il migliore» è il voto più alto entro il massimo, non il meno caro. I quattro segnali del +10/15%
(nuovo, corrispondenza piena, venditore solido, sotto mercato) diventano tutti calcolabili.

## Fasi

1. **Fondamenta** — letture avviate dalla sveglia di Android, motore fuori dall'interfaccia, diario con l'innesco.
   *Nel codice dalla 1.17.0; da provare a telefono bloccato.*
2. **Punteggio sulla vetrina** — scheda dell'AI a lotti, voto, motivi, classifica, avviso sopra 85. *Nel codice (1.18.0).*
3. **Riferimenti e pertinenza** — mercato Vinted letto con memoria, profilo e pollici: *nel codice (1.18.0)*.
   Altri mercati dell'usato (Subito, Wallapop), ricerca web per i primi e lista di partenza: *da fare*.
4. **Caccia con punteggio** — corrispondenza, segnali del +10/15%, il migliore per voto: *nel codice (1.18.0)*.
   Analisi completa dei primi a fine ricerca e venditore solido: *da fare*.
5. **Taratura** — pesi e soglie dagli esiti dell'utente: *da fare* (i margini vengono già dalle sue dieci scelte).

## Cosa esiste già nel motore e va riusato

`productPrompt` / `cleanProduct` (scheda prodotto), `triagePrompt` / `applyTriage` (lo stesso o no), `productMarketFrom`
e `bookMarketFrom` (mercato), `negotiationFor` e `probabilityAt` (trattabilità), `ceilingPriceFor` (costo vero),
`CONDITION_PENALTY_PCT` (condizioni per categoria), i lettori di Subito e Wallapop in `channels.js`.
