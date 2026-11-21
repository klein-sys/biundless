# ASHEN TANGENT — Chronicles of the Derivative

**MATH 101 – Differential Calculus Semestral Project**  
*Designing Digital Worlds Through Differential Calculus*

**Ashen Tangent** is a colorful 3D fantasy action RPG where trigonometric derivatives power your spells. Explore Sunlit Valley, recover three relics from its guardians, and restore the Celestial Astrolabe that protects Solstice Haven. The game runs in desktop and mobile browsers and is built with **Three.js (r187)**, **TypeScript**, and **Vite**.

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
- **Solstice Haven + Three Guardian Encounters**: Meet the townsfolk in Solstice Haven, then travel to Whispering Glade, the Sunken Sun-Ruins, and Skyridge Peak to recover the relics.
- **Desktop & Mobile Web Controls**:
  - **Desktop**: `WASD` Move · Mouse Look · `LMB` Strike · `RMB`/`E` Cast · `1–6` / Scroll Select Sigil · `Q` Open Sigils · `G` Equip Match (Guided math) · `Space` Jump · `Ctrl`/`C` Dodge · `R` Heal · `F` Interact · `Esc` Menu.
  - **Mobile**: Left thumbstick to move · Right-side drag to look · Tap Sigils, Equip, and Cast.
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

