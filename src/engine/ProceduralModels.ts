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
  // 7A. Northwest: Whispering Glade (Wind-Chime Crystal Arches)
  {
    const lm = LANDMARK_BY_ID.witch;
    const gladeFloor = new THREE.Mesh(
      new THREE.RingGeometry(11.5, 12.1, 48),
      new THREE.MeshStandardMaterial({ color: 0x8ad0ff, emissive: 0x2d7ab8, emissiveIntensity: 0.3 }),
    );
    gladeFloor.rotation.x = -Math.PI / 2;
    gladeFloor.position.set(lm.x, lm.baseHeight + 0.03, lm.z);
    group.add(gladeFloor);

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const ax = lm.x + Math.cos(a) * 14.5;
      const az = lm.z + Math.sin(a) * 14.5;
      const ay = getTerrainHeight(ax, az);

      const arch = new THREE.Group();
      arch.position.set(ax, ay, az);
      arch.lookAt(lm.x, ay, lm.z);

      for (const sx of [-1.7, 1.7]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 4.4, 8), stoneMat);
        col.position.set(sx, 2.2, 0);
        col.castShadow = true;
        arch.add(col);
      }
      const span = createSunlitArchSpan(3.4, stoneMat, false);
      span.position.y = 4.2;
      arch.add(span);

      const chime = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.32, 0),
        new THREE.MeshStandardMaterial({ color: 0x7fd4ff, emissive: 0x4caae8, emissiveIntensity: 0.7 }),
      );
      chime.position.set(0, 4.0, 0);
      arch.add(chime);
      windChimes.push(chime);
      group.add(arch);
    }
  }

  // 7B. North: Sunken Sun-Ruins (Mossy Golden Temple Courtyard & Emerald Obelisks)
  {
    const lm = LANDMARK_BY_ID.lich;
    const ruinDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(12.0, 12.6, 0.18, 40),
      floorMat,
    );
    ruinDisc.position.set(lm.x, lm.baseHeight - 0.02, lm.z);
    ruinDisc.receiveShadow = true;
    group.add(ruinDisc);

    const obeliskMat = new THREE.MeshStandardMaterial({
      color: 0x3a6155,
      roughness: 0.55,
      metalness: 0.25,
    });
    const jadeMat = new THREE.MeshStandardMaterial({
      color: 0x45e0a5,
      emissive: 0x26b07c,
      emissiveIntensity: 0.9,
    });

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const px = lm.x + Math.cos(a) * 14.2;
      const pz = lm.z + Math.sin(a) * 14.2;
      const py = getTerrainHeight(px, pz);

      const col = new THREE.Group();
      col.position.set(px, py, pz);
      const h = i % 2 === 0 ? 5.6 : 3.8;
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.95, h, 0.95), obeliskMat);
      shaft.position.y = h * 0.5;
      shaft.castShadow = true;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.68, 1.1, 4), jadeMat);
      cap.position.y = h + 0.55;
      cap.rotation.y = Math.PI / 4;
      col.add(shaft, cap);
      group.add(col);
    }
  }

  // 7C. Northeast: Skyridge Peak (Warm Amber Pillars & Sunlit Wind Rings)
  {
    const lm = LANDMARK_BY_ID.dragon;
    const peakMat = new THREE.MeshStandardMaterial({
      color: 0xdab276,
      map: pillarTex.map,
      bumpMap: pillarTex.bumpMap,
      roughness: 0.72,
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = lm.x + Math.cos(a) * 14.5;
      const pz = lm.z + Math.sin(a) * 14.5;
      const py = getTerrainHeight(px, pz);

      const pillar = new THREE.Group();
      pillar.position.set(px, py, pz);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.62, 5.2, 6), peakMat);
      shaft.position.y = 2.6;
      shaft.castShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 6, 20), goldMat);
      ring.position.y = 5.4;
      pillar.add(shaft, ring);
      windChimes.push(ring);
      group.add(pillar);
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

  // Bright Fantasy Adventurer / Spellblade Palette
  const mithrilMat = new THREE.MeshStandardMaterial({
    color: 0xdce4f0,
    roughness: 0.28,
    metalness: 0.76,
  });
  const ivoryTunicMat = new THREE.MeshStandardMaterial({
    color: 0xf4efe2,
    roughness: 0.65,
    metalness: 0.08,
  });
  const azureCloakMat = new THREE.MeshStandardMaterial({
    color: 0x2670ba,
    roughness: 0.62,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const leatherMat = new THREE.MeshStandardMaterial({
    color: 0x5c3c28,
    roughness: 0.72,
    metalness: 0.12,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xe6be68,
    roughness: 0.25,
    metalness: 0.85,
    emissive: 0x6b4b14,
    emissiveIntensity: 0.3,
  });
  const sigilGlowMat = new THREE.MeshStandardMaterial({
    color: 0x6dd5ff,
    emissive: 0x5ca9e6,
    emissiveIntensity: 1.35,
    roughness: 0.18,
    metalness: 0.35,
  });

  // Articulated Adventurer Legs
  const buildLeg = (xOffset: number): THREE.Group => {
    const legPivot = new THREE.Group();
    legPivot.position.set(xOffset, 0.88, 0);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.42, 8), ivoryTunicMat);
    thigh.position.y = -0.2;
    thigh.castShadow = true;
    legPivot.add(thigh);

    const knee = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), goldMat);
    knee.position.set(0, -0.42, 0.05);
    legPivot.add(knee);

    const greave = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.44, 8), leatherMat);
    greave.position.y = -0.64;
    greave.castShadow = true;
    legPivot.add(greave);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.26), leatherMat);
    boot.position.set(0, -0.83, 0.05);
    boot.castShadow = true;
    legPivot.add(boot);

    return legPivot;
  };

  const legLeft = buildLeg(-0.15);
  const legRight = buildLeg(0.15);
  bodyMeshGroup.add(legLeft, legRight);

  // Azure Adventurer Coat-Tails & Gold Waist Belt
  const tasset = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 0.42, 8, 1, true), azureCloakMat);
  tasset.position.y = 0.78;
  bodyMeshGroup.add(tasset);

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 10), goldMat);
  belt.position.y = 0.95;
  bodyMeshGroup.add(belt);

  // Ivory & Azure Spellblade Tunic + Silver-Gold Breastplate Trim
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.23, 0.66, 8), ivoryTunicMat);
  torso.position.y = 1.26;
  torso.castShadow = true;
  bodyMeshGroup.add(torso);

  const chestRidge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.34), goldMat);
  chestRidge.position.set(0, 1.28, 0.06);
  bodyMeshGroup.add(chestRidge);

  // Flowing Azure Traveler Cape
  const cloakPivot = new THREE.Group();
  cloakPivot.position.set(0, 1.54, -0.18);
  bodyMeshGroup.add(cloakPivot);

  const capeGeo = new THREE.PlaneGeometry(0.84, 1.28, 4, 6);
  const capePos = capeGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < capePos.count; i++) {
    const x = capePos.getX(i);
    const y = capePos.getY(i);
    const t = (0.64 - y) / 1.28;
    capePos.setX(i, x * (0.55 + t * 0.65));
    capePos.setZ(i, -t * 0.16 + Math.abs(x) * 0.06);
  }
  capeGeo.computeVertexNormals();
  const capeMesh = new THREE.Mesh(capeGeo, azureCloakMat);
  capeMesh.position.set(0, -0.62, -0.04);
  capeMesh.rotation.x = 0.18;
  capeMesh.castShadow = true;
  cloakPivot.add(capeMesh);

  // Adventurer Head / Circlet Hood & Luminous Eyes
  const helmGroup = new THREE.Group();
  helmGroup.position.y = 1.76;
  bodyMeshGroup.add(helmGroup);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xf4d8c0, roughness: 0.6 }),
  );
  head.castShadow = true;
  helmGroup.add(head);

  const hairHood = new THREE.Mesh(new THREE.SphereGeometry(0.225, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.65), azureCloakMat);
  hairHood.rotation.x = -0.32;
  hairHood.position.y = 0.02;
  helmGroup.add(hairHood);

  const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.025, 6, 20), goldMat);
  circlet.rotation.x = Math.PI * 0.45;
  circlet.position.y = 0.06;
  helmGroup.add(circlet);

  const visorGlow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.08), sigilGlowMat);
  visorGlow.position.set(0, 0.01, 0.18);
  helmGroup.add(visorGlow);

  // Twin Rotating Sun-Gold Astrolabe Halos behind back
  const astrolabeRing = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.024, 8, 40), goldMat);
  astrolabeRing.position.set(0, 1.44, -0.34);
  bodyMeshGroup.add(astrolabeRing);

  const outerHaloRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.018, 8, 48), sigilGlowMat);
  outerHaloRing.position.set(0, 1.44, -0.36);
  bodyMeshGroup.add(outerHaloRing);

  // Articulated Arms & Gold-Mithril Pauldrons
  const buildArm = (side: number): THREE.Group => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.38, 1.5, 0);

    const pauldron = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6),
      goldMat,
    );
    pauldron.rotation.z = side * -0.35;
    pauldron.castShadow = true;
    arm.add(pauldron);

    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.34, 8), azureCloakMat);
    upperArm.position.y = -0.18;
    arm.add(upperArm);

    const gauntlet = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.065, 0.32, 8), mithrilMat);
    gauntlet.position.set(0, -0.46, 0.06);
    gauntlet.rotation.x = -0.25;
    arm.add(gauntlet);

    return arm;
  };

  const armLeft = buildArm(-1);
  const armRight = buildArm(1);
  bodyMeshGroup.add(armLeft, armRight);

  // Radiant Runeblade
  const bladePivot = new THREE.Group();
  bladePivot.position.set(0, -0.58, 0.14);
  armRight.add(bladePivot);

  const buildSwordMesh = (): THREE.Group => {
    const sword = new THREE.Group();

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.28, 8), leatherMat);
    grip.position.y = -0.05;
    sword.add(grip);

    const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), goldMat);
    pommel.position.y = -0.21;
    sword.add(pommel);

    const crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.065, 0.09), goldMat);
    crossguard.position.y = 0.09;
    sword.add(crossguard);

    const bladeMain = new THREE.Mesh(new THREE.ConeGeometry(0.095, 1.48, 4), mithrilMat);
    bladeMain.scale.set(0.45, 1, 1.0);
    bladeMain.position.y = 0.84;
    bladeMain.castShadow = true;
    sword.add(bladeMain);

    const fullerGlow = new THREE.Mesh(new THREE.BoxGeometry(0.026, 1.15, 0.058), sigilGlowMat);
    fullerGlow.position.y = 0.68;
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

  // Daytime stylized adventure palettes
  const primaryMat = new THREE.MeshStandardMaterial({
    color: id === 'witch' ? 0x4558b8 : id === 'lich' ? 0x3b6355 : 0xbd4a2e,
    roughness: 0.42,
    metalness: 0.32,
    side: THREE.DoubleSide,
  });
  const trimGoldMat = new THREE.MeshStandardMaterial({
    color: 0xe6be68,
    roughness: 0.28,
    metalness: 0.82,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: cfg.accentColor,
    emissive: cfg.accentColor,
    emissiveIntensity: 1.3,
    roughness: 0.2,
    metalness: 0.45,
  });

  let coreMesh: THREE.Mesh;
  let wingLeft: THREE.Object3D | undefined;
  let wingRight: THREE.Object3D | undefined;

  if (id === 'witch') {
    // Vespera, Astral Sylvan Witch
    const lowerGown = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.38, 2.35, 14, 1, true), primaryMat);
    lowerGown.position.y = 1.25;
    lowerGown.castShadow = true;
    bodyGroup.add(lowerGown);

    const hemGlow = new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.035, 8, 36), accentMat);
    hemGlow.rotation.x = Math.PI / 2;
    hemGlow.position.y = 0.09;
    bodyGroup.add(hemGlow);

    const bodice = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.44, 0.95, 10), primaryMat);
    bodice.position.y = 2.65;
    bodyGroup.add(bodice);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 8, 20), trimGoldMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 3.12;
    bodyGroup.add(collar);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xf7efe4, roughness: 0.42 }),
    );
    head.position.y = 3.38;
    bodyGroup.add(head);

    for (const ex of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), accentMat);
      eye.position.set(ex, 3.39, 0.23);
      bodyGroup.add(eye);
    }

    const hatBrim = new THREE.Mesh(new THREE.ConeGeometry(1.18, 0.16, 20), primaryMat);
    hatBrim.position.y = 3.64;
    hatBrim.rotation.x = -0.1;
    bodyGroup.add(hatBrim);

    const hatCrown = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.35, 16), primaryMat);
    hatCrown.position.set(-0.08, 4.25, -0.05);
    hatCrown.rotation.z = -0.22;
    bodyGroup.add(hatCrown);

    const hatAstrolabe = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.025, 8, 36), trimGoldMat);
    hatAstrolabe.position.y = 3.72;
    hatAstrolabe.rotation.set(Math.PI * 0.44, 0.18, 0);
    bodyGroup.add(hatAstrolabe);

    for (const side of [-1, 1]) {
      const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 2.2), accentMat);
      ribbon.position.set(side * 0.58, 2.1, -0.35);
      ribbon.rotation.z = side * 0.14;
      bodyGroup.add(ribbon);
      veilRibbons.push(ribbon);
    }

    const staff = new THREE.Group();
    staff.position.set(0.85, 2.1, 0.45);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.6, 8), trimGoldMat);
    staff.add(pole);
    const crescent = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.04, 8, 20, Math.PI * 1.45), accentMat);
    crescent.position.y = 1.95;
    crescent.rotation.z = 0.6;
    staff.add(crescent);
    bodyGroup.add(staff);

    coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), accentMat);
    coreMesh.position.set(0, 2.6, 0.46);
    bodyGroup.add(coreMesh);

    for (let i = 0; i < 3; i++) {
      const orbGroup = new THREE.Group();
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), accentMat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.018, 6, 20), trimGoldMat);
      ring.rotation.x = Math.PI * 0.35;
      orbGroup.add(crystal, ring);
      bodyGroup.add(orbGroup);
      orbitParts.push(orbGroup);
    }
  } else if (id === 'lich') {
    // Malakor, Ancient Ruin Lich
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.35, 2.9, 10, 1, true), primaryMat);
    shroud.position.y = 1.5;
    shroud.castShadow = true;
    bodyGroup.add(shroud);

    for (let r = 0; r < 4; r++) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(0.42 - r * 0.03, 0.045, 6, 12, Math.PI * 1.35),
        trimGoldMat,
      );
      rib.position.y = 2.4 + r * 0.22;
      rib.rotation.set(Math.PI / 2, 0, -Math.PI * 0.18);
      bodyGroup.add(rib);
    }

    for (const side of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.95, 5), primaryMat);
      pauldron.position.set(side * 0.85, 3.2, 0);
      pauldron.rotation.z = side * -0.95;
      bodyGroup.add(pauldron);
    }

    const skullMat = new THREE.MeshStandardMaterial({ color: 0xebe3d0, roughness: 0.5 });
    const skull = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36, 0), skullMat);
    skull.position.y = 3.72;
    bodyGroup.add(skull);

    for (const ex of [-0.11, 0.11]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), accentMat);
      eye.position.set(ex, 3.74, 0.3);
      bodyGroup.add(eye);
    }

    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 10), trimGoldMat);
    crown.position.y = 4.02;
    crown.rotation.x = Math.PI / 2;
    bodyGroup.add(crown);

    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.42, 4), trimGoldMat);
      spike.position.set(Math.cos(a) * 0.4, 4.24, Math.sin(a) * 0.4);
      bodyGroup.add(spike);
    }

    coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), accentMat);
    coreMesh.position.set(0, 2.75, 0.28);
    bodyGroup.add(coreMesh);

    for (let i = 0; i < 4; i++) {
      const obelisk = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.55, 0.32), primaryMat);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 4), accentMat);
      tip.position.y = 1.02;
      tip.rotation.y = Math.PI * 0.25;
      obelisk.add(shaft, tip);
      bodyGroup.add(obelisk);
      orbitParts.push(obelisk);
    }
  } else {
    // Vaelorath, Skyridge Wyrm
    const scaleMat = primaryMat;
    const wingMembraneMat = new THREE.MeshStandardMaterial({
      color: 0xe68438,
      emissive: 0x8a3d12,
      emissiveIntensity: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.52,
      transparent: true,
      opacity: 0.9,
    });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 2.0, 8, 12), scaleMat);
    torso.rotation.x = Math.PI * 0.42;
    torso.position.set(0, 2.0, -0.1);
    torso.castShadow = true;
    bodyGroup.add(torso);

    coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), accentMat);
    coreMesh.position.set(0, 2.05, 0.65);
    bodyGroup.add(coreMesh);

    let parentObj: THREE.Object3D = bodyGroup;
    const neckPositions = [
      new THREE.Vector3(0, 2.55, 0.95),
      new THREE.Vector3(0, 0.62, 0.42),
      new THREE.Vector3(0, 0.58, 0.45),
    ];
    for (let i = 0; i < 3; i++) {
      const segPivot = new THREE.Group();
      segPivot.position.copy(neckPositions[i]);
      const segMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32 - i * 0.04, 0.42 - i * 0.04, 0.85, 8),
        scaleMat,
      );
      segMesh.rotation.x = 0.55 - i * 0.15;
      segMesh.castShadow = true;
      segPivot.add(segMesh);
      parentObj.add(segPivot);
      neckSegments.push(segPivot);
      parentObj = segPivot;
    }

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.45, 0.48);
    const skull = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.35, 6), scaleMat);
    skull.rotation.x = Math.PI * 0.52;
    headGroup.add(skull);

    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.95), trimGoldMat);
    jaw.position.set(0, -0.16, 0.25);
    headGroup.add(jaw);

    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.11, 1.05, 5), trimGoldMat);
      horn.position.set(side * 0.26, 0.25, -0.35);
      horn.rotation.set(-0.85, side * 0.2, side * -0.25);
      headGroup.add(horn);

      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), accentMat);
      eye.position.set(side * 0.2, 0.1, 0.28);
      headGroup.add(eye);
    }
    parentObj.add(headGroup);

    const buildWing = (side: number): THREE.Group => {
      const wing = new THREE.Group();
      wing.position.set(side * 0.55, 2.55, 0.1);

      const armBone = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.1, 6), scaleMat);
      armBone.rotation.z = side * -1.15;
      armBone.position.set(side * 0.95, 0.45, -0.1);
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
        const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, len, 5), trimGoldMat);
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

    let tailParent: THREE.Object3D = bodyGroup;
    for (let t = 0; t < 5; t++) {
      const seg = new THREE.Group();
      seg.position.set(0, t === 0 ? 1.45 : -0.12, t === 0 ? -1.2 : -0.82);
      const radius = 0.38 - t * 0.06;
      const piece = new THREE.Mesh(new THREE.ConeGeometry(radius, 0.98, 6), scaleMat);
      piece.rotation.x = -Math.PI * 0.52;
      piece.position.z = -0.42;
      seg.add(piece);

      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 4), accentMat);
      spike.position.set(0, radius + 0.1, -0.35);
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
