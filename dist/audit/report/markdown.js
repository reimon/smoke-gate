"use strict";
/**
 * Formata findings (enriched ou não) como markdown.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatMarkdown = formatMarkdown;
const SEVERITY_EMOJI = {
    critical: "🔴",
    warning: "🟡",
    info: "🔵",
};
const SEVERITY_ORDER = ["critical", "warning", "info"];
function formatMarkdown(findings, meta) {
    const grouped = new Map();
    for (const sev of SEVERITY_ORDER)
        grouped.set(sev, []);
    for (const f of findings)
        grouped.get(f.severity).push(f);
    const lines = [
        `# smoke-gate audit — ${meta.project}`,
        "",
        `**Data:** ${meta.date}`,
        `**LLM:** ${meta.llm}`,
        `**Total:** ${findings.length} (` +
            SEVERITY_ORDER.map((s) => `${SEVERITY_EMOJI[s]} ${grouped.get(s).length} ${s}`).join(" / ") +
            ")",
        "",
    ];
    if (findings.length === 0) {
        lines.push("✅ Sem issues encontradas.");
        return lines.join("\n");
    }
    lines.push("## Resumo por detector\n");
    const byDetector = new Map();
    for (const f of findings) {
        byDetector.set(f.detector, (byDetector.get(f.detector) ?? 0) + 1);
    }
    for (const [det, cnt] of byDetector) {
        lines.push(`- \`${det}\` — ${cnt}`);
    }
    lines.push("");
    for (const sev of SEVERITY_ORDER) {
        const items = grouped.get(sev);
        if (items.length === 0)
            continue;
        lines.push(`## ${SEVERITY_EMOJI[sev]} ${capitalize(sev)} (${items.length})\n`);
        items.forEach((f, i) => {
            lines.push(`### ${f.code}-${String(i + 1).padStart(2, "0")}: ${f.title}\n`);
            lines.push(`**Arquivo:** \`${f.location.file}:${f.location.line}\`\n`);
            lines.push("**Snippet:**");
            lines.push("```ts");
            lines.push(f.snippet);
            lines.push("```\n");
            lines.push("**Por quê é problema:**");
            lines.push(f.evidence + "\n");
            if (f.llmExplanation) {
                lines.push("**Análise (LLM):**");
                lines.push(f.llmExplanation + "\n");
            }
            const fix = f.llmFix ?? f.suggestedFix;
            if (fix) {
                lines.push("**Fix sugerido:**");
                lines.push("```");
                lines.push(fix);
                lines.push("```\n");
            }
            if (f.llmCommand) {
                lines.push("**Aplicar:**");
                lines.push("```bash");
                lines.push(f.llmCommand);
                lines.push("```\n");
            }
            lines.push("---\n");
        });
    }
    return lines.join("\n");
}
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
//# sourceMappingURL=markdown.js.map