import { z } from "zod";
import type { NavGraph } from "./astar";
const graphSchema = z.object({
  meta: z
    .object({
      resolution: z.number().positive().optional(),
      origin_x: z.number().optional(),
      origin_z: z.number().optional(),
      buildingId: z.string().optional(),
      version: z.number().optional(),
      units: z.string().optional(),
    })
    .optional(),
  nodes: z.record(
    z.string(),
    z.tuple([z.number().finite(), z.number().finite(), z.number().int()]),
  ),
  edges: z.record(
    z.string(),
    z.array(z.tuple([z.number().int(), z.number().nonnegative()])),
  ),
  exits: z.array(z.number().int()),
  zones: z
    .record(z.string(), z.object({ label: z.string(), type: z.string() }))
    .default({}),
});
export function parseGraph(input: unknown): NavGraph {
  const graph = graphSchema.parse(input);
  if (!Object.keys(graph.nodes).length)
    throw new Error("Graph contains no nodes.");
  for (const [from, edges] of Object.entries(graph.edges)) {
    if (!graph.nodes[from]) throw new Error("Unknown edge origin");
    for (const [to] of edges)
      if (!graph.nodes[to]) throw new Error("Unknown edge destination");
  }
  if (graph.exits.some((id) => !graph.nodes[id]))
    throw new Error("Unknown exit");
  return graph;
}
