/**
 * RPG Progression & Character Stat System
 * Handles Astral Insight (XP), Character Level (1-10), Stat Points (Vigor, Endurance, Harmonics),
 * Quest State tracking, and resilient localStorage persistence.
 */

import { loadBossRelics, type BossRelics } from './bossRelics';
import { CAMPAIGN_RELIC_TOTAL, countCampaignRelics } from './campaign';

export interface ProgressionState {
  level: number;
  xp: number;
  statPoints: number;
  vigor: number;      // +20 Max HP per point
  endurance: number;  // +15 Max Stamina per point
  harmonics: number;  // +0.25x Resonance Multiplier per point
  quests: Record<string, 'unstarted' | 'active' | 'completed'>;
  defeatedBosses: string[];
  bossRelics: BossRelics;
  astrolabeRestored: boolean;
  inventory: Record<string, number>;
  weaponLevel: number; // default 1, max 5, +10% damage per level
  maxFlasks: number;   // default 3, max 5
}

export interface EffectiveStats {
  maxHp: number;
  maxStamina: number;
  resonanceMultiplier: number;
  weaponDamageMultiplier: number;
  maxFlasks: number;
}

export const BASE_MAX_HP = 100;
export const HP_PER_VIGOR = 20;

export const BASE_MAX_STAMINA = 100;
export const STAMINA_PER_ENDURANCE = 15;

export const BASE_RESONANCE_MULT = 1.0;
export const MULT_PER_HARMONICS = 0.25;

export const MAX_LEVEL = 10;
export const MAX_WEAPON_LEVEL = 5;
export const MAX_FLASK_CAPACITY = 5;

export const WEAPON_UPGRADE_COST = {
  mithrilOre: 2,
  ancientBone: 1,
} as const;

export const FLASK_UPGRADE_COST = {
  moonbell: 2,
  phaseEssence: 1,
} as const;

// Cumulative XP required to reach each level (index = level)
export const LEVEL_XP_THRESHOLDS: number[] = [
  0,     // Level 0 (unused)
  0,     // Level 1: 0 XP
  150,   // Level 2: 150 XP
  350,   // Level 3: 350 XP
  650,   // Level 4: 650 XP
  1050,  // Level 5: 1050 XP
  1550,  // Level 6: 1550 XP
  2150,  // Level 7: 2150 XP
  2850,  // Level 8: 2850 XP
  3650,  // Level 9: 3650 XP
  4550   // Level 10: 4550 XP (Max)
];

const STORAGE_KEY = 'ashen_tangent_progression_v1';

export function createDefaultProgression(): ProgressionState {
  return {
    level: 1,
    xp: 0,
    statPoints: 0,
    vigor: 0,
    endurance: 0,
    harmonics: 0,
    quests: {},
    defeatedBosses: [],
    bossRelics: {},
    astrolabeRestored: false,
    inventory: {},
    weaponLevel: 1,
    maxFlasks: 3,
  };
}

export function getXpForNextLevel(level: number): number {
  if (level >= MAX_LEVEL) {
    return LEVEL_XP_THRESHOLDS[MAX_LEVEL];
  }
  return LEVEL_XP_THRESHOLDS[level + 1];
}

export function getLevelProgressFraction(state: ProgressionState): number {
  if (state.level >= MAX_LEVEL) return 1.0;
  const currentThreshold = LEVEL_XP_THRESHOLDS[state.level];
  const nextThreshold = LEVEL_XP_THRESHOLDS[state.level + 1];
  const span = nextThreshold - currentThreshold;
  if (span <= 0) return 1.0;
  return Math.min(1.0, Math.max(0.0, (state.xp - currentThreshold) / span));
}

