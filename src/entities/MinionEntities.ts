import * as THREE from 'three';
import type { DerivativeSigilId } from '../math/trigDerivatives';
import { getTerrainHeight } from '../world/SunlitValley';
import {
  createDrakeWyrmlingModel,
  createPhaseWolfModel,
  createSkeletalSentinelModel,
  type MinionModelBundle,
} from '../engine/ProceduralModels';

export type MinionType = 'wolf' | 'skeleton' | 'drake';
export type MinionState = 'IDLE_PATROL' | 'CHASE' | 'ATTACK_WINDUP' | 'STAGGERED' | 'DEFEATED';

export interface MinionConfig {
  readonly type: MinionType;
  readonly name: string;
  readonly maxHp: number;
  readonly speed: number;
  readonly chaseSpeed: number;
  readonly attackRange: number;
  readonly attackDamage: number;
  readonly windupDuration: number;
  readonly telegraphRadius: number;
  readonly lootItem: string;
  readonly lootItemName: string;
  readonly activeFunction: 'sin' | 'tan' | 'sec';
  readonly resonantSigil: DerivativeSigilId;
}

export const MINION_CONFIGS: Record<MinionType, MinionConfig> = {
  wolf: {
    type: 'wolf',
    name: 'Phase Wolf',
    maxHp: 45,
    speed: 2.2,
    chaseSpeed: 4.8,
    attackRange: 2.4,
    attackDamage: 18,
    windupDuration: 0.6,
    telegraphRadius: 2.0,
    lootItem: 'phaseEssence',
    lootItemName: 'Phase Essence',
    activeFunction: 'sin',
    resonantSigil: 'cos',
  },
  skeleton: {
    type: 'skeleton',
    name: 'Skeletal Sentinel',
    maxHp: 55,
    speed: 1.8,
    chaseSpeed: 3.6,
    attackRange: 2.2,
    attackDamage: 22,
    windupDuration: 0.6,
    telegraphRadius: 2.0,
    lootItem: 'ancientBone',
    lootItemName: 'Ancient Bone',
    activeFunction: 'tan',
    resonantSigil: 'sec2',
  },
  drake: {
    type: 'drake',
    name: 'Drake Wyrmling',
    maxHp: 50,
    speed: 2.5,
    chaseSpeed: 4.2,
    attackRange: 2.5,
    attackDamage: 24,
    windupDuration: 0.6,
    telegraphRadius: 2.0,
    lootItem: 'drakeScale',
    lootItemName: 'Drake Scale',
    activeFunction: 'sec',
    resonantSigil: 'sec_tan',
  },
};

export interface MinionRuntime {
  readonly id: string;
  readonly minionType: MinionType;
  readonly homeX: number;
  readonly homeZ: number;
  readonly patrolRadius: number;
  readonly leashRadius: number;

  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;

  hp: number;
  maxHp: number;
  state: MinionState;
  stateTimer: number;

  patrolAngle: number;
  patrolPauseTimer: number;

  rootGroup?: THREE.Group;
  telegraphMesh?: THREE.Mesh;
  healthBarGroup?: THREE.Group;
  healthBarFill?: THREE.Mesh;
  modelBundle?: MinionModelBundle;
}

export interface MinionTickCallbacks {
  onDamagePlayer: (damage: number) => void;
  onMinionDefeated: (minion: MinionRuntime, wasResonant: boolean, lootItem: string, lootCount: number) => void;
}

/**
 * Creates a runtime minion state instance.
 */
export function createMinionRuntime(
  id: string,
  minionType: MinionType,
  homeX: number,
  homeZ: number,
  patrolRadius: number = 6.0,
  leashRadius: number = 14.0
): MinionRuntime {
  const cfg = MINION_CONFIGS[minionType];
  const y = getTerrainHeight(homeX, homeZ);
  return {
    id,
    minionType,
    homeX,
    homeZ,
    patrolRadius,
    leashRadius,
    x: homeX,
    y,
    z: homeZ,
    vx: 0,
    vz: 0,
    yaw: Math.random() * Math.PI * 2,
    hp: cfg.maxHp,
    maxHp: cfg.maxHp,
    state: 'IDLE_PATROL',
    stateTimer: 0,
    patrolAngle: Math.random() * Math.PI * 2,
    patrolPauseTimer: 1.0 + Math.random() * 2.0,
  };
}

/**
 * Instantiates the 3D meshes for a minion runtime (sculpted model, health bar billboard, and telegraph disk).
 */
