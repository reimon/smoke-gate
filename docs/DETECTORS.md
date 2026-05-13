# Detectores (`smoke-gate audit`)

Scanner estático que encontra padrões frágeis no código **antes** deles virarem bug.

```bash
# Roda detectores e gera audit-report.md
npx smoke-gate audit --llm anthropic

# Modo offline (sem LLM, só detectores deterministicos)
npx smoke-gate audit --llm none

# Específico
npx smoke-gate audit --root ./api --detectors sqlDrift --out drift.md

# Diff-only (audita apenas arquivos modificados desde um ref)
npx smoke-gate audit --since origin/main --llm none
```

## Detectores built-in

| Detector | Code | O que pega |
|---|---|---|
| `sqlDrift` | `SQL-*` | Colunas referenciadas em SQL que não existem nas migrations (`lat.created_at` quando schema tem `imported_at`). Cross-ref schema completo: base + ALTER + CREATE. |
| `authGaps` | `AUTH-*` | Rotas com `:userId`/`:profileId` sem middleware tipo `checkUserOwnership`. Ignora routers com auth mount-level. |
| `errorLeak` | `ERR-*` | `res.status(5xx).json({ message: err.message })` — vaza tabelas/paths/IPs internos pro cliente. |
| `unsafeJsonParse` | `JSON-*` | `JSON.parse(...)` sem try/catch. Body malformado vira 500. |
| `dbMockInTest` | `MOCK-*` | `vi.mock("./db/pool", ...)` / equivalente — anti-pattern que motivou o framework. |
| `raceCondition` | `RACE-*` | `SELECT ... ` seguido de `INSERT/UPDATE` sem transação/lock/`ON CONFLICT`. |
| `smokeCoverage` | `COV-*` | Endpoints declarados que não aparecem em nenhum `*.smoke.test.ts`. |

## Pular um arquivo

Adicione `// smoke-gate-ignore-file` nas primeiras 500 chars do arquivo. Útil pra módulos que contêm padrões de exemplo, código legado fora de escopo, ou arquivos gerados.

## LLMs suportados

| Modo | Var de env | Custo |
|---|---|---|
| `--llm none` | — | grátis (sem enriquecimento) |
| `--llm anthropic` | `ANTHROPIC_API_KEY` | ~$0.001/finding com Claude Haiku |
| `--llm openai` | `OPENAI_API_KEY` | ~$0.001/finding com gpt-4o-mini |
| `--llm ollama` | `OLLAMA_URL` (default localhost:11434), `OLLAMA_MODEL` (default llama3.2) | grátis (local) |

Sem LLM: o report tem o fix sugerido pelo detector (regex/heuristic).
Com LLM: o report ganha explicação contextual + diff unificado + comando bash pronto pra colar.

## Output

`audit-report.md` agrupado por severidade. Exit code **2** se houver findings críticos — bloqueia merge se rodar em CI:

```yaml
# .github/workflows/audit.yml
- name: Code audit (smoke-gate)
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: npx smoke-gate audit --llm anthropic --out audit-report.md
```

## GitHub Action (composite)

```yaml
- uses: reimon/smoke-gate/action@v0.3.1
  with: { fail-on: critical, comment: summary }
```

Comenta inline em PRs, bloqueia merge em criticals. Veja [`action/README.md`](../action/README.md).
