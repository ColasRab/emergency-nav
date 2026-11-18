# Point to point location and GPS calibration

Updated 18 November 2026. GPS calibration now permits only the selected floor's farthest-left and farthest-right modeled doors, with a separate saved setup for each floor. It collects fresh stationary readings and explicitly aligns phone facing. If GPS cannot distinguish the recorded end doors, **Use this door position** confirms a selected model point with GPS off and requires explicit progress confirmation while walking.

The main page retains one camera/model window with a top-down map and essential controls. Previously, GPS errors up to 50 m could replace the known calibration point automatically. The resulting estimate could receive an exact room-corner or door label. That behavior has been removed.

## Confirmed point-to-point mode

Choose the building and physical floor, then use **Set location** to confirm a named point and the phone's facing direction. Choose **Set destination** to select a door, clear room position, corridor point or stair landing, including on another floor. The gold map marker is the destination. Both endpoints use furniture-aware visibility graphs; two positions in one room share the same aisle graph. Reported room hazards apply to temporary endpoint nodes.

The marker stays at the confirmed model point. **Reached next point** confirms advancement; **Set location** can reset to any named position. This is manual progress, not camera tracking. Arrival is announced only at a confirmed point within 0.05 model metres of the goal. Guidance names the selected destination instead of always announcing an exit.

## Optional GPS alignment

GPS calibration is limited to the minimum-X and maximum-X actual door points on the selected floor. Corridor nodes, stair points, room corners and intermediate room doors cannot be selected. The first selector contains only those two end doors; the second is automatically set to the opposite end. Admin's pair is Stock Room / IT Hub, spanning 30.0 model metres. Each Ynares floor uses Male Comfort Room / Female Comfort Room, spanning 24.1 model metres. These are estimated model distances, not field measurements.

An adequate GPS baseline still depends on actual accuracy readings. Each capture polls fresh GPS fixes until at least five readings span four seconds. The capture can be cancelled and ends after at most 20 seconds. Cached or stale timestamps do not count, and late callbacks after cancellation are ignored.

The local east/north median supplies a representative center. An isolated jump can be excluded only if at least five readings and 80% of the batch agree. The retained accuracy is the largest included receiver radius plus the observed spread; collecting more readings does not create a smaller claimed accuracy radius. Both captures must belong to the same attempt and be no more than ten minutes apart. The fit maps GPS east/north to model X/Z using translation, rotation and scale; it does not survey the building or improve receiver accuracy.

A calibration cannot be saved when its baseline is no greater than three times the sum of endpoint accuracy radii, or its model/GPS scale ratio is outside 0.2-5. Indistinguishable coordinates and cross-floor pairs are rejected. Stored calibrations have confidence recalculated under current rules.

Insufficient GPS separation is distinguished from an unusable model door. After both captures, overlapping or even identical GPS coordinates produce a model-position confirmation instead of a blocked end to setup. The user selects which of the two recorded end doors they currently stand at and confirms facing. The chosen model coordinate is used directly, the noisy ratio is not applied, and no failed GPS transform is saved. The app does not infer the correct door from GPS. Reversing the recording order clears the attempt and requires fresh readings.

Saving a usable GPS fit confirms the second named point and its chosen facing direction, and leaves GPS off. Remain at that point and aim the phone before confirming; a second-point capture older than one minute must be recorded again for GPS setup. Pairs that cannot support room guidance instead offer confirmation of a selected model point without saving the GPS fit. **Use GPS** explicitly starts tracking when a usable GPS alignment exists.

The camera guide waits for a fresh compass reading before applying the chosen facing. It drops the old sensor pose from smoothing and preserves a pending alignment when GPS starts. **Point and direction** offers the same known-point alignment without GPS capture. Compass access is still needed for a camera arrow that follows phone direction. Navigation distances and the assumed 1.6 m camera height retain estimated model units instead of being stretched by a noisy GPS ratio.

Saved alignments use version 2 with capture-quality metadata and separate keys for each building, model revision and floor. Older building-wide setups are ignored. Loading a saved setup verifies the floor, both allowed door IDs, model coordinates and door-node mappings; an inner-room pair cannot override the restriction. Floor changes stop tracking, reset active setup state and load only that floor's saved alignment. Reopening setup starts with no captured GPS samples and cannot reapply an old second point as the user's current location.

## Reading rejection

Let a and b be endpoint accuracy radii, L the GPS baseline, d the new reading's distance from the first point, and f its reported accuracy. The working uncertainty allowance is:

`u = f + a + (d + f + a) * (a + b) / (L - a - b)`

This conservative allowance is a heuristic, not a statistically guaranteed bound. It excludes unknown model and multipath bias. Tracking retains the last location when calibration confidence is inadequate, u exceeds 1 m, the fix is invalid/older than 30 seconds/more than 5 seconds in the future, or it falls outside modeled walkable areas. Map corrections above 0.35 model metres are rejected. Correction converted to GPS metres is included in the 1 m total allowance. These thresholds do not establish physical accuracy.

Accepted GPS readings show **Approximate GPS area**, an uncertainty circle and a confirmation prompt. They do not show exact room/door/corner labels, wall offsets or automatic arrival. Bad GPS cannot replace a confirmed point. Building/floor changes stop tracking and ignore late callbacks. Floors are always selected manually.

## Privacy and physical limits

Calibration stays in this browser, scoped by building, floor and model revision. GPS records and camera frames are not uploaded to Supabase. The camera guide uses selected/estimated position, compass and assumed perspective. It does not recognize rooms, perform visual/inertial localization or anchor a route to the physical world.

Horizontal room dimensions and furniture remain estimates from the supplied diagram. Exact continuous indoor navigation still requires measured model alignment and a validated positioning/tracking method. No Android/iPhone or on-site accuracy claim is made by these software checks.

## Verification

Unit checks cover both buildings' room destinations, same-room and cross-room/floor routing, identical endpoints, furniture avoidance, destination-room hazards, announcements, calibration noise, poor readings and distant extrapolation. Browser checks use synthetic GPS/camera inputs for confirmed progress, explicit GPS start, rejected readings, uncertainty display, saved calibration, compact layouts and existing reporting. No synthetic reports are written to the live database.

Final verification on 18 November 2026: production build and strict TypeScript checking passed; all 98 unit checks and 18 browser checks passed. Checks cover minimum/maximum-X door selection on all four building/floor combinations, exclusion of inner-room anchors, automatic pairing in either order, independent floor storage, rejection of older inner-room setups, recording quality, fallback confirmation and navigation. Current picker captures are `calibration-admin-floor-0.png` and `calibration-ynares-floor-0.png` through `calibration-ynares-floor-2.png`. These checks use synthetic sensor data; on-site accuracy remains unverified.
