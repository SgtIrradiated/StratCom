import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  type Material,
} from "three";
import type { GameRenderer, PlaceholderUnit, SceneOptions } from "./types";

/** Dusty wasteland palette for the M0 scene. Post-processing and real grading arrive in M7. */
const PALETTE = {
  sky: "#cdb892",
  ground: "#7d6a4a",
  grid: "#3b3020",
  hemiSky: "#e6d7b0",
  hemiGround: "#4a3b28",
  sun: "#ffd9a0",
} as const;

const MAP_SIZE = 1024;

/**
 * M0 scene: a flat test plain with one placeholder per faction. It is the seed of the
 * layered renderer from docs/PLAN.md §4.3 (TerrainLayer, UnitLayer, …), which replaces
 * the body of this class in M1–M2 while keeping the {@link GameRenderer} interface.
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

  // Every GPU resource we create is registered here and released in dispose().
  const resources = new Set<Disposable>();
  const track = <T extends Disposable>(resource: T): T => {
    resources.add(resource);
    return resource;
  };
  renderer.toneMapping = ACESFilmicToneMapping;

  const scene = new Scene();
  scene.background = new Color(PALETTE.sky);
  scene.fog = new Fog(PALETTE.sky, 200, 700);

  // Classic RTS three-quarter view. The real RTS camera with strategic zoom arrives in M2.
  const camera = new PerspectiveCamera(45, 1, 1, 3000);
  camera.position.set(0, 90, 120);
  camera.lookAt(0, 0, 0);

  scene.add(new HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.2));
  const sun = new DirectionalLight(PALETTE.sun, 2.2);
  sun.position.set(-120, 160, 80);
  scene.add(sun);

  const ground = new Mesh(
    track(new PlaneGeometry(MAP_SIZE, MAP_SIZE)),
    track(new MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 })),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new GridHelper(MAP_SIZE, MAP_SIZE / 16, PALETTE.grid, PALETTE.grid);
  track(grid.geometry);
  const gridMaterial = track(grid.material as Material);
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.25;
  grid.position.y = 0.02;
  scene.add(grid);

  const turrets = options.placeholders.map((unit) => {
    const { body, turret } = createPlaceholder(unit, track);
    scene.add(body);
    return turret;
  });

  return {
    resize(width, height, devicePixelRatio) {
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    },
    render(timeMs) {
      // Presentation-only idle animation; it never feeds back into game state.
      turrets.forEach((turret, i) => {
        turret.rotation.y = timeMs * 0.0004 * (i % 2 === 0 ? 1 : -1);
      });
      renderer.render(scene, camera);
    },
    dispose() {
      for (const resource of resources) resource.dispose();
      resources.clear();
      renderer.dispose();
    },
  };
}

interface Disposable {
  dispose(): void;
}

/** A box hull with a rotating turret and a glowing accent, coloured by faction. */
function createPlaceholder(
  unit: PlaceholderUnit,
  track: <T extends Disposable>(resource: T) => T,
): { body: Group; turret: Group } {
  const hull = track(
    new MeshStandardMaterial({ color: unit.baseColor, roughness: 0.8, metalness: 0.2 }),
  );
  const glow = track(
    new MeshStandardMaterial({
      color: unit.accentColor,
      emissive: unit.accentColor,
      emissiveIntensity: 1.5,
    }),
  );

  const body = new Group();
  body.position.set(unit.x, 0, unit.z);

  const chassis = new Mesh(track(new BoxGeometry(12, 5, 16)), hull);
  chassis.position.y = 2.5;
  body.add(chassis);

  const turret = new Group();
  turret.position.y = 5;
  const dome = new Mesh(track(new CylinderGeometry(4, 5, 4, 12)), hull);
  dome.position.y = 2;
  const barrel = new Mesh(track(new BoxGeometry(1.2, 1.2, 10)), hull);
  barrel.position.set(0, 2.5, 6);
  const beacon = new Mesh(track(new CylinderGeometry(0.8, 0.8, 1.5, 8)), glow);
  beacon.position.y = 4.75;
  turret.add(dome, barrel, beacon);
  body.add(turret);

  return { body, turret };
}
