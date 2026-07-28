"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import "@tensorflow/tfjs";
import type { NavGraph } from "@/lib/astar";

/**
 * QRAndCrowdRecognizer -- zero-training replacement for a custom scene
 * classifier.
 *
 *  1. QR CODES at each stairwell (and anywhere else without readable
 *     existing signage). jsQR is classic image processing, not ML --
 *     no training step, no accuracy tuning, works the moment it's wired
 *     up. Setup is printing a sticker encoding that zone's label
 *     (e.g. "STAIRS_A") and taping it up -- minutes per location.
 *  2. COCO-SSD (pretrained, ALSO no training needed) counts "person"
 *     detections in the same frame as a live congestion signal.
 *
 * If/when there's time later, this QR step can be swapped for a trained
 * classifier without touching anything else -- both feed the same
 * onLocationUpdate callback.
 */

const CROWD_THRESHOLDS = { busy: 3, congested: 7 };

function crowdPenaltyFromCount(count: number): number {
  if (count >= CROWD_THRESHOLDS.congested) return 5.0;
  if (count >= CROWD_THRESHOLDS.busy) return 2.0;
  return 1.0;
}

function buildZoneIndex(graph: NavGraph) {
  // QR payload should be the zone label text, e.g. "STAIRS_A" -- matched
  // case-insensitively against the labels you set in tag_zones() when
  // building nav_graph.json.
  const index: Record<string, number> = {};
  for (const [nodeIdStr, tag] of Object.entries(graph.zones)) {
    const key = tag.label.trim().toLowerCase();
    if (!(key in index)) index[key] = parseInt(nodeIdStr, 10);
  }
  return index;
}

export default function QRAndCrowdRecognizer({
  graph,
  onLocationUpdate,
}: {
  graph: NavGraph;
  onLocationUpdate: (nodeId: number, label: string, crowdPenalty: number, personCount: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [crowdModel, setCrowdModel] = useState<cocoSsd.ObjectDetection | null>(null);
  const [status, setStatus] = useState("Loading crowd model…");
  const [scanning, setScanning] = useState(false);
  const zoneIndex = buildZoneIndex(graph);

  useEffect(() => {
    let cancelled = false;
    cocoSsd.load().then((model) => {
      if (!cancelled) {
        setCrowdModel(model);
        setStatus("Ready");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
  }

  async function scanNow() {
    if (!videoRef.current || !canvasRef.current || !crowdModel) return;
    setScanning(true);
    setStatus("Scanning…");

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // 1. QR decode -- instant, no model, no training
    const qr = jsQR(imageData.data, imageData.width, imageData.height);

    // 2. Crowd count -- pretrained, no training
    const detections = await crowdModel.detect(video);
    const personCount = detections.filter((d) => d.class === "person").length;
    const crowdPenalty = crowdPenaltyFromCount(personCount);

    if (!qr) {
      setStatus(`No QR code found in frame. People detected: ${personCount}. Try centering the sticker.`);
      setScanning(false);
      return;
    }

    const label = qr.data.trim().toLowerCase();
    const nodeId = zoneIndex[label];
    if (nodeId === undefined) {
      setStatus(`QR read "${qr.data}" but it doesn't match any known zone label.`);
      setScanning(false);
      return;
    }

    setStatus(
      `Zone: ${qr.data} · People: ${personCount}` + (crowdPenalty > 1 ? " · congestion detected" : "")
    );
    onLocationUpdate(nodeId, qr.data, crowdPenalty, personCount);
    setScanning(false);
  }

  return (
    <div className="recognizer-panel">
      <video ref={videoRef} className="camera-preview" muted playsInline />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <div className="button-row">
        <button onClick={startCamera}>Start camera</button>
        <button onClick={scanNow} disabled={!crowdModel || scanning}>
          {scanning ? "Scanning…" : "Scan QR code"}
        </button>
      </div>
      <p className="status-line">{status}</p>
    </div>
  );
}
