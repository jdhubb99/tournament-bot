import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type Interaction,
  type RepliableInteraction,
} from "discord.js";
import { checkTournamentChannel } from "./channel.ts";
import { commandsByName } from "./commands/index.ts";
import { env } from "./env.ts";

export function createClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

export async function onReady(client: Client<true>): Promise<void> {
  await checkTournamentChannel(client);
  console.log(`Logged in as ${client.user.tag}`);
}

async function replyWithError(interaction: RepliableInteraction, label: string, err: unknown) {
  console.error(`Error in ${label}:`, err);
  const reply = { content: "Something went wrong.", flags: MessageFlags.Ephemeral } as const;
  if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
  else await interaction.reply(reply).catch(() => {});
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    const command = commandsByName.get(interaction.commandName);
    if (!command) return;
    if (command.tournamentOnly && interaction.channelId !== env.tournamentChannelId) {
      await interaction.reply({
        content: `Tournament commands only work in <#${env.tournamentChannelId}>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    try {
      await command.execute(interaction);
    } catch (err) {
      await replyWithError(interaction, `/${interaction.commandName}`, err);
    }
  } else if (interaction.isButton()) {
    const [name, ...args] = interaction.customId.split(":");
    const command = commandsByName.get(name!);
    if (!command?.button) return;
    try {
      await command.button(interaction, args);
    } catch (err) {
      await replyWithError(interaction, `button ${interaction.customId}`, err);
    }
  }
}

export async function startBot(client: Client = createClient()): Promise<Client> {
  client.once(Events.ClientReady, onReady);
  client.on(Events.InteractionCreate, handleInteraction);
  await client.login(env.token);
  return client;
}
