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

## Module public APIs (as implemented)

### scene (luci, camera, guide prospettiche)

Runtime objects set by create():
- app.lightRig === app.sceneTools.lights (LightRig, lights.js). Members: state / getState() / setState(json); applyPreset(id: 'studio'|'rembrandt'|'backlight'|'top'|'horror'|'sunset'|'night'|'flat'); addLight(type 'sun'|'spot'|'point') -> id; removeLight(id); set(id, patch, {live}); setAmbient(patch, {live}); endLive(label) (commits); select(id); selected; lights; aimAtSubject(); subjectCenter(out); setHandlesPref(bool); setHandlesWanted(bool); setShadowQuality(maxMapSize) (an upper bound the render quality preset should call); markWorldDirty(); group (=== app.defaultLights now); hemi; handleGroup (userData.isHelper=true). Event 'change' {what:'state'|'change'|'live'|'select'|'handles'}. Every light created by the rig has light.userData.pvManagedShadow = true.
- app.sceneTools.camera (CameraRig, cameraRig.js). Members: focal; roll; keepFraming; views; setFocal(mm, {keepFraming, animate, commit}); setRoll(deg, {commit}); frameSubject({animate, commit}); quickAngle('eye'|'low'|'high'|'top'|'front'|'threeq'|'side'|'back'); startAim() / cancelAim() / aiming; aimAt(Vector3); raycastScene(ndc) -> hit (meshes in app.world + ground); saveView(i) / restoreView(i) / deleteView(i) / applyView(v, {animate, commit}); currentView(); commit(label) (bumps crev and calls app.commit); animating. Events 'change' ({live} during animations), 'aim' {active}, 'aimed' {point}, 'views'. Constants exported: FOCAL_MIN/MAX, FOCAL_CHIPS, DEFAULT_FOCAL, QUICK_ANGLES, CAMERA_FLOOR, MAX_VIEWS.
- app.sceneTools.guides (PerspectiveGuides, guides.js). Members: state / set(patch) / getState() / setState(); drawTo(ctx, W, H, pxScale) draws the guides for the current camera into any 2D context (for exports); frameRect(W, H) and getFrameRectNormalized() give the comic-panel crop rect (normalized 0..1) or null; info {vps:[{label,x,y,finite,onScreen}], horizon:{a,b,c,angle}, frame} in CSS px; alignToCharacter(); alignToView(); canvas. Events 'change', 'drawn'. Exported: FRAME_RATIOS, GUIDE_COLORS, defaultGuides().
- Module exports usable by others: LIGHT_PRESETS (lightPresets.js); kelvinToSRGB / kelvinToHex / setColorFromKelvin / kelvinGradientCSS (color.js); characterBounds / characterCenter / characterEyes / characterYaw / worldBounds (bounds.js, cheap skeleton-based bounds).
- Scene JSON: app.serialize().scene.scene = {v:1, lights:{preset, ambient, lights:[...], handles}, camera:{p,t,f,r,keep,crev,views:[{p,t,f,r,thumb}|null x6]}, guides:{visible, mode, horizon, yaw, density, color, opacity, thirds, frame, mask, gridSync}}.
- Conventions: objects with userData.isHelper === true (the 'pvLightHandles' group) are editor helpers and must not appear in exports. The module sets renderer.shadowMap.type = PCFShadowMap and patches THREE.ShaderChunk.shadowmap_pars_fragment once (smooth grid PCF).

### render (stili, inchiostro, cattura)

**Capture**
- `app.capture({scale = 2, transparent, width, height}) -> Promise<HTMLCanvasElement>` (2D canvas, straight alpha).
  - Default size is the canvas CSS size × `scale`. With only `width` or only `height`, the view's aspect is kept. With both, the camera aspect is changed temporarily and the vertical field of view is preserved.
  - Output is capped at 8192 px per side and 36 Mpx.
  - If `transparent` is omitted, it defaults to true when the background is "Trasparente". Transparent output hides background and grid; the floor keeps only received shadows (or is hidden in the lines style or with shadows off).
  - Helper objects are hidden in captures unless `userData.export === true`. DOM overlays are never included.

