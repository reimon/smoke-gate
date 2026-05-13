"use strict";
/**
 * smoke-gate MCP server (v0.3)
 *
 * Stdio. Exposes tools any MCP-aware agent (Claude Code, Cursor, Cline,
 * Continue, Zed, Windsurf) can call.
 *
 * Tools:
 *   audit_run         full audit, returns findings
 *   audit_check_sql   validate a single SQL string against the schema
 *   schema_lookup     list columns of a given table
 *   audit_explain     deep-dive context for a finding
 *   audit_apply_fix   produce a patch (dryRun=true by default)
 *
 * The point: cache schema once, answer queries in <50ms. Lets the agent
 * call `audit_check_sql` BEFORE writing SQL — prevention, not detection.
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
exports.startMcpServer = startMcpServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const index_1 = require("../audit/index");
const index_2 = require("../audit/index");
const schemaCache_1 = require("./schemaCache");
const checkSql_1 = require("./checkSql");
const util_1 = require("../audit/util");
// Server identity
const SERVER_NAME = "smoke-gate";
const SERVER_VERSION = "0.3.0";
async function startMcpServer() {
    const server = new mcp_js_1.McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, {
        capabilities: {
            tools: {},
        },
    });
    // ── audit_check_sql ─────────────────────────────────────────────────────
    // Killer feature: agente chama ANTES de gerar query SQL → recebe issues
    // em <50ms. Schema vem do cache. Roteado pra prevenção, não detecção.
    server.registerTool("audit_check_sql", {
        title: "Check SQL against schema",
        description: "Validate a single SQL string against the project schema (CREATE TABLE + ALTER TABLE). Returns column-not-found / table-unknown / ambiguous-alias issues with suggested fixes. Call this BEFORE generating SQL in a route handler.",
        inputSchema: {
            sql: zod_1.z.string().describe("The SQL query to validate"),
            projectRoot: zod_1.z
                .string()
                .optional()
                .describe("Absolute path to project root (defaults to process cwd). Used to locate migrations."),
        },
    }, async ({ sql, projectRoot }) => {
        const root = projectRoot ?? process.cwd();
        const schema = (0, schemaCache_1.getSchema)(root);
        const result = (0, checkSql_1.checkSql)(sql, schema);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        ok: result.ok,
                        tablesUsed: result.tablesUsed,
                        issues: result.issues,
                        schemaSize: schema.size,
                    }, null, 2),
                },
            ],
        };
    });
    // ── schema_lookup ────────────────────────────────────────────────────────
    server.registerTool("schema_lookup", {
        title: "List columns of a table",
        description: "Returns the list of columns for a given table (case-insensitive). Useful when the agent needs to know what fields exist before composing a SELECT/INSERT.",
        inputSchema: {
            table: zod_1.z.string().describe("Table name (e.g., 'linkedin_profiles')"),
            projectRoot: zod_1.z.string().optional(),
        },
    }, async ({ table, projectRoot }) => {
        const root = projectRoot ?? process.cwd();
        const schema = (0, schemaCache_1.getSchema)(root);
        const cols = schema.get(table.toLowerCase());
        if (!cols) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            table,
                            found: false,
                            message: `Table not in schema. Available: ${[...schema.keys()]
                                .slice(0, 20)
                                .join(", ")}${schema.size > 20 ? "..." : ""}`,
                        }),
                    },
                ],
            };
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        table,
                        found: true,
                        columns: [...cols].sort(),
                    }),
                },
            ],
        };
    });
    // ── audit_run ────────────────────────────────────────────────────────────
    server.registerTool("audit_run", {
        title: "Run full code audit",
        description: "Run all enabled detectors (sqlDrift, authGaps, errorLeak, smokeCoverage) against the project. Returns findings grouped by severity. For large projects, prefer `audit_diff` (planned) for incremental scans.",
        inputSchema: {
            projectRoot: zod_1.z.string().optional(),
            detectors: zod_1.z
                .array(zod_1.z.enum([
                "sqlDrift",
                "authGaps",
                "errorLeak",
                "unsafeJsonParse",
                "dbMockInTest",
                "raceCondition",
                "smokeCoverage",
            ]))
                .optional()
                .describe("Subset of detectors to run (default: all)"),
            severityMin: zod_1.z
                .enum(["info", "warning", "critical"])
                .optional()
                .describe("Minimum severity to return (default: warning)"),
        },
    }, async ({ projectRoot, detectors, severityMin }) => {
        const root = projectRoot ?? process.cwd();
        const detectorMap = {
            sqlDrift: index_2.sqlDriftDetector,
            authGaps: index_2.authGapsDetector,
            errorLeak: index_2.errorLeakDetector,
            unsafeJsonParse: index_2.unsafeJsonParseDetector,
            dbMockInTest: index_2.dbMockInTestDetector,
            raceCondition: index_2.raceConditionDetector,
            smokeCoverage: index_2.smokeCoverageDetector,
        };
        const list = detectors?.map((n) => detectorMap[n]) ?? Object.values(detectorMap);
        const result = await (0, index_1.runAudit)({
            root,
            detectors: list,
            llm: "none",
        });
        const sevRank = { info: 0, warning: 1, critical: 2 };
        const min = sevRank[severityMin ?? "warning"];
        const filtered = result.findings.filter((f) => sevRank[f.severity] >= min);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        counts: {
                            critical: result.findings.filter((f) => f.severity === "critical").length,
                            warning: result.findings.filter((f) => f.severity === "warning").length,
                            info: result.findings.filter((f) => f.severity === "info")
                                .length,
                        },
                        returned: filtered.length,
                        findings: filtered.map((f) => ({
                            code: f.code,
                            detector: f.detector,
                            severity: f.severity,
                            title: f.title,
                            file: f.location.file,
                            line: f.location.line,
                            evidence: f.evidence,
                            suggestedFix: f.suggestedFix,
                        })),
                    }, null, 2),
                },
            ],
        };
    });
    // ── audit_explain ────────────────────────────────────────────────────────
    server.registerTool("audit_explain", {
        title: "Explain a finding with code context",
        description: "Given a file path and line number, return the surrounding 40 lines of code + schema context. Use this to understand a finding before proposing a fix.",
        inputSchema: {
            projectRoot: zod_1.z.string().optional(),
            file: zod_1.z.string().describe("File path relative to project root"),
            line: zod_1.z.number().int().positive(),
            contextLines: zod_1.z.number().int().optional().default(40),
        },
    }, async ({ projectRoot, file, line, contextLines }) => {
        const root = projectRoot ?? process.cwd();
        const fp = path.isAbsolute(file) ? file : path.join(root, file);
        const source = (0, util_1.readFileSafe)(fp);
        if (!source) {
            return {
                content: [
                    { type: "text", text: JSON.stringify({ error: `cannot read ${fp}` }) },
                ],
            };
        }
        const ctx = contextLines ?? 40;
        const lines = source.split("\n");
        const start = Math.max(0, line - 1 - ctx);
        const end = Math.min(lines.length, line + ctx);
        const snippet = lines
            .slice(start, end)
            .map((l, i) => {
            const n = start + i + 1;
            const marker = n === line ? ">" : " ";
            return `${marker} ${String(n).padStart(4)} | ${l}`;
        })
            .join("\n");
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        file,
                        line,
                        range: [start + 1, end],
                        snippet,
                    }),
                },
            ],
        };
    });
    // ── audit_apply_fix ──────────────────────────────────────────────────────
    // v0.3: gera patch unificado e devolve. NÃO escreve no disco — agente
    // mostra ao usuário e ele aprova manualmente (ou via outra tool depois).
    server.registerTool("audit_apply_fix", {
        title: "Generate a patch for a fix (preview)",
        description: "Given a file, line, and replacement, return a unified diff that the agent can show to the user before applying. v0.3: dry-run only — does NOT touch disk. v0.4 will accept `apply: true`.",
        inputSchema: {
            projectRoot: zod_1.z.string().optional(),
            file: zod_1.z.string(),
            line: zod_1.z.number().int().positive(),
            oldText: zod_1.z.string().describe("Exact text to replace (must match)"),
            newText: zod_1.z.string().describe("Replacement text"),
        },
    }, async ({ projectRoot, file, line, oldText, newText }) => {
        const root = projectRoot ?? process.cwd();
        const fp = path.isAbsolute(file) ? file : path.join(root, file);
        const source = (0, util_1.readFileSafe)(fp);
        if (!source) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ ok: false, error: `cannot read ${fp}` }),
                    },
                ],
            };
        }
        const lines = source.split("\n");
        const targetIdx = line - 1;
        if (targetIdx >= lines.length) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            ok: false,
                            error: `line ${line} out of range (file has ${lines.length} lines)`,
                        }),
                    },
                ],
            };
        }
        const currentLine = lines[targetIdx];
        if (!currentLine.includes(oldText)) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            ok: false,
                            error: `oldText not found on line ${line}: '${currentLine}'`,
                        }),
                    },
                ],
            };
        }
        const newLine = currentLine.replace(oldText, newText);
        const diff = unifiedDiff(file, currentLine, newLine, line);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        ok: true,
                        dryRun: true,
                        diff,
                        instructions: "Apply with: `git apply <<'EOF'\\n" + diff + "\\nEOF`",
                    }),
                },
            ],
        };
    });
    // ── invalidate_schema ────────────────────────────────────────────────────
    // Util pro caso de migration nova sem reiniciar server.
    server.registerTool("invalidate_schema", {
        title: "Force schema reload on next call",
        description: "Clear the in-memory schema cache for a project. Use after adding new migration files. Cache is also invalidated automatically when migration file mtimes change.",
        inputSchema: {
            projectRoot: zod_1.z.string().optional(),
        },
    }, async ({ projectRoot }) => {
        const root = projectRoot ?? process.cwd();
        (0, schemaCache_1.invalidateSchema)(root);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ ok: true, invalidated: root }),
                },
            ],
        };
    });
    // ── Wire stdio transport ────────────────────────────────────────────────
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    // eslint-disable-next-line no-console
    console.error(`[smoke-gate-mcp] server ${SERVER_VERSION} ready over stdio (tools: audit_run, audit_check_sql, schema_lookup, audit_explain, audit_apply_fix, invalidate_schema)`);
}
// ── Unified diff (mini) ───────────────────────────────────────────────────
function unifiedDiff(file, oldLine, newLine, lineNum) {
    return [
        `--- a/${file}`,
        `+++ b/${file}`,
        `@@ -${lineNum},1 +${lineNum},1 @@`,
        `-${oldLine}`,
        `+${newLine}`,
    ].join("\n");
}
// Detecta se foi chamado diretamente como `node server.js`
const argv1 = process.argv[1] ?? "";
if (argv1.endsWith("server.js") || argv1.endsWith("server.ts")) {
    void startMcpServer().catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[smoke-gate-mcp] fatal: ${err.message}`);
        process.exit(1);
    });
}
// Suprime warnings de TS sobre `fs` não usado
void fs;
//# sourceMappingURL=server.js.map