// smoke-gate-ignore-file — fixtures contêm padrões de detecção como strings
/**
 * Testes dos detectores. Cada detector tem pelo menos 1 caso que dispara
 * (positivo) + 1 que NÃO dispara (negativo).
 *
 * Estratégia: fixtures em tmpdir. Cada teste monta uma mini-árvore (routes/,
 * migrations/, smoke tests) e roda o detector contra ela.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { authGapsDetector } from "./detectors/authGaps";
import { dbMockInTestDetector } from "./detectors/dbMockInTest";
import { errorLeakDetector } from "./detectors/errorLeak";
import { raceConditionDetector } from "./detectors/raceCondition";
import { smokeCoverageDetector } from "./detectors/smokeCoverage";
import { sqlDriftDetector } from "./detectors/sqlDrift";
import { unsafeJsonParseDetector } from "./detectors/unsafeJsonParse";
import type { AuditContext } from "./types";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-gate-test-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): void {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function ctx(extra: Partial<AuditContext> = {}): AuditContext {
  return { root: tmpRoot, ...extra };
}

describe("unsafeJsonParse", () => {
  it("flagra JSON.parse sem try/catch", async () => {
    writeFile(
      "src/handler.ts",
      `export function parse(s: string) {\n  return JSON.parse(s);\n}\n`,
    );
    const findings = await unsafeJsonParseDetector.run(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("JSON-001");
    expect(findings[0].location.file).toBe("src/handler.ts");
  });

  it("não flagra dentro de try/catch", async () => {
    writeFile(
      "src/handler.ts",
      `export function parse(s: string) {\n  try {\n    return JSON.parse(s);\n  } catch {\n    return null;\n  }\n}\n`,
    );
    const findings = await unsafeJsonParseDetector.run(ctx());
    expect(findings).toHaveLength(0);
  });

  it("não flagra em arquivo com sentinela de ignore", async () => {
    writeFile(
      "src/handler.ts",
      `// smoke-gate-ignore-file\nexport function parse(s: string) {\n  return JSON.parse(s);\n}\n`,
    );
    const findings = await unsafeJsonParseDetector.run(ctx());
    expect(findings).toHaveLength(0);
  });

  it("não flagra em arquivos *.test.ts", async () => {
    writeFile(
      "src/handler.test.ts",
      `it("x", () => { JSON.parse("{}") })\n`,
    );
    const findings = await unsafeJsonParseDetector.run(ctx());
    expect(findings).toHaveLength(0);
  });
});

describe("dbMockInTest", () => {
  it("flagra vi.mock de db/pool em *.test.ts", async () => {
    writeFile(
      "src/foo.test.ts",
      `import { vi } from "vitest";\nvi.mock("../db/pool", () => ({}));\n`,
    );
    const findings = await dbMockInTestDetector.run(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("MOCK-001");
  });

  it("não flagra em *.smoke.test.ts", async () => {
    writeFile(
      "src/foo.smoke.test.ts",
      `import { vi } from "vitest";\nvi.mock("../db/pool", () => ({}));\n`,
    );
    const findings = await dbMockInTestDetector.run(ctx());
    expect(findings).toHaveLength(0);
  });

  it("não flagra mocks de módulos não-DB", async () => {
    writeFile(
      "src/foo.test.ts",
      `import { vi } from "vitest";\nvi.mock("../mailer", () => ({}));\n`,
    );
    const findings = await dbMockInTestDetector.run(ctx());
    expect(findings).toHaveLength(0);
  });
});

describe("errorLeak", () => {
  it("flagra res.status(500).json com err.message", async () => {
    writeFile(
      "src/routes/foo.ts",
      `router.get("/", (req, res) => {\n  try { doStuff(); } catch (err) {\n    res.status(500).json({ message: (err as Error).message });\n  }\n});\n`,
    );
    const findings = await errorLeakDetector.run(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("ERR-001");
  });

  it("não flagra response 5xx com mensagem genérica", async () => {
    writeFile(
      "src/routes/foo.ts",
      `router.get("/", (req, res) => {\n  res.status(500).json({ error: "internal" });\n});\n`,
    );
    const findings = await errorLeakDetector.run(ctx());
    expect(findings).toHaveLength(0);
  });

  it("ignora arquivos fora de routes/controllers/handlers", async () => {
    writeFile(
      "src/utils/foo.ts",
      `res.status(500).json({ message: err.message })\n`,
    );
    const findings = await errorLeakDetector.run(ctx());
    expect(findings).toHaveLength(0);
  });
});

describe("authGaps", () => {
  it("flagra rota com :userId sem ownership middleware", async () => {
    writeFile(
      "src/routes/user.ts",
      `router.get("/:userId/overview", async (req, res) => { res.json({}); });\n`,
    );
    const findings = await authGapsDetector.run(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("AUTH-001");
    expect(findings[0].severity).toBe("critical");
  });

  it("não flagra quando middleware de ownership está presente", async () => {
    writeFile(
      "src/routes/user.ts",
      `router.get("/:userId/overview", checkUserOwnership, async (req, res) => { res.json({}); });\n`,
    );
    const findings = await authGapsDetector.run(ctx());
    expect(findings).toHaveLength(0);
  });

  it("não flagra quando router.use aplica auth no topo", async () => {
    writeFile(
      "src/routes/user.ts",
      `router.use(requireAuth);\nrouter.get("/:userId/overview", async (req, res) => { res.json({}); });\n`,
    );
    const findings = await authGapsDetector.run(ctx());
    expect(findings).toHaveLength(0);
  });

  it("reduz severidade pra warning em admin*.ts", async () => {
    writeFile(
      "src/routes/admin.ts",
      `router.get("/:userId/dump", async (req, res) => { res.json({}); });\n`,
    );
    const findings = await authGapsDetector.run(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
  });
});

describe("raceCondition", () => {
  it("flagra SELECT seguido de INSERT sem transação", async () => {
    writeFile(
      "src/services/foo.ts",
      "async function create(name: string) {\n" +
        "  const existing = await pool.query(`SELECT id FROM users WHERE name = $1`, [name]);\n" +
        "  if (existing.rows.length === 0) {\n" +
        "    await pool.query(`INSERT INTO users (name) VALUES ($1)`, [name]);\n" +
        "  }\n" +
        "}\n",
    );
    const findings = await raceConditionDetector.run(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RACE-001");
  });

  it("não flagra quando há ON CONFLICT", async () => {
    writeFile(
      "src/services/foo.ts",
      "async function create(name: string) {\n" +
        "  await pool.query(`SELECT id FROM users WHERE name = $1`, [name]);\n" +
        "  await pool.query(`INSERT INTO users (name) VALUES ($1) ON CONFLICT DO NOTHING`, [name]);\n" +
        "}\n",
    );
    const findings = await raceConditionDetector.run(ctx());
    expect(findings).toHaveLength(0);
  });

  it("não flagra quando há BEGIN entre o SELECT e o INSERT", async () => {
    writeFile(
      "src/services/foo.ts",
      "async function create(name: string) {\n" +
        "  await pool.query(`SELECT id FROM users WHERE name = $1`);\n" +
        "  await pool.query(`BEGIN`);\n" +
        "  await pool.query(`INSERT INTO users (name) VALUES ($1)`, [name]);\n" +
        "}\n",
    );
    const findings = await raceConditionDetector.run(ctx());
    expect(findings).toHaveLength(0);
  });
});

describe("sqlDrift", () => {
  it("flagra coluna inexistente referenciada via alias", async () => {
    writeFile(
      "migrations/001_init.sql",
      `CREATE TABLE users (id uuid PRIMARY KEY, imported_at timestamp);\n`,
    );
    writeFile(
      "src/repo.ts",
      "export async function fetch() {\n" +
        "  return pool.query(`SELECT u.created_at FROM users u WHERE u.id = $1`);\n" +
        "}\n",
    );
    const findings = await sqlDriftDetector.run(ctx());
    const drift = findings.filter((f) => f.code === "SQL-001");
    expect(drift).toHaveLength(1);
    expect(drift[0].title).toContain("created_at");
    expect(drift[0].title).toContain("users");
  });

  it("não flagra colunas que existem no schema", async () => {
    writeFile(
      "migrations/001_init.sql",
      `CREATE TABLE users (id uuid PRIMARY KEY, imported_at timestamp);\n`,
    );
    writeFile(
      "src/repo.ts",
      "export async function fetch() {\n" +
        "  return pool.query(`SELECT u.imported_at FROM users u WHERE u.id = $1`);\n" +
        "}\n",
    );
    const findings = await sqlDriftDetector.run(ctx());
    expect(findings.filter((f) => f.code === "SQL-001")).toHaveLength(0);
  });

  it("considera colunas adicionadas via ALTER TABLE", async () => {
    writeFile(
      "migrations/001_init.sql",
      `CREATE TABLE users (id uuid PRIMARY KEY);\n`,
    );
    writeFile(
      "migrations/002_add_email.sql",
      `ALTER TABLE users ADD COLUMN email text;\n`,
    );
    writeFile(
      "src/repo.ts",
      "export async function fetch() {\n" +
        "  return pool.query(`SELECT u.email FROM users u`);\n" +
        "}\n",
    );
    const findings = await sqlDriftDetector.run(ctx());
    expect(findings.filter((f) => f.code === "SQL-001")).toHaveLength(0);
  });

  it("emite info quando não há migrations", async () => {
    writeFile("src/repo.ts", "// nada\n");
    const findings = await sqlDriftDetector.run(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("SQL-000");
    expect(findings[0].severity).toBe("info");
  });
});

describe("smokeCoverage", () => {
  it("flagra rota sem cobertura em smoke test", async () => {
    writeFile(
      "src/routes/foo.ts",
      `router.get("/bar/baz", handler);\n`,
    );
    writeFile(
      "src/test/other.smoke.test.ts",
      `// cobre /qux apenas\nconst path = "/qux";\n`,
    );
    const findings = await smokeCoverageDetector.run(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("COV-001");
  });

  it("não flagra rotas cobertas (todos segmentos presentes no smoke)", async () => {
    writeFile(
      "src/routes/foo.ts",
      `router.get("/bar/baz", handler);\n`,
    );
    writeFile(
      "src/test/foo.smoke.test.ts",
      `const path = "/bar/baz";\n`,
    );
    const findings = await smokeCoverageDetector.run(ctx());
    expect(findings).toHaveLength(0);
  });

  it("emite warning quando há rotas mas nenhum smoke test", async () => {
    writeFile(
      "src/routes/foo.ts",
      `router.get("/bar", handler);\n`,
    );
    const findings = await smokeCoverageDetector.run(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("COV-000");
  });

  it("skipa em modo diff-only (fileFilter setado)", async () => {
    writeFile(
      "src/routes/foo.ts",
      `router.get("/bar", handler);\n`,
    );
    const findings = await smokeCoverageDetector.run(
      ctx({ fileFilter: new Set(["src/routes/foo.ts"]) }),
    );
    expect(findings).toHaveLength(0);
  });
});
