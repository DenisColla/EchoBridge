// "Capelli" tool: hairstyle, colour, length / volume / parting / bangs, facial hair.
// Edits ch.data.hair of the selected character; the rig picks the change up on
// the next frame (geometry rebuilds are throttled while a slider is dragged).
import { h, section, slider, segmented, cardGrid, swatches, toggle, haptic } from '../ui/kit.js';
import { STYLES, STYLE_BY_ID } from './styles.js';
import { NATURAL_COLORS, COMIC_COLORS, BEARDS } from './state.js';
import { styleIconURL, beardIconURL } from './icons.js';
import './hair.css';

/**
 * @param {HTMLElement} el tool container
 * @param {import('../app.js').App} app
 * @param {object} ctl module controller (setColor, changed)
 */
export function buildHairPanel(el, app, ctl) {
  let ch = null;
  const st = () => ch?.data.hair;

  const styleGrid = cardGrid({
    items: STYLES.map((s) => ({ id: s.id, label: s.label, thumb: styleIconURL(s.id) })),
    value: null, columns: 4,
    onSelect: (id) => {
      if (!ch) return;
      haptic('tick');
      const def = STYLE_BY_ID.get(id);
      const s = st();
      if (s.style === id) return;
      s.style = id;
      if (def.part) s.parting = def.part;
      ctl.changed(ch, 'acconciatura', true);
      refresh();
    },
  });

  const natural = swatches({ colors: NATURAL_COLORS.map((c) => c.hex), value: null, allowCustom: false, onChange: (hex) => setColor(hex) });
  const comic = swatches({ colors: COMIC_COLORS.map((c) => c.hex), value: null, allowCustom: true, onChange: (hex) => setColor(hex, true) });
  // tooltips with Italian colour names
  [...natural.children].forEach((b, i) => { b.title = NATURAL_COLORS[i].label; b.setAttribute('aria-label', NATURAL_COLORS[i].label); });
  [...comic.children].forEach((b, i) => { if (COMIC_COLORS[i]) { b.title = COMIC_COLORS[i].label; b.setAttribute('aria-label', COMIC_COLORS[i].label); } else { b.title = 'Colore personalizzato'; b.setAttribute('aria-label', 'Colore personalizzato'); } });
  const colorName = h('span', { class: 'pv-hair-color-name' });

  let commitT = 0;
  function setColor(hex, custom = false) {
    if (!ch) return;
    ctl.setColor(ch, hex);
    showColor(hex);
    // the custom picker fires continuously: one undo step when it settles
    clearTimeout(commitT);
    commitT = setTimeout(() => app.commit('colore capelli'), custom ? 450 : 0);
  }

  const lengthS = slider({
    label: 'Lunghezza', min: 0, max: 1, step: 0.01, value: 0.5, defaultValue: 0.5,
    format: (v) => Math.round(v * 100) + '%',
    onInput: (v) => { if (ch) { st().length = v; ctl.changed(ch); } },
    onChange: () => ch && app.commit('lunghezza capelli'),
  });
  const volumeS = slider({
    label: 'Volume', min: 0, max: 1, step: 0.01, value: 0.5, defaultValue: 0.5,
    format: (v) => Math.round(v * 100) + '%',
    onInput: (v) => { if (ch) { st().volume = v; ctl.changed(ch); } },
    onChange: () => ch && app.commit('volume capelli'),
  });
  const partSeg = segmented({
    options: [{ value: 'left', label: 'Sinistra' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Destra' }],
    value: 'center',
    onChange: (v) => { if (!ch) return; haptic('tick'); st().parting = v; ctl.changed(ch, 'riga', true); },
  });
  const partRow = h('div', { class: 'pv-hair-field' }, h('div', { class: 'pv-hair-field-label' }, 'Riga'), partSeg);
  const bangsT = toggle({ label: 'Frangia', value: false, onChange: (v) => { if (!ch) return; haptic('tick'); st().bangs = v; ctl.changed(ch, 'frangia', true); } });

  const beardGrid = cardGrid({
    items: BEARDS.map((b) => ({ id: b.id, label: b.label, thumb: beardIconURL(b.id) })),
    value: null, columns: 5,
    onSelect: (id) => {
      if (!ch || st().beard === id) return;
      haptic('tick');
      st().beard = id;
      ctl.changed(ch, 'barba', true);
      refresh();
    },
  });

  const empty = h('div', { class: 'pv-hair-empty' }, 'Seleziona un personaggio per cambiarne i capelli.');
  const adjust = section('Regolazioni', [lengthS, volumeS, partRow, bangsT]);
  const body = h('div', { class: 'pv-hair-panel' },
    section('Acconciatura', [styleGrid]),
    section('Colore', [natural, h('div', { class: 'pv-hair-sub' }, 'Fumetto'), comic, colorName]),
    adjust,
    section('Barba e baffi', [beardGrid]),
  );
  el.append(empty, body);

  /** Highlights the swatch of a colour (the custom picker only for colours outside the presets). */
  function showColor(hex) {
    const isNatural = NATURAL_COLORS.some((c) => c.hex === hex);
    natural.setValue(isNatural ? hex : '');
    comic.setValue(isNatural ? '' : hex);
    colorName.textContent = nameOf(hex);
  }

  function nameOf(hex) {
    const c = [...NATURAL_COLORS, ...COMIC_COLORS].find((x) => x.hex === hex);
    return c ? c.label : 'Personalizzato';
  }

  function refresh() {
    ch = app.selection.character;
    empty.style.display = ch ? 'none' : '';
    body.style.display = ch ? '' : 'none';
    if (!ch || !st()) return;
    const s = st(), def = STYLE_BY_ID.get(s.style);
    styleGrid.setValue(s.style);
    showColor(s.color);
    lengthS.setValue(s.length); volumeS.setValue(s.volume);
    lengthS.style.display = def.length ? '' : 'none';
    volumeS.style.display = def.volume ? '' : 'none';
    partRow.style.display = def.part ? '' : 'none';
    partSeg.setValue(s.parting);
    bangsT.style.display = def.bangs ? '' : 'none';
    bangsT.setValue(s.bangs);
    adjust.style.display = def.length || def.volume || def.part || def.bangs ? '' : 'none';
    beardGrid.setValue(s.beard);
  }

  const onSel = () => { if (el.isConnected) refresh(); };
  app.addEventListener('selection', onSel);
  app.addEventListener('loaded', onSel);
  app.addEventListener('history', onSel);
  return { onShow: refresh, refresh };
}