export function addXp(
  state: ProgressionState,
  amount: number
): { leveledUp: boolean; newLevel: number; oldLevel: number } {
  const oldLevel = state.level;
  state.xp += Math.max(0, amount);

  // Check if XP crosses any subsequent level thresholds
  let currentLevel = state.level;
  while (currentLevel < MAX_LEVEL && state.xp >= LEVEL_XP_THRESHOLDS[currentLevel + 1]) {
    currentLevel++;
    state.statPoints += 1; // Award 1 stat point per level gained
  }

  const leveledUp = currentLevel > oldLevel;
  state.level = currentLevel;

  return {
    leveledUp,
    newLevel: currentLevel,
    oldLevel
  };
}

export function allocateStatPoint(
  state: ProgressionState,
  stat: 'vigor' | 'endurance' | 'harmonics'
): boolean {
  if (state.statPoints <= 0) return false;

  state.statPoints--;
  if (stat === 'vigor') {
    state.vigor++;
  } else if (stat === 'endurance') {
    state.endurance++;
  } else if (stat === 'harmonics') {
    state.harmonics++;
  }
  return true;
}

export function computeEffectiveStats(state: ProgressionState): EffectiveStats {
  const weaponLevel = typeof state.weaponLevel === 'number' ? Math.max(1, Math.min(MAX_WEAPON_LEVEL, state.weaponLevel)) : 1;
  const weaponDamageMultiplier = Number((1.0 + (weaponLevel - 1) * 0.10).toFixed(2));
  return {
    maxHp: BASE_MAX_HP + state.vigor * HP_PER_VIGOR,
    maxStamina: BASE_MAX_STAMINA + state.endurance * STAMINA_PER_ENDURANCE,
    resonanceMultiplier: Number((BASE_RESONANCE_MULT + state.harmonics * MULT_PER_HARMONICS).toFixed(2)),
    weaponDamageMultiplier,
    maxFlasks: typeof state.maxFlasks === 'number' ? Math.max(3, Math.min(MAX_FLASK_CAPACITY, state.maxFlasks)) : 3,
  };
}

export function addInventoryItem(state: ProgressionState, item: string, count: number = 1): number {
  if (!state.inventory) {
    state.inventory = {};
  }
  const current = state.inventory[item] ?? 0;
  const next = Math.max(0, current + count);
  state.inventory[item] = next;
  return next;
}

export function getInventoryCount(state: ProgressionState, item: string): number {
  if (!state.inventory) return 0;
  return state.inventory[item] ?? 0;
}

export function canUpgradeWeapon(state: ProgressionState): boolean {
  const currentLevel = typeof state.weaponLevel === 'number' ? state.weaponLevel : 1;
  if (currentLevel >= MAX_WEAPON_LEVEL) return false;
  const ore = getInventoryCount(state, 'mithrilOre');
  const bone = getInventoryCount(state, 'ancientBone');
  return ore >= WEAPON_UPGRADE_COST.mithrilOre && bone >= WEAPON_UPGRADE_COST.ancientBone;
}

export function upgradeWeapon(state: ProgressionState): boolean {
  if (!canUpgradeWeapon(state)) return false;
  state.inventory['mithrilOre'] = (state.inventory['mithrilOre'] ?? 0) - WEAPON_UPGRADE_COST.mithrilOre;
  state.inventory['ancientBone'] = (state.inventory['ancientBone'] ?? 0) - WEAPON_UPGRADE_COST.ancientBone;
  state.weaponLevel = (state.weaponLevel ?? 1) + 1;
  return true;
}

export function canUpgradeFlask(state: ProgressionState): boolean {
  const currentFlasks = typeof state.maxFlasks === 'number' ? state.maxFlasks : 3;
  if (currentFlasks >= MAX_FLASK_CAPACITY) return false;
  const flora = getInventoryCount(state, 'moonbell');
  const essence = getInventoryCount(state, 'phaseEssence');
  return flora >= FLASK_UPGRADE_COST.moonbell && essence >= FLASK_UPGRADE_COST.phaseEssence;
}

export function upgradeFlask(state: ProgressionState): boolean {
  if (!canUpgradeFlask(state)) return false;
  state.inventory['moonbell'] = (state.inventory['moonbell'] ?? 0) - FLASK_UPGRADE_COST.moonbell;
  state.inventory['phaseEssence'] = (state.inventory['phaseEssence'] ?? 0) - FLASK_UPGRADE_COST.phaseEssence;
  state.maxFlasks = (state.maxFlasks ?? 3) + 1;
  return true;
}

