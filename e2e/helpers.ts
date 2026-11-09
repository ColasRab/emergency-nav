import { expect, type Page } from "@playwright/test";
import config from "../public/models/ynares.json";
export const marsden = config.rooms.find((r) => r.label === "Marsden")!;
export const rightDoor = [...marsden.doors].sort((a, b) => b[0] - a[0])[0];
export const leftDoor = [...marsden.doors].sort((a, b) => a[0] - b[0])[0];
export function gpsAtModel(x: number, z: number, accuracy = 0.4) {
  const degrees = 180 / Math.PI,
    radius = 6378137;
  return {
    latitude: 14.6 - (z / radius) * degrees,
    longitude:
      121.2 +
      ((x - rightDoor[0]) / (radius * Math.cos((14.6 * Math.PI) / 180))) *
        degrees,
    accuracy,
  };
}
export async function ready(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("combobox", { name: "Building", exact: true }),
  ).toBeEnabled();
}
export async function choosePlace(
  page: Page,
  room = "Marsden",
  position = "Back right",
) {
  await page.getByRole("button", { name: "Set location", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Set your location",
    exact: true,
  });
  await dialog.getByLabel("Room or area").selectOption({ label: room });
  await dialog
    .getByLabel("Standing position")
    .selectOption({ label: `${room} · ${position}` });
  await dialog
    .getByRole("button", { name: "Use this location", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}
export async function installGps(page: Page, accuracy = 0.4, denied = false) {
  await page.addInitScript(
    ({ initial, startsDenied }) => {
      let fix = initial,
        deny = startsDenied,
        sequence = 0;
      const watchers = new Map<
        number,
        { success: PositionCallback; error?: PositionErrorCallback | null }
      >();
      const position = () =>
        ({
          coords: {
            ...fix,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        }) as GeolocationPosition;
      const error = () =>
        ({
          code: 1,
          message: "Location permission denied",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        }) as GeolocationPositionError;
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition(
            success: PositionCallback,
            fail?: PositionErrorCallback | null,
          ) {
            setTimeout(() => (deny ? fail?.(error()) : success(position())), 0);
          },
          watchPosition(
            success: PositionCallback,
            fail?: PositionErrorCallback | null,
          ) {
            const id = ++sequence;
            watchers.set(id, { success, error: fail });
            setTimeout(() => {
              if (watchers.has(id))
                deny ? fail?.(error()) : success(position());
            }, 0);
            return id;
          },
          clearWatch(id: number) {
            watchers.delete(id);
          },
        },
      });
      window.addEventListener("wayfinder-test-gps", (raw) => {
        fix = (raw as CustomEvent).detail;
        deny = false;
        for (const w of watchers.values()) w.success(position());
      });
      window.addEventListener("wayfinder-test-gps-denied", () => {
        deny = true;
        for (const w of watchers.values()) w.error?.(error());
      });
    },
    {
      initial: gpsAtModel(rightDoor[0], rightDoor[1], accuracy),
      startsDenied: denied,
    },
  );
}
export async function moveGps(
  page: Page,
  x: number,
  z: number,
  accuracy = 0.4,
) {
  await page.evaluate(
    (detail) =>
      window.dispatchEvent(new CustomEvent("wayfinder-test-gps", { detail })),
    gpsAtModel(x, z, accuracy),
  );
}
export async function calibrateGps(page: Page, accuracy = 0.4) {
  await page
    .getByRole("button", { name: "Calibrate GPS", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Calibrate by location",
    exact: true,
  });
  await expect(dialog.getByLabel("First location")).toHaveValue(
    `${marsden.id}:door:0`,
  );
  await dialog
    .getByRole("button", { name: "Record GPS at first point", exact: true })
    .click();
  await expect(dialog.getByText(/Recorded.*GPS accuracy/)).toHaveCount(1);
  await moveGps(page, leftDoor[0], leftDoor[1], accuracy);
  await dialog
    .getByRole("button", { name: "Record GPS at second point", exact: true })
    .click();
  await expect(
    dialog.getByText("Location calibration ready", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Use this calibration", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Stop GPS", exact: true }),
  ).toBeVisible();
}
export async function sendCompass(page: Page, heading = 180) {
  await page.evaluate((value) => {
    const event = new Event("deviceorientationabsolute");
    Object.defineProperties(event, {
      alpha: { value: (360 - value) % 360 },
      absolute: { value: true },
    });
    window.dispatchEvent(event);
  }, heading);
}
