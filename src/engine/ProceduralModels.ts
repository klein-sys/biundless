import * as THREE from 'three';
import { BOSS_CONFIGS, type BossId } from '../bosses/bossDefinitions';
import { evaluateExactDerivative, evaluateTrig, type TrigFunctionId } from '../math/trigDerivatives';
import {
  BIOME_LANDMARKS,
  getBrookCenterZ,
  getTerrainHeight,
  getTrailBlend,
  LANDMARK_BY_ID,
  WORLD_PLAYABLE_RADIUS,
  WORLD_SIZE,
} from '../world/SunlitValley';
import {
  getFloorStoneTextures,
  getMeadowDetailTextures,
  getPillarStoneTextures,
  getSoftGlowTexture,
} from './ProceduralTextures';
import {
  createSkyDomeMaterial,
  createWardShellMaterial,
  createWaterStreamMaterial,
} from './Shaders';

export interface WaypointCrystal {
  readonly id: 'hub' | BossId;
  readonly mesh: THREE.Object3D;
  readonly position: THREE.Vector3;
}

export interface ArenaBundle {
  readonly group: THREE.Group;
  readonly fogGates: { readonly bossId: BossId; readonly group: THREE.Group; readonly curtainMat: THREE.ShaderMaterial; readonly position: THREE.Vector3 }[];
  readonly waypoints: WaypointCrystal[];
  readonly emberPoints: THREE.Points;
  readonly emberBasePositions: Float32Array;
  readonly floorMaterial: THREE.MeshStandardMaterial;
  readonly skyMat: THREE.ShaderMaterial;
  readonly waterMat: THREE.ShaderMaterial;
  readonly brazierFlames: THREE.Object3D[];
  readonly windChimes: THREE.Object3D[];
  readonly setEmberCount: (count: number) => void;
  readonly setSkyMood: (zenith: number, horizon: number, sun: number) => void;
}

export interface PlayerRig {
  readonly root: THREE.Group;
  readonly bodyMeshGroup: THREE.Group;
  readonly bladePivot: THREE.Group;
  readonly astrolabeRing: THREE.Mesh;
  readonly outerHaloRing: THREE.Mesh;
  readonly legLeft: THREE.Group;
  readonly legRight: THREE.Group;
  readonly armLeft: THREE.Group;
  readonly armRight: THREE.Group;
  readonly cloakPivot: THREE.Group;
  readonly firstPersonBlade: THREE.Group;
  readonly fpAstrolabeRing: THREE.Mesh;
  readonly setFirstPersonHidden: (isFirstPerson: boolean) => void;
  readonly setSigilAccent: (colorCss: string) => void;
}

export interface BossRig {
  readonly root: THREE.Group;
  readonly bodyGroup: THREE.Group;
  readonly wardMesh: THREE.Mesh;
  readonly wardMat: THREE.ShaderMaterial;
  readonly orbitParts: THREE.Object3D[];
  readonly wingLeft?: THREE.Object3D;
  readonly wingRight?: THREE.Object3D;
  readonly tailSegments?: THREE.Object3D[];
  readonly neckSegments?: THREE.Object3D[];
  readonly veilRibbons?: THREE.Object3D[];
  readonly coreMesh: THREE.Mesh;
}

export interface TangentArcVisual {
  readonly group: THREE.Group;
  readonly updateCurve: (
    fn: TrigFunctionId,
    theta: number,
    origin: THREE.Vector3,
    accentColor: number,
    segments: number,
  ) => void;
}

export const ARENA_RADIUS = WORLD_PLAYABLE_RADIUS;

function seededRand(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function createSunlitArchSpan(
  spanWidth: number,
  stoneMat: THREE.Material,
  broken: boolean,
): THREE.Group {
  const arch = new THREE.Group();
  const half = spanWidth * 0.5;
  const steps = broken ? 6 : 11;

  for (let i = 0; i < steps; i++) {
    if (broken && (i === 4 || i === 5)) continue;
    const t = i / 10;
    const angle = t * Math.PI;
    const x = -Math.cos(angle) * half;
    const y = Math.sin(angle) * 2.4;
    const block = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.72, 0.95), stoneMat);
    block.position.set(x, y, 0);
    block.rotation.z = (t - 0.5) * -1.25;
    block.castShadow = true;
    arch.add(block);
  }
  return arch;
}

