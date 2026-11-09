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

export {
  latLonToLocalMeters,
  createCalibrationTransform,
  gpsToGraph,
  graphVectorToBearing,
  normalizeSignedDegrees,
} from "./geo/transform";

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
      (error) =>
        reject(new Error(error.message || "Unable to read GPS position.")),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });
}