export function buildMinionVisuals(minion: MinionRuntime): THREE.Group {
  const root = new THREE.Group();
  root.name = `minion_${minion.id}_${minion.minionType}`;
  root.position.set(minion.x, minion.y, minion.z);
  root.rotation.y = minion.yaw;

  // 1. Procedural 3D Model
  let bundle: MinionModelBundle;
  if (minion.minionType === 'wolf') {
    bundle = createPhaseWolfModel();
  } else if (minion.minionType === 'skeleton') {
    bundle = createSkeletalSentinelModel();
  } else {
    bundle = createDrakeWyrmlingModel();
  }
  root.add(bundle.group);
  minion.modelBundle = bundle;

  // 2. Health Bar Billboard (floating above minion's head)
  const healthBarGroup = new THREE.Group();
  healthBarGroup.position.set(0, minion.minionType === 'drake' ? 1.8 : 1.6, 0);

  const bgGeo = new THREE.PlaneGeometry(0.85, 0.12);
  const bgMat = new THREE.MeshBasicMaterial({ color: 0x18181b, side: THREE.DoubleSide });
  const bgMesh = new THREE.Mesh(bgGeo, bgMat);
  healthBarGroup.add(bgMesh);

  const fillGeo = new THREE.PlaneGeometry(0.81, 0.08);
  fillGeo.translate(0.405, 0, 0); // Origin at left edge for easy scaling
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide });
  const fillMesh = new THREE.Mesh(fillGeo, fillMat);
  fillMesh.position.set(-0.405, 0, 0.005);
  healthBarGroup.add(fillMesh);

  root.add(healthBarGroup);
  minion.healthBarGroup = healthBarGroup;
  minion.healthBarFill = fillMesh;

  // 3. Ground Runic Telegraph Disk (shown during ATTACK_WINDUP)
  const cfg = MINION_CONFIGS[minion.minionType];
  const diskGeo = new THREE.RingGeometry(0.1, cfg.telegraphRadius, 24);
  const diskMat = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
  });
  const diskMesh = new THREE.Mesh(diskGeo, diskMat);
  diskMesh.rotation.x = -Math.PI * 0.5;
  diskMesh.position.y = 0.05;
  diskMesh.visible = false;
  root.add(diskMesh);
  minion.telegraphMesh = diskMesh;

  minion.rootGroup = root;
  return root;
}

/**
 * Executes a single simulation step for a minion entity.
 */
export function stepMinionEntity(
  minion: MinionRuntime,
  dt: number,
  playerPos: { x: number; y: number; z: number },
  callbacks?: MinionTickCallbacks
): void {
  if (minion.state === 'DEFEATED') {
    if (minion.rootGroup) {
      minion.rootGroup.visible = false;
    }
    return;
  }

  const cfg = MINION_CONFIGS[minion.minionType];
  const distToPlayer = Math.hypot(playerPos.x - minion.x, playerPos.z - minion.z);
  const distFromHome = Math.hypot(minion.x - minion.homeX, minion.z - minion.homeZ);

  // Health bar billboard scaling
  if (minion.healthBarFill) {
    const fraction = Math.max(0, Math.min(1, minion.hp / minion.maxHp));
    minion.healthBarFill.scale.x = fraction;
    if (minion.healthBarGroup) {
      // Hide health bar if full HP and idle
      minion.healthBarGroup.visible = minion.hp < minion.maxHp || minion.state !== 'IDLE_PATROL';
    }
  }

  // --- State Machine ---
  if (minion.state === 'STAGGERED') {
    minion.stateTimer -= dt;
    if (minion.telegraphMesh) minion.telegraphMesh.visible = false;
    if (minion.stateTimer <= 0) {
      minion.state = distToPlayer < cfg.attackRange * 2 ? 'CHASE' : 'IDLE_PATROL';
    }
  } else if (minion.state === 'ATTACK_WINDUP') {
    minion.stateTimer -= dt;
    if (minion.telegraphMesh) {
      minion.telegraphMesh.visible = true;
      const progress = 1.0 - Math.max(0, minion.stateTimer / cfg.windupDuration);
      minion.telegraphMesh.scale.set(progress, progress, progress);
    }

    // Face player during windup
    const dx = playerPos.x - minion.x;
    const dz = playerPos.z - minion.z;
    minion.yaw = Math.atan2(dx, dz);

    if (minion.stateTimer <= 0) {
      // Execute attack strike!
      if (minion.telegraphMesh) minion.telegraphMesh.visible = false;
      if (distToPlayer <= cfg.telegraphRadius + 0.3) {
        if (callbacks) {
          callbacks.onDamagePlayer(cfg.attackDamage);
        }
      }
      minion.state = 'CHASE';
    }
  } else if (distFromHome > minion.leashRadius) {
    // Leash: Disengage and retreat to home
    if (minion.telegraphMesh) minion.telegraphMesh.visible = false;
    const toHomeX = minion.homeX - minion.x;
    const toHomeZ = minion.homeZ - minion.z;
    const distHome = Math.hypot(toHomeX, toHomeZ);
    if (distHome > 0.5) {
      minion.yaw = Math.atan2(toHomeX, toHomeZ);
      const step = Math.min(distHome, cfg.speed * dt * 1.5);
      minion.x += (toHomeX / distHome) * step;
      minion.z += (toHomeZ / distHome) * step;
    } else {
      minion.state = 'IDLE_PATROL';
    }
  } else if (minion.state === 'CHASE') {
    if (distToPlayer <= cfg.attackRange) {
      // Begin Attack Windup
      minion.state = 'ATTACK_WINDUP';
      minion.stateTimer = cfg.windupDuration;
      if (minion.telegraphMesh) {
        minion.telegraphMesh.visible = true;
        minion.telegraphMesh.scale.set(0.1, 0.1, 0.1);
      }
    } else if (distToPlayer > 18.0) {
      // Player fled out of aggro range
      minion.state = 'IDLE_PATROL';
    } else {
      // Chase player
      const dx = playerPos.x - minion.x;
      const dz = playerPos.z - minion.z;
      const len = Math.max(0.01, Math.hypot(dx, dz));
      minion.yaw = Math.atan2(dx, dz);
      const step = Math.min(len, cfg.chaseSpeed * dt);
      minion.x += (dx / len) * step;
      minion.z += (dz / len) * step;
    }
  } else {
    // IDLE_PATROL
    if (distToPlayer <= 10.0 && distFromHome < minion.leashRadius) {
      minion.state = 'CHASE';
    } else {
      // Gentle perimeter patrol around home point
      if (minion.patrolPauseTimer > 0) {
        minion.patrolPauseTimer -= dt;
      } else {
        minion.patrolAngle += dt * 0.45;
        const targetX = minion.homeX + Math.cos(minion.patrolAngle) * (minion.patrolRadius * 0.6);
        const targetZ = minion.homeZ + Math.sin(minion.patrolAngle) * (minion.patrolRadius * 0.6);
        const dx = targetX - minion.x;
        const dz = targetZ - minion.z;
        const dist = Math.hypot(dx, dz);

        if (dist > 0.4) {
          minion.yaw = Math.atan2(dx, dz);
          const step = Math.min(dist, cfg.speed * dt);
          minion.x += (dx / dist) * step;
          minion.z += (dz / dist) * step;
        } else {
          minion.patrolPauseTimer = 1.5 + Math.random() * 2.0;
        }
      }
    }
  }

  // Ground alignment
  minion.y = getTerrainHeight(minion.x, minion.z);

  // Update 3D Model transforms and animation
  if (minion.rootGroup) {
    minion.rootGroup.position.set(minion.x, minion.y, minion.z);
    minion.rootGroup.rotation.y = minion.yaw;
  }
  if (minion.modelBundle) {
    minion.modelBundle.update(dt, minion.state);
  }
}

