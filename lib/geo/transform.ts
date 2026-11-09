/** All model/graph/geographic coordinates and heading conversions live here.
 * Y is up. At rotation 0, model +X is west and +Z is north.
 * This preserves the model's right-handed frame in east/north/up coordinates.
 * Positive rotations are clockwise bearings from north. Distances are meters
 * only after a surveyed scale has been applied.
 */
import type { BuildingConfig } from "../buildings";
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Similarity = {
  dx: number;
  dz: number;
  rotationDeg: number;
  scale: number;
};
const R = 6378137;
const rad = Math.PI / 180;
export function normalizeSignedDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}
export function bearing(dx: number, dz: number): number {
  return (Math.atan2(dx, dz) / rad + 360) % 360;
}
export function smoothBearing(
  previous: number | null,
  next: number,
  weight = 0.2,
): number {
  if (previous === null) return next;
  const x =
      (1 - weight) * Math.cos(previous * rad) + weight * Math.cos(next * rad),
    y = (1 - weight) * Math.sin(previous * rad) + weight * Math.sin(next * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
export function deviceHeading(
  event: {
    webkitCompassHeading?: number;
    alpha: number | null;
    absolute: boolean;
  },
  screenAngle: number,
): number | null {
  const raw =
    typeof event.webkitCompassHeading === "number"
      ? event.webkitCompassHeading
      : event.absolute && event.alpha !== null
        ? 360 - event.alpha
        : null;
  return raw === null || !Number.isFinite(raw)
    ? null
    : (((raw + screenAngle) % 360) + 360) % 360;
}
export function rotate([x, z]: Vec2, rotationDeg: number): Vec2 {
  const a = rotationDeg * rad;
  return [
    x * Math.cos(a) + z * Math.sin(a),
    -x * Math.sin(a) + z * Math.cos(a),
  ];
}
export function applySimilarity(point: Vec2, t: Similarity): Vec2 {
  const [x, z] = rotate(point, t.rotationDeg);
  return [t.dx + t.scale * x, t.dz + t.scale * z];
}
export function invertSimilarity([x, z]: Vec2, t: Similarity): Vec2 {
  return rotate([(x - t.dx) / t.scale, (z - t.dz) / t.scale], -t.rotationDeg);
}
export function graphToModel(
  [x, z, floor]: Vec3,
  config: BuildingConfig,
  offsetY = 0,
): Vec3 {
  if (!config.graphToModel)
    throw new Error("Graph/model alignment has not been surveyed.");
  const level = config.floors.find((f) => f.index === floor);
  if (!level) throw new Error(`Unknown floor ${floor}`);
  const [mx, mz] = applySimilarity([x, z], config.graphToModel);
  return [mx, level.baseY + offsetY, mz];
}
export function modelToGraph(
  [x, , z]: Vec3,
  floor: number,
  config: BuildingConfig,
): Vec3 {
  if (!config.graphToModel)
    throw new Error("Graph/model alignment has not been surveyed.");
  const [gx, gz] = invertSimilarity([x, z], config.graphToModel);
  return [gx, gz, floor];
}
export function lngLatToEnu([lng, lat]: Vec2, origin: Vec2): Vec2 {
  return [
    (lng - origin[0]) * rad * R * Math.cos(origin[1] * rad),
    (lat - origin[1]) * rad * R,
  ];
}
export function enuToLngLat([east, north]: Vec2, origin: Vec2): Vec2 {
  return [
    origin[0] + east / (R * Math.cos(origin[1] * rad)) / rad,
    origin[1] + north / R / rad,
  ];
}
export function modelToLngLatAlt(
  [x, y, z]: Vec3,
  config: BuildingConfig,
): Vec3 {
  const g = config.georef;
  if (!g) throw new Error("Building has not been georeferenced.");
  const [east, north] = rotate([-x * g.scale, z * g.scale], g.rotationDeg);
  const [lng, lat] = enuToLngLat([east, north], g.originLngLat);
  return [lng, lat, g.altitudeM + y * g.scale];
}
export function lngLatAltToModel(
  [lng, lat, alt]: Vec3,
  config: BuildingConfig,
): Vec3 {
  const g = config.georef;
  if (!g) throw new Error("Building has not been georeferenced.");
  const [x, z] = rotate(
    lngLatToEnu([lng, lat], g.originLngLat),
    -g.rotationDeg,
  );
  return [-x / g.scale, (alt - g.altitudeM) / g.scale, z / g.scale];
}
export function graphBearing(
  dx: number,
  dz: number,
  config: BuildingConfig,
): number {
  if (!config.graphToModel || !config.georef)
    throw new Error("Survey heading alignment is missing.");
  const [x, z] = rotate([dx, dz], config.graphToModel.rotationDeg);
  return modelVectorToBearing(x, z, config);
}
export function modelVectorToBearing(
  dx: number,
  dz: number,
  config: BuildingConfig,
): number {
  if (!config.georef) throw new Error("Survey heading alignment is missing.");
  const [east, north] = rotate([-dx, dz], config.georef.rotationDeg);
  return bearing(east, north);
}
export function headingToGraphVector(
  heading: number,
  distance: number,
  config: BuildingConfig,
): Vec2 {
  if (!config.georef || !config.graphToModel)
    throw new Error("Survey heading alignment is missing.");
  const a = (heading - config.georef.rotationDeg) * rad;
  const scale = config.georef.scale * config.graphToModel.scale;
  return rotate(
    [(-Math.sin(a) * distance) / scale, (Math.cos(a) * distance) / scale],
    -config.graphToModel.rotationDeg,
  );
}
/** 2D Umeyama similarity fit (proper rotation, positive scale, no reflection). */
export function fitSimilarity(
  pairs: { source: Vec2; target: Vec2 }[],
): Similarity & { residuals: number[]; rms: number } {
  if (
    pairs.length < 3 ||
    pairs.some((p) =>
      [...p.source, ...p.target].some((n) => !Number.isFinite(n)),
    )
  )
    throw new Error("Supply at least three finite matched points.");
  const n = pairs.length;
  const center = (key: "source" | "target"): Vec2 => [
    pairs.reduce((s, p) => s + p[key][0], 0) / n,
    pairs.reduce((s, p) => s + p[key][1], 0) / n,
  ];
  const a = center("source"),
    b = center("target");
  let dot = 0,
    cross = 0,
    variance = 0,
    xx = 0,
    zz = 0,
    xz = 0;
  for (const p of pairs) {
    const x = p.source[0] - a[0],
      z = p.source[1] - a[1],
      u = p.target[0] - b[0],
      v = p.target[1] - b[1];
    dot += x * u + z * v;
    cross += z * u - x * v;
    variance += x * x + z * z;
    xx += x * x;
    zz += z * z;
    xz += x * z;
  }
  if (variance < 1e-8 || xx * zz - xz * xz < variance * variance * 1e-8)
    throw new Error("Survey points must be distinct and non-collinear.");
  const scale = Math.hypot(dot, cross) / variance;
  if (scale < 1e-8) throw new Error("Degenerate target points.");
  const rotationDeg = Math.atan2(cross, dot) / rad;
  const c = rotate(a, rotationDeg);
  const t = {
    dx: b[0] - scale * c[0],
    dz: b[1] - scale * c[1],
    rotationDeg,
    scale,
  };
  const residuals = pairs.map((p) => {
    const q = applySimilarity(p.source, t);
    return Math.hypot(q[0] - p.target[0], q[1] - p.target[1]);
  });
  return {
    ...t,
    residuals,
    rms: Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n),
  };
}
export function fitGeoreference(
  pairs: { model: Vec2; lngLat: Vec2 }[],
  altitudeM: number,
): NonNullable<BuildingConfig["georef"]> & { residuals: number[] } {
  if (pairs.length < 3) throw new Error("At least three GCPs are required.");
  const origin = pairs[0].lngLat;
  const fit = fitSimilarity(
    pairs.map((p) => ({
      source: [-p.model[0], p.model[1]],
      target: lngLatToEnu(p.lngLat, origin),
    })),
  );
  return {
    originLngLat: enuToLngLat([fit.dx, fit.dz], origin),
    altitudeM,
    rotationDeg: fit.rotationDeg,
    scale: fit.scale,
    residualRmsM: fit.rms,
    residuals: fit.residuals,
  };
}
/** Column-major model-to-Mercator affine matrix. The caller supplies Mapbox's
 * Mercator origin and meterInMercatorCoordinateUnits(), keeping its API out of pure math. */
export function modelMercatorMatrix(
  origin: Vec3,
  meterUnits: number,
  config: BuildingConfig,
): number[] {
  const g = config.georef;
  if (!g) throw new Error("Missing georeference");
  const a = g.rotationDeg * rad,
    c = Math.cos(a),
    s = Math.sin(a),
    k = meterUnits * g.scale;
  return [
    -k * c,
    -k * s,
    0,
    0,
    0,
    0,
    k,
    0,
    k * s,
    -k * c,
    0,
    0,
    origin[0],
    origin[1],
    origin[2],
    1,
  ];
}

// Compatibility functions for legacy callers. Indoor navigation no longer uses GPS calibration.
import type {
  CalibrationSample,
  CalibrationTransform,
  GpsFix,
} from "../calibration";
export function latLonToLocalMeters(
  latitude: number,
  longitude: number,
  originLatitude: number,
  originLongitude: number,
): [number, number] {
  const degreesToRadians = Math.PI / 180;
  const meanLatitude = ((latitude + originLatitude) / 2) * degreesToRadians;
  const east =
    (longitude - originLongitude) *
    degreesToRadians *
    R *
    Math.cos(meanLatitude);
  const north = (latitude - originLatitude) * degreesToRadians * R;
  return [east, north];
}

export function createCalibrationTransform(
  first: CalibrationSample,
  second: CalibrationSample,
): CalibrationTransform {
  if (first.nodeId === second.nodeId || first.anchorId === second.anchorId) {
    throw new Error(
      "The second QR code must be a different calibration point.",
    );
  }
  if (first.floor !== second.floor) {
    throw new Error("Both calibration QR codes must be on the same floor.");
  }

  const [east, north] = latLonToLocalMeters(
    second.gps.latitude,
    second.gps.longitude,
    first.gps.latitude,
    first.gps.longitude,
  );
  const gpsDistance = Math.hypot(east, north);
  const graphDx = second.graphPosition[0] - first.graphPosition[0];
  const graphDz = second.graphPosition[1] - first.graphPosition[1];
  const graphDistance = Math.hypot(graphDx, graphDz);

  if (gpsDistance < 1) {
    throw new Error(
      "The GPS fixes are too close together. Move to the second QR point and try again.",
    );
  }
  if (graphDistance < 1) {
    throw new Error(
      "The QR points are too close in the navigation graph for reliable calibration.",
    );
  }

  const scale = graphDistance / gpsDistance;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("The calibration scale could not be calculated.");
  }

  return {
    originLatitude: first.gps.latitude,
    originLongitude: first.gps.longitude,
    graphOrigin: first.graphPosition,
    scale,
    rotationRadians: Math.atan2(graphDz, graphDx) - Math.atan2(north, east),
    anchorIds: [first.anchorId, second.anchorId],
    floor: first.floor,
    createdAt: Date.now(),
  };
}

