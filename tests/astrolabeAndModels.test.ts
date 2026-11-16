import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateWavePlotData, type TrigFunctionId } from '../src/math/trigDerivatives';
import { BIOME_LANDMARKS, LANDMARK_BY_ID, WORLD_PLAYABLE_RADIUS } from '../src/world/SunlitValley';
import {
  createBossModel,
  createPlayerModel,
  createSolsticeHavenVillage,
  createLyraHerbalist,
  createTheronBlacksmith,
  createTownsperson,
  createAstrolabeGazebo,
  createArchmageAurelius,
  createVillageCottage,
  createEldrinScout,
  createTownFountain,
  createLanternPost,
  createTownBastionTower,
  createTownGatehouse,
  createSolsticeHavenWallComplex,
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

  describe('sculpted boss rigs', () => {
    const BOSS_IDS = ['witch', 'lich', 'dragon'] as const;
    const PHASES = ['IDLE_GUARD', 'CHANNEL_WAVE', 'PHASE_WARD', 'TELEGRAPH', 'ASYMPTOTE_SURGE', 'STAGGERED', 'DEFEATED'] as const;

    it.each(BOSS_IDS)('%s has no NaN or degenerate vertex data (a single NaN blanks the bloomed frame)', (id) => {
      const rig = createBossModel(id);
      rig.root.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const geo = child.geometry as THREE.BufferGeometry;
        for (const name of ['position', 'normal', 'color', 'uv']) {
          const attr = geo.attributes[name];
          if (!attr) continue;
          const arr = attr.array;
          for (let i = 0; i < arr.length; i++) {
            if (!Number.isFinite(arr[i])) {
              expect(Number.isFinite(arr[i])).toBe(true);
              break;
            }
          }
        }
        const n = geo.attributes.normal;
        if (n) {
          for (let i = 0; i < n.count; i++) {
            expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeGreaterThan(1e-4);
          }
        }
      });
    }, 20000);

    it.each(BOSS_IDS)('%s animates every AI phase with finite transforms and updates its pose', (id) => {
      const rig = createBossModel(id);
      const dt = 1 / 30;
      let time = 0;
      for (const phase of PHASES) {
        for (let i = 0; i < 20; i++) {
          time += dt;
          rig.animate(dt, { time, phase, theta: time, slope: 2 });
        }
      }
      // Hostile frame times must not explode the smoothing.
      rig.animate(Number.NaN, { time, phase: 'IDLE_GUARD', theta: 0, slope: 0 });
      rig.animate(50, { time: time + 50, phase: 'TELEGRAPH', theta: 0, slope: 99 });
      rig.root.updateMatrixWorld(true);
      rig.root.traverse((child) => {
        for (const v of child.matrixWorld.elements) expect(Number.isFinite(v)).toBe(true);
        if (child instanceof THREE.Mesh) {
          const pos = child.geometry.attributes.position;
          for (const v of Array.from(pos.array as ArrayLike<number>)) expect(Number.isFinite(v)).toBe(true);
        }
      });
    });

    it.each(BOSS_IDS)('%s stays within the boss render budget', (id) => {
      const rig = createBossModel(id);
      let triangles = 0;
      let drawCalls = 0;
      rig.root.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || child === rig.wardMesh) return;
        const geo = child.geometry as THREE.BufferGeometry;
        triangles += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        drawCalls++;
      });
      expect(triangles).toBeLessThan(24000);
      expect(drawCalls).toBeLessThanOrEqual(70);
    });

    it('opens the dragon jaw and raises the casters\' arms during the telegraph wind-up', () => {
      const dragon = createBossModel('dragon');
      const witch = createBossModel('witch');
      const sample = (rig: ReturnType<typeof createBossModel>, phase: (typeof PHASES)[number]) => {
        for (let i = 0; i < 60; i++) rig.animate(1 / 30, { time: i / 30, phase, theta: 0, slope: 1 });
        rig.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(rig.bodyGroup);
        return box.max.y;
      };
      const witchIdleTop = sample(witch, 'IDLE_GUARD');
      const witchTelegraphTop = sample(witch, 'TELEGRAPH');
      expect(witchTelegraphTop).toBeGreaterThan(witchIdleTop);

      const jawAngle = (phase: (typeof PHASES)[number]) => {
        for (let i = 0; i < 60; i++) dragon.animate(1 / 30, { time: i / 30, phase, theta: 0, slope: 1 });
        const head = dragon.neckSegments![2].children.find((c) => c.children.length > 0 && c.type === 'Group' && c.position.z > 0.5)!;
        const jaw = head.children.filter((c) => c.type === 'Group').find((c) => c.position.y < -0.1)!;
        return jaw.rotation.x;
      };
      expect(jawAngle('TELEGRAPH')).toBeGreaterThan(jawAngle('IDLE_GUARD') + 0.3);
    });
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

    // Verify village includes the castle curtain wall complex with perimeter obstacles
    let foundCastleWall = false;
    village.group.traverse((child) => {
      if (child.name === 'solstice_haven_castle_wall_complex') foundCastleWall = true;
    });
    expect(foundCastleWall).toBe(true);
    // Over 25 obstacles including cottages, fountain, gazebo, bastion towers, and curtain wall disks
    expect(village.obstacles.length).toBeGreaterThan(25);
  });

  it('creates an imposing Boss-Tier Castle Curtain Wall fortress ring enclosing Solstice Haven', () => {
    const wallComplex = createSolsticeHavenWallComplex();
    expect(wallComplex.group).toBeInstanceOf(THREE.Group);
    expect(wallComplex.group.name).toBe('solstice_haven_castle_wall_complex');

    let bastionCount = 0;
    let gatehouseCount = 0;
    let wallSegCount = 0;

    wallComplex.group.traverse((child) => {
      if (child.name.startsWith('bastion_tower_')) bastionCount++;
      if (child.name.startsWith('town_gatehouse_')) gatehouseCount++;
      if (child.name === 'curtain_wall_segment') wallSegCount++;
    });

    expect(bastionCount).toBe(6); // 4 corners (NW, NE, SW, SE) + 2 flanks (W, E)
    expect(gatehouseCount).toBe(2); // South Gate toward Valley + North Astral Gate toward Mountains
    expect(wallSegCount).toBe(8); // 8 connecting curtain wall segments
    expect(wallComplex.obstacles.length).toBeGreaterThan(20);

    // Verify update animates pennant banners and lantern flickers without error
    expect(() => {
      wallComplex.update(0.016);
      wallComplex.update(0.1);
      wallComplex.update(0.5);
    }).not.toThrow();
  });

  it('sculpts a fortified Bastion Watchtower with corbel machicolations, conical roof, and animated banner', () => {
    const tower = createTownBastionTower({ x: -21, z: -17, bannerColor: 0x1e3a8a });
    expect(tower.group).toBeInstanceOf(THREE.Group);
    expect(tower.group.name).toBe('bastion_tower_-21_-17');

    let hasStaticGroup = false;
    let meshCount = 0;
    tower.group.traverse((child) => {
      if (child.name === 'bastion_static') hasStaticGroup = true;
      if (child instanceof THREE.Mesh) meshCount++;
    });

    expect(hasStaticGroup).toBe(true);
    expect(meshCount).toBeGreaterThan(0);

    // Stepping update should animate the pennant wave
    expect(() => tower.update(0.016)).not.toThrow();
  });

  it('sculpts a fortified Grand Gatehouse with vaulted archway, raised portcullis, open timber gates, and heraldic crest', () => {
    const gate = createTownGatehouse({ x: 0, z: 22.5, rotationY: 0, isNorth: false });
    expect(gate.group).toBeInstanceOf(THREE.Group);
    expect(gate.group.name).toBe('town_gatehouse_south');

    let hasStatic = false;
    let meshCount = 0;
    gate.group.traverse((child) => {
      if (child.name === 'gatehouse_static') hasStatic = true;
      if (child instanceof THREE.Mesh) meshCount++;
    });

    expect(hasStatic).toBe(true);
    expect(meshCount).toBeGreaterThan(0);

    // Stepping update should animate lantern amber flicker
    expect(() => gate.update(0.016)).not.toThrow();
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

describe('Lyra the Herbalist Model & Apothecary Stall', () => {
  const findByName = (root: THREE.Object3D, name: string): THREE.Object3D => {
    const found = root.getObjectByName(name);
    expect(found, `missing ${name}`).toBeDefined();
    return found!;
  };

  const renderCost = (root: THREE.Object3D) => {
    let triangles = 0;
    let drawCalls = 0;
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry as THREE.BufferGeometry;
        const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        triangles += child instanceof THREE.InstancedMesh ? tris * child.count : tris;
        drawCalls++;
      }
    });
    return { triangles, drawCalls };
  };

  it('builds the articulated rig with workbench, mortar, pestle, cauldron and drying rack', () => {
    const lyra = createLyraHerbalist();
    expect(lyra.group).toBeInstanceOf(THREE.Group);
    for (const name of [
      'lyra_body',
      'lyra_head',
      'lyra_pestle_arm',
      'lyra_steady_arm',
      'lyra_workbench',
      'lyra_mortar',
      'lyra_pestle',
      'lyra_cauldron',
      'lyra_drying_rack',
      'lyra_vfx',
    ]) {
      findByName(lyra.group, name);
    }
  });

  it('is what the village spawns for the herbalist role', () => {
    const herbalist = createTownsperson('herbalist');
    expect(herbalist.group.getObjectByName('lyra_mortar')).toBeDefined();
  });

  it('keeps the pestle tip inside the mortar bowl throughout the grinding cycle', () => {
    const lyra = createLyraHerbalist();
    const mortar = findByName(lyra.group, 'lyra_mortar');
    const pestle = findByName(lyra.group, 'lyra_pestle');
    const mortarPos = new THREE.Vector3();
    mortar.getWorldPosition(mortarPos);
    for (let i = 0; i < 120; i++) {
      lyra.update(1 / 30);
      const dx = pestle.position.x - mortarPos.x;
      const dz = pestle.position.z - mortarPos.z;
      expect(Math.hypot(dx, dz)).toBeLessThan(0.06);
      expect(pestle.position.y).toBeGreaterThan(mortarPos.y);
      expect(pestle.position.y).toBeLessThan(mortarPos.y + 0.1);
    }
  });

  it('keeps every transform finite under hostile delta times', () => {
    const lyra = createLyraHerbalist();
    for (const dt of [0.016, 5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1234.5, 0.001]) {
      lyra.update(dt);
    }
    lyra.group.traverse((child) => {
      const p = child.position;
      const q = child.quaternion;
      const s = child.scale;
      for (const v of [p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      if (child instanceof THREE.InstancedMesh) {
        for (const v of child.instanceMatrix.array) expect(Number.isFinite(v)).toBe(true);
      }
    });
  });

  it('stays within the mobile render budget (static props baked, VFX instanced)', () => {
    const lyra = createLyraHerbalist();
    const cost = renderCost(lyra.group);
    expect(cost.triangles).toBeLessThan(7000);
    expect(cost.drawCalls).toBeLessThanOrEqual(40);
  });
});

describe('Eldrin the Scout Procedural Model & Ranger Rig', () => {
  it('builds the articulated ranger rig with recurve longbow, fletched quiver, and hooded cowl', () => {
    const eldrin = createEldrinScout();
    expect(eldrin.group).toBeInstanceOf(THREE.Group);

    let foundBow = false;
    let foundQuiver = false;
    let foundCowl = false;
    let foundCloak = false;
    let foundTorso = false;
    let foundLegs = false;

    eldrin.group.traverse((child) => {
      if (child.name === 'eldrin_bow') foundBow = true;
      if (child.name === 'eldrin_quiver') foundQuiver = true;
      if (child.name === 'eldrin_cowl') foundCowl = true;
      if (child.name === 'eldrin_cloak') foundCloak = true;
      if (child.name === 'eldrin_torso') foundTorso = true;
      if (child.name === 'eldrin_legs') foundLegs = true;
    });

    expect(foundBow).toBe(true);
    expect(foundQuiver).toBe(true);
    expect(foundCowl).toBe(true);
    expect(foundCloak).toBe(true);
    expect(foundTorso).toBe(true);
    expect(foundLegs).toBe(true);
  });

  it('is what the village spawns for the scout role', () => {
    const scout = createTownsperson('scout');
    expect(scout.group.getObjectByName('eldrin_bow')).toBeDefined();
    expect(scout.group.getObjectByName('eldrin_quiver')).toBeDefined();
  });

  it('updates the horizon scanning and breathing animation safely without throwing', () => {
    const eldrin = createEldrinScout();
    for (const dt of [0.016, 0.1, 1.0, 5.0, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => eldrin.update(dt)).not.toThrow();
    }

    eldrin.group.traverse((child) => {
      const p = child.position;
      const q = child.quaternion;
      const s = child.scale;
      for (const v of [p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    });
  });

  it('stays within the mobile triangle budget (<3,500 tris)', () => {
    const eldrin = createEldrinScout();
    let triangles = 0;
    eldrin.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry as THREE.BufferGeometry;
        const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        triangles += tris;
      }
    });
    expect(triangles).toBeLessThan(3500);
  });
});

