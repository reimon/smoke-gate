/**
 * @kaiketsu/smoke-gate/vitest — bridge para vitest.
 *
 * Gera `it.each()` automaticamente a partir de uma suite. Cada endpoint vira
 * um teste com nome legível e falha individual — assim CI mostra qual quebrou.
 */
import { type SmokeSuite } from "./core";
/**
 * Registra a suite no vitest. Cada endpoint vira `it()` separado.
 *
 * @example
 *   registerVitestSuite(careerIntelSmoke);
 */
export declare function registerVitestSuite(suite: SmokeSuite): void;
/**
 * Modo single-test: roda toda a suite num único `it()`, retorna report único.
 * Útil pra rodar a suite como guard em outro test runner que não suporta
 * descoberta dinâmica de testes.
 */
export declare function registerVitestSingleTest(suite: SmokeSuite): void;
//# sourceMappingURL=vitest.d.ts.map