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
import type { Detector } from "../types";
export declare const authGapsDetector: Detector;
//# sourceMappingURL=authGaps.d.ts.map