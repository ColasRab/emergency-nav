import type { Vec2, Vec3 } from "../geo/transform";
export type Intrinsics = { fx: number; fy: number; cx: number; cy: number };
export type MarkerPose = {
  camera: Vec3;
  forward: Vec3;
  viewAngleDeg: number;
  reprojectionRmsPx: number;
};
const dot = (a: number[], b: number[]) =>
  a.reduce((s, v, i) => s + v * b[i], 0);
const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  if (n < 1e-10) throw new Error("Degenerate marker pose");
  return v.map((x) => x / n) as Vec3;
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function solve(matrix: number[][], target: number[]): number[] {
  const a = matrix.map((r, i) => [...r, target[i]]),
    n = target.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-10)
      throw new Error("QR corners are degenerate");
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const d = a[col][col];
    for (let k = col; k <= n; k++) a[col][k] /= d;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = a[row][col];
      for (let k = col; k <= n; k++) a[row][k] -= f * a[col][k];
    }
  }
  return a.map((r) => r[n]);
}
export function intrinsicsFromFov(
  width: number,
  height: number,
  fovDeg: number,
  focalFraction?: number,
): Intrinsics {
  const f = focalFraction
    ? focalFraction * width
    : width / (2 * Math.tan((fovDeg * Math.PI) / 360));
  return { fx: f, fy: f, cx: width / 2, cy: height / 2 };
}
export function calibrateFocalFraction(
  sidePx: number,
  sizeMm: number,
  distanceM: number,
  width: number,
): number {
  if (sidePx <= 0 || sizeMm <= 0 || distanceM <= 0 || width <= 0)
    throw new Error("Invalid camera calibration");
  return (sidePx * distanceM) / (sizeMm / 1000) / width;
}
/** Corner order: top-left, top-right, bottom-right, bottom-left. Sticker frame:
 * X points right on the printed code, Y up, Z out of the wall toward the reader.
 * Plane homography is normalized by K, then decomposed and orthonormalized.
 */
export function estimateMarkerPose(
  corners: Vec2[],
  sizeMm: number,
  k: Intrinsics,
): MarkerPose {
  if (
    corners.length !== 4 ||
    sizeMm <= 0 ||
    k.fx <= 0 ||
    k.fy <= 0 ||
    corners.flat().some((n) => !Number.isFinite(n))
  )
    throw new Error("Invalid QR geometry");
  const h = sizeMm / 2000,
    plane: Vec2[] = [
      [-h, h],
      [h, h],
      [h, -h],
      [-h, -h],
    ],
    matrix: number[][] = [],
    target: number[] = [];
  plane.forEach(([x, y], i) => {
    const u = (corners[i][0] - k.cx) / k.fx,
      v = (corners[i][1] - k.cy) / k.fy;
    matrix.push(
      [x, y, 1, 0, 0, 0, -u * x, -u * y],
      [0, 0, 0, x, y, 1, -v * x, -v * y],
    );
    target.push(u, v);
  });
  const a = solve(matrix, target);
  const c1: Vec3 = [a[0], a[3], a[6]],
    c2: Vec3 = [a[1], a[4], a[7]],
    c3: Vec3 = [a[2], a[5], 1];
  const scale = 2 / (Math.hypot(...c1) + Math.hypot(...c2)),
    r1 = unit(c1),
    projection = dot(c2, r1),
    r2 = unit(c2.map((v, i) => v - projection * r1[i]) as Vec3),
    r3 = cross(r1, r2),
    t = c3.map((v) => v * scale) as Vec3;
  const camera: Vec3 = [-dot(r1, t), -dot(r2, t), -dot(r3, t)],
    forward: Vec3 = [r1[2], r2[2], r3[2]];
  if (camera[2] <= 0) throw new Error("Face the printed side of the code.");
  let error = 0;
  plane.forEach(([x, y], i) => {
    const p = t.map((v, j) => v + r1[j] * x + r2[j] * y);
    if (p[2] <= 0) throw new Error("QR is behind the camera");
    error +=
      ((k.fx * p[0]) / p[2] + k.cx - corners[i][0]) ** 2 +
      ((k.fy * p[1]) / p[2] + k.cy - corners[i][1]) ** 2;
  });
  return {
    camera,
    forward,
    viewAngleDeg:
      (Math.acos(Math.min(1, camera[2] / Math.hypot(...camera))) * 180) /
      Math.PI,
    reprojectionRmsPx: Math.sqrt(error / 4),
  };
}
export { markerToModel } from "../geo/transform";
export function shortestSide(corners: Vec2[]): number {
  return Math.min(
    ...corners.map((p, i) =>
      Math.hypot(
        p[0] - corners[(i + 1) % 4][0],
        p[1] - corners[(i + 1) % 4][1],
      ),
    ),
  );
}
export function blurVariance(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bounds?: { left: number; top: number; right: number; bottom: number },
): number {
  const gray = (x: number, y: number) =>
    data[(y * width + x) * 4] * 0.299 +
    data[(y * width + x) * 4 + 1] * 0.587 +
    data[(y * width + x) * 4 + 2] * 0.114;
  let sum = 0,
    sum2 = 0,
    n = 0;
  const left = Math.max(1, Math.floor(bounds?.left ?? 1)),
    right = Math.min(width - 1, Math.ceil(bounds?.right ?? width - 1)),
    top = Math.max(1, Math.floor(bounds?.top ?? 1)),
    bottom = Math.min(height - 1, Math.ceil(bounds?.bottom ?? height - 1));
  for (let y = top; y < bottom; y += 2)
    for (let x = left; x < right; x += 2) {
      const v =
        gray(x - 1, y) +
        gray(x + 1, y) +
        gray(x, y - 1) +
        gray(x, y + 1) -
        4 * gray(x, y);
      sum += v;
      sum2 += v * v;
      n++;
    }
  return n ? sum2 / n - (sum / n) ** 2 : 0;
}
