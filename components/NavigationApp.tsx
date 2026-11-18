"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CameraNavigation from "./CameraNavigation";
import VoiceGuide, { type VoiceEvent } from "./VoiceGuide";
import HazardReport from "./HazardReport";
import HazardList from "./HazardList";
import AppSheet from "./navigation/AppSheet";
import LocationChooser from "./navigation/LocationChooser";
import DestinationChooser from "./navigation/DestinationChooser";
import GpsLocationSetup from "./navigation/GpsLocationSetup";
import { useBuildingData } from "@/lib/clientData";
import { floorLabel, type BuildingId } from "@/lib/buildings";
import { pointRouteGraph } from "@/lib/navigation/pointRoute";
import {
  applySimilarity,
  normalizeSignedDegrees,
  type Vec2,
} from "@/lib/geo/transform";
import { useCompass } from "@/lib/position/compass";
import type { PositionEstimate } from "@/lib/position/fusion";
import {
  assessGpsPosition,
  MAX_GPS_GUIDANCE_UNCERTAINTY_M,
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
      "location" | "destination" | "gps" | "reports" | "more" | null
    >(null),
    [estimate, setEstimate] = useState<PositionEstimate | null>(null),
    [calibration, setCalibration] = useState<LocationCalibration | null>(null),
    [gpsRunning, setGpsRunning] = useState(false),
    [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null),
    [lastGpsAt, setLastGpsAt] = useState<number | null>(null),
    [message, setMessage] = useState(
      "Set your location and choose a destination to plan a route.",
    ),
    [manualOffset, setManualOffset] = useState<number | null>(null),
    [pendingFacing, setPendingFacing] = useState<number | null>(null),
    [fallbackFacing, setFallbackFacing] = useState(180),
    [lastPointId, setLastPointId] = useState<string | undefined>(),
    [destination, setDestination] = useState<LocationPoint | null>(null),
    [navigating, setNavigating] = useState(false),
    [voiceEvent, setVoiceEvent] = useState<VoiceEvent | null>(null),
    [now, setNow] = useState(Date.now());
  const watch = useRef<number | null>(null),
    alignmentRequestedAt = useRef(0),
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
      compass.reading.current.at >= alignmentRequestedAt.current &&
      Date.now() - compass.reading.current.at < 3000
    ) {
      setManualOffset(
        normalizeSignedDegrees(pendingFacing - compass.reading.current.heading),
      );
      setPendingFacing(null);
    }
  }, [compass.heading, pendingFacing, now]);
  const usableCalibration =
    calibration && !calibration.lowConfidence ? calibration : null;
  const headingOffset =
      manualOffset ??
      (usableCalibration ? gpsModelHeadingOffset(usableCalibration) : 0),
    rawHeading =
      compass.reading.current && now - compass.reading.current.at < 3000
        ? compass.heading
        : null,
    aligned =
      pendingFacing === null &&
      (usableCalibration !== null || manualOffset !== null),
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
  const endpoints = useMemo(
    () =>
      graph && config
        ? pointRouteGraph(graph, config, modelPoint, floor, destination)
        : null,
    [graph, config, modelPoint, floor, destination],
  );
  const routeGraph = endpoints?.graph ?? graph,
    nodeId = endpoints?.startId ?? null,
    destinationId = endpoints?.goalId ?? null;
  const result = useMemo(
    () =>
      routeGraph &&
      config &&
      nodeId !== null &&
      destinationId !== null &&
      routeGraph.nodes[destinationId]
        ? routeWithHazards(
            routeGraph,
            nodeId,
            [destinationId],
            store.hazards,
            config,
            now,
            previousPath.current,
          )
        : null,
    [routeGraph, config, nodeId, destinationId, store.hazards, now],
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
            1,
            estimate.source === "gps" ? 0 : 0.05,
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
    uncertainty = 0,
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
    alignmentRequestedAt.current = Date.now();
    setPendingFacing(facing);
    setGpsAccuracy(null);
    setLastGpsAt(null);
    setNavigating(false);
    setSheet(null);
    setMessage(
      `${point.label} confirmed on the model. Update your point as you walk.`,
    );
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
    if (chosen.lowConfidence) {
      setMessage(
        "GPS calibration is too uncertain. Confirm your location or record points farther apart.",
      );
      return;
    }
    stopGps();
    const epoch = ++watchEpoch.current;
    setGpsRunning(true);
    setLastGpsAt(null);
    setMessage("Waiting for GPS location…");
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
          const quality = assessGpsPosition(fix, chosen);
          if (!quality.usable) {
            setMessage(quality.reason);
            return;
          }
          const matched = matchGpsToModel(
            config,
            graph,
            gpsToModelPosition(fix, chosen),
            targetFloor,
          );
          if (
            !matched ||
            matched.correctionM > 0.35 ||
            quality.uncertaintyM +
              matched.correctionM / chosen.modelPerGpsMeter >
              MAX_GPS_GUIDANCE_UNCERTAINTY_M
          ) {
            setMessage(
              "GPS is outside the modeled walkways. Last location kept; check the two calibration points.",
            );
            return;
          }
          putAt(
            matched.model,
            targetFloor,
            "gps",
            quality.uncertaintyM +
              matched.correctionM / chosen.modelPerGpsMeter,
          );
          setLastGpsAt(Date.now());
          setMessage(
            "Approximate GPS area · confirm named points using Set location. Floor is selected manually.",
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
  function applyCalibration(next: LocationCalibration, facing: number) {
    if (
      !config ||
      next.lowConfidence ||
      Date.now() - next.second.gps.timestamp > 60_000
    )
      return;
    stopGps();
    try {
      localStorage.setItem(calibrationKey(config), JSON.stringify(next));
    } catch {
      setMessage(
        "Calibration is active for this session; device storage is unavailable.",
      );
    }
    setCalibration(next);
    setManualOffset(null);
    alignmentRequestedAt.current = Date.now();
    setPendingFacing(facing);
    setFallbackFacing(facing);
    putAt(next.second.point.model, next.second.point.floor);
    setLastPointId(next.second.point.id);
    setSheet(null);
    setGpsAccuracy(null);
    setLastGpsAt(null);
    void compass.enable();
    setMessage(
      assessGpsPosition(next.second.gps, next).usable
        ? `${next.second.point.label} confirmed. Calibration saved; GPS stays off until you choose Use GPS.`
        : `${next.second.point.label} and facing confirmed. GPS alignment saved, but its readings are too coarse for room guidance. Confirm your points as you walk.`,
    );
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
    setDestination(null);
    setNavigating(false);
    setSheet(null);
    setGpsAccuracy(null);
    setLastGpsAt(null);
    setMessage("Set your location and choose a destination for this building.");
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
    basis = !estimate
      ? "Choose a starting point"
      : estimate.source === "gps"
        ? `${gpsFresh ? "GPS estimate" : "Last GPS estimate"} · allowance ${estimate.uncertaintyM.toFixed(1)} m · confirm at a named point`
        : "Confirmed on model · update at each point";
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
            setNavigating(false);
            setSheet("destination");
          }}
        >
          {destination === null ? "Set destination" : "Change destination"}
        </button>
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
        {error ||
          (destination
            ? `To ${destination.label}${config ? ` (${floorLabel(config, destination.floor)})` : ""} · ${message}`
            : message)}
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
            locationConfirmed={estimate?.source === "manual"}
            positionUncertaintyModelUnits={
              estimate?.source === "gps"
                ? estimate.uncertaintyM * (calibration?.modelPerGpsMeter ?? 1)
                : undefined
            }
            destination={destination}
            modelPerMeter={1}
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
        {estimate && destination && !result?.path && (
          <p className="navigation-route-alert" role="alert">
            No connected route to this destination from your selected location.
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
              : sheet === "destination"
                ? "Choose destination"
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
              hasGpsAlignment={false}
              onChoose={chooseLocation}
            />
          )}
          {sheet === "destination" && (
            <DestinationChooser
              config={config}
              graph={graph}
              selectedId={destination?.id ?? null}
              onChoose={(point) => {
                setDestination(point);
                setNavigating(false);
                previousPath.current = null;
                setSheet(null);
                setMessage("Point-to-point destination selected.");
              }}
            />
          )}
          {sheet === "gps" && (
            <GpsLocationSetup
              config={config}
              graph={graph}
              floor={floor}
              saved={calibration}
              onApply={applyCalibration}
              onUsePoint={chooseLocation}
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
