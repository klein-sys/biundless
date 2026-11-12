import { describe, expect, it } from 'vitest';
import {
  addStatModifier,
  computeEffectiveStat,
  createInitialPlayerState,
  removeStatModifiersBySource,
  resolveBasicAttack,
  resolveResonanceStrike,
  stepPlayerState,
  tryStartDodge,
  tryUseHealFlask,
} from '../src/combat/resonanceCombat';

describe('resonanceCombat seam', () => {
  it('deals reliable basic chip damage even when a boss ward is active', () => {
    const player = createInitialPlayerState();
    const res = resolveBasicAttack(player, {
      activeFunction: 'sin',
      theta: 0.5,
      wardActive: true,
      bossDefense: 25,
    });
    expect(res.damage).toBeGreaterThan(0);
    expect(res.wardShattered).toBe(false);
    expect(res.triggerBacklash).toBe(false);
  });

  it('shatters ward with 3x-5x multiplier on exact derivative and maximizes at critical point', () => {
    const player = createInitialPlayerState();
    const normalMatch = resolveResonanceStrike(player, {
      activeFunction: 'sin',
      theta: 0.4,
      wardActive: true,
      bossDefense: 20,
      chosenSigil: 'cos',
      firstPersonAim: false,
    });
    expect(normalMatch.wardShattered).toBe(true);
    expect(normalMatch.triggerBacklash).toBe(false);
    expect(normalMatch.multiplier).toBeGreaterThanOrEqual(3.0);
    expect(normalMatch.staggerGain).toBeGreaterThanOrEqual(50);

    const critFirstPerson = resolveResonanceStrike(player, {
      activeFunction: 'sin',
      theta: Math.PI / 2, // cos(pi/2) = 0 -> critical point
      wardActive: true,
      bossDefense: 20,
      chosenSigil: 'cos',
      firstPersonAim: true,
    });
    expect(critFirstPerson.workedExample.isCriticalPoint).toBe(true);
    expect(critFirstPerson.multiplier).toBeCloseTo(5.0, 2);
    expect(critFirstPerson.staggerGain).toBe(100);
    expect(critFirstPerson.damage).toBeGreaterThan(normalMatch.damage);
  });

  it('deflects mismatched derivative strikes to 0.25x and triggers dodgeable backlash', () => {
    const player = createInitialPlayerState();
    const mismatch = resolveResonanceStrike(player, {
      activeFunction: 'tan',
      theta: 0.3,
      wardActive: true,
      bossDefense: 20,
      chosenSigil: 'cos', // wrong: should be sec2
      firstPersonAim: false,
    });
    expect(mismatch.wardShattered).toBe(false);
    expect(mismatch.triggerBacklash).toBe(true);
    expect(mismatch.multiplier).toBeCloseTo(0.25, 2);
  });

  it('handles dodge i-frames, stamina consumption, regeneration, and heal flasks', () => {
    const player = createInitialPlayerState();
    player.hp = 60;
    expect(tryUseHealFlask(player)).toBe(true);
    expect(player.hp).toBeGreaterThan(60);
    expect(player.flasksRemaining).toBe(2);

    const dodged = tryStartDodge(player, { x: 0, z: -1 });
    expect(dodged).toBe(true);
    expect(player.isInvulnerable).toBe(true);
    expect(player.stamina).toBeLessThan(player.baseStats.maxStamina);

    stepPlayerState(player, 0.5);
    expect(player.isInvulnerable).toBe(false);
    stepPlayerState(player, 1.5);
    expect(player.stamina).toBeCloseTo(player.baseStats.maxStamina, 1);
  });

  it('maintains exact base stats after equipping and unequipping modifier stacks', () => {
    const player = createInitialPlayerState();
    const baseAtk = computeEffectiveStat(player, 'attack');
    addStatModifier(player, { source: 'astral_buff', stat: 'attack', kind: 'flat', value: 18 });
    addStatModifier(player, { source: 'astral_buff', stat: 'attack', kind: 'pct', value: 0.25 });
    expect(computeEffectiveStat(player, 'attack')).toBeGreaterThan(baseAtk);

    removeStatModifiersBySource(player, 'astral_buff');
    expect(computeEffectiveStat(player, 'attack')).toBe(baseAtk);
  });
});
