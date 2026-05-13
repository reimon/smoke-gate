/**
 * sqlDrift — encontra referências a colunas em código SQL que NÃO existem
 * no schema definido pelas migrations.
 *
 * Heurística:
 *   1. Parse migrations (.sql) → mapa { table → Set<columns> }
 *   2. Walk arquivos .ts/.js → extrai template literals que contenham SELECT/INSERT/UPDATE/DELETE
 *   3. Para cada SQL string, extrai aliases (FROM x AS y, JOIN x y) e referências `alias.col`
 *   4. Se `col` não existe em `schema[table_de_alias]` → finding
 *
 * Limitações:
 *   - Não lida com queries dinâmicas montadas via concatenação fora do template
 *   - Não resolve VIEW que mapeia colunas
 *   - Falsos positivos possíveis em colunas de tabelas externas (não migration)
 *   - Falsos negativos em colunas sem alias (ex: SELECT col FROM table)
 *
 * Mesmo assim, pega 80% dos casos que motivaram o framework
 * (lat.created_at, msg.content, c.has_attachments, etc.).
 */

import * as path from "path";
import type { AuditContext, Detector, Finding } from "../types";
import {
  applyFileFilter,
  extractSnippet,
  lineOfIndex,
  readFileSafe,
  relPath,
  walkFiles,
} from "../util";

type Schema = Map<string, Set<string>>;

const CODE_PREFIX = "SQL";

export const sqlDriftDetector: Detector = {
  name: "sqlDrift",

  async run(ctx: AuditContext): Promise<Finding[]> {
    const schema = loadSchema(ctx);
    if (schema.size === 0) {
      // Sem migrations não dá pra cross-referenciar; emite info finding único.
      return [
        {
          code: `${CODE_PREFIX}-000`,
          detector: this.name,
          severity: "info",
          title:
            "sqlDrift desabilitado: nenhuma migration .sql encontrada para cross-referência",
          location: { file: "<global>", line: 0 },
          snippet: "",
          evidence: `Configure ctx.migrationsPath para um diretório com arquivos .sql.`,
        },
      ];
    }

    const findings: Finding[] = [];
    const codeFiles = applyFileFilter(
      walkFiles(ctx.root, [".ts", ".js"], ctx.ignore),
      ctx.root,
      ctx.fileFilter,
    );

    for (const fp of codeFiles) {
      const source = readFileSafe(fp);
      if (!source) continue;
      const sqlStrings = extractSqlTemplates(source);

      for (const sqlMatch of sqlStrings) {
        const cteNames = parseCteNames(sqlMatch.sql);
        const aliasMap = parseAliases(sqlMatch.sql);
        const refs = parseColumnRefs(sqlMatch.sql);

        for (const ref of refs) {
          // CTE: alias é nome de WITH foo AS (...) — não tem schema fixo
          if (cteNames.has(ref.alias)) continue;
          const table = aliasMap.get(ref.alias);
          if (table === undefined) continue; // alias desconhecido — subquery, ignore
          if (table === null) continue; // ambíguo (reusado em subqueries diferentes)
          // CTE também aparece como alias quando consumida (FROM cte_name)
          if (cteNames.has(table)) continue;
          const cols = schema.get(table.toLowerCase());
          if (!cols) continue; // tabela não está nas migrations (externa)
          if (!cols.has(ref.column.toLowerCase())) {
            const line = lineOfIndex(source, sqlMatch.startIndex + ref.offset);
            findings.push({
              code: `${CODE_PREFIX}-001`,
              detector: this.name,
              severity: "critical",
              title: `Coluna '${ref.column}' não existe em ${table}`,
              location: { file: relPath(ctx.root, fp), line },
              snippet: extractSnippet(source, line, 3),
              evidence: `Migration define ${table}(${[...cols].slice(0, 8).join(", ")}${cols.size > 8 ? ", ..." : ""}); código referencia "${ref.alias}.${ref.column}" mas a coluna não existe. Quebra em runtime.`,
              suggestedFix: suggestColumn(ref.column, cols),
            });
          }
        }
      }
    }

    return findings;
  },
};

