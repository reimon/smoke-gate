# @kaiketsu/smoke-gate

CI gate que bate **todos os endpoints HTTP** contra um **DB real** e bloqueia o deploy se algum retornar 500 + scanner estático que pega drift entre código SQL e schema, IDOR, error leak, race conditions e mais — **antes** da produção.

## Por que existe

Bugs como `column "lat.created_at" does not exist` só aparecem em runtime, depois que o usuário importa dados reais. `pg.query("SELECT ...")` é uma string opaca pro TypeScript — qualquer rename de coluna no schema passa pelo build, pelos testes unitários (que mockam `pool`), e estoura em produção.

Este pacote ataca o problema em duas frentes:

1. **Runtime gate**: um teste de integração que **NÃO mocka o DB**, seeda fixture, bate cada endpoint, e falha se algum retorna 500.
2. **Scanner estático (`smoke-gate audit`)**: 7 detectores deterministicos que encontram padrões frágeis no código antes deles virarem bug.

Origem: padrão extraído do projeto [kaiketsu](https://github.com/reimon/futuro-decodificado-mentoria) depois que o mesmo tipo de bug quebrou produção 3 vezes seguidas.

## Instalação rápida

```bash
npm install -D @kaiketsu/smoke-gate
```

Detalhes (pré-requisitos, instalação global, Postgres em CI): [`docs/INSTALL.md`](docs/INSTALL.md).

## Qual o teu caso?

| Quero… | Caminho | Onde começar |
|---|---|---|
| Achar problemas no meu repo agora, sem mudar nada | **A — Audit estático** | [Getting started › A](docs/GETTING_STARTED.md#caminho-a--scanner-estático-audit-em-qualquer-repo) |
| Testar todos endpoints contra Postgres real em CI | **B — Runtime gate** | [Getting started › B](docs/GETTING_STARTED.md#caminho-b--runtime-gate-smoke-contra-db-real) |
| Plugar no Claude Code / Cursor / Cline | **C — MCP server** | [Getting started › C](docs/GETTING_STARTED.md#caminho-c--mcp-server-claude-code--cursor--cline) |
| Adicionar regras internas da minha empresa | **D — Custom detectors** | [Getting started › D](docs/GETTING_STARTED.md#caminho-d--custom-detectors-sua-empresa-suas-regras) |

## Sneak peek

**Audit estático** (caminho A):
```bash
npx smoke-gate audit --llm none           # offline, gera audit-report.md
npx smoke-gate audit --since origin/main  # só arquivos do PR, em segundos
npx smoke-gate audit --llm anthropic      # com explicações + fix por LLM
```

**Runtime gate** (caminho B):
```ts
const suite = defineSmokeSuite({
  name: "MyFeature",
  driver: await supertestDriver(app),
  endpoints: [
    { method: "GET", path: `/my-feature/${USER_ID}/overview` },
    { method: "GET", path: `/my-feature/${USER_ID}/score` },
  ],
  expect: { notStatuses: [500], maxLatencyMs: 5000 },
});
```

Cada endpoint vira um `it()` separado — CI mostra exatamente qual quebrou.

**MCP** (caminho C):
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

Killer feature: **`audit_check_sql`** valida uma query SQL contra o schema em **<50ms** — agente chama antes de gerar SQL → previne bug.

## Detectores built-in

| Detector | O que pega |
|---|---|
| `sqlDrift` | Colunas em SQL que não existem nas migrations. |
| `authGaps` | Rotas com `:userId` sem ownership middleware. |
| `errorLeak` | `res.status(5xx).json({ message: err.message })` — vaza internals. |
| `unsafeJsonParse` | `JSON.parse` sem try/catch. |
| `dbMockInTest` | `vi.mock("./db/pool", ...)` — anti-pattern. |
| `raceCondition` | SELECT + INSERT sem transação. |
| `smokeCoverage` | Endpoint declarado sem cobertura em `*.smoke.test.ts`. |

Pular um arquivo: adicione `// smoke-gate-ignore-file` nas primeiras 500 chars. Mais: [`docs/DETECTORS.md`](docs/DETECTORS.md).

## GitHub Action

```yaml
- uses: reimon/smoke-gate/action@v0.5.0
  with: { fail-on: critical, comment: summary }
```

Audit diff-only em PRs, comentário sticky, bloqueia merge em critical. Detalhes: [`action/README.md`](action/README.md).

## Docs

- [`INSTALL.md`](docs/INSTALL.md) — pré-requisitos, formas de instalar, Postgres em CI
- [`GETTING_STARTED.md`](docs/GETTING_STARTED.md) — passo-a-passo dos 4 caminhos
- [`RECIPES.md`](docs/RECIPES.md) — receitas completas + API reference
- [`DETECTORS.md`](docs/DETECTORS.md) — cada detector + LLM + cache
- [`MCP.md`](docs/MCP.md) — Claude Code, Cursor, Cline, Continue, Zed, Windsurf
- [`CUSTOM_DETECTORS.md`](docs/CUSTOM_DETECTORS.md) — escrever detectores próprios
- [`TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — erros comuns

## Roadmap

- [x] v0.1 — core + Express + pg + receita vitest
- [x] v0.2 — `smoke-gate audit` CLI + detectores + 4 LLM modes
- [x] v0.3 — MCP server (agent-native, <50ms check_sql)
- [x] v0.3.1 — GitHub Action (composite + sticky PR comments)
- [x] v0.4 — custom detectors + severity overrides
- [x] v0.4.1 — `--since <ref>` diff-only audit
- [x] v0.5 — 3 detectores novos + LLM cache + testes dos detectores
- [ ] v0.6 — polyglot via Treesitter (Python/Go/Ruby)
- [ ] v0.6 — Sentry/Datadog bridge (audit ↔ prod errors)
- [ ] v0.7 — Test generation from findings + migration synthesis

## Licença

MIT
