import * as THREE from 'three';
import type { BossPhase } from '../bosses/bossAI';
import { BOSS_CONFIGS, type BossConfig, type BossId } from '../bosses/bossDefinitions';
import {
  PixelCanvas,
  alignSegmentDown,
  approach,
  computeSafeNormals,
  hash2,
  lerpKeys,
  loopTube,
  mergeStaticMeshes,
  mixRgb,
  scaleRgb,
  solveTwoBoneArm,
  sweepGeometry,
  taperTube,
  v3,
  valueNoise,
  type RGB,
} from './SculptKit';
import { createWardShellMaterial } from './Shaders';

/**
 * Boss Models — sculpted procedural hero models for Vespera, Malakor and Vaelorath.
 *
 * Bodies are swept along splines (variable radius, elliptical cross-sections, vertex-coloured
 * bellies), surfaces use painted pixel textures, static parts are baked per material, and each
 * boss exposes `animate()` for phase-driven secondary motion (casting arms, jaws, flames, veils).
 */

export interface BossAnimContext {
  /** Monotonic seconds. */
  readonly time: number;
  readonly phase: BossPhase;
  readonly theta: number;
  /** |f′(θ)| of the active wave, used to intensify effects. */
  readonly slope: number;
}

export interface BossRig {
  readonly root: THREE.Group;
  readonly bodyGroup: THREE.Group;
  readonly wardMesh: THREE.Mesh;
  readonly wardMat: THREE.ShaderMaterial;
  readonly orbitParts: THREE.Object3D[];
  readonly wingLeft?: THREE.Object3D;
  readonly wingRight?: THREE.Object3D;
  readonly tailSegments?: THREE.Object3D[];
  readonly neckSegments?: THREE.Object3D[];
  readonly veilRibbons?: THREE.Object3D[];
  readonly coreMesh: THREE.Mesh;
  /** Phase-driven secondary animation; call every frame after the engine drives the rig. */
  readonly animate: (dt: number, ctx: BossAnimContext) => void;
}

interface BossBuild {
  readonly coreMesh: THREE.Mesh;
  readonly orbitParts: THREE.Object3D[];
  readonly veilRibbons?: THREE.Object3D[];
  readonly wingLeft?: THREE.Object3D;
  readonly wingRight?: THREE.Object3D;
  readonly tailSegments?: THREE.Object3D[];
  readonly neckSegments?: THREE.Object3D[];
  readonly animate: (dt: number, ctx: BossAnimContext) => void;
}

const Z_UP = v3(0, 0, 1);
const Y_UP = v3(0, 1, 0);

function addMesh(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  castShadow = false
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = castShadow;
  parent.add(mesh);
  return mesh;
}

const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

const smooth01 = (x: number) => {
  const k = THREE.MathUtils.clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
};

// =============================================================================================
// Painted textures (cached, DOM-free)
// =============================================================================================

interface WitchTextures {
  gown: THREE.DataTexture;
  gownGlow: THREE.DataTexture;
  stars: THREE.DataTexture;
  face: THREE.DataTexture;
  faceGlow: THREE.DataTexture;
}
let witchTextures: WitchTextures | null = null;

function getWitchTextures(): WitchTextures {
  if (witchTextures) return witchTextures;

  // Gown: x = height (0 hem → 1 waist), y = around. Midnight silk, star dust, and two embroidered
  // bands that trace sin(θ) and its derivative cos(θ) around the hem.
  const GW = 256;
  const GH = 512;
  const gown = new PixelCanvas(GW, GH);
  const gownGlow = new PixelCanvas(GW, GH);
  const HEM: RGB = [14, 20, 66];
  const MID: RGB = [40, 60, 146];
  const WAIST: RGB = [24, 34, 100];
  gown.shade((u, v) => {
    const a = v * Math.PI * 2;
    const grad = u < 0.5 ? mixRgb(HEM, MID, u / 0.5) : mixRgb(MID, WAIST, (u - 0.5) / 0.5);
    const fold = 0.84 + 0.16 * Math.sin(8 * a) * Math.pow(1 - u, 1.1) + (valueNoise(v * 32, u * 5, 32) - 0.5) * 0.12;
    return scaleRgb(grad, fold);
  });
  for (let i = 0; i < 900; i++) {
    const u = Math.pow(hash2(i, 7), 1.7);
    const v = hash2(i, 13);
    const s = 0.5 + hash2(i, 21) * 1.1;
    gown.ellipse(u * GW, v * GH, s, s, [215, 232, 255], 0.35 + 0.6 * (1 - u), 0.8);
    gownGlow.ellipse(u * GW, v * GH, s, s, [110, 165, 235], 0.75 * (1 - u), 0.8);
  }
  const band = (u0: number, amp: number, phase: number, width: number, col: RGB, glowCol: RGB) => {
    const f = (s: number): [number, number] => [(u0 + amp * Math.sin(16 * Math.PI * 2 * s + phase)) * GW, s * GH];
    gown.curve(f, 900, width, col);
    gownGlow.curve(f, 900, width, glowCol);
  };
  band(0.17, 0.032, 0, 2.4, [205, 230, 255], [120, 200, 255]); // sin(θ)
  band(0.09, 0.022, Math.PI / 2, 1.8, [245, 214, 140], [200, 150, 70]); // cos(θ) = d/dθ sin(θ)
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < 7; x++) {
      gownGlow.blend(x, y, [110, 190, 255], 1 - x / 7);
      gown.blend(x, y, [150, 205, 255], 0.8 - x / 9);
    }
  }

  // Underskirt starfield (emissive): a night sky glimpsed inside the gown.
  const stars = new PixelCanvas(256, 256, [2, 3, 12]);
  for (let i = 0; i < 520; i++) {
    const s = 0.5 + hash2(i, 3) * 1.4;
    const col: RGB = hash2(i, 5) > 0.7 ? [150, 200, 255] : [235, 240, 255];
    stars.ellipse(hash2(i, 1) * 256, hash2(i, 2) * 256, s, s, col, 0.6 + hash2(i, 4) * 0.4, 0.8);
  }

  // Face (equirectangular on a sphere: front of face at u = 0.25, equator at v = 0.5).
  // 512×256 gives square texels on the head, so features keep their proportions.
  const face = new PixelCanvas(512, 256, [240, 243, 251]);
  const faceGlow = new PixelCanvas(512, 256, [0, 0, 0]);
  const FX = 128;
  face.shade((u, v) => {
    const side = Math.abs(u - 0.25);
    return scaleRgb([240, 243, 251], 1 - Math.min(0.06, side * 0.12) - Math.max(0, 0.42 - v) * 0.05);
  });
  for (const side of [-1, 1]) {
    const ex = FX + side * 21;
    const ey = 134;
    face.ellipse(FX + side * 30, 113, 9, 5, [243, 196, 214], 0.5, 4); // blush
    face.ellipse(ex, ey, 11.5, 5.4, [250, 252, 255], 1, 1); // sclera
    face.ellipse(ex + side * 0.6, ey - 0.2, 5.4, 5.4, [44, 112, 210], 1, 0.8); // iris rim
    face.ellipse(ex + side * 0.6, ey + 0.2, 3.8, 3.9, [150, 214, 255], 1, 0.8); // iris
    face.ellipse(ex + side * 0.6, ey, 1.2, 2.6, [16, 28, 72], 1, 0.6); // slit pupil
    face.ellipse(ex - 1.8, ey + 2, 1.3, 1.3, [255, 255, 255], 1, 0.5); // catchlight
    faceGlow.ellipse(ex + side * 0.6, ey, 5, 5, [70, 160, 255], 1, 1.2);
    faceGlow.ellipse(ex - 1.8, ey + 2, 1.2, 1.2, [200, 230, 255], 1, 0.5);
    face.curve(
      (s) => {
        const k = s * 2 - 1;
        return [ex + k * 12.5, ey + 5.8 * Math.sqrt(Math.max(0, 1 - k * k)) + 0.7];
      },
      28,
      2.6,
      [24, 24, 56]
    ); // upper lash line
    face.line(ex + side * 12, ey + 1.4, ex + side * 17, ey + 4.6, 2.1, [24, 24, 56]); // winged liner
    face.curve(
      (s) => {
        const k = s * 2 - 1;
        return [ex + k * 10, ey - 4.8 * Math.sqrt(Math.max(0, 1 - k * k))];
      },
      16,
      1,
      [110, 110, 160],
      0.55
    );
    face.curve(
      (s) => {
        const k = s * 2 - 1;
        return [ex + k * 11 + side * 2, ey + 13.5 + 3.2 * (1 - k * k) - side * k * 1.4];
      },
      18,
      1.7,
      [148, 162, 214]
    ); // brows
  }
  face.line(FX, 122, FX + 1.4, 116, 1.1, [196, 192, 214], 0.7); // nose
  face.ellipse(FX, 104.5, 6.6, 2.2, [146, 74, 150], 0.95, 1); // lips
  face.ellipse(FX, 105.6, 4.2, 0.8, [196, 128, 196], 0.7, 0.8);
  const mark = (s: number): [number, number] => [FX + (s * 2 - 1) * 11, 156 + 2.6 * Math.sin((s * 2 - 1) * Math.PI * 2)];
  face.curve(mark, 32, 1.5, [110, 182, 255]); // forehead sine sigil
  faceGlow.curve(mark, 32, 1.8, [90, 175, 255]);
  face.ellipse(FX, 161.5, 1.7, 1.7, [150, 210, 255], 1, 0.6);
  faceGlow.ellipse(FX, 161.5, 2, 2, [140, 205, 255], 1, 0.6);

  witchTextures = {
    gown: gown.toTexture(),
    gownGlow: gownGlow.toTexture(),
    stars: stars.toTexture(),
    face: face.toTexture(),
    faceGlow: faceGlow.toTexture(),
  };
  witchTextures.face.wrapT = THREE.ClampToEdgeWrapping;
  witchTextures.faceGlow.wrapT = THREE.ClampToEdgeWrapping;
  return witchTextures;
}

interface LichTextures {
  robe: THREE.DataTexture;
  robeGlow: THREE.DataTexture;
  stripes: THREE.DataTexture;
  tabard: THREE.DataTexture;
  collar: THREE.DataTexture;
  sandstone: THREE.DataTexture;
  sandstoneGlow: THREE.DataTexture;
}
let lichTextures: LichTextures | null = null;

