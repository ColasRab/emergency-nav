import { z } from "zod";
import type { BuildingConfig, Room } from "../buildings";
import type { NavGraph } from "../astar";
import type { GpsFix } from "../calibration";
import { GPS_CAPTURE_READINGS, GPS_CAPTURE_SPAN_MS } from "./gpsCapture";
import {
  applySimilarity,
  invertSimilarity,
  lngLatToEnu,
  normalizeSignedDegrees,
  rotate,
  type Vec2,
} from "../geo/transform";
import {
  isRoomPointWalkable,
  roomInterior,
  roomObstacles,
  roomPointPreset,
} from "../navigation/roomStart";

export type LocationPoint = {
  id: string;
  label: string;
  floor: number;
  model: Vec2;
  roomId?: string;
  nodeId?: number;
};
export const gpsFixSchema = z.object({
  latitude: z.number().min(-85).max(85),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().finite(),
  timestamp: z.number().finite(),
});
const pointSchema = z.object({
  id: z.string(),
  label: z.string(),
  floor: z.number().int(),
  model: z.tuple([z.number().finite(), z.number().finite()]),
  roomId: z.string().optional(),
  nodeId: z.number().int().optional(),
});
const sampleSchema = z.object({
  point: pointSchema,
  gps: gpsFixSchema,
  quality: z.object({
    readings: z.number().int().min(GPS_CAPTURE_READINGS),
    discarded: z.number().int().nonnegative(),
    spreadM: z.number().finite().nonnegative(),
    durationMs: z.number().finite().min(GPS_CAPTURE_SPAN_MS),
  }),
});
export type GpsLocationSample = z.infer<typeof sampleSchema>;
export const locationCalibrationSchema = z.object({
  version: z.literal(2),
  buildingId: z.enum(["admin", "ynares"]),
  revision: z.string(),
  first: sampleSchema,
  second: sampleSchema,
  rotationDeg: z.number().finite(),
  modelPerGpsMeter: z.number().positive().finite(),
  gpsDistanceM: z.number().positive(),
  modelDistanceM: z.number().positive(),
  lowConfidence: z.boolean(),
  createdAt: z.number().finite(),
});
export type LocationCalibration = z.infer<typeof locationCalibrationSchema>;

function roomDoorPoints(room: Room): LocationPoint[] {
  const doors = room.doors
    .map((model, i) => ({ model, nodeId: room.doorNodeIds[i] }))
    .sort((a, b) => b.model[0] - a.model[0]);
  return doors.map((door, i): LocationPoint => ({
    id: room.id + ":door:" + i,
    label:
      room.label +
      " · " +
      (doors.length === 1
        ? "Door"
        : i === 0
          ? "Right door"
          : i === doors.length - 1
            ? "Left door"
            : "Door " + (i + 1)),
    floor: room.floor,
    model: [...door.model],
    roomId: room.id,
    nodeId: door.nodeId,
  }));
}

export function buildingLocationPoints(
  config: BuildingConfig,
  graph: NavGraph,
): LocationPoint[] {
  const points: LocationPoint[] = [];
  for (const room of config.rooms ?? []) {
    points.push(...roomDoorPoints(room));
    for (const [row, r] of ["Back", "Middle", "Front"].map(
      (v, i) => [v, i] as const,
    ))
      for (const [col, c] of ["left", "center", "right"].map(
        (v, i) => [v, i] as const,
      )) {
        const model = roomPointPreset(room, c, r);
        if (isRoomPointWalkable(room, model))
          points.push({
            id: `${room.id}:${r}:${c}`,
            label: `${room.label} · ${row} ${col}`,
            floor: room.floor,
            model,
            roomId: room.id,
          });
      }
  }
  for (const [key, zone] of Object.entries(graph.zones)) {
    const n = graph.nodes[key];
    if (!n || zone.type === "room" || zone.type === "door") continue;
    const model = config.graphToModel
      ? applySimilarity([n[0], n[1]], config.graphToModel)
      : ([n[0], n[1]] as Vec2);
    points.push({
      id: `node:${key}`,
      label: zone.label,
      floor: n[2],
      model,
      nodeId: Number(key),
    });
  }
  return points;
}

/** The only permitted GPS anchors: minimum and maximum model X among actual floor doors. */
export function floorCalibrationDoorPair(
  config: BuildingConfig,
  floor: number,
): LocationPoint[] {
  const doors = (config.rooms ?? [])
    .filter((room) => room.floor === floor)
    .flatMap(roomDoorPoints)
    .filter((point) => point.nodeId !== undefined);
  const left = [...doors].sort(
    (a, b) =>
      a.model[0] - b.model[0] ||
      b.model[1] - a.model[1] ||
      a.id.localeCompare(b.id),
  )[0];
  const right = [...doors].sort(
    (a, b) =>
      b.model[0] - a.model[0] ||
      b.model[1] - a.model[1] ||
      a.id.localeCompare(b.id),
  )[0];
  return left && right && right.model[0] - left.model[0] > 1e-6
    ? [left, right]
    : [];
}

