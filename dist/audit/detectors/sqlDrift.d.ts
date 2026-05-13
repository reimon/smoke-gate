/**
 * sqlDrift — encontra referências a colunas em código SQL que NÃO existem
 * no schema definido pelas migrations.
 *
 * Heurística:
 *   1. Parse migrations (.sql) → mapa { table → Set<columns> }
 *   2. Walk arquivos .ts/.js → extrai template literals que contenham SELECT/INSERT/UPDATE/DELETE
 *   3. Para cada SQL string, extrai aliases (FROM x AS y, JOIN x y) e referências `alias.col`
 *   4. Se `col` não existe em `schema[table_de_alias]` → finding
 *
 * Limitações:
 *   - Não lida com queries dinâmicas montadas via concatenação fora do template
 *   - Não resolve VIEW que mapeia colunas
 *   - Falsos positivos possíveis em colunas de tabelas externas (não migration)
 *   - Falsos negativos em colunas sem alias (ex: SELECT col FROM table)
 *
 * Mesmo assim, pega 80% dos casos que motivaram o framework
 * (lat.created_at, msg.content, c.has_attachments, etc.).
 */
import type { Detector } from "../types";
export declare const sqlDriftDetector: Detector;
//# sourceMappingURL=sqlDrift.d.ts.map