// ── Schema loading ────────────────────────────────────────────────────────
function loadSchema(ctx: AuditContext): Schema {
  const schema: Schema = new Map();

  // Carrega TODOS os .sql sob api/ (ou root) — base + migrations + alterações.
  // Antes só lia migrations/, mas o schema base costuma ficar em
  // api/azure-migration.sql ou similar, e perdê-lo gera milhares de falsos
  // positivos (todas as colunas da tabela parecem ausentes).
  const sqlRoots = collectSqlRoots(ctx);
  for (const root of sqlRoots) {
    const files = walkFiles(root, [".sql"], ctx.ignore ?? []);
    for (const fp of files) {
      const sql = readFileSafe(fp);
      parseCreateTables(sql, schema);
      parseAlterTables(sql, schema);
    }
  }
  return schema;
}

function collectSqlRoots(ctx: AuditContext): string[] {
  const fs = require("fs") as typeof import("fs");
  const candidates = [
    ctx.migrationsPath,
    path.join(ctx.root, "api", "migrations"),
    path.join(ctx.root, "api"),
    path.join(ctx.root, "migrations"),
    path.join(ctx.root, "db", "migrations"),
    path.join(ctx.root, "db"),
  ].filter(Boolean) as string[];

  const found: string[] = [];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) found.push(c);
  }
  return found;
}

const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?\s*\(/gi;

function parseCreateTables(sql: string, schema: Schema): void {
  // Remove comentários SQL antes — comentários inline depois de ","
  // engoliam a próxima coluna no parser, gerando milhares de falsos positivos.
  const stripped = stripSqlComments(sql);
  let m: RegExpExecArray | null;
  while ((m = CREATE_TABLE_RE.exec(stripped)) !== null) {
    const table = m[1].toLowerCase();
    const bodyStart = m.index + m[0].length;
    const body = extractBalancedParens(stripped, bodyStart);
    if (body === null) continue;
    if (!schema.has(table)) schema.set(table, new Set());
    const cols = schema.get(table)!;
    for (const colName of extractColumnsFromBody(body)) {
      cols.add(colName.toLowerCase());
    }
  }
}

/**
 * Dado uma string e um índice JUST AFTER um '(', retorna o conteúdo
 * até o ')' balanceado correspondente. Ignora parens dentro de strings.
 */
function extractBalancedParens(s: string, start: number): string | null {
  let depth = 1;
  let inSingle = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && s[i - 1] !== "\\") inSingle = !inSingle;
    if (inSingle) continue;
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return s.slice(start, i);
    }
  }
  return null;
}

function stripSqlComments(sql: string): string {
  // Remove `-- ...` até fim da linha + `/* ... */` blocos.
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractColumnsFromBody(body: string): string[] {
  const out: string[] = [];
  // Split por vírgula no nível 0 (sem balanceamento de parênteses).
  const parts = splitTopLevel(body, ",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Pula CONSTRAINT, PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK ao nível
    if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)\b/i.test(trimmed))
      continue;
    // Primeira palavra é o nome da coluna (sem aspas).
    const colMatch = trimmed.match(/^["']?(\w+)["']?\s+/);
    if (colMatch) out.push(colMatch[1]);
  }
  return out;
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf) out.push(buf);
  return out;
}

const ALTER_TABLE_RE =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?\s+([\s\S]*?);/gi;
const ADD_COLUMN_RE =
  /ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/gi;

function parseAlterTables(sql: string, schema: Schema): void {
  const stripped = stripSqlComments(sql);
  let outer: RegExpExecArray | null;
  while ((outer = ALTER_TABLE_RE.exec(stripped)) !== null) {
    const table = outer[1].toLowerCase();
    const body = outer[2];
    // Pode ter múltiplos ADD COLUMN separados por vírgula no mesmo ALTER.
    ADD_COLUMN_RE.lastIndex = 0;
    let inner: RegExpExecArray | null;
    while ((inner = ADD_COLUMN_RE.exec(body)) !== null) {
      const col = inner[1].toLowerCase();
      if (
        [
          "constraint",
          "primary",
          "foreign",
          "unique",
          "check",
          "exclude",
        ].includes(col)
      )
        continue;
      if (!schema.has(table)) schema.set(table, new Set());
      schema.get(table)!.add(col);
    }
  }
}

