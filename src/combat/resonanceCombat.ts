import {
  buildWorkedExample,
  expectedDerivativeFor,
  isCriticalPoint,
  type DerivativeSigilId,
  type StrikeOutcomeKind,
  type TrigFunctionId,
  type WorkedExampleSnapshot,
} from '../math/trigDerivatives';

export type StatKey = 'maxHp' | 'maxStamina' | 'attack' | 'defense';

export interface StatModifier {
  readonly source: string;
  readonly stat: StatKey;
  readonly kind: 'flat' | 'pct';
  readonly value: number;
}

export interface PlayerState {
  hp: number;
  stamina: number;
  flasksRemaining: number;
  selectedSigil: DerivativeSigilId;
  dodgeTimer: number;
  dodgeDirX: number;
  dodgeDirZ: number;
  isInvulnerable: boolean;
  attackCooldown: number;
  resonanceCooldown: number;
  comboStep: number;
  godMode: boolean;
  infiniteStamina: boolean;
  readonly baseStats: Record<StatKey, number>;
  readonly modifiers: StatModifier[];
}

export interface BasicAttackContext {
  readonly activeFunction: TrigFunctionId;
  readonly theta: number;
  readonly wardActive: boolean;
  readonly bossDefense: number;
}

export interface ResonanceStrikeContext extends BasicAttackContext {
  readonly chosenSigil: DerivativeSigilId;
  readonly firstPersonAim: boolean;
}

export interface StrikeResolution {
  readonly damage: number;
  readonly multiplier: number;
  readonly staggerGain: number;
  readonly wardShattered: boolean;
  readonly triggerBacklash: boolean;
  readonly outcomeKind: StrikeOutcomeKind;
  readonly workedExample: WorkedExampleSnapshot;
}

const DEFENSE_CONSTANT = 100; // Ratio defense K=100 prevents immunity
const DODGE_DURATION = 0.42;
const DODGE_IFRAME_DURATION = 0.36;
const DODGE_STAMINA_COST = 24;
const RESONANCE_STAMINA_COST = 18;
const STAMINA_REGEN_PER_SEC = 26;

export function createInitialPlayerState(): PlayerState {
  return {
    hp: 160,
    stamina: 100,
    flasksRemaining: 3,
    selectedSigil: 'cos',
    dodgeTimer: 0,
    dodgeDirX: 0,
    dodgeDirZ: -1,
    isInvulnerable: false,
    attackCooldown: 0,
    resonanceCooldown: 0,
    comboStep: 0,
    godMode: false,
    infiniteStamina: false,
    baseStats: {
      maxHp: 160,
      maxStamina: 100,
      attack: 28,
      defense: 18,
    },
    modifiers: [],
  };
}

export function computeEffectiveStat(player: PlayerState, stat: StatKey): number {
  let flat = 0;
  let pct = 0;
  for (const m of player.modifiers) {
    if (m.stat !== stat) continue;
    if (m.kind === 'flat') flat += m.value;
    else pct += m.value;
  }
  return Math.max(1, Math.round((player.baseStats[stat] + flat) * (1 + pct)));
}

export function addStatModifier(player: PlayerState, mod: StatModifier): void {
  player.modifiers.push(mod);
}

export function removeStatModifiersBySource(player: PlayerState, source: string): void {
  for (let i = player.modifiers.length - 1; i >= 0; i--) {
    if (player.modifiers[i].source === source) {
      player.modifiers.splice(i, 1);
    }
  }
}

export function tryStartDodge(player: PlayerState, dir: { x: number; z: number }): boolean {
  if (player.dodgeTimer > 0) return false;
  if (!player.infiniteStamina && player.stamina < DODGE_STAMINA_COST) return false;

  if (!player.infiniteStamina) {
    player.stamina = Math.max(0, player.stamina - DODGE_STAMINA_COST);
  }
  const len = Math.hypot(dir.x, dir.z);
  player.dodgeDirX = len > 0.01 ? dir.x / len : 0;
  player.dodgeDirZ = len > 0.01 ? dir.z / len : -1;
  player.dodgeTimer = DODGE_DURATION;
  player.isInvulnerable = true;
  return true;
}

export function tryUseHealFlask(player: PlayerState): boolean {
  const maxHp = computeEffectiveStat(player, 'maxHp');
  if (player.flasksRemaining <= 0 || player.hp >= maxHp) return false;
  player.flasksRemaining -= 1;
  player.hp = Math.min(maxHp, player.hp + Math.round(maxHp * 0.48));
  return true;
}

