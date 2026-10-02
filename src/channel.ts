import { ChannelType, PermissionFlagsBits, type Client, type TextChannel } from "discord.js";
import { env } from "./env.ts";

const REQUIRED_PERMISSIONS = {
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages,
  EmbedLinks: PermissionFlagsBits.EmbedLinks,
  AttachFiles: PermissionFlagsBits.AttachFiles,
  ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
};

let channel: TextChannel | null = null;

/** Verifies #tournaments exists and the bot can use it. Exits the process with a clear error if not. */
export async function checkTournamentChannel(client: Client<true>): Promise<void> {
  const id = env.tournamentChannelId;
  const fail = (reason: string): never => {
    console.error(`Tournament channel check failed: ${reason}`);
    console.error("Create the channel in Discord and set TOURNAMENT_CHANNEL_ID in .env to its ID.");
    process.exit(1);
  };

  const fetched = await client.channels.fetch(id).catch(() => null);
  if (!fetched) fail(`channel ${id} not found or not visible to the bot`);
  if (fetched!.type !== ChannelType.GuildText) fail(`channel ${id} is not a text channel`);
  const text = fetched as TextChannel;
  if (text.guildId !== env.guildId) fail(`channel ${id} is not in guild ${env.guildId}`);

  const permissions = text.permissionsFor(client.user);
  const missing = Object.entries(REQUIRED_PERMISSIONS)
    .filter(([, flag]) => !permissions?.has(flag))
    .map(([name]) => name);
  if (missing.length > 0) fail(`bot is missing permissions in #${text.name}: ${missing.join(", ")}`);

  useTournamentChannel(text);
  console.log(`Tournament channel: #${text.name}`);
}

/** Set by the startup check; tests set it directly with a fake channel. */
export function useTournamentChannel(value: TextChannel | null): void {
  channel = value;
}

export function tournamentChannel(): TextChannel {
  if (!channel) throw new Error("Tournament channel used before startup check");
  return channel;
}