export function createArenaEnvironment(): ArenaBundle {
  const group = new THREE.Group();
  const floorTex = getFloorStoneTextures();
  const pillarTex = getPillarStoneTextures();
  const meadowTex = getMeadowDetailTextures();
  const glowTex = getSoftGlowTexture();

  // 1. Bright Azure Daylight Sky Dome
  const skyMat = createSkyDomeMaterial();
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(175, 36, 24), skyMat);
  group.add(skyDome);

  // 2. Distant Sunlit Alpine / Valley Mountain Ring (expansive horizon)
  const farMtnMat = new THREE.MeshStandardMaterial({
    color: 0x7ea5cb,
    roughness: 0.96,
    metalness: 0.02,
  });
  const midMtnMat = new THREE.MeshStandardMaterial({
    color: 0x629674,
    roughness: 0.92,
    metalness: 0.02,
  });
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2 + 0.08;
    const dist = 112 + (i % 3) * 14;
    const h = 24 + ((i * 13) % 24);
    const w = 14 + (i % 4) * 5;
    const mtn = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6), i % 2 === 0 ? farMtnMat : midMtnMat);
    mtn.position.set(Math.cos(a) * dist, h * 0.35 - 4, Math.sin(a) * dist);
    mtn.rotation.y = a + i * 0.4;
    group.add(mtn);
  }

  // 3. Continuous ~188x188 Rolling Emerald Meadow Terrain Mesh
  const segs = 128;
  const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  terrainGeo.rotateX(-Math.PI / 2);

  const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const cGrassA = new THREE.Color(0x5bb54c);
  const cGrassB = new THREE.Color(0x7ccf58);
  const cTrail = new THREE.Color(0xd5be8d);
  const cPlaza = new THREE.Color(0xcfc6ad);
  const cGlade = new THREE.Color(0x6ac48f);
  const cRuins = new THREE.Color(0x7ca66c);
  const cSkyridge = new THREE.Color(0xd1ab6b);
  const cCliff = new THREE.Color(0x7d847c);
  const cBrookBed = new THREE.Color(0x7c8e78);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const y = getTerrainHeight(x, z);
    posAttr.setY(i, y);

    const hillShade = Math.max(0, Math.min(1, (y + 1) / 5.5));
    tmpColor.copy(cGrassA).lerp(cGrassB, hillShade * 0.75);

    const trailW = getTrailBlend(x, z);
    if (trailW > 0.02) {
      tmpColor.lerp(cTrail, trailW * 0.88);
    }

    const hubDist = Math.hypot(x, z);
    if (hubDist < 16) {
      const w = 1 - Math.max(0, (hubDist - 12) / 4);
      tmpColor.lerp(cPlaza, w * 0.75);
    }

    const witchDist = Math.hypot(x - LANDMARK_BY_ID.witch.x, z - LANDMARK_BY_ID.witch.z);
    if (witchDist < 20) {
      tmpColor.lerp(cGlade, (1 - witchDist / 20) * 0.55);
    }

    const lichDist = Math.hypot(x - LANDMARK_BY_ID.lich.x, z - LANDMARK_BY_ID.lich.z);
    if (lichDist < 20) {
      tmpColor.lerp(cRuins, (1 - lichDist / 20) * 0.55);
    }

    const dragonDist = Math.hypot(x - LANDMARK_BY_ID.dragon.x, z - LANDMARK_BY_ID.dragon.z);
    if (dragonDist < 22) {
      tmpColor.lerp(cSkyridge, (1 - dragonDist / 22) * 0.72);
    }

    // Brook bed pebbles
    const brookDist = Math.abs(z - getBrookCenterZ(x));
    if (brookDist < 4.5 && Math.abs(x) < 25) {
      tmpColor.lerp(cBrookBed, (1 - brookDist / 4.5) * 0.85);
    }

    // Outer valley cliff rock tint
    const radial = Math.hypot(x, z);
    if (radial > WORLD_PLAYABLE_RADIUS - 2) {
      const cw = Math.min(1, (radial - (WORLD_PLAYABLE_RADIUS - 2)) / 10);
      tmpColor.lerp(cCliff, cw * 0.9);
    }

    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: meadowTex.map,
    bumpMap: meadowTex.bumpMap,
    bumpScale: 0.04,
    roughness: 0.9,
    metalness: 0.02,
  });
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // 4. Central Adventurer's Plaza Courtyard (travertine stone + gold astrolabe inlay)
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorTex.map,
    bumpMap: floorTex.bumpMap,
    bumpScale: 0.05,
    roughnessMap: floorTex.roughnessMap,
    roughness: 0.78,
    metalness: 0.12,
  });
  const plazaDisc = new THREE.Mesh(new THREE.CylinderGeometry(12.2, 12.8, 0.24, 56), floorMat);
  plazaDisc.position.y = -0.08;
  plazaDisc.receiveShadow = true;
  group.add(plazaDisc);

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xefe7d5,
    map: pillarTex.map,
    bumpMap: pillarTex.bumpMap,
    bumpScale: 0.05,
    roughness: 0.8,
    metalness: 0.06,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xe6be68,
    roughness: 0.3,
    metalness: 0.78,
    emissive: 0x705118,
    emissiveIntensity: 0.25,
  });
  const timberMat = new THREE.MeshStandardMaterial({
    color: 0x825534,
    roughness: 0.85,
    metalness: 0.04,
  });

  // Low plaza curb ring & 4 sunlit stone lanterns
  const plazaCurb = new THREE.Mesh(new THREE.TorusGeometry(12.35, 0.28, 8, 56), stoneMat);
  plazaCurb.rotation.x = Math.PI / 2;
  plazaCurb.position.y = 0.05;
  plazaCurb.receiveShadow = true;
  group.add(plazaCurb);

  const brazierFlames: THREE.Object3D[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const lx = Math.cos(a) * 11.4;
    const lz = Math.sin(a) * 11.4;
    const post = new THREE.Group();
    post.position.set(lx, 0, lz);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.6, 8), stoneMat);
    base.position.y = 0.3;
    base.castShadow = true;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.8, 8), stoneMat);
    col.position.y = 1.4;
    col.castShadow = true;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.4, 6), goldMat);
    cap.position.y = 2.65;
    const orb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0 }),
    );
    orb.position.y = 2.35;
    post.add(base, col, cap, orb);
    brazierFlames.push(orb);
    group.add(post);
  }

  // 5. Shimmering Northern Brook & Arched Timber-Stone Bridge
  const waterMat = createWaterStreamMaterial();
  const waterGeo = new THREE.PlaneGeometry(52, 6.2, 48, 4);
  waterGeo.rotateX(-Math.PI / 2);
  const wPos = waterGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < wPos.count; i++) {
    const wx = wPos.getX(i);
    const wz = wPos.getZ(i) + getBrookCenterZ(wx);
    wPos.setZ(i, wz);
    wPos.setY(i, -0.32);
  }
  waterGeo.computeVertexNormals();
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  group.add(waterMesh);

  // Walkable Arched Bridge at x=0 over the brook
  const bridgeGroup = new THREE.Group();
  const bridgeCenterZ = getBrookCenterZ(0);
  const plankCount = 15;
  for (let i = 0; i < plankCount; i++) {
    const t = i / (plankCount - 1);
    const z = bridgeCenterZ - 4.4 + t * 8.8;
    const archY = -0.25 + Math.sin(t * Math.PI) * 1.15;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.24, 0.56), timberMat);
    plank.position.set(0, archY - 0.1, z);
    plank.castShadow = true;
    plank.receiveShadow = true;
    bridgeGroup.add(plank);
  }
  for (const sideX of [-2.65, 2.65]) {
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const z = bridgeCenterZ - 4.2 + t * 8.4;
      const archY = -0.25 + Math.sin(t * Math.PI) * 1.15;
      const railPost = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.05, 0.22), stoneMat);
      railPost.position.set(sideX, archY + 0.45, z);
      railPost.castShadow = true;
      bridgeGroup.add(railPost);
    }
  }
  group.add(bridgeGroup);

  // 6. Floating Crystal Waypoints (Hub + 3 Boss Biomes)
  const waypoints: WaypointCrystal[] = [];
  const windChimes: THREE.Object3D[] = [];
  for (const lm of BIOME_LANDMARKS) {
    const wx = lm.id === 'hub' ? 0 : lm.x;
    const wz = lm.id === 'hub' ? -5.5 : lm.z + 12.5;
    const wy = getTerrainHeight(wx, wz);

    const wpGroup = new THREE.Group();
    wpGroup.position.set(wx, wy, wz);

    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.25, 0.45, 8), stoneMat);
    plinth.position.y = 0.22;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    wpGroup.add(plinth);

    const crystalMat = new THREE.MeshStandardMaterial({
      color: lm.accentColor,
      emissive: lm.accentColor,
      emissiveIntensity: 0.9,
      roughness: 0.18,
      metalness: 0.35,
    });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), crystalMat);
    crystal.scale.set(0.75, 1.65, 0.75);
    crystal.position.y = 2.05;
    crystal.castShadow = true;
    wpGroup.add(crystal);

    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.04, 8, 28), goldMat);
    halo.position.y = 2.05;
    wpGroup.add(halo);

    group.add(wpGroup);
    waypoints.push({ id: lm.id, mesh: crystal, position: new THREE.Vector3(wx, wy, wz) });
    windChimes.push(halo);
  }

  // 7. Biome-Specific Scenic Architecture
  // 7A. Northwest: Whispering Glade (Sylvan Druidic Ring & Wind-Chime Monoliths)
  {
    const lm = LANDMARK_BY_ID.witch;
    const gladeFloor = new THREE.Mesh(
      new THREE.RingGeometry(11.0, 13.5, 48),
      new THREE.MeshStandardMaterial({
        color: 0x8ad0ff,
        emissive: 0x2d7ab8,
        emissiveIntensity: 0.45,
        roughness: 0.3,
      }),
    );
    gladeFloor.rotation.x = -Math.PI / 2;
    gladeFloor.position.set(lm.x, lm.baseHeight + 0.04, lm.z);
    group.add(gladeFloor);

    const innerRunes = new THREE.Mesh(
      new THREE.RingGeometry(6.5, 7.2, 36),
      new THREE.MeshStandardMaterial({
        color: 0x7fd4ff,
        emissive: 0x4caae8,
        emissiveIntensity: 0.8,
      }),
    );
    innerRunes.rotation.x = -Math.PI / 2;
    innerRunes.position.set(lm.x, lm.baseHeight + 0.05, lm.z);
    group.add(innerRunes);

    // 8 Ancient Sylvan Megaliths with Ivy and Hanging Wisp Lanterns
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ax = lm.x + Math.cos(a) * 15.2;
      const az = lm.z + Math.sin(a) * 15.2;
      const ay = getTerrainHeight(ax, az);

      const megalith = new THREE.Group();
      megalith.position.set(ax, ay, az);
      megalith.lookAt(lm.x, ay, lm.z);

      const pillarHeight = 4.8 + (i % 2) * 1.4;
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, pillarHeight, 0.75),
        stoneMat,
      );
      pillar.position.y = pillarHeight * 0.5;
      pillar.castShadow = true;
      megalith.add(pillar);

      // Ivy foliage banding
      const ivy = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.65, 1.8, 7),
        new THREE.MeshStandardMaterial({ color: 0x2c5c36, roughness: 0.9 }),
      );
      ivy.position.y = pillarHeight * 0.45;
      megalith.add(ivy);

      // Hanging Wisp Lantern
      const lanternArm = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 1.1),
        goldMat,
      );
      lanternArm.position.set(0, pillarHeight - 0.2, 0.45);
      megalith.add(lanternArm);

      const wisp = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.28, 0),
        new THREE.MeshStandardMaterial({
          color: 0x7fd4ff,
          emissive: 0x4caae8,
          emissiveIntensity: 1.2,
        }),
      );
      wisp.position.set(0, pillarHeight - 0.7, 0.95);
      megalith.add(wisp);
      windChimes.push(wisp);

      if (i % 2 === 0) {
        const arch = createSunlitArchSpan(3.8, stoneMat, false);
        arch.position.y = pillarHeight;
        megalith.add(arch);
      }

      group.add(megalith);
    }
  }

  // 7B. South: Sunken Sun-Ruins (Excavation Necropolis, Colonnades & Tangent Sundials)
  {
    const lm = LANDMARK_BY_ID.lich;
    const sunkenBasin = new THREE.Mesh(
      new THREE.CylinderGeometry(13.2, 14.8, 0.45, 40),
      new THREE.MeshStandardMaterial({
        color: 0x6e5d48,
        roughness: 0.88,
        metalness: 0.15,
      }),
    );
    sunkenBasin.position.set(lm.x, lm.baseHeight - 0.22, lm.z);
    sunkenBasin.receiveShadow = true;
    group.add(sunkenBasin);

    const innerPlaza = new THREE.Mesh(
      new THREE.CylinderGeometry(10.5, 10.5, 0.25, 36),
      floorMat,
    );
    innerPlaza.position.set(lm.x, lm.baseHeight - 0.05, lm.z);
    innerPlaza.receiveShadow = true;
    group.add(innerPlaza);

    const obeliskMat = new THREE.MeshStandardMaterial({
      color: 0x2b4a3e,
      roughness: 0.6,
      metalness: 0.35,
    });
    const jadeMat = new THREE.MeshStandardMaterial({
      color: 0x45e0a5,
      emissive: 0x26b07c,
      emissiveIntensity: 1.1,
    });

    // Colossal ruined colonnade with broken architraves
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const px = lm.x + Math.cos(a) * 14.8;
      const pz = lm.z + Math.sin(a) * 14.8;
      const py = getTerrainHeight(px, pz);

      const col = new THREE.Group();
      col.position.set(px, py, pz);
      col.lookAt(lm.x, py, lm.z);

      const h = i % 2 === 0 ? 6.2 : 4.4;
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.1, h, 1.1), obeliskMat);
      shaft.position.y = h * 0.5;
      shaft.castShadow = true;

      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.2, 4), jadeMat);
      cap.position.y = h + 0.6;
      cap.rotation.y = Math.PI / 4;
      col.add(shaft, cap);

      // Tangent flame brazier on intermediate pillars
      if (i % 2 === 1) {
        const brazierBowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.25, 0.4, 8), stoneMat);
        brazierBowl.position.set(0, h * 0.45, 0.6);
        const flameCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), jadeMat);
        flameCore.position.set(0, h * 0.45 + 0.35, 0.6);
        col.add(brazierBowl, flameCore);
        brazierFlames.push(flameCore);
      }

      group.add(col);
    }
  }

  // 7C. Northeast: Skyridge Peak (Obsidian Caldera Spires & Floating Crystal Crags)
  {
    const lm = LANDMARK_BY_ID.dragon;
    const peakMat = new THREE.MeshStandardMaterial({
      color: 0x242228,
      roughness: 0.68,
      metalness: 0.42,
    });
    const goldDragonMat = new THREE.MeshStandardMaterial({
      color: 0xe6a845,
      emissive: 0x8a5214,
      emissiveIntensity: 0.6,
      roughness: 0.28,
      metalness: 0.8,
    });

    // Dais floor with draconic seal
    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(12.5, 13.8, 0.5, 32),
      peakMat,
    );
    dais.position.set(lm.x, lm.baseHeight - 0.1, lm.z);
    dais.receiveShadow = true;
    group.add(dais);

    const sealRing = new THREE.Mesh(
      new THREE.TorusGeometry(8.5, 0.08, 8, 48),
      goldDragonMat,
    );
    sealRing.rotation.x = Math.PI / 2;
    sealRing.position.set(lm.x, lm.baseHeight + 0.16, lm.z);
    group.add(sealRing);

    // 8 Jagged Volcanic Obsidian Spires & Tethered Anti-Gravity Crags
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const px = lm.x + Math.cos(a) * 15.5;
      const pz = lm.z + Math.sin(a) * 15.5;
      const py = getTerrainHeight(px, pz);

      const spire = new THREE.Group();
      spire.position.set(px, py, pz);

      const spireH = 6.8 + (i % 3) * 1.5;
      const shaft = new THREE.Mesh(new THREE.ConeGeometry(0.7, spireH, 5), peakMat);
      shaft.position.y = spireH * 0.5;
      shaft.rotation.y = a * 0.5;
      shaft.castShadow = true;
      spire.add(shaft);

      // Floating Anti-Gravity Crystal Crag
      const crag = new THREE.Mesh(new THREE.OctahedronGeometry(0.65, 0), goldDragonMat);
      crag.position.set(0, spireH + 1.2, 0);
      crag.scale.set(0.7, 1.8, 0.7);
      spire.add(crag);
      windChimes.push(crag);

      // Energy Ring tether
      const energyRing = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.05, 6, 24), goldMat);
      energyRing.position.set(0, spireH + 1.2, 0);
      energyRing.rotation.x = Math.PI * 0.4;
      spire.add(energyRing);

      group.add(spire);
    }
  }

  // 8. Instanced Stylized Trees (Emerald Meadow + Cherry Blossom Glade)
  const treeCoords: { x: number; y: number; z: number; scale: number; blossom: boolean }[] = [];
  for (let i = 0; i < 160; i++) {
    const r = 17 + seededRand(i * 3 + 1) * (WORLD_PLAYABLE_RADIUS - 18);
    const a = seededRand(i * 3 + 2) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;

    // Keep clear of trails, brook, and boss combat plateaus
    if (getTrailBlend(x, z) > 0.08) continue;
    if (Math.abs(z - getBrookCenterZ(x)) < 5.5 && Math.abs(x) < 27) continue;
    let tooCloseToLandmark = false;
    for (const lm of BIOME_LANDMARKS) {
      if (Math.hypot(x - lm.x, z - lm.z) < lm.plateauRadius + 1.5) {
        tooCloseToLandmark = true;
        break;
      }
    }
    if (tooCloseToLandmark) continue;

    const y = getTerrainHeight(x, z);
    const nearGlade = Math.hypot(x - LANDMARK_BY_ID.witch.x, z - LANDMARK_BY_ID.witch.z) < 32;
    treeCoords.push({
      x,
      y,
      z,
      scale: 0.85 + seededRand(i * 3 + 3) * 0.65,
      blossom: nearGlade || i % 9 === 0,
    });
  }

  if (treeCoords.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.36, 2.6, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7c5338, roughness: 0.9 });
    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCoords.length);
    trunkInst.castShadow = true;
    trunkInst.receiveShadow = true;

    const emeraldCount = treeCoords.filter((t) => !t.blossom).length;
    const blossomCount = treeCoords.length - emeraldCount;

    const crownGeo = new THREE.DodecahedronGeometry(1.65, 1);
    const emeraldCrownMat = new THREE.MeshStandardMaterial({ color: 0x4ca848, roughness: 0.82 });
    const blossomCrownMat = new THREE.MeshStandardMaterial({ color: 0xf4a8c8, roughness: 0.78 });

    const emeraldInst = emeraldCount > 0 ? new THREE.InstancedMesh(crownGeo, emeraldCrownMat, emeraldCount * 2) : null;
    const blossomInst = blossomCount > 0 ? new THREE.InstancedMesh(crownGeo, blossomCrownMat, blossomCount * 2) : null;
    if (emeraldInst) emeraldInst.castShadow = true;
    if (blossomInst) blossomInst.castShadow = true;

    const dummy = new THREE.Object3D();
    let eIdx = 0;
    let bIdx = 0;

    treeCoords.forEach((t, idx) => {
      dummy.position.set(t.x, t.y + 1.2 * t.scale, t.z);
      dummy.scale.set(t.scale, t.scale, t.scale);
      dummy.rotation.set(0, idx * 1.1, 0);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(idx, dummy.matrix);

      const target = t.blossom ? blossomInst! : emeraldInst!;
      let cursor = t.blossom ? bIdx : eIdx;

      dummy.position.set(t.x, t.y + 3.0 * t.scale, t.z);
      dummy.scale.set(t.scale * 1.15, t.scale * 0.92, t.scale * 1.15);
      dummy.updateMatrix();
      target.setMatrixAt(cursor++, dummy.matrix);

      dummy.position.set(t.x + 0.35 * t.scale, t.y + 4.05 * t.scale, t.z - 0.25 * t.scale);
      dummy.scale.set(t.scale * 0.78, t.scale * 0.78, t.scale * 0.78);
      dummy.updateMatrix();
      target.setMatrixAt(cursor++, dummy.matrix);

      if (t.blossom) bIdx = cursor;
      else eIdx = cursor;
    });

    group.add(trunkInst);
    if (emeraldInst) group.add(emeraldInst);
    if (blossomInst) group.add(blossomInst);
  }

  // 9. Instanced Sunlit Boulders & Colorful Wildflowers
  const rockCount = 45;
  const rockGeo = new THREE.DodecahedronGeometry(1.0, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x9ca298, roughness: 0.9 });
  const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  rockInst.castShadow = true;
  rockInst.receiveShadow = true;
  const rDummy = new THREE.Object3D();
  for (let i = 0; i < rockCount; i++) {
    const r = 18 + seededRand(i * 7 + 41) * (WORLD_PLAYABLE_RADIUS - 16);
    const a = seededRand(i * 7 + 42) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = getTerrainHeight(x, z);
    const s = 0.6 + seededRand(i * 7 + 43) * 1.3;
    rDummy.position.set(x, y + s * 0.25, z);
    rDummy.scale.set(s * 1.3, s * 0.78, s);
    rDummy.rotation.set(seededRand(i) * 0.4, seededRand(i + 1) * 3.1, 0);
    rDummy.updateMatrix();
    rockInst.setMatrixAt(i, rDummy.matrix);
  }
  group.add(rockInst);

  const flowerCount = 260;
  const flowerGeo = new THREE.ConeGeometry(0.18, 0.28, 5);
  flowerGeo.rotateX(Math.PI);
  const flowerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const flowerInst = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
  const fDummy = new THREE.Object3D();
  const fPalette = [
    new THREE.Color(0xffe169),
    new THREE.Color(0xff9eb5),
    new THREE.Color(0x8ae0ff),
    new THREE.Color(0xffffff),
  ];
  for (let i = 0; i < flowerCount; i++) {
    const r = 13.5 + seededRand(i * 5 + 90) * (WORLD_PLAYABLE_RADIUS - 16);
    const a = seededRand(i * 5 + 91) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = getTerrainHeight(x, z);
    fDummy.position.set(x, y + 0.16, z);
    fDummy.scale.setScalar(0.8 + seededRand(i * 5 + 92) * 0.8);
    fDummy.rotation.y = seededRand(i * 5 + 93) * Math.PI;
    fDummy.updateMatrix();
    flowerInst.setMatrixAt(i, fDummy.matrix);
    flowerInst.setColorAt(i, fPalette[i % fPalette.length]);
  }
  if (flowerInst.instanceColor) flowerInst.instanceColor.needsUpdate = true;
  group.add(flowerInst);

  // 10. Gentle Sunlit Pollen / Blossom Motes across the Valley
  const maxEmbers = 260;
  const emberPositions = new Float32Array(maxEmbers * 3);
  const emberBase = new Float32Array(maxEmbers * 3);
  for (let i = 0; i < maxEmbers; i++) {
    const r = Math.sqrt((i + 0.5) / maxEmbers) * (WORLD_PLAYABLE_RADIUS - 4);
    const a = i * 2.39996;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = getTerrainHeight(x, z) + 0.5 + ((i * 17) % 100) * 0.08;
    emberPositions[i * 3] = x;
    emberPositions[i * 3 + 1] = y;
    emberPositions[i * 3 + 2] = z;
    emberBase[i * 3] = x;
    emberBase[i * 3 + 1] = y;
    emberBase[i * 3 + 2] = z;
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  const emberMat = new THREE.PointsMaterial({
    map: glowTex,
    color: 0xfff5c0,
    size: 0.42,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const emberPoints = new THREE.Points(emberGeo, emberMat);
  group.add(emberPoints);

  // Keep fogGates empty (open-world proximity territory replaces fog gates)
  const fogGates: ArenaBundle['fogGates'] = [];

  return {
    group,
    fogGates,
    waypoints,
    emberPoints,
    emberBasePositions: emberBase,
    floorMaterial: floorMat,
    skyMat,
    waterMat,
    brazierFlames,
    windChimes,
    setEmberCount: (count: number) => {
      emberGeo.setDrawRange(0, Math.max(0, Math.min(maxEmbers, count)));
    },
    setSkyMood: (zenith: number, horizon: number, sun: number) => {
      skyMat.uniforms.uZenith.value.setHex(zenith);
      skyMat.uniforms.uHorizon.value.setHex(horizon);
      skyMat.uniforms.uSunColor.value.setHex(sun);
    },
  };
}

export function createPlayerModel(): PlayerRig {
  const root = new THREE.Group();
  const bodyMeshGroup = new THREE.Group();
  root.add(bodyMeshGroup);

  // Stylized Fantasy Adventurer & Spellblade Palette
  const mithrilMat = new THREE.MeshStandardMaterial({
    color: 0xe6eef8,
    roughness: 0.22,
    metalness: 0.82,
  });
  const ivoryTunicMat = new THREE.MeshStandardMaterial({
    color: 0xf6f1e8,
    roughness: 0.55,
    metalness: 0.08,
  });
  const azureCloakMat = new THREE.MeshStandardMaterial({
    color: 0x1f5fa0,
    roughness: 0.58,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  const darkNavyMat = new THREE.MeshStandardMaterial({
    color: 0x132338,
    roughness: 0.68,
    metalness: 0.15,
  });
  const leatherMat = new THREE.MeshStandardMaterial({
    color: 0x4a2e1b,
    roughness: 0.75,
    metalness: 0.1,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xf0c660,
    roughness: 0.22,
    metalness: 0.88,
    emissive: 0x7a5214,
    emissiveIntensity: 0.35,
  });
  const sigilGlowMat = new THREE.MeshStandardMaterial({
    color: 0x6dd5ff,
    emissive: 0x5ca9e6,
    emissiveIntensity: 1.45,
    roughness: 0.15,
    metalness: 0.4,
  });

  // Articulated Adventurer Legs with Layered Greaves & Cuffed Boots
  const buildLeg = (xOffset: number): THREE.Group => {
    const legPivot = new THREE.Group();
    legPivot.position.set(xOffset, 0.88, 0);

    // Thigh with fitted breeches
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.095, 0.44, 8), darkNavyMat);
    thigh.position.y = -0.2;
    thigh.castShadow = true;
    legPivot.add(thigh);

    // Sculpted Gilded Knee Guard (Poleyn)
    const knee = new THREE.Mesh(new THREE.OctahedronGeometry(0.095, 0), goldMat);
    knee.position.set(0, -0.42, 0.06);
    legPivot.add(knee);

    // Armored Mithril & Leather Greave
    const greave = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.08, 0.42, 8), mithrilMat);
    greave.position.y = -0.63;
    greave.castShadow = true;
    legPivot.add(greave);

    // Turned Leather Boot Cuff
    const bootCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.12, 8), leatherMat);
    bootCuff.position.set(0, -0.72, 0.02);
    legPivot.add(bootCuff);

    // Articulated Adventurer Boot
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.28), leatherMat);
    boot.position.set(0, -0.84, 0.06);
    boot.castShadow = true;
    legPivot.add(boot);

    return legPivot;
  };

  const legLeft = buildLeg(-0.16);
  const legRight = buildLeg(0.16);
  bodyMeshGroup.add(legLeft, legRight);

  // Layered Azure Adventurer Coat-Tails & Ornate Belt Buckle
  const tasset = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 0.44, 8, 1, true), azureCloakMat);
  tasset.position.y = 0.78;
  bodyMeshGroup.add(tasset);

  const innerSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.38, 8, 1, true), darkNavyMat);
  innerSkirt.position.y = 0.75;
  bodyMeshGroup.add(innerSkirt);

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.11, 10), leatherMat);
  belt.position.y = 0.95;
  bodyMeshGroup.add(belt);

  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.08), goldMat);
  buckle.position.set(0, 0.95, 0.24);
  bodyMeshGroup.add(buckle);

  // Ivory & Azure Spellblade Tunic + Cuirass Plating
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.24, 0.68, 8), ivoryTunicMat);
  torso.position.y = 1.28;
  torso.castShadow = true;
  bodyMeshGroup.add(torso);

  // Flared Gilded High Collar
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 6, 16, Math.PI * 1.3), goldMat);
  collar.position.set(0, 1.62, 0.02);
  collar.rotation.x = Math.PI * 0.55;
  bodyMeshGroup.add(collar);

  // Gilded Chestplate Crest
  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.1), mithrilMat);
  chestPlate.position.set(0, 1.32, 0.18);
  bodyMeshGroup.add(chestPlate);

  const chestSun = new THREE.Mesh(new THREE.OctahedronGeometry(0.065, 0), goldMat);
  chestSun.position.set(0, 1.36, 0.24);
  bodyMeshGroup.add(chestSun);

  // Dynamic Dual-Tail Spellcaster Mantle / Cape
  const cloakPivot = new THREE.Group();
  cloakPivot.position.set(0, 1.56, -0.18);
  bodyMeshGroup.add(cloakPivot);

  const capeGeo = new THREE.PlaneGeometry(0.88, 1.35, 6, 8);
  const capePos = capeGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < capePos.count; i++) {
    const x = capePos.getX(i);
    const y = capePos.getY(i);
    const t = (0.675 - y) / 1.35;
    capePos.setX(i, x * (0.6 + t * 0.65));
    capePos.setZ(i, -t * 0.18 + Math.abs(x) * 0.08);
  }
  capeGeo.computeVertexNormals();
  const capeMesh = new THREE.Mesh(capeGeo, azureCloakMat);
  capeMesh.position.set(0, -0.65, -0.04);
  capeMesh.rotation.x = 0.18;
  capeMesh.castShadow = true;
  cloakPivot.add(capeMesh);

  // Stylized Anime Spellblade Head, Swept Hair Locks & Forehead Circlet
  const helmGroup = new THREE.Group();
  helmGroup.position.y = 1.76;
  bodyMeshGroup.add(helmGroup);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xf5dbc2, roughness: 0.58 }),
  );
  head.castShadow = true;
  helmGroup.add(head);

  // Stylized Hair Strands
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x3d281a,
    roughness: 0.62,
  });
  const hairBase = new THREE.Mesh(
    new THREE.SphereGeometry(0.228, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.65),
    hairMat,
  );
  hairBase.rotation.x = -0.32;
  hairBase.position.y = 0.02;
  helmGroup.add(hairBase);

  // Swept Bangs & Side Hair Locks
  for (const side of [-1, 1]) {
    const lock = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.28, 4), hairMat);
    lock.position.set(side * 0.15, -0.05, 0.16);
    lock.rotation.set(0.25, 0, side * 0.35);
    helmGroup.add(lock);
  }

  // Golden Astrolabe Circlet with Glowing Forehead Sigil Crest
  const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 24), goldMat);
  circlet.rotation.x = Math.PI * 0.46;
  circlet.position.y = 0.07;
  helmGroup.add(circlet);

  const foreheadGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), sigilGlowMat);
  foreheadGem.position.set(0, 0.09, 0.22);
  helmGroup.add(foreheadGem);

  // Luminous Arcane Visor / Eyes
  const visorGlow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.08), sigilGlowMat);
  visorGlow.position.set(0, 0.01, 0.18);
  helmGroup.add(visorGlow);

  // Twin Interlocking Sun-Gold Astrolabe Halos with Planetary Nodes
  const astrolabeRing = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.025, 8, 44), goldMat);
  astrolabeRing.position.set(0, 1.44, -0.34);
  bodyMeshGroup.add(astrolabeRing);

  // Node markers on main astrolabe ring
  for (let n = 0; n < 4; n++) {
    const na = (n / 4) * Math.PI * 2;
    const node = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), sigilGlowMat);
    node.position.set(Math.cos(na) * 0.58, Math.sin(na) * 0.58, 0);
    astrolabeRing.add(node);
  }

  const outerHaloRing = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.018, 8, 48), sigilGlowMat);
  outerHaloRing.position.set(0, 1.44, -0.36);
  bodyMeshGroup.add(outerHaloRing);

  // Articulated Arms, Flared Pauldrons & Inset Rune Inlays
  const buildArm = (side: number): THREE.Group => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.38, 1.5, 0);

    // Sculpted Gilded Pauldron
    const pauldron = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
      goldMat,
    );
    pauldron.rotation.z = side * -0.38;
    pauldron.castShadow = true;
    arm.add(pauldron);

    const pauldronGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.04, 0), sigilGlowMat);
    pauldronGem.position.set(side * 0.14, 0.08, 0);
    arm.add(pauldronGem);

    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.34, 8), azureCloakMat);
    upperArm.position.y = -0.18;
    arm.add(upperArm);

    // Mithril Gauntlet with Rune Trim
    const gauntlet = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.068, 0.34, 8), mithrilMat);
    gauntlet.position.set(0, -0.46, 0.06);
    gauntlet.rotation.x = -0.25;
    arm.add(gauntlet);

    return arm;
  };

  const armLeft = buildArm(-1);
  const armRight = buildArm(1);
  bodyMeshGroup.add(armLeft, armRight);

  // Resonant Runeblade Weapon System
  const bladePivot = new THREE.Group();
  bladePivot.position.set(0, -0.58, 0.14);
  armRight.add(bladePivot);

  const buildSwordMesh = (): THREE.Group => {
    const sword = new THREE.Group();

    // Leather Grip with Gold Wire Wrap
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.3, 8), leatherMat);
    grip.position.y = -0.05;
    sword.add(grip);

    // Faceted Sapphire Pommel Jewel
    const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), sigilGlowMat);
    pommel.position.y = -0.22;
    sword.add(pommel);

    // Ornate Winged Golden Crossguard
    const crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.075, 0.1), goldMat);
    crossguard.position.y = 0.09;
    sword.add(crossguard);

    for (const qSide of [-1, 1]) {
      const quillonTip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 4), goldMat);
      quillonTip.position.set(qSide * 0.24, 0.12, 0);
      quillonTip.rotation.z = qSide * -0.75;
      sword.add(quillonTip);
    }

    // Double-Edged Mithril Blade
    const bladeMain = new THREE.Mesh(new THREE.ConeGeometry(0.098, 1.52, 4), mithrilMat);
    bladeMain.scale.set(0.44, 1, 1.0);
    bladeMain.position.y = 0.86;
    bladeMain.castShadow = true;
    sword.add(bladeMain);

    // Luminous Runic Fuller Core
    const fullerGlow = new THREE.Mesh(new THREE.BoxGeometry(0.028, 1.2, 0.062), sigilGlowMat);
    fullerGlow.position.y = 0.7;
    sword.add(fullerGlow);

    return sword;
  };

  const thirdPersonSword = buildSwordMesh();
  thirdPersonSword.rotation.x = Math.PI * 0.36;
  bladePivot.add(thirdPersonSword);

  // 1st-Person Viewmodel
  const firstPersonBlade = new THREE.Group();
  const fpSword = buildSwordMesh();
  fpSword.scale.setScalar(0.68);
  fpSword.position.set(0.38, -0.34, -0.62);
  fpSword.rotation.set(-0.42, 0.25, 0.28);
  firstPersonBlade.add(fpSword);

  const fpFocus = new THREE.Group();
  fpFocus.position.set(-0.36, -0.26, -0.58);
  const fpAstrolabeRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 28), goldMat);
  const fpInnerRing = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 8, 24), sigilGlowMat);
  const fpCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.036, 0), sigilGlowMat);
  fpFocus.add(fpAstrolabeRing, fpInnerRing, fpCore);
  firstPersonBlade.add(fpFocus);

  firstPersonBlade.visible = false;

  return {
    root,
    bodyMeshGroup,
    bladePivot,
    astrolabeRing,
    outerHaloRing,
    legLeft,
    legRight,
    armLeft,
    armRight,
    cloakPivot,
    firstPersonBlade,
    fpAstrolabeRing,
    setFirstPersonHidden: (isFirstPerson: boolean) => {
      bodyMeshGroup.visible = !isFirstPerson;
      firstPersonBlade.visible = isFirstPerson;
    },
    setSigilAccent: (colorCss: string) => {
      sigilGlowMat.color.set(colorCss);
      sigilGlowMat.emissive.set(colorCss);
    },
  };
}

