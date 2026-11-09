import { floorLabel, type BuildingConfig, type Room } from "../buildings";
import type { NavGraph } from "../astar";
import { applySimilarity, type Vec2 } from "../geo/transform";

export type ModelPlace = {
  position: Vec2 | null;
  room?: Room;
  title: string;
  region: string;
  floor: string;
  distances: string;
};
export function modelPosition(config: BuildingConfig, position: Vec2): Vec2 {
  return config.graphToModel
    ? applySimilarity(position, config.graphToModel)
    : position;
}
/** Describe the current coordinate in the model; this does not infer a pose from camera pixels. */
export function describeModelPlace(
  config: BuildingConfig,
  position: Vec2 | null,
  floor: number,
  graph?: NavGraph,
  metersPerModelUnit = 1,
): ModelPlace {
  const point = position ? modelPosition(config, position) : null,
    result: ModelPlace = {
      position: point,
      title: "Position not set",
      region: "Choose a starting point",
      floor: floorLabel(config, floor),
      distances: "",
    };
  if (!point) return result;
  const [x, z] = point,
    room = config.rooms?.find(
      (r) =>
        r.floor === floor &&
        x >= r.rect[0] - 0.01 &&
        x <= r.rect[2] + 0.01 &&
        z >= r.rect[1] - 0.01 &&
        z <= r.rect[3] + 0.01,
    );
  if (room) {
    const [x0, z0, x1, z1] = room.rect,
      fx = (x - x0) / (x1 - x0),
      fz = (z - z0) / (z1 - z0),
      side = fx < 1 / 3 ? "left" : fx > 2 / 3 ? "right" : "center",
      row = fz < 1 / 3 ? "Back" : fz > 2 / 3 ? "Front" : "Middle",
      vertical =
        fz < 0.5
          ? `${(Math.max(0, z - z0) * metersPerModelUnit).toFixed(1)} m from back`
          : `${(Math.max(0, z1 - z) * metersPerModelUnit).toFixed(1)} m from front`,
      horizontal =
        fx < 0.5
          ? `${(Math.max(0, x - x0) * metersPerModelUnit).toFixed(1)} m from left`
          : `${(Math.max(0, x1 - x) * metersPerModelUnit).toFixed(1)} m from right`;
    const orderedDoors = [...room.doors].sort((a, b) => b[0] - a[0]),
      doorIndex = orderedDoors.findIndex(
        (d) => Math.hypot(d[0] - x, d[1] - z) < 0.4,
      ),
      doorRegion =
        doorIndex < 0
          ? null
          : orderedDoors.length === 1
            ? "Door"
            : doorIndex === 0
              ? "Right door"
              : doorIndex === orderedDoors.length - 1
                ? "Left door"
                : "Door";
    return {
      ...result,
      room,
      title: room.label,
      region:
        doorRegion ??
        (row === "Middle" && side === "center" ? "Center" : `${row} ${side}`),
      distances: `~${vertical} · ~${horizontal}`,
    };
  }
  const d = config.layoutDimensions;
  if (d && z >= 0 && z <= d.corridorDepth && Math.abs(x) <= d.width / 2)
    return {
      ...result,
      title: "Corridor",
      region:
        x < -d.width / 6
          ? "Left wing"
          : x > d.width / 6
            ? "Right wing"
            : "Center passage",
    };
  if (
    d &&
    z > d.corridorDepth &&
    z <= d.corridorDepth + d.projectionDepth &&
    Math.abs(x) <= d.projectionWidth / 2
  )
    return {
      ...result,
      title:
        floor === config.floors[0].index ? "Entrance lobby" : "Central landing",
      region: "Modeled entrance area",
    };
  if (graph) {
    const closest = Object.entries(graph.zones)
      .map(([id, tag]) => {
        const n = graph.nodes[id],
          p = n && modelPosition(config, [n[0], n[1]]);
        return {
          tag,
          distance:
            n?.[2] === floor && p ? Math.hypot(x - p[0], z - p[1]) : Infinity,
        };
      })
      .sort((a, b) => a.distance - b.distance)[0];
    if (closest && closest.distance < 1.2)
      return {
        ...result,
        title: closest.tag.label,
        region: "Near modeled waypoint",
      };
  }
  return {
    ...result,
    title: "Mapped floor area",
    region: "Between room waypoints",
  };
}

export function modelRouteSegments(
  config: BuildingConfig,
  graph: NavGraph,
  path: number[] | null,
  floor: number,
): [Vec2, Vec2][] {
  return (path ?? []).slice(1).flatMap((id, i) => {
    const a = graph.nodes[path![i]],
      b = graph.nodes[id];
    return a && b && a[2] === floor && b[2] === floor
      ? [
          [
            modelPosition(config, [a[0], a[1]]),
            modelPosition(config, [b[0], b[1]]),
          ] as [Vec2, Vec2],
        ]
      : [];
  });
}

/** Illustrative perspective overlay, using model pose and an assumed camera field of view. */
export function projectModelRoute(
  segments: [Vec2, Vec2][],
  position: Vec2,
  heading: number,
  aspect: number,
  eyeHeightModel = 1.6,
): [Vec2, Vec2][] {
  if (
    !Number.isFinite(aspect) ||
    aspect <= 0 ||
    !Number.isFinite(heading) ||
    !Number.isFinite(eyeHeightModel) ||
    eyeHeightModel <= 0
  )
    return [];
  const a = (heading * Math.PI) / 180,
    forward: Vec2 = [Math.sin(a), -Math.cos(a)],
    right: Vec2 = [Math.cos(a), Math.sin(a)],
    focalY = 0.5 / Math.tan(Math.PI / 6),
    near = 0.4;
  const local = (p: Vec2): Vec2 => {
    const dx = p[0] - position[0],
      dz = p[1] - position[1];
    return [dx * right[0] + dz * right[1], dx * forward[0] + dz * forward[1]];
  };
  const screen = ([x, depth]: Vec2): Vec2 => [
    500 + (1000 * focalY * x) / (aspect * depth),
    420 + (1000 * focalY * eyeHeightModel) / depth,
  ];
  return segments.flatMap(([p, q]) => {
    let start = local(p),
      end = local(q);
    if (start[1] < near && end[1] < near) return [];
    if (start[1] < near) {
      const t = (near - start[1]) / (end[1] - start[1]);
      start = [start[0] + t * (end[0] - start[0]), near];
    }
    if (end[1] < near) {
      const t = (near - end[1]) / (start[1] - end[1]);
      end = [end[0] + t * (start[0] - end[0]), near];
    }
    return [[screen(start), screen(end)] as [Vec2, Vec2]];
  });
}
