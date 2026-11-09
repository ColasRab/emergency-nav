# Emergency Wayfinder

Indoor navigation for the Admin and Ynares buildings, with 3D scan previews, surveyed QR positioning, speech guidance and floor-scoped hazard routing.

## Reconstructed rooms from the supplied floor plan

The app now opens estimated room models for Admin and all three Ynares floors. Room cards and 3D labels reproduce the supplied plan; use **Original scan** for comparison, the floor selector for each level, and **Show all floors** for the full Ynares building. Rooms include illustrative furniture, doors, windows, corridors and the end stairwells shown in the plan. The original scans remain unchanged.

Ynares uses the user's measured floor heights. Horizontal dimensions, Admin's height, doorway positions and the central entrance are explicitly estimated. Download a self-contained GLB or a complete OBJ/material/texture ZIP from **Dimensions and assumptions** below the room cards. Regenerate models and their preview graphs with `npm run models:rooms`; edit `scripts/room-layouts.json` to change the assumptions. Regeneration resets geographic placement and verification fields.

See [the reconstruction report](reports/room-reconstruction.md) for room lists, dimension assumptions, exports and validation. The older scan graph is retained as `public/nav_graph.json`; the active app now uses the estimated room-model graphs in `public/graphs/`.

**Current status:** the software is implemented and tested locally. The supplied scans and existing graph are **not surveyed deployment data**. Real floor elevations, measured scale, control points, actual exits and QR placements must be verified before using the app for physical guidance. Follow official evacuation signs and staff instructions.

## Run locally

Use Node.js 24 or a compatible maintained Node release.

```powershell
npm install
npm run dev
```

