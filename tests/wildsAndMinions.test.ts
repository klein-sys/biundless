import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  addInventoryItem,
  canUpgradeFlask,
  canUpgradeWeapon,
  computeEffectiveStats,
  createDefaultProgression,
  getInventoryCount,
  loadProgression,
  upgradeFlask,
  upgradeWeapon,
} from '../src/rpg/progressionSystem';
import {
  createDrakeWyrmlingModel,
  createFloraNodeModel,
  createOreNodeModel,
  createPhaseWolfModel,
  createSkeletalSentinelModel,
  createTrailheadSignpost,
} from '../src/engine/ProceduralModels';
import {
  applyDamageToMinion,
  buildMinionVisuals,
  createMinionRuntime,
  MINION_CONFIGS,
  respawnMinion,
  stepMinionEntity,
  type MinionRuntime,
} from '../src/entities/MinionEntities';
import {
  GATHERING_NODES,
  TRAILHEAD_SIGNPOSTS,
  WILD_MINION_SPAWNS,
} from '../src/world/SunlitValley';
import { DialogueRunner } from '../src/dialogue/dialogueRunner';

function countTriangles(obj: THREE.Object3D): number {
  let triangles = 0;
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geo = child.geometry as THREE.BufferGeometry;
      const count = geo.index ? geo.index.count : geo.attributes.position.count;
      triangles += count / 3;
    }
  });
  return triangles;
}

