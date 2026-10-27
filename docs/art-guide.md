# Art guide: models, textures and placeholders

A practical guide for making 3D models and textures for StratCom, whether they are finished
art or quick placeholders for testing. It covers what to make, how big, which way it faces,
how to export it, and where it goes.

> **Status (M4):** the game still draws every unit as a coloured box (the "placeholder
> asset provider" from [PLAN.md §4.3](PLAN.md)). **Model loading is not built yet.** It is
> planned as content-track milestone **C1** ([ROADMAP](ROADMAP.md#content-track-parallel-from-m3-onward),
> design in [ADR-0011](adr/0011-asset-pipeline-and-model-loading.md)). Everything below is
> what that loader will expect, so models made to these rules now will drop in unchanged.

## The short version

1. Model in metres, **Y up**, the unit **facing +Z** (in Blender: facing you in Front view,
   Numpad 1). The origin sits on the ground, at the centre of the unit.
2. One mesh, one material, PBR metal/roughness textures.
3. Export **`.glb`** (binary glTF 2.0), named after the unit id: `dir_lancer.glb`.
4. Keep it small: a few thousand triangles and 1K textures for most units.
5. Put it in `assets/models/` with a small `.asset.json` file saying who made it and under
   which licence.
6. Only use art you made yourself or that is CC0 or CC BY. Nothing from Fallout or any other
   game.

---

## 1. File format

**Game format: glTF 2.0 binary (`.glb`).** It is the "JPEG of 3D": one file holding the mesh,
materials and textures, and three.js loads it natively. Every modelling tool exports it.

**Source formats are up to you.** Keep `.blend`, `.obj`, `.fbx`, Substance or Photoshop files
as your working files, and export a `.glb` for the game. OBJ is fine as a source, but it
can't carry PBR materials cleanly or node names, so always convert it (see
[§7](#7-converting-an-obj-or-fbx)).

Later, a build step (`tools/asset-pipeline`, planned) will compress models with **meshopt**
and textures into **KTX2**, so they load faster and use less GPU memory. You don't need to do
anything for that: hand in a plain `.glb` with PNG or JPEG textures inside.

## 2. Scale, orientation and origin

The simulation works in metres, and the renderer places the model exactly where the sim says
the unit is. So:

| Rule       | Value                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Units      | **1 unit = 1 metre**                                                                                                  |
| Up         | **+Y** (glTF standard; Blender's exporter converts from its Z-up for you with "+Y Up" ticked)                         |
| Forward    | **+Z**: the barrel, cab or face points this way. In Blender that is **−Y**, the side you see in Front view (Numpad 1) |
| Origin     | **Centre of the unit's footprint, on the ground** (the bottom of the tracks, wheels or feet: y = 0)                   |
| Transforms | Applied (Blender: Ctrl+A → All Transforms). Scale 1, rotation 0 on the exported object                                |

Get these wrong and the unit floats, sinks, drives sideways or is the size of a building.
They are the most common problems with imported models, so check them first (see
[§9](#9-checklist-before-you-hand-it-over)).

### How big?

Each unit already has a placeholder box size in its data (`visual.size`, width × height ×
length in metres) and a collision `radius`. Match your model to them, or change the numbers
in the unit's data to match your model. Both are fine.

| Example (current data)   | Box (w × h × l) | Radius |
| ------------------------ | --------------- | ------ |
| Rust Buggy               | 3 × 2 × 4.5 m   | 2 m    |
| Lancer Tank              | 6 × 3.5 × 8 m   | 3.5 m  |
| Overseer Command Suit    | 6 × 8 × 6 m     | 4 m    |
| Assembly Works (factory) | 24 × 10 × 24 m  | 14 m   |

**Structures** stand on a grid of **8 m cells**. A `footprint: { x: 2, z: 2 }` structure covers
16 × 16 m; a 4 × 4 factory covers 32 × 32 m. Keep the model inside that square (a little
overhang is fine), with the origin at the centre of the square. Extractors are centred on a
deposit marker, which is about 14 m across.

The camera is usually 150–600 m away, so silhouettes and big shapes matter far more than
small details. Exaggerate: chunky barrels, big wheels, clear cabs. A Supreme Commander or BAR
unit is a toy-like caricature of a real vehicle for exactly this reason.

## 3. Polygon and texture budgets

The target is **2,000 units on screen at 60 fps** in a browser. Every unit of a type is drawn
in a single instanced draw call, so a type's cost is its triangle count × how many are on
screen.

| Kind                                    | Triangles     | Texture size |
| --------------------------------------- | ------------- | ------------ |
| Small units (buggies, infantry walkers) | 300 – 1,500   | 512 × 512    |
| Tanks, engineers, artillery             | 1,000 – 3,000 | 512 – 1024   |
| Commanders                              | 3,000 – 8,000 | 1024 – 2048  |
| Structures                              | 1,000 – 6,000 | 1024         |
| Debris (car wrecks, scrap heaps)        | 100 – 800     | 256 – 512    |

These are guidelines, not hard limits; a placeholder at 10× budget is fine while testing.

- **One mesh and one material per model** where you can. Each extra material is an extra
  draw call for every instance. Use a texture atlas instead of several materials.
- **Textures are square powers of two**: 256, 512, 1024, 2048.
- **No LODs needed for now.** Zoomed far out, the game switches to flat strategic icons
  anyway.

## 4. Textures

StratCom uses standard **PBR metal/roughness**, which is glTF's native material. Substance
Painter ("glTF PBR Metal Roughness" export preset), Blender, Armor Paint, Quixel Mixer and
most texture tools export it directly.

| Map                  | Colour space | Notes                                                                                          |
| -------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| Base colour (albedo) | sRGB         | No baked lighting or shadows, which the engine adds. Keep it mid-range: no pure black or white |
| ORM, packed          | Linear       | **R** = ambient occlusion, **G** = roughness, **B** = metalness. glTF's packing                |
| Normal               | Linear       | Tangent space, **OpenGL convention (green up, "Y+")**. DirectX normals look dented inward      |
| Emissive (optional)  | sRGB         | Glowing bits: Directorate reactor cores, energy weapons, lamps                                 |
| Team mask (planned)  | Linear       | Greyscale: **white = player colour**, black = keep the base colour. See below                  |

**Team colour.** Today the whole box is tinted with the owner's colour. Real models will
take the player colour only on certain areas: stripes, panels, flags. Paint a greyscale
**team mask** at the same UV layout as the base colour and save it next to the model as
`<unit_id>_team.png`. Paint those areas a neutral light grey in the base colour too. The
loader mixes the player colour in wherever the mask is white. A model without a mask is
tinted as a whole, more lightly, so you can still tell whose it is.

**Faction look** (from PLAN.md §2), so models read at a glance:

- **Directorate:** olive drab, cream and chrome, teal glow. Clean, riveted, pre-war
  engineering. Expensive and durable.
- **Scrapborn:** rust, hazard yellow, scorched black. Welded plate, mismatched parts, spikes
  and junk. Cheap and numerous.
- **Debris:** desaturated rust, faded paint, ash. It must read as neutral, never as a
  player's unit.

**Terrain textures** (later, for the content track): tileable, seamless, 1024 or 2048 square,
with base colour, normal and ORM like the above. Good first candidates are sand/dust, ash,
cracked earth, rock and glassed salt pan. They will replace the current height-and-slope
vertex colours.

## 5. Naming and nodes

- **File name = content id**: `dir_lancer.glb`, `scr_buggy.glb`, `car_wreck.glb`. The ids
  are in `packages/data/src/factions/*/units.ts` and `packages/data/src/features.ts`.
- Lowercase, no spaces, `snake_case` for everything inside the file too.
- **Name moving parts now** for combat (M5) and animation later. Make each one a separate
  object/node, with its pivot where it rotates:
  - `turret`: rotates around Y; pivot at the turret ring.
  - `barrel`: child of `turret`, pitches around X; pivot at the trunnion.
  - `muzzle`: an empty (no mesh) at the barrel tip, where shots and flashes spawn.
  - Walkers: `leg_l` / `leg_r` and so on, if you rig them. Animation is a later topic.
- Everything else can be one merged mesh named after the unit.

## 6. Where files go

Game-ready files go in the `assets/` folder at the top of the repository (planned for C1):

```
assets/
  models/
    dir_lancer.glb           the model
    dir_lancer.asset.json    who made it, licence, where it came from (required)
    dir_lancer_team.png      team-colour mask (optional)
  textures/terrain/          tileable terrain sets (later)
  CREDITS.md                 generated from the .asset.json files; don't edit by hand
```

The sidecar is a few lines of JSON:

```json
{
  "author": "Your Name",
  "license": "CC-BY-SA-4.0",
  "source": "original work",
  "notes": "Lancer v1, 2.1k tris"
}
```

For a downloaded placeholder, put the pack's name and URL in `source` and its licence
(`CC0-1.0`, `CC-BY-4.0`, …) in `license`.

Then add `model: "dir_lancer"` to the unit's `visual` in
`packages/data/src/factions/<faction>/units.ts`. Until you do, the unit keeps its box, so you
can add a model without it showing up yet.

You don't copy anything into the client yourself. `pnpm assets:build` (run automatically by
`pnpm dev` and `pnpm build`) checks every model, optimises it and writes the version the game
downloads. `pnpm assets:check` (part of `pnpm check`) runs only the checks; if a model is the
wrong size, floats above the ground or has no licence, it tells you which file and which
rule.

**Keep big source files out of git.** `.blend`, `.spp`, `.psd` and high-res bakes bloat the
repository forever, even after deletion. Keep them in your own art folder, a cloud drive, or
a separate repository. If you want them versioned next to the code, set up **Git LFS** for
those extensions first. Game-ready `.glb` files are fine in git if each stays under about
2 MB.

## 7. Converting an OBJ (or FBX)

Yes, this is easy, and you only do it once per model.

### With Blender (recommended: you can check and fix everything)

1. **File → New → General**, delete the default cube, camera and light.
2. **File → Import → Wavefront (.obj)** (or FBX). In the import options, leave the axes at
   their defaults (Forward −Z, Up Y), which is right for most OBJs.
3. **Check the size.** Press N and look at Dimensions in the side panel. A Lancer should be
   about 6 × 8 × 3.5 m. If it is 100× too big (centimetre exports) or tiny, scale it with S
   and a number.
4. **Check the direction.** Press Numpad 1 (Front view): you should be looking at the front of
   the unit. If not, rotate it (R Z 90, R Z 180, …).
5. **Put it on the ground.** The bottom should be at Z = 0 in Blender, centred on the origin.
   Snap the 3D cursor to the world origin (Shift+C), then **Object → Set Origin → Origin to
   3D Cursor** once it is positioned.
6. **Apply transforms:** Ctrl+A → **All Transforms**.
7. **Material:** one Principled BSDF with your base colour, roughness, metallic and normal
   textures connected. That is exactly what glTF exports. Image textures need correct colour
   space: sRGB for base colour, "Non-Color" for normal and ORM.
8. **File → Export → glTF 2.0**:
   - Format: **glTF Binary (.glb)**
   - Include: Selected Objects (or Visible)
   - Transform: **+Y Up** ✓
   - Mesh: Apply Modifiers ✓, UVs ✓, Normals ✓, Tangents ✓ (if it has a normal map)
   - Material: Export; Images: Automatic
   - Save as `<unit_id>.glb`.

### Without Blender (command line)

These run with Node from any folder, and need nothing from this repository. Check a package
before running it with `npx`.

```sh
npx obj2gltf -i lancer.obj -o dir_lancer.glb      # OBJ (+ .mtl) → GLB
npx @gltf-transform/cli inspect dir_lancer.glb    # triangle count, textures, sizes, bounds
npx @gltf-transform/cli resize dir_lancer.glb out.glb --width 1024 --height 1024
```

The command line converts, but it won't fix scale, direction or origin. Blender is the
better choice for anything you didn't make yourself.

### Checking the result

Drag the `.glb` into **https://gltf-viewer.donmccurdy.com** or the three.js editor
(**https://threejs.org/editor**). It renders with the same engine as the game, so if it looks
right there, it will look right in StratCom. The viewer shows the axes and the bounding box,
so you can confirm the size and that +Z is the front.

## 8. Placeholders and borrowed art

For testing, anything goes as long as it is legal to ship in an open-source game:

- **Your own work.** Always fine. You choose its license (see below).
- **CC0 (public domain) packs.** Fine, and the easiest placeholders. Kenney (kenney.nl),
  Quaternius (quaternius.com) and Poly Pizza have free low-poly vehicles, buildings and
  props (on Poly Pizza, check each model: some are CC BY); Poly Haven and ambientCG have CC0
  PBR textures. Record the pack and its URL in the model's `.asset.json`.
- **CC BY and CC BY-SA.** Fine; the attribution in `.asset.json` ends up in the generated
  `CREDITS.md`. **CC BY-NC or "free for personal use":** not usable, because the code is AGPL
  and the art may be sold or hosted by others. The asset check rejects them.
- **Never** use assets ripped or traced from games, including Fallout, Supreme Commander,
  BAR or anything else. And no Bethesda look-alikes: no Vault-Boy style mascots, Pip-Boy
  devices, Nuka branding, Vault doors with numbers, or Brotherhood/Enclave power armour
  silhouettes (PLAN.md §2). "Retro-futuristic 1950s atomic age" is fair game; Fallout's
  specific designs are not.
- **AI-generated art:** the legal status of AI-generated content is still unsettled. Use it
  for private testing, and say so in the `notes` of its `.asset.json` so it can be swapped out
  before release.

**Licensing your own art.** The code is AGPL-3.0; art gets its own license
([ADR-0008](adr/0008-license.md)), most likely **CC BY-SA 4.0**. That lets others reuse and
mod it, with credit to you, as long as they share their changes alike. Nothing is decided
until the first original art is merged (ADR-0011), so tell us if you'd prefer something else
for your work.

## 9. Checklist before you hand it over

- [ ] `.glb`, named `<unit_id>.glb`
- [ ] Metres; size close to the unit's `visual.size` (or update the data)
- [ ] Faces +Z (looks right in the glTF viewer); origin on the ground at the centre
- [ ] Transforms applied: scale 1, no rotation
- [ ] One material, PBR metal/roughness; base colour sRGB, ORM and normal linear, OpenGL normals
- [ ] Textures square, power of two, within budget
- [ ] Triangle count within (or near) budget, checked with `gltf-transform inspect`
- [ ] Moving parts named (`turret`, `barrel`, `muzzle`) with sensible pivots
- [ ] Team mask painted, if you made one
- [ ] `<unit_id>.asset.json` next to it, with author, licence and source
- [ ] `pnpm assets:check` passes (once C1 exists)

## What happens next

Model loading is planned as three steps on the content track
([ROADMAP](ROADMAP.md#content-track-parallel-from-m3-onward),
[ADR-0011](adr/0011-asset-pipeline-and-model-loading.md)):

1. **C1, Foundation (before M5).** The `visual.model` field, the `assets/` folder and
   sidecars, the asset check and build, and the loader in the game, with team colours and the
   box as a fallback. From then on, adding a model is: drop `dir_lancer.glb` and its
   `.asset.json` into `assets/models/`, add `model: "dir_lancer"` to the Lancer's data, and
   reload.
2. **C2, Moving parts (with M5).** Turrets and barrels aim at targets; muzzle flashes and
   shots start at the `muzzle` point.
3. **C3, Optimisation (before the first release).** Compressed models and textures, so the
   game downloads quickly.

Nothing you make today needs redoing for any of these steps, as long as it follows this
guide.
