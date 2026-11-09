"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ZoneRecognizer from "./ZoneRecognizer";
import QRAndCrowdRecognizer, {
  type QRScanUpdate,
} from "./QRAndCrowdRecognizer";
import CameraNavigation from "./CameraNavigation";
import PassiveStairProgress from "./PassiveStairProgress";
import VoiceGuide, { type VoiceEvent } from "./VoiceGuide";
import HazardScanner from "./HazardScanner";
import HazardReport from "./HazardReport";
import HazardList from "./HazardList";
import RoomDirectory from "./RoomDirectory";
import { useBuildingData } from "@/lib/clientData";
import { floorLabel, type BuildingId } from "@/lib/buildings";
import { nearestNodeOnFloor } from "@/lib/astar";
import type { GpsFix } from "@/lib/calibration";
import {
  acceptQr,
  advanceStep,
  addHeadingSample,
  circularMean,
  markStairArrival,
  type HeadingSample,
  type PositionEstimate,
} from "@/lib/position/fusion";
import { useCompass } from "@/lib/position/compass";
import { distanceToPath } from "@/lib/position/progress";
import {
  graphToModel,
  normalizeSignedDegrees,
  type Vec3,
} from "@/lib/geo/transform";
import {
  nextInstruction,
  type PhraseKey,
} from "@/lib/voice/instructionBuilder";
import { InstructionScheduler, type Priority } from "@/lib/voice/scheduler";
import { routeWithHazards } from "@/lib/hazards/routing";
import { useHazards } from "@/lib/hazards/client";
import { loadAnchors, type QRAnchor } from "@/lib/qr/anchors";
import { logEvent } from "@/lib/events";
const ScanViewer = dynamic(() => import("./map/ScanViewer"), { ssr: false });
const BuildingMap = dynamic(() => import("./map/BuildingMap"), { ssr: false });
export default function NavigationApp() {
  const [selectedRoomId, setSelectedRoomId] = useState<string | undefined>();
  const admin = useBuildingData("admin"),
    ynares = useBuildingData("ynares"),
    [id, setId] = useState<BuildingId>("admin");
  const { config, graph, error } = id === "admin" ? admin : ynares,
    store = useHazards(id),
    compass = useCompass();
  const [mode, setMode] = useState<"qr" | "ocr" | "navigate">("qr"),
    [floor, setFloor] = useState(0),
    [estimate, setEstimate] = useState<PositionEstimate | null>(null),
    [label, setLabel] = useState("Choose your location"),
    [status, setStatus] = useState(
      "Scan a surveyed QR sticker, or choose a location manually.",
    ),
    [navigating, setNavigating] = useState(false),
    [video, setVideo] = useState<HTMLVideoElement | null>(null),
    [now, setNow] = useState(Date.now()),
    [voiceEvent, setVoiceEvent] = useState<VoiceEvent | null>(null),
    [anchors, setAnchors] = useState<QRAnchor[]>([]),
    [pendingScan, setPendingScan] = useState<{
      nodeId: number;
      label: string;
      details: QRScanUpdate;
    } | null>(null),
    [headingSamples, setHeadingSamples] = useState<HeadingSample[]>([]);
  const previousPath = useRef<number[] | null>(null),
    announcedPath = useRef<number[] | null>(null),
    offRoute = useRef(new InstructionScheduler()),
    lastHazardRevision = useRef(""),
    lastOffRoute = useRef(0),
    eventId = useRef(0),
    lastRoute = useRef<string>("");
  const emit = useCallback(
    (key: PhraseKey, priority: Priority = "info", targetFloor?: number) =>
      setVoiceEvent({
        id: ++eventId.current,
        key,
        priority,
        floor: targetFloor,
      }),
    [],
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setEstimate(null);
    setLabel("Choose your location");
    setFloor(0);
    setNavigating(false);
    setVideo(null);
    setHeadingSamples([]);
    setPendingScan(null);
    setStatus("Scan a surveyed QR sticker, or choose a location manually.");
    previousPath.current = null;
    announcedPath.current = null;
    lastRoute.current = "";
    lastHazardRevision.current = "";
    setAnchors([]);
    let cancelled = false;
    loadAnchors(id)
      .then((a) => {
        if (!cancelled) setAnchors(a);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);
  const headingOffset = circularMean(headingSamples) ?? 0,
    heading =
      compass.heading === null
        ? null
        : normalizeSignedDegrees(compass.heading + headingOffset),
    currentFloor = estimate?.floor ?? floor;
  const nodeId = useMemo(
    () =>
      graph && estimate
        ? nearestNodeOnFloor(graph, ...estimate.position, estimate.floor)
        : null,
    [graph, estimate],
  );
  const result = useMemo(
    () =>
      graph && config && nodeId !== null && nodeId >= 0
        ? routeWithHazards(
            graph,
            nodeId,
            store.hazards,
            config,
            now,
            previousPath.current,
          )
        : null,
    [graph, config, nodeId, store.hazards, now],
  );
  useEffect(() => {
    previousPath.current = result?.path ?? null;
  }, [result]);
  const instruction = useMemo(
    () =>
      graph && config && estimate && result?.path
        ? nextInstruction(
            graph,
            result.path,
            estimate.position,
            estimate.floor,
            config,
            heading,
          )
        : null,
    [graph, config, estimate, result?.path, heading],
  );
  const hazardRevision = store.hazards
    .map((h) => `${h.id}:${h.severity}:${h.confirmations}:${h.expiresAt}`)
    .sort()
    .join("|");
  useEffect(() => {
    if (!navigating || !result?.path) return;
    const route = result.path.join(",");
    if (result.fallback && lastRoute.current !== `blocked:${route}`) {
      emit("blocked", "emergency");
      lastRoute.current = `blocked:${route}`;
    } else if (
      !result.fallback &&
      lastHazardRevision.current !== hazardRevision &&
      lastRoute.current &&
      lastRoute.current !== route
    ) {
      emit("reroute", "emergency");
      announcedPath.current = result.path;
      lastRoute.current = route;
      logEvent({ event: "reroute", buildingId: id, floor: currentFloor });
    } else if (!lastRoute.current) lastRoute.current = route;
    lastHazardRevision.current = hazardRevision;
  }, [result, hazardRevision, navigating, emit, id, currentFloor]);
  useEffect(() => {
    if (!navigating || !graph || !config || !estimate || !announcedPath.current)
      return;
    const scale =
        (config.graphToModel?.scale ?? 1) * (config.georef?.scale ?? 1),
      v = config.settings.voice,
      distance = distanceToPath(
        graph,
        announcedPath.current,
        estimate.position,
        estimate.floor,
        scale,
      );
    if (
      offRoute.current.offRoute(distance, now, v.offRouteM, v.offRouteMs) &&
      now - lastOffRoute.current > 8000
    ) {
      lastOffRoute.current = now;
      emit("offroute", "maneuver");
      previousPath.current = null;
      announcedPath.current = result?.path ?? null;
      setStatus("Route recalculated. Check your position or scan a nearby QR.");
    }
  }, [navigating, graph, config, estimate, now, result?.path, emit]);
  const expectingStairs = !!(
    graph &&
    result?.path &&
    result.path.length > 1 &&
    graph.nodes[result.path[0]][2] !== graph.nodes[result.path[1]][2]
  );
  const handleStairs = useCallback(() => {
    if (!graph || !result?.path || !estimate || result.path.length < 2) return;
    const n = graph.nodes[result.path[1]];
    setEstimate(markStairArrival(estimate, [n[0], n[1]], n[2]));
    setFloor(n[2]);
    setStatus(
      "Planned stair segment detected. Confirm the new floor with a QR scan.",
    );
    emit("floor", "maneuver", n[2]);
  }, [graph, result?.path, estimate, emit]);
  const handleStep = useCallback(() => {
    if (
      !config ||
      heading === null ||
      !config.graphToModel ||
      !config.georef ||
      !navigating
    )
      return;
    setEstimate((previous) =>
      previous ? advanceStep(previous, heading, config) : null,
    );
  }, [config, heading, navigating]);
  function manualLocation(
    value: number,
    source: "manual" | "sign" = "manual",
    name?: string,
  ) {
    if (!graph?.nodes[value]) return;
    const [x, z, f] = graph.nodes[value];
    setEstimate({
      position: [x, z],
      floor: f,
      uncertaintyM: 4,
      timestamp: Date.now(),
      lastScanAt: null,
      requiresFloorScan: true,
      source,
    });
    setFloor(f);
    setLabel(name ?? graph.zones[value]?.label ?? `Mapped point ${value}`);
    setStatus(
      "Approximate location selected. Scan a surveyed QR to calibrate position and heading.",
    );
    emit("uncertain");
  }
  function qrUpdate(
    value: number,
    name: string,
    _penalty: number,
    _count: number,
    _gps: GpsFix | null,
    details?: QRScanUpdate,
    relocated = false,
  ) {
    if (!graph || !config) return;
    const f = graph.nodes[value]?.[2];
    if (f === undefined) return;
    if (!details?.pose) {
      manualLocation(value, "manual", name);
      setStatus(
        "Legacy sticker found. Location accuracy is low; it does not calibrate heading.",
      );
      return;
    }
    try {
      const next = acceptQr(estimate, details.pose, f, config, relocated);
      if (estimate?.source === "steps" && !estimate.requiresFloorScan) {
        const distance =
          Math.hypot(
            estimate.position[0] - next.position[0],
            estimate.position[1] - next.position[1],
          ) *
          (config.graphToModel?.scale ?? 1) *
          (config.georef?.scale ?? 1);
        logEvent({
          event: "anchor_disagreement",
          buildingId: id,
          anchorId: details.anchorId,
          errorM: distance,
          floor: f,
        });
      }
      setEstimate(next);
      setFloor(f);
      setLabel(name);
      setPendingScan(null);
      setStatus(
        "Surveyed QR position accepted. Rescan whenever uncertainty grows.",
      );
      const reading = compass.reading.current;
      if (reading && Date.now() - reading.at < 3000)
        setHeadingSamples((samples) =>
          addHeadingSample(samples, {
            anchorId: details.anchorId ?? name,
            offset: normalizeSignedDegrees(details.pose!.yaw - reading.heading),
            weight: 1 / Math.max(0.1, details.pose!.uncertaintyM) ** 2,
          }),
        );
      else
        setStatus(
          "Position updated. Enable the compass before scanning to calibrate heading too.",
        );
      logEvent({
        event: "qr_accepted",
        buildingId: id,
        anchorId: details.anchorId,
        floor: f,
      });
      emit("updated");
    } catch (e) {
      setPendingScan({ nodeId: value, label: name, details });
      setStatus(e instanceof Error ? e.message : "Scan rejected");
      logEvent({
        event: "qr_rejected",
        buildingId: id,
        anchorId: details.anchorId,
        floor: f,
      });
    }
  }
  const configs = [admin.config, ynares.config].filter(
    (c): c is NonNullable<typeof c> => c !== null,
  );
  const overlayPoints = useMemo(() => {
    if (!config) return [];
    const points = anchors
      .filter((a) => a.floor === floor)
      .map((a) => ({ position: a.position, color: "#ffc75e" }));
    if (graph && config.graphToModel)
      for (const h of store.hazards.filter((h) => h.floor === floor)) {
        const n = graph.nodes[h.nodeIds[0]];
        if (n)
          points.push({
            position: graphToModel(n, config, 0.5),
            color: "#ff645f",
          });
      }
    return points;
  }, [anchors, floor, config, graph, store.hazards]);
  const user: Vec3 | undefined = estimate
    ? [...estimate.position, estimate.floor]
    : undefined;
  useEffect(() => setSelectedRoomId(undefined), [id, floor]);
  return (
    <main className="wide-main">
      <h1>Emergency Wayfinder</h1>
      <p className="subtitle">Admin & Ynares · Indoor wayfinding</p>
      <p className="safety-note">
        Follow official evacuation signs and staff instructions. This app
        supports wayfinding and never replaces official evacuation procedures.
      </p>
      <nav className="admin-nav" aria-label="Setup">
        <a href="/admin/alignment">Building setup</a>
        <a href="/admin/anchors">QR survey</a>
        <a href="/admin/hazards">Manage hazards</a>
      </nav>
      <div className="two-columns">
        <label>
          Building
          <select
            value={id}
            onChange={(e) => setId(e.target.value as BuildingId)}
          >
            <option value="admin">Admin Building</option>
            <option value="ynares">Ynares Building</option>
          </select>
        </label>
        {config && (
          <label>
            Displayed floor
            <select
              value={floor}
              onChange={(e) => setFloor(Number(e.target.value))}
            >
              {config.floors.map((f) => (
                <option key={f.index} value={f.index}>
                  {floorLabel(config, f.index)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {!config && <p>Loading building…</p>}
      {config && (
        <>
          {(!config.modelVerified ||
            !config.graphVerified ||
            !config.floorsVerified) && (
            <p className="setup-note">
              <strong>
                {config.modelKind === "room-layout"
                  ? "Estimated reconstruction."
                  : "Survey setup required."}
              </strong>{" "}
              {config.modelKind === "room-layout"
                ? "Rooms follow your floor plan. Horizontal dimensions, doorways, furniture and the entrance route are assumptions; verify them on site."
                : "Scan scale, floor heights, paths and real exits need physical verification. Routes shown here are previews."}
            </p>
          )}
          <ScanViewer
            config={config}
            graph={graph}
            path={result?.path ?? []}
            floor={floor}
            user={user}
            points={overlayPoints}
            selectedRoomId={selectedRoomId}
            onRoomSelect={setSelectedRoomId}
          />
          <RoomDirectory
            config={config}
            floor={floor}
            selected={selectedRoomId}
            onSelect={setSelectedRoomId}
          />
          <BuildingMap
            configs={configs}
            activeId={id}
            floor={floor}
            graph={graph}
            path={result?.path ?? []}
            user={user}
            points={overlayPoints}
          />
          {!graph && (
            <p className="empty-state">
              This building needs a surveyed navigation graph. Add measured
              floors, exits and stair connections using the supplied graph
              maker, then set the graph path in Building setup.
            </p>
          )}
          {graph && (
            <>
              <label>
                Choose your approximate location
                <select
                  value={nodeId ?? ""}
                  onChange={(e) => manualLocation(Number(e.target.value))}
                >
                  <option value="" disabled>
                    Choose a known place
                  </option>
                  {Object.entries(graph.zones)
                    .filter(([key]) => graph.nodes[key][2] === floor)
                    .map(([key, tag]) => (
                      <option key={key} value={key}>
                        {tag.label}
                      </option>
                    ))}
                </select>
              </label>
              <div className="status-card">
                <h2>{label}</h2>
                <p role="status">{status}</p>
                {estimate && (
                  <p className="status-line">
                    {floorLabel(config, currentFloor)} · Estimated uncertainty ±
                    {(
                      estimate.uncertaintyM +
                      Math.max(0, now - estimate.timestamp) / 50000
                    ).toFixed(1)}{" "}
                    m
                    {estimate.requiresFloorScan
                      ? " · QR confirmation needed"
                      : ""}
                  </p>
                )}
                <button
                  className="secondary-button"
                  onClick={() => void compass.enable()}
                >
                  Enable compass for calibration
                </button>
                <p className="status-line">
                  {compass.status}{" "}
                  {headingSamples.length > 0
                    ? `· heading calibrated from ${headingSamples.length} anchor(s)`
                    : ""}
                </p>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setMode("qr");
                    setPendingScan(null);
                  }}
                >
                  Recalibrate here
                </button>
                {pendingScan && (
                  <button
                    onClick={() =>
                      qrUpdate(
                        pendingScan.nodeId,
                        pendingScan.label,
                        1,
                        0,
                        null,
                        pendingScan.details,
                        true,
                      )
                    }
                  >
                    I moved to this location — accept scan
                  </button>
                )}
              </div>
              <div className="mode-toggle">
                <button
                  className={mode === "qr" ? "active" : ""}
                  onClick={() => setMode("qr")}
                >
                  Scan QR
                </button>
                <button
                  className={mode === "ocr" ? "active" : ""}
                  onClick={() => setMode("ocr")}
                >
                  Read signage
                </button>
                <button
                  className={mode === "navigate" ? "active" : ""}
                  onClick={() => setMode("navigate")}
                  disabled={!estimate}
                >
                  Camera guide
                </button>
              </div>
              {mode === "qr" && (
                <QRAndCrowdRecognizer
                  key={id}
                  config={config}
                  graph={graph}
                  currentFloor={floor}
                  onLocationUpdate={qrUpdate}
                />
              )}
              {mode === "ocr" && (
                <ZoneRecognizer
                  key={id}
                  graph={graph}
                  currentFloor={floor}
                  onZoneFound={(n, l) => manualLocation(n, "sign", l)}
                />
              )}
              {mode === "navigate" && (
                <CameraNavigation
                  key={id}
                  config={config}
                  graph={graph}
                  path={result?.path ?? null}
                  graphPosition={estimate?.position ?? null}
                  currentFloor={currentFloor}
                  instruction={result?.fallback ? null : instruction}
                  headingOffset={headingOffset}
                  onHeadingUpdate={compass.update}
                  onVideoReady={setVideo}
                />
              )}
              {estimate && (
                <>
                  <PassiveStairProgress
                    key={id}
                    expectingStairSegment={expectingStairs}
                    onStairSegmentConfirmed={handleStairs}
                    onStep={handleStep}
                    stepThreshold={config.settings.qr.stepThreshold}
                  />
                  <HazardReport
                    graph={graph}
                    config={config}
                    position={estimate.position}
                    floor={estimate.floor}
                    heading={heading}
                    onCreate={store.create}
                  />
                  <HazardScanner
                    video={video}
                    config={config}
                    graph={graph}
                    position={estimate.position}
                    floor={estimate.floor}
                    heading={heading}
                    enabled={navigating && mode === "navigate"}
                    onCreate={store.create}
                  />
                </>
              )}
              {result?.fallback && (
                <p role="alert" className="safety-note">
                  <strong>All mapped routes are blocked.</strong> This fallback
                  crosses reported hazards (
                  {result.hazardIds
                    .map(
                      (hid) =>
                        store.hazards.find((h) => h.id === hid)?.type ??
                        "unknown",
                    )
                    .join(", ")}
                  ). Follow official procedures and staff instructions.
                </p>
              )}
              {estimate && !result?.path && (
                <p role="alert" className="status-warning">
                  No connected route to a mapped exit. Follow official signs and
                  staff instructions.
                </p>
              )}
              {estimate && result?.path && (
                <VoiceGuide
                  key={id}
                  instruction={result.fallback ? null : instruction}
                  config={config}
                  event={voiceEvent}
                  enabled={navigating}
                  onStart={() => {
                    setNavigating(true);
                    setMode("navigate");
                    announcedPath.current = result.path;
                    lastRoute.current = "";
                  }}
                />
              )}
              {navigating && (
                <button
                  className="secondary-button"
                  onClick={() => setNavigating(false)}
                >
                  Stop navigation
                </button>
              )}
            </>
          )}
          <p className="status-line" role="status">
            {store.status}
          </p>
          <HazardList
            hazards={store.hazards}
            onAction={store.act}
            floorNames={Object.fromEntries(
              config.floors.map((f) => [f.index, floorLabel(config, f.index)]),
            )}
          />
        </>
      )}
    </main>
  );
}
