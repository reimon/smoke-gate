# smoke-gate — Roadmap Comercial

Documento de planejamento para v0.6 → v1.0 + posicionamento comercial.
**Não é changelog** — features ainda não implementadas, com spec executável.

---

## Posicionamento

**Wedge atual** (v0.5):
- Detector deterministicos + agent-mode (LLM grátis via sessão)
- MCP nativo (Claude Code, Cursor, Cline, Continue, Zed)
- Smoke runtime **+** static audit na mesma lib
- OSS leve, sem lock-in

**Concorrentes diretos:**
| | Wedge deles | Fraqueza | Onde ganhamos |
|---|---|---|---|
| Sonar/Codacy | Coverage breadth, dashboard | Caro, lento, sem LLM, lock-in | Agent-native, OSS, rápido |
| Semgrep | SAST profundo | Sem runtime, foco segurança | Audit + runtime juntos |
| CodeRabbit/Greptile | PR review com LLM | Só LLM, sem detectores deterministicos | Híbrido, custo controlado |
| Devin/Cognition | Agente autônomo | Caro ($500/mês), opaco | Usa sua sessão (Claude Code) |
| Renovate/Dependabot | Dep updates | Não toca em código de domínio | Audit semântico do código |

**Modelo comercial proposto:**
- **OSS core** (Apache 2.0): tudo que tem hoje + detectores + MCP + Action
- **Cloud / Pro paid**: dashboard SaaS, retention de findings, custom detectors marketplace, GitHub App gerenciado (sem CI minutes do customer), telemetria cross-projeto, SSO/SAML, SLA.
- **Enterprise**: on-prem deploy, compliance reports (SOC2/ISO/PCI), dedicated support, custom rule consulting.

OSS dirige adoção; cloud monetiza times >5 devs.

---

## v0.6 — Polyglot (Python + Go + Ruby)

### Problema
Hoje smoke-gate só detecta drift SQL em código TS/JS. 80% das empresas têm pelo menos 2 stacks. Sonar funciona em todas mas é pesado/caro.

### Solução

**Approach: regex-based adapters (não Treesitter)** — sai 10x mais rápido pra primeira versão, cobre 80% dos casos. Treesitter vira v1.0 quando justificar o overhead.

Arquitetura:
```
src/audit/sql/
├── parser.ts              ← já existe (CTEs, aliases, refs) — language-agnostic
├── checker.ts             ← já existe
└── extractors/
    ├── typescript.ts      ← template literals (já existe inline)
    ├── python.ts          ← (novo)
    ├── go.ts              ← (novo)
    └── ruby.ts            ← (novo)
```

Detector escolhe extractor por extensão (`.py`, `.go`, `.rb`).

### Specs por linguagem

**Python**
- Triple-quoted: `"""SELECT ..."""` ou `'''SELECT ...'''`
- `cursor.execute("SELECT ...")` / `cursor.execute("""SELECT ...""")`
- SQLAlchemy `text("SELECT ...")` / `db.execute(text(...))`
- Django raw: `User.objects.raw("SELECT ...")`
- f-strings: detectar mas avisar que pode ter interpolação não-segura
- Walks: `.py` files
- Skip: `__pycache__`, `.venv`, `venv`, `.tox`

**Go**
- Raw string literals: `` `SELECT ...` ``
- `db.Query("SELECT ...")` / `db.QueryRow(...)`
- `db.Exec(...)`
- `sqlx.Select(&dst, "SELECT ...")`
- sqlc generated: skip (já validado pelo build do sqlc)
- Walks: `.go`
- Skip: `vendor/`, `*_test.go` se quiser

**Ruby**
- Heredocs: `<<~SQL ... SQL`
- `ActiveRecord::Base.connection.execute("SELECT ...")`
- `Model.find_by_sql("SELECT ...")`
- Walks: `.rb`
- Skip: `vendor/`, `tmp/`, `coverage/`

