import type { BossId } from '../bosses/bossDefinitions';

export const WORLD_SIZE = 220;
export const WORLD_PLAYABLE_RADIUS = 94;

export const TOWN_GATES = {
  north: { x: 0, z: -22.5 },
  south: { x: 0, z: 22.5 },
} as const;

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
    territoryRadius: 24,
    accentHex: '#e6b85c',
    accentColor: 0xe6b85c,
  },
  {
    id: 'witch',
    name: 'Whispering Glade',
    subtitle: 'Vespera · sin(θ) & cos(θ)',
    x: -58,
    z: -47,
    baseHeight: 1.4,
    plateauRadius: 18,
    territoryRadius: 26,
    accentHex: '#5ca9e6',
    accentColor: 0x5ca9e6,
  },
  {
    id: 'lich',
    name: 'Sunken Sun-Ruins',
    subtitle: 'Malakor · tan(θ) & cot(θ)',
    x: 14,
    z: 62,
    baseHeight: -1.2,
    plateauRadius: 18,
    territoryRadius: 26,
    accentHex: '#38c793',
    accentColor: 0x38c793,
  },
  {
    id: 'dragon',
    name: 'Skyridge Peak',
    subtitle: 'Vaelorath · sec(θ) & csc(θ)',
    x: 54,
    z: -54,
    baseHeight: 6.2,
    plateauRadius: 18,
    territoryRadius: 28,
    accentHex: '#e88b3a',
    accentColor: 0xe88b3a,
  },
];

export const LANDMARK_BY_ID: Record<'hub' | BossId, BiomeLandmark> = Object.fromEntries(
  BIOME_LANDMARKS.map((b) => [b.id, b]),
) as Record<'hub' | BossId, BiomeLandmark>;

interface RoadPoint {
  readonly x: number;
  readonly z: number;
  readonly baseHeight?: number;
}

const northFork = { x: 0, z: -32 };
const northRoad = [
  { x: -5, z: -10.5 },
  { x: -5.8, z: -16 },
  { x: 0, z: -20 },
  TOWN_GATES.north,
  northFork,
];

const bossRoads: Record<BossId, readonly RoadPoint[]> = {
  witch: [northFork, { x: -27, z: -35 }, LANDMARK_BY_ID.witch],
  lich: [
    { x: 0, z: 12 },
    TOWN_GATES.south,
    { x: 0, z: 27 },
    { x: 5, z: 37 },
    LANDMARK_BY_ID.lich,
  ],
  dragon: [
    northFork,
    { x: 24, z: -40, baseHeight: 0.9 },
    { x: 39, z: -47, baseHeight: 3.4 },
    LANDMARK_BY_ID.dragon,
  ],
};

export const VALLEY_ROADS: readonly (readonly RoadPoint[])[] = [northRoad, ...Object.values(bossRoads)];
const roadSegments = VALLEY_ROADS.flatMap((road) =>
  road.slice(1).map((to, i) => ({ from: road[i], to })),
);

/** Land on the road facing the boss when arriving by waypoint. */
export function getBossArrivalPoint(id: BossId): { x: number; z: number } {
  const arena = LANDMARK_BY_ID[id];
  const road = bossRoads[id];
  const approach = road[road.length - 2];
  const dx = approach.x - arena.x;
  const dz = approach.z - arena.z;
  const t = Math.min(1, 10 / Math.hypot(dx, dz));
  return { x: arena.x + dx * t, z: arena.z + dz * t };
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function sampleNearestRoad(x: number, z: number): { distance: number; height: number } {
  let nearestDistanceSq = Infinity;
  let height = 0;
  for (const { from, to } of roadSegments) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const t = clamp01(((x - from.x) * dx + (z - from.z) * dz) / (dx * dx + dz * dz));
    const offsetX = x - (from.x + dx * t);
    const offsetZ = z - (from.z + dz * t);
    const distanceSq = offsetX * offsetX + offsetZ * offsetZ;
    if (distanceSq < nearestDistanceSq) {
      nearestDistanceSq = distanceSq;
      const fromHeight = from.baseHeight ?? 0;
      const toHeight = to.baseHeight ?? 0;
      height = fromHeight + (toHeight - fromHeight) * smoothstep(0, 1, t);
    }
  }
  return { distance: Math.sqrt(nearestDistanceSq), height };
}

