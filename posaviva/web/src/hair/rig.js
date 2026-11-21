// Per-character hair runtime: builds the hair mesh for the current state and
// shape, keeps the cap fitted to the skin, and runs the hanging-hair solver
// when the head / body pose changes noticeably.
//
// The hair mesh is ONE SkinnedMesh attached to the character skeleton: the cap
// carries the skin weights of the scalp, every clump is rigidly bound to the
// head bone. Simulated clumps are written back in head rest space, so the GPU
// skinning keeps them attached to the head between solves.
import * as THREE from 'three';
import { headFrame, HeadMap } from './headmap.js';
import { BodyColliders, GuideSolver } from './physics.js';
import { HairBuilder, guideFrames } from './build.js';
import { RECIPES, STYLE_BY_ID } from './styles.js';
import { HairGeometry } from './strands.js';
import { Beard, BEARD_SPECS } from './beard.js';
import { hashStr } from './util.js';

const _inv = new THREE.Matrix4();

/** Re-solve when colliders moved more than this (m, gravity tilt counts ~2 mm per degree). */
const RESOLVE_THRESHOLD = 0.0025;
/** settled when the mean point displacement per iteration is below this (m) */
const SETTLE_EPS = 0.00025;
/** iteration cap of one re-solve (spread over frames) */
const MAX_ITERS = 120;
/** solver time per frame while settling (ms) */
const FRAME_BUDGET_MS = 1.5;
/** staged (re)builds: another stage starts only while below this per frame (ms) */
const STEP_BUDGET_MS = 6;

export class HairRig {
  /**
   * @param {object} ctl module controller ({app, materials, spec(ch)})
   * @param {import('../core/Character.js').Character} ch
   */
  constructor(ctl, ch) {
    this.ctl = ctl;
    this.ch = ch;
    this.mesh = null;
    this.hg = null;
    this.built = null; // key of the built state
    this.shapeVersion = 0;
    this.clothVersion = 0;
    this._clothSeen = 0;
    this.builtShape = -1;
    this.shapeTime = 0;
    this.poseDirty = true;
    this.exprDirty = false;
    this.solver = null;
    this.dyn = null;
    this.colliders = null;
    this.map = new HeadMap();
    this.stats = { build: 0, solve: 0, write: 0 };
    this._on = {
      shape: () => { this.shapeVersion++; this.shapeTime = performance.now(); this._interimFit(); },
      pose: () => { this.poseDirty = true; },
      expression: () => { this.exprDirty = true; },
    };
    for (const [k, fn] of Object.entries(this._on)) ch.addEventListener(k, fn);
  }

  dispose() {
    for (const [k, fn] of Object.entries(this._on)) this.ch.removeEventListener(k, fn);
    this._dropMesh();
    this._dropBeard();
  }

  /**
   * Until the (debounced) rebuild, keeps the existing meshes on the head after a
   * body shape change: the bind matrix re-expresses the old rest geometry in the
   * head's new rest frame (rigid follow, no CPU work).
   */
  _interimFit() {
    const hb = this.ch.model.boneIndex.get('head');
    const now = this.ch.restGlobal[hb];
    for (const m of [this.mesh, this.beard?.mesh]) {
      if (!m?.userData.headRest) continue;
      m.bindMatrix.multiplyMatrices(now, _inv.copy(m.userData.headRest).invert());
      m.bindMatrixInverse.identity();
    }
    this.ctl.app.invalidate();
  }

  _dropBeard() {
    if (this.beard) { this.ch.removeAttachment(this.beard.mesh); this.beard = null; }
    this.beardKey = null;
  }

  /** Head landmarks, head map and colliders: only depend on the body shape (and the outfit). */
  _analyse() {
    const key = this.shapeVersion * 1000 + this.clothVersion;
    if (this._analysedKey === key && this.frame) return false;
    const ch = this.ch;
    if (this._analysedShape !== this.shapeVersion || !this.frame) this._analyseHead();
    this.colliders = new BodyColliders(ch, this.frame, this.garments(), this.ctl.app.clothing?.outerOffsets?.(ch) || null);
    this._analysedKey = key;
    return true;
  }

  /** Head landmarks and the radial head map of the current body shape. */
  _analyseHead() {
    const ch = this.ch;
    const frame = headFrame(ch);
    // most body sliders (weight, waist, legs, hips...) move the head without
    // reshaping it: the radial head map around frame.c is then still valid
    if (this.frame && this._sameHead(frame)) { this.map.c.x = frame.c.x; this.map.c.y = frame.c.y; this.map.c.z = frame.c.z; this.stats.mapReused = (this.stats.mapReused || 0) + 1; }
    else { this.map.build(ch.model, ch.shapePositions, frame); this._headSignature(frame); }
    this.frame = frame;
    this._analysedShape = this.shapeVersion;
  }

