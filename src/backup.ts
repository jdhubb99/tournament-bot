import type { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const BACKUP_NAME = /^bot-\d{4}-\d{2}-\d{2}_\d{6}\.db$/;

/** "2026-10-02_213000" (UTC), so names sort oldest to newest. */
export function backupStamp(now: Date): string {
  const iso = now.toISOString(); // 2026-10-02T21:30:00.000Z
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replaceAll(":", "")}`;
}

/**
 * Snapshots the database into `dir` as bot-<stamp>.db, then deletes all but the newest
 * `keep` snapshots. VACUUM INTO is safe while the bot is running: it writes a consistent
 * copy without blocking the bot. Returns the new file's path.
 */
export function backupDatabase(db: Database, dir: string, keep: number, now = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `bot-${backupStamp(now)}.db`);
  db.query("VACUUM INTO $file").run({ file });

  const backups = readdirSync(dir).filter((name) => BACKUP_NAME.test(name)).sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) rmSync(join(dir, old));
  return file;
}

/** Settings from the environment: BACKUP_DIR (default ./backups next to data/) and BACKUP_KEEP (default 14). */
export function backupSettings(env: Record<string, string | undefined>, root: string): { dir: string; keep: number } {
  const keep = Number(env.BACKUP_KEEP ?? 14);
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`BACKUP_KEEP must be a whole number of at least 1, got "${env.BACKUP_KEEP}"`);
  return { dir: env.BACKUP_DIR ?? join(root, "backups"), keep };
}

/** Takes one backup using the environment's settings and logs where it went. */
export function runBackup(db: Database, env: Record<string, string | undefined>, root: string, now = new Date()): string {
  const { dir, keep } = backupSettings(env, root);
  const file = backupDatabase(db, dir, keep, now);
  console.log(`Backed up to ${file}`);
  return file;
}
