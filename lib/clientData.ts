"use client";
import { useEffect, useState } from "react";
import {
  buildingSchema,
  loadBuilding,
  type BuildingId,
  type BuildingConfig,
} from "./buildings";
import { parseGraph } from "./graph";
import type { NavGraph } from "./astar";
export const draftKey = (id: BuildingId) => `wayfinder:building:${id}:v1`;
export function useBuildingData(id: BuildingId) {
  const [config, setConfig] = useState<BuildingConfig | null>(null),
    [graph, setGraph] = useState<NavGraph | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  useEffect(() => {
    const handler = () => setVersion((v) => v + 1);
    window.addEventListener("building-settings", handler);
    return () => window.removeEventListener("building-settings", handler);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setConfig(null);
    setGraph(null);
    setError("");
    loadBuilding(id)
      .then(async (base) => {
        let c = base;
        try {
          const draft = localStorage.getItem(draftKey(id));
          if (draft) {
            const candidate = buildingSchema.parse(JSON.parse(draft));
            if (candidate.id === id) c = candidate;
          }
        } catch {
          localStorage.removeItem(draftKey(id));
        }
        if (cancelled) return;
        setConfig(c);
        if (c.graph) {
          const response = await fetch(c.graph);
          if (!response.ok)
            throw new Error("Unable to load the navigation graph.");
          const g = parseGraph(await response.json());
          if (!cancelled) setGraph(g);
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Building loading failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [id, version]);
  return { config, graph, error };
}
export function saveConfigDraft(config: BuildingConfig) {
  localStorage.setItem(
    draftKey(config.id),
    JSON.stringify(buildingSchema.parse(config)),
  );
  window.dispatchEvent(new Event("building-settings"));
}
export function downloadFile(
  name: string,
  data: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
