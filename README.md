# ASHEN TANGENT — Chronicles of the Derivative

**MATH 101 – Differential Calculus Semestral Project**  
*Designing Digital Worlds Through Differential Calculus*

**ASHEN TANGENT** is a playable 3D Dark Fantasy Action RPG web game built with **Three.js (r187)**, **TypeScript**, and **Vite** for both **desktop** and **mobile** browsers.

---

## Integration of Differential Calculus (Basic Trigonometric Derivatives)

Rather than an unrelated quiz popup, all **six basic trigonometric derivatives** govern real-time boss barriers, spell velocities, dive trajectories, and counter-attack mechanics:

| Boss | Active Wave $f(\theta)$ | Derivative Counter $f'(\theta)$ | Gameplay & Strategic Effect |
| :--- | :--- | :--- | :--- |
| **Vespera, Witch of the Sine Hollow** | $\sin\theta$, $\cos\theta$ | $\cos\theta$, $-\sin\theta$ | Shatter Phase Wards on match; striking at critical points ($f'(\theta) \approx 0$) triggers **5.0× Critical Stagger**. |
| **Malakor, Lich of the Asymptote Crypt** | $\tan\theta$, $\cot\theta$ | $\sec^2\theta$, $-\csc^2\theta$ | Soul-beam sweep speed scales with $|f'(\theta)|$; read $\theta$ to counter before vertical asymptote eruptions. |
| **Vaelorath, Wyrm of the Hyperbolic Abyss** | $\sec\theta$, $\csc\theta$ | $\sec\theta\tan\theta$, $-\csc\theta\cot\theta$ | Aerial dive arcs follow hyperbolic curves; switch to **1st-Person POV** to ground the dragon with matching Resonance Shots. |

- **Exact Match**: Shatters boss Phase Ward, deals **3.0×–5.0×** Resonance Damage, and inflicts heavy Stagger.
- **Mismatch**: Deflected to **0.25×** damage and triggers a dodgeable **Arcane Backlash** shockwave.
- **Basic Blade Strikes**: Always deal reliable physical chip damage.

---

## Features

- **3rd-Person ↔ 1st-Person POV Toggle**: Over-the-shoulder orbit with target lock-on and smooth switching (`V` key / HUD button) to 1st-person Astrolabe view with Tangent Reticle.
- **Ruined Sanctuary Hub + 3 Boss Fog Gates**: Explore the sanctuary and walk into any Fog Gate (`F` / `GATE`), or warp directly via the Boss Menu / Dev Drawer.
- **Desktop & Mobile Web Controls**:
  - **Desktop**: `WASD` Move · Mouse Look · `LMB` Strike · `RMB`/`E` Cast Derivative Sigil · `1–6` / Scroll Select Sigil · `Q` Slow-Mo Radial Wheel · `Space`/`Shift` Dodge · `R` Heal Flask · `V` POV · `Tab` Lock-On · `F9` Dev Drawer · `Esc` Settings.
  - **Mobile**: Virtual Left Thumbstick · Right-Side Drag Look · Tactile Action Buttons · Slow-Mo Radial Sigil Wheel.
- **Graphics & FPS Controls**: `Low` / `Medium` / `High` / `Ultra` presets and `30` / `60` / `120` / `Unlimited` FPS caps persisted to `localStorage`.
- **Dev & MATH 101 Class Demo Drawer (`DEV` / `F9`)**: Boss warp, God Mode, Infinite Stamina, Freeze $\theta$, live telemetry ($f(\theta)$, exact vs. numeric $f'(\theta)$, FPS, draw calls), and a **Worked Example Presentation Overlay**.

---

## Development & Testing

```bash
npm install
npm test        # Vitest unit tests (calculus, combat, boss AI, input, settings)
npm run build   # TypeScript type-check + Vite production build
npm run dev     # Start local Vite dev server
```
