// Takes one backup and exits. docker-compose's backup service runs this once a day.
import { join } from "node:path";
import { runBackup } from "./backup.ts";
import { db } from "./db.ts";

runBackup(db, Bun.env, join(import.meta.dir, ".."));