function getLichTextures(): LichTextures {
  if (lichTextures) return lichTextures;
  const GOLD: RGB = [218, 178, 92];
  const GLYPH_GLOW: RGB = [56, 210, 150];

  // Robe: x = height, y = around. Grave-teal linen with vertical rot streaks and a gilded glyph
  // band of tan/cot curves between their asymptotes, eyes and ankhs.
  const RW = 256;
  const RH = 512;
  const robe = new PixelCanvas(RW, RH);
  const robeGlow = new PixelCanvas(RW, RH);
  robe.shade((u, v) => {
    const base = mixRgb([9, 22, 20], [24, 60, 52], Math.pow(u, 0.8));
    const streak = 0.72 + 0.4 * valueNoise(v * 48, u * 2.5, 48) + (valueNoise(v * 160, u * 9, 160) - 0.5) * 0.18;
    const fray = u < 0.08 ? 0.6 + u * 5 : 1;
    return scaleRgb(base, streak * fray);
  });
  const bandCenter = 0.2;
  const bandHalf = 0.055;
  const toPx = (gx: number, gy: number, cellY: number): [number, number] => [
    (bandCenter * RW) + gy,
    cellY + gx,
  ];
  for (let y = 0; y < RH; y++) {
    for (const edge of [-1, 1]) {
      const x = (bandCenter + edge * bandHalf) * RW;
      robe.line(x, y, x, y + 1, 2.4, GOLD);
    }
  }
  const CELLS = 16;
  for (let c = 0; c < CELLS; c++) {
    const cy = (c + 0.5) * (RH / CELLS);
    const stroke = (pts: (s: number) => [number, number], steps = 24) => {
      robe.curve((s) => toPx(...pts(s), cy), steps, 1.6, GOLD);
      robeGlow.curve((s) => toPx(...pts(s), cy), steps, 1.6, GLYPH_GLOW);
    };
    const kind = c % 4;
    if (kind === 0 || kind === 3) {
      // Asymptotes + tan (rising) or cot (falling) branch.
      stroke((s) => [-9, -9 + 18 * s], 2);
      stroke((s) => [9, -9 + 18 * s], 2);
      stroke((s) => {
        const gx = -8 + 16 * s;
        const k = (gx / 9) * (Math.PI / 2) * 0.92;
        const val = kind === 0 ? Math.tan(k) : -Math.tan(k);
        return [gx, THREE.MathUtils.clamp(val * 3.2, -9, 9)];
      }, 30);
    } else if (kind === 1) {
      // Eye of the ruin.
      stroke((s) => [Math.cos(s * Math.PI * 2) * 8, Math.sin(s * Math.PI * 2) * 4], 30);
      stroke((s) => [Math.cos(s * Math.PI * 2) * 2.2, Math.sin(s * Math.PI * 2) * 2.2], 12);
      stroke((s) => [-2 + s * 3, -4 - s * 5], 6);
    } else {
      // Ankh.
      stroke((s) => [Math.cos(s * Math.PI * 2) * 3.5, 4.5 + Math.sin(s * Math.PI * 2) * 4], 20);
      stroke((s) => [-7 + 14 * s, 0.5], 2);
      stroke((s) => [0, 0.5 - 10 * s], 2);
    }
  }
  for (let y = 0; y < RH; y += 1) {
    const x = 0.9 * RW + Math.sin((y / RH) * Math.PI * 2 * 24) * 3;
    robe.line(x, y, x, y + 1, 1.6, GOLD, 0.9);
    robeGlow.line(x, y, x, y + 1, 1.2, GLYPH_GLOW, 0.5);
  }

  // Nemes stripes along v: alternating gold and deep teal.
  const stripes = new PixelCanvas(64, 256).shade((_u, v) => {
    const p = (v * 14) % 1;
    const base: RGB = p < 0.5 ? [222, 176, 72] : [22, 94, 100];
    const edge = Math.min(p % 0.5, 0.5 - (p % 0.5)) < 0.04 ? 0.55 : 1;
    return scaleRgb(base, edge * (0.92 + 0.16 * (p % 0.5)));
  });
  // Tabard: same stripes rotated to run vertically.
  const tabard = new PixelCanvas(128, 256).shade((u, v) => {
    const p = (u * 7) % 1;
    const base: RGB = p < 0.5 ? [222, 176, 72] : [22, 94, 100];
    const edge = Math.min(p % 0.5, 0.5 - (p % 0.5)) < 0.05 ? 0.55 : 1;
    const hemBand = v < 0.08 || v > 0.94 ? 0.75 : 1;
    return scaleRgb(base, edge * hemBand);
  });

  // Usekh collar: concentric bands from the outer edge (v = 0) to the neck (v = 1).
  const collar = new PixelCanvas(256, 128).shade((u, v) => {
    const bands: [number, RGB][] = [
      [0.14, [222, 180, 80]],
      [0.3, [36, 172, 160]],
      [0.38, [222, 180, 80]],
      [0.56, [32, 62, 156]],
      [0.64, [222, 180, 80]],
      [0.8, [176, 68, 48]],
      [1.01, [222, 180, 80]],
    ];
    let col: RGB = bands[0][1];
    let prev = 0;
    for (const [end, c] of bands) {
      if (v < end) {
        col = c;
        const local = (v - prev) / (end - prev);
        if (local < 0.08 || local > 0.92) col = scaleRgb(col, 0.6);
        break;
      }
      prev = end;
    }
    // Bead rows inside the coloured bands.
    const bead = Math.abs(((u * 48) % 1) - 0.5) < 0.18 && v > 0.16 && v < 0.78 ? 1.12 : 1;
    return scaleRgb(col, bead);
  });

  // Sandstone with carved, softly glowing glyph cartouches (4 faces around u).
  const sandstone = new PixelCanvas(128, 256);
  const sandstoneGlow = new PixelCanvas(128, 256);
  sandstone.shade((u, v) => {
    const n = valueNoise(u * 24, v * 48, 24) * 0.6 + valueNoise(u * 96, v * 190, 96) * 0.4;
    const strata = 0.94 + 0.06 * Math.sin(v * 90 + n * 4);
    return scaleRgb([214, 178, 124], (0.82 + n * 0.3) * strata);
  });
  const CARVE: RGB = [118, 86, 52];
  for (let face = 0; face < 4; face++) {
    const cx = (face + 0.5) * 32;
    for (let k = 0; k < 5; k++) {
      const cy = 30 + k * 46;
      const carve = (f: (s: number) => [number, number], steps = 20) => {
        sandstone.curve(f, steps, 1.6, CARVE);
        sandstoneGlow.curve(f, steps, 1.6, GLYPH_GLOW);
      };
      const kind = (face + k) % 3;
      if (kind === 0) {
        carve((s) => [cx - 6 + 12 * s, cy + THREE.MathUtils.clamp(Math.tan((s * 2 - 1) * 1.35) * 2.5, -9, 9)], 24);
        carve((s) => [cx - 7, cy - 10 + 20 * s], 2);
        carve((s) => [cx + 7, cy - 10 + 20 * s], 2);
      } else if (kind === 1) {
        carve((s) => [cx + Math.cos(s * Math.PI * 2) * 7, cy + Math.sin(s * Math.PI * 2) * 4], 24);
        carve((s) => [cx + Math.cos(s * Math.PI * 2) * 2, cy + Math.sin(s * Math.PI * 2) * 2], 10);
      } else {
        carve((s) => [cx + Math.cos(s * Math.PI * 2) * 3, cy + 4 + Math.sin(s * Math.PI * 2) * 3.5], 16);
        carve((s) => [cx - 6 + 12 * s, cy], 2);
        carve((s) => [cx, cy - 9 * s], 2);
      }
    }
    // Cartouche frame
    sandstone.line(cx - 11, 8, cx - 11, 248, 1.4, CARVE, 0.8);
    sandstone.line(cx + 11, 8, cx + 11, 248, 1.4, CARVE, 0.8);
  }

  lichTextures = {
    robe: robe.toTexture(),
    robeGlow: robeGlow.toTexture(),
    stripes: stripes.toTexture(),
    tabard: tabard.toTexture(),
    collar: collar.toTexture(),
    sandstone: sandstone.toTexture(),
    sandstoneGlow: sandstoneGlow.toTexture(),
  };
  lichTextures.collar.wrapT = THREE.ClampToEdgeWrapping;
  return lichTextures;
}

let dragonScaleTexture: THREE.DataTexture | null = null;

/** Luminance-only scale + belly-plate pattern; colour comes from per-vertex body colours. */
function getDragonScaleTexture(): THREE.DataTexture {
  if (dragonScaleTexture) return dragonScaleTexture;
  const W = 256;
  const H = 512;
  const SX = 16;
  const SY = 16;
  const tex = new PixelCanvas(W, H).shade((_u, v, x, y) => {
    const row = Math.floor(y / SY);
    const ox = (row % 2) * (SX / 2);
    const col = Math.floor((x + ox) / SX);
    const lx = (((x + ox) % SX) / SX) - 0.35;
    const ly = ((y % SY) / SY) - 0.5;
    const d = Math.sqrt(lx * lx * 1.4 + ly * ly * 1.7) * 2;
    // Subtle scallops: a soft highlight per scale and a thin dark rim, so colour comes from the
    // body's vertex colours and the scales read as texture rather than polka dots.
    let s = 1.0 - 0.13 * Math.pow(Math.min(1, d), 2.2);
    if (d > 0.88) s *= 0.84;
    s *= 0.95 + hash2(col % (W / SX), row) * 0.1;
    const belly = 1 - smooth01((Math.abs(v - 0.5) - 0.09) / 0.04);
    const fx = (x % 32) / 32;
    let p = 0.88 + 0.12 * Math.sin(fx * Math.PI);
    if (fx < 0.08) p *= 0.62;
    const val = s * (1 - belly) + p * belly;
    return [238 * val, 232 * val, 220 * val];
  });
  dragonScaleTexture = tex.toTexture();
  return dragonScaleTexture;
}

// =============================================================================================
// Vespera — Astral Sylvan Witch (sin / cos)
// =============================================================================================

