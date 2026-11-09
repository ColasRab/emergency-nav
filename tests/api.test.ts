import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/hazards/route";
const state = vi.hoisted(() => ({
  inserts: 0,
  record: null as Record<string, unknown> | null,
}));
vi.mock("../lib/hazards/server", () => ({
  serverBuilding: async () => ({
    config: {
      floors: [{ index: 0 }],
      settings: { crowd: { ttlMs: 600000 }, hazards: { ttlMs: 1800000 } },
    },
    graph: {
      nodes: { 0: [0, 0, 0], 1: [1, 0, 0], 2: [0, 0, 1] },
      edges: { 0: [[1, 1]] },
    },
  }),
  serverSupabase: () => ({
    from: () => {
      let inserting = false,
        payload: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: state.record, error: null }),
        insert: (data: Record<string, unknown>) => {
          inserting = true;
          payload = data;
          return q;
        },
        single: async () => {
          if (inserting) {
            state.inserts++;
            state.record = payload;
          }
          return { data: state.record, error: null };
        },
      };
      return q;
    },
    rpc: async () => ({
      data: { ...state.record, confirmations: 1 },
      error: null,
    }),
  }),
}));
const report = () => ({
  action: "create",
  id: crypto.randomUUID(),
  buildingId: "ynares",
  floor: 0,
  nodeIds: [0],
  type: "blocked",
  severity: 3,
  confidence: 1,
  source: "user",
  createdAt: Date.now(),
  confirmed: true,
});
const request = (body: unknown, origin?: string) =>
  new NextRequest("http://localhost/api/hazards", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  state.record = null;
  state.inserts = 0;
});
it("rejects cross-floor scope and cross-origin requests", async () => {
  expect((await POST(request({ ...report(), nodeIds: [2] }))).status).toBe(400);
  expect((await POST(request(report(), "https://other.example"))).status).toBe(
    403,
  );
});
it("requires admin authorization for persistent hazards", async () => {
  expect((await POST(request({ ...report(), source: "admin" }))).status).toBe(
    403,
  );
});
it("inserts a confirmed user report and makes offline retries idempotent", async () => {
  const body = report();
  const first = await POST(request(body));
  expect(first.status).toBe(200);
  expect((await first.json()).hazard.confirmations).toBe(1);
  expect((await POST(request(body))).status).toBe(200);
  expect(state.inserts).toBe(1);
});
it("rejects expired offline reports instead of renewing their TTL", async () => {
  expect((await POST(request({ ...report(), createdAt: 0 }))).status).toBe(410);
  expect(state.inserts).toBe(0);
});
