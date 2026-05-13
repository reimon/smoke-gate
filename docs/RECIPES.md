# Receitas

## Express + pg + vitest

```ts
// api/src/test/myFeature.smoke.test.ts
import { defineSmokeSuite } from "@kaiketsu/smoke-gate";
import { supertestDriver } from "@kaiketsu/smoke-gate/express";
import { seedTables, cleanupByCascade } from "@kaiketsu/smoke-gate/pg";
import { fakeAuth } from "@kaiketsu/smoke-gate/mocks";
import { describe, it, beforeAll, afterAll } from "vitest";
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

```yaml
- name: Smoke Gate (bloqueia deploy se quebrar)
  working-directory: api
  env:
    DATABASE_URL: postgresql://user:pass@localhost:5432/db
  run: npx vitest run src/test/**/*.smoke.test.ts
```

## Runner standalone (sem vitest)

```ts
import { runSmokeSuite, formatReport } from "@kaiketsu/smoke-gate";

const report = await runSmokeSuite(suite);
if (report.failed > 0) {
  console.error(formatReport(report));
  process.exit(1);
}
```

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

## Por que NÃO mockar o pool

Mockar `pool.query` esconde o bug que este teste existe pra pegar. Drift entre código e schema só é detectável quando o SQL roda contra o schema real.

- ✅ DB real (CI: serviço Postgres + migrations aplicadas; local: docker compose).
- ✅ Mock só de serviços **externos**: auth (injeta user), LLM (retorna stub), storage (S3/Azure Blob), email.
- ❌ Não mocka `pg`, não mocka queries, não mocka migrations.

## Quando NÃO usar

- ❌ Testar lógica de negócio. Use unit tests pra isso.
- ❌ Testar fluxos com muitos passos (carrinho → checkout → confirmação). Use E2E (Playwright).
- ❌ Validar contrato de schema do response. Use Zod/Pact.

O smoke gate tem **um** trabalho: garantir que cada endpoint **executa sem 500**. Não é cobertura, é guarda de regressão de drift.
