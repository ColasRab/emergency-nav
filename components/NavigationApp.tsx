"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CameraNavigation from "./CameraNavigation";
import VoiceGuide, { type VoiceEvent } from "./VoiceGuide";
import HazardReport from "./HazardReport";
import HazardList from "./HazardList";
import AppSheet from "./navigation/AppSheet";
import LocationChooser from "./navigation/LocationChooser";
import GpsLocationSetup from "./navigation/GpsLocationSetup";
import { useBuildingData } from "@/lib/clientData";
import { floorLabel, type BuildingId } from "@/lib/buildings";
import { nearestNodeOnFloor } from "@/lib/astar";
import {
  attachRoomStart,
  isRoomPointWalkable,
} from "@/lib/navigation/roomStart";
import {
  applySimilarity,
  normalizeSignedDegrees,
  type Vec2,
} from "@/lib/geo/transform";
import { useCompass } from "@/lib/position/compass";
import type { PositionEstimate } from "@/lib/position/fusion";
import {
  buildingLocationPoints,
  calibrationKey,
  gpsFixSchema,
  gpsModelHeadingOffset,
  gpsToModelPosition,
  matchGpsToModel,
  modelPointToGraph,
  readLocationCalibration,
  type LocationCalibration,
  type LocationPoint,
} from "@/lib/position/gpsCalibration";
import { useHazards } from "@/lib/hazards/client";
import { routeWithHazards } from "@/lib/hazards/routing";
import { nextInstruction } from "@/lib/voice/instructionBuilder";

