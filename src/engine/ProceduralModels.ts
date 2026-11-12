import * as THREE from 'three';
import { BOSS_CONFIGS, BOSS_ORDER, type BossId } from '../bosses/bossDefinitions';
import { evaluateExactDerivative, evaluateTrig, type TrigFunctionId } from '../math/trigDerivatives';
import {
  getFloorStoneTextures,
  getPillarStoneTextures,
  getSoftGlowTexture,
} from './ProceduralTextures';
import {
  createFogGateMaterial,
  createSkyDomeMaterial,
  createWardShellMaterial,
} from './Shaders';

export interface FogGateVisual {
  readonly bossId: BossId;
  readonly group: THREE.Group;
  readonly curtainMat: THREE.ShaderMaterial;
  readonly position: THREE.Vector3;
}

export interface ArenaBundle {
  readonly group: THREE.Group;
  readonly fogGates: FogGateVisual[];
  readonly emberPoints: THREE.Points;
  readonly emberBasePositions: Float32Array;
  readonly floorMaterial: THREE.MeshStandardMaterial;
  readonly skyMat: THREE.ShaderMaterial;
  readonly brazierFlames: THREE.Object3D[];
  readonly setEmberCount: (count: number) => void;
  readonly setSkyMood: (zenith: number, horizon: number, moon: number) => void;
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

export const ARENA_RADIUS = 21.5;

function createGothicArchSpan(
  spanWidth: number,
  stoneMat: THREE.Material,
  broken: boolean,
): THREE.Group {
  const arch = new THREE.Group();
  const half = spanWidth * 0.5;
  const steps = broken ? 7 : 15;

  for (let i = 0; i < steps; i++) {
    if (broken && (i === 5 || i === 6)) continue;
    const t = i / 14;
    const angle = t * Math.PI;
    // Continuous pointed gothic lancet arch anchored cleanly onto column capitals
    const x = -Math.cos(angle) * half;
    const y = Math.sin(angle) * 2.8 + (1 - Math.abs(t - 0.5) * 2) * 0.75;
    const block = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.82, 1.05), stoneMat);
    block.position.set(x, y, 0);
    block.rotation.z = (t - 0.5) * -1.35;
    block.castShadow = true;
    arch.add(block);
  }
  return arch;
}

