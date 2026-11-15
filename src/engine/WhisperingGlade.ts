import * as THREE from 'three';
import { evaluateExactDerivative, evaluateTrig } from '../math/trigDerivatives';
import { getTerrainHeight, LANDMARK_BY_ID } from '../world/SunlitValley';
import { computeSafeNormals, mergeStaticMeshes, taperTube, v3 } from './SculptKit';

type GladeFunction = 'sin' | 'cos';

export interface WhisperingGlade {
  readonly group: THREE.Group;
  updateWave(fn?: GladeFunction, theta?: number): void;
}

const TURN = Math.PI * 2;
const PLOT_HALF_WIDTH = 4.25;
const PLOT_HEIGHT = 1.05;
const X_PER_RADIAN = 2 * PLOT_HALF_WIDTH / TURN;
const GLYPH_DEPTH = 0.205;

function curveGeometry(fn: GladeFunction): THREE.BufferGeometry {
  const points = [];
  const segments = 96;
  for (let i = 0; i <= segments; i++) {
    const theta = TURN * i / segments;
    points.push(v3(-PLOT_HALF_WIDTH + theta * X_PER_RADIAN, evaluateTrig(fn, theta).value * PLOT_HEIGHT, GLYPH_DEPTH));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, 0.05, 5, false);
}

function createPlot(): WhisperingGlade {
  const group = new THREE.Group();
  group.name = 'glade_tangent_plot';
  const curveMat = new THREE.MeshBasicMaterial({ color: 0x83d4ff, toneMapped: false });
  const goldMat = new THREE.MeshBasicMaterial({ color: 0xffc46c, toneMapped: false });
  const sine = new THREE.Mesh(curveGeometry('sin'), curveMat);
  const cosine = new THREE.Mesh(curveGeometry('cos'), curveMat);
  sine.name = 'glade_sine_curve';
  cosine.name = 'glade_cosine_curve';

  const tangent = new THREE.Mesh(new THREE.BoxGeometry(1, 0.074, 0.045), goldMat);
  tangent.name = 'glade_tangent_line';
  const point = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.135),
    new THREE.MeshBasicMaterial({ color: 0xfff5d5, toneMapped: false }),
  );
  point.name = 'glade_tangent_point';
  group.add(sine, cosine, tangent, point);

  let previousFn: GladeFunction | undefined;
  let previousTheta: number | undefined;
  function updateWave(fn: GladeFunction = 'sin', theta = Math.PI / 3): void {
    if (fn === previousFn && theta === previousTheta) return;
    previousFn = fn;
    previousTheta = theta;
    sine.visible = fn === 'sin';
    cosine.visible = fn === 'cos';

    const angle = ((theta % TURN) + TURN) % TURN;
    const x = -PLOT_HALF_WIDTH + angle * X_PER_RADIAN;
    const y = evaluateTrig(fn, angle).value * PLOT_HEIGHT;
    const slope = evaluateExactDerivative(fn, angle).value * PLOT_HEIGHT / X_PER_RADIAN;
    const left = Math.max(-PLOT_HALF_WIDTH, x - 1.08);
    const right = Math.min(PLOT_HALF_WIDTH, x + 1.08);
    const width = right - left;
    const midpoint = (left + right) / 2;
    point.position.set(x, y, GLYPH_DEPTH + 0.1);
    tangent.position.set(midpoint, y + (midpoint - x) * slope, GLYPH_DEPTH + 0.065);
    tangent.rotation.z = Math.atan(slope);
    tangent.scale.x = Math.hypot(width, width * slope);
  }

  updateWave();
  return { group, updateWave };
}