/**
 * Applies player damage to a minion entity with trigonometric resonance check.
 * Standard sword slash deals base attack damage.
 * Matching derivative sigil deals 2.5x critical damage, instant stagger, and bonus loot drop.
 */
export function applyDamageToMinion(
  minion: MinionRuntime,
  rawAttackDamage: number,
  chosenSigil?: DerivativeSigilId,
  harmonicsMultiplier: number = 1.0,
  callbacks?: MinionTickCallbacks
): {
  damage: number;
  isResonant: boolean;
  defeated: boolean;
  bonusLoot: boolean;
} {
  if (minion.state === 'DEFEATED') {
    return { damage: 0, isResonant: false, defeated: true, bonusLoot: false };
  }

  const cfg = MINION_CONFIGS[minion.minionType];
  const isResonant = chosenSigil === cfg.resonantSigil;

  let damage: number;
  let bonusLoot = false;

  if (isResonant) {
    // 2.5x Critical Damage + Instant Stagger + Bonus Loot
    damage = Math.max(1, Math.round(rawAttackDamage * 2.5 * harmonicsMultiplier));
    bonusLoot = true;
    minion.state = 'STAGGERED';
    minion.stateTimer = 1.2;
    if (minion.telegraphMesh) minion.telegraphMesh.visible = false;
  } else {
    // Standard basic slash damage
    damage = Math.max(1, Math.round(rawAttackDamage));
    if (minion.state !== 'ATTACK_WINDUP' && minion.state !== 'STAGGERED') {
      minion.state = 'CHASE';
    }
  }

  minion.hp = Math.max(0, minion.hp - damage);

  let defeated = false;
  if (minion.hp <= 0) {
    defeated = true;
    minion.state = 'DEFEATED';
    if (minion.telegraphMesh) minion.telegraphMesh.visible = false;
    if (minion.rootGroup) minion.rootGroup.visible = false;

    const lootCount = isResonant ? 2 : 1;
    if (callbacks) {
      callbacks.onMinionDefeated(minion, isResonant, cfg.lootItem, lootCount);
    }
  }

  return { damage, isResonant, defeated, bonusLoot };
}

/**
 * Resets a minion's health, position, and state back to home baseline (e.g. upon Sanctuary rest).
 */
export function respawnMinion(minion: MinionRuntime): void {
  const cfg = MINION_CONFIGS[minion.minionType];
  minion.x = minion.homeX;
  minion.z = minion.homeZ;
  minion.y = getTerrainHeight(minion.homeX, minion.homeZ);
  minion.hp = cfg.maxHp;
  minion.state = 'IDLE_PATROL';
  minion.stateTimer = 0;
  if (minion.telegraphMesh) minion.telegraphMesh.visible = false;
  if (minion.rootGroup) {
    minion.rootGroup.visible = true;
    minion.rootGroup.position.set(minion.x, minion.y, minion.z);
  }
}
