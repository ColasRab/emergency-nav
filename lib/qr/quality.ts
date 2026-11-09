import { normalizeSignedDegrees, type Vec2 } from "../geo/transform";
export type PoseSample = {
  anchorId: string;
  position: Vec2;
  yaw: number;
  timestamp: number;
  uncertaintyM: number;
};
export function stablePose(
  samples: PoseSample[],
  agreeM: number,
  agreeDeg: number,
): PoseSample | null {
  const frames = samples.slice(-3);
  if (
    frames.length < 3 ||
    frames.some((f) => f.anchorId !== frames[0].anchorId)
  )
    return null;
  for (const a of frames)
    for (const b of frames)
      if (
        Math.hypot(
          a.position[0] - b.position[0],
          a.position[1] - b.position[1],
        ) > agreeM ||
        Math.abs(normalizeSignedDegrees(a.yaw - b.yaw)) > agreeDeg
      )
        return null;
  const median = (a: number[]) => a.sort((x, y) => x - y)[1],
    base = frames[0].yaw;
  return {
    ...frames[2],
    position: [
      median(frames.map((f) => f.position[0])),
      median(frames.map((f) => f.position[1])),
    ],
    yaw: normalizeSignedDegrees(
      base + median(frames.map((f) => normalizeSignedDegrees(f.yaw - base))),
    ),
  };
}
export function plausibleJump(
  previous: PoseSample | null,
  next: PoseSample,
  maxSpeedMS: number,
  metersPerGraphUnit = 1,
): boolean {
  if (!previous) return true;
  const distance =
    Math.hypot(
      next.position[0] - previous.position[0],
      next.position[1] - previous.position[1],
    ) * metersPerGraphUnit;
  return (
    distance <=
    (maxSpeedMS * Math.max(0, next.timestamp - previous.timestamp)) / 1000 +
      previous.uncertaintyM +
      next.uncertaintyM
  );
}
