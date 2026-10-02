import { SlashCommandBuilder } from "discord.js";
import { historyEmbed } from "../render/embeds.ts";
import { listFinishedTournaments, listMatches, listTournamentPlayers } from "../store.ts";
import { FORMAT_NAMES, playerName, runnerUpOf } from "../views.ts";
import type { Command } from "./types.ts";

/** SQLite's datetime('now') is UTC "YYYY-MM-DD HH:MM:SS"; Discord timestamps take Unix seconds. */
function unixSeconds(sqliteUtc: string): number {
  return Math.floor(Date.parse(`${sqliteUtc.replace(" ", "T")}Z`) / 1000);
}

export const history: Command = {
  data: new SlashCommandBuilder().setName("history").setDescription("Past tournaments: date, format, winner and runner-up"),
  tournamentOnly: true,

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const lines = listFinishedTournaments(interaction.guildId).map((t) => {
      const players = listTournamentPlayers(t.id).length;
      // <t:…:D> renders as a date in each viewer's own locale and timezone.
      return (
        `<t:${unixSeconds(t.finished_at)}:D> · ${FORMAT_NAMES[t.format]}, ${players} players · ` +
        `🏆 **${playerName(t.winner_id!)}** · runner-up ${runnerUpOf(listMatches(t.id))}`
      );
    });
    await interaction.reply({ embeds: [historyEmbed(lines)] });
  },
};
