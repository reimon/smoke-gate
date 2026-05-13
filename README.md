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

## Roadmap

- [x] v0.1 — core + Express + pg + vitest
- [ ] v0.2 — adapter Fastify
- [ ] v0.3 — adapter Next.js API Routes
- [ ] v0.4 — adapters Drizzle/Prisma
- [ ] v0.5 — GitHub Action `kaiketsu/smoke-gate-action@v1` (polyglot)

## Licença

MIT
