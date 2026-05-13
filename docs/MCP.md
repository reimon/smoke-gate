# smoke-gate MCP server

A partir da v0.3, o smoke-gate roda como **servidor MCP** (Model Context Protocol). Qualquer agente MCP-aware (Claude Code, Cursor, Cline, Continue, Zed, Windsurf, e clientes Codex/Devin que falam MCP) consome as ferramentas nativamente — sem skill por vendor.

## Instalação

```bash
npm i -D "github:reimon/smoke-gate#v0.3.0"
```

Ou globalmente:

```bash
npm i -g "github:reimon/smoke-gate#v0.3.0"
```

## Config — Claude Code

`~/.claude.json` (ou `<projeto>/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "smoke-gate": {
      "command": "npx",
      "args": ["-y", "@kaiketsu/smoke-gate", "mcp", "serve"]
    }
  }
}
```

Ou se instalou globalmente:

```json
{
  "mcpServers": {
    "smoke-gate": {
      "command": "smoke-gate",
      "args": ["mcp", "serve"]
    }
  }
}
```

## Config — Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "smoke-gate": {
      "command": "npx",
      "args": ["-y", "@kaiketsu/smoke-gate", "mcp", "serve"]
    }
  }
}
```

## Config — Cline

`cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "smoke-gate": {
      "command": "npx",
      "args": ["-y", "@kaiketsu/smoke-gate", "mcp", "serve"]
    }
  }
}
```

## Ferramentas expostas

### `audit_check_sql` — **killer feature**

Valida uma string SQL contra o schema do projeto. Latência <50ms (cache).

```jsonc
{
  "sql": "SELECT e.user_id, u.role FROM enrollments e JOIN users u ON e.id = u.id"
}
```

Retorna:
```jsonc
{
  "ok": false,
  "issues": [
    { "kind": "column_not_found", "table": "enrollments", "column": "user_id",
      "suggestion": "student_id", "message": "Coluna 'user_id' não existe em enrollments." },
    { "kind": "column_not_found", "table": "users", "column": "role",
      "suggestion": "id", "message": "Coluna 'role' não existe em users." }
  ]
}
```

**Use ANTES de gerar uma query SQL nova.** Previne o bug em vez de pegar em CI.

### `schema_lookup`

Lista colunas de uma tabela:
```jsonc
{ "table": "enrollments" }
// → { "found": true, "columns": ["id","student_id","package_id",...] }
```

### `audit_run`

Roda todos os detectores. Retorna findings.

```jsonc
{ "detectors": ["sqlDrift", "errorLeak"], "severityMin": "warning" }
```

### `audit_explain`

Recupera 80 linhas de contexto em torno de um finding.

```jsonc
{ "file": "api/src/routes/admin.ts", "line": 825 }
```

### `audit_apply_fix`

Gera patch unificado (dry-run por padrão na v0.3).

```jsonc
{ "file": "api/src/lib/users/queryHelpers.ts", "line": 54,
  "oldText": "e.user_id = u.id", "newText": "e.student_id = u.id" }
```

### `invalidate_schema`

Força reload do schema cache (após nova migration).

## Fluxo recomendado

```
Agente escreve route handler com SELECT
  ↓
audit_check_sql       → 50ms, retorna ok ou issues
  ↓
Se issues:
  schema_lookup       → confere colunas reais
  ↓
  Agente regenera SQL correto
  ↓
audit_check_sql       → ok
  ↓
Salva arquivo
```

Bug **nunca chega no commit**.

## Performance

| Operação | 1ª chamada | Subsequentes |
|---|---|---|
| `audit_check_sql` | ~2s (carrega schema) | <50ms |
| `schema_lookup` | ~2s | <10ms |
| `audit_run` | ~3s | ~1s |
| `audit_explain` | <100ms | <100ms |

Schema cache invalida automaticamente quando arquivos .sql mudam (mtime).