**Module object** (`app.modules.render`)
- `getSettings()` returns the scene-level settings: `{style, outline:{realistic,clay,toon,lines}, inkWidth (CSS px), inkColor, crease (0..1), bg:{type:'solid'|'gradient'|'transparent', color, top, bottom}, ground, grid, shadows, ao, aoIntensity, exposure}`.
- `set(patch, {commit?: label})` merges nested objects and records an undo step when `commit` is given.
- `setStyle(id) -> Promise`.
- `setQuality('alta'|'media'|'bassa')`, `setPref('dynamic'|'fps', bool)`; `quality` and `prefs` getters (device preferences, kept in localStorage, not in the scene).
- `capture` (same as `app.capture`); `pipeline`, `perf`, `materials`, `STYLES`.
- Hooks `serializeScene()` / `deserializeScene(obj)`.

**Events on app**
- `'renderstyle' {settings}` after any style setting change.
- `'capture' {phase: 'before'|'after', transparent}` around a capture.

**Materials** (`render/materials.js`)
- Existing API unchanged (`apply`, `release`, `setStyle`, `setTexture`, `STYLES`, `factories`).
- Added `isTracked(obj)` and `kindOf(obj)`, and a `'refresh'` event after materials are reassigned.
- `kind: 'eye'` alpha-tests the transparent cornea and tints the iris with `spec.color`.
- Optional `spec.opacity`; `spec.side` may also be 'front' / 'back' / 'double'; props accept `sheen`.
- Textures used: `textures.eye`, `textures.skinDetail` (main.js loads both).

**Conventions for other modules**
- Every mesh not managed by `materials.apply` is treated as a UI helper: drawn above the ink, never outlined, hidden in captures unless `userData.export === true`.
- Garment meshes (`kind: 'cloth'`) automatically get fold lines from normal maps or geometric folds.
- Meshes with `userData.isGround` or `kind: 'ground'` are never outlined.
- Shadow quality cap goes through `app.lightRig.setShadowQuality(size)` when present (called at start and on the 'ready' event); unmanaged lights are only capped, never raised.

### props (oggetti di scena)

Module entry `web/src/props/index.js`:
- `create(app, shell)` returns the module hooks: onCharacterAdded, onCharacterRemoved, serializeScene, deserializeScene.
- It also re-exports `PROP_TYPES` and `CATEGORIES`.

**`app.props` (PropManager, an EventDispatcher)**

Methods:
- `add(typeId, {near: character, select = true})` → Prop. A hand prop goes into a free hand of `near`.
- `remove(prop)`, `duplicate(prop)`, `clear()`
- `select(prop|null)`; `selected` property.
- `attach(prop, ch, 'L'|'R', {pose = true})`: puts a prop in a hand. `pose` closes the fingers around it.
- `detach(prop, {ground = false})`: releases it, keeping where it is in the world.
- `closeHand(prop)`
- `freeHand(ch)` → 'R' | 'L' | null; `heldBy(ch, side)`
- `ground(prop, {straighten})` → the prop it landed on, or null for the floor.
- `straighten(prop)`
- Setters: `setYaw`, `setTilt`, `setHeight`, `moveTo`, `setScale`, `setParams`, `setColor`, `setGrip`.
- `pick(ndc, {occlusion = true})` → {prop, point, distance} | null. A character's body in front of the prop blocks the pick.
- `serialize()` / `deserialize(obj)`

Properties:
- `props`: Prop[]
- `meshes`: cached array of every prop mesh. Each mesh has `userData.prop` (the Prop) and `userData.role`; the prop's root group also has `userData.prop`. Useful for raycasts, e.g. camera aim.
- `gizmo`: snap setting (`setSnap`) and the last drawn handle positions.

Events:
- 'list': props added or removed.
- 'select' {prop}
- 'change' {prop}

**Prop**
- Fields: id, type (catalog entry), params, color, scale, hold ({ch, characterId, side} | null), grip ({slide, twist, flip}), root (Group), meshes.
- Methods: `worldBox(box)`, `worldMinY()`, `toJSON()`.

**Helpers in grip.js**
- `fistFrame(ch, side)` → Matrix4 in wrist-bone space.
  - Origin: centre of a closed fist.
  - +Y: handle axis, exiting on the thumb side.
  - +Z: knuckle direction.
  - +X: out of the palm.
- `wrapHand(ch, side, radiusMeters, {base, thumb})`: closes a hand around any cylinder radius.

