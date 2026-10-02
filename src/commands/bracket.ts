import { SlashCommandBuilder } from "discord.js";
import { bracketImage } from "../announce.ts";
import { bracketEmbed } from "../render/embeds.ts";
import { getOpenTournament, listFinishedTournaments, listMatches, listTournamentPlayers } from "../store.ts";
import { FORMAT_NAMES, liveLineFor } from "../views.ts";
import type { Command } from "./types.ts";

// TODO(phase 5–6): round robin and groups need their own standings image.
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
    const live = listMatches(tournament.id).find((m) => m.status === "live");
    const finished = tournament.status === "done" ? " (finished)" : "";
    const embed = bracketEmbed({
      title: `${tournament.game} 1v1 — ${FORMAT_NAMES[tournament.format]}, ${playerCount} players${finished}`,
      live: live ? liveLineFor(live) : null,
    });
    await interaction.editReply({ embeds: [embed], files: [await bracketImage(tournament.id)] });
  },
};
