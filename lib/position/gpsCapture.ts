import type { GpsFix } from "../calibration";
import { enuToLngLat, lngLatToEnu, type Vec2 } from "../geo/transform";

export const GPS_CAPTURE_READINGS = 5;
export const GPS_CAPTURE_SPAN_MS = 4_000;
export const GPS_CAPTURE_TIMEOUT_MS = 20_000;
export type GpsCaptureQuality = {
  readings: number;
  discarded: number;
  spreadM: number;
  durationMs: number;
};
export type GpsCapture = { gps: GpsFix; quality: GpsCaptureQuality };
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Robust center; repeated readings never manufacture a smaller accuracy radius. */
export function summarizeGpsReadings(readings: GpsFix[]): GpsCapture | null {
  if (readings.length < GPS_CAPTURE_READINGS) return null;
  const origin: Vec2 = [readings[0].longitude, readings[0].latitude],
    local = readings.map((gps) => ({
      gps,
      point: lngLatToEnu([gps.longitude, gps.latitude], origin),
    })),
    center: Vec2 = [
      median(local.map((p) => p.point[0])),
      median(local.map((p) => p.point[1])),
    ],
    radius = Math.max(1, 2 * median(readings.map((gps) => gps.accuracy))),
    inliers = local.filter(
      ({ point }) =>
        Math.hypot(point[0] - center[0], point[1] - center[1]) <= radius,
    );
  if (
    inliers.length < GPS_CAPTURE_READINGS ||
    inliers.length < Math.ceil(readings.length * 0.8)
  )
    return null;
  const durationMs =
    Math.max(...inliers.map((p) => p.gps.timestamp)) -
    Math.min(...inliers.map((p) => p.gps.timestamp));
  if (durationMs < GPS_CAPTURE_SPAN_MS) return null;
  const stableCenter: Vec2 = [
      median(inliers.map((p) => p.point[0])),
      median(inliers.map((p) => p.point[1])),
    ],
    spreadM = Math.max(
      ...inliers.map(({ point }) =>
        Math.hypot(point[0] - stableCenter[0], point[1] - stableCenter[1]),
      ),
    ),
    [longitude, latitude] = enuToLngLat(stableCenter, origin);
  return {
    gps: {
      longitude,
      latitude,
      accuracy: Math.max(...inliers.map((p) => p.gps.accuracy)) + spreadM,
      timestamp: Math.max(...inliers.map((p) => p.gps.timestamp)),
    },
    quality: {
      readings: inliers.length,
      discarded: readings.length - inliers.length,
      spreadM,
      durationMs,
    },
  };
}

/** Poll fresh fixes: watchPosition alone may stop emitting when a handset is still. */
export function captureCalibrationGps({
  signal,
  onProgress,
  geolocation = typeof navigator !== "undefined"
    ? navigator.geolocation
    : undefined,
}: {
  signal?: AbortSignal;
  onProgress?: (readings: number) => void;
  geolocation?: Pick<Geolocation, "getCurrentPosition">;
} = {}): Promise<GpsCapture> {
  return new Promise((resolve, reject) => {
    if (!geolocation)
      return reject(
        new Error("GPS is unavailable. Use Point and direction instead."),
      );
    let finished = false,
      next: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now(),
      readings: GpsFix[] = [],
      timestamps = new Set<number>();
    const finish = (error?: Error, capture?: GpsCapture) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      if (next) clearTimeout(next);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(capture!);
    };
    const abort = () =>
      finish(new DOMException("GPS capture cancelled", "AbortError"));
    const deadline = setTimeout(
      () =>
        finish(
          new Error(
            "GPS did not provide enough fresh, stable readings in 20 seconds. Try again or use Point and direction.",
          ),
        ),
      GPS_CAPTURE_TIMEOUT_MS,
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    const poll = () => {
      if (finished) return;
      try {
        geolocation.getCurrentPosition(
          (position) => {
            if (finished) return;
            const c = position.coords,
              t = position.timestamp,
              now = Date.now();
            if (
              Number.isFinite(c.latitude) &&
              Math.abs(c.latitude) <= 85 &&
              Number.isFinite(c.longitude) &&
              Math.abs(c.longitude) <= 180 &&
              Number.isFinite(c.accuracy) &&
              c.accuracy > 0 &&
              Number.isFinite(t) &&
              t >= startedAt - 1000 &&
              now - t <= 2000 &&
              t <= now + 1000 &&
              !timestamps.has(t)
            ) {
              timestamps.add(t);
              readings.push({
                latitude: c.latitude,
                longitude: c.longitude,
                accuracy: c.accuracy,
                timestamp: t,
              });
              onProgress?.(readings.length);
              const capture = summarizeGpsReadings(readings);
              if (capture) return finish(undefined, capture);
            }
            next = setTimeout(poll, 1000);
          },
          (error) => {
            if (finished) return;
            if (error.code === 1)
              return finish(
                new Error(
                  "Location permission denied. Allow location access or use Point and direction.",
                ),
              );
            next = setTimeout(poll, 1000);
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 },
        );
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error("GPS capture failed. Use Point and direction."),
        );
      }
    };
    poll();
  });
}
