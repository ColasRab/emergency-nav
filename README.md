# Wayfinder

Indoor navigation for the Admin and Ynares buildings. The main page fits one camera/model window with a top-down map, an estimated-location card, building/floor selectors and the essential controls. Location setup, GPS calibration, reports and advanced model tools open in panels.

## Use the app

1. Select the building and the floor you are physically on.
2. For a known starting point, select **Set location**, choose a room and a place such as **Marsden · Right door**, then select **Use this location**. Corners and aisle positions are also available.
3. To calibrate GPS, select **Calibrate GPS**. Stand at **Marsden · Right door** and record the first GPS point. Walk to **Marsden · Left door** and record the second point. Review the distance ratio and reported GPS accuracy, then select **Use this calibration**.
4. GPS tracking starts after calibration. Subsequent GPS readings update the map marker, estimated room/place, route and camera view. **Stop GPS** freezes the last location; **Use GPS** resumes using the saved calibration.
5. Select **Use camera** to switch from the first-person model preview to live video. Allow camera and compass access. **Start navigation** enables spoken directions; **Mute** and **Voice settings** remain available in the bottom bar.

Choose floors manually. Changing floor stops GPS and clears the old position; select **Use GPS** again on the selected floor. The horizontal building calibration can be reused across its floors. Changing building selects that building's own saved calibration.

QR calibration has been removed from the active app. The former `/admin/anchors` URL redirects to GPS location setup. Legacy QR geometry utilities remain in the repository for compatibility, without a scanner or sticker workflow on the main page.

## How the two-point GPS alignment works

Each named location has coordinates in the reconstructed model. The app records the phone's latitude, longitude, reported accuracy and timestamp at two distinct locations on the same floor. It calculates:

`model metres per GPS metre = model separation / GPS separation`

The first point fixes translation, and the two-point baseline fixes scale and direction. East/north GPS coordinates are converted into the model's coordinate frame with the correct handedness. New readings use this alignment. Navigation distances, wall offsets and the camera route's assumed eye height use the fitted horizontal scale.

The app labels low confidence when the reported GPS uncertainty overlaps the baseline, or when the fitted scale is extreme. Nearly identical GPS readings and cross-floor calibration pairs are rejected. Tracking ignores readings older than 30 seconds or with reported accuracy worse than 50 metres. It matches usable estimates to modeled walkable areas; readings outside those areas keep the last position instead of teleporting the user across the building.

**Calibration does not improve the phone's GPS precision.** Indoor GPS can be too noisy to distinguish nearby doors or room corners. Two points fit a transform but do not validate the rest of an estimated floor plan. The location card displays GPS-reported accuracy, and **Set location** remains available when GPS cannot be used.

GPS records are saved only in this device's browser, separately for each building/model revision. They are not uploaded to Supabase or committed to GitHub. Use **Clear saved calibration** in the calibration panel to remove the current building's setup.

The camera overlay uses GPS/manual position, compass heading and an assumed camera perspective. The model preview uses a 1.6 m eye height; the live overlay assumes a 60° vertical field of view. Camera images do not identify the room or provide visual/inertial motion tracking, depth occlusion or world-anchored AR. Android and iPhone hardware validation remains outstanding.

## Run locally

Use Node.js 24 and npm. `package-lock.json` is the authoritative dependency lockfile.

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000`. Production uses `npm run build` and `npm run start`. Copy `.env.example` to `.env.local` and supply your own values. Phone camera, compass and location permissions require HTTPS.

## Deploy to Vercel

The GitHub repository is `ColasRab/emergency-nav`, with production branch `master` and project root `./`. `vercel.json` selects Next.js, `npm ci` and `npm run build`; `package.json` selects Node.js 24. The live site is [emergency-nav-alpha.vercel.app](https://emergency-nav-alpha.vercel.app).

Configure the names from `.env.example` in Vercel for the environments you use:

- `NEXT_PUBLIC_MAPBOX_TOKEN`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server only
- `HAZARD_ADMIN_TOKEN` — server only

Keep `.env.local` out of GitHub. Public environment values are embedded during builds, so redeploy after changing them. The supplied Supabase project has already had `supabase/migrations/001_hazards.sql` applied.

## Models and estimates

The active room reconstructions reproduce the supplied floor plan, with modeled doors, furniture, corridors, fences and stairs. Admin has Stock Room, Euler, Admin Office, SHS Com Lab, Computer Lab and IT Hub. Ynares has three floors, including Marsden on the second floor. **More options** contains model downloads and advanced building tools; the main page stays focused on navigation.

Ynares uses confirmed floor-to-floor heights of 3.095 / 3.05 / 2.84 m and relative walking elevations 0 / 3.095 / 6.145 m. Slabs of 0.36 / 0.17 / 0.16 m are already included in those spans. Horizontal dimensions, furniture, door positions, Admin's height and the central entrance are estimated. The sole current destination is the assumed central ground-floor entrance. Follow official evacuation signs and staff instructions.

Room-model source: `scripts/room-layouts.json`. Regenerate GLB, OBJ/MTL/textures, metadata, graphs and download bundles with:

```powershell
npm run models:rooms
```

Regeneration replaces estimated building files and resets survey verification/geographic alignment. Changing the model revision invalidates its saved GPS calibration. Original scan GLBs remain at `public/models/admin.glb` and `public/models/ynares.glb`; the original `public/nav_graph.json` is retained separately. The scans are not registered to the room reconstruction. Original Ynares materials/texture were not supplied.

The original-scan conversion pipeline is `npm run models:prepare`, configured by `scripts/model-manifest.json`. The Python graph tools and survey examples remain under `scripts/`, with copies alongside the original project at `C:/Users/colas/Documents/emergency-navigation`. Those survey templates require real measurements and exits before they generate deployment data.

## Reports and voice

**Reports** opens observed-hazard reporting and the current building's shared reports. Next.js API routes and Supabase provide building/floor scope, confirmed closures, expiry, votes, offline queues and live updates. Server secrets stay in server environment variables. No camera frames or GPS calibration records are uploaded. Camera fire/smoke recognition is not enabled.

English and Filipino speech use device voices with captions, mute and volume settings. The previously mentioned external voice folder has not been supplied. `/admin/alignment` and `/admin/hazards` remain available through **More options**.

## Validation

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Browser checks use installed Microsoft Edge and port 3010. They cover compact desktop/phone layouts, rendered model pixels, two-door GPS recording and live updates, saved calibration, poor/identical/denied GPS cases, camera cleanup, shared/offline reports and the live Supabase read endpoint. GPS coordinates and camera feeds in these checks are synthetic, not on-site measurements. No fake hazards are added to the live database.

See `reports/gps-location-calibration.md`, `reports/room-reconstruction.md` and `reports/final-implementation-report.md` for implementation details and limitations. Current screenshots are `reports/compact-navigation-desktop.png`, `reports/compact-navigation-mobile.png` and `reports/gps-calibration-points.png`.
