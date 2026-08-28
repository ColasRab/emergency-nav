# Indoor Navigation

Camera + motion-based indoor emergency navigation, built on a nav graph
generated from a photogrammetry scan (`nav_pipeline_fixed.py` /
`multi_floor_graph.py` in the parent project).

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:3000 (use `https` or a tunnel like ngrok for camera/
motion permissions on a real phone -- browsers require a secure context).

## GPS calibration and live camera navigation

1. Open **Calibrate / scan QR** and scan a labeled QR point. The app stores
   that node's graph coordinate together with a high-accuracy GPS fix.
2. Move to a different QR point on the same floor and scan it. The two
   graph/GPS pairs establish scale, rotation, and translation between GPS
   and the navigation graph.
3. Open **Navigate**, start the rear camera, and enable the compass. GPS
   continuously updates the A* start node and the arrow points toward a
   stable look-ahead waypoint on the route.

The two QR labels must match two different entries in `zones` in
`public/nav_graph.json`. Put the calibration stickers as far apart as
practical on the same floor. Calibration is stored in the browser until
the user chooses **Reset calibration**.

Camera, GPS, motion, and orientation APIs require HTTPS on a physical
phone (localhost is accepted for desktop development). Indoor GPS can be
inaccurate, so scanning any known QR or sign also corrects the current
graph position exactly.

## How location is determined (no training required)

1. **Read signage** -- OCR (tesseract.js) reads existing room number/floor
   placards and matches them to zone labels in `nav_graph.json`.
2. **Scan QR (stairs/unmarked areas)** -- for spots with no existing
   signage. Print a QR code containing that zone's exact label text
   (must match a `label` in the graph's `zones`, case-insensitive) and
   tape it up. Also runs COCO-SSD (pretrained) to count people in frame
   as a live congestion signal.
3. **Passive stair detection** -- once enabled, runs silently in the
   background using the phone's accelerometer to detect when the person
   is actually climbing/descending stairs, with NO scanning or action
   required. This is what actually matters during a real emergency --
   nobody stops to scan a code while evacuating. It only confirms
   progress along the route A* already planned (which floor, which
   stairwell), rather than trying to guess direction from raw sensor
   noise.

## Regenerating nav_graph.json

Run the Python pipeline (`multi_floor_graph.py` for multi-floor buildings,
`nav_pipeline_fixed.py` for a single floor) against your building's real
`.obj` scan(s), with your real exit coordinates, stair coordinates, floor
elevations, and zone labels substituted for the placeholders. Copy the
resulting JSON into `public/nav_graph.json`.

## Known placeholders to replace before real deployment

- `zones` list (stairs/hallway/room labels + coordinates) in the Python
  pipeline -- currently uses corridor endpoints as a stand-in.
- Exit coordinates -- currently auto-picked, replace with your building's
  real exits.
- Stair connector coordinates in `multi_floor_graph.py`.
- QR code payload text must exactly match the zone labels you set.
- Motion-detection thresholds in `lib/stairMotionDetector.ts`
  (`STAIRS_VARIANCE_THRESHOLD`, `MIN_STAIRS_DURATION_MS`) -- defaults are
  reasonable starting points; calibrate against a real staircase if time
  allows.