describe('Wild Minions, Gathering Nodes & Progression System', () => {
  describe('A. Inventory & Crafting Upgrades', () => {
    it('initializes default progression with satchel inventory, weapon level 1, and 3 max flasks', () => {
      const state = createDefaultProgression();
      expect(state.inventory).toEqual({});
      expect(state.weaponLevel).toBe(1);
      expect(state.maxFlasks).toBe(3);

      const stats = computeEffectiveStats(state);
      expect(stats.weaponDamageMultiplier).toBe(1.0);
      expect(stats.maxFlasks).toBe(3);
    });

    it('correctly tracks and updates inventory items', () => {
      const state = createDefaultProgression();
      expect(getInventoryCount(state, 'mithrilOre')).toBe(0);

      addInventoryItem(state, 'mithrilOre', 2);
      expect(getInventoryCount(state, 'mithrilOre')).toBe(2);

      addInventoryItem(state, 'ancientBone', 1);
      expect(getInventoryCount(state, 'ancientBone')).toBe(1);

      addInventoryItem(state, 'mithrilOre', 3);
      expect(getInventoryCount(state, 'mithrilOre')).toBe(5);
    });

    it('checks weapon upgrade prerequisites and upgrades up to level 5 (+10% damage each tier)', () => {
      const state = createDefaultProgression();
      expect(canUpgradeWeapon(state)).toBe(false);

      // Add partial materials
      addInventoryItem(state, 'mithrilOre', 1);
      expect(canUpgradeWeapon(state)).toBe(false);

      addInventoryItem(state, 'mithrilOre', 1); // 2 total
      addInventoryItem(state, 'ancientBone', 1); // 1 total
      expect(canUpgradeWeapon(state)).toBe(true);

      // Upgrade to Tier 2
      const upgraded = upgradeWeapon(state);
      expect(upgraded).toBe(true);
      expect(state.weaponLevel).toBe(2);
      expect(getInventoryCount(state, 'mithrilOre')).toBe(0);
      expect(getInventoryCount(state, 'ancientBone')).toBe(0);

      const stats = computeEffectiveStats(state);
      expect(stats.weaponDamageMultiplier).toBe(1.1); // +10%

      // Fast forward to level 5
      state.weaponLevel = 5;
      addInventoryItem(state, 'mithrilOre', 10);
      addInventoryItem(state, 'ancientBone', 10);
      expect(canUpgradeWeapon(state)).toBe(false); // Capped at 5
      expect(upgradeWeapon(state)).toBe(false);
      expect(computeEffectiveStats(state).weaponDamageMultiplier).toBe(1.4); // +40%
    });

    it('checks flask upgrade prerequisites and upgrades up to max capacity 5', () => {
      const state = createDefaultProgression();
      expect(canUpgradeFlask(state)).toBe(false);

      addInventoryItem(state, 'moonbell', 2);
      addInventoryItem(state, 'phaseEssence', 1);
      expect(canUpgradeFlask(state)).toBe(true);

      const upgraded = upgradeFlask(state);
      expect(upgraded).toBe(true);
      expect(state.maxFlasks).toBe(4);
      expect(getInventoryCount(state, 'moonbell')).toBe(0);
      expect(getInventoryCount(state, 'phaseEssence')).toBe(0);

      // Upgrade to 5
      addInventoryItem(state, 'moonbell', 2);
      addInventoryItem(state, 'phaseEssence', 1);
      expect(upgradeFlask(state)).toBe(true);
      expect(state.maxFlasks).toBe(5);

      // Capped at 5
      addInventoryItem(state, 'moonbell', 2);
      addInventoryItem(state, 'phaseEssence', 1);
      expect(canUpgradeFlask(state)).toBe(false);
      expect(upgradeFlask(state)).toBe(false);
    });

    it('serializes and deserializes with backward-compatible defaults when loading older saves', () => {
      const partialJson = JSON.stringify({
        level: 3,
        xp: 400,
        statPoints: 1,
        vigor: 1,
        endurance: 0,
        harmonics: 1,
        quests: {},
        defeatedBosses: ['witch'],
        // Older saves missing inventory, weaponLevel, maxFlasks
      });

      // Mock localStorage
      const mockStorage: Record<string, string> = {
        ashen_tangent_progression_v1: partialJson,
      };
      if (typeof globalThis.localStorage === 'undefined') {
        (globalThis as any).localStorage = {
          getItem: (k: string) => mockStorage[k] ?? null,
          setItem: (k: string, v: string) => { mockStorage[k] = v; },
        };
      }

      const loaded = loadProgression();
      expect(loaded.level).toBe(3);
      expect(loaded.inventory).toEqual({});
      expect(loaded.weaponLevel).toBe(1);
      expect(loaded.maxFlasks).toBe(3);
    });
  });

  describe('B. Procedural 3D Sculpting & Mobile Budgets (SculptKit)', () => {
    it('creates a Boss-Tier Phase Wolf model adhering to the <1,200 triangle budget', () => {
      const wolf = createPhaseWolfModel();
      expect(wolf.group).toBeDefined();

      const tris = countTriangles(wolf.group);
      expect(tris).toBeGreaterThan(100);
      expect(tris).toBeLessThan(1200);

      // Runs update cycle across states without throwing
      expect(() => {
        wolf.update(0.016, 'IDLE_PATROL');
        wolf.update(0.016, 'CHASE');
        wolf.update(0.016, 'ATTACK_WINDUP');
        wolf.update(0.016, 'STAGGERED');
      }).not.toThrow();
    });

    it('creates a Boss-Tier Skeletal Sentinel model adhering to the <1,200 triangle budget', () => {
      const skel = createSkeletalSentinelModel();
      expect(skel.group).toBeDefined();

      const tris = countTriangles(skel.group);
      expect(tris).toBeGreaterThan(150);
      expect(tris).toBeLessThan(1200);

      expect(() => {
        skel.update(0.016, 'IDLE_PATROL');
        skel.update(0.016, 'CHASE');
        skel.update(0.016, 'ATTACK_WINDUP');
        skel.update(0.016, 'STAGGERED');
      }).not.toThrow();
    });

    it('creates a Boss-Tier Drake Wyrmling model adhering to the <1,200 triangle budget', () => {
      const drake = createDrakeWyrmlingModel();
      expect(drake.group).toBeDefined();

      const tris = countTriangles(drake.group);
      expect(tris).toBeGreaterThan(150);
      expect(tris).toBeLessThan(1200);

      expect(() => {
        drake.update(0.016, 'IDLE_PATROL');
        drake.update(0.016, 'CHASE');
        drake.update(0.016, 'ATTACK_WINDUP');
      }).not.toThrow();
    });

    it('creates a Mithril Ore Node model with harvest state toggling (<400 tris)', () => {
      const ore = createOreNodeModel();
      expect(ore.group).toBeDefined();
      expect(countTriangles(ore.group)).toBeLessThan(400);

      expect(() => {
        ore.update(0.016);
        ore.setHarvested(true);
        ore.update(0.016);
        ore.setHarvested(false);
      }).not.toThrow();
    });

    it('creates a Moonbell Flora Node model with harvest state toggling (<400 tris)', () => {
      const flora = createFloraNodeModel();
      expect(flora.group).toBeDefined();
      expect(countTriangles(flora.group)).toBeLessThan(400);

      expect(() => {
        flora.update(0.016);
        flora.setHarvested(true);
        flora.update(0.016);
        flora.setHarvested(false);
      }).not.toThrow();
    });

    it('creates a Trailhead Signpost model with directional arrows (<350 tris)', () => {
      const sign = createTrailheadSignpost('Test Trail');
      expect(sign).toBeDefined();
      expect(countTriangles(sign)).toBeLessThan(350);
    });
  });

  describe('C. Minion Entity Runtime & Trigonometric Resonance Combat', () => {
    it('initializes minion runtime and builds complete visuals (health bar billboard and telegraph ring)', () => {
      const minion = createMinionRuntime('wolf_1', 'wolf', -26, -22, 6.0, 14.0);
      expect(minion.hp).toBe(45);
      expect(minion.maxHp).toBe(45);
      expect(minion.state).toBe('IDLE_PATROL');

      const visuals = buildMinionVisuals(minion);
      expect(visuals).toBeDefined();
      expect(minion.healthBarGroup).toBeDefined();
      expect(minion.healthBarFill).toBeDefined();
      expect(minion.telegraphMesh).toBeDefined();
    });

    it('transitions from IDLE_PATROL to CHASE when player enters detection radius (<10m)', () => {
      const minion = createMinionRuntime('wolf_1', 'wolf', 0, 0, 6.0, 14.0);
      buildMinionVisuals(minion);

      // Player at distance 8m
      stepMinionEntity(minion, 0.1, { x: 8, y: 0, z: 0 });
      expect(minion.state).toBe('CHASE');
    });

    it('transitions from CHASE to ATTACK_WINDUP when reaching melee range and deals damage after windup', () => {
      const minion = createMinionRuntime('wolf_1', 'wolf', 0, 0, 6.0, 14.0);
      buildMinionVisuals(minion);
      minion.state = 'CHASE';

      let damageDealt = 0;
      const callbacks = {
        onDamagePlayer: (dmg: number) => { damageDealt = dmg; },
        onMinionDefeated: () => {},
      };

      // Player in melee range (1.8m)
      stepMinionEntity(minion, 0.05, { x: 1.8, y: 0, z: 0 }, callbacks);
      expect(minion.state).toBe('ATTACK_WINDUP');
      expect(minion.telegraphMesh?.visible).toBe(true);

      // Complete windup (0.6s)
      stepMinionEntity(minion, 0.65, { x: 1.8, y: 0, z: 0 }, callbacks);
      expect(damageDealt).toBe(MINION_CONFIGS.wolf.attackDamage);
      expect(minion.state).toBe('CHASE');
      expect(minion.telegraphMesh?.visible).toBe(false);
    });

    it('leashes back toward home when dragged beyond leash radius (14m)', () => {
      const minion = createMinionRuntime('skel_1', 'skeleton', 0, 0, 6.0, 14.0);
      buildMinionVisuals(minion);
      minion.x = 16; // Beyond 14m leash

      stepMinionEntity(minion, 0.1, { x: 20, y: 0, z: 0 });
      // Should move toward 0,0
      expect(minion.x).toBeLessThan(16);
    });

    it('resolves standard attack damage without resonance', () => {
      const minion = createMinionRuntime('wolf_1', 'wolf', 0, 0);
      const res = applyDamageToMinion(minion, 20, undefined);
      expect(res.isResonant).toBe(false);
      expect(res.damage).toBe(20);
      expect(minion.hp).toBe(25);
    });

    it('resolves 2.5x critical damage, instant stagger, and bonus loot on matching trig derivative sigil', () => {
      // Wolf is sin -> expected resonant sigil is cos (HP is 45)
      const wolf = createMinionRuntime('wolf_1', 'wolf', 0, 0);
      const resWolf = applyDamageToMinion(wolf, 10, 'cos', 1.0);
      expect(resWolf.isResonant).toBe(true);
      expect(resWolf.damage).toBe(25); // 10 * 2.5
      expect(wolf.hp).toBe(20);
      expect(wolf.state).toBe('STAGGERED');
      expect(resWolf.bonusLoot).toBe(true);

      // Skeleton is tan -> expected resonant sigil is sec2 (HP is 55)
      const skel = createMinionRuntime('skel_1', 'skeleton', 0, 0);
      const resSkel = applyDamageToMinion(skel, 10, 'sec2', 1.0);
      expect(resSkel.isResonant).toBe(true);
      expect(resSkel.damage).toBe(25);
      expect(skel.hp).toBe(30);
      expect(skel.state).toBe('STAGGERED');

      // Drake is sec -> expected resonant sigil is sec_tan (HP is 50)
      const drake = createMinionRuntime('drake_1', 'drake', 0, 0);
      const resDrake = applyDamageToMinion(drake, 10, 'sec_tan', 1.0);
      expect(resDrake.isResonant).toBe(true);
      expect(resDrake.damage).toBe(25);
      expect(drake.hp).toBe(25);
      expect(drake.state).toBe('STAGGERED');
    });

    it('defeats minion and fires defeat callback with bonus loot when killed via resonance', () => {
      const wolf = createMinionRuntime('wolf_1', 'wolf', 0, 0);
      let receivedItem = '';
      let receivedCount = 0;

      const callbacks = {
        onDamagePlayer: () => {},
        onMinionDefeated: (_m: MinionRuntime, _wasRes: boolean, item: string, count: number) => {
          receivedItem = item;
          receivedCount = count;
        },
      };

      const res = applyDamageToMinion(wolf, 30, 'cos', 1.0, callbacks);
      expect(res.defeated).toBe(true);
      expect(wolf.state).toBe('DEFEATED');
      expect(receivedItem).toBe('phaseEssence');
      expect(receivedCount).toBe(2); // Bonus loot from resonance!
    });

    it('respawns minion back to full health and home position upon sanctuary rest', () => {
      const wolf = createMinionRuntime('wolf_1', 'wolf', 10, 20);
      buildMinionVisuals(wolf);
      wolf.x = 5;
      wolf.z = 15;
      wolf.hp = 0;
      wolf.state = 'DEFEATED';

      respawnMinion(wolf);
      expect(wolf.x).toBe(10);
      expect(wolf.z).toBe(20);
      expect(wolf.hp).toBe(45);
      expect(wolf.state).toBe('IDLE_PATROL');
    });
  });

  describe('D. Town NPC Dialogue Turn-Ins for Crafting Upgrades', () => {
    it('allows Theron the Blacksmith to refine Spellblade when materials are provided', () => {
      const progression = createDefaultProgression();
      addInventoryItem(progression, 'mithrilOre', 2);
      addInventoryItem(progression, 'ancientBone', 1);

      let toastMsg = '';
      const runner = new DialogueRunner(progression, {
        onShowToast: (msg) => { toastMsg = msg; },
        onStateChanged: () => {},
      });

      runner.startDialogue('blacksmith');
      const choices = runner.getAvailableChoices();
      const upgradeChoice = choices.find((c) => c.action === 'upgrade_weapon');
      expect(upgradeChoice).toBeDefined();

      runner.selectChoice(upgradeChoice!);
      expect(progression.weaponLevel).toBe(2);
      expect(toastMsg).toContain('SPELLBLADE REFINED');
    });

    it('allows Lyra the Herbalist to brew Crimson Draught when materials are provided', () => {
      const progression = createDefaultProgression();
      addInventoryItem(progression, 'moonbell', 2);
      addInventoryItem(progression, 'phaseEssence', 1);

      let toastMsg = '';
      const runner = new DialogueRunner(progression, {
        onShowToast: (msg) => { toastMsg = msg; },
        onStateChanged: () => {},
      });

      runner.startDialogue('herbalist');
      const choices = runner.getAvailableChoices();
      const brewChoice = choices.find((c) => c.action === 'upgrade_flask');
      expect(brewChoice).toBeDefined();

      runner.selectChoice(brewChoice!);
      expect(progression.maxFlasks).toBe(4);
      expect(toastMsg).toContain('CRIMSON DRAUGHT BREWED');
    });
  });

  describe('E. World Gathering Nodes & Trailhead Signposts Placement', () => {
    it('defines gathering nodes along all 3 boss wilderness trails', () => {
      expect(GATHERING_NODES.length).toBeGreaterThanOrEqual(9);

      const gladeNodes = GATHERING_NODES.filter((n) => n.id.includes('glade'));
      const ruinsNodes = GATHERING_NODES.filter((n) => n.id.includes('ruins'));
      const peakNodes = GATHERING_NODES.filter((n) => n.id.includes('peak'));

      expect(gladeNodes.length).toBeGreaterThanOrEqual(3);
      expect(ruinsNodes.length).toBeGreaterThanOrEqual(3);
      expect(peakNodes.length).toBeGreaterThanOrEqual(3);
    });

    it('places trailhead signposts outside the South Gate and North Gate', () => {
      expect(TRAILHEAD_SIGNPOSTS.length).toBeGreaterThanOrEqual(2);
      const southSign = TRAILHEAD_SIGNPOSTS.find((s) => s.id === 'signpost_south_gate');
      const northSign = TRAILHEAD_SIGNPOSTS.find((s) => s.id === 'signpost_north_gate');

      expect(southSign).toBeDefined();
      expect(southSign!.z).toBeGreaterThan(20); // Outside South Gate
      expect(northSign).toBeDefined();
      expect(northSign!.z).toBeLessThan(-20); // Outside North Gate
    });

    it('defines wild minion spawns for all 3 wilderness quadrants', () => {
      expect(WILD_MINION_SPAWNS.length).toBeGreaterThanOrEqual(6);
      const wolves = WILD_MINION_SPAWNS.filter((s) => s.type === 'wolf');
      const skeletons = WILD_MINION_SPAWNS.filter((s) => s.type === 'skeleton');
      const drakes = WILD_MINION_SPAWNS.filter((s) => s.type === 'drake');

      expect(wolves.length).toBeGreaterThanOrEqual(2);
      expect(skeletons.length).toBeGreaterThanOrEqual(2);
      expect(drakes.length).toBeGreaterThanOrEqual(2);
    });
  });
});
