/** Repeatable non-destructive OBJ/PLY -> meshopt GLB. Original scans are never written.
 * Set surveyed upAxis, metersPerUnit, origin and floor intervals in the manifest.
 * Without verified floors the entire scan is explicitly named unassigned_scan.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { BufferGeometry, BufferAttribute } from "three";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import {
  weld,
  simplify,
  dedup,
  prune,
  meshopt,
} from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { clipTriangleToFloor } from "./model-geometry.mjs";

await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const manifest = JSON.parse(
  await fs.readFile(process.argv[2] ?? "scripts/model-manifest.json", "utf8"),
);
const only = process.argv[3];
const results = [];
for (const spec of manifest.models.filter((s) => !only || s.id === only)) {
  const started = performance.now();
  const doc = new Document(),
    buffer = doc.createBuffer(),
    scene = doc.createScene(spec.id);
  let material = doc
    .createMaterial()
    .setDoubleSided(true)
    .setRoughnessFactor(1)
    .setMetallicFactor(0)
    .setBaseColorFactor([0.72, 0.76, 0.8, 1]);
  if (spec.texture) {
    const bytes = await sharp(spec.texture)
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
    doc.createExtension(EXTTextureWebP).setRequired(true);
    const texture = doc
      .createTexture()
      .setImage(bytes)
      .setMimeType("image/webp");
    material.setBaseColorTexture(texture).setBaseColorFactor([1, 1, 1, 1]);
  }
  const data = await fs.readFile(spec.source);
  const geometries = [];
  if (path.extname(spec.source).toLowerCase() === ".ply") {
    geometries.push(
      new PLYLoader().parse(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      ),
    );
  } else {
    const object = new OBJLoader().parse(data.toString("utf8"));
    object.traverse((child) => {
      if (child.isMesh) geometries.push(child.geometry);
    });
  }
  let originalTriangles = 0;
  for (const source of geometries) {
    const geometry = source.index ? source.toNonIndexed() : source;
    const position = geometry.getAttribute("position"),
      normal = geometry.getAttribute("normal"),
      uv = geometry.getAttribute("uv");
    originalTriangles += position.count / 3;
    const buckets = new Map();
    for (let i = 0; i < position.count; i += 3) {
      const positions = [],
        normals = [],
        uvs = [];
      for (let j = 0; j < 3; j++) {
        let p = [
          position.getX(i + j),
          position.getY(i + j),
          position.getZ(i + j),
        ];
        let n = normal
          ? [normal.getX(i + j), normal.getY(i + j), normal.getZ(i + j)]
          : null;
        if (spec.upAxis === "Z") {
          p = [p[0], p[2], -p[1]];
          if (n) n = [n[0], n[2], -n[1]];
        }
        if (spec.upAxis === "X") {
          p = [-p[1], p[0], p[2]];
          if (n) n = [-n[1], n[0], n[2]];
        }
        p = p.map((v, k) => (v - spec.origin[k]) * spec.metersPerUnit);
        positions.push(...p);
        if (n) normals.push(...n);
        if (uv) uvs.push(uv.getX(i + j), 1 - uv.getY(i + j));
      }
      const add = (name, p, n, uv) => {
        if (!buckets.has(name))
          buckets.set(name, { positions: [], normals: [], uvs: [] });
        const bucket = buckets.get(name);
        bucket.positions.push(...p);
        bucket.normals.push(...n);
        bucket.uvs.push(...uv);
      };
      if (!spec.floors.length) add("unassigned_scan", positions, normals, uvs);
      else {
        const vertices = [0, 1, 2].map((j) => ({
          p: positions.slice(j * 3, j * 3 + 3),
          n: normals.length ? normals.slice(j * 3, j * 3 + 3) : null,
          uv: uvs.length ? uvs.slice(j * 2, j * 2 + 2) : null,
        }));
        for (const floor of spec.floors)
          for (const triangle of clipTriangleToFloor(
            vertices,
            floor.baseY,
            floor.height,
          ))
            add(
              `floor_${floor.index}`,
              triangle.flatMap((v) => v.p),
              triangle.flatMap((v) => v.n ?? []),
              triangle.flatMap((v) => v.uv ?? []),
            );
      }
    }
    for (const [name, b] of buckets) {
      const primitive = doc.createPrimitive().setMaterial(material);
      primitive.setAttribute(
        "POSITION",
        doc
          .createAccessor()
          .setType("VEC3")
          .setArray(new Float32Array(b.positions))
          .setBuffer(buffer),
      );
      if (b.normals.length && spec.texture)
        primitive.setAttribute(
          "NORMAL",
          doc
            .createAccessor()
            .setType("VEC3")
            .setArray(new Float32Array(b.normals))
            .setBuffer(buffer),
        );
      if (b.uvs.length && spec.texture)
        primitive.setAttribute(
          "TEXCOORD_0",
          doc
            .createAccessor()
            .setType("VEC2")
            .setArray(new Float32Array(b.uvs))
            .setBuffer(buffer),
        );
      const mesh = doc.createMesh(name).addPrimitive(primitive);
      scene.addChild(
        doc
          .createNode(name)
          .setMesh(mesh)
          .setExtras({
            units: spec.verified ? "meters" : "unverified scan units",
          }),
      );
    }
  }
  await doc.transform(
    weld(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: Math.min(1, (spec.targetTriangles ?? 280000) / originalTriangles),
      error: 0.01,
      lockBorder: false,
    }),
    dedup(),
    prune(),
  );
  // Keep indexed geometry: flat-normal generation unwelds every triangle,
  // increasing download size and GPU vertex work. Preserve supplied normals;
  // generate smooth area-weighted normals only for an untextured scan.
  for (const mesh of doc.getRoot().listMeshes())
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getAttribute("NORMAL")) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new BufferAttribute(
          new Float32Array(primitive.getAttribute("POSITION").getArray()),
          3,
        ),
      );
      const indices = primitive.getIndices();
      if (indices)
        geometry.setIndex(
          new BufferAttribute(new Uint32Array(indices.getArray()), 1),
        );
      geometry.computeVertexNormals();
      primitive.setAttribute(
        "NORMAL",
        doc
          .createAccessor()
          .setType("VEC3")
          .setArray(new Float32Array(geometry.getAttribute("normal").array))
          .setBuffer(buffer),
      );
      geometry.dispose();
    }
  const triangles = doc
    .getRoot()
    .listMeshes()
    .reduce(
      (s, m) =>
        s +
        m
          .listPrimitives()
          .reduce(
            (n, p) =>
              n +
              (p.getIndices()?.getCount() ??
                p.getAttribute("POSITION").getCount()) /
                3,
            0,
          ),
      0,
    );
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
  const out = `public/models/${spec.id}.glb`;
  await fs.mkdir(path.dirname(out), { recursive: true });
  await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder })
    .write(out, doc);
  const bytes = (await fs.stat(out)).size;
  const result = {
    id: spec.id,
    originalTriangles,
    triangles,
    bytes,
    conversionSeconds: (performance.now() - started) / 1000,
    verified: spec.verified,
    withinBudget: triangles < 300000 && bytes < 25000000,
  };
  results.push(result);
  console.log(JSON.stringify(result));
  if (!result.withinBudget) process.exitCode = 2;
}
await fs.mkdir("reports", { recursive: true });
await fs.writeFile(
  `reports/model-conversion${only ? "-" + only : ""}.json`,
  JSON.stringify(results, null, 2),
);
