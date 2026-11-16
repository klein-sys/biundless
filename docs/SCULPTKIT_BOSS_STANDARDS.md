# Boss-Tier Procedural Sculpting Standard & Architecture (`SculptKit`)

## 1. Core Philosophy: Why Boss-Tier Standards Matter
In **Ashen Tangent**, hero bosses (Vespera the Witch, Malakor the Lich, Vaelorath the Astral Dragon) set the visual benchmark for quality, motion, and artistic presence. Rather than relying on primitive box-and-sphere "peg-doll" assemblies or external heavyweight 3D meshes that increase bundle size and load times, all characters, monuments, and major architectural features are procedurally sculpted directly via the **`SculptKit`** engine.

This document serves as the permanent `/learn` engineering standard for creating and overhauling all models in the game (NPCs, enemies, bosses, structures, and environments).

---

## 2. The Five Pillars of `SculptKit`

### 2.1 Pillar 1: Spline-Swept Anatomies (`sweepGeometry`)
Never stack raw unadorned cylinders or boxes for organic anatomy, horns, hair, robes, or architectural arches.

- **Catmull-Rom Splines**: Define continuous 3D trajectories through control points using smooth Catmull-Rom interpolation (`THREE.CatmullRomCurve3`).
- **Parallel-Transport Framing**: Use parallel-transport reference frames seeded from a designated `up` vector so cross-sections never twist or flip abruptly along the path.
- **Variable Radial Functions**: Modulate cross-sectional radius along path parameter \(t \in [0, 1]\) and polar angle \(a\).
- **Elliptical Scaling**: Use `scaleX(t)` and `scaleY(t)` to produce flattened cloth ribbons, wide shoulder capes, tapered blade edges, or aerodynamic horns.
- **Smoothstep Keyframe Interpolation (`lerpKeys`)**: Interpolate radius and contour keys using cubic Hermite smoothstep \(s = u^2(3 - 2u)\) for continuous \(C^1\) curvature.

```typescript
import { sweepGeometry, lerpKeys, v3 } from './SculptKit';

// Example: Sculpting an organic flowing horn or architectural vault rib
const ribPoints = [
  v3(0, 0, 0),
  v3(0.4, 1.2, 0.2),
  v3(0.9, 2.4, 0.1),
  v3(1.4, 3.6, -0.2),
  v3(1.6, 4.8, -0.6)
];

const ribGeo = sweepGeometry(ribPoints, 16, {
  radial: 10,
  radius: (t) => lerpKeys([[0, 0.35], [0.4, 0.28], [0.8, 0.16], [1.0, 0.04]], t),
  scaleX: (t) => lerpKeys([[0, 1.0], [0.5, 0.85], [1.0, 0.6]], t),
  scaleY: (t) => 1.0,
  capStart: true,
  capEnd: true
});
```

---

### 2.2 Pillar 2: In-Memory Procedural Textures (`PixelCanvas`)
External image assets add network latency and risk HTTP 404s. Canvas elements (`HTMLCanvasElement`) fail in headless Vitest/Node environments.
`SculptKit.PixelCanvas` generates high-resolution procedural textures directly into plain `Uint8Array` RGBA buffers:

- **100% Headless Test Compatibility**: Runs seamlessly in both browser WebGL and Node.js testing environments without requiring DOM canvas mocks.
- **Procedural Tone Bands & Heraldry**: Generate smooth value noise (`valueNoise`), ashlar masonry mortar lines, wood grain, gold embroidery hems, and iris gradients.
- **Anti-Aliased Shading**: Utilizes soft-edged pixel rasterization (`ellipse`, `line`, `blend`) to paint high-fidelity details.

```typescript
import { PixelCanvas, hexRgb, valueNoise } from './SculptKit';
import * as THREE from 'three';

export function createProceduralStoneTexture(): THREE.DataTexture {
  const canvas = new PixelCanvas(256, 256, [140, 134, 126]);
  canvas.shade((u, v) => {
    const stoneNoise = valueNoise(u * 16, v * 16) * 22;
    const mortarH = Math.sin(v * Math.PI * 12) > 0.94 ? -45 : 0;
    const mortarV = Math.sin((u + Math.floor(v * 6) * 0.5) * Math.PI * 8) > 0.94 ? -45 : 0;
    const shade = Math.max(0, Math.min(255, 140 + stoneNoise + mortarH + mortarV));
    return [shade, shade * 0.96, shade * 0.9];
  });

  const tex = new THREE.DataTexture(canvas.data, 256, 256, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
```

