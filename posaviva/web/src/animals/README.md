# Animali (poseable animals)

Scene objects with a skeleton (not `Character`s): 24 species built at build time
from procedural, anatomically proportioned body descriptions, posed with
sliders, ready poses, mirror, mouth, size and age, persisted with the scene.

No third-party models are used: Poly Haven (the CC0 source used elsewhere in
PosaViva) has no rigged animals among the listed species (its only creature is a
rat), so every mesh is generated here and is original work.

## Files

```
tools/build-animals.mjs          build: species -> assets/animals/<id>.bin + animals.json (+ PNG previews)
web/src/animals/engine/          build-time engine (node, no three.js)
  sdf.js        primitives (ellipsoid, round cone, elliptic loft, box), smooth union / subtraction, noise
  mesher.js     narrow-band sampling + surface nets (dual contouring family) + projection on the level set
  simplify.js   quadric error edge-collapse decimation
  bake.js       normals, skin weights (primitive ownership -> bones -> surface diffusion), regions,
                coat masks, AO from the field, box-mapping charts, region-sorted triangles
  format.js     binary layout; raster.js software previews (rest + posed, PNG)
web/src/animals/species/          species descriptions (build time)
  builder.js    Builder: bones, primitives, eyes (auto-placed in the head surface), teeth
  quadruped.js  archetype shared by all 24 species (+ feet, ears, horn / mane helpers)
  coat.js       coat masks helpers + declarative mkCoat()
  carnivores.js ungulates.js others.js primates.js   the species
  index.js      SPECIES registry (catalog order)
web/src/animals/ (runtime)
  index.js      module entry: tap handler (priority 45), highlight, back handler, applyPreset, focus
  manager.js    AnimalManager (app.animals): add / remove / duplicate / select / pick / (de)serialize
  Animal.js     one animal: SkinnedMesh (GPU skinning, materials.apply), eyes, teeth, coat, size, age, pose
  loader.js     manifest + binary decoding (shared attributes per species)
  controls.js   poseable parts per family (registerFamily)
  poses.js      ready poses per family (pure data; resolvePose)
  coatColor.js  masks + palette -> vertex colours (runtime and previews)
  textures.js   fur / skin detail normal maps and eye textures (CanvasTexture)
  panel.js gizmo.js highlight.js thumbs.js animals.css
```

Build: `node tools/build-animals.mjs [ids…] [--preview <dir>] [--res 300]`.
Several builds may run in parallel (the manifest is updated under a lock).
About 25–80 s per species; 24 species ≈ 13.6 MB of assets.

## Coordinates and skeleton

Meters, Y up, the animal faces **+Z**, its LEFT side is **+X** (`*.L` bones).
Origin on the floor at the centre of the four feet. Bone rest frames are
**world aligned** (identity rotation): a bone is a pivot point (`head`) and a
`tail` used for skin weights, picking and side-view angles. Pose rotations are
therefore easy to read: for a bone pointing down, +X swings it backwards; for
the head (pointing forward) +X tips it down; for the tail +X lifts it.
Mirror convention: `(x, y, z, w)` on one side is `(x, -y, -z, w)` on the other.

