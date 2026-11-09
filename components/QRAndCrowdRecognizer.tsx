"use client";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import type { NavGraph } from "@/lib/astar";
import type { GpsFix } from "@/lib/calibration";
import type { BuildingConfig } from "@/lib/buildings";
import { matchZone } from "@/lib/zones";
import {
  modelToGraph,
  modelVectorToBearing,
  type Vec2,
} from "@/lib/geo/transform";
import { loadAnchors, type QRAnchor } from "@/lib/qr/anchors";
import {
  blurVariance,
  calibrateFocalFraction,
  estimateMarkerPose,
  intrinsicsFromFov,
  markerToModel,
  shortestSide,
} from "@/lib/qr/pose";
import { stablePose, type PoseSample } from "@/lib/qr/quality";
export type QRScanUpdate = {
  accuracy: "surveyed" | "legacy";
  pose?: PoseSample;
  anchorId?: string;
  cameraCalibrated?: boolean;
};
const focalKey = "wayfinder:rear-camera-focal:v1";
export default function QRAndCrowdRecognizer({
  graph,
  onLocationUpdate,
  config,
  currentFloor = 0,
}: {
  graph: NavGraph;
  config?: BuildingConfig;
  currentFloor?: number;
  onLocationUpdate: (
    nodeId: number,
    label: string,
    crowdPenalty: number,
    personCount: number,
    gpsFix: GpsFix | null,
    details?: QRScanUpdate,
  ) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    alive = useRef(true),
    gyro = useRef(0),
    crowd = useRef<
      import("@tensorflow-models/coco-ssd").ObjectDetection | null
    >(null);
  const [anchors, setAnchors] = useState<QRAnchor[]>([]),
    [status, setStatus] = useState("Start the camera, then face a QR sticker."),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    alive.current = true;
    if (config)
      loadAnchors(config.id)
        .then((a) => {
          if (alive.current) setAnchors(a);
        })
        .catch(() => setStatus("Unable to load anchor survey."));
    const motion = (e: DeviceMotionEvent) => {
      const r = e.rotationRate;
      gyro.current = r
        ? Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0)
        : 0;
    };
    window.addEventListener("devicemotion", motion);
    return () => {
      alive.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
      crowd.current?.dispose();
      window.removeEventListener("devicemotion", motion);
    };
  }, [config?.id]);
  async function start() {
    try {
      stream.current?.getTracks().forEach((t) => t.stop());
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
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
      }
      setStatus("Camera ready. GPS is not used for indoor scans.");
    } catch (e) {
      setStatus(
        e instanceof Error
          ? e.message
          : "Camera unavailable. Choose your location manually.",
      );
    }
  }
  function read() {
    const v = video.current;
    if (!v || v.readyState < 2 || !v.videoWidth)
      throw new Error("Start the camera before scanning.");
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Camera frame unavailable");
    ctx.drawImage(v, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const qr = jsQR(data.data, canvas.width, canvas.height);
    return { qr, data, width: canvas.width, height: canvas.height };
  }
  async function countPeople() {
    try {
      if (!crowd.current) {
        const coco = await import("@tensorflow-models/coco-ssd");
        await import("@tensorflow/tfjs");
        const m = await coco.load({ base: "lite_mobilenet_v2" });
        if (!alive.current) {
          m.dispose();
          return 0;
        }
        crowd.current = m;
      }
      return (await crowd.current.detect(video.current!)).filter(
        (d) => d.class === "person" && d.score >= 0.6,
      ).length;
    } catch {
      return 0;
    }
  }
  async function accept(nodeId: number, label: string, details: QRScanUpdate) {
    const count = await countPeople();
    if (!alive.current) return;
    const thresholds = config?.settings.crowd;
    const penalty =
      count >= (thresholds?.congested ?? 7)
        ? 6
        : count >= (thresholds?.busy ?? 3)
          ? 2
          : 1;
    onLocationUpdate(nodeId, label, penalty, count, null, details);
    setStatus(
      details.accuracy === "legacy"
        ? "Legacy zone found. Location accuracy is low; use a surveyed NAV1 anchor for calibration."
        : `Position updated from ${label}. ${details.cameraCalibrated ? "Camera calibrated" : "Estimated camera lens; uncertainty is higher"}.`,
    );
  }
  async function scan() {
    setBusy(true);
    try {
      const samples: PoseSample[] = [];
      let accepted = false;
      for (let attempt = 0; attempt < 12 && alive.current; attempt++) {
        const frame = read();
        if (!frame.qr) {
          samples.length = 0;
          setStatus("Center the sticker and move closer.");
          await new Promise((r) => setTimeout(r, 160));
          continue;
        }
        const payload = frame.qr.data.trim();
        if (!payload.startsWith("NAV1|")) {
          const match = matchZone(graph, payload, currentFloor, true);
          if (!match)
            throw new Error(
              "This code does not match a unique zone on the selected floor.",
            );
          await accept(match.nodeId, match.label, { accuracy: "legacy" });
          accepted = true;
          break;
        }
        const anchor = anchors.find(
          (a) => a.id === payload.slice(5) && a.floor === currentFloor,
        );
        if (!anchor)
          throw new Error(
            "Anchor not surveyed for this building and floor. Check your floor selection.",
          );
        if (
          !config?.modelVerified ||
          !config.floorsVerified ||
          !config.graphToModel ||
          !config.georef
        )
          throw new Error(
            "Complete the building scale, floors and alignment survey before using pose calibration.",
          );
        const l = frame.qr.location,
          corners: Vec2[] = [
            [l.topLeftCorner.x, l.topLeftCorner.y],
            [l.topRightCorner.x, l.topRightCorner.y],
            [l.bottomRightCorner.x, l.bottomRightCorner.y],
            [l.bottomLeftCorner.x, l.bottomLeftCorner.y],
          ],
          q = config.settings.qr;
        if (shortestSide(corners) < q.minSidePx) {
          samples.length = 0;
          setStatus("Move closer; the code is too small in the image.");
          continue;
        }
        const focalRaw = Number(localStorage.getItem(focalKey)),
          focal =
            focalRaw > 0 && Number.isFinite(focalRaw) ? focalRaw : undefined;
        const pose = estimateMarkerPose(
          corners,
          anchor.sizeMm,
          intrinsicsFromFov(frame.width, frame.height, q.fovDeg, focal),
        );
        if (pose.viewAngleDeg > q.maxAngleDeg || pose.reprojectionRmsPx > 3) {
          samples.length = 0;
          setStatus("Face the code directly and keep it flat in view.");
          continue;
        }
        const bounds = {
          left: Math.min(...corners.map((p) => p[0])),
          right: Math.max(...corners.map((p) => p[0])),
          top: Math.min(...corners.map((p) => p[1])),
          bottom: Math.max(...corners.map((p) => p[1])),
        };
        if (
          blurVariance(frame.data.data, frame.width, frame.height, bounds) <
            q.minBlurVariance ||
          gyro.current > q.maxGyroDegS
        ) {
          samples.length = 0;
          setStatus("Hold the phone steady and let the camera focus.");
          continue;
        }
        const model = markerToModel(pose, anchor, config.georef.scale),
          g = modelToGraph(model.position, anchor.floor, config),
          yaw = modelVectorToBearing(...model.forward, config);
        samples.push({
          anchorId: anchor.id,
          position: [g[0], g[1]],
          yaw,
          timestamp: Date.now(),
          uncertaintyM: focal ? 0.5 : 1,
        });
        const stable = stablePose(
          samples,
          q.agreeM /
            ((config.graphToModel?.scale ?? 1) * (config.georef?.scale ?? 1)),
          q.agreeDeg,
        );
        if (stable) {
          if (
            !graph.nodes[anchor.nearestNodeId] ||
            graph.nodes[anchor.nearestNodeId][2] !== anchor.floor
          )
            throw new Error(
              "Anchor routing node is invalid. Recheck its survey.",
            );
          await accept(anchor.nearestNodeId, anchor.id, {
            accuracy: "surveyed",
            pose: stable,
            anchorId: anchor.id,
            cameraCalibrated: !!focal,
          });
          accepted = true;
          break;
        }
        setStatus("Hold still — checking three consistent frames…");
        await new Promise((r) => setTimeout(r, 160));
      }
      if (!accepted && alive.current)
        setStatus(
          "Scan quality was insufficient. Move closer, face the code and hold still.",
        );
    } catch (e) {
      if (alive.current)
        setStatus(e instanceof Error ? e.message : "Unable to scan QR");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function calibrate() {
    try {
      const f = read(),
        qr = f.qr;
      if (!qr)
        throw new Error(
          "Center a surveyed QR code at a measured 1.0 m from the camera lens.",
        );
      const a = anchors.find((a) => `NAV1|${a.id}` === qr.data.trim());
      if (!a)
        throw new Error(
          "Use a surveyed NAV1 sticker with a known printed width.",
        );
      const l = qr.location,
        side =
          (Math.hypot(
            l.topRightCorner.x - l.topLeftCorner.x,
            l.topRightCorner.y - l.topLeftCorner.y,
          ) +
            Math.hypot(
              l.bottomRightCorner.x - l.bottomLeftCorner.x,
              l.bottomRightCorner.y - l.bottomLeftCorner.y,
            )) /
          2;
      if (side < 80)
        throw new Error("The code is too small for lens calibration.");
      const fraction = calibrateFocalFraction(side, a.sizeMm, 1, f.width);
      localStorage.setItem(focalKey, String(fraction));
      setStatus(
        "Saved rear-camera focal estimate for this browser. Repeat if you switch lenses or zoom.",
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Calibration failed");
    }
  }
  return (
    <div className="recognizer-panel">
      <video ref={video} className="camera-preview" muted playsInline />
      <div className="button-row">
        <button onClick={start} disabled={busy}>
          Start camera
        </button>
        <button onClick={scan} disabled={busy}>
          {busy ? "Checking scan…" : "Scan QR"}
        </button>
      </div>
      <details>
        <summary>Camera lens calibration</summary>
        <p>
          Place the camera lens exactly 1.0 m from a surveyed sticker, face it
          squarely, and keep zoom unchanged. The sticker’s black code width must
          match its survey record; the white border is extra.
        </p>
        <button onClick={calibrate} disabled={busy}>
          Calibrate at measured 1.0 m
        </button>
      </details>
      <p role="status" className="status-line">
        {status}
      </p>
    </div>
  );
}