export function gpsToGraph(
  fix: Pick<GpsFix, "latitude" | "longitude">,
  transform: CalibrationTransform,
): [number, number] {
  const [east, north] = latLonToLocalMeters(
    fix.latitude,
    fix.longitude,
    transform.originLatitude,
    transform.originLongitude,
  );
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);
  const rotatedX = cosine * east - sine * north;
  const rotatedZ = sine * east + cosine * north;
  return [
    transform.graphOrigin[0] + transform.scale * rotatedX,
    transform.graphOrigin[1] + transform.scale * rotatedZ,
  ];
}

export function graphVectorToBearing(
  dx: number,
  dz: number,
  transform: CalibrationTransform,
): number {
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);
  const east = cosine * dx + sine * dz;
  const north = -sine * dx + cosine * dz;
  return (Math.atan2(east, north) * 180) / Math.PI;
}

export function markerToModel(
  pose: { camera: Vec3; forward: Vec3 },
  anchor: { position: Vec3; normal: Vec2 },
  metersPerModelUnit=1,
): { position: Vec3; forward: Vec2 } {
  const [nx, nz] = anchor.normal,
    tangent: Vec2 = [nz, -nx];
  return {
    position: [
      anchor.position[0] + (tangent[0] * pose.camera[0] + nx * pose.camera[2])/metersPerModelUnit,
      anchor.position[1] + pose.camera[1]/metersPerModelUnit,
      anchor.position[2] + (tangent[1] * pose.camera[0] + nz * pose.camera[2])/metersPerModelUnit,
    ],
    forward: [
      tangent[0] * pose.forward[0] + nx * pose.forward[2],
      tangent[1] * pose.forward[0] + nz * pose.forward[2],
    ],
  };
}
