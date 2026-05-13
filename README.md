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

## Receita (Express + pg)

```ts
// api/src/test/myFeature.smoke.test.ts
import { describe } from "vitest";
import { defineSmokeSuite } from "@kaiketsu/smoke-gate";
import { supertestDriver } from "@kaiketsu/smoke-gate/express";
import { seedTables, cleanupByCascade } from "@kaiketsu/smoke-gate/pg";
import { fakeAuth } from "@kaiketsu/smoke-gate/mocks";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { SmokeContext } from "@kaiketsu/smoke-gate";
import express from "express";
import { pool } from "../db/pool";
import myRouter from "../routes/myRouter";

const USER_ID = crypto.randomUUID();
const app = express();
app.use(fakeAuth({ id: USER_ID, role: "aluno" }));
app.use("/my-feature", myRouter);

const suite = defineSmokeSuite({
  name: "MyFeature smoke",
  driver: await supertestDriver(app),

  setup: async (ctx) => {
    const { returned } = await seedTables(pool, [
      {
        table: "users",
        columns: ["id", "email", "full_name"],
        values: [[USER_ID, `${USER_ID}@smoke.test`, "Smoke User"]],
        onConflict: "ON CONFLICT (id) DO NOTHING",
      },
      {
        table: "linkedin_profiles",
        columns: ["user_id", "first_name"],
        values: [[USER_ID, "Smoke"]],
        returning: "id",
      },
    ]);
    ctx.set("profileId", returned[1][0]);
  },

  endpoints: [
    { method: "GET", path: `/my-feature/${USER_ID}/overview` },
    { method: "GET", path: `/my-feature/${USER_ID}/score` },
    {
      method: "GET",
      path: "/my-feature/profile/RESOLVE",
      resolve: (ctx) => ({
        path: `/my-feature/profile/${ctx.require("profileId")}`,
      }),
    },
  ],

  teardown: async () => {
    await cleanupByCascade(pool, "users", "id = $1", [USER_ID]);
  },

  expect: { notStatuses: [500], maxLatencyMs: 5000 },
});

// Bridge inline pra vitest (15 linhas — mantém a lib agnóstica de test runner):
describe(suite.name, () => {
  const ctx = new SmokeContext();
  beforeAll(async () => suite.setup?.(ctx));
  afterAll(async () => suite.teardown?.(ctx));

  const notStatuses = suite.expect?.notStatuses ?? [500];
  for (const ep of suite.endpoints) {
    it(`${ep.method} ${ep.path}`, async () => {
      const resolved = ep.resolve?.(ctx) ?? {};
      const res = await suite.driver.request({
        ...ep,
        path: resolved.path ?? ep.path,
        body: resolved.body ?? ep.body,
      });
      const explicitOk = ep.okStatuses?.includes(res.status) ?? false;
      if (notStatuses.includes(res.status) && !explicitOk) {
        throw new Error(`status ${res.status}: ${JSON.stringify(res.body)}`);
      }
    });
  }
});
```

Cada endpoint vira um `it()` separado — CI mostra exatamente qual quebrou.

## CI gate (GitHub Actions)

Rode o smoke como step **bloqueante**, separado dos testes legados:

```yaml
- name: Smoke Gate (bloqueia deploy se quebrar)
  working-directory: api
  env:
    DATABASE_URL: postgresql://user:pass@localhost:5432/db
  run: npx vitest run src/test/**/*.smoke.test.ts
```

## Por que NÃO mockar o pool

Mockar `pool.query` esconde o bug que este teste existe pra pegar. Drift entre código e schema só é detectável quando o SQL roda contra o schema real.

- ✅ DB real (CI: serviço Postgres + migrations aplicadas; local: docker compose).
- ✅ Mock só de serviços **externos**: auth (injeta user), LLM (retorna stub), storage (S3/Azure Blob), email.
- ❌ Não mocka `pg`, não mocka queries, não mocka migrations.

## API

### `defineSmokeSuite(config)`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `name` | `string` | Aparece em logs/relatórios. |
| `driver` | `SmokeDriver` | Como bater no app (supertest / fastify.inject / fetch). |
| `endpoints` | `SmokeEndpoint[]` | Lista de endpoints. |
| `setup?` | `(ctx) => void` | Roda 1× antes de tudo. Use `ctx.set()` pra expor estado. |
| `teardown?` | `(ctx) => void` | Roda 1× depois de tudo (mesmo se falhou). |
| `expect.notStatuses?` | `number[]` | Status codes que reprovam. Default: `[500]`. |
| `expect.maxLatencyMs?` | `number` | Falha se algum endpoint exceder. |

### `SmokeEndpoint`

```ts
{
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  okStatuses?: number[];      // sobrescreve notStatuses só pra este endpoint
  resolve?: (ctx) => { path?, body? };  // path/body dinâmicos
}
```

### Drivers

- `supertestDriver(app)` — Express / Connect.
- *(planejado)* `fastifyDriver(app)`, `nextDriver(handlers)`.

### Helpers de DB

- `seedTables(pool, specs[])` — insert batch tipado, com RETURNING opcional.
- `cleanupTables(pool, specs[])` — DELETE WHERE explícito.
- `cleanupByCascade(pool, table, where, params)` — atalho via FK CASCADE.

### Helpers de mock

- `fakeAuth(user)` — middleware Express que injeta `req.user`.
- `fakeAuthModule(user)` — pra `vi.mock("./middleware/auth", () => fakeAuthModule(...))`.

