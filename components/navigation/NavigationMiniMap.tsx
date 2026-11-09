"use client";
import { useId, useState } from "react";
import type { BuildingConfig } from "@/lib/buildings";
import type { NavGraph } from "@/lib/astar";
import {
  modelRouteSegments,
  type ModelPlace,
} from "@/lib/navigation/modelView";

export default function NavigationMiniMap({
  config,
  graph,
  path,
  floor,
  place,
  heading,
}: {
  config: BuildingConfig;
  graph: NavGraph;
  path: number[] | null;
  floor: number;
  place: ModelPlace;
  heading: number;
}) {
  const [scope, setScope] = useState<"room" | "floor">("room"),
    patternId = useId().replace(/[^a-zA-Z0-9]/g, ""),
    rooms = config.rooms?.filter((r) => r.floor === floor) ?? [],
    room = scope === "room" ? place.room : undefined,
    d = config.layoutDimensions;
  const bounds = room
    ? room.rect
    : d
      ? [
          -d.width / 2,
          -d.roomDepth,
          d.width / 2,
          d.corridorDepth + d.projectionDepth,
        ]
      : [
          Math.min(-1, ...rooms.map((r) => r.rect[0])),
          Math.min(-1, ...rooms.map((r) => r.rect[1])),
          Math.max(1, ...rooms.map((r) => r.rect[2])),
          Math.max(3, ...rooms.map((r) => r.rect[3])),
        ];
  const pad = room ? 0.5 : 1,
    width = bounds[2] - bounds[0] + pad * 2,
    height = bounds[3] - bounds[1] + pad * 2,
    unit = Math.max(width, height) / 50,
    route = modelRouteSegments(config, graph, path, floor);
  const outline = d
    ? `M${-d.width / 2},${-d.roomDepth}H${d.width / 2}V${d.corridorDepth}H${d.projectionWidth / 2}V${d.corridorDepth + d.projectionDepth}H${-d.projectionWidth / 2}V${d.corridorDepth}H${-d.width / 2}Z`
    : "";
  return (
    <section
      className="navigation-minimap"
      aria-label="Top-down navigation map"
    >
      <header>
        <span>
          <i /> {room ? room.label : config.name}
        </span>
        <button
          aria-label={
            room ? "Show whole floor map" : "Zoom map to current room"
          }
          disabled={!place.room}
          onClick={() => setScope(room ? "floor" : "room")}
        >
          {room ? "Floor" : "Room"}
        </button>
      </header>
      <svg
        viewBox={`${bounds[0] - pad} ${bounds[1] - pad} ${width} ${height}`}
        role="img"
        aria-label={`${place.floor} top-down model map with estimated user position`}
      >
        <defs>
          <pattern
            id={patternId}
            width="1"
            height="1"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M1 0H0V1"
              stroke="#466775"
              strokeWidth="0.014"
              fill="none"
            />
          </pattern>
        </defs>
        <rect
          x={bounds[0] - pad}
          y={bounds[1] - pad}
          width={width}
          height={height}
          fill={`url(#${patternId})`}
        />
        {outline && (
          <path
            d={outline}
            fill="#273b41"
            stroke="#748e91"
            strokeWidth={unit * 0.16}
          />
        )}
        {rooms.map((r) => (
          <g key={r.id}>
            <rect
              x={r.rect[0]}
              y={r.rect[1]}
              width={r.rect[2] - r.rect[0]}
              height={r.rect[3] - r.rect[1]}
              fill={r.id === place.room?.id ? "#344a42" : "#1b2b32"}
              stroke={r.id === place.room?.id ? "#e5c270" : "#92a4a3"}
              strokeWidth={unit * 0.18}
            />
            {r.obstacles.map(([x0, z0, x1, z1], i) => (
              <rect
                key={i}
                x={x0}
                y={z0}
                width={x1 - x0}
                height={z1 - z0}
                fill="#a99068"
                fillOpacity="0.75"
              />
            ))}
            {r.doors.map(([x, z], i) => (
              <line
                key={i}
                x1={x - 0.43}
                x2={x + 0.43}
                y1={z}
                y2={z}
                stroke="#77e0b0"
                strokeWidth={unit * 0.3}
              />
            ))}
            <title>{r.label}</title>
          </g>
        ))}
        {route.map(([a, b], i) => (
          <line
            key={i}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke="#80ffc5"
            strokeWidth={unit * 0.35}
            strokeLinecap="round"
          />
        ))}
        {place.position && (
          <g
            data-testid="minimap-user"
            transform={`translate(${place.position[0]},${place.position[1]}) rotate(${heading})`}
          >
            <circle r={unit * 1.4} fill="#85e5fa" fillOpacity="0.16" />
            <path
              d={`M0 ${-unit * 1.1}L${unit * 0.8} ${unit * 0.9}L0 ${unit * 0.5}L${-unit * 0.8} ${unit * 0.9}Z`}
              fill="#b5eeff"
              stroke="#0d2830"
              strokeWidth={unit * 0.18}
            />
          </g>
        )}
      </svg>
      <footer>
        <span>{place.floor}</span>
        <span>{room ? "Room" : "Floor"} · estimated</span>
      </footer>
    </section>
  );
}