  /** Stores the head surface the map was built from: vertices above the map's cut, relative to frame.c. */
  _headSignature(frame) {
    const ch = this.ch, P = ch.shapePositions, V = ch.model.groupVertices[0];
    const cut = frame.chin.y - 0.05 * frame.s;
    const idx = [];
    for (let i = 0; i < V.length; i += 3) if (P[V[i] * 3 + 1] > cut) idx.push(V[i]);
    const rel = new Float32Array(idx.length * 3);
    idx.forEach((v, k) => { rel[k * 3] = P[v * 3] - frame.c.x; rel[k * 3 + 1] = P[v * 3 + 1] - frame.c.y; rel[k * 3 + 2] = P[v * 3 + 2] - frame.c.z; });
    this._headSig = { idx: Int32Array.from(idx), rel, rot: ch.restGlobal[frame.headBone].elements.slice(0, 11), s: frame.s };
  }

  /** True when the head surface only moved rigidly (< 1 mm change around frame.c, same rest rotation). */
  _sameHead(frame) {
    const sig = this._headSig, ch = this.ch, P = ch.shapePositions;
    if (!sig || Math.abs(sig.s - frame.s) > 1e-4) return false;
    const R = ch.restGlobal[frame.headBone].elements;
    for (let k = 0; k < 11; k++) if (k !== 3 && k !== 7 && Math.abs(R[k] - sig.rot[k]) > 1e-3) return false;
    const { idx, rel } = sig, cx = frame.c.x, cy = frame.c.y, cz = frame.c.z;
    for (let k = 0; k < idx.length; k++) {
      const v = idx[k] * 3;
      if (Math.abs(P[v] - cx - rel[k * 3]) > 0.001 || Math.abs(P[v + 1] - cy - rel[k * 3 + 1]) > 0.001 || Math.abs(P[v + 2] - cz - rel[k * 3 + 2]) > 0.001) return false;
    }
    return true;
  }

  /** Garment meshes of the character (rest-space geometry): long hair drapes over them. */
  garments() {
    const mats = this.ctl.app.materials, out = [];
    for (const m of this.ch.attachments) if (m !== this.mesh && m !== this.beard?.mesh && mats.kindOf(m) === 'cloth' && m.geometry?.attributes.position) out.push(m);
    return out;
  }

  /** The outfit was rebuilt: refresh the colliders and let hanging hair settle over it. */
  onClothing() { this.clothVersion++; }

  /** (Re)builds the facial hair when its kind or the body shape changed. */
  _syncBeard() {
    const kind = this.ch.data.hair.beard;
    const key = `${kind}|${this.shapeVersion}`;
    if (key === this.beardKey) return false;
    this._dropBeard();
    this.beardKey = key;
    if (!BEARD_SPECS[kind]) return true;
    this._analyse();
    const t0 = performance.now();
    this.beard = new Beard(this.ch, this.frame, kind);
    this.ch.addAttachment(this.beard.mesh);
    this.beard.mesh.userData.headRest = this.ch.restGlobal[this.frame.headBone].clone();
    this.ctl.applyMaterial(this);
    this.stats.beard = performance.now() - t0;
    return true;
  }

  _dropMesh() {
    if (this.mesh) { this.ch.removeAttachment(this.mesh); this.mesh = null; }
    this.hg = null;
    this.solver = null;
    this.dyn = null;
  }

  /** Key of everything that changes the geometry (not the colour). */
  geometryKey(st) { return `${st.style}|${st.length.toFixed(3)}|${st.volume.toFixed(3)}|${st.parting}|${st.bangs ? 1 : 0}`; }

  /** Builds (or rebuilds) the hair for the current state, in one go. */
  build() {
    this._job = null;
    const g = this._buildSteps();
    let r = g.next();
    while (!r.done) r = g.next();
  }

