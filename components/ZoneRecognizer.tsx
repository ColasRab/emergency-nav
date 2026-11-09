"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Tesseract from "tesseract.js";
import type { NavGraph } from "@/lib/astar";
import { matchZone } from "@/lib/zones";

/**
 * ZoneRecognizer -- OCR path.
 * Points the camera at EXISTING signage (room numbers, floor labels, exit
 * signs) and matches the read text against zone labels in nav_graph.json.
 * Use this where legible signage exists; use QRAndCrowdRecognizer for
 * surveyed stickers in unmarked areas.
 */

export default function ZoneRecognizer({
  graph,
  onZoneFound,
  currentFloor = 0,
}: {
  graph: NavGraph;
  currentFloor?: number;
  onZoneFound: (nodeId: number, label: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "scanning" | "not_found">(
    "idle",
  );
  const [lastText, setLastText] = useState("");

  useEffect(() => {
    return () =>
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function startCamera() {
    try {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setStatus("not_found");
    }
  }

  async function captureAndRecognize() {
    if (
      !videoRef.current ||
      videoRef.current.readyState < 2 ||
      !videoRef.current.videoWidth
    ) {
      setStatus("not_found");
      return;
    }
    setStatus("scanning");

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(videoRef.current, 0, 0);

    try {
      const { data } = await Tesseract.recognize(canvas, "eng");
      setLastText(data.text);

      const match = matchZone(graph, data.text, currentFloor);
      if (match) {
        onZoneFound(match.nodeId, match.label);
        setStatus("idle");
      } else {
        setStatus("not_found");
      }
    } catch {
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
          Couldn&apos;t match that sign to a known zone. Try getting closer, or
          use a surveyed QR sticker instead. Last read: &ldquo;
          {lastText.slice(0, 80)}&rdquo;
        </p>
      )}
    </div>
  );
}
