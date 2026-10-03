import { env } from "../env.ts";
import { bracket } from "./bracket.ts";
import { dev } from "./dev.ts";
import { history } from "./history.ts";
import { leaderboard } from "./leaderboard.ts";
import { ping } from "./ping.ts";
import { report } from "./report.ts";
import { stats } from "./stats.ts";
import { tournament } from "./tournament.ts";
import { undo } from "./undo.ts";
import type { Command } from "./types.ts";

// Add new commands here; deploy-commands.ts and index.ts both read this list.
export function buildCommands(devCommands: boolean): Command[] {
  return [ping, tournament, report, undo, bracket, history, leaderboard, stats, ...(devCommands ? [dev] : [])];
}

export const commands = buildCommands(env.devCommands);

export const commandsByName = new Map(commands.map((c) => [c.data.name, c]));
