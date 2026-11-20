# PosaViva — architecture & module contract

Mobile app (Android APK, Galaxy S25 Ultra target) for comic artists: poseable 3D human
references (3 female + 3 male body types), multiple characters per scene, clothes with
pose-dependent wrinkles, hair, face expressions, lights, camera/perspective tools, props.
UI language: **Italian**. Tech: Vite + three.js 0.187 (WebGL2) inside an Android WebView.

```
posaviva/
  tools/build-assets.mjs   MakeHuman CC0 data -> web/public/assets/human.{json,bin}
  tools/shot.cjs           headless screenshot helper (Playwright + SwiftShader)
  web/src/main.js          boot: loads model, App, Shell, then each module's index.js
  web/src/app.js           App (renderer, scene, camera, OrbitControls, characters, selection, tap router, history, (de)serialize)
  web/src/core/HumanModel.js  immutable shared data (topology, presets, deltas, bones, weights, eyes)
  web/src/core/Character.js   one poseable human (shape, expression morphs, skeleton, pose, CPU skinning, attachments)
  web/src/render/materials.js material library with render styles
  web/src/ui/kit.js, icons.js, shell.js, styles.css   UI component kit + app shell
  web/src/body/bodyModule.js  "Corpo" tool (reference example of a module)
  web/src/<module>/index.js   feature modules: render, scene, io(ui), pose, face, clothing, hair, props
  android/                 WebView shell (loads web/dist from assets)
```

## Units & coordinates
Meters, Y up, character faces **+Z** in its own space; character's LEFT side is **+X** (bones `*.L`).
Ground is y = 0. Each character: `ch.root` (THREE.Group: placement on ground, rotation.y, scale) >
`ch.rig` (always identity) > bones + skinned meshes. "Rig space" = character-local space.

## HumanModel (`app.model`)
- `vertexCount` (19158 mesh vertices: body + helpers), `groups` = `['body','tights','skirt','hair','eyeL','eyeR','eyelashes','teethUpper','teethLower','tongue']`
- `faceV` Uint16 (4 per face, 4th = 0xffff for triangles) mesh-vertex indices; `faceRV` same in render-vertex indices; `faceGroup` Uint8; `faceCount`
- `groupFaces[g]` face index lists; `groupVertices[g]` Uint32Array of mesh vertices of group g
- `rv2v`, `rvUV` render vertex -> mesh vertex / uv (UV seams split)
- `skinIndex` Uint8 (4/vertex, index into `bones`), `skinWeight` Float32 (4/vertex) — also defined for helper vertices
- `bones` [{name,parent,head,tail,plane}] (86 bones, parent-first), `boneIndex` Map name->index
- `presets` [{id,label,sex}] ids: `f_slim f_normal f_curvy m_slim m_normal m_curvy`; `sliders`; `expressionUnits` (34 morph units, e.g. `mouth-open`, `eye-left-closure`, `eyebrows-left-up` …)

Bone names: `root spine05 spine04 spine03 spine02 spine01 neck01 neck02 neck03 head eye.L/R`,
per side (.L/.R): `clavicle shoulder01 upperarm01 upperarm02(twist) lowerarm01 lowerarm02(twist) wrist metacarpal1-4 finger1-1..finger5-3 (finger1 = thumb) pelvis upperleg01 upperleg02(twist) lowerleg01 lowerleg02(twist) foot toe1-1..toe5-1`.
Face bones are merged into `head` (expressions are morph targets). Eye bones only drive the eyeball meshes.

## Character (`app.characters[i]`, `app.selection.character`)
Events (`ch.addEventListener(type, fn)`): `shape` (rest geometry + skeleton rebuilt), `pose`, `expression`, `appearance`, `visibility`.
- Shape: `presetId`, `sex` ('F'|'M'), `setPreset(id)`, `sliders{}` + `setSlider(id,v)`/`setSliders({})`, `rebuildShape()`.
- Rest data (rig space, grounded): `shapePositions` (no expression), `restPositions` (with expression morphs), `restNormals` (per mesh vertex, Float32 NV*3).
- Skeleton: `bones` (THREE.Bone[]), `boneByName`, `restGlobal[i]` (Matrix4 rest frame in rig space: columns X,Y,Z axes, Y = along bone head->tail, X = normal of the MakeHuman rotation plane), `jointPositions` Map.
- Pose: `poseQuat[i]` = rotation in the bone's **rest-local frame** (bone.quaternion = restLocalQuat * poseQuat). `rootOffset` (Vector3, rig space). `setBoneRotation(name, quat, apply=true)`, `getBoneRotation(name)`, `applyPose()` (call after editing poseQuat directly; fires `pose`), `resetPose()`, `getPose()`/`setPose(obj, partial)` (`{bones:{name:[x,y,z,w]}, root:[x,y,z]}`), `dropToGround()`.
  Mirror convention: for symmetric frames, the mirrored rotation of q=(x,y,z,w) on the opposite side bone is (x,-y,-z,w).
