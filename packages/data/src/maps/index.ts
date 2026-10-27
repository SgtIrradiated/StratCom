import { assert } from "@stratcom/shared";
import { MapDef, type MapInput } from "../schema/map";

/** Skirmish maps, in display order. */
const RAW_MAPS: readonly MapInput[] = [
  {
    id: "ashfall_basin",
    name: "Ashfall Basin",
    description:
      "A wide crater floor ringed by ash dunes. Open ground favours large armies and fast raids.",
    cells: 256,
    cellSize: 8,
    terrain: { seed: 1, amplitude: 70, wavelength: 520 },
    startPositions: [
      { x: 0.18, z: 0.2 },
      { x: 0.82, z: 0.8 },
      { x: 0.82, z: 0.2 },
      { x: 0.18, z: 0.8 },
    ],
  },
  {
    id: "rustbelt_ridge",
    name: "Rustbelt Ridge",
    description:
      "Broken highlands around a collapsed rail line. Steep ridges funnel armies into passes.",
    cells: 256,
    cellSize: 8,
    terrain: { seed: 77, amplitude: 150, wavelength: 420 },
    startPositions: [
      { x: 0.15, z: 0.5 },
      { x: 0.85, z: 0.5 },
      { x: 0.5, z: 0.15 },
      { x: 0.5, z: 0.85 },
    ],
    plateauRadius: 90,
  },
  {
    id: "glassed_flats",
    name: "Glassed Flats",
    description:
      "A small, nearly level salt pan fused to glass by an old blast. Short distances, short games.",
    cells: 160,
    cellSize: 8,
    terrain: { seed: 4242, amplitude: 28, wavelength: 300 },
    startPositions: [
      { x: 0.22, z: 0.78 },
      { x: 0.78, z: 0.22 },
    ],
  },
];

/** Parses map definitions. Throws a descriptive error on bad data or duplicate ids. */
export function validateMaps(raw: readonly unknown[]): readonly MapDef[] {
  const maps = raw.map((m, i) => {
    const result = MapDef.safeParse(m);
    if (!result.success) throw new Error(`Invalid map at index ${i}:\n${result.error.message}`);
    return result.data;
  });
  const ids = new Set<string>();
  for (const m of maps) {
    assert(!ids.has(m.id), `Duplicate map id "${m.id}"`);
    ids.add(m.id);
  }
  return maps;
}

/** Validated map registry, in display order. */
export const MAPS: readonly MapDef[] = validateMaps(RAW_MAPS);

/** Looks up a map by id. Throws if the id is unknown. */
export function getMap(id: string): MapDef {
  const map = MAPS.find((m) => m.id === id);
  assert(map, `Unknown map "${id}"`);
  return map;
}
