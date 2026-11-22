// Zod schema of the command plan (plan.js): the structured output format of the
// cloud mode (client.messages.parse + zodOutputFormat). Built from the runtime
// catalogs so small id sets are enums (garments, poses, expressions, species,
// rooms, landscapes, lights, angles). Prop types stay free strings (hundreds of
// ids): the executor resolves them, or the `query` words, against the catalog.
// Loaded only in cloud mode (and by the Node tests): zod is not in the boot path.
import * as z from 'zod/v4';
import { RELATIONS, TARGET_KINDS, BODY_TYPES, FRAMINGS } from './plan.js';

const ids = (list, fallback) => {
  const a = [...new Set((list || []).map((x) => (typeof x === 'string' ? x : x.id)).filter(Boolean))];
  return a.length ? z.enum(a) : fallback;
};

export function makePlanSchema(cat = {}) {
  const Garment = ids(cat.garments, z.string());
  const Pose = ids([...(cat.poses || []), ...new Set((cat.animals || []).flatMap((a) => (a.poses || []).map((p) => p.id)))], z.string());
  const HumanPose = ids(cat.poses, z.string());
  const Expr = ids(cat.expressions, z.string());
  const Species = ids(cat.animals, z.string());
  const Room = ids(cat.rooms, z.string());
  const Light = ids(cat.lights, z.string());
  const Angle = ids(cat.angles, z.string());
  const HairStyle = ids(cat.hairStyles, z.string());
  const Beard = ids(cat.beards, z.string());
  const Landscape = ids((cat.landscapes || []).filter((l) => l.group !== 'stanze'), z.string());
  const Hex = z.string().describe('colore esadecimale #rrggbb');

  const Target = z.object({
    kind: z.enum(TARGET_KINDS).describe("'new' = creato da un'azione di questo piano (index); character/animal/prop = cosa della scena (id dal riepilogo, oppure type/query); it = l'ultimo soggetto nominato; camera = verso chi guarda"),
    index: z.number().int().optional().describe("solo per kind 'new': indice (da 0) dell'azione che l'ha creato"),
    id: z.string().optional().describe('id della scena (dal riepilogo)'),
    type: z.string().optional().describe('F|M per personaggi, id specie, id tipo oggetto'),
    query: z.string().optional().describe('parola italiana, es. "tavolo"'),
    name: z.string().optional(),
    ordinal: z.number().int().optional().describe('1 = primo, -1 = ultimo'),
    all: z.boolean().optional().describe('tutti quelli che corrispondono'),
  });
  const Place = z.object({
    relation: z.enum(RELATIONS).describe('left/right = sinistra/destra di chi guarda; front/behind = davanti/dietro rispetto al bersaglio; seat = seduto su; on = sopra; hand = in mano; corner/wall/center = nella stanza'),
    target: Target.optional(),
    target2: Target.optional().describe('secondo bersaglio per between'),
    side: z.enum(['left', 'right']).optional().describe('lato per corner'),
  });
  const Outfit = z.array(z.object({ garment: Garment, color: Hex.optional() }));
  const Hair = z.object({ style: HairStyle.optional(), color: Hex.optional(), beard: Beard.optional() });
  const common = {
    place: Place.optional(), rotateTowards: Target.optional(), lookAt: Target.optional(),
    turnAway: z.boolean().optional().describe('di spalle alla camera'), size: z.number().optional().describe('scala 0.3..3'),
  };

  const AddCharacter = z.object({
    type: z.literal('addCharacter'), sex: z.enum(['F', 'M']), bodyType: z.enum(BODY_TYPES).optional(), name: z.string().optional(),
    count: z.number().int().optional(), outfit: Outfit.optional(), outfitSet: z.enum(['formal', 'sport', 'street', 'casual', 'dress', 'police', 'army', 'work']).optional(),
    undress: z.enum(['all', 'shoes', 'top']).optional(), hair: Hair.optional(), pose: HumanPose.optional(), expression: Expr.optional(),
    mutual: z.boolean().optional().describe('con count 2: uno di fronte all\'altro'), arrange: z.enum(['row']).optional(), ...common,
  });
  const AddAnimal = z.object({ type: z.literal('addAnimal'), species: Species, count: z.number().int().optional(), pose: z.string().optional().describe('id posa animale'), color: Hex.optional().describe('colore del mantello (si sceglie la variante più vicina)'), arrange: z.enum(['row']).optional(), ...common });
  const AddProp = z.object({
    type: z.literal('addProp'), propType: z.string().optional().describe('id del catalogo oggetti'), query: z.string().optional().describe('nome italiano se non conosci l\'id'),
    count: z.number().int().optional(), color: Hex.optional(), arrange: z.enum(['row']).optional(), kit: z.string().optional(), ...common,
  });
  const AddRoom = z.object({ type: z.literal('addRoom'), preset: Room });
  const LandscapeA = z.object({
    type: z.literal('landscape'),
    spec: z.object({
      preset: Landscape.optional(), place: z.string().optional().describe('descrizione libera in italiano'),
      time: z.enum(['alba', 'mattino', 'mezzogiorno', 'tramonto', 'sera', 'notte']).optional(),
      weather: z.enum(['sereno', 'nuvoloso', 'pioggia', 'neve', 'nebbia']).optional(),
      season: z.enum(['primavera', 'estate', 'autunno', 'inverno']).optional(),
      features: z.array(z.string()).optional(), atmosphereOnly: z.boolean().optional().describe('cambia solo ora/meteo del paesaggio esistente'),
    }),
  });
  const Modify = z.object({
    type: z.literal('modify'), target: Target, pose: Pose.optional(), outfit: Outfit.optional(), undress: z.enum(['all', 'shoes', 'top']).optional(),
    color: Hex.optional(), expression: Expr.optional(), hair: Hair.optional(), turn: z.number().optional().describe('gradi'), ...common,
  });
  const Camera = z.object({ type: z.literal('camera'), angle: Angle.optional(), focal: z.number().optional().describe('mm'), framing: z.enum(FRAMINGS).optional(), target: Target.optional() });
  const Lights = z.object({ type: z.literal('lights'), preset: Light.optional(), time: z.string().optional() });
  const Remove = z.object({ type: z.literal('remove'), target: Target });

  return z.object({
    actions: z.array(z.discriminatedUnion('type', [AddCharacter, AddAnimal, AddProp, AddRoom, LandscapeA, Modify, Camera, Lights, Remove])),
    unknown: z.array(z.string()).describe('parti del comando che non sai eseguire, in italiano'),
  });
}
