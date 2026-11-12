import { describe, expect, it } from 'vitest';
import { BOSS_CONFIGS, type BossId } from '../src/bosses/bossDefinitions';
import { applyDamageToBoss, createBossRuntime, stepBossAI } from '../src/bosses/bossAI';

describe('bossAI seam', () => {
  it('defines all 3 bosses with their calculus function pairings', () => {
    const ids: BossId[] = ['witch', 'lich', 'dragon'];
    for (const id of ids) {
      expect(BOSS_CONFIGS[id]).toBeDefined();
      expect(BOSS_CONFIGS[id].functions).toHaveLength(2);
    }
    expect(BOSS_CONFIGS.witch.functions).toEqual(['sin', 'cos']);
    expect(BOSS_CONFIGS.lich.functions).toEqual(['tan', 'cot']);
    expect(BOSS_CONFIGS.dragon.functions).toEqual(['sec', 'csc']);
  });

  it('advances theta, activates wards, and emits attack cues over time', () => {
    const boss = createBossRuntime('witch');
    const startTheta = boss.theta;
    let sawWard = false;
    let sawAttack = false;

    for (let i = 0; i < 80; i++) {
      const events = stepBossAI(boss, 0.1, { x: 0, z: 8 }, false);
      if (boss.wardActive) sawWard = true;
      if (events.some((e) => e.kind === 'wave_pulse' || e.kind === 'projectile_orb')) {
        sawAttack = true;
      }
    }

    expect(boss.theta).toBeGreaterThan(startTheta);
    expect(sawWard).toBe(true);
    expect(sawAttack).toBe(true);
  });

  it('locks theta when freezeTheta is enabled (Dev Drawer)', () => {
    const boss = createBossRuntime('lich');
    const frozenAt = boss.theta;
    stepBossAI(boss, 0.25, { x: 0, z: 10 }, true);
    expect(boss.theta).toBe(frozenAt);
  });

  it('transitions to STAGGERED on ward shatter / full stagger and recovers or dies cleanly', () => {
    const boss = createBossRuntime('dragon');
    boss.wardActive = true;
    applyDamageToBoss(boss, 180, 100, true);
    expect(boss.wardActive).toBe(false);
    expect(boss.phase).toBe('STAGGERED');

    for (let i = 0; i < 40; i++) {
      stepBossAI(boss, 0.1, { x: 0, z: 6 }, false);
    }
    expect(boss.phase).not.toBe('STAGGERED');

    applyDamageToBoss(boss, boss.maxHp * 2, 0, false);
    expect(boss.hp).toBe(0);
    expect(boss.phase).toBe('DEFEATED');
  });
});
