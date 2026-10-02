import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.ts";
import { env } from "./env.ts";

type Rest = Pick<REST, "put">;

/** Registers commands in GUILD_ID (instant updates); switch to global in the hosting phase. */
export async function deployCommands(rest: Rest = new REST().setToken(env.token)): Promise<number> {
  const body = commands.map((c) => c.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body });
  console.log(`Registered ${body.length} command(s) in guild ${env.guildId}`);
  return body.length;
}
