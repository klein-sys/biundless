import { Ray, Sphere, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getFirstProjectileHit, getResonanceDirection } from '../src/combat/resonanceAim';

describe('resonance projectile aim', () => {
  it.each([-0.6, 0.6])('follows the camera when aiming vertically (%s)', (pitch) => {
    const direction = new Vector3(0.45, pitch, -1).normalize();
    const origin = new Vector3(4, 6, 8);
    const view = new Ray(origin, direction);
    const result = getResonanceDirection(view, origin, 42, []);
    expect(result.distanceTo(direction)).toBeLessThan(1e-8);
  });

  it('converges a shoulder-camera cast on the target under the center of the view', () => {
    const view = new Ray(new Vector3(2, 4, 6), new Vector3(0, 0, -1));
    const muzzle = new Vector3(0, 1.5, 0);
    const target = { hitbox: new Sphere(new Vector3(2, 4, -3), 1) };
    const result = getResonanceDirection(view, muzzle, 42, [target]);

    expect(getFirstProjectileHit(new Ray(muzzle, result), 6, [target])?.target).toBe(target);
  });

  it('aims at an off-screen target only when a lock-on point is supplied', () => {
    const muzzle = new Vector3(0, 1.5, 0);
    const view = new Ray(muzzle, new Vector3(0, 0, -1));
    const boss = { hitbox: new Sphere(new Vector3(9, 6, -4), 2.5) };

    expect(getResonanceDirection(view, muzzle, 42, [boss]).distanceTo(view.direction))
      .toBeLessThan(1e-8);
    expect(getResonanceDirection(view, muzzle, 42, [boss], boss.hitbox.center)
      .distanceTo(boss.hitbox.center.clone().sub(muzzle).normalize())).toBeLessThan(1e-8);
  });

  it('hits the first body crossed in a frame and misses when the shot flies above it', () => {
    const wolf = { hitbox: new Sphere(new Vector3(0, 1, -5), 1.25) };
    const boss = { hitbox: new Sphere(new Vector3(0, 2, -14), 2.5) };
    const direction = new Vector3(0, 0, -1);
    const view = new Ray(new Vector3(0, 1, 0), direction);

    expect(getFirstProjectileHit(view, 18, [boss, wolf])).toEqual({ target: wolf, distance: 3.75 });
    expect(getFirstProjectileHit(view, 3, [wolf])).toBeNull();
    expect(getFirstProjectileHit(new Ray(new Vector3(0, 8, 0), direction), 18, [boss, wolf]))
      .toBeNull();
  });
});
