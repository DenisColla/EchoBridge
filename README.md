# EchoBridge

Monorepo di applicazioni web/mobile.

| Cartella | App |
| --- | --- |
| `echobridge/` | App per la riabilitazione uditiva in pazienti con ipoacusia |
| `vinted-offer-analyzer/` | Offerta Vinted Timing: analizzatore di offerte Vinted che calcola il momento ottimale per inviare un'offerta al ribasso (web) |
| `vinted-offer-analyzer/mobile/` | La stessa app come APK Android con notifiche, calendario e lista da comprare: `start.bat` fa tutto |

Ogni cartella è un progetto Vite + React indipendente: `cd <cartella> && npm install && npm run dev`.
