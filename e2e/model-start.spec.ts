import { test, expect } from "@playwright/test";
import sharp from "sharp";
import {
  calibrateGps,
  choosePlace,
  chooseDestination,
  installGps,
  leftDoor,
  marsden,
  moveGps,
  ready,
  rightDoor,
  sendCompass,
} from "./helpers";

test("compact window keeps only the map, camera and essential controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await ready(page);
  await expect(
    page.locator(".scan-panel,.room-directory,.mode-toggle"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Scan QR|Read signage|Recalibrate/ }),
  ).toHaveCount(0);
  await expect(
    page.locator(".model-camera-setup,.camera-guide-heading"),
  ).toHaveCount(0);
  await choosePlace(page);
  await chooseDestination(page);
  const view = page.getByRole("region", {
    name: "Camera navigation view",
    exact: true,
  });
  await expect(view.getByTestId("estimated-place-name")).toHaveText("Marsden");
  await expect(view.getByTestId("estimated-place-region")).toHaveText(
    "Back right",
  );
  await expect(
    view.getByRole("button", { name: "Zoom map to current room", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const image = await view
        .locator(".model-pose-preview canvas")
        .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
      return (
        await sharp(Buffer.from(image.split(",")[1], "base64")).stats()
      ).channels.some((c) => c.stdev > 1);
    })
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "reports/compact-navigation-desktop.png",
    fullPage: true,
  });
  const before = await view
    .getByTestId("minimap-user")
    .getAttribute("transform");
  await view.getByRole("button", { name: /Reached next point/ }).click();
  await expect(view.getByTestId("minimap-user")).not.toHaveAttribute(
    "transform",
    before!,
  );
});

test("two Marsden door GPS records calibrate, track and persist without any QR step", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installGps(page);
  await ready(page);
  await chooseDestination(page);
  await calibrateGps(page);
  const view = page.getByRole("region", {
    name: "Camera navigation view",
    exact: true,
  });
  await expect(view.getByTestId("estimated-place-name")).toHaveText(
    "Approximate GPS area",
  );
  await expect(view.getByTestId("estimated-place-region")).toHaveText(
    "Confirm using Set location",
  );
  await expect(view.locator(".estimated-place-basis")).toContainText(
    "GPS estimate",
  );
  const beforeMove = await view
    .getByTestId("minimap-user")
    .getAttribute("transform");
  await moveGps(page, marsden.rect[2] - 0.525, marsden.rect[1] + 0.525);
  await expect(view.getByTestId("minimap-user")).not.toHaveAttribute(
    "transform",
    beforeMove!,
  );
  await expect(view.getByTestId("gps-uncertainty")).toBeVisible();
  const afterMove = await view
    .getByTestId("minimap-user")
    .getAttribute("transform");
  await expect(
    view.getByRole("button", { name: /Reached next point/ }),
  ).toHaveCount(0);
  await expect
    .poll(async () => {
      await sendCompass(page, 180);
      return page.locator(".navigation-arrow").count();
    })
    .toBe(1);
  await page.getByRole("button", { name: "Stop GPS", exact: true }).click();
  await moveGps(page, leftDoor[0], leftDoor[1]);
  await expect(view.getByTestId("minimap-user")).toHaveAttribute(
    "transform",
    afterMove!,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Use GPS", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Use GPS", exact: true }).click();
  await expect(page.getByTestId("estimated-place-name")).toHaveText(
    "Approximate GPS area",
  );
  await page
    .getByRole("combobox", { name: "Floor", exact: true })
    .selectOption("0");
  await expect(
    page.getByRole("button", { name: "Use GPS", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("estimated-place-name")).toHaveText(
    "Position not set",
  );
  expect(errors).toEqual([]);
});

