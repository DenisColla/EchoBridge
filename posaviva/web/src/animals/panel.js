// "Animali" tool (group Personaggi): species catalog by group, then the
// editor of the selected animal: ready poses, body parts with sliders,
// mouth, coat, size / age, placement.
import { h, section, slider, button, chips, cardGrid, swatches, icon, haptic, toast, confirmDialog } from '../ui/kit.js';
import { posesFor } from './poses.js';
import { ageScales } from './Animal.js';

export const GROUPS = [
  { id: 'all', label: 'Tutti' },
  { id: 'domestici', label: 'Domestici' },
  { id: 'fattoria', label: 'Fattoria' },
  { id: 'selvatici', label: 'Selvatici' },
  { id: 'esotici', label: 'Esotici' },
  { id: 'uccelli', label: 'Uccelli' },
  { id: 'marini', label: 'Marini' },
  { id: 'rettili', label: 'Rettili' },
  { id: 'fantasy', label: 'Fantasy' },
];

const PART_ORDER = ['head', 'neck', 'jaw', 'tongue', 'ear', 'crest', 'back', 'body', 'front', 'mid', 'tail', 'tailtip', 'fluke', 'trunk', 'wings', 'wing', 'wingtip', 'fin', 'pelvic', 'dorsal', 'shoulder', 'arm', 'forearm', 'wrist', 'fpaw', 'thigh', 'shin', 'hock', 'hpaw', 'toes'];

