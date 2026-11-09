"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { NavGraph } from "@/lib/astar";
import type { BuildingConfig } from "@/lib/buildings";
import { normalizeSignedDegrees } from "@/lib/geo/transform";
import {
  describeModelPlace,
  modelRouteSegments,
  projectModelRoute,
} from "@/lib/navigation/modelView";
import NavigationMiniMap from "./navigation/NavigationMiniMap";
import {
  instructionText,
  nextInstruction,
  type NextInstruction,
} from "@/lib/voice/instructionBuilder";
const ModelPosePreview = dynamic(
  () => import("./navigation/ModelPosePreview"),
  { ssr: false },
);

export default function CameraNavigation({
  graph,
  path,
  graphPosition,
  currentFloor,
  config,
  instruction,
  headingOffset = 0,
  compassHeading,
  compassStatus,
  onEnableCompass,
  modelBased = false,
  modelAligned = false,
  onAlignModel,
  onVideoReady,
  onConfirmWaypoint,
  nextWaypointLabel,
  compact = false,
  locationBasis,
  fallbackHeading = 180,
  modelPerMeter = 1,
}: {
  graph: NavGraph;
  path: number[] | null;
  graphPosition: [number, number] | null;
  currentFloor: number;
  config: BuildingConfig;
  instruction?: NextInstruction | null;
  headingOffset?: number;
  compassHeading: number | null;
  compassStatus: string;
  onEnableCompass: () => Promise<void>;
  modelBased?: boolean;
  modelAligned?: boolean;
  onAlignModel?: (facing: number) => void;
  onVideoReady?: (video: HTMLVideoElement | null) => void;
  onConfirmWaypoint?: () => void;
  nextWaypointLabel?: string;
  compact?: boolean;
  locationBasis?: string;
  fallbackHeading?: number;
  modelPerMeter?: number;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    alive = useRef(true),
    viewport = useRef<HTMLDivElement>(null),
    cameraRequest = useRef(0),
    callbacks = useRef({ onVideoReady });
  callbacks.current = { onVideoReady };
  const [cameraStatus, setCameraStatus] = useState("Camera is off"),
    [facing, setFacing] = useState(180),
    [live, setLive] = useState(false),
    [cameraError, setCameraError] = useState(false),
    [pendingCamera, setPendingCamera] = useState(false),
    [expanded, setExpanded] = useState(false),
    [viewportSize, setViewportSize] = useState({ width: 1000, height: 600 });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cameraRequest.current++;
      stream.current?.getTracks().forEach((t) => t.stop());
      callbacks.current.onVideoReady?.(null);
    };
  }, []);
  useEffect(() => {
    if (!viewport.current) return;
    const resize = new ResizeObserver(([entry]) =>
      setViewportSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    resize.observe(viewport.current);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [expanded]);
  async function startCamera() {
    if (compact) void onEnableCompass();
    const request = ++cameraRequest.current;
    setPendingCamera(true);
    setCameraError(false);
    try {
      stream.current?.getTracks().forEach((t) => t.stop());
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!alive.current || cameraRequest.current !== request) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = next;
      for (const track of next.getVideoTracks())
        track.addEventListener(
          "ended",
          () => {
            if (alive.current && stream.current === next) {
              setLive(false);
              setCameraError(true);
              setCameraStatus("Camera stopped. Model preview active.");
              callbacks.current.onVideoReady?.(null);
            }
          },
          { once: true },
        );
      if (video.current) {
        video.current.srcObject = next;
        await video.current.play();
        callbacks.current.onVideoReady?.(video.current);
      }
      setCameraStatus("Camera ready");
      setLive(true);
    } catch (e) {
      if (!alive.current || cameraRequest.current !== request) return;
      setLive(false);
      setCameraError(true);
      stream.current?.getTracks().forEach((track) => track.stop());
      callbacks.current.onVideoReady?.(null);
      setCameraStatus(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Camera permission denied. The model preview remains available."
          : "Camera unavailable. The model preview remains available.",
      );
    } finally {
      if (alive.current && cameraRequest.current === request)
        setPendingCamera(false);
    }
  }
  function stopCamera() {
    cameraRequest.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    if (video.current) video.current.srcObject = null;
    callbacks.current.onVideoReady?.(null);
    setPendingCamera(false);
    setCameraError(false);
    setLive(false);
    setCameraStatus("Model preview active");
  }
  const target = useMemo(
    () =>
      instruction !== undefined
        ? instruction
        : path && graphPosition
          ? nextInstruction(
              graph,
              path,
              graphPosition,
              currentFloor,
              config,
              compassHeading === null ? null : compassHeading + headingOffset,
              modelBased ? "model" : "world",
            )
          : null,
    [
      instruction,
      path,
      graphPosition,
      currentFloor,
      config,
      compassHeading,
      headingOffset,
      graph,
      modelBased,
    ],
  );
  const angle =
    target?.bearing != null &&
    compassHeading !== null &&
    (!modelBased || modelAligned)
      ? normalizeSignedDegrees(target.bearing - compassHeading - headingOffset)
      : null;
  const place = useMemo(
    () =>
      describeModelPlace(
        config,
        graphPosition,
        currentFloor,
        graph,
        1 / modelPerMeter,
      ),
    [config, graphPosition, currentFloor, graph, modelPerMeter],
  );
  const modelHeading =
    compassHeading !== null && (!modelBased || modelAligned)
      ? modelBased
        ? compassHeading + headingOffset
        : config.georef
          ? compassHeading + headingOffset - config.georef.rotationDeg + 180
          : compact
            ? fallbackHeading
            : facing
      : compact
        ? fallbackHeading
        : facing;
  const projectedRoute = useMemo(
    () =>
      live && angle !== null && place.position
        ? projectModelRoute(
            modelRouteSegments(
              config,
              graph,
              path?.slice(0, Math.max(2, (target?.pathIndex ?? 1) + 1)) ?? null,
              currentFloor,
            ),
            place.position,
            modelHeading,
            viewportSize.width / viewportSize.height,
            1.6 * modelPerMeter,
          )
        : [],
    [
      live,
      angle,
      place.position,
      config,
      graph,
      path,
      currentFloor,
      modelHeading,
      target?.pathIndex,
      viewportSize,
      modelPerMeter,
    ],
  );
  return (
    <section
      className={`recognizer-panel camera-guide-panel ${compact ? "compact-camera-guide" : ""}`}
    >
      {!compact && (
        <div className="camera-guide-heading">
          <div>
            <p className="eyebrow">Navigate from the model</p>
            <h2>Camera navigation</h2>
          </div>
          <span className="estimate-badge">Estimated position</span>
        </div>
      )}
      {!compact && modelBased && (
        <div className="model-camera-setup">
          <h2>Face a direction in the model</h2>
          <p>
            Hold the phone pointing toward the wall you choose below, then set
            this facing direction. Keep using the same plan orientation as the
            room picker.
          </p>
          <label>
            Phone is pointing toward
            <select
              value={facing}
              onChange={(e) => setFacing(Number(e.target.value))}
            >
              <option value={180}>Front — corridor / room doors</option>
              <option value={0}>Back — window wall</option>
              <option value={90}>Right side of the room plan</option>
              <option value={270}>Left side of the room plan</option>
            </select>
          </label>
          <div className="button-row">
            <button
              className="secondary-button"
              onClick={() => void onEnableCompass()}
            >
              Enable compass
            </button>
            <button
              disabled={compassHeading === null}
              onClick={() => onAlignModel?.(facing)}
            >
              Set this facing direction
            </button>
          </div>
          <p role="status" className="status-line">
            {modelAligned
              ? "Facing direction set manually."
              : "Enable the compass, then set your facing direction."}
          </p>
          <p className="status-line">
            The arrow turns with the phone. Confirm each waypoint to update your
            position. This camera view does not track your movement or anchor
            arrows to the floor.
          </p>
        </div>
      )}
      <div
        ref={viewport}
        id="navigation-camera-view"
        className={`camera-navigation game-navigation-view ${expanded ? "is-expanded" : ""}`}
        role="region"
        aria-label="Camera navigation view"
      >
        {!live && (
          <ModelPosePreview
            config={config}
            graph={graph}
            path={path}
            floor={currentFloor}
            position={place.position}
            heading={modelHeading}
          />
        )}
        <video
          ref={video}
          className={`camera-preview navigation-video ${live ? "is-live" : ""}`}
          muted
          playsInline
        />
        <div className="camera-hud-vignette" aria-hidden="true" />
        {projectedRoute.length > 0 && (
          <svg
            className="estimated-route-overlay"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            role="img"
            aria-label="Estimated route over camera"
          >
            {projectedRoute.map(([a, b], i) => (
              <g key={i}>
                <line
                  x1={a[0]}
                  y1={a[1]}
                  x2={b[0]}
                  y2={b[1]}
                  stroke="#092c20"
                  strokeWidth="18"
                  strokeLinecap="round"
                />
                <line
                  x1={a[0]}
                  y1={a[1]}
                  x2={b[0]}
                  y2={b[1]}
                  stroke="#7dffc1"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray="18 10"
                />
              </g>
            ))}
          </svg>
        )}
        <NavigationMiniMap
          config={config}
          graph={graph}
          path={path}
          floor={currentFloor}
          place={place}
          heading={modelHeading}
        />
        <div className="camera-hud-actions">
          <span className={`camera-mode-badge ${live ? "live" : ""}`}>
            <i />
            {live ? "Live camera" : "Model preview"}
          </span>
          {!compact && (
            <button
              className="hud-action"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Close expanded camera" : "Expand camera view"}
            </button>
          )}
          <button
            className="hud-action"
            disabled={pendingCamera}
            onClick={live ? stopCamera : startCamera}
          >
            {pendingCamera
              ? "Opening camera…"
              : live
                ? "Use model preview"
                : "Use camera"}
          </button>
        </div>
        {compact && cameraError && (
          <p className="compact-camera-error" role="alert">
            {cameraStatus}
          </p>
        )}
        <div className="camera-crosshair" aria-hidden="true">
          <i />
        </div>
        {angle !== null && (
          <div
            className="navigation-arrow"
            style={{ transform: `translate(-50%, -50%) rotate(${angle}deg)` }}
            aria-label={`Direction ${Math.round(angle)} degrees`}
          >
            <svg viewBox="0 0 100 140" aria-hidden="true">
              <path d="M50 2 L96 62 H70 V136 H30 V62 H4 Z" />
            </svg>
          </div>
        )}
        <div className="navigation-instruction hud-maneuver">
          <span className="hud-eyebrow">
            {live ? "Estimated route overlay" : "Model route preview"}
          </span>
          <strong>
            {target
              ? instructionText(target, "en", config)
              : "Set your location to start directions."}
          </strong>
          <small>
            {angle === null
              ? compact
                ? !graphPosition
                  ? "Choose where you are standing"
                  : !modelAligned
                    ? "Allow compass access or calibrate GPS"
                    : "Waiting for compass direction"
                : "Set facing direction for the camera arrow"
              : "Follow the next modeled waypoint"}
          </small>
        </div>
        <section
          className="estimated-place-card"
          aria-label="Estimated location"
        >
          <span className="hud-eyebrow">
            <i /> Estimated location
          </span>
          <strong data-testid="estimated-place-name">{place.title}</strong>
          <span
            className="estimated-place-region"
            data-testid="estimated-place-region"
          >
            {place.region}
          </span>
          <span className="estimated-place-floor">
            {place.floor} · {config.name}
          </span>
          {place.distances && <small>{place.distances}</small>}
          <div className="estimated-place-basis">
            {locationBasis ??
              (modelBased
                ? "From selected model point"
                : "From last location update")}
          </div>
          {onConfirmWaypoint && (
            <button
              className="hud-confirm"
              onClick={onConfirmWaypoint}
              title={nextWaypointLabel}
            >
              Reached next point <span aria-hidden="true">→</span>
            </button>
          )}
        </section>
      </div>
      {!compact && (
        <>
          <div className="button-row">
            <button onClick={startCamera} disabled={pendingCamera}>
              Start navigation camera
            </button>
            {!modelBased && (
              <button onClick={() => void onEnableCompass()}>
                Enable compass
              </button>
            )}
          </div>
          <p role="status" className="status-line">
            {cameraStatus} · {compassStatus}
            {compassHeading === null
              ? " · Direction arrow waiting for a fresh compass reading"
              : ""}
          </p>
          <p className="status-line">
            The location label is calculated from your point in the model. The
            camera does not recognize your room or track your walking position.
            Confirm waypoints to move the estimate.
          </p>
          {!config.georef && !modelBased && (
            <p className="status-warning">
              Choose a starting point inside a room to use manual model
              alignment for the camera guide.
            </p>
          )}
        </>
      )}
    </section>
  );
}
