import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  type Material,
} from "three";
import type { SnapshotBuffers } from "@stratcom/sim";
import { UnitLayer } from "./UnitLayer";
import type { GameRenderer, SceneOptions } from "./types";

/** Dusty wasteland palette for the M0 scene. Post-processing and real grading arrive in M7. */
const PALETTE = {
  sky: "#cdb892",
  ground: "#7d6a4a",
  grid: "#3b3020",
  hemiSky: "#e6d7b0",
  hemiGround: "#4a3b28",
  sun: "#ffd9a0",
} as const;

/**
 * M1 scene: a flat test plain plus the {@link UnitLayer}. It is the seed of the layered
 * renderer from docs/PLAN.md §4.3; TerrainLayer and IconLayer join it in M2 while the
 * {@link GameRenderer} interface stays put.
 */
export function createSceneRenderer(
  canvas: HTMLCanvasElement,
  options: SceneOptions,
): GameRenderer {
  const mapSize = options.mapSize;
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });

  // Every GPU resource we create is registered here and released in dispose().
  const resources = new Set<Disposable>();
  const track = <T extends Disposable>(resource: T): T => {
    resources.add(resource);
    return resource;
  };
  renderer.toneMapping = ACESFilmicToneMapping;

  const scene = new Scene();
  scene.background = new Color(PALETTE.sky);
  scene.fog = new Fog(PALETTE.sky, 600, 2400);

  // Classic RTS three-quarter view. The real RTS camera with strategic zoom arrives in M2.
  const camera = new PerspectiveCamera(45, 1, 1, 6000);
  camera.position.set(mapSize / 2, 700, mapSize / 2 + 500);
  camera.lookAt(mapSize / 2, 0, mapSize / 2);

  scene.add(new HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.2));
  const sun = new DirectionalLight(PALETTE.sun, 2.2);
  sun.position.set(-120, 160, 80);
  scene.add(sun);

  const ground = new Mesh(
    track(new PlaneGeometry(mapSize, mapSize)),
    track(new MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(mapSize / 2, 0, mapSize / 2);
  scene.add(ground);

  const grid = new GridHelper(mapSize, mapSize / 16, PALETTE.grid, PALETTE.grid);
  track(grid.geometry);
  const gridMaterial = track(grid.material as Material);
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.25;
  grid.position.set(mapSize / 2, 0.02, mapSize / 2);
  scene.add(grid);

  const units = new UnitLayer(options.unitVisuals, options.playerColors, options.maxUnits);
  scene.add(units.group);

  return {
    resize(width, height, devicePixelRatio) {
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    },
    setUnits(snapshot: SnapshotBuffers, alpha: number) {
      units.update(snapshot, alpha);
    },
    lookAt(x, z, height) {
      camera.position.set(x, height, z + height * 0.7);
      camera.lookAt(x, 0, z);
    },
    render() {
      renderer.render(scene, camera);
    },
    get drawCalls() {
      return renderer.info.render.calls;
    },
    dispose() {
      units.dispose();
      for (const resource of resources) resource.dispose();
      resources.clear();
      renderer.dispose();
    },
  };
}

interface Disposable {
  dispose(): void;
}