export function createBossModel(id: BossId): BossRig {
  const cfg = BOSS_CONFIGS[id];
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const orbitParts: THREE.Object3D[] = [];
  const veilRibbons: THREE.Object3D[] = [];
  const tailSegments: THREE.Object3D[] = [];
  const neckSegments: THREE.Object3D[] = [];

  // High-contrast stylized fantasy boss materials
  const primaryMat = new THREE.MeshStandardMaterial({
    color: id === 'witch' ? 0x2b4594 : id === 'lich' ? 0x27483e : 0xa83820,
    roughness: 0.38,
    metalness: 0.35,
    side: THREE.DoubleSide,
  });
  const trimGoldMat = new THREE.MeshStandardMaterial({
    color: 0xf0c868,
    roughness: 0.24,
    metalness: 0.88,
    emissive: 0x724d16,
    emissiveIntensity: 0.3,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: cfg.accentColor,
    emissive: cfg.accentColor,
    emissiveIntensity: 1.45,
    roughness: 0.16,
    metalness: 0.45,
  });

  let coreMesh: THREE.Mesh;
  let wingLeft: THREE.Object3D | undefined;
  let wingRight: THREE.Object3D | undefined;

  if (id === 'witch') {
    // Vespera, Astral Sylvan Witch (sin/cos harmonic sorceress)
    // Multi-tiered layered fluted gown
    const lowerGown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 1.45, 2.4, 16, 1, true),
      primaryMat,
    );
    lowerGown.position.y = 1.25;
    lowerGown.castShadow = true;
    bodyGroup.add(lowerGown);

    const innerUnderskirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 1.25, 2.1, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x142145, roughness: 0.6 }),
    );
    innerUnderskirt.position.y = 1.15;
    bodyGroup.add(innerUnderskirt);

    // Bioluminescent sine wave hem
    const hemGlow = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.045, 8, 40), accentMat);
    hemGlow.rotation.x = Math.PI / 2;
    hemGlow.position.y = 0.08;
    bodyGroup.add(hemGlow);

    // Fluted waist peplum
    const peplum = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.45, 12, 1, true), trimGoldMat);
    peplum.rotation.x = Math.PI;
    peplum.position.y = 2.22;
    bodyGroup.add(peplum);

    // Sculpted elderwood bodice
    const bodice = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.46, 0.98, 12), primaryMat);
    bodice.position.y = 2.68;
    bodyGroup.add(bodice);

    const goldChoker = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 6, 20), trimGoldMat);
    goldChoker.rotation.x = Math.PI / 2;
    goldChoker.position.y = 3.16;
    bodyGroup.add(goldChoker);

    // Sylvan Sorceress Head & Swept Silver Locks
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xf8f2ea, roughness: 0.4 }),
    );
    head.position.y = 3.4;
    bodyGroup.add(head);

    // Cascading hair locks
    const hairMat = new THREE.MeshStandardMaterial({ color: 0xc8ddf8, roughness: 0.35 });
    for (const hSide of [-1, 1]) {
      const lock = new THREE.Mesh(new THREE.ConeGeometry(0.08, 1.1, 5), hairMat);
      lock.position.set(hSide * 0.22, 2.9, -0.05);
      lock.rotation.set(0.1, 0, hSide * 0.15);
      bodyGroup.add(lock);
    }

    // Glowing Astral Eyes
    for (const ex of [-0.085, 0.085]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), accentMat);
      eye.position.set(ex, 3.42, 0.23);
      bodyGroup.add(eye);
    }

    // Majestic Crescent Moon Crown & Star Astrolabe
    const crescentCrown = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.04, 8, 24, Math.PI * 1.35),
      trimGoldMat,
    );
    crescentCrown.rotation.set(0, 0, Math.PI * 0.32);
    crescentCrown.position.set(0, 3.75, 0.05);
    bodyGroup.add(crescentCrown);

    const crownGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), accentMat);
    crownGem.position.set(0, 3.92, 0.12);
    bodyGroup.add(crownGem);

    // Floating Astrolabe Halo behind head
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.025, 8, 36), trimGoldMat);
    halo.position.set(0, 3.45, -0.25);
    bodyGroup.add(halo);

    // Floating Translucent Veil Ribbons
    for (const side of [-1, 1]) {
      const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 2.4), accentMat);
      ribbon.position.set(side * 0.62, 2.05, -0.32);
      ribbon.rotation.z = side * 0.16;
      bodyGroup.add(ribbon);
      veilRibbons.push(ribbon);
    }

    // Sylvan Sine-Staff: Armillary Sine Sphere atop carved elderwood pole
    const staff = new THREE.Group();
    staff.position.set(0.92, 2.1, 0.45);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.048, 3.8, 8), trimGoldMat);
    staff.add(pole);

    const armillaryRing = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.03, 8, 24), trimGoldMat);
    armillaryRing.position.y = 2.05;
    armillaryRing.rotation.x = Math.PI * 0.35;
    staff.add(armillaryRing);

    const staffOrb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), accentMat);
    staffOrb.position.y = 2.05;
    staff.add(staffOrb);

    bodyGroup.add(staff);

    // Harmonic Chest Core
    coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), accentMat);
    coreMesh.position.set(0, 2.65, 0.48);
    bodyGroup.add(coreMesh);

    // 3 Orbiting Sine Focus Crystals with Counter-Rotating Rings
    for (let i = 0; i < 3; i++) {
      const orbGroup = new THREE.Group();
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), accentMat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.02, 6, 24), trimGoldMat);
      ring.rotation.x = Math.PI * 0.35;
      orbGroup.add(crystal, ring);
      bodyGroup.add(orbGroup);
      orbitParts.push(orbGroup);
    }
  } else if (id === 'lich') {
    // Malakor, Ancient Ruin Lich (tan/cot geometric sorcerer)
    // Tattered ceremonial vestments
    const shroud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 1.45, 3.1, 12, 1, true),
      primaryMat,
    );
    shroud.position.y = 1.55;
    shroud.castShadow = true;
    bodyGroup.add(shroud);

    // Gilded Pharaonic Gorget / Collar
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.48, 0.22, 10), trimGoldMat);
    collar.position.y = 3.05;
    bodyGroup.add(collar);

    // Exposed Amber Tangent Ribcage
    for (let r = 0; r < 4; r++) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(0.44 - r * 0.03, 0.045, 6, 14, Math.PI * 1.35),
        trimGoldMat,
      );
      rib.position.y = 2.35 + r * 0.22;
      rib.rotation.set(Math.PI / 2, 0, -Math.PI * 0.18);
      bodyGroup.add(rib);
    }

    // Floating Levitating Spiked Shoulder Obelisks
    for (const side of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 5), primaryMat);
      pauldron.position.set(side * 0.9, 3.25, 0);
      pauldron.rotation.z = side * -0.95;
      bodyGroup.add(pauldron);
    }

    // Weathered Sandstone Skull & Cowl
    const skullMat = new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 0.6 });
    const skull = new THREE.Mesh(new THREE.DodecahedronGeometry(0.38, 0), skullMat);
    skull.position.y = 3.75;
    bodyGroup.add(skull);

    // Glowing Turquoise Soul Eyes
    for (const ex of [-0.11, 0.11]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), accentMat);
      eye.position.set(ex, 3.78, 0.32);
      bodyGroup.add(eye);
    }

    // Hovering Cracked Sandstone Crown with All-Seeing Tangent Eye
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.055, 6, 12), trimGoldMat);
    crown.position.y = 4.08;
    crown.rotation.x = Math.PI / 2;
    bodyGroup.add(crown);

    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.46, 4), trimGoldMat);
      spike.position.set(Math.cos(a) * 0.44, 4.32, Math.sin(a) * 0.44);
      bodyGroup.add(spike);
    }

    // Pulsating Tangent Furnace Core
    coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), accentMat);
    coreMesh.position.set(0, 2.75, 0.28);
    bodyGroup.add(coreMesh);

    // 4 Orbiting Weathered Sandstone Obelisks with Inscribed Rune Caps
    for (let i = 0; i < 4; i++) {
      const obelisk = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.65, 0.34), primaryMat);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.55, 4), accentMat);
      tip.position.y = 1.08;
      tip.rotation.y = Math.PI * 0.25;
      obelisk.add(shaft, tip);
      bodyGroup.add(obelisk);
      orbitParts.push(obelisk);
    }
  } else {
    // Vaelorath, Skyridge Wyrm (sec/csc celestial dragon)
    const scaleMat = primaryMat;
    const wingMembraneMat = new THREE.MeshStandardMaterial({
      color: 0xee8838,
      emissive: 0x9e4215,
      emissiveIntensity: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.45,
      transparent: true,
      opacity: 0.92,
    });

    // Sculpted Draconic Torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.78, 2.1, 8, 12), scaleMat);
    torso.rotation.x = Math.PI * 0.42;
    torso.position.set(0, 2.05, -0.1);
    torso.castShadow = true;
    bodyGroup.add(torso);

    // Glowing Hyperbolic Throat / Chest Core
    coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.48, 14, 12), accentMat);
    coreMesh.position.set(0, 2.08, 0.68);
    bodyGroup.add(coreMesh);

    // Segmented Sinuous Neck
    let parentObj: THREE.Object3D = bodyGroup;
    const neckPositions = [
      new THREE.Vector3(0, 2.58, 0.96),
      new THREE.Vector3(0, 0.64, 0.44),
      new THREE.Vector3(0, 0.6, 0.46),
    ];
    for (let i = 0; i < 3; i++) {
      const segPivot = new THREE.Group();
      segPivot.position.copy(neckPositions[i]);
      const segMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34 - i * 0.04, 0.44 - i * 0.04, 0.88, 8),
        scaleMat,
      );
      segMesh.rotation.x = 0.55 - i * 0.15;
      segMesh.castShadow = true;
      segPivot.add(segMesh);

      // Dorsal Crystalline Spines
      const spine = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.45, 4), accentMat);
      spine.position.set(0, 0.25, -0.35);
      spine.rotation.x = -0.5;
      segPivot.add(spine);

      parentObj.add(segPivot);
      neckSegments.push(segPivot);
      parentObj = segPivot;
    }

    // Horned Dragon Head & Articulated Jaw
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.46, 0.5);
    const skull = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.4, 6), scaleMat);
    skull.rotation.x = Math.PI * 0.52;
    headGroup.add(skull);

    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.15, 0.98), trimGoldMat);
    jaw.position.set(0, -0.18, 0.26);
    headGroup.add(jaw);

    for (const side of [-1, 1]) {
      // Curved Obsidian Horns
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.15, 5), trimGoldMat);
      horn.position.set(side * 0.28, 0.28, -0.38);
      horn.rotation.set(-0.85, side * 0.2, side * -0.28);
      headGroup.add(horn);

      // Cheek Spines
      const cheek = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.5, 4), trimGoldMat);
      cheek.position.set(side * 0.35, -0.05, 0.05);
      cheek.rotation.set(0, 0, side * -0.9);
      headGroup.add(cheek);

      // Slit Amber Eyes
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), accentMat);
      eye.position.set(side * 0.22, 0.12, 0.3);
      headGroup.add(eye);
    }
    parentObj.add(headGroup);

    // Articulated Dragon Wings
    const buildWing = (side: number): THREE.Group => {
      const wing = new THREE.Group();
      wing.position.set(side * 0.58, 2.58, 0.1);

      const armBone = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.2, 6), scaleMat);
      armBone.rotation.z = side * -1.15;
      armBone.position.set(side * 0.98, 0.46, -0.1);
      wing.add(armBone);

      const membraneGeo = new THREE.BufferGeometry();
      const verts = new Float32Array([
        0, 0, 0,
        side * 2.0, 0.85, -0.2,
        side * 1.4, -0.7, 0.75,

        side * 2.0, 0.85, -0.2,
        side * 4.4, 1.35, -0.85,
        side * 3.1, -0.45, 0.6,

        side * 2.0, 0.85, -0.2,
        side * 3.1, -0.45, 0.6,
        side * 1.4, -0.7, 0.75,
      ]);
      membraneGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      membraneGeo.computeVertexNormals();
      const membrane = new THREE.Mesh(membraneGeo, wingMembraneMat);
      wing.add(membrane);

      for (const tip of [
        [side * 4.4, 1.35, -0.85],
        [side * 3.1, -0.45, 0.6],
      ]) {
        const dx = tip[0] - side * 1.95;
        const dy = tip[1] - 0.82;
        const dz = tip[2] + 0.18;
        const len = Math.hypot(dx, dy, dz);
        const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, len, 5), trimGoldMat);
        spar.position.set(side * 1.95 + dx * 0.5, 0.82 + dy * 0.5, -0.18 + dz * 0.5);
        spar.lookAt(tip[0], tip[1], tip[2]);
        spar.rotateX(Math.PI / 2);
        wing.add(spar);
      }

      return wing;
    };

    wingLeft = buildWing(1);
    wingRight = buildWing(-1);
    bodyGroup.add(wingLeft, wingRight);

    // Segmented Sinuous Dragon Tail
    let tailParent: THREE.Object3D = bodyGroup;
    for (let t = 0; t < 5; t++) {
      const seg = new THREE.Group();
      seg.position.set(0, t === 0 ? 1.48 : -0.12, t === 0 ? -1.22 : -0.84);
      const radius = 0.4 - t * 0.06;
      const piece = new THREE.Mesh(new THREE.ConeGeometry(radius, 1.02, 6), scaleMat);
      piece.rotation.x = -Math.PI * 0.52;
      piece.position.z = -0.44;
      seg.add(piece);

      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.36, 4), accentMat);
      spike.position.set(0, radius + 0.1, -0.36);
      seg.add(spike);

      tailParent.add(seg);
      tailSegments.push(seg);
      tailParent = seg;
    }
  }

  // Crystalline Phase Ward Barrier
  const wardMat = createWardShellMaterial(cfg.accentColor);
  const wardMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(2.8, 2), wardMat);
  wardMesh.position.y = 2.25;
  wardMesh.visible = false;
  root.add(wardMesh);

  return {
    root,
    bodyGroup,
    wardMesh,
    wardMat,
    orbitParts,
    wingLeft,
    wingRight,
    tailSegments,
    neckSegments,
    veilRibbons,
    coreMesh,
  };
}

