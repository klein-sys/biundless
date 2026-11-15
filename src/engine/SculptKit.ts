import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * SculptKit — shared procedural sculpting helpers for hero models (bosses, NPCs).
 *
 * - `sweepGeometry`: sweeps a variable-radius, optionally elliptical cross-section along a spline,
 *   which gives organic bodies, horns, hair ribbons, gowns and ribs instead of stacked primitives.
 * - `PixelCanvas`: paints textures into a plain RGBA buffer (no DOM), so models also build in
 *   Node-based unit tests.
 * - `mergeStaticMeshes`: bakes static descendants per material to keep draw calls low.
 * - `solveTwoBoneArm` / `alignSegmentDown`: analytic two-bone IK for limbs.
 */

const _T = new THREE.Vector3();
const _N = new THREE.Vector3();
const _B = new THREE.Vector3();
const _C = new THREE.Vector3();
const _P = new THREE.Vector3();
const _prevN = new THREE.Vector3();
const _tmpColor = new THREE.Color();

export const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Piecewise-linear interpolation through sorted [t, value] keys. */
export function lerpKeys(keys: readonly (readonly [number, number])[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const u = (t - t0) / Math.max(1e-6, t1 - t0);
      const s = u * u * (3 - 2 * u); // smoothstep between keys for organic profiles
      return v0 + (v1 - v0) * s;
    }
  }
  return keys[keys.length - 1][1];
}

export interface SweepOptions {
  /** Segments around the cross-section. */
  radial?: number;
  /** Radius at path parameter t∈[0,1] and angle a (a=0 points along the "up" reference). */
  radius: (t: number, a: number) => number;
  /** Cross-section scale along the binormal (sideways / width). */
  scaleX?: (t: number) => number;
  /** Cross-section scale along the normal (up / depth). */
  scaleY?: (t: number) => number;
  /** Offset along the path tangent (e.g. tattered or trailing hems). */
  lift?: (t: number, a: number) => number;
  /** Reference direction that a=0 points toward (projected onto each ring plane). */
  up?: THREE.Vector3;
  capStart?: boolean;
  capEnd?: boolean;
  /** Optional vertex colour per ring vertex. */
  color?: (t: number, a: number, out: THREE.Color) => void;
  /** Texture repeat along the path (uv.x = t * uvScaleU, uv.y = around). */
  uvScaleU?: number;
}

/**
 * Sweeps a cross-section along a Catmull-Rom spline through `points`, using parallel-transport
 * frames seeded from `up` so the a=0 side stays consistent (e.g. a creature's back).
 */
export function sweepGeometry(points: THREE.Vector3[], tubular: number, opts: SweepOptions): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const radial = opts.radial ?? 12;
  const up = (opts.up ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
  const uvScaleU = opts.uvScaleU ?? 1;
  const ringSize = radial + 1;

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const centers: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];

  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, _C);
    curve.getTangentAt(t, _T).normalize();
    if (i === 0) {
      _N.copy(up).addScaledVector(_T, -up.dot(_T));
      if (_N.lengthSq() < 1e-6) _N.set(1, 0, 0).addScaledVector(_T, -_T.x);
    } else {
      _N.copy(_prevN).addScaledVector(_T, -_prevN.dot(_T));
    }
    _N.normalize();
    _prevN.copy(_N);
    _B.crossVectors(_T, _N).normalize();
    centers.push(_C.clone());
    tangents.push(_T.clone());

    const sx = opts.scaleX ? opts.scaleX(t) : 1;
    const sy = opts.scaleY ? opts.scaleY(t) : 1;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const r = Math.max(0.0015, opts.radius(t, a));
      _P.copy(_C)
        .addScaledVector(_N, Math.cos(a) * r * sy)
        .addScaledVector(_B, Math.sin(a) * r * sx);
      if (opts.lift) _P.addScaledVector(_T, opts.lift(t, a));
      positions.push(_P.x, _P.y, _P.z);
      uvs.push(t * uvScaleU, j / radial);
      if (opts.color) {
        opts.color(t, a, _tmpColor);
        colors.push(_tmpColor.r, _tmpColor.g, _tmpColor.b);
      }
    }
  }

  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ringSize + j;
      const b = (i + 1) * ringSize + j;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, d, b, b, d, c);
    }
  }

  // Caps get their own vertices so they shade flat instead of smearing the side normals.
  const addCap = (ring: number, outward: 1 | -1) => {
    const base = positions.length / 3;
    const c = centers[ring];
    positions.push(c.x, c.y, c.z);
    uvs.push(ring === 0 ? 0 : uvScaleU, 0.5);
    if (opts.color) {
      const t = ring === 0 ? 0 : 1;
      opts.color(t, Math.PI * 0.5, _tmpColor);
      colors.push(_tmpColor.r, _tmpColor.g, _tmpColor.b);
    }
    for (let j = 0; j <= radial; j++) {
      const src = (ring * ringSize + j) * 3;
      positions.push(positions[src], positions[src + 1], positions[src + 2]);
      uvs.push(ring === 0 ? 0 : uvScaleU, j / radial);
      if (opts.color) colors.push(colors[src], colors[src + 1], colors[src + 2]);
    }
    for (let j = 0; j < radial; j++) {
      const p0 = base + 1 + j;
      const p1 = base + 2 + j;
      if (outward === 1) indices.push(base, p0, p1);
      else indices.push(base, p1, p0);
    }
  };
  if (opts.capStart) addCap(0, -1);
  if (opts.capEnd) addCap(tubular, 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (opts.color) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  computeSafeNormals(geo);

  // Weld the UV seam's normals so the tube shades smoothly all the way around.
  const normals = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i <= tubular; i++) {
    const a = i * ringSize;
    const b = a + radial;
    _P.set(
      normals.getX(a) + normals.getX(b),
      normals.getY(a) + normals.getY(b),
      normals.getZ(a) + normals.getZ(b)
    ).normalize();
    normals.setXYZ(a, _P.x, _P.y, _P.z);
    normals.setXYZ(b, _P.x, _P.y, _P.z);
  }
  normals.needsUpdate = true;
  return geo;
}

