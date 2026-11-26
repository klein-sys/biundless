import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { BossId } from '../bosses/bossDefinitions';
import { getTerrainHeight, getTrailBlend, LANDMARK_BY_ID } from '../world/SunlitValley';
import type { BossRig } from './BossModels';
import type { PlayerRig, SolsticeHavenBundle, VillageObstacle } from './ProceduralModels';
import { sweepGeometry } from './SculptKit';

const sceneryNames = [
  'town/stall-red', 'town/stall-green', 'town/cart', 'town/banner-green', 'town/wall-wood-window-shutters',
  'town/chimney', 'town/hedge', 'town/tree-high-round', 'castle/flag-banner-long', 'castle/wall-half',
  'castle/rocks-large', 'food/apple', 'food/bread', 'food/barrel', 'forest/tree', 'forest/tree-high',
  'forest/rocks-low', 'nature/mushroom_redGroup', 'nature/flower_purpleA', 'arena/column-damaged',
  'arena/banner', 'dungeon/barrel', 'dungeon/column', 'dungeon/rocks', 'cave/gate-rock',
  'cave/template-detail', 'graveyard/urn-round', 'graveyard/pillar-obelisk',
] as const;
type SceneryName = (typeof sceneryNames)[number];
type Placement = readonly [asset: SceneryName, x: number, z: number, footprint: number, height: number, yaw?: number, lift?: number];
type ModelBank = ReturnType<typeof loadStorybookModels>;
type PlayerPose = 'idle' | 'walk' | 'sprint' | 'jump' | 'fall' | 'attack-melee-right' | 'holding-right-shoot';

export interface StorybookPlayer {
  update(dt: number, pose: PlayerPose): void;
}

const market: readonly Placement[] = [
  ['town/stall-red', -11.5, -3.5, 3.1, 2.8, 0.35],
  ['town/stall-green', 11.5, -3.5, 3.1, 2.8, -0.35],
  ['town/cart', -12.7, 6.3, 2.75, 1.25, 0.85],
  ['food/apple', -12.8, 6.1, 0.35, 0.36, 0, 0.73],
  ['food/apple', -13.0, 6.55, 0.35, 0.36, 0.6, 0.73],
  ['food/bread', -12.2, 6.4, 0.57, 0.28, 0.85, 0.73],
  ['food/barrel', -10.2, -3.6, 0.72, 0.9],
  ['food/barrel', 10.1, -3.2, 0.72, 0.9],
  ['town/banner-green', 12.08, -3.28, 0.62, 0.9, -0.35, 0.95],
  ['castle/flag-banner-long', -8.7, -20.36, 1.0, 2.2, -0.31, 2.7],
  ['castle/flag-banner-long', 8.7, -20.36, 1.0, 2.2, 0.31, 2.7],
  ['castle/wall-half', -16.3, 17, 3.1, 1.6, 0.4],
  ['castle/wall-half', 16.3, 17, 3.1, 1.6, -0.4],
  ['town/tree-high-round', -16.1, -16.9, 4.1, 5.6],
  ['town/tree-high-round', 17, -16, 3.8, 5.2, 1.3],
  ['town/tree-high-round', 16, 5.4, 4.3, 5.1, 2],
  ['town/hedge', -8, -14.6, 2.5, 1.2, 1.57],
  ['town/hedge', 8, -14.6, 2.5, 1.2, 1.57],
  ['nature/flower_purpleA', -4.5, 0, 0.7, 0.55, 0.8, 0.58],
  ['nature/flower_purpleA', 4.5, 0, 0.7, 0.55, 0, 0.58],
];

const regionProps: Record<BossId, readonly (readonly [SceneryName, number, number])[]> = {
  witch: [
    ['forest/tree-high', 4.7, 7], ['forest/tree', 4.9, 5.3], ['forest/rocks-low', 3.8, 1.15],
    ['nature/mushroom_redGroup', 1.8, 1.2], ['nature/flower_purpleA', 1.1, 0.95],
  ],
  lich: [
    ['arena/column-damaged', 2, 3.6], ['dungeon/column', 2, 5.4], ['arena/banner', 1.45, 2.6],
    ['dungeon/barrel', 0.92, 1.06], ['dungeon/rocks', 3.9, 1.6],
    ['graveyard/urn-round', 1.15, 1.5], ['graveyard/pillar-obelisk', 2.4, 4.7],
  ],
  dragon: [
    ['castle/rocks-large', 4.2, 2.8], ['cave/template-detail', 5.8, 3.7], ['cave/gate-rock', 6.4, 5.8],
    ['forest/rocks-low', 4.5, 1.9],
  ],
};

const guardianPaint: Record<BossId, number> = {
  witch: 0x7bb8cd,
  lich: 0x90b697,
  dragon: 0xc18261,
};

export function fitScenery(bounds: THREE.Box3, x: number, y: number, z: number, yaw: number, footprint: number, height: number): THREE.Matrix4 {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const cos = Math.abs(Math.cos(yaw));
  const sin = Math.abs(Math.sin(yaw));
  const flatScale = footprint / Math.max(cos * size.x + sin * size.z, sin * size.x + cos * size.z);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return new THREE.Matrix4()
    .compose(new THREE.Vector3(x, y, z), rotation, new THREE.Vector3(flatScale, height / size.y, flatScale))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
}

