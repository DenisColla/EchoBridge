"""Builds docs/taratura/lista-taratura-30.xlsx: thirty articles in ten categories with web prices (November 2026), a
prudent resale value and the highest buying prices that follow from it, for the user to judge («perfetto» / «no»).
The same rows are written as JSON beside it. Run: python3 scripts/build-calibration-sheet.py
"""
import json
import math
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'docs', 'taratura')
FEE_FIXED, FEE_PCT = 0.70, 0.05  # Vinted buyer protection

# category, article, specs, assumed condition, new today, used low, used high, prudent resale, shipping, what moves the value, where the prices come from
ROWS = [
    ('Smartphone', 'Apple iPhone 13 128 GB', '2021 · 6,1" OLED · chip A15 · 5G · doppia fotocamera 12 MP', 'Usato, ottime condizioni, batteria ≥ 85%, sbloccato', '≈ 460 (fuori listino Apple; prezzo consigliato dei rivenditori)', 200, 270, 215, 5,
     'Salute della batteria (sotto l\'80% vale 30–40 € in meno), blocco iCloud o operatore, vetro e scocca, scatola.', 'Ricondizionato 235–392 € (eBay, MediaWorld marketplace). Usato tra privati: mia stima dal ricondizionato.'),
    ('Smartphone', 'Samsung Galaxy S25 Ultra 256 GB', '2025 · 6,9" · Snapdragon 8 Elite · 12 GB RAM · 200 MP · S Pen', 'Usato, ottime condizioni, con scatola', '776 (MediaWorld; listino di lancio 1.499)', 560, 680, 590, 5,
     'Garanzia residua e scontrino, righe sul display, S Pen presente, versione italiana. Il nuovo in sconto a 776 € fa da tetto.', 'Nuovo 775,89 € (MediaWorld); ricondizionato 737–898 € (PcComponentes). Usato: mia stima.'),
    ('Smartphone', 'Samsung Galaxy Z Fold7 256 GB', '2025 · pieghevole 8" + 6,5" · 12 GB RAM · 200 MP', 'Usato, ottime condizioni, piega integra', '1.140–1.303 (Smartworld, MediaWorld)', 800, 980, 840, 5,
     'Stato della piega e della pellicola interna, garanzia, scatola. È già uscito il Fold8: il valore scende in fretta.', 'Nuovo 1.140–1.303 €; ricondizionato grado B 1.052 € (Yeppon). Usato: mia stima.'),
    ('Console e videogiochi', 'Nintendo Switch OLED 64 GB', '2021 · schermo OLED 7" · dock con porta LAN', 'Usata, ottime condizioni, con dock, Joy-Con e cavi', '347 (prezzo 2026)', 190, 240, 200, 6,
     'Drift dei Joy-Con, console modificata o bannata online, scatola. Ogni gioco incluso aggiunge 15–30 €.', 'Nuova 347 € (Everyeye, 2026); offerte passate 239–270 €. Usato: mia stima.'),
    ('Console e videogiochi', 'Sony PlayStation 5 Slim con lettore, 1 TB', '2023 · lettore Ultra HD Blu-ray · 1 controller DualSense', 'Usata, ottime condizioni, con controller e cavi', '549,99 (listino novembre 2026)', 340, 420, 360, 8,
     'Controller con drift, sigilli, scatola. Truffe frequenti sugli annunci troppo bassi. Pacco grande: spedizione cara.', 'Listino 549,99 € (PlayStation e Unieuro, novembre 2026). Usato: mia stima.'),
    ('Console e videogiochi', 'The Legend of Zelda: Tears of the Kingdom (Switch, fisico)', '2023 · cartuccia · versione italiana', 'Usato, ottime condizioni, con custodia', '55–61 (listino 69,99)', 35, 42, 36, 3,
     'Custodia e copertina, versione Switch 1 (non la Switch 2 Edition). Gioco che tiene il prezzo.', 'Nuovo 60,97 € (Unieuro), 54,90–55 € in offerta. Usato: mia stima.'),
    ('Audio', 'Apple AirPods Pro 2 (USB-C)', '2023 · cancellazione del rumore · custodia MagSafe USB-C', 'Usate, ottime condizioni, originali, con scatola', '224–287 (fuori listino Apple da settembre 2025)', 110, 150, 115, 3,
     'FALSI MOLTO DIFFUSI: numero di serie da verificare sul sito Apple. Batteria delle cuffie, gommini, scatola.', 'Ricondizionate 179 € (Swappie); usate senza scatola ≈ 166 € (eBay).'),
    ('Audio', 'Sony WH-1000XM5', '2022 · cuffie over-ear · cancellazione del rumore · 30 ore', 'Usate, ottime condizioni, con custodia', '229–237 in offerta (listino 299)', 140, 180, 150, 4,
     'Cuscinetti e archetto (punto debole: la cerniera), custodia rigida. È uscito il modello XM6.', 'Nuove 229–236,50 € (Tom\'s Hardware, giugno–luglio 2026). Usato: mia stima.'),
    ('Audio', 'JBL Charge 5', '2021 · cassa Bluetooth 30 W · IP67 · 20 ore', 'Usata, ottime condizioni', '≈ 150–180 (riferimento 199)', 70, 95, 75, 4,
     'Batteria, ammaccature della griglia. È uscita la Charge 6. Esistono copie.', 'Nuova 151,58–179,77 € (Pixmania). Usato: mia stima.'),
    ('Tablet, e-reader, smartwatch', 'Apple iPad 9ª generazione 64 GB Wi-Fi', '2021 · 10,2" · chip A13 · Touch ID', 'Usato, ottime condizioni', 'fuori listino (lancio 389)', 150, 190, 160, 5,
     'Blocco iCloud, vetro, batteria. 64 GB è il taglio meno richiesto.', 'Ricondizionato 219–223 € (Swappie, reBuy, Pixmania). Usato: mia stima.'),
    ('Tablet, e-reader, smartwatch', 'Amazon Kindle Paperwhite 11ª generazione (2021)', '6,8" · luce regolabile · USB-C · impermeabile · 8 o 16 GB', 'Usato, ottime condizioni', 'fuori listino (lancio 149,99; modello 2024 a 169,99)', 65, 90, 70, 3,
     'Versione con o senza pubblicità, righe sullo schermo, custodia inclusa.', 'Lancio 149,99 € (2021); Paperwhite 2024 a 169,99 €. Usato: mia stima.'),
    ('Tablet, e-reader, smartwatch', 'Apple Watch SE 2ª generazione 44 mm GPS', '2022 · alluminio · chip S8', 'Usato, ottime condizioni, con cinturino e caricatore', '199–269', 110, 150, 120, 3,
     'Blocco attivazione, salute della batteria, graffi sul vetro, cinturino originale.', 'Nuovo da 199 € (prezzo.org); ricondizionato 162–204 € (Back Market, altri Paesi europei).'),
    ('Fumetti, manga, graphic novel', 'Zerocalcare — Quando muori resta a me', 'Bao Publishing 2024 · cartonato · 304 pagine', 'Usato, ottime condizioni', '≈ 20 (copertina: non l\'ho trovata sul web)', 9, 13, 10, 3,
     'Prima edizione, dedica o disegno autografo (vale molto di più), stato della copertina.', 'Dati editoriali confermati (Bao, ISBN 9791256210091); prezzo di copertina NON trovato online: è un mio ricordo.'),
    ('Fumetti, manga, graphic novel', 'Marjane Satrapi — Persepolis, edizione integrale', 'Rizzoli Lizard 2023 · 352 pagine', 'Usato, ottime condizioni', '15 (copertina)', 7, 10, 7.5, 3,
     'Edizione (2023 o 2007) e stato. Sotto i 10 € protezione e spedizione mangiano il margine: conviene solo in lotto.', 'Copertina 15 € (Libreria Universitaria). Usato: mia stima.'),
    ('Fumetti, manga, graphic novel', 'Chainsaw Man vol. 1–11 (prima parte completa)', 'Planet Manga · 11 volumi', 'Usati, ottime condizioni, serie completa', '57–67 (cofanetto; singoli 4,90–5,20)', 32, 42, 34, 4,
     'Serie completa e prima stampa, variant, cofanetto. I volumi sfusi valgono molto meno.', 'Cofanetto 57,20–66,90 € (AnimeClick). Usato: mia stima.'),
    ('Libri', 'Harry Potter — la serie completa, cofanetto 7 volumi', 'Salani · edizione 2024 o «Castello di Hogwarts»', 'Usato, ottime condizioni, cofanetto integro', '142,90 (listino)', 60, 85, 65, 6,
     'Edizione e traduzione, cofanetto integro. Le prime edizioni degli anni 2000 sono un mercato a parte.', 'Listino 142,90 € (Libraccio, Macrolibrarsi). Usato: mia stima.'),
    ('Libri', 'Torrente–Schlesinger — Manuale di diritto privato, 27ª edizione', 'Giuffrè 2025 · a cura di C. Granelli', 'Usato, ottime condizioni, non sottolineato', '≈ 75 (copertina non trovata; la 24ª edizione costava 66)', 40, 52, 42, 4,
     'L\'EDIZIONE DECIDE TUTTO: la 26ª (2023) vale 22–30 €, le precedenti quasi nulla. Sottolineature. Si vende a settembre–ottobre e a febbraio.', '27ª edizione 2025 (programma Università di Trieste); 24ª a 66 € (Libraccio); copia nuova a 43 € su Wallapop.'),
    ('Libri', 'Donatella Di Pietrantonio — L\'età fragile', 'Einaudi 2023 · Premio Strega 2024', 'Usato, ottime condizioni', '18 (copertina)', 6, 9, 6.5, 3,
     'Narrativa recente molto diffusa: tanti annunci, margine nullo da sola. Buona solo in lotto.', 'Prezzo di copertina da mio ricordo: NON cercato sul web.'),
    ('Sneakers', 'Nike Air Force 1 \'07 bianche', 'pelle · suola Air', 'Usate, ottime condizioni, pulite, con scatola', '119,99 (spesso 96–98 in sconto)', 35, 55, 40, 4,
     'Pieghe sulla punta, suola ingiallita, taglia (40–44 le più richieste), scatola. Nuove mai messe: 65–80 €.', 'Zalando 95,99 € (prezzo mediano 119,99); Attic 119,95 €. Usato: mia stima.'),
    ('Sneakers', 'adidas Samba OG', 'pelle e camoscio · suola in gomma', 'Usate, ottime condizioni', '120', 45, 65, 48, 4,
     'Colorazione (bianco/verde e nero le più richieste), usura del camoscio in punta, taglia.', 'Footpatrol 120 €; rivendita da nuove 73–142 € (StockX). Usato: mia stima.'),
    ('Sneakers', 'Nike Dunk Low Retro «Panda»', 'pelle bianca e nera', 'Usate, ottime condizioni', '120 (spesso 90 in sconto)', 40, 60, 42, 4,
     'Pieghe e crepe della pelle, falsi diffusi, taglia. Modello ormai molto comune: prezzi in discesa.', 'Highsnobiety e Bouncewear 120 €. Usato: mia stima.'),
    ('Abbigliamento di marca', 'Levi\'s 501 Original', 'denim · taglio dritto · chiusura a bottoni', 'Usati, ottime condizioni', '110 (spesso 55–84 in sconto)', 20, 35, 22, 3,
     'Taglia (W31–W34 le più richieste), lavaggio, vintage made in USA (vale il doppio), orlo accorciato.', 'Listino 110 € (levi.com Italia). Usato: mia stima.'),
    ('Abbigliamento di marca', 'The North Face 1996 Retro Nuptse (uomo)', 'piumino 700 · ripiegabile', 'Usato, ottime condizioni', '350', 140, 200, 150, 5,
     'FALSI DIFFUSI (ologramma ed etichette), colore (nero il più richiesto), taglia. Da ottobre a gennaio vale 20–30 € in più.', 'Listino 350 € (thenorthface.com Italia); rivendita 109–217 € (StockX).'),
    ('Abbigliamento di marca', 'Polo Ralph Lauren — polo in piqué', 'cotone · custom slim fit', 'Usata, ottime condizioni', '≈ 125–139 (non confermato: il sito italiano non mostra il prezzo)', 22, 35, 24, 3,
     'Falsi diffusi (logo ed etichetta), colore classico, taglia M–L, colletto non deformato.', 'Prezzo italiano NON trovato: stima da listini europei. Usato: mia stima.'),
    ('Sport e fitness', 'Kit manubri 20 kg Decathlon (Corength / Domyos)', '2 manubri avvitabili · dischi in ghisa', 'Usato, ottime condizioni', '49,99–54,99', 22, 32, 24, 10,
     '20 kg: la spedizione costa quasi quanto l\'oggetto. Conviene solo ritirato a mano.', 'Decathlon 49,99–54,99 € (Spagna, Malta). Usato e spedizione: mia stima.'),
    ('Sport e fitness', 'Garmin Forerunner 255 (46 mm)', '2022 · GPS multibanda · fino a 14 giorni di batteria', 'Usato, ottime condizioni, con cavo', '250–330 (listino 349,99)', 140, 190, 150, 3,
     'Graffi sul vetro, versione Music (+20 €), cinturino originale. Sono usciti il 265 e il 570.', 'Listino 349,99 €; usato 199–275 € (buycycle).'),
    ('Sport e fitness', 'Maglia gara home Serie A (replica), stagione 2025/26', 'Inter, Milan o Juventus · versione «stadium»', 'Usata, ottime condizioni, senza nome', '≈ 100–110 (maglia nuova 2026/27)', 30, 45, 32, 3,
     'Stagione (quella in corso vale di più), nome e numero stampati, versione authentic (+30 €), taglia.', 'Nike Stadium 2026/27: 109,99 € (Nike Portogallo), 89,99–99,99 sterline (Regno Unito). Usato: mia stima.'),
    ('LEGO e collezionismo', 'LEGO Star Wars 75257 Millennium Falcon', '2019 · 1.351 pezzi · 7 minifigure · fuori produzione', 'Usato completo, con istruzioni', '160–170 (listino 169,99)', 95, 125, 100, 7,
     'Completezza e minifigure (da sole valgono 30–40 €), istruzioni e scatola, pezzi ingialliti.', 'Listino 169,99 €; Galaxus 159,99 €; sigillato 2% sopra il listino (Brickfact, 11 novembre 2026).'),
    ('LEGO e collezionismo', 'Pokémon Scarlatto e Violetto 151 — Set Allenatore Fuoriclasse (ITA)', 'sigillato · 9 buste + carta promo', 'Nuovo sigillato', '≈ 300 sul mercato (listino d\'origine ≈ 60)', 240, 300, 250, 5,
     'RISIGILLATI E FALSI: pellicola originale e venditore con recensioni. Prezzo molto volatile.', '≈ 300 € sigillato (Money.it su dati Cardmarket, marzo 2026): dato vecchio di otto mesi.'),
    ('LEGO e collezionismo', 'LEGO Icons 10280 Bouquet di fiori', '756 pezzi · ritirato nel 2026', 'Usato completo, con istruzioni', '50–60 (listino 59,99)', 25, 35, 27, 5,
     'Completezza, polvere e pezzi ingialliti. Sigillato vale 42–50 €.', 'Listino 59,99 € (Unieuro); minimo 50,49 € (Brickfact, ottobre 2026). Usato: mia stima.'),
]


