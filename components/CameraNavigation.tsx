"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NavGraph } from "@/lib/astar";
import {
  graphVectorToBearing,
  normalizeSignedDegrees,
  type CalibrationTransform,
} from "@/lib/calibration";

type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

function smoothedHeading(previous: number | null, next: number): number {
  if (previous === null) return next;
  const weight = 0.2;
  const previousRadians = (previous * Math.PI) / 180;
  const nextRadians = (next * Math.PI) / 180;
  const x = (1 - weight) * Math.cos(previousRadians) + weight * Math.cos(nextRadians);
  const y = (1 - weight) * Math.sin(previousRadians) + weight * Math.sin(nextRadians);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function routeTarget(
  graph: NavGraph,
  path: number[],
  graphPosition: [number, number],
  floor: number
): { position: [number, number] | null; instruction: string } {
  if (path.length <= 1) {
    return { position: null, instruction: "You have reached the exit." };
  }

  let previous: [number, number] = graphPosition;
  let distanceAlongRoute = 0;
  let target: [number, number] | null = null;

  for (const nodeId of path.slice(1)) {
    const [x, z, nodeFloor] = graph.nodes[String(nodeId)];
    if (nodeFloor !== floor) {
      return {
        position: target,
        instruction: `Use the stairs to continue to Floor ${nodeFloor}.`,
      };
    }
    distanceAlongRoute += Math.hypot(x - previous[0], z - previous[1]);
    target = [x, z];
    previous = target;
    if (distanceAlongRoute >= 2.5) break;
  }

  if (!target) {
    return { position: null, instruction: "Follow the stair instruction." };
  }
  const directDistance = Math.hypot(target[0] - graphPosition[0], target[1] - graphPosition[1]);
  return {
    position: target,
    instruction: `Continue toward the exit · ${directDistance.toFixed(1)} m ahead`,
  };
}

export default function CameraNavigation({
  graph,
  path,
  graphPosition,
  transform,
  currentFloor,
}: {
  graph: NavGraph;
  path: number[] | null;
  graphPosition: [number, number] | null;
  transform: CalibrationTransform;
  currentFloor: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const headingRef = useRef<number | null>(null);
  const orientationHandlerRef = useRef<((event: Event) => void) | null>(null);
  const [cameraStatus, setCameraStatus] = useState("Camera is off");
  const [heading, setHeading] = useState<number | null>(null);
  const [compassStatus, setCompassStatus] = useState("Compass is off");

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (orientationHandlerRef.current) {
        window.removeEventListener("deviceorientationabsolute", orientationHandlerRef.current);
        window.removeEventListener("deviceorientation", orientationHandlerRef.current);
      }
    };
  }, []);

  async function startCamera() {
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraStatus("Camera ready");
    } catch (error) {
      setCameraStatus(error instanceof Error ? error.message : "Unable to start the camera");
    }
  }

  async function enableCompass() {
    try {
      const orientationApi = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      };
      if (typeof orientationApi.requestPermission === "function") {
        const permission = await orientationApi.requestPermission();
        if (permission !== "granted") throw new Error("Compass permission denied");
      }

      const handleOrientation = (rawEvent: Event) => {
        const event = rawEvent as CompassEvent;
        let nextHeading: number | null = null;
        if (typeof event.webkitCompassHeading === "number") {
          nextHeading = event.webkitCompassHeading;
        } else if (event.absolute && event.alpha !== null) {
          nextHeading = (360 - event.alpha) % 360;
        }
        if (nextHeading === null || !Number.isFinite(nextHeading)) return;
        const smoothed = smoothedHeading(headingRef.current, nextHeading);
        headingRef.current = smoothed;
        setHeading(smoothed);
        setCompassStatus("Compass ready");
      };

      if (orientationHandlerRef.current) {
        window.removeEventListener("deviceorientationabsolute", orientationHandlerRef.current);
        window.removeEventListener("deviceorientation", orientationHandlerRef.current);
      }
      orientationHandlerRef.current = handleOrientation;
      window.addEventListener("deviceorientationabsolute", handleOrientation);
      window.addEventListener("deviceorientation", handleOrientation);
      setCompassStatus("Waiting for compass data…");
    } catch (error) {
      setCompassStatus(error instanceof Error ? error.message : "Unable to start the compass");
    }
  }

  const target = useMemo(() => {
    if (!path || !graphPosition) return null;
    return routeTarget(graph, path, graphPosition, currentFloor);
  }, [currentFloor, graph, graphPosition, path]);

  const relativeAngle = useMemo(() => {
    if (!target?.position || !graphPosition || heading === null) return null;
    const dx = target.position[0] - graphPosition[0];
    const dz = target.position[1] - graphPosition[1];
    if (Math.hypot(dx, dz) < 0.15) return 0;
    const targetBearing = graphVectorToBearing(dx, dz, transform);
    return normalizeSignedDegrees(targetBearing - heading);
  }, [graphPosition, heading, target, transform]);

  return (
    <div className="recognizer-panel">
      <div className="camera-navigation">
        <video ref={videoRef} className="camera-preview navigation-video" muted playsInline />
        {relativeAngle !== null && (
          <div
            className="navigation-arrow"
            style={{ transform: `translate(-50%, -50%) rotate(${relativeAngle}deg)` }}
            aria-label={`Direction ${Math.round(relativeAngle)} degrees`}
          >
            <svg viewBox="0 0 100 140" role="img" aria-hidden="true">
              <path d="M50 2 L96 62 H70 V136 H30 V62 H4 Z" />
            </svg>
          </div>
        )}
        <div className="navigation-instruction">
          {target?.instruction ?? "Waiting for a GPS route…"}
        </div>
      </div>
      <div className="button-row">
        <button onClick={startCamera}>Start navigation camera</button>
        <button onClick={enableCompass}>Enable compass</button>
      </div>
      <p className="status-line">
        {cameraStatus} · {compassStatus}
      </p>
    </div>
  );
}