---

### 2.3 Pillar 3: Static Draw-Call Baking (`mergeStaticMeshes`)
Performance on mobile and integrated GPUs degrades rapidly when an entity contains dozens of separate small meshes.
- All non-animated sub-meshes sharing a common material are automatically transformed into world/container space and merged via `BufferGeometryUtils.mergeGeometries`.
- Keeps complex structures (like castle gatehouses or the town fountain) strictly under **25 draw calls** while maintaining an economical budget under **3,500 triangles** per modular section.

```typescript
import { mergeStaticMeshes } from './SculptKit';

// Call at the completion of structure building
mergeStaticMeshes(containerGroup);
```

---

### 2.4 Pillar 4: Analytic Two-Bone IK (`solveTwoBoneArm`)
Articulated character limbs (arms, legs, wings, tentacles) must bend naturally toward elbow/knee pole vectors rather than spinning on simplistic single-axis rotations:

- **Analytic Law of Cosines**: Solves exact joint angles given shoulder/hip, target hand/foot, upper length, fore length, and pole vector.
- **Clamped Stretch**: Protects against hyperbolic singularities when targets exceed reachable limb extension.
- **Segment Alignment**: Uses `alignSegmentDown` to orient visual meshes along the computed bone vectors.

---

### 2.5 Pillar 5: Resilient State-Driven Secondary Motion (`approach`)
Animations must never stutter, snap, or blow up under hostile delta times:

- **Exponential Approach**: Always smooth transitions with `approach(current, target, rate, dt)` (form: \(1 - e^{-\text{rate} \cdot dt}\)) rather than naive linear interpolation `lerp(a, b, factor)`.
- **Phase Accumulators**: Advance periodic animations (cloth flutter, breathing sway, water ripples, flame flickers) using continuous time accumulators:
  ```typescript
  phase += dt * frequency;
  const sway = Math.sin(phase) * amplitude;
  ```

---

## 3. World Architecture & Model Application Matrix

| Element | Technique | Key Visual Signature |
| :--- | :--- | :--- |
| **Castle Town Wall** | Battered spline sweep + corbel brackets + `mergeStaticMeshes` | Imposing stone curtain enclosing Solstice Haven, crenelated battlements, arrow slits. |
| **Corner Bastion Towers** | Cylindrical ashlar body + machicolated overhang + conical slate roof | Fortified watchtowers, fluttering silk banner pennants, brass apex finials. |
| **Gatehouses** | Vaulted barrel arch + portcullis grille + heraldic relief medallion | Wide accessible passages (South & North), glowing lantern sconces. |
| **Town Fountain** | Triple sculpted stone basins + Astrological Water Naiad + dynamic vertex ripples | Continuous water cascade, foam splash rings, animated vertex ripples. |
| **Lantern Posts** | Fluted octagonal plinth + scrollwork wrought-iron arch + beveled stained glass cage | Flickering amber candle flame, cast warm point light. |
| **Hero NPCs (Aurelius, Theron, Lyra, Eldrin)** | Swept robes / aprons + procedural faces + analytic IK gestures | Expressive postures, tool/scroll accessories, breathing sway, reactive gaze. |

---

## 4. Verification Discipline Checklist
Before any new model or structure overhaul is committed:
1. **Tri-Count Audit**: Inspect total vertices and ensure triangles are strictly under budget (<3,500 tris per modular section).
2. **Terrain Grounding**: Ensure the base sits flush on `getTerrainHeight(x, z)` without mid-air floating gaps.
3. **Headless Tests**: Run `npm test` to verify `PixelCanvas` and geometries execute without DOM dependencies.
4. **Build Check**: Run `npm run build` to confirm zero TypeScript compilation errors.
5. **Browser Audit**: Open game in browser and inspect visually from multiple camera angles.
6. **Remote Deployment**: Commit and push immediately to `origin/main` per `AGENTS.md` Rule 1.
