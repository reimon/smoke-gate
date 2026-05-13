/**
 * Public API do módulo audit.
 *
 * Uso programático:
 *   import { runAudit } from "@kaiketsu/smoke-gate/audit";
 *   const report = await runAudit({ root, llm: "anthropic", detectors: [...] });
 *   await fs.writeFile("audit.md", report.markdown);
 *
 * Uso CLI:
 *   npx smoke-gate audit --llm anthropic --out audit.md
 */

import * as path from "path";
import { authGapsDetector } from "./detectors/authGaps";
import { errorLeakDetector } from "./detectors/errorLeak";
import { smokeCoverageDetector } from "./detectors/smokeCoverage";
import { sqlDriftDetector } from "./detectors/sqlDrift";
import { getLlmAdapter, type LlmMode } from "./llm/index";
import { formatMarkdown } from "./report/markdown";
import type {
  AuditContext,
  Detector,
  EnrichedFinding,
  Finding,
} from "./types";
import { readFileSafe } from "./util";

export {
  authGapsDetector,
  errorLeakDetector,
  smokeCoverageDetector,
  sqlDriftDetector,
};
export type {
  AuditContext,
  Detector,
  EnrichedFinding,
  Finding,
  LlmMode,
};
export { formatMarkdown };

const ALL_DETECTORS: Detector[] = [
  sqlDriftDetector,
  authGapsDetector,
  errorLeakDetector,
  smokeCoverageDetector,
];

export interface RunAuditOptions {
  root: string;
  migrationsPath?: string;
  ignore?: string[];
  /** Subconjunto de detectores. Default: todos. */
  detectors?: Detector[];
  /** Modo LLM. Default: "none". */
  llm?: LlmMode;
  /** Máximo de findings a enriquecer com LLM (rate-limit/cost). Default: 30. */
  maxLlmEnrichments?: number;
}

export interface AuditResult {
  findings: EnrichedFinding[];
  markdown: string;
}

/**
 * Roda os detectores em sequência, enriquece com LLM, e retorna report.
 */
export async function runAudit(opts: RunAuditOptions): Promise<AuditResult> {
  const root = path.resolve(opts.root);
  const ctx: AuditContext = {
    root,
    migrationsPath: opts.migrationsPath,
    ignore: opts.ignore,
  };

  const detectors = opts.detectors ?? ALL_DETECTORS;
  const llmMode: LlmMode = opts.llm ?? "none";
  const adapter = getLlmAdapter(llmMode);
  const maxEnrich = opts.maxLlmEnrichments ?? 30;

  // Run detectors
  const allFindings: Finding[] = [];
  for (const det of detectors) {
    try {
      const found = await det.run(ctx);
      allFindings.push(...found);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[audit] detector ${det.name} falhou: ${(err as Error).message}`,
      );
    }
  }

  // Enrich
  const enriched: EnrichedFinding[] = [];
  let enrichedCount = 0;
  for (const f of allFindings) {
    if (
      llmMode === "none" ||
      enrichedCount >= maxEnrich ||
      f.severity === "info"
    ) {
      enriched.push(f);
      continue;
    }
    try {
      const fileContext = getFileContext(root, f);
      const extra = await adapter.enrich(f, fileContext);
      enriched.push({ ...f, ...extra });
      enrichedCount++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[audit] LLM enrich falhou em ${f.code}: ${(err as Error).message}`,
      );
      enriched.push(f);
    }
  }

  const markdown = formatMarkdown(enriched, {
    project: path.basename(root),
    date: new Date().toISOString().slice(0, 10),
    llm: llmMode,
  });

  return { findings: enriched, markdown };
}

function getFileContext(root: string, f: Finding): string {
  if (!f.location.file || f.location.file === "<global>") return "";
  const fp = path.join(root, f.location.file);
  const source = readFileSafe(fp);
  if (!source) return "";
  const lines = source.split("\n");
  const start = Math.max(0, f.location.line - 40);
  const end = Math.min(lines.length, f.location.line + 40);
  return lines.slice(start, end).join("\n");
}
