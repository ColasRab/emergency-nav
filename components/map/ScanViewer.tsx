"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BuildingConfig } from "@/lib/buildings";
import type { NavGraph } from "@/lib/astar";
import type { Vec3 } from "@/lib/geo/transform";
import {
  buildOverlay,
  disposeObject,
  loadScan,
  setFloorVisibility,
  type OverlayPoint,
  setWallCutaway,
  roomOutline,
} from "@/lib/map/scene";
export type ModelHit = { position: Vec3; normal: [number, number] };
export default function ScanViewer({
  config,
  graph = null,
  path = [],
  floor = 0,
  showGraph = false,
  points = [],
  user,
  onPick,
  diagnostics = false,
  selectedRoomId,
  onRoomSelect,
}: {
  config: BuildingConfig;
  graph?: NavGraph | null;
  path?: number[];
  floor?: number;
  showGraph?: boolean;
  points?: OverlayPoint[];
  user?: Vec3;
  onPick?: (hit: ModelHit) => void;
  diagnostics?: boolean;
  selectedRoomId?: string;
  onRoomSelect?: (roomId: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef<{
      scene: THREE.Scene;
      model: THREE.Group;
      overlay: THREE.Group;
      render: () => void;
      benchmark: () => Promise<number>;
      frame: () => void;
    } | null>(null);
  const [showScan, setShowScan] = useState(false),
    [cutaway, setCutaway] = useState(true),
    [allFloors, setAllFloors] = useState(false);
  const viewingScan = showScan && !!config.scanGlb;
  const modelUrl = viewingScan ? config.scanGlb : config.glb;
  const overlayConfig = viewingScan
    ? { ...config, graphToModel: null }
    : config;
  const latest = useRef({
    config,
    graph,
    path,
    floor,
    showGraph,
    points,
    user,
    onPick,
  });
  latest.current = {
    config: overlayConfig,
    graph,
    path,
    floor,
    showGraph,
    points: viewingScan ? [] : points,
    user,
    onPick,
  };
  const extras = useRef({
    selectedRoomId,
    onRoomSelect,
    cutaway,
    viewingScan,
    allFloors,
  });
  extras.current = {
    selectedRoomId,
    onRoomSelect,
    cutaway,
    viewingScan,
    allFloors,
  };
  useEffect(() => setShowScan(false), [config.id]);
  useEffect(() => setAllFloors(false), [floor, config.id]);
  const [status, setStatus] = useState("Loading scan…"),
    [preset, setPreset] = useState(false);
  const [fps, setFps] = useState<number | null>(null),
    [measuring, setMeasuring] = useState(false);
  useEffect(() => {
    if (!host.current || !modelUrl) return;
    setStatus("Loading scan…");
    setFps(null);
    let stopped = false,
      renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setStatus(
        "3D preview unavailable on this device. Use the location list.",
      );
      return;
    }
    const container = host.current;
    renderer.localClippingEnabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111b26");
    scene.add(new THREE.HemisphereLight(0xffffff, 0x536575, 3));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(10, 20, 10);
    scene.add(light);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000),
      controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    let overlay = new THREE.Group(),
      model = new THREE.Group();
    scene.add(overlay, model);
    const frameModel = () => {
      const box = new THREE.Box3().setFromObject(model),
        l = latest.current,
        e = extras.current;
      if (
        !e.viewingScan &&
        l.config.modelKind === "room-layout" &&
        !e.allFloors
      ) {
        const f = l.config.floors.find((f) => f.index === l.floor);
        if (f) {
          box.min.y = f.baseY - (f.slabThicknessM ?? 0.15);
          box.max.y = f.baseY + (e.cutaway ? 1.7 : f.height);
        }
      }
      const center = box.getCenter(new THREE.Vector3()),
        direction = new THREE.Vector3(
          preset ? 0 : 0.12,
          preset ? 1 : 0.85,
          preset ? 0.001 : 0.7,
        ).normalize(),
        right = new THREE.Vector3(0, 1, 0).cross(direction).normalize(),
        up = direction.clone().cross(right).normalize(),
        tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      let distance = 1;
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const p = new THREE.Vector3(x, y, z).sub(center),
              along = p.dot(direction);
            distance = Math.max(
              distance,
              along + Math.abs(p.dot(right)) / (tan * camera.aspect),
              along + Math.abs(p.dot(up)) / tan,
            );
          }
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance * 1.14);
      camera.far = Math.max(200, distance * 20);
      camera.updateProjectionMatrix();
      camera.lookAt(center);
      controls.update();
    };
    const render = () => {
      if (!stopped) renderer.render(scene, camera);
    };
    const benchmark = () =>
      new Promise<number>((resolve) => {
        let started: number | null = null,
          frames = 0;
        const frame = (time: number) => {
          if (stopped) {
            resolve(0);
            return;
          }
          if (started === null) started = time;
          renderer.render(scene, camera);
          frames++;
          if (time - started < 2000) requestAnimationFrame(frame);
          else resolve(((frames - 1) * 1000) / (time - started));
        };
        requestAnimationFrame(frame);
      });
    controls.addEventListener("change", render);
    const resize = new ResizeObserver(() => {
      const w = container.clientWidth,
        h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (state.current) frameModel();
      render();
    });
    resize.observe(container);
    const lost = (e: Event) => {
      e.preventDefault();
      setStatus("3D graphics paused. Reload the preview to reconnect.");
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    let down: [number, number] = [0, 0];
    const pointerDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
    };
    const pick = (e: PointerEvent) => {
      if (
        Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 ||
        (!latest.current.onPick && !extras.current.onRoomSelect)
      )
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObject(model, true)[0];
      if (!hit?.face) return;
      const roomId =
        hit.object.userData.roomId ?? hit.object.parent?.userData.roomId;
      if (
        !extras.current.viewingScan &&
        typeof roomId === "string" &&
        latest.current.config.rooms?.some((r) => r.id === roomId)
      )
        extras.current.onRoomSelect?.(roomId);
      if (!latest.current.onPick) return;
      const normal = hit.face.normal
        .clone()
        .transformDirection(hit.object.matrixWorld);
      if (Math.hypot(normal.x, normal.z) < 0.5) {
        setStatus("Choose a wall surface, away from the floor or ceiling.");
        return;
      }
      const n = Math.hypot(normal.x, normal.z);
      latest.current.onPick({
        position: hit.point.toArray() as Vec3,
        normal: [normal.x / n, normal.z / n],
      });
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pick);
    const started = performance.now();
    loadScan(modelUrl)
      .then((gltf) => {
        if (stopped) {
          disposeObject(gltf.scene);
          return;
        }
        scene.remove(model);
        model = gltf.scene;
        scene.add(model);
        frameModel();
        setFloorVisibility(
          model,
          latest.current.floor,
          extras.current.allFloors,
        );
        setWallCutaway(
          model,
          !extras.current.viewingScan &&
            !extras.current.allFloors &&
            extras.current.cutaway &&
            config.modelKind === "room-layout"
            ? (config.floors.find((f) => f.index === latest.current.floor)
                ?.baseY ?? 0) + 1.15
            : null,
        );
        state.current = {
          scene,
          model,
          overlay,
          render,
          benchmark,
          frame: frameModel,
        };
        const l = latest.current;
        scene.remove(overlay);
        disposeObject(overlay);
        overlay = buildOverlay(
          l.config,
          l.graph,
          l.path,
          l.floor,
          l.showGraph,
          l.user,
          l.points,
        );
        if (!extras.current.viewingScan)
          overlay.add(roomOutline(l.config, extras.current.selectedRoomId));
        scene.add(overlay);
        state.current.overlay = overlay;
        render();
        setStatus(
          `Loaded in ${((performance.now() - started) / 1000).toFixed(1)} s · ${!viewingScan && config.modelKind === "room-layout" ? "estimated room model" : config.modelVerified ? "surveyed model" : "original scan — scale unverified"}`,
        );
      })
      .catch(() => {
        if (!stopped)
          setStatus(
            "Unable to load this scan. Check the model conversion report.",
          );
      });
    return () => {
      stopped = true;
      state.current = null;
      resize.disconnect();
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pick);
      renderer.domElement.remove();
    };
  }, [config.id, modelUrl, config.modelVerified, config.modelKind, preset]);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    setFloorVisibility(s.model, floor, allFloors);
    setWallCutaway(
      s.model,
      !viewingScan &&
        !allFloors &&
        cutaway &&
        config.modelKind === "room-layout"
        ? (config.floors.find((f) => f.index === floor)?.baseY ?? 0) + 1.15
        : null,
    );
    s.scene.remove(s.overlay);
    disposeObject(s.overlay);
    s.overlay = buildOverlay(
      overlayConfig,
      graph,
      path,
      floor,
      showGraph,
      user,
      viewingScan ? [] : points,
    );
    if (!viewingScan) s.overlay.add(roomOutline(config, selectedRoomId));
    s.scene.add(s.overlay);
    s.render();
  }, [
    config,
    graph,
    path,
    floor,
    showGraph,
    user,
    points,
    selectedRoomId,
    cutaway,
    viewingScan,
    allFloors,
  ]);
  useEffect(() => {
    state.current?.frame();
    state.current?.render();
  }, [floor, allFloors, cutaway]);
  return (
    <div className="scan-panel">
      {config.modelKind === "room-layout" && (
        <div className="model-toolbar">
          <div>
            <strong>
              {viewingScan
                ? "Original scan reference"
                : "Room model from your floor plan"}
            </strong>
            <p>
              {viewingScan
                ? "Scan coordinates are separate; room and route overlays are hidden."
                : "Estimated room sizes, openings and illustrative furniture"}
            </p>
          </div>
          <div className="button-row">
            <button
              className={!showScan ? "active" : "secondary-button"}
              aria-pressed={!showScan}
              onClick={() => setShowScan(false)}
            >
              Room model
            </button>
            <button
              className={showScan ? "active" : "secondary-button"}
              aria-pressed={showScan}
              onClick={() => setShowScan(true)}
              disabled={!config.scanGlb}
            >
              Original scan
            </button>
          </div>
        </div>
      )}
      <div ref={host} className="scan-canvas" />
      <div className="viewer-footer">
        <span role="status">{status}</span>
        <button
          className="secondary-button"
          onClick={() => setPreset((p) => !p)}
        >
          {preset ? "Angled view" : "Top-down view"}
        </button>
        {!viewingScan && config.modelKind === "room-layout" && (
          <button
            className="secondary-button"
            aria-pressed={cutaway}
            onClick={() => setCutaway((c) => !c)}
          >
            {cutaway ? "Show full walls" : "Cutaway walls"}
          </button>
        )}
        {!viewingScan &&
          config.modelKind === "room-layout" &&
          config.floors.length > 1 && (
            <button
              className="secondary-button"
              aria-pressed={allFloors}
              onClick={() => setAllFloors((v) => !v)}
            >
              {allFloors ? "Selected floor only" : "Show all floors"}
            </button>
          )}
      </div>
      {diagnostics && (
        <details>
          <summary>Preview performance</summary>
          <p>
            Measures this device’s scan rendering. It does not certify phone
            performance or 4G loading.
          </p>
          <button
            disabled={measuring || !state.current}
            onClick={async () => {
              setMeasuring(true);
              setFps(await state.current!.benchmark());
              setMeasuring(false);
            }}
          >
            Run rendering check
          </button>
          <span data-preview-fps={fps ?? ""} role="status">
            {fps === null ? "" : ` ${fps.toFixed(1)} frames/s`}
          </span>
        </details>
      )}
    </div>
  );
}