function buildWitch(body: THREE.Group, cfg: BossConfig): BossBuild {
  const accent = cfg.accentColor;
  const tex = getWitchTextures();

  const gownMat = new THREE.MeshStandardMaterial({
    map: tex.gown,
    emissiveMap: tex.gownGlow,
    emissive: 0xffffff,
    emissiveIntensity: 1.15,
    roughness: 0.5,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  const voidMat = new THREE.MeshStandardMaterial({
    color: 0x060a22,
    emissiveMap: tex.stars,
    emissive: 0xffffff,
    emissiveIntensity: 1.4,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const navyMat = new THREE.MeshStandardMaterial({ color: 0x1b2868, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xf0c868, roughness: 0.26, metalness: 0.9, emissive: 0x5a3a10, emissiveIntensity: 0.25 });
  const glowMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.7, roughness: 0.2, metalness: 0.2 });
  const faceMat = new THREE.MeshStandardMaterial({ map: tex.face, emissiveMap: tex.faceGlow, emissive: 0xffffff, emissiveIntensity: 1.0, roughness: 0.5 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xeef2fb, roughness: 0.5 });
  const hairCapMat = new THREE.MeshStandardMaterial({ color: 0xd8e1f5, roughness: 0.35, metalness: 0.15 });
  const hairMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.15, side: THREE.DoubleSide });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.55, metalness: 0.05 });
  const ribbonMat = new THREE.MeshBasicMaterial({
    color: accent,
    vertexColors: true,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const wispMat = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const sigilMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });

  // --- Gown: a scalloped sine-wave hem with a trailing back train ---
  const GOWN = [[0, 1.34], [0.16, 1.1], [0.42, 0.76], [0.72, 0.5], [1, 0.36]] as const;
  const gownGroup = new THREE.Group();
  body.add(gownGroup);
  addMesh(
    gownGroup,
    sweepGeometry([v3(0, -0.02, 0), v3(0, 1.15, 0), v3(0, 2.32, 0)], 22, {
      radial: 64,
      up: Z_UP,
      radius: (t, a) => {
        let r = lerpKeys(GOWN, t);
        r += 0.11 * Math.pow(1 - t, 3) * Math.sin(8 * a);
        r *= 1 + 0.18 * Math.pow(1 - t, 2) * Math.max(0, -Math.cos(a));
        return r;
      },
      lift: (t, a) => -0.34 * Math.pow(1 - t, 5) * Math.max(0, -Math.cos(a)),
    }),
    gownMat,
    0,
    0,
    0,
    true
  );
  addMesh(
    gownGroup,
    sweepGeometry([v3(0, 0.04, 0), v3(0, 1.9, 0)], 10, {
      radial: 40,
      up: Z_UP,
      radius: (t) => lerpKeys(GOWN, t * 0.82) * 0.9,
    }),
    voidMat
  );
  const wisps = new THREE.Group();
  gownGroup.add(wisps);
  // Soft ethereal trails under each hem scallop (wide, short, faint — not icicles).
  const wispGeo = new THREE.ConeGeometry(0.22, 0.75, 8, 1, true);
  wispGeo.rotateX(Math.PI);
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.25) / 8) * Math.PI * 2;
    const r = 1.05 + 0.11 * Math.sin(8 * a);
    const w = addMesh(wisps, wispGeo, wispMat, Math.sin(a) * r, -0.38, Math.cos(a) * r);
    w.scale.set(1, 0.7 + hash2(k, 3) * 0.6, 1);
  }
  mergeStaticMeshes(wisps);

  // --- Torso pivots at the waist so the whole upper body can lean, slump and arch ---
  const WAIST = 2.3;
  const torso = new THREE.Group();
  torso.position.y = WAIST;
  body.add(torso);
  const tv = (x: number, y: number, z: number) => v3(x, y - WAIST, z);
  const torsoStatic = new THREE.Group();
  torso.add(torsoStatic);

  const sash = addMesh(torsoStatic, new THREE.TorusGeometry(0.375, 0.042, 8, 40), goldMat, 0, 0.0, 0);
  sash.rotation.x = Math.PI / 2;
  addMesh(torsoStatic, new THREE.OctahedronGeometry(0.05, 0), glowMat, 0, 0, 0.4);

  const BOD = [[0, 0.37], [0.18, 0.315], [0.55, 0.365], [0.85, 0.34], [1, 0.22]] as const;
  addMesh(
    torsoStatic,
    sweepGeometry([tv(0, 2.26, 0), tv(0, 3.14, 0)], 14, {
      radial: 32,
      up: Z_UP,
      radius: (t) => lerpKeys(BOD, t),
      scaleX: () => 1.12,
      scaleY: () => 0.8,
      capEnd: true,
    }),
    navyMat,
    0,
    0,
    0,
    true
  );

  const shield = new THREE.Shape();
  shield.moveTo(0, 0.4);
  shield.quadraticCurveTo(0.24, 0.38, 0.21, 0.06);
  shield.quadraticCurveTo(0.14, -0.24, 0, -0.4);
  shield.quadraticCurveTo(-0.14, -0.24, -0.21, 0.06);
  shield.quadraticCurveTo(-0.24, 0.38, 0, 0.4);
  const plate = addMesh(
    torsoStatic,
    new THREE.ExtrudeGeometry(shield, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 10 }),
    goldMat,
    0,
    2.62 - WAIST,
    0.255
  );
  plate.rotation.x = -0.06;
  const setting = addMesh(torsoStatic, new THREE.TorusGeometry(0.19, 0.024, 8, 28), goldMat, 0, 2.64 - WAIST, 0.31);
  setting.rotation.x = -0.06;
  const coreMesh = addMesh(torso, new THREE.OctahedronGeometry(0.16, 0), glowMat, 0, 2.64 - WAIST, 0.34);
  coreMesh.scale.set(1, 1.45, 1);

  // Pauldron shells with gems
  const pauldronGeo = new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45);
  for (const s of [-1, 1]) {
    const p = addMesh(torsoStatic, pauldronGeo, goldMat, s * 0.37, 3.03 - WAIST, 0);
    p.scale.set(1.25, 0.7, 1.1);
    p.rotation.z = -s * 0.35;
    addMesh(torsoStatic, new THREE.OctahedronGeometry(0.045, 0), glowMat, s * 0.42, 3.13 - WAIST, 0.05);
  }

  // Regal standing collar with gold edge
  const COLLAR_ARC = 3.8;
  const collarStart = Math.PI - COLLAR_ARC / 2;
  addMesh(torsoStatic, new THREE.CylinderGeometry(0.42, 0.2, 0.5, 24, 1, true, collarStart, COLLAR_ARC), navyMat, 0, 3.32 - WAIST, -0.02);
  const collarEdgeGeo = new THREE.TorusGeometry(0.42, 0.02, 6, 32, COLLAR_ARC);
  collarEdgeGeo.rotateZ(-Math.PI / 2 - COLLAR_ARC / 2);
  collarEdgeGeo.rotateX(Math.PI / 2);
  addMesh(torsoStatic, collarEdgeGeo, goldMat, 0, 3.57 - WAIST, -0.02);
  addMesh(torsoStatic, new THREE.CylinderGeometry(0.056, 0.075, 0.28, 12), skinMat, 0, 3.26 - WAIST, 0);

  // --- Head: sculpted oval face with a painted anime face ---
  const head = new THREE.Group();
  head.position.copy(tv(0, 3.5, 0.03));
  torso.add(head);
  const headGeo = new THREE.SphereGeometry(0.235, 32, 24);
  {
    const pos = headGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      const y = pos.getY(i);
      let z = pos.getZ(i);
      if (y < 0) {
        const k = Math.pow(-y / 0.235, 1.6);
        x *= 1 - 0.3 * k;
        z *= 1 - 0.1 * k;
      }
      pos.setXYZ(i, x * 0.92, y * 1.08, z * 0.98);
    }
    computeSafeNormals(headGeo);
  }
  addMesh(head, headGeo, faceMat, 0, 0, 0, true);
  const cap = addMesh(head, new THREE.SphereGeometry(0.255, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hairCapMat, 0, 0.03, -0.02, true);
  cap.scale.set(0.95, 1.04, 1.02);
  cap.rotation.x = -0.42;

  const ROOT_HAIR = srgb(0xdde5f7);
  const TIP_HAIR = srgb(0x6fb0ff);
  const strand = (pts: THREE.Vector3[], w: number, up: THREE.Vector3) =>
    sweepGeometry(pts, 16, {
      radial: 6,
      up,
      radius: (t) => w * (Math.pow(1 - t, 0.7) * 0.85 + 0.15),
      scaleX: () => 1.7,
      scaleY: () => 0.45,
      color: (t, _a, out) => out.copy(ROOT_HAIR).lerp(TIP_HAIR, Math.pow(t, 1.4)),
    });

  // Bangs and front locks (static relative to the head)
  for (const s of [-1, 1]) {
    // Side-swept bangs frame the face and stay clear of the eyes.
    addMesh(head, strand([v3(s * 0.05, 0.22, 0.12), v3(s * 0.12, 0.17, 0.19), v3(s * 0.18, 0.1, 0.18), v3(s * 0.205, 0.04, 0.14)], 0.03, Z_UP), hairMat);
    addMesh(head, strand([v3(s * 0.12, 0.19, 0.1), v3(s * 0.19, 0.1, 0.15), v3(s * 0.225, -0.02, 0.11), v3(s * 0.23, -0.14, 0.07)], 0.032, Z_UP), hairMat);
    addMesh(head, strand([v3(s * 0.19, 0.0, 0.07), v3(s * 0.23, -0.25, 0.13), v3(s * 0.25, -0.6, 0.24), v3(s * 0.23, -0.95, 0.3)], 0.04, Z_UP), hairMat);
  }

  // Crescent tiara, antlers, and glowing leaves
  const crescent = new THREE.Shape();
  const R = 0.24;
  const OPEN = 0.25;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const th = -Math.PI + OPEN + (i / N) * (Math.PI - 2 * OPEN);
    if (i === 0) crescent.moveTo(Math.cos(th) * R, Math.sin(th) * R);
    else crescent.lineTo(Math.cos(th) * R, Math.sin(th) * R);
  }
  for (let i = N; i >= 0; i--) {
    const th = -Math.PI + OPEN + (i / N) * (Math.PI - 2 * OPEN);
    const w = 0.075 * Math.sin((i / N) * Math.PI);
    crescent.lineTo(Math.cos(th) * (R - w), Math.sin(th) * (R - w));
  }
  const tiara = addMesh(
    head,
    new THREE.ExtrudeGeometry(crescent, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 }),
    goldMat,
    0,
    0.37,
    -0.12
  );
  tiara.rotation.x = -0.3;
  addMesh(head, new THREE.OctahedronGeometry(0.045, 0), glowMat, 0, 0.15, 0.0).scale.set(1, 1.4, 0.6);
  const leafGeo = new THREE.OctahedronGeometry(0.04, 0);
  for (const s of [-1, 1]) {
    addMesh(head, taperTube([v3(s * 0.1, 0.2, -0.06), v3(s * 0.22, 0.38, -0.12), v3(s * 0.3, 0.6, -0.2), v3(s * 0.27, 0.8, -0.3)], 0.028, 0.008, 14, 6), woodMat);
    addMesh(head, taperTube([v3(s * 0.25, 0.47, -0.15), v3(s * 0.38, 0.58, -0.1), v3(s * 0.44, 0.66, -0.13)], 0.016, 0.005, 8, 5), woodMat);
    addMesh(head, taperTube([v3(s * 0.29, 0.66, -0.23), v3(s * 0.18, 0.78, -0.25), v3(s * 0.14, 0.88, -0.22)], 0.014, 0.004, 8, 5), woodMat);
    for (const [x, y, z] of [[0.27, 0.82, -0.3], [0.45, 0.67, -0.13], [0.14, 0.9, -0.22], [0.33, 0.52, -0.12]]) {
      const leaf = addMesh(head, leafGeo, glowMat, s * x, y, z);
      leaf.scale.set(0.8, 0.35, 1.6);
      leaf.rotation.set(0.4, s * 0.6, 0);
    }
  }
  mergeStaticMeshes(head);

  // Long back hair in three swaying locks
  const hairLocks: THREE.Group[] = [];
  for (let g = 0; g < 3; g++) {
    const lock = new THREE.Group();
    lock.position.set(0, 0.05, -0.08);
    head.add(lock);
    for (let k = g * 3; k < g * 3 + 3; k++) {
      const phi = -1.25 + (k / 8) * 2.5;
      const rx = Math.sin(phi) * 0.2;
      const root = v3(rx, 0.01 - 0.04 * Math.abs(Math.sin(phi)), -Math.cos(phi) * 0.15 + 0.06);
      addMesh(
        lock,
        strand(
          [
            root,
            v3(rx * 1.5, -0.45, -0.18 - 0.04 * Math.cos(phi)),
            v3(rx * 2.0 + Math.sin(phi) * 0.1, -1.0, -0.32),
            v3(rx * 2.3 + Math.sin(phi) * 0.2, -1.55, -0.47 + 0.05 * Math.cos(3 * phi)),
          ],
          0.075,
          v3(0, 0, -1)
        ),
        hairMat
      );
    }
    mergeStaticMeshes(lock);
    hairLocks.push(lock);
  }

  // --- Harmonic halo: a gold ring wrapped by a glowing sine-wave ring ---
  const halo = new THREE.Group();
  halo.position.copy(tv(0, 3.66, -0.48));
  torso.add(halo);
  addMesh(halo, new THREE.TorusGeometry(0.8, 0.022, 6, 72), goldMat);
  addMesh(
    halo,
    loopTube((u) => {
      const a = u * Math.PI * 2;
      const r = 0.66 + 0.05 * Math.sin(12 * a);
      return v3(Math.cos(a) * r, Math.sin(a) * r, 0);
    }, 120, 0.016),
    glowMat
  );
  const starGeo = new THREE.OctahedronGeometry(0.06, 0);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const star = addMesh(halo, starGeo, k % 2 ? goldMat : glowMat, Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0);
    star.scale.set(0.6, 0.6, 0.25).multiplyScalar(k % 2 ? 1 : 1.5);
  }
  mergeStaticMeshes(halo);

  // --- Arms (two-bone IK) with flared bell sleeves ---
  const UPPER = 0.5;
  const FORE = 0.48;
  const sleeveGeo = taperTube([v3(0, 0, 0), v3(0, -UPPER, 0)], 0.078, 0.062, 4, 12, { up: Z_UP });
  // Bell sleeves hang from the elbow under gravity, so a raised arm bares the forearm instead of
  // turning the sleeve into an upturned trumpet.
  const bellGeo = sweepGeometry([v3(0, 0.02, 0), v3(0, -0.2, 0), v3(0, -0.44, 0)], 8, {
    radial: 20,
    up: Z_UP,
    radius: (t, a) => 0.07 + 0.17 * Math.pow(t, 1.5) + 0.022 * t * Math.sin(6 * a),
  });
  const forearmGeo = taperTube([v3(0, 0, 0), v3(0, -FORE, 0)], 0.042, 0.032, 4, 8, { up: Z_UP });
  const handGeo = new THREE.SphereGeometry(0.055, 10, 8);
  const buildArm = () => {
    const upper = new THREE.Group();
    const fore = new THREE.Group();
    const bell = new THREE.Group();
    torso.add(upper, fore, bell);
    addMesh(upper, sleeveGeo, navyMat, 0, 0, 0, true);
    addMesh(bell, bellGeo, gownMat, 0, 0, 0, true);
    addMesh(fore, forearmGeo, skinMat);
    const hand = addMesh(torso, handGeo, skinMat);
    hand.scale.set(0.8, 1.2, 0.55);
    return { upper, fore, hand, bell };
  };
  const armR = buildArm();
  const armL = buildArm();
  const shoulderR = tv(0.36, 3.02, 0);
  const shoulderL = tv(-0.36, 3.02, 0);
  const poleR = v3(1, -0.5, -0.6).normalize();
  const poleL = v3(-1, -0.5, -0.6).normalize();

  // --- Elderwood staff crowned by an armillary orb ---
  const staff = new THREE.Group();
  torso.add(staff);
  const GRIP = tv(0.86, 2.48, 0.36);
  addMesh(staff, taperTube([tv(0.92, 0.15, 0.32), tv(0.89, 1.4, 0.36), tv(0.86, 2.48, 0.36), tv(0.9, 3.6, 0.38), tv(0.88, 4.1, 0.36)], 0.048, 0.034, 24, 8), woodMat, 0, 0, 0, true);
  const ORB = tv(0.88, 4.34, 0.36);
  for (let k = 0; k < 3; k++) {
    const base = (k / 3) * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const s = i / 6;
      const r = 0.05 + 0.2 * Math.sin(Math.PI * s * 0.92);
      const ang = base + 1.3 * s;
      pts.push(v3(ORB.x + Math.cos(ang) * r, ORB.y - 0.3 + 0.6 * s, ORB.z + Math.sin(ang) * r));
    }
    addMesh(staff, taperTube(pts, 0.026, 0.008, 14, 5), woodMat);
    const tip = pts[pts.length - 1];
    const leaf = addMesh(staff, leafGeo, glowMat, tip.x, tip.y, tip.z);
    leaf.scale.set(0.9, 0.35, 1.7);
  }
  addMesh(staff, new THREE.SphereGeometry(0.14, 16, 12), glowMat, ORB.x, ORB.y, ORB.z);
  mergeStaticMeshes(staff);
  const armillary = new THREE.Group();
  armillary.position.copy(ORB);
  staff.add(armillary);
  const ringA = addMesh(armillary, new THREE.TorusGeometry(0.23, 0.014, 6, 40), goldMat);
  const ringB = addMesh(armillary, new THREE.TorusGeometry(0.2, 0.012, 6, 40), goldMat);
  ringB.rotation.x = Math.PI / 2;

  // --- Sine sigil hovering over the casting hand ---
  const sigil = new THREE.Group();
  torso.add(sigil);
  const sigilRing = addMesh(
    sigil,
    loopTube((u) => {
      const a = u * Math.PI * 2;
      const r = 0.13 + 0.025 * Math.sin(5 * a);
      return v3(Math.cos(a) * r, 0, Math.sin(a) * r);
    }, 80, 0.01, 5),
    sigilMat
  );
  addMesh(sigil, new THREE.SphereGeometry(0.05, 10, 8), glowMat);

  // --- Veil ribbons: traveling sine waves, fading toward their tips ---
  const veilRibbons: THREE.Object3D[] = [];
  const RIBBON_LEN = 2.9;
  const ribbons: { geo: THREE.BufferGeometry; base: Float32Array; side: number; phase: number }[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.copy(tv(s * 0.3, 3.0, -0.2));
    torso.add(pivot);
    const geo = new THREE.PlaneGeometry(0.34, RIBBON_LEN, 1, 32);
    geo.translate(0, -RIBBON_LEN / 2, 0);
    const count = geo.attributes.position.count;
    const rgba = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const sNorm = -geo.attributes.position.getY(i) / RIBBON_LEN;
      rgba.set([1, 1, 1, 0.85 * Math.pow(THREE.MathUtils.clamp(1 - sNorm, 0, 1), 0.8)], i * 4);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
    addMesh(pivot, geo, ribbonMat);
    ribbons.push({ geo, base: Float32Array.from(geo.attributes.position.array as Float32Array), side: s, phase: s > 0 ? 0 : 1.7 });
    veilRibbons.push(pivot);
  }

  mergeStaticMeshes(torsoStatic);

  // --- Orbiting sine focus crystals ---
  const orbitParts: THREE.Object3D[] = [];
  const orbitCrystals: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const orb = new THREE.Group();
    const crystal = addMesh(orb, new THREE.OctahedronGeometry(0.2, 0), glowMat);
    crystal.scale.set(1, 1.9, 1);
    const ring = addMesh(
      orb,
      loopTube((u) => {
        const a = u * Math.PI * 2;
        const r = 0.34 + 0.05 * Math.sin(5 * a);
        return v3(Math.cos(a) * r, 0, Math.sin(a) * r);
      }, 80, 0.014, 5),
      goldMat
    );
    ring.rotation.x = 0.35;
    body.add(orb);
    orbitParts.push(orb);
    orbitCrystals.push(crystal);
  }

  // --- Phase-driven animation ---
  const leftTarget = tv(-0.52, 2.78, 0.5);
  const desired = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const hand = new THREE.Vector3();
  const rightTarget = new THREE.Vector3();
  let lean = 0;
  let nod = 0;
  let staffLift = 0;
  let castGlow = 0.6;

  const poseArm = (
    arm: { upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D; bell: THREE.Object3D },
    shoulder: THREE.Vector3,
    target: THREE.Vector3,
    pole: THREE.Vector3
  ) => {
    solveTwoBoneArm(shoulder, target, UPPER, FORE, pole, elbow, hand);
    alignSegmentDown(arm.upper, shoulder, elbow);
    alignSegmentDown(arm.fore, elbow, hand);
    arm.hand.position.copy(hand);
    // Sleeve hangs from just past the elbow, swinging a little with the torso lean.
    arm.bell.position.copy(elbow).lerp(hand, 0.18);
    arm.bell.rotation.set(-torso.rotation.x, 0, 0);
  };

  const animate = (dt: number, ctx: BossAnimContext) => {
    const t = ctx.time;
    let leanT = 0;
    let nodT = 0.05 + Math.sin(t * 0.8) * 0.03;
    let liftT = 0;
    let glowT = 0.7;
    switch (ctx.phase) {
      case 'CHANNEL_WAVE':
        desired.copy(tv(-0.48, 3.25 + 0.12 * Math.sin(t * 3), 0.74));
        leanT = 0.05;
        glowT = 1.2;
        break;
      case 'PHASE_WARD':
        desired.copy(tv(-0.3, 3.02, 0.78));
        glowT = 1.0;
        break;
      case 'TELEGRAPH':
        desired.copy(tv(-0.34, 3.95, 0.3));
        leanT = -0.1;
        nodT = -0.18;
        liftT = 0.32;
        glowT = 1.8;
        break;
      case 'ASYMPTOTE_SURGE':
        desired.copy(tv(-0.42, 3.45, 0.92));
        leanT = 0.08;
        liftT = 0.18;
        glowT = 2.0;
        break;
      case 'STAGGERED':
      case 'DEFEATED':
        desired.copy(tv(-0.55, 2.4, 0.22));
        leanT = 0.3;
        nodT = 0.4;
        glowT = 0.25;
        break;
      default:
        desired.copy(tv(-0.52, 2.8 + 0.05 * Math.sin(t * 1.4), 0.52));
    }
    const k = 1 - Math.exp(-6 * Math.max(0, Math.min(dt, 0.1)));
    leftTarget.lerp(desired, k);
    lean = approach(lean, leanT, 5, dt);
    nod = approach(nod, nodT, 5, dt);
    staffLift = approach(staffLift, liftT, 5, dt);
    castGlow = approach(castGlow, glowT, 4, dt);

    torso.rotation.x = lean + Math.sin(t * 1.1) * 0.015;
    head.rotation.x = nod;
    head.rotation.y = Math.sin(t * 0.55) * 0.12;
    staff.position.y = staffLift;
    rightTarget.copy(GRIP).setY(GRIP.y + staffLift);
    poseArm(armR, shoulderR, rightTarget, poleR);
    poseArm(armL, shoulderL, leftTarget, poleL);

    sigil.position.copy(armL.hand.position).add(desired.set(0, 0.2, 0.02));
    sigil.rotation.y = t * 2.2;
    sigilRing.scale.setScalar(0.8 + castGlow * 0.25 + Math.sin(t * 6) * 0.04);
    sigilMat.opacity = THREE.MathUtils.clamp(0.25 + castGlow * 0.4, 0, 1);
    glowMat.emissiveIntensity = 1.4 + castGlow * 0.45;

    armillary.rotation.y = t * 0.9;
    ringA.rotation.x = t * 1.3;
    halo.rotation.z = t * 0.22;
    gownGroup.rotation.y = Math.sin(t * 0.5) * 0.06;
    wisps.rotation.y = t * 0.35;
    wispMat.opacity = 0.15 + Math.sin(t * 2.1) * 0.05;
    hairLocks.forEach((lock, i) => {
      lock.rotation.z = Math.sin(t * 1.1 + i * 1.3) * 0.045;
      lock.rotation.x = Math.sin(t * 0.9 + i) * 0.035 - lean * 0.6;
    });
    orbitCrystals.forEach((c, i) => (c.rotation.y = t * 1.8 + i));

    for (const rib of ribbons) {
      const pos = rib.geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const bx = rib.base[i * 3];
        const by = rib.base[i * 3 + 1];
        const s = -by / RIBBON_LEN;
        const w = t * 2.4 - s * 7 + rib.phase;
        pos.setXYZ(i, bx + rib.side * 0.32 * s + 0.17 * s * Math.sin(w), by, -0.45 * s * s - 0.12 * s * Math.cos(w * 0.9));
      }
      pos.needsUpdate = true;
    }
  };

  return { coreMesh, orbitParts, veilRibbons, animate };
}

