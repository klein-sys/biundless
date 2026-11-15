# Design Specification: Model 1 — Theron the Blacksmith & Forge Station

- **Date**: 2026-11-15
- **Status**: Draft for User Approval
- **Component**: `src/engine/ProceduralModels.ts` (`createTownsperson('blacksmith')` / `createBlacksmithStation`)
- **Visual Target**: High-detail stylized fantasy NPC & interactive forge workstation

---

## 1. Intent & Context

In the current game state, Solstice Haven's NPCs were built as rapid geometric placeholders:
- **Theron the Blacksmith** is currently composed of a plain untextured box torso (`BoxGeometry(0.65, 0.75, 0.4)`), a single flat box apron slab, a featureless sphere head without eyes, hair, or beard, no arms, no legs, and an anvil that is a flat black block with a neon orange rectangular slab.
- This creates an immersion-breaking visual disconnect against the vibrant cel-shaded terrain, sky, and boss arenas.

The user has explicitly requested to upgrade models **1-by-1**, focusing first on transforming Theron into an expressive, detailed, stylized fantasy blacksmith with genuine depth, texture, and procedural animation.

---

## 2. Goals, Non-Goals, & Anti-Goals

### Goals
- **Detailed Anatomical Structure**: Sculpt Theron with muscular rolled-sleeve arms, articulated shoulders, neck, head with stylized hair, thick braided beard, leather bracers, workman trousers, and heavy iron-toed boots.
- **Layered Workwear & Depth**: Add a stitched leather apron with brass rivets, shoulder buckles, tool belt with hanging smithing tongs, and leather vest over an off-white rolled-sleeve tunic.
- **Authentic Forge Environment**:
  - Replace the plain block anvil with a classic curved-horn smith's anvil mounted atop a banded timber stump.
  - Add an active stone forge hearth with glowing charcoal embers, chimney flue, and warm heat-haze glow.
  - Add a water slack quenching tub with wooden barrel staves and water surface.
- **Procedural Animation & Spark VFX**:
  - Articulate right arm/elbow holding the forge hammer.
  - Implement a rhythmic hammering cycle: Theron raises the hammer and strikes the glowing heated ingot on the anvil.
  - On hammer contact, emit a small burst of glowing ember/spark particles and an orange flash.
- **Performance Budget**: Keep total geometry under 2,600 triangles with shared materials to ensure locked 60 FPS on mobile and zero network fetch latency.

### Non-Goals
- Changing Theron's dialogue tree or shop mechanics (dialogue interfaces remain 100% backward compatible).
- Moving Theron to a different coordinate in Solstice Haven (remains at $(-8.5, Y, -5.5)$ facing the plaza).
- Upgrading Aurelius, Lyra, Eldrin, or the cottages in this step (they will be upgraded sequentially 1-by-1 in subsequent steps).

### Anti-Goals
- Introducing heavy external `.glb`/`.gltf` asset downloads that cause network pop-in or slow down initial game launch.
- Creating hyper-realistic PBR photorealism that clashes with the game's stylized anime/cel-shaded palette.

---

## 3. Approaches Considered

| Approach | Description | Tradeoffs | Selected? |
|---|---|---|---|
| **A. External GLTF Asset Download** | Import a pre-modeled 3D blacksmith `.glb` from an external CDN or asset pack. | Introduces HTTP latency, asset hosting fragility, licensing issues, and potential visual style clashing. | ❌ No |
| **B. Multi-Part Stylized Procedural Three.js Meshes** | Construct Theron and his forge using layered Three.js primitives (lathed cylinders, beveled extrusions, chamfered boxes, sculpted hair/beard meshes) with custom cel-shaded standard materials. | 100% offline, zero load time, perfectly matches the game's shader palette, lightweight (<2.5k triangles), full programmatic control over rigging and animation. | ✅ **Selected** |
| **C. Animated 2D Billboards / Sprites** | Replace 3D NPCs with 2.5D animated pixel/painted sprite billboards. | Clashes with 3D third-person free-orbit camera when orbiting around the NPC. | ❌ No |

---

## 4. Technical Architecture & Geometry Breakdown

### Character Geometry (`TheronRig`)
1. **Head & Hair**:
   - Cranium & face: Beveled head geometry with skin tone (`#e0a980`).
   - Stylized Hair: Layered swept-back sculpted brown hair bangs and sideburns.
   - Braided Beard: Full dwarf/viking-styled smith beard with gold band rings (`#3a2213`).
   - Eyes: Clean stylized anime eyes with eyebrows and determined expression.
2. **Torso & Tunic**:
   - Cream-colored cotton work tunic (`#ede2cb`) with open collar and visible chest/neck.
   - Brown leather work apron (`#5a3118`) with front tool pocket, waist strap, and brass eyelets (`#d4af37`).
3. **Arms & Hands**:
   - Muscular upper arms with rolled fabric sleeve cuffs.
   - Forearms with stitched leather wrist bracers.
   - Modeled hands: Left hand gripping forge tongs that hold the glowing billet; right hand gripping the war-hammer/smithing hammer.
4. **Legs & Boots**:
   - Dark leather trousers (`#2b211a`).
   - Thick leather boots with steel buckle straps and heel rims.

### Station Props & Forge Hearth
1. **Smith's Anvil**:
   - Base plinth, waist, stepped table, hardy hole, and tapered conical horn.
   - Banded timber base: Chiseled tree trunk block secured by two forged iron ring bands.
2. **Glowing Ingot**:
   - Heated steel billet with emissive gradient (`#ff4500` core, `#ffaa00` edges) clamped by smith tongs.
3. **Stone Forge & Hearth**:
   - Curved river-stone masonry forge basin.
   - Glowing ember bed with pulsing emissive charcoal coal bed.
   - Smelting hood and flue pipe.
4. **Slack Tub**:
   - Wooden half-barrel quenching tub with steel bands and clear water surface.

### Animation Loop
- `update(dt)`:
  - Right arm raises with hammer over $0.75\text{s}$, pauses at apex for $0.15\text{s}$, then delivers an accelerated strike down onto the anvil ($0.1\text{s}$).
  - On strike contact:
    - 6-8 spark particles burst outward with velocity and gravity decay.
    - The ingot pulses in emissive brightness.
    - Slight head nod and torso weight shift to simulate physical effort.

---

## 5. Verification & Testing Criteria
1. **Compilation & Tests**:
   - `npm.cmd test` passes all test suites.
   - `npm.cmd run build` passes with zero type or bundling errors.
2. **Visual Inspection**:
   - Inspect Theron close-up via the browser subagent in Solstice Haven.
   - Verify proper shading, no clipping, correct alignment with anvil, and smooth hammer strike animation.
   - Capture visual evidence screenshot into artifacts.
3. **Gameplay Interaction**:
   - Verify player can approach Theron, receive interaction prompt (`[F] Talk to Theron the Smith`), and engage in dialogue smoothly.
