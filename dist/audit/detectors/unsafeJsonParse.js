"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.unsafeJsonParseDetector = void 0;
const util_1 = require("../util");
const CODE_PREFIX = "JSON";
const JSON_PARSE_RE = /\bJSON\.parse\s*\(/g;
exports.unsafeJsonParseDetector = {
    name: "unsafeJsonParse",
    async run(ctx) {
        const findings = [];
        const files = (0, util_1.applyFileFilter)((0, util_1.walkFiles)(ctx.root, [".ts", ".js"], ctx.ignore), ctx.root, ctx.fileFilter);
        for (const fp of files) {
            const source = (0, util_1.readFileSafe)(fp);
            if (!source)
                continue;
            if ((0, util_1.hasIgnoreSentinel)(source))
                continue;
            // Skip test files — JSON.parse em fixtures é OK
            if (/\.(test|spec)\.[tj]sx?$/.test(fp))
                continue;
            let m;
            while ((m = JSON_PARSE_RE.exec(source)) !== null) {
                const idx = m.index;
                if (isInsideTryBlock(source, idx))
                    continue;
                const line = (0, util_1.lineOfIndex)(source, idx);
                findings.push({
                    code: `${CODE_PREFIX}-001`,
                    detector: this.name,
                    severity: "warning",
                    title: "JSON.parse sem try/catch",
                    location: { file: (0, util_1.relPath)(ctx.root, fp), line },
                    snippet: (0, util_1.extractSnippet)(source, line, 2),
                    evidence: "JSON.parse joga SyntaxError em input inválido. Sem try/catch, " +
                        "request com body malformado vira 500. Especialmente perigoso pra " +
                        "dados de campos JSONB do banco (legado) ou strings de query params.",
                    suggestedFix: "Envolver em try/catch ou usar parser tolerante: " +
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
function isInsideTryBlock(source, idx) {
    // Pega 800 chars antes do JSON.parse
    const start = Math.max(0, idx - 800);
    const before = source.slice(start, idx);
    const tryMatch = before.lastIndexOf("try {");
    if (tryMatch === -1)
        return false;
    // Conta { } entre o try e o JSON.parse pra ver se ainda estamos dentro
    const between = before.slice(tryMatch + 5);
    let depth = 1;
    let inString = null;
    for (let i = 0; i < between.length; i++) {
        const c = between[i];
        if (inString) {
            if (c === inString && between[i - 1] !== "\\")
                inString = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            inString = c;
            continue;
        }
        if (c === "{")
            depth++;
        else if (c === "}")
            depth--;
        if (depth === 0)
            return false; // try block fechou antes do JSON.parse
    }
    return depth > 0;
}
//# sourceMappingURL=unsafeJsonParse.js.map