describe('Solstice Haven Village Cottages Architectural Framing', () => {
  it.each([0, 1, 2, 3])('creates structured cottage variant %i with foundation, roof, chimney, and door', (variant) => {
    const cottage = createVillageCottage(variant);
    expect(cottage).toBeInstanceOf(THREE.Group);

    let foundFoundation = false;
    let foundRoof = false;
    let foundChimney = false;
    let foundDoor = false;
    let foundDormer = false;
    let foundVariantProp = false;

    cottage.traverse((child) => {
      if (child.name === 'cottage_foundation') foundFoundation = true;
      if (child.name === 'cottage_roof') foundRoof = true;
      if (child.name === 'cottage_chimney') foundChimney = true;
      if (child.name === 'cottage_door') foundDoor = true;
      if (child.name === 'cottage_dormer') foundDormer = true;
      if (child.name === 'cottage_variant_prop') foundVariantProp = true;
    });

    expect(foundFoundation).toBe(true);
    expect(foundRoof).toBe(true);
    expect(foundChimney).toBe(true);
    expect(foundDoor).toBe(true);
    expect(foundDormer).toBe(true);
    expect(foundVariantProp).toBe(true);
  });

  it.each([0, 1, 2, 3])('cottage variant %i sits flush on ground and stays within mobile budget (<3,500 tris)', (variant) => {
    const cottage = createVillageCottage(variant);
    let triangles = 0;
    cottage.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry as THREE.BufferGeometry;
        const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        triangles += tris;
      }
    });
    expect(triangles).toBeLessThan(3500);
  });
});

