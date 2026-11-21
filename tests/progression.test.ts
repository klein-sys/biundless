import { describe, it, expect, beforeEach } from 'vitest';
import { applyProgressionToPlayer, computeEffectiveStat, createInitialPlayerState } from '../src/combat/resonanceCombat';
import { collectBossRelic, recordBossRelic } from '../src/rpg/bossRelics';
import { getCampaignObjective, restoreAstrolabe } from '../src/rpg/campaign';
import {
  createDefaultProgression,
  getXpForNextLevel,
  addXp,
  allocateStatPoint,
  computeEffectiveStats,
  startQuest,
  completeQuest,
  saveProgression,
  loadProgression,
  resetProgression,
} from '../src/rpg/progressionSystem';

class MockLocalStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = new MockLocalStorage();
}

describe('RPG Progression System', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('recommends Vespera after the briefing and counts relics only when inspected', () => {
    const state = createDefaultProgression();
    expect(getCampaignObjective(state).next).toBe('Talk to Aurelius at the Astrolabe gazebo');
    expect(getCampaignObjective(state, true).next).toContain('Vespera');
    recordBossRelic(state.bossRelics, 'lich', { x: 1, z: 1 });
    expect(getCampaignObjective(state)).toMatchObject({ recovered: 0, next: 'Inspect Malakor’s Seal' });
    collectBossRelic(state.bossRelics, 'lich');
    expect(getCampaignObjective(state).recovered).toBe(1);
  });

  it('restores only once, with every relic and the right sigil, and persists the ending', () => {
    const state = createDefaultProgression();
    expect(restoreAstrolabe(state, 'cos')).toBe(false);
    for (const id of ['dragon', 'witch', 'lich'] as const) {
      state.defeatedBosses.push(id);
      recordBossRelic(state.bossRelics, id, { x: 1, z: 1 });
      collectBossRelic(state.bossRelics, id);
    }
    expect(getCampaignObjective(state).next).toBe('Return to the Celestial Astrolabe');
    expect(restoreAstrolabe(state, 'neg_sin')).toBe(false);
    expect(restoreAstrolabe(state, 'cos')).toBe(true);
    expect(restoreAstrolabe(state, 'cos')).toBe(false);
    saveProgression(state);
    expect(getCampaignObjective(loadProgression()).title).toBe('Solstice Haven Restored');
    expect(resetProgression().astrolabeRestored).toBe(false);
  });

  it('keeps older victory and pickup records and opens the finale only after the missing pickup', () => {
    localStorage.setItem('ashen_tangent_progression_v1', JSON.stringify({
      level: 3,
      defeatedBosses: ['witch', 'lich', 'dragon'],
      bossRelics: {
        witch: { x: 2, z: 4, collected: true },
        lich: { x: 3, z: 5, collected: true },
      },
    }));
    const oldSave = loadProgression();
    expect(oldSave.astrolabeRestored).toBe(false);
    expect(getCampaignObjective(oldSave)).toMatchObject({ recovered: 2, next: 'Inspect Vaelorath’s Crest' });
    expect(restoreAstrolabe(oldSave, 'cos')).toBe(false);
    collectBossRelic(oldSave.bossRelics, 'dragon');
    expect(getCampaignObjective(oldSave).next).toBe('Return to the Celestial Astrolabe');
  });

  it.each([
    ['witch', 'lich', 'dragon'], ['witch', 'dragon', 'lich'], ['lich', 'witch', 'dragon'],
    ['lich', 'dragon', 'witch'], ['dragon', 'witch', 'lich'], ['dragon', 'lich', 'witch'],
  ] as const)('allows %s → %s → %s to reach the finale', (...order) => {
    const state = createDefaultProgression();
    order.forEach((id, index) => {
      state.defeatedBosses.push(id);
      recordBossRelic(state.bossRelics, id, { x: 1, z: 1 });
      collectBossRelic(state.bossRelics, id);
      expect(getCampaignObjective(state).recovered).toBe(index + 1);
    });
    expect(restoreAstrolabe(state, 'cos')).toBe(true);
  });

  it('initializes default progression at Level 1 with 0 XP and baseline stats', () => {
    const state = createDefaultProgression();
    expect(state.level).toBe(1);
    expect(state.xp).toBe(0);
    expect(state.statPoints).toBe(0);
    expect(state.vigor).toBe(0);
    expect(state.endurance).toBe(0);
    expect(state.harmonics).toBe(0);
    expect(state.quests).toEqual({});
    expect(state.defeatedBosses).toEqual([]);

    const stats = computeEffectiveStats(state);
    expect(stats.maxHp).toBe(100);
    expect(stats.maxStamina).toBe(100);
    expect(stats.resonanceMultiplier).toBe(1.0);
  });

  it('starts at full health and clamps excess health when applying lower progression stats', () => {
    const player = createInitialPlayerState();
    const saved = createDefaultProgression();
    saved.vigor = 4;
    applyProgressionToPlayer(player, computeEffectiveStats(saved));
    expect(player.hp).toBe(computeEffectiveStat(player, 'maxHp'));

    applyProgressionToPlayer(player, computeEffectiveStats(createDefaultProgression()));
    expect(player.hp).toBe(100);
    player.hp = 50;
    applyProgressionToPlayer(player, computeEffectiveStats(createDefaultProgression()));
    expect(player.hp).toBe(50);
  });

  it('correctly tracks XP and handles level-ups with stat points awarded', () => {
    const state = createDefaultProgression();
    expect(getXpForNextLevel(1)).toBe(150);

    // Add 100 XP (not enough to level up)
    const result1 = addXp(state, 100);
    expect(result1.leveledUp).toBe(false);
    expect(state.level).toBe(1);
    expect(state.xp).toBe(100);
    expect(state.statPoints).toBe(0);

    // Add another 100 XP (total 200, triggers Level 2)
    const result2 = addXp(state, 100);
    expect(result2.leveledUp).toBe(true);
    expect(result2.newLevel).toBe(2);
    expect(state.level).toBe(2);
    expect(state.statPoints).toBe(1);

    // Multi-level jump: add 1000 XP
    const result3 = addXp(state, 1000);
    expect(result3.leveledUp).toBe(true);
    expect(state.level).toBeGreaterThanOrEqual(4);
    expect(state.statPoints).toBeGreaterThanOrEqual(3);
  });

  it('allocates stat points and accurately computes effective stats', () => {
    const state = createDefaultProgression();
    state.statPoints = 3;

    // Allocate 1 Vigor, 1 Endurance, 1 Harmonics
    expect(allocateStatPoint(state, 'vigor')).toBe(true);
    expect(allocateStatPoint(state, 'endurance')).toBe(true);
    expect(allocateStatPoint(state, 'harmonics')).toBe(true);
    expect(state.statPoints).toBe(0);

    // No points left
    expect(allocateStatPoint(state, 'vigor')).toBe(false);

    const stats = computeEffectiveStats(state);
    expect(stats.maxHp).toBe(120); // 100 + 20
    expect(stats.maxStamina).toBe(115); // 100 + 15
    expect(stats.resonanceMultiplier).toBe(1.25); // 1.0 + 0.25
  });

  it('manages quest lifecycle (unstarted -> active -> completed)', () => {
    const state = createDefaultProgression();
    const questId = 'quest_sine_ward';

    expect(state.quests[questId]).toBeUndefined();

    // Start quest
    const started = startQuest(state, questId);
    expect(started).toBe(true);
    expect(state.quests[questId]).toBe('active');

    // Complete quest with 250 XP reward
    const completed = completeQuest(state, questId, 250);
    expect(completed.state.quests[questId]).toBe('completed');
    expect(state.xp).toBe(250);
    expect(state.level).toBe(2);
    expect(state.statPoints).toBe(1);
  });

  it('persists and recovers progression state via localStorage with schema resilience', () => {
    const state = createDefaultProgression();
    state.level = 3;
    state.xp = 400;
    state.statPoints = 2;
    state.vigor = 2;
    state.quests['quest_sine_ward'] = 'completed';
    state.defeatedBosses = ['vespera_witch'];

    saveProgression(state);

    const loaded = loadProgression();
    expect(loaded.level).toBe(3);
    expect(loaded.xp).toBe(400);
    expect(loaded.vigor).toBe(2);
    expect(loaded.quests['quest_sine_ward']).toBe('completed');
    expect(loaded.defeatedBosses).toContain('vespera_witch');

    // Reset
    const reset = resetProgression();
    expect(reset.level).toBe(1);
    expect(reset.xp).toBe(0);
    expect(loadProgression().level).toBe(1);
  });

  it('applies progression stats cleanly to PlayerState and enhances resonance multiplier', async () => {
    const { createInitialPlayerState, applyProgressionToPlayer, resolveResonanceStrike } = await import('../src/combat/resonanceCombat');
    const player = createInitialPlayerState();
    const state = createDefaultProgression();
    state.vigor = 2; // +40 HP
    state.endurance = 1; // +15 Stamina
    state.harmonics = 2; // +0.5x resonance multiplier

    const stats = computeEffectiveStats(state);
    applyProgressionToPlayer(player, stats);

    expect(player.baseStats.maxHp).toBe(140);
    expect(player.baseStats.maxStamina).toBe(115);
    expect(player.resonanceBonusMultiplier).toBe(1.5);

    // Test resonance strike with enhanced multiplier
    const strike = resolveResonanceStrike(player, {
      activeFunction: 'sin',
      theta: 0,
      wardActive: false,
      bossDefense: 0,
      chosenSigil: 'cos',
      firstPersonAim: false
    });
    // Base match = 3.0 + 0.25 (3rd person) + 0.35 (crit) = 3.60 * 1.5 = 5.40
    expect(strike.multiplier).toBeGreaterThanOrEqual(4.8);
    expect(strike.damage).toBeGreaterThan(100);
  });
});