export function createTangentArcVisual(): TangentArcVisual {
  const group = new THREE.Group();
  const maxSegments = 120;
  const positions = new Float32Array(maxSegments * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x1d4e89, transparent: true, opacity: 0.95 });
  const curveLine = new THREE.Line(geo, lineMat);
  group.add(curveLine);

  const curveLineGlow = new THREE.Line(geo, lineMat);
  curveLineGlow.position.y = 0.05;
  group.add(curveLineGlow);

  const tanPositions = new Float32Array(6);
  const tanGeo = new THREE.BufferGeometry();
  tanGeo.setAttribute('position', new THREE.BufferAttribute(tanPositions, 3));
  const tanMat = new THREE.LineBasicMaterial({ color: 0xff6b2c, transparent: true, opacity: 1.0 });
  const tanLine = new THREE.Line(tanGeo, tanMat);
  group.add(tanLine);

  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.24, 0),
    new THREE.MeshBasicMaterial({ color: 0xffd75e }),
  );
  group.add(marker);

  const markerHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.032, 6, 20),
    new THREE.MeshBasicMaterial({ color: 0xff6b2c }),
  );
  group.add(markerHalo);

  return {
    group,
    updateCurve: (fn, theta, origin, accentColor, segments) => {
      const count = Math.max(20, Math.min(maxSegments, segments));
      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
      const span = Math.PI * 1.5;
      const half = span * 0.5;
      const yScale = 0.34;
      const xScale = 1.85;
      const baseHeight = 4.85;

      for (let i = 0; i < count; i++) {
        const t = (i / (count - 1)) * span - half;
        const val = evaluateTrig(fn, theta + t).value;
        const clampedY = Math.max(-2.6, Math.min(2.6, val * yScale));
        posAttr.setXYZ(i, origin.x + t * xScale, origin.y + baseHeight + clampedY, origin.z);
      }
      posAttr.needsUpdate = true;
      geo.setDrawRange(0, count);
      lineMat.color.setHex(accentColor);

      const centerY = Math.max(-2.6, Math.min(2.6, evaluateTrig(fn, theta).value * yScale));
      const slope = evaluateExactDerivative(fn, theta).value;
      const clampedSlope = Math.max(-4, Math.min(4, slope));

      marker.position.set(origin.x, origin.y + baseHeight + centerY, origin.z);
      marker.rotation.y += 0.05;
      markerHalo.position.copy(marker.position);
      markerHalo.rotation.z = Math.atan(clampedSlope * 0.4);

      const dx = 1.15;
      const dy = clampedSlope * yScale * (dx / xScale);
      const tanAttr = tanGeo.getAttribute('position') as THREE.BufferAttribute;
      tanAttr.setXYZ(0, origin.x - dx, origin.y + baseHeight + centerY - dy, origin.z);
      tanAttr.setXYZ(1, origin.x + dx, origin.y + baseHeight + centerY + dy, origin.z);
      tanAttr.needsUpdate = true;
    },
  };
}

/* =====================================================================
 * SOLSTICE HAVEN VILLAGE & NPC PROCEDURAL MODELS
 * ===================================================================== */

export interface VillageModelBundle {
  cottages: THREE.Group[];
  fountain: { group: THREE.Group; update: (dt: number) => void };
  lanterns: THREE.Group[];
  planters: THREE.Group[];
  gazebo: { group: THREE.Group; update: (dt: number) => void };
  archmage: { group: THREE.Group; update: (dt: number) => void };
  npcs: {
    id: string;
    name: string;
    title: string;
    role: 'blacksmith' | 'herbalist' | 'scout';
    group: THREE.Group;
    update: (dt: number) => void;
  }[];
}

