"use client";
import { useEffect, useRef, useState } from "react";
import type { BuildingConfig } from "@/lib/buildings";
import type { NavGraph } from "@/lib/astar";
import type { Vec2 } from "@/lib/geo/transform";
import { CrowdDetector, DetectionWindow } from "@/lib/hazards/detectors";
import { crowdNodes, localizeHazard } from "@/lib/hazards/localize";
import type {
  DetectedHazard,
  Hazard,
  HazardDetector,
  HazardType,
} from "@/lib/hazards/model";
export default function HazardScanner({
  video,
  config,
  graph,
  position,
  floor,
  heading,
  enabled,
  onCreate,
  extraDetectors = [],
}: {
  video: HTMLVideoElement | null;
  config: BuildingConfig;
  graph: NavGraph;
  position: Vec2;
  floor: number;
  heading: number | null;
  enabled: boolean;
  onCreate: (h: Hazard, confirmed?: boolean) => void;
  extraDetectors?: HazardDetector[];
}) {
  const [status, setStatus] = useState(
      "Start the navigation camera for crowd scanning.",
    ),
    [candidate, setCandidate] = useState<DetectedHazard | null>(null),
    [paused, setPaused] = useState(false);
  const latest = useRef({ config, graph, position, floor, heading, onCreate });
  latest.current = { config, graph, position, floor, heading, onCreate };
  useEffect(() => {
    if (!enabled || !video || paused) return;
    let stopped = false,
      running = false,
      lowBattery = false,
      lastRun = 0;
    const detectors: HazardDetector[] = [
        new CrowdDetector(
          config.settings.crowd.busy,
          config.settings.crowd.congested,
        ),
        ...extraDetectors,
      ],
      windows = new Map<HazardType, DetectionWindow>(),
      lastReport = new Map<string, number>();
    const getWindow = (type: HazardType) => {
      if (!windows.has(type))
        windows.set(
          type,
          new DetectionWindow(
            config.settings.hazards.confirmationFrames,
            config.settings.hazards.windowFrames,
            config.settings.hazards.confidence,
          ),
        );
      return windows.get(type)!;
    };
    const batteryApi = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    };
    void batteryApi.getBattery?.().then((b) => {
      lowBattery = b.level < 0.2 && !b.charging;
    });
    async function tick() {
      if (
        stopped ||
        running ||
        video!.readyState < 2 ||
        document.hidden ||
        performance.now() - lastRun < (lowBattery ? 5000 : 750)
      )
        return;
      running = true;
      lastRun = performance.now();
      try {
        const results = (
          await Promise.all(detectors.map((d) => d.detect(video!)))
        ).flat();
        if (stopped) return;
        const c = latest.current;
        for (const type of ["crowd", "fire", "smoke"] as const) {
          const found = results
            .filter((r) => r.type === type)
            .sort((a, b) => b.confidence - a.confidence)[0];
          if (!getWindow(type).add(found?.confidence ?? 0) || !found) continue;
          const key = `${c.config.id}:${c.floor}:${type}`;
          if (Date.now() - (lastReport.get(key) ?? 0) < 60000) continue;
          if (type === "crowd") {
            const nodeIds = crowdNodes(c.graph, c.position, c.floor, c.config);
            if (nodeIds.length) {
              const now = Date.now();
              c.onCreate({
                id: crypto.randomUUID(),
                buildingId: c.config.id,
                floor: c.floor,
                nodeIds,
                type,
                severity:
                  (found.personCount ?? 0) >= c.config.settings.crowd.congested
                    ? 2
                    : 1,
                confidence: found.confidence,
                source: "auto",
                confirmations: 0,
                dismissals: 0,
                createdAt: now,
                expiresAt: now + c.config.settings.crowd.ttlMs,
              });
              lastReport.set(key, now);
            }
          } else {
            setCandidate(found);
            lastReport.set(key, Date.now());
          }
        }
        setStatus(
          lowBattery
            ? "Crowd scanning slowed to save battery"
            : "Scanning for crowds · fire and smoke reports are manual unless a trained detector is configured",
        );
      } catch {
        if (!stopped)
          setStatus("Automatic scanning unavailable. Use Report hazard.");
      } finally {
        running = false;
      }
    }
    let interval: ReturnType<typeof setInterval> | undefined;
    Promise.all(detectors.map((d) => d.load()))
      .then(() => {
        if (stopped) {
          detectors.forEach((d) => d.dispose?.());
          return;
        }
        setStatus("Scanning for crowds");
        interval = setInterval(() => void tick(), 500);
      })
      .catch(() => {
        if (!stopped) setStatus("Detector could not load. Use Report hazard.");
      });
    return () => {
      stopped = true;
      if (interval) clearInterval(interval);
      if (!running) detectors.forEach((d) => d.dispose?.());
      else {
        const cleanup = setInterval(() => {
          if (!running) {
            clearInterval(cleanup);
            detectors.forEach((d) => d.dispose?.());
          }
        }, 100);
      }
    };
  }, [enabled, video, paused, config.id]);
  function confirm() {
    if (!candidate) return;
    const now = Date.now(),
      scope = localizeHazard(graph, position, floor, heading, config);
    if (scope.nodeIds.length)
      onCreate(
        {
          id: crypto.randomUUID(),
          buildingId: config.id,
          floor,
          ...scope,
          type: candidate.type,
          severity: 3,
          confidence: candidate.confidence,
          source: "auto",
          confirmations: 1,
          dismissals: 0,
          createdAt: now,
          expiresAt: now + config.settings.hazards.ttlMs,
        },
        true,
      );
    setCandidate(null);
  }
  return (
    <section className="status-card">
      <p role="status" className="status-line">
        {paused ? "Automatic scanning paused" : status}
      </p>
      {video && (
        <button
          className="secondary-button"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? "Resume scanning" : "Pause scanning"}
        </button>
      )}
      {candidate && (
        <div role="alert">
          <p>
            Possible {candidate.type}. Check the scene and location before
            blocking a route.
          </p>
          <button onClick={confirm}>Confirm hazard here</button>
          <button
            className="secondary-button"
            onClick={() => setCandidate(null)}
          >
            Dismiss detection
          </button>
        </div>
      )}
    </section>
  );
}
