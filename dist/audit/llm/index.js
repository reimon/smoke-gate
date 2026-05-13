"use strict";
/**
 * LLM adapters — interface comum: enrich(finding, fileContext) → enriched.
 *
 * Modos:
 *   - "none"      : zero-LLM, usa só suggestedFix dos detectores
 *   - "anthropic" : Claude via API (ANTHROPIC_API_KEY)
 *   - "openai"    : GPT via API (OPENAI_API_KEY)
 *   - "ollama"    : local via http://localhost:11434
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLlmAdapter = getLlmAdapter;
/** Adapter no-op pra modo zero-LLM. */
const noneAdapter = {
    name: "none",
    async enrich() {
        return {};
    },
};
const SYSTEM_PROMPT = `Você é um auditor de código senior. Recebe um finding de um detector estático e contexto do arquivo. Sua tarefa:

1. Confirme se é um problema real (não falso positivo).
2. Escreva uma explicação em 2-3 frases em PT-BR (campo "explanation").
3. Proponha um fix concreto — diff unificado curto ou código pronto (campo "fix").
4. Gere um comando bash/git pronto pra colar (campo "command"). Use \`sed\` ou \`git apply <<EOF...\` ou \`patch\`.

Responda APENAS em JSON: { "explanation": "...", "fix": "...", "command": "..." }
Se for falso positivo: { "falsePositive": true, "explanation": "por quê" }`;
/** Builds a uniform user prompt for any LLM. */
function buildPrompt(finding, fileContext) {
    return `# Finding
- Código: ${finding.code}
- Detector: ${finding.detector}
- Severidade: ${finding.severity}
- Título: ${finding.title}
- Arquivo: ${finding.location.file}:${finding.location.line}

## Snippet
\`\`\`
${finding.snippet}
\`\`\`

## Evidência do detector
${finding.evidence}

## Fix sugerido pelo detector
${finding.suggestedFix ?? "(nenhum)"}

## Contexto do arquivo (até 80 linhas em torno)
\`\`\`
${fileContext}
\`\`\`
`;
}
function parseLlmJson(text) {
    // Tolera prefácios e ```json...``` wrappers.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m)
        return {};
    try {
        return JSON.parse(m[0]);
    }
    catch {
        return {};
    }
}
// ── Anthropic ────────────────────────────────────────────────────────────
function anthropicAdapter(apiKey) {
    return {
        name: "anthropic",
        async enrich(finding, fileContext) {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    model: "claude-haiku-4-5-20251001",
                    max_tokens: 1500,
                    system: SYSTEM_PROMPT,
                    messages: [{ role: "user", content: buildPrompt(finding, fileContext) }],
                }),
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`anthropic ${res.status}: ${txt.slice(0, 200)}`);
            }
            const data = (await res.json());
            const text = data.content?.[0]?.text ?? "";
            const parsed = parseLlmJson(text);
            if (parsed.falsePositive) {
                return {
                    llmExplanation: `[falso positivo] ${parsed.explanation ?? ""}`,
                };
            }
            return {
                llmExplanation: parsed.explanation,
                llmFix: parsed.fix,
                llmCommand: parsed.command,
            };
        },
    };
}
// ── OpenAI ───────────────────────────────────────────────────────────────
function openaiAdapter(apiKey) {
    return {
        name: "openai",
        async enrich(finding, fileContext) {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${apiKey}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    response_format: { type: "json_object" },
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: buildPrompt(finding, fileContext) },
                    ],
                }),
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`openai ${res.status}: ${txt.slice(0, 200)}`);
            }
            const data = (await res.json());
            const text = data.choices?.[0]?.message?.content ?? "";
            const parsed = parseLlmJson(text);
            if (parsed.falsePositive) {
                return {
                    llmExplanation: `[falso positivo] ${parsed.explanation ?? ""}`,
                };
            }
            return {
                llmExplanation: parsed.explanation,
                llmFix: parsed.fix,
                llmCommand: parsed.command,
            };
        },
    };
}
// ── Ollama (local) ────────────────────────────────────────────────────────
function ollamaAdapter(baseUrl, model) {
    return {
        name: "ollama",
        async enrich(finding, fileContext) {
            const res = await fetch(`${baseUrl}/api/chat`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    model,
                    stream: false,
                    format: "json",
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: buildPrompt(finding, fileContext) },
                    ],
                }),
            });
            if (!res.ok) {
                throw new Error(`ollama ${res.status} — está rodando em ${baseUrl}?`);
            }
            const data = (await res.json());
            const text = data.message?.content ?? "";
            const parsed = parseLlmJson(text);
            if (parsed.falsePositive) {
                return {
                    llmExplanation: `[falso positivo] ${parsed.explanation ?? ""}`,
                };
            }
            return {
                llmExplanation: parsed.explanation,
                llmFix: parsed.fix,
                llmCommand: parsed.command,
            };
        },
    };
}
/**
 * Factory — escolhe adapter baseado em mode + env vars.
 *
 * Anthropic:  ANTHROPIC_API_KEY
 * OpenAI:     OPENAI_API_KEY
 * Ollama:     OLLAMA_URL (default http://localhost:11434), OLLAMA_MODEL (default llama3.2)
 */
function getLlmAdapter(mode) {
    if (mode === "none")
        return noneAdapter;
    if (mode === "anthropic") {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) {
            throw new Error("smoke-gate: ANTHROPIC_API_KEY não setada (use --llm none pra rodar sem LLM)");
        }
        return anthropicAdapter(key);
    }
    if (mode === "openai") {
        const key = process.env.OPENAI_API_KEY;
        if (!key) {
            throw new Error("smoke-gate: OPENAI_API_KEY não setada (use --llm none pra rodar sem LLM)");
        }
        return openaiAdapter(key);
    }
    if (mode === "ollama") {
        return ollamaAdapter(process.env.OLLAMA_URL ?? "http://localhost:11434", process.env.OLLAMA_MODEL ?? "llama3.2");
    }
    throw new Error(`smoke-gate: modo LLM desconhecido: ${mode}`);
}
//# sourceMappingURL=index.js.map