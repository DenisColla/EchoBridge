// "Guida": in-app, offline, step-by-step guide (menu ☰ › Guida, "?" in the top bar).
//
//  - index: search (accent-insensitive), quick index of chapters, "Inizia da qui", topics by chapter
//  - topic: illustration, where it is, numbered steps with inline icons, tips, "Prova ora"
//    (opens the tool / pose mode, highlights an on-screen control or runs an action), see also,
//    previous / next
//  - portrait: one pane at a time (Android back: topic -> index -> close);
//    wide / landscape: index and topic side by side
//  - only topics (and steps) whose feature is present in the running app are shown;
//    placeholders for the next phases (status 'planned') are never shown
// Pure DOM, built when opened: no per-frame work.
import './guide.css';
import { h, icon, iconButton, modal, haptic, toast } from '../ui/kit.js';
import { ICON_NAMES } from '../ui/icons.js';
import { Character } from '../core/Character.js';
import { CHAPTERS, TOPICS, START_HERE } from './guideData.js';
import { ART } from './art.js';

const ICONS = new Set(ICON_NAMES);
const WORD = /[a-z0-9]/;
const WIDE = '(min-width: 700px)';

/** On-screen controls the guide can point at ("Mostrami dov'è"). */
export const SPOTS = {
  zoom: { sel: '.pv-focus-fab', label: 'Zoom rapido' },
  menu: { sel: '.pv-io-menu-btn', label: 'Menu' },
  history: { sel: '.pv-io-history', label: 'Annulla e ripeti' },
  help: { sel: '.pv-io-help-btn', label: 'Guida' },
  toolbar: { sel: '.pv-toolbar', label: 'Barra degli strumenti' },
  chip: { sel: '.pv-io-chip', label: 'Personaggio selezionato' },
  mic: { sel: '.pv-vc-fab', label: 'Comandi vocali' },
};

/** Tools that act on the selected character (the guide selects one before opening them). */
const CHARACTER_TOOLS = new Set(['pose', 'poselib', 'hands', 'face', 'body', 'clothes', 'hair']);

// ---------------------------------------------------------------- feature checks
/** What the data's `when(env)` predicates can ask about the running app. */
export function guideEnv(app, shell) {
  return {
    app, shell,
    tool: (id) => !!shell?.tools?.some((t) => t.id === id),
    posing: (fn) => typeof app?.posing?.[fn] === 'function',
    poseState: (key) => { try { return !!app?.posing && key in (app.posing.state || {}); } catch { return false; } },
    renderHas: (key) => app?.modules?.render?.[key] != null,
    renderSetting: (key) => { try { return app?.modules?.render?.getSettings?.()?.[key] !== undefined; } catch { return false; } },
    characterHas: (key) => key in Character.prototype,
  };
}

const ok = (env, when) => { if (!when) return true; try { return !!when(env); } catch { return false; } };
const items = (env, list) => (list || []).filter((x) => typeof x === 'string' || ok(env, x.when)).map((x) => (typeof x === 'string' ? x : x.t));

/** Topics shown to the user (placeholders and missing features removed), steps/tips resolved. */
export function visibleTopics(env) {
  const out = [];
  for (const t of TOPICS) {
    if (t.status === 'planned' || !ok(env, t.when)) continue;
    const steps = items(env, t.steps);
    if (!steps.length) continue;
    let go = t.go || null;
    if (go?.tool && !env.tool(go.tool)) go = null;
    out.push({ ...t, steps, tips: items(env, t.tips), go });
  }
  return out;
}

/** Topic id matching what is on screen (open tool, pose mode, close-up), or null. */
export function contextTopicId(app, shell, topics) {
  const has = (id) => topics.some((t) => t.id === id);
  if (app.modules?.focus?.active && has('zoom-rapido')) return 'zoom-rapido';
  if (app.voice?.ui?.isOpen && has('voce')) return 'voce';
  const tool = shell.activeToolId;
  if (!tool) return null;
  if (tool === 'props' && app.props?.selected?.hold && has('in-mano')) return 'in-mano';
  const keys = tool === 'pose' ? [`pose:${app.posing?.state?.mode || 'rotate'}`, 'pose'] : [tool];
  for (const k of keys) { const t = topics.find((x) => x.context?.includes(k)); if (t) return t.id; }
  return null;
}

