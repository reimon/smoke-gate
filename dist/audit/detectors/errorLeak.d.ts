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
import type { Detector } from "../types";
export declare const errorLeakDetector: Detector;
//# sourceMappingURL=errorLeak.d.ts.map