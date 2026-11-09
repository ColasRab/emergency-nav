import { test, expect, type BrowserContext } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { Hazard } from "../lib/hazards/model";
import { choosePlace, ready } from "./helpers";

async function mockApi(context: BrowserContext, rows: Hazard[]) {
  await context.route("**/api/hazards**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const id = new URL(request.url()).searchParams.get("buildingId");
      await route.fulfill({
        json: {
          hazards: rows.filter(
            (h) => h.buildingId === id && h.expiresAt > Date.now(),
          ),
          shared: true,
        },
      });
    } else {
      const body = request.postDataJSON();
      if (body.action === "create") {
        const row = {
          ...body,
          confirmations: body.confirmed ? 1 : 0,
          dismissals: 0,
          expiresAt: Date.now() + 1800000,
        };
        rows.push(row);
        await route.fulfill({ json: { hazard: row } });
      } else {
        const row = rows.find((h) => h.id === body.id)!;
        if (body.action === "confirm") row.confirmations++;
        if (body.action === "dismiss") row.dismissals++;
        await route.fulfill({ json: { hazard: row } });
      }
    }
  });
}

test("building switching clears the current position in the compact window", async ({
  page,
}) => {
  await ready(page);
  await choosePlace(page);
  await expect(page.getByTestId("estimated-place-name")).toHaveText("Marsden");
  await page
    .getByRole("combobox", { name: "Building", exact: true })
    .selectOption("admin");
  await expect(
    page.getByRole("combobox", { name: "Floor", exact: true }),
  ).toHaveValue("0");
  await expect(page.getByTestId("estimated-place-name")).toHaveText(
    "Position not set",
  );
  await choosePlace(page, "Euler", "Back right");
  await expect(page.getByTestId("estimated-place-name")).toHaveText("Euler");
});

test("two sessions share a scoped report within five seconds", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    rows: Hazard[] = [];
  await mockApi(a, rows);
  await mockApi(b, rows);
  const p = await a.newPage(),
    q = await b.newPage();
  await Promise.all([ready(p), ready(q)]);
  await choosePlace(p, "Rutherford", "Right door");
  await q.getByRole("button", { name: /^Reports/ }).click();
  await p.getByRole("button", { name: /^Reports/ }).click();
  const dialog = p.getByRole("dialog", { name: "Hazard reports", exact: true });
  await dialog.getByText("Report hazard", { exact: true }).click();
  await dialog.getByLabel("Hazard type").selectOption("blocked");
  await dialog
    .getByRole("combobox", { name: "Severity", exact: true })
    .selectOption("3");
  await dialog
    .getByRole("button", { name: "Confirm and report", exact: true })
    .click();
  await expect(
    q.getByRole("article").filter({ hasText: "blocked" }),
  ).toBeVisible({ timeout: 5000 });
  expect(rows).toHaveLength(1);
  expect(rows[0].buildingId).toBe("ynares");
  expect(rows[0].floor).toBe(1);
  await q.getByRole("button", { name: "Close panel", exact: true }).click();
  await q
    .getByRole("combobox", { name: "Building", exact: true })
    .selectOption("admin");
  await q.getByRole("button", { name: /^Reports/ }).click();
  await expect(
    q.getByRole("article").filter({ hasText: "blocked" }),
  ).toHaveCount(0);
  await a.close();
  await b.close();
});

test("offline reports survive reload and remain explicitly local", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.route("**/api/hazards**", (route) => route.abort());
  await context.addInitScript(() =>
    localStorage.setItem(
      "wayfinder:hazards:ynares:v1",
      JSON.stringify({
        hazards: [
          {
            id: "00000000-0000-4000-8000-000000000004",
            buildingId: "ynares",
            floor: 0,
            nodeIds: [200000],
            type: "obstruction",
            severity: 1,
            confidence: 1,
            source: "user",
            confirmations: 1,
            dismissals: 0,
            createdAt: Date.now(),
            expiresAt: Date.now() + 600000,
          },
        ],
        pending: [],
      }),
    ),
  );
  const page = await context.newPage();
  await ready(page);
  await page.getByRole("button", { name: /^Reports/ }).click();
  await expect(page.getByText(/Offline hazards on this device/)).toBeVisible();
  await expect(
    page.getByRole("article").filter({ hasText: "obstruction" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Reports/ }).click();
  await expect(
    page.getByRole("article").filter({ hasText: "obstruction" }),
  ).toBeVisible();
  await context.close();
});

test("advanced pages load and the old sticker setup redirects to GPS location calibration", async ({
  page,
}) => {
  for (const [path, heading] of [
    ["/admin/alignment", "Building alignment"],
    ["/admin/hazards", "Hazard administration"],
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
  await page.goto("/admin/anchors");
  await expect(
    page.getByRole("dialog", { name: "Calibrate by location", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "First location", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Scan QR|Print sticker/ }),
  ).toHaveCount(0);
});

test("live Supabase read endpoint is available and invalid writes are rejected", async ({
  request,
}) => {
  const read = await request.get("/api/hazards?buildingId=ynares");
  expect(read.status()).toBe(200);
  expect((await read.json()).shared).toBe(true);
  const invalid = await request.post("/api/hazards", {
    data: { action: "create", buildingId: "not-a-building" },
  });
  expect(invalid.status()).toBe(400);
});

test("records local room-model rendering measurements", async ({ page }) => {
  const measurements = [];
  await page.goto("/admin/alignment");
  for (const id of ["admin", "ynares"]) {
    await page
      .getByRole("combobox", { name: "Building", exact: true })
      .selectOption(id);
    await expect(
      page.getByText(/Loaded in .*estimated room model/),
    ).toBeVisible({ timeout: 15000 });
    const loadStatus = await page
      .getByText(/Loaded in .*estimated room model/)
      .innerText();
    await page.getByText("Preview performance", { exact: true }).click();
    await page
      .getByRole("button", { name: "Run rendering check", exact: true })
      .click();
    const metric = page.locator("[data-preview-fps]");
    await expect(metric).not.toHaveAttribute("data-preview-fps", "");
    measurements.push({
      buildingId: id,
      loadStatus,
      fps: Number(await metric.getAttribute("data-preview-fps")),
      environment:
        "Windows desktop Edge, headless software rendering; localhost; not a phone or 4G measurement",
    });
  }
  await writeFile(
    "reports/local-rendering.json",
    JSON.stringify(measurements, null, 2),
  );
});

test("the reconstructed models, reference scans and download bundles remain available", async ({
  request,
}) => {
  for (const [id, count] of [
    ["admin", 6],
    ["ynares", 15],
  ] as const) {
    const response = await request.get(`/models/${id}.json`);
    expect(response.status()).toBe(200);
    const config = await response.json();
    expect(config.rooms).toHaveLength(count);
    expect(config.modelVerified).toBe(false);
    for (const asset of [
      config.glb,
      config.scanGlb,
      `/models/${id}-rooms-bundle.zip`,
    ])
      expect((await request.head(asset)).status()).toBe(200);
  }
});
