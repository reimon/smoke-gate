# @kaiketsu/smoke-gate

CI gate que bate **todos os endpoints HTTP** contra um **DB real** e bloqueia o deploy se algum retornar 500. Pega drift entre código SQL e schema **antes** da produção.

## Por que existe

Bugs como `column "lat.created_at" does not exist` só aparecem em runtime, depois que o usuário importa dados reais. `pg.query("SELECT ...")` é uma string opaca pro TypeScript — qualquer rename de coluna no schema passa pelo build, pelos testes unitários (que mockam `pool`), e estoura em produção.

Este pacote inverte: **um teste de integração que NÃO mocka o DB**, seeda fixture, bate cada endpoint, e falha se algum retorna 500. Roda em CI como step bloqueante.

Origem: padrão extraído do projeto [kaiketsu](https://github.com/reimon/futuro-decodificado-mentoria) depois que o mesmo tipo de bug quebrou produção 3 vezes seguidas.

## Instalação

```bash
npm install -D @kaiketsu/smoke-gate supertest pg vitest
```

`supertest` e `pg` são peer deps opcionais — só se você usar os adapters Express/Postgres.

## Quick start

```ts
// api/src/test/myFeature.smoke.test.ts
import { defineSmokeSuite } from "@kaiketsu/smoke-gate";
import { supertestDriver } from "@kaiketsu/smoke-gate/express";
import { fakeAuth } from "@kaiketsu/smoke-gate/mocks";
import express from "express";
import myRouter from "../routes/myRouter";

const app = express();
app.use(fakeAuth({ id: "test-user", role: "aluno" }));
app.use("/my-feature", myRouter);

const suite = defineSmokeSuite({
  name: "MyFeature smoke",
  driver: await supertestDriver(app),
  endpoints: [
    { method: "GET", path: "/my-feature/test-user/overview" },
    { method: "GET", path: "/my-feature/test-user/score" },
  ],
  expect: { notStatuses: [500], maxLatencyMs: 5000 },
});
```

Receita completa (setup, teardown, resolver dinâmico, bridge vitest, CI yaml) em [`docs/RECIPES.md`](docs/RECIPES.md).

## Os 2 modos

### 1. Runtime gate (smoke test contra DB real)

Roda em CI como step bloqueante. Cada endpoint vira um `it()` separado, falha se 500. Veja [`docs/RECIPES.md`](docs/RECIPES.md).

### 2. `smoke-gate audit` — scanner estático

7 detectores deterministicos + LLM enrichment opcional:

```bash
npx smoke-gate audit --llm none
npx smoke-gate audit --since origin/main           # diff-only
```

Detectores: `sqlDrift`, `authGaps`, `errorLeak`, `unsafeJsonParse`, `dbMockInTest`, `raceCondition`, `smokeCoverage`. Veja [`docs/DETECTORS.md`](docs/DETECTORS.md).

## Modo MCP — agent-native

`smoke-gate mcp serve` expõe detectores como ferramentas MCP. Claude Code, Cursor, Cline, Continue, Zed, Windsurf consomem nativamente.

Killer feature: **`audit_check_sql`** valida uma query SQL contra o schema em **<50ms** (cache em memória). Agente chama **antes** de gerar a SQL → previne bug.

Config no Claude Code (`~/.claude.json`):
```json
{
  "mcpServers": {
    "smoke-gate": {
      "command": "npx",
      "args": ["-y", "github:reimon/smoke-gate#v0.3.1", "mcp", "serve"]
    }
  }
}
```

Veja [`docs/MCP.md`](docs/MCP.md).

## Custom detectors

`smoke-gate.config.{ts,js,mjs,cjs}` no root do projeto registra detectores próprios, overrides de severity, e disable de built-ins. Veja [`docs/CUSTOM_DETECTORS.md`](docs/CUSTOM_DETECTORS.md).

## GitHub Action

```yaml
- uses: reimon/smoke-gate/action@v0.3.1
  with: { fail-on: critical, comment: summary }
```

Veja [`action/README.md`](action/README.md).

## Roadmap

- [x] v0.1 — core + Express + pg + receita vitest
- [x] v0.2 — `smoke-gate audit` CLI + detectores + 4 LLM modes
- [x] v0.3 — MCP server (agent-native, <50ms check_sql)
- [x] v0.3.1 — GitHub Action (composite + sticky PR comments)
- [x] v0.4 — custom detectors + severity overrides
- [x] v0.4.1 — `--since <ref>` diff-only audit
- [x] v0.5 — 3 detectores novos: `unsafeJsonParse`, `dbMockInTest`, `raceCondition`
- [ ] v0.6 — polyglot via Treesitter (Python/Go/Ruby)
- [ ] v0.6 — Sentry/Datadog bridge (audit ↔ prod errors)
- [ ] v0.7 — Test generation from findings + migration synthesis

## Licença

MIT
