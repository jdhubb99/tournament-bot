import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  discord_id   TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournaments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  game            TEXT NOT NULL DEFAULT 'Rocket League',
  format          TEXT NOT NULL CHECK (format IN ('single_elim','round_robin','groups')),
  status          TEXT NOT NULL CHECK (status IN ('signup','active','done','cancelled')),
  semis_best_of   INTEGER NOT NULL DEFAULT 1,
  final_best_of   INTEGER NOT NULL DEFAULT 3,
  winner_id       TEXT REFERENCES players(discord_id),
  bracket_msg_id  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT
);

CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  player_id     TEXT NOT NULL REFERENCES players(discord_id),
  seed          INTEGER,
  group_label   TEXT CHECK (group_label IN ('A','B')),
  PRIMARY KEY (tournament_id, player_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  round         INTEGER NOT NULL,
  play_order    INTEGER NOT NULL,
  label         TEXT NOT NULL,
  p1_id         TEXT REFERENCES players(discord_id),
  p2_id         TEXT REFERENCES players(discord_id),
  best_of       INTEGER NOT NULL DEFAULT 1,
  winner_id     TEXT REFERENCES players(discord_id),
  next_match_id INTEGER REFERENCES matches(id),
  next_slot     TEXT CHECK (next_slot IN ('p1','p2')),
  status        TEXT NOT NULL CHECK (status IN ('pending','live','done')),
  p1_team       TEXT CHECK (p1_team IN ('goons','gooners'))  -- set when the match goes live; p2 is on the other team
);

CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id    INTEGER NOT NULL REFERENCES matches(id),
  game_number INTEGER NOT NULL,
  p1_score    INTEGER NOT NULL,
  p2_score    INTEGER NOT NULL,
  reported_by TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function openDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Brings databases created by older versions up to the current schema. Each step is idempotent. */
function migrate(db: Database): void {
  const matchColumns = db.query<{ name: string }, []>("PRAGMA table_info(matches)").all().map((c) => c.name);
  if (!matchColumns.includes("p1_team")) {
    db.exec("ALTER TABLE matches ADD COLUMN p1_team TEXT CHECK (p1_team IN ('goons','gooners'))");
  }
}

/** DB_PATH overrides the location (e.g. ":memory:" for tests and scripts that must not touch real data). */
export function dbPath(override = Bun.env.DB_PATH, dataDir = join(import.meta.dir, "..", "data")): string {
  if (override) return override;
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, "bot.db");
}

export const db = openDb(dbPath());
