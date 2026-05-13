/**
 * Utilities compartilhados pelos detectores.
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Walk recursivo retornando todos os arquivos com extensões aceitas.
 * Pula node_modules, dist, .git, e padrões em `ignore`.
 */
export function walkFiles(
  root: string,
  exts: string[],
  ignore: string[] = [],
): string[] {
  const out: string[] = [];
  const defaultIgnore = [
    "node_modules",
    "dist",
    ".git",
    "build",
    "coverage",
    ".next",
    ".turbo",
    ".cache",
    ".claude",       // claude code worktrees + skills
    "tmp",
    ".vscode",
    ".idea",
  ];
  const allIgnore = new Set([...defaultIgnore, ...ignore]);

  function recurse(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (allIgnore.has(ent.name)) continue;
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        recurse(fp);
      } else if (ent.isFile() && exts.some((e) => ent.name.endsWith(e))) {
        out.push(fp);
      }
    }
  }
  recurse(root);
  return out;
}

/** Lê arquivo retornando string vazia em erro (evita try/catch repetido). */
export function readFileSafe(fp: string): string {
  try {
    return fs.readFileSync(fp, "utf8");
  } catch {
    return "";
  }
}

/** Calcula linha (1-based) de um índice de caractere no source. */
export function lineOfIndex(source: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/** Extrai N linhas centradas em torno de uma linha (1-based). */
export function extractSnippet(
  source: string,
  line: number,
  context = 2,
): string {
  const lines = source.split("\n");
  const start = Math.max(0, line - 1 - context);
  const end = Math.min(lines.length, line + context);
  return lines
    .slice(start, end)
    .map((l, i) => {
      const n = start + i + 1;
      const marker = n === line ? ">" : " ";
      return `${marker} ${String(n).padStart(4)} | ${l}`;
    })
    .join("\n");
}

/** Caminho relativo ao root (útil pra report). */
export function relPath(root: string, abs: string): string {
  return path.relative(root, abs);
}

/**
 * Filtra lista de arquivos absolutos por uma whitelist relativa ao root.
 * Se filter for undefined, retorna a lista intacta.
 */
export function applyFileFilter(
  files: string[],
  root: string,
  filter: Set<string> | undefined,
): string[] {
  if (!filter) return files;
  return files.filter((f) => filter.has(path.relative(root, f)));
}

/**
 * Roda `git diff --name-only <base>...HEAD` e devolve a lista de arquivos
 * modificados (relativos ao root do repo). Retorna [] se git falhar.
 *
 * `base` pode ser: "main", "origin/main", "HEAD~5", commit SHA, etc.
 */
export function gitDiffFiles(root: string, base: string): string[] {
  const child = require("child_process") as typeof import("child_process");
  try {
    const out = child.execSync(
      `git -C "${root}" diff --name-only ${base}...HEAD`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
