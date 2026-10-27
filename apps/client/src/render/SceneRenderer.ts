import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Scene,
  WebGLRenderer,
} from "three";
import { PROJECTILE_CAPACITY, terrainWidth, type SnapshotBuffers } from "@stratcom/sim";
import { CombatLayer } from "./CombatLayer";
import { DepositLayer } from "./DepositLayer";
import { GhostLayer } from "./GhostLayer";
import { RtsCamera } from "./RtsCamera";
import { TerrainLayer } from "./TerrainLayer";
import { UnitLayer } from "./UnitLayer";
import type { GameRenderer, SceneOptions } from "./types";

/** Dusty wasteland palette. Post-processing and real grading arrive in M7. */
const PALETTE = {
  sky: "#cdb892",
  hemiSky: "#e6d7b0",
  hemiGround: "#4a3b28",
  sun: "#ffd9a0",
} as const;

/** Camera distance (m) where models start fading to icons, and where only icons remain. */
const STRATEGIC_START = 900;
const STRATEGIC_END = 1300;

/**
 * The layered renderer from docs/PLAN.md §4.3: {@link TerrainLayer}, {@link DepositLayer},
 * {@link UnitLayer} (with its icon, selection and health-bar sub-layers), the
 * {@link CombatLayer} (projectiles and shots), the placement {@link GhostLayer} and the
 * {@link RtsCamera}. The FxLayer (explosions, grading) arrives in M7.
 */
export function createSceneRenderer(
  canvas: HTMLCanvasElement,
  options: SceneOptions,
): GameRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.toneMapping = ACESFilmicToneMapping;

  const scene = new Scene();
  scene.background = new Color(PALETTE.sky);
  const mapSize = terrainWidth(options.terrain);
  scene.fog = new Fog(PALETTE.sky, mapSize * 0.6, mapSize * 2.2);

  const rts = new RtsCamera(options.terrain);
  scene.add(new HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.8));
  const sun = new DirectionalLight(PALETTE.sun, 1.7);
  sun.position.set(-0.5, 0.8, 0.4);
  scene.add(sun);

  const terrain = new TerrainLayer(options.terrain);
  scene.add(terrain.group);
  const deposits = new DepositLayer(options.deposits, options.terrain);
  scene.add(deposits.group);
  const units = new UnitLayer(
    options.unitVisuals,
    options.featureVisuals,
    options.playerColors,
    options.maxUnits,
    options.terrain,
    options.selectionColor,
  );
  scene.add(units.group);
  const combat = new CombatLayer(options.weaponKinds, PROJECTILE_CAPACITY, options.terrain);
  scene.add(combat.group);
  const ghost = new GhostLayer(options.terrain);
  scene.add(ghost.group);

  let width = 1;
  let height = 1;
  let blend = 0;
  let last: { snapshot: SnapshotBuffers; alpha: number } | undefined;

  return {
    camera: rts,
    resize(w, h, devicePixelRatio) {
      width = w;
      height = Math.max(h, 1);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(w, h, false);
      rts.setAspect(width / height);
    },
    setUnits(snapshot: SnapshotBuffers, alpha, selected) {
      const t = (rts.distance - STRATEGIC_START) / (STRATEGIC_END - STRATEGIC_START);
      blend = Math.min(Math.max(t, 0), 1);
      units.update(snapshot, alpha, selected, rts.camera, blend);
      last = { snapshot, alpha };
    },
    setFog(vision, offset) {
      terrain.setFog(vision, offset);
    },
    addEvents(events, timeMs) {
      combat.addEvents(events, timeMs);
    },
    projectUnits(snapshot, alpha, out) {
      units.project(snapshot, alpha, rts.camera, width, height, out);
    },
    setGhost(g) {
      ghost.set(g);
    },
    groundAt: (x, y) => rts.groundAt(x, y),
    render(timeMs) {
      if (last) combat.update(last.snapshot, last.alpha, timeMs);
      combat.group.visible = blend < 1;
      // The sun follows the camera target so shadows-to-be stay coherent; direction is fixed.
      sun.target.position.set(rts.target.x, 0, rts.target.z);
      sun.position.set(rts.target.x - 700, 450, rts.target.z + 300);
      sun.target.updateMatrixWorld();
      terrain.update(rts.camera.position);
      renderer.render(scene, rts.camera);
    },
    get drawCalls() {
      return renderer.info.render.calls;
    },
    get strategicBlend() {
      return blend;
    },
    dispose() {
      units.dispose();
      combat.dispose();
      ghost.dispose();
      deposits.dispose();
      terrain.dispose();
      renderer.dispose();
      // Free the GPU context now rather than whenever the browser garbage-collects it; each
      // match gets a fresh canvas (see GameSession).
      renderer.forceContextLoss();
    },
  };
}
