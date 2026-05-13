/**
 * LLM adapters — interface comum: enrich(finding, fileContext) → enriched.
 *
 * Modos:
 *   - "none"      : zero-LLM, usa só suggestedFix dos detectores
 *   - "anthropic" : Claude via API (ANTHROPIC_API_KEY)
 *   - "openai"    : GPT via API (OPENAI_API_KEY)
 *   - "ollama"    : local via http://localhost:11434
 */
import type { LlmAdapter } from "../types";
export type LlmMode = "none" | "anthropic" | "openai" | "ollama";
/**
 * Factory — escolhe adapter baseado em mode + env vars.
 *
 * Anthropic:  ANTHROPIC_API_KEY
 * OpenAI:     OPENAI_API_KEY
 * Ollama:     OLLAMA_URL (default http://localhost:11434), OLLAMA_MODEL (default llama3.2)
 */
export declare function getLlmAdapter(mode: LlmMode): LlmAdapter;
//# sourceMappingURL=index.d.ts.map