import { describe, it, expect } from "vitest";
import { buildingSchema } from "../lib/buildings";
import { parseGraph } from "../lib/graph";
import { astar } from "../lib/astar";
import { pointRouteGraph } from "../lib/navigation/pointRoute";
import { crossesRect, roomObstacles } from "../lib/navigation/roomStart";
import { buildingLocationPoints } from "../lib/position/gpsCalibration";
import {
  instructionText,
  nextInstruction,
} from "../lib/voice/instructionBuilder";
import { routeWithHazards } from "../lib/hazards/routing";
import type { Hazard } from "../lib/hazards/model";
import admin from "../public/models/admin.json";
import ynares from "../public/models/ynares.json";
import adminGraph from "../public/graphs/admin-rooms.json";
import ynaresGraph from "../public/graphs/ynares-rooms.json";

for (const [raw, rawGraph] of [
  [admin, adminGraph],
  [ynares, ynaresGraph],
] as const) {
  const config = buildingSchema.parse(raw),
    graph = parseGraph(rawGraph),
    points = buildingLocationPoints(config, graph);
  describe(`${config.id} point-to-point destinations`, () => {
    it("routes from a door to every selectable room position without crossing its furniture", () => {
      for (const room of config.rooms!) {
        const door = points.find(
          (p) => p.roomId === room.id && p.nodeId !== undefined,
        )!;
        for (const destination of points.filter(
          (p) => p.roomId === room.id && p.nodeId === undefined,
        )) {
          const attached = pointRouteGraph(
              graph,
              config,
              door.model,
              room.floor,
              destination,
            ),
            path = astar(attached.graph, attached.startId!, [
              attached.goalId!,
            ]).path;
          expect(path, destination.label).not.toBeNull();
          expect(attached.graph.nodes[path!.at(-1)!].slice(0, 2)).toEqual(
            destination.model,
          );
          for (let i = 1; i < path!.length; i++) {
            const a = attached.graph.nodes[path![i - 1]],
              b = attached.graph.nodes[path![i]];
            for (const obstacle of roomObstacles(room))
              expect(
                crossesRect([a[0], a[1]], [b[0], b[1]], obstacle),
                destination.label,
              ).toBe(false);
          }
        }
      }
    });
    it("shares the aisle graph for two points in one room and handles identical endpoints", () => {
      for (const room of config.rooms!) {
        const corners = points.filter(
          (p) => p.roomId === room.id && p.label.includes("Back"),
        );
        if (corners.length < 2) continue;
        for (const destination of [corners[0], corners.at(-1)!]) {
          const attached = pointRouteGraph(
              graph,
              config,
              corners[0].model,
              room.floor,
              destination,
            ),
            path = astar(attached.graph, attached.startId!, [
              attached.goalId!,
            ]).path!;
          expect(path).not.toBeNull();
          expect(
            path.every((id) =>
              attached.graph.nodeAliases?.[id]?.includes(room.nodeId),
            ),
          ).toBe(true);
        }
      }
    });
    it("supports a different room or floor and retains hazards on destination room aliases", () => {
      const start = points.find((p) => p.nodeId === undefined)!,
        destination = points.findLast(
          (p) => p.nodeId === undefined && p.roomId !== start.roomId,
        )!,
        attached = pointRouteGraph(
          graph,
          config,
          start.model,
          start.floor,
          destination,
        ),
        result = routeWithHazards(
          attached.graph,
          attached.startId!,
          [attached.goalId!],
          [],
          config,
          1000,
        ),
        room = config.rooms!.find((r) => r.id === destination.roomId)!,
        hazard: Hazard = {
          id: "00000000-0000-4000-8000-000000000001",
          buildingId: config.id,
          floor: room.floor,
          nodeIds: [room.nodeId],
          type: "blocked",
          severity: 3,
          confidence: 1,
          source: "user",
          confirmations: 1,
          dismissals: 0,
          createdAt: 100,
          expiresAt: 10000,
        };
      expect(result.path).not.toBeNull();
      expect(result.path!.at(-1)).toBe(attached.goalId);
      expect(
        routeWithHazards(
          attached.graph,
          attached.startId!,
          [attached.goalId!],
          [hazard],
          config,
          1000,
        ).fallback,
      ).toBe(true);
    });
  });
}

it("announces a selected destination and only confirms arrival at a confirmed model point", () => {
  const config = buildingSchema.parse(ynares),
    graph = parseGraph(ynaresGraph),
    point = buildingLocationPoints(config, graph).find(
      (p) => p.label === "Marsden · Back right",
    )!,
    attached = pointRouteGraph(graph, config, point.model, point.floor, point),
    path = [attached.goalId!],
    instruction = nextInstruction(
      attached.graph,
      path,
      point.model,
      point.floor,
      config,
      null,
      "model",
      1,
      0.05,
    )!;
  expect(instruction.kind).toBe("arrival");
  expect(instructionText(instruction, "en", config)).toContain(
    "selected destination",
  );
  expect(
    nextInstruction(
      attached.graph,
      path,
      point.model,
      point.floor,
      config,
      null,
      "model",
      1,
      0,
    )!.kind,
  ).toBe("confirm-location");
});
