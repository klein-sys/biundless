import * as THREE from 'three';
import { getTerrainHeight, WORLD_PLAYABLE_RADIUS } from '../world/SunlitValley';

export type CameraPOV = 'third' | 'first';

export class DualCameraController {
  public pov: CameraPOV = 'third';
  public yaw = 0; // radians around Y
  public pitch = 0.22; // radians looking slightly down in 3rd POV
  public lockedOn = false;

  private povBlend = 0; // 0 = 3rd person, 1 = 1st person
  private trauma = 0;
  private shakeClock = 0;
  private readonly smoothedPos = new THREE.Vector3(0, 3.5, 16);
  private readonly smoothedLook = new THREE.Vector3(0, 1.5, 4);
  private readonly shakeOffset = new THREE.Vector3();

  public togglePov(): CameraPOV {
    this.pov = this.pov === 'third' ? 'first' : 'third';
    return this.pov;
  }

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  public resetSmoothing(playerPos: THREE.Vector3, yaw: number): void {
    this.yaw = yaw;
    const backX = Math.sin(yaw);
    const backZ = Math.cos(yaw);
    this.smoothedPos.set(playerPos.x + backX * 6.5, playerPos.y + 3.2, playerPos.z + backZ * 6.5);
    this.smoothedLook.set(playerPos.x - backX * 4, playerPos.y + 1.5, playerPos.z - backZ * 4);
  }

  public applyLookDelta(dx: number, dy: number, sensitivity: number): void {
    const scale = 0.0028 * sensitivity;
    this.yaw -= dx * scale;
    const minPitch = this.pov === 'first' ? -1.3 : -0.42;
    const maxPitch = this.pov === 'first' ? 1.3 : 1.05;
    this.pitch = Math.max(minPitch, Math.min(maxPitch, this.pitch + dy * scale));
  }

  public getForwardXZ(out: THREE.Vector2): void {
    out.set(-Math.sin(this.yaw), -Math.cos(this.yaw)).normalize();
  }

  public getRightXZ(out: THREE.Vector2): void {
    out.set(Math.cos(this.yaw), -Math.sin(this.yaw)).normalize();
  }

  public update(
    camera: THREE.PerspectiveCamera,
    playerPos: THREE.Vector3,
    lockTarget: THREE.Vector3 | null,
    dt: number,
    realDt: number,
    shakeStrength: number,
  ): void {
    if (this.lockedOn && lockTarget) {
      const toX = lockTarget.x - playerPos.x;
      const toZ = lockTarget.z - playerPos.z;
      const targetYaw = Math.atan2(-toX, -toZ);
      let diff = targetYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const steer = 1 - Math.exp(-9 * dt);
      this.yaw += diff * steer;
    }

    const targetBlend = this.pov === 'first' ? 1 : 0;
    this.povBlend += (targetBlend - this.povBlend) * (1 - Math.exp(-14 * dt));

    const orbitDist = 6.5;
    const shoulderOffset = 0.72;
    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);

    const backX = Math.sin(this.yaw) * cosPitch;
    const backY = sinPitch;
    const backZ = Math.cos(this.yaw) * cosPitch;

    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    const thirdPos = new THREE.Vector3(
      playerPos.x + backX * orbitDist + rightX * shoulderOffset,
      playerPos.y + 1.9 + backY * orbitDist,
      playerPos.z + backZ * orbitDist + rightZ * shoulderOffset,
    );

    // Soft open-world valley edge clamp
    const radialDist = Math.hypot(thirdPos.x, thirdPos.z);
    const maxCamR = WORLD_PLAYABLE_RADIUS + 4;
    if (radialDist > maxCamR) {
      const s = maxCamR / radialDist;
      thirdPos.x *= s;
      thirdPos.z *= s;
    }

    // Never dip camera below rolling meadow terrain
    const groundUnderCam = getTerrainHeight(thirdPos.x, thirdPos.z);
    if (thirdPos.y < groundUnderCam + 0.85) {
      thirdPos.y = groundUnderCam + 0.85;
    }

    const thirdLook =
      lockTarget && this.lockedOn
        ? new THREE.Vector3(
            (playerPos.x + lockTarget.x) * 0.5,
            Math.max(playerPos.y + 1.5, (playerPos.y + lockTarget.y) * 0.5),
            (playerPos.z + lockTarget.z) * 0.5,
          )
        : new THREE.Vector3(
            playerPos.x - Math.sin(this.yaw) * 4.5 + rightX * 0.35,
            playerPos.y + 1.48 - sinPitch * 2.2,
            playerPos.z - Math.cos(this.yaw) * 4.5 + rightZ * 0.35,
          );

    const firstPos = new THREE.Vector3(playerPos.x, playerPos.y + 1.66, playerPos.z);
    const firstLook = new THREE.Vector3(
      firstPos.x - Math.sin(this.yaw) * cosPitch * 10,
      firstPos.y - sinPitch * 10,
      firstPos.z - Math.cos(this.yaw) * cosPitch * 10,
    );

    const desiredPos = thirdPos.lerp(firstPos, this.povBlend);
    const desiredLook = thirdLook.lerp(firstLook, this.povBlend);

    const rate = 12 + this.povBlend * 22;
    const alpha = 1 - Math.exp(-rate * dt);
    this.smoothedPos.lerp(desiredPos, alpha);
    this.smoothedLook.lerp(desiredLook, alpha);

    // Trauma-based screen shake decaying in real time (survives hit-stop)
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - 1.5 * realDt);
      this.shakeClock += realDt * 34;
      const mag = this.trauma * this.trauma * 0.28 * shakeStrength;
      this.shakeOffset.set(
        Math.sin(this.shakeClock * 1.7) * mag,
        Math.cos(this.shakeClock * 2.3) * mag * 0.75,
        Math.sin(this.shakeClock * 1.1) * mag * 0.5,
      );
    } else {
      this.shakeOffset.set(0, 0, 0);
    }

    camera.position.copy(this.smoothedPos).add(this.shakeOffset);
    camera.lookAt(this.smoothedLook);
  }
}
