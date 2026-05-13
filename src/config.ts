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

import * as fs from "fs";
import * as path from "path";
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
export function defineConfig(c: SmokeGateConfig): SmokeGateConfig {
  return c;
}

/**
 * Carrega smoke-gate.config.{ts,js,mjs,cjs} se existir no projectRoot.
 * Retorna config vazia se não encontrar (não é erro — config é opcional).
 *
 * Para .ts: tenta `tsx` ou `ts-node/register`. Falha gracefully se nenhum
 * estiver instalado e instrui o usuário.
 */
export async function loadConfig(
  projectRoot: string,
): Promise<SmokeGateConfig> {
  const candidates = [
    "smoke-gate.config.ts",
    "smoke-gate.config.mts",
    "smoke-gate.config.js",
    "smoke-gate.config.mjs",
    "smoke-gate.config.cjs",
  ];
  let configPath: string | null = null;
  for (const name of candidates) {
    const fp = path.join(projectRoot, name);
    if (fs.existsSync(fp)) {
      configPath = fp;
      break;
    }
  }
  if (!configPath) return {};

  const ext = path.extname(configPath);

  // .ts/.mts precisam de transpiler. Tenta tsx primeiro, procurando
  // primeiro no projeto do usuário (que provavelmente já tem) e depois
  // no smoke-gate (que não tem como dep direta — opcional).
  if (ext === ".ts" || ext === ".mts") {
    const tsxLoaded = await tryRegisterTsx(projectRoot);
    if (!tsxLoaded) {
      // eslint-disable-next-line no-console
      console.error(
        `[smoke-gate] ${configPath}: requer 'tsx' instalado pra carregar TS sem build. ` +
          `Rode: npm i -D tsx, ou compile o config pra .js / .mjs.`,
      );
      return {};
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(configPath);
    const cfg = (mod.default ?? mod) as SmokeGateConfig;
    if (typeof cfg !== "object" || cfg === null) {
      // eslint-disable-next-line no-console
      console.error(
        `[smoke-gate] ${configPath}: export default deve ser um objeto.`,
      );
      return {};
    }
    return cfg;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[smoke-gate] erro ao carregar ${configPath}: ${(err as Error).message}`,
    );
    return {};
  }
}

let tsxAttempted = false;
let tsxLoaded = false;
async function tryRegisterTsx(projectRoot: string): Promise<boolean> {
  if (tsxAttempted) return tsxLoaded;
  tsxAttempted = true;

  // Tenta primeiro o tsx do projeto do usuário (provavelmente já tem)
  const candidates = [
    path.join(projectRoot, "node_modules", "tsx", "cjs"),
    path.join(projectRoot, "node_modules", "tsx", "dist", "cjs"),
    "tsx/cjs",
    path.join(projectRoot, "node_modules", "ts-node", "register"),
    "ts-node/register",
  ];

  for (const c of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require(c);
      tsxLoaded = true;
      return true;
    } catch {
      // próximo candidato
    }
  }
  return false;
}

/**
 * Aplica overrides da config a uma lista de detectores built-in.
 * - Remove os listados em `disable`.
 * - Atualiza severity dos findings que rodam (handled na pipeline, não aqui).
 */
export function applyConfigToDetectors(
  builtIn: Detector[],
  config: SmokeGateConfig,
): Detector[] {
  const disabled = new Set(config.disable ?? []);
  const filtered = builtIn.filter((d) => !disabled.has(d.name));
  return [...filtered, ...(config.detectors ?? [])];
}
