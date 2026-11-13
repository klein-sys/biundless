import * as THREE from 'three';
import { getSoftGlowTexture } from './ProceduralTextures';
import { createSlashArcMaterial } from './Shaders';
import { getTerrainHeight } from '../world/SunlitValley';

interface ActiveSlashArc {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  life: number;
  maxLife: number;
  startYaw: number;
  sweepDir: number;
}

export interface ActiveGroundTelegraph {
  group: THREE.Group;
  outerRing: THREE.Mesh;
  innerDisc: THREE.Mesh;
  x: number;
  z: number;
  radius: number;
  life: number;
  duration: number;
  colorHex: number;
  onDetonate?: () => void;
}

interface GlowSpark {
  sprite: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  startScale: number;
  active: boolean;
}

export class VfxSystem {
  private readonly scene: THREE.Scene;
  private readonly slashes: ActiveSlashArc[] = [];
  private readonly telegraphs: ActiveGroundTelegraph[] = [];
  private readonly sparkPool: GlowSpark[] = [];
  private readonly slashGeo: THREE.RingGeometry;
  private readonly glowTexture: THREE.CanvasTexture;

  constructor(scene: THREE.Scene, maxSparks = 90) {
    this.scene = scene;
    this.glowTexture = getSoftGlowTexture();
    // Bold crescent ribbon arc spanning ~180 degrees
    this.slashGeo = new THREE.RingGeometry(0.9, 2.55, 28, 1, -Math.PI * 0.5, Math.PI);
    this.slashGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < maxSparks; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.scene.add(sprite);
      this.sparkPool.push({
        sprite,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.4,
        startScale: 0.35,
        active: false,
      });
    }
  }

  public spawnSlashArc(
    origin: THREE.Vector3,
    yaw: number,
    comboStep: number,
    colorHex: number,
  ): void {
    const material = createSlashArcMaterial(colorHex);
    const mesh = new THREE.Mesh(this.slashGeo, material);
    mesh.position.set(origin.x, origin.y + 1.32, origin.z);
    // Angled diagonal slash visible clearly in both 3rd-person and 1st-person POV
    const tilt = comboStep % 2 === 0 ? 0.58 : -0.58;
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(0.28, yaw + Math.PI * 0.5, tilt);
    this.scene.add(mesh);

    this.slashes.push({
      mesh,
      material,
      life: 0,
      maxLife: 0.24,
      startYaw: yaw + Math.PI * 0.5,
      sweepDir: comboStep % 2 === 0 ? 1 : -1,
    });
  }

  public spawnBurst(
    origin: THREE.Vector3,
    colorHex: number,
    count = 14,
    speed = 5.5,
    scale = 0.42,
  ): void {
    let spawned = 0;
    for (const p of this.sparkPool) {
      if (p.active) continue;
      p.active = true;
      p.life = 0;
      p.maxLife = 0.32 + Math.random() * 0.28;
      p.startScale = scale * (0.7 + Math.random() * 0.65);

      const theta = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.2) * 1.4;
      const spd = speed * (0.45 + Math.random() * 0.75);
      p.vx = Math.cos(theta) * spd;
      p.vy = elevation * spd * 0.65 + 1.2;
      p.vz = Math.sin(theta) * spd;

      p.sprite.position.copy(origin);
      p.sprite.scale.setScalar(p.startScale);
      p.sprite.material.color.setHex(colorHex);
      p.sprite.material.opacity = 1.0;
      p.sprite.visible = true;

      spawned++;
      if (spawned >= count) break;
    }
  }

  public spawnTrail(origin: THREE.Vector3, colorHex: number, scale = 0.3): void {
    for (const p of this.sparkPool) {
      if (p.active) continue;
      p.active = true;
      p.life = 0;
      p.maxLife = 0.22;
      p.startScale = scale;
      p.vx = (Math.random() - 0.5) * 0.8;
      p.vy = 0.3 + Math.random() * 0.5;
      p.vz = (Math.random() - 0.5) * 0.8;

      p.sprite.position.copy(origin);
      p.sprite.scale.setScalar(scale);
      p.sprite.material.color.setHex(colorHex);
      p.sprite.material.opacity = 0.85;
      p.sprite.visible = true;
      return;
    }
  }

  public spawnGroundTelegraph(
    x: number,
    z: number,
    radius: number,
    duration = 0.8,
    colorHex = 0xf59e0b,
    onDetonate?: () => void,
  ): ActiveGroundTelegraph {
    const group = new THREE.Group();
    const groundY = getTerrainHeight(x, z) + 0.08;
    group.position.set(x, groundY, z);
    group.rotation.x = -Math.PI / 2;

    // Outer Ring
    const outerMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const outerGeo = new THREE.RingGeometry(radius * 0.92, radius, 36);
    const outerRing = new THREE.Mesh(outerGeo, outerMat);
    group.add(outerRing);

    // Inner expanding warning disc
    const innerMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const innerGeo = new THREE.CircleGeometry(radius * 0.9, 36);
    const innerDisc = new THREE.Mesh(innerGeo, innerMat);
    innerDisc.scale.set(0.01, 0.01, 1);
    group.add(innerDisc);

    this.scene.add(group);

    const telegraph: ActiveGroundTelegraph = {
      group,
      outerRing,
      innerDisc,
      x,
      z,
      radius,
      life: 0,
      duration,
      colorHex,
      onDetonate,
    };
    this.telegraphs.push(telegraph);
    return telegraph;
  }

  public step(dt: number): void {
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.life += dt;
      const progress = Math.min(1, s.life / s.maxLife);
      s.material.uniforms.uProgress.value = progress;
      s.mesh.rotation.y = s.startYaw + s.sweepDir * (progress - 0.5) * 1.15;
      s.mesh.scale.setScalar(0.95 + progress * 0.32);

      if (s.life >= s.maxLife) {
        this.scene.remove(s.mesh);
        s.material.dispose();
        this.slashes.splice(i, 1);
      }
    }

    // Update Ground Runic Telegraphs
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      t.life += dt;
      const prog = Math.min(1.0, t.life / t.duration);

      // Inner disc expands radially to fill the warning circle
      const scaleProg = Math.max(0.01, prog);
      t.innerDisc.scale.set(scaleProg, scaleProg, 1);

      // Outer ring pulses faster as impact nears
      const pulseFreq = 8.0 + prog * 16.0;
      (t.outerRing.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(t.life * pulseFreq) * 0.45;
      (t.innerDisc.material as THREE.MeshBasicMaterial).opacity = 0.2 + prog * 0.45;

      if (t.life >= t.duration) {
        // Trigger detonation
        if (t.onDetonate) {
          t.onDetonate();
        }
        // Spawn energetic impact burst
        this.spawnBurst(
          new THREE.Vector3(t.x, getTerrainHeight(t.x, t.z) + 0.3, t.z),
          t.colorHex,
          20,
          6.5,
          0.45
        );
        this.scene.remove(t.group);
        t.outerRing.geometry.dispose();
        (t.outerRing.material as THREE.Material).dispose();
        t.innerDisc.geometry.dispose();
        (t.innerDisc.material as THREE.Material).dispose();
        this.telegraphs.splice(i, 1);
      }
    }

    for (const p of this.sparkPool) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const t = p.life / p.maxLife;
      p.vy -= 6.5 * dt;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y = Math.max(0.08, p.sprite.position.y + p.vy * dt);
      p.sprite.position.z += p.vz * dt;
      p.sprite.scale.setScalar(p.startScale * (1 - t * 0.72));
      p.sprite.material.opacity = (1 - t) * 0.95;
    }
  }

  public clear(): void {
    for (const s of this.slashes) {
      this.scene.remove(s.mesh);
      s.material.dispose();
    }
    this.slashes.length = 0;
    for (const t of this.telegraphs) {
      this.scene.remove(t.group);
      t.outerRing.geometry.dispose();
      (t.outerRing.material as THREE.Material).dispose();
      t.innerDisc.geometry.dispose();
      (t.innerDisc.material as THREE.Material).dispose();
    }
    this.telegraphs.length = 0;
    for (const p of this.sparkPool) {
      p.active = false;
      p.sprite.visible = false;
    }
  }
}