export function createVillageCottage(variant: number = 0): THREE.Group {
  const cottage = new THREE.Group();

  // Wall plaster color variants
  const wallColors = [0xeadcc6, 0xdfd3be, 0xe5dbcb, 0xd8cdb6];
  const roofColors = [0x3d4852, 0x6e3828, 0x46533f, 0x4f423b];
  const wallColor = wallColors[variant % wallColors.length];
  const roofColor = roofColors[variant % roofColors.length];

  // Plaster Main Body
  const wallMat = new THREE.MeshStandardMaterial({
    color: wallColor,
    roughness: 0.85,
    metalness: 0.05,
  });
  const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3.2, 4.0), wallMat);
  wallMesh.position.y = 1.6;
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  cottage.add(wallMesh);

  // Timber Framing Posts (Corner columns and top sill)
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x4a2e18,
    roughness: 0.75,
  });
  const postGeo = new THREE.BoxGeometry(0.3, 3.3, 0.3);
  const corners = [
    [-2.2, 1.65, -1.9],
    [2.2, 1.65, -1.9],
    [-2.2, 1.65, 1.9],
    [2.2, 1.65, 1.9],
  ];
  corners.forEach(([x, y, z]) => {
    const post = new THREE.Mesh(postGeo, woodMat);
    post.position.set(x, y, z);
    cottage.add(post);
  });

  // Roof Gable Panels (Angled Box halves)
  const roofMat = new THREE.MeshStandardMaterial({
    color: roofColor,
    roughness: 0.8,
  });
  const roofLeft = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.25, 4.6), roofMat);
  roofLeft.position.set(-1.15, 3.9, 0);
  roofLeft.rotation.z = Math.PI * 0.17;
  roofLeft.castShadow = true;
  cottage.add(roofLeft);

  const roofRight = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.25, 4.6), roofMat);
  roofRight.position.set(1.15, 3.9, 0);
  roofRight.rotation.z = -Math.PI * 0.17;
  roofRight.castShadow = true;
  cottage.add(roofRight);

  // Gable end triangles
  const gableMat = new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.8 });
  const gableFront = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 2.3, 1.5, 3), gableMat);
  gableFront.position.set(0, 3.85, 2.0);
  gableFront.rotation.y = Math.PI;
  cottage.add(gableFront);

  const gableBack = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 2.3, 1.5, 3), gableMat);
  gableBack.position.set(0, 3.85, -2.0);
  cottage.add(gableBack);

  // Brick Chimney
  const chimneyMat = new THREE.MeshStandardMaterial({ color: 0x7c3a2a, roughness: 0.9 });
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.8, 0.7), chimneyMat);
  chimney.position.set(1.6, 2.8, -1.2);
  chimney.castShadow = true;
  cottage.add(chimney);

  const chimneyCap = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.15, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x3d4852, roughness: 0.8 })
  );
  chimneyCap.position.set(1.6, 4.75, -1.2);
  cottage.add(chimneyCap);

  // Wooden Front Door
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.9, 0.12), woodMat);
  door.position.set(0, 0.95, 2.03);
  cottage.add(door);

  // Front Windows with soft warm interior amber glow
  const windowGlowMat = new THREE.MeshBasicMaterial({ color: 0xfcd34d });
  const winFrameMat = new THREE.MeshStandardMaterial({ color: 0x3e2714, roughness: 0.7 });

  const win1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.08), windowGlowMat);
  win1.position.set(-1.3, 1.8, 2.02);
  cottage.add(win1);

  const win1Frame = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.12), winFrameMat);
  win1Frame.position.set(-1.3, 1.8, 2.0);
  cottage.add(win1Frame);

  const win2 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.08), windowGlowMat);
  win2.position.set(1.3, 1.8, 2.02);
  cottage.add(win2);

  const win2Frame = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.12), winFrameMat);
  win2Frame.position.set(1.3, 1.8, 2.0);
  cottage.add(win2Frame);

  return cottage;
}

export function createTownFountain(): { group: THREE.Group; update: (dt: number) => void } {
  const group = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xc4beb3,
    roughness: 0.8,
  });

  // Main Tier Basin Outer
  const outerBasin = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.1, 0.65, 16), stoneMat);
  outerBasin.position.y = 0.32;
  outerBasin.castShadow = true;
  outerBasin.receiveShadow = true;
  group.add(outerBasin);

  // Lower Basin Water Surface
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    roughness: 0.12,
    metalness: 0.25,
    transparent: true,
    opacity: 0.82,
  });
  const lowerWater = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.08, 16), waterMat);
  lowerWater.position.y = 0.55;
  group.add(lowerWater);

  // Center Pedestal Column
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.85, 1.8, 12), stoneMat);
  pedestal.position.y = 1.2;
  pedestal.castShadow = true;
  group.add(pedestal);

  // Upper Tier Small Basin
  const upperBasin = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 0.4, 12), stoneMat);
  upperBasin.position.y = 2.0;
  upperBasin.castShadow = true;
  group.add(upperBasin);

  // Upper Water
  const upperWater = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.06, 12), waterMat);
  upperWater.position.y = 2.2;
  group.add(upperWater);

  // Center Spire & Spray Jet
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.8, 8), stoneMat);
  spire.position.y = 2.5;
  group.add(spire);

  const jetMat = new THREE.MeshBasicMaterial({
    color: 0xe0f2fe,
    transparent: true,
    opacity: 0.75,
  });
  const sprayJet = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 8), jetMat);
  sprayJet.position.y = 3.1;
  group.add(sprayJet);

  let time = 0;
  return {
    group,
    update: (dt: number) => {
      time += dt;
      lowerWater.position.y = 0.55 + Math.sin(time * 2.5) * 0.015;
      sprayJet.scale.y = 0.85 + Math.sin(time * 5.0) * 0.15;
      sprayJet.rotation.y += dt * 1.5;
    },
  };
}

export function createLanternPost(): THREE.Group {
  const group = new THREE.Group();

  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.6,
    metalness: 0.75,
  });

  // Base
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.25, 8), ironMat);
  base.position.y = 0.125;
  group.add(base);

  // Main Pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.0, 8), ironMat);
  pole.position.y = 1.6;
  pole.castShadow = true;
  group.add(pole);

  // Cross arm
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.08, 0.08), ironMat);
  arm.position.set(0.22, 3.0, 0);
  group.add(arm);

  // Hanging Lantern Housing
  const lanternFrame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.3), ironMat);
  lanternFrame.position.set(0.45, 2.75, 0);
  group.add(lanternFrame);

  // Glowing Lantern Glass Core
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  const lanternGlass = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34, 0.24), glowMat);
  lanternGlass.position.set(0.45, 2.75, 0);
  group.add(lanternGlass);

  return group;
}

export function createPlanterBox(): THREE.Group {
  const group = new THREE.Group();

  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x4a2e18,
    roughness: 0.8,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 0.55), woodMat);
  box.position.y = 0.225;
  box.castShadow = true;
  group.add(box);

  // Soil
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x24180d, roughness: 0.95 });
  const soil = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.08, 0.45), soilMat);
  soil.position.y = 0.42;
  group.add(soil);

  // Colorful Little Flowers
  const petalColors = [0xef4444, 0xa855f7, 0xfacc15, 0xec4899, 0x38bdf8];
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.7 });
  for (let i = 0; i < 7; i++) {
    const ox = -0.55 + i * 0.18 + (Math.random() - 0.5) * 0.06;
    const oz = (Math.random() - 0.5) * 0.25;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 4), stemMat);
    stem.position.set(ox, 0.5, oz);
    group.add(stem);

    const blossomMat = new THREE.MeshBasicMaterial({ color: petalColors[i % petalColors.length] });
    const blossom = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06, 0), blossomMat);
    blossom.position.set(ox, 0.6, oz);
    group.add(blossom);
  }

  return group;
}

export function createAstrolabeGazebo(): { group: THREE.Group; update: (dt: number) => void } {
  const group = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xe2ded4, // Polished classical limestone
    roughness: 0.72,
  });
  const darkStoneMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.8,
  });
  const goldTrimMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    metalness: 0.82,
    roughness: 0.28,
  });
  const copperPatinaMat = new THREE.MeshStandardMaterial({
    color: 0x2d6a65, // Weathered celestial verdigris copper
    roughness: 0.55,
    metalness: 0.35,
  });
  const lapisBlueMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.65,
    metalness: 0.2,
  });

  // 1. Two-Tiered Circular Marble Plinth
  const plinthLower = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.7, 0.35, 24), stoneMat);
  plinthLower.position.y = 0.175;
  plinthLower.receiveShadow = true;
  group.add(plinthLower);

  const plinthUpper = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 4.1, 0.3, 24), stoneMat);
  plinthUpper.position.y = 0.48;
  plinthUpper.receiveShadow = true;
  group.add(plinthUpper);

  // Concentric Brass Floor Inlay on Plinth
  const floorRing1 = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.03, 6, 32), goldTrimMat);
  floorRing1.position.y = 0.635;
  floorRing1.rotation.x = Math.PI * 0.5;
  group.add(floorRing1);

  const floorRing2 = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.025, 6, 28), goldTrimMat);
  floorRing2.position.y = 0.635;
  floorRing2.rotation.x = Math.PI * 0.5;
  group.add(floorRing2);

  // 2. Eight Fluted Classical Columns with Molded Bases & Corinthian Gold Capitals
  const pillarRadius = 3.2;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const px = Math.cos(angle) * pillarRadius;
    const pz = Math.sin(angle) * pillarRadius;

    // Pedestal Base
    const colBase = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.25, 12), darkStoneMat);
    colBase.position.set(px, 0.75, pz);
    colBase.castShadow = true;
    group.add(colBase);

    // 12-sided Fluted Shaft
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 3.3, 12), stoneMat);
    shaft.position.set(px, 2.5, pz);
    shaft.castShadow = true;
    group.add(shaft);

    // Corinthian Gold Capital
    const capital = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.22, 0.26, 12), goldTrimMat);
    capital.position.set(px, 4.22, pz);
    capital.castShadow = true;
    group.add(capital);
  }

  // 3. Double-Tiered Entablature Ring (Rests flush on top of column capitals)
  const entablatureGroup = new THREE.Group();
  entablatureGroup.name = 'gazebo_entablature';
  entablatureGroup.position.y = 4.38;
  group.add(entablatureGroup);

  const architraveBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(3.42, 3.32, 0.22, 24),
    stoneMat
  );
  architraveBeam.castShadow = true;
  entablatureGroup.add(architraveBeam);

  const corniceRing = new THREE.Mesh(
    new THREE.CylinderGeometry(3.55, 3.42, 0.16, 24),
    darkStoneMat
  );
  corniceRing.position.y = 0.18;
  corniceRing.castShadow = true;
  entablatureGroup.add(corniceRing);

  const goldDentilTrim = new THREE.Mesh(
    new THREE.TorusGeometry(3.52, 0.035, 6, 32),
    goldTrimMat
  );
  goldDentilTrim.position.y = 0.26;
  goldDentilTrim.rotation.x = Math.PI * 0.5;
  entablatureGroup.add(goldDentilTrim);

  // 4. Solid Ribbed Patina & Lapis Celestial Dome (Seats flush on top of cornice)
  const domeGroup = new THREE.Group();
  domeGroup.name = 'gazebo_dome';
  // Cornice top is at y = 4.38 + 0.18 + 0.08 = 4.64. Dome starts directly at y = 4.64.
  domeGroup.position.y = 4.64;
  group.add(domeGroup);

  // Hemisphere Dome Shell (Scaled to height = 2.1m)
  const domeShellGeo = new THREE.SphereGeometry(3.45, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const domeMesh = new THREE.Mesh(domeShellGeo, copperPatinaMat);
  domeMesh.scale.set(1.0, 0.62, 1.0);
  domeMesh.castShadow = true;
  domeMesh.receiveShadow = true;
  domeGroup.add(domeMesh);

  // Inner Ceiling Shell with Celestial Blue Tone
  const domeInner = new THREE.Mesh(
    new THREE.SphereGeometry(3.4, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
    lapisBlueMat
  );
  domeInner.scale.set(1.0, 0.61, 1.0);
  domeInner.material.side = THREE.BackSide;
  domeGroup.add(domeInner);

  // Eight Radial Gold Structural Ribs Arcing to the Summit
  const ribHeight = 3.45 * 0.62; // 2.14m apex
  for (let r = 0; r < 8; r++) {
    const ribAngle = (r / 8) * Math.PI * 2;
    const rib = new THREE.Mesh(
      new THREE.TorusGeometry(3.45, 0.032, 6, 18, Math.PI * 0.5),
      goldTrimMat
    );
    rib.scale.set(1.0, 0.62, 1.0);
    rib.rotation.y = ribAngle;
    rib.castShadow = true;
    domeGroup.add(rib);
  }

  // Summit Gold Oculus Collar
  const oculusCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.65, 0.18, 16),
    goldTrimMat
  );
  oculusCollar.position.y = ribHeight + 0.09;
  domeGroup.add(oculusCollar);

  // 5. Celestial Astrolabe Weather Finial Tower
  const finialBase = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 0.65, 10),
    goldTrimMat
  );
  finialBase.position.y = ribHeight + 0.45;
  domeGroup.add(finialBase);

  const finialRing1 = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.025, 6, 16), goldTrimMat);
  finialRing1.position.y = ribHeight + 0.82;
  domeGroup.add(finialRing1);

  const finialRing2 = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.022, 6, 14), goldTrimMat);
  finialRing2.position.y = ribHeight + 0.82;
  finialRing2.rotation.x = Math.PI * 0.5;
  domeGroup.add(finialRing2);

  const finialSpire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.06, 0.85, 8),
    goldTrimMat
  );
  finialSpire.position.y = ribHeight + 1.25;
  domeGroup.add(finialSpire);

  const finialStar = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.12, 0),
    new THREE.MeshBasicMaterial({ color: 0x60a5fa })
  );
  finialStar.position.y = ribHeight + 1.7;
  domeGroup.add(finialStar);

  // 6. Central Suspended Astrolabe Orrery (Concentric gimbaled rings & stellar core)
  const orreryGroup = new THREE.Group();
  orreryGroup.name = 'gazebo_orrery';
  orreryGroup.position.set(0, 2.75, 0);
  group.add(orreryGroup);

  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.04, 6, 28), goldTrimMat);
  orreryGroup.add(ring1);

  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.035, 6, 24), goldTrimMat);
  ring2.rotation.x = Math.PI * 0.35;
  orreryGroup.add(ring2);

  const ring3 = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.03, 6, 20), goldTrimMat);
  ring3.rotation.y = Math.PI * 0.45;
  orreryGroup.add(ring3);

  // Central Oscillating Celestial Stellar Core
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 1.2,
    roughness: 0.1,
    metalness: 0.2,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), coreMat);
  orreryGroup.add(core);

  let orreryTime = 0;
  return {
    group,
    update: (dt: number) => {
      orreryTime += dt;
      ring1.rotation.y += dt * 0.45;
      ring2.rotation.x += dt * 0.6;
      ring3.rotation.z += dt * 0.75;
      core.rotation.y += dt * 1.4;
      core.rotation.x += dt * 0.8;
      core.position.y = Math.sin(orreryTime * 2.0) * 0.05;
      finialRing1.rotation.y += dt * 0.25;
      finialRing2.rotation.z += dt * 0.35;
    },
  };
}