def ceiling(resale, shipping, margin_pct, min_profit):
    """The highest listing price that still leaves the margin after buyer protection and shipping; None when none does."""
    profit = max(resale * margin_pct / 100, min_profit)
    price = (resale - profit - FEE_FIXED - shipping) / (1 + FEE_PCT)
    if price < 1:
        return None
    return math.floor(price) if price >= 20 else math.floor(price * 2) / 2


def build():
    os.makedirs(OUT, exist_ok=True)
    records = []
    for i, (cat, name, specs, cond, new, lo, hi, resale, ship, moves, source) in enumerate(ROWS, start=1):
        records.append({
            'n': i, 'categoria': cat, 'articolo': name, 'specifiche': specs, 'condizioni': cond, 'nuovo': new, 'usato_da': lo, 'usato_a': hi,
            'rivendita_prudente': resale, 'spedizione': ship,
            'affare_fino_a': ceiling(resale, ship, 30, 5), 'buono_fino_a': ceiling(resale, ship, 15, 3), 'pari_a': ceiling(resale, ship, 0, 0),
            'cosa_cambia': moves, 'fonti': source,
        })
    with open(os.path.join(OUT, 'lista-taratura-30.json'), 'w', encoding='utf-8') as f:
        json.dump({'data': '2026-11-17', 'righe': records}, f, ensure_ascii=False, indent=1)

    wb = Workbook()
    ws = wb.active
    ws.title = 'Lista'
    head = ['N.', 'Categoria', 'Articolo', 'Specifiche', 'Condizioni ipotizzate', 'Nuovo oggi (€)', 'Usato tra privati (€)', 'Rivendo a, prudente (€)', 'Spedizione (€)',
            'AFFARE: compro fino a (€)', 'BUONO: compro fino a (€)', 'Sopra non conviene (€)', 'Cosa cambia il valore, rischi', 'Da dove vengono i prezzi',
            'IL TUO GIUDIZIO (perfetto / no)', 'Se «no»: perché, e a che prezzo avresti detto sì']
    ws.append(head)
    thin = Side(style='thin', color='D0D5DD')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for c in ws[1]:
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor='3730A3')
        c.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center')
        c.border = border
    money = lambda v: '—' if v is None else v
    for r in records:
        ws.append([r['n'], r['categoria'], r['articolo'], r['specifiche'], r['condizioni'], r['nuovo'], f"{r['usato_da']:g}–{r['usato_a']:g}".replace('.', ','), r['rivendita_prudente'], r['spedizione'],
                   money(r['affare_fino_a']), money(r['buono_fino_a']), money(r['pari_a']), r['cosa_cambia'], r['fonti'], '', ''])
    widths = [5, 20, 34, 34, 26, 26, 14, 13, 11, 14, 14, 14, 52, 46, 18, 46]
    for i, w in enumerate(widths):
        ws.column_dimensions[chr(65 + i)].width = w
    band = PatternFill('solid', fgColor='F4F3FF')
    mine = PatternFill('solid', fgColor='FFF7E6')
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical='top')
            c.border = border
        for c in row[9:12]:
            c.font = Font(bold=True)
            c.alignment = Alignment(horizontal='center', vertical='top')
        for c in row[7:9]:
            c.alignment = Alignment(horizontal='center', vertical='top')
        if (row[0].value - 1) // 3 % 2 == 0:
            for c in row[:14]:
                c.fill = band
        for c in row[14:16]:
            c.fill = mine
    ws.row_dimensions[1].height = 48
    ws.freeze_panes = 'D2'
    choice = DataValidation(type='list', formula1='"perfetto,no"', allow_blank=True)
    choice.error = 'Scrivi «perfetto» oppure «no»'
    ws.add_data_validation(choice)
    choice.add(f'O2:O{ws.max_row}')

    how = wb.create_sheet('Come leggere')
    lines = [
        ('Che cos\'è', 'Trenta articoli in dieci categorie, con i prezzi cercati sul web il 17 novembre 2026. Serve a tarare il giudizio dell\'app: dimmi dove ho ragione e dove sbaglio.'),
        ('Cosa fare', 'Per ogni riga scrivi nella penultima colonna «perfetto» oppure «no». Se è «no», nell\'ultima colonna scrivi perché e a che prezzo avresti detto sì (o quanto vale per te).'),
        ('Nuovo oggi', 'Il prezzo a cui si compra nuovo oggi, dal web. Dove è scritto «non confermato» o «mio ricordo» il web non me lo ha dato.'),
        ('Usato tra privati', 'La fascia a cui lo vedo in vendita tra privati in ottime condizioni. È una MIA STIMA ricavata dai prezzi del ricondizionato e della rivendita: da qui non posso leggere Vinted. L\'app invece lo legge dal vero, articolo per articolo.'),
        ('Rivendo a, prudente', 'Il prezzo su cui conterei rivendendo senza aspettare mesi: la parte bassa della fascia (il «quartile basso» che l\'app usa già).'),
        ('Spedizione', 'Quello che paghi di spedizione comprando su Vinted. Stima per peso e ingombro.'),
        ('AFFARE: compro fino a', 'Il prezzo dell\'annuncio sotto il quale l\'app darebbe un voto di almeno 85: rivendendo al valore prudente resta un guadagno del 30% (e di almeno 5 €) dopo la protezione acquisti (0,70 € + 5%) e la spedizione.'),
        ('BUONO: compro fino a', 'Sotto questo prezzo il voto sarebbe almeno 70: resta un guadagno del 15% (e di almeno 3 €).'),
        ('Sopra non conviene', 'A questo prezzo vai in pari: sopra, rivendere è una perdita. Può restare un buon acquisto per uso personale.'),
        ('Il trattino «—»', 'Nessun prezzo lascia quel guadagno: protezione e spedizione valgono più del margine. Succede con gli articoli sotto i 10–15 € comprati da soli.'),
        ('Formula', 'prezzo massimo = (rivendita − guadagno voluto − 0,70 − spedizione) / 1,05'),
        ('Cosa mi serve da te', 'Soprattutto tre cose: se il valore di rivendita è giusto, se il guadagno che chiedo (30% e 15%) è quello che vuoi tu, e quali categorie ti interessano davvero.'),
    ]
    how.column_dimensions['A'].width = 26
    how.column_dimensions['B'].width = 120
    for title, text in lines:
        how.append([title, text])
    for row in how.iter_rows():
        row[0].font = Font(bold=True)
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical='top')
    path = os.path.join(OUT, 'lista-taratura-30.xlsx')
    wb.save(path)
    return path, records


if __name__ == '__main__':
    path, records = build()
    print(os.path.normpath(path))
    for r in records:
        print(f"{r['n']:>2} {r['articolo'][:44]:<44} R {r['rivendita_prudente']:>6} S {r['spedizione']:>2} | affare {str(r['affare_fino_a']):>6} buono {str(r['buono_fino_a']):>6} pari {str(r['pari_a']):>6}")
