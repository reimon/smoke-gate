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
import { dbMockInTestDetector } from "./detectors/dbMockInTest";
import { errorLeakDetector } from "./detectors/errorLeak";
import { raceConditionDetector } from "./detectors/raceCondition";
import { smokeCoverageDetector } from "./detectors/smokeCoverage";
import { sqlDriftDetector } from "./detectors/sqlDrift";
import { unsafeJsonParseDetector } from "./detectors/unsafeJsonParse";
import { LlmCache, defaultCachePath } from "./llm/cache";
import { getLlmAdapter, type LlmMode } from "./llm/index";
import { formatMarkdown } from "./report/markdown";
import type {
  AuditContext,
  Detector,
  EnrichedFinding,
  Finding,
} from "./types";
import { gitDiffFiles, readFileSafe } from "./util";
import {
  applyConfigToDetectors,
  loadConfig,
  defineConfig,
  type SmokeGateConfig,
} from "../config";

export { defineConfig };
export type { SmokeGateConfig };

export {
  authGapsDetector,
  dbMockInTestDetector,
  errorLeakDetector,
  raceConditionDetector,
  smokeCoverageDetector,
  sqlDriftDetector,
  unsafeJsonParseDetector,
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
  unsafeJsonParseDetector,
  dbMockInTestDetector,
  raceConditionDetector,
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
  /**
   * Auditar só arquivos modificados desde um ref git (ex: "origin/main",
   * "HEAD~3", "abc1234"). Roda `git diff --name-only <since>...HEAD`.
   * Reduz tempo de audit em PRs grandes de minutos pra segundos.
   * smokeCoverage é skipado em modo --since (precisa visão global).
   */
  since?: string;
  /**
   * Lista explícita de arquivos (paths relativos ao root) a auditar.
   * Alternativa a `since` quando você já sabe quais arquivos mudaram.
   */
  files?: string[];
  /**
   * Desabilita o cache de LLM enrichment em `.smoke-gate/llm-cache.json`.
   * Default: cache ligado em todos os modos != "none".
   */
  noCache?: boolean;
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

  // Carrega smoke-gate.config.{ts,js,mjs,cjs} se existir.
  // Permite o usuário registrar detectores próprios, desabilitar built-in,
  // e overrides de severity sem tocar no código do framework.
  const userConfig = await loadConfig(root);

  // Resolve fileFilter a partir de opts.files / opts.since.
  let fileFilter: Set<string> | undefined;
  if (opts.files && opts.files.length > 0) {
    fileFilter = new Set(opts.files);
  } else if (opts.since) {
    const changed = gitDiffFiles(root, opts.since);
    if (changed.length === 0) {
      // eslint-disable-next-line no-console
      console.error(
        `[audit] since=${opts.since}: 0 arquivos modificados (ou git falhou). Auditoria full.`,
      );
    } else {
      fileFilter = new Set(changed);
    }
  }

  const ctx: AuditContext = {
    root,
    migrationsPath: opts.migrationsPath ?? userConfig.migrationsPath,
    ignore: [...(opts.ignore ?? []), ...(userConfig.ignore ?? [])],
    fileFilter,
  };

  // Determina lista de detectores: explicito > config + built-in.
  const detectors =
    opts.detectors ?? applyConfigToDetectors(ALL_DETECTORS, userConfig);
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

  // Aplica severityOverrides do config (ex: AUTH-001 → warning).
  const overrides = userConfig.severityOverrides ?? {};
  for (const f of allFindings) {
    const o = overrides[f.code];
    if (o) f.severity = o;
  }

  // Cache de LLM enrichment (skipado em modo "none" ou --no-cache).
  const cache =
    llmMode !== "none" && !opts.noCache
      ? new LlmCache(defaultCachePath(root))
      : null;
  cache?.load();

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
    const cached = cache?.get(f, llmMode);
    if (cached) {
      enriched.push({
        ...f,
        llmExplanation: cached.llmExplanation,
        llmFix: cached.llmFix,
        llmCommand: cached.llmCommand,
      });
      enrichedCount++;
      continue;
    }
    try {
      const fileContext = getFileContext(root, f);
      const extra = await adapter.enrich(f, fileContext);
      enriched.push({ ...f, ...extra });
      cache?.set(f, llmMode, extra);
      enrichedCount++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[audit] LLM enrich falhou em ${f.code}: ${(err as Error).message}`,
      );
      enriched.push(f);
    }
  }

  if (cache) {
    cache.save();
    if (cache.hits + cache.misses > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `[audit] llm-cache: ${cache.hits} hits, ${cache.misses} misses`,
      );
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
