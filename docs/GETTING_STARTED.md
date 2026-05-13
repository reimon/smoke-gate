# Getting started

Quatro caminhos. Escolha o que casa com seu caso.

> Antes: pré-requisitos e instalação em [`INSTALL.md`](INSTALL.md).

---

## Caminho A — Scanner estático (audit) em qualquer repo

**Caso:** quer encontrar padrões frágeis (drift SQL, auth gaps, error leaks, race conditions, JSON.parse sem try) no código atual sem mudar nada.

### 1. Rodar uma vez localmente

```bash
cd seu-projeto
npx smoke-gate audit --llm none
```

Saída: `audit-report.md` no root.

### 2. (Opcional) Enriquecer com LLM

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx smoke-gate audit --llm anthropic --out audit-report.md
```

Outras opções: `openai`, `ollama` (local). Custo ~$0.001/finding com Claude Haiku. Resultados são cacheados em `.smoke-gate/llm-cache.json` — re-runs não pagam de novo o mesmo finding.

### 3. Plugar em CI (GitHub Actions)

`.github/workflows/audit.yml`:
```yaml
name: audit
on: pull_request

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: reimon/smoke-gate/action@v0.5.0
        with:
          fail-on: critical
          comment: summary
```

Comportamento:
- Roda só em arquivos modificados no PR (`--since origin/<base>`) — segundos mesmo em monorepo.
- Comenta sticky no PR com resumo dos findings.
- Falha o job se houver `critical` → bloqueia merge se branch protection exigir CI verde.

Detalhes: [`../action/README.md`](../action/README.md). Detectores: [`DETECTORS.md`](DETECTORS.md).

### Checkpoint

✅ `audit-report.md` foi gerado.
✅ Você sabe quantos critical/warning/info têm.
✅ CI bloqueia PRs com critical.

---

## Caminho B — Runtime gate (smoke contra DB real)

**Caso:** quer um teste de integração que bate todos os endpoints HTTP contra Postgres real e bloqueia deploy se algum retornar 500.

### 1. Instalar peer deps

```bash
npm install -D @kaiketsu/smoke-gate supertest pg vitest
```

### 2. Subir Postgres (local) ou configurar service em CI

Veja a seção "Postgres pro modo runtime gate" em [`INSTALL.md`](INSTALL.md).

### 3. Criar o smoke test

```ts
// api/src/test/myFeature.smoke.test.ts
import { defineSmokeSuite, SmokeContext } from "@kaiketsu/smoke-gate";
import { supertestDriver } from "@kaiketsu/smoke-gate/express";
import { seedTables, cleanupByCascade } from "@kaiketsu/smoke-gate/pg";
import { fakeAuth } from "@kaiketsu/smoke-gate/mocks";
import { describe, it, beforeAll, afterAll } from "vitest";
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
  setup: async (_ctx) => {
    await seedTables(pool, [
      {
        table: "users",
        columns: ["id", "email"],
        values: [[USER_ID, `${USER_ID}@smoke.test`]],
        onConflict: "ON CONFLICT (id) DO NOTHING",
      },
    ]);
  },
  endpoints: [
    { method: "GET", path: `/my-feature/${USER_ID}/overview` },
    { method: "GET", path: `/my-feature/${USER_ID}/score` },
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

### 4. Rodar local

```bash
export DATABASE_URL=postgresql://dev:dev@localhost:5432/app_test
npm run migrate    # do seu projeto
npx vitest run "src/test/**/*.smoke.test.ts"
```

### 5. Rodar em CI

Step bloqueante separado dos unit tests:
```yaml
- name: Smoke gate
  env:
    DATABASE_URL: ${{ env.DATABASE_URL }}
  run: npx vitest run "api/src/test/**/*.smoke.test.ts"
```

Recipe completo (com fixtures dinâmicas via `ctx.set/require`, resolver de path, drivers customizados): [`RECIPES.md`](RECIPES.md).

### Checkpoint

✅ `*.smoke.test.ts` roda local contra Postgres real.
✅ Cada endpoint vira um `it()` — falha individual mostra qual quebrou.
✅ CI tem step bloqueante separado.

---

## Caminho C — MCP server (Claude Code / Cursor / Cline)

**Caso:** quer o agente AI consumir as ferramentas do smoke-gate nativamente — chamando `audit_check_sql` antes de gerar SQL, `audit_run` quando você pedir "ache problemas no código", etc.

### 1. Configurar o cliente

**Claude Code** (`~/.claude.json` ou `<projeto>/.claude/mcp.json`):
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

**Cursor** (`.cursor/mcp.json`), **Cline**, **Continue**, **Zed**, **Windsurf**: estruturas similares. Veja [`MCP.md`](MCP.md).

### 2. Reiniciar o cliente

O smoke-gate aparece na lista de MCP servers. Tools disponíveis:

| Tool | O que faz |
|---|---|
| `audit_check_sql` | Valida 1 query SQL contra o schema (< 50ms via cache em memória). |
| `schema_lookup` | Lista colunas de uma tabela. |
| `audit_run` | Roda todos os detectores. |
| `audit_explain` | Detalha 1 finding. |
| `audit_apply_fix` | Aplica o fix sugerido. |
| `invalidate_schema` | Força reload das migrations (após mudança). |

### 3. Usar

Peça pro agente: *"valida essa query antes de gerar"*, *"roda audit no repo"*, *"que colunas a tabela users tem?"*. O agente chama as tools sozinho.

### Checkpoint

✅ MCP server aparece no cliente sem erros.
✅ Agente consegue chamar `audit_check_sql` numa query.
✅ Latência < 50ms na segunda chamada (cache).

---

## Caminho D — Custom detectors (sua empresa, suas regras)

**Caso:** sua empresa tem padrões internos (todo endpoint admin precisa de `auditLog()`, módulo X não pode importar de módulo Y, etc.) e você quer rodar isso junto com os built-in.

### 1. Criar config no root

`smoke-gate.config.ts`:
```ts
import { defineConfig, type Detector } from "@kaiketsu/smoke-gate";

const auditLogRequired: Detector = {
  name: "auditLogRequired",
  async run(ctx) {
    // encontra rotas /admin/* sem chamada a auditLog()
    return [];
  },
};

export default defineConfig({
  detectors: [auditLogRequired],
  disable: ["smokeCoverage"],              // desliga built-in
  severityOverrides: { "AUTH-001": "warning" },
  ignore: ["legacy/**"],
});
```

Pra `.ts` sem build: `npm i -D tsx`. Ou use `smoke-gate.config.js`.

### 2. Rodar

```bash
npx smoke-gate audit --llm none
```

Os detectores custom rodam junto. Findings aparecem no mesmo report.

### Checkpoint

✅ Detector custom aparece no resumo do report.
✅ Severity overrides aplicaram.
✅ `disable` removeu o detector built-in.

Exemplo completo com 2 detectores reais: [`../examples/custom-detectors/smoke-gate.config.ts`](../examples/custom-detectors/smoke-gate.config.ts). Detalhes da API: [`CUSTOM_DETECTORS.md`](CUSTOM_DETECTORS.md).

---

## E se algo deu errado?

[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — erros comuns por modo.
