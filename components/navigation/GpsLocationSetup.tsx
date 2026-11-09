"use client";
import { useMemo, useRef, useEffect, useState } from "react";
import type { BuildingConfig } from "@/lib/buildings";
import type { NavGraph } from "@/lib/astar";
import { getCurrentGpsFix } from "@/lib/calibration";
import {
  buildingLocationPoints,
  calibrateLocations,
  gpsFixSchema,
  type GpsLocationSample,
  type LocationCalibration,
} from "@/lib/position/gpsCalibration";

export default function GpsLocationSetup({
  config,
  graph,
  floor,
  saved,
  onApply,
  onClear,
}: {
  config: BuildingConfig;
  graph: NavGraph;
  floor: number;
  saved: LocationCalibration | null;
  onApply: (calibration: LocationCalibration) => void;
  onClear: () => void;
}) {
  const points = useMemo(
      () =>
        buildingLocationPoints(config, graph).filter((p) => p.floor === floor),
      [config, graph, floor],
    ),
    preferred =
      points.find((p) => p.label === "Marsden · Right door") ?? points[0],
    secondDefault =
      points.find((p) => p.label === "Marsden · Left door") ??
      points.find((p) => p.id !== preferred?.id),
    usableSaved = saved?.first.point.floor === floor ? saved : null;
  const [firstId, setFirstId] = useState(
      usableSaved?.first.point.id ?? preferred?.id ?? "",
    ),
    [secondId, setSecondId] = useState(
      usableSaved?.second.point.id ?? secondDefault?.id ?? "",
    ),
    [first, setFirst] = useState<GpsLocationSample | null>(
      usableSaved?.first ?? null,
    ),
    [second, setSecond] = useState<GpsLocationSample | null>(
      usableSaved?.second ?? null,
    ),
    [candidate, setCandidate] = useState<LocationCalibration | null>(
      usableSaved,
    ),
    [busy, setBusy] = useState<1 | 2 | null>(null),
    [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function record(step: 1 | 2) {
    const point = points.find(
      (p) => p.id === (step === 1 ? firstId : secondId),
    );
    if (!point || (step === 2 && !first)) return;
    setBusy(step);
    setError("");
    setCandidate(null);
    try {
      const gps = gpsFixSchema.parse(await getCurrentGpsFix());
      if (!alive.current) return;
      if (
        Date.now() - gps.timestamp > 30000 ||
        gps.timestamp > Date.now() + 5000
      )
        throw new Error("The GPS reading is stale. Record this point again.");
      const sample = { point, gps };
      if (step === 1) {
        setFirst(sample);
        setSecond(null);
      } else {
        setSecond(sample);
        setCandidate(calibrateLocations(config, first!, sample));
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "GPS could not be recorded.");
    } finally {
      if (alive.current) setBusy(null);
    }
  }
  return (
    <div className="gps-location-setup">
      <p>
        Stand at the first location and record GPS. Move to the second location,
        then record again. Left and right follow the model map.
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
        {first && (
          <p className="gps-recorded">
            Recorded · GPS accuracy ±{first.gps.accuracy.toFixed(1)} m
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
        {second && (
          <p className="gps-recorded">
            Recorded · GPS accuracy ±{second.gps.accuracy.toFixed(1)} m
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="status-warning">
          {error}
        </p>
      )}
      {candidate && (
        <div className="gps-fit-summary" role="status">
          <strong>Location calibration ready</strong>
          <p>
            Model separation {candidate.modelDistanceM.toFixed(2)} m · GPS
            separation {candidate.gpsDistanceM.toFixed(2)} m
          </p>
          <p>
            Ratio: {candidate.modelPerGpsMeter.toFixed(3)} model metres per GPS
            metre. Position and direction use this alignment.
          </p>
          {candidate.lowConfidence && (
            <p className="status-warning">
              Low GPS confidence. These readings may not distinguish the two
              doors reliably. Points farther apart can give a better baseline.
            </p>
          )}
        </div>
      )}
      <button
        className="primary-sheet-action"
        disabled={!candidate || busy !== null}
        onClick={() => candidate && onApply(candidate)}
      >
        Use this calibration
      </button>
      <p className="status-line">
        Saved on this device. GPS updates position, while you select the floor
        manually. Calibration does not improve the phone’s GPS accuracy.
      </p>
      {saved && (
        <button
          className="secondary-button"
          disabled={busy !== null}
          onClick={() => {
            onClear();
            setFirst(null);
            setSecond(null);
            setCandidate(null);
          }}
        >
          Clear saved calibration
        </button>
      )}
    </div>
  );
}
