"use client";
import { useState } from "react";
import type { NavGraph } from "@/lib/astar";
import type { Room } from "@/lib/buildings";
import {
  applySimilarity,
  type Similarity,
  type Vec2,
} from "@/lib/geo/transform";
import {
  isRoomPointWalkable,
  roomPointPreset,
} from "@/lib/navigation/roomStart";

export default function RoomStartPicker({
  room,
  graph,
  path,
  onStart,
  transform,
}: {
  room: Room;
  graph: NavGraph | null;
  path: number[];
  onStart: (room: Room, point: Vec2, name: string) => void;
  transform?: Similarity;
}) {
  const [point, setPoint] = useState<Vec2>(() => roomPointPreset(room, 2, 0)),
    [name, setName] = useState("Back right");
  const [x0, z0, x1, z1] = room.rect,
    width = x1 - x0,
    depth = z1 - z0,
    valid = isRoomPointWalkable(room, point),
    unit = Math.max(width, depth) / 70;
  const local = ([x, z]: Vec2) => [x - x0, z - z0];
  const contains = ([x, z, f]: [number, number, number]) =>
    f === room.floor && x >= x0 && x <= x1 && z >= z0 && z <= z1;
  return (
    <section
      className="room-start-panel"
      aria-label="Start at a point in the room"
    >
      <div className="room-heading">
        <div>
          <p className="eyebrow">Start from the model</p>
          <h2>Where in {room.label} are you?</h2>
        </div>
        <span className="estimate-badge">Manual position</span>
      </div>
      <p>
        Choose a corner or tap a clear space. Back is the window wall; front is
        the corridor wall. Left and right match this plan.
      </p>
      <div className="room-start-layout">
        <div className="room-point-plan">
          <span>BACK · WINDOWS</span>
          <svg
            viewBox={`-0.15 -0.15 ${width + 0.3} ${depth + 0.3}`}
            role="img"
            aria-label={`${room.label} room point picker`}
            onPointerDown={(event) => {
              const svg = event.currentTarget,
                matrix = svg.getScreenCTM();
              if (!matrix) return;
              const p = new DOMPoint(
                event.clientX,
                event.clientY,
              ).matrixTransform(matrix.inverse());
              setPoint([p.x + x0, p.y + z0]);
              setName("Custom point");
            }}
          >
            <rect
              width={width}
              height={depth}
              fill="#203445"
              stroke="#9bb7c9"
              strokeWidth={unit}
            />
            {room.obstacles.map(([ax, az, bx, bz], i) => (
              <rect
                key={i}
                x={ax - x0}
                y={az - z0}
                width={bx - ax}
                height={bz - az}
                fill="#ad916a"
                fillOpacity="0.75"
              />
            ))}
            {room.doors.map(([x, z], i) => (
              <line
                key={i}
                x1={x - x0 - 0.43}
                x2={x - x0 + 0.43}
                y1={z - z0}
                y2={z - z0}
                stroke="#80efb9"
                strokeWidth={unit * 1.8}
              />
            ))}
            {graph &&
              path.slice(1).map((id, i) => {
                const convert = (
                  node: [number, number, number],
                ): [number, number, number] =>
                  transform
                    ? [
                        ...applySimilarity([node[0], node[1]], transform),
                        node[2],
                      ]
                    : node;
                const a = graph.nodes[path[i]] && convert(graph.nodes[path[i]]),
                  b = graph.nodes[id] && convert(graph.nodes[id]);
                if (!a || !b || !contains(a) || !contains(b)) return null;
                return (
                  <line
                    key={i}
                    x1={a[0] - x0}
                    y1={a[1] - z0}
                    x2={b[0] - x0}
                    y2={b[1] - z0}
                    stroke="#76b8ff"
                    strokeWidth={unit * 1.2}
                  />
                );
              })}
            {point.every(Number.isFinite) && (
              <circle
                cx={local(point)[0]}
                cy={local(point)[1]}
                r={unit * 2}
                fill={valid ? "#71eec2" : "#ff7e79"}
                stroke="#101b26"
                strokeWidth={unit * 0.6}
              />
            )}
          </svg>
          <span>FRONT · DOORS TO CORRIDOR</span>
          <small>Tan: modeled furniture · Green gaps: doors</small>
        </div>
        <div>
          <div className="point-presets" aria-label="Room position presets">
            {["Back", "Middle", "Front"].flatMap((row, r) =>
              ["left", "center", "right"].map((col, c) => {
                const text = `${row} ${col}`;
                return (
                  <button
                    key={text}
                    className={`secondary-button ${name === text ? "active" : ""}`}
                    aria-pressed={name === text}
                    onClick={() => {
                      setPoint(roomPointPreset(room, c, r));
                      setName(text);
                    }}
                  >
                    {text}
                  </button>
                );
              }),
            )}
          </div>
          <div className="two-columns">
            <label>
              From left wall (m)
              <input
                type="number"
                step="0.05"
                min="0"
                max={width}
                value={
                  Number.isFinite(point[0])
                    ? Number((point[0] - x0).toFixed(3))
                    : ""
                }
                onChange={(e) => {
                  setPoint([x0 + e.target.valueAsNumber, point[1]]);
                  setName("Custom point");
                }}
              />
            </label>
            <label>
              From back wall (m)
              <input
                type="number"
                step="0.05"
                min="0"
                max={depth}
                value={
                  Number.isFinite(point[1])
                    ? Number((point[1] - z0).toFixed(3))
                    : ""
                }
                onChange={(e) => {
                  setPoint([point[0], z0 + e.target.valueAsNumber]);
                  setName("Custom point");
                }}
              />
            </label>
          </div>
          <p className={valid ? "status-line" : "status-warning"} role="status">
            {valid
              ? `${name} · ${room.label}. Route uses the modeled furniture, doors and stairs.`
              : "This point is too close to a wall or furniture. Choose a clear space."}
          </p>
          <button disabled={!valid} onClick={() => onStart(room, point, name)}>
            Use this starting point
          </button>
        </div>
      </div>
    </section>
  );
}
