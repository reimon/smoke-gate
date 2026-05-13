/**
 * errorLeak — encontra responses 500 que vazam err.message bruta pro cliente.
 *
 * Padrões:
 *   res.status(500).json({ ..., message: err.message })  ← VAZA
 *   res.status(500).json({ ..., detail: (e as Error).message })  ← VAZA
 *   res.status(500).json({ error: "..." })  ← OK
 *
 * Mensagens de erro brutas podem expor: caminhos do servidor, queries SQL
 * com tabelas/colunas, stack traces, tokens em payloads, IPs internos.
 */

import type { AuditContext, Detector, Finding } from "../types";
import {
  extractSnippet,
  lineOfIndex,
  readFileSafe,
  relPath,
  walkFiles,
} from "../util";

const CODE_PREFIX = "ERR";

// Captura blocos res.status(5xx).json({...}) ou res.json({..., message: err.message})
const STATUS_500_RE =
  /res\s*\.\s*status\s*\(\s*5\d\d\s*\)\s*\.\s*json\s*\(\s*\{([\s\S]*?)\}\s*\)/g;

const ERR_MESSAGE_RE = /\b(err|error|e|exception)\s*(?:as\s+Error)?\s*\)?\.message\b/i;

export const errorLeakDetector: Detector = {
  name: "errorLeak",

  async run(ctx: AuditContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const files = walkFiles(ctx.root, [".ts"], ctx.ignore).filter((f) =>
      /(routes|controllers|handlers)\//i.test(f),
    );

    for (const fp of files) {
      const source = readFileSafe(fp);
      if (!source) continue;

      let m: RegExpExecArray | null;
      while ((m = STATUS_500_RE.exec(source)) !== null) {
        const body = m[1];
        if (!ERR_MESSAGE_RE.test(body)) continue;

        const line = lineOfIndex(source, m.index);
        findings.push({
          code: `${CODE_PREFIX}-001`,
          detector: this.name,
          severity: "warning",
          title: "Response 5xx vaza err.message pro cliente",
          location: { file: relPath(ctx.root, fp), line },
          snippet: extractSnippet(source, line, 3),
          evidence:
            "Mensagens de erro nativas do banco/runtime podem expor: " +
            "tabelas e colunas, paths absolutos, IPs internos, e tokens em payloads. " +
            "Manter só uma mensagem genérica; logar o err.message no servidor.",
          suggestedFix:
            "Substituir por: res.status(500).json({ error: 'Mensagem genérica' }) " +
            "e logar antes: console.error('[contexto]', err.message)",
        });
      }
    }

    return findings;
  },
};
