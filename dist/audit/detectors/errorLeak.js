"use strict";
// smoke-gate-ignore-file
/**
 * errorLeak — encontra responses 500 que vazam err.message bruta pro cliente.
 *
 * Padrões:
 *   res.status(500).json({ ..., message: err.message })  ← VAZA
 *   res.status(500).json({ ..., detail: (e as Error).message })  ← VAZA
 *   res.status(500).json({ error: "..." })  ← OK
 *
 * Mensagens de erro brutas podem expor: caminhos do servidor, queries SQL
 * com tabelas/colunas, stack traces, tokens em payloads, IPs internos.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorLeakDetector = void 0;
const util_1 = require("../util");
const CODE_PREFIX = "ERR";
// Captura blocos res.status(5xx).json({...}) ou res.json({..., message: err.message})
const STATUS_500_RE = /res\s*\.\s*status\s*\(\s*5\d\d\s*\)\s*\.\s*json\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
const ERR_MESSAGE_RE = /\b(err|error|e|exception)\s*(?:as\s+Error)?\s*\)?\.message\b/i;
exports.errorLeakDetector = {
    name: "errorLeak",
    async run(ctx) {
        const findings = [];
        const files = (0, util_1.applyFileFilter)((0, util_1.walkFiles)(ctx.root, [".ts"], ctx.ignore).filter((f) => /(routes|controllers|handlers)\//i.test(f)), ctx.root, ctx.fileFilter);
        for (const fp of files) {
            const source = (0, util_1.readFileSafe)(fp);
            if (!source)
                continue;
            if ((0, util_1.hasIgnoreSentinel)(source))
                continue;
            let m;
            while ((m = STATUS_500_RE.exec(source)) !== null) {
                const body = m[1];
                if (!ERR_MESSAGE_RE.test(body))
                    continue;
                const line = (0, util_1.lineOfIndex)(source, m.index);
                findings.push({
                    code: `${CODE_PREFIX}-001`,
                    detector: this.name,
                    severity: "warning",
                    title: "Response 5xx vaza err.message pro cliente",
                    location: { file: (0, util_1.relPath)(ctx.root, fp), line },
                    snippet: (0, util_1.extractSnippet)(source, line, 3),
                    evidence: "Mensagens de erro nativas do banco/runtime podem expor: " +
                        "tabelas e colunas, paths absolutos, IPs internos, e tokens em payloads. " +
                        "Manter só uma mensagem genérica; logar o err.message no servidor.",
                    suggestedFix: "Substituir por: res.status(500).json({ error: 'Mensagem genérica' }) " +
                        "e logar antes: console.error('[contexto]', err.message)",
                });
            }
        }
        return findings;
    },
};
//# sourceMappingURL=errorLeak.js.map