"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ZoneRecognizer from "@/components/ZoneRecognizer";
import QRAndCrowdRecognizer from "@/components/QRAndCrowdRecognizer";
import PassiveStairProgress from "@/components/PassiveStairProgress";
import CameraNavigation from "@/components/CameraNavigation";
import FloorMap from "@/components/FloorMap";
import { astar, nearestNodeOnFloor, type NavGraph } from "@/lib/astar";
import {
  createCalibrationTransform,
  gpsToGraph,
  type CalibrationSample,
  type CalibrationTransform,
  type GpsFix,
} from "@/lib/calibration";

type Mode = "ocr" | "qr" | "navigate";

const CALIBRATION_STORAGE_KEY = "emergency-nav:gps-calibration:v1";
const POSITION_LOCK_MS = 6_000;
const STAIR_POSITION_LOCK_MS = 12_000;

function buildLiveMultipliers(
  graph: NavGraph,
  nodeId: number,
  penalty: number
): Record<string, number> {
  const multipliers: Record<string, number> = {};
  const edges = graph.edges[String(nodeId)] ?? [];
  for (const [neighborId] of edges) {
    multipliers[`${nodeId}->${neighborId}`] = penalty;
    multipliers[`${neighborId}->${nodeId}`] = penalty;
  }
  return multipliers;
}

function directionsFromPath(graph: NavGraph, path: number[]) {
  const steps: { label: string; nodeId: number }[] = [];
  let lastLabel = "";
  for (const nodeId of path) {
    const tag = graph.zones[String(nodeId)];
    const label = tag ? tag.label : "Corridor";
    if (label !== lastLabel) {
      steps.push({ label, nodeId });
      lastLabel = label;
    }
  }
  if (steps.length > 0) steps[steps.length - 1].label += " (exit)";
  return steps;
}

function isCalibrationTransform(value: unknown): value is CalibrationTransform {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CalibrationTransform>;
  return (
    typeof candidate.originLatitude === "number" &&
    typeof candidate.originLongitude === "number" &&
    typeof candidate.scale === "number" &&
    typeof candidate.rotationRadians === "number" &&
    Array.isArray(candidate.graphOrigin)
  );
}

