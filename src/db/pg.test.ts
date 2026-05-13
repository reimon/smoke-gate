import { describe, it, expect, vi } from "vitest";
import { seedTables, cleanupTables, cleanupByCascade } from "./pg.js";

function fakePool() {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    pool: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        // Simula RETURNING id
        return {
          rows: params ? [{ id: calls.length }] : [],
        };
      }),
    },
    calls,
  };
}

describe("pg: seedTables", () => {
  it("monta INSERT correto com placeholders", async () => {
    const { pool, calls } = fakePool();
    await seedTables(pool, [
      {
        table: "users",
        columns: ["id", "email"],
        values: [
          ["u1", "x@y"],
          ["u2", "a@b"],
        ],
      },
    ]);
    expect(calls[0].sql).toContain('INSERT INTO "users" ("id","email")');
    expect(calls[0].sql).toContain("VALUES ($1,$2),($3,$4)");
    expect(calls[0].params).toEqual(["u1", "x@y", "u2", "a@b"]);
  });

  it("aceita ON CONFLICT opcional", async () => {
    const { pool, calls } = fakePool();
    await seedTables(pool, [
      {
        table: "users",
        columns: ["id"],
        values: [["u1"]],
        onConflict: "ON CONFLICT (id) DO NOTHING",
      },
    ]);
    expect(calls[0].sql).toContain("ON CONFLICT (id) DO NOTHING");
  });

  it("RETURNING expõe valores", async () => {
    const { pool } = fakePool();
    const result = await seedTables(pool, [
      {
        table: "linkedin_profiles",
        columns: ["user_id"],
        values: [["u1"]],
        returning: "id",
      },
    ]);
    expect(result.returned[0]).toEqual([1]);
  });

  it("ignora spec com values vazio", async () => {
    const { pool, calls } = fakePool();
    await seedTables(pool, [
      { table: "users", columns: ["id"], values: [] },
    ]);
    expect(calls).toHaveLength(0);
  });

  it("rejeita identificadores SQL-injectable", async () => {
    const { pool } = fakePool();
    await expect(
      seedTables(pool, [
        {
          table: 'users"; DROP TABLE foo; --',
          columns: ["id"],
          values: [["x"]],
        },
      ]),
    ).rejects.toThrow("identificador inválido");
  });
});

describe("pg: cleanupTables", () => {
  it("monta DELETE com WHERE/params", async () => {
    const { pool, calls } = fakePool();
    await cleanupTables(pool, [
      { table: "linkedin_skills", where: "profile_id = $1", params: [42] },
    ]);
    expect(calls[0].sql).toBe(
      'DELETE FROM "linkedin_skills" WHERE profile_id = $1',
    );
    expect(calls[0].params).toEqual([42]);
  });
});

describe("pg: cleanupByCascade", () => {
  it("DELETE simples na tabela raiz", async () => {
    const { pool, calls } = fakePool();
    await cleanupByCascade(pool, "users", "id = $1", ["u1"]);
    expect(calls[0].sql).toBe('DELETE FROM "users" WHERE id = $1');
  });
});