export function startQuest(state: ProgressionState, questId: string): boolean {
  if (state.quests[questId] === 'completed') return false;
  state.quests[questId] = 'active';
  return true;
}

export function completeQuest(
  state: ProgressionState,
  questId: string,
  rewardXp: number
): { state: ProgressionState; rewardXp: number } {
  state.quests[questId] = 'completed';
  addXp(state, rewardXp);
  return { state, rewardXp };
}

export function recordBossDefeat(state: ProgressionState, bossId: string, xpReward: number = 200): void {
  if (!state.defeatedBosses.includes(bossId)) {
    state.defeatedBosses.push(bossId);
  }
  addXp(state, xpReward);
}

export function saveProgression(state: ProgressionState): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch (e) {
    console.warn('[Progression] Failed to save to localStorage:', e);
  }
}

export function loadProgression(): ProgressionState {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const defeatedBosses = Array.isArray(parsed.defeatedBosses) ? parsed.defeatedBosses : [];
        const bossRelics = loadBossRelics(parsed.bossRelics, defeatedBosses);
        return {
          level: typeof parsed.level === 'number' ? Math.max(1, Math.min(MAX_LEVEL, parsed.level)) : 1,
          xp: typeof parsed.xp === 'number' ? Math.max(0, parsed.xp) : 0,
          statPoints: typeof parsed.statPoints === 'number' ? Math.max(0, parsed.statPoints) : 0,
          vigor: typeof parsed.vigor === 'number' ? Math.max(0, parsed.vigor) : 0,
          endurance: typeof parsed.endurance === 'number' ? Math.max(0, parsed.endurance) : 0,
          harmonics: typeof parsed.harmonics === 'number' ? Math.max(0, parsed.harmonics) : 0,
          quests: typeof parsed.quests === 'object' && parsed.quests ? parsed.quests : {},
          defeatedBosses,
          bossRelics,
          astrolabeRestored: parsed.astrolabeRestored === true && countCampaignRelics(bossRelics) === CAMPAIGN_RELIC_TOTAL,
          inventory: typeof parsed.inventory === 'object' && parsed.inventory ? parsed.inventory : {},
          weaponLevel: typeof parsed.weaponLevel === 'number' ? Math.max(1, Math.min(MAX_WEAPON_LEVEL, parsed.weaponLevel)) : 1,
          maxFlasks: typeof parsed.maxFlasks === 'number' ? Math.max(3, Math.min(MAX_FLASK_CAPACITY, parsed.maxFlasks)) : 3,
        };
      }
    }
  } catch (e) {
    console.warn('[Progression] Failed to load from localStorage:', e);
  }
  return createDefaultProgression();
}

export function hasSavedProgression(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;
      return typeof parsed.level === 'number' && parsed.level >= 1;
    }
  } catch (e) {
    console.warn('[Progression] Error checking existing save:', e);
  }
  return false;
}

export function getProgressionSummary(state: ProgressionState): string {
  const parts: string[] = [`Level ${state.level} Spellblade`];
  const activeQuests = Object.keys(state.quests).filter((k) => state.quests[k] === 'active');
  const completedQuests = Object.keys(state.quests).filter((k) => state.quests[k] === 'completed');
  if (completedQuests.length > 0) {
    parts.push(`${completedQuests.length} Quest${completedQuests.length === 1 ? '' : 's'} Done`);
  } else if (activeQuests.length > 0) {
    parts.push('1 Quest Active');
  }
  if (state.defeatedBosses.length > 0) {
    parts.push(`${state.defeatedBosses.length} Boss${state.defeatedBosses.length === 1 ? '' : 'es'} Defeated`);
  }
  return parts.join(' · ');
}

export function resetProgression(): ProgressionState {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    console.warn('[Progression] Failed to reset localStorage:', e);
  }
  return createDefaultProgression();
}
