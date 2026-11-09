/** Clip a triangle at surveyed slab heights, interpolating texture coordinates
 * and normals so wall triangles crossing storeys don't disappear as a whole. */
function interpolate(a, b, t) {
  const blend = (x, y) => x.map((v, i) => v + (y[i] - v) * t);
  const p = blend(a.p, b.p),
    n = a.n && b.n ? blend(a.n, b.n) : null,
    uv = a.uv && b.uv ? blend(a.uv, b.uv) : null;
  if (n) {
    const length = Math.hypot(...n);
    if (length) for (let i = 0; i < 3; i++) n[i] /= length;
  }
  return { p, n, uv };
}
function clipPlane(polygon, height, above) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      inA = above ? a.p[1] >= height : a.p[1] <= height,
      inB = above ? b.p[1] >= height : b.p[1] <= height;
    if (inA) result.push(a);
    if (inA !== inB)
      result.push(interpolate(a, b, (height - a.p[1]) / (b.p[1] - a.p[1])));
  }
  return result;
}
export function clipTriangleToFloor(vertices, baseY, height) {
  const min = Math.min(...vertices.map((v) => v.p[1])),
    max = Math.max(...vertices.map((v) => v.p[1])),
    top = baseY + height;
  if (max < baseY || min >= top) return [];
  const polygon = clipPlane(clipPlane(vertices, baseY, true), top, false),
    triangles = [];
  for (let i = 1; i < polygon.length - 1; i++) {
    const tri = [polygon[0], polygon[i], polygon[i + 1]],
      a = tri[0].p,
      b = tri[1].p,
      c = tri[2].p,
      u = b.map((v, i) => v - a[i]),
      v = c.map((v, i) => v - a[i]);
    if (
      Math.hypot(
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ) > 1e-12
    )
      triangles.push(tri);
  }
  return triangles;
}