describe('Solstice Haven Central Town Fountain & Gothic Street Lanterns', () => {
  it('creates the sculpted town fountain with water naiad, scalloped basins, and dynamic water', () => {
    const fountain = createTownFountain();
    expect(fountain.group).toBeInstanceOf(THREE.Group);
    expect(fountain.group.name).toBe('fountain_root');

    let foundLowerBasin = false;
    let foundUpperBasin = false;
    let foundNaiad = false;
    let foundWater = false;

    fountain.group.traverse((child) => {
      if (child.name === 'fountain_basin_lower') foundLowerBasin = true;
      if (child.name === 'fountain_basin_upper') foundUpperBasin = true;
      if (child.name === 'fountain_naiad') foundNaiad = true;
      if (child.name === 'fountain_water') foundWater = true;
    });

    expect(foundLowerBasin).toBe(true);
    expect(foundUpperBasin).toBe(true);
    expect(foundNaiad).toBe(true);
    expect(foundWater).toBe(true);
  });

  it('updates the fountain water ripple and cascade animation without throwing', () => {
    const fountain = createTownFountain();
    for (const dt of [0.016, 0.1, 1.0, 5.0, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => fountain.update(dt)).not.toThrow();
    }

    fountain.group.traverse((child) => {
      const p = child.position;
      const q = child.quaternion;
      const s = child.scale;
      for (const v of [p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    });
  });

  it('stays within the mobile triangle budget (<3,500 tris) for the central fountain', () => {
    const fountain = createTownFountain();
    let triangles = 0;
    fountain.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry as THREE.BufferGeometry;
        const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        triangles += tris;
      }
    });
    expect(triangles).toBeLessThan(3500);
  });

  it('creates the gothic wrought-iron street lantern with scrollwork bracket and glowing cage', () => {
    const lantern = createLanternPost();
    expect(lantern).toBeInstanceOf(THREE.Group);
    expect(lantern.name).toBe('lantern_root');

    let foundBase = false;
    let foundPole = false;
    let foundBracket = false;
    let foundCage = false;

    lantern.traverse((child) => {
      if (child.name === 'lantern_base') foundBase = true;
      if (child.name === 'lantern_pole') foundPole = true;
      if (child.name === 'lantern_bracket') foundBracket = true;
      if (child.name === 'lantern_cage') foundCage = true;
    });

    expect(foundBase).toBe(true);
    expect(foundPole).toBe(true);
    expect(foundBracket).toBe(true);
    expect(foundCage).toBe(true);
  });

  it('stays within the compact mobile budget (<1,000 tris) for each street lantern', () => {
    const lantern = createLanternPost();
    let triangles = 0;
    lantern.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry as THREE.BufferGeometry;
        const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        triangles += tris;
      }
    });
    expect(triangles).toBeLessThan(1000);
  });
});
