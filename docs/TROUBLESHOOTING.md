# Troubleshooting

## Geral

### `command not found: smoke-gate`

Você instalou como dev dep — use `npx smoke-gate ...` ou adicione script no `package.json`:
```json
{ "scripts": { "audit": "smoke-gate audit" } }
```
E rode `npm run audit`. Ou instale global: `npm i -g @kaiketsu/smoke-gate`.

### Node version warning

Mínimo 18, recomendado 20 LTS. Confira com `node -v`.

### Permission denied no `dist/cli.js`

Após `npm ci` em fresh checkout, o bin pode não ter +x. Solução: rebuilde (`npm run build`) ou reinstale o pacote.

---

## Audit (scanner estático)

### `sqlDrift desabilitado: nenhuma migration .sql encontrada`

O detector procura por `.sql` em paths comuns (`migrations/`, `api/migrations/`, `db/migrations/`, `db/`, `api/`). Soluções:

1. Aponte explicitamente: `npx smoke-gate audit --migrations ./caminho/das/migrations`
2. Programaticamente: `runAudit({ root, migrationsPath: "..." })`
3. Sua stack usa Drizzle/Prisma sem `.sql`? Exporte schema com `prisma migrate diff --script` ou `drizzle-kit generate` antes do audit.

### Audit retorna muitos falsos positivos

- **Self-match nos próprios padrões de exemplo:** adicione `// smoke-gate-ignore-file` no topo do arquivo.
- **Detector específico ruidoso:** desabilite via `smoke-gate.config.ts` → `disable: ["raceCondition"]`.
- **Severidade desproporcional:** override no config → `severityOverrides: { "AUTH-001": "warning" }`.
- **Caminhos legados:** `ignore: ["legacy/**"]` no config.

### Audit demora muito em monorepos grandes

Use diff-only:
```bash
npx smoke-gate audit --since origin/main
```
Audit completo em <200ms quando o PR é pequeno. `smokeCoverage` é skipado em diff-only (precisa visão global).

### LLM enrichment falha com `anthropic 401`

`ANTHROPIC_API_KEY` ausente ou inválida. Confira:
```bash
echo $ANTHROPIC_API_KEY | head -c 10   # deve começar com sk-ant-
```
Pra rodar sem LLM: `--llm none`.

### LLM enrichment está caro / repetido

O cache em `.smoke-gate/llm-cache.json` evita re-paga. Verifique:
- Hit rate aparece em stderr: `[audit] llm-cache: N hits, M misses`.
- Garanta que `.smoke-gate/` está no `.gitignore` (não no `.dockerignore`/CI se você quiser persistir entre runs — depende da estratégia).
- Pra desabilitar: `--no-cache`.

### CI: workflow não tem permissão de comentar no PR

```yaml
permissions:
  contents: read
  pull-requests: write
```

### CI: `--since origin/main` falha com `unknown revision`

O checkout default em PRs faz shallow clone. Use:
```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
```

---

## Runtime gate (smoke contra DB real)

### `connection refused 127.0.0.1:5432`

Postgres não está rodando. Local: `docker compose up -d postgres`. CI: confira `services:` no workflow + `--health-cmd pg_isready`.

### Smoke passa local mas quebra em CI com `relation "users" does not exist`

Migrations não foram aplicadas no DB de CI. Adicione step ANTES do smoke:
```yaml
- name: Apply migrations
  env:
    DATABASE_URL: postgresql://dev:dev@localhost:5432/app_test
  run: npm run migrate
```

### Erro de FK ao seedar fixtures

A ordem de `seedTables(pool, [...])` importa: parent tables primeiro. Use `onConflict: "ON CONFLICT (id) DO NOTHING"` pra idempotência (re-runs locais).

### `cleanupByCascade` apaga dados de outros testes

Esse helper deleta por `WHERE` + FK CASCADE — afetará qualquer linha que casar com o filtro. Use um `USER_ID` único por suite (`crypto.randomUUID()`) e filtre por ele:
```ts
await cleanupByCascade(pool, "users", "id = $1", [USER_ID]);
```

### `okStatuses` não está sobrescrevendo `notStatuses`

`okStatuses` é por endpoint, `notStatuses` é por suite. Se ambos contêm o mesmo status, `okStatuses` ganha (o endpoint específico). Confira ordem dos arrays.

### Smoke é flaky em CI mas estável local

Causas comuns:
1. `maxLatencyMs` apertado demais — CI shared runners são mais lentos. Suba pra 10000ms.
2. Setup não esperou Postgres ready — adicione `pg_isready` no service `options:`.
3. Race entre migration step e smoke step — encadear sequencial, não paralelo.

---

## MCP (Claude Code / Cursor / etc.)

### MCP server não aparece no cliente

1. Confira o arquivo de config (`~/.claude.json` ou `.cursor/mcp.json`) — JSON válido?
2. Reinicie o cliente completamente.
3. Cheque logs do cliente (em Claude Code: `claude mcp list`).
4. Teste o server stdio manualmente:
```bash
echo '{}' | npx smoke-gate mcp serve
```
Se travar imediatamente sem erro, o server está OK.

### `audit_check_sql` retorna `Schema cache vazio`

Sem migrations encontradas. Mesmo problema/solução do `sqlDrift` acima. Passe `migrations: "./path"` na config do MCP ou rode `invalidate_schema` após apontar.

### Schema desatualizado após nova migration

```
invalidate_schema(reason: "added new migration")
```
Próxima chamada de `audit_check_sql` faz reload.

---

## Custom detectors

### `smoke-gate.config.ts` ignorado

Confira:
- Arquivo está no **root** do projeto (mesmo level do `package.json`)?
- Extensão suportada: `.ts`, `.js`, `.mjs`, `.cjs`.
- Pra `.ts` sem build: `npm i -D tsx`.
- Export é `default`? `export default defineConfig({...})`.

### Detector custom não aparece no report

- Confira `name` único (não colide com built-in: `sqlDrift`, `authGaps`, etc.).
- `severity` válida: `"critical" | "warning" | "info"`.
- Findings com `severity: "info"` não passam por LLM enrichment (esperado).

### `disable` não desabilitou o built-in

Nome deve casar exato (case-sensitive): `disable: ["smokeCoverage"]` (não `"SmokeCoverage"`).

---

## Reportar bug

Issues: https://github.com/reimon/smoke-gate/issues

Inclua:
1. Versão (`npx smoke-gate --help` mostra a versão)
2. Comando rodado
3. Output completo (stdout + stderr)
4. Trecho de código que disparou o problema (se for falso positivo/negativo)
