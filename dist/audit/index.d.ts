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
import { authGapsDetector } from "./detectors/authGaps";
import { errorLeakDetector } from "./detectors/errorLeak";
import { smokeCoverageDetector } from "./detectors/smokeCoverage";
import { sqlDriftDetector } from "./detectors/sqlDrift";
import { type LlmMode } from "./llm/index";
import { formatMarkdown } from "./report/markdown";
import type { AuditContext, Detector, EnrichedFinding, Finding } from "./types";
import { defineConfig, type SmokeGateConfig } from "../config";
export { defineConfig };
export type { SmokeGateConfig };
export { authGapsDetector, errorLeakDetector, smokeCoverageDetector, sqlDriftDetector, };
export type { AuditContext, Detector, EnrichedFinding, Finding, LlmMode, };
export { formatMarkdown };
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
export declare function runAudit(opts: RunAuditOptions): Promise<AuditResult>;
//# sourceMappingURL=index.d.ts.map