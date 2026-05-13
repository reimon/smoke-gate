"use strict";
/**
 * @kaiketsu/smoke-gate — core
 *
 * DSL pra declarar uma suite de smoke: lista de endpoints, fixtures de setup,
 * mocks, e driver de transporte (supertest / fastify.inject / fetch).
 *
 * Princípio: testa contra DB REAL. O ponto desta lib é pegar drift entre o
 * código SQL e o schema. Mockar `pool.query` derrota o propósito.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmokeContext = void 0;
exports.defineSmokeSuite = defineSmokeSuite;
exports.runSmokeSuite = runSmokeSuite;
exports.formatReport = formatReport;
/**
 * Estado compartilhado entre seed → endpoints → teardown.
 * Use `ctx.set(key, value)` no setup pra expor IDs/fixtures para
 * `endpoint.resolve(ctx)` ou pra teardown.
 */
class SmokeContext {
    constructor() {
        this.store = new Map();
    }
    set(key, value) {
        this.store.set(key, value);
        return value;
    }
    get(key) {
        return this.store.get(key);
    }
    require(key) {
        const v = this.store.get(key);
        if (v === undefined) {
            throw new Error(`smoke-gate: ctx.require("${key}") — chave não setada`);
        }
        return v;
    }
}
exports.SmokeContext = SmokeContext;
function defineSmokeSuite(suite) {
    return suite;
}
/**
 * Roda a suite e retorna um relatório. NÃO joga — use o relatório pra integrar
 * com qualquer test runner (vitest, jest, tap, pytest via bridge).
 *
 * @example
 *   const report = await runSmokeSuite(suite);
 *   if (report.failed > 0) throw new Error(formatReport(report));
 */
async function runSmokeSuite(suite) {
    const ctx = new SmokeContext();
    const startedAt = Date.now();
    const results = [];
    const notStatuses = suite.expect?.notStatuses ?? [500];
    try {
        if (suite.setup)
            await suite.setup(ctx);
        for (const ep of suite.endpoints) {
            const resolved = ep.resolve?.(ctx) ?? {};
            const finalPath = resolved.path ?? ep.path;
            const finalBody = resolved.body ?? ep.body;
            const requestSpec = { ...ep, path: finalPath, body: finalBody };
            try {
                const res = await suite.driver.request(requestSpec);
                const isFailStatus = notStatuses.includes(res.status);
                const okList = ep.okStatuses;
                const explicitOk = okList?.includes(res.status) ?? false;
                if (isFailStatus && !explicitOk) {
                    results.push({
                        endpoint: ep,
                        finalPath,
                        response: res,
                        status: "fail",
                        reason: `status ${res.status} ∈ notStatuses [${notStatuses.join(",")}]`,
                    });
                }
                else if (suite.expect?.maxLatencyMs !== undefined &&
                    res.durationMs > suite.expect.maxLatencyMs) {
                    results.push({
                        endpoint: ep,
                        finalPath,
                        response: res,
                        status: "fail",
                        reason: `latency ${res.durationMs}ms > max ${suite.expect.maxLatencyMs}ms`,
                    });
                }
                else {
                    results.push({
                        endpoint: ep,
                        finalPath,
                        response: res,
                        status: "pass",
                    });
                }
            }
            catch (err) {
                results.push({
                    endpoint: ep,
                    finalPath,
                    status: "error",
                    reason: err.message,
                });
            }
        }
    }
    finally {
        if (suite.teardown) {
            try {
                await suite.teardown(ctx);
            }
            catch (err) {
                // Não derruba o run — só loga. Falha de teardown é problema do
                // próprio seed, separado da validação dos endpoints.
                // eslint-disable-next-line no-console
                console.error(`[smoke-gate] teardown falhou: ${err.message}`);
            }
        }
    }
    return {
        suite: suite.name,
        total: results.length,
        passed: results.filter((r) => r.status === "pass").length,
        failed: results.filter((r) => r.status === "fail").length,
        errors: results.filter((r) => r.status === "error").length,
        durationMs: Date.now() - startedAt,
        results,
    };
}
/**
 * Formata o report como texto pra exibir em falha de CI.
 */
function formatReport(report) {
    const lines = [
        `smoke-gate: ${report.suite}`,
        `  total=${report.total} passed=${report.passed} failed=${report.failed} errors=${report.errors} (${report.durationMs}ms)`,
        "",
    ];
    for (const r of report.results) {
        const icon = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "‼";
        const name = r.endpoint.name ?? `${r.endpoint.method} ${r.finalPath}`;
        if (r.status === "pass") {
            lines.push(`  ${icon} ${name} (${r.response?.durationMs ?? 0}ms)`);
        }
        else {
            lines.push(`  ${icon} ${name}`);
            lines.push(`      → ${r.reason ?? "unknown"}`);
            if (r.response?.body) {
                const bodyStr = typeof r.response.body === "string"
                    ? r.response.body
                    : JSON.stringify(r.response.body);
                lines.push(`      body: ${bodyStr.slice(0, 300)}`);
            }
        }
    }
    return lines.join("\n");
}
//# sourceMappingURL=core.js.map