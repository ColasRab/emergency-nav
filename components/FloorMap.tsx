"use client";

import { useMemo } from "react";
import type { NavGraph } from "@/lib/astar";

function clampSpan(value: number): number {
  return value < 0.001 ? 0.001 : value;
}

export default function FloorMap({
  graph,
  currentFloor,
  graphPosition,
  path,
}: {
  graph: NavGraph;
  currentFloor: number;
  graphPosition: [number, number] | null;
  path: number[] | null;
}) {
  const floorNodeEntries = useMemo(
    () =>
      Object.entries(graph.nodes)
        .map(([nodeId, [x, z, floor]]) => ({ nodeId: Number(nodeId), x, z, floor }))
        .filter((node) => node.floor === currentFloor),
    [currentFloor, graph.nodes]
  );

  const routeNodes = useMemo(() => {
    if (!path) return [];
    return path
      .map((nodeId) => {
        const [x, z, floor] = graph.nodes[String(nodeId)];
        return { nodeId, x, z, floor };
      })
      .filter((node) => node.floor === currentFloor);
  }, [currentFloor, graph.nodes, path]);

  const floorExits = useMemo(
    () =>
      graph.exits
        .map((nodeId) => {
          const [x, z, floor] = graph.nodes[String(nodeId)];
          return { nodeId, x, z, floor };
        })
        .filter((node) => node.floor === currentFloor),
    [currentFloor, graph.exits, graph.nodes]
  );

  if (floorNodeEntries.length === 0) return null;

  const minX = Math.min(...floorNodeEntries.map((node) => node.x));
  const maxX = Math.max(...floorNodeEntries.map((node) => node.x));
  const minZ = Math.min(...floorNodeEntries.map((node) => node.z));
  const maxZ = Math.max(...floorNodeEntries.map((node) => node.z));
  const spanX = clampSpan(maxX - minX);
  const spanZ = clampSpan(maxZ - minZ);

  const toSvg = (x: number, z: number) => {
    const px = ((x - minX) / spanX) * 100;
    const pz = ((z - minZ) / spanZ) * 100;
    return [px, 100 - pz] as const;
  };

  return (
    <div className="map-frame">
      <div className="label">Map basis · Floor {currentFloor}</div>
      <svg viewBox="0 0 100 100" className="floor-map" role="img" aria-label={`Floor ${currentFloor} map`}>
        <rect x="0" y="0" width="100" height="100" className="floor-map-bg" />
        {floorNodeEntries.map((node) => {
          const [px, py] = toSvg(node.x, node.z);
          return <circle key={node.nodeId} cx={px} cy={py} r="0.55" className="floor-map-node" />;
        })}
        {routeNodes.length >= 2 && (
          <polyline
            points={routeNodes.map((node) => toSvg(node.x, node.z).join(",")).join(" ")}
            className="floor-map-route"
          />
        )}
        {floorExits.map((node) => {
          const [px, py] = toSvg(node.x, node.z);
          return <circle key={`exit-${node.nodeId}`} cx={px} cy={py} r="1.1" className="floor-map-exit" />;
        })}
        {graphPosition && (
          <circle
            cx={toSvg(graphPosition[0], graphPosition[1])[0]}
            cy={toSvg(graphPosition[0], graphPosition[1])[1]}
            r="1.5"
            className="floor-map-user"
          />
        )}
      </svg>
      <p className="status-line">Green: exit · Blue: route · White: your position</p>
    </div>
  );
}
