"use strict";
/**
 * Cache em disco pros resultados de LLM enrichment.
 *
 * Re-runs de CI sobre o mesmo finding pagam LLM de novo sem cache.
 * Cachear por hash de `code + file + line + snippet + mode` corta custo
 * em ~100% nos PRs sem mudança no trecho problemático.
 *
 * Layout: `.smoke-gate/llm-cache.json`
 *   { version: 1, entries: { "<hash>": { llmExplanation, llmFix, llmCommand, savedAt } } }
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
exports.LlmCache = exports.CACHE_FILENAME = void 0;
exports.cacheKey = cacheKey;
exports.defaultCachePath = defaultCachePath;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CACHE_VERSION = 1;
exports.CACHE_FILENAME = ".smoke-gate/llm-cache.json";
class LlmCache {
    constructor(filePath) {
        this.filePath = filePath;
        this.entries = new Map();
        this.dirty = false;
        this.hits = 0;
        this.misses = 0;
    }
    load() {
        if (!fs.existsSync(this.filePath))
            return;
        try {
            const raw = fs.readFileSync(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed.version !== CACHE_VERSION)
                return; // bump → ignora
            for (const [k, v] of Object.entries(parsed.entries ?? {})) {
                this.entries.set(k, v);
            }
        }
        catch {
            // cache corrompido — segue sem
        }
    }
    save() {
        if (!this.dirty)
            return;
        const dir = path.dirname(this.filePath);
        fs.mkdirSync(dir, { recursive: true });
        const data = {
            version: CACHE_VERSION,
            entries: Object.fromEntries(this.entries),
        };
        fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    }
    get(finding, mode) {
        const key = cacheKey(finding, mode);
        const v = this.entries.get(key);
        if (v)
            this.hits++;
        else
            this.misses++;
        return v;
    }
    set(finding, mode, enrichment) {
        const key = cacheKey(finding, mode);
        this.entries.set(key, {
            ...enrichment,
            savedAt: new Date().toISOString(),
        });
        this.dirty = true;
    }
}
exports.LlmCache = LlmCache;
function cacheKey(finding, mode) {
    const h = crypto.createHash("sha256");
    h.update(mode);
    h.update("\0");
    h.update(finding.code);
    h.update("\0");
    h.update(finding.location.file);
    h.update("\0");
    h.update(String(finding.location.line));
    h.update("\0");
    h.update(finding.snippet);
    return h.digest("hex").slice(0, 32);
}
function defaultCachePath(root) {
    return path.join(root, exports.CACHE_FILENAME);
}
//# sourceMappingURL=cache.js.map