export function loadStorybookModels(base = import.meta.env.BASE_URL) {
  const loader = new GLTFLoader();
  const requests = new Map<string, Promise<GLTF>>();
  const load = (name: string) => {
    let request = requests.get(name);
    if (!request) {
      request = loader.loadAsync(base + 'models/' + name + '.glb');
      requests.set(name, request);
    }
    return request;
  };
  return {
    scenery: (name: SceneryName) => load(name),
    people: (name: string) => load('people/' + name),
  };
}

async function addScenery(parent: THREE.Object3D, models: ModelBank, placements: readonly Placement[]): Promise<void> {
  const bins = new Map<SceneryName, Placement[]>();
  for (const place of placements) {
    const bin = bins.get(place[0]);
    if (bin) bin.push(place);
    else bins.set(place[0], [place]);
  }

  await Promise.all([...bins].map(async ([name, locations]) => {
    const { scene } = await models.scenery(name);
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene);
    const positions = locations.map(([, x, z, width, height, yaw = 0, lift = 0]) =>
      fitScenery(bounds, x, getTerrainHeight(x, z) + lift, z, yaw, width, height));
    const batch = new THREE.Group();
    batch.name = name;
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mesh = new THREE.InstancedMesh(child.geometry, child.material, positions.length);
      positions.forEach((transform, index) => mesh.setMatrixAt(index, transform.clone().multiply(child.matrixWorld)));
      mesh.computeBoundingSphere();
      mesh.castShadow = mesh.receiveShadow = true;
      batch.add(mesh);
    });
    parent.add(batch);
  }));
}

function paintModel(model: THREE.Object3D, tint: number, amount: number): void {
  const paint = new THREE.Color(tint);
  const seen = new Set<THREE.Material>();
  model.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    const materials = Array.isArray(part.material) ? part.material : [part.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || seen.has(material)) continue;
      seen.add(material);
      if ((material.emissiveIntensity > 0.8 && (material.emissiveMap || material.emissive.getHex() !== 0)) || material.transparent) continue;
      const brightness = Math.max(material.color.r, material.color.g, material.color.b);
      const target = material.map ? paint.clone().lerp(new THREE.Color(0xffffff), 0.65) : paint.clone().multiplyScalar(brightness);
      material.color.lerp(target, amount);
      material.roughness = Math.max(material.roughness, 0.48);
      material.metalness = Math.min(material.metalness, 0.4);
    }
  });
}

export function paintGuardian(rig: BossRig, id: BossId): void {
  paintModel(rig.bodyGroup, guardianPaint[id], 0.28);
}

export async function dressStorybookRegion(group: THREE.Scene | THREE.Group, models: ModelBank, id: BossId, obstacles?: VillageObstacle[]): Promise<void> {
  const { x, z } = LANDMARK_BY_ID[id];
  const props = regionProps[id];
  const spots: Placement[] = [];
  const count = id === 'witch' ? 25 : 18;
  for (let i = 0; i < count; i++) {
    const phase = i * Math.PI * 2 / count;
    const distance = (id === 'witch' ? 21 : 22) + (i % 3) * 2;
    const px = x + Math.cos(phase) * distance;
    const pz = z + Math.sin(phase) * distance;
    if (getTrailBlend(px, pz) > 0.02 || Math.hypot(px, pz) > 92) continue;
    const [asset, width, height] = props[i % props.length];
    spots.push([asset, px, pz, width, height, phase + Math.PI / 2]);
  }
  const dressing = new THREE.Group();
  dressing.name = 'storybook-' + id + '-scenery';
  await addScenery(dressing, models, spots);
  group.add(dressing);
  for (const [, px, pz, width, height] of spots) {
    if (height >= 2.5) obstacles?.push({ x: px, z: pz, radius: width * 0.38 });
  }
}

function animatedFigure(model: GLTF, height: number) {
  const figure = clone(model.scene);
  const bounds = new THREE.Box3().setFromObject(figure);
  const scale = height / bounds.getSize(new THREE.Vector3()).y;
  const center = bounds.getCenter(new THREE.Vector3());
  figure.scale.setScalar(scale);
  figure.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  figure.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    part.material = Array.isArray(part.material) ? part.material.map((m) => m.clone()) : part.material.clone();
    part.castShadow = true;
    part.receiveShadow = true;
  });
  const mixer = new THREE.AnimationMixer(figure);
  let action: THREE.AnimationAction | undefined;
  const setPose = (pose: PlayerPose) => {
    const clip = THREE.AnimationClip.findByName(model.animations, pose);
    if (!clip) return;
    const next = mixer.clipAction(clip);
    if (next === action) return;
    action?.fadeOut(0.13);
    next.reset();
    if (pose === 'attack-melee-right' || pose === 'holding-right-shoot') {
      next.setLoop(THREE.LoopOnce, 1).setDuration(0.25);
      next.clampWhenFinished = true;
    }
    next.fadeIn(0.1).play();
    action = next;
  };
  setPose('idle');
  return { figure, mixer, scale, setPose };
}

