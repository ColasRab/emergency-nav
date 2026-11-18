import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GpsFix } from "../lib/calibration";
import { enuToLngLat } from "../lib/geo/transform";
import {
  captureCalibrationGps,
  summarizeGpsReadings,
  GPS_CAPTURE_TIMEOUT_MS,
} from "../lib/position/gpsCapture";

const epoch = Date.UTC(2026, 10, 18);
const fix = (east = 0, timestamp = Date.now(), accuracy = 4): GpsFix => {
  const [longitude, latitude] = enuToLngLat([east, 0], [121.2, 14.6]);
  return { longitude, latitude, timestamp, accuracy };
};
const position = (gps: GpsFix): GeolocationPosition => ({
  coords: {
    ...gps,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    toJSON: () => ({
      latitude: gps.latitude,
      longitude: gps.longitude,
      accuracy: gps.accuracy,
    }),
  },
  timestamp: gps.timestamp,
  toJSON: () => ({ timestamp: gps.timestamp }),
});

describe("stationary GPS capture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(epoch);
  });
  afterEach(() => vi.useRealTimers());
  it("requires five independent readings over at least four seconds and retains receiver uncertainty", async () => {
    const geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback) =>
        success(position(fix())),
      ),
    };
    let finished = false;
    const result = captureCalibrationGps({ geolocation }).then((r) => {
      finished = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(3999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const capture = await result;
    expect(capture.quality.readings).toBe(5);
    expect(capture.quality.durationMs).toBe(4000);
    expect(capture.gps.accuracy).toBeGreaterThanOrEqual(4);
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(5);
  });
  it("ignores cached timestamps instead of counting one location response five times", async () => {
    const geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback) =>
        success(position(fix(0, epoch))),
      ),
    };
    const result = captureCalibrationGps({ geolocation }).catch(
      (e) => e as Error,
    );
    await vi.advanceTimersByTimeAsync(GPS_CAPTURE_TIMEOUT_MS);
    expect(((await result) as Error).message).toContain("enough fresh");
    const calls = geolocation.getCurrentPosition.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(calls);
  });
  it("uses a stable majority without letting an isolated jump drag the calibration origin", () => {
    const readings = [0, 0.1, 100, -0.1, 0.05, 0].map((x, i) =>
      fix(x, epoch + i * 1000, 0.4),
    );
    const result = summarizeGpsReadings(readings)!;
    expect(result.quality.readings).toBe(5);
    expect(result.quality.discarded).toBe(1);
    expect(result.quality.spreadM).toBeLessThan(0.2);
    expect(result.gps.accuracy).toBeGreaterThanOrEqual(0.4);
  });
  it("refuses split clusters and adds observed drift to the retained accuracy radius", () => {
    expect(
      summarizeGpsReadings(
        [0, 0, 0, 20, 20, 20].map((x, i) => fix(x, epoch + i * 1000, 0.3)),
      ),
    ).toBeNull();
    const stable = summarizeGpsReadings(
      [-0.5, -0.2, 0, 0.2, 0.5].map((x, i) => fix(x, epoch + i * 1000, 2)),
    )!;
    expect(stable.gps.accuracy).toBeGreaterThan(2.4);
  });
  it("cancels pending work and ignores late browser callbacks", async () => {
    let success: PositionCallback | undefined;
    const geolocation = {
        getCurrentPosition: vi.fn((cb: PositionCallback) => {
          success = cb;
        }),
      },
      controller = new AbortController(),
      onProgress = vi.fn();
    const result = captureCalibrationGps({
      geolocation,
      signal: controller.signal,
      onProgress,
    }).catch((e) => e as Error);
    controller.abort();
    expect(((await result) as Error).name).toBe("AbortError");
    success!(position(fix()));
    await vi.advanceTimersByTimeAsync(30000);
    expect(onProgress).not.toHaveBeenCalled();
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  });
  it("reports permission denial immediately rather than continuing to poll", async () => {
    const geolocation = {
      getCurrentPosition: vi.fn(
        (_success: PositionCallback, error?: PositionErrorCallback | null) =>
          error!({ code: 1 } as GeolocationPositionError),
      ),
    };
    const result = captureCalibrationGps({ geolocation }).catch(
      (e) => e as Error,
    );
    expect(((await result) as Error).message).toContain("permission denied");
    await vi.advanceTimersByTimeAsync(30000);
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});
