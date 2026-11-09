import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "three/examples/jsm/libs/fflate.module.js";
import { buildingSchema } from "../lib/buildings";
import { parseGraph } from "../lib/graph";
import { astar } from "../lib/astar";
import { setFloorVisibility, setWallCutaway } from "../lib/map/scene";
import rawAdmin from "../public/models/admin.json";
import rawYnares from "../public/models/ynares.json";
import adminGraph from "../public/graphs/admin-rooms.json";
import ynaresGraph from "../public/graphs/ynares-rooms.json";

describe("plan-based room reconstruction", () => {
  for (const [raw, input] of [
    [rawAdmin, adminGraph],
    [rawYnares, ynaresGraph],
  ] as const) {
    const config = buildingSchema.parse(raw),
      graph = parseGraph(input);
    it(`${config.id}: preserves the reference scan and marks the generated layout as estimated`, () => {
      expect(config.modelKind).toBe("room-layout");
      expect(config.scanGlb).toBe(`/models/${config.id}.glb`);
      expect(config.glb).not.toBe(config.scanGlb);
      expect(
        config.modelVerified || config.graphVerified || config.floorsVerified,
      ).toBe(false);
      expect(config.assumptions?.length).toBeGreaterThan(3);
    });
    it(`${config.id}: every room routes through one of its actual model door openings`, () => {
      for (const room of config.rooms ?? []) {
        const path = astar(graph, room.nodeId, graph.exits).path;
        expect(path, room.label).not.toBeNull();
        expect(
          room.doorNodeIds.some((id) => path!.includes(id)),
          room.label,
        ).toBe(true);
        for (const doorId of room.doorNodeIds) {
          const [x, z, f] = graph.nodes[doorId];
          expect(f).toBe(room.floor);
          expect(
            room.doors.some(
              (p) => Math.abs(p[0] - x) < 0.001 && Math.abs(p[1] - z) < 0.001,
            ),
          ).toBe(true);
        }
      }
      expect(graph.exits.every((id) => graph.nodes[id][2] === 0)).toBe(true);
      expect(graph.nodes[507]).toBeUndefined();
    });
    it(`${config.id}: same-floor edges never cross a room wall away from a doorway`, () => {
      for (const room of config.rooms ?? []) {
        const [x0, z0, x1, z1] = room.rect;
        for (const [id, edges] of Object.entries(graph.edges)) {
          const a = graph.nodes[id];
          if (a[2] !== room.floor) continue;
          for (const [dest] of edges) {
            const b = graph.nodes[dest];
            if (b[2] !== room.floor || Math.abs(a[1] - b[1]) < 1e-8) continue;
            const t = (z1 - a[1]) / (b[1] - a[1]);
            if (t < 0 || t > 1) continue;
            const x = a[0] + t * (b[0] - a[0]);
            if (x <= x0 + 0.001 || x >= x1 - 0.001) continue;
            expect(
              room.doors.some(
                ([dx, dz]) =>
                  Math.abs(dx - x) <= 0.53 && Math.abs(dz - z1) < 0.001,
              ),
              `${room.label}: ${id}->${dest}`,
            ).toBe(true);
          }
        }
      }
    });
    it(`${config.id}: exports named floor nodes and room IDs in the actual GLB`, async () => {
      await MeshoptDecoder.ready;
      const doc = await new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ "meshopt.decoder": MeshoptDecoder })
        .read(`public/models/${config.id}-rooms.glb`);
      const nodes = doc.getRoot().listNodes();
      for (const f of config.floors) {
        const floor = nodes.find((n) => n.getName() === `floor_${f.index}`)!;
        expect(floor).toBeDefined();
        expect(floor.getTranslation()[1]).toBeCloseTo(f.baseY);
      }
      for (const room of config.rooms ?? [])
        expect(nodes.some((n) => n.getExtras().roomId === room.id)).toBe(true);
    });
    it(`${config.id}: ships a complete OBJ/material/texture bundle with correct floor elevations`, async () => {
      const files = unzipSync(
        new Uint8Array(
          await readFile(`public/models/${config.id}-rooms-bundle.zip`),
        ),
      );
      const obj = strFromU8(files[`${config.id}-rooms.obj`]),
        mtl = strFromU8(files[`${config.id}-rooms.mtl`]);
      expect(files[`${config.id}-rooms.glb`]).toBeDefined();
      expect(files["source-floor-plan.png"]).toBeDefined();
      expect(files["ESTIMATED-MODEL-NOTES.txt"]).toBeDefined();
      const declared = new Set(
        mtl
          .split(/\r?\n/)
          .filter((s) => s.startsWith("newmtl "))
          .map((s) => s.slice(7)),
      );
      for (const line of obj.split(/\r?\n/))
        if (line.startsWith("usemtl "))
          expect(declared.has(line.slice(7))).toBe(true);
      for (const line of mtl.split(/\r?\n/))
        if (line.startsWith("map_Kd "))
          expect(files[line.slice(7)]).toBeDefined();
      const heights = obj
        .split(/\r?\n/)
        .filter((s) => s.startsWith("v "))
        .map((s) => Number(s.split(/\s+/)[2]));
      const last = config.floors.at(-1)!;
      expect(Math.max(...heights)).toBeCloseTo(last.baseY + last.height, 3);
      expect(Math.min(...heights)).toBeCloseTo(
        -config.floors[0].slabThicknessM!,
        3,
      );
    });
  }
  it("retains the measured Ynares slab-inclusive elevations and correct room order", () => {
    const c = buildingSchema.parse(rawYnares);
    expect(c.floors.map((f) => f.baseY)).toEqual([0, 3.095, 6.145]);
    expect(
      c.rooms
        ?.filter((r) => r.floor === 1 && r.kind !== "toilet")
        .map((r) => r.label),
    ).toEqual(["Rutherford", "Marsden", "Franklin"]);
    expect(
      c.rooms
        ?.filter((r) => r.floor === 2 && r.kind !== "toilet")
        .map((r) => r.label),
    ).toEqual(["Darwin", "21st CLEM"]);
  });
  it("places cross-floor route connectors inside the modeled stairwell openings", () => {
    const g = parseGraph(ynaresGraph);
    let count = 0;
    for (const [id, edges] of Object.entries(g.edges))
      for (const [to] of edges) {
        const a = g.nodes[id],
          b = g.nodes[to];
        if (a[2] === b[2]) continue;
        count++;
        for (const point of [a, b]) {
          expect(point[1]).toBeLessThan(-0.15);
          expect(point[1]).toBeGreaterThan(-3.23);
          expect(Math.abs(point[0])).toBeGreaterThan(12.95);
          expect(Math.abs(point[0])).toBeLessThan(15.85);
        }
      }
    expect(count).toBe(8);
  });
  it("fades shared source materials independently per floor and preserves glass transparency", () => {
    const root = new THREE.Group(),
      source = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.45,
      });
    const meshes = [0, 1, 2].map((index) => {
      const floor = new THREE.Group();
      floor.name = `floor_${index}`;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), source);
      mesh.userData.role = "wall";
      floor.add(mesh);
      root.add(floor);
      return mesh;
    });
    setFloorVisibility(root, 1);
    expect(meshes[0].material.opacity).toBeCloseTo(0.45 * 0.15);
    expect(meshes[1].material.opacity).toBeCloseTo(0.45);
    expect(meshes[2].visible).toBe(false);
    expect(source.opacity).toBe(0.45);
    setWallCutaway(root, 4.245);
    expect(meshes[1].material.clippingPlanes?.[0].constant).toBeCloseTo(4.245);
    setFloorVisibility(root, 1, true);
    expect(meshes.every((m) => m.visible)).toBe(true);
    expect(meshes[0].material.opacity).toBeCloseTo(0.45);
  });
});