// ---------------------------------------------------------------- text helpers
export const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plain = (s) => String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([a-zA-Z0-9]+)\]/g, (m, n) => (ICONS.has(n) ? '' : m)).replace(/\s{2,}/g, ' ').trim();

/** [start, end) ranges in `text` matching any of the normalized tokens (accent-insensitive). */
function matchRanges(text, tokens) {
  if (!tokens?.length) return [];
  let ns = '';
  const map = [];
  for (let i = 0; i < text.length; i++) { const n = norm(text[i]); for (let k = 0; k < n.length; k++) { ns += n[k]; map.push(i); } }
  const out = [];
  for (const tk of tokens) {
    let from = 0, j;
    // only at the start of a word: "linea" does not light up inside "allinea"
    while (tk && (j = ns.indexOf(tk, from)) >= 0) {
      if (j === 0 || !WORD.test(ns[j - 1])) out.push([map[j], map[j + tk.length - 1] + 1]);
      from = j + tk.length;
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of out) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
  return merged;
}

/** Text node(s) with <mark> on the matches. */
function marked(text, tokens) {
  const rs = matchRanges(text, tokens);
  if (!rs.length) return text;
  const out = [];
  let p = 0;
  for (const [a, b] of rs) { if (a > p) out.push(text.slice(p, a)); out.push(h('mark', {}, text.slice(a, b))); p = b; }
  if (p < text.length) out.push(text.slice(p));
  return out;
}

/** Guide markup -> nodes: **Etichetta** (label as written in the app), [icon] (inline icon). */
export function rich(text, tokens = null) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|\[([a-zA-Z0-9]+)\]/g;
  let p = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > p) out.push(marked(text.slice(p, m.index), tokens));
    if (m[1]) out.push(h('b', { class: 'pv-io-gd-ui' }, marked(m[1], tokens)));
    else if (ICONS.has(m[2])) out.push(h('span', { class: 'pv-io-gd-ic', 'aria-hidden': 'true' }, icon(m[2], 16)));
    else out.push(m[0]);
    p = re.lastIndex;
  }
  if (p < text.length) out.push(marked(text.slice(p), tokens));
  return out;
}

// ---------------------------------------------------------------- search
function haystack(t) {
  const ch = CHAPTERS.find((c) => c.id === t.chapter);
  return {
    title: norm(t.title),
    meta: norm([t.summary, t.keywords, ch?.title, ...(t.where || [])].join(' ')),
    body: norm([...t.steps, ...t.tips].map(plain).join(' ')),
  };
}

/**
 * Italian singular / plural: "mano" also finds the whole word "mani", "luce" finds "luci"
 * (a weaker match). -> RegExp of the other endings as whole words, or null.
 */
function pluralRe(tk) {
  if (tk.length < 4 || !/[aeio]$/.test(tk)) return null;
  const stem = tk.slice(0, -1);
  const alts = ['a', 'e', 'i', 'o'].map((v) => stem + v).filter((w) => w !== tk);
  return new RegExp(`(^|[^a-z0-9])(${alts.join('|')})(?=[^a-z0-9]|$)`);
}
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** the word (or the beginning of a word) anywhere in the field */
const wordStart = (tk) => new RegExp(`(^|[^a-z0-9])${esc(tk)}`);
const scoreIn = (hs, tk) => { const re = wordStart(tk); return (re.test(hs.title) ? 6 : 0) + (re.test(hs.meta) ? 3 : 0) + (re.test(hs.body) ? 1 : 0); };
const scoreRe = (hs, re) => (re.test(hs.title) ? 6 : 0) + (re.test(hs.meta) ? 3 : 0) + (re.test(hs.body) ? 1 : 0);

