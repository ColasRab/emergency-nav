import type { NavGraph } from "../astar";
import type { Room } from "../buildings";
import {
  applySimilarity,
  invertSimilarity,
  type Vec2,
  type Similarity,
} from "../geo/transform";

type Rect = [number, number, number, number];
// Approximate walking clearance in the estimated model, not an accessibility certification.
export const FURNITURE_CLEARANCE = 0.25;
export const WALL_CLEARANCE = 0.325;
const EPS = 1e-7;
export const ROOM_START_ID = 1_000_000_000;
const inside = ([x, z]: Vec2, r: Rect) =>
  x > r[0] + EPS && x < r[2] - EPS && z > r[1] + EPS && z < r[3] - EPS;

export function roomObstacles(room: Room): Rect[] {
  const expanded = room.obstacles.map(([x0, z0, x1, z1]): Rect => [
    x0 - FURNITURE_CLEARANCE,
    z0 - FURNITURE_CLEARANCE,
    x1 + FURNITURE_CLEARANCE,
    z1 + FURNITURE_CLEARANCE,
  ]);
  return expanded.filter(
    (r, i) =>
      !expanded.some(
        (other, j) =>
          j !== i &&
          other[0] <= r[0] &&
          other[1] <= r[1] &&
          other[2] >= r[2] &&
          other[3] >= r[3] &&
          (j < i || other.some((v, k) => v !== r[k])),
      ),
  );
}

export function roomInterior(room: Room): Rect {
  const [x0, z0, x1, z1] = room.rect;
  return [
    x0 + WALL_CLEARANCE,
    z0 + WALL_CLEARANCE,
    x1 - WALL_CLEARANCE,
    z1 - WALL_CLEARANCE,
  ];
}

export function isRoomPointWalkable(room: Room, point: Vec2): boolean {
  if (!point.every(Number.isFinite)) return false;
  const [x, z] = point,
    r = roomInterior(room);
  return (
    x >= r[0] - EPS &&
    x <= r[2] + EPS &&
    z >= r[1] - EPS &&
    z <= r[3] + EPS &&
    !roomObstacles(room).some((rect) => inside(point, rect))
  );
}

/** True only when the segment enters a rectangle's interior; boundary tangency is allowed. */
export function crossesRect(a: Vec2, b: Vec2, rect: Rect): boolean {
  let lo = 0,
    hi = 1;
  for (const axis of [0, 1] as const) {
    const min = rect[axis] + EPS,
      max = rect[axis + 2] - EPS,
      delta = b[axis] - a[axis];
    if (Math.abs(delta) < EPS) {
      if (a[axis] <= min || a[axis] >= max) return false;
    } else {
      const t0 = (min - a[axis]) / delta,
        t1 = (max - a[axis]) / delta;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
      if (lo >= hi) return false;
    }
  }
  return hi > lo;
}

export function roomPointPreset(room: Room, column: number, row: number): Vec2 {
  const r = roomInterior(room);
  // Keep corner presets comfortably away from the modeled walls.
  const inset = 0.2;
  return [
    r[0] + inset + (column * (r[2] - r[0] - 2 * inset)) / 2,
    r[1] + inset + (row * (r[3] - r[1] - 2 * inset)) / 2,
  ];
}

export type RoomAttachment = { graph: NavGraph; startId: number };
/** Attach a real point in the model to every reachable doorway, preserving hazard routing. */
export function attachRoomStart(
  graph: NavGraph,
  room: Room,
  start: Vec2,
  transform: Similarity = { dx: 0, dz: 0, rotationDeg: 0, scale: 1 },
): RoomAttachment | null {
  if (!isRoomPointWalkable(room, start)) return null;
  const obstacles = roomObstacles(room),
    interior = roomInterior(room),
    points: Vec2[] = [[...start]];
  const add = (p: Vec2) => {
    const found = points.findIndex(
      (q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-5,
    );
    if (found >= 0) return found;
    points.push(p);
    return points.length - 1;
  };
  for (const r of [interior, ...obstacles])
    for (const x of [r[0], r[2]])
      for (const z of [r[1], r[3]])
        if (isRoomPointWalkable(room, [x, z])) add([x, z]);
  const doors = room.doorNodeIds.flatMap((id) => {
    const n = graph.nodes[id];
    if (!n || n[2] !== room.floor) return [];
    const modelDoor = applySimilarity([n[0], n[1]], transform);
    const approach: Vec2 = [modelDoor[0], modelDoor[1] - WALL_CLEARANCE];
    return isRoomPointWalkable(room, approach) &&
      !obstacles.some((r) => crossesRect(approach, modelDoor, r))
      ? [{ id, index: add(approach) }]
      : [];
  });
  const out: NavGraph = {
    ...graph,
    nodes: { ...graph.nodes },
    zones: { ...graph.zones },
    nodeAliases: { ...graph.nodeAliases },
    edges: Object.fromEntries(
      Object.entries(graph.edges).map(([id, edges]) => [id, [...edges]]),
    ),
  };
  // Do not let the older room-center shortcut bypass the furniture or a blocked door.
  for (const [id, edges] of Object.entries(out.edges))
    out.edges[id] =
      Number(id) === room.nodeId
        ? []
        : edges.filter(([to]) => to !== room.nodeId);
  let base = ROOM_START_ID;
  while (points.some((_, i) => out.nodes[base + i])) base += points.length;
  for (const [i, [x, z]] of points.entries()) {
    const [gx, gz] = invertSimilarity([x, z], transform);
    out.nodes[base + i] = [gx, gz, room.floor];
    out.edges[base + i] = [];
    out.nodeAliases![base + i] = [room.nodeId];
    out.zones[base + i] = { label: "Clear aisle point", type: "waypoint" };
  }
  out.zones[base] = {
    label: `${room.label} — selected point`,
    type: "model-start",
  };
  const link = (a: number, b: number) => {
    const p = out.nodes[a],
      q = out.nodes[b],
      distance = Math.hypot(p[0] - q[0], p[1] - q[1]);
    out.edges[a].push([b, distance]);
    out.edges[b].push([a, distance]);
  };
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      if (!obstacles.some((r) => crossesRect(points[i], points[j], r)))
        link(base + i, base + j);
  for (const door of doors) {
    out.zones[base + door.index] = {
      label: `${room.label} door approach`,
      type: "waypoint",
    };
    link(base + door.index, door.id);
  }
  return { graph: out, startId: base };
}
