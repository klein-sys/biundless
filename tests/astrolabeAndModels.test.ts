import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateWavePlotData, type TrigFunctionId } from '../src/math/trigDerivatives';
import { BIOME_LANDMARKS, LANDMARK_BY_ID, WORLD_PLAYABLE_RADIUS } from '../src/world/SunlitValley';
import {
  createBossModel,
  createPlayerModel,
  createSolsticeHavenVillage,
  createTheronBlacksmith,
  createAstrolabeGazebo,
  createArchmageAurelius,
} from '../src/engine/ProceduralModels';

describe('Astrolabe Grimoire SVG Plotter', () => {
  const trigFns: TrigFunctionId[] = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc'];

  it.each(trigFns)('generates valid SVG path data and tangent lines for %s', (fn) => {
    const theta = Math.PI / 4;
    const plot = generateWavePlotData(fn, theta, 360, 180);

    expect(plot.pathData).toBeTruthy();
    expect(plot.pathData.startsWith('M')).toBe(true);
    expect(plot.tangentLine).toBeDefined();
    expect(Number.isFinite(plot.tangentLine.x1)).toBe(true);
    expect(Number.isFinite(plot.tangentLine.y1)).toBe(true);
    expect(Number.isFinite(plot.tangentLine.x2)).toBe(true);
    expect(Number.isFinite(plot.tangentLine.y2)).toBe(true);

    // Verify contact point is mapped within SVG bounds
    expect(plot.contactPoint.x).toBeGreaterThanOrEqual(0);
    expect(plot.contactPoint.x).toBeLessThanOrEqual(360);
    expect(plot.contactPoint.y).toBeGreaterThanOrEqual(0);
    expect(plot.contactPoint.y).toBeLessThanOrEqual(180);

    // Verify axis ticks are present
    expect(plot.ticks.length).toBeGreaterThan(0);
  });

  it('handles near-asymptote angles safely without NaN or infinite paths', () => {
    // tan has an asymptote at pi/2
    const thetaNearAsymptote = Math.PI * 0.5 - 0.001;
    const plot = generateWavePlotData('tan', thetaNearAsymptote, 360, 180);

    expect(plot.pathData).not.toContain('NaN');
    expect(Number.isFinite(plot.contactPoint.x)).toBe(true);
    expect(Number.isFinite(plot.contactPoint.y)).toBe(true);
    expect(Number.isFinite(plot.tangentLine.x1)).toBe(true);
    expect(Number.isFinite(plot.tangentLine.y1)).toBe(true);
  });
});

describe('Relocated Boss Sanctuaries & World Geography', () => {
  it('relocates all boss sanctuaries into distinct secluded quadrants within the playable radius', () => {
    const hub = LANDMARK_BY_ID.hub;
    expect(hub.x).toBe(0);
    expect(hub.z).toBe(0);

    const witch = LANDMARK_BY_ID.witch;
    const lich = LANDMARK_BY_ID.lich;
    const dragon = LANDMARK_BY_ID.dragon;

    // Bosses should no longer be huddled at the same northern distance
    const distWitch = Math.hypot(witch.x, witch.z);
    const distLich = Math.hypot(lich.x, lich.z);
    const distDragon = Math.hypot(dragon.x, dragon.z);

    expect(distWitch).toBeLessThan(WORLD_PLAYABLE_RADIUS);
    expect(distLich).toBeLessThan(WORLD_PLAYABLE_RADIUS);
    expect(distDragon).toBeLessThan(WORLD_PLAYABLE_RADIUS);

    // Bosses are spread across distinct quadrants (Witch North-West, Lich South, Dragon North-East)
    expect(witch.x).toBeLessThan(0);
    expect(witch.z).toBeLessThan(0);

    expect(lich.z).toBeGreaterThan(0); // Relocated south into excavation necropolis

    expect(dragon.x).toBeGreaterThan(0);
    expect(dragon.z).toBeLessThan(0);

    // Territory radii are valid
    for (const lm of BIOME_LANDMARKS) {
      expect(lm.territoryRadius).toBeGreaterThanOrEqual(24);
      expect(lm.plateauRadius).toBeGreaterThanOrEqual(18);
    }
  });
});

