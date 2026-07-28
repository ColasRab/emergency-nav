/**
 * A* over the exported nav_graph.json. Runs entirely client-side --
 * no server round-trip, no dependency on the Python pipeline that
 * generated the graph.
 */

export type NavGraph = {
  meta?: { resolution: number; origin_x: number; origin_z: number };
  nodes: Record<string, [number, number, number]>; // [x, z, floor]
  edges: Record<string, [number, number][]>;
  exits: number[];
  zones: Record<string, { label: string; type: string }>;
};

export type AstarResult = {
  path: number[] | null;
  cost: number;
};

class MinHeap<T> {
  private items: { priority: number; value: T }[] = [];
  push(priority: number, value: T) {
    this.items.push({ priority, value });
    this.items.sort((a, b) => a.priority - b.priority); // fine at ~1k-node scale
  }
  pop() {
    return this.items.shift();
  }
  get size() {
    return this.items.length;
  }
}

/**
 * liveWeights, if provided, lets the caller override/multiply specific
 * edge weights at query time (e.g. a crowd-congestion penalty detected
 * just now) without mutating the static graph. Keyed by "fromId->toId".
 */
export function astar(
  graph: NavGraph,
  startId: number,
  goalIds: number[],
  liveWeightMultipliers?: Record<string, number>
): AstarResult {
  const goals = new Set(goalIds);
  if (goals.size === 0) return { path: null, cost: Infinity };

  const heuristic = (nodeId: number) => {
    const [x, z] = graph.nodes[nodeId];
    let best = Infinity;
    for (const g of goals) {
      const [gx, gz] = graph.nodes[g];
      const d = Math.hypot(x - gx, z - gz);
      if (d < best) best = d;
    }
    return best;
  };

  const open = new MinHeap<number>();
  open.push(heuristic(startId), startId);

  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>([[startId, 0]]);
  const visited = new Set<number>();

  while (open.size > 0) {
    const current = open.pop()!.value;
    if (visited.has(current)) continue;
    visited.add(current);

    if (goals.has(current)) {
      const path = [current];
      let node = current;
      while (cameFrom.has(node)) {
        node = cameFrom.get(node)!;
        path.push(node);
      }
      path.reverse();
      return { path, cost: gScore.get(current)! };
    }

    for (const [neighborId, baseWeight] of graph.edges[String(current)] ?? []) {
      if (!isFinite(baseWeight)) continue;
      const key = `${current}->${neighborId}`;
      const multiplier = liveWeightMultipliers?.[key] ?? 1.0;
      const weight = baseWeight * multiplier;

      const tentativeG = gScore.get(current)! + weight;
      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        gScore.set(neighborId, tentativeG);
        cameFrom.set(neighborId, current);
        open.push(tentativeG + heuristic(neighborId), neighborId);
      }
    }
  }

  return { path: null, cost: Infinity };
}

/** Nearest graph node to an arbitrary (x, z) -- simple linear scan, fine at this scale. */
export function nearestNode(graph: NavGraph, x: number, z: number): number {
  let best = { id: -1, dist: Infinity };
  for (const [idStr, [nx, nz]] of Object.entries(graph.nodes)) {
    const d = Math.hypot(x - nx, z - nz);
    if (d < best.dist) best = { id: parseInt(idStr, 10), dist: d };
  }
  return best.id;
}

/** Nearest node tagged with a given zone type (stairs/hallway/room), relative to a reference node. */
export function nearestNodeOfType(graph: NavGraph, refNodeId: number, zoneType: string): number | null {
  const [rx, rz] = graph.nodes[refNodeId];
  let best: { id: number; dist: number } | null = null;
  for (const [idStr, tag] of Object.entries(graph.zones)) {
    if (tag.type !== zoneType) continue;
    const id = parseInt(idStr, 10);
    const [x, z] = graph.nodes[id];
    const dist = Math.hypot(x - rx, z - rz);
    if (!best || dist < best.dist) best = { id, dist };
  }
  return best ? best.id : null;
}
