import { env } from "../env.ts";
import { dev } from "./dev.ts";
import { ping } from "./ping.ts";
import { report } from "./report.ts";
import { tournament } from "./tournament.ts";
import type { Command } from "./types.ts";

// Add new commands here; deploy-commands.ts and index.ts both read this list.
export function buildCommands(devCommands: boolean): Command[] {
  return [ping, tournament, report, ...(devCommands ? [dev] : [])];
}

export const commands = buildCommands(env.devCommands);

export const commandsByName = new Map(commands.map((c) => [c.data.name, c]));
