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
import type { Detector } from "../types";
export declare const dbMockInTestDetector: Detector;
//# sourceMappingURL=dbMockInTest.d.ts.map