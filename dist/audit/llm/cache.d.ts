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
import type { EnrichedFinding, Finding } from "../types";
export declare const CACHE_FILENAME = ".smoke-gate/llm-cache.json";
export type CachedEnrichment = Pick<EnrichedFinding, "llmExplanation" | "llmFix" | "llmCommand"> & {
    savedAt: string;
};
export declare class LlmCache {
    private readonly filePath;
    private entries;
    private dirty;
    hits: number;
    misses: number;
    constructor(filePath: string);
    load(): void;
    save(): void;
    get(finding: Finding, mode: string): CachedEnrichment | undefined;
    set(finding: Finding, mode: string, enrichment: Pick<EnrichedFinding, "llmExplanation" | "llmFix" | "llmCommand">): void;
}
export declare function cacheKey(finding: Finding, mode: string): string;
export declare function defaultCachePath(root: string): string;
//# sourceMappingURL=cache.d.ts.map