Shared bone names (families may add more, e.g. the elephant's `trunk1..6`):

```
hips > spine1 > spine2 > chest > neck1 > neck2 > head > jaw, ear.L/R, [trunk1..]
hips > tail1 > tail2 …
chest > scapula.S > upperarm.S > forearm.S > hand.S > fingers.S      (S = L | R)
hips  > thigh.S > shin.S > foot.S > toes.S
```

## Species format

A species (see `species/*.js`) is a plain object:

```js
{
  id: 'cane_medio', label: 'Cane medio', sub: 'Labrador',
  group: 'domestici' | 'fattoria' | 'selvatici' | 'esotici',
  family: 'quadruped' | 'primate' | 'macropod' | <your family>,  // poses + controls
  gait: 'digitigrade' | 'unguligrade' | 'plantigrade' | …,         // per-gait pose overrides
  tris: 22000,                     // decimation target
  build: () => ({ B, lm }),        // Builder with bones + primitives, landmarks for the coat
  coat: (v, lm) => masks,          // per vertex: {under, pattern, points, extra, shade, region?, regionW?}
  skinFn?: (v, lm) => 0..1,        // bare-skin region weight (primates' faces, palms)
  fur: { type, scale, normalScale, roughness, sheen },  // detail normal map + material
  iris, pupil: 'round' | 'slit' | 'bar', teethColor,
  palettes: [{ id, label, colors: { base, under, pattern, points, extra, keratin, nose, mouth, pad, skin, eyelid } }],
  poses?: { <poseId>: { bones, replace? } },  // species overrides of the family poses
}
```

`build()` usually calls `quadruped(params)` (species/quadruped.js) with a
side-view description in units of the withers height `H`:
`torso` stations `[z, top, bottom, halfWidth]` (or `torsoLoft` for upright
bodies), joint tables `hip knee hock hpaw / scap shoulder elbow wrist fpaw`,
`spine`, `neck`, `head` (muzzle / jaw stations along the head, mouth line,
nose, eye), `ear` (`drop | erect | round | side | flap`), leg radius profiles
`fore / hind`, `foot` / `hindFoot` (`paw | hoof | cloven | plantigrade | pillar | knuckle | ape`),
`tail` (incl. `tuft`, hair `hair`) and `extras(B, ctx)` for horns, antlers,
manes, trunks, tusks.

Primitives (`B.ell / ball / cone / loft / box`) take
`{bones, part, mat, k, op, noise}`: `bones` = the bones the surface follows
(skin weights use the nearest of them, then diffuse over the surface), `part` =
anatomical tag for coat masks, `mat` = surface region (`fur keratin nose mouth
pad skin eyelid`: one material group each), `k` = smooth-union radius, `op` =
`add | sub | inter`. Subtractions with a `mat` paint the carved wall (mouth slit,
nostrils, ear cups).

### Adding a family (birds, fish, serpents, reptiles, dragons)

1. Write an archetype like `quadruped.js` that creates the bones (names of your
   choice, world aligned rest frames) and primitives on a `Builder`.
2. `registerFamily(id, {controls(entry) -> [{id, label, bones[], side?, mirror?, axes:[{k:'x'|'y'|'z', label, sign, min, max, sided?}]}]})`
   from `web/src/animals/controls.js` (also exported by the module entry).
3. Add the family's ready poses to `FAMILY_POSES` in `poses.js` (raw Euler
   XYZ degrees per bone; `'name*'` keys apply to both sides mirrored;
   `{a: deg}` values set an absolute side-view angle so a pose fits every
   species' leg proportions).
4. Register the species in `species/index.js` and run the build.

## Binary (`<id>.bin`) and manifest (`animals.json`)

Sections (offset, element count in the manifest `layout`; 4-byte aligned):
`pos` u16×3 (quantized in `quant.min/size`), `nrm` i8×3, `chart` u8 (box-mapping
axis), `mask` u8×4 (under, pattern, points, extra), `extra` u8×4 (region, region
weight, fur shade, AO), `skin` u8×4, `weight` u8×4 (sum 255), `index` u16|u32×3
sorted by region (`groups`). The manifest entry also holds `bones`
`[{name, parent, head, tail}]`, `eyes`, `teeth`, `bounds`, `height`, `fur`,
`palettes`, `iris`, `pupil`.

## Runtime API

```js
const a = await app.animals.add('cavallo', {near, position, rotationY, palette, size, age, pose});
app.animals.select(a, 'head');                 // selection + part (control id)
app.modules.animals.applyPreset(a, 'run');     // ready pose (+ drop to the floor)
app.modules.animals.focus(a, 'head');          // frame the camera (not committed)
a.setAxis(ctrl, ctrl.axes[0], 30); a.mirrorPose(); a.dropToGround(); a.setPalette('morello');
a.setSize(1.2); a.setAge(0.2); a.toJSON(); a.raycast(ray); a.worldBox(); a.bonePoint('head', 0.5);
```

Scene JSON: `app.serialize().scene.animals = {v: 1, animals: [{id, species, name,
position, rotationY, palette, color, size, age, pose: {bones: {name: [x,y,z,w]}, lift}}]}`.
Undo: every interaction ends with `app.commit(label)`; `deserializeScene` updates
existing animals in place.
