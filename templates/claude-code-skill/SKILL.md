---
name: smoke-gate-audit
description: Audita o codebase em busca de padrões frágeis (drift SQL, IDOR, vazamento de erro, gaps de smoke test). Roda detectores deterministicos via smoke-gate CLI e enriquece findings com explicação + fix usando a sessão de LLM ativa, sem precisar de API key separada. Use quando o usuário pedir "audit", "audita o código", "encontra bugs latentes", "scan de segurança", ou "revisa o projeto".
---

# smoke-gate audit (Claude Code skill)

Esta skill orquestra o `smoke-gate audit` em **agent-mode**: o CLI faz a parte determinística (detectores estáticos), e **você** (Claude) faz o enrichment usando esta sessão — sem cobrar API key separada do usuário.

## Quando usar

- Usuário pede "audita", "scan", "revisa o código", "encontra bugs"
- Antes de PR grande / antes de release
- Após um incidente similar (drift de coluna SQL, IDOR, etc.)
- Periodicamente (semanal/mensal) como higiene

## Como rodar

### Passo 1 — Detectores deterministicos

```bash
npx smoke-gate audit --json
```

Saída: JSON com `findings[]`. Cada finding tem:
- `code`, `detector`, `severity` (`critical`|`warning`|`info`)
- `file`, `line`, `snippet` (3-5 linhas de contexto)
- `evidence` (por que o detector flagou)
- `suggestedFix` (heurístico — você vai melhorar)

Se `smoke-gate` não está instalado:
```bash
npm install --save-dev "github:reimon/smoke-gate#v0.2.1"
```

### Passo 2 — Enriquecimento (você, com tools Read/Bash)

Para cada finding com severity `critical` ou `warning`:

1. **Read o arquivo** em `file:line` ± 40 linhas pra contexto.
2. **Confirme se é problema real** — alguns detectores geram falso-positivo (ex: coluna adicionada via inline ALTER em runtime, alias ambíguo). Marque `falsePositive: true` se for.
3. **Escreva uma explicação de 2-3 frases** em PT-BR.
4. **Proponha fix concreto** — diff unificado curto ou bloco de código.
5. **Gere um comando bash pronto pra colar** — `sed`/`git apply <<'EOF'...`/`patch`.

### Passo 3 — Escreve o report

Salve em `audit-report.md` no root do projeto. Estrutura:

```markdown
# smoke-gate audit — <project-name>
**Data:** <YYYY-MM-DD> · **LLM:** Claude (via sessão Claude Code)
**Total:** N (🔴 X critical / 🟡 Y warning / 🔵 Z info)

## Resumo por detector
- `sqlDrift` — N
- ...

## 🔴 Critical (N)

### SQL-001-01: <título>

**Arquivo:** `<file>:<line>`

**Snippet:**
\`\`\`ts
<3-5 linhas>
\`\`\`

**Por quê é problema:**
<evidence do detector>

**Análise:**
<sua explicação contextual>

**Fix sugerido:**
\`\`\`ts
<código>
\`\`\`

**Aplicar:**
\`\`\`bash
<comando pronto>
\`\`\`

---
```

### Passo 4 — Resumo final pro usuário

Texto curto (< 5 linhas):
- Total de findings + breakdown por severidade
- 2-3 principais issues por nome
- Caminho do arquivo `audit-report.md`
- Convite: "quer que eu aplique os fixes críticos um por um?"

## Decisões importantes

- **Não rode `--llm anthropic`** mesmo se a env tiver chave. O ponto desta skill é usar a sessão ativa.
- **Skip `info`** no enrichment a menos que o usuário peça explicitamente. Smoke coverage gera muito ruído.
- **Limite a 30 findings enriquecidos** por padrão. Se houver mais, agrupe os "info" no fim do report sem enrichment.
- **Não aplique fixes automaticamente.** Apenas gere comandos prontos. Aplicação fica para o usuário aprovar.
- **Falsos positivos esperados**: o `sqlDrift` não enxerga `ALTER TABLE` inline (`pool.query("ALTER TABLE ... ADD COLUMN ...")`). Mencione no relatório se relevante.

## Exemplo de invocação

Usuário: "audita o projeto"

1. `Bash: npx smoke-gate audit --json --root .` → captura stdout
2. Parse JSON, agrupa por severidade
3. Para cada critical: `Read <file> offset=line-40 limit=80`
4. Escreva análise + fix
5. `Write audit-report.md`
6. Resumo: "Achei 11 críticos. Top: enrollments.user_id em queryHelpers.ts:54 (provavelmente deveria ser student_id). Veja audit-report.md."
