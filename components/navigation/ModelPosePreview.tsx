"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { BuildingConfig } from "@/lib/buildings";
import type { NavGraph } from "@/lib/astar";
import type { Vec2 } from "@/lib/geo/transform";
import { buildOverlay, disposeObject, loadScan } from "@/lib/map/scene";

/** First-person view from the model pose. The live camera is a separate, explicit mode. */
export default function ModelPosePreview({
  config,
  graph,
  path,
  floor,
  position,
  heading,
}: {
  config: BuildingConfig;
  graph: NavGraph;
  path: number[] | null;
  floor: number;
  position: Vec2 | null;
  heading: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef({ config, graph, path, floor, position, heading }),
    redraw = useRef<(() => void) | null>(null);
  latest.current = { config, graph, path, floor, position, heading };
  const [status, setStatus] = useState("Loading first-person model view…");
  useEffect(() => {
    if (!host.current || !config.glb) return;
    const container = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setStatus(
        "3D preview unavailable. The map and location estimate remain available.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#253b44");
    scene.fog = new THREE.Fog("#253b44", 25, 65);
    scene.add(new THREE.HemisphereLight(0xe6f5ff, 0x5c6860, 3));
    const sun = new THREE.DirectionalLight(0xfff1d4, 2.4);
    sun.position.set(8, 20, -5);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.06, 150);
    let model: THREE.Group | null = null,
      overlay = new THREE.Group(),
      stopped = false,
      pendingFrame = 0;
    let paintedPath: number[] | null | undefined,
      paintedGraph: NavGraph | null = null,
      paintedConfig: BuildingConfig | null = null,
      paintedFloor: number | undefined,
      previousWidth = 0,
      previousHeight = 0;
    scene.add(overlay);
    const render = () => {
      if (stopped || !model) return;
      const l = latest.current,
        f = l.config.floors.find((v) => v.index === l.floor),
        p = l.position ?? [0, 1],
        y = (f?.baseY ?? 0) + 1.6,
        a = (l.heading * Math.PI) / 180;
      const width = container.clientWidth,
        height = container.clientHeight;
      if (!width || !height) return;
      if (width !== previousWidth || height !== previousHeight) {
        renderer.setSize(width, height);
        previousWidth = width;
        previousHeight = height;
      }
      camera.aspect = width / height;
      // Match the estimated overlay's slightly raised horizon.
      camera.setViewOffset(width, height, 0, height * 0.08, width, height);
      camera.updateProjectionMatrix();
      camera.position.set(p[0], y, p[1]);
      camera.lookAt(p[0] + Math.sin(a), y, p[1] - Math.cos(a));
      if (paintedFloor !== l.floor)
        model.traverse((o) => {
          const match = o.name.match(/^floor_(-?\d+)$/);
          if (match) o.visible = Number(match[1]) === l.floor;
        });
      if (
        paintedPath !== l.path ||
        paintedGraph !== l.graph ||
        paintedConfig !== l.config ||
        paintedFloor !== l.floor
      ) {
        scene.remove(overlay);
        disposeObject(overlay);
        overlay = buildOverlay(l.config, l.graph, l.path ?? [], l.floor, false);
        overlay.traverse((object) => {
          if (object instanceof THREE.Mesh)
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material])
              material.depthTest = true;
        });
        scene.add(overlay);
        paintedPath = l.path;
        paintedGraph = l.graph;
        paintedConfig = l.config;
        paintedFloor = l.floor;
      }
      renderer.render(scene, camera);
      container.dataset.renderCalls = String(renderer.info.render.calls);
    };
    const schedule = () => {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = requestAnimationFrame(render);
    };
    redraw.current = schedule;
    const resize = new ResizeObserver(schedule);
    resize.observe(container);
    const intersection = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) schedule();
    });
    intersection.observe(container);
    const lost = (event: Event) => {
      event.preventDefault();
      setStatus(
        "Model preview paused. Map and text directions remain available.",
      );
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    loadScan(config.glb)
      .then((gltf) => {
        if (stopped) {
          disposeObject(gltf.scene);
          return;
        }
        model = gltf.scene;
        scene.add(model);
        schedule();
        setStatus("");
      })
      .catch(() => {
        if (!stopped)
          setStatus("Model preview unavailable. Use the top-down map.");
      });
    return () => {
      stopped = true;
      redraw.current = null;
      cancelAnimationFrame(pendingFrame);
      resize.disconnect();
      intersection.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [config.id, config.glb]);
  useEffect(() => {
    redraw.current?.();
  }, [config, graph, path, floor, position, heading]);
  return (
    <div
      className="model-pose-preview"
      role="img"
      aria-label="First-person model preview at estimated position"
    >
      <div ref={host} className="model-preview-canvas" />
      {status && (
        <p className="model-preview-status" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
