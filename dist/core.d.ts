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
    resolve?: (ctx: SmokeContext) => {
        path?: string;
        body?: unknown;
    };
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
    request(endpoint: SmokeEndpoint & {
        path: string;
    }): Promise<SmokeResponse>;
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
export declare class SmokeContext {
    private readonly store;
    set<T>(key: string, value: T): T;
    get<T = unknown>(key: string): T | undefined;
    require<T = unknown>(key: string): T;
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
export declare function defineSmokeSuite(suite: SmokeSuite): SmokeSuite;
/**
 * Roda a suite e retorna um relatório. NÃO joga — use o relatório pra integrar
 * com qualquer test runner (vitest, jest, tap, pytest via bridge).
 *
 * @example
 *   const report = await runSmokeSuite(suite);
 *   if (report.failed > 0) throw new Error(formatReport(report));
 */
export declare function runSmokeSuite(suite: SmokeSuite): Promise<SmokeRunReport>;
/**
 * Formata o report como texto pra exibir em falha de CI.
 */
export declare function formatReport(report: SmokeRunReport): string;
//# sourceMappingURL=core.d.ts.map