// =============================================================================================
// Malakor — Ancient Ruin Lich (tan / cot)
// =============================================================================================

function buildLich(body: THREE.Group, cfg: BossConfig): BossBuild {
  const accent = cfg.accentColor;
  const tex = getLichTextures();

  const robeMat = new THREE.MeshStandardMaterial({
    map: tex.robe,
    emissiveMap: tex.robeGlow,
    emissive: 0xffffff,
    emissiveIntensity: 0.9,
    roughness: 0.75,
    side: THREE.DoubleSide,
  });
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xe9dfc6, roughness: 0.55, metalness: 0.05 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xe0b45a, roughness: 0.28, metalness: 0.88, emissive: 0x4a3008, emissiveIntensity: 0.25 });
  const bronzeMat = new THREE.MeshStandardMaterial({ color: 0x9c7a3c, roughness: 0.35, metalness: 0.85 });
  const stripeMat = new THREE.MeshStandardMaterial({ map: tex.stripes, roughness: 0.38, metalness: 0.55, side: THREE.DoubleSide });
  const tabardMat = new THREE.MeshStandardMaterial({ map: tex.tabard, roughness: 0.4, metalness: 0.5 });
  const collarMat = new THREE.MeshStandardMaterial({ map: tex.collar, roughness: 0.32, metalness: 0.55, side: THREE.DoubleSide });
  const stoneMat = new THREE.MeshStandardMaterial({
    map: tex.sandstone,
    emissiveMap: tex.sandstoneGlow,
    emissive: 0xffffff,
    emissiveIntensity: 0.9,
    roughness: 0.85,
  });
  const socketMat = new THREE.MeshStandardMaterial({ color: 0x030605, roughness: 1 });
  const clawMat = new THREE.MeshStandardMaterial({ color: 0x1f2c27, roughness: 0.4, metalness: 0.3 });
  const soulMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.1, roughness: 0.2 });
  const flameMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const mistMat = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // --- Tattered robe over pooled ghost mist ---
  const lower = new THREE.Group();
  body.add(lower);
  const ROBE = [[0, 1.18], [0.2, 0.98], [0.5, 0.72], [0.8, 0.55], [1, 0.44]] as const;
  addMesh(
    lower,
    sweepGeometry([v3(0, -0.15, 0), v3(0, 1.3, 0), v3(0, 2.72, 0)], 24, {
      radial: 64,
      up: Z_UP,
      radius: (t, a) => lerpKeys(ROBE, t) + 0.04 * Math.sin(a * 11) * Math.pow(1 - t, 2),
      scaleX: () => 1.05,
      scaleY: () => 0.9,
      lift: (t, a) => Math.pow(1 - t, 6) * 0.55 * Math.pow(Math.abs(Math.sin(a * 7 + 0.8 * Math.sin(a * 3))), 4),
    }),
    robeMat,
    0,
    0,
    0,
    true
  );
  const mist = new THREE.Group();
  lower.add(mist);
  const mistCone = new THREE.ConeGeometry(0.95, 0.95, 24, 1, true);
  mistCone.rotateX(Math.PI);
  addMesh(mist, mistCone, mistMat, 0, -0.25, 0);
  const mistWisp = new THREE.ConeGeometry(0.12, 0.9, 6, 1, true);
  mistWisp.rotateX(Math.PI);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    addMesh(mist, mistWisp, mistMat, Math.sin(a) * 0.95, -0.2, Math.cos(a) * 0.9).scale.setScalar(0.7 + hash2(k, 9) * 0.6);
  }
  mergeStaticMeshes(mist);
  const belt = addMesh(lower, new THREE.TorusGeometry(0.45, 0.05, 8, 40), goldMat, 0, 2.72, 0);
  belt.rotation.x = Math.PI / 2;
  const tabard = addMesh(lower, new THREE.BoxGeometry(0.42, 1.5, 0.035), tabardMat, 0, 1.95, 0.6);
  tabard.rotation.x = -0.17;
  mergeStaticMeshes(lower, [mist]);

  // --- Torso: exposed skeleton, soul furnace, usekh collar ---
  const WAIST = 2.7;
  const tv = (x: number, y: number, z: number) => v3(x, y - WAIST, z);
  const torso = new THREE.Group();
  torso.position.y = WAIST;
  body.add(torso);
  const torsoStatic = new THREE.Group();
  torso.add(torsoStatic);

  const vertebraGeo = new THREE.CylinderGeometry(0.05, 0.055, 0.08, 8);
  const processGeo = new THREE.ConeGeometry(0.025, 0.08, 4);
  processGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 7; i++) {
    const y = 2.72 + i * 0.13;
    addMesh(torsoStatic, vertebraGeo, boneMat, 0, y - WAIST, -0.13);
    addMesh(torsoStatic, processGeo, boneMat, 0, y - WAIST, -0.19);
  }
  for (let k = 0; k < 5; k++) {
    const y = 2.82 + k * 0.135;
    const w = 0.78 + 0.22 * Math.sin((Math.PI * (k + 1)) / 6);
    for (const s of [-1, 1]) {
      const pts = [tv(s * 0.04, y, -0.12), tv(s * 0.27 * w, y - 0.03, -0.06), tv(s * 0.31 * w, y - 0.08, 0.1), tv(s * 0.18 * w, y - 0.13, 0.22), tv(s * 0.045, y - 0.15, 0.24)];
      addMesh(torsoStatic, taperTube(k === 0 ? pts.slice(0, 4) : pts, 0.03, 0.021, 12, 6), boneMat, 0, 0, 0, true);
    }
  }
  addMesh(torsoStatic, new THREE.BoxGeometry(0.07, 0.45, 0.045), boneMat, 0, 3.0 - WAIST, 0.245);
  for (const s of [-1, 1]) {
    addMesh(torsoStatic, taperTube([tv(s * 0.05, 3.33, 0.2), tv(s * 0.25, 3.4, 0.12), tv(s * 0.44, 3.4, -0.02)], 0.028, 0.022, 8, 6), boneMat);
  }
  const coreMat = soulMat.clone();
  const coreMesh = addMesh(torso, new THREE.OctahedronGeometry(0.17, 0), coreMat, 0, 3.0 - WAIST, 0.03);
  coreMesh.scale.set(1, 1.4, 1);
  const coreGlowMat = flameMat.clone();
  coreGlowMat.opacity = 0.07;
  const coreGlow = addMesh(torso, new THREE.SphereGeometry(0.28, 16, 12), coreGlowMat, 0, 3.02 - WAIST, 0.03);

  addMesh(torsoStatic, new THREE.CylinderGeometry(0.27, 0.74, 0.3, 40, 1, true), collarMat, 0, 3.36 - WAIST, 0, true);
  const collarRim = addMesh(torsoStatic, new THREE.TorusGeometry(0.74, 0.025, 6, 48), goldMat, 0, 3.21 - WAIST, 0);
  collarRim.rotation.x = Math.PI / 2;
  const beadGeo = new THREE.SphereGeometry(0.04, 8, 6);
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    addMesh(torsoStatic, beadGeo, k % 2 ? soulMat : goldMat, Math.sin(a) * 0.76, 3.15 - WAIST, Math.cos(a) * 0.76).scale.set(1, 1.5, 1);
  }

  // --- Floating sandstone pauldrons ---
  const pauldrons: THREE.Group[] = [];
  // Stepped ziggurat pauldrons: floating sandstone tiers capped by a gilded pyramidion.
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.copy(tv(s * 0.88, 3.58, 0));
    g.rotation.z = -s * 0.45;
    torso.add(g);
    const tiers: [number, number, number][] = [
      [0.6, 0.14, 0.64],
      [0.46, 0.13, 0.5],
      [0.32, 0.12, 0.36],
    ];
    let y = 0;
    tiers.forEach(([w, h, d]) => {
      addMesh(g, new THREE.BoxGeometry(w, h, d), stoneMat, 0, y + h / 2, 0, true);
      const trim = addMesh(g, new THREE.BoxGeometry(w + 0.02, 0.022, d + 0.02), goldMat, 0, y + h, 0);
      trim.castShadow = false;
      y += h + 0.012;
    });
    const tip = new THREE.ConeGeometry(0.2, 0.26, 4);
    tip.rotateY(Math.PI / 4);
    addMesh(g, tip, goldMat, 0, y + 0.13, 0);
    addMesh(g, new THREE.OctahedronGeometry(0.05, 0), soulMat, 0, y + 0.3, 0);
    addMesh(g, new THREE.SphereGeometry(0.16, 10, 8), flameMat, 0, -0.08, 0).scale.set(1.8, 0.3, 1.8);
    mergeStaticMeshes(g);
    pauldrons.push(g);
  }

  // --- Skeletal arms with tattered sleeves and clawed hands ---
  const UPPER = 0.62;
  const FORE = 0.6;
  const humerusGeo = taperTube([v3(0, 0, 0), v3(0, -UPPER, 0)], 0.045, 0.035, 4, 8, { up: Z_UP });
  const knobGeo = new THREE.SphereGeometry(0.055, 10, 8);
  const sleeveGeo = sweepGeometry([v3(0, 0.04, 0), v3(0, -0.5, 0)], 6, {
    radial: 18,
    up: Z_UP,
    radius: (t, a) => 0.13 + 0.09 * t + 0.015 * Math.sin(a * 9),
    lift: (t, a) => Math.pow(t, 6) * 0.2 * Math.pow(Math.abs(Math.sin(a * 4.5)), 3),
  });
  const radiusGeo = taperTube([v3(0, 0, 0), v3(0, -FORE, 0)], 0.026, 0.022, 4, 6, { up: Z_UP });
  const buildHand = (mirror: number) => {
    const hand = new THREE.Group();
    addMesh(hand, new THREE.BoxGeometry(0.1, 0.09, 0.035), boneMat, 0, -0.045, 0);
    for (let f = 0; f < 4; f++) {
      const x = -0.045 + f * 0.03;
      addMesh(hand, taperTube([v3(x, -0.08, 0), v3(x * 1.2, -0.17, 0.03), v3(x * 1.3, -0.25, 0.08)], 0.013, 0.008, 6, 5), boneMat);
      addMesh(hand, taperTube([v3(x * 1.3, -0.25, 0.08), v3(x * 1.32, -0.3, 0.13), v3(x * 1.3, -0.32, 0.17)], 0.009, 0.0015, 5, 5), clawMat);
    }
    addMesh(hand, taperTube([v3(0.05, -0.04, 0.02), v3(0.085, -0.1, 0.07), v3(0.08, -0.15, 0.12)], 0.013, 0.003, 6, 5), boneMat);
    hand.scale.x = mirror;
    mergeStaticMeshes(hand);
    torso.add(hand);
    return hand;
  };
  const buildArm = (mirror: number) => {
    const upper = new THREE.Group();
    const fore = new THREE.Group();
    torso.add(upper, fore);
    addMesh(upper, humerusGeo, boneMat, 0, 0, 0, true);
    addMesh(upper, sleeveGeo, robeMat, 0, 0, 0, true);
    addMesh(upper, knobGeo, boneMat, 0, -UPPER, 0);
    addMesh(fore, radiusGeo, boneMat, 0.025, 0, 0, true);
    addMesh(fore, radiusGeo, boneMat, -0.025, 0, 0, true);
    addMesh(fore, knobGeo, boneMat, 0, -FORE, 0).scale.setScalar(0.7);
    mergeStaticMeshes(upper);
    mergeStaticMeshes(fore);
    return { upper, fore, hand: buildHand(mirror) };
  };
  const armR = buildArm(1);
  const armL = buildArm(-1);
  const shoulderR = tv(0.47, 3.38, 0);
  const shoulderL = tv(-0.47, 3.38, 0);
  const poleR = v3(1, -0.6, -0.5).normalize();
  const poleL = v3(-1, -0.6, -0.5).normalize();

  // Palm soul-flame
  const palmFlame = new THREE.Group();
  torso.add(palmFlame);
  const flameGeo = new THREE.ConeGeometry(0.07, 0.32, 8, 1, true);
  const flames: THREE.Mesh[] = [];
  for (let k = 0; k < 3; k++) {
    const f = addMesh(palmFlame, flameGeo, flameMat, (k - 1) * 0.04, 0.12, (k % 2) * 0.03);
    f.scale.setScalar(1 - Math.abs(k - 1) * 0.3);
    flames.push(f);
  }
  addMesh(palmFlame, new THREE.SphereGeometry(0.06, 10, 8), soulMat);

  // --- Staff: a gilded asymptote frame cradling a glowing tan(θ) branch ---
  const staff = new THREE.Group();
  torso.add(staff);
  const GRIP = tv(1.02, 2.62, 0.36);
  addMesh(staff, taperTube([tv(1.04, 0.15, 0.36), tv(1.03, 2.2, 0.36), tv(1.02, 4.25, 0.36)], 0.045, 0.04, 12, 8), bronzeMat, 0, 0, 0, true);
  for (const s of [-1, 1]) {
    addMesh(staff, taperTube([tv(1.04, 0.28, 0.36), tv(1.04 + s * 0.08, 0.15, 0.36), tv(1.04 + s * 0.09, 0.0, 0.36)], 0.025, 0.012, 6, 6), bronzeMat);
  }
  mergeStaticMeshes(staff);
  const glyph = new THREE.Group();
  glyph.position.copy(tv(1.02, 4.7, 0.36));
  staff.add(glyph);
  const barGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.85, 8);
  const finialGeo = new THREE.SphereGeometry(0.05, 10, 8);
  for (const s of [-1, 1]) {
    addMesh(glyph, barGeo, goldMat, s * 0.26, 0, 0);
    addMesh(glyph, finialGeo, goldMat, s * 0.26, 0.45, 0);
    addMesh(glyph, finialGeo, goldMat, s * 0.26, -0.45, 0);
  }
  addMesh(glyph, taperTube([v3(-0.26, -0.42, 0), v3(0, -0.52, 0), v3(0.26, -0.42, 0)], 0.03, 0.03, 10, 6), goldMat);
  const tanPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const x = -0.22 + (0.44 * i) / 24;
    tanPts.push(v3(x, THREE.MathUtils.clamp(Math.tan((x / 0.26) * (Math.PI / 2) * 0.94) * 0.1, -0.4, 0.4), 0));
  }
  addMesh(glyph, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tanPts), 48, 0.022, 6), soulMat);
  mergeStaticMeshes(glyph);

  // --- Skull, jaw, eye flames, nemes headdress and uraeus ---
  const head = new THREE.Group();
  head.position.copy(tv(0, 3.93, 0.04));
  torso.add(head);
  const skullGeo = new THREE.SphereGeometry(0.29, 28, 22);
  {
    const pos = skullGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      const ny = y / 0.29;
      if (y < 0) {
        const k = Math.pow(-ny, 1.4);
        x *= 1 - 0.38 * k;
        z = z * (1 - 0.1 * k) + (z > 0 ? 0.03 * k : 0);
      }
      if (z < 0) z *= 1.12;
      x *= 1 - 0.07 * Math.exp(-Math.pow((ny - 0.1) / 0.25, 2)) * (z > 0 ? 1 : 0.5);
      y *= 1.08;
      pos.setXYZ(i, x, y, z);
    }
    computeSafeNormals(skullGeo);
  }
  addMesh(head, skullGeo, boneMat, 0, 0, 0, true);
  const socketGeo = new THREE.SphereGeometry(0.085, 12, 10);
  const browGeo = new THREE.SphereGeometry(0.06, 10, 8);
  for (const s of [-1, 1]) {
    // Slanted sockets under a heavy, scowling brow ridge.
    const socket = addMesh(head, socketGeo, socketMat, s * 0.105, -0.005, 0.235);
    socket.scale.set(1.25, 0.8, 0.6);
    socket.rotation.z = s * 0.38;
    const brow = addMesh(head, browGeo, boneMat, s * 0.1, 0.068, 0.25);
    brow.scale.set(1.7, 0.5, 0.65);
    brow.rotation.z = s * 0.42;
    const cheek = addMesh(head, browGeo, boneMat, s * 0.165, -0.09, 0.2);
    cheek.scale.set(1.2, 0.38, 0.55);
    cheek.rotation.z = -s * 0.3;
  }
  const nasal = addMesh(head, new THREE.ConeGeometry(0.045, 0.1, 3), socketMat, 0, -0.08, 0.27);
  // Dark mouth cavity so an opening jaw reads as a gaping maw, not a grin.
  addMesh(head, new THREE.SphereGeometry(0.15, 14, 10), socketMat, 0, -0.2, 0.1).scale.set(1, 0.55, 0.9);
  nasal.rotation.x = Math.PI;
  const toothGeo = new THREE.BoxGeometry(0.026, 0.06, 0.022);
  for (let k = 0; k < 10; k++) {
    const ang = -0.75 + (1.5 * k) / 9;
    const tooth = addMesh(head, toothGeo, boneMat, Math.sin(ang) * 0.13, -0.185, Math.cos(ang) * 0.215);
    tooth.rotation.y = ang;
  }
  const nemes = addMesh(head, new THREE.SphereGeometry(0.335, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), stripeMat, 0, 0.05, -0.03, true);
  nemes.scale.set(1.06, 1.0, 1.12);
  nemes.rotation.x = -0.3;
  addMesh(head, new THREE.CylinderGeometry(0.3, 0.62, 0.85, 24, 1, true, Math.PI - 1.5, 3.0), stripeMat, 0, -0.42, -0.04, true);
  addMesh(head, taperTube([v3(0, 0.24, 0.29), v3(0, 0.33, 0.33), v3(0, 0.43, 0.31)], 0.028, 0.024, 8, 6), goldMat);
  addMesh(head, new THREE.SphereGeometry(0.06, 10, 8), goldMat, 0, 0.45, 0.31).scale.set(1.2, 1.4, 0.35);
  addMesh(head, new THREE.OctahedronGeometry(0.022, 0), soulMat, 0, 0.47, 0.335);
  mergeStaticMeshes(head);

  const jaw = new THREE.Group();
  jaw.position.set(0, -0.12, 0.02);
  head.add(jaw);
  addMesh(
    jaw,
    taperTube([v3(-0.17, 0, -0.06), v3(-0.16, -0.12, 0.08), v3(-0.08, -0.17, 0.2), v3(0, -0.18, 0.23), v3(0.08, -0.17, 0.2), v3(0.16, -0.12, 0.08), v3(0.17, 0, -0.06)], 0.03, 0.03, 24, 8, {
      scaleY: () => 1.5,
    }),
    boneMat,
    0,
    0,
    0,
    true
  );
  for (let k = 0; k < 8; k++) {
    const ang = -0.65 + (1.3 * k) / 7;
    const tooth = addMesh(jaw, toothGeo, boneMat, Math.sin(ang) * 0.11, -0.125, Math.cos(ang) * 0.19 + 0.01);
    tooth.rotation.y = ang;
  }
  mergeStaticMeshes(jaw);

  const eyeFlames: THREE.Group[] = [];
  const eyeFlameGeo = new THREE.ConeGeometry(0.055, 0.34, 8, 1, true);
  eyeFlameGeo.translate(0, 0.17, 0);
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * 0.105, -0.01, 0.26);
    head.add(g);
    addMesh(g, eyeFlameGeo, flameMat).rotation.x = -0.25;
    addMesh(g, new THREE.SphereGeometry(0.03, 8, 6), soulMat);
    eyeFlames.push(g);
  }

  // Sun-disk halo of the Sunken Sun-Ruins
  const sunHalo = new THREE.Group();
  sunHalo.position.copy(tv(0, 4.1, -0.45));
  torso.add(sunHalo);
  addMesh(sunHalo, new THREE.TorusGeometry(0.58, 0.045, 8, 48), goldMat);
  addMesh(sunHalo, new THREE.TorusGeometry(0.46, 0.02, 6, 48), soulMat);
  const rayGeo = new THREE.ConeGeometry(0.035, 0.32, 4);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const ray = addMesh(sunHalo, rayGeo, k % 2 ? soulMat : goldMat, Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0);
    ray.rotation.z = a - Math.PI / 2;
    ray.scale.setScalar(k % 2 ? 0.7 : 1);
  }
  mergeStaticMeshes(sunHalo);

  mergeStaticMeshes(torsoStatic);

  // --- Orbiting glyph obelisks ---
  const orbitParts: THREE.Object3D[] = [];
  const runeRings: THREE.Mesh[] = [];
  const shaftGeo = new THREE.CylinderGeometry(0.15, 0.22, 1.5, 4, 1);
  shaftGeo.rotateY(Math.PI / 4);
  const capGeo = new THREE.ConeGeometry(0.155, 0.3, 4);
  capGeo.rotateY(Math.PI / 4);
  for (let i = 0; i < 4; i++) {
    const obelisk = new THREE.Group();
    addMesh(obelisk, shaftGeo, stoneMat, 0, 0, 0, true);
    addMesh(obelisk, capGeo, goldMat, 0, 0.9, 0);
    addMesh(obelisk, new THREE.OctahedronGeometry(0.06, 0), soulMat, 0, 1.12, 0);
    const ring = addMesh(obelisk, new THREE.TorusGeometry(0.34, 0.015, 6, 32), soulMat, 0, 0.1, 0);
    ring.rotation.x = Math.PI / 2;
    runeRings.push(ring);
    body.add(obelisk);
    orbitParts.push(obelisk);
  }

  // --- Phase-driven animation ---
  const leftTarget = tv(-0.78, 3.0, 0.55);
  const desired = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const handPos = new THREE.Vector3();
  const segDir = new THREE.Vector3();
  let jawOpen = 0.05;
  let lean = 0;
  let nod = 0;
  let fury = 0.5;

  const poseArm = (arm: { upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D }, shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3) => {
    solveTwoBoneArm(shoulder, target, UPPER, FORE, pole, elbow, handPos);
    alignSegmentDown(arm.upper, shoulder, elbow);
    alignSegmentDown(arm.fore, elbow, handPos);
    arm.hand.position.copy(handPos);
    arm.hand.quaternion.copy(arm.fore.quaternion);
    segDir.subVectors(handPos, elbow);
  };

  const animate = (dt: number, ctx: BossAnimContext) => {
    const t = ctx.time;
    let jawT = 0.06 + 0.03 * Math.sin(t * 1.7);
    let leanT = 0;
    let nodT = Math.sin(t * 0.7) * 0.05;
    let furyT = 0.5;
    switch (ctx.phase) {
      case 'CHANNEL_WAVE':
        desired.copy(tv(-0.68, 3.5 + 0.1 * Math.sin(t * 2.6), 0.85));
        jawT = 0.12 + 0.1 * Math.max(0, Math.sin(t * 9));
        furyT = 0.9;
        break;
      case 'PHASE_WARD':
        desired.copy(tv(-0.5, 3.15, 0.85));
        jawT = 0.1;
        furyT = 0.8;
        break;
      case 'TELEGRAPH':
        desired.copy(tv(-0.42, 4.25, 0.38));
        jawT = 0.45;
        leanT = -0.1;
        nodT = -0.18;
        furyT = 1.4;
        break;
      case 'ASYMPTOTE_SURGE':
        desired.copy(tv(-0.5, 3.8, 0.95));
        jawT = 0.55 + 0.08 * Math.sin(t * 20);
        leanT = 0.08;
        furyT = 1.8;
        break;
      case 'STAGGERED':
      case 'DEFEATED':
        desired.copy(tv(-0.72, 2.45, 0.25));
        jawT = 0.35;
        leanT = 0.28;
        nodT = 0.35;
        furyT = 0.2;
        break;
      default:
        desired.copy(tv(-0.78, 3.0 + 0.06 * Math.sin(t * 1.2), 0.55));
    }
    const k = 1 - Math.exp(-6 * Math.max(0, Math.min(dt, 0.1)));
    leftTarget.lerp(desired, k);
    jawOpen = approach(jawOpen, jawT, 12, dt);
    lean = approach(lean, leanT, 5, dt);
    nod = approach(nod, nodT, 5, dt);
    fury = approach(fury, furyT, 4, dt);

    torso.rotation.x = lean;
    head.rotation.x = nod;
    head.rotation.z = Math.sin(t * 0.6) * 0.05;
    jaw.rotation.x = jawOpen;
    poseArm(armR, shoulderR, GRIP, poleR);
    poseArm(armL, shoulderL, leftTarget, poleL);
    palmFlame.position.copy(armL.hand.position).add(desired.set(0, 0.08, 0.04));
    flames.forEach((f, i) => {
      f.scale.y = (1 - Math.abs(i - 1) * 0.3) * (0.8 + fury * 0.5 + 0.25 * Math.sin(t * 14 + i * 2.1));
    });
    eyeFlames.forEach((g, i) => {
      g.scale.set(1, 0.8 + fury * 0.45 + 0.22 * Math.sin(t * 13 + i * 1.7) + 0.12 * Math.sin(t * 7.3 + i), 1);
    });
    pauldrons.forEach((p, i) => {
      const s = i === 0 ? -1 : 1;
      p.position.y = 3.58 - WAIST + Math.sin(t * 1.6 + i * 1.4) * 0.06;
      p.rotation.z = -s * 0.45 + Math.sin(t * 1.2 + i) * 0.05;
    });
    soulMat.emissiveIntensity = 1.3 + fury * 0.45 + Math.min(0.8, ctx.slope * 0.06);
    coreMat.emissiveIntensity = 0.9 + fury * 0.35 + Math.min(0.6, ctx.slope * 0.05);
    coreGlow.scale.setScalar(0.9 + fury * 0.15 + Math.sin(t * 4) * 0.06);
    coreGlowMat.opacity = 0.04 + fury * 0.04;
    sunHalo.rotation.z = t * 0.2;
    glyph.rotation.y = t * 0.8;
    mistMat.opacity = 0.22 + Math.sin(t * 1.8) * 0.06 + fury * 0.04;
    mist.rotation.y = t * 0.25;
    runeRings.forEach((r, i) => (r.rotation.z = t * 1.5 + i));
  };

  return { coreMesh, orbitParts, animate };
}

