/**
 * smokeCoverage — encontra endpoints registrados nos routers que NÃO
 * aparecem em nenhum arquivo *.smoke.test.ts.
 *
 * Funciona em par com `careerIntelligence.smoke.test.ts` ou equivalente:
 * detecta quando um dev adicionou rota nova mas esqueceu de plugar no
 * smoke gate.
 */
import type { Detector } from "../types";
export declare const smokeCoverageDetector: Detector;
//# sourceMappingURL=smokeCoverage.d.ts.map