/** Returns the 0..1 weight for the road surface at (x, z). */
export function getTrailBlend(x: number, z: number): number {
  return 1 - smoothstep(1.9, 4.4, sampleNearestRoad(x, z).distance);
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
 * Continuous rolling emerald meadow heightmap for Sunlit Valley.
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

  const road = sampleNearestRoad(x, z);
  const trailInfluence = 1 - smoothstep(3.0, 10.5, road.distance);
  h += (road.height - h) * trailInfluence;

  // Flatten circular plateaus for Adventurer's Plaza and the 3 boss arenas
  for (const lm of BIOME_LANDMARKS) {
    const d = Math.hypot(x - lm.x, z - lm.z);
    const flatInfluence = 1 - smoothstep(lm.plateauRadius * 0.72, lm.plateauRadius + 8, d);
    if (flatInfluence > 0) {
      h = h * (1 - flatInfluence) + lm.baseHeight * flatInfluence;
    }
  }

  // Shallow sunlit brook running across the northern valley.
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

export interface GatheringNodeDefinition {
  readonly id: string;
  readonly type: 'mithrilOre' | 'moonbell';
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

export interface TrailheadSignpostDefinition {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

export interface WildMinionSpawnDefinition {
  readonly id: string;
  readonly type: 'wolf' | 'skeleton' | 'drake';
  readonly homeX: number;
  readonly homeZ: number;
  readonly patrolRadius: number;
  readonly leashRadius: number;
}

export const GATHERING_NODES: readonly GatheringNodeDefinition[] = [
  // Northwestern Trail to Whispering Glade (Witch)
  { id: 'node_glade_flora_1', type: 'moonbell', name: 'Moonbell Flora', x: -9, z: -34.5 },
  { id: 'node_glade_ore_1', type: 'mithrilOre', name: 'Mithril Ore Vein', x: -19, z: -32 },
  { id: 'node_glade_flora_2', type: 'moonbell', name: 'Moonbell Flora', x: -26, z: -36.5 },

  // Southern Trail to Sunken Sun-Ruins (Lich)
  { id: 'node_ruins_ore_1', type: 'mithrilOre', name: 'Mithril Ore Vein', x: 2.8, z: 28 },
  { id: 'node_ruins_flora_1', type: 'moonbell', name: 'Moonbell Flora', x: 8, z: 38 },
  { id: 'node_ruins_ore_2', type: 'mithrilOre', name: 'Mithril Ore Vein', x: 10, z: 46 },

  // Northeastern Trail to Skyridge Peak (Dragon)
  { id: 'node_peak_ore_1', type: 'mithrilOre', name: 'Mithril Ore Vein', x: 18, z: -36 },
  { id: 'node_peak_flora_1', type: 'moonbell', name: 'Moonbell Flora', x: 29, z: -44 },
  { id: 'node_peak_ore_2', type: 'mithrilOre', name: 'Mithril Ore Vein', x: 38, z: -44 },
];

export const TRAILHEAD_SIGNPOSTS: readonly TrailheadSignpostDefinition[] = [
  // Outside South Gate (0, 22.5) pointing towards Sunken Sun-Ruins
  {
    id: 'signpost_south_gate',
    label: 'Trailhead Guide: Sunken Sun-Ruins (S) · Solstice Haven (N)',
    x: 2.8,
    z: 25.5,
    yaw: 0,
  },
  // Beyond the North Gate bridge, at the fork for Whispering Glade and Skyridge Peak.
  {
    id: 'signpost_north_gate',
    label: 'Trailhead Guide: Whispering Glade (NW) · Skyridge Peak (NE)',
    x: 3.2,
    z: northFork.z,
    yaw: Math.PI,
  },
];

export const WILD_MINION_SPAWNS: readonly WildMinionSpawnDefinition[] = [
  // Phase Wolves guarding the Whispering Glade wilderness trail
  { id: 'wolf_glade_1', type: 'wolf', homeX: -18, homeZ: -37.5, patrolRadius: 6.0, leashRadius: 14.0 },
  { id: 'wolf_glade_2', type: 'wolf', homeX: -28, homeZ: -31, patrolRadius: 6.0, leashRadius: 14.0 },

  // Skeletal Sentinels guarding the Sunken Sun-Ruins approaches
  { id: 'skel_ruins_1', type: 'skeleton', homeX: 6, homeZ: 34, patrolRadius: 5.5, leashRadius: 14.0 },
  { id: 'skel_ruins_2', type: 'skeleton', homeX: 10, homeZ: 44, patrolRadius: 5.5, leashRadius: 14.0 },

  // Drake Wyrmlings patrolling the Skyridge Peak alpine foothills
  { id: 'drake_peak_1', type: 'drake', homeX: 25, homeZ: -36, patrolRadius: 6.5, leashRadius: 14.0 },
  { id: 'drake_peak_2', type: 'drake', homeX: 38, homeZ: -43, patrolRadius: 6.5, leashRadius: 14.0 },
];

