// Top bar: selected-character chip (opens Personaggi), undo / redo wired to
// app.history, "?" (Guida on the current topic), main menu (Progetti, scene save / "Salva in…",
// export, scene files, guide, settings, info).
import { h, icon, iconButton, haptic, sheetMenu } from '../ui/kit.js';
import { describe } from './people.js';

export class TopBar {
  /** ctx: {app, shell, thumbs, people, actions} */
  constructor(ctx) {
    this.ctx = ctx;
    const { app, shell } = ctx;
    this.app = app;

    // ---- character chip
    this.avatar = h('span', { class: 'pv-io-chip-avatar' });
    this.name = h('span', { class: 'pv-io-chip-name' });
    this.sub = h('span', { class: 'pv-io-chip-sub' });
    this.chip = h('button', { type: 'button', class: 'pv-io-chip', title: 'Personaggi' },
      this.avatar, h('span', { class: 'pv-io-chip-text' }, this.name, this.sub), icon('chevronDown', 16));
    this.chip.addEventListener('click', () => {
      haptic('tick');
      if (shell.activeToolId === 'people') shell.closePanel();
      else ctx.people.open({ add: !app.characters.length });
    });
    shell.topLeft.prepend(this.chip);

    // ---- undo / redo / menu
    this.undo = iconButton({ icon: 'undo', title: 'Annulla', onClick: () => { haptic('tick'); app.history.undo(); } });
    this.redo = iconButton({ icon: 'redo', title: 'Ripeti', onClick: () => { haptic('tick'); app.history.redo(); } });
    this.menuBtn = iconButton({ icon: 'menu', title: 'Menu', onClick: () => { haptic('tick'); this.openMenu(); } });
    this.menuBtn.classList.add('pv-io-menu-btn');
    // "?": the guide, opened on the topic of what is on screen (open tool, pose mode, close-up)
    this.helpBtn = iconButton({ icon: 'help', title: 'Guida', onClick: () => { haptic('tick'); ctx.actions.openGuide({ context: true }); } });
    this.helpBtn.classList.add('pv-io-help-btn');
    this.undo.disabled = this.redo.disabled = true;
    shell.topRight.append(h('div', { class: 'pv-io-history' }, this.undo, this.redo), h('div', { class: 'pv-io-pill' }, this.helpBtn, this.menuBtn));

    app.addEventListener('history', (e) => { this.undo.disabled = !e.canUndo; this.redo.disabled = !e.canRedo; });
    for (const ev of ['selection', 'characters', 'loaded']) app.addEventListener(ev, () => this.refresh());
    app.addEventListener('tool', (e) => this.chip.classList.toggle('active', e.id === 'people'));
    this.refresh();
  }

  /** Updates the chip (throttled to one per frame). */
  refresh() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._render(); });
  }

  _render() {
    const ch = this.app.selection.character;
    this.chip.classList.toggle('empty', !ch);
    if (!ch) {
      this.avatar.replaceChildren(icon('userPlus', 18));
      this.avatar.className = 'pv-io-chip-avatar';
      this.name.textContent = this.app.characters.length ? 'Nessuna selezione' : 'Aggiungi personaggio';
      this.sub.textContent = this.app.characters.length ? `${this.app.characters.length} in scena` : '';
      return;
    }
    this.name.textContent = ch.name;
    const n = this.app.characters.length;
    this.sub.textContent = n > 1 ? `${describe(ch)} · ${this.app.characters.indexOf(ch) + 1}/${n}` : describe(ch);
    this.avatar.className = `pv-io-chip-avatar ${ch.sex === 'M' ? 'm' : 'f'}`;
    const opts = { w: 32, h: 32, region: 'bust', color: ch.appearance.skin };
    const key = `${ch.presetId}|${ch.appearance.skin}`;
    if (this.avatar.dataset.key === key) return;
    this.avatar.dataset.key = key;
    const set = (url) => { if (url && this.avatar.dataset.key === key) this.avatar.replaceChildren(h('img', { src: url, alt: '' })); };
    const hit = this.ctx.thumbs.peek(ch.presetId, opts);
    if (hit) set(hit);
    else { this.avatar.replaceChildren(icon(ch.sex === 'M' ? 'male' : 'female', 16)); this.ctx.thumbs.get(ch.presetId, opts).then(set); }
  }

  openMenu() {
    const a = this.ctx.actions, scenes = this.ctx.scenes, app = this.app;
    const P = app.projects;
    const where = scenes.location?.();
    const title = `${scenes.current.name}${scenes.dirty ? ' · modificata' : ''}`;
    const saved = !!(scenes.current.id && (!P || P.item(scenes.current.id)));
    const cur = P?.current;
    return sheetMenu([
      { header: where ? `${title} — ${where.section ? `${where.project} › ${where.section}` : where.project}` : title },
      P ? { id: 'projects', label: 'Progetti', icon: 'book', hint: cur ? `Scene, paesaggi, personaggi e pose · ${cur.name}` : 'Scene, paesaggi, personaggi e pose salvati', onClick: () => a.openProjects() } : null,
      { id: 'new', label: 'Nuova scena', icon: 'filePlus', onClick: a.newScene },
      { id: 'save', label: 'Salva scena', icon: 'save', hint: saved ? 'Aggiorna la scena salvata' : P ? 'Scegli progetto, sezione e nome' : null, onClick: a.saveScene },
      P ? { id: 'saveIn', label: 'Salva in…', icon: 'folder', hint: 'Una copia, un paesaggio, un personaggio o una posa', onClick: () => a.saveIn({}) }
        : { id: 'open', label: 'Apri scena…', icon: 'folder', onClick: a.openScenes },
      { separator: true },
      { id: 'png', label: 'Esporta immagine PNG', icon: 'image', onClick: () => a.exportImage(false) },
      { id: 'share', label: 'Condividi immagine', icon: 'share', onClick: () => a.exportImage(true) },
      { separator: true },
      { id: 'export', label: 'Esporta file scena (.json)', icon: 'download', onClick: a.exportSceneFile },
      { id: 'import', label: 'Importa file scena', icon: 'upload', onClick: a.importSceneFile },
      { separator: true },
      { id: 'guide', label: 'Guida', icon: 'bookOpen', hint: 'Come si usa, passo per passo', onClick: () => a.openGuide() },
      { id: 'settings', label: 'Impostazioni', icon: 'settings', onClick: a.openSettings },
      { id: 'info', label: 'Info e crediti', icon: 'info', onClick: a.openInfo },
    ], { anchor: this.menuBtn });
  }
}