  /**
   * The build as a generator: head analysis, strand growth, the rest settle and the
   * clump bindings, geometry. update() runs it over several frames within a time
   * budget (a long style used to cost one ~150 ms frame); the old mesh stays until
   * the new one replaces it.
   */
  *_buildSteps() {
    const t0 = performance.now();
    const ch = this.ch, st = ch.data.hair;
    const key = this.geometryKey(st), shape = this.shapeVersion;
    const recipe = RECIPES[st.style];
    if (!recipe || st.style === 'nessuno') {
      this._dropMesh();
      this.built = key; this.builtShape = shape;
      this.stats.build = performance.now() - t0;
      return;
    }
    const T = this.stats.t = {};
    let tt = performance.now(), work = 0;
    const lap = (k) => { const n = performance.now(); T[k] = +((T[k] || 0) + n - tt).toFixed(1); work += n - tt; tt = n; };
    const pause = () => { tt = performance.now(); };
    // head analysis and colliders only depend on the body shape: reuse them across style changes
    // (the head map and the colliders are separate stages)
    if (this._analysedShape !== this.shapeVersion || !this.frame) { this._analyseHead(); lap('analysis'); yield 'head'; pause(); }
    if (!this._analyse()) this.colliders.update(true);
    const frame = this.frame, colliders = this.colliders;
    lap('analysis');
    yield 'analysis'; pause();
    // rest-pose colliders while growing (another rig step may have posed them)
    colliders.update(true);
    const b = new HairBuilder({ ch, model: ch.model, frame, map: this.map, colliders, seed: hashStr(st.style) ^ 0x5bd1 }, st);
    recipe(b, STYLE_BY_ID.get(st.style));
    lap('recipe');
    yield 'recipe'; pause();
    const fin = b.finishSteps();
    let r = fin.next();
    while (!r.done) { lap('dynamics'); yield 'dynamics'; pause(); colliders.update(true); r = fin.next(); }
    const res = r.value;
    lap('dynamics');
    // swap: the new hair replaces the old one
    this._dropMesh();
    this.built = key;
    this.builtShape = shape;
    const hg = new HairGeometry(res.strands, res.patch, res.solids, frame.headBone);
    this.hg = hg;
    this.capOffset = res.capOffset;
    this.axisRest = { cx: frame.c.x, cy: frame.c.y, cz: frame.c.z, dx: 0, dy: -1, dz: 0 };
    this.axis = { ...this.axisRest };
    this._fitCap();
    const list = res.strands.list;
    for (let i = 0; i < list.length; i++) hg.writeStrand(i, list[i].pts, 0, this.axisRest);
    hg.markDirty(true);
    lap('geometry');
    if (res.dyn) {
      this.dyn = res.dyn;
      this.solver = new GuideSolver(res.dyn.rest, res.dyn.guides, this.map, colliders, res.dyn.lengths);
      this._frames = null;
      this._lastG = null; this._movedG = null; this._firstSolveDone = false;
      let maxK = 0;
      for (const x of res.dyn.binds) if (x.K > maxK) maxK = x.K;
      this._buf = new Float32Array(maxK * 3);
      this.poseDirty = true;
      this._forceSolve = true;
    }
    const mesh = new THREE.SkinnedMesh(hg.geometry, []);
    mesh.name = 'hair';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.pickable = false;
    mesh.userData.hairModule = true;
    ch.addAttachment(mesh);
    mesh.userData.headRest = ch.restGlobal[frame.headBone].clone();
    this.mesh = mesh;
    this.ctl.applyMaterial(this);
    this.stats.build = work + performance.now() - tt;
    this.stats.wall = performance.now() - t0;
    this.stats.vertices = hg.vertexCount;
    this.stats.strands = list.length;
  }

  /** Advances the staged build: stages run while less than STEP_BUDGET_MS were used this frame. */
  _advanceJob() {
    const t0 = performance.now();
    do {
      let r;
      try { r = this._job.gen.next(); } catch (e) { console.error('[hair] build failed', e); this._job = null; this.built = this.geometryKey(this.ch.data.hair); this.builtShape = this.shapeVersion; return; }
      if (r.done) { this._job = null; this._lastBuildAt = performance.now(); return; }
    } while (performance.now() - t0 < STEP_BUDGET_MS);
  }

  _fitCap() {
    const hg = this.hg;
    if (!hg?.patch) return;
    hg.patch.fit(this.ch.restPositions, this.ch.restNormals, this.capOffset);
    hg.writePatch();
  }