export function createArchmageAurelius(): { group: THREE.Group; update: (dt: number) => void } {
  const group = new THREE.Group();

  // --- Stylized Elder Sage Materials ---
  const robeMat = new THREE.MeshStandardMaterial({
    color: 0x1e1b4b, // Midnight indigo
    roughness: 0.65,
  });
  const innerTunicMat = new THREE.MeshStandardMaterial({
    color: 0x1e3a8a, // Deep sapphire azure
    roughness: 0.7,
  });
  const mantleMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a, // Obsidian mantle
    roughness: 0.6,
  });
  const goldTrimMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    metalness: 0.85,
    roughness: 0.25,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xf5d0b5,
    roughness: 0.75,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9, // Luminous silver hair
    roughness: 0.85,
  });
  const staffWoodMat = new THREE.MeshStandardMaterial({
    color: 0x3e2723, // Polished dark starwood
    roughness: 0.75,
  });
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 1.4,
    roughness: 0.15,
  });

  // 1. Pleated Midnight-Indigo Astral Robes
  const robeGroup = new THREE.Group();
  robeGroup.name = 'aurelius_robe';
  group.add(robeGroup);

  // Lower Flared Pleated Robe Skirt
  const robeSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.68, 1.35, 12), robeMat);
  robeSkirt.position.y = 0.68;
  robeSkirt.castShadow = true;
  robeGroup.add(robeSkirt);

  // Embroidered Celestial Gold Hemline
  const robeHemRing = new THREE.Mesh(new THREE.TorusGeometry(0.69, 0.04, 6, 20), goldTrimMat);
  robeHemRing.position.y = 0.05;
  robeHemRing.rotation.x = Math.PI * 0.5;
  robeGroup.add(robeHemRing);

  // Upper Torso & Sapphire Inner Tunic
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.65, 10), innerTunicMat);
  torso.position.y = 1.35;
  torso.castShadow = true;
  robeGroup.add(torso);

  // Gold Arcane Sash & Frogs
  const sash = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.37, 0.1, 10), goldTrimMat);
  sash.position.y = 1.05;
  robeGroup.add(sash);

  // 2. Layered Shoulder Cowl & Embroidered Mantle (Replaces the crude barrel cylinder)
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.3, 12), mantleMat);
  cowl.position.y = 1.52;
  cowl.castShadow = true;
  robeGroup.add(cowl);

  const cowlTrim = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.03, 6, 18), goldTrimMat);
  cowlTrim.position.y = 1.38;
  cowlTrim.rotation.x = Math.PI * 0.5;
  robeGroup.add(cowlTrim);

  // Celestial Star Brooch at Center Neck
  const neckBrooch = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), goldTrimMat);
  neckBrooch.position.set(0, 1.54, 0.44);
  robeGroup.add(neckBrooch);

  // 3. Head & Dignified Elder Facial Features
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.18, 8), skinMat);
  neck.position.y = 1.68;
  robeGroup.add(neck);

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.84, 0.02);
  robeGroup.add(headGroup);

  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), skinMat);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  // Flowing Silver Wizard Hair Locks
  const hairCrown = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 8, 0, Math.PI * 2, 0, Math.PI * 0.6),
    hairMat
  );
  hairCrown.position.set(0, 0.04, -0.02);
  headGroup.add(hairCrown);

  const hairDrape = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.45, 8), hairMat);
  hairDrape.position.set(0, -0.15, -0.12);
  headGroup.add(hairDrape);

  // 4. Long Braided Wizard Beard with Gold Arcane Rune Rings
  const beardGroup = new THREE.Group();
  beardGroup.name = 'aurelius_beard';
  beardGroup.position.set(0, -0.1, 0.14);
  headGroup.add(beardGroup);

  const beardMain = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.72, 8), hairMat);
  beardMain.position.set(0, -0.22, 0.04);
  beardMain.rotation.x = -Math.PI * 0.12;
  beardGroup.add(beardMain);

  // Twin Braids
  const braidLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.025, 0.45, 6), hairMat);
  braidLeft.position.set(-0.08, -0.42, 0.06);
  beardGroup.add(braidLeft);

  const braidRight = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.025, 0.45, 6), hairMat);
  braidRight.position.set(0.08, -0.42, 0.06);
  beardGroup.add(braidRight);

  // Gold Arcane Rings on Braids
  const ringL1 = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.012, 6, 8), goldTrimMat);
  ringL1.position.set(-0.08, -0.32, 0.06);
  ringL1.rotation.x = Math.PI * 0.5;
  beardGroup.add(ringL1);

  const ringR1 = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.012, 6, 8), goldTrimMat);
  ringR1.position.set(0.08, -0.32, 0.06);
  ringR1.rotation.x = Math.PI * 0.5;
  beardGroup.add(ringR1);

  // 5. Ornate Pointed Wizard Hat with Curved Peak & Crescent Brooch
  const hatGroup = new THREE.Group();
  hatGroup.name = 'aurelius_hat';
  hatGroup.position.set(0, 0.16, 0);
  headGroup.add(hatGroup);

  // Undulating Broad Hat Brim
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.04, 18), robeMat);
  hatBrim.castShadow = true;
  hatGroup.add(hatBrim);

  const hatBrimTrim = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.025, 6, 20), goldTrimMat);
  hatBrimTrim.rotation.x = Math.PI * 0.5;
  hatGroup.add(hatBrimTrim);

  // Hat Band & Crescent Moon Emblem
  const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.33, 0.12, 14), goldTrimMat);
  hatBand.position.y = 0.07;
  hatGroup.add(hatBand);

  const crescentBrooch = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI * 1.3), goldTrimMat);
  crescentBrooch.position.set(0, 0.08, 0.33);
  crescentBrooch.rotation.z = Math.PI * 0.25;
  hatGroup.add(crescentBrooch);

  // Tapered Hat Cone with Curved Backward Peak
  const hatConeLower = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 10), robeMat);
  hatConeLower.position.set(0, 0.34, -0.04);
  hatConeLower.rotation.x = -Math.PI * 0.12;
  hatConeLower.castShadow = true;
  hatGroup.add(hatConeLower);

  const hatConeTip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 8), robeMat);
  hatConeTip.position.set(0, 0.72, -0.16);
  hatConeTip.rotation.x = -Math.PI * 0.28;
  hatConeTip.castShadow = true;
  hatGroup.add(hatConeTip);

  // 6. Right Arm Holding Starwood Astrolabe Staff
  const rightArmGroup = new THREE.Group();
  rightArmGroup.position.set(0.38, 1.45, 0);
  robeGroup.add(rightArmGroup);

  const rightSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.65, 8), robeMat);
  rightSleeve.position.set(0.06, -0.25, 0.1);
  rightSleeve.rotation.set(0.3, 0, -0.2);
  rightArmGroup.add(rightSleeve);

  const staffGroup = new THREE.Group();
  staffGroup.name = 'aurelius_staff';
  staffGroup.position.set(0.55, 0, 0.28);
  group.add(staffGroup);

  // Carved Starwood Shaft
  const staffShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 2.35, 8), staffWoodMat);
  staffShaft.position.y = 1.175;
  staffShaft.castShadow = true;
  staffGroup.add(staffShaft);

  // Helical Gold Vine Wrapping
  for (let v = 0; v < 6; v++) {
    const vine = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.012, 4, 12, Math.PI * 1.5), goldTrimMat);
    vine.position.y = 0.4 + v * 0.32;
    vine.rotation.x = Math.PI * 0.4;
    vine.rotation.y = v * 0.8;
    staffGroup.add(vine);
  }

  // Brass Armillary Astrolabe Cage Head
  const staffArmillary = new THREE.Group();
  staffArmillary.position.y = 2.42;
  staffGroup.add(staffArmillary);

  const staffRing1 = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.022, 6, 16), goldTrimMat);
  staffArmillary.add(staffRing1);

  const staffRing2 = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 6, 14), goldTrimMat);
  staffRing2.rotation.x = Math.PI * 0.45;
  staffArmillary.add(staffRing2);

  // Oscillating Cyan Focus Crystal
  const staffCrystal = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12, 0), crystalMat);
  staffArmillary.add(staffCrystal);

  // 7. Left Arm in Arcane Channeling Gesture
  const leftArmGroup = new THREE.Group();
  leftArmGroup.position.set(-0.38, 1.45, 0);
  robeGroup.add(leftArmGroup);

  const leftSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.65, 8), robeMat);
  leftSleeve.position.set(-0.06, -0.22, 0.12);
  leftSleeve.rotation.set(0.5, 0, 0.35);
  leftArmGroup.add(leftSleeve);

  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), skinMat);
  leftHand.position.set(-0.16, -0.48, 0.32);
  leftArmGroup.add(leftHand);

  // Floating channeling spark mote in left palm
  const leftPalmSpark = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.04, 0),
    new THREE.MeshBasicMaterial({ color: 0x60a5fa })
  );
  leftPalmSpark.position.set(-0.16, -0.42, 0.36);
  leftArmGroup.add(leftPalmSpark);

  let sageTime = 0;
  return {
    group,
    update: (dt: number) => {
      sageTime += dt;
      // Gentle breathing idle
      robeGroup.position.y = Math.sin(sageTime * 1.8) * 0.012;
      headGroup.rotation.y = Math.sin(sageTime * 0.8) * 0.05;

      // Staff crystal spin and harmonic float
      staffRing1.rotation.y += dt * 1.6;
      staffRing2.rotation.z += dt * 2.2;
      staffCrystal.rotation.y += dt * 2.0;
      staffCrystal.rotation.x += dt * 1.2;
      staffArmillary.position.y = 2.42 + Math.sin(sageTime * 2.5) * 0.04;

      // Left palm arcane energy pulse
      leftPalmSpark.scale.setScalar(0.8 + Math.sin(sageTime * 4.0) * 0.3);
      leftPalmSpark.rotation.y += dt * 3.0;
    },
  };
}


