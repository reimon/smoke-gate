/**
 * Exemplo: detectores customizados pro seu projeto.
 *
 * Cole esse arquivo na raiz do seu repo como `smoke-gate.config.ts`.
 * Funciona com `npx smoke-gate audit` e com o MCP server.
 *
 * Pré-req pra rodar TS sem build: `npm i -D tsx`.
 * Se preferir, compile pra .js antes (output em smoke-gate.config.js).
 */

import {
  defineConfig,
  type AuditContext,
  type Detector,
  type Finding,
} from "@kaiketsu/smoke-gate";
import * as fs from "fs";
import * as path from "path";

// ── Detector 1: rotas admin devem chamar auditLog() ──────────────────────
// Regra interna da empresa: toda mutação em /admin/ tem que registrar
// na tabela admin_audit_logs. Sem auditLog() na função = compliance gap.
const adminAuditLogRequired: Detector = {
  name: "adminAuditLogRequired",

  async run(ctx: AuditContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const routesDir = path.join(ctx.root, "api/src/routes");
    if (!fs.existsSync(routesDir)) return findings;

    const adminFiles = fs
      .readdirSync(routesDir)
      .filter((f) => /^admin/i.test(f) && f.endsWith(".ts"))
      .map((f) => path.join(routesDir, f));

    const routeRe =
      /router\.(post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]([\s\S]*?)\n\s*\}\s*\)/g;

    for (const fp of adminFiles) {
      const src = fs.readFileSync(fp, "utf8");
      let m: RegExpExecArray | null;
      while ((m = routeRe.exec(src)) !== null) {
        const body = m[3];
        if (/\bauditLog\s*\(/.test(body)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        findings.push({
          code: "ORG-001",
          detector: this.name,
          severity: "warning",
          title: `Rota admin ${m[1].toUpperCase()} ${m[2]} sem auditLog()`,
          location: { file: path.relative(ctx.root, fp), line },
          snippet: src.split("\n").slice(line - 2, line + 3).join("\n"),
          evidence:
            "Rotas admin que mutam dados devem registrar em admin_audit_logs. " +
            "Sem isso, não há rastreabilidade pra compliance.",
          suggestedFix:
            "Adicionar `await auditLog({ action, actor: req.user.id, targetId })` " +
            "no início do handler (antes do trabalho real).",
        });
      }
    }
    return findings;
  },
};

// ── Detector 2: imports cross-feature proibidos ──────────────────────────
// Arquitetura: feature A não pode importar de feature B (só via lib/shared).
const crossFeatureImports: Detector = {
  name: "crossFeatureImports",

  async run(ctx: AuditContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const featuresRoot = path.join(ctx.root, "src/features");
    if (!fs.existsSync(featuresRoot)) return findings;

    const features = fs
      .readdirSync(featuresRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...walk(fp));
        else if (/\.(ts|tsx)$/.test(ent.name)) out.push(fp);
      }
      return out;
    }

    for (const feature of features) {
      const featureDir = path.join(featuresRoot, feature);
      for (const fp of walk(featureDir)) {
        const src = fs.readFileSync(fp, "utf8");
        const importRe = /from\s+["']([^"']+)["']/g;
        let m: RegExpExecArray | null;
        while ((m = importRe.exec(src)) !== null) {
          const imp = m[1];
          const otherFeature = features.find(
            (other) =>
              other !== feature &&
              imp.includes(`features/${other}/`) &&
              !imp.endsWith("/public"), // exporta via barrel public é OK
          );
          if (!otherFeature) continue;
          const line = src.slice(0, m.index).split("\n").length;
          findings.push({
            code: "ARCH-001",
            detector: this.name,
            severity: "critical",
            title: `Import cross-feature: ${feature} → ${otherFeature}`,
            location: { file: path.relative(ctx.root, fp), line },
            snippet: src.split("\n")[line - 1] ?? "",
            evidence:
              `${feature} importa diretamente de ${otherFeature}. Features ` +
              `só podem se comunicar via barrel /public ou /shared. ` +
              `Acoplamento direto bloqueia extração futura pra serviço.`,
            suggestedFix: `Importar de '@/features/${otherFeature}/public' ou mover o código compartilhado para 'src/shared/'.`,
          });
        }
      }
    }
    return findings;
  },
};

// ── Config exportada ──────────────────────────────────────────────────────
export default defineConfig({
  detectors: [adminAuditLogRequired, crossFeatureImports],

  // Desabilita warnings que não importam pra este projeto:
  disable: ["smokeCoverage"],

  // Override de severidade: auth gaps viram só warning (mount-level auth
  // já cobre em quase todos os casos, mas vale registrar).
  severityOverrides: {
    "AUTH-001": "warning",
  },

  // Paths a ignorar:
  ignore: ["legacy/**", "vendor/**"],
});
