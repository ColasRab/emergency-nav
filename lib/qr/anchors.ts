import { z } from "zod";
import type { BuildingId } from "../buildings";
export const anchorSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  buildingId: z.enum(["admin", "ynares"]),
  floor: z.number().int(),
  position: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  normal: z
    .tuple([z.number().finite(), z.number().finite()])
    .refine(
      (n) => Math.abs(Math.hypot(...n) - 1) < 0.01,
      "Wall normal must have length 1",
    ),
  mountHeightM: z.number().positive(),
  sizeMm: z.number().min(30).max(1000),
  nearestNodeId: z.number().int().nonnegative(),
});
export type QRAnchor = z.infer<typeof anchorSchema>;
export const anchorsKey = "wayfinder:anchors:v1";
export async function loadAnchors(buildingId: BuildingId): Promise<QRAnchor[]> {
  const response = await fetch("/models/anchors.json");
  if (!response.ok) throw new Error("Unable to load anchor survey.");
  const base = z.array(anchorSchema).parse(await response.json());
  let draft: QRAnchor[] = [];
  try {
    const saved = localStorage.getItem(anchorsKey);
    if (saved) draft = z.array(anchorSchema).parse(JSON.parse(saved));
  } catch {
    localStorage.removeItem(anchorsKey);
  }
  const merged = new Map(base.map((a) => [`${a.buildingId}:${a.id}`, a]));
  for (const a of draft) merged.set(`${a.buildingId}:${a.id}`, a);
  return [...merged.values()].filter((a) => a.buildingId === buildingId);
}
export function saveAnchors(anchors: QRAnchor[]) {
  localStorage.setItem(
    anchorsKey,
    JSON.stringify(z.array(anchorSchema).parse(anchors)),
  );
}
