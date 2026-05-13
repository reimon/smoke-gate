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

export function checkSql(sql: string, schema: Schema): CheckSqlResult {
  const issues: SqlIssue[] = [];
  const cteNames = parseCteNames(sql);
  const aliasMap = parseAliases(sql);
  const tablesUsed = new Set<string>();

  for (const [_, t] of aliasMap) {
    if (t !== null && !cteNames.has(t)) tablesUsed.add(t);
  }

  const refs = parseColumnRefs(sql);
  for (const ref of refs) {
    if (cteNames.has(ref.alias)) continue;
    const table = aliasMap.get(ref.alias);
    if (table === undefined) continue;
    if (table === null) {
      issues.push({
        kind: "ambiguous_alias",
        alias: ref.alias,
        column: ref.column,
        message: `Alias '${ref.alias}' reusado pra tabelas diferentes — refs ambíguas, smoke-gate não consegue validar.`,
      });
      continue;
    }
    if (cteNames.has(table)) continue;
    const cols = schema.get(table.toLowerCase());
    if (!cols) {
      issues.push({
        kind: "table_unknown",
        alias: ref.alias,
        table,
        message: `Tabela '${table}' não está no schema conhecido (nenhuma migration define).`,
      });
      continue;
    }
    if (!cols.has(ref.column.toLowerCase())) {
      issues.push({
        kind: "column_not_found",
        alias: ref.alias,
        table,
        column: ref.column,
        suggestion: suggestColumn(ref.column, cols),
        message: `Coluna '${ref.column}' não existe em ${table}.`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    tablesUsed: [...tablesUsed],
  };
}

// ── Internals (duplicados do detector — TODO: extrair pra módulo comum) ──

function parseCteNames(sql: string): Set<string> {
  const out = new Set<string>();
  if (!/\bWITH\b/i.test(sql)) return out;
  const re = /(?:WITH|,)\s+([a-zA-Z_]\w*)\s+AS\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) out.add(m[1].toLowerCase());
  return out;
}

function parseAliases(sql: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const re =
    /(?:FROM|JOIN)\s+(?:public\.)?["']?(\w+)["']?(?:\s+AS\s+|\s+)?["']?(\w+)?["']?(?=\s+(?:ON|USING|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|GROUP|ORDER|LIMIT|HAVING|RETURNING|\)|$))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const table = m[1].toLowerCase();
    const alias = m[2];
    let key: string;
    if (
      alias &&
      !["WHERE", "GROUP", "ORDER", "ON", "USING", "JOIN", "LEFT"].includes(
        alias.toUpperCase(),
      )
    ) {
      key = alias.toLowerCase();
    } else {
      key = table;
    }
    const existing = out.get(key);
    if (existing === undefined) out.set(key, table);
    else if (existing !== null && existing !== table) out.set(key, null);
  }
  return out;
}

interface ColumnRef {
  alias: string;
  column: string;
  offset: number;
}

function parseColumnRefs(sql: string): ColumnRef[] {
  const out: ColumnRef[] = [];
  const re = /\b([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const alias = m[1];
    const column = m[2];
    if (
      ["public", "pg_catalog", "information_schema"].includes(alias.toLowerCase())
    )
      continue;
    if (isInsideQuote(sql, m.index)) continue;
    out.push({ alias: alias.toLowerCase(), column, offset: m.index });
  }
  return out;
}

function isInsideQuote(s: string, idx: number): boolean {
  let inSingle = false;
  for (let i = 0; i < idx; i++) {
    if (s[i] === "'" && s[i - 1] !== "\\") inSingle = !inSingle;
  }
  return inSingle;
}

function suggestColumn(wrong: string, available: Set<string>): string {
  let best: { col: string; dist: number } | null = null;
  for (const col of available) {
    const d = levenshtein(wrong.toLowerCase(), col.toLowerCase());
    if (!best || d < best.dist) best = { col, dist: d };
  }
  if (best && best.dist <= 4) return best.col;
  return [...available].slice(0, 5).join(", ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr.push(Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
    }
    for (let j = 0; j < curr.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
