"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NavGraph } from "@/lib/astar";
import type { BuildingConfig } from "@/lib/buildings";
import { normalizeSignedDegrees } from "@/lib/geo/transform";
import {
  instructionText,
  nextInstruction,
  type NextInstruction,
} from "@/lib/voice/instructionBuilder";

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
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    alive = useRef(true),
    callbacks = useRef({ onVideoReady });
  callbacks.current = { onVideoReady };
  const [cameraStatus, setCameraStatus] = useState("Camera is off"),
    [facing, setFacing] = useState(180);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
      callbacks.current.onVideoReady?.(null);
    };
  }, []);
  async function startCamera() {
    try {
      stream.current?.getTracks().forEach((t) => t.stop());
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!alive.current) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = next;
      if (video.current) {
        video.current.srcObject = next;
        await video.current.play();
        callbacks.current.onVideoReady?.(video.current);
      }
      setCameraStatus("Camera ready");
    } catch (e) {
      setCameraStatus(
        e instanceof Error
          ? e.message
          : "Camera unavailable. Follow the text route.",
      );
    }
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
  return (
    <section className="recognizer-panel">
      {modelBased && (
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
      <div className="camera-navigation">
        <video
          ref={video}
          className="camera-preview navigation-video"
          muted
          playsInline
        />
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
        <div className="navigation-instruction">
          {target
            ? instructionText(target, "en", config)
            : "Choose your current location to preview a route."}
        </div>
      </div>
      <div className="button-row">
        <button onClick={startCamera}>Start navigation camera</button>
        {!modelBased && (
          <button onClick={() => void onEnableCompass()}>Enable compass</button>
        )}
      </div>
      <p role="status" className="status-line">
        {cameraStatus} · {compassStatus}
        {compassHeading === null
          ? " · Direction arrow waiting for a fresh compass reading"
          : ""}
      </p>
      {!config.georef && !modelBased && (
        <p className="status-warning">
          Choose a starting point inside a room to use manual model alignment
          for the camera guide.
        </p>
      )}
    </section>
  );
}
