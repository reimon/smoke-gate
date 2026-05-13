import { describe, it, expect } from "vitest";
import {
  defineSmokeSuite,
  runSmokeSuite,
  formatReport,
  type SmokeDriver,
  type SmokeResponse,
} from "./core";

/** Driver fake — retorna status/body pré-definido por path. */
function fakeDriver(
  responses: Record<string, Partial<SmokeResponse>>,
): SmokeDriver {
  return {
    async request(ep) {
      const r = responses[ep.path] ?? { status: 200, body: {} };
      return {
        status: r.status ?? 200,
        body: r.body ?? {},
        durationMs: r.durationMs ?? 10,
      };
    },
  };
}

describe("core: runSmokeSuite", () => {
  it("passa quando todos endpoints retornam 200", async () => {
    const report = await runSmokeSuite(
      defineSmokeSuite({
        name: "happy",
        driver: fakeDriver({
          "/a": { status: 200 },
          "/b": { status: 200 },
        }),
        endpoints: [
          { method: "GET", path: "/a" },
          { method: "GET", path: "/b" },
        ],
      }),
    );
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(0);
  });

  it("falha quando endpoint retorna 500", async () => {
    const report = await runSmokeSuite(
      defineSmokeSuite({
        name: "broken",
        driver: fakeDriver({
          "/a": { status: 200 },
          "/b": { status: 500, body: { error: "boom" } },
        }),
        endpoints: [
          { method: "GET", path: "/a" },
          { method: "GET", path: "/b" },
        ],
      }),
    );
    expect(report.failed).toBe(1);
    expect(report.results[1].reason).toContain("500");
  });

  it("respeita okStatuses por endpoint (422 aceitável)", async () => {
    const report = await runSmokeSuite(
      defineSmokeSuite({
        name: "explicit-422",
        driver: fakeDriver({ "/needs-import": { status: 422 } }),
        endpoints: [
          { method: "GET", path: "/needs-import", okStatuses: [200, 422] },
        ],
        expect: { notStatuses: [500, 422] }, // 422 globalmente fail, mas...
      }),
    );
    // ...okStatuses local sobrescreve.
    expect(report.passed).toBe(1);
  });

  it("captura exception do driver como 'error'", async () => {
    const report = await runSmokeSuite(
      defineSmokeSuite({
        name: "throws",
        driver: {
          async request() {
            throw new Error("connection refused");
          },
        },
        endpoints: [{ method: "GET", path: "/a" }],
      }),
    );
    expect(report.errors).toBe(1);
    expect(report.results[0].reason).toBe("connection refused");
  });

  it("setup expõe ctx pra resolve() do endpoint", async () => {
    const report = await runSmokeSuite(
      defineSmokeSuite({
        name: "dynamic-path",
        driver: fakeDriver({
          "/profile/42": { status: 200 },
        }),
        setup: (ctx) => {
          ctx.set("profileId", 42);
        },
        endpoints: [
          {
            method: "GET",
            path: "/profile/PLACEHOLDER",
            resolve: (ctx) => ({ path: `/profile/${ctx.require("profileId")}` }),
          },
        ],
      }),
    );
    expect(report.passed).toBe(1);
  });

  it("teardown roda mesmo após falha de endpoint", async () => {
    let teardownCalled = false;
    await runSmokeSuite(
      defineSmokeSuite({
        name: "cleanup",
        driver: fakeDriver({ "/a": { status: 500 } }),
        endpoints: [{ method: "GET", path: "/a" }],
        teardown: () => {
          teardownCalled = true;
        },
      }),
    );
    expect(teardownCalled).toBe(true);
  });

  it("respeita maxLatencyMs", async () => {
    const report = await runSmokeSuite(
      defineSmokeSuite({
        name: "slow",
        driver: fakeDriver({ "/slow": { status: 200, durationMs: 5000 } }),
        endpoints: [{ method: "GET", path: "/slow" }],
        expect: { maxLatencyMs: 1000 },
      }),
    );
    expect(report.failed).toBe(1);
    expect(report.results[0].reason).toContain("latency");
  });
});

describe("core: formatReport", () => {
  it("imprime resumo + falhas com body", async () => {
    const report = await runSmokeSuite(
      defineSmokeSuite({
        name: "demo",
        driver: fakeDriver({
          "/ok": { status: 200 },
          "/bad": { status: 500, body: { error: "column missing" } },
        }),
        endpoints: [
          { method: "GET", path: "/ok" },
          { method: "GET", path: "/bad" },
        ],
      }),
    );
    const txt = formatReport(report);
    expect(txt).toContain("total=2 passed=1 failed=1");
    expect(txt).toContain("✓ GET /ok");
    expect(txt).toContain("✗ GET /bad");
    expect(txt).toContain("column missing");
  });
});