/**
 * Recomputes normals and repairs degenerate (zero-length) ones, e.g. collapsed sphere poles after
 * vertex sculpting. A zero normal normalizes to NaN in the shader, which bloom then smears across
 * the whole frame.
 */
export function computeSafeNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeVertexNormals();
  const n = geo.attributes.normal as THREE.BufferAttribute;
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) {
    const len = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
    if (len > 1e-6 && Number.isFinite(len)) continue;
    _P.set(p.getX(i), p.getY(i), p.getZ(i));
    if (_P.lengthSq() < 1e-12) _P.set(0, 1, 0);
    _P.normalize();
    n.setXYZ(i, _P.x, _P.y, _P.z);
  }
  n.needsUpdate = true;
  return geo;
}

/** Tapered round tube (horns, bones, branches, whiskers). */
export function taperTube(
  points: THREE.Vector3[],
  r0: number,
  r1: number,
  tubular = 12,
  radial = 8,
  extra: Partial<SweepOptions> = {}
): THREE.BufferGeometry {
  return sweepGeometry(points, tubular, {
    radial,
    radius: (t) => r0 + (r1 - r0) * t,
    ...extra,
  });
}

/** Closed decorative loop tube (halos, rings with wave profiles). */
export function loopTube(fn: (u: number) => THREE.Vector3, segments: number, tube: number, radial = 6): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) pts.push(fn(i / segments));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), segments, tube, radial, true);
}

// ---------------------------------------------------------------------------------------------
// Pixel painting (DOM-free texture generation)
// ---------------------------------------------------------------------------------------------

export type RGB = readonly [number, number, number];

