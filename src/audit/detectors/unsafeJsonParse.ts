// smoke-gate-ignore-file — contém JSON.parse como padrão de detecção, não execução
/**
 * unsafeJsonParse — encontra JSON.parse() em contexto sem try/catch.
 *
 * JSON.parse joga em input inválido. Quando o input vem de body do request,
 * de arquivo externo, ou de campo JSONB do banco, isso vira 500 em produção.
 *
 * Heurística: para cada `JSON.parse(...)` no código, sobe na árvore textual
 * procurando `try {` no mesmo bloco. Se não achar dentro de N linhas,
 * registra finding.
 *
 * Falsos positivos: try/catch envolto em função separada (chamador trata).
 * Tolerável — o número de FPs é bem baixo e o benefício de pegar é alto.
 */

import type { AuditContext, Detector, Finding } from "../types";
import {
  applyFileFilter,
  extractSnippet,
  hasIgnoreSentinel,
  lineOfIndex,
  readFileSafe,
  relPath,
  walkFiles,
} from "../util";

const CODE_PREFIX = "JSON";
const JSON_PARSE_RE = /\bJSON\.parse\s*\(/g;

export const unsafeJsonParseDetector: Detector = {
  name: "unsafeJsonParse",

  async run(ctx: AuditContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const files = applyFileFilter(
      walkFiles(ctx.root, [".ts", ".js"], ctx.ignore),
      ctx.root,
      ctx.fileFilter,
    );

    for (const fp of files) {
      const source = readFileSafe(fp);
      if (!source) continue;
      if (hasIgnoreSentinel(source)) continue;
      // Skip test files — JSON.parse em fixtures é OK
      if (/\.(test|spec)\.[tj]sx?$/.test(fp)) continue;

      let m: RegExpExecArray | null;
      while ((m = JSON_PARSE_RE.exec(source)) !== null) {
        const idx = m.index;
        if (isInsideTryBlock(source, idx)) continue;

        const line = lineOfIndex(source, idx);
        findings.push({
          code: `${CODE_PREFIX}-001`,
          detector: this.name,
          severity: "warning",
          title: "JSON.parse sem try/catch",
          location: { file: relPath(ctx.root, fp), line },
          snippet: extractSnippet(source, line, 2),
          evidence:
            "JSON.parse joga SyntaxError em input inválido. Sem try/catch, " +
            "request com body malformado vira 500. Especialmente perigoso pra " +
            "dados de campos JSONB do banco (legado) ou strings de query params.",
          suggestedFix:
            "Envolver em try/catch ou usar parser tolerante: " +
            "`function safeParse<T>(s: string): T | null { try { return JSON.parse(s); } catch { return null; } }`",
        });
      }
    }

    return findings;
  },
};

/**
 * Heurística simples: procura `try {` nas ~10 linhas antes do índice no mesmo
 * arquivo, sem encontrar um `}` desbalanceado entre eles. Não é AST perfeito
 * mas pega 90% dos casos sem dependência de parser.
 */
function isInsideTryBlock(source: string, idx: number): boolean {
  // Pega 800 chars antes do JSON.parse
  const start = Math.max(0, idx - 800);
  const before = source.slice(start, idx);
  const tryMatch = before.lastIndexOf("try {");
  if (tryMatch === -1) return false;

  // Conta { } entre o try e o JSON.parse pra ver se ainda estamos dentro
  const between = before.slice(tryMatch + 5);
  let depth = 1;
  let inString: string | null = null;
  for (let i = 0; i < between.length; i++) {
    const c = between[i];
    if (inString) {
      if (c === inString && between[i - 1] !== "\\") inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (depth === 0) return false; // try block fechou antes do JSON.parse
  }
  return depth > 0;
}