export function createArenaEnvironment(): ArenaBundle {
  const group = new THREE.Group();
  const floorTex = getFloorStoneTextures();
  const pillarTex = getPillarStoneTextures();
  const glowTex = getSoftGlowTexture();

  // Astral Cathedral Sky Dome (eliminates empty black void)
  const skyMat = createSkyDomeMaterial();
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(94, 36, 24), skyMat);
  group.add(skyDome);

  // Distant jagged obsidian cathedral spires & cliff silhouettes beyond the sanctuary
  const silhouetteMat = new THREE.MeshStandardMaterial({
    color: 0x0f1119,
    roughness: 0.95,
    metalness: 0.05,
  });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + 0.12;
    const dist = 39 + (i % 3) * 8;
    const h = 14 + ((i * 11) % 18);
    const w = 3.2 + (i % 4) * 1.4;
    const spire = new THREE.Mesh(new THREE.ConeGeometry(w, h, 5), silhouetteMat);
    spire.position.set(Math.cos(a) * dist, h * 0.35 - 5, Math.sin(a) * dist);
    spire.rotation.y = a;
    group.add(spire);
  }

  // Main textured obsidian flagstone sanctuary platform
  const floorGeo = new THREE.CylinderGeometry(ARENA_RADIUS + 1.5, ARENA_RADIUS + 2.8, 1.4, 64);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorTex.map,
    bumpMap: floorTex.bumpMap,
    bumpScale: 0.06,
    roughnessMap: floorTex.roughnessMap,
    roughness: 0.85,
    metalness: 0.18,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -0.7;
  floor.receiveShadow = true;
  group.add(floor);

  // Raised sanctuary outer dais curb & carved stone balustrade blocks
  const curbMat = new THREE.MeshStandardMaterial({
    color: 0x2b2e3a,
    map: pillarTex.map,
    bumpMap: pillarTex.bumpMap,
    bumpScale: 0.04,
    roughness: 0.82,
    metalness: 0.16,
  });
  const outerCurb = new THREE.Mesh(
    new THREE.TorusGeometry(ARENA_RADIUS + 1.25, 0.42, 8, 64),
    curbMat,
  );
  outerCurb.rotation.x = Math.PI / 2;
  outerCurb.position.y = 0.08;
  outerCurb.receiveShadow = true;
  group.add(outerCurb);

  // Concentric tarnished-brass astrolabe rings embedded in the floor
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xc8a464,
    roughness: 0.36,
    metalness: 0.82,
    emissive: 0x5c3e12,
    emissiveIntensity: 0.55,
  });
  for (const r of [5.5, 11.5, 18.0]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.09, r + 0.09, 64), brassMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.018;
    ring.receiveShadow = true;
    group.add(ring);
  }

  // Sculpted Gothic Columns + Broken Lancets + Flickering Fire Braziers
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xd0d4e2,
    map: pillarTex.map,
    bumpMap: pillarTex.bumpMap,
    bumpScale: 0.06,
    roughness: 0.84,
    metalness: 0.12,
  });
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffb347,
    transparent: true,
    opacity: 0.92,
  });

  const brazierFlames: THREE.Object3D[] = [];
  const pillarCount = 12;
  const pillarPositions: THREE.Vector3[] = [];

  for (let i = 0; i < pillarCount; i++) {
    const angle = (i / pillarCount) * Math.PI * 2;
    const px = Math.cos(angle) * (ARENA_RADIUS + 0.65);
    const pz = Math.sin(angle) * (ARENA_RADIUS + 0.65);
    const height = 7.4 + (i % 2 === 0 ? 1.8 : 0.4);
    pillarPositions.push(new THREE.Vector3(px, height, pz));

    const pillar = new THREE.Group();
    pillar.position.set(px, 0, pz);
    pillar.lookAt(0, 0, 0);

    // Stepped plinth base
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 2.2), stoneMat);
    plinth.position.y = 0.37;
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    pillar.add(plinth);

    // Fluted 8-sided gothic column shaft
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.82, height, 8), stoneMat);
    shaft.position.y = height * 0.5 + 0.5;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    pillar.add(shaft);

    // Buttress ribs on the sides of each column
    for (const side of [-0.62, 0.62]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.24, height * 0.88, 0.35), stoneMat);
      rib.position.set(side, height * 0.45 + 0.4, 0.32);
      pillar.add(rib);
    }

    // Carved gothic capital & abacus
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.75, 0.75, 8), stoneMat);
    cap.position.y = height + 0.65;
    cap.castShadow = true;
    pillar.add(cap);

    // Wall-mounted iron brazier with glowing ember flame & halo sprite
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.22, 0.32, 8), brassMat);
    bowl.position.set(0, 2.55, 0.92);
    pillar.add(bowl);

    const flameGroup = new THREE.Group();
    flameGroup.position.set(0, 2.86, 0.92);

    const flameCone = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.62, 6), flameMat);
    flameGroup.add(flameCone);

    const haloMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffaa44,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(2.1, 2.1, 1);
    flameGroup.add(halo);

    pillar.add(flameGroup);
    brazierFlames.push(flameGroup);

    group.add(pillar);
  }

  // Ruined Gothic Arches spanning between adjacent sanctuary columns
  for (let i = 0; i < pillarCount; i++) {
    // Leave gaps directly behind the 3 Fog Gates for dramatic framing
    if (i === 7 || i === 9 || i === 10) continue;
    const p1 = pillarPositions[i];
    const p2 = pillarPositions[(i + 1) % pillarCount];
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    const span = p1.distanceTo(p2);
    const arch = createGothicArchSpan(span, stoneMat, i % 3 === 1);
    arch.position.set(mid.x, Math.min(p1.y, p2.y) + 0.55, mid.z);
    arch.lookAt(0, arch.position.y, 0);
    group.add(arch);
  }

  // 3 Elden Ring-style Boss Fog Gates in the Sanctuary Hub
  const fogGates: FogGateVisual[] = [];
  for (const id of BOSS_ORDER) {
    const cfg = BOSS_CONFIGS[id];
    const gateGroup = new THREE.Group();
    gateGroup.position.set(cfg.fogGatePosition.x, 0, cfg.fogGatePosition.z);
    gateGroup.lookAt(0, 0, 0);

    for (const sx of [-1.85, 1.85]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.6, 0.95), stoneMat);
      base.position.set(sx, 0.3, 0);
      gateGroup.add(base);

      const post = new THREE.Mesh(new THREE.BoxGeometry(0.65, 5.0, 0.7), stoneMat);
      post.position.set(sx, 2.6, 0);
      post.castShadow = true;
      gateGroup.add(post);

      const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), brassMat);
      finial.position.set(sx, 5.35, 0);
      gateGroup.add(finial);
    }

    // Pointed gothic gate lintel
    const archLeft = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.6, 0.85), stoneMat);
    archLeft.position.set(-1.0, 5.35, 0);
    archLeft.rotation.z = 0.36;
    gateGroup.add(archLeft);

    const archRight = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.6, 0.85), stoneMat);
    archRight.position.set(1.0, 5.35, 0);
    archRight.rotation.z = -0.36;
    gateGroup.add(archRight);

    const curtainMat = createFogGateMaterial(cfg.accentColor);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 4.75, 1, 1), curtainMat);
    curtain.position.set(0, 2.45, 0);
    gateGroup.add(curtain);

    const pedestalRing = new THREE.Mesh(
      new THREE.RingGeometry(1.45, 1.72, 36),
      new THREE.MeshBasicMaterial({ color: cfg.accentColor, side: THREE.DoubleSide }),
    );
    pedestalRing.rotation.x = -Math.PI / 2;
    pedestalRing.position.set(0, 0.035, 1.45);
    gateGroup.add(pedestalRing);

    group.add(gateGroup);
    fogGates.push({
      bossId: id,
      group: gateGroup,
      curtainMat,
      position: new THREE.Vector3(cfg.fogGatePosition.x, 0, cfg.fogGatePosition.z),
    });
  }

  // Luminous soft radial embers (not square blocks!)
  const maxEmbers = 260;
  const emberPositions = new Float32Array(maxEmbers * 3);
  const emberBase = new Float32Array(maxEmbers * 3);
  for (let i = 0; i < maxEmbers; i++) {
    const r = Math.sqrt((i + 0.5) / maxEmbers) * ARENA_RADIUS;
    const a = i * 2.39996;
    const x = Math.cos(a) * r;
    const y = 0.3 + ((i * 17) % 100) * 0.09;
    const z = Math.sin(a) * r;
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
    color: 0xffcf7a,
    size: 0.48,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const emberPoints = new THREE.Points(emberGeo, emberMat);
  group.add(emberPoints);

  return {
    group,
    fogGates,
    emberPoints,
    emberBasePositions: emberBase,
    floorMaterial: floorMat,
    skyMat,
    brazierFlames,
    setEmberCount: (count: number) => {
      emberGeo.setDrawRange(0, Math.max(0, Math.min(maxEmbers, count)));
    },
    setSkyMood: (zenith: number, horizon: number, moon: number) => {
      skyMat.uniforms.uZenith.value.setHex(zenith);
      skyMat.uniforms.uHorizon.value.setHex(horizon);
      skyMat.uniforms.uMoonColor.value.setHex(moon);
    },
  };
}

