/**
 * Tipos compartilhados do módulo audit.
 */
export type Severity = "critical" | "warning" | "info";
export interface CodeLocation {
    /** Caminho relativo ao root do projeto. */
    file: string;
    line: number;
    /** Coluna opcional (1-based). */
    column?: number;
}
export interface Finding {
    /** Código único do detector (ex: "SQL-001", "AUTH-002"). */
    code: string;
    /** Nome do detector que gerou (ex: "sqlDrift"). */
    detector: string;
    severity: Severity;
    /** Título curto pra report. */
    title: string;
    location: CodeLocation;
    /** Trecho do código que disparou (3-10 linhas). */
    snippet: string;
    /** Por que isso é problema (em PT-BR). */
    evidence: string;
    /** Fix sugerido pelo detector (pode ser refinado por LLM). */
    suggestedFix?: string;
}
export interface EnrichedFinding extends Finding {
    /** Explicação ampliada pelo LLM. */
    llmExplanation?: string;
    /** Fix proposto pelo LLM (pode reescrever `suggestedFix`). */
    llmFix?: string;
    /** Comando bash/git pronto pra colar. */
    llmCommand?: string;
}
export interface AuditContext {
    /** Root absoluto do projeto sendo auditado. */
    root: string;
    /** Caminho relativo ou absoluto pra migrations SQL (se houver). */
    migrationsPath?: string;
    /** Caminho relativo pros routes (default: "api/src/routes" ou "src/routes"). */
    routesPath?: string;
    /** Caminhos a ignorar. */
    ignore?: string[];
}
export interface Detector {
    name: string;
    /** Roda o detector contra o projeto e retorna findings. */
    run(ctx: AuditContext): Promise<Finding[]>;
}
export interface LlmAdapter {
    name: string;
    /** Recebe finding + contexto e devolve campos enriquecidos. */
    enrich(finding: Finding, fileContext: string): Promise<Pick<EnrichedFinding, "llmExplanation" | "llmFix" | "llmCommand">>;
}
//# sourceMappingURL=types.d.ts.map