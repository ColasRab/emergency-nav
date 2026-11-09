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
import RoomStartPicker from "./RoomStartPicker";
import { useBuildingData } from "@/lib/clientData";
import { floorLabel, type BuildingId, type Room } from "@/lib/buildings";
import {
  attachRoomStart,
  isRoomPointWalkable,
} from "@/lib/navigation/roomStart";
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
  applySimilarity,
  invertSimilarity,
  normalizeSignedDegrees,
  type Vec2,
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
  const [modelRoute, setModelRoute] = useState(false),
    [modelRoomId, setModelRoomId] = useState<string | null>(null),
    [modelHeadingOffset, setModelHeadingOffset] = useState<number | null>(null);
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
    setModelRoute(false);
    setModelRoomId(null);
    setModelHeadingOffset(null);
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
  const headingOffset = modelRoute
      ? (modelHeadingOffset ?? 0)
      : (circularMean(headingSamples) ?? 0),
    heading =
      compass.heading === null
        ? null
        : normalizeSignedDegrees(compass.heading + headingOffset),
    currentFloor = estimate?.floor ?? floor;
  const modelRoom = config?.rooms?.find((room) => room.id === modelRoomId),
    selectedRoom = config?.rooms?.find(
      (room) => room.id === selectedRoomId && room.floor === floor,
    );
  const attachment = useMemo(
    () =>
      graph && modelRoute && modelRoom && estimate && config?.graphToModel
        ? attachRoomStart(
            graph,
            modelRoom,
            applySimilarity(estimate.position, config.graphToModel),
            config.graphToModel,
          )
        : null,
    [graph, modelRoute, modelRoom, estimate, config?.graphToModel],
  );
  const routeGraph = attachment?.graph ?? graph;
  const nodeId = useMemo(
    () =>
      attachment
        ? attachment.startId
        : routeGraph && estimate
          ? nearestNodeOnFloor(routeGraph, ...estimate.position, estimate.floor)
          : null,
    [routeGraph, estimate, attachment],
  );
  const result = useMemo(
    () =>
      routeGraph && config && nodeId !== null && nodeId >= 0
        ? routeWithHazards(
            routeGraph,
            nodeId,
            store.hazards,
            config,
            now,
            previousPath.current,
          )
        : null,
    [routeGraph, config, nodeId, store.hazards, now],
  );
  useEffect(() => {
    previousPath.current = result?.path ?? null;
  }, [result]);
  const instruction = useMemo(
    () =>
      routeGraph && config && estimate && result?.path
        ? nextInstruction(
            routeGraph,
            result.path,
            estimate.position,
            estimate.floor,
            config,
            modelRoute && modelHeadingOffset === null ? null : heading,
            modelRoute ? "model" : "world",
          )
        : null,
    [
      routeGraph,
      config,
      estimate,
      result?.path,
      heading,
      modelRoute,
      modelHeadingOffset,
    ],
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
    if (
      modelRoute ||
      !navigating ||
      !routeGraph ||
      !config ||
      !estimate ||
      !announcedPath.current
    )
      return;
    const scale =
        (config.graphToModel?.scale ?? 1) * (config.georef?.scale ?? 1),
      v = config.settings.voice,
      distance = distanceToPath(
        routeGraph,
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
  }, [
    navigating,
    routeGraph,
    config,
    estimate,
    now,
    result?.path,
    emit,
    modelRoute,
  ]);
  const expectingStairs = !!(
    !modelRoute &&
    routeGraph &&
    result?.path &&
    result.path.length > 1 &&
    routeGraph.nodes[result.path[0]][2] !== routeGraph.nodes[result.path[1]][2]
  );
  const handleStairs = useCallback(() => {
    if (
      modelRoute ||
      !graph ||
      !result?.path ||
      !estimate ||
      result.path.length < 2
    )
      return;
    const n = graph.nodes[result.path[1]];
    setEstimate(markStairArrival(estimate, [n[0], n[1]], n[2]));
    setFloor(n[2]);
    setStatus(
      "Planned stair segment detected. Confirm the new floor with a QR scan.",
    );
    emit("floor", "maneuver", n[2]);
  }, [graph, result?.path, estimate, emit, modelRoute]);
  const handleStep = useCallback(() => {
    if (
      !config ||
      modelRoute ||
      heading === null ||
      !config.graphToModel ||
      !config.georef ||
      !navigating
    )
      return;
    setEstimate((previous) =>
      previous ? advanceStep(previous, heading, config) : null,
    );
  }, [config, heading, navigating, modelRoute]);
  function startFromRoom(room: Room, point: Vec2, name: string) {
    if (!graph || !config?.graphToModel || !isRoomPointWalkable(room, point))
      return;
    setModelRoute(true);
    setModelRoomId(room.id);
    setModelHeadingOffset(null);
    setNavigating(false);
    setEstimate({
      position: invertSimilarity(point, config.graphToModel),
      floor: room.floor,
      uncertaintyM: 4,
      timestamp: Date.now(),
      lastScanAt: null,
      requiresFloorScan: true,
      source: "manual",
    });
    setFloor(room.floor);
    setMode("navigate");
    setPendingScan(null);
    setLabel(`${room.label} — ${name.toLowerCase()}`);
    setStatus(
      "Starting point set in the model. Open Camera guide and set your facing direction. Confirm waypoints as you reach them.",
    );
    previousPath.current = null;
    announcedPath.current = null;
  }
  function alignModel(facing: number) {
    const reading = compass.reading.current;
    if (!reading || Date.now() - reading.at > 3000) {
      setStatus(
        "Enable the compass and wait for a fresh reading, then align again.",
      );
      return;
    }
    setModelHeadingOffset(normalizeSignedDegrees(facing - reading.heading));
    setStatus(
      "Facing direction aligned manually to the model. Position changes only when you confirm a waypoint or choose a new starting point.",
    );
  }
  const waypointId =
    modelRoute && result?.path && routeGraph
      ? result.path.slice(1).find((n) => {
          const p = routeGraph.nodes[n];
          return (
            p &&
            estimate &&
            (p[2] !== estimate.floor ||
              Math.hypot(
                p[0] - estimate.position[0],
                p[1] - estimate.position[1],
              ) > 0.03)
          );
        })
      : undefined;
  function confirmWaypoint() {
    if (
      waypointId === undefined ||
      !routeGraph ||
      !config ||
      !estimate ||
      result?.fallback
    )
      return;
    const [x, z, f] = routeGraph.nodes[waypointId],
      point: Vec2 = [x, z],
      room = config.rooms?.find(
        (r) =>
          r.floor === f &&
          isRoomPointWalkable(
            r,
            config.graphToModel
              ? applySimilarity(point, config.graphToModel)
              : point,
          ),
      );
    setModelRoomId(room?.id ?? null);
    setEstimate({
      ...estimate,
      position: point,
      floor: f,
      timestamp: Date.now(),
    });
    setFloor(f);
    setLabel(routeGraph.zones[waypointId]?.label ?? "Confirmed model waypoint");
    setStatus(
      `Position advanced by your confirmation${f !== estimate.floor ? ` to ${floorLabel(config, f)}` : ""}. Confirm the next point only after reaching it.`,
    );
    previousPath.current = null;
    announcedPath.current = null;
  }
  function manualLocation(
    value: number,
    source: "manual" | "sign" = "manual",
    name?: string,
  ) {
    if (!graph?.nodes[value]) return;
    setModelRoute(false);
    setModelRoomId(null);
    setModelHeadingOffset(null);
    previousPath.current = null;
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
      setModelRoute(false);
      setModelRoomId(null);
      setModelHeadingOffset(null);
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
            graph={routeGraph}
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
          {selectedRoom && config.modelKind === "room-layout" && graph && (
            <RoomStartPicker
              key={`${id}:${selectedRoom.id}`}
              room={selectedRoom}
              graph={routeGraph}
              transform={config.graphToModel ?? undefined}
              path={result?.path ?? []}
              onStart={startFromRoom}
            />
          )}
          {config.modelKind === "room-layout" && !selectedRoom && (
            <p className="setup-note">
              Select a room above to choose your starting point inside it, such
              as a back corner.
            </p>
          )}
          {(!modelRoute || config.georef) && (
            <BuildingMap
              configs={configs}
              activeId={id}
              floor={floor}
              graph={routeGraph}
              path={result?.path ?? []}
              user={user}
              points={overlayPoints}
            />
          )}
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
                  value={modelRoute ? "model" : (nodeId ?? "")}
                  onChange={(e) => manualLocation(Number(e.target.value))}
                >
                  <option value="" disabled>
                    Choose a known place
                  </option>
                  {modelRoute && (
                    <option value="model" disabled>
                      Selected point in the model
                    </option>
                  )}
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
                    {modelRoute
                      ? " · Manually placed in the model"
                      : estimate.requiresFloorScan
                        ? " · QR confirmation needed"
                        : ""}
                  </p>
                )}
                {!modelRoute && (
                  <button
                    className="secondary-button"
                    onClick={() => void compass.enable()}
                  >
                    Enable compass for calibration
                  </button>
                )}
                <p className="status-line">
                  {compass.status}{" "}
                  {modelRoute
                    ? modelHeadingOffset === null
                      ? "· model facing direction not set"
                      : "· model facing direction set manually"
                    : headingSamples.length > 0
                      ? `· heading calibrated from ${headingSamples.length} anchor(s)`
                      : ""}
                </p>
                {!modelRoute && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setMode("qr");
                      setPendingScan(null);
                    }}
                  >
                    Recalibrate here
                  </button>
                )}
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
                  key={`qr-${id}`}
                  config={config}
                  graph={graph}
                  currentFloor={floor}
                  onLocationUpdate={qrUpdate}
                />
              )}
              {mode === "ocr" && (
                <ZoneRecognizer
                  key={`sign-${id}`}
                  graph={graph}
                  currentFloor={floor}
                  onZoneFound={(n, l) => manualLocation(n, "sign", l)}
                />
              )}
              {mode === "navigate" && (
                <CameraNavigation
                  key={`camera-${id}`}
                  config={config}
                  graph={routeGraph ?? graph}
                  path={result?.path ?? null}
                  graphPosition={estimate?.position ?? null}
                  currentFloor={currentFloor}
                  instruction={result?.fallback ? null : instruction}
                  headingOffset={headingOffset}
                  compassHeading={
                    compass.reading.current &&
                    now - compass.reading.current.at < 3000
                      ? compass.heading
                      : null
                  }
                  compassStatus={compass.status}
                  onEnableCompass={compass.enable}
                  modelBased={modelRoute}
                  modelAligned={modelHeadingOffset !== null}
                  onAlignModel={alignModel}
                  onVideoReady={setVideo}
                />
              )}
              {modelRoute && result?.path && (
                <section
                  className="status-card"
                  aria-label="Model route progress"
                >
                  <h2>Follow the model route</h2>
                  <p>
                    Destination: main entrance on the 1st floor (modeled
                    assumption). Green line in 3D: your route. Blue dot: your
                    position. Your position advances when you confirm each
                    point.
                  </p>
                  {waypointId !== undefined && routeGraph && (
                    <>
                      <p>
                        Next:{" "}
                        <strong>
                          {routeGraph.zones[waypointId]?.label ??
                            "Clear aisle point"}
                        </strong>{" "}
                        · {floorLabel(config, routeGraph.nodes[waypointId][2])}
                        {estimate &&
                        routeGraph.nodes[waypointId][2] !== estimate.floor
                          ? " · Take the modeled stairs to this floor"
                          : ""}
                      </p>
                      <button
                        onClick={confirmWaypoint}
                        disabled={result.fallback}
                      >
                        I have reached this waypoint
                      </button>
                    </>
                  )}
                  {waypointId === undefined && (
                    <p>You have reached the modeled entrance.</p>
                  )}
                  <p className="status-line">
                    Manual guidance using estimated geometry. The camera does
                    not track your walking position.
                  </p>
                </section>
              )}
              {estimate && (
                <>
                  <PassiveStairProgress
                    key={`stairs-${id}`}
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
                    heading={modelRoute ? null : heading}
                    onCreate={store.create}
                  />
                  <HazardScanner
                    video={video}
                    config={config}
                    graph={graph}
                    position={estimate.position}
                    floor={estimate.floor}
                    heading={modelRoute ? null : heading}
                    enabled={!modelRoute && navigating && mode === "navigate"}
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
                  key={`voice-${id}`}
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
