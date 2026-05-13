"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.defineConfig = defineConfig;
exports.loadConfig = loadConfig;
exports.applyConfigToDetectors = applyConfigToDetectors;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Helper pra autocomplete/typing. Use no smoke-gate.config.ts:
 *   import { defineConfig } from "@kaiketsu/smoke-gate";
 *   export default defineConfig({ detectors: [...] });
 */
function defineConfig(c) {
    return c;
}
/**
 * Carrega smoke-gate.config.{ts,js,mjs,cjs} se existir no projectRoot.
 * Retorna config vazia se não encontrar (não é erro — config é opcional).
 *
 * Para .ts: tenta `tsx` ou `ts-node/register`. Falha gracefully se nenhum
 * estiver instalado e instrui o usuário.
 */
async function loadConfig(projectRoot) {
    const candidates = [
        "smoke-gate.config.ts",
        "smoke-gate.config.mts",
        "smoke-gate.config.js",
        "smoke-gate.config.mjs",
        "smoke-gate.config.cjs",
    ];
    let configPath = null;
    for (const name of candidates) {
        const fp = path.join(projectRoot, name);
        if (fs.existsSync(fp)) {
            configPath = fp;
            break;
        }
    }
    if (!configPath)
        return {};
    const ext = path.extname(configPath);
    // .ts/.mts precisam de transpiler. Tenta tsx primeiro, procurando
    // primeiro no projeto do usuário (que provavelmente já tem) e depois
    // no smoke-gate (que não tem como dep direta — opcional).
    if (ext === ".ts" || ext === ".mts") {
        const tsxLoaded = await tryRegisterTsx(projectRoot);
        if (!tsxLoaded) {
            // eslint-disable-next-line no-console
            console.error(`[smoke-gate] ${configPath}: requer 'tsx' instalado pra carregar TS sem build. ` +
                `Rode: npm i -D tsx, ou compile o config pra .js / .mjs.`);
            return {};
        }
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(configPath);
        const cfg = (mod.default ?? mod);
        if (typeof cfg !== "object" || cfg === null) {
            // eslint-disable-next-line no-console
            console.error(`[smoke-gate] ${configPath}: export default deve ser um objeto.`);
            return {};
        }
        return cfg;
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[smoke-gate] erro ao carregar ${configPath}: ${err.message}`);
        return {};
    }
}
let tsxAttempted = false;
let tsxLoaded = false;
async function tryRegisterTsx(projectRoot) {
    if (tsxAttempted)
        return tsxLoaded;
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
        }
        catch {
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
function applyConfigToDetectors(builtIn, config) {
    const disabled = new Set(config.disable ?? []);
    const filtered = builtIn.filter((d) => !disabled.has(d.name));
    return [...filtered, ...(config.detectors ?? [])];
}
//# sourceMappingURL=config.js.map