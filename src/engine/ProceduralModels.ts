import * as THREE from 'three';
import { BOSS_CONFIGS, BOSS_ORDER, type BossId } from '../bosses/bossDefinitions';
import { evaluateExactDerivative, evaluateTrig, type TrigFunctionId } from '../math/trigDerivatives';
import { createFogGateMaterial, createWardShellMaterial } from './Shaders';

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
  readonly setEmberCount: (count: number) => void;
}

export interface PlayerRig {
  readonly root: THREE.Group;
  readonly bodyMeshGroup: THREE.Group;
  readonly bladePivot: THREE.Group;
  readonly astrolabeRing: THREE.Mesh;
  readonly firstPersonBlade: THREE.Group;
  readonly setFirstPersonHidden: (isFirstPerson: boolean) => void;
}

export interface BossRig {
  readonly root: THREE.Group;
  readonly wardMesh: THREE.Mesh;
  readonly wardMat: THREE.ShaderMaterial;
  readonly orbitParts: THREE.Object3D[];
  readonly wingLeft?: THREE.Object3D;
  readonly wingRight?: THREE.Object3D;
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

export function createArenaEnvironment(): ArenaBundle {
  const group = new THREE.Group();

  // Main obsidian stone sanctuary floor
  const floorGeo = new THREE.CylinderGeometry(ARENA_RADIUS + 1.5, ARENA_RADIUS + 2.2, 0.8, 48);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x171820,
    roughness: 0.86,
    metalness: 0.15,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -0.4;
  floor.receiveShadow = true;
  group.add(floor);

  // Concentric brass astrolabe inlay rings on the floor
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0x9a7b4f,
    roughness: 0.42,
    metalness: 0.78,
    emissive: 0x2b1e0a,
    emissiveIntensity: 0.35,
  });
  for (const r of [5.5, 11.5, 18.0]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r + 0.08, 64), brassMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.015;
    ring.receiveShadow = true;
    group.add(ring);
  }

  // Ruined gothic obsidian monoliths around the perimeter
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x20222b,
    roughness: 0.9,
    metalness: 0.1,
  });
  const runeMat = new THREE.MeshStandardMaterial({
    color: 0xc8a464,
    emissive: 0xb8822e,
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });

  const pillarCount = 12;
  for (let i = 0; i < pillarCount; i++) {
    const angle = (i / pillarCount) * Math.PI * 2;
    const px = Math.cos(angle) * (ARENA_RADIUS + 0.4);
    const pz = Math.sin(angle) * (ARENA_RADIUS + 0.4);
    const height = 5.5 + ((i * 7) % 4) * 1.3;

    const pillar = new THREE.Group();
    pillar.position.set(px, 0, pz);
    pillar.lookAt(0, 0, 0);

    const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.4, height, 1.4), stoneMat);
    shaft.position.y = height / 2;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    pillar.add(shaft);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.45, 1.85), stoneMat);
    cap.position.y = height + 0.2;
    cap.castShadow = true;
    pillar.add(cap);

    const brazier = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), runeMat);
    brazier.position.set(0, 2.5, 0.78);
    pillar.add(brazier);

    group.add(pillar);
  }

  // 3 Elden Ring-style Boss Fog Gates in the Sanctuary Hub
  const fogGates: FogGateVisual[] = [];
  for (const id of BOSS_ORDER) {
    const cfg = BOSS_CONFIGS[id];
    const gateGroup = new THREE.Group();
    gateGroup.position.set(cfg.fogGatePosition.x, 0, cfg.fogGatePosition.z);
    gateGroup.lookAt(0, 0, 0);

    const leftPost = new THREE.Mesh(new THREE.BoxGeometry(0.65, 4.6, 0.65), stoneMat);
    leftPost.position.set(-1.7, 2.3, 0);
    leftPost.castShadow = true;
    gateGroup.add(leftPost);

    const rightPost = new THREE.Mesh(new THREE.BoxGeometry(0.65, 4.6, 0.65), stoneMat);
    rightPost.position.set(1.7, 2.3, 0);
    rightPost.castShadow = true;
    gateGroup.add(rightPost);

    const arch = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.7, 0.8), stoneMat);
    arch.position.set(0, 4.75, 0);
    arch.castShadow = true;
    gateGroup.add(arch);

    const curtainMat = createFogGateMaterial(cfg.accentColor);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 4.35, 1, 1), curtainMat);
    curtain.position.set(0, 2.2, 0);
    gateGroup.add(curtain);

    const pedestalRing = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.65, 32),
      new THREE.MeshBasicMaterial({ color: cfg.accentColor, side: THREE.DoubleSide }),
    );
    pedestalRing.rotation.x = -Math.PI / 2;
    pedestalRing.position.set(0, 0.03, 1.4);
    gateGroup.add(pedestalRing);

    group.add(gateGroup);
    fogGates.push({
      bossId: id,
      group: gateGroup,
      curtainMat,
      position: new THREE.Vector3(cfg.fogGatePosition.x, 0, cfg.fogGatePosition.z),
    });
  }

  // Drifting golden/arcane ash embers
  const maxEmbers = 260;
  const emberPositions = new Float32Array(maxEmbers * 3);
  const emberBase = new Float32Array(maxEmbers * 3);
  for (let i = 0; i < maxEmbers; i++) {
    const r = Math.sqrt((i + 0.5) / maxEmbers) * ARENA_RADIUS;
    const a = i * 2.39996;
    const x = Math.cos(a) * r;
    const y = 0.3 + ((i * 17) % 100) * 0.08;
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
    color: 0xe6b96c,
    size: 0.14,
    transparent: true,
    opacity: 0.72,
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
    setEmberCount: (count: number) => {
      emberGeo.setDrawRange(0, Math.max(0, Math.min(maxEmbers, count)));
    },
  };
}