export function registerAnimalsTool(app, shell, ctx) {
  const { manager, thumbs, applyPreset, focus } = ctx;
  let root = null, strip = null, body = null, shown = false;
  let group = 'all';
  let editorFor = null; // animal the editor was built for
  let partBox = null, poseChips = null, sliders = [];

  shell.registerTool({
    id: 'animals', label: 'Animali', icon: 'paw', group: 'people', order: 20, title: 'Animali',
    build(el) {
      root = el;
      el.classList.add('pv-an-panel');
      strip = h('div', { class: 'pv-chips pv-an-strip' });
      body = h('div', { class: 'pv-an-body' });
      el.append(strip, body);
      render();
      return {
        onShow() { shown = true; render(); app.invalidate(); },
        onHide() { shown = false; app.invalidate(); },
      };
    },
  });

  for (const ev of ['list', 'select']) manager.addEventListener(ev, () => render());
  manager.addEventListener('change', (e) => { if (e.what === 'pose' || e.what === 'placement') refreshValues(); });
  app.addEventListener('loaded', () => render());

  function render() {
    if (!root || !shown) return;
    renderStrip();
    const a = manager.selected;
    if (!a) { editorFor = null; renderCatalog(); return; }
    if (editorFor !== a) renderEditor(a); else { renderParts(a); refreshValues(); }
  }

  // ------------------------------------------------------------ strip of animals in the scene
  function renderStrip() {
    strip.innerHTML = '';
    const list = manager.animals;
    const add = h('button', { type: 'button', class: 'pv-chip pv-an-add' + (manager.selected ? '' : ' active') }, icon('plus', 18), 'Aggiungi');
    add.addEventListener('click', () => manager.select(null));
    strip.appendChild(add);
    const counts = {};
    for (const a of list) {
      counts[a.species] = (counts[a.species] || 0) + 1;
      const many = list.filter((b) => b.species === a.species).length > 1;
      const c = h('button', { type: 'button', class: 'pv-chip' + (a === manager.selected ? ' active' : '') }, icon('paw', 16), a.entry.label + (many ? ' ' + counts[a.species] : ''));
      c.addEventListener('click', () => manager.select(a));
      strip.appendChild(c);
    }
    strip.style.display = list.length ? '' : 'none';
  }

  // ------------------------------------------------------------ catalog
  function renderCatalog() {
    body.innerHTML = '';
    const man = manager.manifest;
    if (!man) {
      body.appendChild(h('div', { class: 'pv-an-note' }, 'Caricamento degli animali…'));
      manager.ready.then(() => render());
      return;
    }
    body.appendChild(h('div', { class: 'pv-an-note' }, 'Tocca un animale: compare accanto al personaggio. Poi tocca una parte del corpo (testa, zampe, coda…) per posarla, o scegli una posa pronta.'));
    const gchips = chips({ items: GROUPS, value: group, onSelect: (id) => { group = id; gchips.setValue(id); fill(); } });
    gchips.classList.add('pv-an-groups');
    const grid = h('div', { class: 'pv-an-grid' });
    body.append(gchips, grid);
    function fill() {
      grid.innerHTML = '';
      const items = man.species.filter((s) => group === 'all' || s.group === group);
      const g = cardGrid({ items: items.map((s) => ({ id: s.id, label: s.label })), columns: 3, onSelect: (id) => addAnimal(id) });
      const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) { thumbs.request(en.target); io.unobserve(en.target); } }, { root: null, rootMargin: '120px' }) : null;
      g.querySelectorAll('.pv-card').forEach((card) => {
        const s = man.species.find((x) => x.id === card.dataset.id);
        const img = thumbs.imageFor(s);
        card.insertBefore(h('div', { class: 'pv-card-visual' }, img), card.firstChild);
        if (s.sub) card.querySelector('.pv-card-label').appendChild(h('small', {}, s.sub));
        if (io) io.observe(img); else thumbs.request(img);
      });
      grid.appendChild(g);
    }
    fill();
  }

  let adding = false;
  async function addAnimal(id) {
    if (adding) return;
    adding = true;
    haptic('light');
    try {
      const a = await manager.add(id);
      app.commit('aggiungi animale');
      focus(a, 'body', { withCharacter: true });
      shell.hint('Tocca una parte del corpo per posarla · trascina per spostare', 2600);
      void a;
    } catch (e) {
      console.error('[animals] add failed', e);
      toast('Impossibile caricare l’animale', { kind: 'error' });
    } finally { adding = false; }
  }

  // ------------------------------------------------------------ editor
  function renderEditor(a) {
    editorFor = a;
    body.innerHTML = '';
    sliders = [];
    const title = h('div', { class: 'pv-an-head' },
      h('span', { class: 'pv-an-title' }, a.entry.label, a.entry.sub ? h('small', {}, ' · ' + a.entry.sub) : null),
      button({ icon: 'zoom', small: true, title: 'Inquadra', onClick: () => focus(a, manager.part || 'body') }),
      button({ icon: 'copy', small: true, title: 'Duplica', onClick: async () => { await manager.duplicate(a); app.commit('duplica animale'); } }),
      button({ icon: 'trash', small: true, variant: 'danger', title: 'Elimina', onClick: async () => {
        if (await confirmDialog('Eliminare questo animale dalla scena?', { title: 'Elimina animale', okLabel: 'Elimina', danger: true })) { manager.remove(a); app.commit('elimina animale'); }
      } }),
    );
    body.appendChild(title);

    // ---- ready poses
    const poses = posesFor(a.entry);
    poseChips = chips({ items: poses.map((p) => ({ id: p.id, label: p.label })), value: a.lastPreset || null, onSelect: (id) => {
      applyPreset(a, id);
      a.lastPreset = id;
      poseChips.setValue(id);
      app.commit('posa animale');
      haptic('light');
    } });
    poseChips.classList.add('pv-an-poses');
    const poseRow = h('div', { class: 'pv-row pv-an-actions' },
      button({ label: 'Specchia', icon: 'mirror', small: true, onClick: () => { a.mirrorPose(); a.dropToGround(); app.commit('specchia posa'); } }),
      button({ label: 'Azzera', icon: 'reset', small: true, onClick: () => { a.resetPose(); a.dropToGround(); a.lastPreset = 'stand'; poseChips.setValue('stand'); app.commit('azzera posa'); } }),
      button({ label: 'A terra', icon: 'ground', small: true, onClick: () => { a.root.position.y = manager.floorUnder(a); a.dropToGround(); refreshValues(); app.commit('animale a terra'); } }),
    );
    body.appendChild(section('Pose pronte', [poseChips, poseRow]));

    // ---- parts
    partBox = h('div', { class: 'pv-an-parts' });
    body.appendChild(section('Parti del corpo', [h('div', { class: 'pv-an-note' }, 'Tocca una parte sull’animale o sceglila qui.'), partBox]));
    renderParts(a);

    // ---- mouth (quick)
    const jaw = a.controls.byId.get('jaw');
    if (jaw) {
      const s = slider({ label: 'Bocca aperta', min: 0, max: jaw.axes[0].max, step: 1, value: a.getAxis(jaw, jaw.axes[0]), format: (v) => Math.round(v) + '°',
        onInput: (v) => a.setAxis(jaw, jaw.axes[0], v), onChange: () => app.commit('bocca animale') });
      s._get = () => a.getAxis(jaw, jaw.axes[0]);
      sliders.push(s);
      body.appendChild(section('Bocca', [s]));
    }

    // ---- appearance
    const pals = a.entry.palettes;
    const palChips = chips({ items: pals.map((p) => ({ id: p.id, label: p.label })), value: a.customColor ? null : a.palette, onSelect: (id) => { a.setPalette(id); palChips.setValue(id); sw.setValue(null); app.commit('mantello'); } });
    palChips.querySelectorAll('.pv-chip').forEach((c) => {
      const p = pals.find((x) => x.id === c.dataset.id);
      c.prepend(h('span', { class: 'pv-an-dot', style: { background: `linear-gradient(135deg, ${p.colors.base} 55%, ${p.colors.pattern || p.colors.under || p.colors.base} 55%)` } }));
    });
    const sw = swatches({ colors: [], value: a.customColor, allowCustom: true, onInput: (c) => { a.setCustomColor(c); palChips.setValue(null); }, onChange: (c) => { a.setCustomColor(c); palChips.setValue(null); app.commit('colore animale'); } });
    const size = slider({ label: 'Taglia', min: 50, max: 150, step: 1, value: Math.round(a.size * 100), format: (v) => v + '%',
      onInput: (v) => { a.setSize(v / 100); a.dropToGround(); }, onChange: () => app.commit('taglia animale') });
    size._get = () => Math.round(a.size * 100);
    const age = slider({ label: 'Età', min: 0, max: 100, step: 1, value: Math.round(a.age * 100), format: (v) => (v < 25 ? 'Cucciolo' : v < 70 ? 'Giovane' : 'Adulto'),
      onInput: (v) => { a.setAge(v / 100); a.dropToGround(); }, onChange: () => app.commit('età animale') });
    age._get = () => Math.round(a.age * 100);
    sliders.push(size, age);
    const hgt = h('div', { class: 'pv-an-note pv-an-height' });
    const updH = () => { hgt.textContent = `${a.entry.heightLabel || 'Altezza al garrese circa'} ${(a.entry.height * a.size * ageScales(a.age).body).toFixed(2)} m`; };
    updH();
    size.input.addEventListener('input', updH); age.input.addEventListener('input', updH);
    body.appendChild(section('Mantello e taglia', [palChips, h('div', { class: 'pv-row pv-an-custom' }, h('span', {}, 'Colore libero'), sw), size, age, hgt]));

    // ---- placement
    const rot = slider({ label: 'Rotazione', min: -180, max: 180, step: 1, value: Math.round(deg(a.root.rotation.y)), format: (v) => v + '°',
      onInput: (v) => { a.root.rotation.y = (v * Math.PI) / 180; a.root.updateMatrixWorld(true); app.invalidate(); }, onChange: () => app.commit('ruota animale') });
    rot._get = () => Math.round(deg(wrapA(a.root.rotation.y)));
    sliders.push(rot);
    // height above the floor: birds on a perch, flying or swimming animals, a cat on a wall
    // (above the ground under it: a ready landscape's terrain, else the floor y = 0)
    const lift = slider({ label: 'Altezza da terra', min: 0, max: 600, step: 1, value: Math.round((a.root.position.y - manager.floorUnder(a)) * 100), format: (v) => (v / 100).toFixed(2) + ' m',
      defaultValue: 0,
      onInput: (v) => { a.root.position.y = manager.floorUnder(a) + v / 100; a.root.updateMatrixWorld(true); app.invalidate(); }, onChange: () => { manager.dispatchEvent({ type: 'change', animal: a, what: 'placement' }); app.commit('altezza animale'); } });
    lift._get = () => Math.round((a.root.position.y - manager.floorUnder(a)) * 100);
    sliders.push(lift);
    body.appendChild(section('Posizione', [h('div', { class: 'pv-an-note' }, 'Trascina l’animale per spostarlo; usa l’anello arancione per girarlo.'), rot, lift]));
  }

  // ------------------------------------------------------------ parts + sliders
  function renderParts(a) {
    if (!partBox) return;
    partBox.innerHTML = '';
    const list = [...a.controls.list].sort((x, y) => PART_ORDER.indexOf(baseId(x.id)) - PART_ORDER.indexOf(baseId(y.id)));
    const pc = chips({ items: list.map((c) => ({ id: c.id, label: c.label })), value: manager.part, onSelect: (id) => manager.selectPart(manager.part === id ? null : id) });
    pc.classList.add('pv-an-partchips');
    partBox.appendChild(pc);
    const ctrl = manager.part && a.controls.byId.get(manager.part);
    // keep slider list for global refresh (bocca, taglia…) but drop old part sliders
    sliders = sliders.filter((s) => !s._part);
    if (!ctrl) return;
    const box = h('div', { class: 'pv-an-partbox' });
    box.appendChild(h('div', { class: 'pv-an-partname' }, ctrl.label));
    for (const ax of ctrl.axes) {
      const s = slider({ label: ax.label, min: ax.min, max: ax.max, step: 1, value: Math.round(a.getAxis(ctrl, ax)), format: (v) => Math.round(v) + (ax.unit || '°'),
        defaultValue: ax.k === 'blend' ? (ax.invert ? ax.max : ax.min) : 0,
        onInput: (v) => a.setAxis(ctrl, ax, v), onChange: () => app.commit('posa ' + ctrl.label.toLowerCase()) });
      s._get = () => a.getAxis(ctrl, ax);
      s._part = true;
      sliders.push(s);
      box.appendChild(s);
    }
    const row = h('div', { class: 'pv-row pv-an-actions' },
      button({ label: 'Azzera parte', icon: 'reset', small: true, onClick: () => { a.resetControl(ctrl); app.commit('azzera parte'); } }),
      ctrl.mirror ? button({ label: 'Copia sull’altro lato', icon: 'swap', small: true, onClick: () => { a.mirrorControl(ctrl); app.commit('copia lato'); } }) : null,
      button({ icon: 'zoom', small: true, title: 'Inquadra la parte', onClick: () => focus(a, ctrl.id) }),
    );
    box.appendChild(row);
    partBox.appendChild(box);
    const active = pc.querySelector('.pv-chip.active');
    if (active) requestAnimationFrame(() => active.scrollIntoView({ block: 'nearest', inline: 'center' }));
  }

  let raf = 0;
  function refreshValues() {
    if (!shown || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      for (const s of sliders) if (s._get && !s.contains(document.activeElement)) s.setValue(Math.round(s._get()));
    });
  }
}

const baseId = (id) => id.replace(/\.[LR]$/, '');
const deg = (r) => (r * 180) / Math.PI;
function wrapA(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
