"use client";

import { useEffect, useMemo, useState } from "react";
import ZoneRecognizer from "@/components/ZoneRecognizer";
import QRAndCrowdRecognizer from "@/components/QRAndCrowdRecognizer";
import PassiveStairProgress from "@/components/PassiveStairProgress";
import { astar, type NavGraph } from "@/lib/astar";

type Mode = "ocr" | "qr";

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

export default function Page() {
  const [graph, setGraph] = useState<NavGraph | null>(null);
  const [mode, setMode] = useState<Mode>("ocr");
  const [currentNodeId, setCurrentNodeId] = useState<number | null>(null);
  const [currentLabel, setCurrentLabel] = useState<string>("Unknown");
  const [congestion, setCongestion] = useState<{ penalty: number; count: number } | null>(null);
  const [liveMultipliers, setLiveMultipliers] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/nav_graph.json")
      .then((r) => r.json())
      .then(setGraph);
  }, []);

  const result = useMemo(() => {
    if (!graph || currentNodeId === null) return null;
    return astar(graph, currentNodeId, graph.exits, liveMultipliers);
  }, [graph, currentNodeId, liveMultipliers]);

  const directions = useMemo(() => {
    if (!graph || !result?.path) return [];
    return directionsFromPath(graph, result.path);
  }, [graph, result]);

  // The next hop in the plan is a stair segment if it moves to a
  // different floor. This is what tells PassiveStairProgress whether to
  // pay attention right now, and lets it advance position WITHOUT
  // needing to independently detect direction -- the plan already knows
  // which way we're going.
  const expectingStairSegment = useMemo(() => {
    if (!graph || !result?.path || result.path.length < 2) return false;
    const [current, next] = result.path;
    return graph.nodes[current][2] !== graph.nodes[next][2];
  }, [graph, result]);

  function handleStairSegmentConfirmed() {
    if (!graph || !result?.path || result.path.length < 2) return;
    const nextNodeId = result.path[1];
    setCurrentNodeId(nextNodeId);
    setCurrentLabel(graph.zones[String(nextNodeId)]?.label ?? "Stairwell");
  }

  function handleOcrZoneFound(nodeId: number, label: string) {
    setCurrentNodeId(nodeId);
    setCurrentLabel(label);
    setCongestion(null);
    setLiveMultipliers({});
  }

  function handleQrUpdate(nodeId: number, label: string, penalty: number, count: number) {
    setCurrentNodeId(nodeId);
    setCurrentLabel(label);
    setCongestion({ penalty, count });
    if (graph) {
      setLiveMultipliers(penalty > 1 ? buildLiveMultipliers(graph, nodeId, penalty) : {});
    }
  }

  const congestionTag =
    congestion === null ? null : congestion.penalty >= 5 ? "congested" : congestion.penalty >= 2 ? "busy" : "clear";

  if (!graph) {
    return (
      <main>
        <h1>Emergency Wayfinder</h1>
        <p className="subtitle">Loading building map…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Emergency Wayfinder</h1>
      <p className="subtitle">Point your camera around to find your location and the nearest exit.</p>

      <div className="mode-toggle">
        <button className={mode === "ocr" ? "active" : ""} onClick={() => setMode("ocr")}>
          Read signage
        </button>
        <button className={mode === "qr" ? "active" : ""} onClick={() => setMode("qr")}>
          Scan QR (stairs/unmarked areas)
        </button>
      </div>

      {mode === "ocr" ? (
        <ZoneRecognizer graph={graph} onZoneFound={handleOcrZoneFound} />
      ) : (
        <QRAndCrowdRecognizer graph={graph} onLocationUpdate={handleQrUpdate} />
      )}

      {currentNodeId !== null && (
        <div className="status-card">
          <div className="label">Current location</div>
          <div className="value">
            {currentLabel}
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
            {directions.map((step, i) => (
              <li key={i}>
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