  /**
   * Per-frame work (render hook). Returns true while the solver is settling.
   * Heavy work only when something changed.
   */
  update(now) {
    const ch = this.ch, st = ch.data.hair;
    if (!st) return false;
    // a staged build in flight: continue it, or restart when what it builds is out of date
    if (this._job && (this._job.key !== this.geometryKey(st) || this._job.shape !== this.shapeVersion)) { this._job = null; this.poseDirty = true; }
    if (!this._job) {
      // shape changes: rebuild debounced (sliders fire every frame while dragging)
      const shapeDue = this.builtShape !== this.shapeVersion && now - this.shapeTime > 160;
      // style edits: throttled while a slider is being dragged
      const styleDue = this.built !== this.geometryKey(st) && now - (this._lastBuildAt || 0) >= 90;
      if (shapeDue || (styleDue && this.builtShape === this.shapeVersion)) this._job = { gen: this._buildSteps(), key: this.geometryKey(st), shape: this.shapeVersion };
      else if (this.built !== this.geometryKey(st)) return true;
    }
    if (this._job) {
      this._advanceJob();
      this.ctl.app.invalidate();
      // the old hair waits (rigidly on the head) until the new one replaces it
      if (this._job) return true;
    }
    if (this.builtShape === this.shapeVersion && this._syncBeard()) this.ctl.app.invalidate();
    if (this.exprDirty) {
      this.exprDirty = false;
      if (this.hg?.patch) { this._fitCap(); this.hg.markDirty(); }
      this.beard?.fit();
      this.ctl.app.invalidate();
    }
    if (this._clothSeen !== this.clothVersion) {
      this._clothSeen = this.clothVersion;
      if (this.frame && this.builtShape === this.shapeVersion) {
        this._analyse();
        if (this.solver) { this.solver.col = this.colliders; this._forceSolve = true; this.poseDirty = true; }
      }
    }
    if (!this.solver) return false;
    // an interrupted rebuild already analysed a newer body shape: the old hair waits for its
    // replacement (it rides the head rigidly) instead of colliding with the new head map
    if (this._analysedShape !== this.builtShape) return true;
    const solver = this.solver;
    // an interrupted rebuild may have replaced the colliders: the running solver uses the current ones
    if (solver.col !== this.colliders) { solver.col = this.colliders; this.poseDirty = true; }
    if (this.poseDirty) {
      this.poseDirty = false;
      this.colliders.update(false);
      if (this._forceSolve || this._delta() > RESOLVE_THRESHOLD) {
        this._snapshot();
        if (this._forceSolve) { solver.reset(); this._forceSolve = false; }
        solver.settled = false;
        this._iters = 0;
      }
    }
    if (solver.settled) return false;
    const t0 = performance.now();
    // a few iterations per frame (time budget), more on the very first solve after a build / load
    let it = 0;
    const budget = this._firstSolveDone ? FRAME_BUDGET_MS : 20;
    do { solver.iterate(2); it += 2; } while (solver.meanMove > SETTLE_EPS && performance.now() - t0 < budget && this._iters + it < MAX_ITERS);
    this._iters += it;
    const t1 = performance.now();
    this._applyDynamics();
    this.stats.solve = t1 - t0;
    this.stats.write = performance.now() - t1;
    this.stats.iterations = it;
    if (solver.meanMove <= SETTLE_EPS || this._iters >= MAX_ITERS) { solver.settled = true; this._firstSolveDone = true; }
    this.ctl.app.invalidate();
    return !solver.settled;
  }