export default function Page() {
  const [graph, setGraph] = useState<NavGraph | null>(null);
  const [mode, setMode] = useState<Mode>("qr");
  const [currentNodeId, setCurrentNodeId] = useState<number | null>(null);
  const [currentLabel, setCurrentLabel] = useState<string>("Unknown");
  const [currentFloor, setCurrentFloor] = useState(0);
  const [graphPosition, setGraphPosition] = useState<[number, number] | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState("Scan the first QR point to begin GPS calibration.");
  const [firstCalibrationSample, setFirstCalibrationSample] = useState<CalibrationSample | null>(null);
  const [calibration, setCalibration] = useState<CalibrationTransform | null>(null);
  const [congestion, setCongestion] = useState<{ penalty: number; count: number } | null>(null);
  const [liveMultipliers, setLiveMultipliers] = useState<Record<string, number>>({});
  const positionLockUntilRef = useRef(0);

  useEffect(() => {
    fetch("/nav_graph.json")
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load the building map.");
        return response.json();
      })
      .then(setGraph)
      .catch((error) => setGpsStatus(error instanceof Error ? error.message : "Map loading failed."));
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CALIBRATION_STORAGE_KEY);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (isCalibrationTransform(parsed)) {
        setCalibration(parsed);
        setCurrentFloor(parsed.floor);
        setGpsStatus("Saved GPS calibration loaded. Waiting for a position update…");
      }
    } catch {
      localStorage.removeItem(CALIBRATION_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!graph || !calibration) return;
    if (!("geolocation" in navigator)) {
      setGpsStatus("GPS is not available in this browser.");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (Date.now() < positionLockUntilRef.current) return;
        const projected = gpsToGraph(
          {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
          calibration
        );
        const nodeId = nearestNodeOnFloor(graph, projected[0], projected[1], currentFloor);
        setGraphPosition(projected);
        setGpsAccuracy(position.coords.accuracy);
        setGpsStatus(`GPS tracking active on Floor ${currentFloor}.`);
        if (nodeId >= 0) {
          setCurrentNodeId(nodeId);
          setCurrentLabel(graph.zones[String(nodeId)]?.label ?? `GPS position · Floor ${currentFloor}`);
        }
      },
      (error) => setGpsStatus(error.message || "Unable to track GPS position."),
      { enableHighAccuracy: true, maximumAge: 500, timeout: 10_000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [calibration, currentFloor, graph]);

  const result = useMemo(() => {
    if (!graph || currentNodeId === null) return null;
    return astar(graph, currentNodeId, graph.exits, liveMultipliers);
  }, [graph, currentNodeId, liveMultipliers]);

  const directions = useMemo(() => {
    if (!graph || !result?.path) return [];
    return directionsFromPath(graph, result.path);
  }, [graph, result]);

  const expectingStairSegment = useMemo(() => {
    if (!graph || !result?.path || result.path.length < 2) return false;
    const [current, next] = result.path;
    if (graph.nodes[current][2] !== graph.nodes[next][2]) return true;
    const currentZoneType = graph.zones[String(current)]?.type?.toLowerCase() ?? "";
    const isStairZone = currentZoneType === "stairs" || currentZoneType.includes("stair");
    if (!isStairZone) return false;
    for (const nodeId of result.path.slice(1, 6)) {
      if (graph.nodes[nodeId][2] !== currentFloor) return true;
    }
    return false;
  }, [currentFloor, graph, result]);

  function setExactGraphLocation(nodeId: number, label: string, lockMs = POSITION_LOCK_MS) {
    if (!graph) return;
    const [x, z, floor] = graph.nodes[String(nodeId)];
    positionLockUntilRef.current = Date.now() + lockMs;
    setCurrentNodeId(nodeId);
    setCurrentLabel(label);
    setCurrentFloor(floor);
    setGraphPosition([x, z]);
  }

  function handleStairSegmentConfirmed() {
    if (!graph || !result?.path || result.path.length < 2) return;
    const nextFloorNodeId =
      result.path.find((nodeId, index) => index > 0 && graph.nodes[nodeId][2] !== currentFloor) ??
      result.path[1];
    setExactGraphLocation(
      nextFloorNodeId,
      graph.zones[String(nextFloorNodeId)]?.label ?? "Stairwell",
      STAIR_POSITION_LOCK_MS
    );
  }

  function handleOcrZoneFound(nodeId: number, label: string) {
    setExactGraphLocation(nodeId, label);
    setCongestion(null);
    setLiveMultipliers({});
  }

  function handleQrUpdate(
    nodeId: number,
    label: string,
    penalty: number,
    count: number,
    gpsFix: GpsFix | null
  ) {
    if (!graph) return;
    const displayLabel = graph.zones[String(nodeId)]?.label ?? label;
    setExactGraphLocation(nodeId, displayLabel);
    setCongestion({ penalty, count });
    setLiveMultipliers(penalty > 1 ? buildLiveMultipliers(graph, nodeId, penalty) : {});

    if (!gpsFix) {
      setGpsStatus("QR location corrected, but GPS was unavailable; calibration was not changed.");
      return;
    }
    setGpsAccuracy(gpsFix.accuracy);

    if (calibration) {
      setGpsStatus("QR location correction applied. GPS calibration remains active.");
      return;
    }

    const [x, z, floor] = graph.nodes[String(nodeId)];
    const sample: CalibrationSample = {
      anchorId: label.trim().toLowerCase(),
      nodeId,
      floor,
      graphPosition: [x, z],
      gps: gpsFix,
    };

    if (!firstCalibrationSample) {
      setFirstCalibrationSample(sample);
      setGpsStatus(`First point saved at ${label}. Move to a different QR point on Floor ${floor}.`);
      return;
    }

    try {
      const transform = createCalibrationTransform(firstCalibrationSample, sample);
      setCalibration(transform);
      localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(transform));
      setFirstCalibrationSample(null);
      setExactGraphLocation(nodeId, displayLabel);
      setGpsStatus("GPS calibration complete. Live navigation is ready.");
      setMode("navigate");
    } catch (error) {
      setGpsStatus(error instanceof Error ? error.message : "Calibration failed.");
    }
  }

  function resetCalibration() {
    localStorage.removeItem(CALIBRATION_STORAGE_KEY);
    setCalibration(null);
    setFirstCalibrationSample(null);
    setGpsAccuracy(null);
    setGpsStatus("Calibration reset. Scan the first QR point.");
    setMode("qr");
  }

  const congestionTag =
    congestion === null
      ? null
      : congestion.penalty >= 5
        ? "congested"
        : congestion.penalty >= 2
          ? "busy"
          : "clear";

  if (!graph) {
    return (
      <main>
        <h1>Indoor Wayfinder</h1>
        <p className="subtitle">Loading building map…</p>
        <p className="status-warning">{gpsStatus}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Indoor Wayfinder</h1>
      <p className="subtitle">Calibrate with two QR points, then follow the live camera arrow.</p>

      <div className="mode-toggle">
        <button className={mode === "qr" ? "active" : ""} onClick={() => setMode("qr")}>
          Calibrate / scan QR
        </button>
        <button className={mode === "ocr" ? "active" : ""} onClick={() => setMode("ocr")}>
          Read signage
        </button>
        <button
          className={mode === "navigate" ? "active" : ""}
          onClick={() => setMode("navigate")}
          disabled={!calibration}
        >
          Navigate
        </button>
      </div>

      {mode === "ocr" && <ZoneRecognizer graph={graph} onZoneFound={handleOcrZoneFound} />}
      {mode === "qr" && <QRAndCrowdRecognizer graph={graph} onLocationUpdate={handleQrUpdate} />}
      {mode === "navigate" && calibration && (
        <CameraNavigation
          graph={graph}
          path={result?.path ?? null}
          graphPosition={graphPosition}
          transform={calibration}
          currentFloor={currentFloor}
        />
      )}

      <div className="status-card calibration-card">
        <div className="label">GPS calibration</div>
        <div className="value">{calibration ? "Calibrated" : firstCalibrationSample ? "Point 1 of 2 saved" : "Not calibrated"}</div>
        <p className="status-line">{gpsStatus}</p>
        {gpsAccuracy !== null && <p className="status-line">Last GPS accuracy: ±{Math.round(gpsAccuracy)} m</p>}
        {(calibration || firstCalibrationSample) && (
          <button className="secondary-button" onClick={resetCalibration}>
            Reset calibration
          </button>
        )}
      </div>

      {currentNodeId !== null && (
        <div className="status-card">
          <div className="label">Current location</div>
          <div className="value">
            {currentLabel} · Floor {currentFloor}
            {congestionTag && (
              <span className={`congestion-tag congestion-${congestionTag}`}>
                {congestionTag === "congested"
                  ? `${congestion!.count} people — rerouting`
                  : congestionTag === "busy"
                    ? `${congestion!.count} people`
                    : "clear"}
              </span>
            )}
          </div>
        </div>
      )}

      {currentNodeId !== null && (
        <FloorMap
          graph={graph}
          currentFloor={currentFloor}
          graphPosition={graphPosition}
          path={result?.path ?? null}
        />
      )}

      {currentNodeId !== null && (
        <PassiveStairProgress
          expectingStairSegment={expectingStairSegment}
          onStairSegmentConfirmed={handleStairSegmentConfirmed}
        />
      )}

      {result?.path && (
        <>
          <div className="status-card">
            <div className="label">Route cost</div>
            <div className="value">{result.cost.toFixed(1)}</div>
          </div>
          <ol className="directions-list">
            {directions.map((step, index) => (
              <li key={`${step.nodeId}-${index}`}>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      {currentNodeId !== null && !result?.path && (
        <p className="status-warning">No route found to an exit from the current location.</p>
      )}
    </main>
  );
}