// =============================================================================================
// Vaelorath — Skyridge Wyrm (sec / csc)
// =============================================================================================

function buildDragon(body: THREE.Group, cfg: BossConfig): BossBuild {
  const accent = cfg.accentColor;
  const scaleTex = getDragonScaleTexture();

  const TOP = srgb(0x7d1a10);
  const FLANK = srgb(0xc4431d);
  const BELLY = srgb(0xf2c47e);
  const bodyColor = (_t: number, a: number, out: THREE.Color) => {
    const c = Math.cos(a);
    if (c > 0.1) out.copy(FLANK).lerp(TOP, smooth01((c - 0.1) / 0.8));
    else if (c < -0.3) out.copy(FLANK).lerp(BELLY, smooth01((-c - 0.3) / 0.35));
    else out.copy(FLANK);
  };

  // The scale pattern doubles as a bump map so each scale catches light as raised relief.
  const scaleMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: scaleTex,
    bumpMap: scaleTex,
    bumpScale: 2.2,
    roughness: 0.48,
    metalness: 0.22,
  });
  const hornMat = new THREE.MeshStandardMaterial({ color: 0xeedcaa, roughness: 0.35, metalness: 0.35 });
  const clawMat = new THREE.MeshStandardMaterial({ color: 0x2b1d17, roughness: 0.4, metalness: 0.3 });
  const wingBoneMat = new THREE.MeshStandardMaterial({ color: 0x6e1a10, roughness: 0.5, metalness: 0.2 });
  const membraneMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.55,
    emissive: 0x7a2208,
    emissiveIntensity: 0.32,
  });
  const finMat = new THREE.MeshStandardMaterial({ color: 0xd8572a, emissive: 0x5a1a08, emissiveIntensity: 0.4, roughness: 0.5, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.8, roughness: 0.2 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffa53a, emissiveIntensity: 1.8, roughness: 0.2 });
  const throatMat = new THREE.MeshStandardMaterial({ color: 0xffb35a, emissive: accent, emissiveIntensity: 0.8, roughness: 0.3 });
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xfff4e0, roughness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x120806, roughness: 0.9 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x5a0f0c, roughness: 0.7 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xf0c868, roughness: 0.25, metalness: 0.9, emissive: 0x5a3a10, emissiveIntensity: 0.25 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xf2c46a, metalness: 0.55, roughness: 0.3, emissive: accent, emissiveIntensity: 0.5 });

  // Scale cells stay square on every piece: one texture tile spans π·r of length (16 cells along,
  // 32 around), so uvScaleU = length / (π · mean radius).
  const scaleSweep = (pts: THREE.Vector3[], tubular: number, radius: (t: number, a: number) => number, extra: Partial<Parameters<typeof sweepGeometry>[2]> = {}) => {
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += pts[i].distanceTo(pts[i - 1]);
    let meanR = 0;
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) meanR += radius(t, Math.PI / 2) / 5;
    return sweepGeometry(pts, tubular, {
      radial: 20,
      up: Y_UP,
      radius,
      color: bodyColor,
      uvScaleU: length / (Math.PI * Math.max(0.02, meanR)),
      capStart: true,
      capEnd: true,
      ...extra,
    });
  };

  const bodyStatic = new THREE.Group();
  body.add(bodyStatic);

  // --- Torso ---
  const TORSO_PTS = [v3(0, 1.72, -1.55), v3(0, 1.95, -0.75), v3(0, 2.12, 0.1), v3(0, 2.3, 0.75), v3(0, 2.46, 1.12)];
  const TORSO_R = [[0, 0.44], [0.3, 0.74], [0.55, 0.8], [0.8, 0.66], [1, 0.5]] as const;
  addMesh(
    bodyStatic,
    scaleSweep(TORSO_PTS, 26, (t, a) => lerpKeys(TORSO_R, t) * (1 + 0.1 * Math.max(0, -Math.cos(a)) * Math.sin(Math.PI * t)), {
      radial: 28,
      scaleX: () => 0.95,
    }),
    scaleMat,
    0,
    0,
    0,
    true
  );
  const torsoCurve = new THREE.CatmullRomCurve3(TORSO_PTS);
  const spineGeo = new THREE.ConeGeometry(0.1, 0.45, 4);
  for (let i = 0; i < 8; i++) {
    const t = 0.1 + (i / 7) * 0.78;
    const p = torsoCurve.getPointAt(t);
    const r = lerpKeys(TORSO_R, t);
    const spine = addMesh(bodyStatic, spineGeo, hornMat, 0, p.y + r - 0.04, p.z);
    spine.scale.set(0.35, 0.75 + 0.5 * Math.sin(Math.PI * t), 1);
    spine.rotation.x = -0.55;
  }

  // Tucked legs with claws
  const legSweep = (base: THREE.Vector3, pts: THREE.Vector3[], r0: number, r1: number) =>
    scaleSweep(pts.map((p) => p.clone().add(base)), 10, (t) => r0 + (r1 - r0) * t, { radial: 12, up: Z_UP });
  const claw = (from: THREE.Vector3, to: THREE.Vector3, curl: THREE.Vector3) =>
    addMesh(bodyStatic, taperTube([from, from.clone().lerp(to, 0.5).add(curl), to], 0.035, 0.004, 6, 5), clawMat);
  for (const s of [-1, 1]) {
    const hip = v3(s * 0.42, 1.68, -0.95);
    addMesh(bodyStatic, legSweep(hip, [v3(0, 0.1, 0.05), v3(s * 0.12, -0.3, 0.12), v3(s * 0.15, -0.55, 0.0)], 0.3, 0.15), scaleMat, 0, 0, 0, true);
    addMesh(bodyStatic, legSweep(hip, [v3(s * 0.15, -0.55, 0.0), v3(s * 0.14, -0.6, -0.3), v3(s * 0.12, -0.58, -0.5)], 0.14, 0.09), scaleMat, 0, 0, 0, true);
    for (const dx of [-0.07, 0, 0.07]) {
      const from = hip.clone().add(v3(s * 0.12 + dx, -0.6, -0.55));
      claw(from, from.clone().add(v3(dx * 0.4, -0.13, -0.08)), v3(0, 0, -0.04));
    }
    const shoulder = v3(s * 0.4, 2.0, 0.85);
    addMesh(bodyStatic, legSweep(shoulder, [v3(0, 0.05, 0), v3(s * 0.1, -0.3, 0.08), v3(s * 0.1, -0.45, 0.0)], 0.18, 0.1), scaleMat, 0, 0, 0, true);
    addMesh(bodyStatic, legSweep(shoulder, [v3(s * 0.1, -0.45, 0.0), v3(s * 0.08, -0.5, 0.25), v3(s * 0.06, -0.48, 0.42)], 0.1, 0.07), scaleMat, 0, 0, 0, true);
    for (const dx of [-0.05, 0, 0.05]) {
      const from = shoulder.clone().add(v3(s * 0.06 + dx, -0.5, 0.46));
      claw(from, from.clone().add(v3(dx * 0.3, -0.12, 0.06)), v3(0, 0, 0.04));
    }
  }

  // Chest core in a gold lattice
  const coreMesh = addMesh(body, new THREE.IcosahedronGeometry(0.26, 1), glowMat, 0, 2.08, 1.16);
  const latticeA = addMesh(bodyStatic, new THREE.TorusGeometry(0.3, 0.025, 6, 28), goldMat, 0, 2.08, 1.14);
  latticeA.rotation.x = -0.3;
  const latticeB = addMesh(bodyStatic, new THREE.TorusGeometry(0.3, 0.02, 6, 28), goldMat, 0, 2.08, 1.14);
  latticeB.rotation.set(-0.3, Math.PI / 2, 0);

  // --- Neck: three articulated swept segments ---
  const neckSegments: THREE.Object3D[] = [];
  const NECK_R = [0.47, 0.4, 0.33, 0.27];
  let neckParent: THREE.Object3D = body;
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Group();
    seg.position.copy(i === 0 ? v3(0, 2.42, 1.05) : v3(0, 0.48, 0.6));
    neckParent.add(seg);
    addMesh(
      seg,
      // Each segment starts deep inside its parent with a slightly wider collar, hiding the joint.
      scaleSweep([v3(0, -0.2, -0.32), v3(0, 0.15, 0.17), v3(0, 0.5, 0.62)], 12, (t) => (NECK_R[i] + (NECK_R[i + 1] - NECK_R[i]) * t) * (1 + 0.06 * (1 - t))),
      scaleMat,
      0,
      0,
      0,
      true
    );
    for (const tt of [0.3, 0.75]) {
      const r = NECK_R[i] + (NECK_R[i + 1] - NECK_R[i]) * tt;
      const spine = addMesh(seg, spineGeo, hornMat, 0, -0.06 + 0.56 * tt + r * 0.82, -0.2 + 0.82 * tt - r * 0.45);
      spine.scale.set(0.3, 0.6, 0.9);
      spine.rotation.x = -0.9;
    }
    mergeStaticMeshes(seg);
    neckSegments.push(seg);
    neckParent = seg;
  }

  // --- Head ---
  const head = new THREE.Group();
  head.position.set(0, 0.48, 0.6);
  head.rotation.x = 0.15;
  neckParent.add(head);
  const SKULL_R = [[0, 0.3], [0.25, 0.36], [0.5, 0.27], [0.8, 0.19], [1, 0.1]] as const;
  addMesh(
    head,
    scaleSweep(
      [v3(0, 0.05, -0.28), v3(0, 0.07, 0.08), v3(0, 0.01, 0.45), v3(0, -0.05, 0.82), v3(0, -0.07, 1.02)],
      22,
      (t, a) => lerpKeys(SKULL_R, t) * (1 + 0.14 * Math.exp(-Math.pow((t - 0.32) / 0.09, 2)) * Math.max(0, Math.cos(a))),
      { scaleX: (t) => 1.15 - 0.25 * t, scaleY: () => 0.78 }
    ),
    scaleMat,
    0,
    0,
    0,
    true
  );
  const palate = addMesh(head, new THREE.SphereGeometry(0.15, 12, 8), mouthMat, 0, -0.15, 0.45);
  palate.scale.set(1, 0.25, 2.4);
  const toothGeo = new THREE.ConeGeometry(0.022, 0.085, 5);
  toothGeo.rotateX(Math.PI);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 7; k++) {
      const tooth = addMesh(head, toothGeo, toothMat, s * (0.2 - k * 0.015), -0.2 + k * 0.005, 0.3 + k * 0.1);
      if (k === 1) tooth.scale.setScalar(1.7);
    }
    const eye = addMesh(head, new THREE.SphereGeometry(0.07, 12, 10), eyeMat, s * 0.245, 0.08, 0.46);
    eye.scale.set(1, 0.7, 1.25);
    eye.rotation.y = s * 0.5;
    const slit = addMesh(head, new THREE.BoxGeometry(0.012, 0.085, 0.012), darkMat, s * 0.302, 0.08, 0.49);
    slit.rotation.y = s * 0.5;
    const brow = addMesh(head, new THREE.ConeGeometry(0.05, 0.3, 5), hornMat, s * 0.22, 0.2, 0.36);
    brow.rotation.set(-Math.PI / 2 - 0.35, 0, -s * 0.2);
    addMesh(head, new THREE.SphereGeometry(0.025, 8, 6), darkMat, s * 0.07, 0.02, 1.0);
    addMesh(
      head,
      sweepGeometry([v3(s * 0.14, 0.2, 0.04), v3(s * 0.3, 0.36, -0.32), v3(s * 0.4, 0.34, -0.78), v3(s * 0.34, 0.16, -1.15)], 18, {
        radial: 10,
        radius: (t) => (0.095 + (0.012 - 0.095) * t) * (1 + 0.07 * Math.sin(t * 44) * (1 - t)),
      }),
      hornMat,
      0,
      0,
      0,
      true
    );
    addMesh(head, taperTube([v3(s * 0.24, 0.0, -0.02), v3(s * 0.42, -0.03, -0.38), v3(s * 0.5, -0.14, -0.62)], 0.05, 0.008, 10, 8), hornMat);
    const fin = new THREE.Shape();
    fin.moveTo(0, 0);
    fin.lineTo(-0.55, 0.32);
    fin.lineTo(-0.45, 0.12);
    fin.lineTo(-0.62, 0.02);
    fin.lineTo(-0.46, -0.08);
    fin.lineTo(-0.55, -0.25);
    fin.lineTo(0, -0.05);
    const finMesh = addMesh(head, new THREE.ExtrudeGeometry(fin, { depth: 0.015, bevelEnabled: false }), finMat, s * 0.3, -0.02, -0.12);
    finMesh.rotation.y = s > 0 ? -2.36 : -0.785;
  }
  for (let k = 0; k < 3; k++) {
    const crest = addMesh(head, spineGeo, hornMat, 0, 0.3 - k * 0.04, -0.2 - k * 0.2);
    crest.scale.set(0.3, 0.55 - k * 0.1, 0.9);
    crest.rotation.x = -1.0;
  }
  mergeStaticMeshes(head);

  const throat = addMesh(head, new THREE.SphereGeometry(0.12, 12, 10), throatMat, 0, -0.17, 0.12);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.2, 0.02);
  head.add(jaw);
  addMesh(
    jaw,
    scaleSweep([v3(0, 0, -0.12), v3(0, -0.04, 0.38), v3(0, -0.04, 0.86)], 14, (t) => 0.2 + (0.085 - 0.2) * t, {
      scaleX: (t) => 1.1 - 0.25 * t,
      scaleY: () => 0.45,
    }),
    scaleMat,
    0,
    0,
    0,
    true
  );
  const tongue = addMesh(jaw, new THREE.SphereGeometry(0.16, 12, 8), mouthMat, 0, 0.02, 0.4);
  tongue.scale.set(0.9, 0.25, 2.2);
  const lowerToothGeo = new THREE.ConeGeometry(0.02, 0.07, 5);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      addMesh(jaw, lowerToothGeo, toothMat, s * (0.17 - k * 0.013), 0.06, 0.25 + k * 0.09);
    }
  }
  mergeStaticMeshes(jaw);

  const whiskers: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.12, -0.05, 0.95);
    head.add(pivot);
    const pts = [v3(0, 0, 0), v3(s * 0.1, -0.1, 0.02), v3(s * 0.17, -0.32, -0.06), v3(s * 0.2, -0.55, -0.16), v3(s * 0.17, -0.74, -0.3)];
    addMesh(pivot, taperTube(pts, 0.014, 0.003, 20, 5), glowMat);
    whiskers.push(pivot);
  }

  // --- Wings: arm + finger bones with scalloped membranes ---
  const buildWing = (s: number): THREE.Group => {
    const wing = new THREE.Group();
    wing.position.set(s * 0.5, 2.62, 0.55);
    const S = v3(0, 0, 0);
    const E = v3(s * 1.15, 0.45, -0.35);
    const W = v3(s * 2.35, 0.7, -0.1);
    const tips = [v3(s * 4.7, 1.05, -0.55), v3(s * 4.45, 0.05, -1.35), v3(s * 3.5, -0.55, -1.75), v3(s * 2.2, -0.75, -1.65)];
    const A = v3(s * 0.05, -0.42, -1.45);
    const mid = (a: THREE.Vector3, b: THREE.Vector3, off: THREE.Vector3) => a.clone().lerp(b, 0.5).add(off);
    addMesh(wing, taperTube([S, mid(S, E, v3(0, 0.08, 0.05)), E], 0.13, 0.09, 10, 10), wingBoneMat, 0, 0, 0, true);
    addMesh(wing, taperTube([E, mid(E, W, v3(0, 0.05, 0.05)), W], 0.09, 0.065, 10, 10), wingBoneMat, 0, 0, 0, true);
    addMesh(wing, new THREE.SphereGeometry(0.09, 10, 8), wingBoneMat, W.x, W.y, W.z);
    for (const tip of tips) {
      addMesh(wing, taperTube([W, mid(W, tip, v3(0, -0.06, -0.04)), tip], 0.055, 0.012, 12, 7), wingBoneMat, 0, 0, 0, true);
    }
    addMesh(wing, taperTube([W, W.clone().add(v3(s * 0.1, 0.12, 0.18)), W.clone().add(v3(s * 0.06, 0.2, 0.3))], 0.04, 0.004, 8, 6), clawMat);

    // Membrane panels fanned from the wrist, trailing edges sagging between fingers.
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const INNER = srgb(0xf6a052);
    const OUTER = srgb(0x8e2414);
    const maxD = 2.9;
    const pushV = (p: THREE.Vector3) => {
      positions.push(p.x, p.y, p.z);
      const c = INNER.clone().lerp(OUTER, Math.pow(Math.min(1, p.distanceTo(W) / maxD), 0.8));
      colors.push(c.r, c.g, c.b);
      return positions.length / 3 - 1;
    };
    const fan = (p0: THREE.Vector3, p1: THREE.Vector3, sag: number) => {
      const w = pushV(W);
      const n = 10;
      let prev = -1;
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        const p = p0.clone().lerp(p1, u);
        p.lerp(W, sag * Math.sin(Math.PI * u));
        const idx = pushV(p);
        if (prev >= 0) indices.push(w, prev, idx);
        prev = idx;
      }
    };
    fan(tips[0], tips[1], 0.2);
    fan(tips[1], tips[2], 0.22);
    fan(tips[2], tips[3], 0.22);
    fan(tips[3], A, 0.18);
    const iS = pushV(S);
    const iE = pushV(E);
    const iW = pushV(W);
    const iA = pushV(A);
    indices.push(iS, iE, iW, iS, iW, iA);
    const memGeo = new THREE.BufferGeometry();
    memGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    memGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    memGeo.setIndex(indices);
    computeSafeNormals(memGeo);
    addMesh(wing, memGeo, membraneMat, 0, 0, 0, true);
    mergeStaticMeshes(wing);
    return wing;
  };
  const wingLeft = buildWing(1);
  const wingRight = buildWing(-1);
  body.add(wingLeft, wingRight);

  // --- Tail: five articulated swept segments ending in a glowing blade ---
  const tailSegments: THREE.Object3D[] = [];
  const TAIL_R = [0.43, 0.35, 0.27, 0.2, 0.13, 0.07];
  let tailParent: THREE.Object3D = body;
  for (let k = 0; k < 5; k++) {
    const seg = new THREE.Group();
    seg.position.copy(k === 0 ? v3(0, 1.72, -1.5) : v3(0, -0.08, -0.88));
    tailParent.add(seg);
    addMesh(
      seg,
      scaleSweep([v3(0, 0.03, 0.18), v3(0, -0.02, -0.4), v3(0, -0.08, -0.92)], 10, (t) => TAIL_R[k] + (TAIL_R[k + 1] - TAIL_R[k]) * t, {
        scaleX: () => 0.95,
      }),
      scaleMat,
      0,
      0,
      0,
      true
    );
    for (const tt of [0.3, 0.7]) {
      const r = TAIL_R[k] + (TAIL_R[k + 1] - TAIL_R[k]) * tt;
      const spine = addMesh(seg, spineGeo, hornMat, 0, 0.03 - 0.11 * tt + r * 0.95, 0.18 - 1.1 * tt);
      spine.scale.set(0.3, 0.3 + r * 1.2, 0.9);
      spine.rotation.x = -0.75;
    }
    mergeStaticMeshes(seg);
    tailSegments.push(seg);
    tailParent = seg;
  }
  const blade = new THREE.Shape();
  blade.moveTo(0, -0.05);
  blade.lineTo(0.12, 0.1);
  blade.quadraticCurveTo(0.42, 0.08, 0.52, 0.34);
  blade.quadraticCurveTo(0.3, 0.3, 0.2, 0.4);
  blade.quadraticCurveTo(0.1, 0.62, 0, 0.9);
  blade.quadraticCurveTo(-0.1, 0.62, -0.2, 0.4);
  blade.quadraticCurveTo(-0.3, 0.3, -0.52, 0.34);
  blade.quadraticCurveTo(-0.42, 0.08, -0.12, 0.1);
  blade.lineTo(0, -0.05);
  const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 10 });
  bladeGeo.translate(0, 0, -0.025);
  const bladeMesh = addMesh(tailParent, bladeGeo, bladeMat, 0, -0.08, -0.85, true);
  bladeMesh.rotation.x = -Math.PI / 2;

  mergeStaticMeshes(bodyStatic);

  // --- Phase-driven animation ---
  let jawOpen = 0.05;
  let headPitch = 0.15;
  let fury = 0.4;
  const animate = (dt: number, ctx: BossAnimContext) => {
    const t = ctx.time;
    let jawT = 0.06 + 0.03 * Math.sin(t * 1.3);
    let pitchT = 0.15 + 0.05 * Math.sin(t * 0.9);
    let furyT = 0.4;
    switch (ctx.phase) {
      case 'CHANNEL_WAVE':
        jawT = 0.2 + 0.08 * Math.sin(t * 4);
        furyT = 0.8;
        break;
      case 'PHASE_WARD':
        jawT = 0.12;
        furyT = 0.7;
        break;
      case 'TELEGRAPH':
        jawT = 0.62;
        pitchT = -0.05;
        furyT = 1.6;
        break;
      case 'ASYMPTOTE_SURGE':
        jawT = 0.75;
        pitchT = 0.3;
        furyT = 2.0;
        break;
      case 'STAGGERED':
      case 'DEFEATED':
        jawT = 0.32;
        pitchT = 0.5;
        furyT = 0.2;
        break;
      default:
        break;
    }
    jawOpen = approach(jawOpen, jawT, 10, dt);
    headPitch = approach(headPitch, pitchT, 4, dt);
    fury = approach(fury, furyT, 4, dt);
    jaw.rotation.x = jawOpen;
    head.rotation.x = headPitch;
    head.rotation.y = Math.sin(t * 0.6) * 0.18;
    throatMat.emissiveIntensity = 0.5 + jawOpen * 3.2 + fury * 0.4;
    throat.scale.setScalar(0.85 + jawOpen * 0.6);
    eyeMat.emissiveIntensity = 1.4 + fury * 0.5 + Math.sin(t * 3) * 0.25;
    bladeMat.emissiveIntensity = 0.4 + 0.25 * fury + Math.min(0.6, ctx.slope * 0.05);
    glowMat.emissiveIntensity = 1.5 + fury * 0.5;
    whiskers.forEach((w, i) => {
      const s = i === 0 ? -1 : 1;
      w.rotation.z = s * 0.1 * Math.sin(t * 2 + i);
      w.rotation.x = 0.08 * Math.sin(t * 1.7 + i * 0.8);
      w.rotation.y = s * 0.08 * Math.sin(t * 1.3 + i);
    });
  };

  return { coreMesh, orbitParts: [], wingLeft, wingRight, tailSegments, neckSegments, animate };
}

