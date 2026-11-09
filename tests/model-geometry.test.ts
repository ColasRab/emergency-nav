import { it, expect } from "vitest";
import { clipTriangleToFloor } from "../scripts/model-geometry.mjs";
const vertex = (x: number, y: number, z: number) => ({
  p: [x, y, z],
  n: [0, 0, 1],
  uv: [x, y / 6],
});
it("clips walls spanning floors rather than assigning an entire triangle by centroid", () => {
  const wall = [vertex(0, 0, 0), vertex(2, 6, 0), vertex(0, 6, 0)];
  const low = clipTriangleToFloor(wall, 0, 3),
    high = clipTriangleToFloor(wall, 3, 3);
  expect(low.length).toBeGreaterThan(0);
  expect(high.length).toBeGreaterThan(0);
  for (const tri of low)
    for (const v of tri) expect(v.p[1]).toBeLessThanOrEqual(3);
  for (const tri of high)
    for (const v of tri) expect(v.p[1]).toBeGreaterThanOrEqual(3);
});
it("preserves UV interpolation and assigns a shared slab to the upper floor only", () => {
  const slab = [vertex(0, 3, 0), vertex(1, 3, 0), vertex(0, 3, 1)];
  expect(clipTriangleToFloor(slab, 0, 3)).toHaveLength(0);
  expect(clipTriangleToFloor(slab, 3, 3)).toHaveLength(1);
  const wall = [vertex(0, 0, 0), vertex(2, 6, 0), vertex(0, 6, 0)];
  const vertices = clipTriangleToFloor(wall, 0, 3).flat();
  expect(vertices.some((v) => v.p[1] === 3 && v.uv?.[1] === 0.5)).toBe(true);
});
