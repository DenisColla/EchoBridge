// "Luci" tool panel: presets, light tabs, light globe, color temperature,
// intensity, precise position, shadows, ambient.
import * as THREE from 'three';
import { h, section, slider, toggle, segmented, button, swatches, haptic } from '../ui/kit.js';
import { LIGHT_PRESETS } from './lightPresets.js';
import { LightGlobe, presetThumb } from './lightGlobe.js';
import { MAX_EXTRAS, TYPE_LABELS, lightLabel, dirFromAzEl, azElFromDir } from './lights.js';
import { kelvinGradientCSS, kelvinToHex } from './color.js';
import { svgIcon, LIGHT_ICONS } from './svg.js';
import { buildSourcesSection } from './practicalsUI.js';

const DEG = Math.PI / 180;
const GELS = ['#ffffff', '#ffd6a5', '#ff7a4d', '#ff4f6d', '#c77dff', '#5d8cff', '#4fd1e8', '#8dff9a'];

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();

export function registerLightsTool(app, shell, rig, practicals = null) {
  shell.registerTool({
    id: 'lights', group: 'scene', label: 'Luci', icon: 'sun', order: 60, title: 'Luci',
    build(el) {
      el.classList.add('pv-sc-panel');
      let visible = false;

      // ---------------------------------------------------------- presets
      const presetCards = new Map();
      const presetStrip = h('div', { class: 'pv-sc-presets' });
      for (const p of LIGHT_PRESETS) {
        const b = h('button', { type: 'button', class: 'pv-sc-preset', title: p.label }, presetThumb(p, 52), h('span', {}, p.label));
        b.addEventListener('click', () => { rig.applyPreset(p.id); app.commit('preset luci'); haptic(); });
        presetCards.set(p.id, b);
        presetStrip.appendChild(b);
      }

      // ---------------------------------------------------------- light tabs
      const tabs = h('div', { class: 'pv-sc-tabs' });
      let tabsKey = '';
      function renderTabs() {
        const key = JSON.stringify(rig.lights.map((l) => [l.id, l.type, l.on, l.name, l.color, l.kelvin, rig.selectedId === l.id]));
        if (key === tabsKey) return;
        tabsKey = key;
        tabs.innerHTML = '';
        for (const d of rig.lights) {
          const col = d.color || kelvinToHex(d.kelvin);
          const ic = svgIcon(LIGHT_ICONS[d.type], 18);
          ic.style.color = d.on ? col : 'var(--muted)';
          const b = h('button', { type: 'button', class: 'pv-sc-tab' + (rig.selected?.id === d.id ? ' active' : '') + (d.on ? '' : ' off') }, ic, h('span', {}, lightLabel(d, rig.lights)));
          b.addEventListener('click', () => rig.select(d.id));
          tabs.appendChild(b);
        }
        if (rig.extrasCount() < MAX_EXTRAS) {
          const add = h('button', { type: 'button', class: 'pv-sc-tab add', title: 'Aggiungi luce' }, svgIcon('<path d="M12 5v14M5 12h14"/>', 18), h('span', {}, 'Luce'));
          add.addEventListener('click', () => { rig.addLight('point'); app.commit('aggiungi luce'); haptic(); });
          tabs.appendChild(add);
        }
      }

      // ---------------------------------------------------------- globe + side controls
      const globe = new LightGlobe({
        size: 148,
        onPick: (id) => rig.select(id),
        onDrag: (id, ae, phase) => {
          if (phase === 'move') rig.set(id, ae, { live: true });
          else rig.endLive('luce');
        },
      });
      const hemi = segmented({
        options: [{ value: 'front', label: 'Davanti' }, { value: 'back', label: 'Dietro' }], value: 'front',
        onChange: (v) => flipHemisphere(v === 'back'),
      });
      const onT = toggle({ label: 'Accesa', value: true, onChange: (v) => { const d = rig.selected; if (d) { rig.set(d.id, { on: v }); app.commit('luce'); } } });
      const removeBtn = button({ label: 'Rimuovi', icon: 'trash', small: true, variant: 'danger', onClick: () => { const d = rig.selected; if (d) { rig.removeLight(d.id); app.commit('rimuovi luce'); } } });
      const globeHint = h('div', { class: 'pv-sc-note' }, 'Trascina il punto luminoso sulla sfera, oppure la maniglia nella vista.');
      const side = h('div', { class: 'pv-sc-globe-side' }, hemi, onT, removeBtn, globeHint);
      const globeRow = h('div', { class: 'pv-sc-globe-row' }, globe.canvas, side);

      const typeSeg = segmented({
        options: Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })), value: 'sun',
        onChange: (v) => {
          const d = rig.selected;
          if (!d || d.type === v) return;
          const patch = { type: v };
          if (v !== 'sun') patch.target = rig.subjectCenter(new THREE.Vector3()).toArray();
          if (v === 'spot' && !d.shadow) patch.shadow = true;
          rig.set(d.id, patch);
          app.commit('tipo luce');
        },
      });

      // ---------------------------------------------------------- color & intensity
      const live = (patch) => { const d = rig.selected; if (d) rig.set(d.id, patch, { live: true }); };
      const end = () => rig.endLive('luce');
      const intensity = slider({ label: 'Intensità', min: 0, max: 6, step: 0.05, value: 2, format: (v) => v.toFixed(2), onInput: (v) => live({ intensity: v }), onChange: end });
      const kelvin = slider({ label: 'Temperatura colore', min: 2000, max: 10000, step: 50, value: 5600, format: (v) => `${Math.round(v)} K`, onInput: (v) => live({ kelvin: v, color: null }), onChange: end });
      kelvin.classList.add('pv-sc-kelvin');
      kelvin.input.style.setProperty('--kgrad', kelvinGradientCSS(2000, 10000));
      // custom colour: live preview while the picker moves, one undo step when it is released
      const gels = swatches({
        colors: GELS, value: null,
        onInput: (c) => live({ color: c }),
        onChange: (c) => { const d = rig.selected; if (d) { rig.set(d.id, { color: c }); app.commit('colore luce'); } },
      });
      const gelsRow = h('div', { class: 'pv-sc-sub' }, h('div', { class: 'pv-sc-label' }, 'Gelatina / colore personalizzato'), gels);

      // ---------------------------------------------------------- position
      const az = slider({ label: 'Azimut', min: -180, max: 180, step: 1, value: 0, center: false, format: (v) => `${Math.round(v)}°`, onInput: (v) => live({ az: v * DEG }), onChange: end });
      const elv = slider({ label: 'Elevazione', min: -89, max: 89, step: 1, value: 30, format: (v) => `${Math.round(v)}°`, onInput: (v) => live({ el: v * DEG }), onChange: end });
      const dist = slider({ label: 'Distanza', min: 0.3, max: 10, step: 0.05, value: 2.5, format: (v) => `${v.toFixed(2)} m`, onInput: (v) => live({ dist: v }), onChange: end });
      const cone = slider({ label: 'Apertura cono', min: 10, max: 120, step: 1, value: 50, format: (v) => `${Math.round(v)}°`, onInput: (v) => live({ angle: v }), onChange: end });
      const pen = slider({ label: 'Bordo morbido', min: 0, max: 1, step: 0.01, value: 0.4, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => live({ penumbra: v }), onChange: end });
      const aim = button({ label: 'Punta sul personaggio', icon: 'target', small: true, onClick: () => { rig.aimAtSubject(); app.commit('punta luci'); haptic(); } });
      const posSec = section('Posizione precisa', [az, elv, dist, cone, pen, aim], { collapsible: true });

      // ---------------------------------------------------------- shadows
      const shadowT = toggle({ label: 'Proietta ombre', value: true, onChange: (v) => { const d = rig.selected; if (d) { rig.set(d.id, { shadow: v }); app.commit('ombre'); } } });
      const soft = slider({ label: 'Morbidezza ombre', min: 0, max: 1, step: 0.01, value: 0.3, format: (v) => (v < 0.15 ? 'netta' : v > 0.7 ? 'molto morbida' : `${Math.round(v * 100)}%`), onInput: (v) => live({ soft: v }), onChange: end });
      const shadowSec = section('Ombre', [shadowT, soft]);

      // ---------------------------------------------------------- ambient
      const ambI = slider({ label: 'Luce ambiente', min: 0, max: 3, step: 0.02, value: 0.8, format: (v) => v.toFixed(2), onInput: (v) => rig.setAmbient({ intensity: v }, { live: true }), onChange: () => rig.endLive('ambiente') });
      const ambK = slider({ label: 'Tinta ambiente', min: 2000, max: 12000, step: 100, value: 7500, format: (v) => `${Math.round(v)} K`, onInput: (v) => rig.setAmbient({ kelvin: v, color: null, ground: null }, { live: true }), onChange: () => rig.endLive('ambiente') });
      ambK.classList.add('pv-sc-kelvin');
      ambK.input.style.setProperty('--kgrad', kelvinGradientCSS(2000, 12000));
      const handlesT = toggle({ label: 'Maniglie delle luci nella vista', value: true, onChange: (v) => rig.setHandlesPref(v) });
      const ambSec = section('Ambiente (riempimento)', [ambI, ambK, handlesT]);

      // ---------------------------------------------------------- practical lights (lamps, candles, windows...)
      const sources = practicals ? buildSourcesSection(app, practicals) : null;

      el.append(...[
        section('Preset', [presetStrip]),
        sources ? section('Fonti nella scena', [sources.el]) : null,
        section('Luci della scena', [tabs]),
        globeRow,
        h('div', { class: 'pv-sc-block' }, typeSeg),
        section('Colore e intensità', [intensity, kelvin, gelsRow]),
        shadowSec,
        posSec,
        ambSec,
      ].filter(Boolean));

      // ---------------------------------------------------------- behaviour
      function flipHemisphere(back) {
        const d = rig.selected;
        if (!d) return;
        app.camera.getWorldQuaternion(_q);
        dirFromAzEl(d.az, d.el, _v).applyQuaternion(_q.clone().invert());
        const z = Math.abs(_v.z) < 0.25 ? 0.5 : Math.abs(_v.z);
        _v.z = back ? -z : z;
        _v.normalize().applyQuaternion(_q);
        rig.set(d.id, azElFromDir(_v, {}));
        app.commit('luce');
      }

      let raf = 0;
      function schedule() { if (!visible || raf) return; raf = requestAnimationFrame(() => { raf = 0; refresh(); }); }
      function refresh() {
        sources?.refresh();
        renderTabs();
        const d = rig.selected;
        for (const [id, b] of presetCards) b.classList.toggle('active', rig.state.preset === id);
        if (!d) return;
        globe.render(rig, app.camera);
        hemi.setValue(globe.back ? 'back' : 'front');
        onT.setValue(d.on);
        removeBtn.style.display = d.role === 'extra' ? '' : 'none';
        typeSeg.setValue(d.type);
        intensity.setValue(d.intensity);
        kelvin.setValue(d.kelvin);
        kelvin.classList.toggle('inactive', !!d.color);
        gels.setValue(d.color);
        az.setValue(Math.round(d.az / DEG));
        elv.setValue(Math.round(d.el / DEG));
        dist.setValue(d.dist);
        dist.style.display = d.type === 'sun' ? 'none' : '';
        cone.setValue(d.angle);
        pen.setValue(d.penumbra);
        cone.style.display = pen.style.display = d.type === 'spot' ? '' : 'none';
        aim.style.display = d.type === 'sun' ? 'none' : '';
        shadowT.setValue(d.shadow);
        soft.setValue(d.soft);
        soft.style.opacity = d.shadow ? 1 : 0.45;
        ambI.setValue(rig.state.ambient.intensity);
        ambK.setValue(rig.state.ambient.kelvin ?? 7500);
        handlesT.setValue(rig.state.handles !== false);
      }
      rig.addEventListener('change', schedule);
      practicals?.addEventListener('change', schedule);
      app.controls.addEventListener('change', schedule); // the globe is drawn from the camera's point of view
      app.addEventListener('selection', schedule);

      return {
        onShow() { visible = true; rig.setHandlesWanted(true); refresh(); },
        onHide() { visible = false; rig.setHandlesWanted(false); },
      };
    },
  });
}
