# Ashen Tangent — Development Guidelines & Workspace Rules

## 1. Remote Push & Vercel Deployment Discipline
- After completing and verifying any task, feature, or model overhaul (with passing `npm test` and `npm run build`), commit and push to `origin/main` immediately for standard maintenance. Follow the separate release rule for the visual overhaul.
- The user actively tests and previews changes on Vercel; never stop after local edits without pushing to the remote repository.
- Publish verified visual-overhaul passes on codex/kenney-visual-overhaul as Vercel previews. Merge into production only with the user's approval.

## 2. 3D Character & Prop Modeling Invariants
- **No Primitive Peg-Dolls**: Avoid raw, unadorned box-and-sphere primitive stacking for characters and major structures.
- **Stylized Techniques**:
  - Use `CanvasTexture` for expressive eyes, brows, facial details, and embroidered heraldry.
  - Use smooth curves (`CatmullRomCurve3` / `TubeGeometry` / `ExtrudeGeometry`) for flowing hair locks, cloaks, bows, and horns.
  - Employ cel-shaded tone bands and subtle outlines to make multi-part meshes read as single cohesive hand-drawn illustrations.
  - When importing `.glb` assets, bundle them strictly within `public/models/` for zero-latency local serving.
- **Grounding & Performance**: Characters and props must sit flush on terrain/plinth surfaces (no mid-air floating gaps) and adhere to mobile-friendly triangle budgets (<3,500 tris per NPC/structure).

### 2.1 Boss-Tier Procedural Sculpting Standard (`SculptKit` Pipeline)
Use SculptKit for custom hero NPCs, townsfolk, monuments, major architecture, and guardians. Approved imported parts and character bases may be used in the storybook art direction. Preserve role-specific silhouettes, the existing gameplay rigs, and the model budgets for both imported and procedural assets.
1. **Spline-Swept Anatomies (`sweepGeometry`)**:
   - Never stack raw primitive cylinders/boxes for organic anatomy, robes, flowing hair, horns, or architectural arches.
   - Use Catmull-Rom splines with variable radial functions, elliptical scaling (`scaleX`, `scaleY`), and parallel-transport frames for organic contours and draped cloth.
2. **In-Memory Procedural Textures (`PixelCanvas`)**:
   - Paint high-resolution tone bands, embroidered hems, runes, and facial features directly into in-memory `THREE.DataTexture` via `PixelCanvas`.
   - Maintain 100% headless test compatibility (zero DOM / zero HTMLCanvasElement dependencies).
3. **Static Draw-Call Baking (`mergeStaticMeshes`)**:
   - Automatically bake non-animated sub-meshes per material to keep total draw calls <25 per complex structure/entity while staying strictly under 3,500 triangles.
4. **Analytic Two-Bone IK & Articulated Rigs (`solveTwoBoneArm`)**:
   - Use analytic two-bone IK for articulated limbs (arms, legs, wings) with natural joint bending rather than rigid single-axis rotations.
5. **Phase-Driven / State-Driven Secondary Motion (`animate(dt, ctx)`)**:
   - Animate cloth flutter, breathing sway, gaze scanning, and reactive idle windups using closed-form time accumulation (`lerpKeys`, `approach`) resilient to hostile or erratic delta times.

## 3. Verification Before Claims
- Always run automated unit tests (`npm test`), production build verification (`npm run build`), and browser visual confirmation before claiming a task or model is ready.
