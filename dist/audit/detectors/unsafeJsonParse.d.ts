/**
 * unsafeJsonParse — encontra JSON.parse() em contexto sem try/catch.
 *
 * JSON.parse joga em input inválido. Quando o input vem de body do request,
 * de arquivo externo, ou de campo JSONB do banco, isso vira 500 em produção.
 *
 * Heurística: para cada `JSON.parse(...)` no código, sobe na árvore textual
 * procurando `try {` no mesmo bloco. Se não achar dentro de N linhas,
 * registra finding.
 *
 * Falsos positivos: try/catch envolto em função separada (chamador trata).
 * Tolerável — o número de FPs é bem baixo e o benefício de pegar é alto.
 */
import type { Detector } from "../types";
export declare const unsafeJsonParseDetector: Detector;
//# sourceMappingURL=unsafeJsonParse.d.ts.map