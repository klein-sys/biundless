# Design Specification: Model 2 — Lyra the Herbalist & Apothecary Stall

- **Date**: 2026-11-15
- **Status**: Implemented
- **Component**: `src/engine/ProceduralModels.ts` (`createLyraHerbalist()` routed from `createTownsperson('herbalist')`)
- **Visual Target**: Stylized fantasy herbalist NPC with an interactive-feeling apothecary workstation

---

## 1. Intent & Context

Step 2 of the one-by-one NPC upgrade. Lyra was a placeholder: a green cone dress, a box apron, a featureless
sphere head, a purple torus "circlet", and a brown box "basket". She now needs to match the craft level of
Theron (Model 1) while reading instantly as the opposite archetype: soft, botanical, and calm next to his heavy
forge rhythm.

## 2. Goals & Non-Goals

### Goals
- **Silhouette**: Slender figure (~1.76 m, shorter than Theron) with a flared bell skirt, laced corset bodice,
  puffed linen sleeves, and a sage shawl. Long copper braid draped over her left shoulder.
- **Face**: Stylized eyes with highlights, brows, blush, nose, and mouth. Woven flower crown (vine ring,
  lavender / cream / pink / gold blossoms, leaves) replaces the torus circlet.
- **Layered clothing**: Moss-green dress with gold embroidered hem, cream curved apron with leaf-embroidered
  pocket, plum waist sash with back bow, leather hip pouch, and gold shawl brooch.
- **Apothecary stall**:
  - Trestle workbench with lower shelf jars, stone mortar of glowing herb mash, three potion bottles (the crimson
    one ties back to the Crimson Flask heal), an open herbal grimoire, a fresh herb bundle, and a leaf plaque.
  - Copper cauldron on an iron tripod over glowing coals, with a softly pulsing green-teal brew and a ladle.
  - Drying rack behind her with five swaying hanging herb bundles.
  - Flower crate at her right with blossoms.
- **Signature animation**: Lyra grinds herbs. The pestle traces a circle in the mortar while both arms follow it
  through a two-bone IK solve (left hand steadies the mortar). The mash glows once per turn. Every ten seconds she
  glances up at the plaza. Breathing, braid sway, and swaying drying bundles add life.
- **Ambient VFX (pooled, no allocation per frame)**: Rising cauldron bubbles that pop, soft steam wisps, and
  drifting golden pollen motes from the flowers and mortar ("the meadow flowers are blooming with radiant energy").
- **Determinism**: All animation is a closed-form function of accumulated time, so arbitrary or bad `dt` values
  cannot drift or explode.
- **Render budget**: ~6.3k triangles but only 37 draw calls (Theron: 2.7k / 73). Static parts are baked per
  material with `mergeStaticMeshes`, plain matte materials fold into one vertex-coloured material, and the bubble /
  steam / pollen pools are `InstancedMesh`es. On mobile, draw calls, not this triangle count, are the real cost.

### Non-Goals
- No dialogue, interaction radius, or placement changes. Lyra stays at `(8.5, Y, -5.5)` facing the plaza.
- No upgrades to Aurelius, Eldrin, or the cottages in this step.

### Anti-Goals
- No external `.glb` assets. No photoreal PBR. Same flat stylized `MeshStandardMaterial` palette as Theron.

## 3. Verification
- `pnpm test` passes, including new tests for the rig hierarchy, pestle staying inside the mortar, finite
  transforms under hostile `dt`, and the render budget (< 7k triangles, <= 40 draw calls).
- `pnpm typecheck` passes.
- Visual check: isolated headless-Chromium renders (front, side, close-up during the glance).
