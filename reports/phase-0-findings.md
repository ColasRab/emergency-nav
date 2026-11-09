# Indoor navigation inspection — 9 November 2026

## Assets inspected before conversion

| Source | Size | Vertices | Triangles | Raw XYZ extent | Texture |
| --- | ---: | ---: | ---: | --- | --- |
| `D:/Download/Admin buo/3DModel.obj` | 12,742,488 B | 49,412 | 97,788 | 19.397 × 2.735 × 4.273 | 2048 × 2048, MTL present |
| `D:/Download/Admin buo/AdvancedExport/3DModel_Custom.ply` | 8,945,317 B | 97,165 | 78,578 | 19.297 × 4.194 × 2.673 | 4096 × 4096, vertex UVs present |
| `C:/Users/colas/Documents/emergency-navigation/3DModel.obj` | 286,891,783 B | 989,689 | 1,971,338 | 5.405 × 4.677 × 13.663 | referenced MTL and JPG absent in this folder |

All coordinates are **unverified scan units**. The two small exports have similar extents after swapping Y and Z; this suggests alternate exports of one scan, not proof of two buildings. Their UV data exists; a render is still needed to verify appearance. The PLY header references `3DModel.jpg`, whereas its adjacent supplied image is `3DModel_Custom.jpg`; the conversion manifest must explicitly select the texture.

`asset-inspection.json` records bounding boxes, UV counts, material existence and an area-weighted 0.1-unit Y-height histogram of near-horizontal triangles. OBJ Y-up is a working hypothesis. PLY appears to have a different up axis. Height peaks are scan observations, **not confirmed storeys**: walls, stairs, furniture and noise can contribute. No measured dimension, surveyed floor height or georeference was supplied.

## Code and graph findings

- Read all existing components, `lib/astar.ts`, `lib/calibration.ts`, and `lib/stairMotionDetector.ts`.
- The app graph has 1,524 nodes, 10,586 directed edges, floors 0/1/2 and two exit IDs. Node coordinates are `[x, z, floor]`. No edges reference missing nodes. Building, units and real exit locations are unverified. Its footprint covers only about 1.3 × 7.3 scan units, much smaller than either full scan.
- The Python folder contains `main.py`, `tools.py`, its environment and the larger OBJ. Its existing graph has 393 nodes, 2,628 directed edges, **two-coordinate nodes**, no zone labels and a placeholder exit. Copying it directly into this app would break the floor contract.
- `main.py` extracts one dominant floor band, keeps only the largest walkable island, and auto-picks an exit. It cannot establish real emergency exits, multiple floors or stair connections without a survey configuration. The README names older Python scripts that do not exist in the supplied folder.
- Current QR scans snap to a label's first node and request indoor GPS. Camera direction targets the final exit. Duplicate labels are not floor-aware; OCR substring matching confuses room numbers. Crowd updates expire only when replaced. No Mapbox, shared hazard backend, surveyed anchors, QR pose estimation or voice system is present.
- Motion variance confirms an expected stair segment, but does not independently establish a floor. Physical validation is required.

## Implementation decisions

Keep original scans and the external Python project unchanged. Add repeatable inspection/conversion/import tools inside this repository. Do not assign an unknown scan to Ynares, invent ground control points, certify floor elevations, or call an automatically selected node a surveyed exit. Allow local model inspection independently of Mapbox. Keep map placement and accurate anchor guidance gated on verified configuration.

Default implementation: building-scoped configuration, one spatial transform module, English/Filipino phrase files, and a Next.js/Postgres hazard adapter with explicit local offline behavior. These defaults can be changed when the user's pending choices arrive. COCO-SSD supplies crowd detections only; no fire/smoke detection is claimed without compatible trained weights.

## Outstanding field inputs

1. Confirm building identity and coordinate frames for each source.
2. Confirm floor elevations, heights, scan scale and actual exits/stair connections.
3. Provide a Mapbox public token and at least three non-collinear matched GCPs per building; supply graph/model point correspondences too.
4. Choose shared hazard backend, audience and account policy; configure credentials.
5. Survey QR wall positions/normals and physical printed size; perform device camera calibration.
6. Conduct checkpoint accuracy and real phone performance tests. Automated checks cannot establish physical positioning accuracy or emergency readiness.

## Reproduce inspection

```powershell
& 'C:/Users/colas/Documents/emergency-navigation/.venv/Scripts/python.exe' scripts/inspect_assets.py 'D:/Download/Admin buo/3DModel.obj' 'D:/Download/Admin buo/AdvancedExport/3DModel_Custom.ply' 'C:/Users/colas/Documents/emergency-navigation/3DModel.obj' --graph public/nav_graph.json --graph 'C:/Users/colas/Documents/emergency-navigation/nav_graph.json' --out reports/asset-inspection.json
```
