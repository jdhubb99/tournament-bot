import { SlashCommandBuilder } from "discord.js";
import { historyEmbed } from "../render/embeds.ts";
import { listFinishedTournaments, listMatches, listTournamentPlayers, titlesUpTo, type Tournament } from "../store.ts";
import { FORMAT_NAMES, matchScore, ordinal, playerName } from "../views.ts";
import type { Command } from "./types.ts";

/** SQLite's datetime('now') is UTC "YYYY-MM-DD HH:MM:SS"; Discord timestamps take Unix seconds. */
function unixSeconds(sqliteUtc: string): number {
  return Math.floor(Date.parse(`${sqliteUtc.replace(" ", "T")}Z`) / 1000);
}

/**
 * Two lines per tournament:
 *   **#4** · <date and time> · Knockout, 4 players, semis Bo1
 *   > 🏆 **Jegson** (2nd title) beat Jako 2–1 in the final (Bo3)
 */
function entry(t: Tournament & { finished_at: string }): string {
  const players = listTournamentPlayers(t.id).length;
  // Round robin goes straight from the league to the final, so it has no semis.
  const semis = t.format === "round_robin" ? "" : `, semis Bo${t.semis_best_of}`;
  const final = listMatches(t.id).at(-1)!;
  const score = matchScore(final);
  const titles = titlesUpTo(t.guild_id, score.winnerId, t.id);
  // <t:…:f> shows the date and time in each viewer's own locale and timezone.
  return [
    `**#${t.id}** · <t:${unixSeconds(t.finished_at)}:f> · ${FORMAT_NAMES[t.format]}, ${players} players${semis}`,
    `> 🏆 **${playerName(score.winnerId)}** (${ordinal(titles)} title) beat ${playerName(score.loserId)} ` +
      `${score.winnerScore}–${score.loserScore} in the final (Bo${final.best_of})`,
  ].join("\n");
}

export const history: Command = {
  data: new SlashCommandBuilder().setName("history").setDescription("Past tournaments: when, format, champion and the final"),
  tournamentOnly: true,

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const entries = listFinishedTournaments(interaction.guildId).map(entry);
    await interaction.reply({ embeds: [historyEmbed(entries)] });
  },
};
