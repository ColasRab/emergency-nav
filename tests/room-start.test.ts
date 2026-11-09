import { describe, it, expect } from "vitest";
import { buildingSchema } from "../lib/buildings";
import { parseGraph } from "../lib/graph";
import { astar } from "../lib/astar";
import {
  attachRoomStart,
  crossesRect,
  isRoomPointWalkable,
  roomObstacles,
  roomPointPreset,
} from "../lib/navigation/roomStart";
import { routeWithHazards } from "../lib/hazards/routing";
import type { Hazard } from "../lib/hazards/model";
import { nextInstruction } from "../lib/voice/instructionBuilder";
import {
  applySimilarity,
  invertSimilarity,
  type Vec2,
} from "../lib/geo/transform";
import rawAdmin from "../public/models/admin.json";
import rawYnares from "../public/models/ynares.json";
import adminGraph from "../public/graphs/admin-rooms.json";
import ynaresGraph from "../public/graphs/ynares-rooms.json";

const config = buildingSchema.parse(rawYnares),
  graph = parseGraph(ynaresGraph),
  marsden = config.rooms!.find((r) => r.label === "Marsden")!;

describe("starting at a point inside the model", () => {
  for (const [raw, input] of [
    [rawAdmin, adminGraph],
    [rawYnares, ynaresGraph],
  ] as const) {
    const c = buildingSchema.parse(raw),
      g = parseGraph(input);
    it(`${c.id}: every clear preset routes through a real door without crossing modeled furniture`, () => {
      for (const room of c.rooms!) {
        expect(room.obstacles.length).toBeGreaterThan(0);
        let routes = 0;
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 3; col++) {
            const point = roomPointPreset(room, col, row);
            if (!isRoomPointWalkable(room, point)) continue;
            const attached = attachRoomStart(g, room, point)!;
            const path = astar(
              attached.graph,
              attached.startId,
              attached.graph.exits,
            ).path;
            expect(path, `${room.label} preset ${col},${row}`).not.toBeNull();
            const doorIndex = path!.findIndex((id) =>
              room.doorNodeIds.includes(id),
            );
            expect(doorIndex, room.label).toBeGreaterThan(0);
            for (let i = 1; i <= doorIndex; i++) {
              const a = attached.graph.nodes[path![i - 1]].slice(0, 2) as Vec2,
                b = attached.graph.nodes[path![i]].slice(0, 2) as Vec2;
              expect(
                roomObstacles(room).some((r) => crossesRect(a, b, r)),
                `${room.label}: segment ${i}`,
              ).toBe(false);
            }
            expect(attached.graph.nodes[path![0]].slice(0, 2)).toEqual(point);
            routes++;
          }
        expect(routes, room.label).toBeGreaterThan(0);
      }
    });
  }
  it("rejects points in furniture, outside the room, and too close to a wall", () => {
    const r = marsden.obstacles[0];
    for (const point of [
      [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2],
      [marsden.rect[0] - 1, -1],
      [marsden.rect[0] + 0.01, -1],
      [NaN, 0],
    ] as Vec2[])
      expect(attachRoomStart(graph, marsden, point)).toBeNull();
  });
  it("starts at Marsden's back right, preserves the source graph, and descends to the ground entrance", () => {
    const before = JSON.stringify(graph),
      point = roomPointPreset(marsden, 2, 0),
      attached = attachRoomStart(graph, marsden, point)!,
      route = routeWithHazards(
        attached.graph,
        attached.startId,
        [],
        config,
        1000,
      );
    expect(route.path).not.toBeNull();
    expect(route.path!.some((id) => attached.graph.nodes[id][2] === 0)).toBe(
      true,
    );
    expect(graph.exits).toContain(route.path!.at(-1));
    expect(route.path).not.toContain(marsden.nodeId);
    expect(JSON.stringify(graph)).toBe(before);
  });
  it("reroutes through the other modeled door when a doorway is blocked", () => {
    const point = roomPointPreset(marsden, 2, 0),
      attached = attachRoomStart(graph, marsden, point)!,
      original = routeWithHazards(
        attached.graph,
        attached.startId,
        [],
        config,
        1000,
      ),
      usedDoor = marsden.doorNodeIds.find((id) => original.path!.includes(id))!;
    const hazard: Hazard = {
      id: "00000000-0000-4000-8000-000000000009",
      buildingId: "ynares",
      floor: 1,
      nodeIds: [usedDoor],
      type: "blocked",
      severity: 3,
      confidence: 1,
      source: "user",
      confirmations: 1,
      dismissals: 0,
      createdAt: 500,
      expiresAt: 10000,
    };
    const next = routeWithHazards(
      attached.graph,
      attached.startId,
      [hazard],
      config,
      1000,
      original.path,
    );
    expect(next.fallback).toBe(false);
    expect(next.path).not.toContain(usedDoor);
    expect(marsden.doorNodeIds.some((id) => next.path!.includes(id))).toBe(
      true,
    );
  });
  it("provides a model bearing without claiming geographic calibration", () => {
    const point = roomPointPreset(marsden, 2, 0),
      attached = attachRoomStart(graph, marsden, point)!,
      path = astar(
        attached.graph,
        attached.startId,
        attached.graph.exits,
      ).path!,
      world = nextInstruction(attached.graph, path, point, 1, config),
      model = nextInstruction(
        attached.graph,
        path,
        point,
        1,
        config,
        180,
        "model",
      );
    expect(config.georef).toBeNull();
    expect(world!.bearing).toBeNull();
    expect(model!.bearing).not.toBeNull();
    expect(model!.target).toEqual(attached.graph.nodes[path[1]].slice(0, 2));
    expect(model!.relativeAngle).not.toBeNull();
  });
  it("keeps a hazard reported at the old room node effective on the new in-room path", () => {
    const attached = attachRoomStart(
      graph,
      marsden,
      roomPointPreset(marsden, 2, 0),
    )!;
    const hazard: Hazard = {
      id: "00000000-0000-4000-8000-000000000010",
      buildingId: "ynares",
      floor: 1,
      nodeIds: [marsden.nodeId],
      type: "fire",
      severity: 3,
      confidence: 1,
      source: "user",
      confirmations: 1,
      dismissals: 0,
      createdAt: 500,
      expiresAt: 10000,
    };
    const result = routeWithHazards(
      attached.graph,
      attached.startId,
      [hazard],
      config,
      1000,
    );
    expect(result.fallback).toBe(true);
    expect(result.hazardIds).toContain(hazard.id);
  });
  it("keeps room points and camera directions aligned when the graph has a rotation, offset and scale", () => {
    const transform = { dx: 8, dz: -3, scale: 2, rotationDeg: 37 },
      transformed = {
        ...graph,
        nodes: Object.fromEntries(
          Object.entries(graph.nodes).map(([id, n]) => [
            id,
            [...invertSimilarity([n[0], n[1]], transform), n[2]] as [
              number,
              number,
              number,
            ],
          ]),
        ),
        edges: Object.fromEntries(
          Object.entries(graph.edges).map(([id, edges]) => [
            id,
            edges.map(([to, cost]): [number, number] => [
              to,
              cost / transform.scale,
            ]),
          ]),
        ),
      },
      point = roomPointPreset(marsden, 2, 0),
      attached = attachRoomStart(transformed, marsden, point, transform)!,
      path = astar(
        attached.graph,
        attached.startId,
        attached.graph.exits,
      ).path!,
      c = { ...config, graphToModel: transform },
      startGraph = invertSimilarity(point, transform),
      instruction = nextInstruction(
        attached.graph,
        path,
        startGraph,
        1,
        c,
        180,
        "model",
      )!;
    expect(path).not.toBeNull();
    const startModel = applySimilarity(
      attached.graph.nodes[attached.startId].slice(0, 2) as Vec2,
      transform,
    );
    expect(startModel[0]).toBeCloseTo(point[0]);
    expect(startModel[1]).toBeCloseTo(point[1]);
    const target = applySimilarity(instruction.target, transform),
      expected =
        ((Math.atan2(target[0] - point[0], point[1] - target[1]) * 180) /
          Math.PI +
          360) %
        360;
    expect(instruction.bearing).toBeCloseTo(expected);
  });
});
