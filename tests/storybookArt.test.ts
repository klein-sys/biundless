import { expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { fitScenery } from '../src/engine/StorybookArt';

it('fits imported models within their footprint and grounds them after rotation', () => {
  const box = new Box3(new Vector3(-2, -1, 1), new Vector3(2, 7, 7));
  const transform = fitScenery(box, 12, 3, -8, Math.PI / 2, 6, 3);
  const result = box.clone().applyMatrix4(transform);
  expect(result.min.y).toBeCloseTo(3);
  expect(result.getCenter(new Vector3()).x).toBeCloseTo(12);
  expect(result.getCenter(new Vector3()).z).toBeCloseTo(-8);
  expect(result.getSize(new Vector3()).y).toBeCloseTo(3);
  expect(result.getSize(new Vector3()).x).toBeLessThanOrEqual(6);
});

it('keeps a diagonally rotated import inside both footprint axes', () => {
  const box = new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1));
  const transform = fitScenery(box, 0, 0, 0, Math.PI / 4, 2, 2);
  const size = box.clone().applyMatrix4(transform).getSize(new Vector3());
  expect(size.x).toBeCloseTo(2);
  expect(size.z).toBeCloseTo(2);
});
