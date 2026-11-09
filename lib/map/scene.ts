import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { BuildingConfig } from "../buildings";
import type { NavGraph } from "../astar";
import { graphToModel, type Vec3 } from "../geo/transform";

export function loadScan(url: string) {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
}
export function disposeObject(object: THREE.Object3D) {
  object.traverse((o) => {
    if (
      o instanceof THREE.Mesh ||
      o instanceof THREE.Line ||
      o instanceof THREE.Points
    ) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const value of Object.values(m))
          if (value instanceof THREE.Texture) value.dispose();
        m.dispose();
      }
    }
  });
}
export function setFloorVisibility(
  root: THREE.Object3D,
  floor: number,
  showAll = false,
) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const name = o.parent?.name ?? o.name;
    const match =
      name.match(/^floor_(-?\d+)/) ?? o.name.match(/^floor_(-?\d+)/);
    if (!match) return;
    const level = Number(match[1]);
    if (!o.userData.floorMaterialsCloned) {
      const clone = (m: THREE.Material) => {
        const c = m.clone();
        c.userData.originalOpacity = m.opacity;
        c.userData.originalTransparent = m.transparent;
        return c;
      };
      o.material = Array.isArray(o.material)
        ? o.material.map(clone)
        : clone(o.material);
      o.userData.floorMaterialsCloned = true;
    }
    o.visible = showAll || level <= floor;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.transparent =
        (!showAll && level < floor) || Boolean(m.userData.originalTransparent);
      m.opacity =
        ((m.userData.originalOpacity as number) ?? 1) *
        (!showAll && level < floor ? 0.15 : 1);
      m.depthWrite = showAll || level === floor;
    }
  });
}
export function setWallCutaway(root: THREE.Object3D, height: number | null) {
  const plane =
    height === null
      ? null
      : new THREE.Plane(new THREE.Vector3(0, -1, 0), height);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const role = o.userData.role ?? o.parent?.userData.role;
    if (role !== "wall" && role !== "window") return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const changed = Boolean(m.clippingPlanes?.length) !== Boolean(plane);
      m.clippingPlanes = plane ? [plane] : null;
      if (changed) m.needsUpdate = true;
    }
  });
}
export function roomOutline(config: BuildingConfig, roomId?: string) {
  const root = new THREE.Group(),
    room = config.rooms?.find((r) => r.id === roomId);
  if (!room) return root;
  const floor = config.floors.find((f) => f.index === room.floor);
  if (!floor) return root;
  const [x0, z0, x1, z1] = room.rect,
    y = floor.baseY + 0.1;
  const geometry = new THREE.BufferGeometry().setFromPoints(
    [
      [x0, y, z0],
      [x1, y, z0],
      [x1, y, z1],
      [x0, y, z1],
    ].map((p) => new THREE.Vector3(...(p as [number, number, number]))),
  );
  const line = new THREE.LineLoop(
    geometry,
    new THREE.LineBasicMaterial({ color: 0xffc857, depthTest: false }),
  );
  line.renderOrder = 20;
  root.add(line);
  return root;
}
export type OverlayPoint = { position: Vec3; color: string; radius?: number };
export function buildOverlay(
  config: BuildingConfig,
  graph: NavGraph | null,
  path: number[],
  floor: number,
  showGraph: boolean,
  user?: Vec3,
  points: OverlayPoint[] = [],
) {
  const root = new THREE.Group();
  if (graph && config.graphToModel) {
    if (showGraph) {
      const vertices: number[] = [];
      for (const node of Object.values(graph.nodes))
        if (node[2] === floor)
          vertices.push(...graphToModel(node, config, 0.08));
      const geometry = new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      root.add(
        new THREE.Points(
          geometry,
          new THREE.PointsMaterial({
            color: 0x50c9fa,
            size: 0.07,
            sizeAttenuation: true,
            depthTest: false,
          }),
        ),
      );
    }
    for (let i = 1; i < path.length; i++) {
      const a = graph.nodes[path[i - 1]],
        b = graph.nodes[path[i]];
      if (a[2] !== floor && b[2] !== floor) continue;
      const start = new THREE.Vector3(...graphToModel(a, config, 0.3)),
        end = new THREE.Vector3(...graphToModel(b, config, 0.3));
      if (start.distanceTo(end) < 0.001) continue;
      const curve = new THREE.LineCurve3(start, end);
      root.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(curve, 1, 0.045, 5, false),
          new THREE.MeshBasicMaterial({ color: 0x35e895, depthTest: false }),
        ),
      );
    }
    for (const id of graph.exits)
      if (graph.nodes[id]?.[2] === floor)
        points = [
          ...points,
          {
            position: graphToModel(graph.nodes[id], config, 0.3),
            color: "#37e895",
            radius: 0.18,
          },
        ];
    if (user)
      points = [
        ...points,
        {
          position: graphToModel(user, config, 0.35),
          color: "#59aaff",
          radius: 0.18,
        },
      ];
  }
  for (const point of points)
    root.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(point.radius ?? 0.12, 8, 6),
        new THREE.MeshBasicMaterial({ color: point.color, depthTest: false }),
      )
        .translateX(point.position[0])
        .translateY(point.position[1])
        .translateZ(point.position[2]),
    );
  root.renderOrder = 10;
  return root;
}
