import { describe, expect, it } from "vitest";
import { buildingSchema } from "../lib/buildings";
import { parseGraph } from "../lib/graph";
import { enuToLngLat, rotate, type Vec2 } from "../lib/geo/transform";
import {
  buildingLocationPoints,
  calibrateLocations,
  gpsModelHeadingOffset,
  gpsToModelPosition,
  matchGpsToModel,
  type GpsLocationSample,
} from "../lib/position/gpsCalibration";
import { isRoomPointWalkable } from "../lib/navigation/roomStart";
import { nextInstruction } from "../lib/voice/instructionBuilder";
import raw from "../public/models/ynares.json";
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
  };
}
describe("two named GPS locations", () => {
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
