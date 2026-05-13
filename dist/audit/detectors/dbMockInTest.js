"use strict";
/**
 * dbMockInTest — encontra testes que mockam pool/db diretamente.
 *
 * Esse é o anti-pattern que motivou todo o smoke-gate. Quando você mocka
 * `pool.query`, qualquer drift entre código SQL e schema real passa pelos
 * testes e só estoura em produção.
 *
 * Heurística: arquivos *.test.ts que contêm vi.mock("./db/pool", ...) ou
 * jest.mock("./db/pool", ...) ou similar.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbMockInTestDetector = void 0;
const util_1 = require("../util");
const CODE_PREFIX = "MOCK";
const DB_MOCK_RE = /(?:vi|jest)\s*\.\s*mock\s*\(\s*["'`]([^"'`]*(?:db\/pool|database|drizzle|prisma|knex|kysely)[^"'`]*)["'`]/g;
exports.dbMockInTestDetector = {
    name: "dbMockInTest",
    async run(ctx) {
        const findings = [];
        const files = (0, util_1.applyFileFilter)((0, util_1.walkFiles)(ctx.root, [".ts", ".js"], ctx.ignore).filter((f) => /\.(test|spec)\.[tj]sx?$/.test(f)), ctx.root, ctx.fileFilter);
        for (const fp of files) {
            const source = (0, util_1.readFileSafe)(fp);
            if (!source)
                continue;
            // Skip smoke tests — eles são o oposto deste anti-pattern.
            if (/\.smoke\.test\.[tj]sx?$/.test(fp))
                continue;
            let m;
            while ((m = DB_MOCK_RE.exec(source)) !== null) {
                const line = (0, util_1.lineOfIndex)(source, m.index);
                findings.push({
                    code: `${CODE_PREFIX}-001`,
                    detector: this.name,
                    severity: "warning",
                    title: `Teste mocka módulo de DB ('${m[1]}')`,
                    location: { file: (0, util_1.relPath)(ctx.root, fp), line },
                    snippet: (0, util_1.extractSnippet)(source, line, 2),
                    evidence: "Mockar pool/database em teste de integração esconde drift entre " +
                        "código SQL e schema real. Se uma coluna some, o teste passa mas " +
                        "produção quebra. Use smoke-gate runtime (banco real + fixtures) " +
                        "ou mantenha o mock só pra unit test puro (sem SQL).",
                    suggestedFix: "Converter pra *.smoke.test.ts usando DB real + fixtures. Ver: " +
                        "https://github.com/reimon/smoke-gate#receita-express--pg",
                });
            }
        }
        return findings;
    },
};
//# sourceMappingURL=dbMockInTest.js.map