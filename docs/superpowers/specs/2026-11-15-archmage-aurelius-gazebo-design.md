# Design Specification: Model 2 — Archmage Aurelius & The Astrolabe Gazebo

- **Date**: 2026-11-15
- **Status**: Draft for User Approval
- **Component**: `src/engine/ProceduralModels.ts` (`createAstrolabeGazebo` & `createArchmageAurelius`)
- **Visual Target**: Classical celestial observatory pavilion with seamless ribbed dome, and stylized elder archmage with pleated astral robes and armillary staff

---

## 1. Intent & Context

Screenshots from Solstice Haven revealed two major visual issues in the town center:
1. **Severed Floating Dome**: The green copper canopy over the gazebo was floating detached ~1.4 meters in the air above the pillars with a downward-pointing spike, due to a vertical offset mismatch in the sphere geometry parameters.
2. **Crude Wizard Geometry**: Archmage Aurelius was composed of a plain unarticulated cone body (`ConeGeometry(0.3, 0.6, 1.6)`), an oversized gold cylinder barrel collar (`CylinderGeometry(0.38, 0.45, 0.35)`), a raw featureless sphere head, and a plain cone hat.

This specification redesigns both the **Astrolabe Gazebo** and **Archmage Aurelius** into coherent, high-detail, stylized fantasy centerpieces for Solstice Haven.

---

## 2. Goals, Non-Goals, & Anti-Goals

### Goals
- **Structural Integrity for Gazebo**:
  - Seat the dome completely flush on a double-tiered stone entablature ring resting directly on the column capitals.
  - Add fluted detailing, stepped bases, and gold capitals to all 8 pillars.
  - Construct an integrated ribbed copper & lapis-blue dome with 8 gold structural ribs and an ornate astrolabe weather finial.
- **Detailed Stylized Archmage Rig**:
  - Replace the cone body and barrel collar with pleated midnight-indigo robes, layered wide sleeves, and an embroidered celestial shoulder mantle with star glyphs.
  - Sculpt elder facial anatomy, flowing silver hair locks, and a long braided wizard beard with gold rune rings.
  - Craft an ornate pointed wizard hat with a gently curved tip and golden crescent brooch.
  - Upgrade the staff into a starwood staff wrapped in gold filigree vines, crowned with a spinning brass armillary cage and an oscillating cyan prism crystal.
- **Harmonic Animations**:
  - Smooth multi-axis rotation of the central astrolabe orrery rings and glowing stellar core.
  - Aurelius staff crystal oscillation with breathing and hand-channeling idle cycles.
- **Performance Budget**: Under 3,500 total triangles across both structures combined, with shared materials, zero glTF downloads, and guaranteed 60 FPS.

### Non-Goals
- Modifying Aurelius's dialogue tree or role as the tutorial guide and wayfinding wizard.
- Changing the position or collision radius of the gazebo plinth in Solstice Haven.
- Touching the other town buildings or NPCs in this step.

### Anti-Goals
- Leaving any floating or disconnected geometry.
- Introducing heavy external 3D model downloads that cause network pop-in.

---

## 3. Approaches Considered

| Approach | Description | Tradeoffs | Selected? |
|---|---|---|---|
| **A. Download External Classical Temple & Wizard GLB** | Fetch external third-party 3D models over network. | Adds network latency, licensing conflicts, and potential style mismatch with cel-shaded world. | ❌ No |
| **B. Composite Procedural Three.js Geometries & Cel-Shaded Materials** | Hand-sculpt the pavilion and wizard using layered Three.js primitives (fluted columns, ribbed dome, pleated robes, braided beard, gimbaled rings) with custom standard materials. | 100% offline, instant load, locked 60 FPS, precise programmatic control over orrery animation and staff VFX, perfectly matches game art style. | ✅ **Selected** |
| **C. Quick Fix of Dome Y-Offset Only** | Lower the existing dome by 1.4m and keep the rest unchanged. | Fixes the disconnection bug but leaves the gazebo and Aurelius looking like crude geometric placeholders. | ❌ No |

