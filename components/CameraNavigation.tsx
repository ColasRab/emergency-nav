"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NavGraph } from "@/lib/astar";
import type { CalibrationTransform } from "@/lib/calibration";
import type { BuildingConfig } from "@/lib/buildings";
import {
  deviceHeading,
  normalizeSignedDegrees,
  smoothBearing,
} from "@/lib/geo/transform";
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
  onHeadingUpdate,
  onVideoReady,
}: {
  graph: NavGraph;
  path: number[] | null;
  graphPosition: [number, number] | null;
  currentFloor: number;
  transform?: CalibrationTransform;
  config?: BuildingConfig;
  instruction?: NextInstruction | null;
  headingOffset?: number;
  onHeadingUpdate?: (raw: number) => void;
  onVideoReady?: (video: HTMLVideoElement | null) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    headingRef = useRef<number | null>(null),
    listener = useRef<((e: Event) => void) | null>(null),
    alive = useRef(true),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ onHeadingUpdate, onVideoReady });
  callbacks.current = { onHeadingUpdate, onVideoReady };
  const [heading, setHeading] = useState<number | null>(null),
    [cameraStatus, setCameraStatus] = useState("Camera is off"),
    [compassStatus, setCompassStatus] = useState("Compass is off");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
      callbacks.current.onVideoReady?.(null);
      if (listener.current) {
        window.removeEventListener(
          "deviceorientationabsolute",
          listener.current,
        );
        window.removeEventListener("deviceorientation", listener.current);
      }
      if (timer.current) clearTimeout(timer.current);
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
          : "Camera unavailable. Follow the text directions or choose a location manually.",
      );
    }
  }
  async function enableCompass() {
    try {
      if (typeof DeviceOrientationEvent === "undefined")
        throw new Error("Compass unavailable. Use text directions.");
      const api = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<string>;
      };
      if (
        api.requestPermission &&
        (await api.requestPermission()) !== "granted"
      )
        throw new Error("Compass permission denied. Use text directions.");
      if (listener.current) {
        window.removeEventListener(
          "deviceorientationabsolute",
          listener.current,
        );
        window.removeEventListener("deviceorientation", listener.current);
      }
      const handler = (raw: Event) => {
        const event = raw as DeviceOrientationEvent & {
            webkitCompassHeading?: number;
          },
          next = deviceHeading(event, screen.orientation?.angle ?? 0);
        if (next === null) return;
        const value = smoothBearing(headingRef.current, next);
        headingRef.current = value;
        setHeading(value);
        callbacks.current.onHeadingUpdate?.(value);
        setCompassStatus("Compass ready");
        if (timer.current) clearTimeout(timer.current);
      };
      listener.current = handler;
      window.addEventListener("deviceorientationabsolute", handler);
      window.addEventListener("deviceorientation", handler);
      setCompassStatus("Waiting for absolute compass data…");
      timer.current = setTimeout(
        () =>
          setCompassStatus(
            "No absolute compass data. Use text directions or a manual heading.",
          ),
        5000,
      );
    } catch (e) {
      setCompassStatus(e instanceof Error ? e.message : "Compass unavailable");
    }
  }
  const target = useMemo(
    () =>
      instruction !== undefined
        ? instruction
        : config && path && graphPosition
          ? nextInstruction(
              graph,
              path,
              graphPosition,
              currentFloor,
              config,
              heading === null ? null : heading + headingOffset,
            )
          : null,
    [
      instruction,
      config,
      path,
      graphPosition,
      currentFloor,
      graph,
      heading,
      headingOffset,
    ],
  );
  const angle =
    target?.bearing != null && heading !== null
      ? normalizeSignedDegrees(target.bearing - heading - headingOffset)
      : null;
  return (
    <section className="recognizer-panel">
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
          {target && config
            ? instructionText(target, "en", config)
            : "Scan a surveyed QR or choose your current location."}
        </div>
      </div>
      <div className="button-row">
        <button onClick={startCamera}>Start navigation camera</button>
        <button onClick={enableCompass}>Enable compass</button>
      </div>
      <p role="status" className="status-line">
        {cameraStatus} · {compassStatus}
      </p>
      {!config?.georef && (
        <p className="status-warning">
          Directional arrow needs surveyed map alignment. Text route previews
          remain available.
        </p>
      )}
    </section>
  );
}