**Other**
- Tap handler registered at priority 50; it returns false when no prop is hit.
- An Android back handler is pushed only while a prop is being edited.
- The gizmo is a 2D canvas, `canvas.pv-pr-gizmo`, inside `shell.overlay`. It is never exported in PNG captures.

### ui / io (shell, personaggi, scene, export)

KIT (ui/kit.js). Unchanged: h, section, row, slider, toggle, segmented, button, swatches, cardGrid, chips, icon, plus:
- toast(message, ms=2200 | {ms, kind: 'ok'|'error'|'warning'|'info', icon, action: {label, onClick}}) -> element
- haptic(ms | 'tick'|'light'|'medium'|'heavy'|'success'|'warning'|'error') — respects the Vibrazione setting
New:
- setHapticsEnabled(bool), hapticsEnabled()
- iconButton({icon, title, onClick, variant, active, size}) -> button with .setActive / .setDisabled / .setIcon
- modal({title, subtitle, icon, body, actions: [{label, value, variant, icon, onClick -> false keeps it open}], kind: 'dialog'|'sheet', dismissable, className, onClose}) -> {el, card, body, close(v), result: Promise}
- confirmDialog(text, {title, okLabel, cancelLabel, danger, icon}) -> Promise<boolean>
- promptDialog(label, value, {title, okLabel, placeholder, maxLength}) -> Promise<string|null>
- sheetMenu(items: [{id, label, icon, hint, danger, disabled, checked, onClick} | {separator} | {header}], {title, anchor}) -> Promise<id|null>
- hasOpenLayer(), closeTopLayer() — dialogs and menus close first on Android back
Button variant 'danger-solid' added. New icons: filePlus, file, fileCode, upload, edit, female, male, sparkle, help, vibrate, globe, gauge, bookOpen, checkCircle, warning, clock, tap, pinch, orbit, library, heart, arrowLeft, crop, transparent, storage, user, userPlus, swap.

SHELL (ui/shell.js). Same constructor and same members (registerTool, openTool, closePanel, activeToolId, hint, overlay, topLeft, topRight, panel, panelBody, toolbar, canvasHost, TOOL_GROUPS). Shell now extends EventTarget. Added:
- shell.mode: 'sheet' | 'side'
- shell.panelOpen
- shell.sheetSnap, shell.setSheetSnap('peek'|'half'|'full'), shell.snapHeights()
- shell.getViewInsets() -> {top, right, bottom, left}: CSS px of the canvas covered by opaque UI
- shell.safeInsets() -> px
- shell 'layout' event {live, insets}; app event 'uilayout' {insets, live}
- CSS vars on <html>: --cover-top/right/bottom/left, --pv-free-cx
- openTool now catches exceptions thrown by a tool's build/onShow and logs them.

UI MODULE (app.modules.ui):
- scenes (SceneManager): list(), get(id), save({name, asNew}), open(id), load(json, {id, name, clean}), newScene(), rename, duplicate, remove, removeAll, exportText(), parseFile(text, name), dirty, current {id, name}, flushAutosave(); fires 'change' and 'autosave-error'
- exporter: capture({scale, width, height, transparent}) -> canvas, thumbnail(), crop(canvas, rect), saveImage(canvas, name), shareImage(canvas, name), saveText(text, name, mime), pickTextFile()
- viewOffset: cur {s, ox, oy}, active, suspend(), resume(), without(fn), setEnabled(b), holdSelection(ms), refreshAfter(ms)
- settings: get/set of haptics, tips, quality, tipsSeen, exportScale/Transparent/Crop; fires 'change'
- thumbs: get/peek(presetId, {w, h, region: 'full'|'bust', color}) -> data-URL body-shape thumbnails
- people: open({add}), add(presetId), frame(ch, {commit}), toggleHidden, rename, duplicate, remove, freeSpot(), MAX 8
- openPeople({add}), addCharacter(presetId), saveScene(), newScene(), openScenes(), openExport({share}), exportSceneFile(), importSceneFile(), openSettings(), openInfo(), showOnboarding(), tip(groupId)

PERSISTENCE AND URL FLAGS:
- Per-character state: ch.data.ui.hidden (character is hidden = ch.root.visible false; a 'visibility' event is dispatched on change).
- localStorage keys: posaviva.scenes, posaviva.autosave, posaviva.settings, posaviva.onboarded ('1'), posaviva.ui.sheet.
- URL flag ?tour=1 forces the onboarding and tips, which are otherwise skipped when navigator.webdriver is true.
- Renaming a character dispatches app 'characters'.

