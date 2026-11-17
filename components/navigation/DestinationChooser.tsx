"use client";
import { useState } from "react";
import { floorLabel, type BuildingConfig } from "@/lib/buildings";
import type { NavGraph } from "@/lib/astar";
import {
  buildingLocationPoints,
  type LocationPoint,
} from "@/lib/position/gpsCalibration";

export default function DestinationChooser({
  config,
  graph,
  selectedId,
  onChoose,
}: {
  config: BuildingConfig;
  graph: NavGraph;
  selectedId: string | null;
  onChoose: (point: LocationPoint) => void;
}) {
  const destinations = buildingLocationPoints(config, graph).sort(
      (a, b) => a.floor - b.floor || a.label.localeCompare(b.label),
    ),
    [draftId, setDraftId] = useState(
      selectedId !== null && destinations.some((d) => d.id === selectedId)
        ? selectedId
        : "",
    );
  return (
    <div className="location-chooser">
      <p>
        Choose a destination point. A route will be planned from your selected
        location to this point.
      </p>
      <label>
        Destination
        <select
          value={draftId}
          onChange={(event) => setDraftId(event.target.value)}
        >
          <option value="">Choose a destination</option>
          {config.floors.map((floor) => {
            const options = destinations.filter(
              (destination) => destination.floor === floor.index,
            );
            return options.length ? (
              <optgroup
                key={floor.index}
                label={floorLabel(config, floor.index)}
              >
                {options.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.label}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </label>
      <button
        className="primary-sheet-action"
        disabled={!destinations.some((p) => p.id === draftId)}
        onClick={() => {
          const point = destinations.find((p) => p.id === draftId);
          if (point) onChoose(point);
        }}
      >
        Use this destination
      </button>
    </div>
  );
}
