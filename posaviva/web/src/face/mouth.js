// Mouth interior fix-up for the expression units.
//
// In the MakeHuman expression data the tongue helper barely follows the jaw:
// units that open the mouth (mouth-open, ...) move the lower teeth by ~2 cm
// but leave the tongue where it was, so in every open-mouth expression the
// tongue floats up against the palate as a bright red mass (laugh, shout,
// surprise). Here, once per model, every unit that moves the lower teeth also
// carries the tongue along (the root as much as the teeth, the tip a bit more),
// so the tongue rests low in the open mouth. Units are replaced through the
// core API model.addExpressionUnit(), so all characters (and saved scenes) get it.
// Units in which the tongue already follows the jaw (fixed asset bake) are skipped.

const _done = new WeakSet();

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Rewrites the jaw-moving expression units so the tongue moves with the lower jaw. Idempotent. */
export function tongueFollowsJaw(model) {
  if (_done.has(model)) return 0;
  _done.add(model);
  const gi = (n) => model.groups.indexOf(n);
  if (gi('tongue') < 0 || gi('teethLower') < 0 || !model.expressions) return 0;
  const tongue = model.groupVertices[gi('tongue')], teeth = model.groupVertices[gi('teethLower')];
  if (!tongue?.length || !teeth?.length) return 0;
  const teethSet = new Set(teeth);
  // tongue rest positions (any preset: only the front/back order matters)
  const P = (model.presets[0] && model.presets[0].positions) || null;
  if (!P) return 0;
  let zMin = Infinity, zMax = -Infinity;
  for (const v of tongue) { const z = P[v * 3 + 2]; if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
  const follow = new Float32Array(tongue.length);
  // the jaw hinge is behind the tongue: the root moves less than the teeth, the tip a bit
  // more (the tongue lies flat on the floor of the open mouth, below the upper teeth)
  tongue.forEach((v, i) => { follow[i] = 1.05 + 0.45 * smooth(zMin, zMax, P[v * 3 + 2]); });

  let changed = 0;
  for (const name of model.expressionUnits) {
    const d = model.expressions[name];
    if (!d || !d.idx) continue;
    // mean motion of the lower teeth for this unit (weight 1)
    let dx = 0, dy = 0, dz = 0;
    for (let k = 0; k < d.idx.length; k++) {
      if (!teethSet.has(d.idx[k])) continue;
      dx += d.val[k * 3] * d.scale; dy += d.val[k * 3 + 1] * d.scale; dz += d.val[k * 3 + 2] * d.scale;
    }
    dx /= teeth.length; dy /= teeth.length; dz /= teeth.length;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 0.0005 * 0.0005) continue;
    // dense delta of the unit, + the tongue following the jaw
    const acc = new Map();
    for (let k = 0; k < d.idx.length; k++) acc.set(d.idx[k], [d.val[k * 3] * d.scale, d.val[k * 3 + 1] * d.scale, d.val[k * 3 + 2] * d.scale]);
    // assets whose bake already carries the tongue with the jaw (asset pipeline fix):
    // leave the unit alone, or the tongue would move about twice as far
    let along = 0;
    for (const v of tongue) { const a = acc.get(v); if (a) along += (a[0] * dx + a[1] * dy + a[2] * dz) / d2; }
    if (along / tongue.length > 0.5) continue;
    tongue.forEach((v, i) => {
      const a = acc.get(v) || [0, 0, 0];
      // the tongue's own (tiny) delta is replaced: it was computed as if the jaw stayed shut
      const own = acc.has(v) ? 0.2 : 0;
      acc.set(v, [a[0] * own + dx * follow[i], a[1] * own + dy * follow[i], a[2] * own + dz * follow[i]]);
    });
    const idx = Uint32Array.from([...acc.keys()].sort((a, b) => a - b));
    const val = new Float32Array(idx.length * 3);
    idx.forEach((v, k) => { const a = acc.get(v); val[k * 3] = a[0]; val[k * 3 + 1] = a[1]; val[k * 3 + 2] = a[2]; });
    model.addExpressionUnit(name, { idx, val, count: idx.length, scale: 1 });
    changed++;
  }
  return changed;
}
