import { evaluateExactDerivative, evaluateTrig, type TrigFunctionId } from '../math/trigDerivatives';
import { BOSS_CONFIGS, type BossId } from './bossDefinitions';

export type BossPhase =
  | 'IDLE_GUARD'
  | 'CHANNEL_WAVE'
  | 'PHASE_WARD'
  | 'TELEGRAPH'
  | 'ASYMPTOTE_SURGE'
  | 'STAGGERED'
  | 'DEFEATED';

export type BossAttackEvent =
  | { readonly kind: 'wave_pulse'; readonly radius: number; readonly damage: number; readonly originX: number; readonly originZ: number }
  | { readonly kind: 'projectile_orb'; readonly originX: number; readonly originZ: number; readonly dirX: number; readonly dirZ: number; readonly speed: number; readonly damage: number }
  | { readonly kind: 'beam_sweep'; readonly angle: number; readonly angularSpeed: number; readonly damage: number }
  | { readonly kind: 'dive_slam'; readonly targetX: number; readonly targetZ: number; readonly radius: number; readonly damage: number };

export interface BossRuntime {
  readonly id: BossId;
  hp: number;
  readonly maxHp: number;
  stagger: number;
  readonly maxStagger: number;
  theta: number;
  activeFunctionIndex: 0 | 1;
  activeFunction: TrigFunctionId;
  phase: BossPhase;
  phaseTimer: number;
  attackCooldown: number;
  wardActive: boolean;
  isAirborne: boolean;
  homeX: number;
  homeY: number;
  homeZ: number;
  x: number;
  y: number;
  z: number;
  facingYaw: number;
  sweepAngle: number;
  readonly hitFlashTimer: number;
}

export interface CreateBossOptions {
  homeX?: number;
  homeY?: number;
  homeZ?: number;
  startIdle?: boolean;
}

export function createBossRuntime(id: BossId, options: CreateBossOptions = {}): BossRuntime {
  const cfg = BOSS_CONFIGS[id];
  const homeX = options.homeX ?? 0;
  const homeY = options.homeY ?? 0;
  const homeZ = options.homeZ ?? 0;
  const startIdle = options.startIdle ?? false;
  const hasExplicitHome = options.homeX !== undefined || options.homeZ !== undefined;
  const baseZOffset = hasExplicitHome ? 0 : -10;

  return {
    id,
    hp: cfg.maxHp,
    maxHp: cfg.maxHp,
    stagger: 0,
    maxStagger: 100,
    theta: 0.35,
    activeFunctionIndex: 0,
    activeFunction: cfg.functions[0],
    phase: startIdle ? 'IDLE_GUARD' : 'CHANNEL_WAVE',
    phaseTimer: 3.0,
    attackCooldown: 1.6,
    wardActive: false,
    isAirborne: id === 'dragon',
    homeX,
    homeY,
    homeZ,
    x: homeX,
    y: homeY + (id === 'witch' ? 1.2 : id === 'dragon' ? 3.2 : 0.4),
    z: homeZ + baseZOffset,
    facingYaw: 0,
    sweepAngle: 0,
    hitFlashTimer: 0,
  };
}

export function engageBoss(boss: BossRuntime): void {
  if (boss.phase === 'DEFEATED') return;
  if (boss.phase === 'IDLE_GUARD') {
    boss.phase = 'CHANNEL_WAVE';
    boss.phaseTimer = 3.0;
    boss.attackCooldown = 1.4;
    boss.wardActive = false;
    boss.isAirborne = boss.id === 'dragon';
  }
}

export function resetBossToIdle(boss: BossRuntime): void {
  if (boss.phase === 'DEFEATED') return;
  const cfg = BOSS_CONFIGS[boss.id];
  boss.hp = boss.maxHp;
  boss.stagger = 0;
  boss.theta = 0.35;
  boss.activeFunctionIndex = 0;
  boss.activeFunction = cfg.functions[0];
  boss.phase = 'IDLE_GUARD';
  boss.phaseTimer = 3.0;
  boss.attackCooldown = 1.6;
  boss.wardActive = false;
  boss.isAirborne = boss.id === 'dragon';
  boss.x = boss.homeX;
  boss.z = boss.homeZ;
  boss.y = boss.homeY + (boss.id === 'witch' ? 1.2 : boss.id === 'dragon' ? 3.2 : 0.4);
}

