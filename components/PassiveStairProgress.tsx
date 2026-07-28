"use client";

import { useEffect, useRef, useState } from "react";
import { StairMotionDetector, type MotionState } from "@/lib/stairMotionDetector";

/**
 * PassiveStairProgress
 *
 * Runs silently once started -- no scanning, no camera pointing, no
 * action required while moving. When the accelerometer pattern matches
 * "climbing/descending stairs" for long enough to plausibly be a real
 * flight (not just a single step or a stumble), it fires
 * onStairSegmentConfirmed() so the app can advance the user's position
 * to the next floor's connector node in the PLANNED route -- direction
 * comes from the A* plan, not from guessing it out of sensor noise.
 */

const MIN_STAIRS_DURATION_MS = 4000; // require a sustained bout, not a blip

export default function PassiveStairProgress({
  expectingStairSegment,
  onStairSegmentConfirmed,
}: {
  expectingStairSegment: boolean; // true when the current A* step IS a stair connector
  onStairSegmentConfirmed: () => void;
}) {
  const [state, setState] = useState<MotionState>("stationary");
  const [permissionGranted, setPermissionGranted] = useState(false);
  const detectorRef = useRef<StairMotionDetector | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    detectorRef.current = new StairMotionDetector((newState) => setState(newState));
    return () => detectorRef.current?.stop();
  }, []);

  // Poll stairs duration and fire once a sustained bout is confirmed,
  // but only while the current plan step actually expects a stair segment
  // -- this avoids false-triggering progress if someone happens to climb
  // unrelated stairs not on their route.
  useEffect(() => {
    if (!expectingStairSegment) {
      firedRef.current = false;
      return;
    }
    const interval = setInterval(() => {
      const duration = detectorRef.current?.stairsDurationMs ?? 0;
      if (!firedRef.current && duration >= MIN_STAIRS_DURATION_MS) {
        firedRef.current = true;
        onStairSegmentConfirmed();
      }
    }, 300);
    return () => clearInterval(interval);
  }, [expectingStairSegment, onStairSegmentConfirmed]);

  async function enableMotionTracking() {
    await detectorRef.current?.requestPermissionAndStart();
    setPermissionGranted(true);
  }

  return (
    <div className="recognizer-panel">
      {!permissionGranted ? (
        <button onClick={enableMotionTracking}>Enable passive motion tracking</button>
      ) : (
        <>
          <p className="status-line">
            Motion state: <strong>{state}</strong>
            {expectingStairSegment && state === "stairs" && " — confirming stair segment…"}
          </p>
          {!expectingStairSegment && (
            <p className="status-line">No stair segment expected right now — tracking idle.</p>
          )}
        </>
      )}
    </div>
  );
}
