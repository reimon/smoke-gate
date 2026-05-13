"use strict";
/**
 * @kaiketsu/smoke-gate/pg — helpers de fixture para Postgres.
 *
 * Não é um ORM. São primitivos pra seedar e limpar tabelas com PG real.
 * O ponto da lib é testar contra schema real — então deixamos o consumidor
 * escrever o SQL dele se quiser, mas oferecemos atalhos seguros.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedTables = seedTables;
exports.cleanupTables = cleanupTables;
exports.cleanupByCascade = cleanupByCascade;
async function seedTables(pool, specs) {
    const returned = [];
    for (const spec of specs) {
        if (spec.values.length === 0) {
            returned.push([]);
            continue;
        }
        // Sanitiza nomes — apenas [a-zA-Z0-9_] são permitidos para evitar injection
        // via table/columns (params posicionais cobrem só values).
        assertIdent(spec.table);
        for (const col of spec.columns)
            assertIdent(col);
        if (spec.returning)
            assertIdent(spec.returning);
        const colCount = spec.columns.length;
        const placeholders = spec.values
            .map((_, rowIdx) => "(" +
            spec.columns.map((_c, cIdx) => `$${rowIdx * colCount + cIdx + 1}`).join(",") +
            ")")
            .join(",");
        const params = spec.values.flat();
        const sql = `INSERT INTO "${spec.table}" (${spec.columns.map((c) => `"${c}"`).join(",")}) ` +
            `VALUES ${placeholders} ` +
            (spec.onConflict ? `${spec.onConflict} ` : "") +
            (spec.returning ? `RETURNING "${spec.returning}"` : "");
        const result = await pool.query(sql, params);
        returned.push(spec.returning
            ? result.rows.map((r) => r[spec.returning])
            : []);
    }
    return { returned };
}
/**
 * Limpa registros explicitamente listados. Para casos em que CASCADE de FK
 * não cobre (ex: tabelas que referenciam por valor, não FK).
 *
 * Ordem importa — limpe filhos antes de pais.
 */
async function cleanupTables(pool, specs) {
    for (const spec of specs) {
        assertIdent(spec.table);
        await pool.query(`DELETE FROM "${spec.table}" WHERE ${spec.where}`, spec.params);
    }
}
/**
 * Atalho: limpa uma cascata partindo de uma tabela "raiz" via FK ON DELETE
 * CASCADE. Útil quando o seu schema tem `users` como pai natural.
 */
async function cleanupByCascade(pool, rootTable, where, params) {
    assertIdent(rootTable);
    await pool.query(`DELETE FROM "${rootTable}" WHERE ${where}`, params);
}
// ── Internals ────────────────────────────────────────────────────────────
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function assertIdent(s) {
    if (!IDENT_RE.test(s)) {
        throw new Error(`smoke-gate/pg: identificador inválido "${s}" (use [a-zA-Z0-9_])`);
    }
}
//# sourceMappingURL=pg.js.map