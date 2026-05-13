/**
 * @kaiketsu/smoke-gate/pg — helpers de fixture para Postgres.
 *
 * Não é um ORM. São primitivos pra seedar e limpar tabelas com PG real.
 * O ponto da lib é testar contra schema real — então deixamos o consumidor
 * escrever o SQL dele se quiser, mas oferecemos atalhos seguros.
 */

/** Tipo mínimo de `pg.Pool` — evita peer dep dura. */
export interface PgPoolLike {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
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

export async function seedTables(
  pool: PgPoolLike,
  specs: SeedSpec[],
): Promise<SeedResult> {
  const returned: unknown[][] = [];

  for (const spec of specs) {
    if (spec.values.length === 0) {
      returned.push([]);
      continue;
    }

    // Sanitiza nomes — apenas [a-zA-Z0-9_] são permitidos para evitar injection
    // via table/columns (params posicionais cobrem só values).
    assertIdent(spec.table);
    for (const col of spec.columns) assertIdent(col);
    if (spec.returning) assertIdent(spec.returning);

    const colCount = spec.columns.length;
    const placeholders = spec.values
      .map(
        (_, rowIdx) =>
          "(" +
          spec.columns.map((_c, cIdx) => `$${rowIdx * colCount + cIdx + 1}`).join(",") +
          ")",
      )
      .join(",");

    const params = spec.values.flat();
    const sql =
      `INSERT INTO "${spec.table}" (${spec.columns.map((c) => `"${c}"`).join(",")}) ` +
      `VALUES ${placeholders} ` +
      (spec.onConflict ? `${spec.onConflict} ` : "") +
      (spec.returning ? `RETURNING "${spec.returning}"` : "");

    const result = await pool.query(sql, params);
    returned.push(
      spec.returning
        ? (result.rows as Array<Record<string, unknown>>).map(
            (r) => r[spec.returning!],
          )
        : [],
    );
  }

  return { returned };
}

/**
 * Limpa registros explicitamente listados. Para casos em que CASCADE de FK
 * não cobre (ex: tabelas que referenciam por valor, não FK).
 *
 * Ordem importa — limpe filhos antes de pais.
 */
export async function cleanupTables(
  pool: PgPoolLike,
  specs: Array<{ table: string; where: string; params: unknown[] }>,
): Promise<void> {
  for (const spec of specs) {
    assertIdent(spec.table);
    await pool.query(
      `DELETE FROM "${spec.table}" WHERE ${spec.where}`,
      spec.params,
    );
  }
}

/**
 * Atalho: limpa uma cascata partindo de uma tabela "raiz" via FK ON DELETE
 * CASCADE. Útil quando o seu schema tem `users` como pai natural.
 */
export async function cleanupByCascade(
  pool: PgPoolLike,
  rootTable: string,
  where: string,
  params: unknown[],
): Promise<void> {
  assertIdent(rootTable);
  await pool.query(`DELETE FROM "${rootTable}" WHERE ${where}`, params);
}

// ── Internals ────────────────────────────────────────────────────────────
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function assertIdent(s: string): void {
  if (!IDENT_RE.test(s)) {
    throw new Error(
      `smoke-gate/pg: identificador inválido "${s}" (use [a-zA-Z0-9_])`,
    );
  }
}