---

## 4. Technical Architecture & Geometry Breakdown

### A. Astrolabe Gazebo (`createAstrolabeGazebo`)
1. **Plinth & Paving**:
   - Two-tiered circular marble plinth (`0xe2ded4`) with beveled steps.
   - Paved floor with concentric brass inlay rings.
2. **8 Fluted Classical Columns**:
   - Square molded plinth base at column foot ($y = 0.48\text{m} \to 0.7\text{m}$).
   - 12-sided fluted column shafts ($y = 0.7\text{m} \to 4.0\text{m}$).
   - Classical capitals with gold filigree collar bands ($y = 4.0\text{m} \to 4.25\text{m}$).
3. **Double-Tiered Entablature & Solid Ribbed Dome**:
   - Circular architrave beam ring resting directly on capitals ($y = 4.25\text{m}$, radius $3.2\text{m}$, thickness $0.22\text{m}$).
   - Solid hemisphere dome canopy starting flush at $y = 4.25\text{m}$ and arching up to $y = 6.2\text{m}$ in weathered copper patina (`#367a74`) and lapis blue.
   - 8 radial gold structural ribs (`TorusGeometry` arches) running from the architrave up to the summit ring.
4. **Celestial Astrolabe Finial**:
   - Ornate brass finial tower ($y = 6.2\text{m} \to 7.3\text{m}$) featuring interlocking armillary rings and a glowing celestial spire.
5. **Central Astrolabe Orrery**:
   - Suspended at $(0, 2.75, 0)$ inside the pavilion.
   - Outer meridian ring, equatorial ring, and oblique zodiac ring spinning at harmonic differential speeds ($0.35\text{rad/s}$, $0.5\text{rad/s}$, $0.7\text{rad/s}$).
   - Faceted cyan/amber stellar core pulsing with trigonometric sine light.

### B. Archmage Aurelius (`createArchmageAurelius`)
1. **Robes & Tunic**:
   - Midnight-indigo pleated robe skirt (`#1e1b4b`) with flared base hem.
   - Gold celestial star embroidery trim around the hemline.
   - Midnight-blue vest with braided gold frogs and waist sash.
   - Layered wizard shoulder cowl/mantle with gold filigree edging, draped naturally over shoulders.
2. **Anatomy, Hair & Beard**:
   - Dignified elder head geometry with warm skin tone (`#f5d0b5`).
   - Swept-back silver wizard hair locks (`#f1f5f9`).
   - Majestic flowing braided beard extending down chest with gold band rings.
3. **Wizard Hat**:
   - Flared cloth brim with undulating edge.
   - Gold embroidered hat band with celestial crescent moon brooch.
   - Tapered hat cone with gentle curved peak leaning backward.
4. **Starwood Astrolabe Staff**:
   - Carved polished starwood shaft (`#3e2723`) wrapped in gold filigree spiral vine.
   - Staff head: Brass armillary astrolabe sphere housing an oscillating floating dodecahedron crystal (`#38bdf8`).
5. **Animation**:
   - Idle breathing and robe hem drift.
   - Left arm raised in subtle arcane gesture.
   - Staff crystal oscillating and rotating with harmonic glow.

---

## 5. Verification & Testing Criteria
1. **Compilation & Unit Tests**:
   - Vitest test suite verifies `createAstrolabeGazebo` and `createArchmageAurelius` hierarchy (`gazebo_dome`, `gazebo_orrery`, `aurelius_staff`, `aurelius_beard`).
   - All tests passing with `npm test`.
   - Production build passes with `npm run build`.
2. **Visual Inspection**:
   - In-game close-up inspection via browser subagent confirming:
     - No gap/void between gazebo columns and dome (dome seated flush on entablature).
     - Aurelius features pleated robes, silver hair/beard, and ornate hat.
     - Orrery and staff crystals animate smoothly.
     - Interaction prompt `[F] Talk to Archmage Aurelius` functions reliably.
