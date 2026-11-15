# Design Specification: Boss Models Overhaul — Vespera, Malakor & Vaelorath

- **Date**: 2026-11-15
- **Status**: Implemented
- **Components**: `src/engine/BossModels.ts` (bosses), `src/engine/SculptKit.ts` (shared sculpting toolkit),
  `GameEngine` (calls `BossRig.animate`)

---

## 1. Intent

The three bosses were stacks of cones, spheres and boxes in flat plastic materials. They are now
sculpted procedural hero models. They still need no external assets, and they keep the `BossRig`
contract the engine, AI and cutscenes already drive (`bodyGroup`, `coreMesh`, `orbitParts`, wings,
neck/tail segments, veil ribbons, ward).

## 2. Technique (SculptKit)

- **Swept bodies** (`sweepGeometry`): variable-radius, elliptical cross-sections along Catmull-Rom splines with
  parallel-transport frames, per-vertex colours, tangent "lift" (tattered/trailing hems), safe caps, and welded
  seams. Horns, bones, ribs, hair ribbons, gowns, dragon bodies and tails all use it.
- **Painted textures** (`PixelCanvas`): DOM-free RGBA painting (ellipses, AA lines, parametric curves, value
  noise), so models also build inside Node unit tests.
- **Static baking** (`mergeStaticMeshes`): static parts are merged per material, giving 41–63 draw calls per boss.
- **IK** (`solveTwoBoneArm`), **`approach`** smoothing, and **`computeSafeNormals`**, which repairs degenerate
  normals. A single NaN pixel blanks the whole bloom-composited frame, and that actually happened during
  development (collapsed sphere poles, and `pow` of a tiny negative number in a ribbon fade).

## 3. Bosses

### Vespera, Astral Sylvan Witch (sin / cos)
- Floating gown whose hem radius is literally `r + a·sin(8θ)`, with a trailing back train, painted midnight silk,
  star dust, and two glowing embroidered bands tracing **sin(θ)** and its derivative **cos(θ)**. A starfield
  underskirt and soft trails sit under the scallops.
- Sculpted oval face with a painted anime face (winged liner, glowing irises, a forehead sine sigil). Side-swept
  bangs, front locks, and three swaying back locks that grade from silver to azure.
- Crescent tiara, slender antlers with glowing leaves, a harmonic halo (a gold ring wrapped in a sine-wave ring).
- IK arms with bell sleeves that hang from the elbow. An elderwood staff with a spiralling branch cradle,
  an orb and spinning armillary rings. A sine sigil over the casting hand.
- Veil ribbons animated as **traveling sine waves** that fade toward their tips.

### Malakor, Ancient Ruin Lich (tan / cot)
- Tattered robe (jagged swept hem) over pooled ghost mist. A gilded glyph band of **tan/cot branches between their
  asymptotes**, eyes and ankhs. A striped tabard.
- Exposed skeleton: vertebrae, barrel ribcage, sternum and clavicles around a pulsing soul furnace. A usekh collar
  with banded faience and beads.
- Sculpted skull with slanted sockets, a scowling brow, eye flames, a gaping jaw over a dark maw, a nemes
  headdress, a uraeus, and a rotating sun-disk halo.
- Skeletal IK arms with tattered sleeves and clawed hands, plus a palm soul-flame.
- Staff topped with a gilded **asymptote frame cradling a glowing tan(θ) curve**.
- Floating stepped-ziggurat sandstone pauldrons, and carved, glowing glyph obelisks as orbit parts.

### Vaelorath, Skyridge Wyrm (sec / csc)
- Swept, barrel-chested body with vertex-coloured crimson back, flanks and cream belly. A scale texture
  (auto-scaled per piece so the cells stay square) doubles as a **bump map** for raised scales, with belly plates.
- Three articulated neck segments with hidden joints, and five tail segments ending in a glowing spade blade.
- Sculpted head: brow bulge, sweeping ridged horns, frills, slit eyes, fangs, a jaw that **opens on the dive
  telegraph** with a throat glow, and glowing barbels.
- Bat wings with arm and four finger bones, membranes fanned from the wrist with scalloped trailing edges, and a
  wrist claw. Tucked clawed legs, and a chest core in a gold lattice.

## 4. Animation (`BossRig.animate(dt, ctx)`)

The engine calls `animate` every frame after driving the shared parts, and calls it during the intro cutscene
with the `TELEGRAPH` pose. Poses follow the AI phase with frame-rate-independent smoothing: casting arms, staff
lift, lean/slump, jaw open, flame and core intensity, plus halo, ring, ribbon and hair motion. Frame time and
context are sanitized at the rig boundary.

## 5. Verification

- `pnpm test`: no NaN or degenerate normals on any boss, finite transforms through every AI phase and hostile
  `dt`, render budget (< 24k triangles, ≤ 70 draw calls per boss), telegraph raises the casters' arms and opens the
  dragon's jaw.
- `pnpm typecheck` and `pnpm build`.
- Headless-Chromium renders using the game's tone mapping, bloom and lighting.
