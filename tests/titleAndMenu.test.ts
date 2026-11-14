import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDefaultProgression,
  hasSavedProgression,
  getProgressionSummary,
  saveProgression,
  resetProgression,
  addXp,
  startQuest,
  completeQuest,
  recordBossDefeat,
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

describe('Title Screen & Sanctuary Menu Helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports false for hasSavedProgression when localStorage is empty', () => {
    expect(hasSavedProgression()).toBe(false);
  });

  it('reports true when a saved state is stored in localStorage', () => {
    const defaultState = createDefaultProgression();
    saveProgression(defaultState);
    expect(hasSavedProgression()).toBe(true);
  });

  it('reports true when player has gained XP or leveled up', () => {
    const state = createDefaultProgression();
    addXp(state, 200); // Level 2
    saveProgression(state);
    expect(hasSavedProgression()).toBe(true);
  });

  it('reports true when player has an active or completed quest', () => {
    const state = createDefaultProgression();
    startQuest(state, 'aurelius_intro');
    saveProgression(state);
    expect(hasSavedProgression()).toBe(true);
  });

  it('reports true when player has defeated a boss', () => {
    const state = createDefaultProgression();
    recordBossDefeat(state, 'witch');
    saveProgression(state);
    expect(hasSavedProgression()).toBe(true);
  });

  it('resets save cleanly with resetProgression()', () => {
    const state = createDefaultProgression();
    addXp(state, 500);
    saveProgression(state);
    expect(hasSavedProgression()).toBe(true);

    resetProgression();
    expect(hasSavedProgression()).toBe(false);
  });

  it('generates a descriptive progression summary for title screen and pause card', () => {
    const state = createDefaultProgression();
    expect(getProgressionSummary(state)).toBe('Level 1 Spellblade');

    startQuest(state, 'aurelius_intro');
    expect(getProgressionSummary(state)).toContain('1 Quest Active');

    completeQuest(state, 'aurelius_intro', 150);
    expect(getProgressionSummary(state)).toContain('1 Quest Done');

    recordBossDefeat(state, 'witch');
    expect(getProgressionSummary(state)).toContain('1 Boss Defeated');
  });
});
