# Comandi vocali e scritti (voice)

Describe a scene in Italian, by voice or text, and PosaViva builds it:
"metti un uomo con una maglietta bianca seduto sul divano con un cane accanto",
"voglio una cucina, metti il tavolo al centro e due sedie a sinistra",
"crea una strada di città di notte con pioggia", "gira la donna verso la finestra",
"inquadra dal basso".

## How the user reaches it

1. Mic button at the bottom-left of the 3D view (the quick zoom button is at the
   bottom-right). It opens the **Comandi** panel and starts listening.
2. Speak (live transcript, level ring around the mic), or type in the text field and
   press the arrow. Chips **Prova** run examples; **Recenti** lists past commands.
3. The panel shows what was done, "Non ho capito: …" for the parts it could not map,
   and which engine understood it ("Capito offline" / "Capito con Claude").
   **Annulla** undoes the whole command (one undo step).
4. ⚙ (or the mode badge) opens **Comandi vocali**: Lingua (Italiano), Modalità
   (Solo offline / Ibrida), Chiave API Claude (stored only on this device).

## Files

```
index.js     module entry: VoiceUI, lazy engine, app.voice API, idle warm-up
ui.js        mic FAB, Comandi panel, result + Annulla, chips, history, settings sheet
speech.js    Speech: Android bridge (SpeechRecognizer) / webkitSpeechRecognition / none
settings.js  localStorage: posaviva.voice {lang, mode, apiKey}, posaviva.voice.history
engine.js    createEngine(app): catalogs -> lexicon, parseOffline, understand (hybrid), run
lexicon.js   Italian normalization, tokenizer, stemmer, typo distance, numbers, closed word classes
vocab.js     collectCatalogs(app) (runtime catalogs) + buildLexicon (synonyms + catalog labels, prop index)
parser.js    offline parser: tags -> clauses -> noun phrases + relations + references -> plan
plan.js      plan format + normalizePlan (validation against the catalogs)
schema.js    zod schema of the plan (structured output of the cloud mode)
cloud.js     Claude via @anthropic-ai/sdk (messages.parse + zodOutputFormat), fallbacks
executor.js  plan -> module APIs, one undo step, Italian summary
spatial.js   spatial solver: footprints, occupancy, rooms, seats, top surfaces, free spots
test/cloud.test.mjs   Node unit test of the cloud path with a mocked client
```

Only `index.js`, `ui.js`, `speech.js`, `settings.js` and `voice.css` load at start-up
(~19 KB). The engine (~120 KB) is built in idle time a few seconds after start-up;
the cloud chunk and the Anthropic SDK (~480 KB) load only in hybrid mode.

## Plan (common output of both parsers)

`{actions: Action[], unknown: string[]}` — see `plan.js` for every field.
Actions: `addCharacter {sex, bodyType, name, count, outfit:[{garment, color}], outfitSet,
undress, hair:{style, color, beard}, pose, expression, place, rotateTowards, lookAt}`,
`addAnimal {species, count, pose, place}`, `addProp {propType | query, count, color, place}`,
`addRoom {preset}`, `landscape {spec: {preset, place, time, weather, season, features}}`,
`modify {target, pose, outfit, color, expression, hair, rotateTowards, turn, place, lookAt}`,
`camera {angle, focal, framing, target}`, `lights {preset, time}`, `remove {target}`.
Place = `{relation, target, target2, side}` with relations `left right front behind beside
near on under center corner wall between around seat hand floor in row facing`.
Target = `{kind: new|character|animal|prop|it|selected|camera|room|window|door|all, index, id,
type, query, name, ordinal, all}`.

## Conventions of the solver

- LEFT / RIGHT are the viewer's (screen); FRONT / BEHIND follow the target's own front.
- "seduto sul divano": seat surface measured by rays (height, backrest, slots); the
  pose library fits the hips to it (`applyPosePreset(ch, id, {seat})`), then the
  hips are moved onto the slot. Sofas use "Sedia rilassata", high seats "Sgabello alto".
- "sul letto" (animals / objects): mattress top (pillows skipped); people lying on a
  bed are turned with the head toward the headboard.
- Overlaps: oriented footprints; big props (L kitchens, desk rows) use real occupied
  cells (rays on a 0.2 m grid, cached). Inside a room everything is clamped to the walls.
- A moved table takes along what stands on it, the lamp above it and the chairs around it.
- New things out of view: the camera frames them (animated, not committed separately).
- One undo step: the modules' own commits are held during the command
  (`app.history.push` is shadowed while it runs), then `app.commit('comando vocale')`.

## Tests

- `node src/voice/test/cloud.test.mjs` (from `posaviva/web`): cloud request shape,
  refusal / network / auth / rate-limit / invalid output fallbacks, no request without a
  key, catalog ids enforced, offline plans validate against the zod schema.
- In-app battery (Playwright, full app, 412x915 touch, offline parser + executor): 57
  Italian commands from simple to complex, with typos and colloquialisms, each on a fresh
  scene with assertions on the result (counts, types, colours, seated / on top / inside,
  facing angles, screen-left / right, room corners and walls, camera height / focal,
  light preset, landscape spec, one undo step): 57/57 passing, 0 console errors.
- E2E (`tools/e2e.cjs` + voice steps: open, run, Annulla, cloud path with a mocked client
  — success / refusal / network error / no key —, settings, close): 0 console errors.
