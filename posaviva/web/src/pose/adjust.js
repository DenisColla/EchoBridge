// Whole-pose adjustment sliders shared by "Posa → Linea" and "Pose pronte":
//  - Curva (relative, springs back to 100%): bends / straightens the back's line of action
//  - Dinamismo (relative, springs back to 100%): exaggerates the whole pose (limits kept)
//  - Naturalezza (absolute, per character): small deterministic asymmetries
import { h, slider } from '../ui/kit.js';
import { poseSnapshot, exaggerate, lineSnapshot, bendLine } from './soft.js';

/**
 * Slider applying a relative change from the state at the start of the gesture; on
 * release it records one undo step and springs back to `def`.
 */
function relativeSlider(ctx, { label, min, max, def, hint, begin, apply, finish, undoLabel }) {
  const { app } = ctx;
  let session = null, raf = 0;
  const s = slider({
    label, min, max, step: 1, value: def, defaultValue: def, center: false,
    format: (v) => `${Math.round(v)}%`,
    onInput: (v) => {
      const ch = app.selection.character;
      if (!ch) return;
      if (!session || session.ch !== ch) session = { ch, st: begin(ch) };
      apply(ch, session.st, v / 100);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (session) ctx.edited(session.ch, false); });
    },
    onChange: (v) => {
      const ses = session;
      session = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      s.setValue(def);
      if (!ses || !app.characters.includes(ses.ch)) return;
      apply(ses.ch, ses.st, v / 100);
      finish?.(ses.ch, ses.st, v / 100);
      ctx.edited(ses.ch, true, undoLabel);
    },
  });
  if (hint) s.appendChild(h('div', { class: 'pv-pose-slider-hint' }, hint));
  return s;
}

/** Curva + Dinamismo + Naturalezza: returns {el, refresh()} */
export function buildAdjustSliders(ctx, { curve = true } = {}) {
  const { app, rig, controls } = ctx;
  const items = [];
  if (curve) {
    items.push(relativeSlider(ctx, {
      label: 'Curva', min: 0, max: 200, def: 100, undoLabel: 'curva linea d\'azione',
      hint: 'Sotto 100% raddrizza la schiena, sopra la curva di più.',
      begin: (ch) => lineSnapshot(ch, rig, controls),
      apply: (ch, st, t) => { bendLine(ch, st, t, rig); },
    }));
  }
  items.push(relativeSlider(ctx, {
    label: 'Dinamismo', min: 0, max: 200, def: 100, undoLabel: 'dinamismo',
    hint: 'Esagera (o attenua) tutta la posa, nei limiti anatomici.',
    begin: (ch) => ({ snap: poseSnapshot(ch), ground: ctx.groundMode(ch) }),
    apply: (ch, st, t) => {
      exaggerate(ch, st.snap, t, rig, controls);
      if (st.ground) ctx.settle(ch, st.ground); else ch.applyPose();
    },
    finish: (ch, st) => {
      ctx.fitArms(ch);
      if (st.ground) ctx.settle(ch, st.ground);
    },
  }));
  let natSes = null, natRaf = 0;
  const nat = slider({
    label: 'Naturalezza', min: 0, max: 100, step: 1, value: 0, defaultValue: 0, center: false,
    format: (v) => `${Math.round(v)}%`,
    onInput: (v) => {
      const ch = app.selection.character;
      if (!ch) return;
      natSes = ch;
      ctx.keepFeet(ch, () => ctx.setNaturalness(ch, v / 100));
      if (!natRaf) natRaf = requestAnimationFrame(() => { natRaf = 0; if (natSes) ctx.edited(natSes, false); });
    },
    onChange: (v) => {
      const ch = natSes || app.selection.character;
      natSes = null;
      if (natRaf) { cancelAnimationFrame(natRaf); natRaf = 0; }
      if (!ch || !app.characters.includes(ch)) return;
      ctx.keepFeet(ch, () => ctx.setNaturalness(ch, v / 100));
      ctx.edited(ch, true, 'naturalezza');
    },
  });
  nat.appendChild(h('div', { class: 'pv-pose-slider-hint' }, 'Piccole asimmetrie, diverse per ogni personaggio.'));
  items.push(nat);
  const el = h('div', { class: 'pv-pose-adjust' }, ...items);
  return {
    el,
    refresh() {
      const ch = app.selection.character;
      if (ch && !natSes) nat.setValue(Math.round(ctx.naturalness(ch) * 100));
    },
  };
}
