import type { BuildingConfig } from "../buildings";
import {
  headingToGraphVector,
  normalizeSignedDegrees,
  type Vec2,
} from "../geo/transform";
import { plausibleJump, type PoseSample } from "../qr/quality";
export type PositionEstimate = {
  position: Vec2;
  floor: number;
  uncertaintyM: number;
  timestamp: number;
  lastScanAt: number | null;
  requiresFloorScan: boolean;
  source: "qr" | "manual" | "sign" | "steps" | "gps";
};
export type HeadingSample = {
  anchorId: string;
  offset: number;
  weight: number;
};
export function circularMean(
  samples: { offset: number; weight: number }[],
): number | null {
  if (!samples.length) return null;
  const x = samples.reduce(
      (s, p) => s + Math.cos((p.offset * Math.PI) / 180) * p.weight,
      0,
    ),
    y = samples.reduce(
      (s, p) => s + Math.sin((p.offset * Math.PI) / 180) * p.weight,
      0,
    );
  return Math.hypot(x, y) < 1e-8
    ? null
    : normalizeSignedDegrees((Math.atan2(y, x) * 180) / Math.PI);
}
export function addHeadingSample(
  samples: HeadingSample[],
  sample: HeadingSample,
): HeadingSample[] {
  return [
    ...samples.filter((p) => p.anchorId !== sample.anchorId),
    sample,
  ].slice(-20);
}
export function acceptQr(
  previous: PositionEstimate | null,
  pose: PoseSample,
  floor: number,
  config: BuildingConfig,
  relocated = false,
): PositionEstimate {
  const scale = (config.graphToModel?.scale ?? 1) * (config.georef?.scale ?? 1);
  const prev: PoseSample | null = previous
    ? {
        anchorId: "previous",
        position: previous.position,
        yaw: 0,
        timestamp: previous.timestamp,
        uncertaintyM: previous.uncertaintyM,
      }
    : null;
  if (
    previous &&
    previous.floor !== floor &&
    !previous.requiresFloorScan &&
    !relocated
  )
    throw new Error(
      "Floor changed unexpectedly. Confirm your floor and scan again.",
    );
  if (
    !relocated &&
    !plausibleJump(prev, pose, config.settings.qr.maxSpeedMS, scale)
  )
    throw new Error(
      "This scan implies an implausible jump. Confirm that you moved to a different location before accepting it.",
    );
  return {
    position: pose.position,
    floor,
    uncertaintyM: pose.uncertaintyM,
    timestamp: pose.timestamp,
    lastScanAt: pose.timestamp,
    requiresFloorScan: false,
    source: "qr",
  };
}
export function advanceStep(
  estimate: PositionEstimate,
  heading: number,
  config: BuildingConfig,
  now = Date.now(),
): PositionEstimate {
  if (estimate.requiresFloorScan)
    return {
      ...estimate,
      uncertaintyM: estimate.uncertaintyM + 0.1,
      timestamp: now,
    };
  const distance = config.settings.qr.stepLengthM,
    [dx, dz] = headingToGraphVector(heading, distance, config);
  return {
    ...estimate,
    position: [estimate.position[0] + dx, estimate.position[1] + dz],
    uncertaintyM:
      estimate.uncertaintyM + distance * config.settings.qr.uncertaintyPerM,
    timestamp: now,
    source: "steps",
  };
}
export function markStairArrival(
  estimate: PositionEstimate,
  position: Vec2,
  floor: number,
  now = Date.now(),
): PositionEstimate {
  return {
    ...estimate,
    position,
    floor,
    timestamp: now,
    uncertaintyM: Math.max(3, estimate.uncertaintyM),
    requiresFloorScan: true,
    source: "steps",
  };
}
export class StepDetector {
  private armed = true;
  private lastStep = -Infinity;
  constructor(private threshold = 1.2) {}
  sample(accelerationMagnitude: number, time: number): boolean {
    if (!Number.isFinite(accelerationMagnitude) || accelerationMagnitude > 35)
      return false;
    const high = accelerationMagnitude - 9.81;
    if (high < 0.2) this.armed = true;
    if (this.armed && high > this.threshold && time - this.lastStep > 350) {
      this.armed = false;
      this.lastStep = time;
      return true;
    }
    return false;
  }
}
