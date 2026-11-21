// "Pose pronte" tool: category chips + grid of pose cards with lazily rendered
// clay thumbnails (cached in memory + localStorage), "Specchia" toggle.
// The preset list (library.js, owned by the pose-library engineer) may be empty
// or grow: the grid is rebuilt whenever its signature changes.
import { h, chips, toggle, toast, haptic, icon } from '../ui/kit.js';
import { POSE_CATEGORIES, POSE_PRESETS, applyPosePreset } from './library.js';
import { getThumbRenderer } from './thumbs.js';

export function registerPresetsTool(ctx) {
  const { app, shell } = ctx;
  let thumbs = null; // created on first show (allocates a render target)

  shell.registerTool({
    id: 'poselib', group: 'pose', label: 'Pose pronte', icon: 'people', order: 15,
    build(el) {
      let category = 'all';
      let mirror = false;
      let lastApplied = null;
      const chipHost = h('div', { style: { flex: '1', minWidth: '0' } });
      const mirrorToggle = toggle({ label: 'Specchia', value: false, onChange: (v) => { mirror = v; haptic('tick'); } });
      mirrorToggle.classList.add('pv-pose-mirror-toggle');
      const grid = h('div', { class: 'pv-pose-lib-grid' });
      const empty = h('div', { class: 'pv-pose-lib-empty' });
      el.append(h('div', { class: 'pv-pose-lib-top' }, chipHost), mirrorToggle, h('div', { style: { height: '10px' } }), grid, empty);

      let sig = '';
      let cards = new Map(); // id -> {card, thumb}
      function categories() {
        const used = new Set(POSE_PRESETS.map((p) => p.category));
        return [{ id: 'all', label: 'Tutte' }, ...POSE_CATEGORIES.filter((c) => used.has(c.id))];
      }
      function rebuild() {
        const s = POSE_PRESETS.length + '|' + POSE_PRESETS.map((p) => p.id).join(',') + '|' + category;
        if (s === sig) return;
        sig = s;
        const cats = categories();
        if (!cats.some((c) => c.id === category)) category = 'all';
        chipHost.replaceChildren(chips({ items: cats, value: category, onSelect: (id) => { category = id; haptic('tick'); rebuild(); } }));
        grid.replaceChildren();
        cards = new Map();
        const list = POSE_PRESETS.filter((p) => category === 'all' || p.category === category);
        empty.style.display = list.length ? 'none' : '';
        empty.replaceChildren(icon('pose', 30), h('div', {}, POSE_PRESETS.length ? 'Nessuna posa in questa categoria.' : 'Le pose pronte non sono ancora disponibili.'));
        for (const p of list) {
          const thumb = h('div', { class: 'pv-pose-thumb loading' });
          const card = h('button', { type: 'button', class: 'pv-pose-card', title: p.label }, thumb, h('span', { class: 'pv-pose-card-label' }, p.label));
          card.addEventListener('click', () => apply(p));
          grid.appendChild(card);
          cards.set(p.id, { card, thumb, preset: p });
        }
        markActive();
        requestThumbs();
      }
      function markActive() { for (const [id, c] of cards) c.card.classList.toggle('active', id === lastApplied); }
      function apply(p) {
        const ch = app.selection.character;
        if (!ch) { toast('Seleziona un personaggio', { kind: 'warning' }); return; }
        haptic('tick');
        if (!applyPosePreset(ch, p.id, { mirror })) return;
        applying = true;
        try { ctx.edited(ch, true, 'posa: ' + p.label.toLowerCase()); } finally { applying = false; }
        lastApplied = p.id; lastChar = ch;
        markActive();
      }
      // the 'active' mark means "this character has this pose": any other edit, undo or
      // another selected character clears it
      let applying = false, lastChar = null;
      ctx.onChange((reason) => {
        if (applying || !lastApplied) return;
        if (reason === 'pose-final' || (reason === 'selection' && app.selection.character !== lastChar)) { lastApplied = null; markActive(); }
      });
      app.addEventListener('loaded', () => { if (lastApplied) { lastApplied = null; markActive(); } }); // undo / redo / scene load

      // thumbnails: render visible cards first, one per frame
      let io = null;
      const visibleIds = new Set();
      function requestThumbs() {
        if (!thumbs) return;
        io?.disconnect();
        io = new IntersectionObserver((entries) => {
          for (const e of entries) { const id = e.target.dataset.pid; if (e.isIntersecting) visibleIds.add(id); else visibleIds.delete(id); }
          pump();
        }, { root: null, rootMargin: '200px' });
        for (const [id, c] of cards) {
          c.card.dataset.pid = id;
          const url = thumbs.cached(c.preset, sexOf());
          if (url) setThumb(c, url); else io.observe(c.card);
        }
      }
      function sexOf() { return app.selection.character?.sex || 'F'; }
      function setThumb(c, url) {
        c.thumb.classList.remove('loading');
        c.thumb.replaceChildren(h('img', { src: url, alt: '' }));
        c.done = true;
      }
      let pumping = false;
      function pump() {
        if (pumping || !shown) return;
        const next = [...cards.values()].find((c) => !c.done && (visibleIds.has(c.preset.id) || visibleIds.size === 0));
        if (!next) return;
        pumping = true;
        requestAnimationFrame(() => {
          pumping = false;
          if (!shown || !cards.has(next.preset.id)) return;
          try { setThumb(next, thumbs.render(next.preset, sexOf())); }
          catch (e) { console.warn('[pose] thumbnail failed', e); next.done = true; next.thumb.classList.remove('loading'); next.thumb.replaceChildren(icon('pose', 28)); }
          io?.unobserve(next.card);
          visibleIds.delete(next.preset.id);
          // keep going while visible cards are missing
          if ([...cards.values()].some((c) => !c.done && visibleIds.has(c.preset.id))) pump();
          else setTimeout(pump, 30);
        });
      }

      let shown = false;
      let lastSex = null;
      return {
        onShow() {
          shown = true;
          thumbs ||= getThumbRenderer(app);
          if (lastSex !== sexOf()) { lastSex = sexOf(); sig = ''; }
          rebuild();
          requestThumbs();
          pump();
        },
        onHide() { shown = false; io?.disconnect(); thumbs?.persist(); },
      };
    },
  });
}