### pose (posa interattiva, IK, mani)

app.posing (set in create()):
- controls: ControlSet — list[], get(id), forBone(boneIndex), fingerId(finger 1..5, seg 0..3, side). Control ids (= app.selection.part values): 'pelvis','abdomen','chest','neck','head'; per side '.L'/'.R': 'shoulder','arm','forearm','hand','thigh','shin','foot','toes'; fingers 'f{n}{j}.S' with n 1..5 (1 = thumb) and j 0..3 (0 = metacarpal, not for the thumb; 1 = base, 2 = media, 3 = punta), e.g. 'f21.R' = right index finger base. Each control: {id, label (Italian), side, pivot, own[], axes:[{key, label, min, max (radians, anatomical/display space), extra, hinge, drives}], mirrorId}.
- rig: PoseRig — read(ch, ctrl, k) / readDisplay / write(ch, ctrl, k, rad, clamp=true) -> shared {value, clamped} / limitsOf / offset / euler / setEuler / snapshot / project / rotateWorld / setWorldQuat / axisWorld / worldPos / worldQuat / pointOnBone / refreshBone / refreshControl / resetControl / mirrorControl. Call ch.applyPose() after writes.
- ik: IKSolver — solveLimb(ch, chains['hand.L'|'hand.R'|'foot.L'|'foot.R'], targetWorld, endQuat?), aimHead(ch, target, snapNeck, snapHead), movePelvis(ch, rigOffset, pins), pin(ch, side), solvePinned(ch, pin), effectorPoint(ch, id).
- state (getter copy: {mode:'rotate'|'ik'|'move', limits, pinFeet, showJoints}); setMode(m); setPref(key, value).
- selectPart(ch, id); getAngle(ch, id, axisKey) -> degrees (display/anatomical space); setAngle(ch, id, axisKey, deg, commit=false); pick(ndc) -> {character, point, bone, control} | null.
- Operations: resetPart(ch, ctrl), mirrorPart(ch, ctrl), mirrorPose(ch), resetPose(ch), copyPose(src, dst), dropToGround(ch) — each applies the pose and records an undo step.
- gizmo: read-only overlay state (screen positions of rings, effectors, dots, ground ring), useful for tests.
Events dispatched: {type:'placement'} on the Character and {type:'placement', character} on app while a character is moved or turned in Sposta mode; one 'pose' event on the character when a placement drag ends.
Module exports: controls.js {ControlSet, AXIS_COLORS, FINGER_NAMES, toDeg, toRad}; rig.js {PoseRig}; ik.js {IKSolver}; picking.js {Picker}; highlight.js {Highlight}; thumbs.js {ThumbRenderer, getThumbRenderer(app) -> render(preset, sex), renderHand(preset, sex), cached(), persist()}; gizmo.js {PoseGizmo, wrapAngle}.
Tools registered: 'pose' (group pose, order 10), 'poselib' (order 15), 'hands' (order 20). Tap handler priority 10. Android back handler: deselects the part while a posing tool is active.
localStorage keys: 'posaviva.pose.prefs', 'posaviva.pose.thumbs.v1'.

### pose/library.js (pose e mani pronte)

Exports of web/src/pose/library.js (the existing contract is unchanged, plus new extras):
- POSE_CATEGORIES: [{id, label}] with ids stand, action, fight, sit, floor, gesture (In piedi, Azione, Combattimento, Seduti, A terra, Gesti).
- POSE_PRESETS: [{id, label, category, pose:{bones:{name:[x,y,z,w]}, root:[x,y,z]}, ground:boolean, air?:number, touch?:{L|R:[vertex, standoff]}}]. There are 48 entries. 'air' is meters above the floor after the drop (jump 0.35, jump_arms_up 0.4, fall 0.5). 'touch' holds the hand-on-body points described below.
- HAND_PRESETS: [{id, label, bones:{'finger1-1':[x,y,z,w], ...}}], left hand, bone names without side suffix. There are 22 entries, and each one sets all 19 finger and metacarpal bones. Ids: relaxed, open, spread, half, fist, wave, karate, claw, point, peace, thumbs_up, ok, horns, finger_gun, count1, count2, count3, grip, pinch, hold, cup, phone.
- PRESERVED_BONES: ['eye.L','eye.R'].
- HAND_BONES: the 19 hand bone names without suffix.
- HIP_REF = 0.872: the f_normal root height used to scale root offsets.
- applyPosePreset(ch, id, {mirror=false, keepHands=false}) -> boolean. Fires exactly one 'pose' event. It does not record undo: the caller calls app.commit.
  1. Resets every bone except the eyes (and, with keepHands, except the fingers), sets the pose and scales the root offset.
  2. Moves the hands back onto their recorded body points.
  3. Drops the body to the floor unless ground is false, then adds 'air'.
