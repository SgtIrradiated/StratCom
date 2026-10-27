import { describe, expect, it } from "vitest";
import { CONTENT_PACKS, type ContentPack } from "./factions/index";
import { RAW_FEATURES } from "./features";
import { RAW_MOVEMENT_CLASSES } from "./movement";
import { RULESET } from "./index";
import {
  RulesetError,
  compileRuleset,
  rulesetFaction,
  rulesetFeature,
  rulesetUnit,
} from "./ruleset";

const compile = (packs: readonly ContentPack[]) =>
  compileRuleset({ movementClasses: RAW_MOVEMENT_CLASSES, features: RAW_FEATURES, packs });

/** Deep-copies the shipped packs so tests can break them. */
const clonePacks = (): ContentPack[] => JSON.parse(JSON.stringify(CONTENT_PACKS)) as ContentPack[];

const problemsOf = (fn: () => unknown): readonly string[] => {
  try {
    fn();
  } catch (err) {
    if (err instanceof RulesetError) return err.problems;
    throw err;
  }
  throw new Error("expected a RulesetError");
};

describe("built-in ruleset", () => {
  it("gives each faction a mobile commander and a roster of at least 6 units", () => {
    for (const f of RULESET.factions) {
      const commander = RULESET.units[f.commanderUnit]!;
      expect(commander.role).toBe("commander");
      expect(commander.mobile).toBe(true);
      expect(commander.faction).toBe(f.index);
      expect(f.roster.length).toBeGreaterThanOrEqual(6);
      const roles = new Set(f.roster.map((u) => RULESET.units[u]!.role));
      for (const role of ["commander", "engineer", "economy", "factory", "land"]) {
        expect(roles, `${f.id} lacks a ${role}`).toContain(role);
      }
    }
  });

  it("uses dense numeric ids that match array positions", () => {
    RULESET.units.forEach((u, i) => {
      expect(u.index).toBe(i);
    });
    RULESET.weapons.forEach((w, i) => {
      expect(w.index).toBe(i);
    });
    RULESET.factions.forEach((f, i) => {
      expect(f.index).toBe(i);
    });
  });

  it("models structures as immobile and mobile units with a movement class", () => {
    for (const u of RULESET.units) {
      if (u.mobile) {
        expect(u.movementClass).toBeGreaterThanOrEqual(0);
        expect(u.speed).toBeGreaterThan(0);
      } else {
        expect(u.movementClass).toBe(-1);
        expect(u.footprint.x * u.footprint.z).toBeGreaterThan(0);
      }
    }
  });

  it("has a stable hash and is plain data (it crosses the worker boundary)", () => {
    expect(compile(CONTENT_PACKS).hash).toBe(RULESET.hash);
    expect(compile(clonePacks()).hash).toBe(RULESET.hash);
    expect(JSON.parse(JSON.stringify(RULESET))).toEqual(RULESET);
  });

  it("changes hash when any stat changes", () => {
    const packs = clonePacks();
    (packs[1]!.units[5] as { health: number }).health += 1;
    expect(compile(packs).hash).not.toBe(RULESET.hash);
  });

  it("gives every builder a build rate and every faction an extractor and a generator", () => {
    for (const u of RULESET.units) {
      if (u.builds.length > 0) expect(u.buildRate, u.id).toBeGreaterThan(0);
    }
    for (const f of RULESET.factions) {
      const roster = f.roster.map((i) => RULESET.units[i]!);
      expect(roster.some((u) => u.placement === "deposit" && u.economy.salvagePerSec > 0)).toBe(
        true,
      );
      expect(roster.some((u) => !u.mobile && u.economy.powerPerSec > 0)).toBe(true);
      // Starting stores fit in the commander's storage, so none is lost on the first tick.
      const commander = RULESET.units[f.commanderUnit]!;
      expect(f.startingResources.salvage).toBeLessThanOrEqual(commander.economy.storageSalvage);
      expect(f.startingResources.power).toBeLessThanOrEqual(commander.economy.storagePower);
    }
    expect(rulesetFaction(RULESET, "scrapborn").reclaimMultiplier).toBeGreaterThan(1);
  });

  it("looks up units, features and factions by id", () => {
    expect(rulesetFeature(RULESET, "scrap_heap").salvage).toBeGreaterThan(0);
    expect(rulesetUnit(RULESET, "scr_buggy").name).toBe("Rust Buggy");
    expect(rulesetFaction(RULESET, "directorate").id).toBe("directorate");
    expect(() => rulesetUnit(RULESET, "nope")).toThrow(/Unknown unit/);
  });
});

