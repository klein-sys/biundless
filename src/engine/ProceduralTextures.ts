import * as THREE from 'three';

export interface StoneTextureSet {
  readonly map: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly roughnessMap: THREE.CanvasTexture;
}

export interface PillarTextureSet {
  readonly map: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
}

let cachedFloor: StoneTextureSet | null = null;
let cachedPillar: PillarTextureSet | null = null;
let cachedGlow: THREE.CanvasTexture | null = null;

function hash2d(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Generates an ornate obsidian & tarnished-gold astrolabe stone floor texture set.
 */
export function getFloorStoneTextures(): StoneTextureSet {
  if (cachedFloor) return cachedFloor;

  const size = 1024;
  const colorCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  colorCanvas.width = bumpCanvas.width = roughCanvas.width = size;
  colorCanvas.height = bumpCanvas.height = roughCanvas.height = size;

  const cCtx = colorCanvas.getContext('2d')!;
  const bCtx = bumpCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;

  // Base dark slate stone
  cCtx.fillStyle = '#1b1d26';
  cCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#888888';
  bCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#c8c8c8';
  rCtx.fillRect(0, 0, size, size);

  // Subtle stone grain speckles
  for (let i = 0; i < 9000; i++) {
    const rx = hash2d(i, 1) * size;
    const ry = hash2d(i, 2) * size;
    const w = 2 + hash2d(i, 3) * 8;
    const shade = 20 + Math.floor(hash2d(i, 4) * 24);
    cCtx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 8})`;
    cCtx.fillRect(rx, ry, w, w);

    const bShade = 105 + Math.floor(hash2d(i, 5) * 45);
    bCtx.fillStyle = `rgb(${bShade}, ${bShade}, ${bShade})`;
    bCtx.fillRect(rx, ry, w, w);
  }

  // Concentric radial flagstone masonry rings
  const ringRadii = [75, 145, 220, 300, 385, 465];
  cCtx.strokeStyle = '#0c0d12';
  cCtx.lineWidth = 4;
  bCtx.strokeStyle = '#222222';
  bCtx.lineWidth = 5;
  rCtx.strokeStyle = '#ffffff';
  rCtx.lineWidth = 4;

  for (let rIdx = 0; rIdx < ringRadii.length; rIdx++) {
    const r = ringRadii[rIdx];
    const prevR = rIdx === 0 ? 25 : ringRadii[rIdx - 1];

    cCtx.beginPath();
    cCtx.arc(cx, cy, r, 0, Math.PI * 2);
    cCtx.stroke();

    bCtx.beginPath();
    bCtx.arc(cx, cy, r, 0, Math.PI * 2);
    bCtx.stroke();

    rCtx.beginPath();
    rCtx.arc(cx, cy, r, 0, Math.PI * 2);
    rCtx.stroke();

    // Radial flagstone joints within ring
    const segments = 12 + rIdx * 6;
    const offset = rIdx * 0.19;
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2 + offset;
      const x1 = cx + Math.cos(a) * prevR;
      const y1 = cy + Math.sin(a) * prevR;
      const x2 = cx + Math.cos(a) * r;
      const y2 = cy + Math.sin(a) * r;

      cCtx.beginPath();
      cCtx.moveTo(x1, y1);
      cCtx.lineTo(x2, y2);
      cCtx.stroke();

      bCtx.beginPath();
      bCtx.moveTo(x1, y1);
      bCtx.lineTo(x2, y2);
      bCtx.stroke();
    }
  }

  // Tarnished gold astrolabe inlay rings & trigonometric degree ticks
  cCtx.strokeStyle = 'rgba(182, 144, 78, 0.55)';
  cCtx.lineWidth = 3;
  rCtx.strokeStyle = '#505050';
  rCtx.lineWidth = 3;

  for (const r of [145, 300, 440]) {
    cCtx.beginPath();
    cCtx.arc(cx, cy, r, 0, Math.PI * 2);
    cCtx.stroke();

    rCtx.beginPath();
    rCtx.arc(cx, cy, r, 0, Math.PI * 2);
    rCtx.stroke();
  }

  // Astrolabe trigonometric tick marks (every pi/12)
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const inner = i % 3 === 0 ? 120 : 136;
    const outer = i % 6 === 0 ? 440 : 154;
    cCtx.strokeStyle = i % 6 === 0 ? 'rgba(200, 164, 100, 0.45)' : 'rgba(160, 128, 72, 0.35)';
    cCtx.lineWidth = i % 6 === 0 ? 2.5 : 1.5;
    cCtx.beginPath();
    cCtx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    cCtx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    cCtx.stroke();
  }

  // Subtle center star seal
  cCtx.strokeStyle = 'rgba(210, 175, 110, 0.5)';
  cCtx.lineWidth = 2;
  cCtx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 === 0 ? 68 : 28;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) cCtx.moveTo(px, py);
    else cCtx.lineTo(px, py);
  }
  cCtx.stroke();

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);

  cachedFloor = { map, bumpMap, roughnessMap };
  return cachedFloor;
}

/**
 * Generates weathered ashlar gothic stonework for sanctuary pillars & arches.
 */
export function getPillarStoneTextures(): PillarTextureSet {
  if (cachedPillar) return cachedPillar;

  const w = 512;
  const h = 512;
  const cCanvas = document.createElement('canvas');
  const bCanvas = document.createElement('canvas');
  cCanvas.width = bCanvas.width = w;
  cCanvas.height = bCanvas.height = h;

  const cCtx = cCanvas.getContext('2d')!;
  const bCtx = bCanvas.getContext('2d')!;

  const grad = cCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#303442');
  grad.addColorStop(0.65, '#252834');
  grad.addColorStop(1, '#15161d');
  cCtx.fillStyle = grad;
  cCtx.fillRect(0, 0, w, h);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, w, h);

  // Horizontal masonry courses + vertical stone fluting
  const rows = 8;
  const rowH = h / rows;
  cCtx.strokeStyle = '#111218';
  cCtx.lineWidth = 3;
  bCtx.strokeStyle = '#202020';
  bCtx.lineWidth = 4;

  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    cCtx.beginPath();
    cCtx.moveTo(0, y);
    cCtx.lineTo(w, y);
    cCtx.stroke();

    bCtx.beginPath();
    bCtx.moveTo(0, y);
    bCtx.lineTo(w, y);
    bCtx.stroke();

    const cols = 4;
    const offset = (r % 2) * (w / (cols * 2));
    for (let c = 0; c < cols; c++) {
      const x = (c * (w / cols) + offset) % w;
      cCtx.beginPath();
      cCtx.moveTo(x, y);
      cCtx.lineTo(x, y + rowH);
      cCtx.stroke();
      bCtx.beginPath();
      bCtx.moveTo(x, y);
      bCtx.lineTo(x, y + rowH);
      bCtx.stroke();
    }
  }

  // Stone grain
  for (let i = 0; i < 3200; i++) {
    const rx = hash2d(i, 11) * w;
    const ry = hash2d(i, 12) * h;
    const s = 1 + hash2d(i, 13) * 4;
    const v = 32 + Math.floor(hash2d(i, 14) * 28);
    cCtx.fillStyle = `rgba(${v}, ${v + 3}, ${v + 9}, 0.45)`;
    cCtx.fillRect(rx, ry, s, s);
  }

  const map = new THREE.CanvasTexture(cCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;

  cachedPillar = { map, bumpMap };
  return cachedPillar;
}

/**
 * Generates a soft radial Gaussian glow texture so embers, flames & sparks are luminous orbs.
 */
export function getSoftGlowTexture(): THREE.CanvasTexture {
  if (cachedGlow) return cachedGlow;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.18, 'rgba(255, 240, 200, 0.85)');
  grad.addColorStop(0.45, 'rgba(235, 175, 95, 0.32)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  cachedGlow = new THREE.CanvasTexture(canvas);
  cachedGlow.colorSpace = THREE.SRGBColorSpace;
  return cachedGlow;
}
