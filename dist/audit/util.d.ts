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
/**
 * Arquivo declara `// smoke-gate-ignore-file` no topo? Detectores devem pular.
 * Usado pelos próprios arquivos de detector pra evitar self-match nos padrões
 * de referência (regex, exemplos em comentário), e disponível pra usuários
 * marcarem arquivos legados/gerados.
 */
export declare function hasIgnoreSentinel(source: string): boolean;
/** Calcula linha (1-based) de um índice de caractere no source. */
export declare function lineOfIndex(source: string, idx: number): number;
/** Extrai N linhas centradas em torno de uma linha (1-based). */
export declare function extractSnippet(source: string, line: number, context?: number): string;
/** Caminho relativo ao root (útil pra report). */
export declare function relPath(root: string, abs: string): string;
/**
 * Filtra lista de arquivos absolutos por uma whitelist relativa ao root.
 * Se filter for undefined, retorna a lista intacta.
 */
export declare function applyFileFilter(files: string[], root: string, filter: Set<string> | undefined): string[];
/**
 * Roda `git diff --name-only <base>...HEAD` e devolve a lista de arquivos
 * modificados (relativos ao root do repo). Retorna [] se git falhar.
 *
 * `base` pode ser: "main", "origin/main", "HEAD~5", commit SHA, etc.
 */
export declare function gitDiffFiles(root: string, base: string): string[];
//# sourceMappingURL=util.d.ts.map