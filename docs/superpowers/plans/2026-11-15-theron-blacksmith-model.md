# Model 1: Theron the Blacksmith & Forge Station Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Theron the Blacksmith from a primitive box-and-sphere placeholder into a stylized, high-detail fantasy NPC with articulated anatomy, layered workwear, an authentic smithing anvil station, glowing hearth, and procedural rhythmic hammer strikes with sparks.

**Architecture:** Implement `createTheronBlacksmith()` in `src/engine/ProceduralModels.ts` using layered composite Three.js geometry (<2,600 triangles) and stylized cel-shaded standard materials. Route `createTownsperson('blacksmith')` directly to `createTheronBlacksmith()` to maintain 100% backward compatibility with `createSolsticeHavenVillage()` and the existing dialogue system.

**Tech Stack:** Three.js, TypeScript, Vitest, Vite

**Spec:** [docs/superpowers/specs/2026-11-15-theron-blacksmith-model-design.md](file:///c:/Users/JAMES/Downloads/new%20game/docs/superpowers/specs/2026-11-15-theron-blacksmith-model-design.md)

## Global Constraints
- Target budget: under 2,600 triangles total for Theron and his forge station props.
- Zero external glTF/GLB downloads; 100% offline procedural Three.js geometry.
- Full backward compatibility for `interactiveNpcs` interface and dialogue IDs (`id: 'blacksmith'`).
- Rhythmic procedural hammer animation with contact spark particle effects.

## Review Focus
1. **Model scale and grounding**: Theron's boots and anvil base must rest flush on the town square surface without floating or sinking into the ground.
2. **Animation robustness**: The hammer strike cycle must run cleanly with arbitrary delta times (`dt`) without numeric drift or jitter.
3. **Spark particle lifecycle**: Particle pool must recycle without memory leaks or unbounded allocation.
4. **Dialogue interaction preserved**: Approaching Theron in-game must reliably trigger the `[F] Talk to Theron the Smith` HUD prompt at distance $\le 3.8\text{m}$.
5. **No regression on other town elements**: Aurelius, Lyra, Eldrin, wanderers, and cottages must remain unaffected.

---

### Task 1: Add Unit Tests for Theron Blacksmith Model Rig & Forge Station

**Files:**
- Modify: `tests/astrolabeAndModels.test.ts`

**Interfaces:**
- Consumes: `createTheronBlacksmith` from `src/engine/ProceduralModels.ts`
- Produces: Verified unit tests for Theron's model structure, articulated hammer arm, forge hearth, anvil, and animation updater.

- [ ] **Step 1: Write the unit tests for `createTheronBlacksmith` in `tests/astrolabeAndModels.test.ts`**

```typescript
describe('Theron the Blacksmith Model & Forge Station', () => {
  it('creates an articulated stylized Theron rig with forge, anvil, and spark systems', () => {
    const smith = createTheronBlacksmith();
    expect(smith.group).toBeInstanceOf(THREE.Group);
    
    // Verify anvil and forge station exist in hierarchy
    let foundAnvil = false;
    let foundForge = false;
    let foundHammer = false;
    
    smith.group.traverse((child) => {
      if (child.name === 'theron_anvil') foundAnvil = true;
      if (child.name === 'theron_forge') foundForge = true;
      if (child.name === 'theron_hammer_arm') foundHammer = true;
    });
    
    expect(foundAnvil).toBe(true);
    expect(foundForge).toBe(true);
    expect(foundHammer).toBe(true);
  });

  it('steps the rhythmic hammering animation cycle without throwing', () => {
    const smith = createTheronBlacksmith();
    expect(() => {
      smith.update(0.016);
      smith.update(0.1);
      smith.update(0.5);
      smith.update(1.0);
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/astrolabeAndModels.test.ts`
Expected: FAIL with "createTheronBlacksmith is not defined" or similar.

- [ ] **Step 3: Export a stub `createTheronBlacksmith` in `src/engine/ProceduralModels.ts`**

Export the function signature returning an empty group and no-op update function.

- [ ] **Step 4: Run test to verify stub compiles but fails assertions**

Run: `npm.cmd test -- tests/astrolabeAndModels.test.ts`
Expected: FAIL on missing named child parts (`theron_anvil`, `theron_forge`, `theron_hammer_arm`).

---

### Task 2: Implement Stylized Theron Anatomical Rig, Forge Station & Hammer Animation

**Files:**
- Modify: `src/engine/ProceduralModels.ts:2089-2140`

**Interfaces:**
- Consumes: `THREE.Group`, `THREE.MeshStandardMaterial`, `THREE.CylinderGeometry`, `THREE.BoxGeometry`, etc.
- Produces: `export function createTheronBlacksmith(): { group: THREE.Group; update: (dt: number) => void }`

- [ ] **Step 1: Implement Anatomical Theron Character Mesh**
  - Head, swept-back stylized hair, braided dwarf/viking beard with gold rings.
  - Muscular neck and shoulders, cream cotton tunic with rolled sleeves.
  - Stitched leather apron with shoulder straps, brass eyelets, tool belt, and hanging tongs.
  - Left arm holding tongs clamped to the glowing heated billet on the anvil.
  - Articulated right shoulder/arm pivot (`name = 'theron_hammer_arm'`) holding a forged blacksmith hammer.
  - Dark leather workman pants and boots with metal buckles.

- [ ] **Step 2: Implement Forge Station Props**
  - **Smith's Anvil** (`name = 'theron_anvil'`): Horn, waist, hardy hole, and stepped heel mounted atop an iron-banded timber tree trunk.
  - **Heated Billet**: Tapered steel bar with hot emissive orange-red gradient (`#ff4500` to `#ffaa00`).
  - **Stone Forge & Hearth** (`name = 'theron_forge'`): Curved stone masonry basin, pulsing charcoal embers (`#ff3300`), stone chimney flue.
  - **Slack Quenching Barrel**: Wooden staves, metal hoops, and water plane.

- [ ] **Step 3: Implement Spark Particle VFX & Rhythmic Hammer Strike Loop**
  - 10 recycled spark meshes (`THREE.InstancedMesh` or pooled small tetrahedrons) bursting outward on hammer contact.
  - Arm swings upward smoothly over 0.7s, pauses at strike apex for 0.12s, accelerates down to strike anvil at 0.9s.
  - On strike contact:
    - Billet flashes emissive white/orange.
    - Sparks burst radially outward with randomized velocities and gravity decay.
    - Torso and head have subtle reaction micro-recoil.

- [ ] **Step 4: Route `createTownsperson('blacksmith')` to `createTheronBlacksmith()`**
  - Keep `createTownsperson('blacksmith')` returning `createTheronBlacksmith()`.

- [ ] **Step 5: Run tests to verify all pass**

Run: `npm.cmd test`
Expected: PASS on all 9 test suites.

- [ ] **Step 6: Run production build verification**

Run: `npm.cmd run build`
Expected: Zero build errors, clean Vite bundle output.

---

### Task 3: In-Game Verification & Visual Evidence Capture

**Files:**
- Modify: `walkthrough.md`
- Output: Browser screenshots of Theron & Forge in Solstice Haven

- [ ] **Step 1: Restart Vite Dev Server daemon if not running**

Run: `npm.cmd run dev` in background if required.

- [ ] **Step 2: Dispatch Browser subagent to capture high-resolution close-up of Theron & Forge Station**
  - Navigate to `http://localhost:5173`.
  - Walk the player forward toward the blacksmith forge area at $(-8.5, -5.5)$.
  - Orbit camera to frame Theron striking the anvil with sparks flying and the glowing forge hearth beside him.
  - Verify interaction prompt `[F] Talk to Theron the Smith` displays cleanly.
  - Capture screenshot to artifact directory.

- [ ] **Step 3: Record walkthrough evidence**
  - Update `walkthrough.md` with visual comparison and confirmation of tests.

- [ ] **Step 4: Commit changes to Git & Push to remote**
  - Git commit: `feat: overhaul Theron the Blacksmith with stylized anatomy, forge station, and hammer animation`.
  - Push to `origin/main` to trigger live Vercel deployment.