export function createPlayerModel(): PlayerRig {
  const root = new THREE.Group();
  const bodyMeshGroup = new THREE.Group();
  root.add(bodyMeshGroup);

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x3b4052,
    roughness: 0.34,
    metalness: 0.82,
  });
  const darkIronMat = new THREE.MeshStandardMaterial({
    color: 0x1d202b,
    roughness: 0.55,
    metalness: 0.65,
  });
  const cloakMat = new THREE.MeshStandardMaterial({
    color: 0x5c1922,
    roughness: 0.78,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd4ae68,
    roughness: 0.28,
    metalness: 0.88,
    emissive: 0x52370c,
    emissiveIntensity: 0.45,
  });
  const sigilGlowMat = new THREE.MeshStandardMaterial({
    color: 0x9be2ff,
    emissive: 0x7fb8d8,
    emissiveIntensity: 1.65,
    roughness: 0.15,
    metalness: 0.4,
  });

  // Articulated Armored Legs
  const buildLeg = (xOffset: number): THREE.Group => {
    const legPivot = new THREE.Group();
    legPivot.position.set(xOffset, 0.88, 0);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.42, 8), darkIronMat);
    thigh.position.y = -0.2;
    thigh.castShadow = true;
    legPivot.add(thigh);

    const knee = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), brassMat);
    knee.position.set(0, -0.42, 0.05);
    legPivot.add(knee);

    const greave = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.44, 8), steelMat);
    greave.position.y = -0.64;
    greave.castShadow = true;
    legPivot.add(greave);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.26), darkIronMat);
    boot.position.set(0, -0.83, 0.05);
    boot.castShadow = true;
    legPivot.add(boot);

    return legPivot;
  };

  const legLeft = buildLeg(-0.15);
  const legRight = buildLeg(0.15);
  bodyMeshGroup.add(legLeft, legRight);

  // Tattered Armored Tassets & Waist Belt
  const tasset = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 0.42, 8, 1, true), cloakMat);
  tasset.position.y = 0.78;
  bodyMeshGroup.add(tasset);

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 10), brassMat);
  belt.position.y = 0.95;
  bodyMeshGroup.add(belt);

  // Fluted Gothic Cuirass (Chestplate)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.23, 0.66, 8), steelMat);
  torso.position.y = 1.26;
  torso.castShadow = true;
  bodyMeshGroup.add(torso);

  const chestRidge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.34), brassMat);
  chestRidge.position.set(0, 1.28, 0.06);
  bodyMeshGroup.add(chestRidge);

  // Flowing Split Cape behind shoulders
  const cloakPivot = new THREE.Group();
  cloakPivot.position.set(0, 1.54, -0.18);
  bodyMeshGroup.add(cloakPivot);

  const capeGeo = new THREE.PlaneGeometry(0.82, 1.28, 4, 6);
  const capePos = capeGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < capePos.count; i++) {
    const x = capePos.getX(i);
    const y = capePos.getY(i);
    // Taper narrow at shoulders, flare at bottom
    const t = (0.64 - y) / 1.28;
    capePos.setX(i, x * (0.55 + t * 0.65));
    capePos.setZ(i, -t * 0.16 + Math.abs(x) * 0.06);
  }
  capeGeo.computeVertexNormals();
  const capeMesh = new THREE.Mesh(capeGeo, cloakMat);
  capeMesh.position.set(0, -0.62, -0.04);
  capeMesh.rotation.x = 0.18;
  capeMesh.castShadow = true;
  cloakPivot.add(capeMesh);

  // Crested Knight Helm with Glowing Visor & Horns/Plume
  const helmGroup = new THREE.Group();
  helmGroup.position.y = 1.76;
  bodyMeshGroup.add(helmGroup);

  const helm = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 1), steelMat);
  helm.scale.set(0.92, 1.12, 1.05);
  helm.castShadow = true;
  helmGroup.add(helm);

  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.36), brassMat);
  crest.position.set(0, 0.18, -0.02);
  helmGroup.add(crest);

  const visorGlow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.12), sigilGlowMat);
  visorGlow.position.set(0, 0.01, 0.17);
  helmGroup.add(visorGlow);

  // Twin Rotating Brass Astrolabe Halos floating behind back
  const astrolabeRing = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.024, 8, 40), brassMat);
  astrolabeRing.position.set(0, 1.44, -0.34);
  bodyMeshGroup.add(astrolabeRing);

  const outerHaloRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.016, 8, 48), sigilGlowMat);
  outerHaloRing.position.set(0, 1.44, -0.36);
  bodyMeshGroup.add(outerHaloRing);

  // Articulated Arms & Layered Pauldrons
  const buildArm = (side: number): THREE.Group => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.38, 1.5, 0);

    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), brassMat);
    pauldron.rotation.z = side * -0.35;
    pauldron.castShadow = true;
    arm.add(pauldron);

    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.34, 8), darkIronMat);
    upperArm.position.y = -0.18;
    arm.add(upperArm);

    const gauntlet = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.065, 0.32, 8), steelMat);
    gauntlet.position.set(0, -0.46, 0.06);
    gauntlet.rotation.x = -0.25;
    arm.add(gauntlet);

    return arm;
  };

  const armLeft = buildArm(-1);
  const armRight = buildArm(1);
  bodyMeshGroup.add(armLeft, armRight);

  // Sculpted Resonance Runeblade attached to right arm/bladePivot
  const bladePivot = new THREE.Group();
  bladePivot.position.set(0, -0.58, 0.14);
  armRight.add(bladePivot);

  const buildSwordMesh = (): THREE.Group => {
    const sword = new THREE.Group();

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.28, 8), darkIronMat);
    grip.position.y = -0.05;
    sword.add(grip);

    const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), brassMat);
    pommel.position.y = -0.21;
    sword.add(pommel);

    const crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.065, 0.09), brassMat);
    crossguard.position.y = 0.09;
    sword.add(crossguard);

    // Tapered diamond-profile blade + glowing runic core fuller
    const bladeMain = new THREE.Mesh(new THREE.ConeGeometry(0.095, 1.48, 4), steelMat);
    bladeMain.scale.set(0.45, 1, 1.0);
    bladeMain.position.y = 0.84;
    bladeMain.castShadow = true;
    sword.add(bladeMain);

    const fullerGlow = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1.15, 0.055), sigilGlowMat);
    fullerGlow.position.y = 0.68;
    sword.add(fullerGlow);

    return sword;
  };

  const thirdPersonSword = buildSwordMesh();
  thirdPersonSword.rotation.x = Math.PI * 0.36;
  bladePivot.add(thirdPersonSword);

  // Upgraded 1st-Person Viewmodel: Runeblade on Right + Arcane Astrolabe Focus on Left
  const firstPersonBlade = new THREE.Group();

  const fpSword = buildSwordMesh();
  fpSword.scale.setScalar(0.68);
  fpSword.position.set(0.38, -0.34, -0.62);
  fpSword.rotation.set(-0.42, 0.25, 0.28);
  firstPersonBlade.add(fpSword);

  // Off-hand floating brass astrolabe focus on the left side of screen
  const fpFocus = new THREE.Group();
  fpFocus.position.set(-0.36, -0.26, -0.58);
  const fpAstrolabeRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 28), brassMat);
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

  const darkMat = new THREE.MeshStandardMaterial({
    color: id === 'witch' ? 0x262142 : id === 'lich' ? 0x1e2c28 : 0x331d1d,
    roughness: 0.45,
    metalness: 0.45,
    side: THREE.DoubleSide,
  });
  const trimBrassMat = new THREE.MeshStandardMaterial({
    color: 0xc8a464,
    roughness: 0.32,
    metalness: 0.85,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: cfg.accentColor,
    emissive: cfg.accentColor,
    emissiveIntensity: 1.6,
    roughness: 0.2,
    metalness: 0.5,
  });

  let coreMesh: THREE.Mesh;
  let wingLeft: THREE.Object3D | undefined;
  let wingRight: THREE.Object3D | undefined;

  if (id === 'witch') {
    // Vespera, Witch of the Sine Hollow — Towering Celestial Sorceress
    const lowerGown = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.38, 2.35, 14, 1, true), darkMat);
    lowerGown.position.y = 1.25;
    lowerGown.castShadow = true;
    bodyGroup.add(lowerGown);

    const hemGlow = new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.035, 8, 36), accentMat);
    hemGlow.rotation.x = Math.PI / 2;
    hemGlow.position.y = 0.09;
    bodyGroup.add(hemGlow);

    const bodice = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.44, 0.95, 10), darkMat);
    bodice.position.y = 2.65;
    bodyGroup.add(bodice);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 8, 20), trimBrassMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 3.12;
    bodyGroup.add(collar);

    // Porcelain masked visage + glowing eyes
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xd8d2e6, roughness: 0.4 }),
    );
    head.position.y = 3.38;
    bodyGroup.add(head);

    for (const ex of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), accentMat);
      eye.position.set(ex, 3.39, 0.23);
      bodyGroup.add(eye);
    }

    // Dramatic wide occult witch hat encircled by a brass astrolabe ring
    const hatBrim = new THREE.Mesh(new THREE.ConeGeometry(1.18, 0.16, 20), darkMat);
    hatBrim.position.y = 3.64;
    hatBrim.rotation.x = -0.1;
    bodyGroup.add(hatBrim);

    const hatCrown = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.35, 16), darkMat);
    hatCrown.position.set(-0.08, 4.25, -0.05);
    hatCrown.rotation.z = -0.22;
    bodyGroup.add(hatCrown);

    const hatAstrolabe = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.025, 8, 36), trimBrassMat);
    hatAstrolabe.position.y = 3.72;
    hatAstrolabe.rotation.set(Math.PI * 0.44, 0.18, 0);
    bodyGroup.add(hatAstrolabe);

    // Flowing astral veil ribbons from shoulders
    for (const side of [-1, 1]) {
      const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 2.2), accentMat);
      ribbon.position.set(side * 0.58, 2.1, -0.35);
      ribbon.rotation.z = side * 0.14;
      bodyGroup.add(ribbon);
      veilRibbons.push(ribbon);
    }

    // Crescent Moon Staff in right hand
    const staff = new THREE.Group();
    staff.position.set(0.85, 2.1, 0.45);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.6, 8), trimBrassMat);
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
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.018, 6, 20), trimBrassMat);
      ring.rotation.x = Math.PI * 0.35;
      orbGroup.add(crystal, ring);
      bodyGroup.add(orbGroup);
      orbitParts.push(orbGroup);
    }
  } else if (id === 'lich') {
    // Malakor, Lich of the Asymptote Crypt — Dread Arch-Lich
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.35, 2.9, 10, 1, true), darkMat);
    shroud.position.y = 1.5;
    shroud.castShadow = true;
    bodyGroup.add(shroud);

    // Spiked Iron Ribcage framing glowing emerald phylactery core
    for (let r = 0; r < 4; r++) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(0.42 - r * 0.03, 0.045, 6, 12, Math.PI * 1.35),
        trimBrassMat,
      );
      rib.position.y = 2.4 + r * 0.22;
      rib.rotation.set(Math.PI / 2, 0, -Math.PI * 0.18);
      bodyGroup.add(rib);
    }

    // Broad horned iron pauldrons
    for (const side of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.95, 5), darkMat);
      pauldron.position.set(side * 0.85, 3.2, 0);
      pauldron.rotation.z = side * -0.95;
      bodyGroup.add(pauldron);
    }

    // Horned Lich Skull & Iron Crown
    const skullMat = new THREE.MeshStandardMaterial({ color: 0xcfc7b6, roughness: 0.55 });
    const skull = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36, 0), skullMat);
    skull.position.y = 3.72;
    bodyGroup.add(skull);

    for (const ex of [-0.11, 0.11]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), accentMat);
      eye.position.set(ex, 3.74, 0.3);
      bodyGroup.add(eye);
    }

    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 10), trimBrassMat);
    crown.position.y = 4.02;
    crown.rotation.x = Math.PI / 2;
    bodyGroup.add(crown);

    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.42, 4), trimBrassMat);
      spike.position.set(Math.cos(a) * 0.4, 4.24, Math.sin(a) * 0.4);
      bodyGroup.add(spike);
    }

    coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), accentMat);
    coreMesh.position.set(0, 2.75, 0.28);
    bodyGroup.add(coreMesh);

    // 4 Floating Etched Obelisks
    for (let i = 0; i < 4; i++) {
      const obelisk = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.55, 0.32), darkMat);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 4), accentMat);
      tip.position.y = 1.02;
      tip.rotation.y = Math.PI * 0.25;
      obelisk.add(shaft, tip);
      bodyGroup.add(obelisk);
      orbitParts.push(obelisk);
    }
  } else {
    // Vaelorath, Wyrm of the Hyperbolic Abyss — Articulated Winged Dragon
    const scaleMat = new THREE.MeshStandardMaterial({
      color: 0x3b2020,
      roughness: 0.42,
      metalness: 0.55,
    });
    const wingMembraneMat = new THREE.MeshStandardMaterial({
      color: 0x4d1d17,
      emissive: 0x6b2511,
      emissiveIntensity: 0.55,
      side: THREE.DoubleSide,
      roughness: 0.65,
      transparent: true,
      opacity: 0.92,
    });

    // Armored Torso & Ribbed Chest
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 2.0, 8, 12), scaleMat);
    torso.rotation.x = Math.PI * 0.42;
    torso.position.set(0, 2.0, -0.1);
    torso.castShadow = true;
    bodyGroup.add(torso);

    coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), accentMat);
    coreMesh.position.set(0, 2.05, 0.65);
    bodyGroup.add(coreMesh);

    // Segmented S-curved Neck & Horned Wyrm Skull
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

    // Sculpted Dragon Head + Horns + Glowing Eyes attached to final neck segment
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.45, 0.48);
    const skull = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.35, 6), scaleMat);
    skull.rotation.x = Math.PI * 0.52;
    headGroup.add(skull);

    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.95), darkMat);
    jaw.position.set(0, -0.16, 0.25);
    headGroup.add(jaw);

    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.11, 1.05, 5), trimBrassMat);
      horn.position.set(side * 0.26, 0.25, -0.35);
      horn.rotation.set(-0.85, side * 0.2, side * -0.25);
      headGroup.add(horn);

      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), accentMat);
      eye.position.set(side * 0.2, 0.1, 0.28);
      headGroup.add(eye);
    }
    parentObj.add(headGroup);

    // Articulated Multi-Spar Dragon Wings
    const buildWing = (side: number): THREE.Group => {
      const wing = new THREE.Group();
      wing.position.set(side * 0.55, 2.55, 0.1);

      const armBone = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.1, 6), scaleMat);
      armBone.rotation.z = side * -1.15;
      armBone.position.set(side * 0.95, 0.45, -0.1);
      wing.add(armBone);

      // Multi-panel webbed membrane
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

      // Wing finger spars
      for (const tip of [
        [side * 4.4, 1.35, -0.85],
        [side * 3.1, -0.45, 0.6],
      ]) {
        const dx = tip[0] - side * 1.95;
        const dy = tip[1] - 0.82;
        const dz = tip[2] + 0.18;
        const len = Math.hypot(dx, dy, dz);
        const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, len, 5), trimBrassMat);
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

    // 5-Segment Spiked Sinuous Tail
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
  const lineMat = new THREE.LineBasicMaterial({ color: 0xe6c37a, transparent: true, opacity: 0.95 });
  const curveLine = new THREE.Line(geo, lineMat);
  group.add(curveLine);

  // Secondary parallel line for bolder 3D silhouette readability
  const curveLineGlow = new THREE.Line(geo, lineMat);
  curveLineGlow.position.y = 0.04;
  group.add(curveLineGlow);

  // Tangent slope line segment around theta
  const tanPositions = new Float32Array(6);
  const tanGeo = new THREE.BufferGeometry();
  tanGeo.setAttribute('position', new THREE.BufferAttribute(tanPositions, 3));
  const tanMat = new THREE.LineBasicMaterial({ color: 0xff8a4c, transparent: true, opacity: 1.0 });
  const tanLine = new THREE.Line(tanGeo, tanMat);
  group.add(tanLine);

  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.22, 0),
    new THREE.MeshBasicMaterial({ color: 0xffe094 }),
  );
  group.add(marker);

  const markerHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.38, 0.028, 6, 20),
    new THREE.MeshBasicMaterial({ color: 0xff9b4c }),
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
      const baseHeight = 4.65;

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
