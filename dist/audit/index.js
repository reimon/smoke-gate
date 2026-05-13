"use strict";
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
exports.formatMarkdown = exports.sqlDriftDetector = exports.smokeCoverageDetector = exports.errorLeakDetector = exports.authGapsDetector = exports.defineConfig = void 0;
exports.runAudit = runAudit;
const path = __importStar(require("path"));
const authGaps_1 = require("./detectors/authGaps");
Object.defineProperty(exports, "authGapsDetector", { enumerable: true, get: function () { return authGaps_1.authGapsDetector; } });
const errorLeak_1 = require("./detectors/errorLeak");
Object.defineProperty(exports, "errorLeakDetector", { enumerable: true, get: function () { return errorLeak_1.errorLeakDetector; } });
const smokeCoverage_1 = require("./detectors/smokeCoverage");
Object.defineProperty(exports, "smokeCoverageDetector", { enumerable: true, get: function () { return smokeCoverage_1.smokeCoverageDetector; } });
const sqlDrift_1 = require("./detectors/sqlDrift");
Object.defineProperty(exports, "sqlDriftDetector", { enumerable: true, get: function () { return sqlDrift_1.sqlDriftDetector; } });
const index_1 = require("./llm/index");
const markdown_1 = require("./report/markdown");
Object.defineProperty(exports, "formatMarkdown", { enumerable: true, get: function () { return markdown_1.formatMarkdown; } });
const util_1 = require("./util");
const config_1 = require("../config");
Object.defineProperty(exports, "defineConfig", { enumerable: true, get: function () { return config_1.defineConfig; } });
const ALL_DETECTORS = [
    sqlDrift_1.sqlDriftDetector,
    authGaps_1.authGapsDetector,
    errorLeak_1.errorLeakDetector,
    smokeCoverage_1.smokeCoverageDetector,
];
/**
 * Roda os detectores em sequência, enriquece com LLM, e retorna report.
 */
async function runAudit(opts) {
    const root = path.resolve(opts.root);
    // Carrega smoke-gate.config.{ts,js,mjs,cjs} se existir.
    // Permite o usuário registrar detectores próprios, desabilitar built-in,
    // e overrides de severity sem tocar no código do framework.
    const userConfig = await (0, config_1.loadConfig)(root);
    // Resolve fileFilter a partir de opts.files / opts.since.
    let fileFilter;
    if (opts.files && opts.files.length > 0) {
        fileFilter = new Set(opts.files);
    }
    else if (opts.since) {
        const changed = (0, util_1.gitDiffFiles)(root, opts.since);
        if (changed.length === 0) {
            // eslint-disable-next-line no-console
            console.error(`[audit] since=${opts.since}: 0 arquivos modificados (ou git falhou). Auditoria full.`);
        }
        else {
            fileFilter = new Set(changed);
        }
    }
    const ctx = {
        root,
        migrationsPath: opts.migrationsPath ?? userConfig.migrationsPath,
        ignore: [...(opts.ignore ?? []), ...(userConfig.ignore ?? [])],
        fileFilter,
    };
    // Determina lista de detectores: explicito > config + built-in.
    const detectors = opts.detectors ?? (0, config_1.applyConfigToDetectors)(ALL_DETECTORS, userConfig);
    const llmMode = opts.llm ?? "none";
    const adapter = (0, index_1.getLlmAdapter)(llmMode);
    const maxEnrich = opts.maxLlmEnrichments ?? 30;
    // Run detectors
    const allFindings = [];
    for (const det of detectors) {
        try {
            const found = await det.run(ctx);
            allFindings.push(...found);
        }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[audit] detector ${det.name} falhou: ${err.message}`);
        }
    }
    // Aplica severityOverrides do config (ex: AUTH-001 → warning).
    const overrides = userConfig.severityOverrides ?? {};
    for (const f of allFindings) {
        const o = overrides[f.code];
        if (o)
            f.severity = o;
    }
    // Enrich
    const enriched = [];
    let enrichedCount = 0;
    for (const f of allFindings) {
        if (llmMode === "none" ||
            enrichedCount >= maxEnrich ||
            f.severity === "info") {
            enriched.push(f);
            continue;
        }
        try {
            const fileContext = getFileContext(root, f);
            const extra = await adapter.enrich(f, fileContext);
            enriched.push({ ...f, ...extra });
            enrichedCount++;
        }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[audit] LLM enrich falhou em ${f.code}: ${err.message}`);
            enriched.push(f);
        }
    }
    const markdown = (0, markdown_1.formatMarkdown)(enriched, {
        project: path.basename(root),
        date: new Date().toISOString().slice(0, 10),
        llm: llmMode,
    });
    return { findings: enriched, markdown };
}
function getFileContext(root, f) {
    if (!f.location.file || f.location.file === "<global>")
        return "";
    const fp = path.join(root, f.location.file);
    const source = (0, util_1.readFileSafe)(fp);
    if (!source)
        return "";
    const lines = source.split("\n");
    const start = Math.max(0, f.location.line - 40);
    const end = Math.min(lines.length, f.location.line + 40);
    return lines.slice(start, end).join("\n");
}
//# sourceMappingURL=index.js.map