  _delta() {
    const sig = this.colliders.sig, last = this._lastSig;
    if (!last) return Infinity;
    let d = 0;
    const n = this.colliders.n * 6;
    for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(sig[i] - last[i]));
    for (let i = n; i < n + 3; i++) d = Math.max(d, Math.abs(sig[i] - last[i]) * 0.12);
    return d;
  }

  _snapshot() {
    const sig = this.colliders.sig;
    if (!this._lastSig || this._lastSig.length !== sig.length) this._lastSig = new Float32Array(sig.length);
    this._lastSig.set(sig);
  }

  /** Precomputes the guide float indices (segment base, fraction) of a binding. */
  _prepareBind(b) {
    const K = b.K;
    b.base = new Int32Array(3 * K);
    b.fu = new Float32Array(3 * K);
    for (let j = 0; j < 3; j++) for (let k = 0; k < K; k++) {
      const u = b.at[j * K + k], i0 = Math.min(K - 2, u | 0);
      b.base[j * K + k] = (this.dyn.guides[b.g[j]].start + i0) * 3;
      b.fu[j * K + k] = u - i0;
    }
  }

  /** Rebuilds every simulated clump from the guides (head rest space). */
  _applyDynamics() {
    const { dyn, solver, hg, colliders } = this;
    const G = solver.cur, list = hg.strands.list;
    const c = this.frame.c, cv = this._cv || (this._cv = [0, 0, 0]);
    cv[0] = c.x; cv[1] = c.y; cv[2] = c.z;
    this._frames = guideFrames(G, dyn.guides, cv, this._frames);
    const { T, N, B } = this._frames;
    const out = this._buf;
    const ax = this.axis;
    ax.dx = colliders.down[0]; ax.dy = colliders.down[1]; ax.dz = colliders.down[2];
    const sigma2 = (0.03 * this.frame.s) ** 2;
    // guides that moved since the last write (clumps of still guides keep their geometry)
    // (seeded with the rest guides: that is what the build wrote into the geometry)
    const last = this._lastG || (this._lastG = Float32Array.from(dyn.rest));
    const moved = this._movedG || (this._movedG = new Uint8Array(dyn.guides.length));
    for (let gi = 0; gi < dyn.guides.length; gi++) {
      const gd = dyn.guides[gi];
      let m = 0;
      for (let q = gd.start * 3, e = (gd.start + gd.K) * 3; q < e; q++) { const d = Math.abs(G[q] - last[q]); if (d > m) m = d; }
      moved[gi] = m > 1e-4 ? 1 : 0;
      if (moved[gi]) for (let q = gd.start * 3, e = (gd.start + gd.K) * 3; q < e; q++) last[q] = G[q];
    }
    for (const b of dyn.binds) {
      if (!((b.w[0] && moved[b.g[0]]) || (b.w[1] && moved[b.g[1]]) || (b.w[2] && moved[b.g[2]]))) continue;
      const K = b.K, rest = list[b.strand].pts;
      if (!b.base) this._prepareBind(b);
      const base = b.base, fu = b.fu, off = b.off, w0 = b.w[0], w1 = b.w[1], w2 = b.w[2];
      for (let k = 0; k < K; k++) {
        const q = k * 3, beta = b.beta[k];
        if (beta <= 0) { out[q] = rest[q]; out[q + 1] = rest[q + 1]; out[q + 2] = rest[q + 2]; continue; }
        // position proposed by each of the (up to) 3 guides at the bound guide parameter
        let x0 = 0, y0 = 0, z0 = 0, x = 0, y = 0, z = 0, ws = 0, agree = 1;
        for (let j = 0; j < 3; j++) {
          const w = j === 0 ? w0 : j === 1 ? w1 : w2;
          if (!w) continue;
          const jk = j * K + k, o0 = base[jk], o1 = o0 + 3, f = fu[jk], fr = f > 1 ? 1 : f, fo = jk * 3;
          const ot = off[fo], on = off[fo + 1], ob = off[fo + 2];
          const px = G[o0] + (G[o1] - G[o0]) * f + (T[o0] + (T[o1] - T[o0]) * fr) * ot + (N[o0] + (N[o1] - N[o0]) * fr) * on + (B[o0] + (B[o1] - B[o0]) * fr) * ob;
          const py = G[o0 + 1] + (G[o1 + 1] - G[o0 + 1]) * f + (T[o0 + 1] + (T[o1 + 1] - T[o0 + 1]) * fr) * ot + (N[o0 + 1] + (N[o1 + 1] - N[o0 + 1]) * fr) * on + (B[o0 + 1] + (B[o1 + 1] - B[o0 + 1]) * fr) * ob;
          const pz = G[o0 + 2] + (G[o1 + 2] - G[o0 + 2]) * f + (T[o0 + 2] + (T[o1 + 2] - T[o0 + 2]) * fr) * ot + (N[o0 + 2] + (N[o1 + 2] - N[o0 + 2]) * fr) * on + (B[o0 + 2] + (B[o1 + 2] - B[o0 + 2]) * fr) * ob;
          let ww = w;
          if (j === 0) { x0 = px; y0 = py; z0 = pz; }
          else {
            // guides that went elsewhere (other side of a shoulder...) lose their influence
            const dx = px - x0, dy = py - y0, dz = pz - z0;
            const e = Math.exp(-(dx * dx + dy * dy + dz * dz) / sigma2);
            ww *= e;
            if (e < agree) agree = e;
          }
          x += ww * px; y += ww * py; z += ww * pz; ws += ww;
        }
        x /= ws; y /= ws; z /= ws;
        x = rest[q] + (x - rest[q]) * beta; y = rest[q + 1] + (y - rest[q + 1]) * beta; z = rest[q + 2] + (z - rest[q + 2]) * beta;
        // clumps must not cut through the body or the clothes: their lateral offset
        // from the guides (and blending between diverging guides) can reach inside
        // even when the guides themselves rest on the colliders
        colliders.push(x, y, z, b.rad * (agree < 0.92 ? 0.7 : 0.6), out, q);
      }
      hg.writeStrand(b.strand, out, 0, ax);
    }
    hg.markDirty();
  }
}
