"use client";

import { useRef, useState } from "react";
import Tesseract from "tesseract.js";
import type { NavGraph } from "@/lib/astar";

/**
 * ZoneRecognizer -- OCR path.
 * Points the camera at EXISTING signage (room numbers, floor labels, exit
 * signs) and matches the read text against zone labels in nav_graph.json.
 * Use this where legible signage already exists; use SceneAndCrowdRecognizer
 * (visual classification) where it doesn't, e.g. unmarked stairwells.
 */

function buildZoneIndex(graph: NavGraph) {
  const index: Record<string, number> = {};
  for (const [nodeIdStr, tag] of Object.entries(graph.zones)) {
    const key = tag.label.trim().toLowerCase();
    if (!(key in index)) index[key] = parseInt(nodeIdStr, 10);
  }
  return index;
}

function matchZoneFromText(ocrText: string, zoneIndex: Record<string, number>) {
  const cleaned = ocrText.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  for (const [label, nodeId] of Object.entries(zoneIndex)) {
    if (cleaned.includes(label)) return { label, nodeId };
  }
  return null;
}

export default function ZoneRecognizer({
  graph,
  onZoneFound,
}: {
  graph: NavGraph;
  onZoneFound: (nodeId: number, label: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"idle" | "scanning" | "not_found">("idle");
  const [lastText, setLastText] = useState("");
  const zoneIndex = buildZoneIndex(graph);

  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
  }

  async function captureAndRecognize() {
    if (!videoRef.current) return;
    setStatus("scanning");

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(videoRef.current, 0, 0);

    const { data } = await Tesseract.recognize(canvas, "eng");
    setLastText(data.text);

    const match = matchZoneFromText(data.text, zoneIndex);
    if (match) {
      onZoneFound(match.nodeId, match.label);
      setStatus("idle");
    } else {
      setStatus("not_found");
    }
  }

  return (
    <div className="recognizer-panel">
      <video ref={videoRef} className="camera-preview" muted playsInline />
      <div className="button-row">
        <button onClick={startCamera}>Start camera</button>
        <button onClick={captureAndRecognize} disabled={status === "scanning"}>
          {status === "scanning" ? "Reading sign…" : "Scan sign"}
        </button>
      </div>
      {status === "not_found" && (
        <p className="status-warning">
          Couldn&apos;t match that sign to a known zone. Try getting closer, or use
          scene recognition instead. Last read: &ldquo;{lastText.slice(0, 80)}&rdquo;
        </p>
      )}
    </div>
  );
}
