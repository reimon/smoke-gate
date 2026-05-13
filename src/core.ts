/**
 * @kaiketsu/smoke-gate — core
 *
 * DSL pra declarar uma suite de smoke: lista de endpoints, fixtures de setup,
 * mocks, e driver de transporte (supertest / fastify.inject / fetch).
 *
 * Princípio: testa contra DB REAL. O ponto desta lib é pegar drift entre o
 * código SQL e o schema. Mockar `pool.query` derrota o propósito.
 */

export type SmokeMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface SmokeEndpoint {
  /** Identificador legível para logs/relatórios. Default: `${method} ${path}`. */
  name?: string;
  method: SmokeMethod;
  /** Path absoluto a partir do mount do app (ex: "/career-intelligence/abc/overview"). */
  path: string;
  /** Body opcional para POST/PUT/PATCH. */
  body?: unknown;
  /** Headers extras (ex: { "x-trace-id": "smoke" }). */
  headers?: Record<string, string>;
  /**
   * Status codes aceitáveis. Default: qualquer status que NÃO esteja em
   * `expect.notStatuses` da suite (ex: 500 → falha).
   * Use quando um endpoint específico tem 422/404 como resultado válido.
   */
  okStatuses?: number[];
  /**
   * Resolver opcional: roda no momento do teste (após setup) para construir
   * o path/body a partir de estado dinâmico (ex: profileId que só existe
   * depois do seed).
   */
  resolve?: (ctx: SmokeContext) => { path?: string; body?: unknown };
}

export interface SmokeExpect {
  /** Status codes que devem causar falha. Default: [500]. */
  notStatuses?: number[];
  /** Falha se p95 de latência por endpoint exceder. Default: sem limite. */
  maxLatencyMs?: number;
}

/**
 * Driver de transporte: implementa como bater no app. A lib oferece
 * `supertestDriver` (Express) e adaptadores são plugáveis.
 */
export interface SmokeDriver {
  request(
    endpoint: SmokeEndpoint & { path: string },
  ): Promise<SmokeResponse>;
}

export interface SmokeResponse {
  status: number;
  body: unknown;
  /** Header útil para diagnóstico. */
  headers?: Record<string, string>;
  /** Latência ms (medida pelo driver). */
  durationMs: number;
}

/**
 * Estado compartilhado entre seed → endpoints → teardown.
 * Use `ctx.set(key, value)` no setup pra expor IDs/fixtures para
 * `endpoint.resolve(ctx)` ou pra teardown.
 */
export class SmokeContext {
  private readonly store = new Map<string, unknown>();
  set<T>(key: string, value: T): T {
    this.store.set(key, value);
    return value;
  }
  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  require<T = unknown>(key: string): T {
    const v = this.store.get(key);
    if (v === undefined) {
      throw new Error(`smoke-gate: ctx.require("${key}") — chave não setada`);
    }
    return v as T;
  }
}

export interface SmokeSuite {
  /** Nome do suite (aparece em logs). */
  name: string;
  /** Driver de transporte. */
  driver: SmokeDriver;
  /** Lista de endpoints a verificar. */
  endpoints: SmokeEndpoint[];
  /** Seed: roda 1× antes de todos os endpoints. */
  setup?: (ctx: SmokeContext) => Promise<void> | void;
  /** Cleanup: roda 1× após o último endpoint, mesmo em caso de falha. */
  teardown?: (ctx: SmokeContext) => Promise<void> | void;
  /** Critérios de aprovação. */
  expect?: SmokeExpect;
}

export interface SmokeResult {
  endpoint: SmokeEndpoint;
  finalPath: string;
  response?: SmokeResponse;
  /** "pass" | "fail" | "error" (exception fora do HTTP). */
  status: "pass" | "fail" | "error";
  /** Mensagem de falha (vazia em pass). */
  reason?: string;
}

export interface SmokeRunReport {
  suite: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  durationMs: number;
  results: SmokeResult[];
}

export function defineSmokeSuite(suite: SmokeSuite): SmokeSuite {
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
export async function runSmokeSuite(
  suite: SmokeSuite,
): Promise<SmokeRunReport> {
  const ctx = new SmokeContext();
  const startedAt = Date.now();
  const results: SmokeResult[] = [];
  const notStatuses = suite.expect?.notStatuses ?? [500];

  try {
    if (suite.setup) await suite.setup(ctx);

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
        } else if (
          suite.expect?.maxLatencyMs !== undefined &&
          res.durationMs > suite.expect.maxLatencyMs
        ) {
          results.push({
            endpoint: ep,
            finalPath,
            response: res,
            status: "fail",
            reason: `latency ${res.durationMs}ms > max ${suite.expect.maxLatencyMs}ms`,
          });
        } else {
          results.push({
            endpoint: ep,
            finalPath,
            response: res,
            status: "pass",
          });
        }
      } catch (err) {
        results.push({
          endpoint: ep,
          finalPath,
          status: "error",
          reason: (err as Error).message,
        });
      }
    }
  } finally {
    if (suite.teardown) {
      try {
        await suite.teardown(ctx);
      } catch (err) {
        // Não derruba o run — só loga. Falha de teardown é problema do
        // próprio seed, separado da validação dos endpoints.
        // eslint-disable-next-line no-console
        console.error(
          `[smoke-gate] teardown falhou: ${(err as Error).message}`,
        );
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
export function formatReport(report: SmokeRunReport): string {
  const lines: string[] = [
    `smoke-gate: ${report.suite}`,
    `  total=${report.total} passed=${report.passed} failed=${report.failed} errors=${report.errors} (${report.durationMs}ms)`,
    "",
  ];
  for (const r of report.results) {
    const icon =
      r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "‼";
    const name = r.endpoint.name ?? `${r.endpoint.method} ${r.finalPath}`;
    if (r.status === "pass") {
      lines.push(`  ${icon} ${name} (${r.response?.durationMs ?? 0}ms)`);
    } else {
      lines.push(`  ${icon} ${name}`);
      lines.push(`      → ${r.reason ?? "unknown"}`);
      if (r.response?.body) {
        const bodyStr =
          typeof r.response.body === "string"
            ? r.response.body
            : JSON.stringify(r.response.body);
        lines.push(`      body: ${bodyStr.slice(0, 300)}`);
      }
    }
  }
  return lines.join("\n");
}