/** -> {tokens (for highlighting), results: [{topic, score, snippet}] best first}; every word of the query must match. */
export function searchTopics(topics, query) {
  const words = [...new Set(norm(query).split(/[\s,.;:!?'’"«»()/-]+/).filter((x) => x.length > 0))];
  const plurals = words.map(pluralRe);
  // highlighted: the words, plus the other endings that really occur as whole words
  const tokens = [...words];
  if (!words.length) return { tokens, results: [] };
  const results = [];
  for (const t of topics) {
    const hs = t._hs ||= haystack(t);
    let score = 0, all = true;
    for (let k = 0; k < words.length; k++) {
      const tk = words[k], re = plurals[k];
      const s = Math.max(scoreIn(hs, tk), re ? scoreRe(hs, re) * 0.6 : 0);
      if (!s) { all = false; break; }
      score += s + (hs.title.startsWith(tk) ? 2 : 0);
      if (re) for (const f of [hs.title, hs.meta, hs.body]) { const mm = f.match(re); if (mm && !tokens.includes(mm[2])) tokens.push(mm[2]); }
    }
    if (!all) continue;
    // the first step / tip that mentions a word of the query, shortened around it
    let snippet = null;
    for (const line of [...t.steps, ...t.tips]) {
      const txt = plain(line), r = matchRanges(txt, tokens)[0];
      if (!r) continue;
      const a = Math.max(0, r[0] - 34), b = Math.min(txt.length, a + 110);
      snippet = (a > 0 ? '…' : '') + txt.slice(a, b).trim() + (b < txt.length ? '…' : '');
      break;
    }
    results.push({ topic: t, score, snippet: snippet || t.summary });
  }
  results.sort((a, b) => b.score - a.score);
  return { tokens, results };
}

// ---------------------------------------------------------------- spotlight
/** Pulsing ring + label around an on-screen control for a few seconds. -> true if shown */
export function spotlight(sel, label, ms = 3600) {
  document.querySelector('.pv-io-spot')?._remove?.();
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  const r = el?.getBoundingClientRect();
  if (!r || r.width < 2 || r.height < 2) return false;
  const pad = 6, W = window.innerWidth, H = window.innerHeight;
  const ring = h('div', { class: 'pv-io-spot', 'aria-hidden': 'true', style: { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` } });
  const tag = h('div', { class: 'pv-io-spot-label', role: 'status' }, label);
  const host = h('div', { class: 'pv-io-spot-host' }, ring, tag);
  document.body.appendChild(host);
  // label above the control when it sits in the lower part of the screen
  const above = r.top + r.height / 2 > H * 0.55;
  const tw = Math.min(240, tag.offsetWidth || 160);
  tag.style.left = `${Math.max(8, Math.min(W - tw - 8, r.left + r.width / 2 - tw / 2))}px`;
  tag.style.top = above ? `${Math.max(8, r.top - pad - 12 - (tag.offsetHeight || 34))}px` : `${Math.min(H - 48, r.bottom + pad + 12)}px`;
  let done = false;
  const remove = () => {
    if (done) return;
    done = true;
    host.classList.add('leaving');
    document.removeEventListener('pointerdown', remove, true);
    setTimeout(() => host.remove(), 260);
  };
  ring._remove = remove; // only one spotlight at a time (see the first line)
  setTimeout(() => document.addEventListener('pointerdown', remove, true), 50);
  setTimeout(remove, ms);
  return true;
}

// ---------------------------------------------------------------- the sheet
/**
 * Opens the guide. ctx: io context ({app, shell, actions});
 * opts: {topic: id, query, context: true = the topic of what is on screen (else the index)}.
 * Returns the modal api ({close, result}).
 */
let openInstance = null;

export function openGuide(ctx, opts = {}) {
  // already open: navigate it instead of stacking a second sheet
  if (openInstance) { openInstance.navigate(opts); return openInstance; }
  const { app, shell } = ctx;
  const env = guideEnv(app, shell);
  const topics = visibleTopics(env);
  const byId = new Map(topics.map((t) => [t.id, t]));
  const chapters = CHAPTERS.map((c) => ({ ...c, topics: topics.filter((t) => t.chapter === c.id) })).filter((c) => c.topics.length);
  const order = chapters.flatMap((c) => c.topics);
  const wideMq = window.matchMedia(WIDE);

  let current = null; // topic id shown in the topic pane
  let query = '';

  // ---------------------------------------------- index pane
  const input = h('input', { type: 'search', class: 'pv-io-gd-input', placeholder: 'Cerca: posa, mano, luci, esporta…', 'aria-label': 'Cerca nella guida',
    enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const clear = iconButton({ icon: 'close', title: 'Cancella ricerca', size: 18, onClick: () => { setQuery(''); input.focus({ preventScroll: true }); } });
  clear.classList.add('pv-io-gd-clear');
  const searchBox = h('label', { class: 'pv-io-gd-search' }, icon('search', 18), input, clear);
  const quick = h('div', { class: 'pv-io-gd-quick', role: 'navigation', 'aria-label': 'Indice rapido' });
  const list = h('div', { class: 'pv-io-gd-list' });
  const indexHead = h('div', { class: 'pv-io-gd-head' }, searchBox, quick);
  const indexPane = h('div', { class: 'pv-io-gd-pane pv-io-gd-index' }, indexHead, list);

  // ---------------------------------------------- topic pane
  const topicPane = h('div', { class: 'pv-io-gd-pane pv-io-gd-topic', tabindex: '-1' });
  const root = h('div', { class: 'pv-io-gd' }, indexPane, topicPane);

  const m = modal({
    title: 'Guida', subtitle: 'Come si usa PosaViva, passo per passo', icon: 'bookOpen', kind: 'sheet', className: 'pv-io-guide', body: root,
    onBack: () => {
      if (!wideMq.matches && current) { showIndex(); return true; }
      if (query) { setQuery(''); return true; }
      return false;
    },
  });

  const wide = () => wideMq.matches;
  const applyWide = () => {
    root.classList.toggle('wide', wide());
    if (wide() && !current) renderWelcome();
  };
  wideMq.addEventListener?.('change', applyWide);
  m.result.then(() => { wideMq.removeEventListener?.('change', applyWide); if (openInstance === m) openInstance = null; });

  // quick index: one chip per chapter, scrolls the list to it
  for (const c of chapters) {
    const b = h('button', { type: 'button', class: 'pv-io-gd-qchip' }, icon(c.icon, 16), h('span', {}, c.title));
    b.addEventListener('click', () => {
      haptic('tick');
      if (query) setQuery('');
      const sec = list.querySelector(`[data-chapter="${c.id}"]`);
      if (sec) indexPane.scrollTo({ top: Math.max(0, sec.offsetTop - indexHead.offsetHeight - 6), behavior: 'smooth' });
    });
    quick.appendChild(b);
  }

  function topicRow(t, { tokens = null, snippet = null } = {}) {
    const row = h('button', { type: 'button', class: 'pv-io-gd-row' + (t.id === current ? ' on' : '') },
      h('span', { class: 'pv-io-gd-tile' }, icon(t.icon, 20)),
      h('span', { class: 'pv-io-gd-row-text' },
        h('span', { class: 'pv-io-gd-row-title' }, marked(t.title, tokens)),
        h('span', { class: 'pv-io-gd-row-sub' }, snippet ? marked(snippet, tokens) : t.summary)),
      icon('chevronRight', 18));
    row.dataset.topic = t.id;
    row.addEventListener('click', () => { haptic('tick'); showTopic(t.id); });
    return row;
  }

  function renderList() {
    list.replaceChildren();
    quick.style.display = query ? 'none' : '';
    if (query) {
      const { tokens, results } = searchTopics(topics, query);
      list.appendChild(h('div', { class: 'pv-io-gd-count' }, results.length === 1 ? '1 argomento' : `${results.length} argomenti`));
      if (!results.length) {
        list.appendChild(h('div', { class: 'pv-io-gd-empty' }, icon('search', 30), h('strong', {}, `Nessun risultato per «${query.trim()}»`),
          h('span', {}, 'Prova con parole come «posa», «mano», «luci», «vestiti», «esporta».')));
        return;
      }
      for (const r of results) list.appendChild(topicRow(r.topic, { tokens, snippet: r.snippet }));
      return;
    }
    // "Inizia da qui"
    const start = START_HERE.map((id) => byId.get(id)).filter(Boolean);
    if (start.length) {
      const grid = h('div', { class: 'pv-io-gd-start' });
      for (const t of start) {
        const c = h('button', { type: 'button', class: 'pv-io-gd-startcard' }, h('span', { class: 'pv-io-gd-tile' }, icon(t.icon, 20)), h('span', {}, t.title));
        c.addEventListener('click', () => { haptic('tick'); showTopic(t.id); });
        grid.appendChild(c);
      }
      list.appendChild(h('section', { class: 'pv-io-gd-chapter pv-io-gd-startsec' }, h('div', { class: 'pv-io-gd-chtitle' }, icon('sparkle', 16), 'Inizia da qui'), grid));
    }
    for (const c of chapters) {
      const sec = h('section', { class: 'pv-io-gd-chapter', 'data-chapter': c.id },
        h('div', { class: 'pv-io-gd-chtitle' }, icon(c.icon, 16), c.title, h('span', { class: 'pv-io-gd-chcount' }, String(c.topics.length))));
      for (const t of c.topics) sec.appendChild(topicRow(t));
      list.appendChild(sec);
    }
  }

  function setQuery(q) {
    query = q;
    if (input.value !== q) input.value = q;
    searchBox.classList.toggle('has-text', !!q);
    renderList();
    if (!wide() && current) showIndex();
    indexPane.scrollTop = 0;
  }
  input.addEventListener('input', () => setQuery(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });

  // ---------------------------------------------- topic view
  function renderWelcome() {
    topicPane.replaceChildren(h('div', { class: 'pv-io-gd-welcome' },
      artBox('guide'),
      h('div', { class: 'pv-io-gd-title' }, 'Benvenuto nella guida'),
      h('p', { class: 'pv-io-gd-summary' }, 'Scegli un argomento a sinistra oppure cerca una parola. Ogni scheda spiega un compito passo per passo; «Prova ora» apre lo strumento giusto.'),
      h('div', { class: 'pv-io-gd-start' }, START_HERE.map((id) => byId.get(id)).filter(Boolean).map((t) => {
        const c = h('button', { type: 'button', class: 'pv-io-gd-startcard' }, h('span', { class: 'pv-io-gd-tile' }, icon(t.icon, 20)), h('span', {}, t.title));
        c.addEventListener('click', () => { haptic('tick'); showTopic(t.id); });
        return c;
      }))));
  }

  function artBox(key) {
    const el = h('div', { class: 'pv-io-art pv-io-gd-art', 'aria-hidden': 'true' });
    el.innerHTML = ART[key] || '';
    return el;
  }

  function showTopic(id) {
    const t = byId.get(id);
    if (!t) return;
    current = id;
    const tokens = query ? searchTopics([t], query).tokens : null;
    const ch = CHAPTERS.find((c) => c.id === t.chapter);
    const back = iconButton({ icon: 'arrowLeft', title: 'Indice', onClick: () => { haptic('tick'); showIndex(); } });
    back.classList.add('pv-io-gd-back');
    const i = order.indexOf(t);
    const prev = order[i - 1], next = order[i + 1];

    const steps = h('ol', { class: 'pv-io-gd-steps' }, t.steps.map((s, k) => h('li', {}, h('span', { class: 'pv-io-gd-num' }, String(k + 1)), h('span', { class: 'pv-io-gd-step' }, rich(s, tokens)))));
    const tips = t.tips.length ? h('div', { class: 'pv-io-gd-tips' }, h('div', { class: 'pv-io-gd-tips-title' }, icon('sparkle', 16), 'Consigli'),
      h('ul', {}, t.tips.map((s) => h('li', {}, rich(s, tokens))))) : null;
    const where = t.where?.length ? h('div', { class: 'pv-io-gd-where' }, h('span', { class: 'pv-io-gd-where-label' }, 'Dove'),
      t.where.flatMap((w, k) => [k ? h('span', { class: 'pv-io-gd-sep' }, '›') : null, h('span', { class: 'pv-io-gd-crumb' }, w)])) : null;
    const goBtn = t.go ? goButton(t) : null;
    const related = (t.related || []).map((rid) => byId.get(rid)).filter(Boolean);
    const rel = related.length ? h('div', { class: 'pv-io-gd-related' }, h('div', { class: 'pv-io-gd-rel-title' }, 'Vedi anche'),
      h('div', { class: 'pv-io-gd-rel-list' }, related.map((r) => {
        const b = h('button', { type: 'button', class: 'pv-io-gd-relchip' }, icon(r.icon, 16), r.title);
        b.addEventListener('click', () => { haptic('tick'); showTopic(r.id); });
        return b;
      }))) : null;
    const nav = h('div', { class: 'pv-io-gd-nav' },
      prev ? navBtn(prev, 'Precedente', true) : h('span'),
      next ? navBtn(next, 'Successivo', false) : h('span'));

    const hero = t.art ? artBox(t.art) : null;
    const view = h('article', { class: 'pv-io-gd-article', 'aria-label': t.title },
      h('div', { class: 'pv-io-gd-topbar' }, back, h('span', { class: 'pv-io-gd-chapter-name' }, icon(ch?.icon || 'info', 15), ch?.title || '')),
      h('div', { class: 'pv-io-gd-hero' + (hero ? ' with-art' : '') },
        hero || h('span', { class: 'pv-io-gd-tile big' }, icon(t.icon, 26)),
        h('div', { class: 'pv-io-gd-hero-text' }, h('h2', { class: 'pv-io-gd-title' }, marked(t.title, tokens)), h('p', { class: 'pv-io-gd-summary' }, t.summary))),
      where, steps, goBtn, tips, rel, nav);
    topicPane.replaceChildren(view);
    topicPane.scrollTop = 0;
    root.classList.add('show-topic');
    for (const r of list.querySelectorAll('.pv-io-gd-row')) r.classList.toggle('on', r.dataset.topic === id);
    view.classList.add('pv-enter');
  }

  function navBtn(t, label, isPrev) {
    const b = h('button', { type: 'button', class: 'pv-io-gd-navbtn' + (isPrev ? ' prev' : ' next') },
      isPrev ? icon('chevronLeft', 18) : null,
      h('span', {}, h('small', {}, label), h('span', {}, t.title)),
      isPrev ? null : icon('chevronRight', 18));
    b.addEventListener('click', () => { haptic('tick'); showTopic(t.id); });
    return b;
  }

  function showIndex() {
    current = null;
    root.classList.remove('show-topic');
    for (const r of list.querySelectorAll('.pv-io-gd-row.on')) r.classList.remove('on');
    if (wide()) renderWelcome();
  }

  // ---------------------------------------------- "Prova ora"
  function goButton(t) {
    const g = t.go;
    let label = 'Prova ora', ic = t.icon;
    if (g.spot) { label = 'Mostrami dov\'è'; ic = 'target'; }
    else if (g.action) { label = g.label || 'Apri'; }
    else if (g.tool) {
      const tool = shell.tools.find((x) => x.id === g.tool);
      label = `Prova ora${tool ? ` · ${tool.label}` : ''}`;
      ic = tool?.icon || ic;
    }
    const b = h('button', { type: 'button', class: 'pv-btn primary pv-io-gd-go' }, icon(ic, 20), h('span', {}, label));
    b.addEventListener('click', () => { haptic('tick'); run(g); });
    return b;
  }

  function run(g) {
    m.close('go');
    if (g.tool) {
      if (CHARACTER_TOOLS.has(g.tool) && !app.selection.character) {
        const ch = app.characters.find((c) => c.root.visible);
        if (ch) app.select(ch);
      }
      if (g.mode && app.posing?.setMode) app.posing.setMode(g.mode);
      shell.openTool(g.tool);
      if (g.mode && shell.activeToolId === g.tool && !(g.tool === 'pose' && g.mode === 'rotate' && app.selection.part)) {
        const hint = { rotate: 'Tocca una parte del corpo, poi trascina un anello', ik: 'Trascina mani, piedi, testa o bacino', line: 'Disegna una curva sopra il personaggio', move: 'Trascina l\'anello a terra per spostare' }[g.mode];
        if (hint) shell.hint(hint, 3200);
      }
      return;
    }
    if (g.spot) {
      const s = SPOTS[g.spot];
      // after the sheet has slid away
      setTimeout(() => { if (!s || !spotlight(s.sel, s.label)) toast('Questo comando non è visibile adesso', { kind: 'info' }); }, 280);
      return;
    }
    if (g.action) {
      const fn = ctx.actions?.[g.action];
      if (fn) setTimeout(() => fn(), 200);
    }
  }

  // ---------------------------------------------- start
  function navigate(o = {}) {
    if (o.query != null) setQuery(String(o.query));
    const id = o.context ? contextTopicId(app, shell, topics) : o.topic;
    if (id && byId.has(id)) showTopic(id);
  }
  renderList();
  applyWide();
  navigate(opts);
  m.navigate = navigate;
  // live view of the guide for tests: which topics, which one is open
  m.guide = { topics, show: showTopic, index: showIndex, search: setQuery, get current() { return current; } };
  openInstance = m;
  return m;
}