### Trabalho estimado
- **Refactor existente** (extract typescript.ts): 2h
- **Python extractor + tests**: 4h
- **Go extractor + tests**: 3h
- **Ruby extractor + tests**: 3h
- **Doc + exemplos**: 1h
- **Total: ~1.5 dia**

### Schema parsing
Já é multi-database: lê `.sql` files independente de stack. Funciona out-of-the-box pra Python/Django (migrations em `migrations/`), Go (sqlc + `schema.sql`), Ruby (Rails `db/schema.rb` precisa adapter — Ruby DSL, não SQL).

**Ruby exception**: precisa parser de `schema.rb` (DSL Ruby tipo `create_table :users do |t| t.string :email`). Mais 2h.

### Validação
Rodar contra projetos open conhecidos:
- Django: getsentry/sentry
- Go: dolthub/dolt
- Rails: discourse/discourse

Objetivo: <10% falso-positivo, schema completo carregado.

---

## v0.7 — Sentry/Datadog bridge

### Problema
Quando 500 acontece em prod, o time abre o Sentry, debugga, faz commit. **Já existe** um audit report que poderia ter pego esse bug antes — mas ninguém liga as duas pontas. Audit fica esquecido.

### Solução

Subcomando: `smoke-gate match-incidents`

Workflow:
1. Pega últimos N findings críticos do audit (cache local em `.smoke-gate/findings-history.jsonl`)
2. Pega últimas issues do Sentry via API
3. Faz matching textual: mensagem de erro do Sentry contém nomes de coluna / arquivo / linha do finding?
4. Output: lista de matches:

```
🎯 Sentry incident #12345 (column "lat.created_at" does not exist)
   ↳ matches finding SQL-001-03 from audit 2026-04-10
   ↳ file: api/src/routes/careerIntelligence.ts:219
   ↳ status: was warning, ignored. NOW HAPPENING IN PROD.
```

### Specs

**Persistência:** quando `smoke-gate audit` roda, append findings ao `.smoke-gate/findings-history.jsonl` (1 linha por finding por audit run). Inclui timestamp + git SHA. Cache local — não vai pro cloud.

**Sentry API:**
```bash
smoke-gate match-incidents \
  --sentry-org kaiketsu \
  --sentry-project api \
  --sentry-token $SENTRY_TOKEN \
  --since 7d
```

Endpoint: `GET https://sentry.io/api/0/projects/{org}/{project}/issues/?statsPeriod=7d`

**Matching algorithm:**
1. Para cada finding histórico, extrair "fingerprint": `(file, table, column)`.
2. Para cada Sentry issue, tokenizar `culprit + message + metadata`.
3. Match if: nome de coluna do finding aparece na mensagem OR file:line aparece em `stacktrace.frames[].abs_path`.

**Datadog APM:** mesma arquitetura, endpoint diferente (`/api/v1/events`). Skipar na v0.7, fazer v0.7.1.

**Bonus (cloud feature, paid):** auto-link via webhook — Sentry call back smoke-gate cloud quando issue cria, smoke-gate posta comentário no Sentry com o finding correspondente.

### Trabalho estimado
- Persistência local (.smoke-gate/findings-history.jsonl): 2h
- Sentry API client + matcher: 4h
- CLI command: 1h
- Doc + exemplo: 1h
- **Total: ~1 dia**

### Comercial
- OSS: matching local manual via CLI
- Cloud (paid): webhook bidirecional, cross-projeto, retention >30 dias, alertas Slack

---

## v0.8 — `--apply` mode

### Problema
Hoje `audit_apply_fix` retorna patch dry-run. Agente mostra ao usuário, usuário copia comando bash, cola, executa. 3 passos pra cada fix. Bom UX pra ler, ruim pra aplicar em lote.

### Solução

Comando: `smoke-gate apply [<finding-codes>]`