function addCostume(figure: THREE.Object3D, role: 'herbalist' | 'scout'): void {
  const torso = figure.getObjectByName('torso');
  if (!torso) return;
  const herbalist = role === 'herbalist';
  const cloth = new THREE.MeshStandardMaterial({ color: herbalist ? 0xdbc390 : 0x466a51, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: herbalist ? 0x82945a : 0xe1b674, roughness: 0.7 });
  const ribbon = new THREE.Mesh(sweepGeometry([
    new THREE.Vector3(-0.056, 0.12, 0.012),
    new THREE.Vector3(-0.032, 0.102, 0.075),
    new THREE.Vector3(0.034, 0.078, 0.078),
    new THREE.Vector3(0.062, herbalist ? 0.002 : 0.051, 0.056),
  ], 8, { radial: 6, radius: (t) => 0.016 * (1 - 0.48 * t), scaleY: () => 0.42 }), cloth);
  ribbon.castShadow = true;
  const clasp = new THREE.Mesh(new THREE.OctahedronGeometry(0.013, 0), trim);
  clasp.position.set(-0.029, 0.097, 0.084);
  const pouch = new THREE.Mesh(new THREE.DodecahedronGeometry(0.032, 0), cloth);
  pouch.position.set(herbalist ? 0.069 : -0.069, 0.025, 0.044);
  pouch.scale.set(1, 0.87, 0.62);
  torso.add(ribbon, clasp, pouch);
}

export async function dressStorybookVillage(village: SolsticeHavenBundle, models: ModelBank): Promise<(dt: number) => void> {
  for (const npc of village.interactiveNpcs) {
    if (npc.role === 'aurelius' || npc.role === 'blacksmith') {
      paintModel(npc.meshGroup, npc.role === 'aurelius' ? 0x7891b4 : 0xb07b5c, 0.19);
    }
  }
  const updaters: ((dt: number) => void)[] = [];
  const costumes = [
    ['herbalist', 'character-female-a', 0xad995e, 1.62],
    ['scout', 'character-male-c', 0x619275, 1.72],
  ] as const;
  const plaza = new THREE.Group();
  plaza.name = 'storybook-plaza';
  const cottages = village.group.children.filter((child) => child.name === 'cottage_root');
  const accents: Placement[] = cottages.flatMap((cottage) => {
    const { x, z } = cottage.position;
    const yaw = cottage.rotation.y;
    const frontX = x + Math.sin(yaw) * 2.19;
    const frontZ = z + Math.cos(yaw) * 2.19;
    return [
      ['town/wall-wood-window-shutters', frontX + Math.cos(yaw) * 1.18, frontZ - Math.sin(yaw) * 1.18, 1.1, 1.05, yaw, 1.25],
      ['town/chimney', x - Math.cos(yaw) * 1.12, z + Math.sin(yaw) * 1.12, 0.7, 1.12, yaw, 4.08],
    ];
  });
  const tasks = [
    addScenery(plaza, models, [...market, ...accents]).then(() => {
      village.group.add(plaza);
      for (const [asset, x, z, width] of market) {
        if (/stall|cart|barrel|wall-half|high-round|hedge/.test(asset)) {
          village.obstacles.push({ x, z, radius: width * 0.41 });
        }
      }
    }),
    ...costumes.map(async ([role, asset, tint, height]) => {
      const npc = village.interactiveNpcs.find((candidate) => candidate.role === role);
      if (!npc) return;
      const model = animatedFigure(await models.people(asset), height);
      model.figure.name = 'storybook-' + role;
      paintModel(model.figure, tint, 0.68);
      addCostume(model.figure, role);
      npc.meshGroup.children.forEach((child) => { child.visible = false; });
      npc.meshGroup.add(model.figure);
      updaters.push((dt) => model.mixer.update(dt));
    }),
  ];
  await Promise.allSettled(tasks);
  return (dt) => updaters.forEach((update) => update(dt));
}

export async function dressSpellblade(rig: PlayerRig, models: ModelBank): Promise<StorybookPlayer | undefined> {
  const model = animatedFigure(await models.people('character-knight'), 1.81);
  const hand = model.figure.getObjectByName('arm-right');
  if (!hand) return undefined;
  model.figure.name = 'storybook-spellblade';
  paintModel(model.figure, 0x446994, 0.52);
  rig.bodyMeshGroup.children.forEach((child) => {
    child.visible = child === rig.astrolabeRing || child === rig.outerHaloRing;
  });
  const mount = new THREE.Group();
  mount.position.set(0, -0.102, 0.027);
  mount.scale.setScalar(1 / model.scale);
  hand.add(mount);
  rig.bladePivot.position.set(0, 0, 0);
  mount.add(rig.bladePivot);
  rig.bodyMeshGroup.add(model.figure);
  const groundOffset = model.figure.position.y;
  return {
    update(dt, pose) {
      model.setPose(pose);
      model.mixer.update(dt);
      model.figure.position.y = groundOffset - rig.bodyMeshGroup.position.y;
    },
  };
}