// ── SQL extraction de TS ─────────────────────────────────────────────────
interface SqlStringMatch {
  sql: string;
  /** Índice no source onde o conteúdo do template começa (após a crase). */
  startIndex: number;
}

function extractSqlTemplates(source: string): SqlStringMatch[] {
  const out: SqlStringMatch[] = [];
  // Template literals que contêm palavras-chave SQL no início.
  const re = /`([^`]*?(?:SELECT|INSERT|UPDATE|DELETE|WITH)[^`]*?)`/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push({ sql: m[1], startIndex: m.index + 1 });
  }
  return out;
}

// ── Parsing aliases e referências ────────────────────────────────────────
interface ColumnRef {
  alias: string;
  column: string;
  /** Offset dentro do SQL string. */
  offset: number;
}

/**
 * Extrai nomes de CTEs de WITH clauses. Inclui `name AS (...)` e múltiplas
 * CTEs separadas por vírgula no nível do WITH.
 */
function parseCteNames(sql: string): Set<string> {
  const out = new Set<string>();
  // WITH foo AS (...), bar AS (...) → captura foo, bar
  const re = /(?:WITH|,)\s+([a-zA-Z_]\w*)\s+AS\s*\(/gi;
  // Só vale se o primeiro match é WITH (não vírgula); pra simplificar
  // confiamos que devs não usam `, foo AS (` fora de WITH cascade.
  if (!/\bWITH\b/i.test(sql)) return out;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    out.add(m[1].toLowerCase());
  }
  return out;
}

/**
 * Extrai mapa { alias → table } a partir de FROM/JOIN ... [AS] alias.
 *
 * Quando o MESMO alias aparece com tabelas diferentes (típico em subqueries
 * dentro do mesmo template literal — `JOIN pdi_cycles c ...` em um lugar e
 * `FROM cohorts c ...` em outro), marcamos como AMBÍGUO e refs com esse
 * alias são ignoradas (caso contrário gera falso positivo).
 *
 * Suporta:
 *   FROM users u
 *   FROM users AS u
 *   JOIN linkedin_profiles p ON ...
 *   FROM public.users u
 */
function parseAliases(sql: string): Map<string, string | null> {
  // null = ambíguo (alias reusado com tabelas diferentes)
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
    if (existing === undefined) {
      out.set(key, table);
    } else if (existing !== null && existing !== table) {
      out.set(key, null); // ambíguo
    }
  }
  return out;
}

/**
 * Extrai todas as referências `alias.column` no SQL.
 * Ignora referências de string ('...alias.col...') e schema-qualified (public.t).
 */
function parseColumnRefs(sql: string): ColumnRef[] {
  const out: ColumnRef[] = [];
  const re = /\b([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\b/g;
  let m: RegExpExecArray | null;
  // Bloqueia matches dentro de strings simples ' '.
  while ((m = re.exec(sql)) !== null) {
    const alias = m[1];
    const column = m[2];
    // Pula schema qualifiers comuns
    if (
      ["public", "pg_catalog", "information_schema"].includes(alias.toLowerCase())
    )
      continue;
    // Pula funções tipo "extract.year" (não existe, mas defensivo)
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

// ── Suggestion ───────────────────────────────────────────────────────────
function suggestColumn(wrong: string, available: Set<string>): string {
  // Levenshtein simples — sugere coluna mais próxima.
  let best: { col: string; dist: number } | null = null;
  for (const col of available) {
    const d = levenshtein(wrong.toLowerCase(), col.toLowerCase());
    if (!best || d < best.dist) best = { col, dist: d };
  }
  if (best && best.dist <= 4) return best.col;
  return `(verifique colunas: ${[...available].slice(0, 5).join(", ")}${available.size > 5 ? ", ..." : ""})`;
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
      curr.push(
        Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost),
      );
    }
    for (let j = 0; j < curr.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