export function isFloorCalibrationPair(
  config: BuildingConfig,
  first: LocationPoint,
  second: LocationPoint,
): boolean {
  if (first.floor !== second.floor || first.id === second.id) return false;
  const pair = floorCalibrationDoorPair(config, first.floor);
  return (
    pair.length === 2 &&
    [first, second].every((point) => {
      const expected = pair.find((door) => door.id === point.id);
      return (
        expected &&
        expected.nodeId === point.nodeId &&
        expected.roomId === point.roomId &&
        Math.hypot(
          expected.model[0] - point.model[0],
          expected.model[1] - point.model[1],
        ) < 1e-6
      );
    })
  );
}

export class GpsBaselineError extends Error {
  constructor() {
    super(
      "The GPS readings are nearly identical. Record again or use locations farther apart.",
    );
    this.name = "GpsBaselineError";
  }
}

export function calibrateLocations(
  config: BuildingConfig,
  first: GpsLocationSample,
  second: GpsLocationSample,
): LocationCalibration {
  sampleSchema.parse(first);
  sampleSchema.parse(second);
  if (first.point.id === second.point.id)
    throw new Error("Choose a different second location.");
  if (first.point.floor !== second.point.floor)
    throw new Error("Record both locations on the same floor.");
  if (Math.abs(second.gps.timestamp - first.gps.timestamp) > 10 * 60 * 1000)
    throw new Error(
      "The first recording is too old for this attempt. Record both points again.",
    );
  const [east, north] = lngLatToEnu(
      [second.gps.longitude, second.gps.latitude],
      [first.gps.longitude, first.gps.latitude],
    ),
    gpsDistanceM = Math.hypot(east, north),
    dx = second.point.model[0] - first.point.model[0],
    dz = second.point.model[1] - first.point.model[1],
    modelDistanceM = Math.hypot(dx, dz);
  if (gpsDistanceM < 1) throw new GpsBaselineError();
  if (modelDistanceM < 0.5)
    throw new Error("Choose two locations farther apart in the model.");
  const modelPerGpsMeter = modelDistanceM / gpsDistanceM,
    rotationDeg = normalizeSignedDegrees(
      ((Math.atan2(north, -east) - Math.atan2(dz, dx)) * 180) / Math.PI,
    );
  return locationCalibrationSchema.parse({
    version: 2,
    buildingId: config.id,
    revision: config.modelRevision ?? "scan",
    first,
    second,
    rotationDeg,
    modelPerGpsMeter,
    gpsDistanceM,
    modelDistanceM,
    lowConfidence:
      gpsDistanceM <= 3 * (first.gps.accuracy + second.gps.accuracy) ||
      modelPerGpsMeter < 0.2 ||
      modelPerGpsMeter > 5,
    createdAt: Date.now(),
  });
}

export function gpsToModelPosition(
  fix: GpsFix,
  calibration: LocationCalibration,
): Vec2 {
  gpsFixSchema.parse(fix);
  const first = calibration.first,
    [east, north] = lngLatToEnu(
      [fix.longitude, fix.latitude],
      [first.gps.longitude, first.gps.latitude],
    ),
    [x, z] = rotate([-east, north], calibration.rotationDeg);
  return [
    first.point.model[0] + x * calibration.modelPerGpsMeter,
    first.point.model[1] + z * calibration.modelPerGpsMeter,
  ];
}
export function gpsModelHeadingOffset(
  calibration: LocationCalibration,
): number {
  return normalizeSignedDegrees(180 - calibration.rotationDeg);
}

export const MAX_GPS_GUIDANCE_UNCERTAINTY_M = 1;

/** A conservative working allowance, not a guarantee of physical accuracy.
 * Includes origin and baseline noise, which two-point fitting cannot remove.
 */
