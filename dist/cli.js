#!/usr/bin/env node
"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const index_1 = require("./audit/index");
const index_2 = require("./audit/index");
function parseArgs(argv) {
    const args = {
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
                args.llm = next;
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
function printHelp() {
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
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.command !== "audit") {
        printHelp();
        return;
    }
    const detectorMap = {
        sqlDrift: index_2.sqlDriftDetector,
        authGaps: index_2.authGapsDetector,
        errorLeak: index_2.errorLeakDetector,
        smokeCoverage: index_2.smokeCoverageDetector,
    };
    const detectors = args.detectors
        ? args.detectors.map((n) => {
            const d = detectorMap[n];
            if (!d)
                throw new Error(`detector desconhecido: ${n}`);
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
    const result = await (0, index_1.runAudit)({
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
    console.log(`\n📋 ${result.findings.length} findings (🔴 ${counts.critical} critical, 🟡 ${counts.warning} warning, 🔵 ${counts.info} info)`);
    // eslint-disable-next-line no-console
    console.log(`✅ Report: ${args.out}`);
    // Exit code != 0 se houver critical → bloqueia CI
    if (counts.critical > 0)
        process.exit(2);
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[smoke-gate] ${err.message}`);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map