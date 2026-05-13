# reimon/smoke-gate/action

GitHub Action que roda `smoke-gate audit` em PRs e bloqueia merge se houver findings críticos.

## Quick start

`.github/workflows/audit.yml`:

```yaml
name: Code audit
on:
  pull_request:

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: reimon/smoke-gate/action@v0.3.1
```

Comportamento default:
- Roda todos os detectores contra o repo inteiro
- Posta **summary** sticky no PR (atualiza a cada commit)
- **Falha o job se houver critical** → bloqueia merge se a regra de branch protection exigir CI verde

## Configuração

```yaml
- uses: reimon/smoke-gate/action@v0.4.1
  with:
    fail-on: critical          # critical | warning | none
    comment: summary           # summary | inline | none
    diff-only: true            # só arquivos do PR (default true). false = audita tudo.
    base-ref: origin/main      # ref pra diff (default: github.base_ref ou origin/main)
    detectors: sqlDrift,errorLeak  # subset
    migrations: api/migrations # override
    root: .
    smoke-gate-version: v0.4.1
```

### Diff-only (default em PRs)

A action roda em modo `--since <base-ref>` por padrão: audita só os arquivos modificados no PR. Tempo cai de **minutos pra segundos** mesmo em monorepos grandes. Vira required check sem fricção.

Quando `diff-only: false`, audita o repo inteiro (útil pra nightly cron jobs).

## Modos de comentário

### `summary` (default)

Um único comentário sticky no PR, atualizado em cada push:

> ## 🔍 smoke-gate audit
> **Total:** 12 (🔴 2 critical, 🟡 8 warning, 🔵 2 info)
>
> ### 🔴 Critical findings
> - `api/src/lib/users/queryHelpers.ts:54` — Coluna 'user_id' não existe em enrollments
> - `api/src/routes/admin.ts:825` — Coluna 'admin_notes' não existe em profiles
> ...

### `inline`

Um review com comentário **na linha exata** de cada finding. Aparece no diff do PR:

```
api/src/lib/users/queryHelpers.ts
> 54 |     INNER JOIN users u ON e.user_id = u.id
        ^── 🔴 smoke-gate: Coluna 'user_id' não existe em enrollments. Use 'student_id'.
```

### `none`

Não posta nada — útil pra rodar standalone sem permissão de write em PRs.

## Saídas

```yaml
- uses: reimon/smoke-gate/action@v0.3.1
  id: audit
- run: echo "Critical: ${{ steps.audit.outputs.critical-count }}"
```

| Output | Descrição |
|---|---|
| `critical-count` | Número de findings críticos |
| `warning-count` | Número de findings warning |
| `report-path` | Path do JSON completo |

## Required permissions

```yaml
permissions:
  contents: read
  pull-requests: write   # para postar comentários
```

## Roadmap

- [x] v0.3.1 — composite action + summary/inline + fail-on
- [ ] v0.3.2 — `diff-only: true` (audita só arquivos do PR)
- [ ] v0.4 — sticky-per-finding (1 comentário sticky por finding code, atualiza individual)
