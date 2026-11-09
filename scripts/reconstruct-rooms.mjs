/** Plan-based, explicitly estimated reconstruction. Original scan exports stay intact. */
import fs from "node:fs/promises";
import * as THREE from "three";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from "@gltf-transform/extensions";
import { dedup, prune, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { zipSync, strToU8 } from "three/examples/jsm/libs/fflate.module.js";

await MeshoptEncoder.ready;
const manifest = JSON.parse(
  await fs.readFile("scripts/room-layouts.json", "utf8"),
);
const rounded = (n) => Math.round(n * 10000) / 10000;
const xml = (s) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const reports = [];
for (const spec of manifest.buildings) {
  const doc = new Document(),
    buffer = doc.createBuffer(),
    scene = doc.createScene(spec.id),
    objScene = new THREE.Group(),
    unlit = doc.createExtension(KHRMaterialsUnlit);
  const materials = new Map(),
    meshes = new Map(),
    objMaterials = new Map(),
    mtl = [],
    rooms = [],
    obstacles = new Map(),
    floors = [];
  const graph = {
    meta: {
      buildingId: spec.id,
      version: 3,
      units: "meters",
      estimated: true,
      revision: manifest.revision,
    },
    nodes: {},
    edges: {},
    exits: [],
    zones: {},
  };
  let nextId = spec.nodeIdBase;
  const node = (x, z, floor, label, type = "hallway") => {
    const id = nextId++;
    graph.nodes[id] = [rounded(x), rounded(z), floor];
    graph.edges[id] = [];
    if (label) graph.zones[id] = { label, type };
    return id;
  };
  const link = (a, b, distance) => {
    const p = graph.nodes[a],
      q = graph.nodes[b],
      weight = distance ?? Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!graph.edges[a].some(([id]) => id === b)) {
      graph.edges[a].push([b, rounded(weight)]);
      graph.edges[b].push([a, rounded(weight)]);
    }
  };
  function material(name, color, alpha = 1) {
    if (materials.has(name)) return materials.get(name);
    const c = new THREE.Color(color),
      m = doc
        .createMaterial(name)
        .setBaseColorFactor([c.r, c.g, c.b, alpha])
        .setRoughnessFactor(0.88)
        .setMetallicFactor(0)
        .setDoubleSided(true);
    if (alpha < 1) m.setAlphaMode("BLEND");
    materials.set(name, m);
    const om = new THREE.MeshStandardMaterial({
      name,
      color,
      opacity: alpha,
      transparent: alpha < 1,
      side: THREE.DoubleSide,
    });
    objMaterials.set(name, om);
    mtl.push(
      `newmtl ${name}\nKa 0.2 0.2 0.2\nKd ${c.r} ${c.g} ${c.b}\nd ${alpha}\nillum 2\n`,
    );
    return m;
  }
  const wall = material("plaster", "#f3eee2"),
    trim = material("door-trim", "#8b4b42"),
    slab = material("slab-edge", "#94a5b5"),
    metal = material("rail", "#426775"),
    glass = material("window-glass", "#86c9dd", 0.45),
    wood = material("desk", "#c89d6a"),
    chair = material("chair", "#557995"),
    white = material("fixtures", "#eff7fa"),
    screen = material("monitor", "#254552"),
    stairMat = material("stairs", "#a9b6a7");
  function meshFor(geometry, mat, key) {
    const cacheKey = `${key}:${mat.getName()}`;
    if (meshes.has(cacheKey)) return meshes.get(cacheKey);
    const p = doc.createPrimitive().setMaterial(mat);
    for (const [semantic, name, type] of [
      ["POSITION", "position", "VEC3"],
      ["NORMAL", "normal", "VEC3"],
      ["TEXCOORD_0", "uv", "VEC2"],
    ]) {
      const attribute = geometry.getAttribute(name);
      if (!attribute) continue;
      const array = new Float32Array(attribute.array);
      if (name === "uv")
        for (let i = 1; i < array.length; i += 2) array[i] = 1 - array[i];
      p.setAttribute(
        semantic,
        doc.createAccessor().setType(type).setArray(array).setBuffer(buffer),
      );
    }
    if (geometry.index)
      p.setIndices(
        doc
          .createAccessor()
          .setType("SCALAR")
          .setArray(new Uint32Array(geometry.index.array))
          .setBuffer(buffer),
      );
    const m = doc.createMesh(cacheKey).addPrimitive(p);
    meshes.set(cacheKey, m);
    return m;
  }
  const cube = new THREE.BoxGeometry(1, 1, 1);
  function add(
    geometry,
    mat,
    name,
    position,
    scale = [1, 1, 1],
    rotation = [0, 0, 0, 1],
    extras = {},
    key = name,
  ) {
    const n = doc
      .createNode(name)
      .setMesh(meshFor(geometry, mat, key))
      .setTranslation(position)
      .setScale(scale)
      .setRotation(rotation)
      .setExtras(extras);
    currentFloor.addChild(n);
    const o = new THREE.Mesh(geometry, objMaterials.get(mat.getName()));
    o.name = name;
    o.position.fromArray(position);
    o.scale.fromArray(scale);
    o.quaternion.fromArray(rotation);
    currentObj.add(o);
    return n;
  }
  const box = (mat, name, x, y, z, w, h, d, role = "furniture", roomId) => {
    // Use the same boxes for room routing and the rendered model.
    if (role === "furniture" && roomId && y - h / 2 < 1.8 && y + h / 2 > 0.15) {
      const list = obstacles.get(roomId) ?? [];
      list.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2].map(rounded));
      obstacles.set(roomId, list);
    }
    return add(
      cube,
      mat,
      name,
      [x, y, z],
      [Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001)],
      [0, 0, 0, 1],
      { role, ...(roomId ? { roomId } : {}) },
      "unit-box",
    );
  };
  const labelPlane = new THREE.PlaneGeometry(1, 1);
  async function label(
    text,
    x,
    z,
    width,
    floorIndex,
    roomId,
    color = "#20344e",
  ) {
    const lines =
      text.length > 16 && text.includes(" ")
        ? [
            text.slice(0, text.lastIndexOf(" ")),
            text.slice(text.lastIndexOf(" ") + 1),
          ]
        : [text];
    const size = lines.some((s) => s.length > 17) ? 60 : 72;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="240"><rect x="2" y="2" width="764" height="236" rx="25" fill="#ffffff" fill-opacity=".94" stroke="#7b90a5" stroke-width="3"/>${lines.map((line, i) => `<text x="384" y="${lines.length === 1 ? 137 : 105 + i * 57}" font-family="Arial, sans-serif" font-size="${size}" font-weight="700" text-anchor="middle" fill="${color}">${xml(line.toUpperCase())}</text>`).join("")}</svg>`;
    const bytes = await sharp(Buffer.from(svg)).png().toBuffer(),
      name = `label-${floorIndex}-${roomId}`;
    const texture = doc
        .createTexture(name)
        .setImage(bytes)
        .setMimeType("image/png"),
      mat = doc
        .createMaterial(name)
        .setBaseColorTexture(texture)
        .setDoubleSided(true)
        .setAlphaMode("BLEND")
        .setExtension("KHR_materials_unlit", unlit.createUnlit());
    materials.set(name, mat);
    objMaterials.set(
      name,
      new THREE.MeshBasicMaterial({
        name,
        color: "white",
        side: THREE.DoubleSide,
      }),
    );
    await fs.mkdir(`public/models/${spec.id}-room-textures`, {
      recursive: true,
    });
    await fs.writeFile(
      `public/models/${spec.id}-room-textures/${name}.png`,
      bytes,
    );
    mtl.push(
      `newmtl ${name}\nKd 1 1 1\nillum 1\nmap_Kd ${spec.id}-room-textures/${name}.png\n`,
    );
    add(
      labelPlane,
      mat,
      name,
      [x, 0.07, z],
      [width, (width * 240) / 768, 1],
      [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      { role: "label", roomId },
      name,
    );
  }
  function railing(x0, z0, x1, z1) {
    const dx = x1 - x0,
      dz = z1 - z0,
      len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    for (const y of [0.55, 1.05])
      box(
        metal,
        "guardrail",
        (x0 + x1) / 2,
        y,
        (z0 + z1) / 2,
        dx ? len : 0.055,
        0.055,
        dz ? len : 0.055,
        "rail",
      );
    for (let s = 0; s <= Math.ceil(len / 1.5); s++) {
      const t = s / Math.ceil(len / 1.5);
      box(
        metal,
        "rail-post",
        x0 + dx * t,
        0.52,
        z0 + dz * t,
        0.055,
        1.04,
        0.055,
        "rail",
      );
    }
  }
  function frontWall(x0, x1, z, doorXs, clear, roomId, doorWidth = 1.05) {
    let start = x0;
    for (const center of [...doorXs].sort((a, b) => a - b)) {
      const left = center - doorWidth / 2,
        right = center + doorWidth / 2;
      if (left > start)
        box(
          wall,
          "front-wall",
          (start + left) / 2,
          clear / 2,
          z,
          left - start,
          clear,
          0.15,
          "wall",
          roomId,
        );
      box(
        wall,
        "door-lintel",
        center,
        (2.15 + clear) / 2,
        z,
        doorWidth,
        Math.max(0.1, clear - 2.15),
        0.15,
        "wall",
        roomId,
      );
      box(trim, "door-frame", left, 1.07, z, 0.06, 2.14, 0.17, "wall", roomId);
      box(trim, "door-frame", right, 1.07, z, 0.06, 2.14, 0.17, "wall", roomId);
      box(
        trim,
        "door-header",
        center,
        2.15,
        z,
        doorWidth + 0.08,
        0.07,
        0.17,
        "wall",
        roomId,
      );
      start = right;
    }
    if (start < x1)
      box(
        wall,
        "front-wall",
        (start + x1) / 2,
        clear / 2,
        z,
        x1 - start,
        clear,
        0.15,
        "wall",
        roomId,
      );
  }
  function windows(x0, x1, z, clear, roomId) {
    const width = x1 - x0;
    box(
      wall,
      "window-sill-wall",
      (x0 + x1) / 2,
      0.48,
      z,
      width,
      0.96,
      0.15,
      "wall",
      roomId,
    );
    box(
      wall,
      "window-head-wall",
      (x0 + x1) / 2,
      (2.2 + clear) / 2,
      z,
      width,
      clear - 2.2,
      0.15,
      "wall",
      roomId,
    );
    const count = Math.max(1, Math.round(width / 2.7));
    for (let i = 0; i < count; i++) {
      const a = x0 + (width * i) / count,
        b = x0 + (width * (i + 1)) / count;
      box(wall, "window-pier", a, 1.58, z, 0.14, 1.24, 0.15, "wall", roomId);
      box(
        glass,
        "window",
        (a + b) / 2,
        1.58,
        z,
        b - a - 0.16,
        1.2,
        0.055,
        "window",
        roomId,
      );
      box(
        metal,
        "window-mullion",
        (a + b) / 2,
        1.58,
        z,
        0.035,
        1.2,
        0.07,
        "window",
        roomId,
      );
    }
    box(wall, "window-pier", x1, 1.58, z, 0.14, 1.24, 0.15, "wall", roomId);
  }
  function furniture(room) {
    const [x0, z0, x1, z1] = room.rect,
      w = x1 - x0,
      d = z1 - z0;
    const id = room.id,
      desk = (x, z, computer = false) => {
        box(wood, "table", x, 0.72, z, 1.1, 0.09, 0.55, "furniture", id);
        for (const off of [-0.43, 0.43])
          box(
            metal,
            "table-leg",
            x + off,
            0.34,
            z,
            0.045,
            0.68,
            0.38,
            "furniture",
            id,
          );
        box(
          chair,
          "seat",
          x,
          0.43,
          z + 0.58,
          0.42,
          0.09,
          0.42,
          "furniture",
          id,
        );
        box(
          chair,
          "seat-back",
          x,
          0.7,
          z + 0.77,
          0.42,
          0.5,
          0.065,
          "furniture",
          id,
        );
        if (computer) {
          box(
            screen,
            "computer-monitor",
            x,
            1.01,
            z - 0.12,
            0.56,
            0.37,
            0.065,
            "furniture",
            id,
          );
          box(
            metal,
            "monitor-stand",
            x,
            0.82,
            z - 0.12,
            0.08,
            0.16,
            0.08,
            "furniture",
            id,
          );
        }
      };
    if (room.kind === "storage") {
      for (const x of [x0 + 0.45, x1 - 0.45])
        for (const h of [0.45, 0.95, 1.45])
          box(
            wood,
            "storage-shelf",
            x,
            h,
            z0 + d * 0.45,
            0.55,
            0.08,
            d * 0.55,
            "furniture",
            id,
          );
      return;
    }
    if (room.kind === "clinic") {
      box(
        metal,
        "clinic-bed-base",
        x0 + w * 0.65,
        0.42,
        z0 + d * 0.43,
        1,
        0.2,
        1.9,
        "furniture",
        id,
      );
      box(
        white,
        "clinic-mattress",
        x0 + w * 0.65,
        0.59,
        z0 + d * 0.43,
        1,
        0.15,
        1.9,
        "furniture",
        id,
      );
      box(
        white,
        "clinic-pillow",
        x0 + w * 0.65,
        0.72,
        z0 + d * 0.43 - 0.65,
        0.75,
        0.12,
        0.35,
        "furniture",
        id,
      );
      desk(x0 + w * 0.28, z0 + d * 0.7);
      return;
    }
    if (room.kind === "toilet") {
      for (const x of [x0 + w * 0.28, x0 + w * 0.72]) {
        box(white, "wc", x, 0.25, z0 + 0.6, 0.48, 0.5, 0.66, "furniture", id);
        box(
          wall,
          "stall-divider",
          x + w * 0.22,
          0.8,
          z0 + 0.7,
          0.06,
          1.6,
          1.1,
          "furniture",
          id,
        );
      }
      box(
        white,
        "wash-basin",
        x0 + w * 0.3,
        0.8,
        z1 - 0.35,
        0.65,
        0.15,
        0.4,
        "furniture",
        id,
      );
      return;
    }
    if (room.kind === "science-lab") {
      for (const z of [z0 + d * 0.28, z0 + d * 0.67])
        box(
          wood,
          "lab-bench",
          x0 + w * 0.53,
          0.84,
          z,
          w * 0.62,
          0.12,
          0.7,
          "furniture",
          id,
        );
      box(
        white,
        "lab-sink",
        x1 - 0.6,
        0.9,
        z0 + 0.65,
        0.6,
        0.12,
        0.5,
        "furniture",
        id,
      );
      return;
    }
    const cols =
        room.kind === "office"
          ? Math.max(1, Math.floor(w / 2.1))
          : Math.max(2, Math.min(4, Math.floor(w / 1.65))),
      rows = room.kind === "office" ? 1 : 2;
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++)
        desk(
          x0 + (w * (col + 1)) / (cols + 1),
          z0 + d * (0.3 + row * 0.3),
          room.kind === "computer-lab",
        );
    if (room.kind === "classroom")
      box(
        screen,
        "teaching-board",
        (x0 + x1) / 2,
        1.55,
        z0 + 0.11,
        Math.min(w - 1, 2.7),
        0.95,
        0.045,
        "furniture",
        id,
      );
  }
  function staircase(x0, x1, floor) {
    const rise = floor.height / 18,
      tread = 0.27,
      run = 9 * tread;
    for (let i = 0; i < 9; i++) {
      const h = (i + 1) * rise;
      box(
        stairMat,
        "stair-first-flight",
        x0 + 0.8,
        h / 2,
        -0.18 - (i + 0.5) * tread,
        1.25,
        h,
        tread,
        "stairs",
      );
      box(
        stairMat,
        "stair-return-flight",
        x1 - 0.8,
        floor.height / 2 + h / 2,
        -0.18 - (8 - i + 0.5) * tread,
        1.25,
        h,
        tread,
        "stairs",
      );
    }
    box(
      stairMat,
      "stair-midlanding",
      (x0 + x1) / 2,
      floor.height / 2 - 0.07,
      -run - 0.55,
      x1 - x0,
      0.14,
      0.75,
      "stairs",
    );
    return 2 * Math.hypot(run, floor.height / 2) + (x1 - x0);
  }
  let currentFloor, currentObj;
  const landings = new Map();
  for (let fi = 0; fi < spec.floors.length; fi++) {
    const f = spec.floors[fi],
      clear = f.height - (spec.floors[fi + 1]?.slabThicknessM ?? 0),
      half = spec.width / 2,
      service = spec.serviceBayWidth,
      roomStart = -half + service,
      roomSpan = spec.width - 2 * service;
    currentFloor = doc
      .createNode(`floor_${f.index}`)
      .setTranslation([0, f.baseY, 0])
      .setExtras({ floor: f.index, estimated: true, label: f.label });
    scene.addChild(currentFloor);
    currentObj = new THREE.Group();
    currentObj.name = `floor_${f.index}`;
    currentObj.position.y = f.baseY;
    objScene.add(currentObj);
    floors.push({
      index: f.index,
      label: f.label,
      displayNumber: f.displayNumber,
      baseY: f.baseY,
      height: f.height,
      slabThicknessM: f.slabThicknessM,
      railings: f.railings,
    });
    const shape = new THREE.Shape();
    const outline = [
      [-half, -spec.roomDepth],
      [half, -spec.roomDepth],
      [half, spec.corridorDepth],
      [spec.projectionWidth / 2, spec.corridorDepth],
      [spec.projectionWidth / 2, spec.corridorDepth + spec.projectionDepth],
      [-spec.projectionWidth / 2, spec.corridorDepth + spec.projectionDepth],
      [-spec.projectionWidth / 2, spec.corridorDepth],
      [-half, spec.corridorDepth],
    ];
    outline.forEach(([x, z], i) =>
      i ? shape.lineTo(x, z) : shape.moveTo(x, z),
    );
    shape.closePath();
    if (service && fi > 0)
      for (const side of [-1, 1]) {
        const center = side * (half - 1.6),
          hole = new THREE.Path();
        [
          [center - 1.45, -3.23],
          [center + 1.45, -3.23],
          [center + 1.45, -0.15],
          [center - 1.45, -0.15],
        ].forEach(([x, z], i) => (i ? hole.lineTo(x, z) : hole.moveTo(x, z)));
        hole.closePath();
        shape.holes.push(hole);
      }
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: f.slabThicknessM,
      bevelEnabled: false,
      steps: 1,
    });
    geometry.rotateX(Math.PI / 2);
    add(geometry, slab, "floor-slab", [0, 0, 0], [1, 1, 1], [0, 0, 0, 1], {
      role: "slab",
    });
    const corridor = material(`corridor-${f.index}`, f.corridorColor);
    box(
      corridor,
      "corridor",
      0,
      0.014,
      spec.corridorDepth / 2,
      spec.width,
      0.025,
      spec.corridorDepth,
      "floor",
    );
    box(
      corridor,
      "central-landing",
      0,
      0.014,
      spec.corridorDepth + spec.projectionDepth / 2,
      spec.projectionWidth,
      0.025,
      spec.projectionDepth,
      "floor",
    );
    railing(
      -half,
      spec.corridorDepth,
      -spec.projectionWidth / 2,
      spec.corridorDepth,
    );
    railing(
      spec.projectionWidth / 2,
      spec.corridorDepth,
      half,
      spec.corridorDepth,
    );
    // User-confirmed fences close both corridor ends on every floor.
    railing(-half, 0, -half, spec.corridorDepth);
    railing(half, 0, half, spec.corridorDepth);
    // Ground-level entrance projections stay open; upper Ynares landings
    // have continuous rails around every exposed perimeter edge.
    if (f.railings === "full-perimeter") {
      railing(
        -spec.projectionWidth / 2,
        spec.corridorDepth,
        -spec.projectionWidth / 2,
        spec.corridorDepth + spec.projectionDepth,
      );
      railing(
        spec.projectionWidth / 2,
        spec.corridorDepth,
        spec.projectionWidth / 2,
        spec.corridorDepth + spec.projectionDepth,
      );
      railing(
        -spec.projectionWidth / 2,
        spec.corridorDepth + spec.projectionDepth,
        spec.projectionWidth / 2,
        spec.corridorDepth + spec.projectionDepth,
      );
    }
    const floorRooms = f.rooms.map((r) => {
      const x0 = roomStart + roomSpan * r.fraction[0],
        x1 = roomStart + roomSpan * r.fraction[1];
      return {
        ...r,
        id: `${spec.id}-f${f.index}-${r.id}`,
        floor: f.index,
        rect: [rounded(x0), -spec.roomDepth, rounded(x1), 0],
        doorXs:
          spec.id === "ynares" && x1 - x0 > 6
            ? [x0 + 1, x1 - 1]
            : [x0 + Math.min(1, (x1 - x0) / 2)],
      };
    });
    if (service)
      for (const [side, labelName, color] of [
        [-1, "Male Comfort Room", "#c0def3"],
        [1, "Female Comfort Room", "#f2d3df"],
      ]) {
        const x0 = side < 0 ? -half : half - service,
          x1 = side < 0 ? -half + service : half;
        floorRooms.push({
          id: `${spec.id}-f${f.index}-${side < 0 ? "male" : "female"}-cr`,
          label: labelName,
          kind: "toilet",
          color,
          floor: f.index,
          rect: [x0, -spec.roomDepth, x1, -3.4],
          doorXs: [side < 0 ? x1 - 0.85 : x0 + 0.85],
        });
      }
    const corridorXs = [
      0,
      ...floorRooms.filter((r) => r.kind !== "toilet").flatMap((r) => r.doorXs),
    ];
    if (service) corridorXs.push(-half + service - 0.85, half - service + 0.85);
    for (let x = -half + 0.4; x <= half - 0.4; x += 2) corridorXs.push(x);
    const xs = [...new Set(corridorXs.map(rounded))].sort((a, b) => a - b),
      corridorNodes = xs.map((x) => node(x, spec.corridorDepth / 2, f.index));
    for (let i = 1; i < corridorNodes.length; i++)
      link(corridorNodes[i - 1], corridorNodes[i]);
    const corridorAt = (x) => corridorNodes[xs.indexOf(rounded(x))];
    const center = corridorAt(0),
      lobby = node(
        0,
        spec.corridorDepth + spec.projectionDepth / 2,
        f.index,
        fi === 0 ? "Entrance lobby (assumed)" : "Central landing",
        "hallway",
      );
    link(center, lobby);
    if (fi === 0) {
      const entrance = node(
        0,
        spec.corridorDepth + spec.projectionDepth - 0.15,
        f.index,
        "Main entrance (assumed)",
        "entrance",
      );
      link(lobby, entrance);
      graph.exits.push(entrance);
    }
    await label(
      fi === 0 ? "ENTRANCE LOBBY" : "CENTRAL LANDING",
      0,
      spec.corridorDepth + spec.projectionDepth * 0.53,
      Math.min(5, spec.projectionWidth - 1),
      f.index,
      "lobby",
    );
    for (const r of floorRooms) {
      const [x0, z0, x1, z1] = r.rect,
        w = x1 - x0;
      box(
        material(`floor-${r.id}`, r.color),
        "room-floor",
        (x0 + x1) / 2,
        0.02,
        (z0 + z1) / 2,
        w,
        0.035,
        z1 - z0,
        "floor",
        r.id,
      );
      windows(x0, x1, z0, clear, r.id);
      box(
        wall,
        "partition",
        x0,
        clear / 2,
        (z0 + z1) / 2,
        0.15,
        clear,
        z1 - z0,
        "wall",
        r.id,
      );
      if (r === floorRooms[spec.floors[fi].rooms.length - 1])
        box(
          wall,
          "partition",
          x1,
          clear / 2,
          (z0 + z1) / 2,
          0.15,
          clear,
          z1 - z0,
          "wall",
          r.id,
        );
      frontWall(
        x0,
        x1,
        z1,
        r.doorXs,
        clear,
        r.id,
        r.kind === "toilet" ? 0.85 : 1.05,
      );
      const centerId = node(
          (x0 + x1) / 2,
          (z0 + z1) / 2,
          f.index,
          r.label,
          "room",
        ),
        doorNodes = [];
      for (const doorX of r.doorXs) {
        const d = node(doorX, z1, f.index, `${r.label} door`, "door");
        link(centerId, d);
        doorNodes.push(d);
        if (r.kind === "toilet") {
          const foyer = node(doorX, -1.7, f.index);
          link(d, foyer);
          link(foyer, corridorAt(doorX));
        } else link(d, corridorAt(doorX));
      }
      const out = {
        id: r.id,
        label: r.label,
        kind: r.kind,
        floor: f.index,
        rect: r.rect,
        doors: r.doorXs.map((x) => [rounded(x), z1]),
        nodeId: centerId,
        doorNodeIds: doorNodes,
        color: r.color,
        estimated: true,
      };
      rooms.push(out);
      furniture({ ...r });
      out.obstacles = obstacles.get(r.id) ?? [];
      await label(
        r.label,
        (x0 + x1) / 2,
        z0 + (z1 - z0) * 0.78,
        Math.min(w - 0.55, r.kind === "toilet" ? 3.8 : 5.6),
        f.index,
        r.id,
      );
    }
    for (const side of [-1, 1]) {
      box(
        wall,
        "side-wall",
        side * half,
        clear / 2,
        -spec.roomDepth / 2,
        0.15,
        clear,
        spec.roomDepth,
        "wall",
      );
      if (service) {
        const x0 = side < 0 ? -half : half - 3.2,
          x1 = x0 + 3.2;
        const landing = node(
          x0 + 0.8,
          -0.315,
          f.index,
          `${side < 0 ? "Left" : "Right"} stairwell`,
          "stairs",
        );
        const arrival = node(
          x1 - 0.8,
          -0.315,
          f.index,
          `${side < 0 ? "Left" : "Right"} stairwell landing`,
          "stairs",
        );
        const accessX =
          side < 0 ? -half + service - 0.85 : half - service + 0.85;
        link(landing, corridorAt(accessX));
        link(arrival, corridorAt(accessX));
        const key = side < 0 ? "left" : "right";
        if (landings.has(key)) {
          const prev = landings.get(key);
          link(prev.id, arrival, prev.distance);
        }
        if (fi < spec.floors.length - 1) {
          const distance = staircase(x0, x1, f);
          landings.set(key, { id: landing, distance });
        }
        await label(
          `${side < 0 ? "LEFT" : "RIGHT"} STAIRS`,
          (x0 + x1) / 2,
          0.43,
          2.6,
          f.index,
          `${key}-stairs`,
        );
      }
    }
  }
  await doc.transform(
    dedup(),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
  );
  await fs.mkdir("public/models", { recursive: true });
  await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder })
    .write(`public/models/${spec.id}-rooms.glb`, doc);
  objScene.updateMatrixWorld(true);
  await fs.writeFile(
    `public/models/${spec.id}-rooms.obj`,
    `# Estimated reconstruction from supplied room plan\nmtllib ${spec.id}-rooms.mtl\n` +
      new OBJExporter().parse(objScene),
  );
  await fs.writeFile(`public/models/${spec.id}-rooms.mtl`, mtl.join("\n"));
  await fs.mkdir("public/graphs", { recursive: true });
  await fs.writeFile(
    `public/graphs/${spec.id}-rooms.json`,
    JSON.stringify(graph, null, 2),
  );
  const metadata = {
    buildingId: spec.id,
    revision: manifest.revision,
    sourcePlan: manifest.sourcePlan,
    estimated: true,
    dimensions: {
      width: spec.width,
      roomDepth: spec.roomDepth,
      corridorDepth: spec.corridorDepth,
      projectionWidth: spec.projectionWidth,
      projectionDepth: spec.projectionDepth,
    },
    heightSource: spec.heightSource,
    assumptions: manifest.assumptions,
    floors,
    rooms,
  };
  await fs.writeFile(
    `public/models/${spec.id}-rooms.json`,
    JSON.stringify(metadata, null, 2),
  );
  const configPath = `public/models/${spec.id}.json`,
    config = JSON.parse(await fs.readFile(configPath, "utf8"));
  config.heightSource = spec.heightSource;
  config.scanGlb = config.scanGlb ?? config.glb;
  config.glb = `/models/${spec.id}-rooms.glb`;
  config.graph = `/graphs/${spec.id}-rooms.json`;
  config.modelKind = "room-layout";
  config.modelRevision = manifest.revision;
  config.planImage = manifest.sourcePlan;
  config.rooms = rooms;
  config.layoutDimensions = metadata.dimensions;
  config.assumptions = manifest.assumptions;
  config.floors = floors;
  config.modelVerified = false;
  config.floorsVerified = false;
  config.graphVerified = false;
  config.georef = null;
  config.graphToModel = { dx: 0, dz: 0, rotationDeg: 0, scale: 1 };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const archive = {};
  for (const ext of ["glb", "obj", "mtl", "json"]) {
    const name = `${spec.id}-rooms.${ext}`;
    archive[name] = new Uint8Array(await fs.readFile(`public/models/${name}`));
  }
  for (const name of await fs.readdir(`public/models/${spec.id}-room-textures`))
    archive[`${spec.id}-room-textures/${name}`] = new Uint8Array(
      await fs.readFile(`public/models/${spec.id}-room-textures/${name}`),
    );
  archive["ESTIMATED-MODEL-NOTES.txt"] = strToU8(
    `${spec.name}\nEstimated room reconstruction from supplied floor plan.\n\n${manifest.assumptions.join("\n")}\n\n${spec.heightSource}\nOverall width: ${spec.width}m (estimated).\nUse the GLB for a single file with embedded labels/materials. Keep OBJ, MTL and texture folder together.\n`,
  );
  archive["source-floor-plan.png"] = new Uint8Array(
    await fs.readFile("public/plans/campus-floor-plan.png"),
  );
  await fs.writeFile(
    `public/models/${spec.id}-rooms-bundle.zip`,
    zipSync(archive, { level: 6 }),
  );
  reports.push({
    buildingId: spec.id,
    rooms: rooms.length,
    floors: floors.length,
    nodes: Object.keys(graph.nodes).length,
    glbBytes: (await fs.stat(`public/models/${spec.id}-rooms.glb`)).size,
    estimated: true,
  });
  console.log(JSON.stringify(reports.at(-1)));
}
await fs.writeFile(
  "reports/room-reconstruction.json",
  JSON.stringify(reports, null, 2),
);
