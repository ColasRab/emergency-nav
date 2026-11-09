import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

async function chooseMarsden(page: Page) {
  await page.route("**/api/hazards**", (route) =>
    route.fulfill({ json: { hazards: [], shared: true } }),
  );
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Building", exact: true })
    .selectOption("ynares");
  await page.getByLabel("Displayed floor").selectOption("1");
  await page.locator(".room-card").filter({ hasText: "Marsden" }).click();
  await expect(
    page.getByRole("heading", { name: "Where in Marsden are you?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back right", exact: true }).click();
  await page.getByRole("button", { name: "Use this starting point" }).click();
  await expect(
    page.getByRole("heading", { name: "Marsden — back right", exact: true }),
  ).toBeVisible();
}

test("Marsden model start supports facing alignment, fresh compass readings and manual progress", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await chooseMarsden(page);
  const align = page.getByRole("button", {
    name: "Set this facing direction",
    exact: true,
  });
  await expect(align).toBeDisabled();
  await expect(page.locator(".navigation-arrow")).toHaveCount(0);
  await page
    .locator(".model-camera-setup")
    .getByRole("button", { name: "Enable compass", exact: true })
    .click();
  await expect(
    page.getByText(/Waiting for absolute compass/).first(),
  ).toBeVisible();
  const sendHeading = () =>
    page.evaluate(() => {
      const event = new Event("deviceorientationabsolute");
      Object.defineProperties(event, {
        alpha: { value: 260 },
        absolute: { value: true },
      });
      window.dispatchEvent(event);
    });
  await sendHeading();
  await expect(align).toBeEnabled();
  await align.click();
  await expect(page.locator(".navigation-arrow")).toHaveCount(1);
  await expect(
    page.getByText("Facing direction set manually.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".navigation-arrow")).toHaveCount(0, {
    timeout: 6500,
  });
  await sendHeading();
  await expect(page.locator(".navigation-arrow")).toHaveCount(1);
  await page
    .locator(".room-start-panel")
    .screenshot({ path: "reports/marsden-start-point.png" });
  await page
    .locator(".scan-panel")
    .screenshot({ path: "reports/marsden-route-3d.png" });
  let count = 0;
  const progress = page.getByRole("region", { name: "Model route progress" });
  while (
    !(await progress
      .getByText("You have reached the modeled entrance.", { exact: true })
      .count())
  ) {
    expect(count++).toBeLessThan(60);
    await progress
      .getByRole("button", {
        name: "I have reached this waypoint",
        exact: true,
      })
      .click();
  }
  await expect(
    page.getByText(/1st floor.*Manually placed in the model/),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Building", exact: true })
    .selectOption("admin");
  await expect(
    page.getByRole("region", { name: "Model route progress" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Choose your approximate location")).toHaveValue(
    "",
  );
  expect(errors).toEqual([]);
});

test("phone layout permits custom model points and rejects furniture collisions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseMarsden(page);
  const left = page.getByLabel("From left wall (m)"),
    back = page.getByLabel("From back wall (m)");
  await left.fill("0.01");
  await expect(
    page.getByRole("button", { name: "Use this starting point" }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "This point is too close to a wall or furniture. Choose a clear space.",
    ),
  ).toBeVisible();
  await left.fill("0.6");
  await back.fill("0.6");
  await expect(
    page.getByRole("button", { name: "Use this starting point" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Use this starting point" }).click();
  await expect(
    page.getByRole("heading", { name: "Marsden — custom point", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".room-start-panel")
    .screenshot({ path: "reports/marsden-start-mobile.png" });
});

test("game-style camera view keeps the map and estimated place synchronized", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1320, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await chooseMarsden(page);
  const view = page.getByRole("region", {
      name: "Camera navigation view",
      exact: true,
    }),
    map = view.getByRole("region", {
      name: "Top-down navigation map",
      exact: true,
    }),
    place = view.getByRole("region", {
      name: "Estimated location",
      exact: true,
    });
  await expect(place.getByTestId("estimated-place-name")).toHaveText("Marsden");
  await expect(place.getByTestId("estimated-place-region")).toHaveText(
    "Back right",
  );
  await expect(view.locator(".model-pose-preview canvas")).toBeVisible();
  await expect(view.locator(".model-preview-status")).toHaveCount(0);
  await view.scrollIntoViewIfNeeded();
  await expect(view.locator(".model-pose-preview canvas")).toBeVisible();
  await expect
    .poll(async () => {
      const data = await view
        .locator(".model-pose-preview canvas")
        .evaluate((element) => (element as HTMLCanvasElement).toDataURL());
      const stats = await sharp(
        Buffer.from(data.split(",")[1], "base64"),
      ).stats();
      return stats.channels.some((channel) => channel.stdev > 1);
    })
    .toBe(true);
  const v = (await view.boundingBox())!,
    m = (await map.boundingBox())!,
    p = (await place.boundingBox())!;
  expect(m.x + m.width).toBeLessThan(v.x + v.width / 2);
  expect(m.y + m.height).toBeLessThan(v.y + v.height / 2);
  expect(p.x).toBeGreaterThan(v.x + v.width / 2);
  expect(p.y).toBeGreaterThan(v.y + v.height / 2);
  await view.screenshot({ path: "reports/game-camera-desktop.png" });
  await map
    .getByRole("button", { name: "Show whole floor map", exact: true })
    .click();
  await expect(map.getByText("Ynares Building", { exact: true })).toBeVisible();
  await map
    .getByRole("button", { name: "Zoom map to current room", exact: true })
    .click();
  const before = await map
      .getByTestId("minimap-user")
      .getAttribute("transform"),
    beforePlace = await place.innerText();
  await place
    .getByRole("button", { name: "Reached next point", exact: false })
    .click();
  await expect(map.getByTestId("minimap-user")).not.toHaveAttribute(
    "transform",
    before!,
  );
  await expect(place).not.toHaveText(beforePlace);
  await view
    .getByRole("button", { name: "Expand camera view", exact: true })
    .click();
  await expect(view).toHaveClass(/is-expanded/);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    "hidden",
  );
  await page.keyboard.press("Escape");
  await expect(view).not.toHaveClass(/is-expanded/);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  expect(errors).toEqual([]);
});

test("phone camera layout keeps both corners clear and supports a live camera overlay", async ({
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
        const gradient = ctx.createLinearGradient(0, 0, 0, 960);
        gradient.addColorStop(0, "#566975");
        gradient.addColorStop(1, "#283e37");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 640, 960);
        ctx.fillStyle = "#d9e6df";
        ctx.font = "24px sans-serif";
        ctx.fillText("Synthetic test camera", 190, 450);
        return canvas.captureStream(5);
      },
    });
  });
  await chooseMarsden(page);
  const view = page.getByRole("region", {
    name: "Camera navigation view",
    exact: true,
  });
  await expect(view.locator(".model-pose-preview canvas")).toBeVisible();
  await expect(view.locator(".model-preview-status")).toHaveCount(0);
  const map = (await view.locator(".navigation-minimap").boundingBox())!,
    actions = (await view.locator(".camera-hud-actions").boundingBox())!,
    card = (await view.locator(".estimated-place-card").boundingBox())!,
    maneuver = (await view.locator(".hud-maneuver").boundingBox())!;
  expect(map.x + map.width).toBeLessThan(actions.x);
  expect(maneuver.x + maneuver.width).toBeLessThan(card.x);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await view.screenshot({ path: "reports/game-camera-mobile.png" });
  await view.getByRole("button", { name: "Use camera", exact: true }).click();
  await expect(view.getByText("Live camera", { exact: true })).toBeVisible();
  await expect(view.locator(".navigation-video")).toHaveClass(/is-live/);
  await expect(view.locator(".model-pose-preview")).toHaveCount(0);
  await page
    .locator(".model-camera-setup")
    .getByRole("button", { name: "Enable compass", exact: true })
    .click();
  await expect(
    page.getByText(/Waiting for absolute compass/).first(),
  ).toBeVisible();
  await page.evaluate(() => {
    const event = new Event("deviceorientationabsolute");
    Object.defineProperties(event, {
      alpha: { value: 260 },
      absolute: { value: true },
    });
    window.dispatchEvent(event);
  });
  await page
    .getByRole("button", { name: "Set this facing direction", exact: true })
    .click();
  await expect(
    view.getByRole("img", { name: "Estimated route over camera", exact: true }),
  ).toBeVisible();
  await expect(view.getByTestId("estimated-place-region")).toHaveText(
    "Back right",
  );
  await view.screenshot({ path: "reports/game-camera-synthetic-live.png" });
  const track = await view
    .locator("video")
    .evaluateHandle(
      (video) =>
        ((video as HTMLVideoElement).srcObject as MediaStream).getTracks()[0],
    );
  await view
    .getByRole("button", { name: "Use model preview", exact: true })
    .click();
  expect(await track.evaluate((t) => t.readyState)).toBe("ended");
  await expect(view.getByText("Model preview", { exact: true })).toBeVisible();
});
