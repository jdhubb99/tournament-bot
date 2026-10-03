import { SlashCommandBuilder } from "discord.js";
import { bracketPost } from "../announce.ts";
import { getOpenTournament, listFinishedTournaments, listTournamentPlayers } from "../store.ts";
import type { Command } from "./types.ts";

export const bracket: Command = {
  data: new SlashCommandBuilder().setName("bracket").setDescription("Show the bracket: live match, what's next, and results"),
  tournamentOnly: true,

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    // The running tournament, or else the last finished one (so its champion can be seen).
    const tournament = getOpenTournament(interaction.guildId) ?? listFinishedTournaments(interaction.guildId, 1)[0];
    if (!tournament) {
      await interaction.reply("No tournament has been played yet. Run `/tournament start` to begin one.");
      return;
    }
    const playerCount = listTournamentPlayers(tournament.id).length;
    if (tournament.status === "signup") {
      await interaction.reply(`Signup is open with ${playerCount} player(s). The bracket is drawn when someone presses Start.`);
      return;
    }

    // Avatar downloads and rendering can take a moment.
    await interaction.deferReply();
    const { embed, file } = await bracketPost(tournament.id);
    await interaction.editReply({ embeds: [embed], files: [file] });
  },
};
