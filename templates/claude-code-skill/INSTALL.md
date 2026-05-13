# Instalar a skill no Claude Code

Esta skill faz com que `/smoke-gate-audit` rode o auditor sem precisar de chave de API separada — usa a sessão de LLM que você já tá usando.

## Instalação (1 comando)

A partir do root do seu projeto:

```bash
mkdir -p .claude/skills/smoke-gate-audit && \
  curl -fsSL https://raw.githubusercontent.com/reimon/smoke-gate/main/templates/claude-code-skill/SKILL.md \
  -o .claude/skills/smoke-gate-audit/SKILL.md
```

## Uso

No Claude Code:

```
/smoke-gate-audit
```

ou em linguagem natural:

```
audita esse projeto
```

```
encontra padrões frágeis no código
```

## Como funciona

1. A skill chama `npx smoke-gate audit --json` — detectores deterministicos retornam JSON.
2. Claude Code lê cada finding, abre o arquivo afetado, gera explicação + fix.
3. Salva `audit-report.md` no root + mostra resumo.

Sem `ANTHROPIC_API_KEY`. Sem custo extra (apenas o uso normal da sessão).

## Pré-requisito

`smoke-gate` instalado no projeto:

```bash
npm install --save-dev "github:reimon/smoke-gate#v0.2.1"
```

ou globalmente:

```bash
npm install -g "github:reimon/smoke-gate#v0.2.1"
```
