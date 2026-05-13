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
import type { Detector } from "../types";
export declare const raceConditionDetector: Detector;
//# sourceMappingURL=raceCondition.d.ts.map