import type { FeatureInput } from "./schema/feature";

/**
 * Neutral debris shared by every map and faction. Maps scatter these in debris fields
 * (`MapDef.debris`); from M5 destroyed units leave wrecks as well.
 */
export const RAW_FEATURES: readonly FeatureInput[] = [
  {
    id: "car_wreck",
    name: "Car Wreck",
    description: "A burned-out sedan. Mostly rust, but the engine block is worth stripping.",
    salvage: 30,
    radius: 2.5,
    visual: { size: [2.2, 1.4, 4.5], color: "#6e4a32" },
  },
  {
    id: "scrap_heap",
    name: "Scrap Heap",
    description: "A mound of girders, sheet metal and pipe left where a building fell.",
    salvage: 80,
    radius: 4,
    visual: { size: [6, 2.5, 5], color: "#7a6a58" },
  },
  {
    id: "derelict_tank",
    name: "Derelict Tank",
    description: "A pre-war battle tank, abandoned with a thrown track. Heavy armour plate.",
    salvage: 220,
    radius: 4.5,
    visual: { size: [5, 3, 8], color: "#4f5640" },
  },
];
