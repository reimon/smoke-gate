/**
 * Cache de schema em memória para MCP server.
 *
 * Por que existe: a CLI re-parsa migrations a cada invocação (lento, ~5s
 * em projetos grandes). MCP server roda como processo persistente — então
 * vale carregar 1x e reusar. Permite o caso `audit_check_sql` responder
 * em < 50ms, o que é o killer feature pra prevenção em tempo real.
 *
 * Invalidação: o cache tem um mtime do diretório de migrations. Se alguém
 * adiciona uma nova migration sem reiniciar o server, a próxima chamada
 * detecta o mtime maior e recarrega.
 */
export type Schema = Map<string, Set<string>>;
/**
 * Carrega (ou retorna do cache) o schema pro projeto. `projectRoot` é
 * usado como chave; mudou de projeto, novo cache.
 */
export declare function getSchema(projectRoot: string): Schema;
/** Força reload no próximo `getSchema`. */
export declare function invalidateSchema(projectRoot: string): void;
//# sourceMappingURL=schemaCache.d.ts.map