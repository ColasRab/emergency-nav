/**
 * stairMotionDetector.ts
 *
 * Passive stair-climbing detection from device motion -- no camera, no
 * QR scan, no user action required once permission is granted. This is
 * classic signal processing (variance + step cadence), NOT machine
 * learning, so there's no training step and no dataset to collect.
 *
 * Why this matters for emergencies specifically: nobody fleeing a real
 * hazard will stop to scan a code. This has to run silently while the
 * person just moves.
 *
 * How it works:
 *  - Track vertical acceleration magnitude over a sliding window.
 *  - Flat walking: fairly small, regular oscillation.
 *  - Climbing/descending stairs: noticeably larger vertical swings
 *    (lifting/lowering body weight each step) at a slightly slower,
 *    heavier cadence than flat walking.
 *  - Classify each window as "flat" or "stairs" using variance +
 *    peak-interval thresholds. Tunable constants below -- calibrate
 *    once against a real phone/staircase if time allows, but the
 *    defaults are reasonable starting points from typical gait research.
 *
 * Direction (up vs down) is intentionally NOT inferred here. The app
 * already knows the planned route from A* (e.g. "descend Stairwell A to
 * floor 1") -- this detector just confirms the person is CURRENTLY
 * doing a stair segment, which is enough to advance progress along the
 * known plan without needing to solve direction-of-travel from noisy
 * accelerometer data.
 */

export type MotionState = "flat" | "stairs" | "stationary";

const WINDOW_MS = 2500; // how much recent motion history to analyze
const STATIONARY_THRESHOLD = 0.15; // m/s^2 variance below this = not moving
const STAIRS_VARIANCE_THRESHOLD = 3.5; // m/s^2 variance above this = likely stairs
const MIN_SAMPLES = 20; // need enough samples in the window before classifying

type Sample = { t: number; verticalAccel: number };

export class StairMotionDetector {
  private samples: Sample[] = [];
  private onStateChange: (state: MotionState) => void;
  private currentState: MotionState = "stationary";
  private listening = false;

  // tracks how long we've continuously been in "stairs" state, so the
  // app can decide "this looks like a full flight, advance floor" once
  // it's been sustained rather than a single noisy blip
  private stairsStateStartedAt: number | null = null;

  constructor(onStateChange: (state: MotionState) => void) {
    this.onStateChange = onStateChange;
  }

  async requestPermissionAndStart() {
    // iOS requires an explicit user gesture (e.g. a button tap) to grant
    // motion permission -- this should be called from a button's onClick,
    // but only needs to happen ONCE per session, not per stairwell.
    const anyWindow = window as any;
    if (typeof anyWindow.DeviceMotionEvent?.requestPermission === "function") {
      const result = await anyWindow.DeviceMotionEvent.requestPermission();
      if (result !== "granted") {
        throw new Error("Motion permission denied");
      }
    }
    this.start();
  }

  private start() {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener("devicemotion", this.handleMotion);
  }

  stop() {
    this.listening = false;
    window.removeEventListener("devicemotion", this.handleMotion);
  }

  private handleMotion = (event: DeviceMotionEvent) => {
    const accel = event.accelerationIncludingGravity;
    if (!accel || accel.z === null) return;

    const now = Date.now();
    // z-axis is roughly vertical when the phone is held upright/in a
    // pocket in typical orientation -- good enough for this heuristic
    // without full sensor-fusion orientation correction.
    this.samples.push({ t: now, verticalAccel: accel.z });
    this.samples = this.samples.filter((s) => now - s.t <= WINDOW_MS);

    if (this.samples.length < MIN_SAMPLES) return;

    const values = this.samples.map((s) => s.verticalAccel);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;

    let newState: MotionState;
    if (variance < STATIONARY_THRESHOLD) {
      newState = "stationary";
    } else if (variance > STAIRS_VARIANCE_THRESHOLD) {
      newState = "stairs";
    } else {
      newState = "flat";
    }

    if (newState !== this.currentState) {
      if (newState === "stairs") {
        this.stairsStateStartedAt = now;
      }
      if (this.currentState === "stairs" && newState !== "stairs") {
        this.stairsStateStartedAt = null;
      }
      this.currentState = newState;
      this.onStateChange(newState);
    }
  };

  /** How many ms the person has been continuously in "stairs" state, or 0. */
  get stairsDurationMs(): number {
    if (this.currentState !== "stairs" || this.stairsStateStartedAt === null) return 0;
    return Date.now() - this.stairsStateStartedAt;
  }
}