export function createTheronBlacksmith(): { group: THREE.Group; update: (dt: number) => void } {
  const group = new THREE.Group();

  // --- Stylized Palette Materials ---
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xdeb897, roughness: 0.7 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x3a2013, roughness: 0.85 });
  const beardMat = new THREE.MeshStandardMaterial({ color: 0x321a0d, roughness: 0.85 });
  const goldTrimMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.8, roughness: 0.25 });
  const tunicMat = new THREE.MeshStandardMaterial({ color: 0xede2cb, roughness: 0.8 });
  const apronMat = new THREE.MeshStandardMaterial({ color: 0x542c16, roughness: 0.65 });
  const beltMat = new THREE.MeshStandardMaterial({ color: 0x2e180d, roughness: 0.7 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x292524, roughness: 0.85 });
  const bootsMat = new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.6 });
  const bracersMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.7 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.35 });
  const polishedSteelMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
  const timberMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 });
  const charcoalMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.95 });
  const hotIronMat = new THREE.MeshStandardMaterial({
    color: 0xff3b00,
    emissive: 0xff4500,
    emissiveIntensity: 1.0,
    roughness: 0.3,
  });

  // --- 1. Theron Character Rig ---
  const charGroup = new THREE.Group();
  group.add(charGroup);

  // Boots & Legs
  const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.65, 8), pantsMat);
  leftLeg.position.set(-0.2, 0.45, 0);
  leftLeg.castShadow = true;
  charGroup.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.65, 8), pantsMat);
  rightLeg.position.set(0.2, 0.45, 0);
  rightLeg.castShadow = true;
  charGroup.add(rightLeg);

  const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.36), bootsMat);
  leftBoot.position.set(-0.2, 0.11, 0.05);
  leftBoot.castShadow = true;
  charGroup.add(leftBoot);

  const rightBoot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.36), bootsMat);
  rightBoot.position.set(0.2, 0.11, 0.05);
  rightBoot.castShadow = true;
  charGroup.add(rightBoot);

  // Boot buckles
  const leftBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.06), goldTrimMat);
  leftBuckle.position.set(-0.2, 0.18, 0.2);
  charGroup.add(leftBuckle);

  const rightBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.06), goldTrimMat);
  rightBuckle.position.set(0.2, 0.18, 0.2);
  charGroup.add(rightBuckle);

  // Torso / Tunic (Broad muscular smith chest)
  const torsoGroup = new THREE.Group();
  torsoGroup.position.y = 1.1;
  charGroup.add(torsoGroup);

  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 0.68, 8), tunicMat);
  chest.castShadow = true;
  torsoGroup.add(chest);

  // Stitched Heavy Leather Apron (Front curved apron + bib)
  const apronBib = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.52, 0.12), apronMat);
  apronBib.position.set(0, 0.02, 0.26);
  torsoGroup.add(apronBib);

  const apronSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.08), apronMat);
  apronSkirt.position.set(0, -0.42, 0.24);
  torsoGroup.add(apronSkirt);

  // Brass Rivets & Buckles on Apron
  for (let r = 0; r < 4; r++) {
    const rx = (r % 2 === 0 ? -1 : 1) * 0.2;
    const ry = (r < 2 ? 0.22 : -0.18);
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), goldTrimMat);
    rivet.position.set(rx, ry, 0.33);
    torsoGroup.add(rivet);
  }

  // Work Tool Belt with Brass Buckle
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.1, 8), beltMat);
  belt.position.y = -0.22;
  torsoGroup.add(belt);

  const beltBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.05), goldTrimMat);
  beltBuckle.position.set(0, -0.22, 0.36);
  torsoGroup.add(beltBuckle);

  // Neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.2, 8), skinMat);
  neck.position.y = 0.42;
  torsoGroup.add(neck);

  // Head & Stylized Hair/Beard
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.62, 0.02);
  torsoGroup.add(headGroup);

  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), skinMat);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  // Sculpted Swept-back Hair
  const hairCrown = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
  hairCrown.position.set(0, 0.04, -0.02);
  headGroup.add(hairCrown);

  const hairTail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.35, 6), hairMat);
  hairTail.position.set(0, -0.06, -0.2);
  hairTail.rotation.x = -Math.PI * 0.4;
  headGroup.add(hairTail);

  // Braided Dwarf/Viking Beard with Gold Rings
  const beardMain = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 8), beardMat);
  beardMain.position.set(0, -0.26, 0.16);
  beardMain.rotation.x = -Math.PI * 0.15;
  headGroup.add(beardMain);

  const beardBraidLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.025, 0.35, 6), beardMat);
  beardBraidLeft.position.set(-0.08, -0.42, 0.2);
  headGroup.add(beardBraidLeft);

  const beardBraidRight = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.025, 0.35, 6), beardMat);
  beardBraidRight.position.set(0.08, -0.42, 0.2);
  headGroup.add(beardBraidRight);

  const goldRingLeft = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.015, 6, 8), goldTrimMat);
  goldRingLeft.position.set(-0.08, -0.36, 0.2);
  goldRingLeft.rotation.x = Math.PI * 0.5;
  headGroup.add(goldRingLeft);

  const goldRingRight = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.015, 6, 8), goldTrimMat);
  goldRingRight.position.set(0.08, -0.36, 0.2);
  goldRingRight.rotation.x = Math.PI * 0.5;
  headGroup.add(goldRingRight);

  // Left Arm (Holding long blacksmith tongs toward anvil)
  const leftArmGroup = new THREE.Group();
  leftArmGroup.position.set(-0.4, 0.24, 0);
  torsoGroup.add(leftArmGroup);

  const leftShoulderSleeve = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.04, 6, 8), tunicMat);
  leftShoulderSleeve.position.set(0, 0, 0);
  leftArmGroup.add(leftShoulderSleeve);

  const leftBicep = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.35, 8), skinMat);
  leftBicep.position.set(-0.05, -0.15, 0.1);
  leftBicep.rotation.set(0.4, 0, -0.3);
  leftArmGroup.add(leftBicep);

  const leftForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.38, 8), bracersMat);
  leftForearm.position.set(-0.06, -0.32, 0.32);
  leftForearm.rotation.set(1.1, 0.4, -0.2);
  leftArmGroup.add(leftForearm);

  // Long Smithing Tongs clamped onto the hot billet
  const tongsHaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.85, 6), ironMat);
  tongsHaft.position.set(0.12, -0.35, 0.65);
  tongsHaft.rotation.set(1.5, 0.6, 0);
  leftArmGroup.add(tongsHaft);

  // Right Arm (Articulated Pivoting Hammer Arm)
  const hammerArmGroup = new THREE.Group();
  hammerArmGroup.name = 'theron_hammer_arm';
  hammerArmGroup.position.set(0.42, 0.24, 0);
  torsoGroup.add(hammerArmGroup);

  const rightShoulderSleeve = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.04, 6, 8), tunicMat);
  hammerArmGroup.add(rightShoulderSleeve);

  const rightBicep = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.11, 0.36, 8), skinMat);
  rightBicep.position.set(0.04, -0.15, 0);
  hammerArmGroup.add(rightBicep);

  const rightForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.38, 8), bracersMat);
  rightForearm.position.set(0.08, -0.38, 0.12);
  rightForearm.rotation.x = 0.5;
  hammerArmGroup.add(rightForearm);

  // Heavy Forged Smithing Hammer
  const hammerHaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 6), timberMat);
  hammerHaft.position.set(0.1, -0.5, 0.3);
  hammerHaft.rotation.x = Math.PI * 0.45;
  hammerArmGroup.add(hammerHaft);

  const hammerHead = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.15, 0.28), ironMat);
  hammerHead.position.set(0.1, -0.48, 0.62);
  hammerArmGroup.add(hammerHead);

  const hammerFace = new THREE.Mesh(new THREE.BoxGeometry(0.142, 0.152, 0.04), polishedSteelMat);
  hammerFace.position.set(0.1, -0.48, 0.76);
  hammerArmGroup.add(hammerFace);

  // --- 2. Authentic Smith's Anvil & Timber Base ---
  const anvilStation = new THREE.Group();
  anvilStation.name = 'theron_anvil';
  anvilStation.position.set(0.62, 0, 0.42);
  group.add(anvilStation);

  // Iron-Banded Oak Tree Stump Plinth
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.54, 0.65, 10), timberMat);
  stump.position.y = 0.325;
  stump.receiveShadow = true;
  anvilStation.add(stump);

  const stumpBand1 = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 6, 12), ironMat);
  stumpBand1.position.y = 0.5;
  stumpBand1.rotation.x = Math.PI * 0.5;
  anvilStation.add(stumpBand1);

  const stumpBand2 = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.03, 6, 12), ironMat);
  stumpBand2.position.y = 0.15;
  stumpBand2.rotation.x = Math.PI * 0.5;
  anvilStation.add(stumpBand2);

  // Cast Iron Anvil
  const anvilGroup = new THREE.Group();
  anvilGroup.position.y = 0.65;
  anvilStation.add(anvilGroup);

  // Anvil Foot / Base
  const anvilBase = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.65), ironMat);
  anvilBase.position.y = 0.05;
  anvilBase.castShadow = true;
  anvilGroup.add(anvilBase);

  // Anvil Waist (Arched narrow middle)
  const anvilWaist = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.25, 8), ironMat);
  anvilWaist.position.y = 0.2;
  anvilGroup.add(anvilWaist);

  // Anvil Table (Hardened steel flat top)
  const anvilTable = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.52), ironMat);
  anvilTable.position.set(0, 0.35, -0.04);
  anvilTable.castShadow = true;
  anvilGroup.add(anvilTable);

  const anvilFace = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.02, 0.5), polishedSteelMat);
  anvilFace.position.set(0, 0.42, -0.04);
  anvilGroup.add(anvilFace);

  // Anvil Conical Horn (Bickern)
  const anvilHorn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.38, 8), ironMat);
  anvilHorn.position.set(0, 0.36, 0.4);
  anvilHorn.rotation.x = Math.PI * 0.5;
  anvilHorn.castShadow = true;
  anvilGroup.add(anvilHorn);

  // Glowing Heated Steel Billet on Anvil
  const hotBillet = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.32), hotIronMat);
  hotBillet.position.set(0, 0.46, -0.02);
  anvilGroup.add(hotBillet);

  // --- 3. Stone Forge Hearth Station ---
  const forgeStation = new THREE.Group();
  forgeStation.name = 'theron_forge';
  forgeStation.position.set(-1.05, 0, -0.45);
  group.add(forgeStation);

  // Stone Basin (Curved riverstone hearth)
  const stoneBasin = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.7, 10), stoneMat);
  stoneBasin.position.y = 0.35;
  stoneBasin.castShadow = true;
  stoneBasin.receiveShadow = true;
  forgeStation.add(stoneBasin);

  // Fire Pot Rim
  const fireRim = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.08, 6, 12), ironMat);
  fireRim.position.y = 0.7;
  fireRim.rotation.x = Math.PI * 0.5;
  forgeStation.add(fireRim);

  // Jagged Coals & Embers
  const charcoalBed = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.55, 0.15, 8), charcoalMat);
  charcoalBed.position.y = 0.72;
  forgeStation.add(charcoalBed);

  for (let c = 0; c < 8; c++) {
    const angle = (c / 8) * Math.PI * 2;
    const r = 0.2 + (c % 3) * 0.12;
    const ember = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.08, 0),
      new THREE.MeshBasicMaterial({ color: (c % 2 === 0 ? 0xff4500 : 0xff7700) })
    );
    ember.position.set(Math.cos(angle) * r, 0.8, Math.sin(angle) * r);
    forgeStation.add(ember);
  }

  // Stone Chimney Hood
  const forgeHood = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.2, 8), stoneMat);
  forgeHood.position.set(0, 1.85, 0);
  forgeHood.castShadow = true;
  forgeStation.add(forgeHood);

  const forgePipe = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.4, 8), ironMat);
  forgePipe.position.set(0, 2.9, 0);
  forgePipe.castShadow = true;
  forgeStation.add(forgePipe);

  // --- 4. Slack Quenching Barrel Tub ---
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(1.15, 0, -0.35);
  group.add(barrelGroup);

  const barrelStaves = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.36, 0.6, 10), timberMat);
  barrelStaves.position.y = 0.3;
  barrelStaves.castShadow = true;
  barrelGroup.add(barrelStaves);

  const barrelBand1 = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.02, 6, 12), ironMat);
  barrelBand1.position.y = 0.48;
  barrelBand1.rotation.x = Math.PI * 0.5;
  barrelGroup.add(barrelBand1);

  const barrelWater = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.38, 0.02, 10),
    new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 })
  );
  barrelWater.position.y = 0.55;
  barrelGroup.add(barrelWater);

  // --- 5. Spark Particle System (Pooled) ---
  const SPARK_COUNT = 14;
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffea00 });
  const sparkGeo = new THREE.TetrahedronGeometry(0.035, 0);
  const sparks: { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[] = [];

  const sparkGroup = new THREE.Group();
  group.add(sparkGroup);

  for (let s = 0; s < SPARK_COUNT; s++) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.visible = false;
    sparkGroup.add(mesh);
    sparks.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0 });
  }

  function emitSparks(contactPos: THREE.Vector3) {
    sparks.forEach((sp, idx) => {
      sp.mesh.position.copy(contactPos);
      sp.mesh.visible = true;
      const angle = (idx / SPARK_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed = 1.2 + Math.random() * 2.2;
      sp.vx = Math.cos(angle) * speed * 0.8;
      sp.vy = 1.5 + Math.random() * 2.0;
      sp.vz = Math.sin(angle) * speed * 0.8;
      sp.life = 0.35 + Math.random() * 0.2;
    });
  }

  // --- 6. Procedural Rhythmic Hammer Animation Loop ---
  let cycleTime = 0;
  const CYCLE_DURATION = 1.35; // seconds per full swing
  let struckThisCycle = false;

  const billetWorldPos = new THREE.Vector3(0.62, 1.12, 0.4);

  return {
    group,
    update: (dt: number) => {
      cycleTime += dt;
      const t = cycleTime % CYCLE_DURATION;

      // Subtle breathing motion
      torsoGroup.position.y = 1.1 + Math.sin(cycleTime * 2.0) * 0.015;
      headGroup.rotation.x = Math.sin(cycleTime * 1.5) * 0.04;

      // Hammer swing phase timing
      if (t < 0.7) {
        struckThisCycle = false;
        const progress = t / 0.7;
        const eased = Math.sin(progress * Math.PI * 0.5);
        hammerArmGroup.rotation.x = -eased * 1.35; // Lift arm back
        hammerArmGroup.rotation.z = -eased * 0.3;
        hotIronMat.emissiveIntensity = 0.8 + Math.sin(cycleTime * 4.0) * 0.2;
      } else if (t < 0.85) {
        // Hold at apex
        hammerArmGroup.rotation.x = -1.35;
        hammerArmGroup.rotation.z = -0.3;
      } else if (t < 0.96) {
        // Power strike downward!
        const strikeProg = (t - 0.85) / 0.11;
        const strikeEased = strikeProg * strikeProg; // Acceleration
        hammerArmGroup.rotation.x = -1.35 + strikeEased * 1.55;
        hammerArmGroup.rotation.z = -0.3 + strikeEased * 0.35;

        // Strike contact point!
        if (strikeProg >= 0.85 && !struckThisCycle) {
          struckThisCycle = true;
          hotIronMat.emissiveIntensity = 2.8; // Bright flash
          emitSparks(billetWorldPos);
          torsoGroup.position.y -= 0.04; // Impact recoil
        }
      } else {
        // Settle & recover
        hammerArmGroup.rotation.x = 0.2;
        hammerArmGroup.rotation.z = 0.05;
        hotIronMat.emissiveIntensity = Math.max(0.8, hotIronMat.emissiveIntensity - dt * 4.0);
      }

      // Update flying sparks
      sparks.forEach((sp) => {
        if (sp.life > 0) {
          sp.life -= dt;
          sp.vy -= 9.8 * dt; // Gravity
          sp.mesh.position.x += sp.vx * dt;
          sp.mesh.position.y += sp.vy * dt;
          sp.mesh.position.z += sp.vz * dt;
          sp.mesh.scale.setScalar(Math.max(0.1, sp.life / 0.5));
          if (sp.life <= 0 || sp.mesh.position.y <= 0) {
            sp.mesh.visible = false;
          }
        }
      });
    },
  };
}

export function createTownsperson(
  role: 'blacksmith' | 'herbalist' | 'scout'
): { group: THREE.Group; update: (dt: number) => void } {
  if (role === 'blacksmith') {
    return createTheronBlacksmith();
  }

  const group = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf1c29b, roughness: 0.8 });

  if (role === 'herbalist') {
    // Lyra the Herbalist
    const dressMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.75 });
    const apronMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.8 });

    // Dress
    const dress = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 1.3, 8), dressMat);
    dress.position.y = 0.65;
    dress.castShadow = true;
    group.add(dress);

    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, 0.08), apronMat);
    apron.position.set(0, 0.8, 0.22);
    group.add(apron);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), skinMat);
    head.position.y = 1.45;
    group.add(head);

    // Flower circlet
    const circlet = new THREE.Mesh(
      new THREE.TorusGeometry(0.19, 0.03, 6, 12),
      new THREE.MeshBasicMaterial({ color: 0xa855f7 })
    );
    circlet.position.y = 1.55;
    circlet.rotation.x = Math.PI * 0.5;
    group.add(circlet);

    // Wicker herb basket
    const basketMat = new THREE.MeshStandardMaterial({ color: 0x854d0e, roughness: 0.85 });
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.25), basketMat);
    basket.position.set(0.38, 0.65, 0.15);
    group.add(basket);
  } else {
    // Eldrin the Scout
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 });
    const cloakMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.75 });

    // Tunic
    const tunic = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.35), leatherMat);
    tunic.position.y = 1.0;
    tunic.castShadow = true;
    group.add(tunic);

    // Cloak
    const cloak = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.1), cloakMat);
    cloak.position.set(0, 0.9, -0.2);
    group.add(cloak);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 8), skinMat);
    head.position.y = 1.52;
    group.add(head);

    // Traveler staff
    const staffMat = new THREE.MeshStandardMaterial({ color: 0x3f2e1a, roughness: 0.8 });
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), staffMat);
    staff.position.set(0.35, 0.9, 0.25);
    group.add(staff);
  }

  let time = Math.random() * 5.0;
  return {
    group,
    update: (dt: number) => {
      time += dt;
      group.position.y = Math.sin(time * 2.0) * 0.02;
    },
  };
}

