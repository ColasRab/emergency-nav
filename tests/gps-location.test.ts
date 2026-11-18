import { describe, expect, it, vi } from "vitest";
import { buildingSchema } from "../lib/buildings";
import { parseGraph } from "../lib/graph";
import { enuToLngLat, rotate, type Vec2 } from "../lib/geo/transform";
import {
  buildingLocationPoints,
  calibrateLocations,
  assessGpsPosition,
  gpsModelHeadingOffset,
  gpsToModelPosition,
  matchGpsToModel,
  floorCalibrationDoorPair,
  isFloorCalibrationPair,
  GpsBaselineError,
  calibrationKey,
  readLocationCalibration,
  type GpsLocationSample,
} from "../lib/position/gpsCalibration";
import { isRoomPointWalkable } from "../lib/navigation/roomStart";
import { nextInstruction } from "../lib/voice/instructionBuilder";
import raw from "../public/models/ynares.json";
import rawAdmin from "../public/models/admin.json";
import rawGraph from "../public/graphs/ynares-rooms.json";
const config = buildingSchema.parse(raw),
  graph = parseGraph(rawGraph),
  points = buildingLocationPoints(config, graph),
  right = points.find((p) => p.label === "Marsden · Right door")!,
  left = points.find((p) => p.label === "Marsden · Left door")!,
  origin: Vec2 = [121.2, 14.6];
