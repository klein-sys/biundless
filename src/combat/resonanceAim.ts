import { Vector3, type Ray, type Sphere } from 'three';

interface ProjectileTarget {
  readonly hitbox: Sphere;
}

export function getFirstProjectileHit<T extends ProjectileTarget>(
  ray: Ray,
  maxDistance: number,
  targets: readonly T[],
): { target: T; distance: number } | null {
  const point = new Vector3();
  let closest: { target: T; distance: number } | null = null;
  for (const target of targets) {
    if (target.hitbox.containsPoint(ray.origin)) return { target, distance: 0 };
    if (!ray.intersectSphere(target.hitbox, point)) continue;
    const distance = ray.origin.distanceTo(point);
    if (distance <= maxDistance && (!closest || distance < closest.distance)) {
      closest = { target, distance };
    }
  }
  return closest;
}

export function getResonanceDirection(
  viewRay: Ray,
  origin: Vector3,
  viewDistance: number,
  targets: readonly ProjectileTarget[],
  lockPoint?: Vector3,
): Vector3 {
  const aimPoint = lockPoint?.clone() ?? viewRay.at(
    getFirstProjectileHit(viewRay, viewDistance, targets)?.distance ?? viewDistance,
    new Vector3(),
  );
  const direction = aimPoint.sub(origin);
  return direction.lengthSq() > 1e-8 ? direction.normalize() : viewRay.direction.clone();
}
