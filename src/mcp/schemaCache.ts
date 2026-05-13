/**
 * Cache de schema em memória para MCP server.
 *
 * Por que existe: a CLI re-parsa migrations a cada invocação (lento, ~5s
 * em projetos grandes). MCP server roda como processo persistente — então
 * vale carregar 1x e reusar. Permite o caso `audit_check_sql` responder
 * em < 50ms, o que é o killer feature pra prevenção em tempo real.
 *
 * Invalidação: o cache tem um mtime do diretório de migrations. Se alguém
 * adiciona uma nova migration sem reiniciar o server, a próxima chamada
 * detecta o mtime maior e recarrega.
 */

import * as fs from "fs";
import * as path from "path";
import { walkFiles, readFileSafe } from "../audit/util";

export type Schema = Map<string, Set<string>>;

interface CacheEntry {
  schema: Schema;
  /** Maior mtime entre todos os .sql escaneados. */
  signature: number;
  /** Diretórios escaneados. */
  roots: string[];
}

const cache = new Map<string, CacheEntry>();

/**
 * Carrega (ou retorna do cache) o schema pro projeto. `projectRoot` é
 * usado como chave; mudou de projeto, novo cache.
 */
export function getSchema(projectRoot: string): Schema {
  const entry = cache.get(projectRoot);
  const sig = computeSignature(projectRoot);

  if (entry && entry.signature === sig.signature) {
    return entry.schema;
  }

  const fresh = loadSchemaFromDisk(sig.roots);
  cache.set(projectRoot, {
    schema: fresh,
    signature: sig.signature,
    roots: sig.roots,
  });
  return fresh;
}

/** Força reload no próximo `getSchema`. */
export function invalidateSchema(projectRoot: string): void {
  cache.delete(projectRoot);
}

function computeSignature(projectRoot: string): {
  signature: number;
  roots: string[];
} {
  const roots = collectSqlRoots(projectRoot);
  let maxMtime = 0;
  for (const root of roots) {
    const files = walkFiles(root, [".sql"], []);
    for (const fp of files) {
      try {
        const m = fs.statSync(fp).mtimeMs;
        if (m > maxMtime) maxMtime = m;
      } catch {
        // arquivo removido entre walk e stat, ignora
      }
    }
  }
  return { signature: maxMtime, roots };
}

function collectSqlRoots(projectRoot: string): string[] {
  const candidates = [
    path.join(projectRoot, "api", "migrations"),
    path.join(projectRoot, "api"),
    path.join(projectRoot, "migrations"),
    path.join(projectRoot, "db", "migrations"),
    path.join(projectRoot, "db"),
  ];
  const found: string[] = [];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) found.push(c);
  }
  return found;
}

// ── Schema parsing (compartilhado com sqlDrift detector) ─────────────────
// Repetido aqui pra desacoplar o cache do detector. Próxima refatoração:
// extrair pra src/audit/schemaParser.ts e ambos importam.

const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?\s*\(/gi;
const ALTER_TABLE_RE =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?\s+([\s\S]*?);/gi;
const ADD_COLUMN_RE =
  /ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/gi;

function loadSchemaFromDisk(roots: string[]): Schema {
  const schema: Schema = new Map();
  for (const root of roots) {
    const files = walkFiles(root, [".sql"], []);
    for (const fp of files) {
      const sql = stripSqlComments(readFileSafe(fp));
      parseCreateTables(sql, schema);
      parseAlterTables(sql, schema);
    }
  }
  return schema;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseCreateTables(sql: string, schema: Schema): void {
  let m: RegExpExecArray | null;
  while ((m = CREATE_TABLE_RE.exec(sql)) !== null) {
    const table = m[1].toLowerCase();
    const bodyStart = m.index + m[0].length;
    const body = extractBalancedParens(sql, bodyStart);
    if (body === null) continue;
    if (!schema.has(table)) schema.set(table, new Set());
    const cols = schema.get(table)!;
    for (const colName of extractColumnsFromBody(body)) {
      cols.add(colName.toLowerCase());
    }
  }
}

function parseAlterTables(sql: string, schema: Schema): void {
  let outer: RegExpExecArray | null;
  while ((outer = ALTER_TABLE_RE.exec(sql)) !== null) {
    const table = outer[1].toLowerCase();
    const body = outer[2];
    ADD_COLUMN_RE.lastIndex = 0;
    let inner: RegExpExecArray | null;
    while ((inner = ADD_COLUMN_RE.exec(body)) !== null) {
      const col = inner[1].toLowerCase();
      if (
        ["constraint", "primary", "foreign", "unique", "check", "exclude"].includes(
          col,
        )
      )
        continue;
      if (!schema.has(table)) schema.set(table, new Set());
      schema.get(table)!.add(col);
    }
  }
}

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

function extractColumnsFromBody(body: string): string[] {
  const out: string[] = [];
  const parts = splitTopLevel(body, ",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)\b/i.test(trimmed))
      continue;
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
