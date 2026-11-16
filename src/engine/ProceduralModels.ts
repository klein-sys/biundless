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
import { createWhisperingGlade, type WhisperingGlade } from './WhisperingGlade';

export { createBossModel, type BossAnimContext, type BossRig } from './BossModels';

export interface WaypointCrystal {
  readonly id: 'hub' | BossId;
  readonly mesh: THREE.Object3D;
  readonly position: THREE.Vector3;
}

export interface ArenaBundle {
  readonly glade: WhisperingGlade;
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
  const glade = createWhisperingGlade(stoneMat);
  group.add(glade.group);

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
  const witchLandmark = LANDMARK_BY_ID.witch;
  let rocksPlaced = 0;
  for (let i = 0; i < rockCount; i++) {
    const r = 18 + seededRand(i * 7 + 41) * (WORLD_PLAYABLE_RADIUS - 16);
    const a = seededRand(i * 7 + 42) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.hypot(x - witchLandmark.x, z - witchLandmark.z) < witchLandmark.plateauRadius) continue;
    const y = getTerrainHeight(x, z);
    const s = 0.6 + seededRand(i * 7 + 43) * 1.3;
    rDummy.position.set(x, y + s * 0.25, z);
    rDummy.scale.set(s * 1.3, s * 0.78, s);
    rDummy.rotation.set(seededRand(i) * 0.4, seededRand(i + 1) * 3.1, 0);
    rDummy.updateMatrix();
    rockInst.setMatrixAt(rocksPlaced++, rDummy.matrix);
  }
  rockInst.count = rocksPlaced;
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
    glade,
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
  cottage.name = 'cottage_root';

  // Palette variant tuning
  const wallColors = [0xdfd8cb, 0xe6e0d2, 0xd8cbba, 0xdfd6c6];
  const roofColors = [0x334155, 0x3b4f3d, 0x7c2d12, 0x4a3c31];
  const timberColors = [0x382212, 0x452a17, 0x301a0d, 0x3e2815];

  const wallColor = wallColors[variant % wallColors.length];
  const roofColor = roofColors[variant % roofColors.length];
  const timberColor = timberColors[variant % timberColors.length];

  // Common Materials
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.92,
    metalness: 0.05,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: wallColor,
    roughness: 0.88,
    metalness: 0.02,
  });
  const timberMat = new THREE.MeshStandardMaterial({
    color: timberColor,
    roughness: 0.78,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: roofColor,
    roughness: 0.82,
  });
  const chimneyMat = new THREE.MeshStandardMaterial({
    color: 0x5b616e,
    roughness: 0.94,
  });
  const chimneyPotMat = new THREE.MeshStandardMaterial({
    color: 0x9a3412,
    roughness: 0.75,
  });
  const doorWoodMat = new THREE.MeshStandardMaterial({
    color: 0x422615,
    roughness: 0.7,
  });
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x24272c,
    roughness: 0.4,
    metalness: 0.85,
  });
  const windowGlowMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
  const windowFrameMat = new THREE.MeshStandardMaterial({
    color: 0x2d1a0e,
    roughness: 0.75,
  });
  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0x2d5a27,
    roughness: 0.85,
  });
  const flowerLavenderMat = new THREE.MeshStandardMaterial({ color: 0xa78bfa, roughness: 0.6 });
  const flowerGoldMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.6 });
  const flowerPinkMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.6 });

  // 1. Cut-Stone Foundation Base Plinth (Sits firmly flush on terrain surface)
  const foundation = new THREE.Group();
  foundation.name = 'cottage_foundation';

  // Base footing slab
  const baseFooting = new THREE.Mesh(new THREE.BoxGeometry(5.02, 0.18, 4.42), stoneMat);
  baseFooting.position.y = 0.09;
  baseFooting.receiveShadow = true;
  foundation.add(baseFooting);

  // Main foundation masonry skirt
  const baseSkirt = new THREE.Mesh(new THREE.BoxGeometry(4.82, 0.62, 4.22), stoneMat);
  baseSkirt.position.y = 0.42;
  baseSkirt.castShadow = true;
  baseSkirt.receiveShadow = true;
  foundation.add(baseSkirt);

  // Corner stone quoins (layered architectural corner stones)
  const quoinGeo = new THREE.BoxGeometry(0.38, 0.16, 0.38);
  const quoinOffsets = [
    [-2.35, -2.05],
    [2.35, -2.05],
    [-2.35, 2.05],
    [2.35, 2.05],
  ];
  quoinOffsets.forEach(([qx, qz]) => {
    for (let i = 0; i < 3; i++) {
      const quoin = new THREE.Mesh(quoinGeo, stoneMat);
      quoin.position.set(qx + (i % 2 === 0 ? 0.02 : -0.02), 0.18 + i * 0.2, qz);
      quoin.castShadow = true;
      foundation.add(quoin);
    }
  });

  // Front cut-stone doorstep
  const doorstep = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.14, 0.48), stoneMat);
  doorstep.position.set(0, 0.07, 2.22);
  doorstep.receiveShadow = true;
  foundation.add(doorstep);

  cottage.add(foundation);

  // 2. Plaster Walls Main Body
  const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.65, 3.9), wallMat);
  wallMesh.position.y = 2.025;
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  cottage.add(wallMesh);

  // 3. Half-Timbered Tudor Framing Structure
  // Horizontal beams: Sill, Mid-belt, and Eaves plate
  const sillBeam = new THREE.Mesh(new THREE.BoxGeometry(4.58, 0.12, 3.98), timberMat);
  sillBeam.position.y = 0.73;
  cottage.add(sillBeam);

  const beltBeam = new THREE.Mesh(new THREE.BoxGeometry(4.58, 0.12, 3.98), timberMat);
  beltBeam.position.y = 1.95;
  cottage.add(beltBeam);

  const eavesPlate = new THREE.Mesh(new THREE.BoxGeometry(4.58, 0.14, 3.98), timberMat);
  eavesPlate.position.y = 3.32;
  cottage.add(eavesPlate);

  // 4 Massive corner vertical timber posts
  const cornerPostGeo = new THREE.BoxGeometry(0.22, 2.65, 0.22);
  const cornerCoords = [
    [-2.24, -1.94],
    [2.24, -1.94],
    [-2.24, 1.94],
    [2.24, 1.94],
  ];
  cornerCoords.forEach(([cx, cz]) => {
    const post = new THREE.Mesh(cornerPostGeo, timberMat);
    post.position.set(cx, 2.025, cz);
    post.castShadow = true;
    cottage.add(post);
  });

  // Front Tudor framing: Door posts and diagonal cross-braces
  const doorPostL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.95, 0.12), timberMat);
  doorPostL.position.set(-0.58, 1.68, 1.98);
  cottage.add(doorPostL);

  const doorPostR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.95, 0.12), timberMat);
  doorPostR.position.set(0.58, 1.68, 1.98);
  cottage.add(doorPostR);

  const doorLintel = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.14, 0.14), timberMat);
  doorLintel.position.set(0, 2.68, 1.98);
  cottage.add(doorLintel);

  // Diagonal Tudor braces on front face
  const diagGeo = new THREE.BoxGeometry(0.1, 1.15, 0.06);
  const diagBraces = [
    { x: -1.75, y: 2.62, rotZ: 0.55 },
    { x: -1.75, y: 1.34, rotZ: -0.55 },
    { x: 1.75, y: 2.62, rotZ: -0.55 },
    { x: 1.75, y: 1.34, rotZ: 0.55 },
  ];
  diagBraces.forEach((b) => {
    const brace = new THREE.Mesh(diagGeo, timberMat);
    brace.position.set(b.x, b.y, 1.98);
    brace.rotation.z = b.rotZ;
    cottage.add(brace);
  });

  // 4. Overhanging Pitched Gable Roof with Bargeboards & Finials
  const roofGroup = new THREE.Group();
  roofGroup.name = 'cottage_roof';

  const pitchAngle = 0.58; // ~33.2 degrees
  const roofSlabGeo = new THREE.BoxGeometry(2.96, 0.22, 4.75);

  const roofLeft = new THREE.Mesh(roofSlabGeo, roofMat);
  roofLeft.position.set(-1.18, 4.05, 0);
  roofLeft.rotation.z = pitchAngle;
  roofLeft.castShadow = true;
  roofLeft.receiveShadow = true;
  roofGroup.add(roofLeft);

  const roofRight = new THREE.Mesh(roofSlabGeo, roofMat);
  roofRight.position.set(1.18, 4.05, 0);
  roofRight.rotation.z = -pitchAngle;
  roofRight.castShadow = true;
  roofRight.receiveShadow = true;
  roofGroup.add(roofRight);

  // Roof Ridge Cap Beam
  const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 4.8), timberMat);
  ridgeCap.position.set(0, 4.86, 0);
  ridgeCap.rotation.z = Math.PI * 0.25;
  ridgeCap.castShadow = true;
  roofGroup.add(ridgeCap);

  // Gable end walls (vertical timbered attic walls under roof)
  const gableFront = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 2.3, 1.5, 3), timberMat);
  gableFront.position.set(0, 4.05, 1.96);
  gableFront.rotation.y = Math.PI;
  gableFront.castShadow = true;
  roofGroup.add(gableFront);

  const gableBack = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 2.3, 1.5, 3), timberMat);
  gableBack.position.set(0, 4.05, -1.96);
  gableBack.castShadow = true;
  roofGroup.add(gableBack);

  // Carved wooden bargeboards along front & back gables
  const bargeGeo = new THREE.BoxGeometry(2.98, 0.24, 0.08);
  [-2.38, 2.38].forEach((bz) => {
    const bargeL = new THREE.Mesh(bargeGeo, timberMat);
    bargeL.position.set(-1.18, 4.05, bz);
    bargeL.rotation.z = pitchAngle;
    roofGroup.add(bargeL);

    const bargeR = new THREE.Mesh(bargeGeo, timberMat);
    bargeR.position.set(1.18, 4.05, bz);
    bargeR.rotation.z = -pitchAngle;
    roofGroup.add(bargeR);

    // Turned apex finial
    const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, 0.45, 6), timberMat);
    finial.position.set(0, 5.08, bz);
    roofGroup.add(finial);
  });

  cottage.add(roofGroup);

  // 5. Roof Dormer Window with Pitch Roof
  const dormerGroup = new THREE.Group();
  dormerGroup.name = 'cottage_dormer';
  dormerGroup.position.set(1.22, 4.22, 0.45);

  const dormerWalls = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.72, 1.05), wallMat);
  dormerGroup.add(dormerWalls);

  const dormerRoofL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 1.15), roofMat);
  dormerRoofL.position.set(-0.22, 0.46, 0);
  dormerRoofL.rotation.z = 0.55;
  dormerGroup.add(dormerRoofL);

  const dormerRoofR = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 1.15), roofMat);
  dormerRoofR.position.set(0.22, 0.46, 0);
  dormerRoofR.rotation.z = -0.55;
  dormerGroup.add(dormerRoofR);

  const dormerWinPane = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.04), windowGlowMat);
  dormerWinPane.position.set(0, 0.02, 0.54);
  dormerGroup.add(dormerWinPane);

  const dormerFrame = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.06), windowFrameMat);
  dormerFrame.position.set(0, 0.02, 0.53);
  dormerGroup.add(dormerFrame);

  cottage.add(dormerGroup);

  // 6. Stepped Stone Chimney with Cylindrical Terra-Cotta Pot
  const chimneyGroup = new THREE.Group();
  chimneyGroup.name = 'cottage_chimney';
  chimneyGroup.position.set(1.72, 0, -1.15);

  // Lower chimney stack
  const chimLower = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.6, 0.95), chimneyMat);
  chimLower.position.y = 1.3;
  chimLower.castShadow = true;
  chimneyGroup.add(chimLower);

  // Mid stepped tier
  const chimMid = new THREE.Mesh(new THREE.BoxGeometry(0.82, 2.4, 0.82), chimneyMat);
  chimMid.position.y = 3.4;
  chimMid.castShadow = true;
  chimneyGroup.add(chimMid);

  // Upper stack piercing roof
  const chimUpper = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.8, 0.72), chimneyMat);
  chimUpper.position.y = 5.1;
  chimUpper.castShadow = true;
  chimneyGroup.add(chimUpper);

  // Chimney cornice cap
  const chimCap = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.14, 0.92), stoneMat);
  chimCap.position.y = 6.05;
  chimneyGroup.add(chimCap);

  // Cylindrical terra-cotta chimney pot
  const chimPot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.55, 8), chimneyPotMat);
  chimPot.position.y = 6.38;
  chimPot.castShadow = true;
  chimneyGroup.add(chimPot);

  const chimPotRim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 6, 8), chimneyPotMat);
  chimPotRim.position.y = 6.65;
  chimPotRim.rotation.x = Math.PI * 0.5;
  chimneyGroup.add(chimPotRim);

  cottage.add(chimneyGroup);

  // 7. Detailed Front Door & Entrance Porch Awning
  const doorGroup = new THREE.Group();
  doorGroup.name = 'cottage_door';
  doorGroup.position.set(0, 0, 1.98);

  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.96, 1.92, 0.12), doorWoodMat);
  doorLeaf.position.y = 1.62;
  doorLeaf.castShadow = true;
  doorGroup.add(doorLeaf);

  // Wrought iron strap hinges
  const hingeUpper = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.14), ironMat);
  hingeUpper.position.set(0.08, 2.15, 0);
  doorGroup.add(hingeUpper);

  const hingeLower = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.14), ironMat);
  hingeLower.position.set(0.08, 1.05, 0);
  doorGroup.add(hingeLower);

  // Iron ring door pull
  const ringHandle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 8), ironMat);
  ringHandle.position.set(0.32, 1.58, 0.08);
  doorGroup.add(ringHandle);

  // Pitched wood entrance canopy awning over door
  const awningL = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.65), timberMat);
  awningL.position.set(-0.32, 2.85, 0.32);
  awningL.rotation.z = 0.35;
  doorGroup.add(awningL);

  const awningR = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.65), timberMat);
  awningR.position.set(0.32, 2.85, 0.32);
  awningR.rotation.z = -0.35;
  doorGroup.add(awningR);

  // Awning diagonal support brackets
  const bracketL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), timberMat);
  bracketL.position.set(-0.55, 2.65, 0.18);
  bracketL.rotation.x = -0.6;
  doorGroup.add(bracketL);

  const bracketR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), timberMat);
  bracketR.position.set(0.55, 2.65, 0.18);
  bracketR.rotation.x = -0.6;
  doorGroup.add(bracketR);

  cottage.add(doorGroup);

  // 8. Leaded Glass Windows with Flower Planter Boxes
  const addWindowWithPlanter = (xPos: number) => {
    const winGroup = new THREE.Group();
    winGroup.position.set(xPos, 1.85, 1.98);

    // Warm amber glowing pane
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.05), windowGlowMat);
    winGroup.add(pane);

    // Frame casing
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.86, 0.1), windowFrameMat);
    winGroup.add(frame);

    // Cross muntins
    const muntinV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.07), windowFrameMat);
    winGroup.add(muntinV);
    const muntinH = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.07), windowFrameMat);
    winGroup.add(muntinH);

    // Wooden flower planter box below window
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.22, 0.32), timberMat);
    box.position.set(0, -0.56, 0.14);
    winGroup.add(box);

    // Planter soil & foliage
    const plantBase = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.12, 0.28), foliageMat);
    plantBase.position.set(0, -0.46, 0.14);
    winGroup.add(plantBase);

    // Colorful blooming blossoms
    const flowers = [
      { x: -0.28, z: 0.12, mat: flowerLavenderMat },
      { x: -0.08, z: 0.18, mat: flowerGoldMat },
      { x: 0.12, z: 0.1, mat: flowerPinkMat },
      { x: 0.3, z: 0.16, mat: flowerLavenderMat },
    ];
    flowers.forEach((f) => {
      const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), f.mat);
      bloom.position.set(f.x, -0.38, f.z);
      winGroup.add(bloom);
    });

    cottage.add(winGroup);
  };

  addWindowWithPlanter(-1.32);
  addWindowWithPlanter(1.32);

  // 9. Variant-Specific Personality & Exterior Props
  const variantPropGroup = new THREE.Group();
  variantPropGroup.name = 'cottage_variant_prop';

  if (variant === 0) {
    // Variant 0 (Blacksmith Forge Cottage): Side lean-to shelter with stacked firewood & iron crate
    const leanToGroup = new THREE.Group();
    leanToGroup.position.set(-2.65, 0, 0);

    // 2 Lean-to wooden posts
    const postA = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.3, 0.14), timberMat);
    postA.position.set(-0.7, 1.15, -0.9);
    leanToGroup.add(postA);

    const postB = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.3, 0.14), timberMat);
    postB.position.set(-0.7, 1.15, 0.9);
    leanToGroup.add(postB);

    // Pitched shed roof slab
    const shedRoof = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 2.4), roofMat);
    shedRoof.position.set(-0.35, 2.2, 0);
    shedRoof.rotation.z = -0.32;
    shedRoof.castShadow = true;
    leanToGroup.add(shedRoof);

    // Stacked cordwood logs
    const logGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.8, 6);
    const logMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.85 });
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const log = new THREE.Mesh(logGeo, logMat);
        log.position.set(-0.55 + c * 0.16, 0.12 + r * 0.18, 0);
        log.rotation.x = Math.PI * 0.5;
        leanToGroup.add(log);
      }
    }

    // Iron supply crate
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), timberMat);
    crate.position.set(-0.35, 0.28, -0.6);
    leanToGroup.add(crate);

    variantPropGroup.add(leanToGroup);
  } else if (variant === 1) {
    // Variant 1 (Lyra's Apothecary Cottage): Braided hanging drying herb bundles under porch eave
    const herbGroup = new THREE.Group();
    herbGroup.position.set(0, 2.65, 2.15);

    const herbMats = [
      new THREE.MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0x84a46a, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.7 }),
    ];
    const herbOffsets = [-0.35, 0, 0.35];
    herbOffsets.forEach((hx, idx) => {
      // Twine hanger
      const twine = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 4), timberMat);
      twine.position.set(hx, -0.08, 0);
      herbGroup.add(twine);

      // Inverted herb bundle cone
      const bundle = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 6), herbMats[idx]);
      bundle.position.set(hx, -0.26, 0);
      herbGroup.add(bundle);
    });

    variantPropGroup.add(herbGroup);
  } else if (variant === 2) {
    // Variant 2 (The Wayfarer Tavern & Inn): Wrought iron sign bracket with swinging carved sign & oak ale casks
    const tavernGroup = new THREE.Group();

    // Wrought iron scrollwork sign bracket
    const bracketArm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.95), ironMat);
    bracketArm.position.set(0.85, 2.92, 2.45);
    tavernGroup.add(bracketArm);

    const bracketSupport = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.52, 0.05), ironMat);
    bracketSupport.position.set(0.85, 2.68, 2.3);
    bracketSupport.rotation.x = -0.7;
    tavernGroup.add(bracketSupport);

    // Carved tavern signboard
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.52, 0.65), timberMat);
    signBoard.position.set(0.85, 2.58, 2.65);
    tavernGroup.add(signBoard);

    // Hanging warm lantern
    const lanternMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.4, metalness: 0.7 });
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.22, 6), lanternMat);
    lantern.position.set(-0.75, 2.35, 2.05);
    tavernGroup.add(lantern);

    // 2 Stacked oak ale casks beside entrance
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x5a341b, roughness: 0.75 });
    const barrelA = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.58, 8), barrelMat);
    barrelA.position.set(-0.95, 0.29, 2.15);
    tavernGroup.add(barrelA);

    const barrelB = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.52, 8), barrelMat);
    barrelB.position.set(-0.95, 0.78, 2.15);
    barrelB.rotation.z = Math.PI * 0.5;
    tavernGroup.add(barrelB);

    variantPropGroup.add(tavernGroup);
  } else {
    // Variant 3 (Valley Farm Cottage): Gable loft hay-hoist crane beam with pulley wheel and cordwood pile
    const farmGroup = new THREE.Group();

    // Crane hoist beam protruding from gable peak
    const craneBeam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.25), timberMat);
    craneBeam.position.set(0, 4.88, 2.55);
    farmGroup.add(craneBeam);

    // Pulley wheel ring
    const pulley = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 10), ironMat);
    pulley.position.set(0, 4.75, 3.05);
    farmGroup.add(pulley);

    // Hanging hemp hoist rope
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 4), timberMat);
    rope.position.set(0, 4.05, 3.05);
    farmGroup.add(rope);

    // Stacked cordwood firewood pile along right foundation
    const woodpile = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.65, 1.6), timberMat);
    woodpile.position.set(2.45, 0.35, 0);
    farmGroup.add(woodpile);

    variantPropGroup.add(farmGroup);
  }

  cottage.add(variantPropGroup);

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