// =============================================================================================
// Factory
// =============================================================================================

export function createBossModel(id: BossId): BossRig {
  const cfg = BOSS_CONFIGS[id];
  const root = new THREE.Group();
  root.name = `boss_${id}`;
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const build = id === 'witch' ? buildWitch(bodyGroup, cfg) : id === 'lich' ? buildLich(bodyGroup, cfg) : buildDragon(bodyGroup, cfg);

  // Crystalline Phase Ward Barrier
  const wardMat = createWardShellMaterial(cfg.accentColor);
  const wardMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(2.8, 2), wardMat);
  wardMesh.position.y = 2.25;
  wardMesh.visible = false;
  root.add(wardMesh);

  // Pose once so the rig never renders in its unposed bind state.
  build.animate(0, { time: 0, phase: 'IDLE_GUARD', theta: 0, slope: 0 });

  return {
    root,
    bodyGroup,
    wardMesh,
    wardMat,
    orbitParts: build.orbitParts,
    wingLeft: build.wingLeft,
    wingRight: build.wingRight,
    tailSegments: build.tailSegments ?? [],
    neckSegments: build.neckSegments ?? [],
    veilRibbons: build.veilRibbons ?? [],
    coreMesh: build.coreMesh,
    // Sanitise frame time once here so every boss's smoothing stays finite on hitches or bad input.
    animate: (dt, ctx) => {
      const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      build.animate(step, {
        time: Number.isFinite(ctx.time) ? ctx.time : 0,
        phase: ctx.phase,
        theta: Number.isFinite(ctx.theta) ? ctx.theta : 0,
        slope: Number.isFinite(ctx.slope) ? Math.min(ctx.slope, 50) : 0,
      });
    },
  };
}
