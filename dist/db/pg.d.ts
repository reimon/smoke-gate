/**
 * @kaiketsu/smoke-gate/pg — helpers de fixture para Postgres.
 *
 * Não é um ORM. São primitivos pra seedar e limpar tabelas com PG real.
 * O ponto da lib é testar contra schema real — então deixamos o consumidor
 * escrever o SQL dele se quiser, mas oferecemos atalhos seguros.
 */
/** Tipo mínimo de `pg.Pool` — evita peer dep dura. */
export interface PgPoolLike {
    query: (sql: string, params?: unknown[]) => Promise<{
        rows: unknown[];
    }>;
}
/**
 * Insere registros tabela-a-tabela, na ordem fornecida.
 * Cada item: `{ table, columns, values }`.
 *
 * NÃO faz upsert — falha se conflito. Use `onConflict: "DO NOTHING"` para
 * permitir reseed idempotente.
 *
 * @example
 *   await seedTables(pool, [
 *     { table: "users", columns: ["id","email"], values: [["u1","x@y"]] },
 *     { table: "linkedin_profiles", columns: ["user_id","first_name"],
 *       values: [["u1","Alice"]], returning: "id" },
 *   ]);
 */
export interface SeedSpec {
    table: string;
    columns: string[];
    values: unknown[][];
    /** Cláusula ON CONFLICT (ex: "ON CONFLICT (id) DO NOTHING"). */
    onConflict?: string;
    /** Coluna para RETURNING — útil pra resgatar IDs gerados (SERIAL/UUID). */
    returning?: string;
}
export interface SeedResult {
    /** Por spec, na mesma ordem, a lista de valores da coluna RETURNING (se setado). */
    returned: unknown[][];
}
export declare function seedTables(pool: PgPoolLike, specs: SeedSpec[]): Promise<SeedResult>;
/**
 * Limpa registros explicitamente listados. Para casos em que CASCADE de FK
 * não cobre (ex: tabelas que referenciam por valor, não FK).
 *
 * Ordem importa — limpe filhos antes de pais.
 */
export declare function cleanupTables(pool: PgPoolLike, specs: Array<{
    table: string;
    where: string;
    params: unknown[];
}>): Promise<void>;
/**
 * Atalho: limpa uma cascata partindo de uma tabela "raiz" via FK ON DELETE
 * CASCADE. Útil quando o seu schema tem `users` como pai natural.
 */
export declare function cleanupByCascade(pool: PgPoolLike, rootTable: string, where: string, params: unknown[]): Promise<void>;
//# sourceMappingURL=pg.d.ts.map