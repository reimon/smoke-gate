import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LlmCache, cacheKey } from "./cache";
import type { Finding } from "../types";

let tmpRoot: string;
let cachePath: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-cache-test-"));
  cachePath = path.join(tmpRoot, ".smoke-gate", "llm-cache.json");
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function mkFinding(extra: Partial<Finding> = {}): Finding {
  return {
    code: "SQL-001",
    detector: "sqlDrift",
    severity: "critical",
    title: "x",
    location: { file: "src/repo.ts", line: 42 },
    snippet: "SELECT u.foo FROM users u",
    evidence: "y",
    ...extra,
  };
}

describe("LlmCache", () => {
  it("retorna undefined em miss e incrementa contadores", () => {
    const c = new LlmCache(cachePath);
    expect(c.get(mkFinding(), "anthropic")).toBeUndefined();
    expect(c.misses).toBe(1);
    expect(c.hits).toBe(0);
  });

  it("set + get devolve o enrichment", () => {
    const c = new LlmCache(cachePath);
    const f = mkFinding();
    c.set(f, "anthropic", { llmExplanation: "bug", llmFix: "fix", llmCommand: "sed ..." });
    const got = c.get(f, "anthropic");
    expect(got?.llmExplanation).toBe("bug");
    expect(got?.llmFix).toBe("fix");
    expect(got?.llmCommand).toBe("sed ...");
    expect(c.hits).toBe(1);
  });

  it("save → load preserva entries", () => {
    const c1 = new LlmCache(cachePath);
    c1.set(mkFinding(), "openai", { llmExplanation: "z" });
    c1.save();
    expect(fs.existsSync(cachePath)).toBe(true);

    const c2 = new LlmCache(cachePath);
    c2.load();
    const got = c2.get(mkFinding(), "openai");
    expect(got?.llmExplanation).toBe("z");
  });

  it("não escreve se nada foi setado (dirty=false)", () => {
    const c = new LlmCache(cachePath);
    c.save();
    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it("modes diferentes geram chaves diferentes", () => {
    const f = mkFinding();
    expect(cacheKey(f, "anthropic")).not.toBe(cacheKey(f, "openai"));
  });

  it("snippet diferente invalida cache (code mudou no arquivo)", () => {
    const a = cacheKey(mkFinding({ snippet: "SELECT u.foo" }), "anthropic");
    const b = cacheKey(mkFinding({ snippet: "SELECT u.bar" }), "anthropic");
    expect(a).not.toBe(b);
  });

  it("cache file corrompido não derruba load", () => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, "{nope");
    const c = new LlmCache(cachePath);
    expect(() => c.load()).not.toThrow();
    expect(c.get(mkFinding(), "anthropic")).toBeUndefined();
  });

  it("version mismatch ignora entries antigas", () => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        version: 999,
        entries: { abc: { llmExplanation: "x", savedAt: "2025-01-01" } },
      }),
    );
    const c = new LlmCache(cachePath);
    c.load();
    expect(c.get(mkFinding(), "anthropic")).toBeUndefined();
  });
});