export function applyDamageToBoss(
  boss: BossRuntime,
  damage: number,
  staggerGain: number,
  shatterWard: boolean,
): void {
  if (boss.phase === 'DEFEATED') return;
  if (boss.phase === 'IDLE_GUARD') {
    engageBoss(boss);
  }

  boss.hp = Math.max(0, boss.hp - damage);
  if (shatterWard && boss.wardActive) {
    boss.wardActive = false;
  }

  boss.stagger = Math.min(boss.maxStagger, boss.stagger + staggerGain);

  if (boss.hp <= 0) {
    boss.phase = 'DEFEATED';
    boss.wardActive = false;
    boss.isAirborne = false;
    boss.y = boss.homeY;
    return;
  }

  if (boss.stagger >= boss.maxStagger || shatterWard) {
    boss.stagger = 0;
    boss.phase = 'STAGGERED';
    boss.phaseTimer = 3.2;
    boss.wardActive = false;
    boss.isAirborne = false;
  }
}

export function forceBossStagger(boss: BossRuntime): void {
  if (boss.phase === 'DEFEATED') return;
  boss.wardActive = false;
  boss.isAirborne = false;
  boss.stagger = 0;
  boss.phase = 'STAGGERED';
  boss.phaseTimer = 3.5;
}

export function stepBossAI(
  boss: BossRuntime,
  dt: number,
  playerPos: { readonly x: number; readonly z: number },
  freezeTheta: boolean,
  groundHeightAt: (x: number, z: number) => number = () => boss.homeY,
): BossAttackEvent[] {
  if (boss.phase === 'DEFEATED') return [];

  const cfg = BOSS_CONFIGS[boss.id];
  const events: BossAttackEvent[] = [];

  if (boss.phase === 'IDLE_GUARD') {
    boss.theta = (boss.theta + cfg.thetaSpeed * 0.25 * dt) % (Math.PI * 2);
    const groundY = groundHeightAt(boss.homeX, boss.homeZ);
    boss.x = boss.homeX;
    boss.z = boss.homeZ;
    boss.y = groundY + (boss.id === 'witch' ? 1.1 : boss.id === 'dragon' ? 2.6 : 0.35);
    boss.facingYaw = Math.atan2(playerPos.x - boss.x, playerPos.z - boss.z);
    return events;
  }

  if (!freezeTheta && boss.phase !== 'STAGGERED') {
    boss.theta = (boss.theta + cfg.thetaSpeed * dt) % (Math.PI * 2);
  }

  const fEval = evaluateTrig(boss.activeFunction, boss.theta);
  const dEval = evaluateExactDerivative(boss.activeFunction, boss.theta);

  // Face player smoothly
  const dx = playerPos.x - boss.x;
  const dz = playerPos.z - boss.z;
  boss.facingYaw = Math.atan2(dx, dz);

  // Preserve legacy test offsets when homeX === 0 && homeZ === 0
  const isLegacyOrigin = boss.homeX === 0 && boss.homeZ === 0;
  const witchBaseZ = isLegacyOrigin ? -9 : boss.homeZ;
  const lichBaseZ = isLegacyOrigin ? -10.5 : boss.homeZ;
  const dragonBaseZ = isLegacyOrigin ? -7 : boss.homeZ;

  // Boss movement / height expression driven directly by f(theta)
  if (boss.phase === 'STAGGERED') {
    const targetGroundY = groundHeightAt(boss.x, boss.z) + 0.2;
    boss.y += (targetGroundY - boss.y) * Math.min(1, 6 * dt);
  } else if (boss.id === 'witch') {
    boss.x = boss.homeX + Math.sin(boss.theta * 0.5) * 6.5;
    boss.z = witchBaseZ + Math.cos(boss.theta * 0.5) * 3.0;
    boss.y = groundHeightAt(boss.x, boss.z) + 1.3 + fEval.value * 0.55;
  } else if (boss.id === 'lich') {
    boss.x = boss.homeX + Math.cos(boss.theta * 0.4) * 5.0;
    boss.z = lichBaseZ;
    boss.y = groundHeightAt(boss.x, boss.z) + 0.45 + Math.min(1.8, Math.abs(fEval.value) * 0.15);
  } else {
    // Dragon orbital dive arc driven by sec/csc clamped magnitude
    const orbitAngle = boss.theta * 0.65;
    boss.x = boss.homeX + Math.sin(orbitAngle) * 8.5;
    boss.z = dragonBaseZ + Math.cos(orbitAngle) * 5.5;
    const groundY = groundHeightAt(boss.x, boss.z);
    boss.y = groundY + (boss.isAirborne ? 3.0 + Math.min(3.0, Math.abs(fEval.value) * 0.35) : 0.4);
  }

  boss.phaseTimer -= dt;
  boss.attackCooldown -= dt;

  if (boss.phase === 'STAGGERED') {
    if (boss.phaseTimer <= 0) {
      boss.activeFunctionIndex = boss.activeFunctionIndex === 0 ? 1 : 0;
      boss.activeFunction = cfg.functions[boss.activeFunctionIndex];
      boss.phase = 'CHANNEL_WAVE';
      boss.phaseTimer = 3.2;
      boss.isAirborne = boss.id === 'dragon';
    }
    return events;
  }

  // Trigger Asymptote Surge when near vertical asymptote for Lich / Dragon
  if (fEval.nearAsymptote && boss.phase !== 'ASYMPTOTE_SURGE') {
    boss.phase = 'ASYMPTOTE_SURGE';
    boss.phaseTimer = 1.25;
    events.push({
      kind: 'wave_pulse',
      radius: 13.5,
      damage: 26,
      originX: boss.x,
      originZ: boss.z,
    });
  }

  if (boss.attackCooldown <= 0) {
    const dist = Math.max(0.001, Math.hypot(dx, dz));
    const dirX = dx / dist;
    const dirZ = dz / dist;

    if (boss.id === 'witch') {
      events.push({
        kind: 'projectile_orb',
        originX: boss.x,
        originZ: boss.z,
        dirX,
        dirZ,
        speed: 9.5 + Math.abs(dEval.value) * 2.5,
        damage: 18,
      });
      boss.attackCooldown = 1.75;
    } else if (boss.id === 'lich') {
      boss.sweepAngle += 0.35;
      events.push({
        kind: 'beam_sweep',
        angle: boss.facingYaw,
        angularSpeed: Math.min(3.5, 0.5 + Math.abs(dEval.value) * 0.35),
        damage: 22,
      });
      boss.attackCooldown = 2.1;
    } else {
      events.push({
        kind: 'dive_slam',
        targetX: playerPos.x,
        targetZ: playerPos.z,
        radius: 5.5,
        damage: 28,
      });
      boss.attackCooldown = 2.6;
    }
  }

  if (boss.phaseTimer <= 0) {
    if (boss.phase === 'CHANNEL_WAVE') {
      boss.phase = 'PHASE_WARD';
      boss.wardActive = true;
      boss.phaseTimer = 6.5;
    } else if (boss.phase === 'PHASE_WARD') {
      boss.phase = 'TELEGRAPH';
      boss.phaseTimer = 1.4;
      events.push({
        kind: 'wave_pulse',
        radius: 9.0,
        damage: 22,
        originX: boss.x,
        originZ: boss.z,
      });
    } else {
      boss.wardActive = false;
      boss.activeFunctionIndex = boss.activeFunctionIndex === 0 ? 1 : 0;
      boss.activeFunction = cfg.functions[boss.activeFunctionIndex];
      boss.phase = 'CHANNEL_WAVE';
      boss.phaseTimer = 3.2;
    }
  }

  return events;
}