test("imprecise GPS never overwrites a confirmed door and manual selection restores a named point", async ({
  page,
}) => {
  await installGps(page);
  await ready(page);
  await calibrateGps(page);
  await choosePlace(page, "Marsden", "Right door");
  await moveGps(page, leftDoor[0], leftDoor[1], 8);
  const marker = page.getByTestId("minimap-user"),
    before = await marker.getAttribute("transform");
  await page.getByRole("button", { name: "Use GPS", exact: true }).click();
  await expect(page.locator(".navigation-live-status")).toContainText(
    "too uncertain for room-level guidance",
  );
  await expect(marker).toHaveAttribute("transform", before!);
  await expect(page.getByTestId("estimated-place-region")).toHaveText(
    "Right door",
  );
  await expect(page.getByTestId("gps-uncertainty")).toHaveCount(0);
  await moveGps(page, leftDoor[0], leftDoor[1]);
  await expect(page.getByTestId("estimated-place-name")).toHaveText(
    "Approximate GPS area",
  );
  await choosePlace(page, "Marsden", "Left door");
  await expect(page.getByTestId("estimated-place-region")).toHaveText(
    "Left door",
  );
  await expect(page.locator(".estimated-place-basis")).toContainText(
    "Confirmed on model",
  );
});

test("a route reaches the selected room corner point by point and changes destination cleanly", async ({
  page,
}) => {
  await ready(page);
  await choosePlace(page);
  await chooseDestination(page, "Marsden · Back left");
  await expect(page.getByTestId("minimap-destination")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  const next = page.getByRole("button", { name: /Reached next point/ });
  let steps = 0;
  while (await next.count()) {
    if (++steps > 30)
      throw new Error("Route did not finish at selected corner");
    const before = await page
      .getByTestId("minimap-user")
      .getAttribute("transform");
    await next.click();
    await expect(page.getByTestId("minimap-user")).not.toHaveAttribute(
      "transform",
      before!,
    );
  }
  expect(steps).toBeGreaterThan(0);
  await expect(page.getByTestId("estimated-place-region")).toHaveText(
    "Back left",
  );
  await expect(page.locator(".hud-maneuver")).toContainText(
    "reached the selected destination",
  );
  await chooseDestination(page, "Franklin · Left door");
  await expect(page.locator(".navigation-live-status")).toContainText(
    "To Franklin · Left door",
  );
  await expect(next).toBeVisible();
});

test("identical GPS fixes do not create a bogus ratio and first-point reversal remains usable", async ({
  page,
}) => {
  await installGps(page);
  await ready(page);
  await page
    .getByRole("button", { name: "Calibrate GPS", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Calibrate by location" });
  await dialog
    .getByLabel("First location")
    .selectOption({ label: "Marsden · Left door" });
  await expect(dialog.getByLabel("Second location")).not.toHaveValue(
    `${marsden.id}:door:1`,
  );
  await dialog
    .getByLabel("First location")
    .selectOption({ label: "Marsden · Right door" });
  await dialog
    .getByLabel("Second location")
    .selectOption({ label: "Marsden · Left door" });
  await dialog
    .getByRole("button", { name: "Record GPS at first point", exact: true })
    .click();
  await expect(dialog.getByText(/Recorded.*GPS accuracy/)).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "Record GPS at second point", exact: true })
    .click();
  await expect(
    dialog.getByText("Door alignment ready from the model", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Use this door position", exact: true })
    .click();
  await expect(page.getByTestId("estimated-place-region")).toHaveText(
    "Left door",
  );
  await expect(
    page.getByRole("button", { name: "Use GPS", exact: true }),
  ).toBeVisible();
});

test("saved calibration starts a fresh attempt and saving realigns the current phone facing", async ({
  page,
}) => {
  await installGps(page);
  await ready(page);
  await choosePlace(page);
  await sendCompass(page, 180);
  await calibrateGps(page, 0.1, 90);
  await expect
    .poll(async () => {
      await sendCompass(page, 270);
      const transform = await page
        .getByTestId("minimap-user")
        .getAttribute("transform");
      const angle = Number(transform?.match(/rotate\(([^)]+)\)/)?.[1]);
      return Math.round(((angle % 360) + 360) % 360);
    })
    .toBe(90);
  await page
    .getByRole("button", { name: "Calibrate GPS", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Calibrate by location",
    exact: true,
  });
  await expect(
    dialog.getByText(/A new attempt needs fresh recordings/),
  ).toBeVisible();
  await expect(dialog.getByText(/Recorded.*GPS accuracy/)).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Use this calibration", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", {
      name: "Record GPS at second point",
      exact: true,
    }),
  ).toBeDisabled();
});

