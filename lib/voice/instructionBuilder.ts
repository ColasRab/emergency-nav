import type { NavGraph } from "../astar";
import { floorNumber, type BuildingConfig } from "../buildings";
import {
  bearing,
  graphBearing,
  normalizeSignedDegrees,
  rotate,
  type Vec2,
} from "../geo/transform";
import en from "./phrases/en.json";
import fil from "./phrases/fil.json";
export type Language = "en" | "fil";
export type PhraseKey = keyof typeof en;
export type ManeuverKind =
  | "left"
  | "right"
  | "slight-left"
  | "slight-right"
  | "sharp-left"
  | "sharp-right"
  | "uturn"
  | "stairs-up"
  | "stairs-down"
  | "door"
  | "entrance"
  | "exit"
  | "arrival";
export type Maneuver = {
  nodeId: number;
  pathIndex: number;
  kind: ManeuverKind;
  floor: number;
  targetFloor?: number;
  landmark?: string;
};
export type NextInstruction = Maneuver & {
  id: string;
  distanceM: number;
  target: Vec2;
  bearing: number | null;
  relativeAngle: number | null;
};
export function phrase(
  key: PhraseKey,
  language: Language,
  values: Record<string, string | number> = {},
): string {
  return (language === "fil" ? fil : en)[key].replace(
    /\{(\w+)\}/g,
    (_, key: string) => String(values[key] ?? ""),
  );
}
export function classifyTurn(
  angle: number,
  thresholds: BuildingConfig["settings"]["voice"],
): ManeuverKind | null {
  const a = Math.abs(normalizeSignedDegrees(angle));
  if (a < thresholds.slightDeg) return null;
  if (a >= thresholds.uTurnDeg) return "uturn";
  const side = angle < 0 ? "left" : "right";
  return a >= thresholds.sharpDeg
    ? `sharp-${side}`
    : a < thresholds.turnDeg
      ? `slight-${side}`
      : side;
}
const pathBearing = (dx: number, dz: number, c: BuildingConfig) =>
  c.georef && c.graphToModel ? graphBearing(dx, dz, c) : bearing(-dx, dz);
export function buildManeuvers(
  graph: NavGraph,
  path: number[],
  config: BuildingConfig,
): Maneuver[] {
  const result: Maneuver[] = [];
  if (!path.length) return result;
  for (let i = 0; i < path.length - 1; i++) {
    const node = graph.nodes[path[i]],
      next = graph.nodes[path[i + 1]];
    if (!node || !next) continue;
    if (node[2] !== next[2]) {
      result.push({
        nodeId: path[i],
        pathIndex: i,
        kind: next[2] > node[2] ? "stairs-up" : "stairs-down",
        floor: node[2],
        targetFloor: next[2],
      });
      continue;
    }
    const tag = graph.zones[path[i]];
    if (tag?.type === "door" || tag?.type === "entrance") {
      result.push({
        nodeId: path[i],
        pathIndex: i,
        kind: tag.type,
        floor: node[2],
        landmark: tag.label,
      });
      continue;
    }
    if (i === 0 || graph.nodes[path[i - 1]][2] !== node[2]) continue;
    const previous = graph.nodes[path[i - 1]],
      incoming = pathBearing(
        node[0] - previous[0],
        node[1] - previous[1],
        config,
      ),
      outgoing = pathBearing(next[0] - node[0], next[1] - node[1], config),
      kind = classifyTurn(
        normalizeSignedDegrees(outgoing - incoming),
        config.settings.voice,
      );
    if (kind)
      result.push({
        nodeId: path[i],
        pathIndex: i,
        kind,
        floor: node[2],
        landmark: tag?.label,
      });
  }
  const last = path[path.length - 1];
  result.push({
    nodeId: last,
    pathIndex: path.length - 1,
    kind: "exit",
    floor: graph.nodes[last][2],
    landmark: graph.zones[last]?.label,
  });
  return result;
}
export function nextInstruction(
  graph: NavGraph,
  path: number[],
  position: Vec2,
  floor: number,
  config: BuildingConfig,
  heading: number | null = null,
  frame: "world" | "model" = "world",
  metersPerModelUnit = 1,
): NextInstruction | null {
  if (!path.length) return null;
  const maneuvers = buildManeuvers(graph, path, config),
    scale =
      (config.graphToModel?.scale ?? 1) *
      (frame === "model" ? metersPerModelUnit : (config.georef?.scale ?? 1));
  const maneuver = maneuvers.find((m) => m.floor === floor);
  if (!maneuver) return null;
  const point = graph.nodes[maneuver.nodeId];
  let distance =
    Math.hypot(
      position[0] - graph.nodes[path[0]][0],
      position[1] - graph.nodes[path[0]][1],
    ) * scale;
  for (let i = 1; i <= maneuver.pathIndex; i++) {
    const a = graph.nodes[path[i - 1]],
      b = graph.nodes[path[i]];
    distance += Math.hypot(a[0] - b[0], a[1] - b[1]) * scale;
  }
  let target: Vec2 = [point[0], point[1]];
  // At a turn aim down the outgoing edge, avoiding a zero-length direction.
  if (distance < 0.65 && maneuver.pathIndex < path.length - 1) {
    const next = graph.nodes[path[maneuver.pathIndex + 1]];
    target = [next[0], next[1]];
  }
  // The model guide aims along the next collision-free edge, even at a shallow bend.
  if (frame === "model") {
    const next = path
      .map((id) => graph.nodes[id])
      .find(
        (n) =>
          n[2] === floor &&
          Math.hypot(n[0] - position[0], n[1] - position[1]) > 0.03,
      );
    if (next) target = [next[0], next[1]];
  }
  const modelDirection = rotate(
    [target[0] - position[0], target[1] - position[1]],
    config.graphToModel?.rotationDeg ?? 0,
  );
  const modelStairTransition =
    frame === "model" &&
    path.length > 1 &&
    graph.nodes[path[0]][2] !== graph.nodes[path[1]][2];
  const absolute = modelStairTransition
    ? null
    : frame === "model"
      ? bearing(modelDirection[0], -modelDirection[1])
      : config.georef && config.graphToModel
        ? graphBearing(target[0] - position[0], target[1] - position[1], config)
        : null;
  const kind =
    maneuver.kind === "exit" && distance < 1 ? "arrival" : maneuver.kind;
  return {
    ...maneuver,
    kind,
    id: `${maneuver.nodeId}:${kind}:${maneuver.targetFloor ?? floor}`,
    distanceM: distance,
    target,
    bearing: absolute,
    relativeAngle:
      heading === null || absolute === null
        ? null
        : normalizeSignedDegrees(absolute - heading),
  };
}
export function instructionText(
  instruction: NextInstruction,
  language: Language,
  config: BuildingConfig,
): string {
  if (instruction.kind === "arrival") return phrase("arrival", language);
  const action = phrase(instruction.kind, language, {
    floor: floorNumber(config, instruction.targetFloor ?? instruction.floor),
  });
  const text =
    instruction.distanceM <= config.settings.voice.immediateM
      ? phrase("now", language, { action })
      : phrase("advance", language, {
          distance: Math.round(instruction.distanceM),
          action,
        });
  return instruction.landmark
    ? `${text} ${phrase("nearLandmark", language, { landmark: instruction.landmark })}`
    : text;
}