export function assessGpsPosition(
  fix: GpsFix,
  calibration: LocationCalibration,
): {
  usable: boolean;
  uncertaintyM: number;
  reason: string;
} {
  gpsFixSchema.parse(fix);
  const { first, second, gpsDistanceM } = calibration,
    baselineNoise = first.gps.accuracy + second.gps.accuracy,
    [east, north] = lngLatToEnu(
      [fix.longitude, fix.latitude],
      [first.gps.longitude, first.gps.latitude],
    ),
    relativeError =
      baselineNoise / Math.max(1e-9, gpsDistanceM - baselineNoise),
    readingNoise = fix.accuracy + first.gps.accuracy,
    uncertaintyM =
      readingNoise + (Math.hypot(east, north) + readingNoise) * relativeError;
  if (calibration.lowConfidence || gpsDistanceM <= 3 * baselineNoise)
    return {
      usable: false,
      uncertaintyM,
      reason:
        "Calibration readings cannot reliably distinguish these points. Confirm your location or record points farther apart.",
    };
  if (
    !Number.isFinite(uncertaintyM) ||
    uncertaintyM > MAX_GPS_GUIDANCE_UNCERTAINTY_M
  )
    return {
      usable: false,
      uncertaintyM,
      reason:
        "GPS is too uncertain for room-level guidance. Last location kept; confirm where you are using Set location.",
    };
  return {
    usable: true,
    uncertaintyM,
    reason: "Approximate GPS area; confirm your position at each named point.",
  };
}
export function calibrationKey(config: BuildingConfig, floor: number): string {
  return `wayfinder:location-gps:${config.id}:${config.modelRevision ?? "scan"}:floor-${floor}:v2`;
}
export function readLocationCalibration(
  config: BuildingConfig,
  floor: number,
): LocationCalibration | null {
  try {
    const data = localStorage.getItem(calibrationKey(config, floor));
    if (!data) return null;
    const c = locationCalibrationSchema.parse(JSON.parse(data));
    if (
      c.buildingId !== config.id ||
      c.revision !== (config.modelRevision ?? "scan") ||
      c.first.point.floor !== floor ||
      !isFloorCalibrationPair(config, c.first.point, c.second.point)
    )
      return null;
    const expected = calibrateLocations(config, c.first, c.second);
    if (
      Math.abs(expected.modelPerGpsMeter - c.modelPerGpsMeter) > 1e-7 ||
      Math.abs(normalizeSignedDegrees(expected.rotationDeg - c.rotationDeg)) >
        1e-7
    )
      return null;
    return { ...c, lowConfidence: expected.lowConfidence };
  } catch {
    return null;
  }
}

/** Match the noisy coordinate to the modeled walkable area, never changing the selected floor. */
export function matchGpsToModel(
  config: BuildingConfig,
  graph: NavGraph,
  model: Vec2,
  floor: number,
): { model: Vec2; correctionM: number } | null {
  if (!model.every(Number.isFinite)) return null;
  const rooms = config.rooms?.filter((r) => r.floor === floor) ?? [];
  const doors = rooms.flatMap((r) => r.doors);
  const door = doors.find(
    (d) => Math.hypot(d[0] - model[0], d[1] - model[1]) < 0.4,
  );
  if (door)
    return {
      model: [...door],
      correctionM: Math.hypot(door[0] - model[0], door[1] - model[1]),
    };
  const room = rooms.find(
    (r) =>
      model[0] >= r.rect[0] &&
      model[0] <= r.rect[2] &&
      model[1] >= r.rect[1] &&
      model[1] <= r.rect[3],
  );
  if (room) {
    if (isRoomPointWalkable(room, model)) return { model, correctionM: 0 };
    const interior = roomInterior(room),
      clamp = (p: Vec2): Vec2 => [
        Math.max(interior[0], Math.min(interior[2], p[0])),
        Math.max(interior[1], Math.min(interior[3], p[1])),
      ],
      candidates: Vec2[] = [clamp(model)];
    for (const [x0, z0, x1, z1] of roomObstacles(room)) {
      for (const x of [x0, x1])
        candidates.push(clamp([x, model[1]]), clamp([x, z0]), clamp([x, z1]));
      for (const z of [z0, z1]) candidates.push(clamp([model[0], z]));
    }
    const free = candidates
      .filter((p) => isRoomPointWalkable(room, p))
      .sort(
        (a, b) =>
          Math.hypot(a[0] - model[0], a[1] - model[1]) -
          Math.hypot(b[0] - model[0], b[1] - model[1]),
      )[0];
    return free
      ? {
          model: free,
          correctionM: Math.hypot(free[0] - model[0], free[1] - model[1]),
        }
      : null;
  }
  const d = config.layoutDimensions;
  if (d) {
    const inCorridor =
        Math.abs(model[0]) <= d.width / 2 &&
        model[1] >= 0 &&
        model[1] <= d.corridorDepth,
      inLobby =
        Math.abs(model[0]) <= d.projectionWidth / 2 &&
        model[1] >= d.corridorDepth &&
        model[1] <= d.corridorDepth + d.projectionDepth;
    if (inCorridor || inLobby) return { model, correctionM: 0 };
  }
  const candidates = Object.entries(graph.nodes)
    .filter(([id, n]) => n[2] === floor && graph.zones[id]?.type !== "room")
    .map(([, n]) => {
      const p = config.graphToModel
        ? applySimilarity([n[0], n[1]], config.graphToModel)
        : ([n[0], n[1]] as Vec2);
      return {
        model: p,
        correctionM: Math.hypot(p[0] - model[0], p[1] - model[1]),
      };
    })
    .sort((a, b) => a.correctionM - b.correctionM);
  return candidates[0]?.correctionM <= 1 ? candidates[0] : null;
}

export function modelPointToGraph(config: BuildingConfig, point: Vec2): Vec2 {
  return config.graphToModel
    ? invertSimilarity(point, config.graphToModel)
    : point;
}
