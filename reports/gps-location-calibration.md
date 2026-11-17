# Point-to-point location and GPS precision - 17 November 2026

The main page retains one camera/model window with a top-down map and essential controls. Previously, GPS errors up to 50 m could replace the known calibration point automatically. The resulting estimate could receive an exact room-corner or door label. That behavior has been removed.

## Confirmed point-to-point mode

Choose the building and physical floor, then use **Set location** to confirm a named point and the phone's facing direction. Choose **Set destination** to select a door, clear room position, corridor point or stair landing, including on another floor. The gold map marker is the destination. Both endpoints use furniture-aware visibility graphs; two positions in one room share the same aisle graph. Reported room hazards apply to temporary endpoint nodes.

The marker stays at the confirmed model point. **Reached next point** confirms advancement; **Set location** can reset to any named position. This is manual progress, not camera tracking. Arrival is announced only at a confirmed point within 0.05 model metres of the goal. Guidance names the selected destination instead of always announcing an exit.

## Optional GPS alignment

Record two named positions on the same floor. Marsden's right and left doors remain defaults; an adequate baseline depends on actual accuracy readings. The fit maps GPS east/north to model X/Z using translation, rotation and scale. It does not survey the building or improve the GPS receiver.

A calibration cannot be saved when its baseline is no greater than three times the sum of endpoint accuracy radii, or its model/GPS scale ratio is outside 0.2-5. Indistinguishable coordinates and cross-floor pairs are rejected. Stored calibrations have confidence recalculated under current rules.

Saving confirms the second named point and leaves GPS off. **Use GPS** explicitly starts tracking. Manual facing alignment takes precedence over GPS-derived compass alignment. Navigation distances and the assumed 1.6 m camera height retain estimated model units instead of being stretched by a noisy GPS ratio.

## Reading rejection

Let a and b be endpoint accuracy radii, L the GPS baseline, d the new reading's distance from the first point, and f its reported accuracy. The working uncertainty allowance is:

`u = f + a + (d + f + a) * (a + b) / (L - a - b)`

This conservative allowance is a heuristic, not a statistically guaranteed bound. It excludes unknown model and multipath bias. Tracking retains the last location when calibration confidence is inadequate, u exceeds 1 m, the fix is invalid/older than 30 seconds/more than 5 seconds in the future, or it falls outside modeled walkable areas. Map corrections above 0.35 model metres are rejected. Correction converted to GPS metres is included in the 1 m total allowance. These thresholds do not establish physical accuracy.

Accepted GPS readings show **Approximate GPS area**, an uncertainty circle and a confirmation prompt. They do not show exact room/door/corner labels, wall offsets or automatic arrival. Bad GPS cannot replace a confirmed point. Building/floor changes stop tracking and ignore late callbacks. Floors are always selected manually.

## Privacy and physical limits

Calibration stays in this browser, scoped by building and model revision. GPS records and camera frames are not uploaded to Supabase. The camera guide uses selected/estimated position, compass and assumed perspective. It does not recognize rooms, perform visual/inertial localization or anchor a route to the physical world.

Horizontal room dimensions and furniture remain estimates from the supplied diagram. Exact continuous indoor navigation still requires measured model alignment and a validated positioning/tracking method. No Android/iPhone or on-site accuracy claim is made by these software checks.

## Verification

Unit checks cover both buildings' room destinations, same-room and cross-room/floor routing, identical endpoints, furniture avoidance, destination-room hazards, announcements, calibration noise, poor readings and distant extrapolation. Browser checks use synthetic GPS/camera inputs for confirmed progress, explicit GPS start, rejected readings, uncertainty display, saved calibration, compact layouts and existing reporting. No synthetic reports are written to the live database.

Final verification: production build and strict TypeScript checking passed; all 83 unit checks and 14 browser checks passed. Browser results and current desktop/phone captures are stored in this reports folder.
