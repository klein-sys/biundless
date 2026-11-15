# Model 2: Archmage Aurelius & The Astrolabe Gazebo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the Astrolabe Gazebo to eliminate the floating severed dome gap and add fluted columns, structural entablature, and a ribbed celestial dome; overhaul Archmage Aurelius from a primitive cone/barrel collar into a high-detail stylized elder sage with pleated astral robes, braided beard, ornate hat, and armillary starwood staff.

**Architecture:** Redesign `createAstrolabeGazebo()` and `createArchmageAurelius()` in `src/engine/ProceduralModels.ts` using composite Three.js geometry (<3,500 triangles total) and stylized cel-shaded standard materials. Ensure full backward compatibility with `createSolsticeHavenVillage()` and the existing dialogue interaction (`[F] Talk to Archmage Aurelius`).

**Tech Stack:** Three.js, TypeScript, Vitest, Vite

**Spec:** [docs/superpowers/specs/2026-11-15-archmage-aurelius-gazebo-design.md](file:///c:/Users/JAMES/Downloads/new%20game/docs/superpowers/specs/2026-11-15-archmage-aurelius-gazebo-design.md)

## Global Constraints
- Target budget: under 3,500 triangles total for Gazebo and Aurelius combined.
- Zero external glTF/GLB downloads; 100% offline procedural Three.js geometry.
- Dome must sit completely flush on the entablature ring ($y = 4.25\text{m}$) without any mid-air floating gap.
- Backward compatibility for `interactiveNpcs` interface (`id: 'aurelius'`, interaction radius $4.8\text{m}$).

## Review Focus
1. **Gazebo dome elevation**: Bottom rim of the dome must sit flush on top of the entablature beam ring without clipping or gap.
2. **Column capitals & bases**: All 8 pillars must have sculpted pedestal bases resting on the plinth and capitals supporting the architrave.
3. **Aurelius silhouette**: Robes must touch the plinth floor gracefully, eliminating the oversized raw gold cylinder collar in favor of an embroidered shoulder cowl.
4. **Staff and orrery animation**: Multi-ring rotation and staff crystal floating cycle must advance smoothly with variable `dt`.
5. **No regression on village layout**: Paving radius, plinth collision, and interaction radius must remain intact.

---

### Task 1: Add Unit Tests for Gazebo and Aurelius Model Rigs

**Files:**
- Modify: `tests/astrolabeAndModels.test.ts`

**Interfaces:**
- Consumes: `createAstrolabeGazebo`, `createArchmageAurelius` from `src/engine/ProceduralModels.ts`
- Produces: Verified unit tests for Gazebo structural parts (`gazebo_dome`, `gazebo_entablature`, `gazebo_orrery`) and Aurelius character parts (`aurelius_robe`, `aurelius_beard`, `aurelius_staff`, `aurelius_hat`).

- [ ] **Step 1: Write the failing unit tests in `tests/astrolabeAndModels.test.ts`**

```typescript
describe('Archmage Aurelius & Astrolabe Gazebo Models', () => {
  it('creates an integrated Astrolabe Gazebo with flush dome, entablature, and central orrery', () => {
    const gazebo = createAstrolabeGazebo();
    expect(gazebo.group).toBeInstanceOf(THREE.Group);

    let foundDome = false;
    let foundEntablature = false;
    let foundOrrery = false;

    gazebo.group.traverse((child) => {
      if (child.name === 'gazebo_dome') foundDome = true;
      if (child.name === 'gazebo_entablature') foundEntablature = true;
      if (child.name === 'gazebo_orrery') foundOrrery = true;
    });

    expect(foundDome).toBe(true);
    expect(foundEntablature).toBe(true);
    expect(foundOrrery).toBe(true);
  });

  it('creates an articulated Archmage Aurelius rig with pleated robes, braided beard, and armillary staff', () => {
    const aurelius = createArchmageAurelius();
    expect(aurelius.group).toBeInstanceOf(THREE.Group);

    let foundBeard = false;
    let foundStaff = false;
    let foundHat = false;

    aurelius.group.traverse((child) => {
      if (child.name === 'aurelius_beard') foundBeard = true;
      if (child.name === 'aurelius_staff') foundStaff = true;
      if (child.name === 'aurelius_hat') foundHat = true;
    });

    expect(foundBeard).toBe(true);
    expect(foundStaff).toBe(true);
    expect(foundHat).toBe(true);
  });

  it('updates gazebo orrery and aurelius staff animations without throwing', () => {
    const gazebo = createAstrolabeGazebo();
    const aurelius = createArchmageAurelius();

    expect(() => {
      gazebo.update(0.016);
      gazebo.update(0.5);
      aurelius.update(0.016);
      aurelius.update(0.5);
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/astrolabeAndModels.test.ts`
Expected: FAIL on missing named child parts (`gazebo_dome`, `gazebo_entablature`, `gazebo_orrery`, etc.).

---

### Task 2: Implement Overhauled Astrolabe Gazebo & Archmage Aurelius

**Files:**
- Modify: `src/engine/ProceduralModels.ts:1903-2087`

**Interfaces:**
- Consumes: `THREE.Group`, `THREE.MeshStandardMaterial`, `THREE.TorusGeometry`, `THREE.CylinderGeometry`, etc.
- Produces:
  - `export function createAstrolabeGazebo(): { group: THREE.Group; update: (dt: number) => void }`
  - `export function createArchmageAurelius(): { group: THREE.Group; update: (dt: number) => void }`

- [ ] **Step 1: Re-architect `createAstrolabeGazebo()`**
  - Two-tiered circular marble plinth with brass ring inlay.
  - 8 Fluted classical columns with molded bases and gold Corinthian capitals.
  - Entablature beam ring (`name = 'gazebo_entablature'`) at $y = 4.25\text{m}$.
  - Seamless ribbed dome (`name = 'gazebo_dome'`) resting flush on the entablature from $y = 4.25\text{m}$ to $y = 6.2\text{m}$ with 8 radial gold ribs.
  - Astrolabe weather finial tower ($y = 6.2\text{m} \to 7.3\text{m}$) with interlocking celestial rings.
  - Central orrery (`name = 'gazebo_orrery'`) with 3 spinning brass rings and pulsing star core.

- [ ] **Step 2: Re-architect `createArchmageAurelius()`**
  - Pleated midnight-indigo robes with gold star embroidery border.
  - Embroidered shoulder mantle and cowl with celestial glyph trim (replacing the raw cylinder).
  - Elder head with flowing silver hair and braided beard (`name = 'aurelius_beard'`) with gold arcane rings.
  - Curved pointed wizard hat (`name = 'aurelius_hat'`) with broad brim and crescent brooch.
  - Starwood armillary staff (`name = 'aurelius_staff'`) with spiral gold vines and floating oscillating focus crystal.
  - Multi-part update loop with breathing, crystal floating, and hand gesture animation.

- [ ] **Step 3: Run tests to verify all pass**

Run: `npm.cmd test`
Expected: PASS on all 9 test suites.

- [ ] **Step 4: Run production build verification**

Run: `npm.cmd run build`
Expected: Zero build errors, clean Vite bundle output.

---

### Task 3: In-Game Verification, Browser Screenshot Evidence & Git Push

**Files:**
- Modify: `walkthrough.md`
- Output: Browser screenshots of Gazebo & Aurelius in Solstice Haven

- [ ] **Step 1: Check Vite Dev Server status**

Ensure `npm.cmd run dev` is active on port 5173.

- [ ] **Step 2: Dispatch Browser subagent to capture close-up of Gazebo & Aurelius**
  - Navigate to `http://localhost:5173`.
  - Enter Sunlit Valley.
  - Orbit camera toward the center Gazebo and Archmage Aurelius.
  - Verify dome sits flush with no gaps.
  - Verify Aurelius's detailed robes, silver hair/beard, hat, and staff.
  - Verify interaction prompt `[F] Talk to Archmage Aurelius`.
  - Capture screenshot to artifact directory.

- [ ] **Step 3: Record walkthrough evidence**
  - Update `walkthrough.md` with visual comparison and confirmation of tests.

- [ ] **Step 4: Commit changes to Git & Push to remote**
  - Git commit: `feat: overhaul Archmage Aurelius and Astrolabe Gazebo with seamless classical dome and stylized elder sage rig`.
  - Push to `origin/main` to trigger live Vercel deployment.
