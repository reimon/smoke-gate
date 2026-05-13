"use strict";
/**
 * @kaiketsu/smoke-gate/vitest — bridge para vitest.
 *
 * Gera `it.each()` automaticamente a partir de uma suite. Cada endpoint vira
 * um teste com nome legível e falha individual — assim CI mostra qual quebrou.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerVitestSuite = registerVitestSuite;
exports.registerVitestSingleTest = registerVitestSingleTest;
const vitest_1 = require("vitest");
const core_1 = require("./core");
/**
 * Registra a suite no vitest. Cada endpoint vira `it()` separado.
 *
 * @example
 *   registerVitestSuite(careerIntelSmoke);
 */
function registerVitestSuite(suite) {
    (0, vitest_1.describe)(suite.name, () => {
        const ctx = new core_1.SmokeContext();
        (0, vitest_1.beforeAll)(async () => {
            if (suite.setup)
                await suite.setup(ctx);
        });
        (0, vitest_1.afterAll)(async () => {
            if (suite.teardown) {
                try {
                    await suite.teardown(ctx);
                }
                catch (err) {
                    // eslint-disable-next-line no-console
                    console.error(`[smoke-gate] teardown falhou: ${err.message}`);
                }
            }
        });
        const notStatuses = suite.expect?.notStatuses ?? [500];
        for (const ep of suite.endpoints) {
            const name = ep.name ?? `${ep.method} ${ep.path}`;
            (0, vitest_1.it)(name, async () => {
                const resolved = ep.resolve?.(ctx) ?? {};
                const path = resolved.path ?? ep.path;
                const body = resolved.body ?? ep.body;
                const res = await suite.driver.request({ ...ep, path, body });
                const explicitOk = ep.okStatuses?.includes(res.status) ?? false;
                const fails = notStatuses.includes(res.status) && !explicitOk;
                if (fails) {
                    // Log detalhado pra CI
                    // eslint-disable-next-line no-console
                    console.error(`[smoke] ${ep.method} ${path} → ${res.status}`, res.body);
                }
                if (fails) {
                    throw new Error(`${ep.method} ${path}: status ${res.status} ∈ notStatuses [${notStatuses.join(",")}]`);
                }
                if (suite.expect?.maxLatencyMs !== undefined) {
                    (0, vitest_1.expect)(res.durationMs, `${ep.method} ${path} latency`).toBeLessThanOrEqual(suite.expect.maxLatencyMs);
                }
            });
        }
    });
}
/**
 * Modo single-test: roda toda a suite num único `it()`, retorna report único.
 * Útil pra rodar a suite como guard em outro test runner que não suporta
 * descoberta dinâmica de testes.
 */
function registerVitestSingleTest(suite) {
    (0, vitest_1.describe)(suite.name, () => {
        (0, vitest_1.it)("todos os endpoints retornam status aceitável", async () => {
            const report = await (0, core_1.runSmokeSuite)(suite);
            if (report.failed + report.errors > 0) {
                const failed = report.results
                    .filter((r) => r.status !== "pass")
                    .map((r) => `  - ${r.endpoint.method} ${r.finalPath} → ${r.reason ?? "?"}`)
                    .join("\n");
                throw new Error(`${report.failed} failed, ${report.errors} errors in ${report.total}:\n${failed}`);
            }
            (0, vitest_1.expect)(report.passed).toBe(report.total);
        });
    });
}
//# sourceMappingURL=vitest.js.map