- applyPoseObject(ch, pose, {ground=true, air=0, mirror=false, keepHands=false, touch=null}): applies any pose in the contract format with the same logic, e.g. for user-saved poses.
- applyHandPreset(ch, id, side='L'|'R'|'both', amount=1): blends from the open rest hand to the preset (0..1), then calls ch.applyPose().
- mirrorPose(pose): swaps .L and .R, maps (x,y,z,w) to (x,-y,-z,w) and negates root x.
- getPosePreset(id), getHandPreset(id).
- compilePoseDef(def): turns one entry written in the poses.js format into {bones, root}.
- measureTouch(ch, side, boneRegex?) -> [vertex, distance, bone]: finds the nearest body point to a hand, used to fill in 'touch' data.
No app.* methods and no events are added.

### face (viso, occhi, sguardo)

Module entry: web/src/face/index.js exports create(app, shell) (hooks onCharacterAdded, onCharacterRemoved, deserializeCharacter), DEFAULT_FACE, DEFAULT_HAIR, faceState(ch) (fills ch.data.face defaults).

app.face (FaceController, added at runtime):
- state(ch?) -> ch.data.face = {preset, intensity, fine:{id:v}, mirror, gaze:[gx,gy], lookAtCamera, lookAt:[x,y,z]|null, brows, lashes}
- setPreset(ch, id, commit=true); setIntensity(ch, v, commit); setFine(ch, id, v, commit); resetFine(ch); toggleMirror(ch); resetExpression(ch); applyExpression(ch, now); flushExpression(ch)
- setGaze(ch, gx, gy, commit) (gx>0 = character's left, gy>0 = up, both -1..1); commitGaze(ch); setLookAtCamera(ch, bool); setLookAtPoint(ch, Vector3|[x,y,z]|null)
- setBrows(ch, 'thin'|'natural'|'thick'|'arched'|'straight'|'none'); setLashes(ch, bool)
- rigs (Map ch -> FaceRig with .lashes.mesh / .brows.mesh), eyeTexture (shared CanvasTexture)
App event: 'facechange' {character, what: 'expression'|'gaze'|'brows'|'lashes'}.

Reusable exports:
- expressions.js: PRESETS, PRESET_BY_ID, FINE_GROUPS, FINE_BY_ID, composeExpression(st), mirrorUnit(u), isAsymmetric(id), sameWeights(a,b)
- brows.js: BROW_STYLES, BROW_BY_ID
- gaze.js: gazeQuat(yaw,pitch), aimHeadLocal(ch,T), freeTarget(ch,gx,gy), headWorldMatrix(ch), worldToHead(ch,p), eyesWorld(ch), currentPad(ch), YAW_MAX, PITCH_MAX
- faceIcons.js: faceIconSVG(id), faceIconURL(id)
- eyeTexture.js: createEyeTexture(centers,size), rng(seed), IRIS_UV, PUPIL_UV
- landmarks.js: faceLandmarks(model,ch) (eyelash guide grids, brow triangles, eye UV centres), boneRestPos(ch,name)

Meshes added per character through ch.addAttachment: 'face:lashes' (kind 'lashes') and 'face:brows' (kind 'hair', vertexColors). Both have userData.faceModule set and userData.pickable = false, and cast no shadows.

Hair colour: brows and lashes follow ch.appearance.hair; the hair module only needs ch.setAppearance({hair: '#rrggbb'}).

Eye bones eye.L / eye.R are owned by this module; the pose module already preserves them in its presets.

### clothing (vestiti e pieghe)

Module object (returned by create(app, shell)) and the same API on `app.clothing`:
- `wear(ch, id, patch?)`: wears garment `id`, replacing what is in its slot. A dress removes top and bottom, and the reverse. `patch` = `{color, fit, wrinkles}`. Returns the item.
- `takeOff(ch, id)`, `update(ch, id, {color?, fit? 0..1, wrinkles? 0..2})`.
- `setItems(ch, items | ids)` replaces the whole outfit; `items(ch)` returns a copy.
- `setIntensity(k)` sets the global "Pieghe" 0..2; `intensity` (getter).
- `whenIdle()` resolves when no garment build is pending (used by tests, and useful before thumbnails or exports).
- `catalog`: `{GARMENTS, CATEGORIES, STYLES, OUTFITS}`. Garment ids: tshirt, tank, longsleeve, sweatshirt, trackjacket, shirt, blazer, sporttop (women only), jeans, trousers, sweatpants, cargo, shorts, leggings, miniskirt, pencilskirt, flaredskirt, dress, sneakers, dressshoes, boots, socks, underwear.
- `manager` (`ClothingManager`, a three.js EventDispatcher). Events: `'change'` `{character}` after any outfit change; `'built'` `{character}` when its build queue drains; `'intensity'`.
- Hooks: `onCharacterAdded`, `onCharacterRemoved`, `deserializeCharacter` (cheap when nothing changed), `serializeScene()` → `{wrinkles}`, `deserializeScene`.

Per-character state: `ch.data.clothing = {items: [{id, color, fit, wrinkles}]}`.

Garment meshes are attachments named `'garment:<id>'`, with `userData.clothing = true` and `userData.garment = id`. Materials use kind `'cloth'`; groups are main fabric, trim/rib and hardware/sole (kind `'prop'`). The module owns `ch.setHiddenBodyFaces`, and other modules should not call it on scene characters.

### hair (capelli e barba)

Module entry: hair/index.js exports create(app, shell). Module hooks: onCharacterAdded(ch) assigns default state if missing; onCharacterRemoved(ch); deserializeCharacter(ch) is idempotent and cheap. There is no scene-level state, so no serializeScene/deserializeScene.

app.hair = {
  rigs: Map<Character, HairRig>,
  styles: STYLES  // [{id, label, part, length, volume, bangs?, material?}]
                  // ids: nessuno rasato corti_classici corti_spettinati undercut pompadour caschetto lunghi_lisci lunghi_mossi ricci afro coda chignon treccia codini cresta raccolti
  beards: BEARDS  // [{id, label}], ids: nessuna corta piena pizzetto baffi
  getState(ch)    // returns a copy of ch.data.hair
  setStyle(ch, patch, commit = 'capelli')  // patch: any of {style, color, length 0..1, volume 0..1, parting 'left'|'center'|'right', bangs, beard}
                                           // normalizes the state, applies color and appearance; commit=false skips the undo step
}

App event 'hairchange' {character} fires on every hair edit.

Per-character state: ch.data.hair = {style, color '#rrggbb', length, volume, parting, bangs, beard}. The hair color is mirrored into ch.appearance.hair (the face module already reads it for brows and lashes).

Meshes are character attachments: 'hair' (SkinnedMesh; cap uses skin weights, clumps are rigid on the head bone) and 'beard' (SkinnedMesh with skin weights). Both have userData.pickable = false and userData.hairModule = true, cast and receive shadows, and use materials.apply with kind 'hair' (the stubble beard uses a transparent spec).

Listens to app.clothing.manager 'built' {character} so long hair drapes over rebuilt outfits. Garments are found as character attachments whose material kind is 'cloth'.

### Core additions (integration)
- `ch.setPlacement({position, rotationY})` fires `placement`; the pose module also dispatches `placement` on the character and on `app` while dragging.
- `ch.setGroundClearance(m)` raises the body (shoe soles; set by clothing). `ch.dropToGround()` drops onto the character's own placement height + clearance.
- `ch.bodySpecOverrides[groupIndex] = spec` overrides body draw-group materials (the face module hides the helper eyelashes, group 1).
- `ch.setBoneRotationSilent(name, quat)` updates a bone without a `pose` event (gaze).
- `model.addExpressionUnit(name, sparse)`; unknown expression units are ignored when loading.
- `deserializeScene(obj, {fromHistory})`; `app.history.restoring`.
- Module hook `provideInitialScene()` (io restores the autosave before the default character is created).
- `app.renderNow()` falls back to a plain render if `app.renderOverride` throws.
