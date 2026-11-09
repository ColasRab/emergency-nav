"use client";
import { useMemo, useState } from "react";
import type { BuildingConfig } from "@/lib/buildings";
import type { NavGraph } from "@/lib/astar";
import {
  buildingLocationPoints,
  type LocationPoint,
} from "@/lib/position/gpsCalibration";
export default function LocationChooser({
  config,
  graph,
  floor,
  initialId,
  hasGpsAlignment,
  onChoose,
}: {
  config: BuildingConfig;
  graph: NavGraph;
  floor: number;
  initialId?: string;
  hasGpsAlignment: boolean;
  onChoose: (point: LocationPoint, facing: number) => void;
}) {
  const points = useMemo(
      () =>
        buildingLocationPoints(config, graph).filter((p) => p.floor === floor),
      [config, graph, floor],
    ),
    initial =
      points.find((p) => p.id === initialId) ??
      points.find((p) => p.label === "Marsden · Right door") ??
      points[0];
  const [roomId, setRoomId] = useState(initial?.roomId ?? "areas"),
    [pointId, setPointId] = useState(initial?.id ?? ""),
    [facing, setFacing] = useState(180);
  const choices = points.filter((p) =>
      roomId === "areas" ? !p.roomId : p.roomId === roomId,
    ),
    point = choices.find((p) => p.id === pointId) ?? choices[0];
  return (
    <div className="location-chooser">
      <p>
        Choose where you are standing. This sets a location directly in the
        model.
      </p>
      <label>
        Room or area
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          {config.rooms
            ?.filter((r) => r.floor === floor)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          <option value="areas">Corridor, landing or stairs</option>
        </select>
      </label>
      <label>
        Standing position
        <select
          value={point?.id ?? ""}
          onChange={(e) => setPointId(e.target.value)}
        >
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {!hasGpsAlignment && (
        <label>
          Phone is pointing toward
          <select
            value={facing}
            onChange={(e) => setFacing(Number(e.target.value))}
          >
            <option value={180}>Front — corridor / room doors</option>
            <option value={0}>Back — window wall</option>
            <option value={90}>Right side of the map</option>
            <option value={270}>Left side of the map</option>
          </select>
        </label>
      )}
      <button
        className="primary-sheet-action"
        disabled={!point}
        onClick={() => point && onChoose(point, facing)}
      >
        Use this location
      </button>
      <p className="status-line">
        Positions and room dimensions follow the estimated model.
      </p>
    </div>
  );
}