export function canSpendResonanceStamina(player: PlayerState): boolean {
  if (player.infiniteStamina) return true;
  if (player.stamina < RESONANCE_STAMINA_COST) return false;
  player.stamina -= RESONANCE_STAMINA_COST;
  return true;
}

export function applyDamageToPlayer(player: PlayerState, rawDamage: number): number {
  if (player.godMode || player.isInvulnerable) return 0;
  const def = computeEffectiveStat(player, 'defense');
  const mitigated = Math.max(1, Math.round((rawDamage * DEFENSE_CONSTANT) / (DEFENSE_CONSTANT + def)));
  player.hp = Math.max(0, player.hp - mitigated);
  return mitigated;
}

export function stepPlayerState(player: PlayerState, dt: number): void {
  if (player.dodgeTimer > 0) {
    player.dodgeTimer = Math.max(0, player.dodgeTimer - dt);
    const elapsed = DODGE_DURATION - player.dodgeTimer;
    player.isInvulnerable = elapsed <= DODGE_IFRAME_DURATION;
  } else {
    player.isInvulnerable = false;
  }

  player.attackCooldown = Math.max(0, player.attackCooldown - dt);
  player.resonanceCooldown = Math.max(0, player.resonanceCooldown - dt);

  const maxStamina = computeEffectiveStat(player, 'maxStamina');
  if (player.infiniteStamina) {
    player.stamina = maxStamina;
  } else if (player.dodgeTimer <= 0) {
    player.stamina = Math.min(maxStamina, player.stamina + STAMINA_REGEN_PER_SEC * dt);
  }
}

export function resolveBasicAttack(player: PlayerState, ctx: BasicAttackContext): StrikeResolution {
  const atk = computeEffectiveStat(player, 'attack');
  const comboFactor = 1 + (player.comboStep % 3) * 0.14;
  const wardFactor = ctx.wardActive ? 0.55 : 1.0;
  const mitigated = (atk * comboFactor * wardFactor * DEFENSE_CONSTANT) / (DEFENSE_CONSTANT + ctx.bossDefense);
  const damage = Math.max(4, Math.round(mitigated));

  return {
    damage,
    multiplier: Number((wardFactor * comboFactor).toFixed(2)),
    staggerGain: ctx.wardActive ? 8 : 16,
    wardShattered: false,
    triggerBacklash: false,
    outcomeKind: 'basic_chip',
    workedExample: buildWorkedExample(
      ctx.activeFunction,
      ctx.theta,
      player.selectedSigil,
      'basic_chip',
      Number((wardFactor * comboFactor).toFixed(2)),
    ),
  };
}

export function resolveResonanceStrike(
  player: PlayerState,
  ctx: ResonanceStrikeContext,
): StrikeResolution {
  const atk = computeEffectiveStat(player, 'attack');
  const expected = expectedDerivativeFor(ctx.activeFunction);
  const isMatch = ctx.chosenSigil === expected;
  const critPoint = isCriticalPoint(ctx.activeFunction, ctx.theta);

  let multiplier: number;
  let staggerGain: number;
  let wardShattered = false;
  let triggerBacklash = false;
  let outcomeKind: StrikeOutcomeKind;

  if (isMatch) {
    const aimBonus = ctx.firstPersonAim ? 0.8 : 0.25;
    const critBonus = critPoint ? 1.2 : 0.35;
    // Exact matches always hit 3.0x-5.0x range, maximizing at f'(theta)=0 + 1st-person aim
    multiplier = Math.min(5.0, 3.0 + aimBonus + critBonus);
    wardShattered = ctx.wardActive;
    staggerGain = critPoint ? 100 : ctx.wardActive ? 70 : 50;
    outcomeKind = critPoint ? 'critical_stagger' : ctx.wardActive ? 'ward_shattered' : 'resonance_hit';
  } else {
    multiplier = 0.25;
    staggerGain = 0;
    triggerBacklash = true;
    outcomeKind = 'backlash';
  }

  const raw = atk * multiplier * (DEFENSE_CONSTANT / (DEFENSE_CONSTANT + ctx.bossDefense));
  const damage = Math.max(3, Math.round(raw));

  return {
    damage,
    multiplier: Number(multiplier.toFixed(2)),
    staggerGain,
    wardShattered,
    triggerBacklash,
    outcomeKind,
    workedExample: buildWorkedExample(
      ctx.activeFunction,
      ctx.theta,
      ctx.chosenSigil,
      outcomeKind,
      Number(multiplier.toFixed(2)),
    ),
  };
}
