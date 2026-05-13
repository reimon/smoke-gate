/**
 * Utilities compartilhados pelos detectores.
 */
/**
 * Walk recursivo retornando todos os arquivos com extensões aceitas.
 * Pula node_modules, dist, .git, e padrões em `ignore`.
 */
export declare function walkFiles(root: string, exts: string[], ignore?: string[]): string[];
/** Lê arquivo retornando string vazia em erro (evita try/catch repetido). */
export declare function readFileSafe(fp: string): string;
/** Calcula linha (1-based) de um índice de caractere no source. */
export declare function lineOfIndex(source: string, idx: number): number;
/** Extrai N linhas centradas em torno de uma linha (1-based). */
export declare function extractSnippet(source: string, line: number, context?: number): string;
/** Caminho relativo ao root (útil pra report). */
export declare function relPath(root: string, abs: string): string;
//# sourceMappingURL=util.d.ts.map