import { nearestNodeOnFloor, type NavGraph } from "../astar";
import type { BuildingConfig } from "../buildings";
import type { Vec2 } from "../geo/transform";
import {
  modelPointToGraph,
  type LocationPoint,
} from "../position/gpsCalibration";
import { attachRoomPoints, isRoomPointWalkable } from "./roomStart";

/** Connect both selected endpoints through the same furniture-aware room graph. */
export function pointRouteGraph(
  graph: NavGraph,
  config: BuildingConfig,
  start: Vec2 | null,
  floor: number,
  destination: LocationPoint | null,
): { graph: NavGraph; startId: number | null; goalId: number | null } {
  let out = graph;
  const graphStart = start ? modelPointToGraph(config, start) : null;
  let startId = graphStart
      ? nearestNodeOnFloor(graph, ...graphStart, floor)
      : null,
    goalId = destination?.nodeId ?? null;
  for (const room of config.rooms ?? []) {
    const hasStart =
        !!start && room.floor === floor && isRoomPointWalkable(room, start),
      hasGoal =
        !!destination &&
        destination.roomId === room.id &&
        destination.nodeId === undefined;
    if (!hasStart && !hasGoal) continue;
    const points: Vec2[] = [];
    if (hasStart) points.push(start!);
    if (hasGoal) points.push(destination!.model);
    const attached = attachRoomPoints(
      out,
      room,
      points,
      config.graphToModel ?? undefined,
    );
    if (!attached) {
      if (hasStart) startId = null;
      if (hasGoal) goalId = null;
      continue;
    }
    out = attached.graph;
    if (hasStart) startId = attached.pointIds[0];
    if (hasGoal) goalId = attached.pointIds[hasStart ? 1 : 0];
  }
  if (destination && goalId !== null && out.nodes[goalId])
    out = {
      ...out,
      zones: {
        ...out.zones,
        [goalId]: { label: destination.label, type: "destination" },
      },
    };
  return { graph: out, startId, goalId };
}
