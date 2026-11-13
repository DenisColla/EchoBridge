import { View } from 'react-native'
import { formatEuro } from '../../core/index.js'
import { VINTED_KIND_LABEL } from '../services/vintedEvents.js'
import { statusMeta } from '../services/storage.js'
import { space } from '../theme.js'
import { Body, Button, Card, InlineAction } from './ui.js'

/**
 * What Vinted's notifications changed or ask, on top of the Lista: an automatic update (with «Annulla»), a doubtful
 * match to confirm, a counter-offer to answer, a discount or a price drop to look at.
 */
export function VintedNotices({ bridge, items, onCounter, onReanalyze, onGoCalcola }) {
  if (!bridge || !bridge.notices || !bridge.notices.length) return null
  const itemOf = (n) => (n.itemId ? items.find((it) => it.id === n.itemId) : null)
  return (
    <View style={{ gap: space.sm }}>
      {bridge.notices.slice(-4).reverse().map((n) => {
        const item = itemOf(n)
        const title = n.itemTitle || (item && item.title) || 'un articolo'
        const what = VINTED_KIND_LABEL[n.kind] || 'Notifica di Vinted'
        const price = Number.isFinite(n.price) ? ` · ${formatEuro(n.price)}` : ''
        return (
          <Card key={n.id} muted>
            <Body small muted>Da Vinted · {what}{price}</Body>
            {n.action === 'auto' ? <Body>«{title}» segnata come {statusMeta(n.status).label.toLowerCase()}.</Body> : null}
            {n.action === 'ask' ? <Body>È l'offerta per «{title}»? La segno come {statusMeta(n.status).label.toLowerCase()}.</Body> : null}
            {n.action === 'counter' ? <Body>Il venditore di «{title}» ha proposto {Number.isFinite(n.price) ? formatEuro(n.price) : 'una cifra'}: calcolo la risposta.</Body> : null}
            {n.action === 'info' ? <Body>Novità su «{title}»: {n.text || what.toLowerCase()}.</Body> : null}
            {n.action === 'unmatched' ? <Body>Vinted segnala: «{n.text}». Non trovo l'offerta in Lista.</Body> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md }}>
              {n.action === 'auto' ? <InlineAction label="Annulla" onPress={() => bridge.undo(n)} /> : null}
              {n.action === 'ask' ? <Button label="Sì, aggiorna" small onPress={() => bridge.confirm(n)} /> : null}
              {n.action === 'counter' && item ? <Button label="Rispondi" small onPress={() => { onCounter(item, n.price); bridge.dismiss(n.id) }} /> : null}
              {n.action === 'info' && item && onReanalyze ? <Button label="Ricalcola" small variant="secondary" onPress={() => { onReanalyze(item); bridge.dismiss(n.id) }} /> : null}
              {n.action === 'unmatched' && onGoCalcola ? <Button label="Vai a Calcola" small variant="secondary" onPress={() => { onGoCalcola(); bridge.dismiss(n.id) }} /> : null}
              <InlineAction label={n.action === 'ask' ? 'No' : 'Chiudi'} tone="neutral" onPress={() => bridge.dismiss(n.id)} />
            </View>
          </Card>
        )
      })}
    </View>
  )
}
