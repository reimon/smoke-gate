#!/usr/bin/env node
/**
 * CLI — smoke-gate audit
 *
 * Uso:
 *   smoke-gate audit [--root PATH] [--migrations PATH]
 *                    [--llm none|anthropic|openai|ollama]
 *                    [--out audit-report.md]
 *                    [--detectors sqlDrift,authGaps,...]
 *                    [--max-llm N]
 */

import * as fs from "fs";
import * as path from "path";
import { runAudit, type LlmMode } from "./audit/index";
import {
  sqlDriftDetector,
  authGapsDetector,
  errorLeakDetector,
  smokeCoverageDetector,
} from "./audit/index";

interface CliArgs {
  command: string;
  root: string;
  migrations?: string;
  llm: LlmMode;
  out: string;
  detectors?: string[];
  maxLlm: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: argv[0] ?? "help",
    root: process.cwd(),
    llm: "none",
    out: "audit-report.md",
    maxLlm: 30,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--root":
        args.root = path.resolve(next);
        i++;
        break;
      case "--migrations":
        args.migrations = path.resolve(next);
        i++;
        break;
      case "--llm":
        if (!["none", "anthropic", "openai", "ollama"].includes(next)) {
          throw new Error(`--llm inválido: ${next}`);
        }
        args.llm = next as LlmMode;
        i++;
        break;
      case "--out":
        args.out = next;
        i++;
        break;
      case "--detectors":
        args.detectors = next.split(",").map((s) => s.trim());
        i++;
        break;
      case "--max-llm":
        args.maxLlm = parseInt(next, 10);
        i++;
        break;
      case "-h":
      case "--help":
        args.command = "help";
        break;
    }
  }
  return args;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`smoke-gate v0.2.0

Comandos:
  audit       Roda detectores estáticos + enriquece com LLM, gera report markdown.
  help        Esta mensagem.

Opções (audit):
  --root PATH          Root do projeto a auditar (default: cwd)
  --migrations PATH    Caminho pras migrations .sql (default: auto-detecta api/migrations)
  --llm MODE           none | anthropic | openai | ollama (default: none)
  --out FILE           Arquivo de saída markdown (default: audit-report.md)
  --detectors LIST     CSV: sqlDrift,authGaps,errorLeak,smokeCoverage (default: todos)
  --max-llm N          Max findings enriquecidos pelo LLM (default: 30)

Variáveis de ambiente:
  ANTHROPIC_API_KEY    Necessária para --llm anthropic
  OPENAI_API_KEY       Necessária para --llm openai
  OLLAMA_URL           Default http://localhost:11434
  OLLAMA_MODEL         Default llama3.2

Exemplos:
  npx smoke-gate audit --llm anthropic
  npx smoke-gate audit --root ./api --detectors sqlDrift
  npx smoke-gate audit --llm none --out my-audit.md
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command !== "audit") {
    printHelp();
    return;
  }

  const detectorMap = {
    sqlDrift: sqlDriftDetector,
    authGaps: authGapsDetector,
    errorLeak: errorLeakDetector,
    smokeCoverage: smokeCoverageDetector,
  };
  const detectors = args.detectors
    ? args.detectors.map((n) => {
        const d = (detectorMap as Record<string, (typeof detectorMap)[keyof typeof detectorMap]>)[n];
        if (!d) throw new Error(`detector desconhecido: ${n}`);
        return d;
      })
    : undefined;

  // eslint-disable-next-line no-console
  console.log(`🔍 smoke-gate audit`);
  // eslint-disable-next-line no-console
  console.log(`   root:       ${args.root}`);
  // eslint-disable-next-line no-console
  console.log(`   migrations: ${args.migrations ?? "(auto)"}`);
  // eslint-disable-next-line no-console
  console.log(`   llm:        ${args.llm}`);
  // eslint-disable-next-line no-console
  console.log(`   out:        ${args.out}`);

  const result = await runAudit({
    root: args.root,
    migrationsPath: args.migrations,
    llm: args.llm,
    detectors,
    maxLlmEnrichments: args.maxLlm,
  });

  fs.writeFileSync(args.out, result.markdown, "utf8");

  const counts = {
    critical: result.findings.filter((f) => f.severity === "critical").length,
    warning: result.findings.filter((f) => f.severity === "warning").length,
    info: result.findings.filter((f) => f.severity === "info").length,
  };

  // eslint-disable-next-line no-console
  console.log(
    `\n📋 ${result.findings.length} findings (🔴 ${counts.critical} critical, 🟡 ${counts.warning} warning, 🔵 ${counts.info} info)`,
  );
  // eslint-disable-next-line no-console
  console.log(`✅ Report: ${args.out}`);

  // Exit code != 0 se houver critical → bloqueia CI
  if (counts.critical > 0) process.exit(2);
}

main().catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error(`[smoke-gate] ${err.message}`);
  process.exit(1);
});
