import { test, expect, type Page } from "@playwright/test";

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
