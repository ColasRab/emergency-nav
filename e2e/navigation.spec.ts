import {
  test,
  expect,
  type BrowserContext,
  type Route,
} from "@playwright/test";
import { writeFile } from "node:fs/promises";
type Row = {
  id: string;
  buildingId: string;
  floor: number;
  nodeIds: number[];
  type: string;
  severity: number;
  confidence: number;
  source: string;
  confirmations: number;
  dismissals: number;
  createdAt: number;
  expiresAt: number;
};
async function mockApi(context: BrowserContext, rows: Row[]) {
  await context.route("**/api/hazards**", async (route: Route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const building = new URL(request.url()).searchParams.get("buildingId");
      await route.fulfill({
        json: {
          hazards: rows.filter(
            (h) => h.buildingId === building && h.expiresAt > Date.now(),
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
test("both scans load and building switching clears position", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Survey setup required.")).toBeVisible();
  await expect(
    page.getByText(/Loaded in .*scale and floors unverified/),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("combobox", { name: "Building", exact: true })
    .selectOption("ynares");
  await expect(
    page.getByLabel("Choose your approximate location"),
  ).toBeVisible();
  await page.getByLabel("Displayed floor").selectOption("1");
  await page.getByLabel("Choose your approximate location").selectOption("509");
  await expect(page.getByText(/Floor 1 · Estimated uncertainty/)).toBeVisible();
  await page
    .getByRole("combobox", { name: "Building", exact: true })
    .selectOption("admin");
  await expect(page.getByLabel("Choose your approximate location")).toHaveCount(
    0,
  );
});
test("two sessions share a scoped report within five seconds", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    rows: Row[] = [];
  await mockApi(a, rows);
  await mockApi(b, rows);
  const p = await a.newPage(),
    q = await b.newPage();
  await Promise.all([p.goto("/"), q.goto("/")]);
  for (const page of [p, q]) {
    await page
      .getByRole("combobox", { name: "Building", exact: true })
      .selectOption("ynares");
    await expect(
      page.getByLabel("Choose your approximate location"),
    ).toBeVisible();
  }
  await p.getByLabel("Displayed floor").selectOption("1");
  await p.getByLabel("Choose your approximate location").selectOption("509");
  await p.getByText("Report hazard", { exact: true }).click();
  await p.getByLabel("Hazard type").selectOption("blocked");
  await p
    .getByRole("combobox", { name: "Severity", exact: true })
    .selectOption("3");
  await p.getByRole("button", { name: "Confirm and report" }).click();
  await expect(
    q.getByRole("article").filter({ hasText: "blocked" }),
  ).toBeVisible({ timeout: 5000 });
  expect(rows).toHaveLength(1);
  expect(rows[0].buildingId).toBe("ynares");
  expect(rows[0].floor).toBe(1);
  await q
    .getByRole("combobox", { name: "Building", exact: true })
    .selectOption("admin");
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
  await context.addInitScript(() => {
    localStorage.setItem(
      "wayfinder:hazards:ynares:v1",
      JSON.stringify({
        hazards: [
          {
            id: "00000000-0000-4000-8000-000000000004",
            buildingId: "ynares",
            floor: 0,
            nodeIds: [1],
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
    );
  });
  const page = await context.newPage();
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Building", exact: true })
    .selectOption("ynares");
  await expect(page.getByText(/Offline hazards on this device/)).toBeVisible();
  await expect(
    page.getByRole("article").filter({ hasText: "obstruction" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("combobox", { name: "Building", exact: true })
    .selectOption("ynares");
  await expect(
    page.getByRole("article").filter({ hasText: "obstruction" }),
  ).toBeVisible();
  await context.close();
});
test("setup pages load and mobile layout has no horizontal overflow", async ({
  page,
}) => {
  for (const [path, heading] of [
    ["/admin/alignment", "Building alignment"],
    ["/admin/anchors", "QR anchor survey"],
    ["/admin/hazards", "Hazard administration"],
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByText(/Loaded in .*scale and floors unverified/),
  ).toBeVisible({ timeout: 15000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "reports/preview-mobile.png", fullPage: true });
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
test("records local scan rendering measurements", async ({ page }) => {
  const measurements = [];
  await page.goto("/admin/alignment");
  for (const id of ["admin", "ynares"]) {
    await page
      .getByRole("combobox", { name: "Building", exact: true })
      .selectOption(id);
    await expect(
      page.getByText(/Loaded in .*scale and floors unverified/),
    ).toBeVisible({ timeout: 15000 });
    const loadStatus = await page
      .getByText(/Loaded in .*scale and floors unverified/)
      .innerText();
    await page.getByText("Preview performance", { exact: true }).click();
    await page.getByRole("button", { name: "Run rendering check" }).click();
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
  await page.screenshot({
    path: "reports/preview-desktop.png",
    fullPage: false,
  });
});
