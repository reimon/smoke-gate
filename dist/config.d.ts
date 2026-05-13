/**
 * Custom config loader.
 *
 * O usuário cria `smoke-gate.config.ts` (ou .js) no root do projeto.
 * Lá ele exporta:
 *   - detectores adicionais (específicos do domínio dele)
 *   - overrides de detectores built-in (desabilitar / mudar severidade)
 *   - ignores
 *
 * Esse é o multiplicador de adoção: cada empresa escreve 5-10 detectores
 * próprios e o framework cresce sem você commitar nada novo.
 */
import type { Detector } from "./audit/types";
export interface SmokeGateConfig {
    /** Detectores adicionais (executados depois dos built-in). */
    detectors?: Detector[];
    /**
     * Built-in detectors a desabilitar pelo nome.
     * Ex: ["smokeCoverage"] desliga warnings de cobertura.
     */
    disable?: string[];
    /**
     * Override de severidade por código de finding.
     * Ex: { "AUTH-001": "warning" } reduz auth gaps de critical pra warning.
     */
    severityOverrides?: Record<string, "info" | "warning" | "critical">;
    /** Paths adicionais a ignorar (além dos defaults). */
    ignore?: string[];
    /** Caminho do diretório de migrations (override do auto-detect). */
    migrationsPath?: string;
}
/**
 * Helper pra autocomplete/typing. Use no smoke-gate.config.ts:
 *   import { defineConfig } from "@kaiketsu/smoke-gate";
 *   export default defineConfig({ detectors: [...] });
 */
export declare function defineConfig(c: SmokeGateConfig): SmokeGateConfig;
/**
 * Carrega smoke-gate.config.{ts,js,mjs,cjs} se existir no projectRoot.
 * Retorna config vazia se não encontrar (não é erro — config é opcional).
 *
 * Para .ts: tenta `tsx` ou `ts-node/register`. Falha gracefully se nenhum
 * estiver instalado e instrui o usuário.
 */
export declare function loadConfig(projectRoot: string): Promise<SmokeGateConfig>;
/**
 * Aplica overrides da config a uma lista de detectores built-in.
 * - Remove os listados em `disable`.
 * - Atualiza severity dos findings que rodam (handled na pipeline, não aqui).
 */
export declare function applyConfigToDetectors(builtIn: Detector[], config: SmokeGateConfig): Detector[];
//# sourceMappingURL=config.d.ts.map