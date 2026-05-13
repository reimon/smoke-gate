#!/usr/bin/env node
/**
 * CLI — smoke-gate audit
 *
 * Dois modos de uso:
 *
 * 1) CI / standalone (com API key):
 *    smoke-gate audit --llm anthropic --out audit-report.md
 *
 * 2) Agent-mode (sem API key — agente que invoca consome via stdout):
 *    smoke-gate audit --json
 *    → emite JSON com findings determinísticos em stdout
 *    → o agente (Claude Code, Cursor, etc.) faz o enrichment
 *      usando a sessão de LLM dele
 */
export {};
//# sourceMappingURL=cli.d.ts.map