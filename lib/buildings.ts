import { z } from "zod";

export const buildingIds = ["admin", "ynares"] as const;
export type BuildingId = (typeof buildingIds)[number];
export const floorSchema = z.object({
  index: z.number().int(),
  baseY: z.number().finite(),
  height: z.number().positive(),
  slabThicknessM: z.number().positive().optional(),
  label: z.string().optional(),
  displayNumber: z.number().int().optional(),
  railings: z.enum(["open-lobby", "full-perimeter"]).optional(),
});
export const roomSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  floor: z.number().int(),
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  doors: z.array(z.tuple([z.number(), z.number()])),
  nodeId: z.number().int(),
  doorNodeIds: z.array(z.number().int()),
  color: z.string(),
  estimated: z.boolean(),
  obstacles: z
    .array(z.tuple([z.number(), z.number(), z.number(), z.number()]))
    .default([]),
});
export type Room = z.infer<typeof roomSchema>;
const similaritySchema = z.object({
  dx: z.number().finite(),
  dz: z.number().finite(),
  rotationDeg: z.number().finite(),
  scale: z.number().positive(),
});
export const buildingSchema = z.object({
  id: z.enum(buildingIds),
  name: z.string(),
  glb: z.string().nullable(),
  graph: z.string().nullable(),
  modelKind: z.enum(["scan", "room-layout"]).default("scan"),
  modelRevision: z.string().optional(),
  heightSource: z.string().optional(),
  scanGlb: z.string().optional(),
  planImage: z.string().optional(),
  rooms: z.array(roomSchema).optional(),
  layoutDimensions: z
    .object({
      width: z.number().positive(),
      roomDepth: z.number().positive(),
      corridorDepth: z.number().positive(),
      projectionWidth: z.number().positive(),
      projectionDepth: z.number().positive(),
    })
    .optional(),
  assumptions: z.array(z.string()).optional(),
  modelVerified: z.boolean(),
  graphVerified: z.boolean(),
  floorsVerified: z.boolean(),
  floors: z.array(floorSchema).min(1),
  georef: z
    .object({
      originLngLat: z.tuple([
        z.number().min(-180).max(180),
        z.number().min(-85).max(85),
      ]),
      altitudeM: z.number().finite(),
      rotationDeg: z.number().finite(),
      scale: z.number().positive(),
      residualRmsM: z.number().nonnegative(),
    })
    .nullable(),
  graphToModel: similaritySchema.nullable(),
  settings: z.object({
    crowd: z.object({
      busy: z.number(),
      congested: z.number(),
      radiusM: z.number().positive(),
      ttlMs: z.number().positive(),
    }),
    hazards: z.object({
      multipliers: z.tuple([z.number(), z.number()]),
      ttlMs: z.number().positive(),
      confirmationFrames: z.number().int(),
      windowFrames: z.number().int(),
      confidence: z.number(),
      snapRadiusM: z.number(),
      switchSaving: z.number(),
      fallbackMultiplier: z.number(),
    }),
    qr: z.object({
      fovDeg: z.number(),
      minSidePx: z.number(),
      maxAngleDeg: z.number(),
      minBlurVariance: z.number(),
      maxGyroDegS: z.number(),
      agreeM: z.number(),
      agreeDeg: z.number(),
      maxSpeedMS: z.number(),
      stepLengthM: z.number(),
      stepThreshold: z.number(),
      defaultSizeMm: z.number(),
      uncertaintyPerM: z.number(),
    }),
    voice: z.object({
      slightDeg: z.number(),
      turnDeg: z.number(),
      sharpDeg: z.number(),
      uTurnDeg: z.number(),
      advanceM: z.number(),
      immediateM: z.number(),
      cooldownMs: z.number(),
      offRouteM: z.number(),
      offRouteMs: z.number(),
    }),
  }),
});
export type BuildingConfig = z.infer<typeof buildingSchema>;
export type Floor = z.infer<typeof floorSchema>;
export function floorLabel(config: BuildingConfig, index: number): string {
  const floor = config.floors.find((f) => f.index === index);
  return floor?.label ?? `Floor ${floor?.displayNumber ?? index}`;
}
export function floorNumber(config: BuildingConfig, index: number): number {
  return config.floors.find((f) => f.index === index)?.displayNumber ?? index;
}
export async function loadBuilding(id: BuildingId): Promise<BuildingConfig> {
  const response = await fetch(`/models/${id}.json`);
  if (!response.ok) throw new Error("Unable to load building settings.");
  return buildingSchema.parse(await response.json());
}