export const hexRgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Smooth value noise in [0,1]; `period` makes it tile horizontally. */
export function valueNoise(x: number, y: number, period = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const wrap = (v: number) => (period > 0 ? ((v % period) + period) % period : v);
  const h = (ix: number, iy: number) => hash2(wrap(ix), iy);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * A tiny software canvas. x wraps (textures usually wrap around a tube); y clamps.
 * Row 0 is the bottom of the texture (uv.y = 0), matching DataTexture's default orientation.
 */
export class PixelCanvas {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    fill: RGB = [0, 0, 0]
  ) {
    this.data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      this.data[i * 4] = fill[0];
      this.data[i * 4 + 1] = fill[1];
      this.data[i * 4 + 2] = fill[2];
      this.data[i * 4 + 3] = 255;
    }
  }

  /** Calls `fn(u, v)` (normalised 0..1) for every pixel and writes the returned colour. */
  shade(fn: (u: number, v: number, x: number, y: number) => RGB): this {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = fn((x + 0.5) / this.width, (y + 0.5) / this.height, x, y);
        const i = (y * this.width + x) * 4;
        this.data[i] = c[0];
        this.data[i + 1] = c[1];
        this.data[i + 2] = c[2];
      }
    }
    return this;
  }

  blend(x: number, y: number, c: RGB, alpha: number): void {
    if (alpha <= 0) return;
    const yi = Math.round(y);
    if (yi < 0 || yi >= this.height) return;
    const xi = ((Math.round(x) % this.width) + this.width) % this.width;
    const i = (yi * this.width + xi) * 4;
    const a = Math.min(1, alpha);
    this.data[i] += (c[0] - this.data[i]) * a;
    this.data[i + 1] += (c[1] - this.data[i + 1]) * a;
    this.data[i + 2] += (c[2] - this.data[i + 2]) * a;
  }

  /** Soft-edged filled ellipse (pixel units). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, alpha = 1, soft = 1): void {
    const x0 = Math.floor(cx - rx - soft - 1);
    const x1 = Math.ceil(cx + rx + soft + 1);
    const y0 = Math.floor(cy - ry - soft - 1);
    const y1 = Math.ceil(cy + ry + soft + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x - cx) / Math.max(0.01, rx);
        const dy = (y - cy) / Math.max(0.01, ry);
        const d = Math.sqrt(dx * dx + dy * dy);
        const edge = (1 - d) * Math.min(rx, ry);
        const cov = THREE.MathUtils.clamp(edge / soft + 0.5, 0, 1);
        this.blend(x, y, c, cov * alpha);
      }
    }
  }

  /** Anti-aliased thick line segment (pixel units). */
  line(x0: number, y0: number, x1: number, y1: number, width: number, c: RGB, alpha = 1): void {
    const minX = Math.floor(Math.min(x0, x1) - width - 1);
    const maxX = Math.ceil(Math.max(x0, x1) + width + 1);
    const minY = Math.floor(Math.min(y0, y1) - width - 1);
    const maxY = Math.ceil(Math.max(y0, y1) + width + 1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = Math.max(1e-6, dx * dx + dy * dy);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = THREE.MathUtils.clamp(((x - x0) * dx + (y - y0) * dy) / len2, 0, 1);
        const px = x0 + dx * t - x;
        const py = y0 + dy * t - y;
        const d = Math.sqrt(px * px + py * py);
        const cov = THREE.MathUtils.clamp(width * 0.5 - d + 0.5, 0, 1);
        this.blend(x, y, c, cov * alpha);
      }
    }
  }

  /** Polyline through a parametric curve f(s) → [x, y] in pixel units. */
  curve(f: (s: number) => readonly [number, number], steps: number, width: number, c: RGB, alpha = 1): void {
    let [px, py] = f(0);
    for (let i = 1; i <= steps; i++) {
      const [x, y] = f(i / steps);
      this.line(px, py, x, y, width, c, alpha);
      px = x;
      py = y;
    }
  }

  toTexture(repeatU = 1, repeatV = 1): THREE.DataTexture {
    const tex = new THREE.DataTexture(this.data, this.width, this.height, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatU, repeatV);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }
}

export const mixRgb = (a: RGB, b: RGB, t: number): RGB => {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};

export const scaleRgb = (a: RGB, s: number): RGB => [
  THREE.MathUtils.clamp(a[0] * s, 0, 255),
  THREE.MathUtils.clamp(a[1] * s, 0, 255),
  THREE.MathUtils.clamp(a[2] * s, 0, 255),
];

// ---------------------------------------------------------------------------------------------
// Static mesh baking
// ---------------------------------------------------------------------------------------------

/**
 * Bakes every static descendant mesh of `container` (skipping `keepLive` subtrees that animate)
 * into one merged mesh per material, so a detailed prop costs a handful of draw calls. When a
 * `matte` palette is given, plain matte standard materials (no metalness, emission, transparency
 * or maps) are folded together into a single vertex-coloured material per face side.
 */
