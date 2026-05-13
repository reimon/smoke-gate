# Instalação

## Pré-requisitos

| Requisito | Versão mínima | Observação |
|---|---|---|
| Node.js | 18+ | Recomendado 20 LTS. |
| npm / pnpm / yarn | qualquer | Exemplos usam `npm`; equivalentes funcionam. |
| git | 2.x | Necessário pra `--since <ref>` (audit diff-only). |
| Postgres | 12+ | **Só pro modo runtime gate** (smoke contra DB real). |
| Claude/Cursor/etc. | — | **Só pro modo MCP**. |

O scanner estático (`smoke-gate audit`) e custom detectors não precisam de Postgres.

## Formas de instalar

### 1. Dev dependency do projeto (recomendado)

```bash
npm install -D @kaiketsu/smoke-gate
# peers opcionais (só se usar runtime gate):
npm install -D supertest pg vitest
```

`supertest`, `pg` e `vitest` são peer deps **opcionais**. Só instale se usar o modo runtime gate.

Rode via `npx`:
```bash
npx smoke-gate audit
npx smoke-gate mcp serve
```

### 2. Instalação global

```bash
npm install -g @kaiketsu/smoke-gate
smoke-gate audit
```

Útil pra rodar audit em projetos que não declaram o pacote como dep.

### 3. Direto do GitHub (sem npm publish)

Enquanto o pacote não está no npm:

```bash
npm install -D "github:reimon/smoke-gate#v0.5.0"
```

Substitua `v0.5.0` pela tag desejada. Veja [releases](https://github.com/reimon/smoke-gate/releases).

### 4. Sem instalar (npx one-shot)

```bash
npx -y "github:reimon/smoke-gate#v0.5.0" audit
```

Faz o clone + build + run em uma chamada. Mais lento na primeira vez (cache em `~/.npm/_npx/`).

## Verificar instalação

```bash
npx smoke-gate --help
```

Esperado: ajuda do CLI com seções `Comandos`, `Modos`, `Opções`.

Audit dummy num projeto vazio:
```bash
mkdir /tmp/sg-test && cd /tmp/sg-test
npx smoke-gate audit --llm none
```

Esperado: exit code 0, `audit-report.md` criado, possivelmente `SQL-000` info ("sem migrations").

## Postgres pro modo runtime gate

O smoke-gate runtime roda contra **DB real**. Setup:

### Local (docker compose)

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: app_test
    ports:
      - "5432:5432"
```

```bash
docker compose up -d
export DATABASE_URL=postgresql://dev:dev@localhost:5432/app_test

# aplicar migrations do seu projeto antes de rodar smoke
npm run migrate
npm test
```

### GitHub Actions

```yaml
jobs:
  smoke:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: dev
          POSTGRES_PASSWORD: dev
          POSTGRES_DB: app_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://dev:dev@localhost:5432/app_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: npm }
      - run: npm ci
      - run: npm run migrate
      - run: npx vitest run "src/test/**/*.smoke.test.ts"
```

Detalhes do step de migration variam pelo projeto (Drizzle, Prisma, knex, scripts SQL). O que importa: rodar **antes** do smoke gate, contra o mesmo `DATABASE_URL`.

## Próximos passos

- **Quickstart de cada modo:** [`GETTING_STARTED.md`](GETTING_STARTED.md)
- **Receitas completas:** [`RECIPES.md`](RECIPES.md)
- **Detectores:** [`DETECTORS.md`](DETECTORS.md)
- **MCP (Claude Code/Cursor):** [`MCP.md`](MCP.md)
- **Custom detectors:** [`CUSTOM_DETECTORS.md`](CUSTOM_DETECTORS.md)
- **Problemas comuns:** [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)
