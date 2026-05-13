"use strict";
/**
 * authGaps — encontra rotas Express com params de userId/profileId que
 * NÃO usam middleware de ownership check.
 *
 * Padrões detectados:
 *   router.get("/:userId/...", async (req, res) => { ... })   ← FALTA AUTH
 *   router.get("/:profileId/...", checkOwnership, handler)    ← OK
 *
 * Heurística: se path contém `/:userId` ou `/:profileId` mas a lista de
 * middlewares entre o path e o handler não inclui nenhum nome com "ownership",
 * "auth", "require", "check" → finding.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.authGapsDetector = void 0;
const util_1 = require("../util");
const CODE_PREFIX = "AUTH";
const ROUTE_RE = /router\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]\s*([\s\S]*?)\)\s*[;,]?\s*\n/g;
// Aceita middlewares que falam de ownership OU de role (Admin/Mentor).
// Rotas admin geralmente não precisam de ownership (admin vê tudo) mas
// devem ter requireAdmin/checkRole na chain.
const OWNERSHIP_HINT_RE = /\b(check|require|verify|ensure|guard|assert|is)(User|Profile|Ownership|Auth|Permission|Access|Admin|Mentor|Role|Owner)\w*\b/i;
const SENSITIVE_PARAMS = [":userId", ":profileId", ":memberId", ":accountId"];
exports.authGapsDetector = {
    name: "authGaps",
    async run(ctx) {
        const findings = [];
        const files = (0, util_1.applyFileFilter)((0, util_1.walkFiles)(ctx.root, [".ts"], ctx.ignore).filter((f) => /routes\//i.test(f) || /api\/.+routes/i.test(f)), ctx.root, ctx.fileFilter);
        for (const fp of files) {
            const source = (0, util_1.readFileSafe)(fp);
            if (!source)
                continue;
            // Se o router file já aplica auth middleware no topo (router.use(...))
            // OU se é claramente um admin router (mounted sob /admin/* no app.ts,
            // com auth na chain de mount), reduzimos severidade. Heurística: nome
            // do arquivo começa com "admin" OU tem router.use(requireAuth/check*).
            const routerHasMountedAuth = /router\.use\s*\(\s*[\w$.()]*(?:require|check|verify)\w*/i.test(source);
            const filename = fp.split(/[\\/]/).pop() ?? "";
            const isAdminRouter = /^admin/i.test(filename);
            let m;
            while ((m = ROUTE_RE.exec(source)) !== null) {
                const method = m[1].toUpperCase();
                const routePath = m[2];
                const middlewareBlock = m[3];
                if (!SENSITIVE_PARAMS.some((p) => routePath.includes(p)))
                    continue;
                // O middleware block fica entre o path e o handler.
                // Se houver pelo menos um ownership-hint, considera OK.
                if (OWNERSHIP_HINT_RE.test(middlewareBlock))
                    continue;
                // Router-level auth aplicado (`router.use(requireAuth)`) cobre tudo.
                if (routerHasMountedAuth)
                    continue;
                // Admin routers: severidade reduzida (mount-level auth típica),
                // mas vale registrar como warning pra revisão.
                const severity = isAdminRouter
                    ? "warning"
                    : "critical";
                const line = (0, util_1.lineOfIndex)(source, m.index);
                findings.push({
                    code: `${CODE_PREFIX}-001`,
                    detector: this.name,
                    severity,
                    title: `Rota ${method} ${routePath} sem middleware de ownership`,
                    location: { file: (0, util_1.relPath)(ctx.root, fp), line },
                    snippet: (0, util_1.extractSnippet)(source, line, 2),
                    evidence: `Rota recebe ${SENSITIVE_PARAMS.find((p) => routePath.includes(p))} ` +
                        `mas não há middleware tipo checkUserOwnership/requireAuth na lista antes do handler. ` +
                        `Risco: IDOR — usuário A pode acessar dados do B passando o id de B na URL.`,
                    suggestedFix: `Adicionar middleware: router.${method.toLowerCase()}("${routePath}", checkUserOwnership, handler)`,
                });
            }
        }
        return findings;
    },
};
//# sourceMappingURL=authGaps.js.map