- CPU skinning: `updateSkinMatrices()` -> Float32Array(16*NB) rig-space; `skinPositions(rest, skinIndex, skinWeight, out)`; `getSkinnedPositions()` (cached skinned body vertices, rig space). Convert to world with `ch.rig.matrixWorld`.
- Meshes: `ch.body` (SkinnedMesh, draw groups: 0 skin, 1 eyelashes, 2 teeth, 3 tongue), `ch.eyeMesh`.
- `setHiddenBodyFaces(Uint8Array(faceCount)|null)` hides covered skin faces (owned by the clothing module).
- Attachments: `addAttachment(skinnedMesh)` binds to the character skeleton (geometry in rig rest space, `skinIndex` values = indices into `ch.bones`) — `removeAttachment(mesh)`.
- Appearance: `appearance {skin, eyes, lips, hair?}` + `setAppearance(patch)` (fires `appearance`).
- Per-module persistent state: `ch.data.<module>` (plain JSON). Serialized with the character.

## App (`app`)
`app.scene`, `app.world` (characters & props parent), `app.camera` (PerspectiveCamera, filmGauge 35), `app.controls` (OrbitControls),
`app.renderer`, `app.canvas`, `app.ground`, `app.grid`, `app.defaultLights` (the scene module may remove/replace these),
`app.model`, `app.materials`, `app.shell`.
- Characters: `addCharacter({preset, name, position, rotationY, json})`, `removeCharacter(ch)`, `duplicateCharacter(ch)`, `select(ch, part=null)`; `app.selection = {character, part}`.
- Events on app: `characters`, `selection` {character, part}, `history` {canUndo, canRedo}, `loaded`, `ready`, `resize`, `tool` {id}.
- Rendering is **on demand**: call `app.invalidate()` after any visual change. `addRenderHook(fn(dt) -> keepAnimating)`, `addAfterRenderHook`. A module may set `app.renderOverride = (renderer, scene, camera) => {...}` (post-processing).
- Input: `app.addTapHandler(fn({ndc,event,x,y}) -> consumed, priority)` (100 temporary modes such as camera aim, 50 props, 10 pose picking, 0 fallback). Drags: listen to pointer events on `app.canvas` yourself and set `app.controls.enabled = false` while dragging a handle; restore after. `app.pushBackHandler(fn)` for Android back.
- Undo: call `app.commit(label)` when an interaction ENDS (slider change/release, drag end, preset applied). Undo/redo restores via `app.deserialize` (in place for existing characters).
- Modules: `create(app, shell)` returns an object with optional hooks: `onCharacterAdded(ch, opts)`, `onCharacterRemoved(ch)`, `deserializeCharacter(ch)` (rebuild from `ch.data.<module>` after load/undo — must be idempotent and cheap when nothing changed), `serializeScene()` / `deserializeScene(obj)` (scene-level state: lights, camera, props, style …).

## Materials (`render/materials.js`)
`materials.apply(mesh, spec | spec[])` assigns & tracks; `materials.release(mesh)`; `materials.setStyle('realistic'|'clay'|'toon'|'lines')`.
spec = `{kind, color, map?, normalMap?, normalScale?, roughness?, metalness?, sheen?, side?, transparent?, alphaTest?, vertexColors?}`;
kinds: `skin eye lashes teeth tongue cloth hair prop ground`. Never create raw materials for character/garment/hair/prop meshes — always go through `materials.apply` so render styles work everywhere. Specs are cached: reuse identical specs.

## UI (`ui/kit.js`, `ui/shell.js`)
`shell.registerTool({id, label, icon, group, order, title?, build(container, app) -> {onShow?, onHide?}})`.
Groups (toolbar buttons): `people` Personaggi, `pose` Posa, `look` Aspetto, `scene` Scena, `camera` Camera, `style` Stile — a group with several tools shows sub-tabs.
`shell.openTool(id)`, `shell.closePanel()`, `shell.activeToolId`, `shell.hint(text, ms)`, `shell.overlay` (absolutely positioned layer above the canvas for 2D overlays/HUDs), `shell.topLeft` / `shell.topRight` (top bar slots).
Kit: `h, section, row, slider, toggle, segmented, button, swatches, cardGrid, chips, toast, haptic, icon` (see kit.js for options). Italian labels. Touch first: min 40px targets.

## Android bridge (when running in the APK)
`window.AndroidBridge.saveImage(base64Png, name)`, `saveTextFile(text, name, mime)`, `shareImage(base64Png, name)`, `vibrate(ms)`, `getDeviceInfo()`;
`window.__onAndroidBack` (set by the shell), CSS vars `--safe-top/right/bottom/left`, `window.__onInsets`.
Always feature-detect (`window.AndroidBridge?.x`) and provide a browser fallback.

## Dev
`cd posaviva/web && npx vite --port <yourPort>`; screenshots: `NODE_PATH=$(npm root -g) node posaviva/tools/shot.cjs out.png "<js to eval>" [w] [h]` with `URL=http://localhost:<port>/?only=...`.
`window.__pv = {app, shell, THREE, model, materials}` for debugging.
Performance target: 60 fps with 3 fully dressed characters on a Galaxy S25 Ultra; avoid per-frame allocations; heavy work only when state changes (throttle to animation frames).
Assets license: MakeHuman base mesh/targets/rig/eyes are CC0 1.0. Do not copy MakeHuman program code (AGPL); everything else is original.