export default function NavigationApp() {
  const admin = useBuildingData("admin"),
    ynares = useBuildingData("ynares"),
    [id, setId] = useState<BuildingId>("ynares"),
    [floor, setFloor] = useState(1),
    { config, graph, error } = id === "admin" ? admin : ynares,
    store = useHazards(id),
    compass = useCompass();
  const [sheet, setSheet] = useState<
      "location" | "gps" | "reports" | "more" | null
    >(null),
    [estimate, setEstimate] = useState<PositionEstimate | null>(null),
    [calibration, setCalibration] = useState<LocationCalibration | null>(null),
    [gpsRunning, setGpsRunning] = useState(false),
    [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null),
    [lastGpsAt, setLastGpsAt] = useState<number | null>(null),
    [message, setMessage] = useState(
      "Set where you are standing, or calibrate two GPS locations.",
    ),
    [manualOffset, setManualOffset] = useState<number | null>(null),
    [pendingFacing, setPendingFacing] = useState<number | null>(null),
    [fallbackFacing, setFallbackFacing] = useState(180),
    [lastPointId, setLastPointId] = useState<string | undefined>(),
    [navigating, setNavigating] = useState(false),
    [voiceEvent, setVoiceEvent] = useState<VoiceEvent | null>(null),
    [now, setNow] = useState(Date.now());
  const watch = useRef<number | null>(null),
    watchEpoch = useRef(0),
    previousPath = useRef<number[] | null>(null),
    eventId = useRef(0),
    lastRoute = useRef(""),
    lastHazards = useRef("");
  const stopGps = useCallback(() => {
    watchEpoch.current++;
    if (watch.current !== null)
      navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
    setGpsRunning(false);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      watchEpoch.current++;
      if (watch.current !== null)
        navigator.geolocation?.clearWatch(watch.current);
    };
  }, []);
  useEffect(() => {
    if (!config) return;
    setCalibration(readLocationCalibration(config));
    if (new URLSearchParams(location.search).get("setup") === "gps")
      setSheet("gps");
  }, [config?.id, config?.modelRevision]);
  useEffect(() => {
    if (
      pendingFacing !== null &&
      compass.reading.current &&
      Date.now() - compass.reading.current.at < 3000
    ) {
      setManualOffset(
        normalizeSignedDegrees(pendingFacing - compass.reading.current.heading),
      );
      setPendingFacing(null);
    }
  }, [compass.heading, pendingFacing]);
  const headingOffset = calibration
      ? gpsModelHeadingOffset(calibration)
      : (manualOffset ?? 0),
    rawHeading =
      compass.reading.current && now - compass.reading.current.at < 3000
        ? compass.heading
        : null,
    aligned = calibration !== null || manualOffset !== null,
    heading =
      rawHeading !== null && aligned
        ? normalizeSignedDegrees(rawHeading + headingOffset)
        : null;
  const modelPoint = useMemo(
    () =>
      estimate && config
        ? config.graphToModel
          ? applySimilarity(estimate.position, config.graphToModel)
          : estimate.position
        : null,
    [estimate, config],
  );
  const room = useMemo(
    () =>
      modelPoint && config
        ? config.rooms?.find(
            (r) => r.floor === floor && isRoomPointWalkable(r, modelPoint),
          )
        : undefined,
    [modelPoint, config, floor],
  );
  const attachment = useMemo(
    () =>
      graph && room && modelPoint && config?.graphToModel
        ? attachRoomStart(graph, room, modelPoint, config.graphToModel)
        : null,
    [graph, room, modelPoint, config?.graphToModel],
  );
  const routeGraph = attachment?.graph ?? graph,
    nodeId = useMemo(
      () =>
        attachment?.startId ??
        (routeGraph && estimate
          ? nearestNodeOnFloor(routeGraph, ...estimate.position, floor)
          : null),
      [attachment, routeGraph, estimate, floor],
    );
  const result = useMemo(
    () =>
      routeGraph && config && nodeId !== null
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
      routeGraph && config && estimate && result?.path && !result.fallback
        ? nextInstruction(
            routeGraph,
            result.path,
            estimate.position,
            floor,
            config,
            heading,
            "model",
            1 / (calibration?.modelPerGpsMeter ?? 1),
          )
        : null,
    [
      routeGraph,
      config,
      estimate,
      result?.path,
      result?.fallback,
      floor,
      heading,
      calibration?.modelPerGpsMeter,
    ],
  );
  const hazardRevision = store.hazards
    .map((h) => `${h.id}:${h.severity}:${h.confirmations}:${h.expiresAt}`)
    .sort()
    .join("|");
  useEffect(() => {
    if (!navigating || !result?.path) return;
    const route = result.path.join(","),
      blocked = result.fallback;
    if (
      (blocked && lastRoute.current !== `blocked:${route}`) ||
      (!blocked &&
        lastRoute.current &&
        lastRoute.current !== route &&
        lastHazards.current !== hazardRevision)
    ) {
      setVoiceEvent({
        id: ++eventId.current,
        key: blocked ? "blocked" : "reroute",
        priority: "emergency",
      });
    }
    lastRoute.current = blocked ? `blocked:${route}` : route;
    lastHazards.current = hazardRevision;
  }, [result, navigating, hazardRevision]);

  function putAt(
    point: Vec2,
    targetFloor: number,
    source: "manual" | "gps" = "manual",
    uncertainty = 4,
  ) {
    if (!config) return;
    setEstimate({
      position: modelPointToGraph(config, point),
      floor: targetFloor,
      uncertaintyM: uncertainty,
      timestamp: Date.now(),
      lastScanAt: null,
      requiresFloorScan: false,
      source,
    });
    previousPath.current = null;
  }
  function chooseLocation(point: LocationPoint, facing: number) {
    stopGps();
    putAt(point.model, point.floor);
    setFloor(point.floor);
    setLastPointId(point.id);
    setFallbackFacing(facing);
    setManualOffset(null);
    setPendingFacing(calibration ? null : facing);
    setGpsAccuracy(null);
    setLastGpsAt(null);
    setNavigating(false);
    setSheet(null);
    setMessage(`${point.label} selected. GPS tracking is off.`);
    void compass.enable();
  }
  function startGps(chosen = calibration, targetFloor = floor) {
    if (!config || !graph || !chosen) {
      setNavigating(false);
      setSheet("gps");
      return;
    }
    if (!("geolocation" in navigator)) {
      setMessage("Location access is unavailable. Use Set location.");
      return;
    }
    stopGps();
    const epoch = ++watchEpoch.current;
    setGpsRunning(true);
    setLastGpsAt(null);
    setMessage("Waiting for GPS location…");
    setPendingFacing(null);
    void compass.enable();
    watch.current = navigator.geolocation.watchPosition(
      (position) => {
        if (watchEpoch.current !== epoch) return;
        try {
          const fix = gpsFixSchema.parse({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          });
          if (
            Date.now() - fix.timestamp > 30000 ||
            fix.timestamp > Date.now() + 5000
          ) {
            setMessage("Waiting for a fresh GPS reading. Last location kept.");
            return;
          }
          setGpsAccuracy(fix.accuracy);
          if (fix.accuracy > 50) {
            setMessage(
              "GPS is too imprecise to place you. Use Set location or try again.",
            );
            return;
          }
          const matched = matchGpsToModel(
            config,
            graph,
            gpsToModelPosition(fix, chosen),
            targetFloor,
          );
          if (!matched) {
            setMessage(
              "GPS is outside the modeled walkways. Last location kept; check the two calibration points.",
            );
            return;
          }
          putAt(
            matched.model,
            targetFloor,
            "gps",
            fix.accuracy + matched.correctionM / chosen.modelPerGpsMeter,
          );
          setLastGpsAt(Date.now());
          setMessage(
            chosen.lowConfidence
              ? "Live GPS estimate · calibration has low confidence"
              : "Live GPS estimate · floor selected manually",
          );
        } catch {
          setMessage("This GPS reading could not be used. Last location kept.");
        }
      },
      (error) => {
        if (watchEpoch.current !== epoch) return;
        if (error.code === 1) stopGps();
        setMessage(
          error.code === 1
            ? "Location permission denied. Use Set location or allow location access."
            : "GPS is unavailable right now. Last location kept.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }
  function applyCalibration(next: LocationCalibration) {
    if (!config) return;
    try {
      localStorage.setItem(calibrationKey(config), JSON.stringify(next));
    } catch {
      setMessage(
        "Calibration is active for this session; device storage is unavailable.",
      );
    }
    setCalibration(next);
    putAt(next.second.point.model, floor);
    setLastPointId(next.second.point.id);
    setSheet(null);
    setManualOffset(null);
    setPendingFacing(null);
    startGps(next, floor);
  }
  function changeBuilding(next: BuildingId) {
    stopGps();
    setId(next);
    setFloor(next === "ynares" ? 1 : 0);
    setEstimate(null);
    setCalibration(null);
    setManualOffset(null);
    setPendingFacing(null);
    setLastPointId(undefined);
    setNavigating(false);
    setSheet(null);
    setGpsAccuracy(null);
    setLastGpsAt(null);
    setMessage("Set your location or calibrate GPS for this building.");
    previousPath.current = null;
  }
  function changeFloor(next: number) {
    stopGps();
    setFloor(next);
    setEstimate(null);
    setNavigating(false);
    setLastGpsAt(null);
    setGpsAccuracy(null);
    setLastPointId(undefined);
    setMessage("Floor selected. Use GPS or set where you are standing.");
    previousPath.current = null;
  }
  const waypointId =
    routeGraph && result?.path && estimate
      ? result.path.slice(1).find((id) => {
          const n = routeGraph.nodes[id];
          return (
            n &&
            (n[2] !== floor ||
              Math.hypot(
                n[0] - estimate.position[0],
                n[1] - estimate.position[1],
              ) > 0.03)
          );
        })
      : undefined;
  function confirmWaypoint() {
    if (
      !routeGraph ||
      waypointId === undefined ||
      !config ||
      result?.fallback ||
      gpsRunning
    )
      return;
    const n = routeGraph.nodes[waypointId],
      point = config.graphToModel
        ? applySimilarity([n[0], n[1]], config.graphToModel)
        : ([n[0], n[1]] as Vec2);
    putAt(point, n[2]);
    setFloor(n[2]);
    setMessage("Location advanced to the confirmed waypoint.");
  }
  const gpsFresh = gpsRunning && lastGpsAt !== null && now - lastGpsAt < 20000,
    basis = gpsRunning
      ? gpsFresh
        ? `GPS estimate · reported ±${gpsAccuracy?.toFixed(1) ?? "?"} m`
        : "Waiting for fresh GPS · last location kept"
      : estimate?.source === "gps"
        ? "Last GPS estimate · tracking off"
        : "Selected location · GPS off";
  const floorNames = config
    ? Object.fromEntries(
        config.floors.map((f) => [f.index, floorLabel(config, f.index)]),
      )
    : {};
  return (
    <main className="navigation-shell">
      <header className="navigation-app-header">
        <div>
          <h1>Wayfinder</h1>
          <span>Admin & Ynares</span>
        </div>
        <span
          className={`connection-pill ${store.shared ? "connected" : ""}`}
          title={store.status}
        >
          {store.shared ? "Connected" : "Local mode"}
        </span>
        <button
          className="minimal-button"
          onClick={() => setSheet("more")}
          aria-label="More options"
        >
          •••
        </button>
      </header>
      <div className="navigation-toolbar">
        <label>
          Building
          <select
            value={id}
            disabled={!config || !graph}
            onChange={(e) => changeBuilding(e.target.value as BuildingId)}
          >
            <option value="ynares">Ynares Building</option>
            <option value="admin">Admin Building</option>
          </select>
        </label>
        <label>
          Floor
          <select
            value={floor}
            disabled={!config || !graph}
            onChange={(e) => changeFloor(Number(e.target.value))}
          >
            {config?.floors.map((f) => (
              <option key={f.index} value={f.index}>
                {floorLabel(config, f.index)}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!graph}
          onClick={() => {
            stopGps();
            setNavigating(false);
            setSheet("location");
          }}
        >
          Set location
        </button>
        <button
          disabled={!graph}
          onClick={() => {
            stopGps();
            setNavigating(false);
            setSheet("gps");
          }}
        >
          Calibrate GPS
        </button>
        <button
          disabled={!graph}
          className={gpsRunning ? "tracking-active" : ""}
          onClick={() =>
            gpsRunning
              ? (stopGps(),
                setMessage("GPS tracking stopped. Last location kept."))
              : startGps()
          }
        >
          {gpsRunning ? "Stop GPS" : "Use GPS"}
        </button>
      </div>
      <p className="navigation-live-status" role="status">
        {error || message}
        {gpsRunning && gpsAccuracy !== null
          ? ` · GPS ±${gpsAccuracy.toFixed(1)} m`
          : ""}
      </p>
      <div className="navigation-stage">
        {config && routeGraph ? (
          <CameraNavigation
            key={id}
            compact
            config={config}
            graph={routeGraph}
            path={result?.path ?? null}
            graphPosition={estimate?.position ?? null}
            currentFloor={floor}
            instruction={instruction}
            headingOffset={headingOffset}
            compassHeading={rawHeading}
            compassStatus={compass.status}
            onEnableCompass={compass.enable}
            modelBased
            modelAligned={aligned}
            fallbackHeading={estimate ? fallbackFacing : 0}
            locationBasis={basis}
            modelPerMeter={calibration?.modelPerGpsMeter ?? 1}
            onConfirmWaypoint={
              !gpsRunning &&
              estimate &&
              waypointId !== undefined &&
              !result?.fallback
                ? confirmWaypoint
                : undefined
            }
            nextWaypointLabel={
              waypointId !== undefined
                ? routeGraph.zones[waypointId]?.label
                : undefined
            }
          />
        ) : (
          <div className="navigation-loading">
            {error || "Loading building model…"}
          </div>
        )}
        {result?.fallback && (
          <p className="navigation-route-alert" role="alert">
            Mapped routes are blocked. Follow official signs and staff
            instructions.
          </p>
        )}
        {estimate && !result?.path && (
          <p className="navigation-route-alert" role="alert">
            No connected entrance route from this estimate. Set your location
            again.
          </p>
        )}
      </div>
      <footer className="navigation-controls">
        {config && estimate ? (
          <VoiceGuide
            key={`voice-${id}`}
            compact
            instruction={instruction}
            config={config}
            event={voiceEvent}
            enabled={navigating}
            startDisabled={!result?.path || result.fallback}
            onStart={() => {
              if (result?.path && !result.fallback) {
                setNavigating(true);
                lastRoute.current = "";
              }
            }}
          />
        ) : (
          <span className="navigation-hint">
            Set your location to start directions.
          </span>
        )}
        {navigating && (
          <button onClick={() => setNavigating(false)}>Stop</button>
        )}
        <button
          onClick={() => setSheet("reports")}
          disabled={!config || !graph}
        >
          Reports{store.hazards.length ? ` (${store.hazards.length})` : ""}
        </button>
      </footer>
      {sheet && config && graph && (
        <AppSheet
          title={
            sheet === "location"
              ? "Set your location"
              : sheet === "gps"
                ? "Calibrate by location"
                : sheet === "reports"
                  ? "Hazard reports"
                  : "More options"
          }
          onClose={() => setSheet(null)}
        >
          {sheet === "location" && (
            <LocationChooser
              config={config}
              graph={graph}
              floor={floor}
              initialId={lastPointId}
              hasGpsAlignment={!!calibration}
              onChoose={chooseLocation}
            />
          )}
          {sheet === "gps" && (
            <GpsLocationSetup
              config={config}
              graph={graph}
              floor={floor}
              saved={calibration}
              onApply={applyCalibration}
              onClear={() => {
                stopGps();
                try {
                  localStorage.removeItem(calibrationKey(config));
                } catch {
                  /* Session state is still cleared. */
                }
                setCalibration(null);
                setMessage("Saved GPS calibration cleared.");
              }}
            />
          )}
          {sheet === "reports" && (
            <>
              {estimate ? (
                <HazardReport
                  config={config}
                  graph={graph}
                  position={estimate.position}
                  floor={floor}
                  heading={null}
                  onCreate={store.create}
                />
              ) : (
                <p>Set your location before reporting a hazard.</p>
              )}
              <p role="status" className="status-line">
                {store.status}
              </p>
              <HazardList
                hazards={store.hazards}
                onAction={store.act}
                floorNames={floorNames}
              />
            </>
          )}
          {sheet === "more" && (
            <div className="navigation-more">
              <p>
                Model and GPS positions are estimates. Follow official
                evacuation signs and staff instructions.
              </p>
              <p>
                GPS uses two named locations to fit position, scale and
                direction. It does not determine your floor.
              </p>
              <a href="/admin/alignment">Building model tools</a>
              <a href="/admin/hazards">Hazard administration</a>
              <a href={config.glb ?? undefined} download>
                Download current model
              </a>
              <a href={`/models/${config.id}-rooms-bundle.zip`} download>
                Download model bundle
              </a>
            </div>
          )}
        </AppSheet>
      )}
    </main>
  );
}
