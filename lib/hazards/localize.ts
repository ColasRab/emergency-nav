import type { NavGraph } from "../astar";
import type { BuildingConfig } from "../buildings";
import { headingToGraphVector, type Vec2 } from "../geo/transform";
export function localizeHazard(
  graph: NavGraph,
  position: Vec2,
  floor: number,
  heading: number | null,
  config: BuildingConfig,
  distanceM = 3,
): { nodeIds: number[]; edge?: [number, number] } {
  const scale = (config.graphToModel?.scale ?? 1) * (config.georef?.scale ?? 1),
    offset =
      heading !== null && config.georef && config.graphToModel
        ? headingToGraphVector(heading, distanceM, config)
        : [0, 0];
  const point: Vec2 = [position[0] + offset[0], position[1] + offset[1]];
  let best = Infinity,
    edge: [number, number] | undefined,
    nearest = -1,
    nearestDistance = Infinity;
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node[2] !== floor) continue;
    const d = Math.hypot(node[0] - position[0], node[1] - position[1]);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = Number(id);
    }
    for (const [to] of graph.edges[id] ?? []) {
      const b = graph.nodes[to];
      if (!b || b[2] !== floor) continue;
      const dx = b[0] - node[0],
        dz = b[1] - node[1],
        len = dx * dx + dz * dz,
        t = len
          ? Math.min(
              1,
              Math.max(
                0,
                ((point[0] - node[0]) * dx + (point[1] - node[1]) * dz) / len,
              ),
            )
          : 0;
      const distance =
        Math.hypot(node[0] + t * dx - point[0], node[1] + t * dz - point[1]) *
        scale;
      if (distance < best) {
        best = distance;
        edge = [Number(id), to];
      }
    }
  }
  if (edge && best <= config.settings.hazards.snapRadiusM)
    return { nodeIds: edge, edge };
  return { nodeIds: nearest >= 0 ? [nearest] : [] };
}
export function crowdNodes(
  graph: NavGraph,
  position: Vec2,
  floor: number,
  config: BuildingConfig,
): number[] {
  const scale = (config.graphToModel?.scale ?? 1) * (config.georef?.scale ?? 1);
  return Object.entries(graph.nodes)
    .filter(
      ([, n]) =>
        n[2] === floor &&
        Math.hypot(n[0] - position[0], n[1] - position[1]) * scale <=
          config.settings.crowd.radiusM,
    )
    .map(([id]) => Number(id))
    .slice(0, 1000);
}
