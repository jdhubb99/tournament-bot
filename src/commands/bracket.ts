import { SlashCommandBuilder } from "discord.js";
import { bracketEmbed } from "../render/embeds.ts";
import { getOpenTournament, listMatches, listTournamentPlayers } from "../store.ts";
import { FORMAT_NAMES, liveLineFor, queueLineFor, resultLineFor } from "../views.ts";
import type { Command } from "./types.ts";

// TODO(phases 5–6): also show league and group standings.
export const bracket: Command = {
  data: new SlashCommandBuilder().setName("bracket").setDescription("Show the live match, what's next, and results so far"),
  tournamentOnly: true,

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const tournament = getOpenTournament(interaction.guildId);
    if (!tournament) {
      await interaction.reply("No tournament is running. Use `/history` for past tournaments.");
      return;
    }
    const playerCount = listTournamentPlayers(tournament.id).length;
    if (tournament.status === "signup") {
      await interaction.reply(`Signup is open with ${playerCount} player(s). The bracket is drawn when someone presses Start.`);
      return;
    }

    const matches = listMatches(tournament.id);
    const live = matches.find((m) => m.status === "live");
    const embed = bracketEmbed({
      title: `${tournament.game} 1v1 — ${FORMAT_NAMES[tournament.format]}, ${playerCount} players`,
      live: live ? liveLineFor(live) : null,
      upNext: matches.filter((m) => m.status === "pending").map((m) => queueLineFor(m, matches)),
      results: matches.filter((m) => m.status === "done").map(resultLineFor),
    });
    await interaction.reply({ embeds: [embed] });
  },
};
