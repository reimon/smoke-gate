/**
 * smokeCoverage — encontra endpoints registrados nos routers que NÃO
 * aparecem em nenhum arquivo *.smoke.test.ts.
 *
 * Funciona em par com `careerIntelligence.smoke.test.ts` ou equivalente:
 * detecta quando um dev adicionou rota nova mas esqueceu de plugar no
 * smoke gate.
 */

import type { AuditContext, Detector, Finding } from "../types";
import {
  extractSnippet,
  lineOfIndex,
  readFileSafe,
  relPath,
  walkFiles,
} from "../util";

const CODE_PREFIX = "COV";

const ROUTE_RE =
  /router\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;

export const smokeCoverageDetector: Detector = {
  name: "smokeCoverage",

  async run(ctx: AuditContext): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Em modo diff-only (fileFilter setado), pular: precisamos enumerar
    // todas as rotas + todos os smoke tests pra fazer o diff. Audit
    // parcial dá relatório enganoso.
    if (ctx.fileFilter) return findings;

    // 1. Pega todas as rotas declaradas
    const routeFiles = walkFiles(ctx.root, [".ts"], ctx.ignore).filter((f) =>
      /routes\//i.test(f),
    );
    type RouteEntry = {
      method: string;
      path: string;
      file: string;
      line: number;
    };
    const routes: RouteEntry[] = [];
    for (const fp of routeFiles) {
      const source = readFileSafe(fp);
      let m: RegExpExecArray | null;
      while ((m = ROUTE_RE.exec(source)) !== null) {
        routes.push({
          method: m[1].toUpperCase(),
          path: m[2],
          file: fp,
          line: lineOfIndex(source, m.index),
        });
      }
    }

    if (routes.length === 0) return findings;

    // 2. Concatena conteúdo dos smoke tests
    const smokeFiles = walkFiles(ctx.root, [".ts"], ctx.ignore).filter((f) =>
      /\.smoke\.test\.ts$/.test(f),
    );
    if (smokeFiles.length === 0) {
      return [
        {
          code: `${CODE_PREFIX}-000`,
          detector: this.name,
          severity: "warning",
          title: "Nenhum arquivo *.smoke.test.ts encontrado",
          location: { file: "<global>", line: 0 },
          snippet: "",
          evidence: `Detectadas ${routes.length} rotas mas nenhum smoke test existe. Considere criar com smoke-gate.`,
        },
      ];
    }
    const allSmokeSrc = smokeFiles.map((f) => readFileSafe(f)).join("\n");

    // 3. Diff — uma rota é "coberta" se seu path (ou path normalizado) aparece
    //    no source dos smoke tests.
    for (const r of routes) {
      // Normaliza :param pra padrão usado nos smokes (geralmente substituído por valor).
      // Match conservador: presença de cada segmento estático.
      const segments = r.path
        .split("/")
        .filter((s) => s && !s.startsWith(":"));
      if (segments.length === 0) continue;
      const allPresent = segments.every((seg) => allSmokeSrc.includes(seg));
      if (allPresent) continue;

      findings.push({
        code: `${CODE_PREFIX}-001`,
        detector: this.name,
        severity: "info",
        title: `Rota ${r.method} ${r.path} sem cobertura no smoke`,
        location: { file: relPath(ctx.root, r.file), line: r.line },
        snippet: extractSnippet(readFileSafe(r.file), r.line, 1),
        evidence:
          `Path declarado em ${relPath(ctx.root, r.file)}:${r.line} mas seus segmentos ` +
          `(${segments.join(", ")}) não aparecem em nenhum *.smoke.test.ts. ` +
          `Drift futuro nessa rota não será pego pelo CI gate.`,
        suggestedFix: `Adicionar ao array endpoints do smoke: { method: "${r.method}", path: "${r.path.replace(/:(\w+)/g, "<$1>")}" }`,
      });
    }

    return findings;
  },
};