export function createPlayerModel(): PlayerRig {
  const root = new THREE.Group();
  const bodyMeshGroup = new THREE.Group();
  root.add(bodyMeshGroup);

  const armorMat = new THREE.MeshStandardMaterial({
    color: 0x262833,
    roughness: 0.45,
    metalness: 0.7,
  });
  const cloakMat = new THREE.MeshStandardMaterial({
    color: 0x3b151c,
    roughness: 0.82,
    metalness: 0.1,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xc8a464,
    roughness: 0.32,
    metalness: 0.85,
    emissive: 0x3d2a0a,
    emissiveIntensity: 0.4,
  });

  // Lower cloak & greaves
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.15, 10), cloakMat);
  cloak.position.y = 0.62;
  cloak.castShadow = true;
  bodyMeshGroup.add(cloak);

  // Armored chest
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.25, 0.72, 8), armorMat);
  torso.position.y = 1.18;
  torso.castShadow = true;
  bodyMeshGroup.add(torso);

  // Pauldrons
  for (const side of [-1, 1]) {
    const pauldron = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18, 0), brassMat);
    pauldron.position.set(side * 0.36, 1.45, 0);
    pauldron.castShadow = true;
    bodyMeshGroup.add(pauldron);
  }

  // Crested Knight Helm
  const helm = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 1), armorMat);
  helm.position.y = 1.72;
  helm.castShadow = true;
  bodyMeshGroup.add(helm);

  const visorGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.05, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xe6c37a }),
  );
  visorGlow.position.set(0, 1.72, 0.19);
  bodyMeshGroup.add(visorGlow);

  // Floating Astrolabe Halo on knight's back
  const astrolabeRing = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.025, 8, 36), brassMat);
  astrolabeRing.position.set(0, 1.38, -0.32);
  bodyMeshGroup.add(astrolabeRing);

  // Resonance Blade pivot
  const bladePivot = new THREE.Group();
  bladePivot.position.set(0.42, 1.18, 0.15);
  bodyMeshGroup.add(bladePivot);

  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xd9e6f2,
    emissive: 0x7fb8d8,
    emissiveIntensity: 0.75,
    metalness: 0.85,
    roughness: 0.18,
  });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.35, 0.14), bladeMat);
  blade.position.set(0, 0.65, 0.2);
  blade.rotation.x = Math.PI * 0.25;
  blade.castShadow = true;
  bladePivot.add(blade);

  const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.09), brassMat);
  hilt.position.set(0, 0.14, 0.06);
  bladePivot.add(hilt);

  // Minimal 1st-Person Viewmodel Blade (attached to camera when in 1st-POV)
  const firstPersonBlade = new THREE.Group();
  const fpBlade = blade.clone();
  fpBlade.scale.set(0.75, 0.75, 0.75);
  fpBlade.position.set(0.35, -0.32, -0.58);
  fpBlade.rotation.set(-0.35, 0.2, 0.22);
  firstPersonBlade.add(fpBlade);
  firstPersonBlade.visible = false;

  return {
    root,
    bodyMeshGroup,
    bladePivot,
    astrolabeRing,
    firstPersonBlade,
    setFirstPersonHidden: (isFirstPerson: boolean) => {
      bodyMeshGroup.visible = !isFirstPerson;
      firstPersonBlade.visible = isFirstPerson;
    },
  };
}

