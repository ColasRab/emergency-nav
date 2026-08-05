const EARTH_RADIUS_METERS = 6_378_137;

export type GpsFix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

export type CalibrationSample = {
  anchorId: string;
  nodeId: number;
  floor: number;
  graphPosition: [number, number];
  gps: GpsFix;
};

export type CalibrationTransform = {
  originLatitude: number;
  originLongitude: number;
  graphOrigin: [number, number];
  scale: number;
  rotationRadians: number;
  anchorIds: [string, string];
  floor: number;
  createdAt: number;
};

export function latLonToLocalMeters(
  latitude: number,
  longitude: number,
  originLatitude: number,
  originLongitude: number
): [number, number] {
  const degreesToRadians = Math.PI / 180;
  const meanLatitude = ((latitude + originLatitude) / 2) * degreesToRadians;
  const east =
    (longitude - originLongitude) *
    degreesToRadians *
    EARTH_RADIUS_METERS *
    Math.cos(meanLatitude);
  const north =
    (latitude - originLatitude) * degreesToRadians * EARTH_RADIUS_METERS;
  return [east, north];
}

export function createCalibrationTransform(
  first: CalibrationSample,
  second: CalibrationSample
): CalibrationTransform {
  if (first.nodeId === second.nodeId || first.anchorId === second.anchorId) {
    throw new Error("The second QR code must be a different calibration point.");
  }
  if (first.floor !== second.floor) {
    throw new Error("Both calibration QR codes must be on the same floor.");
  }

  const [east, north] = latLonToLocalMeters(
    second.gps.latitude,
    second.gps.longitude,
    first.gps.latitude,
    first.gps.longitude
  );
  const gpsDistance = Math.hypot(east, north);
  const graphDx = second.graphPosition[0] - first.graphPosition[0];
  const graphDz = second.graphPosition[1] - first.graphPosition[1];
  const graphDistance = Math.hypot(graphDx, graphDz);

  if (gpsDistance < 1) {
    throw new Error("The GPS fixes are too close together. Move to the second QR point and try again.");
  }
  if (graphDistance < 1) {
    throw new Error("The QR points are too close in the navigation graph for reliable calibration.");
  }

  const scale = graphDistance / gpsDistance;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("The calibration scale could not be calculated.");
  }

  return {
    originLatitude: first.gps.latitude,
    originLongitude: first.gps.longitude,
    graphOrigin: first.graphPosition,
    scale,
    rotationRadians: Math.atan2(graphDz, graphDx) - Math.atan2(north, east),
    anchorIds: [first.anchorId, second.anchorId],
    floor: first.floor,
    createdAt: Date.now(),
  };
}

export function gpsToGraph(
  fix: Pick<GpsFix, "latitude" | "longitude">,
  transform: CalibrationTransform
): [number, number] {
  const [east, north] = latLonToLocalMeters(
    fix.latitude,
    fix.longitude,
    transform.originLatitude,
    transform.originLongitude
  );
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);
  const rotatedX = cosine * east - sine * north;
  const rotatedZ = sine * east + cosine * north;
  return [
    transform.graphOrigin[0] + transform.scale * rotatedX,
    transform.graphOrigin[1] + transform.scale * rotatedZ,
  ];
}

export function graphVectorToBearing(
  dx: number,
  dz: number,
  transform: CalibrationTransform
): number {
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);
  const east = cosine * dx + sine * dz;
  const north = -sine * dx + cosine * dz;
  return (Math.atan2(east, north) * 180) / Math.PI;
}

export function normalizeSignedDegrees(value: number): number {
  return ((value + 540) % 360) - 180;
}

export function getCurrentGpsFix(): Promise<GpsFix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("GPS is not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        }),
      (error) => reject(new Error(error.message || "Unable to read GPS position.")),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    );
  });
}
