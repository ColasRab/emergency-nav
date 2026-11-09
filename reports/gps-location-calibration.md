# GPS location calibration — 10 November 2026

The main page has been reduced to a single camera/model viewport, a top-down map, an estimated-location card, building/floor selectors and essential controls. Named-location setup, two-point GPS capture, hazard reports and advanced tools open in panels. The old scanner/sticker route redirects to `/?setup=gps`.

## Recording the user's example

The default Ynares second-floor calibration points are **Marsden · Right door** and **Marsden · Left door**. Left/right are defined by the supplied plan and model X direction. Each door's actual model coordinate and original navigation node are used; no room-center substitute is used. Other named doors, clear room positions and mapped waypoints can be selected.

1. Stand at the right door and record GPS.
2. Move to the left door and record GPS.
3. Review reported accuracy, baseline lengths and the ratio; select **Use this calibration**.
4. The app saves the calibration locally and starts `watchPosition`. New fixes move the estimate automatically. The floor remains the user's selection.

## Transform and scale

Implementation: `lib/position/gpsCalibration.ts`. The two samples contain model positions, latitude/longitude, accuracy, timestamp and floor. Latitude/longitude are converted to local east/north metres using the first GPS record as origin. The model frame reverses the east axis before fitting the clockwise X/Z rotation, preserving the model's handedness. The fit uses:

- translation at the first named point;
- model-units-per-GPS-metre ratio from the two baseline lengths;
- rotation from the baseline directions;
- model-revision and building-specific local storage.

GPS-derived compass alignment is calculated from the same rotation. Route distance and wall-distance captions convert model units back through the ratio. The live camera overlay scales its assumed 1.6 m eye height into the calibrated horizontal model frame. The model preview itself remains a view of the estimated reconstruction.

Same-point, nearly identical GPS and cross-floor sample pairs fail with a clear message. A baseline shorter than one GPS metre is not fitted. Low-confidence status is shown when the endpoint accuracy radii overlap the baseline or when the fitted ratio is below 0.2 or above 5; saving a finite estimate remains available in those low-confidence cases.

## Position updates

Tracking uses high-accuracy browser geolocation, zero cached age and a 15-second timeout. Readings older than 30 seconds, from the future, with invalid coordinates, or reporting worse than 50 m accuracy do not update the marker. No floor is inferred from GPS altitude. Selecting a different floor or building stops the current watcher, and late callbacks are ignored.

Positions near modeled doors match those doorways. Room positions are matched to clear room areas, including avoidance of modeled furniture. Corridor and lobby/landing positions remain within their modeled floor footprint. Unusable/outside readings keep the last position. This is a map-matched estimate, not proof that a particular door or path is physically clear.

The location panel distinguishes live GPS, a waiting/stale reading, a stopped GPS estimate and a manually selected location. GPS tracking can be stopped and resumed. Manual selection remains available if location permission is denied. Floor changes are explicit. Building changes clear the old user's position and load the other building's own calibration.

## Privacy and limits

Raw GPS calibration data stays in browser storage. It is not posted to the shared-hazard backend. Camera imagery remains local. Calibration is a geometric mapping of noisy GPS to an estimated model; it cannot improve the receiver's true accuracy or correct inaccurate room proportions. Nearby indoor doors can be closer than the phone's error radius. The app therefore shows reported GPS accuracy and low-confidence setup messages.

Camera overlays use an assumed perspective and compass orientation. There is no camera-based room recognition, visual/inertial localization, physical depth occlusion or world-anchored route. Physical GPS/compass accuracy and Android/iPhone behavior still require site testing.

## Checks

The production build and all 72 TypeScript tests pass. Tests exercise right/left door correspondence, exact fitting of both endpoints, correct room-depth handedness, rotated/scaled baselines, a third GPS point, reversed recording order, indistinguishable samples, cross-floor rejection, accuracy warnings, furniture matching and distance scaling. All 12 browser checks pass, covering the complete capture/save/track/reload flow, manual fallback, compact viewports, the replacement of the old sticker setup, and existing shared/offline reports. These use synthetic GPS and camera data.
