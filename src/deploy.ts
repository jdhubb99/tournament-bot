import { REST, Routes } from "discord.js";
import { buildCommands, commands } from "./commands/index.ts";
import { env } from "./env.ts";

type Rest = Pick<REST, "put">;
export type Scope = "guild" | "global";

/**
 * Registers slash commands.
 * - "guild" (development): every command, including /dev in dev mode, in GUILD_ID only.
 *   Updates show up instantly.
 * - "global" (hosting): every command except /dev, in every server the bot is in. Updates can
 *   take up to an hour. It also clears GUILD_ID's own copies so commands don't show up twice.
 */
export async function deployCommands(scope: Scope = "guild", rest: Rest = new REST().setToken(env.token)): Promise<number> {
  if (scope === "guild") {
    const body = commands.map((c) => c.data.toJSON());
    await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body });
    console.log(`Registered ${body.length} command(s) in guild ${env.guildId}`);
    return body.length;
  }

  const body = buildCommands(false).map((c) => c.data.toJSON());
  await rest.put(Routes.applicationCommands(env.clientId), { body });
  await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body: [] });
  console.log(`Registered ${body.length} command(s) globally and cleared guild ${env.guildId}'s copies`);
  return body.length;
}

/** The scope asked for on the command line: `--global`, or guild by default. */
export function scopeFromArgs(args: readonly string[]): Scope {
  return args.includes("--global") ? "global" : "guild";
}