Workflow:
1. Lê último audit report (de `.smoke-gate/last-audit.json`)
2. Para cada finding selecionado:
   - Gera patch
   - Aplica via `git apply`
   - Cria commit individual: `fix(smoke-gate): SQL-001-03 — coluna lat.created_at`
3. Imprime resumo: X patches aplicados, Y commits criados

### Safety guards (obrigatórias)

```
[ ] Working tree limpo (sem mudanças não-commitadas)
[ ] Branch atual NÃO é main/master (cria branch automático smoke-gate/fixes-YYYYMMDD)
[ ] Cada finding vira 1 commit (atomic, fácil de reverter)
[ ] --dry-run mode: gera patches em /tmp sem aplicar
[ ] --interactive: confirma cada fix individualmente (y/n/skip)
[ ] Roda lint + typecheck após cada fix; rollback se falhar
```

### Modos

```bash
smoke-gate apply                       # aplica TODOS os critical
smoke-gate apply SQL-001-03 SQL-001-04  # finding codes específicos
smoke-gate apply --severity warning     # tudo warning+
smoke-gate apply --interactive          # pergunta antes de cada
smoke-gate apply --dry-run              # imprime patches, não aplica
smoke-gate apply --branch fix/sql-drift # branch custom
```

### Trabalho estimado
- Persistência do último audit (.smoke-gate/last-audit.json): já existe parcialmente
- Patch generation refactored: 2h
- Apply logic + git safety: 4h
- Interactive mode: 2h
- Validation hooks (lint/test entre fixes): 2h
- Doc + exemplo: 1h
- **Total: ~1.5 dia**

### Edge cases
- Patch falha (texto não bate mais): skipa, registra no resumo
- Lint/test falha pós-fix: `git revert HEAD` e segue
- Conflito entre fixes na mesma região: aplica um por vez, re-checa contexto antes do próximo

### Comercial
- OSS: aplicação local, manual
- Cloud (paid): "auto-fix PR bot" — quando audit dispara em PR, robô abre PR com fixes pronto pra review (Renovate-style)

---

## v1.0 — release pública

Após v0.8, considerar release v1.0 com:
- Treesitter migration (v0.6 era regex; v1.0 é AST)
- LSP server (squiggly underline em VS Code/Cursor antes de salvar)
- Dashboard SaaS MVP (free tier: 1 repo, 30 dias retention)
- Marketing site (smoke-gate.dev)
- Lançamento HN/Twitter/Dev.to

---

## Resumo de esforço

| Versão | Trabalho | Owner | Prio |
|---|---|---|---|
| v0.6 polyglot | 1.5 dia | TBD | Alta — abre Python/Go market |
| v0.7 Sentry bridge | 1 dia | TBD | Média — feature "wow", mas só importa com base instalada |
| v0.8 --apply | 1.5 dia | TBD | Alta — UX delta enorme |
| **Total v0.6-0.8** | **~4 dias** | | |
| v1.0 (Treesitter + LSP + cloud MVP) | 3-4 semanas | TBD | Após validar v0.6-0.8 em produção |

## Decisão necessária antes de executar

1. Qual feature gera mais "wow demo" pra vender? → **v0.8 --apply** (devs vêem o robô consertando)
2. Qual abre mais mercado? → **v0.6 polyglot** (5x TAM)
3. Qual é mais defensável vs concorrência? → **v0.7 bridge** (custo de switching alto)

Ordem sugerida: **v0.8 → v0.6 → v0.7**.
Justificativa: --apply transforma o produto de "audit que reporta" pra "audit que conserta". Polyglot vem depois de validar o loop produto-mercado. Sentry bridge é nice-to-have até ter base instalada.

## Marca / nome comercial

`smoke-gate` é técnico. Pra comercial considerar:
- **Kaiketsu Audit** (já é a marca-mãe)
- **Driftless** (foco no drift)
- **Smoke** (curto, .dev disponível?)

Decisão diferida — não bloqueia v0.6-0.8.