export function createWhisperingGlade(stone: THREE.MeshStandardMaterial): WhisperingGlade {
  const group = new THREE.Group();
  group.name = 'whispering_glade';
  const { x, z } = LANDMARK_BY_ID.witch;
  const towardHub = new THREE.Vector2(-x, -z).normalize();
  const across = new THREE.Vector2(towardHub.y, -towardHub.x);
  const moss = new THREE.MeshStandardMaterial({ color: 0x405d48, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x638863, roughness: 0.82 });
  const petalMat = new THREE.MeshStandardMaterial({ color: 0xc78da6, roughness: 0.8 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x85714b, metalness: 0.45, roughness: 0.51 });
  const wisp = new THREE.MeshStandardMaterial({ color: 0x92d4ee, emissive: 0x537d9a, emissiveIntensity: 0.6, roughness: 0.4 });
  const leafGeometry = new THREE.IcosahedronGeometry(1, 0);

  function mesh(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material,
    px: number, py: number, pz: number, shadow = false): THREE.Mesh {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(px, py, pz);
    part.castShadow = shadow;
    part.receiveShadow = shadow;
    parent.add(part);
    return part;
  }

  function vine(parent: THREE.Group, px: number, height: number, pz: number, seed: number): void {
    const points = Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      const angle = t * 5.3 + seed;
      return v3(px + Math.sin(angle) * 0.48, 0.3 + t * height, pz + Math.cos(angle) * 0.42);
    });
    mesh(parent, taperTube(points, 0.047, 0.022, 19, 5), moss, 0, 0, 0);
    points.slice(1).forEach((p, i) => {
      const side = i % 2 ? -1 : 1;
      const leaf = mesh(parent, leafGeometry, leafMat, p.x + side * 0.12, p.y + 0.06, p.z + 0.054);
      leaf.scale.set(0.185, 0.089, 0.049);
      leaf.rotation.z = side * 0.52;
      if (i % 4 === 1) {
        mesh(parent, leafGeometry, petalMat, p.x - side * 0.08, p.y + 0.14, p.z + 0.095).scale.set(0.078, 0.072, 0.047);
      }
    });
  }

  const baseGeometry = new THREE.CylinderGeometry(0.6, 0.78, 0.24, 8);
  const shaftGeometry = new THREE.CylinderGeometry(0.42, 0.53, 1, 7, 3);
  const shaftPositions = shaftGeometry.attributes.position;
  for (let i = 0; i < shaftPositions.count; i++) {
    const px = shaftPositions.getX(i);
    const py = shaftPositions.getY(i);
    const pz = shaftPositions.getZ(i);
    shaftPositions.setXYZ(i, px + py * 0.16, py, pz + Math.sin(py * 4 + px * 3) * 0.055);
  }
  computeSafeNormals(shaftGeometry);

  function standingStone(parent: THREE.Group, px: number, groundY: number, pz: number, height: number, seed: number): void {
    mesh(parent, baseGeometry, stone, px, groundY + 0.07, pz, true);
    mesh(parent, shaftGeometry, stone, px, groundY + height * 0.5, pz, true).scale.y = height;
    const cap = mesh(parent, new THREE.CylinderGeometry(0.41, 0.55, 0.23, 7), stone, px, groundY + height, pz, true);
    cap.rotation.z = (seed % 2 ? 1 : -1) * 0.11;
    const foliage = new THREE.Group();
    foliage.position.y = groundY;
    parent.add(foliage);
    vine(foliage, px, height * 0.83, pz, seed);
  }

  // The trail runs through the middle of the arch, with lanterns to either side.
  const entrance = new THREE.Group();
  entrance.name = 'glade_trail_arch';
  entrance.position.set(x + towardHub.x * 18, 0, z + towardHub.y * 18);
  entrance.rotation.y = Math.atan2(towardHub.x, towardHub.y);
  const archGround = getTerrainHeight(entrance.position.x, entrance.position.z);
  for (const side of [-1, 1]) {
    const px = side * 2.75;
    const gy = getTerrainHeight(entrance.position.x + across.x * px, entrance.position.z + across.y * px);
    standingStone(entrance, px, gy, 0, archGround + 3.15 - gy, side + 2);
  }
  for (let i = 0; i < 13; i++) {
    const a = (i + 0.5) * Math.PI / 13;
    const block = mesh(entrance, new THREE.BoxGeometry(0.76, 0.53 + 0.13 * Math.sin(a), 0.81),
      stone, Math.cos(a) * 2.75, archGround + 3.15 + 1.67 * Math.sin(a), 0, true);
    block.rotation.z = Math.atan2(1.67 * Math.cos(a), -2.75 * Math.sin(a));
  }
  function lantern(parent: THREE.Group, px: number, py: number, pz: number): void {
    mesh(parent, new THREE.CylinderGeometry(0.24, 0.17, 0.13, 6), bronze, px, py + 0.23, pz);
    mesh(parent, new THREE.OctahedronGeometry(0.22), wisp, px, py, pz).scale.y = 1.45;
    mesh(parent, new THREE.TorusGeometry(0.32, 0.026, 5, 14), bronze, px, py, pz);
  }
  lantern(entrance, -2.24, archGround + 2.7, 0.42);
  lantern(entrance, 2.24, archGround + 2.7, 0.42);
  group.add(entrance);

  const trailDress = new THREE.Group();
  for (const distance of [22, 26]) {
    for (const side of [-1, 1]) {
      const px = x + towardHub.x * distance + across.x * side * 2.85;
      const pz = z + towardHub.y * distance + across.y * side * 2.85;
      const py = getTerrainHeight(px, pz);
      mesh(trailDress, baseGeometry, stone, px, py + 0.07, pz).scale.set(0.66, 1, 0.66);
      mesh(trailDress, new THREE.CylinderGeometry(0.22, 0.34, 0.7, 6), stone, px, py + 0.43, pz);
      lantern(trailDress, px, py + 0.95, pz);
    }
  }
  group.add(trailDress);

  // Follow the terrain so the inlays do not hover or cut through the plateau.
  const inlayMat = new THREE.MeshStandardMaterial({ color: 0x769085, roughness: 0.88 });
  const floor = new THREE.Group();
  for (const radius of [7.1, 11.8]) {
    const geometry = new THREE.RingGeometry(radius, radius + 0.24, 64);
    geometry.rotateX(-Math.PI / 2);
    const points = geometry.attributes.position;
    for (let i = 0; i < points.count; i++) {
      points.setY(i, getTerrainHeight(x + points.getX(i), z + points.getZ(i)) + 0.035);
    }
    computeSafeNormals(geometry);
    mesh(floor, geometry, inlayMat, x, 0, z).receiveShadow = true;
  }
  group.add(floor);

  const frame = new THREE.Group();
  frame.name = 'glade_plot_frame';
  frame.position.set(x, getTerrainHeight(x, z - 12.8), z - 12.8);
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x21333a, roughness: 0.94 });
  const inset = new THREE.MeshBasicMaterial({ color: 0x18262e, toneMapped: false });
  const axis = new THREE.MeshBasicMaterial({ color: 0x627a83, toneMapped: false });
  const plotY = 3.8;
  mesh(frame, new THREE.BoxGeometry(9.75, 3.7, 0.46), stone, 0, plotY, -0.2, true);
  mesh(frame, new THREE.BoxGeometry(9.26, 3.35, 0.1), darkStone, 0, plotY, 0.07);
  mesh(frame, new THREE.PlaneGeometry(8.95, 3.13), inset, 0, plotY, 0.131);
  mesh(frame, new THREE.BoxGeometry(10.35, 0.22, 0.7), stone, 0, plotY + 1.87, -0.13, true);
  mesh(frame, new THREE.BoxGeometry(8.5, 0.033, 0.023), axis, 0, plotY, 0.156);
  mesh(frame, new THREE.BoxGeometry(0.033, 2.35, 0.023), axis, -PLOT_HALF_WIDTH, plotY, 0.156);
  for (let i = 0; i <= 4; i++) {
    mesh(frame, new THREE.BoxGeometry(0.039, 0.175, 0.023), axis,
      -PLOT_HALF_WIDTH + i * PLOT_HALF_WIDTH / 2, plotY, 0.157);
  }
  for (const side of [-1, 1]) {
    const px = side * 5.02;
    const py = getTerrainHeight(x + px, frame.position.z) - frame.position.y;
    standingStone(frame, px, py, -0.1, plotY + 1.82 - py, side + 4);
    lantern(frame, px, plotY + 1.42, 0.49);
  }
  const crown = mesh(frame, new THREE.TorusGeometry(0.66, 0.07, 6, 30, Math.PI * 1.3), bronze, 0, plotY + 2.15, 0.06);
  crown.rotation.z = -Math.PI * 0.15;
  mesh(frame, new THREE.OctahedronGeometry(0.22), wisp, 0, plotY + 2.27, 0.11);
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#bfd2d4';
    ctx.font = '30px Georgia, serif';
    ctx.textAlign = 'center';
    ['0', 'π/2', 'π', '3π/2', '2π'].forEach((label, i) => ctx.fillText(label, 26 + i * 243, 344));
    ctx.fillText('f(θ)', 34, 37);
    ctx.fillText('θ', 992, 160);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    mesh(frame, new THREE.PlaneGeometry(8.95, 3.13),
      new THREE.MeshBasicMaterial({ map, toneMapped: false, alphaTest: 0.35 }), 0, plotY, 0.183);
  }
  group.add(frame);

  const grove = new THREE.Group();
  for (const [dx, dz, height] of [[-12.4, -8.8, 3.7], [-14.5, -3.2, 2.45], [13.2, -8.4, 3.2], [14.6, -2.0, 2.15]]) {
    const py = getTerrainHeight(x + dx, z + dz);
    standingStone(grove, x + dx, py, z + dz, height, height);
    lantern(grove, x + dx, py + height - 0.5, z + dz + 0.52);
    for (let i = 0; i < 6; i++) {
      const a = i * 2.4;
      const px = x + dx + Math.cos(a) * (0.6 + 0.15 * i);
      const pz = z + dz + Math.sin(a) * (0.6 + 0.15 * i);
      const base = getTerrainHeight(px, pz);
      const leaves = mesh(grove, leafGeometry, i % 2 ? moss : leafMat, px, base + 0.19, pz);
      leaves.scale.set(0.49, 0.4 - i * 0.025, 0.47);
      mesh(grove, leafGeometry, petalMat, px, base + 0.45 - i * 0.025, pz).scale.set(0.17, 0.095, 0.14);
    }
  }
  group.add(grove);

  [entrance, trailDress, floor, grove, frame].forEach((part) => mergeStaticMeshes(part));
  const plot = createPlot();
  plot.group.position.y = plotY;
  frame.add(plot.group);
  return { group, updateWave: plot.updateWave };
}
