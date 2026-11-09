# Room model reconstruction — 9 November 2026

Both buildings have been recreated from the supplied campus floor-plan image using the user's requested general assumptions. The room models are **illustrative reconstructions**, with the original scan GLBs retained separately for comparison. They are not fitted or georeferenced to the scans.

Fence revision v2: the user's red/green annotations confirm fenced corridor ends and an unfenced central entrance projection for Admin and Ynares's 1st floor. Ynares's 2nd and 3rd floors retain continuous railing coverage around all exposed walkway edges, including both corridor ends and all three sides of the projecting landing. GLB, OBJ and ZIP exports have been regenerated with this layout.

## Spaces reproduced

| Building / floor | Named rooms | Other modeled spaces |
| --- | --- | --- |
| Admin, ground floor | Stock Room, Euler, Admin Office, SHS Com Lab, Computer Lab, IT Hub | Front corridor and central entrance lobby |
| Old Ynares, 1st floor | Science Laboratory, Curie, Faculty Room, Clinic | Male/female comfort rooms, both end stairwells, corridor, entrance lobby |
| Old Ynares, 2nd floor | Rutherford, Marsden, Franklin | Male/female comfort rooms, both end stairwells, corridor, central landing |
| Old Ynares, 3rd floor | Darwin, 21st CLEM | Male/female comfort rooms, both end stairwells, corridor, central landing |

Colors follow the supplied plan. The model includes partition walls, open doorways with frames, rear windows, floor slabs, railings and illustrative furniture. Ynares includes two flights of stairs at each end between floors, with openings in the upper slabs. The roof is omitted for inspection.

## Dimensions

| Dimension | Admin | Ynares | Status |
| --- | ---: | ---: | --- |
| Wing width | 36 m | 32 m | Estimated; diagram has no scale |
| Room-row depth | 4.6 m | 5.6 m | Estimated |
| Corridor depth | 2 m | 2 m | Estimated |
| Central projection | 10.8 × 4.5 m | 10.7 × 4.5 m | Estimated |
| Floor-to-floor heights | 3 m | 3.095 / 3.05 / 2.84 m | Admin estimated; Ynares supplied and confirmed by user |
| Walking elevations | 0 m | 0 / 3.095 / 6.145 m | First-floor walking surface is the relative datum |
| Slab thicknesses | 0.18 m | 0.36 / 0.17 / 0.16 m | Admin estimated; Ynares supplied by user |

Ynares slabs are already included in the reported floor-to-floor spans; they are not added twice. Room widths follow the image's room order and approximate proportions. Door/window dimensions, furnishings, stair details, wall thickness and the interpretation of the central projection are assumptions. Ground level outside the buildings, compass orientation, surveyed exits and geographic placement are unknown.

## Files and regeneration

- Layout source: `scripts/room-layouts.json`.
- Generator: `npm run models:rooms` (`scripts/reconstruct-rooms.mjs`).
- Embedded, self-contained models: `public/models/admin-rooms.glb` and `ynares-rooms.glb`.
- Editable mesh exports: matching `*-rooms.obj` and `*-rooms.mtl`, with `*-room-textures/` label images.
- Complete download bundles: `admin-rooms-bundle.zip` and `ynares-rooms-bundle.zip`, containing GLB, OBJ, MTL, texture folder, model metadata, source image and assumption notes.
- Room metadata: `public/models/admin-rooms.json` and `ynares-rooms.json`.
- Estimated preview graphs: `public/graphs/admin-rooms.json` and `ynares-rooms.json`.
- Source plan copy: `public/plans/campus-floor-plan.png`.

Both exported OBJ files have their world transforms applied, including all three Ynares floor elevations. The original scan files at `/models/admin.glb` and `/models/ynares.glb`, and all original OBJ/PLY assets, remain unchanged. The original `nav_graph.json` is also preserved as a legacy asset.

Regenerating the reconstruction replaces its estimated assets, building configuration and room graphs, and clears survey verification/georeference fields. Edit the layout source when replacing assumptions with measurements. The Python scan graph maker remains available for scan-based surveys; the room-model graphs are generated directly from room/door/corridor geometry.

## App behavior

- Room model is the default view, with a switch to the original scan. Room/route overlays are hidden in scan-reference mode because its coordinates are separate.
- Select ground/1st/2nd/3rd floors, show full walls or cutaway walls, switch between top-down and angled views, or show the complete Ynares building.
- Room cards and model clicks select and outline a room without claiming the user's physical location. Approximate location selection remains a separate action.
- Room labels, reported floor names and voice stair floor numbers use the building's displayed floor numbering.
- New preview graphs pass through modeled doorway openings and use both end stairs. Cross-floor connections are inside the stairwell cutouts. Their only route destination is the clearly labeled **assumed central entrance**; no verified emergency exit is asserted.
- Room graph node IDs use a new range to avoid attaching legacy scan-node hazards to unrelated reconstructed rooms.
- Older scan-alignment browser drafts are archived locally when the model revision changes, rather than applied to the new room model.

## Starting inside a room

Select a room card, then choose a preset such as Marsden's **Back right**, tap a custom point, or enter distances from the left and back walls. **Use this starting point** places the user dot at that point in the model and opens the camera guide. Room selection by itself still only highlights the room.

The generator exports furniture footprints from the same box geometry used by the GLB. A temporary visibility graph routes around those footprints with 0.25 m clearance and keeps 0.325 m from walls. It connects to each reachable door and then uses the existing corridor/stair graph. Old room-center edges are removed from the selected room's temporary graph to prevent furniture shortcuts. Door closures still reroute to another reachable door; room hazards propagate to temporary waypoints. These walking clearances are illustrative model assumptions.

The camera can be aligned manually by choosing a modeled wall direction while pointing the phone toward that wall. The arrow uses the next route edge and disappears without a fresh compass reading. Position advances only when the user confirms a waypoint, including a floor change. There is no visual/inertial world tracking, automatic camera localization, or floor-anchored AR path. All route lengths and starting positions remain estimates based on the supplied model. Android/iPhone hardware validation remains outstanding.

Examples: `marsden-start-point.png`, `marsden-route-3d.png`, and `marsden-start-mobile.png` in this report folder.

## Checks

TypeScript strict checking and the production build pass. The 57 TypeScript tests include actual GLB parsing, complete OBJ/material/texture bundles, correct exported elevations, room order, room-to-entrance connectivity through doors, prevention of same-floor wall crossings, stair-cutout alignment, independent per-floor material fading, collision-free point starts, inherited room/door hazards, and graph/model transforms. Nine production-browser checks pass, including the Marsden back-right-to-entrance walkthrough, simulated compass alignment and stale-reading handling, custom points and invalid points at phone viewport size, rooms on all floors, original-scan comparison, and the existing hazard/offline workflow. These checks do not establish physical AR accuracy or actual phone compatibility. Browser captures are stored as `reconstructed-*.png` and `marsden-*.png`.

Assets are approximately **146 KB for Admin** and **355 KB for Ynares**. The complete bundles, including furniture metadata, are about **281 KB** and **692 KB**, respectively. Actual field accuracy, scan registration and geographic placement remain unverified, as indicated in the app.

The latest local room-model benchmark measured 0.2 s loading for both models and approximately 42.3 fps (Admin) / 39.5 fps (Ynares) in headless Windows Edge with software rendering. These are localhost/desktop measurements, not a mobile or 4G acceptance test. Bump the layout manifest revision when changing geometry so older browser alignment drafts are archived instead of applied to new room coordinates.