export function createEldrinScout(): { group: THREE.Group; update: (dt: number) => void } {
  const group = new THREE.Group();
  group.name = 'eldrin_root';

  // --- Palette & Stylized Materials ---
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xefb892, roughness: 0.72 });
  const eyeGreenMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.3 });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  const eyeShineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const browMat = new THREE.MeshStandardMaterial({ color: 0x3e2714, roughness: 0.8 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x442818, roughness: 0.8 });

  const leatherJacketMat = new THREE.MeshStandardMaterial({ color: 0x6b3f20, roughness: 0.75 });
  const underTunicMat = new THREE.MeshStandardMaterial({ color: 0x2e4a38, roughness: 0.8 });
  const cowlMat = new THREE.MeshStandardMaterial({
    color: 0x1b3c29,
    roughness: 0.82,
    side: THREE.DoubleSide,
  });
  const cloakMat = new THREE.MeshStandardMaterial({
    color: 0x183424,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x3d433b, roughness: 0.85 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x2c1a0e, roughness: 0.65 });
  const bracerMat = new THREE.MeshStandardMaterial({ color: 0x482b15, roughness: 0.68 });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 0.8,
    roughness: 0.3,
  });
  const bowWoodMat = new THREE.MeshStandardMaterial({ color: 0x8a5229, roughness: 0.65 });
  const bowGripMat = new THREE.MeshStandardMaterial({ color: 0x24160c, roughness: 0.8 });
  const stringMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
  const quiverMat = new THREE.MeshStandardMaterial({ color: 0x542c13, roughness: 0.75 });
  const arrowShaftMat = new THREE.MeshStandardMaterial({ color: 0xb5814c, roughness: 0.7 });
  const fletchGreenMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 });
  const fletchRedMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.6 });

  // 1. Legs & Grounded Boots (Flush with ground y = 0)
  const legsGroup = new THREE.Group();
  legsGroup.name = 'eldrin_legs';

  [-0.14, 0.14].forEach((lx) => {
    // Upper thigh in ranger trousers
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.44, 0.18), pantsMat);
    thigh.position.set(lx, 0.58, 0);
    thigh.castShadow = true;
    legsGroup.add(thigh);

    // Boot shaft
    const bootShaft = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.38, 0.2), bootMat);
    bootShaft.position.set(lx, 0.22, 0);
    bootShaft.castShadow = true;
    legsGroup.add(bootShaft);

    // Folded turn-down boot cuff rim
    const bootCuff = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.11, 0.23), bootMat);
    bootCuff.position.set(lx, 0.38, 0);
    legsGroup.add(bootCuff);

    // Ankle strap & brass buckle
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.04, 0.21), leatherJacketMat);
    strap.position.set(lx, 0.16, 0);
    legsGroup.add(strap);

    const ankleBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.02), brassMat);
    ankleBuckle.position.set(lx + (lx > 0 ? 0.11 : -0.11), 0.16, 0);
    legsGroup.add(ankleBuckle);

    // Foot sole (Sitting flush on ground, base at y = 0)
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.3), bootMat);
    foot.position.set(lx, 0.07, 0.05);
    foot.receiveShadow = true;
    legsGroup.add(foot);
  });
  group.add(legsGroup);

  // 2. Torso with Leather Brigandine & Cross-body Quiver Strap
  const torsoGroup = new THREE.Group();
  torsoGroup.name = 'eldrin_torso';
  torsoGroup.position.set(0, 0.8, 0);

  // Under-tunic skirt base
  const tunicSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 0.32), underTunicMat);
  tunicSkirt.position.y = 0.08;
  torsoGroup.add(tunicSkirt);

  // Upper chest & brigandine jerkin
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.54, 0.34), leatherJacketMat);
  chest.position.y = 0.38;
  chest.castShadow = true;
  torsoGroup.add(chest);

  // Waist belt & brass buckle
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.09, 0.36), bootMat);
  belt.position.y = 0.15;
  torsoGroup.add(belt);

  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.11, 0.38), brassMat);
  buckle.position.y = 0.15;
  torsoGroup.add(buckle);

  // Hip pouch on right side
  const hipPouch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.14), leatherJacketMat);
  hipPouch.position.set(0.26, 0.12, 0.06);
  torsoGroup.add(hipPouch);

  // Sheathed hunting dagger on right hip
  const daggerSheath = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.08), bootMat);
  daggerSheath.position.set(0.28, 0.1, 0.08);
  daggerSheath.rotation.z = -0.22;
  torsoGroup.add(daggerSheath);

  const daggerGuard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.04), brassMat);
  daggerGuard.position.set(0.31, 0.25, 0.08);
  daggerGuard.rotation.z = -0.22;
  torsoGroup.add(daggerGuard);

  const daggerPommel = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), brassMat);
  daggerPommel.position.set(0.33, 0.32, 0.08);
  torsoGroup.add(daggerPommel);

  // Cross-body quiver strap
  const strapChest = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.62, 0.36), bootMat);
  strapChest.position.set(0, 0.4, 0);
  strapChest.rotation.z = 0.48;
  torsoGroup.add(strapChest);

  const strapBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.38), brassMat);
  strapBuckle.position.set(0.06, 0.45, 0);
  strapBuckle.rotation.z = 0.48;
  torsoGroup.add(strapBuckle);

  group.add(torsoGroup);

  // 3. Arrow Quiver mounted on Back
  const quiverGroup = new THREE.Group();
  quiverGroup.name = 'eldrin_quiver';
  quiverGroup.position.set(0.12, 1.25, -0.22);
  quiverGroup.rotation.z = -0.42;
  quiverGroup.rotation.x = 0.15;

  // Quiver cylinder body
  const quiverBody = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.065, 0.62, 10), quiverMat);
  quiverBody.castShadow = true;
  quiverGroup.add(quiverBody);

  // Brass reinforced collar rim
  const quiverRim = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 12), brassMat);
  quiverRim.position.y = 0.31;
  quiverRim.rotation.x = Math.PI * 0.5;
  quiverGroup.add(quiverRim);

  // 4 Protruding arrows with fletched vanes
  const arrowAngles = [-0.12, -0.04, 0.05, 0.14];
  arrowAngles.forEach((ang, idx) => {
    const arrowShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.32, 6), arrowShaftMat);
    arrowShaft.position.set(ang * 0.4, 0.42, (idx % 2 === 0 ? 0.02 : -0.02));
    arrowShaft.rotation.z = ang;
    quiverGroup.add(arrowShaft);

    // 3 Fletching feather vanes at 120-degree offsets
    const fletchMat = idx % 2 === 0 ? fletchGreenMat : fletchRedMat;
    for (let f = 0; f < 3; f++) {
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.08, 0.028), fletchMat);
      vane.position.set(ang * 0.4, 0.5, (idx % 2 === 0 ? 0.02 : -0.02));
      vane.rotation.y = (f * Math.PI * 2) / 3;
      quiverGroup.add(vane);
    }
  });

  group.add(quiverGroup);

  // 4. Cloak draped down the back
  const cloakGroup = new THREE.Group();
  cloakGroup.name = 'eldrin_cloak';
  cloakGroup.position.set(0, 1.45, -0.18);

  const cloakMantle = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.86, 0.06), cloakMat);
  cloakMantle.position.y = -0.42;
  cloakMantle.rotation.x = 0.06;
  cloakMantle.castShadow = true;
  cloakGroup.add(cloakMantle);

  group.add(cloakGroup);

  // 5. Articulated Head & Hooded Ranger Cowl
  const headGroup = new THREE.Group();
  headGroup.name = 'eldrin_head';
  headGroup.position.set(0, 1.48, 0);

  // Neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.14, 8), skinMat);
  neck.position.y = 0.02;
  headGroup.add(neck);

  // Head cranium
  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), skinMat);
  headMesh.position.set(0, 0.18, 0.02);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  // Expressive cel-shaded ranger face
  // Left eye
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.035, 0.02), eyeGreenMat);
  eyeL.position.set(-0.075, 0.19, 0.175);
  headGroup.add(eyeL);

  const pupilL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.022), pupilMat);
  pupilL.position.set(-0.075, 0.19, 0.177);
  headGroup.add(pupilL);

  const shineL = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.024), eyeShineMat);
  shineL.position.set(-0.068, 0.2, 0.179);
  headGroup.add(shineL);

  // Right eye
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.035, 0.02), eyeGreenMat);
  eyeR.position.set(0.075, 0.19, 0.175);
  headGroup.add(eyeR);

  const pupilR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.022), pupilMat);
  pupilR.position.set(0.075, 0.19, 0.177);
  headGroup.add(pupilR);

  const shineR = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.024), eyeShineMat);
  shineR.position.set(0.082, 0.2, 0.179);
  headGroup.add(shineR);

  // Arched eyebrows
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.016, 0.02), browMat);
  browL.position.set(-0.075, 0.225, 0.176);
  browL.rotation.z = 0.1;
  headGroup.add(browL);

  const browR = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.016, 0.02), browMat);
  browR.position.set(0.075, 0.225, 0.176);
  browR.rotation.z = -0.1;
  headGroup.add(browR);

  // Nose bridge
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.07, 4), skinMat);
  nose.position.set(0, 0.155, 0.185);
  nose.rotation.x = Math.PI * 0.15;
  headGroup.add(nose);

  // Smile / mouth line
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.015), browMat);
  mouth.position.set(0.01, 0.095, 0.175);
  mouth.rotation.z = 0.05;
  headGroup.add(mouth);

  // Hair locks peeking from cowl
  const hairL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.08), hairMat);
  hairL.position.set(-0.16, 0.15, 0.11);
  headGroup.add(hairL);

  const hairR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.08), hairMat);
  hairR.position.set(0.16, 0.15, 0.11);
  headGroup.add(hairR);

  // Hooded Ranger Cowl (Framing head and face)
  const cowlGroup = new THREE.Group();
  cowlGroup.name = 'eldrin_cowl';

  // Hood enclosure
  const hoodTop = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.36), cowlMat);
  hoodTop.position.set(0, 0.34, 0.02);
  cowlGroup.add(hoodTop);

  const hoodBack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.12), cowlMat);
  hoodBack.position.set(0, 0.2, -0.12);
  cowlGroup.add(hoodBack);

  const hoodSideL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, 0.28), cowlMat);
  hoodSideL.position.set(-0.16, 0.21, 0.04);
  cowlGroup.add(hoodSideL);

  const hoodSideR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, 0.28), cowlMat);
  hoodSideR.position.set(0.16, 0.21, 0.04);
  cowlGroup.add(hoodSideR);

  // Rear hood tail / fold
  const hoodPoint = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.22, 5), cowlMat);
  hoodPoint.position.set(0, 0.26, -0.22);
  hoodPoint.rotation.x = -0.7;
  cowlGroup.add(hoodPoint);

  // Draped shoulder mantle
  const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 0.16, 8), cowlMat);
  mantle.position.y = -0.01;
  cowlGroup.add(mantle);

  // Embossed golden leaf pin clasp at throat
  const leafPin = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.085, 3), brassMat);
  leafPin.position.set(0, 0.04, 0.21);
  leafPin.rotation.x = Math.PI * 0.5;
  leafPin.rotation.z = Math.PI;
  cowlGroup.add(leafPin);

  headGroup.add(cowlGroup);
  group.add(headGroup);

  // 6. Recurve Hunting Longbow (Smooth curved stave + bowstring + leather grip)
  const bowGroup = new THREE.Group();
  bowGroup.name = 'eldrin_bow';

  // Catmull-Rom curved recurve stave
  const bowPoints = [
    new THREE.Vector3(0, 0.68, 0.07),
    new THREE.Vector3(0, 0.46, -0.05),
    new THREE.Vector3(0, 0.18, -0.02),
    new THREE.Vector3(0, 0.0, 0.0),
    new THREE.Vector3(0, -0.18, -0.02),
    new THREE.Vector3(0, -0.46, -0.05),
    new THREE.Vector3(0, -0.68, 0.07),
  ];
  const bowCurve = new THREE.CatmullRomCurve3(bowPoints);
  const bowStave = new THREE.Mesh(new THREE.TubeGeometry(bowCurve, 20, 0.018, 8, false), bowWoodMat);
  bowStave.castShadow = true;
  bowGroup.add(bowStave);

  // Leather wrapped grip at center
  const bowGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.15, 8), bowGripMat);
  bowGroup.add(bowGrip);

  // Brass accent rings on grip ends
  [-0.075, 0.075].forEach((gy) => {
    const gripRing = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.005, 6, 8), brassMat);
    gripRing.position.y = gy;
    gripRing.rotation.x = Math.PI * 0.5;
    bowGroup.add(gripRing);
  });

  // Bowstring spanning from upper tip to lower tip
  const stringGeo = new THREE.CylinderGeometry(0.003, 0.003, 1.36, 4);
  const bowstring = new THREE.Mesh(stringGeo, stringMat);
  bowstring.position.set(0, 0, 0.07);
  bowGroup.add(bowstring);

  // Horn string nocks at stave tips
  [-0.68, 0.68].forEach((ny) => {
    const nock = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), brassMat);
    nock.position.set(0, ny, 0.07);
    bowGroup.add(nock);
  });

  // 7. Left Arm holding the Recurve Longbow
  const leftArmGroup = new THREE.Group();
  leftArmGroup.name = 'eldrin_left_arm';
  leftArmGroup.position.set(-0.32, 1.35, 0);

  // Shoulder sleeve
  const sleeveL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), underTunicMat);
  leftArmGroup.add(sleeveL);

  // Upper bicep
  const bicepL = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.28, 8), underTunicMat);
  bicepL.position.set(-0.04, -0.14, 0.04);
  bicepL.rotation.set(0.3, 0, -0.2);
  leftArmGroup.add(bicepL);

  // Forearm with archer's laced armguard bracer
  const forearmL = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.28, 8), bracerMat);
  forearmL.position.set(-0.06, -0.34, 0.16);
  forearmL.rotation.set(0.85, 0.3, -0.2);
  leftArmGroup.add(forearmL);

  // Hand clutching the bow grip
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), skinMat);
  handL.position.set(-0.06, -0.46, 0.28);
  leftArmGroup.add(handL);

  // Mount bow in left hand
  bowGroup.position.set(-0.06, -0.46, 0.28);
  bowGroup.rotation.set(0.4, -0.3, 0.25);
  leftArmGroup.add(bowGroup);

  group.add(leftArmGroup);

  // 8. Right Arm resting alertly on hip / quiver harness
  const rightArmGroup = new THREE.Group();
  rightArmGroup.name = 'eldrin_right_arm';
  rightArmGroup.position.set(0.32, 1.35, 0);

  const sleeveR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), underTunicMat);
  rightArmGroup.add(sleeveR);

  const bicepR = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.28, 8), underTunicMat);
  bicepR.position.set(0.04, -0.14, 0);
  bicepR.rotation.set(-0.1, 0, 0.2);
  rightArmGroup.add(bicepR);

  const forearmR = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.06, 0.26, 8), bracerMat);
  forearmR.position.set(0.06, -0.32, 0.06);
  forearmR.rotation.set(0.45, -0.2, 0.3);
  rightArmGroup.add(forearmR);

  const handR = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), skinMat);
  handR.position.set(0.08, -0.44, 0.14);
  rightArmGroup.add(handR);

  group.add(rightArmGroup);

  // --- Animation & Horizon Scanning Update Loop ---
  let time = Math.random() * 10.0;

  return {
    group,
    update: (dt: number) => {
      // Safe delta time accumulation (hostile dt resilience)
      const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.2) : 0.016;
      time += safeDt;

      // Natural breathing sway
      const breath = Math.sin(time * 1.8);
      torsoGroup.position.y = 0.8 + breath * 0.012;
      torsoGroup.rotation.x = breath * 0.008;

      // Cloak breeze flutter
      cloakGroup.rotation.x = 0.06 + Math.sin(time * 2.2) * 0.025;
      quiverGroup.rotation.z = -0.42 + Math.sin(time * 1.8) * 0.015;

      // Bow arm stabilization against breath
      leftArmGroup.rotation.x = -breath * 0.01;

      // Frontier Horizon Scouting Scan (8-second loop)
      const scanPhase = (time * 0.8) % 8.0;
      let targetHeadPan = 0;
      let targetHeadTilt = Math.sin(time * 1.4) * 0.02;

      if (scanPhase > 2.0 && scanPhase <= 4.0) {
        // Smoothly scan left trailhead
        const progress = Math.min(1.0, (scanPhase - 2.0) * 1.5);
        targetHeadPan = -0.38 * Math.sin(progress * Math.PI * 0.5);
        targetHeadTilt = -0.04;
      } else if (scanPhase > 4.0 && scanPhase <= 5.0) {
        // Smoothly sweep back across center
        const progress = (scanPhase - 4.0);
        targetHeadPan = -0.38 * (1.0 - progress);
      } else if (scanPhase > 5.0 && scanPhase <= 7.0) {
        // Smoothly scan right valley ridge
        const progress = Math.min(1.0, (scanPhase - 5.0) * 1.5);
        targetHeadPan = 0.35 * Math.sin(progress * Math.PI * 0.5);
        targetHeadTilt = 0.03;
      } else if (scanPhase > 7.0) {
        // Return to center
        const progress = (scanPhase - 7.0);
        targetHeadPan = 0.35 * (1.0 - progress);
      }

      headGroup.rotation.y = targetHeadPan;
      headGroup.rotation.z = targetHeadTilt;
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
  if (role === 'scout') {
    return createEldrinScout();
  }

  return createEldrinScout();
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
