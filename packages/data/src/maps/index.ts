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
    deposits: [
      { x: 0.5, z: 0.5 },
      { x: 0.5, z: 0.28 },
      { x: 0.5, z: 0.72 },
      { x: 0.28, z: 0.5 },
      { x: 0.72, z: 0.5 },
    ],
    debris: [
      { x: 0.5, z: 0.5, radius: 90, count: 10, feature: "scrap_heap" },
      { x: 0.35, z: 0.35, radius: 60, count: 8, feature: "car_wreck" },
      { x: 0.65, z: 0.65, radius: 60, count: 8, feature: "car_wreck" },
      { x: 0.65, z: 0.35, radius: 50, count: 3, feature: "derelict_tank" },
      { x: 0.35, z: 0.65, radius: 50, count: 3, feature: "derelict_tank" },
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
    deposits: [
      { x: 0.32, z: 0.32 },
      { x: 0.68, z: 0.32 },
      { x: 0.32, z: 0.68 },
      { x: 0.68, z: 0.68 },
      { x: 0.5, z: 0.5 },
    ],
    debris: [
      { x: 0.5, z: 0.5, radius: 120, count: 14, feature: "car_wreck" },
      { x: 0.32, z: 0.5, radius: 40, count: 4, feature: "derelict_tank" },
      { x: 0.68, z: 0.5, radius: 40, count: 4, feature: "derelict_tank" },
      { x: 0.5, z: 0.32, radius: 60, count: 6, feature: "scrap_heap" },
      { x: 0.5, z: 0.68, radius: 60, count: 6, feature: "scrap_heap" },
    ],
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
    startDeposits: 3,
    deposits: [
      { x: 0.5, z: 0.5 },
      { x: 0.3, z: 0.3 },
      { x: 0.7, z: 0.7 },
    ],
    debris: [
      { x: 0.5, z: 0.5, radius: 70, count: 12, feature: "scrap_heap" },
      { x: 0.3, z: 0.3, radius: 40, count: 6, feature: "car_wreck" },
      { x: 0.7, z: 0.7, radius: 40, count: 6, feature: "car_wreck" },
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
