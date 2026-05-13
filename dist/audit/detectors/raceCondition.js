"use strict";
/**
 * raceCondition — encontra padrões check-then-act sem transação.
 *
 * Padrão clássico: SELECT pra verificar se algo existe, depois INSERT/UPDATE
 * baseado no resultado. Sem transaction/lock, dois requests concorrentes
 * podem ambos passar do check e gerar duplicatas / inconsistências.
 *
 * Heurística textual:
 *   - Numa mesma função: encontrar `pool.query(SELECT ...)` seguido de
 *     `pool.query(INSERT|UPDATE ...)` dentro de N linhas
 *   - Se não houver `BEGIN`/`pool.connect`/`withTransaction`/`db.transaction`
 *     entre eles → finding.
 *
 * Falsos positivos esperados: muitos. Esse detector é "warning" não critical.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.raceConditionDetector = void 0;
const util_1 = require("../util");
const CODE_PREFIX = "RACE";
const SELECT_QUERY_RE = /\bpool\.query\s*[<(][^`]*`[^`]*\bSELECT\b/gi;
const TX_HINT_RE = /\b(BEGIN\b|pool\.connect\b|withTransaction\b|db\.transaction\b|\.transaction\s*\(|FOR\s+UPDATE\b|ON\s+CONFLICT\b)/i;
const WRITE_QUERY_RE = /\bpool\.query\s*[<(][^`]*`[^`]*\b(INSERT|UPDATE|DELETE)\b/i;
exports.raceConditionDetector = {
    name: "raceCondition",
    async run(ctx) {
        const findings = [];
        const files = (0, util_1.applyFileFilter)((0, util_1.walkFiles)(ctx.root, [".ts", ".js"], ctx.ignore).filter((f) => /(routes|controllers|handlers|services|jobs)\//i.test(f)), ctx.root, ctx.fileFilter);
        for (const fp of files) {
            const source = (0, util_1.readFileSafe)(fp);
            if (!source)
                continue;
            let m;
            while ((m = SELECT_QUERY_RE.exec(source)) !== null) {
                // Olha as próximas 60 linhas depois do SELECT
                const sliceStart = m.index;
                const sliceEnd = findNthNewline(source, sliceStart, 60);
                const block = source.slice(sliceStart, sliceEnd);
                const writeMatch = WRITE_QUERY_RE.exec(block);
                if (!writeMatch)
                    continue;
                // Há transaction/lock no meio?
                const between = block.slice(0, writeMatch.index);
                if (TX_HINT_RE.test(between))
                    continue;
                const line = (0, util_1.lineOfIndex)(source, sliceStart);
                findings.push({
                    code: `${CODE_PREFIX}-001`,
                    detector: this.name,
                    severity: "warning",
                    title: "Possível race: SELECT seguido de INSERT/UPDATE sem transação",
                    location: { file: (0, util_1.relPath)(ctx.root, fp), line },
                    snippet: (0, util_1.extractSnippet)(source, line, 4),
                    evidence: "Padrão check-then-act detectado: um SELECT seguido de mutação " +
                        "sem `BEGIN`, `pool.connect`, transaction wrapper, SELECT FOR UPDATE, " +
                        "ou ON CONFLICT no INSERT. Dois requests concorrentes podem gerar " +
                        "duplicatas ou estado inconsistente.",
                    suggestedFix: "Opção 1 (atômico, sem lock): INSERT ... ON CONFLICT (key) DO NOTHING/UPDATE. " +
                        "Opção 2: SELECT ... FOR UPDATE dentro de transaction (BEGIN/COMMIT). " +
                        "Opção 3: UNIQUE index + try/catch no INSERT.",
                });
            }
        }
        return findings;
    },
};
function findNthNewline(s, from, n) {
    let count = 0;
    for (let i = from; i < s.length; i++) {
        if (s[i] === "\n") {
            count++;
            if (count === n)
                return i;
        }
    }
    return s.length;
}
//# sourceMappingURL=raceCondition.js.map