export function mergeStaticMeshes(
  container: THREE.Object3D,
  keepLive: readonly THREE.Object3D[] = [],
  matte?: { front: THREE.MeshStandardMaterial; double: THREE.MeshStandardMaterial }
): void {
  container.updateMatrixWorld(true);
  const toContainer = new THREE.Matrix4().copy(container.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  const matteTarget = (mat: THREE.Material): THREE.Material | null => {
    if (!matte || !(mat instanceof THREE.MeshStandardMaterial)) return null;
    if (mat.metalness > 0 || mat.transparent || mat.map || mat.vertexColors || mat.emissive.getHex() !== 0) return null;
    return mat.side === THREE.DoubleSide ? matte.double : matte.front;
  };
  const visit = (obj: THREE.Object3D) => {
    if (keepLive.includes(obj)) return;
    if (obj instanceof THREE.Mesh && !Array.isArray(obj.material) && !(obj instanceof THREE.InstancedMesh)) {
      const key = matteTarget(obj.material) ?? obj.material;
      const list = buckets.get(key) ?? [];
      list.push(obj);
      buckets.set(key, list);
    }
    obj.children.forEach(visit);
  };
  container.children.forEach(visit);

  const bakeMatrix = new THREE.Matrix4();
  buckets.forEach((meshes, material) => {
    if (meshes.length < 2) return;
    const isMatte = material === matte?.front || material === matte?.double;
    const needsColor = isMatte || (material as THREE.MeshStandardMaterial).vertexColors === true;
    const geos = meshes.map((mesh) => {
      bakeMatrix.multiplyMatrices(toContainer, mesh.matrixWorld);
      let baked = mesh.geometry.clone().applyMatrix4(bakeMatrix);
      if (baked.index) baked = baked.toNonIndexed();
      if (isMatte) {
        const { r, g, b } = (mesh.material as THREE.MeshStandardMaterial).color;
        const count = baked.attributes.position.count;
        const colors = new Float32Array(count * 3);
        for (let v = 0; v < count; v++) colors.set([r, g, b], v * 3);
        baked.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      } else if (needsColor && !baked.attributes.color) {
        const count = baked.attributes.position.count;
        baked.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
      }
      // Keep only the attributes every geometry shares so merging never fails.
      for (const name of Object.keys(baked.attributes)) {
        if (!['position', 'normal', 'uv', 'color'].includes(name)) baked.deleteAttribute(name);
      }
      if (!baked.attributes.uv) {
        baked.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(baked.attributes.position.count * 2), 2));
      }
      if (!needsColor && baked.attributes.color) baked.deleteAttribute('color');
      return baked;
    });
    const mergedGeo = mergeGeometries(geos);
    if (!mergedGeo) return;
    const merged = new THREE.Mesh(mergedGeo, material);
    merged.castShadow = meshes.some((m) => m.castShadow);
    merged.receiveShadow = meshes.some((m) => m.receiveShadow);
    meshes.forEach((m) => m.removeFromParent());
    container.add(merged);
  });
}

// ---------------------------------------------------------------------------------------------
// Limb IK
// ---------------------------------------------------------------------------------------------

const IK_DOWN = new THREE.Vector3(0, -1, 0);
const _ikToTarget = new THREE.Vector3();
const _ikBend = new THREE.Vector3();
const _ikSeg = new THREE.Vector3();

/**
 * Analytic two-bone IK: places the elbow so that upper + fore segments reach `target` from
 * `shoulder`, bending toward `pole`. Writes results into `outElbow` / `outHand`.
 */
export function solveTwoBoneArm(
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  upperLen: number,
  foreLen: number,
  pole: THREE.Vector3,
  outElbow: THREE.Vector3,
  outHand: THREE.Vector3
): void {
  const dir = _ikToTarget.subVectors(target, shoulder);
  const rawDist = dir.length();
  if (rawDist < 1e-6) dir.copy(IK_DOWN);
  else dir.divideScalar(rawDist);
  const dist = THREE.MathUtils.clamp(rawDist, Math.abs(upperLen - foreLen) + 1e-3, upperLen + foreLen - 1e-3);
  const cosA = THREE.MathUtils.clamp(
    (upperLen * upperLen + dist * dist - foreLen * foreLen) / (2 * upperLen * dist),
    -1,
    1
  );
  const sinA = Math.sqrt(1 - cosA * cosA);
  const bend = _ikBend.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(1, 0, 0).addScaledVector(dir, -dir.x);
  bend.normalize();
  outElbow.copy(shoulder).addScaledVector(dir, cosA * upperLen).addScaledVector(bend, sinA * upperLen);
  outHand.copy(shoulder).addScaledVector(dir, dist);
}

/** Positions `obj` at `from` and rotates its local -Y axis to point at `to`. */
export function alignSegmentDown(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  obj.position.copy(from);
  _ikSeg.subVectors(to, from);
  if (_ikSeg.lengthSq() < 1e-10) return;
  obj.quaternion.setFromUnitVectors(IK_DOWN, _ikSeg.normalize());
}

/** Frame-rate independent exponential approach toward a target value. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
  const k = 1 - Math.exp(-rate * step);
  return current + (target - current) * k;
}
