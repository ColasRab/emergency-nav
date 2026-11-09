# Indoor navigation implementation — 9 November 2026

Software implementation is complete for the available inputs. **Field commissioning remains incomplete:** the supplied models, floor elevations, exits, graph alignment and QR positions have not been surveyed. The app labels this state and does not invent geographic placement.

## Delivered

| Area | Implemented | Still requires physical or external input |
| --- | --- | --- |
| Assets and coordinates | Repeatable OBJ/PLY inspection; WebP/meshopt GLB pipeline; measured scale/up-axis settings; true slab clipping; shared model/graph/geographic transforms; residual-reporting GCP fit | Confirm model scale/up axis and floor elevations; inspect debris/holes and coverage; provide at least three GCPs per building and graph/model correspondences |
| Mapping | Client-only Mapbox custom layer; viewport-based model loading; floor visibility; graph, route, exit, anchor, user and hazard overlays; independent scan preview; alignment workspace | Actual satellite placement and route/wall alignment cannot be accepted without the survey; previews are unsplit until verified floor data is supplied and conversion rerun |
| QR positioning | Wall raycast survey, versioned payload, printable PNG/sheets/checklist; homography pose; camera focal calibration; size/angle/blur/motion gates; three-frame agreement; legacy floor-aware label fallback | Survey real sticker centers, normals and code sizes; measure camera calibration; validate lens distortion and device behavior |
| Position tracking | Circular heading fusion, jump rejection with explicit relocation override, step tracking with increasing uncertainty, planned stair progress with a required new-floor QR, local anchor disagreement flags | Walk at least ten surveyed checkpoints per building; verify stair and step thresholds on actual phones |
| Guidance | Shared next-maneuver object for arrow and speech; turn/stair/door/entrance/exit maneuvers; distance triggers; priorities, queue/de-duplication, mute/repeat/volume/language/voice controls; captions and vibration | The requested downloaded voice folder was not supplied; English/Filipino device speech is implemented. iOS Safari and Android Chrome testing remains outstanding |
| Hazards | Next.js API plus configured Supabase; read-only public RLS; server-only writes; private unique votes; confirmed hard blocks; building/floor scope and stair connectors; decay, TTL, hysteresis; explicit blocked fallback; Realtime plus four-second polling; offline queue; administration | Decide campus/public account and abuse policy before public launch; install and validate trained fire/smoke weights to enable that detector |
| Graph maker | Added `make_building_graph.py` and survey template to the supplied Python folder; uses existing utilities; exports `[x,z,floor]`; prevents diagonal corner shortcuts, preserves regions and adds measured stair links | Admin needs its surveyed graph. Existing Ynares graph is retained only as an unverified preview. Original Python JSON has a placeholder exit and no zone labels |

No camera images are uploaded. Fire/smoke detection is **not claimed** from COCO-SSD. Camera scanning supplies crowd observations after temporal agreement; other hazards can be reported manually. The blocked fallback is labeled and maneuver guidance pauses.

## Verification

- TypeScript strict checks pass.
- **36 automated TypeScript tests pass** across transforms, floor mesh clipping, QR geometry and quality, token matching, position uncertainty, motion steps, A* costs and hysteresis, hazard scope/TTL, API validation/idempotence/admin authorization, instruction triggers and speech priority/queue behavior.
- **2 Python tests pass** using synthetic geometry: multi-floor schema and symmetric stair connections, no disconnected cells from decimal grid rounding, and rejection of unmeasured templates.
- **6 production-browser checks pass** in Microsoft Edge: both scans and building reset, two independent sessions sharing a simulated API report within five seconds, offline reload, setup/mobile layout, the live Supabase read endpoint plus invalid-write rejection, and rendering measurements. No fake hazards were added to the live database.
- Next.js production build passes. Dependencies were updated to Next.js 16.4.5, React 19 and Vitest 5.1.0; the final dependency audit reports **zero known vulnerabilities**.
- Live Supabase REST read returned HTTP 200. The live public Realtime subscription returned `SUBSCRIBED`. Cross-device production write latency has not been physically tested; the five-second browser assertion uses a shared API simulation.
- Mobile screenshot was visually reviewed at 390 px width; no horizontal overflow. Admin's textured scan and Ynares's untextured geometry both render.

## Asset and local rendering measurements

| Building | Source triangles | Web triangles | GLB size | Local preview load | Local rendering |
| --- | ---: | ---: | ---: | ---: | ---: |
| Admin | 97,788 | 97,788 | 2,554,364 B | 0.3 s | 23.5 fps |
| Ynares | 1,971,338 | 99,949 | 426,548 B | 0.1 s | 25.0 fps |

Both assets satisfy the file/triangle budget. Rendering was measured over two seconds in **headless Windows Edge with software graphics, loading from localhost**. These frame rates are below 30 fps in that environment. They do not establish the requested 30 fps on a mid-range Android phone, nor a five-second load over 4G; those acceptance criteria remain open. Ynares's missing material/texture is represented by a plain surface. Original high-resolution sources were preserved.

## Remaining commissioning work

1. Enter measured source transforms and floor intervals in the model manifest, rebuild both models, and supply real Admin/Ynares graph data, stairs and exits. Review geometry coverage and the generated connectivity report.
2. Fit and export building configurations with real GCPs and graph/model matches. Recheck per-point residuals; target RMS <1.5 m and investigate RMS >3 m. Confirm overlays against walls on each floor.
3. Survey and print anchors, verify their actual symbol width and wall-facing normals, and calibrate the camera at 1.0 m. Export final anchor data to the application.
4. Fill `checkpoint-template.csv` with actual meter-based measurements and run `scripts/validate-position.py`. The current field report correctly records zero observations and does not pass. Required targets: median <0.5 m, 95th percentile <1.5 m, heading error <8°.
5. Complete phone/browser, 4G, speech and live two-device hazard tests. Supply the downloaded voice files and validated fire/smoke detector if those features are desired.

Keys are in ignored `.env.local`; the service secret is server-only. The separate generated admin access token is also stored there. Browser configuration and anchor drafts must be exported and deployed; browser drafts do not update shared server files.

## Evidence

- `asset-inspection.json`, `phase-0-findings.md`, `model-conversion.json`
- `browser-results.json`, `local-rendering.json`, `dependency-audit.json`
- `preview-mobile.png`, `preview-desktop.png`
- `checkpoint-template.csv`, `field-validation.json`

Reference implementations: [Mapbox custom 3D model layer](https://docs.mapbox.com/mapbox-gl-js/example/add-3d-model/), [glTF Transform simplification](https://gltf-transform.dev/modules/functions/functions/simplify), [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