describe("compileRuleset validation", () => {
  it("reports every broken reference at once", () => {
    const packs = clonePacks();
    const dir = packs[0]!;
    (dir.units[0] as { weapons: string[] }).weapons = ["no_such_gun"];
    (dir.units[1] as { builds: string[] }).builds = ["scr_drill"];
    (dir.faction as { commanderUnit: string }).commanderUnit = "dir_works";
    const problems = problemsOf(() => compile(packs));
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/unknown weapon "no_such_gun"/),
        expect.stringMatching(/builds "scr_drill" from another faction/),
        expect.stringMatching(/commander "dir_works" cannot move/),
        expect.stringMatching(/does not have the commander role/),
      ]),
    );
  });

  it("rejects duplicate ids across packs", () => {
    const packs = clonePacks();
    (packs[1]!.weapons[0] as { id: string }).id = "dir_arc_projector";
    expect(problemsOf(() => compile(packs))).toEqual(
      expect.arrayContaining([expect.stringMatching(/duplicate weapon id "dir_arc_projector"/)]),
    );
  });

  it("rejects schema violations with the offending path", () => {
    const packs = clonePacks();
    (packs[0]!.units[2] as { footprint?: unknown }).footprint = undefined;
    (packs[0]!.units[3] as { health: number }).health = -5;
    const problems = problemsOf(() => compile(packs));
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/unit "dir_extractor".*need a footprint/),
        expect.stringMatching(/unit "dir_reactor" at health/),
      ]),
    );
  });

  it("checks builders: rates, what they may build, and deposit footprints", () => {
    const packs = clonePacks();
    const dir = packs[0]!;
    (dir.units[1] as { builds: string[] }).builds = ["dir_warden"]; // technician builds a unit
    (dir.units[4] as { builds: string[] }).builds = ["dir_reactor"]; // works builds a structure
    (dir.units[4] as { buildRate?: number }).buildRate = 0;
    (dir.units[2] as { footprint: unknown }).footprint = { x: 3, z: 3 }; // odd extractor
    const problems = problemsOf(() => compile(packs));
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/"dir_technician" is mobile, so it can only build structures/),
        expect.stringMatching(/unit "dir_works".*need a buildRate above 0/),
        expect.stringMatching(/unit "dir_extractor".*even footprint/),
      ]),
    );
  });

  it("validates features and rejects duplicate feature ids", () => {
    const features = [...RAW_FEATURES, RAW_FEATURES[0]!, { ...RAW_FEATURES[1]!, salvage: -1 }];
    const problems = problemsOf(() =>
      compileRuleset({ movementClasses: RAW_MOVEMENT_CLASSES, features, packs: CONTENT_PACKS }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/feature "scrap_heap" at salvage/),
        expect.stringMatching(/duplicate feature id "car_wreck"/),
      ]),
    );
  });

  it("rejects units filed in another faction's pack", () => {
    const packs = clonePacks();
    packs[0]!.units = [...packs[0]!.units, packs[1]!.units[5]!];
    packs[1]!.units = packs[1]!.units.filter((_, i) => i !== 5);
    expect(problemsOf(() => compile(packs))).toEqual(
      expect.arrayContaining([expect.stringMatching(/in content pack #0 but belongs to/)]),
    );
  });
});
