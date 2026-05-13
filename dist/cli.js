#!/usr/bin/env node
"use strict";
/**
 * CLI — smoke-gate audit
 *
 * Dois modos de uso:
 *
 * 1) CI / standalone (com API key):
 *    smoke-gate audit --llm anthropic --out audit-report.md
 *
 * 2) Agent-mode (sem API key — agente que invoca consome via stdout):
 *    smoke-gate audit --json
 *    → emite JSON com findings determinísticos em stdout
 *    → o agente (Claude Code, Cursor, etc.) faz o enrichment
 *      usando a sessão de LLM dele
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
        json: false,
        noCache: false,
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
            case "--json":
                args.json = true;
                break;
            case "--since":
                args.since = next;
                i++;
                break;
            case "--files":
                args.files = next.split(",").map((s) => s.trim()).filter(Boolean);
                i++;
                break;
            case "--no-cache":
                args.noCache = true;
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
    console.log(`smoke-gate v0.3.0

Comandos:
  audit       Roda detectores estáticos + gera report.
  mcp serve   Inicia MCP server (stdio) — agentes consomem detectores como tools.
  help        Esta mensagem.

Modos:
  1) Standalone (com API key)        smoke-gate audit --llm anthropic
  2) Agent-mode (sem API key)        smoke-gate audit --json
     O agente (Claude Code/Cursor) consome o JSON e enriquece com a
     própria sessão de LLM. Veja docs/agent-mode.md.

Opções:
  --root PATH          Root do projeto (default: cwd)
  --migrations PATH    Migrations .sql (default: auto-detecta api/migrations)
  --llm MODE           none | anthropic | openai | ollama (default: none)
  --out FILE           Saída markdown (default: audit-report.md)
  --json               Emite findings como JSON em stdout em vez de markdown
  --since REF          Audita só arquivos modificados desde ref git (ex: origin/main)
  --files CSV          Lista explícita de arquivos (alternativa a --since)
  --detectors LIST     CSV: sqlDrift,authGaps,errorLeak,unsafeJsonParse,dbMockInTest,raceCondition,smokeCoverage
  --max-llm N          Max findings enriquecidos pelo LLM (default: 30)
  --no-cache           Desabilita cache de LLM em .smoke-gate/llm-cache.json

Env (apenas standalone):
  ANTHROPIC_API_KEY    --llm anthropic
  OPENAI_API_KEY       --llm openai
  OLLAMA_URL           --llm ollama (default localhost:11434)
  OLLAMA_MODEL         --llm ollama (default llama3.2)

Exemplos:
  npx smoke-gate audit                            # offline, markdown
  npx smoke-gate audit --json                     # pro agente consumir
  npx smoke-gate audit --llm anthropic --out a.md # standalone com Claude
`);
}
async function main() {
    const argv = process.argv.slice(2);
    const command = argv[0] ?? "help";
    // `smoke-gate mcp serve` — inicia MCP server stdio
    if (command === "mcp") {
        const sub = argv[1];
        if (sub === "serve") {
            const { startMcpServer } = await Promise.resolve().then(() => __importStar(require("./mcp/server")));
            await startMcpServer();
            return;
        }
        // eslint-disable-next-line no-console
        console.error(`Uso: smoke-gate mcp serve`);
        process.exit(2);
    }
    const args = parseArgs(argv);
    if (args.command !== "audit") {
        printHelp();
        return;
    }
    const detectorMap = {
        sqlDrift: index_2.sqlDriftDetector,
        authGaps: index_2.authGapsDetector,
        errorLeak: index_2.errorLeakDetector,
        smokeCoverage: index_2.smokeCoverageDetector,
        unsafeJsonParse: index_2.unsafeJsonParseDetector,
        dbMockInTest: index_2.dbMockInTestDetector,
        raceCondition: index_2.raceConditionDetector,
    };
    const detectors = args.detectors
        ? args.detectors.map((n) => {
            const d = detectorMap[n];
            if (!d)
                throw new Error(`detector desconhecido: ${n}`);
            return d;
        })
        : undefined;
    // Logs vão pra stderr no modo --json pra não poluir stdout.
    const log = args.json
        ? // eslint-disable-next-line no-console
            (...a) => console.error(...a)
        : // eslint-disable-next-line no-console
            (...a) => console.log(...a);
    log(`🔍 smoke-gate audit`);
    log(`   root:       ${args.root}`);
    log(`   migrations: ${args.migrations ?? "(auto)"}`);
    log(`   llm:        ${args.json ? "(agent-mode)" : args.llm}`);
    log(`   out:        ${args.json ? "(stdout JSON)" : args.out}`);
    const result = await (0, index_1.runAudit)({
        root: args.root,
        migrationsPath: args.migrations,
        // Em --json, ignora --llm: agente faz o enrichment.
        llm: args.json ? "none" : args.llm,
        detectors,
        maxLlmEnrichments: args.maxLlm,
        since: args.since,
        files: args.files,
        noCache: args.noCache,
    });
    const counts = {
        critical: result.findings.filter((f) => f.severity === "critical").length,
        warning: result.findings.filter((f) => f.severity === "warning").length,
        info: result.findings.filter((f) => f.severity === "info").length,
    };
    if (args.json) {
        // Schema documentado em docs/agent-mode.md — agentes podem usar isso
        // como contract pra enriquecer cada finding com o LLM próprio.
        const payload = {
            version: "0.2.1",
            schema: "smoke-gate/audit/findings",
            root: args.root,
            counts,
            findings: result.findings.map((f) => ({
                code: f.code,
                detector: f.detector,
                severity: f.severity,
                title: f.title,
                file: f.location.file,
                line: f.location.line,
                snippet: f.snippet,
                evidence: f.evidence,
                suggestedFix: f.suggestedFix ?? null,
            })),
        };
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(payload, null, 2));
    }
    else {
        fs.writeFileSync(args.out, result.markdown, "utf8");
        log(`\n✅ Report: ${args.out}`);
    }
    log(`\n📋 ${result.findings.length} findings (🔴 ${counts.critical} critical, 🟡 ${counts.warning} warning, 🔵 ${counts.info} info)`);
    // Exit 2 se houver critical → bloqueia CI
    if (counts.critical > 0)
        process.exit(2);
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[smoke-gate] ${err.message}`);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map