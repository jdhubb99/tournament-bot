import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
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

describe("migrations", () => {
  it("adds p1_team to a matches table created before teams existed", () => {
    const dir = mkdtempSync(join(tmpdir(), "tournament-bot-"));
    const path = join(dir, "old.db");
    try {
      const old = new Database(path);
      old.exec(`CREATE TABLE matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id INTEGER NOT NULL, round INTEGER NOT NULL,
        play_order INTEGER NOT NULL, label TEXT NOT NULL, p1_id TEXT, p2_id TEXT, best_of INTEGER NOT NULL DEFAULT 1,
        winner_id TEXT, next_match_id INTEGER, next_slot TEXT, status TEXT NOT NULL)`);
      old.close();

      const db = openDb(path);
      const columns = db.query<{ name: string }, []>("PRAGMA table_info(matches)").all().map((c) => c.name);
      expect(columns).toContain("p1_team");
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds dropped_after_game to a tournament_players table created before forfeits existed", () => {
    const dir = mkdtempSync(join(tmpdir(), "tournament-bot-"));
    const path = join(dir, "old.db");
    try {
      const old = new Database(path);
      old.exec(`CREATE TABLE tournament_players (
        tournament_id INTEGER NOT NULL, player_id TEXT NOT NULL, seed INTEGER, group_label TEXT,
        PRIMARY KEY (tournament_id, player_id))`);
      old.exec("INSERT INTO tournament_players (tournament_id, player_id, seed) VALUES (1, 'a', 1)");
      old.close();

      const db = openDb(path);
      expect(db.query("SELECT player_id, dropped_after_game FROM tournament_players").all()).toEqual([
        { player_id: "a", dropped_after_game: null },
      ]);
      db.close();
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
