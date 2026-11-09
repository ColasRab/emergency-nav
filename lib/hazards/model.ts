import { z } from "zod";
export const hazardTypes = [
  "crowd",
  "fire",
  "smoke",
  "blocked",
  "obstruction",
  "flood",
  "other",
] as const;
export type HazardType = (typeof hazardTypes)[number];
export const hazardSchema = z.object({
  id: z.string().uuid(),
  buildingId: z.enum(["admin", "ynares"]),
  floor: z.number().int(),
  nodeIds: z.array(z.number().int().nonnegative()).min(1).max(1000),
  edge: z.tuple([z.number().int(), z.number().int()]).optional(),
  type: z.enum(hazardTypes),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  confidence: z.number().min(0).max(1),
  source: z.enum(["auto", "user", "admin"]),
  confirmations: z.number().int().nonnegative(),
  dismissals: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});
export type Hazard = z.infer<typeof hazardSchema>;
export type DetectedHazard = {
  type: HazardType;
  confidence: number;
  bbox?: [number, number, number, number];
  personCount?: number;
};
export interface HazardDetector {
  id: string;
  load(): Promise<void>;
  detect(frame: ImageBitmap | HTMLVideoElement): Promise<DetectedHazard[]>;
  dispose?(): void;
}
export function isActive(h: Hazard, now: number) {
  return h.expiresAt > now && h.dismissals < h.confirmations + 2;
}
