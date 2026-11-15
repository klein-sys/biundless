# Ashen Tangent — Development Guidelines & Workspace Rules

## 1. Remote Push & Vercel Deployment Discipline
- After completing and verifying any task, feature, or model overhaul (with passing `npm test` and `npm run build`), **always commit and push to `origin/main` immediately**.
- The user actively tests and previews changes on Vercel; never stop after local edits without pushing to the remote repository.

## 2. 3D Character & Prop Modeling Invariants
- **No Primitive Peg-Dolls**: Avoid raw, unadorned box-and-sphere primitive stacking for characters and major structures.
- **Stylized Techniques**:
  - Use `CanvasTexture` for expressive eyes, brows, facial details, and embroidered heraldry.
  - Use smooth curves (`CatmullRomCurve3` / `TubeGeometry` / `ExtrudeGeometry`) for flowing hair locks, cloaks, bows, and horns.
  - Employ cel-shaded tone bands and subtle outlines to make multi-part meshes read as single cohesive hand-drawn illustrations.
  - When importing `.glb` assets, bundle them strictly within `public/models/` for zero-latency local serving.
- **Grounding & Performance**: Characters and props must sit flush on terrain/plinth surfaces (no mid-air floating gaps) and adhere to mobile-friendly triangle budgets (<3,500 tris per NPC/structure).

## 3. Verification Before Claims
- Always run automated unit tests (`npm test`), production build verification (`npm run build`), and browser visual confirmation before claiming a task or model is ready.
