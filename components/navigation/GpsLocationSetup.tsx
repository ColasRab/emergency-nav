"use client";
import { useMemo, useRef, useEffect, useState } from "react";
import type { BuildingConfig } from "@/lib/buildings";
import type { NavGraph } from "@/lib/astar";
import {
  buildingLocationPoints,
  calibrateLocations,
  assessGpsPosition,
  recommendedCalibrationPair,
  type GpsLocationSample,
  type LocationCalibration,
} from "@/lib/position/gpsCalibration";
import {
  captureCalibrationGps,
  GPS_CAPTURE_READINGS,
} from "@/lib/position/gpsCapture";
import LocationChooser from "./LocationChooser";

function CaptureProgress({
  count,
  onCancel,
}: {
  count: number;
  onCancel: () => void;
}) {
  return (
    <div className="gps-capture-progress" role="status">
      <p>
        Stand still · {count} fresh readings.{" "}
        {count >= GPS_CAPTURE_READINGS
          ? "Checking that the readings agree."
          : "Collecting at least five over four seconds."}
      </p>
      <button onClick={onCancel}>Cancel GPS recording</button>
    </div>
  );
}

export default function GpsLocationSetup({
  config,
  graph,
  floor,
  saved,
  onApply,
  onClear,
  onUsePoint,
}: {
  config: BuildingConfig;
  graph: NavGraph;
  floor: number;
  saved: LocationCalibration | null;
  onApply: (calibration: LocationCalibration, facing: number) => void;
  onClear: () => void;
  onUsePoint: React.ComponentProps<typeof LocationChooser>["onChoose"];
}) {
  const points = useMemo(
      () =>
        buildingLocationPoints(config, graph).filter((p) => p.floor === floor),
      [config, graph, floor],
    ),
    recommended = useMemo(() => recommendedCalibrationPair(points), [points]);
  const [mode, setMode] = useState<"gps" | "point">("gps"),
    [firstId, setFirstId] = useState(
      points.find((p) => p.id === saved?.first.point.id)?.id ??
        recommended[0]?.id ??
        points[0]?.id ??
        "",
    ),
    [secondId, setSecondId] = useState(
      points.find((p) => p.id === saved?.second.point.id)?.id ??
        recommended[1]?.id ??
        points[1]?.id ??
        "",
    ),
    [first, setFirst] = useState<GpsLocationSample | null>(null),
    [second, setSecond] = useState<GpsLocationSample | null>(null),
    [candidate, setCandidate] = useState<LocationCalibration | null>(null),
    [busy, setBusy] = useState<1 | 2 | null>(null),
    [collected, setCollected] = useState(0),
    [facing, setFacing] = useState(180),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  const alive = useRef(true),
    summary = useRef<HTMLDivElement>(null),
    errorMessage = useRef<HTMLParagraphElement>(null),
    lastAttemptPointId = useRef<string | undefined>(undefined),
    capture = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      capture.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!candidate) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [candidate]);
  useEffect(() => {
    if (error)
      errorMessage.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    else if (candidate)
      summary.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [error, candidate]);
  const guidanceQuality = candidate
    ? assessGpsPosition(candidate.second.gps, candidate)
    : null;
  const fresh =
      candidate !== null && now - candidate.second.gps.timestamp <= 60_000,
    firstPoint = points.find((p) => p.id === firstId),
    secondPoint = points.find((p) => p.id === secondId),
    modelSeparation =
      firstPoint && secondPoint
        ? Math.hypot(
            firstPoint.model[0] - secondPoint.model[0],
            firstPoint.model[1] - secondPoint.model[1],
          )
        : 0;
  function changeMode(next: "gps" | "point") {
    capture.current?.abort();
    setMode(next);
    setError("");
  }
  async function record(step: 1 | 2) {
    const point = points.find(
      (p) => p.id === (step === 1 ? firstId : secondId),
    );
    if (!point || (step === 2 && !first)) return;
    capture.current?.abort();
    const controller = new AbortController();
    lastAttemptPointId.current = point.id;
    capture.current = controller;
    setBusy(step);
    setCollected(0);
    setError("");
    setCandidate(null);
    if (step === 1) {
      setFirst(null);
      setSecond(null);
    } else setSecond(null);
    try {
      const result = await captureCalibrationGps({
        signal: controller.signal,
        onProgress: (count) => {
          if (alive.current && !controller.signal.aborted) setCollected(count);
        },
      });
      if (!alive.current || controller.signal.aborted) return;
      const sample = { point, ...result };
      setNow(Date.now());
      if (step === 1) setFirst(sample);
      else {
        setSecond(sample);
        setCandidate(calibrateLocations(config, first!, sample));
      }
    } catch (e) {
      if (alive.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "GPS could not be recorded.");
    } finally {
      if (alive.current && capture.current === controller) setBusy(null);
    }
  }
  return (
    <div className="gps-location-setup">
      <div
        className="calibration-methods"
        role="group"
        aria-label="Calibration method"
      >
        <button aria-pressed={mode === "gps"} onClick={() => changeMode("gps")}>
          GPS two points
        </button>
        <button
          aria-pressed={mode === "point"}
          onClick={() => changeMode("point")}
        >
          Point and direction
        </button>
      </div>
      {mode === "point" ? (
        <>
          <p>
            Use a known point and aim the phone in the chosen direction. This
            aligns the model and camera guide without GPS. Confirm new points as
            you walk.
          </p>
          <LocationChooser
            config={config}
            graph={graph}
            floor={floor}
            initialId={
              lastAttemptPointId.current ??
              second?.point.id ??
              first?.point.id ??
              firstId
            }
            hasGpsAlignment={false}
            onChoose={onUsePoint}
          />
        </>
      ) : (
        <>
          <p>
            Choose two identifiable points far apart on this floor. Stand still
            at each point while at least five fresh GPS readings are collected.
            Nearby room doors may be too close for GPS.
          </p>
          {saved && (
            <p className="status-line">
              A GPS alignment is saved on this device. A new attempt needs fresh
              recordings at both points; old readings are not reused.
            </p>
          )}
          <p className="status-line">
            Selected points are {modelSeparation.toFixed(1)} m apart in the
            estimated model. Left and right follow the map.
          </p>
          <div className="gps-record-step">
            <span className="gps-step-number">1</span>
            <label>
              First location
              <select
                value={firstId}
                disabled={busy !== null}
                onChange={(e) => {
                  setFirstId(e.target.value);
                  if (secondId === e.target.value)
                    setSecondId(
                      points.find((p) => p.id !== e.target.value)?.id ?? "",
                    );
                  setFirst(null);
                  setSecond(null);
                  setCandidate(null);
                  setError("");
                }}
              >
                {points.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy !== null || !firstId}
              onClick={() => void record(1)}
            >
              {busy === 1
                ? "Recording GPS…"
                : first
                  ? "Record first point again"
                  : "Record GPS at first point"}
            </button>
            {busy === 1 && (
              <CaptureProgress
                count={collected}
                onCancel={() => capture.current?.abort()}
              />
            )}
            {first && (
              <p className="gps-recorded">
                Recorded · GPS accuracy ±{first.gps.accuracy.toFixed(1)} m ·{" "}
                {first.quality.readings} readings · spread{" "}
                {first.quality.spreadM.toFixed(1)} m
              </p>
            )}
          </div>
          <div className="gps-record-step">
            <span className="gps-step-number">2</span>
            <label>
              Second location
              <select
                value={secondId}
                disabled={busy !== null}
                onChange={(e) => {
                  setSecondId(e.target.value);
                  setSecond(null);
                  setCandidate(null);
                  setError("");
                }}
              >
                {points
                  .filter((p) => p.id !== firstId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </select>
            </label>
            <button
              disabled={
                busy !== null || !first || !secondId || firstId === secondId
              }
              onClick={() => void record(2)}
            >
              {busy === 2
                ? "Recording GPS…"
                : second
                  ? "Record second point again"
                  : "Record GPS at second point"}
            </button>
            {busy === 2 && (
              <CaptureProgress
                count={collected}
                onCancel={() => capture.current?.abort()}
              />
            )}
            {second && (
              <p className="gps-recorded">
                Recorded · GPS accuracy ±{second.gps.accuracy.toFixed(1)} m ·{" "}
                {second.quality.readings} readings · spread{" "}
                {second.quality.spreadM.toFixed(1)} m
              </p>
            )}
          </div>
          {error && (
            <p ref={errorMessage} role="alert" className="status-warning">
              {error}
            </p>
          )}
          {candidate && (
            <div ref={summary} className="gps-fit-summary" role="status">
              <strong>
                {candidate.lowConfidence
                  ? "GPS cannot distinguish these points"
                  : guidanceQuality?.usable
                    ? "Location calibration ready"
                    : "Alignment recorded; GPS is too coarse for room guidance"}
              </strong>
              <p>
                Model separation {candidate.modelDistanceM.toFixed(2)} m · GPS
                separation {candidate.gpsDistanceM.toFixed(2)} m
              </p>
              <p>
                Ratio: {candidate.modelPerGpsMeter.toFixed(3)} model metres per
                GPS metre. Navigation distances keep the estimated model scale.
              </p>
              {candidate.lowConfidence && (
                <p className="status-warning">
                  Low GPS confidence. With these readings, the GPS baseline
                  needs to exceed{" "}
                  {(
                    3 *
                    (candidate.first.gps.accuracy +
                      candidate.second.gps.accuracy)
                  ).toFixed(1)}{" "}
                  m and the scale must be plausible. Use points farther apart,
                  or align a known point below.
                </p>
              )}
              {!fresh && (
                <p className="status-warning">
                  This capture is more than a minute old. Record the second
                  point again before confirming your position.
                </p>
              )}
              {!candidate.lowConfidence && !guidanceQuality?.usable && (
                <p className="status-warning">
                  You can save the alignment and confirm this point, but GPS
                  cannot currently track you between rooms. Use Point and
                  direction and confirm your progress as you walk.
                </p>
              )}
            </div>
          )}
          {candidate && !candidate.lowConfidence && (
            <label>
              Phone is pointing toward
              <select
                value={facing}
                onChange={(e) => setFacing(Number(e.target.value))}
              >
                <option value={180}>Front — corridor / room doors</option>
                <option value={0}>Back — window wall</option>
                <option value={90}>Right side of the map</option>
                <option value={270}>Left side of the map</option>
              </select>
            </label>
          )}
          <button
            className="primary-sheet-action"
            disabled={
              !candidate || candidate.lowConfidence || !fresh || busy !== null
            }
            onClick={() => {
              if (
                candidate &&
                !candidate.lowConfidence &&
                Date.now() - candidate.second.gps.timestamp <= 60_000
              )
                onApply(candidate, facing);
            }}
          >
            Use this calibration
          </button>
          <p className="status-line">
            Remain at the second point and aim the phone in the chosen direction
            before saving. GPS stays off until requested. Averaging does not
            make indoor GPS exact.
          </p>
          <button
            className="secondary-button"
            onClick={() => changeMode("point")}
          >
            Continue at a known point
          </button>
        </>
      )}
      {saved && (
        <button
          className="secondary-button"
          disabled={busy !== null}
          onClick={() => {
            onClear();
            setFirst(null);
            setSecond(null);
            setCandidate(null);
            setError("");
          }}
        >
          Clear saved calibration
        </button>
      )}
    </div>
  );
}
