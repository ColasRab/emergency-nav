import {
  astar,
  type AstarResult,
  type NavGraph,
  type CostModifier,
} from "../astar";
import type { BuildingConfig } from "../buildings";
import { isActive, type Hazard } from "./model";
export function hazardTouchesEdge(
  h: Hazard,
  from: number,
  to: number,
  graph: NavGraph,
): boolean {
  const a = graph.nodes[from],
    b = graph.nodes[to];
  if (!a || !b || !(a[2] === h.floor || b[2] === h.floor)) return false;
  const matches = (reported: number, actual: number) =>
    reported === actual || !!graph.nodeAliases?.[actual]?.includes(reported);
  if (h.edge)
    return (
      from !== to &&
      ((matches(h.edge[0], from) && matches(h.edge[1], to)) ||
        (matches(h.edge[1], from) && matches(h.edge[0], to)))
    );
  return h.nodeIds.some((node) => matches(node, from) || matches(node, to));
}
export function hazardCostModifier(
  graph: NavGraph,
  hazards: Hazard[],
  config: BuildingConfig,
  now: number,
  fallback = false,
): CostModifier {
  const active = hazards.filter(
    (h) => h.buildingId === config.id && isActive(h, now),
  );
  return (from, to) => {
    let multiplier = 1;
    for (const h of active) {
      if (!hazardTouchesEdge(h, from, to, graph)) continue;
      const hard =
        h.severity === 3 && (h.source !== "auto" || h.confirmations >= 1);
      if (hard) {
        if (!fallback) return Infinity;
        multiplier *= config.settings.hazards.fallbackMultiplier;
        continue;
      }
      const target =
        config.settings.hazards.multipliers[Math.min(h.severity, 2) - 1];
      const decay =
        h.source === "admin"
          ? 1
          : Math.min(
              1,
              Math.max(
                0,
                (h.expiresAt - now) / Math.max(1, h.expiresAt - h.createdAt),
              ),
            );
      multiplier *= 1 + (target - 1) * decay;
    }
    return multiplier;
  };
}
export function pathCost(
  graph: NavGraph,
  path: number[],
  modifier: CostModifier,
): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1],
      to = path[i],
      edge = graph.edges[from]?.find(([id]) => id === to);
    if (!edge) return Infinity;
    const factor = modifier(from, to, graph.nodes[from][2]);
    if (!Number.isFinite(factor)) return Infinity;
    cost += edge[1] * factor;
  }
  return cost;
}
export type HazardRoute = AstarResult & {
  fallback: boolean;
  hazardIds: string[];
};
export function routeWithHazards(
  graph: NavGraph,
  start: number,
  hazards: Hazard[],
  config: BuildingConfig,
  now: number,
  previous: number[] | null = null,
): HazardRoute {
  const normal = hazardCostModifier(graph, hazards, config, now),
    next = astar(graph, start, graph.exits, undefined, normal);
  if (!next.path) {
    const fallback = astar(
      graph,
      start,
      graph.exits,
      undefined,
      hazardCostModifier(graph, hazards, config, now, true),
    );
    return {
      ...fallback,
      fallback: !!fallback.path,
      hazardIds: hazards
        .filter(
          (h) =>
            h.buildingId === config.id &&
            isActive(h, now) &&
            h.severity === 3 &&
            fallback.path?.some(
              (to, i) =>
                i > 0 && hazardTouchesEdge(h, fallback.path![i - 1], to, graph),
            ),
        )
        .map((h) => h.id),
    };
  }
  const index = previous?.indexOf(start) ?? -1,
    old = index >= 0 ? previous!.slice(index) : null;
  if (old && graph.exits.includes(old[old.length - 1])) {
    const cost = pathCost(graph, old, normal);
    if (
      Number.isFinite(cost) &&
      next.cost >= cost * (1 - config.settings.hazards.switchSaving)
    )
      return { path: old, cost, fallback: false, hazardIds: [] };
  }
  return { ...next, fallback: false, hazardIds: [] };
}
