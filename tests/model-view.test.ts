import { describe, expect, it } from "vitest";
import { buildingSchema } from "../lib/buildings";
import { parseGraph } from "../lib/graph";
import { invertSimilarity } from "../lib/geo/transform";
import { roomPointPreset } from "../lib/navigation/roomStart";
import {
  describeModelPlace,
  modelRouteSegments,
  projectModelRoute,
} from "../lib/navigation/modelView";
import raw from "../public/models/ynares.json";
import rawGraph from "../public/graphs/ynares-rooms.json";
const config = buildingSchema.parse(raw),
  graph = parseGraph(rawGraph),
  marsden = config.rooms!.find((r) => r.label === "Marsden")!;

describe("model-based camera view", () => {
  it("describes the selected corner using the model coordinate and the actual floor", () => {
    const place = describeModelPlace(
      config,
      roomPointPreset(marsden, 2, 0),
      1,
      graph,
    );
    expect(place.title).toBe("Marsden");
    expect(place.region).toBe("Back right");
    expect(place.floor).toBe("2nd floor");
    expect(place.distances).toContain("0.5 m from back");
    const front = describeModelPlace(
      config,
      roomPointPreset(marsden, 0, 2),
      1,
      graph,
    );
    expect(front.region).toBe("Front left");
    expect(
      describeModelPlace(config, roomPointPreset(marsden, 2, 0), 0, graph)
        .title,
    ).not.toBe("Marsden");
  });
  it("uses graph/model alignment and identifies corridor and lobby positions without inventing a room", () => {
    const transform = { dx: 6, dz: -3, rotationDeg: 27, scale: 1.7 },
      c = { ...config, graphToModel: transform };
    expect(
      describeModelPlace(
        c,
        invertSimilarity(roomPointPreset(marsden, 2, 0), transform),
        1,
      ).region,
    ).toBe("Back right");
    expect(describeModelPlace(config, [0, 1], 1).title).toBe("Corridor");
    expect(describeModelPlace(config, [0, 4], 0).title).toBe("Entrance lobby");
    expect(describeModelPlace(config, [0, 4], 1).title).toBe("Central landing");
    expect(describeModelPlace(config, null, 1).position).toBeNull();
  });
  it("never paints another floor's route across the current camera/map view", () => {
    const sample = {
      ...graph,
      nodes: { 1: [0, 0, 1], 2: [0, 2, 1], 3: [0, 2, 0], 4: [0, 4, 0] },
    } as typeof graph;
    expect(modelRouteSegments(config, sample, [1, 2, 3, 4], 1)).toEqual([
      [
        [0, 0],
        [0, 2],
      ],
    ]);
    expect(modelRouteSegments(config, sample, [1, 2, 3, 4], 0)).toEqual([
      [
        [0, 2],
        [0, 4],
      ],
    ]);
  });
  it("projects only the forward route and clips segments that cross the camera near plane", () => {
    expect(
      projectModelRoute(
        [
          [
            [0, -5],
            [0, -10],
          ],
        ],
        [0, 0],
        0,
        1,
      ),
    ).toHaveLength(1);
    expect(
      projectModelRoute(
        [
          [
            [0, -5],
            [0, -10],
          ],
        ],
        [0, 0],
        180,
        1,
      ),
    ).toHaveLength(0);
    const clipped = projectModelRoute(
      [
        [
          [0, 1],
          [0, -5],
        ],
      ],
      [0, 0],
      0,
      1,
    );
    expect(clipped).toHaveLength(1);
    expect(clipped.flat(2).every(Number.isFinite)).toBe(true);
    expect(
      projectModelRoute(
        [
          [
            [0, -5],
            [0, -10],
          ],
        ],
        [0, 0],
        0,
        0,
      ),
    ).toEqual([]);
  });
});
