import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbPath, openDb } from "./db.ts";

describe("openDb", () => {
  it("creates every table and enables foreign keys", () => {
    const db = openDb(":memory:");
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((t) => t.name);
    expect(tables).toEqual(["games", "matches", "players", "tournament_players", "tournaments"]);
    expect(db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
  });

  it("can be opened twice on the same schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "tournament-bot-"));
    try {
      openDb(join(dir, "x.db")).close();
      expect(() => openDb(join(dir, "x.db")).close()).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("dbPath", () => {
  it("uses the override when given", () => {
    expect(dbPath(":memory:")).toBe(":memory:");
  });

  it("defaults to bot.db inside the data dir and creates the dir", () => {
    const parent = mkdtempSync(join(tmpdir(), "tournament-bot-"));
    const dataDir = join(parent, "data");
    try {
      expect(dbPath("", dataDir)).toBe(join(dataDir, "bot.db"));
      expect(existsSync(dataDir)).toBe(true);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
