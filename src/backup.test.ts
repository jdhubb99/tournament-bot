import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDatabase, backupSettings, backupStamp, runBackup } from "./backup.ts";
import { openDb } from "./db.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tournament-bot-backups-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

describe("backupStamp", () => {
  it("is a sortable UTC date and time", () => {
    expect(backupStamp(at("2026-10-02T21:30:05.123Z"))).toBe("2026-10-02_213005");
  });
});

describe("backupDatabase", () => {
  it("writes a complete, readable copy of the database", () => {
    const db = openDb(":memory:");
    db.query("INSERT INTO players (discord_id, display_name) VALUES ('a', 'Ivan')").run();
    const file = backupDatabase(db, join(dir, "new-folder"), 14, at("2026-10-02T21:30:00Z"));

    expect(file).toBe(join(dir, "new-folder", "bot-2026-10-02_213000.db"));
    const copy = new Database(file, { readonly: true });
    expect(copy.query("SELECT display_name FROM players").all()).toEqual([{ display_name: "Ivan" }]);
    copy.close();
  });

  it("keeps only the newest snapshots, leaving other files alone", () => {
    const db = openDb(":memory:");
    writeFileSync(join(dir, "notes.txt"), "keep me");
    for (const day of ["01", "02", "03", "04"]) backupDatabase(db, dir, 2, at(`2026-10-${day}T12:00:00Z`));
    expect(readdirSync(dir).sort()).toEqual(["bot-2026-10-03_120000.db", "bot-2026-10-04_120000.db", "notes.txt"]);
    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
  });
});

describe("backupSettings", () => {
  it("defaults to ./backups and 14 copies", () => {
    expect(backupSettings({}, "/app")).toEqual({ dir: "/app/backups", keep: 14 });
  });

  it("reads BACKUP_DIR and BACKUP_KEEP", () => {
    expect(backupSettings({ BACKUP_DIR: "/srv/backups", BACKUP_KEEP: "30" }, "/app")).toEqual({ dir: "/srv/backups", keep: 30 });
  });

  it("rejects a BACKUP_KEEP that isn't a whole number of at least 1", () => {
    for (const bad of ["0", "-2", "1.5", "lots"]) {
      expect(() => backupSettings({ BACKUP_KEEP: bad }, "/app")).toThrow(`BACKUP_KEEP must be a whole number of at least 1, got "${bad}"`);
    }
  });
});

describe("runBackup", () => {
  it("backs up with the environment's settings and logs where it went", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const file = runBackup(openDb(":memory:"), { BACKUP_DIR: dir }, "/unused", at("2026-10-02T21:30:00Z"));
      expect(file).toBe(join(dir, "bot-2026-10-02_213000.db"));
      expect(log).toHaveBeenCalledWith(`Backed up to ${file}`);
    } finally {
      log.mockRestore();
    }
  });
});
