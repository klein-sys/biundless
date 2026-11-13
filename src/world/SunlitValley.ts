import type { BossId } from '../bosses/bossDefinitions';

export const WORLD_SIZE = 188;
export const WORLD_PLAYABLE_RADIUS = 78;

export interface BiomeLandmark {
  readonly id: 'hub' | BossId;
  readonly name: string;
  readonly subtitle: string;
  readonly x: number;
  readonly z: number;
  readonly baseHeight: number;
  readonly plateauRadius: number;
  readonly territoryRadius: number;
  readonly accentHex: string;
  readonly accentColor: number;
}

export const BIOME_LANDMARKS: readonly BiomeLandmark[] = [
  {
    id: 'hub',
    name: 'Solstice Haven',
    subtitle: "Adventurer's Town & Waypoint Shrine",
    x: 0,
    z: 0,
    baseHeight: 0,
    plateauRadius: 18,
    territoryRadius: 22,
    accentHex: '#e6b85c',
    accentColor: 0xe6b85c,
  },
  {
    id: 'witch',
    name: 'Whispering Glade',
    subtitle: 'Vespera · sin(θ) & cos(θ)',
    x: -44,
    z: -36,
    baseHeight: 1.4,
    plateauRadius: 16,
    territoryRadius: 26,
    accentHex: '#5ca9e6',
    accentColor: 0x5ca9e6,
  },
  {
    id: 'lich',
    name: 'Sunken Sun-Ruins',
    subtitle: 'Malakor · tan(θ) & cot(θ)',
    x: 0,
    z: -54,
    baseHeight: -0.6,
    plateauRadius: 16,
    territoryRadius: 26,
    accentHex: '#38c793',
    accentColor: 0x38c793,
  },
  {
    id: 'dragon',
    name: 'Skyridge Peak',
    subtitle: 'Vaelorath · sec(θ) & csc(θ)',
    x: 46,
    z: -34,
    baseHeight: 4.8,
    plateauRadius: 16,
    territoryRadius: 26,
    accentHex: '#e88b3a',
    accentColor: 0xe88b3a,
  },
];

export const LANDMARK_BY_ID: Record<'hub' | BossId, BiomeLandmark> = Object.fromEntries(
  BIOME_LANDMARKS.map((b) => [b.id, b]),
) as Record<'hub' | BossId, BiomeLandmark>;

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Minimum distance from point (px, pz) to line segment (ax, az)-(bx, bz), returning { dist, t }. */
function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { dist: number; t: number } {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const lenSq = vx * vx + vz * vz;
  const t = lenSq > 1e-6 ? clamp01((wx * vx + wz * vz) / lenSq) : 0;
  const cx = ax + vx * t;
  const cz = az + vz * t;
  return { dist: Math.hypot(px - cx, pz - cz), t };
}

/**
 * Returns 0..1 weight for whether (x, z) lies on one of the 3 cobblestone/dirt adventure trails
 * connecting Adventurer's Plaza to each boss biome.
 */
export function getTrailBlend(x: number, z: number): number {
  let maxTrail = 0;
  for (const lm of BIOME_LANDMARKS) {
    if (lm.id === 'hub') continue;
    const { dist } = distanceToSegment(x, z, 0, 0, lm.x, lm.z);
    const w = 1 - smoothstep(1.9, 4.4, dist);
    if (w > maxTrail) maxTrail = w;
  }
  return maxTrail;
}

/** Stream curve Z coordinate as a function of X for the northern sunlit brook. */
export function getBrookCenterZ(x: number): number {
  return -25.5 + Math.sin(x * 0.065) * 3.2;
}

/** Returns true if (x, z) is on the northern wooden/stone bridge crossing the brook. */
export function isOnNorthernBridge(x: number, z: number): boolean {
  const bridgeZ = getBrookCenterZ(0);
  return Math.abs(x) <= 3.1 && Math.abs(z - bridgeZ) <= 4.6;
}

/**
 * Continuous rolling emerald meadow heightmap for the ~180x180 Sunlit Valley.
 * Includes flattened plateaus for Adventurer's Plaza & 3 boss biomes, gentle trail ramps,
 * a shallow brook bed, walkable bridge arch, and natural perimeter valley ridges.
 */
export function getTerrainHeight(x: number, z: number): number {
  // Base gentle rolling hills
  const hills =
    Math.sin(x * 0.055) * Math.cos(z * 0.052) * 1.45 +
    Math.sin((x + z) * 0.095) * 0.55 +
    Math.cos(x * 0.14 - z * 0.11) * 0.25;

  let h = hills + 0.65;

  // Smoothly blend in trail ramps from hub (0,0) to each boss landmark
  for (const lm of BIOME_LANDMARKS) {
    if (lm.id === 'hub') continue;
    const { dist, t } = distanceToSegment(x, z, 0, 0, lm.x, lm.z);
    const trailInfluence = 1 - smoothstep(3.0, 10.5, dist);
    if (trailInfluence > 0) {
      const smoothT = t * t * (3 - 2 * t);
      const rampHeight = lm.baseHeight * smoothT;
      h = h * (1 - trailInfluence) + rampHeight * trailInfluence;
    }
  }

  // Flatten circular plateaus for Adventurer's Plaza and the 3 boss arenas
  for (const lm of BIOME_LANDMARKS) {
    const d = Math.hypot(x - lm.x, z - lm.z);
    const flatInfluence = 1 - smoothstep(lm.plateauRadius * 0.72, lm.plateauRadius + 8, d);
    if (flatInfluence > 0) {
      h = h * (1 - flatInfluence) + lm.baseHeight * flatInfluence;
    }
  }

  // Shallow sunlit brook running across the northern valley (between Plaza and Sun-Ruins)
  const brookZ = getBrookCenterZ(x);
  const brookDist = Math.abs(z - brookZ);
  if (brookDist < 5.5 && x > -26 && x < 26) {
    const channelCarve = (1 - smoothstep(1.2, 5.2, brookDist)) * 1.15;
    // Fade channel out near ends so it blends cleanly
    const xFade = 1 - smoothstep(18, 26, Math.abs(x));
    h -= channelCarve * xFade;
  }

  // Walkable arched bridge over the northern brook at x=0
  if (isOnNorthernBridge(x, z)) {
    const t = (z - (brookZ - 4.6)) / 9.2;
    const arch = Math.sin(clamp01(t) * Math.PI) * 1.15;
    const baseBridge = -0.25 + arch;
    h = Math.max(h, baseBridge);
  }

  // Natural perimeter valley cliffs / ridges beyond playable radius
  const radial = Math.hypot(x, z);
  if (radial > WORLD_PLAYABLE_RADIUS - 3) {
    const rim = smoothstep(WORLD_PLAYABLE_RADIUS - 3, WORLD_PLAYABLE_RADIUS + 16, radial);
    const ridgeNoise = 1 + 0.35 * Math.sin(Math.atan2(z, x) * 7 + radial * 0.15);
    h += rim * 14.5 * ridgeNoise;
  }

  return h;
}

/** Returns the current named region for the top-center HUD compass/region banner. */
export function getRegionAt(x: number, z: number): BiomeLandmark | null {
  for (const lm of BIOME_LANDMARKS) {
    const d = Math.hypot(x - lm.x, z - lm.z);
    if (d <= lm.territoryRadius) {
      return lm;
    }
  }
  return null;
}

