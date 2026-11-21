// Entry point of the "hair" module (Capelli). See posaviva/ARCHITECTURE.md.
//
// Per-character state: ch.data.hair = {style, color, length, volume, parting, bangs, beard}
// (state.js). The hair colour is mirrored into ch.appearance.hair so the face
// module can tint eyebrows and lashes.
//
// Public API: app.hair = {rigs, styles, beards, getState(ch), setStyle(ch, patch, commit)}
// and the app event 'hairchange' {character}.
import { HairRig } from './rig.js';
import { normalizeState, defaultState, BEARDS } from './state.js';
import { STYLES, STYLE_BY_ID } from './styles.js';
import { buildHairPanel } from './panel.js';
import { strandTexture, stubbleTexture } from './texture.js';

export function create(app, shell) {
  const rigs = new Map();
  const mats = app.materials;

  const ctl = {
    app,
    rigs,
    /** (Re)applies the materials of a character's hair and facial hair. */
    applyMaterial(rig) {
      const st = rig.ch.data.hair;
      if (!st) return;
      if (rig.mesh) mats.apply(rig.mesh, { kind: 'hair', color: st.color, map: strandTexture(), vertexColors: true, ...(STYLE_BY_ID.get(st.style)?.material || {}) });
      if (rig.beard) {
        mats.apply(rig.beard.mesh, rig.beard.spec.stubble
          // stippled follicles (alpha map) over a faint base: about 35 % coverage on average
          ? { kind: 'hair', color: st.color, map: stubbleTexture(), transparent: true, opacity: 0.62, roughness: 0.85, sheen: 0 }
          : { kind: 'hair', color: st.color, vertexColors: true, roughness: 0.6 });
      }
    },
    /** Sets the hair colour (state, eyebrows via ch.appearance.hair, materials). */
    setColor(ch, hex) {
      const st = ch.data.hair;
      st.color = hex.toLowerCase();
      if (ch.appearance.hair !== st.color) ch.setAppearance({ hair: st.color });
      const rig = rigs.get(ch);
      if (rig) this.applyMaterial(rig);
      app.invalidate();
      app.dispatchEvent({ type: 'hairchange', character: ch });
    },
    /** A state change made by the UI (geometry is rebuilt by the rig on the next frame). */
    changed(ch, label = '', commit = false) {
      app.invalidate();
      app.dispatchEvent({ type: 'hairchange', character: ch });
      if (commit) app.commit(label);
    },
  };

  function ensure(ch) {
    let rig = rigs.get(ch);
    if (!rig) { rig = new HairRig(ctl, ch); rigs.set(ch, rig); }
    return rig;
  }

  /**
   * Corpo > Sesso: hair still equal to the old sex's default (style, colour, sliders, beard)
   * becomes the new sex's default. Only for edits of this character: undo / load replace ch.data.
   */
  const seen = new Map(); // ch -> {data, sex, preset, fn}
  const sameHair = (a, b) => ['style', 'color', 'parting', 'bangs', 'beard'].every((k) => a[k] === b[k]) && Math.abs(a.length - b.length) < 1e-6 && Math.abs(a.volume - b.volume) < 1e-6;
  function watchSex(ch) {
    if (seen.has(ch)) return;
    const rec = { data: ch.data, sex: ch.sex, preset: ch.presetId };
    rec.fn = () => {
      if (ch.data === rec.data && ch.sex !== rec.sex && ch.data.hair && !app.history?.restoring) {
        const old = normalizeState(defaultState({ sex: rec.sex, presetId: rec.preset }));
        if (sameHair(ch.data.hair, old)) {
          ch.data.hair = defaultState(ch);
          if (ch.appearance.hair !== ch.data.hair.color) ch.setAppearance({ hair: ch.data.hair.color });
          const rig = rigs.get(ch);
          if (rig) ctl.applyMaterial(rig);
          ctl.changed(ch); // rebuilt with the new body (debounced shape rebuild); the Corpo panel commits
        }
      }
      rec.data = ch.data; rec.sex = ch.sex; rec.preset = ch.presetId;
    };
    ch.addEventListener('shape', rec.fn);
    seen.set(ch, rec);
  }

  /** Normalises ch.data.hair (defaults for new characters / old saves) and syncs colour + materials. */
  function sync(ch) {
    if (!ch.data.hair) ch.data.hair = defaultState(ch);
    normalizeState(ch.data.hair);
    const rig = ensure(ch);
    if (ch.appearance.hair !== ch.data.hair.color) ch.setAppearance({ hair: ch.data.hair.color });
    ctl.applyMaterial(rig);
    app.invalidate();
    return rig;
  }

  // all heavy work runs here, at most once per frame and only when something changed
  app.addRenderHook(() => {
    const now = performance.now();
    let keep = false;
    for (const rig of rigs.values()) keep = rig.update(now) || keep;
    return keep;
  });

  // hair drapes over clothes: refresh colliders when an outfit has been (re)built
  let clothHooked = false;
  const hookClothing = () => {
    const mgr = app.clothing?.manager;
    if (clothHooked || !mgr?.addEventListener) return;
    clothHooked = true;
    mgr.addEventListener('built', (e) => { const rig = e.character && rigs.get(e.character); if (rig) { rig.onClothing(); app.invalidate(); } });
  };
  hookClothing();
  app.addEventListener('ready', hookClothing);

  shell.registerTool({
    id: 'hair', label: 'Capelli', icon: 'hair', group: 'look', order: 40, title: 'Capelli e barba',
    build: (el) => buildHairPanel(el, app, ctl),
  });

  app.hair = {
    rigs,
    styles: STYLES,
    beards: BEARDS,
    /** Copy of a character's hair state. */
    getState: (ch) => ({ ...ch.data.hair }),
    /** Applies a partial state ({style, color, length, volume, parting, bangs, beard}); commit = undo label or false. */
    setStyle(ch, patch, commit = 'capelli') {
      if (!ch?.data.hair) return;
      const { color, ...rest } = patch;
      Object.assign(ch.data.hair, rest);
      normalizeState(ch.data.hair);
      if (color) ctl.setColor(ch, color);
      ctl.changed(ch, commit || '', !!commit);
    },
  };

  return {
    onCharacterAdded(ch) { sync(ch); watchSex(ch); },
    onCharacterRemoved(ch) {
      rigs.get(ch)?.dispose();
      rigs.delete(ch);
      const rec = seen.get(ch);
      if (rec) { ch.removeEventListener('shape', rec.fn); seen.delete(ch); }
    },
    // undo / redo / load: cheap when nothing changed (the rig compares geometry keys per frame);
    // a restored body shape is rebuilt on the next frame (no slider debounce)
    deserializeCharacter(ch) {
      sync(ch).shapeTime = 0;
      const rec = seen.get(ch);
      if (rec) { rec.data = ch.data; rec.sex = ch.sex; rec.preset = ch.presetId; }
    },
  };
}
