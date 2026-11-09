import { it, expect } from "vitest";
import { buildingSchema } from "../lib/buildings";
import raw from "../public/models/ynares.json";
import {
  classifyTurn,
  nextInstruction,
  buildManeuvers,
} from "../lib/voice/instructionBuilder";
import { InstructionScheduler, shouldInterrupt } from "../lib/voice/scheduler";
import type { NavGraph } from "../lib/astar";
const c = buildingSchema.parse(raw);
const graph: NavGraph = {
  nodes: { 0: [0, 0, 0], 1: [0, 10, 0], 2: [10, 10, 0], 3: [10, 10, 1] },
  edges: {},
  zones: {},
  exits: [3],
};
it("classifies left, right, slight, sharp and U-turn", () => {
  const t = c.settings.voice;
  expect(classifyTurn(-90, t)).toBe("left");
  expect(classifyTurn(90, t)).toBe("right");
  expect(classifyTurn(20, t)).toBe("slight-right");
  expect(classifyTurn(140, t)).toBe("sharp-right");
  expect(classifyTurn(180, t)).toBe("uturn");
  expect(classifyTurn(4, t)).toBeNull();
});
it("aims at the corridor turn instead of the exit through walls", () => {
  const next = nextInstruction(graph, [0, 1, 2, 3], [0, 0], 0, c)!;
  expect(next.nodeId).toBe(1);
  expect(next.target).toEqual([0, 10]);
  expect(next.distanceM).toBe(10);
  expect(
    buildManeuvers(graph, [0, 1, 2, 3], c).some(
      (m) => m.kind === "stairs-up" && m.targetFloor === 1,
    ),
  ).toBe(true);
});
it("triggers advance then immediate prompts once and suppresses duplicates", () => {
  const s = new InstructionScheduler(),
    i = nextInstruction(graph, [0, 1, 2, 3], [0, 0], 0, c)!;
  expect(s.trigger(i, "In 10 meters", 10000)).not.toBeNull();
  expect(s.trigger(i, "In 10 meters", 11000)).toBeNull();
  expect(s.trigger({ ...i, distanceM: 2 }, "Turn now", 12000)).not.toBeNull();
  expect(s.trigger({ ...i, distanceM: 1 }, "Turn now", 22000)).toBeNull();
});
it("prioritizes hazard interruption and requires sustained off-route error", () => {
  expect(shouldInterrupt("emergency", "maneuver")).toBe(true);
  expect(shouldInterrupt("info", "maneuver")).toBe(false);
  const s = new InstructionScheduler();
  expect(s.offRoute(5, 1000)).toBe(false);
  expect(s.offRoute(5, 4001)).toBe(true);
  expect(s.offRoute(2, 5000)).toBe(false);
});
