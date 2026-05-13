/**
 * Formata findings (enriched ou não) como markdown.
 */
import type { EnrichedFinding } from "../types";
export declare function formatMarkdown(findings: EnrichedFinding[], meta: {
    project: string;
    date: string;
    llm: string;
}): string;
//# sourceMappingURL=markdown.d.ts.map