export function createBossModel(id: BossId): BossRig {
  const cfg = BOSS_CONFIGS[id];
  const root = new THREE.Group();
  const orbitParts: THREE.Object3D[] = [];

  const darkMat = new THREE.MeshStandardMaterial({
    color: id === 'witch' ? 0x2c294d : id === 'lich' ? 0x25342f : 0x3a2323,
    roughness: 0.48,
    metalness: 0.45,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: cfg.accentColor,
    emissive: cfg.accentColor,
    emissiveIntensity: 1.1,
    roughness: 0.25,
    metalness: 0.6,
  });

  let coreMesh: THREE.Mesh;
  let wingLeft: THREE.Object3D | undefined;
  let wingRight: THREE.Object3D | undefined;

  if (id === 'witch') {
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.6, 14), darkMat);
    robe.position.y = 1.3;
    robe.castShadow = true;
    root.add(robe);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), darkMat);
    head.position.y = 2.75;
    root.add(head);

    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 18), darkMat);
    hatBrim.position.y = 2.95;
    root.add(hatBrim);

    const hatCone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.15, 14), darkMat);
    hatCone.position.y = 3.5;
    hatCone.rotation.z = -0.15;
    root.add(hatCone);

    coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), accentMat);
    coreMesh.position.set(0, 1.9, 0.65);
    root.add(coreMesh);

    for (let i = 0; i < 3; i++) {
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), accentMat);
      const a = (i / 3) * Math.PI * 2;
      orb.position.set(Math.cos(a) * 1.9, 2.1, Math.sin(a) * 1.9);
      root.add(orb);
      orbitParts.push(orb);
    }
  } else if (id === 'lich') {
    const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.05, 3.1, 8), darkMat);
    mantle.position.y = 1.55;
    mantle.castShadow = true;
    root.add(mantle);

    const skull = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), new THREE.MeshStandardMaterial({
      color: 0xc9c2b2,
      roughness: 0.6,
    }));
    skull.position.y = 3.35;
    root.add(skull);

    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 8), accentMat);
    crown.position.y = 3.72;
    crown.rotation.x = Math.PI / 2;
    root.add(crown);

    coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), accentMat);
    coreMesh.position.set(0, 2.25, 0.58);
    root.add(coreMesh);

    for (let i = 0; i < 4; i++) {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.2, 5), accentMat);
      const a = (i / 4) * Math.PI * 2;
      shard.position.set(Math.cos(a) * 2.1, 2.3, Math.sin(a) * 2.1);
      root.add(shard);
      orbitParts.push(shard);
    }
  } else {
    // Dragon — Vaelorath
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 2.2, 6, 12), darkMat);
    body.rotation.x = Math.PI * 0.38;
    body.position.set(0, 1.8, 0);
    body.castShadow = true;
    root.add(body);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.52, 1.5, 8), darkMat);
    neck.position.set(0, 2.8, 1.15);
    neck.rotation.x = 0.45;
    root.add(neck);

    const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.35, 6), darkMat);
    head.position.set(0, 3.35, 1.85);
    head.rotation.x = Math.PI * 0.52;
    root.add(head);

    coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 10), accentMat);
    coreMesh.position.set(0, 1.9, 0.72);
    root.add(coreMesh);

    const wingGeo = new THREE.BufferGeometry();
    const verts = new Float32Array([0, 0, 0, 3.4, 1.1, -0.6, 2.8, -0.6, 0.9]);
    wingGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    wingGeo.computeVertexNormals();
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x331b19,
      emissive: 0x522111,
      emissiveIntensity: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.7,
    });

    wingLeft = new THREE.Mesh(wingGeo, wingMat);
    wingLeft.position.set(0.5, 2.3, 0.2);
    root.add(wingLeft);

    wingRight = new THREE.Mesh(wingGeo, wingMat);
    wingRight.scale.x = -1;
    wingRight.position.set(-0.5, 2.3, 0.2);
    root.add(wingRight);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.4, 6), darkMat);
    tail.position.set(0, 1.2, -2.0);
    tail.rotation.x = -Math.PI * 0.48;
    root.add(tail);
  }

  // Crystalline Phase Ward Barrier
  const wardMat = createWardShellMaterial(cfg.accentColor);
  const wardMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(2.65, 2), wardMat);
  wardMesh.position.y = 2.0;
  wardMesh.visible = false;
  root.add(wardMesh);

  return {
    root,
    wardMesh,
    wardMat,
    orbitParts,
    wingLeft,
    wingRight,
    coreMesh,
  };
}

