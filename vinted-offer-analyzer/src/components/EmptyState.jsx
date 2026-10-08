import { CalendarClock, Gauge, MessageSquare } from 'lucide-react'
import { SURFACE, cx } from '../theme.js'
import { Card } from './ui/Card.jsx'

const ITEMS = [
  { icon: Gauge, title: 'Score di fattibilità', text: 'Probabilità di accettazione e livello di rischio dello sconto richiesto.' },
  { icon: CalendarClock, title: 'Verdetto temporale', text: 'Giorno, ora e finestra del mese in cui inviare l\'offerta, con la motivazione.' },
  { icon: MessageSquare, title: 'Messaggio pronto', text: 'Un testo da copiare su Vinted, nel tono giusto per il livello di rischio.' },
]

export function EmptyState() {
  return (
    <Card muted eyebrow="Risultato" title="Compila i dati e premi “Calcola momento ottimale”">
      <ul className="grid gap-3 sm:grid-cols-3">
        {ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.title} className={cx('rounded-xl p-3', SURFACE.card)}>
              <Icon className="h-5 w-5 text-teal-700 dark:text-teal-300" aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold">{item.title}</p>
              <p className={cx('mt-1 text-xs leading-relaxed', SURFACE.muted)}>{item.text}</p>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
