import { describe, expect, it } from 'vitest';
import {
  createBossRuntime,
  engageBoss,
  resetBossToIdle,
  stepBossAI,
} from '../src/bosses/bossAI';
import { ActionBuffer } from '../src/input/inputMath';
import {
  BIOME_LANDMARKS,
  getBrookCenterZ,
  getRegionAt,
  getTerrainHeight,
  isOnNorthernBridge,
  LANDMARK_BY_ID,
} from '../src/world/SunlitValley';

describe('SunlitValley open world terrain & landmarks', () => {
  it('defines Adventurer Plaza and 3 distinct boss biomes with finite terrain heights', () => {
    expect(BIOME_LANDMARKS).toHaveLength(4);
    for (const lm of BIOME_LANDMARKS) {
      const h = getTerrainHeight(lm.x, lm.z);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeCloseTo(lm.baseHeight, 1);
      expect(getRegionAt(lm.x, lm.z)?.id).toBe(lm.id);
    }
  });

  it('provides a walkable bridge deck higher than the brook bed underneath', () => {
    const bridgeZ = getBrookCenterZ(0);
    expect(isOnNorthernBridge(0, bridgeZ)).toBe(true);
    const bridgeDeckY = getTerrainHeight(0, bridgeZ);
    const besideBridgeBedY = getTerrainHeight(10, getBrookCenterZ(10));
    expect(bridgeDeckY).toBeGreaterThan(besideBridgeBedY);
  });

  it('rises into natural perimeter valley ridges near the edge of the world', () => {
    const centerY = getTerrainHeight(0, 0);
    const rimY = getTerrainHeight(85, 0);
    expect(rimY).toBeGreaterThan(centerY + 4);
  });
});

describe('open-world boss IDLE_GUARD & engage/reset transitions', () => {
  it('stays calm in IDLE_GUARD until engaged, then fights and cleanly resets when player leaves', () => {
    const witchLm = LANDMARK_BY_ID.witch;
    const boss = createBossRuntime('witch', {
      homeX: witchLm.x,
      homeY: witchLm.baseHeight,
      homeZ: witchLm.z,
      startIdle: true,
    });

    expect(boss.phase).toBe('IDLE_GUARD');
    const idleEvents = stepBossAI(boss, 0.5, { x: 0, z: 0 }, false, getTerrainHeight);
    expect(idleEvents).toHaveLength(0);
    expect(boss.x).toBeCloseTo(witchLm.x, 4);
    expect(boss.z).toBeCloseTo(witchLm.z, 4);

    engageBoss(boss);
    expect(boss.phase).toBe('CHANNEL_WAVE');

    boss.hp = 200;
    boss.wardActive = true;
    resetBossToIdle(boss);
    expect(boss.phase).toBe('IDLE_GUARD');
    expect(boss.hp).toBe(boss.maxHp);
    expect(boss.wardActive).toBe(false);
  });

  it('supports buffering the open-world jump action', () => {
    const buf = new ActionBuffer(0.15);
    buf.press('jump', 5.0);
    expect(buf.consume('jump', 5.05)).toBe(true);
    expect(buf.consume('jump', 5.06)).toBe(false);
  });
});