export function createTangentArcVisual(): TangentArcVisual {
  const group = new THREE.Group();
  const maxSegments = 120;
  const positions = new Float32Array(maxSegments * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0xe6c37a, transparent: true, opacity: 0.9 });
  const curveLine = new THREE.Line(geo, lineMat);
  group.add(curveLine);

  // Tangent line segment around theta
  const tanPositions = new Float32Array(6);
  const tanGeo = new THREE.BufferGeometry();
  tanGeo.setAttribute('position', new THREE.BufferAttribute(tanPositions, 3));
  const tanMat = new THREE.LineBasicMaterial({ color: 0xff8a4c, transparent: true, opacity: 0.95 });
  const tanLine = new THREE.Line(tanGeo, tanMat);
  group.add(tanLine);

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd180 }),
  );
  group.add(marker);

  return {
    group,
    updateCurve: (fn, theta, origin, accentColor, segments) => {
      const count = Math.max(20, Math.min(maxSegments, segments));
      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
      const span = Math.PI * 1.4;
      const half = span * 0.5;
      const yScale = 0.28;
      const xScale = 1.65;

      for (let i = 0; i < count; i++) {
        const t = (i / (count - 1)) * span - half;
        const val = evaluateTrig(fn, theta + t).value;
        const clampedY = Math.max(-2.6, Math.min(2.6, val * yScale));
        posAttr.setXYZ(i, origin.x + t * xScale, origin.y + 3.8 + clampedY, origin.z);
      }
      posAttr.needsUpdate = true;
      geo.setDrawRange(0, count);
      lineMat.color.setHex(accentColor);

      const centerY = Math.max(-2.6, Math.min(2.6, evaluateTrig(fn, theta).value * yScale));
      const slope = evaluateExactDerivative(fn, theta).value;
      const clampedSlope = Math.max(-4, Math.min(4, slope));

      marker.position.set(origin.x, origin.y + 3.8 + centerY, origin.z);

      const dx = 0.9;
      const dy = clampedSlope * yScale * (dx / xScale);
      const tanAttr = tanGeo.getAttribute('position') as THREE.BufferAttribute;
      tanAttr.setXYZ(0, origin.x - dx, origin.y + 3.8 + centerY - dy, origin.z);
      tanAttr.setXYZ(1, origin.x + dx, origin.y + 3.8 + centerY + dy, origin.z);
      tanAttr.needsUpdate = true;
    },
  };
}