### Runner standalone (sem vitest)

```ts
import { runSmokeSuite, formatReport } from "@kaiketsu/smoke-gate";

const report = await runSmokeSuite(suite);
if (report.failed > 0) {
  console.error(formatReport(report));
  process.exit(1);
}
```

## Quando NÃO usar

- ❌ Testar lógica de negócio. Use unit tests pra isso.
- ❌ Testar fluxos com muitos passos (carrinho → checkout → confirmação). Use E2E (Playwright).
- ❌ Validar contrato de schema do response. Use Zod/Pact.

O smoke gate tem **um** trabalho: garantir que cada endpoint **executa sem 500**. Não é cobertura, é guarda de regressão de drift.

## `smoke-gate audit` — modo proativo (v0.2+)

Além do CI gate reativo, o pacote vem com um **scanner estático** que encontra padrões frágeis no código **antes** deles virarem bug.

```bash
# Roda detectores e gera audit-report.md
npx smoke-gate audit --llm anthropic

# Modo offline (sem LLM, só detectores deterministicos):
npx smoke-gate audit --llm none

# Específico:
npx smoke-gate audit --root ./api --detectors sqlDrift --out drift.md
```

### Detectores

| Detector | O que pega |
|---|---|
| `sqlDrift` | Colunas referenciadas em SQL que não existem nas migrations (`lat.created_at` quando schema tem `imported_at`). Cross-ref schema completo: base + ALTER + CREATE. |
| `authGaps` | Rotas com `:userId`/`:profileId` sem middleware tipo `checkUserOwnership`. Ignora routers com auth mount-level. |
| `errorLeak` | `res.status(5xx).json({ message: err.message })` — vaza tabelas/paths/IPs internos pro cliente. |
| `smokeCoverage` | Endpoints declarados que não aparecem em nenhum `*.smoke.test.ts`. |

### LLMs suportados

| Modo | Var de env | Custo |
|---|---|---|
| `--llm none` | — | grátis (sem enriquecimento) |
| `--llm anthropic` | `ANTHROPIC_API_KEY` | ~$0.001/finding com Claude Haiku |
| `--llm openai` | `OPENAI_API_KEY` | ~$0.001/finding com gpt-4o-mini |
| `--llm ollama` | `OLLAMA_URL` (default localhost:11434), `OLLAMA_MODEL` (default llama3.2) | grátis (local) |

Sem LLM: o report tem o fix sugerido pelo detector (regex/heuristic).
Com LLM: o report ganha explicação contextual + diff unificado + comando bash pronto pra colar.

### Output

`audit-report.md` agrupado por severidade. Exit code **2** se houver findings críticos — bloqueia merge se rodar em CI:

```yaml
# .github/workflows/audit.yml
- name: Code audit (smoke-gate)
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: npx smoke-gate audit --llm anthropic --out audit-report.md
```

## Modo MCP (v0.3+) — agent-native

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

Tools: `audit_check_sql`, `schema_lookup`, `audit_run`, `audit_explain`, `audit_apply_fix`, `invalidate_schema`. Veja [docs/MCP.md](docs/MCP.md).

## Custom detectors (v0.4)

Cria `smoke-gate.config.{ts,js,mjs,cjs}` no root do projeto. Cada empresa registra detectores próprios — multiplica adoção sem você commitar nada.

```ts
import { defineConfig, type Detector } from "@kaiketsu/smoke-gate";

const auditLogRequired: Detector = {
  name: "auditLogRequired",
  async run(ctx) {
    // ... encontra rotas /admin/* sem auditLog()
    return findings;
  },
};

export default defineConfig({
  detectors: [auditLogRequired],
  disable: ["smokeCoverage"],          // desliga built-in que não importa
  severityOverrides: { "AUTH-001": "warning" },
  ignore: ["legacy/**"],
});
```

Para `.ts` sem build, instale `tsx`: `npm i -D tsx`. Ou compile pra `.js`.

Exemplo completo com 2 detectores reais (`adminAuditLogRequired`, `crossFeatureImports`) em [`examples/custom-detectors/smoke-gate.config.ts`](examples/custom-detectors/smoke-gate.config.ts).

## GitHub Action (v0.3.1)

`.github/workflows/audit.yml`:
```yaml
- uses: reimon/smoke-gate/action@v0.3.1
  with: { fail-on: critical, comment: summary }
```

Comenta inline em PRs, bloqueia merge em criticals. Veja [action/README.md](action/README.md).

## Roadmap

- [x] v0.1 — core + Express + pg + receita vitest
- [x] v0.2 — `smoke-gate audit` CLI + 4 detectores + 4 LLM modes
- [x] v0.3 — MCP server (agent-native, <50ms check_sql)
- [x] v0.3.1 — GitHub Action (composite + sticky PR comments)
- [x] v0.4 — `smoke-gate.config.{ts,js,mjs,cjs}` custom detectors + overrides
- [x] v0.4.1 — `--since <ref>` (audit em <200ms quando o PR é pequeno)
- [x] v0.5 — 3 detectores novos: `unsafeJsonParse`, `dbMockInTest`, `raceCondition`
- [ ] v0.6 — polyglot via Treesitter (Python/Go/Ruby)
- [ ] v0.6 — Sentry/Datadog bridge (audit ↔ prod errors)
- [ ] v0.7 — Test generation from findings + migration synthesis

## Licença

MIT