function sample(
  point = right,
  rotationDeg = -180,
  ratio = 1,
): GpsLocationSample {
  const delta: Vec2 = [
      (point.model[0] - right.model[0]) / ratio,
      (point.model[1] - right.model[1]) / ratio,
    ],
    canonical = rotate(delta, -rotationDeg),
    [longitude, latitude] = enuToLngLat([-canonical[0], canonical[1]], origin);
  return {
    point,
    gps: { latitude, longitude, accuracy: 0.3, timestamp: Date.now() },
    quality: { readings: 5, discarded: 0, spreadM: 0, durationMs: 4000 },
  };
}
describe("two named GPS locations", () => {
  for (const rawBuilding of [rawAdmin, raw]) {
    const building = buildingSchema.parse(rawBuilding);
    for (const floor of building.floors) {
      it(
        building.id +
          " floor " +
          floor.index +
          ": allows exactly the minimum/maximum-X door points",
        () => {
          const pair = floorCalibrationDoorPair(building, floor.index);
          const allDoors = building
            .rooms!.filter((room) => room.floor === floor.index)
            .flatMap((room) => room.doors);
          expect(pair).toHaveLength(2);
          expect(pair[0].model[0]).toBe(Math.min(...allDoors.map((p) => p[0])));
          expect(pair[1].model[0]).toBe(Math.max(...allDoors.map((p) => p[0])));
          expect(
            pair.every(
              (p) =>
                p.floor === floor.index && p.nodeId !== undefined && p.roomId,
            ),
          ).toBe(true);
          expect(pair.map((p) => p.label)).toEqual(
            building.id === "admin"
              ? ["Stock Room · Door", "IT Hub · Door"]
              : ["Male Comfort Room · Door", "Female Comfort Room · Door"],
          );
        },
      );
    }
  }
  it("does not substitute a corridor or stair point when a floor has no door pair", () => {
    expect(floorCalibrationDoorPair(config, 99)).toEqual([]);
    expect(floorCalibrationDoorPair({ ...config, rooms: [] }, 1)).toEqual([]);
  });
  it("accepts either order of the two end doors and rejects inner doors or changed coordinates", () => {
    const pair = floorCalibrationDoorPair(config, 1);
    expect(isFloorCalibrationPair(config, pair[0], pair[1])).toBe(true);
    expect(isFloorCalibrationPair(config, pair[1], pair[0])).toBe(true);
    expect(isFloorCalibrationPair(config, right, left)).toBe(false);
    expect(
      isFloorCalibrationPair(config, pair[0], {
        ...pair[1],
        model: [pair[1].model[0] - 1, pair[1].model[1]],
      }),
    ).toBe(false);
  });
  it("keeps saved calibration separate per floor and refuses an older inner-room pair", () => {
    const pair = floorCalibrationDoorPair(config, 1),
      a = sample(pair[0]),
      b = sample(pair[1]);
    a.gps.accuracy = b.gps.accuracy = 0.1;
    const fit = calibrateLocations(config, a, b);
    const records = new Map([[calibrationKey(config, 1), JSON.stringify(fit)]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => records.get(key) ?? null,
    });
    try {
      expect(calibrationKey(config, 0)).not.toBe(calibrationKey(config, 1));
      expect(readLocationCalibration(config, 1)?.first.point.id).toBe(
        pair[0].id,
      );
      expect(readLocationCalibration(config, 0)).toBeNull();
      records.set(
        calibrationKey(config, 1),
        JSON.stringify(calibrateLocations(config, sample(), sample(left))),
      );
      expect(readLocationCalibration(config, 1)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("does not mix a previous attempt's old first point with a new second capture", () => {
    const a = sample(),
      b = sample(left);
    b.gps.timestamp += 11 * 60 * 1000;
    expect(() => calibrateLocations(config, a, b)).toThrow(/too old/);
  });
  it("ignores older single-reading saved calibrations", () => {
    const fit = calibrateLocations(config, sample(), sample(left));
    const getItem = vi.fn(() => JSON.stringify({ ...fit, version: 1 }));
    vi.stubGlobal("localStorage", { getItem });
    try {
      expect(calibrationKey(config, 1)).toMatch(/:floor-1:v2$/);
      expect(readLocationCalibration(config, 1)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("uses the GPS distance ratio for spoken navigation distances", () => {
    const sampleGraph = {
      nodes: { 0: [0, 0, 1], 1: [0, 6, 1], 2: [0, 8, 1] },
      edges: {},
      exits: [2],
      zones: { 1: { label: "Door", type: "door" } },
    } as typeof graph;
    expect(
      nextInstruction(
        sampleGraph,
        [0, 1, 2],
        [0, 0],
        1,
        config,
        null,
        "model",
        2,
      )!.distanceM,
    ).toBe(12);
  });
  it("uses the modeled right and left door positions and actual doorway nodes", () => {
    expect(right.model[0]).toBeGreaterThan(left.model[0]);
    expect(right.floor).toBe(1);
    expect(right.nodeId).toBeDefined();
    expect(graph.nodes[right.nodeId!].slice(0, 2)).toEqual(right.model);
  });
  it("fits the user's two-door ratio and maps both GPS records exactly back to the doors", () => {
    const a = sample(),
      b = sample(left),
      fit = calibrateLocations(config, a, b);
    expect(fit.modelPerGpsMeter).toBeCloseTo(1, 7);
    expect(gpsToModelPosition(a.gps, fit)[0]).toBeCloseTo(right.model[0]);
    expect(gpsToModelPosition(b.gps, fit)[0]).toBeCloseTo(left.model[0]);
    expect(gpsToModelPosition(b.gps, fit)[1]).toBeCloseTo(left.model[1]);
    expect(fit.lowConfidence).toBe(false);
  });
  it("does not mirror the room depth when the user walks north from the door", () => {
    const fit = calibrateLocations(config, sample(), sample(left)),
      [longitude, latitude] = enuToLngLat([0, 3], origin),
      p = gpsToModelPosition(
        { longitude, latitude, accuracy: 1, timestamp: Date.now() },
        fit,
      );
    expect(p[0]).toBeCloseTo(right.model[0]);
    expect(p[1]).toBeCloseTo(-3);
    expect(gpsModelHeadingOffset(fit)).toBeCloseTo(0);
  });
  it("recovers rotation and scale and correctly predicts a third point", () => {
    const phi = 37,
      ratio = 0.75,
      a = sample(right, phi, ratio),
      b = sample(left, phi, ratio),
      fit = calibrateLocations(config, a, b),
      third = { ...right, id: "third", model: [0, -4.8] as Vec2 },
      c = sample(third, phi, ratio),
      mapped = gpsToModelPosition(c.gps, fit);
    expect(fit.modelPerGpsMeter).toBeCloseTo(ratio, 7);
    expect(fit.rotationDeg).toBeCloseTo(phi, 7);
    expect(mapped[0]).toBeCloseTo(third.model[0]);
    expect(mapped[1]).toBeCloseTo(third.model[1]);
  });
  it("works when the user records the left door first", () => {
    const a = sample(right, 37, 1.25),
      b = sample(left, 37, 1.25),
      fit = calibrateLocations(config, b, a);
    expect(gpsToModelPosition(a.gps, fit)[0]).toBeCloseTo(right.model[0]);
    expect(gpsToModelPosition(a.gps, fit)[1]).toBeCloseTo(right.model[1]);
  });
  it("rejects indistinguishable GPS records, identical locations and cross-floor pairs", () => {
    const a = sample(),
      b = sample(left);
    expect(() => calibrateLocations(config, a, { ...b, gps: a.gps })).toThrow(
      /nearly identical/,
    );
    expect(() => calibrateLocations(config, a, { ...b, gps: a.gps })).toThrow(
      GpsBaselineError,
    );
    expect(() => calibrateLocations(config, a, a)).toThrow(/different second/);
    expect(() =>
      calibrateLocations(config, a, { ...b, point: { ...b.point, floor: 2 } }),
    ).toThrow(/same floor/);
  });
  it("labels overlapping accuracy radii as low confidence instead of claiming precise calibration", () => {
    const a = sample(),
      b = sample(left);
    a.gps.accuracy = 8;
    b.gps.accuracy = 8;
    expect(calibrateLocations(config, a, b).lowConfidence).toBe(true);
  });
  it("rejects ordinary indoor GPS precision even after fitting two points exactly", () => {
    const a = sample(),
      b = sample(left),
      fit = calibrateLocations(config, a, b);
    const quality = assessGpsPosition({ ...b.gps, accuracy: 8 }, fit);
    expect(quality.usable).toBe(false);
    expect(quality.uncertaintyM).toBeGreaterThan(8);
    expect(quality.reason).toContain("Last location kept");
  });
  it("includes baseline noise and rejects extrapolation far beyond the calibration pair", () => {
    const a = sample(),
      b = sample(left);
    a.gps.accuracy = b.gps.accuracy = 0.1;
    const fit = calibrateLocations(config, a, b),
      near = assessGpsPosition(b.gps, fit),
      far = sample({ ...left, model: [100, -50] });
    expect(near.usable).toBe(true);
    expect(near.uncertaintyM).toBeGreaterThan(0.2);
    expect(assessGpsPosition({ ...far.gps, accuracy: 0.1 }, fit).usable).toBe(
      false,
    );
  });
  it("rejects a baseline dominated by uncertainty even with a precise subsequent reading", () => {
    const a = sample(),
      b = sample(left);
    a.gps.accuracy = b.gps.accuracy = 1;
    const fit = calibrateLocations(config, a, b);
    expect(fit.lowConfidence).toBe(true);
    expect(assessGpsPosition({ ...a.gps, accuracy: 0.01 }, fit).usable).toBe(
      false,
    );
  });
  it("keeps a GPS result at the correct model door and matches furniture noise to a clear aisle", () => {
    expect(matchGpsToModel(config, graph, left.model, 1)?.model).toEqual(
      left.model,
    );
    const room = config.rooms!.find((r) => r.label === "Marsden")!,
      obstacle = room.obstacles[0],
      p: Vec2 = [
        (obstacle[0] + obstacle[2]) / 2,
        (obstacle[1] + obstacle[3]) / 2,
      ],
      matched = matchGpsToModel(config, graph, p, 1)!;
    expect(matched.correctionM).toBeGreaterThan(0);
    expect(isRoomPointWalkable(room, matched.model)).toBe(true);
    expect(matchGpsToModel(config, graph, [1000, 1000], 1)).toBeNull();
    expect(matchGpsToModel(config, graph, [NaN, 0], 1)).toBeNull();
  });
});
