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

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import type { EnrichedFinding, Finding } from "../types";

const CACHE_VERSION = 1;
export const CACHE_FILENAME = ".smoke-gate/llm-cache.json";

export type CachedEnrichment = Pick<
  EnrichedFinding,
  "llmExplanation" | "llmFix" | "llmCommand"
> & { savedAt: string };

interface CacheFile {
  version: number;
  entries: Record<string, CachedEnrichment>;
}

export class LlmCache {
  private entries: Map<string, CachedEnrichment> = new Map();
  private dirty = false;
  hits = 0;
  misses = 0;

  constructor(private readonly filePath: string) {}

  load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as CacheFile;
      if (parsed.version !== CACHE_VERSION) return; // bump → ignora
      for (const [k, v] of Object.entries(parsed.entries ?? {})) {
        this.entries.set(k, v);
      }
    } catch {
      // cache corrompido — segue sem
    }
  }

  save(): void {
    if (!this.dirty) return;
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const data: CacheFile = {
      version: CACHE_VERSION,
      entries: Object.fromEntries(this.entries),
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  get(finding: Finding, mode: string): CachedEnrichment | undefined {
    const key = cacheKey(finding, mode);
    const v = this.entries.get(key);
    if (v) this.hits++;
    else this.misses++;
    return v;
  }

  set(
    finding: Finding,
    mode: string,
    enrichment: Pick<
      EnrichedFinding,
      "llmExplanation" | "llmFix" | "llmCommand"
    >,
  ): void {
    const key = cacheKey(finding, mode);
    this.entries.set(key, {
      ...enrichment,
      savedAt: new Date().toISOString(),
    });
    this.dirty = true;
  }
}

export function cacheKey(finding: Finding, mode: string): string {
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

export function defaultCachePath(root: string): string {
  return path.join(root, CACHE_FILENAME);
}
