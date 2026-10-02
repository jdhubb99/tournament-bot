import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.ts";

export const ping: Command = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Check that the bot is online"),
  async execute(interaction) {
    await interaction.reply({ content: `Pong! (${interaction.client.ws.ping}ms)` });
  },
};