Open [the app](http://localhost:3000). A production build uses `npm run build` followed by `npm run start`. Camera and motion access on a phone require HTTPS. Permissions are requested from buttons; manual location selection and text directions remain available when sensors are unavailable.

The project now uses Next.js 16, React 19, TypeScript strict mode, Mapbox GL JS 3 and three.js. The framework and test dependencies were updated after the original versions failed the dependency audit.

## Building setup

- `/admin/alignment`: inspect scans, fit at least three non-collinear ground control points, fit graph/model correspondences, edit measured floor data, and export building configuration.
- `/admin/anchors`: raycast wall anchors, check wall normals and mount heights, export `anchors.json`, download sticker PNGs, printable sheets and a placement checklist.
- `/admin/hazards`: review, confirm, dismiss and expire hazards; persistent closures require the server's admin access token.

Browser setup changes are drafts stored on that device. Export the reviewed files to `public/models/admin.json`, `public/models/ynares.json` and `public/models/anchors.json` for deployment. Keep the configuration IDs and graph paths building-specific.

Admin's OBJ and PLY are alternate exports of the **Admin Building**. The larger OBJ in `C:/Users/colas/Documents/emergency-navigation` is **Ynares**. Its original material and texture were not supplied, so the scan-reference view is untextured. Reconstructed rooms use separate estimated geometry and their own colors/labels. Real building coordinates, exits and QR anchors still require a physical survey; the central entrance in the reconstructed preview is explicitly assumed.

`lib/geo/transform.ts` contains runtime coordinate conversions. In a right-handed Y-up model, `rotationDeg = 0` maps model +Z to north and +X to west; a positive geographic rotation turns +Z clockwise from north. Graph-to-model rotation is documented in that module. Use the alignment preview to verify the fitted orientation.

## Model pipeline

Original scans remain unchanged. The manifest records their actual local paths and explicit texture selection:

```powershell
npm run models:prepare
```

Edit `scripts/model-manifest.json` with the **measured** source up axis, meters per unit, origin and floor intervals. Match these settings when generating a graph. With no surveyed floors, the preview is named `unassigned_scan`. With floor intervals supplied, triangles are clipped at slab boundaries with interpolated UVs and normals, then exported as `floor_0`, `floor_1`, etc. The renderer shows the active floor, fades lower floors and hides upper floors.

The pipeline preserves Admin's UV atlas, converts its texture to WebP, simplifies geometry within a configured error bound and uses meshopt compression. Small scan fragments and holes still require human inspection; no automatic cleanup is treated as a structural survey. Source assets provide the full-resolution archive.

See `reports/asset-inspection.json`, `reports/phase-0-findings.md` and `reports/model-conversion.json`. Use at least three matched model/lng-lat points per building; target fit RMS below 1.5 m, and recheck points if RMS exceeds 3 m. Mapbox rendering follows the [official custom 3D model example](https://docs.mapbox.com/mapbox-gl-js/example/add-3d-model/).

## Python JSON maker

The existing `main.py`, `tools.py`, OBJ and JSON in `C:/Users/colas/Documents/emergency-navigation` were preserved. A new `make_building_graph.py` and `survey-admin.example.json` were added alongside them. The repository copies live under `scripts/`.

Ynares measurements are now recorded in `public/models/ynares-measurements.json`. Its `survey-ynares.example.json` is available in both `scripts/` and the Python folder. Confirmed floor-to-floor spans are 3.095, 3.05 and 2.84 m; relative walking surfaces are 0, 3.095 and 6.145 m. The 0.36/0.17/0.16 m slab thicknesses are already included and must not be added again. Scan origin, up axis and scale still require matching to actual floor surfaces.

Fill a copy of the survey template with measured scale, floor elevations, exits, unique zone locations and stair landing connections. Coordinates use the same normalized model space as the GLB pipeline. Example:

```powershell
& 'C:/Users/colas/Documents/emergency-navigation/.venv/Scripts/python.exe' scripts/build_graph.py scripts/survey-admin.json --out public/graphs/admin.json
```

Then set the building's `graph` to `/graphs/admin.json`. The template intentionally contains null measurements and no exits; running it unchanged fails instead of generating fictional exits. The maker exports `[x, z, floor]`, retains disconnected regions for inspection, prevents diagonal shortcuts through blocked grid corners, adds measured stair connectors, and writes an adjacent inspection report. Review unreachable nodes and walk all routes before setting `graphVerified`.

For an older two-coordinate graph, `scripts/import_graph.py` requires an explicit `--floor`. Importing does not certify its exits, scale or topology. The original Python folder's JSON has no zone labels and a placeholder exit; do not deploy it directly.

## Supabase hazards

The supplied Mapbox and Supabase settings are stored in ignored `.env.local`. See `.env.example` for names. The server secret is used only in API routes. Never copy it into a `NEXT_PUBLIC_` variable. `HAZARD_ADMIN_TOKEN` is a separate generated local secret; enter its value in the hazard admin form when making persistent closures. It is not saved by that form.

The supplied project has been initialized with `supabase/migrations/001_hazards.sql`. For another project, run that migration in its SQL editor and enable the same environment settings. It supplies read-only public access, server-only writes, private deduplicated votes and Realtime publication. The app also polls every four seconds and stores pending reports locally for reconnection. An offline retry retains the original expiry and cannot overwrite an existing record. Admin credentials are excluded from the offline queue.

```powershell
node --env-file=.env.local scripts/check-supabase.mjs --realtime
```

Crowd scanning uses COCO-SSD after temporal confirmation. **Fire/smoke detection is not enabled without validated trained weights.** A TF.js adapter is provided in `lib/hazards/detectors.ts`; configure compatible named outputs and supply it to `HazardScanner`. Fire, smoke, blocked doors, spills and debris can be reported manually. No camera frames or report photos are uploaded. Shared reports and route costs are scoped to building and floor; a stair closure affects its connector in both directions.

Severity multipliers, TTLs, scan thresholds, QR sizes, FOV and voice distances are in the per-building settings. Hard automatic blocks require explicit confirmation; one camera frame cannot close a route. The blocked-everywhere case is clearly labeled as an unsafe-to-assume fallback, and directional/voice maneuver guidance pauses. Campus/public access policy and stronger abuse controls must be decided before public launch.

## QR and voice

Payloads use `NAV1|anchorId`; legacy zone labels remain approximate and never calibrate heading. A surveyed scan estimates the camera's offset from the sticker, rejects poor geometry/blur/motion, requires three agreeing frames, and checks implausible jumps. Measure the black code symbol, excluding its white quiet zone. Calibrate the rear camera at a measured 1.0 m. A printed sheet must preserve the stated symbol width and at least four white modules of border.

Enable the compass before scanning to estimate heading offset. Step tracking increases uncertainty, and stair progress requires a fresh QR on the new floor. Anchor arrival disagreements are logged locally and repeated disagreement is flagged for re-survey. Accuracy values are estimates until field-validated.

Voice uses device speech with English and Filipino phrase templates under `lib/voice/phrases/`. The requested external voice folder has not yet been supplied. Device language availability varies; captions, mute and repeat controls remain available. The camera arrow and voice consume the same next maneuver. Real iOS Safari and Android Chrome speech, compass, motion and QR behavior still require on-device tests.

## Checks and field validation

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
& 'C:/Users/colas/Documents/emergency-navigation/.venv/Scripts/python.exe' tests/test_graph_maker.py
python scripts/validate-position.py reports/checkpoint-template.csv
```

Browser checks use installed Microsoft Edge and port 3010. They cover building changes, a two-session shared API simulation, offline reload, mobile overflow, setup pages, the live Supabase read endpoint and local scan rendering. They do not create fake hazards in the live database.

Fill at least ten measured checkpoints per building in `reports/checkpoint-template.csv`, using meters in one common frame and true-north headings. The validation script reports median, 95th percentile and heading errors. Empty template rows are not measurements. Targets: median position error <0.5 m, 95th percentile <1.5 m, and heading error <8 degrees. Review `reports/final-implementation-report.md` for what was tested and what remains unverified.