export interface VillageObstacle {
  x: number;
  z: number;
  radius: number;
}

export interface InteractiveNpcEntity {
  id: string;
  name: string;
  title: string;
  role: 'aurelius' | 'blacksmith' | 'herbalist' | 'scout';
  position: THREE.Vector3;
  interactionRadius: number;
  meshGroup: THREE.Group;
}

export interface SolsticeHavenBundle {
  group: THREE.Group;
  obstacles: VillageObstacle[];
  interactiveNpcs: InteractiveNpcEntity[];
  update: (dt: number) => void;
}

export function createSolsticeHavenVillage(): SolsticeHavenBundle {
  const group = new THREE.Group();
  const updaters: ((dt: number) => void)[] = [];
  const obstacles: VillageObstacle[] = [];
  const interactiveNpcs: InteractiveNpcEntity[] = [];

  // 1. Central Tiered Stone Fountain
  const fountain = createTownFountain();
  fountain.group.position.set(0, 0, 0);
  group.add(fountain.group);
  updaters.push(fountain.update);
  obstacles.push({ x: 0, z: 0, radius: 2.4 });

  // 2. Four Stylized Cottages framing the village square
  const cottagePlacements = [
    { x: -14.5, z: -8.5, rot: Math.PI * 0.16, variant: 0 }, // Blacksmith forge cottage
    { x: 14.5, z: -8.5, rot: -Math.PI * 0.22, variant: 1 }, // Herbalist apothecary cottage
    { x: -14.5, z: 12.0, rot: Math.PI * 0.38, variant: 2 },  // Adventurer lodge
    { x: 14.5, z: 12.0, rot: -Math.PI * 0.34, variant: 3 },  // Valley farm cottage
  ];

  cottagePlacements.forEach((cp) => {
    const cottage = createVillageCottage(cp.variant);
    cottage.position.set(cp.x, getTerrainHeight(cp.x, cp.z), cp.z);
    cottage.rotation.y = cp.rot;
    group.add(cottage);
    // Bounding circle for collision
    obstacles.push({ x: cp.x, z: cp.z, radius: 3.2 });
  });

  // 3. Four Lantern Posts
  const lanternPositions = [
    [-6.5, -6.5],
    [6.5, -6.5],
    [-6.5, 6.5],
    [6.5, 6.5],
  ];
  lanternPositions.forEach(([lx, lz]) => {
    const post = createLanternPost();
    post.position.set(lx, getTerrainHeight(lx, lz), lz);
    group.add(post);
  });

  // 4. Four Flower Planter Boxes
  const planterPositions = [
    [-4.5, 0, Math.PI * 0.5],
    [4.5, 0, -Math.PI * 0.5],
    [0, -4.5, 0],
    [0, 4.5, Math.PI],
  ];
  planterPositions.forEach(([px, pz, rot]) => {
    const planter = createPlanterBox();
    planter.position.set(px, getTerrainHeight(px, pz), pz);
    planter.rotation.y = rot;
    group.add(planter);
  });

  // 5. Archmage's Astrolabe Gazebo (Northern terrace of the plaza)
  const gazebo = createAstrolabeGazebo();
  const gazeboPos = new THREE.Vector3(0, getTerrainHeight(0, -13.0), -13.0);
  gazebo.group.position.copy(gazeboPos);
  group.add(gazebo.group);
  updaters.push(gazebo.update);
  obstacles.push({ x: gazeboPos.x, z: gazeboPos.z, radius: 3.8 });

  // 6. Archmage Aurelius (Stationed at the Gazebo entrance)
  const archmage = createArchmageAurelius();
  const aureliusPos = new THREE.Vector3(0, gazeboPos.y + 0.48, -10.8);
  archmage.group.position.copy(aureliusPos);
  group.add(archmage.group);
  updaters.push(archmage.update);

  interactiveNpcs.push({
    id: 'aurelius',
    name: 'Archmage Aurelius',
    title: 'Guardian of the Astrolabe & Guide Wizard',
    role: 'aurelius',
    position: aureliusPos,
    interactionRadius: 4.8,
    meshGroup: archmage.group,
  });

  // 7. Townsfolk NPCs
  // Theron the Blacksmith
  const blacksmith = createTownsperson('blacksmith');
  const blacksmithPos = new THREE.Vector3(-8.5, getTerrainHeight(-8.5, -5.5), -5.5);
  blacksmith.group.position.copy(blacksmithPos);
  blacksmith.group.rotation.y = Math.PI * 0.25;
  group.add(blacksmith.group);
  updaters.push(blacksmith.update);

  interactiveNpcs.push({
    id: 'blacksmith',
    name: 'Theron the Smith',
    title: 'Weaponsmith & Ward Refiner',
    role: 'blacksmith',
    position: blacksmithPos,
    interactionRadius: 3.8,
    meshGroup: blacksmith.group,
  });

  // Lyra the Herbalist
  const herbalist = createTownsperson('herbalist');
  const herbalistPos = new THREE.Vector3(8.5, getTerrainHeight(8.5, -5.5), -5.5);
  herbalist.group.position.copy(herbalistPos);
  herbalist.group.rotation.y = -Math.PI * 0.3;
  group.add(herbalist.group);
  updaters.push(herbalist.update);

  interactiveNpcs.push({
    id: 'herbalist',
    name: 'Lyra the Herbalist',
    title: 'Flora Botanist & Potion Brewer',
    role: 'herbalist',
    position: herbalistPos,
    interactionRadius: 3.8,
    meshGroup: herbalist.group,
  });

  // Eldrin the Scout
  const scout = createTownsperson('scout');
  const scoutPos = new THREE.Vector3(5.5, getTerrainHeight(5.5, 7.5), 7.5);
  scout.group.position.copy(scoutPos);
  scout.group.rotation.y = Math.PI * 0.9;
  group.add(scout.group);
  updaters.push(scout.update);

  interactiveNpcs.push({
    id: 'scout',
    name: 'Eldrin the Scout',
    title: 'Frontier Ranger & Valley Trailhead Guide',
    role: 'scout',
    position: scoutPos,
    interactionRadius: 3.8,
    meshGroup: scout.group,
  });

  // 8. Non-Interactable Ambient Wandering Townsfolk
  interface AmbientWanderer {
    group: THREE.Group;
    waypoints: { x: number; z: number }[];
    currentWpIdx: number;
    pauseTimer: number;
    walkPhase: number;
    speed: number;
    legL: THREE.Group;
    legR: THREE.Group;
    armL: THREE.Group;
    armR: THREE.Group;
  }

  const wanderers: AmbientWanderer[] = [];

  const createWandererRig = (
    colorTunic: number,
    colorTrim: number,
    hasHat: 'guard' | 'hood' | 'circlet' | 'none',
    accessory: 'spear' | 'scroll' | 'basket' | 'satchel' | 'cane',
    initialPos: { x: number; z: number },
    waypoints: { x: number; z: number }[],
    speed: number,
  ): AmbientWanderer => {
    const wGroup = new THREE.Group();
    wGroup.position.set(initialPos.x, getTerrainHeight(initialPos.x, initialPos.z), initialPos.z);

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf2cead, roughness: 0.65 });
    const tunicMat = new THREE.MeshStandardMaterial({ color: colorTunic, roughness: 0.7 });
    const trimMat = new THREE.MeshStandardMaterial({ color: colorTrim, roughness: 0.5 });
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1b, roughness: 0.8 });

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.62, 0.32), tunicMat);
    torso.position.y = 1.05;
    torso.castShadow = true;
    wGroup.add(torso);

    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.34), leatherMat);
    belt.position.y = 0.8;
    wGroup.add(belt);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), skinMat);
    head.position.y = 1.48;
    head.castShadow = true;
    wGroup.add(head);

    // Headwear
    if (hasHat === 'guard') {
      const helm = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.32, 6), trimMat);
      helm.position.y = 1.66;
      wGroup.add(helm);
    } else if (hasHat === 'hood') {
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8, 0, Math.PI * 2, 0, Math.PI * 0.7), tunicMat);
      hood.position.y = 1.5;
      hood.rotation.x = -0.25;
      wGroup.add(hood);
    } else if (hasHat === 'circlet') {
      const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 6, 16), trimMat);
      circlet.rotation.x = Math.PI * 0.45;
      circlet.position.y = 1.54;
      wGroup.add(circlet);
    }

    // Legs
    const buildLeg = (offsetX: number) => {
      const p = new THREE.Group();
      p.position.set(offsetX, 0.75, 0);
      const legMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.7, 6), leatherMat);
      legMesh.position.y = -0.35;
      legMesh.castShadow = true;
      p.add(legMesh);
      wGroup.add(p);
      return p;
    };
    const legL = buildLeg(-0.14);
    const legR = buildLeg(0.14);

    // Arms
    const buildArm = (offsetX: number) => {
      const p = new THREE.Group();
      p.position.set(offsetX, 1.25, 0);
      const armMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.55, 6), tunicMat);
      armMesh.position.y = -0.25;
      armMesh.castShadow = true;
      p.add(armMesh);
      wGroup.add(p);
      return p;
    };
    const armL = buildArm(-0.3);
    const armR = buildArm(0.3);

    // Accessory
    if (accessory === 'spear') {
      const spearPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.1, 6), leatherMat);
      spearPole.position.set(0, -0.1, 0.2);
      spearPole.rotation.x = 0.15;
      const spearTip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 4), trimMat);
      spearTip.position.set(0, 1.05, 0.35);
      armR.add(spearPole, spearTip);
    } else if (accessory === 'scroll') {
      const scroll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.32, 6), trimMat);
      scroll.position.set(0, -0.4, 0.15);
      scroll.rotation.z = Math.PI / 2;
      armR.add(scroll);
    } else if (accessory === 'basket') {
      const basket = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.28), leatherMat);
      basket.position.set(0, -0.35, 0.12);
      armL.add(basket);
    } else if (accessory === 'satchel') {
      const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.12), leatherMat);
      satchel.position.set(0.15, 0.75, 0.18);
      wGroup.add(satchel);
    } else if (accessory === 'cane') {
      const cane = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 1.2, 6), trimMat);
      cane.position.set(0, -0.25, 0.18);
      armR.add(cane);
    }

    group.add(wGroup);

    return {
      group: wGroup,
      waypoints,
      currentWpIdx: 0,
      pauseTimer: Math.random() * 2,
      walkPhase: Math.random() * 10,
      speed,
      legL,
      legR,
      armL,
      armR,
    };
  };

  // 1. Town Guard (Patrolling the Northern Gates toward the Bridge)
  wanderers.push(
    createWandererRig(
      0x2c4a6f,
      0xc0d0e0,
      'guard',
      'spear',
      { x: -3.5, z: -10 },
      [
        { x: -3.5, z: -10 },
        { x: 3.5, z: -10 },
        { x: 3.5, z: -17 },
        { x: -3.5, z: -17 },
      ],
      1.8,
    ),
  );

  // 2. Astrolabe Apprentice (Walking between the Fountain and Northern Terrace)
  wanderers.push(
    createWandererRig(
      0x3060a8,
      0xe6c875,
      'circlet',
      'scroll',
      { x: 0, z: -4.5 },
      [
        { x: 0, z: -4.5 },
        { x: 5.5, z: -1.5 },
        { x: 0, z: 4.0 },
        { x: -5.5, z: -1.5 },
      ],
      1.6,
    ),
  );

  // 3. Herbalist Assistant (Walking along the eastern cottage garden path)
  wanderers.push(
    createWandererRig(
      0x2e6b48,
      0xf0dfa5,
      'hood',
      'basket',
      { x: 9.0, z: -1.5 },
      [
        { x: 9.0, z: -1.5 },
        { x: 12.5, z: 4.5 },
        { x: 8.5, z: 9.5 },
        { x: 5.5, z: 3.5 },
      ],
      1.5,
    ),
  );

  // 4. Village Courier (Walking an energetic loop connecting town pathways)
  wanderers.push(
    createWandererRig(
      0x8a4520,
      0xdfb065,
      'none',
      'satchel',
      { x: -10.5, z: 6.5 },
      [
        { x: -10.5, z: 6.5 },
        { x: -2.5, z: 11.0 },
        { x: 8.5, z: 10.5 },
        { x: 10.5, z: 4.5 },
      ],
      2.2,
    ),
  );

  // 5. Elder Scholar (Strolling thoughtfully near the western forge and stone garden)
  wanderers.push(
    createWandererRig(
      0x40255a,
      0xd4b870,
      'circlet',
      'cane',
      { x: -5.5, z: 2.0 },
      [
        { x: -5.5, z: 2.0 },
        { x: -11.5, z: -1.5 },
        { x: -11.0, z: -7.5 },
        { x: -5.5, z: -4.5 },
      ],
      1.3,
    ),
  );

  updaters.push((dt: number) => {
    for (const w of wanderers) {
      if (w.pauseTimer > 0) {
        w.pauseTimer -= dt;
        w.legL.rotation.x *= 0.85;
        w.legR.rotation.x *= 0.85;
        w.armL.rotation.x = Math.sin(w.walkPhase) * 0.05;
        w.armR.rotation.x = -Math.sin(w.walkPhase) * 0.05;
        continue;
      }

      const target = w.waypoints[w.currentWpIdx];
      const dx = target.x - w.group.position.x;
      const dz = target.z - w.group.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.4) {
        w.pauseTimer = 2.2 + Math.random() * 2.5;
        w.currentWpIdx = (w.currentWpIdx + 1) % w.waypoints.length;
        continue;
      }

      const targetYaw = Math.atan2(dx, dz);
      let diff = targetYaw - w.group.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      w.group.rotation.y += diff * Math.min(1, dt * 5.5);

      const step = Math.min(dist, w.speed * dt);
      w.group.position.x += (dx / dist) * step;
      w.group.position.z += (dz / dist) * step;
      w.group.position.y = getTerrainHeight(w.group.position.x, w.group.position.z);

      w.walkPhase += dt * (w.speed * 4.2);
      const stride = Math.sin(w.walkPhase) * 0.45;
      w.legL.rotation.x = stride;
      w.legR.rotation.x = -stride;
      w.armL.rotation.x = -stride * 0.75;
      w.armR.rotation.x = stride * 0.75;
      w.group.position.y += Math.abs(Math.sin(w.walkPhase)) * 0.03;
    }
  });

  return {
    group,
    obstacles,
    interactiveNpcs,
    update: (dt: number) => {
      for (const u of updaters) {
        u(dt);
      }
    },
  };
}
