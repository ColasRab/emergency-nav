import { it, expect } from "vitest";
import { instructionText } from "../lib/voice/instructionBuilder";
import { buildingSchema } from "../lib/buildings";
import raw from "../public/models/ynares.json";
it("includes known landmark labels without inventing a side", () => {
  const text = instructionText(
    {
      nodeId: 1,
      pathIndex: 1,
      kind: "left",
      floor: 0,
      landmark: "Room 204",
      id: "turn-1",
      distanceM: 10,
      target: [0, 10],
      bearing: null,
      relativeAngle: null,
    },
    "en",
    buildingSchema.parse(raw),
  );
  expect(text).toContain("Room 204");
  expect(text).toContain("turn left");
});
