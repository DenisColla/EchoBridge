# Paesaggi (ready landscapes)

Ready environments generated around the characters, every time different, and
editable afterwards. Tool **Scena › Paesaggi** (`id: 'landscapes'`).

## How it works

```
spec ──cleanSpec──► resolve(spec, seed) ──► preset.build(Gen) ──► items / animals / terrain / scatter
         (Italian synonyms)   (preset, time, weather,      (pure data, local frame:     │
                               season, density, variant)    characters at the origin,   ├─► props (app.props.create, one group)
                                                            camera towards +Z)          ├─► animals (app.animals.add)
                                                                                        ├─► Environment (sky, terrain, water,
                                                                                        │    scatter, rain / snow, fog)
                                                                                        └─► light rig state (app.lightRig.setState)
```

* **Every time different**: `generate()` without a seed draws fresh seeds until the
  free choices (time, weather, season, layout variant, density) differ enough from
  the last 6 generations on this device (`localStorage posaviva.landscapes.recent`).
* **Restorable**: everything depends only on `(spec, seed)` and the frame
  (`{x, z, yaw}`: centre of the characters, front towards the camera). The
  environment layer is rebuilt from them on undo / scene load; the objects are
  saved by their own modules (props, animals), the lights by the scene module.
* **Editable**: each object is a normal prop (Oggetti / Edifici / Esterni) or animal
  (Animali). Props share the group `L<landscape id>` ("Separa" in Oggetti / Esterni
  detaches one, so "Rigenera" keeps it).

## Files

```
index.js        module entry: registers prop types / roles, app.landscapes, tool, scene hooks
manager.js      LandscapeManager (public API, generation, novelty check, framing, persistence)
atmos.js        TIMES / WEATHERS / SEASONS + atmosphere(): sun, sky colours, clouds, fog, ambient, foliage
lighting.js     atmosphere -> light rig state (sun / moon key, sky rim, hemisphere, lamps at night)
rand.js         seeded RNG (mulberry32), 2D gradient noise, fbm, ridged
gen/context.js  Gen: reservation of the stage / camera corridor, add(), tryAdd(), scatterOf()
gen/terrainKit.js relief() (hills, mountains, dunes, coast, basin, bumps) and biome() colours
gen/common.js   roads, parked cars, seasonal trees, far skyline, forests, street lamps
presets/        city.js nature.js fantasy.js rooms.js (ROOM_PRESETS of the props module), index.js (resolve)
env/            sky.js (shader dome), terrain.js (polar heightfield + water), vegetation.js (instanced
                scatter), weather.js (rain / snow), textures.js, index.js (Environment)
types.js        extra prop types (category "Paesaggio"): fontana, insegna neon, tetto, barca, pontile,
                container, gru, bancarella, pozzo, carretto, rovine, fieno, ombrellone, lettino, cactus,
                pianta tropicale, felce, lanterna, falò
panel.js thumbs.js landscapes.css   UI
```

## Render styles

* Sky dome: `userData.isGround` (background layer of the pipeline: never inked, a
  shadow catcher in transparent exports), shader modes realistic / clay
  (desaturated) / toon (flat bands); hidden in `lines` (paper).
* Terrain / water / far scatter: `kind: 'ground'` (no ink, like painted comic
  backgrounds); near scatter and every object: `kind: 'prop'` (inked).
* Fog (`FogExp2`) off in `lines`, neutral grey in `clay`. Clay ignores vertex
  colours; scatter instance colours switch to neutral greys.
* Rain / snow are UI-layer meshes exported in captures (`userData.export`).

## Performance

* Terrain: one mesh (~13k vertices, polar rings, dense near the stage).
* Scatter: one `InstancedMesh` per species × 4 sectors × near/far band (frustum
  culling per sector), 60–300 triangles per instance.
* Generation is split across animation frames (~14 ms slices) with rendering
  held until the scene is complete.

## Public API (`app.landscapes`)

```js
app.landscapes.presets                       // [{id, label, group: 'citta'|'natura'|'fantasy'|'stanze', tags: [italian words]}] (28)
await app.landscapes.generate({ preset?, place?, time?, weather?, season?, density?, features?, seed? })
  // -> {id, seed, spec}. place: free Italian text ("una spiaggia al tramonto"); time/weather/season
  // accept Italian synonyms (notte/notturno, sole/sereno, piove/pioggia...); features: ['alberi',
  // 'auto', 'fontana', 'neon', 'lampioni', 'panchine', 'fiori', 'rocce', 'animali', 'barche',
  // 'bancarelle', 'fuoco', 'cespugli', 'lanterne']; seed: exact rebuild of a previous result.
await app.landscapes.regenerate()            // same spec, new seed
app.landscapes.setAtmosphere({ time, weather, season })  // changes light / sky / weather in place, objects kept
app.landscapes.clear()                       // removes objects + environment, restores the previous lights
app.landscapes.current                       // {id, seed, spec, resolved, frame, group, animals, ...} | null
app.landscapes.heightAt(x, z)                // ground height (terrain, roofs, piers); 0 without landscape
app.landscapes.hasTerrain                    // true while a landscape with its own ground is shown (rooms: false)
app.landscapes.rayGround(ray, lift?, target?) // first point where a THREE.Ray meets the ground (+ lift m), or null
app.landscapes.serialize() / deserialize(obj)
app.landscapes.exportData() / await applySaved(data)    // "Salva paesaggio" (app.projects.saveItem type 'landscape')
app.landscapes.addEventListener('generated' | 'cleared' | 'change' | 'progress', fn)
```

### Ground contract (everything standing on a landscape)

`heightAt(x, z)` is the one ground height used by every module: props (`app.props.floorAt /
floorUnder`: add, ground, spawn, duplicate, "Altezza da terra"), exteriors (`app.city.groundY` =
ground pieces on top of it), buildings (lowest point of the footprint), animals
(`app.animals.floorAt`: placement, duplicate, "A terra"), characters (Posa › "Appoggia a terra",
"Altezza da terra", `app.city.liftCharacter`, which leaves characters standing / sitting / lying
on a support alone) and the camera floor (`sceneTools.camera.floorAt`: ground + 5 cm, more far
from the stage where the mesh is coarser). Every drag (Oggetti, Esterni, Edifici, Animali, Posa ›
Sposta) moves the object under the finger with `rayGround` instead of along a flat plane, keeping
its height above the ground; a character that started on the ground lands on `app.city.groundY`.

Generation, "Svuota" and a saved landscape keep the user's own props and animals at the same
height above the ground (`_groundSnapshot` / `_groundSettle`; nothing moves on the flat stage).
Buildings that follow the terrain get a levelled site (`_levelSites`: no gap under the downhill
side); long, low items on slopes (fences, carts, benches, logs, cars) are tilted with the ground
(`_fitSlope`, up to 20°, flat path pieces up to 35°); long paths are chains of short pieces (`gen/common.js trail()`). "Salva" opens the projects module's «Salva in…» sheet
(`app.projects.openSaveSheet({type: 'landscape', name, data})`).

Scene JSON: `app.serialize().scene.landscapes = {v: 1, cur: {id, seed, spec, resolved, frame, chars, group, animals, prevLights, ms, items} | null}`.
Module exports: `PRESETS, GROUPS, resolve(spec, seed), matchPreset(text), TIMES, WEATHERS, SEASONS`.
