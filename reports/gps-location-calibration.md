# Point to point location and GPS calibration

Updated 18 November 2026. Calibration now collects fresh stationary readings, keeps earlier saved samples out of new attempts, and explicitly aligns the phone's facing direction. **Calibrate GPS → Point and direction** provides alignment at a known model point when GPS is unsuitable. This mode still requires explicit progress confirmation while walking.

The main page retains one camera/model window with a top-down map and essential controls. Previously, GPS errors up to 50 m could replace the known calibration point automatically. The resulting estimate could receive an exact room-corner or door label. That behavior has been removed.

## Confirmed point-to-point mode

Choose the building and physical floor, then use **Set location** to confirm a named point and the phone's facing direction. Choose **Set destination** to select a door, clear room position, corridor point or stair landing, including on another floor. The gold map marker is the destination. Both endpoints use furniture-aware visibility graphs; two positions in one room share the same aisle graph. Reported room hazards apply to temporary endpoint nodes.

The marker stays at the confirmed model point. **Reached next point** confirms advancement; **Set location** can reset to any named position. This is manual progress, not camera tracking. Arrival is announced only at a confirmed point within 0.05 model metres of the goal. Guidance names the selected destination instead of always announcing an exit.

## Optional GPS alignment

Record two named positions on the same floor. The default pair spans the floor instead of using two nearby room doors; Marsden's doors remain selectable. An adequate baseline depends on actual accuracy readings. Each capture polls fresh GPS fixes until at least five readings span four seconds. The capture can be cancelled and ends after at most 20 seconds. Cached or stale timestamps do not count, and late callbacks after cancellation are ignored.

The local east/north median supplies a representative center. An isolated jump can be excluded only if at least five readings and 80% of the batch agree. The retained accuracy is the largest included receiver radius plus the observed spread; collecting more readings does not create a smaller claimed accuracy radius. Both captures must belong to the same attempt and be no more than ten minutes apart. The fit maps GPS east/north to model X/Z using translation, rotation and scale; it does not survey the building or improve receiver accuracy.

A calibration cannot be saved when its baseline is no greater than three times the sum of endpoint accuracy radii, or its model/GPS scale ratio is outside 0.2-5. Indistinguishable coordinates and cross-floor pairs are rejected. Stored calibrations have confidence recalculated under current rules.

Saving confirms the second named point and its chosen facing direction, and leaves GPS off. Remain at that point and aim the phone before confirming; a second-point capture older than one minute must be recorded again. An alignment whose GPS readings cannot support room guidance is labeled accordingly, even when its geometric fit can be saved. **Use GPS** explicitly starts tracking.

The camera guide waits for a fresh compass reading before applying the chosen facing. It drops the old sensor pose from smoothing and preserves a pending alignment when GPS starts. **Point and direction** offers the same known-point alignment without GPS capture. Compass access is still needed for a camera arrow that follows phone direction. Navigation distances and the assumed 1.6 m camera height retain estimated model units instead of being stretched by a noisy GPS ratio.

Saved alignments use version 2 with capture-quality metadata. Older single-reading alignments are ignored and must be recorded again. Reopening setup may retain point names but starts with no captured GPS samples and cannot reapply the old second point as the user's current location.

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

Final verification on 18 November 2026: production build and strict TypeScript checking passed; all 92 unit checks and 16 browser checks passed. Two targeted checks also passed after the final scrolling adjustment, including an unobstructed close button and visible fallback controls. New checks cover capture duration, cached timestamps, isolated jumps, cancellation, permission denial, saved-attempt reset, current-facing alignment and visible rejection feedback. Browser results and current desktop/phone captures are stored in this reports folder. These checks use synthetic sensor data; on-site accuracy remains unverified.