describe('Stylized 3D Procedural Models & Solstice Haven Living Town', () => {
  it('creates an enriched Spellblade player rig with articulated limbs and responsive sigil attunement', () => {
    const rig = createPlayerModel();

    expect(rig.root).toBeInstanceOf(THREE.Group);
    expect(rig.bodyMeshGroup).toBeInstanceOf(THREE.Group);
    expect(rig.legLeft).toBeInstanceOf(THREE.Group);
    expect(rig.legRight).toBeInstanceOf(THREE.Group);
    expect(rig.armLeft).toBeInstanceOf(THREE.Group);
    expect(rig.armRight).toBeInstanceOf(THREE.Group);
    expect(rig.cloakPivot).toBeInstanceOf(THREE.Group);
    expect(rig.bladePivot).toBeInstanceOf(THREE.Group);
    expect(rig.astrolabeRing).toBeInstanceOf(THREE.Mesh);
    expect(rig.outerHaloRing).toBeInstanceOf(THREE.Mesh);

    // Sigil accent color update test
    expect(() => rig.setSigilAccent('#e65c92')).not.toThrow();

    // First person toggle test
    rig.setFirstPersonHidden(true);
    expect(rig.bodyMeshGroup.visible).toBe(false);
    expect(rig.firstPersonBlade.visible).toBe(true);

    rig.setFirstPersonHidden(false);
    expect(rig.bodyMeshGroup.visible).toBe(true);
    expect(rig.firstPersonBlade.visible).toBe(false);
  });

  it('creates stylized unique boss models for Vespera, Malakor, and Vaelorath', () => {
    const witchRig = createBossModel('witch');
    expect(witchRig.root).toBeInstanceOf(THREE.Group);
    expect(witchRig.orbitParts.length).toBe(3);
    expect(witchRig.veilRibbons?.length).toBeGreaterThanOrEqual(2);

    const lichRig = createBossModel('lich');
    expect(lichRig.root).toBeInstanceOf(THREE.Group);
    expect(lichRig.orbitParts.length).toBe(4);

    const dragonRig = createBossModel('dragon');
    expect(dragonRig.root).toBeInstanceOf(THREE.Group);
    expect(dragonRig.wingLeft).toBeDefined();
    expect(dragonRig.wingRight).toBeDefined();
    expect(dragonRig.neckSegments?.length).toBe(3);
    expect(dragonRig.tailSegments?.length).toBe(5);
  });

  it('creates Solstice Haven village with both interactive NPCs and autonomous ambient wandering townsfolk', () => {
    const village = createSolsticeHavenVillage();

    expect(village.group).toBeInstanceOf(THREE.Group);
    expect(village.obstacles.length).toBeGreaterThan(0);
    expect(village.interactiveNpcs.length).toBe(4); // Aurelius, Blacksmith, Herbalist, Scout

    // Call update to verify ambient wanderer systems step without throwing
    expect(() => {
      village.update(0.016);
      village.update(0.5);
      village.update(1.2);
    }).not.toThrow();
  });

  it('creates an articulated stylized Theron rig with forge, anvil, and spark systems', () => {
    const smith = createTheronBlacksmith();
    expect(smith.group).toBeInstanceOf(THREE.Group);

    let foundAnvil = false;
    let foundForge = false;
    let foundHammer = false;

    smith.group.traverse((child) => {
      if (child.name === 'theron_anvil') foundAnvil = true;
      if (child.name === 'theron_forge') foundForge = true;
      if (child.name === 'theron_hammer_arm') foundHammer = true;
    });

    expect(foundAnvil).toBe(true);
    expect(foundForge).toBe(true);
    expect(foundHammer).toBe(true);
  });

  it('steps the rhythmic hammering animation cycle without throwing', () => {
    const smith = createTheronBlacksmith();
    expect(() => {
      smith.update(0.016);
      smith.update(0.1);
      smith.update(0.5);
      smith.update(1.0);
    }).not.toThrow();
  });

  it('creates an integrated Astrolabe Gazebo with flush dome, entablature, and central orrery', () => {
    const gazebo = createAstrolabeGazebo();
    expect(gazebo.group).toBeInstanceOf(THREE.Group);

    let foundDome = false;
    let foundEntablature = false;
    let foundOrrery = false;

    gazebo.group.traverse((child) => {
      if (child.name === 'gazebo_dome') foundDome = true;
      if (child.name === 'gazebo_entablature') foundEntablature = true;
      if (child.name === 'gazebo_orrery') foundOrrery = true;
    });

    expect(foundDome).toBe(true);
    expect(foundEntablature).toBe(true);
    expect(foundOrrery).toBe(true);
  });

  it('creates an articulated Archmage Aurelius rig with pleated robes, braided beard, and armillary staff', () => {
    const aurelius = createArchmageAurelius();
    expect(aurelius.group).toBeInstanceOf(THREE.Group);

    let foundBeard = false;
    let foundStaff = false;
    let foundHat = false;

    aurelius.group.traverse((child) => {
      if (child.name === 'aurelius_beard') foundBeard = true;
      if (child.name === 'aurelius_staff') foundStaff = true;
      if (child.name === 'aurelius_hat') foundHat = true;
    });

    expect(foundBeard).toBe(true);
    expect(foundStaff).toBe(true);
    expect(foundHat).toBe(true);
  });

  it('updates gazebo orrery and aurelius staff animations without throwing', () => {
    const gazebo = createAstrolabeGazebo();
    const aurelius = createArchmageAurelius();

    expect(() => {
      gazebo.update(0.016);
      gazebo.update(0.5);
      aurelius.update(0.016);
      aurelius.update(0.5);
    }).not.toThrow();
  });
});