test("GPS capture can be cancelled and point-and-direction alignment works without GPS permission", async ({
  page,
}) => {
  await installGps(page);
  await ready(page);
  await page
    .getByRole("button", { name: "Calibrate GPS", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Calibrate by location",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Record GPS at first point", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Cancel GPS recording", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Record GPS at first point",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(dialog.getByText(/Recorded.*GPS accuracy/)).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("wayfinder-test-gps-denied")),
  );
  await dialog
    .getByRole("button", { name: "Point and direction", exact: true })
    .click();
  await dialog.getByLabel("Room or area").selectOption({ label: "Marsden" });
  await dialog
    .getByLabel("Standing position")
    .selectOption({ label: "Marsden · Back right" });
  await dialog.getByLabel("Phone is pointing toward").selectOption("0");
  await dialog
    .getByRole("button", { name: "Use this location", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("estimated-place-region")).toHaveText(
    "Back right",
  );
  await expect(
    page.getByRole("button", { name: "Use GPS", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      await sendCompass(page, 270);
      const transform = await page
        .getByTestId("minimap-user")
        .getAttribute("transform");
      const angle = Number(transform?.match(/rotate\(([^)]+)\)/)?.[1]);
      return Math.round(((angle % 360) + 360) % 360);
    })
    .toBe(0);
});

test("poor GPS reports low confidence while permission denial leaves manual location usable", async ({
  page,
}) => {
  await installGps(page, 8, true);
  await ready(page);
  await page
    .getByRole("button", { name: "Calibrate GPS", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "Calibrate by location" });
  await dialog
    .getByRole("button", { name: "Record GPS at first point", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("denied");
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await choosePlace(page, "Marsden", "Right door");
  await expect(page.getByTestId("estimated-place-region")).toHaveText(
    "Right door",
  );
  await moveGps(page, rightDoor[0], rightDoor[1], 8);
  await page
    .getByRole("button", { name: "Calibrate GPS", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Calibrate by location" });
  await dialog
    .getByLabel("First location")
    .selectOption({ label: "Marsden · Right door" });
  await dialog
    .getByLabel("Second location")
    .selectOption({ label: "Marsden · Left door" });
  await dialog
    .getByRole("button", { name: "Record GPS at first point", exact: true })
    .click();
  await expect(dialog.getByText(/Recorded.*GPS accuracy/)).toHaveCount(1);
  await moveGps(page, leftDoor[0], leftDoor[1], 8);
  await dialog
    .getByRole("button", { name: "Record GPS at second point", exact: true })
    .click();
  await expect(dialog.getByText(/Low GPS confidence/)).toBeVisible();
  await expect(dialog.locator(".gps-fit-summary")).toBeInViewport({
    ratio: 0.5,
  });
  await expect(
    dialog.getByRole("button", { name: "Point and direction", exact: true }),
  ).toBeInViewport();
  await dialog
    .getByRole("button", { name: "Close panel", exact: true })
    .click({ trial: true });
  const methods = await dialog.locator(".calibration-methods").boundingBox();
  const close = await dialog
    .getByRole("button", { name: "Close panel", exact: true })
    .boundingBox();
  expect(methods!.y).toBeGreaterThanOrEqual(close!.y + close!.height);
  await expect(
    dialog.getByRole("button", { name: "Use this door position", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "reports/gps-calibration-points.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", {
      name: "Choose farther-apart GPS points",
      exact: true,
    })
    .click();
  await expect(dialog.getByLabel("First location")).not.toHaveValue(
    marsden.id + ":door:0",
  );
  await expect(
    dialog.getByRole("button", {
      name: "Record GPS at second point",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(dialog.getByText(/Recorded.*GPS accuracy/)).toHaveCount(0);
});

test("nearby GPS readings still allow confirmation of either modeled door", async ({
  page,
}) => {
  await installGps(page, 7.4);
  await ready(page);
  await chooseDestination(page);
  await page
    .getByRole("button", { name: "Calibrate GPS", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Calibrate by location",
    exact: true,
  });
  await expect(dialog.getByLabel("First location")).toHaveValue(
    marsden.id + ":door:0",
  );
  await expect(dialog.getByLabel("Second location")).toHaveValue(
    marsden.id + ":door:1",
  );
  await dialog
    .getByRole("button", { name: "Record GPS at first point", exact: true })
    .click();
  await expect(dialog.getByText(/Recorded.*GPS accuracy/)).toHaveCount(1, {
    timeout: 12000,
  });
  await moveGps(page, rightDoor[0] - 0.25, rightDoor[1], 7.4);
  await dialog
    .getByRole("button", { name: "Record GPS at second point", exact: true })
    .click();
  await expect(
    dialog.getByText("Door alignment ready from the model", { exact: true }),
  ).toBeVisible({ timeout: 12000 });
  await expect(dialog.getByText(/Recorded.*GPS accuracy/)).toHaveCount(2);
  await dialog
    .getByLabel("I am now standing at")
    .selectOption({ label: "Marsden · Right door" });
  await dialog.getByLabel("Phone is pointing toward").selectOption("90");
  await dialog
    .getByRole("button", { name: "Use this door position", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("estimated-place-region")).toHaveText(
    "Right door",
  );
  await expect(
    page.getByRole("button", { name: "Use GPS", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  const storedGps = await page.evaluate(() =>
    Object.keys(localStorage).filter(
      (k) => k.startsWith("wayfinder:location-gps:") && k.endsWith(":v2"),
    ),
  );
  expect(storedGps).toEqual([]);
});

test("phone window fits without scrolling and live-camera mode retains the location HUD", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 960;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#405b62";
        ctx.fillRect(0, 0, 640, 960);
        ctx.fillStyle = "#e0e9e3";
        ctx.font = "24px sans-serif";
        ctx.fillText("Synthetic test camera", 190, 420);
        return canvas.captureStream(5);
      },
    });
  });
  await ready(page);
  await choosePlace(page);
  await chooseDestination(page);
  const view = page.getByRole("region", {
    name: "Camera navigation view",
    exact: true,
  });
  await expect(view.locator(".model-pose-preview canvas")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight + 1,
    ),
  ).toBe(true);
  const map = (await view.locator(".navigation-minimap").boundingBox())!,
    actions = (await view.locator(".camera-hud-actions").boundingBox())!,
    place = (await view.locator(".estimated-place-card").boundingBox())!,
    maneuver = (await view.locator(".hud-maneuver").boundingBox())!;
  expect(map.x + map.width).toBeLessThan(actions.x);
  expect(maneuver.x + maneuver.width).toBeLessThan(place.x);
  await page.screenshot({
    path: "reports/compact-navigation-mobile.png",
    fullPage: true,
  });
  await view.getByRole("button", { name: "Use camera", exact: true }).click();
  await expect(view.getByText("Live camera", { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      await sendCompass(page, 180);
      return view.locator(".navigation-arrow").count();
    })
    .toBe(1);
  await expect(view.getByTestId("estimated-place-name")).toHaveText("Marsden");
  const track = await view
    .locator("video")
    .evaluateHandle(
      (v) => ((v as HTMLVideoElement).srcObject as MediaStream).getTracks()[0],
    );
  await view
    .getByRole("button", { name: "Use model preview", exact: true })
    .click();
  expect(await track.evaluate((t) => t.readyState)).toBe("ended");
});
