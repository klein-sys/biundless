import * as THREE from 'three';
import type { BossId } from '../bosses/bossDefinitions';
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
  createWaterStreamMaterial,
} from './Shaders';
import { alignSegmentDown, mergeStaticMeshes, solveTwoBoneArm } from './SculptKit';

export { createBossModel, type BossAnimContext, type BossRig } from './BossModels';

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

// --- Lyra the Herbalist (Model 2) ---------------------------------------------------------

const LYRA_UP = new THREE.Vector3(0, 1, 0);
const LYRA_NO_ROTATION = new THREE.Quaternion();
const _lyraInstPos = new THREE.Vector3();
const _lyraInstScale = new THREE.Vector3();
const _lyraInstMatrix = new THREE.Matrix4();

function setInstance(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, s: number): void {
  _lyraInstPos.set(x, y, z);
  _lyraInstScale.setScalar(s);
  mesh.setMatrixAt(i, _lyraInstMatrix.compose(_lyraInstPos, LYRA_NO_ROTATION, _lyraInstScale));
}

export function createLyraHerbalist(): { group: THREE.Group; update: (dt: number) => void } {
  const group = new THREE.Group();

  const add = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
    castShadow = false
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    parent.add(mesh);
    return mesh;
  };

  // --- Botanical Palette Materials ---
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf3cba8, roughness: 0.7 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0xb4532a, roughness: 0.8 });
  const browMat = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.8 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1f3d2b, roughness: 0.3 });
  const eyeShineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const blushMat = new THREE.MeshStandardMaterial({ color: 0xf2a39b, roughness: 0.9 });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xb4534b, roughness: 0.7 });
  const dressMat = new THREE.MeshStandardMaterial({
    color: 0x3f6b46,
    roughness: 0.78,
    side: THREE.DoubleSide,
  });
  const blouseMat = new THREE.MeshStandardMaterial({ color: 0xf4ead5, roughness: 0.85 });
  const bodiceMat = new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.65 });
  const laceMat = new THREE.MeshStandardMaterial({ color: 0xe8d3a8, roughness: 0.8 });
  const apronMat = new THREE.MeshStandardMaterial({
    color: 0xfaf3df,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  const shawlMat = new THREE.MeshStandardMaterial({
    color: 0x9bb37f,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const sashMat = new THREE.MeshStandardMaterial({ color: 0x7c3a6b, roughness: 0.7 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.6 });
  const goldTrimMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.75, roughness: 0.3 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.8 });
  const sageLeafMat = new THREE.MeshStandardMaterial({ color: 0x84a46a, roughness: 0.85 });
  const blossomMats = [
    new THREE.MeshStandardMaterial({ color: 0xa78bfa, roughness: 0.6 }), // lavender
    new THREE.MeshStandardMaterial({ color: 0xfffbeb, roughness: 0.6 }), // cream
    new THREE.MeshStandardMaterial({ color: 0xf9a8d4, roughness: 0.6 }), // pink
    new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.6 }), // gold
  ];
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5d3b, roughness: 0.85 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x4e3421, roughness: 0.9 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.85 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x27272a, metalness: 0.8, roughness: 0.4 });
  const copperMat = new THREE.MeshStandardMaterial({
    color: 0xb8733a,
    metalness: 0.75,
    roughness: 0.3,
    side: THREE.DoubleSide,
  });
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1.0 });
  const pageMat = new THREE.MeshStandardMaterial({ color: 0xf5ecd6, roughness: 0.9 });
  const mashMat = new THREE.MeshStandardMaterial({
    color: 0x65a30d,
    emissive: 0x84cc16,
    emissiveIntensity: 0.15,
    roughness: 0.9,
  });
  const brewMat = new THREE.MeshStandardMaterial({
    color: 0x34d399,
    emissive: 0x10b981,
    emissiveIntensity: 0.6,
    roughness: 0.2,
  });
  const coalMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a });
  const potionMats = [0xdc2626, 0x38bdf8, 0xf59e0b].map(
    (color, i) =>
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: i === 0 ? 0.45 : 0.3,
        transparent: true,
        opacity: 0.9,
        roughness: 0.15,
      })
  );
  const corkMat = new THREE.MeshStandardMaterial({ color: 0xc19a6b, roughness: 0.9 });

  // --- 1. Lyra Character Rig ---
  const charGroup = new THREE.Group();
  charGroup.name = 'lyra_body';
  group.add(charGroup);

  // Boots peeking from beneath the hem
  const bootGeo = new THREE.BoxGeometry(0.13, 0.1, 0.22);
  add(charGroup, bootGeo, bootMat, -0.1, 0.05, 0.1, true);
  add(charGroup, bootGeo, bootMat, 0.1, 0.05, 0.1, true);

  // Flared bell skirt (lathed profile, hem → waist)
  const skirtProfile = [
    new THREE.Vector2(0.44, 0.03),
    new THREE.Vector2(0.45, 0.06),
    new THREE.Vector2(0.41, 0.18),
    new THREE.Vector2(0.33, 0.42),
    new THREE.Vector2(0.26, 0.66),
    new THREE.Vector2(0.215, 0.86),
    new THREE.Vector2(0.2, 0.96),
  ];
  add(charGroup, new THREE.LatheGeometry(skirtProfile, 14), dressMat, 0, 0, 0, true);

  const hemTrim = add(charGroup, new THREE.TorusGeometry(0.447, 0.018, 4, 18), goldTrimMat, 0, 0.07, 0);
  hemTrim.rotation.x = Math.PI * 0.5;

  // Curved linen apron following the skirt cone
  add(
    charGroup,
    new THREE.CylinderGeometry(0.222, 0.418, 0.7, 8, 1, true, -0.75, 1.5),
    apronMat,
    0,
    0.55,
    0
  );
  const apronSlope = Math.atan(0.196 / 0.7);
  const pocket = add(charGroup, new THREE.BoxGeometry(0.18, 0.13, 0.015), apronMat, 0, 0.5, 0.342);
  pocket.rotation.x = apronSlope;
  const pocketLeafGeo = new THREE.SphereGeometry(0.03, 6, 4);
  const pocketLeafA = add(charGroup, pocketLeafGeo, leafMat, -0.02, 0.515, 0.352);
  pocketLeafA.scale.set(1.3, 0.55, 0.25);
  pocketLeafA.rotation.set(apronSlope, 0, 0.5);
  const pocketLeafB = add(charGroup, pocketLeafGeo, sageLeafMat, 0.025, 0.505, 0.352);
  pocketLeafB.scale.set(1.3, 0.55, 0.25);
  pocketLeafB.rotation.set(apronSlope, 0, -0.5);

  // Plum waist sash with a bow at the back
  const sash = add(charGroup, new THREE.TorusGeometry(0.205, 0.03, 5, 14), sashMat, 0, 0.95, 0);
  sash.rotation.x = Math.PI * 0.5;
  const bowGeo = new THREE.SphereGeometry(0.05, 6, 4);
  const bowL = add(charGroup, bowGeo, sashMat, -0.05, 0.95, -0.22);
  bowL.scale.set(1.2, 0.7, 0.4);
  bowL.rotation.z = 0.4;
  const bowR = add(charGroup, bowGeo, sashMat, 0.05, 0.95, -0.22);
  bowR.scale.set(1.2, 0.7, 0.4);
  bowR.rotation.z = -0.4;
  const bowTail = add(charGroup, new THREE.BoxGeometry(0.035, 0.18, 0.01), sashMat, 0.015, 0.84, -0.225);
  bowTail.rotation.z = 0.15;

  // Leather hip pouch with gold clasp
  const pouch = add(charGroup, new THREE.BoxGeometry(0.1, 0.12, 0.06), bodiceMat, 0.225, 0.85, 0.05, true);
  pouch.rotation.y = Math.PI * 0.45;
  add(charGroup, new THREE.SphereGeometry(0.014, 5, 4), goldTrimMat, 0.257, 0.875, 0.06);

  // Upper body pivots at the waist so breathing and leaning carry the shoulders, head and braid.
  const upperBody = new THREE.Group();
  upperBody.position.set(0, 0.95, 0);
  charGroup.add(upperBody);

  // Laced corset bodice
  add(upperBody, new THREE.CylinderGeometry(0.185, 0.2, 0.24, 10), bodiceMat, 0, 0.12, 0, true);
  const laceGeo = new THREE.BoxGeometry(0.075, 0.008, 0.006);
  for (let l = 0; l < 3; l++) {
    const ly = 0.05 + l * 0.055;
    add(upperBody, laceGeo, laceMat, 0, ly, 0.193).rotation.z = 0.6;
    add(upperBody, laceGeo, laceMat, 0, ly, 0.193).rotation.z = -0.6;
  }

  // Linen blouse chest
  add(upperBody, new THREE.CylinderGeometry(0.16, 0.19, 0.22, 10), blouseMat, 0, 0.35, 0, true);

  // Draped sage shawl capelet with gold brooch
  add(upperBody, new THREE.CylinderGeometry(0.13, 0.235, 0.22, 12, 1, true), shawlMat, 0, 0.43, 0, true);
  add(upperBody, new THREE.SphereGeometry(0.022, 6, 5), goldTrimMat, 0, 0.41, 0.2);
  const broochLeaf = add(upperBody, pocketLeafGeo, leafMat, 0.025, 0.395, 0.2);
  broochLeaf.scale.set(1.0, 0.45, 0.3);
  broochLeaf.rotation.z = -0.6;

  // Puffed sleeve caps (shoulders)
  const shoulderLocalR = new THREE.Vector3(0.2, 0.41, 0.03);
  const shoulderLocalL = new THREE.Vector3(-0.2, 0.41, 0.03);
  const puffGeo = new THREE.SphereGeometry(0.075, 8, 6);
  add(upperBody, puffGeo, blouseMat, shoulderLocalR.x, shoulderLocalR.y, shoulderLocalR.z, true);
  add(upperBody, puffGeo, blouseMat, shoulderLocalL.x, shoulderLocalL.y, shoulderLocalL.z, true);

  // Neck
  add(upperBody, new THREE.CylinderGeometry(0.055, 0.06, 0.12, 8), skinMat, 0, 0.52, 0);

  // Head
  const headGroup = new THREE.Group();
  headGroup.name = 'lyra_head';
  headGroup.position.set(0, 0.65, 0.01);
  upperBody.add(headGroup);

  const headMesh = add(headGroup, new THREE.SphereGeometry(0.155, 12, 10), skinMat, 0, 0, 0, true);
  headMesh.scale.set(1, 1.06, 1);

  // Face: eyes with highlights, brows, blush, nose, mouth
  const eyeGeo = new THREE.SphereGeometry(0.025, 8, 6);
  const shineGeo = new THREE.SphereGeometry(0.008, 4, 3);
  const browGeo = new THREE.BoxGeometry(0.05, 0.008, 0.01);
  const blushGeo = new THREE.SphereGeometry(0.022, 6, 4);
  for (const side of [-1, 1]) {
    add(headGroup, eyeGeo, eyeMat, side * 0.055, 0, 0.138).scale.set(1, 1.2, 0.5);
    add(headGroup, shineGeo, eyeShineMat, side * 0.05, 0.012, 0.152);
    add(headGroup, browGeo, browMat, side * 0.056, 0.048, 0.142).rotation.z = side * -0.15;
    add(headGroup, blushGeo, blushMat, side * 0.085, -0.042, 0.122).scale.set(1.3, 0.7, 0.4);
  }
  add(headGroup, new THREE.SphereGeometry(0.012, 5, 4), skinMat, 0, -0.025, 0.155);
  add(headGroup, new THREE.BoxGeometry(0.03, 0.006, 0.01), lipMat, 0, -0.072, 0.145);

  // Hair: crown cap tilted back to frame the face, bangs, side locks and back volume
  const hairCap = add(
    headGroup,
    new THREE.SphereGeometry(0.168, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
    hairMat,
    0,
    0.01,
    -0.012,
    true
  );
  hairCap.rotation.x = -0.35;
  const bangGeo = new THREE.SphereGeometry(0.05, 7, 5);
  const bangs: [number, number, number, number][] = [
    [-0.065, 0.078, 0.128, 0.35],
    [0, 0.09, 0.138, 0],
    [0.065, 0.074, 0.128, -0.35],
  ];
  bangs.forEach(([bx, by, bz, rz]) => {
    const bang = add(headGroup, bangGeo, hairMat, bx, by, bz);
    bang.scale.set(1.1, 0.55, 0.5);
    bang.rotation.z = rz;
  });
  const lockGeo = new THREE.SphereGeometry(0.04, 6, 5);
  for (const side of [-1, 1]) {
    add(headGroup, lockGeo, hairMat, side * 0.135, -0.05, 0.055).scale.set(0.6, 1.8, 0.7);
  }
  add(headGroup, new THREE.SphereGeometry(0.15, 10, 7), hairMat, 0, -0.03, -0.06).scale.set(1.05, 1.1, 0.85);

  // Woven flower crown (follows the hair tilt)
  const crown = new THREE.Group();
  crown.position.set(0, 0.07, -0.01);
  crown.rotation.x = -0.35;
  headGroup.add(crown);
  add(crown, new THREE.TorusGeometry(0.158, 0.012, 4, 18), leafMat).rotation.x = Math.PI * 0.5;
  const blossomGeo = new THREE.IcosahedronGeometry(0.028, 0);
  const crownLeafGeo = new THREE.SphereGeometry(0.026, 5, 3);
  const BLOSSOMS = 9;
  for (let b = 0; b < BLOSSOMS; b++) {
    const a = (b / BLOSSOMS) * Math.PI * 2;
    add(crown, blossomGeo, blossomMats[b % blossomMats.length], Math.sin(a) * 0.158, 0.012, Math.cos(a) * 0.158);
    if (b % 3 !== 2) {
      const la = a + Math.PI / BLOSSOMS;
      const leaf = add(crown, crownLeafGeo, b % 2 ? sageLeafMat : leafMat, Math.sin(la) * 0.165, 0, Math.cos(la) * 0.165);
      leaf.scale.set(1.4, 0.35, 0.7);
      leaf.rotation.y = la;
    }
  }

  // Long copper braid draped over the left shoulder (pivots at the nape for sway).
  // Overlapping, alternately tilted links read as a woven plait.
  const BRAID_PIVOT = new THREE.Vector3(-0.1, 0.61, -0.06);
  const braidGroup = new THREE.Group();
  braidGroup.position.copy(BRAID_PIVOT);
  upperBody.add(braidGroup);
  const braidLinks: [number, number, number, number][] = [
    [-0.1, 0.61, -0.06, 0.045],
    [-0.15, 0.55, 0.03, 0.045],
    [-0.18, 0.48, 0.11, 0.043],
    [-0.19, 0.41, 0.17, 0.042],
    [-0.175, 0.34, 0.205, 0.04],
    [-0.155, 0.27, 0.205, 0.038],
    [-0.145, 0.2, 0.2, 0.036],
    [-0.14, 0.13, 0.198, 0.034],
    [-0.135, 0.07, 0.196, 0.032],
  ];
  const toBraid = (x: number, y: number, z: number): [number, number, number] => [
    x - BRAID_PIVOT.x,
    y - BRAID_PIVOT.y,
    z - BRAID_PIVOT.z,
  ];
  braidLinks.forEach(([x, y, z, r], i) => {
    const link = add(braidGroup, new THREE.SphereGeometry(r, 7, 5), hairMat, ...toBraid(x, y, z));
    link.scale.set(1, 1.35, 0.9);
    link.rotation.z = i % 2 ? 0.35 : -0.35;
  });
  add(braidGroup, new THREE.TorusGeometry(0.03, 0.01, 4, 10), sashMat, ...toBraid(-0.135, 0.03, 0.196)).rotation.x =
    Math.PI * 0.5;
  add(braidGroup, new THREE.ConeGeometry(0.035, 0.08, 6), hairMat, ...toBraid(-0.135, -0.02, 0.196));

  // Arms: two-bone segments solved each frame in charGroup space
  const UPPER_LEN = 0.29;
  const FORE_LEN = 0.27;
  const upperArmGeo = new THREE.CylinderGeometry(0.05, 0.042, UPPER_LEN, 8);
  const foreArmGeo = new THREE.CylinderGeometry(0.038, 0.032, FORE_LEN, 8);
  const cuffGeo = new THREE.TorusGeometry(0.042, 0.014, 4, 10);
  const handGeo = new THREE.SphereGeometry(0.04, 8, 6);
  const buildArm = (name: string) => {
    const arm = new THREE.Group();
    arm.name = name;
    charGroup.add(arm);
    const upper = new THREE.Group();
    arm.add(upper);
    add(upper, upperArmGeo, blouseMat, 0, -UPPER_LEN / 2, 0, true);
    const fore = new THREE.Group();
    arm.add(fore);
    add(fore, cuffGeo, blouseMat, 0, -0.012, 0).rotation.x = Math.PI * 0.5;
    add(fore, foreArmGeo, skinMat, 0, -FORE_LEN / 2, 0, true);
    const hand = add(arm, handGeo, skinMat);
    hand.scale.set(0.9, 1.1, 0.8);
    return { upper, fore, hand };
  };
  const armR = buildArm('lyra_pestle_arm');
  const armL = buildArm('lyra_steady_arm');
  const poleR = new THREE.Vector3(1, -0.3, -0.5).normalize();
  const poleL = new THREE.Vector3(-1, -0.3, -0.5).normalize();

  // --- 2. Apothecary Workbench ---
  const TABLE_TOP = 0.9;
  const workbench = new THREE.Group();
  workbench.name = 'lyra_workbench';
  group.add(workbench);

  const tableTop = add(workbench, new THREE.BoxGeometry(1.1, 0.05, 0.44), woodMat, 0, TABLE_TOP - 0.025, 0.52, true);
  tableTop.receiveShadow = true;
  const legGeo = new THREE.BoxGeometry(0.05, TABLE_TOP - 0.05, 0.05);
  for (const lx of [-0.5, 0.5]) {
    for (const lz of [0.34, 0.7]) {
      add(workbench, legGeo, darkWoodMat, lx, (TABLE_TOP - 0.05) / 2, lz, true);
    }
  }
  add(workbench, new THREE.BoxGeometry(1.0, 0.03, 0.36), darkWoodMat, 0, 0.25, 0.52);

  // Shelf jars
  const jarGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8);
  const jarLidGeo = new THREE.CylinderGeometry(0.054, 0.054, 0.02, 8);
  [-0.3, -0.15, 0.25].forEach((jx, j) => {
    add(workbench, jarGeo, potionMats[(j + 1) % potionMats.length], jx, 0.325, 0.52);
    add(workbench, jarLidGeo, corkMat, jx, 0.395, 0.52);
  });

  // Front plaque: leaf emblem marks the apothecary
  add(workbench, new THREE.BoxGeometry(0.34, 0.15, 0.02), darkWoodMat, 0, TABLE_TOP - 0.13, 0.75);
  add(workbench, new THREE.TorusGeometry(0.055, 0.008, 4, 14), goldTrimMat, 0, TABLE_TOP - 0.13, 0.762);
  const plaqueLeaf = add(workbench, pocketLeafGeo, leafMat, 0, TABLE_TOP - 0.13, 0.762);
  plaqueLeaf.scale.set(0.75, 1.45, 0.25);
  plaqueLeaf.rotation.z = -0.5;

  // Stone mortar filled with glowing herb mash
  const mortarCenter = new THREE.Vector3(0.03, TABLE_TOP, 0.38);
  const mortar = new THREE.Group();
  mortar.name = 'lyra_mortar';
  mortar.position.copy(mortarCenter);
  workbench.add(mortar);
  const mortarProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.055, 0.0),
    new THREE.Vector2(0.075, 0.025),
    new THREE.Vector2(0.082, 0.06),
    new THREE.Vector2(0.078, 0.095),
  ];
  add(mortar, new THREE.LatheGeometry(mortarProfile, 10), stoneMat, 0, 0, 0, true);
  add(mortar, new THREE.TorusGeometry(0.074, 0.01, 4, 12), stoneMat, 0, 0.095, 0).rotation.x = Math.PI * 0.5;
  add(mortar, new THREE.CylinderGeometry(0.068, 0.06, 0.02, 10), mashMat, 0, 0.075, 0);

  // Pestle (aligned from its tip in the bowl toward Lyra's grinding hand)
  const PESTLE_LEN = 0.19;
  const pestle = new THREE.Group();
  pestle.name = 'lyra_pestle';
  group.add(pestle);
  add(pestle, new THREE.CylinderGeometry(0.012, 0.022, PESTLE_LEN, 8), stoneMat, 0, PESTLE_LEN / 2, 0, true);

  // Potion bottles (crimson ties back to the Crimson Flask heal)
  const bottleBodyGeo = new THREE.SphereGeometry(0.048, 7, 5);
  const bottleNeckGeo = new THREE.CylinderGeometry(0.016, 0.02, 0.06, 6);
  const corkGeo = new THREE.CylinderGeometry(0.018, 0.015, 0.025, 6);
  const bottles: [number, number, number][] = [
    [0.3, 0.45, 1.0],
    [0.41, 0.6, 0.85],
    [0.24, 0.63, 0.75],
  ];
  bottles.forEach(([bx, bz, s], i) => {
    add(workbench, bottleBodyGeo, potionMats[i], bx, TABLE_TOP + 0.045 * s, bz).scale.setScalar(s);
    add(workbench, bottleNeckGeo, potionMats[i], bx, TABLE_TOP + 0.11 * s, bz).scale.setScalar(s);
    add(workbench, corkGeo, corkMat, bx, TABLE_TOP + 0.15 * s, bz).scale.setScalar(s);
  });

  // Open herbal grimoire
  const book = new THREE.Group();
  book.position.set(-0.3, TABLE_TOP, 0.56);
  book.rotation.y = 0.35;
  workbench.add(book);
  add(book, new THREE.BoxGeometry(0.3, 0.015, 0.2), sashMat, 0, 0.008, 0);
  for (const side of [-1, 1]) {
    add(book, new THREE.BoxGeometry(0.135, 0.012, 0.18), pageMat, side * 0.072, 0.022, 0).rotation.z = side * -0.08;
  }
  add(book, pocketLeafGeo, sageLeafMat, 0.07, 0.032, 0).scale.set(1.4, 0.15, 0.7);

  // Fresh herb bundle lying on the bench
  const herbBundle = new THREE.Group();
  herbBundle.position.set(0.05, TABLE_TOP + 0.02, 0.63);
  herbBundle.rotation.y = -0.4;
  workbench.add(herbBundle);
  const stemGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.26, 4);
  const herbLeafGeo = new THREE.SphereGeometry(0.03, 5, 3);
  for (let h = 0; h < 3; h++) {
    add(herbBundle, stemGeo, leafMat, 0, 0, (h - 1) * 0.018).rotation.z = Math.PI * 0.5 + (h - 1) * 0.12;
    add(herbBundle, herbLeafGeo, h === 1 ? sageLeafMat : leafMat, 0.1, 0.005, (h - 1) * 0.03).scale.set(1.5, 0.4, 0.9);
  }
  add(herbBundle, new THREE.TorusGeometry(0.022, 0.006, 4, 8), laceMat, -0.05, 0, 0).rotation.y = Math.PI * 0.5;

  // --- 3. Copper Cauldron over a Coal Brazier ---
  const cauldron = new THREE.Group();
  cauldron.name = 'lyra_cauldron';
  cauldron.position.set(-1.0, 0, 0.2);
  group.add(cauldron);

  add(cauldron, new THREE.TorusGeometry(0.22, 0.05, 4, 10), stoneMat, 0, 0.04, 0).rotation.x = Math.PI * 0.5;
  const coalGeo = new THREE.IcosahedronGeometry(0.055, 0);
  for (let c = 0; c < 5; c++) {
    const a = (c / 5) * Math.PI * 2;
    add(cauldron, coalGeo, coalMat, Math.cos(a) * 0.1, 0.07, Math.sin(a) * 0.1);
  }
  // Legs stop under the bowl's widest point so they never poke through the brew.
  const tripodLegGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.56, 5);
  for (let t = 0; t < 3; t++) {
    const a = (t / 3) * Math.PI * 2 + 0.3;
    const leg = add(cauldron, tripodLegGeo, ironMat, Math.cos(a) * 0.31, 0.28, Math.sin(a) * 0.31, true);
    leg.rotation.set(Math.sin(a) * -0.18, 0, Math.cos(a) * 0.18);
  }
  add(
    cauldron,
    new THREE.SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55),
    copperMat,
    0,
    0.62,
    0,
    true
  );
  add(cauldron, new THREE.TorusGeometry(0.296, 0.025, 5, 16), copperMat, 0, 0.667, 0).rotation.x = Math.PI * 0.5;
  const BREW_Y = 0.65;
  add(cauldron, new THREE.CylinderGeometry(0.285, 0.285, 0.02, 14), brewMat, 0, BREW_Y, 0);
  add(cauldron, new THREE.CylinderGeometry(0.014, 0.014, 0.55, 5), woodMat, 0.12, 0.82, 0.04).rotation.z = 0.5;

  // --- 4. Herb Drying Rack (behind Lyra) ---
  const rack = new THREE.Group();
  rack.name = 'lyra_drying_rack';
  rack.position.set(0, 0, -0.55);
  group.add(rack);
  const postGeo = new THREE.BoxGeometry(0.07, 1.9, 0.07);
  add(rack, postGeo, darkWoodMat, -0.72, 0.95, 0, true);
  add(rack, postGeo, darkWoodMat, 0.72, 0.95, 0, true);
  add(rack, new THREE.BoxGeometry(1.6, 0.06, 0.06), darkWoodMat, 0, 1.87, 0, true);

  const bundleMats = [sageLeafMat, blossomMats[0], leafMat, blossomMats[3], sageLeafMat];
  const stringGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.15, 3);
  const bundleGeo = new THREE.ConeGeometry(0.07, 0.3, 6);
  const tieGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.02, 6);
  const dryingBundles: THREE.Group[] = [];
  for (let b = 0; b < 5; b++) {
    const pivot = new THREE.Group();
    pivot.position.set(-0.5 + b * 0.25, 1.84, 0);
    rack.add(pivot);
    add(pivot, stringGeo, laceMat, 0, -0.075, 0);
    add(pivot, tieGeo, laceMat, 0, -0.16, 0);
    const len = 1 - (b % 2) * 0.2;
    add(pivot, bundleGeo, bundleMats[b], 0, -0.31, 0, true).scale.set(1, len, 1);
    // Loose leaves around the flared end break up the cone silhouette
    for (let l = 0; l < 3; l++) {
      const la = (l / 3) * Math.PI * 2 + b;
      const leaf = add(pivot, herbLeafGeo, bundleMats[b], Math.cos(la) * 0.06, -0.17 - 0.27 * len, Math.sin(la) * 0.06);
      leaf.scale.set(1.2, 2.0, 0.6);
      leaf.rotation.set(0, -la, Math.cos(la) * 0.5);
    }
    dryingBundles.push(pivot);
  }

  // --- 5. Flower Crate (Lyra's right) ---
  const crate = new THREE.Group();
  crate.position.set(0.95, 0, 0.12);
  crate.rotation.y = -0.25;
  group.add(crate);
  add(crate, new THREE.BoxGeometry(0.5, 0.3, 0.4), woodMat, 0, 0.15, 0, true);
  add(crate, new THREE.BoxGeometry(0.46, 0.02, 0.36), soilMat, 0, 0.29, 0);
  const crateStemGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.18, 3);
  const crateBlossomGeo = new THREE.OctahedronGeometry(0.038, 0);
  for (let f = 0; f < 7; f++) {
    const fx = -0.17 + (f % 4) * 0.11 + (f > 3 ? 0.05 : 0);
    const fz = f > 3 ? 0.08 : -0.07;
    const fh = 0.38 + seededRand(f * 3.7) * 0.08;
    add(crate, crateStemGeo, leafMat, fx, fh - 0.09, fz);
    add(crate, crateBlossomGeo, blossomMats[f % blossomMats.length], fx, fh, fz);
    const leaf = add(crate, herbLeafGeo, leafMat, fx + 0.025, fh - 0.08, fz);
    leaf.scale.set(1.2, 0.35, 0.7);
    leaf.rotation.z = 0.4;
  }

  // --- 6. Pooled Ambient VFX (instanced, closed-form motion; no per-frame allocation) ---
  const bubbleMat = new THREE.MeshStandardMaterial({
    color: 0x6ee7b7,
    emissive: 0x34d399,
    emissiveIntensity: 0.8,
    roughness: 0.2,
  });
  const steamMat = new THREE.MeshBasicMaterial({
    color: 0xf0fdf4,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  const moteMat = new THREE.MeshBasicMaterial({ color: 0xfde68a });
  const vfxGroup = new THREE.Group();
  vfxGroup.name = 'lyra_vfx';
  group.add(vfxGroup);
  const addPool = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
    const inst = new THREE.InstancedMesh(geo, mat, count);
    // Instances move every frame, so the cached bounding sphere would go stale.
    inst.frustumCulled = false;
    vfxGroup.add(inst);
    return inst;
  };

  const bubbleCount = 6;
  const bubbleInst = addPool(new THREE.SphereGeometry(0.03, 6, 4), bubbleMat, bubbleCount);
  const bubbles = Array.from({ length: bubbleCount }, (_, i) => {
    const a = seededRand(i * 5.1) * Math.PI * 2;
    const r = 0.04 + seededRand(i * 9.3) * 0.18;
    return {
      ox: cauldron.position.x + Math.cos(a) * r,
      oz: cauldron.position.z + Math.sin(a) * r,
      life: 1.1 + (i % 3) * 0.35,
      phase: i * 0.43,
    };
  });

  const steamCount = 5;
  const steamInst = addPool(new THREE.IcosahedronGeometry(0.08, 0), steamMat, steamCount);
  const steam = Array.from({ length: steamCount }, (_, i) => ({
    life: 2.6 + (i % 2) * 0.7,
    phase: i * 0.61,
  }));

  const moteCount = 10;
  const moteInst = addPool(new THREE.OctahedronGeometry(0.018, 0), moteMat, moteCount);
  const crateOrigin = new THREE.Vector3(crate.position.x, 0.45, crate.position.z);
  const mortarOrigin = new THREE.Vector3(mortarCenter.x, TABLE_TOP + 0.1, mortarCenter.z);
  const motes = Array.from({ length: moteCount }, (_, i) => ({
    origin: i % 3 === 0 ? mortarOrigin : crateOrigin,
    ox: (seededRand(i * 2.3) - 0.5) * 0.3,
    oz: (seededRand(i * 4.7) - 0.5) * 0.25,
    life: 3.2 + (i % 3) * 0.6,
    phase: i * 0.77,
  }));

  // --- 7. Procedural Grinding & Idle Animation ---
  const GRIND_PERIOD = 1.6; // seconds per pestle revolution
  const GLANCE_PERIOD = 10.0;
  const shoulder = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const handPos = new THREE.Vector3();
  const handTarget = new THREE.Vector3();
  const pestleTip = new THREE.Vector3();
  const pestleDir = new THREE.Vector3();

  const poseArm = (
    arm: { upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D },
    shoulderLocal: THREE.Vector3,
    pole: THREE.Vector3
  ) => {
    shoulder.copy(shoulderLocal).applyMatrix4(upperBody.matrix);
    solveTwoBoneArm(shoulder, handTarget, UPPER_LEN, FORE_LEN, pole, elbow, handPos);
    alignSegmentDown(arm.upper, shoulder, elbow);
    alignSegmentDown(arm.fore, elbow, handPos);
    arm.hand.position.copy(handPos);
  };

  let time = 0;

  const pose = () => {
    // Breathing + slight forward lean over the bench
    const breath = Math.sin(time * 1.8);
    upperBody.position.y = 0.95 + breath * 0.008;
    upperBody.rotation.x = 0.07 + breath * 0.01;
    upperBody.updateMatrix();

    // Head looks down at the mortar, glancing up toward the plaza once per cycle
    const g = time % GLANCE_PERIOD;
    const glance = g > 6.5 && g < 8.5 ? Math.sin(((g - 6.5) / 2.0) * Math.PI) : 0;
    headGroup.rotation.x = 0.38 - glance * 0.45 + Math.sin(time * 1.2) * 0.02;
    headGroup.rotation.y = glance * 0.12;
    headGroup.rotation.z = glance * 0.06;

    braidGroup.rotation.z = Math.sin(time * 1.3) * 0.025;
    braidGroup.rotation.x = Math.sin(time * 1.8 + 0.5) * 0.02;

    // Pestle traces a circle inside the mortar; the right hand grips its upper shaft
    const a = (time / GRIND_PERIOD) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    pestleTip.set(mortarCenter.x + ca * 0.022, mortarCenter.y + 0.075, mortarCenter.z + sa * 0.022);
    handTarget.set(
      mortarCenter.x + ca * 0.05,
      mortarCenter.y + 0.19 + Math.sin(a * 2) * 0.008,
      mortarCenter.z + sa * 0.05
    );
    pestle.position.copy(pestleTip);
    pestleDir.subVectors(handTarget, pestleTip).normalize();
    pestle.quaternion.setFromUnitVectors(LYRA_UP, pestleDir);
    poseArm(armR, shoulderLocalR, poleR);

    // Left hand steadies the mortar rim
    handTarget.set(mortarCenter.x - 0.105, mortarCenter.y + 0.065 + sa * 0.004, mortarCenter.z - 0.005);
    poseArm(armL, shoulderLocalL, poleL);

    // Glow accents: mash pulses once per revolution, brew breathes, coals flicker
    mashMat.emissiveIntensity = 0.15 + Math.pow(Math.max(0, sa), 8) * 0.6;
    brewMat.emissiveIntensity = 0.55 + Math.sin(time * 2.2) * 0.15;
    coalMat.color.setRGB(1, 0.38 + Math.sin(time * 7.3) * 0.06 + Math.sin(time * 3.1) * 0.04, 0.1);

    dryingBundles.forEach((pivot, i) => {
      pivot.rotation.z = Math.sin(time * 0.9 + i * 1.3) * 0.05;
      pivot.rotation.x = Math.sin(time * 0.7 + i) * 0.03;
    });

    bubbles.forEach((b, i) => {
      const u = ((time + b.phase) % b.life) / b.life;
      setInstance(bubbleInst, i, b.ox, BREW_Y + 0.01 + u * 0.05, b.oz, u < 0.9 ? 0.3 + u * 0.9 : 0.001);
    });
    bubbleInst.instanceMatrix.needsUpdate = true;

    steam.forEach((s, i) => {
      const u = ((time + s.phase) % s.life) / s.life;
      setInstance(
        steamInst,
        i,
        cauldron.position.x + Math.sin(time * 0.6 + i * 1.7) * 0.08 * u,
        BREW_Y + 0.05 + u * 0.9,
        cauldron.position.z + Math.cos(time * 0.5 + i) * 0.06 * u,
        Math.max(0.001, (0.4 + u * 1.4) * Math.sin(Math.PI * u))
      );
    });
    steamInst.instanceMatrix.needsUpdate = true;

    motes.forEach((m, i) => {
      const u = ((time + m.phase) % m.life) / m.life;
      setInstance(
        moteInst,
        i,
        m.origin.x + m.ox + Math.sin(time * 0.8 + i * 2.1) * 0.15 * u,
        m.origin.y + u * 1.2,
        m.origin.z + m.oz + Math.cos(time * 0.7 + i * 1.7) * 0.15 * u,
        Math.max(0.001, Math.sin(Math.PI * u))
      );
    });
    moteInst.instanceMatrix.needsUpdate = true;
  };

  // Bake static parts per material (animated subtrees stay live) to keep draw calls low.
  const matte = {
    front: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
    double: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
  };
  const merge = (container: THREE.Object3D, keepLive: THREE.Object3D[] = []) =>
    mergeStaticMeshes(container, keepLive, matte);
  merge(charGroup, [upperBody, armR.upper.parent!, armL.upper.parent!]);
  merge(upperBody, [headGroup, braidGroup]);
  merge(headGroup);
  merge(braidGroup);
  merge(armR.fore);
  merge(armL.fore);
  merge(workbench);
  merge(cauldron);
  merge(rack, dryingBundles);
  dryingBundles.forEach((pivot) => merge(pivot));
  merge(crate);

  pose();

  return {
    group,
    update: (dt: number) => {
      // Closed-form animation from accumulated time: hostile dt values cannot drift or explode.
      if (Number.isFinite(dt) && dt > 0) time += dt;
      pose();
    },
  };
}

export function createTownsperson(
  role: 'blacksmith' | 'herbalist' | 'scout'
): { group: THREE.Group; update: (dt: number) => void } {
  if (role === 'blacksmith') {
    return createTheronBlacksmith();
  }
  if (role === 'herbalist') {
    return createLyraHerbalist();
  }

  const group = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf1c29b, roughness: 0.8 });

  {
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
