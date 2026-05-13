/**
 * Verifica uma string SQL standalone contra o schema cacheado.
 *
 * Usado pelo MCP tool `audit_check_sql` — o killer feature de "prevenção
 * em tempo real". Agente prestes a gerar uma query chama isso primeiro
 * e ajusta a query se houver problema.
 */
import type { Schema } from "./schemaCache";
export interface SqlIssue {
    kind: "column_not_found" | "table_unknown" | "ambiguous_alias";
    alias?: string;
    table?: string;
    column?: string;
    message: string;
    /** Coluna mais próxima (Levenshtein) — sugestão de correção. */
    suggestion?: string;
}
export interface CheckSqlResult {
    ok: boolean;
    issues: SqlIssue[];
    /** Lista de tabelas reconhecidas (debugging). */
    tablesUsed: string[];
}
export declare function checkSql(sql: string, schema: Schema): CheckSqlResult;
//# sourceMappingURL=checkSql.d.ts.map